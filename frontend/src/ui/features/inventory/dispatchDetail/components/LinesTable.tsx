import { useState } from 'react'
import type { DispatchLine } from '../../../../../api/dispatchApi'
import { Icon } from '../../../../primitives/Icon'
import { resolvePublicUploadSrc } from '../../../../../api/constants'
import { ProductLink } from '../../../shared/ProductLink'
import { DispatchLineFiles } from './DispatchLineFiles'

type Props = {
  lines: DispatchLine[]
  /** Когда задан — палеты в колонке «Упаковка» редактируются инлайн (менеджер, до счёта). */
  onSavePallets?: (lineId: string, pallets: number | null) => Promise<boolean>
  /** Когда задан — короба в колонке «Упаковка» редактируются инлайн (менеджер, до счёта). */
  onSaveBoxes?: (lineId: string, boxes: number | null) => Promise<boolean>
}

/** Read-only состав отгрузки: вариант, магазин, ссылка на сайт, план/отгружено/остаток.
 *  Колонка «Упаковка» объединяет палеты и короба (два поля в одной ячейке, без расширения
 *  таблицы). Если передан `onSavePallets`/`onSaveBoxes` — соответствующее поле редактируется. */
export function LinesTable({ lines, onSavePallets, onSaveBoxes }: Props) {
  if (lines.length === 0) {
    return <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>Нет позиций</div>
  }
  const planTotal = lines.reduce((s, l) => s + l.qty, 0)
  const shippedTotal = lines.reduce((s, l) => s + l.shipped_qty, 0)
  const palletsTotal = lines.reduce((s, l) => s + (l.pallets_qty ?? 0), 0)
  const boxesTotal = lines.reduce((s, l) => s + (l.boxes_qty ?? 0), 0)

  const editable = !!(onSavePallets || onSaveBoxes)

  return (
    <>
    <table className="t">
      <thead>
        <tr>
          <th>Товар · вариант</th>
          <th style={{ width: 150 }}>Магазин</th>
          <th style={{ width: 80 }}>Ссылка</th>
          <th style={{ textAlign: 'right', width: 70 }}>План</th>
          <th style={{ textAlign: 'right', width: editable ? 150 : 96 }}>Упаковка</th>
          <th style={{ textAlign: 'right', width: 90 }}>Отгружено</th>
          <th style={{ textAlign: 'right', width: 80 }}>Остаток</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => {
          const remaining = Math.max(0, l.qty - l.shipped_qty)
          return (
            <tr key={l.id}>
              <td>
                <div style={{ fontWeight: 500, fontSize: 13 }}><ProductLink productId={l.product_id}>{l.product_name}</ProductLink></div>
                <div className="t-sub mono">{[l.product_sku, l.color_name, l.size_name].filter(Boolean).join(' · ')}</div>
                {l.sku_pending && <span className="badge warning" style={{ marginTop: 4 }}>Без SKU</span>}
                {l.files.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <DispatchLineFiles
                      entries={l.files.map((f) => ({ id: f.id, filename: f.filename, mimeType: f.mime_type, href: resolvePublicUploadSrc(f.url) }))}
                      canEdit={false}
                    />
                  </div>
                )}
              </td>
              <td>{l.store_name ?? <span style={{ color: 'var(--c-text-faint)' }}>—</span>}</td>
              <td>
                {l.site_url ? (
                  <a href={l.site_url} target="_blank" rel="noreferrer" title={l.site_url} style={{ color: 'var(--c-accent)', fontSize: 12.5, fontWeight: 500 }}>
                    Открыть
                  </a>
                ) : (
                  <span style={{ color: 'var(--c-text-faint)' }}>—</span>
                )}
              </td>
              <td className="num">{l.qty}</td>
              <td>
                {editable ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end' }}>
                    <PackUnitEditor label="Короба" value={l.boxes_qty} onSave={onSaveBoxes ? (v) => onSaveBoxes(l.id, v) : undefined} />
                    <PackUnitEditor label="Палеты" value={l.pallets_qty} onSave={onSavePallets ? (v) => onSavePallets(l.id, v) : undefined} />
                  </div>
                ) : (
                  <div className="num" style={{ whiteSpace: 'nowrap' }}>
                    {l.boxes_qty ?? '—'} кор · {l.pallets_qty ?? '—'} пал
                  </div>
                )}
              </td>
              <td className="num"><span style={{ color: l.shipped_qty > 0 ? 'var(--c-success)' : 'var(--c-text-subtle)' }}>{l.shipped_qty}</span></td>
              <td className="num">{remaining}</td>
            </tr>
          )
        })}
      </tbody>
      <tfoot>
        <tr style={{ background: 'var(--c-bg-sunken)' }}>
          <td colSpan={3} style={{ padding: '10px 12px', fontWeight: 500, fontSize: 12.5 }}>Итого</td>
          <td className="num" style={{ padding: '10px 12px', fontWeight: 600 }}>{planTotal}</td>
          <td className="num" style={{ padding: '10px 12px', fontWeight: 600, whiteSpace: 'nowrap' }}>{boxesTotal} кор · {palletsTotal} пал</td>
          <td className="num" style={{ padding: '10px 12px', fontWeight: 600 }}>{shippedTotal}</td>
          <td className="num" style={{ padding: '10px 12px', fontWeight: 600 }}>{Math.max(0, planTotal - shippedTotal)}</td>
        </tr>
      </tfoot>
    </table>
    </>
  )
}

/** Компактный редактор одной единицы упаковки (палеты ИЛИ короба) в ячейке «Упаковка».
 *  Кнопка сохранения появляется только при изменении значения. Без onSave — read-only.
 *  Используется также в PreparePanel (упаковка видна кладовщику на подготовке). */
export function PackUnitEditor({ label, value, onSave }: {
  label: string
  value: number | null
  onSave?: (v: number | null) => Promise<boolean>
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const shown = draft ?? (value != null ? String(value) : '')
  const parsed = shown === '' ? null : Math.max(0, parseInt(shown, 10))
  const dirty = draft !== null && parsed !== (value ?? null)

  async function save() {
    if (!onSave) return
    setSaving(true)
    try {
      const ok = await onSave(parsed)
      if (ok) setDraft(null)
    } finally {
      setSaving(false)
    }
  }

  if (!onSave) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
        <span style={{ color: 'var(--c-text-muted)' }}>{label}</span>
        <span className="num" style={{ minWidth: 24, textAlign: 'right' }}>{value ?? '—'}</span>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11, color: 'var(--c-text-muted)', width: 42, textAlign: 'right' }}>{label}</span>
      <input
        className="input sm num"
        inputMode="numeric"
        placeholder="0"
        aria-label={`Количество: ${label}`}
        value={shown}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
        style={{ width: 52, textAlign: 'right' }}
      />
      {dirty && (
        <button className="btn ghost icon sm" title={`Сохранить: ${label}`} disabled={saving} onClick={() => void save()}>
          <Icon name={saving ? 'refresh' : 'save'} size={13} style={saving ? { animation: 'spin 0.7s linear infinite' } : undefined} />
        </button>
      )}
    </div>
  )
}
