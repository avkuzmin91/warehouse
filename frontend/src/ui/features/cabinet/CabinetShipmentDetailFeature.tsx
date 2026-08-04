import { getCabinetShipment, cabinetShipmentStatusLabel, cabinetShipmentStatusTone } from '../../../api/cabinetApi'
import { useApi } from '../../../hooks/useApi'
import { Table, Td } from '../../data/Table'
import { DetailPage } from '../../layouts/DetailPage'
import { Badge } from '../../primitives/Badge'
import type { BadgeTone } from '../../primitives/Badge'
import { EmptyState } from '../../primitives/EmptyState'
import { Icon } from '../../primitives/Icon'
import { SkeletonRows } from '../../primitives/Skeleton'
import { fmtDate } from '../../../utils/format'
import { CabinetTimeline, CabinetTrack, CellProg, cabinetOpTone, cabinetShipmentTrack } from './shared/cabinetUI'

interface Props {
  docId: string
}

export function CabinetShipmentDetailFeature({ docId }: Props) {
  const { data, loading, error } = useApi((signal) => getCabinetShipment(docId, signal), [docId])

  if (error) {
    return (
      <DetailPage title="Отгрузка" backTo="/cabinet/shipments">
        <EmptyState title="Документ недоступен" sub={error.message} />
      </DetailPage>
    )
  }

  const doc = data?.doc
  const lines = data?.lines ?? []
  const isDefect = doc?.cargo_type === 'defect'
  const storeNames = [...new Set(lines.map((l) => l.store_name).filter(Boolean))] as string[]
  const totalQty = lines.reduce((sum, l) => sum + l.qty, 0)
  const totalShipped = lines.reduce((sum, l) => sum + l.shipped_qty, 0)
  const track = doc ? cabinetShipmentTrack(doc.status, doc.cargo_type) : null

  return (
    <DetailPage
      title={doc ? `${isDefect ? 'Возврат брака' : doc.cargo_type === 'good_unpacked' ? 'Отгрузка без упаковки' : 'Отгрузка'} ${doc.doc_number}` : 'Отгрузка'}
      subtitle={storeNames.length > 0 ? storeNames.join(', ') : undefined}
      backTo="/cabinet/shipments"
      actions={doc && (
        <Badge tone={cabinetShipmentStatusTone(doc.status) as BadgeTone} dot>
          {cabinetShipmentStatusLabel(doc.status, doc.cargo_type)}
        </Badge>
      )}
    >
      <div className="card" style={{ padding: '18px 22px', marginBottom: 16 }}>
        {track && <CabinetTrack {...track} />}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 16,
          ...(track ? { marginTop: 20, paddingTop: 18, borderTop: '1px solid var(--c-border)' } : {}),
        }}>
          <div>
            <div className="t-sub">Дата отгрузки (план)</div>
            <div className="dt" style={{ fontWeight: 500, color: 'var(--c-text)' }}>{fmtDate(doc?.ship_date ?? null)}</div>
          </div>
          <div>
            <div className="t-sub">Дата отгрузки (факт)</div>
            {doc?.actual_ship_date
              ? <div className="dt" style={{ fontWeight: 500, color: 'var(--c-text)' }}>{fmtDate(doc.actual_ship_date)}</div>
              : <div className="dash" style={{ fontWeight: 500 }}>—</div>}
          </div>
          <div>
            <div className="t-sub">План, шт</div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{totalQty.toLocaleString('ru-RU')}</div>
          </div>
          <div>
            <div className="t-sub">Отгружено, шт</div>
            <div className="row gap-8">
              <span style={{ fontWeight: 600, fontSize: 15, color: totalShipped >= totalQty && totalQty > 0 ? 'var(--c-success)' : 'var(--c-accent)' }}>
                {totalShipped.toLocaleString('ru-RU')}
              </span>
              <div className="prog" style={{ width: 70 }}>
                <i className="prog-fill" style={{ width: `${totalQty > 0 ? Math.min(100, (totalShipped / totalQty) * 100) : 0}%`, background: 'var(--c-accent)', display: 'block' }} />
              </div>
            </div>
          </div>
        </div>
        {(data?.trips ?? []).length > 0 && (
          <div className="row gap-8" style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--c-border)', flexWrap: 'wrap' }}>
            <span className="t-sub">Рейсы:</span>
            {(data?.trips ?? []).map((t) => (
              <Badge key={t.id} tone="info">{t.number}</Badge>
            ))}
          </div>
        )}
      </div>

      <div className="split-360" style={{ gridTemplateColumns: '1fr 340px' }}>
        <section>
          <Table>
            <thead>
              <tr>
                <th>Товар</th>
                <th style={{ width: 140 }}>Магазин</th>
                <th style={{ width: 80, textAlign: 'right' }}>План</th>
                <th style={{ width: 180, textAlign: 'right' }}>Отгружено</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={4} cols={4} />
              ) : lines.length === 0 ? (
                <tr><Td colSpan={4}><EmptyState title="Строк нет" /></Td></tr>
              ) : (
                lines.map((l) => (
                  <tr key={l.id}>
                    <Td>
                      <div style={{ fontWeight: 500 }}>{l.product_name}</div>
                      <div className="t-sub mono">
                        {[l.product_sku, l.color_name, l.size_name].filter(Boolean).join(' · ')}
                      </div>
                      {l.site_url && (
                        <div style={{ marginTop: 4 }}>
                          <a
                            href={l.site_url}
                            target="_blank"
                            rel="noreferrer"
                            className="row gap-8"
                            style={{ fontSize: 11.5, color: 'var(--c-accent)', textDecoration: 'none' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Icon name="cart" size={11} />Страница на сайте
                          </a>
                        </div>
                      )}
                    </Td>
                    <Td>{l.store_name ?? '—'}</Td>
                    <Td className="num">{l.qty.toLocaleString('ru-RU')}</Td>
                    <Td className="num">
                      <div className="cellprog">
                        <span><b>{l.shipped_qty.toLocaleString('ru-RU')}</b></span>
                        <CellProg value={l.shipped_qty} max={l.qty} color="var(--c-accent)" />
                      </div>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </section>

        <section className="card" style={{ padding: '12px 16px' }}>
          <div className="row gap-8" style={{ marginBottom: 4 }}>
            <Icon name="pulse" size={14} className="ic-accent" />
            <span className="card-head-title">История</span>
          </div>
          {loading ? (
            <div className="t-sub">Загрузка…</div>
          ) : (data?.ops ?? []).length === 0 ? (
            <div className="t-sub" style={{ padding: '6px 0' }}>Событий пока нет</div>
          ) : (
            <CabinetTimeline
              items={(data?.ops ?? []).map((op) => ({
                text: op.comment || op.op_type,
                createdAt: op.created_at,
                tone: cabinetOpTone(op.op_type),
              }))}
            />
          )}
        </section>
      </div>
    </DetailPage>
  )
}
