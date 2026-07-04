import { useEffect, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { Link } from 'react-router-dom'
import { BookOpen, CheckSquare, ClipboardList, Square, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { db, functions } from '@/lib/firebase'
import { formatMoney } from '@/lib/formatMoney'
import { LogoutButton } from '@/features/auth/LogoutButton'
import { useUserRole } from '@/features/auth/UserRoleContext'
import type { Participant } from '@/features/participants/types'
import { getCamp } from '@/features/camps/services/campService'
import type { Camp } from '@/features/camps/types'

interface SetPaymentClaimResult {
  participantId: string
  claimed: boolean
}

const setPaymentClaimFn = httpsCallable<
  { participantId: string; claimed: boolean },
  SetPaymentClaimResult
>(functions, 'setPaymentClaim', { timeout: 10_000 })

type RosterParticipant = Pick<
  Participant,
  'id' | 'fullName' | 'feeOwed' | 'registrationState' | 'paymentClaimed' | 'claimedBy'
>

export function LeaderRosterPage() {
  const role = useUserRole()
  const [camp, setCamp] = useState<Camp | null>(null)
  const [participants, setParticipants] = useState<RosterParticipant[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<Set<string>>(new Set())

  const campId = role.type === 'leader' ? role.campId : null
  const subGroupId = role.type === 'leader' ? role.subGroupId : null
  const subGroupName = role.type === 'leader' ? role.subGroupName : ''

  useEffect(() => {
    if (!campId || !subGroupId) return
    let cancelled = false

    Promise.all([
      getCamp(campId),
      getDocs(
        query(
          collection(db, 'camps', campId, 'participants'),
          where('subGroupId', '==', subGroupId),
        ),
      ),
    ])
      .then(([campData, snap]) => {
        if (cancelled) return
        setCamp(campData)
        const list: RosterParticipant[] = snap.docs
          .map((d) => {
            const data = d.data() as Participant
            return {
              id: d.id,
              fullName: data.fullName,
              feeOwed: data.feeOwed,
              registrationState: data.registrationState,
              paymentClaimed: data.paymentClaimed,
              claimedBy: data.claimedBy,
            }
          })
          .filter((p) => p.registrationState === 'REGISTERED')
          .sort((a, b) => a.fullName.localeCompare(b.fullName))
        setParticipants(list)
      })
      .catch(() => {
        if (!cancelled) toast.error('Failed to load roster')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [campId, subGroupId])

  async function handleToggle(p: RosterParticipant) {
    const newClaimed = !p.paymentClaimed
    // Optimistic update
    setParticipants((prev) =>
      prev.map((x) =>
        x.id === p.id ? { ...x, paymentClaimed: newClaimed } : x,
      ),
    )
    setToggling((prev) => new Set(prev).add(p.id))

    try {
      await setPaymentClaimFn({ participantId: p.id, claimed: newClaimed })
    } catch (err) {
      // Revert optimistic update on failure
      setParticipants((prev) =>
        prev.map((x) =>
          x.id === p.id ? { ...x, paymentClaimed: p.paymentClaimed } : x,
        ),
      )
      toast.error((err as { message?: string })?.message ?? 'Failed to update claim')
    } finally {
      setToggling((prev) => {
        const next = new Set(prev)
        next.delete(p.id)
        return next
      })
    }
  }

  if (role.type !== 'leader') return null

  const currency = camp?.currency ?? 'GHS'
  const claimed = participants.filter((p) => p.paymentClaimed)
  const claimedTotal = claimed.reduce((s, p) => s + p.feeOwed, 0)

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{camp?.name ?? '…'}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{subGroupName}</p>
        </div>
        <LogoutButton />
      </div>

      {/* Nav between leader screens */}
      <div className="mb-6 flex gap-2 border-b pb-4">
        <Link
          to="/leader/register"
          className="flex items-center gap-1.5 rounded-md px-3 py-3.5 text-sm text-muted-foreground hover:bg-muted"
        >
          <UserPlus className="h-4 w-4" />
          Register
        </Link>
        <span className="flex items-center gap-1.5 rounded-md bg-muted px-3 py-3.5 text-sm font-medium">
          <ClipboardList className="h-4 w-4" />
          Payment roster
        </span>
        <Link
          to="/guide"
          className="flex items-center gap-1.5 rounded-md px-3 py-3.5 text-sm text-muted-foreground hover:bg-muted"
        >
          <BookOpen className="h-4 w-4" />
          Guide
        </Link>
      </div>

      {/* Summary */}
      {!loading && (
        <div className="mb-5 grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-md border bg-card px-3 py-2.5">
            <p className="text-xs text-muted-foreground">Total registered</p>
            <p className="text-lg font-semibold">{participants.length}</p>
          </div>
          <div className="rounded-md border bg-card px-3 py-2.5">
            <p className="text-xs text-muted-foreground">Marked paid</p>
            <p className="text-lg font-semibold text-emerald-600">{claimed.length}</p>
          </div>
          <div className="rounded-md border bg-card px-3 py-2.5">
            <p className="text-xs text-muted-foreground">Expected lump sum</p>
            <p className="text-lg font-semibold">{formatMoney(claimedTotal, currency)}</p>
          </div>
        </div>
      )}

      {loading && (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
      )}

      {!loading && participants.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No registered participants in your group yet.
        </p>
      )}

      {/* Roster list */}
      {!loading && participants.length > 0 && (
        <div className="divide-y rounded-md border">
          {participants.map((p) => {
            const isClaimed = !!p.paymentClaimed
            const isBusy = toggling.has(p.id)
            return (
              <button
                key={p.id}
                onClick={() => !isBusy && handleToggle(p)}
                disabled={isBusy}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60 ${
                  isClaimed ? 'bg-emerald-50/60' : ''
                }`}
              >
                {isClaimed ? (
                  <CheckSquare className="h-5 w-5 shrink-0 text-emerald-600" />
                ) : (
                  <Square className="h-5 w-5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block font-medium leading-snug">{p.fullName}</span>
                  {isClaimed && (
                    <span className="mt-0.5 inline-flex items-center rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                      Claimed
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                  {formatMoney(p.feeOwed, currency)}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Marking someone as paid here does not confirm payment — your admin will review and confirm.
      </p>
    </div>
  )
}
