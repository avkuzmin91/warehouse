import { useMemo, useState } from 'react'
import { finishShipmentRelocation } from '../../../../../api/shipmentsApi'
import type { ShipmentLine, ShipmentRelocateLine } from '../../../../../api/shipmentsApi'
import type { DictionaryItem } from '../../../../../api/domainTypes'
import { Combobox } from '../../../../data/Combobox'
import type { ComboboxOption } from '../../../../data/Combobox'
import { NumberStep } from '../../../inventory/shared/NumberStep'
import { Icon } from '../../../../primitives/Icon'
import { PhaseBlock } from '../../../shared/process/PhaseBlock'
import { LineIdentityCell } from '../../../inventory/shared/LineIdentityCell'
import { useToast } from '../../../../feedback/Toast'

type Row = { zoneId: string; qty: number }
// touched* — строку правили руками: мастер-раскладка её больше не перезаписывает.
type LineAlloc = { good: Row[]; defect: Row[]; touchedGood: boolean; touchedDefect: boolean }
type Kind = 'good' | 'defect'

type Props = {
  docId:       string
  lines:       ShipmentLine[]
  zoneOptions: DictionaryItem[]
  canEdit:     boolean
  // На статусах после перемещения раскладка остаётся видимой только для просмотра.
  readOnly?:   boolean
  onDone:      () => Promise<void> | void
}

function initRows(qty: number): Row[] {
  return qty > 0 ? [{ zoneId: '', qty }] : []
}

export function RelocationPanel({ docId, lines, zoneOptions, canEdit, readOnly = false, onDone }: Props) {
  if (readOnly) return <RelocationView lines={lines} />
  return <RelocationEditor docId={docId} lines={lines} zoneOptions={zoneOptions} canEdit={canEdit} onDone={onDone} />
}

