import { useState, useEffect } from 'react'
import type { TaxonomyNode } from '../../taxonomy-tree.ts'
import type { PCATransform } from '../../semantic-colors.ts'

type TaxonomyResponse = {
  tree: TaxonomyNode
  pcaTransform: PCATransform
}

export function useTaxonomyData(): {
  data: TaxonomyNode | null
  pcaTransform: PCATransform | null
  error: string | null
} {
  const [data, setData] = useState<TaxonomyNode | null>(null)
  const [pcaTransform, setPcaTransform] = useState<PCATransform | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/taxonomy')
      .then((res) => res.json())
      .then((response: TaxonomyResponse) => {
        setData(response.tree)
        setPcaTransform(response.pcaTransform)
      })
      .catch((err) => setError(err.message))
  }, [])

  return { data, pcaTransform, error }
}
