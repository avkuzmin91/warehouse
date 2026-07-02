import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import {
  bulkCreateLocations,
  deleteLocation,
  getLocationLabels,
  getLocations,
  type LocationItem,
  type LocationLabel,
} from '../../../api/locationsApi'
import type { DictionaryItem } from '../../../api/domainTypes'
import { Icon } from '../../primitives/Icon'
import { Badge } from '../../primitives/Badge'
import { Checkbox } from '../../primitives/Checkbox'
import { EmptyState } from '../../primitives/EmptyState'
import { Modal } from '../../feedback/Modal'
import { useToast } from '../../feedback/Toast'
import { useConfirm } from '../../feedback/ConfirmDialog'
import { useLookups } from '../../../hooks/useLookups'
import { SimpleDictSheet } from './SimpleDictSheet'

// Место хранения = строка unloading_zones; редактирование (имя/архив/роли зон)
// переиспользует общую шторку справочника. Адрес у ячеек не редактируем здесь.
function locToDictItem(loc: LocationItem): DictionaryItem {
  return {
    id: loc.id,
    name: loc.code,
    is_packing_zone: loc.is_packing_zone,
    is_shipping_zone: loc.is_shipping_zone,
    is_active: loc.is_active,
    is_deleted: loc.is_deleted,
    created_at: loc.created_at,
    created_by: null,
    updated_at: null,
    updated_by: null,
  }
}

