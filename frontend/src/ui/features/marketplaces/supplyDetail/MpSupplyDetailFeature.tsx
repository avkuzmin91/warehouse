import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  advanceMpSupply,
  applyMpSupplyCorrection,
  cancelMpSupply,
  discardMpSupplyCorrection,
  getMpSupply,
  MARKETPLACE_LABELS,
  marketplaceTone,
  MP_SUPPLY_ADVANCE_LABELS,
  MP_SUPPLY_STATUS_LABELS,
  mpSupplyStatusTone,
  setMpSupplyOrders,
  startMpSupplyCorrection,
  transferMpSupply,
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
import { SUPPLY_PHASES, supplyPhaseOf } from './shared/phases'
import type { SupplyPhaseKey } from './shared/phases'
import { CorrectingView } from './views/CorrectingView'
import { CheckView } from './views/CheckView'
import { PickingView } from './views/PickingView'
import { PackingView } from './views/PackingView'
import { HandoverView } from './views/HandoverView'

const PHASE_STAMP: Record<SupplyPhaseKey, keyof MpSupplyDetail['doc']> = {
  draft: 'created_at', checking: 'checking_at', picking: 'picking_at', packing: 'packing_at', handover: 'handover_at',
}

/** Фазы после проверки рисуются по пройденным отметкам, а не по статусу: аннулированная
 *  на упаковке поставка должна показать упаковку, а не сборку. */
function laterView(detail: MpSupplyDetail, reload: () => void) {
  const { doc } = detail
  if (doc.status === 'picking' || !doc.packing_at) return <PickingView detail={detail} onChanged={reload} />
  if (doc.status === 'packing' || !doc.handover_at) return <PackingView detail={detail} />
  return <HandoverView detail={detail} />
}

function lastStampedIndex(doc: MpSupplyDetail['doc']): number {
  for (let i = SUPPLY_PHASES.length - 1; i >= 0; i -= 1) {
    if (doc[PHASE_STAMP[SUPPLY_PHASES[i].key]]) return i
  }
  return 0
}

function buildSteps(detail: MpSupplyDetail): ProcessStep[] {
  const { doc } = detail
  const cancelled = doc.status === 'cancelled'
  const phase = supplyPhaseOf(doc.status)
  const currentIndex = doc.status === 'done'
    ? SUPPLY_PHASES.length
    : phase
      ? SUPPLY_PHASES.findIndex((p) => p.key === phase)
      : lastStampedIndex(doc)
  const checkingSub = doc.status === 'correcting'
    ? 'Корректировка состава'
    : doc.mp_transferred_at
      ? `Передана ${MARKETPLACE_LABELS[doc.marketplace]}${doc.external_supply_id ? ` · ${doc.external_supply_id}` : ''}`
      : 'Ждёт передачи площадке'
  return SUPPLY_PHASES.map((step, i) => {
    const stampValue = doc[PHASE_STAMP[step.key]] as string | null
    const state: ProcessStep['state'] =
      cancelled && i === currentIndex ? 'cancelled'
        : i < currentIndex ? 'done'
        : i === currentIndex ? 'active'
        : 'future'
    return {
      key: step.key,
      title: step.title,
      role: step.role,
      icon: step.icon,
      state,
      time: stampValue ? fmtDateTime(stampValue) : null,
      sub: state === 'active' && step.key === 'checking' ? checkingSub : undefined,
    }
  })
}

