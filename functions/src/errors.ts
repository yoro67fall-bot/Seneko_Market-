import type { User } from "@prisma/client";
import type { z } from "zod";
import type { PlatformCountry } from "./country.js";
import { DEFAULT_COUNTRY } from "./country.js";
import { prisma } from "./prisma.js";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type AuthContext = {
  uid: string;
  email: string | null;
  role: string;
  countryCode?: string | null;
};

export type HandlerRequest = {
  data: unknown;
  auth?: AuthContext;
  ip?: string;
  countryCode?: PlatformCountry;
};

export function requireCountry(request: HandlerRequest): PlatformCountry {
  return request.countryCode ?? DEFAULT_COUNTRY;
}

export function parseInput<TSchema extends z.ZodType>(
  schema: TSchema,
  data: unknown,
): z.infer<TSchema> {
  const parsed = schema.safeParse(data ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    throw new ApiError(
      "invalid-argument",
      issues[0]?.message || "Invalid request data.",
      { issues },
    );
  }
  return parsed.data;
}

export function requireAuth(request: HandlerRequest): AuthContext {
  if (!request.auth) {
    throw new ApiError("unauthenticated", "Authentication is required.");
  }
  return request.auth;
}

export function requireAdmin(request: HandlerRequest): string {
  const auth = requireAuth(request);
  if (auth.role !== "admin") {
    throw new ApiError("permission-denied", "An administrator account is required.");
  }
  return auth.uid;
}

export async function requireCountryUser(request: HandlerRequest): Promise<User> {
  const auth = requireAuth(request);
  const countryCode = requireCountry(request);
  const user = await prisma.user.findUnique({ where: { id: auth.uid } });
  if (!user) {
    throw new ApiError("unauthenticated", "Authentication is required.");
  }
  if (user.countryCode !== countryCode) {
    throw new ApiError(
      "permission-denied",
      "This account is not valid for this country platform.",
    );
  }
  return user;
}

export async function requireCountryAdmin(request: HandlerRequest): Promise<string> {
  const user = await requireCountryUser(request);
  if (user.role !== "admin") {
    throw new ApiError("permission-denied", "An administrator account is required.");
  }
  return user.id;
}

export function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "P2002"
  ) {
    return new ApiError("already-exists", "This resource already exists.");
  }
  console.error("Unhandled API error", error);
  return new ApiError("internal", "The request could not be completed.");
}
