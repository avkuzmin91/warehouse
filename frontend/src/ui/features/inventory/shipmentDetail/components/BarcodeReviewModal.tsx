import { useMemo, useState } from 'react'
import { Modal } from '../../../../feedback/Modal'
import { useToast } from '../../../../feedback/Toast'
import { Icon } from '../../../../primitives/Icon'
import { bindShipmentLineFileBarcode } from '../../../../../api/shipmentsApi'
import type { LineFileBarcodeStatus } from '../../../../../api/shipmentsApi'

/** Код с файла строки + контекст, достаточный для привязки без перечитывания документа. */
export type BarcodeReviewItem = {
  code:                string
  status:              LineFileBarcodeStatus
  other_product_name:  string | null
  other_variant_label: string | null
  lineId:       string
  fileId:       string
  fileName:     string
  productId:    string
  productName:  string
  productSku:   string
  variantLabel: string | null
}

type RowResult = { ok: true } | { ok: false; error: string }

type Props = {
  docId:     string
  docNumber: string
  items:     BarcodeReviewItem[]
  canBind:   boolean
  onClose:   () => void
  onBound:   () => Promise<void> | void
}

/**
 * Разбор распознанных на файлах строк штрих-кодов: новые коды привязываются выборочно
 * (чекбоксы), конфликтные показываются отдельным блоком и не исчезают, результат
 * привязки — построчный (ошибка не откатывает успешные, «Повторить» доступен сразу).
 * «Решить позже» безопасно: коды хранятся на файлах и модалка открывается из деталки снова.
 */
