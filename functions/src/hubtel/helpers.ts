/**
 * Small shared helpers for the Hubtel integration.
 * Kept pure (no Firebase, no network) so they are trivially unit-testable.
 */

/** Strip surrounding quotes that sometimes sneak into env/secret values. */
export function stripQuotes(s: string): string {
  return s.replace(/^["']|["']$/g, '')
}

/**
 * Shallow-lowercase an object's top-level keys so we can read fields regardless of
 * the casing Hubtel returns. The api-txnstatus endpoint returns camelCase
 * (responseCode, data.status) while the callback and the rmsc.hubtel.com status
 * endpoint return PascalCase (ResponseCode, Data.Status). Reading one casing against
 * the other leaves every field undefined — this guards against that.
 */
export function lowerKeys(obj: unknown): Record<string, any> {
  if (!obj || typeof obj !== 'object') return {}
  const out: Record<string, any> = {}
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    out[key.toLowerCase()] = (obj as Record<string, unknown>)[key]
  }
  return out
}

export type NormalizedStatus = 'SUCCESS' | 'FAILED' | 'PENDING' | 'ABANDONED'

/**
 * Map any Hubtel status string to our normalized status.
 * Callback status: "Success"; Status-check status: "Paid" | "Unpaid" | "Refunded".
 */
export function mapHubtelStatus(status: string): NormalizedStatus {
  const s = (status || '').toLowerCase()
  if (['success', 'successful', 'paid', 'completed'].includes(s)) return 'SUCCESS'
  if (['failed', 'failure', 'declined', 'error', 'refunded'].includes(s)) return 'FAILED'
  if (['cancelled', 'canceled', 'abandoned', 'expired'].includes(s)) return 'ABANDONED'
  return 'PENDING'
}
