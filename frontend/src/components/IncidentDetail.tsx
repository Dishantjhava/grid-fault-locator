import React, { useState } from 'react'
import { Incident } from '../types/grid'
import {
  MapPin,
  CheckCircle2,
  UserCheck,
  Wrench,
  AlertCircle,
  X,
  Info,
  Building,
} from 'lucide-react'

interface IncidentDetailProps {
  incident: Incident
  onClose: () => void
  onActionComplete: () => void
}

export const IncidentDetail: React.FC<IncidentDetailProps> = ({
  incident,
  onClose,
  onActionComplete,
}) => {
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'

  const handleAction = async (
    action: 'acknowledge' | 'assign-crew' | 'resolve'
  ) => {
    setLoading(true)
    setFeedback(null)
    setErrorMsg(null)

    try {
      const res = await fetch(`${backendUrl}/incidents/${incident.id}/${action}`, {
        method: 'POST',
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.message || 'Action failed')
      }

      setFeedback(data.message)
      onActionComplete()
    } catch (err: any) {
      setErrorMsg(err.message)
    } finally {
      setLoading(false)
    }
  }

  const isKnown = incident.topology_source === 'known'

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-2xl space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-slate-800 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold text-amber-400 px-2 py-0.5 bg-amber-500/10 border border-amber-500/30 rounded uppercase">
              {incident.fault_type} FAULT
            </span>
            <span className="text-xs font-mono text-slate-400 font-bold">
              #{incident.id}
            </span>
          </div>
          <h3 className="text-lg font-bold text-slate-100 mt-1">
            Fault Incident Detail
          </h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Operational Feedback Message Banner */}
      {feedback && (
        <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-lg text-xs flex items-start gap-2">
          <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Operational Status:</p>
            <p className="mt-0.5 leading-relaxed">{feedback}</p>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Primary Details Grid */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-lg">
          <span className="text-slate-400 flex items-center gap-1.5 mb-1 font-medium">
            <MapPin className="w-3.5 h-3.5 text-amber-400" />
            Location & Pincode
          </span>
          <p className="font-semibold text-slate-200">
            PIN: {incident.pincode ? incident.pincode : 'PIN code unavailable'}
          </p>
          <p className="font-mono text-slate-400 text-[11px] mt-0.5">
            {incident.lat.toFixed(5)}, {incident.lon.toFixed(5)}
          </p>
        </div>

        <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-lg">
          <span className="text-slate-400 flex items-center gap-1.5 mb-1 font-medium">
            <Building className="w-3.5 h-3.5 text-blue-400" />
            Impact Metrics
          </span>
          <p className="font-semibold text-slate-200">
            {incident.households_affected.toLocaleString()} Households
          </p>
          <p className="font-mono text-slate-400 text-[11px] mt-0.5">
            {incident.affected_pole_ids.length} Poles Dark
          </p>
        </div>
      </div>

      {/* Confidence Reason */}
      <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-lg space-y-1 text-xs">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-300">
            Topology & Confidence
          </span>
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
              isKnown
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
            }`}
          >
            {isKnown ? 'KNOWN (Digitized)' : 'INFERRED (MST)'} —{' '}
            {(incident.confidence * 100).toFixed(0)}%
          </span>
        </div>
        <p className="text-slate-400 text-xs leading-relaxed pt-1">
          {incident.confidence_reason}
        </p>
      </div>

      {/* Action Buttons (Lifecycle State Machine) */}
      <div className="pt-2">
        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
          Control Room Operator Actions (Current Status:{' '}
          <span className="text-amber-400">{incident.status}</span>)
        </label>
        <div className="grid grid-cols-3 gap-2">
          <button
            disabled={loading || incident.status !== 'detected'}
            onClick={() => handleAction('acknowledge')}
            className="flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 rounded-lg text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Acknowledge
          </button>

          <button
            disabled={
              loading ||
              (incident.status !== 'acknowledged' && incident.status !== 'detected')
            }
            onClick={() => handleAction('assign-crew')}
            className="flex items-center justify-center gap-1.5 px-3 py-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/40 rounded-lg text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <UserCheck className="w-3.5 h-3.5" />
            Assign Crew
          </button>

          <button
            disabled={
              loading ||
              (incident.status !== 'crew_assigned' &&
                incident.status !== 'acknowledged')
            }
            onClick={() => handleAction('resolve')}
            className="flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 rounded-lg text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Wrench className="w-3.5 h-3.5" />
            Resolve
          </button>
        </div>
      </div>
    </div>
  )
}
