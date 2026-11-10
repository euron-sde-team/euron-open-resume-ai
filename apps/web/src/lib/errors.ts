import { isApiError } from "@open-resume/api-client";

/** Human copy for the API's stable error codes. Unknown codes fall back to the server message. */
const COPY: Record<string, string> = {
  NETWORK_ERROR: "We could not reach the server. Check your connection and try again.",
  SERVER_ERROR: "Something went wrong on our side. Try again in a moment.",
  BAD_GATEWAY: "The service is restarting. Try again in a moment.",
  SERVICE_UNAVAILABLE: "The service is temporarily unavailable. Try again in a moment.",
  GATEWAY_TIMEOUT: "The server took too long to answer. Try again.",
  RATE_LIMITED: "You are doing that too fast. Wait a moment and try again.",
  UNAUTHENTICATED: "Sign in to continue.",
  TOKEN_INVALID: "This link is invalid or has expired.",
  SESSION_EXPIRED: "Your session expired. Sign in again.",
  FORBIDDEN: "You do not have permission to do that.",
  FORBIDDEN_ADMIN: "Only administrators can do that.",
  NOT_FOUND: "We could not find that. It may have been removed.",
  VALIDATION_FAILED: "Some fields need attention.",
  INVALID_CREDENTIALS: "That email, username or password is not right.",
  INVALID_TOTP: "That code did not work. Check your authenticator app and try again.",
  ACCOUNT_BANNED: "This account has been banned.",
  ACCOUNT_DEACTIVATED: "This account has been deactivated.",
  ACCOUNT_RESTRICTED: "Your account is restricted: you can read your data but not change it.",
  EMAIL_NOT_VERIFIED: "Confirm your email address first. Check your inbox for the link.",
  EMAIL_TAKEN: "An account with that email already exists.",
  USERNAME_TAKEN: "That username is taken. Try another.",
  WEAK_PASSWORD: "Choose a stronger password: at least 10 characters, not a common one.",
  REGISTRATION_CLOSED: "Sign-ups are closed right now.",
  REGISTRATION_DOMAIN_NOT_ALLOWED: "Sign-up is open to approved email domains only. Use your work address.",
  USERNAME_RESERVED: "That username is reserved. Try another.",
  LAST_ADMIN: "You are the last administrator. Make someone else an admin first.",
  SELF_ACTION: "You cannot do that to your own account.",
  TARGET_PROTECTED: "Administrators cannot be suspended or banned. Remove their admin role first.",
  PAYLOAD_TOO_LARGE: "That is too large.",
  FILE_TOO_LARGE: "That file is larger than your limit allows.",
  FILE_TYPE_NOT_ALLOWED: "Upload a PDF, DOCX or plain text file.",
  FILE_TYPE_MISMATCH: "The file's content does not match its type.",
  FILE_REJECTED: "The file could not be read.",
  UNSUPPORTED_FILE: "Upload a PDF, DOCX, TXT or Markdown file.",
  NO_TEXT: "We could not read any text in that file. It may be a scan. Upload a text-based PDF or DOCX. No run was used.",
  NOT_READY: "The resume is still being analysed. Try again in a moment.",
  ALREADY_RUNNING: "That is already running. It will appear here when it finishes.",
  NOT_FAILED: "That step did not fail, so there is nothing to retry.",
  NOTHING_TO_RETRY: "Nothing failed, so there is nothing to retry.",
  DRAFT_LIMIT: "You have 50 drafts, the most allowed. Delete one to save another.",
  QUOTA_EXHAUSTED: "You have used this month's AI runs. They reset on the first of the month (UTC).",
  QUOTA_EXCEEDED: "You have used this month's AI runs. They reset on the first of the month (UTC).",
  RESUME_LIMIT: "You have reached the limit of saved resumes. Delete one to add another.",
  CONTENT_BLOCKED: "This request cannot be answered.",
};

export function errorCopy(code: string | undefined, fallback?: string): string {
  if (code && COPY[code]) return COPY[code];
  return fallback || "Something went wrong. Try again.";
}

/** The best human message for any thrown value. */
export function errorMessage(e: unknown): string {
  if (isApiError(e)) {
    // Validation messages from the server are already field-specific and readable.
    if (e.code === "VALIDATION_FAILED") {
      const first = Object.values(e.fieldErrors)[0];
      return first ? `${COPY.VALIDATION_FAILED} ${capitalise(first)}.` : COPY.VALIDATION_FAILED!;
    }
    return errorCopy(e.code, e.message);
  }
  if (e instanceof Error && e.name === "AbortError") return "Cancelled.";
  return errorCopy(undefined);
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/\.$/, "");

/** Errors not worth a toast: the page already shows them in place. */
export function isQuietError(e: unknown): boolean {
  if (isApiError(e)) return e.status === 404 || e.status === 401 || e.code === "VALIDATION_FAILED";
  return e instanceof Error && e.name === "AbortError";
}
