import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addProductBarcode, addProductBarcodeFile, deleteProduct, deleteProductBarcode, deleteProductBarcodeFile, getProduct, getProductBarcodes, getProductVariants } from '../../../api/adminApi'
import type { ProductBarcodeFileItem, ProductBarcodeItem } from '../../../api/domainTypes'
import { resolvePublicUploadSrc } from '../../../api/constants'
import { useApi } from '../../../hooks/useApi'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { Table, Td } from '../../data/Table'
import { DetailPage } from '../../layouts/DetailPage'
import { Modal } from '../../feedback/Modal'
import { useConfirm } from '../../feedback/ConfirmDialog'
import { useToast } from '../../feedback/Toast'
import { Badge } from '../../primitives/Badge'
import { Card, CardBody, CardHead } from '../../primitives/Card'
import { EmptyState } from '../../primitives/EmptyState'
import { Icon } from '../../primitives/Icon'
import { Skeleton, SkeletonRows } from '../../primitives/Skeleton'

interface Props {
  productId: string
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginBottom: 2 }}>{label}</div>
      <div className={mono ? 'mono' : undefined} style={{ fontSize: 13.5 }}>{value}</div>
    </div>
  )
}

function MetricTile({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="card" style={{ padding: '12px 16px' }}>
      <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginBottom: 2 }}>{label}</div>
      <div className="num" style={{ fontSize: 22, fontWeight: 600, color }}>{value.toLocaleString('ru-RU')}</div>
    </div>
  )
}

