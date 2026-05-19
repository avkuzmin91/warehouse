import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useState,
} from 'react'
import {
  type DictionaryItem,
  type ProductVariantWriteItem,
} from '../api/domainTypes'
import {
  deleteProductVariant,
  fetchActiveDictionaryItems,
  getProductVariants,
  patchProductVariants,
} from '../api/adminApi'
import {
  DictionaryFormCombobox,
  mergeDictionaryItemsWithCurrent,
} from './DictionaryFormCombobox'
import { ProductDimNumberInput } from './ProductDimNumberInput'
import { useConfirm } from './ConfirmDialogProvider'

export type SaveVariantsOptions = {
  /**
   * После сохранения карточки с новым базовым штрих-кодом сервер пересчитывает SKU вариантов —
   * перед PATCH подставить актуальные sku с сервера (цвет/габариты остаются из локальной таблицы).
   */
  syncSkusFromServer?: boolean
}

export type ProductVariantsEditorHandle = {
  saveVariants: (options?: SaveVariantsOptions) => Promise<{ ok: boolean; message?: string }>
}

type Props = {
  productId: string
  /** Базовый штрих-код товара — часть ключа уникальности варианта вместе с цветом и размером. */
  skuBase: string
  requiresSize: boolean
  disabled?: boolean
  onVariantsSaved?: () => void
}

function emptyRow(requiresSize: boolean): ProductVariantWriteItem {
  return {
    id: null,
    sku: '',
    color_id: '',
    dimension: { length: 0, width: 0, height: 0 },
    size_id: requiresSize ? '' : null,
    images: [],
    is_active: true,
  }
}

function snapshotVariantList(items: ProductVariantWriteItem[]): ProductVariantWriteItem[] {
  return items.map((v) => ({
    ...v,
    dimension: { ...v.dimension },
    images: [...v.images],
  }))
}

function rowShallowEqual(a: ProductVariantWriteItem, b: ProductVariantWriteItem): boolean {
  if (a.color_id !== b.color_id) return false
  if ((a.size_id || null) !== (b.size_id || null)) return false
  if (a.is_active !== b.is_active) return false
  if (a.dimension.length !== b.dimension.length) return false
  if (a.dimension.width !== b.dimension.width) return false
  if (a.dimension.height !== b.dimension.height) return false
  if (a.images.length !== b.images.length) return false
  for (let i = 0; i < a.images.length; i += 1) {
    if (a.images[i] !== b.images[i]) return false
  }
  return true
}

function isVariantRowDirty(
  row: ProductVariantWriteItem,
  baselineRows: ProductVariantWriteItem[],
): boolean {
  if (!row.id) return true
  const base = baselineRows.find((b) => b.id === row.id)
  if (!base) return true
  return !rowShallowEqual(row, base)
}

/** Соответствует `_variant_identity_key` на backend. */
function validateVariantUniqueness(
  rows: ProductVariantWriteItem[],
  requiresSize: boolean,
  skuBase: string,
): string | null {
  const article = (skuBase || '').trim()
  const map = new Map<string, number>()
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]!
    const cid = (r.color_id || '').trim().toLowerCase()
    if (!cid) continue
    const sid = requiresSize ? (r.size_id || '').trim().toLowerCase() : ''
    const key = requiresSize ? `${article}\0${cid}\0${sid}` : `${article}\0${cid}`
    const prev = map.get(key)
    if (prev !== undefined) {
      return requiresSize
        ? 'Дублируется сочетание штрих-кода товара, цвета и размера'
        : 'Дублируется сочетание штрих-кода товара и цвета'
    }
    map.set(key, i)
  }
  return null
}

