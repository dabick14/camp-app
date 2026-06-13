import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { Camp, SubGroup } from '@/features/camps/types'
import type { Room, RoomType } from '@/features/rooms/types'
import type { Participant } from '@/features/participants/types'
import { getCamp } from '@/features/camps/services/campService'
import { listSubGroups } from '@/features/camps/services/subGroupService'
import { listRoomTypes } from '@/features/rooms/services/roomTypeService'
import { listRooms } from '@/features/rooms/services/roomService'
import { listParticipants } from '@/features/participants/services/participantService'

export interface CampDataValue {
  camp: Camp | null
  subGroups: SubGroup[]
  roomTypes: RoomType[]
  rooms: Room[]
  participants: Participant[]
  loading: boolean
  error: string
  refresh: () => void
}

const CampDataContext = createContext<CampDataValue | null>(null)

export function CampDataProvider({
  campId,
  children,
}: {
  campId: string
  children: React.ReactNode
}) {
  const [camp, setCamp] = useState<Camp | null>(null)
  const [subGroups, setSubGroups] = useState<SubGroup[]>([])
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [participants, setParticipants] = useState<Participant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshCount, setRefreshCount] = useState(0)

  const refresh = useCallback(() => setRefreshCount((c) => c + 1), [])

  // Stale-request guard: track which fetch generation is current
  const genRef = useRef(0)

  useEffect(() => {
    const gen = ++genRef.current
    setLoading(true)
    setError('')

    Promise.all([
      getCamp(campId),
      listSubGroups(campId),
      listRoomTypes(campId),
      listRooms(campId),
      listParticipants(campId),
    ])
      .then(([campData, sgs, rts, rms, parts]) => {
        if (gen !== genRef.current) return // superseded by a newer fetch
        setCamp(campData)
        setSubGroups(sgs)
        setRoomTypes(rts)
        setRooms(rms)
        setParticipants(parts)
        setLoading(false)
      })
      .catch((err: Error) => {
        if (gen !== genRef.current) return
        setError(err.message ?? 'Failed to load camp data.')
        setLoading(false)
      })
  }, [campId, refreshCount])

  useEffect(() => {
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  return (
    <CampDataContext.Provider
      value={{ camp, subGroups, roomTypes, rooms, participants, loading, error, refresh }}
    >
      {children}
    </CampDataContext.Provider>
  )
}

export function useCampData(): CampDataValue {
  const ctx = useContext(CampDataContext)
  if (!ctx) throw new Error('useCampData must be used within CampDataProvider / CampLayout')
  return ctx
}