export function ProductViewFeature({ productId }: Props) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const toast = useToast()
  const { user } = useCurrentUser()
  const isAdmin = user?.role === 'admin'
  const productState = useApi((signal) => getProduct(productId, signal), [productId])
  const variantsState = useApi((signal) => getProductVariants(productId, signal), [productId])
  const [barcodesVersion, setBarcodesVersion] = useState(0)
  const barcodesState = useApi((signal) => getProductBarcodes(productId, signal), [productId, barcodesVersion])
  const product = productState.data
  const variants = variantsState.data ?? []
  const barcodes = barcodesState.data ?? []

  const [mainIdx, setMainIdx] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [bcOpen, setBcOpen] = useState(false)
  const [bcCode, setBcCode] = useState('')
  const [bcSource, setBcSource] = useState('')
  const [bcSaving, setBcSaving] = useState(false)

  function openAddBarcode() {
    setBcCode('')
    setBcSource('')
    setBcOpen(true)
  }

  async function handleAddBarcode() {
    if (!bcOpen || !bcCode.trim() || bcSaving) return
    setBcSaving(true)
    try {
      await addProductBarcode(productId, { barcode: bcCode.trim(), source: bcSource.trim() || null })
      toast('Штрих-код добавлен', 'success')
      setBcOpen(false)
      setBarcodesVersion((v) => v + 1)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось добавить штрих-код', 'error')
    } finally {
      setBcSaving(false)
    }
  }

  async function handleDeleteBarcode(bc: ProductBarcodeItem) {
    const ok = await confirm({
      title: 'Снять штрих-код?',
      body: `Код ${bc.barcode} перестанет опознавать этот товар при сканировании.${bc.files.length > 0 ? ' Его этикетки тоже будут удалены из карточки.' : ''}`,
      danger: true,
      confirmLabel: 'Снять',
    })
    if (!ok) return
    try {
      await deleteProductBarcode(productId, bc.id)
      toast('Штрих-код снят', 'success')
      setBarcodesVersion((v) => v + 1)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось снять штрих-код', 'error')
    }
  }

  // Этикетки кода (PDF/фото ШК) в карточке — их подтягивают задачи упаковки.
  const labelInputRef = useRef<HTMLInputElement>(null)
  const labelTargetRef = useRef<string | null>(null)
  const [labelUploading, setLabelUploading] = useState(false)

  function pickLabelFile(barcodeId: string) {
    labelTargetRef.current = barcodeId
    labelInputRef.current?.click()
  }

  async function handleLabelSelected(files: FileList | null) {
    const barcodeId = labelTargetRef.current
    labelTargetRef.current = null
    const file = files?.[0]
    if (!barcodeId || !file) return
    setLabelUploading(true)
    try {
      await addProductBarcodeFile(productId, barcodeId, file)
      toast('Этикетка сохранена', 'success')
      setBarcodesVersion((v) => v + 1)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось сохранить этикетку', 'error')
    } finally {
      setLabelUploading(false)
    }
  }

  async function handleDeleteLabel(bc: ProductBarcodeItem, file: ProductBarcodeFileItem) {
    const ok = await confirm({
      title: 'Удалить этикетку?',
      body: `Файл «${file.filename}» будет удалён из карточки товара. В задачах, куда он уже прикреплён, файл останется.`,
      danger: true,
      confirmLabel: 'Удалить',
    })
    if (!ok) return
    try {
      await deleteProductBarcodeFile(productId, bc.id, file.id)
      toast('Этикетка удалена', 'success')
      setBarcodesVersion((v) => v + 1)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось удалить этикетку', 'error')
    }
  }

  async function handleDelete() {
    if (!product) return
    const ok = await confirm({
      title: 'Удалить товар?',
      body: `Товар «${product.name}» будет удалён без возможности восстановления. Удаление возможно, только если товар не использовался в поступлениях и никогда не был на остатках.`,
      danger: true,
      confirmLabel: 'Удалить',
    })
    if (!ok) return
    setDeleting(true)
    try {
      await deleteProduct(productId)
      toast('Товар удалён', 'success')
      navigate('/dictionaries/products')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось удалить товар', 'error')
    } finally {
      setDeleting(false)
    }
  }

  const images = product?.image_urls ?? []
  const mainImage = images[mainIdx] ?? images[0] ?? null

  function showPrevImage() {
    setMainIdx((prev) => (images.length === 0 ? prev : prev === 0 ? images.length - 1 : prev - 1))
  }

  function showNextImage() {
    setMainIdx((prev) => (images.length === 0 ? prev : prev === images.length - 1 ? 0 : prev + 1))
  }

  return (
    <DetailPage
      title={product?.name ?? 'Товар'}
      subtitle={product?.sku_base}
      backTo="/dictionaries/products"
      actions={
        product ? (
          <>
            {product.sku_pending && <Badge tone="warning">Ожидает SKU</Badge>}
            <Badge tone={product.is_active ? 'success' : ''}>{product.is_active ? 'Активен' : 'Архив'}</Badge>
            {isAdmin && (
              <button className="btn ghost danger" onClick={handleDelete} disabled={deleting}>
                <Icon name="trash" size={14} />Удалить
              </button>
            )}
            <button className="btn primary" onClick={() => navigate(`/dictionaries/products/${productId}/edit`)}>
              <Icon name="edit" size={14} />Редактировать
            </button>
          </>
        ) : undefined
      }
    >
      {productState.error ? (
        <EmptyState title="Не удалось загрузить товар" sub={productState.error.message} />
      ) : productState.loading || !product ? (
        <Card>
          <CardBody>
            <div className="col gap-16">
              <Skeleton height={22} width="40%" />
              <Skeleton height={120} />
              <Skeleton height={18} width="70%" />
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="col gap-16">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <MetricTile label="На складе, шт" value={product.stock_total} color={product.stock_total > 0 ? 'var(--c-success)' : 'var(--c-text-faint)'} />
            <MetricTile label="Брак, шт" value={product.defect_total} color={product.defect_total > 0 ? 'var(--c-warning)' : 'var(--c-text-faint)'} />
            <MetricTile label="Вариантов" value={product.variant_count} />
          </div>

          <Card>
            <CardHead>
              <Icon name="box" size={15} className="ic-accent" />
              <span className="card-head-title">Карточка товара</span>
            </CardHead>
            <CardBody>
              <div style={{ display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
                <div>
                  {mainImage ? (
                    <img
                      src={resolvePublicUploadSrc(mainImage)}
                      alt=""
                      onClick={() => setFullscreen(true)}
                      style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 8, border: '1px solid var(--c-border)', display: 'block', cursor: 'zoom-in' }}
                    />
                  ) : (
                    <div style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 8, background: 'var(--c-bg-sunken)', border: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="box" size={28} style={{ color: 'var(--c-text-subtle)' }} />
                    </div>
                  )}
                  {images.length > 1 && (
                    <div className="row gap-8" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                      {images.map((url, i) => (
                        <img
                          key={`${url}-${i}`}
                          src={resolvePublicUploadSrc(url)}
                          alt=""
                          onClick={() => setMainIdx(i)}
                          style={{
                            width: 44, height: 44, objectFit: 'cover', borderRadius: 6, cursor: 'pointer',
                            border: i === mainIdx ? '2px solid var(--c-accent)' : '1px solid var(--c-border)',
                            boxSizing: 'border-box',
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
                  <Info label="Тип" value={product.type_name ?? '—'} />
                  <Info label="Клиент" value={product.client_name ?? '—'} />
                  <Info label="Базовый SKU" value={product.sku_pending ? 'Ожидает уточнения' : product.sku_base} mono={!product.sku_pending} />
                  <Info label="Вес" value={product.weight_grams == null ? '—' : `${product.weight_grams.toLocaleString('ru-RU')} г`} />
                  <Info label="В коробе" value={product.items_per_box == null ? '—' : `${product.items_per_box.toLocaleString('ru-RU')} шт`} />
                  <Info label="Коробов на палете" value={product.boxes_per_pallet == null ? '—' : `${product.boxes_per_pallet.toLocaleString('ru-RU')} кор`} />
                  <Info label="Вариантов" value={product.variant_count.toLocaleString('ru-RU')} />
                </div>
              </div>
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--c-border)' }}>
                <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginBottom: 6 }}>Штрих-коды и этикетки</div>
                <input
                  ref={labelInputRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  style={{ display: 'none' }}
                  onChange={(e) => { void handleLabelSelected(e.target.files); e.target.value = '' }}
                />
                <div className="col" style={{ gap: 6 }}>
                  {barcodes.map((bc) => (
                    <div key={bc.id} className="row gap-8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                      <span
                        className="mono"
                        title={bc.source ?? undefined}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '2px 6px', borderRadius: 6, background: 'var(--c-bg-sunken)', border: '1px solid var(--c-border)' }}
                      >
                        {bc.barcode}
                        <button
                          type="button"
                          title="Снять штрих-код"
                          onClick={() => void handleDeleteBarcode(bc)}
                          style={{ display: 'inline-flex', padding: 0, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--c-text-subtle)' }}
                        >
                          <Icon name="x" size={12} />
                        </button>
                      </span>
                      {bc.files.map((f) => (
                        <span key={f.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                          <a
                            href={resolvePublicUploadSrc(f.url)}
                            target="_blank"
                            rel="noreferrer"
                            title={f.filename}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--c-accent)', textDecoration: 'none', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          >
                            <Icon name="file" size={12} />{f.filename}
                          </a>
                          <button
                            type="button"
                            title="Удалить этикетку"
                            onClick={() => void handleDeleteLabel(bc, f)}
                            style={{ display: 'inline-flex', padding: 0, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--c-text-faint)' }}
                          >
                            <Icon name="x" size={11} />
                          </button>
                        </span>
                      ))}
                      <button
                        type="button"
                        className="btn ghost icon sm"
                        title="Прикрепить этикетку (PDF, PNG, JPG)"
                        disabled={labelUploading}
                        onClick={() => pickLabelFile(bc.id)}
                        style={{ width: 22, height: 22 }}
                      >
                        <Icon name="importFile" size={12} />
                      </button>
                    </div>
                  ))}
                  <div className="row gap-8" style={{ alignItems: 'center' }}>
                    {barcodes.length === 0 && <span className="t-sub">Нет штрих-кодов</span>}
                    <button type="button" className="btn ghost icon sm" title="Добавить штрих-код" onClick={openAddBarcode}>
                      <Icon name="plus" size={13} />
                    </button>
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHead>
              <Icon name="boxes" size={15} className="ic-accent" />
              <span className="card-head-title">Варианты</span>
              <div className="flex-1" />
              <span className="t-sub mono">{variants.length.toLocaleString('ru-RU')}</span>
            </CardHead>
            <Table>
              <thead>
                <tr>
                  <th style={{ width: 56 }}></th>
                  <th>SKU</th>
                  <th>Цвет</th>
                  <th>Размер</th>
                  <th>Габариты, см</th>
                  <th style={{ textAlign: 'right', width: 100 }}>Годный</th>
                  <th style={{ textAlign: 'right', width: 90 }}>Брак</th>
                </tr>
              </thead>
              <tbody>
                {variantsState.loading ? (
                  <SkeletonRows rows={5} cols={7} />
                ) : variantsState.error ? (
                  <tr><Td colSpan={7}><EmptyState title="Не удалось загрузить варианты" sub={variantsState.error.message} /></Td></tr>
                ) : variants.length === 0 ? (
                  <tr><Td colSpan={7}><EmptyState title="Вариантов нет" sub="Добавьте варианты в режиме редактирования" /></Td></tr>
                ) : (
                  <>
                    {variants.map((variant) => {
                      const image = variant.images[0] ?? product.image_urls?.[0]
                      return (
                        <tr key={variant.id}>
                          <Td>
                            {image ? (
                              <img src={resolvePublicUploadSrc(image)} alt="" style={{ width: 38, height: 38, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--c-border)', display: 'block' }} />
                            ) : (
                              <div style={{ width: 38, height: 38, borderRadius: 6, background: 'var(--c-bg-sunken)', border: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Icon name="box" size={15} style={{ color: 'var(--c-text-subtle)' }} />
                              </div>
                            )}
                          </Td>
                          <Td className="mono" style={{ fontSize: 12 }}>{variant.sku}</Td>
                          <Td>{variant.color_name ?? '—'}</Td>
                          <Td>{variant.size_name ?? '—'}</Td>
                          <Td className="mono" style={{ fontSize: 12 }}>
                            {variant.dimension.length}×{variant.dimension.width}×{variant.dimension.height}
                          </Td>
                          <Td className="num" style={{ color: variant.stock > 0 ? 'var(--c-success)' : undefined, fontWeight: variant.stock > 0 ? 500 : undefined }}>
                            {variant.stock.toLocaleString('ru-RU')}
                          </Td>
                          <Td className="num" style={{ color: variant.defect_qty > 0 ? 'var(--c-warning)' : undefined, fontWeight: variant.defect_qty > 0 ? 500 : undefined }}>
                            {variant.defect_qty.toLocaleString('ru-RU')}
                          </Td>
                        </tr>
                      )
                    })}
                    <tr>
                      <Td colSpan={5} style={{ fontWeight: 500 }}>Итого</Td>
                      <Td className="num" style={{ fontWeight: 500 }}>
                        {variants.reduce((s, v) => s + v.stock, 0).toLocaleString('ru-RU')}
                      </Td>
                      <Td className="num" style={{ fontWeight: 500 }}>
                        {variants.reduce((s, v) => s + v.defect_qty, 0).toLocaleString('ru-RU')}
                      </Td>
                    </tr>
                  </>
                )}
              </tbody>
            </Table>
          </Card>
        </div>
      )}

      <Modal
        open={bcOpen}
        onClose={() => setBcOpen(false)}
        title="Добавить штрих-код"
        subtitle={product ? product.name : undefined}
        width={420}
        footer={
          <div className="row gap-8" style={{ justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={() => setBcOpen(false)}>Отмена</button>
            <button className="btn primary" disabled={!bcCode.trim() || bcSaving} onClick={() => void handleAddBarcode()}>
              {bcSaving ? 'Добавление…' : 'Добавить'}
            </button>
          </div>
        }
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginBottom: 4 }}>Штрих-код</div>
            <input
              className="input sm mono"
              value={bcCode}
              onChange={(e) => setBcCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleAddBarcode() }}
              placeholder="Отсканируйте или введите код"
              autoFocus
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginBottom: 4 }}>Источник (необязательно)</div>
            <input
              className="input sm"
              value={bcSource}
              onChange={(e) => setBcSource(e.target.value)}
              placeholder="Ozon, WB, производитель…"
            />
          </div>
        </div>
      </Modal>

      <Modal open={fullscreen && mainImage !== null} onClose={() => setFullscreen(false)} width={960}>
        {mainImage && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, minHeight: 320 }}>
            {images.length > 1 && (
              <button type="button" className="btn ghost icon" onClick={showPrevImage} title="Предыдущее фото">
                <Icon name="arrowLeft" size={18} />
              </button>
            )}
            <img
              src={resolvePublicUploadSrc(mainImage)}
              alt=""
              style={{ maxWidth: '100%', maxHeight: 'calc(100vh - 180px)', objectFit: 'contain', display: 'block' }}
            />
            {images.length > 1 && (
              <button type="button" className="btn ghost icon" onClick={showNextImage} title="Следующее фото">
                <Icon name="arrowRight" size={18} />
              </button>
            )}
          </div>
        )}
      </Modal>
    </DetailPage>
  )
}
