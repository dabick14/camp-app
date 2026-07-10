import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { getAuth } from 'firebase/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { saveSuperGroups } from '../services/campService'
import type { SuperGroup } from '../types'

interface Props {
  campId: string
  superGroups: SuperGroup[]
  onChange: (updated: SuperGroup[]) => void
}

function uid() {
  const user = getAuth().currentUser
  return user?.email ?? user?.uid ?? 'admin'
}

export function SuperGroupsEditor({ campId, superGroups, onChange }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function persist(updated: SuperGroup[]) {
    setSaving(true)
    setError('')
    try {
      await saveSuperGroups(campId, updated, uid())
      onChange(updated)
    } catch {
      setError('Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  async function handleAdd() {
    const name = newName.trim()
    if (!name) return
    if (superGroups.some((sg) => sg.name.toLowerCase() === name.toLowerCase())) {
      setError('A super-group with that name already exists.')
      return
    }
    await persist([...superGroups, { id: crypto.randomUUID(), name }])
    setNewName('')
  }

  async function handleRename() {
    if (!editingId || !editName.trim()) return
    await persist(superGroups.map((sg) => (sg.id === editingId ? { ...sg, name: editName.trim() } : sg)))
    setEditingId(null)
  }

  function startEdit(sg: SuperGroup) {
    setEditingId(sg.id)
    setEditName(sg.name)
    setError('')
  }

  return (
    <div className="space-y-3">
      {superGroups.length === 0 && (
        <p className="text-sm text-muted-foreground">No super-groups defined.</p>
      )}

      {superGroups.length > 0 && (
        <ul className="divide-y rounded-md border">
          {superGroups.map((sg) => (
            <li key={sg.id} className="flex items-center gap-2 px-3 py-2">
              {editingId === sg.id ? (
                <Input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRename()
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="h-7 flex-1 text-sm"
                />
              ) : (
                <span className="flex-1 text-sm">{sg.name}</span>
              )}

              <div className="flex shrink-0 items-center gap-1">
                {editingId === sg.id ? (
                  <>
                    <Button size="sm" variant="outline" onClick={handleRename} disabled={saving} className="h-7 px-2 text-xs">
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} className="h-7 px-2 text-xs">
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => startEdit(sg)} disabled={saving} className="h-7 w-7 p-0" aria-label="Rename">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => persist(superGroups.filter((s) => s.id !== sg.id))}
                      disabled={saving}
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      aria-label="Remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <Input
          value={newName}
          onChange={(e) => { setNewName(e.target.value); setError('') }}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="New super-group name"
          className="max-w-xs"
          disabled={saving}
        />
        <Button variant="outline" onClick={handleAdd} disabled={saving || !newName.trim()}>
          Add
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
