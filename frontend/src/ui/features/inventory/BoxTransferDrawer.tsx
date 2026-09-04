import { useEffect, useMemo, useState } from 'react'
import {
  getContainerByCode,
  getPendingPlacement,
  placeContainers,
  type ContainerContentLine,
  type ContainerItem,
  type ContainerPlaceSource,
  type ContainerPlaceTarget,
} from '../../../api/containersApi'
import { getBalancesByZone } from '../../../api/balancesApi'
import { Drawer } from '../../feedback/Drawer'
import { useToast } from '../../feedback/Toast'
import { Combobox, type ComboboxOption } from '../../data/Combobox'
import { Icon } from '../../primitives/Icon'

type Variant = {
  product_id: string
  color_id: string | null
  size_id: string | null
  quality: 'good' | 'defect'
  label: string
  qty: number
}

type AddSource = 'collected' | 'location'
type RemoveTarget = 'same' | 'location' | 'container'

export type BoxTransferMode =
  | { kind: 'add' }
  | { kind: 'remove'; line: ContainerContentLine }

function variantKey(v: { product_id: string; color_id: string | null; size_id: string | null; quality: string }): string {
  return `${v.product_id}|${v.color_id ?? ''}|${v.size_id ?? ''}|${v.quality}`
}

function lineLabel(v: { product_sku: string | null; product_name: string | null; color_name: string | null; size_name: string | null }): string {
  return [v.product_sku, v.product_name, v.color_name, v.size_name].filter(Boolean).join(' · ')
}

/** Ручной режим карточки короба: доложить товар в короб или изъять из него в выбранный приёмник.
 *
 * Тот же `POST /containers/place`, что и на ТСД: источник и приёмник названы явно,
 * поэтому веб без сканера умеет всё то же, включая перенос между коробами.
 */
