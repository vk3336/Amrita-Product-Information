// src/productPdf.js
import jsPDF from "jspdf";
import QRCode from "qrcode";

/* ------------------------------ helpers (NO PLACEHOLDERS) ------------------------------ */
function cleanStr(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}
function joinArr(val, sep = ", ") {
  if (Array.isArray(val)) return val.map(cleanStr).filter(Boolean).join(sep);
  return cleanStr(val);
}
function isNum(v) {
  const n = Number(v);
  return Number.isFinite(n);
}
function fmtNum(v, decimals = 2) {
  if (!isNum(v)) return "";
  const n = Number(v);
  const r = Math.round(n);
  if (Math.abs(n - r) < 1e-6) return String(r);
  return n.toFixed(decimals).replace(/\.?0+$/, "");
}
function stripHtml(html) {
  try {
    const div = document.createElement("div");
    div.innerHTML = String(html || "");
    return (div.textContent || div.innerText || "").trim();
  } catch {
    return String(html || "");
  }
}
function toUpperLabel(s) {
  const t = cleanStr(s);
  return t ? t.toUpperCase() : "";
}
function toKebabLower(s) {
  return cleanStr(s).toLowerCase().replace(/\s+/g, "-").replace(/-+/g, "-");
}
function pdfWrap(doc, text, maxW) {
  const t = cleanStr(text);
  if (!t) return [];
  return doc.splitTextToSize(t, maxW);
}

/* ✅ NEW: hyphen -> space (for supplyModel) */
function hyphenToSpace(v) {
  return cleanStr(v).replace(/-/g, " ").replace(/\s{2,}/g, " ").trim();
}

/* ✅ NEW: finish label rule:
   - "aaa-bbb" => "bbb"
   - if '=' exists, take RHS as safest (covers "aaa-bbb=bbb") */
function finishLabel(v) {
  const t = cleanStr(v);
  if (!t) return "";
  if (t.includes("=")) return cleanStr(t.split("=").pop());
  if (t.includes("-")) return cleanStr(t.split("-").pop());
  return t;
}
function joinFinish(val, sep = ", ") {
  if (Array.isArray(val)) return val.map(finishLabel).filter(Boolean).join(sep);
  return finishLabel(val);
}

