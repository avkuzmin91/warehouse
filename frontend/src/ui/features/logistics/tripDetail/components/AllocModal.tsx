import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Icon } from '../../../../primitives/Icon'
import type { IconName } from '../../../../primitives/Icon'
import { foldCiSearch } from '../../../../../utils/foldCiSearch'
import { colorSwatch } from '../../../../../utils/colorSwatch'
import { fmtDateShort, fmtDateLong } from '../../../../../utils/format'

/* ====================================================================== */
/* Полноэкранный модал «Распределение по рейсу»: левый рейл документов +   */
/* таблица строк с вводом количества + итоги рейса. Generic под отгрузки   */
/* и поступления (склонения и эндпоинты передаёт вызывающий блок).         */
/* ====================================================================== */

export type AllocDoc = {
  doc_id: string
  client: string | null
  doc_number: string | null
  status_label: string
  status_tone: string
  /** Плановая дата документа (ISO YYYY-MM-DD): отгрузки — дата отгрузки, поступления — прибытия. */
  date?: string | null
  /** Подпись в пикере: «N SKU · M шт». */
  sub?: string | null
}

export type AllocLine = {
  line_id: string
  sku: string | null
  name: string | null
  variant: string | null
  color: string | null
  plan: number
  /** Максимум, который можно увезти этим рейсом (остаток + текущее распределение). */
  max: number
  /** Текущее распределение в этот рейс; null для нового документа → дефолт = max. */
  preset: number | null
  /** Магазин назначения строки (только отгрузки); null → колонка не показывается. */
  store?: string | null
}

export type AllocItem = { doc_id: string; allocations: { line_id: string; qty: number }[] }

export type AllocLexicon = {
  headerIcon: IconName
  /** «отгрузок» / «поступлений» — для пустого состояния и подписей. */
  docsGen: string
  /** «отгрузки» / «поступления» — заголовок раздела. */
  addTitle: string
  /** глагол в строке итога: «Уходит в рейс» / «Прибывает рейсом». */
  flowLabel: string
  /** подпись плановой даты в шапке: «Плановая отгрузка» / «Плановое прибытие». */
  dateLabel: string
}

export type AllocModalProps = {
  open: boolean
  onClose: () => void
  tripNumber: string
  tripDestination: string | null
  lex: AllocLexicon
  linkedDocs: AllocDoc[]
  candidates: AllocDoc[]
  fetchLines: (docId: string) => Promise<AllocLine[]>
  onConfirm: (items: AllocItem[], removedDocIds: string[]) => Promise<void>
  busy?: boolean
}

type QtyMap = Record<string, number>

function lineState(line: AllocLine, q: number): 'distributed' | 'over' | 'full' | 'partial' | 'zero' {
  if (line.max === 0) return 'distributed'
  if (q > line.max) return 'over'
  if (q === line.max) return 'full'
  if (q > 0) return 'partial'
  return 'zero'
}

/** Сортировка документов по имени клиента, затем по номеру. */
function byClient(a?: AllocDoc, b?: AllocDoc): number {
  return (a?.client ?? '').localeCompare(b?.client ?? '', 'ru')
    || (a?.doc_number ?? '').localeCompare(b?.doc_number ?? '', 'ru')
}

/** Календарная плитка плановой даты — крупный день над месяцем, акцентная полоса сверху. */
function DateTile({ date, label }: { date: string | null | undefined; label?: string }) {
  if (!date) return <span className="date-tile empty" title="Плановая дата не указана"><Icon name="calendar" size={15} /></span>
  const d = new Date(date)
  const day = d.toLocaleDateString('ru-RU', { day: 'numeric' })
  const mon = d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '')
  return (
    <span className="date-tile" title={label ? `${label}: ${fmtDateLong(date)}` : fmtDateLong(date)}>
      <span className="date-tile-day">{day}</span>
      <span className="date-tile-mon">{mon}</span>
    </span>
  )
}

/** Инлайновый чип плановой даты для шапок: иконка + подпись + дата. */
function DateChip({ date, label, style }: { date: string; label: string; style?: CSSProperties }) {
  return (
    <span className="date-chip" style={style} title={`${label}: ${fmtDateLong(date)}`}>
      <Icon name="calendar" size={12} />
      <span className="date-chip-label">{label}</span>
      {fmtDateShort(date)}
    </span>
  )
}

