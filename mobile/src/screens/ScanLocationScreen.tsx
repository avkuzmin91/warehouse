import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getBalancesByZone,
  OP_STATUS_LABELS,
  QUALITY_LABELS,
  type ZoneBalance,
} from '../api/balancesApi'
import type { LocationMatch } from '../api/locationsApi'
import { useNav } from '../nav/NavContext'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
import { PullToRefresh } from '../components/PullToRefresh'
import { ScanDocsBlock } from '../components/ScanDocsBlock'

const OP_ORDER: Record<string, number> = { storage: 0, packing: 1, packed: 2, ready: 3 }
function rowSort(a: ZoneBalance, b: ZoneBalance): number {
  const o = (OP_ORDER[a.op_status] ?? 9) - (OP_ORDER[b.op_status] ?? 9)
  if (o !== 0) return o
  if (a.quality !== b.quality) return a.quality === 'good' ? -1 : 1
  return (a.product_name ?? '').localeCompare(b.product_name ?? '', 'ru')
}

function kindLabel(kind: string): string {
  return kind === 'cell' ? 'Адресная ячейка' : 'Служебная зона'
}

// Карточка места по отсканированному QR: что это за место + что в нём лежит (остатки,
// отфильтрованные точно по location_id) + участие в живых документах.
export function ScanLocationScreen({ location }: { location: LocationMatch }) {
  const { back, openPlace } = useNav()
  const [rows, setRows] = useState<ZoneBalance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(
    (signal?: AbortSignal, silent = false) => {
      if (!silent) setLoading(true)
      setError('')
      // Серверный фильтр сужает по имени (подстрока адреса), на клиенте — точно по id.
      return getBalancesByZone({ location: location.code }, signal)
        .then((r) => {
          if (signal?.aborted) return
          setRows(r.items.filter((it) => it.location_id === location.id))
        })
        .catch((err) => {
          if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить остатки')
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false)
        })
    },
    [location.code, location.id],
  )

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    return () => ac.abort()
  }, [load])

  const refreshAc = useRef<AbortController | null>(null)
  const refresh = useCallback(() => {
    refreshAc.current?.abort()
    const ac = new AbortController()
    refreshAc.current = ac
    return load(ac.signal, true)
  }, [load])
  useEffect(() => () => refreshAc.current?.abort(), [])

  const total = useMemo(() => rows.reduce((s, r) => s + r.qty, 0), [rows])
  const sortedRows = useMemo(() => [...rows].sort(rowSort), [rows])

  return (
    <div className="screen">
      <AppBar title={location.code} sub={kindLabel(location.kind)} onBack={back} />

      <PullToRefresh className="scroll pad-nav" onRefresh={refresh}>
        <div className="line" style={{ marginTop: 0 }}>
          <div className="line-name">{location.code}</div>
          <div className="line-sub">{kindLabel(location.kind)}</div>
          <div className="pills">
            {location.is_packing_zone && <span className="pill">Зона упаковки</span>}
            {location.is_shipping_zone && <span className="pill">Зона отгрузки</span>}
            {!location.is_active && <span className="pill defect">В архиве</span>}
          </div>
          <div className="line-sub mono">{location.id}</div>
        </div>

        {error && (
          <div className="alert">
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}

        {/* Перенос начинается там, где человек стоит: отсканировал место — забирает из него. */}
        <button
          className="btn"
          style={{ width: '100%' }}
          onClick={() => openPlace({ id: location.id, code: location.code })}
        >
          <Icon name="layers" size={18} /> Взять отсюда — перенос
        </button>

        {loading ? (
          <div className="center">
            <div className="spin" />
            <div>Загрузка остатков…</div>
          </div>
        ) : (
          <>
            <div className="summary" style={{ marginBottom: 16 }}>
              <div className="kv">
                <span className="k">Всего в ячейке</span>
                <span className="v mono">{total} шт</span>
              </div>
            </div>

            {sortedRows.length === 0 ? (
              <div className="center">
                <div className="center-ico">
                  <Icon name="archive" size={26} />
                </div>
                <div>Ячейка пуста</div>
              </div>
            ) : (
              <>
                <div className="sec">Что лежит</div>
                {sortedRows.map((r, i) => {
                  const variant = [r.color_name, r.size_name].filter(Boolean).join(' · ')
                  return (
                    <div className="line" key={`${r.product_id}__${r.op_status}__${r.quality}__${i}`}>
                      <div className="line-row" style={{ marginTop: 0, alignItems: 'flex-start' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="line-name">{r.product_name}</div>
                          <div className="line-sub mono">{r.product_sku}</div>
                          {variant && <div className="line-sub">{variant}</div>}
                          <div className="pills">
                            <span className="pill">{OP_STATUS_LABELS[r.op_status]}</span>
                            <span className={`pill ${r.quality}`}>{QUALITY_LABELS[r.quality]}</span>
                          </div>
                        </div>
                        <span className="tile-qty">
                          {r.qty}
                          <span className="u">шт</span>
                        </span>
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </>
        )}

        <ScanDocsBlock locationId={location.id} />
      </PullToRefresh>
    </div>
  )
}
