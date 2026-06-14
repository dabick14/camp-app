import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronLeft, ChevronRight, Plus, Search, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useCampData } from '@/features/camp-layout/CampDataContext'
import { type Participant, type PaymentState, derivePaymentState } from './types'
import { DetailDrawer } from './components/DetailDrawer'

// ─── helpers ──────────────────────────────────────────────────────────────────

type SortField = 'name' | 'subGroup' | 'feeStatus'

const PAYMENT_STATE_ORDER: Record<PaymentState, number> = {
  PAID: 0,
  WAIVED: 1,
  PARTIAL: 2,
  PENDING: 3,
}

const PAYMENT_BADGE: Record<PaymentState, string> = {
  PAID: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  PARTIAL: 'bg-amber-50 text-amber-700 border border-amber-200',
  PENDING: 'bg-red-50 text-red-700 border border-red-200',
  WAIVED: 'bg-muted text-muted-foreground border border-border',
}

const PAGE_SIZE = 50

// ─── sub-components ───────────────────────────────────────────────────────────

function FilterDropdown({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: { value: string; label: string }[]
  selected: string[]
  onChange: (v: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [])

  function toggle(value: string) {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    )
  }

  const active = selected.length > 0

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
          active
            ? 'border-primary bg-primary/5 font-medium text-primary'
            : 'border-input bg-background text-muted-foreground hover:text-foreground'
        }`}
      >
        {active ? `${label} (${selected.length})` : label}
        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 min-w-[176px] rounded-md border bg-background shadow-lg">
          <ul className="py-1">
            {options.map((opt) => (
              <li key={opt.value}>
                <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={selected.includes(opt.value)}
                    onChange={() => toggle(opt.value)}
                    className="h-3.5 w-3.5"
                  />
                  {opt.label}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function SortableHead({
  label,
  field,
  sortBy,
  sortDir,
  onSort,
}: {
  label: string
  field: SortField
  sortBy: SortField
  sortDir: 'asc' | 'desc'
  onSort: (f: SortField) => void
}) {
  const active = sortBy === field
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className="flex items-center gap-1 font-medium text-foreground hover:text-primary"
    >
      {label}
      <span className={`text-xs ${active ? 'text-primary' : 'invisible'}`}>
        {sortDir === 'asc' ? '↑' : '↓'}
      </span>
    </button>
  )
}

function FeeStatusCell({ p, currency }: { p: Participant; currency: string }) {
  const ps = derivePaymentState(p)
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">
        {currency} {p.amountPaid.toLocaleString()}/{p.feeOwed.toLocaleString()}
      </span>
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PAYMENT_BADGE[ps]}`}>
        {ps}
      </span>
    </div>
  )
}

