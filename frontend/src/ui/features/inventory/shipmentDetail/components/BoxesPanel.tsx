import { useState } from 'react'
import {
  closeShipmentBox,
  finishCollecting,
  releaseShipmentBox,
  reopenShipmentBox,
  SHIPMENT_BOX_STATUS_LABELS,
} from '../../../../../api/shipmentsApi'
import type { ShipmentBox, ShipmentDetail } from '../../../../../api/shipmentsApi'
import { Icon } from '../../../../primitives/Icon'
import { Badge } from '../../../../primitives/Badge'
import { PhaseBlock } from '../../../shared/process/PhaseBlock'
import { useToast } from '../../../../feedback/Toast'
import { useConfirm } from '../../../../feedback/ConfirmDialog'

type Props = {
  docId:      string
  doc:        ShipmentDetail
  canEdit:    boolean
  collected?: boolean
  onDone:     () => Promise<void> | void
}

function boxTone(status: ShipmentBox['status']): 'success' | 'info' | 'warning' {
  if (status === 'placed') return 'success'
  if (status === 'closed') return 'info'
  return 'warning'
}

/** Короба задачи размещения: что собрано и где оно теперь.
 *
 * Сборка идёт на ТСД (скан этикетки → скан товара → закрыть короб) и заканчивается
 * кнопкой «Сборка завершена» — на этом задача закрыта. Развозки по местам здесь нет:
 * её ведёт очередь коробов («Короба» → «Ждут развозки»), потому что одна ходка
 * тележки увозит объекты сразу нескольких задач.
 */
