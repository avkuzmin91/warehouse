import { Icon } from '../../primitives/Icon'
import { getInitials } from '../../primitives/Avatar'
import { DAY_STATUS_LABELS, DAY_STATUS_TONE, type DayStatus } from '../../../api/timesheetApi'

export {
  fmtMoney,
  fmtMoneyShort,
  fmtRate,
  fmtHours,
  rublesToKopecks,
  DAY_STATUS_LABELS,
  DAY_STATUS_TONE,
} from '../../../api/timesheetApi'

/** Локальная дата → 'YYYY-MM-DD'. Через toISOString нельзя: в UTC+ часах день уезжает назад. */
function isoLocal(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** ISO-дата + смещение в днях → ISO. */
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return isoLocal(d)
}

/** Суббота расчётной недели (Сб→Пт) для даты — повторяет backend week_start_for. */
export function weekStartIso(d: Date): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  copy.setDate(copy.getDate() - ((copy.getDay() - 6 + 7) % 7)) // getDay: Сб=6
  return isoLocal(copy)
}

/** Суббота следующей расчётной недели от сегодня. */
export function nextWeekStartIso(): string {
  const t = new Date()
  return weekStartIso(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 7))
}

/** Бейдж в стиле дизайн-системы: точка currentColor + текст. */
export function Badge({ tone = '', dot, children }: { tone?: string; dot?: boolean; children: React.ReactNode }) {
  return (
    <span className={`badge ${tone}`.trim()}>
      {dot && (
        <span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor', display: 'inline-block', marginRight: 5 }} />
      )}
      {children}
    </span>
  )
}

export function DayStatusBadge({ status }: { status: DayStatus }) {
  return <Badge tone={DAY_STATUS_TONE[status]} dot={status !== 'off'}>{DAY_STATUS_LABELS[status]}</Badge>
}

export function PayTypeBadge({ kind, label }: { kind: string; label: string }) {
  return <Badge tone={kind === 'advance' ? 'warning' : 'accent'} dot>{label}</Badge>
}

/** Аватар-инициалы (мягкий градиент, как в дизайне). */
export function EmpAvatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span
      style={{
        width: size, height: size, flex: `0 0 ${size}px`, borderRadius: '50%',
        background: 'linear-gradient(135deg, #d9c5fb, #b6e3dc)', color: 'var(--c-accent-text)',
        fontSize: size * 0.4, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {getInitials(name)}
    </span>
  )
}

export function MiniStat({
  icon, label, value, tone, muted,
}: { icon: string; label: string; value: string; tone?: 'danger' | 'accent'; muted?: boolean }) {
  const col = tone === 'danger' ? 'var(--c-danger)' : tone === 'accent' ? 'var(--c-accent-text)' : 'var(--c-text)'
  return (
    <div style={{
      flex: 1, minWidth: 150, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
      background: 'var(--c-bg-elev)', border: '1px solid var(--c-border)', borderRadius: 'var(--r-lg)',
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `color-mix(in oklab, ${tone === 'danger' ? 'var(--c-danger)' : 'var(--c-accent)'} 12%, transparent)`,
        color: tone === 'danger' ? 'var(--c-danger)' : 'var(--c-accent)',
      }}>
        <Icon name={icon as never} size={15} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>{label}</div>
        <div style={{ fontSize: muted ? 12.5 : 14.5, fontWeight: muted ? 500 : 700, color: muted ? 'var(--c-text-subtle)' : col, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      </div>
    </div>
  )
}

/** Навигатор недели: ◀ [метка] ▶ + «Сегодня». */
export function WeekNavigator({
  label, onPrev, onNext, onToday,
}: { label: string; onPrev: () => void; onNext: () => void; onToday: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--c-border-strong)', borderRadius: 'var(--r-md)', overflow: 'hidden', background: 'var(--c-bg-elev)' }}>
        <button className="btn ghost icon sm" style={{ borderRadius: 0, borderRight: '1px solid var(--c-border)' }} onClick={onPrev} title="Предыдущая неделя">
          <Icon name="chev" size={14} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 12px', height: 30 }}>
          <Icon name="calendar" size={14} style={{ color: 'var(--c-text-subtle)' }} />
          <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>
        </div>
        <button className="btn ghost icon sm" style={{ borderRadius: 0, borderLeft: '1px solid var(--c-border)' }} onClick={onNext} title="Следующая неделя">
          <Icon name="chev" size={14} />
        </button>
      </div>
      <button className="btn sm" onClick={onToday}>Сегодня</button>
    </div>
  )
}

/** Центрированная модалка с шапкой и футером. */
export function ModalShell({
  title, subtitle, lead, width = 460, onClose, footer, children,
}: {
  title: string; subtitle?: string; lead?: React.ReactNode; width?: number
  onClose: () => void; footer: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(20,20,15,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width, maxWidth: '100%', maxHeight: '90vh', overflow: 'auto', background: 'var(--c-bg-elev)', borderRadius: 'var(--r-xl)', boxShadow: 'var(--sh-3)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 18px 14px', borderBottom: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          {lead}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)', marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button className="btn ghost icon sm" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--c-border)', background: 'var(--c-bg)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>{footer}</div>
      </div>
    </div>
  )
}

export function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--c-text-muted)' }}>{children}</span>
      {required && <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--c-text-faint)' }}>обяз.</span>}
    </div>
  )
}

export function ReadRow({ label, children, tone }: { label: string; children: React.ReactNode; tone?: 'danger' | 'success' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '5px 0' }}>
      <span style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>{label}</span>
      <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: tone === 'danger' ? 'var(--c-danger)' : tone === 'success' ? 'var(--c-success)' : 'var(--c-text)' }}>{children}</span>
    </div>
  )
}

/** Цвета фона/маркера ячейки дня по статусу. */
export const CELL_TONE: Record<DayStatus, { line: string; bg: string }> = {
  worked: { line: 'var(--c-success)', bg: 'color-mix(in oklab, var(--c-success) 7%, transparent)' },
  planned: { line: 'var(--c-info)', bg: 'color-mix(in oklab, var(--c-info) 6%, transparent)' },
  absent: { line: 'var(--c-danger)', bg: 'color-mix(in oklab, var(--c-danger) 7%, transparent)' },
  noplan: { line: 'var(--c-warning)', bg: 'color-mix(in oklab, var(--c-warning) 8%, transparent)' },
  off: { line: 'transparent', bg: 'transparent' },
}