/* ---------------- doc chip (left rail) ---------------- */
function DocChip({ doc, lines, qty, active, onClick, onRemove }: {
  doc: AllocDoc
  lines: AllocLine[] | undefined
  qty: QtyMap
  active: boolean
  onClick: () => void
  onRemove: () => void
}) {
  const t = useMemo(() => {
    let max = 0, q = 0, over = 0
    for (const l of lines ?? []) {
      max += l.max
      const v = qty[l.line_id] ?? 0
      q += Math.min(v, l.max)
      if (v > l.max) over++
    }
    return { max, q, over }
  }, [lines, qty])
  const pct = t.max > 0 ? Math.round((t.q / t.max) * 100) : 0
  const allDone = lines != null && t.max === 0
  return (
    <button type="button" className={`doc-chip${active ? ' active' : ''}`} onClick={onClick}>
      <span className="doc-chip-remove" onClick={(e) => { e.stopPropagation(); onRemove() }} title="Убрать из рейса"><Icon name="trash" size={13} /></span>
      {t.over > 0 && <span className="doc-chip-flag"><span className="badge danger" style={{ height: 17, padding: '0 5px' }}><span className="dot" />{t.over}</span></span>}
      <div className="doc-chip-top">
        <span className="doc-chip-client">{doc.client ?? 'Без клиента'}</span>
      </div>
      <div className="doc-chip-meta">
        <span className="mono">{doc.doc_number}</span>
        {lines != null && <><span>·</span><span>{lines.length} строк</span></>}
      </div>
      <div className="doc-chip-bar">
        <div className="prog"><div className={`prog-fill${t.over ? ' danger' : pct >= 100 ? ' ok' : ''}`} style={{ width: (allDone ? 100 : Math.min(pct, 100)) + '%' }} /></div>
        <span className="doc-chip-qty">{lines == null ? '…' : allDone ? '—' : `${t.q}/${t.max}`}</span>
      </div>
    </button>
  )
}

