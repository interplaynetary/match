import { useState, useEffect, useCallback } from 'react'
import type { MatchData } from '../types.ts'

export function useMatchData(): {
  data: MatchData | null
  error: string | null
  refetch: () => Promise<void>
  isLoading: boolean
} {
  const [data, setData] = useState<MatchData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/matches')
      if (!res.ok) throw new Error('Failed to fetch match data')
      const matchData = (await res.json()) as MatchData
      setData(matchData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, error, refetch: fetchData, isLoading }
}
