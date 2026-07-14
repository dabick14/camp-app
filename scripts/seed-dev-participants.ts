/**
 * scripts/seed-dev-participants.ts
 *
 * Emulator-only: adds participants to an existing dev camp without wiping anything.
 * Use after `npm run dev:seed` to bulk-up participant count for pagination testing.
 *
 * Usage:
 *   npm run dev:seed:participants               # adds 150 to dev-camp-2026
 *   npm run dev:seed:participants -- --count 50 # custom count
 *   npm run dev:seed:participants -- --camp <id> --count 200
 *   npm run dev:seed:participants -- --clean     # delete all seeded participants
 */

// Point Admin SDK at local emulators BEFORE init — same as seed-dev.ts
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

const PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID ?? 'camp-app-119bb'

if (!getApps().length) {
  initializeApp({ projectId: PROJECT_ID })
}
const db = getFirestore()

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
function getArg(flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : undefined
}
function hasFlag(flag: string): boolean { return args.includes(flag) }

const campId = getArg('--camp') ?? 'dev-camp-2026'
const count = parseInt(getArg('--count') ?? '150', 10)
const isClean = hasFlag('--clean')

// ── Name pools ────────────────────────────────────────────────────────────────

const MALE_FIRST = [
  'Kwame', 'Kofi', 'Yaw', 'Kwesi', 'Kojo', 'Kweku',
  'Daniel', 'Samuel', 'Emmanuel', 'Joshua', 'Isaac',
  'Michael', 'John', 'Akwasi', 'Nana', 'Bright',
]
const FEMALE_FIRST = [
  'Akua', 'Adwoa', 'Yaa', 'Ama', 'Akosua', 'Esi',
  'Mary', 'Grace', 'Faith', 'Rebecca', 'Sarah',
  'Hannah', 'Abena', 'Afia', 'Efua', 'Comfort',
]
const SURNAMES = [
  'Mensah', 'Asante', 'Owusu', 'Boateng', 'Addo',
  'Appiah', 'Nkrumah', 'Acquah', 'Quartey', 'Anane',
  'Adjei', 'Acheampong', 'Darko', 'Frimpong', 'Gyasi',
  'Kwarteng', 'Opoku', 'Sarpong', 'Tetteh', 'Quaye',
]

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}
function roundToCents(n: number): number {
  return Math.round(n * 100) / 100
}
function generatePhone(): string {
  return `+2332${Array.from({ length: 8 }, () => randInt(0, 9)).join('')}`
}

// ── Payment distribution ──────────────────────────────────────────────────────
// 20-slot cycle: 20% PENDING, 20% PARTIAL, 50% PAID, 5% OVERPAID, 5% WAIVED

type PaymentTier = 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERPAID' | 'WAIVED'

function pickPaymentTier(index: number): PaymentTier {
  const slot = index % 20
  if (slot < 4) return 'PENDING'
  if (slot < 8) return 'PARTIAL'
  if (slot < 18) return 'PAID'
  if (slot < 19) return 'OVERPAID'
  return 'WAIVED'
}

function amountsForTier(
  tier: PaymentTier,
  feeOwed: number,
): { feeOwed: number; amountPaid: number } {
  switch (tier) {
    case 'PENDING':  return { feeOwed, amountPaid: 0 }
    case 'PARTIAL': {
      const pct = randInt(25, 75) / 100
      const raw = roundToCents(feeOwed * pct)
      return { feeOwed, amountPaid: Math.max(0.50, Math.min(raw, roundToCents(feeOwed - 0.50))) }
    }
    case 'PAID':     return { feeOwed, amountPaid: feeOwed }
    case 'OVERPAID': return { feeOwed, amountPaid: roundToCents(feeOwed + randInt(1, 40) * 0.25) }
    case 'WAIVED':   return { feeOwed: 0, amountPaid: 0 }
  }
}

// ── Clean mode ────────────────────────────────────────────────────────────────

async function runClean(): Promise<void> {
  const snap = await db
    .collection(`camps/${campId}/participants`)
    .where('source', '==', 'dev-seed')
    .get()

  if (snap.empty) {
    console.log('No dev-seeded participants found — nothing to delete.')
    return
  }

  console.log(`Deleting ${snap.size} dev-seeded participants…`)
  const CHUNK = 400
  let deleted = 0
  for (let i = 0; i < snap.docs.length; i += CHUNK) {
    const batch = db.batch()
    for (const doc of snap.docs.slice(i, i + CHUNK)) batch.delete(doc.ref)
    await batch.commit()
    deleted += Math.min(CHUNK, snap.docs.length - i)
    if (snap.docs.length > CHUNK) process.stdout.write(`  ${deleted}/${snap.docs.length}…\n`)
  }
  console.log(`\n✓ Deleted ${deleted} dev-seeded participants from ${campId}`)
}

