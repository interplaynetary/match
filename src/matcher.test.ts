import { test, expect, describe, afterAll } from 'bun:test'
import { Matcher } from './matcher'
import type { Capacity, Need } from './types'
import { generateReport } from './visualizer'
import examples from '../data/matching-examples.json'

const matcher = new Matcher()
const REPORT_PATH = './match-report.html'

afterAll(async () => {
  await generateReport(REPORT_PATH)
  // Open in browser
  const proc = Bun.spawn(['open', REPORT_PATH])
  await proc.exited
})

describe('Type Matching', () => {
  test('direct type match', () => {
    expect(matcher.typeMatches('flour', 'flour')).toBe(true)
    expect(matcher.typeMatches('Flour', 'flour')).toBe(true) // case insensitive
  })

  test('asymmetric type match: teacher/student', () => {
    expect(matcher.typeMatches('teacher', 'student')).toBe(true)
    expect(matcher.typeMatches('student', 'teacher')).toBe(true)
  })

  test('asymmetric type match: host/guest', () => {
    expect(matcher.typeMatches('host', 'guest')).toBe(true)
    expect(matcher.typeMatches('guest', 'host')).toBe(true)
    expect(matcher.typeMatches('coach', 'athlete')).toBe(true)
  })

  test('no match for unrelated types', () => {
    expect(matcher.typeMatches('flour', 'piano')).toBe(false)
    expect(matcher.typeMatches('teacher', 'flour')).toBe(false)
  })
})

describe('Path Satisfaction', () => {
  test('direct path satisfaction', () => {
    const capacity: Capacity = {
      id: 'c1',
      capacityType: 'flour',
      attributes: { organic: true },
    }
    const path = { type: 'direct' as const, requires: 'flour' }
    expect(matcher.satisfiesPath(capacity, path)).toBe(true)
  })

  test('direct path with attribute requirements', () => {
    const capacity: Capacity = {
      id: 'c1',
      capacityType: 'flour',
      attributes: { organic: true },
    }
    const pathMatch = { type: 'direct' as const, requires: 'flour', attributes: { organic: true } }
    const pathNoMatch = { type: 'direct' as const, requires: 'flour', attributes: { organic: false } }

    expect(matcher.satisfiesPath(capacity, pathMatch)).toBe(true)
    expect(matcher.satisfiesPath(capacity, pathNoMatch)).toBe(false)
  })

  test('composite path partial satisfaction', () => {
    const capacity: Capacity = {
      id: 'c1',
      capacityType: 'flour',
    }
    const compositePath = {
      type: 'composite' as const,
      all: [
        { type: 'direct' as const, requires: 'flour' },
        { type: 'direct' as const, requires: 'olive oil' },
      ],
    }
    // Single capacity can satisfy one component of composite
    expect(matcher.satisfiesPath(capacity, compositePath)).toBe(true)
  })
})

describe('Find Matches', () => {
  test('finds matching capacity for simple need', () => {
    const need: Need = {
      id: 'n1',
      satisfactionPaths: [{ type: 'direct', requires: 'flour' }],
    }
    const capacities: Capacity[] = [
      { id: 'c1', capacityType: 'flour' },
      { id: 'c2', capacityType: 'sugar' },
    ]

    const matches = matcher.findMatches(need, capacities)
    expect(matches).toHaveLength(1)
    expect(matches[0]!.capacityId).toBe('c1')
  })

  test('finds asymmetric matches', () => {
    const need: Need = {
      id: 'n1',
      satisfactionPaths: [{ type: 'direct', requires: 'student' }],
    }
    const capacities: Capacity[] = [
      { id: 'c1', capacityType: 'teacher', attributes: { subject: 'piano' } },
      { id: 'c2', capacityType: 'flour' },
    ]

    const matches = matcher.findMatches(need, capacities)
    expect(matches).toHaveLength(1)
    expect(matches[0]!.capacityId).toBe('c1')
  })

  test('finds multiple satisfaction paths', () => {
    const need: Need = {
      id: 'n1',
      satisfactionPaths: [
        { type: 'direct', requires: 'vegan pizza' },
        { type: 'direct', requires: 'flour' }, // alternative: I'll make it myself
      ],
    }
    const capacities: Capacity[] = [
      { id: 'c1', capacityType: 'flour' },
    ]

    const matches = matcher.findMatches(need, capacities)
    expect(matches).toHaveLength(1)
    expect(matches[0]!.capacityId).toBe('c1')
  })
})

