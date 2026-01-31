import React, { useState, useRef, useCallback } from 'react'

export function useTooltip(): {
  content: React.ReactNode | null
  position: { x: number; y: number }
  show: (e: React.MouseEvent, content: React.ReactNode) => void
  hide: () => void
  ref: React.RefObject<HTMLDivElement | null>
} {
  const [content, setContent] = useState<React.ReactNode | null>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const ref = useRef<HTMLDivElement>(null)

  const show = useCallback((e: React.MouseEvent, tooltipContent: React.ReactNode) => {
    setContent(tooltipContent)
    setPosition({ x: e.clientX + 10, y: e.clientY + 10 })
  }, [])

  const hide = useCallback(() => setContent(null), [])

  return { content, position, show, hide, ref }
}
