import { useEffect, useMemo, useState } from 'react'
import { finishDispatchPreparation } from '../../../../../api/dispatchApi'
import type { DispatchDetail, DispatchLine, DispatchPrepareLine } from '../../../../../api/dispatchApi'
import { getBalancesByZone } from '../../../../../api/balancesApi'
import type { BalanceZoneItem } from '../../../../../api/balancesApi'
import { Combobox } from '../../../../data/Combobox'
import type { ComboboxOption } from '../../../../data/Combobox'
import { NumberStep } from '../../shared/NumberStep'
import { Icon } from '../../../../primitives/Icon'
import { Badge } from '../../../../primitives/Badge'
import { PhaseBlock } from '../../../shared/process/PhaseBlock'
import { LineIdentityCell } from '../../shared/LineIdentityCell'
import { useToast } from '../../../../feedback/Toast'
import { balanceKey } from '../../../../../utils/balanceKey'
import { fmtDateLong } from '../../../../../utils/format'

type Row = { zoneId: string; qty: number }
type ZoneSource = { id: string; name: string; available: number }

type Props = {
  doc:    DispatchDetail
  canEdit: boolean
  onDone: () => Promise<void> | void
}

export function PreparePanel({ doc, canEdit, onDone }: Props) {
  const toast = useToast()
  const isDefect = doc.cargo_type === 'defect'
  // Источник зависит от груза: годный кладовщик берёт из «Готов к отгрузке» (ready),
  // брак — «На хранении» (storage). Оба переезжают в «Зону отгрузки».
  const srcOp = isDefect ? 'storage' : 'ready'
  const srcQuality = isDefect ? 'defect' : 'good'

  const lines = doc.lines
  const [zoneBalances, setZoneBalances] = useState<BalanceZoneItem[]>([])
  const [loadingZones, setLoadingZones] = useState(true)
  const [allocs, setAllocs] = useState<Record<string, Row[]>>(() => {
    const next: Record<string, Row[]> = {}
    for (const l of lines) next[l.id] = [{ zoneId: '', qty: l.qty }]
    return next
  })
  const [saving, setSaving] = useState(false)
  const [showReasons, setShowReasons] = useState(false)

  useEffect(() => {
    const ctrl = new AbortController()
    setLoadingZones(true)
    getBalancesByZone({ client_id: doc.client_id || undefined, only_positive: true }, ctrl.signal)
      .then((res) => {
        if (ctrl.signal.aborted) return
        setZoneBalances(res.items.filter(
          (z) => z.op_status === srcOp && z.quality === srcQuality && z.qty > 0 && z.location_id,
        ))
      })
      .catch(() => {})
      .finally(() => { if (!ctrl.signal.aborted) setLoadingZones(false) })
    return () => ctrl.abort()
  }, [doc.client_id, srcOp, srcQuality])

  const sourcesByLine = useMemo(() => {
    const map = new Map<string, ZoneSource[]>()
    for (const line of lines) {
      const key = balanceKey(line)
      map.set(line.id, zoneBalances
        .filter((z) => balanceKey(z) === key)
        .map((z) => ({ id: z.location_id!, name: z.location_name ?? z.location_id!, available: z.qty })))
    }
    return map
  }, [lines, zoneBalances])

  function setRow(lineId: string, i: number, patch: Partial<Row>) {
    setAllocs((prev) => ({ ...prev, [lineId]: prev[lineId].map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }))
  }
  function addRow(lineId: string) {
    setAllocs((prev) => ({ ...prev, [lineId]: [...prev[lineId], { zoneId: '', qty: 0 }] }))
  }
  function removeRow(lineId: string, i: number) {
    setAllocs((prev) => prev[lineId].length <= 1
      ? prev
      : { ...prev, [lineId]: prev[lineId].filter((_, idx) => idx !== i) })
  }

  function sumRows(rows: Row[]): number {
    return rows.reduce((s, r) => s + (r.qty > 0 ? r.qty : 0), 0)
  }
  function rowOverflow(lineId: string, row: Row): boolean {
    if (!row.zoneId || row.qty <= 0) return false
    const src = (sourcesByLine.get(lineId) ?? []).find((s) => s.id === row.zoneId)
    return !!src && row.qty > src.available
  }

  function collectReasons(): string[] {
    const reasons: string[] = []
    if (lines.length === 0) reasons.push('Нет позиций для подготовки')
    for (const line of lines) {
      const rows = allocs[line.id] ?? []
      if (rows.some((r) => r.qty > 0 && !r.zoneId)) reasons.push(`Выберите ячейку-источник для «${line.product_name}»`)
      const seen = new Set<string>()
      for (const r of rows) {
        if (!r.zoneId) continue
        if (seen.has(r.zoneId)) { reasons.push(`Ячейка указана дважды для «${line.product_name}»`); break }
        seen.add(r.zoneId)
      }
      if (sumRows(rows) !== line.qty) reasons.push(`Укажите, из каких ячеек берётся весь товар для «${line.product_name}» (нужно ${line.qty} шт.)`)
      if (rows.some((r) => rowOverflow(line.id, r))) reasons.push(`В выбранной ячейке не хватает товара для «${line.product_name}»`)
    }
    return reasons
  }

  const blockReasons = collectReasons()

  function handlePrimary() {
    if (blockReasons.length > 0) { setShowReasons(true); return }
    setShowReasons(false)
    void submit()
  }

  async function submit() {
    const err = collectReasons()[0]
    if (err) { toast(err, 'error'); return }
    const payload: DispatchPrepareLine[] = lines.map((line) => ({
      line_id: line.id,
      sources: (allocs[line.id] ?? [])
        .filter((r) => r.zoneId && r.qty > 0)
        .map((r) => ({
          zone_id: r.zoneId,
          zone_name: (sourcesByLine.get(line.id) ?? []).find((s) => s.id === r.zoneId)?.name ?? null,
          qty: r.qty,
        })),
    }))
    setSaving(true)
    try {
      await finishDispatchPreparation(doc.id, payload)
      await onDone()
      toast('Отгрузка подготовлена — товар в «Готов к отгрузке», ожидает рейс', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка подготовки', 'error')
    } finally {
      setSaving(false)
    }
  }

  const noun = isDefect ? 'брак' : 'товар'

  return (
    <div style={{ maxWidth: 760 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 28,
          padding: '12px 16px',
          marginBottom: 14,
          background: 'var(--c-bg-sunken)',
          border: '1px solid var(--c-border)',
          borderRadius: 'var(--r-lg)',
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: 'var(--c-text-subtle)', marginBottom: 2 }}>Клиент</div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{doc.client_name ?? '—'}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--c-text-subtle)', marginBottom: 2 }}>Дата отгрузки</div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{fmtDateLong(doc.ship_date)}</div>
        </div>
        {isDefect && <Badge tone="warning">Брак</Badge>}
      </div>

      <PhaseBlock
        icon="archive"
        title="Подготовка к отгрузке"
        role="warehouse"
        state="active"
        hint={`Укажите, из каких ячеек берётся ${noun} по каждой строке — после «Отгрузка подготовлена» он перейдёт в «Готов к отгрузке» (зону отгрузки)`}
        right={canEdit ? (
          <button className="btn sm primary" disabled={saving} onClick={handlePrimary}>
            <Icon name="check" size={12} />Отгрузка подготовлена
          </button>
        ) : undefined}
      >
        {lines.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>
            Нет позиций для подготовки.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {showReasons && blockReasons.length > 0 && (
              <div className="block-reasons" style={{ textAlign: 'left' }}>
                {blockReasons.map((r, i) => (<div key={i}>· {r}</div>))}
              </div>
            )}
            {!canEdit && (
              <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)' }}>
                Кладовщик указывает ячейки-источники, затем жмёт «Отгрузка подготовлена».
              </div>
            )}
            {lines.map((line: DispatchLine) => {
            const rows = allocs[line.id] ?? []
            const sources = sourcesByLine.get(line.id) ?? []
            const options: ComboboxOption[] = sources.map((s) => ({ value: s.id, label: `${s.name} · ${s.available} шт` }))
            const left = line.qty - sumRows(rows)
            return (
              <div
                key={line.id}
                style={{ border: '1px solid var(--c-border)', borderRadius: 'var(--r-lg)', padding: 12, background: 'var(--c-bg-elev)' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <LineIdentityCell name={line.product_name} sku={line.product_sku} color={line.color_name} size={line.size_name} />
                  <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--c-text-subtle)' }}>
                    план <b className="num" style={{ color: 'var(--c-text)' }}>{line.qty}</b>
                  </span>
                  <span style={{ fontSize: 12.5, color: left === 0 ? 'var(--c-success)' : 'var(--c-warning)' }}>
                    {left === 0 ? 'набрано' : `осталось ${left}`}
                  </span>
                </div>
                {!loadingZones && sources.length === 0 && (
                  <div style={{ fontSize: 12.5, color: 'var(--c-danger)', marginBottom: 8 }}>
                    {isDefect ? 'Брак' : 'Товар'} этой позиции не найден в ячейках — проверьте остатки.
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {rows.map((row, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Combobox
                          value={row.zoneId || null}
                          placeholder="Из какой ячейки"
                          options={options}
                          onChange={(v) => setRow(line.id, i, { zoneId: String(v ?? '') })}
                          disabled={!canEdit || saving}
                          clearable
                        />
                      </div>
                      <NumberStep
                        value={row.qty}
                        min={0}
                        onChange={(v) => setRow(line.id, i, { qty: Math.max(0, v) })}
                        disabled={!canEdit || saving}
                        warning={rowOverflow(line.id, row)}
                        width={96}
                        height={34}
                      />
                      <button
                        className="btn ghost icon sm"
                        style={{ marginTop: 4 }}
                        disabled={!canEdit || saving || rows.length <= 1}
                        title="Убрать строку"
                        onClick={() => removeRow(line.id, i)}
                      >
                        <Icon name="x" size={13} />
                      </button>
                    </div>
                  ))}
                </div>
                <button className="btn ghost sm" style={{ marginTop: 8 }} disabled={!canEdit || saving} onClick={() => addRow(line.id)}>
                  <Icon name="plus" size={12} />Добавить ячейку
                </button>
              </div>
            )
          })}
          </div>
        )}
      </PhaseBlock>
    </div>
  )
}
