import type { Timestamp } from 'firebase/firestore'

export interface Participant {
  id: string
  fullName: string
  phone: string
  email?: string
  gender: 'M' | 'F'
  dateOfBirth?: Timestamp
  age?: number
  subGroupId: string
  subGroupName: string
  roomTypePreferenceId: string
  roomTypePreferenceName: string
  feeOwed: number
  registrationState: 'REGISTERED' | 'CANCELLED'
  checkInState: 'NOT_ARRIVED' | 'ARRIVED'
  roomId?: string | null
  roomNumber?: string
  roomAssignedBy?: string
  roomAssignedAt?: Timestamp
  amountPaid: number
  // Claim layer: leader asserts "this person paid me". Does NOT affect
  // amountPaid or paymentState — admin confirmation (5b-ii) does that.
  paymentClaimed?: boolean
  claimedBy?: string
  claimedAt?: Timestamp
  // Confirmation layer (5b-ii): admin reconciled the sub-group's lump against
  // claimed participants and confirmed this one — sets amountPaid = feeOwed.
  // Presence of confirmedBatchId locks this participant to that batch;
  // un-confirming is out of scope for v1 (see PAYMENTS_SPEC.md).
  confirmedAt?: Timestamp
  confirmedBy?: string
  confirmedBatchId?: string
  roomedWithoutFullPayment?: boolean
  roomedWithoutFullPaymentNote?: string
  checkedInBy?: string
  checkedInAt?: Timestamp
  source?: 'self' | string
  tags: string[]
  feeWaiverNote?: string
  notes?: string
  createdAt: Timestamp
  updatedAt: Timestamp
  updatedBy?: string
}

export type PaymentState = 'PAID' | 'PARTIAL' | 'PENDING' | 'WAIVED'

export function derivePaymentState(p: Participant): PaymentState {
  if (p.feeOwed === 0) return 'WAIVED'
  if (p.amountPaid >= p.feeOwed) return 'PAID'
  if (p.amountPaid > 0) return 'PARTIAL'
  return 'PENDING'
}
