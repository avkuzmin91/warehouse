import { useState } from 'react'
import { correctReceivedQty } from '../../../../../api/receiptsApi'
import type { ReceiptLine } from '../../../../../api/receiptsApi'
import { Drawer } from '../../../../feedback/Drawer'
import { Alert } from '../../../../primitives/Alert'
import { Field, Input } from '../../../../primitives/Input'
import { Icon } from '../../../../primitives/Icon'
import { NumberStep } from '../../shared/NumberStep'
import { LineIdentityCell } from '../../shared/LineIdentityCell'

type Props = {
  docId: string
  lines: ReceiptLine[]
  open: boolean
  onClose: () => void
  onSaved: () => Promise<void>
}

/** Корректировка обсчёта приёмки: новое принятое по строкам + одна причина.
 *  Применяет правку построчно (один вызов на изменённую строку). Потолок —
 *  привезённое рейсами; нижний предел и реверс downstream проверяет backend. */
export function CorrectReceivedDrawer({ docId, lines, open, onClose, onSaved }: Props) {
  const [values, setValues] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const valueOf = (l: ReceiptLine) => values[l.id] ?? (l.accepted_qty ?? 0)
  const changed = lines.filter((l) => valueOf(l) !== (l.accepted_qty ?? 0))
  const canSave = changed.length > 0 && reason.trim().length > 0 && !saving

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    setError('')
    try {
      for (const l of changed) {
        await correctReceivedQty(docId, l.id, { accepted_qty: valueOf(l), reason: reason.trim() })
      }
      setValues({})
      setReason('')
      await onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Исправить приёмку"
      subtitle="Корректировка обсчёта приёмщика"
      width={520}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
            Меняет принятое и остатки, пишет в журнал
          </span>
          <button className="btn primary" onClick={handleSave} disabled={!canSave}>
            <Icon name="check" size={14} />Применить{changed.length > 0 ? ` (${changed.length})` : ''}
          </button>
        </div>
      }
    >
      {error && <Alert tone="danger" icon={false} style={{ marginBottom: 12 }}>{error}</Alert>}
      <Alert tone="info" style={{ marginBottom: 14 }}>
        Принятое можно указать не больше, чем привезли рейсами, и не меньше, чем сейчас лежит на складе:
        то, что уже отгрузили или переместили, из приёмки убрать нельзя.
      </Alert>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {lines.map((l) => {
          const accepted = l.accepted_qty ?? 0
          const v = valueOf(l)
          const dirty = v !== accepted
          return (
            <div
              key={l.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                border: `1px solid ${dirty ? 'var(--c-accent)' : 'var(--c-border)'}`, borderRadius: 'var(--r-md)',
                background: dirty ? 'var(--c-bg-sunken)' : 'var(--c-bg-elev)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <LineIdentityCell name={l.product_name} sku={l.product_sku} color={l.color_name} size={l.size_name} />
                <div className="t-sub" style={{ fontSize: 11.5, marginTop: 2 }}>
                  Сейчас принято {accepted} · привезено {l.arrived_qty} · место {l.storage_zone_name || '—'}
                </div>
              </div>
              <NumberStep
                value={v}
                onChange={(n) => setValues((p) => ({ ...p, [l.id]: Math.max(0, Math.min(l.arrived_qty, n)) }))}
                min={0}
                disabled={saving}
                tone={dirty ? 'accent' : 'normal'}
                width={100}
              />
            </div>
          )
        })}
      </div>

      <Field label="Причина корректировки" required style={{ marginTop: 14, marginBottom: 0 }}>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Напр.: пересчёт, ошибка приёмщика"
          disabled={saving}
        />
      </Field>
    </Drawer>
  )
}
