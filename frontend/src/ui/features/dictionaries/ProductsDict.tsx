import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getProducts, getProductVariants } from '../../../api/adminApi'
import { getInventoryProductTypes } from '../../../api/inventoryLookupsApi'
import { resolvePublicUploadSrc } from '../../../api/constants'
import type { ProductItem, ProductVariantItem, InventoryProductTypeLookup } from '../../../api/domainTypes'
import { useLookups } from '../../../hooks/useLookups'
import { Icon } from '../../primitives/Icon'
import { Badge } from '../../primitives/Badge'
import { EmptyState } from '../../primitives/EmptyState'
import { FiltersBar, FilterSelect, FilterCombobox } from '../../data/FiltersBar'
import { Pagination } from '../../data/Pagination'

const LIMIT = 20

function variantCountLabel(n: number) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} вариант`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} варианта`
  return `${n} вариантов`
}

const ACTUALITY_OPTIONS = [
  { value: '', label: 'Все' },
  { value: 'active', label: 'Активные' },
  { value: 'inactive', label: 'Неактивные' },
]

const SKU_OPTIONS = [
  { value: '', label: 'Все' },
  { value: 'pending', label: 'Без SKU' },
  { value: 'assigned', label: 'С SKU' },
]

interface ProductsDictProps {
  refreshKey: number
  visible: boolean
}

