import { Badge } from '@/components/ui/badge'
import type { BatchStatus } from '../types'

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  if (status === 'RECONCILED') {
    return (
      <Badge className="border-transparent bg-status-paid-bg text-status-paid">
        Reconciled
      </Badge>
    )
  }
  return (
    <Badge className="border-transparent bg-status-partial-bg text-status-partial">
      Open
    </Badge>
  )
}
