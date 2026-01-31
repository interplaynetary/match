# Semantic Colors

Node and connection colors in the visualization are derived from embedding vectors, ensuring that semantically similar items have similar colors.

## Algorithm

The coloring pipeline:

1. **PCA Projection**: High-dimensional embeddings are projected to 2D using Principal Component Analysis
2. **Polar Coordinates**: The 2D point (x, y) is converted to polar coordinates (angle, radius)
3. **HSL Mapping**: Polar coordinates map to HSL color values

```
Embedding (256-dim) → PCA (2D) → Polar (angle, radius) → HSL (hue, saturation, lightness)
```

### Mapping Details

| Polar | HSL | Effect |
|-------|-----|--------|
| Angle | Hue (0-360) | Different semantic directions get different colors |
| Radius | Saturation (50-100%) | Items further from center are more saturated |
| — | Lightness (fixed 45%) | Consistent readability |

## PCA Transform

The PCA transform is computed at report generation time from all embeddings in the dataset. This ensures:

- **Stable colors**: Same embedding always produces same color
- **Dataset-specific**: Transform adapts to the semantic space of the current dataset
- **Efficient**: Transform is computed once and reused for all nodes

### Data Flow

```
                          REPORT GENERATION
                          =================

  +-----------------------+
  | enriched-examples.json|
  | embeddings.json       |
  +-----------+-----------+
              |
              v
  +-----------+-----------+
  |   generateMatchData() |  <-- src/match-data.ts
  |                       |
  |  1. Load all items    |
  |  2. Collect embeddings|
  +-----------+-----------+
              |
              v
  +-----------+-----------+
  | computePCATransform() |  <-- src/semantic-colors.ts
  |                       |
  |  Power iteration with |
  |  seed=42 for          |
  |  reproducibility      |
  +-----------+-----------+
              |
              v
  +-----------+-----------+
  |     MatchData         |
  |  {                    |
  |    capacities: [...], |
  |    needs: [...],      |
  |    matches: [...],    |
  |    pcaTransform: [[]] | <-- 2 x 256 matrix
  |  }                    |
  +-----------+-----------+
              |
              v
  +-----------+-----------+
  |    generateHTML()     |
  |                       |
  |  Serializes MatchData |
  |  as JSON in <script>  |
  +-----------+-----------+
              |
              v
  +-----------+-----------+
  |  matching-report.html |
  |                       |
  |  Contains embedded:   |
  |  - pcaTransform       |
  |  - node embeddings    |
  |  - color functions    |
  +-----------+-----------+
              |
              v
  +-----------+-----------+
  |   Browser Runtime     |
  |                       |
  |  embeddingToColor()   |
  |  computes colors      |
  |  on the fly           |
  +-----------------------+
```

### Storage

The PCA transform is **not persisted separately** - it's computed fresh each report generation and embedded in the HTML. This keeps the output self-contained: one HTML file has everything needed to render colors correctly.

### Reproducibility

Power iteration uses a seeded PRNG (seed=42) for deterministic results:

```typescript
const rand = seededRandom(42)
let v = new Array(dim).fill(0).map(() => rand() - 0.5)
```

Same embeddings always produce the same PCA transform and colors.

## Node Colors

Each node (capacity or need) is colored based on its embedding:

```typescript
function getNodeColor(item, isCapacity) {
  if (!item.embedding) {
    // Fallback colors when embedding is missing
    return isCapacity ? '#4CAF50' : '#2196F3'
  }
  return embeddingToColor(item.embedding, pcaTransform)
}
```

## Connection Colors

Chord connections are colored based on the **capacity's embedding**. This represents the semantic meaning of what's being provided in the match.

```javascript
// Connection color comes from capacity node
path.setAttribute('stroke', getNodeColor(cap, true));
```

This creates visual continuity: connections share the color of their capacity node, making it easy to trace what's being matched.

## Implementation

Source: [`src/semantic-colors.ts`](../src/semantic-colors.ts)

Key functions:
- `computePCATransform(embeddings)` — Compute 2D projection matrix
- `pcaProject(embedding, transform)` — Project embedding to 2D
- `coordinatesToHSL(x, y)` — Convert 2D point to HSL color
- `embeddingToColor(embedding, transform)` — Full pipeline

## References

This approach is adapted from the [semantic_navigator](../../semantic_navigator) project, which uses the same PCA → polar → HSL mapping for keyword coloring.
