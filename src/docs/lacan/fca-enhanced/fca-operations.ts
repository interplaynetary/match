/**
 * Enhanced Lacanian FCA - FCA Operations
 * 
 * Standard Formal Concept Analysis operations:
 * - Galois connection (extent, intent)
 * - Concept formation and validation
 * - Concept lattice construction
 * - Lattice operations (meet, join, order)
 */

import type {
  TemporalContext,
  Feature,
  FormalConcept,
  ConceptLattice,
} from './core';
import {
  featureKey,
  featuresEqual,
  hasFeature,
  intersectFeatures,
  unionFeatures,
  isSubsetFeatures,
  deduplicateFeatures,
} from './core';

// ============================================================================
// Galois Connection
// ============================================================================

/**
 * Extent operator: A' for feature set A
 * 
 * Returns all signifiers that have ALL features in the given set.
 * 
 * Mathematically: A' = {g ∈ G | ∀m ∈ A: (g,m) ∈ I}
 * 
 * @param features - Set of features (A)
 * @param context - Temporal context
 * @returns Array of signifier IDs that possess all features
 */
export function extent(features: Feature[], context: TemporalContext): string[] {
  if (features.length === 0) {
    // Empty feature set -> all objects
    return context.signifiers.map(s => s.id);
  }

  return context.signifiers
    .filter(signifier => {
      // Check if signifier has ALL features
      return features.every(feature => {
        const key = `${signifier.id}:${featureKey(feature)}`;
        const incidenceValue = context.incidence[key];
        
        // Fuzzy incidence: consider >= 0.5 as "has feature"
        return incidenceValue !== undefined && incidenceValue >= 0.5;
      });
    })
    .map(s => s.id);
}

/**
 * Intent operator: B' for signifier set B
 * 
 * Returns all features shared by ALL signifiers in the given set.
 * 
 * Mathematically: B' = {m ∈ M | ∀g ∈ B: (g,m) ∈ I}
 * 
 * @param signifierIds - Set of signifier IDs (B)
 * @param context - Temporal context
 * @returns Array of features shared by all signifiers
 */
export function intent(signifierIds: string[], context: TemporalContext): Feature[] {
  if (signifierIds.length === 0) {
    // Empty object set -> all attributes
    return [...context.features];
  }

  // Start with features of first signifier
  const firstSignifier = context.signifiers.find(s => s.id === signifierIds[0]);
  if (!firstSignifier) return [];

  let sharedFeatures = firstSignifier.features;

  // Intersect with features of remaining signifiers
  for (let i = 1; i < signifierIds.length; i++) {
    const signifier = context.signifiers.find(s => s.id === signifierIds[i]);
    if (!signifier) return [];
    
    sharedFeatures = intersectFeatures(sharedFeatures, signifier.features);
  }

  return sharedFeatures;
}

/**
 * Closure operator: X''
 * 
 * Applies operator twice to get closure.
 * For features: features -> extent -> intent
 * For signifiers: signifiers -> intent -> extent
 */
export function featureClosure(features: Feature[], context: TemporalContext): Feature[] {
  const ext = extent(features, context);
  return intent(ext, context);
}

export function signifierClosure(signifierIds: string[], context: TemporalContext): string[] {
  const int = intent(signifierIds, context);
  return extent(int, context);
}

// ============================================================================
// Concept Formation
// ============================================================================

/**
 * Check if (extent, intent) forms a valid formal concept
 * 
 * A pair (A, B) is a formal concept iff:
 * - A' = B (extent's intent equals intent)
 * - B' = A (intent's extent equals extent)
 * 
 * @param extentIds - Signifier IDs (A)
 * @param intentFeatures - Features (B)
 * @param context - Temporal context
 * @returns true if valid concept
 */
export function isConcept(
  extentIds: string[],
  intentFeatures: Feature[],
  context: TemporalContext
): boolean {
  // Check A' = B
  const extentIntent = intent(extentIds, context);
  const intentsMatch = isSubsetFeatures(intentFeatures, extentIntent) &&
                       isSubsetFeatures(extentIntent, intentFeatures);
  
  // Check B' = A
  const intentExtent = extent(intentFeatures, context);
  const extentsMatch = extentIds.length === intentExtent.length &&
                       extentIds.every(id => intentExtent.includes(id));
  
  return intentsMatch && extentsMatch;
}

/**
 * Generate formal concept from feature set
 * 
 * Takes a set of features and closes it to a formal concept.
 * 
 * @param features - Starting features
 * @param context - Temporal context
 * @returns Formal concept (A, B) where A' = B and B' = A
 */
