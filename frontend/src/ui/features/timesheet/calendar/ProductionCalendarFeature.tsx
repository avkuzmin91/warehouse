import { useMemo, useState } from 'react'
import {
  deleteCalendarDay,
  getProductionCalendar,
  setCalendarDay,
} from '../../../../api/productionCalendarApi'
import { ListPage } from '../../../layouts/ListPage'
import { Icon } from '../../../primitives/Icon'
import { SkeletonRows } from '../../../primitives/Skeleton'
import { EmptyState } from '../../../primitives/EmptyState'
import { useApi } from '../../../../hooks/useApi'
import { useToast } from '../../../feedback/Toast'
import { useConfirm } from '../../../feedback/ConfirmDialog'
import { moscowTodayYmd } from '../../../../utils/format'

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]
const WD_HEAD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

const pad = (n: number) => String(n).padStart(2, '0')
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
// Воскресенье (Date.getDay() === 0) — нерабочий по умолчанию (правило 6/1).
const defaultWorking = (dt: Date) => dt.getDay() !== 0

function buildGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month - 1, 1)
  const startDow = (first.getDay() + 6) % 7 // Пн = 0
  const daysIn = new Date(year, month, 0).getDate()
  const cells: (Date | null)[] = Array(startDow).fill(null)
  for (let d = 1; d <= daysIn; d++) cells.push(new Date(year, month - 1, d))
  while (cells.length % 7) cells.push(null)
  return cells
}

