import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Plus } from 'lucide-react'
import { Timestamp } from 'firebase/firestore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  createSubGroup,
  listSubGroups,
  reorderSubGroups,
  updateSubGroup,
} from '../services/subGroupService'
import type { SubGroup, SuperGroup } from '../types'

interface SubGroupsEditorProps {
  campId: string
  campSuperGroups?: SuperGroup[]
}

export function SubGroupsEditor({ campId, campSuperGroups = [] }: SubGroupsEditorProps) {
  const [groups, setGroups] = useState<SubGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<{ mode: 'add' | 'edit'; target?: SubGroup } | null>(null)
  const [name, setName] = useState('')
  const [superGroupId, setSuperGroupId] = useState('__none__')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    listSubGroups(campId).then((data) => {
      if (!cancelled) { setGroups(data); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [campId])

  function openAdd() {
    setName('')
    setSuperGroupId('__none__')
    setError('')
    setDialog({ mode: 'add' })
  }

  function openEdit(g: SubGroup) {
    setName(g.name)
    setSuperGroupId(g.superGroupId ?? '__none__')
    setError('')
    setDialog({ mode: 'edit', target: g })
  }

  async function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) { setError('Name is required.'); return }
    setSaving(true)
    setError('')
    try {
      if (dialog?.mode === 'add') {
        const now = Timestamp.now()
        const id = await createSubGroup(campId, trimmed, groups.length)
        setGroups([...groups, { id, name: trimmed, order: groups.length, createdAt: now, updatedAt: now }])
      } else if (dialog?.mode === 'edit' && dialog.target) {
        const sgId = superGroupId === '__none__' ? null : superGroupId
        const sg = sgId ? (campSuperGroups.find((s) => s.id === sgId) ?? null) : null
        await updateSubGroup(campId, dialog.target.id, {
          name: trimmed,
          superGroupId: sgId,
          superGroupName: sg?.name ?? null,
        })
        setGroups(groups.map((g) =>
          g.id === dialog.target!.id
            ? { ...g, name: trimmed, superGroupId: sgId ?? undefined, superGroupName: sg?.name ?? undefined }
            : g,
        ))
      }
      setDialog(null)
    } catch {
      setError('Failed to save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  async function move(index: number, direction: -1 | 1) {
    const next = [...groups]
    const target = index + direction
    ;[next[index], next[target]] = [next[target], next[index]]
    setGroups(next)
    await reorderSubGroups(campId, next.map((g) => g.id))
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>

  return (
    <>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Registrants pick exactly one. To retire a sub-group, rename it rather than deleting.
        </p>

        {groups.length === 0 && (
          <p className="text-sm italic text-muted-foreground">No sub-groups yet.</p>
        )}

        {groups.length > 0 && (
          <ul className="divide-y overflow-hidden rounded-xl border">
            {groups.map((g, i) => {
              const superGroup = g.superGroupId
                ? campSuperGroups.find((s) => s.id === g.superGroupId)
                : undefined

              return (
                <li key={g.id} className="flex items-stretch">
                  {/* Tappable main area */}
                  <button
                    className="flex flex-1 items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/40 disabled:opacity-50"
                    onClick={() => openEdit(g)}
                    disabled={saving}
                  >
                    <span className="w-5 shrink-0 text-center text-xs text-muted-foreground">{i + 1}</span>
                    <span className="flex-1 text-sm font-medium">{g.name}</span>
                    {superGroup && (
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {superGroup.name}
                      </span>
                    )}
                  </button>
                  {/* Reorder — sibling, not nested inside the tappable button */}
                  <div className="flex shrink-0 items-stretch border-l">
                    <button
                      onClick={() => move(i, -1)}
                      disabled={saving || i === 0}
                      className="flex items-center px-2.5 text-muted-foreground transition-colors hover:bg-muted/40 disabled:opacity-30"
                      aria-label="Move up"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => move(i, 1)}
                      disabled={saving || i === groups.length - 1}
                      className="flex items-center border-l px-2.5 text-muted-foreground transition-colors hover:bg-muted/40 disabled:opacity-30"
                      aria-label="Move down"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <Button variant="outline" onClick={openAdd} disabled={saving} className="w-full sm:w-auto">
          <Plus className="h-4 w-4" />
          Add sub-group
        </Button>
      </div>

      <Dialog open={!!dialog} onOpenChange={(open) => { if (!open && !saving) setDialog(null) }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === 'add' ? 'New sub-group' : 'Edit sub-group'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="subg-name">Name</Label>
              <Input
                id="subg-name"
                autoFocus
                value={name}
                onChange={(e) => { setName(e.target.value); setError('') }}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                placeholder="e.g. Youth Council"
              />
            </div>
            {dialog?.mode === 'edit' && campSuperGroups.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="subg-sg">Super-group</Label>
                <Select value={superGroupId} onValueChange={setSuperGroupId}>
                  <SelectTrigger id="subg-sg">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {campSuperGroups.map((sg) => (
                      <SelectItem key={sg.id} value={sg.id}>{sg.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !name.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
