import type { Timestamp } from 'firebase/firestore'

export interface Leader {
  id: string // Firebase Auth uid
  email: string
  displayName?: string
  campId: string
  subGroupId: string
  subGroupName: string
  active: boolean
  createdAt: Timestamp
  createdBy: string
  updatedAt: Timestamp
  lastLoginAt?: Timestamp
}
