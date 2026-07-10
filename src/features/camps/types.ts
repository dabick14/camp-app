import type { Timestamp } from 'firebase/firestore'

// A lightweight rollup container — stored as an array on the camp doc, not a subcollection.
// Sub-groups reference a SuperGroup by id; renaming auto-propagates via denormalized name.
// Deleting a SuperGroup is safe: sub-groups with a dangling superGroupId are treated as
// Unassigned in rollups rather than erroring.
export interface SuperGroup {
  id: string
  name: string
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
