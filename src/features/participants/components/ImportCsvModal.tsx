import { useState } from 'react'
import { getAuth } from 'firebase/auth'
import { AlertTriangle, CheckCircle, Download, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FileDropZone } from '@/components/ui/file-drop-zone'
import type { SubGroup } from '@/features/camps/types'
import type { RoomType } from '@/features/rooms/types'
import type { Participant } from '../types'
import {
  parseCsvFile,
  validateImportRows,
  downloadImportTemplateCsv,
  downloadRejectedRowsCsv,
  downloadFailedImportRowsCsv,
  type ImportParseResult,
} from '../utils/csvImport'
import { importParticipantsBulk, type BulkImportOutcome } from '../services/participantImportService'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  campId: string
  subGroups: SubGroup[]
  roomTypes: RoomType[]
  participants: Participant[]
  onImported: () => void
}

// On-screen previews cap at these counts — full data is still in the
// downloadable rejected-rows CSV; the ready-to-import table is just a
// confirmation glance, not a working view.
const REJECTED_PREVIEW_LIMIT = 10
const READY_PREVIEW_LIMIT = 10

export function ImportCsvModal({
  open,
  onOpenChange,
  campId,
  subGroups,
  roomTypes,
  participants,
  onImported,
}: Props) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [result, setResult] = useState<ImportParseResult | null>(null)
  const [excludedRows, setExcludedRows] = useState<Set<number>>(new Set())
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [outcome, setOutcome] = useState<BulkImportOutcome | null>(null)

  function reset() {
    setSelectedFile(null)
    setResult(null)
    setExcludedRows(new Set())
    setProgress(null)
    setOutcome(null)
  }

  function handleClose() {
    onOpenChange(false)
    reset()
  }

  async function handleFileChange(file: File | null) {
    reset()
    if (!file) return
    setSelectedFile(file)

    try {
      const rows = await parseCsvFile(file)
      const parsed = validateImportRows(rows, subGroups, roomTypes, participants)
      setResult(parsed)
      // Default: exclude possible duplicates from the import — admin opts in per-row.
      setExcludedRows(new Set(parsed.valid.filter((r) => r.duplicateReason).map((r) => r.rowNum)))
    } catch (err) {
      toast.error(`Could not read CSV: ${(err as Error).message}`)
    }
  }

  function toggleRow(rowNum: number) {
    setExcludedRows((prev) => {
      const next = new Set(prev)
      if (next.has(rowNum)) next.delete(rowNum)
      else next.add(rowNum)
      return next
    })
  }

  // "Select" = include in the import (i.e. remove from the excluded set).
  function setAllDuplicates(select: boolean) {
    if (!result) return
    const dupRowNums = result.valid.filter((r) => r.duplicateReason).map((r) => r.rowNum)
    setExcludedRows((prev) => {
      const next = new Set(prev)
      dupRowNums.forEach((rn) => (select ? next.delete(rn) : next.add(rn)))
      return next
    })
  }

  const rowsToImport = result ? result.valid.filter((r) => !excludedRows.has(r.rowNum)) : []

  async function handleImport() {
    if (rowsToImport.length === 0) return
    const idToken = await getAuth().currentUser?.getIdToken()
    if (!idToken) {
      toast.error('Not authenticated. Please refresh and try again.')
      return
    }

    setImporting(true)
    setProgress({ done: 0, total: rowsToImport.length })
    try {
      const res = await importParticipantsBulk(campId, rowsToImport, idToken, (p) =>
        setProgress({ done: p.importedSoFar, total: p.total }),
      )
      setOutcome(res)
      if (res.imported > 0) onImported()
      if (!res.stoppedEarly && res.skipped.length === 0) {
        toast.success(`Imported ${res.imported} participant${res.imported === 1 ? '' : 's'}.`)
      } else if (!res.stoppedEarly) {
        toast.success(`Imported ${res.imported} of ${res.total} — ${res.skipped.length} skipped, see details below.`)
      } else {
        toast.error(`Import stopped after ${res.imported} of ${res.total} — see details below.`)
      }
    } catch (err) {
      toast.error((err as Error).message ?? 'Import failed. Please try again.')
    } finally {
      setImporting(false)
    }
  }

  function handleDownloadRemaining() {
    if (!outcome) return
    const skipReasonByRow = new Map(outcome.skipped.map((s) => [s.rowNum, s.reason]))
    const unattemptedRows = outcome.unattempted.map((r) => ({ ...r, reason: 'Import stopped before this row was processed' }))
    const skippedRows = rowsToImport.filter((r) => skipReasonByRow.has(r.rowNum))
    const remaining = [...unattemptedRows, ...skippedRows]
    downloadFailedImportRowsCsv(remaining, (rowNum) => skipReasonByRow.get(rowNum) ?? 'Import stopped before this row was processed')
  }

  const canImport = !!result && rowsToImport.length > 0 && !importing && !outcome

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import participants from CSV</DialogTitle>
        </DialogHeader>

        <DialogBody className="min-w-0 space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Columns: <code className="rounded bg-muted px-1 text-xs">name, gender, sub-group, room type, phone</code>.
              {' '}Name, gender, sub-group and room type are required — sub-group and room type must match
              an existing name (case-insensitive). Phone is optional.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={downloadImportTemplateCsv}>
              <Download className="h-3.5 w-3.5" />
              Download template
            </Button>
          </div>

          <FileDropZone
            id="participants-csv-file"
            accept=".csv,text/csv"
            file={selectedFile}
            onFileChange={handleFileChange}
            disabled={importing}
            hint="CSV files only"
          />

          {result && !outcome && (
            <div className="space-y-4">
              {/* Summary — kept right under the file picker, before any capped
                  section, so it never requires scrolling to find. */}
              <p className="text-sm font-medium">
                {rowsToImport.length} row{rowsToImport.length === 1 ? '' : 's'} ready to import
                {' · '}{result.rejected.length} row{result.rejected.length === 1 ? '' : 's'} with problems
                {result.duplicateCount > 0 && <> · {result.duplicateCount} possible duplicate{result.duplicateCount === 1 ? '' : 's'}</>}
              </p>

              {/* Rejected rows — preview only; full list is the download */}
              {result.rejected.length > 0 && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-destructive">
                      <XCircle className="mr-1 inline h-3.5 w-3.5" />
                      Rejected ({result.rejected.length})
                    </p>
                    <Button type="button" variant="ghost" size="sm" onClick={() => downloadRejectedRowsCsv(result.rejected)}>
                      <Download className="h-3.5 w-3.5" />
                      Download rejected rows
                    </Button>
                  </div>
                  <ul className="space-y-1 rounded border border-destructive/30 bg-destructive/5 p-2">
                    {result.rejected.slice(0, REJECTED_PREVIEW_LIMIT).map((r) => (
                      <li key={r.rowNum} className="text-xs">
                        <span className="font-medium">Row {r.rowNum}:</span>{' '}
                        <span className="text-destructive">{r.reason}</span>
                      </li>
                    ))}
                  </ul>
                  {result.rejected.length > REJECTED_PREVIEW_LIMIT && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      …and {result.rejected.length - REJECTED_PREVIEW_LIMIT} more — download the full list above.
                    </p>
                  )}
                </div>
              )}

              {/* Possible duplicates — every row needs its checkbox seen/used,
                  so this gets its own internal scroll rather than a preview cap. */}
              {result.duplicateCount > 0 && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-status-partial">
                      <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                      Possible duplicates — unchecked rows are skipped
                    </p>
                    {result.duplicateCount > 1 && (
                      <div className="flex shrink-0 gap-2 text-xs">
                        <button type="button" className="text-status-partial underline hover:no-underline" onClick={() => setAllDuplicates(true)}>
                          Select all
                        </button>
                        <button type="button" className="text-status-partial underline hover:no-underline" onClick={() => setAllDuplicates(false)}>
                          Select none
                        </button>
                      </div>
                    )}
                  </div>
                  <ul className="max-h-40 space-y-1 overflow-y-auto rounded border border-status-partial/30 bg-status-partial-bg p-2">
                    {result.valid.filter((r) => r.duplicateReason).map((r) => (
                      <li key={r.rowNum} className="flex items-start gap-2 text-xs">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-3.5 w-3.5"
                          checked={!excludedRows.has(r.rowNum)}
                          onChange={() => toggleRow(r.rowNum)}
                        />
                        <span>
                          <span className="font-medium">Row {r.rowNum} ({r.fullName}):</span>{' '}
                          <span className="text-status-partial">{r.duplicateReason}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Ready to import — capped preview table, not a working view */}
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-status-paid">
                  <CheckCircle className="mr-1 inline h-3.5 w-3.5" />
                  Ready to import ({result.valid.length})
                </p>
                {result.valid.length > 0 ? (
                  <>
                    <div className="overflow-x-auto rounded border">
                      <table className="w-full min-w-[560px] text-xs">
                        <thead className="bg-muted">
                          <tr>
                            {['#', 'Name', 'Gender', 'Sub-group', 'Room type', 'Phone', 'Notes'].map((h) => (
                              <th key={h} className="px-2 py-1.5 text-left font-medium">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {result.valid.slice(0, READY_PREVIEW_LIMIT).map((row) => (
                            <tr key={row.rowNum} className={excludedRows.has(row.rowNum) ? 'opacity-40' : ''}>
                              <td className="px-2 py-1 text-muted-foreground">{row.rowNum}</td>
                              <td className="px-2 py-1">{row.fullName}</td>
                              <td className="px-2 py-1">{row.gender}</td>
                              <td className="px-2 py-1">{row.subGroupName}</td>
                              <td className="px-2 py-1">{row.roomTypePreferenceName}</td>
                              <td className="px-2 py-1 text-muted-foreground">{row.phone ?? '—'}</td>
                              <td className="px-2 py-1 text-muted-foreground">
                                {row.duplicateReason ? 'Duplicate' : row.warnings.join('; ') || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {result.valid.length > READY_PREVIEW_LIMIT && (
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        …and {result.valid.length - READY_PREVIEW_LIMIT} more.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">None.</p>
                )}
              </div>
            </div>
          )}

          {importing && progress && (
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">Importing {progress.done} of {progress.total}…</p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
                />
              </div>
            </div>
          )}

          {outcome && (
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-sm font-medium">
                {outcome.stoppedEarly
                  ? `Import stopped: ${outcome.imported} of ${outcome.total} participants imported.`
                  : `${outcome.imported} of ${outcome.total} participants imported.`}
              </p>
              {outcome.errorMessage && (
                <p className="text-sm text-destructive">{outcome.errorMessage}</p>
              )}
              {outcome.skipped.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-status-partial">
                    Skipped ({outcome.skipped.length})
                  </p>
                  <ul className="max-h-32 space-y-1 overflow-y-auto rounded border border-status-partial/30 bg-status-partial-bg p-2 text-xs">
                    {outcome.skipped.map((s) => (
                      <li key={s.rowNum}>Row {s.rowNum}: {s.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
              {(outcome.unattempted.length > 0 || outcome.skipped.length > 0) && (
                <Button type="button" variant="outline" size="sm" onClick={handleDownloadRemaining}>
                  <Download className="h-3.5 w-3.5" />
                  Download rows that weren't imported
                </Button>
              )}
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={importing}>
            {outcome ? 'Close' : 'Cancel'}
          </Button>
          {!outcome && (
            <Button onClick={handleImport} disabled={!canImport}>
              {importing
                ? 'Importing…'
                : result
                  ? `Import ${rowsToImport.length} participant${rowsToImport.length === 1 ? '' : 's'}`
                  : 'Import participants'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
