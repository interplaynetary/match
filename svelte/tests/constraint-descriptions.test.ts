import { test, expect, describe } from 'bun:test'
import { Matcher, describeTimeConstraint } from '../src/lib/core/matcher'
import type { Need, Capacity, ConstraintDetail } from '../src/lib/core/types'

// Helper to get the time detail from a match (BOTH sides must have constraints)
function getTimeDetail(needTime: unknown, capacityTime: unknown): ConstraintDetail | undefined {
  const matcher = new Matcher({ similarityThreshold: 0 })
  const need: Need = {
    id: 'n1',
    expressions: [{ text: 'test' }],
    embedding: [1, 0, 0],
    constraints: needTime ? { time: needTime as any } : undefined,
  }
  const capacity: Capacity = {
    id: 'c1',
    expressions: [{ text: 'test' }],
    embedding: [1, 0, 0],
    constraints: capacityTime ? { time: capacityTime as any } : undefined,
  }
  const matches = matcher.findMatches(need, [capacity])
  return matches[0]?.breakdown.timeDetail
}

describe('Time Constraint Descriptions', () => {
  test('no constraints on either side - no timeDetail in breakdown', () => {
    const matcher = new Matcher({ similarityThreshold: 0 })
    const need: Need = {
      id: 'n1',
      expressions: [{ text: 'test' }],
      embedding: [1, 0, 0],
    }
    const capacity: Capacity = {
      id: 'c1',
      expressions: [{ text: 'test' }],
      embedding: [1, 0, 0],
    }
    const matches = matcher.findMatches(need, [capacity])
    expect(matches[0]?.breakdown.timeDetail).toBeUndefined()
  })

  test('one side has no time constraint - shows 0.5 score (uncertainty)', () => {
    // Need has no time constraint, capacity does - uncertainty
    const detail1 = getTimeDetail(undefined, {
      availableFrom: '2024-01-27',
      availableTo: '2024-01-28',
    })
    expect(detail1?.score).toBe(0.5)
    expect(detail1?.needDesc).toBe('any time')
    expect(detail1?.capacityDesc).toContain('2024-01-27')

    // Capacity has no time constraint, need does - uncertainty
    const detail2 = getTimeDetail({ dayOfWeek: 'Saturday' }, undefined)
    expect(detail2?.score).toBe(0.5)
    expect(detail2?.needDesc).toContain('Saturday')
    expect(detail2?.capacityDesc).toBe('any time')
  })

  test('both sides have time constraints - shows comparison', () => {
    const detail = getTimeDetail(
      { dayOfWeek: 'Monday' },
      { dayOfWeek: 'Monday' }
    )
    expect(detail).toBeDefined()
    expect(detail?.needDesc).toContain('Monday')
    expect(detail?.capacityDesc).toContain('Monday')
  })
})

describe('Time Description Function (standalone)', () => {
  // Test the description function directly for coverage
  test('date range', () => {
    const desc = describeTimeConstraint({
      availableFrom: '2024-01-27',
      availableTo: '2024-01-28',
    } as any)
    expect(desc).toContain('2024-01-27 to 2024-01-28')
  })

  test('day and time', () => {
    const desc = describeTimeConstraint({
      dayOfWeek: 'Saturday',
      timeOfDay: 'afternoon',
    } as any)
    expect(desc).toContain('Saturday')
    expect(desc).toContain('afternoon')
  })

  test('days array with hours object', () => {
    const desc = describeTimeConstraint({
      recurring: true,
      days: ['Monday', 'Tuesday', 'Wednesday'],
      hours: { start: '09:00', end: '17:00' },
      timezone: 'EST',
    } as any)
    expect(desc).toContain('Monday')
    expect(desc).toContain('Tuesday')
    expect(desc).toContain('Wednesday')
    expect(desc).toContain('09:00-17:00')
    expect(desc).toContain('EST')
  })

  test('single date', () => {
    const desc = describeTimeConstraint({ date: '2024-06-15' } as any)
    expect(desc).toContain('2024-06-15')
  })

  test('urgency', () => {
    const desc = describeTimeConstraint({ urgency: 'immediate' } as any)
    expect(desc).toContain('immediate')
  })

  test('many days are summarized', () => {
    const desc = describeTimeConstraint({
      days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    } as any)
    expect(desc).toContain('5 days')
  })

  test('recurring as boolean does not show "(true)"', () => {
    const desc = describeTimeConstraint({ recurring: true } as any)
    expect(desc).not.toContain('(true)')
    expect(desc).not.toContain('true')
  })

  test('recurring as string shows the value', () => {
    const desc = describeTimeConstraint({ recurring: 'weekly' } as any)
    expect(desc).toContain('weekly')
  })
})

