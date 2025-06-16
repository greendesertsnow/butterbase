import { Elysia } from 'elysia';
import { getDB } from './services/database';
import { authRoutes } from './routes/auth'; // Import auth routes
import { paramsRoutes } from './routes/params'; // Import params routes
import { uploadRoutes } from './routes/upload'; // Import upload routes
import { collectionsSchemaRoutes } from './routes/collections'; // Import collections schema routes
import { recordsRoutes } from './routes/records'; // Import records routes
import { usersRoutes } from './routes/users'; // Import user profile routes
import { registerUserListeners } from './listeners/user.listeners'; // Import user listeners
import { registerApplicationCronJobs } from './services/cron.service'; // Import cron job registration

const app = new Elysia();

// Initialize DB connection on startup
try {
  getDB(); // This will initialize the db if not already done
  console.log('Database connection established/checked.');

  // Register application event listeners
  registerUserListeners();

  // Register and schedule cron jobs
  registerApplicationCronJobs();
} catch (e) {
  console.error('Failed to initialize database, listeners, or cron jobs:', e); // Updated error message
  process.exit(1);
}

// --- Hooks ---
// Example: Basic logging for each request
app.onRequest(({ request }) => {
  console.log(`[Request]: ${request.method} ${new URL(request.url).pathname}`);
});

// --- Routes ---
app.get('/', () => ({ message: 'Welcome to the Bun API!' }));
app.get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }));

// Mount auth routes
app.group('/auth', (group) => authRoutes(group));

// Mount params routes (e.g., under /admin)
app.group('/admin', (group) => paramsRoutes(group));

// Mount upload routes
app.group('/api', (group) => uploadRoutes(group)); // e.g. /api/upload

// Mount collections schema routes (e.g., under /api/manage)
app.group('/api/manage', (group) => collectionsSchemaRoutes(group));

// Mount records routes (e.g., under /api)
// This will result in routes like /api/collections/:collectionName/records
app.group('/api', (group) => recordsRoutes(group));

// Mount user profile routes (e.g., under /api)
// This will result in routes like /api/users/me
app.group('/api', (group) => usersRoutes(group));


// --- Start Server ---
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🦊 Elysia is running at http://${app.server?.hostname}:${app.server?.port}`);
});

export type App = typeof app; // For type inference in routes
