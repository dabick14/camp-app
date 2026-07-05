import { useRef, useState } from 'react'
import Papa from 'papaparse'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { auth } from '@/lib/firebase'
import { bulkCreateRooms } from '../services/roomService'
import type { Room, RoomType } from '../types'

interface ValidRow {
  rowNum: number
  number: string
  roomTypeId: string
  roomTypeName: string
  gender: 'M' | 'F'
  capacity: number
  notes?: string
}

interface ErrorRow {
  rowNum: number
  raw: string
  reason: string
}

interface ParseResult {
  valid: ValidRow[]
  errors: ErrorRow[]
}

interface CsvImportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  campId: string
  roomTypes: RoomType[]
  existingRooms: Room[]
  onImported: () => void
}

export function CsvImportModal({
  open,
  onOpenChange,
  campId,
  roomTypes,
  existingRooms,
  onImported,
}: CsvImportModalProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [result, setResult] = useState<ParseResult | null>(null)
  const [importing, setImporting] = useState(false)

  function reset() {
    setResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setResult(null)

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.toLowerCase().trim(),
      complete: ({ data }) => {
        const valid: ValidRow[] = []
        const errors: ErrorRow[] = []
        // Track numbers we've already accepted in this batch (number+gender key)
        const seenInBatch = new Set<string>()

        data.forEach((row, i) => {
          const rowNum = i + 2 // row 1 = header
          const raw = [row['number'], row['type'], row['gender'], row['capacity'], row['notes']]
            .filter(Boolean)
            .join(', ')

          const num = row['number']?.trim()
          const typeRaw = row['type']?.trim()
          const genderRaw = row['gender']?.trim().toUpperCase()
          const capacityRaw = row['capacity']?.trim()
          const notesRaw = row['notes']?.trim()

          if (!num) { errors.push({ rowNum, raw, reason: 'Missing room number' }); return }

          const roomType = roomTypes.find(
            (rt) => rt.name.toLowerCase() === typeRaw?.toLowerCase(),
          )
          if (!roomType) {
            errors.push({ rowNum, raw, reason: `Unknown room type: "${typeRaw}"` }); return
          }

          if (genderRaw !== 'M' && genderRaw !== 'F') {
            errors.push({ rowNum, raw, reason: `Invalid gender "${genderRaw}" — must be M or F` }); return
          }

          const batchKey = `${num}|${genderRaw}`
          if (seenInBatch.has(batchKey)) {
            errors.push({ rowNum, raw, reason: `Duplicate in this file: ${num} (${genderRaw})` }); return
          }
          const alreadyExists = existingRooms.some(
            (r) => r.number.toLowerCase() === num.toLowerCase() && r.gender === genderRaw,
          )
          if (alreadyExists) {
            errors.push({ rowNum, raw, reason: `Room ${num} (${genderRaw}) already exists` }); return
          }
          seenInBatch.add(batchKey)

          let capacity: number
          if (capacityRaw) {
            const parsed = parseInt(capacityRaw, 10)
            if (isNaN(parsed) || parsed < 1) {
              errors.push({ rowNum, raw, reason: `Invalid capacity "${capacityRaw}"` }); return
            }
            capacity = parsed
          } else {
            capacity = roomType.defaultCapacity
          }

          valid.push({
            rowNum,
            number: num,
            roomTypeId: roomType.id,
            roomTypeName: roomType.name,
            gender: genderRaw as 'M' | 'F',
            capacity,
            notes: notesRaw || undefined,
          })
        })

        setResult({ valid, errors })
      },
    })
  }

  async function handleImport() {
    if (!result || result.valid.length === 0) return
    const uid = auth.currentUser!.uid
    setImporting(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      await bulkCreateRooms(campId, result.valid.map(({ rowNum: _r, ...r }) => r), uid)
      toast.success(`Imported ${result.valid.length} room${result.valid.length === 1 ? '' : 's'}.`)
      onImported()
      onOpenChange(false)
      reset()
    } catch (err) {
      console.error('CSV import error:', err)
      toast.error('Import failed. Please try again.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import rooms from CSV</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">
            Expected columns: <code className="rounded bg-muted px-1 text-xs">number, type, gender, capacity, notes</code>
            <br />
            <span className="text-xs">Capacity and notes are optional. Type must match an existing room type name (case-insensitive). Gender must be M or F.</span>
          </p>

          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFile}
            className="text-sm"
          />

          {result && (
            <div className="space-y-4">
              {/* Valid rows */}
              <div>
                <h3 className="mb-2 text-sm font-medium text-emerald-700">
                  Valid rows ({result.valid.length})
                </h3>
                {result.valid.length > 0 ? (
                  <div className="max-h-48 overflow-y-auto rounded border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted">
                        <tr>
                          {['#', 'Number', 'Type', 'Gender', 'Capacity', 'Notes'].map((h) => (
                            <th key={h} className="px-2 py-1.5 text-left font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {result.valid.map((row) => (
                          <tr key={row.rowNum}>
                            <td className="px-2 py-1 text-muted-foreground">{row.rowNum}</td>
                            <td className="px-2 py-1">{row.number}</td>
                            <td className="px-2 py-1">{row.roomTypeName}</td>
                            <td className="px-2 py-1">{row.gender}</td>
                            <td className="px-2 py-1">{row.capacity}</td>
                            <td className="px-2 py-1 text-muted-foreground">{row.notes ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">None.</p>
                )}
              </div>

              {/* Error rows */}
              {result.errors.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-medium text-destructive">
                    Errors ({result.errors.length}) — these rows will be skipped
                  </h3>
                  <ul className="max-h-32 space-y-1 overflow-y-auto rounded border p-2">
                    {result.errors.map((err) => (
                      <li key={err.rowNum} className="text-xs">
                        <span className="font-medium">Row {err.rowNum}:</span>{' '}
                        <span className="text-destructive">{err.reason}</span>
                        {err.raw && <span className="ml-1 text-muted-foreground">({err.raw})</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { onOpenChange(false); reset() }}>
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              disabled={!result || result.valid.length === 0 || importing}
            >
              {importing ? 'Importing…' : `Import ${result?.valid.length ?? 0} rooms`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
