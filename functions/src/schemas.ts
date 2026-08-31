import { z } from "zod";

const trimmed = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine(
      (value) => !/[<>\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value),
      "HTML-significant or control characters are not allowed",
    );

const assetUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => !/[<>`\u0000-\u001F\u007F]/.test(value), "Unsafe URL")
  .refine((value) => {
    if (value.startsWith("/uploads/") && !value.includes("..")) return true;
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" ||
        (url.protocol === "http:" &&
          (url.hostname === "127.0.0.1" || url.hostname === "localhost"))
      );
    } catch {
      return false;
    }
  }, "A valid image URL is required");

const optionalUrl = assetUrl.optional().nullable();

const phone = trimmed(5, 32).regex(
  /^[+0-9][0-9 +().-]*$/,
  "Invalid phone number",
);

export const emptySchema = z.object({}).strict();

export const registerSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(8).max(200),
    firstname: trimmed(1, 80).optional(),
    lastname: trimmed(1, 80).optional(),
    phone: phone.optional(),
  })
  .strict();

export const loginSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(200),
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(8).max(200),
    confirmPassword: z.string().min(8).max(200),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.newPassword !== value.confirmPassword) {
      context.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "Les mots de passe ne correspondent pas.",
      });
    }
  });

export const bootstrapPublicSchema = z
  .object({
    shopId: z.string().trim().min(1).max(128).optional(),
    category: z.string().trim().min(1).max(100).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

export const publicShopSchema = z
  .object({ shopId: z.string().trim().min(1).max(128) })
  .strict();

export const shopEventSchema = z
  .object({
    shopId: z.string().trim().min(1).max(128),
    type: z.enum(["visit", "contact"]),
  })
  .strict();

export const merchantProfileSchema = z
  .object({
    firstname: trimmed(1, 80),
    lastname: trimmed(1, 80),
    phone,
    shop: z
      .object({
        name: trimmed(2, 120),
        category: trimmed(1, 100),
        description: trimmed(1, 1000).default(
          "Nouvelle boutique sur Seneko Market. En attente de validation.",
        ),
        phone,
        email: z.string().trim().email().max(254).optional(),
        whatsapp: phone.optional(),
        facade: optionalUrl,
        logo: optionalUrl.or(trimmed(1, 8)).optional().nullable(),
        icon: z.string().trim().max(80).regex(/^fa-[a-z0-9-]+$/).optional(),
        idCardPath: trimmed(1, 1024),
        openingFor: z.enum(["myself", "third"]).default("myself"),
        agentCode: trimmed(2, 32).optional().nullable(),
      })
      .strict(),
  })
  .strict();

export const updateShopSchema = z
  .object({
    shopId: z.string().trim().min(1).max(128),
    name: trimmed(2, 120).optional(),
    category: trimmed(1, 100).optional(),
    description: trimmed(1, 1000).optional(),
    phone: phone.optional(),
    email: z.string().trim().email().max(254).optional().nullable(),
    whatsapp: phone.optional(),
    facade: optionalUrl,
    logo: optionalUrl.or(trimmed(1, 8)).optional().nullable(),
    icon: z.string().trim().max(80).regex(/^fa-[a-z0-9-]+$/).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== "shopId"),
    "At least one field must be changed",
  );

export const shopIdSchema = z
  .object({ shopId: z.string().trim().min(1).max(128) })
  .strict();

export const upsertProductSchema = z
  .object({
    shopId: z.string().trim().min(1).max(128),
    productId: z.string().trim().min(1).max(128).optional(),
    name: trimmed(1, 160),
    price: z.number().int().min(0).max(2_000_000_000),
    description: trimmed(1, 2000),
    category: trimmed(1, 100).optional(),
    images: z.array(assetUrl).min(1).max(10),
  })
  .strict();

export const deleteProductSchema = z
  .object({
    shopId: z.string().trim().min(1).max(128),
    productId: z.string().trim().min(1).max(128),
  })
  .strict();

export const sponsorOptionSchema = z.enum([
  "7days",
  "15days",
  "30days",
  "60days",
]);

const redirectUrl = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((value) => !/[<>`"\u0000-\u001F\u007F]/.test(value), "Unsafe URL")
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        (url.hostname === "localhost" || url.hostname === "127.0.0.1"))
    );
  }, "Redirect URL must use HTTPS (or localhost HTTP)");

