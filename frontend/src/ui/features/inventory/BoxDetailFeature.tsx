import { useCallback, useEffect, useState } from 'react'
import {
  getContainer,
  placeContainers,
  CONTAINER_STATUS_LABELS,
  containerStatusTone,
} from '../../../api/containersApi'
import type { ContainerDetailResponse } from '../../../api/containersApi'
import { BoxTransferDrawer, type BoxTransferMode } from './BoxTransferDrawer'
import { getLocations } from '../../../api/locationsApi'
import type { LocationItem } from '../../../api/locationsApi'
import { useLookups } from '../../../hooks/useLookups'
import { DetailPage } from '../../layouts/DetailPage'
import { Combobox } from '../../data/Combobox'
import { Card, CardHead } from '../../primitives/Card'
import { Badge } from '../../primitives/Badge'
import type { BadgeTone } from '../../primitives/Badge'
import { Icon } from '../../primitives/Icon'
import { EmptyState } from '../../primitives/EmptyState'
import { useToast } from '../../feedback/Toast'
import { MOSCOW_TZ, parseMoscow } from '../../../utils/format'

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = parseMoscow(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: MOSCOW_TZ })
}

/** Карточка короба: содержимое, история и ручные действия без ТСД.
 *
 * Основная работа с коробом идёт сканером (размещение и переносы пачкой), но склад
 * должен уметь то же самое руками: сканер сломался, короб потерялся, в содержимом
 * нашли пересорт. Поэтому здесь те же операции, что на ТСД, только с выбором места
 * из справочника.
 */