function TagsCell({ tags }: { tags: string[] }) {
  const visible = tags.slice(0, 2)
  const extra = tags.length - 2
  if (tags.length === 0) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((tag) => (
        <span
          key={tag}
          className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium"
        >
          {tag}
        </span>
      ))}
      {extra > 0 && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          +{extra}
        </span>
      )}
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export function ParticipantListPage() {
  const { camp, participants, subGroups, roomTypes, loading, refresh } = useCampData()
  const currency = camp?.currency ?? 'GHS'
  const location = useLocation()
  const navigate = useNavigate()

  // ─── auto-open from navigation state (after admin add) ──────────────────────
  const [autoOpenId] = useState<string | null>(
    () => (location.state as { autoOpenId?: string } | null)?.autoOpenId ?? null,
  )
  useEffect(() => {
    if (autoOpenId) {
      refresh()
      navigate('.', { replace: true, state: {} })
    }
    // Run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (autoOpenId && participants.some((p) => p.id === autoOpenId)) {
      setSelectedId(autoOpenId)
    }
  }, [participants, autoOpenId])

  // ─── filter state ───────────────────────────────────────────────────────────
  const [filterSubGroups, setFilterSubGroups] = useState<string[]>([])
  const [filterPaymentStates, setFilterPaymentStates] = useState<PaymentState[]>([])
  const [filterCheckInStates, setFilterCheckInStates] = useState<string[]>([])
  const [filterRoomTypes, setFilterRoomTypes] = useState<string[]>([])
  const [filterTags, setFilterTags] = useState<string[]>([])
  const [hasRoom, setHasRoom] = useState<'all' | 'assigned' | 'unassigned'>('all')
  const [showCancelled, setShowCancelled] = useState(false)

  // ─── search ─────────────────────────────────────────────────────────────────
  const [searchRaw, setSearchRaw] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchRaw), 300)
    return () => clearTimeout(t)
  }, [searchRaw])

  // ─── sort / page ────────────────────────────────────────────────────────────
  const [sortBy, setSortBy] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)

  // ─── drawer ─────────────────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedParticipant = participants.find((p) => p.id === selectedId) ?? null

  function handleSort(field: SortField) {
    if (sortBy === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortBy(field)
      setSortDir('asc')
    }
    setPage(1)
  }

  function clearFilters() {
    setFilterSubGroups([])
    setFilterPaymentStates([])
    setFilterCheckInStates([])
    setFilterRoomTypes([])
    setFilterTags([])
    setHasRoom('all')
    setSearchRaw('')
    setPage(1)
  }

  const hasAnyFilter =
    filterSubGroups.length > 0 ||
    filterPaymentStates.length > 0 ||
    filterCheckInStates.length > 0 ||
    filterRoomTypes.length > 0 ||
    filterTags.length > 0 ||
    hasRoom !== 'all' ||
    searchRaw !== ''

  // ─── filtered + sorted list ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = participants

    if (!showCancelled) {
      list = list.filter((p) => p.registrationState !== 'CANCELLED')
    }
    if (filterSubGroups.length > 0) {
      list = list.filter((p) => filterSubGroups.includes(p.subGroupId))
    }
    if (filterPaymentStates.length > 0) {
      list = list.filter((p) => filterPaymentStates.includes(derivePaymentState(p)))
    }
    if (filterCheckInStates.length > 0) {
      list = list.filter((p) => filterCheckInStates.includes(p.checkInState))
    }
    if (filterRoomTypes.length > 0) {
      list = list.filter((p) => filterRoomTypes.includes(p.roomTypePreferenceId))
    }
    if (filterTags.length > 0) {
      // ALL selected tags must be present (AND logic)
      list = list.filter((p) =>
        filterTags.every((tag) => (p.tags ?? []).includes(tag)),
      )
    }
    if (hasRoom === 'assigned') {
      list = list.filter((p) => p.roomId)
    } else if (hasRoom === 'unassigned') {
      list = list.filter((p) => !p.roomId)
    }
    if (searchDebounced) {
      const q = searchDebounced.trim().toLowerCase()
      const qDigits = q.replace(/\D/g, '')
      list = list.filter((p) => {
        const nameMatch = p.fullName.toLowerCase().includes(q)
        const phoneMatch = qDigits.length >= 3 && p.phone.replace(/\D/g, '').includes(qDigits)
        return nameMatch || phoneMatch
      })
    }

    return [...list].sort((a, b) => {
      let cmp = 0
      if (sortBy === 'name') cmp = a.fullName.localeCompare(b.fullName)
      else if (sortBy === 'subGroup') cmp = a.subGroupName.localeCompare(b.subGroupName)
      else if (sortBy === 'feeStatus') {
        cmp =
          PAYMENT_STATE_ORDER[derivePaymentState(a)] -
          PAYMENT_STATE_ORDER[derivePaymentState(b)]
        if (cmp === 0) cmp = a.fullName.localeCompare(b.fullName)
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [
    participants,
    showCancelled,
    filterSubGroups,
    filterPaymentStates,
    filterCheckInStates,
    filterRoomTypes,
    filterTags,
    hasRoom,
    searchDebounced,
    sortBy,
    sortDir,
  ])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageSlice = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Reset to page 1 whenever filters change
  useEffect(() => {
    setPage(1)
  }, [filtered.length, searchDebounced])

  // ─── filter options ─────────────────────────────────────────────────────────
  const sgOptions = subGroups.map((sg) => ({ value: sg.id, label: sg.name }))
  const rtOptions = roomTypes.map((rt) => ({ value: rt.id, label: rt.name }))
  const psOptions: { value: string; label: string }[] = [
    { value: 'PAID', label: 'Paid' },
    { value: 'PARTIAL', label: 'Partial' },
    { value: 'PENDING', label: 'Pending' },
    { value: 'WAIVED', label: 'Waived' },
  ]
  const ciOptions = [
    { value: 'NOT_ARRIVED', label: 'Not arrived' },
    { value: 'ARRIVED', label: 'Arrived' },
  ]
  const tagOptions = useMemo(() => {
    const tagSet = new Set<string>()
    participants.forEach((p) => (p.tags ?? []).forEach((t) => tagSet.add(t)))
    return Array.from(tagSet)
      .sort()
      .map((t) => ({ value: t, label: t }))
  }, [participants])

  // ─── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="px-6 py-6">
      {/* Action bar */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchRaw}
              onChange={(e) => setSearchRaw(e.target.value)}
              placeholder="Name or phone…"
              className="pl-8 text-sm"
            />
            {searchRaw && (
              <button
                type="button"
                onClick={() => setSearchRaw('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <FilterDropdown
            label="Sub-group"
            options={sgOptions}
            selected={filterSubGroups}
            onChange={(v) => {
              setFilterSubGroups(v)
              setPage(1)
            }}
          />
          <FilterDropdown
            label="Payment"
            options={psOptions}
            selected={filterPaymentStates}
            onChange={(v) => {
              setFilterPaymentStates(v as PaymentState[])
              setPage(1)
            }}
          />
          <FilterDropdown
            label="Check-in"
            options={ciOptions}
            selected={filterCheckInStates}
            onChange={(v) => {
              setFilterCheckInStates(v)
              setPage(1)
            }}
          />
          <FilterDropdown
            label="Room type"
            options={rtOptions}
            selected={filterRoomTypes}
            onChange={(v) => {
              setFilterRoomTypes(v)
              setPage(1)
            }}
          />
          {tagOptions.length > 0 && (
            <FilterDropdown
              label="Tags"
              options={tagOptions}
              selected={filterTags}
              onChange={(v) => {
                setFilterTags(v)
                setPage(1)
              }}
            />
          )}

          {/* Has-room toggle */}
          <div className="flex overflow-hidden rounded-md border border-input text-sm">
            {(['all', 'assigned', 'unassigned'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setHasRoom(v)
                  setPage(1)
                }}
                className={`px-3 py-1.5 capitalize transition-colors ${
                  hasRoom === v
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:text-foreground'
                }`}
              >
                {v === 'all' ? 'All rooms' : v === 'assigned' ? 'Has room' : 'No room'}
              </button>
            ))}
          </div>

          {/* Show cancelled */}
          <button
            type="button"
            onClick={() => setShowCancelled((s) => !s)}
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
              showCancelled
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-input bg-background text-muted-foreground hover:text-foreground'
            }`}
          >
            {showCancelled ? 'Hiding: none' : 'Hiding: cancelled'}
          </button>

          {hasAnyFilter && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>

        {/* Add participant button */}
        <Button size="sm" onClick={() => navigate('participants/new')}>
          <Plus className="h-4 w-4" />
          Add participant
        </Button>
      </div>

      {/* Result count */}
      <p className="mb-3 text-sm text-muted-foreground">
        {loading
          ? 'Loading…'
          : `${filtered.length.toLocaleString()} participant${filtered.length !== 1 ? 's' : ''}${
              filtered.length !== participants.length
                ? ` (${participants.length.toLocaleString()} total)`
                : ''
            }`}
      </p>

      {/* Table */}
      {pageSlice.length === 0 && !loading ? (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <p className="text-muted-foreground">No participants match the current filters.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <SortableHead
                    label="Name"
                    field="name"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                </TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="w-20">Gender</TableHead>
                <TableHead>
                  <SortableHead
                    label="Sub-group"
                    field="subGroup"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                </TableHead>
                <TableHead>Room type</TableHead>
                <TableHead>
                  <SortableHead
                    label="Fee status"
                    field="feeStatus"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                </TableHead>
                <TableHead className="w-28">Check-in</TableHead>
                <TableHead className="w-28">Room</TableHead>
                <TableHead>Tags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageSlice.map((p) => (
                <TableRow
                  key={p.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setSelectedId(p.id)}
                >
                  <TableCell className="font-medium">
                    {p.fullName}
                    {p.registrationState === 'CANCELLED' && (
                      <Badge variant="destructive" className="ml-2 text-xs">
                        Cancelled
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.phone}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{p.gender}</Badge>
                  </TableCell>
                  <TableCell>{p.subGroupName}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.roomTypePreferenceName}
                  </TableCell>
                  <TableCell>
                    <FeeStatusCell p={p} currency={currency} />
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={p.checkInState === 'ARRIVED' ? 'default' : 'secondary'}
                    >
                      {p.checkInState === 'ARRIVED' ? 'Arrived' : 'Not arrived'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.roomNumber ? `Room ${p.roomNumber}` : '—'}
                  </TableCell>
                  <TableCell>
                    <TagsCell tags={p.tags ?? []} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {((page - 1) * PAGE_SIZE + 1).toLocaleString()}–
            {Math.min(page * PAGE_SIZE, filtered.length).toLocaleString()} of{' '}
            {filtered.length.toLocaleString()}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      <DetailDrawer
        participant={selectedParticipant}
        currency={currency}
        onClose={() => setSelectedId(null)}
        onMutated={refresh}
      />
    </div>
  )
}
