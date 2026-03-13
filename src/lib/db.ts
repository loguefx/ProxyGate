import Database from '@tauri-apps/plugin-sql'

let _db: Database | null = null

async function getDb(): Promise<Database> {
  if (!_db) {
    _db = await Database.load('sqlite:proxygate.db')
  }
  return _db
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const db = await getDb()
  return db.select<T[]>(sql, params)
}

export async function execute(
  sql: string,
  params: unknown[] = []
): Promise<{ rowsAffected: number; lastInsertId?: number }> {
  const db = await getDb()
  return db.execute(sql, params)
}

export const db = { query, execute }
