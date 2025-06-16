import { getDB } from './database';
import { Collection, FieldSchema } from '../models/collection';
import { Database, Statement } from 'bun:sqlite';

const TABLE_COLLECTIONS = '_collections';

// Helper to map our FieldSchema types to SQLite types
// This needs to be comprehensive based on supported field types.
function getSQLiteType(fieldType: string, fieldOptions?: any): string {
  switch (fieldType.toLowerCase()) {
    case 'text':
    case 'email':
    case 'url':
    case 'editor': // Assuming HTML content
    case 'select': // Storing the selected value
    case 'json':   // Storing as TEXT, validated as JSON
      return 'TEXT';
    case 'number':
      return 'REAL'; // Or INTEGER if you distinguish
    case 'bool':
      return 'INTEGER'; // 0 or 1
    case 'date':
      return 'TEXT'; // ISO8601 strings
    case 'file': // If storing a single file path/key
      return 'TEXT';
    // case 'relation': // This would be an ID, so TEXT or INTEGER depending on related table's PK
    //   return 'TEXT';
    default:
      console.warn(`Unsupported field type "${fieldType}", defaulting to TEXT.`);
      return 'TEXT';
  }
}

// Helper to construct CREATE TABLE column definitions
function buildColumnDefinitions(fields: FieldSchema[]): string {
  return fields
    .map(field => {
      let definition = `"${field.name}" ${getSQLiteType(field.type, field.options)}`;
      // Basic constraints from FieldSchema. PocketBase has more complex ones.
      if (field.required) {
        definition += ' NOT NULL';
      }
      // TODO: Handle default values, unique constraints from field.options
      return definition;
    })
    .join(', ');
}

