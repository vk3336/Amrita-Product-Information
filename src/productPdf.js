// src/productPdf.js
import jsPDF from "jspdf";
import QRCode from "qrcode";

/* ------------------------------ helpers ------------------------------ */
function safeJoin(val, sep = ", ") {
  if (Array.isArray(val)) return val.filter(Boolean).join(sep);
  if (val === null || val === undefined) return "";
  return String(val);
}
function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (Array.isArray(v)) {
      const s = v.filter(Boolean).join(", ");
      if (s) return s;
    } else if (typeof v === "string") {
      if (v.trim()) return v.trim();
    } else if (v !== null && v !== undefined) {
      return String(v);
    }
  }
  return "";
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
function fallbackImageSvg(text = "AGE") {
  const safe = String(text).replace(/</g, "").slice(0, 18);
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0f172a"/>
        <stop offset="1" stop-color="#0b7285"/>
      </linearGradient>
    </defs>
    <rect width="1200" height="1200" fill="url(#g)"/>
    <circle cx="940" cy="260" r="260" fill="rgba(255,255,255,0.10)"/>
    <circle cx="220" cy="980" r="320" fill="rgba(255,255,255,0.06)"/>
    <text x="90" y="640" font-size="140" font-family="Arial" font-weight="800" fill="white" opacity="0.95">
      ${safe}
    </text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
function getPrimaryImage(p) {
  return firstNonEmpty(
    p?.image1CloudUrl,
    p?.image1ThumbUrl,
    p?.image2CloudUrl,
    p?.image2ThumbUrl,
    p?.image3CloudUrl,
    p?.image3ThumbUrl
  );
}
function getDisplayCode(p) {
  return firstNonEmpty(p?.fabricCode, p?.vendorFabricCode, p?.name, p?.productslug, p?.id);
}
function getComposition(p) {
  return firstNonEmpty(safeJoin(p?.content), p?.composition);
}
function getFinish(p) {
  return firstNonEmpty(safeJoin(p?.finish), p?.finish);
}
function getStructure(p) {
  return firstNonEmpty(p?.structure, p?.weave);
}
function getWidthText(p) {
  const cm = p?.cm;
  const inch = p?.inch;
  if (isNum(cm) && isNum(inch)) return `${fmtNum(cm, 0)} cm / ${fmtNum(inch, 0)} inch`;
  if (isNum(inch)) return `${fmtNum(inch, 0)} inch`;
  if (isNum(cm)) return `${fmtNum(cm, 0)} cm`;
  return "-";
}
function getWeightText(p) {
  const gsm = isNum(p?.gsm) ? fmtNum(p.gsm, 0) : "";
  const oz = isNum(p?.ozs) ? fmtNum(p.ozs, 1) : "";
  if (gsm && oz) return `${gsm} gsm / ${oz} oz`;
  if (gsm) return `${gsm} gsm`;
  if (oz) return `${oz} oz`;
  return "-";
}
function toUpperLabel(s) {
  const t = String(s || "").trim();
  return t ? t.toUpperCase() : "";
}
function toKebabLower(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}
function pdfWrap(doc, text, maxW) {
  const t = String(text || "").trim();
  if (!t) return [];
  return doc.splitTextToSize(t, maxW);
}
async function toDataUrl(url) {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error("Image fetch failed");
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

/* ---- NEW: get dataUrl intrinsic size (for perfect logo aspect) ---- */
async function getDataUrlSize(dataUrl) {
  const src = String(dataUrl || "");
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
  { bg, fg, padX = 4.2, h = 7.2, r = 3.6, fontSize = 7.2, bold = true } = {}
) {
  const t = String(text || "").trim();
  if (!t) return { w: 0 };
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(fontSize);
  const w = doc.getTextWidth(t) + padX * 2;
  fillR(doc, x, y, w, h, bg, r);
  doc.setTextColor(fg[0], fg[1], fg[2]);
  doc.text(t, x + padX, y + h * 0.68);
  return { w };
}

/* -------- fit text to single line (prevents wrap/merge) -------- */
function fitOneLine(doc, text, maxW) {
  const t0 = String(text || "").trim();
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

/* ------------------------------ link helpers ------------------------------ */
function normalizeTel(s) {
  return String(s || "").replace(/[^\d+]/g, "").trim();
}
function normalizeWaDigits(s) {
  return String(s || "").replace(/[^\d]/g, "").trim(); // no +
}
function normalizeUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return "https:" + s;
  return "https://" + s;
}
function normalizeEmail(s) {
  return String(s || "").trim();
}
function looksLikeEmail(s) {
  const t = String(s || "").trim();
  return !!t && /@/.test(t);
}

/* ------------------------------ QR helper (dynamic per productUrl) ------------------------------ */
async function makeQrDataUrl(data) {
  const d = String(data || "").trim();
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

/* ------------------------------ Stars ------------------------------ */
function drawStarShape(doc, x, y, size, fillPercent, color, emptyColor) {
  const outerRadius = size / 2;
  const innerRadius = outerRadius * 0.38;

  const points = [];
  for (let i = 0; i < 5; i++) {
    const outerAngle = Math.PI / 2 + (i * 2 * Math.PI) / 5;
    points.push({ x: x + outerRadius * Math.cos(outerAngle), y: y - outerRadius * Math.sin(outerAngle) });
    const innerAngle = outerAngle + Math.PI / 5;
    points.push({ x: x + innerRadius * Math.cos(innerAngle), y: y - innerRadius * Math.sin(innerAngle) });
  }

  const drawStarPath = () => {
    doc.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) doc.lineTo(points[i].x, points[i].y);
    doc.close();
  };

  const fill = Math.max(0, Math.min(1, Number(fillPercent) || 0));
  doc.setLineWidth(0.18);

  if (fill === 0) {
    doc.setDrawColor(emptyColor[0], emptyColor[1], emptyColor[2]);
    drawStarPath();
    doc.stroke();
    return;
  }

  if (fill === 1) {
    doc.setFillColor(color[0], color[1], color[2]);
    doc.setDrawColor(color[0], color[1], color[2]);
    drawStarPath();
    if (typeof doc.fillStroke === "function") doc.fillStroke();
    else {
      doc.fill();
      doc.stroke();
    }
    return;
  }

  doc.setDrawColor(emptyColor[0], emptyColor[1], emptyColor[2]);
  drawStarPath();
  doc.stroke();

  doc.saveGraphicsState();
  const clipLeft = x - outerRadius;
  const clipTop = y - outerRadius;
  const clipWidth = outerRadius * 2 * fill;
  const clipHeight = outerRadius * 2;

  doc.rect(clipLeft, clipTop, clipWidth, clipHeight, null);
  doc.clip();
  if (doc.discardPath) doc.discardPath();

  doc.setFillColor(color[0], color[1], color[2]);
  doc.setDrawColor(color[0], color[1], color[2]);
  drawStarPath();
  doc.fill();

  doc.restoreGraphicsState();
}
function drawStars(doc, x, y, ratingValue, opts = {}) {
  const v = Number(ratingValue);
  const r = Number.isFinite(v) ? Math.max(0, Math.min(5, v)) : 0;
  const size = Number(opts.size ?? 3.0);
  const gap = Number(opts.gap ?? 0.5);

  const goldColor = [245, 158, 11];
  const emptyColor = [203, 213, 225];

  let currentX = x;
  for (let i = 1; i <= 5; i++) {
    const starStart = i - 1;
    const starEnd = i;

    let fillPercent = 0;
    if (r >= starEnd) fillPercent = 1.0;
    else if (r > starStart) fillPercent = r - starStart;

    drawStarShape(doc, currentX + size / 2, y, size, fillPercent, goldColor, emptyColor);
    currentX += size + gap;
  }
}

/* ------------------------------ Suitability -> bullets like screenshot ------------------------------ */
function normalizeSuitabilityText(s) {
  return String(s || "")
    .replace(/\b\d{1,3}\s*%\b/g, "")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
function parseSuitabilityLine(line) {
  const raw = String(line || "").trim();
  if (!raw) return null;
  const parts = raw.split("|").map((x) => x.trim()).filter(Boolean);
  const seg = normalizeSuitabilityText(parts[0] || "");
  const mid = parts.length >= 3 ? parts.slice(1, -1).join(" - ") : parts[1] || "";
  const use = normalizeSuitabilityText(mid);
  if (!seg) return null;
  return { seg, use: use || "-" };
}
function buildSuitabilityBulletsLikeImage(p) {
  const rows = (p?.suitability || []).map(parseSuitabilityLine).filter(Boolean);
  const bySeg = new Map();
  for (const r of rows) {
    if (!bySeg.has(r.seg)) bySeg.set(r.seg, new Set());
    const set = bySeg.get(r.seg);
    const parts = String(r.use || "")
      .split(/[,•]+/g)
      .map((x) => normalizeSuitabilityText(x))
      .filter(Boolean)
      .filter((x) => x !== "-");
    if (parts.length) parts.forEach((u) => set.add(u));
    else if (r.use && r.use !== "-") set.add(r.use);
  }
  const get = (...names) => {
    for (const n of names) if (bySeg.has(n)) return Array.from(bySeg.get(n));
    return [];
  };

  const mens = get("Menswear");
  const mensParts = [];
  const hasCasual = mens.some((x) => /Casual shirts/i.test(x));
  const hasShort = mens.some((x) => /short-sleeve/i.test(x));
  if (hasCasual && hasShort) mensParts.push("Casual or short-sleeve shirts");
  else if (hasCasual) mensParts.push("Casual shirts");
  else if (hasShort) mensParts.push("Short-sleeve shirts");
  if (mens.some((x) => /Kurta/i.test(x))) mensParts.push("kurtas");
  if (mens.some((x) => /lounge pants/i.test(x))) mensParts.push("lounge pants");
  const mensText = mensParts.length
    ? `${mensParts.slice(0, -1).join(", ")}${mensParts.length > 1 ? " and " : ""}${mensParts[mensParts.length - 1]}.`
    : "-";

  const womens = get("Womenswear");
  const wParts = [];
  if (womens.some((x) => /Blouses|tops/i.test(x))) wParts.push("Blouses");
  if (womens.some((x) => /Summer dresses/i.test(x))) wParts.push("summer dresses");
  if (womens.some((x) => /Skirts/i.test(x))) wParts.push("skirts");
  if (womens.some((x) => /Tunics|kurtis/i.test(x))) wParts.push("tunics");
  if (womens.some((x) => /Nightwear|loungewear/i.test(x))) wParts.push("nightwear");
  const womensText = wParts.length
    ? `${wParts.slice(0, -1).join(", ")}${wParts.length > 1 ? ", and " : ""}${wParts[wParts.length - 1]}.`
    : "-";

  const kids = get("Kidswear");
  const unisex = get("Unisex");
  const ku = [...kids, ...unisex];
  const kuParts = [];
  if (ku.some((x) => /Shirts|tops/i.test(x))) kuParts.push("Shirts");
  if (ku.some((x) => /dresses|frocks/i.test(x))) kuParts.push("light dresses");
  if (ku.some((x) => /Pyjamas|nightwear/i.test(x))) kuParts.push("pajamas");
  if (ku.some((x) => /Scrub-style/i.test(x))) kuParts.push("non-medical scrub tops");
  const kidsText = kuParts.length
    ? `${kuParts.slice(0, -1).join(", ")}${kuParts.length > 1 ? ", and " : ""}${kuParts[kuParts.length - 1]}.`
    : "-";

  const home = get("Home Textiles", "Home");
  const accessories = get("Accessories");
  const work = get("Uniforms / Workwear", "Workwear", "Work");

  const homeParts = [];
  const hasPillow = home.some((x) => /Pillow covers/i.test(x));
  const hasCushion = home.some((x) => /cushion covers/i.test(x));
  const hasRunner = home.some((x) => /table runners/i.test(x));
  if (hasPillow && hasCushion) homeParts.push("Pillow and cushion covers");
  else if (hasPillow) homeParts.push("Pillow covers");
  else if (hasCushion) homeParts.push("Cushion covers");
  if (hasRunner) homeParts.push("decorative table runners");
  const homeText = homeParts.length
    ? `${homeParts[0]}${homeParts.length === 2 ? ", and " + homeParts[1] : ""}.`
    : "-";

  const accParts = [];
  if (accessories.some((x) => /Pocket squares/i.test(x))) accParts.push("Pocket squares");
  if (accessories.some((x) => /scarves/i.test(x))) accParts.push("light scarves");
  if (accessories.some((x) => /trims|belts/i.test(x))) accParts.push("fabric trims");
  const accText = accParts.length
    ? `${accParts.slice(0, -1).join(", ")}${accParts.length > 1 ? ", and " : ""}${accParts[accParts.length - 1]}.`
    : "-";

  const workText = work.some((x) => /Light service uniforms/i.test(x)) ? "Light indoor service uniforms." : "-";

  return {
    apparel: [
      { label: "Menswear", text: mensText },
      { label: "Womenswear", text: womensText },
      { label: "Kids & Unisex", text: kidsText },
    ],
    homeAcc: [
      { label: "Home", text: homeText },
      { label: "Accessories", text: accText },
      { label: "Work", text: workText },
    ],
  };
}

/* ------------------------------ footer icons (FIXED: clean + correct) ------------------------------ */
function footerCircle(doc, cx, cy, r, fill) {
  doc.setFillColor(fill[0], fill[1], fill[2]);
  doc.circle(cx, cy, r, "F");
}
function setIconStroke(doc, w = 0.95) {
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(w);
  if (typeof doc.setLineCap === "function") doc.setLineCap(1); // round
  if (typeof doc.setLineJoin === "function") doc.setLineJoin(1);
}

/* phone: classic handset */
function drawPhoneIcon(doc, cx, cy, r) {
  setIconStroke(doc, 0.95);

  const a = r * 0.62;
  const b = r * 0.30;

  doc.line(cx - a, cy - b, cx - r * 0.15, cy - r * 0.62);
  doc.line(cx - r * 0.15, cy - r * 0.62, cx + a * 0.75, cy - b * 0.35);

  doc.line(cx - a * 0.75, cy + b * 0.35, cx + r * 0.15, cy + r * 0.62);
  doc.line(cx + r * 0.15, cy + r * 0.62, cx + a, cy + b);

  doc.line(cx - r * 0.10, cy - r * 0.05, cx + r * 0.10, cy + r * 0.05);
}

/* whatsapp: bubble + tail + small handset */
function drawWhatsappIcon(doc, cx, cy, r) {
  setIconStroke(doc, 0.85);

  doc.circle(cx, cy - 0.15, r * 0.70, "S");

  doc.line(cx - r * 0.22, cy + r * 0.45, cx - r * 0.52, cy + r * 0.78);
  doc.line(cx - r * 0.52, cy + r * 0.78, cx - r * 0.10, cy + r * 0.62);

  doc.setLineWidth(0.85);
  doc.line(cx - r * 0.24, cy - r * 0.02, cx - r * 0.04, cy - r * 0.20);
  doc.line(cx - r * 0.04, cy - r * 0.20, cx + r * 0.20, cy - r * 0.02);
  doc.line(cx - r * 0.18, cy + r * 0.06, cx - r * 0.02, cy + r * 0.22);
  doc.line(cx - r * 0.02, cy + r * 0.22, cx + r * 0.22, cy + r * 0.06);
}

/* mail: envelope */
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

/* ------------------------------ NEW: Company Information (dynamic) ------------------------------ */
const _ENV = typeof import.meta !== "undefined" ? import.meta.env || {} : {};
const DEFAULT_COMPANY_INFO_URL = String(_ENV.VITE_COMPANY_INFORMATION || "").replace(/\/$/, "");
const DEFAULT_ESPO_API_KEY = String(_ENV.VITE_X_API_KEY || "");
const DEFAULT_COMPANY_PREFER_NAME = String(_ENV.VITE_COMPANY_PREFER_NAME || "AGE");
const DEFAULT_COMPANY_INFO_ID = String(_ENV.VITE_COMPANY_INFORMATION_ID || "");

let _companyInfoCache = null;
let _companyInfoPromise = null;

function buildAddressLineFromCompany(ci) {
  const street = String(ci?.addressStreet || "").trim();
  const city = String(ci?.addressCity || "").trim();
  const state = String(ci?.addressState || "").trim();
  const country = String(ci?.addressCountry || "").trim();
  const pin = String(ci?.addressPostalCode || "").trim();

  const parts = [street, city, state, country].filter(Boolean);
  const base = parts.join(", ");
  if (!base && pin) return pin;
  if (base && pin) return `${base} ${pin}`;
  return base || "";
}

function pickCompanyRecord(list, { preferId, preferName } = {}) {
  const arr = Array.isArray(list) ? list.filter((x) => !x?.deleted) : [];
  if (!arr.length) return null;

  const byId = preferId ? arr.find((x) => String(x?.id || "") === String(preferId)) : null;
  if (byId) return byId;

  const pn = String(preferName || "").trim().toLowerCase();
  if (pn) {
    const byName = arr.find((x) => String(x?.name || "").trim().toLowerCase() === pn);
    if (byName) return byName;
  }

  const byAGE = arr.find((x) => String(x?.name || "").trim().toLowerCase() === "age");
  if (byAGE) return byAGE;

  // fallback: highest versionNumber
  const sorted = [...arr].sort((a, b) => Number(b?.versionNumber || 0) - Number(a?.versionNumber || 0));
  return sorted[0] || arr[0] || null;
}

async function fetchCompanyInformation({
  url = DEFAULT_COMPANY_INFO_URL,
  apiKey = DEFAULT_ESPO_API_KEY,
  preferId = DEFAULT_COMPANY_INFO_ID,
  preferName = DEFAULT_COMPANY_PREFER_NAME,
} = {}) {
  const base = String(url || "").trim();
  if (!base) return null;

  try {
    const u = new URL(base);
    // these are safe (Espo usually supports them). If ignored, no issue.
    if (!u.searchParams.has("maxSize")) u.searchParams.set("maxSize", "200");
    if (!u.searchParams.has("sortBy")) u.searchParams.set("sortBy", "versionNumber");
    if (!u.searchParams.has("sortDirection")) u.searchParams.set("sortDirection", "DESC");

    const headers = {};
    if (apiKey) {
      headers["X-Api-Key"] = apiKey;
      // some setups also accept Bearer; harmless if ignored
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const res = await fetch(u.toString(), { headers });
    if (!res.ok) return null;

    const data = await res.json();
    const picked = pickCompanyRecord(data?.list, { preferId, preferName });
    return picked || null;
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

/* ------------------------------ main export ------------------------------ */
export async function downloadProductPdf(
  p,
  {
    productUrl,
    qrDataUrl,
    logoPath = "/logo1.png",

    // ✅ these are now dynamic by default (from VITE_COMPANY_INFORMATION)
    companyInfoUrl = DEFAULT_COMPANY_INFO_URL,
    companyInfoId = DEFAULT_COMPANY_INFO_ID,
    companyInfoPreferName = DEFAULT_COMPANY_PREFER_NAME,
    espoApiKey = DEFAULT_ESPO_API_KEY,

    // optional manual overrides (if you pass them, they win)
    companyName,
    phone1,
    phone2, // you asked: use whatsappNumber here
    email,  // you asked: use primaryEmail here
    website, // optional (if you still want website sometimes)
    addressLine,

    optionsCount,
  } = {}
) {
  // ✅ pull company info once (cached)
  const ci = await getCompanyInformationCached({
    url: companyInfoUrl,
    apiKey: espoApiKey,
    preferId: companyInfoId,
    preferName: companyInfoPreferName,
  });

  // ✅ map fields exactly as you requested
  const dynamicCompanyName = firstNonEmpty(companyName, ci?.legalName, ci?.name, ""); // legalName
  const dynamicPhone1 = firstNonEmpty(phone1, ci?.phone1, ""); // phone1
  const dynamicPhone2 = firstNonEmpty(phone2, ci?.whatsappNumber, ""); // whatsappNumber
  const dynamicEmail = firstNonEmpty(email, ci?.primaryEmail, ""); // primaryEmail
  const dynamicAddress = firstNonEmpty(addressLine, buildAddressLineFromCompany(ci), ci?.addressStreet, ""); // addressStreet (+ rest if present)
  const dynamicWebsite = firstNonEmpty(website, ""); // keep optional if you want

  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // palette
  const BORDER = [226, 232, 240];
  const TEXT = [15, 23, 42];
  const PILL_BLUE = [30, 58, 138];
  const PILL_TEAL = [13, 116, 110];
  const AMBER_BG = [255, 247, 204];
  const AMBER_BORDER = [234, 179, 8];
  const GOLD_LINE = [201, 162, 106];
  const GOLD_LINE_DARK = [122, 92, 52];
  const BULLET = [201, 162, 106];

  // bg
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageW, pageH, "F");

  const code = getDisplayCode(p);
  const title = firstNonEmpty(p?.productTitle, p?.name, code);
  const tagline = firstNonEmpty(p?.productTagline, "");
  const shortDesc = firstNonEmpty(
    p?.shortProductDescription,
    p?.productTagline,
    p?.description ? stripHtml(p.description).slice(0, 180) : "",
    ""
  );

  const categoryPill = toUpperLabel(firstNonEmpty(p?.category, "Woven Fabrics"));
  const supplyPill = toKebabLower(firstNonEmpty(p?.supplyModel, "never-out-of-stock"));
  const ratingValue = Number(firstNonEmpty(p?.ratingValue, 0));
  const ratingSafe = Number.isFinite(ratingValue) ? Math.max(0, Math.min(5, ratingValue)) : 0;

  const autoOptions =
    Number.isFinite(Number(p?.optionsCount)) ? Number(p.optionsCount) :
    Array.isArray(p?.options) ? p.options.length :
    Array.isArray(p?.variants) ? p.variants.length :
    undefined;
  const optCount = Number.isFinite(Number(optionsCount)) ? Number(optionsCount) : autoOptions;

  // links
  const productLink = productUrl ? normalizeUrl(productUrl) : "";

  // images
  const imgUrl = getPrimaryImage(p) || fallbackImageSvg(code);
  let imgDataUrl = null;
  try { imgDataUrl = imgUrl ? await toDataUrl(imgUrl) : null; } catch { imgDataUrl = null; }

  let logoDataUrl = null;
  try { logoDataUrl = await toDataUrl(logoPath); } catch { logoDataUrl = null; }

  // ✅ NEW: logo size for perfect aspect-fit
  const logoSize = logoDataUrl ? await getDataUrlSize(logoDataUrl) : null;

  // ✅ dynamic QR (per product page)
  let finalQrDataUrl = null;
  if (qrDataUrl && typeof qrDataUrl === "string") finalQrDataUrl = qrDataUrl;
  else if (productLink) finalQrDataUrl = await makeQrDataUrl(productLink);

  /* ------------------------------ HEADER ------------------------------ */
  const headerTop = 6.5;

  // ✅ logo slightly wider + aspect-fit (no distortion)
  const logoBoxW = 22;
  const logoBoxH = 14.5;
  const gap = 5;

  const headerCompanyName = firstNonEmpty(dynamicCompanyName, ""); // avoid forcing static
  doc.setFont("helvetica", "bold");
  doc.setFontSize(23);
  doc.setTextColor(0, 0, 0);

  const nameW = doc.getTextWidth(headerCompanyName || " "); // prevent NaN
  const totalW = logoBoxW + gap + nameW;
  const startX = Math.max(10, (pageW - totalW) / 2);

  const logoX = startX;
  const logoY = headerTop;

  if (logoDataUrl) {
    const isPng = String(logoDataUrl).startsWith("data:image/png");
    const isJpeg =
      String(logoDataUrl).startsWith("data:image/jpeg") || String(logoDataUrl).startsWith("data:image/jpg");
    const fmt = isPng ? "PNG" : isJpeg ? "JPEG" : "PNG";

    const srcW = logoSize?.w || 0;
    const srcH = logoSize?.h || 0;
    const fit = fitIntoBox(srcW, srcH, logoBoxW, logoBoxH);

    const drawW = fit.w || logoBoxW;
    const drawH = fit.h || logoBoxH;
    const dx = logoX + (logoBoxW - drawW) / 2;
    const dy = logoY + (logoBoxH - drawH) / 2;

    try { doc.addImage(logoDataUrl, fmt, dx, dy, drawW, drawH); } catch {}
  }

  // text baseline aligned with logo box
  if (headerCompanyName) {
    doc.text(headerCompanyName, logoX + logoBoxW + gap, headerTop + 11.0);
  }

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

  // ✅ fabric code not hugging the corner
  const codeX = M + 2.5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.6);
  doc.setTextColor(0, 0, 0);
  doc.text(String(code), codeX, heroTop + 7.2);

  const codeW = doc.getTextWidth(String(code));
  doc.setDrawColor(GOLD_LINE_DARK[0], GOLD_LINE_DARK[1], GOLD_LINE_DARK[2]);
  doc.setLineWidth(0.4);
  doc.line(codeX, heroTop + 8.9, codeX + Math.min(codeW, 34), heroTop + 8.9);

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
    const isJpeg = imgDataUrl.startsWith("data:image/jpeg") || imgDataUrl.startsWith("data:image/jpg");
    const fmt = isPng ? "PNG" : isJpeg ? "JPEG" : null;
    if (fmt) {
      try { doc.addImage(imgDataUrl, fmt, imgX + 2, imgY + 2, imgW - 4, imgH - 4); } catch {}
    }
  }

  // options badge
  if (Number.isFinite(optCount) && optCount > 0) {
    const badgeW = 34;
    const badgeH = 7.0;
    const bx = imgX + 14;
    const by = imgY + imgH - badgeH - 7;

    fillR(doc, bx, by, badgeW, badgeH, [67, 56, 202], 2.4);
    strokeR(doc, bx, by, badgeW, badgeH, [99, 102, 241], 2.4, 0.18);

    const icx = bx + 5;
    const icy = by + badgeH / 2 + 0.25;
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(0.45);
    doc.rect(icx - 1.25, icy - 1.25, 2.5, 2.5, "S");
    doc.line(icx - 1.25, icy - 1.25, icx, icy - 2.1);
    doc.line(icx + 1.25, icy - 1.25, icx, icy - 2.1);
    doc.line(icx, icy - 2.1, icx + 1.25, icy - 1.25);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.9);
    doc.setTextColor(255, 255, 255);
    doc.text(`${fmtNum(optCount, 0)}  Options`, bx + 8.2, by + badgeH * 0.68);
  }

  // right block
  const rightX = imgX + imgW + 12;
  const rightW = pageW - M - rightX;

  // pills
  const pillsY = heroTop + 10;
  let px = rightX;

  const p1 = pill(doc, px, pillsY, categoryPill || "WOVEN FABRICS", {
    bg: PILL_BLUE, fg: [255, 255, 255], h: 7.2, r: 3.6, fontSize: 7.2, padX: 4.2, bold: true,
  });
  px += p1.w + 4;

  const p2 = pill(doc, px, pillsY, supplyPill || "never-out-of-stock", {
    bg: PILL_TEAL, fg: [255, 255, 255], h: 7.2, r: 3.6, fontSize: 7.2, padX: 4.2, bold: true,
  });
  px += p2.w + 4;

  // rating pill
  const ratingPillH = 7.2;
  const ratingPillW = 44;
  fillR(doc, px, pillsY, ratingPillW, ratingPillH, AMBER_BG, 3.6);
  strokeR(doc, px, pillsY, ratingPillW, ratingPillH, AMBER_BORDER, 3.6, 0.22);
  const starsW = 5 * 3.0 + 4 * 0.5;
  drawStars(doc, px + (ratingPillW - starsW) / 2, pillsY + ratingPillH * 0.64, ratingSafe, { size: 3.0, gap: 0.5 });

  /* ---- Title + Tagline: BLACK + fill the same height as image ---- */
  const titleTopY = pillsY + 16.5;
  const textBottomY = imgY + imgH - 2.0;

  let titleSize = 19.2;
  const titleLH = 6.2;
  const tagSize = 10.8;
  const tagLH = 5.2;
  const minGap = 4.0;

  let titleLines = [];
  let tagLines = [];

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

    if (titleH + minGap + tagH <= avail || titleSize <= 13.2) break;
    titleSize -= 0.6;
  }

  doc.setFont("times", "bold");
  doc.setFontSize(titleSize);
  doc.setTextColor(0, 0, 0);
  doc.text(titleLines, rightX, titleTopY);

  const titleH2 = titleLines.length * titleLH;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(tagSize);
  doc.setTextColor(0, 0, 0);

  const tagH2 = tagLines.length * tagLH;
  const avail2 = textBottomY - titleTopY;
  const gap2 = Math.max(minGap, Math.min(14, avail2 - titleH2 - tagH2));
  const tagY = titleTopY + titleH2 + gap2;
  if (tagLines.length) doc.text(tagLines, rightX, tagY);

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
    doc.text(String(label || "").toUpperCase(), x + 8, y0 + 7.6);

    const v = String(value ?? "-");
    doc.setFont("helvetica", boldValue ? "bold" : "normal");
    doc.setFontSize(9.2);
    doc.setTextColor(TEXT[0], TEXT[1], TEXT[2]);

    const maxW = w - 26;
    const line = fitOneLine(doc, v, maxW) || v;
    const cx = x + w * 0.65;
    doc.text(line, cx, y0 + 7.6, { align: "center" });
  }

  drawCell(tableX, tableY + rowH * 0, cellW, "Content", firstNonEmpty(getComposition(p), "-"));
  drawCell(tableX + cellW, tableY + rowH * 0, cellW, "Width", getWidthText(p));

  drawCell(tableX, tableY + rowH * 1, cellW, "Weight", getWeightText(p));
  drawCell(tableX + cellW, tableY + rowH * 1, cellW, "Design", firstNonEmpty(p?.design, "-"));

  drawCell(tableX, tableY + rowH * 2, cellW, "Structure", firstNonEmpty(getStructure(p), "-"), { boldValue: true });
  drawCell(tableX + cellW, tableY + rowH * 2, cellW, "Colors", firstNonEmpty(safeJoin(p?.color), "-"));

  drawCell(tableX, tableY + rowH * 3, cellW, "Motif", firstNonEmpty(p?.motif, "-"));

  const moqVal = (() => {
    const moq = isNum(p?.salesMOQ) ? fmtNum(p.salesMOQ, 0) : firstNonEmpty(p?.salesMOQ, "-");
    const um = firstNonEmpty(p?.uM, "Meter");
    if (!moq || moq === "-") return "-";
    return `${moq} ${um}`;
  })();
  drawCell(tableX + cellW, tableY + rowH * 3, cellW, "Sales MOQ", moqVal);

  // finish full width (no overlap)
  const finishY = tableY + rowH * 4;
  const finishLabelW = 24;
  const valueX = tableX + finishLabelW;
  const valueW = tableW - finishLabelW;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.2);
  doc.setTextColor(30, 64, 175);
  doc.text("FINISH", tableX + 8, finishY + 8.0);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.8);
  doc.setTextColor(TEXT[0], TEXT[1], TEXT[2]);

  const finishText = firstNonEmpty(getFinish(p), "-");
  const finishLines = pdfWrap(doc, finishText, valueW - 16).slice(0, 2);
  doc.text(finishLines, valueX + valueW / 2, finishY + 8.0, { align: "center" });

  /* ---------------- Bullets + QR on right (dynamic per productUrl) ---------------- */
  const suit = buildSuitabilityBulletsLikeImage(p);

  // QR card settings (right side)
  const showQr = !!finalQrDataUrl;
  const qrCardW = 34;
  const qrCardH = 42;
  const qrSize = 28;
  const qrGap = 10;

  let by = finishY + finishH + 9;

  const qrX = pageW - M - qrCardW;

  // QR a bit DOWN
  const qrY = Math.min(by - 2, contentMaxY - qrCardH);

  const leftMaxW = showQr ? (qrX - M - qrGap) : (pageW - M * 2);

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
      try { doc.link(qrX, qrY, qrCardW, qrCardH, { url: productLink }); } catch {}
    }
  }

  function drawBulletLine(x, y, label, text, maxW) {
    const lineH = 6.2;
    if (y + lineH > contentMaxY) return { y, drawn: false };

    doc.setFillColor(BULLET[0], BULLET[1], BULLET[2]);
    doc.circle(x + 2, y - 1.1, 0.7, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.8);
    doc.setTextColor(0, 0, 0);
    const lbl = `${label}:`;
    doc.text(lbl, x + 6, y);

    const lblW = doc.getTextWidth(lbl) + 1.6;
    const bodyX = x + 6 + lblW;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.8);
    doc.setTextColor(51, 65, 85);

    const bodyMax = Math.max(10, maxW - (bodyX - x));
    const body = fitOneLine(doc, String(text || "-"), bodyMax) || String(text || "-");
    doc.text(body, bodyX, y);

    return { y: y + lineH, drawn: true };
  }

  if (by + 10 < contentMaxY) {
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

  if (by + 10 < contentMaxY) {
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

  /* ---------------- FOOTER (dynamic: phone1, whatsappNumber, primaryEmail) ---------------- */
  doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
  doc.setLineWidth(0.35);
  doc.line(M, footerLineY, pageW - M, footerLineY);

  const footerY = footerLineY + 10;
  const iconR = 4.0;

  const footerPhone1 = String(dynamicPhone1 || "").trim();
  const footerPhone2 = String(dynamicPhone2 || "").trim(); // whatsappNumber
  const footerEmail = String(dynamicEmail || "").trim();
  const footerWebsite = String(dynamicWebsite || "").trim();

  const tel1 = normalizeTel(footerPhone1);
  const wa2 = normalizeWaDigits(footerPhone2);

  // if email present -> mailto, else if website present -> open url
  const thirdText = footerEmail || footerWebsite;
  const thirdUrl = looksLikeEmail(thirdText)
    ? `mailto:${normalizeEmail(thirdText)}`
    : (thirdText ? normalizeUrl(thirdText) : "");

  const footerItems = [
    { text: footerPhone1, color: [194, 120, 62], icon: "phone", url: tel1 ? `tel:${tel1}` : "" },
    {
      text: footerPhone2,
      color: [22, 163, 74],
      icon: "whatsapp",
      url: wa2 ? `https://wa.me/${wa2}` : "",
    },
    { text: thirdText, color: [30, 64, 175], icon: "mail", url: thirdUrl },
  ].filter((x) => x.text && x.text.trim());

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(30, 41, 59);

  const gapX = 10;
  const widths = footerItems.map((it) => (iconR * 2 + 3) + doc.getTextWidth(it.text));
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
      try { doc.link(clickX, clickY, itemW, clickH, { url: it.url }); } catch {}
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
    const addrLines = pdfWrap(doc, String(dynamicAddress), pageW - M * 2).slice(0, 2);
    doc.text(addrLines, pageW / 2, pageH - 10, { align: "center" });
  }

  if (productLink) {
    try { doc.link(M, 0, pageW - M * 2, pageH, { url: productLink }); } catch {}
  }

  doc.save(`${code}.pdf`);
}
