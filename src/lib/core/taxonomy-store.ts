/**
 * Persistent storage for TaxonomyTree
 *
 * Serializes taxonomy as an array of paths (human-readable, git-diff friendly).
 * Reconstructs tree by calling addPath() for each stored path.
 */

import { TaxonomyTree, type CategoryPath } from './taxonomy-merge'

const DEFAULT_TAXONOMY_PATH = 'data/taxonomy.json'
const DEFAULT_ENRICHED_PATH = 'data/enriched-full.json'

export interface SerializedTaxonomy {
  version: 1
  paths: CategoryPath[]
}

/**
 * Load taxonomy from disk.
 * Falls back to bootstrapping from enriched-full.json if taxonomy.json doesn't exist.
 * Returns empty tree if neither exists.
 */
export async function loadTaxonomy(path: string = DEFAULT_TAXONOMY_PATH): Promise<TaxonomyTree> {
  const file = Bun.file(path)

  if (await file.exists()) {
    const data: SerializedTaxonomy = await file.json()
    return deserializeTaxonomy(data)
  }

  // Bootstrap from enriched data if available
  const enrichedFile = Bun.file(DEFAULT_ENRICHED_PATH)
  if (await enrichedFile.exists()) {
    const enriched = await enrichedFile.json()
    const tree = new TaxonomyTree()
    for (const example of enriched.results ?? []) {
      for (const expr of example.expressions ?? []) {
        if (expr.categoryChain) {
          tree.addPath(expr.categoryChain)
        }
      }
    }
    return tree
  }

  return new TaxonomyTree()
}

/**
 * Save taxonomy to disk.
 */
export async function saveTaxonomy(
  tree: TaxonomyTree,
  path: string = DEFAULT_TAXONOMY_PATH
): Promise<void> {
  const data = serializeTaxonomy(tree)
  await Bun.write(path, JSON.stringify(data, null, 2))
}

/**
 * Serialize tree to JSON-compatible format.
 */
export function serializeTaxonomy(tree: TaxonomyTree): SerializedTaxonomy {
  return {
    version: 1,
    paths: tree.getAllPaths(),
  }
}

/**
 * Deserialize from JSON format.
 */
export function deserializeTaxonomy(data: SerializedTaxonomy): TaxonomyTree {
  const tree = new TaxonomyTree()
  for (const path of data.paths) {
    tree.addPath(path)
  }
  return tree
}
