import { useFilterParam } from '../../../../hooks/useFilterParams'
import { moscowTodayYmd } from '../../../../utils/format'
import { YearView } from './views/YearView'
import { MonthView } from './views/MonthView'

export function ProductionCalendarFeature() {
  const todayYear = Number(moscowTodayYmd().slice(0, 4))
  const [cyRaw, setCy] = useFilterParam('cy', String(todayYear))
  const [cm, setCm] = useFilterParam('cm', '')

  const year = Number(cyRaw) || todayYear
  const month = cm ? Math.min(12, Math.max(1, Number(cm) || 0)) : 0

  if (month >= 1) {
    return (
      <MonthView
        year={year}
        month={month}
        onBack={() => setCm('')}
        onNav={(y, m) => {
          if (y !== year) setCy(String(y))
          setCm(String(m))
        }}
      />
    )
  }

  return (
    <YearView
      year={year}
      onYearChange={(y) => setCy(String(y))}
      onOpenMonth={(m) => setCm(String(m))}
    />
  )
}
