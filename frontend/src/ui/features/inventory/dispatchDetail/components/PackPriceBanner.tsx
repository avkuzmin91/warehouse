import { useEffect, useState } from 'react'
import { getClientBoxPrices, setClientBoxPrice } from '../../../../../api/boxPricingApi'
import { getClientPalletPrices, setClientPalletPrice } from '../../../../../api/palletPricingApi'
import { Icon } from '../../../../primitives/Icon'
import { DatePicker } from '../../../../primitives/DatePicker'
import { useToast } from '../../../../feedback/Toast'
import { moscowTodayYmd, parseRublesToKopecks } from '../../../../../utils/format'

type Props = {
  clientId:       string
  needBoxPrice:   boolean
  needPalletPrice: boolean
}

type Missing = { box: boolean; pallet: boolean } | null

/** Баннер на документе (только для видящих деньги): если в составе есть короба/палеты,
 *  а у клиента не заведена действующая цена по этой единице — предлагает завести её
 *  прямо здесь, не уходя в справочник. Цена по клиенту (effective-dated), поэтому одна
 *  на весь документ, не в строке. */
export function PackPriceBanner({ clientId, needBoxPrice, needPalletPrice }: Props) {
  const toast = useToast()
  const [missing, setMissing] = useState<Missing>(null)

  useEffect(() => {
    if (!needBoxPrice && !needPalletPrice) { setMissing(null); return }
    const ctrl = new AbortController()
    Promise.all([
      needBoxPrice ? getClientBoxPrices(clientId, ctrl.signal).then((d) => d.price_kop == null).catch(() => false) : Promise.resolve(false),
      needPalletPrice ? getClientPalletPrices(clientId, ctrl.signal).then((d) => d.price_kop == null).catch(() => false) : Promise.resolve(false),
    ]).then(([box, pallet]) => {
      if (!ctrl.signal.aborted) setMissing({ box, pallet })
    })
    return () => ctrl.abort()
  }, [clientId, needBoxPrice, needPalletPrice])

  if (!missing || (!missing.box && !missing.pallet)) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px', borderRadius: 10, background: 'var(--c-warning-bg)', border: '0.5px solid var(--c-warning)' }}>
      {missing.box && (
        <PriceRow
          unitGen="короба"
          unitPer="короб"
          unitDat="коробам"
          onSave={(kop, eff) => setClientBoxPrice(clientId, { price_kop: kop, effective_from: eff })}
          onSaved={() => { setMissing((m) => (m ? { ...m, box: false } : m)); toast('Цена короба сохранена', 'success') }}
        />
      )}
      {missing.pallet && (
        <PriceRow
          unitGen="палета"
          unitPer="палет"
          unitDat="палетам"
          onSave={(kop, eff) => setClientPalletPrice(clientId, { price_kop: kop, effective_from: eff })}
          onSaved={() => { setMissing((m) => (m ? { ...m, pallet: false } : m)); toast('Цена палета сохранена', 'success') }}
        />
      )}
    </div>
  )
}

function PriceRow({ unitGen, unitPer, unitDat, onSave, onSaved }: {
  unitGen: string
  unitPer: string
  unitDat: string
  onSave:  (priceKop: number, effectiveFrom: string) => Promise<{ message: string }>
  onSaved: () => void
}) {
  const toast = useToast()
  const [price, setPrice] = useState('')
  const [eff, setEff] = useState(moscowTodayYmd())
  const [showDate, setShowDate] = useState(false)
  const [saving, setSaving] = useState(false)

  async function save() {
    const kop = parseRublesToKopecks(price)
    if (kop == null) { toast(`Укажите цену ${unitGen}`, 'error'); return }
    setSaving(true)
    try {
      await onSave(kop, eff)
      onSaved()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <Icon name="alert" size={16} style={{ color: 'var(--c-warning)', marginTop: 1, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>У клиента не задана цена {unitGen}</div>
        <div className="t-sub" style={{ marginTop: 3 }}>Без неё сумма по {unitDat} в счёте будет 0.</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <input
            className="input sm num"
            inputMode="decimal"
            placeholder="напр. 150"
            aria-label={`Цена за ${unitPer}, ₽`}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            style={{ width: 96, textAlign: 'right' }}
          />
          <span className="t-sub">₽ за {unitPer}</span>
          {showDate ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="t-sub">с</span>
              <DatePicker value={eff} onChange={setEff} />
            </div>
          ) : (
            <button type="button" className="btn ghost sm" style={{ color: 'var(--c-text-subtle)' }} onClick={() => setShowDate(true)}>
              <Icon name="calendar" size={12} />с сегодня
            </button>
          )}
          <button type="button" className="btn primary sm" disabled={saving} onClick={() => void save()}>
            <Icon name={saving ? 'refresh' : 'check'} size={12} style={saving ? { animation: 'spin 0.7s linear infinite' } : undefined} />
            Сохранить цену
          </button>
        </div>
      </div>
    </div>
  )
}
