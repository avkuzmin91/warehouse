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
import { Panel } from '../../../shared/process/processUI'
import { RoleChip } from '../../../shared/process/RoleChip'
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
  // Набрано = только то количество, под которое выбрана ячейка-источник.
  function pickedRows(rows: Row[]): number {
    return rows.reduce((s, r) => s + (r.zoneId && r.qty > 0 ? r.qty : 0), 0)
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

  const planTotal = lines.reduce((s, l) => s + l.qty, 0)
  const pickedTotal = lines.reduce((s, l) => s + pickedRows(allocs[l.id] ?? []), 0)
  const remainingTotal = Math.max(0, planTotal - pickedTotal)
  const doneCount = lines.filter((l) => pickedRows(allocs[l.id] ?? []) >= l.qty).length
  const pctTotal = planTotal > 0 ? Math.min(100, Math.round((pickedTotal / planTotal) * 100)) : 0
  const ready = lines.length > 0 && blockReasons.length === 0

  return (
    <div style={{ maxWidth: 840 }}>
      {/* Активная задача — крупно */}
      <div
        style={{
          border: '1px solid var(--c-info)',
          borderRadius: 'var(--r-xl)',
          background: 'var(--c-bg-elev)',
          overflow: 'hidden',
          boxShadow: '0 0 0 3px color-mix(in oklab, var(--c-info) 8%, transparent)',
          marginBottom: 14,
        }}
      >
        <div style={{ padding: '20px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 14, background: 'var(--c-info-bg)', color: 'var(--c-info)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Icon name="forklift" size={26} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 17, fontWeight: 600 }}>Соберите {noun} по ячейкам</span>
                {isDefect && <Badge tone="warning">Брак</Badge>}
              </div>
              <div style={{ fontSize: 13, color: 'var(--c-text-muted)', marginTop: 3, lineHeight: 1.45 }}>
                {doc.client_name ?? '—'} · отгрузка {fmtDateLong(doc.ship_date)}. По каждой строке укажите,
                из каких ячеек берётся {noun}, пока не наберёте весь план.
              </div>
            </div>
            <RoleChip role="warehouse" />
          </div>

          {/* общий прогресс + кнопка передачи хода */}
          <div style={{
            marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--c-border)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap',
          }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                <span className="mono" style={{ fontSize: 23, fontWeight: 600, color: ready ? 'var(--c-success)' : 'var(--c-text)' }}>{pickedTotal}</span>
                <span style={{ fontSize: 13, color: 'var(--c-text-subtle)' }}>
                  из {planTotal} шт набрано · {doneCount} из {lines.length} строк готовы
                </span>
              </div>
              <div className="prog" style={{ height: 8 }}>
                <div className={`prog-fill ${ready ? 'ok' : ''}`} style={{ width: `${pctTotal}%` }} />
              </div>
            </div>
            {canEdit && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0 }}>
                <button
                  className="btn lg primary"
                  style={{ height: 48, fontSize: 15, padding: '0 22px' }}
                  disabled={saving}
                  onClick={handlePrimary}
                >
                  <Icon name="check" size={18} />Отгрузка подготовлена
                </button>
                <span style={{ fontSize: 11.5, color: ready ? 'var(--c-text-subtle)' : 'var(--c-warning)', textAlign: 'right' }}>
                  {ready
                    ? 'перейдёт в «Готов к отгрузке» — зону отгрузки'
                    : remainingTotal > 0 ? `ещё ${remainingTotal} шт не набрано` : 'проверьте набор по ячейкам'}
                </span>
              </div>
            )}
          </div>

          {showReasons && blockReasons.length > 0 && (
            <div className="block-reasons" style={{ textAlign: 'left', marginTop: 14 }}>
              {blockReasons.map((r, i) => (<div key={i}>· {r}</div>))}
            </div>
          )}
        </div>
        <div style={{
          padding: '10px 22px', background: 'var(--c-bg-sunken)', borderTop: '1px solid var(--c-border)',
          fontSize: 12, color: 'var(--c-text-muted)', display: 'flex', alignItems: 'center', gap: 7,
        }}>
          <Icon name="arrowRight" size={13} style={{ color: 'var(--c-text-subtle)', flexShrink: 0 }} />
          <span>{noun[0].toUpperCase() + noun.slice(1)} спишется с выбранных ячеек и переедет в зону отгрузки. Набор можно править до нажатия кнопки.</span>
        </div>
      </div>

      {/* Строки отгрузки */}
      <Panel
        icon="boxes"
        title="Строки отгрузки"
        right={<span style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{lines.length} строки · план <b className="mono" style={{ color: 'var(--c-text)' }}>{planTotal}</b> шт</span>}
        bodyPad={false}
      >
        {lines.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>
            Нет позиций для подготовки.
          </div>
        ) : (
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {lines.map((line: DispatchLine) => {
              const rows = allocs[line.id] ?? []
              const sources = sourcesByLine.get(line.id) ?? []
              const options: ComboboxOption[] = sources.map((s) => ({ value: s.id, label: `${s.name} · ${s.available} шт` }))
              const picked = pickedRows(rows)
              const left = Math.max(0, line.qty - picked)
              const done = picked >= line.qty
              const pct = line.qty > 0 ? Math.min(100, Math.round((picked / line.qty) * 100)) : 0
              return (
                <div
                  key={line.id}
                  style={{
                    border: '1px solid var(--c-border)',
                    borderLeft: `3px solid ${done ? 'var(--c-success)' : 'var(--c-info)'}`,
                    borderRadius: 'var(--r-lg)', background: 'var(--c-bg-elev)', padding: '13px 15px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <LineIdentityCell name={line.product_name} sku={line.product_sku} color={line.color_name} size={line.size_name} />
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>
                        <span style={{ color: done ? 'var(--c-success)' : 'var(--c-text)' }}>{picked}</span>
                        <span style={{ color: 'var(--c-text-faint)' }}> / {line.qty}</span>
                      </div>
                      <div style={{ fontSize: 11, color: done ? 'var(--c-success)' : 'var(--c-warning)', fontWeight: 500 }}>
                        {done ? 'набрано' : `осталось ${left}`}
                      </div>
                    </div>
                  </div>

                  <div className="prog" style={{ marginTop: 10 }}>
                    <div className={`prog-fill ${done ? 'ok' : ''}`} style={{ width: `${pct}%` }} />
                  </div>

                  {!loadingZones && sources.length === 0 && (
                    <div style={{ fontSize: 12.5, color: 'var(--c-danger)', marginTop: 10 }}>
                      {isDefect ? 'Брак' : 'Товар'} этой позиции не найден в ячейках — проверьте остатки.
                    </div>
                  )}

                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                          title="Убрать ячейку"
                          onClick={() => removeRow(line.id, i)}
                        >
                          <Icon name="x" size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button className="btn ghost sm" style={{ marginTop: 9 }} disabled={!canEdit || saving} onClick={() => addRow(line.id)}>
                    <Icon name="plus" size={12} />Добавить ячейку
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </Panel>

      {!canEdit && (
        <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)', marginTop: 12 }}>
          Кладовщик указывает ячейки-источники, затем жмёт «Отгрузка подготовлена».
        </div>
      )}
    </div>
  )
}
