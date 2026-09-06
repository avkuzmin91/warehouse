import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getBarcodeLabels, getProductFiles } from '../../../../../api/adminApi'
import type { ProductFileItem } from '../../../../../api/domainTypes'
import { useApi } from '../../../../../hooks/useApi'
import { Modal } from '../../../../feedback/Modal'
import { EmptyState } from '../../../../primitives/EmptyState'
import { Icon } from '../../../../primitives/Icon'
import { Skeleton } from '../../../../primitives/Skeleton'
import { usePrintBarcodeLabels } from '../../../shared/usePrintBarcodeLabels'
import { fileTypeColor, fileTypeIcon } from './fileHelpers'

const ROW: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
  padding: '9px 11px', borderRadius: 'var(--r-md)', textAlign: 'left',
  border: '1px solid var(--c-border)', background: 'var(--c-bg-elev)', cursor: 'pointer',
}

function Section({ title }: { title: string }) {
  return (
    <div style={{
      fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em',
      color: 'var(--c-text-faint)', fontWeight: 600, padding: '10px 2px 5px',
    }}>
      {title}
    </div>
  )
}

function Radio({ on }: { on: boolean }) {
  return (
    <span style={{
      width: 15, height: 15, borderRadius: '50%', flexShrink: 0, position: 'relative',
      border: `1.5px solid ${on ? 'var(--c-accent)' : 'var(--c-border-strong)'}`,
    }}>
      {on ? (
        <span style={{
          position: 'absolute', inset: 3, borderRadius: '50%', background: 'var(--c-accent)',
        }} />
      ) : null}
    </span>
  )
}

/** Этикетка строки задачи: каким кодом маркировать и чем печатать.
 *
 * Выбор, а не только печать: у варианта бывает несколько ШК (кабинеты Ozon и WB,
 * массив skus одной карточки), и молча подставленный первый код уезжает на короб
 * вместе с ошибкой. Выбранный код запоминается на строке, печать — по нему. */
