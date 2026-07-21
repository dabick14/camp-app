import type { ValidImportRow } from '../utils/csvImport'

// DEV-only emulator override so this onRequest function is actually testable
// locally — adminAddParticipant/provisionLeader/setLeaderActive have the same
// hardcoded-prod-URL gap and are NOT locally testable; scoped here rather than
// fixed repo-wide since only this path needed it for now.
const BULK_IMPORT_URL = import.meta.env.DEV
  ? 'http://127.0.0.1:5001/camp-app-119bb/us-central1/adminBulkImportParticipants'
  : 'https://us-central1-camp-app-119bb.cloudfunctions.net/adminBulkImportParticipants'

// Each request is one Firestore batch server-side (500-op limit) — chunking
// at 200 here leaves headroom and lets the UI report real progress between
// requests, rather than one opaque multi-hundred-row call.
const CHUNK_SIZE = 200

export interface BulkImportSkip {
  rowNum: number
  reason: string
}

export interface BulkImportProgress {
  importedSoFar: number
  total: number
}

export interface BulkImportOutcome {
  imported: number
  total: number
  skipped: BulkImportSkip[]
  /** Rows from a chunk that failed outright (network/server error) and any rows after it — never attempted. */
  unattempted: ValidImportRow[]
  /** Set only when import stopped early due to a chunk-level failure. */
  stoppedEarly: boolean
  errorMessage?: string
}

export async function importParticipantsBulk(
  campId: string,
  rows: ValidImportRow[],
  idToken: string,
  onProgress?: (progress: BulkImportProgress) => void,
): Promise<BulkImportOutcome> {
  let importedSoFar = 0
  const skipped: BulkImportSkip[] = []

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE)

    let res: Response
    try {
      res = await fetch(BULK_IMPORT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          campId,
          rows: chunk.map((r) => ({
            rowNum: r.rowNum,
            fullName: r.fullName,
            phone: r.phone,
            gender: r.gender,
            subGroupId: r.subGroupId,
            roomTypePreferenceId: r.roomTypePreferenceId,
          })),
        }),
      })
    } catch (err) {
      return {
        imported: importedSoFar,
        total: rows.length,
        skipped,
        unattempted: rows.slice(i),
        stoppedEarly: true,
        errorMessage: (err as Error).message ?? 'Network error',
      }
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return {
        imported: importedSoFar,
        total: rows.length,
        skipped,
        unattempted: rows.slice(i),
        stoppedEarly: true,
        errorMessage: data.error ?? `Import failed (HTTP ${res.status})`,
      }
    }

    const data = (await res.json()) as { imported: number; skipped: BulkImportSkip[] }
    importedSoFar += data.imported
    skipped.push(...data.skipped)
    onProgress?.({ importedSoFar, total: rows.length })
  }

  return { imported: importedSoFar, total: rows.length, skipped, unattempted: [], stoppedEarly: false }
}
