import { balanceKey } from '../../../../utils/balanceKey'
import type { BalanceItem } from '../../../../api/balancesApi'
import type { ShipmentCargoType, ShipmentLine } from '../../../../api/shipmentsApi'

export const OP_LABELS: Record<string, string> = {
  doc_create: 'Документ создан',
  doc_update: 'Документ изменён',
  advance: 'Переход на следующий этап',
  revert: 'Возврат на предыдущий этап',
  cancel: 'Аннулирован',
}

export const OP_ICONS: Record<string, string> = {
  doc_create: 'plus',
  doc_update: 'edit',
  advance: 'arrowRight',
  revert: 'arrowLeft',
  cancel: 'x',
}

export const OP_TONES: Record<string, string> = {
  doc_create: 'accent',
  doc_update: '',
  advance: 'success',
  revert: 'warning',
  cancel: 'danger',
}

/**
 * Доступный остаток для плана строки отгрузки (по cargoType). Для годной отгрузки
 * это годный + на проверке: планировать можно по уже завезённому товару, ещё не
 * прошедшему QC (если уйдёт в брак — план скорректируют). Фактическая отгрузка
 * остаётся строго по годному в месте. Если строка не нашлась в balances — qty.
 */
export function lineAvailable(line: ShipmentLine, balances: BalanceItem[], cargoType: ShipmentCargoType): number {
  const matched = balances.find((b) => balanceKey(b) === balanceKey(line))
  if (!matched) return line.qty
  return cargoType === 'defect' ? matched.defect : matched.good + matched.on_review
}
