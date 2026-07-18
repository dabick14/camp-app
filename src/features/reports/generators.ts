import { formatMoney } from '@/lib/formatMoney'

/**
 * WhatsApp-friendly text reports — pure data-in, string-out formatters.
 * No fetching, no state: callers pass in numbers the screens already
 * compute (PaymentsPage's summary, Dashboard's bySubGroup) so the report
 * always matches what's on screen. Adding a third report later means
 * adding one more function here, not touching the UI components.
 *
 * WhatsApp's markdown uses single asterisks for bold (*text*), not
 * markdown's double-asterisk — get this wrong and it pastes as literal
 * asterisks instead of bold.
 */

export interface SubGroupPaymentRow {
  name: string
  /** Total cash received from this sub-group so far (across all batches) — determines which section it lands in. */
  cashReceived: number
  /** feeOwed total minus confirmed amountPaid total — what's still expected. */
  outstanding: number
}

/** Report 1 — outstanding payments expected, split by whether any cash has come in yet. */
export function generatePaymentsExpectedReport(
  campName: string,
  currency: string,
  rows: SubGroupPaymentRow[],
): string {
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name))
  const noPayments = sorted.filter((r) => r.cashReceived === 0)
  // Includes GHS 0 outstanding rows on purpose — "some cash received" is the
  // split, not "still owes something." A fully-paid sub-group belongs here.
  const partialOrFull = sorted.filter((r) => r.cashReceived > 0)

  const lines: string[] = [
    `*${campName} Registrations*`,
    'These are the payments expected.',
  ]

  if (noPayments.length > 0) {
    lines.push('', '*No Payments*')
    noPayments.forEach((r, i) => lines.push(`${i + 1}. ${r.name} - ${formatMoney(r.outstanding, currency)}`))
  }

  if (partialOrFull.length > 0) {
    lines.push('', '*Partial & Full Payments*')
    partialOrFull.forEach((r, i) => lines.push(`${i + 1}. ${r.name} - ${formatMoney(r.outstanding, currency)}`))
  }

  return lines.join('\n')
}

export interface SubGroupRegistrationRow {
  name: string
  registered: number
}

/** Report 2 — registered-participant counts per sub-group, with a total line. */
export function generateRegistrationCountsReport(
  campName: string,
  rows: SubGroupRegistrationRow[],
): string {
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name))
  const total = sorted.reduce((sum, r) => sum + r.registered, 0)

  const lines: string[] = [
    `*${campName} Registrations*`,
    'These are the number of leavers registered for the camp.',
    ...sorted.map((r, i) => `${i + 1}. ${r.name} - ${r.registered}`),
    `*Total - ${total}*`,
  ]

  return lines.join('\n')
}
