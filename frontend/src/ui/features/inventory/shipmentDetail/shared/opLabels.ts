import { balanceKey } from '../../../../../utils/balanceKey'
import type { BalanceItem } from '../../../../../api/balancesApi'
import type { ShipmentCargoType, ShipmentLine } from '../../../../../api/shipmentsApi'

export const OP_LABELS: Record<string, string> = {
  doc_create: 'Документ создан',
  doc_update: 'Документ изменён',
  advance: 'Переход на следующий этап',
  revert: 'Возврат на предыдущий этап',
  return_to_packing: 'Возврат на упаковку',
  repack_start: 'Переупаковка',
  repack_charge: 'Переупаковка завершена',
  reject: 'Задача отклонена',
  cancel: 'Аннулирован',
  pack: 'Упаковка',
  pack_correction: 'Коррекция упаковки',
  collected: 'Сборка завершена',
  box_take: 'Короб взят в работу',
  box_close: 'Короб закрыт',
  box_place: 'Короб размещён',
  box_release: 'Короб освобождён',
  item_place: 'Сборка без короба',
  relocate: 'Разложено по местам',
}

export const OP_ICONS: Record<string, string> = {
  doc_create: 'plus',
  doc_update: 'edit',
  advance: 'arrowRight',
  revert: 'arrowLeft',
  return_to_packing: 'arrowLeft',
  repack_start: 'refresh',
  repack_charge: 'check',
  reject: 'arrowLeft',
  cancel: 'x',
  pack: 'boxOut',
  pack_correction: 'boxOut',
  collected: 'check',
  box_take: 'box',
  box_close: 'box',
  box_place: 'archive',
  box_release: 'arrowLeft',
  item_place: 'boxOut',
  relocate: 'archive',
}

export const OP_TONES: Record<string, string> = {
  doc_create: 'accent',
  doc_update: '',
  advance: 'success',
  revert: 'warning',
  return_to_packing: 'warning',
  repack_start: 'warning',
  repack_charge: 'accent',
  reject: 'danger',
  cancel: 'danger',
  pack: 'accent',
  pack_correction: 'warning',
  collected: 'success',
  box_take: '',
  box_close: '',
  box_place: 'accent',
  box_release: 'warning',
  item_place: 'accent',
  relocate: 'accent',
}

/**
 * Доступный остаток для плана строки отгрузки (по cargoType): свободный товар
 * «На хранении» нужного качества плюс то, что этот же документ уже передал на стол
 * упаковки (`available_for_pack`) — иначе собственная передача читается как нехватка.
 * Упаковка других отгрузок и «Готов к отгрузке» в план не входят. Если строка не
 * нашлась в balances — qty.
 */
export function lineAvailable(line: ShipmentLine, balances: BalanceItem[], cargoType: ShipmentCargoType): number {
  const matched = balances.find((b) => balanceKey(b) === balanceKey(line))
  if (!matched) return line.qty
  const onHand = cargoType === 'defect' ? matched.storage_defect : matched.storage_good
  return onHand + (line.available_for_pack ?? 0)
}
