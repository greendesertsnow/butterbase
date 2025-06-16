import { Elysia, t } from 'elysia';
import * as fileService from '../../services/file.service';
import * as authService from '../../services/auth.service'; // For JWT verification
import { type AuthUser } from '../auth'; // Assuming AuthUser type

export const uploadRoutes = (app: Elysia) => {
  app.group('/upload', (group) => group
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
      // Add any other specific authorization checks for uploads if needed
      console.log(`User ${user.email} is attempting to upload a file.`);
    })
    .post('/', async ({ body, set, user }) => {
      // Elysia handles multipart/form-data and 'body' will contain the fields.
      // Assuming the file is sent with a field name like 'file'.
      const fileField = (body as any)?.file;

      if (!fileField || !(fileField instanceof File)) {
        set.status = 400;
        return { message: 'File part named "file" is missing or not a file.' };
      }

      const uploadedFile = fileField as File; // Bun's File type

      // You might want to add checks for file size, type, etc. here
      // Example: if (uploadedFile.size > 10 * 1024 * 1024) { /* too large */ }
      // Example: if (!['image/jpeg', 'image/png'].includes(uploadedFile.type)) { /* invalid type */ }

      // Use a user-specific prefix or a generic one
      const keyPrefix = `users/${user?.userId || 'public'}/files`;

      try {
        const result = await fileService.uploadFileToS3(uploadedFile, keyPrefix);
        if (!result) {
          set.status = 500;
          return { message: 'Failed to upload file to S3.' };
        }
        return {
          message: 'File uploaded successfully!',
          data: result, // Contains key, url, size, type
        };
      } catch (error) {
        console.error('File upload route error:', error);
        set.status = 500;
        return { message: 'Internal server error during file upload.' };
      }
    }, {
      // Define body schema for multipart/form-data
      // Elysia's t.File() or t.Files() for validation
      body: t.Object({
        file: t.File({
          // Optionally specify constraints like maxSize, types
          // maxSize: '5m', // e.g., 5MB
          // types: ['image/png', 'image/jpeg']
        }),
        // other form fields if any
        // description: t.Optional(t.String())
      })
    })
  );
  return app;
};

console.log('Upload routes (src/routes/upload/index.ts) created.');
