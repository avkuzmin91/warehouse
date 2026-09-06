import { useEffect, useMemo, useState } from 'react'
import type { MutableRefObject } from 'react'
import { getMpSupplyCandidates } from '../../../../../api/marketplacesApi'
import type { MpSupplyDetail } from '../../../../../api/marketplacesApi'
import { useApi } from '../../../../../hooks/useApi'
import { Icon } from '../../../../primitives/Icon'
import { OrderSelectionPanel } from '../components/OrderSelectionPanel'
import { sortOrders } from '../../supplyBoard/waves'

/** «Корректировка» (и легаси «Создание» у поставок, заведённых до пула): состав
 *  перевыбирается галочками, как при заведении, — строки поставки плюс свободный
 *  пул кабинета. Выбор живёт здесь до кнопки шапки: «Сохранить состав» применяет
 *  его целиком, «Отменить корректировку» возвращает прежний. */
export function CorrectingView({ detail, selectionRef }: {
  detail: MpSupplyDetail
  /** Текущий выбор для главного действия шапки. */
  selectionRef: MutableRefObject<(() => string[]) | null>
}) {
  const { data: pool, error: poolError } = useApi(
    (signal) => getMpSupplyCandidates(detail.doc.id, signal),
    [detail.doc.id, detail.doc.updated_at],
  )

  // Заказ, снятый отменой площадки, остаётся строкой поставки, но галочкой не
  // возвращается: площадка его уже не примет.
  const orders = useMemo(
    () => sortOrders([
      ...detail.orders.filter(
        (o) => o.state !== 'pending' && !(o.state !== 'selected' && o.order_status === 'cancelled'),
      ),
      ...(pool?.items ?? []),
    ]),
    [detail.orders, pool],
  )

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(detail.orders.filter((o) => o.state === 'selected').map((o) => o.order_id)),
  )

  useEffect(() => {
    selectionRef.current = () => [...selected]
    return () => { selectionRef.current = null }
  }, [selected, selectionRef])

  const correcting = detail.doc.status === 'correcting'

  return (
    <>
      <div
        className="row gap-8"
        style={{
          padding: '10px 12px', marginBottom: 12, background: 'var(--c-warning-bg)',
          border: '1px solid var(--c-warning)', borderRadius: 'var(--r-lg)',
          fontSize: 12.5, color: 'var(--c-warning)', alignItems: 'center',
        }}
      >
        <Icon name="edit" size={14} />
        <span>
          {correcting
            ? 'Корректировка состава: перевыберите заказы — выбор применится целиком по «Сохранить состав», «Отменить корректировку» вернёт прежний состав'
            : 'Состав ещё не утверждён: отметьте заказы и нажмите «Утвердить состав» — снятые останутся в пуле кабинета'}
        </span>
      </div>

      <OrderSelectionPanel
        orders={orders}
        selected={selected}
        onChange={setSelected}
        accountId={detail.doc.account_id}
        emptyTitle={poolError ? 'Не удалось загрузить свободные заказы' : 'Свободных заказов нет'}
        emptySub={poolError
          ? poolError.message
          : 'Все заказы кабинета уже разобраны по поставкам — новые появятся здесь после синхронизации.'}
      />
    </>
  )
}
