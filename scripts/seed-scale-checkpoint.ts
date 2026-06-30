/**
 * scripts/seed-scale-checkpoint.ts
 *
 * Day 4.5 scale checkpoint (BUILD_PLAN.md). One-command setup of a dedicated,
 * clearly-named test camp with ~500 participants, ~50 rooms, 2 leaders bound
 * to 2 sub-groups, and a handful of payment batches + allocations — all at
 * realistic, varied states (mixed payment tiers, some room-assigned, some
 * tagged, a few roomed-without-full-payment overrides).
 *
 * NOT imported by the React app. Dev-only.
 *
 * The camp itself (name, sub-groups, room types) is found-or-created once and
 * reused across runs — stable IDs, so the 2 leader logins keep working.
 * Rooms / participants / payment batches / allocations are wiped and
 * regenerated FRESH on every run — true idempotency, not accumulation.
 *
 * Usage:
 *   npm run seed:scale [-- --yes]
 *   npm run seed:scale:clean [-- --yes]   (deletes the whole test camp + leader accounts)
 *
 * Requires:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
 */

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import * as readline from 'readline';

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function hasFlag(flag: string): boolean {
  return args.includes(flag);
}
const isClean = hasFlag('--clean');
const skipConfirm = hasFlag('--yes');

// ── Constants — this is the ONLY camp this script ever touches ─────────────────

const TEST_CAMP_NAME = '⚠️ SCALE TEST CAMP — seed data, do not use for real registration';
const SUB_GROUP_NAMES = [
  'Joseph Council', 'Deborah Council', 'Solomon Council',
  'Esther Council', 'Daniel Council', 'Ruth Council',
];
const ROOM_TYPE_DEFS = [
  { name: 'Dormitory', price: 150, defaultCapacity: 20, allowOverbook: true, order: 0 },
  { name: 'Standard Room', price: 300, defaultCapacity: 4, allowOverbook: false, order: 1 },
  { name: 'Couple / 24 Houses', price: 600, defaultCapacity: 1, allowOverbook: false, order: 2 },
];
// Rooms per type per gender — 50 total: 10 dorms (5M/5F), 30 standard (15M/15F), 10 couple (5M/5F)
const ROOMS_PER_TYPE_PER_GENDER = [5, 15, 5];

const PARTICIPANT_COUNT = 500;
const LEADER_SUBGROUP_INDEXES = [0, 1]; // Joseph Council, Deborah Council
const LEADER_EMAILS = ['scale-test-leader-1@example.com', 'scale-test-leader-2@example.com'];
const LEADER_PASSWORD = 'ScaleTest123!';
const TAG_POOL = ['Worker', 'First-timer', 'Group A', 'Group B', 'Volunteer', 'Youth Leader'];
const OVERRIDE_COUNT = 8; // participants force-roomed despite PENDING/PARTIAL

// ── Name pools (same style as seed-participants.ts) ─────────────────────────

