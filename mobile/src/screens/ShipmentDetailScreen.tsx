import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { newRequestId } from '../api/http'
import { useNav } from '../nav/NavContext'
import { getUnloadingZones, type Zone } from '../api/lookupsApi'
import { getBalancesByZone, type ZoneBalance } from '../api/balancesApi'
import { balanceKey } from '../utils/balanceKey'
import {
  advanceShipment,
  finishRelocation,
  finishShipmentDefectRelocation,
  getShipment,
  moveLineToPacking,
  placePackedShipment,
  returnLineFromPacking,
  SHIPMENT_STATUS_LABELS,
  type MoveAllocation,
  type RelocateLine,
  type ShipmentDefectRelocateLine,
  type ShipmentDetail,
  type ShipmentLine,
} from '../api/shipmentsApi'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
import { LineFiles } from '../components/LineFiles'
import { Sheet } from '../components/Sheet'
import { ZoneField } from '../components/ZoneField'
import { fmtDate, variantTitle } from '../utils/format'

type Row = { zoneId: string; qty: number }
type MoveZoneOption = { id: string; name: string; available: number }

function lineTitle(l: ShipmentLine): string {
  return variantTitle(l.product_name, [l.color_name, l.size_name])
}

function sumRows(rows: Row[]): number {
  return rows.reduce((s, r) => s + (r.qty > 0 ? r.qty : 0), 0)
}

