/**
 * Enhanced Lacanian FCA - Enhanced Operations
 * 
 * Operations beyond classical FCA:
 * - Temporal dynamics (streaming signifiers)
 * - Probabilistic semantics (Bayesian updates)
 * - Quilting mechanism (distribution collapse)
 * - Syntagmatic traversal (graph operations)
 */

import type {
  TemporalContext,
  Signifier,
  Feature,
  MeaningDistribution,
  QuiltRelativeConcept,
  TemporalSequence,
} from './core';
import {
  featureKey,
  incidenceKey,
  deduplicateFeatures,
  unionFeatures,
} from './core';
import { extent, intent, conceptFromFeatures } from './fca-operations';

// ============================================================================
// Temporal Operations
// ============================================================================

/**
 * Create initial temporal context at t=0
 * 
 * @param signifiers - Initial signifiers
 * @param features - Feature space (stable across time)
 * @returns Temporal context at t=0
 */
export function createTemporalContext(
  signifiers: Signifier[],
  features: Feature[]
): TemporalContext {
  const incidence: Record<string, number> = {};
  const negations: Record<string, boolean> = {};
  const distributions: Record<string, MeaningDistribution> = {};
  
  // Build incidence relations
  signifiers.forEach(s => {
    // Positive features (fuzzy, initially 1.0)
    s.features.forEach(f => {
      const key = incidenceKey(s.id, f);
      incidence[key] = 1.0;
    });
    
    // Negations (crisp)
    s.negations.forEach(f => {
      const key = incidenceKey(s.id, f);
      negations[key] = true;
    });
    
    // Initial distribution (single meaning, probability 1.0)
    distributions[s.id] = {
      [`meaning_${s.id}`]: 1.0,
    };
  });
  
  return {
    t: 0,
    signifiers,
    features,
    incidence,
    negations,
    syntagmatic: {},
    distributions,
    quilting: [],
  };
}

/**
 * Advance time index
 * 
 * @param context - Current context
 * @returns Context with t incremented
 */
export function advanceTime(context: TemporalContext): TemporalContext {
  return {
    ...context,
    t: context.t + 1,
  };
}

/**
 * Add signifier at next time step
 * 
 * This performs:
 * 1. Add signifier to G_t
 * 2. Update incidence relations
 * 3. Bayesian update of ALL prior distributions
 * 4. Increment time
 * 
 * @param context - Current context
 * @param signifier - New signifier to add
 * @returns Updated context at t+1
 */
export function addSignifierTemporal(
  context: TemporalContext,
  signifier: Signifier
): TemporalContext {
  // Add to signifier set
  const newSignifiers = [...context.signifiers, signifier];
  
  // Update incidence
  const newIncidence = { ...context.incidence };
  signifier.features.forEach(f => {
    const key = incidenceKey(signifier.id, f);
    newIncidence[key] = 1.0;
  });
  
  // Update negations
  const newNegations = { ...context.negations };
  signifier.negations.forEach(f => {
    const key = incidenceKey(signifier.id, f);
    newNegations[key] = true;
  });
  
  // Bayesian update of distributions
  const newDistributions = updateAllDistributions(
    context.distributions,
    context.signifiers,
    signifier
  );
  
  // Add initial distribution for new signifier
  newDistributions[signifier.id] = {
    [`meaning_${signifier.id}`]: 1.0,
  };
  
  return {
    t: context.t + 1,
    signifiers: newSignifiers,
    features: context.features,
    incidence: newIncidence,
    negations: newNegations,
    syntagmatic: context.syntagmatic,
    distributions: newDistributions,
    quilting: context.quilting,
  };
}

/**
 * Get context snapshot at specific time
 * 
 * @param sequence - Temporal sequence
 * @param t - Time index
 * @returns Context at time t, or null if not found
 */
export function getContextAtTime(
  sequence: TemporalSequence,
  t: number
): TemporalContext | null {
  return sequence.contexts.find(ctx => ctx.t === t) || null;
}

/**
 * Create temporal sequence from initial context
 */
export function createTemporalSequence(
  initialContext: TemporalContext
): TemporalSequence {
  return {
    contexts: [initialContext],
    currentTime: initialContext.t,
  };
}

// ============================================================================
// Probabilistic Operations
// ============================================================================

/**
 * Update all distributions via Bayesian inference
 * 
 * When new signifier arrives, ALL prior distributions are reweighted
 * based on compatibility with the new signifier.
 * 
 * P(meaning_i | s_1..s_n, s_new) ∝ P(meaning_i | s_1..s_n) · P(s_new | meaning_i)
 * 
 * @param distributions - Current distributions
 * @param signifiers - Current signifiers
 * @param newSignifier - Newly arrived signifier
 * @returns Updated distributions
 */
