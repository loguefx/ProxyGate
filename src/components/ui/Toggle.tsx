interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

export default function Toggle({ checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: '36px',
        height: '20px',
        borderRadius: '10px',
        border: checked ? '1px solid rgba(61,214,140,0.3)' : '1px solid var(--border2)',
        background: checked ? 'var(--accent-dim)' : 'var(--bg4)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        position: 'relative',
        padding: 0,
        transition: 'background 0.2s, border-color 0.2s',
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        position: 'absolute',
        top: '3px',
        left: checked ? '17px' : '3px',
        width: '12px',
        height: '12px',
        borderRadius: '50%',
        background: checked ? 'var(--accent)' : 'var(--text3)',
        transition: 'left 0.2s, background 0.2s',
      }} />
    </button>
  )
}
