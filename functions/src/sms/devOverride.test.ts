import { afterEach, describe, expect, it } from 'vitest'
import { devOverridePhone } from './devOverride'

const ORIGINAL_EMULATOR = process.env.FUNCTIONS_EMULATOR
const ORIGINAL_OVERRIDE = process.env.SMS_DEV_OVERRIDE_PHONE

afterEach(() => {
  if (ORIGINAL_EMULATOR === undefined) delete process.env.FUNCTIONS_EMULATOR
  else process.env.FUNCTIONS_EMULATOR = ORIGINAL_EMULATOR
  if (ORIGINAL_OVERRIDE === undefined) delete process.env.SMS_DEV_OVERRIDE_PHONE
  else process.env.SMS_DEV_OVERRIDE_PHONE = ORIGINAL_OVERRIDE
})

describe('devOverridePhone', () => {
  it('returns null when not running under the Functions emulator, even if the var is set', () => {
    delete process.env.FUNCTIONS_EMULATOR
    process.env.SMS_DEV_OVERRIDE_PHONE = '233243343261'
    expect(devOverridePhone()).toBeNull()
  })

  it('returns null under the emulator when the var is unset', () => {
    process.env.FUNCTIONS_EMULATOR = 'true'
    delete process.env.SMS_DEV_OVERRIDE_PHONE
    expect(devOverridePhone()).toBeNull()
  })

  it('returns the normalized override number when both conditions hold', () => {
    process.env.FUNCTIONS_EMULATOR = 'true'
    process.env.SMS_DEV_OVERRIDE_PHONE = '233243343261'
    expect(devOverridePhone()).toBe('0243343261')
  })

  it('returns null if the override value itself is not a valid Ghana number', () => {
    process.env.FUNCTIONS_EMULATOR = 'true'
    process.env.SMS_DEV_OVERRIDE_PHONE = 'garbage'
    expect(devOverridePhone()).toBeNull()
  })
})
