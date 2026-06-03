import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createTrip, handoffTrip } from '../../../api/tripsApi'
import type { TripReceiptItem } from '../../../api/tripsApi'
import { getReceipts } from '../../../api/receiptsApi'
import type { ReceiptListItem } from '../../../api/receiptsApi'
import { Icon } from '../../primitives/Icon'
import { Alert } from '../../primitives/Alert'
import { useLookups } from '../../../hooks/useLookups'
import { PlanningForm } from './tripDetail/PlanningForm'
import type { PlanningFormValue } from './tripDetail/PlanningForm'
import { ProcessPanel, ReadyChecklist } from './tripDetail/panels'
import type { Check } from './tripDetail/panels'
import { ReceiptsBlock } from './tripDetail/ReceiptsBlock'
import type { ReceiptLink, ReceiptEnrich } from './tripDetail/ReceiptsBlock'

const EMPTY_FORM: PlanningFormValue = {
  origin_id: '', carrier_id: '', vehicle_type_id: '',
  transport_ordered_at: '', eta: '', cost_estimate: '', comment: '',
}

function fmtDay(d: string | null): string | undefined {
  if (!d) return undefined
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return d
  return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
}

export function TripCreateFeature() {
  const navigate = useNavigate()
  const { warehouses, carriers, vehicleTypes } = useLookups()

  const [form, setForm] = useState<PlanningFormValue>(EMPTY_FORM)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [available, setAvailable] = useState<ReceiptListItem[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const ctrl = new AbortController()
    getReceipts({ status: 'planned', limit: 100, unlinked_to_trip: true }, ctrl.signal)
      .then((res) => { if (!ctrl.signal.aborted) setAvailable(res.items) })
      .catch(() => {})
    return () => ctrl.abort()
  }, [])

  const onField = (patch: Partial<PlanningFormValue>) => setForm((f) => ({ ...f, ...patch }))

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const checks: Check[] = [
    { ok: !!form.origin_id, label: 'Откуда указано' },
    { ok: !!form.carrier_id, label: 'Перевозчик указан' },
    { ok: !!form.vehicle_type_id, label: 'Тип кузова указан' },
    { ok: form.cost_estimate.trim() !== '', label: 'Стоимость (план) указана' },
    { ok: selected.size > 0, label: `Поступлений выбрано: ${selected.size}` },
  ]

  // Выбранные кандидаты показываем теми же карточками, что и привязанные в карточке рейса.
  const selectedReceipts: TripReceiptItem[] = available
    .filter((r) => selected.has(r.id))
    .map((r) => ({
      line_id: r.id, receipt_doc_id: r.id, receipt_number: r.doc_number,
      receipt_status: 'planned', client_id: r.client_id, client_name: r.client_name,
    }))

  const enrich: ReceiptEnrich = {}
  for (const r of available) enrich[r.id] = { sku: r.sku_count, qty: r.total_planned, eta: fmtDay(r.arrival_date) }

  const link: ReceiptLink = {
    options: available.filter((r) => !selected.has(r.id)),
    tripNumber: '— новый —',
    tripOrigin: warehouses.find((w) => w.id === form.origin_id)?.name ?? null,
    // В создании рейса привязка = локальный выбор, без API (рейс ещё не существует).
    onLink: async (ids) => setSelected((prev) => { const next = new Set(prev); ids.forEach((id) => next.add(id)); return next }),
    onUnlink: (id) => toggle(id),
    busy: false,
  }

  function tripPayload() {
    const origin = warehouses.find((w) => w.id === form.origin_id)
    const carrier = carriers.find((c) => c.id === form.carrier_id)
    const vehicle = vehicleTypes.find((v) => v.id === form.vehicle_type_id)
    return {
      origin_id: form.origin_id || null,
      origin_name: origin?.name ?? null,
      carrier_id: form.carrier_id || null,
      carrier_name: carrier?.name ?? null,
      vehicle_type_id: form.vehicle_type_id || null,
      vehicle_type_name: vehicle?.name ?? null,
      transport_ordered_at: form.transport_ordered_at || null,
      eta: form.eta || null,
      cost_estimate: form.cost_estimate.trim() ? Number(form.cost_estimate) : null,
      comment: form.comment.trim() || null,
      receipt_doc_ids: [...selected],
    }
  }

  async function saveTrip({ handoff }: { handoff: boolean }) {
    setSaving(true)
    setError('')
    try {
      const res = await createTrip(tripPayload())
      if (handoff) await handoffTrip(res.message)
      navigate(`/logistics/trips/${res.message}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка')
      setSaving(false)
    }
  }

  const handleSaveDraft = () => saveTrip({ handoff: false })
  const handleHandoff = () => saveTrip({ handoff: true })

  return (
    <div className="page">
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
        paddingBottom: 16, marginBottom: 18, borderBottom: '1px solid var(--c-border)',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <button className="btn ghost icon sm" onClick={() => navigate('/logistics/trips')}><Icon name="arrowLeft" size={14} /></button>
            <span style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>Новый рейс поступления</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>Новый рейс</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <button className="btn lg" onClick={handleSaveDraft} disabled={saving}>
            <Icon name="save" size={15} />Сохранить черновик
          </button>
          <button className="btn lg primary" onClick={handleHandoff} disabled={saving || selected.size === 0}>
            <Icon name="arrowRight" size={15} />Передать на склад
          </button>
        </div>
      </div>

      {error && <Alert tone="danger" icon={false} style={{ marginBottom: 16 }}>{error}</Alert>}

      <div className="split-360">
        <div className="col gap-16">
          <PlanningForm value={form} onChange={onField} state="active" />
          <ReceiptsBlock receipts={selectedReceipts} enrich={enrich} link={link} />
        </div>

        <div className="col gap-16">
          <ProcessPanel status="draft" ops={[]} />
          <ReadyChecklist checks={checks} />
        </div>
      </div>
    </div>
  )
}
