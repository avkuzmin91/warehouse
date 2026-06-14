import { useState } from 'react'
import { getCabinetShipment, cabinetShipmentStatusLabel, cabinetShipmentStatusTone } from '../../../api/cabinetApi'
import { resolvePublicUploadSrc } from '../../../api/constants'
import { useApi } from '../../../hooks/useApi'
import { Table, Td } from '../../data/Table'
import { Lightbox, type LightboxImage } from '../../feedback/Lightbox'
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
  const [viewer, setViewer] = useState<{ images: LightboxImage[]; index: number } | null>(null)

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
  const totalPacked = lines.reduce((sum, l) => sum + l.packed_good + l.packed_defect, 0)
  const totalShipped = lines.reduce((sum, l) => sum + l.shipped_qty, 0)
  const track = doc ? cabinetShipmentTrack(doc.status, doc.cargo_type) : null

  return (
    <DetailPage
      title={doc ? `${isDefect ? 'Возврат брака' : 'Отгрузка'} ${doc.doc_number}` : 'Отгрузка'}
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
          gridTemplateColumns: 'repeat(5, 1fr)',
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
            <div className="t-sub">Перевозчик</div>
            <div style={{ fontWeight: 500 }}>{doc?.carrier || '—'}</div>
          </div>
          <div>
            <div className="t-sub">План, шт</div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{totalQty.toLocaleString('ru-RU')}</div>
          </div>
          <div>
            {doc?.status === 'shipped' ? (
              <>
                <div className="t-sub">Отгружено, шт</div>
                <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--c-success)' }}>{totalShipped.toLocaleString('ru-RU')}</div>
              </>
            ) : (
              <>
                <div className="t-sub">Упаковано, шт</div>
                <div className="row gap-8">
                  <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--c-info)' }}>{totalPacked.toLocaleString('ru-RU')}</span>
                  <div className="prog" style={{ width: 70 }}>
                    <i className="prog-fill" style={{ width: `${totalQty > 0 ? Math.min(100, (totalPacked / totalQty) * 100) : 0}%`, background: 'var(--c-info)', display: 'block' }} />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="split-360" style={{ gridTemplateColumns: '1fr 340px' }}>
        <section>
          <Table>
            <thead>
              <tr>
                <th>Товар</th>
                <th style={{ width: 140 }}>Магазин</th>
                <th style={{ width: 80, textAlign: 'right' }}>План</th>
                <th style={{ width: 180, textAlign: 'right' }}>Упаковано</th>
                <th style={{ width: 95, textAlign: 'right' }}>Отгружено</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={4} cols={5} />
              ) : lines.length === 0 ? (
                <tr><Td colSpan={5}><EmptyState title="Строк нет" /></Td></tr>
              ) : (
                lines.map((l) => (
                  <tr key={l.id}>
                    <Td>
                      <div style={{ fontWeight: 500 }}>{l.product_name}</div>
                      <div className="t-sub mono">
                        {[l.product_sku, l.color_name, l.size_name].filter(Boolean).join(' · ')}
                      </div>
                      {l.files.length > 0 && (
                        <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                          {l.files.map((f, index) => (
                            <button
                              key={index}
                              type="button"
                              className="att"
                              onClick={(e) => {
                                e.stopPropagation()
                                setViewer({
                                  images: l.files.map((file) => ({
                                    src: resolvePublicUploadSrc(file.url),
                                    caption: `${l.product_name} — ${file.filename}`,
                                  })),
                                  index,
                                })
                              }}
                            >
                              <Icon name="fileImg" size={11} />{f.filename}
                            </button>
                          ))}
                        </div>
                      )}
                    </Td>
                    <Td>{l.store_name ?? '—'}</Td>
                    <Td className="num">{l.qty.toLocaleString('ru-RU')}</Td>
                    <Td className="num">
                      <div className="cellprog">
                        <span>
                          <b>{l.packed_good.toLocaleString('ru-RU')}</b>
                          {l.packed_defect > 0 && (
                            <span style={{ color: 'var(--c-warning)', fontSize: 11.5 }}> +{l.packed_defect.toLocaleString('ru-RU')} брак</span>
                          )}
                        </span>
                        <CellProg value={l.packed_good + l.packed_defect} max={l.qty} color="var(--c-info)" />
                      </div>
                    </Td>
                    <Td className="num">
                      {l.shipped_qty > 0 ? l.shipped_qty.toLocaleString('ru-RU') : <span className="dash">0</span>}
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
          {!loading && lines.length > 0 && (
            <div className="t-sub mt-8" style={{ textAlign: 'right' }}>фото упаковки прикладывает склад</div>
          )}
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

      {viewer && (
        <Lightbox images={viewer.images} initialIndex={viewer.index} onClose={() => setViewer(null)} />
      )}
    </DetailPage>
  )
}
