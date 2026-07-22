import { useState } from 'react'
import type { ReturnToPackingPayload } from '../api/shipmentsApi'
import { Icon } from './Icon'
import { TextArea } from './TextArea'
import { useHardwareBack } from '../nav/backHandlers'

type Mode = 'rework' | 'repack_free' | 'repack_paid'

const MODES: { key: Mode; title: string; desc: string }[] = [
  {
    key: 'rework',
    title: 'Доработка упаковки',
    desc: 'Ошибки не было — упаковщик поправит или продолжит. Тарифицируется как обычно.',
  },
  {
    key: 'repack_free',
    title: 'Переупаковка за наш счёт',
    desc: 'Ошибка на нашей стороне — пакуем заново, клиенту повторно не выставляется.',
  },
  {
    key: 'repack_paid',
    title: 'Переупаковка за счёт клиента',
    desc: 'Ошибка клиента — повторная упаковка попадёт в счёт строкой «Доп. работы».',
  },
]

const CONFIRM_LABELS: Record<Mode, string> = {
  rework: 'Вернуть на упаковку',
  repack_free: 'Переупаковать за наш счёт',
  repack_paid: 'Переупаковать за счёт клиента',
}

/** «12,50» / «12.5» → копейки; null — не число. Пустая строка = null. */
function parseRubToKop(raw: string): number | null {
  const s = raw.trim().replace(',', '.')
  if (!s) return null
  const v = Number(s)
  if (!Number.isFinite(v) || v < 0) return null
  return Math.round(v * 100)
}

