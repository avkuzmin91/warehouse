import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  getContainer,
  getContainerLabels,
  placeContainers,
  CONTAINER_STATUS_LABELS,
  containerStatusTone,
} from '../../../api/containersApi'
import type { ContainerDetailResponse } from '../../../api/containersApi'
import { BoxTransferDrawer, type BoxTransferMode } from './BoxTransferDrawer'
import { BoxContents } from './boxDetail/BoxContents'
import { BoxHistory } from './boxDetail/BoxHistory'
import { printBoxLabels, POPUP_BLOCKED_HINT } from './boxLabels'
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
import { MOSCOW_TZ, fmtDurationShort, parseMoscow } from '../../../utils/format'

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = parseMoscow(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: MOSCOW_TZ })
}

/** «стоит здесь 3 дн» — возраст важнее точной секунды: по нему видно залежавшийся короб. */
function ageHint(iso: string | null): string | null {
  if (!iso) return null
  const d = parseMoscow(iso)
  if (Number.isNaN(d.getTime())) return null
  const ms = Date.now() - d.getTime()
  return ms < 60_000 ? null : fmtDurationShort(ms)
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="row gap-8" style={{ alignItems: 'baseline' }}>
      <span className="t-sub">{label}</span>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 13, textAlign: 'right' }}>{children}</span>
    </div>
  )
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
  const [moveOpen, setMoveOpen] = useState(false)
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
      setMoveOpen(false)
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось разместить короб', 'error')
    } finally {
      setBusy(false)
    }
  }

  // Этикетка рвётся и затирается прямо на складе: перепечатка нужна из карточки того
  // короба, что держат в руках, а не через выборку в списке.
  async function handlePrintLabel() {
    if (!box) return
    setBusy(true)
    try {
      const res = await getContainerLabels([box.id])
      if (!printBoxLabels(res.items)) toast(POPUP_BLOCKED_HINT, 'error')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось получить этикетку', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <DetailPage title="Короб" backTo="/inventory/boxes"><Card><div style={{ padding: 14 }}>Загрузка…</div></Card></DetailPage>
  }
  if (error || !box) {
    return (
      <DetailPage title="Короб" backTo="/inventory/boxes">
        <EmptyState title={error || 'Короб не найден'} />
      </DetailPage>
    )
  }

  const needsPlacement = box.status === 'closed'
  const canMove = box.status === 'placed'
  const placedAge = ageHint(box.placed_at)
  const quality: 'good' | 'defect' | 'mixed' | null = contents.length === 0
    ? null
    : contents.every((c) => c.quality === 'defect')
      ? 'defect'
      : contents.every((c) => c.quality === 'good') ? 'good' : 'mixed'

  return (
    <DetailPage
      title={box.doc_number}
      backTo="/inventory/boxes"
      actions={
        <>
          <Badge tone={containerStatusTone(box.status) as BadgeTone}>
            {CONTAINER_STATUS_LABELS[box.status]}
          </Badge>
          <button className="btn" disabled={busy} onClick={() => { void handlePrintLabel() }}>
            <Icon name="print" size={14} />Печать этикетки
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <BoxContents
            box={box}
            contents={contents}
            busy={busy}
            onAdd={() => setTransfer({ kind: 'add' })}
            onRemove={(line) => setTransfer({ kind: 'remove', line })}
          />
          <BoxHistory ops={ops} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {needsPlacement && (
            <Card>
              <CardHead>
                <span className="card-head-title">Разместить</span>
                <span style={{ flex: 1 }} />
                <span className="t-sub">ждёт развозки</span>
              </CardHead>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 14 }}>
                <Combobox
                  options={zoneOptions}
                  value={zoneId}
                  onChange={(v) => setZoneId(String(v ?? ''))}
                  placeholder="Место хранения"
                />
                <button className="btn primary" disabled={busy || !zoneId} onClick={() => { void handlePlace() }}>
                  <Icon name="archive" size={14} />Разместить
                </button>
                <div className="t-sub">
                  Обычно короба развозят сканером на ТСД пачкой; здесь — когда сканера нет под рукой.
                </div>
              </div>
            </Card>
          )}

          <Card>
            <CardHead><span className="card-head-title">Короб</span></CardHead>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: 14 }}>
              <InfoRow label="Качество">
                {quality === 'defect' ? <Badge tone="danger">Брак</Badge>
                  : quality === 'mixed' ? <Badge tone="warning">Смешанный</Badge>
                    : quality === 'good' ? 'Годный' : '—'}
              </InfoRow>
              <InfoRow label="Внутри">
                {box.items_qty > 0 ? `${box.items_qty} шт.` : 'пусто'}
              </InfoRow>
              <InfoRow label="Место">
                {box.zone_id ? (
                  <Link
                    to={`/inventory/balances?view=zone&place=${encodeURIComponent(box.zone_name ?? '')}`}
                    title="Показать остатки этого места"
                  >
                    {box.zone_name ?? '—'}
                  </Link>
                ) : (
                  box.zone_name ?? '—'
                )}
              </InfoRow>
              <InfoRow label="Клиент">{box.client_name ?? '—'}</InfoRow>
              <InfoRow label="Задача">
                {box.doc_id ? (
                  <Link to={`/inventory/shipments/${box.doc_id}`}>{box.doc_number_task ?? 'Открыть'}</Link>
                ) : (
                  '—'
                )}
              </InfoRow>
              <div style={{ borderTop: '1px solid var(--c-border)', margin: '2px 0' }} />
              <InfoRow label="Заведён">{fmtDateTime(box.created_at)}</InfoRow>
              <InfoRow label="Закрыт">{fmtDateTime(box.closed_at)}</InfoRow>
              <InfoRow label="Размещён">
                {fmtDateTime(box.placed_at)}
                {placedAge && box.status === 'placed' && (
                  <span className="t-sub" style={{ marginLeft: 6 }}>{placedAge} назад</span>
                )}
              </InfoRow>
            </div>
          </Card>

          {canMove && (
            <Card>
              <CardHead><span className="card-head-title">Переместить</span></CardHead>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 14 }}>
                {/* Переезд короба почти всегда идёт сканером, поэтому форма здесь свёрнута:
                    в карточке она нужна как запасной путь, а не как главное действие. */}
                {moveOpen ? (
                  <>
                    <Combobox
                      options={zoneOptions}
                      value={zoneId}
                      onChange={(v) => setZoneId(String(v ?? ''))}
                      placeholder="Место хранения"
                    />
                    <div className="row gap-8">
                      <button className="btn primary" disabled={busy || !zoneId} onClick={() => { void handlePlace() }}>
                        <Icon name="forklift" size={14} />Переместить
                      </button>
                      <button className="btn ghost" disabled={busy} onClick={() => { setMoveOpen(false); setZoneId('') }}>
                        Отмена
                      </button>
                    </div>
                  </>
                ) : (
                  <button className="btn ghost" onClick={() => setMoveOpen(true)}>
                    <Icon name="forklift" size={14} />Переместить в другое место
                  </button>
                )}
                <div className="t-sub">
                  Короб едет целиком: содержимое при переезде не меняется. Обычно это делают
                  сканером на ТСД; здесь — когда сканера нет под рукой.
                </div>
              </div>
            </Card>
          )}

          {transfer && (
            <BoxTransferDrawer
              box={box}
              mode={transfer}
              zoneOptions={zoneOptions}
              onClose={() => setTransfer(null)}
              onDone={() => { setTransfer(null); void load() }}
            />
          )}
        </div>
      </div>
    </DetailPage>
  )
}
