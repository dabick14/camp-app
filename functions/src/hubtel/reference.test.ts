import { generateReference } from './reference'

describe('generateReference', () => {
  it('stays within Hubtel’s 32-char clientReference limit', () => {
    for (let i = 0; i < 100; i++) {
      expect(generateReference().length).toBeLessThanOrEqual(32)
    }
  })

  it('includes the prefix and is uppercase', () => {
    const ref = generateReference('CAMP')
    expect(ref.startsWith('CAMP_')).toBe(true)
    expect(ref).toBe(ref.toUpperCase())
  })

  it('generates distinct references', () => {
    const a = generateReference()
    const b = generateReference()
    expect(a).not.toBe(b)
  })
})