// Шторка возврата задачи упаковки: доработка / переупаковка без оплаты / за счёт клиента.
// Force-ветку (часть товара уже отгружена) обрабатывает сама: показывает подтверждение
// частичного возврата вместо закрытия.
export function ReturnToPackingSheet({
  docNumber,
  isPacked,
  onClose,
  onSubmit,
}: {
  docNumber: string
  isPacked: boolean
  onClose: () => void
  onSubmit: (payload: ReturnToPackingPayload) => Promise<void>
}) {
  const [mode, setMode] = useState<Mode>('rework')
  const [reason, setReason] = useState('')
  const [priceMode, setPriceMode] = useState<'standard' | 'custom'>('standard')
  const [unitPriceRub, setUnitPriceRub] = useState('')
  const [extraRub, setExtraRub] = useState('')
  const [extraComment, setExtraComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [forceMsg, setForceMsg] = useState('')

  useHardwareBack(() => { if (!saving) onClose() })

  const isRepack = mode !== 'rework'
  const unitPriceKop = priceMode === 'custom' ? parseRubToKop(unitPriceRub) : null
  const extraKop = extraRub.trim() ? parseRubToKop(extraRub) : 0

  const blockReason =
    isRepack && !reason.trim() ? 'Укажите причину переупаковки'
    : mode === 'repack_paid' && priceMode === 'custom' && unitPriceKop === null ? 'Укажите цену за единицу'
    : mode === 'repack_paid' && extraKop === null ? 'Сумма доп. работ указана неверно'
    : mode === 'repack_paid' && (extraKop ?? 0) > 0 && !extraComment.trim() ? 'Опишите, за что доп. работы'
    : null

  function buildPayload(force: boolean): ReturnToPackingPayload {
    if (mode === 'rework') return { mode, force }
    return {
      mode,
      reason: reason.trim(),
      force,
      ...(mode === 'repack_paid'
        ? {
            unit_price_kop: priceMode === 'custom' ? unitPriceKop : null,
            extra_amount_kop: extraKop || null,
            extra_comment: extraComment.trim() || null,
          }
        : {}),
    }
  }

  async function submit(force: boolean) {
    if (saving) return
    if (blockReason) { setError(blockReason); return }
    setSaving(true)
    setError('')
    try {
      await onSubmit(buildPayload(force))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось выполнить действие'
      if (!force && msg.includes('уже отгружена или закреплена за рейсом')) {
        setForceMsg(msg)
      } else {
        setError(msg)
      }
      setSaving(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={() => { if (!saving) onClose() }}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h3>Вернуть на упаковку</h3>
        <div className="tile-meta" style={{ marginTop: 2 }}>
          {docNumber}{isPacked ? ' · раскладка по местам будет откатана' : ''}
        </div>

        {forceMsg ? (
          <>
            <div className="alert" style={{ marginTop: 12 }}>
              <Icon name="alert" size={15} />
              {forceMsg} Часть уже отгружена и не вернётся на стол — вернуть только остаток?
            </div>
            <div className="dtf-actions">
              <button className="btn ghost" disabled={saving} onClick={() => setForceMsg('')}>Назад</button>
              <button className="btn danger" disabled={saving} onClick={() => void submit(true)}>
                Вернуть только остаток
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              {MODES.map((m) => {
                const active = mode === m.key
                return (
                  <button
                    key={m.key}
                    className={active ? 'btn' : 'btn ghost'}
                    style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2, textAlign: 'left', height: 'auto', padding: '10px 12px' }}
                    disabled={saving}
                    onClick={() => setMode(m.key)}
                  >
                    <span style={{ fontWeight: 600 }}>{m.title}</span>
                    <span className="tile-meta" style={{ whiteSpace: 'normal' }}>{m.desc}</span>
                  </button>
                )
              })}
            </div>

            {isRepack && (
              <div className="field" style={{ marginTop: 12 }}>
                <div className="flabel"><span>Причина переупаковки</span><span className="req">*</span></div>
                <TextArea
                  minRows={2}
                  placeholder="Например: неверное ТЗ — товар упакован не в те пакеты"
                  value={reason}
                  onChange={setReason}
                  disabled={saving}
                />
              </div>
            )}

            {mode === 'repack_paid' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                <div className="tile-meta" style={{ fontWeight: 600 }}>Тариф переупаковки</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className={priceMode === 'standard' ? 'btn sm' : 'btn ghost sm'}
                    disabled={saving}
                    onClick={() => setPriceMode('standard')}
                  >
                    Стандартный тариф
                  </button>
                  <button
                    className={priceMode === 'custom' ? 'btn sm' : 'btn ghost sm'}
                    disabled={saving}
                    onClick={() => setPriceMode('custom')}
                  >
                    Своя цена
                  </button>
                </div>
                {priceMode === 'custom' && (
                  <div className="field">
                    <div className="flabel"><span>Цена за единицу, ₽</span><span className="req">*</span></div>
                    <input
                      className="input"
                      inputMode="decimal"
                      placeholder="0,00"
                      value={unitPriceRub}
                      disabled={saving}
                      onChange={(e) => setUnitPriceRub(e.target.value)}
                    />
                  </div>
                )}
                <div className="field">
                  <div className="flabel"><span>Доп. работы сверх тарифа, ₽ (удаление старой упаковки и т.п.)</span></div>
                  <input
                    className="input"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={extraRub}
                    disabled={saving}
                    onChange={(e) => setExtraRub(e.target.value)}
                  />
                </div>
                {(extraKop ?? 0) > 0 && (
                  <div className="field">
                    <div className="flabel"><span>За что доп. работы</span><span className="req">*</span></div>
                    <TextArea
                      minRows={2}
                      placeholder="Например: удаление старой упаковки, пересборка 12 коробов"
                      value={extraComment}
                      onChange={setExtraComment}
                      disabled={saving}
                    />
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="alert" style={{ marginTop: 10 }}>
                <Icon name="alert" size={15} />
                {error}
              </div>
            )}

            <div className="dtf-actions">
              <button className="btn ghost" disabled={saving} onClick={onClose}>Отмена</button>
              <button
                className={isRepack ? 'btn danger' : 'btn'}
                disabled={saving || !!blockReason}
                onClick={() => void submit(false)}
              >
                {saving ? 'Сохранение…' : CONFIRM_LABELS[mode]}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
