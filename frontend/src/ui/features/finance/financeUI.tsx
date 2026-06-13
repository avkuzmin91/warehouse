import type { ReactNode } from 'react'
import { Icon } from '../../primitives/Icon'
import type { IconName } from '../../primitives/Icon'
import { Badge } from '../../primitives/Badge'
import { formatMoneyKopecks } from '../../../utils/format'

/** Компактные деньги для KPI: рубли без копеек, не растягивают карточку. «2 400 000 ₽». */
export function kpiMoney(kopecks: number): string {
  const rub = Math.floor(Math.abs(kopecks) / 100)
  return `${rub.toLocaleString('ru-RU')} ₽`
}

export type KpiTone = 'default' | 'warning' | 'danger'

/** KPI-карточка реестра счетов: иконка-акцент, метка, крупное число, подпись. */
export function Kpi({ icon, label, value, sub, tone = 'default' }: {
  icon: IconName
  label: string
  value: ReactNode
  sub?: string
  tone?: KpiTone
}) {
  const accent = tone === 'danger' ? 'var(--c-danger)' : tone === 'warning' ? 'var(--c-warning)' : 'var(--c-accent)'
  const valueColor = tone === 'danger' ? 'var(--c-danger)' : tone === 'warning' ? 'var(--c-warning)' : 'var(--c-text)'
  return (
    <div className="kpi">
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <div style={{
          width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `color-mix(in oklab, ${accent} 12%, transparent)`, color: accent,
        }}>
          <Icon name={icon} size={14} />
        </div>
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-value" style={{ fontSize: 24, color: valueColor, marginTop: 8 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

/** Мини-прогресс оплаты для строк реестра: «оплачено» + полоска. */
export function PayBar({ total, paid }: { total: number; paid: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0
  const full = paid >= total && total > 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
      <span className="mono" style={{ fontSize: 12.5, color: full ? 'var(--c-success)' : paid > 0 ? 'var(--c-text)' : 'var(--c-text-faint)' }}>
        {formatMoneyKopecks(paid)}
      </span>
      <div className="prog" style={{ width: 46, height: 5, flexShrink: 0 }}>
        <div className={`prog-fill ${full ? 'ok' : 'warn'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/** Финансовая сводка карточки — главный акцент: Сумма · Оплачено · Остаток · Срок + прогресс оплаты. */
export function FinanceSummary({ total, paid, dueDate, overdue, cancelled }: {
  total: number
  paid: number
  dueDate: string
  overdue: boolean
  cancelled: boolean
}) {
  const remaining = Math.max(0, total - paid)
  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0
  const full = paid >= total && total > 0
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr) 1.2fr' }}>
        <FinCell label="Сумма счёта" value={formatMoneyKopecks(total)} />
        <FinCell label="Оплачено" value={formatMoneyKopecks(paid)} tone={full ? 'success' : paid > 0 ? 'info' : undefined} />
        <FinCell label="Остаток" value={cancelled ? '—' : formatMoneyKopecks(remaining)}
          tone={cancelled ? undefined : remaining > 0 ? 'warning' : full ? 'success' : undefined} big />
        <div style={{
          padding: '16px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6,
          borderLeft: '1px solid var(--c-border)', background: 'var(--c-bg-sunken)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
            <Icon name="calendar" size={13} />Срок расчёта
          </div>
          <div className="mono" style={{ fontSize: 15, fontWeight: 600, color: overdue ? 'var(--c-danger)' : 'var(--c-text)' }}>
            {dueDate}
          </div>
          {overdue && <Badge tone="danger" dot>Просрочен</Badge>}
        </div>
      </div>
      <div style={{ padding: '0 18px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <span style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>Прогресс оплаты</span>
          <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: full ? 'var(--c-success)' : 'var(--c-text-muted)' }}>
            {cancelled ? '—' : `${pct}%`}
          </span>
        </div>
        <div className="prog" style={{ height: 8 }}>
          <div className={`prog-fill ${full ? 'ok' : 'warn'}`} style={{ width: `${cancelled ? 0 : pct}%` }} />
        </div>
      </div>
    </div>
  )
}

function FinCell({ label, value, tone, big }: {
  label: string
  value: string
  tone?: 'success' | 'warning' | 'info'
  big?: boolean
}) {
  const color = tone === 'success' ? 'var(--c-success)' : tone === 'warning' ? 'var(--c-warning)'
    : tone === 'info' ? 'var(--c-info)' : 'var(--c-text)'
  return (
    <div style={{ padding: '16px 18px' }}>
      <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginBottom: 4 }}>{label}</div>
      <div className="mono" style={{ fontSize: big ? 24 : 20, fontWeight: 600, letterSpacing: '-0.02em', color }}>{value}</div>
    </div>
  )
}

/** Секция карточки счёта в стиле фазового блока (дизайн redesign-scheta):
 *  active — акцентная рамка + мягкое свечение + подкрашенная шапка + акцентная иконка;
 *  done — нейтральная рамка, обычная шапка, зелёная (success) иконка. */
export function InvoiceSection({ icon, title, count, accent = 'var(--c-accent)', state = 'done', right, children }: {
  icon: IconName
  title: string
  count?: number
  accent?: string
  state?: 'active' | 'done'
  right?: ReactNode
  children: ReactNode
}) {
  const isActive = state === 'active'
  const isDone = state === 'done'
  return (
    <div style={{
      border: `1px solid ${isActive ? accent : 'var(--c-border)'}`,
      borderRadius: 'var(--r-lg)', background: 'var(--c-bg-elev)', overflow: 'hidden',
      boxShadow: isActive ? `0 0 0 3px color-mix(in oklab, ${accent} 8%, transparent)` : 'none',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9, padding: '11px 14px',
        borderBottom: '1px solid var(--c-border)',
        background: isActive ? `color-mix(in oklab, ${accent} 5%, var(--c-bg-elev))` : 'var(--c-bg-sunken)',
      }}>
        <div style={{
          width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          background: isDone ? 'var(--c-success-bg)' : `color-mix(in oklab, ${accent} 14%, transparent)`,
          color: isDone ? 'var(--c-success)' : accent,
        }}>
          <Icon name={icon} size={14} />
        </div>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        {count != null && (
          <span style={{
            fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--c-text-subtle)',
            background: 'var(--c-bg-elev)', border: '1px solid var(--c-border)', padding: '1px 7px', borderRadius: 99,
          }}>{count}</span>
        )}
        {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
      </div>
      <div style={{ padding: 14 }}>{children}</div>
    </div>
  )
}

/** Тип груза отгрузки: годный / брак. */
export function CargoTag({ cargoType }: { cargoType: string }) {
  return cargoType === 'defect'
    ? <Badge tone="danger">Брак</Badge>
    : <span style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>Годный</span>
}

/** Иконка файла по расширению (Excel — зелёная, PDF — красная). */
export function FileTypeIcon({ filename }: { filename: string }) {
  const lower = filename.toLowerCase()
  const isXls = lower.endsWith('.xlsx') || lower.endsWith('.xls')
  const isPdf = lower.endsWith('.pdf')
  const isImg = /\.(png|jpe?g|gif|webp)$/.test(lower)
  const name: IconName = isXls ? 'fileXls' : isPdf ? 'filePdf' : isImg ? 'fileImg' : 'file'
  const color = isXls ? 'var(--c-success)' : isPdf ? 'var(--c-danger)' : 'var(--c-accent)'
  return <Icon name={name} size={15} style={{ color }} />
}
