import { getCabinetShipment, cabinetShipmentStatusLabel, cabinetShipmentStatusTone } from '../../../api/cabinetApi'
import { useApi } from '../../../hooks/useApi'
import { Table, Td } from '../../data/Table'
import { DetailPage } from '../../layouts/DetailPage'
import { Badge } from '../../primitives/Badge'
import type { BadgeTone } from '../../primitives/Badge'
import { EmptyState } from '../../primitives/EmptyState'
import { Icon } from '../../primitives/Icon'
import { SkeletonRows } from '../../primitives/Skeleton'
import { fmtDate, fmtDateTime } from '../../../utils/format'

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
  const isDefect = doc?.cargo_type === 'defect'
  const storeNames = [...new Set((data?.lines ?? []).map((l) => l.store_name).filter(Boolean))] as string[]

  return (
    <DetailPage
      title={doc ? `${isDefect ? 'Возврат брака' : 'Отгрузка'} ${doc.doc_number}` : 'Отгрузка'}
      subtitle={storeNames.length > 0 ? `Магазины: ${storeNames.join(', ')}` : undefined}
      backTo="/cabinet/shipments"
      actions={doc && (
        <Badge tone={cabinetShipmentStatusTone(doc.status) as BadgeTone} dot>
          {cabinetShipmentStatusLabel(doc.status, doc.cargo_type)}
        </Badge>
      )}
    >
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
          <div>
            <div className="t-sub">Дата отгрузки (план)</div>
            <div style={{ fontWeight: 500 }}>{fmtDate(doc?.ship_date ?? null)}</div>
          </div>
          <div>
            <div className="t-sub">Дата отгрузки (факт)</div>
            <div style={{ fontWeight: 500 }}>{fmtDate(doc?.actual_ship_date ?? null)}</div>
          </div>
          <div>
            <div className="t-sub">Перевозчик</div>
            <div style={{ fontWeight: 500 }}>{doc?.carrier || '—'}</div>
          </div>
          <div>
            <div className="t-sub">План, шт.</div>
            <div className="num" style={{ fontWeight: 500 }}>
              {(data?.lines ?? []).reduce((sum, l) => sum + l.qty, 0).toLocaleString('ru-RU')}
            </div>
          </div>
          <div>
            <div className="t-sub">Отгружено, шт.</div>
            <div className="num" style={{ fontWeight: 500 }}>
              {(data?.lines ?? []).reduce((sum, l) => sum + l.shipped_qty, 0).toLocaleString('ru-RU')}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <section>
          <div className="card-head" style={{ marginBottom: 8 }}>
            <span className="card-head-title">Товары</span>
          </div>
          <Table>
            <thead>
              <tr>
                <th>Товар</th>
                <th style={{ width: 140 }}>Магазин</th>
                <th style={{ width: 80, textAlign: 'right' }}>План</th>
                <th style={{ width: 120, textAlign: 'right' }}>Упаковано</th>
                <th style={{ width: 100, textAlign: 'right' }}>Отгружено</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={4} cols={5} />
              ) : (data?.lines ?? []).length === 0 ? (
                <tr><Td colSpan={5}><EmptyState title="Строк нет" /></Td></tr>
              ) : (
                (data?.lines ?? []).map((l) => (
                  <tr key={l.id}>
                    <Td>
                      <div style={{ fontWeight: 500 }}>{l.product_name}</div>
                      <div className="t-sub mono">
                        {[l.product_sku, l.color_name, l.size_name].filter(Boolean).join(' · ')}
                      </div>
                      {l.files.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                          {l.files.map((f, index) => (
                            <a
                              key={index}
                              href={f.url}
                              target="_blank"
                              rel="noreferrer"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Icon name="paperclip" size={12} />{f.filename}
                            </a>
                          ))}
                        </div>
                      )}
                    </Td>
                    <Td>{l.store_name ?? '—'}</Td>
                    <Td className="num">{l.qty.toLocaleString('ru-RU')}</Td>
                    <Td className="num">
                      {l.packed_good.toLocaleString('ru-RU')}
                      {l.packed_defect > 0 && (
                        <span style={{ color: 'var(--c-warning)' }}> +{l.packed_defect.toLocaleString('ru-RU')} брак</span>
                      )}
                    </Td>
                    <Td className="num">{l.shipped_qty.toLocaleString('ru-RU')}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </section>

        <section>
          <div className="card-head" style={{ marginBottom: 8 }}>
            <span className="card-head-title">События</span>
          </div>
          <div className="card" style={{ padding: 12 }}>
            {loading ? (
              <div className="t-sub">Загрузка…</div>
            ) : (data?.ops ?? []).length === 0 ? (
              <div className="t-sub">Событий пока нет</div>
            ) : (
              (data?.ops ?? []).map((op, index) => (
                <div key={index} style={{ padding: '6px 0', borderBottom: index < (data?.ops.length ?? 0) - 1 ? '1px solid var(--c-border)' : 'none' }}>
                  <div style={{ fontSize: 13 }}>{op.comment || op.op_type}</div>
                  <div className="t-sub" style={{ fontSize: 11 }}>{fmtDateTime(op.created_at)}</div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </DetailPage>
  )
}
