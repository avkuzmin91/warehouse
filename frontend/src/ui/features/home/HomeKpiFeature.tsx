import { getDashboardToday } from '../../../api/dashboardApi'
import type { DashboardMetric, DashboardTodayStats } from '../../../api/dashboardApi'
import { useApi } from '../../../hooks/useApi'
import { KPI } from '../../primitives/KPI'

// Декоративный спарклайн: формы из дизайна, без претензии на реальный временной ряд.
function spark(seed: number, n = 14): number[] {
  const out: number[] = []
  let v = 0.5
  for (let i = 0; i < n; i += 1) {
    v += (Math.sin(i * 1.3 + seed) + Math.cos(i * 0.7 + seed * 2)) * 0.08
    out.push(Math.max(0.05, Math.min(0.95, v)))
  }
  return out
}

function fmt(value: number): string {
  return value.toLocaleString('ru-RU')
}

// «Факт / План» — основное число виджета по плановым показателям.
function factPlan(m: DashboardMetric): string {
  return `${fmt(m.fact)} / ${fmt(m.plan)}`
}

// Дельта «к вчера» по абсолютной разнице. Вверх — рост, вниз — падение.
function delta(today: number, yesterday: number): { label: string; dir: 'up' | 'down' } {
  const diff = today - yesterday
  if (diff === 0) return { label: 'без изменений', dir: 'up' }
  const sign = diff > 0 ? '+' : '−'
  return { label: `${sign}${fmt(Math.abs(diff))} к вчера`, dir: diff > 0 ? 'up' : 'down' }
}

export function HomeKpiFeature() {
  const { data, loading, error } = useApi(getDashboardToday, [])

  if (error) {
    return (
      <div className="kpi-grid">
        <KPI label="Поступления" value="—" delta="не удалось загрузить" deltaDir="down" />
        <KPI label="Упаковано" value="—" delta="не удалось загрузить" deltaDir="down" />
        <KPI label="Отгружено" value="—" delta="не удалось загрузить" deltaDir="down" />
        <KPI label="Браков зафиксировано" value="—" delta="не удалось загрузить" deltaDir="down" />
      </div>
    )
  }

  const today: DashboardTodayStats | undefined = data?.today
  const yesterday: DashboardTodayStats | undefined = data?.yesterday
  const ready = today !== undefined && yesterday !== undefined

  return (
    <div className="kpi-grid">
      <KPI
        label="Поступления"
        value={loading || !today ? '…' : factPlan(today.arrivals)}
        unit="шт"
        delta={ready ? delta(today.arrivals.fact, yesterday.arrivals.fact).label : undefined}
        deltaDir={ready ? delta(today.arrivals.fact, yesterday.arrivals.fact).dir : undefined}
        spark={spark(1)}
      />
      <KPI
        label="Упаковано"
        value={loading || !today ? '…' : factPlan(today.packed)}
        unit="шт"
        delta={ready ? delta(today.packed.fact, yesterday.packed.fact).label : undefined}
        deltaDir={ready ? delta(today.packed.fact, yesterday.packed.fact).dir : undefined}
        spark={spark(2)}
      />
      <KPI
        label="Отгружено"
        value={loading || !today ? '…' : factPlan(today.shipped)}
        unit="шт"
        delta={ready ? delta(today.shipped.fact, yesterday.shipped.fact).label : undefined}
        deltaDir={ready ? delta(today.shipped.fact, yesterday.shipped.fact).dir : undefined}
        spark={spark(3)}
      />
      <KPI
        label="Браков зафиксировано"
        value={loading ? '…' : fmt(today?.defects ?? 0)}
        unit="шт"
        delta={ready ? delta(today.defects, yesterday.defects).label : undefined}
        deltaDir={ready ? delta(today.defects, yesterday.defects).dir : undefined}
        spark={spark(4)}
      />
    </div>
  )
}
