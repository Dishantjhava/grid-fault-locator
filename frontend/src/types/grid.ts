export type FaultType = 'span' | 'dt' | 'feeder' | 'dead_sensor'
export type IncidentStatus =
  | 'detected'
  | 'acknowledged'
  | 'crew_assigned'
  | 'resolved'
  | 'verified'
  | 'closed'
export type TopologySource = 'known' | 'inferred'

export interface Incident {
  id: string
  fault_type: FaultType
  status: IncidentStatus
  topology_source: TopologySource
  affected_pole_ids: string[]
  boundary_pole_id: string | null
  first_dark_pole_id: string | null
  confidence: number
  confidence_reason: string
  lat: number
  lon: number
  pincode: string | null
  households_affected: number
  created_at: string
  verified_at?: string | null
  closed_at?: string | null
}

export interface Pole {
  pole_id: string
  lat: number
  lon: number
  device_id: string | null
  current_energized: boolean
  parent_pole_id: string | null
  seq_on_line: number | null
  pincode: string | null
  ward: string
  pole_type: string
}

export interface DistributionTransformer {
  dt_id: string
  feeder_id: string
  lat: number
  lon: number
  capacity_kva: number
  households_served: number
  poles: Pole[]
}
