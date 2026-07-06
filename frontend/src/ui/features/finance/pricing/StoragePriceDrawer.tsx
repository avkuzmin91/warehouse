import { useCallback, useEffect, useState } from 'react'
import { deleteClientStoragePrice, getClientStoragePrices, setClientStoragePrice, STORAGE_UNIT_LABELS, storageRateLabel } from '../../../../api/storagePricingApi'
import type { ClientStoragePriceDetail, StoragePriceHistoryEntry, StorageUnit } from '../../../../api/storagePricingApi'
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

export function StoragePriceDrawer({ clientId, onClose, onSaved }: Props) {
  const toast = useToast()
  const confirm = useConfirm()
  const [detail, setDetail] = useState<ClientStoragePriceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [unit, setUnit] = useState<StorageUnit>('piece')
  const [price, setPrice] = useState('')
  const [freeDays, setFreeDays] = useState('14')
  const [effFrom, setEffFrom] = useState(moscowTodayYmd())
  const [saving, setSaving] = useState(false)

  const reload = useCallback(() => {
    return getClientStoragePrices(clientId)
      .then((d) => setDetail(d))
      .catch((e) => toast(e instanceof Error ? e.message : String(e), 'error'))
  }, [clientId, toast])

  useEffect(() => {
    let alive = true
    setLoading(true)
    getClientStoragePrices(clientId)
      .then((d) => {
        if (!alive) return
        setDetail(d)
        if (d.unit) setUnit(d.unit)
        if (d.free_days != null) setFreeDays(String(d.free_days))
      })
      .catch((e) => { if (alive) toast(e instanceof Error ? e.message : String(e), 'error') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [clientId, toast])

  const deleteEntry = useCallback(async (entry: StoragePriceHistoryEntry) => {
    const ok = await confirm({
      title: 'Удалить запись тарифа?',
      body: `Запись «${formatMoneyKopecks(entry.price_kop)} / ${STORAGE_UNIT_LABELS[entry.unit].toLowerCase()} · день с ${fmtDate(entry.effective_from)}» перестанет учитываться в новых начислениях. Уже начисленные дни не пересчитываются. Это действие нельзя отменить.`,
      danger: true,
      confirmLabel: 'Удалить',
    })
    if (!ok) return
    try {
      await deleteClientStoragePrice(clientId, entry.id)
      toast('Запись удалена', 'success')
      await reload()
      onSaved()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }, [confirm, clientId, reload, onSaved, toast])

  function save() {
    const kop = price.trim() ? parseRublesToKopecks(price) : null
    if (kop === null) { toast('Укажите ставку хранения', 'error'); return }
    const fd = Number(freeDays.trim())
    if (!Number.isInteger(fd) || fd < 0) { toast('Укажите бесплатный период (целое число дней, 0 — платно с первого дня)', 'error'); return }
    setSaving(true)
    setClientStoragePrice(clientId, { unit, price_kop: kop, free_days: fd, effective_from: effFrom })
      .then(() => { toast('Тариф хранения сохранён', 'success'); onSaved() })
      .catch((e) => toast(e instanceof Error ? e.message : String(e), 'error'))
      .finally(() => setSaving(false))
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={detail ? detail.client_name : 'Стоимость хранения'}
      subtitle="Ставка за единицу хранения в день"
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
          <div className="card" style={{ padding: '10px 12px', marginBottom: 6 }}>
            <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>Тариф сейчас</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: detail?.price_kop != null ? 'var(--c-success)' : 'var(--c-text-faint)' }}>
              {detail?.price_kop != null ? storageRateLabel(detail) : 'нет тарифа'}
            </div>
            {detail?.price_kop != null && (
              <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginTop: 2 }}>
                Бесплатный период: {detail.free_days} дн.
                {detail.billing_start ? ` · отсчёт хранения с ${fmtDate(detail.billing_start)}` : ''}
              </div>
            )}
          </div>

          <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)', margin: '14px 0 8px' }}>
            Новые условия действуют с указанной даты; уже начисленные дни не пересчитываются.
            Отсчёт хранения клиента начинается с даты самой первой записи тарифа.
          </div>

          <label style={{ display: 'block', marginTop: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginBottom: 5 }}>Единица тарификации</div>
            <select className="input sm" value={unit} onChange={(e) => setUnit(e.target.value as StorageUnit)}>
              {(Object.keys(STORAGE_UNIT_LABELS) as StorageUnit[]).map((u) => (
                <option key={u} value={u}>{STORAGE_UNIT_LABELS[u]}</option>
              ))}
            </select>
          </label>
          {unit !== 'piece' && (
            <div style={{ fontSize: 12, color: 'var(--c-warning)', marginTop: 6 }}>
              Штуки пересчитываются по вместимости из карточки товара
              ({unit === 'box' ? '«шт. в коробе»' : '«шт. в коробе» × «коробов на палете»'}) с округлением вверх.
              Товары без вместимости не тарифицируются и подсвечиваются в отчёте.
            </div>
          )}
          <label style={{ display: 'block', marginTop: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginBottom: 5 }}>Ставка за единицу в день, ₽</div>
            <input className="input sm" inputMode="decimal" placeholder="напр. 1,50"
              value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label style={{ display: 'block', marginTop: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginBottom: 5 }}>Бесплатный период, календарных дней</div>
            <input className="input sm" inputMode="numeric" placeholder="напр. 14"
              value={freeDays} onChange={(e) => setFreeDays(e.target.value)} />
          </label>
          <label style={{ display: 'block', marginTop: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginBottom: 5 }}>Действует с</div>
            <DatePicker value={effFrom} onChange={setEffFrom} />
          </label>

          <HistoryBlock title="История тарифа" entries={detail?.history ?? []} onDelete={deleteEntry} />
        </>
      )}
    </Drawer>
  )
}

function HistoryBlock({ title, entries, onDelete }: { title: string; entries: StoragePriceHistoryEntry[]; onDelete: (entry: StoragePriceHistoryEntry) => void }) {
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
              <span style={{ fontWeight: 600 }}>{formatMoneyKopecks(e.price_kop)} / {STORAGE_UNIT_LABELS[e.unit].toLowerCase()}</span>
              <span style={{ color: 'var(--c-text-subtle)' }}>беспл. {e.free_days} дн.</span>
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
