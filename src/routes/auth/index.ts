import { Elysia, t } from 'elysia';
import * as authService from '../../services/auth.service';
import { User } from '../../models/user'; // For response type

// Helper for JWT middleware (can be expanded)
const isAuthenticated = async ({ headers, set }) => {
  const authHeader = headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    set.status = 401;
    return { message: 'Unauthorized: Missing or malformed token' };
  }
  const token = authHeader.substring(7); // Remove 'Bearer '
  const payload = await authService.verifyToken(token);
  if (!payload) {
    set.status = 401;
    return { message: 'Unauthorized: Invalid token' };
  }
  // Optionally, attach user payload to request context if Elysia supports it easily
  // For now, just validates.
  return; // No error means authenticated
};


export const authRoutes = (app: Elysia) => {
  // --- Registration ---
  app.post('/register', async ({ body, set }) => {
    try {
      const user = await authService.registerUser(body as authService.RegisterUserOptions);
      if (!user) { // Should be handled by service throwing error, but as fallback
        set.status = 400;
        return { message: 'Registration failed' };
      }
      // Exclude password hash from response
      const { passwordHash, ...safeUser } = user as User & {passwordHash?: string};
      return { user: safeUser };
    } catch (e) {
      set.status = 400; // Or 409 for conflict (user exists)
      return { message: e.message };
    }
  }, {
    body: t.Object({
      email: t.String({ format: 'email' }),
      password: t.String({ minLength: 8 }),
      name: t.Optional(t.String()),
      avatar: t.Optional(t.String()),
    })
  });

  // --- Login ---
  app.post('/login', async ({ body, set }) => {
    try {
      const result = await authService.loginUser(body as authService.LoginUserOptions);
      if (!result) {
        set.status = 401;
        return { message: 'Invalid email or password' };
      }
      return result;
    } catch (e) {
      set.status = 500;
      return { message: e.message };
    }
  }, {
    body: t.Object({
      email: t.String({ format: 'email' }),
      password: t.String(),
    })
  });

  // --- Protected Route Example ---
  app.group('/me', (group) => group
    .onBeforeHandle(isAuthenticated) // Apply middleware to this group
    .get('/', async ({ headers }) => {
      // If isAuthenticated passed, token is valid.
      // We'd typically get user ID from token and fetch fresh user data.
      const token = headers['authorization']!.substring(7);
      const payload = await authService.verifyToken(token); // Re-verify to get payload
      // In a real app, middleware might attach payload to context.
      return { message: 'You are authenticated!', user: payload };
    })
  );

  // --- Email Verification Routes ---
  app.post('/request-verification', async ({ body, set }) => {
    try {
      const result = await authService.requestEmailVerification(body.email);
      if (!result) {
        set.status = 400; // User not found or already verified
        return { message: 'Failed to request verification or user already verified.' };
      }
      return { message: 'Verification email requested. Check your inbox for the token.', token: result.verificationToken };
    } catch (e) {
      set.status = 500;
      return { message: e.message };
    }
  }, {
    body: t.Object({ email: t.String({ format: 'email' }) })
  });

  app.post('/confirm-verification', async ({ body, set }) => {
    try {
      const success = await authService.confirmEmailVerification(body.token);
      if (!success) {
        set.status = 400;
        return { message: 'Invalid or expired verification token.' };
      }
      return { message: 'Email verified successfully.' };
    } catch (e) {
      set.status = 500;
      return { message: e.message };
    }
  }, {
    body: t.Object({ token: t.String() })
  });

  // --- Password Reset Routes ---
  app.post('/request-password-reset', async ({ body, set }) => {
    try {
      const result = await authService.requestPasswordReset(body.email);
       if (!result) {
        set.status = 400; // User not found
        return { message: 'If your email is registered, you will receive a password reset token.' }; // Generic message for security
      }
      // For testing, returning token. In prod, only message.
      return { message: 'Password reset requested. Check your inbox.', token: result.resetToken };
    } catch (e) {
      set.status = 500;
      return { message: e.message };
    }
  }, {
    body: t.Object({ email: t.String({ format: 'email' }) })
  });

  app.post('/confirm-password-reset', async ({ body, set }) => {
    try {
      const success = await authService.confirmPasswordReset(body.token, body.newPassword);
      if (!success) {
        set.status = 400;
        return { message: 'Invalid or expired reset token, or invalid password.' };
      }
      return { message: 'Password reset successfully.' };
    } catch (e) {
      set.status = 400; // Could be validation error (password too short) or other issues
      return { message: e.message };
    }
  }, {
    body: t.Object({
      token: t.String(),
      newPassword: t.String({ minLength: 8 })
    })
  });

  return app;
};

console.log('Auth routes (src/routes/auth/index.ts) created.');

// Ensure AuthUser type is defined and exported if not already
// This might be a duplicate if it was defined earlier; ensure only one definition.
// export interface AuthUser { userId: string; email: string; roles?: string[]; }
