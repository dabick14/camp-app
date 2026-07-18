export const DEFAULT_SENDER_ID = 'FLGALATIANS'

export const DEFAULT_ASSIGNED_TEMPLATE =
  "Hi {FirstName}, you've been assigned to Room {RoomNumber} for {CampName}. See you there!"

export const DEFAULT_CHANGED_TEMPLATE =
  "Hi {FirstName}, your room for {CampName} has changed. You're now in Room {RoomNumber}."

export function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
  )
}
