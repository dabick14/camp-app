/**
 * Hubtel Online Checkout API client (outbound calls only).
 * Ported from the proven implementation in the bms.codeslaw repo.
 *
 * Auth: HTTP Basic, base64("<ACCOUNT_ID>:<API_KEY>").
 * Status checks use the PUBLIC rmsc.hubtel.com endpoint (no IP whitelisting required).
 */
import { defineSecret } from 'firebase-functions/params'
import { lowerKeys, mapHubtelStatus, stripQuotes } from './helpers'
import type { HubtelVerifyResult } from './types'

export const HUBTEL_API_KEY = defineSecret('HUBTEL_API_KEY')
export const HUBTEL_ACCOUNT_ID = defineSecret('HUBTEL_ACCOUNT_ID')
export const HUBTEL_MERCHANT_ACCOUNT_NUMBER = defineSecret(
  'HUBTEL_MERCHANT_ACCOUNT_NUMBER',
)

/** Bind this on any function that makes outbound Hubtel calls. */
export const HUBTEL_SECRETS = [
  HUBTEL_API_KEY,
  HUBTEL_ACCOUNT_ID,
  HUBTEL_MERCHANT_ACCOUNT_NUMBER,
]

const CHECKOUT_URL = 'https://payproxyapi.hubtel.com/items/initiate'
const STATUS_BASE = 'https://rmsc.hubtel.com/v1/merchantaccount/merchants'

function creds() {
  return {
    apiKey: stripQuotes(HUBTEL_API_KEY.value() || ''),
    accountId: stripQuotes(HUBTEL_ACCOUNT_ID.value() || ''),
    merchant: stripQuotes(HUBTEL_MERCHANT_ACCOUNT_NUMBER.value() || ''),
  }
}

export function isHubtelConfigured(): boolean {
  const c = creds()
  return !!(c.apiKey && c.accountId && c.merchant)
}

function authHeaders(): Record<string, string> {
  const c = creds()
  const auth = Buffer.from(`${c.accountId}:${c.apiKey}`).toString('base64')
  return { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }
}

export interface InitiateArgs {
  amountGHS: number
  description: string
  reference: string
  callbackUrl: string
  returnUrl: string
  cancellationUrl?: string
  payeeName?: string
  payeeEmail?: string
  payeeMobileNumber?: string
}

export interface InitiateResult {
  checkoutId: string
  checkoutUrl: string
  checkoutDirectUrl?: string
  clientReference: string
}

/** POST /items/initiate — create a checkout and return the payable URLs. */
export async function initiateCheckout(
  args: InitiateArgs,
): Promise<InitiateResult> {
  if (!isHubtelConfigured()) {
    throw new Error('Hubtel is not configured (missing API key/account/merchant)')
  }
  const c = creds()
  const payload: Record<string, unknown> = {
    totalAmount: Number(args.amountGHS.toFixed(2)), // 2 decimals only, per docs
    description: args.description,
    callbackUrl: args.callbackUrl,
    returnUrl: args.returnUrl,
    merchantAccountNumber: c.merchant,
    cancellationUrl: args.cancellationUrl || args.returnUrl,
    clientReference: args.reference,
  }
  if (args.payeeName) payload.payeeName = args.payeeName
  if (args.payeeEmail) payload.payeeEmail = args.payeeEmail
  if (args.payeeMobileNumber) payload.payeeMobileNumber = args.payeeMobileNumber

  const res = await fetch(CHECKOUT_URL, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!text) throw new Error('Hubtel returned an empty response')

  let result: any
  try {
    result = JSON.parse(text)
  } catch {
    throw new Error(`Hubtel returned an invalid response (HTTP ${res.status})`)
  }

  if (result.responseCode !== '0000' || result.status !== 'Success') {
    throw new Error(
      result.message ||
        result.data?.message ||
        'Failed to initialize Hubtel checkout',
    )
  }

  const data = result.data
  return {
    checkoutId: data.checkoutId,
    checkoutUrl: data.checkoutUrl,
    checkoutDirectUrl: data.checkoutDirectUrl,
    clientReference: data.clientReference,
  }
}

/**
 * GET status by clientReference — authoritative source of truth.
 * Uses the public rmsc.hubtel.com endpoint (no IP whitelisting).
 */
export async function verifyStatus(reference: string): Promise<HubtelVerifyResult> {
  if (!isHubtelConfigured()) {
    throw new Error('Hubtel is not configured (missing API key/account/merchant)')
  }
  const c = creds()
  const url = `${STATUS_BASE}/${c.merchant}/transactions/status?clientReference=${encodeURIComponent(reference)}`

  const res = await fetch(url, { method: 'GET', headers: authHeaders() })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Hubtel status check failed: ${res.status} ${errText.slice(0, 200)}`)
  }

  const text = await res.text()
  let result: any = {}
  try {
    result = text ? JSON.parse(text) : {}
  } catch {
    // leave result empty — handled below
  }

  // Tolerate camelCase vs PascalCase and the txn living under data/Data or at the top.
  const root = lowerKeys(result)
  const data = lowerKeys(root.data ?? result)
  const rawStatus: string | undefined = data.status

  if (!rawStatus) {
    return { reference, status: 'PENDING', rawStatus: '', amountGHS: 0, currency: 'GHS' }
  }

  const amount = Number(data.amount) || 0
  return {
    reference: data.clientreference || reference,
    transactionId: data.transactionid,
    status: mapHubtelStatus(rawStatus),
    rawStatus: String(rawStatus),
    amountGHS: amount,
    currency: data.currencycode || 'GHS',
    channel: data.paymentmethod,
    charges: data.charges == null ? undefined : Number(data.charges),
    paidAt: data.date ? new Date(data.date) : undefined,
  }
}
