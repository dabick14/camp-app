import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import type { SubGroup, SuperGroup } from '../types'

// ─── shared section builder ───────────────────────────────────────────────────

export interface SubGroupSection {
  id: string
  name: string
  items: SubGroup[]
}

/**
 * Groups sub-groups under their super-group in the order super-groups are
 * defined. Sub-groups with no superGroupId, or with a dangling superGroupId
 * (super-group deleted), fall into the "Unassigned" section.
 * Pass q (lower-cased search query) to pre-filter items.
 */
export function buildSubGroupSections(
  subGroups: SubGroup[],
  superGroups: SuperGroup[],
  q = '',
): SubGroupSection[] {
  const knownIds = new Set(superGroups.map((s) => s.id))
  const buckets = new Map<string, SubGroup[]>()
  const unassigned: SubGroup[] = []

  for (const sg of subGroups) {
    if (sg.superGroupId && knownIds.has(sg.superGroupId)) {
      const arr = buckets.get(sg.superGroupId) ?? []
      arr.push(sg)
      buckets.set(sg.superGroupId, arr)
    } else {
      unassigned.push(sg)
    }
  }

  const sections: SubGroupSection[] = []

  for (const sup of superGroups) {
    const items = (buckets.get(sup.id) ?? []).filter(
      (sg) => !q || sg.name.toLowerCase().includes(q),
    )
    if (items.length > 0) sections.push({ id: sup.id, name: sup.name, items })
  }

  const unassignedFiltered = unassigned.filter(
    (sg) => !q || sg.name.toLowerCase().includes(q),
  )
  if (unassignedFiltered.length > 0) {
    sections.push({ id: '__unassigned__', name: 'Unassigned', items: unassignedFiltered })
  }

  return sections
}

// ─── single-select combobox ───────────────────────────────────────────────────

interface SubGroupSelectProps {
  subGroups: SubGroup[]
  superGroups: SuperGroup[]
  value: string         // '' = nothing selected
  onChange: (id: string) => void
  placeholder?: string  // shown when value is ''
  noneLabel?: string    // if set, shows an explicit "all / none" first row
  className?: string
}

export function SubGroupSelect({
  subGroups,
  superGroups,
  value,
  onChange,
  placeholder = 'Select a sub-group…',
  noneLabel,
  className = '',
}: SubGroupSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onOut(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
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

  function select(id: string) {
    onChange(id)
    setOpen(false)
    setSearch('')
  }

  const selected = subGroups.find((sg) => sg.id === value)
  const q = search.trim().toLowerCase()
  const hasSuperGroups = superGroups.length > 0

  const sections = hasSuperGroups
    ? buildSubGroupSections(subGroups, superGroups, q)
    : null
  const flat = !hasSuperGroups
    ? subGroups.filter((sg) => !q || sg.name.toLowerCase().includes(q))
    : null

  const hasResults = hasSuperGroups
    ? (sections?.length ?? 0) > 0
    : (flat?.length ?? 0) > 0

  return (
    <div className={`relative ${className}`} ref={ref} onKeyDown={handleKeyDown}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className={`truncate ${selected ? 'text-foreground' : 'text-muted-foreground'}`}>
          {selected ? selected.name : (noneLabel ?? placeholder)}
        </span>
        <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-full min-w-[220px] rounded-md border bg-background shadow-lg">
          {/* Search */}
          <div className="border-b p-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="w-full rounded-sm border border-input bg-transparent py-1.5 pl-7 pr-2 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* Options */}
          <div className="max-h-60 overflow-y-auto py-1">
            {/* All / none row */}
            {noneLabel && !q && (
              <button
                type="button"
                onClick={() => select('')}
                className={`flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-sm hover:bg-muted ${
                  !value ? 'font-medium text-primary' : 'text-foreground'
                }`}
              >
                {!value && <Check className="h-3.5 w-3.5 shrink-0" />}
                {noneLabel}
              </button>
            )}

            {!hasResults ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">No results</p>
            ) : hasSuperGroups ? (
              sections!.map((section) => (
                <div key={section.id}>
                  <div className="bg-muted/50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {section.name}
                  </div>
                  {section.items.map((sg) => (
                    <button
                      key={sg.id}
                      type="button"
                      onClick={() => select(sg.id)}
                      className={`flex w-full items-center gap-1.5 py-1.5 pl-6 pr-3 text-left text-sm hover:bg-muted ${
                        sg.id === value ? 'font-medium text-primary' : 'text-foreground'
                      }`}
                    >
                      {sg.id === value && <Check className="h-3.5 w-3.5 shrink-0" />}
                      {sg.name}
                    </button>
                  ))}
                </div>
              ))
            ) : (
              flat!.map((sg) => (
                <button
                  key={sg.id}
                  type="button"
                  onClick={() => select(sg.id)}
                  className={`flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-sm hover:bg-muted ${
                    sg.id === value ? 'font-medium text-primary' : 'text-foreground'
                  }`}
                >
                  {sg.id === value && <Check className="h-3.5 w-3.5 shrink-0" />}
                  {sg.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
