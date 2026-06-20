import { useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import { useCampData } from '@/features/camp-layout/CampDataContext'
import { derivePaymentState } from '@/features/participants/types'
import { formatMoney } from '@/lib/formatMoney'

function BigMetric({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card px-5 py-4 text-card-foreground">
      <p className="text-3xl font-bold tabular-nums">{value.toLocaleString()}</p>
      <p className="mt-1 text-sm font-medium">{label}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export function DashboardPage() {
  const { camp, participants, subGroups, roomTypes, rooms, loading, refresh } = useCampData()
  const currency = camp?.currency ?? 'GHS'

  const active = useMemo(
    () => participants.filter((p) => p.registrationState === 'REGISTERED'),
    [participants],
  )

  // ─── top-level metrics ──────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    let paid = 0, partial = 0, pending = 0, waived = 0, roomed = 0, overrides = 0
    for (const p of active) {
      const ps = derivePaymentState(p)
      if (ps === 'PAID') paid++
      else if (ps === 'PARTIAL') partial++
      else if (ps === 'PENDING') pending++
      else if (ps === 'WAIVED') waived++
      if (p.roomId) roomed++
      if (p.roomedWithoutFullPayment) overrides++
    }
    return { registered: active.length, paid, partial, pending, waived, roomed, overrides }
  }, [active])

  // ─── per sub-group ──────────────────────────────────────────────────────────
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

  // ─── per room type ──────────────────────────────────────────────────────────
  const byRoomType = useMemo(() => {
    return roomTypes.map((rt) => {
      const preferredBy = active.filter((p) => p.roomTypePreferenceId === rt.id).length
      const typeRooms = rooms.filter((r) => r.roomTypeId === rt.id)
      const capacityTotal = typeRooms.reduce((s, r) => s + r.capacity, 0)
      const occupied = typeRooms.reduce((s, r) => s + r.currentOccupancy, 0)
      return {
        id: rt.id, name: rt.name, price: rt.price,
        preferredBy, capacityTotal, occupied, available: capacityTotal - occupied,
      }
    })
  }, [active, roomTypes, rooms])

  // ─── per gender ─────────────────────────────────────────────────────────────
  const byGender = useMemo(() => {
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
  }, [active, rooms])

  return (
    <div className="px-6 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Dashboard</h2>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Big metric cards */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <BigMetric label="Registered" value={metrics.registered} />
        <BigMetric label="Paid" value={metrics.paid} sub={`${metrics.waived} waived`} />
        <BigMetric label="Partial" value={metrics.partial} />
        <BigMetric label="Pending" value={metrics.pending} />
        <BigMetric label="Roomed" value={metrics.roomed} />
        <BigMetric label="Overrides" value={metrics.overrides} />
      </div>

      <div className="space-y-10">
        {/* By sub-group */}
        <Section title="By Sub-Group">
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
                  <TableHead className="text-right">Received ({currency})</TableHead>
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
                      <TableCell className="text-right">{row.registered}</TableCell>
                      <TableCell className="text-right text-emerald-600">{row.paid}</TableCell>
                      <TableCell className="text-right text-amber-600">{row.partial}</TableCell>
                      <TableCell className="text-right text-red-600">{row.pending}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{row.waived}</TableCell>
                      <TableCell className="text-right">{row.roomed}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.totalExpected, currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.totalReceived, currency)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Section>

        <Separator />

        {/* By room type */}
        <Section title="By Room Type">
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Room type</TableHead>
                  <TableHead className="text-right">Price ({currency})</TableHead>
                  <TableHead className="text-right">Preferred by</TableHead>
                  <TableHead className="text-right">Total capacity</TableHead>
                  <TableHead className="text-right">Occupied</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byRoomType.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
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
                      <TableCell className="text-right">{row.capacityTotal}</TableCell>
                      <TableCell className="text-right">{row.occupied}</TableCell>
                      <TableCell
                        className={`text-right ${row.available <= 0 ? 'text-red-600 font-medium' : 'text-emerald-600'}`}
                      >
                        {row.available}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Section>

        <Separator />

        {/* By gender */}
        <Section title="By Gender">
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
                      className={`text-right ${row.available <= 0 ? 'text-red-600 font-medium' : ''}`}
                    >
                      {row.available}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>
      </div>
    </div>
  )
}