// ── Seed mode ─────────────────────────────────────────────────────────────────

async function runSeed(): Promise<void> {
  if (isNaN(count) || count < 1) {
    console.error('--count must be a positive integer')
    process.exit(1)
  }

  // Verify camp exists
  const campSnap = await db.doc(`camps/${campId}`).get()
  if (!campSnap.exists) {
    console.error(`Camp "${campId}" does not exist. Run npm run dev:seed first.`)
    process.exit(1)
  }
  const campName = (campSnap.data() as { name: string }).name

  // Read sub-groups and room types
  const [sgsSnap, rtsSnap] = await Promise.all([
    db.collection(`camps/${campId}/subGroups`).get(),
    db.collection(`camps/${campId}/roomTypes`).get(),
  ])

  if (sgsSnap.empty) {
    console.error('No sub-groups found. Run npm run dev:seed first.')
    process.exit(1)
  }
  if (rtsSnap.empty) {
    console.error('No room types found. Run npm run dev:seed first.')
    process.exit(1)
  }

  const subGroups = sgsSnap.docs.map(d => ({ id: d.id, name: (d.data() as { name: string }).name }))
  const roomTypes = rtsSnap.docs.map(d => ({
    id: d.id,
    name: (d.data() as { name: string; price: number }).name,
    price: (d.data() as { name: string; price: number }).price,
  }))

  console.log(`\nCamp: ${campName} (${campId})`)
  console.log(`Adding ${count} participants across ${subGroups.length} sub-groups…\n`)

  const now = Timestamp.now()
  const colRef = db.collection(`camps/${campId}/participants`)

  const participants: Record<string, unknown>[] = []

  for (let i = 0; i < count; i++) {
    const gender: 'M' | 'F' = i % 2 === 0 ? 'M' : 'F'
    const firstName = pick(gender === 'M' ? MALE_FIRST : FEMALE_FIRST)
    const fullName = `${firstName} ${pick(SURNAMES)}`
    const subGroup = subGroups[i % subGroups.length]
    const roomType = roomTypes[i % roomTypes.length]

    const tier = pickPaymentTier(i)
    const feeOwedBase = roundToCents(roomType.price + randInt(1, 99) / 100)
    const { feeOwed, amountPaid } = amountsForTier(tier, feeOwedBase)
    const registrationState: 'REGISTERED' | 'CANCELLED' = i % 20 === 5 ? 'CANCELLED' : 'REGISTERED'

    // Spread registrations over the last 30 days
    const daysAgo = randInt(0, 30)
    const createdAt = Timestamp.fromMillis(Date.now() - daysAgo * 86_400_000)

    participants.push({
      fullName,
      phone: generatePhone(),
      gender,
      subGroupId: subGroup.id,
      subGroupName: subGroup.name,
      roomTypePreferenceId: roomType.id,
      roomTypePreferenceName: roomType.name,
      feeOwed,
      amountPaid,
      tags: [],
      registrationState,
      checkInState: 'NOT_ARRIVED',
      roomedWithoutFullPayment: false,
      source: 'dev-seed',
      notes: '',
      createdAt,
      updatedAt: createdAt,
      updatedBy: 'seed-script',
    })
  }

  // Batch write in chunks of 400 (Firestore limit is 500)
  const CHUNK = 400
  let written = 0
  for (let i = 0; i < participants.length; i += CHUNK) {
    const batch = db.batch()
    for (const p of participants.slice(i, i + CHUNK)) batch.set(colRef.doc(), p)
    await batch.commit()
    written += Math.min(CHUNK, participants.length - i)
    if (participants.length > CHUNK) process.stdout.write(`  Written ${written}/${participants.length}…\n`)
  }

  console.log(`✓ Created ${count} participants in ${campId}`)

  // Quick count
  const total = await db.collection(`camps/${campId}/participants`).count().get()
  console.log(`  Total participants in camp now: ${total.data().count}`)
  console.log('\nOpen http://localhost:5173 and navigate to Participants to test pagination.')
}

// ── Entry ─────────────────────────────────────────────────────────────────────

if (isClean) {
  runClean().catch(err => { console.error('Fatal:', (err as Error).message); process.exit(1) })
} else {
  runSeed().catch(err => { console.error('Fatal:', (err as Error).message); process.exit(1) })
}
