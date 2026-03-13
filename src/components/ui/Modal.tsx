import { ReactNode, useEffect, useRef } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  width?: number
}

export default function Modal({ open, onClose, title, children, footer, width = 480 }: ModalProps) {
  const firstFocusRef = useRef<HTMLButtonElement>(null)
  // Keep a stable ref to onClose so the effect never needs to re-run when the
  // parent re-renders (e.g. on every controlled-input keystroke), which would
  // steal focus back to the close button.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    firstFocusRef.current?.focus()

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
      prev?.focus()
    }
  }, [open]) // intentionally omit onClose — stable via ref above

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        style={{
          background: 'var(--bg1)',
          border: '1px solid var(--border2)',
          borderRadius: 'var(--radius-lg)',
          padding: '22px',
          width: `${width}px`,
          maxWidth: 'calc(100vw - 48px)',
          maxHeight: 'calc(100vh - 80px)',
          overflowY: 'auto',
          animation: 'fade-in 0.15s ease',
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '18px',
        }}>
          <h2 id="modal-title" style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text1)' }}>
            {title}
          </h2>
          <button
            ref={firstFocusRef}
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text3)',
              cursor: 'pointer',
              fontSize: '18px',
              lineHeight: 1,
              padding: '2px 6px',
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div>{children}</div>

        {footer && (
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
            marginTop: '20px',
            paddingTop: '16px',
            borderTop: '1px solid var(--border)',
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
