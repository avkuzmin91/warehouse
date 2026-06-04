import { getDashboardToday } from '../../../api/dashboardApi'
import type { DashboardTodayStats } from '../../../api/dashboardApi'
import { useApi } from '../../../hooks/useApi'
import { KPI } from '../../primitives/KPI'
import { PacmanPlaceholder } from './PacmanPlaceholder'

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
        <KPI label="Поступления сегодня" value="—" delta="не удалось загрузить" deltaDir="down" />
        <KPI label="Принято товара" value="—" delta="не удалось загрузить" deltaDir="down" />
        <KPI label="Отгружено" value="—" delta="не удалось загрузить" deltaDir="down" />
        <div className="kpi" style={{ padding: 0 }}>
          <PacmanPlaceholder title="Браков зафиксировано" compact />
        </div>
      </div>
    )
  }

  const today: DashboardTodayStats | undefined = data?.today
  const yesterday: DashboardTodayStats | undefined = data?.yesterday
  const ready = today !== undefined && yesterday !== undefined

  return (
    <div className="kpi-grid">
      <KPI
        label="Поступления сегодня"
        value={loading ? '…' : fmt(today?.receipt_docs ?? 0)}
        unit="шт"
        delta={ready ? delta(today.receipt_docs, yesterday.receipt_docs).label : undefined}
        deltaDir={ready ? delta(today.receipt_docs, yesterday.receipt_docs).dir : undefined}
        spark={spark(1)}
      />
      <KPI
        label="Принято товара"
        value={loading ? '…' : fmt(today?.accepted ?? 0)}
        unit="шт"
        delta={ready ? delta(today.accepted, yesterday.accepted).label : undefined}
        deltaDir={ready ? delta(today.accepted, yesterday.accepted).dir : undefined}
        spark={spark(2)}
      />
      <KPI
        label="Отгружено"
        value={loading ? '…' : fmt(today?.shipped ?? 0)}
        unit="шт"
        delta={ready ? delta(today.shipped, yesterday.shipped).label : undefined}
        deltaDir={ready ? delta(today.shipped, yesterday.shipped).dir : undefined}
        spark={spark(3)}
      />
      <div className="kpi" style={{ padding: 0 }}>
        <PacmanPlaceholder title="Браков зафиксировано" compact />
      </div>
    </div>
  )
}
