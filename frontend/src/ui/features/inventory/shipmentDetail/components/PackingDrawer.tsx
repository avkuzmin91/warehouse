import { useState } from 'react'
import { getLinePacking, recordPacking, reversePackingEntry } from '../../../../../api/shipmentsApi'
import type { ShipmentLine } from '../../../../../api/shipmentsApi'
import { useApi } from '../../../../../hooks/useApi'
import { fmtYmdAsDmy, localTodayYmd } from '../../../../../utils/format'
import { Drawer } from '../../../../feedback/Drawer'
import { useToast } from '../../../../feedback/Toast'
import { useConfirm } from '../../../../feedback/ConfirmDialog'
import { DatePicker } from '../../../../primitives/DatePicker'
import { Icon } from '../../../../primitives/Icon'
import { NumberStep } from '../../../inventory/shared/NumberStep'

type Props = {
  docId: string
  line: ShipmentLine
  onClose: () => void
  onDone: () => Promise<void> | void
}

export function PackingDrawer({ docId, line, onClose, onDone }: Props) {
  const toast = useToast()
  const confirm = useConfirm()
  const [reloadKey, setReloadKey] = useState(0)
  const { data, loading } = useApi((signal) => getLinePacking(docId, line.id, signal), [docId, line.id, reloadKey])

  const [date, setDate] = useState(localTodayYmd())
  const [good, setGood] = useState(0)
  const [defect, setDefect] = useState(0)
  const [saving, setSaving] = useState(false)

  const plan = data?.plan ?? line.qty
  const pool = data?.available_for_pack ?? line.available_for_pack
  const packedGood = data?.packed_good ?? line.packed_good
  const packedDefect = data?.packed_defect ?? line.packed_defect
  const entries = data?.entries ?? []

  const add = good + defect
  const overPool = add > pool
  const overPlan = packedGood + good > plan

  const [showReasons, setShowReasons] = useState(false)
  const blockReasons: string[] = [
    ...(!date ? ['Укажите дату упаковки'] : []),
    ...(add <= 0 ? ['Укажите количество годного или брака'] : []),
    ...(overPlan ? [`Годного с учётом записи больше плана (${plan} шт.)`] : []),
    ...(overPool ? [`На упаковке доступно ${pool} шт — уменьшите количество`] : []),
  ]

  function handlePrimary() {
    if (blockReasons.length > 0) { setShowReasons(true); return }
    setShowReasons(false)
    void submit()
  }

  async function refresh() {
    setReloadKey((k) => k + 1)
    await onDone()
  }

  async function submit() {
    const err = blockReasons[0]
    if (err) { toast(err, 'error'); return }
    setSaving(true)
    try {
      await recordPacking(docId, line.id, { good_delta: good, defect_delta: defect, packed_date: date })
      setGood(0)
      setDefect(0)
      await onDone()
      toast('Упаковка внесена', 'success')
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка записи упаковки', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function reverse(entryId: string) {
    const ok = await confirm({
      title: 'Отменить запись упаковки?',
      body: 'Запись будет отменена компенсирующим движением. После этого можно внести верную.',
      danger: true,
      confirmLabel: 'Отменить запись',
    })
    if (!ok) return
    setSaving(true)
    try {
      await reversePackingEntry(docId, line.id, entryId)
      await refresh()
      toast('Запись отменена', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка отмены', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Внести упаковку"
      subtitle={`${line.product_name} · ${line.product_sku}`}
      width={480}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
          <button className="btn ghost" onClick={onClose} disabled={saving}>Закрыть</button>
          <button className="btn primary" onClick={handlePrimary} disabled={saving}>
            <Icon name="check" size={14} />Записать
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: 12.5 }}>
        <span style={{ color: 'var(--c-text-subtle)' }}>
          План <b className="num" style={{ color: 'var(--c-text)' }}>{plan}</b>
        </span>
        <span style={{ color: 'var(--c-text-subtle)' }}>
          На упаковке <b className="num" style={{ color: pool > 0 ? 'var(--c-text)' : 'var(--c-text-faint)' }}>{pool}</b>
        </span>
        <span style={{ color: 'var(--c-text-subtle)', marginLeft: 'auto' }}>
          Упаковано{' '}
          <b className="num" style={{ color: 'var(--c-success)' }}>{packedGood}</b>
          <span style={{ color: 'var(--c-text-faint)' }}> / </span>
          <b className="num" style={{ color: packedDefect > 0 ? 'var(--c-danger)' : 'var(--c-text-faint)' }}>{packedDefect}</b>
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 12, borderRadius: 'var(--r-lg)', background: 'var(--c-bg-sunken)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 64, fontSize: 12.5, color: 'var(--c-text-subtle)' }}>Дата</span>
          <div style={{ flex: 1 }}>
            <DatePicker value={date} onChange={setDate} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 64, fontSize: 12.5, color: 'var(--c-success)' }}>Годный</span>
          <NumberStep value={good} min={0} onChange={(v) => setGood(Math.max(0, v))} disabled={saving} tone={overPlan ? 'warning' : 'normal'} width={120} height={30} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 64, fontSize: 12.5, color: 'var(--c-danger)' }}>Брак</span>
          <NumberStep value={defect} min={0} onChange={(v) => setDefect(Math.max(0, v))} disabled={saving} width={120} height={30} />
        </div>
        {showReasons && blockReasons.length > 0 ? (
          <div className="block-reasons" style={{ textAlign: 'left' }}>
            {blockReasons.map((r, i) => (
              <div key={i}>· {r}</div>
            ))}
          </div>
        ) : (overPool || overPlan) && (
          <div style={{ fontSize: 11.5, color: 'var(--c-warning)' }}>
            {overPlan ? `Годного с учётом записи больше плана (${plan} шт.)` : `На упаковке доступно ${pool} шт`}
          </div>
        )}
      </div>

      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text-subtle)', marginBottom: 8 }}>История упаковки</div>
        {loading ? (
          <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 12.5 }}>Загрузка…</div>
        ) : entries.length === 0 ? (
          <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 12.5 }}>
            Записей пока нет
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {entries.map((e) => (
              <div
                key={e.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 'var(--r-md)',
                  border: '1px solid var(--c-border)',
                  background: 'var(--c-bg-elev)',
                  opacity: e.reversed ? 0.55 : 1,
                }}
              >
                <span className="num" style={{ fontSize: 12.5, color: 'var(--c-text)', textDecoration: e.reversed ? 'line-through' : 'none' }}>
                  {fmtYmdAsDmy(e.packed_date)}
                </span>
                <span style={{ fontSize: 12.5, textDecoration: e.reversed ? 'line-through' : 'none' }}>
                  {e.good > 0 && <span style={{ color: 'var(--c-success)' }}>+{e.good} годн</span>}
                  {e.good > 0 && e.defect > 0 && <span style={{ color: 'var(--c-text-faint)' }}> · </span>}
                  {e.defect > 0 && <span style={{ color: 'var(--c-danger)' }}>+{e.defect} брак</span>}
                </span>
                {e.created_by_email && (
                  <span className="t-sub" style={{ fontSize: 11.5, color: 'var(--c-text-faint)' }}>{e.created_by_email}</span>
                )}
                <div style={{ marginLeft: 'auto' }}>
                  {e.reversed ? (
                    <span style={{ fontSize: 11.5, color: 'var(--c-text-faint)' }}>Отменено</span>
                  ) : (
                    <button className="btn ghost sm" disabled={saving} title="Отменить запись" onClick={() => reverse(e.id)}>
                      <Icon name="refresh" size={12} />Отменить
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Drawer>
  )
}