const MALE_FIRST = ['Kwame', 'Kofi', 'Yaw', 'Kwesi', 'Kojo', 'Kweku', 'Daniel', 'Samuel', 'Emmanuel', 'Joshua', 'Isaac', 'Michael', 'John', 'Akwasi', 'Nana'];
const FEMALE_FIRST = ['Akua', 'Adwoa', 'Yaa', 'Ama', 'Akosua', 'Esi', 'Mary', 'Grace', 'Faith', 'Rebecca', 'Sarah', 'Hannah', 'Abena', 'Afia', 'Efua'];
const SURNAMES = ['Mensah', 'Asante', 'Owusu', 'Boateng', 'Addo', 'Appiah', 'Nkrumah', 'Acquah', 'Quartey', 'Anane', 'Adjei', 'Acheampong', 'Darko', 'Frimpong', 'Gyasi', 'Kwarteng', 'Opoku', 'Sarpong'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function roundToCents(n: number): number {
  return Math.round(n * 100) / 100;
}
function randomTimestampWithinDays(days: number): Timestamp {
  const now = Date.now();
  return Timestamp.fromMillis(randInt(now - days * 24 * 60 * 60 * 1000, now));
}
function randomDOB(minAge: number, maxAge: number): Timestamp {
  const now = new Date();
  return Timestamp.fromDate(new Date(now.getFullYear() - randInt(minAge, maxAge), randInt(0, 11), randInt(1, 28)));
}
function generatePhone(seq: number): string {
  // Deterministic-ish but unique per run to avoid the duplicate-phone hard block.
  return `+2332${String(seq).padStart(8, '0')}`;
}
function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
}
function die(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

// ── Payment tier distribution (same 20-slot cycle as seed-participants.ts) ──

type PaymentTier = 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERPAID' | 'WAIVED';
type DerivedState = 'PENDING' | 'PARTIAL' | 'PAID' | 'WAIVED';

function pickPaymentTier(index: number): PaymentTier {
  const slot = index % 20;
  if (slot < 4) return 'PENDING';
  if (slot < 8) return 'PARTIAL';
  if (slot < 18) return 'PAID';
  if (slot < 19) return 'OVERPAID';
  return 'WAIVED';
}
function amountsForTier(tier: PaymentTier, feeOwed: number): { feeOwed: number; amountPaid: number } {
  switch (tier) {
    case 'PENDING': return { feeOwed, amountPaid: 0 };
    case 'PARTIAL': {
      const raw = roundToCents(feeOwed * (randInt(25, 75) / 100));
      return { feeOwed, amountPaid: Math.max(0.5, Math.min(raw, roundToCents(feeOwed - 0.5))) };
    }
    case 'PAID': return { feeOwed, amountPaid: feeOwed };
    case 'OVERPAID': return { feeOwed, amountPaid: roundToCents(feeOwed + randInt(1, 40) * 0.25) };
    case 'WAIVED': return { feeOwed: 0, amountPaid: 0 };
  }
}
function derivePaymentState(feeOwed: number, amountPaid: number): DerivedState {
  if (feeOwed === 0) return 'WAIVED';
  if (amountPaid >= feeOwed) return 'PAID';
  if (amountPaid > 0) return 'PARTIAL';
  return 'PENDING';
}

// ── Find-or-create: camp, sub-groups, room types (stable across runs) ───────

async function findOrCreateCamp(db: FirebaseFirestore.Firestore): Promise<{ id: string; ref: DocumentReference }> {
  const snap = await db.collection('camps').where('name', '==', TEST_CAMP_NAME).limit(1).get();
  if (!snap.empty) {
    return { id: snap.docs[0].id, ref: snap.docs[0].ref };
  }
  const now = Timestamp.now();
  const ref = await db.collection('camps').add({
    name: TEST_CAMP_NAME,
    location: 'Scale Test Venue',
    startDate: Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000),
    endDate: Timestamp.fromMillis(Date.now() + 34 * 24 * 60 * 60 * 1000),
    currency: 'GHS',
    registrationOpen: true,
    createdAt: now,
    createdBy: 'seed-scale-checkpoint',
    updatedAt: now,
  });
  return { id: ref.id, ref };
}

async function findOrCreateSubGroups(
  db: FirebaseFirestore.Firestore,
  campId: string,
): Promise<{ id: string; name: string }[]> {
  const existing = await db.collection(`camps/${campId}/subGroups`).get();
  const byName = new Map(existing.docs.map((d) => [(d.data().name as string), d.id]));

  const result: { id: string; name: string }[] = [];
  const now = Timestamp.now();
  for (let i = 0; i < SUB_GROUP_NAMES.length; i++) {
    const name = SUB_GROUP_NAMES[i];
    let id = byName.get(name);
    if (!id) {
      const ref = await db.collection(`camps/${campId}/subGroups`).add({ name, order: i, createdAt: now, updatedAt: now });
      id = ref.id;
    }
    result.push({ id, name });
  }
  return result;
}