describe('Quantity Constraint Descriptions', () => {
  function getQuantityDetail(needQty: unknown, capacityQty: unknown): ConstraintDetail | undefined {
    const matcher = new Matcher({ similarityThreshold: 0 })
    const need: Need = {
      id: 'n1',
      expressions: [{ text: 'test' }],
      embedding: [1, 0, 0],
      constraints: needQty ? { quantity: needQty as any } : undefined,
    }
    const capacity: Capacity = {
      id: 'c1',
      expressions: [{ text: 'test' }],
      embedding: [1, 0, 0],
      constraints: capacityQty ? { quantity: capacityQty as any } : undefined,
    }
    const matches = matcher.findMatches(need, [capacity])
    return matches[0]?.breakdown.quantityDetail
  }

  test('one side has no quantity - shows 0.5 score (uncertainty)', () => {
    const detail = getQuantityDetail({ amount: 2, unit: 'kg' }, undefined)
    expect(detail?.score).toBe(0.5)
    expect(detail?.needDesc).toBe('2kg')
    expect(detail?.capacityDesc).toBe('any amount')
  })

  test('sufficient capacity', () => {
    const detail = getQuantityDetail(
      { amount: 2, unit: 'kg' },
      { amount: 5, unit: 'kg' }
    )
    expect(detail?.needDesc).toBe('2kg')
    expect(detail?.capacityDesc).toBe('5kg')
    expect(detail?.score).toBe(1.0)
  })

  test('insufficient capacity', () => {
    const detail = getQuantityDetail(
      { amount: 10, unit: 'kg' },
      { amount: 5, unit: 'kg' }
    )
    expect(detail?.needDesc).toBe('10kg')
    expect(detail?.capacityDesc).toBe('5kg')
    expect(detail?.score).toBe(0.5)
  })

  test('unit mismatch', () => {
    const detail = getQuantityDetail(
      { amount: 2, unit: 'kg' },
      { amount: 5, unit: 'lbs' }
    )
    expect(detail?.needDesc).toBe('2kg')
    expect(detail?.capacityDesc).toBe('5lbs')
    expect(detail?.score).toBe(0.0)
    expect(detail?.reason).toContain('mismatch')
  })
})

describe('Space Constraint Descriptions', () => {
  function getSpaceDetail(needSpace: unknown, capacitySpace: unknown): ConstraintDetail | undefined {
    const matcher = new Matcher({ similarityThreshold: 0 })
    const need: Need = {
      id: 'n1',
      expressions: [{ text: 'test' }],
      embedding: [1, 0, 0],
      constraints: needSpace ? { space: needSpace as any } : undefined,
    }
    const capacity: Capacity = {
      id: 'c1',
      expressions: [{ text: 'test' }],
      embedding: [1, 0, 0],
      constraints: capacitySpace ? { space: capacitySpace as any } : undefined,
    }
    const matches = matcher.findMatches(need, [capacity])
    return matches[0]?.breakdown.spaceDetail
  }

  test('one side has no space constraint - shows 0.5 score (uncertainty)', () => {
    const detail = getSpaceDetail({ remote: true }, undefined)
    expect(detail?.score).toBe(0.5)
    expect(detail?.needDesc).toBe('remote')
    expect(detail?.capacityDesc).toBe('any location')
  })

  test('both remote', () => {
    const detail = getSpaceDetail({ remote: true }, { remote: true })
    expect(detail?.needDesc).toBe('remote')
    expect(detail?.capacityDesc).toBe('remote')
  })

  test('one remote, one not', () => {
    const detail = getSpaceDetail({ remote: true }, { area: 'Oakland' })
    expect(detail?.needDesc).toBe('remote')
    expect(detail?.capacityDesc).toBe('Oakland')
  })

  test('same area', () => {
    const detail = getSpaceDetail({ area: 'Oakland' }, { area: 'Oakland' })
    expect(detail?.needDesc).toBe('Oakland')
    expect(detail?.capacityDesc).toBe('Oakland')
  })

  test('different areas', () => {
    const detail = getSpaceDetail({ area: 'Oakland' }, { area: 'San Francisco' })
    expect(detail?.needDesc).toBe('Oakland')
    expect(detail?.capacityDesc).toBe('San Francisco')
  })

  test('distance within radius', () => {
    // Oakland to SF is roughly 13km
    const detail = getSpaceDetail(
      { location: { lat: 37.8044, lng: -122.2712 }, maxRadius: 50 },
      { location: { lat: 37.7749, lng: -122.4194 } }
    )
    expect(detail?.reason).toMatch(/\d+(\.\d+)?km apart/)
    expect(detail?.score).toBeGreaterThan(0)
  })

  test('distance outside radius', () => {
    // Oakland to LA is roughly 550km
    const detail = getSpaceDetail(
      { location: { lat: 37.8044, lng: -122.2712 }, maxRadius: 50 },
      { location: { lat: 34.0522, lng: -118.2437 } }
    )
    expect(detail?.reason).toMatch(/\d+(\.\d+)?km apart/)
    expect(detail?.score).toBe(0)
  })
})
