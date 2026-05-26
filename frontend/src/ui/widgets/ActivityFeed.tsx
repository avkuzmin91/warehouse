import { Icon } from '../primitives/Icon'
import { ACTIVITY_EVENTS } from './__mocks__/activity'
import type { ActivityEvent, ActivityTone } from './__mocks__/activity'

function toneBg(tone: ActivityTone): string {
  if (tone === 'accent')  return 'var(--c-accent-bg)'
  if (tone === 'success') return 'var(--c-success-bg)'
  if (tone === 'warning') return 'var(--c-warning-bg)'
  return 'var(--c-bg-sunken)'
}

function toneColor(tone: ActivityTone): string {
  if (tone === 'accent')  return 'var(--c-accent)'
  if (tone === 'success') return 'var(--c-success)'
  if (tone === 'warning') return 'var(--c-warning)'
  return 'var(--c-text-muted)'
}

function ActivityItem({ event, last }: { event: ActivityEvent; last: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '10px 14px',
      borderBottom: last ? 'none' : '1px solid var(--c-border)',
    }}>
      <div style={{
        width: 24, height: 24, borderRadius: 6, flex: '0 0 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: toneBg(event.tone),
        color: toneColor(event.tone),
      }}>
        <Icon name={event.icon} size={12} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 450 }}>{event.text}</div>
        <div className="text-xs subtle">{event.meta}</div>
      </div>
      <div className="text-xs faint mono" style={{ flex: '0 0 auto' }}>{event.time}</div>
    </div>
  )
}

export function ActivityFeed() {
  return (
    <div style={{ padding: '4px 0' }}>
      {ACTIVITY_EVENTS.map((event, i) => (
        <ActivityItem key={i} event={event} last={i === ACTIVITY_EVENTS.length - 1} />
      ))}
    </div>
  )
}
