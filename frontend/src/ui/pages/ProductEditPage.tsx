import { useState, useEffect, useCallback, useMemo, useRef, type FormEvent, type DragEvent } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getProduct,
  updateProduct,
  getProductVariants,
  patchProductVariants,
  deleteProductVariant,
  uploadProductDictionaryImage,
} from '../../api/adminApi'
import type { ProductItem, ProductVariantItem, ProductVariantWriteItem } from '../../api/domainTypes'
import { resolvePublicUploadSrc } from '../../api/constants'
import { getInventoryClients, getInventoryColors, getInventorySizes } from '../../api/inventoryLookupsApi'
import type { DictionaryItem } from '../../api/domainTypes'
import { Combobox } from '../data/Combobox'
import type { ComboboxOption } from '../data/Combobox'
import { Modal } from '../feedback/Modal'
import { DetailPage } from '../layouts/DetailPage'
import { Field, Input } from '../primitives/Input'
import { Toggle } from '../primitives/Checkbox'
import { Badge } from '../primitives/Badge'
import { Skeleton } from '../primitives/Skeleton'
import { Icon } from '../primitives/Icon'
import { Select } from '../primitives/Select'
import { Tooltip } from '../primitives/Tooltip'
import { Table, Td } from '../data/Table'
import { useConfirm } from '../feedback/ConfirmDialog'
import { useToast } from '../feedback/Toast'

