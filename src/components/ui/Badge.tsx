import { CSSProperties, ReactNode } from 'react'

type BadgeVariant = 'green' | 'blue' | 'amber' | 'red' | 'purple' | 'gray'

interface BadgeProps {
  variant: BadgeVariant
  children: ReactNode
}

const STYLES: Record<BadgeVariant, CSSProperties> = {
  green:  { background: 'var(--accent-dim)',  color: 'var(--accent)',  border: '1px solid rgba(61,214,140,0.2)' },
  blue:   { background: 'var(--blue-dim)',    color: 'var(--blue)',    border: '1px solid rgba(77,158,255,0.2)' },
  amber:  { background: 'var(--amber-dim)',   color: 'var(--amber)',   border: '1px solid rgba(245,166,35,0.2)' },
  red:    { background: 'var(--red-dim)',     color: 'var(--red)',     border: '1px solid rgba(240,82,82,0.2)' },
  purple: { background: 'var(--purple-dim)',  color: 'var(--purple)',  border: '1px solid rgba(167,139,250,0.2)' },
  gray:   { background: 'var(--bg3)',         color: 'var(--text3)',   border: '1px solid var(--border2)' },
}

export default function Badge({ variant, children }: BadgeProps) {
  return (
    <span style={{
      ...STYLES[variant],
      display: 'inline-flex',
      alignItems: 'center',
      fontSize: '10px',
      fontWeight: 600,
      letterSpacing: '0.04em',
      padding: '2px 7px',
      borderRadius: '4px',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  )
}
