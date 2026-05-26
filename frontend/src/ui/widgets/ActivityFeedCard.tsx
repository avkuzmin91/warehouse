import { Icon } from '../primitives/Icon'
import { ActivityFeed } from './ActivityFeed'

export function ActivityFeedCard() {
  return (
    <div className="card">
      <div className="card-head">
        <Icon name="clock" size={15} style={{ color: 'var(--c-accent)' }} />
        <div className="card-head-title">Лента событий</div>
        <div className="right">
          <a
            className="text-xs"
            style={{ color: 'var(--c-accent)', cursor: 'pointer' }}
            onClick={() => {}}
          >
            смотреть все
          </a>
        </div>
      </div>
      <ActivityFeed />
    </div>
  )
}
