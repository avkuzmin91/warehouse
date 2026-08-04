import { useState } from 'react'
import type { ReturnToPackingPayload } from '../../../../../api/shipmentsApi'
import { Drawer } from '../../../../feedback/Drawer'
import { AutoGrowTextarea, Field } from '../../../../primitives/Input'
import { Icon } from '../../../../primitives/Icon'

export type ReturnMode = 'rework' | 'repack_free' | 'repack_paid'

type Props = {
  open: boolean
  docNumber: string
  isPacked: boolean
  acting: boolean
  onClose: () => void
  onSubmit: (payload: ReturnToPackingPayload) => Promise<void>
}

const MODES: { key: ReturnMode; title: string; desc: string }[] = [
  {
    key: 'rework',
    title: 'Доработка упаковки',
    desc: 'Ошибки не было — упаковщик продолжит или поправит текущую упаковку. Операции тарифицируются как обычно.',
  },
  {
    key: 'repack_free',
    title: 'Переупаковка за наш счёт',
    desc: 'Задача была поставлена с ошибкой на нашей стороне — товар упаковывается заново. Повторная упаковка клиенту не выставляется, первая остаётся оплаченной.',
  },
  {
    key: 'repack_paid',
    title: 'Переупаковка за счёт клиента',
    desc: 'Переделка по вине клиента — повторная упаковка будет выставлена ему отдельной строкой «Доп. работы» в счёте (первая упаковка тоже остаётся оплаченной).',
  },
]

