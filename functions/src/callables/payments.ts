import {
  ApiError,
  asApiError,
  parseInput,
  requireAuth,
  requireCountry,
  type HandlerRequest,
} from "../errors.js";
import {
  createPaymentSchema,
  paymentIdSchema,
  submitSponsorshipSchema,
} from "../schemas.js";
import {
  env,
  getAllowedRedirectOrigins,
  getNabooPayDefaultCancelUrl,
  getNabooPayDefaultReturnUrl,
  getNabooPayFeesCustomerSide,
  getPublicApiUrl,
  getSenePayDefaultCancelUrl,
  getSenePayDefaultReturnUrl,
  getSenePayWebhookUrl,
} from "../config.js";
import { COUNTRY_PAYMENT_PROVIDER } from "../country.js";
import { prisma } from "../prisma.js";
import {
  assertShopOwner,
  getPlatformConfig,
  serializeProfile,
  type SponsorOption,
} from "../data.js";
import {
  appendQuery,
  normalizeNabooPayStatus,
  normalizeSenePayStatus,
  parseAllowedOrigins,
  parseXofAmount,
  resolveRedirectUrl,
  sha256Hex,
  toInternationalPhone,
} from "../payments/helpers.js";
import { createTransaction, getTransaction, NabooPayError } from "../payments/naboopay.js";
import {
  createCheckoutSession,
  getCheckoutSession,
  SenePayError,
} from "../payments/senepay.js";
import {
  applyVerifiedPayment,
  serializePayment,
} from "../payments/fulfillment.js";

function fromUnknown(error: unknown): ApiError {
  if (error instanceof NabooPayError || error instanceof SenePayError) {
    if (error.status === 429) {
      return new ApiError(
        "resource-exhausted",
        "Too many payment attempts. Please retry shortly.",
      );
    }
    return new ApiError("unavailable", error.message);
  }
  return asApiError(error);
}

function requestHash(input: {
  shopId: string;
  purpose: string;
  paymentMethod: string;
  amount: number;
  sponsorOption?: string;
  bannerImages: string[];
}): string {
  return sha256Hex(
    JSON.stringify({
      shopId: input.shopId,
      purpose: input.purpose,
      paymentMethod: input.paymentMethod,
      amount: input.amount,
      sponsorOption: input.sponsorOption ?? null,
      bannerImages: input.bannerImages,
    }),
  );
}

export async function createPayment(request: HandlerRequest) {
  try {
    const auth = requireAuth(request);
    const countryCode = requireCountry(request);
    const provider = COUNTRY_PAYMENT_PROVIDER[countryCode];
    const input = parseInput(createPaymentSchema, request.data);
    const bannerImages = input.bannerImages.filter(
      (url): url is string => typeof url === "string" && url.length > 0,
    );
    if (input.purpose === "sponsor" && bannerImages.length < 1) {
      throw new ApiError(
        "invalid-argument",
        "At least one sponsorship banner is required.",
      );
    }

    const [shop, config, user] = await Promise.all([
      assertShopOwner(auth.uid, input.shopId),
      getPlatformConfig(countryCode),
      prisma.user.findUnique({ where: { id: auth.uid } }),
    ]);
    if (shop.countryCode !== countryCode) {
      throw new ApiError("not-found", "Shop not found.");
    }
    const profile = serializeProfile(user);
    const demoRentAmount = (() => {
      const raw = Number(env("DEMO_RENT_AMOUNT", "10"));
      return Number.isInteger(raw) && raw >= 10 ? raw : 10;
    })();
    const amount =
      input.purpose === "rent"
        ? input.demoMode
          ? demoRentAmount
          : config.rentAmount
        : config.sponsorPrices[input.sponsorOption as SponsorOption];
    const durationDays =
      input.purpose === "sponsor"
        ? config.sponsorDurations[input.sponsorOption as SponsorOption]
        : config.rentDurationDays;
    const hash = requestHash({
      shopId: input.shopId,
      purpose: input.purpose,
      paymentMethod: input.paymentMethod,
      amount,
      sponsorOption: input.sponsorOption,
      bannerImages,
    });

    const origins = parseAllowedOrigins(getAllowedRedirectOrigins());
    const defaultReturn =
      provider === "senepay"
        ? getSenePayDefaultReturnUrl() || getNabooPayDefaultReturnUrl()
        : getNabooPayDefaultReturnUrl();
    const defaultCancel =
      provider === "senepay"
        ? getSenePayDefaultCancelUrl() || getNabooPayDefaultCancelUrl()
        : getNabooPayDefaultCancelUrl();
    let successUrl: string;
    let errorUrl: string;
    try {
      successUrl = resolveRedirectUrl(input.returnUrl, defaultReturn, origins);
      errorUrl = resolveRedirectUrl(input.cancelUrl, defaultCancel, origins);
    } catch (error) {
      throw new ApiError(
        "invalid-argument",
        error instanceof Error ? error.message : "Invalid redirect URL.",
      );
    }

    const phoneSource =
      input.payerPhone || shop.phone || (typeof profile?.phone === "string" ? profile.phone : "");
    let phone: string;
    try {
      phone = toInternationalPhone(String(phoneSource), countryCode);
    } catch {
      throw new ApiError(
        "invalid-argument",
        `Un numéro de téléphone valide est requis pour ${countryCode}.`,
      );
    }

    const payment = await prisma.$transaction(async (tx) => {
      const existing = await tx.payment.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        if (existing.ownerId !== auth.uid) {
          throw new ApiError(
            "permission-denied",
            "This payment key belongs to another account.",
          );
        }
        if (existing.requestHash !== hash) {
          throw new ApiError(
            "already-exists",
            "This payment key was already used with different details.",
          );
        }
        return existing;
      }
      return tx.payment.create({
        data: {
          ownerId: auth.uid,
          shopId: input.shopId,
          purpose: input.purpose,
          paymentMethod: input.paymentMethod,
          amount,
          currency: config.currency,
          status: "pending",
          sponsorOption: input.sponsorOption ?? null,
          durationDays,
          bannerImages,
          provider,
          idempotencyKey: input.idempotencyKey,
          requestHash: hash,
        },
      });
    });

    if (payment.checkoutUrl) {
      return serializePayment(payment);
    }

    successUrl = appendQuery(successUrl, {
      payment_return: "success",
      paymentId: payment.id,
    });
    errorUrl = appendQuery(errorUrl, {
      payment_return: "cancel",
      paymentId: payment.id,
    });

    const productName =
      input.purpose === "rent"
        ? input.demoMode
          ? `Loyer Seneko Market (Démo ${amount} F)`
          : "Loyer Seneko Market"
        : `Sponsoring Seneko Market (${input.sponsorOption})`;
    const productDescription = `${input.purpose}:${payment.id}:${input.shopId}${input.demoMode ? ":demo" : ""}`;

    if (provider === "senepay") {
      const webhookUrl =
        getSenePayWebhookUrl() || `${getPublicApiUrl()}/webhooks/senepay`;
      const checkout = await createCheckoutSession({
        amount,
        currency: config.currency,
        country: countryCode,
        orderReference: payment.id,
        description: productName,
        returnUrl: successUrl,
        cancelUrl: errorUrl,
        webhookUrl,
        metadata: {
          paymentId: payment.id,
          shopId: input.shopId,
          purpose: input.purpose,
          phone,
        },
      });
      const updated = await prisma.payment.update({
        where: { id: payment.id },
        data: {
          providerOrderId: checkout.sessionToken,
          checkoutUrl: checkout.checkoutUrl,
        },
      });
      return serializePayment(updated);
    }

    const checkout = await createTransaction({
      methodOfPayment:
        input.paymentMethod === "card"
          ? ["wave", "orange_money", "bank"]
          : ["wave", "orange_money"],
      productName,
      productDescription,
      amount,
      firstName:
        typeof profile?.firstname === "string" && profile.firstname
          ? profile.firstname
          : "Commercant",
      lastName:
        typeof profile?.lastname === "string" && profile.lastname
          ? profile.lastname
          : "Seneko",
      phone,
      successUrl,
      errorUrl,
      feesCustomerSide: getNabooPayFeesCustomerSide(),
    });

    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        providerOrderId: checkout.orderId,
        checkoutUrl: checkout.checkoutUrl,
      },
    });
    return serializePayment(updated);
  } catch (error) {
    throw fromUnknown(error);
  }
}

