import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Защитный parity-тест: mobile/src/api — осознанная параллельная копия frontend/src/api
// (два независимых приложения, сливать нельзя). Тест ловит частую ошибку: статус/label
// добавили на backend, поправили один api-слой и забыли второй.
//
// Сверяются только ПАРНЫЕ файлы (одинаковое имя *Api.ts в обоих слоях; mobile — подмножество),
// а внутри пары — только те union-типы и *_LABELS-records, которые объявлены в ОБОИХ файлах.
// Парсинг — простые regex по исходному тексту, без ts-компилятора.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const FRONTEND_API = path.join(REPO_ROOT, 'frontend', 'src', 'api')
const MOBILE_API = path.join(REPO_ROOT, 'mobile', 'src', 'api')

/** Union-типы из строковых литералов: export type X = 'a' | 'b' (одно- и многострочные). */
function parseStringUnions(source: string): Map<string, Set<string>> {
  const unions = new Map<string, Set<string>>()
  const re = /export type (\w+)\s*=((?:\s*\|?\s*'[^']*')+)/g
  for (const m of source.matchAll(re)) {
    const literals = new Set([...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]))
    unions.set(m[1], literals)
  }
  return unions
}

/** Records вида export const X_LABELS: Record<...> = { key: 'значение', ... } */
function parseLabelRecords(source: string): Map<string, Map<string, string>> {
  const records = new Map<string, Map<string, string>>()
  const re = /export const (\w*_LABELS)\s*:\s*Record<[^>]+>\s*=\s*\{([^}]*)\}/g
  for (const m of source.matchAll(re)) {
    const entries = new Map<string, string>()
    for (const e of m[2].matchAll(/(?:^|,|\{)\s*'?([\w-]+)'?\s*:\s*'([^']*)'/g)) {
      entries.set(e[1], e[2])
    }
    records.set(m[1], entries)
  }
  return records
}

function listApiFiles(dir: string): string[] {
  return fs.readdirSync(dir).filter((f) => f.endsWith('Api.ts'))
}

const pairedFiles = listApiFiles(FRONTEND_API).filter((f) => listApiFiles(MOBILE_API).includes(f))

type FilePair = {
  file: string
  feUnions: Map<string, Set<string>>
  moUnions: Map<string, Set<string>>
  sharedUnions: string[]
  feLabels: Map<string, Map<string, string>>
  moLabels: Map<string, Map<string, string>>
  sharedLabels: string[]
}

const pairs: FilePair[] = pairedFiles.map((file) => {
  const feSrc = fs.readFileSync(path.join(FRONTEND_API, file), 'utf8')
  const moSrc = fs.readFileSync(path.join(MOBILE_API, file), 'utf8')
  const feUnions = parseStringUnions(feSrc)
  const moUnions = parseStringUnions(moSrc)
  const feLabels = parseLabelRecords(feSrc)
  const moLabels = parseLabelRecords(moSrc)
  return {
    file,
    feUnions,
    moUnions,
    sharedUnions: [...feUnions.keys()].filter((n) => moUnions.has(n)),
    feLabels,
    moLabels,
    sharedLabels: [...feLabels.keys()].filter((n) => moLabels.has(n)),
  }
})

describe('parity frontend/src/api ↔ mobile/src/api', () => {
  it('сверка нашла парные файлы с общими типами (страховка от переименований)', () => {
    expect(pairedFiles.length).toBeGreaterThan(0)
    expect(pairs.some((p) => p.sharedUnions.length + p.sharedLabels.length > 0)).toBe(true)
  })

  // Файлы без общих union-типов/labels пропускаем (пустой describe роняет vitest).
  for (const { file, feUnions, moUnions, sharedUnions, feLabels, moLabels, sharedLabels } of pairs) {
    if (sharedUnions.length + sharedLabels.length === 0) continue
    describe(file, () => {
      for (const name of sharedUnions) {
        it(`union-тип ${name}: множества литералов совпадают`, () => {
          const fe = feUnions.get(name)!
          const mo = moUnions.get(name)!
          const missingInMobile = [...fe].filter((v) => !mo.has(v))
          const missingInFrontend = [...mo].filter((v) => !fe.has(v))
          const problems: string[] = []
          if (missingInMobile.length) {
            problems.push(`в mobile/src/api/${file} нет литералов: ${missingInMobile.join(', ')}`)
          }
          if (missingInFrontend.length) {
            problems.push(`в frontend/src/api/${file} нет литералов: ${missingInFrontend.join(', ')}`)
          }
          expect(problems, `Тип ${name} расходится между слоями. ${problems.join('; ')}`).toEqual([])
        })
      }

      for (const name of sharedLabels) {
        it(`record ${name}: ключи и подписи совпадают`, () => {
          const fe = feLabels.get(name)!
          const mo = moLabels.get(name)!
          const problems: string[] = []
          for (const key of fe.keys()) {
            if (!mo.has(key)) problems.push(`в mobile/src/api/${file} нет ключа «${key}»`)
          }
          for (const key of mo.keys()) {
            if (!fe.has(key)) problems.push(`в frontend/src/api/${file} нет ключа «${key}»`)
          }
          for (const [key, feVal] of fe) {
            const moVal = mo.get(key)
            if (moVal !== undefined && moVal !== feVal) {
              problems.push(
                `подпись «${key}» различается: frontend='${feVal}', mobile='${moVal}'`,
              )
            }
          }
          expect(problems, `${name} расходится между слоями. ${problems.join('; ')}`).toEqual([])
        })
      }
    })
  }
})
