/**
 * scripts/seed-dev.ts
 *
 * Populates the local Firebase Emulator Suite with a complete set of test data:
 *   - 1 camp with sub-groups, room types, and rooms
 *   - 30 participants across payment and check-in states
 *   - 2 payment batches (one OPEN with unallocated balance, one RECONCILED)
 *   - Firebase Auth users you can actually log in with:
 *       admin@test.local    / Admin1234!
 *       leader-a@test.local / Leader1234!   → Galilee Council
 *       leader-b@test.local / Leader1234!   → Judah Council
 *
 * Prerequisites: emulators must be running first.
 *   npm run emulators        ← in one terminal
 *   npm run dev:seed         ← in another
 *
 * Safe to re-run: clears the project namespace before seeding.
 */

// Point the Admin SDK at the local emulators BEFORE initializing the app.
// These env vars are read by firebase-admin when getFirestore/getAuth is called.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'  // Admin SDK: no http:// prefix

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'

// Use the real project ID so the emulator namespace matches what the Vite dev
// client connects to (VITE_FIREBASE_PROJECT_ID in .env.local).
const PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID ?? 'camp-app-119bb'

if (!getApps().length) {
  // No credential needed — the emulator env vars above bypass auth entirely.
  initializeApp({ projectId: PROJECT_ID })
}

const db = getFirestore()
const adminAuth = getAuth()

// ── Name pools ────────────────────────────────────────────────────────────────

const MALE_FIRST = ['Kwame', 'Kofi', 'Yaw', 'Kwesi', 'Kojo', 'Daniel', 'Samuel', 'Emmanuel', 'Joshua', 'Isaac']
const FEMALE_FIRST = ['Akua', 'Adwoa', 'Yaa', 'Ama', 'Akosua', 'Mary', 'Grace', 'Faith', 'Rebecca', 'Sarah']
const SURNAMES = ['Mensah', 'Asante', 'Owusu', 'Boateng', 'Addo', 'Appiah', 'Acquah', 'Adjei', 'Darko', 'Frimpong']

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }
function randInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min }
function phone() { return `+2332${Array.from({ length: 8 }, () => randInt(0, 9)).join('')}` }

// ── Wipe the project namespace in the emulator (safe re-run) ─────────────────

