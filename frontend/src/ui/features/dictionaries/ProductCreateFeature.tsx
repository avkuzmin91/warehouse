import { useState, useEffect, useRef, useCallback, useMemo, type FormEvent, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { createProduct } from '../../../api/adminApi'
import {
  getInventoryColors,
  getInventorySizes,
  getInventoryProductTypes,
} from '../../../api/inventoryLookupsApi'
import type { DictionaryItem, InventoryProductTypeLookup } from '../../../api/domainTypes'
import { useLookups } from '../../../hooks/useLookups'
import { FormPage } from '../../layouts/FormPage'
import { Alert } from '../../primitives/Alert'
import { Field, Input } from '../../primitives/Input'
import { Toggle } from '../../primitives/Checkbox'
import { Combobox } from '../../data/Combobox'
import type { ComboboxOption } from '../../data/Combobox'
import { MultiSelect } from '../../data/MultiSelect'
import { Icon } from '../../primitives/Icon'
import { parseNum, parseOptionalWeight, parseOptionalInteger } from '../../../utils/parseNumbers'

type DimBlock = { length: string; width: string; height: string; sizes: string[] }
type FieldKey = 'name' | 'type_id' | 'sku_base' | 'client_id' | 'colors' | 'dimensions'

function mapServerError(msg: string): string {
  const l = msg.toLowerCase()
  if (l.includes('штрих-код') || l.includes('sku') || l.includes('unique') || l.includes('duplicate')) {
    return 'Штрих-код или SKU варианта уже занят у выбранного клиента. Укажите другой SKU.'
  }
  return msg
}

function checkDuplicateCombos(blocks: DimBlock[], colorIds: string[]): string | null {
  const seen = new Set<string>()
  const effectiveColors = colorIds.length > 0 ? colorIds : ['']
  for (const b of blocks) {
    for (const sz of b.sizes) {
      for (const cid of effectiveColors) {
        // для одежды уникальность — цвет × размер (без габаритов)
        const key = `${cid.toLowerCase()}\0${sz.toLowerCase()}`
        if (seen.has(key)) return 'Дублируется комбинация цвета и размера.'
        seen.add(key)
      }
    }
  }
  return null
}

// ─── Поле с подсветкой ошибки ────────────────────────────────────────────────

function ErrMsg({ msg }: { msg?: string }) {
  if (!msg) return null
  return <div style={{ fontSize: 11.5, color: 'var(--c-danger)', marginTop: 4 }}>{msg}</div>
}

// ─── Компонент ───────────────────────────────────────────────────────────────

export function ProductCreateFeature() {
  const navigate = useNavigate()
  const imgRef = useRef<HTMLInputElement>(null)

  const { clients: clientLookups } = useLookups()
  const clients = useMemo<ComboboxOption[]>(
    () => clientLookups.map((c) => ({ value: c.id, label: c.name })),
    [clientLookups],
  )

  const [productTypes, setProductTypes] = useState<InventoryProductTypeLookup[]>([])
  const [colorOptions, setColorOptions] = useState<ComboboxOption[]>([])
  const [sizeOptions, setSizeOptions] = useState<ComboboxOption[]>([])

  const [name, setName] = useState('')
  const [typeId, setTypeId] = useState<string | null>(null)
  const [clientId, setClientId] = useState<string | null>(null)
  const [skuBase, setSkuBase] = useState('')
  const [skuPending, setSkuPending] = useState(false)
  const [weightGrams, setWeightGrams] = useState('')
  const [itemsPerPallet, setItemsPerPallet] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [colorIds, setColorIds] = useState<string[]>([])
  const [dims, setDims] = useState<DimBlock[]>([{ length: '', width: '', height: '', sizes: [] }])

  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const dragSrcRef = useRef<number | null>(null)
  const [dragSrcIdx, setDragSrcIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({})
  const [submitError, setSubmitError] = useState('')
  const [lookupError, setLookupError] = useState('')
  const [saving, setSaving] = useState(false)

  const requiresColor = productTypes.find((t) => t.id === typeId)?.requires_color ?? false
  const requiresSize = productTypes.find((t) => t.id === typeId)?.requires_size ?? false

  useEffect(() => {
    let alive = true
    setLookupError('')
    Promise.allSettled([
      getInventoryProductTypes(),
      getInventoryColors(),
      getInventorySizes(),
    ]).then((results) => {
      if (!alive) return
      const [types, cols, szs] = results
      if (types.status === 'fulfilled') setProductTypes(types.value)
      if (cols.status === 'fulfilled') setColorOptions(cols.value.map((c: DictionaryItem) => ({ value: c.id, label: c.name })))
      if (szs.status === 'fulfilled') setSizeOptions(szs.value.map((s: DictionaryItem) => ({ value: s.id, label: s.name })))
      const failed = results.find((r) => r.status === 'rejected')
      if (failed?.status === 'rejected') {
        setLookupError(failed.reason instanceof Error ? failed.reason.message : 'Не удалось загрузить часть справочников')
      }
    })
    return () => { alive = false }
  }, [])

  // ── Валидация ──────────────────────────────────────────────────────────────

  const invalid = useMemo(() => {
    const dimsOk = requiresSize
      ? dims.every((b) => b.length.trim() && b.width.trim() && b.height.trim() && b.sizes.length > 0)
      : dims.every((b) => b.length.trim() && b.width.trim() && b.height.trim())
    return {
      name:       !name.trim(),
      type_id:    !typeId,
      sku_base:   !skuPending && !skuBase.trim(),
      client_id:  !clientId,
      colors:     requiresColor && colorIds.length === 0,
      dimensions: !dimsOk,
    }
  }, [name, typeId, skuBase, skuPending, clientId, colorIds, dims, requiresColor, requiresSize])

  const touch = (key: FieldKey) => setTouched((t) => ({ ...t, [key]: true }))
  const err = (key: FieldKey) => touched[key] && invalid[key]

  // ── Фото drag & drop ──────────────────────────────────────────────────────

  const handlePhotoDragStart = useCallback((e: DragEvent, i: number) => {
    dragSrcRef.current = i; setDragSrcIdx(i); e.dataTransfer.effectAllowed = 'move'
  }, [])
  const handlePhotoDragOver = useCallback((e: DragEvent, i: number) => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverIdx(i)
  }, [])
  const handlePhotoDrop = useCallback((e: DragEvent, targetIdx: number) => {
    e.preventDefault()
    const src = dragSrcRef.current
    if (src === null || src === targetIdx) { dragSrcRef.current = null; setDragOverIdx(null); return }
    dragSrcRef.current = null; setDragSrcIdx(null); setDragOverIdx(null)
    const reorder = <T,>(arr: T[]) => { const n = [...arr]; const [x] = n.splice(src, 1); n.splice(targetIdx, 0, x!); return n }
    setImageFiles(reorder); setImagePreviews(reorder)
  }, [])
  const handlePhotoDragEnd = useCallback(() => { dragSrcRef.current = null; setDragSrcIdx(null); setDragOverIdx(null) }, [])

  function handleImages(files: FileList | null) {
    if (!files) return
    const arr = Array.from(files)
    setImageFiles((p) => [...p, ...arr])
    arr.forEach((f) => { const r = new FileReader(); r.onload = (ev) => setImagePreviews((p) => [...p, ev.target?.result as string]); r.readAsDataURL(f) })
  }

  // ── Отправка ──────────────────────────────────────────────────────────────

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setTouched({ name: true, type_id: true, sku_base: true, client_id: true, colors: true, dimensions: true })
    setSubmitError('')

    if (Object.values(invalid).some(Boolean)) {
      setSubmitError('Заполните все обязательные поля')
      return
    }
    if (requiresSize) {
      const dup = checkDuplicateCombos(dims, colorIds)
      if (dup) { setSubmitError(dup); return }
    }

    setSaving(true)
    try {
      await createProduct({
        meta: {
          product: {
            name: name.trim(),
            type_id: typeId!,
            sku_base: skuPending ? undefined : skuBase.trim(),
            sku_pending: skuPending,
            weight_grams: parseOptionalWeight(weightGrams),
            items_per_pallet: parseOptionalInteger(itemsPerPallet),
            client_id: clientId!,
            is_active: isActive,
          },
          colors: colorIds,
          dimensions: dims.map((d) => ({
            length: parseNum(d.length), width: parseNum(d.width), height: parseNum(d.height),
            sizes: requiresSize ? d.sizes : [],
          })),
        },
        images: imageFiles,
      })
      navigate('/dictionaries/products')
    } catch (ex) {
      setSubmitError(mapServerError(ex instanceof Error ? ex.message : 'Ошибка создания'))
      setSaving(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <FormPage
      title="Новый товар"
      backTo="/dictionaries/products"
      actions={
        <>
          <button type="button" className="btn ghost" onClick={() => navigate('/dictionaries/products')}>Отмена</button>
          <button type="submit" form="product-create-form" className="btn primary" disabled={saving}>
            {saving ? 'Создание…' : <><Icon name="check" size={14} />Создать товар</>}
          </button>
        </>
      }
    >
      <form id="product-create-form" onSubmit={handleSubmit} noValidate>
        {lookupError && (
          <Alert tone="warning" icon={false} style={{ marginBottom: 16 }}>{lookupError}</Alert>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>

          {/* ── Левая колонка ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-head"><div className="card-head-title">Основные данные</div></div>
              <div className="card-body">

                <Field label="Название" required>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => touch('name')}
                    placeholder="Название товара"
                    autoFocus
                    style={err('name') ? { borderColor: 'var(--c-danger)' } : undefined}
                  />
                  <ErrMsg msg={err('name') ? 'Обязательное поле' : undefined} />
                </Field>

                <Field label="SKU / штрих-код" required={!skuPending}>
                  <Input
                    value={skuPending ? '' : skuBase}
                    onChange={(e) => setSkuBase(e.target.value)}
                    onBlur={() => touch('sku_base')}
                    placeholder={skuPending ? 'Будет уточнён позже' : 'BASE-001'}
                    disabled={skuPending}
                    style={{ fontFamily: 'var(--font-code)', ...(err('sku_base') ? { borderColor: 'var(--c-danger)' } : {}) }}
                  />
                  <ErrMsg msg={err('sku_base') ? 'Обязательное поле' : undefined} />
                  <div style={{ marginTop: 8 }}>
                    <Toggle
                      checked={skuPending}
                      onChange={(v) => { setSkuPending(v); if (v) setSubmitError('') }}
                      label="SKU будет уточнён позже"
                    />
                  </div>
                </Field>

                <Field label="Тип товара" required>
                  <Combobox
                    value={typeId}
                    onChange={(v) => {
                      const newId = v ? String(v) : null
                      setTypeId(newId)
                      touch('type_id')
                      if (!productTypes.find((t) => t.id === newId)?.requires_size) {
                        setDims((prev) => prev.map((d) => ({ ...d, sizes: [] })))
                      }
                    }}
                    options={productTypes.map((t) => ({ value: t.id, label: t.name }))}
                    placeholder="Выберите тип…"
                    clearable
                  />
                  <ErrMsg msg={err('type_id') ? 'Выберите тип товара' : undefined} />
                </Field>

                <Field label="Клиент" required>
                  <Combobox
                    value={clientId}
                    onChange={(v) => { setClientId(v ? String(v) : null); touch('client_id') }}
                    options={clients}
                    placeholder="Выберите клиента…"
                    clearable
                  />
                  <ErrMsg msg={err('client_id') ? 'Выберите клиента' : undefined} />
                </Field>

                <Field label="Активен">
                  <Toggle checked={isActive} onChange={setIsActive} label="Товар активен" />
                </Field>
              </div>
            </div>

            {/* Фотографии */}
            <div className="card">
              <div className="card-head"><div className="card-head-title">Фотографии</div></div>
              <div className="card-body">
                <div className="row gap-8" style={{ flexWrap: 'wrap', marginBottom: 8, alignItems: 'flex-start' }}>
                  {imagePreviews.map((src, i) => (
                    <div
                      key={i}
                      draggable
                      onDragStart={(e) => handlePhotoDragStart(e, i)}
                      onDragOver={(e) => handlePhotoDragOver(e, i)}
                      onDrop={(e) => handlePhotoDrop(e, i)}
                      onDragEnd={handlePhotoDragEnd}
                      style={{
                        position: 'relative', width: 72, height: 72, borderRadius: 6, overflow: 'hidden',
                        border: dragOverIdx === i && dragSrcIdx !== i ? '2px solid var(--c-accent)' : '1px solid var(--c-border)',
                        opacity: dragSrcIdx === i ? 0.4 : 1,
                        cursor: 'grab', boxSizing: 'border-box', transition: 'opacity 0.15s, border-color 0.15s',
                      }}
                    >
                      <img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} alt="" />
                      <button
                        type="button"
                        className="product-photo-remove"
                        style={{ padding: '2px 4px', fontSize: 11 }}
                        onClick={() => { setImageFiles((p) => p.filter((_, j) => j !== i)); setImagePreviews((p) => p.filter((_, j) => j !== i)) }}
                      >✕</button>
                      {i === 0 && (
                        <div className="product-photo-main-badge">
                          ГЛАВНОЕ
                        </div>
                      )}
                    </div>
                  ))}
                  <button type="button" className="btn ghost sm" onClick={() => imgRef.current?.click()}>
                    <Icon name="upload" size={13} />Добавить фото
                  </button>
                </div>
                {imagePreviews.length > 1 && (
                  <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginBottom: 4 }}>
                    <Icon name="sort" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
                    Перетащите фото для изменения порядка. Первое — главное.
                  </div>
                )}
                <input ref={imgRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => handleImages(e.target.files)} />
              </div>
            </div>
          </div>

          {/* ── Правая колонка: цвета + габариты ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 16 }}>
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
                    onChange={(e) => setItemsPerPallet(e.target.value)}
                    style={{ fontFamily: 'var(--font-num)', fontVariantNumeric: 'tabular-nums', fontFeatureSettings: "'tnum' 1" }}
                  />
                </Field>
              </div>
            </div>

            {/* Цвета */}
            <div className="card" style={err('colors') ? { borderColor: 'var(--c-danger)' } : undefined}>
              <div className="card-head">
                <div className="card-head-title">
                  Цвета{requiresColor && <span style={{ color: 'var(--c-danger)', marginLeft: 3 }}>*</span>}
                  {!requiresColor && typeId && <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--c-text-muted)', marginLeft: 6 }}>не обязательно</span>}
                </div>
              </div>
              <div className="card-body">
                <MultiSelect
                  value={colorIds}
                  onChange={(vals) => { setColorIds(vals.map(String)); touch('colors') }}
                  options={colorOptions}
                  placeholder="Выберите цвета…"
                />
                <ErrMsg msg={err('colors') ? 'Выберите хотя бы один цвет' : undefined} />
              </div>
            </div>

            {/* Габариты и размеры */}
            <div className="card" style={err('dimensions') ? { borderColor: 'var(--c-danger)' } : undefined}>
              <div className="card-head">
                <div className="card-head-title">
                  Габариты{requiresSize ? ' и размеры' : ''} <span style={{ color: 'var(--c-danger)' }}>*</span>
                </div>
              </div>
              <div className="card-body">
                {dims.map((d, i) => {
                  const blockErr = touched.dimensions && (
                    requiresSize
                      ? (!d.length.trim() || !d.width.trim() || !d.height.trim() || d.sizes.length === 0)
                      : (!d.length.trim() || !d.width.trim() || !d.height.trim())
                  )
                  return (
                    <div
                      key={i}
                      style={{
                        paddingBottom: 14, marginBottom: i < dims.length - 1 ? 14 : 0,
                        borderBottom: i < dims.length - 1 ? '1px solid var(--c-border)' : 'none',
                        ...(blockErr ? { background: 'color-mix(in oklab, var(--c-danger) 4%, transparent)', borderRadius: 6, padding: 8 } : {}),
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--c-text-muted)' }}>
                          {dims.length > 1 ? `Блок ${i + 1}` : 'Блок'}
                        </span>
                        {dims.length > 1 && requiresSize && (
                          <button type="button" className="btn ghost icon sm" onClick={() => setDims((p) => p.filter((_, j) => j !== i))}>
                            <Icon name="trash" size={12} />
                          </button>
                        )}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: requiresSize ? 10 : 0 }}
                        onBlur={() => touch('dimensions')}>
                        {(['length', 'width', 'height'] as const).map((field, fi) => (
                          <Field key={field} label={['Д (см)', 'Ш (см)', 'В (см)'][fi]}>
                            <Input
                              type="number" min={0} step={0.01}
                              value={d[field]}
                              onChange={(e) => setDims((p) => p.map((b, j) => j === i ? { ...b, [field]: e.target.value } : b))}
                              style={touched.dimensions && !d[field].trim() ? { borderColor: 'var(--c-danger)' } : undefined}
                            />
                          </Field>
                        ))}
                      </div>

                      {requiresSize && (
                        <Field label="Размеры" required>
                          <MultiSelect
                            value={d.sizes}
                            onChange={(vals) => { setDims((p) => p.map((b, j) => j === i ? { ...b, sizes: vals.map(String) } : b)); touch('dimensions') }}
                            options={sizeOptions}
                            placeholder="Выберите размеры…"
                          />
                          {touched.dimensions && d.sizes.length === 0 && (
                            <ErrMsg msg="Выберите хотя бы один размер" />
                          )}
                        </Field>
                      )}
                    </div>
                  )
                })}

                {requiresSize && (
                  <button type="button" className="btn ghost sm" style={{ marginTop: 4 }}
                    onClick={() => setDims((p) => [...p, { length: '', width: '', height: '', sizes: [] }])}>
                    <Icon name="plus" size={13} />Добавить блок
                  </button>
                )}
                <ErrMsg msg={err('dimensions') && dims.every((b) => !b.length.trim() && !b.width.trim() && !b.height.trim()) ? 'Заполните габариты' : undefined} />
              </div>
            </div>
          </div>
        </div>

        {submitError && (
          <Alert tone="danger" icon={false} style={{ marginTop: 16 }}>{submitError}</Alert>
        )}
      </form>
    </FormPage>
  )
}
