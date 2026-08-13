import { useEffect, useMemo, useState } from 'react'
import { finishDispatchPreparation } from '../../../../../api/dispatchApi'
import type { DispatchDetail, DispatchLine, DispatchPrepareLine } from '../../../../../api/dispatchApi'
import { getBalancesByZone } from '../../../../../api/balancesApi'
import type { BalanceZoneItem } from '../../../../../api/balancesApi'
import { Combobox } from '../../../../data/Combobox'
import type { ComboboxOption } from '../../../../data/Combobox'
import { Icon } from '../../../../primitives/Icon'
import { Badge } from '../../../../primitives/Badge'
import { Panel } from '../../../shared/process/processUI'
import { RoleChip } from '../../../shared/process/RoleChip'
import { LineIdentityCell } from '../../shared/LineIdentityCell'
import { PackUnitEditor } from './LinesTable'
import { DispatchLineFiles, dispatchFileGlyph, DISPATCH_FILE_ACCEPT } from './DispatchLineFiles'
import { LineFilesCell } from '../../shipmentDetail/components/LineFilesCell'
import { FilePreviewModal } from '../../shipmentDetail/components/FilePreviewModal'
import type { FilePreviewMeta } from '../../shipmentDetail/shared/types'
import { resolvePublicUploadSrc } from '../../../../../api/constants'
import { useToast } from '../../../../feedback/Toast'
import { balanceKey } from '../../../../../utils/balanceKey'
import { fmtDateLong } from '../../../../../utils/format'

type Row = { zoneId: string; qty: number }
type ZoneSource = { id: string; name: string; available: number }

type Props = {
  doc:    DispatchDetail
  canEdit: boolean
  /** Менеджер правит ссылку и вложения по строке прямо на подготовке (поправить ошибку). */
  canEditDocs: boolean
  onUpdateLine: (lineId: string, body: { site_url?: string | null }) => Promise<boolean>
  onUploadFile: (lineId: string, file: File) => Promise<boolean>
  onDeleteFile: (lineId: string, fileId: string) => Promise<boolean>
  /** Когда задан — менеджер правит палеты по строке прямо на подготовке. */
  onSavePallets?: (lineId: string, pallets: number | null) => Promise<boolean>
  /** Когда задан — менеджер правит короба по строке прямо на подготовке. */
  onSaveBoxes?: (lineId: string, boxes: number | null) => Promise<boolean>
  onDone: () => Promise<void> | void
}

