import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getPnlDay } from '../../../../api/pnlApi'
import type { PnlDayItem, PnlDaySource } from '../../../../api/pnlApi'
import { Drawer } from '../../../feedback/Drawer'
import { Icon } from '../../../primitives/Icon'
import { useApi } from '../../../../hooks/useApi'
import { dayFull, fmtRub, fmtSignedRub, incomeColor } from './PnlFeature'

function linkFor(it: PnlDayItem): string | null {
  if (!it.ref_id) return null
  switch (it.ref_kind) {
    case 'dispatch': return `/inventory/dispatches/${it.ref_id}`
    case 'receipt':  return `/inventory/receipts/${it.ref_id}`
    case 'trip':     return `/logistics/trips/${it.ref_id}`
    case 'employee': return `/timesheet/employees/${it.ref_id}`
    default:         return null
  }
}

function ItemRow({ it, onNavigate }: { it: PnlDayItem; onNavigate: () => void }) {
  const to = linkFor(it)
  const inner = (
    <>
      <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {it.label}
        {it.note && <span style={{ color: 'var(--c-text-faint)' }}> · {it.note}</span>}
      </span>
      <span className="mono" style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums', color: 'var(--c-text-muted)' }}>
        {fmtRub(it.amount)}
      </span>
      {to && <Icon name="arrowRight" size={12} />}
    </>
  )
  const style: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '7px 12px 7px 30px', fontSize: 12.5,
    borderTop: '1px solid var(--c-border)', color: 'var(--c-text)',
  }
  return to
    ? <Link to={to} onClick={onNavigate} style={{ ...style, textDecoration: 'none', cursor: 'pointer' }}>{inner}</Link>
    : <div style={style}>{inner}</div>
}

function SourceBlock({ src, color, onNavigate }: {
  src: PnlDaySource
  color: string
  onNavigate: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ borderTop: '1px solid var(--c-border)' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 12px', background: 'transparent', border: 'none',
          cursor: 'pointer', font: 'inherit', color: 'var(--c-text)',
        }}
      >
        <Icon name={open ? 'chevDown' : 'chev'} size={14} />
        <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
        <span style={{ flex: 1, textAlign: 'left', fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{src.label}</span>
        <span className="mono" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: 13 }}>{fmtRub(src.amount)}</span>
      </button>
      {open && src.items.map((it, i) => <ItemRow key={i} it={it} onNavigate={onNavigate} />)}
    </div>
  )
}

function Section({ title, total, sources, colorFor, onNavigate }: {
  title: string
  total: number
  sources: PnlDaySource[]
  colorFor: (s: PnlDaySource) => string
  onNavigate: () => void
}) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--c-text-subtle)', textTransform: 'uppercase', letterSpacing: '.03em' }}>{title}</span>
        <span className="mono" style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{fmtRub(total)} ₽</span>
      </div>
      <div style={{ border: '1px solid var(--c-border)', borderTop: 'none', borderRadius: 8, overflow: 'hidden' }}>
        {sources.length === 0 ? (
          <div style={{ padding: '14px 12px', borderTop: '1px solid var(--c-border)', fontSize: 12.5, color: 'var(--c-text-subtle)', textAlign: 'center' }}>Нет за этот день</div>
        ) : sources.map((s) => <SourceBlock key={s.key} src={s} color={colorFor(s)} onNavigate={onNavigate} />)}
      </div>
    </div>
  )
}

export function PnlDayDrawer({ day, from, to, expColor = {}, mode = 'both', clientId, onClose }: {
  day: string | null
  from: string
  to: string
  expColor?: Record<string, string>
  mode?: 'both' | 'income' | 'expense'
  clientId?: string
  onClose: () => void
}) {
  const { data, loading, error } = useApi(
    (s) => (day ? getPnlDay({ date: day, date_from: from, date_to: to, client_id: clientId || undefined }, s) : Promise.resolve(null)),
    [day, from, to, clientId],
  )

  return (
    <Drawer
      open={day != null}
      onClose={onClose}
      closeOnBackdrop
      title={day ? dayFull(day) : ''}
      subtitle={mode === 'income' ? 'Из чего сложился доход дня' : mode === 'expense' ? 'Из чего сложился расход дня' : 'Из чего сложился доход и расход дня'}
      width={440}
    >
      {loading && !data ? (
        <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>Загрузка…</div>
      ) : error ? (
        <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--c-danger)', fontSize: 13 }}>{error.message}</div>
      ) : !data ? null : (
        <>
          {mode === 'both' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <KpiMini label="Доход" value={fmtRub(data.income_total)} tone="var(--c-success)" />
              <KpiMini label="Расход" value={fmtRub(data.expense_total)} tone="var(--c-danger)" />
              <KpiMini label="Итог" value={fmtSignedRub(data.net_total)} tone={data.net_total >= 0 ? 'var(--c-success)' : 'var(--c-danger)'} />
            </div>
          )}

          {mode !== 'expense' && (
            <Section
              title="Доход · как посчитан"
              total={data.income_total}
              sources={data.income_sources}
              colorFor={(s) => incomeColor(s.key)}
              onNavigate={onClose}
            />
          )}
          {mode !== 'income' && (
            <Section
              title="Расход · как посчитан"
              total={data.expense_total}
              sources={data.expense_categories}
              colorFor={(s) => expColor[s.key] ?? 'var(--c-text-faint)'}
              onNavigate={onClose}
            />
          )}

          <div style={{ marginTop: 14, fontSize: 11.5, color: 'var(--c-text-faint)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="arrowRight" size={12} />
            Строки со стрелкой открывают исходный документ
          </div>
        </>
      )}
    </Drawer>
  )
}

function KpiMini({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div style={{ background: 'var(--c-bg-sunken)', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>{label}</div>
      <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: tone, fontVariantNumeric: 'tabular-nums' }}>{value}<span style={{ fontSize: 11, fontWeight: 400, color: 'var(--c-text-faint)' }}> ₽</span></div>
    </div>
  )
}