export function BoxesPanel({ docId, doc, canEdit, collected = false, onDone }: Props) {
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState<string | null>(null)

  const boxes = doc.boxes ?? []
  // Пустой открытый короб задачу не держит: при завершении сборки он освобождается сам.
  const unclosed = boxes.filter((b) => b.status === 'open' && b.items_qty > 0)
  const awaitingPlacement = boxes.filter((b) => b.status === 'closed')
  // Не упакованный остаток на столе: при завершении сборки он вернётся на хранение.
  const poolLeft = doc.lines.reduce((s, l) => s + l.available_for_pack, 0)
  const placedTotal = doc.lines.reduce((s, l) => s + l.placed_qty, 0)
  const boxedTotal = doc.lines.reduce((s, l) => s + l.boxed_qty, 0)
  const asideTotal = doc.lines.reduce((s, l) => s + l.aside_qty, 0)
  const defectTotal = doc.lines.reduce((s, l) => s + l.boxed_defect_qty, 0)
  const asideLines = doc.lines.filter((l) => l.aside_qty > 0)

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
    const ok = await confirm({
      title: 'Сборка завершена?',
      body: boxedTotal > 0
        ? `Собрано ${boxedTotal} шт. Задача закроется: короба и товар мимо коробов уйдут в очередь развозки — их развезёт кладовщик, когда повезёт ходку к стеллажам.`
        : 'Собранного товара нет — задача закроется сразу.',
      confirmLabel: 'Завершить сборку',
    })
    if (!ok) return
    await run('finish', () => finishCollecting(docId))
  }

  return (
    <PhaseBlock
      icon="box"
      title="Короба"
      role="shift_lead"
      state={collected ? 'done' : 'active'}
      hint={collected
        ? 'сборка завершена — развозка идёт в очереди коробов, задача её не ждёт'
        : 'сборка идёт на ТСД: скан короба → скан товара → закрыть короб'}
    >
      <div style={{ display: 'flex', gap: 16, padding: '4px 0 10px', fontSize: 13, flexWrap: 'wrap' }}>
        <span className="t-sub">Ждёт размещения: <b className="num">{boxedTotal}</b></span>
        {asideTotal > 0 && (
          <span className="t-sub">Из них мимо коробов: <b className="num">{asideTotal}</b></span>
        )}
        <span className="t-sub">Размещено по местам: <b className="num">{placedTotal}</b></span>
        {defectTotal > 0 && (
          <span style={{ color: 'var(--c-warning)' }}>Брак: <b className="num">{defectTotal}</b></span>
        )}
      </div>

      {boxes.length === 0 ? (
        <div className="t-sub" style={{ padding: '10px 0' }}>
          Короба ещё не собраны. На ТСД: скан этикетки короба → скан товара (каждый скан
          вносит упаковку) → закрыть короб. Этикетки печатаются заранее в разделе «Короба».
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {boxes.map((b) => (
            <div key={b.id} className="card" style={{ padding: '10px 12px' }}>
              <div className="row gap-8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontWeight: 600 }}>{b.doc_number}</span>
                <Badge tone={boxTone(b.status)}>{SHIPMENT_BOX_STATUS_LABELS[b.status]}</Badge>
                {b.quality === 'defect' && <Badge tone="danger">Брак</Badge>}
                <span className="t-sub">{b.items_qty} шт.</span>
                {b.zone_name && (
                  <span className="t-sub"><Icon name="archive" size={13} /> {b.zone_name}</span>
                )}
                <span style={{ flex: 1 }} />
                {!collected && canEdit && b.status === 'open' && (
                  b.items_qty === 0 ? (
                    <button
                      className="btn sm ghost"
                      disabled={busy != null}
                      title="Этикетку взяли по ошибке: короб вернётся в свободный пул"
                      onClick={() => { void run(`release-${b.id}`, () => releaseShipmentBox(docId, b.id)) }}
                    >
                      Освободить короб
                    </button>
                  ) : (
                    <button
                      className="btn sm"
                      disabled={busy != null}
                      onClick={() => { void run(`close-${b.id}`, () => closeShipmentBox(docId, b.id)) }}
                    >
                      Закрыть короб
                    </button>
                  )
                )}
                {!collected && canEdit && b.status === 'closed' && (
                  <button
                    className="btn sm ghost"
                    disabled={busy != null}
                    title="Доложить или исправить содержимое до конца сборки"
                    onClick={() => { void run(`reopen-${b.id}`, () => reopenShipmentBox(docId, b.id)) }}
                  >
                    Открыть заново
                  </button>
                )}
                {collected && b.status === 'closed' && (
                  <span className="t-sub" style={{ fontSize: 12 }}>ждёт развозки</span>
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

      {!collected && canEdit && (
        <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn primary"
            disabled={busy != null || unclosed.length > 0}
            title={unclosed.length > 0 ? 'Сначала закройте набранные короба' : undefined}
            onClick={() => { void handleFinish() }}
          >
            <Icon name="check" size={14} />Сборка завершена
          </button>
          {unclosed.length > 0 && (
            <span className="t-sub" style={{ fontSize: 12 }}>
              Не закрыто коробов: {unclosed.length}
            </span>
          )}
          {unclosed.length === 0 && poolLeft > 0 && (
            <span className="t-sub" style={{ fontSize: 12 }}>
              На столе ещё {poolLeft} шт — при завершении вернутся на хранение
            </span>
          )}
        </div>
      )}

      {collected && asideLines.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="t-sub" style={{ fontSize: 12, marginBottom: 6 }}>
            Собрано мимо коробов
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {asideLines.map((l) => (
              <div key={l.id} className="row gap-8" style={{ alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
                <span className="mono">{l.product_sku}</span>
                <span className="t-sub">
                  {[l.product_name, l.color_name, l.size_name].filter(Boolean).join(' · ')}
                </span>
                <span style={{ flex: 1 }} />
                <span className="num">{l.aside_qty}</span>
                {l.aside_defect_qty > 0 && (
                  <span style={{ color: 'var(--c-danger)' }}>брак {l.aside_defect_qty}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {collected && (awaitingPlacement.length > 0 || asideTotal > 0) && (
        <div className="t-sub" style={{ marginTop: 12, fontSize: 12 }}>
          Ждут развозки: коробов {awaitingPlacement.length}
          {asideTotal > 0 ? `, мимо коробов ${asideTotal} шт.` : ''} — развозка идёт на ТСД
          (скан коробов → скан места) или вручную в разделе «Короба».
        </div>
      )}
    </PhaseBlock>
  )
}
