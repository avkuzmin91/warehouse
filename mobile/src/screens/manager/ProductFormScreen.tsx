import { useEffect, useMemo, useRef, useState } from 'react'
import { useNav } from '../../nav/NavContext'
import {
  getClients,
  getColors,
  getProductTypes,
  getSizes,
  type DictionaryItem,
  type ProductTypeLookup,
} from '../../api/lookupsApi'
import { createProduct } from '../../api/productsApi'
import { parseRublesToKopecks } from '../../utils/format'
import { AppBar } from '../../components/AppBar'
import { Combobox } from '../../components/Combobox'
import { MultiSelectField } from '../../components/MultiSelectField'
import { Icon } from '../../components/Icon'

type DimBlock = { length: string; width: string; height: string; sizes: string[] }

function parseDec(s: string): number {
  const n = Number(s.trim().replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

// Целое ≥ 0 из строки с цифрами; пусто → null (необязательное поле).
function optInt(s: string): number | null {
  const t = s.replace(/\D/g, '')
  if (!t) return null
  return parseInt(t, 10)
}

// Дубли комбинаций цвет × размер (для одежды уникальность — без габаритов). Повторяет веб.
function duplicateCombo(dims: DimBlock[], colorIds: string[]): boolean {
  const seen = new Set<string>()
  const colors = colorIds.length ? colorIds : ['']
  for (const b of dims) {
    for (const sz of b.sizes) {
      for (const c of colors) {
        const key = `${c}\0${sz}`
        if (seen.has(key)) return true
        seen.add(key)
      }
    }
  }
  return false
}

export function ProductFormScreen() {
  const { back } = useNav()
  const imgRef = useRef<HTMLInputElement>(null)

  const [types, setTypes] = useState<ProductTypeLookup[]>([])
  const [clients, setClients] = useState<DictionaryItem[]>([])
  const [colorOpts, setColorOpts] = useState<DictionaryItem[]>([])
  const [sizeOpts, setSizeOpts] = useState<DictionaryItem[]>([])
  const [lookupError, setLookupError] = useState('')

  const [name, setName] = useState('')
  const [typeId, setTypeId] = useState('')
  const [clientId, setClientId] = useState('')
  const [skuBase, setSkuBase] = useState('')
  const [skuPending, setSkuPending] = useState(false)
  const [weight, setWeight] = useState('')
  const [itemsPerBox, setItemsPerBox] = useState('')
  const [boxesPerPallet, setBoxesPerPallet] = useState('')
  const [priceGood, setPriceGood] = useState('')
  const [priceDefect, setPriceDefect] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [colorIds, setColorIds] = useState<string[]>([])
  const [dims, setDims] = useState<DimBlock[]>([{ length: '', width: '', height: '', sizes: [] }])

  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const ac = new AbortController()
    setLookupError('')
    Promise.allSettled([
      getProductTypes(ac.signal),
      getClients(ac.signal),
      getColors(ac.signal),
      getSizes(ac.signal),
    ]).then((res) => {
      if (ac.signal.aborted) return
      const [t, cl, co, sz] = res
      if (t.status === 'fulfilled') setTypes(t.value)
      if (cl.status === 'fulfilled') setClients(cl.value.filter((c) => c.is_active !== false && !c.is_deleted))
      if (co.status === 'fulfilled') setColorOpts(co.value)
      if (sz.status === 'fulfilled') setSizeOpts(sz.value)
      if (res.some((r) => r.status === 'rejected')) setLookupError('Не удалось загрузить часть справочников')
    })
    return () => ac.abort()
  }, [])

  const selType = types.find((t) => t.id === typeId)
  const requiresColor = selType?.requires_color ?? false
  const requiresSize = selType?.requires_size ?? false

  function selectType(id: string) {
    setTypeId(id)
    const t = types.find((x) => x.id === id)
    // Без размеров товар имеет один набор габаритов — схлопываем блоки, чтобы не
    // плодить пустые дубли-варианты, и очищаем размеры.
    if (!t?.requires_size) setDims((prev) => [{ ...prev[0], sizes: [] }])
  }

  const blockReasons = useMemo<string[]>(() => {
    const r: string[] = []
    if (!name.trim()) r.push('Укажите название')
    if (!typeId) r.push('Выберите тип товара')
    if (!clientId) r.push('Выберите клиента')
    if (!skuPending && !skuBase.trim()) r.push('Укажите SKU или включите «уточнить позже»')
    if (requiresColor && colorIds.length === 0) r.push('Выберите хотя бы один цвет')
    const dimsOk = dims.every((d) =>
      d.length.trim() && d.width.trim() && d.height.trim() && (!requiresSize || d.sizes.length > 0),
    )
    if (!dimsOk) r.push(requiresSize ? 'Заполните габариты и размеры' : 'Заполните габариты')
    return r
  }, [name, typeId, clientId, skuBase, skuPending, requiresColor, requiresSize, colorIds, dims])

  function handleImages(files: FileList | null) {
    if (!files) return
    const arr = Array.from(files)
    setImageFiles((p) => [...p, ...arr])
    arr.forEach((f) => {
      const reader = new FileReader()
      reader.onload = (ev) => setImagePreviews((p) => [...p, ev.target?.result as string])
      reader.readAsDataURL(f)
    })
  }
  function removeImage(i: number) {
    setImageFiles((p) => p.filter((_, j) => j !== i))
    setImagePreviews((p) => p.filter((_, j) => j !== i))
  }

  async function save() {
    if (saving) return
    if (blockReasons.length > 0) { setError(blockReasons[0]); return }
    if (requiresSize && duplicateCombo(dims, colorIds)) {
      setError('Дублируется комбинация цвета и размера')
      return
    }
    setError('')
    setSaving(true)
    try {
      await createProduct(
        {
          product: {
            name: name.trim(),
            type_id: typeId,
            sku_base: skuPending ? undefined : skuBase.trim(),
            sku_pending: skuPending,
            weight_grams: optInt(weight),
            items_per_box: optInt(itemsPerBox),
            boxes_per_pallet: optInt(boxesPerPallet),
            client_id: clientId,
            is_active: isActive,
            packing_price_good_kop: priceGood.trim() ? parseRublesToKopecks(priceGood) : undefined,
            packing_price_defect_kop: priceDefect.trim() ? parseRublesToKopecks(priceDefect) : undefined,
          },
          colors: colorIds,
          dimensions: dims.map((d) => ({
            length: parseDec(d.length),
            width: parseDec(d.width),
            height: parseDec(d.height),
            sizes: requiresSize ? d.sizes : [],
          })),
        },
        imageFiles,
      )
      back()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать товар')
      setSaving(false)
    }
  }

  return (
    <div className="screen">
      <AppBar title="Новый товар" sub="SKU можно уточнить позже" onBack={back} noProfile />
      <div className="scroll pad-nav">
        {lookupError && (
          <div className="alert" style={{ marginBottom: 12 }}>
            <Icon name="alert" size={15} />
            {lookupError}
          </div>
        )}

        <div className="field">
          <div className="flabel">Название <span className="req">*</span></div>
          <input
            className="input"
            type="text"
            placeholder="Название товара"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="field">
          <div className="flabel">Тип товара <span className="req">*</span></div>
          <Combobox
            value={typeId}
            options={types.map((t) => ({ value: t.id, label: t.name }))}
            placeholder="Выберите тип…"
            title="Тип товара"
            onChange={selectType}
          />
        </div>

        <div className="field">
          <div className="flabel">Клиент <span className="req">*</span></div>
          <Combobox
            value={clientId}
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Выберите клиента…"
            title="Клиент"
            onChange={setClientId}
          />
        </div>

        <div className="field">
          <div className="flabel">SKU / штрих-код {!skuPending && <span className="req">*</span>}</div>
          <input
            className="input mono"
            type="text"
            placeholder={skuPending ? 'Будет уточнён позже' : 'BASE-001'}
            value={skuPending ? '' : skuBase}
            disabled={skuPending}
            onChange={(e) => setSkuBase(e.target.value)}
          />
          <div className="seg" style={{ marginTop: 8 }}>
            <button type="button" className={!skuPending ? 'active' : ''} onClick={() => setSkuPending(false)}>
              Указать сейчас
            </button>
            <button type="button" className={skuPending ? 'active' : ''} onClick={() => setSkuPending(true)}>
              Уточнить позже
            </button>
          </div>
        </div>

        <div className="sec" style={{ marginTop: 4 }}>
          Цвета
          {requiresColor ? <span className="req"> *</span> : <span className="sec-count">не обяз.</span>}
        </div>
        <div className="field">
          <MultiSelectField
            value={colorIds}
            options={colorOpts.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Выберите цвета…"
            title="Цвета"
            onChange={setColorIds}
          />
        </div>

        <div className="sec">
          {requiresSize ? 'Габариты и размеры' : 'Габариты'}
          <span className="req"> *</span>
        </div>
        {dims.map((d, i) => (
          <div key={i} className="formline">
            {dims.length > 1 && (
              <div className="line-row" style={{ marginTop: 0, justifyContent: 'space-between' }}>
                <div className="tile-meta">Блок {i + 1}</div>
                <button className="icon-btn danger" onClick={() => setDims((p) => p.filter((_, j) => j !== i))} aria-label="Удалить блок">
                  <Icon name="trash" size={15} />
                </button>
              </div>
            )}
            <div className="line-row" style={{ marginTop: dims.length > 1 ? 8 : 0, gap: 8 }}>
              {(['length', 'width', 'height'] as const).map((f, fi) => (
                <div key={f} style={{ flex: 1 }}>
                  <div className="flabel">{['Д, см', 'Ш, см', 'В, см'][fi]}</div>
                  <input
                    className="input num"
                    inputMode="decimal"
                    placeholder="0"
                    value={d[f]}
                    onChange={(e) =>
                      setDims((p) => p.map((b, j) => (j === i ? { ...b, [f]: e.target.value.replace(/[^\d.,]/g, '') } : b)))
                    }
                  />
                </div>
              ))}
            </div>
            {requiresSize && (
              <div className="field" style={{ marginTop: 8 }}>
                <div className="flabel">Размеры <span className="req">*</span></div>
                <MultiSelectField
                  value={d.sizes}
                  options={sizeOpts.map((s) => ({ value: s.id, label: s.name }))}
                  placeholder="Выберите размеры…"
                  title="Размеры"
                  onChange={(vals) => setDims((p) => p.map((b, j) => (j === i ? { ...b, sizes: vals } : b)))}
                />
              </div>
            )}
          </div>
        ))}
        {requiresSize && (
          <button
            className="btn ghost"
            style={{ marginTop: 8 }}
            onClick={() => setDims((p) => [...p, { length: '', width: '', height: '', sizes: [] }])}
          >
            <Icon name="plus" size={15} /> Добавить блок
          </button>
        )}

        <div className="sec">Параметры<span className="sec-count">не обяз.</span></div>
        <div className="field">
          <div className="flabel">Вес, гр.</div>
          <input
            className="input num"
            inputMode="numeric"
            placeholder="0"
            value={weight}
            onChange={(e) => setWeight(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <div className="field">
          <div className="flabel">Товаров в коробе</div>
          <input
            className="input num"
            inputMode="numeric"
            placeholder="0"
            value={itemsPerBox}
            onChange={(e) => setItemsPerBox(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <div className="field">
          <div className="flabel">Коробов на паллете</div>
          <input
            className="input num"
            inputMode="numeric"
            placeholder="0"
            value={boxesPerPallet}
            onChange={(e) => setBoxesPerPallet(e.target.value.replace(/\D/g, ''))}
          />
        </div>

        <div className="sec">Стоимость упаковки, ₽<span className="sec-count">не обяз.</span></div>
        <div className="field">
          <div className="flabel">Годный</div>
          <input
            className="input num"
            inputMode="decimal"
            placeholder="напр. 12,50"
            value={priceGood}
            onChange={(e) => setPriceGood(e.target.value.replace(/[^\d.,]/g, ''))}
          />
        </div>
        <div className="field">
          <div className="flabel">Брак</div>
          <input
            className="input num"
            inputMode="decimal"
            placeholder="напр. 5,00"
            value={priceDefect}
            onChange={(e) => setPriceDefect(e.target.value.replace(/[^\d.,]/g, ''))}
          />
        </div>

        <div className="sec">Фотографии<span className="sec-count">{imagePreviews.length || 'не обяз.'}</span></div>
        <div className="row gap-8" style={{ flexWrap: 'wrap', marginBottom: 8, alignItems: 'flex-start' }}>
          {imagePreviews.map((src, i) => (
            <div
              key={src}
              style={{ position: 'relative', width: 72, height: 72, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--c-border)' }}
            >
              <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <button
                type="button"
                onClick={() => removeImage(i)}
                aria-label="Убрать"
                style={{
                  position: 'absolute', top: 2, right: 2, width: 20, height: 20, borderRadius: 10, border: 0,
                  background: 'var(--c-danger)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
          <button type="button" className="btn ghost" onClick={() => imgRef.current?.click()}>
            <Icon name="upload" size={15} /> Фото
          </button>
        </div>
        <input
          ref={imgRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => { handleImages(e.target.files); if (imgRef.current) imgRef.current.value = '' }}
        />

        <div className="field" style={{ marginTop: 8 }}>
          <div className="flabel">Активность</div>
          <div className="seg">
            <button type="button" className={isActive ? 'active tone-success' : ''} onClick={() => setIsActive(true)}>
              Активен
            </button>
            <button type="button" className={!isActive ? 'active' : ''} onClick={() => setIsActive(false)}>
              Скрыт
            </button>
          </div>
        </div>

        {error && (
          <div className="alert" style={{ marginTop: 12 }}>
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}

        <div className="line-row" style={{ marginTop: 14 }}>
          <button className="btn ghost" style={{ flex: 1 }} onClick={back} disabled={saving}>
            Отмена
          </button>
          <button className="btn" style={{ flex: 2 }} disabled={saving || blockReasons.length > 0} onClick={() => void save()}>
            {saving ? '…' : 'Создать товар'}
          </button>
        </div>
      </div>
    </div>
  )
}
