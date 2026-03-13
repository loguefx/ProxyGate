import { createHashRouter } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import Dashboard from './pages/Dashboard'
import Routes from './pages/Routes'
import ServiceGroups from './pages/ServiceGroups'
import Middleware from './pages/Middleware'
import TLS from './pages/TLS'
import Logs from './pages/Logs'
import DNS from './pages/DNS'
import Settings from './pages/Settings'

// Hash router required because Tauri serves from file:// — no server-side routing
export const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true,        element: <Dashboard /> },
      { path: 'routes',     element: <Routes /> },
      { path: 'services',   element: <ServiceGroups /> },
      { path: 'middleware', element: <Middleware /> },
      { path: 'tls',        element: <TLS /> },
      { path: 'logs',       element: <Logs /> },
      { path: 'dns',        element: <DNS /> },
      { path: 'settings',   element: <Settings /> },
    ],
  },
])
