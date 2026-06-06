import { useNavigate } from 'react-router-dom'
import { getCabinetProducts } from '../../../api/cabinetApi'
import { resolvePublicUploadSrc } from '../../../api/constants'
import { useApi } from '../../../hooks/useApi'
import { useFilterParam, usePageParam } from '../../../hooks/useFilterParams'
import { FiltersBar } from '../../data/FiltersBar'
import { Pagination } from '../../data/Pagination'
import { Table, Td } from '../../data/Table'
import { ListPage } from '../../layouts/ListPage'
import { Badge } from '../../primitives/Badge'
import { EmptyState } from '../../primitives/EmptyState'
import { Icon } from '../../primitives/Icon'
import { SkeletonRows } from '../../primitives/Skeleton'

const PAGE_SIZE = 20

export function CabinetProductsFeature() {
  const navigate = useNavigate()
  const [search, setSearch] = useFilterParam('search', '')
  const [page, setPage] = usePageParam()
  const { data, loading, error } = useApi(
    (signal) => getCabinetProducts({
      page,
      limit: PAGE_SIZE,
      search: search.trim() || undefined,
      sort: 'name_asc',
    }, signal),
    [page, search],
  )
  const items = data?.items ?? []

  return (
    <ListPage
      title="Мои товары"
      subtitle={loading ? 'Загрузка…' : `${data?.total ?? 0} товаров`}
      filters={
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 260, paddingRight: search ? 26 : undefined }}
              placeholder="Название или SKU…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--c-text-subtle)' }}
                onClick={() => setSearch('')}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
        </FiltersBar>
      }
    >
      {error ? (
        <EmptyState title="Не удалось загрузить товары" sub={error.message} />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <th style={{ width: 56 }}></th>
                <th>Название</th>
                <th>SKU</th>
                <th>Тип</th>
                <th style={{ textAlign: 'right', width: 120 }}>Варианты</th>
                <th style={{ width: 110 }}>Статус</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={8} cols={6} />
              ) : items.length === 0 ? (
                <tr><Td colSpan={6}><EmptyState title="Товаров нет" sub="Доступные товары появятся после привязки к вашему клиенту" /></Td></tr>
              ) : (
                items.map((product) => (
                  <tr key={product.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/cabinet/products/${product.id}`)}>
                    <Td>
                      {product.image_urls?.[0] ? (
                        <img src={resolvePublicUploadSrc(product.image_urls[0])} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--c-border)', display: 'block' }} />
                      ) : (
                        <div style={{ width: 40, height: 40, borderRadius: 6, background: 'var(--c-bg-sunken)', border: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name="box" size={16} style={{ color: 'var(--c-text-subtle)' }} />
                        </div>
                      )}
                    </Td>
                    <Td style={{ fontWeight: 500 }}>{product.name}</Td>
                    <Td className="mono" style={{ fontSize: 12 }}>{product.sku_base}</Td>
                    <Td style={{ fontSize: 12.5 }}>{product.type_name ?? '—'}</Td>
                    <Td className="num">{product.variant_count.toLocaleString('ru-RU')}</Td>
                    <Td>
                      <Badge tone={product.is_active ? 'success' : ''}>{product.is_active ? 'Активен' : 'Неактивен'}</Badge>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />
        </>
      )}
    </ListPage>
  )
}
