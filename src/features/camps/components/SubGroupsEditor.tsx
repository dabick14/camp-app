import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Pencil } from 'lucide-react'
import { Timestamp } from 'firebase/firestore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    listSubGroups(campId).then((data) => {
      if (!cancelled) {
        setGroups(data)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [campId])

  useEffect(() => {
    if (editingId) editInputRef.current?.focus()
  }, [editingId])

  async function startEdit(g: SubGroup) {
    setEditingId(g.id)
    setEditName(g.name)
  }

  async function saveEdit() {
    if (!editingId || !editName.trim()) return
    setSaving(true)
    try {
      await updateSubGroup(campId, editingId, { name: editName.trim() })
      setGroups(groups.map((g) => (g.id === editingId ? { ...g, name: editName.trim() } : g)))
      setEditingId(null)
    } finally {
      setSaving(false)
    }
  }

  function cancelEdit() {
    setEditingId(null)
    setEditName('')
  }

  async function move(index: number, direction: -1 | 1) {
    const newGroups = [...groups]
    const target = index + direction
    ;[newGroups[index], newGroups[target]] = [newGroups[target], newGroups[index]]
    setGroups(newGroups)
    await reorderSubGroups(campId, newGroups.map((g) => g.id))
  }

  async function add() {
    const name = newName.trim()
    if (!name) return
    setError('')
    setSaving(true)
    try {
      const now = Timestamp.now()
      const id = await createSubGroup(campId, name, groups.length)
      setGroups([...groups, { id, name, order: groups.length, createdAt: now, updatedAt: now }])
      setNewName('')
    } catch {
      setError('Failed to add sub-group.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSuperGroupChange(subGroupId: string, superGroupId: string) {
    setSaving(true)
    try {
      if (superGroupId === '') {
        await updateSubGroup(campId, subGroupId, { superGroupId: null, superGroupName: null })
        setGroups(groups.map((g) => g.id === subGroupId ? { ...g, superGroupId: undefined, superGroupName: undefined } : g))
      } else {
        const sg = campSuperGroups.find((s) => s.id === superGroupId)
        if (!sg) return
        await updateSubGroup(campId, subGroupId, { superGroupId: sg.id, superGroupName: sg.name })
        setGroups(groups.map((g) => g.id === subGroupId ? { ...g, superGroupId: sg.id, superGroupName: sg.name } : g))
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>

  return (
    <div className="space-y-3">
      {groups.length === 0 && (
        <p className="text-sm text-muted-foreground">No sub-groups yet.</p>
      )}

      <ul className="divide-y rounded-md border">
        {groups.map((g, i) => {
          // Treat a dangling superGroupId (super-group was removed) as unassigned
          const pickerValue = g.superGroupId && campSuperGroups.some((s) => s.id === g.superGroupId)
            ? g.superGroupId
            : ''

          return (
            <li key={g.id} className="flex items-center gap-2 px-3 py-2">
              <span className="w-5 text-center text-xs text-muted-foreground">{i + 1}</span>

              {editingId === g.id ? (
                <Input
                  ref={editInputRef}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit()
                    if (e.key === 'Escape') cancelEdit()
                  }}
                  className="h-7 flex-1 text-sm"
                />
              ) : (
                <span className="flex-1 text-sm">{g.name}</span>
              )}

              {campSuperGroups.length > 0 && editingId !== g.id && (
                <Select
                  value={pickerValue}
                  onValueChange={(val) => handleSuperGroupChange(g.id, val)}
                  disabled={saving}
                >
                  <SelectTrigger className="h-7 w-36 text-xs">
                    <SelectValue placeholder="No super-group" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {campSuperGroups.map((sg) => (
                      <SelectItem key={sg.id} value={sg.id}>{sg.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <div className="flex shrink-0 items-center gap-1">
                {editingId === g.id ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={saveEdit}
                      disabled={saving}
                      className="h-7 px-2 text-xs"
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={cancelEdit}
                      className="h-7 px-2 text-xs"
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => startEdit(g)}
                    className="h-7 w-7 p-0"
                    aria-label="Edit name"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="h-7 w-7 p-0"
                  aria-label="Move up"
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => move(i, 1)}
                  disabled={i === groups.length - 1}
                  className="h-7 w-7 p-0"
                  aria-label="Move down"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </div>
            </li>
          )
        })}
      </ul>

      <div className="flex gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="New sub-group name"
          className="max-w-xs"
        />
        <Button variant="outline" onClick={add} disabled={saving || !newName.trim()}>
          Add
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
