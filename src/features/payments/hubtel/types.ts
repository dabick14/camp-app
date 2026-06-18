import type { Timestamp } from 'firebase/firestore'

export type HubtelTransactionStatus =
  | 'PENDING'
  | 'MATCHED'
  | 'FAILED'
  | 'QUARANTINED'
  | 'REFUNDED'

/** A Hubtel checkout session + audit row (camps/{campId}/hubtelTransactions/{reference}). */
export interface HubtelTransaction {
  id: string
  reference: string
  checkoutId?: string
  checkoutUrl?: string
  amount: number
  amountExpected: number
  senderPhone?: string
  description?: string
  subGroupId: string
  subGroupName: string
  status: HubtelTransactionStatus
  batchId?: string
  channel?: string
  channelProvider?: string
  receivedAt?: Timestamp
  createdAt?: Timestamp
  matchedAt?: Timestamp
  matchedBy?: string
}

/** An orphan callback awaiting admin assignment (top-level hubtelQuarantine/{id}). */
export interface QuarantineItem {
  id: string
  reference: string
  checkoutId?: string | null
  amount: number
  senderPhone?: string | null
  channel?: string | null
  channelProvider?: string | null
  status: string
  batchId?: string
  campId?: string
  receivedAt?: Timestamp
  createdAt?: Timestamp
}

export interface InitiateCheckoutResult {
  reference: string
  checkoutId: string
  checkoutUrl: string
  checkoutDirectUrl?: string
}

export type VerifyStatus = 'SUCCESS' | 'FAILED' | 'PENDING' | 'ABANDONED'

export interface VerifyResult {
  status: VerifyStatus
  amountGHS?: number
  batchId?: string
  message?: string
}
