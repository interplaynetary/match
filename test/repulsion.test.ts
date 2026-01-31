import { test, expect } from 'bun:test'
import { resolveOverlaps, type Rect } from '../src/repulsion'

function rectsOverlap(a: Rect, b: Rect, gap: number): boolean {
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return overlapX > -gap && overlapY > -gap
}

function assertNoOverlaps(rects: Rect[], gap: number) {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!
      const b = rects[j]!
      const overlaps = rectsOverlap(a, b, gap)
      if (overlaps) {
        throw new Error(`Rects ${i} and ${j} still overlap: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
      }
    }
  }
}

test('no change when rects do not overlap', () => {
  const rects: Rect[] = [
    { x: 0, y: 0, width: 100, height: 50 },
    { x: 200, y: 0, width: 100, height: 50 },
  ]
  const result = resolveOverlaps(rects, 10)

  // Should be unchanged
  expect(result[0]!.x).toBe(0)
  expect(result[1]!.x).toBe(200)
})

test('separates two overlapping rects', () => {
  const rects: Rect[] = [
    { x: 0, y: 0, width: 100, height: 50 },
    { x: 50, y: 0, width: 100, height: 50 },  // overlaps by 50px
  ]
  const result = resolveOverlaps(rects, 10)
  assertNoOverlaps(result, 10)
})

test('separates two vertically overlapping rects', () => {
  const rects: Rect[] = [
    { x: 0, y: 0, width: 100, height: 50 },
    { x: 0, y: 30, width: 100, height: 50 },  // overlaps by 20px vertically
  ]
  const result = resolveOverlaps(rects, 10)
  assertNoOverlaps(result, 10)
})

test('separates three overlapping rects', () => {
  const rects: Rect[] = [
    { x: 0, y: 0, width: 100, height: 50 },
    { x: 50, y: 0, width: 100, height: 50 },
    { x: 100, y: 0, width: 100, height: 50 },
  ]
  const result = resolveOverlaps(rects, 10)
  assertNoOverlaps(result, 10)
})

test('handles many overlapping rects', () => {
  const rects: Rect[] = [
    { x: 100, y: 100, width: 150, height: 60 },
    { x: 120, y: 100, width: 150, height: 60 },
    { x: 140, y: 100, width: 150, height: 60 },
    { x: 160, y: 100, width: 150, height: 60 },
  ]
  const result = resolveOverlaps(rects, 10)
  assertNoOverlaps(result, 10)
})

test('tooltip-like scenario: two wide rects close together', () => {
  // Simulates two tooltips positioned near nodes that are close together
  const rects: Rect[] = [
    { x: 300, y: 150, width: 280, height: 70 },
    { x: 450, y: 150, width: 260, height: 70 },  // overlaps significantly
  ]
  const result = resolveOverlaps(rects, 10)
  assertNoOverlaps(result, 10)
})