async function findOrCreateRoomTypes(
  db: FirebaseFirestore.Firestore,
  campId: string,
): Promise<{ id: string; name: string; price: number; defaultCapacity: number; allowOverbook: boolean }[]> {
  const existing = await db.collection(`camps/${campId}/roomTypes`).get();
  const byName = new Map(existing.docs.map((d) => [(d.data().name as string), d.id]));

  const result: { id: string; name: string; price: number; defaultCapacity: number; allowOverbook: boolean }[] = [];
  const now = Timestamp.now();
  for (const def of ROOM_TYPE_DEFS) {
    let id = byName.get(def.name);
    if (!id) {
      const ref = await db.collection(`camps/${campId}/roomTypes`).add({ ...def, createdAt: now, updatedAt: now });
      id = ref.id;
    }
    result.push({ id, ...def });
  }
  return result;
}

// ── Wipe: rooms / participants / paymentBatches / allocations for this camp ──

async function wipeSubcollection(db: FirebaseFirestore.Firestore, path: string): Promise<number> {
  const snap = await db.collection(path).get();
  const CHUNK = 400;
  for (let start = 0; start < snap.docs.length; start += CHUNK) {
    const batch = db.batch();
    for (const doc of snap.docs.slice(start, start + CHUNK)) batch.delete(doc.ref);
    await batch.commit();
  }
  return snap.size;
}

async function deleteLeaderAccounts(): Promise<void> {
  for (const email of LEADER_EMAILS) {
    try {
      const user = await getAuth().getUserByEmail(email);
      await getAuth().deleteUser(user.uid);
      await getFirestore().doc(`leaders/${user.uid}`).delete();
    } catch {
      // doesn't exist — fine
    }
  }
}

// ── Clean mode ────────────────────────────────────────────────────────────────

async function runClean(): Promise<void> {
  const db = getFirestore();
  const campSnap = await db.collection('camps').where('name', '==', TEST_CAMP_NAME).limit(1).get();

  if (campSnap.empty) {
    console.log('No scale test camp found — nothing to clean.');
    await deleteLeaderAccounts();
    return;
  }

  const campId = campSnap.docs[0].id;
  console.log(`\nTest camp: ${TEST_CAMP_NAME} (${campId})`);

  if (!skipConfirm) {
    const answer = await prompt('Delete this camp and ALL its data, plus the 2 test leader accounts? [y/N] ');
    if (answer.trim().toLowerCase() !== 'y') { console.log('Aborted.'); return; }
  }

  for (const sub of ['participants', 'rooms', 'paymentBatches', 'allocations', 'subGroups', 'roomTypes']) {
    const n = await wipeSubcollection(db, `camps/${campId}/${sub}`);
    console.log(`  Deleted ${n} doc(s) from ${sub}`);
  }
  await campSnap.docs[0].ref.delete();
  await deleteLeaderAccounts();
  console.log('\n✓ Scale test camp and leader accounts fully removed.');
}

// ── Seed mode ─────────────────────────────────────────────────────────────────

