import { useMemo, useState } from 'react'
import { getProductivityEntries, movePackingDate } from '../../../api/shipmentsApi'
import type { PackingProductivityRow } from '../../../api/shipmentsApi'
import { Drawer } from '../../feedback/Drawer'
import { useConfirm } from '../../feedback/ConfirmDialog'
import { useToast } from '../../feedback/Toast'
import { useApi } from '../../../hooks/useApi'
import { Icon } from '../../primitives/Icon'
import { fmtDateTime, fmtYmdAsDmy } from '../../../utils/format'

interface Props {
  /** День (YYYY-MM-DD), под которым строка показана в отчёте. */
  packedDate: string
  row: PackingProductivityRow
  onClose: () => void
  onMoved: () => void
}

/** Админ-перенос бизнес-даты упаковки: выбирает конкретные записи «Записать»
 *  строки отчёта (день × клиент × SKU) и переносит их на другой день. */
export function MovePackDateDrawer({ packedDate, row, onClose, onMoved }: Props) {
  const confirm = useConfirm()
  const toast = useToast()
  const [newDate, setNewDate] = useState(packedDate)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)

  const { data, loading } = useApi(
    (signal) => getProductivityEntries(
      { packed_date: packedDate, product_id: row.product_id, client_id: row.client_id ?? undefined },
      signal,
    ),
    [packedDate, row.product_id, row.client_id],
  )

  const entries = data?.entries ?? []

  // По умолчанию выбраны все неотменённые записи (после первой загрузки).
  const effectiveSelected = useMemo(() => {
    if (touched) return selected
    return new Set(entries.filter((e) => !e.reversed).map((e) => e.id))
  }, [touched, selected, entries])

  const toggle = (id: string) => {
    setTouched(true)
    setSelected((prev) => {
      const next = new Set(touched ? prev : effectiveSelected)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(newDate)
  const sameDate = newDate === packedDate
  const canSave = dateValid && !sameDate && effectiveSelected.size > 0 && !saving

  const handleSave = async () => {
    if (!canSave) return
    const ids = [...effectiveSelected]
    const ok = await confirm({
      title: 'Перенести дату упаковки?',
      body: `Записей: ${ids.length}. Дата ${fmtYmdAsDmy(packedDate)} → ${fmtYmdAsDmy(newDate)}. `
        + 'Заработок пересчитается по тарифу на новую дату.',
      confirmLabel: 'Перенести',
    })
    if (!ok) return
    setSaving(true)
    try {
      await movePackingDate({ entry_ids: ids, new_date: newDate })
      toast('Дата упаковки перенесена', 'success')
      onMoved()
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось перенести дату', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Перенести дату упаковки"
      subtitle={`${row.product_sku ?? row.product_name ?? '—'} · ${row.client_name ?? 'без клиента'}`}
      width={520}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={saving}>Отмена</button>
          <button className="btn primary" onClick={handleSave} disabled={!canSave}>
            {saving ? 'Перенос…' : 'Перенести'}
          </button>
        </>
      }
    >
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: 'var(--c-text-subtle)', display: 'block', marginBottom: 6 }}>
          Новая дата упаковки
        </label>
        <input
          className="input sm"
          type="date"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
          style={{ width: 180 }}
        />
        {sameDate && (
          <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginTop: 6 }}>
            Выберите дату, отличную от текущей ({fmtYmdAsDmy(packedDate)}).
          </div>
        )}
      </div>

      <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginBottom: 8 }}>
        Записи упаковки за {fmtYmdAsDmy(packedDate)}
      </div>

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--c-text-subtle)' }}>Загрузка…</div>
      ) : entries.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--c-text-subtle)' }}>
          Записей упаковки не найдено
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {entries.map((e) => {
            const checked = effectiveSelected.has(e.id)
            return (
              <label
                key={e.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', borderRadius: 8,
                  border: `1px solid ${checked ? 'var(--c-accent)' : 'var(--c-border)'}`,
                  background: checked ? 'var(--c-bg-sunken)' : 'transparent',
                  cursor: 'pointer', opacity: e.reversed ? 0.6 : 1,
                }}
              >
                <input type="checkbox" checked={checked} onChange={() => toggle(e.id)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <span style={{ color: 'var(--c-success)', fontWeight: 600 }}>
                      годный {e.good.toLocaleString('ru-RU')}
                    </span>
                    {e.defect > 0 && (
                      <span style={{ color: 'var(--c-warning)', fontWeight: 600 }}>
                        брак {e.defect.toLocaleString('ru-RU')}
                      </span>
                    )}
                    {e.reversed && (
                      <span style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>отменена</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {e.doc_number && (
                      <span className="mono"><Icon name="file" size={11} /> {e.doc_number}</span>
                    )}
                    <span>{fmtDateTime(e.created_at)}</span>
                    {e.created_by_email && <span>{e.created_by_email}</span>}
                  </div>
                </div>
              </label>
            )
          })}
        </div>
      )}
    </Drawer>
  )
}
