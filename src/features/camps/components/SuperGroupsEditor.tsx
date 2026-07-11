import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { getAuth } from 'firebase/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { saveSuperGroups } from '../services/campService'
import type { SuperGroup } from '../types'

interface Props {
  campId: string
  superGroups: SuperGroup[]
  onChange: (updated: SuperGroup[]) => void
}

function currentUid() {
  const user = getAuth().currentUser
  return user?.email ?? user?.uid ?? 'admin'
}

export function SuperGroupsEditor({ campId, superGroups, onChange }: Props) {
  const [dialog, setDialog] = useState<{ mode: 'add' | 'edit'; target?: SuperGroup } | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function openAdd() {
    setName('')
    setError('')
    setDialog({ mode: 'add' })
  }

  function openEdit(sg: SuperGroup) {
    setName(sg.name)
    setError('')
    setDialog({ mode: 'edit', target: sg })
  }

  async function persistList(updated: SuperGroup[]) {
    setSaving(true)
    setError('')
    try {
      await saveSuperGroups(campId, updated, currentUid())
      onChange(updated)
      setDialog(null)
    } catch {
      setError('Failed to save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) { setError('Name is required.'); return }
    if (dialog?.mode === 'add') {
      if (superGroups.some((sg) => sg.name.toLowerCase() === trimmed.toLowerCase())) {
        setError('A super-group with that name already exists.')
        return
      }
      await persistList([...superGroups, { id: crypto.randomUUID(), name: trimmed }])
    } else if (dialog?.mode === 'edit' && dialog.target) {
      await persistList(
        superGroups.map((sg) => sg.id === dialog.target!.id ? { ...sg, name: trimmed } : sg),
      )
    }
  }

  async function handleDelete(id: string) {
    setSaving(true)
    try {
      const updated = superGroups.filter((sg) => sg.id !== id)
      await saveSuperGroups(campId, updated, currentUid())
      onChange(updated)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Optional rollup containers for grouping sub-groups in the dashboard.
        </p>

        {superGroups.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">None defined yet.</p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-xl border">
            {superGroups.map((sg) => (
              <li key={sg.id} className="flex items-stretch">
                {/* Tappable main area */}
                <button
                  className="flex flex-1 items-center px-4 py-3.5 text-left transition-colors hover:bg-muted/40 disabled:opacity-50"
                  onClick={() => openEdit(sg)}
                  disabled={saving}
                >
                  <span className="text-sm font-medium">{sg.name}</span>
                </button>
                {/* Delete — sibling, not nested inside the tappable button */}
                <button
                  className="flex items-center border-l px-3.5 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-destructive disabled:opacity-40"
                  onClick={() => handleDelete(sg.id)}
                  disabled={saving}
                  aria-label="Remove"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <Button variant="outline" onClick={openAdd} disabled={saving} className="w-full sm:w-auto">
          <Plus className="h-4 w-4" />
          Add super-group
        </Button>
      </div>

      <Dialog open={!!dialog} onOpenChange={(open) => { if (!open && !saving) setDialog(null) }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === 'add' ? 'New super-group' : 'Rename super-group'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="sg-name">Name</Label>
            <Input
              id="sg-name"
              autoFocus
              value={name}
              onChange={(e) => { setName(e.target.value); setError('') }}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="e.g. Youth"
            />
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
