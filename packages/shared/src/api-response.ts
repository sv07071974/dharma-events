import { z } from 'zod';

/**
 * Standard API success/failure envelope used by all Dharma Events API responses.
 * See REQUIREMENTS.md Section 86 (Suggested API Response Structure).
 */
export type ApiSuccess<T> = {
  success: true;
  data: T;
};

export type ApiError = {
  success: false;
  error: {
    code: string;
    message: string;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export function apiSuccess<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}

export function apiError(code: string, message: string): ApiError {
  return { success: false, error: { code, message } };
}

/**
 * Roles supported by the platform (REQUIREMENTS.md Section 12.1).
 */
export const UserRole = {
  ADMIN: 'ADMIN',
  EVENT_MANAGER: 'EVENT_MANAGER',
  SUPERVISOR: 'SUPERVISOR',
  VOLUNTEER: 'VOLUNTEER',
} as const;

export type UserRoleValue = (typeof UserRole)[keyof typeof UserRole];

export const userRoleSchema = z.nativeEnum(UserRole);
