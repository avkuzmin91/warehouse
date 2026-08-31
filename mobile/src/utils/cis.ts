// Разбор кода маркировки «Честный знак» (GS1 DataMatrix), отсканированного камерой.
// Читаем только идентифицирующую часть — GTIN (AI 01) и серийный номер (AI 21).
// Криптохвост (AI 91/92/93) не разбираем — он нужен лишь при передаче кода в ЧЗ или
// маркетплейс; сырая строка целиком уходит в реестр (POST /marking/codes) как есть.
// Разбор дублирует backend/modules/marking/service.py осознанно: здесь он даёт
// мгновенную подсказку на экране, но идентичность кода в БД определяет сервер.

/** Разделитель полей GS1 (FNC1). Сканер отдаёт его как ASCII GS = 0x1D. */
const GS = '\u001d'

// Символьный префикс DataMatrix (AIM ISO/IEC 15424): часть сканеров отдаёт его с данными.
const SYMBOLOGY_PREFIX = ']d2'

// AI, встречающиеся в кодах ЧЗ. Число — длина данных фиксированного AI,
// null — переменная длина (поле обрывается разделителем GS или концом строки).
const AI_DATA_LENGTH: Record<string, number | null> = {
  '01': 14,
  '17': 6,
  '8005': 6,
  '10': null,
  '21': null,
  '91': null,
  '92': null,
  '93': null,
}

// Серийный номер ЧЗ для товарных групп, которые едут через маркетплейсы (лёгкая
// промышленность, обувь), — ровно 13 символов. Нужно, когда сканер вырезал GS:
// без разделителя границу серийника вычислить нечем, остаётся known-length допущение.
const SERIAL_FALLBACK_LENGTH = 13

export type CisCode = {
  /** GTIN из AI 01, 14 цифр. */
  gtin: string
  /** Серийный номер из AI 21. */
  serial: string
  /** true — в коде были разделители GS и границы полей однозначны; false — границы угаданы. */
  exact: boolean
  /** Строка ровно как её отдал сканер: идентичность кода, изменять нельзя. */
  raw: string
}

function normalize(raw: string): string {
  let s = raw.trim()
  if (s.startsWith(SYMBOLOGY_PREFIX)) s = s.slice(SYMBOLOGY_PREFIX.length)
  while (s.startsWith(GS)) s = s.slice(1)
  return s
}

function readAi(s: string, pos: number): string | null {
  for (const len of [4, 3, 2]) {
    const ai = s.slice(pos, pos + len)
    if (ai.length === len && ai in AI_DATA_LENGTH) return ai
  }
  return null
}

/** Похожа ли строка на код маркировки: AI 01 с 14 цифрами GTIN, следом AI 21. */
export function isCisCode(raw: string): boolean {
  return /^01\d{14}21/.test(normalize(raw))
}

export function parseCis(raw: string): CisCode | null {
  const s = normalize(raw)
  // Без единого GS любое поле переменной длины разобрано допущением, а не по спецификации.
  const exact = s.includes(GS)
  let pos = 0
  let gtin = ''
  let serial = ''

  while (pos < s.length) {
    if (s[pos] === GS) {
      pos += 1
      continue
    }
    const ai = readAi(s, pos)
    if (!ai) {
      // Хвост не опознан. Идентифицирующая часть уже прочитана — этого достаточно.
      if (gtin && serial) break
      return null
    }
    pos += ai.length

    const fixed = AI_DATA_LENGTH[ai]
    let value: string
    if (fixed !== null) {
      value = s.slice(pos, pos + fixed)
      if (value.length < fixed) return null
      pos += fixed
    } else {
      const end = s.indexOf(GS, pos)
      if (end >= 0) {
        value = s.slice(pos, end)
        pos = end + 1
      } else {
        value = s.slice(pos)
        if (ai === '21' && value.length > SERIAL_FALLBACK_LENGTH) {
          value = value.slice(0, SERIAL_FALLBACK_LENGTH)
        }
        pos += value.length
      }
    }

    if (ai === '01') gtin = value
    else if (ai === '21') serial = value
  }

  if (!/^\d{14}$/.test(gtin) || !serial) return null
  return { gtin, serial, exact, raw }
}

/**
 * GTIN-14 → EAN-13 для поиска товара по существующим штрихкодам.
 * Ненулевая ведущая цифра — это GTIN групповой упаковки, у неё нет ШК единицы товара.
 */
export function cisGtinToEan13(gtin: string): string | null {
  return /^0\d{13}$/.test(gtin) ? gtin.slice(1) : null
}

/** Непечатаемый GS в сыром коде — видимой меткой, иначе строка на экране выглядит склеенной. */
export function cisRawForDisplay(raw: string): string {
  return raw.split(GS).join('⟨GS⟩')
}