export async function getPaymentStatus(request: HandlerRequest) {
  try {
    const auth = requireAuth(request);
    const { paymentId } = parseInput(paymentIdSchema, request.data);
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) {
      throw new ApiError("not-found", "Payment not found.");
    }
    if (payment.ownerId !== auth.uid && auth.role !== "admin") {
      throw new ApiError("permission-denied", "You cannot view this payment.");
    }

    if (payment.status === "pending" && payment.providerOrderId) {
      if (payment.provider === "senepay") {
        const remote = await getCheckoutSession(payment.providerOrderId);
        const status = normalizeSenePayStatus(remote.status);
        const amount = parseXofAmount(remote.amount ?? payment.amount);
        if (amount !== payment.amount) {
          throw new ApiError(
            "failed-precondition",
            "Payment amount does not match the provider record.",
          );
        }
        const applied = await applyVerifiedPayment(paymentId, status);
        return serializePayment(applied);
      }

      const remote = await getTransaction(payment.providerOrderId);
      const status = normalizeNabooPayStatus(remote.transaction_status);
      const amount = parseXofAmount(remote.amount ?? payment.amount);
      if (amount !== payment.amount) {
        throw new ApiError(
          "failed-precondition",
          "Payment amount does not match the provider record.",
        );
      }
      const applied = await applyVerifiedPayment(paymentId, status);
      return serializePayment(applied);
    }

    return serializePayment(payment);
  } catch (error) {
    throw fromUnknown(error);
  }
}

export async function submitSponsorship(request: HandlerRequest) {
  try {
    const auth = requireAuth(request);
    const input = parseInput(submitSponsorshipSchema, request.data);
    await assertShopOwner(auth.uid, input.shopId);
    const payment = await prisma.payment.findUnique({
      where: { id: input.paymentId },
    });
    if (!payment || payment.ownerId !== auth.uid) {
      throw new ApiError("not-found", "Payment not found.");
    }
    if (payment.purpose !== "sponsor") {
      throw new ApiError(
        "failed-precondition",
        "This payment is not a sponsorship.",
      );
    }
    if (payment.status !== "completed") {
      throw new ApiError(
        "failed-precondition",
        "Sponsorship can be updated only after payment is completed.",
      );
    }
    if (input.bannerImages) {
      await prisma.$transaction([
        prisma.payment.update({
          where: { id: payment.id },
          data: { bannerImages: input.bannerImages },
        }),
        prisma.sponsorship.updateMany({
          where: { paymentId: payment.id },
          data: { bannerImages: input.bannerImages },
        }),
        prisma.shop.update({
          where: { id: input.shopId },
          data: { bannerImage: input.bannerImages[0] },
        }),
      ]);
    }
    const updated = await prisma.payment.findUnique({ where: { id: payment.id } });
    if (!updated) throw new ApiError("not-found", "Payment not found.");
    return serializePayment(updated);
  } catch (error) {
    throw asApiError(error);
  }
}
