import { describe, expect, it } from 'vitest'
import { sheetDismissAction } from './sheetGuard'

describe('sheetDismissAction', () => {
  it('чистая шторка закрывается по backdrop', () => {
    expect(sheetDismissAction({ dirty: false })).toBe('close')
  })

  it('грязная шторка требует подтверждения', () => {
    expect(sheetDismissAction({ dirty: true })).toBe('confirm')
  })

  it('во время сохранения backdrop игнорируется независимо от dirty', () => {
    expect(sheetDismissAction({ dirty: false, locked: true })).toBe('ignore')
    expect(sheetDismissAction({ dirty: true, locked: true })).toBe('ignore')
  })
})
