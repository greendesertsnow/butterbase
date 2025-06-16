import { getDB } from './database';
import { User } from '../models/user';
import { Database } from 'bun:sqlite';

const TABLE_USERS = '_pb_users_auth_';

export async function ensureUsersTableExists(db: Database) {
  const dbInstance = db || getDB();
  try {
    const table = dbInstance.query(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(TABLE_USERS);
    if (!table) {
      console.log(`Table ${TABLE_USERS} not found, creating it...`);
      dbInstance.exec(`
        CREATE TABLE ${TABLE_USERS} (
          id TEXT PRIMARY KEY DEFAULT ('r'||lower(hex(randomblob(7)))) NOT NULL,
          created TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%fZ')) NOT NULL,
          updated TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%fZ')) NOT NULL,
          email TEXT UNIQUE NOT NULL,
          passwordHash TEXT NOT NULL,
          name TEXT NULL,
          avatar TEXT NULL,
          verified BOOLEAN DEFAULT FALSE NOT NULL,
          emailVisibility BOOLEAN DEFAULT FALSE NOT NULL,
          verificationToken TEXT NULL,
          lastVerificationSentAt TEXT NULL,
          passwordResetToken TEXT NULL,
          lastResetSentAt TEXT NULL
        );
      `);
      dbInstance.exec(`CREATE INDEX IF NOT EXISTS idx_users_email ON ${TABLE_USERS} (email);`);
      dbInstance.exec(`CREATE INDEX IF NOT EXISTS idx_users_verification_token ON ${TABLE_USERS} (verificationToken);`);
      dbInstance.exec(`CREATE INDEX IF NOT EXISTS idx_users_password_reset_token ON ${TABLE_USERS} (passwordResetToken);`);
      console.log(`Table ${TABLE_USERS} created.`);
    }
  } catch (error) {
    console.error(`Error ensuring table ${TABLE_USERS} exists:`, error);
  }
}

export async function createUserInTable(db: Database, userData: Omit<User, 'id' | 'created' | 'updated'>): Promise<User | null> {
  const dbInstance = db || getDB();
  await ensureUsersTableExists(dbInstance);
  const id = 'r' + Math.random().toString(36).substring(2, 9) + Math.random().toString(36).substring(2, 9);
  const now = new Date().toISOString();
  const { email, passwordHash, name, avatar, verified = false, emailVisibility = false } = userData;
  try {
    const query = dbInstance.query(
      `INSERT INTO ${TABLE_USERS} (id, created, updated, email, passwordHash, name, avatar, verified, emailVisibility)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    );
    const result = query.get(id, now, now, email, passwordHash, name || null, avatar || null, verified, emailVisibility) as User;
    return result;
  } catch (error) {
    console.error('Error creating user in table:', error);
    if (error.message.includes('UNIQUE constraint failed')) {
      console.error('User with this email already exists.');
    }
    return null;
  }
}

export async function getUserByEmail(db: Database, email: string): Promise<User | null> {
  const dbInstance = db || getDB();
  await ensureUsersTableExists(dbInstance);
  try {
    const query = dbInstance.query(`SELECT * FROM ${TABLE_USERS} WHERE email = ?`);
    return query.get(email) as User | null;
  } catch (error) {
    console.error('Error getting user by email:', error);
    return null;
  }
}

export async function getUserById(db: Database, id: string): Promise<User | null> {
  const dbInstance = db || getDB();
  await ensureUsersTableExists(dbInstance);
  try {
    const query = dbInstance.query(`SELECT * FROM ${TABLE_USERS} WHERE id = ?`);
    return query.get(id) as User | null;
  } catch (error) {
    console.error('Error getting user by id:', error);
    return null;
  }
}

export async function getUserByVerificationToken(db: Database, token: string): Promise<User | null> {
  const dbInstance = db || getDB();
  try {
    const query = dbInstance.query(`SELECT * FROM ${TABLE_USERS} WHERE verificationToken = ?`);
    return query.get(token) as User | null;
  } catch (error) {
    console.error('Error getting user by verification token:', error);
    return null;
  }
}

export async function getUserByPasswordResetToken(db: Database, token: string): Promise<User | null> {
  const dbInstance = db || getDB();
  try {
    const query = dbInstance.query(`SELECT * FROM ${TABLE_USERS} WHERE passwordResetToken = ?`);
    return query.get(token) as User | null;
  } catch (error) {
    console.error('Error getting user by password reset token:', error);
    return null;
  }
}

export async function updateUserVerificationStatus(db: Database, userId: string, verified: boolean, token: string | null = null): Promise<User | null> {
  const dbInstance = db || getDB();
  const now = new Date().toISOString();
  try {
    const query = dbInstance.query(
      `UPDATE ${TABLE_USERS}
       SET verified = ?, verificationToken = ?, updated = ?
       WHERE id = ? RETURNING *`
    );
    return query.get(verified, token, now, userId) as User | null;
  } catch (error) {
    console.error('Error updating user verification status:', error);
    return null;
  }
}

export async function updateUserPassword(db: Database, userId: string, passwordHash: string, token: string | null = null): Promise<User | null> {
  const dbInstance = db || getDB();
  const now = new Date().toISOString();
  try {
    const query = dbInstance.query(
      `UPDATE ${TABLE_USERS}
       SET passwordHash = ?, passwordResetToken = ?, updated = ?
       WHERE id = ? RETURNING *`
    );
    return query.get(passwordHash, token, now, userId) as User | null;
  } catch (error) {
    console.error('Error updating user password:', error);
    return null;
  }
}

export async function setUserVerificationToken(db: Database, userId: string, token: string): Promise<User | null> {
  const dbInstance = db || getDB();
  const now = new Date().toISOString();
  try {
    const query = dbInstance.query(
      `UPDATE ${TABLE_USERS}
       SET verificationToken = ?, lastVerificationSentAt = ?, updated = ?
       WHERE id = ? RETURNING *`
    );
    return query.get(token, now, now, userId) as User | null;
  } catch (error) {
    console.error('Error setting user verification token:', error);
    return null;
  }
}

export async function setPasswordResetToken(db: Database, userId: string, token: string): Promise<User | null> {
  const dbInstance = db || getDB();
  const now = new Date().toISOString();
  try {
    const query = dbInstance.query(
      `UPDATE ${TABLE_USERS}
       SET passwordResetToken = ?, lastResetSentAt = ?, updated = ?
       WHERE id = ? RETURNING *`
    );
    return query.get(token, now, now, userId) as User | null;
  } catch (error) {
    console.error('Error setting password reset token:', error);
    return null;
  }
}

console.log('User service (user.service.ts) updated with token management functions.');
