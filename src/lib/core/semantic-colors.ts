/**
 * Semantic color mapping for embedding-based coloring.
 *
 * Maps embeddings to colors via PCA projection to 2D,
 * then polar coordinates to HSL (angle→hue, radius→saturation).
 *
 * Similar embeddings get similar colors.
 */

/** PCA transformation matrix: 2 rows × embedding_dim columns */
export type PCATransform = number[][]

/**
 * Project an embedding to 2D using pre-computed PCA transform.
 */
export function pcaProject(
  embedding: number[],
  transform: PCATransform
): [number, number] {
  const pc1 = transform[0]
  const pc2 = transform[1]
  if (!pc1 || !pc2) return [0, 0]
  const x = dotProduct(pc1, embedding)
  const y = dotProduct(pc2, embedding)
  return [x, y]
}

/**
 * Map 2D coordinates to HSL color string.
 * Uses polar coordinates: angle→hue, radius→saturation.
 */
export function coordinatesToHSL(x: number, y: number): string {
  // Angle to hue (0-360)
  const angle = Math.atan2(y, x)
  const hue = ((angle / Math.PI + 1) * 180) % 360

  // Radius to saturation (50-100%)
  // Scale factor tuned for typical PCA coordinate ranges
  const radius = Math.sqrt(x * x + y * y)
  const saturation = (50 + Math.min(50, radius * 200)) * 0.5

  // Fixed lightness for readability
  const lightness = 45

  return `hsl(${hue.toFixed(0)}, ${saturation.toFixed(0)}%, ${lightness}%)`
}

/**
 * Get color for a single embedding.
 */
export function embeddingToColor(
  embedding: number[],
  transform: PCATransform
): string {
  const [x, y] = pcaProject(embedding, transform)
  return coordinatesToHSL(x, y)
}

/**
 * Compute color from centroid of multiple embeddings.
 */
export function centroidToColor(
  embeddings: number[][],
  transform: PCATransform
): string {
  if (embeddings.length === 0) {
    return 'hsl(0, 0%, 50%)' // Gray fallback
  }

  const centroid = computeCentroid(embeddings)
  const [x, y] = pcaProject(centroid, transform)
  return coordinatesToHSL(x, y)
}

// --- PCA computation ---

/**
 * Compute PCA transform from a set of embeddings.
 * Uses power iteration to find the top 2 principal components.
 */
export function computePCATransform(embeddings: number[][]): PCATransform {
  const firstEmb = embeddings[0]
  if (!firstEmb) {
    throw new Error('Cannot compute PCA transform from empty embeddings')
  }
  const dim = firstEmb.length

  // Center the data
  const mean = new Array(dim).fill(0)
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      mean[i] += emb[i]
    }
  }
  for (let i = 0; i < dim; i++) {
    mean[i] /= embeddings.length
  }

  const centered = embeddings.map((emb) => emb.map((v, i) => v - mean[i]))

  // Compute covariance matrix (dim × dim can be large, so we use X^T X / n approach)
  // For power iteration, we just need to multiply by the covariance matrix
  // cov = X^T X / n, where X is (n × dim) centered data

  // Power iteration for first principal component
  const pc1 = powerIteration(centered, dim)

  // Deflate: remove PC1 component from data
  const deflated = centered.map((row) => {
    const proj = dotProduct(row, pc1)
    return row.map((v, i) => v - proj * (pc1[i] ?? 0))
  })

  // Power iteration for second principal component
  const pc2 = powerIteration(deflated, dim)

  return [pc1, pc2]
}

/**
 * Simple seeded PRNG (mulberry32) for reproducible random initialization.
 */
function seededRandom(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Power iteration to find dominant eigenvector of X^T X.
 */
function powerIteration(
  centered: number[][],
  dim: number,
  maxIter: number = 100
): number[] {
  // Use seeded PRNG for reproducible pseudo-random initialization
  const rand = seededRandom(42)
  let v = new Array(dim).fill(0).map(() => rand() - 0.5)
  v = normalize(v)

  for (let iter = 0; iter < maxIter; iter++) {
    // Multiply by X^T X: first X*v, then X^T * (X*v)
    // X*v gives (n×1), X^T * result gives (dim×1)
    const Xv = centered.map((row) => dotProduct(row, v))
    const XtXv = new Array(dim).fill(0) as number[]
    for (let i = 0; i < centered.length; i++) {
      const row = centered[i]
      const xvi = Xv[i]
      if (!row || xvi === undefined) continue
      for (let j = 0; j < dim; j++) {
        const current = XtXv[j] ?? 0
        XtXv[j] = current + (row[j] ?? 0) * xvi
      }
    }

    // Normalize
    const vNew = normalize(XtXv)

    // Check convergence
    const diff = Math.sqrt(
      v.reduce((sum, vi, i) => sum + (vi - (vNew[i] ?? 0)) ** 2, 0)
    )
    v = vNew
    if (diff < 1e-10) break
  }

  return v
}

// --- Internal helpers ---

function dotProduct(a: number[], b: number[]): number {
  let sum = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    sum += (a[i] ?? 0) * (b[i] ?? 0)
  }
  return sum
}

function normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0))
  return norm === 0 ? vec : vec.map(v => v / norm)
}

function computeCentroid(embeddings: number[][]): number[] {
  const first = embeddings[0]
  if (!first) return []

  const sum = first.map((_, i) =>
    embeddings.reduce((acc, emb) => acc + (emb[i] ?? 0), 0) / embeddings.length
  )
  return normalize(sum)
}
