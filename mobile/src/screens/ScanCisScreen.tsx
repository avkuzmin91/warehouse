import { useEffect, useState } from 'react'
import { barcodeVariantLabel, getProductByBarcode, type BarcodeMatch } from '../api/productsApi'
import { cisGtinToEan13, cisRawForDisplay, type CisCode } from '../utils/cis'
import { useNav } from '../nav/NavContext'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'

// Карточка отсканированного кода маркировки «Честный знак»: что прочитано из GS1-строки
// и какой товар за кодом стоит (GTIN → EAN-13 → существующий поиск по ШК).
// Код никуда не сохраняется — таблиц под КИЗ в схеме пока нет, экран только читает.
export function ScanCisScreen({ cis }: { cis: CisCode }) {
  const { back, openScanProduct } = useNav()
  const ean13 = cisGtinToEan13(cis.gtin)

  const [match, setMatch] = useState<BarcodeMatch | null>(null)
  const [loading, setLoading] = useState(ean13 !== null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!ean13) return
    const ac = new AbortController()
    setLoading(true)
    setError('')
    getProductByBarcode(ean13, ac.signal)
      .then((r) => {
        if (ac.signal.aborted) return
        setMatch(r.found ? r.match : null)
      })
      .catch((err) => {
        if (!ac.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Не удалось найти товар')
        }
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })
    return () => ac.abort()
  }, [ean13])

  const variant = match ? barcodeVariantLabel(match) : ''

  return (
    <div className="screen">
      <AppBar title="Код маркировки" sub="Честный знак" onBack={back} />

      <div className="scroll pad-nav">
        <div className="summary" style={{ marginBottom: 16 }}>
          <div className="kv">
            <span className="k">GTIN</span>
            <span className="v mono">{cis.gtin}</span>
          </div>
          <div className="kv">
            <span className="k">Серийный номер</span>
            <span className="v mono">{cis.serial}</span>
          </div>
          {ean13 && (
            <div className="kv">
              <span className="k">Штрихкод</span>
              <span className="v mono">{ean13}</span>
            </div>
          )}
        </div>

        {!cis.exact && (
          <div className="alert warn" style={{ marginBottom: 16 }}>
            <Icon name="alert" size={15} />
            Сканер отдал код без разделителей полей — границы серийного номера определены по
            длине. Проверьте номер глазами.
          </div>
        )}

        <div className="sec">Товар</div>

        {!ean13 ? (
          <div className="alert warn">
            <Icon name="alert" size={15} />
            GTIN групповой упаковки — штрихкода единицы товара у него нет.
          </div>
        ) : error ? (
          <div className="alert">
            <Icon name="alert" size={15} />
            {error}
          </div>
        ) : loading ? (
          <div className="center">
            <div className="spin" />
            <div>Поиск товара…</div>
          </div>
        ) : match ? (
          <>
            <div className="line" style={{ marginTop: 0 }}>
              <div className="line-name">{match.product_name}</div>
              <div className="line-sub mono">{match.sku}</div>
              {variant && <div className="line-sub">{variant}</div>}
              {match.client_name && <div className="line-sub">{match.client_name}</div>}
            </div>
            <button
              className="btn"
              style={{ width: '100%', marginTop: 12 }}
              onClick={() => openScanProduct(match)}
            >
              <Icon name="layers" size={16} /> Остатки и документы
            </button>
          </>
        ) : (
          <div className="alert warn">
            <Icon name="alert" size={15} />
            Товар со штрихкодом «{ean13}» не найден в системе.
          </div>
        )}

        <div className="sec">Код целиком</div>
        <div className="line mono" style={{ wordBreak: 'break-all', fontSize: 12 }}>
          {cisRawForDisplay(cis.raw)}
        </div>
      </div>
    </div>
  )
}