const CONFIRM_LABELS: Record<ReturnMode, string> = {
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

export function ReturnToPackingDrawer({ open, docNumber, isPacked, acting, onClose, onSubmit }: Props) {
  const [mode, setMode] = useState<ReturnMode>('rework')
  const [reason, setReason] = useState('')
  const [priceMode, setPriceMode] = useState<'standard' | 'custom'>('standard')
  const [unitPriceRub, setUnitPriceRub] = useState('')
  const [extraRub, setExtraRub] = useState('')
  const [extraComment, setExtraComment] = useState('')

  function reset() {
    setMode('rework')
    setReason('')
    setPriceMode('standard')
    setUnitPriceRub('')
    setExtraRub('')
    setExtraComment('')
  }

  function close() {
    reset()
    onClose()
  }

  const isRepack = mode !== 'rework'
  const unitPriceKop = priceMode === 'custom' ? parseRubToKop(unitPriceRub) : null
  const extraKop = extraRub.trim() ? parseRubToKop(extraRub) : 0

  const blockReason =
    isRepack && !reason.trim() ? 'Укажите причину переупаковки'
    : mode === 'repack_paid' && priceMode === 'custom' && unitPriceKop === null ? 'Укажите цену за единицу'
    : mode === 'repack_paid' && extraKop === null ? 'Сумма доп. работ указана неверно'
    : mode === 'repack_paid' && (extraKop ?? 0) > 0 && !extraComment.trim() ? 'Опишите, за что доп. работы'
    : null

  async function submit() {
    if (blockReason) return
    const payload: ReturnToPackingPayload =
      mode === 'rework'
        ? { mode }
        : {
            mode,
            reason: reason.trim(),
            ...(mode === 'repack_paid'
              ? {
                  unit_price_kop: priceMode === 'custom' ? unitPriceKop : null,
                  extra_amount_kop: extraKop || null,
                  extra_comment: extraComment.trim() || null,
                }
              : {}),
          }
    await onSubmit(payload)
    reset()
  }

  const radioRow = (checked: boolean, label: string, onPick: () => void) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
      <span className={`t-radio ${checked ? 'checked' : ''}`} />
      <input type="radio" checked={checked} onChange={onPick} style={{ display: 'none' }} />
      {label}
    </label>
  )

  return (
    <Drawer
      open={open}
      onClose={close}
      title="Вернуть на упаковку"
      subtitle={`${docNumber} · выбор режима`}
      width={480}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn ghost" disabled={acting} onClick={close}>Отмена</button>
          <button
            className={`btn primary${isRepack ? ' danger' : ''}`}
            disabled={acting || !!blockReason}
            title={blockReason ?? undefined}
            onClick={() => { void submit() }}
          >
            <Icon name="arrowLeft" size={14} />{CONFIRM_LABELS[mode]}
          </button>
        </div>
      }
    >
      <p style={{ marginTop: 0, fontSize: 13, color: 'var(--c-text-subtle)' }}>
        {isPacked
          ? 'Задача вернётся на этап «На упаковке», раскладка по местам будет отменена. Если часть товара уже отгружена, предложим вернуть только остаток.'
          : 'Задача вернётся на этап «На упаковке».'}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {MODES.map((m) => {
          const active = mode === m.key
          return (
            <label
              key={m.key}
              style={{
                display: 'flex', gap: 11, alignItems: 'flex-start', cursor: 'pointer',
                padding: '10px 12px', borderRadius: 'var(--r-md)',
                border: `1px solid ${active ? 'var(--c-accent-border)' : 'var(--c-border)'}`,
                background: active ? 'var(--c-accent-bg)' : 'var(--c-bg-elev)',
              }}
            >
              <span className={`t-radio ${active ? 'checked' : ''}`} style={{ marginTop: 2 }} />
              <input
                type="radio"
                name="return-mode"
                checked={active}
                onChange={() => setMode(m.key)}
                style={{ display: 'none' }}
              />
              <span>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{m.title}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--c-text-subtle)', marginTop: 2 }}>{m.desc}</span>
              </span>
            </label>
          )
        })}
      </div>

      {isRepack && (
        <Field label="Причина переупаковки" required style={{ marginBottom: mode === 'repack_paid' ? 14 : 0 }}>
          <AutoGrowTextarea
            minRows={2}
            placeholder="Например: неверное ТЗ — товар упакован не в те пакеты"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ resize: 'vertical', minHeight: 60 }}
          />
        </Field>
      )}

      {mode === 'repack_paid' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 12, borderRadius: 'var(--r-lg)', background: 'var(--c-bg-sunken)' }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Тариф переупаковки</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {radioRow(priceMode === 'standard', 'Стандартный тариф упаковки (на дату переупаковки)', () => setPriceMode('standard'))}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {radioRow(priceMode === 'custom', 'Своя цена за единицу', () => setPriceMode('custom'))}
                {priceMode === 'custom' && (
                  <>
                    <input
                      className="input sm num"
                      style={{ width: 90 }}
                      inputMode="decimal"
                      placeholder="0,00"
                      value={unitPriceRub}
                      onChange={(e) => setUnitPriceRub(e.target.value)}
                    />
                    <span style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>₽/шт.</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 2 }}>Доп. работы сверх тарифа</div>
            <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginBottom: 6 }}>
              Работы, которых нет в тарифе упаковки: удаление старой упаковки, пересборка коробов и т.п. Сумма добавится к счёту.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <input
                className="input sm num"
                style={{ width: 110 }}
                inputMode="decimal"
                placeholder="0,00"
                value={extraRub}
                onChange={(e) => setExtraRub(e.target.value)}
              />
              <span style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>₽ за все работы</span>
            </div>
            {(extraKop ?? 0) > 0 && (
              <Field label="За что доп. работы" required style={{ marginBottom: 0 }}>
                <AutoGrowTextarea
                  minRows={2}
                  placeholder="Например: удаление старой упаковки, пересборка 12 коробов"
                  value={extraComment}
                  onChange={(e) => setExtraComment(e.target.value)}
                  style={{ resize: 'vertical', minHeight: 48 }}
                />
              </Field>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
            После завершения переупаковки запись «Доп. работы» создастся автоматически — финансист прикрепит её к счёту клиента.
          </div>
        </div>
      )}
    </Drawer>
  )
}
