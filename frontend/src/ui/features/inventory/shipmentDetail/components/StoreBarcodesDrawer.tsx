import { useCallback, useEffect, useState } from 'react'
import {
  applyStoreBarcodes,
  getStoreBarcodeSuggestions,
  STORE_BARCODE_PULL_LABELS,
} from '../../../../../api/shipmentsApi'
import type { StoreBarcodeSuggestion, StoreBarcodePullStatus } from '../../../../../api/shipmentsApi'
import { Drawer } from '../../../../feedback/Drawer'
import { useToast } from '../../../../feedback/Toast'
import { Checkbox } from '../../../../primitives/Checkbox'
import { EmptyState } from '../../../../primitives/EmptyState'
import { Icon } from '../../../../primitives/Icon'

type Props = {
  docId: string
  docNumber: string
  onClose: () => void
  onDone: () => void
}

const TONE: Record<StoreBarcodePullStatus, string> = {
  ready:      'var(--c-success)',
  exists:     'var(--c-text-subtle)',
  ambiguous:  'var(--c-warning)',
  not_found:  'var(--c-text-subtle)',
  conflict:   'var(--c-danger)',
  no_store:   'var(--c-warning)',
  no_account: 'var(--c-warning)',
  no_variant: 'var(--c-warning)',
}

function hint(item: StoreBarcodeSuggestion): string {
  switch (item.status) {
    case 'ready':
      return `${item.account_name ?? 'кабинет'} · артикул ${item.card_offer_id ?? '—'}${item.card_size ? ` · размер ${item.card_size}` : ''}`
    case 'exists':
      return 'ШК магазина уже стоят у варианта'
    case 'ambiguous':
      return 'Под позицию подходит несколько карточек — свяжите её вручную в «Товарах маркетплейса»'
    case 'not_found':
      return 'В кабинете нет карточки с таким артикулом и размером'
    case 'conflict':
      return 'Все ШК карточки уже заняты другими вариантами'
    case 'no_store':
      return 'У строки не указан магазин'
    case 'no_account':
      return 'У магазина не выбран кабинет маркетплейса (справочник «Клиенты»)'
    case 'no_variant':
      return 'Цвето-размер строки не заведён в карточке товара'
  }
}

export function StoreBarcodesDrawer({ docId, docNumber, onClose, onDone }: Props) {
  const toast = useToast()
  const [items, setItems] = useState<StoreBarcodeSuggestion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [acting, setActing] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await getStoreBarcodeSuggestions(docId)
      setItems(res.items)
      setPicked(Object.fromEntries(res.items.filter((i) => i.status === 'ready').map((i) => [i.line_id, true])))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось получить карточки маркетплейса')
      setItems([])
    }
  }, [docId])

  useEffect(() => { void load() }, [load])

  const ready = (items ?? []).filter((i) => i.status === 'ready')
  const rest = (items ?? []).filter((i) => i.status !== 'ready')
  const chosen = ready.filter((i) => picked[i.line_id])
  const codesToWrite = chosen.reduce((sum, i) => sum + i.new_barcodes.length, 0)

  async function submit() {
    if (!chosen.length) return
    setActing(true)
    try {
      const res = await applyStoreBarcodes(docId, chosen.map((i) => i.line_id))
      toast(res.message, 'success')
      onDone()
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось записать ШК', 'error')
    } finally {
      setActing(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Подтянуть ШК из маркетплейса"
      subtitle={`${docNumber} · поиск в кабинете магазина строки`}
      width={560}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn ghost" disabled={acting} onClick={onClose}>Отмена</button>
          <button
            className="btn primary"
            disabled={acting || !chosen.length}
            onClick={() => { void submit() }}
          >
            <Icon name="check" size={13} />
            {acting ? 'Запись…' : `Записать ШК (${codesToWrite})`}
          </button>
        </div>
      }
    >
      <p style={{ marginTop: 0, fontSize: 13, color: 'var(--c-text-subtle)' }}>
        Карточка ищется в кабинете того магазина, что указан в строке: по связке товара, по общему ШК,
        иначе по артикулу продавца и размеру. Записанный ШК запоминает свой магазин — у одного варианта
        в разных магазинах коды разные.
      </p>

      {error && <div style={{ color: 'var(--c-danger)', fontSize: 12.5, marginBottom: 10 }}>{error}</div>}

      {items === null ? (
        <div className="t-sub">Загрузка карточек…</div>
      ) : items.length === 0 ? (
        <EmptyState title="Состав пуст" sub="Нет позиций для подбора ШК" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {ready.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Найдено ({ready.length})</div>
              {ready.map((item) => (
                <div
                  key={item.line_id}
                  style={{
                    padding: 10, border: '1px solid var(--c-border)', borderRadius: 6,
                    background: 'var(--c-bg-elev)',
                  }}
                >
                  <Checkbox
                    checked={picked[item.line_id] ?? false}
                    onChange={(v) => setPicked((prev) => ({ ...prev, [item.line_id]: v }))}
                    label={`${item.product_name ?? ''} · ${[item.color_name, item.size_name].filter(Boolean).join(' · ') || 'без варианта'}`}
                  />
                  <div className="text-xs subtle" style={{ marginTop: 4 }}>
                    Магазин «{item.store_name ?? '—'}» · {hint(item)}
                  </div>
                  <div className="mono" style={{ fontSize: 12.5, marginTop: 4 }}>
                    {item.new_barcodes.join(', ')}
                  </div>
                  {item.conflicts.length > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--c-danger)', marginTop: 4 }}>
                      Пропущены занятые: {item.conflicts.map((c) => `${c.code} → ${c.owner}`).join('; ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {rest.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Без изменений ({rest.length})</div>
              {rest.map((item) => (
                <div key={item.line_id} style={{ padding: '8px 10px', background: 'var(--c-bg-sunken)', borderRadius: 6 }}>
                  <div style={{ fontSize: 12.5 }}>
                    {item.product_name ?? ''} · {[item.color_name, item.size_name].filter(Boolean).join(' · ') || 'без варианта'}
                  </div>
                  <div className="text-xs" style={{ color: TONE[item.status], marginTop: 2 }}>
                    {STORE_BARCODE_PULL_LABELS[item.status]} — {hint(item)}
                  </div>
                  {item.conflicts.length > 0 && (
                    <div className="text-xs" style={{ color: 'var(--c-danger)', marginTop: 2 }}>
                      {item.conflicts.map((c) => `${c.code} → ${c.owner}`).join('; ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Drawer>
  )
}