function RelocationEditor({ docId, lines, zoneOptions, canEdit, onDone }: Omit<Props, 'readOnly'>) {
  const toast = useToast()
  // Раскладываем только ещё не размещённое (pending): часть могла уехать в ready раньше
  // через частичное «Разместить готовое» (отгрузка из упаковки) — её повторять не нужно.
  const packedLines = useMemo(
    () => lines.filter((l) => l.packed_pending_good > 0 || l.packed_pending_defect > 0),
    [lines],
  )
  const [allocs, setAllocs] = useState<Record<string, LineAlloc>>(() => {
    const next: Record<string, LineAlloc> = {}
    for (const l of packedLines) {
      next[l.id] = {
        good: initRows(l.packed_pending_good),
        defect: initRows(l.packed_pending_defect),
        touchedGood: false,
        touchedDefect: false,
      }
    }
    return next
  })
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [masterGood, setMasterGood] = useState('')
  const [masterDefect, setMasterDefect] = useState('')
  const [saving, setSaving] = useState(false)

  const zoneOpts: ComboboxOption[] = zoneOptions.map((z) => ({ value: z.id, label: z.name }))
  const zoneName = (id: string) => zoneOptions.find((z) => z.id === id)?.name ?? null

  const hasGood = packedLines.some((l) => l.packed_pending_good > 0)
  const hasDefect = packedLines.some((l) => l.packed_pending_defect > 0)

  // Мастер-раскладка: место применяется ко всем строкам, кроме правленных вручную.
  function applyMaster(kind: Kind, zoneId: string) {
    if (kind === 'good') setMasterGood(zoneId)
    else setMasterDefect(zoneId)
    if (!zoneId) return
    setAllocs((prev) => {
      const next = { ...prev }
      for (const l of packedLines) {
        const pending = kind === 'good' ? l.packed_pending_good : l.packed_pending_defect
        const st = next[l.id]
        const touched = kind === 'good' ? st.touchedGood : st.touchedDefect
        if (pending <= 0 || touched) continue
        next[l.id] = { ...st, [kind]: [{ zoneId, qty: pending }] }
      }
      return next
    })
  }

  function setRows(lineId: string, kind: Kind, rows: Row[]) {
    setAllocs((prev) => ({
      ...prev,
      [lineId]: {
        ...prev[lineId],
        [kind]: rows,
        ...(kind === 'good' ? { touchedGood: true } : { touchedDefect: true }),
      },
    }))
  }
  function setRow(lineId: string, kind: Kind, i: number, patch: Partial<Row>) {
    const rows = allocs[lineId][kind].map((r, idx) => (idx === i ? { ...r, ...patch } : r))
    setRows(lineId, kind, rows)
  }
  function addRow(lineId: string, kind: Kind) {
    setRows(lineId, kind, [...allocs[lineId][kind], { zoneId: '', qty: 0 }])
  }
  function removeRow(lineId: string, kind: Kind, i: number) {
    const rows = allocs[lineId][kind]
    if (rows.length <= 1) return
    setRows(lineId, kind, rows.filter((_, idx) => idx !== i))
  }

  // Возврат строки к общей раскладке: снова следует мастер-местам.
  function resetLine(lineId: string) {
    const l = packedLines.find((x) => x.id === lineId)
    if (!l) return
    setAllocs((prev) => ({
      ...prev,
      [lineId]: {
        good: l.packed_pending_good > 0 ? [{ zoneId: masterGood, qty: l.packed_pending_good }] : [],
        defect: l.packed_pending_defect > 0 ? [{ zoneId: masterDefect, qty: l.packed_pending_defect }] : [],
        touchedGood: false,
        touchedDefect: false,
      },
    }))
  }

  function sumRows(rows: Row[]): number {
    return rows.reduce((s, r) => s + (r.qty > 0 ? r.qty : 0), 0)
  }
  function placedSum(rows: Row[]): number {
    return rows.reduce((s, r) => s + (r.zoneId && r.qty > 0 ? r.qty : 0), 0)
  }

  function lineComplete(l: ShipmentLine): boolean {
    const a = allocs[l.id]
    return placedSum(a.good) === l.packed_pending_good && placedSum(a.defect) === l.packed_pending_defect
  }

  const completeCount = packedLines.filter(lineComplete).length
  const touchedCount = packedLines.filter((l) => allocs[l.id].touchedGood || allocs[l.id].touchedDefect).length

  const [showReasons, setShowReasons] = useState(false)

  function collectReasons(): string[] {
    const reasons: string[] = []
    for (const line of packedLines) {
      const a = allocs[line.id]
      for (const [kind, target, ru] of [
        ['good', line.packed_pending_good, 'годный'],
        ['defect', line.packed_pending_defect, 'брак'],
      ] as const) {
        const rows = a[kind]
        if (rows.some((r) => r.qty > 0 && !r.zoneId)) reasons.push(`Выберите место для «${line.product_name}» (${ru})`)
        const seen = new Set<string>()
        for (const r of rows) {
          if (!r.zoneId) continue
          if (seen.has(r.zoneId)) { reasons.push(`Место указано дважды для «${line.product_name}» (${ru})`); break }
          seen.add(r.zoneId)
        }
        if (sumRows(rows) !== target) reasons.push(`Разложите весь ${ru} для «${line.product_name}» (нужно ${target} шт.)`)
      }
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
    const payload: ShipmentRelocateLine[] = packedLines.map((line) => {
      const a = allocs[line.id]
      const toAlloc = (rows: Row[]) =>
        rows.filter((r) => r.zoneId && r.qty > 0).map((r) => ({ zone_id: r.zoneId, zone_name: zoneName(r.zoneId), qty: r.qty }))
      return { line_id: line.id, good: toAlloc(a.good), defect: toAlloc(a.defect) }
    })
    setSaving(true)
    try {
      await finishShipmentRelocation(docId, payload)
      await onDone()
      toast('Товар разложен по местам — отгрузка ожидает рейс', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка перемещения', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <PhaseBlock
      icon="archive"
      title="Раскладка по местоположениям"
      role="warehouse"
      state="active"
      hint="Разложите весь годный и брак, затем «Готово к рейсу». Годный остаётся «Готов к отгрузке», брак возвращается на хранение"
      right={canEdit ? (
        <button className="btn sm primary" disabled={saving} onClick={handlePrimary}>
          <Icon name="check" size={12} />Готово к рейсу
        </button>
      ) : undefined}
    >
      {packedLines.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>
          Нет упакованного товара для раскладки.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {showReasons && blockReasons.length > 0 && (
            <div className="block-reasons" style={{ textAlign: 'left' }}>
              {blockReasons.map((r, i) => (
                <div key={i}>· {r}</div>
              ))}
            </div>
          )}
          {!canEdit && (
            <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)' }}>
              Кладовщик указывает местоположения для годного и брака, затем жмёт «Готово к рейсу».
            </div>
          )}

          <div style={{
            border: '1px solid var(--c-border)', borderRadius: 'var(--r-lg)', padding: 12,
            background: 'var(--c-bg-sunken)', display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>
              Быстрая раскладка — место применится ко всем строкам сразу. Строки, размеченные вручную, не затрагиваются.
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {hasGood && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 240 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-success)', whiteSpace: 'nowrap' }}>Весь годный</span>
                  <Icon name="arrowRight" size={13} style={{ color: 'var(--c-text-subtle)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Combobox
                      value={masterGood || null}
                      placeholder="Выберите место"
                      options={zoneOpts}
                      onChange={(v) => applyMaster('good', String(v ?? ''))}
                      disabled={!canEdit || saving}
                      clearable
                    />
                  </div>
                </div>
              )}
              {hasDefect && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 240 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-danger)', whiteSpace: 'nowrap' }}>Весь брак</span>
                  <Icon name="arrowRight" size={13} style={{ color: 'var(--c-text-subtle)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Combobox
                      value={masterDefect || null}
                      placeholder="Выберите место"
                      options={zoneOpts}
                      onChange={(v) => applyMaster('defect', String(v ?? ''))}
                      disabled={!canEdit || saving}
                      clearable
                    />
                  </div>
                </div>
              )}
            </div>
            <div style={{ fontSize: 12, color: completeCount === packedLines.length ? 'var(--c-success)' : 'var(--c-text-subtle)' }}>
              Разложено {completeCount} из {packedLines.length} строк
              {touchedCount > 0 && ` · вручную: ${touchedCount}`}
            </div>
          </div>

          {packedLines.map((line) => {
            const a = allocs[line.id]
            const isTouched = a.touchedGood || a.touchedDefect
            const isExpanded = !!expanded[line.id]
            const complete = lineComplete(line)
            return (
              <div
                key={line.id}
                style={{
                  border: `1px solid ${isTouched ? 'var(--c-accent)' : 'var(--c-border)'}`,
                  borderRadius: 'var(--r-lg)',
                  background: 'var(--c-bg-elev)',
                }}
              >
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer' }}
                  onClick={() => setExpanded((prev) => ({ ...prev, [line.id]: !isExpanded }))}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <LineIdentityCell name={line.product_name} sku={line.product_sku} color={line.color_name} size={line.size_name} productId={line.product_id} />
                  </div>
                  {!isExpanded && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, fontSize: 12 }}>
                      {isTouched && (
                        <span style={{ color: 'var(--c-accent)' }}>вручную</span>
                      )}
                      {!complete && (
                        <span style={{ color: 'var(--c-warning)' }}>не разложено</span>
                      )}
                      {(['good', 'defect'] as const).map((kind) => {
                        const rows = a[kind].filter((r) => r.zoneId && r.qty > 0)
                        if (rows.length === 0) return null
                        const tone = kind === 'good' ? 'var(--c-success)' : 'var(--c-danger)'
                        return (
                          <span key={kind} style={{ color: tone, whiteSpace: 'nowrap' }}>
                            {rows.map((r) => `${r.qty} шт → ${zoneName(r.zoneId) ?? '?'}`).join(' · ')}
                          </span>
                        )
                      })}
                    </div>
                  )}
                  <Icon name={isExpanded ? 'chevUp' : 'chevDown'} size={13} style={{ color: 'var(--c-text-subtle)', flexShrink: 0 }} />
                </div>

                {isExpanded && (
                  <div style={{ padding: '0 12px 12px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      {line.packed_pending_good > 0 && (
                        <KindBlock
                          title="Годный" tone="var(--c-success)" target={line.packed_pending_good}
                          rows={a.good} options={zoneOpts} disabled={!canEdit || saving}
                          onRow={(i, patch) => setRow(line.id, 'good', i, patch)}
                          onAdd={() => addRow(line.id, 'good')}
                          onRemove={(i) => removeRow(line.id, 'good', i)}
                          sum={sumRows(a.good)}
                        />
                      )}
                      {line.packed_pending_defect > 0 && (
                        <KindBlock
                          title="Брак" tone="var(--c-danger)" target={line.packed_pending_defect}
                          rows={a.defect} options={zoneOpts} disabled={!canEdit || saving}
                          onRow={(i, patch) => setRow(line.id, 'defect', i, patch)}
                          onAdd={() => addRow(line.id, 'defect')}
                          onRemove={(i) => removeRow(line.id, 'defect', i)}
                          sum={sumRows(a.defect)}
                        />
                      )}
                    </div>
                    {isTouched && canEdit && (
                      <button
                        className="btn ghost sm"
                        style={{ marginTop: 10 }}
                        disabled={saving}
                        title="Снять ручную разметку — строка снова следует быстрой раскладке"
                        onClick={() => resetLine(line.id)}
                      >
                        <Icon name="refresh" size={12} />Вернуть к общей раскладке
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </PhaseBlock>
  )
}

function RelocationView({ lines }: { lines: ShipmentLine[] }) {
  const placedLines = useMemo(() => lines.filter((l) => l.placements.length > 0), [lines])
  return (
    <PhaseBlock
      icon="archive"
      title="Раскладка по местоположениям"
      role="warehouse"
      state="done"
      hint="Товар разложен кладовщиком по местоположениям"
    >
      {placedLines.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>
          Раскладка по местам не зафиксирована.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {placedLines.map((line) => (
            <div
              key={line.id}
              style={{ border: '1px solid var(--c-border)', borderRadius: 'var(--r-lg)', padding: 12, background: 'var(--c-bg-elev)' }}
            >
              <div style={{ marginBottom: 10 }}>
                <LineIdentityCell name={line.product_name} sku={line.product_sku} color={line.color_name} size={line.size_name} productId={line.product_id} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {(['good', 'defect'] as const).map((kind) => {
                  const rows = line.placements.filter((p) => p.kind === kind)
                  if (rows.length === 0) return null
                  const tone = kind === 'good' ? 'var(--c-success)' : 'var(--c-danger)'
                  return (
                    <div key={kind}>
                      <div style={{ marginBottom: 8, fontSize: 12.5, color: tone, fontWeight: 600 }}>
                        {kind === 'good' ? 'Годный' : 'Брак'}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {rows.map((p, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                            <span style={{ color: 'var(--c-text)' }}>{p.zone_name ?? 'Без места'}</span>
                            <b className="num" style={{ marginLeft: 'auto', color: 'var(--c-text)' }}>{p.qty}</b>
                            <span style={{ color: 'var(--c-text-subtle)' }}>шт</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </PhaseBlock>
  )
}

function KindBlock({
  title, tone, target, rows, options, disabled, onRow, onAdd, onRemove, sum,
}: {
  title:   string
  tone:    string
  target:  number
  rows:    Row[]
  options: ComboboxOption[]
  disabled: boolean
  onRow:   (i: number, patch: Partial<Row>) => void
  onAdd:   () => void
  onRemove: (i: number) => void
  sum:     number
}) {
  const left = target - sum
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12.5 }}>
        <span style={{ color: tone, fontWeight: 600 }}>{title}</span>
        <span style={{ color: 'var(--c-text-subtle)' }}>
          план <b className="num" style={{ color: 'var(--c-text)' }}>{target}</b>
        </span>
        <span style={{ marginLeft: 'auto', color: left === 0 ? 'var(--c-success)' : 'var(--c-warning)' }}>
          {left === 0 ? 'разложено' : `осталось ${left}`}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((row, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Combobox
                value={row.zoneId || null}
                placeholder="Выберите место"
                options={options}
                onChange={(v) => onRow(i, { zoneId: String(v ?? '') })}
                disabled={disabled}
                clearable
              />
            </div>
            <NumberStep
              value={row.qty}
              min={0}
              onChange={(v) => onRow(i, { qty: Math.max(0, v) })}
              disabled={disabled}
              width={96}
              height={34}
            />
            <button
              className="btn ghost icon sm"
              style={{ marginTop: 4 }}
              disabled={disabled || rows.length <= 1}
              title="Убрать строку"
              onClick={() => onRemove(i)}
            >
              <Icon name="x" size={13} />
            </button>
          </div>
        ))}
      </div>
      <button className="btn ghost sm" style={{ marginTop: 8 }} disabled={disabled} onClick={onAdd}>
        <Icon name="plus" size={12} />Добавить место
      </button>
    </div>
  )
}
