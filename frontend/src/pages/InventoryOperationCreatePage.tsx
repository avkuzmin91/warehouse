import { useEffect, useId, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ActionBar } from '../components/ActionBar'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { DictionaryFormCombobox } from '../components/DictionaryFormCombobox'
import { PageContainer } from '../components/PageContainer'
import {
  type DictionaryItem,
  type InventoryOpType,
  type InventoryProductLookup,
  createInventoryOperation,
  getInventoryClients,
  getInventoryColors,
  getInventoryProducts,
  getInventorySingleBalance,
  getInventorySizes,
} from '../api'

type Props = {
  opType: InventoryOpType
}

const TITLES: Record<InventoryOpType, { title: string; primary: string; backTo: string }> = {
  in: { title: 'Новое поступление', primary: 'Зарегистрировать', backTo: '/inventory/receipts' },
  out: { title: 'Новая отгрузка', primary: 'Зарегистрировать', backTo: '/inventory/shipments' },
}

export function InventoryOperationCreatePage({ opType }: Props) {
  const navigate = useNavigate()
  const formId = useId()
  const cfg = TITLES[opType]
  const isShipment = opType === 'out'

  const [clients, setClients] = useState<DictionaryItem[]>([])
  const [products, setProducts] = useState<InventoryProductLookup[]>([])
  const [colors, setColors] = useState<DictionaryItem[]>([])
  const [sizes, setSizes] = useState<DictionaryItem[]>([])

  const [clientId, setClientId] = useState('')
  const [productId, setProductId] = useState('')
  const [colorId, setColorId] = useState('')
  const [sizeId, setSizeId] = useState('')
  const [quantityStr, setQuantityStr] = useState('')
  const [note, setNote] = useState('')

  const [touched, setTouched] = useState({
    client: false,
    product: false,
    color: false,
    size: false,
    quantity: false,
  })
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [balance, setBalance] = useState<number | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([getInventoryClients(), getInventoryColors(), getInventorySizes()])
      .then(([cs, cls, szs]) => {
        if (cancelled) return
        setClients(cs)
        setColors(cls)
        setSizes(szs)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!clientId) {
      setProducts([])
      setProductId('')
      return
    }
    getInventoryProducts(clientId)
      .then((rows) => {
        if (cancelled) return
        setProducts(rows)
        if (productId && !rows.some((r) => r.id === productId)) setProductId('')
      })
      .catch(() => {
        if (!cancelled) setProducts([])
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === productId) ?? null,
    [products, productId],
  )

  const requiresColor = !!selectedProduct?.requires_color
  const requiresSize = !!selectedProduct?.requires_size

  // Текущий остаток подсвечиваем при заполнении ключа (товар + цвет/размер по необходимости).
  useEffect(() => {
    let cancelled = false
    if (!productId) {
      setBalance(null)
      return
    }
    if (requiresColor && !colorId) {
      setBalance(null)
      return
    }
    if (requiresSize && !sizeId) {
      setBalance(null)
      return
    }
    setBalanceLoading(true)
    getInventorySingleBalance({
      product_id: productId,
      color_id: colorId || null,
      size_id: sizeId || null,
    })
      .then((res) => {
        if (!cancelled) setBalance(res.quantity)
      })
      .catch(() => {
        if (!cancelled) setBalance(null)
      })
      .finally(() => {
        if (!cancelled) setBalanceLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [productId, colorId, sizeId, requiresColor, requiresSize])

  const quantityNum = Number(quantityStr.replace(',', '.'))
  const quantityValid = Number.isFinite(quantityNum) && Math.floor(quantityNum) === quantityNum && quantityNum > 0

  const errors = {
    client: !clientId,
    product: !productId,
    color: requiresColor && !colorId,
    size: requiresSize && !sizeId,
    quantity: !quantityValid,
    stock: isShipment && balance != null && quantityValid && balance < quantityNum,
  }

  const formInvalid =
    errors.client || errors.product || errors.color || errors.size || errors.quantity || !!errors.stock

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitError('')
    setTouched({ client: true, product: true, color: true, size: true, quantity: true })
    if (formInvalid) {
      if (errors.stock) {
        setSubmitError(
          `Недостаточно остатка: доступно ${balance ?? 0}, требуется ${quantityNum}`,
        )
      } else {
        setSubmitError('Заполните обязательные поля')
      }
      return
    }
    setSubmitting(true)
    try {
      await createInventoryOperation({
        op_type: opType,
        client_id: clientId,
        product_id: productId,
        color_id: colorId || null,
        size_id: sizeId || null,
        quantity: Math.floor(quantityNum),
        note: note.trim() || null,
      })
      navigate(cfg.backTo)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Не удалось сохранить')
    } finally {
      setSubmitting(false)
    }
  }

  const showBalance =
    !!productId && (!requiresColor || !!colorId) && (!requiresSize || !!sizeId)
  const balanceTone =
    balance == null ? '' : balance > 0 ? 'qty-positive' : 'qty-zero'

  return (
    <PageContainer maxWidth={640} cardClassName="product-create-card">
      <Breadcrumbs />

      <h2 className="auth-card__subtitle" style={{ marginBottom: 8 }}>{cfg.title}</h2>

      <form id={formId} className="auth-form product-create-form" onSubmit={onSubmit} noValidate>
        <label className="field-label" htmlFor={`${formId}-client`}>
          Клиент<span className="field-label__required" aria-label="обязательное поле">*</span>
        </label>
        <DictionaryFormCombobox
          id={`${formId}-client`}
          items={clients}
          value={clientId}
          onChange={(v) => {
            setClientId(v)
            setProductId('')
          }}
          required
          allowClear
          hasError={touched.client && errors.client}
          onBlur={() => setTouched((t) => ({ ...t, client: true }))}
        />

        <label className="field-label" htmlFor={`${formId}-product`}>
          Название (товар)<span className="field-label__required" aria-label="обязательное поле">*</span>
        </label>
        <DictionaryFormCombobox
          id={`${formId}-product`}
          items={products.map((p) => ({
            id: p.id,
            name: p.name,
            is_active: true,
            created_at: '',
            created_by: null,
            updated_at: null,
            updated_by: null,
          }))}
          value={productId}
          onChange={setProductId}
          required
          allowClear
          disabled={!clientId}
          hasError={touched.product && errors.product}
          onBlur={() => setTouched((t) => ({ ...t, product: true }))}
        />
        {!clientId ? <small className="field-hint">Сначала выберите клиента</small> : null}

        <label className="field-label" htmlFor={`${formId}-type`}>Тип товара</label>
        <input
          id={`${formId}-type`}
          className="field-input"
          type="text"
          value={selectedProduct?.type_name ?? ''}
          readOnly
          tabIndex={-1}
          placeholder="—"
        />

        <label className="field-label" htmlFor={`${formId}-supplier`}>Поставщик</label>
        <input
          id={`${formId}-supplier`}
          className="field-input"
          type="text"
          value={selectedProduct?.supplier_name ?? ''}
          readOnly
          tabIndex={-1}
          placeholder="—"
        />

        <label className="field-label" htmlFor={`${formId}-color`}>
          Цвет
          {requiresColor ? (
            <span className="field-label__required" aria-label="обязательное поле">*</span>
          ) : null}
        </label>
        <DictionaryFormCombobox
          id={`${formId}-color`}
          items={colors}
          value={colorId}
          onChange={setColorId}
          required={requiresColor}
          allowClear={!requiresColor}
          hasError={touched.color && errors.color}
          onBlur={() => setTouched((t) => ({ ...t, color: true }))}
        />

        <label className="field-label" htmlFor={`${formId}-size`}>
          Размер
          {requiresSize ? (
            <span className="field-label__required" aria-label="обязательное поле">*</span>
          ) : null}
        </label>
        <DictionaryFormCombobox
          id={`${formId}-size`}
          items={sizes}
          value={sizeId}
          onChange={setSizeId}
          required={requiresSize}
          allowClear={!requiresSize}
          hasError={touched.size && errors.size}
          onBlur={() => setTouched((t) => ({ ...t, size: true }))}
        />

        <label className="field-label" htmlFor={`${formId}-quantity`}>
          Количество<span className="field-label__required" aria-label="обязательное поле">*</span>
        </label>
        <input
          id={`${formId}-quantity`}
          className={`field-input${touched.quantity && errors.quantity ? ' field-input--error' : ''}`}
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={quantityStr}
          onChange={(e) => setQuantityStr(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, quantity: true }))}
        />
        {showBalance ? (
          <small className={`field-hint inv-balance-hint ${balanceTone}`}>
            {balanceLoading ? 'Остаток: загрузка...' : `Текущий остаток: ${balance ?? 0}`}
          </small>
        ) : null}

        <label className="field-label" htmlFor={`${formId}-note`}>Комментарий</label>
        <input
          id={`${formId}-note`}
          className="field-input"
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
        />
      </form>

      {submitError ? <p className="error-text product-create-error">{submitError}</p> : null}

      <ActionBar
        primaryLabel={cfg.primary}
        primaryDisabled={submitting}
        submitFormId={formId}
        onSecondary={() => navigate(cfg.backTo)}
      />
    </PageContainer>
  )
}
