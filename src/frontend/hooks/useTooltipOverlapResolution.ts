import { useEffect } from 'react'
import type { ConnectedTooltip } from '../types.ts'

export function useTooltipOverlapResolution(
  tooltips: ConnectedTooltip[],
  containerRef: React.RefObject<HTMLDivElement | null>,
  mainTooltipRef: React.RefObject<HTMLDivElement | null>
): void {
  useEffect(() => {
    if (tooltips.length === 0 || !containerRef.current || !mainTooltipRef.current) return

    const container = containerRef.current
    const tipEls = Array.from(container.children) as HTMLElement[]
    if (tipEls.length === 0) return

    // Get dimensions and initial positions
    const placedRects: Array<{
      el: HTMLElement
      x: number
      y: number
      width: number
      height: number
    }> = []

    tipEls.forEach((el, i) => {
      const tip = tooltips[i]
      if (!tip) return
      const rect = el.getBoundingClientRect()
      placedRects.push({
        el,
        x: tip.x - rect.width / 2,
        y: tip.y - rect.height - 10,
        width: rect.width,
        height: rect.height,
      })
    })

    // Include main tooltip in repulsion (but don't move it)
    const mainTipRect = mainTooltipRef.current.getBoundingClientRect()
    const mainTip = {
      x: mainTipRect.left,
      y: mainTipRect.top,
      width: mainTipRect.width,
      height: mainTipRect.height,
    }

    // Force simulation to resolve overlaps
    const gap = 10
    for (let iter = 0; iter < 100; iter++) {
      let hasOverlap = false

      // Check connected tooltips against main tooltip
      for (const rect of placedRects) {
        const overlapX = Math.min(rect.x + rect.width, mainTip.x + mainTip.width) - Math.max(rect.x, mainTip.x)
        const overlapY = Math.min(rect.y + rect.height, mainTip.y + mainTip.height) - Math.max(rect.y, mainTip.y)
        if (overlapX > -gap && overlapY > -gap) {
          const sepX = overlapX + gap
          const sepY = overlapY + gap
          if (sepX > 0 && sepY > 0) {
            hasOverlap = true
            const rectCx = rect.x + rect.width / 2
            const rectCy = rect.y + rect.height / 2
            const mainCx = mainTip.x + mainTip.width / 2
            const mainCy = mainTip.y + mainTip.height / 2
            // Only move the connected tooltip, not the main one
            if (sepX < sepY) {
              const shift = sepX + 1
              rect.x += rectCx <= mainCx ? -shift : shift
            } else {
              const shift = sepY + 1
              rect.y += rectCy <= mainCy ? -shift : shift
            }
          }
        }
      }

      // Check connected tooltips against each other
      for (let i = 0; i < placedRects.length; i++) {
        for (let j = i + 1; j < placedRects.length; j++) {
          const a = placedRects[i]!
          const b = placedRects[j]!
          const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
          const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
          if (overlapX > -gap && overlapY > -gap) {
            const sepX = overlapX + gap
            const sepY = overlapY + gap
            if (sepX > 0 && sepY > 0) {
              hasOverlap = true
              const aCx = a.x + a.width / 2
              const bCx = b.x + b.width / 2
              const aCy = a.y + a.height / 2
              const bCy = b.y + b.height / 2
              if (sepX < sepY) {
                const shift = sepX / 2 + 0.5
                if (aCx <= bCx) {
                  a.x -= shift
                  b.x += shift
                } else {
                  a.x += shift
                  b.x -= shift
                }
              } else {
                const shift = sepY / 2 + 0.5
                if (aCy <= bCy) {
                  a.y -= shift
                  b.y += shift
                } else {
                  a.y += shift
                  b.y -= shift
                }
              }
            }
          }
        }
      }
      if (!hasOverlap) break
    }

    // Apply final positions
    for (const rect of placedRects) {
      rect.el.style.left = rect.x + 'px'
      rect.el.style.top = rect.y + 'px'
    }
  }, [tooltips, containerRef, mainTooltipRef])
}
