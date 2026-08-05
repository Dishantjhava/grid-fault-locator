import { useState, useEffect, useCallback } from 'react'
import { Incident, DistributionTransformer } from './types/grid'
import { IncidentList } from './components/IncidentList'
import { IncidentDetail } from './components/IncidentDetail'
import { NetworkMap } from './components/NetworkMap'
import { SimulatorPanel } from './components/SimulatorPanel'
import { Activity, RefreshCw, Zap } from 'lucide-react'

export function App() {
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [transformers, setTransformers] = useState<DistributionTransformer[]>([])
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [isRefreshing, setIsRefreshing] = useState(false)

  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'https://grid-fault-locator-production.up.railway.app'

  const fetchData = useCallback(async () => {
    setIsRefreshing(true)
    try {
      // 1. Fetch active incidents
      const incRes = await fetch(`${backendUrl}/incidents`)
      if (incRes.ok) {
        const incData = await incRes.json()
        setIncidents(incData.data || [])

        // If selected incident is updated in backend, refresh selected reference
        if (selectedIncident) {
          const fresh = (incData.data || []).find(
            (i: Incident) => i.id === selectedIncident.id
          )
          if (fresh) setSelectedIncident(fresh)
        }
      }

      // 2. Fetch grid topology network
      const netRes = await fetch(`${backendUrl}/network`)
      if (netRes.ok) {
        const netData = await netRes.json()
        setTransformers(netData.data || [])
      }

      setLastUpdated(new Date())
    } catch (err) {
      console.error('Error fetching grid data:', err)
    } finally {
      setIsRefreshing(false)
    }
  }, [backendUrl, selectedIncident])

  // Polling requirement: Poll every 4 seconds (no WebSockets)
  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 4000)
    return () => clearInterval(interval)
  }, [fetchData])

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 overflow-hidden select-none">
      {/* Control Room Header */}
      <header className="h-14 border-b border-slate-800 bg-slate-900 px-5 flex items-center justify-between shrink-0 shadow-md">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <Zap className="w-5 h-5 text-amber-400 fill-amber-400 animate-pulse" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-wide text-slate-100 uppercase">
              Karnataka Power Distribution — Grid Fault Locator Console
            </h1>
            <p className="text-[11px] text-slate-400 font-mono">
              2 AM Operations Console • Bengaluru BBMP Radial Grid
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-2 text-slate-400">
            <Activity className="w-4 h-4 text-emerald-400 animate-pulse" />
            <span>4s Auto-Polling:</span>
            <span className="text-emerald-400 font-bold">ACTIVE</span>
          </div>

          <div className="h-4 w-px bg-slate-800"></div>

          <button
            onClick={fetchData}
            className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-md transition"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-amber-400' : ''}`}
            />
            <span>{lastUpdated.toLocaleTimeString()}</span>
          </button>
        </div>
      </header>

      {/* Main Grid Workspace */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Sidebar: Active Incidents List */}
        <div className="w-96 shrink-0 h-full">
          <IncidentList
            incidents={incidents}
            selectedIncident={selectedIncident}
            onSelectIncident={(inc) => setSelectedIncident(inc)}
          />
        </div>

        {/* Center/Right: Interactive Leaflet Grid Map */}
        <div className="flex-1 h-full relative">
          <NetworkMap
            transformers={transformers}
            incidents={incidents}
            selectedIncident={selectedIncident}
            onSelectIncident={(inc) => setSelectedIncident(inc)}
          />

          {/* Incident Detail Floating Panel */}
          {selectedIncident && (
            <div className="absolute top-4 right-4 z-[1000] w-96 max-h-[calc(100%-2rem)] overflow-y-auto shadow-2xl">
              <IncidentDetail
                incident={selectedIncident}
                onClose={() => setSelectedIncident(null)}
                onActionComplete={fetchData}
              />
            </div>
          )}
        </div>
      </div>

      {/* Bottom Docked Section: Simulator Control Panel */}
      <div className="shrink-0 border-t border-slate-800">
        <SimulatorPanel
          transformers={transformers}
          onSimulationRun={fetchData}
        />
      </div>
    </div>
  )
}

export default App
