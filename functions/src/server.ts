import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { getJwtSecret, getUploadRoot, isAllowedCorsOrigin, resolvePublicBaseUrl } from "./config.js";
import { parsePlatformCountry } from "./country.js";
import { ApiError, parseInput, type AuthContext, type HandlerRequest } from "./errors.js";
import { bootstrapAdmin, loginUser, registerUser, verifyToken } from "./auth.js";
import { prisma } from "./prisma.js";
import { getPlatformConfig, serializeProfileWithShop } from "./data.js";
import { loginSchema, registerSchema } from "./schemas.js";
import { isIdentityPath, resolveUploadFile, saveUpload } from "./uploads.js";
import { bootstrapPublic, getPublicShop, recordShopEvent } from "./callables/catalog.js";
import {
  completeMerchantProfile,
  deleteMyShop,
  deleteProduct,
  getMyAccount,
  updateMyShop,
  upsertProduct,
} from "./callables/merchant.js";
import {
  createPayment,
  getPaymentStatus,
  submitSponsorship,
} from "./callables/payments.js";
import {
  adminBootstrap,
  adminDeleteAgent,
  adminDeleteBanner,
  adminListShops,
  adminMarkRent,
  adminSetPlatformBranding,
  adminSetRentConfig,
  adminSetShopStatus,
  adminUpsertAgent,
  adminUpsertBanner,
  adminVerifyIdentity,
  adminReviewSeller,
  adminListProducts,
  adminSetProductStatus,
  adminUpsertCategoryBanner,
  adminDeleteCategoryBanner,
} from "./callables/admin.js";
import { nabooPayWebhook, senePayWebhook } from "./http/webhook.js";
import { getCronSecret } from "./config.js";
import { runRentReminderJob, startRentReminderScheduler } from "./jobs/rentReminders.js";

const CALLABLES: Record<string, (request: HandlerRequest) => Promise<unknown>> = {
  bootstrapPublic,
  getPublicShop,
  recordShopEvent,
  completeMerchantProfile,
  getMyAccount,
  updateMyShop,
  deleteMyShop,
  upsertProduct,
  deleteProduct,
  createPayment,
  getPaymentStatus,
  submitSponsorship,
  adminListShops,
  adminBootstrap,
  adminSetShopStatus,
  adminSetRentConfig,
  adminMarkRent,
  adminVerifyIdentity,
  adminUpsertAgent,
  adminDeleteAgent,
  adminUpsertBanner,
  adminDeleteBanner,
  adminSetPlatformBranding,
  adminReviewSeller,
  adminListProducts,
  adminSetProductStatus,
  adminUpsertCategoryBanner,
  adminDeleteCategoryBanner,
};

const HTTP_STATUS: Record<string, number> = {
  "invalid-argument": 400,
  unauthenticated: 401,
  "permission-denied": 403,
  "not-found": 404,
  "already-exists": 409,
  "failed-precondition": 400,
  "resource-exhausted": 429,
  unavailable: 503,
  internal: 500,
  "deadline-exceeded": 504,
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(
  cors({
    origin(origin, callback) {
      callback(null, isAllowedCorsOrigin(origin));
    },
    credentials: true,
  }),
);
app.use("/webhooks/naboopay", express.raw({ type: "*/*" }));
app.use("/webhooks/senepay", express.raw({ type: "*/*" }));
app.use(express.json({ limit: "2mb" }));
app.use(
  "/uploads/public",
  express.static(path.join(getUploadRoot(), "public"), {
    maxAge: "1y",
    immutable: true,
    fallthrough: false,
  }),
);

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "seneko-market-api" });
});

