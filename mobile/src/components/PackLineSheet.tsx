import { useCallback, useEffect, useRef, useState } from 'react'
import { newRequestId } from '../api/http'
import {
  getLinePacking,
  recordPacking,
  reversePackingEntry,
  type ShipmentLine,
  type ShipmentPackingEntry,
} from '../api/shipmentsApi'
import { DateField } from './DateField'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { CollapsibleSection } from './CollapsibleSection'
import { fmtDate } from '../utils/format'

// Шторка «Внести упаковку»: годный/брак с датой + история записей с отменой.
// Общая для обеих задач склада — упаковки под отгрузку и упаковки с ТСД.
export function PackLineSheet({
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
  const [date, setDate] = useState('')
  const [goodStr, setGoodStr] = useState('')
  const [defectStr, setDefectStr] = useState('')
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

  const good = parseInt(goodStr, 10) || 0
  const defect = parseInt(defectStr, 10) || 0
  const dirty = good > 0 || defect > 0
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
      setGoodStr('')
      setDefectStr('')
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
    <Sheet onClose={onClose} dirty={dirty} locked={saving}>
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

        <div className="flabel" style={{ marginTop: 4 }}>Дата упаковки</div>
        <div className="line-row" style={{ marginTop: 0 }}>
          <DateField value={date} onChange={setDate} title="Дата упаковки" />
        </div>

        <div className="qrow good">
          <span className="qlabel"><span className="qdot" /> Годный</span>
          <input
            className="input num"
            type="text"
            inputMode="numeric"
            value={goodStr}
            onChange={(e) => setGoodStr(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <div className="qrow defect">
          <span className="qlabel"><span className="qdot" /> Брак</span>
          <input
            className="input num"
            type="text"
            inputMode="numeric"
            value={defectStr}
            onChange={(e) => setDefectStr(e.target.value.replace(/\D/g, ''))}
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
            {saving ? <span className="spin spin-sm" /> : <><Icon name="check" size={18} /> Записать</>}
          </button>
        </div>

        <CollapsibleSection title="История упаковки" count={histLoading ? undefined : entries.length} style={{ marginTop: 16 }}>
        {histLoading ? (
          <div className="line-sub" style={{ textAlign: 'center', padding: '12px 0' }}>Загрузка…</div>
        ) : entries.length === 0 ? (
          <div className="line-sub" style={{ textAlign: 'center', padding: '12px 0' }}>Записей пока нет</div>
        ) : (
          entries.map((e) => (
            <div key={e.id} className={`histrow${e.reversed ? ' reversed' : ''}`}>
              <span className="h-date">{fmtDate(e.packed_date)}</span>
              <span className={`h-delta${e.reversed ? ' struck' : ''}`}>
                {e.good > 0 && <span className="good">+{e.good} годн</span>}
                {e.good > 0 && e.defect > 0 && <span className="faint"> · </span>}
                {e.defect > 0 && <span className="defect">+{e.defect} брак</span>}
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
        </CollapsibleSection>
    </Sheet>
  )
}
