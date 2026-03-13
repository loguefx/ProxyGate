import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { useRouteStore } from './store/useRouteStore'
import { useServiceGroupStore } from './store/useServiceGroupStore'
import { useMiddlewareStore } from './store/useMiddlewareStore'
import { useTLSStore } from './store/useTLSStore'
import { useSettingsStore } from './store/useSettingsStore'
import { startLogTail } from './lib/tauri'

export default function App() {
  useEffect(() => {
    // Load all stores from SQLite, then push the saved config into the proxy engine
    Promise.all([
      useRouteStore.getState().load(),
      useServiceGroupStore.getState().load(),
      useMiddlewareStore.getState().load(),
      useTLSStore.getState().load(),
      useSettingsStore.getState().load(),
    ])
      .then(async () => {
        // Push persisted config into the running proxy on every app start
        const { regenerateConfig } = await import('./lib/configGen')
        await regenerateConfig()
      })
      .catch(err => {
        console.error('Failed to load stores:', err)
      })

    // #region agent log - H-A: startLogTail called from frontend
    startLogTail()
      .then(() => {
        fetch('http://127.0.0.1:7581/ingest/0e536268-4ef3-4f03-9144-c51c9664b047',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f9f24b'},body:JSON.stringify({sessionId:'f9f24b',location:'App.tsx:startLogTail',message:'startLogTail resolved OK',data:{},hypothesisId:'H-A',timestamp:Date.now()})}).catch(()=>{});
      })
      .catch((err) => {
        fetch('http://127.0.0.1:7581/ingest/0e536268-4ef3-4f03-9144-c51c9664b047',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f9f24b'},body:JSON.stringify({sessionId:'f9f24b',location:'App.tsx:startLogTail',message:'startLogTail FAILED',data:{error:String(err)},hypothesisId:'H-A',timestamp:Date.now()})}).catch(()=>{});
      })
    // #endregion
  }, [])

  return <RouterProvider router={router} />
}
