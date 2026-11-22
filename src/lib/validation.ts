import { z } from "zod";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const emailSchema = z
  .string()
  .trim()
  .min(3, "Email is required")
  .max(254)
  .regex(EMAIL_RE, "Enter a valid email address")
  .transform((v) => v.toLowerCase());

export const passwordSchema = z
  .string()
  .min(8, "At least 8 characters")
  .max(72, "At most 72 characters");

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

export const signUpSchema = z.object({
  fullName: z.string().trim().min(2, "Tell us your name").max(80),
  email: emailSchema,
  password: passwordSchema,
});

export const orgSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(80, "At most 80 characters"),
});

export const taskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(160),
  client: z.string().trim().max(120).default(""),
  description: z.string().trim().max(4000).optional().default(""),
  assigneeId: z.string().uuid("Pick a team member"),
  estHours: z.coerce.number().min(0.25, "Minimum 0.25h").max(500, "Maximum 500h"),
  progress: z.coerce.number().int().min(0).max(100).default(0),
  status: z.enum(["pending", "in_progress", "done"]).default("pending"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  deadline: isoDate.nullable().optional(),
});

export const memberProgressSchema = z.object({
  taskId: z.string().min(1),
  progress: z.coerce.number().int().min(0).max(100),
  status: z.enum(["pending", "in_progress", "done"]),
});

export const roleSchema = z.enum(["owner", "admin", "member"]);

export const capacitySchema = z.coerce.number().int().min(1, "Minimum 1 hour").max(80, "Maximum 80 hours");

export const inviteSchema = z.object({
  email: z.union([z.literal(""), emailSchema]).optional().default(""),
  role: z.enum(["admin", "member"]).default("member"),
});

export const availabilitySchema = z.object({
  date: isoDate,
  hours: z.array(z.coerce.number().int().min(0).max(23)).max(24),
});

export const planSchema = z.enum(["free", "pro", "business"]);

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
export type TaskInput = z.infer<typeof taskSchema>;
