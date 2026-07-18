// Rough GSM-7 vs UCS-2 segment counter for template-editing UI. Good enough
// for cost-visibility — not a byte-exact PDU encoder.
const GSM_7BIT_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1BÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
const GSM_7BIT_EXT = '^{}\\[~]|€'

function isGsm7(text: string): boolean {
  return [...text].every((c) => GSM_7BIT_BASIC.includes(c) || GSM_7BIT_EXT.includes(c))
}

export interface SmsSegmentInfo {
  length: number
  segments: number
  encoding: 'GSM-7' | 'UCS-2'
}

export function countSmsSegments(text: string): SmsSegmentInfo {
  const gsm7 = isGsm7(text)
  const length = gsm7
    ? [...text].reduce((n, c) => n + (GSM_7BIT_EXT.includes(c) ? 2 : 1), 0)
    : text.length

  const singleLimit = gsm7 ? 160 : 70
  const multiLimit = gsm7 ? 153 : 67
  const segments = length === 0 ? 1 : length <= singleLimit ? 1 : Math.ceil(length / multiLimit)

  return { length, segments, encoding: gsm7 ? 'GSM-7' : 'UCS-2' }
}
