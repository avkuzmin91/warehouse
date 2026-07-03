import { useCallback, useEffect, useRef, useState } from 'react'
import { useNav } from '../../nav/NavContext'
import { useAuth } from '../../auth/AuthContext'
import { getProducts, type ProductLookup } from '../../api/lookupsApi'
import { AppBar } from '../../components/AppBar'
import { Icon } from '../../components/Icon'
import { PullToRefresh } from '../../components/PullToRefresh'
import { canCreateDocuments } from '../../utils/access'

// Каталог может разрастись до тысяч позиций — поиск серверный, выдача усечённая.
// Запрашиваем LIMIT+1: лишняя строка = признак «показаны не все».
const LIMIT = 200

export function ProductsCatalogScreen() {
  const { openProductNew, back } = useNav()
  const { user } = useAuth()
  const canCreate = canCreateDocuments(user?.role)

  const [items, setItems] = useState<ProductLookup[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback((q: string, signal?: AbortSignal, silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    return getProducts({ search: q.trim() || undefined, limit: LIMIT + 1 }, signal)
      .then((rows) => {
        if (signal?.aborted) return
        setTruncated(rows.length > LIMIT)
        setItems(rows.slice(0, LIMIT))
      })
      .catch((err) => {
        if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить товары')
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false)
      })
  }, [])

  // Поиск с задержкой — не дёргаем бэк на каждую букву.
  useEffect(() => {
    const ac = new AbortController()
    const t = setTimeout(() => load(search, ac.signal), 300)
    return () => {
      clearTimeout(t)
      ac.abort()
    }
  }, [search, load])

  // Pull-to-refresh: тихий reload, предыдущий незавершённый запрос отменяем.
  const reloadAc = useRef<AbortController | null>(null)
  const refresh = useCallback(() => {
    reloadAc.current?.abort()
    const ac = new AbortController()
    reloadAc.current = ac
    return load(search, ac.signal, true)
  }, [load, search])
  useEffect(() => () => reloadAc.current?.abort(), [])

  return (
    <div className="screen">
      <AppBar title="Товары" sub="Справочник товаров" onBack={back} />
      <PullToRefresh className="scroll pad-nav" onRefresh={refresh}>
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

        {truncated && (
          <div className="alert warn">
            <Icon name="alert" size={15} />
            Показаны не все товары (первые {LIMIT}) — уточните поиск.
          </div>
        )}

        {loading ? (
          <div className="center">
            <div className="spin" />
            <div>Загрузка…</div>
          </div>
        ) : items.length === 0 ? (
          <div className="center">
            <div className="center-ico">
              <Icon name="boxes" size={26} />
            </div>
            <div>{search.trim() ? 'Ничего не найдено' : 'Товары не заведены'}</div>
          </div>
        ) : (
          <>
            <div className="sec">
              {search.trim() ? 'Найдено' : 'Все товары'}
              <span className="sec-count">{truncated ? `${LIMIT}+` : items.length}</span>
            </div>
            {items.map((p) => (
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
