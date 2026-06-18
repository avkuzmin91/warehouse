import { Modal } from '../../../feedback/Modal'
import { Icon } from '../../../primitives/Icon'
import { formatMoneyKopecks } from '../../../../utils/format'
import type { DictionaryItem } from '../../../../api/domainTypes'

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}

/** Все наши склады со ставкой аренды + суммарная месячная стоимость аренды. */
export function RentRosterModal({ warehouses, onClose }: {
  warehouses: DictionaryItem[]
  onClose: () => void
}) {
  const rented = warehouses
    .filter((w) => w.is_active && (w.rent_monthly_kopecks ?? 0) > 0)
    .sort((a, b) => (b.rent_monthly_kopecks ?? 0) - (a.rent_monthly_kopecks ?? 0))
  const monthlyTotal = rented.reduce((sum, w) => sum + (w.rent_monthly_kopecks ?? 0), 0)

  return (
    <Modal
      open onClose={onClose} width={520}
      title="Склады в аренде"
      subtitle={`Стоимость аренды · ${rented.length} ${plural(rented.length, 'склад', 'склада', 'складов')}`}
    >
      {rented.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 13, color: 'var(--c-text-subtle)' }}>
          Складов в аренде нет. Ставка аренды задаётся в справочнике «Наши склады».
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rented.map((w, i) => (
            <div
              key={w.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0',
                borderBottom: i < rented.length - 1 ? '1px solid var(--c-border)' : 'none',
              }}
            >
              <Icon name="building" size={14} style={{ color: 'var(--c-text-faint)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</div>
              </div>
              <span className="num" style={{ fontWeight: 600, fontSize: 13.5 }}>{formatMoneyKopecks(w.rent_monthly_kopecks ?? 0)}</span>
            </div>
          ))}
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginTop: 12, paddingTop: 12, borderTop: '2px solid var(--c-border-strong)',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600 }}>Итого в месяц</span>
            <span className="num" style={{ fontWeight: 700, fontSize: 15 }}>{formatMoneyKopecks(monthlyTotal)}</span>
          </div>
        </div>
      )}
    </Modal>
  )
}
