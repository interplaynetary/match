import { useState, useRef, useCallback } from 'react'
import type { MatchData, ConnectedTooltip } from '../types.ts'
import { getNodeColor } from '../utils.ts'

export function useConnectedTooltips(
  data: MatchData | null,
  connections: Map<string, string[]>
): {
  tooltips: ConnectedTooltip[]
  show: (nodeId: string) => void
  hide: () => void
  ref: React.RefObject<HTMLDivElement | null>
} {
  const [tooltips, setTooltips] = useState<ConnectedTooltip[]>([])
  const ref = useRef<HTMLDivElement>(null)

  const show = useCallback(
    (nodeId: string) => {
      if (!data) return

      const connectedIds = connections.get(nodeId) || []
      const newTooltips: ConnectedTooltip[] = []

      for (const id of connectedIds) {
        // Only show tooltip if the connecting chord is visible
        const chord = document.querySelector(
          `.chord[data-cap="${nodeId}"][data-need="${id}"], .chord[data-cap="${id}"][data-need="${nodeId}"]`
        ) as HTMLElement | null
        if (!chord || chord.style.display === 'none') continue

        const cap = data.capacities.find((c) => c.id === id)
        const need = data.needs.find((n) => n.id === id)
        const item = cap || need
        if (!item) continue

        const isCapacity = !!cap
        const color = getNodeColor(item.embedding, data.pcaTransform, isCapacity)

        const nodeEl = document.querySelector(`.node[data-id="${id}"]`)
        if (!nodeEl) continue

        const rect = nodeEl.getBoundingClientRect()
        const label = item.label || item.expressions?.join(', ')

        newTooltips.push({
          id,
          isCapacity,
          label: label || '',
          color,
          x: rect.left + rect.width / 2,
          y: rect.top,
        })
      }

      setTooltips(newTooltips)
    },
    [data, connections]
  )

  const hide = useCallback(() => setTooltips([]), [])

  return { tooltips, show, hide, ref }
}
