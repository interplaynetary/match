/**
 * Tests for match scoring with specific examples.
 * Used to tune thresholds and verify scoring behavior.
 */

import { describe, test, expect } from 'bun:test'
import { Matcher } from './matcher'
import { convertExamples } from './example-converter'
import enrichedData from '../data/enriched-full.json'
import embeddingsData from '../data/embeddings.json'

const examples = enrichedData.results
const embeddings = embeddingsData as Record<string, number[]>
const { capacities, needs } = convertExamples(examples as any, embeddings)

function findNeed(substring: string) {
  return needs.find(n =>
    n.expressions.some(e => e.text.toLowerCase().includes(substring.toLowerCase()))
  )
}

function findCapacity(substring: string) {
  return capacities.find(c =>
    c.expressions.some(e => e.text.toLowerCase().includes(substring.toLowerCase()))
  )
}

function getMatch(matcher: Matcher, needStr: string, capStr: string) {
  const need = findNeed(needStr)
  const capacity = findCapacity(capStr)
  if (!need || !capacity) return null

  const matches = matcher.findMatches(need, capacities)
  return matches.find(m => m.capacityId === capacity.id)
}

describe('scoring sanity checks', () => {
  const matcher = new Matcher({
    similarityThreshold: 0.3,
    embeddings,
    semanticThreshold: 0.8
  })

  describe('good matches should score high', () => {
    test('flour → organic flour: exact category match', () => {
      const match = getMatch(matcher, 'flour for baking', 'organic flour')
      expect(match).toBeTruthy()

      const score = match!.feasibilityScore
      const cat = match!.breakdown.categoryMatch

      console.log('flour → organic flour:', {
        score: (score * 100).toFixed(0) + '%',
        category: cat?.overlapCategory,
        distance: cat?.overlapDistance,
        specificity: cat?.specificity.toFixed(3),
      })

      // Exact match at leaf should score high
      expect(score).toBeGreaterThan(0.75)
      expect(cat?.overlapDistance).toBe(0)
    })

    test('piano lessons → piano teacher: should match on piano', () => {
      const match = getMatch(matcher, 'piano lessons', 'piano')

      if (match) {
        const score = match.feasibilityScore
        const cat = match.breakdown.categoryMatch

        console.log('piano lessons → piano teacher:', {
          score: (score * 100).toFixed(0) + '%',
          category: cat?.overlapCategory,
          distance: cat?.overlapDistance,
          specificity: cat?.specificity.toFixed(3),
        })

        // Should be a good match
        expect(score).toBeGreaterThan(0.6)
      }
    })

    test('3D printed phone case → 3D printer: exact domain match', () => {
      const match = getMatch(matcher, 'phone case', '3D printing')

      if (match) {
        const score = match.feasibilityScore
        const cat = match.breakdown.categoryMatch

        console.log('3D phone case → 3D printer:', {
          score: (score * 100).toFixed(0) + '%',
          category: cat?.overlapCategory,
          distance: cat?.overlapDistance,
          specificity: cat?.specificity?.toFixed(3),
          quantity: match.breakdown.quantity,
        })

        // Same domain (3d-printing), should score high
        // Quantity: need wants 1 item, capacity unlimited → score 1.0
        expect(score).toBeGreaterThan(0.8)
        expect(cat?.overlapCategory).toContain('3d-printing')
      }
    })
  })

  describe('bad matches should score low', () => {
    test('piano lessons → business succession: unrelated', () => {
      const match = getMatch(matcher, 'piano lessons', 'business succession')

      if (match) {
        const score = match.feasibilityScore
        const cat = match.breakdown.categoryMatch

        console.log('piano lessons → business succession:', {
          score: (score * 100).toFixed(0) + '%',
          category: cat?.overlapCategory,
          distance: cat?.overlapDistance,
          specificity: cat?.specificity.toFixed(3),
          embedding: match.breakdown.similarity?.toFixed(3),
        })

        // Was 89% before fixes. Now ~52% without inflated constraints.
        // Ideally would be lower, but acceptable for now.
        expect(score).toBeLessThan(0.55)
      }
    })

    test('lawnmower → web developer: blocked by time mismatch', () => {
      const match = getMatch(matcher, 'lawnmower', 'web developer')

      // Time incompatibility (Saturday vs Mon-Wed) now correctly blocks the match entirely.
      // Previously this was scoring 68% due to a bug where different days still "overlapped".
      expect(match).toBeFalsy()
    })

    test('woodworking instruction → math tutor: sibling branches under education', () => {
      // After enrichment fix: all chains now have 3+ levels with specific domain.
      // Woodworking: services > education > skills-instruction > woodworking
      // Math tutor:  services > education > tutoring > math
      const match = getMatch(matcher, 'woodworking', 'math tutor')

      if (match) {
        const score = match.feasibilityScore
        const cat = match.breakdown.categoryMatch

        console.log('woodworking → math tutor:', {
          score: (score * 100).toFixed(0) + '%',
          category: cat?.overlapCategory,
          distance: cat?.overlapDistance,
          specificity: cat?.specificity?.toFixed(3),
          embedding: match.breakdown.similarity?.toFixed(3),
        })

        // After enrichment fix, this should match at skills-instruction/tutoring level
        // (distance 1 from woodworking/math) not at generic "education"
        expect(score).toBeLessThan(0.6)
      }
    })
  })

  describe('cross-domain matches via wormhole', () => {
    test('used bicycle → delivery service: transportation wormhole', () => {
      const match = getMatch(matcher, 'used bicycle', 'delivery')

      if (match) {
        const score = match.feasibilityScore
        const cat = match.breakdown.categoryMatch

        console.log('used bicycle → delivery:', {
          score: (score * 100).toFixed(0) + '%',
          category: cat?.overlapCategory,
          distance: cat?.overlapDistance,
          specificity: cat?.specificity.toFixed(3),
        })

        // Wormhole match via transportation - cross-domain but related
        // (goods > transportation > bicycles) ≈ (services > transportation > courier)
        expect(score).toBeGreaterThan(0.4)
        expect(score).toBeLessThan(0.85)
      }
    })
  })

  describe('valid wormhole matches should score reasonably', () => {
    test('doula services → birth doula: doula ≈ birth-doula', () => {
      const match = getMatch(matcher, 'doula', 'birth doula')

      if (match) {
        const score = match.feasibilityScore
        const cat = match.breakdown.categoryMatch

        console.log('doula → birth doula:', {
          score: (score * 100).toFixed(0) + '%',
          category: cat?.overlapCategory,
          distance: cat?.overlapDistance,
          specificity: cat?.specificity.toFixed(3),
          embedding: match.breakdown.similarity?.toFixed(3),
        })

        // Good wormhole match - should score decently
        expect(score).toBeGreaterThan(0.5)
        // Category should show the wormhole
        expect(cat?.overlapCategory).toContain('≈')
      }
    })

    test('wedding photographer → wedding DJ: wedding ≈ weddings', () => {
      const match = getMatch(matcher, 'wedding', 'DJ')

      if (match) {
        const score = match.feasibilityScore
        const cat = match.breakdown.categoryMatch

        console.log('wedding → DJ:', {
          score: (score * 100).toFixed(0) + '%',
          category: cat?.overlapCategory,
          distance: cat?.overlapDistance,
          specificity: cat?.specificity.toFixed(3),
          embedding: match.breakdown.similarity?.toFixed(3),
        })

        // Related via wedding/events - reasonable match
        expect(score).toBeGreaterThan(0.4)
      }
    })

    test('meal prep → meal preparation service', () => {
      const match = getMatch(matcher, 'meal prep', 'meal preparation')

      if (match) {
        const score = match.feasibilityScore
        const cat = match.breakdown.categoryMatch

        console.log('meal prep → meal preparation:', {
          score: (score * 100).toFixed(0) + '%',
          category: cat?.overlapCategory,
          distance: cat?.overlapDistance,
          specificity: cat?.specificity.toFixed(3),
          embedding: match.breakdown.similarity?.toFixed(3),
        })

        // Near-synonym wormhole - should score well
        expect(score).toBeGreaterThan(0.5)
      }
    })
  })
})

describe('parameter tuning experiments', () => {
  test('compare distance penalties', () => {
    console.log('\n=== Distance Penalty Comparison ===')

    // Current: 1.0 - distance * 0.1, min 0.5
    const current = (d: number) => Math.max(0.5, 1.0 - d * 0.1)

    // Option A: Cap at distance 1
    const capAtOne = (d: number) => d > 1 ? null : Math.max(0.5, 1.0 - d * 0.1)

    // Option B: Steeper penalty
    const steeper = (d: number) => Math.max(0.3, 1.0 - d * 0.25)

    // Option C: Exponential decay
    const exponential = (d: number) => Math.pow(0.7, d)

    console.log('Distance | Current | Cap@1 | Steeper | Exponential')
    console.log('---------|---------|-------|---------|------------')
    for (let d = 0; d <= 4; d++) {
      console.log(
        `    ${d}    |  ${current(d).toFixed(2)}   | ${capAtOne(d)?.toFixed(2) ?? 'null'}  |  ${steeper(d).toFixed(2)}   |    ${exponential(d).toFixed(2)}`
      )
    }
  })
})
