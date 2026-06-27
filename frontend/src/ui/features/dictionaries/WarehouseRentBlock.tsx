import { useCallback, useEffect, useState } from 'react'
import {
  deleteWarehouseRentRate,
  getWarehouseRent,
  setWarehouseRent,
} from '../../../api/warehouseRentApi'
import type { RentRateHistoryEntry, WarehouseRentDetail } from '../../../api/warehouseRentApi'
import { Icon } from '../../primitives/Icon'
import { DatePicker } from '../../primitives/DatePicker'
import { useToast } from '../../feedback/Toast'
import { useConfirm } from '../../feedback/ConfirmDialog'
import { fmtDate, formatMoneyKopecks, moscowTodayYmd, parseRublesToKopecks } from '../../../utils/format'

interface Props {
  warehouseId: string
  onChanged: () => void
}

export function WarehouseRentBlock({ warehouseId, onChanged }: Props) {
  const toast = useToast()
  const confirm = useConfirm()
  const [detail, setDetail] = useState<WarehouseRentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [rent, setRent] = useState('')
  const [effFrom, setEffFrom] = useState(moscowTodayYmd())
  const [saving, setSaving] = useState(false)

  const reload = useCallback(() => {
    return getWarehouseRent(warehouseId)
      .then((d) => setDetail(d))
      .catch((e) => toast(e instanceof Error ? e.message : String(e), 'error'))
  }, [warehouseId, toast])

  useEffect(() => {
    let alive = true
    setLoading(true)
    getWarehouseRent(warehouseId)
      .then((d) => { if (alive) setDetail(d) })
      .catch((e) => { if (alive) toast(e instanceof Error ? e.message : String(e), 'error') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [warehouseId, toast])

  const deleteEntry = useCallback(async (entry: RentRateHistoryEntry) => {
    const ok = await confirm({
      title: 'Удалить ставку аренды?',
      body: `Запись «${formatMoneyKopecks(entry.rent_monthly_kopecks)} / мес с ${fmtDate(entry.effective_from)}» перестанет учитываться в начислениях аренды. Это действие нельзя отменить.`,
      danger: true,
      confirmLabel: 'Удалить',
    })
    if (!ok) return
    try {
      await deleteWarehouseRentRate(warehouseId, entry.id)
      toast('Ставка удалена', 'success')
      await reload()
      onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }, [confirm, warehouseId, reload, onChanged, toast])

  async function save() {
    const kop = rent.trim() ? parseRublesToKopecks(rent) : null
    if (kop === null) { toast('Укажите ставку аренды в рублях', 'error'); return }
    setSaving(true)
    try {
      await setWarehouseRent(warehouseId, { rent_monthly_kopecks: kop, effective_from: effFrom })
      toast('Ставка аренды сохранена', 'success')
      setRent('')
      await reload()
      onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="card" style={{ padding: '10px 12px', marginBottom: 6 }}>
        <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>Аренда сейчас</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: detail?.rent_monthly_kopecks != null ? 'var(--c-success)' : 'var(--c-text-faint)' }}>
          {loading ? '…' : detail?.rent_monthly_kopecks != null ? `${formatMoneyKopecks(detail.rent_monthly_kopecks)} / мес` : 'не задана'}
        </div>
      </div>

      <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)', margin: '14px 0 8px' }}>
        Новая ставка. Действует с указанной даты; если она в прошлом — применится и к более раннему. 1-го числа месяца по действующей ставке заводится расход «Аренда».
      </div>

      <label style={{ display: 'block', marginTop: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginBottom: 5 }}>Аренда, ₽ / мес</div>
        <input className="input sm num" inputMode="decimal" placeholder="напр. 120000"
          value={rent} onChange={(e) => setRent(e.target.value)} />
      </label>
      <label style={{ display: 'block', marginTop: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginBottom: 5 }}>Действует с</div>
        <DatePicker value={effFrom} onChange={setEffFrom} />
      </label>
      <button className="btn primary sm" style={{ marginTop: 12 }} onClick={save} disabled={saving || loading}>
        <Icon name="check" size={13} />{saving ? 'Сохранение…' : 'Добавить ставку'}
      </button>

      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text-muted)', marginBottom: 6 }}>История ставки аренды</div>
        {(detail?.history ?? []).length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--c-text-faint)' }}>Записей нет</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(detail?.history ?? []).map((e) => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
                <span className="mono" style={{ color: 'var(--c-text-subtle)', minWidth: 92 }}>с {fmtDate(e.effective_from)}</span>
                <span style={{ fontWeight: 600 }}>{formatMoneyKopecks(e.rent_monthly_kopecks)} / мес</span>
                <button
                  className="btn ghost icon sm"
                  style={{ marginLeft: 'auto', color: 'var(--c-danger)' }}
                  title="Удалить запись"
                  onClick={() => deleteEntry(e)}
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