export function PreparePanel({ doc, canEdit, canEditDocs, onUpdateLine, onUploadFile, onDeleteFile, onSavePallets, onSaveBoxes, onDone }: Props) {
  const toast = useToast()
  const isDefect = doc.cargo_type === 'defect'
  const isUnpacked = doc.cargo_type === 'good_unpacked'
  // Источник зависит от груза: годный кладовщик берёт из «Готов к отгрузке» (ready,
  // разложен по ячейкам) ИЛИ прямо из «Упаковано» (packed, зона упаковки — отгрузка из
  // ещё не завершённой задачи упаковки); брак и годный без упаковки — «На хранении»
  // (storage). Всё переезжает в «Зону отгрузки».
  const srcOps = isDefect || isUnpacked ? ['storage'] : ['ready', 'packed']
  const srcOpsKey = srcOps.join(',')
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
  const [filePreview, setFilePreview] = useState<{ filename: string; mimeType: string | null; url: string; meta: FilePreviewMeta } | null>(null)

  // Менеджер правит ссылку и вложения по строке прямо на подготовке (поправить ошибку).
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>(() => {
    const next: Record<string, string> = {}
    for (const l of lines) next[l.id] = l.site_url ?? ''
    return next
  })
  const [savingUrl, setSavingUrl] = useState<string | null>(null)
  const [uploadingLine, setUploadingLine] = useState<string | null>(null)

  function urlDirty(line: DispatchLine): boolean {
    return (urlDrafts[line.id] ?? '').trim() !== (line.site_url ?? '')
  }
  async function saveUrl(line: DispatchLine) {
    setSavingUrl(line.id)
    try {
      await onUpdateLine(line.id, { site_url: (urlDrafts[line.id] ?? '').trim() || null })
    } finally {
      setSavingUrl(null)
    }
  }
  async function handleUploadFiles(lineId: string, files: File[]) {
    setUploadingLine(lineId)
    try {
      for (const file of files) {
        const ok = await onUploadFile(lineId, file)
        if (!ok) break
      }
    } finally {
      setUploadingLine(null)
    }
  }
  // Замена = загрузка нового + удаление старого (отдельного эндпоинта нет, как в черновике).
  async function handleReplaceFile(lineId: string, oldFileId: string, file: File) {
    setUploadingLine(lineId)
    try {
      const ok = await onUploadFile(lineId, file)
      if (ok) await onDeleteFile(lineId, oldFileId)
    } finally {
      setUploadingLine(null)
    }
  }

  useEffect(() => {
    const ctrl = new AbortController()
    setLoadingZones(true)
    getBalancesByZone({ client_id: doc.client_id || undefined, only_positive: true }, ctrl.signal)
      .then((res) => {
        if (ctrl.signal.aborted) return
        setZoneBalances(res.items.filter(
          (z) => srcOps.includes(z.op_status) && z.quality === srcQuality && z.qty > 0 && z.location_id,
        ))
      })
      .catch(() => {})
      .finally(() => { if (!ctrl.signal.aborted) setLoadingZones(false) })
    return () => ctrl.abort()
  }, [doc.client_id, srcOpsKey, srcQuality])

  const sourcesByLine = useMemo(() => {
    const map = new Map<string, ZoneSource[]>()
    for (const line of lines) {
      const key = balanceKey(line)
      // Одна ячейка может встретиться в нескольких корзинах (ready/packed) — объединяем
      // по zone_id, суммируя доступное, чтобы не было дублей в выпадающем списке.
      const byZone = new Map<string, ZoneSource>()
      for (const z of zoneBalances) {
        if (balanceKey(z) !== key) continue
        const id = z.location_id!
        const prev = byZone.get(id)
        if (prev) prev.available += z.qty
        else byZone.set(id, { id, name: z.location_name ?? id, available: z.qty })
      }
      map.set(line.id, [...byZone.values()])
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
  const boxesTotal = lines.reduce((s, l) => s + (l.boxes_qty ?? 0), 0)
  const palletsTotal = lines.reduce((s, l) => s + (l.pallets_qty ?? 0), 0)
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
                {isUnpacked && <Badge>Без упаковки</Badge>}
              </div>
              <div style={{ fontSize: 13, color: 'var(--c-text-muted)', marginTop: 3, lineHeight: 1.45 }}>
                {doc.client_name ?? '—'} · отгрузка {fmtDateLong(doc.ship_date)}. По каждой строке укажите,
                из каких ячеек берётся {noun}, пока не наберёте весь план.
              </div>
            </div>
            <RoleChip role="warehouse" />
          </div>

          {doc.comment && (
            <div style={{
              marginTop: 16, padding: '12px 14px', borderRadius: 'var(--r-lg)',
              background: 'var(--c-bg-sunken)', border: '1px solid var(--c-border)',
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-text-subtle)', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 }}>
                Техническое задание
              </div>
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{doc.comment}</div>
            </div>
          )}

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
        right={
          <span style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>
            {lines.length} строки · план <b className="mono" style={{ color: 'var(--c-text)' }}>{planTotal}</b> шт
            {' · '}<b className="mono" style={{ color: 'var(--c-text)' }}>{boxesTotal}</b> кор
            {' · '}<b className="mono" style={{ color: 'var(--c-text)' }}>{palletsTotal}</b> пал
          </span>
        }
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
                      <LineIdentityCell name={line.product_name} sku={line.product_sku} color={line.color_name} size={line.size_name} productId={line.product_id} />
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

                  {/* Упаковка, указанная менеджером: кладовщик собирает по ней; менеджер может поправить. */}
                  <div style={{ marginTop: 11, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-text-subtle)', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                      Упаковка
                    </span>
                    <PackUnitEditor label="Короба" value={line.boxes_qty} onSave={onSaveBoxes ? (v) => onSaveBoxes(line.id, v) : undefined} />
                    <PackUnitEditor label="Палеты" value={line.pallets_qty} onSave={onSavePallets ? (v) => onSavePallets(line.id, v) : undefined} />
                  </div>

                  {canEditDocs ? (
                    <div style={{ marginTop: 11, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, fontSize: 12.5 }}>
                      {line.store_name && (
                        <span style={{ color: 'var(--c-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <Icon name="cart" size={13} style={{ color: 'var(--c-text-subtle)' }} />{line.store_name}
                        </span>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 240 }}>
                        <span style={{ fontSize: 11, color: 'var(--c-text-subtle)', flexShrink: 0 }}>Ссылка</span>
                        <input
                          className="input sm"
                          placeholder="https://…"
                          value={urlDrafts[line.id] ?? ''}
                          onChange={(e) => setUrlDrafts((prev) => ({ ...prev, [line.id]: e.target.value }))}
                          style={{ flex: 1, minWidth: 0 }}
                        />
                        {urlDirty(line) && (
                          <button
                            className="btn ghost icon sm"
                            title="Сохранить ссылку"
                            disabled={savingUrl === line.id}
                            onClick={() => void saveUrl(line)}
                          >
                            <Icon name={savingUrl === line.id ? 'refresh' : 'save'} size={13} style={savingUrl === line.id ? { animation: 'spin 0.7s linear infinite' } : undefined} />
                          </button>
                        )}
                      </div>
                      <LineFilesCell
                        entries={line.files.map((f) => ({ id: f.id, filename: f.filename, mimeType: f.mime_type, href: resolvePublicUploadSrc(f.url) }))}
                        canEdit
                        uploading={uploadingLine === line.id}
                        accept={DISPATCH_FILE_ACCEPT}
                        glyphFor={dispatchFileGlyph}
                        onPreview={(entry) => { if (entry.href) setFilePreview({
                          filename: entry.filename,
                          mimeType: entry.mimeType,
                          url: entry.href,
                          meta: { productName: line.product_name, sku: line.product_sku, colorName: line.color_name, sizeName: line.size_name, qty: line.qty },
                        }) }}
                        onAdd={(files) => void handleUploadFiles(line.id, files)}
                        onReplace={(fileId, file) => void handleReplaceFile(line.id, fileId, file)}
                        onRemove={(fileId) => void onDeleteFile(line.id, fileId)}
                      />
                    </div>
                  ) : (line.store_name || line.site_url || line.files.length > 0) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginTop: 11, fontSize: 12.5 }}>
                      {line.store_name && (
                        <span style={{ color: 'var(--c-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <Icon name="cart" size={13} style={{ color: 'var(--c-text-subtle)' }} />{line.store_name}
                        </span>
                      )}
                      {line.site_url && (
                        <a href={line.site_url} target="_blank" rel="noreferrer" title={line.site_url}
                           style={{ color: 'var(--c-accent)', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <Icon name="arrowRight" size={13} />Ссылка
                        </a>
                      )}
                      {line.files.length > 0 && (
                        <DispatchLineFiles
                          entries={line.files.map((f) => ({ id: f.id, filename: f.filename, mimeType: f.mime_type, href: resolvePublicUploadSrc(f.url) }))}
                          canEdit={false}
                        />
                      )}
                    </div>
                  )}

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
                        <input
                          className="input num"
                          inputMode="numeric"
                          placeholder="0"
                          aria-label="Количество"
                          value={row.qty > 0 ? String(row.qty) : ''}
                          disabled={!canEdit || saving}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/\D/g, '')
                            setRow(line.id, i, { qty: raw === '' ? 0 : Math.max(0, parseInt(raw, 10)) })
                          }}
                          style={{ width: 92, height: 34, textAlign: 'right', flexShrink: 0, borderColor: rowOverflow(line.id, row) ? 'var(--c-warning)' : undefined }}
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

      <FilePreviewModal
        filename={filePreview?.filename ?? null}
        mimeType={filePreview?.mimeType ?? null}
        url={filePreview?.url ?? ''}
        meta={filePreview?.meta ?? null}
        onClose={() => setFilePreview(null)}
      />
    </div>
  )
}
