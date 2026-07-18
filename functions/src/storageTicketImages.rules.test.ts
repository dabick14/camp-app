/**
 * Tests storage.rules — ticket photo images (issue evidence / proof-of-fix)
 * are internal-ops-only and must be admin-only, the same boundary as the
 * tickets collection in firestore.rules. isAdmin() in storage.rules
 * cross-calls into Firestore's /admins collection, so this test env wires up
 * BOTH the Firestore and Storage emulators (see the `test` script in
 * package.json). Mirrors storageReceipts.rules.test.ts's structure/coverage.
 */
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'

let testEnv: RulesTestEnvironment

const campId = 'camp-1'
const ticketId = 'ticket-1'
const adminUid = 'admin-uid'
const leaderUid = 'leader-uid'
const imagePath = `camps/${campId}/tickets/${ticketId}/images/test.jpg`

const tinyImageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0x02, 0x03])

beforeAll(async () => {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  testEnv = await initializeTestEnvironment({
    // Cross-service firestore.exists() calls from storage.rules resolve
    // against the emulator suite's configured default project (.firebaserc),
    // not an arbitrary demo-* test project id like the Firestore-only rules
    // tests use — so this one has to match.
    projectId: 'camp-app-119bb',
    firestore: {
      rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
    },
    storage: {
      rules: readFileSync(resolve(__dirname, '../../storage.rules'), 'utf8'),
    },
  })
})

afterAll(async () => {
  await testEnv.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.clearStorage()
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(`admins/${adminUid}`).set({ email: 'admin@example.com' })
  })
})

describe('storage.rules — ticket images are admin-only', () => {
  it('allows an admin to upload a ticket photo', async () => {
    const adminCtx = testEnv.authenticatedContext(adminUid)
    await assertSucceeds(
      adminCtx.storage().ref(imagePath).put(tinyImageBytes, { contentType: 'image/jpeg' }),
    )
  })

  it('denies an unauthenticated upload', async () => {
    const anonCtx = testEnv.unauthenticatedContext()
    await assertFails(
      anonCtx.storage().ref(imagePath).put(tinyImageBytes, { contentType: 'image/jpeg' }),
    )
  })

  it('denies a non-admin authenticated upload (e.g. a coordinator/leader)', async () => {
    const leaderCtx = testEnv.authenticatedContext(leaderUid)
    await assertFails(
      leaderCtx.storage().ref(imagePath).put(tinyImageBytes, { contentType: 'image/jpeg' }),
    )
  })

  it('denies an upload over the 10MB size limit', async () => {
    const adminCtx = testEnv.authenticatedContext(adminUid)
    const bigBytes = new Uint8Array(10 * 1024 * 1024 + 1)
    await assertFails(
      adminCtx.storage().ref(imagePath).put(bigBytes, { contentType: 'image/jpeg' }),
    )
  })

  it('denies an upload with a non-image content type', async () => {
    const adminCtx = testEnv.authenticatedContext(adminUid)
    await assertFails(
      adminCtx.storage().ref(imagePath).put(tinyImageBytes, { contentType: 'application/pdf' }),
    )
  })

  it('allows an admin to read a ticket photo', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.storage().ref(imagePath).put(tinyImageBytes, { contentType: 'image/jpeg' })
    })
    const adminCtx = testEnv.authenticatedContext(adminUid)
    await assertSucceeds(adminCtx.storage().ref(imagePath).getDownloadURL())
  })

  it('denies a non-admin/coordinator read of a ticket photo', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.storage().ref(imagePath).put(tinyImageBytes, { contentType: 'image/jpeg' })
    })
    const leaderCtx = testEnv.authenticatedContext(leaderUid)
    await assertFails(leaderCtx.storage().ref(imagePath).getDownloadURL())
  })

  it('denies an unauthenticated read of a ticket photo', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.storage().ref(imagePath).put(tinyImageBytes, { contentType: 'image/jpeg' })
    })
    const anonCtx = testEnv.unauthenticatedContext()
    await assertFails(anonCtx.storage().ref(imagePath).getDownloadURL())
  })

  it('allows an admin to delete a ticket photo', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.storage().ref(imagePath).put(tinyImageBytes, { contentType: 'image/jpeg' })
    })
    const adminCtx = testEnv.authenticatedContext(adminUid)
    await assertSucceeds(adminCtx.storage().ref(imagePath).delete())
  })

  it('denies a non-admin delete of a ticket photo', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.storage().ref(imagePath).put(tinyImageBytes, { contentType: 'image/jpeg' })
    })
    const leaderCtx = testEnv.authenticatedContext(leaderUid)
    await assertFails(leaderCtx.storage().ref(imagePath).delete())
  })
})
