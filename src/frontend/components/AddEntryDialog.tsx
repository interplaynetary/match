import { useState, useCallback } from 'react'

export interface AddEntryDialogProps {
  onSubmit: (entry: { naturalLanguage: string; type: 'capacity' | 'need' }) => Promise<void>
}

const needPatterns = /\b(i need|looking for|seeking|want|help me)\b/i
const capacityPatterns = /\b(i offer|i can|i have|i'm a|i am a|providing|for sale)\b/i

function detectType(text: string): 'capacity' | 'need' {
  if (capacityPatterns.test(text)) return 'capacity'
  if (needPatterns.test(text)) return 'need'
  return 'need' // default
}

export function AddEntryDialog({ onSubmit }: AddEntryDialogProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [text, setText] = useState('')
  const [type, setType] = useState<'capacity' | 'need'>('need')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleTextChange = useCallback((value: string) => {
    setText(value)
    setType(detectType(value))
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!text.trim()) return

    setIsSubmitting(true)
    setError(null)

    try {
      await onSubmit({ naturalLanguage: text.trim(), type })
      setText('')
      setType('need')
      setIsOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add entry')
    } finally {
      setIsSubmitting(false)
    }
  }, [text, type, onSubmit])

  const handleClose = useCallback(() => {
    if (!isSubmitting) {
      setIsOpen(false)
      setError(null)
    }
  }, [isSubmitting])

  return (
    <>
      {/* Floating + Button */}
      <button
        onClick={() => setIsOpen(true)}
        style={{
          position: 'fixed',
          top: 20,
          left: 20,
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: '#0f3460',
          border: 'none',
          color: '#fff',
          fontSize: 28,
          fontWeight: 'bold',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          transition: 'background 0.2s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#1a1a2e')}
        onMouseLeave={(e) => (e.currentTarget.style.background = '#0f3460')}
      >
        +
      </button>

      {/* Dialog Overlay */}
      {isOpen && (
        <div
          onClick={handleClose}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
          }}
        >
          {/* Dialog Box */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#16213e',
              border: '1px solid #0f3460',
              borderRadius: 12,
              padding: 24,
              width: '90%',
              maxWidth: 480,
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: '1.2em', color: '#eee' }}>Add Entry</h2>
              <button
                onClick={handleClose}
                disabled={isSubmitting}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#888',
                  fontSize: 24,
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  padding: 4,
                }}
              >
                x
              </button>
            </div>

            {/* Text Input */}
            <textarea
              value={text}
              onChange={(e) => handleTextChange(e.target.value)}
              placeholder="Describe what you need or can offer..."
              disabled={isSubmitting}
              style={{
                width: '100%',
                minHeight: 100,
                padding: 12,
                background: '#0f3460',
                border: '1px solid #333',
                borderRadius: 8,
                color: '#eee',
                fontSize: 14,
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />

            {/* Type Toggle */}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                onClick={() => setType('need')}
                disabled={isSubmitting}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  background: type === 'need' ? '#4CAF50' : '#0f3460',
                  border: `1px solid ${type === 'need' ? '#4CAF50' : '#333'}`,
                  borderRadius: 6,
                  color: type === 'need' ? '#fff' : '#ccc',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  transition: 'background 0.2s',
                  fontSize: 14,
                }}
              >
                Need
              </button>
              <button
                onClick={() => setType('capacity')}
                disabled={isSubmitting}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  background: type === 'capacity' ? '#4CAF50' : '#0f3460',
                  border: `1px solid ${type === 'capacity' ? '#4CAF50' : '#333'}`,
                  borderRadius: 6,
                  color: type === 'capacity' ? '#fff' : '#ccc',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  transition: 'background 0.2s',
                  fontSize: 14,
                }}
              >
                Capacity
              </button>
            </div>

            {/* Error Message */}
            {error && (
              <div style={{ marginTop: 12, padding: 10, background: 'rgba(255, 107, 107, 0.2)', borderRadius: 6, color: '#ff6b6b', fontSize: 13 }}>
                {error}
              </div>
            )}

            {/* Submit Button */}
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || !text.trim()}
              style={{
                width: '100%',
                marginTop: 16,
                padding: '12px 20px',
                background: isSubmitting || !text.trim() ? '#2d5a3d' : '#4CAF50',
                border: 'none',
                borderRadius: 8,
                color: '#fff',
                fontSize: 15,
                fontWeight: 'bold',
                cursor: isSubmitting || !text.trim() ? 'not-allowed' : 'pointer',
                transition: 'background 0.2s',
              }}
            >
              {isSubmitting ? 'Adding...' : 'Add Entry'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
