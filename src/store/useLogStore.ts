import { create } from 'zustand'
import { LogLine } from '../lib/tauri'

// Logs are stored in-memory only — no disk writes, just RAM.
// At ~200 bytes per entry this cap uses ~200 KB at most.
const MAX_ENTRIES = 1000

interface LogStore {
  lines: LogLine[]
  append: (line: LogLine) => void
  clear: () => void
}

export const useLogStore = create<LogStore>((set) => ({
  lines: [],

  append(line) {
    set(s => {
      const next = [...s.lines, line]
      return { lines: next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next }
    })
  },

  clear() {
    set({ lines: [] })
  },
}))
