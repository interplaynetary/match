import type {
  Signifier,
  Feature,
  SymbolicSpace,
  Chain,
  StreamingChain,
  Meaning,
  Distribution,
  Path,
  SubstitutionResult,
  SubstitutionCost,
  SubjectPosition,
  Index,
  SparseGraph,
} from './core';

// ============================================================================
// II. Similarity & Paradigmatic Operations
// ============================================================================

/**
 * Compute similarity between two signifiers based on feature overlap
 * Complexity: O(f) where f = feature count
 * 
 * High similarity → paradigmatic substitution possible
 * Low similarity → metaphoric operation (high semantic cost)
 */
export function similarity(s1: Signifier, s2: Signifier): number {
  const shared = featureIntersection(s1.features, s2.features);
  const conflicting = computeConflicts(s1, s2);
  
  const totalFeatures = s1.features.length + s2.features.length;
  if (totalFeatures === 0) return 0;
  
  const sharedWeight = shared.length / totalFeatures;
  const conflictPenalty = penaltyForConflicts(conflicting);
  
  return Math.max(0, sharedWeight - conflictPenalty);
}

/**
 * Find features shared between two feature sets
 */
function featureIntersection(f1: Feature[], f2: Feature[]): Feature[] {
  return f1.filter(feature1 =>
    f2.some(feature2 =>
      feature1.dimension === feature2.dimension &&
      feature1.value === feature2.value
    )
  );
}

/**
 * Compute conflicting features (features that contradict negations)
 */
function computeConflicts(s1: Signifier, s2: Signifier): Feature[] {
  const conflicts: Feature[] = [];
  
  // s1's features vs s2's negations
  s1.features.forEach(f1 =>
    s2.negations.forEach(n2 => {
      if (f1.dimension === n2.dimension && f1.value === n2.value) {
        conflicts.push(f1);
      }
    })
  );
  
  // s2's features vs s1's negations
  s2.features.forEach(f2 =>
    s1.negations.forEach(n1 => {
      if (f2.dimension === n1.dimension && f2.value === n1.value) {
        conflicts.push(f2);
      }
    })
  );
  
  return conflicts;
}

/**
 * Calculate penalty for feature conflicts
 */
function penaltyForConflicts(conflicts: Feature[]): number {
  return conflicts.length * 0.3; // Configurable penalty weight
}

/**
 * Find all signifiers that can substitute for the given signifier
 * Uses feature index for efficient paradigmatic lookup
 * Complexity: O(k) where k = number of candidates
 */
export function findSubstitutes(
  signifier: Signifier,
  space: SymbolicSpace,
  threshold: number = 0.5
): Signifier[] {
  return space.signifiers
    .filter(s => s.id !== signifier.id)
    .filter(s => similarity(signifier, s) >= threshold)
    .sort((a, b) => similarity(signifier, b) - similarity(signifier, a));
}

// ============================================================================
// IV. Core Operations - Metonymy
// ============================================================================

/**
 * Sample an element from an array (uniform distribution)
 */