export function BoxTransferDrawer({
  box, mode, zoneOptions, onClose, onDone,
}: {
  box: ContainerItem
  mode: BoxTransferMode
  zoneOptions: ComboboxOption[]
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [qty, setQty] = useState<string>(mode.kind === 'remove' ? String(mode.line.qty) : '1')

  // «Доложить»: откуда берём и что именно.
  const [addSource, setAddSource] = useState<AddSource>('collected')
  const [sourceZoneId, setSourceZoneId] = useState('')
  const [candidates, setCandidates] = useState<Variant[] | null>(null)
  const [variantKeySel, setVariantKeySel] = useState('')

  // «Изъять»: куда кладём.
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget>('same')
  const [targetZoneId, setTargetZoneId] = useState('')
  const [targetBoxCode, setTargetBoxCode] = useState('')

  useEffect(() => {
    if (mode.kind !== 'add') return
    if (addSource === 'location' && !sourceZoneId) { setCandidates([]); return }
    const ac = new AbortController()
    setCandidates(null)
    setVariantKeySel('')
    const load = async (): Promise<Variant[]> => {
      if (addSource === 'collected') {
        const r = await getPendingPlacement(ac.signal)
        return r.aside.map((a) => ({
          product_id: a.product_id, color_id: a.color_id, size_id: a.size_id, quality: a.quality,
          label: lineLabel(a), qty: a.qty,
        }))
      }
      const zoneLabel = zoneOptions.find((z) => String(z.value) === sourceZoneId)?.label ?? ''
      const r = await getBalancesByZone({ location: zoneLabel, op_status: 'storage' }, ac.signal)
      return r.items
        .filter((b) => b.location_id === sourceZoneId)
        .map((b) => ({
          product_id: b.product_id, color_id: b.color_id, size_id: b.size_id, quality: b.quality,
          label: lineLabel(b), qty: b.qty,
        }))
    }
    load()
      .then((list) => { if (!ac.signal.aborted) setCandidates(list) })
      .catch((e) => { if (!ac.signal.aborted) setError(e instanceof Error ? e.message : 'Не удалось загрузить остатки') })
    return () => ac.abort()
  }, [mode.kind, addSource, sourceZoneId, zoneOptions])

  const variantOptions = useMemo<ComboboxOption[]>(
    () => (candidates ?? []).map((v) => ({
      value: variantKey(v),
      label: v.label,
      sub: `${v.qty} шт.${v.quality === 'defect' ? ' · брак' : ''}`,
    })),
    [candidates],
  )
  const chosen = candidates?.find((v) => variantKey(v) === variantKeySel) ?? null
  const n = parseInt(qty.replace(/\D/g, ''), 10) || 0

  const canSubmit = n > 0 && !busy && (
    mode.kind === 'add'
      ? chosen !== null && n <= chosen.qty
      : n <= mode.line.qty && (
        removeTarget === 'same'
        || (removeTarget === 'location' && !!targetZoneId)
        || (removeTarget === 'container' && targetBoxCode.trim() !== '')
      )
  )

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    setError('')
    try {
      let source: ContainerPlaceSource
      let target: ContainerPlaceTarget
      let item: { product_id: string; color_id: string | null; size_id: string | null; qty: number; quality?: 'good' | 'defect' }
      if (mode.kind === 'add') {
        if (!chosen) return
        source = addSource === 'collected' ? { kind: 'collected' } : { kind: 'location', id: sourceZoneId }
        target = { kind: 'container', id: box.id }
        item = { product_id: chosen.product_id, color_id: chosen.color_id, size_id: chosen.size_id, qty: n, quality: chosen.quality }
      } else {
        source = { kind: 'container', id: box.id }
        if (removeTarget === 'container') {
          const found = await getContainerByCode(targetBoxCode.trim())
          if (!found.found || !found.container) {
            setError(`Короб «${targetBoxCode.trim()}» не найден`)
            return
          }
          target = { kind: 'container', id: found.container.id }
        } else if (removeTarget === 'location') {
          target = { kind: 'location', id: targetZoneId }
        } else {
          if (!box.zone_id) {
            setError('У короба нет места — сначала разместите его')
            return
          }
          target = { kind: 'location', id: box.zone_id }
        }
        item = { product_id: mode.line.product_id, color_id: mode.line.color_id, size_id: mode.line.size_id, qty: n }
      }
      const res = await placeContainers({ source, target, items: [item] })
      toast(
        `${res.placed_qty} шт. → ${res.target_container ? `короб ${res.target_container.doc_number}` : res.zone_name}`,
        'success',
      )
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось переместить')
    } finally {
      setBusy(false)
    }
  }

  const title = mode.kind === 'add' ? `Доложить в ${box.doc_number}` : `Изъять из ${box.doc_number}`

  return (
    <Drawer
      open
      onClose={onClose}
      title={title}
      subtitle={mode.kind === 'remove' ? lineLabel(mode.line) : `Короб стоит в ${box.zone_name ?? '—'}`}
      width={480}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn ghost" disabled={busy} onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!canSubmit} onClick={() => { void submit() }}>
            <Icon name="check" size={13} />
            {busy ? 'Перемещение…' : 'Подтвердить перемещение'}
          </button>
        </div>
      }
    >
      {mode.kind === 'add' ? (
        <>
          <div className="field">
            <div className="field-label">Откуда</div>
            <div className="tabs">
              <button className={`tab${addSource === 'collected' ? ' active' : ''}`} onClick={() => setAddSource('collected')}>
                Зона упаковки
              </button>
              <button className={`tab${addSource === 'location' ? ' active' : ''}`} onClick={() => setAddSource('location')}>
                Место хранения
              </button>
            </div>
          </div>
          {addSource === 'location' && (
            <div className="field">
              <div className="field-label">Место</div>
              <Combobox options={zoneOptions} value={sourceZoneId} onChange={(v) => setSourceZoneId(String(v ?? ''))} placeholder="Место хранения" />
            </div>
          )}
          <div className="field">
            <div className="field-label">Товар</div>
            <Combobox
              options={variantOptions}
              value={variantKeySel}
              onChange={(v) => setVariantKeySel(String(v ?? ''))}
              loading={candidates === null && (addSource === 'collected' || !!sourceZoneId)}
              disabled={addSource === 'location' && !sourceZoneId}
              placeholder={candidates && candidates.length === 0 ? 'Свободного товара нет' : 'Выбрать позицию'}
            />
            <div className="t-sub" style={{ fontSize: 12, marginTop: 4 }}>
              {addSource === 'collected'
                ? 'Собранное без короба, что ждёт развозки у стола.'
                : 'Свободный остаток места: то, что лежит в коробах, едет только коробом.'}
            </div>
          </div>
        </>
      ) : (
        <div className="field">
          <div className="field-label">Куда</div>
          <div className="tabs">
            <button className={`tab${removeTarget === 'same' ? ' active' : ''}`} onClick={() => setRemoveTarget('same')}>
              Оставить в {box.zone_name ?? 'этом месте'}
            </button>
            <button className={`tab${removeTarget === 'location' ? ' active' : ''}`} onClick={() => setRemoveTarget('location')}>
              Другое место
            </button>
            <button className={`tab${removeTarget === 'container' ? ' active' : ''}`} onClick={() => setRemoveTarget('container')}>
              Другой короб
            </button>
          </div>
          {removeTarget === 'location' && (
            <div style={{ marginTop: 8 }}>
              <Combobox options={zoneOptions} value={targetZoneId} onChange={(v) => setTargetZoneId(String(v ?? ''))} placeholder="Место хранения" />
            </div>
          )}
          {removeTarget === 'container' && (
            <input
              className="input"
              style={{ marginTop: 8, width: '100%' }}
              placeholder="Номер короба, например BOX-000123"
              value={targetBoxCode}
              onChange={(e) => setTargetBoxCode(e.target.value)}
            />
          )}
        </div>
      )}

      <div className="field">
        <div className="field-label">
          <span>Количество</span>
          <span>
            {mode.kind === 'remove' ? `в коробе ${mode.line.qty} шт.` : chosen ? `доступно ${chosen.qty} шт.` : ''}
          </span>
        </div>
        <input
          className="input"
          inputMode="numeric"
          style={{ width: 120 }}
          value={qty}
          onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))}
        />
      </div>

      {error && <div style={{ color: 'var(--c-danger)', fontSize: 12.5 }}>{error}</div>}
    </Drawer>
  )
}
