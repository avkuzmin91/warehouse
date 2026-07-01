import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { recommendedPallets, recommendedBoxes } from '../../../../../api/dispatchApi'
import { Icon } from '../../../../primitives/Icon'

type Props = {
  productName:     string
  itemsPerBox:     number | null
  boxesPerPallet:  number | null
  qty:             number
  pallets:         number | null
  boxes:           number | null
  palletsTouched:  boolean
  boxesTouched:    boolean
  canEdit:         boolean
  /** Пишет кратность в карточку товара; true — успех (родитель перезагрузит doc). */
  onSaveProduct: (patch: { items_per_box?: number | null; boxes_per_pallet?: number | null }) => Promise<boolean>
}

/** Чип кратности упаковки под полями «Короба/Палеты» — по аналогии с чипом доступности
 *  в плане отгрузки (AvailabilityCell). Лицо чипа = рекомендация «N кор · M пал» для
 *  текущего количества; ховер раскрывает цепочку расчёта `штуки → короба → палеты`
 *  (палета меряется в коробах). Клик (если можно редактировать) открывает ввод кратности,
 *  которая живёт на товаре (`items_per_box`, `boxes_per_pallet`) и переиспользуется на всех
 *  будущих отгрузках. Плюс умные чипы-предложения из введённых вручную чисел. */
export function PackMultiplicity({
  productName, itemsPerBox, boxesPerPallet, qty, pallets, boxes,
  palletsTouched, boxesTouched, canEdit, onSaveProduct,
}: Props) {
  const [hoverOpen, setHoverOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const chipRef = useRef<HTMLButtonElement>(null)

  const boxReco = recommendedBoxes(qty, itemsPerBox)
  const palletReco = recommendedPallets(boxes ?? boxReco, boxesPerPallet)
  const fullySet = itemsPerBox != null && boxesPerPallet != null

  // Предложение = целочисленное деление введённых вручную чисел, но только если кратность
  // по этой оси ещё не задана (иначе не надоедаем). Короб: шт ÷ коробов = штук в коробе.
  // Палета: коробов ÷ палет = коробов на палете (меряется в коробах, не в штуках).
  const suggestPerBox = canEdit && boxesTouched && itemsPerBox == null
    && boxes != null && boxes > 0 && qty % boxes === 0 ? qty / boxes : null
  const suggestPerPallet = canEdit && palletsTouched && boxesPerPallet == null
    && pallets != null && pallets > 0 && boxes != null && boxes > 0 && boxes % pallets === 0 ? boxes / pallets : null

  async function saveAndReset(patch: { items_per_box?: number | null; boxes_per_pallet?: number | null }) {
    setSaving(true)
    try {
      const ok = await onSaveProduct(patch)
      if (ok) setEditOpen(false)
      return ok
    } finally {
      setSaving(false)
    }
  }

  function openEdit() {
    if (!canEdit) return
    setHoverOpen(false)
    setEditOpen(true)
  }

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, justifyContent: 'flex-end', alignItems: 'center' }}>
        {suggestPerBox != null && (
          <SuggestChip label={`${suggestPerBox} шт/короб`} disabled={saving} onClick={() => void saveAndReset({ items_per_box: suggestPerBox })} />
        )}
        {suggestPerPallet != null && (
          <SuggestChip label={`${suggestPerPallet} кор/палет`} disabled={saving} onClick={() => void saveAndReset({ boxes_per_pallet: suggestPerPallet })} />
        )}

        <button
          ref={chipRef}
          type="button"
          onMouseEnter={() => { if (!editOpen) setHoverOpen(true) }}
          onMouseLeave={() => setHoverOpen(false)}
          onClick={openEdit}
          disabled={!canEdit && fullySet}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 500,
            whiteSpace: 'nowrap', border: 'none',
            cursor: canEdit ? 'pointer' : 'default',
            background: fullySet ? 'var(--c-success-bg)' : canEdit ? 'var(--c-accent-bg)' : 'var(--c-bg-sunken)',
            color: fullySet ? 'var(--c-success)' : canEdit ? 'var(--c-accent)' : 'var(--c-text-muted)',
          }}
        >
          {fullySet ? (
            <><Icon name="box" size={12} />{boxReco ?? '—'} кор · {palletReco ?? '—'} пал</>
          ) : canEdit ? (
            <><Icon name="plus" size={12} />Задать кратность</>
          ) : (
            <><Icon name="alert" size={12} />кратность не задана</>
          )}
        </button>
      </div>

      {hoverOpen && !editOpen && (
        <CalcPopover
          anchorRef={chipRef}
          qty={qty}
          itemsPerBox={itemsPerBox}
          boxesPerPallet={boxesPerPallet}
          boxReco={boxReco}
          palletReco={palletReco}
          boxes={boxes}
          pallets={pallets}
          canEdit={canEdit}
        />
      )}

      {editOpen && (
        <MultiplicityPopover
          anchorRef={chipRef}
          productName={productName}
          itemsPerBox={itemsPerBox}
          boxesPerPallet={boxesPerPallet}
          saving={saving}
          onCancel={() => setEditOpen(false)}
          onSave={saveAndReset}
        />
      )}
    </div>
  )
}