function updateAllDistributions(
  distributions: Record<string, MeaningDistribution>,
  signifiers: Signifier[],
  newSignifier: Signifier
): Record<string, MeaningDistribution> {
  const updated: Record<string, MeaningDistribution> = {};
  
  signifiers.forEach(s => {
    const prior = distributions[s.id];
    if (!prior) return;
    
    // Compute likelihood: how compatible is new signifier with each meaning?
    const likelihood = computeLikelihood(s, newSignifier, prior);
    
    // Bayesian update
    updated[s.id] = bayesianUpdate(prior, likelihood);
  });
  
  return updated;
}

/**
 * Compute likelihood of new signifier given meaning
 * 
 * Simplified: use feature similarity as proxy
 */
function computeLikelihood(
  signifier: Signifier,
  newSignifier: Signifier,
  distribution: MeaningDistribution
): MeaningDistribution {
  const similarity = computeSimilarity(signifier.features, newSignifier.features);
  
  const likelihood: MeaningDistribution = {};
  Object.keys(distribution).forEach(meaningKey => {
    likelihood[meaningKey] = similarity;
  });
  
  return likelihood;
}

/**
 * Simple feature similarity (Jaccard-like)
 */
function computeSimilarity(f1: Feature[], f2: Feature[]): number {
  if (f1.length === 0 && f2.length === 0) return 1.0;
  
  const union = unionFeatures(f1, f2);
  const intersection = f1.filter(f => 
    f2.some(f2Item => f2Item.dimension === f.dimension && f2Item.value === f.value)
  );
  
  return intersection.length / union.length;
}

/**
 * Bayesian update: multiply prior by likelihood and normalize
 */
