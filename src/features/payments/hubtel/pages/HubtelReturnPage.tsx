import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { verifyPayment } from '../services/hubtelService'

/**
 * Fallback landing for Hubtel's post-checkout redirect (returnUrl).
 * The primary confirmation path is the in-app checkout modal's poll + the webhook;
 * this page handles the case where Hubtel performs a full-page redirect instead.
 *
 * Verification requires an admin token. The admin who started the checkout is logged
 * in in this same browser, so we wait for auth to resolve, then poll verify.
 */
type Phase = 'verifying' | 'success' | 'failed' | 'processing'

const POLL_INTERVAL_MS = 3000
const MAX_ATTEMPTS = 8

export function HubtelReturnPage() {
  const [phase, setPhase] = useState<Phase>('verifying')
  const [detail, setDetail] = useState('Confirming your payment…')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const params = new URLSearchParams(window.location.search)
    const reference = params.get('reference') || ''
    const campId = params.get('campId') || ''

    if (!reference || !campId) {
      setPhase('failed')
      setDetail('Missing payment reference.')
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0

    const poll = async () => {
      if (cancelled) return
      try {
        const result = await verifyPayment(campId, reference)
        if (cancelled) return
        if (result.status === 'SUCCESS') {
          setPhase('success')
          setDetail('Payment confirmed. A payment batch has been created.')
          return
        }
        if (result.status === 'FAILED') {
          setPhase('failed')
          setDetail(result.message || 'Payment failed. Please try again.')
          return
        }
        attempt += 1
        if (attempt >= MAX_ATTEMPTS) {
          setPhase('processing')
          setDetail(
            'Still confirming. The payment will appear in the Hubtel transactions list automatically.',
          )
          return
        }
        timer = setTimeout(poll, POLL_INTERVAL_MS)
      } catch {
        if (cancelled) return
        attempt += 1
        if (attempt >= MAX_ATTEMPTS) {
          setPhase('processing')
          setDetail('Could not confirm yet. Check the Hubtel transactions list shortly.')
          return
        }
        timer = setTimeout(poll, POLL_INTERVAL_MS)
      }
    }

    // Wait for auth to resolve so verify has an admin token.
    const unsub = onAuthStateChanged(auth, (user) => {
      if (cancelled) return
      if (user) {
        poll()
      } else {
        setPhase('processing')
        setDetail(
          'Sign in as an admin to confirm this payment, or check the transactions list.',
        )
      }
    })

    return () => {
      cancelled = true
      unsub()
      if (timer) clearTimeout(timer)
    }
  }, [])

  const Icon =
    phase === 'success'
      ? CheckCircle2
      : phase === 'failed'
        ? XCircle
        : phase === 'processing'
          ? Clock
          : Loader2

  const iconClass =
    phase === 'success'
      ? 'text-emerald-600'
      : phase === 'failed'
        ? 'text-destructive'
        : phase === 'processing'
          ? 'text-amber-600'
          : 'text-primary animate-spin'

  const heading =
    phase === 'success'
      ? 'Payment confirmed'
      : phase === 'failed'
        ? 'Payment failed'
        : phase === 'processing'
          ? 'Still processing'
          : 'Finalizing your payment…'

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <Icon className={`h-9 w-9 ${iconClass}`} strokeWidth={1.75} />
      <div>
        <p className="text-base font-medium text-foreground">{heading}</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}
