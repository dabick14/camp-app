import type { Timestamp } from 'firebase/firestore'

export interface RoomType {
  id: string
  name: string
  price: number
  defaultCapacity: number
  allowOverbook: boolean
  order: number
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface Room {
  id: string
  number: string
  roomTypeId: string
  roomTypeName: string // denormalized
  gender: 'M' | 'F'
  capacity: number // resolved: type default OR per-room override
  currentOccupancy: number // updated transactionally on assignment/unassignment
  notes?: string
  createdAt: Timestamp
  createdBy: string
  updatedAt: Timestamp
  updatedBy?: string
}
