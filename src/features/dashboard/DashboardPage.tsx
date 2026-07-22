import { useMemo, useState } from 'react'
import { AlertTriangle, Info, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageTitle } from '@/components/ui/page-title'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageError, PageLoading } from '@/components/ui/states'
import { PageContainer } from '@/components/ui/page-container'
import { useCampData } from '@/features/camp-layout/CampDataContext'
import { derivePaymentState } from '@/features/participants/types'
import { formatMoney } from '@/lib/formatMoney'
import { ReportButton } from '@/features/reports/components/ReportButton'
import { generateRegistrationCountsReport } from '@/features/reports/generators'

function BigMetric({ label, value, sub, warn, info, accent, skeleton }: {
  label: string; value: number; sub?: string; warn?: boolean; info?: boolean; accent?: boolean; skeleton?: boolean
}) {
  const alertWarn = !skeleton && warn && value > 0
  // "info" is the amber/informational treatment — for service notes that
  // aren't money errors and shouldn't read as alarming as `warn` (red).
  const alertInfo = !skeleton && info && value > 0
  return (
    <div className={`rounded-lg border px-5 py-4 ${
      alertWarn
        ? 'border-destructive/20 bg-destructive/5 text-foreground'
        : alertInfo
        ? 'border-status-partial/30 bg-status-partial-bg text-foreground'
        : 'bg-card text-card-foreground'
    }`}>
      <div className="flex items-center gap-1.5">
        {alertWarn && <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />}
        {alertInfo && <Info className="h-4 w-4 shrink-0 text-status-partial" />}
        {skeleton
          ? <span className="my-0.5 block h-9 w-14 animate-pulse rounded bg-muted" />
          : <p className={`text-3xl font-bold tabular-nums ${alertWarn ? 'text-destructive' : alertInfo ? 'text-status-partial' : accent ? 'text-primary' : ''}`}>{value.toLocaleString()}</p>
        }
      </div>
      <p className="mt-1 text-sm font-medium">{label}</p>
      {sub && <p className="text-xs text-muted-foreground">{skeleton ? <span className="inline-block h-3 w-12 animate-pulse rounded bg-muted align-middle" /> : sub}</p>}
    </div>
  )
}

function MoneyMetric({ label, amount, currency, accent, skeleton }: {
  label: string; amount: number; currency: string; accent?: boolean; skeleton?: boolean
}) {
  return (
    <div className="rounded-lg border bg-card px-5 py-4">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      {skeleton
        ? <span className="block h-8 w-32 animate-pulse rounded bg-muted" />
        : <p className={`text-2xl font-bold tabular-nums ${accent ? 'text-status-paid' : ''}`}>
            {currency} {amount.toLocaleString()}
          </p>
      }
    </div>
  )
}

function Sk() {
  return <span className="inline-block h-4 w-8 animate-pulse rounded bg-muted align-middle" />
}
function SkWide() {
  return <span className="inline-block h-4 w-20 animate-pulse rounded bg-muted align-middle" />
}

