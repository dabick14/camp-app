import type { Timestamp } from 'firebase/firestore'
import type { StoredImage } from '@/lib/imageUpload'

export type TicketStatus = 'OPEN' | 'REPORTED' | 'FIXED_PENDING_CHECK' | 'CLOSED'

/** A single attached photo (the issue itself, or proof-of-fix) for a ticket. */
export type TicketImage = StoredImage

export interface TicketStatusEvent {
  status: TicketStatus
  at: Timestamp
  by: string
}

export interface TicketNote {
  text: string
  at: Timestamp
  by: string
}

export interface Ticket {
  id: string
  roomId: string
  roomNumber: string // denormalized
  roomTypeName: string // denormalized
  title: string
  description: string
  status: TicketStatus
  statusHistory: TicketStatusEvent[]
  notes: TicketNote[]
  imageUrls?: TicketImage[]
  createdAt: Timestamp
  createdBy: string
  updatedAt: Timestamp
  updatedBy: string
}

// "What still needs attention" first, closed last.
const STATUS_ORDER: Record<TicketStatus, number> = {
  OPEN: 0,
  REPORTED: 1,
  FIXED_PENDING_CHECK: 2,
  CLOSED: 3,
}

export function sortTickets(tickets: Ticket[]): Ticket[] {
  return [...tickets].sort((a, b) => {
    const orderDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    if (orderDiff !== 0) return orderDiff
    return b.createdAt.toMillis() - a.createdAt.toMillis()
  })
}

/**
 * Valid transitions from each status: Open → Reported → Fixed-pending-check →
 * Closed, plus reopening a "fixed" issue that turns out not fixed
 * (Fixed-pending-check or Closed → back to Open).
 */
export const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['REPORTED'],
  REPORTED: ['FIXED_PENDING_CHECK'],
  FIXED_PENDING_CHECK: ['CLOSED', 'OPEN'],
  CLOSED: ['OPEN'],
}
