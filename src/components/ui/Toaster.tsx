import { useToastStore } from '../../store/useToastStore'

const COLORS: Record<string, { bg: string; border: string; icon: string; color: string }> = {
  success: { bg: 'var(--accent-dim)',  border: 'rgba(61,214,140,0.25)', icon: '✓', color: 'var(--accent)' },
  error:   { bg: 'var(--red-dim)',     border: 'rgba(240,82,82,0.25)',  icon: '✕', color: 'var(--red)' },
  info:    { bg: 'var(--bg3)',         border: 'var(--border2)',        icon: 'ℹ', color: 'var(--text2)' },
}

export default function Toaster() {
  const { toasts, removeToast } = useToastStore()

  if (toasts.length === 0) return null

  return (
    <div style={{
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      pointerEvents: 'none',
    }}>
      {toasts.map(t => {
        const c = COLORS[t.type]
        return (
          <div
            key={t.id}
            onClick={() => removeToast(t.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              background: c.bg,
              border: `1px solid ${c.border}`,
              borderRadius: 'var(--radius)',
              padding: '10px 14px',
              fontSize: '13px',
              color: 'var(--text1)',
              minWidth: '220px',
              maxWidth: '360px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
              pointerEvents: 'all',
              cursor: 'pointer',
              animation: 'toast-in 0.2s ease',
            }}
          >
            <span style={{ color: c.color, fontWeight: 700, fontSize: '14px', flexShrink: 0 }}>
              {c.icon}
            </span>
            <span>{t.message}</span>
          </div>
        )
      })}
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
