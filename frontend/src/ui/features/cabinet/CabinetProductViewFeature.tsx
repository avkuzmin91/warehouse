import { useState } from 'react'
import { getCabinetProduct, getCabinetProductVariants } from '../../../api/cabinetApi'
import { resolvePublicUploadSrc } from '../../../api/constants'
import { useApi } from '../../../hooks/useApi'
import { Table, Td } from '../../data/Table'
import { Lightbox, type LightboxImage } from '../../feedback/Lightbox'
import { DetailPage } from '../../layouts/DetailPage'
import { Badge } from '../../primitives/Badge'
import { Card, CardBody, CardHead } from '../../primitives/Card'
import { EmptyState } from '../../primitives/EmptyState'
import { Icon } from '../../primitives/Icon'
import { Skeleton, SkeletonRows } from '../../primitives/Skeleton'
import { CellProg } from './shared/cabinetUI'

interface Props {
  productId: string
}

export function CabinetProductViewFeature({ productId }: Props) {
  const productState = useApi((signal) => getCabinetProduct(productId, signal), [productId])
  const variantsState = useApi((signal) => getCabinetProductVariants(productId, signal), [productId])
  const product = productState.data
  const variants = variantsState.data ?? []
  const title = product?.name ?? 'Товар клиента'
  const totalStock = variants.reduce((sum, v) => sum + v.stock, 0)
  const totalDefect = variants.reduce((sum, v) => sum + v.defect_qty, 0)
  const maxStock = Math.max(...variants.map((v) => v.stock), 1)

  const [mainIdx, setMainIdx] = useState(0)
  const [viewer, setViewer] = useState<{ images: LightboxImage[]; index: number } | null>(null)
  const images = product?.image_urls ?? []
  const activeIdx = mainIdx < images.length ? mainIdx : 0
  const mainImage = images[activeIdx]

  function openProductPhotos(index: number) {
    if (!product) return
    setViewer({
      images: images.map((u) => ({ src: resolvePublicUploadSrc(u), caption: product.name })),
      index,
    })
  }

  function openVariantPhotos(urls: string[], caption: string) {
    setViewer({
      images: urls.map((u) => ({ src: resolvePublicUploadSrc(u), caption })),
      index: 0,
    })
  }

  return (
    <DetailPage
      title={title}
      subtitle={product?.sku_base}
      backTo="/cabinet/products"
      actions={product && (
        <Badge tone={product.is_active ? 'success' : ''}>{product.is_active ? 'Активен' : 'Неактивен'}</Badge>
      )}
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
          <Card>
            <CardBody>
              <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 22, alignItems: 'start' }}>
                <div>
                  {mainImage ? (
                    <img
                      src={resolvePublicUploadSrc(mainImage)}
                      alt=""
                      className="img-zoom"
                      onClick={() => openProductPhotos(activeIdx)}
                      style={{ width: 220, aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 8, border: '1px solid var(--c-border)', display: 'block' }}
                    />
                  ) : (
                    <div className="cab-thumb" style={{ width: 220, aspectRatio: '1 / 1' }}>
                      <Icon name="fileImg" size={32} />
                    </div>
                  )}
                  {images.length > 1 && (
                    <div className="row gap-8" style={{ marginTop: 8, flexWrap: 'wrap', width: 220 }}>
                      {images.map((url, i) => (
                        <img
                          key={`${url}-${i}`}
                          src={resolvePublicUploadSrc(url)}
                          alt=""
                          onClick={() => setMainIdx(i)}
                          style={{
                            width: 44, height: 44, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', display: 'block',
                            border: i === activeIdx ? '2px solid var(--c-accent)' : '1px solid var(--c-border)',
                            opacity: i === activeIdx ? 1 : 0.7,
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                    <div>
                      <div className="t-sub">Тип</div>
                      <div style={{ fontWeight: 500 }}>{product.type_name ?? '—'}</div>
                    </div>
                    <div>
                      <div className="t-sub">Вариантов</div>
                      <div style={{ fontWeight: 500 }}>{product.variant_count.toLocaleString('ru-RU')}</div>
                    </div>
                    <div>
                      <div className="t-sub">Базовый SKU</div>
                      <div className="mono" style={{ fontWeight: 500 }}>{product.sku_base}</div>
                    </div>
                    <div>
                      <div className="t-sub">Вес</div>
                      <div style={{ fontWeight: 500 }}>{product.weight_grams == null ? '—' : `${product.weight_grams.toLocaleString('ru-RU')} г`}</div>
                    </div>
                    <div>
                      <div className="t-sub">В коробе</div>
                      <div style={{ fontWeight: 500 }}>{product.items_per_box == null ? '—' : `${product.items_per_box.toLocaleString('ru-RU')} шт`}</div>
                    </div>
                    <div>
                      <div className="t-sub">Коробов на палете</div>
                      <div style={{ fontWeight: 500 }}>{product.boxes_per_pallet == null ? '—' : `${product.boxes_per_pallet.toLocaleString('ru-RU')} кор`}</div>
                    </div>
                  </div>
                  <div className="mt-20" style={{ paddingTop: 16, borderTop: '1px solid var(--c-border)', display: 'flex', gap: 28 }}>
                    <div>
                      <div className="t-sub">Годный на складе</div>
                      <div style={{ fontSize: 22, fontWeight: 650, color: 'var(--c-success)', fontVariantNumeric: 'tabular-nums' }}>
                        {totalStock.toLocaleString('ru-RU')}
                        <span style={{ fontSize: 13, color: 'var(--c-text-subtle)', fontWeight: 500 }}> шт</span>
                      </div>
                    </div>
                    <div>
                      <div className="t-sub">Брак</div>
                      <div style={{ fontSize: 22, fontWeight: 650, color: 'var(--c-warning)', fontVariantNumeric: 'tabular-nums' }}>
                        {totalDefect.toLocaleString('ru-RU')}
                        <span style={{ fontSize: 13, color: 'var(--c-text-subtle)', fontWeight: 500 }}> шт</span>
                      </div>
                    </div>
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
                  <th style={{ width: 50 }}></th>
                  <th>SKU</th>
                  <th style={{ width: 110 }}>Цвет</th>
                  <th style={{ width: 90 }}>Размер</th>
                  <th style={{ width: 130 }}>Габариты, см</th>
                  <th style={{ textAlign: 'right', width: 200 }}>Годный</th>
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
                    const gallery = variant.images.length > 0 ? variant.images : (product.image_urls ?? [])
                    const image = gallery[0]
                    return (
                      <tr key={variant.id}>
                        <Td>
                          {image ? (
                            <img
                              src={resolvePublicUploadSrc(image)}
                              alt=""
                              className="img-zoom"
                              onClick={() => openVariantPhotos(gallery, variant.sku)}
                              style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--c-border)', display: 'block' }}
                            />
                          ) : (
                            <div className="cab-thumb" style={{ width: 34, height: 34 }}>
                              <Icon name="fileImg" size={13} />
                            </div>
                          )}
                        </Td>
                        <Td className="mono" style={{ fontSize: 12 }}>{variant.sku}</Td>
                        <Td>{variant.color_name ?? '—'}</Td>
                        <Td>{variant.size_name ?? '—'}</Td>
                        <Td className="mono" style={{ fontSize: 12 }}>
                          {variant.dimension.length} × {variant.dimension.width} × {variant.dimension.height}
                        </Td>
                        <Td className="num">
                          <div className="cellprog">
                            <span style={{ fontWeight: variant.stock > 0 ? 550 : 400, color: variant.stock > 0 ? 'var(--c-success)' : 'var(--c-text-faint)' }}>
                              {variant.stock.toLocaleString('ru-RU')}
                            </span>
                            <CellProg value={variant.stock} max={maxStock} color="var(--c-success)" />
                          </div>
                        </Td>
                        <Td className="num" style={{ color: variant.defect_qty > 0 ? 'var(--c-warning)' : 'var(--c-text-faint)' }}>
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

      {viewer && (
        <Lightbox images={viewer.images} initialIndex={viewer.index} onClose={() => setViewer(null)} />
      )}
    </DetailPage>
  )
}