function bayesianUpdate(
  prior: MeaningDistribution,
  likelihood: MeaningDistribution
): MeaningDistribution {
  const posterior: MeaningDistribution = {};
  let totalWeight = 0;
  
  // Multiply prior by likelihood
  Object.keys(prior).forEach(key => {
    const priorValue = prior[key];
    if (priorValue === undefined) return;
    
    const likelihoodValue = likelihood[key] || 0.5; // Default
    const weight = priorValue * likelihoodValue;
    posterior[key] = weight;
    totalWeight += weight;
  });
  
  // Normalize to sum to 1.0
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
 * Calculate Shannon entropy of distribution
 * 
 * H(X) = -Σ p(x) log₂(p(x))
 * 
 * High entropy = uncertain (floating meanings)
 * Low entropy = certain (crystallized meanings)
 */
export function distributionEntropy(dist: MeaningDistribution): number {
  let entropy = 0;
  
  Object.values(dist).forEach(p => {
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  });
  
  return entropy;
}

/**
 * Collapse distribution to point mass
 * 
 * Picks highest-probability meaning and sets it to 1.0
 * (quantum measurement / wave function collapse)
 * 
 * @param dist - Probability distribution
 * @returns Winner-take-all probability (0 or 1)
 */
export function collapseDistribution(dist: MeaningDistribution): MeaningDistribution {
  let maxKey = '';
  let maxProb = -1;
  
  Object.entries(dist).forEach(([key, prob]) => {
    if (prob > maxProb) {
      maxProb = prob;
      maxKey = key;
    }
  });
  
  const collapsed: MeaningDistribution = {};
  Object.keys(dist).forEach(key => {
    collapsed[key] = key === maxKey ? 1.0 : 0.0;
  });
  
  return collapsed;
}

// ============================================================================
// Quilting Operations
// ============================================================================

/**
 * Add quilting point at specific time index
 * 
 * This performs:
 * 1. Add index to Q_t
 * 2. Collapse distributions up to that point
 * 3. Update incidence to reflect collapsed meanings
 * 
 * @param context - Current context
 * @param timeIndex - Time to quilt (must be ≤ current time)
 * @returns Context with quilting point added
 */
export function quilt(
  context: TemporalContext,
  timeIndex: number
): TemporalContext {
  if (timeIndex > context.t) {
    throw new Error(`Cannot quilt future time ${timeIndex} (current: ${context.t})`);
  }
  
  if (context.quilting.includes(timeIndex)) {
    return context; // Already quilted
  }
  
  const newQuilting = [...context.quilting, timeIndex].sort((a, b) => a - b);
  const newDistributions = { ...context.distributions };
  
  // Collapse distributions for signifiers up to timeIndex
  context.signifiers.forEach((s, i) => {
    if (i <= timeIndex && newDistributions[s.id]) {
      newDistributions[s.id] = collapseDistribution(newDistributions[s.id]);
    }
  });
  
  return {
    ...context,
    quilting: newQuilting,
    distributions: newDistributions,
  };
}

/**
 * Check if time index is quilted
 */
export function isQuilted(context: TemporalContext, timeIndex: number): boolean {
  return context.quilting.includes(timeIndex);
}

/**
 * Get all quilt-relative concepts
 * 
 * Computes formal concepts enhanced with quilting context and probabilities.
 * 
 * @param context - Temporal context with quilting
 * @returns Array of quilt-relative concepts C_q^t
 */
export function getQuiltRelativeConcepts(
  context: TemporalContext
): QuiltRelativeConcept[] {
  const concepts: QuiltRelativeConcept[] = [];
  
 // Extract all unique features from signifiers
  const allFeatures = deduplicateFeatures(
    context.signifiers.flatMap(s => s.features)
  );
  
  // For each feature, compute concept
  allFeatures.forEach(feature => {
    const concept = conceptFromFeatures([feature], context);
    const prob = computeConceptProbability(concept, context);
    
    concepts.push({
      t: context.t,
      quiltingPoint: context.quilting[context.quilting.length - 1] ?? null,
      extent: concept.extent,
      intent: concept.intent,
      probability: prob,
    });
  });
  
  // Add top concept (empty features)
  const topConcept = conceptFromFeatures([], context);
  concepts.push({
    t: context.t,
    quiltingPoint: context.quilting[context.quilting.length - 1] ?? null,
    extent: topConcept.extent,
    intent: topConcept.intent,
    probability: computeConceptProbability(topConcept, context),
  });
  
  return concepts;
}

/**
 * Compute probability of a concept given current distributions
 * 
 * P(concept | quilting) = mean of probabilities across extent signifiers
 */
function computeConceptProbability(
  concept: { extent: string[]; intent: Feature[] },
  context: TemporalContext
): number {
  if (concept.extent.length === 0) return 0;
  
  let totalProb = 0;
  
  concept.extent.forEach(signifierId => {
    const dist = context.distributions[signifierId];
    if (!dist) return;
    
    //Average probability across meanings
    const meanProb = Object.values(dist).reduce((sum, p) => sum + p, 0) / 
                     Object.keys(dist).length;
    totalProb += meanProb;
  });
  
  return totalProb / concept.extent.length;
}

// ============================================================================
// Syntagmatic Operations
// ============================================================================

/**
 * Metonymic slide along syntagmatic graph
 * 
 * Traverse graph for specified number of steps.
 * 
 * @param context - Temporal context
 * @param signifierId - Starting signifier
 * @param steps - Number of steps to traverse
 * @returns Path of signifier IDs
 */
export function metonymicSlide(
  context: TemporalContext,
  signifierId: string,
  steps: number
): string[] {
  const path: string[] = [signifierId];
  let current = signifierId;
  
  for (let i = 0; i < steps; i++) {
    const adjacentIds = context.syntagmatic[current];
    
    if (!adjacentIds || adjacentIds.length === 0) {
      break; // Dead end
    }
    
    // Pick randomly (or first)
    const next = adjacentIds[0];
    if (!next) break;
    
    path.push(next);
    current = next;
  }
  
  return path;
}

/**
 * Add syntagmatic edge
 * 
 * @param context - Temporal context
 * @param from - Source signifier ID
 * @param to - Target signifier ID
 * @returns Updated context
 */
export function addSyntagmaticEdge(
  context: TemporalContext,
  from: string,
  to: string
): TemporalContext {
  const newSyntagmatic = { ...context.syntagmatic };
  
  if (!newSyntagmatic[from]) {
    newSyntagmatic[from] = [];
  }
  
  if (!newSyntagmatic[from].includes(to)) {
    newSyntagmatic[from] = [...newSyntagmatic[from], to];
  }
  
  return {
    ...context,
    syntagmatic: newSyntagmatic,
  };
}

/**
 * Get syntagmatic neighbors
 * 
 * @param context - Temporal context
 * @param signifierId - Signifier ID
 * @returns Array of signifier IDs that can follow
 */
export function getSyntagmaticNeighbors(
  context: TemporalContext,
  signifierId: string
): string[] {
  return context.syntagmatic[signifierId] || [];
}
