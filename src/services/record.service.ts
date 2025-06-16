import { getDB } from './database';
import { Collection, FieldSchema } from '../models/collection';
import * as collectionService from './collection.service'; // To get collection schema
import { Database, Statement } from 'bun:sqlite';

// --- Data Validation and Coercion ---

// Basic validator and coercer based on field schema
// TODO: Expand with more robust validation (min/max length, regex, specific formats like email/url)
function validateAndCoerce(value: any, field: FieldSchema): { value?: any; error?: string } {
  if (value === undefined || value === null) {
    if (field.required) {
      return { error: `Field "${field.name}" is required.` };
    }
    return { value: null }; // Explicitly null for DB if not required and not provided
  }

  switch (field.type.toLowerCase()) {
    case 'text':
    case 'email':
    case 'url':
    case 'editor':
    case 'select':
      if (typeof value !== 'string') return { error: `Field "${field.name}" must be a string.` };
      // TODO: Add length validation from field.options
      return { value };
    case 'number':
      const num = Number(value);
      if (isNaN(num)) return { error: `Field "${field.name}" must be a number.` };
      // TODO: Add min/max validation from field.options
      return { value: num };
    case 'bool':
      if (typeof value !== 'boolean') return { error: `Field "${field.name}" must be a boolean.` };
      return { value: value ? 1 : 0 }; // Coerce to integer for SQLite
    case 'date':
      // Expect ISO8601 string, store as TEXT. Validate format.
      if (typeof value !== 'string' || isNaN(new Date(value).getTime())) {
        return { error: `Field "${field.name}" must be a valid ISO8601 date string.`};
      }
      return { value };
    case 'json':
      try {
        // If it's already an object/array, stringify for storage.
        // If it's a string, try to parse to ensure it's valid JSON.
        const V = typeof value === 'string' ? JSON.parse(value) : value;
        return { value: JSON.stringify(V) };
      } catch (e) {
        return { error: `Field "${field.name}" must be valid JSON or a JSON string.` };
      }
    case 'file': // Assuming we store a file key (string) or array of keys
      if (typeof value !== 'string' && (!Array.isArray(value) || !value.every(v => typeof v === 'string'))) {
        return { error: `Field "${field.name}" must be a string or an array of strings (file keys).` };
      }
      // If it's an array, store as JSON string. If single, as TEXT.
      // This depends on how 'file' field options (maxSelect) are handled.
      // For simplicity, let's assume single file key stored as TEXT for now.
      if (Array.isArray(value)) { // If multiple files allowed by field.options.maxSelect > 1
          return { value: JSON.stringify(value) };
      }
      return { value }; // Single file key
    default:
      return { value }; // Unknown type, pass through
  }
}


// --- Record CRUD Operations ---

export async function createRecord(
  collectionName: string,
  data: Record<string, any>,
  db?: Database
): Promise<{ record?: Record<string, any>; errors?: string[] }> {
  const dbInstance = db || getDB();
  const collection = await collectionService.getCollectionByIdOrName(collectionName, dbInstance);
  if (!collection) {
    return { errors: [`Collection "${collectionName}" not found.`] };
  }

  // TODO: Implement rule checking (collection.createRule)

  const recordId = 'r' + Math.random().toString(36).substring(2, 9) + Math.random().toString(36).substring(2, 9);
  const now = new Date().toISOString();

  const fieldNames: string[] = ['id', 'created', 'updated'];
  const valuePlaceholders: string[] = ['?', '?', '?'];
  const values: any[] = [recordId, now, now];
  const validationErrors: string[] = [];

  for (const field of collection.fields) {
    if (data.hasOwnProperty(field.name)) {
      const validationResult = validateAndCoerce(data[field.name], field);
      if (validationResult.error) {
        validationErrors.push(validationResult.error);
      } else {
        fieldNames.push(`"${field.name}"`); // Quote field name
        valuePlaceholders.push('?');
        values.push(validationResult.value);
      }
    } else if (field.required) {
      validationErrors.push(`Field "${field.name}" is required.`);
    }
    // Non-required fields not in data are omitted, will get DB default or NULL
  }

  if (validationErrors.length > 0) {
    return { errors: validationErrors };
  }
  if (fieldNames.length === 3) { // Only id, created, updated
      return { errors: ["Cannot create an empty record. No valid fields provided."] };
  }

  const query = `INSERT INTO "${collection.name}" (${fieldNames.join(', ')}) VALUES (${valuePlaceholders.join(', ')}) RETURNING *;`;

  try {
    const stmt = dbInstance.prepare(query);
    const newRecord = stmt.get(...values) as Record<string, any>;

    // Coerce boolean fields back from 0/1 and parse JSON fields
    if (newRecord) {
        collection.fields.forEach(field => {
            if (newRecord.hasOwnProperty(field.name) && newRecord[field.name] !== null) {
                if (field.type.toLowerCase() === 'bool') {
                    newRecord[field.name] = Boolean(newRecord[field.name]);
                } else if (field.type.toLowerCase() === 'json' && typeof newRecord[field.name] === 'string') {
                    try { newRecord[field.name] = JSON.parse(newRecord[field.name]); } catch (e) { /* ignore parse error on read */ }
                } else if (field.type.toLowerCase() === 'file' && typeof newRecord[field.name] === 'string') {
                    // Attempt to parse if it might be a JSON array of file keys
                    try {
                        const parsed = JSON.parse(newRecord[field.name]);
                        if (Array.isArray(parsed)) {
                           newRecord[field.name] = parsed;
                        }
                    } catch (e) { /* ignore if not a JSON array, keep as string */ }
                }
            }
        });
    }
    return { record: newRecord };
  } catch (error) {
    console.error(`Error creating record in "${collection.name}":`, error);
    return { errors: [error.message] };
  }
}

