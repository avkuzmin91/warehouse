import { Icon } from '../../../../primitives/Icon'
import type { IconName } from '../../../../primitives/Icon'
import { Badge } from '../../../../primitives/Badge'
import { TRIP_LOAD_LABELS } from '../../../../../api/tripsApi'
import type { TripDetail, TripLoadFactor } from '../../../../../api/tripsApi'
import { ReceiptsBlock } from '../ReceiptsBlock'
import type { ReceiptEnrich } from '../ReceiptsBlock'

function Chip({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', borderRadius: 99,
      border: '1px solid var(--c-border)', background: 'var(--c-bg-elev)', fontSize: 12.5, color: 'var(--c-text-muted)',
    }}>
      <Icon name={icon} size={13} style={{ color: 'var(--c-text-subtle)' }} />{children}
    </span>
  )
}

function fmtTime(v: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function minutesSince(v: string | null): number | null {
  if (!v) return null
  const ms = Date.now() - new Date(v).getTime()
  if (Number.isNaN(ms) || ms < 0) return null
  return Math.round(ms / 60000)
}

export function AwaitingView({ detail, loadFactor, onLoadFactor, busy, enrich, onBack, onArrival, onUnload, onOpenReceipt }: {
  detail: TripDetail
  loadFactor: TripLoadFactor
  onLoadFactor: (v: TripLoadFactor) => void
  busy: boolean
  enrich?: ReceiptEnrich
  onBack: () => void
  onArrival: () => void
  onUnload: () => void
  onOpenReceipt: (id: string) => void
}) {
  const { doc, receipts } = detail
  const unloading = doc.status === 'unloading'
  const inWork = minutesSince(doc.arrived_at)

  return (
    <div className="page" style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <button className="btn ghost icon sm" onClick={onBack}><Icon name="arrowLeft" size={14} /></button>
        <span style={{ fontSize: 22, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{doc.trip_number}</span>
        <Badge tone="info" dot>{unloading ? 'Разгрузка' : 'Ожидает прибытия'}</Badge>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {doc.vehicle_type_name && <Chip icon="truckIn">{doc.vehicle_type_name}</Chip>}
          {doc.carrier_name && <Chip icon="user">{doc.carrier_name}</Chip>}
          {doc.origin_name && <Chip icon="map">{doc.origin_name}</Chip>}
        </div>
      </div>

      <div style={{
        border: `1.5px solid var(--c-info)`, borderRadius: 'var(--r-lg)', overflow: 'hidden',
        boxShadow: '0 0 0 4px color-mix(in oklab, var(--c-info) 8%, transparent)', marginBottom: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 18 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14, flexShrink: 0, color: 'var(--c-info)',
            background: 'var(--c-info-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name={unloading ? 'forklift' : 'clock'} size={28} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{unloading ? 'Идёт разгрузка' : 'Ожидает прибытия машины'}</div>
            <div style={{ fontSize: 13, color: 'var(--c-text-muted)', marginTop: 2 }}>
              {unloading
                ? <>Прибыла в <b>{fmtTime(doc.arrived_at)}</b>{inWork != null ? <> · в работе <b>{inWork} мин</b></> : null}</>
                : <>Транспорт заказан <b>{doc.transport_ordered_at ? fmtTime(doc.transport_ordered_at) : '—'}</b></>}
            </div>
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--c-border)', padding: 18, display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          {unloading && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--c-text-muted)', marginBottom: 7 }}>Загруженность</div>
              <div style={{ display: 'inline-flex', gap: 4, padding: 4, background: 'var(--c-bg-sunken)', borderRadius: 10 }}>
                {(['full', 'partial'] as TripLoadFactor[]).map((v) => {
                  const on = v === loadFactor
                  return (
                    <button
                      key={v}
                      onClick={() => onLoadFactor(v)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 7, height: 44, padding: '0 18px', border: 0, cursor: 'pointer',
                        borderRadius: 7, fontSize: 14, fontWeight: 500, fontFamily: 'inherit',
                        background: on ? 'var(--c-bg-elev)' : 'transparent', color: on ? 'var(--c-text)' : 'var(--c-text-muted)',
                        boxShadow: on ? 'var(--sh-1)' : 'none',
                      }}
                    >
                      <Icon name={v === 'full' ? 'check' : 'alert'} size={15} />{TRIP_LOAD_LABELS[v]}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          <button
            onClick={unloading ? onUnload : onArrival}
            disabled={busy}
            className="btn primary"
            style={{ marginLeft: 'auto', height: 52, padding: '0 28px', fontSize: 15.5, borderRadius: 12 }}
          >
            <Icon name={unloading ? 'check' : 'truckIn'} size={18} />
            {unloading ? 'Завершить разгрузку' : 'Машина приехала'}
          </button>
        </div>

        {unloading && (
          <div style={{ background: 'var(--c-bg-sunken)', padding: '11px 18px', fontSize: 12, color: 'var(--c-text-muted)', display: 'flex', gap: 6 }}>
            <Icon name="arrowRight" size={13} style={{ color: 'var(--c-text-faint)', flexShrink: 0, marginTop: 2 }} />
            <span>После завершения {receipts.length} поступления уйдут в статус <b>«На приёмке»</b>, а рейс — менеджеру на уточнение стоимости.</span>
          </div>
        )}
      </div>

      <ReceiptsBlock
        title="В машине"
        right={<span style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>{receipts.length} поступления</span>}
        receipts={receipts}
        enrich={enrich}
        onOpen={onOpenReceipt}
      />
    </div>
  )
}