export function MpSupplyDetailFeature({ supplyId }: { supplyId: string }) {
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState(false)
  const [blockers, setBlockers] = useState<{ label: string; reasons: string[] } | null>(null)
  // Экран выбора состава (создание-легаси / корректировка) держит галочки у себя:
  // главное действие шапки забирает их целиком в момент нажатия.
  const selectionRef = useRef<(() => string[]) | null>(null)
  const reload = useCallback(() => {
    setBlockers(null)
    setTick((n) => n + 1)
  }, [])

  const { data, loading, error } = useApi(
    (signal) => getMpSupply(supplyId, signal), [supplyId, tick],
  )

  if (loading && !data) return <div className="page"><EmptyState title="Загрузка…" /></div>
  if (error || !data) {
    return <div className="page"><EmptyState title="Не удалось загрузить" sub={error?.message} /></div>
  }

  const { doc } = data
  const active = doc.status !== 'done' && doc.status !== 'cancelled'
  const transferred = !!doc.mp_transferred_at
  const ozon = doc.marketplace === 'ozon'
  const mpShort = ozon ? 'Ozon' : 'WB'
  const phaseRole = SUPPLY_PHASES.find((p) => p.key === supplyPhaseOf(doc.status))?.role ?? null

  // Причины показываются списком на месте, а не строкой в тосте: их бывает
  // несколько, и каждая — работа, которую надо доделать, а не уведомление.
  const run = async (label: string, action: () => Promise<unknown>, done: string) => {
    setBusy(true)
    setBlockers(null)
    try {
      await action()
      toast(done, 'success')
      reload()
    } catch (e) {
      const text = e instanceof Error ? e.message : 'Не удалось выполнить действие'
      setBlockers({ label, reasons: text.split('; ').filter(Boolean) })
    } finally {
      setBusy(false)
    }
  }

  const advanceLabel = MP_SUPPLY_ADVANCE_LABELS[doc.status]
  const onAdvance = () => run(advanceLabel, () => advanceMpSupply(supplyId), 'Фаза закрыта')

  const onApproveDraft = () => run(advanceLabel, async () => {
    await setMpSupplyOrders(supplyId, selectionRef.current?.() ?? [])
    await advanceMpSupply(supplyId)
  }, 'Состав утверждён')

  const onStartCorrection = () => run(
    'Скорректировать', () => startMpSupplyCorrection(supplyId), 'Состав открыт на корректировку',
  )
  const onApplyCorrection = () => run(
    'Сохранить состав',
    () => applyMpSupplyCorrection(supplyId, selectionRef.current?.() ?? []),
    'Состав сохранён',
  )
  const onDiscardCorrection = () => run(
    'Отменить корректировку', () => discardMpSupplyCorrection(supplyId), 'Корректировка отменена',
  )

  const onTransfer = async () => {
    const ok = await confirm({
      title: `Передать поставку ${mpShort}?`,
      body: ozon
        ? 'Состав будет зафиксирован. После этого изменить его или аннулировать поставку нельзя.'
        : `У WB будет заведена поставка продавца, в неё уйдут все ${doc.orders_total} заказ(ов) состава. `
          + 'После этого состав нельзя изменить, а поставку — аннулировать.',
      confirmLabel: 'Передать',
    })
    if (!ok) return
    await run(`Передать поставку ${mpShort}`, () => transferMpSupply(supplyId), `Поставка передана ${mpShort}`)
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

  const actions = active ? (
    <>
      {doc.status === 'draft' && (
        <PrimaryAction
          icon="check" label={advanceLabel} disabled={busy} onClick={onApproveDraft}
          hint="Состав закрепится за поставкой; связки и остатки чинятся на «Проверке»"
        />
      )}
      {doc.status === 'correcting' && (
        <>
          <PrimaryAction
            icon="check" label={advanceLabel} disabled={busy} onClick={onApplyCorrection}
            hint="Выбор применится целиком, поставка вернётся на «Проверку»"
          />
          <button className="btn ghost sm" disabled={busy} onClick={onDiscardCorrection}>
            <Icon name="x" size={13} />Отменить корректировку
          </button>
        </>
      )}
      {doc.status === 'checking' && !transferred && (
        <>
          <PrimaryAction
            icon="upload" label={`Передать поставку ${mpShort}`} disabled={busy} onClick={onTransfer}
            hint={ozon
              ? 'Состав зафиксируется: Ozon принимает отправления по одному со станции упаковки'
              : 'У WB заведётся поставка продавца со всеми заданиями — после этого доступна лента этикеток, а состав больше не правится'}
          />
          <button className="btn ghost sm" disabled={busy} onClick={onStartCorrection}>
            <Icon name="edit" size={13} />Скорректировать
          </button>
        </>
      )}
      {(doc.status === 'checking' ? transferred : doc.status !== 'draft' && doc.status !== 'correcting') && advanceLabel && (
        <PrimaryAction
          icon="check" label={advanceLabel} disabled={busy} onClick={onAdvance}
          hint={
            doc.status === 'checking' ? 'Задача уйдёт сборщику в «Мои задачи»'
              : doc.status === 'handover' ? 'Собранное спишется со склада; WB получит короба и поставку в доставку'
                : undefined
          }
        />
      )}
      {!transferred && (
        <button className="btn ghost sm" disabled={busy} onClick={onCancel}>
          <Icon name="x" size={13} />Аннулировать
        </button>
      )}
    </>
  ) : null

  return (
    <div className="page">
      <DocHeader
        onBack={() => navigate('/marketplaces/supplies')}
        badges={
          <>
            <Badge tone={mpSupplyStatusTone(doc.status)}>{MP_SUPPLY_STATUS_LABELS[doc.status]}</Badge>
            <Badge tone={marketplaceTone(doc.marketplace)}>{MARKETPLACE_LABELS[doc.marketplace]}</Badge>
            {transferred && (
              <Badge tone="success">передана {mpShort}{doc.external_supply_id ? ` · ${doc.external_supply_id}` : ''}</Badge>
            )}
            {doc.overdue && <Badge tone="danger">просрочено</Badge>}
            <Badge tone={doc.overdue ? 'danger' : 'warning'}>
              Отсечка {cutoffTime(doc.cutoff_at)} · {cutoffCountdown(doc.cutoff_at)}
            </Badge>
            {doc.intake_closed_at && <Badge tone="">приём закрыт</Badge>}
          </>
        }
        role={phaseRole}
        title={doc.doc_number}
        subtitle={`${doc.account_name} · ${doc.client_name ?? '—'}`}
        initiator={{ name: doc.created_by_name, createdAt: doc.created_at }}
        actions={actions}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 250px', gap: 20, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <ActionBlockers blockers={blockers} onClose={() => setBlockers(null)} />
          {doc.status === 'draft' || doc.status === 'correcting'
            ? <CorrectingView detail={data} selectionRef={selectionRef} />
            : doc.status === 'checking'
              ? <CheckView detail={data} onChanged={reload} />
              : laterView(data, reload)}
        </div>
        <div className="card" style={{ padding: 12 }}>
          <ProcessRail steps={buildSteps(data)} />
        </div>
      </div>
    </div>
  )
}

/** Почему действие не прошло — списком под шапкой, рядом с работой, которую надо
 *  доделать. Тост уезжал раньше, чем менеджер дочитывал третью причину. */
function ActionBlockers({ blockers, onClose }: {
  blockers: { label: string; reasons: string[] } | null
  onClose: () => void
}) {
  if (!blockers || blockers.reasons.length === 0) return null
  return (
    <div
      style={{
        border: '1px solid var(--c-danger-bg)', background: 'var(--c-danger-bg)',
        borderRadius: 'var(--r-lg)', padding: '12px 14px', marginBottom: 12,
      }}
    >
      <div
        className="row gap-8"
        style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-danger)', marginBottom: 8 }}
      >
        <Icon name="alert" size={13} />
        <span style={{ flex: 1 }}>{blockers.label ? `«${blockers.label}» — не сейчас` : 'Действие не прошло'}</span>
        <button className="btn ghost sm icon" onClick={onClose} title="Скрыть">
          <Icon name="x" size={12} />
        </button>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {blockers.reasons.map((text, i) => (
          <div
            key={`${i}-${text}`}
            style={{
              background: 'var(--c-bg-elev)', border: '1px solid var(--c-danger-bg)',
              borderRadius: 'var(--r-md)', padding: '7px 10px', fontSize: 12.5,
            }}
          >
            {text}
          </div>
        ))}
      </div>
    </div>
  )
}
