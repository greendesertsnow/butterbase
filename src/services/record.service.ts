import { getDB } from './database';
import { Collection, FieldSchema } from '../models/collection';
import * as collectionService from './collection.service';
import * as ruleService from './rule.service';
import { AuthUser } from '../routes/auth';
import { appEvents, RecordCreatePayload, RecordUpdatePayload, RecordDeletePayload, RecordOperationSuccessPayload, RecordOperationErrorPayload } from './event.service';
import { isUserAdmin } from '../utils/auth.utils';
import { Database } from 'bun:sqlite';

function validateAndCoerce(value: any, field: FieldSchema): { value?: any; error?: string } {
  if (value === undefined || value === null) { if (field.required) return { error: `Field "${field.name}" is required.` }; return { value: null }; }
  switch (field.type.toLowerCase()) {
    case 'text': case 'email': case 'url': case 'editor': case 'select': if (typeof value !== 'string') return { error: `Field "${field.name}" must be a string.` }; return { value };
    case 'number': const num = Number(value); if (isNaN(num)) return { error: `Field "${field.name}" must be a number.` }; return { value: num };
    case 'bool': if (typeof value !== 'boolean') return { error: `Field "${field.name}" must be a boolean.` }; return { value: value ? 1 : 0 };
    case 'date': if (typeof value !== 'string' || isNaN(new Date(value).getTime())) return { error: `Field "${field.name}" must be a valid ISO8601 date string.`}; return { value };
    case 'json': try { const V = typeof value === 'string' ? JSON.parse(value) : value; return { value: JSON.stringify(V) }; } catch (e) { return { error: `Field "${field.name}" must be valid JSON or a JSON string.` }; }
    case 'file': if (typeof value !== 'string' && (!Array.isArray(value) || !value.every(v => typeof v === 'string'))) return { error: `Field "${field.name}" must be a string or an array of strings.`}; if (Array.isArray(value)) return { value: JSON.stringify(value) }; return { value };
    default: return { value };
  }
}
function prepareRecordForEvent(record: Record<string, any>, collection: Collection): Record<string, any> {
    const processedRecord = JSON.parse(JSON.stringify(record));
    collection.fields.forEach(field => {
        if (processedRecord.hasOwnProperty(field.name) && processedRecord[field.name] !== null) {
            if (field.type.toLowerCase() === 'bool') processedRecord[field.name] = Boolean(processedRecord[field.name]);
            else if (field.type.toLowerCase() === 'json' && typeof processedRecord[field.name] === 'string') try { processedRecord[field.name] = JSON.parse(processedRecord[field.name]); } catch (e) {}
            else if (field.type.toLowerCase() === 'file' && typeof processedRecord[field.name] === 'string') try { const parsed = JSON.parse(processedRecord[field.name]); if(Array.isArray(parsed)) processedRecord[field.name] = parsed; } catch(e) {}
        }
    }); return processedRecord;
}

export async function createRecord(
  collectionName: string, data: Record<string, any>, authContext?: AuthUser | null, db?: Database
): Promise<{ record?: Record<string, any>; errors?: string[] }> {
  const dbInstance = db || getDB();
  const collection = await collectionService.getCollectionByIdOrName(collectionName, dbInstance);
  if (!collection) { return { errors: [`Collection "${collectionName}" not found.`] }; }

  const createPayload: RecordCreatePayload = { record: data, collection, actor: authContext };
  try {
    await appEvents.emitStoppable('beforeRecordCreate', createPayload);
  } catch (eventError: any) { return { errors: [`beforeRecordCreate event hook failed: ${eventError.message}`] }; }

  const currentData = createPayload.record;

  if (collection.createRule && collection.createRule.trim() !== '') {
    const ruleEval = ruleService.evaluateRule(collection.createRule, { authRecord: authContext, requestData: currentData });
    if (ruleEval.error) { return { errors: [ruleEval.error] }; }
    if (ruleEval.allow === false || (ruleEval.condition && ruleEval.condition.sql === '1=0')) { return { errors: ['Access denied by create rule.'] };}
  }

  const recordId = 'r' + Math.random().toString(36).substring(2,9)+Math.random().toString(36).substring(2,9); const now = new Date().toISOString();
  const fieldNames: string[] = ['id', 'created', 'updated']; const valuePlaceholders: string[] = ['?', '?', '?']; const values: any[] = [recordId, now, now];
  const validationErrors: string[] = [];

  for (const field of collection.fields) {
    if (field.hidden && !isUserAdmin(authContext)) { if (currentData.hasOwnProperty(field.name)) validationErrors.push(`Field "${field.name}" is hidden.`); continue; }
    if (currentData.hasOwnProperty(field.name)) {
      const res = validateAndCoerce(currentData[field.name], field); if (res.error) validationErrors.push(res.error); else { fieldNames.push(`"${field.name}"`); valuePlaceholders.push('?'); values.push(res.value); }
    } else if (field.required) validationErrors.push(`Field "${field.name}" is required.`);
  }
  if (validationErrors.length > 0) { return { errors: validationErrors }; }
  if (fieldNames.length === 3) { return { errors: ["No valid fields provided."] }; }

  const query = `INSERT INTO "${collection.name}" (${fieldNames.join(', ')}) VALUES (${valuePlaceholders.join(', ')}) RETURNING *;`;
  try {
    const stmt = dbInstance.prepare(query); const newRecordDb = stmt.get(...values) as Record<string, any>;
    if (newRecordDb) {
      const finalRecord = prepareRecordForEvent(newRecordDb, collection);
      appEvents.emit('afterRecordCreateSuccess', { record: finalRecord, collection, actor: authContext });
      return { record: finalRecord };
    }
    throw new Error("Failed to retrieve record after creation.");
  } catch (error: any) {
    appEvents.emit('afterRecordCreateError', { record: currentData, collection, actor: authContext, error });
    console.error(`Error creating record in "${collection.name}":`, error); return { errors: [error.message] };
  }
}

