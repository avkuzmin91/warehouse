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
}

/**
 * Доступный остаток для плана строки отгрузки (по cargoType): свободный товар
 * «На хранении» нужного качества. Упаковка и «Готов к отгрузке» заняты другими
 * отгрузками и в план не входят. Если строка не нашлась в balances — qty.
 */
export function lineAvailable(line: ShipmentLine, balances: BalanceItem[], cargoType: ShipmentCargoType): number {
  const matched = balances.find((b) => balanceKey(b) === balanceKey(line))
  if (!matched) return line.qty
  return cargoType === 'defect' ? matched.storage_defect : matched.storage_good
}