function parseNum(s: string) {
  const n = parseFloat(String(s).replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function parseOptionalWeight(s: string): number | null {
  const trimmed = s.trim()
  if (!trimmed) return null
  const n = Number(trimmed.replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n) : null
}

function parseOptionalInteger(s: string): number | null {
  const trimmed = s.trim()
  if (!trimmed) return null
  const n = Number(trimmed.replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n) : null
}

function emptyRow(requiresSize: boolean): ProductVariantWriteItem {
  return {
    id: null,
    sku: '',
    color_id: '',
    dimension: { length: 0, width: 0, height: 0 },
    size_id: requiresSize ? '' : null,
    images: [],
    is_active: true,
  }
}

function variantKey(r: ProductVariantWriteItem, requiresSize: boolean) {
  return requiresSize ? `${r.color_id}|${r.size_id ?? ''}` : r.color_id
}

function hasDuplicates(rows: ProductVariantWriteItem[], requiresSize: boolean) {
  const keys = rows.filter((r) => r.color_id).map((r) => variantKey(r, requiresSize))
  return keys.length !== new Set(keys).size
}

type ProductImageItem =
  | { kind: 'url'; previewUrl: string; serverUrl: string }
  | { kind: 'file'; previewUrl: string; file: File }

function DimInput({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled: boolean }) {
  const [raw, setRaw] = useState(value > 0 ? String(value) : '')
  useEffect(() => {
    setRaw(value > 0 ? String(value) : '')
  }, [value])
  return (
    <input
      className="input"
      style={{ width: 64, textAlign: 'center', fontFamily: 'var(--font-num)', fontSize: 12, fontVariantNumeric: 'tabular-nums', fontFeatureSettings: "'tnum' 1", padding: '0 6px' }}
      value={raw}
      disabled={disabled}
      onChange={(e) => {
        setRaw(e.target.value)
        onChange(parseNum(e.target.value))
      }}
      onBlur={() => setRaw(value > 0 ? String(value) : '')}
    />
  )
}

export function ProductEditPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const toast = useToast()
  const imgRef = useRef<HTMLInputElement>(null)

  const [product, setProduct] = useState<ProductItem | null>(null)
  const [name, setName] = useState('')
  const [skuBase, setSkuBase] = useState('')
  const [weightGrams, setWeightGrams] = useState('')
  const [itemsPerPallet, setItemsPerPallet] = useState('')
  const [clientId, setClientId] = useState<string | null>(null)
  const [isActive, setIsActive] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [nameTouched, setNameTouched] = useState(false)

  const [images, setImages] = useState<ProductImageItem[]>([])
  const [fullscreenImageIndex, setFullscreenImageIndex] = useState<number | null>(null)
  const dragSrcRef = useRef<number | null>(null)
  const [dragSrcIdx, setDragSrcIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  const nameInvalid = useMemo(() => !name.trim(), [name])

  const [colors, setColors] = useState<DictionaryItem[]>([])
  const [sizes, setSizes] = useState<DictionaryItem[]>([])
  const [clients, setClients] = useState<ComboboxOption[]>([])
  const [rows, setRows] = useState<ProductVariantWriteItem[]>([])
  const [variantMeta, setVariantMeta] = useState<Map<string, { hasReceipts: boolean; sku: string }>>(new Map())
  const [varLoading, setVarLoading] = useState(false)
  const [varError, setVarError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    getProduct(id)
      .then((p) => {
        setProduct(p)
        setName(p.name)
        setSkuBase(p.sku_base)
        setWeightGrams(p.weight_grams != null ? String(p.weight_grams) : '')
        setItemsPerPallet(p.items_per_pallet != null ? String(p.items_per_pallet) : '')
        setClientId(p.client_id)
        setIsActive(p.is_active)
        setImages((p.image_urls ?? []).map((url) => ({ kind: 'url', previewUrl: url, serverUrl: url })))
      })
      .finally(() => setLoading(false))
    getInventoryClients().then((items: DictionaryItem[]) => setClients(items.map((item) => ({ value: item.id, label: item.name })))).catch(() => {})
    getInventoryColors().then(setColors).catch(() => {})
    getInventorySizes().then(setSizes).catch(() => {})
  }, [id])

  useEffect(() => {
    return () => {
      for (const img of images) {
        if (img.kind === 'file' && img.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(img.previewUrl)
        }
      }
    }
  }, [images])

  const loadVariants = useCallback(async () => {
    if (!id) return
    setVarLoading(true)
    try {
      const items: ProductVariantItem[] = await getProductVariants(id)
      setRows(
        items.map((v) => ({
          id: v.id,
          sku: v.sku,
          color_id: v.color_id,
          dimension: { ...v.dimension },
          size_id: v.size_id,
          images: [],
          is_active: v.is_active,
        })),
      )
      setVariantMeta(new Map(items.map((v) => [v.id, { hasReceipts: v.has_receipts ?? false, sku: v.sku }])))
    } catch (e: unknown) {
      setVarError(e instanceof Error ? e.message : 'Ошибка загрузки вариантов')
    } finally {
      setVarLoading(false)
    }
  }, [id])

  useEffect(() => {
    void loadVariants()
  }, [loadVariants])

  const handlePhotoDragStart = useCallback((e: DragEvent, i: number) => {
    dragSrcRef.current = i
    setDragSrcIdx(i)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handlePhotoDragOver = useCallback((e: DragEvent, i: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIdx(i)
  }, [])

  const handlePhotoDrop = useCallback((e: DragEvent, targetIdx: number) => {
    e.preventDefault()
    const src = dragSrcRef.current
    if (src === null || src === targetIdx) {
      dragSrcRef.current = null
      setDragOverIdx(null)
      return
    }
    dragSrcRef.current = null
    setDragSrcIdx(null)
    setDragOverIdx(null)
    setImages((prev) => {
      const next = [...prev]
      const [moved] = next.splice(src, 1)
      if (!moved) return prev
      next.splice(targetIdx, 0, moved)
      return next
    })
  }, [])

  const handlePhotoDragEnd = useCallback(() => {
    dragSrcRef.current = null
    setDragSrcIdx(null)
    setDragOverIdx(null)
  }, [])

  function handleImages(files: FileList | null) {
    if (!files) return
    const arr = Array.from(files)
    const next: ProductImageItem[] = arr.map((file) => ({
      kind: 'file',
      file,
      previewUrl: URL.createObjectURL(file),
    }))
    setImages((prev) => [...prev, ...next])
  }

  async function saveProductPart() {
    if (!id || nameInvalid || !skuBase.trim() || !clientId) throw new Error('Заполните обязательные поля товара')
    const uploadedByPreview = new Map<string, string>()
    for (const img of images) {
      if (img.kind !== 'file') continue
      if (uploadedByPreview.has(img.previewUrl)) continue
      const { url } = await uploadProductDictionaryImage(img.file)
      uploadedByPreview.set(img.previewUrl, url)
    }

    const image_urls = images
      .map((img) => (img.kind === 'url' ? img.serverUrl : uploadedByPreview.get(img.previewUrl) ?? ''))
      .filter((u) => u !== '')

    await updateProduct(id, {
      name: name.trim(),
      sku_base: skuBase.trim(),
      weight_grams: parseOptionalWeight(weightGrams),
      items_per_pallet: parseOptionalInteger(itemsPerPallet),
      client_id: clientId,
      is_active: isActive,
      image_urls,
    })
  }

  async function saveVariantsPart() {
    if (!id) throw new Error('Товар не найден')
    const requiresSz = product?.requires_size ?? false
    const requiresClr = product?.requires_color ?? false
    const missingColor = requiresClr && rows.some((r) => !r.color_id)
    const missingSize = requiresSz && rows.some((r) => !r.size_id)
    if (missingColor) throw new Error('Укажите цвет для всех вариантов')
    if (missingSize) throw new Error('Укажите размер для всех вариантов')
    if (hasDuplicates(rows, requiresSz)) throw new Error('Есть дублирующиеся сочетания цвет + размер')
    if (!requiresSz && rows.length > 1) {
      const first = rows[0]!.dimension
      const dimMismatch = rows.slice(1).some((r) =>
        r.dimension.length !== first.length ||
        r.dimension.width !== first.width ||
        r.dimension.height !== first.height
      )
      if (dimMismatch) throw new Error('У техники все варианты должны иметь одинаковые габариты')
    }

    await patchProductVariants(id, rows)
  }

  async function handleSaveAll() {
    if (!id) return
    setNameTouched(true)
    setVarError('')
    setSaving(true)
    try {
      await saveProductPart()
      await saveVariantsPart()
      await loadVariants()
      toast('Изменения сохранены', 'success')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Ошибка сохранения'
      toast(msg, 'error')
      setVarError(msg)
    } finally {
      setSaving(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void handleSaveAll()
  }

  async function handleDeleteVariant(variantId: string) {
    if (!id) return
    const ok = await confirm({
      title: 'Удалить вариант?',
      body: 'Это действие нельзя отменить. Вариант будет удален из товара.',
      danger: true,
      confirmLabel: 'Удалить',
    })
    if (!ok) return
    setDeletingId(variantId)
    setVarError('')
    try {
      await deleteProductVariant(id, variantId)
      setRows((prev) => prev.filter((r) => r.id !== variantId))
    } catch (e: unknown) {
      setVarError(e instanceof Error ? e.message : 'Ошибка удаления')
    } finally {
      setDeletingId(null)
    }
  }

  function setRow(i: number, patch: Partial<ProductVariantWriteItem>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  function setDim(i: number, field: 'length' | 'width' | 'height', val: number) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, dimension: { ...r.dimension, [field]: val } } : r)))
  }

  function openFullscreenImage(index: number) {
    setFullscreenImageIndex(index)
  }

  function closeFullscreenImage() {
    setFullscreenImageIndex(null)
  }

  function showPrevFullscreenImage() {
    setFullscreenImageIndex((prev) => {
      if (prev === null || images.length === 0) return prev
      return prev === 0 ? images.length - 1 : prev - 1
    })
  }

  function showNextFullscreenImage() {
    setFullscreenImageIndex((prev) => {
      if (prev === null || images.length === 0) return prev
      return prev === images.length - 1 ? 0 : prev + 1
    })
  }

  if (loading) return <div className="page"><Skeleton height={32} width="40%" /></div>
  if (!product) return <div className="page"><div style={{ color: 'var(--c-text-subtle)' }}>Товар не найден</div></div>

  const requiresSize = product.requires_size
  const busy = saving || varLoading
  const fullscreenImage =
    fullscreenImageIndex !== null && images[fullscreenImageIndex]
      ? resolvePublicUploadSrc(images[fullscreenImageIndex].previewUrl)
      : null

  return (
    <DetailPage
      title={product.name}
      subtitle={product.sku_base}
      backTo={`/dictionaries/products/${id}`}
      actions={
        <>
          <Badge tone={product.is_active ? 'success' : ''}>{product.is_active ? 'Активен' : 'Неактивен'}</Badge>
          <button type="button" className="btn ghost" onClick={() => navigate(`/dictionaries/products/${id}`)} disabled={busy}>
            Отмена
          </button>
          <button type="button" className="btn primary" onClick={() => void handleSaveAll()} disabled={busy}>
            {saving ? 'Сохранение…' : <><Icon name="check" size={14} />Сохранить</>}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <form onSubmit={handleSubmit}>
            <div className="card">
              <div className="card-head">
                <Icon name="box" size={15} style={{ color: 'var(--c-accent)' }} />
                <div className="card-head-title">Товар</div>
              </div>
              <div className="card-body">
                <Field label="Тип"><div style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>{product.type_name ?? '—'}</div></Field>
                <Field label="Клиент" required>
                  <Combobox
                    value={clientId}
                    onChange={(value) => setClientId(value ? String(value) : null)}
                    options={clients}
                    placeholder="Выберите клиента…"
                    disabled={product.client_locked}
                  />
                  {product.client_locked && (
                    <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginTop: 6 }}>
                      Клиента нельзя изменить, потому что по товару уже есть поступления.
                    </div>
                  )}
                </Field>
                <Field label="SKU" required>
                  <Input
                    value={skuBase}
                    onChange={(e) => setSkuBase(e.target.value)}
                    style={{ fontFamily: 'var(--font-code)' }}
                  />
                </Field>
                <Field label="Название" required>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => setNameTouched(true)}
                    style={nameTouched && nameInvalid ? { borderColor: 'var(--c-danger)' } : undefined}
                  />
                  {nameTouched && nameInvalid && (
                    <div style={{ fontSize: 12, color: 'var(--c-danger)', marginTop: 2 }}>Обязательное поле</div>
                  )}
                </Field>
                <Field label="Активен">
                  <Toggle checked={isActive} onChange={setIsActive} label="Товар активен" />
                </Field>
              </div>
            </div>
          </form>

          <div className="card">
            <div className="card-head"><div className="card-head-title">Фотографии</div></div>
            <div className="card-body">
              <div className="row gap-8" style={{ flexWrap: 'wrap', marginBottom: 8, alignItems: 'flex-start' }}>
                {images.map((img, i) => (
                  <div
                    key={`${img.kind}-${img.previewUrl}-${i}`}
                    draggable
                    onDragStart={(e) => handlePhotoDragStart(e, i)}
                    onDragOver={(e) => handlePhotoDragOver(e, i)}
                    onDrop={(e) => handlePhotoDrop(e, i)}
                    onDragEnd={handlePhotoDragEnd}
                    style={{
                      position: 'relative', width: 72, height: 72, borderRadius: 6, overflow: 'hidden',
                      border: dragOverIdx === i && dragSrcIdx !== i ? '2px solid var(--c-accent)' : '1px solid var(--c-border)',
                      opacity: dragSrcIdx === i ? 0.4 : 1,
                      cursor: 'pointer', boxSizing: 'border-box', transition: 'opacity 0.15s, border-color 0.15s',
                    }}
                    onClick={() => openFullscreenImage(i)}
                  >
                    <img src={resolvePublicUploadSrc(img.previewUrl)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
                    <button
                      type="button"
                      className="product-image-remove"
                      style={{
                        position: 'absolute',
                        top: 2,
                        right: 2,
                        width: 20,
                        height: 20,
                        padding: 0,
                        background: 'rgba(0,0,0,0.5)',
                        border: 'none',
                        borderRadius: 4,
                        color: '#fff',
                        cursor: 'pointer',
                        lineHeight: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'background-color 0.15s ease, transform 0.15s ease',
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        setImages((prev) => {
                          const t = prev[i]
                          if (t?.kind === 'file' && t.previewUrl.startsWith('blob:')) URL.revokeObjectURL(t.previewUrl)
                          return prev.filter((_, j) => j !== i)
                        })
                      }}
                    ><Icon name="x" size={11} /></button>
                    {i === 0 && (
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.45)', fontSize: 9, color: '#fff', textAlign: 'center', padding: '2px 0', letterSpacing: 0.3 }}>
                        ГЛАВНОЕ
                      </div>
                    )}
                  </div>
                ))}
                <button type="button" className="btn ghost sm" onClick={() => imgRef.current?.click()} disabled={busy}>
                  <Icon name="upload" size={13} />Добавить фото
                </button>
              </div>
              {images.length > 1 && (
                <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginBottom: 4 }}>
                  <Icon name="sort" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
                  Перетащите фото для изменения порядка. Первое — главное.
                </div>
              )}
              <input ref={imgRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => handleImages(e.target.files)} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-head">
              <div className="card-head-title">Параметры</div>
            </div>
            <div className="card-body">
              <Field label="Вес, гр.">
                <Input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={weightGrams}
                  disabled={busy}
                  onChange={(e) => setWeightGrams(e.target.value)}
                  style={{ fontFamily: 'var(--font-num)', fontVariantNumeric: 'tabular-nums', fontFeatureSettings: "'tnum' 1" }}
                />
              </Field>
              <Field label="Количество товаров на паллете">
                <Input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={itemsPerPallet}
                  disabled={busy}
                  onChange={(e) => setItemsPerPallet(e.target.value)}
                  style={{ fontFamily: 'var(--font-num)', fontVariantNumeric: 'tabular-nums', fontFeatureSettings: "'tnum' 1" }}
                />
              </Field>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <Icon name="palette" size={15} style={{ color: 'var(--c-accent)' }} />
              <div className="card-head-title">Варианты</div>
              <span className="badge accent" style={{ marginLeft: 6 }}>{rows.length}</span>
              <div style={{ flex: 1 }} />
              <button
                type="button"
                className="btn ghost sm"
                disabled={busy}
                onClick={() => setRows((prev) => [...prev, emptyRow(requiresSize)])}
              >
                <Icon name="plus" size={12} />Добавить
              </button>
            </div>

            {varLoading ? (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>Загрузка…</div>
            ) : (
              <>
                <Table>
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Цвет</th>
                      {requiresSize && <th>Размер</th>}
                      <th>Д x Ш x В (см)</th>
                      <th style={{ width: 28 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={requiresSize ? 5 : 4} style={{ padding: '28px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>
                          Нет вариантов — нажмите «Добавить»
                        </td>
                      </tr>
                    ) : rows.map((row, i) => {
                      const meta = row.id ? variantMeta.get(row.id) : undefined
                      const locked = meta?.hasReceipts ?? false
                      return (
                    <tr key={row.id ?? `new-${i}`}>
                      <Td>
                        {meta?.sku ? (
                          <span className="mono" title={meta.sku} style={{ fontSize: 11.5, display: 'inline-block', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                            {meta.sku}
                          </span>
                        ) : (
                          <span className="faint text-xs">новый</span>
                        )}
                      </Td>
                      <Td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Select
                            value={row.color_id ?? ''}
                            onChange={(v) => setRow(i, { color_id: v })}
                            options={colors.map((c) => ({ value: c.id, label: c.name }))}
                            placeholder="Цвет…"
                            disabled={busy || locked}
                          />
                          {locked && (
                            <Tooltip content="Цвет нельзя изменить: по этому варианту есть поступления">
                              <span style={{ cursor: 'help', color: 'var(--c-text-subtle)', flexShrink: 0 }}>
                                <Icon name="lock" size={13} />
                              </span>
                            </Tooltip>
                          )}
                        </div>
                      </Td>
                      {requiresSize && (
                        <Td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Select
                              value={row.size_id ?? ''}
                              onChange={(v) => setRow(i, { size_id: v || null })}
                              options={sizes.map((s) => ({ value: s.id, label: s.name }))}
                              placeholder="Размер…"
                              disabled={busy || locked}
                            />
                            {locked && (
                              <Tooltip content="Размер нельзя изменить: по этому варианту есть поступления">
                                <span style={{ cursor: 'help', color: 'var(--c-text-subtle)', flexShrink: 0 }}>
                                  <Icon name="lock" size={13} />
                                </span>
                              </Tooltip>
                            )}
                          </div>
                        </Td>
                      )}
                      <Td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <DimInput value={row.dimension.length} disabled={busy} onChange={(v) => setDim(i, 'length', v)} />
                          <span style={{ color: 'var(--c-text-faint)', fontSize: 11 }}>x</span>
                          <DimInput value={row.dimension.width} disabled={busy} onChange={(v) => setDim(i, 'width', v)} />
                          <span style={{ color: 'var(--c-text-faint)', fontSize: 11 }}>x</span>
                          <DimInput value={row.dimension.height} disabled={busy} onChange={(v) => setDim(i, 'height', v)} />
                        </div>
                      </Td>
                      <Td>
                        <button
                          type="button"
                          className="btn ghost icon sm"
                          disabled={busy || (row.id !== null && deletingId === row.id)}
                          onClick={() => row.id ? handleDeleteVariant(row.id) : setRows((prev) => prev.filter((_, j) => j !== i))}
                        >
                          <Icon name="trash" size={13} />
                        </button>
                      </Td>
                    </tr>
                      )
                    })}
                  </tbody>
                </Table>

                <div style={{ padding: '10px 14px', borderTop: rows.length > 0 ? '1px solid var(--c-border)' : 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                  {varError && <span style={{ fontSize: 12, color: 'var(--c-danger)', flex: 1 }}>{varError}</span>}
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>Варианты сохраняются кнопкой «Сохранить» сверху</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <Modal open={fullscreenImage !== null} onClose={closeFullscreenImage} width={960}>
        {fullscreenImage && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, minHeight: 320 }}>
            {images.length > 1 && (
              <button
                type="button"
                className="btn ghost icon"
                onClick={showPrevFullscreenImage}
                title="Предыдущее фото"
              >
                <Icon name="arrowLeft" size={18} />
              </button>
            )}
            <img
              src={fullscreenImage}
              alt=""
              style={{ maxWidth: '100%', maxHeight: 'calc(100vh - 180px)', objectFit: 'contain', display: 'block' }}
            />
            {images.length > 1 && (
              <button
                type="button"
                className="btn ghost icon"
                onClick={showNextFullscreenImage}
                title="Следующее фото"
              >
                <Icon name="arrowRight" size={18} />
              </button>
            )}
          </div>
        )}
      </Modal>
      <style>{`
        .product-image-remove:hover {
          background: rgba(0, 0, 0, 0.72) !important;
          transform: scale(1.06);
        }
      `}</style>
    </DetailPage>
  )
}
