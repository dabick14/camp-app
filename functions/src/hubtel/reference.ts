import { randomBytes } from 'crypto'

/**
 * Generate a unique Hubtel clientReference. Hubtel caps clientReference at 32 chars.
 * Format: PREFIX_<base36 timestamp>_<8 hex> — ~24 chars, well under the limit.
 */
export function generateReference(prefix = 'CAMP'): string {
  const ts = Date.now().toString(36)
  const rand = randomBytes(4).toString('hex')
  return `${prefix}_${ts}_${rand}`.toUpperCase().slice(0, 32)
}
