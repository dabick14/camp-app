import type { Timestamp } from 'firebase/firestore'

export type SmsTrigger = 'ROOM_ASSIGNED' | 'ROOM_CHANGED' | string
export type SmsStatus = 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED'

export interface SmsLogEntry {
  id: string
  participantId: string
  phone: string
  normalizedPhone?: string
  message: string
  trigger: SmsTrigger
  status: SmsStatus
  reason?: string
  providerResponse?: unknown
  providerError?: string
  creditLeft?: number
  triggeredBy: string
  devRedirected?: boolean
  devRedirectedFrom?: string
  createdAt: Timestamp
}
