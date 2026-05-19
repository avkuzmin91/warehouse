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
  type DictionaryItem,
  type ProductVariantFindResponse,
} from '../api/inventoryApi'
import { resolvePublicUploadSrc } from '../api/constants'
import { me } from '../api/sessionAuth'
import type { User } from '../api/typesUser'
import { deleteReceipt } from '../api/adminApi'
import { ConfirmDialog } from './ModalDialog'
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

function ReceiptStatusBadge({
  status,
  overdue,
}: {
  status: 'pending' | 'accepted'
  overdue?: boolean
}) {
  const pending = status === 'pending'
  const overdueActive = Boolean(pending && overdue)
  const className = [
    'receipt-form__status-badge',
    pending ? 'receipt-form__status-badge--pending' : 'receipt-form__status-badge--accepted',
    overdueActive ? 'receipt-form__status-badge--overdue' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div
      className={className}
      role="status"
      title={overdueActive ? 'Просроченное поступление' : undefined}
    >
      <span className="receipt-form__status-badge__mark" aria-hidden />
      <span className="receipt-form__status-badge__label">
        {pending ? 'Ожидает приемки' : 'Принят на склад'}
      </span>
      <span className="receipt-form__status-badge__hint">
        {pending ? (overdueActive ? 'просрочено' : 'ещё не на остатках') : 'учтён на складе'}
      </span>
    </div>
  )
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
  const [receiptStatus, setReceiptStatus] = useState<'pending' | 'accepted'>('accepted')
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const findSeq = useRef(0)

  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const isAdmin = currentUser?.role === 'admin'

  const showSize = Boolean(findRes?.needs_size || findRes?.variant?.requires_size)

  useEffect(() => {
    let cancelled = false
    me()
      .then((u) => {
        if (!cancelled) setCurrentUser(u)
      })
      .catch(() => {
        if (!cancelled) setCurrentUser(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

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
        setReceiptStatus(d.receipt_status)
        setReady(true)
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Ошибка загрузки')
      })
    return () => {
      cancelled = true
    }
  }, [isEdit, receiptId])

  /** Не сбрасывать размер до ответа find: при открытии редактирования showSize ещё false, а sizeId уже из API. */
  useEffect(() => {
    if (findRes === null) return
    if (!showSize && sizeId) {
      setSizeId('')
    }
  }, [showSize, sizeId, findRes])

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
      /** Для одежды бэкенд ждёт размер; передаём сразу при загрузке формы редактирования (не ждём showSize). */
      size_id: sizeId.trim() || null,
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
  }, [debouncedSku, colorId, sizeId, ready])

  const quantityNum = Number(quantityStr.replace(',', '.'))
  const quantityValid =
    quantityStr.trim() !== '' &&
    Number.isFinite(quantityNum) &&
    Math.floor(quantityNum) === quantityNum &&
    quantityNum >= 1

  const receiptDateFormatOk = /^\d{4}-\d{2}-\d{2}$/.test(receiptDate)
  const receiptDateOkAccepted =
    receiptDateFormatOk && receiptDate <= localTodayYmd()
  /** Просрочка: «Ожидает», дата операции раньше сегодня (ТЗ поступления). */
  const receiptPendingOverdue =
    receiptStatus === 'pending' &&
    receiptDateFormatOk &&
    receiptDate < localTodayYmd()

  const canSubmitBase = Boolean(
    findRes?.found &&
      findRes.variant &&
      quantityValid &&
      receiptDateFormatOk &&
      !submitting &&
      ready,
  )

  const canSubmitEdit = Boolean(
    canSubmitBase && (receiptStatus === 'accepted' ? receiptDateOkAccepted : true),
  )

  const canSubmit = isEdit ? canSubmitEdit : canSubmitBase

  const canSubmitAcceptCreate = Boolean(canSubmitBase && receiptDateOkAccepted)

  async function submitCreate(intent: 'pending' | 'accepted') {
    setSubmitError('')
    if (!findRes?.found || !findRes.variant) {
      setSubmitError('Сначала выберите штрих-код и цвет')
      return
    }
    if (!quantityValid) {
      setSubmitError('Укажите количество не менее 1')
      return
    }
    if (!receiptDateFormatOk) {
      setSubmitError('Укажите дату поступления')
      return
    }
    if (intent === 'accepted' && !receiptDateOkAccepted) {
      setSubmitError('Для принятого поступления дата не может быть позже сегодняшнего дня')
      return
    }
    setSubmitting(true)
    try {
      await createReceipt({
        variant_id: findRes.variant.variant_id,
        quantity: Math.floor(quantityNum),
        comment: comment.trim() || null,
        receipt_date: receiptDate,
        receipt_status: intent,
      })
      navigate('/inventory/receipts')
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSubmitting(false)
    }
  }

  async function finalizeReceipt() {
    if (!receiptId?.trim()) return
    setSubmitError('')
    if (!findRes?.found || !findRes.variant) {
      setSubmitError('Сначала выберите штрих-код и цвет')
      return
    }
    if (!quantityValid) {
      setSubmitError('Укажите количество не менее 1')
      return
    }
    if (!receiptDateFormatOk) {
      setSubmitError('Укажите дату поступления')
      return
    }
    if (!receiptDateOkAccepted) {
      setSubmitError('Для принятого поступления дата не может быть позже сегодняшнего дня')
      return
    }
    setSubmitting(true)
    try {
      const qty = Math.floor(quantityNum)
      const note = comment.trim() || null
      const nextVid = findRes.variant.variant_id
      const base = {
        quantity: qty,
        comment: note,
        receipt_date: receiptDate,
        receipt_status: 'accepted' as const,
      }
      if (nextVid !== loadedVariantId) {
        await patchReceipt(receiptId, { ...base, variant_id: nextVid })
      } else {
        await patchReceipt(receiptId, base)
      }
      setLoadedVariantId(nextVid)
      navigate('/inventory/receipts')
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSubmitting(false)
    }
  }

  async function revertReceiptToPending() {
    if (!receiptId?.trim()) return
    setSubmitError('')
    setSubmitting(true)
    try {
      await patchReceipt(receiptId, { receipt_status: 'pending' })
      setReceiptStatus('pending')
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeleteReceipt() {
    if (!receiptId?.trim()) return
    setSubmitError('')
    setDeleteSubmitting(true)
    try {
      await deleteReceipt(receiptId)
      setDeleteOpen(false)
      navigate('/inventory/receipts')
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Ошибка удаления')
      setDeleteOpen(false)
    } finally {
      setDeleteSubmitting(false)
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isEdit) {
      void submitCreate('accepted')
      return
    }
    setSubmitError('')
    if (!findRes?.found || !findRes.variant) {
      setSubmitError('Сначала выберите штрих-код и цвет')
      return
    }
    if (!quantityValid) {
      setSubmitError('Укажите количество не менее 1')
      return
    }
    if (!receiptDateFormatOk) {
      setSubmitError('Укажите дату поступления')
      return
    }
    if (receiptStatus === 'accepted' && !receiptDateOkAccepted) {
      setSubmitError('Для принятого поступления дата не может быть позже сегодняшнего дня')
      return
    }
    setSubmitting(true)
    try {
      if (receiptId) {
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
        navigate('/inventory/receipts')
      }
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSubmitting(false)
    }
  }

  const v = findRes?.variant
  const imgSrc = v?.first_image_url ? resolvePublicUploadSrc(v.first_image_url) : ''
  const showStatusAtTop = isEdit && ready

  if (isEdit && !ready && !loadError) {
    return <p className="receipt-form__lookup-msg">Загрузка…</p>
  }
  if (loadError) {
    return <p className="error-text">{loadError}</p>
  }

  return (
    <div className="receipt-form">
      <form id={formId} className="auth-form product-create-form" onSubmit={onSubmit} noValidate>
        {showStatusAtTop ? (
          <div className="receipt-form__status-banner-wrap">
            <ReceiptStatusBadge status={receiptStatus} overdue={receiptPendingOverdue} />
          </div>
        ) : null}
        <label className="field-label" htmlFor={`${formId}-receipt-date`}>
          Дата поступления
          <span className="field-label__required" aria-label="обязательное поле">
            *
          </span>
        </label>
        <FormDateField
          id={`${formId}-receipt-date`}
          value={receiptDate}
          onChange={setReceiptDate}
          max={isEdit && receiptStatus === 'accepted' ? localTodayYmd() : undefined}
          ariaLabel="Дата поступления"
        />

        <label className="field-label" htmlFor={`${formId}-sku`}>
          Штрих-код
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
          listPortal
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
          listPortal
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
              listPortal
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
          className="field-input inventory-operation-comment"
          rows={3}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />

        <div className="receipt-form__lookup" aria-live="polite">
          {findLoading ? (
            <p className="receipt-form__lookup-msg">Поиск варианта…</p>
          ) : findRes?.found && v ? (
            <div className="receipt-form__card">
              <div
                className={
                  imgSrc
                    ? 'receipt-form__card-body'
                    : 'receipt-form__card-body receipt-form__card-body--no-photo'
                }
              >
                {imgSrc ? (
                  <div className="receipt-form__card-media">
                    <div className="receipt-form__photo-wrap">
                      <img src={imgSrc} alt="" className="receipt-form__photo" />
                    </div>
                  </div>
                ) : null}
                <div className="receipt-form__card-details">
                  <p className="receipt-form__product-name receipt-form__product-name--details">{v.product_name}</p>
                  <p className="receipt-form__dims">
                    Клиент: {v.client_name?.trim() ? v.client_name : '—'}
                  </p>
                  <p className="receipt-form__dims">
                    Габариты: {v.length} × {v.width} × {v.height} см
                  </p>
                </div>
              </div>
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

      {isEdit ? (
        <ActionBar
          leading={
            receiptStatus === 'pending' ? (
              <div className="users-actions">
                <button
                  type="button"
                  className="btn btn--primary btn--form-action"
                  disabled={submitting}
                  onClick={() => void finalizeReceipt()}
                >
                  Принять на склад
                </button>
              </div>
            ) : receiptStatus === 'accepted' ? (
              <div className="users-actions">
                <button
                  type="button"
                  className="btn btn--primary btn--form-action"
                  disabled={submitting}
                  onClick={() => void revertReceiptToPending()}
                >
                  Вернуть в ожидание
                </button>
              </div>
            ) : undefined
          }
          trailingEnd={
            isAdmin ? (
              <button
                type="button"
                className="btn btn--secondary btn--form-action action-bar__btn--danger"
                disabled={submitting || deleteSubmitting}
                onClick={() => setDeleteOpen(true)}
              >
                Удалить
              </button>
            ) : undefined
          }
          primaryLabel="Сохранить"
          submitFormId={formId}
          primaryDisabled={!canSubmit}
          onSecondary={() => navigate('/inventory/receipts')}
        />
      ) : (
        <div className="product-form-actions action-bar">
          <div className="action-bar__trailing">
            <button
              type="button"
              className="btn btn--primary btn--form-action"
              disabled={!canSubmitBase}
              onClick={() => void submitCreate('pending')}
            >
              Запланировать поступление
            </button>
            <button
              type="button"
              className="btn btn--primary btn--form-action"
              disabled={!canSubmitAcceptCreate}
              onClick={() => void submitCreate('accepted')}
            >
              Принять на склад
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--form-action"
              onClick={() => navigate('/inventory/receipts')}
            >
              Отмена
            </button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={deleteOpen}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => void handleDeleteReceipt()}
        ariaLabel="Подтверждение удаления поступления"
        message="Удалить это поступление? Операция необратима."
        confirmLabel="Удалить"
        confirmVariant="danger"
        confirmDisabled={deleteSubmitting}
      />
    </div>
  )
}
