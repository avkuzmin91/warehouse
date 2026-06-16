import { useCallback, useEffect, useState } from 'react'
import {
  advanceReceiptStatus,
  cancelReceipt,
  closeReceiptShort,
  expectRedelivery,
  getReceipt,
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
 * - planned  → PlannedView (план поступления, ожидание рейса)
 * - partially_received / done → ReviewView (итог приёмки рейсами, закрытие недопоставки)
 * Приёмка идёт в рейсе (карточная приёмка убрана), поэтому on_intake в новом потоке нет.
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

  async function handleCloseShort() {
    const d = detail!
    const ok = await confirm({
      title: 'Закрыть с недопоставкой?',
      body: `Поступление ${d.doc.doc_number} будет завершено с фактически принятым количеством. Недовезённое не приедет.`,
      confirmLabel: 'Закрыть',
    })
    if (!ok) return
    setAdvancing(true)
    try {
      await closeReceiptShort(docId)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setAdvancing(false)
    }
  }

  async function handleExpectRedelivery() {
    const d = detail!
    const ok = await confirm({
      title: 'Ожидается довоз?',
      body: `Недовоз по ${d.doc.doc_number} будет освобождён. Поступление останется открытым — закажите новый рейс для довоза недостающего.`,
      confirmLabel: 'Освободить недовоз',
    })
    if (!ok) return
    setAdvancing(true)
    try {
      await expectRedelivery(docId)
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

  // Planned — план поступления, ожидание приёмки рейсом (без карточной приёмки).
  if (detail.doc.status === 'planned') {
    return (
      <PlannedView
        docId={docId}
        detail={detail}
        onReload={load}
        onCancel={handleCancel}
        advancing={advancing}
      />
    )
  }

  // partially_received / done (и легаси on_intake/on_review) — через ReviewView
  return (
    <ReviewView
      docId={docId}
      detail={detail}
      onReload={load}
      onAdvance={handleAdvance}
      onCloseShort={handleCloseShort}
      onExpectRedelivery={handleExpectRedelivery}
      advancing={advancing}
    />
  )
}
