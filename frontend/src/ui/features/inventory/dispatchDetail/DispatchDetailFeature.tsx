import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBackNav } from '../../../../hooks/useBackNav'
import {
  getDispatch,
  advanceDispatch,
  cancelDispatch,
  returnDispatchToDraft,
  updateDispatch,
  addDispatchLine,
  updateDispatchLine,
  updateDispatchLinePallets,
  updateDispatchLineBoxes,
  deleteDispatchLine,
  uploadDispatchLineFile,
  deleteDispatchLineFile,
  recommendedPallets,
  recommendedBoxes,
} from '../../../../api/dispatchApi'
import type { DispatchCargoType, DispatchDetail, DispatchStatus } from '../../../../api/dispatchApi'
import type { PlannableItem } from '../../../../api/balancesApi'
import { Icon } from '../../../primitives/Icon'
import { Alert } from '../../../primitives/Alert'
import { Drawer } from '../../../feedback/Drawer'
import { useConfirm } from '../../../feedback/ConfirmDialog'
import { useToast } from '../../../feedback/Toast'
import { DispatchPriorityControl } from '../DispatchPriorityControl'
import { DispHeader } from './components/DispHeader'
import { PrimaryAction } from '../../shared/process/PrimaryAction'
import { OpEntry } from './components/OpEntry'
import { DraftView } from './views/DraftView'
import { ReadyView } from './views/ReadyView'
import { FinalView } from './views/FinalView'
import { PreparePanel } from './components/PreparePanel'
import { canEditShipmentPlanning, canEditShipmentPriority, canPrepareDispatch, isDispatchPreparer } from '../../../../utils/access'
import { useCurrentUser } from '../../../../hooks/useCurrentUser'

