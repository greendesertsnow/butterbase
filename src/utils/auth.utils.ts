import { AuthUser } from '../routes/auth'; // Assuming AuthUser is exported from here

const ADMIN_EMAILS_STRING = process.env.ADMIN_EMAILS || "";
const ADMIN_EMAIL_LIST = ADMIN_EMAILS_STRING.split(',').map(email => email.trim().toLowerCase()).filter(Boolean);

if (ADMIN_EMAIL_LIST.length > 0) {
  console.log(`Admin emails configured: ${ADMIN_EMAIL_LIST.join(', ')}`);
} else {
  console.warn("No ADMIN_EMAILS configured. Admin functionality will be restricted.");
}

export function isUserAdmin(authContext: AuthUser | null): boolean {
  if (!authContext || !authContext.email) {
    return false;
  }
  return ADMIN_EMAIL_LIST.includes(authContext.email.toLowerCase());
}
