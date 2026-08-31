import { isRentCurrentlyPaid, syncShopVisibility } from "../data.js";
import {
  sendWhatsAppNotification,
  shopContactPhone,
  WHATSAPP_MESSAGES,
} from "../notifications/whatsapp.js";
import { prisma } from "../prisma.js";

export const RENT_REMINDER_MESSAGE = WHATSAPP_MESSAGES.rentHidden;

function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function wasReminderSentThisMonth(shopId: string, now: Date): Promise<boolean> {
  const day = monthStartUtc(now);
  const event = await prisma.shopEvent.findFirst({
    where: { shopId, type: "rent_reminder", day },
  });
  return Boolean(event);
}

async function markReminderSent(shopId: string, now: Date): Promise<void> {
  const day = monthStartUtc(now);
  await prisma.shopEvent.upsert({
    where: {
      shopId_type_day: { shopId, type: "rent_reminder", day },
    },
    create: { shopId, type: "rent_reminder", day, count: 1 },
    update: { count: { increment: 1 } },
  });
}

export async function runRentReminderJob(now = new Date()): Promise<{
  skipped?: boolean;
  reason?: string;
  hidden: number;
  reminded: number;
  alreadySent: number;
}> {
  if (now.getUTCDate() < 10) {
    return { skipped: true, reason: "before_day_10", hidden: 0, reminded: 0, alreadySent: 0 };
  }

  await syncShopVisibility(now);

  const shops = await prisma.shop.findMany({
    where: { deletedAt: null, approved: true },
    select: {
      id: true,
      phone: true,
      whatsapp: true,
      rentPaid: true,
      rentPaidUntil: true,
      visible: true,
    },
  });

  let hidden = 0;
  let reminded = 0;
  let alreadySent = 0;

  for (const shop of shops) {
    if (isRentCurrentlyPaid(shop, now)) continue;

    if (!shop.visible) hidden += 1;

    if (await wasReminderSentThisMonth(shop.id, now)) {
      alreadySent += 1;
      continue;
    }

    const phone = shopContactPhone(shop);
    if (!phone) continue;

    const sent = await sendWhatsAppNotification(phone, RENT_REMINDER_MESSAGE);
    await markReminderSent(shop.id, now);
    if (sent) reminded += 1;
  }

  console.log("rent-reminder: job complete", { hidden, reminded, alreadySent });
  return { hidden, reminded, alreadySent };
}

let lastRunKey = "";

export function startRentReminderScheduler(): void {
  const tick = () => {
    const now = new Date();
    const runKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;
    if (now.getUTCDate() < 10 || runKey === lastRunKey) return;
    lastRunKey = runKey;
    void runRentReminderJob(now).catch((error) => {
      console.error("rent-reminder: scheduled run failed", error);
      lastRunKey = "";
    });
  };

  tick();
  setInterval(tick, 60 * 60 * 1000);
}
