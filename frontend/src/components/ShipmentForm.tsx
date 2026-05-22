import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createShipment,
  findProductVariantForReceipt,
  getInventoryColorsForProductSku,
  getInventoryProductSkus,
  getInventorySizesForProductSkuAndColor,
  getShipment,
  getTypedBalance,
  patchShipment,
  type DictionaryItem,
  type ProductVariantFindResponse,
  type ShipmentType,
  type TypedBalanceResponse,
} from '../api/inventoryApi'
import { resolvePublicUploadSrc } from '../api/constants'
import { me } from '../api/sessionAuth'
import type { User } from '../api/typesUser'
import { deleteShipment } from '../api/adminApi'
import { ConfirmDialog } from './ModalDialog'
import { DictionaryFormCombobox, mergeDictionaryItemsWithCurrent } from './DictionaryFormCombobox'
import { FormDateField } from './FormDateField'
import { ProductDimNumberInput } from './ProductDimNumberInput'
import { ActionBar } from './ActionBar'

type Props = { shipmentId?: string }

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

function ShipmentStatusBadge({
  status,
  overdue,
}: {
  status: 'pending' | 'shipped'
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
      title={overdueActive ? 'Просроченная отгрузка' : undefined}
    >
      <span className="receipt-form__status-badge__mark" aria-hidden />
      <span className="receipt-form__status-badge__label">
        {pending ? 'Ожидает отгрузки' : 'Отгружен'}
      </span>
      <span className="receipt-form__status-badge__hint">
        {pending
          ? overdueActive
            ? 'просрочено'
            : 'ещё не списано со склада'
          : 'списано со склада'}
      </span>
    </div>
  )
}

/** Сегмент-контрол для выбора типа отгрузки */
function ShipmentTypeSegment({
  value,
  onChange,
  disabled,
}: {
  value: ShipmentType
  onChange: (v: ShipmentType) => void
  disabled?: boolean
}) {
  return (
    <div className="shipment-type-segment" role="group" aria-label="Тип отгрузки">
      <button
        type="button"
        className={`shipment-type-segment__btn${value === 'standard' ? ' shipment-type-segment__btn--active' : ''}`}
        onClick={() => onChange('standard')}
        disabled={disabled}
        aria-pressed={value === 'standard'}
      >
        Годный
      </button>
      <button
        type="button"
        className={`shipment-type-segment__btn${value === 'defect' ? ' shipment-type-segment__btn--active shipment-type-segment__btn--defect' : ''}`}
        onClick={() => onChange('defect')}
        disabled={disabled}
        aria-pressed={value === 'defect'}
      >
        Брак
      </button>
    </div>
  )
}

/** Компактный блок остатков: Годный / Брак / Не проверено */
function TypedBalanceBlock({
  loading,
  balance,
}: {
  loading: boolean
  balance: TypedBalanceResponse | null
}) {
  if (loading) {
    return <p className="typed-balance__loading">Остатки: загрузка…</p>
  }
  if (!balance) return null
  return (
    <div className="typed-balance">
      <div className="typed-balance__item typed-balance__item--good">
        <span className="typed-balance__qty">{Math.max(0, balance.good_qty)}</span>
        <span className="typed-balance__label">Годный</span>
      </div>
      <div className="typed-balance__item typed-balance__item--defect">
        <span className="typed-balance__qty">{Math.max(0, balance.defect_qty)}</span>
        <span className="typed-balance__label">Брак</span>
      </div>
      <div className="typed-balance__item typed-balance__item--uninspected">
        <span className="typed-balance__qty">{Math.max(0, balance.uninspected_qty)}</span>
        <span className="typed-balance__label">Не проверено</span>
      </div>
    </div>
  )
}

