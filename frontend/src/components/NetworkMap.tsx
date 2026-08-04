import React from 'react'
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  Circle,
  Polygon,
} from 'react-leaflet'
import { DistributionTransformer, Incident, Pole } from '../types/grid'

interface NetworkMapProps {
  transformers: DistributionTransformer[]
  incidents: Incident[]
  selectedIncident: Incident | null
  onSelectIncident: (incident: Incident) => void
}

export const NetworkMap: React.FC<NetworkMapProps> = ({
  transformers,
  incidents,
  selectedIncident,
  onSelectIncident,
}) => {
  // Default map center: Bengaluru BBMP center (12.97, 77.59)
  const defaultCenter: [number, number] = [12.971, 77.591]
  const defaultZoom = 13

  // Flatten poles for map rendering
  const allPoles: Pole[] = transformers.flatMap((dt) => dt.poles)

  return (
    <div className="relative w-full h-full">
      <MapContainer
        center={defaultCenter}
        zoom={defaultZoom}
        scrollWheelZoom={true}
        className="w-full h-full rounded-none"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Render Grid Poles */}
        {allPoles.map((pole) => {
          let fillColor = '#10b981' // Live green
          let radius = 5

          if (!pole.current_energized) {
            fillColor = '#ef4444' // Dark red
            radius = 6
          }

          return (
            <CircleMarker
              key={pole.pole_id}
              center={[pole.lat, pole.lon]}
              radius={radius}
              pathOptions={{
                color: '#0f172a',
                weight: 1,
                fillColor,
                fillOpacity: 0.9,
              }}
            >
              <Popup>
                <div className="text-xs font-sans text-slate-900 space-y-1">
                  <p className="font-bold text-slate-900">{pole.pole_id}</p>
                  <p>Status: {pole.current_energized ? '⚡ LIVE' : '🔴 DARK'}</p>
                  <p>Ward: {pole.ward || 'BBMP'}</p>
                  <p>Type: {pole.pole_type}</p>
                  <p>Device: {pole.device_id || 'None (Unmonitored)'}</p>
                </div>
              </Popup>
            </CircleMarker>
          )
        })}

        {/* Render DT Transformer Anchors */}
        {transformers.map((dt) => (
          <CircleMarker
            key={dt.dt_id}
            center={[dt.lat, dt.lon]}
            radius={9}
            pathOptions={{
              color: '#3b82f6',
              weight: 2,
              fillColor: '#1e3a8a',
              fillOpacity: 0.95,
            }}
          >
            <Popup>
              <div className="text-xs font-sans text-slate-900">
                <p className="font-bold text-blue-900">
                  Transformer #{dt.dt_id}
                </p>
                <p>Feeder: {dt.feeder_id}</p>
                <p>Capacity: {dt.capacity_kva} kVA</p>
                <p>Households: {dt.households_served}</p>
              </div>
            </Popup>
          </CircleMarker>
        ))}

        {/* Render Active Incident Highlights */}
        {incidents.map((inc) => {
          const isSelected = selectedIncident?.id === inc.id
          const isInferred = inc.topology_source === 'inferred'

          // Distinct visuals for known vs inferred
          const strokeColor = isInferred ? '#f59e0b' : '#ef4444' // Amber for inferred, Red for known
          const fillColor = isInferred ? '#fbbf24' : '#f87171'
          const dashArray = isInferred ? '6, 6' : undefined // Dashed boundary for inferred MST

          return (
            <React.Fragment key={inc.id}>
              {/* Highlight Circle Boundary */}
              <Circle
                center={[inc.lat, inc.lon]}
                radius={isSelected ? 180 : 120}
                pathOptions={{
                  color: strokeColor,
                  fillColor,
                  fillOpacity: isSelected ? 0.35 : 0.2,
                  weight: isSelected ? 3 : 2,
                  dashArray,
                }}
                eventHandlers={{
                  click: () => onSelectIncident(inc),
                }}
              >
                <Popup>
                  <div className="text-xs font-sans text-slate-900">
                    <p className="font-bold text-red-700 uppercase">
                      {inc.fault_type} FAULT (#{inc.id})
                    </p>
                    <p>Status: {inc.status}</p>
                    <p>
                      Topology:{' '}
                      <span className="font-bold">
                        {inc.topology_source.toUpperCase()}
                      </span>
                    </p>
                    <p>Impact: {inc.households_affected} households</p>
                  </div>
                </Popup>
              </Circle>
            </React.Fragment>
          )
        })}
      </MapContainer>

      {/* Map Legend Overlay */}
      <div className="absolute bottom-4 left-4 z-[1000] bg-slate-900/90 backdrop-blur border border-slate-800 p-3 rounded-lg text-xs space-y-1.5 text-slate-300 shadow-xl">
        <p className="font-bold text-slate-100 mb-1">Grid Legend</p>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block"></span>
          <span>Live Pole</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-red-500 inline-block"></span>
          <span>Dark Pole</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-blue-600 border border-blue-400 inline-block"></span>
          <span>Transformer (DT)</span>
        </div>
        <div className="flex items-center gap-2 pt-1 border-t border-slate-800">
          <span className="w-3 h-3 rounded-full border-2 border-red-500 bg-red-500/30 inline-block"></span>
          <span>Known Incident</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full border-2 border-dashed border-amber-400 bg-amber-400/30 inline-block"></span>
          <span>Inferred Incident (MST)</span>
        </div>
      </div>
    </div>
  )
}
