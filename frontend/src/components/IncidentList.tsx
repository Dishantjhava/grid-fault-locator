import React from 'react'
import { Incident } from '../types/grid'
import { AlertTriangle, ShieldCheck, Users, Zap, Clock } from 'lucide-react'

interface IncidentListProps {
  incidents: Incident[]
  selectedIncident: Incident | null
  onSelectIncident: (incident: Incident) => void
}

export const IncidentList: React.FC<IncidentListProps> = ({
  incidents,
  selectedIncident,
  onSelectIncident,
}) => {
  // Sort by households_affected descending
  const sortedIncidents = [...incidents].sort(
    (a, b) => b.households_affected - a.households_affected
  )

  const formatTimeAgo = (isoString: string) => {
    const diffMs = Date.now() - new Date(isoString).getTime()
    const mins = Math.floor(diffMs / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    return `${hours}h ago`
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'detected':
        return 'bg-red-500/20 text-red-400 border-red-500/40 animate-pulse'
      case 'acknowledged':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/40'
      case 'crew_assigned':
        return 'bg-purple-500/20 text-purple-400 border-purple-500/40'
      case 'resolved':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/40'
      case 'closed':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
      default:
        return 'bg-slate-700 text-slate-300'
    }
  }

  return (
    <div className="flex flex-col h-full bg-slate-900 border-r border-slate-800">
      <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/50">
        <div>
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-400 fill-amber-400" />
            Grid Outages & Incidents
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Sorted by Impact (Households Affected)
          </p>
        </div>
        <span className="px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-full text-xs font-semibold">
          {incidents.length} Active
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {sortedIncidents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-500 text-center p-4">
            <ShieldCheck className="w-10 h-10 text-emerald-500/50 mb-2" />
            <p className="text-sm font-medium">All Grid Sectors Energized</p>
            <p className="text-xs text-slate-500 mt-1">
              No active fault boundaries detected.
            </p>
          </div>
        ) : (
          sortedIncidents.map((incident) => {
            const isSelected = selectedIncident?.id === incident.id
            const isKnown = incident.topology_source === 'known'

            return (
              <div
                key={incident.id}
                onClick={() => onSelectIncident(incident)}
                className={`p-3.5 rounded-lg border cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-slate-800/90 border-amber-500/60 shadow-lg shadow-amber-500/5 ring-1 ring-amber-500/50'
                    : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-800/40'
                }`}
              >
                {/* Header row */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="px-2 py-0.5 bg-red-950 text-red-400 border border-red-800/60 font-mono text-[11px] font-bold rounded uppercase">
                      {incident.fault_type} FAULT
                    </span>
                    <span
                      className={`px-2 py-0.5 text-[11px] font-semibold border rounded capitalize ${getStatusBadge(
                        incident.status
                      )}`}
                    >
                      {incident.status.replace('_', ' ')}
                    </span>
                  </div>

                  <span className="text-[11px] text-slate-400 flex items-center gap-1 font-mono">
                    <Clock className="w-3 h-3 text-slate-500" />
                    {formatTimeAgo(incident.created_at)}
                  </span>
                </div>

                {/* Impact statistics */}
                <div className="grid grid-cols-2 gap-2 my-2 py-2 border-y border-slate-800/80 text-xs">
                  <div className="flex items-center gap-1.5 text-slate-300">
                    <Users className="w-3.5 h-3.5 text-slate-400" />
                    <span className="font-semibold text-slate-100">
                      {incident.households_affected.toLocaleString()}
                    </span>{' '}
                    households
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-300">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span className="font-semibold text-slate-100">
                      {incident.affected_pole_ids.length}
                    </span>{' '}
                    poles dark
                  </div>
                </div>

                {/* Topology Confidence Badge */}
                <div className="flex items-center justify-between text-[11px] mt-2">
                  {isKnown ? (
                    <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                      Known Topology (Digitized)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-400 font-medium">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      Inferred Topology (MST)
                    </span>
                  )}

                  <span className="font-mono text-slate-400 text-[10px]">
                    Confidence: {(incident.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
