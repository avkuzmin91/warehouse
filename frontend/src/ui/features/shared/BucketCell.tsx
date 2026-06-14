/** Ячейка корзины остатков: годный + выделенный брак («120 + 3 брак»). */
export function BucketCell({ good, defect, accent }: { good: number; defect: number; accent: string }) {
  const total = good + defect
  if (total === 0) return <span style={{ color: 'var(--c-text-faint)' }}>0</span>
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      {good > 0 && <span style={{ color: accent, fontWeight: 500 }}>{good.toLocaleString('ru-RU')}</span>}
      {defect > 0 && (
        <span style={{ color: 'var(--c-warning)', fontWeight: 500, fontSize: 12 }}>
          {good > 0 ? ' + ' : ''}{defect.toLocaleString('ru-RU')} брак
        </span>
      )}
    </span>
  )
}
