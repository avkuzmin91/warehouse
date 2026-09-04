import { useMemo, useState } from 'react'
import { moveShipmentLinesToPacking } from '../../../../../api/shipmentsApi'
import type { ShipmentLine, ShipmentMassMoveLine } from '../../../../../api/shipmentsApi'
import { Drawer } from '../../../../feedback/Drawer'
import { Combobox } from '../../../../data/Combobox'
import type { ComboboxOption } from '../../../../data/Combobox'
import { Icon } from '../../../../primitives/Icon'
import { useToast } from '../../../../feedback/Toast'

export type MoveZoneOption = { id: string; name: string; available: number }

type Alloc = { zoneId: string; qty: number }
type RowState = { checked: boolean; expanded: boolean; allocs: Alloc[] }

type Props = {
  docId: string
  docNumber: string
  lines: ShipmentLine[]
  // transfer — первичная передача «В плане»; replenish — подвоз «На упаковке».
  mode: 'transfer' | 'replenish'
  // Задача размещения: брак — не недобор (он тоже уезжает в место хранения),
  // поэтому потребность считается иначе.
  putaway?: boolean
  // Точечная передача из строки таблицы: отмечается только эта позиция.
  focusLineId?: string | null
  getZoneOptions: (line: ShipmentLine) => MoveZoneOption[]
  onClose: () => void
  onDone: () => Promise<void> | void
}

function lineLabel(line: ShipmentLine): string {
  return [line.product_sku, line.color_name, line.size_name].filter(Boolean).join(' · ') || line.product_name
}

