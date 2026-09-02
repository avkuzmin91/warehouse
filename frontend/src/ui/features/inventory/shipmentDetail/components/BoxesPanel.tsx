import { useState } from 'react'
import {
  closeShipmentBox,
  finishPutaway,
  placeShipmentBox,
  reopenShipmentBox,
  SHIPMENT_BOX_STATUS_LABELS,
} from '../../../../../api/shipmentsApi'
import type { ShipmentBox, ShipmentDetail } from '../../../../../api/shipmentsApi'
import { Combobox } from '../../../../data/Combobox'
import { Icon } from '../../../../primitives/Icon'
import { Badge } from '../../../../primitives/Badge'
import { PhaseBlock } from '../../../shared/process/PhaseBlock'
import { useToast } from '../../../../feedback/Toast'
import { useConfirm } from '../../../../feedback/ConfirmDialog'

/** Опция места: адресная ячейка (id + человекочитаемый адрес). */
export type CellOption = { id: string; name: string }

type Props = {
  docId:       string
  doc:         ShipmentDetail
  cellOptions: CellOption[]
  canEdit:     boolean
  readOnly?:   boolean
  onDone:      () => Promise<void> | void
}

function boxTone(status: ShipmentBox['status']): 'success' | 'info' | 'warning' {
  if (status === 'placed') return 'success'
  if (status === 'closed') return 'info'
  return 'warning'
}

/** Короба задачи размещения: что собрано, где стоит, что осталось разложить.
 *
 * Основная работа идёт на ТСД (скан этикетки → скан товара → скан ячейки); здесь —
 * контроль и разбор ошибок: закрыть/открыть короб, поставить его в ячейку руками,
 * закрыть задачу, когда всё разложено.
 */