export async function ensureCollectionsTableExists(db?: Database) {
  const dbInstance = db || getDB();
  try {
    const table = dbInstance.query(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(TABLE_COLLECTIONS);
    if (!table) {
      console.log(`Table ${TABLE_COLLECTIONS} not found, creating it...`);
      dbInstance.exec(`
        CREATE TABLE ${TABLE_COLLECTIONS} (
          id TEXT PRIMARY KEY DEFAULT ('r'||lower(hex(randomblob(7)))) NOT NULL,
          system BOOLEAN DEFAULT FALSE NOT NULL,
          type TEXT DEFAULT "base" NOT NULL,
          name TEXT UNIQUE NOT NULL,
          fields TEXT DEFAULT "[]" NOT NULL,
          indexes TEXT DEFAULT "[]" NOT NULL,
          listRule TEXT DEFAULT NULL,
          viewRule TEXT DEFAULT NULL,
          createRule TEXT DEFAULT NULL,
          updateRule TEXT DEFAULT NULL,
          deleteRule TEXT DEFAULT NULL,
          options TEXT DEFAULT "{}" NOT NULL,
          created TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%fZ')) NOT NULL,
          updated TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%fZ')) NOT NULL
        );
      `);
      dbInstance.exec(`CREATE INDEX IF NOT EXISTS idx__collections_name on ${TABLE_COLLECTIONS} (name);`);
      dbInstance.exec(`CREATE INDEX IF NOT EXISTS idx__collections_type on ${TABLE_COLLECTIONS} (type);`);
      console.log(`Table ${TABLE_COLLECTIONS} created.`);
    }
  } catch (error) {
    console.error(`Error ensuring table ${TABLE_COLLECTIONS} exists:`, error);
    throw error;
  }
}

ensureCollectionsTableExists().catch(err => {
  console.error("Failed to ensure _collections table exists on service load:", err);
  process.exit(1);
});

function parseCollection(row: any): Collection {
  return {
    ...row,
    system: Boolean(row.system),
    fields: typeof row.fields === 'string' ? JSON.parse(row.fields) : row.fields || [],
    indexes: typeof row.indexes === 'string' ? JSON.parse(row.indexes) : row.indexes || [],
    options: typeof row.options === 'string' ? JSON.parse(row.options) : row.options || {},
  };
}

export async function getAllCollections(db?: Database): Promise<Collection[]> {
  const dbInstance = db || getDB();
  try {
    const query = dbInstance.query(`SELECT * FROM ${TABLE_COLLECTIONS}`);
    return (query.all() as any[]).map(parseCollection);
  } catch (error) {
    console.error('Error getting all collections:', error);
    return [];
  }
}

export async function getCollectionByIdOrName(idOrName: string, db?: Database): Promise<Collection | null> {
  const dbInstance = db || getDB();
  try {
    const isLikelyId = idOrName.startsWith('r') && idOrName.length === 15;
    const queryStr = isLikelyId ? `SELECT * FROM ${TABLE_COLLECTIONS} WHERE id = ?` : `SELECT * FROM ${TABLE_COLLECTIONS} WHERE name = ?`;
    const row = dbInstance.query(queryStr).get(idOrName) as any | null;
    return row ? parseCollection(row) : null;
  } catch (error) {
    console.error(`Error getting collection by id/name ${idOrName}:`, error);
    return null;
  }
}

function validateCollectionSchema(collection: Partial<Collection>): string[] {
    const errors: string[] = [];
    if (!collection.name || !/^[a-zA-Z0-9_]+$/.test(collection.name)) {
        errors.push('Collection name is required and can only contain alphanumeric characters and underscores.');
    }
    if (collection.name && (collection.name.startsWith('sqlite_') || collection.name.startsWith('_'))) {
        errors.push('Collection name cannot start with "sqlite_" or "_".');
    }
    if (!collection.fields || !Array.isArray(collection.fields) || collection.fields.length === 0) {
        errors.push('Collection must have at least one field defined.');
    } else {
        const fieldNames = new Set<string>();
        collection.fields.forEach((field, index) => {
            if (!field.name || !/^[a-zA-Z0-9_]+$/.test(field.name)) {
                errors.push(`Field ${index} name is required and must be alphanumeric/underscore.`);
            } else if (fieldNames.has(field.name)) {
                errors.push(`Duplicate field name: ${field.name}.`);
            } else {
                fieldNames.add(field.name);
            }
            if (!field.type) {
                errors.push(`Field ${field.name || index} type is required.`);
            }
            // TODO: Validate against known field types and options for each type
        });
    }
    return errors;
}

export async function createCollection(
  data: Omit<Collection, 'id' | 'created' | 'updated' | 'system'>,
  db?: Database
): Promise<{ collection: Collection | null; errors: string[] }> {
  const dbInstance = db || getDB();
  const validationErrors = validateCollectionSchema(data);
  if (validationErrors.length > 0) {
      return { collection: null, errors: validationErrors };
  }

  const now = new Date().toISOString();
  const id = 'r' + Math.random().toString(36).substring(2, 9) + Math.random().toString(36).substring(2, 9);

  const collectionData: Collection = {
    id, system: false, type: data.type || 'base', name: data.name,
    fields: data.fields || [], indexes: data.indexes || [],
    listRule: data.listRule || null, viewRule: data.viewRule || null,
    createRule: data.createRule || null, updateRule: data.updateRule || null,
    deleteRule: data.deleteRule || null, options: data.options || {},
    created: now, updated: now,
  };

  // Transaction for schema + table creation
  const tx = dbInstance.transaction(db_tx => {
    try {
      const stmt = db_tx.prepare(
        `INSERT INTO ${TABLE_COLLECTIONS} (id, system, type, name, fields, indexes, listRule, viewRule, createRule, updateRule, deleteRule, options, created, updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      stmt.run(
        collectionData.id, collectionData.system ? 1 : 0, collectionData.type, collectionData.name,
        JSON.stringify(collectionData.fields), JSON.stringify(collectionData.indexes),
        collectionData.listRule, collectionData.viewRule, collectionData.createRule,
        collectionData.updateRule, collectionData.deleteRule, JSON.stringify(collectionData.options),
        collectionData.created, collectionData.updated
      );

      // Create the actual data table for this collection
      // Standard fields: id (PK), created, updated. Plus user-defined fields.
      const columnDefinitions = buildColumnDefinitions(collectionData.fields);
      const createTableQuery = `
        CREATE TABLE "${collectionData.name}" (
          "id" TEXT PRIMARY KEY DEFAULT ('r'||lower(hex(randomblob(7)))) NOT NULL,
          "created" TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%fZ')) NOT NULL,
          "updated" TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%fZ')) NOT NULL
          ${columnDefinitions ? ', ' + columnDefinitions : ''}
        );`;
      console.log(`Executing CREATE TABLE for ${collectionData.name}: ${createTableQuery}`);
      db_tx.exec(createTableQuery);

      // TODO: Create indexes specified in collectionData.indexes on the new table

      const newCollection = parseCollection(db_tx.query(`SELECT * FROM ${TABLE_COLLECTIONS} WHERE id = ?`).get(collectionData.id) as any);
      return { collection: newCollection, errors: [] };
    } catch (error) {
      console.error('Transaction error in createCollection:', error);
      // db_tx.rollback(); // Bun's transaction will automatically rollback if an error is thrown. Explicit rollback() is not needed if error propagates.
      if (error.message.includes('UNIQUE constraint failed') && error.message.includes('_collections.name')) {
          return { collection: null, errors: [`Collection with name "${collectionData.name}" already exists.`] };
      }
      if (error.message.includes('already exists') && error.message.includes(collectionData.name)) {
          return { collection: null, errors: [`Table "${collectionData.name}" already exists in the database.`] };
      }
      // Re-throw the error to ensure transaction rolls back if not one of the handled cases
      throw error;
    }
  });

  try {
    return tx(dbInstance); // Execute the transaction
  } catch (error) {
    // Catch errors re-thrown from the transaction block
    return { collection: null, errors: [error.message] };
  }
}

export async function updateCollection(
  idOrName: string,
  data: Partial<Omit<Collection, 'id' | 'created' | 'system'>>,
  db?: Database
): Promise<{ collection: Collection | null; errors: string[] }> {
  const dbInstance = db || getDB();
  const existingCollection = await getCollectionByIdOrName(idOrName, dbInstance);
  if (!existingCollection) {
    return { collection: null, errors: ['Collection not found'] };
  }
  if (existingCollection.system) {
    return { collection: null, errors: ['System collections cannot be modified.'] };
  }

  const originalName = existingCollection.name;
  const updatedCollectionData = { ...existingCollection, ...data, updated: new Date().toISOString() };

  const validationErrors = validateCollectionSchema(updatedCollectionData);
  if (validationErrors.length > 0) {
      return { collection: null, errors: validationErrors };
  }

  // Transaction for schema update + table alteration (if any)
  const tx = dbInstance.transaction(db_tx => {
    try {
        // Update _collections table entry
        const stmt = db_tx.prepare(
        `UPDATE ${TABLE_COLLECTIONS} SET type = ?, name = ?, fields = ?, indexes = ?,
        listRule = ?, viewRule = ?, createRule = ?, updateRule = ?, deleteRule = ?,
        options = ?, updated = ? WHERE id = ?`
        );
        stmt.run(
        updatedCollectionData.type, updatedCollectionData.name, JSON.stringify(updatedCollectionData.fields),
        JSON.stringify(updatedCollectionData.indexes), updatedCollectionData.listRule, updatedCollectionData.viewRule,
        updatedCollectionData.createRule, updatedCollectionData.updateRule, updatedCollectionData.deleteRule,
        JSON.stringify(updatedCollectionData.options), updatedCollectionData.updated, existingCollection.id
        );

        // Handle table rename if name changed
        if (originalName !== updatedCollectionData.name) {
            console.log(`Renaming table from "${originalName}" to "${updatedCollectionData.name}"`);
            db_tx.exec(`ALTER TABLE "${originalName}" RENAME TO "${updatedCollectionData.name}";`);
        }

        // TODO: Handle field changes (add/remove/modify columns). This is complex.
        // SQLite's ALTER TABLE is limited. For now, we are NOT modifying existing columns or adding new ones.
        // A full solution might involve creating a new table, copying data, deleting old table, renaming new.
        console.warn(`Collection schema for "${updatedCollectionData.name}" updated in _collections. ` +
                     `Advanced data table migrations (add/remove/alter columns) are not yet implemented.`);

        const newlyUpdatedCollection = parseCollection(db_tx.query(`SELECT * FROM ${TABLE_COLLECTIONS} WHERE id = ?`).get(existingCollection.id) as any);
        return { collection: newlyUpdatedCollection, errors: [] };

    } catch (error) {
        console.error(`Transaction error in updateCollection for ${idOrName}:`, error);
        // db_tx.rollback(); // Auto-rollback if error is thrown
        if (error.message.includes('UNIQUE constraint failed') && error.message.includes('_collections.name')) {
            return { collection: null, errors: [`Another collection with name "${updatedCollectionData.name}" already exists.`] };
        }
        if (error.message.includes('no such table') && error.message.includes(originalName)) {
             return { collection: null, errors: [`Original data table "${originalName}" not found for renaming.`] };
        }
        throw error;
    }
  });
  try {
    return tx(dbInstance);
  } catch (error) {
    return { collection: null, errors: [error.message] };
  }
}


export async function deleteCollection(idOrName: string, db?: Database): Promise<{ success: boolean; errors: string[] }> {
  const dbInstance = db || getDB();
  const collection = await getCollectionByIdOrName(idOrName, dbInstance);
  if (!collection) {
    return { success: false, errors: ['Collection not found to delete its schema.'] };
  }
  if (collection.system) {
    return { success: false, errors: ['System collections cannot be deleted.'] };
  }

  const tx = dbInstance.transaction(db_tx => {
    try {
      // Delete from _collections table
      const stmt = db_tx.prepare(`DELETE FROM ${TABLE_COLLECTIONS} WHERE id = ?`);
      stmt.run(collection.id);

      // const changes = db_tx.changes; // This is for the last operation in this transaction context
      // Bun's `db.changes` is a property of the Database instance, not specific to transaction object `db_tx`
      // To get changes for this specific operation, it's usually checked after `stmt.run()` on `dbInstance.changes`
      // However, since we are in a transaction, the effect of `dbInstance.changes` might be seen after tx commits.
      // For now, we'll assume if stmt.run() doesn't throw, it worked.

      // Drop the actual data table
      console.log(`Dropping data table for collection: "${collection.name}"`);
      db_tx.exec(`DROP TABLE IF EXISTS "${collection.name}";`);

      return { success: true, errors: [] };
    } catch (error) {
      console.error(`Transaction error in deleteCollection for ${idOrName}:`, error);
      // db_tx.rollback(); // Auto-rollback
      throw error;
    }
  });
  try {
    const result = tx(dbInstance);
    // Check `dbInstance.changes` here if needed, *after* the transaction has successfully committed.
    // However, deleteCollection returns {success, errors}, not the affected collection.
    // The success flag from transaction execution is primary.
    return result;
  } catch (error) {
    return { success: false, errors: [error.message] };
  }
}

console.log('Collection service (collection.service.ts) updated with basic data table management (create/delete/rename).');
