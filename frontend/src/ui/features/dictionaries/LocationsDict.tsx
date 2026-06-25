import { useCallback, useEffect, useState } from 'react'
import {
  bulkCreateLocations,
  deleteLocation,
  getLocationLabels,
  getLocations,
  type LocationItem,
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

// Печать QR-этикеток: отдельное окно, чтобы стили печати не пересекались с SPA.
// ОДНА этикетка = ОДНА страница (разрыв страницы после каждой) — под этикеточный
// принтер / поячеечную наклейку. На этикетке — QR (payload «wms:loc:<id>») и код.
function printLabels(labels: { code: string; qr_svg: string }[]) {
  const win = window.open('', '_blank', 'width=900,height=700')
  if (!win) return
  const cells = labels
    .map(
      (l) => `
      <div class="label">
        <div class="qr">${l.qr_svg}</div>
        <div class="code">${l.code}</div>
      </div>`,
    )
    .join('')
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR-этикетки мест</title>
    <style>
      * { box-sizing: border-box; }
      /* Физический размер этикетки = размер страницы, иначе драйвер масштабирует
         лист под мелкую этикетку и QR/код становятся крошечными. */
      @page { size: 58mm 40mm; margin: 0; }
      body { margin: 0; font-family: system-ui, sans-serif; }
      .toolbar { padding: 12px 16px; border-bottom: 1px solid #ddd; }
      .toolbar button { font-size: 14px; padding: 6px 14px; cursor: pointer; }
      .label {
        page-break-after: always; break-after: page;
        width: 58mm; height: 40mm; padding: 1.5mm;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        text-align: center; overflow: hidden;
      }
      .label:last-child { page-break-after: auto; break-after: auto; }
      .label .qr { line-height: 0; }
      .label .qr svg { width: 31mm; height: 31mm; display: block; }
      .label .code { margin-top: 0.8mm; font-weight: 700; font-size: 5.5mm; line-height: 1; letter-spacing: 0.5px; }
      @media screen { body { background: #f4f4f4; } .label { background: #fff; margin: 8px auto; box-shadow: 0 1px 4px rgba(0,0,0,.2); } }
      @media print { .toolbar { display: none; } }
    </style></head><body>
    <div class="toolbar"><button onclick="window.print()">Печать</button> &nbsp; Этикеток: ${labels.length} • размер 58×40 мм (по одной на этикетку). В диалоге печати выберите этот размер и масштаб 100% / «Реальный размер».</div>
    ${cells}
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

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const allSelected = items.length > 0 && items.every((l) => selected.has(l.id))
  const toggleAll = () =>
    setSelected((prev) => (items.every((l) => prev.has(l.id)) ? new Set() : new Set(items.map((l) => l.id))))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getLocations({ room: room.trim() || undefined, rack: rack.trim() || undefined, limit: 500 })
      setItems(res.items)
      setTotal(res.total)
      setSelected(new Set())
      onTotalLoaded(res.total)
      setLoadedOnce(true)
    } catch {
      setItems(EMPTY)
    } finally {
      setLoading(false)
    }
  }, [room, rack, onTotalLoaded])

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
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
      printLabels(res.items)
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
