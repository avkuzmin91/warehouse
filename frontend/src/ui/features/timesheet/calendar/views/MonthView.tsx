import { useEffect, useMemo, useRef, useState } from 'react'
import { ListPage } from '../../../../layouts/ListPage'
import { Icon } from '../../../../primitives/Icon'
import { SkeletonRows } from '../../../../primitives/Skeleton'
import { EmptyState } from '../../../../primitives/EmptyState'
import { useApi } from '../../../../../hooks/useApi'
import { useToast } from '../../../../feedback/Toast'
import { moscowTodayYmd } from '../../../../../utils/format'
import {
  type BulkApplyMode,
  bulkSetCalendarDays,
  deleteCalendarDay,
  getProductionCalendar,
  setCalendarDay,
} from '../../../../../api/productionCalendarApi'
import {
  MONTHS, MONTHS_SHORT, WD_HEAD, isoRange, monthGrid, overridesFromItems, workingDays,
} from '../shared/calCore'
import { CalLegend } from '../components/CalLegend'
import { DayCell } from '../components/DayCell'
import { DayInspector } from '../components/DayInspector'
import { RangePanel } from '../components/RangePanel'

type Props = {
  year: number
  month: number
  onBack: () => void
  onNav: (year: number, month: number) => void
}

export function MonthView({ year, month, onBack, onNav }: Props) {
  const toast = useToast()
  const today = moscowTodayYmd()
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState(false)
  const [selection, setSelection] = useState<string[]>([])
  const anchor = useRef<string | null>(null)
  const dragging = useRef(false)

  const reload = () => setTick((t) => t + 1)

  const { data, loading, error } = useApi(
    (s) => getProductionCalendar(year, month, s),
    [year, month, tick],
  )

  const overrides = useMemo(() => overridesFromItems(data?.items), [data])
  const grid = useMemo(() => monthGrid(year, month), [year, month])
  const baseWd = useMemo(() => workingDays(year, month, {}), [year, month])

  // Сброс выбора при смене месяца.
  useEffect(() => { setSelection([]); anchor.current = null }, [year, month])

  // Завершение протягивания — глобально, чтобы поймать mouseup вне сетки.
  useEffect(() => {
    const up = () => { dragging.current = false }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  function onCellMouseDown(iso: string) {
    dragging.current = true
    anchor.current = iso
    setSelection([iso])
  }
  function onCellMouseEnter(iso: string) {
    if (!dragging.current || !anchor.current) return
    setSelection(isoRange(anchor.current, iso))
  }

  function shiftMonth(delta: number) {
    const next = new Date(year, month - 1 + delta, 1)
    onNav(next.getFullYear(), next.getMonth() + 1)
  }

  async function run(fn: () => Promise<unknown>, okMsg: string, clearSel = false) {
    setBusy(true)
    try {
      await fn()
      toast(okMsg, 'success')
      if (clearSel) { setSelection([]); anchor.current = null }
      reload()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const onSetWorking = (iso: string) => {
    if (!overrides[iso]) return // уже следует правилу 6/1 — нечего снимать
    void run(() => deleteCalendarDay(iso), 'День возвращён к правилу 6/1')
  }
  const onSetNonWorking = (iso: string, reason: string) =>
    void run(() => setCalendarDay({ cal_date: iso, is_working: false, reason: reason.trim() || null }), 'День отмечен нерабочим')
  const onSetWorkSun = (iso: string, reason: string) =>
    void run(() => setCalendarDay({ cal_date: iso, is_working: true, reason: reason.trim() || 'Доп. смена' }), 'Назначена доп. смена')
  const onSaveReason = (iso: string, isWorking: boolean, reason: string) =>
    void run(() => setCalendarDay({ cal_date: iso, is_working: isWorking, reason: reason.trim() || null }), 'Причина сохранена')
  const onBulkApply = (mode: BulkApplyMode, reason: string) =>
    void run(
      () => bulkSetCalendarDays({ dates: selection, mode, reason: reason.trim() || null }),
      `Применено к ${selection.length} дням`,
      true,
    )

  return (
    <ListPage
      title={`${MONTHS[month - 1]} ${year}`}
      subtitle="Клик по дню открывает его справа — статус и причина меняются явными кнопками. Потяните по дням, чтобы выбрать диапазон."
      actions={
        <div className="row gap-8" style={{ alignItems: 'center' }}>
          <button className="btn sm" onClick={onBack}><Icon name="grid" size={13} />К году</button>
          <div style={{
            display: 'flex', alignItems: 'center', border: '1px solid var(--c-border-strong)',
            borderRadius: 'var(--r-md)', overflow: 'hidden', background: 'var(--c-bg-elev)',
          }}>
            <button className="btn ghost icon sm" style={{ borderRadius: 0 }}
              onClick={() => shiftMonth(-1)} title="Предыдущий месяц">
              <Icon name="chev" size={14} style={{ transform: 'rotate(180deg)' }} />
            </button>
            <div style={{ padding: '0 12px', height: 30, display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 600, minWidth: 96, justifyContent: 'center' }}>
              {MONTHS_SHORT[month - 1]} {year}
            </div>
            <button className="btn ghost icon sm" style={{ borderRadius: 0 }}
              onClick={() => shiftMonth(1)} title="Следующий месяц">
              <Icon name="chev" size={14} />
            </button>
          </div>
        </div>
      }
    >
      {loading ? (
        <SkeletonRows rows={6} cols={7} />
      ) : error ? (
        <EmptyState title="Не удалось загрузить" sub={error.message} />
      ) : (
        <>
          <div className="card" style={{ padding: '10px 16px', display: 'inline-flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <Icon name="briefcase" size={16} style={{ color: 'var(--c-accent)' }} />
            <div>
              <div style={{ fontSize: 11.5, color: 'var(--c-text-muted)' }}>Рабочих дней в месяце</div>
              <div style={{ fontSize: 19, fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
                {data?.working_days ?? 0} <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--c-text-subtle)' }}>из {baseWd} по 6/1</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, alignItems: 'start' }}>
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 7 }}>
                {WD_HEAD.map((w, i) => (
                  <div key={w} style={{
                    textAlign: 'center', fontSize: 11.5, fontWeight: 600,
                    color: i === 6 ? 'var(--c-text-subtle)' : 'var(--c-text-muted)', paddingBottom: 2,
                  }}>{w}</div>
                ))}
                {grid.map((dt, idx) => {
                  const iso = dt ? `${year}-${String(month).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}` : ''
                  const inRange = selection.length > 1 && selection.includes(iso)
                  const selected = selection.length === 1 && selection[0] === iso
                  return (
                    <DayCell
                      key={idx}
                      dt={dt}
                      overrides={overrides}
                      selected={!!dt && selected}
                      inRange={!!dt && inRange}
                      today={today}
                      onMouseDown={onCellMouseDown}
                      onMouseEnter={onCellMouseEnter}
                    />
                  )
                })}
              </div>
              <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <CalLegend compact />
                <span style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="layers" size={12} />Потяните по дням, чтобы выбрать диапазон
                </span>
              </div>
            </div>

            {selection.length > 1 ? (
              <RangePanel
                dates={selection}
                busy={busy}
                onApply={onBulkApply}
                onClear={() => { setSelection([]); anchor.current = null }}
              />
            ) : (
              <DayInspector
                sel={selection[0] ?? null}
                overrides={overrides}
                today={today}
                busy={busy}
                onSetWorking={onSetWorking}
                onSetNonWorking={onSetNonWorking}
                onSetWorkSun={onSetWorkSun}
                onSaveReason={onSaveReason}
              />
            )}
          </div>
        </>
      )}
    </ListPage>
  )
}
