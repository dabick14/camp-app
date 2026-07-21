import Papa from 'papaparse'
import type { SubGroup } from '@/features/camps/types'
import type { RoomType } from '@/features/rooms/types'
import type { Participant } from '../types'
import { isValidGhanaPhone, stripPhone } from '@/features/registration/utils'

export interface ValidImportRow {
  rowNum: number
  fullName: string
  phone?: string
  gender: 'M' | 'F'
  subGroupId: string
  subGroupName: string
  roomTypePreferenceId: string
  roomTypePreferenceName: string
  feeOwed: number
  warnings: string[]
  duplicateReason?: string
}

export interface RejectedImportRow {
  rowNum: number
  raw: Record<string, string>
  reason: string
}

export interface ImportParseResult {
  valid: ValidImportRow[]
  rejected: RejectedImportRow[]
  duplicateCount: number
}

const NAME_ALIASES = ['name', 'fullname', 'full name', 'participant name']
const GENDER_ALIASES = ['gender', 'sex']
const SUBGROUP_ALIASES = ['sub-group', 'subgroup', 'sub group', 'council']
const ROOMTYPE_ALIASES = ['room type', 'roomtype', 'room']
const PHONE_ALIASES = ['phone', 'phone number', 'mobile', 'mobile number', 'contact']

function getField(row: Record<string, string>, aliases: string[]): string {
  const keys = Object.keys(row)
  for (const alias of aliases) {
    const key = keys.find((k) => k.trim().toLowerCase() === alias)
    if (key !== undefined) return (row[key] ?? '').trim()
  }
  return ''
}

function normalizeGender(raw: string): 'M' | 'F' | null {
  const v = raw.trim().toLowerCase()
  if (v === 'm' || v === 'male') return 'M'
  if (v === 'f' || v === 'female') return 'F'
  return null
}

function isRowBlank(row: Record<string, string>): boolean {
  // A row with MORE columns than the header (a stray trailing comma — common
  // in spreadsheet exports) gets a non-string `__parsed_extra` array from
  // Papa; only string fields count toward "blank", so that array is ignored
  // rather than crashing on `.trim()`.
  return Object.values(row).every((v) => typeof v !== 'string' || !v.trim())
}

/**
 * Parses a CSV File into raw rows (header:true).
 *
 * skipEmptyLines is deliberately OFF: Papa would otherwise drop blank lines
 * from `data` before row numbers are computed, desyncing every row number
 * after a blank line from the line the admin actually sees in their
 * spreadsheet. Blank-line filtering is done downstream in validateImportRows
 * (isRowBlank) instead, which keeps one array entry per file line.
 */
export function parseCsvFile(file: File): Promise<Record<string, string>[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: false,
      complete: ({ data }) => resolve(data),
      error: (err: Error) => reject(err),
    })
  })
}

/**
 * Validates parsed CSV rows against a camp's sub-groups/room-types and its
 * already-loaded participant list (for duplicate detection). Writes nothing —
 * this is Part A of the import flow (validate, preview) before Part C (import).
 */
