// src/lib/productUtils.js

export function textIncludes(haystack, needle) {
  return String(haystack || "").toLowerCase().includes(String(needle || "").toLowerCase());
}

export function safeJoin(val, sep = ", ") {
  if (Array.isArray(val)) return val.filter(Boolean).join(sep);
  if (val === null || val === undefined) return "";
  return String(val);
}

export function firstNonEmpty(...vals) {
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

export function isNum(v) {
  const n = Number(v);
  return Number.isFinite(n);
}

export function fmtNum(v, decimals = 2) {
  if (!isNum(v)) return "";
  const n = Number(v);
  const r = Math.round(n);
  if (Math.abs(n - r) < 1e-6) return String(r);
  return n.toFixed(decimals).replace(/\.?0+$/, "");
}

export function stripHtml(html) {
  try {
    const div = document.createElement("div");
    div.innerHTML = String(html || "");
    return (div.textContent || div.innerText || "").trim();
  } catch {
    return String(html || "");
  }
}

export function fallbackImageSvg(text = "AGE") {
  const safe = String(text).replace(/</g, "").slice(0, 18);
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#7c5cff"/>
        <stop offset="1" stop-color="#2dd4bf"/>
      </linearGradient>
    </defs>
    <rect width="1200" height="800" fill="url(#g)"/>
    <circle cx="1020" cy="160" r="260" fill="rgba(255,255,255,0.14)"/>
    <circle cx="180" cy="720" r="320" fill="rgba(0,0,0,0.18)"/>
    <text x="80" y="460" font-size="120" font-family="Arial" font-weight="800" fill="white" opacity="0.95">
      ${safe}
    </text>
    <text x="80" y="560" font-size="44" font-family="Arial" fill="rgba(255,255,255,0.85)">
      Product Preview
    </text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function getPrimaryImage(p) {
  return firstNonEmpty(
    p?.image1CloudUrl,
    p?.image1ThumbUrl,
    p?.image2CloudUrl,
    p?.image2ThumbUrl,
    p?.image3CloudUrl,
    p?.image3ThumbUrl
  );
}

export function getDisplayCode(p) {
  return firstNonEmpty(p?.fabricCode, p?.vendorFabricCode, p?.productslug, p?.name, p?.id);
}

export function getComposition(p) {
  return firstNonEmpty(safeJoin(p?.content), p?.composition);
}

export function getFinish(p) {
  return firstNonEmpty(safeJoin(p?.finish), p?.finish);
}

export function getStructure(p) {
  return firstNonEmpty(p?.structure, p?.weave);
}

export function getWidthText(p) {
  const cm = p?.cm;
  const inch = p?.inch;
  if (isNum(cm) && isNum(inch)) return `${fmtNum(cm, 0)} cm (${fmtNum(inch, 2)}")`;
  if (isNum(inch)) return `${fmtNum(inch, 2)}"`;
  if (isNum(cm)) return `${fmtNum(cm, 0)} cm`;
  return "-";
}

export function getShortDesc(p) {
  return firstNonEmpty(
    p?.shortProductDescription,
    p?.productTagline,
    p?.description && stripHtml(p.description).slice(0, 140)
  );
}

export function safeHtml(html) {
  try {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    doc.querySelectorAll("script,style").forEach((n) => n.remove());
    doc.querySelectorAll("*").forEach((el) => {
      [...el.attributes].forEach((a) => {
        const name = a.name.toLowerCase();
        const val = String(a.value || "");
        if (name.startsWith("on")) el.removeAttribute(a.name);
        if ((name === "href" || name === "src") && val.trim().toLowerCase().startsWith("javascript:"))
          el.removeAttribute(a.name);
      });
    });
    return doc.body.innerHTML || "";
  } catch {
    return "";
  }
}

export function filterTags(tags) {
  const arr = Array.isArray(tags) ? tags : [];
  return arr.filter(Boolean).filter((t) => String(t).trim().toLowerCase() !== "draft");
}

/* ------------------------------ Suitability helpers (NO % + UNIQUE) ------------------------------ */
function stripPercentText(s) {
  return String(s || "")
    .replace(/\b\d{1,3}\s*%\b/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
function normalizeSuitabilityText(s) {
  return stripPercentText(s)
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s*-\s*/g, " - ")
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

  const lastRaw = String(parts[parts.length - 1] || "");
  const scoreOnly = /\b\d{1,3}\s*%\b/.test(lastRaw) ? normalizeSuitabilityText(lastRaw) : "";

  return { seg: seg || "-", use: use || "-", score: scoreOnly || "", a: seg || "-", b: use || "", c: "" };
}

export function uniqueSuitabilityForUI(p, maxSeg = 12) {
  const rows = (p?.suitability || []).map(parseSuitabilityLine).filter(Boolean);

  const map = new Map();
  for (const r of rows) {
    const segLabel = normalizeSuitabilityText(r.seg || r.a || "");
    const segKey = segLabel.toLowerCase();
    if (!segKey) continue;

    if (!map.has(segKey)) map.set(segKey, { seg: segLabel, usesMap: new Map() });

    const useLabel = normalizeSuitabilityText(r.use || r.b || "");
    if (useLabel && useLabel !== "-") {
      const parts = useLabel
        .split(/[,•]+/g)
        .map((s) => normalizeSuitabilityText(s))
        .filter(Boolean)
        .filter((s) => s !== "-");

      const bucket = map.get(segKey).usesMap;
      if (parts.length) {
        for (const u of parts) {
          const k = u.toLowerCase();
          if (!bucket.has(k)) bucket.set(k, u);
        }
      } else {
        const k = useLabel.toLowerCase();
        if (!bucket.has(k)) bucket.set(k, useLabel);
      }
    }
  }

  const out = [];
  for (const { seg, usesMap } of map.values()) {
    const uses = Array.from(usesMap.values());
    out.push({ seg, uses: uses.length ? uses.join(" - ") : "-" });
  }

  out.sort((x, y) => x.seg.localeCompare(y.seg));
  return out.slice(0, maxSeg);
}

export function getFaqList(p) {
  const items = [];
  for (let i = 1; i <= 6; i++) {
    const q = p?.[`productQ${i}`];
    const a = p?.[`productA${i}`];
    if (q && a) items.push({ q: String(q).trim(), a: String(a).trim() });
  }
  return items;
}
