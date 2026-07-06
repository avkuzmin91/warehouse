import { useNavigate } from 'react-router-dom'
import {
  getMpOrder,
  isMpOrderOverdue,
  MARKETPLACE_LABELS,
  marketplaceTone,
  MP_ORDER_STATUS_LABELS,
  mpOrderStatusTone,
} from '../../../api/marketplacesApi'
import type { MpOrderLine } from '../../../api/marketplacesApi'
import { DetailPage } from '../../layouts/DetailPage'
import { Table, Td } from '../../data/Table'
import { Badge } from '../../primitives/Badge'
import { EmptyState } from '../../primitives/EmptyState'
import { useApi } from '../../../hooks/useApi'
import { fmtDateTime, formatMoneyKopecks } from '../../../utils/format'

export function MpOrderDetailFeature({ orderId }: { orderId: string }) {
  const navigate = useNavigate()
  const { data, loading, error } = useApi((s) => getMpOrder(orderId, s), [orderId])

  if (loading) {
    return (
      <DetailPage title="Заказ" backTo="/marketplaces/orders">
        <div className="card" style={{ padding: 20, color: 'var(--c-text-subtle)', fontSize: 13 }}>Загрузка…</div>
      </DetailPage>
    )
  }
  if (error || !data) {
    return (
      <DetailPage title="Заказ" backTo="/marketplaces/orders">
        <EmptyState title="Не удалось загрузить" sub={error?.message ?? 'Заказ не найден'} />
      </DetailPage>
    )
  }

  const { doc, lines } = data
  const overdue = isMpOrderOverdue(doc)

  return (
    <DetailPage
      title={`Заказ ${doc.external_id}`}
      subtitle={`${MARKETPLACE_LABELS[doc.marketplace]} · ${doc.account_name}${doc.client_name ? ` · ${doc.client_name}` : ''}`}
      backTo="/marketplaces/orders"
    >
      <div className="card" style={{ padding: '12px 16px', marginBottom: 14 }}>
        <div className="row gap-8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <Badge tone={marketplaceTone(doc.marketplace)}>{MARKETPLACE_LABELS[doc.marketplace]}</Badge>
          <Badge tone={mpOrderStatusTone(doc.status)}>{MP_ORDER_STATUS_LABELS[doc.status]}</Badge>
          <span className="mono" style={{ fontSize: 12, color: 'var(--c-text-subtle)' }} title="Статус маркетплейса как есть">
            {doc.external_status}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--c-text-subtle)' }}>
            Создан: {doc.created_at_mp ? fmtDateTime(doc.created_at_mp) : '—'}
          </span>
          <span style={{ fontSize: 12.5, color: overdue ? 'var(--c-danger)' : 'var(--c-text-subtle)', fontWeight: overdue ? 600 : undefined }}>
            Дедлайн сборки: {doc.deadline_at
              ? `${doc.deadline_source === 'estimated' ? '~' : ''}${fmtDateTime(doc.deadline_at)}`
              : '—'}
          </span>
        </div>
      </div>

      <Table>
        <thead>
          <tr>
            <th>Товар на маркетплейсе</th>
            <th>Товар WMS</th>
            <th style={{ width: 90, textAlign: 'right' }}>Кол-во</th>
            <th style={{ width: 120, textAlign: 'right' }}>Цена</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr><td colSpan={4}><EmptyState title="Состав пуст" /></td></tr>
          ) : lines.map((line) => (
            <LineRow
              key={line.id}
              line={line}
              onLink={() => navigate(`/marketplaces/links?account=${doc.account_id}${line.offer_id ? `&search=${encodeURIComponent(line.offer_id)}` : ''}`)}
            />
          ))}
        </tbody>
      </Table>
    </DetailPage>
  )
}

function LineRow({ line, onLink }: { line: MpOrderLine; onLink: () => void }) {
  return (
    <tr>
      <Td>
        <span className="mono" style={{ fontWeight: 600 }}>{line.offer_id ?? '—'}</span>
        {line.title && <span style={{ color: 'var(--c-text-subtle)' }}> · {line.title}</span>}
        {line.external_size && <span style={{ color: 'var(--c-text-subtle)' }}> · {line.external_size}</span>}
      </Td>
      <Td>
        {line.linked ? (
          <>
            <span className="mono">{line.product_sku}</span>
            {line.product_name && <span> · {line.product_name}</span>}
            {(line.color_name || line.size_name) && (
              <span style={{ color: 'var(--c-text-subtle)' }}> · {[line.color_name, line.size_name].filter(Boolean).join(' / ')}</span>
            )}
          </>
        ) : (
          <span className="row gap-8" style={{ alignItems: 'center' }}>
            <Badge tone="warning" dot>не связан</Badge>
            <button className="btn ghost sm" onClick={onLink}>Связать</button>
          </span>
        )}
      </Td>
      <Td className="num">{line.qty}</Td>
      <Td className="num" style={{ color: 'var(--c-text-subtle)' }}>
        {line.price_kopecks != null ? formatMoneyKopecks(line.price_kopecks) : '—'}
      </Td>
    </tr>
  )
}