export async function getRecordById(
  collectionName: string,
  recordId: string,
  db?: Database
): Promise<{ record?: Record<string, any>; errors?: string[] }> {
  const dbInstance = db || getDB();
  const collection = await collectionService.getCollectionByIdOrName(collectionName, dbInstance);
  if (!collection) {
    return { errors: [`Collection "${collectionName}" not found.`] };
  }

  // TODO: Implement rule checking (collection.viewRule)

  const query = `SELECT * FROM "${collection.name}" WHERE id = ?;`;
  try {
    const stmt = dbInstance.prepare(query);
    const record = stmt.get(recordId) as Record<string, any>;
    if (!record) {
      return { errors: [`Record with ID "${recordId}" not found in "${collectionName}".`] };
    }
    // Coerce boolean fields back from 0/1 and parse JSON fields
    collection.fields.forEach(field => {
        if (record.hasOwnProperty(field.name) && record[field.name] !== null) {
            if (field.type.toLowerCase() === 'bool') {
                record[field.name] = Boolean(record[field.name]);
            } else if (field.type.toLowerCase() === 'json' && typeof record[field.name] === 'string') {
                try { record[field.name] = JSON.parse(record[field.name]); } catch (e) { /* ignore */ }
            } else if (field.type.toLowerCase() === 'file' && typeof record[field.name] === 'string') {
                 try {
                        const parsed = JSON.parse(record[field.name]);
                        if (Array.isArray(parsed)) {
                           record[field.name] = parsed;
                        }
                    } catch (e) { /* ignore */ }
            }
        }
    });
    return { record };
  } catch (error) {
    console.error(`Error fetching record "${recordId}" from "${collection.name}":`, error);
    return { errors: [error.message] };
  }
}

export async function listRecords(
  collectionName: string,
  options?: { filter?: string; sort?: string; page?: number; perPage?: number }, // TODO: Implement filter, sort, pagination
  db?: Database
): Promise<{ records?: Record<string, any>[]; total?: number; page?: number; perPage?: number; totalPages?: number; errors?: string[] }> {
  const dbInstance = db || getDB();
  const collection = await collectionService.getCollectionByIdOrName(collectionName, dbInstance);
  if (!collection) {
    return { errors: [`Collection "${collectionName}" not found.`] };
  }

  // TODO: Implement rule checking (collection.listRule)
  // TODO: Implement filtering and sorting based on PocketBase filter syntax

  let query = `SELECT * FROM "${collection.name}"`;
  const countQuery = `SELECT COUNT(*) as total FROM "${collection.name}"`;

  const perPage = options?.perPage || 30;
  const page = options?.page || 1;
  query += ` LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`;

  try {
    const stmt = dbInstance.prepare(query);
    const records = stmt.all() as Record<string, any>[];

    const countStmt = dbInstance.prepare(countQuery);
    const { total } = countStmt.get() as { total: number };

    // Coerce boolean fields and parse JSON for each record
    const processedRecords = records.map(record => {
        const processedRecord = { ...record };
        collection.fields.forEach(field => {
            if (processedRecord.hasOwnProperty(field.name) && processedRecord[field.name] !== null) {
                if (field.type.toLowerCase() === 'bool') {
                    processedRecord[field.name] = Boolean(processedRecord[field.name]);
                } else if (field.type.toLowerCase() === 'json' && typeof processedRecord[field.name] === 'string') {
                    try { processedRecord[field.name] = JSON.parse(processedRecord[field.name]); } catch (e) { /* ignore */ }
                } else if (field.type.toLowerCase() === 'file' && typeof processedRecord[field.name] === 'string') {
                    try {
                        const parsed = JSON.parse(processedRecord[field.name]);
                        if (Array.isArray(parsed)) {
                           processedRecord[field.name] = parsed;
                        }
                    } catch (e) { /* ignore */ }
                }
            }
        });
        return processedRecord;
    });

    return { records: processedRecords, total, page, perPage, totalPages: Math.ceil(total / perPage) };
  } catch (error) {
    console.error(`Error listing records from "${collection.name}":`, error);
    return { errors: [error.message] };
  }
}

