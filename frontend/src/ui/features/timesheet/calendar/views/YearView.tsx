import { ListPage } from '../../../../layouts/ListPage'
import { Icon } from '../../../../primitives/Icon'
import { SkeletonRows } from '../../../../primitives/Skeleton'
import { EmptyState } from '../../../../primitives/EmptyState'
import { useApi } from '../../../../../hooks/useApi'
import { moscowTodayYmd } from '../../../../../utils/format'
import { getProductionYear } from '../../../../../api/productionCalendarApi'
import { CalLegend, RuleChip } from '../components/CalLegend'
import { MiniMonth } from '../components/MiniMonth'

type Props = {
  year: number
  onYearChange: (year: number) => void
  onOpenMonth: (month: number) => void
}

function YearKpi({ icon, color, value, label, sub }: {
  icon: 'briefcase' | 'x' | 'sun'; color: string; value: number; label: string; sub: string
}) {
  return (
    <div className="kpi" style={{ padding: '13px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
        <Icon name={icon} size={14} style={{ color }} />
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-value" style={{ fontSize: 24 }}>{value}</div>
      <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginTop: 2 }}>{sub}</div>
    </div>
  )
}

export function YearView({ year, onYearChange, onOpenMonth }: Props) {
  const today = moscowTodayYmd()
  const todayMonth = Number(today.slice(5, 7))
  const todayYear = Number(today.slice(0, 4))

  const { data, loading, error } = useApi((s) => getProductionYear(year, s), [year])

  const allItems = data?.months.flatMap((m) => m.items) ?? []
  const offCount = allItems.filter((i) => !i.is_working).length
  const sunCount = allItems.filter((i) => i.is_working).length

  return (
    <ListPage
      title="Производственный календарь"
      subtitle="Рабочие дни склада на год — делитель при разнесении оклада. По умолчанию рабочий — любой день, кроме воскресенья (6/1); отметьте праздники и внеплановые закрытия."
      actions={
        <div style={{
          display: 'flex', alignItems: 'center', border: '1px solid var(--c-border-strong)',
          borderRadius: 'var(--r-md)', overflow: 'hidden', background: 'var(--c-bg-elev)',
        }}>
          <button className="btn ghost icon sm" style={{ borderRadius: 0 }}
            onClick={() => onYearChange(year - 1)} title="Предыдущий год">
            <Icon name="chev" size={14} style={{ transform: 'rotate(180deg)' }} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 14px', height: 30 }}>
            <Icon name="calendar" size={14} style={{ color: 'var(--c-text-subtle)' }} />
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{year}</span>
          </div>
          <button className="btn ghost icon sm" style={{ borderRadius: 0 }}
            onClick={() => onYearChange(year + 1)} title="Следующий год">
            <Icon name="chev" size={14} />
          </button>
        </div>
      }
    >
      {loading ? (
        <SkeletonRows rows={6} cols={4} />
      ) : error ? (
        <EmptyState title="Не удалось загрузить" sub={error.message} />
      ) : (
        <>
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
            <YearKpi icon="briefcase" color="var(--c-accent)" value={data?.working_days ?? 0}
              label={`Рабочих дней в ${year}`} sub="по режиму 6/1 с учётом исключений" />
            <YearKpi icon="x" color="var(--c-danger)" value={offCount}
              label="Нерабочих исключений" sub="праздники и внеплановые закрытия" />
            <YearKpi icon="sun" color="var(--c-success)" value={sunCount}
              label="Доп. смен" sub="рабочие воскресенья" />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
            <CalLegend />
            <RuleChip />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {(data?.months ?? []).map((m) => (
              <MiniMonth
                key={m.month}
                year={year}
                month={m.month}
                workingDaysCount={m.working_days}
                items={m.items}
                today={today}
                highlight={year === todayYear && m.month === todayMonth}
                onClick={() => onOpenMonth(m.month)}
              />
            ))}
          </div>
        </>
      )}
    </ListPage>
  )
}
