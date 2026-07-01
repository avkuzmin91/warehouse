import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNav } from '../../nav/NavContext'
import { useAuth } from '../../auth/AuthContext'
import {
  createColor,
  createSize,
  getColors,
  getSizes,
  type DictionaryItem,
} from '../../api/lookupsApi'
import { AppBar } from '../../components/AppBar'
import { Icon, type IconName } from '../../components/Icon'
import { PullToRefresh } from '../../components/PullToRefresh'
import { canCreateDocuments } from '../../utils/access'
import { DictItemSheet } from './DictItemSheet'

export type DictKind = 'colors' | 'sizes'

type Cfg = {
  title: string
  sub: string
  icon: IconName
  addLabel: string
  emptyLabel: string
  sheetTitle: string
  sheetLabel: string
  sheetPlaceholder: string
  load: (signal?: AbortSignal) => Promise<DictionaryItem[]>
  create: (name: string, requestId?: string) => Promise<{ message: string }>
}

const CONFIG: Record<DictKind, Cfg> = {
  colors: {
    title: 'Цвета',
    sub: 'Справочник цветов',
    icon: 'sparkles',
    addLabel: 'Добавить цвет',
    emptyLabel: 'Цвета не заведены',
    sheetTitle: 'Новый цвет',
    sheetLabel: 'Название цвета',
    sheetPlaceholder: 'Например, Чёрный',
    load: getColors,
    create: createColor,
  },
  sizes: {
    title: 'Размеры',
    sub: 'Справочник размеров',
    icon: 'layers',
    addLabel: 'Добавить размер',
    emptyLabel: 'Размеры не заведены',
    sheetTitle: 'Новый размер',
    sheetLabel: 'Название размера',
    sheetPlaceholder: 'Например, XL',
    load: getSizes,
    create: createSize,
  },
}

export function DictCatalogScreen({ kind }: { kind: DictKind }) {
  const cfg = CONFIG[kind]
  const { back } = useNav()
  const { user } = useAuth()
  const canCreate = canCreateDocuments(user?.role)

  const [items, setItems] = useState<DictionaryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback((signal?: AbortSignal, silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    return cfg.load(signal)
      .then((rows) => {
        if (signal?.aborted) return
        setItems(rows)
      })
      .catch((err) => {
        if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить справочник')
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false)
      })
  }, [cfg])

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    return () => ac.abort()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter((it) => it.name.toLowerCase().includes(q))
  }, [items, search])

  return (
    <div className="screen">
      <AppBar title={cfg.title} sub={cfg.sub} onBack={back} />
      <PullToRefresh className="scroll pad-nav" onRefresh={() => load(undefined, true)}>
        {canCreate && (
          <button className="btn" style={{ width: '100%', marginBottom: 12 }} onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} /> {cfg.addLabel}
          </button>
        )}

        <div className="field">
          <input
            className="input"
            type="text"
            placeholder="Поиск по названию…"
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
              <Icon name={cfg.icon} size={26} />
            </div>
            <div>{search.trim() ? 'Ничего не найдено' : cfg.emptyLabel}</div>
          </div>
        ) : (
          <>
            <div className="sec">
              Все записи
              <span className="sec-count">{items.length}</span>
            </div>
            {filtered.map((it) => (
              <div key={it.id} className="tile static">
                <div className="tile-ico">
                  <Icon name={cfg.icon} size={19} />
                </div>
                <div className="tile-body">
                  <div className="tile-title">{it.name}</div>
                </div>
              </div>
            ))}
          </>
        )}
      </PullToRefresh>

      {adding && (
        <DictItemSheet
          title={cfg.sheetTitle}
          label={cfg.sheetLabel}
          placeholder={cfg.sheetPlaceholder}
          create={cfg.create}
          onDone={() => { setAdding(false); void load(undefined, true) }}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  )
}
