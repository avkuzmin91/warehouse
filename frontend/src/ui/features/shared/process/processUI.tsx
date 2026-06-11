import type { ReactNode } from 'react'
import { Icon } from '../../../primitives/Icon'
import type { IconName } from '../../../primitives/Icon'

/** Карточка-панель правой колонки (Маршрут / Итого / Готовность / …). */
export function Panel({ icon, iconColor = 'var(--c-accent)', title, right, children, bodyPad = true }: {
  icon?: IconName
  iconColor?: string
  title: string
  right?: ReactNode
  children: ReactNode
  bodyPad?: boolean
}) {
  return (
    <div className="card">
      <div className="card-head">
        {icon && <Icon name={icon} size={15} style={{ color: iconColor }} />}
        <span className="card-head-title">{title}</span>
        {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
      </div>
      <div style={{ padding: bodyPad ? 14 : 0 }}>{children}</div>
    </div>
  )
}

/** Строка «метка — значение» в панелях-сводках. */
export function ReadRow({ label, children, mono, strong }: {
  label: string
  children: ReactNode
  mono?: boolean
  strong?: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '5px 0' }}>
      <span style={{ fontSize: 12.5, color: 'var(--c-text-muted)', whiteSpace: 'nowrap' }}>{label}</span>
      <span className={mono ? 'mono' : undefined} style={{
        fontSize: mono ? 12.5 : 13, fontWeight: strong ? 600 : 500, color: 'var(--c-text)', textAlign: 'right',
      }}>{children}</span>
    </div>
  )
}

export type ChecklistItem = { ok: boolean; label: string }

/** Чек-лист готовности к переходу хода. */
export function ChecklistPanel({ items, title = 'Готовность' }: { items: ChecklistItem[]; title?: string }) {
  const allOk = items.every((c) => c.ok)
  return (
    <Panel
      icon="check"
      iconColor={allOk ? 'var(--c-success)' : 'var(--c-text-subtle)'}
      title={title}
      right={<span style={{ fontSize: 12, fontWeight: 600, color: allOk ? 'var(--c-success)' : 'var(--c-warning)' }}>
        {allOk ? 'Готово' : 'Не готово'}</span>}
      bodyPad={false}
    >
      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            {c.ok ? (
              <span style={{
                width: 16, height: 16, borderRadius: 99, background: 'var(--c-success)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <Icon name="check" size={10} />
              </span>
            ) : (
              <span style={{ width: 16, height: 16, borderRadius: 99, border: '1.5px dashed var(--c-border-strong)', flexShrink: 0 }} />
            )}
            <span style={{ fontSize: 12.5, color: c.ok ? 'var(--c-text)' : 'var(--c-text-subtle)' }}>{c.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  )
}

/** Сетка заблокированных полей фазы — «заполнит позже». */
export function LockedGrid({ labels }: { labels: string[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(labels.length, 3)}, 1fr)`, gap: 14 }}>
      {labels.map((l) => (
        <div key={l}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--c-text-muted)', marginBottom: 6 }}>{l}</div>
          <div style={{ fontSize: 12.5, color: 'var(--c-text-faint)' }}>после</div>
        </div>
      ))}
    </div>
  )
}