export function ShipmentDetailScreen({ shipmentId }: { shipmentId: string }) {
  const { back } = useNav()
  const [doc, setDoc] = useState<ShipmentDetail | null>(null)
  const [zones, setZones] = useState<Zone[]>([])
  const [zoneBalances, setZoneBalances] = useState<ZoneBalance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [savingLine, setSavingLine] = useState<string | null>(null)

  const [moveRows, setMoveRows] = useState<Record<string, Row[]>>({})
  const [goodRows, setGoodRows] = useState<Record<string, Row[]>>({})
  const [defectRows, setDefectRows] = useState<Record<string, Row[]>>({})
  // Частичное размещение упакованного по местам прямо на упаковке (good).
  const [placeRows, setPlaceRows] = useState<Record<string, Row[]>>({})
  // Брак-отгрузка (relocating/defect): сбор брака из мест хранения в зону отгрузки.
  const [defectPrepRows, setDefectPrepRows] = useState<Record<string, Row[]>>({})
  const [showErrors, setShowErrors] = useState(false)
  const [returnLine, setReturnLine] = useState<ShipmentLine | null>(null)

  const load = useCallback(
    (signal?: AbortSignal) => {
      setLoading(true)
      setError('')
      getShipment(shipmentId, signal)
        .then((d) => {
          if (signal?.aborted) return
          setDoc(d)
          if (d.status === 'packing') {
            const next: Record<string, Row[]> = {}
            for (const l of d.lines) next[l.id] = [{ zoneId: '', qty: Math.max(0, l.qty - l.available_for_pack) }]
            setMoveRows(next)
          }
          if (d.status === 'relocating' && d.cargo_type === 'good') {
            const g: Record<string, Row[]> = {}
            const df: Record<string, Row[]> = {}
            for (const l of d.lines) {
              // Раскладываем только ещё не размещённое (часть могла уехать в ready раньше).
              if (l.packed_pending_good > 0) g[l.id] = [{ zoneId: '', qty: l.packed_pending_good }]
              if (l.packed_pending_defect > 0) df[l.id] = [{ zoneId: '', qty: l.packed_pending_defect }]
            }
            setGoodRows(g)
            setDefectRows(df)
          }
          if (d.status === 'relocating' && d.cargo_type === 'defect') {
            const next: Record<string, Row[]> = {}
            for (const l of d.lines) next[l.id] = [{ zoneId: '', qty: l.qty }]
            setDefectPrepRows(next)
          }
          if (d.status === 'on_packing' && d.cargo_type === 'good') {
            const p: Record<string, Row[]> = {}
            for (const l of d.lines) {
              if (l.packed_pending_good > 0) p[l.id] = [{ zoneId: '', qty: l.packed_pending_good }]
            }
            setPlaceRows(p)
          }
        })
        .catch((err) => {
          if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить отгрузку')
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false)
        })
    },
    [shipmentId],
  )

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    return () => ac.abort()
  }, [load])

  useEffect(() => {
    const ac = new AbortController()
    getUnloadingZones(ac.signal)
      .then((z) => setZones(z.filter((x) => x.is_active !== false && !x.is_deleted)))
      .catch(() => {})
    return () => ac.abort()
  }, [])

  // Места-источники свободного товара на хранении — для передачи на упаковку
  // (packing) и для сбора брака при брак-отгрузке (relocating/defect).
  useEffect(() => {
    if (!doc || !doc.client_id) return
    const needSources = doc.status === 'packing' || (doc.status === 'relocating' && doc.cargo_type === 'defect')
    if (!needSources) return
    const ac = new AbortController()
    getBalancesByZone({ clientId: doc.client_id }, ac.signal)
      .then((r) => setZoneBalances(r.items))
      .catch(() => {})
    return () => ac.abort()
  }, [doc])

  const zoneName = (id: string) => zones.find((z) => z.id === id)?.name ?? null

  function sourceZones(line: ShipmentLine): MoveZoneOption[] {
    if (!doc) return []
    const key = balanceKey(line)
    const quality = doc.cargo_type === 'defect' ? 'defect' : 'good'
    return zoneBalances
      .filter(
        (z) =>
          z.op_status === 'storage' &&
          z.quality === quality &&
          z.location_id &&
          z.qty > 0 &&
          z.client_id === doc.client_id &&
          balanceKey(z) === key,
      )
      .map((z) => ({ id: z.location_id!, name: z.location_name ?? z.location_id!, available: z.qty }))
  }

  // Стабильный request_id на логическое действие (идемпотентность при обрыве сети,
  // docs/mobile-plan.md §6.3); сбрасывается при успехе.
  const reqIds = useRef<Record<string, string>>({})
  function requestIdFor(key: string): string {
    return (reqIds.current[key] ??= newRequestId())
  }

  // Перезагрузка после действия: отменяем предыдущий незавершённый reload, иначе
  // устаревший ответ мог бы перезаписать свежее состояние (M2).
  const reloadAc = useRef<AbortController | null>(null)
  const reload = useCallback(() => {
    reloadAc.current?.abort()
    const ac = new AbortController()
    reloadAc.current = ac
    load(ac.signal)
  }, [load])
  useEffect(() => () => reloadAc.current?.abort(), [])

  async function runAction(fn: () => Promise<unknown>, actionKey?: string) {
    if (saving || savingLine) return
    setSaving(true)
    setError('')
    try {
      await fn()
      if (actionKey) delete reqIds.current[actionKey]
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выполнить действие')
    } finally {
      setSaving(false)
    }
  }

  async function transferLine(line: ShipmentLine) {
    const rows = moveRows[line.id] ?? []
    const avail = new Map(sourceZones(line).map((z) => [z.id, z.available]))
    const filled = rows.filter((r) => r.zoneId && r.qty > 0)
    if (filled.length === 0) {
      setError('Выберите место-источник и количество')
      return
    }
    for (const r of filled) {
      if (r.qty > (avail.get(r.zoneId) ?? 0)) {
        setError(`В месте доступно ${avail.get(r.zoneId) ?? 0} шт — уменьшите количество`)
        return
      }
    }
    const allocations: MoveAllocation[] = filled.map((r) => ({ from_zone_id: r.zoneId, qty: r.qty }))
    const moveKey = `move:${line.id}`
    setSavingLine(line.id)
    setError('')
    try {
      await moveLineToPacking(shipmentId, line.id, allocations, requestIdFor(moveKey))
      delete reqIds.current[moveKey]
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось передать')
    } finally {
      setSavingLine(null)
    }
  }

  async function doReturnFromPacking() {
    const line = returnLine
    if (!line || savingLine || saving) return
    setSavingLine(line.id)
    setError('')
    try {
      await returnLineFromPacking(shipmentId, line.id)
      setReturnLine(null)
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось вернуть на хранение')
    } finally {
      setSavingLine(null)
    }
  }

  // Для финальной раскладки берём ещё не размещённое (pending): часть могла уехать в
  // ready раньше частичным «Разместить готовое» — её повторно раскладывать не нужно.
  async function placeLinePacked(line: ShipmentLine) {
    const rows = placeRows[line.id] ?? []
    const filled = rows.filter((r) => r.zoneId && r.qty > 0)
    if (filled.length === 0) {
      setError('Выберите место и количество')
      return
    }
    if (sumRows(filled) > line.packed_pending_good) {
      setError(`Нельзя разместить больше упакованного (${line.packed_pending_good} шт.)`)
      return
    }
    const good = filled.map((r) => ({ zone_id: r.zoneId, zone_name: zoneName(r.zoneId), qty: r.qty }))
    const placeKey = `place:${line.id}`
    setSavingLine(line.id)
    setError('')
    try {
      await placePackedShipment(shipmentId, [{ line_id: line.id, good, defect: [] }], requestIdFor(placeKey))
      delete reqIds.current[placeKey]
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось разместить')
    } finally {
      setSavingLine(null)
    }
  }

  const packedLines = useMemo(
    () => (doc?.lines ?? []).filter((l) => l.packed_pending_good > 0 || l.packed_pending_defect > 0),
    [doc],
  )

  function handleAdvance() {
    void runAction(() => advanceShipment(shipmentId, requestIdFor('advance')), 'advance')
  }

  function handleFinishRelocation() {
    const reasons: string[] = []
    for (const l of packedLines) {
      if (l.packed_pending_good > 0) {
        const rows = goodRows[l.id] ?? []
        if (rows.some((r) => r.qty > 0 && !r.zoneId)) reasons.push(`Выберите место для годного «${l.product_name}»`)
        if (sumRows(rows) !== l.packed_pending_good) reasons.push(`Разложите весь годный «${l.product_name}» (нужно ${l.packed_pending_good})`)
      }
      if (l.packed_pending_defect > 0) {
        const rows = defectRows[l.id] ?? []
        if (rows.some((r) => r.qty > 0 && !r.zoneId)) reasons.push(`Выберите место для брака «${l.product_name}»`)
        if (sumRows(rows) !== l.packed_pending_defect) reasons.push(`Разложите весь брак «${l.product_name}» (нужно ${l.packed_pending_defect})`)
      }
    }
    if (reasons.length) {
      setShowErrors(true)
      setError(reasons[0])
      return
    }
    const toAlloc = (rows: Row[]) =>
      rows.filter((r) => r.zoneId && r.qty > 0).map((r) => ({ zone_id: r.zoneId, zone_name: zoneName(r.zoneId), qty: r.qty }))
    const lines: RelocateLine[] = packedLines.map((l) => ({
      line_id: l.id,
      good: l.packed_pending_good > 0 ? toAlloc(goodRows[l.id] ?? []) : [],
      defect: l.packed_pending_defect > 0 ? toAlloc(defectRows[l.id] ?? []) : [],
    }))
    void runAction(() => finishRelocation(shipmentId, lines, requestIdFor('finish')), 'finish')
  }

  // Брак-отгрузка: собрать брак из мест хранения → зона отгрузки (relocating → packed).
  function handleFinishDefectPreparation() {
    if (!doc) return
    const reasons: string[] = []
    for (const l of doc.lines) {
      const rows = defectPrepRows[l.id] ?? []
      const avail = new Map(sourceZones(l).map((z) => [z.id, z.available]))
      if (rows.some((r) => r.qty > 0 && !r.zoneId)) reasons.push(`Выберите место-источник для «${l.product_name}»`)
      const seen = new Set<string>()
      for (const r of rows) {
        if (!r.zoneId) continue
        if (seen.has(r.zoneId)) { reasons.push(`Место указано дважды для «${l.product_name}»`); break }
        seen.add(r.zoneId)
      }
      if (sumRows(rows) !== l.qty) reasons.push(`Наберите весь брак «${l.product_name}» (нужно ${l.qty} шт.)`)
      if (rows.some((r) => r.zoneId && r.qty > (avail.get(r.zoneId) ?? 0))) {
        reasons.push(`В выбранном месте не хватает брака для «${l.product_name}»`)
      }
    }
    if (reasons.length) {
      setShowErrors(true)
      setError(reasons[0])
      return
    }
    const lines: ShipmentDefectRelocateLine[] = doc.lines.map((l) => ({
      line_id: l.id,
      sources: (defectPrepRows[l.id] ?? [])
        .filter((r) => r.zoneId && r.qty > 0)
        .map((r) => ({
          zone_id: r.zoneId,
          zone_name: sourceZones(l).find((z) => z.id === r.zoneId)?.name ?? null,
          qty: r.qty,
        })),
    }))
    void runAction(() => finishShipmentDefectRelocation(shipmentId, lines))
  }

  return (
    <div className="screen">
      <AppBar
        title={doc ? doc.doc_number : 'Отгрузка'}
        sub={doc ? `${doc.cargo_type === 'defect' ? 'Брак' : 'Отгрузка'} · ${SHIPMENT_STATUS_LABELS[doc.status]}` : undefined}
        onBack={back}
      />

      <div className="scroll">
        {error && !doc && (
          <div className="alert">
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}

        {loading && !doc ? (
          <div className="center">
            <div className="spin" />
            <div>Загрузка отгрузки…</div>
          </div>
        ) : !doc ? null : (
          <>
            {/* Основная информация */}
            <div className="summary">
              <div className="kv">
                <span className="k">Клиент</span>
                <span className="v">{doc.client_name ?? '—'}</span>
              </div>
              {doc.destination && (
                <div className="kv">
                  <span className="k">Куда</span>
                  <span className="v">{doc.destination}</span>
                </div>
              )}
              <div className="kv">
                <span className="k">Дата отгрузки</span>
                <span className="v">{fmtDate(doc.ship_date)}</span>
              </div>
            </div>
            {doc.comment && (
              <div className="tzcard">
                <div className="tztitle">Техническое задание</div>
                <div className="tzbody">{doc.comment}</div>
              </div>
            )}

            {doc.status === 'packing' ? (
              <>
                <div className="sec">Передача на упаковку</div>
                {doc.lines.map((l) => {
                  const opts = sourceZones(l)
                  const need = Math.max(0, l.qty - l.available_for_pack)
                  const rows = moveRows[l.id] ?? []
                  const availById = new Map(opts.map((o) => [o.id, o.available]))
                  return (
                    <div key={l.id} className="line">
                      <div className="line-head">
                        <div className="line-name">{lineTitle(l)}</div>
                        {l.available_for_pack > 0 && (
                          <button
                            className="line-undo"
                            disabled={savingLine === l.id}
                            title="Вернуть на хранение (откат передачи)"
                            onClick={() => setReturnLine(l)}
                          >
                            <Icon name="refresh" size={13} /> Вернуть
                          </button>
                        )}
                      </div>
                      <div className="line-sub">
                        <span className="mono">{l.product_sku}</span>
                      </div>
                      <LineFiles files={l.files} onError={setError} />
                      <div className="pack-meter">
                        <div className="pack-meter-top">
                          <div className="pack-meter-count">
                            <b>{l.available_for_pack}</b>
                            <span className="pack-meter-of"> / {l.qty} шт передано</span>
                          </div>
                          {need === 0 ? (
                            <span className="badge success">
                              <Icon name="check" size={12} /> Передано
                            </span>
                          ) : (
                            <span className="badge warning">осталось {need}</span>
                          )}
                        </div>
                        <div className="pack-bar">
                          <div
                            className={`pack-bar-fill${need === 0 ? ' done' : ''}`}
                            style={{
                              width: `${l.qty > 0 ? Math.min(100, Math.round((l.available_for_pack / l.qty) * 100)) : 0}%`,
                            }}
                          />
                        </div>
                      </div>
                      {opts.length === 0 ? (
                        <div className="line-sub" style={{ marginTop: 8, color: 'var(--c-warning)' }}>
                          Нет свободного товара на хранении для передачи.
                        </div>
                      ) : (
                        <>
                          {rows.map((row, i) => (
                            <div key={i} className="line-row">
                              <input
                                className="input num"
                                type="text"
                                inputMode="numeric"
                                min={0}
                                value={row.qty || ''}
                                onChange={(e) =>
                                  setMoveRows((p) => ({
                                    ...p,
                                    [l.id]: rows.map((r, idx) =>
                                      idx === i ? { ...r, qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) } : r,
                                    ),
                                  }))
                                }
                              />
                              <ZoneField
                                value={row.zoneId}
                                options={opts.map((o) => ({
                                  value: o.id,
                                  label: `${o.name} (на хранении ${o.available})`,
                                }))}
                                placeholder="Место-источник…"
                                title="Откуда передать"
                                onError={setError}
                                onChange={(v) =>
                                  setMoveRows((p) => ({
                                    ...p,
                                    [l.id]: rows.map((r, idx) => (idx === i ? { ...r, zoneId: v } : r)),
                                  }))
                                }
                              />
                            </div>
                          ))}
                          {rows.length > 0 && rows[0].zoneId && (
                            <div className="line-sub" style={{ marginTop: 6 }}>
                              доступно в выбранном месте: {availById.get(rows[0].zoneId) ?? 0} шт
                            </div>
                          )}
                          <div className="line-row">
                            {rows.length < opts.length && (
                              <button
                                className="btn ghost sm auto"
                                onClick={() => setMoveRows((p) => ({ ...p, [l.id]: [...rows, { zoneId: '', qty: 0 }] }))}
                              >
                                <Icon name="plus" size={16} /> Место
                              </button>
                            )}
                            <button
                              className="btn sm"
                              style={{ flex: 1 }}
                              disabled={savingLine === l.id}
                              onClick={() => void transferLine(l)}
                            >
                              {savingLine === l.id ? <span className="spin spin-sm" /> : 'Передать'}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
                <div className="actionbar">
                  {error && (
                    <div className="alert">
                      <Icon name="alert" size={15} />
                      {error}
                    </div>
                  )}
                  <button className="btn" disabled={saving || savingLine !== null} onClick={handleAdvance}>
                    {saving ? <span className="spin spin-sm" /> : <><Icon name="check" size={18} /> Готово — на упаковку</>}
                  </button>
                </div>
              </>
            ) : doc.status === 'relocating' && doc.cargo_type === 'good' ? (
              <>
                <div className="sec">Раскладка по местам</div>
                {packedLines.length === 0 ? (
                  <div className="center">Нет упакованного товара для раскладки.</div>
                ) : (
                  <>
                    {packedLines.map((l) => (
                      <div key={l.id} className="line">
                        <div className="line-name">{lineTitle(l)}</div>
                        <div className="line-sub mono">{l.product_sku}</div>
                        {l.packed_pending_good > 0 && (
                          <KindRows
                            title="Годный"
                            tone="var(--c-success)"
                            target={l.packed_pending_good}
                            rows={goodRows[l.id] ?? []}
                            zones={zones}
                            showErrors={showErrors}
                            onError={setError}
                            onChange={(rows) => setGoodRows((p) => ({ ...p, [l.id]: rows }))}
                          />
                        )}
                        {l.packed_pending_defect > 0 && (
                          <KindRows
                            title="Брак"
                            tone="var(--c-danger)"
                            target={l.packed_pending_defect}
                            rows={defectRows[l.id] ?? []}
                            zones={zones}
                            showErrors={showErrors}
                            onError={setError}
                            onChange={(rows) => setDefectRows((p) => ({ ...p, [l.id]: rows }))}
                          />
                        )}
                      </div>
                    ))}
                    <div className="actionbar">
                      <button className="btn" disabled={saving} onClick={handleFinishRelocation}>
                        {saving ? <span className="spin spin-sm" /> : <><Icon name="check" size={18} /> Готово к рейсу</>}
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : doc.status === 'relocating' && doc.cargo_type === 'defect' ? (
              <>
                <div className="sec">Сбор брака к отгрузке</div>
                <div className="line-sub" style={{ padding: '0 2px 8px' }}>
                  По каждой строке укажите, из каких мест хранения берётся брак —
                  он переедет в зону отгрузки и будет ждать рейс.
                </div>
                {doc.lines.map((l) => {
                  const opts = sourceZones(l)
                  const rows = defectPrepRows[l.id] ?? []
                  const picked = sumRows(rows.filter((r) => !!r.zoneId))
                  const done = picked >= l.qty
                  return (
                    <div key={l.id} className="line">
                      <div className="line-head">
                        <div className="line-name">{lineTitle(l)}</div>
                        {done ? (
                          <span className="badge success">
                            <Icon name="check" size={12} /> Набрано
                          </span>
                        ) : (
                          <span className="badge warning">осталось {Math.max(0, l.qty - picked)}</span>
                        )}
                      </div>
                      <div className="line-sub">
                        <span className="mono">{l.product_sku}</span> · план {l.qty} шт
                      </div>
                      <LineFiles files={l.files} onError={setError} />
                      {opts.length === 0 ? (
                        <div className="line-sub" style={{ marginTop: 8, color: 'var(--c-warning)' }}>
                          Брак этой позиции не найден в местах хранения — проверьте остатки.
                        </div>
                      ) : (
                        <>
                          {rows.map((row, i) => (
                            <div key={i} className="line-row">
                              <input
                                className="input num"
                                type="text"
                                inputMode="numeric"
                                min={0}
                                value={row.qty || ''}
                                onChange={(e) =>
                                  setDefectPrepRows((p) => ({
                                    ...p,
                                    [l.id]: rows.map((r, idx) =>
                                      idx === i ? { ...r, qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) } : r,
                                    ),
                                  }))
                                }
                              />
                              <ZoneField
                                value={row.zoneId}
                                options={opts.map((o) => ({ value: o.id, label: `${o.name} (брак ${o.available})` }))}
                                placeholder="Откуда взять…"
                                title="Место-источник"
                                invalid={showErrors && row.qty > 0 && !row.zoneId}
                                onError={setError}
                                onChange={(v) =>
                                  setDefectPrepRows((p) => ({
                                    ...p,
                                    [l.id]: rows.map((r, idx) => (idx === i ? { ...r, zoneId: v } : r)),
                                  }))
                                }
                              />
                              {rows.length > 1 && (
                                <button
                                  className="appbar-back"
                                  style={{ flex: '0 0 50px', height: 50 }}
                                  aria-label="Убрать строку"
                                  onClick={() =>
                                    setDefectPrepRows((p) => ({ ...p, [l.id]: rows.filter((_, idx) => idx !== i) }))
                                  }
                                >
                                  <Icon name="x" size={18} />
                                </button>
                              )}
                            </div>
                          ))}
                          {rows.length < opts.length && (
                            <button
                              className="btn ghost sm auto"
                              style={{ marginTop: 10 }}
                              onClick={() =>
                                setDefectPrepRows((p) => ({ ...p, [l.id]: [...rows, { zoneId: '', qty: 0 }] }))
                              }
                            >
                              <Icon name="plus" size={16} /> Место
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
                <div className="actionbar">
                  {error && (
                    <div className="alert">
                      <Icon name="alert" size={15} />
                      {error}
                    </div>
                  )}
                  <button className="btn" disabled={saving} onClick={handleFinishDefectPreparation}>
                    {saving ? <span className="spin spin-sm" /> : <><Icon name="check" size={18} /> Готово к рейсу</>}
                  </button>
                </div>
              </>
            ) : doc.status === 'on_packing' && doc.cargo_type === 'good' ? (
              (() => {
                const placeable = doc.lines.filter((l) => l.packed_pending_good > 0)
                return (
                  <>
                    <div className="sec">Разместить готовое к отгрузке</div>
                    <div className="line-sub" style={{ padding: '0 2px 8px' }}>
                      Упаковка идёт у начальника смены. Уже упакованный годный можно разложить
                      по местам — он станет доступен к отгрузке, не дожидаясь конца упаковки.
                    </div>
                    {placeable.length === 0 ? (
                      <div className="center">
                        <div className="center-ico">
                          <Icon name="box" size={26} />
                        </div>
                        <div>Пока нечего размещать — нет упакованного годного.</div>
                        <button className="btn ghost sm auto" onClick={back} style={{ marginTop: 4 }}>
                          Назад
                        </button>
                      </div>
                    ) : (
                      <>
                        {placeable.map((l) => (
                          <div key={l.id} className="line">
                            <div className="line-name">{lineTitle(l)}</div>
                            <div className="line-sub mono">{l.product_sku}</div>
                            <KindRows
                              title="Готовое"
                              tone="var(--c-success)"
                              target={l.packed_pending_good}
                              rows={placeRows[l.id] ?? []}
                              zones={zones}
                              showErrors={showErrors}
                              onError={setError}
                              onChange={(rows) => setPlaceRows((p) => ({ ...p, [l.id]: rows }))}
                            />
                            <button
                              className="btn sm"
                              style={{ marginTop: 8 }}
                              disabled={savingLine === l.id}
                              onClick={() => void placeLinePacked(l)}
                            >
                              {savingLine === l.id ? <span className="spin spin-sm" /> : <><Icon name="check" size={16} /> Разместить</>}
                            </button>
                          </div>
                        ))}
                        {error && (
                          <div className="alert">
                            <Icon name="alert" size={15} />
                            {error}
                          </div>
                        )}
                      </>
                    )}
                  </>
                )
              })()
            ) : doc.status === 'on_packing' ? (
              <div className="center">
                <div className="center-ico">
                  <Icon name="box" size={26} />
                </div>
                <div>Передано на упаковку — у начальника смены.</div>
                <button className="btn ghost sm auto" onClick={back} style={{ marginTop: 4 }}>
                  Назад
                </button>
              </div>
            ) : (
              <div className="center">
                <div className="center-ico green">
                  <Icon name="check" size={26} />
                </div>
                <div>{SHIPMENT_STATUS_LABELS[doc.status]} — действий кладовщика нет.</div>
                <button className="btn ghost sm auto" onClick={back} style={{ marginTop: 4 }}>
                  Назад
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {returnLine && (
        <Sheet onClose={() => setReturnLine(null)} locked={savingLine === returnLine.id}>
          <h3>Вернуть на хранение?</h3>
          <p className="line-sub" style={{ fontSize: 13, marginTop: 0 }}>
            {returnLine.available_for_pack} шт по «{returnLine.product_name}» вернётся в исходные места хранения.
            Передачу на упаковку можно будет указать заново.
          </p>
          <div className="dtf-actions">
            <button className="btn ghost" disabled={savingLine === returnLine.id} onClick={() => setReturnLine(null)}>
              Отмена
            </button>
            <button className="btn" disabled={savingLine === returnLine.id} onClick={() => void doReturnFromPacking()}>
              {savingLine === returnLine.id ? <span className="spin spin-sm" /> : 'Вернуть'}
            </button>
          </div>
        </Sheet>
      )}

    </div>
  )
}

function KindRows({
  title,
  tone,
  target,
  rows,
  zones,
  showErrors,
  onError,
  onChange,
}: {
  title: string
  tone: string
  target: number
  rows: Row[]
  zones: Zone[]
  showErrors: boolean
  onError: (msg: string) => void
  onChange: (rows: Row[]) => void
}) {
  const left = target - sumRows(rows)
  return (
    <div>
      <div className="kindhead">
        <span className="ktitle" style={{ color: tone }}>
          {title}
        </span>
        <span className="line-sub">план {target}</span>
        <span className="kleft" style={{ color: left === 0 ? 'var(--c-success)' : 'var(--c-warning)' }}>
          {left === 0 ? 'разложено' : `осталось ${left}`}
        </span>
      </div>
      {rows.map((row, i) => (
        <div key={i} className="line-row" style={{ marginTop: i === 0 ? 0 : 10 }}>
          <input
            className="input num"
            type="text"
            inputMode="numeric"
            min={0}
            value={row.qty || ''}
            onChange={(e) =>
              onChange(rows.map((r, idx) => (idx === i ? { ...r, qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) } : r)))
            }
          />
          <ZoneField
            value={row.zoneId}
            options={zones.map((z) => ({ value: z.id, label: z.name }))}
            placeholder="Место…"
            title="Место хранения"
            invalid={showErrors && row.qty > 0 && !row.zoneId}
            onError={onError}
            allowUnlisted
            onChange={(v) => onChange(rows.map((r, idx) => (idx === i ? { ...r, zoneId: v } : r)))}
          />
          {rows.length > 1 && (
            <button
              className="appbar-back"
              style={{ flex: '0 0 50px', height: 50 }}
              aria-label="Убрать строку"
              onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
            >
              <Icon name="x" size={18} />
            </button>
          )}
        </div>
      ))}
      <button className="btn ghost sm auto" style={{ marginTop: 10 }} onClick={() => onChange([...rows, { zoneId: '', qty: 0 }])}>
        <Icon name="plus" size={16} /> Место
      </button>
    </div>
  )
}
