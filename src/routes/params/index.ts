import { Elysia, t } from 'elysia';
import * as paramService from '../../services/param.service';
import * as authService from '../../services/auth.service';
import { type AuthUser } from '../auth'; // Assuming AuthUser type is exported from auth/index.ts

export const paramsRoutes = (app: Elysia) => {
  app.group('/params', (group) => group
    // 1. Derive user from token for all routes in this group
    .derive(async (context) => {
      const authHeader = context.headers['authorization'];
      let user: AuthUser | null = null;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        // Ensure authService.verifyToken is available and correctly typed
        const payload = await authService.verifyToken(token);
        if (payload) {
            // Make sure the payload structure matches AuthUser
            user = { userId: payload.userId, email: payload.email };
        }
      }
      return { user }; // Adds 'user' to context for this group
    })
    // 2. Hook to check if user exists (authenticated) and is authorized (basic superuser check)
    .onBeforeHandle(async ({ user, set }) => {
      if (!user) {
        set.status = 401;
        return { message: 'Unauthorized: Missing or invalid token' };
      }
      // Placeholder for actual superuser/admin role check
      // Example: if (user.email !== 'admin@example.com' && !user.roles?.includes('admin')) {
      //   set.status = 403;
      //   return { message: 'Forbidden: Insufficient permissions' };
      // }
      console.log(`User ${user.email} is attempting to access params API.`);
    })
    // --- CRUD Endpoints for Params ---
    .get('/', async ({user}) => { // user is available from derive
      console.log(`User ${user?.email} GET /params`);
      return await paramService.getAllParams();
    })
    .get('/:id', async ({ params, set, user }) => {
      console.log(`User ${user?.email} GET /params/${params.id}`);
      const param = await paramService.getParamById(params.id);
      if (!param) {
        set.status = 404;
        return { message: 'Param not found' };
      }
      return param;
    }, {
      params: t.Object({ id: t.String() })
    })
    .post('/:id', async ({ params, body, set, user }) => {
      console.log(`User ${user?.email} POST /params/${params.id}`);
      const param = await paramService.setParam(params.id, body); // body is 'any'
      if (!param) {
        set.status = 500;
        return { message: 'Failed to set param' };
      }
      return param;
    }, {
      params: t.Object({ id: t.String() }),
      body: t.Any() // Value can be any JSON-serializable type
    })
    .delete('/:id', async ({ params, set, user }) => {
      console.log(`User ${user?.email} DELETE /params/${params.id}`);
      const success = await paramService.deleteParam(params.id);
      if (!success) {
        // Could be 404 if not found, or 500 for other errors
        set.status = 404; // Assuming delete of non-existent is also "ok" but indicates not found
        return { message: 'Failed to delete param or param not found' };
      }
      set.status = 204; // No content
      return;
    }, {
      params: t.Object({ id: t.String() })
    })
  );

  return app;
};

console.log('Params routes (src/routes/params/index.ts) created.');