function SuggestChip({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title="Сохранить как кратность товара"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5,
        padding: '2px 9px', borderRadius: 20, cursor: 'pointer',
        border: '0.5px solid var(--c-success)', color: 'var(--c-success)',
        background: 'var(--c-success-bg)',
      }}
    >
      <Icon name="sparkles" size={11} />{label} — сохранить?
    </button>
  )
}

const CALC_W = 224

/** Ховер-поповер с раскладкой расчёта упаковки: штуки → короба → палеты.
 *  Read-only (pointerEvents:none), рендерится порталом в body — у карточки отгрузки
 *  предки с overflow:hidden срезали бы absolute-поповер. */
function CalcPopover({
  anchorRef, qty, itemsPerBox, boxesPerPallet, boxReco, palletReco, boxes, pallets, canEdit,
}: {
  anchorRef:      React.RefObject<HTMLButtonElement | null>
  qty:            number
  itemsPerBox:    number | null
  boxesPerPallet: number | null
  boxReco:        number | null
  palletReco:     number | null
  boxes:          number | null
  pallets:        number | null
  canEdit:        boolean
}) {
  const popRef = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<React.CSSProperties>({ position: 'fixed', top: -9999, left: -9999 })

  const place = useCallback(() => {
    const t = anchorRef.current?.getBoundingClientRect()
    if (!t) return
    const gap = 6
    const ph = popRef.current?.offsetHeight ?? 0
    const left = Math.min(Math.max(t.right - CALC_W, 8), window.innerWidth - CALC_W - 8)
    const roomBelow = window.innerHeight - t.bottom
    const up = roomBelow < ph + gap + 8 && t.top > ph + gap + 8
    const top = up ? t.top - gap - ph : t.bottom + gap
    setStyle({ position: 'fixed', top, left, width: CALC_W })
  }, [anchorRef])

  useLayoutEffect(() => {
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [place])

  const someMissing = itemsPerBox == null || boxesPerPallet == null
  const divergesBoxes = boxReco != null && boxes != null && boxes !== boxReco
  const divergesPallets = palletReco != null && pallets != null && pallets !== palletReco

  return createPortal(
    <div
      ref={popRef}
      style={{
        ...style, zIndex: 9999, textAlign: 'left', pointerEvents: 'none',
        background: 'var(--c-bg-elev)', border: '1px solid var(--c-border)',
        borderRadius: 8, boxShadow: 'var(--sh-2)', padding: '10px 12px',
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--c-text-muted)', marginBottom: 6 }}>Расчёт упаковки</div>
      <CalcRow label="Количество" value={`${qty} шт`} />
      <div style={{ borderTop: '1px solid var(--c-border)', margin: '5px 0', paddingTop: 5 }}>
        <CalcRow label="Штук в коробе" value={itemsPerBox != null ? String(itemsPerBox) : '—'} />
        <CalcRow label="→ Коробов" value={boxReco != null ? String(boxReco) : '—'} tone="success" note={itemsPerBox ? `${qty} ÷ ${itemsPerBox}` : undefined} />
      </div>
      <div style={{ borderTop: '1px solid var(--c-border)', margin: '5px 0', paddingTop: 5 }}>
        <CalcRow label="Коробов на палете" value={boxesPerPallet != null ? String(boxesPerPallet) : '—'} />
        <CalcRow label="→ Палет" value={palletReco != null ? String(palletReco) : '—'} tone="success" note={boxesPerPallet && (boxes ?? boxReco) ? `${boxes ?? boxReco} ÷ ${boxesPerPallet}` : undefined} />
      </div>
      {(divergesBoxes || divergesPallets) && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--c-text-muted)' }}>
          Введено вручную: {boxes ?? '—'} кор · {pallets ?? '—'} пал
        </div>
      )}
      {someMissing && (
        <div style={{ marginTop: 7, fontSize: 11, color: 'var(--c-text-muted)', display: 'flex', gap: 5, alignItems: 'flex-start' }}>
          <Icon name="alert" size={12} style={{ flexShrink: 0, marginTop: 1 }} />
          {canEdit ? 'Нажмите, чтобы задать кратность' : 'Кратность не задана в карточке товара'}
        </div>
      )}
    </div>,
    document.body,
  )
}

