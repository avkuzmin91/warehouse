import { useEffect, useState } from 'react'
import { getLocations } from '../../../api/locationsApi'
import type { LocationItem } from '../../../api/locationsApi'
import { getPendingPlacement, placeContainers } from '../../../api/containersApi'
import type { ContainerPendingPlacement } from '../../../api/containersApi'
import { useApi } from '../../../hooks/useApi'
import { useLookups } from '../../../hooks/useLookups'
import { Combobox } from '../../data/Combobox'
import { Checkbox } from '../../primitives/Checkbox'
import { Icon } from '../../primitives/Icon'
import { EmptyState } from '../../primitives/EmptyState'
import { useToast } from '../../feedback/Toast'
import { fmtDateTime } from '../../../utils/format'

type Props = {
  onPlaced: () => void
  /** Показать «у стола пусто» вместо пустоты: на собственном экране развозки скрывать нечего. */
  showEmpty?: boolean
}

/** Очередь развозки: что закрыто у стола и ещё не уехало в место хранения.
 *
 * Живёт своим экраном, а не в задаче размещения: задача заканчивается сборкой,
 * а развозку кладовщик везёт ходками — в одной ходке объекты разных задач. Обычно её
 * ведут сканером на ТСД, здесь — ручной путь, когда ТСД недоступен.
 *
 * Короба ходки отмечаются прямо здесь: выбор объектов и место назначения должны быть
 * в одном поле зрения, иначе внимание рвётся посреди операции.
 */
export function PendingPlacementPanel({ onPlaced, showEmpty = false }: Props) {
  const toast = useToast()
  const { unloadingZones } = useLookups()
  const [locations, setLocations] = useState<LocationItem[]>([])
  const [zoneId, setZoneId] = useState('')
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const { data } = useApi<ContainerPendingPlacement>(
    (signal) => getPendingPlacement(signal),
    [reloadKey],
  )

  useEffect(() => {
    let live = true
    getLocations({ limit: 500 })
      .then((r) => { if (live) setLocations(r.items.filter((i) => i.is_active)) })
      // Справочник мест доступен не всем ролям склада — тогда остаётся общий список зон.
      .catch(() => { if (live) setLocations([]) })
    return () => { live = false }
  }, [])

  // Уехавшие короба из очереди пропадают — держать их в выборке нельзя.
  useEffect(() => {
    if (!data) return
    setPicked((prev) => new Set([...prev].filter((id) => data.boxes.some((b) => b.id === id))))
  }, [data])

  const zoneOptions = locations.length > 0
    ? locations.map((l) => ({ value: l.id, label: l.code }))
    : unloadingZones.map((z) => ({ value: z.id, label: z.name }))

  if (!data || (data.boxes.length === 0 && data.aside.length === 0)) {
    if (!showEmpty || !data) return null
    return (
      <div className="card" style={{ padding: '28px 14px' }}>
        <EmptyState title="У стола пусто" sub="Всё собранное уже увезли в места хранения" />
      </div>
    )
  }

  async function place(payload: Parameters<typeof placeContainers>[0], done: string) {
    setBusy(true)
    try {
      const res = await placeContainers(payload)
      toast(`${done} → ${res.zone_name}`, 'success')
      setReloadKey((k) => k + 1)
      onPlaced()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось разместить', 'error')
    } finally {
      setBusy(false)
    }
  }

  const allPicked = data.boxes.length > 0 && data.boxes.every((b) => picked.has(b.id))
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(data.boxes.map((b) => b.id)))
  const toggleOne = (id: string) => setPicked((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return (
    <div className="card" style={{ padding: '12px 14px', marginBottom: 14 }}>
      <div className="row gap-8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Icon name="archive" size={15} style={{ color: 'var(--c-accent)' }} />
        <span style={{ fontWeight: 600 }}>Ждут развозки</span>
        <span className="t-sub">
          коробов <b className="num">{data.boxes.length}</b> ({data.boxes_qty} шт.)
          {data.aside_qty > 0 && <> · без короба <b className="num">{data.aside_qty}</b> шт.</>}
        </span>
        {data.since && (
          <span className="t-sub" style={{ fontSize: 12 }}>
            самый старый у стола с {fmtDateTime(data.since)}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <div style={{ minWidth: 220 }}>
          <Combobox
            options={zoneOptions}
            value={zoneId}
            onChange={(v) => setZoneId(String(v ?? ''))}
            placeholder="Место хранения"
          />
        </div>
        <button
          className="btn sm primary"
          disabled={busy || !zoneId || picked.size === 0}
          title={picked.size === 0 ? 'Отметьте короба, которые везёте в это место' : undefined}
          onClick={() => {
            void place(
              { zone_id: zoneId, box_ids: [...picked] },
              `Коробов размещено: ${picked.size}`,
            )
          }}
        >
          Разместить отмеченные ({picked.size})
        </button>
      </div>

      {data.boxes.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="row gap-8" style={{ alignItems: 'center', marginBottom: 6 }}>
            <button className="btn ghost sm" onClick={toggleAll}>
              {allPicked ? 'Снять выбор' : 'Выбрать все'}
            </button>
            <span className="t-sub" style={{ fontSize: 12 }}>закрытые короба у стола</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {data.boxes.map((b) => (
              <label
                key={b.id}
                className="row gap-8"
                style={{
                  alignItems: 'center', padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
                  background: picked.has(b.id) ? 'var(--c-bg-sunken)' : 'transparent',
                  border: '1px solid var(--c-border)', fontSize: 12.5,
                }}
              >
                <Checkbox checked={picked.has(b.id)} onChange={() => toggleOne(b.id)} />
                <span className="mono" style={{ fontWeight: 600 }}>{b.doc_number}</span>
                <span className="num">{b.items_qty}</span>
                {b.client_name && <span className="t-sub">{b.client_name}</span>}
              </label>
            ))}
          </div>
        </div>
      )}

      {data.aside.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="t-sub" style={{ fontSize: 12, marginBottom: 6 }}>
            Собрано без короба (габарит, брак) — короба у него нет, размещается позицией
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.aside.map((i) => (
              <div
                key={`${i.product_id}-${i.color_id ?? ''}-${i.size_id ?? ''}-${i.quality}`}
                className="row gap-8"
                style={{ alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 }}
              >
                <span className="mono">{i.product_sku ?? '—'}</span>
                <span className="t-sub">
                  {[i.product_name, i.color_name, i.size_name, i.client_name].filter(Boolean).join(' · ')}
                </span>
                <span className="num">{i.qty}</span>
                <span style={{ color: i.quality === 'defect' ? 'var(--c-danger)' : undefined }}>
                  {i.quality === 'defect' ? 'брак' : 'годный'}
                </span>
                <span style={{ flex: 1 }} />
                <button
                  className="btn sm"
                  disabled={busy || !zoneId}
                  title={!zoneId ? 'Сначала выберите место хранения' : undefined}
                  onClick={() => {
                    void place(
                      {
                        zone_id: zoneId,
                        items: [{
                          product_id: i.product_id,
                          color_id: i.color_id,
                          size_id: i.size_id,
                          quality: i.quality === 'defect' ? 'defect' : 'good',
                          qty: i.qty,
                        }],
                      },
                      `${i.qty} шт.`,
                    )
                  }}
                >
                  Разместить
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
