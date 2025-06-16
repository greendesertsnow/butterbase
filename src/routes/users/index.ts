import { Elysia, t } from 'elysia';
import * as userService from '../../services/user.service';
import * as authService from '../../services/auth.service'; // For AuthUser type primarily
import { type AuthUser } from '../auth'; // For context.user type
import { isUserAdmin } from '../../utils/auth.utils'; // Added import

// Schema for user update payload
const UserUpdateSchema = t.Object({
  email: t.Optional(t.String({ format: 'email' })),
  password: t.Optional(t.String({ minLength: 8 })),
  passwordConfirm: t.Optional(t.String()),
  oldPassword: t.Optional(t.String()),
  name: t.Optional(t.String({ minLength: 1 })),
  avatar: t.Optional(t.String()), // Expecting an S3 file key/URL
  verified: t.Optional(t.Boolean()) // Only for admins
}, { additionalProperties: false });


export const usersRoutes = (app: Elysia) => {
  // Group for user profile routes, e.g., /api/users
  app.group('/users', (group) => group
    .derive(async (context) => { // Add authenticated user to context
      const authHeader = context.headers['authorization'];
      let user: AuthUser | null = null;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const payload = await authService.verifyToken(token);
        if (payload) user = { userId: payload.userId, email: payload.email /*, roles: payload.roles */ };
      }
      return { authUser: user }; // Renamed to authUser to avoid conflict with 'user' model/data
    })
    .onBeforeHandle(async ({ authUser, set }) => { // Ensure user is authenticated for all /users routes
      if (!authUser) {
        set.status = 401;
        return { message: 'Unauthorized: Missing or invalid token' };
      }
    })
    // GET /api/users/me - Get current authenticated user's profile
    .get('/me', async ({ authUser, set }) => {
      if (!authUser) { /* Should be caught by group's onBeforeHandle */ return; }
      const result = await userService.getUserById(authUser.userId);
      if (result.errors || !result.user) {
        set.status = 404;
        return { message: 'User profile not found.', errors: result.errors };
      }
      const { passwordHash, ...safeUser } = result.user;
      return safeUser;
    }, {
        detail: { summary: "Get current authenticated user's profile" }
    })
    // PATCH /api/users/me - Update current authenticated user's profile
    .patch('/me', async ({ authUser, body, set }) => {
      if (!authUser) { /* Should be caught */ return; }
      const { user, errors } = await userService.updateUser(
        authUser.userId,
        body as userService.UpdateUserOptions,
        authUser // Pass authUser as context for permission checks
      );
      if (errors) {
        set.status = 400; // Or 403 if permission errors
        return { message: 'Failed to update user profile', errors };
      }
      return user;
    }, {
      body: UserUpdateSchema,
      detail: { summary: "Update current authenticated user's profile" }
    })

    // Admin route example: GET /api/users/:userId - Get any user's profile by ID
    .get('/:userId', async ({ params, authUser, set }) => {
        if (!isUserAdmin(authUser)) { set.status = 403; return { message: "Forbidden: Admin access required" }; }
        // console.log(`User ${authUser?.email} attempting to fetch user ${params.userId} (admin action placeholder).`);
        const result = await userService.getUserById(params.userId);
        if (result.errors || !result.user) {
            set.status = 404;
            return { message: 'User not found.', errors: result.errors };
        }
        const { passwordHash, ...safeUser } = result.user;
        return safeUser;
    }, {
        params: t.Object({ userId: t.String() }),
        detail: { summary: "Get any user's profile by ID (Admin Only - placeholder)" }
    })
    // Admin route example: PATCH /api/users/:userId - Update any user's profile by ID
    .patch('/:userId', async ({ params, body, authUser, set }) => {
        if (!isUserAdmin(authUser)) { set.status = 403; return { message: "Forbidden: Admin access required" }; }
        // console.log(`User ${authUser?.email} attempting to update user ${params.userId} (admin action placeholder).`);
        const { user, errors } = await userService.updateUser(
            params.userId,
            body as userService.UpdateUserOptions,
            authUser // Pass current user as authContext for permission checks within service
        );
        if (errors) {
            set.status = 400;
            return { message: 'Failed to update user profile', errors };
        }
        return user;
    }, {
        params: t.Object({ userId: t.String() }),
        body: UserUpdateSchema,
        detail: { summary: "Update any user's profile by ID (Admin Only - placeholder)" }
    })
  );
  return app;
};
console.log('User profile routes (src/routes/users/index.ts) created.');