export function BoxDetailFeature({ boxId }: { boxId: string }) {
  const toast = useToast()
  const { unloadingZones } = useLookups()
  const [data, setData] = useState<ContainerDetailResponse | null>(null)
  const [locations, setLocations] = useState<LocationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [busy, setBusy] = useState(false)
  const [transfer, setTransfer] = useState<BoxTransferMode | null>(null)

  const load = useCallback((signal?: AbortSignal) => {
    setError('')
    return getContainer(boxId, signal)
      .then((r) => { if (!signal?.aborted) setData(r) })
      .catch((e) => { if (!signal?.aborted) setError(e instanceof Error ? e.message : 'Не удалось загрузить короб') })
      .finally(() => { if (!signal?.aborted) setLoading(false) })
  }, [boxId])

  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [load])

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

  const box = data?.doc
  const contents = data?.contents ?? []
  const ops = data?.ops ?? []

  async function handlePlace() {
    if (!box || !zoneId) return
    setBusy(true)
    try {
      const res = await placeContainers({ zone_id: zoneId, box_ids: [box.id] })
      toast(`Короб ${box.doc_number} → ${res.zone_name}`, 'success')
      setZoneId('')
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось разместить короб', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <DetailPage title="Короб" backTo="/inventory/boxes"><Card>Загрузка…</Card></DetailPage>
  }
  if (error || !box) {
    return (
      <DetailPage title="Короб" backTo="/inventory/boxes">
        <EmptyState title={error || 'Короб не найден'} />
      </DetailPage>
    )
  }

  const canPlace = box.status === 'closed' || box.status === 'placed'

  return (
    <DetailPage
      title={box.doc_number}
      subtitle={box.doc_number_task ? `Собран в задаче ${box.doc_number_task}` : 'Короб'}
      backTo="/inventory/boxes"
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card>
            <CardHead>
              <span>Содержимое</span>
              <span style={{ flex: 1 }} />
              <span className="t-sub">{box.items_qty} шт.</span>
              {box.status === 'placed' && (
                <button
                  className="btn sm ghost"
                  disabled={busy}
                  title="Со стола или с полки — в этот короб. Короб однороден по качеству."
                  onClick={() => setTransfer({ kind: 'add' })}
                >
                  <Icon name="plus" size={13} /> Доложить товар
                </button>
              )}
            </CardHead>
            {contents.length === 0 ? (
              <div className="t-sub" style={{ padding: '8px 2px' }}>Короб пуст.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {contents.map((c) => {
                  const label = [c.product_name, c.color_name, c.size_name].filter(Boolean).join(' · ')
                  return (
                    <div key={`${c.product_id}-${c.color_id ?? ''}-${c.size_id ?? ''}-${c.quality}`}
                      className="row gap-8" style={{ alignItems: 'center' }}>
                      <span className="mono">{c.product_sku ?? '—'}</span>
                      <span className="t-sub">{label}</span>
                      {c.quality === 'defect' && (
                        <span style={{ color: 'var(--c-danger)', fontSize: 12 }}>брак</span>
                      )}
                      <span style={{ flex: 1 }} />
                      <span className="num">{c.qty}</span>
                      {box.status === 'placed' && (
                        <button
                          className="btn sm ghost"
                          disabled={busy}
                          title="На эту же полку, в другое место или в другой короб"
                          onClick={() => setTransfer({ kind: 'remove', line: c })}
                        >
                          Изъять
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Card>

          <Card>
            <CardHead>История</CardHead>
            {ops.length === 0 ? (
              <div className="t-sub" style={{ padding: '8px 2px' }}>Записей нет.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {ops.map((o) => (
                  <div key={o.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div className="row gap-8" style={{ fontSize: 13 }}>
                      <span>{o.comment ?? o.op_type}</span>
                      {o.qty != null && <span className="num t-sub">{o.qty} шт.</span>}
                    </div>
                    <div className="t-sub" style={{ fontSize: 12 }}>
                      {fmtDateTime(o.created_at)}
                      {o.created_by_name ? ` · ${o.created_by_name}` : ''}
                      {o.product_name ? ` · ${o.product_name}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card>
            <CardHead>Короб</CardHead>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 2px' }}>
              <div className="row gap-8">
                <span className="t-sub">Статус</span>
                <span style={{ flex: 1 }} />
                <Badge tone={containerStatusTone(box.status) as BadgeTone}>
                  {CONTAINER_STATUS_LABELS[box.status]}
                </Badge>
              </div>
              <div className="row gap-8">
                <span className="t-sub">Место</span>
                <span style={{ flex: 1 }} />
                <span>{box.zone_name ?? '—'}</span>
              </div>
              <div className="row gap-8">
                <span className="t-sub">Клиент</span>
                <span style={{ flex: 1 }} />
                <span>{box.client_name ?? '—'}</span>
              </div>
              <div className="row gap-8">
                <span className="t-sub">Закрыт</span>
                <span style={{ flex: 1 }} />
                <span>{fmtDateTime(box.closed_at)}</span>
              </div>
              <div className="row gap-8">
                <span className="t-sub">Размещён</span>
                <span style={{ flex: 1 }} />
                <span>{fmtDateTime(box.placed_at)}</span>
              </div>
            </div>
          </Card>

          {transfer && (
            <BoxTransferDrawer
              box={box}
              mode={transfer}
              zoneOptions={zoneOptions}
              onClose={() => setTransfer(null)}
              onDone={() => { setTransfer(null); void load() }}
            />
          )}

          {canPlace && (
            <Card>
              <CardHead>{box.status === 'closed' ? 'Разместить' : 'Переместить'}</CardHead>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Combobox
                  options={zoneOptions}
                  value={zoneId}
                  onChange={(v) => setZoneId(String(v ?? ''))}
                  placeholder="Место хранения"
                />
                <button className="btn primary" disabled={busy || !zoneId} onClick={() => { void handlePlace() }}>
                  <Icon name="archive" size={14} />
                  {box.status === 'closed' ? 'Разместить' : 'Переместить'}
                </button>
                <div className="t-sub" style={{ fontSize: 12 }}>
                  Обычно это делают сканером на ТСД; здесь — когда сканера нет под рукой.
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </DetailPage>
  )
}