export function ProductLabelPickerModal({
  productId, productName, variantLabel, lineColorId, lineSizeId, lineStoreId = null, qty = 1,
  chosenBarcode = null, excludeUrls = [], onPick, onChoose, onPullBarcodes, onClose,
}: {
  productId: string
  productName: string
  /** Цвет/размер строки — печать идёт на конкретный вариант. */
  variantLabel?: string | null
  lineColorId: string | null
  lineSizeId: string | null
  /** Магазин строки: у варианта в разных кабинетах разные коды. */
  lineStoreId?: string | null
  /** Тираж печати — план строки. */
  qty?: number
  /** Код, уже выбранный на строке. */
  chosenBarcode?: string | null
  /** URL уже прикреплённых к строке файлов — прячем, чтобы не предлагать дубликат. */
  excludeUrls?: string[]
  onPick: (file: ProductFileItem) => void
  /** Запомнить выбор на строке; null — вернуться к правилу «магазин → общий код». */
  onChoose?: (barcode: string | null) => void | Promise<void>
  /** Подтянуть ШК из кабинета магазина — выход из состояния «кода нет». */
  onPullBarcodes?: () => void
  onClose: () => void
}) {
  const { printLabels, printing } = usePrintBarcodeLabels()
  const codes = useApi(
    (signal) => getBarcodeLabels(
      [{ product_id: productId, color_id: lineColorId, size_id: lineSizeId, store_id: lineStoreId, qty }],
      { allCodes: true, signal },
    ),
    [productId, lineColorId, lineSizeId, lineStoreId, qty],
  )
  const files = useApi((signal) => getProductFiles(productId, signal), [productId])
  const ownFiles = (files.data ?? []).filter((f) =>
    !excludeUrls.includes(f.url) &&
    (f.variant_id === null || ((f.color_id ?? null) === (lineColorId ?? null) && (f.size_id ?? null) === (lineSizeId ?? null))))
  const items = codes.data?.items ?? []
  const loading = codes.loading || files.loading
  const nothing = !loading && items.length === 0 && ownFiles.length === 0

  const [selected, setSelected] = useState<string | null>(chosenBarcode)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    // Кандидат по умолчанию подсвечен, но пока человек не нажал — на строке он не
    // сохранён: разница между «система подставила» и «я выбрал» и есть суть экрана.
    if (!selected && items.length > 0) setSelected(chosenBarcode ?? items[0].barcode)
  }, [items, chosenBarcode, selected])

  async function apply(barcode: string | null, alsoPrint: boolean) {
    setSaving(true)
    try {
      if (onChoose) await onChoose(barcode)
      if (alsoPrint && barcode) {
        await printLabels([{
          product_id: productId, color_id: lineColorId, size_id: lineSizeId,
          store_id: lineStoreId, barcode, qty,
        }])
      }
    } finally {
      setSaving(false)
    }
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Этикетка"
      subtitle={[productName, variantLabel, qty > 1 ? `план ${qty} шт.` : null].filter(Boolean).join(' · ')}
      width={470}
    >
      {loading ? (
        <div className="col gap-8">
          <Skeleton height={44} />
          <Skeleton height={44} />
        </div>
      ) : nothing ? (
        <div style={{ textAlign: 'center', padding: '4px 0 8px' }}>
          <EmptyState
            title="У варианта нет штрих-кода"
            sub="Печатать нечего: код берётся из карточки товара. Заведите его вручную или подтяните из кабинета маркетплейса."
          />
          <div className="row gap-8" style={{ justifyContent: 'center', marginTop: 10 }}>
            <Link className="btn primary sm" to={`/dictionaries/products/${productId}`}>
              <Icon name="plus" size={13} />Добавить ШК
            </Link>
            {onPullBarcodes && (
              <button type="button" className="btn sm" onClick={onPullBarcodes}>
                <Icon name="barcode" size={13} />Подтянуть из МП
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="col" style={{ gap: 4 }}>
          {items.length > 0 && <Section title="Чем маркировать строку" />}
          {items.map((item, i) => {
            const on = selected === item.barcode
            return (
              <button
                key={item.barcode}
                type="button"
                onClick={() => setSelected(item.barcode)}
                style={{
                  ...ROW,
                  borderColor: on ? 'var(--c-accent)' : 'var(--c-border)',
                  background: on ? 'var(--c-accent-bg)' : 'var(--c-bg-elev)',
                }}
              >
                <Radio on={on} />
                {/* Начало кода в натуральном масштабе: весь код, ужатый до 68 px,
                    выглядит серой кашей и ничего не подтверждает. */}
                <span style={{ height: 22, width: 68, flexShrink: 0, overflow: 'hidden', display: 'block' }}>
                  <span
                    style={{ display: 'block', height: '100%', width: item.modules * 1.4 }}
                    dangerouslySetInnerHTML={{ __html: item.barcode_svg }}
                  />
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="mono" style={{ display: 'block', fontSize: 12.5, fontWeight: 500 }}>
                    {item.barcode}
                  </span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--c-text-subtle)' }}>
                    {['Code 128', item.source,
                      item.barcode === chosenBarcode ? 'выбран на строке' : i === 0 ? 'по умолчанию' : null,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            )
          })}

          {ownFiles.length > 0 && <Section title="Готовый файл" />}
          {ownFiles.map((f) => (
            <button key={f.id} type="button" onClick={() => onPick(f)} style={ROW}>
              <Icon
                name={fileTypeIcon(f.mime_type, f.filename)}
                size={16}
                style={{ color: fileTypeColor(f.mime_type, f.filename), flexShrink: 0 }}
              />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.filename}
                </span>
                <span className="mono" style={{ display: 'block', fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
                  {[f.barcode, [f.color_name, f.size_name].filter(Boolean).join(' / ')].filter(Boolean).join(' · ')}
                </span>
              </span>
              <Icon name="plus" size={14} style={{ color: 'var(--c-accent)', flexShrink: 0 }} />
            </button>
          ))}

          {items.length > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
              borderTop: '1px solid var(--c-border)', marginTop: 8, paddingTop: 10,
            }}>
              <button
                type="button"
                className="btn primary sm"
                disabled={!selected || saving || printing}
                onClick={() => void apply(selected, true)}
              >
                <Icon name="print" size={13} />Выбрать и напечатать · {qty}
              </button>
              {onChoose && (
                <button
                  type="button"
                  className="btn sm"
                  disabled={!selected || saving}
                  onClick={() => void apply(selected, false)}
                >
                  Только выбрать
                </button>
              )}
              {onChoose && chosenBarcode && (
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={saving}
                  onClick={() => void apply(null, false)}
                  title="Код снова будет выбираться по магазину строки"
                >
                  Вернуть автоматический выбор
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