export function DispatchDetailFeature({ docId }: { docId: string }) {
  const navigate = useNavigate()
  const goBack = useBackNav('/inventory/dispatches')
  const confirm = useConfirm()
  const toast = useToast()
  const { user } = useCurrentUser()
  const canEditPlanning = canEditShipmentPlanning(user)
  const canEditPriority = canEditShipmentPriority(user)
  const canPrepare = canPrepareDispatch(user)
  const showPrepareTask = isDispatchPreparer(user)

  const [doc, setDoc] = useState<DispatchDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [acting, setActing] = useState(false)
  const [opsDrawerOpen, setOpsDrawerOpen] = useState(false)
  // Есть ли несохранённые правки плана (DraftView сообщает при изменении состава/инфо) —
  // кнопка «Сохранить» показывается только когда действительно есть что сохранять.
  const [planDirty, setPlanDirty] = useState(false)
  // DraftView регистрирует здесь функцию сохранения «Основной информации» (в т.ч. ТЗ),
  // чтобы «Передать в подготовку» сохранило незакоммиченные правки до перехода по статусу.
  const flushDraftInfo = useRef<(() => Promise<boolean>) | null>(null)
  // Аналогично — несохранённые правки состава (короба/палеты/кол-во): передача в
  // подготовку коммитит их с черновика, ручное нажатие «дискеты» не требуется.
  const flushDraftLines = useRef<(() => Promise<boolean>) | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setDoc(await getDispatch(docId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [docId])

  // Тихая перезагрузка: обновляет doc БЕЗ полноэкранного спиннера, чтобы не размонтировать
  // текущую вьюху. Иначе inline-сохранение (файл/короба/палеты/ссылка) сбрасывало
  // несохранённые правки в других строках состава.
  const refresh = useCallback(async () => {
    try {
      setDoc(await getDispatch(docId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    }
  }, [docId])

  useEffect(() => { load() }, [load])

  async function act(fn: () => Promise<unknown>, redirectAfter?: string) {
    setActing(true)
    setError('')
    try {
      await fn()
      if (redirectAfter) navigate(redirectAfter)
      else await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setActing(false)
    }
  }

  async function handleAdvance() {
    setActing(true)
    setError('')
    try {
      if (flushDraftLines.current) {
        const ok = await flushDraftLines.current()
        if (!ok) return
      }
      if (flushDraftInfo.current) {
        const ok = await flushDraftInfo.current()
        if (!ok) return
      }
      await advanceDispatch(docId)
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Передать в подготовку не удалось', 'error')
    } finally {
      setActing(false)
    }
  }

  async function handleSaveDraft() {
    setActing(true)
    setError('')
    try {
      if (flushDraftLines.current) {
        const ok = await flushDraftLines.current()
        if (!ok) return
      }
      if (flushDraftInfo.current) {
        const ok = await flushDraftInfo.current()
        if (!ok) return
      }
      toast(doc && doc.status === 'draft' ? 'Черновик сохранён' : 'Изменения сохранены', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось сохранить черновик', 'error')
    } finally {
      setActing(false)
    }
  }

  async function handleCancel() {
    if (!doc) return
    const ok = await confirm({
      title: 'Аннулировать отгрузку?',
      body: `Отгрузка ${doc.doc_number} будет аннулирована. Это действие нельзя отменить.`,
      danger: true,
      confirmLabel: 'Аннулировать',
    })
    if (!ok) return
    await act(() => cancelDispatch(docId), '/inventory/dispatches')
  }

  async function handleReturnToDraft() {
    if (!doc) return
    const ok = await confirm({
      title: 'Вернуть на корректировку?',
      body: doc.status === 'awaiting_trip'
        ? `Отгрузка ${doc.doc_number} вернётся в черновик, подготовка будет отменена: товар журнально вернётся на исходные места. Состав, файлы и палеты сохранятся.`
        : `Отгрузка ${doc.doc_number} вернётся в черновик для правки состава. Задача у склада будет снята.`,
      confirmLabel: 'Вернуть в черновик',
    })
    if (!ok) return
    await act(() => returnDispatchToDraft(docId))
  }

  async function handleAddLine(item: PlannableItem, qty: number) {
    await act(async () => {
      await addDispatchLine(docId, {
        product_id:   item.product_id,
        product_name: item.product_name,
        product_sku:  item.product_sku,
        color_id:     item.color_id,
        color_name:   item.color_name,
        size_id:      item.size_id,
        size_name:    item.size_name,
        qty,
        boxes_qty:    recommendedBoxes(qty, item.items_per_box),
        pallets_qty:  recommendedPallets(recommendedBoxes(qty, item.items_per_box), item.boxes_per_pallet),
        site_url:     null,
        store_id:     null,
        store_name:   null,
      })
    })
  }

  async function handleUpdateLine(lineId: string, body: { qty?: number; pallets_qty?: number | null; boxes_qty?: number | null; site_url?: string | null; store_id?: string | null; store_name?: string | null }): Promise<boolean> {
    try {
      await updateDispatchLine(docId, lineId, body)
      await refresh()
      return true
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка сохранения позиции', 'error')
      return false
    }
  }

  async function handleUpdatePallets(lineId: string, pallets: number | null): Promise<boolean> {
    try {
      await updateDispatchLinePallets(docId, lineId, pallets)
      await refresh()
      return true
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка сохранения палет', 'error')
      return false
    }
  }

  async function handleUpdateBoxes(lineId: string, boxes: number | null): Promise<boolean> {
    try {
      await updateDispatchLineBoxes(docId, lineId, boxes)
      await refresh()
      return true
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка сохранения коробов', 'error')
      return false
    }
  }

  async function handleUploadLineFile(lineId: string, file: File): Promise<boolean> {
    try {
      await uploadDispatchLineFile(docId, lineId, file)
      await refresh()
      return true
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось прикрепить файл', 'error')
      return false
    }
  }

  async function handleDeleteLineFile(lineId: string, fileId: string): Promise<boolean> {
    try {
      await deleteDispatchLineFile(docId, lineId, fileId)
      await refresh()
      return true
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось удалить файл', 'error')
      return false
    }
  }

  async function handleDeleteLine(lineId: string) {
    const ok = await confirm({
      title: 'Удалить товар из отгрузки?',
      body: 'Строка будет удалена из состава отгрузки.',
      danger: true,
      confirmLabel: 'Удалить',
    })
    if (!ok) return
    await act(() => deleteDispatchLine(docId, lineId))
  }

  async function handleUpdateDoc(body: Parameters<typeof updateDispatch>[1]): Promise<boolean> {
    try {
      await updateDispatch(docId, body)
      await refresh()
      return true
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка сохранения', 'error')
      return false
    }
  }

  if (loading) {
    return (
      <div className="page">
        <div style={{ padding: '80px 0', textAlign: 'center', color: 'var(--c-text-subtle)' }}>Загрузка…</div>
      </div>
    )
  }

  if (error && !doc) {
    return (
      <div className="page">
        <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--c-danger)' }}>{error}</div>
      </div>
    )
  }

  if (!doc) return null

  const status = doc.status as DispatchStatus
  const cargoType = doc.cargo_type as DispatchCargoType
  const isDraft = status === 'draft'
  const isAwaitingPacking = status === 'awaiting_packing'
  const isPreparing = status === 'preparing'
  const isAwaiting = status === 'awaiting_trip'
  const isPartially = status === 'partially_shipped'
  // В черновике и в «Ожидании упаковки» менеджер правит состав/план (пока склад пакует).
  const isEditablePlan = isDraft || isAwaitingPacking
  // Палеты/короба менеджер правит на любом статусе (включая отгруженные), пока отгрузка
  // не аннулирована. Правка палет/коробов не влияет на сумму выставленных счетов.
  const canEditPallets = status !== 'cancelled' && canEditPlanning

  const actions = (
    <>
      <button className="btn ghost" onClick={() => setOpsDrawerOpen(true)}>
        <Icon name="layers" size={14} />Журнал
        {doc.ops.length > 0 && <span style={{ marginLeft: 4, opacity: 0.6 }}>({doc.ops.length})</span>}
      </button>
      {canEditPlanning && (isAwaitingPacking || isPreparing || isAwaiting) && (
        <button className="btn ghost" disabled={acting} onClick={() => void handleReturnToDraft()}>
          <Icon name="arrowLeft" size={14} />Вернуть на корректировку
        </button>
      )}
      {canEditPlanning && (isDraft || isAwaitingPacking || isPreparing || isAwaiting) && (
        <button className="btn ghost danger" disabled={acting} onClick={handleCancel}>
          <Icon name="x" size={14} />Аннулировать
        </button>
      )}
      {(isPreparing || isAwaiting || isPartially || status === 'shipped') && doc.trips.map((t) => (
        <button key={t.id} className="btn" onClick={() => navigate(`/logistics/trips/${t.id}`)}>
          <Icon name="truckOut" size={14} />Рейс {t.number}
        </button>
      ))}
      {canEditPlanning && isEditablePlan && planDirty && (
        <button className="btn" disabled={acting} onClick={() => void handleSaveDraft()}>
          <Icon name="save" size={14} />{isDraft ? 'Сохранить черновик' : 'Сохранить изменения'}
        </button>
      )}
      {canEditPlanning && isDraft && (
        <PrimaryAction
          icon="arrowRight"
          label="Передать в подготовку"
          hint="кладовщик получит задачу подготовить отгрузку"
          disabled={acting}
          onClick={() => void handleAdvance()}
        />
      )}
    </>
  )

  return (
    <div className="page">
      <DispHeader
        status={status}
        cargoType={cargoType}
        title={doc.doc_number}
        subtitle={`${cargoType === 'defect' ? 'Отгрузка брака' : cargoType === 'good_unpacked' ? 'Отгрузка без упаковки' : 'Отгрузка'} · ${doc.client_name ?? '—'}`}
        initiator={{ name: doc.created_by_name, createdAt: doc.created_at }}
        onBack={goBack}
        priority={
          <DispatchPriorityControl
            dispatch={doc}
            canEdit={canEditPriority}
            onSaved={(priorityRank) => setDoc((prev) => prev ? { ...prev, priority_rank: priorityRank } : prev)}
          />
        }
        actions={actions}
      />

      {error && doc && (
        <Alert tone="danger" icon={false} style={{ marginBottom: 16 }}>{error}</Alert>
      )}

      {isAwaitingPacking && (
        <Alert tone="info" style={{ marginBottom: 16 }}>
          Ожидание упаковки: как только весь товар будет упакован, отгрузка автоматически уйдёт
          в подготовку. Пока можно скорректировать план.
        </Alert>
      )}

      {isEditablePlan ? (
        <DraftView
          doc={doc}
          canEdit={canEditPlanning}
          acting={acting}
          onAddLine={handleAddLine}
          onUpdateLine={handleUpdateLine}
          onDeleteLine={handleDeleteLine}
          onUploadFile={handleUploadLineFile}
          onDeleteFile={handleDeleteLineFile}
          onUpdateDoc={handleUpdateDoc}
          onReload={refresh}
          registerInfoFlush={(fn) => { flushDraftInfo.current = fn }}
          registerLinesFlush={(fn) => { flushDraftLines.current = fn }}
          onDirtyChange={setPlanDirty}
        />
      ) : (isPreparing && showPrepareTask) ? (
        <PreparePanel
          doc={doc}
          canEdit={canPrepare}
          canEditDocs={canEditPlanning}
          onUpdateLine={handleUpdateLine}
          onUploadFile={handleUploadLineFile}
          onDeleteFile={handleDeleteLineFile}
          onSavePallets={canEditPallets ? handleUpdatePallets : undefined}
          onSaveBoxes={canEditPallets ? handleUpdateBoxes : undefined}
          onDone={load}
        />
      ) : (isPreparing || isAwaiting || isPartially) ? (
        <ReadyView
          doc={doc}
          onOpenTrip={(id) => navigate(`/logistics/trips/${id}`)}
          onSavePallets={canEditPallets ? handleUpdatePallets : undefined}
          onSaveBoxes={canEditPallets ? handleUpdateBoxes : undefined}
        />
      ) : (
        <FinalView
          doc={doc}
          onOpenTrip={(id) => navigate(`/logistics/trips/${id}`)}
          onSavePallets={canEditPallets ? handleUpdatePallets : undefined}
          onSaveBoxes={canEditPallets ? handleUpdateBoxes : undefined}
        />
      )}

      <Drawer
        open={opsDrawerOpen}
        onClose={() => setOpsDrawerOpen(false)}
        title="Журнал операций"
        subtitle={`${doc.ops.length} записей · ${doc.doc_number}`}
        width={460}
        footer={
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--c-text-subtle)' }}>
            <Icon name="shield" size={11} />
            <span>Операции не редактируются. Удаление запрещено.</span>
          </div>
        }
      >
        {doc.ops.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--c-text-muted)', fontSize: 13 }}>
            Нет операций
          </div>
        ) : (
          <div className="ops-timeline">
            {doc.ops.map((op) => (
              <OpEntry key={op.id} op={op} />
            ))}
          </div>
        )}
      </Drawer>
    </div>
  )
}
