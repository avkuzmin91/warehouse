/**
 * Переставляет элемент на место цели так, как показывает линия вставки:
 * вниз — после целевой строки, вверх — до неё.
 *
 * Индекс цели берётся в исходном списке: после удаления перетаскиваемой строки он
 * уже сдвинут на единицу при переносе вниз, поэтому одно и то же значение даёт
 * оба нужных поведения.
 */
export function reorderByDrag<T extends { id: string }>(items: T[], sourceId: string, targetId: string): T[] {
  if (sourceId === targetId) return items
  const from = items.findIndex((i) => i.id === sourceId)
  const to = items.findIndex((i) => i.id === targetId)
  if (from < 0 || to < 0) return items
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}
