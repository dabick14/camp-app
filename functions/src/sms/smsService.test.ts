/**
 * Tests for the reusable sendSms service (functions/src/sms/smsService.ts).
 *
 * Uses the Firestore emulator via the Admin SDK (same pattern as
 * setPaymentClaim.test.ts) with global.fetch stubbed so no real BMS Africa
 * call is ever made.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { sendSms } from './smsService'

beforeAll(() => {
  if (getApps().length === 0) {
    initializeApp({ projectId: 'demo-camp-app-test' })
  }
})

const ORIGINAL_EMULATOR = process.env.FUNCTIONS_EMULATOR
const ORIGINAL_OVERRIDE = process.env.SMS_DEV_OVERRIDE_PHONE

afterEach(() => {
  vi.unstubAllGlobals()
  if (ORIGINAL_EMULATOR === undefined) delete process.env.FUNCTIONS_EMULATOR
  else process.env.FUNCTIONS_EMULATOR = ORIGINAL_EMULATOR
  if (ORIGINAL_OVERRIDE === undefined) delete process.env.SMS_DEV_OVERRIDE_PHONE
  else process.env.SMS_DEV_OVERRIDE_PHONE = ORIGINAL_OVERRIDE
})

function db() { return getFirestore() }
function uniq() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }

function stubFetchOnce(response: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => response,
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const successBody = {
  status: 'success',
  code: '2000',
  message: 'messages sent successfully',
  summary: {
    _id: 'test-campaign-id',
    type: 'API QUICK SMS',
    total_sent: 1,
    contacts: 1,
    total_rejected: 0,
    numbers_sent: ['0241234567'],
    credit_used: 1,
    credit_left: 1234,
  },
}

async function getLog(campId: string, logId: string) {
  const snap = await db().doc(`camps/${campId}/smsLog/${logId}`).get()
  return snap.data()!
}

describe('sendSms — provider success', () => {
  it('writes a SENT log entry with creditLeft from summary.credit_left', async () => {
    const campId = `camp-${uniq()}`
    const logId = `log-${uniq()}`
    const fetchMock = stubFetchOnce(successBody)

    const outcome = await sendSms({
      db: db(), campId, participantId: 'p1', phone: '+233241234567',
      trigger: 'ROOM_ASSIGNED', message: 'Hi there', triggeredBy: 'system',
      apiKey: 'test-key', senderId: 'FLGALATIANS', enabled: true, logId,
    })

    expect(outcome).toBe('SENT')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const log = await getLog(campId, logId)
    expect(log.status).toBe('SENT')
    expect(log.creditLeft).toBe(1234)
    expect(log.normalizedPhone).toBe('0241234567')
  })

  it('normalizes a +233 phone to local 0XXXXXXXXX format in the outbound request', async () => {
    const campId = `camp-${uniq()}`
    const logId = `log-${uniq()}`
    const fetchMock = stubFetchOnce(successBody)

    await sendSms({
      db: db(), campId, participantId: 'p1', phone: '+233201234567',
      trigger: 'ROOM_ASSIGNED', message: 'Hi', triggeredBy: 'system',
      apiKey: 'test-key', senderId: 'FLGALATIANS', enabled: true, logId,
    })

    const [, requestInit] = fetchMock.mock.calls[0]
    const body = JSON.parse((requestInit as RequestInit).body as string)
    expect(body.recipient).toEqual(['0201234567'])
  })
})

describe('sendSms — provider failure', () => {
  it('writes a FAILED log entry with providerError, still captures creditLeft if present', async () => {
    const campId = `camp-${uniq()}`
    const logId = `log-${uniq()}`
    stubFetchOnce({ status: 'error', code: '4000', message: 'Insufficient balance', summary: { credit_left: 0 } })

    const outcome = await sendSms({
      db: db(), campId, participantId: 'p1', phone: '+233241234567',
      trigger: 'ROOM_ASSIGNED', message: 'Hi', triggeredBy: 'system',
      apiKey: 'test-key', senderId: 'FLGALATIANS', enabled: true, logId,
    })

    expect(outcome).toBe('FAILED')
    const log = await getLog(campId, logId)
    expect(log.status).toBe('FAILED')
    expect(log.providerError).toBe('Insufficient balance')
    expect(log.creditLeft).toBe(0)
  })

  it('writes a FAILED log entry when the fetch itself throws (network error)', async () => {
    const campId = `camp-${uniq()}`
    const logId = `log-${uniq()}`
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const outcome = await sendSms({
      db: db(), campId, participantId: 'p1', phone: '+233241234567',
      trigger: 'ROOM_ASSIGNED', message: 'Hi', triggeredBy: 'system',
      apiKey: 'test-key', senderId: 'FLGALATIANS', enabled: true, logId,
    })

    expect(outcome).toBe('FAILED')
    const log = await getLog(campId, logId)
    expect(log.status).toBe('FAILED')
    expect(log.providerError).toBe('network down')
  })
})

describe('sendSms — skip conditions never call the provider', () => {
  it('SKIPS and logs a reason for a missing/invalid phone number', async () => {
    const campId = `camp-${uniq()}`
    const logId = `log-${uniq()}`
    const fetchMock = stubFetchOnce(successBody)

    const outcome = await sendSms({
      db: db(), campId, participantId: 'p1', phone: 'not-a-phone',
      trigger: 'ROOM_ASSIGNED', message: 'Hi', triggeredBy: 'system',
      apiKey: 'test-key', senderId: 'FLGALATIANS', enabled: true, logId,
    })

    expect(outcome).toBe('SKIPPED')
    expect(fetchMock).not.toHaveBeenCalled()
    const log = await getLog(campId, logId)
    expect(log.status).toBe('SKIPPED')
    expect(log.reason).toMatch(/phone/i)
  })

  it('SKIPS and logs a reason when the camp kill switch is off', async () => {
    const campId = `camp-${uniq()}`
    const logId = `log-${uniq()}`
    const fetchMock = stubFetchOnce(successBody)

    const outcome = await sendSms({
      db: db(), campId, participantId: 'p1', phone: '+233241234567',
      trigger: 'ROOM_ASSIGNED', message: 'Hi', triggeredBy: 'system',
      apiKey: 'test-key', senderId: 'FLGALATIANS', enabled: false, logId,
    })

    expect(outcome).toBe('SKIPPED')
    expect(fetchMock).not.toHaveBeenCalled()
    const log = await getLog(campId, logId)
    expect(log.status).toBe('SKIPPED')
    expect(log.reason).toMatch(/disabled/i)
  })
})

describe('sendSms — local-dev phone redirect', () => {
  it('sends to SMS_DEV_OVERRIDE_PHONE instead of the participant number when under the emulator', async () => {
    const campId = `camp-${uniq()}`
    const logId = `log-${uniq()}`
    process.env.FUNCTIONS_EMULATOR = 'true'
    process.env.SMS_DEV_OVERRIDE_PHONE = '233243343261'
    const fetchMock = stubFetchOnce(successBody)

    const outcome = await sendSms({
      db: db(), campId, participantId: 'p1', phone: '+233201234567',
      trigger: 'ROOM_ASSIGNED', message: 'Hi', triggeredBy: 'system',
      apiKey: 'test-key', senderId: 'FLGALATIANS', enabled: true, logId,
    })

    expect(outcome).toBe('SENT')
    const [, requestInit] = fetchMock.mock.calls[0]
    const body = JSON.parse((requestInit as RequestInit).body as string)
    expect(body.recipient).toEqual(['0243343261'])

    const log = await getLog(campId, logId)
    expect(log.normalizedPhone).toBe('0243343261')
    expect(log.devRedirected).toBe(true)
    expect(log.devRedirectedFrom).toBe('0201234567')
    expect(log.phone).toBe('+233201234567') // original participant number preserved
  })

  it('does NOT redirect when SMS_DEV_OVERRIDE_PHONE is set but not running under the emulator', async () => {
    const campId = `camp-${uniq()}`
    const logId = `log-${uniq()}`
    delete process.env.FUNCTIONS_EMULATOR
    process.env.SMS_DEV_OVERRIDE_PHONE = '233243343261'
    const fetchMock = stubFetchOnce(successBody)

    await sendSms({
      db: db(), campId, participantId: 'p1', phone: '+233201234567',
      trigger: 'ROOM_ASSIGNED', message: 'Hi', triggeredBy: 'system',
      apiKey: 'test-key', senderId: 'FLGALATIANS', enabled: true, logId,
    })

    const [, requestInit] = fetchMock.mock.calls[0]
    const body = JSON.parse((requestInit as RequestInit).body as string)
    expect(body.recipient).toEqual(['0201234567'])

    const log = await getLog(campId, logId)
    expect(log.devRedirected).toBeUndefined()
  })
})

describe('sendSms — idempotency', () => {
  it('a second call with the same logId returns DUPLICATE and never calls the provider again', async () => {
    const campId = `camp-${uniq()}`
    const logId = `log-${uniq()}`
    const fetchMock = stubFetchOnce(successBody)

    const first = await sendSms({
      db: db(), campId, participantId: 'p1', phone: '+233241234567',
      trigger: 'ROOM_ASSIGNED', message: 'Hi', triggeredBy: 'system',
      apiKey: 'test-key', senderId: 'FLGALATIANS', enabled: true, logId,
    })
    const second = await sendSms({
      db: db(), campId, participantId: 'p1', phone: '+233241234567',
      trigger: 'ROOM_ASSIGNED', message: 'Hi', triggeredBy: 'system',
      apiKey: 'test-key', senderId: 'FLGALATIANS', enabled: true, logId,
    })

    expect(first).toBe('SENT')
    expect(second).toBe('DUPLICATE')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
