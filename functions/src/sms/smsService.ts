import type { Firestore } from 'firebase-admin/firestore'
import { FieldValue } from 'firebase-admin/firestore'
import { normalizeGhanaPhone } from './normalizePhone'
import { sendQuickSms } from './bmsClient'
import { devOverridePhone } from './devOverride'

export type SmsTrigger = 'ROOM_ASSIGNED' | 'ROOM_CHANGED' | string
export type SendSmsOutcome = 'SENT' | 'FAILED' | 'SKIPPED' | 'DUPLICATE'

export interface SendSmsParams {
  db: Firestore
  campId: string
  participantId: string
  phone: string
  trigger: SmsTrigger
  message: string
  triggeredBy: string
  apiKey: string
  senderId: string
  enabled: boolean
  // Deterministic id (e.g. the Firestore trigger event id) that makes this
  // send idempotent — a duplicate delivery of the same event resolves to
  // 'DUPLICATE' before the provider is ever called. Omit for one-off sends
  // (broadcasts, reminders) that don't need dedup against a source event.
  logId?: string
}

// Reusable send-SMS service — every trigger (room assignment today; future
// broadcasts / payment reminders) should call through here rather than the
// provider client directly, so the send log, kill switch, and phone
// normalization stay in one place.
export async function sendSms(params: SendSmsParams): Promise<SendSmsOutcome> {
  const {
    db, campId, participantId, phone, trigger, message, triggeredBy,
    apiKey, senderId, enabled, logId,
  } = params

  const logRef = logId
    ? db.doc(`camps/${campId}/smsLog/${logId}`)
    : db.collection(`camps/${campId}/smsLog`).doc()

  // Idempotency lock: claim the log doc before doing anything else. If this
  // event was already processed (duplicate trigger delivery, retry), the
  // create() below throws ALREADY_EXISTS and we bail out before ever
  // touching the provider — no double sends, no double charges.
  try {
    await logRef.create({
      participantId,
      phone,
      trigger,
      message,
      status: 'PENDING',
      triggeredBy,
      createdAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    const code = (err as { code?: number | string }).code
    if (code === 6 || code === 'already-exists') {
      return 'DUPLICATE'
    }
    throw err
  }

  if (!enabled) {
    await logRef.update({ status: 'SKIPPED', reason: 'SMS disabled for camp (kill switch)' })
    return 'SKIPPED'
  }

  const normalizedPhone = normalizeGhanaPhone(phone)
  if (!normalizedPhone) {
    await logRef.update({ status: 'SKIPPED', reason: 'Missing or invalid phone number' })
    return 'SKIPPED'
  }

  // Emulator-only redirect (see devOverride.ts) — the participant's own
  // number is still what gets validated and logged as `phone`; only the
  // actual provider destination changes, and only under FUNCTIONS_EMULATOR.
  const override = devOverridePhone()
  const recipient = override ?? normalizedPhone

  const result = await sendQuickSms({ apiKey, sender: senderId, recipient, message })
  const creditFields = result.creditLeft !== undefined ? { creditLeft: result.creditLeft } : {}
  const devRedirectFields = override
    ? { devRedirected: true, devRedirectedFrom: normalizedPhone }
    : {}

  if (result.ok) {
    await logRef.update({
      status: 'SENT',
      normalizedPhone: recipient,
      providerResponse: result.raw ?? null,
      ...creditFields,
      ...devRedirectFields,
    })
    return 'SENT'
  }

  await logRef.update({
    status: 'FAILED',
    normalizedPhone: recipient,
    providerError: result.errorMessage ?? 'Unknown provider error',
    providerResponse: result.raw ?? null,
    ...creditFields,
    ...devRedirectFields,
  })
  return 'FAILED'
}