interface LocationsDictProps {
  refreshKey: number
  onTotalLoaded: (total: number) => void
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

// Печать QR-этикеток: отдельное окно, чтобы стили печати не пересекались с SPA.
// ОДНА этикетка = ОДНА страница (разрыв страницы после каждой) — под этикеточный
// принтер / поячеечную наклейку. Лента остаётся 58×40 мм, но макет ВЕРТИКАЛЬНЫЙ:
// контент повёрнут на 90° внутри страницы, наклейка клеится на стойку стеллажа.
// Сверху QR, ниже код + адрес, внизу стрелка на ячейку. Направление стрелки
// (слева-направо / справа-налево) пользователь выбирает перед печатью; для ячеек
// 3-го этажа и выше стрелка идёт по диагонали вверх с наклоном в выбранную сторону.
// У служебных зон (kind='special') стрелки/адреса нет — только QR и имя.

export type LabelArrowDir = 'right' | 'left'

// Стрелка направления: скруглённый стержень + сплошной наконечник (как в макете).
// up=true — диагональ вверх (этаж ≥ 3), left=true — зеркало (ячейка слева).
function arrowSvg(up: boolean, left: boolean): string {
  const shapes =
    '<line class="shaft" x1="6" y1="20" x2="112" y2="20"/>' +
    '<path class="head" d="M108 4 L146 20 L108 36 Z"/>'
  let g = up ? `<g transform="rotate(-30 75 20)">${shapes}</g>` : shapes
  if (left) g = `<g transform="translate(150 0) scale(-1 1)">${g}</g>`
  const viewBox = up ? '0 -40 150 105' : '0 0 150 40'
  return `<svg class="bigarw${up ? ' up' : ''}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${g}</svg>`
}

function arrowCaption(up: boolean, left: boolean): string {
  const side = left ? 'слева' : 'справа'
  return up ? `ячейка<br>сверху ${side}` : `ячейка<br>${side}`
}

function labelMeta(l: LocationLabel): string {
  if (!l.room) return ''
  const parts = [`Пом.${l.room}`]
  if (l.rack) parts.push(`Ст.${l.rack}`)
  if (l.section) parts.push(`Сек.${l.section}`)
  if (l.floor) parts.push(`Эт.${l.floor}`)
  return parts.join('·')
}

function printLabels(labels: LocationLabel[], dir: LabelArrowDir) {
  const win = window.open('', '_blank', 'width=900,height=700')
  if (!win) return
  const left = dir === 'left'
  const cells = labels
    .map((l) => {
      if (l.kind !== 'cell') {
        return `
      <div class="label special">
        <div class="rot center">
          <div class="qr">${l.qr_svg}</div>
          <div class="code sp">${escapeHtml(l.code)}</div>
        </div>
      </div>`
      }
      const meta = labelMeta(l)
      const up = Number(l.floor) >= 3
      return `
      <div class="label cell">
        <div class="rot">
          <div class="qr">${l.qr_svg}</div>
          <div class="code">${escapeHtml(l.code)}</div>
          ${meta ? `<div class="meta">${escapeHtml(meta)}</div>` : ''}
          <div class="cdiv"></div>
          <div class="arrow-zone">${arrowSvg(up, left)}<span class="arrow-cap">${arrowCaption(up, left)}</span></div>
        </div>
      </div>`
    })
    .join('')
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title></title>
    <style>
      /* Клейкий шрифт проекта: моноширинный «чистый ноль» (RobotoMonoCZ, без слэша). */
      @font-face { font-family:'Roboto Mono'; font-style:normal; font-weight:400; font-display:swap; src:url(/fonts/L0x5DF4xlVMF-BfR8bXMIjhPq3-OXg.woff2) format('woff2'); unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116; }
      @font-face { font-family:'Roboto Mono'; font-style:normal; font-weight:400; font-display:swap; src:url(/fonts/RobotoMonoCZ-latin-400.woff2) format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+2000-206F,U+2212,U+2215; }
      @font-face { font-family:'Roboto Mono'; font-style:normal; font-weight:500; font-display:swap; src:url(/fonts/L0x5DF4xlVMF-BfR8bXMIjhPq3-OXg.woff2) format('woff2'); unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116; }
      @font-face { font-family:'Roboto Mono'; font-style:normal; font-weight:500; font-display:swap; src:url(/fonts/RobotoMonoCZ-latin-500.woff2) format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+2000-206F,U+2212,U+2215; }
      @page { size: 58mm 40mm; margin: 0mm; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      html, body { margin: 0; padding: 0; font-family: 'Roboto Mono', ui-monospace, monospace; background: #fff; color: #000; }
      .toolbar {
        padding: 12px 16px;
        border-bottom: 1px solid #ddd;
        font-family: system-ui, sans-serif;
        color: #111;
      }
      .toolbar button { font-size: 14px; padding: 6px 14px; cursor: pointer; }
      .label {
        width: 58mm;
        height: 40mm;
        position: relative;
        overflow: hidden;
        background: #fff;
        color: #000;
        break-after: page;
        page-break-after: always;
      }
      .label:last-child { page-break-after: auto; break-after: auto; }
      /* Вертикальный макет: лента 58×40, контент повёрнут на 90° — наклейка
         клеится на стойку стеллажа боком, читается как 40×58 (портрет). */
      .rot {
        position: absolute;
        top: 0;
        left: 0;
        width: 40mm;
        height: 58mm;
        transform-origin: 0 0;
        transform: translateX(58mm) rotate(90deg);
        padding: 3mm 3mm 2.5mm;
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .rot.center { justify-content: center; gap: 2mm; }
      .label .qr { width: 18mm; height: 18mm; flex: 0 0 auto; line-height: 0; }
      .label .qr svg { width: 100%; height: 100%; display: block; }
      .code {
        width: 100%;
        text-align: center;
        font-weight: 700;
        font-size: 5mm;
        line-height: 1;
        letter-spacing: 0.02em;
        white-space: nowrap;
        overflow: hidden;
        margin-top: 1.8mm;
      }
      .code.sp { font-size: 3.4mm; white-space: normal; line-height: 1.15; margin-top: 0; }
      .meta {
        width: 100%;
        text-align: center;
        font-size: 2.2mm;
        font-weight: 500;
        letter-spacing: 0.01em;
        text-transform: uppercase;
        opacity: 0.72;
        margin-top: 1.4mm;
        white-space: nowrap;
        overflow: hidden;
      }
      .cdiv { width: 100%; height: 0.2mm; background: #000; opacity: 0.35; margin: 1.8mm 0 1.4mm; }
      .arrow-zone {
        flex: 1;
        width: 100%;
        min-height: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1.2mm;
      }
      .bigarw { width: 26mm; height: 5mm; flex: 0 0 auto; }
      .bigarw.up { width: 24mm; height: 15mm; }
      .bigarw .shaft { stroke: #000; stroke-width: 7; stroke-linecap: round; }
      .bigarw .head { fill: #000; }
      .arrow-cap {
        text-align: center;
        font-size: 1.7mm;
        font-weight: 700;
        letter-spacing: 0.06em;
        line-height: 1.1;
        text-transform: uppercase;
        white-space: nowrap;
      }
      @media screen {
        body { background: #f4f4f4; }
        .label { margin: 8px auto; box-shadow: 0 1px 4px rgba(0,0,0,.2); }
      }
      @media print {
        html, body {
          width: 58mm;
          min-width: 58mm;
          margin: 0 !important;
          padding: 0 !important;
          background: #fff !important;
          overflow: visible;
        }
        .toolbar { display: none !important; }
        .label {
          width: 58mm !important;
          height: 40mm !important;
          margin: 0 !important;
          box-shadow: none !important;
          break-inside: avoid;
          page-break-inside: avoid;
        }
      }
    </style></head><body>
    <div class="toolbar"><button onclick="window.print()">Печать</button> &nbsp; Этикеток: ${labels.length} • лента 58×40 мм, макет вертикальный • стрелка ${left ? 'справа-налево' : 'слева-направо'} • масштаб 100% / «Реальный размер».</div>
    ${cells}
    <script>
      function fit(el, minPx, step) {
        let px = parseFloat(getComputedStyle(el).fontSize);
        while (el.scrollWidth > el.clientWidth && px > minPx) { px -= step; el.style.fontSize = px + 'px'; }
      }
      function fitLabels() {
        document.querySelectorAll('.label.cell .code').forEach((el) => fit(el, 13, 0.5));
        document.querySelectorAll('.label.cell .meta').forEach((el) => fit(el, 6.5, 0.3));
      }
      window.addEventListener('load', () => {
        const go = () => { fitLabels(); setTimeout(() => window.print(), 120); };
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(go); else go();
      })
    </script>
    </body></html>`)
  win.document.close()
}

const EMPTY: LocationItem[] = []

export function LocationsDict({ refreshKey, onTotalLoaded }: LocationsDictProps) {
  const toast = useToast()
  const confirm = useConfirm()
  const { reload: reloadLookups } = useLookups()
  const [items, setItems] = useState<LocationItem[]>(EMPTY)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [room, setRoom] = useState('')
  const [rack, setRack] = useState('')
  const [genOpen, setGenOpen] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [sheet, setSheet] = useState<{ isNew: boolean; initial: DictionaryItem | null } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dirLabels, setDirLabels] = useState<LocationLabel[] | null>(null)

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const allSelected = items.length > 0 && items.every((l) => selected.has(l.id))
  const toggleAll = () =>
    setSelected((prev) => (items.every((l) => prev.has(l.id)) ? new Set() : new Set(items.map((l) => l.id))))

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    try {
      const res = await getLocations({ room: room.trim() || undefined, rack: rack.trim() || undefined, limit: 500 }, signal)
      if (signal?.aborted) return
      setItems(res.items)
      setTotal(res.total)
      setSelected(new Set())
      onTotalLoaded(res.total)
      setLoadedOnce(true)
    } catch {
      if (signal?.aborted) return
      setItems(EMPTY)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [room, rack, onTotalLoaded])

  useEffect(() => {
    const ctrl = new AbortController()
    const t = setTimeout(() => void load(ctrl.signal), 250)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [load, refreshKey])

  const onDelete = async (loc: LocationItem) => {
    const ok = await confirm({
      title: 'Удалить место?',
      body: `«${loc.code}» будет удалено из справочника.`,
      danger: true,
      confirmLabel: 'Удалить',
    })
    if (!ok) return
    try {
      await deleteLocation(loc.id)
      toast('Место удалено', 'success')
      void load()
      reloadLookups()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось удалить', 'error')
    }
  }

  const onPrint = async () => {
    setPrinting(true)
    try {
      // Есть выбор галочками — печатаем только выбранные места; иначе — по фильтру (ячейки).
      const params = selected.size
        ? { ids: [...selected] }
        : { room: room.trim() || undefined, rack: rack.trim() || undefined }
      const res = await getLocationLabels(params)
      if (!res.items.length) {
        toast(selected.size ? 'Не удалось получить выбранные этикетки' : 'Нет ячеек для печати по текущему фильтру', 'info')
        return
      }
      // У служебных зон стрелки нет — направление спрашиваем только если есть ячейки.
      if (res.items.some((l) => l.kind === 'cell')) setDirLabels(res.items)
      else printLabels(res.items, 'right')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось получить этикетки', 'error')
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="t-wrap">
      <div className="card-head">
        <div className="card-head-title">Места хранения</div>
        <div className="right row gap-8">
          {loading && loadedOnce && <span className="text-xs subtle">Обновление...</span>}
          <input
            className="input sm"
            style={{ width: 110 }}
            placeholder="Помещение"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
          />
          <input
            className="input sm"
            style={{ width: 90 }}
            placeholder="Стеллаж"
            value={rack}
            onChange={(e) => setRack(e.target.value)}
          />
          <button className="btn" disabled={printing} onClick={() => void onPrint()}>
            <Icon name="print" size={14} />
            {printing ? '…' : selected.size ? `Печать QR (${selected.size})` : 'Печать QR'}
          </button>
          <button className="btn" onClick={() => setSheet({ isNew: true, initial: null })}>
            <Icon name="plus" size={14} />
            Добавить место
          </button>
          <button className="btn primary" onClick={() => setGenOpen(true)}>
            <Icon name="grid" size={14} />
            Сгенерировать ячейки
          </button>
        </div>
      </div>

      <table className="t">
        <thead>
          <tr>
            <th style={{ width: 30 }}>
              <Checkbox checked={allSelected} onChange={toggleAll} />
            </th>
            <th>Адрес</th>
            <th style={{ width: 110 }}>Помещение</th>
            <th style={{ width: 90 }}>Стеллаж</th>
            <th style={{ width: 90 }}>Секция</th>
            <th style={{ width: 80 }}>Этаж</th>
            <th style={{ width: 100 }}>Статус</th>
            <th style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {loading && !loadedOnce ? (
            <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24 }}>
              <span className="text-sm muted">Загрузка…</span>
            </td></tr>
          ) : items.length === 0 ? (
            <tr><td colSpan={8} style={{ padding: 32 }}>
              <EmptyState title="Нет мест" sub="Сгенерируйте адресные ячейки или добавьте служебную зону" />
            </td></tr>
          ) : (
            items.map((loc) => (
              <tr key={loc.id} onClick={() => setSheet({ isNew: false, initial: locToDictItem(loc) })} style={{ cursor: 'pointer' }}>
                <td onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={selected.has(loc.id)} onChange={() => toggleOne(loc.id)} />
                </td>
                <td className="mono" style={{ fontWeight: 600 }}>
                  {loc.code}
                  {loc.is_packing_zone && <Badge tone="info" style={{ marginLeft: 8 }}>Зона упаковки</Badge>}
                  {loc.is_shipping_zone && <Badge tone="warning" style={{ marginLeft: 8 }}>Зона отгрузки</Badge>}
                </td>
                <td className="text-sm">{loc.room ?? '—'}</td>
                <td className="text-sm">{loc.rack ?? '—'}</td>
                <td className="text-sm">{loc.section ?? '—'}</td>
                <td className="text-sm">{loc.floor ?? '—'}</td>
                <td>
                  <Badge tone={loc.is_active ? 'success' : ''} dot>
                    {loc.is_active ? 'Активно' : 'Архив'}
                  </Badge>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <button className="btn ghost icon sm" onClick={() => void onDelete(loc)}>
                    <Icon name="trash" size={14} />
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {total > items.length && (
        <div className="text-xs subtle" style={{ padding: '8px 12px' }}>
          Показаны первые {items.length} из {total}. Сузьте фильтр по помещению/стеллажу.
        </div>
      )}

      <GenerateCellsModal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        onDone={() => { setGenOpen(false); void load(); reloadLookups() }}
      />

      <ArrowDirModal
        labels={dirLabels}
        onClose={() => setDirLabels(null)}
        onPick={(dir) => {
          if (dirLabels) printLabels(dirLabels, dir)
          setDirLabels(null)
        }}
      />

      {sheet && (
        <SimpleDictSheet
          open
          onClose={() => setSheet(null)}
          onSaved={() => { void load(); reloadLookups() }}
          isNew={sheet.isNew}
          kind="Место хранения"
          apiType="unloading-zones"
          initial={sheet.initial}
        />
      )}
    </div>
  )
}

function ArrowDirModal({
  labels,
  onClose,
  onPick,
}: {
  labels: LocationLabel[] | null
  onClose: () => void
  onPick: (dir: LabelArrowDir) => void
}) {
  const hasUpper = (labels ?? []).some((l) => l.kind === 'cell' && Number(l.floor) >= 3)
  const dirBtn: CSSProperties = {
    flex: 1,
    display: 'grid',
    justifyItems: 'center',
    gap: 6,
    padding: '14px 10px',
    height: 'auto',
  }
  return (
    <Modal
      open={labels !== null}
      onClose={onClose}
      title="Направление стрелки"
      subtitle="Наклейка клеится на стойку — стрелка указывает, с какой стороны ячейка"
      width={420}
      footer={
        <div className="row gap-8" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>Отмена</button>
        </div>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="row gap-8">
          <button className="btn" style={dirBtn} onClick={() => onPick('right')}>
            <span style={{ fontSize: 26, lineHeight: 1 }}>→</span>
            <span>Слева направо</span>
            <span className="text-xs subtle">ячейка справа от наклейки</span>
          </button>
          <button className="btn" style={dirBtn} onClick={() => onPick('left')}>
            <span style={{ fontSize: 26, lineHeight: 1 }}>←</span>
            <span>Справа налево</span>
            <span className="text-xs subtle">ячейка слева от наклейки</span>
          </button>
        </div>
        {hasUpper && (
          <div className="text-xs subtle">
            Для ячеек 3-го этажа и выше стрелка будет направлена вверх с наклоном в выбранную сторону.
          </div>
        )}
      </div>
    </Modal>
  )
}

function GenerateCellsModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [room, setRoom] = useState('')
  const [racks, setRacks] = useState('')
  const [sections, setSections] = useState('10')
  const [floors, setFloors] = useState('3')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) { setRoom(''); setRacks(''); setSections('10'); setFloors('3') }
  }, [open])

  const racksList = racks.split(/[\s,]+/).map((r) => r.trim()).filter(Boolean)
  const sectionsN = Number(sections)
  const floorsN = Number(floors)
  const valid =
    room.trim() !== '' && racksList.length > 0 &&
    Number.isInteger(sectionsN) && sectionsN >= 1 && sectionsN <= 99 &&
    Number.isInteger(floorsN) && floorsN >= 1 && floorsN <= 9
  const preview = valid ? racksList.length * sectionsN * floorsN : 0

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    try {
      const res = await bulkCreateLocations({
        room: room.trim(),
        racks: racksList,
        sections: sectionsN,
        floors: floorsN,
      })
      toast(`Создано ячеек: ${res.created}${res.skipped ? `, пропущено (уже были): ${res.skipped}` : ''}`, 'success')
      onDone()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось сгенерировать', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Генерация ячеек"
      subtitle="Адрес: Помещение-Стеллаж-Секция-Этаж (например 1-А-10-1)"
      width={460}
      footer={
        <div className="row gap-8" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!valid || busy} onClick={() => void submit()}>
            {busy ? 'Создание…' : `Создать${preview ? ` ${preview} шт.` : ''}`}
          </button>
        </div>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="text-sm">Помещение</span>
          <input className="input" placeholder="1" value={room} onChange={(e) => setRoom(e.target.value)} />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="text-sm">Стеллажи <span className="subtle">(через запятую или пробел)</span></span>
          <input className="input" placeholder="А, Б, В" value={racks} onChange={(e) => setRacks(e.target.value)} />
        </label>
        <div className="row gap-8">
          <label style={{ display: 'grid', gap: 4, flex: 1 }}>
            <span className="text-sm">Секций (1…N)</span>
            <input className="input" inputMode="numeric" value={sections} onChange={(e) => setSections(e.target.value)} />
          </label>
          <label style={{ display: 'grid', gap: 4, flex: 1 }}>
            <span className="text-sm">Этажей (1…N)</span>
            <input className="input" inputMode="numeric" value={floors} onChange={(e) => setFloors(e.target.value)} />
          </label>
        </div>
        <div className="text-xs subtle">
          Секция дополняется нулём (01…), повторный запуск дозаполняет недостающие ячейки и не дублирует существующие.
        </div>
      </div>
    </Modal>
  )
}