export function MassMoveToPackingDrawer({ docId, docNumber, lines, mode, putaway = false, focusLineId, getZoneOptions, onClose, onDone }: Props) {
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [showReasons, setShowReasons] = useState(false)

  // replenish: сколько ещё не хватает до плана при текущем пуле; transfer: сколько ещё не передано.
  // В упаковке брак не закрывает план (клиенту едет годное), в размещении — закрывает:
  // брак уезжает в место хранения так же, как годное, и подвозить взамен нечего.
  function needOf(line: ShipmentLine): number {
    if (mode !== 'replenish') return Math.max(0, line.qty - line.available_for_pack)
    const done = putaway ? line.packed_good + line.packed_defect : line.packed_good
    return Math.max(0, line.qty - done - line.available_for_pack)
  }

  const visibleLines = useMemo(
    () => lines.filter((l) => needOf(l) > 0 || l.id === focusLineId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, mode, focusLineId],
  )

  // Автораскладка: количество = need (сколько есть), места — по убыванию остатка (как FIFO на бэкенде).
  function autoAllocs(line: ShipmentLine): Alloc[] {
    const zones = [...getZoneOptions(line)].sort((a, b) => b.available - a.available)
    let rest = Math.min(needOf(line), zones.reduce((s, z) => s + z.available, 0))
    const allocs: Alloc[] = []
    for (const z of zones) {
      if (rest <= 0) break
      const take = Math.min(z.available, rest)
      allocs.push({ zoneId: z.id, qty: take })
      rest -= take
    }
    return allocs.length > 0 ? allocs : [{ zoneId: zones[0]?.id ?? '', qty: 0 }]
  }

  function autofillState(): Record<string, RowState> {
    const next: Record<string, RowState> = {}
    for (const line of visibleLines) {
      const allocs = autoAllocs(line)
      const total = allocs.reduce((s, a) => s + a.qty, 0)
      next[line.id] = {
        checked: focusLineId ? line.id === focusLineId : total > 0,
        expanded: false,
        allocs,
      }
    }
    return next
  }

  const [rows, setRows] = useState<Record<string, RowState>>(autofillState)

  function patchRow(lineId: string, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }))
  }
  function patchAlloc(lineId: string, i: number, patch: Partial<Alloc>) {
    setRows((prev) => {
      const row = prev[lineId]
      return { ...prev, [lineId]: { ...row, allocs: row.allocs.map((a, idx) => (idx === i ? { ...a, ...patch } : a)) } }
    })
  }
  function addAlloc(lineId: string) {
    setRows((prev) => {
      const row = prev[lineId]
      return { ...prev, [lineId]: { ...row, allocs: [...row.allocs, { zoneId: '', qty: 0 }] } }
    })
  }
  function removeAlloc(lineId: string, i: number) {
    setRows((prev) => {
      const row = prev[lineId]
      if (row.allocs.length <= 1) return prev
      return { ...prev, [lineId]: { ...row, allocs: row.allocs.filter((_, idx) => idx !== i) } }
    })
  }

  function rowTotal(lineId: string): number {
    return (rows[lineId]?.allocs ?? []).reduce((s, a) => s + (a.qty > 0 ? a.qty : 0), 0)
  }

  const checkedLines = visibleLines.filter((l) => rows[l.id]?.checked)
  const checkedSum = checkedLines.reduce((s, l) => s + rowTotal(l.id), 0)
  const needSum = visibleLines.reduce((s, l) => s + needOf(l), 0)
  const outOfStock = visibleLines.filter((l) => getZoneOptions(l).length === 0)
  const allChecked = visibleLines.length > 0 && visibleLines.every((l) => rows[l.id]?.checked || getZoneOptions(l).length === 0)

  function toggleAll() {
    setRows((prev) => {
      const next = { ...prev }
      for (const line of visibleLines) {
        const canCheck = getZoneOptions(line).length > 0
        next[line.id] = { ...next[line.id], checked: allChecked ? false : canCheck }
      }
      return next
    })
  }

  function collectReasons(): string[] {
    const reasons: string[] = []
    if (checkedLines.length === 0) {
      reasons.push('Отметьте хотя бы одну позицию')
      return reasons
    }
    for (const line of checkedLines) {
      const label = lineLabel(line)
      const allocs = rows[line.id].allocs
      const filled = allocs.filter((a) => a.zoneId || a.qty > 0)
      if (filled.length === 0 || rowTotal(line.id) <= 0) { reasons.push(`«${label}»: укажите количество`); continue }
      if (filled.some((a) => !a.zoneId)) reasons.push(`«${label}»: выберите место в каждой строке`)
      const used = filled.filter((a) => a.zoneId).map((a) => a.zoneId)
      if (new Set(used).size !== used.length) reasons.push(`«${label}»: место указано дважды — объедините строки`)
      const availById = new Map(getZoneOptions(line).map((z) => [z.id, z.available]))
      for (const a of filled) {
        const avail = availById.get(a.zoneId) ?? 0
        if (a.zoneId && a.qty > avail) { reasons.push(`«${label}»: в месте доступно ${avail} шт — уменьшите количество`); break }
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
    const payload: ShipmentMassMoveLine[] = checkedLines.map((line) => ({
      line_id: line.id,
      allocations: rows[line.id].allocs
        .filter((a) => a.zoneId && a.qty > 0)
        .map((a) => ({ from_zone_id: a.zoneId, qty: a.qty })),
    }))
    setSaving(true)
    try {
      const res = await moveShipmentLinesToPacking(docId, payload)
      await onDone()
      toast(`Передано на упаковку: ${res.moved} шт`, 'success')
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка перемещения', 'error')
    } finally {
      setSaving(false)
    }
  }

  const title = mode === 'replenish' ? 'Передать ещё на упаковку' : 'Передать на упаковку'

  return (
    <Drawer
      open
      onClose={onClose}
      title={title}
      subtitle={docNumber}
      width={680}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <span style={{ fontSize: 12.5, color: 'var(--c-text-subtle)' }}>
            {outOfStock.length > 0
              ? `Без остатка: ${outOfStock.length} — будут пропущены`
              : <>Отмечено <b className="num" style={{ color: 'var(--c-text)' }}>{checkedLines.length}</b> · <b className="num" style={{ color: 'var(--c-text)' }}>{checkedSum}</b> шт</>}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost" onClick={onClose} disabled={saving}>Отмена</button>
            <button className="btn primary" onClick={handlePrimary} disabled={saving || visibleLines.length === 0}>
              <Icon name="forklift" size={14} />
              {mode === 'replenish' ? 'Передать ещё' : 'Передать'}{checkedSum > 0 ? ` · ${checkedSum} шт` : ''}
            </button>
          </div>
        </div>
      }
    >
      {visibleLines.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>
          {putaway ? 'План закрыт: собранное и товар на упаковке покрывают все позиции.' : 'Все позиции уже переданы на упаковку.'}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12, fontSize: 12.5 }}>
            <span style={{ color: 'var(--c-text-subtle)' }}>
              {mode === 'replenish' ? 'Не хватает' : 'Осталось передать'}{' '}
              <b className="num" style={{ color: needSum > 0 ? 'var(--c-warning)' : 'var(--c-success)' }}>{needSum}</b> шт
              {' · '}<b className="num" style={{ color: 'var(--c-text)' }}>{visibleLines.length}</b> поз.
            </span>
            <button className="btn ghost sm" style={{ marginLeft: 'auto' }} disabled={saving} onClick={() => setRows(autofillState())}>
              <Icon name="sparkles" size={12} />Заполнить автоматически
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
            <span
              className={`t-checkbox ${allChecked ? 'checked' : ''}`}
              style={{ flexShrink: 0, cursor: 'pointer' }}
              title={allChecked ? 'Снять отметки' : 'Отметить всё'}
              onClick={() => !saving && toggleAll()}
            >
              {allChecked && <Icon name="check" size={10} />}
            </span>
            <span style={{ flex: 1 }}>Товар · вариант</span>
            <span style={{ width: 44, textAlign: 'right' }}>План</span>
            <span style={{ width: 60, textAlign: 'right' }}>Осталось</span>
            <span style={{ width: 84, textAlign: 'center' }}>Передать</span>
            <span style={{ width: 150 }}>Откуда</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {visibleLines.map((line) => {
              const row = rows[line.id]
              if (!row) return null
              const zones = getZoneOptions(line)
              const noStock = zones.length === 0
              const need = needOf(line)
              const total = rowTotal(line.id)
              const single = row.allocs.length === 1
              const availById = new Map(zones.map((z) => [z.id, z.available]))
              const zoneName = (id: string) => zones.find((z) => z.id === id)?.name ?? id
              const options: ComboboxOption[] = zones.map((z) => ({
                value: z.id,
                label: z.name,
                sub: `на хранении ${z.available.toLocaleString('ru-RU')} шт`,
              }))
              return (
                <div
                  key={line.id}
                  style={{
                    borderRadius: 8,
                    border: `1px solid ${row.checked && !noStock ? 'var(--c-accent)' : 'var(--c-border)'}`,
                    background: noStock ? 'var(--c-bg-sunken)' : row.checked ? 'var(--c-accent-bg)' : undefined,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px' }}>
                    <span
                      className={`t-checkbox ${row.checked && !noStock ? 'checked' : ''}`}
                      style={{ flexShrink: 0, cursor: noStock ? 'default' : 'pointer', opacity: noStock ? 0.4 : 1 }}
                      onClick={() => !saving && !noStock && patchRow(line.id, { checked: !row.checked })}
                    >
                      {row.checked && !noStock && <Icon name="check" size={10} />}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {line.product_name}
                      </div>
                      <div className="t-sub mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {[line.product_sku, line.color_name, line.size_name].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <span className="num" style={{ width: 44, textAlign: 'right', fontSize: 13 }}>{line.qty}</span>
                    <span className="num" style={{ width: 60, textAlign: 'right', fontSize: 13, color: need > 0 ? 'var(--c-text)' : 'var(--c-text-faint)' }}>
                      {need}
                    </span>
                    {noStock ? (
                      <span style={{ width: 84, textAlign: 'center', fontSize: 12, color: 'var(--c-warning)' }}>—</span>
                    ) : single ? (
                      <input
                        inputMode="numeric"
                        className="input"
                        placeholder="0"
                        value={row.allocs[0].qty === 0 ? '' : String(row.allocs[0].qty)}
                        disabled={saving}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/\D/g, '')
                          const qty = raw === '' ? 0 : Math.max(0, parseInt(raw, 10))
                          patchAlloc(line.id, 0, { qty })
                          if (qty > 0 && !row.checked) patchRow(line.id, { checked: true })
                        }}
                        style={{
                          width: 84,
                          height: 30,
                          flexShrink: 0,
                          textAlign: 'center',
                          fontFamily: 'var(--font-num)',
                          fontSize: 14,
                          fontVariantNumeric: 'tabular-nums',
                          fontFeatureSettings: "'tnum' 1",
                          borderColor: row.allocs[0].zoneId && row.allocs[0].qty > (availById.get(row.allocs[0].zoneId) ?? 0) ? 'var(--c-warning)' : undefined,
                          color: row.allocs[0].zoneId && row.allocs[0].qty > (availById.get(row.allocs[0].zoneId) ?? 0) ? 'var(--c-warning)' : undefined,
                        }}
                      />
                    ) : (
                      <span className="num" style={{ width: 84, textAlign: 'center', fontSize: 13, fontWeight: 500 }}>{total}</span>
                    )}
                    {noStock ? (
                      <span style={{ width: 150, fontSize: 12, color: 'var(--c-warning)' }}>нет на хранении</span>
                    ) : (
                      <button
                        className="btn ghost sm"
                        style={{ width: 150, justifyContent: 'flex-start', overflow: 'hidden' }}
                        disabled={saving}
                        title="Места-источники"
                        onClick={() => patchRow(line.id, { expanded: !row.expanded })}
                      >
                        <Icon name={row.expanded ? 'chevUp' : 'chevDown'} size={12} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                          {single
                            ? (row.allocs[0].zoneId ? zoneName(row.allocs[0].zoneId) : 'Выберите место')
                            : `${row.allocs.length} места`}
                        </span>
                      </button>
                    )}
                  </div>

                  {row.expanded && !noStock && (
                    <div style={{ padding: '0 10px 10px 34px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {row.allocs.map((alloc, i) => {
                        const avail = alloc.zoneId ? (availById.get(alloc.zoneId) ?? 0) : 0
                        return (
                          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <Combobox
                                value={alloc.zoneId || null}
                                placeholder="Выберите место"
                                options={options}
                                onChange={(v) => patchAlloc(line.id, i, { zoneId: String(v ?? '') })}
                                disabled={saving}
                                clearable
                              />
                              {alloc.zoneId && (
                                <div style={{ marginTop: 3, fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
                                  доступно {avail.toLocaleString('ru-RU')} шт
                                </div>
                              )}
                            </div>
                            <input
                              inputMode="numeric"
                              className="input"
                              placeholder="0"
                              value={alloc.qty === 0 ? '' : String(alloc.qty)}
                              disabled={saving}
                              onChange={(e) => {
                                const raw = e.target.value.replace(/\D/g, '')
                                patchAlloc(line.id, i, { qty: raw === '' ? 0 : Math.max(0, parseInt(raw, 10)) })
                              }}
                              style={{
                                width: 90,
                                height: 32,
                                flexShrink: 0,
                                textAlign: 'center',
                                fontFamily: 'var(--font-num)',
                                fontSize: 14,
                                fontVariantNumeric: 'tabular-nums',
                                fontFeatureSettings: "'tnum' 1",
                                borderColor: alloc.zoneId && alloc.qty > avail ? 'var(--c-warning)' : undefined,
                                color: alloc.zoneId && alloc.qty > avail ? 'var(--c-warning)' : undefined,
                              }}
                            />
                            <button
                              className="btn ghost icon sm"
                              style={{ marginTop: 3 }}
                              disabled={saving || row.allocs.length <= 1}
                              title="Убрать строку"
                              onClick={() => removeAlloc(line.id, i)}
                            >
                              <Icon name="x" size={13} />
                            </button>
                          </div>
                        )
                      })}
                      <button
                        className="btn ghost sm"
                        style={{ alignSelf: 'flex-start' }}
                        disabled={saving || row.allocs.length >= zones.length}
                        onClick={() => addAlloc(line.id)}
                      >
                        <Icon name="plus" size={12} />Добавить место
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {showReasons && blockReasons.length > 0 && (
            <div className="block-reasons" style={{ textAlign: 'left', marginTop: 10 }}>
              {blockReasons.map((r, i) => (
                <div key={i}>· {r}</div>
              ))}
            </div>
          )}
        </>
      )}
    </Drawer>
  )
}
