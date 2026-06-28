import { beforeAll, describe, expect, it } from 'vitest'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import type { CallableRequest } from 'firebase-functions/v2/https'
import { leaderRegisterParticipant } from './leaderRegisterParticipant'

// Runs against the Firestore emulator only (FIRESTORE_EMULATOR_HOST is set
// by `firebase emulators:exec`, which the `test` npm script wraps this with).
// Auth context is supplied directly to `.run()` rather than via a real
// Firebase Auth token — `.run()` invokes the callable's handler in-process,
// bypassing the platform's own token verification, which is exactly the
// boundary this test needs to control to simulate a tampering client.
beforeAll(() => {
  if (getApps().length === 0) {
    initializeApp({ projectId: 'demo-camp-app-test' })
  }
})

function makeRequest(data: unknown, uid?: string): CallableRequest<any> {
  return {
    data,
    auth: uid ? { uid, token: {} as any, rawToken: '' } : undefined,
    rawRequest: {} as any,
  } as CallableRequest<any>
}

async function seedCamp(db: ReturnType<typeof getFirestore>, campId: string) {
  await db.doc(`camps/${campId}`).set({
    name: 'Test Camp',
    location: 'Test Location',
    registrationOpen: true,
    currency: 'GHS',
  })
}

describe('leaderRegisterParticipant — server-side binding (tamper check)', () => {
  it("binds subGroupId/subGroupName/campId from the leader's own doc, ignoring the request body entirely", async () => {
    const db = getFirestore()
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const campId = `camp-${suffix}`
    const wrongCampId = `camp-wrong-${suffix}`
    const subGroupAId = `sgA-${suffix}`
    const subGroupBId = `sgB-${suffix}`
    const roomTypeId = `rt-${suffix}`
    const leaderUid = `leader-${suffix}`

    await seedCamp(db, campId)
    await seedCamp(db, wrongCampId)
    await db.doc(`camps/${campId}/subGroups/${subGroupAId}`).set({ name: 'Council A', order: 0 })
    await db.doc(`camps/${campId}/subGroups/${subGroupBId}`).set({ name: 'Council B', order: 1 })
    await db.doc(`camps/${campId}/roomTypes/${roomTypeId}`).set({
      name: 'Standard',
      price: 100,
      defaultCapacity: 4,
      allowOverbook: false,
      order: 0,
    })
    // The leader is bound to sub-group A only.
    await db.doc(`leaders/${leaderUid}`).set({
      email: 'leaderA@example.com',
      campId,
      subGroupId: subGroupAId,
      subGroupName: 'Council A',
      active: true,
    })

    // Tampering payload: claims sub-group B and a different camp entirely.
    const request = makeRequest(
      {
        fullName: 'Tamper Test',
        phone: '0244000111',
        gender: 'M',
        roomTypePreferenceId: roomTypeId,
        subGroupId: subGroupBId,
        subGroupName: 'Council B',
        campId: wrongCampId,
      },
      leaderUid,
    )

    const result = await leaderRegisterParticipant.run(request)

    // The response must reflect the leader's OWN sub-group, not the tampered one.
    expect(result.subGroupName).toBe('Council A')

    const participantSnap = await db
      .doc(`camps/${campId}/participants/${result.participantId}`)
      .get()
    expect(participantSnap.exists).toBe(true)
    const participant = participantSnap.data()!

    expect(participant.subGroupId).toBe(subGroupAId)
    expect(participant.subGroupName).toBe('Council A')
    expect(participant.subGroupId).not.toBe(subGroupBId)
    expect(participant.source).toBe(leaderUid)

    // The tampered camp must never have received the write.
    const wrongCampParticipant = await db
      .doc(`camps/${wrongCampId}/participants/${result.participantId}`)
      .get()
    expect(wrongCampParticipant.exists).toBe(false)
  })

  it('rejects an unauthenticated call', async () => {
    const request = makeRequest({
      fullName: 'No Auth',
      phone: '0244000222',
      gender: 'F',
      roomTypePreferenceId: 'irrelevant',
    })

    await expect(leaderRegisterParticipant.run(request)).rejects.toMatchObject({
      code: 'unauthenticated',
    })
  })

  it('rejects a deactivated leader', async () => {
    const db = getFirestore()
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const campId = `camp-${suffix}`
    const subGroupId = `sg-${suffix}`
    const leaderUid = `leader-${suffix}`

    await seedCamp(db, campId)
    await db.doc(`leaders/${leaderUid}`).set({
      email: 'inactive@example.com',
      campId,
      subGroupId,
      subGroupName: 'Inactive Council',
      active: false,
    })

    const request = makeRequest(
      {
        fullName: 'Should Fail',
        phone: '0244000333',
        gender: 'M',
        roomTypePreferenceId: 'irrelevant',
      },
      leaderUid,
    )

    await expect(leaderRegisterParticipant.run(request)).rejects.toMatchObject({
      code: 'permission-denied',
    })
  })

  it('rejects a uid with no leader doc at all', async () => {
    const request = makeRequest(
      {
        fullName: 'Ghost Leader',
        phone: '0244000444',
        gender: 'F',
        roomTypePreferenceId: 'irrelevant',
      },
      `nonexistent-${Date.now()}`,
    )

    await expect(leaderRegisterParticipant.run(request)).rejects.toMatchObject({
      code: 'permission-denied',
    })
  })
})
