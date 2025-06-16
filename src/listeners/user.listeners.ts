import { appEvents, UserOperationSuccessPayload } from '../services/event.service';
import { User } from '../models/user';
// import * as emailService from '../services/email.service'; // Example if sending welcome email

function handleAfterUserCreateSuccess(payload: UserOperationSuccessPayload) {
  console.log(`[EVENT: afterUserCreateSuccess] New user created: ID=${payload.user.id}, Email=${payload.user.email}`);

  // Example: Send a welcome email (content would need to be defined)
  // if (payload.user.email) {
  //   const userName = payload.user.name || payload.user.email.split('@')[0];
  //   // Assume a generic sendMail or a specific welcome email function in emailService
  //   // emailService.sendWelcomeEmail(payload.user.email, userName).catch(console.error);
  //   console.log(`[UserListener] TODO: Send welcome email to ${payload.user.email}`);
  // }

  // Other actions could be:
  // - Initializing user-specific settings
  // - Adding user to a default group/role (if RBAC was in place)
  // - Logging to an audit trail
}

export function registerUserListeners() {
  appEvents.on('afterUserCreateSuccess', handleAfterUserCreateSuccess);

  // Register other user-related listeners here
  // appEvents.on('beforeUserDelete', (payload) => {
  //   console.log(`[EVENT: beforeUserDelete] User deletion attempt: ID=${payload.user.id}`);
  //   // Example: Check if user can be deleted (e.g., not last admin)
  //   // if (payload.user.roles?.includes('admin') && countAdmins() === 1) {
  //   //   throw new Error("Cannot delete the last administrator.");
  //   // }
  // });

  console.log('User event listeners registered.');
}