app.post("/cron/rent-reminders", async (request, response, next) => {
  try {
    const secret = getCronSecret();
    const provided =
      String(request.get("x-cron-secret") || request.query.secret || "").trim();
    if (!secret || provided !== secret) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }
    const result = await runRentReminderJob();
    response.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.post("/webhooks/naboopay", (request, response) => {
  void nabooPayWebhook(request, response);
});

app.post("/webhooks/senepay", (request, response) => {
  void senePayWebhook(request, response);
});

app.post("/auth/register", async (request, response, next) => {
  try {
    const countryCode = countryFromRequest(request);
    const input = parseInput(registerSchema, request.body);
    const result = await registerUser(input, countryCode);
    response.json({ result });
  } catch (error) {
    next(error);
  }
});

app.post("/auth/login", async (request, response, next) => {
  try {
    const countryCode = countryFromRequest(request);
    const input = parseInput(loginSchema, request.body);
    const result = await loginUser(input.email, input.password, countryCode);
    response.json({ result });
  } catch (error) {
    next(error);
  }
});

app.get("/auth/me", async (request, response, next) => {
  try {
    const auth = decodeAuth(request);
    if (!auth) {
      throw new ApiError("unauthenticated", "Authentication is required.");
    }
    const user = await prisma.user.findUnique({ where: { id: auth.uid } });
    if (!user) {
      throw new ApiError("unauthenticated", "Authentication is required.");
    }
    response.json({
      result: {
        profile: await serializeProfileWithShop(user.id),
        admin: user.role === "admin",
      },
    });
  } catch (error) {
    next(error);
  }
});

app.post("/uploads", upload.single("file"), async (request, response, next) => {
  try {
    const auth = decodeAuth(request);
    if (!auth) {
      throw new ApiError("unauthenticated", "Authentication is required.");
    }
    const file = request.file;
    if (!file) {
      throw new ApiError("invalid-argument", "A file is required.");
    }
    const kind = String(request.body?.kind ?? "");
    if ((kind === "banner" || kind === "branding") && auth.role !== "admin") {
      throw new ApiError(
        "permission-denied",
        "An administrator account is required.",
      );
    }
    const saved = await saveUpload({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      kind,
      uid: auth.uid,
      shopId: typeof request.body?.shopId === "string" ? request.body.shopId : undefined,
      publicBaseUrl: resolvePublicBaseUrl(request),
    });
    response.json({ result: saved });
  } catch (error) {
    next(error);
  }
});

app.get("/uploads/identity/:uid/:filename", (request, response, next) => {
  try {
    const auth = decodeAuth(request);
    const uid = request.params.uid ?? "";
    const filename = request.params.filename ?? "";
    const relative = `identity/${uid}/${filename}`;
    if (!auth) {
      throw new ApiError("unauthenticated", "Authentication is required.");
    }
    if (auth.role !== "admin" && !isIdentityPath(relative, auth.uid)) {
      throw new ApiError("permission-denied", "You cannot view this file.");
    }
    const absolute = resolveUploadFile(relative);
    const root = path.resolve(getUploadRoot());
    if (!absolute.startsWith(root + path.sep) && absolute !== root) {
      throw new ApiError("permission-denied", "You cannot view this file.");
    }
    const lower = filename.toLowerCase();
    const contentType = lower.endsWith(".pdf")
      ? "application/pdf"
      : lower.endsWith(".png")
        ? "image/png"
        : lower.endsWith(".webp")
          ? "image/webp"
          : "image/jpeg";
    response.setHeader("Content-Type", contentType);
    response.setHeader("Cache-Control", "private, no-store");
    response.sendFile(absolute);
  } catch (error) {
    next(error);
  }
});

app.post("/v1/:name", async (request: Request, response: Response, next) => {
  const rawName = request.params.name;
  const name = Array.isArray(rawName) ? rawName[0] : rawName;
  const callable = name ? CALLABLES[name] : undefined;
  if (!callable) {
    response.status(404).json({
      error: { status: "not-found", message: "Unknown API method." },
    });
    return;
  }

  try {
    const result = await callable({
      data: request.body ?? {},
      auth: decodeAuth(request),
      ip: request.ip || request.get("x-forwarded-for") || "",
      countryCode: countryFromRequest(request),
    });
    response.json({ result });
  } catch (error) {
    next(error);
  }
});

function countryFromRequest(request: Request) {
  return parsePlatformCountry(
    request.get("x-platform-country") || request.get("X-Platform-Country"),
  );
}

function decodeAuth(request: Request): AuthContext | undefined {
  const header = request.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return undefined;
  try {
    return verifyToken(token);
  } catch {
    return undefined;
  }
}

function errorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction,
): void {
  const apiError =
    error instanceof ApiError
      ? error
      : error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "LIMIT_FILE_SIZE"
        ? new ApiError("invalid-argument", "The uploaded file is empty or too large.")
        : new ApiError("internal", "The request could not be completed.");
  if (!(error instanceof ApiError) && apiError.code === "internal") {
    console.error("API error", error);
  }
  response.status(HTTP_STATUS[apiError.code] ?? 500).json({
    error: {
      status: apiError.code,
      message: apiError.message,
      details: apiError.details ?? null,
    },
  });
}

app.use(errorHandler);

const execFileAsync = promisify(execFile);

async function runMigrations(): Promise<void> {
  const prismaBin = path.join(process.cwd(), "node_modules", ".bin", "prisma");
  console.log("boot: running prisma migrate deploy");
  const result = await execFileAsync(prismaBin, ["migrate", "deploy"], {
    env: process.env,
  });
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  console.log("boot: migrations complete");
}

async function ensureUploadRoot(): Promise<void> {
  const root = getUploadRoot();
  try {
    await Promise.race([
      mkdir(root, { recursive: true }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`mkdir timed out for ${root}`)), 8_000);
      }),
    ]);
    console.log(`boot: uploads directory ready at ${root}`);
  } catch (error) {
    console.error("boot: could not prepare uploads directory", error);
  }
}

async function start(): Promise<void> {
  console.log("boot: starting");
  getJwtSecret();
  const port = Number(process.env.PORT ?? 8080);
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, "0.0.0.0", () => {
      console.log(`Seneko Market API listening on 0.0.0.0:${port}`);
      resolve();
    });
    server.on("error", reject);
  });
  await ensureUploadRoot();
  try {
    await runMigrations();
    await getPlatformConfig("SN");
    console.log("boot: platform config ready");
    await bootstrapAdmin();
    console.log("boot: admin ready");
    startRentReminderScheduler();
    console.log("boot: rent reminder scheduler ready");
  } catch (error) {
    console.error("boot: database init failed", error);
  }
}

start().catch((error) => {
  console.error("Failed to start API", error);
  process.exit(1);
});
