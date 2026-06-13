/**
 * scripts/seed-participants.ts
 *
 * Dev-only seed script for generating test participants.
 * NOT imported by the React app. Never ships to production.
 *
 * Usage:
 *   npm run seed -- --camp <campId> [--count N] [--yes] [--force] [--confirm-large]
 *   npm run seed:clean -- --camp <campId> [--yes]
 *
 * Requires:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
 */

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import * as readline from 'readline';

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

const campId = getArg('--camp');
const rawCount = getArg('--count');
const count = parseInt(rawCount ?? '10', 10);
const isClean = hasFlag('--clean');
const confirmLarge = hasFlag('--confirm-large');
const skipConfirm = hasFlag('--yes');
const forceDouble = hasFlag('--force');

// ── Name pools ────────────────────────────────────────────────────────────────

const MALE_FIRST = [
  'Kwame', 'Kofi', 'Yaw', 'Kwesi', 'Kojo',
  'Kweku', 'Daniel', 'Samuel', 'Emmanuel', 'Joshua',
  'Isaac', 'Michael', 'John', 'Akwasi', 'Nana',
];

const FEMALE_FIRST = [
  'Akua', 'Adwoa', 'Yaa', 'Ama', 'Akosua',
  'Esi', 'Mary', 'Grace', 'Faith', 'Rebecca',
  'Sarah', 'Hannah', 'Abena', 'Afia', 'Efua',
];

const SURNAMES = [
  'Mensah', 'Asante', 'Owusu', 'Boateng', 'Addo',
  'Appiah', 'Nkrumah', 'Acquah', 'Quartey', 'Anane',
  'Adjei', 'Acheampong', 'Darko', 'Frimpong', 'Gyasi',
  'Kwarteng', 'Opoku', 'Sarpong',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function roundToNearest50(n: number): number {
  return Math.round(n / 50) * 50;
}

function randomTimestampWithinDays(days: number): Timestamp {
  const now = Date.now();
  const earliest = now - days * 24 * 60 * 60 * 1000;
  return Timestamp.fromMillis(randInt(earliest, now));
}

function randomDOB(minAge: number, maxAge: number): Timestamp {
  const now = new Date();
  const year = now.getFullYear() - randInt(minAge, maxAge);
  const month = randInt(0, 11);
  const day = randInt(1, 28);
  return Timestamp.fromDate(new Date(year, month, day));
}

function generatePhone(): string {
  // +233 2XX XXX XXX — 8 random digits after "2", so 9 total after +233
  const suffix = Array.from({ length: 8 }, () => randInt(0, 9)).join('');
  return `+2332${suffix}`;
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, ans => {
      rl.close();
      resolve(ans);
    });
  });
}