export function ShipmentForm({ shipmentId }: Props) {
  const navigate = useNavigate()
  const isEdit = Boolean(shipmentId?.trim())
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
  const [shipmentDate, setShipmentDate] = useState(() => localTodayYmd())
  const [comment, setComment] = useState('')
  const [shipmentStatus, setShipmentStatus] = useState<'pending' | 'shipped'>('shipped')
  const [shipmentType, setShipmentType] = useState<ShipmentType>('standard')
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const findSeq = useRef(0)

  const [typedBalance, setTypedBalance] = useState<TypedBalanceResponse | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)

  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const isAdmin = currentUser?.role === 'admin'

  const commentRef = useRef<HTMLTextAreaElement>(null)

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
    if (!isEdit || !shipmentId) return
    let cancelled = false
    setLoadError('')
    getShipment(shipmentId)
      .then((d) => {
        if (cancelled) return
        setLoadedVariantId(d.variant_id)
        setSku(d.sku)
        setColorId(d.color_id || '')
        setSizeId(d.size_id || '')
        setQuantityStr(String(d.quantity))
        setShipmentDate(d.created_at.slice(0, 10))
        setComment(d.comment || '')
        setShipmentStatus(d.shipment_status)
        setShipmentType(d.shipment_type ?? 'standard')
        setReady(true)
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Ошибка загрузки')
      })
    return () => {
      cancelled = true
    }
  }, [isEdit, shipmentId])

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

  useEffect(() => {
    const v = findRes?.variant
    if (!findRes?.found || !v) {
      setTypedBalance(null)
      return
    }
    let cancelled = false
    setBalanceLoading(true)
    getTypedBalance({
      product_id: v.product_id,
      color_id: v.color_id,
      size_id: v.size_id,
    })
      .then((r) => {
        if (!cancelled) setTypedBalance(r)
      })
      .catch(() => {
        if (!cancelled) setTypedBalance(null)
      })
      .finally(() => {
        if (!cancelled) setBalanceLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [findRes])

  const quantityNum = Number(quantityStr.replace(',', '.'))
  const quantityValid =
    quantityStr.trim() !== '' &&
    Number.isFinite(quantityNum) &&
    Math.floor(quantityNum) === quantityNum &&
    quantityNum >= 1

  // Доступный остаток по выбранному типу
  const availableBalance =
    typedBalance == null
      ? null
      : shipmentType === 'defect'
        ? Math.max(0, typedBalance.defect_qty)
        : Math.max(0, typedBalance.good_qty)

  const shipmentDateFormatOk = /^\d{4}-\d{2}-\d{2}$/.test(shipmentDate)
  const shipmentDateOkShipped = shipmentDateFormatOk && shipmentDate <= localTodayYmd()
  /** Просрочка: «Ожидает», дата операции раньше сегодня (ТЗ отгрузки). */
  const shipmentPendingOverdue =
    shipmentStatus === 'pending' &&
    shipmentDateFormatOk &&
    shipmentDate < localTodayYmd()

  const stockEnoughForShipped =
    availableBalance == null || !quantityValid || availableBalance >= Math.floor(quantityNum)

  const canSubmitBase = Boolean(
    findRes?.found &&
      findRes.variant &&
      quantityValid &&
      shipmentDateFormatOk &&
      !submitting &&
      ready,
  )

  const canSubmitEdit = Boolean(
    canSubmitBase && (shipmentStatus === 'shipped' ? shipmentDateOkShipped : true),
  )

  const canSubmit = isEdit ? canSubmitEdit : canSubmitBase

  const canSubmitShippedCreate = Boolean(
    canSubmitBase && shipmentDateOkShipped && stockEnoughForShipped,
  )

  async function submitCreate(intent: 'pending' | 'shipped') {
    setSubmitError('')
    if (!findRes?.found || !findRes.variant) {
      setSubmitError('Сначала выберите штрих-код и цвет')
      return
    }
    if (!quantityValid) {
      setSubmitError('Укажите количество не менее 1')
      return
    }
    if (!shipmentDateFormatOk) {
      setSubmitError('Укажите дату отгрузки')
      return
    }
    if (intent === 'shipped') {
      if (!shipmentDateOkShipped) {
        setSubmitError('Для отгруженной позиции дата не может быть позже сегодняшнего дня')
        return
      }
      if (!stockEnoughForShipped) {
        const avail = availableBalance ?? 0
        setSubmitError(
          shipmentType === 'defect'
            ? `Недостаточно брака на складе: доступно ${avail}, требуется ${Math.floor(quantityNum)}`
            : `Недостаточно доступного товара: доступно ${avail}, требуется ${Math.floor(quantityNum)}`,
        )
        return
      }
    }
    setSubmitting(true)
    try {
      await createShipment({
        variant_id: findRes.variant.variant_id,
        quantity: Math.floor(quantityNum),
        comment: comment.trim() || null,
        shipment_date: shipmentDate,
        shipment_status: intent,
        shipment_type: shipmentType,
      })
      navigate('/inventory/shipments')
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSubmitting(false)
    }
  }

  async function finalizeShipment() {
    if (!shipmentId?.trim()) return
    setSubmitError('')
    if (!findRes?.found || !findRes.variant) {
      setSubmitError('Сначала выберите штрих-код и цвет')
      return
    }
    if (!quantityValid) {
      setSubmitError('Укажите количество не менее 1')
      return
    }
    if (!shipmentDateFormatOk) {
      setSubmitError('Укажите дату отгрузки')
      return
    }
    if (!shipmentDateOkShipped) {
      setSubmitError('Для отгруженной позиции дата не может быть позже сегодняшнего дня')
      return
    }
    if (!stockEnoughForShipped) {
      const avail = availableBalance ?? 0
      setSubmitError(
        shipmentType === 'defect'
          ? `Недостаточно брака на складе: доступно ${avail}, требуется ${Math.floor(quantityNum)}`
          : `Недостаточно доступного товара: доступно ${avail}, требуется ${Math.floor(quantityNum)}`,
      )
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
        shipment_date: shipmentDate,
        shipment_status: 'shipped' as const,
        shipment_type: shipmentType,
      }
      if (nextVid !== loadedVariantId) {
        await patchShipment(shipmentId, { ...base, variant_id: nextVid })
      } else {
        await patchShipment(shipmentId, base)
      }
      setLoadedVariantId(nextVid)
      navigate('/inventory/shipments')
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSubmitting(false)
    }
  }

  async function revertShipmentToPending() {
    if (!shipmentId?.trim()) return
    setSubmitError('')
    setSubmitting(true)
    try {
      await patchShipment(shipmentId, { shipment_status: 'pending' })
      setShipmentStatus('pending')
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeleteShipment() {
    if (!shipmentId?.trim()) return
    setSubmitError('')
    setDeleteSubmitting(true)
    try {
      await deleteShipment(shipmentId)
      setDeleteOpen(false)
      navigate('/inventory/shipments')
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Ошибка удаления')
      setDeleteOpen(false)
    } finally {
      setDeleteSubmitting(false)
    }
  }

  // Auto-resize comment textarea
  useEffect(() => {
    const el = commentRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [comment])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isEdit) {
      void submitCreate('shipped')
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
    if (!shipmentDateFormatOk) {
      setSubmitError('Укажите дату отгрузки')
      return
    }
    if (shipmentStatus === 'shipped' && !shipmentDateOkShipped) {
      setSubmitError('Для отгруженной позиции дата не может быть позже сегодняшнего дня')
      return
    }
    setSubmitting(true)
    try {
      if (shipmentId) {
        const qty = Math.floor(quantityNum)
        const note = comment.trim() || null
        const nextVid = findRes.variant.variant_id
        if (nextVid !== loadedVariantId) {
          await patchShipment(shipmentId, {
            variant_id: nextVid,
            quantity: qty,
            comment: note,
            shipment_date: shipmentDate,
            shipment_type: shipmentType,
          })
        } else {
          await patchShipment(shipmentId, {
            quantity: qty,
            comment: note,
            shipment_date: shipmentDate,
            shipment_type: shipmentType,
          })
        }
        setLoadedVariantId(nextVid)
        navigate('/inventory/shipments')
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
            <ShipmentStatusBadge status={shipmentStatus} overdue={shipmentPendingOverdue} />
          </div>
        ) : null}
        <label className="field-label" htmlFor={`${formId}-shipment-date`}>
          Дата отгрузки
          <span className="field-label__required" aria-label="обязательное поле">
            *
          </span>
        </label>
        <FormDateField
          id={`${formId}-shipment-date`}
          value={shipmentDate}
          onChange={setShipmentDate}
          max={isEdit && shipmentStatus === 'shipped' ? localTodayYmd() : undefined}
          ariaLabel="Дата отгрузки"
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

        <label className="field-label">
          Тип отгрузки
        </label>
        <ShipmentTypeSegment
          value={shipmentType}
          onChange={setShipmentType}
          disabled={submitting}
        />

        {findRes?.found && v ? (
          <TypedBalanceBlock loading={balanceLoading} balance={typedBalance} />
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

        {findRes?.found && v && !balanceLoading && availableBalance != null ? (
          <small
            className={`field-hint inv-balance-hint ${availableBalance > 0 ? 'qty-positive' : 'qty-zero'}`}
          >
            {shipmentType === 'defect'
              ? `Доступно брака: ${availableBalance}`
              : `Доступно годного: ${availableBalance}`}
          </small>
        ) : null}

        <label className="field-label" htmlFor={`${formId}-comment`}>
          Комментарий
        </label>
        <textarea
          ref={commentRef}
          id={`${formId}-comment`}
          className="field-input inventory-operation-comment"
          rows={1}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          style={{ overflow: 'hidden' }}
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
            shipmentStatus === 'pending' ? (
              <div className="users-actions">
                <button
                  type="button"
                  className="btn btn--primary btn--form-action"
                  disabled={submitting}
                  onClick={() => void finalizeShipment()}
                >
                  Подтвердить отгрузку
                </button>
              </div>
            ) : shipmentStatus === 'shipped' ? (
              <div className="users-actions">
                <button
                  type="button"
                  className="btn btn--primary btn--form-action"
                  disabled={submitting}
                  onClick={() => void revertShipmentToPending()}
                >
                  Вернуть в ожидание
                </button>
              </div>
            ) : undefined
          }
          trailingEnd={
            isAdmin && shipmentStatus === 'pending' ? (
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
          onSecondary={() => navigate('/inventory/shipments')}
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
              Запланировать отгрузку
            </button>
            <button
              type="button"
              className="btn btn--primary btn--form-action"
              disabled={!canSubmitShippedCreate}
              onClick={() => void submitCreate('shipped')}
            >
              Подтвердить отгрузку
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--form-action"
              onClick={() => navigate('/inventory/shipments')}
            >
              Отмена
            </button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={deleteOpen}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => void handleDeleteShipment()}
        ariaLabel="Подтверждение удаления отгрузки"
        message="Удалить эту отгрузку? Операция необратима."
        confirmLabel="Удалить"
        confirmVariant="danger"
        confirmDisabled={deleteSubmitting}
      />
    </div>
  )
}
