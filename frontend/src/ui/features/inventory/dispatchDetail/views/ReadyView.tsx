import type { DispatchCargoType, DispatchDetail } from '../../../../../api/dispatchApi'
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
}

export function ReadyView({ doc, onOpenTrip, onSavePallets, onSaveBoxes }: Props) {
  const { user } = useCurrentUser()
  const showCosts = canViewCosts(user)
  const isPreparing = doc.status === 'preparing'
  const isPartially = doc.status === 'partially_shipped'

  const planTotal = doc.lines.reduce((s, l) => s + l.qty, 0)
  const shippedTotal = doc.lines.reduce((s, l) => s + l.shipped_qty, 0)
  const skuCount = new Set(doc.lines.map((l) => l.product_sku)).size

  return (
    <>
      {isPreparing ? (
        <Alert tone="info" style={{ marginBottom: 16 }}>
          Кладовщик готовит отгрузку — указывает ячейки и переводит товар в «Готов к отгрузке». Привязать к рейсу можно уже сейчас, но увезти — только после подготовки.
        </Alert>
      ) : isPartially ? (
        <Alert tone="warning" style={{ marginBottom: 16 }}>
          Часть отгрузки уже уехала. Остаток ожидает следующих рейсов — спишется при их отправке.
          {doc.can_close_short && ' Если остаток больше не поедет — закройте отгрузку с недовозом.'}
        </Alert>
      ) : (
        <Alert tone="warning" style={{ marginBottom: 16 }}>
          Отгрузка ожидает привязки и отправки рейса — товар спишется при отправке привязанного рейса.
        </Alert>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Panel icon="file" title="Основная информация">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <ReadField label="Клиент" value={doc.client_name ?? '—'} />
              <ReadField label="Дата отгрузки (план)" value={fmtDateLong(doc.ship_date)} />
              {showCosts && (
                <ReadField label="Стоимость логистики, ₽" value={doc.logistics_cost != null ? doc.logistics_cost.toLocaleString('ru-RU') : '—'} mono />
              )}
            </div>
            <div style={{ marginTop: 14 }}>
              <div className="field-label"><span>Техническое задание</span></div>
              <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{doc.comment || '—'}</div>
            </div>
          </Panel>

          <Panel icon="boxes" title="Состав отгрузки">
            <LinesTable lines={doc.lines} onSavePallets={onSavePallets} onSaveBoxes={onSaveBoxes} />
          </Panel>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <RailPanel status={doc.status} ops={doc.ops} cargoType={doc.cargo_type as DispatchCargoType} />

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
              <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--c-text-subtle)', lineHeight: 1.5 }}>
                Списание остатков происходит при отправке рейса.
              </div>
            </Panel>
          )}

          <Panel icon="chart" title="Отгрузка по рейсам">
            <div style={{ padding: '0 2px' }}>
              <ReadRow label="SKU" mono>{skuCount}</ReadRow>
              <ReadRow label="План" mono>{planTotal} шт</ReadRow>
              <ReadRow label="Отгружено" mono><span style={{ color: 'var(--c-success)' }}>{shippedTotal} шт</span></ReadRow>
              <div style={{ borderTop: '1px solid var(--c-border)', marginTop: 4, paddingTop: 6 }}>
                <ReadRow label="Осталось увезти" mono strong>{Math.max(0, planTotal - shippedTotal)} шт</ReadRow>
              </div>
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
