import { Elysia, t, type Static } from 'elysia';
import * as collectionService from '../../services/collection.service';
import * as authService from '../../services/auth.service';
import { type AuthUser } from '../auth'; // Assuming AuthUser type
import { CollectionSchema } from '../../models/collection'; // Import the full schema for validation

// Define a stricter schema for creation, omitting generated fields
const CreateCollectionSchema = t.Omit(CollectionSchema, ['id', 'created', 'updated', 'system']);
const UpdateCollectionSchema = t.Partial(t.Omit(CollectionSchema, ['id', 'created', 'updated', 'system']));


export const collectionsSchemaRoutes = (app: Elysia) => {
  // Route group for managing collection schemas, e.g., /api/admin/collections
  app.group('/collections-schema', (group) => group
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
    .onBeforeHandle(async ({ user, set }) => {
      if (!user) {
        set.status = 401;
        return { message: 'Unauthorized: Missing or invalid token' };
      }
      // Placeholder for actual admin/superuser role check
      // e.g. if (!user.roles || !user.roles.includes('admin')) { ... }
      console.log(`User ${user.email} is attempting to access collections schema API.`);
    })
    .post('/', async ({ body, set }) => {
      const { collection, errors } = await collectionService.createCollection(body as Static<typeof CreateCollectionSchema>);
      if (errors.length > 0) {
        set.status = 400;
        return { message: 'Failed to create collection', errors };
      }
      set.status = 201; // Created
      return collection;
    }, {
      body: CreateCollectionSchema,
      detail: { summary: 'Create a new collection schema' }
    })
    .get('/', async () => {
      return await collectionService.getAllCollections();
    }, {
      detail: { summary: 'List all collection schemas' }
    })
    .get('/:idOrName', async ({ params, set }) => {
      const collection = await collectionService.getCollectionByIdOrName(params.idOrName);
      if (!collection) {
        set.status = 404;
        return { message: 'Collection schema not found' };
      }
      return collection;
    }, {
      params: t.Object({ idOrName: t.String() }),
      detail: { summary: 'Get a specific collection schema by ID or name' }
    })
    .patch('/:idOrName', async ({ params, body, set }) => {
      const { collection, errors } = await collectionService.updateCollection(params.idOrName, body as Static<typeof UpdateCollectionSchema>);
      if (errors.length > 0) {
        set.status = errors.includes('Collection not found') ? 404 : 400;
        return { message: 'Failed to update collection', errors };
      }
      return collection;
    }, {
      params: t.Object({ idOrName: t.String() }),
      body: UpdateCollectionSchema,
      detail: { summary: 'Update an existing collection schema' }
    })
    .delete('/:idOrName', async ({ params, set }) => {
      const { success, errors } = await collectionService.deleteCollection(params.idOrName);
      if (!success) {
        set.status = errors.includes('Collection not found') ? 404 : 400;
        return { message: 'Failed to delete collection', errors };
      }
      set.status = 204; // No Content
      return;
    }, {
      params: t.Object({ idOrName: t.String() }),
      detail: { summary: 'Delete a collection schema' }
    })
  );
  return app;
};

console.log('Collections schema routes (src/routes/collections/index.ts) created.');
