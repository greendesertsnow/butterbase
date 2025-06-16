import { TypedEmitter } from 'tiny-typed-emitter';
import { User } from '../models/user';
import { Collection } from '../models/collection';

// --- Payload Definitions ---
export interface RecordContext {
  collection: Collection;
  actor?: AuthUser | null;
}

export interface RecordCreatePayload extends RecordContext {
  record: Record<string, any>; // Data for the new record
}
export interface RecordUpdatePayload extends RecordContext {
  record: Record<string, any>; // Data for the update
  oldRecord: Record<string, any>; // Snapshot of record before update
}
export interface RecordDeletePayload extends RecordContext {
  record: Record<string, any>; // Snapshot of record being deleted
}
export interface RecordOperationSuccessPayload extends RecordContext {
  record: Record<string, any>; // The affected record after operation
}
export interface RecordOperationErrorPayload extends RecordContext {
  record?: Record<string, any> | null; // Record data at the time of error (if available)
  oldRecord?: Record<string, any> | null; // For updates
  error: Error;
}

export interface UserContext {
  actor?: AuthUser | null;
}
export interface UserCreatePayload extends UserContext {
  user: Partial<User>; // Data for new user
}
export interface UserUpdatePayload extends UserContext {
  user: Partial<User>; // Data for update
  oldUser: User;
}
export interface UserDeletePayload extends UserContext {
  user: User; // User being deleted
}
export interface UserOperationSuccessPayload extends UserContext {
  user: User; // Affected user
}
export interface UserOperationErrorPayload extends UserContext {
  user?: Partial<User> | User | null;
  oldUser?: User | null;
  error: Error;
}

// Re-import AuthUser here if it's not globally available or correctly pathed from services
// For simplicity, assuming services can import it from '../routes/auth'
import { AuthUser } from '../routes/auth';


// --- Event Signatures ---
interface AppEvents {
  // Record CUD Events
  'beforeRecordValidate': (payload: RecordContext & { record: Record<string, any> }) => void | Promise<void>;
  'beforeRecordCreate': (payload: RecordCreatePayload) => void | Promise<void>;
  'afterRecordCreateSuccess': (payload: RecordOperationSuccessPayload) => void;
  'afterRecordCreateError': (payload: RecordOperationErrorPayload) => void;

  'beforeRecordUpdate': (payload: RecordUpdatePayload) => void | Promise<void>;
  'afterRecordUpdateSuccess': (payload: RecordOperationSuccessPayload & { oldRecord: Record<string,any> }) => void;
  'afterRecordUpdateError': (payload: RecordOperationErrorPayload) => void;

  'beforeRecordDelete': (payload: RecordDeletePayload) => void | Promise<void>;
  'afterRecordDeleteSuccess': (payload: RecordOperationSuccessPayload) => void; // record here is the data of the deleted record
  'afterRecordDeleteError': (payload: RecordOperationErrorPayload) => void;

  // User CUD Events (simplified: using User model directly)
  'beforeUserValidate': (payload: UserContext & { user: Partial<User> }) => void | Promise<void>;
  'beforeUserCreate': (payload: UserCreatePayload) => void | Promise<void>;
  'afterUserCreateSuccess': (payload: UserOperationSuccessPayload) => void;
  'afterUserCreateError': (payload: UserOperationErrorPayload) => void;

  'beforeUserUpdate': (payload: UserUpdatePayload) => void | Promise<void>;
  'afterUserUpdateSuccess': (payload: UserOperationSuccessPayload & { oldUser: User }) => void;
  'afterUserUpdateError': (payload: UserOperationErrorPayload) => void;

  'beforeUserDelete': (payload: UserDeletePayload) => void | Promise<void>;
  'afterUserDeleteSuccess': (payload: UserOperationSuccessPayload) => void; // user here is data of deleted user
  'afterUserDeleteError': (payload: UserOperationErrorPayload) => void;

  // Other app specific events can be added here
  // 'settingsUpdate': (newSettings: any, oldSettings: any) => void;
}

class EventService extends TypedEmitter<AppEvents> {
  constructor() {
    super();
    console.log('EventService initialized with granular CUD events.');
  }

  /**
   * Emits a "before" event that can potentially halt an operation.
   * Listeners can throw an error to prevent the operation.
   * If a listener modifies the payload, those modifications will be used by the caller.
   * @param eventName The name of the event.
   * @param payload The payload for the event.
   */
  async emitStoppable<E extends keyof AppEvents>(
    eventName: E,
    payload: Parameters<AppEvents[E]>[0]
  ): Promise<void> { // Returns Promise<void> to indicate it might involve async listeners
    // tiny-typed-emitter's emit is synchronous.
    // To support async listeners that can halt, we'd need to manage promises.
    // For now, if a listener is async and throws, it might lead to unhandled rejection
    // if the caller doesn't await this.
    // The current TypedEmitter doesn't make emit async or return a promise from emit.
    // This simplified version relies on synchronous listeners throwing errors,
    // or async listeners that the caller of emitStoppable would need to handle if they don't await.
    // The `await Promise.resolve(listener(payload))` allows a listener to be async and for us to await it.

    // Get listeners for the event
    const listeners = this.listeners(eventName) as Array<(...args: any[]) => void | Promise<void>>;
    for (const listener of listeners) {
        try {
            await Promise.resolve(listener(payload)); // Allow sync or async listeners
        } catch (error: any) { // Catch any error
            console.warn(`Event listener for "${String(eventName)}" threw an error, halting operation:`, error.message);
            throw error; // Re-throw to halt the operation in the service
        }
    }
  }
}

export const appEvents = new EventService();
console.log('Event service (event.service.ts) updated with granular CUD events and emitStoppable helper.');