export function validateImportRows(
  rows: Record<string, string>[],
  subGroups: SubGroup[],
  roomTypes: RoomType[],
  existingParticipants: Participant[],
): ImportParseResult {
  const valid: ValidImportRow[] = []
  const rejected: RejectedImportRow[] = []

  // Existing participants, keyed for O(1) duplicate lookup instead of
  // .find()-per-row (mirrors AllocationsUploadModal's byId Map pattern).
  const existingByNameSubGroup = new Map(
    existingParticipants
      .filter((p) => p.registrationState === 'REGISTERED')
      .map((p) => [`${p.fullName.trim().toLowerCase()}|${p.subGroupId}`, p]),
  )
  const existingByPhone = new Map(
    existingParticipants
      .filter((p) => p.registrationState === 'REGISTERED' && p.phone)
      .map((p) => [p.phone, p]),
  )
  // Rows already accepted earlier in this same file — catches an internally
  // duplicated or overlapping upload, not just matches against existing data.
  const seenInFileByNameSubGroup = new Set<string>()
  const seenInFileByPhone = new Set<string>()

  rows.forEach((row, i) => {
    const rowNum = i + 2 // row 1 is the header
    if (isRowBlank(row)) return // silently skipped — spreadsheet artifact

    const fullName = getField(row, NAME_ALIASES)
    const genderRaw = getField(row, GENDER_ALIASES)
    const subGroupRaw = getField(row, SUBGROUP_ALIASES)
    const roomTypeRaw = getField(row, ROOMTYPE_ALIASES)
    const phoneRaw = getField(row, PHONE_ALIASES)

    if (!fullName) {
      rejected.push({ rowNum, raw: row, reason: 'name is missing' })
      return
    }

    const gender = genderRaw ? normalizeGender(genderRaw) : null
    if (!gender) {
      rejected.push({
        rowNum,
        raw: row,
        reason: genderRaw ? `gender "${genderRaw}" not recognised — use M or F` : 'gender missing',
      })
      return
    }

    if (!subGroupRaw) {
      rejected.push({ rowNum, raw: row, reason: 'sub-group is missing' })
      return
    }
    const subGroup = subGroups.find((sg) => sg.name.trim().toLowerCase() === subGroupRaw.toLowerCase())
    if (!subGroup) {
      rejected.push({ rowNum, raw: row, reason: `sub-group "${subGroupRaw}" not found` })
      return
    }

    if (!roomTypeRaw) {
      rejected.push({ rowNum, raw: row, reason: 'room type is missing' })
      return
    }
    const roomType = roomTypes.find((rt) => rt.name.trim().toLowerCase() === roomTypeRaw.toLowerCase())
    if (!roomType) {
      rejected.push({ rowNum, raw: row, reason: `room type "${roomTypeRaw}" not found` })
      return
    }

    const warnings: string[] = []
    let phone: string | undefined
    if (!phoneRaw) {
      warnings.push('No phone number — will not receive SMS notifications')
    } else if (!isValidGhanaPhone(phoneRaw)) {
      warnings.push('Unrecognised phone format — kept as entered')
      phone = stripPhone(phoneRaw)
    } else {
      phone = stripPhone(phoneRaw)
    }

    // Duplicate detection: name+sub-group match, or phone match, against
    // existing camp participants OR rows already accepted from this file.
    const nameKey = `${fullName.trim().toLowerCase()}|${subGroup.id}`
    let duplicateReason: string | undefined
    const existingByName = existingByNameSubGroup.get(nameKey)
    if (existingByName) {
      duplicateReason = `Matches existing participant "${existingByName.fullName}" in ${subGroup.name}`
    } else if (phone && existingByPhone.has(phone)) {
      duplicateReason = `Phone matches existing participant "${existingByPhone.get(phone)!.fullName}"`
    } else if (seenInFileByNameSubGroup.has(nameKey)) {
      duplicateReason = `Duplicate of another row earlier in this file (same name + sub-group)`
    } else if (phone && seenInFileByPhone.has(phone)) {
      duplicateReason = `Phone duplicates another row earlier in this file`
    }

    seenInFileByNameSubGroup.add(nameKey)
    if (phone) seenInFileByPhone.add(phone)

    valid.push({
      rowNum,
      fullName: fullName.trim(),
      phone,
      gender,
      subGroupId: subGroup.id,
      subGroupName: subGroup.name,
      roomTypePreferenceId: roomType.id,
      roomTypePreferenceName: roomType.name,
      feeOwed: roomType.price,
      warnings,
      duplicateReason,
    })
  })

  const duplicateCount = valid.filter((r) => r.duplicateReason).length
  return { valid, rejected, duplicateCount }
}

function downloadCsv(filename: string, headerRow: string[], rows: string[][]) {
  const csv = [headerRow, ...rows]
    .map((r) => r.map((c) => `"${(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadImportTemplateCsv() {
  downloadCsv(
    'participant-import-template.csv',
    ['name', 'gender', 'sub-group', 'room type', 'phone'],
    [['Abena Mensah', 'F', 'Youth Council', 'Standard', '0244111222']],
  )
}

export function downloadRejectedRowsCsv(rejected: RejectedImportRow[]) {
  if (rejected.length === 0) return
  // Original columns, in the order they appeared in the source file, plus "error".
  const columns = Object.keys(rejected[0].raw)
  downloadCsv(
    'rejected-rows.csv',
    [...columns, 'error'],
    rejected.map((r) => [...columns.map((c) => r.raw[c] ?? ''), r.reason]),
  )
}

/** Rows that were never written during import (server error mid-run, or skipped server-side) — lets the admin retry just the remainder. */
export function downloadFailedImportRowsCsv(
  rows: { rowNum: number; fullName: string; phone?: string; gender: string; subGroupName: string; roomTypePreferenceName: string }[],
  reasonForRow: (rowNum: number) => string,
) {
  if (rows.length === 0) return
  downloadCsv(
    'import-not-completed.csv',
    ['name', 'gender', 'sub-group', 'room type', 'phone', 'error'],
    rows.map((r) => [
      r.fullName, r.gender, r.subGroupName, r.roomTypePreferenceName, r.phone ?? '', reasonForRow(r.rowNum),
    ]),
  )
}
