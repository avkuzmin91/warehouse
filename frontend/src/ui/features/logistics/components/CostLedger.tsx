import { ReadRow } from './fields'

function money(v: number | null | undefined): string {
  return v == null ? '—' : `${v.toLocaleString('ru-RU')} ₽`
}

/** Денежный «леджер» рейса: план → факт + простой → итого, с отклонением от плана. */
export function CostLedger({ estimate, actual, waiting, showActual }: {
  estimate: number | null
  actual?: number | null
  waiting?: number | null
  showActual?: boolean
}) {
  const total = (actual ?? 0) + (waiting ?? 0)
  const delta = actual != null && estimate != null ? total - estimate : null
  return (
    <div style={{ padding: '4px 2px' }}>
      <ReadRow label="Логистика (план)" mono>{money(estimate)}</ReadRow>
      {showActual ? (
        <>
          <ReadRow label="Логистика (факт)" mono>{money(actual)}</ReadRow>
          <ReadRow label="Простой" mono>{money(waiting)}</ReadRow>
          {delta != null && delta !== 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '2px 0 6px' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: delta > 0 ? 'var(--c-danger)' : 'var(--c-success)' }}>
                {delta > 0 ? `▲ +${money(delta)} к плану` : `▼ ${money(delta)} к плану`}
              </span>
            </div>
          )}
          <div style={{ borderTop: '1px solid var(--c-border)', marginTop: 4, paddingTop: 6 }}>
            <ReadRow label="Итого по рейсу" mono strong>{money(total)}</ReadRow>
          </div>
        </>
      ) : (
        <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--c-text-faint)' }}>
          Факт и простой внесёт менеджер после разгрузки.
        </div>
      )}
    </div>
  )
}
