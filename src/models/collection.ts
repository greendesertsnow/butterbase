import { BaseModel } from './base-model';

export type FieldSchema = {
  id: string;
  name: string;
  type: string; // e.g., 'text', 'number', 'bool', 'email', 'url', 'date', 'select', 'relation', 'file', 'json'
  system: boolean;
  required: boolean;
  options: any; // Field-specific options
  hidden?: boolean; // Added for hidden field logic
};

export interface Collection extends BaseModel {
  system: boolean;
  type: 'base' | 'auth';
  name: string;
  fields: FieldSchema[]; // Stored as JSON in DB
  indexes?: string[];    // Stored as JSON in DB, simplified for now
  listRule?: string | null;
  viewRule?: string | null;
  createRule?: string | null;
  updateRule?: string | null;
  deleteRule?: string | null;
  options?: any; // Stored as JSON in DB
}

// --- Elysia TypeBox Schema for Collection ---
import { t } from 'elysia';

export const FieldSchemaValidation = t.Object({
  id: t.String(), // Should be auto-generated usually
  name: t.RegExp(/^[a-zA-Z0-9_]+$/, { error: "Field name must be alphanumeric/underscore"}),
  type: t.String(), // TODO: t.Union for specific field types
  system: t.Boolean(),
  required: t.Boolean(),
  options: t.Any(), // Field-specific options, t.Record(t.String(), t.Any())
  hidden: t.Optional(t.Boolean({default: false})) // Added for hidden field logic
});

export const CollectionSchema = t.Object({
  id: t.String({ pattern: '^r[a-z0-9]{14}$', default: () => 'r' + Math.random().toString(36).substring(2,9) + Math.random().toString(36).substring(2,9) }),
  system: t.Boolean({default: false}),
  type: t.Union([t.Literal('base'), t.Literal('auth')], {default: 'base'}),
  name: t.RegExp(/^[a-zA-Z0-9_]+$/, { error: "Collection name must be alphanumeric/underscore"}),
  fields: t.Array(FieldSchemaValidation, { minItems: 1, error: "Collection must have at least one field"}),
  indexes: t.Optional(t.Array(t.String())), // Simplified for now
  listRule: t.Nullable(t.String()),
  viewRule: t.Nullable(t.String()),
  createRule: t.Nullable(t.String()),
  updateRule: t.Nullable(t.String()),
  deleteRule: t.Nullable(t.String()),
  options: t.Optional(t.Object({}, { additionalProperties: true })), // JSON object
  created: t.String({ format: 'date-time', default: () => new Date().toISOString() }),
  updated: t.String({ format: 'date-time', default: () => new Date().toISOString() })
});
