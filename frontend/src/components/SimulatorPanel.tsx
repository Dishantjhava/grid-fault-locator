import React, { useState } from 'react'
import { DistributionTransformer } from '../types/grid'
import {
  Play,
  ZapOff,
  AlertTriangle,
  Flame,
  Radio,
  Calendar,
  RotateCcw,
  CheckCircle2,
} from 'lucide-react'

interface SimulatorPanelProps {
  transformers: DistributionTransformer[]
  onSimulationRun: () => void
}

export const SimulatorPanel: React.FC<SimulatorPanelProps> = ({
  transformers,
  onSimulationRun,
}) => {
  const [selectedDt, setSelectedDt] = useState<string>(
    transformers[0]?.dt_id || 'DT-001'
  )
  const [instantMode, setInstantMode] = useState<boolean>(false)
  const [loading, setLoading] = useState(false)
  const [resultMsg, setResultMsg] = useState<string | null>(null)

  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'

  const handleInject = async (
    action:
      | 'span_fault'
      | 'dt_fault'
      | 'feeder_fault'
      | 'dead_sensor'
      | 'scheduled_outage'
      | 'repair'
  ) => {
    setLoading(true)
    setResultMsg(null)

    try {
      const res = await fetch(`${backendUrl}/simulator/inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          dt_id: selectedDt,
          reason: 'Control Room Simulator Trigger',
          ...(instantMode ? { bypass_debounce: true } : {}),
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Simulation failed')

      if (action === 'repair') {
        setResultMsg(`Power restored for ${selectedDt}. Incidents re-evaluated.`)
      } else if (data.is_debouncing && !instantMode) {
        setResultMsg(
          `Triggered ${action.replace('_', ' ').toUpperCase()} on ${selectedDt}. ⏳ Debouncing active: stabilization timer started (incident will auto-publish to sidebar in 45s). Check "Instant mode" to skip waiting.`
        )
      } else {
        setResultMsg(
          `Triggered ${action.replace('_', ' ').toUpperCase()} on ${selectedDt}. Created ${data.incidents_created ?? 0} incident(s).`
        )
      }

      onSimulationRun()
    } catch (err: any) {
      setResultMsg(`Error: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-slate-900 border-t border-slate-800 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Play className="w-4 h-4 text-amber-400 fill-amber-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
            Grid Telemetry Simulator Control Panel
          </h3>
        </div>

        {/* Controls: Instant Mode Toggle & Target DT */}
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={instantMode}
              onChange={(e) => setInstantMode(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-slate-700 bg-slate-950 text-amber-500 focus:ring-amber-500 focus:ring-offset-slate-900"
            />
            <span>Instant mode (skip 45s debounce)</span>
          </label>

          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400 font-medium">Target DT:</label>
            <select
              value={selectedDt}
              onChange={(e) => setSelectedDt(e.target.value)}
              className="bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1 focus:outline-none focus:border-amber-500 font-mono"
            >
              {transformers.map((dt) => (
                <option key={dt.dt_id} value={dt.dt_id}>
                  {dt.dt_id} ({dt.poles?.length || 0} poles, {dt.feeder_id})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {resultMsg && (
        <div className="p-2.5 bg-slate-950 border border-amber-500/30 text-amber-300 text-xs rounded-lg flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="font-mono">{resultMsg}</span>
        </div>
      )}

      {/* Simulator Action Buttons */}
      <div className="grid grid-cols-6 gap-2 pt-1">
        <button
          disabled={loading}
          onClick={() => handleInject('span_fault')}
          className="flex items-center justify-center gap-1.5 px-3 py-2 bg-red-950/60 hover:bg-red-900/60 text-red-300 border border-red-800/80 rounded-lg text-xs font-medium transition disabled:opacity-50"
        >
          <ZapOff className="w-3.5 h-3.5" />
          Span Fault
        </button>

        <button
          disabled={loading}
          onClick={() => handleInject('dt_fault')}
          className="flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-950/60 hover:bg-amber-900/60 text-amber-300 border border-amber-800/80 rounded-lg text-xs font-medium transition disabled:opacity-50"
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          DT Fault
        </button>

        <button
          disabled={loading}
          onClick={() => handleInject('feeder_fault')}
          className="flex items-center justify-center gap-1.5 px-3 py-2 bg-orange-950/60 hover:bg-orange-900/60 text-orange-300 border border-orange-800/80 rounded-lg text-xs font-medium transition disabled:opacity-50"
        >
          <Flame className="w-3.5 h-3.5" />
          Feeder Fault
        </button>

        <button
          disabled={loading}
          onClick={() => handleInject('dead_sensor')}
          className="flex items-center justify-center gap-1.5 px-3 py-2 bg-yellow-950/60 hover:bg-yellow-900/60 text-yellow-300 border border-yellow-800/80 rounded-lg text-xs font-medium transition disabled:opacity-50"
        >
          <Radio className="w-3.5 h-3.5" />
          Dead Sensor
        </button>

        <button
          disabled={loading}
          onClick={() => handleInject('scheduled_outage')}
          className="flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-950/60 hover:bg-blue-900/60 text-blue-300 border border-blue-800/80 rounded-lg text-xs font-medium transition disabled:opacity-50"
        >
          <Calendar className="w-3.5 h-3.5" />
          Sched Outage
        </button>

        <button
          disabled={loading}
          onClick={() => handleInject('repair')}
          className="flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-800/80 rounded-lg text-xs font-medium transition disabled:opacity-50"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Repair Power
        </button>
      </div>
    </div>
  )
}
