import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getBalancesByZone,
  OP_STATUS_LABELS,
  QUALITY_LABELS,
  type ZoneBalance,
} from '../api/balancesApi'
import { barcodeVariantLabel, type BarcodeMatch } from '../api/productsApi'
import { useNav } from '../nav/NavContext'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
import { PullToRefresh } from '../components/PullToRefresh'
import { ScanDocsBlock } from '../components/ScanDocsBlock'

// Сортировка строк: сначала «На хранении», затем по качеству (годный → брак), затем по месту.
const OP_ORDER: Record<string, number> = { storage: 0, packing: 1, ready: 2 }
function rowSort(a: ZoneBalance, b: ZoneBalance): number {
  const o = (OP_ORDER[a.op_status] ?? 9) - (OP_ORDER[b.op_status] ?? 9)
  if (o !== 0) return o
  if (a.quality !== b.quality) return a.quality === 'good' ? -1 : 1
  return (a.location_name ?? '').localeCompare(b.location_name ?? '', 'ru')
}

// Карточка товара по отсканированному ШК: что это (из barcode-lookup) + где лежит и сколько
// (остатки этого варианта из /balances/zones, отфильтрованные точно по товар+цвет+размер).
export function ScanProductScreen({ match }: { match: BarcodeMatch }) {
  const { back } = useNav()
  const { sku, product_id, color_id, size_id } = match
  const [rows, setRows] = useState<ZoneBalance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(
    (signal?: AbortSignal, silent = false) => {
      if (!silent) setLoading(true)
      setError('')
      // Поиск по SKU варианта; на клиенте сужаем до точной позиции (substring мог зацепить чужой SKU).
      return getBalancesByZone({ search: sku }, signal)
        .then((r) => {
          if (signal?.aborted) return
          setRows(
            r.items.filter(
              (it) =>
                it.product_id === product_id &&
                (it.color_id ?? null) === (color_id ?? null) &&
                (it.size_id ?? null) === (size_id ?? null),
            ),
          )
        })
        .catch((err) => {
          if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить остатки')
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false)
        })
    },
    [sku, product_id, color_id, size_id],
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

  const totals = useMemo(() => {
    let good = 0
    let defect = 0
    for (const r of rows) {
      if (r.quality === 'defect') defect += r.qty
      else good += r.qty
    }
    return { good, defect, total: good + defect }
  }, [rows])

  const sortedRows = useMemo(() => [...rows].sort(rowSort), [rows])

  const variant = barcodeVariantLabel(match)

  return (
    <div className="screen">
      <AppBar title={match.product_name} sub={variant || 'Товар'} onBack={back} />

      <PullToRefresh className="scroll pad-nav" onRefresh={refresh}>
        <div className="line" style={{ marginTop: 0 }}>
          <div className="line-name">{match.product_name}</div>
          <div className="line-sub mono">{match.sku}</div>
          {variant && <div className="line-sub">{variant}</div>}
          {match.client_name && <div className="line-sub">{match.client_name}</div>}
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
            <div>Загрузка остатков…</div>
          </div>
        ) : (
          <>
            <div className="summary" style={{ marginBottom: 16 }}>
              <div className="kv">
                <span className="k">Годный</span>
                <span className="v mono">{totals.good} шт</span>
              </div>
              <div className="kv">
                <span className="k">Брак</span>
                <span className="v mono">{totals.defect} шт</span>
              </div>
              <div className="kv">
                <span className="k">Всего</span>
                <span className="v mono">{totals.total} шт</span>
              </div>
            </div>

            {sortedRows.length === 0 ? (
              <div className="center">
                <div className="center-ico">
                  <Icon name="archive" size={26} />
                </div>
                <div>Нет остатков на складе</div>
              </div>
            ) : (
              <>
                <div className="sec">Где лежит</div>
                {sortedRows.map((r, i) => (
                  <div className="line" key={`${r.location_id ?? '∅'}__${r.op_status}__${r.quality}__${i}`}>
                    <div className="line-row" style={{ marginTop: 0, alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="line-name">{r.location_name ?? 'Без места'}</div>
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
                ))}
              </>
            )}
          </>
        )}

        <ScanDocsBlock variantId={match.variant_id} />
      </PullToRefresh>
    </div>
  )
}
