import { useEffect, useState } from 'react'
import { getLocations } from '../../../api/locationsApi'
import type { LocationItem } from '../../../api/locationsApi'
import { getPendingPlacement, placeContainers } from '../../../api/containersApi'
import type { ContainerPendingPlacement } from '../../../api/containersApi'
import { useApi } from '../../../hooks/useApi'
import { useLookups } from '../../../hooks/useLookups'
import { Combobox } from '../../data/Combobox'
import { Icon } from '../../primitives/Icon'
import { useToast } from '../../feedback/Toast'
import { fmtDateTime } from '../../../utils/format'

type Props = {
  /** Короба, отмеченные в списке: их можно увезти одной ходкой. */
  selectedBoxIds: string[]
  onPlaced: () => void
}

/** Очередь развозки: что закрыто у стола и ещё не уехало в место хранения.
 *
 * Живёт на странице коробов, а не в задаче размещения: задача заканчивается сборкой,
 * а развозку кладовщик везёт ходками — в одной ходке объекты разных задач. Обычно её
 * ведут сканером на ТСД, здесь — ручной путь, когда ТСД недоступен.
 */
export function PendingPlacementPanel({ selectedBoxIds, onPlaced }: Props) {
  const toast = useToast()
  const { unloadingZones } = useLookups()
  const [locations, setLocations] = useState<LocationItem[]>([])
  const [zoneId, setZoneId] = useState('')
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

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

  const zoneOptions = locations.length > 0
    ? locations.map((l) => ({ value: l.id, label: l.code }))
    : unloadingZones.map((z) => ({ value: z.id, label: z.name }))

  if (!data || (data.boxes.length === 0 && data.aside.length === 0)) return null

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

  const boxesToMove = selectedBoxIds.filter((id) => data.boxes.some((b) => b.id === id))

  return (
    <div className="card" style={{ padding: '12px 14px', marginBottom: 14 }}>
      <div className="row gap-8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Icon name="archive" size={15} style={{ color: 'var(--c-accent)' }} />
        <span style={{ fontWeight: 600 }}>Ждут развозки</span>
        <span className="t-sub">
          коробов <b className="num">{data.boxes.length}</b> ({data.boxes_qty} шт.)
          {data.aside_qty > 0 && <> · мимо коробов <b className="num">{data.aside_qty}</b> шт.</>}
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
          disabled={busy || !zoneId || boxesToMove.length === 0}
          title={boxesToMove.length === 0
            ? 'Отметьте в списке короба, которые везёте в это место'
            : undefined}
          onClick={() => {
            void place(
              { zone_id: zoneId, box_ids: boxesToMove },
              `Коробов размещено: ${boxesToMove.length}`,
            )
          }}
        >
          Разместить отмеченные ({boxesToMove.length})
        </button>
      </div>

      {data.aside.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="t-sub" style={{ fontSize: 12, marginBottom: 6 }}>
            Собрано мимо коробов (габарит, брак) — короба у него нет, размещается позицией
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