export function conceptFromFeatures(
  features: Feature[],
  context: TemporalContext
): FormalConcept {
  const ext = extent(features, context);
  const int = intent(ext, context);
  
  return {
    extent: ext,
    intent: int,
  };
}

/**
 * Generate formal concept from signifier set
 * 
 * Takes a set of signifiers and closes it to a formal concept.
 */
export function conceptFromSignifiers(
  signifierIds: string[],
  context: TemporalContext
): FormalConcept {
  const int = intent(signifierIds, context);
  const ext = extent(int, context);
  
  return {
    extent: ext,
    intent: int,
  };
}

// ============================================================================
// Concept Enumeration
// ============================================================================

/**
 * Compute all formal concepts using Next Closure algorithm
 * 
 * This generates all concepts systematically by iterating through
 * closed feature sets in lectic order.
 * 
 * @param context - Temporal context
 * @returns Array of all formal concepts
 */
export function computeAllConcepts(context: TemporalContext): FormalConcept[] {
  const concepts: FormalConcept[] = [];
  
  // Extract all unique features from signifiers
  const allFeatures = deduplicateFeatures(
    context.signifiers.flatMap(s => s.features)
  );
  
  if (allFeatures.length === 0) {
    // No features, only one concept (top = bottom)
    return [conceptFromFeatures([], context)];
  }
  
  // Start with empty feature set
  let currentIntent = featureClosure([], context);
  concepts.push(conceptFromFeatures(currentIntent, context));
  
  // Iterate through all closed sets in lectic order
  while (true) {
    const next = nextClosure(currentIntent, allFeatures, context);
    if (!next) break;
    
    const concept = conceptFromFeatures(next, context);
    concepts.push(concept);
    currentIntent = next;
  }
  
  return concepts;
}

/**
 * Next Closure algorithm (Ganter)
 * 
 * Given a closed set, finds the next closed set in lectic order.
 * Returns null if current is the last closed set.
 */
function nextClosure(
  current: Feature[],
  allFeatures: Feature[],
  context: TemporalContext
): Feature[] | null {
  // Try to extend current set with each feature not in it
  for (let i = allFeatures.length - 1; i >= 0; i--) {
    const feature = allFeatures[i];
    if (!feature) continue;
    
    if (hasFeature(current, feature)) {
      // Feature already in set, remove it
      current = current.filter(f => !featuresEqual(f, feature));
    } else {
      // Try adding this feature
      const candidate = [...current, feature];
      const closed = featureClosure(candidate, context);
      
      // Check if this is lectically next
      const isNext = allFeatures.slice(i + 1).every(f => {
        const inCandidate = hasFeature(candidate, f);
        const inClosed = hasFeature(closed, f);
        return inCandidate === inClosed;
      });
      
      if (isNext) {
        return closed;
      }
    }
  }
  
  return null; // No more closed sets
}

// ============================================================================
// Concept Lattice Construction
// ============================================================================

/**
 * Build concept lattice from concepts
 * 
 * Constructs the partial order and identifies top/bottom elements.
 * 
 * @param context - Temporal context
 * @returns Complete concept lattice structure
 */
export function computeConceptLattice(context: TemporalContext): ConceptLattice {
  const concepts = computeAllConcepts(context);
  
  // Build partial order
  const order: Record<string, string[]> = {};
  
  concepts.forEach((c1, i) => {
    const key1 = conceptKey(c1);
    order[key1] = [];
    
    concepts.forEach((c2, j) => {
      if (i === j) return;
      
      // c1 ≤ c2 iff extent(c1) ⊆ extent(c2)
      if (isSubsetExtent(c1.extent, c2.extent)) {
        order[key1].push(conceptKey(c2));
      }
    });
  });
  
  // Find top (biggest extent, smallest intent)
  let topConcept = concepts[0];
  concepts.forEach(c => {
    if (topConcept && c.extent.length > topConcept.extent.length) {
      topConcept = c;
    }
  });
  
  // Find bottom (smallest extent, biggest intent)
  let bottomConcept = concepts[0];
  concepts.forEach(c => {
    if (bottomConcept && c.extent.length < bottomConcept.extent.length) {
      bottomConcept = c;
    }
  });
  
  return {
    concepts,
    order,
    top: topConcept ? conceptKey(topConcept) : '',
    bottom: bottomConcept ? conceptKey(bottomConcept) : '',
  };
}

/**
 * Generate unique key for concept
 */
function conceptKey(concept: FormalConcept): string {
  return `[${concept.extent.join(',')}]`;
}

/**
 * Check if extent1 ⊆ extent2
 */