function sampleFromArray<T>(arr: T[]): T {
  if (arr.length === 0) {
    throw new Error('Cannot sample from empty array');
  }
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/**
 * Metonymic slide - horizontal movement along contiguity chains
 * Complexity: O(k) where k = steps
 * 
 * Effect: Meaning perpetually deferred through contiguous associations
 * The fundamental movement of desire along the signifying chain
 */
export function metonymicSlide(
  startSignifier: Signifier,
  space: SymbolicSpace,
  steps: number
): Path {
  const signifierMap = new Map(space.signifiers.map(s => [s.id, s]));
  const path: Signifier[] = [startSignifier];
  let currentId = startSignifier.id;
  
  for (let i = 0; i < steps; i++) {
    const adjacentIds = space.syntagmatic[currentId];
    
    if (!adjacentIds || adjacentIds.length === 0) {
      break;
    }
    
    const nextId = sampleFromArray(adjacentIds);
    const nextSignifier = signifierMap.get(nextId);
    
    if (!nextSignifier) break;
    
    path.push(nextSignifier);
    currentId = nextId;
  }
  
  return path;
}

// ============================================================================
// IV. Core Operations - Metaphor
// ============================================================================

/**
 * Calculate semantic fit of a signifier in context
 */
function semanticFit(
  signifier: Signifier,
  chain: Chain,
  position: Index,
  windowSize: number = 3
): number {
  const start = Math.max(0, position - windowSize);
  const end = Math.min(chain.signifiers.length, position + windowSize + 1);
  
  let totalFit = 0;
  let count = 0;
  
  for (let i = start; i < end; i++) {
    if (i === position) continue;
    const contextSignifier = chain.signifiers[i];
    if (contextSignifier) {
      totalFit += similarity(signifier, contextSignifier);
      count++;
    }
  }
  
  return count > 0 ? totalFit / count : 0;
}

/**
 * Extract context around a position
 */
function extractContext(chain: Chain, position: Index, windowSize: number = 3): Signifier[] {
  const start = Math.max(0, position - windowSize);
  const end = Math.min(chain.signifiers.length, position + windowSize + 1);
  return chain.signifiers.slice(start, end).filter((s): s is Signifier => s !== undefined);
}

/**
 * Hash context for signature generation
 */
function hashContext(context: Signifier[]): string {
  return context.map(s => s.id).join(':');
}

/**
 * Recompute meaning for a position based on current context
 */
function recomputeMeaning(chain: Chain, position: Index): Meaning | null {
  const signifier = chain.signifiers[position];
  if (!signifier) return null;
  
  const context = extractContext(chain, position);
  
  return {
    features: signifier.features,
    context_signature: hashContext(context),
    confidence: 0.8, // Would be computed based on context stability
  };
}

/**
 * Propagate feature effects through context window
 * Updates interpretations based on new signifier
 */
function propagateFeatures(chain: Chain, position: Index, windowSize: number = 3): void {
  const start = Math.max(0, position - windowSize);
  const end = Math.min(chain.signifiers.length, position + windowSize + 1);
  
  for (let i = start; i < end; i++) {
    if (chain.interpretations[i]) {
      // Recompute interpretation based on new context
      chain.interpretations[i] = recomputeMeaning(chain, i);
    }
  }
}

/**
 * Metaphoric substitution - vertical operation via similarity
 * Complexity: O(1) + O(window) for feature propagation
 * 
 * Effect: Creates new meaning when substitution violates similarity threshold
 * The condensation that produces symptom, dream-work, poetry
 */
export function substitute(
  oldSignifier: Signifier,
  newSignifier: Signifier,
  chain: Chain,
  position: Index,
  threshold: number = 0.5
): SubstitutionResult {
  const fit = semanticFit(newSignifier, chain, position);
  
  const cost: SubstitutionCost = fit < threshold ? 'METAPHORIC' : 'SUBSTITUTION';
  
  // Create new chain with substitution
  const newChain: Chain = {
    ...chain,
    signifiers: [
      ...chain.signifiers.slice(0, position),
      newSignifier,
      ...chain.signifiers.slice(position + 1),
    ],
  };
  
  // Propagate features to update interpretations in context window
  propagateFeatures(newChain, position);
  
  return { chain: newChain, cost };
}

// ============================================================================
// IV. Core Operations - Condensation
// ============================================================================

/**
 * Generate a fresh unique identifier
 */
let idCounter = 0;
function generateFreshId(): string {
  return `signifier_${Date.now()}_${idCounter++}`;
}

/**
 * Find conflicting features across multiple signifiers
 */
function findFeatureConflicts(signifiers: Signifier[]): Feature[] {
  const conflicts: Feature[] = [];
  
  for (let i = 0; i < signifiers.length; i++) {
    for (let j = i + 1; j < signifiers.length; j++) {
      const s1 = signifiers[i];
      const s2 = signifiers[j];
      
      if (!s1 || !s2) continue;
      
      // Check for dimension conflicts with different values
      s1.features.forEach(f1 => {
        s2.features.forEach(f2 => {
          if (f1.dimension === f2.dimension && f1.value !== f2.value) {
            conflicts.push(f1, f2);
          }
        });
      });
    }
  }
  
  return conflicts;
}

/**
 * Resolve conflicts by creating appropriate negations
 */
function resolveConflicts(conflicts: Feature[]): Feature[] {
  // Strategy: negations are features explicitly ruled out
  // In condensation, we keep dominant features and negate alternatives
  const negations: Feature[] = [];
  const dimensionCounts = new Map<string, Map<any, number>>();
  
  conflicts.forEach(f => {
    if (!dimensionCounts.has(f.dimension)) {
      dimensionCounts.set(f.dimension, new Map());
    }
    const counts = dimensionCounts.get(f.dimension)!;
    counts.set(f.value, (counts.get(f.value) || 0) + 1);
  });
  
  // Negate less frequent values
  dimensionCounts.forEach((valueCounts, dimension) => {
    const sorted = Array.from(valueCounts.entries()).sort((a, b) => b[1] - a[1]);
    // Keep most frequent, negate others
    sorted.slice(1).forEach(([value, _count]) => {
      negations.push({ dimension, value });
    });
  });
  
  return negations;
}

/**
 * Blend acoustic representations (simplified portmanteau)
 */
function blendAcoustics(acoustics: string[][]): string[] {
  if (acoustics.length === 0) return [];
  
  const first = acoustics[0];
  if (acoustics.length === 1 && first) return first;
  
  // Simple blend: take beginning of first, end of last, select from middle
  const result: string[] = [];
  
  // Take from first
  if (first && first.length > 0) {
    result.push(...first.slice(0, Math.ceil(first.length / 2)));
  }
  
  // Take from last
  const last = acoustics[acoustics.length - 1];
  if (last && last.length > 0) {
    result.push(...last.slice(Math.floor(last.length / 2)));
  }
  
  return result;
}

/**
 * Condensation - collapse many signifiers into one
 * Complexity: O(n) where n = number of input signifiers
 * 
 * Effect: Overdetermination - multiple signifiers compressed into one
 * The primary process of the unconscious, dream-work protagonist
 */
export function condense(signifiers: Signifier[]): Signifier {
  if (signifiers.length === 0) {
    throw new Error('Cannot condense empty set of signifiers');
  }
  
  const first = signifiers[0];
  if (signifiers.length === 1 && first) {
    return first;
  }
  
  // Merge all features
  const mergedFeatures: Feature[] = [];
  const featureMap = new Map<string, Feature>();
  
  signifiers.forEach(s => {
    s.features.forEach(f => {
      const key = `${f.dimension}:${f.value}`;
      if (!featureMap.has(key)) {
        featureMap.set(key, f);
        mergedFeatures.push(f);
      }
    });
  });
  
  // Find and resolve conflicts
  const conflicts = findFeatureConflicts(signifiers);
  const resolvedNegations = resolveConflicts(conflicts);
  
  // Blend acoustic representations
  const blendedAcoustic = blendAcoustics(signifiers.map(s => s.acoustic));
  
  return {
    id: generateFreshId(),
    acoustic: blendedAcoustic,
    features: mergedFeatures,
    negations: resolvedNegations,
  };
}

// ============================================================================
// V. Retroactive Determination - Streaming Chains
// ============================================================================

/**
 * Create initial probability distribution for a signifier
 */
function initialDistribution(signifier: Signifier): Distribution {
  const dist: Distribution = {};
  
  // Create uniform distribution over possible meanings
  // In practice, this would be based on prior semantic knowledge
  const meaningKey = `meaning_${signifier.id}`;
  dist[meaningKey] = 1.0;
  
  return dist;
}

/**
 * Compute compatibility between two signifiers given prior interpretation
 */
function compatibility(
  signifier: Signifier,
  newSignifier: Signifier,
  priorDistribution: Distribution
): Distribution {
  // Likelihood distribution based on similarity
  const sim = similarity(signifier, newSignifier);
  
  // Reweight prior based on compatibility with new context
  const likelihood: Distribution = {};
  
  Object.keys(priorDistribution).forEach(meaningKey => {
    // Higher similarity increases likelihood of meanings
    likelihood[meaningKey] = sim;
  });
  
  return likelihood;
}

/**
 * Bayesian update of probability distribution
 */
function bayesUpdate(prior: Distribution, likelihood: Distribution): Distribution {
  const posterior: Distribution = {};
  let totalWeight = 0;
  
  // Multiply prior by likelihood
  Object.keys(prior).forEach(key => {
    const priorValue = prior[key];
    if (priorValue !== undefined) {
      const weight = priorValue * (likelihood[key] || 0.5);
      posterior[key] = weight;
      totalWeight += weight;
    }
  });
  
  // Normalize
  if (totalWeight > 0) {
    Object.keys(posterior).forEach(key => {
      const posteriorValue = posterior[key];
      if (posteriorValue !== undefined) {
        posterior[key] = posteriorValue / totalWeight;
      }
    });
  }
  
  return posterior;
}

/**
 * Add signifier to streaming chain with Bayesian update
 * Complexity: O(n) per added signifier
 * 
 * Effect: Later context continuously recontextualizes earlier signifiers
 * The fundamental structure of retroactive determination (après-coup)
 */
export function addSignifier(
  chain: StreamingChain,
  newSignifier: Signifier
): StreamingChain {
  const updatedChain: StreamingChain = {
    signifiers: [...chain.signifiers, newSignifier],
    interpretations: [...chain.interpretations],
  };
  
  // Bayesian update: each new signifier reweights ALL prior interpretations
  for (let i = 0; i < chain.signifiers.length; i++) {
    const signifier = chain.signifiers[i];
    const prior = chain.interpretations[i];
    
    if (signifier && prior) {
      const likelihood = compatibility(signifier, newSignifier, prior);
      const posterior = bayesUpdate(prior, likelihood);
      updatedChain.interpretations[i] = posterior;
    }
  }
  
  // Add initial distribution for new signifier
  updatedChain.interpretations.push(initialDistribution(newSignifier));
  
  return updatedChain;
}

// ============================================================================
// V. Retroactive Determination - Quilting
// ============================================================================

/**
 * Compute affinity of a meaning to the anchor signifier
 */
function anchorAffinity(_meaningKey: string, _anchor: Signifier): number {
  // In full implementation, would compute based on semantic compatibility
  // For now, return moderate affinity
  return 0.8;
}

/**
 * Collapse probability distribution to single meaning
 * Weighted by affinity to anchor signifier
 */
function collapseDistribution(
  distribution: Distribution,
  anchor: Signifier,
  signifier: Signifier
): Meaning {
  // Find meaning with highest weight * anchor affinity
  let maxWeight = -Infinity;
  let selectedKey = Object.keys(distribution)[0] || 'default_meaning';
  
  Object.entries(distribution).forEach(([key, weight]) => {
    const affinity = anchorAffinity(key, anchor);
    const totalWeight = weight * affinity;
    
    if (totalWeight > maxWeight) {
      maxWeight = totalWeight;
      selectedKey = key;
    }
  });
  
  const confidence = distribution[selectedKey];
  
  return {
    features: signifier.features,
    context_signature: hashContext([signifier, anchor]),
    confidence: confidence !== undefined ? confidence : 0.5,
  };
}

/**
 * Quilting operation - crystallize meaning at anchor point
 * Complexity: O(n) one-time collapse
 * 
 * Effect: Master signifier (point de capiton) retroactively organizes
 * the entire preceding chain, fixing meaning that was floating
 */
export function quilt(
  streamingChain: StreamingChain,
  anchorIndex: Index
): Chain {
  if (anchorIndex >= streamingChain.signifiers.length) {
    throw new Error('Anchor index out of bounds');
  }
  
  const anchor = streamingChain.signifiers[anchorIndex];
  if (!anchor) {
    throw new Error('Anchor signifier not found');
  }
  
  const fixedInterpretations: (Meaning | null)[] = [];
  
  // Collapse distributions up to and including anchor
  for (let i = 0; i <= anchorIndex; i++) {
    const distribution = streamingChain.interpretations[i];
    const signifier = streamingChain.signifiers[i];
    
    if (distribution && signifier) {
      const meaning = collapseDistribution(distribution, anchor, signifier);
      fixedInterpretations.push(meaning);
    } else {
      fixedInterpretations.push(null);
    }
  }
  
  // Leave post-anchor interpretations as null (not yet quilted)
  for (let i = anchorIndex + 1; i < streamingChain.signifiers.length; i++) {
    fixedInterpretations.push(null);
  }
  
  return {
    signifiers: streamingChain.signifiers,
    interpretations: fixedInterpretations,
    quilting_indices: [anchorIndex],
  };
}

/**
 * Add additional quilting point to existing chain
 */
export function addQuiltingPoint(
  chain: Chain,
  newAnchorIndex: Index
): Chain {
  if (newAnchorIndex >= chain.signifiers.length) {
    throw new Error('Anchor index out of bounds');
  }
  
  if (chain.quilting_indices.includes(newAnchorIndex)) {
    return chain; // Already quilted at this point
  }
  
  // For simplicity, return chain with updated quilting indices
  // Full implementation would re-quilt affected regions
  return {
    ...chain,
    quilting_indices: [...chain.quilting_indices, newAnchorIndex].sort((a, b) => a - b),
  };
}

// ============================================================================
// VI. Subject Structure
// ============================================================================

/**
 * Represent subject - locate structural void
 * Complexity: O(1)
 * 
 * Effect: Subject as absence, the gap between signifiers
 * "A signifier represents the subject for another signifier"
 */
export function representSubject(
  s1: Signifier,
  chain: Chain
): SubjectPosition | null {
  const s1Index = chain.signifiers.findIndex(s => s.id === s1.id);
  
  if (s1Index === -1 || s1Index === chain.signifiers.length - 1) {
    return null; // No gap after this signifier
  }
  
  const s2Index = s1Index + 1;
  
  return {
    between: [s1Index, s2Index],
    value: null, // ⊥ - structural void
  };
}

/**
 * Find all subject positions in a chain
 */
export function findSubjectPositions(chain: Chain): SubjectPosition[] {
  const positions: SubjectPosition[] = [];
  
  for (let i = 0; i < chain.signifiers.length - 1; i++) {
    positions.push({
      between: [i, i + 1],
      value: null,
    });
  }
  
  return positions;
}

/**
 * Check if a subject position is quilted (meaning fixed on both sides)
 */
export function isSubjectPositionQuilted(
  position: SubjectPosition,
  chain: Chain
): boolean {
  const [i, j] = position.between;
  return (
    chain.interpretations[i] !== null &&
    chain.interpretations[j] !== null
  );
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create initial symbolic space from signifiers
 */
export function createSymbolicSpace(
  signifiers: Signifier[],
  adjacencyPairs?: Array<[string, string]>
): SymbolicSpace {
  const syntagmatic: SparseGraph = {};
  const paradigmatic: Record<string, string[]> = {};
  
  // Build syntagmatic graph from adjacency pairs
  if (adjacencyPairs) {
    adjacencyPairs.forEach(([from, to]) => {
      if (!syntagmatic[from]) {
        syntagmatic[from] = [];
      }
      syntagmatic[from].push(to);
    });
  }
  
  // Build paradigmatic index
  signifiers.forEach(signifier => {
    signifier.features.forEach(feature => {
      const key = `${feature.dimension}:${feature.value}`;
      if (!paradigmatic[key]) {
        paradigmatic[key] = [];
      }
      paradigmatic[key].push(signifier.id);
    });
  });
  
  return {
    signifiers,
    syntagmatic,
    paradigmatic,
  };
}

/**
 * Create a streaming chain from signifiers
 */
export function createStreamingChain(signifiers: Signifier[]): StreamingChain {
  return {
    signifiers: [...signifiers],
    interpretations: signifiers.map(s => initialDistribution(s)),
  };
}

/**
 * Pretty-print a chain for debugging
 */
export function printChain(chain: Chain): string {
  const lines: string[] = [];
  
  lines.push('Signifying Chain:');
  lines.push('─'.repeat(50));
  
  chain.signifiers.forEach((s, i) => {
    const quilted = chain.quilting_indices.includes(i) ? '⚓' : ' ';
    const meaning = chain.interpretations[i];
    const meaningStr = meaning
      ? `[${meaning.features.map(f => `${f.dimension}=${f.value}`).join(', ')}]`
      : '[floating]';
    
    lines.push(`${quilted} ${i}: ${s.id} ${meaningStr}`);
  });
  
  return lines.join('\n');
}
