import type { RecordActualityFilterItem } from './domainTypes'

export function buildActualityFilterSelectOptions(
  items: RecordActualityFilterItem[],
  placeholderLabel: string,
): { value: string; label: string }[] {
  return [{ value: '', label: placeholderLabel }, ...items.map((i) => ({ value: i.id, label: i.name }))]
}
