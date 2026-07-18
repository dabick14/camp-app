// BMS Africa's (mnotify) /sms/quick endpoint expects Ghana local format —
// e.g. "0241234567" — per its actual request examples, not "+233..." or
// "233..." (those forms only appear in mnotify's read-side / report
// responses). Participants are stored as "+233XXXXXXXXX"; this normalizes
// whatever format is on file to what the provider accepts on send.
export function normalizeGhanaPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')

  let local: string
  if (digits.length === 10 && digits.startsWith('0')) {
    local = digits
  } else if (digits.length === 12 && digits.startsWith('233')) {
    local = `0${digits.slice(3)}`
  } else if (digits.length === 9) {
    local = `0${digits}`
  } else {
    return null
  }

  return /^0\d{9}$/.test(local) ? local : null
}
