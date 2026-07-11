import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Plus } from 'lucide-react'
import { Timestamp } from 'firebase/firestore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { formatMoney } from '@/lib/formatMoney'
import {
  createRoomType,
  listRoomTypes,
  reorderRoomTypes,
  updateRoomType,
} from '../services/roomTypeService'
import type { RoomType } from '../types'

type FormState = {
  name: string
  price: string
  defaultCapacity: string
  allowOverbook: boolean
}

const EMPTY_FORM: FormState = { name: '', price: '', defaultCapacity: '', allowOverbook: false }

function validateForm(form: FormState): string | null {
  if (!form.name.trim()) return 'Name is required.'
  const s = form.price.trim()
  if (!s || isNaN(Number(s))) return 'Price is required.'
  if (Number(s) < 0) return 'Price must be 0 or more.'
  if (/\.\d{3,}/.test(s)) return 'Maximum 2 decimal places.'
  const cap = Number(form.defaultCapacity)
  if (!cap || cap < 1) return 'Capacity must be at least 1.'
  return null
}

export function RoomTypesEditor({ campId, currency = 'GHS' }: { campId: string; currency?: string }) {
  const [types, setTypes] = useState<RoomType[]>([])
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<{ mode: 'add' | 'edit'; target?: RoomType } | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    listRoomTypes(campId).then((data) => {
      if (!cancelled) { setTypes(data); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [campId])

  function openAdd() {
    setForm(EMPTY_FORM)
    setError('')
    setDialog({ mode: 'add' })
  }

  function openEdit(rt: RoomType) {
    setForm({
      name: rt.name,
      price: String(rt.price),
      defaultCapacity: String(rt.defaultCapacity),
      allowOverbook: rt.allowOverbook,
    })
    setError('')
    setDialog({ mode: 'edit', target: rt })
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    setError('')
  }

  async function handleSave() {
    const err = validateForm(form)
    if (err) { setError(err); return }

    const name = form.name.trim()
    const price = Number(form.price)
    const defaultCapacity = Number(form.defaultCapacity)
    const { allowOverbook } = form

    setSaving(true)
    setError('')
    try {
      if (dialog?.mode === 'add') {
        const now = Timestamp.now()
        const id = await createRoomType(campId, { name, price, defaultCapacity, allowOverbook, order: types.length })
        setTypes([...types, { id, name, price, defaultCapacity, allowOverbook, order: types.length, createdAt: now, updatedAt: now }])
      } else if (dialog?.mode === 'edit' && dialog.target) {
        await updateRoomType(campId, dialog.target.id, { name, price, defaultCapacity, allowOverbook })
        setTypes(types.map((rt) =>
          rt.id === dialog.target!.id ? { ...rt, name, price, defaultCapacity, allowOverbook } : rt,
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
    const next = [...types]
    const target = index + direction
    ;[next[index], next[target]] = [next[target], next[index]]
    setTypes(next)
    await reorderRoomTypes(campId, next.map((rt) => rt.id))
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>

  return (
    <>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Define types before adding rooms. Price here sets the default participant fee.
        </p>

        {types.length === 0 && (
          <p className="text-sm italic text-muted-foreground">No room types yet.</p>
        )}

        {types.length > 0 && (
          <ul className="divide-y overflow-hidden rounded-xl border">
            {types.map((rt, i) => (
              <li key={rt.id} className="flex items-stretch">
                {/* Tappable two-line row */}
                <button
                  className="flex flex-1 items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/40"
                  onClick={() => openEdit(rt)}
                >
                  <span className="w-5 shrink-0 text-center text-xs text-muted-foreground">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{rt.name}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {formatMoney(rt.price, currency)}
                      {' · '}cap {rt.defaultCapacity}
                      {' · '}{rt.allowOverbook ? 'overbook' : 'hard cap'}
                    </div>
                  </div>
                </button>
                {/* Reorder — sibling, not nested inside the tappable button */}
                <div className="flex shrink-0 items-stretch border-l">
                  <button
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    className="flex items-center px-2.5 text-muted-foreground transition-colors hover:bg-muted/40 disabled:opacity-30"
                    aria-label="Move up"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => move(i, 1)}
                    disabled={i === types.length - 1}
                    className="flex items-center border-l px-2.5 text-muted-foreground transition-colors hover:bg-muted/40 disabled:opacity-30"
                    aria-label="Move down"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Button variant="outline" onClick={openAdd} className="w-full sm:w-auto">
          <Plus className="h-4 w-4" />
          Add room type
        </Button>
      </div>

      <Dialog open={!!dialog} onOpenChange={(open) => { if (!open && !saving) setDialog(null) }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === 'add' ? 'New room type' : 'Edit room type'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="rt-name">Name</Label>
              <Input
                id="rt-name"
                autoFocus
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="e.g. Dormitory"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="rt-price">Price ({currency})</Label>
                <Input
                  id="rt-price"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setField('price', e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rt-cap">Default capacity</Label>
                <Input
                  id="rt-cap"
                  type="number"
                  min={1}
                  value={form.defaultCapacity}
                  onChange={(e) => setField('defaultCapacity', e.target.value)}
                  placeholder="20"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="rt-overbook"
                checked={form.allowOverbook}
                onCheckedChange={(v) => setField('allowOverbook', v)}
              />
              <Label htmlFor="rt-overbook" className="cursor-pointer font-normal">
                Allow overbooking
              </Label>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
