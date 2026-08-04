import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { newRequestId } from '../api/http'
import { useNav } from '../nav/NavContext'
import { getBalancesByZone, type ZoneBalance } from '../api/balancesApi'
import {
  DISPATCH_STATUS_LABELS,
  finishDispatchPreparation,
  getDispatch,
  type DispatchDetail,
  type DispatchLine,
  type DispatchPrepareLine,
} from '../api/dispatchApi'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
import { LineFiles } from '../components/LineFiles'
import { ZoneField } from '../components/ZoneField'
import { balanceKey } from '../utils/balanceKey'
import { fmtDate, variantTitle } from '../utils/format'

type Row = { zoneId: string; qty: number }
type ZoneSource = { id: string; name: string; available: number }

function lineTitle(l: DispatchLine): string {
  return variantTitle(l.product_name, [l.color_name, l.size_name])
}

function sumRows(rows: Row[]): number {
  return rows.reduce((s, r) => s + (r.qty > 0 ? r.qty : 0), 0)
}

// Набрано = только количество, под которое уже выбрана ячейка-источник.
function pickedRows(rows: Row[]): number {
  return rows.reduce((s, r) => s + (r.zoneId && r.qty > 0 ? r.qty : 0), 0)
}

// Задача кладовщика «Подготовить отгрузку» (dispatch, статус preparing): по каждой
// строке указать, из каких ячеек берётся товар, и завершить подготовку — товар
// переезжает в зону отгрузки, документ ждёт рейс. Зеркало web PreparePanel.
export function DispatchPrepareScreen({ docId }: { docId: string }) {
  const { back } = useNav()
  const [doc, setDoc] = useState<DispatchDetail | null>(null)
  const [zoneBalances, setZoneBalances] = useState<ZoneBalance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [rows, setRows] = useState<Record<string, Row[]>>({})
  const [showErrors, setShowErrors] = useState(false)

  const load = useCallback(
    (signal?: AbortSignal) => {
      setLoading(true)
      setError('')
      getDispatch(docId, signal)
        .then((d) => {
          if (signal?.aborted) return
          setDoc(d)
          if (d.status === 'preparing') {
            const next: Record<string, Row[]> = {}
            for (const l of d.lines) next[l.id] = [{ zoneId: '', qty: l.qty }]
            setRows(next)
          }
        })
        .catch((err) => {
          if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить отгрузку')
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false)
        })
    },
    [docId],
  )

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    return () => ac.abort()
  }, [load])

  // Источник зависит от груза: годный берём из «Готов к отгрузке» (ready) или прямо из
  // «Упаковано» (packed — отгрузка из ещё не завершённой задачи упаковки); брак и годный
  // без упаковки — из мест хранения (storage). Всё переезжает в зону отгрузки.
  const isDefect = doc?.cargo_type === 'defect'
  const isUnpacked = doc?.cargo_type === 'good_unpacked'
  useEffect(() => {
    if (!doc || doc.status !== 'preparing' || !doc.client_id) return
    const ac = new AbortController()
    getBalancesByZone({ clientId: doc.client_id }, ac.signal)
      .then((r) => setZoneBalances(r.items))
      .catch(() => {})
    return () => ac.abort()
  }, [doc])

  const sourcesByLine = useMemo(() => {
    const map = new Map<string, ZoneSource[]>()
    if (!doc) return map
    const srcOps = isDefect || isUnpacked ? ['storage'] : ['ready', 'packed']
    const srcQuality = isDefect ? 'defect' : 'good'
    for (const line of doc.lines) {
      const key = balanceKey(line)
      // Одна ячейка может встретиться в нескольких корзинах (ready/packed) — объединяем
      // по zone_id, суммируя доступное, чтобы не было дублей в списке.
      const byZone = new Map<string, ZoneSource>()
      for (const z of zoneBalances) {
        if (!srcOps.includes(z.op_status) || z.quality !== srcQuality) continue
        if (!z.location_id || z.qty <= 0 || z.client_id !== doc.client_id) continue
        if (balanceKey(z) !== key) continue
        const prev = byZone.get(z.location_id)
        if (prev) prev.available += z.qty
        else byZone.set(z.location_id, { id: z.location_id, name: z.location_name ?? z.location_id, available: z.qty })
      }
      map.set(line.id, [...byZone.values()])
    }
    return map
  }, [doc, isDefect, isUnpacked, zoneBalances])

  // Стабильный request_id на логическое действие (идемпотентность при обрыве сети).
  const reqIds = useRef<Record<string, string>>({})
  function requestIdFor(key: string): string {
    return (reqIds.current[key] ??= newRequestId())
  }

  function setRow(lineId: string, i: number, patch: Partial<Row>) {
    setRows((p) => ({ ...p, [lineId]: (p[lineId] ?? []).map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }))
  }

  function rowOverflow(lineId: string, row: Row): boolean {
    if (!row.zoneId || row.qty <= 0) return false
    const src = (sourcesByLine.get(lineId) ?? []).find((s) => s.id === row.zoneId)
    return !!src && row.qty > src.available
  }

  function collectReasons(): string[] {
    if (!doc) return []
    const reasons: string[] = []
    if (doc.lines.length === 0) reasons.push('Нет позиций для подготовки')
    for (const line of doc.lines) {
      const lineRows = rows[line.id] ?? []
      if (lineRows.some((r) => r.qty > 0 && !r.zoneId)) reasons.push(`Выберите ячейку-источник для «${line.product_name}»`)
      const seen = new Set<string>()
      for (const r of lineRows) {
        if (!r.zoneId) continue
        if (seen.has(r.zoneId)) { reasons.push(`Ячейка указана дважды для «${line.product_name}»`); break }
        seen.add(r.zoneId)
      }
      if (sumRows(lineRows) !== line.qty) reasons.push(`Наберите весь товар для «${line.product_name}» (нужно ${line.qty} шт.)`)
      if (lineRows.some((r) => rowOverflow(line.id, r))) reasons.push(`В выбранной ячейке не хватает товара для «${line.product_name}»`)
    }
    return reasons
  }

  async function submit() {
    if (!doc || saving) return
    const reasons = collectReasons()
    if (reasons.length > 0) {
      setShowErrors(true)
      setError(reasons[0])
      return
    }
    const payload: DispatchPrepareLine[] = doc.lines.map((line) => ({
      line_id: line.id,
      sources: (rows[line.id] ?? [])
        .filter((r) => r.zoneId && r.qty > 0)
        .map((r) => ({
          zone_id: r.zoneId,
          zone_name: (sourcesByLine.get(line.id) ?? []).find((s) => s.id === r.zoneId)?.name ?? null,
          qty: r.qty,
        })),
    }))
    setSaving(true)
    setError('')
    try {
      await finishDispatchPreparation(docId, payload, requestIdFor('prepare'))
      delete reqIds.current['prepare']
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось завершить подготовку')
    } finally {
      setSaving(false)
    }
  }

  const noun = isDefect ? 'брак' : 'товар'
  const planTotal = doc?.lines.reduce((s, l) => s + l.qty, 0) ?? 0
  const pickedTotal = doc?.lines.reduce((s, l) => s + pickedRows(rows[l.id] ?? []), 0) ?? 0
  const boxesTotal = doc?.lines.reduce((s, l) => s + (l.boxes_qty ?? 0), 0) ?? 0
  const palletsTotal = doc?.lines.reduce((s, l) => s + (l.pallets_qty ?? 0), 0) ?? 0

  return (
    <div className="screen">
      <AppBar
        title={doc ? doc.doc_number : 'Отгрузка'}
        sub={doc ? `${isDefect ? 'Брак · ' : isUnpacked ? 'Без упаковки · ' : ''}${DISPATCH_STATUS_LABELS[doc.status]}` : undefined}
        onBack={back}
      />

      <div className="scroll">
        {error && !doc && (
          <div className="alert">
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}

        {loading && !doc ? (
          <div className="center">
            <div className="spin" />
            <div>Загрузка отгрузки…</div>
          </div>
        ) : !doc ? null : (
          <>
            <div className="summary">
              <div className="kv">
                <span className="k">Клиент</span>
                <span className="v">{doc.client_name ?? '—'}</span>
              </div>
              <div className="kv">
                <span className="k">Дата отгрузки</span>
                <span className="v">{fmtDate(doc.ship_date)}</span>
              </div>
              {(boxesTotal > 0 || palletsTotal > 0) && (
                <div className="kv">
                  <span className="k">Упаковка</span>
                  <span className="v">{boxesTotal} кор · {palletsTotal} пал</span>
                </div>
              )}
              {doc.trips.length > 0 && (
                <div className="kv">
                  <span className="k">Рейсы</span>
                  <span className="v">{doc.trips.map((t) => t.number).join(', ')}</span>
                </div>
              )}
            </div>
            {doc.comment && (
              <div className="tzcard">
                <div className="tztitle">Техническое задание</div>
                <div className="tzbody">{doc.comment}</div>
              </div>
            )}

            {doc.status === 'preparing' ? (
              <>
                <div className="sec">
                  Сбор по ячейкам
                  <span className="sec-count">{pickedTotal} / {planTotal} шт</span>
                </div>
                {doc.lines.map((l) => {
                  const opts = sourcesByLine.get(l.id) ?? []
                  const lineRows = rows[l.id] ?? []
                  const picked = pickedRows(lineRows)
                  const done = picked >= l.qty
                  const availById = new Map(opts.map((o) => [o.id, o.available]))
                  return (
                    <div key={l.id} className="line">
                      <div className="line-name">{lineTitle(l)}</div>
                      <div className="line-sub">
                        <span className="mono">{l.product_sku}</span>
                        {l.store_name ? ` · ${l.store_name}` : ''}
                      </div>
                      {(l.boxes_qty != null || l.pallets_qty != null) && (
                        <div className="line-sub" style={{ marginTop: 4 }}>
                          Упаковка: {l.boxes_qty ?? '—'} кор · {l.pallets_qty ?? '—'} пал
                        </div>
                      )}
                      {l.site_url && (
                        <div className="line-sub" style={{ marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <a href={l.site_url} target="_blank" rel="noreferrer">{l.site_url}</a>
                        </div>
                      )}
                      <LineFiles files={l.files} onError={setError} />
                      <div className="pack-meter">
                        <div className="pack-meter-top">
                          <div className="pack-meter-count">
                            <b>{picked}</b>
                            <span className="pack-meter-of"> / {l.qty} шт набрано</span>
                          </div>
                          {done ? (
                            <span className="badge success">
                              <Icon name="check" size={12} /> Набрано
                            </span>
                          ) : (
                            <span className="badge warning">осталось {Math.max(0, l.qty - picked)}</span>
                          )}
                        </div>
                        <div className="pack-bar">
                          <div
                            className={`pack-bar-fill${done ? ' done' : ''}`}
                            style={{ width: `${l.qty > 0 ? Math.min(100, Math.round((picked / l.qty) * 100)) : 0}%` }}
                          />
                        </div>
                      </div>
                      {opts.length === 0 ? (
                        <div className="line-sub" style={{ marginTop: 8, color: 'var(--c-warning)' }}>
                          {isDefect ? 'Брак' : 'Товар'} этой позиции не найден в ячейках — проверьте остатки.
                        </div>
                      ) : (
                        <>
                          {lineRows.map((row, i) => (
                            <div key={i} className="line-row">
                              <input
                                className="input num"
                                type="text"
                                inputMode="numeric"
                                min={0}
                                value={row.qty || ''}
                                onChange={(e) => setRow(l.id, i, { qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                              />
                              <ZoneField
                                value={row.zoneId}
                                options={opts.map((o) => ({ value: o.id, label: `${o.name} (доступно ${o.available})` }))}
                                placeholder="Из какой ячейки…"
                                title="Ячейка-источник"
                                invalid={showErrors && row.qty > 0 && !row.zoneId}
                                onError={setError}
                                onChange={(v) => setRow(l.id, i, { zoneId: v })}
                              />
                              {lineRows.length > 1 && (
                                <button
                                  className="appbar-back"
                                  style={{ flex: '0 0 50px', height: 50 }}
                                  aria-label="Убрать строку"
                                  onClick={() => setRows((p) => ({ ...p, [l.id]: lineRows.filter((_, idx) => idx !== i) }))}
                                >
                                  <Icon name="x" size={18} />
                                </button>
                              )}
                            </div>
                          ))}
                          {lineRows.length > 0 && lineRows[0].zoneId && (
                            <div className="line-sub" style={{ marginTop: 6 }}>
                              доступно в выбранной ячейке: {availById.get(lineRows[0].zoneId) ?? 0} шт
                            </div>
                          )}
                          {lineRows.length < opts.length && (
                            <button
                              className="btn ghost sm auto"
                              style={{ marginTop: 10 }}
                              onClick={() => setRows((p) => ({ ...p, [l.id]: [...lineRows, { zoneId: '', qty: 0 }] }))}
                            >
                              <Icon name="plus" size={16} /> Ячейка
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
                <div className="actionbar">
                  {error && (
                    <div className="alert">
                      <Icon name="alert" size={15} />
                      {error}
                    </div>
                  )}
                  <button className="btn" disabled={saving} onClick={() => void submit()}>
                    {saving ? <span className="spin spin-sm" /> : <><Icon name="check" size={18} /> Отгрузка подготовлена</>}
                  </button>
                  <div className="line-sub" style={{ textAlign: 'center' }}>
                    {noun[0].toUpperCase() + noun.slice(1)} спишется с выбранных ячеек и переедет в зону отгрузки.
                  </div>
                </div>
              </>
            ) : doc.status === 'draft' ? (
              <div className="center">
                <div className="center-ico">
                  <Icon name="edit" size={26} />
                </div>
                <div>Черновик — документ готовится менеджером.</div>
                <button className="btn ghost sm auto" onClick={back} style={{ marginTop: 4 }}>
                  Назад
                </button>
              </div>
            ) : (
              <div className="center">
                <div className="center-ico green">
                  <Icon name="check" size={26} />
                </div>
                <div>{DISPATCH_STATUS_LABELS[doc.status]} — действий кладовщика нет.</div>
                <button className="btn ghost sm auto" onClick={back} style={{ marginTop: 4 }}>
                  Назад
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
