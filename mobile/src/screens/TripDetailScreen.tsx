import { useCallback, useEffect, useRef, useState } from 'react'
import { useNav } from '../nav/NavContext'
import { newRequestId } from '../api/http'
import { getUnloadingZones, type Zone } from '../api/lookupsApi'
import {
  getTrip,
  tripArrival,
  tripLexicon,
  tripUnload,
  TRIP_LOAD_LABELS,
  TRIP_STATUS_LABELS,
  type TripDetail,
  type TripReceiptAlloc,
  type TripUnloadReceiptLine,
} from '../api/tripsApi'
import { getReceiptLines, type ReceiptLine } from '../api/receiptsApi'
import { getDispatch, type DispatchLine } from '../api/dispatchApi'
import { AppBar } from '../components/AppBar'
import { ZoneField } from '../components/ZoneField'
import { DateTimeField } from '../components/DateTimeField'
import { Icon } from '../components/Icon'
import { MOSCOW_TZ, moscowNowIso, parseMoscow, variantTitle } from '../utils/format'

const RECEIPT_STATUS: Record<string, { label: string; tone: string }> = {
  planned: { label: 'В плане', tone: '' },
  on_intake: { label: 'На приёмке', tone: 'info' },
  partially_received: { label: 'Частично принято', tone: 'warning' },
  on_review: { label: 'На проверке', tone: 'warning' },
  done: { label: 'Поступил', tone: 'success' },
}
const DISPATCH_STATUS: Record<string, { label: string; tone: string }> = {
  preparing: { label: 'Подготовка', tone: 'info' },
  awaiting_trip: { label: 'Ожидает рейс', tone: 'info' },
  partially_shipped: { label: 'Частично', tone: 'warning' },
  shipped: { label: 'Отгружено', tone: 'success' },
  cancelled: { label: 'Аннулирован', tone: '' },
}

function fmtTime(v: string | null): string {
  if (!v) return '—'
  const d = parseMoscow(v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: MOSCOW_TZ })
}

function minutesSince(v: string | null): number | null {
  if (!v) return null
  const ms = Date.now() - parseMoscow(v).getTime()
  if (Number.isNaN(ms) || ms < 0) return null
  return Math.round(ms / 60000)
}

/** ISO → значение для DateTimeField (наивные стенные часы Москвы, YYYY-MM-DDTHH:mm). */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = parseMoscow(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('sv-SE', { timeZone: MOSCOW_TZ }).replace(' ', 'T').slice(0, 16)
}
function nowLocalInput(): string {
  return moscowNowIso().slice(0, 16)
}

function lineTitle(a: { product_name: string | null; product_sku: string | null; variant: string | null }): string {
  return variantTitle(a.product_name ?? a.product_sku ?? 'Товар', [a.variant])
}

