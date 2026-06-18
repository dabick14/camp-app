import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatMoney } from '@/lib/formatMoney'
import type { SubGroup } from '@/features/camps/types'
import { initiateCheckout, verifyPayment } from '../services/hubtelService'

interface HubtelCheckoutModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  campId: string
  subGroups: SubGroup[]
  currency: string
  onConfirmed: () => void
}

type Step = 'form' | 'paying' | 'success' | 'failed' | 'processing'

const POLL_INTERVAL_MS = 4000
const MAX_ATTEMPTS = 20 // ~80s active window; the webhook is the prod source of truth

export function HubtelCheckoutModal({
  open,
  onOpenChange,
  campId,
  subGroups,
  currency,
  onConfirmed,
}: HubtelCheckoutModalProps) {
  const [step, setStep] = useState<Step>('form')
  const [subGroupId, setSubGroupId] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [reference, setReference] = useState('')
  const [checkoutUrl, setCheckoutUrl] = useState('')
  const [detail, setDetail] = useState('')

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptRef = useRef(0)

  const reset = useCallback(() => {
    setStep('form')
    setSubGroupId('')
    setAmount('')
    setDescription('')
    setError('')
    setSubmitting(false)
    setReference('')
    setCheckoutUrl('')
    setDetail('')
    attemptRef.current = 0
    if (pollTimer.current) clearTimeout(pollTimer.current)
  }, [])

  // Reset whenever the dialog is (re)opened.
  useEffect(() => {
    if (open) reset()
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current)
    }
  }, [open, reset])

  const poll = useCallback(
    async (ref: string) => {
      try {
        const result = await verifyPayment(campId, ref)
        if (result.status === 'SUCCESS') {
          setStep('success')
          setDetail(
            result.amountGHS != null
              ? `${formatMoney(result.amountGHS, currency)} received and a payment batch was created.`
              : 'Payment received and a batch was created.',
          )
          onConfirmed()
          return
        }
        if (result.status === 'FAILED') {
          setStep('failed')
          setDetail(result.message || 'The payment failed. You can try again.')
          return
        }
        // PENDING / ABANDONED — keep polling until the window is exhausted.
        attemptRef.current += 1
        if (attemptRef.current >= MAX_ATTEMPTS) {
          setStep('processing')
          setDetail(
            'Still confirming. If the payment went through it will appear in the transactions list automatically.',
          )
          return
        }
        pollTimer.current = setTimeout(() => poll(ref), POLL_INTERVAL_MS)
      } catch {
        attemptRef.current += 1
        if (attemptRef.current >= MAX_ATTEMPTS) {
          setStep('processing')
          setDetail('Could not confirm yet. Check the transactions list shortly.')
          return
        }
        pollTimer.current = setTimeout(() => poll(ref), POLL_INTERVAL_MS)
      }
    },
    [campId, currency, onConfirmed],
  )

  async function handleStart(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const amt = Number(amount)
    if (!subGroupId) {
      setError('Select a sub-group.')
      return
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Enter a valid amount greater than zero.')
      return
    }
    setSubmitting(true)
    try {
      const result = await initiateCheckout({
        campId,
        subGroupId,
        amountGHS: amt,
        description: description.trim() || undefined,
        returnOrigin: window.location.origin,
      })
      setReference(result.reference)
      // Prefer the onsite "direct" URL for embedding; fall back to the hosted page.
      setCheckoutUrl(result.checkoutDirectUrl || result.checkoutUrl)
      setStep('paying')
      attemptRef.current = 0
      pollTimer.current = setTimeout(() => poll(result.reference), POLL_INTERVAL_MS)
    } catch (err) {
      setError((err as Error).message || 'Failed to start checkout.')
    } finally {
      setSubmitting(false)
    }
  }

  function checkNow() {
    if (reference) poll(reference)
  }

  const selectedSub = subGroups.find((s) => s.id === subGroupId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={step === 'paying' ? 'max-w-2xl' : 'max-w-md'}>
        <DialogHeader>
          <DialogTitle>Hubtel payment</DialogTitle>
        </DialogHeader>

        {step === 'form' && (
          <form onSubmit={handleStart} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>Sub-group / Council</Label>
              <Select value={subGroupId} onValueChange={setSubGroupId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a sub-group…" />
                </SelectTrigger>
                <SelectContent>
                  {subGroups.map((sg) => (
                    <SelectItem key={sg.id} value={sg.id}>
                      {sg.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="hubtel-amount">Amount ({currency})</Label>
              <Input
                id="hubtel-amount"
                type="number"
                min={0.01}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 5000"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="hubtel-desc">Description (optional)</Label>
              <Input
                id="hubtel-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={selectedSub ? `Camp payment - ${selectedSub.name}` : 'Camp payment'}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Starting…' : 'Continue to payment'}
              </Button>
            </div>
          </form>
        )}

        {step === 'paying' && (
          <div className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground">
              Complete the payment below. This window will update automatically once Hubtel
              confirms it.
            </p>
            {checkoutUrl ? (
              <iframe
                title="Hubtel checkout"
                src={checkoutUrl}
                className="h-[560px] w-full rounded-md border"
              />
            ) : null}
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for confirmation…
              </span>
              <Button type="button" variant="outline" size="sm" onClick={checkNow}>
                I&apos;ve paid — check now
              </Button>
            </div>
          </div>
        )}

        {(step === 'success' || step === 'failed' || step === 'processing') && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            {step === 'success' && <CheckCircle2 className="h-10 w-10 text-emerald-600" />}
            {step === 'failed' && <XCircle className="h-10 w-10 text-destructive" />}
            {step === 'processing' && <Clock className="h-10 w-10 text-amber-600" />}
            <div>
              <p className="font-medium">
                {step === 'success'
                  ? 'Payment confirmed'
                  : step === 'failed'
                    ? 'Payment failed'
                    : 'Still processing'}
              </p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">{detail}</p>
            </div>
            <div className="flex gap-2">
              {step === 'failed' && (
                <Button variant="outline" onClick={reset}>
                  Try again
                </Button>
              )}
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