export async function updateRecord(
  collectionName: string, recordId: string, data: Record<string, any>, authContext?: AuthUser | null, db?: Database
): Promise<{ record?: Record<string, any>; errors?: string[] }> {
  const dbInstance = db || getDB();
  const collection = await collectionService.getCollectionByIdOrName(collectionName, dbInstance);
  if (!collection) { return { errors: [`Collection "${collectionName}" not found.`] }; }

  const existingRecordResult = await getRecordById(collectionName, recordId, authContext, dbInstance);
  if (existingRecordResult.errors || !existingRecordResult.record) { return { errors: existingRecordResult.errors || [`Record not found or not accessible.`] }; }
  const oldRecord = existingRecordResult.record;

  const updatePayload: RecordUpdatePayload = { record: data, oldRecord, collection, actor: authContext };
  try {
    await appEvents.emitStoppable('beforeRecordUpdate', updatePayload);
  } catch (eventError: any) { return { errors: [`beforeRecordUpdate event hook failed: ${eventError.message}`] }; }

  const currentData = updatePayload.record;

  if (collection.updateRule && collection.updateRule.trim() !== '') {
    const ruleEval = ruleService.evaluateRule(collection.updateRule, { authRecord: authContext, requestData: currentData });
    if (ruleEval.error) { return { errors: [ruleEval.error] }; }
    if (ruleEval.allow === false || (ruleEval.condition && ruleEval.condition.sql === '1=0')) { return { errors: ['Access denied by update rule.'] };}
  }

  const now = new Date().toISOString(); const setClauses: string[] = [`"updated" = ?`]; const values: any[] = [now]; const validationErrors: string[] = [];
  for (const field of collection.fields) {
    if (currentData.hasOwnProperty(field.name)) {
      if (field.hidden && !isUserAdmin(authContext)) { validationErrors.push(`Field "${field.name}" is hidden.`); continue; }
      const res = validateAndCoerce(currentData[field.name], field); if (res.error) validationErrors.push(res.error); else { setClauses.push(`"${field.name}" = ?`); values.push(res.value); }
    }
  }
  if (validationErrors.length > 0) { return { errors: validationErrors }; }
  if (setClauses.length === 1) { return { errors: ["No valid fields for update."] }; }
  values.push(recordId);

  const query = `UPDATE "${collection.name}" SET ${setClauses.join(', ')} WHERE id = ? RETURNING *;`;
  try {
    const stmt = dbInstance.prepare(query); const updatedRecordDb = stmt.get(...values) as Record<string, any>;
    if (!updatedRecordDb) { throw new Error('Failed to retrieve record after update.'); }
    const finalRecord = prepareRecordForEvent(updatedRecordDb, collection);
    appEvents.emit('afterRecordUpdateSuccess', { record: finalRecord, oldRecord, collection, actor: authContext });
    return { record: finalRecord };
  } catch (error: any) {
    appEvents.emit('afterRecordUpdateError', { record: currentData, oldRecord, collection, actor: authContext, error });
    console.error(`Error updating record "${recordId}" in "${collection.name}":`, error); return { errors: [error.message] };
  }
}

export async function deleteRecord(
  collectionName: string, recordId: string, authContext?: AuthUser | null, db?: Database
): Promise<{ success?: boolean; errors?: string[] }> {
  const dbInstance = db || getDB();
  const collection = await collectionService.getCollectionByIdOrName(collectionName, dbInstance);
  if (!collection) { return { errors: [`Collection "${collectionName}" not found.`] }; }

  const existingRecordResult = await getRecordById(collectionName, recordId, authContext, dbInstance);
  if (existingRecordResult.errors || !existingRecordResult.record) { return { errors: existingRecordResult.errors || [`Record not found or not accessible for deletion.`] }; }
  const recordToDelete = existingRecordResult.record;

  const deletePayload: RecordDeletePayload = { record: recordToDelete, collection, actor: authContext };
  try {
    await appEvents.emitStoppable('beforeRecordDelete', deletePayload);
  } catch (eventError: any) { return { errors: [`beforeRecordDelete event hook failed: ${eventError.message}`] }; }

  if (collection.deleteRule && collection.deleteRule.trim() !== '') {
    const ruleEval = ruleService.evaluateRule(collection.deleteRule, { authRecord: authContext });
    if (ruleEval.error) { return { errors: [ruleEval.error] }; }
    if (ruleEval.allow === false || (ruleEval.condition && ruleEval.condition.sql === '1=0')) { return { errors: ['Access denied by delete rule.'] };}
  }

  const query = `DELETE FROM "${collection.name}" WHERE id = ?;`;
  try {
    const stmt = dbInstance.prepare(query); stmt.run(recordId);
    if (dbInstance.changes === 0) { throw new Error("Record not found or already deleted (or rule prevented)."); }
    appEvents.emit('afterRecordDeleteSuccess', { record: recordToDelete, collection, actor: authContext });
    return { success: true };
  } catch (error: any) {
    appEvents.emit('afterRecordDeleteError', { record: recordToDelete, collection, actor: authContext, error });
    console.error(`Error deleting record "${recordId}" from "${collection.name}":`, error); return { errors: [error.message] };
  }
}

