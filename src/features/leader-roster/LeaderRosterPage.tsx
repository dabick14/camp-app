import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { Link } from 'react-router-dom'
import {
  BookOpen, CheckSquare, ChevronDown, ClipboardList,
  Lock, Search, Square, UserPlus, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { db, functions } from '@/lib/firebase'
import { formatMoney } from '@/lib/formatMoney'
import { withTimeout } from '@/lib/withTimeout'
import { Input } from '@/components/ui/input'
import { PageError, PageLoading } from '@/components/ui/states'
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
  | 'id' | 'fullName' | 'phone' | 'feeOwed'
  | 'registrationState' | 'paymentClaimed' | 'claimedBy' | 'confirmedBatchId'
>

type StateFilter = 'all' | 'unmarked' | 'claimed' | 'confirmed'

const FILTER_LABELS: Record<StateFilter, string> = {
  all: 'All',
  unmarked: 'Needs marking',
  claimed: 'Claimed',
  confirmed: 'Confirmed',
}

// Threshold below which the confirmed section starts expanded
const CONFIRMED_AUTO_EXPAND_MAX = 5

export function LeaderRosterPage() {
  const role = useUserRole()
  const [camp, setCamp] = useState<Camp | null>(null)
  const [participants, setParticipants] = useState<RosterParticipant[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [toggling, setToggling] = useState<Set<string>>(new Set())

  const [searchRaw, setSearchRaw] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchRaw), 300)
    return () => clearTimeout(t)
  }, [searchRaw])

  const [stateFilter, setStateFilter] = useState<StateFilter>('all')
  const [confirmedOpen, setConfirmedOpen] = useState(false)

  const campId = role.type === 'leader' ? role.campId : null
  const subGroupId = role.type === 'leader' ? role.subGroupId : null
  const subGroupName = role.type === 'leader' ? role.subGroupName : ''

  async function loadRoster(campId: string, subGroupId: string, cancelled: { value: boolean }) {
    setLoading(true)
    setLoadError('')
    try {
      const [campData, snap] = await withTimeout(
        Promise.all([
          getCamp(campId),
          getDocs(
            query(
              collection(db, 'camps', campId, 'participants'),
              where('subGroupId', '==', subGroupId),
            ),
          ),
        ]),
      )
      if (cancelled.value) return
      setCamp(campData)
      const list: RosterParticipant[] = snap.docs
        .map((d) => {
          const data = d.data() as Participant
          return {
            id: d.id,
            fullName: data.fullName,
            phone: data.phone,
            feeOwed: data.feeOwed,
            registrationState: data.registrationState,
            paymentClaimed: data.paymentClaimed,
            claimedBy: data.claimedBy,
            confirmedBatchId: data.confirmedBatchId,
          }
        })
        .filter((p) => p.registrationState === 'REGISTERED')
        .sort((a, b) => a.fullName.localeCompare(b.fullName))
      setParticipants(list)

      const confirmedCount = list.filter((p) => !!p.confirmedBatchId).length
      setConfirmedOpen(confirmedCount > 0 && confirmedCount <= CONFIRMED_AUTO_EXPAND_MAX)
    } catch (err) {
      if (cancelled.value) return
      setLoadError((err as Error).message ?? 'Failed to load roster')
    } finally {
      if (!cancelled.value) setLoading(false)
    }
  }

  useEffect(() => {
    if (!campId || !subGroupId) return
    const cancelled = { value: false }
    loadRoster(campId, subGroupId, cancelled)
    return () => { cancelled.value = true }
  }, [campId, subGroupId])

  async function handleToggle(p: RosterParticipant) {
    const newClaimed = !p.paymentClaimed
    setParticipants((prev) =>
      prev.map((x) => x.id === p.id ? { ...x, paymentClaimed: newClaimed } : x),
    )
    setToggling((prev) => new Set(prev).add(p.id))
    try {
      await setPaymentClaimFn({ participantId: p.id, claimed: newClaimed })
    } catch (err) {
      setParticipants((prev) =>
        prev.map((x) => x.id === p.id ? { ...x, paymentClaimed: p.paymentClaimed } : x),
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

  // ── Partition ────────────────────────────────────────────────────────────────
  const working = useMemo(
    () => participants.filter((p) => !p.confirmedBatchId),
    [participants],
  )
  const confirmed = useMemo(
    () => participants.filter((p) => !!p.confirmedBatchId),
    [participants],
  )
  const claimedUnconfirmed = useMemo(
    () => working.filter((p) => !!p.paymentClaimed),
    [working],
  )
  const unmarkedCount = working.length - claimedUnconfirmed.length
  // The lump the leader still needs to hand over: sum of unconfirmed claimed fees
  const claimedTotal = useMemo(
    () => claimedUnconfirmed.reduce((s, p) => s + p.feeOwed, 0),
    [claimedUnconfirmed],
  )

  // ── Search + filter ──────────────────────────────────────────────────────────
  const workingFiltered = useMemo(() => {
    if (stateFilter === 'confirmed') return []
    let list = working
    if (stateFilter === 'unmarked') list = list.filter((p) => !p.paymentClaimed)
    else if (stateFilter === 'claimed') list = list.filter((p) => !!p.paymentClaimed)
    if (searchDebounced) {
      const q = searchDebounced.toLowerCase()
      const digits = q.replace(/\D/g, '')
      list = list.filter(
        (p) =>
          p.fullName.toLowerCase().includes(q) ||
          (digits.length >= 3 && p.phone.replace(/\D/g, '').includes(digits)),
      )
    }
    return list
  }, [working, stateFilter, searchDebounced])

  const confirmedFiltered = useMemo(() => {
    if (stateFilter === 'unmarked' || stateFilter === 'claimed') return []
    if (!searchDebounced) return confirmed
    const q = searchDebounced.toLowerCase()
    const digits = q.replace(/\D/g, '')
    return confirmed.filter(
      (p) =>
        p.fullName.toLowerCase().includes(q) ||
        (digits.length >= 3 && p.phone.replace(/\D/g, '').includes(digits)),
    )
  }, [confirmed, stateFilter, searchDebounced])

  // Searching auto-expands confirmed so matches aren't hidden
  const isConfirmedVisible = confirmedOpen || !!searchDebounced

  const showConfirmedSection =
    stateFilter !== 'unmarked' && stateFilter !== 'claimed' && confirmed.length > 0

  const noResults =
    !loading &&
    participants.length > 0 &&
    workingFiltered.length === 0 &&
    confirmedFiltered.length === 0

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

      {/* Nav */}
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

      {loading && <PageLoading />}

      {!loading && loadError && (
        <PageError
          message={loadError}
          onRetry={() => campId && subGroupId && loadRoster(campId, subGroupId, { value: false })}
        />
      )}

      {!loading && !loadError && participants.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No registered participants in your group yet.
        </p>
      )}

      {!loading && !loadError && participants.length > 0 && (
        <>
          {/* ── Sticky summary bar ───────────────────────────────────────────── */}
          <div className="sticky top-0 z-10 -mx-4 border-b bg-background/95 px-4 py-2.5 backdrop-blur-sm">
            <div className="flex items-center justify-between gap-3 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  <span className="font-semibold text-emerald-600">{claimedUnconfirmed.length}</span>
                  <span className="ml-1 text-muted-foreground">marked</span>
                </span>
                {confirmed.length > 0 && (
                  <span>
                    <span className="font-semibold text-emerald-700">{confirmed.length}</span>
                    <span className="ml-1 text-muted-foreground">confirmed</span>
                  </span>
                )}
                {unmarkedCount > 0 && (
                  <span>
                    <span className="font-semibold">{unmarkedCount}</span>
                    <span className="ml-1 text-muted-foreground">need marking</span>
                  </span>
                )}
              </div>
              <div className="shrink-0 text-right">
                <span className="text-base font-semibold tabular-nums">
                  {formatMoney(claimedTotal, currency)}
                </span>
                <span className="ml-1 text-xs text-muted-foreground">to hand over</span>
              </div>
            </div>
          </div>

          {/* ── Search + filter ──────────────────────────────────────────────── */}
          <div className="mt-5 space-y-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchRaw}
                onChange={(e) => setSearchRaw(e.target.value)}
                placeholder="Name or phone…"
                className="h-11 pl-10 text-base"
              />
              {searchRaw && (
                <button
                  type="button"
                  onClick={() => setSearchRaw('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Filter chips */}
            <div className="flex flex-wrap gap-2">
              {(Object.keys(FILTER_LABELS) as StateFilter[]).map((f) => {
                const count =
                  f === 'unmarked' ? unmarkedCount
                  : f === 'claimed' ? claimedUnconfirmed.length
                  : f === 'confirmed' ? confirmed.length
                  : participants.length
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setStateFilter(f)}
                    className={`rounded-full px-3 py-2 text-sm font-medium transition-colors ${
                      stateFilter === f
                        ? 'bg-foreground text-background'
                        : 'bg-muted text-muted-foreground hover:bg-muted/70'
                    }`}
                  >
                    {FILTER_LABELS[f]}
                    {count > 0 && f !== 'all' && (
                      <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── No-results state ─────────────────────────────────────────────── */}
          {noResults && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No participants match your search or filter.
            </p>
          )}

          {/* ── Working section ──────────────────────────────────────────────── */}
          {stateFilter !== 'confirmed' && (
            <div className="mt-6">
              {confirmed.length > 0 && (
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Working{workingFiltered.length > 0 ? ` (${workingFiltered.length})` : ''}
                </p>
              )}
              {workingFiltered.length > 0 ? (
                <div className="divide-y rounded-md border">
                  {workingFiltered.map((p) => {
                    const isClaimed = !!p.paymentClaimed
                    const isBusy = toggling.has(p.id)
                    return (
                      <button
                        key={p.id}
                        type="button"
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
              ) : (
                !noResults && (
                  <p className="py-4 text-sm text-muted-foreground">
                    {stateFilter === 'claimed'
                      ? 'No claimed participants yet.'
                      : stateFilter === 'unmarked'
                        ? 'Everyone in this group has been marked.'
                        : searchDebounced
                          ? 'No matches in working set.'
                          : 'No participants need marking.'}
                  </p>
                )
              )}
            </div>
          )}

          {/* ── Confirmed section (collapsible) ──────────────────────────────── */}
          {showConfirmedSection && (
            <div className="mt-6">
              <button
                type="button"
                onClick={() => setConfirmedOpen((o) => !o)}
                className="flex w-full items-center justify-between py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                <span>
                  Confirmed
                  {confirmedFiltered.length > 0
                    ? ` (${confirmedFiltered.length})`
                    : ` (${confirmed.length})`}
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${isConfirmedVisible ? 'rotate-180' : ''}`}
                />
              </button>
              {isConfirmedVisible && (
                confirmedFiltered.length > 0 ? (
                  <div className="mt-1 divide-y rounded-md border">
                    {confirmedFiltered.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() =>
                          toast.info("Confirmed payments can't be changed — contact the admin.")
                        }
                        className="flex w-full items-center gap-3 bg-emerald-50/60 px-4 py-3 text-left"
                      >
                        <Lock className="h-5 w-5 shrink-0 text-emerald-600" />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium leading-snug">{p.fullName}</span>
                          <span className="mt-0.5 inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                            <Lock className="h-3 w-3" />
                            Confirmed
                          </span>
                        </span>
                        <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                          {formatMoney(p.feeOwed, currency)}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  searchDebounced && (
                    <p className="mt-1 py-3 text-sm text-muted-foreground">
                      No confirmed matches for "{searchDebounced}".
                    </p>
                  )
                )
              )}
            </div>
          )}

          {/* Footer note */}
          <p className="mt-6 text-center text-xs text-muted-foreground">
            Marking someone as paid here does not confirm payment — your admin will review and confirm.
          </p>
        </>
      )}
    </div>
  )
}
