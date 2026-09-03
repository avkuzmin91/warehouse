import { useEffect, useRef, useState } from 'react'
import { useNav } from '../nav/NavContext'
import { Icon } from '../components/Icon'
import { scanSource } from '../scan/ScanSource'
import { getProductByBarcode } from '../api/productsApi'
import { getLocationByCode, isLocationCode } from '../api/locationsApi'
import { getContainerByCode, isContainerCode } from '../api/containersApi'
import { isCisCode, parseCis } from '../utils/cis'
import { isScanAutoStartEnabled } from '../utils/scanSettings'
import { scanNotFoundFeedback, scanSuccessFeedback } from '../utils/feedback'

// Сканер ШК: камера в нативной сборке (ML Kit за абстракцией ScanSource — позже ТСД),
// ручной ввод кода как fallback. Код → GET /products/by-barcode/{code}. См. docs/mobile-plan.md §6.2.

// После успешного скана экран уходит на карточку результата и размонтируется; при
// возврате «назад» камера не должна открываться сама — флаг живёт на уровне модуля.
let returningFromResult = false

export function ScanScreen() {
  const { back, openScanProduct, openScanLocation, openScanCis, openScanBox } = useNav()
  const [code, setCode] = useState('')
  const [looking, setLooking] = useState(false)
  const [error, setError] = useState('')
  const [notFound, setNotFound] = useState('')
  const [scanAvailable, setScanAvailable] = useState(false)
  const [moduleProgress, setModuleProgress] = useState<number | null>(null)
  // Вернулись с карточки результата — камера не автозапускается, кнопка = «Сканировать ещё».
  const [returned] = useState(() => {
    const v = returningFromResult
    returningFromResult = false
    return v
  })
  const autoStarted = useRef(false)

  useEffect(() => {
    let live = true
    scanSource.isAvailable().then((v) => {
      if (!live) return
      setScanAvailable(v)
      // Автозапуск камеры без лишнего тапа (отключается в профиле).
      if (v && !returned && isScanAutoStartEnabled() && !autoStarted.current) {
        autoStarted.current = true
        void onScanCamera()
      }
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function lookup(raw: string) {
    const c = raw.trim()
    if (!c || looking) return
    setLooking(true)
    setError('')
    setNotFound('')
    try {
      // QR короба («wms:box:<id>») ведёт на его карточку: кладовщик стоит с коробом
      // в руках, и работа начинается отсюда — разместить, переместить, изъять.
      if (isContainerCode(c)) {
        const found = await getContainerByCode(c)
        if (found.found && found.container) {
          scanSuccessFeedback()
          returningFromResult = true
          openScanBox(found.container.id)
        } else {
          scanNotFoundFeedback()
          setNotFound(c)
        }
        return
      }
      // QR ячейки («wms:loc:<id>») ведёт на карточку места, всё прочее — ШК товара.
      if (isLocationCode(c)) {
        const res = await getLocationByCode(c)
        if (res.found && res.location) {
          scanSuccessFeedback()
          returningFromResult = true
          openScanLocation(res.location)
        } else {
          scanNotFoundFeedback()
          setNotFound(c)
        }
        return
      }
      // Код маркировки ЧЗ разбирается на клиенте: в нём GTIN, а не ШК варианта,
      // поэтому по /products/by-barcode он бы не нашёлся.
      if (isCisCode(c)) {
        const cis = parseCis(c)
        if (cis) {
          scanSuccessFeedback()
          returningFromResult = true
          openScanCis(cis)
        } else {
          scanNotFoundFeedback()
          setNotFound(c)
        }
        return
      }
      const res = await getProductByBarcode(c)
      if (res.found && res.match) {
        scanSuccessFeedback()
        returningFromResult = true
        openScanProduct(res.match)
      } else {
        scanNotFoundFeedback()
        setNotFound(c)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось найти')
    } finally {
      setLooking(false)
    }
  }

  async function onScanCamera() {
    setError('')
    try {
      const scanned = await scanSource.scan((percent) => setModuleProgress(percent))
      if (scanned) {
        setCode(scanned)
        void lookup(scanned)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Сканирование не удалось')
    } finally {
      setModuleProgress(null)
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
          <span className="scan-icobtn" style={{ visibility: 'hidden' }} aria-hidden="true" />
        </div>

        <div className="scan-reticle">
          <span className="corner tl" />
          <span className="corner tr" />
          <span className="corner bl" />
          <span className="corner br" />
          <span className="scan-laser" />
        </div>
        <div className="scan-hint">Наведите камеру на штрихкод товара, места или код маркировки</div>

        <div className="scan-sheet">
          <div className="scan-grip" />

          {scanAvailable ? (
            <button
              className="btn"
              style={{ width: '100%', marginBottom: 12 }}
              onClick={() => void onScanCamera()}
              disabled={moduleProgress !== null}
            >
              {moduleProgress !== null ? (
                `Загрузка сканера… ${Math.round(moduleProgress)}%`
              ) : (
                <>
                  <Icon name="search" size={16} /> {returned ? 'Сканировать ещё' : 'Сканировать камерой'}
                </>
              )}
            </button>
          ) : (
            <div className="alert warn" style={{ marginBottom: 4 }}>
              <Icon name="alert" size={15} />
              Камера-сканер заработает в нативной сборке (Android). Сейчас — ручной ввод.
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
              {looking ? <span className="spin spin-sm" /> : 'Найти'}
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
              Код «{notFound}» не найден.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
