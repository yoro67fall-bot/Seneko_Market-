const ui = window.SenekoUI;
const clientIds = new Map();
let storageCountry = "SN";
let services = null;
let publicSnapshot = [];
let categoryBannersSnapshot = [];
let pendingProductsSnapshot = [];
let paymentReturnHandled = false;

function toast(type, title, message) {
  ui.showToast(type, title, message);
}

function errorMessage(error) {
  const code = String(error?.code || "");
  const details = error?.details?.issues;
  const firstDetail = Array.isArray(details) && details[0]?.message ? String(details[0].message) : "";
  const raw = String(error?.message || firstDetail || "Une erreur inattendue est survenue.");
  const known = {
    "invalid-credential": "Email ou mot de passe incorrect.",
    "email-already-in-use": "Cette adresse email est déjà utilisée.",
    "weak-password": "Le mot de passe doit contenir au moins 8 caractères.",
    "invalid-email": "L'adresse email n'est pas valide.",
    "permission-denied": "Vous n'avez pas l'autorisation d'effectuer cette action.",
    unauthenticated: "Veuillez vous reconnecter pour continuer.",
    "failed-precondition": "Cette action n'est pas encore disponible pour ce compte.",
    "already-exists": "Cette ressource existe déjà.",
    "resource-exhausted": "Trop de tentatives. Veuillez réessayer plus tard.",
    unavailable: "Le service est momentanément indisponible. Veuillez réessayer.",
    "deadline-exceeded": "Le service de paiement met trop de temps à répondre. Veuillez réessayer."
  };
  if (known[code] && code !== "invalid-argument") return known[code];
  if (/too large|file size|LIMIT_FILE_SIZE/i.test(raw)) {
    return "L'image est trop lourde. Essayez une photo plus légère (moins de 12 Mo).";
  }
  if (/valid image url|https url/i.test(raw)) {
    return "L'image n'a pas pu être enregistrée. Réessayez avec une autre photo.";
  }
  if (/A file is required/i.test(raw)) return "Veuillez sélectionner une image.";
  if (/shop name is already in use/i.test(raw)) {
    return "Ce nom de boutique est déjà utilisé. Choisissez un autre nom.";
  }
  if (code === "invalid-argument") return raw === "Invalid request data." ? "Requête invalide. Vérifiez les champs du formulaire." : raw;
  return raw;
}

async function runAction(action, title = "Erreur", buttonOverride = null) {
  const button = buttonOverride instanceof HTMLButtonElement
    ? buttonOverride
    : (document.activeElement instanceof HTMLButtonElement ? document.activeElement : null);
  if (button) button.disabled = true;
  try {
    return await action();
  } catch (error) {
    console.error(title, error);
    toast("error", `⚠️ ${title}`, errorMessage(error));
    return null;
  } finally {
    if (button) button.disabled = false;
  }
}

function getStorageCountry() {
  return String(services?.country || storageCountry || "SN").toUpperCase();
}

function storageKey(name) {
  return `seneko_${getStorageCountry()}_${name}`;
}

function getToken() {
  const key = storageKey("jwt");
  const token = sessionStorage.getItem(key) || localStorage.getItem(key) || "";
  if (token) return token;
  return sessionStorage.getItem("senekoJwt") || localStorage.getItem("senekoJwt") || "";
}

function saveToken(token, remember) {
  const key = storageKey("jwt");
  sessionStorage.removeItem(key);
  localStorage.removeItem(key);
  sessionStorage.removeItem("senekoJwt");
  localStorage.removeItem("senekoJwt");
  const store = remember === false ? sessionStorage : localStorage;
  store.setItem(key, token);
}

function clearToken() {
  const key = storageKey("jwt");
  sessionStorage.removeItem(key);
  localStorage.removeItem(key);
  sessionStorage.removeItem("senekoJwt");
  localStorage.removeItem("senekoJwt");
}

function getPendingPaymentKey() {
  return storageKey("pendingPayment");
}

function savePendingPayment(payload) {
  localStorage.setItem(getPendingPaymentKey(), JSON.stringify(payload));
}

function loadPendingPayment() {
  try {
    const scoped = JSON.parse(localStorage.getItem(getPendingPaymentKey()) || "null");
    if (scoped) return scoped;
    return JSON.parse(localStorage.getItem("senekoPendingPayment") || "null");
  } catch {
    return null;
  }
}

function clearPendingPayment() {
  localStorage.removeItem(getPendingPaymentKey());
  localStorage.removeItem("senekoPendingPayment");
}

async function loadPlatformConfig() {
  let fromFile = null;
  try {
    const response = await fetch("/api-config.json", {
      headers: { Accept: "application/json" },
      cache: "no-store"
    });
    if (response.ok) {
      const contentType = String(response.headers.get("content-type") || "");
      if (contentType.includes("application/json") || contentType.includes("text/json") || !contentType) {
        const data = await response.json();
        if (data && typeof data === "object") {
          fromFile = {
            apiUrl: data?.apiUrl ? String(data.apiUrl).replace(/\/$/, "") : "",
            country: String(data?.country || "").toUpperCase(),
            countryName: data?.countryName || "",
            flagUrl: data?.flagUrl || ""
          };
        }
      }
    }
  } catch {
    /* fall through */
  }

  const country = String(window.SENEKO_COUNTRY || fromFile?.country || "SN").toUpperCase();
  const countryDefaults = {
    SN: { countryName: "Sénégal", flagUrl: "/flags/sn.svg" },
    BJ: { countryName: "Bénin", flagUrl: "/flags/bj.svg" },
    TG: { countryName: "Togo", flagUrl: "/flags/tg.svg" },
    CD: { countryName: "RDC", flagUrl: "/flags/cd.svg" }
  };
  const defaults = countryDefaults[country] || countryDefaults.SN;

  return {
    apiUrl: String(window.SENEKO_API_URL || fromFile?.apiUrl || "").replace(/\/$/, ""),
    country,
    countryName: window.SENEKO_COUNTRY_NAME || fromFile?.countryName || defaults.countryName,
    flagUrl: window.SENEKO_FLAG_URL || fromFile?.flagUrl || defaults.flagUrl
  };
}

function applyTheme() {
  /* Palette is unified in CSS (:root); per-country theme overrides are disabled. */
}

function applyCountryFlag({ flagUrl, countryName, country }) {
  const badge = document.getElementById("countryFlagBadge");
  const img = document.getElementById("countryFlagImg");
  const label = document.getElementById("countryFlagLabel");
  document.documentElement.setAttribute("data-country", country || "SN");
  if (!badge || !img || !flagUrl) {
    if (badge) badge.style.display = "none";
    return;
  }
  img.src = flagUrl;
  img.alt = countryName ? `Drapeau du ${countryName}` : `Drapeau ${country || ""}`;
  if (label) label.textContent = countryName || country || "";
  badge.style.display = "flex";
  badge.setAttribute("aria-label", countryName || country || "Pays");

  const contactCountry = document.getElementById("adminContactCountryLabel");
  if (contactCountry) {
    contactCountry.textContent = countryName || country || "";
  }
}

function hideSocialLogin() {
  document.querySelectorAll(".auth-social, .auth-divider").forEach(node => {
    node.style.display = "none";
  });
}

async function initializeBackend() {
  try {
    const platform = await loadPlatformConfig();
    storageCountry = platform.country || "SN";
    services = {
      apiUrl: platform.apiUrl,
      country: platform.country || "SN",
      countryName: platform.countryName || "",
      flagUrl: platform.flagUrl || ""
    };
    applyTheme();
    applyCountryFlag(platform);
    hideSocialLogin();
    if (!platform.apiUrl) {
      toast(
        "warning",
        "API non configurée",
        "Ajoutez public/api-config.json avec l'URL Railway, puis rechargez la page."
      );
      return;
    }
    await loadPublicData();
    if (getToken()) {
      try {
        await loadAccount({ navigate: false });
        await handlePaymentReturn();
      } catch (error) {
        console.error("Session restoration failed", error);
        clearToken();
        ui.clearAuth();
      }
    }
  } catch (error) {
    console.error("Backend initialization failed", error);
    toast(
      "warning",
      "Backend non configuré",
      "L'interface reste visible, mais l'API Railway doit être configurée."
    );
  }
}

