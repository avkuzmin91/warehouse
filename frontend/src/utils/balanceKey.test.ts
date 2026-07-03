import { describe, expect, it } from 'vitest'
import { balanceKey } from './balanceKey'

describe('balanceKey', () => {
  it('склеивает триплет product__color__size', () => {
    expect(balanceKey({ product_id: 'p1', color_id: 'c1', size_id: 's1' })).toBe('p1__c1__s1')
  })

  it('null/undefined цвет и размер → пустые сегменты', () => {
    expect(balanceKey({ product_id: 'p1', color_id: null, size_id: null })).toBe('p1____')
    expect(balanceKey({ product_id: 'p1' })).toBe('p1____')
  })

  it('различает пары (цвет, размер)', () => {
    expect(balanceKey({ product_id: 'p1', color_id: 'c1' })).not.toBe(
      balanceKey({ product_id: 'p1', size_id: 'c1' }),
    )
  })
})
