import { useEffect, useState } from 'react'
import { useNav } from '../nav/NavContext'
import { Icon } from '../components/Icon'
import { scanSource } from '../scan/ScanSource'
import { getProductByBarcode } from '../api/productsApi'

// Сканер ШК: камера в нативной сборке (ML Kit за абстракцией ScanSource — позже ТСД),
// ручной ввод кода как fallback. Код → GET /products/by-barcode/{code}. См. docs/mobile-plan.md §6.2.
export function ScanScreen() {
  const { back, openScanProduct } = useNav()
  const [code, setCode] = useState('')
  const [looking, setLooking] = useState(false)
  const [error, setError] = useState('')
  const [notFound, setNotFound] = useState('')
  const [scanAvailable, setScanAvailable] = useState(false)

  useEffect(() => {
    let live = true
    scanSource.isAvailable().then((v) => live && setScanAvailable(v))
    return () => {
      live = false
    }
  }, [])

  async function lookup(raw: string) {
    const c = raw.trim()
    if (!c || looking) return
    setLooking(true)
    setError('')
    setNotFound('')
    try {
      const res = await getProductByBarcode(c)
      if (res.found && res.match) openScanProduct(res.match)
      else setNotFound(c)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось найти товар')
    } finally {
      setLooking(false)
    }
  }

  async function onScanCamera() {
    setError('')
    try {
      const scanned = await scanSource.scan()
      if (scanned) {
        setCode(scanned)
        void lookup(scanned)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Сканирование не удалось')
    }
  }

  return (
    <div className="screen scan-screen">
      <div className="scanview">
        <div className="scan-vignette" />

        <div className="scan-top">
          <button className="scan-icobtn" onClick={back} aria-label="Назад">
            <Icon name="arrowLeft" size={19} />
          </button>
          <span className="scan-title">Сканировать ШК</span>
          <button className="scan-icobtn" aria-label="Настройки" disabled>
            <Icon name="settings" size={18} />
          </button>
        </div>

        <div className="scan-reticle">
          <span className="corner tl" />
          <span className="corner tr" />
          <span className="corner bl" />
          <span className="corner br" />
          <span className="scan-laser" />
        </div>
        <div className="scan-hint">Наведите камеру на штрихкод товара или места</div>

        <div className="scan-sheet">
          <div className="scan-grip" />

          {scanAvailable ? (
            <button className="btn" style={{ width: '100%', marginBottom: 12 }} onClick={() => void onScanCamera()}>
              <Icon name="search" size={16} /> Сканировать камерой
            </button>
          ) : (
            <div className="alert warn" style={{ marginBottom: 4 }}>
              <Icon name="alert" size={15} />
              Камера-сканер заработает в нативной сборке (iOS/Android). Сейчас — ручной ввод.
            </div>
          )}

          <div className="scan-divider">{scanAvailable ? 'или введите код вручную' : 'введите код'}</div>
          <form
            className="line-row"
            style={{ marginTop: 0 }}
            onSubmit={(e) => {
              e.preventDefault()
              void lookup(code)
            }}
          >
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="Код товара…"
              inputMode="numeric"
              value={code}
              onChange={(e) => {
                setCode(e.target.value)
                setNotFound('') // результат прошлого кода не относится к новому вводу
              }}
            />
            <button className="btn auto" type="submit" disabled={looking || !code.trim()}>
              {looking ? '…' : 'Найти'}
            </button>
          </form>

          {error && (
            <div className="alert" style={{ marginTop: 12 }}>
              <Icon name="alert" size={15} />
              {error}
            </div>
          )}

          {notFound && (
            <div className="alert warn" style={{ marginTop: 12 }}>
              <Icon name="alert" size={15} />
              Товар с кодом «{notFound}» не найден.
            </div>
          )}

          <button className="btn ghost" style={{ marginTop: 12 }} onClick={back}>
            Назад
          </button>
        </div>
      </div>
    </div>
  )
}
