import { getReceipts } from '../../../api/receiptsApi'
import { listShipments } from '../../../api/shipmentsApi'
import { useApi } from '../../../hooks/useApi'
import { KPI } from '../../primitives/KPI'

// Деканоративный спарклайн: формы из дизайна, без претензии на реальный временной ряд.
function spark(seed: number, n = 14): number[] {
  const out: number[] = []
  let v = 0.5
  for (let i = 0; i < n; i += 1) {
    v += (Math.sin(i * 1.3 + seed) + Math.cos(i * 0.7 + seed * 2)) * 0.08
    out.push(Math.max(0.05, Math.min(0.95, v)))
  }
  return out
}

function dayISO(offset = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

type DayStats = {
  receiptDocs: number
  accepted: number
  shipped: number
  defects: number
}

async function loadDay(day: string, signal: AbortSignal): Promise<DayStats> {
  const [receipts, shipments] = await Promise.all([
    getReceipts({ date_from: day, date_to: day, limit: 200 }, signal),
    listShipments({ status: 'shipped', date_from: day, date_to: day, limit: 200 }, signal),
  ])
  return {
    receiptDocs: receipts.total,
    accepted: receipts.items.reduce((sum, item) => sum + (item.total_accepted ?? 0), 0),
    shipped: shipments.items.reduce((sum, item) => sum + (item.total_shipped_qty ?? 0), 0),
    defects: receipts.items.reduce((sum, item) => sum + (item.total_defect ?? 0), 0),
  }
}

type HomeKpiData = { today: DayStats; yesterday: DayStats }

async function loadHomeKpi(signal: AbortSignal): Promise<HomeKpiData> {
  const [today, yesterday] = await Promise.all([
    loadDay(dayISO(0), signal),
    loadDay(dayISO(-1), signal),
  ])
  return { today, yesterday }
}

function fmt(value: number): string {
  return value.toLocaleString('ru-RU')
}

// Дельта «к вчера» по абсолютной разнице. Вверх — рост, вниз — падение.
function delta(today: number, yesterday: number): { label: string; dir: 'up' | 'down' } | undefined {
  const diff = today - yesterday
  if (diff === 0) return { label: 'без изменений', dir: 'up' }
  const sign = diff > 0 ? '+' : '−'
  return { label: `${sign}${fmt(Math.abs(diff))} к вчера`, dir: diff > 0 ? 'up' : 'down' }
}

// Для браков рост — это плохо, поэтому направление инвертируем (рост = down/красный).
function defectDelta(today: number, yesterday: number): { label: string; dir: 'up' | 'down' } | undefined {
  const base = delta(today, yesterday)
  if (!base) return base
  if (base.label === 'без изменений') return base
  return { label: base.label, dir: base.dir === 'up' ? 'down' : 'up' }
}

export function HomeKpiFeature() {
  const { data, loading, error } = useApi(loadHomeKpi, [])

  if (error) {
    return (
      <div className="kpi-grid">
        <KPI label="Поступления сегодня" value="—" delta="не удалось загрузить" deltaDir="down" />
        <KPI label="Принято товара" value="—" delta="не удалось загрузить" deltaDir="down" />
        <KPI label="Отгружено" value="—" delta="не удалось загрузить" deltaDir="down" />
        <KPI label="Браков зафиксировано" value="—" delta="не удалось загрузить" deltaDir="down" />
      </div>
    )
  }

  const today = data?.today
  const yesterday = data?.yesterday
  const receiptsDelta = today && yesterday ? delta(today.receiptDocs, yesterday.receiptDocs) : undefined
  const acceptedDelta = today && yesterday ? delta(today.accepted, yesterday.accepted) : undefined
  const shippedDelta = today && yesterday ? delta(today.shipped, yesterday.shipped) : undefined
  const defectsDelta = today && yesterday ? defectDelta(today.defects, yesterday.defects) : undefined

  return (
    <div className="kpi-grid">
      <KPI
        label="Поступления сегодня"
        value={loading ? '…' : fmt(today?.receiptDocs ?? 0)}
        unit="шт"
        delta={receiptsDelta?.label}
        deltaDir={receiptsDelta?.dir}
        spark={spark(1)}
      />
      <KPI
        label="Принято товара"
        value={loading ? '…' : fmt(today?.accepted ?? 0)}
        unit="шт"
        delta={acceptedDelta?.label}
        deltaDir={acceptedDelta?.dir}
        spark={spark(2)}
      />
      <KPI
        label="Отгружено"
        value={loading ? '…' : fmt(today?.shipped ?? 0)}
        unit="шт"
        delta={shippedDelta?.label}
        deltaDir={shippedDelta?.dir}
        spark={spark(3)}
      />
      <KPI
        label="Браков зафиксировано"
        value={loading ? '…' : fmt(today?.defects ?? 0)}
        delta={defectsDelta?.label}
        deltaDir={defectsDelta?.dir}
        spark={spark(4)}
      />
    </div>
  )
}
