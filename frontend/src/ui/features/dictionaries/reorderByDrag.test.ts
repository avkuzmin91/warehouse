import { describe, it, expect } from 'vitest'
import { reorderByDrag } from './reorderByDrag'

const list = ['a', 'b', 'c', 'd'].map((id) => ({ id }))
const ids = (rows: { id: string }[]) => rows.map((r) => r.id)

describe('reorderByDrag', () => {
  it('переносит вниз — строка встаёт ПОСЛЕ цели, а не над ней', () => {
    expect(ids(reorderByDrag(list, 'a', 'c'))).toEqual(['b', 'c', 'a', 'd'])
  })

  it('переносит вверх — строка встаёт ДО цели', () => {
    expect(ids(reorderByDrag(list, 'd', 'b'))).toEqual(['a', 'd', 'b', 'c'])
  })

  it('перенос на соседнюю строку меняет их местами', () => {
    expect(ids(reorderByDrag(list, 'b', 'c'))).toEqual(['a', 'c', 'b', 'd'])
    expect(ids(reorderByDrag(list, 'c', 'b'))).toEqual(['a', 'c', 'b', 'd'])
  })

  it('перенос в конец и в начало', () => {
    expect(ids(reorderByDrag(list, 'a', 'd'))).toEqual(['b', 'c', 'd', 'a'])
    expect(ids(reorderByDrag(list, 'd', 'a'))).toEqual(['d', 'a', 'b', 'c'])
  })

  it('бросок на себя и на неизвестный id ничего не меняет', () => {
    expect(ids(reorderByDrag(list, 'b', 'b'))).toEqual(['a', 'b', 'c', 'd'])
    expect(ids(reorderByDrag(list, 'b', 'zz'))).toEqual(['a', 'b', 'c', 'd'])
  })
})
