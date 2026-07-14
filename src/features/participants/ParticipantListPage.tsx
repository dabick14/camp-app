import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Plus, Search, SlidersHorizontal, X } from 'lucide-react'
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
import { PageError } from '@/components/ui/states'
import { PageContainer } from '@/components/ui/page-container'
import { buildSubGroupSections } from '@/features/camps/components/SubGroupSelect'
import type { SubGroup, SuperGroup } from '@/features/camps/types'
import { useCampData } from '@/features/camp-layout/CampDataContext'
import { type Participant, type PaymentState, derivePaymentState } from './types'
import { DetailDrawer } from './components/DetailDrawer'
import { PageTitle } from '@/components/ui/page-title'

// ─── helpers ──────────────────────────────────────────────────────────────────

type SortField = 'name' | 'subGroup' | 'feeStatus'

const PAYMENT_STATE_ORDER: Record<PaymentState, number> = {
  PAID: 0,
  WAIVED: 1,
  PARTIAL: 2,
  PENDING: 3,
}

const PAGE_SIZE = 50

// ─── sub-components ───────────────────────────────────────────────────────────

/**
 * Generic multi-select filter pill — used for Payment, Check-in, Room type, Tags.
 */
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

/**
 * Multi-select sub-group filter with:
 *  - text search (matches anywhere in name, case-insensitive)
 *  - grouped sections per super-group (section-header checkbox selects the whole group)
 *  - flat list when no super-groups are defined
 */
function SubGroupFilterDropdown({
  subGroups,
  superGroups,
  selected,
  onChange,
}: {
  subGroups: SubGroup[]
  superGroups: SuperGroup[]
  selected: string[]
  onChange: (v: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [])

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => searchRef.current?.focus(), 0)
      return () => clearTimeout(t)
    }
  }, [open])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); e.stopPropagation() }
  }

  const q = search.trim().toLowerCase()
  const hasSuperGroups = superGroups.length > 0

  const sections = useMemo(() => {
    if (hasSuperGroups) return buildSubGroupSections(subGroups, superGroups, q)
    const items = q ? subGroups.filter((sg) => sg.name.toLowerCase().includes(q)) : subGroups
    return items.length > 0 ? [{ id: '__flat__', name: '', items }] : []
  }, [subGroups, superGroups, q, hasSuperGroups])

  function toggleOne(id: string) {
    onChange(selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id])
  }

  function toggleGroup(ids: string[]) {
    const allIn = ids.every((id) => selected.includes(id))
    if (allIn) {
      onChange(selected.filter((id) => !ids.includes(id)))
    } else {
      const toAdd = ids.filter((id) => !selected.includes(id))
      onChange([...selected, ...toAdd])
    }
  }

  const active = selected.length > 0

  return (
    <div className="relative" ref={ref} onKeyDown={handleKeyDown}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
          active
            ? 'border-primary bg-primary/5 font-medium text-primary'
            : 'border-input bg-background text-muted-foreground hover:text-foreground'
        }`}
      >
        {active ? `Sub-group (${selected.length})` : 'Sub-group'}
        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-md border bg-background shadow-lg">
          {/* Search */}
          <div className="border-b p-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search sub-groups…"
                className="w-full rounded-sm border border-input bg-transparent py-1.5 pl-7 pr-2 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* Options */}
          <div className="max-h-64 overflow-y-auto py-1">
            {sections.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">No sub-groups match</p>
            ) : sections.map((section) => {
              const groupIds = section.items.map((sg) => sg.id)
              const allChecked = groupIds.every((id) => selected.includes(id))
              const someChecked = groupIds.some((id) => selected.includes(id))

              return (
                <div key={section.id}>
                  {/* Section header (only when super-groups exist) */}
                  {hasSuperGroups && (
                    <label className="flex cursor-pointer items-center gap-2 bg-muted/50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked }}
                        onChange={() => toggleGroup(groupIds)}
                        className="h-3.5 w-3.5"
                      />
                      {section.name}
                    </label>
                  )}
                  {section.items.map((sg) => (
                    <label
                      key={sg.id}
                      className={`flex cursor-pointer items-center gap-2.5 py-1.5 text-sm hover:bg-muted ${
                        hasSuperGroups ? 'px-3 pl-8' : 'px-3'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(sg.id)}
                        onChange={() => toggleOne(sg.id)}
                        className="h-3.5 w-3.5"
                      />
                      {sg.name}
                    </label>
                  ))}
                </div>
              )
            })}
          </div>

          {/* Clear footer */}
          {selected.length > 0 && (
            <div className="border-t px-3 py-1.5">
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear selection
              </button>
            </div>
          )}
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

