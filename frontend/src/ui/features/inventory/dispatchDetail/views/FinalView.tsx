import type { DispatchDetail } from '../../../../../api/dispatchApi'
import { Icon } from '../../../../primitives/Icon'
import { Alert } from '../../../../primitives/Alert'
import { Panel, ReadRow, RailPanel } from '../components/processUI'
import { LinesTable } from '../components/LinesTable'
import { fmtDateLong } from '../../../../../utils/format'
import { canViewCosts } from '../../../../../utils/access'
import { useCurrentUser } from '../../../../../hooks/useCurrentUser'

type Props = {
  doc: DispatchDetail
  onOpenTrip: (id: string) => void
  onSavePallets?: (lineId: string, pallets: number | null) => Promise<boolean>
  onSaveBoxes?: (lineId: string, boxes: number | null) => Promise<boolean>
  palletsNotice?: string
}

export function FinalView({ doc, onOpenTrip, onSavePallets, onSaveBoxes, palletsNotice }: Props) {
  const { user } = useCurrentUser()
  const showCosts = canViewCosts(user)
  const isCancelled = doc.status === 'cancelled'

  const planTotal = doc.lines.reduce((s, l) => s + l.qty, 0)
  const shippedTotal = doc.lines.reduce((s, l) => s + l.shipped_qty, 0)
  const skuCount = new Set(doc.lines.map((l) => l.product_sku)).size

  return (
    <>
      {isCancelled ? (
        <Alert tone="danger" icon={false} style={{ marginBottom: 16 }}>
          Отгрузка аннулирована.
        </Alert>
      ) : (
        <Alert tone="success" style={{ marginBottom: 16 }}>
          Отгрузка полностью отгружена рейсами и списана с остатков.
        </Alert>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Panel icon="file" title="Основная информация">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <ReadField label="Клиент" value={doc.client_name ?? '—'} />
              <ReadField label="Дата отгрузки (план)" value={fmtDateLong(doc.ship_date)} />
              <ReadField label="Дата отгрузки (факт)" value={fmtDateLong(doc.actual_ship_date)} />
              {showCosts && (
                <ReadField label="Стоимость логистики, ₽" value={doc.logistics_cost != null ? doc.logistics_cost.toLocaleString('ru-RU') : '—'} mono />
              )}
            </div>
          </Panel>

          <Panel icon="boxes" title="Состав отгрузки">
            <LinesTable lines={doc.lines} onSavePallets={onSavePallets} onSaveBoxes={onSaveBoxes} editNotice={palletsNotice} />
          </Panel>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <RailPanel status={doc.status} ops={doc.ops} />

          {doc.trips.length > 0 && (
            <Panel icon="truckOut" title={doc.trips.length > 1 ? 'Рейсы отгрузки' : 'Рейс отгрузки'}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {doc.trips.map((t) => (
                  <button
                    key={t.id}
                    className="btn ghost sm"
                    onClick={() => onOpenTrip(t.id)}
                    style={{ width: '100%', justifyContent: 'flex-start' }}
                  >
                    <Icon name="truckOut" size={13} />{t.number}
                  </button>
                ))}
              </div>
            </Panel>
          )}

          <Panel icon="chart" title="Итог отгрузки">
            <div style={{ padding: '0 2px' }}>
              <ReadRow label="SKU" mono>{skuCount}</ReadRow>
              <ReadRow label="План" mono>{planTotal} шт</ReadRow>
              <ReadRow label="Отгружено" mono>
                <span style={{ color: isCancelled ? 'var(--c-text-subtle)' : 'var(--c-success)' }}>{shippedTotal} шт</span>
              </ReadRow>
              {!isCancelled && (
                <div style={{ borderTop: '1px solid var(--c-border)', marginTop: 4, paddingTop: 6 }}>
                  <ReadRow label="Отгружено" mono strong>{fmtDateLong(doc.actual_ship_date)}</ReadRow>
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </>
  )
}

function ReadField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="field-label"><span>{label}</span></div>
      <div className={mono ? 'mono' : undefined} style={{ fontSize: 13, fontWeight: 500, minHeight: 30, display: 'flex', alignItems: 'center' }}>{value}</div>
    </div>
  )
}
