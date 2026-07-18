import { describe, expect, it } from 'vitest'
import { normalizeGhanaPhone } from './normalizePhone'

describe('normalizeGhanaPhone', () => {
  it('passes through local 0XXXXXXXXX format', () => {
    expect(normalizeGhanaPhone('0241234567')).toBe('0241234567')
  })

  it('converts +233XXXXXXXXX to local format', () => {
    expect(normalizeGhanaPhone('+233241234567')).toBe('0241234567')
  })

  it('converts 233XXXXXXXXX (no plus) to local format', () => {
    expect(normalizeGhanaPhone('233241234567')).toBe('0241234567')
  })

  it('converts a bare 9-digit number to local format', () => {
    expect(normalizeGhanaPhone('241234567')).toBe('0241234567')
  })

  it('strips spaces and dashes', () => {
    expect(normalizeGhanaPhone('+233 24-123-4567')).toBe('0241234567')
  })

  it('returns null for garbage input', () => {
    expect(normalizeGhanaPhone('not-a-phone')).toBeNull()
  })

  it('returns null for the empty string', () => {
    expect(normalizeGhanaPhone('')).toBeNull()
  })

  it('returns null for a too-short number', () => {
    expect(normalizeGhanaPhone('12345')).toBeNull()
  })

  it('returns null for a too-long number', () => {
    expect(normalizeGhanaPhone('02412345678901')).toBeNull()
  })
})
