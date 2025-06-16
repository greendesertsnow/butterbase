import { Database } from 'bun:sqlite';
import { getDB } from './database';
import { User } from '../models/user';
import * as userService from './user.service';
import * as jose from 'jose';
import * as emailService from './email.service';
import { randomUUID } from 'crypto'; // For generating unique tokens

// --- JWT Configuration ---
const JWT_SECRET_KEY = process.env.JWT_SECRET || 'your-super-secret-key-for-hmac';
const JWT_EXPIRATION_TIME = process.env.JWT_EXPIRATION_TIME || '1d';
const secret = new TextEncoder().encode(JWT_SECRET_KEY);

// --- Token Expiration Configuration ---
const TOKEN_EXPIRATION_HOURS = 24; // For verification and password reset tokens

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

export interface RegisterUserOptions {
  email: string;
  password: string;
  name?: string;
  avatar?: string;
}

export async function registerUser(options: RegisterUserOptions): Promise<Omit<User, 'passwordHash'> | null> {
  const dbInstance = getDB();
  const { email, password, name, avatar } = options;

  const existingUser = await userService.getUserByEmail(dbInstance, email);
  if (existingUser) {
    throw new Error('User with this email already exists.');
  }

  const passwordHash = await hashPassword(password);
  const newUser = await userService.createUserInTable(dbInstance, {
    email,
    passwordHash,
    name,
    avatar,
    verified: false,
    emailVisibility: false,
  });

  if (!newUser) {
    throw new Error('Failed to create user record.');
  }

  // Request email verification after registration
  await requestEmailVerification(email); // Fire and forget for now, or handle return

  const { passwordHash: _, ...userWithoutPassword } = newUser;
  return userWithoutPassword as Omit<User, 'passwordHash'>;
}

export interface LoginUserOptions {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: Omit<User, 'passwordHash'>;
  token: string;
}

export async function loginUser(options: LoginUserOptions): Promise<LoginResponse | null> {
  const dbInstance = getDB();
  const { email, password } = options;

  const user = await userService.getUserByEmail(dbInstance, email);
  if (!user || !user.passwordHash) {
    return null;
  }
  if (!user.verified) {
    // Optionally, prevent login if email is not verified
    // throw new Error('Email not verified. Please verify your email first.');
    console.warn(`Login attempt for unverified email: ${email}`);
  }

  const isPasswordValid = await verifyPassword(password, user.passwordHash);
  if (!isPasswordValid) {
    return null;
  }

  const token = await generateToken({ userId: user.id, email: user.email });
  const { passwordHash: _, ...userWithoutPassword } = user;
  return { user: userWithoutPassword as Omit<User, 'passwordHash'>, token };
}

interface TokenPayload extends jose.JWTPayload {
  userId: string;
  email: string;
}

export async function generateToken(payload: TokenPayload): Promise<string> {
  return await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRATION_TIME)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jose.jwtVerify<TokenPayload>(token, secret);
    return payload;
  } catch (error) {
    console.error('JWT Verification Error:', error.message);
    return null;
  }
}

// --- Email Verification ---
export async function requestEmailVerification(email: string): Promise<{ verificationToken: string } | null> {
  const dbInstance = getDB();
  const user = await userService.getUserByEmail(dbInstance, email);

  if (!user) {
    console.error(`RequestEmailVerification: User not found for email: ${email}`);
    return null; // Or throw an error
  }
  if (user.verified) {
    console.log(`RequestEmailVerification: User ${email} is already verified.`);
    return null; // Or throw an error indicating already verified
  }

  const verificationToken = randomUUID();
  const updatedUser = await userService.setUserVerificationToken(dbInstance, user.id, verificationToken);

  if (!updatedUser) {
    throw new Error('Failed to set verification token for user.');
  }

  console.log(`Verification token generated for ${email}: ${verificationToken}`);
  // Send verification email
  if (user) {
    emailService.sendVerificationEmail(user.email, user.name, verificationToken).catch(console.error);
  }
  // In a real app, an EmailService would now send an email with this token.
  return { verificationToken };
}

export async function confirmEmailVerification(token: string): Promise<boolean> {
  const dbInstance = getDB();
  const user = await userService.getUserByVerificationToken(dbInstance, token);

  if (!user || !user.lastVerificationSentAt) {
    console.error(`ConfirmEmailVerification: Invalid or expired token: ${token}`);
    return false;
  }

  // Check token expiry
  const tokenSentAt = new Date(user.lastVerificationSentAt);
  const expiryDate = new Date(tokenSentAt.getTime() + TOKEN_EXPIRATION_HOURS * 60 * 60 * 1000);
  if (new Date() > expiryDate) {
    console.error(`ConfirmEmailVerification: Token expired for user ${user.email}`);
    // Optionally clear the expired token here
    await userService.setUserVerificationToken(dbInstance, user.id, null); // Clear token
    return false;
  }

  const updatedUser = await userService.updateUserVerificationStatus(dbInstance, user.id, true, null); // Mark verified, clear token
  return !!updatedUser;
}

// --- Password Reset ---
export async function requestPasswordReset(email: string): Promise<{ resetToken: string } | null> {
  const dbInstance = getDB();
  const user = await userService.getUserByEmail(dbInstance, email);

  if (!user) {
    console.error(`RequestPasswordReset: User not found for email: ${email}`);
    return null;
  }

  const resetToken = randomUUID();
  const updatedUser = await userService.setPasswordResetToken(dbInstance, user.id, resetToken);

  if (!updatedUser) {
    throw new Error('Failed to set password reset token for user.');
  }

  console.log(`Password reset token generated for ${email}: ${resetToken}`);
  // Send password reset email
  if (user) {
    emailService.sendPasswordResetEmail(user.email, user.name, resetToken, TOKEN_EXPIRATION_HOURS).catch(console.error);
  }
  // EmailService would send an email with this token.
  return { resetToken };
}

export async function confirmPasswordReset(token: string, newPassword: string): Promise<boolean> {
  const dbInstance = getDB();
  if (!newPassword || newPassword.length < 8) { // Basic password policy
     throw new Error('Password must be at least 8 characters long.');
  }
  const user = await userService.getUserByPasswordResetToken(dbInstance, token);

  if (!user || !user.lastResetSentAt) {
    console.error(`ConfirmPasswordReset: Invalid or expired token: ${token}`);
    return false;
  }

  const tokenSentAt = new Date(user.lastResetSentAt);
  const expiryDate = new Date(tokenSentAt.getTime() + TOKEN_EXPIRATION_HOURS * 60 * 60 * 1000);
  if (new Date() > expiryDate) {
    console.error(`ConfirmPasswordReset: Token expired for user ${user.email}`);
    await userService.setPasswordResetToken(dbInstance, user.id, null); // Clear expired token
    return false;
  }

  const newPasswordHash = await hashPassword(newPassword);
  const updatedUser = await userService.updateUserPassword(dbInstance, user.id, newPasswordHash, null); // Update password, clear token
  return !!updatedUser;
}

console.log('Auth service (auth.service.ts) updated with email verification and password reset flows.');
