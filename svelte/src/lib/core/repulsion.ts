export type Rect = {
  x: number
  y: number
  width: number
  height: number
}

export function resolveOverlaps(rects: Rect[], gap: number): Rect[] {
  // Work on copies
  const result = rects.map(r => ({ ...r }))

  for (let iter = 0; iter < 100; iter++) {
    let hasOverlap = false

    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const a = result[i]!
        const b = result[j]!

        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
        const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)

        if (overlapX > -gap && overlapY > -gap) {
          const sepX = overlapX + gap
          const sepY = overlapY + gap

          if (sepX > 0 && sepY > 0) {
            hasOverlap = true
            const aCx = a.x + a.width / 2, bCx = b.x + b.width / 2
            const aCy = a.y + a.height / 2, bCy = b.y + b.height / 2

            if (sepX < sepY) {
              const shift = sepX / 2 + 0.5
              if (aCx <= bCx) { a.x -= shift; b.x += shift }
              else { a.x += shift; b.x -= shift }
            } else {
              const shift = sepY / 2 + 0.5
              if (aCy <= bCy) { a.y -= shift; b.y += shift }
              else { a.y += shift; b.y -= shift }
            }
          }
        }
      }
    }

    if (!hasOverlap) break
  }

  return result
}