export function TripDetailScreen({ tripId }: { tripId: string }) {
  const { back } = useNav()
  const [detail, setDetail] = useState<TripDetail | null>(null)
  const [zones, setZones] = useState<Zone[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [actionErr, setActionErr] = useState('')

  // Раскладка принятого по ячейкам (кол-во + место) на строку. По умолчанию одна ячейка.
  const [placementsByLine, setPlacementsByLine] = useState<Record<string, ReceivePlacement[]>>({})
  const [loadFactor, setLoadFactor] = useState<'' | 'full' | 'partial'>('')
  const [arrival, setArrival] = useState('')
  const [unloadStart, setUnloadStart] = useState('')
  const [unloadEnd, setUnloadEnd] = useState('')
  const [showErrors, setShowErrors] = useState(false)

  const load = useCallback(
    (signal?: AbortSignal) => {
      setLoading(true)
      setError('')
      getTrip(tripId, signal)
        .then((d) => {
          if (signal?.aborted) return
          setDetail(d)
          const doc = d.doc
          if (doc.direction === 'inbound' && doc.status === 'unloading') {
            const placements: Record<string, ReceivePlacement[]> = {}
            for (const r of d.receipts) {
              for (const a of r.allocations) {
                placements[a.line_id] = [{ qty: a.qty, zoneId: a.storage_zone_id ?? '' }]
              }
            }
            setPlacementsByLine(placements)
          }
          if (doc.load_factor) setLoadFactor(doc.load_factor)
          setArrival(isoToLocalInput(doc.arrived_at) || nowLocalInput())
          setUnloadStart(isoToLocalInput(doc.unload_started_at || doc.arrived_at) || nowLocalInput())
          setUnloadEnd(isoToLocalInput(doc.unload_finished_at) || nowLocalInput())
        })
        .catch((err) => {
          if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить рейс')
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false)
        })
    },
    [tripId],
  )

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    return () => ac.abort()
  }, [load])

  useEffect(() => {
    const ac = new AbortController()
    getUnloadingZones(ac.signal)
      .then((z) => setZones(z.filter((x) => x.is_active !== false && !x.is_deleted)))
      .catch(() => {})
    return () => ac.abort()
  }, [])

  // Стабильный request_id на логическое действие: переживает повтор при обрыве сети
  // (идемпотентность, docs/mobile-plan.md §6.3). Сбрасывается при успехе — следующее
  // действие получит новый id.
  const reqIds = useRef<Record<string, string>>({})
  function requestIdFor(key: string): string {
    return (reqIds.current[key] ??= newRequestId())
  }

  // Перезагрузка после действия отменяет предыдущий незавершённый reload, иначе
  // устаревший ответ мог бы перезаписать свежее состояние рейса (M2).
  const reloadAc = useRef<AbortController | null>(null)
  const reload = useCallback(() => {
    reloadAc.current?.abort()
    const ac = new AbortController()
    reloadAc.current = ac
    load(ac.signal)
  }, [load])
  useEffect(() => () => reloadAc.current?.abort(), [])

  async function runAction(fn: () => Promise<unknown>, actionKey?: string) {
    if (saving) return
    setSaving(true)
    setActionErr('')
    try {
      await fn()
      if (actionKey) delete reqIds.current[actionKey]
      reload()
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'Не удалось выполнить действие')
    } finally {
      setSaving(false)
    }
  }

  function handleArrival() {
    if (!arrival) {
      setShowErrors(true)
      setActionErr('Укажите время прибытия')
      return
    }
    void runAction(() => tripArrival(tripId, arrival, requestIdFor('arrival')), 'arrival')
  }

  function buildReceiptLines(): TripUnloadReceiptLine[] {
    const out: TripUnloadReceiptLine[] = []
    for (const r of detail?.receipts ?? []) {
      for (const a of r.allocations) {
        const rows = placementsByLine[a.line_id] ?? [{ qty: a.qty, zoneId: '' }]
        const placements = rows
          .filter((p) => p.qty > 0)
          .map((p) => {
            const zone = zones.find((z) => z.id === p.zoneId)
            return { storage_zone_id: p.zoneId || null, storage_zone_name: zone?.name ?? null, qty: p.qty }
          })
        const total = placements.reduce((s, p) => s + p.qty, 0)
        out.push({
          line_id: a.line_id,
          accepted_qty: total,
          storage_zone_id: placements[0]?.storage_zone_id ?? null,
          storage_zone_name: placements[0]?.storage_zone_name ?? null,
          placements,
        })
      }
    }
    return out
  }

  function handleFinish(inbound: boolean) {
    const lex = tripLexicon(detail!.doc.direction)
    const reasons: string[] = []
    if (!unloadStart) reasons.push(`Укажите «${lex.unloadStartLabel}»`)
    if (!unloadEnd) reasons.push(`Укажите «${lex.unloadEndLabel}»`)
    if (unloadStart && unloadEnd && new Date(unloadEnd) < new Date(unloadStart)) reasons.push(lex.periodInvalid)
    if (!loadFactor) reasons.push('Выберите загруженность машины')
    if (inbound) {
      const missingZone = (detail?.receipts ?? []).some((r) =>
        r.allocations.some((a) => (placementsByLine[a.line_id] ?? []).some((p) => p.qty > 0 && !p.zoneId)),
      )
      if (missingZone) reasons.push('Укажите место хранения для всех принятых позиций')
    }
    if (reasons.length) {
      setShowErrors(true)
      setActionErr(reasons[0])
      return
    }
    void runAction(
      () =>
        tripUnload(
          tripId,
          {
            unload_started_at: unloadStart || null,
            unload_finished_at: unloadEnd || null,
            load_factor: loadFactor as 'full' | 'partial',
            ...(inbound ? { receipt_lines: buildReceiptLines() } : {}),
          },
          requestIdFor('unload'),
        ),
      'unload',
    )
  }

  const doc = detail?.doc
  const lex = doc ? tripLexicon(doc.direction) : null
  const outbound = doc?.direction === 'outbound'
  const unloading = doc?.status === 'unloading'
  const unloadingStartedAt = doc ? doc.unload_started_at ?? doc.arrived_at : null
  const inWork = unloading ? minutesSince(unloadingStartedAt) : null

  return (
    <div className="screen">
      <AppBar
        title={doc ? doc.trip_number : 'Рейс'}
        sub={doc ? `${outbound ? 'Отгрузка' : 'Приёмка'} · ${TRIP_STATUS_LABELS[doc.status]}` : undefined}
        onBack={back}
      />

      <div className="scroll">
        {error && (
          <div className="alert">
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}

        {loading && !detail ? (
          <div className="center">
            <div className="spin" />
            <div>Загрузка рейса…</div>
          </div>
        ) : !doc || !lex ? null : (
          <>
            {/* Чипы: что за машина приехала */}
            {(doc.vehicle_type_name || doc.carrier_name || doc.origin_name) && (
              <div className="chips">
                {doc.vehicle_type_name && (
                  <span className="pill">
                    <Icon name="truck" size={14} /> {doc.vehicle_type_name}
                  </span>
                )}
                {doc.carrier_name && (
                  <span className="pill">
                    <Icon name="user" size={14} /> {doc.carrier_name}
                  </span>
                )}
                {doc.origin_name && (
                  <span className="pill">
                    <Icon name="map" size={14} /> {doc.origin_name}
                  </span>
                )}
              </div>
            )}

            {/* Карточка состояния + госномер */}
            <div className="infocard">
              <div className="infocard-ico">
                <Icon name="clock" size={20} />
              </div>
              <div className="infocard-body">
                <div className="infocard-title">{unloading ? lex.progressTitle : lex.awaitingMachineTitle}</div>
                <div className="infocard-sub">
                  {unloading
                    ? `${lex.unloadStartLabel} ${fmtTime(unloadingStartedAt)}${inWork != null ? ` · в работе ${inWork} мин` : ''}`
                    : `Транспорт заказан ${fmtTime(doc.transport_ordered_at)}`}
                </div>
              </div>
              {doc.vehicle_number && <div className="plate">{doc.vehicle_number}</div>}
            </div>

            {/* awaiting_arrival: время прибытия + состав «в машине» */}
            {doc.status === 'awaiting_arrival' && (
              <>
                <div className="field">
                  <div className="flabel">
                    <span>{lex.arrivalLabel}</span>
                    <span className="req">*</span>
                  </div>
                  <DateTimeField
                    invalid={showErrors && !arrival}
                    value={arrival}
                    onChange={setArrival}
                    title={lex.arrivalLabel}
                  />
                </div>
                <Composition detail={detail!} outbound={outbound} title={lex.docsInVehicle} />
                <div className="actionbar">
                  {actionErr && (
                    <div className="alert">
                      <Icon name="alert" size={15} />
                      {actionErr}
                    </div>
                  )}
                  <button className="btn" disabled={saving} onClick={handleArrival}>
                    {saving ? '…' : <><Icon name="check" size={18} /> {lex.arrivedAction}</>}
                  </button>
                </div>
              </>
            )}

            {/* unloading: времена + загруженность + приёмка (inbound) / состав (outbound) */}
            {unloading && (
              <>
                <div className="field">
                  <div className="flabel">
                    <span>{lex.unloadStartLabel}</span>
                    <span className="req">*</span>
                  </div>
                  <DateTimeField
                    invalid={showErrors && !unloadStart}
                    value={unloadStart}
                    onChange={setUnloadStart}
                    title={lex.unloadStartLabel}
                  />
                </div>
                <div className="field">
                  <div className="flabel">
                    <span>{lex.unloadEndLabel}</span>
                    <span className="req">*</span>
                  </div>
                  <DateTimeField
                    invalid={showErrors && !unloadEnd}
                    value={unloadEnd}
                    onChange={setUnloadEnd}
                    title={lex.unloadEndLabel}
                  />
                </div>

                <div className="field">
                  <div className="flabel">
                    <span>Загруженность машины</span>
                    <span className="req">*</span>
                  </div>
                  <div className="seg">
                    <button
                      type="button"
                      className={loadFactor === 'full' ? 'active tone-success' : ''}
                      onClick={() => setLoadFactor('full')}
                    >
                      <span className="seg-ico">
                        <Icon name="check" size={15} />
                        {TRIP_LOAD_LABELS.full}
                      </span>
                    </button>
                    <button
                      type="button"
                      className={loadFactor === 'partial' ? 'active tone-warning' : ''}
                      onClick={() => setLoadFactor('partial')}
                    >
                      <span className="seg-ico">
                        <Icon name="alert" size={15} />
                        {TRIP_LOAD_LABELS.partial}
                      </span>
                    </button>
                  </div>
                </div>

                <div className="sec">{lex.docsInVehicle}</div>
                {!outbound ? (
                  detail!.receipts.map((r) => (
                    <div key={r.line_id} className="group">
                      <div className="group-head">
                        <span className="gname">
                          {r.receipt_number ?? 'Поступление'}
                          {r.client_name ? ` · ${r.client_name}` : ''}
                        </span>
                        {r.receipt_status && RECEIPT_STATUS[r.receipt_status] && (
                          <span className={`badge ${RECEIPT_STATUS[r.receipt_status].tone}`}>
                            <span className="dot" />
                            {RECEIPT_STATUS[r.receipt_status].label}
                          </span>
                        )}
                      </div>
                      {r.allocations.map((a) => (
                        <ReceiveLine
                          key={a.line_id}
                          a={a}
                          zones={zones}
                          rows={placementsByLine[a.line_id] ?? [{ qty: a.qty, zoneId: '' }]}
                          invalid={showErrors}
                          onRows={(rows) => setPlacementsByLine((p) => ({ ...p, [a.line_id]: rows }))}
                          onError={setActionErr}
                        />
                      ))}
                    </div>
                  ))
                ) : (
                  <Composition detail={detail!} outbound title={null} />
                )}

                <div className="actionbar">
                  {actionErr && (
                    <div className="alert">
                      <Icon name="alert" size={15} />
                      {actionErr}
                    </div>
                  )}
                  <button className="btn" disabled={saving} onClick={() => handleFinish(!outbound)}>
                    {saving ? '…' : <><Icon name="check" size={18} /> {lex.finishAction}</>}
                  </button>
                </div>
              </>
            )}

            {(doc.status === 'costing' || doc.status === 'closed') && (
              <div className="center">
                <div className="center-ico green">
                  <Icon name="check" size={26} />
                </div>
                <div>
                  {lex.warehousePhase} завершена. {doc.status === 'closed' ? 'Рейс закрыт.' : 'Передано менеджеру.'}
                </div>
                <button className="btn ghost sm auto" onClick={back} style={{ marginTop: 4 }}>
                  Назад
                </button>
              </div>
            )}

            {(doc.status === 'draft' || doc.status === 'cancelled') && (
              <div className="center">
                <div>{TRIP_STATUS_LABELS[doc.status]} — действий нет.</div>
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

function Composition({ detail, outbound, title }: { detail: TripDetail; outbound: boolean; title: string | null }) {
  return (
    <>
      {title && <div className="sec">{title}</div>}
      {!outbound
        ? detail.receipts.map((r) => (
            <div key={r.line_id} className="group">
              <div className="group-head">
                <span className="gname">
                  {r.receipt_number ?? 'Поступление'}
                  {r.client_name ? ` · ${r.client_name}` : ''}
                </span>
                {r.receipt_status && RECEIPT_STATUS[r.receipt_status] && (
                  <span className={`badge ${RECEIPT_STATUS[r.receipt_status].tone}`}>
                    <span className="dot" />
                    {RECEIPT_STATUS[r.receipt_status].label}
                  </span>
                )}
              </div>
              {r.allocations.length > 0 ? (
                r.allocations.map((a) => (
                  <ReadLine key={a.line_id} title={lineTitle(a)} sub={`план ${a.qty} шт · принято ${a.received_qty ?? 0}`} />
                ))
              ) : (
                <ReceiptLinesFallback docId={r.receipt_doc_id} />
              )}
            </div>
          ))
        : detail.dispatches.map((s) => (
            <div key={s.line_id} className="group">
              <div className="group-head">
                <span className="gname">
                  {s.dispatch_number ?? 'Отгрузка'}
                  {s.client_name ? ` · ${s.client_name}` : ''}
                </span>
                {s.dispatch_status && DISPATCH_STATUS[s.dispatch_status] && (
                  <span className={`badge ${DISPATCH_STATUS[s.dispatch_status].tone}`}>
                    <span className="dot" />
                    {DISPATCH_STATUS[s.dispatch_status].label}
                  </span>
                )}
              </div>
              {s.allocations.length > 0 ? (
                s.allocations.map((a) => (
                  <ReadLine key={a.line_id} title={lineTitle(a)} sub={`увозит ${a.qty} шт`} />
                ))
              ) : (
                <DispatchLinesFallback docId={s.dispatch_doc_id} />
              )}
            </div>
          ))}
    </>
  )
}

function ReadLine({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="line">
      <div className="line-name">{title}</div>
      <div className="line-sub">{sub}</div>
    </div>
  )
}

/** Состав поступления для рейсов без построчной аллокации (legacy-привязка целиком):
 *  без trip_alloc состав не приходит в детали рейса — дотягиваем строки самого поступления.
 *  Зеркало web LinesBody/ReceiptLinesTable. */
function ReceiptLinesFallback({ docId }: { docId: string }) {
  const [lines, setLines] = useState<ReceiptLine[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const ac = new AbortController()
    setError(false)
    getReceiptLines(docId, ac.signal)
      .then((ls) => {
        if (!ac.signal.aborted) setLines(ls)
      })
      .catch(() => {
        if (!ac.signal.aborted) setError(true)
      })
    return () => ac.abort()
  }, [docId])

  if (error) return <div className="line-sub" style={{ padding: '6px 0' }}>Не удалось загрузить состав</div>
  if (!lines) return <div className="line-sub" style={{ padding: '6px 0' }}>Загрузка состава…</div>
  if (lines.length === 0) return <div className="line-sub" style={{ padding: '6px 0' }}>Состав появится на приёмке</div>

  return (
    <>
      {lines.map((l) => {
        const variant = [l.color_name, l.size_name].filter(Boolean).join(' · ')
        const name = l.product_name ?? l.product_sku ?? 'Товар'
        return <ReadLine key={l.id} title={variant ? `${name} · ${variant}` : name} sub={`план ${l.planned_qty} шт`} />
      })}
    </>
  )
}

/** Состав отгрузки для рейсов без построчной аллокации (legacy-привязка целиком):
 *  без trip_alloc состав не приходит в детали рейса — дотягиваем строки самой отгрузки. */
function DispatchLinesFallback({ docId }: { docId: string }) {
  const [lines, setLines] = useState<DispatchLine[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const ac = new AbortController()
    setError(false)
    getDispatch(docId, ac.signal)
      .then((d) => {
        if (!ac.signal.aborted) setLines(d.lines)
      })
      .catch(() => {
        if (!ac.signal.aborted) setError(true)
      })
    return () => ac.abort()
  }, [docId])

  if (error) return <div className="line-sub" style={{ padding: '6px 0' }}>Не удалось загрузить состав</div>
  if (!lines) return <div className="line-sub" style={{ padding: '6px 0' }}>Загрузка состава…</div>
  if (lines.length === 0) return <div className="line-sub" style={{ padding: '6px 0' }}>Строки не заданы</div>

  return (
    <>
      {lines.map((l) => {
        const variant = [l.color_name, l.size_name].filter(Boolean).join(' · ')
        const name = l.product_name ?? l.product_sku ?? 'Товар'
        return <ReadLine key={l.id} title={variant ? `${name} · ${variant}` : name} sub={`увозит ${l.qty} шт`} />
      })}
    </>
  )
}

function ReceiveLine({
  a,
  zones,
  rows,
  invalid,
  onRows,
  onError,
}: {
  a: TripReceiptAlloc
  zones: Zone[]
  rows: ReceivePlacement[]
  invalid: boolean
  onRows: (rows: ReceivePlacement[]) => void
  onError: (msg: string) => void
}) {
  const total = rows.reduce((s, p) => s + (p.qty > 0 ? p.qty : 0), 0)
  const diff = total - a.qty
  const setRow = (idx: number, patch: Partial<ReceivePlacement>) =>
    onRows(rows.map((p, i) => (i === idx ? { ...p, ...patch } : p)))
  const addRow = () => onRows([...rows, { qty: 0, zoneId: '' }])
  const removeRow = (idx: number) => onRows(rows.filter((_, i) => i !== idx))
  return (
    <div className="line">
      <div className="line-name">{lineTitle(a)}</div>
      <div className="line-sub">
        План рейса: {a.qty} шт. · принято: {total}
        {a.received_qty > 0 ? ` · уже принято: ${a.received_qty}` : ''}
        {diff !== 0 ? (
          diff > 0 ? (
            <> · <span className="delta over">сверх плана +{diff}</span></>
          ) : (
            <> · <span className="delta under">недовоз {diff}</span></>
          )
        ) : null}
      </div>
      {rows.map((p, idx) => {
        const zoneMissing = invalid && p.qty > 0 && !p.zoneId
        return (
          <div className="line-row" key={idx} style={{ marginTop: idx === 0 ? 0 : 10 }}>
            <input
              className="input num"
              type="text"
              inputMode="numeric"
              min={0}
              value={p.qty || ''}
              onChange={(e) => setRow(idx, { qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
            />
            <ZoneField
              value={p.zoneId}
              options={zones.map((z) => ({ value: z.id, label: z.name }))}
              placeholder="Место…"
              title="Место хранения"
              invalid={zoneMissing}
              onChange={(v) => setRow(idx, { zoneId: v })}
              onError={onError}
              allowUnlisted
            />
            {rows.length > 1 && (
              <button
                className="appbar-back"
                style={{ flex: '0 0 50px', height: 50 }}
                aria-label="Убрать ячейку"
                onClick={() => removeRow(idx)}
              >
                <Icon name="x" size={18} />
              </button>
            )}
          </div>
        )
      })}
      <button className="btn ghost sm auto" onClick={addRow} style={{ marginTop: 10 }}>
        <Icon name="plus" size={16} /> Ещё ячейка
      </button>
    </div>
  )
}

type ReceivePlacement = { qty: number; zoneId: string }
