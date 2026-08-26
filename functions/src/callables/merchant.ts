import { ApiError, asApiError, parseInput, requireAuth, requireCountry, type HandlerRequest } from "../errors.js";
import {
  deleteProductSchema,
  emptySchema,
  merchantProfileSchema,
  shopIdSchema,
  updateShopSchema,
  upsertProductSchema,
  validateIdentityPath,
} from "../schemas.js";
import { prisma } from "../prisma.js";
import {
  assertShopOwner,
  getPrivateShopById,
  merchantProduct,
  normalizeShopName,
  normalizeWhatsApp,
  serializeProfileWithShop,
  syncShopVisibility,
} from "../data.js";
import { toPublicAssetUrl } from "../uploads.js";

async function validateAgentCode(
  agentCode: string | null | undefined,
  countryCode: string,
): Promise<void> {
  if (!agentCode) return;
  const agent = await prisma.agent.findUnique({
    where: {
      countryCode_code: {
        countryCode,
        code: agentCode.toUpperCase(),
      },
    },
  });
  if (!agent?.active) {
    throw new ApiError("invalid-argument", "The commercial agent code is invalid or inactive.");
  }
}

export async function completeMerchantProfile(request: HandlerRequest) {
  try {
    const auth = requireAuth(request);
    const countryCode = requireCountry(request);
    const input = parseInput(merchantProfileSchema, request.data);
    if (!validateIdentityPath(auth.uid, input.shop.idCardPath)) {
      throw new ApiError(
        "invalid-argument",
        `idCardPath must be inside identity/${auth.uid}/.`,
      );
    }
    await validateAgentCode(input.shop.agentCode, countryCode);

    const existing = await prisma.shop.findUnique({ where: { ownerId: auth.uid } });
    if (existing && !existing.deletedAt) {
      return {
        profile: await serializeProfileWithShop(auth.uid, existing),
        shop: await getPrivateShopById(existing.id),
      };
    }

    const normalizedName = normalizeShopName(input.shop.name);
    if (!normalizedName) {
      throw new ApiError("invalid-argument", "The shop name is invalid.");
    }

    const shopData = {
      name: input.shop.name,
      nameNormalized: normalizedName,
      category: input.shop.category,
      description: input.shop.description,
      phone: input.shop.phone,
      whatsapp: input.shop.whatsapp ?? normalizeWhatsApp(input.shop.phone, countryCode),
      email: input.shop.email ?? auth.email,
      logo: input.shop.logo ?? input.shop.name.charAt(0).toUpperCase(),
      icon: input.shop.icon ?? "fa-store",
      facade: input.shop.facade ?? null,
      idCardPath: input.shop.idCardPath,
      openingFor: input.shop.openingFor,
      agentCode: input.shop.agentCode?.toUpperCase() ?? null,
      countryCode,
      deletedAt: null,
      approvalStatus: "pending",
      approved: false,
      visible: false,
    };

    const shop = await prisma.$transaction(async (tx) => {
      const taken = await tx.shop.findUnique({
        where: {
          countryCode_nameNormalized: {
            countryCode,
            nameNormalized: normalizedName,
          },
        },
      });
      if (taken && taken.ownerId !== auth.uid && !taken.deletedAt) {
        throw new ApiError("already-exists", "This shop name is already in use.");
      }
      const saved = existing
        ? await tx.shop.update({
            where: { id: existing.id },
            data: shopData,
          })
        : await tx.shop.create({
            data: { ownerId: auth.uid, ...shopData },
          });
      await tx.user.update({
        where: { id: auth.uid },
        data: {
          firstname: input.firstname,
          lastname: input.lastname,
          phone: input.phone,
          onboardingCompleted: true,
        },
      });
      return saved;
    });
    return {
      profile: await serializeProfileWithShop(auth.uid, shop),
      shop: await getPrivateShopById(shop.id),
    };
  } catch (error) {
    throw asApiError(error);
  }
}

export async function getMyAccount(request: HandlerRequest) {
  try {
    const auth = requireAuth(request);
    parseInput(emptySchema, request.data);
    await syncShopVisibility();
    const shop = await prisma.shop.findUnique({ where: { ownerId: auth.uid } });
    return {
      profile: await serializeProfileWithShop(auth.uid, shop),
      shop: shop ? await getPrivateShopById(shop.id) : null,
    };
  } catch (error) {
    throw asApiError(error);
  }
}

