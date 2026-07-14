import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { QueryDocumentSnapshot } from 'firebase/firestore'
import type { Camp, SubGroup } from '@/features/camps/types'
import type { Room, RoomType } from '@/features/rooms/types'
import type { Participant } from '@/features/participants/types'
import { withTimeout } from '@/lib/withTimeout'
import { getCamp } from '@/features/camps/services/campService'
import { listSubGroups } from '@/features/camps/services/subGroupService'
import { listRoomTypes } from '@/features/rooms/services/roomTypeService'
import { listRooms } from '@/features/rooms/services/roomService'
import { listParticipantsPage } from '@/features/participants/services/participantService'

export interface CampDataValue {
  camp: Camp | null
  subGroups: SubGroup[]
  roomTypes: RoomType[]
  rooms: Room[]
  participants: Participant[]
  /** True while participant pages are still arriving after the shell loads. */
  participantsLoading: boolean
  /** Non-empty if a participant page fetch failed. */
  participantsError: string
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
  const [participantsLoading, setParticipantsLoading] = useState(false)
  const [participantsError, setParticipantsError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshCount, setRefreshCount] = useState(0)

  // Gates the participant effect — set true only after the shell bundle resolves.
  const [shellReady, setShellReady] = useState(false)

  const refresh = useCallback(() => setRefreshCount((c) => c + 1), [])

  // Track when the last successful shell fetch completed (for focus-refresh staleness check).
  const lastFetchAt = useRef(0)
  // Stale-request guards — independent for shell and participant loads.
  const genRef = useRef(0)
  const partGenRef = useRef(0)

  // ── Shell bundle: camp, subGroups, roomTypes, rooms ────────────────────────
  // Participants are NOT in this bundle — keeps it small so the layout renders
  // quickly even when App Check token acquisition is slow on cold mobile load.
  useEffect(() => {
    const gen = ++genRef.current
    setLoading(true)
    setError('')
    setShellReady(false)

    withTimeout(Promise.all([
      getCamp(campId),
      listSubGroups(campId),
      listRoomTypes(campId),
      listRooms(campId),
    ]))
      .then(([campData, sgs, rts, rms]) => {
        if (gen !== genRef.current) return
        setCamp(campData)
        setSubGroups(sgs)
        setRoomTypes(rts)
        setRooms(rms)
        setLoading(false)
        setShellReady(true)
        lastFetchAt.current = Date.now()
      })
      .catch((err: Error) => {
        if (gen !== genRef.current) return
        setError(err.message ?? 'Failed to load camp data.')
        setLoading(false)
      })
  }, [campId, refreshCount])

  // ── Participant progressive load ────────────────────────────────────────────
  // Fires only after shellReady becomes true — by which point App Check has
  // already issued a token for the shell reads, so it's warm for these fetches.
  // Pages in 100-doc chunks so the first batch renders quickly.
  useEffect(() => {
    if (!shellReady) return

    const gen = ++partGenRef.current
    setParticipantsLoading(true)
    setParticipantsError('')
    setParticipants([])

    let cursor: QueryDocumentSnapshot | null = null
    const accumulated: Participant[] = []

    async function fetchNextPage() {
      try {
        const { docs, lastDoc, hasMore } = await listParticipantsPage(campId, cursor)
        if (gen !== partGenRef.current) return
        cursor = lastDoc
        accumulated.push(...docs)
        setParticipants([...accumulated])
        if (hasMore) {
          fetchNextPage()
        } else {
          setParticipantsLoading(false)
        }
      } catch (err: unknown) {
        if (gen !== partGenRef.current) return
        setParticipantsError((err as Error).message ?? 'Failed to load participants.')
        setParticipantsLoading(false)
      }
    }

    fetchNextPage()
  }, [shellReady, campId])

  useEffect(() => {
    const handleFocus = () => {
      if (Date.now() - lastFetchAt.current > 60_000) refresh()
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [refresh])

  return (
    <CampDataContext.Provider
      value={{
        camp,
        subGroups,
        roomTypes,
        rooms,
        participants,
        participantsLoading,
        participantsError,
        loading,
        error,
        refresh,
      }}
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