function CalcRow({ label, value, tone, note }: { label: string; value: string; tone?: 'success'; note?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, fontSize: 12, padding: '2px 0' }}>
      <span style={{ color: 'var(--c-text-subtle)' }}>{label}</span>
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
        {note && <span className="mono" style={{ fontSize: 10.5, color: 'var(--c-text-muted)' }}>{note}</span>}
        <span className="mono" style={{ color: tone === 'success' ? 'var(--c-success)' : undefined, fontWeight: tone === 'success' ? 600 : undefined }}>{value}</span>
      </span>
    </div>
  )
}

const POPOVER_W = 236
const POPOVER_EST_H = 200

function MultiplicityPopover({
  anchorRef, productName, itemsPerBox, boxesPerPallet, saving, onCancel, onSave,
}: {
  anchorRef:      React.RefObject<HTMLButtonElement | null>
  productName:    string
  itemsPerBox:    number | null
  boxesPerPallet: number | null
  saving:         boolean
  onCancel:       () => void
  onSave:         (patch: { items_per_box?: number | null; boxes_per_pallet?: number | null }) => Promise<boolean>
}) {
  const [perBox, setPerBox] = useState(itemsPerBox != null ? String(itemsPerBox) : '')
  const [boxesPer, setBoxesPer] = useState(boxesPerPallet != null ? String(boxesPerPallet) : '')

  function parse(raw: string): number | null {
    const t = raw.trim()
    return t === '' ? null : Math.max(0, parseInt(t, 10))
  }

  // Портал + fixed: у карточки отгрузки есть предки с overflow:hidden (MAIN и грид),
  // которые обрезали бы absolute-поповер снизу. Координаты считаем от чипа-якоря.
  const rect = anchorRef.current?.getBoundingClientRect()
  const left = rect ? Math.max(8, Math.min(rect.right - POPOVER_W, window.innerWidth - POPOVER_W - 8)) : 8
  const below = rect ? rect.bottom + 4 : 8
  const above = rect ? rect.top - POPOVER_EST_H - 4 : 8
  const openUp = rect ? rect.bottom + POPOVER_EST_H + 8 > window.innerHeight && above > 8 : false
  const top = openUp ? above : below

  return createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 60 }} onClick={onCancel} />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed', left, top, zIndex: 61,
          width: POPOVER_W, textAlign: 'left', padding: 12, borderRadius: 10,
          background: 'var(--c-bg-elev)', border: '0.5px solid var(--c-border)', boxShadow: 'var(--sh-2)',
        }}
      >
      <div style={{ fontSize: 13, fontWeight: 500 }}>Кратность упаковки</div>
      <div className="t-sub" style={{ marginTop: 2, whiteSpace: 'normal', lineHeight: 1.4 }}>
        «{productName}» — сохранится для всех отгрузок товара
      </div>
      <PopField label="шт в коробе" value={perBox} onChange={setPerBox} />
      <PopField label="коробов на палете" value={boxesPer} onChange={setBoxesPer} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button type="button" className="btn ghost sm" onClick={onCancel}>Отмена</button>
        <button
          type="button"
          className="btn primary sm"
          disabled={saving}
          onClick={() => void onSave({ items_per_box: parse(perBox), boxes_per_pallet: parse(boxesPer) })}
        >
          <Icon name={saving ? 'refresh' : 'save'} size={12} style={saving ? { animation: 'spin 0.7s linear infinite' } : undefined} />
          Сохранить
        </button>
      </div>
      </div>
    </>,
    document.body,
  )
}

function PopField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10 }}>
      <span style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>{label}</span>
      <input
        className="input sm num"
        inputMode="numeric"
        placeholder="—"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        style={{ width: 72, textAlign: 'right' }}
      />
    </label>
  )
}
