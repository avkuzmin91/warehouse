import { useState, useEffect } from 'react'
import { getClientPortalOperations } from '../../../api/clientPortalApi'
import type { InventoryOperationItem, InventoryOpType } from '../../../api/domainTypes'
import { ListPage } from '../../layouts/ListPage'
import { Badge, statusTone, STATUS_LABELS } from '../../primitives/Badge'
import { Pagination } from '../../data/Pagination'
import { SkeletonRows } from '../../primitives/Skeleton'

interface Props {
  opType: InventoryOpType
}

const LIMIT = 20

export function CabinetOperationsPage({ opType }: Props) {
  const title = opType === 'in' ? 'Поступления' : 'Отгрузки'
  const [items, setItems] = useState<InventoryOperationItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getClientPortalOperations({ page, limit: LIMIT, op_type: opType, search: search || undefined })
      .then((r) => { setItems(r.items); setTotal(r.total); setLoading(false) })
      .catch(() => setLoading(false))
  }, [page, search, opType])

  return (
    <ListPage
      title={title}
      subtitle={loading ? '' : `${total} записей`}
      filters={
        <input
          className="input"
          style={{ width: 280 }}
          placeholder="Поиск…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
        />
      }
    >
      {loading ? <SkeletonRows rows={8} /> : (
        <>
          <div className="t-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th className="th">Товар</th>
                  <th className="th">Цвет</th>
                  <th className="th">Размер</th>
                  <th className="th">Кол-во</th>
                  <th className="th">Статус</th>
                  <th className="th">Дата</th>
                </tr>
              </thead>
              <tbody>
                {items.map((op) => {
                  const status = opType === 'in' ? op.receipt_status : op.shipment_status
                  return (
                    <tr key={op.id}>
                      <td className="td" style={{ fontWeight: 500 }}>{op.product_name}</td>
                      <td className="td" style={{ fontSize: 12 }}>{op.color_name ?? '—'}</td>
                      <td className="td" style={{ fontSize: 12 }}>{op.size_name ?? '—'}</td>
                      <td className="td" style={{ fontWeight: 500 }}>{op.quantity}</td>
                      <td className="td">
                        {status ? (
                          <Badge tone={statusTone(status)} dot>
                            {STATUS_LABELS[status] ?? status}
                          </Badge>
                        ) : '—'}
                      </td>
                      <td className="td" style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>
                        {op.created_at ? new Date(op.created_at).toLocaleDateString('ru-RU') : '—'}
                      </td>
                    </tr>
                  )
                })}
                {items.length === 0 && (
                  <tr><td className="td" colSpan={6} style={{ textAlign: 'center', color: 'var(--c-text-subtle)' }}>Нет данных</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={total} pageSize={LIMIT} onPage={setPage} />
        </>
      )}
    </ListPage>
  )
}