const PS_LABELS: Record<PaymentState, string> = {
  PAID: 'Paid', PARTIAL: 'Partial', PENDING: 'Pending', WAIVED: 'Waived',
}

function FeeStatusCell({ p, currency }: { p: Participant; currency: string }) {
  const ps = derivePaymentState(p)
  return (
    <div className="flex items-center gap-2">
      <span className="tabular-nums text-sm text-muted-foreground">
        {currency} {p.amountPaid.toLocaleString()}/{p.feeOwed.toLocaleString()}
      </span>
      <Badge variant={ps.toLowerCase() as 'paid' | 'partial' | 'pending' | 'waived'}>
        {PS_LABELS[ps]}
      </Badge>
    </div>
  )
}

function TagsCell({ tags }: { tags: string[] }) {
  const visible = tags.slice(0, 2)
  const extra = tags.length - 2
  if (tags.length === 0) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((tag, i) => (
        <span
          key={`${tag}-${i}`}
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
  const { camp, participants, subGroups, roomTypes, loading, error, participantsLoading, participantsError, refresh } = useCampData()
  const superGroups: SuperGroup[] = camp?.superGroups ?? []
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

  // ─── mobile filter sheet ────────────────────────────────────────────────────
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)
  const [sheetSgSearch, setSheetSgSearch] = useState('')

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

  // Count of active filter categories for the mobile badge (search excluded — always visible)
  const activeFilterCount =
    (filterSubGroups.length > 0 ? 1 : 0) +
    (filterPaymentStates.length > 0 ? 1 : 0) +
    (filterCheckInStates.length > 0 ? 1 : 0) +
    (filterRoomTypes.length > 0 ? 1 : 0) +
    (filterTags.length > 0 ? 1 : 0) +
    (hasRoom !== 'all' ? 1 : 0) +
    (showCancelled ? 1 : 0)

  // Sub-group sections for the mobile filter sheet (inline, not inside a dropdown)
  const sheetSgSections = useMemo(() => {
    const q = sheetSgSearch.trim().toLowerCase()
    if (superGroups.length > 0) return buildSubGroupSections(subGroups, superGroups, q)
    const items = q ? subGroups.filter((sg) => sg.name.toLowerCase().includes(q)) : subGroups
    return items.length > 0 ? [{ id: '__flat__', name: '', items }] : []
  }, [subGroups, superGroups, sheetSgSearch])

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
  if (error) {
    return (
      <PageContainer>
        <PageError message={error} onRetry={refresh} />
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageTitle className="mb-4">Participants</PageTitle>

      {/* ── Mobile action bar (sm:hidden) ─────────────────────────────────── */}
      <div className="mb-4 flex flex-col gap-2 sm:hidden">
        {/* Row 1: Search */}
        <div className="relative">
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
        {/* Row 2: Filters button + Add participant */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setFilterSheetOpen(true)}
            className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
              activeFilterCount > 0
                ? 'border-primary bg-primary/5 font-medium text-primary'
                : 'border-input bg-background text-muted-foreground'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
            {activeFilterCount > 0 ? `Filters · ${activeFilterCount}` : 'Filters'}
          </button>
          <Button size="sm" onClick={() => navigate('participants/new')}>
            <Plus className="h-4 w-4" />
            Add participant
          </Button>
        </div>
      </div>

      {/* ── Desktop action bar (hidden sm:flex) ───────────────────────────── */}
      <div className="mb-4 hidden flex-wrap items-start justify-between gap-x-2 gap-y-3 sm:flex">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
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

          <SubGroupFilterDropdown
            subGroups={subGroups}
            superGroups={superGroups}
            selected={filterSubGroups}
            onChange={(v) => { setFilterSubGroups(v); setPage(1) }}
          />
          <FilterDropdown
            label="Payment"
            options={psOptions}
            selected={filterPaymentStates}
            onChange={(v) => { setFilterPaymentStates(v as PaymentState[]); setPage(1) }}
          />
          <FilterDropdown
            label="Check-in"
            options={ciOptions}
            selected={filterCheckInStates}
            onChange={(v) => { setFilterCheckInStates(v); setPage(1) }}
          />
          <FilterDropdown
            label="Room type"
            options={rtOptions}
            selected={filterRoomTypes}
            onChange={(v) => { setFilterRoomTypes(v); setPage(1) }}
          />
          {tagOptions.length > 0 && (
            <FilterDropdown
              label="Tags"
              options={tagOptions}
              selected={filterTags}
              onChange={(v) => { setFilterTags(v); setPage(1) }}
            />
          )}

          {/* Has-room toggle */}
          <div className="flex overflow-hidden rounded-md border border-input text-sm">
            {(['all', 'assigned', 'unassigned'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => { setHasRoom(v); setPage(1) }}
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
        <Button size="sm" className="shrink-0" onClick={() => navigate('participants/new')}>
          <Plus className="h-4 w-4" />
          Add participant
        </Button>
      </div>

      {/* ── Mobile filter sheet ───────────────────────────────────────────── */}
      {filterSheetOpen && (
        <div className="fixed inset-0 z-40 sm:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setFilterSheetOpen(false)}
          />
          {/* Sheet panel */}
          <div className="absolute inset-x-0 bottom-0 max-h-[90vh] overflow-y-auto rounded-t-2xl bg-background shadow-2xl">
            {/* Drag handle */}
            <div className="mx-auto mb-1 mt-3 h-1 w-10 rounded-full bg-muted-foreground/25" />

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3">
              <h2 className="text-base font-semibold">Filters</h2>
              <button
                type="button"
                onClick={() => setFilterSheetOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-5 px-4 pb-8">

              {/* Sub-group */}
              <section>
                <p className="mb-2 text-sm font-semibold">Sub-group</p>
                <div className="relative mb-2">
                  <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={sheetSgSearch}
                    onChange={(e) => setSheetSgSearch(e.target.value)}
                    placeholder="Search sub-groups…"
                    className="w-full rounded-md border border-input bg-background py-1.5 pl-7 pr-2 text-sm outline-none focus:border-primary"
                  />
                </div>
                <div className="max-h-40 overflow-y-auto rounded-md border divide-y">
                  {sheetSgSections.length === 0 ? (
                    <p className="px-3 py-3 text-center text-xs text-muted-foreground">No sub-groups match</p>
                  ) : sheetSgSections.map((section) => (
                    <div key={section.id}>
                      {superGroups.length > 0 && section.name && (
                        <label className="flex cursor-pointer items-center gap-2 bg-muted/50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={section.items.every((sg) => filterSubGroups.includes(sg.id))}
                            ref={(el) => {
                              if (el) {
                                const someChecked = section.items.some((sg) => filterSubGroups.includes(sg.id))
                                const allChecked = section.items.every((sg) => filterSubGroups.includes(sg.id))
                                el.indeterminate = someChecked && !allChecked
                              }
                            }}
                            onChange={() => {
                              const ids = section.items.map((sg) => sg.id)
                              const allIn = ids.every((id) => filterSubGroups.includes(id))
                              setFilterSubGroups(
                                allIn
                                  ? filterSubGroups.filter((id) => !ids.includes(id))
                                  : [...filterSubGroups, ...ids.filter((id) => !filterSubGroups.includes(id))]
                              )
                              setPage(1)
                            }}
                            className="h-3.5 w-3.5"
                          />
                          {section.name}
                        </label>
                      )}
                      {section.items.map((sg) => (
                        <label
                          key={sg.id}
                          className={`flex cursor-pointer items-center gap-2.5 py-2 text-sm hover:bg-muted ${
                            superGroups.length > 0 ? 'px-3 pl-8' : 'px-3'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={filterSubGroups.includes(sg.id)}
                            onChange={() => {
                              setFilterSubGroups(
                                filterSubGroups.includes(sg.id)
                                  ? filterSubGroups.filter((id) => id !== sg.id)
                                  : [...filterSubGroups, sg.id]
                              )
                              setPage(1)
                            }}
                            className="h-3.5 w-3.5"
                          />
                          {sg.name}
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </section>

              {/* Payment */}
              <section>
                <p className="mb-2 text-sm font-semibold">Payment</p>
                <div className="space-y-1">
                  {psOptions.map((opt) => (
                    <label key={opt.value} className="flex cursor-pointer items-center gap-2.5 py-1 text-sm">
                      <input
                        type="checkbox"
                        checked={filterPaymentStates.includes(opt.value as PaymentState)}
                        onChange={() => {
                          setFilterPaymentStates(
                            filterPaymentStates.includes(opt.value as PaymentState)
                              ? filterPaymentStates.filter((v) => v !== opt.value)
                              : [...filterPaymentStates, opt.value as PaymentState]
                          )
                          setPage(1)
                        }}
                        className="h-3.5 w-3.5"
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </section>

              {/* Check-in */}
              <section>
                <p className="mb-2 text-sm font-semibold">Check-in</p>
                <div className="space-y-1">
                  {ciOptions.map((opt) => (
                    <label key={opt.value} className="flex cursor-pointer items-center gap-2.5 py-1 text-sm">
                      <input
                        type="checkbox"
                        checked={filterCheckInStates.includes(opt.value)}
                        onChange={() => {
                          setFilterCheckInStates(
                            filterCheckInStates.includes(opt.value)
                              ? filterCheckInStates.filter((v) => v !== opt.value)
                              : [...filterCheckInStates, opt.value]
                          )
                          setPage(1)
                        }}
                        className="h-3.5 w-3.5"
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </section>

              {/* Room type */}
              {rtOptions.length > 0 && (
                <section>
                  <p className="mb-2 text-sm font-semibold">Room type</p>
                  <div className="space-y-1">
                    {rtOptions.map((opt) => (
                      <label key={opt.value} className="flex cursor-pointer items-center gap-2.5 py-1 text-sm">
                        <input
                          type="checkbox"
                          checked={filterRoomTypes.includes(opt.value)}
                          onChange={() => {
                            setFilterRoomTypes(
                              filterRoomTypes.includes(opt.value)
                                ? filterRoomTypes.filter((v) => v !== opt.value)
                                : [...filterRoomTypes, opt.value]
                            )
                            setPage(1)
                          }}
                          className="h-3.5 w-3.5"
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </section>
              )}

              {/* Tags */}
              {tagOptions.length > 0 && (
                <section>
                  <p className="mb-2 text-sm font-semibold">Tags</p>
                  <div className="space-y-1">
                    {tagOptions.map((opt) => (
                      <label key={opt.value} className="flex cursor-pointer items-center gap-2.5 py-1 text-sm">
                        <input
                          type="checkbox"
                          checked={filterTags.includes(opt.value)}
                          onChange={() => {
                            setFilterTags(
                              filterTags.includes(opt.value)
                                ? filterTags.filter((v) => v !== opt.value)
                                : [...filterTags, opt.value]
                            )
                            setPage(1)
                          }}
                          className="h-3.5 w-3.5"
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </section>
              )}

              {/* Room assignment */}
              <section>
                <p className="mb-2 text-sm font-semibold">Room assignment</p>
                <div className="flex overflow-hidden rounded-md border border-input text-sm">
                  {(['all', 'assigned', 'unassigned'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => { setHasRoom(v); setPage(1) }}
                      className={`flex-1 px-3 py-2 transition-colors ${
                        hasRoom === v
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-background text-muted-foreground'
                      }`}
                    >
                      {v === 'all' ? 'All' : v === 'assigned' ? 'Has room' : 'No room'}
                    </button>
                  ))}
                </div>
              </section>

              {/* Show cancelled */}
              <section>
                <label className="flex cursor-pointer items-center justify-between">
                  <span className="text-sm font-semibold">Show cancelled</span>
                  <button
                    type="button"
                    onClick={() => setShowCancelled((s) => !s)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      showCancelled ? 'bg-primary' : 'bg-muted-foreground/30'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                        showCancelled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </label>
              </section>

              {/* Clear all */}
              {activeFilterCount > 0 && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => { clearFilters(); setFilterSheetOpen(false) }}
                >
                  Clear all filters
                </Button>
              )}

            </div>
          </div>
        </div>
      )}

      {/* Participant load error (non-blocking — shell still usable) */}
      {participantsError && !participantsLoading && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <span>Couldn't load all participants.</span>
          <button type="button" onClick={refresh} className="underline hover:no-underline">
            Retry
          </button>
        </div>
      )}

      {/* Result count */}
      <p className="mb-3 text-sm text-muted-foreground">
        {loading || (participantsLoading && participants.length === 0)
          ? 'Loading…'
          : <>
              {filtered.length.toLocaleString()} participant{filtered.length !== 1 ? 's' : ''}
              {filtered.length !== participants.length && ` (${participants.length.toLocaleString()} total)`}
              {participantsLoading && <span className="opacity-60"> · loading more…</span>}
            </>
        }
      </p>

      {/* Table */}
      {pageSlice.length === 0 && !loading && !(participantsLoading && participants.length === 0) ? (
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
                    {p.checkInState === 'ARRIVED' ? (
                      <Badge className="bg-status-paid-bg text-status-paid border-transparent">Arrived</Badge>
                    ) : (
                      <Badge variant="outline">Not arrived</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <span className="flex items-center gap-1">
                      {p.roomNumber ? `Room ${p.roomNumber}` : '—'}
                      {p.roomedWithoutFullPayment && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                          <AlertTriangle className="h-3 w-3" />
                          Override
                        </span>
                      )}
                    </span>
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
    </PageContainer>
  )
}
