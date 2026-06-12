import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Pencil } from 'lucide-react'
import { Timestamp } from 'firebase/firestore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  createRoomType,
  listRoomTypes,
  reorderRoomTypes,
  updateRoomType,
} from '../services/roomTypeService'
import type { RoomType } from '../types'

interface EditState {
  id: string
  name: string
  price: number | ''
  defaultCapacity: number | ''
  allowOverbook: boolean
}

export function RoomTypesEditor({ campId, currency = 'GHS' }: { campId: string; currency?: string }) {
  const [types, setTypes] = useState<RoomType[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<EditState | null>(null)
  const [newName, setNewName] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [newCapacity, setNewCapacity] = useState('')
  const [newOverbook, setNewOverbook] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    listRoomTypes(campId).then((data) => {
      if (!cancelled) { setTypes(data); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [campId])

  useEffect(() => {
    if (editing) nameInputRef.current?.focus()
  }, [editing?.id])

  function startEdit(rt: RoomType) {
    setEditing({ id: rt.id, name: rt.name, price: rt.price, defaultCapacity: rt.defaultCapacity, allowOverbook: rt.allowOverbook })
  }

  async function saveEdit() {
    if (!editing) return
    const name = editing.name.trim()
    const price = Number(editing.price)
    const cap = Number(editing.defaultCapacity)
    if (!name) { setError('Name is required'); return }
    if (!price || price < 0) { setError('Price must be 0 or more'); return }
    if (!cap || cap < 1) { setError('Capacity must be at least 1'); return }
    setError('')
    setSaving(true)
    try {
      await updateRoomType(campId, editing.id, {
        name,
        price,
        defaultCapacity: cap,
        allowOverbook: editing.allowOverbook,
      })
      setTypes(types.map((rt) =>
        rt.id === editing.id
          ? { ...rt, name, price, defaultCapacity: cap, allowOverbook: editing.allowOverbook }
          : rt
      ))
      setEditing(null)
    } finally {
      setSaving(false)
    }
  }

  async function move(index: number, direction: -1 | 1) {
    const next = [...types]
    const target = index + direction
    ;[next[index], next[target]] = [next[target], next[index]]
    setTypes(next)
    await reorderRoomTypes(campId, next.map((rt) => rt.id))
  }

  async function add() {
    const name = newName.trim()
    const price = Number(newPrice)
    const cap = Number(newCapacity)
    if (!name) { setError('Name is required'); return }
    if (newPrice === '' || isNaN(price) || price < 0) { setError('Price must be 0 or more'); return }
    if (!cap || cap < 1) { setError('Default capacity must be at least 1'); return }
    setError('')
    setSaving(true)
    try {
      const now = Timestamp.now()
      const id = await createRoomType(campId, {
        name,
        price,
        defaultCapacity: cap,
        allowOverbook: newOverbook,
        order: types.length,
      })
      setTypes([...types, { id, name, price, defaultCapacity: cap, allowOverbook: newOverbook, order: types.length, createdAt: now, updatedAt: now }])
      setNewName('')
      setNewPrice('')
      setNewCapacity('')
      setNewOverbook(false)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>

  return (
    <div className="space-y-3">
      {types.length === 0 && (
        <p className="text-sm text-muted-foreground">No room types yet.</p>
      )}

      <ul className="divide-y rounded-md border">
        {types.map((rt, i) => (
          <li key={rt.id} className="flex items-center gap-2 px-3 py-2">
            <span className="w-5 shrink-0 text-center text-xs text-muted-foreground">{i + 1}</span>

            {editing?.id === rt.id ? (
              /* ── inline edit row ── */
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <Input
                  ref={nameInputRef}
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="Type name"
                  className="h-7 w-32 text-sm"
                />
                <Input
                  type="number"
                  min={0}
                  value={editing.price}
                  onChange={(e) => setEditing({ ...editing, price: e.target.value === '' ? '' : Number(e.target.value) })}
                  placeholder="Price"
                  className="h-7 w-24 text-sm"
                />
                <Input
                  type="number"
                  min={1}
                  value={editing.defaultCapacity}
                  onChange={(e) => setEditing({ ...editing, defaultCapacity: e.target.value === '' ? '' : Number(e.target.value) })}
                  placeholder="Capacity"
                  className="h-7 w-24 text-sm"
                />
                <div className="flex items-center gap-1.5 text-sm">
                  <Switch
                    checked={editing.allowOverbook}
                    onCheckedChange={(v) => setEditing({ ...editing, allowOverbook: v })}
                    className="scale-75"
                  />
                  <span className="text-xs text-muted-foreground">Overbook</span>
                </div>
                <Button size="sm" onClick={saveEdit} disabled={saving} className="h-7 px-2 text-xs">Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)} className="h-7 px-2 text-xs">Cancel</Button>
              </div>
            ) : (
              /* ── display row ── */
              <div className="flex flex-1 items-center gap-4 text-sm">
                <span className="min-w-0 flex-1 font-medium">{rt.name}</span>
                <span className="shrink-0 text-muted-foreground">{currency} {rt.price}</span>
                <span className="shrink-0 text-muted-foreground">cap {rt.defaultCapacity}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {rt.allowOverbook ? 'overbook ✓' : 'hard cap'}
                </span>
              </div>
            )}

            <div className="flex shrink-0 items-center gap-1">
              {editing?.id !== rt.id && (
                <Button size="sm" variant="ghost" onClick={() => startEdit(rt)} className="h-7 w-7 p-0" aria-label="Edit">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} className="h-7 w-7 p-0" aria-label="Move up">
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === types.length - 1} className="h-7 w-7 p-0" aria-label="Move down">
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {/* add form */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Name</label>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="e.g. Dormitory" className="h-8 w-36 text-sm" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Price ({currency})</label>
          <Input type="number" min={0} value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="0" className="h-8 w-24 text-sm" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Default capacity</label>
          <Input type="number" min={1} value={newCapacity} onChange={(e) => setNewCapacity(e.target.value)} placeholder="20" className="h-8 w-20 text-sm" />
        </div>
        <div className="flex items-center gap-1.5 pb-0.5">
          <Switch checked={newOverbook} onCheckedChange={setNewOverbook} className="scale-75" />
          <span className="text-xs text-muted-foreground">Allow overbook</span>
        </div>
        <Button variant="outline" size="sm" onClick={add} disabled={saving || !newName.trim() || newPrice === '' || !newCapacity}>
          Add type
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
