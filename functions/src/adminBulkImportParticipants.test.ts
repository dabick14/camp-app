/**
 * Tests for the adminBulkImportParticipants Cloud Function's write logic.
 *
 * adminBulkImportParticipants is an onRequest function (req/res), like
 * adminAddParticipant/provisionLeader/setLeaderActive — not directly callable
 * with a `.run()` helper the way onCall functions are (see setPaymentClaim.test.ts).
 * So the batch-write logic is factored into runBulkImportChunk and tested
 * directly against the Firestore emulator here; the onRequest wrapper is just
 * auth + validation glue with no independent logic worth emulator-testing.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { runBulkImportChunk, type BulkImportRow } from './adminBulkImportParticipants'

beforeAll(() => {
  if (getApps().length === 0) {
    initializeApp({ projectId: 'demo-camp-app-test' })
  }
})

function db() { return getFirestore() }
function uniq() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }

async function seedCamp(campId: string) {
  await db().doc(`camps/${campId}`).set({
    name: 'Test Camp', location: 'Accra', registrationOpen: true, currency: 'GHS',
  })
}

async function seedSubGroup(campId: string, sgId: string, name: string) {
  await db().doc(`camps/${campId}/subGroups/${sgId}`).set({
    name, order: 0, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  })
}

async function seedRoomType(campId: string, rtId: string, name: string, price: number) {
  await db().doc(`camps/${campId}/roomTypes/${rtId}`).set({
    name, price, defaultCapacity: 4, allowOverbook: true, order: 0,
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  })
}

function makeRow(overrides: Partial<BulkImportRow> & { subGroupId: string; roomTypePreferenceId: string }): BulkImportRow {
  return {
    rowNum: 2,
    fullName: 'Jane Doe',
    phone: '0244111222',
    gender: 'F',
    ...overrides,
  }
}

describe('runBulkImportChunk — happy path', () => {
  it('writes participants with resolved subGroupName/roomTypePreferenceName/feeOwed and correct defaults', async () => {
    const s = uniq()
    const campId = `camp-${s}`, sgId = `sg-${s}`, rtId = `rt-${s}`
    await seedCamp(campId)
    await seedSubGroup(campId, sgId, 'FLC Miotso')
    await seedRoomType(campId, rtId, 'Standard', 500)

    const result = await runBulkImportChunk(
      db(), campId,
      [makeRow({ rowNum: 2, fullName: '  Jane Doe  ', phone: '0244111222', subGroupId: sgId, roomTypePreferenceId: rtId })],
      'admin-uid', 'admin@test.com',
    )

    expect(result).toEqual({ imported: 1, skipped: [] })

    const snap = await db().collection(`camps/${campId}/participants`).get()
    expect(snap.docs).toHaveLength(1)
    const p = snap.docs[0].data()
    expect(p).toMatchObject({
      fullName: 'Jane Doe',
      phone: '0244111222',
      gender: 'F',
      subGroupId: sgId,
      subGroupName: 'FLC Miotso',
      roomTypePreferenceId: rtId,
      roomTypePreferenceName: 'Standard',
      feeOwed: 500,
      amountPaid: 0,
      registrationState: 'REGISTERED',
      checkInState: 'NOT_ARRIVED',
      tags: [],
      roomId: null,
      source: 'admin-uid',
      updatedBy: 'admin@test.com',
    })
  })

  it('omits the phone field entirely when not provided (no undefined written)', async () => {
    const s = uniq()
    const campId = `camp-${s}`, sgId = `sg-${s}`, rtId = `rt-${s}`
    await seedCamp(campId)
    await seedSubGroup(campId, sgId, 'Choir')
    await seedRoomType(campId, rtId, 'Dorm', 300)

    await runBulkImportChunk(
      db(), campId,
      [makeRow({ fullName: 'No Phone Guy', phone: undefined, subGroupId: sgId, roomTypePreferenceId: rtId })],
      'admin-uid', 'admin@test.com',
    )

    const snap = await db().collection(`camps/${campId}/participants`).get()
    expect(snap.docs[0].data().phone).toBeUndefined()
  })

  it('writes multiple rows in a single batch', async () => {
    const s = uniq()
    const campId = `camp-${s}`, sgId = `sg-${s}`, rtId = `rt-${s}`
    await seedCamp(campId)
    await seedSubGroup(campId, sgId, 'Youth')
    await seedRoomType(campId, rtId, 'Standard', 400)

    const rows = Array.from({ length: 25 }, (_, i) =>
      makeRow({ rowNum: i + 2, fullName: `Participant ${i}`, subGroupId: sgId, roomTypePreferenceId: rtId }),
    )
    const result = await runBulkImportChunk(db(), campId, rows, 'admin-uid', 'admin@test.com')

    expect(result.imported).toBe(25)
    expect(result.skipped).toEqual([])
    const snap = await db().collection(`camps/${campId}/participants`).get()
    expect(snap.docs).toHaveLength(25)
  })
})

describe('runBulkImportChunk — server-side rejection of stale references', () => {
  it('skips a row whose subGroupId no longer exists, still writes the rest', async () => {
    const s = uniq()
    const campId = `camp-${s}`, sgId = `sg-${s}`, rtId = `rt-${s}`
    await seedCamp(campId)
    await seedSubGroup(campId, sgId, 'Real Group')
    await seedRoomType(campId, rtId, 'Standard', 400)

    const result = await runBulkImportChunk(
      db(), campId,
      [
        makeRow({ rowNum: 2, fullName: 'Ghost SubGroup', subGroupId: 'deleted-sg', roomTypePreferenceId: rtId }),
        makeRow({ rowNum: 3, fullName: 'Valid Person', subGroupId: sgId, roomTypePreferenceId: rtId }),
      ],
      'admin-uid', 'admin@test.com',
    )

    expect(result.imported).toBe(1)
    expect(result.skipped).toEqual([{ rowNum: 2, reason: 'Sub-group no longer exists' }])
    const snap = await db().collection(`camps/${campId}/participants`).get()
    expect(snap.docs).toHaveLength(1)
    expect(snap.docs[0].data().fullName).toBe('Valid Person')
  })

  it('skips a row whose roomTypePreferenceId no longer exists', async () => {
    const s = uniq()
    const campId = `camp-${s}`, sgId = `sg-${s}`
    await seedCamp(campId)
    await seedSubGroup(campId, sgId, 'Real Group')

    const result = await runBulkImportChunk(
      db(), campId,
      [makeRow({ rowNum: 5, subGroupId: sgId, roomTypePreferenceId: 'deleted-rt' })],
      'admin-uid', 'admin@test.com',
    )

    expect(result.imported).toBe(0)
    expect(result.skipped).toEqual([{ rowNum: 5, reason: 'Room type no longer exists' }])
  })

  it('skips a row with an invalid gender rather than throwing', async () => {
    const s = uniq()
    const campId = `camp-${s}`, sgId = `sg-${s}`, rtId = `rt-${s}`
    await seedCamp(campId)
    await seedSubGroup(campId, sgId, 'Real Group')
    await seedRoomType(campId, rtId, 'Standard', 400)

    const result = await runBulkImportChunk(
      db(), campId,
      [makeRow({ rowNum: 9, gender: 'X', subGroupId: sgId, roomTypePreferenceId: rtId })],
      'admin-uid', 'admin@test.com',
    )

    expect(result.imported).toBe(0)
    expect(result.skipped).toEqual([{ rowNum: 9, reason: 'gender must be M or F' }])
  })

  it('when every row is skipped, does not call batch.commit() (no-op, no error)', async () => {
    const s = uniq()
    const campId = `camp-${s}`
    await seedCamp(campId)

    const result = await runBulkImportChunk(
      db(), campId,
      [makeRow({ subGroupId: 'nope', roomTypePreferenceId: 'nope' })],
      'admin-uid', 'admin@test.com',
    )

    expect(result.imported).toBe(0)
    const snap = await db().collection(`camps/${campId}/participants`).get()
    expect(snap.docs).toHaveLength(0)
  })
})
