import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  advanceMpSupply,
  cancelMpSupply,
  getMpSupply,
  MARKETPLACE_LABELS,
  marketplaceTone,
  MP_SUPPLY_ADVANCE_LABELS,
  MP_SUPPLY_STATUS_LABELS,
  mpSupplyStatusTone,
} from '../../../../api/marketplacesApi'
import type { MpSupplyDetail } from '../../../../api/marketplacesApi'
import { Badge } from '../../../primitives/Badge'
import { EmptyState } from '../../../primitives/EmptyState'
import { Icon } from '../../../primitives/Icon'
import { DocHeader } from '../../shared/process/DocHeader'
import { PrimaryAction } from '../../shared/process/PrimaryAction'
import { ProcessRail } from '../../shared/process/ProcessRail'
import type { ProcessStep } from '../../shared/process/ProcessRail'
import { useApi } from '../../../../hooks/useApi'
import { useConfirm } from '../../../feedback/ConfirmDialog'
import { useToast } from '../../../feedback/Toast'
import { fmtDateTime } from '../../../../utils/format'
import { cutoffCountdown, cutoffTime } from '../supplyBoard/waves'
import { ComposeView } from './views/ComposeView'
import { CheckView } from './views/CheckView'
import { PickingView } from './views/PickingView'

const PHASES: { key: string; title: string; icon: 'list' | 'search' | 'forklift' | 'truckOut' }[] = [
  { key: 'draft', title: 'Состав', icon: 'list' },
  { key: 'checking', title: 'Проверка', icon: 'search' },
  { key: 'picking', title: 'Сборка', icon: 'forklift' },
  { key: 'handover', title: 'Передача', icon: 'truckOut' },
]

const PHASE_ROLE = {
  draft: 'manager', checking: 'manager', picking: 'warehouse', handover: 'manager',
} as const

const PHASE_STAMP: Record<string, keyof MpSupplyDetail['doc']> = {
  draft: 'created_at', checking: 'checking_at', picking: 'picking_at', handover: 'handover_at',
}

function buildSteps(detail: MpSupplyDetail): ProcessStep[] {
  const { doc } = detail
  const cancelled = doc.status === 'cancelled'
  const order = PHASES.map((p) => p.key)
  const currentIndex = doc.status === 'done' ? order.length : order.indexOf(doc.status)
  return PHASES.map((phase, i) => {
    const stampValue = doc[PHASE_STAMP[phase.key]] as string | null
    const state: ProcessStep['state'] =
      cancelled && i === currentIndex ? 'cancelled'
        : i < currentIndex ? 'done'
        : i === currentIndex ? 'active'
        : 'future'
    return {
      key: phase.key,
      title: phase.title,
      role: PHASE_ROLE[phase.key as keyof typeof PHASE_ROLE],
      icon: phase.icon,
      state,
      time: stampValue ? fmtDateTime(stampValue) : null,
    }
  })
}

export function MpSupplyDetailFeature({ supplyId }: { supplyId: string }) {
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState(false)
  const reload = useCallback(() => setTick((n) => n + 1), [])

  const { data, loading, error } = useApi(
    (signal) => getMpSupply(supplyId, signal), [supplyId, tick],
  )

  if (loading && !data) return <div className="page"><EmptyState title="Загрузка…" /></div>
  if (error || !data) {
    return <div className="page"><EmptyState title="Не удалось загрузить" sub={error?.message} /></div>
  }

  const { doc } = data
  const active = doc.status !== 'done' && doc.status !== 'cancelled'
  const advanceLabel = MP_SUPPLY_ADVANCE_LABELS[doc.status]

  const onAdvance = async () => {
    setBusy(true)
    try {
      await advanceMpSupply(supplyId)
      toast('Фаза закрыта', 'success')
      reload()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось перейти к следующей фазе', 'error')
    } finally {
      setBusy(false)
    }
  }

  const onCancel = async () => {
    const ok = await confirm({
      title: 'Аннулировать поставку?',
      body: `Поставка ${doc.doc_number} будет аннулирована, а её заказы освободятся и уйдут в следующую поставку кабинета.`,
      danger: true,
      confirmLabel: 'Аннулировать',
    })
    if (!ok) return
    try {
      await cancelMpSupply(supplyId)
      toast('Поставка аннулирована', 'success')
      reload()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось аннулировать', 'error')
    }
  }

  return (
    <div className="page">
      <DocHeader
        onBack={() => navigate('/marketplaces/supplies')}
        badges={
          <>
            <Badge tone={mpSupplyStatusTone(doc.status)}>{MP_SUPPLY_STATUS_LABELS[doc.status]}</Badge>
            <Badge tone={marketplaceTone(doc.marketplace)}>{MARKETPLACE_LABELS[doc.marketplace]}</Badge>
            {doc.overdue && <Badge tone="danger">просрочено</Badge>}
            <Badge tone={doc.overdue ? 'danger' : 'warning'}>
              Отсечка {cutoffTime(doc.cutoff_at)} · {cutoffCountdown(doc.cutoff_at)}
            </Badge>
            {doc.intake_closed_at && <Badge tone="">приём закрыт</Badge>}
          </>
        }
        role={PHASE_ROLE[doc.status as keyof typeof PHASE_ROLE] ?? null}
        title={doc.doc_number}
        subtitle={`${doc.account_name} · ${doc.client_name ?? '—'}`}
        initiator={{ name: doc.created_by_name, createdAt: doc.created_at }}
        actions={
          active ? (
            <>
              {advanceLabel && (
                <PrimaryAction
                  icon="check"
                  label={advanceLabel}
                  disabled={busy}
                  onClick={onAdvance}
                  hint={doc.status === 'checking' ? 'Задача уйдёт кладовщику в «Мои задачи»' : undefined}
                />
              )}
              <button className="btn ghost sm" onClick={onCancel}>
                <Icon name="x" size={13} />Аннулировать
              </button>
            </>
          ) : null
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 250px', gap: 20, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          {doc.status === 'draft'
            ? <ComposeView detail={data} onChanged={reload} />
            : doc.status === 'checking'
              ? <CheckView detail={data} onChanged={reload} />
              : <PickingView detail={data} onChanged={reload} />}
        </div>
        <div className="card" style={{ padding: 12 }}>
          <ProcessRail steps={buildSteps(data)} />
        </div>
      </div>
    </div>
  )
}