async function apiFetch(path, { method = "POST", body, formData } = {}) {
  if (!services?.apiUrl) {
    throw new Error("URL de l'API manquante. Définissez apiUrl dans /api-config.json (Railway).");
  }
  const headers = {
    "X-Platform-Country": services.country || "SN"
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!formData && method !== "GET") headers["Content-Type"] = "application/json";
  const response = await fetch(`${services.apiUrl}${path}`, {
    method,
    headers,
    body: formData ?? (method === "GET" ? undefined : JSON.stringify(body ?? {}))
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const error = new Error(payload?.error?.message || (response.status === 413
      ? "L'image est trop lourde."
      : "La requête a échoué."));
    error.code = payload?.error?.status || `http-${response.status}`;
    error.details = payload?.error?.details || null;
    throw error;
  }
  return payload.result;
}

async function backend(name, payload = {}) {
  return apiFetch(`/v1/${encodeURIComponent(name)}`, { body: payload });
}

function stableClientId(key) {
  const normalized = String(key);
  if (clientIds.has(normalized)) return clientIds.get(normalized);
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  let candidate = (hash >>> 0) % 2_000_000_000;
  if (candidate === 0) candidate = 1;
  const used = new Set(clientIds.values());
  while (used.has(candidate)) candidate += 1;
  clientIds.set(normalized, candidate);
  return candidate;
}

function formatXof(value) {
  const amount = Number(value);
  return `${Number.isFinite(amount) ? amount.toLocaleString("fr-FR") : 0} F`;
}

function normalizeProduct(product, shopBackendId) {
  const backendId = String(product.id || product.productId || stableClientId(JSON.stringify(product)));
  const priceAmount = Number(product.priceAmount ?? product.price ?? 0);
  const approvalStatus = product.approvalStatus
    || (product.approved === true ? "approved" : product.approved === false ? (product.rejectionReason ? "rejected" : "pending") : "approved");
  return {
    ...product,
    backendId,
    id: stableClientId(`product:${shopBackendId}:${backendId}`),
    priceAmount: Number.isInteger(priceAmount) ? priceAmount : 0,
    price: formatXof(priceAmount),
    images: Array.isArray(product.images) ? product.images : [],
    approvalStatus,
    approved: approvalStatus === "approved",
    rejectionReason: product.rejectionReason || null
  };
}

function normalizeShop(shop) {
  const backendId = String(shop.id || shop.shopId);
  const idCardPath = shop.idCardPath || shop.idCard || "";
  let idCardUrl = null;
  if (idCardPath && services?.apiUrl) {
    const parts = String(idCardPath).split("/");
    if (parts.length >= 3 && parts[0] === "identity") {
      idCardUrl = `${services.apiUrl}/uploads/identity/${parts[1]}/${parts[2]}`;
    }
  }
  return {
    ...shop,
    backendId,
    id: stableClientId(`shop:${backendId}`),
    idCardPath,
    idCardUrl,
    idCard: idCardUrl,
    ownerEmail: shop.ownerEmail || shop.email || null,
    ownerUid: shop.ownerUid || shop.ownerId || null,
    products: Array.isArray(shop.products)
      ? shop.products.map(product => normalizeProduct(product, backendId))
      : [],
    rentPaid: shop.rentPaid === true,
    approved: shop.approved === true,
    visible: shop.visible === true,
    idVerified: shop.idVerified === true,
    sponsored: shop.sponsored === true,
    visitCount: Number(shop.visitCount || 0),
    contactCount: Number(shop.contactCount || 0),
    daysActive: Number(shop.daysActive || 1),
    dailyVisits: Array.isArray(shop.dailyVisits) ? shop.dailyVisits : [0, 0, 0, 0, 0, 0, 0],
    recentActivity: Array.isArray(shop.recentActivity) ? shop.recentActivity : [],
    createdAt: shop.createdAt || null,
    logo: shop.logo || String(shop.name || "S").charAt(0).toUpperCase(),
    whatsapp: String(shop.whatsapp || shop.phone || "").replace(/\D/g, "")
  };
}

function normalizeAgent(agent) {
  const backendId = String(agent.id || agent.agentId);
  return {
    ...agent,
    backendId,
    id: stableClientId(`agent:${backendId}`)
  };
}

function normalizeBanner(banner) {
  const backendId = String(banner.id || banner.bannerId);
  return {
    ...banner,
    backendId,
    id: stableClientId(`banner:${backendId}`),
    sub: banner.sub ?? banner.subtitle ?? ""
  };
}

function normalizeCategoryBanner(banner) {
  const backendId = String(banner.id || banner.bannerId);
  return {
    ...banner,
    backendId,
    id: stableClientId(`category-banner:${backendId}`)
  };
}

function normalizeAdminProduct(product) {
  const backendId = String(product.id || product.productId);
  const shopBackendId = String(product.shopId || "unknown");
  const normalized = normalizeProduct({ ...product, id: backendId }, shopBackendId);
  const shop = ui.getState().shops.find(s => s.backendId === shopBackendId);
  return {
    ...normalized,
    shopBackendId,
    shopName: product.shopName || shop?.name || "",
    shopClientId: shop?.id ?? null
  };
}

function applyPublicShops(extraShop = null) {
  const shops = [...publicSnapshot];
  if (extraShop && !shops.some(shop => shop.backendId === extraShop.backendId)) shops.push(extraShop);
  ui.setShops(shops);
  ui.renderPublic();
}

async function loadPublicData() {
  const data = await backend("bootstrapPublic", { limit: 100 });
  publicSnapshot = (data?.shops || []).map(normalizeShop);
  categoryBannersSnapshot = (data?.categoryBanners || []).map(normalizeCategoryBanner);
  ui.setConfig({
    ...(data?.config || {}),
    platformLogo: data?.platformLogo ?? data?.config?.platformLogo
  });
  ui.setAdminData({
    adBanners: (data?.adBanners || []).map(normalizeBanner),
    categoryBanners: categoryBannersSnapshot
  });
  applyPublicShops();
}

function profileFromAccount(account, admin) {
  const profile = account?.profile || {};
  const shop = account?.shop || null;
  return {
    uid: profile.uid,
    firstname: profile.firstname || (admin ? "Admin" : "Commerçant"),
    lastname: profile.lastname || "",
    email: profile.email || "",
    phone: profile.phone || shop?.phone || "",
    shopName: shop?.name || profile.shopName || null,
    shopId: shop?.id || profile.shopId || null
  };
}

async function loadAccount({ navigate = false } = {}) {
  const me = await apiFetch("/auth/me", { method: "GET" });
  const admin = me?.admin === true || me?.profile?.role === "admin";
  const account = admin ? me : await backend("getMyAccount");
  const merged = {
    profile: { ...(me?.profile || {}), ...(account?.profile || {}) },
    shop: account?.shop || null
  };
  const profile = profileFromAccount(merged, admin);
  ui.setAuth({ profile, admin });
  const paymentPhone = document.getElementById("phoneNumber");
  if (paymentPhone && !paymentPhone.value) paymentPhone.value = profile.phone || "";

  if (admin) {
    const [shopData, adminData] = await Promise.all([
      backend("adminListShops", { limit: 100 }),
      backend("adminBootstrap")
    ]);
    const shops = (shopData?.shops || []).map(normalizeShop);
    ui.setConfig(adminData?.config || {});
    ui.setShops(shops);
    ui.setAdminData({
      agents: (adminData?.agents || []).map(normalizeAgent),
      adBanners: (adminData?.adBanners || adminData?.banners || []).map(normalizeBanner),
      categoryBanners: (adminData?.categoryBanners || []).map(normalizeCategoryBanner),
      sponsorings: adminData?.sponsorings || []
    });
    const pendingProducts = await backend("adminListProducts", { status: "pending", limit: 100 });
    pendingProductsSnapshot = (pendingProducts?.products || []).map(normalizeAdminProduct);
    ui.setAdminData({ pendingProducts: pendingProductsSnapshot });
    ui.renderPublic();
    ui.renderAdmin();
    if (navigate) ui.showPage("admin");
  } else {
    const ownShop = merged.shop ? normalizeShop(merged.shop) : null;
    applyPublicShops(ownShop);
    if (ownShop) ui.renderMerchant();
    if (navigate) {
      if (ownShop) {
        ui.showPage("dashboard");
      } else {
        ui.showPage("auth");
        if (typeof window.switchAuthTab === "function") window.switchAuthTab("register");
        toast(
          "info",
          "Finalisez votre inscription",
          "Complétez les informations de votre boutique pour terminer l'inscription."
        );
      }
    }
  }
  return { account: merged, admin };
}

async function refreshCurrentData() {
  await loadPublicData();
  if (getToken()) await loadAccount();
}

function currentShop() {
  const state = ui.getState();
  const user = state.currentUser;
  if (!user) return null;
  if (state.activeShopId != null) {
    const active = state.shops.find(shop => Number(shop.id) === Number(state.activeShopId));
    if (active) return active;
  }
  return state.shops.find(shop =>
    (user.shopId && shop.backendId === user.shopId) ||
    (user.uid && shop.ownerUid === user.uid) ||
    (user.email && (shop.ownerEmail === user.email || shop.email === user.email)) ||
    (user.shopName && shop.name === user.shopName)
  ) || null;
}

function shopByClientId(clientId) {
  return ui.getState().shops.find(shop => Number(shop.id) === Number(clientId));
}

function agentByClientId(clientId) {
  return ui.getState().agents.find(agent => Number(agent.id) === Number(clientId));
}

function bannerByClientId(clientId) {
  return ui.getState().adBanners.find(banner => Number(banner.id) === Number(clientId));
}

function parseXof(value) {
  const digits = String(value || "").replace(/[^0-9]/g, "");
  const amount = Number(digits);
  return Number.isSafeInteger(amount) ? amount : 0;
}

function dataUrlToBlob(dataUrl) {
  const [metadata, content] = String(dataUrl).split(",", 2);
  if (!content) throw new Error("Image invalide.");
  const match = metadata.match(/^data:([^;,]+)/i);
  const type = match?.[1] || "image/jpeg";
  const bytes = atob(content);
  const buffer = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) buffer[index] = bytes.charCodeAt(index);
  return new Blob([buffer], { type });
}

