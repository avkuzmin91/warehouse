import { useEffect, useState } from 'react'
import { getClientBoxPrices, setClientBoxPrice } from '../../api/boxPricingApi'
import { getClientPalletPrices, setClientPalletPrice } from '../../api/palletPricingApi'
import { Icon } from '../../components/Icon'
import { DateField } from '../../components/DateField'
import { moscowTodayYmd, parseRublesToKopecks } from '../../utils/format'

type Missing = { box: boolean; pallet: boolean } | null

/** Баннер на форме отгрузки: если в составе есть короба/палеты, а у клиента не заведена
 *  действующая цена по этой единице — предлагает завести её прямо здесь. Цена по клиенту
 *  (effective-dated), поэтому одна на весь документ, не в строке. Зеркало web PackPriceBanner. */
export function PackPriceBanner({
  clientId,
  needBoxPrice,
  needPalletPrice,
}: {
  clientId: string
  needBoxPrice: boolean
  needPalletPrice: boolean
}) {
  const [missing, setMissing] = useState<Missing>(null)

  useEffect(() => {
    if (!needBoxPrice && !needPalletPrice) { setMissing(null); return }
    const ac = new AbortController()
    Promise.all([
      needBoxPrice ? getClientBoxPrices(clientId, ac.signal).then((d) => d.price_kop == null).catch(() => false) : Promise.resolve(false),
      needPalletPrice ? getClientPalletPrices(clientId, ac.signal).then((d) => d.price_kop == null).catch(() => false) : Promise.resolve(false),
    ]).then(([box, pallet]) => {
      if (!ac.signal.aborted) setMissing({ box, pallet })
    })
    return () => ac.abort()
  }, [clientId, needBoxPrice, needPalletPrice])

  if (!missing || (!missing.box && !missing.pallet)) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px', borderRadius: 10, background: 'var(--c-warning-bg)', border: '0.5px solid var(--c-warning)', marginTop: 4 }}>
      {missing.box && (
        <PriceRow
          unitGen="короба"
          unitPer="короб"
          unitDat="коробам"
          onSave={(kop, eff) => setClientBoxPrice(clientId, { price_kop: kop, effective_from: eff })}
          onSaved={() => setMissing((m) => (m ? { ...m, box: false } : m))}
        />
      )}
      {missing.pallet && (
        <PriceRow
          unitGen="палета"
          unitPer="палет"
          unitDat="палетам"
          onSave={(kop, eff) => setClientPalletPrice(clientId, { price_kop: kop, effective_from: eff })}
          onSaved={() => setMissing((m) => (m ? { ...m, pallet: false } : m))}
        />
      )}
    </div>
  )
}

function PriceRow({
  unitGen,
  unitPer,
  unitDat,
  onSave,
  onSaved,
}: {
  unitGen: string
  unitPer: string
  unitDat: string
  onSave: (priceKop: number, effectiveFrom: string) => Promise<{ message: string }>
  onSaved: () => void
}) {
  const [price, setPrice] = useState('')
  const [eff, setEff] = useState(moscowTodayYmd())
  const [showDate, setShowDate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    const kop = parseRublesToKopecks(price)
    if (kop == null) { setError(`Укажите цену ${unitGen}`); return }
    setSaving(true)
    setError('')
    try {
      await onSave(kop, eff)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <Icon name="alert" size={16} style={{ color: 'var(--c-warning)', marginTop: 1, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>У клиента не задана цена {unitGen}</div>
        <div className="line-sub" style={{ marginTop: 3 }}>Без неё сумма по {unitDat} в счёте будет 0.</div>
        <div className="line-row" style={{ marginTop: 10, gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="input num"
            inputMode="decimal"
            placeholder={`₽ за ${unitPer}`}
            aria-label={`Цена за ${unitPer}, ₽`}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            style={{ width: 120 }}
          />
          {showDate ? (
            <div style={{ flex: 1, minWidth: 140 }}>
              <DateField value={eff} onChange={setEff} title={`Цена ${unitGen} с`} />
            </div>
          ) : (
            <button type="button" className="btn ghost sm" onClick={() => setShowDate(true)}>
              <Icon name="calendar" size={12} /> с сегодня
            </button>
          )}
          <button type="button" className="btn sm" disabled={saving} onClick={() => void save()}>
            <Icon name="check" size={12} /> {saving ? '…' : 'Сохранить'}
          </button>
        </div>
        {error && (
          <div className="alert" style={{ marginTop: 8 }}>
            <Icon name="alert" size={14} />
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
