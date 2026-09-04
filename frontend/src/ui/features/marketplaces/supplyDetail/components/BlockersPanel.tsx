import { useNavigate } from 'react-router-dom'
import type { MpSupplyBlocker } from '../../../../../api/marketplacesApi'
import { Icon } from '../../../../primitives/Icon'

/** «Что мешает собрать» — выше состава и с действием на каждую причину:
 *  не предупреждение внизу списка, а первое, что видно, и что можно закрыть. */
export function BlockersPanel({ blockers, accountId }: { blockers: MpSupplyBlocker[]; accountId: string }) {
  const navigate = useNavigate()
  if (blockers.length === 0) return null
  return (
    <div
      style={{
        border: '1px solid var(--c-danger-bg)', background: 'var(--c-danger-bg)',
        borderRadius: 'var(--r-lg)', padding: '12px 14px', marginBottom: 12,
      }}
    >
      <div
        className="row gap-8"
        style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-danger)', marginBottom: 8 }}
      >
        <Icon name="alert" size={13} />
        Что мешает собрать — {blockers.length}
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {blockers.map((b, i) => (
          <div
            key={`${b.kind}-${i}`}
            className="row gap-8"
            style={{
              background: 'var(--c-bg-elev)', border: '1px solid var(--c-danger-bg)',
              borderRadius: 'var(--r-md)', padding: '7px 10px', fontSize: 12.5,
            }}
          >
            <span style={{ flex: 1 }}>{b.text}</span>
            <span style={{ color: 'var(--c-text-subtle)', fontSize: 11.5 }}>
              затронуто заказов: {b.orders_count}
            </span>
            {b.kind === 'unlinked' ? (
              <button
                className="btn sm"
                onClick={() => navigate(`/marketplaces/links?account=${accountId}&linked=unlinked`)}
              >
                Связать
              </button>
            ) : (
              <button className="btn sm" onClick={() => navigate('/inventory/balances')}>
                Открыть остаток
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