function die(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

// ── Payment distribution ──────────────────────────────────────────────────────
//
// 20-slot cycle → exact target percentages without randomness drift:
//   slots 0-3  (4/20 = 20%) PENDING
//   slots 4-7  (4/20 = 20%) PARTIAL
//   slots 8-17 (10/20 = 50%) PAID
//   slot 18    (1/20 = 5%)  OVERPAID  (derives to PAID)
//   slot 19    (1/20 = 5%)  WAIVED

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

function amountsForTier(
  tier: PaymentTier,
  feeOwed: number,
): { feeOwed: number; amountPaid: number } {
  switch (tier) {
    case 'PENDING':
      return { feeOwed, amountPaid: 0 };

    case 'PARTIAL': {
      const pct = randInt(25, 75) / 100;
      const raw = roundToNearest50(feeOwed * pct);
      // Clamp so it's always > 0 and < feeOwed
      const amountPaid = Math.max(50, Math.min(raw, feeOwed - 50));
      return { feeOwed, amountPaid };
    }

    case 'PAID':
      return { feeOwed, amountPaid: feeOwed };

    case 'OVERPAID':
      return { feeOwed, amountPaid: feeOwed + randInt(1, 4) * 50 };

    case 'WAIVED':
      return { feeOwed: 0, amountPaid: 0 };
  }
}

function derivePaymentState(feeOwed: number, amountPaid: number): DerivedState {
  if (feeOwed === 0) return 'WAIVED';
  if (amountPaid >= feeOwed) return 'PAID';
  if (amountPaid > 0) return 'PARTIAL';
  return 'PENDING';
}

// ── Clean mode ────────────────────────────────────────────────────────────────

async function runClean(
  campId: string,
  campName: string,
): Promise<void> {
  const db = getFirestore();
  const seedSnap = await db
    .collection(`camps/${campId}/participants`)
    .where('source', '==', 'seed')
    .get();

  console.log(`\nCamp: ${campName} (${campId})`);

  if (seedSnap.empty) {
    console.log('No seeded participants found — nothing to delete.');
    return;
  }

  console.log(`Found ${seedSnap.size} seeded participant(s) to delete.`);
  console.log('(Participants without source: "seed" will NOT be touched.)');

  if (!skipConfirm) {
    const answer = await prompt('\nDelete them? [y/N] ');
    if (answer.trim().toLowerCase() !== 'y') {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  const CHUNK = 400;
  const docs = seedSnap.docs;
  let deleted = 0;

  for (let start = 0; start < docs.length; start += CHUNK) {
    const batch = db.batch();
    for (const doc of docs.slice(start, start + CHUNK)) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    deleted += Math.min(CHUNK, docs.length - start);
    if (docs.length > CHUNK) {
      console.log(`  Deleted ${deleted}/${docs.length}…`);
    }
  }

  console.log(`\n✓ Deleted ${deleted} seeded participant(s) from camp "${campName}".`);
}

// ── Seed mode ─────────────────────────────────────────────────────────────────

async function runSeed(campId: string, campName: string): Promise<void> {
  const db = getFirestore();

  // Safety: large-count guard
  if (count > 100 && !confirmLarge) {
    die(`--count ${count} exceeds 100. Pass --confirm-large to proceed.`);
  }

  // Read sub-groups and room types
  const [subGroupsSnap, roomTypesSnap] = await Promise.all([
    db.collection(`camps/${campId}/subGroups`).get(),
    db.collection(`camps/${campId}/roomTypes`).get(),
  ]);

  if (subGroupsSnap.empty) {
    die('No sub-groups found for this camp. Create sub-groups first (Admin > Sub-groups).');
  }
  if (roomTypesSnap.empty) {
    die('No room types found for this camp. Create room types first (Admin > Room Types).');
  }

  const subGroups = subGroupsSnap.docs.map(d => ({
    id: d.id,
    name: (d.data() as { name: string }).name,
  }));
  const roomTypes = roomTypesSnap.docs.map(d => ({
    id: d.id,
    name: (d.data() as { name: string; price: number }).name,
    price: (d.data() as { name: string; price: number }).price,
  }));

  // Safety: double-seed guard (count query, no document reads)
  if (!forceDouble) {
    const countAgg = await db.collection(`camps/${campId}/participants`).count().get();
    const existing = countAgg.data().count;
    if (existing >= 500) {
      die(
        `Camp already has ${existing} participants (≥ 500). Pass --force to seed anyway.`,
      );
    }
  }

  // Pre-flight summary + confirmation
  console.log(`\nCamp:        ${campName} (${campId})`);
  console.log(`Sub-groups:  ${subGroups.map(s => s.name).join(', ')}`);
  console.log(
    `Room types:  ${roomTypes.map(r => `${r.name} (GHS ${r.price})`).join(', ')}`,
  );
  console.log(`To create:   ${count} participant(s)`);

  if (!skipConfirm) {
    const answer = await prompt('\nProceed? [y/N] ');
    if (answer.trim().toLowerCase() !== 'y') {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  // Generate participants
  const tally: Record<DerivedState, number> = { PENDING: 0, PARTIAL: 0, PAID: 0, WAIVED: 0 };
  const subGroupCounts: Record<string, number> = {};
  const roomTypeCounts: Record<string, number> = {};
  const sampleNames: string[] = [];

  // Use type Record<string, unknown> to keep participant shape flexible for Firestore
  const participants: Record<string, unknown>[] = [];

  for (let i = 0; i < count; i++) {
    const gender: 'M' | 'F' = i % 2 === 0 ? 'M' : 'F';
    const firstName = pick(gender === 'M' ? MALE_FIRST : FEMALE_FIRST);
    const surname = pick(SURNAMES);
    const fullName = `${firstName} ${surname}`;

    const subGroup = subGroups[i % subGroups.length];
    const roomType = roomTypes[i % roomTypes.length];

    const tier = pickPaymentTier(i);
    const { feeOwed, amountPaid } = amountsForTier(tier, roomType.price);

    const derived = derivePaymentState(feeOwed, amountPaid);
    tally[derived]++;

    // ~5% CANCELLED — use slot 3 of every 20 (same slot as first PENDING to keep variation)
    // Avoid making all PENDING be CANCELLED; use a separate index offset
    const registrationState: 'REGISTERED' | 'CANCELLED' =
      i % 20 === 5 ? 'CANCELLED' : 'REGISTERED';

    // Email: 70% chance
    const emailSlug = `${firstName.toLowerCase()}.${surname.toLowerCase()}`;
    const email = Math.random() < 0.7 ? `${emailSlug}@test.local` : undefined;

    // DOB vs age: 50/50 split
    const useDOB = Math.random() < 0.5;
    const dateOfBirth = useDOB ? randomDOB(18, 60) : undefined;
    const age = !useDOB ? randInt(18, 60) : undefined;

    // Spread createdAt over the last 30 days for meaningful time-series later
    const createdAt = randomTimestampWithinDays(30);

    subGroupCounts[subGroup.name] = (subGroupCounts[subGroup.name] ?? 0) + 1;
    roomTypeCounts[roomType.name] = (roomTypeCounts[roomType.name] ?? 0) + 1;
    if (sampleNames.length < 3) sampleNames.push(`${fullName} (${gender})`);

    const participant: Record<string, unknown> = {
      // Identity
      fullName,
      phone: generatePhone(),
      gender,

      // Sub-group (denormalized)
      subGroupId: subGroup.id,
      subGroupName: subGroup.name,

      // Room type preference (denormalized)
      roomTypePreferenceId: roomType.id,
      roomTypePreferenceName: roomType.name,

      // Payment (paymentState is DERIVED — not stored)
      feeOwed,
      amountPaid,

      // Tags
      tags: [],

      // States
      registrationState,
      checkInState: 'NOT_ARRIVED',

      // Room assignment — none at seed time
      roomedWithoutFullPayment: false,

      // Provenance — allows --clean to find exactly these docs
      source: 'seed',

      notes: '',
      createdAt,
      updatedAt: createdAt,
      updatedBy: 'seed-script',
    };

    if (email !== undefined) participant.email = email;
    if (dateOfBirth !== undefined) participant.dateOfBirth = dateOfBirth;
    if (age !== undefined) participant.age = age;

    participants.push(participant);
  }

  // Batch write — Firestore max is 500/batch; use 400 to stay safe
  const CHUNK = 400;
  const colRef = db.collection(`camps/${campId}/participants`);
  let written = 0;

  for (let start = 0; start < participants.length; start += CHUNK) {
    const batch = db.batch();
    for (const p of participants.slice(start, start + CHUNK)) {
      batch.set(colRef.doc(), p);
    }
    await batch.commit();
    written += Math.min(CHUNK, participants.length - start);
    if (participants.length > CHUNK) {
      process.stdout.write(`  Written ${written}/${participants.length}…\n`);
    }
  }

  // Summary
  console.log(`\n✓ Created ${count} participant(s) in camps/${campId}/participants\n`);

  console.log('Payment state (derived):');
  for (const [state, n] of Object.entries(tally) as [DerivedState, number][]) {
    console.log(`  ${state.padEnd(10)} ${n}`);
  }

  console.log('\nBy sub-group:');
  for (const [name, n] of Object.entries(subGroupCounts)) {
    console.log(`  ${name.padEnd(24)} ${n}`);
  }

  console.log('\nBy room type preference:');
  for (const [name, n] of Object.entries(roomTypeCounts)) {
    console.log(`  ${name.padEnd(24)} ${n}`);
  }

  console.log('\nSample names:');
  for (const name of sampleNames) {
    console.log(`  ${name}`);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Validate required arg
  if (!campId) {
    die(
      '--camp <campId> is required.\n\n' +
      'Examples:\n' +
      '  npm run seed -- --camp abc123\n' +
      '  npm run seed -- --camp abc123 --count 50 --yes\n' +
      '  npm run seed:clean -- --camp abc123',
    );
  }

  if (!isClean && (isNaN(count) || count < 1)) {
    die(`--count must be a positive integer (got "${rawCount}")`);
  }

  // Firebase Admin init — reads GOOGLE_APPLICATION_CREDENTIALS automatically
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    die(
      'GOOGLE_APPLICATION_CREDENTIALS is not set.\n\n' +
      'Steps:\n' +
      '  1. Go to Firebase Console > Project Settings > Service accounts\n' +
      '  2. Click "Generate new private key" and save the JSON file\n' +
      '  3. Add service-account-key.json to .gitignore (already done)\n' +
      '  4. Run: export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json\n' +
      '  5. Re-run the seed command',
    );
  }

  if (!getApps().length) {
    initializeApp({ credential: applicationDefault() });
  }

  const db = getFirestore();

  // Verify camp exists
  const campSnap = await db.doc(`camps/${campId}`).get();
  if (!campSnap.exists) {
    die(`Camp "${campId}" does not exist in Firestore.`);
  }
  const campName = (campSnap.data() as { name: string }).name;

  if (isClean) {
    await runClean(campId, campName);
  } else {
    await runSeed(campId, campName);
  }
}

main().catch(err => {
  console.error('\nFatal error:', (err as Error).message ?? err);
  process.exit(1);
});
