import { getDB } from './database';
import { Param } from '../models/param';
import { Database } from 'bun:sqlite';

const TABLE_PARAMS = '_params';

export async function ensureParamsTableExists(db?: Database) {
  const dbInstance = db || getDB();
  try {
    const table = dbInstance.query(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(TABLE_PARAMS);
    if (!table) {
      console.log(`Table ${TABLE_PARAMS} not found, creating it...`);
      dbInstance.exec(`
        CREATE TABLE ${TABLE_PARAMS} (
          id TEXT PRIMARY KEY DEFAULT ('r'||lower(hex(randomblob(7)))) NOT NULL,
          value TEXT DEFAULT NULL, -- Storing JSON as TEXT
          created TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%fZ')) NOT NULL,
          updated TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%fZ')) NOT NULL
        );
      `);
      console.log(`Table ${TABLE_PARAMS} created.`);
    }
  } catch (error) {
    console.error(`Error ensuring table ${TABLE_PARAMS} exists:`, error);
    // Allow error to propagate if critical for startup
    throw error;
  }
}

// Call once at service load to ensure table on startup if not using a full migration system yet
ensureParamsTableExists().catch(err => {
    console.error("Failed to ensure _params table exists on service load:", err);
    process.exit(1); // Or handle more gracefully
});

export async function getAllParams(db?: Database): Promise<Param[]> {
  const dbInstance = db || getDB();
  try {
    const query = dbInstance.query(`SELECT id, value, created, updated FROM ${TABLE_PARAMS}`);
    const results = query.all() as any[]; // Cast to any[] first
    return results.map(param => ({
        ...param,
        value: param.value ? JSON.parse(param.value) : null // Parse JSON string
    }));
  } catch (error) {
    console.error('Error getting all params:', error);
    return [];
  }
}

export async function getParamById(id: string, db?: Database): Promise<Param | null> {
  const dbInstance = db || getDB();
  try {
    const query = dbInstance.query(`SELECT id, value, created, updated FROM ${TABLE_PARAMS} WHERE id = ?`);
    const result = query.get(id) as any | null; // Cast to any first
    if (result) {
        return {
            ...result,
            value: result.value ? JSON.parse(result.value) : null
        };
    }
    return null;
  } catch (error) {
    console.error(`Error getting param by id ${id}:`, error);
    return null;
  }
}

export async function setParam(id: string, value: any, db?: Database): Promise<Param | null> {
  const dbInstance = db || getDB();
  const now = new Date().toISOString();
  const valueJson = JSON.stringify(value);

  try {
    // Using INSERT OR REPLACE for upsert behavior (SQLite specific)
    const query = dbInstance.query(
      `INSERT OR REPLACE INTO ${TABLE_PARAMS} (id, value, created, updated)
       VALUES (?, ?,
               COALESCE((SELECT created FROM ${TABLE_PARAMS} WHERE id = ?), ?),
               ?)
       RETURNING *`
    );
    const result = query.get(id, valueJson, id, now, now) as any | null; // Cast to any
     if (result) {
        return {
            ...result,
            value: result.value ? JSON.parse(result.value) : null
        };
    }
    return null;
  } catch (error) {
    console.error(`Error setting param ${id}:`, error);
    return null;
  }
}

export async function deleteParam(id: string, db?: Database): Promise<boolean> {
  const dbInstance = db || getDB();
  try {
    const stmt = dbInstance.prepare(`DELETE FROM ${TABLE_PARAMS} WHERE id = ?`);
    stmt.run(id);
    return dbInstance.changes > 0; // Check if any row was actually deleted
  } catch (error) {
    console.error(`Error deleting param ${id}:`, error);
    return false;
  }
}
console.log('Param service (param.service.ts) created and _params table check initiated.');
