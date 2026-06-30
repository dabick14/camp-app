/**
 * Firestore scale probe — measures real query latency at ~500 participants.
 * Usage: GOOGLE_APPLICATION_CREDENTIALS=.../service-account-key.json npx tsx scripts/probe-scale.ts <campId>
 * Throwaway script — not committed.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const campId = process.argv[2]
if (!campId) { console.error('Usage: probe-scale.ts <campId>'); process.exit(1) }

if (!getApps().length) {
  initializeApp({ credential: cert(process.env.GOOGLE_APPLICATION_CREDENTIALS!) })
}
const db = getFirestore()

async function time(label: string, fn: () => Promise<unknown>) {
  const t0 = Date.now()
  try {
    const result = await fn()
    const ms = Date.now() - t0
    const count = Array.isArray(result) ? result.length
      : (result as any)?.size !== undefined ? (result as any).size
      : (result as any)?.docs?.length ?? '?'
    console.log(`  ✓ ${label}: ${ms}ms (${count} docs)`)
    return { ms, count, error: null }
  } catch (err: any) {
    const ms = Date.now() - t0
    console.log(`  ✗ ${label}: ${ms}ms — ERROR: ${err.message}`)
    return { ms, count: 0, error: err.message }
  }
}

async function run() {
  console.log(`\nProbing campId: ${campId}\n`)

  // ── 1. Full collection reads ───────────────────────────────────────────────
  console.log('=== Full collection reads ===')
  await time('listParticipants run #1', async () => {
    const snap = await db.collection('camps').doc(campId).collection('participants').get()
    return snap.docs
  })
  await time('listRooms', async () => {
    const snap = await db.collection('camps').doc(campId).collection('rooms').get()
    return snap.docs
  })
  await time('listSubGroups', async () => {
    const snap = await db.collection('camps').doc(campId).collection('subGroups').get()
    return snap.docs
  })
  await time('listRoomTypes', async () => {
    const snap = await db.collection('camps').doc(campId).collection('roomTypes').get()
    return snap.docs
  })
  await time('getCamp (single doc)', async () => {
    const snap = await db.collection('camps').doc(campId).get()
    return [snap]
  })

  // ── 2. Compound queries ────────────────────────────────────────────────────
  console.log('\n=== Compound queries (index risk) ===')
  const sgSnap = await db.collection('camps').doc(campId).collection('subGroups').limit(1).get()
  const subGroupId = sgSnap.docs[0]?.id ?? 'unknown'
  const subGroupName = sgSnap.docs[0]?.data()?.name ?? 'unknown'
  console.log(`  (subGroupId: ${subGroupId} — ${subGroupName})`)

  await time('paymentBatches subGroupId==X AND status==OPEN', async () => {
    const snap = await db.collection('camps').doc(campId).collection('paymentBatches')
      .where('subGroupId', '==', subGroupId)
      .where('status', '==', 'OPEN')
      .get()
    return snap.docs
  })

  await time('paymentBatches subGroupId==X (any status)', async () => {
    const snap = await db.collection('camps').doc(campId).collection('paymentBatches')
      .where('subGroupId', '==', subGroupId)
      .get()
    return snap.docs
  })

  // ── 3. Single-field queries ────────────────────────────────────────────────
  console.log('\n=== Single-field queries ===')
  await time('participants where subGroupId==X (leader scope)', async () => {
    const snap = await db.collection('camps').doc(campId).collection('participants')
      .where('subGroupId', '==', subGroupId)
      .get()
    return snap.docs
  })

  await time('participants where registrationState==REGISTERED limit 10', async () => {
    const snap = await db.collection('camps').doc(campId).collection('participants')
      .where('registrationState', '==', 'REGISTERED')
      .limit(10)
      .get()
    return snap.docs
  })

  await time('checkPhoneDuplicate (phone==X limit 5)', async () => {
    const snap = await db.collection('camps').doc(campId).collection('participants')
      .where('phone', '==', '0501234567')
      .limit(5)
      .get()
    return snap.docs
  })

  await time('listLeaders where campId==X', async () => {
    const snap = await db.collection('leaders')
      .where('campId', '==', campId)
      .get()
    return snap.docs
  })

  // ── 4. Warm-cache repeats ─────────────────────────────────────────────────
  console.log('\n=== listParticipants warm-cache repeats ===')
  await time('listParticipants run #2', async () => {
    const snap = await db.collection('camps').doc(campId).collection('participants').get()
    return snap.docs
  })
  await time('listParticipants run #3', async () => {
    const snap = await db.collection('camps').doc(campId).collection('participants').get()
    return snap.docs
  })

  console.log('\nDone.\n')
}

run().catch((e) => { console.error(e); process.exit(1) })
