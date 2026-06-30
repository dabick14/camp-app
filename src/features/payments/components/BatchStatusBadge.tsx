import { Badge } from '@/components/ui/badge'
import type { BatchStatus } from '../types'

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  if (status === 'RECONCILED') {
    return (
      <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700">
        Reconciled
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
      Open
    </Badge>
  )
}
