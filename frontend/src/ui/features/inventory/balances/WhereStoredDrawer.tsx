import { useCallback, useEffect, useState } from 'react'
import { getBalancesByZone, INV_OP_LABELS, INV_QUALITY_LABELS } from '../../../../api/balancesApi'
import type { BalanceZoneItem } from '../../../../api/balancesApi'
import { getVariantHoldings } from '../../../../api/containersApi'
import type { ContainerHoldingRow } from '../../../../api/containersApi'
import { Drawer } from '../../../feedback/Drawer'
import { Table, Td } from '../../../data/Table'
import { Badge } from '../../../primitives/Badge'
import { Icon } from '../../../primitives/Icon'
import { EmptyState } from '../../../primitives/EmptyState'
import { SkeletonRows } from '../../../primitives/Skeleton'
import { BoxChip, LooseChip } from '../shared/BoxChip'

/** Вариант, про который спрашивают «где лежит». */
export type WhereStoredTarget = {
  product_id: string
  product_name: string
  product_sku: string
  color_id: string | null
  color_name: string | null
  size_id: string | null
  size_name: string | null
}

type PlaceRow = {
  zoneId: string
  zoneName: string
  opStatus: BalanceZoneItem['op_status']
  quality: BalanceZoneItem['quality']
  qty: number
  boxes: ContainerHoldingRow[]
}

function sameVariant(item: BalanceZoneItem, target: WhereStoredTarget): boolean {
  return item.product_id === target.product_id
    && (item.color_id ?? null) === (target.color_id ?? null)
    && (item.size_id ?? null) === (target.size_id ?? null)
}

/** «Где лежит» для одного варианта: места, короба в них и остаток россыпью.
 *
 * Список остатков по местам отвечает на вопрос «что в этом месте», а менеджеру
 * нужен обратный разрез — по товару. Запрашивается только при открытии шторки.
 */
export function WhereStoredDrawer({ target, onClose }: { target: WhereStoredTarget | null; onClose: () => void }) {
  const [rows, setRows] = useState<PlaceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (t: WhereStoredTarget, signal: AbortSignal) => {
    setLoading(true)
    setError('')
    try {
      // Поиск по местам умеет только текстовый запрос — берём по артикулу и
      // отсеиваем чужие варианты на клиенте.
      const [zones, holdings] = await Promise.all([
        getBalancesByZone({ search: t.product_sku || t.product_name, limit: 200 }, signal),
        getVariantHoldings({ product_id: t.product_id, color_id: t.color_id, size_id: t.size_id }, signal),
      ])
      if (signal.aborted) return
      const boxesByZone = new Map<string, ContainerHoldingRow[]>()
      for (const h of holdings.items) {
        const key = `${h.zone_id}__${h.quality}__${h.op_status}`
        const list = boxesByZone.get(key)
        if (list) list.push(h)
        else boxesByZone.set(key, [h])
      }
      setRows(
        zones.items
          .filter((i) => sameVariant(i, t) && i.qty > 0)
          .map((i) => ({
            zoneId: i.location_id ?? '',
            zoneName: i.location_name ?? 'Без места',
            opStatus: i.op_status,
            quality: i.quality,
            qty: i.qty,
            boxes: boxesByZone.get(`${i.location_id ?? ''}__${i.quality}__${i.op_status}`) ?? [],
          }))
          .sort((a, b) => a.zoneName.localeCompare(b.zoneName, 'ru')),
      )
    } catch (e) {
      if (signal.aborted) return
      setError(e instanceof Error ? e.message : 'Не удалось загрузить размещение')
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!target) return
    const ac = new AbortController()
    void load(target, ac.signal)
    return () => ac.abort()
  }, [target, load])

  const totalQty = rows.reduce((sum, r) => sum + r.qty, 0)

  return (
    <Drawer
      open={!!target}
      onClose={onClose}
      title="Где лежит"
      subtitle={target ? [target.product_name, target.color_name, target.size_name].filter(Boolean).join(' · ') : undefined}
    >
      {loading ? (
        <Table><tbody><SkeletonRows rows={5} cols={3} /></tbody></Table>
      ) : error ? (
        <EmptyState title="Ошибка загрузки" sub={error} />
      ) : rows.length === 0 ? (
        <EmptyState title="Остатков нет" sub="Позиции нет ни в одном месте хранения" />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <th>Место</th>
                <th style={{ width: 120 }}>Статус</th>
                <th style={{ textAlign: 'right', width: 90 }}>Кол-во</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const inBoxes = r.boxes.reduce((sum, h) => sum + h.qty, 0)
                const loose = r.qty - inBoxes
                return (
                  <tr key={`${r.zoneId}-${r.opStatus}-${r.quality}-${i}`}>
                    <Td>
                      <div className="row gap-8" style={{ alignItems: 'center' }}>
                        <Icon name="boxes" size={13} className="ic-accent" />
                        <span style={{ fontWeight: 500 }}>{r.zoneName}</span>
                        <Badge tone={r.quality === 'defect' ? 'warning' : 'success'}>
                          {INV_QUALITY_LABELS[r.quality]}
                        </Badge>
                      </div>
                      {r.boxes.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                          {r.boxes.map((h) => <BoxChip key={h.container_id} holding={h} />)}
                          {loose > 0 && <LooseChip qty={loose} />}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <span className="t-sub">{INV_OP_LABELS[r.opStatus]}</span>
                    </Td>
                    <Td className="num" style={{ fontWeight: 600 }}>{r.qty.toLocaleString('ru-RU')}</Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
          <div className="t-sub" style={{ marginTop: 10, textAlign: 'right' }}>
            Всего <b className="num">{totalQty.toLocaleString('ru-RU')}</b> шт в {rows.length} местах
          </div>
        </>
      )}
    </Drawer>
  )
}
