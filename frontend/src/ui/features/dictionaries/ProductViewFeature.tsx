import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { deleteProduct, getProduct, getProductVariants } from '../../../api/adminApi'
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
  const product = productState.data
  const variants = variantsState.data ?? []

  const [mainIdx, setMainIdx] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [deleting, setDeleting] = useState(false)

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
                  <Info label="Базовый SKU" value={product.sku_base} mono />
                  <Info label="Вес" value={product.weight_grams == null ? '—' : `${product.weight_grams.toLocaleString('ru-RU')} г`} />
                  <Info label="На паллете" value={product.items_per_pallet == null ? '—' : `${product.items_per_pallet.toLocaleString('ru-RU')} шт`} />
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