export const createPaymentSchema = z
  .object({
    shopId: z.string().trim().min(1).max(128),
    purpose: z.enum(["rent", "sponsor"]),
    paymentMethod: z.enum(["orange", "wave", "card"]),
    payerPhone: phone.optional(),
    sponsorOption: sponsorOptionSchema.optional(),
    bannerImages: z.array(assetUrl).max(5).default([]),
    demoMode: z.boolean().optional().default(false),
    returnUrl: redirectUrl.optional(),
    cancelUrl: redirectUrl.optional(),
    idempotencyKey: z
      .string()
      .trim()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.purpose === "sponsor" && !value.sponsorOption) {
      context.addIssue({
        code: "custom",
        path: ["sponsorOption"],
        message: "sponsorOption is required for sponsorship payments",
      });
    }
    if (value.purpose === "rent" && value.sponsorOption) {
      context.addIssue({
        code: "custom",
        path: ["sponsorOption"],
        message: "sponsorOption is only valid for sponsorship payments",
      });
    }
    if (value.purpose === "sponsor" && value.bannerImages.length < 1) {
      context.addIssue({
        code: "custom",
        path: ["bannerImages"],
        message: "At least one sponsorship banner is required",
      });
    }
    if (value.demoMode && value.purpose !== "rent") {
      context.addIssue({
        code: "custom",
        path: ["demoMode"],
        message: "demoMode is only valid for rent payments",
      });
    }
  });

export const paymentIdSchema = z
  .object({ paymentId: z.string().trim().min(1).max(128) })
  .strict();

export const submitSponsorshipSchema = z
  .object({
    shopId: z.string().trim().min(1).max(128),
    paymentId: z.string().trim().min(1).max(128),
    bannerImages: z.array(assetUrl).min(1).max(5).optional(),
  })
  .strict();

