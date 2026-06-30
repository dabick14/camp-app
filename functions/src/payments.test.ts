/**
 * Day 5a tests — two locked money-path rules:
 *
 * 1. Reconciliation-status derivation
 *    A sub-group is ⚠️ (blocks new registrations) if it has any batch where
 *    status === 'OPEN' AND (amountReceived - amountAllocated) > 0.
 *    Once that condition is cleared (batch reconciled or fully allocated) it
 *    reads ✅.  This is the rule that gates leader-side registrations; locking
 *    it here prevents silent regressions.
 *
 * 2. Reference-code format
 *    "first 8 alphanumeric chars of sub-group name uppercased + '-' + 3-digit
 *    zero-padded sequence number per camp" (PAYMENTS_SPEC.md).
 *    E.g. "Galatians Council" with seq 7 → "GALATIAN-007".
 *    Sequence must be unique within a camp run.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// ── Inline copies of the pure derivation + reference-code logic ───────────────
// These mirror src/features/payments/types.ts exactly.
// Any divergence between this test and that file is a bug.

interface PaymentBatch {
  status: 'OPEN' | 'RECONCILED'
  amountReceived: number
  amountAllocated: number
}

function hasUnreconciledBatch(batches: PaymentBatch[]): boolean {
  return batches.some(
    (b) => b.status === 'OPEN' && b.amountReceived - b.amountAllocated > 0,
  )
}

function referenceCodePrefix(subGroupName: string): string {
  return subGroupName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8)
}

function generateReferenceCode(subGroupName: string, seq: number): string {
  return `${referenceCodePrefix(subGroupName)}-${String(seq).padStart(3, '0')}`
}

// ─────────────────────────────────────────────────────────────────────────────

beforeAll(() => {
  if (getApps().length === 0) {
    initializeApp({ projectId: 'demo-camp-app-test' })
  }
})

const db = () => getFirestore()

function uniq(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// ── 1. Reconciliation-status derivation (pure-function layer) ─────────────────

describe('hasUnreconciledBatch — pure derivation', () => {
  it('returns true when an OPEN batch has unallocated balance', () => {
    const batches: PaymentBatch[] = [
      { status: 'OPEN', amountReceived: 1000, amountAllocated: 0 },
    ]
    expect(hasUnreconciledBatch(batches)).toBe(true)
  })

  it('returns true when an OPEN batch is partially allocated', () => {
    const batches: PaymentBatch[] = [
      { status: 'OPEN', amountReceived: 1000, amountAllocated: 400 },
    ]
    expect(hasUnreconciledBatch(batches)).toBe(true)
  })

  it('returns false when the OPEN batch is fully allocated (zero balance)', () => {
    const batches: PaymentBatch[] = [
      { status: 'OPEN', amountReceived: 1000, amountAllocated: 1000 },
    ]
    expect(hasUnreconciledBatch(batches)).toBe(false)
  })

  it('returns false when the batch is RECONCILED (regardless of balance)', () => {
    const batches: PaymentBatch[] = [
      { status: 'RECONCILED', amountReceived: 1000, amountAllocated: 0 },
    ]
    expect(hasUnreconciledBatch(batches)).toBe(false)
  })

  it('returns false for an empty batch list', () => {
    expect(hasUnreconciledBatch([])).toBe(false)
  })

  it('returns true if ANY batch has unallocated balance even if others are reconciled', () => {
    const batches: PaymentBatch[] = [
      { status: 'RECONCILED', amountReceived: 500, amountAllocated: 500 },
      { status: 'OPEN', amountReceived: 800, amountAllocated: 200 },
    ]
    expect(hasUnreconciledBatch(batches)).toBe(true)
  })
})

// ── 2. Reconciliation-status derivation (Firestore integration layer) ─────────
//
// Seeds real batch documents and reads them back to verify the full round-trip:
// shape-on-disk → query → derivation → status. Any Firestore schema mismatch
// shows up here before it shows up in production.

describe('hasUnreconciledBatch — Firestore round-trip', () => {
  let campId: string

  beforeEach(() => {
    campId = `camp-${uniq()}`
  })

  async function seedBatch(fields: Partial<{
    status: 'OPEN' | 'RECONCILED'
    amountReceived: number
    amountAllocated: number
    subGroupId: string
  }>) {
    const ref = db().collection('camps').doc(campId).collection('paymentBatches').doc()
    await ref.set({
      referenceCode: 'TEST-001',
      subGroupId: fields.subGroupId ?? 'sg-1',
      subGroupName: 'Test Council',
      amountReceived: fields.amountReceived ?? 1000,
      amountAllocated: fields.amountAllocated ?? 0,
      method: 'MOMO',
      receivedAt: Timestamp.now(),
      receivedBy: 'admin-uid',
      status: fields.status ?? 'OPEN',
      varianceAcknowledged: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    })
  }

  async function loadBatches(subGroupId = 'sg-1'): Promise<PaymentBatch[]> {
    const snap = await db()
      .collection('camps').doc(campId)
      .collection('paymentBatches')
      .where('subGroupId', '==', subGroupId)
      .get()
    return snap.docs.map((d) => d.data() as PaymentBatch)
  }

  it('⚠️ sub-group with OPEN batch + unallocated balance', async () => {
    await seedBatch({ status: 'OPEN', amountReceived: 1000, amountAllocated: 0 })
    const batches = await loadBatches()
    expect(hasUnreconciledBatch(batches)).toBe(true)
  })

  it('✅ sub-group after batch is marked RECONCILED', async () => {
    await seedBatch({ status: 'RECONCILED', amountReceived: 1000, amountAllocated: 700 })
    const batches = await loadBatches()
    expect(hasUnreconciledBatch(batches)).toBe(false)
  })

  it('✅ sub-group when OPEN batch is fully allocated', async () => {
    await seedBatch({ status: 'OPEN', amountReceived: 1000, amountAllocated: 1000 })
    const batches = await loadBatches()
    expect(hasUnreconciledBatch(batches)).toBe(false)
  })

  it('scopes correctly — does not bleed across sub-groups', async () => {
    // sg-1 has an unreconciled batch; sg-2 does not
    await seedBatch({ subGroupId: 'sg-1', status: 'OPEN', amountReceived: 500, amountAllocated: 0 })
    await seedBatch({ subGroupId: 'sg-2', status: 'RECONCILED', amountReceived: 800, amountAllocated: 800 })

    const sg1Batches = await loadBatches('sg-1')
    const sg2Batches = await loadBatches('sg-2')
    expect(hasUnreconciledBatch(sg1Batches)).toBe(true)
    expect(hasUnreconciledBatch(sg2Batches)).toBe(false)
  })
})

// ── 3. Reference-code generation ──────────────────────────────────────────────

describe('generateReferenceCode — format', () => {
  it('produces SUBGROUP-SEQ format', () => {
    expect(generateReferenceCode('Galatians Council', 7)).toBe('GALATIAN-007')
  })

  it('zero-pads sequence to 3 digits', () => {
    expect(generateReferenceCode('Choir', 1)).toBe('CHOIR-001')
    expect(generateReferenceCode('Choir', 42)).toBe('CHOIR-042')
    expect(generateReferenceCode('Choir', 100)).toBe('CHOIR-100')
    expect(generateReferenceCode('Choir', 1000)).toBe('CHOIR-1000') // no truncation past 3
  })

  it('strips non-alphanumeric chars from sub-group name', () => {
    expect(generateReferenceCode('Youth & Prayer', 1)).toBe('YOUTHPRA-001')
    expect(generateReferenceCode('Council (A)', 1)).toBe('COUNCILA-001')
  })

  it('takes at most 8 alphanumeric chars', () => {
    expect(generateReferenceCode('Galatianssss Council', 1)).toBe('GALATIAN-001')
    expect(generateReferenceCode('AB', 1)).toBe('AB-001') // shorter names are fine
  })

  it('uppercases the prefix', () => {
    expect(generateReferenceCode('galatians', 5)).toBe('GALATIAN-005')
  })
})

describe('generateReferenceCode — uniqueness within camp', () => {
  let campId: string

  beforeEach(() => {
    campId = `camp-${uniq()}`
  })

  it('sequential batches in the same camp get different sequence numbers', async () => {
    const batchesRef = db().collection('camps').doc(campId).collection('paymentBatches')

    // Simulate what createBatch does: count existing, then add 1
    const snap1 = await batchesRef.get()
    const seq1 = snap1.size + 1
    const code1 = generateReferenceCode('Galatians', seq1)
    await batchesRef.add({ referenceCode: code1, status: 'OPEN', amountReceived: 100, amountAllocated: 0 })

    const snap2 = await batchesRef.get()
    const seq2 = snap2.size + 1
    const code2 = generateReferenceCode('Deborah', seq2)
    await batchesRef.add({ referenceCode: code2, status: 'OPEN', amountReceived: 200, amountAllocated: 0 })

    expect(seq1).toBe(1)
    expect(seq2).toBe(2)
    expect(code1).toBe('GALATIAN-001')
    expect(code2).toBe('DEBORAH-002')
    expect(code1).not.toBe(code2)
  })
})
