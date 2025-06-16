import { getDB } from './database';
import { User } from '../models/user';
import { AuthUser } from '../routes/auth';
import * as authServiceForUser from './auth.service'; // Renamed to avoid conflict if authService is also a class/var
import { isUserAdmin } from '../utils/auth.utils';
import { appEvents, UserCreatePayload, UserUpdatePayload, UserDeletePayload, UserOperationSuccessPayload, UserOperationErrorPayload } from './event.service';
import { Database } from 'bun:sqlite';

const TABLE_USERS = '_pb_users_auth_';

export async function ensureUsersTableExists(db?: Database) {
  const dbInstance = db || getDB(); try { const table = dbInstance.query(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(TABLE_USERS); if (!table) { console.log(`Table ${TABLE_USERS} creating...`); dbInstance.exec(`CREATE TABLE ${TABLE_USERS} (id TEXT PRIMARY KEY, created TEXT, updated TEXT, email TEXT UNIQUE, passwordHash TEXT, name TEXT, avatar TEXT, verified BOOLEAN, emailVisibility BOOLEAN, verificationToken TEXT, lastVerificationSentAt TEXT, passwordResetToken TEXT, lastResetSentAt TEXT);`); console.log(`Table ${TABLE_USERS} created.`); } } catch (e:any) { console.error(e.message); throw e; }
}
ensureUsersTableExists().catch(console.error);

export async function getUserByEmail(dbOrUndef: Database | undefined, email: string): Promise<User | null> { const db = dbOrUndef || getDB(); return db.query<User, [string]>(`SELECT * FROM ${TABLE_USERS} WHERE email = ?`).get(email); }
export async function getUserById(dbOrUndef: Database | undefined, id: string): Promise<User | null> { const db = dbOrUndef || getDB(); return db.query<User, [string]>(`SELECT * FROM ${TABLE_USERS} WHERE id = ?`).get(id); }

export async function getUserByVerificationToken(db: Database, token: string): Promise<User | null> { /* Stubbed */ return null;}
export async function getUserByPasswordResetToken(db: Database, token: string): Promise<User | null> { /* Stubbed */ return null;}
export async function updateUserVerificationStatus(db: Database, userId: string, verified: boolean, token?: string | null): Promise<User | null> { /* Stubbed */ return null;}
export async function updateUserPassword(db: Database, userId: string, passwordHash: string, token?: string | null): Promise<User | null> { /* Stubbed */ return null;}
export async function setUserVerificationToken(db: Database, userId: string, token: string): Promise<User | null> { /* Stubbed */ return null;}
export async function setPasswordResetToken(db: Database, userId: string, token: string): Promise<User | null> { /* Stubbed */ return null;}


export async function createUserInTable( // Called by auth.service during registration
    dbOrUndef: Database | undefined,
    userData: Omit<User, 'id' | 'created' | 'updated'>,
    actorContext?: AuthUser | null
): Promise<User | null> {
  const dbInstance = dbOrUndef || getDB();
  const id = 'r' + Math.random().toString(36).substring(2,9)+Math.random().toString(36).substring(2,9); const now = new Date().toISOString();

  const userObjectToCreate = {
      ...userData, id, created: now, updated: now,
      verified: userData.verified || false,
      emailVisibility: userData.emailVisibility || false,
      verificationToken: null, lastVerificationSentAt: null,
      passwordResetToken: null, lastResetSentAt: null
  } as User;

  const createPayload: UserCreatePayload = { user: userObjectToCreate, actor: actorContext };
  try {
    await appEvents.emitStoppable('beforeUserCreate', createPayload);
  } catch (eventError: any) { console.error(`beforeUserCreate failed: ${eventError.message}`); return null; }

  const finalUserData = createPayload.user as User; // Use potentially modified data

  try {
    const query = dbInstance.query<User, any[]>(
      `INSERT INTO ${TABLE_USERS} (id, created, updated, email, passwordHash, name, avatar, verified, emailVisibility, verificationToken, lastVerificationSentAt, passwordResetToken, lastResetSentAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    );
    const result = query.get(
        finalUserData.id, finalUserData.created, finalUserData.updated, finalUserData.email, finalUserData.passwordHash,
        finalUserData.name || null, finalUserData.avatar || null, finalUserData.verified ? 1:0, finalUserData.emailVisibility ? 1:0,
        finalUserData.verificationToken, finalUserData.lastVerificationSentAt, finalUserData.passwordResetToken, finalUserData.lastResetSentAt
    );
    if (result) {
        const eventUser = {...result, verified: Boolean(result.verified), emailVisibility: Boolean(result.emailVisibility) };
        appEvents.emit('afterUserCreateSuccess', { user: eventUser, actor: actorContext });
    }
    return result;
  } catch (error: any) {
    appEvents.emit('afterUserCreateError', { user: finalUserData, actor: actorContext, error });
    console.error('Error creating user in table:', error); return null;
  }
}

export interface UpdateUserOptions {
  email?: string; password?: string; passwordConfirm?: string; oldPassword?: string;
  name?: string; avatar?: string; verified?: boolean;
}

export async function updateUser(
  userIdToUpdate: string, data: UpdateUserOptions, authContext: AuthUser | null, db?: Database
): Promise<{ user?: Omit<User, 'passwordHash'>; errors?: string[] }> {
  const dbInstance = db || getDB();
  const errors: string[] = [];
  const userToUpdate = await getUserById(dbInstance, userIdToUpdate);
  if (!userToUpdate) { return { errors: ['User to update not found.'] }; }

  const oldUserSnapshot = JSON.parse(JSON.stringify(userToUpdate)) as User;
  const updatePayload: UserUpdatePayload = { user: data, oldUser: oldUserSnapshot, actor: authContext };
  try {
    await appEvents.emitStoppable('beforeUserUpdate', updatePayload);
  } catch (eventError: any) { return { errors: [`beforeUserUpdate failed: ${eventError.message}`] }; }

  const currentData = updatePayload.user as UpdateUserOptions;
  const isSelfUpdate = authContext?.userId === userIdToUpdate; const hasManageAccess = isUserAdmin(authContext);
  const setClauses: string[] = []; const values: any[] = [];

  if (currentData.email && currentData.email !== userToUpdate.email) { if (!isSelfUpdate && !hasManageAccess) errors.push('Permission denied to change email.'); else { const exist = await getUserByEmail(dbInstance, currentData.email); if (exist && exist.id !== userIdToUpdate) errors.push('Email already in use.'); else { setClauses.push('email = ?'); values.push(currentData.email); if (userToUpdate.verified) { setClauses.push('verified = ?'); values.push(0); console.log(`User email changed for ${userIdToUpdate}. Verification reset. TODO: Send new verification email.`); }}}}
  if (currentData.verified !== undefined && currentData.verified !== userToUpdate.verified) { if (!hasManageAccess) errors.push('Permission denied to change verified status.'); else {setClauses.push('verified = ?'); values.push(currentData.verified?1:0); if(currentData.verified){setClauses.push('verificationToken = NULL'); setClauses.push('lastVerificationSentAt = NULL');}}}
  if (currentData.password) { if (!currentData.passwordConfirm || currentData.password !== currentData.passwordConfirm) errors.push('Passwords do not match.'); else if (currentData.password.length < 8) errors.push('Password too short.'); else { let proceedWithPasswordChange = false; if (isSelfUpdate && !hasManageAccess) { if (!currentData.oldPassword || !(await authServiceForUser.verifyPassword(currentData.oldPassword, userToUpdate.passwordHash))) { errors.push('Invalid old password.'); } else { proceedWithPasswordChange = true; } } else if (hasManageAccess) { proceedWithPasswordChange = true; } if (proceedWithPasswordChange && !errors.some(e=>e.includes("old password"))) { const hash = await authServiceForUser.hashPassword(currentData.password); setClauses.push('passwordHash = ?'); values.push(hash); setClauses.push('passwordResetToken = NULL', 'lastResetSentAt = NULL');}}}
  if (currentData.name !== undefined && currentData.name !== userToUpdate.name) { if (!isSelfUpdate && !hasManageAccess) errors.push('Permission denied to change name.'); else {setClauses.push('name = ?'); values.push(currentData.name);}}
  if (currentData.avatar !== undefined && currentData.avatar !== userToUpdate.avatar) { if (!isSelfUpdate && !hasManageAccess) errors.push('Permission denied to change avatar.'); else {setClauses.push('avatar = ?'); values.push(currentData.avatar);}}

  if (errors.length > 0) { return { errors }; }
  if (setClauses.length === 0) { const { passwordHash, ...safeUserNC } = userToUpdate; return { user: safeUserNC as Omit<User, 'passwordHash'>, errors: ['No changes.'] }; }
  setClauses.push('updated = ?'); values.push(new Date().toISOString()); values.push(userIdToUpdate);
  const query = `UPDATE ${TABLE_USERS} SET ${setClauses.join(', ')} WHERE id = ? RETURNING *`;
  try {
    const stmt = dbInstance.prepare(query); const updatedDbUser = stmt.get(...values) as User;
    const { passwordHash, ...safeUser } = updatedDbUser;

    const eventUser = { ...safeUser, verified: Boolean(updatedDbUser.verified), emailVisibility: Boolean(updatedDbUser.emailVisibility) } as User;
    const eventOldUser = { ...oldUserSnapshot, verified: Boolean(oldUserSnapshot.verified), emailVisibility: Boolean(oldUserSnapshot.emailVisibility) } as User;

    appEvents.emit('afterUserUpdateSuccess', { user: eventUser, oldUser: eventOldUser, actor: authContext });
    return { user: safeUser as Omit<User, 'passwordHash'> };
  } catch (error: any) {
    appEvents.emit('afterUserUpdateError', { user: currentData, oldUser: oldUserSnapshot, actor: authContext, error });
    console.error(`Error updating user ${userIdToUpdate}:`, error); return { errors: [error.message] };
  }
}

export async function deleteUser(userIdToDelete: string, authContext: AuthUser | null, db?: Database): Promise<{ success?: boolean; errors?: string[] }> {
    const dbInstance = db || getDB();
    const userToDelete = await getUserById(dbInstance, userIdToDelete);
    if (!userToDelete) { return { errors: ["User not found."] }; }

    const deletePayload: UserDeletePayload = { user: JSON.parse(JSON.stringify(userToDelete)), actor: authContext };
    try {
        await appEvents.emitStoppable('beforeUserDelete', deletePayload);
    } catch (eventError: any) { return { errors: [`beforeUserDelete hook failed: ${eventError.message}`] }; }

    // TODO: Add actual permission check: if (authContext?.userId !== userIdToDelete && !isUserAdmin(authContext)) return { errors: ["Permission denied."]}

    try {
        const stmt = dbInstance.prepare(`DELETE FROM ${TABLE_USERS} WHERE id = ?`); stmt.run(userIdToDelete);
        if (dbInstance.changes === 0) { throw new Error("User not found or already deleted."); }

        const eventUser = {...userToDelete, verified: Boolean(userToDelete.verified), emailVisibility: Boolean(userToDelete.emailVisibility) };
        appEvents.emit('afterUserDeleteSuccess', { user: eventUser, actor: authContext });
        return { success: true };
    } catch (error: any) {
        const eventUser = {...userToDelete, verified: Boolean(userToDelete.verified), emailVisibility: Boolean(userToDelete.emailVisibility) };
        appEvents.emit('afterUserDeleteError', { user: eventUser, actor: authContext, error });
        console.error(`Error deleting user ${userIdToDelete}:`, error); return { errors: [error.message] };
    }
}
console.log('User service (user.service.ts) updated with granular before/after events for CUD operations.');
