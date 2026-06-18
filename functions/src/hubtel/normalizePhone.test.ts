import { normalizePhone } from './normalizePhone'

describe('normalizePhone', () => {
  it('keeps a 233-prefixed number and adds +', () => {
    expect(normalizePhone('233242825109')).toBe('+233242825109')
  })

  it('converts a local 0-prefixed number to +233', () => {
    expect(normalizePhone('0244123456')).toBe('+233244123456')
  })

  it('passes through an already-normalized number', () => {
    expect(normalizePhone('+233242825109')).toBe('+233242825109')
  })

  it('strips spaces and punctuation', () => {
    expect(normalizePhone('024 412 3456')).toBe('+233244123456')
  })

  it('treats a bare 9-digit number as missing the leading 0', () => {
    expect(normalizePhone('244123456')).toBe('+233244123456')
  })

  it('returns undefined for empty/garbage input', () => {
    expect(normalizePhone('')).toBeUndefined()
    expect(normalizePhone(null)).toBeUndefined()
    expect(normalizePhone(undefined)).toBeUndefined()
    expect(normalizePhone('abc')).toBeUndefined()
  })
})