/* ---------------- lines table ---------------- */
function LinesTable({ lines, qty, setQty, query }: {
  lines: AllocLine[]
  qty: QtyMap
  setQty: (lineId: string, v: number) => void
  query: string
}) {
  const filtered = useMemo(() => {
    const f = foldCiSearch(query.trim())
    if (!f) return lines
    return lines.filter((l) => foldCiSearch(`${l.sku ?? ''} ${l.name ?? ''} ${l.variant ?? ''}`).includes(f))
  }, [lines, query])

  const totals = useMemo(() => {
    let plan = 0, max = 0, q = 0, over = 0
    for (const l of lines) {
      plan += l.plan; max += l.max
      const v = qty[l.line_id] ?? 0
      q += Math.min(v, l.max); if (v > l.max) over++
    }
    return { plan, max, q, over }
  }, [lines, qty])

  const hasStore = useMemo(() => lines.some((l) => l.store), [lines])

  if (filtered.length === 0) {
    return <div className="alloc-empty"><div className="alloc-empty-ico" /><h3>Ничего не нашлось</h3><p>Измените запрос поиска по SKU или наименованию.</p></div>
  }

  let prevKey: string | null = null
  return (
    <table className="lt">
      <thead>
        <tr>
          <th style={{ width: 104 }}>SKU</th>
          <th>Наименование</th>
          <th style={{ width: 150 }}>Вариант</th>
          {hasStore && <th style={{ width: 150 }}>Магазин</th>}
          <th className="num" style={{ width: 66 }}>План</th>
          <th className="num" style={{ width: 78 }}>Остаток</th>
          <th className="num" style={{ width: 168 }}>В рейс</th>
        </tr>
      </thead>
      <tbody>
        {filtered.map((l) => {
          const key = `${l.sku}${l.name}`
          const groupStart = key !== prevKey
          prevKey = key
          const q = qty[l.line_id] ?? 0
          const st = lineState(l, q)
          const disabled = st === 'distributed'
          return (
            <tr key={l.line_id} className={`${groupStart ? 'group-start' : ''} ${st === 'over' ? 'is-over' : ''} ${disabled ? 'is-done' : ''}`}>
              <td><span className={`c-sku${groupStart ? '' : ' dim'}`}>{l.sku}</span></td>
              <td><span className={`c-name${groupStart ? '' : ' dim'}`}>{l.name}</span></td>
              <td>{l.variant && <span className="var-chip"><span className="var-sw" style={{ background: colorSwatch(l.color) }} />{l.variant}</span>}</td>
              {hasStore && <td>{l.store ? <span className="c-name">{l.store}</span> : <span className="subtle">—</span>}</td>}
              <td className="c-num">{l.plan}</td>
              <td className="c-num"><span className="rem-cell"><span className={l.max === 0 ? 'rem-zero' : ''} style={{ fontWeight: l.max ? 500 : 400 }}>{l.max}</span></span></td>
              <td>
                <div className="qty-wrap">
                  {disabled ? (
                    <>
                      <span className="qty-of" />
                      <span className="line-tag done"><Icon name="check" size={12} /><span style={{ marginLeft: 2 }}>распределено</span></span>
                    </>
                  ) : (
                    <>
                      {st === 'over'
                        ? <span className="qty-of qty-hint-over">макс. {l.max}</span>
                        : <span className="qty-of">из <span className="max">{l.max}</span></span>}
                      <input
                        className={`qty-input ${st === 'over' ? 'over' : st === 'full' ? 'full' : ''}`}
                        inputMode="numeric"
                        value={q}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/[^\d]/g, '')
                          setQty(l.line_id, digits === '' ? 0 : parseInt(digits, 10))
                        }}
                      />
                    </>
                  )}
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={hasStore ? 4 : 3}>Итого по документу{query.trim() && <span className="subtle" style={{ fontWeight: 400 }}> · показано {filtered.length} из {lines.length}</span>}</td>
          <td className="num">{totals.plan}</td>
          <td className="num">{totals.max}</td>
          <td className="num" style={{ color: totals.over ? 'var(--c-danger)' : totals.q > 0 ? 'var(--c-accent)' : 'inherit' }}>{totals.q}</td>
        </tr>
      </tfoot>
    </table>
  )
}

/* ---------------- main pane ---------------- */
function MainPane({ doc, lines, qty, setQty, fillAll, clearAll, query, setQuery, lex }: {
  doc: AllocDoc | null
  lines: AllocLine[] | undefined
  qty: QtyMap
  setQty: (lineId: string, v: number) => void
  fillAll: () => void
  clearAll: () => void
  query: string
  setQuery: (v: string) => void
  lex: AllocLexicon
}) {
  const t = useMemo(() => {
    let plan = 0, max = 0, q = 0, leftover = 0
    for (const l of lines ?? []) { plan += l.plan; max += l.max; const v = qty[l.line_id] ?? 0; q += Math.min(v, l.max); leftover += Math.max(l.max - v, 0) }
    return { plan, max, q, leftover }
  }, [lines, qty])

  if (!doc) {
    return (
      <div className="alloc-main">
        <div className="alloc-empty">
          <div className="alloc-empty-ico" />
          <h3>Документы не выбраны</h3>
          <p>Добавьте {lex.docsGen} в рейс кнопкой «Добавить» слева, чтобы распределить количества по строкам.</p>
        </div>
      </div>
    )
  }
  const allDone = lines != null && t.max === 0
  return (
    <div className="alloc-main">
      <div className="main-head">
        <div className="main-head-row">
          <span className="main-head-client">{doc.client ?? 'Без клиента'}</span>
          <span className="mono subtle" style={{ fontSize: 12 }}>{doc.doc_number}</span>
          <span className={`badge ${doc.status_tone}`} style={{ marginLeft: 2 }}><span className="dot" />{doc.status_label}</span>
          {doc.date && <DateChip date={doc.date} label={lex.dateLabel} style={{ marginLeft: 'auto' }} />}
        </div>
        <div className="main-stats">
          <div className="main-stat"><div className="main-stat-label">План</div><div className="main-stat-val">{t.plan}<span className="unit">шт</span></div></div>
          <div className="main-stat"><div className="main-stat-label">К распределению</div><div className="main-stat-val">{t.max}<span className="unit">шт</span></div></div>
          <div className="main-stat accent"><div className="main-stat-label">В этот рейс</div><div className="main-stat-val">{t.q}<span className="unit">шт</span></div></div>
          <div className="main-stat"><div className="main-stat-label">Остаётся</div><div className="main-stat-val">{t.leftover}<span className="unit">шт</span></div></div>
        </div>
        <div className="main-toolbar">
          <label className="main-search">
            <span className="ic"><Icon name="search" size={13} /></span>
            <input className="input sm" placeholder="Поиск по SKU или наименованию…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="qf">
            <button type="button" className="btn sm" onClick={fillAll} disabled={allDone}>Весь остаток</button>
            <button type="button" className="btn sm" onClick={clearAll} disabled={allDone}>Обнулить</button>
          </div>
        </div>
      </div>
      <div className="lines-scroll">
        {lines == null
          ? <div className="alloc-empty"><div className="alloc-empty-ico" /><h3>Загрузка строк…</h3><p /></div>
          : lines.length === 0
            ? <div className="alloc-empty"><div className="alloc-empty-ico" /><h3>Нет строк</h3><p>В документе нет позиций для распределения.</p></div>
            : <LinesTable lines={lines} qty={qty} setQty={setQty} query={query} />}
      </div>
    </div>
  )
}

/* ---------------- candidate picker ---------------- */
function Picker({ candidates, addedIds, previewId, dateLabel, onHover, onCancel, onAdd }: {
  candidates: AllocDoc[]
  addedIds: string[]
  previewId: string | null
  dateLabel: string
  onHover: (id: string) => void
  onCancel: () => void
  onAdd: (ids: string[]) => void
}) {
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const avail = candidates.filter((c) => !addedIds.includes(c.doc_id))
  const filtered = useMemo(() => {
    const f = foldCiSearch(q.trim())
    const base = f ? avail.filter((c) => foldCiSearch(`${c.doc_number ?? ''} ${c.client ?? ''}`).includes(f)) : avail
    return [...base].sort(byClient)
  }, [avail, q])
  function toggle(id: string) { setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  return (
    <div className="picker">
      <div className="picker-head">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <span className="rail-head-title">Добавить документы</span>
          <button type="button" className="btn ghost icon sm" onClick={onCancel}><Icon name="x" size={14} /></button>
        </div>
        <label className="main-search">
          <span className="ic"><Icon name="search" size={13} /></span>
          <input className="input sm" placeholder="Клиент или номер…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </label>
      </div>
      <div className="picker-list">
        {filtered.length === 0 && <div className="subtle" style={{ textAlign: 'center', padding: '20px 0', fontSize: 12.5 }}>Нет доступных документов</div>}
        {filtered.map((c) => (
          <button
            type="button"
            key={c.doc_id}
            className={`cand${sel.has(c.doc_id) ? ' on' : ''}`}
            style={previewId === c.doc_id && !sel.has(c.doc_id) ? { boxShadow: 'inset 3px 0 0 var(--c-accent)' } : undefined}
            onClick={() => toggle(c.doc_id)}
            onMouseEnter={() => onHover(c.doc_id)}
            onFocus={() => onHover(c.doc_id)}
          >
            <span className="cand-cb">{sel.has(c.doc_id) && <Icon name="check" size={12} />}</span>
            <DateTile date={c.date} label={dateLabel} />
            <span className="cand-body">
              <span className="cand-client">{c.client ?? 'Без клиента'}</span>
              <span className="cand-sub">
                <span className="mono">{c.doc_number}</span>
                {c.sub && <><span>·</span><span>{c.sub}</span></>}
                <span className={`badge ${c.status_tone}`} style={{ marginLeft: 'auto' }}><span className="dot" />{c.status_label}</span>
              </span>
            </span>
          </button>
        ))}
      </div>
      <div className="picker-foot">
        <button type="button" className="btn" style={{ flex: 1 }} onClick={onCancel}>Отмена</button>
        <button type="button" className="btn primary" style={{ flex: 1 }} disabled={sel.size === 0} onClick={() => onAdd([...sel])}>Добавить ({sel.size})</button>
      </div>
    </div>
  )
}

/* ---------------- candidate preview (read-only, right pane) ---------------- */
function PreviewHint({ lex }: { lex: AllocLexicon }) {
  return (
    <div className="alloc-main">
      <div className="alloc-empty">
        <div className="alloc-empty-ico" />
        <h3>Наведите на документ</h3>
        <p>Наведите курсор на документ слева, чтобы увидеть его состав, затем добавьте {lex.docsGen} в рейс.</p>
      </div>
    </div>
  )
}

function PreviewPane({ doc, lines, onAdd, lex }: {
  doc: AllocDoc
  lines: AllocLine[] | undefined
  onAdd: () => void
  lex: AllocLexicon
}) {
  const t = useMemo(() => {
    let plan = 0, max = 0
    for (const l of lines ?? []) { plan += l.plan; max += l.max }
    return { plan, max }
  }, [lines])
  const hasStore = useMemo(() => (lines ?? []).some((l) => l.store), [lines])
  let prevKey: string | null = null
  return (
    <div className="alloc-main">
      <div className="main-head">
        <div className="main-head-row">
          <span className="badge" style={{ background: 'var(--c-bg-sunken)', color: 'var(--c-text-subtle)' }}><Icon name="eye" size={11} />Предпросмотр</span>
          <span className="main-head-client">{doc.client ?? 'Без клиента'}</span>
          <span className="mono subtle" style={{ fontSize: 12 }}>{doc.doc_number}</span>
          <span className={`badge ${doc.status_tone}`} style={{ marginLeft: 2 }}><span className="dot" />{doc.status_label}</span>
          {doc.date && <DateChip date={doc.date} label={lex.dateLabel} style={{ marginLeft: 'auto' }} />}
          <button type="button" className="btn primary sm" style={{ marginLeft: doc.date ? 8 : 'auto' }} onClick={onAdd}><Icon name="plus" size={13} /> Добавить в рейс</button>
        </div>
        <div className="main-stats">
          <div className="main-stat"><div className="main-stat-label">План</div><div className="main-stat-val">{t.plan}<span className="unit">шт</span></div></div>
          <div className="main-stat"><div className="main-stat-label">К распределению</div><div className="main-stat-val">{t.max}<span className="unit">шт</span></div></div>
          <div className="main-stat"><div className="main-stat-label">Позиций</div><div className="main-stat-val">{lines?.length ?? 0}</div></div>
        </div>
      </div>
      <div className="lines-scroll">
        {lines == null
          ? <div className="alloc-empty"><div className="alloc-empty-ico" /><h3>Загрузка состава…</h3><p /></div>
          : lines.length === 0
            ? <div className="alloc-empty"><div className="alloc-empty-ico" /><h3>Нет строк</h3><p>В документе нет позиций.</p></div>
            : (
              <table className="lt">
                <thead>
                  <tr>
                    <th style={{ width: 104 }}>SKU</th>
                    <th>Наименование</th>
                    <th style={{ width: 150 }}>Вариант</th>
                    {hasStore && <th style={{ width: 150 }}>Магазин</th>}
                    <th className="num" style={{ width: 66 }}>План</th>
                    <th className="num" style={{ width: 78 }}>Остаток</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const key = `${l.sku}${l.name}`
                    const groupStart = key !== prevKey
                    prevKey = key
                    return (
                      <tr key={l.line_id} className={groupStart ? 'group-start' : ''}>
                        <td><span className={`c-sku${groupStart ? '' : ' dim'}`}>{l.sku}</span></td>
                        <td><span className={`c-name${groupStart ? '' : ' dim'}`}>{l.name}</span></td>
                        <td>{l.variant && <span className="var-chip"><span className="var-sw" style={{ background: colorSwatch(l.color) }} />{l.variant}</span>}</td>
                        {hasStore && <td>{l.store ? <span className="c-name">{l.store}</span> : <span className="subtle">—</span>}</td>}
                        <td className="c-num">{l.plan}</td>
                        <td className="c-num"><span className="rem-cell"><span className={l.max === 0 ? 'rem-zero' : ''} style={{ fontWeight: l.max ? 500 : 400 }}>{l.max}</span></span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
      </div>
    </div>
  )
}

/* ---------------- root modal ---------------- */
export function AllocModal({ open, onClose, tripNumber, tripDestination, lex, linkedDocs, candidates, fetchLines, onConfirm, busy }: AllocModalProps) {
  const docMap = useMemo(() => {
    const m: Record<string, AllocDoc> = {}
    for (const d of [...linkedDocs, ...candidates]) m[d.doc_id] = d
    return m
  }, [linkedDocs, candidates])
  const initialLinkedIds = useMemo(() => linkedDocs.map((d) => d.doc_id), [linkedDocs])

  const [addedIds, setAddedIds] = useState<string[]>(initialLinkedIds)
  const [activeId, setActiveId] = useState<string | null>(initialLinkedIds[0] ?? null)
  const [query, setQuery] = useState('')
  const [picking, setPicking] = useState(false)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [qty, setQty] = useState<QtyMap>({})
  const [linesByDoc, setLinesByDoc] = useState<Record<string, AllocLine[]>>({})
  const [saving, setSaving] = useState(false)

  async function loadLines(docId: string) {
    if (linesByDoc[docId]) return
    try {
      const lines = await fetchLines(docId)
      setLinesByDoc((prev) => ({ ...prev, [docId]: lines }))
      setQty((prev) => {
        const next = { ...prev }
        for (const l of lines) if (next[l.line_id] == null) next[l.line_id] = l.preset != null ? l.preset : l.max
        return next
      })
    } catch {
      setLinesByDoc((prev) => ({ ...prev, [docId]: [] }))
    }
  }

  function openPicker() { setPicking(true); setPreviewId(null) }
  function closePicker() { setPicking(false); setPreviewId(null) }
  function preview(id: string) { setPreviewId(id); void loadLines(id) }

  // Загружаем строки всех уже привязанных документов при открытии (для прогресса в чипах)
  // и сразу показываем выбор документов рейса.
  useEffect(() => {
    if (!open) return
    openPicker()
    for (const id of initialLinkedIds) void loadLines(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const activeDoc = activeId && addedIds.includes(activeId) ? docMap[activeId] : null
  const activeLines = activeId ? linesByDoc[activeId] : undefined

  function setLineQty(lineId: string, v: number) { setQty((p) => ({ ...p, [lineId]: Math.max(0, v) })) }
  function fillAll() { if (!activeLines) return; setQty((p) => { const n = { ...p }; for (const l of activeLines) n[l.line_id] = l.max; return n }) }
  function clearAll() { if (!activeLines) return; setQty((p) => { const n = { ...p }; for (const l of activeLines) n[l.line_id] = 0; return n }) }

  function addDocs(ids: string[]) {
    setAddedIds((p) => [...p, ...ids])
    setActiveId(ids[0])
    closePicker()
    for (const id of ids) void loadLines(id)
  }
  function removeDoc(id: string) {
    setAddedIds((p) => { const n = p.filter((x) => x !== id); if (activeId === id) setActiveId(n[0] ?? null); return n })
  }
  function switchDoc(id: string) { setActiveId(id); setQuery(''); void loadLines(id) }

  const tripT = useMemo(() => {
    let q = 0, leftover = 0, over = 0, activeDocsCnt = 0
    const skus = new Set<string>()
    for (const id of addedIds) {
      const lines = linesByDoc[id]; if (!lines) continue
      let dq = 0
      for (const l of lines) {
        const v = qty[l.line_id] ?? 0
        q += Math.min(v, l.max); dq += Math.min(v, l.max)
        leftover += Math.max(l.max - v, 0)
        if (v > l.max) over++
        if (v > 0 && v <= l.max && l.sku) skus.add(l.sku)
      }
      if (dq > 0) activeDocsCnt++
    }
    return { q, leftover, over, skuCount: skus.size, docCount: activeDocsCnt }
  }, [addedIds, qty, linesByDoc])

  const sortedAddedIds = useMemo(
    () => [...addedIds].sort((a, b) => byClient(docMap[a], docMap[b])),
    [addedIds, docMap],
  )

  const canSubmit = tripT.over === 0 && tripT.q > 0 && !saving && !busy

  async function submit() {
    if (tripT.over !== 0 || tripT.q <= 0) return
    const items: AllocItem[] = addedIds.map((id) => {
      const lines = linesByDoc[id] ?? []
      const allocations = lines
        .map((l) => ({ line_id: l.line_id, qty: Math.min(qty[l.line_id] ?? 0, l.max) }))
        .filter((a) => a.qty > 0)
      return { doc_id: id, allocations }
    }).filter((it) => it.allocations.length > 0)
    const keepIds = new Set(items.map((it) => it.doc_id))
    const removedDocIds = initialLinkedIds.filter((id) => !keepIds.has(id))
    setSaving(true)
    try {
      await onConfirm(items, removedDocIds)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (picking) closePicker()
      else onClose()
    }
    if (open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, picking, onClose])

  if (!open) return null

  return (
    <div className="alloc-backdrop">
      <div className="alloc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="alloc-head">
          <div className="alloc-head-ico"><Icon name={lex.headerIcon} size={18} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="alloc-title">Распределение по рейсу</div>
            <div className="alloc-sub">Рейс <span className="mono" style={{ color: 'var(--c-text-muted)' }}>{tripNumber}</span> · черновик{tripDestination ? ` · ${tripDestination}` : ''}</div>
          </div>
          <button type="button" className="btn ghost icon sm" title="Закрыть" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>

        <div className="alloc-body">
          <div className="alloc-rail">
            <div className="rail-head">
              <span className="rail-head-title">Документы рейса · {addedIds.length}</span>
            </div>
            <div className="rail-list">
              {addedIds.length === 0 && <div className="subtle" style={{ fontSize: 12.5, padding: '8px 2px', textAlign: 'center' }}>Пусто. Добавьте документы ниже.</div>}
              {sortedAddedIds.map((id) => (
                <DocChip key={id} doc={docMap[id]} lines={linesByDoc[id]} qty={qty} active={id === activeId} onClick={() => switchDoc(id)} onRemove={() => removeDoc(id)} />
              ))}
            </div>
            <div className="rail-foot">
              <button type="button" className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={openPicker}><Icon name="plus" size={14} /> Добавить</button>
            </div>
            {picking && <Picker candidates={candidates} addedIds={addedIds} previewId={previewId} dateLabel={lex.dateLabel} onHover={preview} onCancel={closePicker} onAdd={addDocs} />}
          </div>

          {picking && previewId && docMap[previewId] && !addedIds.includes(previewId)
            ? <PreviewPane doc={docMap[previewId]} lines={linesByDoc[previewId]} onAdd={() => addDocs([previewId])} lex={lex} />
            : picking && !previewId && addedIds.length === 0
              ? <PreviewHint lex={lex} />
              : <MainPane doc={activeDoc} lines={activeLines} qty={qty} setQty={setLineQty} fillAll={fillAll} clearAll={clearAll} query={query} setQuery={setQuery} lex={lex} />}
        </div>

        <div className="alloc-foot">
          <div className="foot-totals">
            <div className="foot-stat">
              <span className="foot-stat-label">{lex.flowLabel}</span>
              <span className="foot-stat-val accent">{tripT.q}<span className="unit">шт</span></span>
            </div>
            <div className="foot-sep" />
            <div className="foot-stat">
              <span className="foot-stat-label">Остаётся нераспределённым</span>
              <span className="foot-stat-val">{tripT.leftover}<span className="unit">шт</span></span>
            </div>
            <div className="foot-sep" />
            <div className="foot-stat">
              <span className="foot-stat-label">Охват</span>
              <span className="foot-stat-val" style={{ fontSize: 13.5 }}>{tripT.docCount} док · {tripT.skuCount} SKU</span>
            </div>
          </div>
          <div className="foot-actions">
            {tripT.over > 0 && <span className="foot-warn"><Icon name="alert" size={13} /> Превышен остаток в {tripT.over} {tripT.over === 1 ? 'строке' : 'строках'}</span>}
            {tripT.over === 0 && tripT.q === 0 && <span className="subtle" style={{ fontSize: 12.5 }}>Укажите количества по строкам</span>}
            <button type="button" className="btn" onClick={onClose}>Отмена</button>
            <button type="button" className="btn primary" disabled={!canSubmit} onClick={submit}><Icon name="check" size={13} /> Сохранить распределение</button>
          </div>
        </div>
      </div>
    </div>
  )
}
