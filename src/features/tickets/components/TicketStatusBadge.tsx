import { Badge } from '@/components/ui/badge'
import type { TicketStatus } from '../types'

const LABEL: Record<TicketStatus, string> = {
  OPEN: 'Open',
  REPORTED: 'Reported',
  FIXED_PENDING_CHECK: 'Fixed — pending check',
  CLOSED: 'Closed',
}

// Open/Fixed-pending-check share the amber family (both "needs attention"
// or "verify me") but use the two distinct amber tokens so they still read
// apart at a glance; Reported gets the neutral/blue "in progress" tone.
const VARIANT: Record<TicketStatus, 'pending' | 'info' | 'partial' | 'paid'> = {
  OPEN: 'pending',
  REPORTED: 'info',
  FIXED_PENDING_CHECK: 'partial',
  CLOSED: 'paid',
}

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return <Badge variant={VARIANT[status]}>{LABEL[status]}</Badge>
}
