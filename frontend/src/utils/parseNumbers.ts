export function parseNum(s: string): number {
  const n = parseFloat(s.replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

/** Пустая строка → null; иначе округление до целого («1,5» → 2). */
export function parseOptionalInteger(s: string): number | null {
  const trimmed = s.trim()
  if (!trimmed) return null
  const n = Number(trimmed.replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n) : null
}

/** Вес в граммах — то же правило, что и для целых. */
export const parseOptionalWeight = parseOptionalInteger
