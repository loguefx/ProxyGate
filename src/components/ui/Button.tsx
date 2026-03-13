import { CSSProperties, ReactNode, ButtonHTMLAttributes } from 'react'

type ButtonVariant = 'primary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  children: ReactNode
}

const BASE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '5px',
  border: '1px solid',
  borderRadius: 'var(--radius)',
  cursor: 'pointer',
  fontWeight: 500,
  fontFamily: 'inherit',
  transition: 'background 0.15s, color 0.15s, border-color 0.15s',
  whiteSpace: 'nowrap',
}

const VARIANT_STYLES: Record<ButtonVariant, CSSProperties> = {
  primary: { background: 'var(--accent)',   borderColor: 'var(--accent)',   color: '#0d1a12' },
  ghost:   { background: 'transparent',     borderColor: 'var(--border2)',  color: 'var(--text2)' },
  danger:  { background: 'var(--red-dim)',  borderColor: 'rgba(240,82,82,0.2)', color: 'var(--red)' },
}

const SIZE_STYLES: Record<ButtonSize, CSSProperties> = {
  sm: { fontSize: '11.5px', padding: '5px 10px', height: '28px' },
  md: { fontSize: '13px',   padding: '7px 14px', height: '34px' },
}

const HOVER_BG: Record<ButtonVariant, string> = {
  primary: '#5de8a4',
  ghost:   'var(--bg3)',
  danger:  'rgba(240,82,82,0.15)',
}

const HOVER_COLOR: Record<ButtonVariant, string> = {
  primary: '#0d1a12',
  ghost:   'var(--text1)',
  danger:  'var(--red)',
}

export default function Button({
  variant = 'ghost',
  size = 'md',
  children,
  style,
  ...props
}: ButtonProps) {
  const v = variant
  return (
    <button
      {...props}
      style={{ ...BASE, ...VARIANT_STYLES[v], ...SIZE_STYLES[size], ...style }}
      onMouseEnter={e => {
        e.currentTarget.style.background = HOVER_BG[v]
        e.currentTarget.style.color = HOVER_COLOR[v]
        props.onMouseEnter?.(e)
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = (VARIANT_STYLES[v].background as string) ?? 'transparent'
        e.currentTarget.style.color = VARIANT_STYLES[v].color as string
        props.onMouseLeave?.(e)
      }}
    >
      {children}
    </button>
  )
}