function extensionFor(type) {
  const extensions = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif"
  };
  return extensions[type] || "jpg";
}

async function canvasFromBlob(blob) {
  try {
    return await createImageBitmap(blob);
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      return await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Image invalide."));
        image.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function compressImage(fileOrDataUrl) {
  const blob = typeof fileOrDataUrl === "string"
    ? dataUrlToBlob(fileOrDataUrl)
    : fileOrDataUrl;
  if (!blob) throw new Error("Image invalide.");
  try {
    const image = await canvasFromBlob(blob);
    const max = 1600;
    const scale = Math.min(1, max / Math.max(image.width || 1, image.height || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((image.width || 1) * scale));
    canvas.height = Math.max(1, Math.round((image.height || 1) * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image invalide.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const compressed = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (compressed && compressed.size > 0) {
      return new File([compressed], "image.jpg", { type: "image/jpeg" });
    }
  } catch (error) {
    console.warn("Image compression failed, using original file", error);
  }
  if (blob instanceof File) return blob;
  return new File([blob], `image.${extensionFor(blob.type)}`, { type: blob.type || "image/jpeg" });
}

async function uploadToApi(file, kind, shopId) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("kind", kind);
  if (shopId) formData.append("shopId", shopId);
  return apiFetch("/uploads", { formData });
}

function isPdfFile(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  return type === "application/pdf" || name.endsWith(".pdf");
}

async function uploadPrivateIdentity(file) {
  const payload = isPdfFile(file) ? file : await compressImage(file);
  const saved = await uploadToApi(payload, "identity");
  return saved.path;
}

async function ensureRegisteredUser({ email, password, firstname, lastname, phone }) {
  const targetEmail = email.trim().toLowerCase();
  if (getToken()) {
    try {
      const me = await apiFetch("/auth/me", { method: "GET" });
      const sessionEmail = String(me?.profile?.email || me?.email || "").trim().toLowerCase();
      if (sessionEmail && sessionEmail === targetEmail) {
        return;
      }
      clearToken();
    } catch {
      clearToken();
    }
  }

  try {
    const registered = await apiFetch("/auth/register", {
      body: { email, password, firstname, lastname, phone }
    });
    saveToken(registered.token, true);
    return;
  } catch (error) {
    if (error?.code !== "already-exists") throw error;
    try {
      const loggedIn = await apiFetch("/auth/login", { body: { email, password } });
      saveToken(loggedIn.token, true);
    } catch {
      throw new Error(
        "Cette adresse email est déjà utilisée. Connectez-vous avec votre mot de passe existant."
      );
    }
  }
}

async function uploadPublicDataUrl(dataUrl, kind, shopId) {
  if (dataUrl && !String(dataUrl).startsWith("data:")) return dataUrl;
  const saved = await uploadToApi(await compressImage(dataUrl), kind, shopId);
  return saved.url;
}

async function uploadPublicFile(file, kind, shopId) {
  if (!file) throw new Error("Fichier manquant.");
  const saved = await uploadToApi(await compressImage(file), kind, shopId);
  return saved.url;
}

async function uploadImages(images, kind, shopId) {
  return Promise.all((images || []).map(image => uploadPublicDataUrl(image, kind, shopId)));
}

let registerInFlight = false;

window.handleLogin = () => runAction(async () => {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  if (!email || !password) throw new Error("Veuillez remplir l'email et le mot de passe.");
  const remember = document.querySelector("#form-login .form-options input[type=checkbox]")?.checked !== false;
  const result = await apiFetch("/auth/login", { body: { email, password } });
  saveToken(result.token, remember);
  const { admin } = await loadAccount({ navigate: true });
  if (admin) {
    toast("success", "✅ Connexion admin", "Bienvenue sur Seneko Market !");
    return;
  }
  const account = await backend("getMyAccount");
  if (account?.shop) {
    toast("success", "✅ Connexion réussie", "Bienvenue sur Seneko Market !");
  }
}, "Connexion impossible", document.getElementById("loginSubmitBtn"));

window.handleRegister = () => {
  if (registerInFlight) return null;
  return runAction(async () => {
    if (registerInFlight) return;
    registerInFlight = true;
    try {
      const firstname = document.getElementById("registerFirstname").value.trim();
      const lastname = document.getElementById("registerLastname").value.trim();
      const shopNameInput = document.getElementById("registerShopName");
      const shopName = (shopNameInput?.value || `${firstname} ${lastname}`).trim();
      const email = document.getElementById("registerEmail").value.trim();
      const phone = document.getElementById("registerPhone").value.trim();
      const password = document.getElementById("registerPassword").value;
      const confirmPassword = document.getElementById("registerConfirm").value;
      const category = document.getElementById("registerCategory").value;
      const openingFor = document.getElementById("registerOpeningFor")?.value || "myself";
      const agentCode = document.getElementById("registerAgentCode")?.value?.trim() || "";
      const idFile = document.getElementById("registerIdCard").files[0];
      const termsAccepted = document.querySelector("#form-register .form-options input[type=checkbox]")?.checked;

      if (!firstname || !lastname || !shopName || !email || !phone || !category) {
        throw new Error("Veuillez remplir tous les champs obligatoires.");
      }
      if (!password || password !== confirmPassword) {
        throw new Error("Les mots de passe sont vides ou ne correspondent pas.");
      }
      if (!idFile) throw new Error("Veuillez charger votre pièce d'identité.");
      if (!termsAccepted) throw new Error("Vous devez accepter les conditions d'utilisation.");
      if (typeof window.isPasswordValid === "function" && !window.isPasswordValid(password)) {
        throw new Error("Le mot de passe doit contenir 8 caractères, une majuscule et un caractère spécial.");
      }

      await ensureRegisteredUser({ email, password, firstname, lastname, phone });

      const existingAccount = await backend("getMyAccount");
      if (existingAccount?.shop) {
        await refreshCurrentData();
        ui.showPage("dashboard");
        toast("info", "Compte déjà actif", "Votre boutique est déjà enregistrée.");
        return;
      }

      const idCardPath = await uploadPrivateIdentity(idFile);
      await backend("completeMerchantProfile", {
        firstname,
        lastname,
        phone,
        shop: {
          name: shopName,
          category,
          description: "Nouvelle boutique sur Seneko Market. En attente de validation.",
          phone,
          email,
          whatsapp: phone.replace(/\D/g, ""),
          logo: shopName.charAt(0).toUpperCase(),
          icon: "fa-store",
          idCardPath,
          openingFor,
          agentCode: agentCode || undefined
        }
      });

      await refreshCurrentData();
      ui.showPage("dashboard");
      toast(
        "success",
        "✅ Inscription réussie",
        "Votre boutique a été enregistrée et attend maintenant la validation de l'administrateur."
      );
    } finally {
      registerInFlight = false;
    }
  }, "Inscription impossible", document.getElementById("registerSubmitBtn"));
};

window.handleLogout = () => runAction(async () => {
  clearToken();
  ui.clearAuth();
  applyPublicShops();
  ui.showPage("home");
  toast("info", "👋 Déconnexion", "Vous avez été déconnecté avec succès.");
}, "Déconnexion impossible");

document.querySelector("#form-login .form-options a")?.addEventListener("click", event => {
  event.preventDefault();
  toast("info", "Réinitialisation", "Contactez l'administrateur pour réinitialiser votre mot de passe.");
});

window.saveShopConfig = () => runAction(async () => {
  const shop = currentShop();
  if (!shop) throw new Error("Boutique introuvable. Reconnectez-vous puis réessayez.");
  const state = ui.getState();
  const name = document.getElementById("shopConfigName").value.trim();
  const category = document.getElementById("shopConfigCategory").value;
  const description = document.getElementById("shopConfigDescription").value.trim();
  const phone = document.getElementById("shopConfigPhone").value.trim();
  const email = document.getElementById("shopConfigEmail").value.trim();
  if (!name || !category || !description || !phone) throw new Error("Veuillez remplir tous les champs obligatoires.");

  toast("info", "Enregistrement...", "Envoi des informations de la boutique.");
  let facade = state.shopFacadeImage || shop.facade || null;
  const facadeFile = document.getElementById("shopFacadeInput")?.files?.[0];
  if (facadeFile) {
    facade = await uploadPublicFile(facadeFile, "facade", shop.backendId);
  } else if (facade?.startsWith("data:")) {
    facade = await uploadPublicDataUrl(facade, "facade", shop.backendId);
  }
  await backend("updateMyShop", {
    shopId: shop.backendId,
    name,
    category,
    description,
    phone,
    email: email || undefined,
    whatsapp: phone.replace(/\D/g, ""),
    facade: facade || undefined,
    logo: name.charAt(0).toUpperCase()
  });
  await refreshCurrentData();
  toast("success", "✅ Boutique mise à jour", "Les informations de votre boutique ont été enregistrées.");
}, "Enregistrement impossible");

window.addProduct = () => runAction(async () => {
  const shop = currentShop();
  if (!shop) throw new Error("Boutique introuvable. Reconnectez-vous puis réessayez.");
  const state = ui.getState();
  const name = document.getElementById("productName").value.trim();
  const price = parseXof(document.getElementById("productPrice").value);
  const description = document.getElementById("productDescription").value.trim();
  const category = document.getElementById("productCategory").value || shop.category;
  if (!name || !price || !description) throw new Error("Veuillez remplir tous les champs obligatoires.");
  if (!state.productImages.length) throw new Error("Ajoutez au moins une image pour le produit.");

  toast("info", "Enregistrement...", "Envoi du produit et des images.");
  const editingProduct = shop.products.find(product => Number(product.id) === Number(state.editingProductId));
  const images = await uploadImages(state.productImages, "product", shop.backendId);
  await backend("upsertProduct", {
    shopId: shop.backendId,
    productId: editingProduct?.backendId,
    name,
    price,
    description,
    category,
    images
  });
  ui.resetProductEditor();
  await refreshCurrentData();
  toast("success", editingProduct ? "✅ Produit modifié" : "✅ Produit ajouté",
    editingProduct
      ? `"${name}" a été mis à jour et sera revu par l'administrateur.`
      : `"${name}" est en attente de validation par l'administrateur.`);
}, "Produit non enregistré");

window.deleteProduct = productId => runAction(async () => {
  if (!confirm("Voulez-vous vraiment supprimer ce produit ?")) return;
  const shop = currentShop();
  const product = shop?.products.find(item => Number(item.id) === Number(productId));
  if (!shop || !product) throw new Error("Produit introuvable.");
  await backend("deleteProduct", { shopId: shop.backendId, productId: product.backendId });
  await refreshCurrentData();
  toast("success", "🗑️ Produit supprimé", `"${product.name}" a été supprimé.`);
}, "Suppression impossible");

window.deleteProductFromDetail = productId => window.deleteProduct(productId);

function paymentUrls() {
  const base = new URL(location.href);
  base.search = "";
  base.hash = "";
  const success = new URL(base);
  success.searchParams.set("payment_return", "success");
  const cancel = new URL(base);
  cancel.searchParams.set("payment_return", "cancel");
  return { returnUrl: success.toString(), cancelUrl: cancel.toString() };
}

function isDemoRentPayment() {
  const state = ui.getState();
  if (state?.isDemoMode === true) return true;
  if (typeof ui.isDemoMode === "function" && ui.isDemoMode() === true) return true;
  return document.body.classList.contains("demo-mode");
}

async function startCheckout({ purpose, sponsorOption, bannerImages }) {
  const shop = currentShop();
  if (!shop) throw new Error("Boutique introuvable.");
  const selected = ui.getState().selectedPaymentMethod;
  const paymentMethod = selected === "visa" ? "card" : selected;
  const idempotencyKey = crypto.randomUUID();
  const demoMode = purpose === "rent" && isDemoRentPayment();
  const payload = {
    shopId: shop.backendId,
    purpose,
    sponsorOption,
    bannerImages,
    paymentMethod,
    payerPhone: paymentMethod === "card"
      ? undefined
      : document.getElementById("phoneNumber").value.trim() || undefined,
    idempotencyKey,
    demoMode,
    ...paymentUrls()
  };
  const auth = getToken();
  const createPaymentViaFunction = async () => {
    const response = await fetch("/.netlify/functions/create-payment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth}`,
        "X-Platform-Country": services?.country || "SN",
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let parsed = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = {};
    }
    if (!response.ok) {
      const error = new Error(parsed?.error?.message || parsed?.error || "La requête de paiement a échoué.");
      error.code = parsed?.error?.status || `http-${response.status}`;
      throw error;
    }
    return parsed?.result || parsed;
  };
  let result;
  try {
    result = await createPaymentViaFunction();
  } catch (error) {
    if (!String(error?.code || "").startsWith("http-404")) {
      throw error;
    }
    // Local and legacy fallback: call Railway callable directly.
    result = await backend("createPayment", payload);
  }
  savePendingPayment({
    paymentId: result.paymentId,
    purpose,
    createdAt: Date.now()
  });
  if (result.status === "completed") {
    clearPendingPayment();
    await refreshCurrentData();
    toast(
      "success",
      "✅ Paiement confirmé",
      purpose === "sponsor" ? "Votre sponsoring est maintenant actif." : "Votre loyer est maintenant à jour."
    );
    return;
  }
  if (!result.checkoutUrl) throw new Error("Le prestataire de paiement n'a pas renvoyé de lien de paiement.");
  location.assign(result.checkoutUrl);
}

window.processPayment = () => runAction(async () => {
  if (!getToken()) throw new Error("Veuillez vous connecter avant de payer.");
  const shop = currentShop();
  if (!shop) throw new Error("Boutique introuvable.");
  const method = ui.getState().selectedPaymentMethod;
  if (method !== "visa") {
    const phone = document.getElementById("phoneNumber")?.value.trim() || shop.phone || "";
    if (!phone) throw new Error("Veuillez saisir votre numéro de téléphone.");
  }
  await startCheckout({ purpose: "rent" });
}, "Paiement impossible");

window.submitSponsorship = () => runAction(async () => {
  const state = ui.getState();
  const shop = currentShop();
  if (!shop) throw new Error("Boutique introuvable.");
  if (!state.selectedSponsorOption) throw new Error("Veuillez sélectionner une durée de sponsoring.");
  if (!state.sponsorBannerImages.length) throw new Error("Veuillez charger au moins une bannière publicitaire.");
  const banners = await uploadImages(state.sponsorBannerImages, "sponsorship", shop.backendId);
  await startCheckout({
    purpose: "sponsor",
    sponsorOption: state.selectedSponsorOption,
    bannerImages: banners
  });
}, "Sponsoring impossible");

async function handlePaymentReturn() {
  if (paymentReturnHandled || !getToken()) return;
  const params = new URLSearchParams(location.search);
  if (!params.has("payment_return") && !params.has("token")) return;
  paymentReturnHandled = true;
  const pending = loadPendingPayment();
  const paymentId = pending?.paymentId || params.get("paymentId");
  if (!paymentId) {
    toast("warning", "Paiement en cours", "Le paiement sera mis à jour dès réception de la confirmation.");
    return;
  }
  const status = await backend("getPaymentStatus", { paymentId });
  if (status.status === "completed") {
    clearPendingPayment();
    await refreshCurrentData();
    toast(
      "success",
      "✅ Paiement confirmé",
      status.purpose === "sponsor" ? "Votre sponsoring est maintenant actif." : "Votre loyer est maintenant à jour."
    );
  } else if (["cancelled", "canceled", "failed"].includes(status.status)) {
    clearPendingPayment();
    toast("error", "Paiement non terminé", "Le paiement a été annulé ou refusé.");
  } else {
    toast("info", "Paiement en attente", "Confirmez le paiement sur votre téléphone. Le statut sera mis à jour automatiquement.");
  }
  const cleanUrl = new URL(location.href);
  cleanUrl.searchParams.delete("payment_return");
  cleanUrl.searchParams.delete("paymentId");
  cleanUrl.searchParams.delete("token");
  history.replaceState({}, "", cleanUrl);
}

window.approveShop = shopId => runAction(async () => {
  const shop = shopByClientId(shopId);
  if (!shop) throw new Error("Boutique introuvable.");
  await backend("adminSetShopStatus", { shopId: shop.backendId, decision: "approved", visible: true });
  await refreshCurrentData();
  toast("success", "✅ Boutique validée", `"${shop.name}" a été approuvée.`);
}, "Validation impossible");

window.rejectShop = shopId => runAction(async () => {
  const shop = shopByClientId(shopId);
  if (!shop) throw new Error("Boutique introuvable.");
  await backend("adminSetShopStatus", { shopId: shop.backendId, decision: "rejected", visible: false });
  await refreshCurrentData();
  toast("info", "Boutique rejetée", `"${shop.name}" a été refusée.`);
}, "Rejet impossible");

window.toggleShopVisibility = shopId => runAction(async () => {
  const shop = shopByClientId(shopId);
  if (!shop) throw new Error("Boutique introuvable.");
  await backend("adminSetShopStatus", { shopId: shop.backendId, visible: !shop.visible });
  await refreshCurrentData();
  toast("success", "Visibilité mise à jour", `"${shop.name}" est maintenant ${shop.visible ? "masquée" : "visible"}.`);
}, "Mise à jour impossible");

window.toggleSponsor = shopId => runAction(async () => {
  const shop = shopByClientId(shopId);
  if (!shop) throw new Error("Boutique introuvable.");
  await backend("adminSetShopStatus", {
    shopId: shop.backendId,
    sponsored: !shop.sponsored,
    sponsorEndDate: shop.sponsored ? null : new Date(Date.now() + 30 * 86_400_000).toISOString()
  });
  await refreshCurrentData();
  toast("success", "Sponsoring mis à jour", `Le sponsoring de "${shop.name}" a été mis à jour.`);
}, "Mise à jour impossible");

window.markRentPaid = shopId => runAction(async () => {
  const shop = shopByClientId(shopId);
  if (!shop) throw new Error("Boutique introuvable.");
  await backend("adminMarkRent", { shopId: shop.backendId, paid: true });
  await refreshCurrentData();
  toast("success", "✅ Loyer mis à jour", `Le loyer de "${shop.name}" est marqué payé.`);
}, "Mise à jour impossible");

window.markRentUnpaid = shopId => runAction(async () => {
  const shop = shopByClientId(shopId);
  if (!shop) throw new Error("Boutique introuvable.");
  await backend("adminMarkRent", { shopId: shop.backendId, paid: false });
  await refreshCurrentData();
  toast("success", "Loyer mis à jour", `Le loyer de "${shop.name}" est marqué impayé.`);
}, "Mise à jour impossible");

window.deleteShopAdmin = shopId => runAction(async () => {
  const shop = shopByClientId(shopId);
  if (!shop) throw new Error("Boutique introuvable.");
  const confirmed = confirm(
    `Supprimer la boutique « ${shop.name} » ?\n\nLa boutique sera masquée et retirée des listes. Le compte du commerçant sera conservé.`
  );
  if (!confirmed) return;
  await backend("adminDeleteShop", { shopId: shop.backendId });
  await refreshCurrentData();
  toast("success", "Boutique supprimée", `"${shop.name}" a été supprimée.`);
}, "Suppression impossible");

window.deleteAccountAdmin = shopId => runAction(async () => {
  const shop = shopByClientId(shopId);
  if (!shop) throw new Error("Boutique introuvable.");
  if (!shop.ownerUid) throw new Error("Aucun compte associé à cette boutique.");
  const confirmed = confirm(
    `Supprimer définitivement le compte de « ${shop.ownerEmail || shop.ownerUid} » ?\n\nCette action est irréversible. Toutes les boutiques et données du commerçant seront perdues.`
  );
  if (!confirmed) return;
  const doubleCheck = confirm("Confirmez la suppression définitive du compte.");
  if (!doubleCheck) return;
  await backend("adminDeleteUser", { userId: shop.ownerUid });
  await refreshCurrentData();
  toast("success", "Compte supprimé", "Le compte commerçant a été supprimé.");
}, "Suppression impossible");

window.deleteProductAdmin = (productId, shopId) => runAction(async () => {
  const product = productByClientId(productId, shopId);
  if (!product) throw new Error("Produit introuvable.");
  const confirmed = confirm(
    `Supprimer définitivement le produit « ${product.name} » ?\n\nCette action est irréversible.`
  );
  if (!confirmed) return;
  await backend("adminDeleteProduct", { productId: product.backendId });
  await refreshCurrentData();
  toast("success", "Produit supprimé", `"${product.name}" a été supprimé.`);
}, "Suppression impossible");

window.verifyId = (shopId, verified) => runAction(async () => {
  const shop = shopByClientId(shopId);
  if (!shop) throw new Error("Boutique introuvable.");
  if (verified) {
    await backend("adminReviewSeller", { shopId: shop.backendId, decision: "approved" });
  } else {
    const reason = prompt("Motif du rejet (obligatoire) :");
    if (!reason || !reason.trim()) throw new Error("Un motif de rejet est requis.");
    await backend("adminReviewSeller", {
      shopId: shop.backendId,
      decision: "rejected",
      rejectionReason: reason.trim()
    });
  }
  await refreshCurrentData();
  toast("success", "Identité mise à jour", `La vérification de "${shop.name}" a été enregistrée.`);
}, "Vérification impossible");

window.approveProduct = (productId, shopId) => runAction(async () => {
  const product = productByClientId(productId, shopId);
  if (!product) throw new Error("Produit introuvable.");
  await backend("adminSetProductStatus", { productId: product.backendId, decision: "approved" });
  await refreshCurrentData();
  toast("success", "✅ Produit validé", `"${product.name}" est maintenant visible.`);
}, "Validation impossible");

window.rejectProduct = (productId, shopId) => runAction(async () => {
  const product = productByClientId(productId, shopId);
  if (!product) throw new Error("Produit introuvable.");
  const reason = prompt("Motif du rejet (obligatoire) :");
  if (!reason || !reason.trim()) throw new Error("Un motif de rejet est requis.");
  await backend("adminSetProductStatus", {
    productId: product.backendId,
    decision: "rejected",
    rejectionReason: reason.trim()
  });
  await refreshCurrentData();
  toast("info", "Produit rejeté", `"${product.name}" a été refusé.`);
}, "Rejet impossible");

window.addCategorySponsor = () => runAction(async () => {
  const categoryName = document.getElementById("sponsorCategorySelect")?.value?.trim();
  const title = document.getElementById("sponsorBannerTitle")?.value?.trim() || "";
  const description = document.getElementById("sponsorBannerDesc")?.value?.trim() || title;
  const price = Number(document.getElementById("sponsorBannerPrice")?.value || 0);
  const input = document.getElementById("sponsorBannerImageInput");
  const file = input?.files?.[0];
  if (!categoryName || !description) throw new Error("Veuillez remplir tous les champs.");
  if (!file) throw new Error("Veuillez charger une image.");
  const image = await uploadPublicFile(file, "banner");
  await backend("adminUpsertCategoryBanner", {
    categoryName,
    description: title ? `${title} — ${description}` : description,
    price: Number.isInteger(price) ? price : 0,
    image,
    active: true
  });
  if (input) input.value = "";
  const titleEl = document.getElementById("sponsorBannerTitle");
  const descEl = document.getElementById("sponsorBannerDesc");
  const priceEl = document.getElementById("sponsorBannerPrice");
  if (titleEl) titleEl.value = "";
  if (descEl) descEl.value = "";
  if (priceEl) priceEl.value = "5000";
  await refreshCurrentData();
  toast("success", "✅ Bannière ajoutée", `La bannière pour "${categoryName}" a été enregistrée.`);
}, "Bannière non enregistrée");

window.toggleCategorySponsor = sponsorId => runAction(async () => {
  const banner = categoryBannerByClientId(sponsorId);
  if (!banner) throw new Error("Bannière introuvable.");
  await backend("adminUpsertCategoryBanner", {
    bannerId: banner.backendId,
    categoryName: banner.categoryName || banner.category,
    description: banner.description || "",
    image: banner.image || undefined,
    price: Number(banner.price || 0),
    active: banner.active === false
  });
  await refreshCurrentData();
  toast("success", "Bannière mise à jour", `La bannière est maintenant ${banner.active === false ? "active" : "inactive"}.`);
}, "Mise à jour impossible");

window.deleteCategorySponsor = sponsorId => runAction(async () => {
  if (!confirm("Voulez-vous vraiment supprimer cette bannière ?")) return;
  const banner = categoryBannerByClientId(sponsorId);
  if (!banner) throw new Error("Bannière introuvable.");
  await backend("adminDeleteCategoryBanner", { bannerId: banner.backendId });
  await refreshCurrentData();
  toast("success", "🗑️ Bannière supprimée", "La bannière a été supprimée.");
}, "Suppression impossible");

window.createNewShop = () => runAction(async () => {
  const existing = currentShop();
  if (existing) {
    throw new Error("Une seule boutique est autorisée par compte. Modifiez votre boutique actuelle depuis « Gérer ma boutique ».");
  }
  const name = document.getElementById("newShopName")?.value?.trim();
  const category = document.getElementById("newShopCategory")?.value;
  const description = document.getElementById("newShopDescription")?.value?.trim();
  const phone = document.getElementById("newShopPhone")?.value?.trim();
  const email = document.getElementById("newShopEmail")?.value?.trim();
  const user = ui.getState().currentUser;
  if (!name || !category || !description || !phone) {
    throw new Error("Veuillez remplir tous les champs obligatoires.");
  }
  if (!user) throw new Error("Vous devez être connecté.");
  throw new Error("Pour créer une boutique, utilisez l'inscription avec pièce d'identité, ou contactez l'administrateur.");
}, "Création impossible");

window.saveCategoryBanner = window.addCategorySponsor;
window.removeCategoryBanner = window.deleteCategorySponsor;

function productByClientId(clientId, shopClientId) {
  if (shopClientId != null) {
    const shop = shopByClientId(shopClientId);
    const fromShop = shop?.products?.find(product => Number(product.id) === Number(clientId));
    if (fromShop) return fromShop;
  }
  return pendingProductsSnapshot.find(product => Number(product.id) === Number(clientId))
    || ui.getState().shops.flatMap(shop => shop.products || []).find(product => Number(product.id) === Number(clientId));
}

function resolveShopClientId(product) {
  if (product?.shopClientId != null) return product.shopClientId;
  const shop = ui.getState().shops.find(s =>
    s.backendId === product?.shopBackendId ||
    s.backendId === product?.shopId ||
    (product?.shopName && s.name === product.shopName)
  );
  return shop?.id ?? null;
}

function productImageMarkup(image, className = "") {
  const src = String(image || "");
  if (/^(https?:\/\/|data:image\/|blob:)/i.test(src)) {
    return `<img src="${src}" alt="" class="${className}" style="width:100%;height:100%;object-fit:cover;">`;
  }
  return `<span style="font-size:1.5rem;">${src || "📦"}</span>`;
}

let productPreviewContext = null;

function showProductPreviewModal(product, shopClientId) {
  const modal = document.getElementById("previewModal");
  const img = document.getElementById("previewModalImage");
  const frame = document.getElementById("previewModalFrame");
  const idActions = document.getElementById("previewModalIdActions");
  const productActions = document.getElementById("previewModalProductActions");
  if (!modal || !product) return;

  productPreviewContext = { productId: product.id, shopClientId };
  const images = Array.isArray(product.images) ? product.images : [];
  const firstImg = images[0];
  const hasImage = firstImg && /^(https?:\/\/|data:image\/|blob:)/i.test(String(firstImg));

  if (frame) {
    frame.src = "";
    frame.style.display = "none";
  }
  if (idActions) idActions.style.display = "none";
  if (productActions) productActions.style.display = "flex";

  if (img) {
    if (hasImage) {
      img.src = firstImg;
      img.style.display = "block";
    } else {
      img.src = "";
      img.style.display = "none";
    }
  }

  document.getElementById("previewModalTitle").textContent = product.name;
  document.getElementById("previewModalDetail").innerHTML = `
    <p><strong>Prix:</strong> ${product.price || `${product.priceAmount || 0} F`}</p>
    <p><strong>Catégorie:</strong> ${product.category || product.shopCategory || "Non catégorisé"}</p>
    <p><strong>Boutique:</strong> ${product.shopName || ""}</p>
    <p><strong>Description:</strong> ${product.description || ""}</p>
    <div style="display:flex;gap:0.5rem;margin-top:1rem;flex-wrap:wrap;">
      ${images.map((image, index) => {
        const src = String(image || "");
        if (/^(https?:\/\/|data:image\/|blob:)/i.test(src)) {
          return `<img src="${src}" style="width:88px;height:88px;object-fit:cover;border-radius:var(--radius-sm);border:2px solid var(--border-color);cursor:pointer;" alt="Image ${index + 1}" onclick="document.getElementById('previewModalImage').src='${src}';document.getElementById('previewModalImage').style.display='block';">`;
        }
        return `<span style="font-size:2rem;">${src || "📦"}</span>`;
      }).join("")}
    </div>
    <p style="margin-top:0.5rem;font-size:0.8rem;color:var(--text-light);"><i class="fas fa-images"></i> ${images.length} image(s)</p>
  `;
  modal.classList.add("active");
}

window.getPendingProducts = () => pendingProductsSnapshot.slice();

window.previewProduct = (productId, shopClientId) => {
  const product = productByClientId(productId, shopClientId);
  if (!product) {
    toast("error", "Produit introuvable", "Ce produit n'est plus disponible pour modération.");
    return;
  }
  showProductPreviewModal(product, shopClientId ?? resolveShopClientId(product));
};

window.approveProductFromPreview = () => {
  if (!productPreviewContext) return;
  const { productId, shopClientId } = productPreviewContext;
  productPreviewContext = null;
  document.getElementById("previewModal")?.classList.remove("active");
  window.approveProduct(productId, shopClientId);
};

window.rejectProductFromPreview = () => {
  if (!productPreviewContext) return;
  const { productId, shopClientId } = productPreviewContext;
  productPreviewContext = null;
  document.getElementById("previewModal")?.classList.remove("active");
  window.rejectProduct(productId, shopClientId);
};

window.clearProductPreviewContext = () => {
  productPreviewContext = null;
};

window.renderProductModeration = () => {
  const list = document.getElementById("productModerationList");
  if (!list) return;

  const pendingProducts = window.getPendingProducts().map(product => ({
    ...product,
    shopClientId: resolveShopClientId(product)
  }));

  if (pendingProducts.length === 0) {
    list.innerHTML = '<p style="color:var(--text-light);text-align:center;padding:1rem 0;">Aucun produit en attente de validation.</p>';
    return;
  }

  list.innerHTML = pendingProducts.map(product => `
    <div class="product-item">
      <div class="product-preview" onclick="previewProduct(${product.id}, ${product.shopClientId ?? "null"})" style="cursor:pointer;" title="Voir le produit">
        ${productImageMarkup(product.images?.[0])}
      </div>
      <div class="product-info">
        <div class="product-name">${product.name}</div>
        <div class="product-detail">${product.price} • ${product.category || "Non catégorisé"} • Boutique: ${product.shopName || ""}</div>
        <div class="product-detail" style="font-size:0.65rem;color:var(--text-light);">${String(product.description || "").substring(0, 80)}${String(product.description || "").length > 80 ? "..." : ""}</div>
        <button type="button" class="btn btn-secondary btn-sm" style="margin-top:0.35rem;width:auto;padding:0.25rem 0.6rem;font-size:0.65rem;" onclick="previewProduct(${product.id}, ${product.shopClientId ?? "null"})">
          <i class="fas fa-eye"></i> Voir le produit
        </button>
      </div>
      <span class="product-status pending">⏳ En attente</span>
      <div class="product-actions">
        <button type="button" class="btn btn-success btn-sm" onclick="previewProduct(${product.id}, ${product.shopClientId ?? "null"})" title="Voir puis valider"><i class="fas fa-eye"></i></button>
        <button type="button" class="btn btn-success btn-sm" onclick="approveProduct(${product.id}, ${product.shopClientId ?? "null"})"><i class="fas fa-check"></i></button>
        <button type="button" class="btn btn-danger btn-sm" onclick="rejectProduct(${product.id}, ${product.shopClientId ?? "null"})"><i class="fas fa-times"></i></button>
        <button type="button" class="btn btn-danger btn-sm" onclick="deleteProductAdmin(${product.id}, ${product.shopClientId ?? "null"})" title="Supprimer le produit"><i class="fas fa-trash"></i></button>
      </div>
    </div>
  `).join("");
};

function categoryBannerByClientId(clientId) {
  const fromState = (ui.getState().categorySponsors || ui.getState().categoryBanners || [])
    .find(banner => Number(banner.id) === Number(clientId));
  return fromState
    || categoryBannersSnapshot.find(banner => Number(banner.id) === Number(clientId));
}

let identityPreviewShopId = null;
const identityBlobCache = new Map();

function isPdfIdentityUrl(url) {
  return /\.pdf($|\?)/i.test(String(url || ""));
}

async function fetchIdentityBlobUrl(idCardUrl) {
  if (!idCardUrl) return null;
  if (identityBlobCache.has(idCardUrl)) return identityBlobCache.get(idCardUrl);
  if (!getToken()) return null;
  const response = await fetch(idCardUrl, {
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "X-Platform-Country": services?.country || "SN"
    }
  });
  if (!response.ok) {
    console.warn("Identity preview failed", response.status, idCardUrl);
    return null;
  }
  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  identityBlobCache.set(idCardUrl, blobUrl);
  return blobUrl;
}

function showIdentityPreviewModal(shop, blobUrl) {
  const modal = document.getElementById("previewModal");
  const img = document.getElementById("previewModalImage");
  const frame = document.getElementById("previewModalFrame");
  const actions = document.getElementById("previewModalIdActions");
  const productActions = document.getElementById("previewModalProductActions");
  if (!modal || !img || !shop || !blobUrl) return;

  identityPreviewShopId = shop.id;
  productPreviewContext = null;
  const isPdf = isPdfIdentityUrl(shop.idCardUrl || shop.idCard);
  if (frame) {
    frame.style.display = isPdf ? "block" : "none";
    frame.src = isPdf ? blobUrl : "";
  }
  img.style.display = isPdf ? "none" : "block";
  img.src = isPdf ? "" : blobUrl;

  document.getElementById("previewModalTitle").textContent = `Pièce d'identité - ${shop.name}`;
  document.getElementById("previewModalDetail").innerHTML = `
    <p><strong>Email:</strong> ${shop.ownerEmail || shop.email || ""}</p>
    <p><strong>Téléphone:</strong> ${shop.phone || shop.ownerPhone || ""}</p>
    <p><strong>Ouverture:</strong> ${shop.openingFor === "myself" ? "Pour moi-même" : "Pour un tiers"}</p>
    ${shop.agentCode ? `<p><strong>Agent:</strong> ${shop.agentCode}</p>` : ""}
  `;
  if (actions) actions.style.display = shop.idVerified ? "none" : "flex";
  if (productActions) productActions.style.display = "none";
  modal.classList.add("active");
}

window.previewIdCard = async shopId => {
  const shop = shopByClientId(shopId);
  const idCardUrl = shop?.idCardUrl || shop?.idCard;
  if (!shop || !idCardUrl || !String(idCardUrl).includes("/uploads/identity/")) {
    toast("error", "Document indisponible", "Aucune pièce d'identité n'a été trouvée pour cette boutique.");
    return;
  }
  if (!getToken()) {
    toast("error", "Connexion requise", "Connectez-vous en admin pour consulter ce document.");
    return;
  }
  const blobUrl = await fetchIdentityBlobUrl(idCardUrl);
  if (!blobUrl) {
    toast("error", "Accès refusé", "Impossible d'ouvrir le document. Vérifiez votre session admin.");
    return;
  }
  showIdentityPreviewModal(shop, blobUrl);
};

window.verifyIdFromPreview = verified => {
  if (identityPreviewShopId == null) return;
  const shopId = identityPreviewShopId;
  identityPreviewShopId = null;
  const modal = document.getElementById("previewModal");
  if (modal) modal.classList.remove("active");
  window.verifyId(shopId, verified);
};

window.loadIdentityPreviews = async () => {
  const previews = document.querySelectorAll("[data-id-card-url]");
  await Promise.all(Array.from(previews).map(async node => {
    const url = node.getAttribute("data-id-card-url");
    if (!url || !String(url).includes("/uploads/identity/")) {
      node.textContent = "📄";
      return;
    }
    const blobUrl = await fetchIdentityBlobUrl(url);
    if (!blobUrl) {
      node.innerHTML = '<span style="font-size:0.55rem;padding:0.2rem;text-align:center;">Voir</span>';
      return;
    }
    if (isPdfIdentityUrl(url)) {
      node.innerHTML = '<span style="font-size:0.55rem;font-weight:700;">PDF</span>';
      return;
    }
    node.innerHTML = `<img src="${blobUrl}" alt="Pièce d'identité">`;
  }));
};

window.saveRentConfig = () => runAction(async () => {
  const rentAmount = Number(document.getElementById("rentAmountInput").value);
  if (!Number.isInteger(rentAmount) || rentAmount < 1) throw new Error("Le loyer doit être un montant positif.");
  await backend("adminSetRentConfig", { rentAmount });
  await refreshCurrentData();
  toast("success", "✅ Loyer configuré", `Le loyer mensuel est maintenant de ${rentAmount.toLocaleString("fr-FR")} F.`);
}, "Configuration impossible");

window.changeAdminPassword = () => runAction(async () => {
  const currentPassword = String(document.getElementById("adminCurrentPasswordInput")?.value || "");
  const newPassword = String(document.getElementById("adminNewPasswordInput")?.value || "");
  const confirmPassword = String(document.getElementById("adminConfirmPasswordInput")?.value || "");
  if (!currentPassword || !newPassword || !confirmPassword) {
    throw new Error("Veuillez remplir tous les champs.");
  }
  if (newPassword.length < 8) {
    throw new Error("Le nouveau mot de passe doit contenir au moins 8 caractères.");
  }
  if (newPassword !== confirmPassword) {
    throw new Error("Les mots de passe ne correspondent pas.");
  }
  await backend("adminChangePassword", {
    currentPassword,
    newPassword,
    confirmPassword
  });
  document.getElementById("adminCurrentPasswordInput").value = "";
  document.getElementById("adminNewPasswordInput").value = "";
  document.getElementById("adminConfirmPasswordInput").value = "";
  toast("success", "✅ Mot de passe modifié", "Votre mot de passe administrateur a été mis à jour.");
}, "Changement impossible");

window.saveContactConfig = () => runAction(async () => {
  const contactPhone = String(document.getElementById("contactPhoneInput")?.value || "").trim();
  const contactEmail = String(document.getElementById("contactEmailInput")?.value || "").trim();
  const contactAddress = String(document.getElementById("contactAddressInput")?.value || "").trim();
  const socialFacebook = String(document.getElementById("socialFacebookInput")?.value || "").trim();
  const socialInstagram = String(document.getElementById("socialInstagramInput")?.value || "").trim();
  const socialTwitter = String(document.getElementById("socialTwitterInput")?.value || "").trim();
  const socialWhatsapp = String(document.getElementById("socialWhatsappInput")?.value || "").trim();
  const socialTiktok = String(document.getElementById("socialTiktokInput")?.value || "").trim();
  if (!contactPhone && !contactEmail && !contactAddress &&
      !socialFacebook && !socialInstagram && !socialTwitter && !socialWhatsapp && !socialTiktok) {
    throw new Error("Renseignez au moins un champ de contact ou un lien social.");
  }
  await backend("adminSetPlatformBranding", {
    contactPhone,
    contactEmail,
    contactAddress,
    socialFacebook,
    socialInstagram,
    socialTwitter,
    socialWhatsapp,
    socialTiktok
  });
  await refreshCurrentData();
  toast("success", "✅ Contacts enregistrés", "Les informations de contact et les réseaux sociaux ont été mis à jour.");
}, "Configuration impossible");

window.saveSponsorPricing = () => runAction(async () => {
  const sponsorPrices = {
    "7days": Number(document.getElementById("sponsorPrice7days").value),
    "15days": Number(document.getElementById("sponsorPrice15days").value),
    "30days": Number(document.getElementById("sponsorPrice30days").value),
    "60days": Number(document.getElementById("sponsorPrice60days").value)
  };
  if (Object.values(sponsorPrices).some(price => !Number.isInteger(price) || price < 100)) {
    throw new Error("Tous les tarifs de sponsoring doivent être des montants valides.");
  }
  await backend("adminSetRentConfig", {
    rentAmount: ui.getState().rentAmount,
    sponsorPrices
  });
  await refreshCurrentData();
  toast("success", "✅ Tarifs enregistrés", "Les prix du sponsoring ont été mis à jour.");
}, "Configuration impossible");

window.addAgent = () => runAction(async () => {
  const name = document.getElementById("agentNameInput").value.trim();
  const phone = document.getElementById("agentPhoneInput").value.trim();
  const code = document.getElementById("agentCodeInput").value.trim() || `SM-${crypto.randomUUID().slice(0, 8)}`;
  const commission = Number(document.getElementById("agentCommissionInput").value);
  if (!name || !phone || !code) throw new Error("Veuillez remplir tous les champs de l'agent.");
  await backend("adminUpsertAgent", { name, phone, code, commission, active: true });
  document.getElementById("agentNameInput").value = "";
  document.getElementById("agentPhoneInput").value = "";
  document.getElementById("agentCommissionInput").value = "5";
  window.generateAgentCode();
  await refreshCurrentData();
  toast("success", "✅ Agent ajouté", `L'agent ${name} a été enregistré.`);
}, "Agent non enregistré");

window.toggleAgent = agentId => runAction(async () => {
  const agent = agentByClientId(agentId);
  if (!agent) throw new Error("Agent introuvable.");
  await backend("adminUpsertAgent", {
    agentId: agent.backendId,
    name: agent.name,
    phone: agent.phone,
    code: agent.code,
    commission: Number(agent.commission),
    active: !agent.active
  });
  await refreshCurrentData();
  toast("success", "Agent mis à jour", `${agent.name} est maintenant ${agent.active ? "inactif" : "actif"}.`);
}, "Mise à jour impossible");

window.deleteAgent = agentId => runAction(async () => {
  if (!confirm("Voulez-vous vraiment supprimer cet agent ?")) return;
  const agent = agentByClientId(agentId);
  if (!agent) throw new Error("Agent introuvable.");
  await backend("adminDeleteAgent", { agentId: agent.backendId });
  await refreshCurrentData();
  toast("success", "🗑️ Agent supprimé", `${agent.name} a été retiré.`);
}, "Suppression impossible");

window.addAdBanner = () => runAction(async () => {
  const title = document.getElementById("adTitle").value.trim();
  const subtitle = document.getElementById("adSub").value.trim();
  const link = document.getElementById("adLink").value.trim();
  const input = document.getElementById("adBannerInput");
  const file = input.files[0];
  if (!title || !subtitle) throw new Error("Veuillez remplir le nom et la description.");
  if (!file) throw new Error("Veuillez charger une image de bannière.");
  const image = await uploadPublicFile(file, "banner");
  await backend("adminUpsertBanner", {
    title,
    subtitle,
    image,
    link: link || undefined,
    position: ui.getState().adBanners.length,
    active: true
  });
  document.getElementById("adTitle").value = "";
  document.getElementById("adSub").value = "";
  document.getElementById("adLink").value = "";
  input.value = "";
  await refreshCurrentData();
  toast("success", "✅ Bannière ajoutée", `"${title}" a été ajoutée.`);
}, "Bannière non enregistrée");

window.removeAdBanner = bannerId => runAction(async () => {
  if (!confirm("Voulez-vous supprimer cette bannière publicitaire ?")) return;
  const banner = bannerByClientId(bannerId);
  if (!banner) throw new Error("Bannière introuvable.");
  await backend("adminDeleteBanner", { bannerId: banner.backendId });
  await refreshCurrentData();
  toast("success", "🗑️ Bannière supprimée", `"${banner.title}" a été supprimée.`);
}, "Suppression impossible");

window.removeLogo = () => runAction(async () => {
  await backend("adminSetPlatformBranding", { platformLogo: null });
  document.getElementById("logoUploadInput").value = "";
  await refreshCurrentData();
  toast("success", "Logo supprimé", "Le logo par défaut a été restauré.");
}, "Suppression impossible");

const legacyLogoInput = document.getElementById("logoUploadInput");
if (legacyLogoInput) {
  const logoInput = legacyLogoInput.cloneNode(true);
  legacyLogoInput.replaceWith(logoInput);
  logoInput.addEventListener("change", event => runAction(async () => {
    const file = event.target.files[0];
    if (!file) return;
    const platformLogo = await uploadPublicFile(file, "branding");
    await backend("adminSetPlatformBranding", { platformLogo });
    await refreshCurrentData();
    toast("success", "✅ Logo mis à jour", "Le logo de la plateforme a été enregistré.");
  }, "Logo non enregistré"));
}

const originalSelectPaymentMethod = window.selectPaymentMethod;
window.selectPaymentMethod = method => {
  if (typeof originalSelectPaymentMethod === "function") originalSelectPaymentMethod(method);
  const operatorField = document.getElementById("operatorField");
  const cardFields = document.getElementById("cardFields");
  if (operatorField) operatorField.style.display = "none";
  if (method === "visa" && cardFields) cardFields.style.display = "none";
};
if (typeof originalSelectPaymentMethod === "function") {
  window.selectPaymentMethod(ui.getState().selectedPaymentMethod);
}

function trackShopEvent(shopId, type) {
  if (!shopId || !services?.apiUrl) return;
  backend("recordShopEvent", { shopId, type }).catch(() => {});
}

const originalShowShopDetail = window.showShopDetail;
window.showShopDetail = shopId => {
  if (typeof originalShowShopDetail === "function") originalShowShopDetail(shopId);
  const shop = shopByClientId(shopId);
  if (shop?.backendId) trackShopEvent(shop.backendId, "visit");
};

document.addEventListener("click", event => {
  const link = event.target instanceof Element
    ? event.target.closest("[data-track-contact]")
    : null;
  if (!link) return;
  const trackedId = link.getAttribute("data-track-contact");
  const shop = shopByClientId(trackedId);
  if (shop?.backendId) trackShopEvent(shop.backendId, "contact");
});

initializeBackend();
