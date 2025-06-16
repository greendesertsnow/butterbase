import { BaseModel } from './base-model';

export interface Param extends BaseModel {
  value: any; // JSON in SQLite
}