export function BarcodeReviewModal({ docId, docNumber, items, canBind, onClose, onBound }: Props) {
  const toast = useToast()
  const unknown   = useMemo(() => items.filter((i) => i.status === 'unknown'), [items])
  const confirmed = useMemo(() => items.filter((i) => i.status === 'confirmed'), [items])
  const conflicts = useMemo(() => items.filter((i) => i.status === 'other_product' || i.status === 'other_variant'), [items])

  const [selected, setSelected] = useState<Set<string>>(() => new Set(unknown.map((i) => i.code)))
  const [results, setResults] = useState<Record<string, RowResult>>({})
  const [binding, setBinding] = useState(false)

  // Группировка по товару: строки того же товара идут подряд под одним заголовком.
  const groups = useMemo(() => {
    const byProduct = new Map<string, { productName: string; productSku: string; rows: BarcodeReviewItem[] }>()
    for (const it of [...unknown, ...confirmed]) {
      const g = byProduct.get(it.productId)
      if (g) g.rows.push(it)
      else byProduct.set(it.productId, { productName: it.productName, productSku: it.productSku, rows: [it] })
    }
    return [...byProduct.values()]
  }, [unknown, confirmed])

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  const bindable = unknown.filter((i) => selected.has(i.code) && results[i.code]?.ok !== true)
  const hasErrors = unknown.some((i) => results[i.code] && results[i.code].ok === false)
  const allSelectableSelected = unknown.every((i) => selected.has(i.code) || results[i.code]?.ok === true)

  function toggleAll() {
    setSelected(allSelectableSelected
      ? new Set(unknown.filter((i) => results[i.code]?.ok === true).map((i) => i.code))
      : new Set(unknown.map((i) => i.code)))
  }

  async function handleBind() {
    if (bindable.length === 0) return
    setBinding(true)
    const next: Record<string, RowResult> = { ...results }
    for (const it of bindable) {
      try {
        await bindShipmentLineFileBarcode(docId, it.lineId, it.fileId, it.code)
        next[it.code] = { ok: true }
      } catch (e) {
        next[it.code] = { ok: false, error: e instanceof Error ? e.message : 'Не удалось привязать штрих-код' }
      }
      setResults({ ...next })
    }
    setBinding(false)
    const okCount = bindable.filter((it) => next[it.code]?.ok).length
    const failCount = bindable.length - okCount
    if (failCount === 0) {
      toast(okCount === 1
        ? 'Штрих-код привязан, этикетка сохранена в карточку товара'
        : `Штрих-коды привязаны: ${okCount}, этикетки сохранены в карточки`, 'success')
      await onBound()
      onClose()
    } else if (okCount > 0) {
      toast(`Привязано: ${okCount}, с ошибкой: ${failCount} — можно повторить`, 'error')
      await onBound()
    }
  }

  function rowStateIcon(it: BarcodeReviewItem) {
    const r = results[it.code]
    if (r?.ok === true) return <span style={{ color: 'var(--c-success)', flex: 'none' }}><Icon name="check" size={15} /></span>
    if (r && r.ok === false) return <span style={{ color: 'var(--c-danger)', flex: 'none' }}><Icon name="x" size={15} /></span>
    return null
  }

  return (
    <Modal
      open
      onClose={binding ? () => {} : onClose}
      title="Штрих-коды на файлах строк"
      subtitle={`Задача ${docNumber} · распознано кодов: ${items.length}`}
      width={560}
      footer={
        <>
          {canBind && unknown.length > 1 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--c-text-subtle)', marginRight: 'auto', cursor: 'pointer' }}>
              <span
                className={`t-checkbox ${allSelectableSelected ? 'checked' : ''}`}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', opacity: binding ? 0.6 : 1 }}
              >
                {allSelectableSelected && <Icon name="check" size={10} />}
              </span>
              <input type="checkbox" checked={allSelectableSelected} disabled={binding} onChange={toggleAll} style={{ display: 'none' }} />
              Выбрать все новые
            </label>
          )}
          <button className="btn ghost" disabled={binding} onClick={onClose}>
            {canBind && unknown.length > 0 ? 'Решить позже' : 'Закрыть'}
          </button>
          {canBind && unknown.length > 0 && (
            <button className="btn primary" disabled={binding || bindable.length === 0} onClick={() => { void handleBind() }}>
              <Icon name="qr" size={14} />
              {hasErrors ? `Повторить (${bindable.length})` : `Привязать выбранные (${bindable.length})`}
            </button>
          )}
        </>
      }
    >
      {unknown.length > 0 && (
        <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--c-text-subtle)', lineHeight: 1.5 }}>
          {canBind
            ? 'Отмеченные коды будут привязаны к цвето-размеру строки, а файлы этикеток сохранятся в карточки товаров. «Решить позже» ничего не теряет — коды останутся в деталке задачи.'
            : 'Коды не привязаны к товарам. Привязку выполняет менеджер — коды остаются в деталке задачи.'}
        </p>
      )}

      {groups.map((g) => (
        <div key={g.productName + g.productSku} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)', marginBottom: 6 }}>
            {g.productName}
            {g.productSku && <span style={{ color: 'var(--c-text-faint)' }}> · {g.productSku}</span>}
          </div>
          <div style={{ border: '1px solid var(--c-border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
            {g.rows.map((it, i) => {
              const bound = results[it.code]?.ok === true || it.status === 'confirmed'
              const err = results[it.code] && results[it.code].ok === false
                ? (results[it.code] as { ok: false; error: string }).error
                : null
              return (
                <div
                  key={it.code}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                    borderBottom: i < g.rows.length - 1 ? '1px solid var(--c-border)' : 'none',
                    opacity: it.status === 'confirmed' ? 0.65 : 1,
                  }}
                >
                  {canBind && it.status === 'unknown' && !bound ? (
                    <label style={{ display: 'flex', flex: 'none', cursor: binding ? 'default' : 'pointer' }}>
                      <span
                        className={`t-checkbox ${selected.has(it.code) ? 'checked' : ''}`}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', opacity: binding ? 0.6 : 1 }}
                      >
                        {selected.has(it.code) && <Icon name="check" size={10} />}
                      </span>
                      <input
                        type="checkbox"
                        checked={selected.has(it.code)}
                        disabled={binding}
                        onChange={() => toggle(it.code)}
                        style={{ display: 'none' }}
                      />
                    </label>
                  ) : (
                    <span style={{ width: 14, flex: 'none' }} />
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="mono" style={{ fontSize: 13 }}>{it.code}</span>
                      {rowStateIcon(it)}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--c-text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[it.variantLabel, it.fileName].filter(Boolean).join(' · ')}
                    </div>
                    {err && <div style={{ fontSize: 11.5, color: 'var(--c-danger)', marginTop: 2 }}>{err}</div>}
                  </div>
                  <span style={{
                    flex: 'none', fontSize: 11.5, padding: '2px 8px', borderRadius: 999,
                    background: bound ? 'var(--c-success-bg)' : 'var(--c-accent-bg)',
                    color: bound ? 'var(--c-success)' : 'var(--c-accent)',
                  }}>
                    {bound ? 'Привязан' : 'Новый'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {conflicts.length > 0 && (
        <div style={{ padding: '10px 12px', background: 'var(--c-warning-bg)', borderRadius: 'var(--r-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--c-warning)', marginBottom: 6 }}>
            <Icon name="alert" size={14} />Требует внимания — не будет привязано
          </div>
          {conflicts.map((it) => (
            <div key={it.code} style={{ fontSize: 12.5, color: 'var(--c-warning)', lineHeight: 1.5, marginBottom: 4 }}>
              <span className="mono">{it.code}</span>
              {it.status === 'other_product'
                ? <> — уже принадлежит «{it.other_product_name}». Проверьте, тот ли файл «{it.fileName}» приложен к строке «{it.productName}».</>
                : <> — принадлежит варианту «{it.other_variant_label}» товара «{it.productName}», возможен пересорт.</>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