async function runSeed(): Promise<void> {
  const db = getFirestore();

  const camp = await findOrCreateCamp(db);
  const subGroups = await findOrCreateSubGroups(db, camp.id);
  const roomTypes = await findOrCreateRoomTypes(db, camp.id);

  console.log(`\nTest camp:   ${TEST_CAMP_NAME}`);
  console.log(`Camp ID:     ${camp.id}`);
  console.log(`Sub-groups:  ${subGroups.map((s) => s.name).join(', ')}`);
  console.log(`Room types:  ${roomTypes.map((r) => r.name).join(', ')}`);
  console.log(`To create:   ${PARTICIPANT_COUNT} participants, ~50 rooms, 2 leaders, 4 payment batches`);
  console.log('(Existing rooms/participants/batches/allocations in this camp will be wiped first.)');

  if (!skipConfirm) {
    const answer = await prompt('\nProceed? [y/N] ');
    if (answer.trim().toLowerCase() !== 'y') { console.log('Aborted.'); return; }
  }

  console.log('\nWiping existing seed data for this camp…');
  for (const sub of ['participants', 'rooms', 'paymentBatches', 'allocations']) {
    const n = await wipeSubcollection(db, `camps/${camp.id}/${sub}`);
    if (n > 0) console.log(`  Cleared ${n} existing ${sub}`);
  }

  // ── Build room shells in-memory (capacity tracked, not yet written) ────────

  interface RoomShell {
    ref: DocumentReference;
    number: string;
    roomTypeId: string;
    roomTypeName: string;
    gender: 'M' | 'F';
    capacity: number;
    occupied: number;
  }
  const roomShells: RoomShell[] = [];
  let roomSeq = 1;
  for (let t = 0; t < roomTypes.length; t++) {
    const rt = roomTypes[t];
    const perGender = ROOMS_PER_TYPE_PER_GENDER[t];
    for (const gender of ['M', 'F'] as const) {
      for (let i = 0; i < perGender; i++) {
        roomShells.push({
          ref: db.collection(`camps/${camp.id}/rooms`).doc(),
          number: `${roomSeq++}`,
          roomTypeId: rt.id,
          roomTypeName: rt.name,
          gender,
          capacity: rt.defaultCapacity,
          occupied: 0,
        });
      }
    }
  }

  function takeRoom(gender: 'M' | 'F', roomTypeId: string): RoomShell | null {
    const candidate = roomShells.find((r) => r.gender === gender && r.roomTypeId === roomTypeId && r.occupied < r.capacity);
    if (candidate) candidate.occupied++;
    return candidate ?? null;
  }

  // ── Generate participants in-memory ─────────────────────────────────────────

  interface ParticipantShell {
    ref: DocumentReference;
    data: Record<string, unknown>;
    subGroupId: string;
    subGroupName: string;
    derivedState: DerivedState;
  }
  const participants: ParticipantShell[] = [];
  const tally: Record<DerivedState, number> = { PENDING: 0, PARTIAL: 0, PAID: 0, WAIVED: 0 };
  let overridesAssigned = 0;
  let roomedCount = 0;
  let taggedCount = 0;
  let cancelledCount = 0;

  for (let i = 0; i < PARTICIPANT_COUNT; i++) {
    const gender: 'M' | 'F' = i % 2 === 0 ? 'M' : 'F';
    const fullName = `${pick(gender === 'M' ? MALE_FIRST : FEMALE_FIRST)} ${pick(SURNAMES)}`;
    const subGroup = subGroups[i % subGroups.length];
    const roomType = roomTypes[i % roomTypes.length];

    const tier = pickPaymentTier(i);
    const feeOwedBase = roundToCents(roomType.price + randInt(1, 99) / 100);
    const { feeOwed, amountPaid } = amountsForTier(tier, feeOwedBase);
    const derived = derivePaymentState(feeOwed, amountPaid);
    tally[derived]++;

    const registrationState: 'REGISTERED' | 'CANCELLED' = i % 20 === 5 ? 'CANCELLED' : 'REGISTERED';
    if (registrationState === 'CANCELLED') cancelledCount++;

    const tags: string[] = [];
    if (Math.random() < 0.2) {
      tags.push(pick(TAG_POOL));
      if (Math.random() < 0.3) tags.push(pick(TAG_POOL));
      taggedCount++;
    }

    // Room assignment — only for REGISTERED. Force-override the first
    // OVERRIDE_COUNT PENDING/PARTIAL we see; otherwise only PAID/WAIVED get
    // auto-assigned (real rooming rule), and not all of those either — about
    // half, so the snapshot looks mid-camp, not fully roomed.
    let roomId: string | undefined;
    let roomNumber: string | undefined;
    let checkInState: 'NOT_ARRIVED' | 'ARRIVED' = 'NOT_ARRIVED';
    let roomedWithoutFullPayment = false;
    let roomedWithoutFullPaymentNote: string | undefined;

    if (registrationState === 'REGISTERED') {
      const isShortPaid = derived === 'PENDING' || derived === 'PARTIAL';
      const wantsOverrideRoom = isShortPaid && overridesAssigned < OVERRIDE_COUNT;
      const wantsNormalRoom = (derived === 'PAID' || derived === 'WAIVED') && Math.random() < 0.5;

      if (wantsOverrideRoom || wantsNormalRoom) {
        const room = takeRoom(gender, roomType.id);
        if (room) {
          roomId = room.ref.id;
          roomNumber = room.number;
          checkInState = 'ARRIVED';
          roomedCount++;
          if (wantsOverrideRoom) {
            roomedWithoutFullPayment = true;
            roomedWithoutFullPaymentNote = 'Council leader confirmed cash on hand — seed override for scale test';
            overridesAssigned++;
          }
        }
      }
    }

    const createdAt = randomTimestampWithinDays(30);
    const useDOB = Math.random() < 0.5;

    const data: Record<string, unknown> = {
      fullName,
      phone: generatePhone(i),
      gender,
      subGroupId: subGroup.id,
      subGroupName: subGroup.name,
      roomTypePreferenceId: roomType.id,
      roomTypePreferenceName: roomType.name,
      feeOwed,
      amountPaid,
      tags,
      registrationState,
      checkInState,
      roomedWithoutFullPayment,
      source: 'seed',
      notes: '',
      createdAt,
      updatedAt: createdAt,
      updatedBy: 'seed-scale-checkpoint',
    };
    if (roomId) {
      data.roomId = roomId;
      data.roomNumber = roomNumber;
      data.roomAssignedBy = 'seed-scale-checkpoint';
      data.roomAssignedAt = createdAt;
      data.checkedInBy = 'seed-scale-checkpoint';
      data.checkedInAt = createdAt;
    }
    if (roomedWithoutFullPaymentNote) data.roomedWithoutFullPaymentNote = roomedWithoutFullPaymentNote;
    if (Math.random() < 0.7) data.email = `${fullName.toLowerCase().replace(/\s+/g, '.')}.${i}@test.local`;
    if (useDOB) data.dateOfBirth = randomDOB(18, 60);
    else data.age = randInt(18, 60);

    participants.push({
      ref: db.collection(`camps/${camp.id}/participants`).doc(),
      data,
      subGroupId: subGroup.id,
      subGroupName: subGroup.name,
      derivedState: derived,
    });
  }

  // ── Write rooms (final occupancy baked in) ──────────────────────────────────

  console.log(`\nWriting ${roomShells.length} rooms…`);
  {
    const CHUNK = 400;
    for (let start = 0; start < roomShells.length; start += CHUNK) {
      const batch = db.batch();
      for (const r of roomShells.slice(start, start + CHUNK)) {
        batch.set(r.ref, {
          number: r.number,
          roomTypeId: r.roomTypeId,
          roomTypeName: r.roomTypeName,
          gender: r.gender,
          capacity: r.capacity,
          currentOccupancy: r.occupied,
          createdAt: Timestamp.now(),
          createdBy: 'seed-scale-checkpoint',
          updatedAt: Timestamp.now(),
        });
      }
      await batch.commit();
    }
  }

  // ── Write participants ───────────────────────────────────────────────────────

  console.log(`Writing ${participants.length} participants…`);
  {
    const CHUNK = 400;
    for (let start = 0; start < participants.length; start += CHUNK) {
      const batch = db.batch();
      for (const p of participants.slice(start, start + CHUNK)) batch.set(p.ref, p.data);
      await batch.commit();
      console.log(`  ${Math.min(start + CHUNK, participants.length)}/${participants.length}…`);
    }
  }

  // ── Leaders — 2 real Firebase Auth users + /leaders/{uid} docs ─────────────

  console.log('\nProvisioning 2 test leaders…');
  const leaderCreds: { email: string; subGroupName: string }[] = [];
  for (let i = 0; i < LEADER_SUBGROUP_INDEXES.length; i++) {
    const sg = subGroups[LEADER_SUBGROUP_INDEXES[i]];
    const email = LEADER_EMAILS[i];
    let uid: string;
    try {
      const existing = await getAuth().getUserByEmail(email);
      uid = existing.uid;
    } catch {
      const created = await getAuth().createUser({ email, password: LEADER_PASSWORD, emailVerified: true });
      uid = created.uid;
    }
    const now = Timestamp.now();
    await db.doc(`leaders/${uid}`).set({
      email,
      campId: camp.id,
      subGroupId: sg.id,
      subGroupName: sg.name,
      active: true,
      createdAt: now,
      createdBy: 'seed-scale-checkpoint',
      updatedAt: now,
    });
    leaderCreds.push({ email, subGroupName: sg.name });
  }

  // ── Payment batches + allocations — a handful, decorative (no UI consumes
  // these yet; Payments is still a placeholder). Just enough to exercise the
  // collections existing and being queryable. ──────────────────────────────

  console.log('Writing 4 payment batches + allocations…');
  const batchDefs = [
    { subGroupIdx: 0, status: 'OPEN' as const, amountReceived: 5000, amountAllocated: 3000, variance: false },
    { subGroupIdx: 0, status: 'RECONCILED' as const, amountReceived: 4000, amountAllocated: 4000, variance: false },
    { subGroupIdx: 1, status: 'OPEN' as const, amountReceived: 2000, amountAllocated: 2000, variance: false },
    { subGroupIdx: 2, status: 'RECONCILED' as const, amountReceived: 6000, amountAllocated: 5800, variance: true },
  ];
  let batchSeq = 1;
  for (const def of batchDefs) {
    const sg = subGroups[def.subGroupIdx];
    const code = `${sg.name.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8)}-${String(batchSeq++).padStart(3, '0')}`;
    const now = Timestamp.now();
    const batchRef = await db.collection(`camps/${camp.id}/paymentBatches`).add({
      referenceCode: code,
      subGroupId: sg.id,
      subGroupName: sg.name,
      amountReceived: def.amountReceived,
      amountAllocated: def.amountAllocated,
      method: 'MOMO',
      receivedAt: now,
      receivedBy: 'seed-scale-checkpoint',
      status: def.status,
      varianceAcknowledged: def.variance,
      createdAt: now,
      updatedAt: now,
    });

    // 2-3 allocations summing to ~amountAllocated, against real participants in this sub-group.
    const candidates = participants.filter((p) => p.subGroupId === sg.id).slice(0, 3);
    let remaining = def.amountAllocated;
    for (let i = 0; i < candidates.length; i++) {
      const isLast = i === candidates.length - 1;
      const amount = isLast ? remaining : roundToCents(remaining / (candidates.length - i) * (0.5 + Math.random() * 0.5));
      remaining -= amount;
      await db.collection(`camps/${camp.id}/allocations`).add({
        batchId: batchRef.id,
        participantId: candidates[i].ref.id,
        participantName: candidates[i].data.fullName,
        amount: roundToCents(amount),
        createdAt: now,
        createdBy: 'seed-scale-checkpoint',
        voided: false,
      });
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────

  console.log(`\n✓ Seed complete for "${TEST_CAMP_NAME}"\n`);
  console.log(`Camp ID:           ${camp.id}`);
  console.log(`Participants:      ${PARTICIPANT_COUNT} (${cancelledCount} cancelled)`);
  console.log('Payment state (derived):');
  for (const [state, n] of Object.entries(tally)) console.log(`  ${state.padEnd(10)} ${n}`);
  console.log(`Tagged:            ${taggedCount}`);
  console.log(`Room-assigned:     ${roomedCount} (of which ${overridesAssigned} are PENDING/PARTIAL overrides)`);
  console.log(`Rooms:             ${roomShells.length}`);
  console.log(`Payment batches:   ${batchDefs.length}`);
  console.log('\nTest leader logins (password for both: ' + LEADER_PASSWORD + '):');
  for (const c of leaderCreds) console.log(`  ${c.email}  →  ${c.subGroupName}`);
  console.log(`\nAdmin URL:  /admin/camps/${camp.id}`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    die(
      'GOOGLE_APPLICATION_CREDENTIALS is not set.\n\n' +
      'Steps:\n' +
      '  1. Firebase Console > Project Settings > Service accounts > Generate new private key\n' +
      '  2. export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json\n' +
      '  3. Re-run',
    );
  }
  if (!getApps().length) {
    initializeApp({ credential: applicationDefault() });
  }

  if (isClean) await runClean();
  else await runSeed();
}

main().catch((err) => {
  console.error('\nFatal error:', (err as Error).message ?? err);
  process.exit(1);
});
