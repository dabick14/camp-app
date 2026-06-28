import { initializeApp } from 'firebase-admin/app'

initializeApp()

export { adminAddParticipant } from './adminAddParticipant'
export { provisionLeader } from './provisionLeader'
export { leaderRegisterParticipant } from './leaderRegisterParticipant'
export { setLeaderActive } from './setLeaderActive'