/* -------- fit text to single line (prevents wrap/merge) -------- */
function fitOneLine(doc, text, maxW) {
  const t0 = cleanStr(text);
  if (!t0) return "";
  if (doc.getTextWidth(t0) <= maxW) return t0;

  const ell = "...";
  const ellW = doc.getTextWidth(ell);
  if (ellW >= maxW) return "";

  let lo = 0;
  let hi = t0.length;
  let best = "";

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const s = t0.slice(0, mid).trimEnd();
    const w = doc.getTextWidth(s) + ellW;
    if (w <= maxW) {
      best = s;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return (best || "").trimEnd() + ell;
}

/* ------------------------------ images ------------------------------ */
function getPrimaryImage(p) {
  const candidates = [
    p?.image1CloudUrl,
    p?.image1ThumbUrl,
    p?.image2CloudUrl,
    p?.image2ThumbUrl,
    p?.image3CloudUrl,
    p?.image3ThumbUrl,
  ]
    .map(cleanStr)
    .filter(Boolean);

  return candidates[0] || "";
}
async function toDataUrl(url) {
  const u = cleanStr(url);
  if (!u) return null;
  const res = await fetch(u, { mode: "cors" });
  if (!res.ok) throw new Error("Image fetch failed");
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

/* ---- get dataUrl intrinsic size (for perfect logo aspect) ---- */
async function getDataUrlSize(dataUrl) {
  const src = cleanStr(dataUrl);
  if (!src.startsWith("data:image/")) return null;
  return await new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({
        w: img.naturalWidth || img.width || 0,
        h: img.naturalHeight || img.height || 0,
      });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
function fitIntoBox(srcW, srcH, boxW, boxH) {
  if (!srcW || !srcH) return { w: boxW, h: boxH, scale: 1 };
  const s = Math.min(boxW / srcW, boxH / srcH);
  return { w: srcW * s, h: srcH * s, scale: s };
}

/* ------------------------------ shapes ------------------------------ */
function fillR(doc, x, y, w, h, rgb, r = 0) {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  if (r > 0) doc.roundedRect(x, y, w, h, r, r, "F");
  else doc.rect(x, y, w, h, "F");
}
function strokeR(doc, x, y, w, h, rgb, r = 0, lw = 0.2) {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
  doc.setLineWidth(lw);
  if (r > 0) doc.roundedRect(x, y, w, h, r, r, "S");
  else doc.rect(x, y, w, h, "S");
}
function pill(
  doc,
  x,
  y,
  text,
  { bg, fg, padX = 4.2, h = 7.2, r = 3.6, fontSize = 7.2, bold = true } = {},
) {
  const t = cleanStr(text);
  if (!t) return { w: 0 };
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(fontSize);
  const w = doc.getTextWidth(t) + padX * 2;
  fillR(doc, x, y, w, h, bg, r);
  doc.setTextColor(fg[0], fg[1], fg[2]);
  doc.text(t, x + padX, y + h * 0.68);
  return { w };
}

/* ------------------------------ link helpers ------------------------------ */
function normalizeTel(s) {
  return cleanStr(s).replace(/[^\d+]/g, "").trim();
}
function normalizeWaDigits(s) {
  return cleanStr(s).replace(/[^\d]/g, "").trim();
}
function normalizeUrl(u) {
  const s = cleanStr(u);
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return "https:" + s;
  return "https://" + s;
}
function normalizeEmail(s) {
  return cleanStr(s);
}
function looksLikeEmail(s) {
  const t = cleanStr(s);
  return !!t && /@/.test(t);
}

/* ------------------------------ QR helper ------------------------------ */
async function makeQrDataUrl(data) {
  const d = cleanStr(data);
  if (!d) return null;
  try {
    return await QRCode.toDataURL(d, {
      errorCorrectionLevel: "M",
      margin: 0,
      width: 420,
      color: { dark: "#0F172A", light: "#FFFFFF" },
    });
  } catch {
    return null;
  }
}

/* ------------------------------ Stars (NO BORDER / correct partial) ------------------------------ */
function normalizeRatingTo5(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  if (n <= 5) return Math.max(0, Math.min(5, n));
  if (n <= 10) return Math.max(0, Math.min(5, n / 2));
  if (n <= 100) return Math.max(0, Math.min(5, (n * 5) / 100));
  return 5;
}
function buildStarPoints(cx, cy, size) {
  const outer = size / 2;
  const inner = outer * 0.38;
  const pts = [];
  for (let i = 0; i < 5; i++) {
    const oa = Math.PI / 2 + (i * 2 * Math.PI) / 5;
    pts.push({ x: cx + outer * Math.cos(oa), y: cy - outer * Math.sin(oa) });
    const ia = oa + Math.PI / 5;
    pts.push({ x: cx + inner * Math.cos(ia), y: cy - inner * Math.sin(ia) });
  }
  return { pts, outer };
}
function starPath(doc, pts) {
  doc.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) doc.lineTo(pts[i].x, pts[i].y);
  doc.close();
}
function fillStar(doc, pts, rgb) {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  starPath(doc, pts);
  doc.fill();
}
function drawStarNoStroke(doc, cx, cy, size, fillPercent, goldColor, emptyColor) {
  const { pts, outer } = buildStarPoints(cx, cy, size);
  const fill = Math.max(0, Math.min(1, Number(fillPercent) || 0));

  fillStar(doc, pts, emptyColor);
  if (fill <= 0) return;

  if (fill >= 1) {
    fillStar(doc, pts, goldColor);
    return;
  }

  try {
    doc.saveGraphicsState();

    starPath(doc, pts);
    doc.clip();
    if (doc.discardPath) doc.discardPath();

    doc.setFillColor(goldColor[0], goldColor[1], goldColor[2]);
    const left = cx - outer;
    const top = cy - outer;
    doc.rect(left, top, outer * 2 * fill, outer * 2, "F");

    doc.restoreGraphicsState();
  } catch {
    if (fill >= 0.5) fillStar(doc, pts, goldColor);
  }
}
function drawStars(doc, x, yCenter, ratingValue, opts = {}) {
  const r = normalizeRatingTo5(ratingValue);
  if (r === null) return;

  const size = Number(opts.size ?? 3.0);
  const gap = Number(opts.gap ?? 0.5);

  const goldColor = [245, 158, 11];
  const emptyColor = [203, 213, 225];

  let cx = x + size / 2;
  for (let i = 1; i <= 5; i++) {
    const starStart = i - 1;
    const starEnd = i;

    let fillPercent = 0;
    if (r >= starEnd) fillPercent = 1;
    else if (r > starStart) fillPercent = r - starStart;

    drawStarNoStroke(doc, cx, yCenter, size, fillPercent, goldColor, emptyColor);
    cx += size + gap;
  }
}

/* ------------------------------ Suitability (dynamic, NO "-" placeholders) ------------------------------ */
function normalizeSuitabilityText(s) {
  return cleanStr(s)
    .replace(/\b\d{1,3}\s*%\b/g, "")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
function parseSuitabilityItem(line) {
  const raw = cleanStr(line);
  if (!raw) return null;

  const parts = raw
    .split("|")
    .map((x) => cleanStr(x))
    .filter(Boolean);
  if (parts.length < 2) return null;

  const seg = normalizeSuitabilityText(parts[0]);
  const pctMatch = raw.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  const pct = pctMatch ? Number(pctMatch[1]) : null;

  const usePart = parts.length >= 3 ? parts.slice(1, -1).join(" - ") : parts[1];
  const use = normalizeSuitabilityText(usePart);

  if (!seg || !use) return null;
  return { seg, use, pct: Number.isFinite(pct) ? pct : null };
}
function joinNice(arr) {
  const a = (arr || []).map(cleanStr).filter(Boolean);
  if (!a.length) return "";
  if (a.length === 1) return a[0];
  if (a.length === 2) return `${a[0]} and ${a[1]}`;
  return `${a.slice(0, -1).join(", ")}, and ${a[a.length - 1]}`;
}
function isHomeOrAccessory(seg) {
  const s = cleanStr(seg).toLowerCase();
  return (
    s.includes("home") ||
    s.includes("accessor") ||
    s.includes("uniform") ||
    s.includes("workwear") ||
    s.includes("work wear") ||
    s.includes("work")
  );
}
function buildSuitabilityBulletsDynamic(p, { maxUsesPerSeg = 3, showPercent = false } = {}) {
  const items = (p?.suitability || []).map(parseSuitabilityItem).filter(Boolean);

  const map = new Map();
  for (const it of items) {
    if (!map.has(it.seg)) map.set(it.seg, new Map());
    const useMap = map.get(it.seg);
    const key = it.use;
    const prev = useMap.get(key);
    const prevPct = prev?.pct ?? -1;
    const nextPct = it.pct ?? -1;
    if (!prev || nextPct > prevPct) useMap.set(key, { use: key, pct: it.pct });
  }

  const groups = [];
  for (const [seg, useMap] of map.entries()) {
    const uses = Array.from(useMap.values())
      .filter((u) => cleanStr(u.use))
      .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))
      .slice(0, maxUsesPerSeg);

    const labels = uses.map((u) =>
      showPercent && u.pct != null ? `${u.use} (${fmtNum(u.pct, 0)}%)` : u.use,
    );

    const sentence = joinNice(labels);
    if (!sentence) continue;

    groups.push({
      label: seg,
      text: `${sentence}.`,
      _home: isHomeOrAccessory(seg),
      _score: uses[0]?.pct ?? 0,
    });
  }

  groups.sort((a, b) => (b._score ?? 0) - (a._score ?? 0));

  const apparel = groups.filter((g) => !g._home).map(({ label, text }) => ({ label, text }));
  const homeAcc = groups.filter((g) => g._home).map(({ label, text }) => ({ label, text }));

  return { apparel, homeAcc };
}

/* ------------------------------ footer icons ------------------------------ */
function footerCircle(doc, cx, cy, r, fill) {
  doc.setFillColor(fill[0], fill[1], fill[2]);
  doc.circle(cx, cy, r, "F");
}
function setIconStroke(doc, w = 0.95) {
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(w);
  if (typeof doc.setLineCap === "function") doc.setLineCap(1);
  if (typeof doc.setLineJoin === "function") doc.setLineJoin(1);
}
function drawPhoneIcon(doc, cx, cy, r) {
  setIconStroke(doc, 0.95);
  const a = r * 0.62;
  const b = r * 0.3;

  doc.line(cx - a, cy - b, cx - r * 0.15, cy - r * 0.62);
  doc.line(cx - r * 0.15, cy - r * 0.62, cx + a * 0.75, cy - b * 0.35);

  doc.line(cx - a * 0.75, cy + b * 0.35, cx + r * 0.15, cy + r * 0.62);
  doc.line(cx + r * 0.15, cy + r * 0.62, cx + a, cy + b);

  doc.line(cx - r * 0.1, cy - r * 0.05, cx + r * 0.1, cy + r * 0.05);
}
function drawWhatsappIcon(doc, cx, cy, r) {
  setIconStroke(doc, 0.85);

  doc.circle(cx, cy - 0.15, r * 0.7, "S");

  doc.line(cx - r * 0.22, cy + r * 0.45, cx - r * 0.52, cy + r * 0.78);
  doc.line(cx - r * 0.52, cy + r * 0.78, cx - r * 0.1, cy + r * 0.62);

  doc.setLineWidth(0.85);
  doc.line(cx - r * 0.24, cy - r * 0.02, cx - r * 0.04, cy - r * 0.2);
  doc.line(cx - r * 0.04, cy - r * 0.2, cx + r * 0.2, cy - r * 0.02);
  doc.line(cx - r * 0.18, cy + r * 0.06, cx - r * 0.02, cy + r * 0.22);
  doc.line(cx - r * 0.02, cy + r * 0.22, cx + r * 0.22, cy + r * 0.06);
}
function drawMailIcon(doc, cx, cy, r) {
  setIconStroke(doc, 0.95);

  const w = r * 1.55;
  const h = r * 1.08;
  const x = cx - w / 2;
  const y = cy - h / 2;

  doc.rect(x, y, w, h, "S");
  const midY = y + h * 0.58;
  doc.line(x, y, cx, midY);
  doc.line(x + w, y, cx, midY);
  doc.line(x, y + h, x + w, y + h);
}

/* ------------------------------ Company Information (dynamic, NO DEFAULT FALLBACKS) ------------------------------ */
const _ENV = typeof import.meta !== "undefined" ? import.meta.env || {} : {};
const DEFAULT_COMPANY_INFO_URL = cleanStr(_ENV.VITE_COMPANY_INFORMATION).replace(/\/$/, "");
const DEFAULT_ESPO_API_KEY = cleanStr(_ENV.VITE_X_API_KEY);
const DEFAULT_COMPANY_INFO_ID = cleanStr(_ENV.VITE_COMPANY_INFORMATION_ID);

/* ✅ NEW: Product list base for options count */
const DEFAULT_PRODUCT_LIST_URL = cleanStr(_ENV.VITE_ESPO_BASEURL).replace(/\/$/, "");

let _companyInfoCache = null;
let _companyInfoPromise = null;

function buildAddressLineFromCompany(ci) {
  const street = cleanStr(ci?.addressStreet);
  const city = cleanStr(ci?.addressCity);
  const state = cleanStr(ci?.addressState);
  const country = cleanStr(ci?.addressCountry);
  const pin = cleanStr(ci?.addressPostalCode);

  const parts = [street, city, state, country].filter(Boolean);
  const base = parts.join(", ");
  if (!base && pin) return pin;
  if (base && pin) return `${base} ${pin}`;
  return base;
}

function pickCompanyRecord(list, { preferId } = {}) {
  const arr = Array.isArray(list) ? list.filter((x) => !x?.deleted) : [];
  if (!arr.length) return null;

  const byId = preferId ? arr.find((x) => cleanStr(x?.id) === cleanStr(preferId)) : null;
  if (byId) return byId;

  const sorted = [...arr].sort(
    (a, b) => Number(b?.versionNumber || 0) - Number(a?.versionNumber || 0),
  );
  return sorted[0] || null;
}

async function fetchCompanyInformation({
  url = DEFAULT_COMPANY_INFO_URL,
  apiKey = DEFAULT_ESPO_API_KEY,
  preferId = DEFAULT_COMPANY_INFO_ID,
} = {}) {
  const base = cleanStr(url);
  if (!base) return null;

  try {
    const u = new URL(base);
    if (!u.searchParams.has("maxSize")) u.searchParams.set("maxSize", "200");
    if (!u.searchParams.has("sortBy")) u.searchParams.set("sortBy", "versionNumber");
    if (!u.searchParams.has("sortDirection")) u.searchParams.set("sortDirection", "DESC");

    const headers = {};
    if (apiKey) {
      headers["X-Api-Key"] = apiKey;
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const res = await fetch(u.toString(), { headers, mode: "cors" });
    if (!res.ok) return null;

    const data = await res.json();
    return pickCompanyRecord(data?.list, { preferId }) || null;
  } catch {
    return null;
  }
}

async function getCompanyInformationCached(opts = {}) {
  if (_companyInfoCache) return _companyInfoCache;
  if (_companyInfoPromise) return _companyInfoPromise;

  _companyInfoPromise = (async () => {
    const ci = await fetchCompanyInformation(opts);
    _companyInfoCache = ci || null;
    _companyInfoPromise = null;
    return _companyInfoCache;
  })();

  return _companyInfoPromise;
}

/* ✅ NEW: Options count by collectionId (manual count, ignores negative total) */
const _collectionCountCache = new Map();   // collectionId -> number
const _collectionCountPromise = new Map(); // collectionId -> Promise<number|null>

async function fetchCollectionProductCount({
  productUrl = DEFAULT_PRODUCT_LIST_URL,
  apiKey = DEFAULT_ESPO_API_KEY,
  collectionId,
  pageSize = 200,
  maxPages = 200, // safety
} = {}) {
  const base = cleanStr(productUrl);
  const cid = cleanStr(collectionId);
  if (!base || !cid) return null;

  const headers = {};
  if (apiKey) {
    headers["X-Api-Key"] = apiKey;
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  let offset = 0;
  let count = 0;

  for (let page = 0; page < maxPages; page++) {
    try {
      const u = new URL(base);

      u.searchParams.set("maxSize", String(pageSize));
      u.searchParams.set("offset", String(offset));

      // where[0] deleted=false
      u.searchParams.set("where[0][type]", "equals");
      u.searchParams.set("where[0][attribute]", "deleted");
      u.searchParams.set("where[0][value]", "false");

      // where[1] collectionId=cid
      u.searchParams.set("where[1][type]", "equals");
      u.searchParams.set("where[1][attribute]", "collectionId");
      u.searchParams.set("where[1][value]", cid);

      const res = await fetch(u.toString(), { headers, mode: "cors" });
      if (!res.ok) break;

      const data = await res.json();
      const list = Array.isArray(data?.list) ? data.list : [];

      // ✅ manual count (ignore "total" completely)
      count += list.length;

      if (list.length < pageSize) break; // last page
      offset += pageSize;
    } catch {
      break;
    }
  }

  return count;
}

async function getCollectionProductCountCached(opts = {}) {
  const cid = cleanStr(opts?.collectionId);
  if (!cid) return null;

  if (_collectionCountCache.has(cid)) return _collectionCountCache.get(cid);
  if (_collectionCountPromise.has(cid)) return _collectionCountPromise.get(cid);

  const prom = (async () => {
    const n = await fetchCollectionProductCount(opts);
    if (Number.isFinite(n)) _collectionCountCache.set(cid, n);
    else _collectionCountCache.set(cid, null);
    _collectionCountPromise.delete(cid);
    return _collectionCountCache.get(cid);
  })();

  _collectionCountPromise.set(cid, prom);
  return prom;
}

/* ------------------------------ width/weight (NO "-" placeholders) ------------------------------ */
function getWidthText(p) {
  const cm = p?.cm;
  const inch = p?.inch;
  if (isNum(cm) && isNum(inch)) return `${fmtNum(cm, 0)} cm / ${fmtNum(inch, 0)} inch`;
  if (isNum(inch)) return `${fmtNum(inch, 0)} inch`;
  if (isNum(cm)) return `${fmtNum(cm, 0)} cm`;
  return "";
}
function getWeightText(p) {
  const gsm = isNum(p?.gsm) ? fmtNum(p.gsm, 0) : "";
  const oz = isNum(p?.ozs) ? fmtNum(p.ozs, 1) : "";
  if (gsm && oz) return `${gsm} gsm / ${oz} oz`;
  if (gsm) return `${gsm} gsm`;
  if (oz) return `${oz} oz`;
  return "";
}

/* ------------------------------ main export ------------------------------ */
export async function downloadProductPdf(
  p,
  {
    productUrl,
    qrDataUrl,
    logoPath = "/logo1.png",

    companyInfoUrl = DEFAULT_COMPANY_INFO_URL,
    companyInfoId = DEFAULT_COMPANY_INFO_ID,
    espoApiKey = DEFAULT_ESPO_API_KEY,

    // ✅ NEW: used to compute options count from API
    productListUrl = DEFAULT_PRODUCT_LIST_URL,
    collectionId, // pass selected collectionId here (NOT static)

    // optional manual overrides (if passed, they win)
    companyName,
    phone1,
    phone2,
    email,
    addressLine,

    // IMPORTANT: if explicitly passed, it wins
    optionsCount,
  } = {},
) {
  // company info once (cached)
  const ci = await getCompanyInformationCached({
    url: companyInfoUrl,
    apiKey: espoApiKey,
    preferId: companyInfoId,
  });

  // dynamic fields (NO hardcoded fallback strings)
  const dynamicCompanyName = cleanStr(companyName) || cleanStr(ci?.legalName) || cleanStr(ci?.name);
  const dynamicPhone1 = cleanStr(phone1) || cleanStr(ci?.phone1);
  const dynamicPhone2 = cleanStr(phone2) || cleanStr(ci?.whatsappNumber);
  const dynamicEmail = cleanStr(email) || cleanStr(ci?.primaryEmail);
  const dynamicAddress =
    cleanStr(addressLine) || buildAddressLineFromCompany(ci) || cleanStr(ci?.addressStreet);

  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // palette
  const BORDER = [226, 232, 240];
  const TEXT = [15, 23, 42];
  const PILL_BLUE = [30, 58, 138];
  const PILL_TEAL = [13, 116, 110];
  const AMBER_BG = [255, 247, 204];
  const GOLD_LINE = [201, 162, 106];
  const GOLD_LINE_DARK = [122, 92, 52];
  const BULLET = [201, 162, 106];

  // bg
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageW, pageH, "F");

  const code = cleanStr(p?.fabricCode);
  const title = cleanStr(p?.productTitle);
  const tagline = cleanStr(p?.productTagline);
  const shortDesc = cleanStr(p?.shortProductDescription);

  const categoryPill = toUpperLabel(p?.category);
  const supplyPill = hyphenToSpace(p?.supplyModel);

  const rawRating =
    p?.ratingValue !== undefined && p?.ratingValue !== null && cleanStr(p?.ratingValue) !== ""
      ? p?.ratingValue
      : p?.rating !== undefined && p?.rating !== null && cleanStr(p?.rating) !== ""
        ? p?.rating
        : p?.ratingPercent !== undefined && p?.ratingPercent !== null && cleanStr(p?.ratingPercent) !== ""
          ? p?.ratingPercent
          : null;

  /* ✅ UPDATED: options count priority
     1) explicit optionsCount
     2) API count by selected collectionId (manual list counting)
     3) fallback to p.optionsCount if exists */
  let optCount = Number.isFinite(Number(optionsCount)) ? Number(optionsCount) : null;

  if (optCount === null) {
    const cid =
      cleanStr(collectionId) ||
      cleanStr(p?.collectionId) ||
      cleanStr(p?.collection?.id);

    if (cid) {
      const n = await getCollectionProductCountCached({
        productUrl: productListUrl,
        apiKey: espoApiKey,
        collectionId: cid,
        pageSize: 200,
      });
      if (Number.isFinite(n)) optCount = Number(n);
    }

    if (optCount === null && Number.isFinite(Number(p?.optionsCount))) {
      optCount = Number(p.optionsCount);
    }
  }

  // links
  const productLink = productUrl ? normalizeUrl(productUrl) : "";

  // images
  const imgUrl = getPrimaryImage(p);
  let imgDataUrl = null;
  try {
    imgDataUrl = imgUrl ? await toDataUrl(imgUrl) : null;
  } catch {
    imgDataUrl = null;
  }

  let logoDataUrl = null;
  try {
    logoDataUrl = await toDataUrl(logoPath);
  } catch {
    logoDataUrl = null;
  }

  const logoSize = logoDataUrl ? await getDataUrlSize(logoDataUrl) : null;

  // dynamic QR
  let finalQrDataUrl = null;
  if (qrDataUrl && typeof qrDataUrl === "string") finalQrDataUrl = qrDataUrl;
  else if (productLink) finalQrDataUrl = await makeQrDataUrl(productLink);

  /* ------------------------------ HEADER ------------------------------ */
  const headerTop = 6.5;

  const logoBoxW = 22;
  const logoBoxH = 14.5;
  const gap = 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(23);
  doc.setTextColor(0, 0, 0);

  const headerCompanyName = cleanStr(dynamicCompanyName);
  const nameW = doc.getTextWidth(headerCompanyName || " ");
  const totalW = logoBoxW + gap + nameW;
  const startX = Math.max(10, (pageW - totalW) / 2);

  const logoX = startX;
  const logoY = headerTop;

  if (logoDataUrl) {
    const isPng = String(logoDataUrl).startsWith("data:image/png");
    const isJpeg =
      String(logoDataUrl).startsWith("data:image/jpeg") ||
      String(logoDataUrl).startsWith("data:image/jpg");
    const fmt = isPng ? "PNG" : isJpeg ? "JPEG" : "PNG";

    const srcW = logoSize?.w || 0;
    const srcH = logoSize?.h || 0;
    const fit = fitIntoBox(srcW, srcH, logoBoxW, logoBoxH);

    const drawW = fit.w || logoBoxW;
    const drawH = fit.h || logoBoxH;
    const dx = logoX + (logoBoxW - drawW) / 2;
    const dy = logoY + (logoBoxH - drawH) / 2;

    try {
      doc.addImage(logoDataUrl, fmt, dx, dy, drawW, drawH);
    } catch {}
  }

  if (headerCompanyName) doc.text(headerCompanyName, logoX + logoBoxW + gap, headerTop + 11.0);

  const lineY = headerTop + 17.2;
  doc.setDrawColor(GOLD_LINE[0], GOLD_LINE[1], GOLD_LINE[2]);
  doc.setLineWidth(0.9);
  doc.line(12, lineY, pageW - 12, lineY);
  doc.setDrawColor(GOLD_LINE_DARK[0], GOLD_LINE_DARK[1], GOLD_LINE_DARK[2]);
  doc.setLineWidth(0.2);
  doc.line(12, lineY + 1.1, pageW - 12, lineY + 1.1);

  /* ------------------------------ FOOTER RESERVED AREA ------------------------------ */
  const footerLineY = pageH - 32;
  const contentMaxY = footerLineY - 8;

  /* ------------------------------ HERO ------------------------------ */
  const M = 14;
  const heroTop = 27;

  const codeX = M + 2.5;

  if (code) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12.6);
    doc.setTextColor(0, 0, 0);
    doc.text(String(code), codeX, heroTop + 7.2);

    const codeW = doc.getTextWidth(String(code));
    doc.setDrawColor(GOLD_LINE_DARK[0], GOLD_LINE_DARK[1], GOLD_LINE_DARK[2]);
    doc.setLineWidth(0.4);
    doc.line(codeX, heroTop + 8.9, codeX + Math.min(codeW, 34), heroTop + 8.9);
  }

  // image card
  const imgX = M;
  const imgY = heroTop + 10;
  const imgW = 62;
  const imgH = 62;

  fillR(doc, imgX + 1.0, imgY + 1.0, imgW, imgH, [241, 245, 249], 2.8);
  fillR(doc, imgX, imgY, imgW, imgH, [255, 255, 255], 2.8);
  strokeR(doc, imgX, imgY, imgW, imgH, BORDER, 2.8, 0.25);

  if (imgDataUrl && typeof imgDataUrl === "string") {
    const isPng = imgDataUrl.startsWith("data:image/png");
    const isJpeg =
      imgDataUrl.startsWith("data:image/jpeg") || imgDataUrl.startsWith("data:image/jpg");
    const fmt = isPng ? "PNG" : isJpeg ? "JPEG" : null;
    if (fmt) {
      try {
        doc.addImage(imgDataUrl, fmt, imgX + 2, imgY + 2, imgW - 4, imgH - 4);
      } catch {}
    }
  }

  // options badge (inside image bottom-middle)
  if (Number.isFinite(optCount) && optCount >= 0) {
    const badgeW = 34;
    const badgeH = 7.0;

    const bx = imgX + (imgW - badgeW) / 2; // bottom-middle
    const by2 = imgY + imgH - badgeH - 7;

    fillR(doc, bx, by2, badgeW, badgeH, [67, 56, 202], 2.4);

    const icx = bx + 5;
    const icy = by2 + badgeH / 2 + 0.25;
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(0.45);
    doc.rect(icx - 1.25, icy - 1.25, 2.5, 2.5, "S");
    doc.line(icx - 1.25, icy - 1.25, icx, icy - 2.1);
    doc.line(icx + 1.25, icy - 1.25, icx, icy - 2.1);
    doc.line(icx, icy - 2.1, icx + 1.25, icy - 1.25);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.9);
    doc.setTextColor(255, 255, 255);
    doc.text(`${fmtNum(optCount, 0)}  Options`, bx + 8.2, by2 + badgeH * 0.68);
  }

  // right block
  const rightX = imgX + imgW + 12;
  const rightW = pageW - M - rightX;

  // pills
  const pillsY = heroTop + 10;
  let px = rightX;

  if (categoryPill) {
    const p1 = pill(doc, px, pillsY, categoryPill, {
      bg: PILL_BLUE,
      fg: [255, 255, 255],
      h: 7.2,
      r: 3.6,
      fontSize: 7.2,
      padX: 4.2,
      bold: true,
    });
    px += p1.w + 4;
  }

  if (supplyPill) {
    const p2 = pill(doc, px, pillsY, supplyPill, {
      bg: PILL_TEAL,
      fg: [255, 255, 255],
      h: 7.2,
      r: 3.6,
      fontSize: 7.2,
      padX: 4.2,
      bold: true,
    });
    px += p2.w + 4;
  }

  if (rawRating !== null) {
    const ratingPillH = 7.2;
    const ratingPillW = 44;
    fillR(doc, px, pillsY, ratingPillW, ratingPillH, AMBER_BG, 3.6);

    const STAR_SIZE = 3.0;
    const STAR_GAP = 0.5;
    const starsW = 5 * STAR_SIZE + 4 * STAR_GAP;
    const yCenter = pillsY + ratingPillH / 2 + 0.2;

    drawStars(doc, px + (ratingPillW - starsW) / 2, yCenter, rawRating, {
      size: STAR_SIZE,
      gap: STAR_GAP,
    });
  }

  /* ---- Title + Tagline ---- */
  const titleTopY = pillsY + 16.5;
  const textBottomY = imgY + imgH - 2.0;

  let titleSize = 19.2;
  const titleLH = 6.2;
  const tagSize = 10.8;
  const tagLH = 5.2;
  const minGap = 4.0;

  let titleLines = [];
  let tagLines = [];

  if (title) {
    for (let tries = 0; tries < 6; tries++) {
      doc.setFont("times", "bold");
      doc.setFontSize(titleSize);
      titleLines = pdfWrap(doc, title, rightW).slice(0, 3);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(tagSize);
      tagLines = pdfWrap(doc, tagline, rightW).slice(0, 2);

      const titleH = titleLines.length * titleLH;
      const tagH = tagLines.length * tagLH;
      const avail = textBottomY - titleTopY;

      if (titleH + (tagLines.length ? minGap : 0) + tagH <= avail || titleSize <= 13.2) break;
      titleSize -= 0.6;
    }

    doc.setFont("times", "bold");
    doc.setFontSize(titleSize);
    doc.setTextColor(0, 0, 0);
    doc.text(titleLines, rightX, titleTopY);

    const titleH2 = titleLines.length * titleLH;

    if (tagline) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(tagSize);
      doc.setTextColor(0, 0, 0);

      const tagH2 = tagLines.length * tagLH;
      const avail2 = textBottomY - titleTopY;
      const gap2 = Math.max(minGap, Math.min(14, avail2 - titleH2 - tagH2));
      const tagY = titleTopY + titleH2 + gap2;
      if (tagLines.length) doc.text(tagLines, rightX, tagY);
    }
  }

  /* ---------------- paragraph under hero ---------------- */
  const paraY = imgY + imgH + 10;
  if (shortDesc) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.8);
    doc.setTextColor(51, 65, 85);
    const paraW = pageW - M * 2;
    const paraLines = pdfWrap(doc, shortDesc, paraW).slice(0, 2);
    doc.text(paraLines, M, paraY);
  }

  /* ---------------- Specs table ---------------- */
  const tableX = M;
  const tableY = paraY + (shortDesc ? 10 : 0);
  const tableW = pageW - M * 2;
  const cellW = tableW / 2;

  const rowH = 12.8;
  const finishH = 16.0;
  const tableH = rowH * 4 + finishH;

  fillR(doc, tableX + 1.0, tableY + 1.0, tableW, tableH, [241, 245, 249], 2.8);
  fillR(doc, tableX, tableY, tableW, tableH, [248, 250, 252], 2.8);
  strokeR(doc, tableX, tableY, tableW, tableH, BORDER, 2.8, 0.25);

  doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
  doc.setLineWidth(0.25);
  doc.line(tableX + cellW, tableY, tableX + cellW, tableY + rowH * 4);
  for (let i = 1; i < 4; i++) doc.line(tableX, tableY + rowH * i, tableX + tableW, tableY + rowH * i);
  doc.line(tableX, tableY + rowH * 4, tableX + tableW, tableY + rowH * 4);

  function drawCell(x, y0, w, label, value, { boldValue = false } = {}) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.2);
    doc.setTextColor(30, 64, 175);
    doc.text(toUpperLabel(label), x + 8, y0 + 7.6);

    const v = cleanStr(value);
    if (!v) return;

    doc.setFont("helvetica", boldValue ? "bold" : "normal");
    doc.setFontSize(9.2);
    doc.setTextColor(TEXT[0], TEXT[1], TEXT[2]);

    const maxW = w - 26;
    const line = fitOneLine(doc, v, maxW) || v;
    const cx = x + w * 0.65;
    doc.text(line, cx, y0 + 7.6, { align: "center" });
  }

  drawCell(tableX, tableY + rowH * 0, cellW, "Content", joinArr(p?.content));
  drawCell(tableX + cellW, tableY + rowH * 0, cellW, "Width", getWidthText(p));

  drawCell(tableX, tableY + rowH * 1, cellW, "Weight", getWeightText(p));
  drawCell(tableX + cellW, tableY + rowH * 1, cellW, "Design", cleanStr(p?.design));

  drawCell(tableX, tableY + rowH * 2, cellW, "Structure", cleanStr(p?.structure), { boldValue: true });
  drawCell(tableX + cellW, tableY + rowH * 2, cellW, "Colors", joinArr(p?.color));

  drawCell(tableX, tableY + rowH * 3, cellW, "Motif", cleanStr(p?.motif));

  const moqVal = (() => {
    const moq = isNum(p?.salesMOQ) ? fmtNum(p.salesMOQ, 0) : cleanStr(p?.salesMOQ);
    if (!moq) return "";
    const um = cleanStr(p?.uM);
    return um ? `${moq} ${um}` : `${moq}`;
  })();
  drawCell(tableX + cellW, tableY + rowH * 3, cellW, "Sales MOQ", moqVal);

  const finishY = tableY + rowH * 4;
  const finishLabelW = 24;
  const valueX = tableX + finishLabelW;
  const valueW = tableW - finishLabelW;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.2);
  doc.setTextColor(30, 64, 175);
  doc.text("FINISH", tableX + 8, finishY + 8.0);

  const finishText = joinFinish(p?.finish);

  if (finishText) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.8);
    doc.setTextColor(TEXT[0], TEXT[1], TEXT[2]);
    const padLeft = 6;
    const maxTextW = valueW - 10;
    const finishLines = pdfWrap(doc, finishText, maxTextW).slice(0, 2);
    doc.text(finishLines, valueX + padLeft, finishY + 8.0);
  }

  /* ---------------- Suitability + QR ---------------- */
  const suit = buildSuitabilityBulletsDynamic(p, { maxUsesPerSeg: 3, showPercent: false });

  const showQr = !!finalQrDataUrl;
  const qrCardW = 34;
  const qrCardH = 42;
  const qrSize = 28;
  const qrGap = 10;

  let by = finishY + finishH + 9;

  const qrX = pageW - M - qrCardW;
  const qrY = Math.min(by - 2, contentMaxY - qrCardH);

  const leftMaxW = showQr ? qrX - M - qrGap : pageW - M * 2;

  if (showQr) {
    fillR(doc, qrX + 0.8, qrY + 0.8, qrCardW, qrCardH, [241, 245, 249], 2.8);
    fillR(doc, qrX, qrY, qrCardW, qrCardH, [255, 255, 255], 2.8);
    strokeR(doc, qrX, qrY, qrCardW, qrCardH, BORDER, 2.8, 0.25);

    try {
      doc.addImage(finalQrDataUrl, "PNG", qrX + (qrCardW - qrSize) / 2, qrY + 6, qrSize, qrSize);
    } catch {}

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.6);
    doc.setTextColor(30, 41, 59);
    doc.text("Scan for details", qrX + qrCardW / 2, qrY + 6 + qrSize + 7.2, { align: "center" });

    if (productLink) {
      try {
        doc.link(qrX, qrY, qrCardW, qrCardH, { url: productLink });
      } catch {}
    }
  }

  function drawBulletLine(x, y, label, text, maxW) {
    const lineH = 6.2;
    if (y + lineH > contentMaxY) return { y, drawn: false };

    const lblT = cleanStr(label);
    const bodyT = cleanStr(text);
    if (!lblT || !bodyT) return { y, drawn: false };

    doc.setFillColor(BULLET[0], BULLET[1], BULLET[2]);
    doc.circle(x + 2, y - 1.1, 0.7, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.8);
    doc.setTextColor(0, 0, 0);
    const lbl = `${lblT}:`;
    doc.text(lbl, x + 6, y);

    const lblW = doc.getTextWidth(lbl) + 1.6;
    const bodyX = x + 6 + lblW;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.8);
    doc.setTextColor(51, 65, 85);

    const bodyMax = Math.max(10, maxW - (bodyX - x));
    const body = fitOneLine(doc, bodyT, bodyMax) || bodyT;
    doc.text(body, bodyX, y);

    return { y: y + lineH, drawn: true };
  }

  if (by + 10 < contentMaxY && suit.apparel.length) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12.0);
    doc.setTextColor(0, 0, 0);
    doc.text("Apparel :", M, by);
    by += 7.2;

    for (const it of suit.apparel) {
      const r = drawBulletLine(M, by, it.label, it.text, leftMaxW);
      if (!r.drawn) break;
      by = r.y;
    }
    by += 2.0;
  }

  if (by + 10 < contentMaxY && suit.homeAcc.length) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12.0);
    doc.setTextColor(0, 0, 0);
    doc.text("Home & Accessories", M, by);
    by += 7.2;

    for (const it of suit.homeAcc) {
      const r = drawBulletLine(M, by, it.label, it.text, leftMaxW);
      if (!r.drawn) break;
      by = r.y;
    }
  }

  /* ---------------- FOOTER ---------------- */
  doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
  doc.setLineWidth(0.35);
  doc.line(M, pageH - 32, pageW - M, pageH - 32);

  const footerY = footerLineY + 10;
  const iconR = 4.0;

  const footerPhone1 = cleanStr(dynamicPhone1);
  const footerPhone2 = cleanStr(dynamicPhone2);
  const footerEmail = cleanStr(dynamicEmail);

  const tel1 = normalizeTel(footerPhone1);
  const wa2 = normalizeWaDigits(footerPhone2);

  const footerItems = [
    footerPhone1
      ? { text: footerPhone1, color: [194, 120, 62], icon: "phone", url: tel1 ? `tel:${tel1}` : "" }
      : null,
    footerPhone2
      ? { text: footerPhone2, color: [22, 163, 74], icon: "whatsapp", url: wa2 ? `https://wa.me/${wa2}` : "" }
      : null,
    footerEmail
      ? {
          text: footerEmail,
          color: [30, 64, 175],
          icon: "mail",
          url: looksLikeEmail(footerEmail) ? `mailto:${normalizeEmail(footerEmail)}` : "",
        }
      : null,
  ].filter(Boolean);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(30, 41, 59);

  const gapX = 10;
  const widths = footerItems.map((it) => iconR * 2 + 3 + doc.getTextWidth(it.text));
  const total = widths.reduce((a, b) => a + b, 0) + gapX * (footerItems.length - 1);
  let fx = Math.max(M, (pageW - total) / 2);

  for (let i = 0; i < footerItems.length; i++) {
    const it = footerItems[i];
    const cx = fx + iconR;
    const cy = footerY - 2;

    const itemW = widths[i];
    const clickX = fx;
    const clickY = footerY - 7.5;
    const clickH = 10.5;

    if (it.url) {
      try {
        doc.link(clickX, clickY, itemW, clickH, { url: it.url });
      } catch {}
    }

    footerCircle(doc, cx, cy, iconR, it.color);
    if (it.icon === "phone") drawPhoneIcon(doc, cx, cy, iconR);
    else if (it.icon === "whatsapp") drawWhatsappIcon(doc, cx, cy, iconR);
    else drawMailIcon(doc, cx, cy, iconR);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(30, 41, 59);
    doc.text(it.text, fx + iconR * 2 + 3, footerY);

    fx += itemW + gapX;
  }

  if (dynamicAddress) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    const addrLines = pdfWrap(doc, dynamicAddress, pageW - M * 2).slice(0, 2);
    doc.text(addrLines, pageW / 2, pageH - 10, { align: "center" });
  }

  if (productLink) {
    try {
      doc.link(M, 0, pageW - M * 2, pageH, { url: productLink });
    } catch {}
  }

  const fileName = code ? `${code}.pdf` : "product.pdf";
  doc.save(fileName);
}
