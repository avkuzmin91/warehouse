import { useCallback, useEffect, useState } from 'react'
import { useNav } from '../../nav/NavContext'
import { getClients, type DictionaryItem } from '../../api/lookupsApi'
import { getProduct, updateProduct, type ProductItem } from '../../api/productsApi'
import { AppBar } from '../../components/AppBar'
import { Combobox } from '../../components/Combobox'
import { Icon } from '../../components/Icon'

// Целое ≥ 0 из строки с цифрами; пусто → null (необязательное поле).
function optInt(s: string): number | null {
  const t = s.replace(/\D/g, '')
  if (!t) return null
  return parseInt(t, 10)
}

// Правка простых полей карточки товара. Варианты (цвета/размеры/габариты), фото и
// цены упаковки правятся в вебе — здесь только то, что нужно менеджеру «в поле»:
// название, клиент, SKU (в т.ч. дозаполнение «ожидает SKU»), вес, кратность, активность.
export function ProductEditScreen({ productId }: { productId: string }) {
  const { back } = useNav()
  const [product, setProduct] = useState<ProductItem | null>(null)
  const [clients, setClients] = useState<DictionaryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [name, setName] = useState('')
  const [clientId, setClientId] = useState('')
  const [skuBase, setSkuBase] = useState('')
  const [weight, setWeight] = useState('')
  const [itemsPerBox, setItemsPerBox] = useState('')
  const [boxesPerPallet, setBoxesPerPallet] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback((signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    Promise.all([getProduct(productId, signal), getClients(signal)])
      .then(([p, cl]) => {
        if (signal?.aborted) return
        setProduct(p)
        setClients(cl.filter((c) => c.is_active !== false && !c.is_deleted))
        setName(p.name)
        setClientId(p.client_id ?? '')
        setSkuBase(p.sku_pending ? '' : (p.sku_base ?? ''))
        setWeight(p.weight_grams != null ? String(p.weight_grams) : '')
        setItemsPerBox(p.items_per_box != null ? String(p.items_per_box) : '')
        setBoxesPerPallet(p.boxes_per_pallet != null ? String(p.boxes_per_pallet) : '')
        setIsActive(p.is_active)
      })
      .catch((err) => { if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить товар') })
      .finally(() => { if (!signal?.aborted) setLoading(false) })
  }, [productId])

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    return () => ac.abort()
  }, [load])

  async function save() {
    if (saving || !product) return
    if (!name.trim()) {
      setError('Укажите название')
      return
    }
    setSaving(true)
    setError('')
    try {
      const sku = skuBase.trim()
      await updateProduct(product.id, {
        name: name.trim(),
        client_id: clientId || null,
        is_active: isActive,
        weight_grams: optInt(weight),
        items_per_box: optInt(itemsPerBox),
        boxes_per_pallet: optInt(boxesPerPallet),
        // SKU шлём только если он введён: пустой при sku_pending оставляет «ожидает SKU».
        ...(sku ? { sku_base: sku, sku_pending: false } : {}),
      })
      back()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить товар')
      setSaving(false)
    }
  }

  return (
    <div className="screen">
      <AppBar title={product ? product.name : 'Товар'} sub="Правка карточки" onBack={back} noProfile />
      <div className="scroll pad-nav">
        {error && (<div className="alert" style={{ marginBottom: 12 }}><Icon name="alert" size={15} />{error}</div>)}
        {loading || !product ? (
          !error && <div className="center" style={{ padding: '32px 0' }}><div className="spin" /></div>
        ) : (
          <>
            <div className="summary" style={{ marginBottom: 16 }}>
              <div className="kv"><span className="k">Тип</span><span className="v">{product.type_name ?? '—'}</span></div>
              <div className="kv"><span className="k">Вариантов</span><span className="v">{product.variant_count}</span></div>
            </div>

            <div className="field">
              <div className="flabel">Название <span className="req">*</span></div>
              <input className="input" type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="field">
              <div className="flabel">Клиент</div>
              <Combobox
                value={clientId}
                options={clients.map((c) => ({ value: c.id, label: c.name }))}
                placeholder="Выберите клиента…"
                title="Клиент"
                onChange={setClientId}
              />
            </div>

            <div className="field">
              <div className="flabel">SKU / штрих-код{product.sku_pending && <span className="sec-count" style={{ marginLeft: 6 }}>ожидается</span>}</div>
              <input
                className="input mono"
                type="text"
                placeholder={product.sku_pending ? 'Введите, чтобы присвоить' : 'BASE-001'}
                value={skuBase}
                onChange={(e) => setSkuBase(e.target.value)}
              />
            </div>

            <div className="field">
              <div className="flabel">Вес, гр.</div>
              <input className="input num" inputMode="numeric" value={weight} onChange={(e) => setWeight(e.target.value.replace(/\D/g, ''))} placeholder="0" />
            </div>
            <div className="field">
              <div className="flabel">Товаров в коробе</div>
              <input className="input num" inputMode="numeric" value={itemsPerBox} onChange={(e) => setItemsPerBox(e.target.value.replace(/\D/g, ''))} placeholder="0" />
            </div>
            <div className="field">
              <div className="flabel">Коробов на паллете</div>
              <input className="input num" inputMode="numeric" value={boxesPerPallet} onChange={(e) => setBoxesPerPallet(e.target.value.replace(/\D/g, ''))} placeholder="0" />
            </div>

            <div className="field">
              <div className="flabel">Активность</div>
              <div className="seg">
                <button type="button" className={isActive ? 'active tone-success' : ''} onClick={() => setIsActive(true)}>Активен</button>
                <button type="button" className={!isActive ? 'active' : ''} onClick={() => setIsActive(false)}>Скрыт</button>
              </div>
            </div>

            <div className="line-sub" style={{ margin: '8px 0', color: 'var(--c-text-faint)' }}>
              Цвета, размеры, габариты и фото правятся в веб-версии.
            </div>

            <div className="line-row" style={{ marginTop: 14 }}>
              <button className="btn ghost" style={{ flex: 1 }} onClick={back} disabled={saving}>Отмена</button>
              <button className="btn" style={{ flex: 2 }} disabled={saving || !name.trim()} onClick={() => void save()}>
                {saving ? <span className="spin spin-sm" /> : 'Сохранить'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
