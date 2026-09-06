import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addProductBarcode, addProductBarcodeFile, deleteProduct, deleteProductBarcode, deleteProductBarcodeFile, getProduct, getProductVariants } from '../../../api/adminApi'
import { getWmsProductMpArticles, MARKETPLACE_LABELS } from '../../../api/marketplacesApi'
import { useBarcodeDupCheck, barcodeOwnerLabel } from './useBarcodeDupCheck'
import { usePrintBarcodeLabels } from '../shared/usePrintBarcodeLabels'
import type { ProductBarcodeFileItem, ProductBarcodeItem, ProductVariantItem } from '../../../api/domainTypes'
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
  const [variantsVersion, setVariantsVersion] = useState(0)
  const variantsState = useApi((signal) => getProductVariants(productId, signal), [productId, variantsVersion])
  const mpArticlesState = useApi((signal) => getWmsProductMpArticles(productId, signal), [productId])
  const product = productState.data
  const variants = variantsState.data ?? []
  const mpArticles = mpArticlesState.data?.items ?? []

  const [mainIdx, setMainIdx] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [bcTarget, setBcTarget] = useState<ProductVariantItem | null>(null)
  const [bcCode, setBcCode] = useState('')
  const [bcSource, setBcSource] = useState('')
  const [bcSaving, setBcSaving] = useState(false)
  const { owner: bcOwner } = useBarcodeDupCheck(bcTarget ? bcCode : '')

  function openAddBarcode(variant: ProductVariantItem) {
    setBcCode('')
    setBcSource('')
    setBcTarget(variant)
  }

  async function handleAddBarcode() {
    if (!bcTarget || !bcCode.trim() || bcSaving || bcOwner) return
    setBcSaving(true)
    try {
      await addProductBarcode(productId, { barcode: bcCode.trim(), source: bcSource.trim() || null, variant_id: bcTarget.id })
      toast('Штрих-код добавлен', 'success')
      setBcTarget(null)
      setVariantsVersion((v) => v + 1)
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
      setVariantsVersion((v) => v + 1)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось снять штрих-код', 'error')
    }
  }

  // Печатная форма ШК: площадки отдают только цифры, картинку рисуем сами.
  const { printLabels, printing } = usePrintBarcodeLabels()

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
      setVariantsVersion((v) => v + 1)
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
      setVariantsVersion((v) => v + 1)
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
            </CardBody>
          </Card>

          <Card>
            <CardHead>
              <Icon name="boxes" size={15} className="ic-accent" />
              <span className="card-head-title">Варианты</span>
              <div className="flex-1" />
              <span className="t-sub mono">{variants.length.toLocaleString('ru-RU')}</span>
            </CardHead>
            <input
              ref={labelInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              style={{ display: 'none' }}
              onChange={(e) => { void handleLabelSelected(e.target.files); e.target.value = '' }}
            />
            <Table>
              <thead>
                <tr>
                  <th style={{ width: 56 }}></th>
                  <th>SKU</th>
                  <th>Цвет</th>
                  <th>Размер</th>
                  <th>Габариты, см</th>
                  <th>Штрих-коды и этикетки</th>
                  <th style={{ textAlign: 'right', width: 100 }}>Годный</th>
                  <th style={{ textAlign: 'right', width: 90 }}>Брак</th>
                </tr>
              </thead>
              <tbody>
                {variantsState.loading ? (
                  <SkeletonRows rows={5} cols={8} />
                ) : variantsState.error ? (
                  <tr><Td colSpan={8}><EmptyState title="Не удалось загрузить варианты" sub={variantsState.error.message} /></Td></tr>
                ) : variants.length === 0 ? (
                  <tr><Td colSpan={8}><EmptyState title="Вариантов нет" sub="Добавьте варианты в режиме редактирования" /></Td></tr>
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
                          <Td>
                            <div className="col" style={{ gap: 4 }}>
                              {variant.barcodes.map((bc) => (
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
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--c-accent)', textDecoration: 'none', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
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
                                    title="Напечатать этикетку с этим кодом"
                                    disabled={printing}
                                    onClick={() => void printLabels([{
                                      product_id: productId,
                                      color_id: variant.color_id,
                                      size_id: variant.size_id,
                                      barcode: bc.barcode,
                                    }])}
                                    style={{ width: 22, height: 22 }}
                                  >
                                    <Icon name="print" size={12} />
                                  </button>
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
                              <div>
                                <button type="button" className="btn ghost icon sm" title="Добавить штрих-код" onClick={() => openAddBarcode(variant)}>
                                  <Icon name="plus" size={13} />
                                </button>
                              </div>
                            </div>
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
                      <Td colSpan={6} style={{ fontWeight: 500 }}>Итого</Td>
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

          {(mpArticles.length > 0 || mpArticlesState.error) && (
            <Card>
              <CardHead>
                <Icon name="tag" size={15} className="ic-accent" />
                <span className="card-head-title">Артикулы маркетплейсов</span>
                <div className="flex-1" />
                <span className="t-sub mono">{mpArticles.length.toLocaleString('ru-RU')}</span>
              </CardHead>
              {mpArticlesState.error ? (
                <CardBody>
                  <EmptyState title="Не удалось загрузить артикулы" sub={mpArticlesState.error.message} />
                </CardBody>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <th style={{ width: 170 }}>Артикул продавца</th>
                      <th style={{ width: 200 }}>Кабинет</th>
                      <th>Карточка маркетплейса</th>
                      <th style={{ width: 220 }}>Вариант WMS</th>
                      <th style={{ width: 190 }}>Связка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mpArticles.map((a) => (
                      <tr key={a.mp_product_id}>
                        <Td className="mono" style={{ fontWeight: 600 }}>{a.offer_id ?? '—'}</Td>
                        <Td>
                          {a.account_name}
                          <div className="t-sub" style={{ fontSize: 11.5 }}>{MARKETPLACE_LABELS[a.marketplace]}</div>
                        </Td>
                        <Td>
                          {a.title ?? '—'}
                          <div className="t-sub mono" style={{ fontSize: 11.5 }}>
                            {[a.external_id, a.external_color, a.external_size].filter(Boolean).join(' · ')}
                          </div>
                        </Td>
                        <Td>
                          {a.variant_id
                            ? ([a.color_name, a.size_name].filter(Boolean).join(' / ') || 'Вариант без цвета и размера')
                            : <span style={{ color: 'var(--c-text-subtle)' }}>Товар целиком</span>}
                        </Td>
                        <Td className="t-sub" style={{ fontSize: 12 }}>
                          {a.link_source === 'barcode_auto' ? 'Авто по ШК' : 'Вручную'}
                          {a.linked_by && ` · ${a.linked_by}`}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          )}
        </div>
      )}

      <Modal
        open={bcTarget !== null}
        onClose={() => setBcTarget(null)}
        title="Добавить штрих-код"
        subtitle={bcTarget ? `Вариант ${bcTarget.sku}${[bcTarget.color_name, bcTarget.size_name].filter(Boolean).length ? ` · ${[bcTarget.color_name, bcTarget.size_name].filter(Boolean).join(' / ')}` : ''}` : undefined}
        width={420}
        footer={
          <div className="row gap-8" style={{ justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={() => setBcTarget(null)}>Отмена</button>
            <button className="btn primary" disabled={!bcCode.trim() || bcSaving || !!bcOwner} onClick={() => void handleAddBarcode()}>
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
            {bcOwner && (
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--c-danger)', lineHeight: 1.5 }}>
                Код уже привязан: {barcodeOwnerLabel(bcOwner)}
                {bcOwner.product_id !== productId && (
                  <>
                    {' · '}
                    <a
                      href={`/dictionaries/products/${bcOwner.product_id}`}
                      onClick={(e) => { e.preventDefault(); navigate(`/dictionaries/products/${bcOwner.product_id}`) }}
                      style={{ color: 'var(--c-danger)', textDecoration: 'underline' }}
                    >
                      Открыть товар
                    </a>
                  </>
                )}
              </div>
            )}
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
