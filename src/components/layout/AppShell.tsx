import { Outlet } from 'react-router-dom'
import Topbar from './Topbar'
import Sidebar from './Sidebar'

export default function AppShell() {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '220px 1fr',
      gridTemplateRows: '52px 1fr',
      height: '100vh',
      overflow: 'hidden',
    }}>
      <div style={{ gridColumn: '1 / -1', gridRow: '1' }}>
        <Topbar />
      </div>
      <div style={{
        gridColumn: '1',
        gridRow: '2',
        background: 'var(--bg1)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <Sidebar />
      </div>
      <main style={{
        gridColumn: '2',
        gridRow: '2',
        background: 'var(--bg0)',
        overflowY: 'auto',
        padding: '24px',
      }}>
        <Outlet />
      </main>
    </div>
  )
}