export async function updateMyShop(request: HandlerRequest) {
  try {
    const auth = requireAuth(request);
    const countryCode = requireCountry(request);
    const input = parseInput(updateShopSchema, request.data);
    const shop = await assertShopOwner(auth.uid, input.shopId);
    if (shop.countryCode !== countryCode) {
      throw new ApiError("not-found", "Shop not found.");
    }
    const data: Record<string, unknown> = {};
    for (const key of ["category", "description", "phone", "email", "whatsapp", "facade", "logo", "icon"] as const) {
      if (input[key] !== undefined) data[key] = input[key];
    }
    if (typeof data.facade === "string") data.facade = toPublicAssetUrl(data.facade);
    if (input.phone !== undefined && input.whatsapp === undefined) {
      data.whatsapp = normalizeWhatsApp(input.phone, countryCode);
    }
    if (input.name !== undefined && input.name !== shop.name) {
      const newNormalized = normalizeShopName(input.name);
      if (!newNormalized) throw new ApiError("invalid-argument", "The shop name is invalid.");
      const taken = await prisma.shop.findUnique({
        where: {
          countryCode_nameNormalized: {
            countryCode,
            nameNormalized: newNormalized,
          },
        },
      });
      if (taken && taken.id !== shop.id && !taken.deletedAt) {
        throw new ApiError("already-exists", "This shop name is already in use.");
      }
      data.name = input.name;
      data.nameNormalized = newNormalized;
      if (input.logo === undefined && shop.logo === shop.name.charAt(0)) {
        data.logo = input.name.charAt(0).toUpperCase();
      }
    }
    await prisma.shop.update({ where: { id: shop.id }, data });
    return { shop: await getPrivateShopById(shop.id) };
  } catch (error) {
    throw asApiError(error);
  }
}

export async function deleteMyShop(request: HandlerRequest) {
  try {
    const auth = requireAuth(request);
    const { shopId } = parseInput(shopIdSchema, request.data);
    const shop = await prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop || shop.deletedAt) return { deleted: true };
    if (shop.ownerId !== auth.uid) {
      throw new ApiError("permission-denied", "You do not own this shop.");
    }
    await prisma.$transaction([
      prisma.shop.update({
        where: { id: shopId },
        data: {
          visible: false,
          adminVisible: false,
          sponsored: false,
          deletedAt: new Date(),
          nameNormalized: `${shop.nameNormalized}-deleted-${shop.id.slice(-6)}`,
        },
      }),
      prisma.user.update({
        where: { id: auth.uid },
        data: { onboardingCompleted: false },
      }),
    ]);
    return { deleted: true };
  } catch (error) {
    throw asApiError(error);
  }
}

export async function upsertProduct(request: HandlerRequest) {
  try {
    const auth = requireAuth(request);
    const input = parseInput(upsertProductSchema, request.data);
    const shop = await assertShopOwner(auth.uid, input.shopId);
    const images = input.images.map((image) => toPublicAssetUrl(image));
    let product;
    if (input.productId) {
      const existingProduct = await prisma.product.findFirst({
        where: { id: input.productId, shopId: shop.id },
      });
      if (!existingProduct) {
        throw new ApiError("not-found", "Product not found.");
      }
      product = await prisma.product.update({
        where: { id: existingProduct.id },
        data: {
          name: input.name,
          price: input.price,
          description: input.description,
          category: input.category ?? shop.category,
          images,
          approvalStatus: "pending",
          rejectionReason: null,
          reviewedBy: null,
          reviewedAt: null,
        },
      });
    } else {
      product = await prisma.product.create({
        data: {
          shopId: shop.id,
          ownerId: auth.uid,
          name: input.name,
          price: input.price,
          description: input.description,
          category: input.category ?? shop.category,
          images,
          approvalStatus: "pending",
        },
      });
    }
    await prisma.shop.update({ where: { id: shop.id }, data: { updatedAt: new Date() } });
    return { product: merchantProduct(product) };
  } catch (error) {
    throw asApiError(error);
  }
}

export async function deleteProduct(request: HandlerRequest) {
  try {
    const auth = requireAuth(request);
    const input = parseInput(deleteProductSchema, request.data);
    await assertShopOwner(auth.uid, input.shopId);
    await prisma.product.deleteMany({
      where: { id: input.productId, shopId: input.shopId },
    });
    return { deleted: true };
  } catch (error) {
    throw asApiError(error);
  }
}