export async function getRecordById(
  collectionName: string, recordId: string, authContext?: AuthUser | null, db?: Database
): Promise<{ record?: Record<string, any>; errors?: string[] }> {
  const dbInstance = db || getDB();
  const collection = await collectionService.getCollectionByIdOrName(collectionName, dbInstance);
  if (!collection) { return { errors: [`Collection "${collectionName}" not found.`] }; }
  let viewRuleConditionSql = ''; let viewRuleParams: any[] = [];
  if (collection.viewRule && collection.viewRule.trim() !== '') {
    const ruleEval = ruleService.evaluateRule(collection.viewRule, { authRecord: authContext });
    if (ruleEval.error) { return { errors: [ruleEval.error] }; }
    if (ruleEval.allow === false || (ruleEval.condition && ruleEval.condition.sql === '1=0')) return { errors: ['Access denied by view rule.'] };
    if (ruleEval.condition?.sql && ruleEval.condition.sql.trim() !== '' && ruleEval.condition.sql.trim() !== '1=1') { viewRuleConditionSql = ruleEval.condition.sql; viewRuleParams = ruleEval.condition.params; }
  }
  let query = `SELECT * FROM "${collection.name}" WHERE id = ?`; const queryParams: any[] = [recordId];
  if (viewRuleConditionSql) { query += ` AND (${viewRuleConditionSql})`; queryParams.push(...viewRuleParams); }
  query += `;`;
  try {
    const stmt = dbInstance.prepare(query); const recordDb = stmt.get(...queryParams) as Record<string, any>;
    if (!recordDb) return { errors: [`Record ID "${recordId}" not found or not accessible.`] };
    return { record: prepareRecordForEvent(recordDb, collection) };
  } catch (error: any) { console.error(error); return { errors: [error.message] }; }
}

export async function listRecords(
  collectionName: string, options?: { filter?: string; sort?: string; page?: number; perPage?: number },
  authContext?: AuthUser | null, db?: Database
): Promise<{ records?: Record<string, any>[]; totalItems?: number; page?: number; perPage?: number; totalPages?: number; errors?: string[] }> {
  const dbInstance = db || getDB();
  const collection = await collectionService.getCollectionByIdOrName(collectionName, dbInstance);
  if (!collection) return { errors: [`Collection "${collectionName}" not found.`] };
  let whereClauses: string[] = []; let queryParamsInternal: any[] = [];
  if (collection.listRule && collection.listRule.trim() !== '') {
    const ruleEval = ruleService.evaluateRule(collection.listRule, { authRecord: authContext });
    if (ruleEval.error) return { errors: [ruleEval.error] };
    if (ruleEval.allow === false || (ruleEval.condition?.sql === '1=0')) return { records: [], totalItems: 0, page: options?.page || 1, perPage: options?.perPage || 30, totalPages:0, errors: ['Access denied by list rule.'] };
    if (ruleEval.condition?.sql && ruleEval.condition.sql.trim() !== '' && ruleEval.condition.sql.trim() !== '1=1') { whereClauses.push(`(${ruleEval.condition.sql})`); queryParamsInternal.push(...ruleEval.condition.params); }
  }
  let queryBase = `FROM "${collection.name}"`; if (whereClauses.length > 0) queryBase += ` WHERE ${whereClauses.join(' AND ')}`;
  let query = `SELECT * ${queryBase}`; let countQuery = `SELECT COUNT(*) as total ${queryBase}`;
  const perPage = options?.perPage || 30; const page = options?.page || 1; const offset = (page - 1) * perPage;
  query += ` LIMIT ${perPage} OFFSET ${offset}`;
  try {
    const stmt = dbInstance.prepare(query); const recordsDb = stmt.all(...queryParamsInternal) as Record<string, any>[];
    const countStmt = dbInstance.prepare(countQuery); const { total } = countStmt.get(...queryParamsInternal) as { total: number };
    return { records: recordsDb.map(r => prepareRecordForEvent(r, collection)), totalItems: total, page, perPage, totalPages: Math.ceil(total / perPage) };
  } catch (error: any) { console.error(error); return { errors: [error.message] }; }
}

console.log('Record service (record.service.ts) updated with granular before/after events for CUD operations.');
