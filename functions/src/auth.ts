import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getAdminEmail, getAdminPassword, getJwtSecret } from "./config.js";
import {
  DEFAULT_COUNTRY,
  PLATFORM_COUNTRIES,
  type PlatformCountry,
} from "./country.js";
import { ApiError, type AuthContext } from "./errors.js";
import { prisma } from "./prisma.js";
import { serializeProfileWithShop } from "./data.js";

const TOKEN_TTL = "7d";

export function signToken(user: {
  id: string;
  email: string;
  role: string;
  countryCode: string;
}): string {
  return jwt.sign(
    {
      uid: user.id,
      email: user.email,
      role: user.role,
      countryCode: user.countryCode,
    },
    getJwtSecret(),
    { expiresIn: TOKEN_TTL },
  );
}

export function verifyToken(token: string): AuthContext {
  try {
    const payload = jwt.verify(token, getJwtSecret()) as {
      uid?: string;
      email?: string;
      role?: string;
      countryCode?: string;
    };
    if (!payload.uid) throw new Error("invalid");
    return {
      uid: payload.uid,
      email: payload.email ?? null,
      role: payload.role ?? "merchant",
      countryCode: payload.countryCode ?? null,
    };
  } catch {
    throw new ApiError("unauthenticated", "Authentication is required.");
  }
}

export async function bootstrapAdmin(): Promise<void> {
  const email = getAdminEmail();
  const password = getAdminPassword();
  if (!email || !password) return;
  const passwordHash = await bcrypt.hash(password, 12);
  for (const countryCode of PLATFORM_COUNTRIES) {
    const existing = await prisma.user.findUnique({
      where: {
        countryCode_email: { countryCode, email },
      },
    });
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { role: "admin", passwordHash },
      });
      continue;
    }
    await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstname: "Admin",
        lastname: "Seneko",
        role: "admin",
        countryCode,
      },
    });
  }
}

export async function registerUser(
  input: {
    email: string;
    password: string;
    firstname?: string;
    lastname?: string;
    phone?: string;
  },
  countryCode: PlatformCountry = DEFAULT_COUNTRY,
): Promise<{ token: string; profile: Record<string, unknown> | null; admin: boolean }> {
  const email = input.email.trim().toLowerCase();
  const exists = await prisma.user.findUnique({
    where: { countryCode_email: { countryCode, email } },
  });
  if (exists) {
    throw new ApiError("already-exists", "This email is already in use.");
  }
  if (input.password.length < 8) {
    throw new ApiError("invalid-argument", "The password must contain at least 8 characters.");
  }
  let user;
  try {
    user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(input.password, 12),
        firstname: input.firstname ?? "",
        lastname: input.lastname ?? "",
        phone: input.phone ?? "",
        countryCode,
        role: email === getAdminEmail() ? "admin" : "merchant",
      },
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    ) {
      throw new ApiError("already-exists", "This email is already in use.");
    }
    throw error;
  }
  return {
    token: signToken(user),
    profile: await serializeProfileWithShop(user.id),
    admin: user.role === "admin",
  };
}

export async function loginUser(
  email: string,
  password: string,
  countryCode: PlatformCountry = DEFAULT_COUNTRY,
): Promise<{ token: string; profile: Record<string, unknown> | null; admin: boolean }> {
  const user = await prisma.user.findUnique({
    where: {
      countryCode_email: {
        countryCode,
        email: email.trim().toLowerCase(),
      },
    },
  });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new ApiError("invalid-argument", "Email ou mot de passe incorrect.");
  }
  return {
    token: signToken(user),
    profile: await serializeProfileWithShop(user.id),
    admin: user.role === "admin",
  };
}

export async function changeUserPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new ApiError("invalid-argument", "Mot de passe actuel incorrect.");
  }
  if (newPassword.length < 8) {
    throw new ApiError(
      "invalid-argument",
      "Le mot de passe doit contenir au moins 8 caractères.",
    );
  }
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(newPassword, 12) },
  });
}
