import { BaseModel } from './base-model';

export interface User extends BaseModel {
  email: string; // Assuming email is a primary identifier for auth
  passwordHash: string; // For storing hashed passwords
  name?: string;
  avatar?: string; // Path to avatar file or URL
  emailVisibility?: boolean;
  verified?: boolean;
  // Other auth related fields like verificationToken, passwordResetToken etc. will be added later
}
