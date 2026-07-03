import { useEffect, useState } from 'react'
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
import { Skeleton, SkeletonRows } from '../../primitives/Skeleton'

const PAGE_SIZE = 24

export function CabinetProductsFeature() {
  const navigate = useNavigate()
  const [search, setSearch] = useFilterParam('search', '')
  const [view, setView] = useFilterParam('view', 'grid')
  const [page, setPage] = usePageParam()

  // Debounce поиска: инпут меняется мгновенно, URL и запрос — после паузы.
  // Sync-эффект подхватывает внешнюю смену URL («Сбросить», «Назад»).
  const [searchInput, setSearchInput] = useState(search)
  useEffect(() => { setSearchInput(search) }, [search])
  useEffect(() => {
    if (searchInput === search) return
    const timer = setTimeout(() => setSearch(searchInput), 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, search])

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
              style={{ paddingLeft: 28, width: 260, paddingRight: searchInput ? 26 : undefined }}
              placeholder="Название или SKU…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            {searchInput && (
              <button
                style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--c-text-subtle)' }}
                onClick={() => { setSearchInput(''); setSearch('') }}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
          <div className="flex-1" />
          <button className={`chip${view === 'grid' ? ' active' : ''}`} onClick={() => setView('grid')}>
            <Icon name="grid" size={12} />Плитка
          </button>
          <button className={`chip${view === 'list' ? ' active' : ''}`} onClick={() => setView('list')}>
            <Icon name="list" size={12} />Список
          </button>
        </FiltersBar>
      }
    >
      {error ? (
        <EmptyState title="Не удалось загрузить товары" sub={error.message} />
      ) : view === 'grid' ? (
        <>
          {loading ? (
            <div className="pgrid">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="pcard" style={{ cursor: 'default' }}>
                  <div className="pcard-img" />
                  <div className="pcard-body">
                    <Skeleton height={16} width="70%" />
                    <div className="mt-8"><Skeleton height={12} width="50%" /></div>
                  </div>
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState title="Товаров нет" sub="Доступные товары появятся после привязки к вашему клиенту" />
          ) : (
            <div className="pgrid">
              {items.map((product) => (
                <div key={product.id} className="pcard" onClick={() => navigate(`/cabinet/products/${product.id}`)}>
                  <div className="pcard-img">
                    {product.image_urls?.[0] ? (
                      <img src={resolvePublicUploadSrc(product.image_urls[0])} alt="" />
                    ) : (
                      <>
                        <Icon name="fileImg" size={26} />
                        <span className="ph-note">фото товара</span>
                      </>
                    )}
                  </div>
                  <div className="pcard-body">
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div className="pcard-name">{product.name}</div>
                      <Badge tone={product.is_active ? 'success' : ''}>{product.is_active ? 'Активен' : 'Неактивен'}</Badge>
                    </div>
                    <div className="pcard-meta">
                      <span className="mono t-sub">{product.sku_base}</span>
                      {product.type_name && (
                        <>
                          <span style={{ color: 'var(--c-text-faint)' }}>·</span>
                          <span className="t-sub">{product.type_name}</span>
                        </>
                      )}
                      <div className="flex-1" />
                      <span className="t-sub" style={{ fontWeight: 550, color: 'var(--c-text-muted)' }}>
                        {product.variant_count.toLocaleString('ru-RU')} вар.
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />
        </>
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
                        <div className="cab-thumb" style={{ width: 40, height: 40 }}>
                          <Icon name="fileImg" size={15} />
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
