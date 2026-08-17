import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getPublicApiUrl, getUploadRoot } from "./config.js";
import { ApiError } from "./errors.js";

const PUBLIC_KINDS = new Set(["facade", "product", "sponsorship", "banner", "branding"]);
const MAX_BYTES = 8 * 1024 * 1024;

function safeName(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/-+/g, "-")
      .slice(-80) || "file"
  );
}

export async function saveUpload(options: {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  kind: string;
  uid: string;
  shopId?: string;
}): Promise<{ url: string; path: string; public: boolean }> {
  if (options.buffer.length === 0 || options.buffer.length > MAX_BYTES) {
    throw new ApiError("invalid-argument", "The uploaded file is empty or too large.");
  }
  const isIdentity = options.kind === "identity";
  if (!isIdentity && !PUBLIC_KINDS.has(options.kind)) {
    throw new ApiError("invalid-argument", "Unknown upload kind.");
  }
  const filename = `${randomUUID()}-${safeName(options.originalName)}`;
  const relative = isIdentity
    ? path.join("identity", options.uid, filename)
    : path.join("public", options.kind, options.uid, options.shopId ?? "_", filename);
  const absolute = path.join(getUploadRoot(), relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, options.buffer);
  const urlPath = `/uploads/${relative.split(path.sep).join("/")}`;
  return {
    path: relative.split(path.sep).join("/"),
    url: isIdentity ? urlPath : `${getPublicApiUrl()}${urlPath}`,
    public: !isIdentity,
  };
}

export function resolveUploadFile(relativePath: string): string {
  const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
  return path.join(getUploadRoot(), normalized);
}

export function isIdentityPath(relativePath: string, uid: string): boolean {
  return (
    relativePath.startsWith(`identity/${uid}/`) &&
    !relativePath.includes("..")
  );
}
