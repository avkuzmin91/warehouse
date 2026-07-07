import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getPackingDay, SHIPMENT_STATUS_LABELS } from '../../../api/shipmentsApi'
import type { PackingDayDoc, PackingDayLine, ShipmentStatus } from '../../../api/shipmentsApi'
import { Drawer } from '../../feedback/Drawer'
import { Icon } from '../../primitives/Icon'
import { useApi } from '../../../hooks/useApi'
import { formatMoneyKopecks, parseMoscow, MOSCOW_TZ } from '../../../utils/format'

const GOOD = 'var(--c-success)'
const DEFECT = 'var(--c-warning)'

function dayTitle(ymd: string): string {
  const d = parseMoscow(ymd)
  if (Number.isNaN(d.getTime())) return ymd
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long', timeZone: MOSCOW_TZ })
}

function QtyPair({ good, defect }: { good: number; defect: number }) {
  return (
    <span className="mono" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', flexShrink: 0, whiteSpace: 'nowrap' }}>
      {good > 0 && <span style={{ color: GOOD }}>{good.toLocaleString('ru-RU')}</span>}
      {good > 0 && defect > 0 && <span style={{ color: 'var(--c-text-faint)' }}> · </span>}
      {defect > 0 && <span style={{ color: DEFECT }}>{defect.toLocaleString('ru-RU')}</span>}
      <span style={{ color: 'var(--c-text-faint)' }}> шт</span>
    </span>
  )
}

function LineRow({ line, money }: { line: PackingDayLine; money: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '7px 12px 7px 34px', fontSize: 12.5,
      borderTop: '1px solid var(--c-border)', color: 'var(--c-text)',
    }}>
      <span style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {line.product_name ?? line.product_sku ?? '—'}
        </span>
        {line.product_sku && line.product_name && (
          <span className="mono" style={{ fontSize: 11, color: 'var(--c-text-faint)' }}>{line.product_sku}</span>
        )}
      </span>
      {money && line.price_missing && (
        <span style={{ fontSize: 10.5, color: 'var(--c-warning)', flexShrink: 0 }}>тариф не задан</span>
      )}
      {money && !line.price_missing && line.earn_kop > 0 && (
        <span className="mono" style={{ fontSize: 12, color: 'var(--c-text-muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
          {formatMoneyKopecks(line.earn_kop)}
        </span>
      )}
      <QtyPair good={line.good} defect={line.defect} />
    </div>
  )
}

function DocBlock({ doc, money }: { doc: PackingDayDoc; money: boolean }) {
  const [open, setOpen] = useState(false)
  const statusLabel = SHIPMENT_STATUS_LABELS[doc.status as ShipmentStatus] ?? doc.status
  return (
    <div style={{ borderTop: '1px solid var(--c-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px 4px 4px' }}>
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 4px', background: 'transparent', border: 'none',
            cursor: 'pointer', font: 'inherit', color: 'var(--c-text)', textAlign: 'left',
          }}
        >
          <Icon name={open ? 'chevDown' : 'chev'} size={14} />
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="mono" style={{ fontSize: 13, fontWeight: 600, flexShrink: 0 }}>{doc.doc_number}</span>
              <span style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {doc.client_name ?? '—'}
              </span>
            </span>
            <span style={{ fontSize: 11, color: 'var(--c-text-faint)' }}>{statusLabel}</span>
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
            <QtyPair good={doc.good} defect={doc.defect} />
            {money && (doc.earn_kop > 0 || doc.price_missing) && (
              <span className="mono" style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: doc.price_missing ? 'var(--c-warning)' : 'var(--c-text-muted)' }}>
                {doc.price_missing && doc.earn_kop === 0 ? 'без тарифа' : formatMoneyKopecks(doc.earn_kop)}
              </span>
            )}
          </span>
        </button>
        <Link
          to={`/inventory/shipments/${doc.doc_id}`}
          className="btn ghost icon sm"
          title="Открыть задачу упаковки"
          style={{ flexShrink: 0 }}
        >
          <Icon name="arrowRight" size={14} />
        </Link>
      </div>
      {open && doc.lines.map((l) => <LineRow key={l.product_id} line={l} money={money} />)}
    </div>
  )
}

export function PackingDayDrawer({ day, clientId, onClose }: {
  day: string | null
  clientId?: string
  onClose: () => void
}) {
  const { data, loading, error } = useApi(
    (s) => (day ? getPackingDay({ date: day, client_id: clientId || undefined }, s) : Promise.resolve(null)),
    [day, clientId],
  )
  const money = data?.with_earnings ?? false

  return (
    <Drawer
      open={day != null}
      onClose={onClose}
      closeOnBackdrop
      title={day ? dayTitle(day) : ''}
      subtitle="Задачи упаковки за день"
      width={440}
    >
      {loading && !data ? (
        <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>Загрузка…</div>
      ) : error ? (
        <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--c-danger)', fontSize: 13 }}>{error.message}</div>
      ) : !data ? null : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: money ? '1fr 1fr 1fr' : '1fr 1fr', gap: 8 }}>
            <KpiMini label="Годный" value={`${data.good.toLocaleString('ru-RU')} шт`} tone={GOOD} />
            <KpiMini label="Брак" value={`${data.defect.toLocaleString('ru-RU')} шт`} tone={DEFECT} />
            {money && <KpiMini label="Заработок" value={formatMoneyKopecks(data.earn_kop)} tone="var(--c-text)" />}
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--c-text-subtle)', textTransform: 'uppercase', letterSpacing: '.03em' }}>
                Задачи упаковки
              </span>
              <span className="mono" style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{data.docs.length}</span>
            </div>
            <div style={{ border: '1px solid var(--c-border)', borderTop: 'none', borderRadius: 8, overflow: 'hidden' }}>
              {data.docs.length === 0 ? (
                <div style={{ padding: '14px 12px', borderTop: '1px solid var(--c-border)', fontSize: 12.5, color: 'var(--c-text-subtle)', textAlign: 'center' }}>
                  Нет за этот день
                </div>
              ) : data.docs.map((d) => <DocBlock key={d.doc_id} doc={d} money={money} />)}
            </div>
          </div>

          <div style={{ marginTop: 14, fontSize: 11.5, color: 'var(--c-text-faint)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="arrowRight" size={12} />
            Стрелка открывает карточку задачи упаковки
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
      <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: tone, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  )
}
