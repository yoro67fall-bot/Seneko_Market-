import { env } from "../config.js";

export function normalizeWhatsAppPhone(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

export async function sendWhatsAppNotification(
  phone: string,
  message: string,
): Promise<boolean> {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return false;

  const webhookUrl = env("WHATSAPP_REMINDER_WEBHOOK_URL");
  if (!webhookUrl) {
    console.warn("whatsapp: WHATSAPP_REMINDER_WEBHOOK_URL not set; skipped send");
    return false;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: normalized, message }),
    });
    if (!response.ok) {
      console.error("whatsapp: webhook failed", response.status, await response.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error("whatsapp: webhook error", error);
    return false;
  }
}

export function shopContactPhone(shop: {
  phone: string;
  whatsapp: string;
}): string {
  return shop.whatsapp || shop.phone || "";
}

export const WHATSAPP_MESSAGES = {
  rentHidden:
    "Seneko Market - Votre boutique est masquée, merci de payer votre loyer pour l'afficher sur la Plateforme.",
  identityRejected: (reason: string) =>
    `Seneko Market - Votre pièce d'identité a été refusée. Motif: ${reason}. Merci de soumettre un nouveau document depuis votre tableau de bord.`,
  productRejected: (productName: string, reason: string) =>
    `Seneko Market - Votre produit "${productName}" a été refusé. Motif: ${reason}.`,
};
