import { BaseModel } from './base-model';

export interface Superuser extends BaseModel {
  email: string;
  // Password will be handled by auth logic, not stored directly here beyond what the auth system needs
}