async function clearEmulatorData() {
  const url = `http://127.0.0.1:8080/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`
  try {
    const res = await fetch(url, { method: 'DELETE' })
    if (res.ok) {
      console.log('  Cleared existing emulator data.')
    } else {
      // Emulator might not expose this endpoint on older versions — non-fatal
      console.log(`  (Clear skipped: emulator returned ${res.status})`)
    }
  } catch {
    console.log('  (Clear skipped: emulator clear endpoint not reachable)')
  }
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

async function upsertUser(email: string, password: string, displayName: string): Promise<string> {
  try {
    const existing = await adminAuth.getUserByEmail(email)
    await adminAuth.deleteUser(existing.uid)
  } catch {
    // User doesn't exist yet — that's fine
  }
  const user = await adminAuth.createUser({ email, password, displayName })
  return user.uid
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🌱 Seeding emulator for project: ${PROJECT_ID}\n`)

  await clearEmulatorData()

  // ── Camp ───────────────────────────────────────────────────────────────────

  const campId = 'dev-camp-2026'
  const now = Timestamp.now()

  await db.doc(`camps/${campId}`).set({
    name: 'Harvest Camp 2026',
    location: 'Accra, Ghana',
    startDate: Timestamp.fromDate(new Date('2026-08-01')),
    endDate: Timestamp.fromDate(new Date('2026-08-07')),
    description: 'Dev seed camp — safe to modify',
    registrationOpen: true,
    currency: 'GHS',
    createdAt: now,
    updatedAt: now,
    createdBy: 'seed',
  })
  console.log('  ✓ Camp: Harvest Camp 2026')

  // ── Sub-groups ─────────────────────────────────────────────────────────────

  const subGroups = [
    { id: 'sg-galilee', name: 'Galilee Council', order: 0 },
    { id: 'sg-judah',   name: 'Judah Council',   order: 1 },
    { id: 'sg-ephraim', name: 'Ephraim Council',  order: 2 },
  ]
  for (const sg of subGroups) {
    await db.doc(`camps/${campId}/subGroups/${sg.id}`).set({
      name: sg.name, order: sg.order, createdAt: now, updatedAt: now,
    })
  }
  console.log(`  ✓ Sub-groups: ${subGroups.map(s => s.name).join(', ')}`)

  // ── Room types ─────────────────────────────────────────────────────────────

  const roomTypes = [
    { id: 'rt-dorm',    name: 'Standard Dorm',   price: 400, defaultCapacity: 20, allowOverbook: true,  order: 0 },
    { id: 'rt-couple',  name: 'Couple Room',      price: 600, defaultCapacity: 1,  allowOverbook: false, order: 1 },
    { id: 'rt-premium', name: 'Premium Room',     price: 800, defaultCapacity: 4,  allowOverbook: false, order: 2 },
  ]
  for (const rt of roomTypes) {
    await db.doc(`camps/${campId}/roomTypes/${rt.id}`).set({
      name: rt.name, price: rt.price,
      defaultCapacity: rt.defaultCapacity, allowOverbook: rt.allowOverbook,
      order: rt.order, createdAt: now, updatedAt: now,
    })
  }
  console.log(`  ✓ Room types: ${roomTypes.map(r => r.name).join(', ')}`)

  // ── Rooms ──────────────────────────────────────────────────────────────────

  const rooms: { id: string; number: string; rtId: string; rtName: string; gender: 'M'|'F'; cap: number }[] = [
    { id: 'room-d1m', number: 'D1', rtId: 'rt-dorm',    rtName: 'Standard Dorm', gender: 'M', cap: 20 },
    { id: 'room-d2m', number: 'D2', rtId: 'rt-dorm',    rtName: 'Standard Dorm', gender: 'M', cap: 20 },
    { id: 'room-d3f', number: 'D3', rtId: 'rt-dorm',    rtName: 'Standard Dorm', gender: 'F', cap: 20 },
    { id: 'room-d4f', number: 'D4', rtId: 'rt-dorm',    rtName: 'Standard Dorm', gender: 'F', cap: 20 },
    { id: 'room-c1m', number: 'C1', rtId: 'rt-couple',  rtName: 'Couple Room',   gender: 'M', cap: 1  },
    { id: 'room-c2f', number: 'C2', rtId: 'rt-couple',  rtName: 'Couple Room',   gender: 'F', cap: 1  },
    { id: 'room-p1m', number: 'P1', rtId: 'rt-premium', rtName: 'Premium Room',  gender: 'M', cap: 4  },
    { id: 'room-p2f', number: 'P2', rtId: 'rt-premium', rtName: 'Premium Room',  gender: 'F', cap: 4  },
  ]

  // Track occupancy as we assign rooms below
  const occupancy: Record<string, number> = {}
  for (const r of rooms) {
    occupancy[r.id] = 0
    await db.doc(`camps/${campId}/rooms/${r.id}`).set({
      number: r.number,
      roomTypeId: r.rtId,
      roomTypeName: r.rtName,
      gender: r.gender,
      capacity: r.cap,
      currentOccupancy: 0,
      createdAt: now, updatedAt: now, createdBy: 'seed',
    })
  }
  console.log(`  ✓ Rooms: ${rooms.length} rooms`)

  // ── Auth users ─────────────────────────────────────────────────────────────

  console.log('\n  Creating Auth users…')
  const adminUid = await upsertUser('admin@test.local', 'Admin1234!', 'Test Admin')
  const leaderAUid = await upsertUser('leader-a@test.local', 'Leader1234!', 'Leader Galilee')
  const leaderBUid = await upsertUser('leader-b@test.local', 'Leader1234!', 'Leader Judah')
  console.log(`  ✓ admin@test.local     uid: ${adminUid}`)
  console.log(`  ✓ leader-a@test.local  uid: ${leaderAUid}`)
  console.log(`  ✓ leader-b@test.local  uid: ${leaderBUid}`)

  // ── /admins and /leaders docs ──────────────────────────────────────────────

  await db.doc(`admins/${adminUid}`).set({
    email: 'admin@test.local',
    displayName: 'Test Admin',
    createdAt: now,
  })

  await db.doc(`leaders/${leaderAUid}`).set({
    email: 'leader-a@test.local',
    displayName: 'Leader Galilee',
    campId,
    subGroupId: 'sg-galilee',
    subGroupName: 'Galilee Council',
    active: true,
    createdAt: now,
    updatedAt: now,
    createdBy: adminUid,
  })

  await db.doc(`leaders/${leaderBUid}`).set({
    email: 'leader-b@test.local',
    displayName: 'Leader Judah',
    campId,
    subGroupId: 'sg-judah',
    subGroupName: 'Judah Council',
    active: true,
    createdAt: now,
    updatedAt: now,
    createdBy: adminUid,
  })
  console.log('  ✓ /admins and /leaders docs')

  // ── Participants ───────────────────────────────────────────────────────────

  console.log('\n  Seeding participants…')

  // 30 participants, 10 per sub-group, across payment states.
  // Slot-based distribution (same cycle as seed-participants.ts):
  //   0-3   PENDING   (4 per 10)
  //   4-5   PARTIAL   (2 per 10)
  //   6-8   PAID      (3 per 10)
  //   9     WAIVED    (1 per 10)

  const participantBatch = db.batch()
  const participantIds: string[] = []

  // Track which PAID participants to room (we'll room a few per gender)
  const paidMaleIds: string[] = []
  const paidFemaleIds: string[] = []

  for (let i = 0; i < 30; i++) {
    const sg = subGroups[i % 3]
    const rt = roomTypes[i % 3]
    const gender: 'M' | 'F' = i % 2 === 0 ? 'M' : 'F'
    const firstName = pick(gender === 'M' ? MALE_FIRST : FEMALE_FIRST)
    const fullName = `${firstName} ${pick(SURNAMES)}`

    const slot = i % 10
    let feeOwed = rt.price
    let amountPaid = 0
    let registrationState: 'REGISTERED' | 'CANCELLED' = 'REGISTERED'

    if (slot <= 3) {
      amountPaid = 0                              // PENDING
    } else if (slot <= 5) {
      amountPaid = Math.round(rt.price * 0.5)    // PARTIAL
    } else if (slot <= 8) {
      amountPaid = rt.price                       // PAID
    } else {
      feeOwed = 0; amountPaid = 0                // WAIVED
    }

    // One CANCELLED per sub-group for realism
    if (i % 10 === 7) registrationState = 'CANCELLED'

    const pId = `p-${i.toString().padStart(3, '0')}`
    participantIds.push(pId)

    const p: Record<string, unknown> = {
      fullName, phone: phone(), gender,
      subGroupId: sg.id, subGroupName: sg.name,
      roomTypePreferenceId: rt.id, roomTypePreferenceName: rt.name,
      feeOwed, amountPaid,
      tags: slot === 6 ? ['Worker'] : [],
      registrationState,
      checkInState: 'NOT_ARRIVED',
      roomedWithoutFullPayment: false,
      source: leaderAUid,
      createdAt: now, updatedAt: now, updatedBy: 'seed',
    }

    // Track for room assignment below
    if (amountPaid >= feeOwed && feeOwed > 0 && registrationState === 'REGISTERED') {
      if (gender === 'M') paidMaleIds.push(pId)
      else paidFemaleIds.push(pId)
    }

    participantBatch.set(db.doc(`camps/${campId}/participants/${pId}`), p)
  }
  await participantBatch.commit()
  console.log('  ✓ 30 participants (PENDING / PARTIAL / PAID / WAIVED)')

  // ── Room assignments for a few PAID participants ───────────────────────────

  const assignBatch = db.batch()
  const roomedAt = now

  // Assign 3 males to D1, 2 females to D3
  const toRoomM = paidMaleIds.slice(0, 3)
  const toRoomF = paidFemaleIds.slice(0, 2)

  for (const pId of toRoomM) {
    assignBatch.update(db.doc(`camps/${campId}/participants/${pId}`), {
      roomId: 'room-d1m', roomNumber: 'D1',
      roomAssignedBy: adminUid, roomAssignedAt: roomedAt,
      checkInState: 'ARRIVED', updatedAt: roomedAt, updatedBy: adminUid,
    })
    occupancy['room-d1m'] = (occupancy['room-d1m'] ?? 0) + 1
  }
  for (const pId of toRoomF) {
    assignBatch.update(db.doc(`camps/${campId}/participants/${pId}`), {
      roomId: 'room-d3f', roomNumber: 'D3',
      roomAssignedBy: adminUid, roomAssignedAt: roomedAt,
      checkInState: 'ARRIVED', updatedAt: roomedAt, updatedBy: adminUid,
    })
    occupancy['room-d3f'] = (occupancy['room-d3f'] ?? 0) + 1
  }

  // Update room occupancy counts
  for (const [roomId, count] of Object.entries(occupancy)) {
    if (count > 0) {
      assignBatch.update(db.doc(`camps/${campId}/rooms/${roomId}`), {
        currentOccupancy: count, updatedAt: roomedAt,
      })
    }
  }
  await assignBatch.commit()
  console.log(`  ✓ Roomed ${toRoomM.length + toRoomF.length} participants (D1, D3)`)

  // ── Payment batches ────────────────────────────────────────────────────────

  // Batch 1: OPEN with unallocated balance → gates Galilee registration
  await db.doc(`camps/${campId}/paymentBatches/batch-open`).set({
    referenceCode: 'GALILEE-001',
    subGroupId: 'sg-galilee',
    subGroupName: 'Galilee Council',
    amountReceived: 2000,
    amountAllocated: 0,
    method: 'MOMO',
    receivedAt: now,
    receivedBy: adminUid,
    status: 'OPEN',
    varianceAcknowledged: false,
    createdAt: now,
    updatedAt: now,
  })

  // Batch 2: RECONCILED → Judah is unblocked
  await db.doc(`camps/${campId}/paymentBatches/batch-reconciled`).set({
    referenceCode: 'JUDAH-001',
    subGroupId: 'sg-judah',
    subGroupName: 'Judah Council',
    amountReceived: 1200,
    amountAllocated: 1200,
    method: 'CASH',
    receivedAt: now,
    receivedBy: adminUid,
    status: 'RECONCILED',
    varianceAcknowledged: false,
    createdAt: now,
    updatedAt: now,
  })

  console.log('  ✓ Payment batches: GALILEE-001 (OPEN, gates registration), JUDAH-001 (RECONCILED)')

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Emulator seed complete

Test accounts (log in at http://localhost:5173):
  admin@test.local     Admin1234!   → admin dashboard
  leader-a@test.local  Leader1234!  → Galilee Council (registration GATED by open batch)
  leader-b@test.local  Leader1234!  → Judah Council (registration open)

Emulator UI: http://localhost:4000
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)
}

main().catch(err => {
  console.error('\n❌ Seed failed:', (err as Error).message ?? err)
  process.exit(1)
})