export async function updateRecord(
  collectionName: string,
  recordId: string,
  data: Record<string, any>,
  db?: Database
): Promise<{ record?: Record<string, any>; errors?: string[] }> {
  const dbInstance = db || getDB();
  const collection = await collectionService.getCollectionByIdOrName(collectionName, dbInstance);
  if (!collection) {
    return { errors: [`Collection "${collectionName}" not found.`] };
  }

  // TODO: Implement rule checking (collection.updateRule)
  const existingCheck = await getRecordById(collectionName, recordId, dbInstance);
  if (existingCheck.errors || !existingCheck.record) {
      return { errors: existingCheck.errors || [`Record with ID "${recordId}" not found for update.`] };
  }

  const now = new Date().toISOString();
  const setClauses: string[] = [`"updated" = ?`];
  const values: any[] = [now];
  const validationErrors: string[] = [];

  for (const field of collection.fields) {
    if (data.hasOwnProperty(field.name)) {
      const validationResult = validateAndCoerce(data[field.name], field);
      if (validationResult.error) {
        validationErrors.push(validationResult.error);
      } else {
        setClauses.push(`"${field.name}" = ?`);
        values.push(validationResult.value);
      }
    }
  }

  if (validationErrors.length > 0) {
    return { errors: validationErrors };
  }
  if (setClauses.length === 1) {
    return { errors: ["No valid fields provided for update."] };
  }

  values.push(recordId); // For WHERE id = ?

  const query = `UPDATE "${collection.name}" SET ${setClauses.join(', ')} WHERE id = ? RETURNING *;`;

  try {
    const stmt = dbInstance.prepare(query);
    const updatedRecord = stmt.get(...values) as Record<string, any>;

     if (updatedRecord) {
        collection.fields.forEach(field => {
            if (updatedRecord.hasOwnProperty(field.name) && updatedRecord[field.name] !== null) {
                if (field.type.toLowerCase() === 'bool') {
                    updatedRecord[field.name] = Boolean(updatedRecord[field.name]);
                } else if (field.type.toLowerCase() === 'json' && typeof updatedRecord[field.name] === 'string') {
                    try { updatedRecord[field.name] = JSON.parse(updatedRecord[field.name]); } catch (e) { /* ignore */ }
                } else if (field.type.toLowerCase() === 'file' && typeof updatedRecord[field.name] === 'string') {
                     try {
                        const parsed = JSON.parse(updatedRecord[field.name]);
                        if (Array.isArray(parsed)) {
                           updatedRecord[field.name] = parsed;
                        }
                    } catch (e) { /* ignore */ }
                }
            }
        });
    }
    return { record: updatedRecord };
  } catch (error) {
    console.error(`Error updating record "${recordId}" in "${collection.name}":`, error);
    return { errors: [error.message] };
  }
}

export async function deleteRecord(
  collectionName: string,
  recordId: string,
  db?: Database
): Promise<{ success?: boolean; errors?: string[] }> {
  const dbInstance = db || getDB();
  const collection = await collectionService.getCollectionByIdOrName(collectionName, dbInstance);
  if (!collection) {
    return { errors: [`Collection "${collectionName}" not found.`] };
  }

  // TODO: Implement rule checking (collection.deleteRule)

  const query = `DELETE FROM "${collection.name}" WHERE id = ?;`;
  try {
    const stmt = dbInstance.prepare(query);
    stmt.run(recordId);
    const changes = dbInstance.changes;
    if (changes === 0) {
        return { errors: [`Record with ID "${recordId}" not found in "${collectionName}" or already deleted.`] };
    }
    return { success: true };
  } catch (error) {
    console.error(`Error deleting record "${recordId}" from "${collection.name}":`, error);
    return { errors: [error.message] };
  }
}

console.log('Record service (record.service.ts) for dynamic collections created.');
