// Чистая логика dirty-guard нижнего листа: что делать при тапе по backdrop.
// Вынесена из Sheet.tsx ради unit-тестов (vitest без DOM).
export type SheetDismissAction = 'ignore' | 'confirm' | 'close'

export function sheetDismissAction(opts: { dirty: boolean; locked?: boolean }): SheetDismissAction {
  if (opts.locked) return 'ignore'
  return opts.dirty ? 'confirm' : 'close'
}
