import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createReceipt,
  findProductVariantForReceipt,
  getReceipt,
  patchReceipt,
  getInventoryColorsForProductSku,
  getInventorySizesForProductSkuAndColor,
  getInventoryProductSkus,
  resolvePublicUploadSrc,
  type DictionaryItem,
  type ProductVariantFindResponse,
} from '../api'
import { DictionaryFormCombobox, mergeDictionaryItemsWithCurrent } from './DictionaryFormCombobox'
import { FormDateField } from './FormDateField'
import { ProductDimNumberInput } from './ProductDimNumberInput'
import { ActionBar } from './ActionBar'

type Props = { receiptId?: string }

function useDebounced<T>(value: T, delayMs: number): T {
  const [d, setD] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setD(value), delayMs)
    return () => window.clearTimeout(t)
  }, [value, delayMs])
  return d
}

function localTodayYmd(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function ReceiptForm({ receiptId }: Props) {
  const navigate = useNavigate()
  const isEdit = Boolean(receiptId?.trim())
  const formId = useId()
  const [ready, setReady] = useState(!isEdit)
  const [loadedVariantId, setLoadedVariantId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState('')

  const [skuOptions, setSkuOptions] = useState<string[]>([])
  const [sku, setSku] = useState('')
  const debouncedSku = useDebounced(sku, 420)
  const skuSelectOptions = useMemo(() => {
    const t = sku.trim()
    if (t && !skuOptions.includes(t)) {
      return [...skuOptions, t].sort((a, b) => a.localeCompare(b, 'ru', { sensitivity: 'base' }))
    }
    return skuOptions
  }, [skuOptions, sku])

  const skuItems: DictionaryItem[] = useMemo(
    () =>
      skuSelectOptions.map((s) => ({
        id: s,
        name: s,
        is_active: true,
        created_at: '',
        created_by: null,
        updated_at: null,
        updated_by: null,
      })),
    [skuSelectOptions],
  )

  const [colorId, setColorId] = useState('')
  const [sizeId, setSizeId] = useState('')
  const [colors, setColors] = useState<DictionaryItem[]>([])
  const [sizes, setSizes] = useState<DictionaryItem[]>([])
  const [findRes, setFindRes] = useState<ProductVariantFindResponse | null>(null)
  const [findLoading, setFindLoading] = useState(false)
  const [quantityStr, setQuantityStr] = useState('')
  const [receiptDate, setReceiptDate] = useState(() => localTodayYmd())
  const [comment, setComment] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [successFlash, setSuccessFlash] = useState('')
  const findSeq = useRef(0)

  const showSize = Boolean(findRes?.needs_size || findRes?.variant?.requires_size)

  useEffect(() => {
    let cancelled = false
    getInventoryProductSkus()
      .then((list) => {
        if (!cancelled) setSkuOptions(list)
      })
      .catch(() => {
        if (!cancelled) setSkuOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const colorItemsForCombo = useMemo(
    () => mergeDictionaryItemsWithCurrent(colors, colorId, undefined),
    [colors, colorId],
  )

  const sizeItemsForCombo = useMemo(
    () => mergeDictionaryItemsWithCurrent(sizes, sizeId, undefined),
    [sizes, sizeId],
  )

  useEffect(() => {
    const q = sku.trim()
    const cid = colorId.trim()
    if (!q || !cid) {
      setSizes([])
      return
    }
    let cancelled = false
    getInventorySizesForProductSkuAndColor(q, cid)
      .then((list) => {
        if (!cancelled) setSizes(list)
      })
      .catch(() => {
        if (!cancelled) setSizes([])
      })
    return () => {
      cancelled = true
    }
  }, [sku, colorId])

  useEffect(() => {
    const q = sku.trim()
    if (!q) {
      setColors([])
      return
    }
    let cancelled = false
    getInventoryColorsForProductSku(q)
      .then((list) => {
        if (!cancelled) setColors(list)
      })
      .catch(() => {
        if (!cancelled) setColors([])
      })
    return () => {
      cancelled = true
    }
  }, [sku])

  useEffect(() => {
    if (!isEdit || !receiptId) return
    let cancelled = false
    setLoadError('')
    getReceipt(receiptId)
      .then((d) => {
        if (cancelled) return
        setLoadedVariantId(d.variant_id)
        setSku(d.sku)
        setColorId(d.color_id || '')
        setSizeId(d.size_id || '')
        setQuantityStr(String(d.quantity))
        setReceiptDate(d.created_at.slice(0, 10))
        setComment(d.comment || '')
        setReady(true)
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Ошибка загрузки')
      })
    return () => {
      cancelled = true
    }
  }, [isEdit, receiptId])

  useEffect(() => {
    if (!showSize && sizeId) {
      setSizeId('')
    }
  }, [showSize, sizeId])

  useEffect(() => {
    if (!ready) return
    const q = debouncedSku.trim()
    const cid = colorId.trim()
    if (!q || !cid) {
      setFindRes(null)
      setFindLoading(false)
      return
    }
    const seq = ++findSeq.current
    setFindLoading(true)
    setSubmitError('')
    findProductVariantForReceipt({
      sku: q,
      color_id: cid,
      size_id: showSize ? sizeId.trim() || null : null,
    })
      .then((r) => {
        if (seq !== findSeq.current) return
        setFindRes(r)
      })
      .catch(() => {
        if (seq !== findSeq.current) return
        setFindRes({ found: false, variant: null, needs_size: false })
        setSubmitError('Не удалось выполнить поиск')
      })
      .finally(() => {
        if (seq === findSeq.current) setFindLoading(false)
      })
  }, [debouncedSku, colorId, sizeId, showSize, ready])

  const quantityNum = Number(quantityStr.replace(',', '.'))
  const quantityValid =
    quantityStr.trim() !== '' &&
    Number.isFinite(quantityNum) &&
    Math.floor(quantityNum) === quantityNum &&
    quantityNum >= 1

  const receiptDateValid =
    /^\d{4}-\d{2}-\d{2}$/.test(receiptDate) && receiptDate <= localTodayYmd()

  const canSubmit = Boolean(
    findRes?.found &&
      findRes.variant &&
      quantityValid &&
      receiptDateValid &&
      !submitting &&
      ready,
  )

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitError('')
    if (!findRes?.found || !findRes.variant) {
      setSubmitError('Сначала выберите артикул и цвет')
      return
    }
    if (!quantityValid) {
      setSubmitError('Укажите количество не менее 1')
      return
    }
    if (!receiptDateValid) {
      setSubmitError('Укажите дату приёмки не позже сегодняшнего дня')
      return
    }
    setSubmitting(true)
    try {
      if (isEdit && receiptId) {
        const qty = Math.floor(quantityNum)
        const note = comment.trim() || null
        const nextVid = findRes.variant.variant_id
        if (nextVid !== loadedVariantId) {
          await patchReceipt(receiptId, {
            variant_id: nextVid,
            quantity: qty,
            comment: note,
            receipt_date: receiptDate,
          })
        } else {
          await patchReceipt(receiptId, {
            quantity: qty,
            comment: note,
            receipt_date: receiptDate,
          })
        }
        setLoadedVariantId(nextVid)
        setSuccessFlash('Сохранено')
      } else {
        await createReceipt({
          variant_id: findRes.variant.variant_id,
          quantity: Math.floor(quantityNum),
          comment: comment.trim() || null,
          receipt_date: receiptDate,
        })
        setSku('')
        setColorId('')
        setSizeId('')
        setQuantityStr('')
        setReceiptDate(localTodayYmd())
        setComment('')
        setFindRes(null)
        findSeq.current += 1
        setSuccessFlash('Товар принят на склад')
      }
      window.setTimeout(() => setSuccessFlash(''), 5000)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSubmitting(false)
    }
  }

  const v = findRes?.variant
  const imgSrc = v?.first_image_url ? resolvePublicUploadSrc(v.first_image_url) : ''

  if (isEdit && !ready && !loadError) {
    return <p className="receipt-form__lookup-msg">Загрузка…</p>
  }
  if (loadError) {
    return <p className="error-text">{loadError}</p>
  }

  return (
    <div className="receipt-form">
      {successFlash ? (
        <p className="receipt-form__success" role="status">
          {successFlash}
        </p>
      ) : null}

      <form id={formId} className="auth-form product-create-form" onSubmit={onSubmit} noValidate>
        <label className="field-label" htmlFor={`${formId}-receipt-date`}>
          Дата приёмки
          <span className="field-label__required" aria-label="обязательное поле">
            *
          </span>
        </label>
        <FormDateField
          id={`${formId}-receipt-date`}
          value={receiptDate}
          onChange={setReceiptDate}
          max={localTodayYmd()}
          ariaLabel="Дата приёмки"
        />

        <label className="field-label" htmlFor={`${formId}-sku`}>
          Артикул
          <span className="field-label__required" aria-label="обязательное поле">
            *
          </span>
        </label>
        <DictionaryFormCombobox
          id={`${formId}-sku`}
          items={skuItems}
          value={sku}
          onChange={(next) => {
            setSku(next)
            setColorId('')
            setSizeId('')
          }}
          required
          allowClear
        />

        <label className="field-label" htmlFor={`${formId}-color`}>
          Цвет
          <span className="field-label__required" aria-label="обязательное поле">
            *
          </span>
        </label>
        <DictionaryFormCombobox
          id={`${formId}-color`}
          items={colorItemsForCombo}
          value={colorId}
          onChange={(id) => {
            setColorId(id)
            setSizeId('')
          }}
          required
          allowClear
          disabled={!sku.trim()}
        />

        {showSize ? (
          <>
            <label className="field-label" htmlFor={`${formId}-size`}>
              Размер
              <span className="field-label__required" aria-label="обязательное поле">
                *
              </span>
            </label>
            <DictionaryFormCombobox
              id={`${formId}-size`}
              items={sizeItemsForCombo}
              value={sizeId}
              onChange={setSizeId}
              required
              allowClear
              disabled={!sku.trim() || !colorId.trim()}
            />
          </>
        ) : null}

        <label className="field-label" htmlFor={`${formId}-qty`}>
          Количество
          <span className="field-label__required" aria-label="обязательное поле">
            *
          </span>
        </label>
        <ProductDimNumberInput
          id={`${formId}-qty`}
          value={quantityStr}
          onChange={(next) => {
            const t = next.trim()
            if (t === '') {
              setQuantityStr('')
              return
            }
            const n = Math.floor(parseFloat(t.replace(',', '.')) || 0)
            if (n < 1) {
              setQuantityStr('')
              return
            }
            setQuantityStr(String(n))
          }}
          inputClassName="field-input field-input--narrow"
        />

        <label className="field-label" htmlFor={`${formId}-comment`}>
          Комментарий
        </label>
        <textarea
          id={`${formId}-comment`}
          className="field-input"
          rows={3}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />

        <div className="receipt-form__lookup" aria-live="polite">
          {findLoading ? (
            <p className="receipt-form__lookup-msg">Поиск варианта…</p>
          ) : findRes?.found && v ? (
            <div className="receipt-form__card">
              <p className="receipt-form__product-name">{v.product_name}</p>
              <p className="receipt-form__dims">
                Клиент: {v.client_name?.trim() ? v.client_name : '—'}
              </p>
              {v.product_type_name ? (
                <p className="receipt-form__dims">Тип товара: {v.product_type_name}</p>
              ) : null}
              <p className="receipt-form__dims">
                Габариты (Д×Ш×В): {v.length} × {v.width} × {v.height} см
              </p>
              {imgSrc ? (
                <>
                  <div className="receipt-form__photo-wrap">
                    <img src={imgSrc} alt="" className="receipt-form__photo" />
                  </div>
                  <p className="receipt-form__photo-note">Фотография общая на все цвета товара.</p>
                </>
              ) : null}
            </div>
          ) : debouncedSku.trim() && colorId.trim() && !findLoading ? (
            findRes?.needs_size && !sizeId.trim() ? (
              <p className="receipt-form__lookup-msg">Укажите размер</p>
            ) : (
              <p className="error-text receipt-form__lookup-msg">Товар не найден</p>
            )
          ) : null}
        </div>

        {submitError ? <p className="error-text product-create-error">{submitError}</p> : null}
      </form>

      <ActionBar
        primaryLabel={isEdit ? 'Сохранить' : 'Принять на склад'}
        submitFormId={formId}
        primaryDisabled={!canSubmit}
        onSecondary={() => navigate('/inventory/receipts')}
      />
    </div>
  )
}
