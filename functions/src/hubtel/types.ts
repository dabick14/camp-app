import type { Timestamp } from 'firebase-admin/firestore'
import type { NormalizedStatus } from './helpers'

/**
 * Hubtel Online Checkout callback payload (PascalCase per Hubtel docs; camelCase tolerated).
 * See HUBTEL_SPEC.md for the full contract.
 */
export interface HubtelCallbackPayload {
  ResponseCode?: string
  Status?: string
  Data?: HubtelCallbackData
  [k: string]: unknown
}

export interface HubtelCallbackData {
  CheckoutId?: string
  SalesInvoiceId?: string
  ClientReference?: string
  Status?: string
  Amount?: number
  CustomerPhoneNumber?: string
  PaymentDetails?: {
    MobileMoneyNumber?: string
    PaymentType?: string
    Channel?: string
  }
  Description?: string
  [k: string]: unknown
}

/** Normalized result of parsing a Hubtel callback. */
export interface ParsedCallback {
  reference: string
  checkoutId?: string
  amountGHS: number
  status: NormalizedStatus
  rawStatus: string
  senderPhone?: string
  channel?: string // e.g. "mobilemoney"
  channelProvider?: string // e.g. "mtn-gh"
  description?: string
}

/** Normalized result of a Transaction Status Check. */
export interface HubtelVerifyResult {
  reference: string
  transactionId?: string
  status: NormalizedStatus
  rawStatus: string
  amountGHS: number
  currency: string
  channel?: string
  charges?: number
  paidAt?: Date
}

export type HubtelTransactionStatus =
  | 'PENDING'
  | 'MATCHED'
  | 'FAILED'
  | 'QUARANTINED'
  | 'REFUNDED'

/** Session + audit doc at camps/{campId}/hubtelTransactions/{reference}. */
export interface HubtelTransactionDoc {
  reference: string
  checkoutId?: string
  checkoutUrl?: string
  amount: number // actual amount received (GHS); 0 until confirmed
  amountExpected: number // amount the admin requested at init (GHS)
  senderPhone?: string
  description?: string
  subGroupId: string
  subGroupName: string
  status: HubtelTransactionStatus
  batchId?: string
  channel?: string
  channelProvider?: string
  receivedAt?: Timestamp
  rawPayload?: unknown
  createdBy?: string
  createdAt: Timestamp
  updatedAt: Timestamp
  matchedAt?: Timestamp
  matchedBy?: string // 'auto' for webhook, admin uid for verify/manual
}
