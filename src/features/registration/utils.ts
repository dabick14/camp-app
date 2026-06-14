export function stripPhone(v: string): string {
  // Strip invisible Unicode directional chars iOS/Android paste from contacts
  return v.replace(/[​-‏‪-‮﻿\s\-()]/g, '')
}

export function isValidGhanaPhone(v: string): boolean {
  const s = stripPhone(v)
  const local = /^0[2357]\d{8}$/.test(s) || /^0[23][2-9]\d{7}$/.test(s)
  const intl = /^233\d{9}$/.test(s) || /^\+233\d{9}$/.test(s)
  return local || intl
}

export function normalizePhone(v: string): string {
  const s = stripPhone(v)
  if (s.startsWith('0')) return '+233' + s.slice(1)
  if (s.startsWith('233')) return '+' + s
  return s
}

export function computeAgeFromDob(dobStr: string, refDate: Date): number | null {
  const dob = new Date(dobStr)
  if (isNaN(dob.getTime())) return null
  return Math.floor((refDate.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
}
