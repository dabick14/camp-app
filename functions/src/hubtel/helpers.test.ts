import { lowerKeys, mapHubtelStatus, stripQuotes } from './helpers'

describe('stripQuotes', () => {
  it('removes wrapping single or double quotes', () => {
    expect(stripQuotes('"abc"')).toBe('abc')
    expect(stripQuotes("'abc'")).toBe('abc')
    expect(stripQuotes('abc')).toBe('abc')
  })
})

describe('lowerKeys', () => {
  it('lowercases top-level keys', () => {
    expect(lowerKeys({ ResponseCode: '0000', Data: { x: 1 } })).toEqual({
      responsecode: '0000',
      data: { x: 1 },
    })
  })

  it('returns {} for non-objects', () => {
    expect(lowerKeys(null)).toEqual({})
    expect(lowerKeys('str')).toEqual({})
    expect(lowerKeys(undefined)).toEqual({})
  })
})

describe('mapHubtelStatus', () => {
  it('maps success-like statuses to SUCCESS', () => {
    expect(mapHubtelStatus('Success')).toBe('SUCCESS')
    expect(mapHubtelStatus('Paid')).toBe('SUCCESS')
    expect(mapHubtelStatus('completed')).toBe('SUCCESS')
  })

  it('maps failure-like statuses to FAILED', () => {
    expect(mapHubtelStatus('Failed')).toBe('FAILED')
    expect(mapHubtelStatus('declined')).toBe('FAILED')
    expect(mapHubtelStatus('Refunded')).toBe('FAILED')
  })

  it('maps cancelled/expired to ABANDONED', () => {
    expect(mapHubtelStatus('Cancelled')).toBe('ABANDONED')
    expect(mapHubtelStatus('expired')).toBe('ABANDONED')
  })

  it('defaults unknown/unpaid to PENDING', () => {
    expect(mapHubtelStatus('Unpaid')).toBe('PENDING')
    expect(mapHubtelStatus('')).toBe('PENDING')
    expect(mapHubtelStatus('whatever')).toBe('PENDING')
  })
})
