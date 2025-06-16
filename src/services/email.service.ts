import nodemailer from 'nodemailer';
import handlebars from 'handlebars';
import fs from 'fs/promises'; // For reading template files
import path from 'path';

// --- Email Configuration ---
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const EMAIL_FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS;
const APP_NAME = process.env.APP_NAME || 'Your App';
const APP_URL = process.env.APP_URL || 'http://localhost:3000'; // Used for link generation

let transporter: nodemailer.Transporter | null = null;

interface TemplatePaths {
  layout: string;
  verificationEmail: string;
  passwordResetEmail: string;
}

const templatePaths: TemplatePaths = {
  layout: path.join(process.cwd(), 'src', 'templates', 'email', 'layout.hbs'),
  verificationEmail: path.join(process.cwd(), 'src', 'templates', 'email', 'verificationEmail.hbs'),
  passwordResetEmail: path.join(process.cwd(), 'src', 'templates', 'email', 'passwordResetEmail.hbs'),
};

// Pre-compile templates
interface CompiledTemplates {
  layout?: handlebars.HandlebarsTemplateDelegate;
  verificationEmail?: handlebars.HandlebarsTemplateDelegate;
  passwordResetEmail?: handlebars.HandlebarsTemplateDelegate;
}
const compiledTemplates: CompiledTemplates = {};

async function compileTemplate(filePath: string): Promise<handlebars.HandlebarsTemplateDelegate | undefined> {
  try {
    const templateString = await fs.readFile(filePath, 'utf-8');
    return handlebars.compile(templateString);
  } catch (error) {
    console.error(`Failed to read or compile template ${filePath}:`, error);
    return undefined;
  }
}

async function initializeEmailService() {
  if (!SMTP_HOST || !EMAIL_FROM_ADDRESS) {
    console.warn('SMTP_HOST or EMAIL_FROM_ADDRESS is not configured. Email service is disabled.');
    return;
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE, // true for 465, false for other ports (STARTTLS)
    auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    tls: {
        // do not fail on invalid certs if developing locally with self-signed certs
        rejectUnauthorized: process.env.NODE_ENV === 'production'
    }
  });

  try {
    await transporter.verify();
    console.log('Email Service: Nodemailer transporter verified successfully.');
  } catch (error) {
    console.error('Email Service: Nodemailer transporter verification failed:', error);
    transporter = null; // Disable service if verification fails
    return;
  }

  // Compile all templates on initialization
  compiledTemplates.layout = await compileTemplate(templatePaths.layout);
  compiledTemplates.verificationEmail = await compileTemplate(templatePaths.verificationEmail);
  compiledTemplates.passwordResetEmail = await compileTemplate(templatePaths.passwordResetEmail);

  if (!compiledTemplates.layout || !compiledTemplates.verificationEmail || !compiledTemplates.passwordResetEmail) {
      console.error("Email Service: Not all email templates could be compiled. Service might be impaired.");
      // transporter = null; // Optionally disable if templates are critical
  } else {
      console.log("Email Service: All email templates compiled successfully.");
  }
}

// Initialize on load
initializeEmailService().catch(console.error);

async function renderTemplate(
    templateDelegate: handlebars.HandlebarsTemplateDelegate | undefined,
    data: any
): Promise<string | null> {
    if (!templateDelegate) return null;
    const body = templateDelegate(data);
    if (!compiledTemplates.layout) return body; // Return body without layout if layout failed
    return compiledTemplates.layout({ ...data, body }); // Embed body into layout
}


export async function sendMail(to: string, subject: string, htmlContent: string, textContent?: string): Promise<boolean> {
  if (!transporter) {
    console.warn('Email service is not initialized or disabled. Skipping email send.');
    return false;
  }

  const mailOptions: nodemailer.SendMailOptions = {
    from: `"${APP_NAME}" <${EMAIL_FROM_ADDRESS}>`,
    to,
    subject: `[${APP_NAME}] ${subject}`,
    html: htmlContent,
    text: textContent || htmlContent.replace(/<[^>]*>?/gm, ''), // Basic text version
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Email sent to ${to} with subject "${subject}"`);
    return true;
  } catch (error) {
    console.error(`Error sending email to ${to}:`, error);
    return false;
  }
}

export async function sendVerificationEmail(to: string, name: string | undefined, verificationToken: string): Promise<boolean> {
  if (!compiledTemplates.verificationEmail) {
    console.error("Verification email template not compiled. Cannot send email.");
    return false;
  }
  const verificationLink = `${APP_URL}/verify-email?token=${verificationToken}`; // Assuming frontend route
  const html = await renderTemplate(compiledTemplates.verificationEmail, {
    appName: APP_NAME,
    name,
    verificationLink,
  });
  if (!html) return false;
  return sendMail(to, 'Verify Your Email Address', html);
}

export async function sendPasswordResetEmail(to: string, name: string | undefined, resetToken: string, tokenExpirationHours: number): Promise<boolean> {
   if (!compiledTemplates.passwordResetEmail) {
    console.error("Password reset email template not compiled. Cannot send email.");
    return false;
  }
  const resetLink = `${APP_URL}/reset-password?token=${resetToken}`; // Assuming frontend route
  const html = await renderTemplate(compiledTemplates.passwordResetEmail, {
    appName: APP_NAME,
    name,
    resetLink,
    tokenExpirationHours,
  });
  if (!html) return false;
  return sendMail(to, 'Password Reset Request', html);
}

console.log('Email service (email.service.ts) created.');
