import { useEffect, useState } from 'react'

export const API_URL = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8044').replace(/\/$/, '')

async function getJson(path) {
  const response = await fetch(`${API_URL}${path}`)
  if (!response.ok) throw new Error(`${path} returned ${response.status}`)
  return response.json()
}

// Polls the API for the fleet, the potholes it has found and its own health.
// The three calls go together so the dashboard never shows one from a different moment.
// `refresh` fetches now, without waiting for the next poll.
export function useFleet(live, intervalMs = 5000) {
  const [state, setState] = useState({ devices: [], clusters: [], updatedAt: null, error: null, loading: true })
  const [manualRefreshes, setManualRefreshes] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const [devices, clusters] = await Promise.all([getJson('/v1/devices'), getJson('/v1/clusters'), getJson('/health')])
        if (!cancelled) setState({ devices, clusters, updatedAt: new Date(), error: null, loading: false })
      } catch (error) {
        // Keep the last good data on screen so a blip does not blank the dashboard.
        if (!cancelled) setState((prev) => ({ ...prev, error: error.message, loading: false }))
      }
    }

    load()
    const timer = live ? setInterval(load, intervalMs) : null
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [live, intervalMs, manualRefreshes])

  return { ...state, refresh: () => setManualRefreshes((n) => n + 1) }
}
