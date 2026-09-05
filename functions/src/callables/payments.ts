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
  getPaymentProviderMinAmount,
  getPublicApiUrl,
  getSenePayDefaultCancelUrl,
  getSenePayDefaultReturnUrl,
  getSenePayWebhookUrl,
} from "../config.js";
import { COUNTRY_CURRENCY, COUNTRY_PAYMENT_PROVIDER } from "../country.js";
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
  getDirectPaymentStatus,
  initiateDirectPayment,
  mapUiMethodToSenePayOperator,
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
    const seneCode = error instanceof SenePayError ? error.code : null;
    const detail = seneCode
      ? `${error.message} (${seneCode})`
      : error.message;
    // Client-facing validation / operator refusals should not look like outages.
    if (
      error.status === 400 ||
      seneCode === "payment_failed" ||
      seneCode === "missing_credentials"
    ) {
      return new ApiError(
        seneCode === "missing_credentials" ? "failed-precondition" : "invalid-argument",
        detail || "Payment provider rejected the request.",
      );
    }
    return new ApiError("unavailable", detail || "Payment provider unavailable.");
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
    const providerMinAmount = getPaymentProviderMinAmount();
    const demoRentAmount = (() => {
      const raw = Number(env("DEMO_RENT_AMOUNT", "10"));
      return Number.isInteger(raw) && raw >= 1 ? raw : 10;
    })();
    // Demo mode and rents below the provider minimum must never call NabooPay/SenePay.
    const useInstantCheckout =
      Boolean(input.demoMode) ||
      (input.purpose === "rent" && config.rentAmount < providerMinAmount);
    const amount =
      input.purpose === "rent"
        ? input.demoMode
          ? demoRentAmount
          : config.rentAmount
        : config.sponsorPrices[input.sponsorOption as SponsorOption];
    const shouldSkipProvider =
      useInstantCheckout || amount < providerMinAmount;
    const currency = COUNTRY_CURRENCY[countryCode];
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
      if (!shouldSkipProvider) {
        throw new ApiError(
          "invalid-argument",
          error instanceof Error ? error.message : "Invalid redirect URL.",
        );
      }
      // Instant checkout does not redirect to a PSP; keep a best-effort return URL.
      successUrl = input.returnUrl?.trim() || defaultReturn || "https://seneko-market-sengal.netlify.app/?payment_return=success";
      errorUrl = input.cancelUrl?.trim() || defaultCancel || successUrl;
    }

    const phoneSource =
      input.payerPhone || shop.phone || (typeof profile?.phone === "string" ? profile.phone : "");
    let phone = "";
    if (!shouldSkipProvider) {
      try {
        phone = toInternationalPhone(String(phoneSource), countryCode);
      } catch (error) {
        throw new ApiError(
          "invalid-argument",
          error instanceof Error
            ? error.message
            : `Un numéro de téléphone valide est requis pour ${countryCode}.`,
        );
      }
    } else if (phoneSource) {
      try {
        phone = toInternationalPhone(String(phoneSource), countryCode);
      } catch {
        phone = String(phoneSource);
      }
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
          currency,
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

    async function completeInstantPayment() {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          providerOrderId: `instant:${payment.id}`,
          checkoutUrl: successUrl,
        },
      });
      const completed = await applyVerifiedPayment(payment.id, "completed");
      return serializePayment(completed);
    }

    if (shouldSkipProvider) {
      return completeInstantPayment();
    }

    const productName =
      input.purpose === "rent"
        ? input.demoMode
          ? `Loyer Seneko Market (Démo ${amount} F)`
          : "Loyer Seneko Market"
        : `Sponsoring Seneko Market (${input.sponsorOption})`;
    const productDescription = `${input.purpose}:${payment.id}:${input.shopId}${input.demoMode ? ":demo" : ""}`;

    try {
      if (provider === "senepay") {
        const webhookUrl =
          getSenePayWebhookUrl() || `${getPublicApiUrl()}/webhooks/senepay`;

        const directOperators: Record<string, string[]> = {
          TG: ["tmoney"],
          CD: ["mpesa", "airtel", "orange"],
          BJ: ["moov", "mtn"],
        };
        const allowedOperators = directOperators[countryCode];
        if (allowedOperators) {
          const operator = mapUiMethodToSenePayOperator(input.paymentMethod);
          if (!allowedOperators.includes(operator)) {
            throw new ApiError(
              "invalid-argument",
              countryCode === "TG"
                ? "Sur la plateforme Togo, seul T-Money est accepté."
                : `Moyen de paiement non supporté pour ${countryCode}.`,
            );
          }
          const customerName = [
            typeof profile?.firstname === "string" ? profile.firstname : "",
            typeof profile?.lastname === "string" ? profile.lastname : "",
          ]
            .join(" ")
            .trim();
          const direct = await initiateDirectPayment({
            amount,
            currency,
            country: countryCode,
            operator,
            customerPhone: phone,
            orderId: payment.id,
            customerName: customerName || "Commercant Seneko",
            returnUrl: successUrl,
            cancelUrl: errorUrl,
            webhookUrl,
            metadata: {
              paymentId: payment.id,
              shopId: input.shopId,
              purpose: input.purpose,
            },
          });
          const updated = await prisma.payment.update({
            where: { id: payment.id },
            data: {
              providerOrderId: `direct:${direct.token}`,
              checkoutUrl: direct.redirectUrl,
            },
          });
          const nextAction =
            direct.redirectUrl
              ? "redirect"
              : String(direct.nextAction || "").toUpperCase().includes("REDIRECT")
                ? "redirect"
                : "ussd_push";
          return serializePayment(updated, {
            nextAction,
            providerStatus: direct.status,
          });
        }

        const checkout = await createCheckoutSession({
          amount,
          currency,
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
            : input.paymentMethod === "orange"
              ? ["orange_money"]
              : input.paymentMethod === "wave"
                ? ["wave"]
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
    } catch (providerError) {
      // Provider APIs often reject small amounts; fall back to instant fulfillment.
      if (amount < providerMinAmount || input.demoMode) {
        console.warn(
          "payment-provider: falling back to instant checkout",
          { amount, providerMinAmount, demoMode: input.demoMode, providerError },
        );
        return completeInstantPayment();
      }
      throw providerError;
    }
  } catch (error) {
    throw fromUnknown(error);
  }
}

export async function getPaymentStatus(request: HandlerRequest) {
  try {
    const auth = requireAuth(request);
    const countryCode = requireCountry(request);
    const { paymentId } = parseInput(paymentIdSchema, request.data);
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { shop: true },
    });
    if (!payment || payment.shop.countryCode !== countryCode) {
      throw new ApiError("not-found", "Payment not found.");
    }
    if (payment.ownerId !== auth.uid && auth.role !== "admin") {
      throw new ApiError("permission-denied", "You cannot view this payment.");
    }

    if (payment.status === "pending" && payment.providerOrderId) {
      if (payment.providerOrderId.startsWith("instant:")) {
        const completed = await applyVerifiedPayment(paymentId, "completed");
        return serializePayment(completed);
      }
      if (payment.provider === "senepay") {
        if (payment.providerOrderId.startsWith("direct:")) {
          const token = payment.providerOrderId.slice("direct:".length);
          const remote = await getDirectPaymentStatus(token);
          const remoteStatus =
            typeof remote.status === "string"
              ? remote.status
              : typeof remote.paymentStatus === "string"
                ? remote.paymentStatus
                : "Processing";
          const status = normalizeSenePayStatus(remoteStatus);
          const amount = parseXofAmount(remote.amount ?? payment.amount);
          if (amount !== payment.amount) {
            throw new ApiError(
              "failed-precondition",
              "Payment amount does not match the provider record.",
            );
          }
          const applied = await applyVerifiedPayment(paymentId, status);
          return serializePayment(applied, {
            nextAction: status === "pending" ? "ussd_push" : null,
          });
        }
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
    const countryCode = requireCountry(request);
    const input = parseInput(submitSponsorshipSchema, request.data);
    await assertShopOwner(auth.uid, input.shopId, countryCode);
    const payment = await prisma.payment.findUnique({
      where: { id: input.paymentId },
      include: { shop: true },
    });
    if (!payment || payment.ownerId !== auth.uid || payment.shop.countryCode !== countryCode) {
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
