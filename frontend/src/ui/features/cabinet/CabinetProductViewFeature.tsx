import { getCabinetProduct, getCabinetProductVariants } from '../../../api/cabinetApi'
import { resolvePublicUploadSrc } from '../../../api/constants'
import { useApi } from '../../../hooks/useApi'
import { Table, Td } from '../../data/Table'
import { DetailPage } from '../../layouts/DetailPage'
import { Badge } from '../../primitives/Badge'
import { Card, CardBody, CardHead } from '../../primitives/Card'
import { EmptyState } from '../../primitives/EmptyState'
import { Icon } from '../../primitives/Icon'
import { Skeleton, SkeletonRows } from '../../primitives/Skeleton'

interface Props {
  productId: string
}

export function CabinetProductViewFeature({ productId }: Props) {
  const productState = useApi((signal) => getCabinetProduct(productId, signal), [productId])
  const variantsState = useApi((signal) => getCabinetProductVariants(productId, signal), [productId])
  const product = productState.data
  const variants = variantsState.data ?? []
  const title = product?.name ?? 'Товар клиента'

  return (
    <DetailPage title={title} subtitle={product?.sku_base} backTo="/cabinet/products">
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
          <Card>
            <CardHead>
              <Icon name="box" size={15} className="ic-accent" />
              <span className="card-head-title">Карточка товара</span>
              <div className="flex-1" />
              <Badge tone={product.is_active ? 'success' : ''}>{product.is_active ? 'Активен' : 'Неактивен'}</Badge>
            </CardHead>
            <CardBody>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 18, alignItems: 'start' }}>
                <div style={{ maxWidth: 240 }}>
                  {product.image_urls?.[0] ? (
                    <img src={resolvePublicUploadSrc(product.image_urls[0])} alt="" style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 8, border: '1px solid var(--c-border)', display: 'block' }} />
                  ) : (
                    <div style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 8, background: 'var(--c-bg-sunken)', border: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="box" size={28} style={{ color: 'var(--c-text-subtle)' }} />
                    </div>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
                  <Info label="Название" value={product.name} />
                  <Info label="Базовый SKU" value={product.sku_base} mono />
                  <Info label="Тип" value={product.type_name ?? '—'} />
                  <Info label="Вариантов" value={product.variant_count.toLocaleString('ru-RU')} />
                  <Info label="Вес" value={product.weight_grams == null ? '—' : `${product.weight_grams.toLocaleString('ru-RU')} г`} />
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
                  <th>Габариты</th>
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
                  <tr><Td colSpan={7}><EmptyState title="Вариантов нет" sub="У товара пока нет активных вариантов" /></Td></tr>
                ) : (
                  variants.map((variant) => {
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
                          {variant.dimension.length} x {variant.dimension.width} x {variant.dimension.height}
                        </Td>
                        <Td className="num" style={{ color: variant.stock > 0 ? 'var(--c-success)' : undefined, fontWeight: variant.stock > 0 ? 500 : undefined }}>
                          {variant.stock.toLocaleString('ru-RU')}
                        </Td>
                        <Td className="num" style={{ color: variant.defect_qty > 0 ? 'var(--c-warning)' : undefined, fontWeight: variant.defect_qty > 0 ? 500 : undefined }}>
                          {variant.defect_qty.toLocaleString('ru-RU')}
                        </Td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </Table>
          </Card>
        </div>
      )}
    </DetailPage>
  )
}

function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ color: 'var(--c-text-subtle)', fontSize: 12, marginBottom: 4 }}>{label}</div>
      <div className={mono ? 'mono' : undefined} style={{ fontWeight: 500 }}>{value}</div>
    </div>
  )
}