export function BoxesPanel({ docId, doc, cellOptions, canEdit, readOnly = false, onDone }: Props) {
  const toast = useToast()
  const confirm = useConfirm()
  const [zoneByBox, setZoneByBox] = useState<Record<string, string>>({})
  const [defectZone, setDefectZone] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const boxes = doc.boxes ?? []
  const pending = boxes.filter((b) => b.status !== 'placed')
  const defectPending = doc.lines.reduce((s, l) => s + l.packed_pending_defect, 0)
  // Не упакованный остаток на столе: при закрытии задачи он вернётся на хранение.
  const poolLeft = doc.lines.reduce((s, l) => s + l.available_for_pack, 0)
  const placedTotal = doc.lines.reduce((s, l) => s + l.placed_qty, 0)
  const boxedTotal = doc.lines.reduce((s, l) => s + l.boxed_qty, 0)
  const zoneOpts = cellOptions.map((z) => ({ value: z.id, label: z.name }))

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key)
    try {
      await fn()
      await onDone()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось выполнить действие', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function handleFinish() {
    if (defectPending > 0 && !defectZone) {
      toast(`Укажите ячейку для брака (${defectPending} шт.)`, 'error')
      return
    }
    const ok = await confirm({
      title: 'Закрыть задачу размещения?',
      body: `Разложено ${placedTotal} шт. Задача перейдёт в статус «Размещено», товар останется на хранении в ячейках.`,
      confirmLabel: 'Закрыть задачу',
    })
    if (!ok) return
    await run('finish', () => finishPutaway(docId, defectZone || null))
  }

  return (
    <PhaseBlock
      icon="box"
      title="Короба"
      role="warehouse"
      state={readOnly ? 'done' : 'active'}
      hint={readOnly ? 'товар разложен по ячейкам' : 'сборка и размещение идут на ТСД: скан короба → скан товара → скан ячейки'}
    >
      <div style={{ display: 'flex', gap: 16, padding: '4px 0 10px', fontSize: 13 }}>
        <span className="t-sub">В коробах на столе: <b className="num">{boxedTotal}</b></span>
        <span className="t-sub">Разложено по ячейкам: <b className="num">{placedTotal}</b></span>
        {defectPending > 0 && <span style={{ color: 'var(--c-warning)' }}>Брак: <b className="num">{defectPending}</b></span>}
      </div>

      {boxes.length === 0 ? (
        <div className="t-sub" style={{ padding: '10px 0' }}>
          Короба ещё не собраны. На ТСД: скан этикетки короба → скан товара (каждый скан
          вносит упаковку) → закрыть короб → скан ячейки. Этикетки печатаются заранее
          в разделе «Короба».
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {boxes.map((b) => (
            <div key={b.id} className="card" style={{ padding: '10px 12px' }}>
              <div className="row gap-8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontWeight: 600 }}>{b.doc_number}</span>
                <Badge tone={boxTone(b.status)}>{SHIPMENT_BOX_STATUS_LABELS[b.status]}</Badge>
                <span className="t-sub">{b.items_qty} шт.</span>
                {b.zone_name && (
                  <span className="t-sub"><Icon name="archive" size={13} /> {b.zone_name}</span>
                )}
                <span style={{ flex: 1 }} />
                {!readOnly && canEdit && b.status === 'open' && (
                  <button
                    className="btn sm"
                    disabled={busy != null || b.items_qty === 0}
                    onClick={() => { void run(`close-${b.id}`, () => closeShipmentBox(docId, b.id)) }}
                  >
                    Закрыть короб
                  </button>
                )}
                {!readOnly && canEdit && b.status === 'closed' && (
                  <>
                    <div style={{ minWidth: 200 }}>
                      <Combobox
                        options={zoneOpts}
                        value={zoneByBox[b.id] ?? ''}
                        onChange={(v) => setZoneByBox((prev) => ({ ...prev, [b.id]: String(v ?? '') }))}
                        placeholder="Ячейка"
                      />
                    </div>
                    <button
                      className="btn sm primary"
                      disabled={busy != null || !zoneByBox[b.id]}
                      onClick={() => { void run(`place-${b.id}`, () => placeShipmentBox(docId, b.id, zoneByBox[b.id])) }}
                    >
                      Разместить
                    </button>
                    <button
                      className="btn sm ghost"
                      disabled={busy != null}
                      onClick={() => { void run(`reopen-${b.id}`, () => reopenShipmentBox(docId, b.id)) }}
                    >
                      Открыть заново
                    </button>
                  </>
                )}
              </div>
              {b.contents.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {b.contents.map((c) => (
                    <div key={`${b.id}-${c.product_id}-${c.color_name ?? ''}-${c.size_name ?? ''}`}
                      className="row gap-8" style={{ fontSize: 12 }}>
                      <span className="mono">{c.product_sku ?? '—'}</span>
                      <span className="t-sub">
                        {[c.product_name, c.color_name, c.size_name].filter(Boolean).join(' · ')}
                      </span>
                      <span style={{ flex: 1 }} />
                      <span className="num">{c.qty}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!readOnly && canEdit && (
        <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {defectPending > 0 && (
            <div style={{ minWidth: 220 }}>
              <Combobox
                options={zoneOpts}
                value={defectZone}
                onChange={(v) => setDefectZone(String(v ?? ''))}
                placeholder="Ячейка для брака"
              />
            </div>
          )}
          <button
            className="btn primary"
            disabled={busy != null || pending.length > 0}
            title={pending.length > 0 ? 'Сначала закройте и разместите все короба' : undefined}
            onClick={() => { void handleFinish() }}
          >
            <Icon name="check" size={14} />Задача выполнена
          </button>
          {pending.length > 0 && (
            <span className="t-sub" style={{ fontSize: 12 }}>
              Не размещено коробов: {pending.length}
            </span>
          )}
          {pending.length === 0 && poolLeft > 0 && (
            <span className="t-sub" style={{ fontSize: 12 }}>
              На столе ещё {poolLeft} шт — при закрытии вернутся на хранение
            </span>
          )}
        </div>
      )}
    </PhaseBlock>
  )
}
