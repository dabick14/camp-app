import type { Timestamp } from 'firebase/firestore'

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
  createdAt: Timestamp
  createdBy: string
  updatedAt: Timestamp
  updatedBy?: string
}

export interface SubGroup {
  id: string
  name: string
  order: number
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