function isSubsetExtent(extent1: string[], extent2: string[]): boolean {
  return extent1.every(id => extent2.includes(id));
}

// ============================================================================
// Lattice Operations
// ============================================================================

/**
 * Concept order: c1 ≤ c2
 * 
 * In concept lattice: (A1, B1) ≤ (A2, B2) iff A1 ⊆ A2 iff B2 ⊆ B1
 * 
 * @returns true if c1 is below c2 in lattice
 */
export function conceptOrder(c1: FormalConcept, c2: FormalConcept): boolean {
  return isSubsetExtent(c1.extent, c2.extent);
}

/**
 * Meet (infimum): c1 ∧ c2
 * 
 * The greatest lower bound in the concept lattice.
 * 
 * (A1, B1) ∧ (A2, B2) = (A1 ∩ A2, (B1 ∪ B2)'')
 * 
 * @param c1 - First concept
 * @param c2 - Second concept
 * @param context - Temporal context
 * @returns Meet of the two concepts
 */
export function meet(
  c1: FormalConcept,
  c2: FormalConcept,
  context: TemporalContext
): FormalConcept {
  // Extent: intersection
  const extentIntersection = c1.extent.filter(id => c2.extent.includes(id));
  
  // Intent: close the union
  const intentUnion = unionFeatures(c1.intent, c2.intent);
  const closedIntent = featureClosure(intentUnion, context);
  
  return {
    extent: extentIntersection,
    intent: closedIntent,
  };
}

/**
 * Join (supremum): c1 ∨ c2
 * 
 * The least upper bound in the concept lattice.
 * 
 * (A1, B1) ∨ (A2, B2) = ((A1 ∪ A2)'', B1 ∩ B2)
 * 
 * @param c1 - First concept
 * @param c2 - Second concept
 * @param context - Temporal context
 * @returns Join of the two concepts
 */
export function join(
  c1: FormalConcept,
  c2: FormalConcept,
  context: TemporalContext
): FormalConcept {
  // Extent: close the union
  const extentUnion = [...new Set([...c1.extent, ...c2.extent])];
  const closedExtent = signifierClosure(extentUnion, context);
  
  // Intent: intersection
  const intentIntersection = intersectFeatures(c1.intent, c2.intent);
  
  return {
    extent: closedExtent,
    intent: intentIntersection,
  };
}

/**
 * Find neighbors of a concept in the lattice
 * 
 * Returns concepts that are directly adjacent (no concept in between).
 * 
 * @param concept - The concept to find neighbors for
 * @param lattice - The concept lattice
 * @returns Array of neighboring concepts
 */
export function neighbors(
  concept: FormalConcept,
  lattice: ConceptLattice
): FormalConcept[] {
  const key = conceptKey(concept);
  const neighborKeys = lattice.order[key] || [];
  
  return neighborKeys
    .map(nKey => lattice.concepts.find(c => conceptKey(c) === nKey))
    .filter((c): c is FormalConcept => c !== undefined);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Pretty-print a concept
 */
export function printConcept(concept: FormalConcept): string {
  const extentStr = `{${concept.extent.join(', ')}}`;
  const intentStr = concept.intent
    .map(f => `${f.dimension}:${f.value}`)
    .join(', ');
  
  return `(${extentStr}, {${intentStr}})`;
}

/**
 * Pretty-print concept lattice
 */
export function printLattice(lattice: ConceptLattice): string {
  let output = `Concept Lattice (${lattice.concepts.length} concepts)\n`;
  output += `Top: ${lattice.top}\n`;
  output += `Bottom: ${lattice.bottom}\n\n`;
  
  lattice.concepts.forEach(c => {
    const key = conceptKey(c);
    output += `${printConcept(c)}\n`;
    
    const subs = lattice.order[key] || [];
    if (subs.length > 0) {
      output += `  → [${subs.join(', ')}]\n`;
    }
  });
  
  return output;
}

/**
 * Export lattice to graphviz DOT format for visualization
 */
export function exportToDot(lattice: ConceptLattice): string {
  let dot = 'digraph ConceptLattice {\n';
  dot += '  rankdir=BT;\n'; // Bottom to top
  dot += '  node [shape=box];\n\n';
  
  lattice.concepts.forEach(c => {
    const key = conceptKey(c);
    const label = printConcept(c);
    dot += `  "${key}" [label="${label}"];\n`;
  });
  
  dot += '\n';
  
  Object.entries(lattice.order).forEach(([from, tos]) => {
    tos.forEach(to => {
      dot += `  "${from}" -> "${to}";\n`;
    });
  });
  
  dot += '}\n';
  return dot;
}