function VariantDeleteIconButton({
  disabled,
  title,
  ariaLabel,
  onClick,
}: {
  disabled: boolean
  title: string
  ariaLabel: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="users-icon-btn users-icon-btn--delete"
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <svg className="users-icon-btn__svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M9 3h6M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14"
          stroke="currentColor"
          strokeWidth="1.85"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

function VariantSaveIconButton({
  disabled,
  onClick,
}: {
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="users-icon-btn users-icon-btn--save"
      aria-label="Сохранить варианты"
      title="Сохранить изменения"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <svg className="users-icon-btn__svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M6 4h9l3 3v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
        <path d="M6 4v5h7V4" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
        <path
          d="M6 14h12v4a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-4z"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

export const ProductVariantsEditor = forwardRef<ProductVariantsEditorHandle, Props>(
  function ProductVariantsEditor(
    { productId, skuBase, requiresSize, disabled = false, onVariantsSaved }: Props,
    ref,
  ) {
    const confirmDelete = useConfirm()
    const baseId = useId()
  const [colors, setColors] = useState<DictionaryItem[]>([])
  const [sizes, setSizes] = useState<DictionaryItem[]>([])
  const [rows, setRows] = useState<ProductVariantWriteItem[]>([])
  const [baselineRows, setBaselineRows] = useState<ProductVariantWriteItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)

  const reload = useCallback(() => {
    setLoading(true)
    setLoadError('')
    getProductVariants(productId)
      .then((items) => {
        const mapped = items.map((v) => ({
          id: v.id,
          sku: v.sku,
          color_id: v.color_id,
          dimension: { ...v.dimension },
          size_id: v.size_id,
          images: [],
          is_active: v.is_active,
        }))
        setRows(mapped)
        setBaselineRows(snapshotVariantList(mapped))
      })
      .catch((e) => {
        setLoadError(e instanceof Error ? e.message : 'Ошибка загрузки')
        setRows([])
        setBaselineRows([])
      })
      .finally(() => setLoading(false))
  }, [productId])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchActiveDictionaryItems('/colors'),
      fetchActiveDictionaryItems('/sizes'),
    ])
      .then(([c, s]) => {
        if (!cancelled) {
          setColors(c)
          setSizes(s)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const saveVariantsInternal = useCallback(
    async (options?: SaveVariantsOptions): Promise<{ ok: boolean; message?: string }> => {
      if (loading) {
        const msg = 'Варианты ещё загружаются'
        setSaveError(msg)
        return { ok: false, message: msg }
      }
      if (loadError) {
        setSaveError(loadError)
        return { ok: false, message: loadError }
      }
      setSaveError('')
      let payload = rows
      if (options?.syncSkusFromServer) {
        try {
          const fresh = await getProductVariants(productId)
          const skuById = new Map(fresh.map((v) => [v.id, v.sku]))
          payload = rows.map((r) => {
            if (!r.id) return r
            const ns = skuById.get(r.id)
            return ns !== undefined ? { ...r, sku: ns } : r
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Ошибка загрузки вариантов'
          setSaveError(msg)
          return { ok: false, message: msg }
        }
      }
      const dup = validateVariantUniqueness(payload, requiresSize, skuBase)
      if (dup) {
        setSaveError(dup)
        return { ok: false, message: dup }
      }
      setSaving(true)
      try {
        await patchProductVariants(productId, payload)
        onVariantsSaved?.()
        await reload()
        return { ok: true }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Ошибка сохранения'
        setSaveError(msg)
        return { ok: false, message: msg }
      } finally {
        setSaving(false)
      }
    },
    [loading, loadError, rows, productId, skuBase, requiresSize, reload, onVariantsSaved],
  )

  useImperativeHandle(ref, () => ({ saveVariants: saveVariantsInternal }), [saveVariantsInternal])

  const dimDisabled = disabled || loading || saving
  const colCount = requiresSize ? 4 : 3

  return (
    <section className="product-variants-editor product-create-form">
      <h2 className="product-variants-editor__title">Варианты товара</h2>
      <div className="table-wrap product-table-wrap">
        <table className="users-table">
          <thead>
            <tr>
              <th>Цвет</th>
              {requiresSize ? <th>Размер</th> : null}
              <th>Габариты (Д×Ш×В)</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={colCount} className="product-variants-skeleton">
                  Загрузка…
                </td>
              </tr>
            ) : loadError ? (
              <tr>
                <td colSpan={colCount}>
                  <p className="error-text">{loadError}</p>
                  <button type="button" className="btn btn--secondary" onClick={() => reload()}>
                    Повторить
                  </button>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="product-variants-empty">
                  Нет вариантов
                </td>
              </tr>
            ) : (
              rows.map((row, i) => {
                const dirty = isVariantRowDirty(row, baselineRows)
                return (
                  <tr key={row.id ?? `new-${i}`}>
                    <td>
                      <DictionaryFormCombobox
                        id={`${baseId}-c-${i}`}
                        items={mergeDictionaryItemsWithCurrent(colors, row.color_id || null, null)}
                        value={row.color_id}
                        onChange={(v) =>
                          setRows((prev) => {
                            const n = [...prev]
                            n[i] = { ...n[i]!, color_id: v }
                            return n
                          })
                        }
                        disabled={dimDisabled}
                        required={false}
                        allowClear
                        listPortal
                      />
                    </td>
                    {requiresSize ? (
                      <td>
                        <DictionaryFormCombobox
                          id={`${baseId}-s-${i}`}
                          items={mergeDictionaryItemsWithCurrent(sizes, row.size_id || null, null)}
                          value={row.size_id ?? ''}
                          onChange={(v) =>
                            setRows((prev) => {
                              const n = [...prev]
                              n[i] = { ...n[i]!, size_id: v || null }
                              return n
                            })
                          }
                          disabled={dimDisabled}
                          required={false}
                          allowClear
                          listPortal
                        />
                      </td>
                    ) : null}
                    <td className="product-variants-dim">
                      <ProductDimNumberInput
                        value={row.dimension.length}
                        disabled={dimDisabled}
                        inputClassName="field-input field-input--narrow"
                        onChange={(s) => {
                          const num = parseFloat(s.replace(',', '.'))
                          setRows((prev) => {
                            const n = [...prev]
                            const cur = n[i]
                            if (!cur) return prev
                            n[i] = {
                              ...cur,
                              dimension: {
                                ...cur.dimension,
                                length: Number.isFinite(num) ? num : 0,
                              },
                            }
                            return n
                          })
                        }}
                      />
                      <span aria-hidden>×</span>
                      <ProductDimNumberInput
                        value={row.dimension.width}
                        disabled={dimDisabled}
                        inputClassName="field-input field-input--narrow"
                        onChange={(s) => {
                          const num = parseFloat(s.replace(',', '.'))
                          setRows((prev) => {
                            const n = [...prev]
                            const cur = n[i]
                            if (!cur) return prev
                            n[i] = {
                              ...cur,
                              dimension: {
                                ...cur.dimension,
                                width: Number.isFinite(num) ? num : 0,
                              },
                            }
                            return n
                          })
                        }}
                      />
                      <span aria-hidden>×</span>
                      <ProductDimNumberInput
                        value={row.dimension.height}
                        disabled={dimDisabled}
                        inputClassName="field-input field-input--narrow"
                        onChange={(s) => {
                          const num = parseFloat(s.replace(',', '.'))
                          setRows((prev) => {
                            const n = [...prev]
                            const cur = n[i]
                            if (!cur) return prev
                            n[i] = {
                              ...cur,
                              dimension: {
                                ...cur.dimension,
                                height: Number.isFinite(num) ? num : 0,
                              },
                            }
                            return n
                          })
                        }}
                      />
                    </td>
                    <td className="product-variants-actions">
                      <div className="product-variants-actions__inner">
                        {dirty ? (
                          <VariantSaveIconButton
                            disabled={dimDisabled}
                            onClick={() => void saveVariantsInternal()}
                          />
                        ) : null}
                        {row.id ? (
                          <VariantDeleteIconButton
                            disabled={dimDisabled}
                            title="Удалить вариант"
                            ariaLabel="Удалить вариант"
                            onClick={async () => {
                              const ok = await confirmDelete({
                                message: 'Удалить вариант?',
                                ariaLabel: 'Подтверждение удаления варианта',
                                confirmLabel: 'Удалить',
                                cancelLabel: 'Отмена',
                              })
                              if (!ok) return
                              try {
                                await deleteProductVariant(productId, row.id!)
                                reload()
                              } catch (e) {
                                setSaveError(e instanceof Error ? e.message : 'Ошибка')
                              }
                            }}
                          />
                        ) : (
                          <VariantDeleteIconButton
                            disabled={dimDisabled}
                            title="Убрать строку"
                            ariaLabel="Убрать строку"
                            onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="product-variants-toolbar">
        <button
          type="button"
          className="product-dim-add-block"
          disabled={dimDisabled}
          onClick={() => setRows((prev) => [...prev, emptyRow(requiresSize)])}
        >
          <svg
            className="product-dim-add-block__icon"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M12 6v12M6 12h12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          Добавить вариант
        </button>
      </div>
      {saveError ? <p className="error-text product-create-error">{saveError}</p> : null}
    </section>
  )
},
)