export function ProductsDict({ refreshKey, visible }: ProductsDictProps) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [products, setProducts] = useState<ProductItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  // Фильтры живут в state (панель остаётся смонтированной при переключении
  // вкладок справочника), но зеркалятся в URL, пока вкладка «Товары» активна —
  // возврат с карточки товара («назад») их восстанавливает.
  const initParam = (key: string) => (visible ? searchParams.get(key) ?? '' : '')
  const [search, setSearch] = useState(() => initParam('search'))
  const [typeId, setTypeId] = useState(() => initParam('ptype'))
  const [clientId, setClientId] = useState(() => initParam('client'))
  const [actuality, setActuality] = useState(() => initParam('status'))
  const [skuState, setSkuState] = useState(() => initParam('sku'))
  const [page, setPage] = useState(() => (visible ? Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1) : 1))

  useEffect(() => {
    if (!visible) return
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        const setOrDel = (key: string, v: string) => { if (v) next.set(key, v); else next.delete(key) }
        setOrDel('search', search)
        setOrDel('ptype', typeId)
        setOrDel('client', clientId)
        setOrDel('status', actuality)
        setOrDel('sku', skuState)
        setOrDel('page', page > 1 ? String(page) : '')
        return next
      },
      { replace: true },
    )
  }, [visible, search, typeId, clientId, actuality, skuState, page, setSearchParams])

  const [productTypes, setProductTypes] = useState<InventoryProductTypeLookup[]>([])
  const { clients } = useLookups()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [variants, setVariants] = useState<ProductVariantItem[]>([])
  const [variantsLoading, setVariantsLoading] = useState(false)

  useEffect(() => {
    getInventoryProductTypes().then(setProductTypes).catch(() => {})
  }, [])

  const load = useCallback(async (q: string, tid: string, cid: string, act: string, skuSt: string, pg: number) => {
    setLoading(true)
    try {
      const actuality_id = act === 'active' ? 'active' : act === 'inactive' ? 'inactive' : undefined
      const sku_pending = skuSt === 'pending' ? true : skuSt === 'assigned' ? false : undefined
      const res = await getProducts({
        page: pg,
        limit: LIMIT,
        search: q || undefined,
        type_id: tid || undefined,
        client_id: cid || undefined,
        actuality_id,
        sku_pending,
      })
      setProducts(res.items)
      setTotal(res.total)
    } finally {
      setLoading(false)
    }
  }, [])

  // Debounce search; immediate on filter changes
  useEffect(() => {
    const timer = setTimeout(() => load(search, typeId, clientId, actuality, skuState, page), search ? 250 : 0)
    return () => clearTimeout(timer)
  }, [search, typeId, clientId, actuality, skuState, page, load, refreshKey])

  // Reset to page 1 when filters change (не при монтировании — page восстановлен из URL)
  const filtersMounted = useRef(false)
  useEffect(() => {
    if (!filtersMounted.current) { filtersMounted.current = true; return }
    setPage(1)
  }, [search, typeId, clientId, actuality, skuState])

  useEffect(() => {
    if (!selectedId) { setVariants([]); return }
    setVariantsLoading(true)
    getProductVariants(selectedId)
      .then(setVariants)
      .catch(() => setVariants([]))
      .finally(() => setVariantsLoading(false))
  }, [selectedId])

  const selectedProduct = selectedId ? products.find((p) => p.id === selectedId) : null

  const typeOptions = [
    { value: '', label: 'Все типы' },
    ...productTypes.map((t) => ({ value: t.id, label: t.name })),
  ]
  const clientOptions = [
    { value: '', label: 'Все клиенты' },
    ...clients.map((c) => ({ value: c.id, label: c.name })),
  ]

  const hasFilters = !!(search || typeId || clientId || actuality || skuState)

  return (
    <div>
      {/* ── Filters ── */}
      <FiltersBar>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
          <input
            className="input sm"
            style={{ paddingLeft: 28, width: 220 }}
            placeholder="SKU, штрих-код или название…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          />
        </div>
        <FilterCombobox label="Тип" value={typeId} options={typeOptions} onChange={(v) => { setTypeId(v); setPage(1) }} placeholder="Поиск типа…" />
        <FilterCombobox label="Клиент" value={clientId} options={clientOptions} onChange={(v) => { setClientId(v); setPage(1) }} placeholder="Поиск клиента…" />
        <FilterSelect label="Статус" value={actuality} options={ACTUALITY_OPTIONS} onChange={(v) => { setActuality(v); setPage(1) }} />
        <FilterSelect label="SKU" value={skuState} options={SKU_OPTIONS} onChange={(v) => { setSkuState(v); setPage(1) }} />
        {hasFilters && (
          <button className="btn ghost sm" onClick={() => { setSearch(''); setTypeId(''); setClientId(''); setActuality(''); setSkuState(''); setPage(1) }}>
            <Icon name="x" size={12} />Сбросить
          </button>
        )}
      </FiltersBar>

      {/* ── Split view ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>
        {/* Left: table */}
        <div>
          <div className="t-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th style={{ width: 50 }}></th>
                  <th>Товар · SKU</th>
                  <th style={{ width: 130 }}>Тип</th>
                  <th style={{ width: 140 }}>Клиент</th>
                  <th style={{ width: 80, textAlign: 'right' }}>Годный</th>
                  <th style={{ width: 64, textAlign: 'right' }}>Брак</th>
                  <th style={{ width: 90 }}>Статус</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24 }}>
                    <span className="text-sm muted">Загрузка…</span>
                  </td></tr>
                ) : products.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding: 32 }}>
                    <EmptyState
                      title="Товары не найдены"
                      sub={hasFilters ? 'Попробуйте изменить фильтры' : 'Добавьте первый товар'}
                    />
                  </td></tr>
                ) : (
                  products.map((p) => (
                    <tr
                      key={p.id}
                      style={{ cursor: 'pointer', background: selectedId === p.id ? 'var(--c-bg-sunken)' : undefined }}
                      onClick={() => navigate(`/dictionaries/products/${p.id}`)}
                    >
                      <td>
                        <div style={{
                          width: 36, height: 36, borderRadius: 6,
                          background: 'var(--c-bg-sunken)', border: '1px solid var(--c-border)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          overflow: 'hidden',
                        }}>
                          {p.image_urls?.[0]
                            ? <img src={resolvePublicUploadSrc(p.image_urls[0])} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : <Icon name="box" size={14} style={{ color: 'var(--c-text-faint)' }} />}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 450 }}>{p.name}</div>
                        <div className="text-xs subtle">
                          {p.sku_pending
                            ? <Badge tone="warning">Без SKU</Badge>
                            : <span className="mono">{p.sku_base}</span>}
                          {' · '}{variantCountLabel(p.variant_count)}
                        </div>
                      </td>
                      <td>
                        {p.type_name && <Badge>{p.type_name}</Badge>}
                      </td>
                      <td className="text-sm">{p.client_name ?? <span className="faint">—</span>}</td>
                      <td className="num" style={p.stock_total > 0 ? { color: 'var(--c-success)', fontWeight: 500 } : { color: 'var(--c-text-faint)' }}>
                        {p.stock_total.toLocaleString('ru-RU')}
                      </td>
                      <td className="num">
                        {p.defect_total > 0
                          ? <span style={{ color: 'var(--c-warning)', fontWeight: 500 }}>{p.defect_total.toLocaleString('ru-RU')}</span>
                          : <span className="faint">—</span>}
                      </td>
                      <td>
                        <Badge tone={p.is_active ? 'success' : ''} dot>
                          {p.is_active ? 'Активен' : 'Архив'}
                        </Badge>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button
                          className="btn ghost icon sm"
                          title="Показать варианты"
                          onClick={() => setSelectedId(selectedId === p.id ? null : p.id)}
                        >
                          <Icon name="list" size={14} style={selectedId === p.id ? { color: 'var(--c-accent)' } : undefined} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={total} pageSize={LIMIT} onPage={setPage} />
        </div>

        {/* Right: variants panel — always rendered to avoid layout jump */}
        <div className="card" style={{ position: 'sticky', top: 16 }}>
          {!selectedProduct ? (
            <div style={{ padding: '40px 16px', textAlign: 'center' }}>
              <Icon name="list" size={22} style={{ color: 'var(--c-text-faint)', marginBottom: 10, display: 'block', margin: '0 auto 10px' }} />
              <div style={{ fontSize: 13, color: 'var(--c-text-subtle)', fontWeight: 450 }}>Варианты товара</div>
              <div style={{ fontSize: 12, color: 'var(--c-text-faint)', marginTop: 4 }}>Нажмите на иконку списка в строке товара</div>
            </div>
          ) : (
            <>
              <div className="card-head">
                <Icon name="list" size={15} style={{ color: 'var(--c-accent)' }} />
                <div className="card-head-title" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedProduct.name}
                </div>
                <button
                  className="btn ghost icon sm"
                  onClick={() => navigate(`/dictionaries/products/${selectedProduct.id}`)}
                  title="Открыть карточку товара"
                >
                  <Icon name="edit" size={14} />
                </button>
                <button
                  className="btn ghost icon sm"
                  onClick={() => setSelectedId(null)}
                  title="Снять выбор"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
              <div style={{ padding: '6px 14px 10px', borderBottom: '1px solid var(--c-border)', fontSize: 12, color: 'var(--c-text-subtle)' }}>
                {selectedProduct.sku_pending
                  ? <Badge tone="warning">Без SKU</Badge>
                  : <span className="mono">{selectedProduct.sku_base}</span>}
                {selectedProduct.client_name && <span style={{ marginLeft: 8 }}>{selectedProduct.client_name}</span>}
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                {variantsLoading ? (
                  <div style={{ padding: '20px 16px', textAlign: 'center' }}>
                    <span className="text-sm muted">Загрузка вариантов…</span>
                  </div>
                ) : variants.length === 0 ? (
                  <div style={{ padding: '20px 16px' }}>
                    <EmptyState title="Нет вариантов SKU" sub="Добавьте варианты в карточке товара" />
                  </div>
                ) : (
                  <table className="t">
                    <thead>
                      <tr>
                        <th>Цвет · Размер · Габариты</th>
                        <th style={{ width: 52, textAlign: 'right' }}>Год.</th>
                        <th style={{ width: 52, textAlign: 'right' }}>Брак</th>
                      </tr>
                    </thead>
                    <tbody>
                      {variants.map((v) => (
                        <tr key={v.id}>
                          <td className="text-sm">
                            <div>{v.color_name ?? <span className="faint">—</span>}
                              {v.size_name && <span className="badge" style={{ marginLeft: 6 }}>{v.size_name}</span>}
                            </div>
                            <div className="text-xs mono subtle">
                              {v.dimension.length}×{v.dimension.width}×{v.dimension.height} см
                            </div>
                          </td>
                          <td className="num">
                            <span className={`badge ${v.stock > 0 ? 'accent' : ''}`} style={{ height: 18 }}>
                              {v.stock}
                            </span>
                          </td>
                          <td className="num">
                            {v.defect_qty > 0
                              ? <span className="badge danger" style={{ height: 18 }}>{v.defect_qty}</span>
                              : <span className="faint text-xs">—</span>}
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <td className="text-sm" style={{ fontWeight: 500 }}>Итого</td>
                        <td className="num" style={{ fontWeight: 500 }}>
                          {variants.reduce((s, v) => s + v.stock, 0).toLocaleString('ru-RU')}
                        </td>
                        <td className="num" style={{ fontWeight: 500 }}>
                          {variants.reduce((s, v) => s + v.defect_qty, 0).toLocaleString('ru-RU')}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
