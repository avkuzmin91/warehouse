import { useEffect, useState } from 'react'
import { useNav } from '../../nav/NavContext'
import { createTrip, handoffTrip, tripLexicon, type TripCargoType, type TripDirection } from '../../api/tripsApi'
import { getCarriers, getVehicleTypes, getWarehouses, type DictionaryItem } from '../../api/lookupsApi'
import { AppBar } from '../../components/AppBar'
import { Icon } from '../../components/Icon'
import { fmtDate } from '../../utils/format'
import { TripDocPickerSheet, type TripPickDoc } from './TripDocPickerSheet'
import { TripPlanningFields, EMPTY_PLANNING, type PlanningValue } from './TripPlanningFields'

// Режим рейса = направление + тип груза (для отгрузки). Меняет лексику и пул документов.
type Mode = 'inbound' | 'out_good' | 'out_defect'

function modeToParams(mode: Mode): { direction: TripDirection; cargoType: TripCargoType } {
  if (mode === 'inbound') return { direction: 'inbound', cargoType: 'good' }
  return { direction: 'outbound', cargoType: mode === 'out_defect' ? 'defect' : 'good' }
}

export function TripFormScreen() {
  const { back, goTab } = useNav()
  const [mode, setMode] = useState<Mode>('inbound')
  const { direction, cargoType } = modeToParams(mode)
  const outbound = direction === 'outbound'
  const lex = tripLexicon(direction)

  const [warehouses, setWarehouses] = useState<DictionaryItem[]>([])
  const [carriers, setCarriers] = useState<DictionaryItem[]>([])
  const [vehicleTypes, setVehicleTypes] = useState<DictionaryItem[]>([])

  const [form, setForm] = useState<PlanningValue>(EMPTY_PLANNING)
  const [docs, setDocs] = useState<TripPickDoc[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const onField = (patch: Partial<PlanningValue>) => setForm((f) => ({ ...f, ...patch }))

  useEffect(() => {
    const ac = new AbortController()
    const active = (rows: DictionaryItem[]) => rows.filter((r) => r.is_active !== false && !r.is_deleted)
    Promise.all([getWarehouses(ac.signal), getCarriers(ac.signal), getVehicleTypes(ac.signal)])
      .then(([w, c, v]) => {
        if (ac.signal.aborted) return
        setWarehouses(active(w))
        setCarriers(active(c))
        setVehicleTypes(active(v))
      })
      .catch(() => { /* aborted */ })
    return () => ac.abort()
  }, [])

  function changeMode(next: Mode) {
    if (next === mode) return
    setMode(next)
    setDocs([])
  }

  const costNum = Number(form.costEstimate)
  const costFilled = form.costEstimate.trim() !== '' && Number.isFinite(costNum) && costNum >= 0
  const etaBeforeOrder = !!form.orderedAt && !!form.eta && form.eta < form.orderedAt

  const blockReasons: string[] = []
  if (!form.originId) blockReasons.push(`Не указано «${lex.routeLabel}»`)
  if (!form.carrierId) blockReasons.push('Не выбран перевозчик')
  if (!form.vehicleTypeId) blockReasons.push('Не выбран тип кузова')
  if (form.vehicleNumber.trim() === '') blockReasons.push('Не указан гос. номер')
  if (!costFilled) blockReasons.push('Не указана стоимость логистики (план)')
  if (!form.orderedAt) blockReasons.push('Не указано «Транспорт заказан»')
  if (!form.eta) blockReasons.push('Не указано плановое прибытие')
  if (etaBeforeOrder) blockReasons.push('Плановое прибытие раньше заказа транспорта')
  if (docs.length === 0) blockReasons.push(outbound ? 'Не выбрано ни одной отгрузки' : 'Не выбрано ни одного поступления')

  function addDocs(picked: TripPickDoc[]) {
    setDocs((prev) => [...prev, ...picked])
    setShowPicker(false)
  }
  function removeDoc(id: string) {
    setDocs((prev) => prev.filter((d) => d.id !== id))
  }

  function payload() {
    return {
      direction,
      ...(outbound ? { cargo_type: cargoType } : {}),
      origin_id: form.originId || null,
      origin_name: warehouses.find((w) => w.id === form.originId)?.name ?? null,
      carrier_id: form.carrierId || null,
      carrier_name: carriers.find((c) => c.id === form.carrierId)?.name ?? null,
      vehicle_type_id: form.vehicleTypeId || null,
      vehicle_type_name: vehicleTypes.find((v) => v.id === form.vehicleTypeId)?.name ?? null,
      vehicle_number: form.vehicleNumber.trim() || null,
      transport_ordered_at: form.orderedAt || null,
      eta: form.eta || null,
      cost_estimate: costFilled ? costNum : null,
      comment: form.comment.trim() || null,
      ...(outbound
        ? { dispatch_doc_ids: docs.map((d) => d.id) }
        : { receipt_doc_ids: docs.map((d) => d.id) }),
    }
  }

  async function save(handoff: boolean) {
    if (saving) return
    if (handoff && blockReasons.length > 0) { setError(blockReasons[0]); return }
    if (docs.length === 0) { setError(outbound ? 'Добавьте отгрузку' : 'Добавьте поступление'); return }
    setError('')
    setSaving(true)
    try {
      const res = await createTrip(payload())
      // Привязка целиком уже учтена doc_ids в createTrip — отдельный link* не нужен.
      if (handoff) await handoffTrip(res.message)
      goTab('mTrips')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить')
      setSaving(false)
    }
  }

  return (
    <div className="screen">
      <AppBar title="Новый рейс" sub="Номер присвоится при сохранении" onBack={back} noProfile />
      <div className="scroll pad-nav">
        <div className="seg" style={{ marginBottom: 14 }}>
          <button type="button" className={mode === 'inbound' ? 'active' : ''} onClick={() => changeMode('inbound')}>
            <span className="seg-ico"><Icon name="truckIn" size={15} />Приёмка</span>
          </button>
          <button type="button" className={mode === 'out_good' ? 'active' : ''} onClick={() => changeMode('out_good')}>
            <span className="seg-ico"><Icon name="truckOut" size={15} />Отгрузка</span>
          </button>
          <button type="button" className={mode === 'out_defect' ? 'active' : ''} onClick={() => changeMode('out_defect')}>
            <span className="seg-ico"><Icon name="alert" size={15} />Брак</span>
          </button>
        </div>

        <TripPlanningFields
          value={form}
          onChange={onField}
          warehouses={warehouses}
          carriers={carriers}
          vehicleTypes={vehicleTypes}
          routeLabel={lex.routeLabel}
          etaLabel={lex.etaLabel}
          etaInvalid={etaBeforeOrder}
        />

        <div className="sec" style={{ marginTop: 4 }}>
          {lex.docsTitle}
          <span className="sec-count">{docs.length}</span>
        </div>

        {docs.length === 0 ? (
          <div className="line-sub" style={{ padding: '8px 0 12px' }}>
            {outbound ? 'Добавьте отгрузки, которые увезёт рейс.' : 'Добавьте поступления, которые привезёт рейс.'}
          </div>
        ) : (
          docs.map((d) => (
            <div key={d.id} className="formline">
              <div className="line-row" style={{ marginTop: 0, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="tile-title" style={{ fontSize: 14 }}>
                    {d.doc_number}
                    {d.client_name ? ` · ${d.client_name}` : ''}
                  </div>
                  <div className="tile-meta">
                    {d.sku} SKU · {d.qty} шт{d.date ? ` · ${fmtDate(d.date, '')}` : ''}
                  </div>
                </div>
                <button className="icon-btn danger" onClick={() => removeDoc(d.id)} aria-label="Убрать">
                  <Icon name="trash" size={15} />
                </button>
              </div>
            </div>
          ))
        )}

        <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setShowPicker(true)}>
          <Icon name="plus" size={15} /> {outbound ? 'Добавить отгрузки' : 'Добавить поступления'}
        </button>

        {error && (
          <div className="alert" style={{ marginTop: 12 }}>
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}

        <div className="line-row" style={{ marginTop: 14 }}>
          <button className="btn ghost" style={{ flex: 1 }} disabled={saving} onClick={() => void save(false)}>
            Черновик
          </button>
          <button className="btn" style={{ flex: 2 }} disabled={saving || blockReasons.length > 0} onClick={() => void save(true)}>
            {saving ? '…' : 'Передать на склад'}
          </button>
        </div>
      </div>

      {showPicker && (
        <TripDocPickerSheet
          direction={direction}
          cargoType={cargoType}
          tripId="new"
          excludeIds={docs.map((d) => d.id)}
          onConfirm={addDocs}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}
