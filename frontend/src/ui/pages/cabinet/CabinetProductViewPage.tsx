import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getClientPortalProduct, getClientPortalProductVariants } from '../../../api/clientPortalApi'
import type { ProductItem, ProductVariantItem } from '../../../api/domainTypes'
import { DetailPage } from '../../layouts/DetailPage'
import { Badge } from '../../primitives/Badge'
import { Skeleton } from '../../primitives/Skeleton'
import { Icon } from '../../primitives/Icon'

export function CabinetProductViewPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [product, setProduct] = useState<ProductItem | null>(null)
  const [variants, setVariants] = useState<ProductVariantItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeImg, setActiveImg] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    Promise.all([
      getClientPortalProduct(id),
      getClientPortalProductVariants(id),
    ]).then(([p, v]) => {
      setProduct(p)
      setVariants(v)
      if (p.image_urls?.[0]) setActiveImg(p.image_urls[0])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [id])

  if (loading) return <div className="page"><Skeleton height={32} width="40%" /></div>
  if (!product) return (
    <div className="page">
      <div style={{ color: 'var(--c-text-subtle)' }}>Товар не найден</div>
      <button className="btn ghost sm" style={{ marginTop: 12 }} onClick={() => navigate('/cabinet/products')}>
        <Icon name="arrowLeft" size={13} />Назад
      </button>
    </div>
  )

  const images = product.image_urls ?? []

  return (
    <DetailPage title={product.name} subtitle={product.sku_base} backTo="/cabinet/products">
      <div style={{ display: 'grid', gridTemplateColumns: images.length ? '280px 1fr' : '1fr', gap: 24, alignItems: 'start', maxWidth: 860 }}>
        {images.length > 0 && (
          <div>
            <div style={{ width: '100%', height: 260, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--c-border)', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--c-surface-2, var(--c-surface))' }}>
              {activeImg && <img src={activeImg} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
            </div>
            {images.length > 1 && (
              <div className="row gap-6" style={{ flexWrap: 'wrap' }}>
                {images.map((url, i) => (
                  <img
                    key={i}
                    src={url}
                    alt=""
                    onClick={() => setActiveImg(url)}
                    style={{
                      width: 52, height: 52, objectFit: 'cover', borderRadius: 6,
                      border: `2px solid ${activeImg === url ? 'var(--c-accent)' : 'var(--c-border)'}`,
                      cursor: 'pointer',
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head"><div className="card-head-title">Информация</div></div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
              <div className="row gap-8" style={{ justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--c-text-subtle)' }}>Тип</span>
                <span>{product.type_name ?? '—'}</span>
              </div>
              <div className="row gap-8" style={{ justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--c-text-subtle)' }}>Базовый SKU</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{product.sku_base}</span>
              </div>
              <div className="row gap-8" style={{ justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--c-text-subtle)' }}>Вариантов</span>
                <span style={{ fontWeight: 600 }}>{product.variant_count}</span>
              </div>
              <div className="row gap-8" style={{ justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--c-text-subtle)' }}>Статус</span>
                <Badge tone={product.is_active ? 'success' : ''}>{product.is_active ? 'Активен' : 'Неактивен'}</Badge>
              </div>
            </div>
          </div>

          {variants.length > 0 && (
            <div className="card">
              <div className="card-head"><div className="card-head-title">Варианты</div></div>
              <div className="card-body" style={{ paddingTop: 0 }}>
                <div className="t-wrap">
                  <table className="t">
                    <thead>
                      <tr>
                        <th className="th">SKU</th>
                        <th className="th">Статус</th>
                      </tr>
                    </thead>
                    <tbody>
                      {variants.map((v) => (
                        <tr key={v.id}>
                          <td className="td" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{v.sku}</td>
                          <td className="td">
                            <Badge tone={v.is_active ? 'success' : ''}>{v.is_active ? 'Активен' : 'Неактивен'}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </DetailPage>
  )
}
