import { z } from 'zod';
import { Role } from '@dharma-events/database';
import { MIN_PASSWORD_LENGTH } from './password.js';

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid email address is required.'),
  password: z.string().min(1, 'Password is required.'),
});

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid email address is required.'),
  name: z.string().trim().min(1, 'Name is required.'),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`),
  role: z.nativeEnum(Role),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