export const adminListSchema = z
  .object({
    limit: z.number().int().min(1).max(250).default(50),
    cursor: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

export const adminShopStatusSchema = z
  .object({
    shopId: z.string().trim().min(1).max(128),
    decision: z.enum(["approved", "rejected"]).optional(),
    visible: z.boolean().optional(),
    sponsored: z.boolean().optional(),
    sponsorEndDate: z.string().datetime().optional().nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.decision !== undefined ||
      value.visible !== undefined ||
      value.sponsored !== undefined ||
      value.sponsorEndDate !== undefined,
    "At least one administrative status field is required",
  );

export const sponsorPricesSchema = z
  .object({
    "7days": z.number().int().min(100).max(100_000_000),
    "15days": z.number().int().min(100).max(100_000_000),
    "30days": z.number().int().min(100).max(100_000_000),
    "60days": z.number().int().min(100).max(100_000_000),
  })
  .strict();

export const adminRentConfigSchema = z
  .object({
    rentAmount: z.number().int().min(100).max(100_000_000),
    rentDurationDays: z.number().int().min(1).max(366).default(30),
    sponsorPrices: sponsorPricesSchema.optional(),
  })
  .strict();

export const adminMarkRentSchema = z
  .object({
    shopId: z.string().trim().min(1).max(128),
    paid: z.boolean(),
    paidUntil: z.string().datetime().optional(),
  })
  .strict();

export const adminUserIdSchema = z
  .object({ userId: z.string().trim().min(1).max(128) })
  .strict();

export const adminProductIdSchema = z
  .object({ productId: z.string().trim().min(1).max(128) })
  .strict();

export const adminVerifyIdentitySchema = z
  .object({
    shopId: z.string().trim().min(1).max(128),
    verified: z.boolean(),
  })
  .strict();

export const adminAgentSchema = z
  .object({
    agentId: z.string().trim().min(1).max(128).optional(),
    name: trimmed(2, 120),
    phone,
    code: z.string().trim().min(2).max(32).regex(/^[A-Za-z0-9_-]+$/),
    commission: z.number().min(0).max(100),
    active: z.boolean().default(true),
  })
  .strict();

export const adminAgentIdSchema = z
  .object({ agentId: z.string().trim().min(1).max(128) })
  .strict();

export const adminBannerSchema = z
  .object({
    bannerId: z.string().trim().min(1).max(128).optional(),
    title: trimmed(1, 160),
    subtitle: z.string().trim().max(300).default(""),
    image: optionalUrl,
    link: optionalUrl,
    position: z.number().int().min(0).max(10_000).default(0),
    active: z.boolean().default(true),
    startsAt: z.string().datetime().optional().nullable(),
    endsAt: z.string().datetime().optional().nullable(),
  })
  .strict();

export const adminBannerIdSchema = z
  .object({ bannerId: z.string().trim().min(1).max(128) })
  .strict();

export const adminBrandingSchema = z
  .object({
    platformLogo: optionalUrl,
    contactPhone: z.string().trim().max(40).optional(),
    contactEmail: z
      .union([z.literal(""), z.string().trim().email().max(160)])
      .optional(),
    contactAddress: z.string().trim().max(300).optional(),
    socialFacebook: z.union([z.literal(""), z.string().trim().url().max(500)]).optional(),
    socialInstagram: z.union([z.literal(""), z.string().trim().url().max(500)]).optional(),
    socialTwitter: z.union([z.literal(""), z.string().trim().url().max(500)]).optional(),
    socialWhatsapp: z.union([z.literal(""), z.string().trim().url().max(500)]).optional(),
    socialTiktok: z.union([z.literal(""), z.string().trim().url().max(500)]).optional(),
  })
  .strict();

export const adminListProductsSchema = z
  .object({
    status: z.enum(["pending", "approved", "rejected"]).optional(),
    limit: z.number().int().min(1).max(250).default(50),
    cursor: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

export const adminProductStatusSchema = z
  .object({
    productId: z.string().trim().min(1).max(128),
    decision: z.enum(["approved", "rejected"]),
    rejectionReason: trimmed(1, 500).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision === "rejected" && !value.rejectionReason) {
      context.addIssue({
        code: "custom",
        path: ["rejectionReason"],
        message: "A rejection reason is required.",
      });
    }
  });

export const adminCategoryBannerSchema = z
  .object({
    bannerId: z.string().trim().min(1).max(128).optional(),
    categoryName: trimmed(1, 120),
    description: z.string().trim().max(500).default(""),
    image: optionalUrl,
    link: optionalUrl,
    price: z.number().int().min(0).max(100_000_000).default(0),
    active: z.boolean().default(true),
    position: z.number().int().min(0).max(10_000).default(0),
  })
  .strict();

export const adminCategoryBannerIdSchema = z
  .object({ bannerId: z.string().trim().min(1).max(128) })
  .strict();

export const adminReviewSellerSchema = z
  .object({
    shopId: z.string().trim().min(1).max(128),
    decision: z.enum(["approved", "rejected"]),
    rejectionReason: trimmed(1, 500).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision === "rejected" && !value.rejectionReason) {
      context.addIssue({
        code: "custom",
        path: ["rejectionReason"],
        message: "A rejection reason is required.",
      });
    }
  });

export function validateIdentityPath(uid: string, path: string): boolean {
  const expectedPrefix = `identity/${uid}/`;
  return (
    path.startsWith(expectedPrefix) &&
    path.length > expectedPrefix.length &&
    !path.includes("..") &&
    !path.includes("//")
  );
}
