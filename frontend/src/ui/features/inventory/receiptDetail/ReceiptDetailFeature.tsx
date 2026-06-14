import { useCallback, useEffect, useState } from 'react'
import {
  advanceReceiptStatus,
  arriveReceipt,
  cancelReceipt,
  getReceipt,
  startReceiptIntake,
} from '../../../../api/receiptsApi'
import type { ReceiptArriveLine, ReceiptDetail } from '../../../../api/receiptsApi'
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

  async function handleArrive(lines: ReceiptArriveLine[]) {
    setAdvancing(true)
    try {
      await arriveReceipt(docId, lines)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setAdvancing(false)
    }
  }

  async function handleStartIntake() {
    setAdvancing(true)
    try {
      await startReceiptIntake(docId)
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

  // Planned — план поступления + «Начать приёмку».
  // On_intake — подсчёт «Принято» + «Принять товары». Та же вью, разные действия.
  if (detail.doc.status === 'planned' || detail.doc.status === 'on_intake') {
    return (
      <PlannedView
        docId={docId}
        detail={detail}
        onReload={load}
        onArrive={handleArrive}
        onStartIntake={handleStartIntake}
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
      advancing={advancing}
    />
  )
}
