import { mapHubtelStatus } from './helpers'
import { normalizePhone } from './normalizePhone'
import type { HubtelCallbackPayload, ParsedCallback } from './types'

/**
 * Parse + normalize a Hubtel checkout callback into our internal shape.
 * Returns null if the payload has no Data block or no client reference
 * (nothing we can act on). Pure — no Firebase, no network.
 */
export function parseCallback(payload: HubtelCallbackPayload): ParsedCallback | null {
  const data = (payload?.Data || (payload as Record<string, any>)?.data) as
    | Record<string, any>
    | undefined
  if (!data) return null

  const reference = data.ClientReference || data.clientReference
  if (!reference) return null

  const rawStatus = data.Status || data.status || payload.Status || ''
  const amountRaw = data.Amount ?? data.amount ?? 0
  const amount = Number(amountRaw)
  const pd = data.PaymentDetails || data.paymentDetails || {}

  return {
    reference: String(reference),
    checkoutId: data.CheckoutId || data.checkoutId || data.SalesInvoiceId,
    amountGHS: Number.isFinite(amount) ? amount : 0,
    status: mapHubtelStatus(String(rawStatus)),
    rawStatus: String(rawStatus),
    senderPhone: normalizePhone(
      data.CustomerPhoneNumber ||
        data.customerPhoneNumber ||
        pd.MobileMoneyNumber ||
        pd.mobileMoneyNumber,
    ),
    channel: pd.PaymentType || pd.paymentType,
    channelProvider: pd.Channel || pd.channel,
    description: data.Description || data.description,
  }
}
