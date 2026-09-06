import type { IconName } from '../../../../primitives/Icon'
import type { ProcessRole } from '../../../shared/process/roles'
import type { MpSupplyStatus } from '../../../../../api/marketplacesApi'

export type SupplyPhaseKey = 'draft' | 'checking' | 'picking' | 'packing' | 'handover'

/** Остановки рейла поставки. «Создание» — набор состава до заведения: у сохранённой
 *  поставки она всегда пройдена, на странице создания — текущая. Корректировка —
 *  не остановка, а открытый выбор внутри «Проверки». */
export const SUPPLY_PHASES: { key: SupplyPhaseKey; title: string; icon: IconName; role: ProcessRole }[] = [
  { key: 'draft', title: 'Создание', icon: 'plus', role: 'manager' },
  { key: 'checking', title: 'Проверка', icon: 'search', role: 'manager' },
  { key: 'picking', title: 'Сборка', icon: 'forklift', role: 'warehouse' },
  { key: 'packing', title: 'Упаковка', icon: 'box', role: 'warehouse' },
  { key: 'handover', title: 'Передача', icon: 'truckOut', role: 'warehouse' },
]

export function supplyPhaseOf(status: MpSupplyStatus): SupplyPhaseKey | null {
  if (status === 'correcting') return 'checking'
  if (status === 'done' || status === 'cancelled') return null
  return status
}
