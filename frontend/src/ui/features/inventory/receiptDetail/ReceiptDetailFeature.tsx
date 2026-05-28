import { useCallback, useEffect, useState } from 'react'
import {
  advanceReceiptStatus,
  arriveReceipt,
  cancelReceipt,
  getReceipt,
  reopenReceipt,
} from '../../../../api/receiptsApi'
import type { ReceiptDetail } from '../../../../api/receiptsApi'
import { useConfirm } from '../../../feedback/ConfirmDialog'
import { DraftView } from './views/DraftView'
import { PlannedView } from './views/PlannedView'
import { ReviewView } from './views/ReviewView'

interface Props {
  docId: string
}

/**
 * Главный роутер деталей приёмки по статусу:
 * - draft    → DraftView   (редактирование черновика)
 * - planned  → PlannedView (план поступления + фиксация прибытия)
 * - on_review / done → ReviewView (QC: приёмка/брак по строкам)
 */
export function ReceiptDetailFeature({ docId }: Props) {
  const confirm = useConfirm()
  const [detail, setDetail] = useState<ReceiptDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [advancing, setAdvancing] = useState(false)

  function handleUpdateLineQty(lineId: string, qty: number) {
    setDetail((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        lines: prev.lines.map((l) => l.id === lineId ? { ...l, planned_qty: qty } : l),
        state: {
          ...prev.state,
          lines: prev.state.lines.map((l) => l.id === lineId ? { ...l, planned_qty: qty } : l),
          total_planned: prev.state.lines.reduce((s, l) => s + (l.id === lineId ? qty : l.planned_qty), 0),
        },
      }
    })
  }

  const load = useCallback(async () => {
    try {
      const d = await getReceipt(docId)
      setDetail(d)
    } catch {
      setError('Документ не найден')
    } finally {
      setLoading(false)
    }
  }, [docId])

  useEffect(() => { void load() }, [load])

  async function handleAdvance() {
    setAdvancing(true)
    try {
      await advanceReceiptStatus(docId)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setAdvancing(false)
    }
  }

  async function handleArrive() {
    setAdvancing(true)
    try {
      await arriveReceipt(docId)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setAdvancing(false)
    }
  }

  async function handleCancel() {
    const d = detail!
    const ok = await confirm({
      title: 'Аннулировать документ?',
      body: `Документ ${d.doc.doc_number} будет аннулирован. Это действие нельзя отменить.`,
      danger: true,
      confirmLabel: 'Аннулировать',
    })
    if (!ok) return
    try {
      await cancelReceipt(docId)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  async function handleReopen() {
    const ok = await confirm({
      title: 'Вернуть на проверку?',
      body: 'Документ будет переведён обратно в статус «На проверке». Все строки останутся без изменений.',
      confirmLabel: 'Вернуть на проверку',
    })
    if (!ok) return
    setAdvancing(true)
    try {
      await reopenReceipt(docId)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setAdvancing(false)
    }
  }

  if (loading) {
    return (
      <div className="page">
        <div style={{ padding: '80px 0', textAlign: 'center', color: 'var(--c-text-subtle)' }}>Загрузка…</div>
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className="page">
        <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--c-danger)' }}>
          {error || 'Документ не найден'}
        </div>
      </div>
    )
  }

  // Draft — render the create-like form
  if (detail.doc.status === 'draft') {
    return (
      <DraftView
        docId={docId}
        detail={detail}
        onReload={load}
        onAdvance={handleAdvance}
        advancing={advancing}
      />
    )
  }

  // Planned — редактирование плана, фиксация прибытия или аннулирование
  if (detail.doc.status === 'planned') {
    return (
      <PlannedView
        docId={docId}
        detail={detail}
        onReload={load}
        onUpdateLineQty={handleUpdateLineQty}
        onArrive={handleArrive}
        onCancel={handleCancel}
        advancing={advancing}
      />
    )
  }

  // on_review и done — рендерятся через ReviewView
  return (
    <ReviewView
      docId={docId}
      detail={detail}
      onReload={load}
      onAdvance={handleAdvance}
      onReopen={handleReopen}
      advancing={advancing}
    />
  )
}
