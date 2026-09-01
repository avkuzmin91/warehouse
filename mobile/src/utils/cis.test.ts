import { describe, expect, it } from 'vitest'
import { cisGtinToEan13, cisRawForDisplay, isCisCode, parseCis } from './cis'

const GS = '\u001d'

const GTIN = '04601234567890'
const SERIAL = '9A1B2C3D4E5F6'
const CRYPTO = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH'

// Как код приходит со сканера, сохранившего FNC1: 01<gtin>21<serial><GS>91<key><GS>92<crypto>
const WITH_GS = `01${GTIN}21${SERIAL}${GS}91EE06${GS}92${CRYPTO}`
// Тот же код от сканера, вырезавшего FNC1 — поля склеены.
const NO_GS = `01${GTIN}21${SERIAL}91EE0692${CRYPTO}`

describe('isCisCode', () => {
  it('узнаёт код маркировки', () => {
    expect(isCisCode(WITH_GS)).toBe(true)
    expect(isCisCode(NO_GS)).toBe(true)
  })

  it('не путает с EAN-13 товара и QR места', () => {
    expect(isCisCode('4601234567890')).toBe(false)
    expect(isCisCode('wms:loc:0f8c1e3a-1111-2222-3333-444455556666')).toBe(false)
    expect(isCisCode('')).toBe(false)
  })
})

describe('parseCis', () => {
  it('разбирает код с разделителями однозначно', () => {
    const cis = parseCis(WITH_GS)
    expect(cis).not.toBeNull()
    expect(cis?.gtin).toBe(GTIN)
    expect(cis?.serial).toBe(SERIAL)
    expect(cis?.exact).toBe(true)
  })

  it('без разделителей отрезает серийник по длине ЧЗ и помечает разбор неточным', () => {
    const cis = parseCis(NO_GS)
    expect(cis?.gtin).toBe(GTIN)
    expect(cis?.serial).toBe(SERIAL)
    expect(cis?.exact).toBe(false)
  })

  it('сохраняет исходную строку без изменений', () => {
    expect(parseCis(WITH_GS)?.raw).toBe(WITH_GS)
  })

  it('отбрасывает символьный префикс DataMatrix и ведущий GS', () => {
    expect(parseCis(`]d2${WITH_GS}`)?.serial).toBe(SERIAL)
    expect(parseCis(`${GS}${WITH_GS}`)?.serial).toBe(SERIAL)
  })

  it('читает код без криптохвоста', () => {
    const cis = parseCis(`01${GTIN}21${SERIAL}`)
    expect(cis?.gtin).toBe(GTIN)
    expect(cis?.serial).toBe(SERIAL)
  })

  it('не разбирает неопознанный хвост в ущерб уже прочитанным полям', () => {
    const cis = parseCis(`01${GTIN}21${SERIAL}${GS}77МУСОР`)
    expect(cis?.gtin).toBe(GTIN)
    expect(cis?.serial).toBe(SERIAL)
  })

  it('возвращает null для не-КИЗ', () => {
    expect(parseCis('4601234567890')).toBeNull()
    expect(parseCis('wms:loc:abc')).toBeNull()
    expect(parseCis('')).toBeNull()
  })

  it('возвращает null, если GTIN оборван', () => {
    expect(parseCis('010460123219A1B2C3D4E5F6')).toBeNull()
  })

  it('возвращает null, если серийника нет', () => {
    expect(parseCis(`01${GTIN}`)).toBeNull()
  })
})

describe('cisGtinToEan13', () => {
  it('снимает ведущий ноль GTIN-14', () => {
    expect(cisGtinToEan13(GTIN)).toBe('4601234567890')
  })

  it('не даёт ШК для GTIN групповой упаковки', () => {
    expect(cisGtinToEan13('14601234567890')).toBeNull()
  })
})

describe('cisRawForDisplay', () => {
  it('делает разделители видимыми', () => {
    expect(cisRawForDisplay(`01${GTIN}21${SERIAL}${GS}91EE06`)).toBe(
      `01${GTIN}21${SERIAL}⟨GS⟩91EE06`,
    )
  })
})
