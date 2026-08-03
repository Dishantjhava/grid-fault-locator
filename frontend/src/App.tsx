import { useState, useEffect } from 'react'

type HealthResponse = {
  status: string
}

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/health')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<HealthResponse>
      })
      .then((data) => {
        setHealth(data)
        setLoading(false)
      })
      .catch((err: Error) => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="bg-gray-800 rounded-lg p-8 text-center shadow-xl">
        <h1 className="text-2xl font-bold text-white mb-2">Grid Fault Locator</h1>
        <p className="text-gray-400 text-sm mb-6">Karnataka State Power Distribution Board</p>

        <div className="border border-gray-700 rounded p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Backend Health</p>

          {loading && (
            <p className="text-gray-400">Checking…</p>
          )}

          {!loading && error && (
            <p className="text-red-400 font-mono text-sm">
              ✗ Unreachable — {error}
            </p>
          )}

          {!loading && health && (
            <p className="text-green-400 font-mono text-sm">
              ✓ status: "{health.status}"
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
