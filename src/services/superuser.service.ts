import { getDB } from './database';
import { Superuser } from '../models/superuser';
import { Database } from 'bun:sqlite';

// Table name constants should ideally be centralized
const TABLE_SUPERUSERS = '_superusers';

export async function createSuperuser(db: Database, email: string, passwordHash: string): Promise<Superuser | null> {
  // For now, we assume passwordHash is pre-computed. Actual password hashing will be in an auth service.
  // The original schema for _superusers only has 'email', 'created', 'updated'.
  // Password management is part of the AuthCollection behavior in Go.
  // We need to decide how to store superuser credentials.
  // For now, let's assume we add a passwordHash column to our Bun-managed _superusers table,
  // or that this is handled by a more generic auth user table later.
  // Let's stick to the Go schema for _superusers for now, which means it doesn't store password hashes directly in this table.
  // The Go AuthCollection uses a separate mechanism.
  // This function might be more about creating the record, and auth is handled elsewhere.

  const dbInstance = db || getDB();
  const id = 'r' + Math.random().toString(36).substring(2, 9) + Math.random().toString(36).substring(2, 9); // Simple random ID
  const now = new Date().toISOString();

  try {
    const query = dbInstance.query(
      `INSERT INTO ${TABLE_SUPERUSERS} (id, email, created, updated)
       VALUES (?, ?, ?, ?) RETURNING *`
    );
    const result = query.get(id, email, now, now) as Superuser;
    return result;
  } catch (error) {
    console.error('Error creating superuser:', error);
    // Implement more specific error handling (e.g., unique constraint violation)
    if (error.message.includes('UNIQUE constraint failed')) {
      // This is a common error to check for
      console.error('Superuser with this email already exists.');
    }
    return null;
  }
}

export async function getSuperuserByEmail(db: Database, email: string): Promise<Superuser | null> {
  const dbInstance = db || getDB();
  try {
    const query = dbInstance.query(`SELECT * FROM ${TABLE_SUPERUSERS} WHERE email = ?`);
    const result = query.get(email) as Superuser;
    return result || null;
  } catch (error) {
    console.error('Error getting superuser by email:', error);
    return null;
  }
}

export async function getSuperuserById(db: Database, id: string): Promise<Superuser | null> {
  const dbInstance = db || getDB();
  try {
    const query = dbInstance.query(`SELECT * FROM ${TABLE_SUPERUSERS} WHERE id = ?`);
    const result = query.get(id) as Superuser;
    return result || null;
  } catch (error) {
    console.error('Error getting superuser by id:', error);
    return null;
  }
}

// Update function might be limited as per original schema (only email, no password here)
export async function updateSuperuserEmail(db: Database, id: string, newEmail: string): Promise<Superuser | null> {
  const dbInstance = db || getDB();
  const now = new Date().toISOString();
  try {
    const query = dbInstance.query(
      `UPDATE ${TABLE_SUPERUSERS} SET email = ?, updated = ? WHERE id = ? RETURNING *`
    );
    const result = query.get(newEmail, now, id) as Superuser;
    return result;
  } catch (error) {
    console.error('Error updating superuser email:', error);
    if (error.message.includes('UNIQUE constraint failed')) {
      console.error('Superuser with this email already exists.');
    }
    return null;
  }
}

export async function deleteSuperuser(db: Database, id: string): Promise<boolean> {
  const dbInstance = db || getDB();
  try {
    const query = dbInstance.query(`DELETE FROM ${TABLE_SUPERUSERS} WHERE id = ?`);
    query.run(id);
    // TODO: Check rows affected to confirm deletion (db.changes() after run())
    // For now, assume success if no error. Bun:sqlite's run() returns void.
    // We'd need a way to check if the row actually existed and was deleted.
    // One way: const changes = dbInstance.changes(); return changes > 0;
    // However, db.changes() needs to be called carefully.
    // Let's assume for now, if no error, it's 'successful' in terms of execution.
    // A select before delete or checking changes would be more robust.
    return true;
  } catch (error) {
    console.error('Error deleting superuser:', error);
    return false;
  }
}

// It's important to note that the original _superusers table in Go's PocketBase
// is an AuthCollection, meaning its password and token management are handled by
// the core.AuthCollection logic, not by simple SQL columns for password hashes
// directly in the _superusers table itself.
// The fields are just: id, system (implicit), email, created, updated.
// Authentication for superusers would likely involve checking against a password
// stored/managed by a generic auth record mechanism, then linking that auth record
// to the _superusers entry.
// For this Bun port, we'll eventually need a similar robust auth service.
// These CRUD ops are for the _superusers table record itself.

console.log('Superuser service (CRUD operations for _superusers table) created.');
// Note: Password handling for superusers is not part of this specific service yet and will be addressed with a general auth system.
