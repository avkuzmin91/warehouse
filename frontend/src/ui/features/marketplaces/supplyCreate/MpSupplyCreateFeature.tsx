import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createMpSupply,
  getMpAccounts,
  getMpFreePool,
  MARKETPLACE_LABELS,
  marketplaceTone,
} from '../../../../api/marketplacesApi'
import { Badge } from '../../../primitives/Badge'
import { EmptyState } from '../../../primitives/EmptyState'
import { Icon } from '../../../primitives/Icon'
import { SkeletonRows } from '../../../primitives/Skeleton'
import { DocHeader } from '../../shared/process/DocHeader'
import { PrimaryAction } from '../../shared/process/PrimaryAction'
import { ProcessRail } from '../../shared/process/ProcessRail'
import type { ProcessStep } from '../../shared/process/ProcessRail'
import { useApi } from '../../../../hooks/useApi'
import { useCurrentUser } from '../../../../hooks/useCurrentUser'
import { useToast } from '../../../feedback/Toast'
import { OrderSelectionPanel } from '../supplyDetail/components/OrderSelectionPanel'
import { SUPPLY_PHASES } from '../supplyDetail/shared/phases'
import { sortOrders } from '../supplyBoard/waves'

/** Карточка создания поставки: тот же экран, что и у сохранённого документа, но
 *  до «Создать поставку» ничего не пишется — «Закрыть» просто уходит с экрана,
 *  и пустышек на доске не остаётся. Состав набирается из свободного пула кабинета;
 *  созданная поставка сразу встаёт на «Проверку» с листом подбора. */
export function MpSupplyCreateFeature({ accountId }: { accountId: string }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useCurrentUser()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const { data: accountsData } = useApi((signal) => getMpAccounts(signal), [])
  const account = accountsData?.items.find((a) => a.id === accountId) ?? null

  const { data, loading, error } = useApi(
    (signal) => (accountId ? getMpFreePool(accountId, signal) : Promise.resolve({ items: [] })),
    [accountId],
  )
  const orders = useMemo(() => sortOrders(data?.items ?? []), [data])

  const goBack = () => navigate('/marketplaces/supplies')

  const create = async () => {
    setSaving(true)
    try {
      const res = await createMpSupply({ account_id: accountId, order_ids: [...selected] })
      toast('Поставка заведена', 'success')
      navigate(`/marketplaces/supplies/${res.message}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось завести поставку', 'error')
      setSaving(false)
    }
  }

  const steps: ProcessStep[] = SUPPLY_PHASES.map((phase, i) => ({
    key: phase.key,
    title: phase.title,
    role: phase.role,
    icon: phase.icon,
    state: i === 0 ? 'active' : 'future',
    sub: i === 0 ? 'Состав набирается — сохранится по «Создать поставку»' : undefined,
  }))

  if (!accountId) {
    return (
      <div className="page">
        <DocHeader badges={null} role="manager" title="Новая поставка" onBack={goBack} />
        <EmptyState
          title="Кабинет не выбран"
          sub="Поставка заводится из свободного пула кабинета на доске «Отгрузки FBS»."
        />
      </div>
    )
  }

  return (
    <div className="page">
      <DocHeader
        badges={
          <>
            <Badge dot>Создание</Badge>
            {account && <Badge tone={marketplaceTone(account.marketplace)}>{MARKETPLACE_LABELS[account.marketplace]}</Badge>}
          </>
        }
        role="manager"
        title="Новая поставка"
        subtitle={account ? `${account.name} · ${account.client_name ?? '—'}` : 'номер присвоится при создании'}
        initiator={{ name: user?.display_name || user?.email || null }}
        onBack={goBack}
        actions={
          <>
            <PrimaryAction
              icon="check"
              label={selected.size > 0 ? `Создать поставку (${selected.size})` : 'Создать поставку'}
              hint="Поставка встанет на «Проверку»: лист подбора, разбор блокеров, передача площадке"
              disabled={saving || selected.size === 0}
              onClick={create}
            />
            <button className="btn ghost sm" onClick={goBack} disabled={saving}>
              <Icon name="x" size={13} />Закрыть
            </button>
          </>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 250px', gap: 20, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          {loading && !data ? (
            <table className="table"><tbody><SkeletonRows rows={5} cols={1} /></tbody></table>
          ) : error ? (
            <EmptyState title="Не удалось загрузить заказы" sub={error.message} />
          ) : (
            <OrderSelectionPanel
              orders={orders}
              selected={selected}
              onChange={setSelected}
              accountId={accountId}
              disabled={saving}
              emptyTitle="Свободных заказов нет"
              emptySub="Все заказы кабинета уже разобраны по поставкам — новые появятся после синхронизации."
            />
          )}
        </div>
        <div className="card" style={{ padding: 12 }}>
          <ProcessRail steps={steps} />
        </div>
      </div>
    </div>
  )
}
