import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { newRequestId } from '../api/http'
import { useNav } from '../nav/NavContext'
import {
  advanceShipment,
  getLinePacking,
  getShipment,
  recordPacking,
  reversePackingEntry,
  SHIPMENT_STATUS_LABELS,
  type ShipmentDetail,
  type ShipmentLine,
  type ShipmentPackingEntry,
} from '../api/shipmentsApi'
import { AppBar } from '../components/AppBar'
import { DateField } from '../components/DateField'
import { Icon } from '../components/Icon'
import { fmtDate, moscowTodayYmd, variantTitle } from '../utils/format'

function lineTitle(l: ShipmentLine): string {
  return variantTitle(l.product_name, [l.color_name, l.size_name])
}

export function ShiftPackingDetailScreen({ shipmentId }: { shipmentId: string }) {
  const { back } = useNav()
  const [doc, setDoc] = useState<ShipmentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [packLine, setPackLine] = useState<ShipmentLine | null>(null)
  const [confirmAdvance, setConfirmAdvance] = useState(false)

  const load = useCallback((signal?: AbortSignal) => {
    setError('')
    return getShipment(shipmentId, signal)
      .then((d) => { if (!signal?.aborted) setDoc(d) })
      .catch((err) => { if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить задачу') })
      .finally(() => { if (!signal?.aborted) setLoading(false) })
  }, [shipmentId])

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    return () => ac.abort()
  }, [load])

  const reloadAc = useRef<AbortController | null>(null)
  const reload = useCallback(() => {
    reloadAc.current?.abort()
    const ac = new AbortController()
    reloadAc.current = ac
    return load(ac.signal)
  }, [load])
  useEffect(() => () => reloadAc.current?.abort(), [])

  // Стабильный request_id на «Передать кладовщику» (идемпотентность при обрыве сети).
  const advanceReqId = useRef<string>('')
  function advanceId(): string {
    return (advanceReqId.current ||= newRequestId())
  }

  const totalPool = useMemo(
    () => (doc?.lines ?? []).reduce((s, l) => s + Math.max(0, l.available_for_pack), 0),
    [doc],
  )

  async function doAdvance() {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await advanceShipment(shipmentId, advanceId())
      advanceReqId.current = ''
      setConfirmAdvance(false)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось передать кладовщику')
    } finally {
      setSaving(false)
    }
  }

  const onPacking = doc?.status === 'on_packing'

  return (
    <div className="screen">
      <AppBar
        title={doc ? doc.doc_number : 'Упаковка'}
        sub={doc ? `${doc.cargo_type === 'defect' ? 'Брак' : 'Упаковка'} · ${SHIPMENT_STATUS_LABELS[doc.status]}` : undefined}
        onBack={back}
        noProfile
      />

      <div className="scroll pad-nav">
        {error && !doc && (
          <div className="alert">
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}

        {loading && !doc ? (
          <div className="center">
            <div className="spin" />
            <div>Загрузка…</div>
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
            </div>
            {doc.comment && (
              <div className="tzcard">
                <div className="tztitle">Техническое задание</div>
                <div className="tzbody">{doc.comment}</div>
              </div>
            )}

            {onPacking ? (
              <>
                <div className="sec">Упаковка — годный / брак</div>
                {doc.lines.map((l) => {
                  const done = l.available_for_pack === 0
                  return (
                    <div key={l.id} className="line">
                      <div className="line-name">{lineTitle(l)}</div>
                      <div className="line-sub mono">{l.product_sku}</div>
                      <div className="pack-meter">
                        <div className="pack-meter-top">
                          <div className="pack-meter-count">
                            <b style={{ color: 'var(--c-success)' }}>{l.packed_good}</b>
                            <span className="pack-meter-of"> годн</span>
                            <span className="pack-meter-of"> · </span>
                            <b style={{ color: l.packed_defect > 0 ? 'var(--c-danger)' : 'var(--c-text-faint)' }}>{l.packed_defect}</b>
                            <span className="pack-meter-of"> брак · план {l.qty}</span>
                          </div>
                          {done ? (
                            <span className="badge success">
                              <Icon name="check" size={12} /> Готово
                            </span>
                          ) : (
                            <span className="badge warning">осталось {l.available_for_pack}</span>
                          )}
                        </div>
                      </div>
                      <button className="btn sm" style={{ width: '100%', marginTop: 4 }} onClick={() => setPackLine(l)}>
                        <Icon name="edit" size={15} /> Внести упаковку
                      </button>
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
                  {totalPool > 0 && (
                    <div className="line-sub" style={{ color: 'var(--c-warning)', textAlign: 'center' }}>
                      На упаковке ещё {totalPool} шт без решения
                    </div>
                  )}
                  <button className="btn" disabled={saving} onClick={() => setConfirmAdvance(true)}>
                    <Icon name="check" size={18} /> Передать кладовщику
                  </button>
                </div>
              </>
            ) : doc.status === 'packing' ? (
              <div className="center">
                <div className="center-ico">
                  <Icon name="dolly" size={26} />
                </div>
                <div>Кладовщик перемещает товар в зону упаковки.</div>
                <div className="line-sub">Внести годный/брак можно, когда задача дойдёт до «На упаковке».</div>
              </div>
            ) : doc.status === 'relocating' ? (
              <>
                <div className="sec">Упаковано — кладовщик раскладывает по местам</div>
                {doc.lines.map((l) => (
                  <div key={l.id} className="line">
                    <div className="line-name">{lineTitle(l)}</div>
                    <div className="line-sub mono">{l.product_sku}</div>
                    <div className="line-sub">
                      годный <b style={{ color: 'var(--c-success)' }}>{l.packed_good}</b> · брак{' '}
                      <b style={{ color: l.packed_defect > 0 ? 'var(--c-danger)' : 'var(--c-text-faint)' }}>{l.packed_defect}</b>
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div className="center">
                <div className="center-ico green">
                  <Icon name="check" size={26} />
                </div>
                <div>{SHIPMENT_STATUS_LABELS[doc.status]}</div>
              </div>
            )}
          </>
        )}
      </div>

      {packLine && (
        <PackLineSheet
          docId={shipmentId}
          line={packLine}
          onClose={() => setPackLine(null)}
          onDone={reload}
        />
      )}

      {confirmAdvance && (
        <div className="sheet-backdrop" onClick={() => { if (!saving) setConfirmAdvance(false) }}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grip" />
            <h3>Передать кладовщику?</h3>
            <p className="line-sub" style={{ fontSize: 13, marginTop: 0 }}>
              Упаковка завершена. Кладовщик разложит годный и брак по местам.
              {totalPool > 0 ? ` На упаковке ещё ${totalPool} шт без решения.` : ''}
            </p>
            <div className="dtf-actions">
              <button className="btn ghost" disabled={saving} onClick={() => setConfirmAdvance(false)}>
                Отмена
              </button>
              <button className="btn" disabled={saving} onClick={() => void doAdvance()}>
                {saving ? '…' : 'Передать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PackLineSheet({
  docId,
  line,
  onClose,
  onDone,
}: {
  docId: string
  line: ShipmentLine
  onClose: () => void
  onDone: () => Promise<void> | void
}) {
  const [date, setDate] = useState(moscowTodayYmd())
  const [good, setGood] = useState(0)
  const [defect, setDefect] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [plan, setPlan] = useState(line.qty)
  const [pool, setPool] = useState(line.available_for_pack)
  const [packedGood, setPackedGood] = useState(line.packed_good)
  const [packedDefect, setPackedDefect] = useState(line.packed_defect)
  const [entries, setEntries] = useState<ShipmentPackingEntry[]>([])
  const [histLoading, setHistLoading] = useState(true)

  // Стабильные request_id для идемпотентности: один на текущее «Записать» (сбрасывается
  // после успеха → следующая запись получит новый), и по одному на отмену каждой записи.
  const packReqId = useRef<string>('')
  const reverseReqIds = useRef<Record<string, string>>({})

  const refreshSheet = useCallback((signal?: AbortSignal) => {
    setHistLoading(true)
    return getLinePacking(docId, line.id, signal)
      .then((d) => {
        if (signal?.aborted) return
        setPlan(d.plan)
        setPool(d.available_for_pack)
        setPackedGood(d.packed_good)
        setPackedDefect(d.packed_defect)
        setEntries(d.entries)
      })
      .catch(() => {})
      .finally(() => { if (!signal?.aborted) setHistLoading(false) })
  }, [docId, line.id])

  useEffect(() => {
    const ac = new AbortController()
    refreshSheet(ac.signal)
    return () => ac.abort()
  }, [refreshSheet])

  const add = good + defect
  const overPool = add > pool
  const overPlan = packedGood + good > plan
  const reasons: string[] = [
    ...(!date ? ['Укажите дату упаковки'] : []),
    ...(add <= 0 ? ['Укажите количество годного или брака'] : []),
    ...(overPlan ? [`Годного с учётом записи больше плана (${plan} шт)`] : []),
    ...(overPool ? [`На упаковке доступно ${pool} шт — уменьшите количество`] : []),
  ]

  async function submit() {
    if (saving) return
    if (reasons.length > 0) { setError(reasons[0]); return }
    setSaving(true)
    setError('')
    try {
      const reqId = (packReqId.current ||= newRequestId())
      await recordPacking(docId, line.id, { good_delta: good, defect_delta: defect, packed_date: date }, reqId)
      packReqId.current = ''
      setGood(0)
      setDefect(0)
      await refreshSheet()
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось внести упаковку')
    } finally {
      setSaving(false)
    }
  }

  async function reverse(entryId: string) {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const reqId = (reverseReqIds.current[entryId] ||= newRequestId())
      await reversePackingEntry(docId, line.id, entryId, reqId)
      delete reverseReqIds.current[entryId]
      await refreshSheet()
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отменить запись')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={() => { if (!saving) onClose() }}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h3>Внести упаковку</h3>
        <div className="line-sub" style={{ marginTop: -4 }}>{line.product_name} · <span className="mono">{line.product_sku}</span></div>

        <div className="summary" style={{ margin: '12px 0' }}>
          <div className="kv"><span className="k">План</span><span className="v">{plan}</span></div>
          <div className="kv"><span className="k">На упаковке</span><span className="v">{pool}</span></div>
          <div className="kv">
            <span className="k">Упаковано</span>
            <span className="v">
              <b style={{ color: 'var(--c-success)' }}>{packedGood}</b>
              <span style={{ color: 'var(--c-text-faint)' }}> / </span>
              <b style={{ color: packedDefect > 0 ? 'var(--c-danger)' : 'var(--c-text-faint)' }}>{packedDefect}</b>
            </span>
          </div>
        </div>

        <div className="line-row" style={{ marginTop: 0 }}>
          <DateField value={date} onChange={setDate} title="Дата упаковки" />
        </div>
        <div className="line-row">
          <span style={{ flex: '0 0 64px', color: 'var(--c-success)', fontSize: 13 }}>Годный</span>
          <input
            className="input num"
            type="text"
            inputMode="numeric"
            value={good || ''}
            onChange={(e) => setGood(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          />
        </div>
        <div className="line-row">
          <span style={{ flex: '0 0 64px', color: 'var(--c-danger)', fontSize: 13 }}>Брак</span>
          <input
            className="input num"
            type="text"
            inputMode="numeric"
            value={defect || ''}
            onChange={(e) => setDefect(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          />
        </div>

        {error && (
          <div className="alert" style={{ marginTop: 10 }}>
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}

        <div className="dtf-actions">
          <button className="btn ghost" disabled={saving} onClick={onClose}>Закрыть</button>
          <button className="btn" disabled={saving} onClick={() => void submit()}>
            {saving ? '…' : <><Icon name="check" size={18} /> Записать</>}
          </button>
        </div>

        <div className="sec" style={{ marginTop: 16 }}>История упаковки</div>
        {histLoading ? (
          <div className="line-sub" style={{ textAlign: 'center', padding: '12px 0' }}>Загрузка…</div>
        ) : entries.length === 0 ? (
          <div className="line-sub" style={{ textAlign: 'center', padding: '12px 0' }}>Записей пока нет</div>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="line-row" style={{ marginTop: 0, padding: '8px 0', borderBottom: '1px solid var(--c-border)', opacity: e.reversed ? 0.5 : 1 }}>
              <span className="mono" style={{ fontSize: 13, textDecoration: e.reversed ? 'line-through' : 'none' }}>
                {fmtDate(e.packed_date)}
              </span>
              <span style={{ flex: 1, fontSize: 13, textDecoration: e.reversed ? 'line-through' : 'none' }}>
                {e.good > 0 && <span style={{ color: 'var(--c-success)' }}>+{e.good} годн</span>}
                {e.good > 0 && e.defect > 0 && <span style={{ color: 'var(--c-text-faint)' }}> · </span>}
                {e.defect > 0 && <span style={{ color: 'var(--c-danger)' }}>+{e.defect} брак</span>}
              </span>
              {e.reversed ? (
                <span className="line-sub" style={{ fontSize: 12 }}>Отменено</span>
              ) : (
                <button className="btn ghost sm auto" disabled={saving} onClick={() => void reverse(e.id)}>
                  <Icon name="refresh" size={13} /> Отменить
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
