import { Database } from 'bun:sqlite';

// TODO: The database path should ideally come from an environment variable
const dbPath = './pb_data/data.db'; // Assuming similar data path structure

let db: Database;

export function getDB(): Database {
  if (!db) {
    console.log(`Connecting to SQLite database at: ${dbPath}`);
    try {
      db = new Database(dbPath, { create: true });
      // Enable WAL mode for better concurrency, if not already enabled by the Go app
      // db.exec('PRAGMA journal_mode = WAL;');
      console.log('Successfully connected to SQLite database.');
    } catch (error) {
      console.error('Failed to connect to SQLite database:', error);
      throw error;
    }
  }
  return db;
}

// Function to initialize schema if needed (simplified)
export async function initializeSchema() {
  const dbInstance = getDB();

  // For now, we'll assume tables are created by existing migrations.
  // Later, we might add Bun-based migration logic or schema creation here if starting from scratch.
  console.log('Database schema initialization check...');

  // Example: Check if _params table exists
  try {
    const paramsTable = dbInstance.query('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'_params\';').get();
    if (!paramsTable) {
      console.log('_params table not found. Consider running migrations or initial schema setup.');
      // dbInstance.exec(`
      //   CREATE TABLE _params (
      //     id TEXT PRIMARY KEY DEFAULT ('r'||lower(hex(randomblob(7)))) NOT NULL,
      //     value JSON DEFAULT NULL,
      //     created TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%fZ')) NOT NULL,
      //     updated TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%fZ')) NOT NULL
      //   );
      // `);
      // console.log('_params table created.');
    } else {
      console.log('_params table exists.');
    }
  } catch (error) {
    console.error('Error during schema initialization check:', error);
  }
}

// Call initializeSchema on startup, or handle this more explicitly in app bootstrap
// initializeSchema().catch(console.error);
