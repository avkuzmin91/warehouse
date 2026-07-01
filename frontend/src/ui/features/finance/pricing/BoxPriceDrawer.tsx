import { useCallback, useEffect, useState } from 'react'
import { deleteClientBoxPrice, getClientBoxPrices, setClientBoxPrice } from '../../../../api/boxPricingApi'
import type { ClientBoxPriceDetail, BoxPriceHistoryEntry } from '../../../../api/boxPricingApi'
import { Drawer } from '../../../feedback/Drawer'
import { Icon } from '../../../primitives/Icon'
import { DatePicker } from '../../../primitives/DatePicker'
import { useToast } from '../../../feedback/Toast'
import { useConfirm } from '../../../feedback/ConfirmDialog'
import { fmtDate, formatMoneyKopecks, moscowTodayYmd, parseRublesToKopecks } from '../../../../utils/format'

interface Props {
  clientId: string
  onClose: () => void
  onSaved: () => void
}

export function BoxPriceDrawer({ clientId, onClose, onSaved }: Props) {
  const toast = useToast()
  const confirm = useConfirm()
  const [detail, setDetail] = useState<ClientBoxPriceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [price, setPrice] = useState('')
  const [effFrom, setEffFrom] = useState(moscowTodayYmd())
  const [saving, setSaving] = useState(false)

  const reload = useCallback(() => {
    return getClientBoxPrices(clientId)
      .then((d) => setDetail(d))
      .catch((e) => toast(e instanceof Error ? e.message : String(e), 'error'))
  }, [clientId, toast])

  useEffect(() => {
    let alive = true
    setLoading(true)
    getClientBoxPrices(clientId)
      .then((d) => { if (alive) setDetail(d) })
      .catch((e) => { if (alive) toast(e instanceof Error ? e.message : String(e), 'error') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [clientId, toast])

  const deleteEntry = useCallback(async (entry: BoxPriceHistoryEntry) => {
    const ok = await confirm({
      title: 'Удалить запись цены?',
      body: `Запись «${formatMoneyKopecks(entry.price_kop)} с ${fmtDate(entry.effective_from)}» перестанет учитываться в счетах. Это действие нельзя отменить.`,
      danger: true,
      confirmLabel: 'Удалить',
    })
    if (!ok) return
    try {
      await deleteClientBoxPrice(clientId, entry.id)
      toast('Запись удалена', 'success')
      await reload()
      onSaved()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }, [confirm, clientId, reload, onSaved, toast])

  function save() {
    const kop = price.trim() ? parseRublesToKopecks(price) : null
    if (kop === null) { toast('Укажите стоимость короба', 'error'); return }
    setSaving(true)
    setClientBoxPrice(clientId, { price_kop: kop, effective_from: effFrom })
      .then(() => { toast('Цена короба сохранена', 'success'); onSaved() })
      .catch((e) => toast(e instanceof Error ? e.message : String(e), 'error'))
      .finally(() => setSaving(false))
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={detail ? detail.client_name : 'Стоимость короба'}
      subtitle="Цена за один короб"
      width={520}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" onClick={save} disabled={saving || loading}>
            <Icon name="check" size={14} />Сохранить цену
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
          <div className="card" style={{ padding: '10px 12px', marginBottom: 6 }}>
            <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>Цена короба сейчас</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: detail?.price_kop != null ? 'var(--c-success)' : 'var(--c-text-faint)' }}>
              {detail?.price_kop != null ? formatMoneyKopecks(detail.price_kop) : 'нет цены'}
            </div>
          </div>

          <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)', margin: '14px 0 8px' }}>
            Новая цена (за один короб). Действует с указанной даты; если она в прошлом — применится и к более раннему.
          </div>

          <label style={{ display: 'block', marginTop: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginBottom: 5 }}>Стоимость короба, ₽</div>
            <input className="input sm" inputMode="decimal" placeholder="напр. 90,00"
              value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label style={{ display: 'block', marginTop: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginBottom: 5 }}>Действует с</div>
            <DatePicker value={effFrom} onChange={setEffFrom} />
          </label>

          <HistoryBlock title="История цены короба" entries={detail?.history ?? []} onDelete={deleteEntry} />
        </>
      )}
    </Drawer>
  )
}

function HistoryBlock({ title, entries, onDelete }: { title: string; entries: BoxPriceHistoryEntry[]; onDelete: (entry: BoxPriceHistoryEntry) => void }) {
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