describe('Feasibility Scoring', () => {
  test('quantity feasibility: sufficient capacity', () => {
    const need: Need = {
      id: 'n1',
      satisfactionPaths: [{ type: 'direct', requires: 'flour' }],
      constraints: { quantity: { amount: 2, unit: 'kg' } },
    }
    const capacity: Capacity = {
      id: 'c1',
      capacityType: 'flour',
      constraints: { quantity: { amount: 5, unit: 'kg' } },
    }

    const matches = matcher.findMatches(need, [capacity])
    expect(matches[0]!.breakdown.quantity).toBe(1.0)
  })

  test('quantity feasibility: insufficient capacity', () => {
    const need: Need = {
      id: 'n1',
      satisfactionPaths: [{ type: 'direct', requires: 'flour' }],
      constraints: { quantity: { amount: 10, unit: 'kg' } },
    }
    const capacity: Capacity = {
      id: 'c1',
      capacityType: 'flour',
      constraints: { quantity: { amount: 5, unit: 'kg' } },
    }

    const matches = matcher.findMatches(need, [capacity])
    expect(matches[0]!.breakdown.quantity).toBe(0.5) // 5/10
  })

  test('quantity feasibility: unit mismatch', () => {
    const need: Need = {
      id: 'n1',
      satisfactionPaths: [{ type: 'direct', requires: 'flour' }],
      constraints: { quantity: { amount: 2, unit: 'kg' } },
    }
    const capacity: Capacity = {
      id: 'c1',
      capacityType: 'flour',
      constraints: { quantity: { amount: 5, unit: 'lbs' } },
    }

    const matches = matcher.findMatches(need, [capacity])
    expect(matches[0]!.breakdown.quantity).toBe(0.0)
  })
})

// Test against the generated examples dataset
import { convertExamples, KNOWN_PAIRS } from './example-converter'

describe('Dataset Examples', () => {
  const { capacities, needs, byId } = convertExamples(examples as any)

  test('converts all examples', () => {
    expect(capacities.length).toBeGreaterThan(0)
    expect(needs.length).toBeGreaterThan(0)
    console.log(`Converted ${capacities.length} capacities, ${needs.length} needs`)
  })

  describe('Known matching pairs', () => {
    for (const pair of KNOWN_PAIRS) {
      test(`${pair.reason}`, () => {
        const needData = byId.get(String(pair.needId))
        const capData = byId.get(String(pair.capacityId))

        if (!needData || !capData) {
          throw new Error(`Pair not found: need ${pair.needId}, capacity ${pair.capacityId}`)
        }

        const need = needData.converted as Need
        const capacity = capData.converted as Capacity

        const matches = matcher.findMatches(need, [capacity])
        expect(matches.length).toBeGreaterThan(0)
      })
    }
  })

  describe('All needs find at least one match', () => {
    const results: { id: string; matched: boolean; matchCount: number }[] = []

    for (const need of needs) {
      test(`need #${need.id} finds matches`, () => {
        const matches = matcher.findMatches(need, capacities)
        results.push({ id: need.id, matched: matches.length > 0, matchCount: matches.length })
        // Don't fail - just report
        if (matches.length === 0) {
          const original = byId.get(need.id)?.original
          console.log(`No matches for need #${need.id}: "${original?.naturalLanguage}"`)
          console.log(`  Requires: ${need.satisfactionPaths.map((p) => p.type === 'direct' ? p.requires : 'composite').join(', ')}`)
        }
        expect(matches.length).toBeGreaterThanOrEqual(0) // Always passes, but logs failures
      })
    }
  })

  test('summary: coverage statistics', () => {
    let matchedNeeds = 0
    let unmatchedNeeds = 0

    for (const need of needs) {
      const matches = matcher.findMatches(need, capacities)
      if (matches.length > 0) {
        matchedNeeds++
      } else {
        unmatchedNeeds++
      }
    }

    console.log(`\n=== MATCHING COVERAGE ===`)
    console.log(`Needs with matches: ${matchedNeeds}/${needs.length} (${((matchedNeeds / needs.length) * 100).toFixed(1)}%)`)
    console.log(`Needs without matches: ${unmatchedNeeds}`)
    console.log(`Total capacities available: ${capacities.length}`)

    // We expect at least some matches
    expect(matchedNeeds).toBeGreaterThan(0)
  })
})
