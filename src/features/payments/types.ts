import type { Timestamp } from 'firebase/firestore'

export type PaymentMethod = 'MOMO' | 'CASH' | 'BANK' | 'OTHER'

export interface Allocation {
  id: string
  batchId: string
  batchReferenceCode: string  // denormalized for cheap reads in participant drawer
  participantId: string
  participantName: string
  amount: number
  createdAt: Timestamp
  createdBy: string
  voided: boolean
  voidedBy?: string
  voidedAt?: Timestamp
  voidReason?: string
}
export type BatchStatus = 'OPEN' | 'RECONCILED'

export interface PaymentBatch {
  id: string
  referenceCode: string
  subGroupId: string
  subGroupName: string
  amountReceived: number
  amountAllocated: number
  method: PaymentMethod
  externalReference?: string
  receivedAt: Timestamp
  receivedBy: string
  notes?: string
  status: BatchStatus
  varianceAcknowledged: boolean
  createdAt: Timestamp
  updatedAt: Timestamp
}

/** A single row passed to createAllocations (parsed from the CSV). */
export interface AllocationRow {
  participantId: string
  participantName: string
  amount: number
}

/** ⚠️ if a sub-group has any OPEN batch with unallocated balance */
export function hasUnreconciledBatch(batches: PaymentBatch[]): boolean {
  return batches.some(
    (b) => b.status === 'OPEN' && b.amountReceived - b.amountAllocated > 0,
  )
}

/**
 * Derives the reference-code prefix from a sub-group name.
 * Strips non-alphanumeric chars, uppercases, takes first 8 chars.
 * E.g. "Galatians Council" → "GALATIAN"
 */
export function referenceCodePrefix(subGroupName: string): string {
  return subGroupName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8)
}

/**
 * Generates a full reference code.
 * seq is the 1-based sequence number across all batches in the camp.
 * E.g. referenceCode("Galatians Council", 7) → "GALATIAN-007"
 */
export function generateReferenceCode(subGroupName: string, seq: number): string {
  return `${referenceCodePrefix(subGroupName)}-${String(seq).padStart(3, '0')}`
}
