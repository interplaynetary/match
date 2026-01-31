import { useState, useEffect } from 'react'
import type { MatchData } from '../types.ts'

export function useMatchData(): {
  data: MatchData | null
  error: string | null
} {
  const [data, setData] = useState<MatchData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/matches')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch match data')
        return res.json() as Promise<MatchData>
      })
      .then(setData)
      .catch((err: Error) => setError(err.message))
  }, [])

  return { data, error }
}
