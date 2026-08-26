export const PLATFORM_COUNTRIES = ["SN", "BJ", "TG", "CD"] as const;

export type PlatformCountry = (typeof PLATFORM_COUNTRIES)[number];

export const COUNTRY_CURRENCY: Record<PlatformCountry, "XOF" | "CDF"> = {
  SN: "XOF",
  BJ: "XOF",
  TG: "XOF",
  CD: "CDF",
};

export const COUNTRY_PAYMENT_PROVIDER: Record<
  PlatformCountry,
  "naboopay" | "senepay"
> = {
  SN: "naboopay",
  BJ: "senepay",
  TG: "senepay",
  CD: "senepay",
};

export const COUNTRY_PHONE_DIAL: Record<PlatformCountry, string> = {
  SN: "221",
  BJ: "229",
  TG: "228",
  CD: "243",
};

export const DEFAULT_COUNTRY: PlatformCountry = "SN";

export function isPlatformCountry(value: string): value is PlatformCountry {
  return (PLATFORM_COUNTRIES as readonly string[]).includes(value);
}

export function parsePlatformCountry(
  value: string | undefined | null,
): PlatformCountry {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (isPlatformCountry(normalized)) return normalized;
  return DEFAULT_COUNTRY;
}
