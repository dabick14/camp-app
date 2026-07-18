import type { Timestamp } from 'firebase/firestore'

// A lightweight rollup container — stored as an array on the camp doc, not a subcollection.
// Sub-groups reference a SuperGroup by id; renaming auto-propagates via denormalized name.
// Deleting a SuperGroup is safe: sub-groups with a dangling superGroupId are treated as
// Unassigned in rollups rather than erroring.
export interface SuperGroup {
  id: string
  name: string
}

// Room-assignment SMS config. Absent/enabled:false means OFF — opt-in, no
// surprise sends or cost on camps that haven't configured it.
export interface SmsSettings {
  enabled: boolean
  senderId?: string          // default 'FLGALATIANS' if absent; max 11 chars per BMS
  assignedTemplate?: string
  changedTemplate?: string
}

export interface Camp {
  id: string
  name: string
  location: string
  startDate: Timestamp
  endDate: Timestamp
  description?: string
  imageUrl?: string
  minAge?: number
  maxAge?: number
  maxParticipants?: number
  currency: string
  registrationOpen: boolean
  superGroups?: SuperGroup[]    // optional per-camp rollup containers
  smsSettings?: SmsSettings
  createdAt: Timestamp
  createdBy: string
  updatedAt: Timestamp
  updatedBy?: string
}

export interface SubGroup {
  id: string
  name: string
  order: number
  superGroupId?: string         // references camp.superGroups[].id — optional
  superGroupName?: string       // denormalized from the SuperGroup at assignment time
  createdAt: Timestamp
  updatedAt: Timestamp
}

// Shape the form uses (dates as YYYY-MM-DD strings)
export interface CampFormValues {
  name: string
  location: string
  startDate: string
  endDate: string
  description: string
  imageUrl: string
  minAge?: number
  maxAge?: number
  maxParticipants?: number
  currency: string
  registrationOpen: boolean
}