export function ProductionCalendarFeature() {
  const toast = useToast()
  const confirm = useConfirm()
  const today = moscowTodayYmd()
  const [ym, setYm] = useState<{ y: number; m: number }>(() => {
    const [yy, mm] = today.split('-').map(Number)
    return { y: yy, m: mm }
  })
  const [tick, setTick] = useState(0)
  const [marking, setMarking] = useState<{ iso: string } | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const { data, loading, error } = useApi(
    (s) => getProductionCalendar(ym.y, ym.m, s),
    [ym.y, ym.m, tick],
  )

  const overrides = useMemo(() => {
    const map: Record<string, { is_working: boolean; reason: string | null }> = {}
    for (const it of data?.items ?? []) map[it.cal_date] = { is_working: it.is_working, reason: it.reason }
    return map
  }, [data])

  const grid = useMemo(() => buildGrid(ym.y, ym.m), [ym])
  const reload = () => setTick((t) => t + 1)

  function shiftMonth(delta: number) {
    setMarking(null)
    setYm(({ y, m }) => {
      const next = new Date(y, m - 1 + delta, 1)
      return { y: next.getFullYear(), m: next.getMonth() + 1 }
    })
  }

  function effWorking(dt: Date): boolean {
    const iso = isoOf(ym.y, ym.m, dt.getDate())
    const ov = overrides[iso]
    return ov ? ov.is_working : defaultWorking(dt)
  }

  async function onDayClick(dt: Date) {
    const iso = isoOf(ym.y, ym.m, dt.getDate())
    const ov = overrides[iso]
    const def = defaultWorking(dt)
    const eff = ov ? ov.is_working : def

    if (eff) {
      // Рабочий → отметить нерабочим: спросить причину в панели.
      setReason('')
      setMarking({ iso })
      return
    }
    // Нерабочий → вернуть в рабочий режим.
    if (ov && !def) {
      // Воскресенье, которое уже сделали рабочим/нерабочим вручную — переключаем напрямую.
    }
    if (ov && ov.is_working === def) {
      // совпадает с дефолтом — нечего делать
      return
    }
    if (!def) {
      // Дефолтное воскресенье → сделать рабочим (override is_working=true).
      setBusy(true)
      try {
        await setCalendarDay({ cal_date: iso, is_working: true, reason: null })
        toast('Воскресенье отмечено рабочим', 'success')
        reload()
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error')
      } finally { setBusy(false) }
      return
    }
    // Будний день, помеченный нерабочим (праздник) → снять исключение.
    const ok = await confirm({
      title: 'Вернуть день в рабочий режим?',
      body: `Исключение на ${iso} будет снято, день снова станет рабочим.`,
      confirmLabel: 'Вернуть',
    })
    if (!ok) return
    setBusy(true)
    try {
      await deleteCalendarDay(iso)
      toast('День возвращён в рабочий режим', 'success')
      reload()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally { setBusy(false) }
  }

  async function confirmMarkOff() {
    if (!marking) return
    setBusy(true)
    try {
      await setCalendarDay({ cal_date: marking.iso, is_working: false, reason: reason.trim() || null })
      toast('День отмечен нерабочим', 'success')
      setMarking(null)
      reload()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally { setBusy(false) }
  }

  return (
    <ListPage
      title="Производственный календарь"
      subtitle="Рабочие дни для разнесения оклада. По умолчанию рабочий — любой день, кроме воскресенья (6/1); отметьте праздники и внеплановые закрытия."
      actions={
        <div className="row gap-8" style={{ alignItems: 'center' }}>
          <button className="btn icon" onClick={() => shiftMonth(-1)} title="Предыдущий месяц">
            <Icon name="chev" size={16} style={{ transform: 'rotate(180deg)' }} />
          </button>
          <div style={{ minWidth: 150, textAlign: 'center', fontWeight: 600 }}>
            {MONTHS[ym.m - 1]} {ym.y}
          </div>
          <button className="btn icon" onClick={() => shiftMonth(1)} title="Следующий месяц">
            <Icon name="chev" size={16} />
          </button>
        </div>
      }
    >
      {loading ? (
        <SkeletonRows rows={6} cols={7} />
      ) : error ? (
        <EmptyState title="Не удалось загрузить" sub={error.message} />
      ) : (
        <>
          <div style={{ marginBottom: 10, color: 'var(--c-text-muted)', fontSize: 13 }}>
            Рабочих дней в месяце: <b style={{ color: 'var(--c-text)' }}>{data?.working_days ?? 0}</b>
            <span style={{ marginLeft: 16, color: 'var(--c-text-subtle)' }}>
              Клик по рабочему дню — отметить нерабочим; по нерабочему — вернуть в работу.
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
            {WD_HEAD.map((w, i) => (
              <div key={w} style={{
                textAlign: 'center', fontSize: 12, fontWeight: 600,
                color: i === 6 ? 'var(--c-text-subtle)' : 'var(--c-text-muted)', paddingBottom: 2,
              }}>{w}</div>
            ))}
            {grid.map((dt, idx) => {
              if (!dt) return <div key={`e${idx}`} />
              const iso = isoOf(ym.y, ym.m, dt.getDate())
              const ov = overrides[iso]
              const working = effWorking(dt)
              const isException = !!ov && ov.is_working !== defaultWorking(dt)
              const isToday = iso === today
              return (
                <button
                  key={iso}
                  onClick={() => onDayClick(dt)}
                  disabled={busy}
                  title={ov?.reason || (working ? 'Рабочий день' : 'Нерабочий день')}
                  style={{
                    aspectRatio: '1 / 1', borderRadius: 10, cursor: 'pointer',
                    border: isToday ? '2px solid var(--c-accent)' : '1px solid var(--c-border)',
                    background: working ? 'var(--c-bg-elev)' : 'var(--c-bg-sunken)',
                    color: working ? 'var(--c-text)' : 'var(--c-text-subtle)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', gap: 2, padding: 4, position: 'relative',
                    opacity: working ? 1 : 0.7, textAlign: 'center',
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 15 }}>{dt.getDate()}</span>
                  {!working && <Icon name="x" size={11} style={{ color: 'var(--c-danger)' }} />}
                  {isException && (
                    <span style={{
                      position: 'absolute', top: 4, right: 5, width: 6, height: 6,
                      borderRadius: '50%', background: ov?.is_working ? 'var(--c-success)' : 'var(--c-warning)',
                    }} />
                  )}
                  {ov?.reason && (
                    <span style={{
                      fontSize: 9.5, lineHeight: 1.1, color: 'var(--c-text-subtle)',
                      overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', whiteSpace: 'nowrap',
                    }}>{ov.reason}</span>
                  )}
                </button>
              )
            })}
          </div>

          {marking && (
            <div className="card" style={{ marginTop: 14, padding: 14, maxWidth: 420 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                Отметить нерабочим: {marking.iso}
              </div>
              <input
                className="input sm"
                style={{ width: '100%', marginBottom: 10 }}
                placeholder="Причина (праздник, закрытие…) — необязательно"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                autoFocus
              />
              <div className="row gap-8">
                <button className="btn primary sm" onClick={confirmMarkOff} disabled={busy}>
                  <Icon name="check" size={13} />Отметить нерабочим
                </button>
                <button className="btn ghost sm" onClick={() => setMarking(null)} disabled={busy}>
                  Отмена
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </ListPage>
  )
}
