import { Icon } from '../../../primitives/Icon'
import type { IconName } from '../../../primitives/Icon'
import { Tooltip } from '../../../primitives/Tooltip'

/** Главная кнопка шага процесса. Подсказка «кому уйдёт ход» — в тултипе,
 *  чтобы текст не растягивал колонку кнопки и не сдвигал соседние кнопки шапки. */
export function PrimaryAction({ icon, label, hint, disabled, onClick }: {
  icon: IconName
  label: string
  hint?: string
  disabled?: boolean
  onClick?: () => void
}) {
  const btn = (
    <button className="btn primary" disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={14} />{label}
    </button>
  )
  if (!hint) return btn
  return <Tooltip content={hint} maxWidth={260} placement="bottom">{btn}</Tooltip>
}