export function DashboardPage() {
  const { camp, participants, subGroups, roomTypes, rooms, loading, error, participantsLoading, refresh } = useCampData()
  // True only during the gap before the first participant page arrives.
  const participantsPending = participantsLoading && participants.length === 0
  const currency = camp?.currency ?? 'GHS'

  // Track which tabs have been opened so we can lazily compute their breakdowns.
  // By sub-group is the default tab — it's always computed.
  const [seenRoomType, setSeenRoomType] = useState(false)
  const [seenGender, setSeenGender] = useState(false)
  const [seenSuperGroup, setSeenSuperGroup] = useState(false)

  const active = useMemo(
    () => participants.filter((p) => p.registrationState === 'REGISTERED'),
    [participants],
  )

  // ─── top-level metrics (always needed — power the summary cards) ────────────
  const metrics = useMemo(() => {
    let paid = 0, partial = 0, pending = 0, waived = 0, roomed = 0, overrides = 0, differentType = 0
    let totalMoneyPaid = 0, totalFeeOwed = 0
    for (const p of active) {
      const ps = derivePaymentState(p)
      if (ps === 'PAID') paid++
      else if (ps === 'PARTIAL') partial++
      else if (ps === 'PENDING') pending++
      else if (ps === 'WAIVED') waived++
      if (p.roomId) roomed++
      if (p.roomedWithoutFullPayment) overrides++
      if (p.roomedInDifferentType) differentType++
      totalMoneyPaid += p.amountPaid
      totalFeeOwed += p.feeOwed
    }
    const totalMoneyOwed = Math.max(0, totalFeeOwed - totalMoneyPaid)
    return { registered: active.length, paid, partial, pending, waived, roomed, overrides, differentType, totalMoneyPaid, totalMoneyOwed }
  }, [active])

  // ─── By sub-group (default tab — computed immediately) ─────────────────────
  const bySubGroup = useMemo(() => {
    const map = new Map<string, {
      name: string; registered: number; paid: number; partial: number;
      pending: number; waived: number; roomed: number; totalExpected: number; totalReceived: number
    }>()
    for (const sg of subGroups) {
      map.set(sg.id, {
        name: sg.name, registered: 0, paid: 0, partial: 0,
        pending: 0, waived: 0, roomed: 0, totalExpected: 0, totalReceived: 0,
      })
    }
    for (const p of active) {
      const row = map.get(p.subGroupId)
      if (!row) continue
      row.registered++
      const ps = derivePaymentState(p)
      if (ps === 'PAID') row.paid++
      else if (ps === 'PARTIAL') row.partial++
      else if (ps === 'PENDING') row.pending++
      else if (ps === 'WAIVED') row.waived++
      if (p.roomId) row.roomed++
      row.totalExpected += p.feeOwed
      row.totalReceived += p.amountPaid
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [active, subGroups])

  const registrationReportText = useMemo(() => generateRegistrationCountsReport(
    camp?.name ?? 'Camp',
    bySubGroup.map((row) => ({ name: row.name, registered: row.registered })),
  ), [camp?.name, bySubGroup])

  // ─── By super-group (lazy — only computed after first visit to that tab) ────
  const bySuperGroup = useMemo(() => {
    if (!seenSuperGroup) return null
    const campSuperGroups = camp?.superGroups ?? []
    const knownIds = new Set(campSuperGroups.map((sg) => sg.id))

    type Bucket = {
      name: string; registered: number; paid: number; partial: number
      pending: number; waived: number; roomed: number; totalExpected: number; totalReceived: number
    }
    const zero = (): Bucket => ({
      name: '', registered: 0, paid: 0, partial: 0,
      pending: 0, waived: 0, roomed: 0, totalExpected: 0, totalReceived: 0,
    })

    const buckets = new Map<string, Bucket>()
    for (const sg of campSuperGroups) {
      buckets.set(sg.id, { ...zero(), name: sg.name })
    }
    const unassigned: Bucket = { ...zero(), name: 'Unassigned' }

    // Build sub-group → super-group lookup; dangling references count as unassigned
    const sgToSuper = new Map<string, string | null>()
    for (const sg of subGroups) {
      sgToSuper.set(sg.id, sg.superGroupId && knownIds.has(sg.superGroupId) ? sg.superGroupId : null)
    }

    for (const p of active) {
      const superId = sgToSuper.get(p.subGroupId) ?? null
      const bucket = superId ? buckets.get(superId) ?? unassigned : unassigned
      bucket.registered++
      const ps = derivePaymentState(p)
      if (ps === 'PAID') bucket.paid++
      else if (ps === 'PARTIAL') bucket.partial++
      else if (ps === 'PENDING') bucket.pending++
      else if (ps === 'WAIVED') bucket.waived++
      if (p.roomId) bucket.roomed++
      bucket.totalExpected += p.feeOwed
      bucket.totalReceived += p.amountPaid
    }

    const rows: Bucket[] = campSuperGroups.map((sg) => buckets.get(sg.id)!)
    if (unassigned.registered > 0 || campSuperGroups.length === 0) rows.push(unassigned)

    return { rows, hasSuperGroups: campSuperGroups.length > 0 }
  }, [seenSuperGroup, active, subGroups, camp])

  // ─── By room type (lazy — only computed after first visit to that tab) ──────
  const byRoomType = useMemo(() => {
    if (!seenRoomType) return null
    return roomTypes.map((rt) => {
      const preferrers = active.filter((p) => p.roomTypePreferenceId === rt.id)
      let paid = 0, partial = 0, pending = 0, waived = 0, totalReceived = 0
      for (const p of preferrers) {
        const ps = derivePaymentState(p)
        if (ps === 'PAID') paid++
        else if (ps === 'PARTIAL') partial++
        else if (ps === 'PENDING') pending++
        else if (ps === 'WAIVED') waived++
        totalReceived += p.amountPaid
      }
      const typeRooms = rooms.filter((r) => r.roomTypeId === rt.id)
      const capacityTotal = typeRooms.reduce((s, r) => s + r.capacity, 0)
      const occupied = typeRooms.reduce((s, r) => s + r.currentOccupancy, 0)
      return {
        id: rt.id, name: rt.name, price: rt.price,
        preferredBy: preferrers.length, paid, partial, pending, waived, totalReceived,
        capacityTotal, occupied, available: capacityTotal - occupied,
      }
    })
  }, [seenRoomType, active, roomTypes, rooms])

  // ─── By gender (lazy — only computed after first visit to that tab) ─────────
  const byGender = useMemo(() => {
    if (!seenGender) return null
    const male = { registered: 0, roomed: 0, capacity: 0, available: 0 }
    const female = { registered: 0, roomed: 0, capacity: 0, available: 0 }
    for (const p of active) {
      const bucket = p.gender === 'M' ? male : female
      bucket.registered++
      if (p.roomId) bucket.roomed++
    }
    for (const r of rooms) {
      const bucket = r.gender === 'M' ? male : female
      bucket.capacity += r.capacity
      bucket.available += Math.max(0, r.capacity - r.currentOccupancy)
    }
    return [
      { label: 'Male', ...male },
      { label: 'Female', ...female },
    ]
  }, [seenGender, active, rooms])

  function handleTabChange(value: string) {
    if (value === 'by-super') setSeenSuperGroup(true)
    if (value === 'by-rt') setSeenRoomType(true)
    if (value === 'by-gender') setSeenGender(true)
  }

  return (
    <PageContainer>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <PageTitle>Dashboard</PageTitle>
        <div className="flex flex-wrap items-center gap-2">
          <ReportButton label="Registration report" reportText={registrationReportText} />
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {loading && <PageLoading />}
      {!loading && error && <PageError message={error} onRetry={refresh} />}
      {loading || error ? null : <>

      {/* Summary cards — people counts */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <BigMetric label="Registered" value={metrics.registered} accent skeleton={participantsPending} />
        <BigMetric label="Paid" value={metrics.paid} sub={`${metrics.waived} waived`} skeleton={participantsPending} />
        <BigMetric label="Partial" value={metrics.partial} skeleton={participantsPending} />
        <BigMetric label="Pending" value={metrics.pending} skeleton={participantsPending} />
        <BigMetric label="Roomed" value={metrics.roomed} skeleton={participantsPending} />
        <BigMetric label="Overrides" value={metrics.overrides} warn skeleton={participantsPending} />
        <BigMetric label="Roomed in different type" value={metrics.differentType} info skeleton={participantsPending} />
      </div>

      {/* Money totals — visually distinct from people counts */}
      <div className="mb-8 grid grid-cols-2 gap-3 rounded-lg border border-dashed bg-muted/30 p-3">
        <MoneyMetric label="Confirmed paid" amount={metrics.totalMoneyPaid} currency={currency} accent skeleton={participantsPending} />
        <MoneyMetric label="Still owed" amount={metrics.totalMoneyOwed} currency={currency} skeleton={participantsPending} />
      </div>

      {/* Tabbed breakdowns */}
      <Tabs defaultValue="by-sg" onValueChange={handleTabChange}>
        {/* Scrollable tab strip on mobile */}
        <div className="relative mb-4 overflow-x-auto [&::-webkit-scrollbar]:hidden">
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-background to-transparent sm:hidden" />
          <TabsList className="w-max justify-start">
            <TabsTrigger value="by-sg">By sub-group</TabsTrigger>
            <TabsTrigger value="by-super">By super-group</TabsTrigger>
            <TabsTrigger value="by-rt">By room type</TabsTrigger>
            <TabsTrigger value="by-gender">By gender</TabsTrigger>
          </TabsList>
        </div>

        {/* ── By sub-group ───────────────────────────────────────────────────── */}
        <TabsContent value="by-sg">
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sub-group</TableHead>
                  <TableHead className="text-right">Registered</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Partial</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                  <TableHead className="text-right">Waived</TableHead>
                  <TableHead className="text-right">Roomed</TableHead>
                  <TableHead className="text-right">Expected ({currency})</TableHead>
                  <TableHead className="text-right">Confirmed ({currency})</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bySubGroup.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground">
                      No sub-groups
                    </TableCell>
                  </TableRow>
                ) : (
                  bySubGroup.map((row) => (
                    <TableRow key={row.name}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-right">{participantsPending ? <Sk /> : row.registered}</TableCell>
                      <TableCell className="text-right text-status-paid">{participantsPending ? <Sk /> : row.paid}</TableCell>
                      <TableCell className="text-right text-status-partial">{participantsPending ? <Sk /> : row.partial}</TableCell>
                      <TableCell className="text-right text-status-pending">{participantsPending ? <Sk /> : row.pending}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{participantsPending ? <Sk /> : row.waived}</TableCell>
                      <TableCell className="text-right">{participantsPending ? <Sk /> : row.roomed}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {participantsPending ? <SkWide /> : formatMoney(row.totalExpected, currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {participantsPending ? <SkWide /> : formatMoney(row.totalReceived, currency)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── By super-group ─────────────────────────────────────────────────── */}
        <TabsContent value="by-super">
          {bySuperGroup === null ? null : !bySuperGroup.hasSuperGroups ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No super-groups defined for this camp. Add them in Camp Settings to see rollup counts here.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Super-group</TableHead>
                    <TableHead className="text-right">Registered</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Partial</TableHead>
                    <TableHead className="text-right">Pending</TableHead>
                    <TableHead className="text-right">Waived</TableHead>
                    <TableHead className="text-right">Roomed</TableHead>
                    <TableHead className="text-right">Expected ({currency})</TableHead>
                    <TableHead className="text-right">Confirmed ({currency})</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bySuperGroup.rows.map((row) => (
                    <TableRow key={row.name} className={row.name === 'Unassigned' ? 'text-muted-foreground' : ''}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-right">{participantsPending ? <Sk /> : row.registered}</TableCell>
                      <TableCell className="text-right text-status-paid">{participantsPending ? <Sk /> : row.paid}</TableCell>
                      <TableCell className="text-right text-status-partial">{participantsPending ? <Sk /> : row.partial}</TableCell>
                      <TableCell className="text-right text-status-pending">{participantsPending ? <Sk /> : row.pending}</TableCell>
                      <TableCell className="text-right">{participantsPending ? <Sk /> : row.waived}</TableCell>
                      <TableCell className="text-right">{participantsPending ? <Sk /> : row.roomed}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {participantsPending ? <SkWide /> : formatMoney(row.totalExpected, currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {participantsPending ? <SkWide /> : formatMoney(row.totalReceived, currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ── By room type ───────────────────────────────────────────────────── */}
        <TabsContent value="by-rt">
          {byRoomType === null ? null : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Room type</TableHead>
                    <TableHead className="text-right">Price ({currency})</TableHead>
                    <TableHead className="text-right">Preferred by</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Partial</TableHead>
                    <TableHead className="text-right">Pending</TableHead>
                    <TableHead className="text-right">Waived</TableHead>
                    <TableHead className="text-right">Confirmed ({currency})</TableHead>
                    <TableHead className="text-right">Total capacity</TableHead>
                    <TableHead className="text-right">Occupied</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byRoomType.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center text-muted-foreground">
                        No room types
                      </TableCell>
                    </TableRow>
                  ) : (
                    byRoomType.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(row.price, currency)}
                        </TableCell>
                        <TableCell className="text-right">{row.preferredBy}</TableCell>
                        <TableCell className="text-right text-status-paid">{row.paid}</TableCell>
                        <TableCell className="text-right text-status-partial">{row.partial}</TableCell>
                        <TableCell className="text-right text-status-pending">{row.pending}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{row.waived}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(row.totalReceived, currency)}
                        </TableCell>
                        <TableCell className="text-right">{row.capacityTotal}</TableCell>
                        <TableCell className="text-right">{row.occupied}</TableCell>
                        <TableCell
                          className={`text-right ${row.available <= 0 ? 'font-medium text-destructive' : 'text-status-paid'}`}
                        >
                          {row.available}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ── By gender ──────────────────────────────────────────────────────── */}
        <TabsContent value="by-gender">
          {byGender === null ? null : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Gender</TableHead>
                    <TableHead className="text-right">Registered</TableHead>
                    <TableHead className="text-right">Roomed</TableHead>
                    <TableHead className="text-right">Total capacity</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byGender.map((row) => (
                    <TableRow key={row.label}>
                      <TableCell className="font-medium">{row.label}</TableCell>
                      <TableCell className="text-right">{row.registered}</TableCell>
                      <TableCell className="text-right">{row.roomed}</TableCell>
                      <TableCell className="text-right">{row.capacity}</TableCell>
                      <TableCell
                        className={`text-right ${row.available <= 0 ? 'font-medium text-destructive' : ''}`}
                      >
                        {row.available}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
      </>}
    </PageContainer>
  )
}
