import { useCallback, useEffect, useState } from 'react'
import { deleteProductPrice, getProductPrices, setProductPrice } from '../../../../api/pricingApi'
import type { ProductPriceDetail, PriceHistoryEntry } from '../../../../api/pricingApi'
import { Drawer } from '../../../feedback/Drawer'
import { Icon } from '../../../primitives/Icon'
import { DatePicker } from '../../../primitives/DatePicker'
import { useToast } from '../../../feedback/Toast'
import { useConfirm } from '../../../feedback/ConfirmDialog'
import { fmtDate, formatMoneyKopecks, moscowTodayYmd, parseRublesToKopecks } from '../../../../utils/format'

interface Props {
  productId: string
  onClose: () => void
  onSaved: () => void
}

export function PackingPriceDrawer({ productId, onClose, onSaved }: Props) {
  const toast = useToast()
  const confirm = useConfirm()
  const [detail, setDetail] = useState<ProductPriceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [good, setGood] = useState('')
  const [defect, setDefect] = useState('')
  const [effFrom, setEffFrom] = useState(moscowTodayYmd())
  const [saving, setSaving] = useState(false)

  const reload = useCallback(() => {
    return getProductPrices(productId)
      .then((d) => setDetail(d))
      .catch((e) => toast(e instanceof Error ? e.message : String(e), 'error'))
  }, [productId, toast])

  useEffect(() => {
    let alive = true
    setLoading(true)
    getProductPrices(productId)
      .then((d) => { if (alive) setDetail(d) })
      .catch((e) => { if (alive) toast(e instanceof Error ? e.message : String(e), 'error') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [productId, toast])

  const deleteEntry = useCallback(async (entry: PriceHistoryEntry) => {
    const ok = await confirm({
      title: 'Удалить запись тарифа?',
      body: `Запись «${formatMoneyKopecks(entry.price_kop)} с ${fmtDate(entry.effective_from)}» перестанет учитываться в расчётах. Это действие нельзя отменить.`,
      danger: true,
      confirmLabel: 'Удалить',
    })
    if (!ok) return
    try {
      await deleteProductPrice(productId, entry.id)
      toast('Запись удалена', 'success')
      await reload()
      onSaved()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }, [confirm, productId, reload, onSaved, toast])

  function save() {
    const goodKop = good.trim() ? parseRublesToKopecks(good) : null
    const defectKop = defect.trim() ? parseRublesToKopecks(defect) : null
    if (good.trim() && goodKop === null) { toast('Некорректная стоимость годного', 'error'); return }
    if (defect.trim() && defectKop === null) { toast('Некорректная стоимость брака', 'error'); return }
    if (goodKop === null && defectKop === null) { toast('Укажите стоимость годного или брака', 'error'); return }
    setSaving(true)
    setProductPrice(productId, {
      good_price_kop: goodKop,
      defect_price_kop: defectKop,
      effective_from: effFrom,
    })
      .then(() => { toast('Тариф сохранён', 'success'); onSaved() })
      .catch((e) => toast(e instanceof Error ? e.message : String(e), 'error'))
      .finally(() => setSaving(false))
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={detail ? detail.product_name : 'Стоимость упаковки'}
      subtitle={detail ? `${detail.sku ?? 'без SKU'} · ${detail.client_name ?? 'без клиента'}` : undefined}
      width={520}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" onClick={save} disabled={saving || loading}>
            <Icon name="check" size={14} />Сохранить тариф
          </button>
        </>
      }
    >
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}>
          <div style={{ width: 22, height: 22, border: '2px solid var(--c-border)', borderTopColor: 'var(--c-accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 6 }}>
            <CurrentChip label="Годный сейчас" value={detail?.good_price_kop} tone="success" />
            <CurrentChip label="Брак сейчас" value={detail?.defect_price_kop} tone="danger" />
          </div>

          <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)', margin: '14px 0 8px' }}>
            Новый тариф (за единицу). Действует с указанной даты; если она в прошлом — применится и к более раннему.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Стоимость годного, ₽">
              <input className="input sm" inputMode="decimal" placeholder="напр. 12,50"
                value={good} onChange={(e) => setGood(e.target.value)} />
            </Field>
            <Field label="Стоимость брака, ₽">
              <input className="input sm" inputMode="decimal" placeholder="напр. 5,00"
                value={defect} onChange={(e) => setDefect(e.target.value)} />
            </Field>
          </div>
          <Field label="Действует с">
            <DatePicker value={effFrom} onChange={setEffFrom} />
          </Field>

          <HistoryBlock title="История тарифа — годный" entries={detail?.good_history ?? []} onDelete={deleteEntry} />
          <HistoryBlock title="История тарифа — брак" entries={detail?.defect_history ?? []} onDelete={deleteEntry} />
        </>
      )}
    </Drawer>
  )
}

function CurrentChip({ label, value, tone }: { label: string; value: number | null | undefined; tone: 'success' | 'danger' }) {
  return (
    <div className="card" style={{ flex: 1, padding: '10px 12px' }}>
      <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: value != null ? `var(--c-${tone})` : 'var(--c-text-faint)' }}>
        {value != null ? formatMoneyKopecks(value) : 'нет тарифа'}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginTop: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginBottom: 5 }}>{label}</div>
      {children}
    </label>
  )
}

function HistoryBlock({ title, entries, onDelete }: { title: string; entries: PriceHistoryEntry[]; onDelete: (entry: PriceHistoryEntry) => void }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text-muted)', marginBottom: 6 }}>{title}</div>
      {entries.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--c-text-faint)' }}>Записей нет</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {entries.map((e) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
              <span className="mono" style={{ color: 'var(--c-text-subtle)', minWidth: 92 }}>с {fmtDate(e.effective_from)}</span>
              <span style={{ fontWeight: 600 }}>{formatMoneyKopecks(e.price_kop)}</span>
              <button
                className="btn ghost icon sm"
                style={{ marginLeft: 'auto', color: 'var(--c-danger)' }}
                title="Удалить запись"
                onClick={() => onDelete(e)}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
