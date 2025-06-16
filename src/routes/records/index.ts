import { Elysia, t } from 'elysia';
import * as recordService from '../../services/record.service';
import * as authService from '../../services/auth.service';
import { type AuthUser } from '../auth';

export const recordsRoutes = (app: Elysia) => {
  // Path: /api/collections/:collectionName/records
  app.group('/collections/:collectionName/records', (group) => group
    .derive(async (context) => {
      const authHeader = context.headers['authorization'];
      let user: AuthUser | null = null;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const payload = await authService.verifyToken(token);
        if (payload) user = { userId: payload.userId, email: payload.email };
      }
      return { user };
    })
    .onBeforeHandle(async ({ user, params, set }) => {
      if (!user) {
        set.status = 401;
        return { message: 'Unauthorized: Missing or invalid token' };
      }
      // TODO: Add actual rule engine checks here based on params.collectionName and user
      console.log(`User ${user.email} accessing records for collection "${params.collectionName}"`);
    })
    .post('/', async ({ params, body, set }) => {
      const { record, errors } = await recordService.createRecord(params.collectionName, body as Record<string, any>, user);
      if (errors) {
        set.status = 400;
        return { message: 'Failed to create record', errors };
      }
      set.status = 201;
      return record;
    }, {
      params: t.Object({ collectionName: t.String() }),
      body: t.Object({}, { additionalProperties: true }), // Allows any fields
      detail: { summary: 'Create a new record in a collection' }
    })
    .get('/', async ({ params, query, set }) => {
      // Basic pagination from query params
      const page = query.page ? parseInt(query.page as string, 10) : 1;
      const perPage = query.perPage ? parseInt(query.perPage as string, 10) : 30;

      const { records, total, errors, page: resPage, perPage: resPerPage, totalPages } = await recordService.listRecords(params.collectionName, { page, perPage }, user);
      if (errors) {
        set.status = 400; // Or 404 if collection not found
        return { message: 'Failed to list records', errors };
      }
      return {
        page: resPage,
        perPage: resPerPage,
        totalItems: total,
        totalPages,
        items: records
      };
    }, {
      params: t.Object({ collectionName: t.String() }),
      query: t.Object({
          page: t.Optional(t.Numeric({ minimum: 1 })),
          perPage: t.Optional(t.Numeric({ minimum: 1, maximum: 100 }))
          // TODO: filter: t.Optional(t.String()), sort: t.Optional(t.String())
      }),
      detail: { summary: 'List records from a collection' }
    })
    .get('/:recordId', async ({ params, set }) => {
      const { record, errors } = await recordService.getRecordById(params.collectionName, params.recordId, user);
      if (errors) {
        set.status = 404; // Typically 404 if record or collection not found
        return { message: 'Failed to get record', errors };
      }
      return record;
    }, {
      params: t.Object({ collectionName: t.String(), recordId: t.String() }),
      detail: { summary: 'Get a specific record by ID' }
    })
    .patch('/:recordId', async ({ params, body, set }) => {
      const { record, errors } = await recordService.updateRecord(params.collectionName, params.recordId, body as Record<string, any>, user);
      if (errors) {
        set.status = errors.includes('not found') ? 404 : 400;
        return { message: 'Failed to update record', errors };
      }
      return record;
    }, {
      params: t.Object({ collectionName: t.String(), recordId: t.String() }),
      body: t.Object({}, { additionalProperties: true }),
      detail: { summary: 'Update an existing record by ID' }
    })
    .delete('/:recordId', async ({ params, set }) => {
      const { success, errors } = await recordService.deleteRecord(params.collectionName, params.recordId, user);
      if (errors || !success) {
        set.status = 404; // Or 400
        return { message: 'Failed to delete record', errors };
      }
      set.status = 204; // No Content
      return;
    }, {
      params: t.Object({ collectionName: t.String(), recordId: t.String() }),
      detail: { summary: 'Delete a record by ID' }
    })
  );
  return app;
};

console.log('Record routes (src/routes/records/index.ts) for dynamic collections created.');
