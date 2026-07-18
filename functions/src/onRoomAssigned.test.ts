/**
 * Tests for the onRoomAssigned Firestore trigger.
 *
 * Calls the exported CloudFunction's .run(event) directly against the
 * Firestore emulator (same pattern the codebase uses for onCall functions
 * in setPaymentClaim.test.ts) — real before/after snapshots are read from
 * the emulator, then handed to the trigger by hand, since the emulator
 * doesn't invoke deployed 2nd-gen trigger code from a raw Admin SDK write.
 * global.fetch is stubbed throughout so no real BMS Africa call is made.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import type { DocumentSnapshot } from 'firebase-admin/firestore'
import { onRoomAssigned } from './onRoomAssigned'

beforeAll(() => {
  if (getApps().length === 0) {
    initializeApp({ projectId: 'demo-camp-app-test' })
  }
  process.env.BMS_API_KEY = 'test-key'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function db() { return getFirestore() }
function uniq() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }

function stubFetch(response: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, status, json: async () => response })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const successBody = {
  status: 'success', code: '2000', message: 'messages sent successfully',
  summary: { _id: 'x', type: 'API QUICK SMS', total_sent: 1, contacts: 1, total_rejected: 0, numbers_sent: ['0241234567'], credit_used: 1, credit_left: 500 },
}

async function seedCamp(campId: string, smsSettings?: Record<string, unknown>) {
  await db().doc(`camps/${campId}`).set({
    name: 'Test Camp', location: 'Accra', currency: 'GHS', registrationOpen: true,
    ...(smsSettings ? { smsSettings } : {}),
  })
}

async function seedParticipant(campId: string, participantId: string, overrides: Record<string, unknown> = {}) {
  await db().doc(`camps/${campId}/participants/${participantId}`).set({
    fullName: 'Jane Doe',
    phone: '+233241234567',
    gender: 'F',
    subGroupId: 'sg1',
    subGroupName: 'Test Council',
    roomTypePreferenceId: 'rt1',
    roomTypePreferenceName: 'Standard',
    feeOwed: 100,
    amountPaid: 100,
    registrationState: 'REGISTERED',
    checkInState: 'NOT_ARRIVED',
    tags: [],
    source: 'admin',
    roomId: null,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides,
  })
}

function pDoc(campId: string, participantId: string) {
  return db().doc(`camps/${campId}/participants/${participantId}`)
}

async function snap(campId: string, participantId: string) {
  return pDoc(campId, participantId).get()
}

function makeEvent(
  campId: string,
  participantId: string,
  before: DocumentSnapshot,
  after: DocumentSnapshot,
  eventId: string,
) {
  return {
    specversion: '1.0',
    id: eventId,
    source: 'test',
    type: 'test',
    time: new Date().toISOString(),
    data: { before, after },
    location: 'test',
    project: 'demo-camp-app-test',
    database: '(default)',
    namespace: '(default)',
    document: `camps/${campId}/participants/${participantId}`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params: { campId, participantId } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

async function getSmsLog(campId: string, participantId: string) {
  const s = await db().collection(`camps/${campId}/smsLog`).where('participantId', '==', participantId).get()
  return s.docs.map((d) => d.data())
}

describe('onRoomAssigned — exactly once on assignment', () => {
  it('sends exactly one text on assignment; re-saving the same roomId sends nothing', async () => {
    const campId = `camp-${uniq()}`, pId = `p-${uniq()}`
    await seedCamp(campId, { enabled: true, senderId: 'FLGALATIANS' })
    await seedParticipant(campId, pId)
    const before = await snap(campId, pId)

    await pDoc(campId, pId).update({ roomId: 'room1', roomNumber: '101' })
    const after1 = await snap(campId, pId)

    const fetchMock = stubFetch(successBody)
    await onRoomAssigned.run(makeEvent(campId, pId, before, after1, `evt-${uniq()}`))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // A re-save that doesn't touch roomId (e.g. an unrelated note edit that
    // still writes the whole doc) must not trigger a second send.
    await pDoc(campId, pId).update({ notes: 'unrelated edit' })
    const after2 = await snap(campId, pId)
    await onRoomAssigned.run(makeEvent(campId, pId, after1, after2, `evt-${uniq()}`))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const log = await getSmsLog(campId, pId)
    expect(log).toHaveLength(1)
    expect(log[0].trigger).toBe('ROOM_ASSIGNED')
    expect(log[0].status).toBe('SENT')
  })
})

describe('onRoomAssigned — reassignment', () => {
  it('sends on reassignment to a different room; not when the target room is unchanged', async () => {
    const campId = `camp-${uniq()}`, pId = `p-${uniq()}`
    await seedCamp(campId, { enabled: true })
    await seedParticipant(campId, pId, { roomId: 'room1', roomNumber: '101' })
    const before = await snap(campId, pId)

    await pDoc(campId, pId).update({ roomId: 'room2', roomNumber: '202' })
    const after1 = await snap(campId, pId)

    const fetchMock = stubFetch(successBody)
    await onRoomAssigned.run(makeEvent(campId, pId, before, after1, `evt-${uniq()}`))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const log1 = await getSmsLog(campId, pId)
    expect(log1[0].trigger).toBe('ROOM_CHANGED')

    // "Reassignment" that keeps the same target room must not fire again.
    await pDoc(campId, pId).update({ notes: 'touch' })
    const after2 = await snap(campId, pId)
    await onRoomAssigned.run(makeEvent(campId, pId, after1, after2, `evt-${uniq()}`))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not fire when roomId is cleared (unassign)', async () => {
    const campId = `camp-${uniq()}`, pId = `p-${uniq()}`
    await seedCamp(campId, { enabled: true })
    await seedParticipant(campId, pId, { roomId: 'room1', roomNumber: '101' })
    const before = await snap(campId, pId)

    await pDoc(campId, pId).update({ roomId: FieldValue.delete(), roomNumber: FieldValue.delete() })
    const after = await snap(campId, pId)

    const fetchMock = stubFetch(successBody)
    await onRoomAssigned.run(makeEvent(campId, pId, before, after, `evt-${uniq()}`))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await getSmsLog(campId, pId)).toHaveLength(0)
  })
})

describe('onRoomAssigned — missing phone', () => {
  it('SKIPS with a reason, does not call the provider, and does not throw', async () => {
    const campId = `camp-${uniq()}`, pId = `p-${uniq()}`
    await seedCamp(campId, { enabled: true })
    await seedParticipant(campId, pId, { phone: 'not-a-real-phone' })
    const before = await snap(campId, pId)

    await pDoc(campId, pId).update({ roomId: 'room1', roomNumber: '101' })
    const after = await snap(campId, pId)

    const fetchMock = stubFetch(successBody)
    await expect(
      onRoomAssigned.run(makeEvent(campId, pId, before, after, `evt-${uniq()}`)),
    ).resolves.not.toThrow()

    expect(fetchMock).not.toHaveBeenCalled()
    const log = await getSmsLog(campId, pId)
    expect(log[0].status).toBe('SKIPPED')
    expect(log[0].reason).toMatch(/phone/i)
  })
})

describe('onRoomAssigned — provider failure', () => {
  it('logs FAILED and does not throw (assignment write already happened by construction)', async () => {
    const campId = `camp-${uniq()}`, pId = `p-${uniq()}`
    await seedCamp(campId, { enabled: true })
    await seedParticipant(campId, pId)
    const before = await snap(campId, pId)

    await pDoc(campId, pId).update({ roomId: 'room1', roomNumber: '101' })
    const after = await snap(campId, pId)

    stubFetch({ status: 'error', code: '4000', message: 'Server error' }, false, 500)
    await expect(
      onRoomAssigned.run(makeEvent(campId, pId, before, after, `evt-${uniq()}`)),
    ).resolves.not.toThrow()

    const log = await getSmsLog(campId, pId)
    expect(log[0].status).toBe('FAILED')
    expect(log[0].providerError).toBeTruthy()

    // The participant doc itself is untouched by the SMS outcome.
    const pSnap = await snap(campId, pId)
    expect(pSnap.data()!.roomId).toBe('room1')
  })
})

describe('onRoomAssigned — kill switch', () => {
  it('camp with no smsSettings (default off) → no provider call, SKIPPED logged', async () => {
    const campId = `camp-${uniq()}`, pId = `p-${uniq()}`
    await seedCamp(campId) // no smsSettings at all
    await seedParticipant(campId, pId)
    const before = await snap(campId, pId)

    await pDoc(campId, pId).update({ roomId: 'room1', roomNumber: '101' })
    const after = await snap(campId, pId)

    const fetchMock = stubFetch(successBody)
    await onRoomAssigned.run(makeEvent(campId, pId, before, after, `evt-${uniq()}`))

    expect(fetchMock).not.toHaveBeenCalled()
    const log = await getSmsLog(campId, pId)
    expect(log[0].status).toBe('SKIPPED')
    expect(log[0].reason).toMatch(/disabled/i)
  })

  it('camp with smsSettings.enabled explicitly false → no provider call', async () => {
    const campId = `camp-${uniq()}`, pId = `p-${uniq()}`
    await seedCamp(campId, { enabled: false })
    await seedParticipant(campId, pId)
    const before = await snap(campId, pId)

    await pDoc(campId, pId).update({ roomId: 'room1', roomNumber: '101' })
    const after = await snap(campId, pId)

    const fetchMock = stubFetch(successBody)
    await onRoomAssigned.run(makeEvent(campId, pId, before, after, `evt-${uniq()}`))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
