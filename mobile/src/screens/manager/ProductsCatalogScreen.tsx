import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNav } from '../../nav/NavContext'
import { useAuth } from '../../auth/AuthContext'
import { getProducts, type ProductLookup } from '../../api/lookupsApi'
import { AppBar } from '../../components/AppBar'
import { Icon } from '../../components/Icon'
import { PullToRefresh } from '../../components/PullToRefresh'
import { canCreateDocuments } from '../../utils/access'

export function ProductsCatalogScreen() {
  const { openProductNew, back } = useNav()
  const { user } = useAuth()
  const canCreate = canCreateDocuments(user?.role)

  const [items, setItems] = useState<ProductLookup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback((signal?: AbortSignal, silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    return getProducts(undefined, signal)
      .then((rows) => {
        if (signal?.aborted) return
        setItems(rows)
      })
      .catch((err) => {
        if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить товары')
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false)
      })
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    return () => ac.abort()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
  }, [items, search])

  return (
    <div className="screen">
      <AppBar title="Товары" sub="Справочник товаров" onBack={back} />
      <PullToRefresh className="scroll pad-nav" onRefresh={() => load(undefined, true)}>
        {canCreate && (
          <button className="btn" style={{ width: '100%', marginBottom: 12 }} onClick={openProductNew}>
            <Icon name="plus" size={16} /> Новый товар
          </button>
        )}

        <div className="field">
          <input
            className="input"
            type="text"
            placeholder="Поиск по названию или SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {error && (
          <div className="alert">
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}

        {loading ? (
          <div className="center">
            <div className="spin" />
            <div>Загрузка…</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="center">
            <div className="center-ico">
              <Icon name="boxes" size={26} />
            </div>
            <div>{search.trim() ? 'Ничего не найдено' : 'Товары не заведены'}</div>
          </div>
        ) : (
          <>
            <div className="sec">
              Все товары
              <span className="sec-count">{items.length}</span>
            </div>
            {filtered.map((p) => (
              <div key={p.id} className="tile static">
                <div className="tile-ico">
                  <Icon name="tag" size={19} />
                </div>
                <div className="tile-body">
                  <div className="tile-title">{p.name}</div>
                  <div className="tile-meta">
                    {p.sku_pending || !p.sku ? 'SKU ожидается' : <span className="mono">{p.sku}</span>}
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </PullToRefresh>
    </div>
  )
}
