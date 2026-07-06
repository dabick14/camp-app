import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { formatMoney } from '@/lib/formatMoney'

type Step = 'warn' | 'reason'

export function OverridePaymentModal({
  participantName,
  balanceDue,
  currency,
  onCancel,
  onProceed,
}: {
  participantName: string
  balanceDue: number
  currency: string
  onCancel: () => void
  onProceed: (reason: string) => void
}) {
  const [step, setStep] = useState<Step>('warn')
  const [reason, setReason] = useState('')

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent showCloseButton={false}>
        {step === 'warn' ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
                Outstanding balance
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-1 text-sm">
              <p>
                <span className="font-medium">{participantName}</span> has an outstanding balance
                of{' '}
                <span className="font-semibold text-destructive">
                  {formatMoney(balanceDue, currency)}
                </span>
                .
              </p>
              <p className="text-muted-foreground">
                Assigning a room without full payment requires a reason on record.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button onClick={() => setStep('reason')}>
                Continue
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Reason for override</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-1">
              <p className="text-sm text-muted-foreground">
                Provide a reason. This is recorded alongside the assignment for audit.
              </p>
              <Textarea
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Council coordinator confirmed cash on hand, Sponsorship being processed"
                rows={3}
                className="text-sm"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('warn')}>
                Back
              </Button>
              <Button
                onClick={() => onProceed(reason.trim())}
                disabled={reason.trim().length < 3}
              >
                Proceed to room selection
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
