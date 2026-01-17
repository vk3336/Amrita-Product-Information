// src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Routes, Route, Link, useParams, Navigate, useNavigate } from "react-router-dom";
import "./App.css";
import jsPDF from "jspdf";
import { QRCodeCanvas } from "qrcode.react";

/* ------------------------------ ENV ------------------------------ */
const FRONTEND_URL = String(import.meta.env.VITE_FRONTEND_URL || "").replace(/\/$/, "");
const ESPO_ENTITY_URL = String(import.meta.env.VITE_ESPO_BASEURL || "").replace(/\/$/, ""); // /CProduct
const ESPO_API_KEY = String(import.meta.env.VITE_X_API_KEY || "");

/* ------------------------------ THEME ------------------------------ */
const THEME_KEY = "age_theme";
function getInitialTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  const prefersLight =
    window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  return prefersLight ? "light" : "dark";
}

/* ------------------------------ helpers ------------------------------ */
function textIncludes(haystack, needle) {
  return String(haystack || "").toLowerCase().includes(String(needle || "").toLowerCase());
}
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
  return firstNonEmpty(p?.fabricCode, p?.vendorFabricCode, p?.productslug, p?.name, p?.id);
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
  if (isNum(cm) && isNum(inch)) return `${fmtNum(cm, 0)} cm (${fmtNum(inch, 2)}")`;
  if (isNum(inch)) return `${fmtNum(inch, 2)}"`;
  if (isNum(cm)) return `${fmtNum(cm, 0)} cm`;
  return "-";
}
function getShortDesc(p) {
  return firstNonEmpty(
    p?.shortProductDescription,
    p?.productTagline,
    p?.description && stripHtml(p.description).slice(0, 140)
  );
}
function safeHtml(html) {
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
function filterTags(tags) {
  const arr = Array.isArray(tags) ? tags : [];
  return arr
    .filter(Boolean)
    .filter((t) => String(t).trim().toLowerCase() !== "draft");
}

/* ------------------------------ Suitability helpers (NO % + UNIQUE) ------------------------------ */
function stripPercentText(s) {
  return String(s || "")
    .replace(/\b\d{1,3}\s*%\b/g, "") // remove "92%" or "92 %"
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

/**
 * Parses:
 * "Menswear | Casual shirts | 92%"
 * "Uniforms / Workwear| Light service uniforms (indoor) | 60%"
 */
function parseSuitabilityLine(line) {
  const raw = String(line || "").trim();
  if (!raw) return null;

  const parts = raw.split("|").map((x) => x.trim()).filter(Boolean);

  // Segment (left)
  const seg = normalizeSuitabilityText(parts[0] || "");

  // Use (middle). Some rows may contain extra pipes; keep middle joined.
  const mid = parts.length >= 3 ? parts.slice(1, -1).join(" - ") : (parts[1] || "");
  const use = normalizeSuitabilityText(mid);

  // Score (right) kept for compatibility but we will NOT render it in UI
  const score = normalizeSuitabilityText(parts[parts.length - 1] || "");
  const scoreOnly = /\b\d{1,3}\s*%\b/.test(String(parts[parts.length - 1] || "")) ? score : "";

  return {
    seg: seg || "-",
    use: use || "-",
    score: scoreOnly || "",
    // legacy keys for old render (safe)
    a: seg || "-",
    b: use || "",
    c: ""
  };
}

/**
 * Returns [{ seg, uses: "A - B - C" }, ...]
 * - removes % values
 * - groups by segment
 * - keeps unique uses (case-insensitive)
 */
function uniqueSuitabilityForUI(p, maxSeg = 12) {
  const rows = (p?.suitability || []).map(parseSuitabilityLine).filter(Boolean);

  const map = new Map(); // segKey -> { seg, usesMap: Map<useKey, useLabel> }
  for (const r of rows) {
    const segLabel = normalizeSuitabilityText(r.seg || r.a || "");
    const segKey = segLabel.toLowerCase();
    if (!segKey) continue;

    if (!map.has(segKey)) map.set(segKey, { seg: segLabel, usesMap: new Map() });

    const useLabel = normalizeSuitabilityText(r.use || r.b || "");
    if (useLabel && useLabel !== "-") {
      // split any accidental list separators inside use
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

  return out.slice(0, maxSeg);
}

function getFaqList(p) {
  const items = [];
  for (let i = 1; i <= 6; i++) {
    const q = p?.[`productQ${i}`];
    const a = p?.[`productA${i}`];
    if (q && a) items.push({ q: String(q).trim(), a: String(a).trim() });
  }
  return items;
}

/* ------------------------------ API ------------------------------ */
async function espoFetchJson(url) {
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json", "X-Api-Key": ESPO_API_KEY },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || "Request failed"}`);
  }
  return res.json();
}
async function fetchAllProducts() {
  if (!ESPO_ENTITY_URL) throw new Error("VITE_ESPO_BASEURL is missing");
  if (!ESPO_API_KEY) throw new Error("VITE_X_API_KEY is missing");

  const pageSize = 200;
  let offset = 0;
  let all = [];
  let total = Infinity;

  while (offset < total) {
    const u = new URL(ESPO_ENTITY_URL);
    u.searchParams.set("maxSize", String(pageSize));
    u.searchParams.set("offset", String(offset));
    u.searchParams.set("sortBy", "modifiedAt");
    u.searchParams.set("asc", "false");

    const json = await espoFetchJson(u.toString());
    const list = Array.isArray(json?.list)
      ? json.list
      : Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json)
          ? json
          : [];
    const pageTotal =
      typeof json?.total === "number"
        ? json.total
        : typeof json?.count === "number"
          ? json.count
          : list.length;

    total = pageTotal === 0 ? 0 : pageTotal;
    all = all.concat(list);
    offset += list.length;

    if (list.length === 0) break;
    if (!Number.isFinite(total)) break;
  }

  return all.filter((p) => p?.deleted !== true);
}

/* ------------------------------ PDF (ONE PAGE COMPACT) ------------------------------ */
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

function pdfWrap(doc, text, maxW) {
  const t = String(text || "").trim();
  if (!t) return [];
  return doc.splitTextToSize(t, maxW);
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
function drawStarShape(doc, x, y, size, fillPercent, color, emptyColor) {
  const outerRadius = size / 2;
  const innerRadius = outerRadius * 0.38;

  const points = [];
  for (let i = 0; i < 5; i++) {
    const outerAngle = (Math.PI / 2) + (i * 2 * Math.PI / 5);
    points.push({
      x: x + outerRadius * Math.cos(outerAngle),
      y: y - outerRadius * Math.sin(outerAngle)
    });

    const innerAngle = outerAngle + (Math.PI / 5);
    points.push({
      x: x + innerRadius * Math.cos(innerAngle),
      y: y - innerRadius * Math.sin(innerAngle)
    });
  }

  const drawStarPath = () => {
    doc.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      doc.lineTo(points[i].x, points[i].y);
    }
    doc.close();
  };

  doc.setLineWidth(0.25);

  const fill = Math.max(0, Math.min(1, fillPercent));

  if (fill === 0) {
    doc.setFillColor(0, 0, 0, 0);
    doc.setDrawColor(emptyColor[0], emptyColor[1], emptyColor[2]);
    drawStarPath();
    doc.stroke();
  } else if (fill === 1) {
    doc.setFillColor(color[0], color[1], color[2]);
    doc.setDrawColor(color[0], color[1], color[2]);
    drawStarPath();
    doc.fillStroke();
  } else {
    doc.setDrawColor(emptyColor[0], emptyColor[1], emptyColor[2]);
    doc.setFillColor(0, 0, 0, 0);
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
    drawStarPath();
    doc.fill();

    doc.restoreGraphicsState();
  }
}

function drawStars(doc, x, y, ratingValue, opts = {}) {
  const v = Number(ratingValue);
  const r = Number.isFinite(v) ? Math.max(0, Math.min(5, v)) : 0;

  const size = Number(opts.size ?? 3);
  const gap = Number(opts.gap ?? 0.7);

  const goldColor = [255, 215, 0];
  const emptyColor = [107, 114, 128];

  let currentX = x;

  for (let i = 1; i <= 5; i++) {
    const starStart = i - 1;
    const starEnd = i;
    let fillPercent = 0;

    if (r >= starEnd) fillPercent = 1.0;
    else if (r > starStart) fillPercent = r - starStart;
    else fillPercent = 0;

    drawStarShape(doc, currentX + size / 2, y, size, fillPercent, goldColor, emptyColor);
    currentX += size + gap;
  }
}

function uniqueSuitabilityCompact(p) {
  // Use the same parser (already strips %)
  const grouped = uniqueSuitabilityForUI(p, 999); // all segments
  if (!grouped.length) return [{ seg: "-", uses: "-" }];

  // keep one-page compact: max 8 segments
  return grouped.slice(0, 8);
}

async function downloadProductPdf(p, { productUrl, qrDataUrl }) {
  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;

  const BG = [11, 14, 20];
  const PANEL = [15, 18, 25];
  const BORDER = [45, 52, 66];
  const MUTED = [153, 163, 175];
  const TEXT = [240, 244, 248];

  doc.setFillColor(BG[0], BG[1], BG[2]);
  doc.rect(0, 0, pageW, pageH, "F");

  const code = getDisplayCode(p);
  const title = firstNonEmpty(p?.productTitle, p?.name, code);
  const tagline = firstNonEmpty(p?.productTagline, "");
  const metaLine = `${firstNonEmpty(p?.category, "-")} • ${firstNonEmpty(getStructure(p), "-")} • ${firstNonEmpty(
    p?.design,
    "-"
  )}`;

  const shortDesc = firstNonEmpty(
    p?.shortProductDescription,
    p?.productTagline,
    p?.description && stripHtml(p.description).slice(0, 120),
    "No description available"
  );

  const imgUrl = getPrimaryImage(p) || fallbackImageSvg(code);
  let imgDataUrl = null;
  try {
    imgDataUrl = imgUrl ? await toDataUrl(imgUrl) : null;
  } catch {
    imgDataUrl = null;
  }

  let logoDataUrl = null;
  try {
    logoDataUrl = await toDataUrl("/logo1.png");
  } catch {
    logoDataUrl = null;
  }

  const suit = uniqueSuitabilityCompact(p);

  const rNum = Number(firstNonEmpty(p?.ratingValue, ""));
  const ratingSafe = Number.isFinite(rNum) ? Math.max(0, Math.min(5, rNum)) : 0;
  const ratingCount = Number(firstNonEmpty(p?.ratingCount, "0")) || 0;

  /* ---------------- HEADER ---------------- */
  const headerH = 16;
  fillR(doc, margin, margin, pageW - margin * 2, headerH, PANEL, 6);
  strokeR(doc, margin, margin, pageW - margin * 2, headerH, BORDER, 6);

  const logoH = 9.5;
  const logoW = 20;
  const logoX = margin + 6;
  const logoY = margin + (headerH - logoH) / 2;

  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, "PNG", logoX, logoY, logoW, logoH);
    } catch { }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(TEXT[0], TEXT[1], TEXT[2]);
  doc.text("Amrita Global Enterprises", margin + 6 + logoW + 6, margin + 10);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.2);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text("Product sheet", pageW - margin - 6, margin + 10, { align: "right" });

  let y = margin + headerH + 7;

  /* ---------------- HERO (compact) ---------------- */
  const heroX = margin;
  const heroW = pageW - margin * 2;

  const qrBoxW = 26;
  const qrBoxH = 26;
  const qrPad = 6;

  const imgBoxW = 70;

  const imgBoxX = heroX + 6;
  const rightX = imgBoxX + imgBoxW + 7;
  const rightW = heroX + heroW - rightX - 6;

  const qrX = heroX + heroW - qrPad - qrBoxW;
  const qrY = y + qrPad;

  const textMaxW = Math.max(46, rightW - (qrBoxW + 6));

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13.2);
  const titleLines = pdfWrap(doc, title, textMaxW).slice(0, 2);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const metaLines = pdfWrap(doc, metaLine, textMaxW).slice(0, 1);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.8);
  const descLines = pdfWrap(doc, shortDesc, textMaxW).slice(0, 2);

  const heroH = 62;

  fillR(doc, heroX, y, heroW, heroH, PANEL, 10);
  strokeR(doc, heroX, y, heroW, heroH, BORDER, 10);

  const imgBoxY = y + 6;
  const imgBoxH = heroH - 12;
  fillR(doc, imgBoxX, imgBoxY, imgBoxW, imgBoxH, [20, 24, 33], 8);
  strokeR(doc, imgBoxX, imgBoxY, imgBoxW, imgBoxH, BORDER, 8);

  if (imgDataUrl && typeof imgDataUrl === "string") {
    const isPng = imgDataUrl.startsWith("data:image/png");
    const isJpeg = imgDataUrl.startsWith("data:image/jpeg");
    const fmt = isPng ? "PNG" : isJpeg ? "JPEG" : null;
    if (fmt) {
      try {
        doc.addImage(imgDataUrl, fmt, imgBoxX + 2, imgBoxY + 2, imgBoxW - 4, imgBoxH - 4);
      } catch { }
    }
  }

  fillR(doc, qrX, qrY, qrBoxW, qrBoxH, [20, 24, 33], 6);
  strokeR(doc, qrX, qrY, qrBoxW, qrBoxH, BORDER, 6);

  if (qrDataUrl && typeof qrDataUrl === "string") {
    try {
      doc.addImage(qrDataUrl, "PNG", qrX + 3, qrY + 3, qrBoxW - 6, qrBoxH - 6);
    } catch { }
  }

  doc.link(qrX, qrY, qrBoxW, qrBoxH, { url: productUrl });

  const pillW = Math.min(58, rightW);
  fillR(doc, rightX, y + 8, pillW, 8, [25, 30, 42], 5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.8);
  doc.setTextColor(225, 231, 239);
  doc.text(code, rightX + 4, y + 13.5);

  let ty = y + 23.5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13.2);
  doc.setTextColor(TEXT[0], TEXT[1], TEXT[2]);
  doc.text(titleLines, rightX, ty);
  ty += 9.2;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text(metaLines, rightX, ty);
  ty += 6.2;

  if (tagline) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(200, 208, 220);
    const tLines = pdfWrap(doc, tagline, textMaxW).slice(0, 1);
    doc.text(tLines, rightX, ty);
    ty += 5.5;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.8);
  doc.setTextColor(215, 222, 233);
  doc.text(descLines, rightX, ty);

  y += heroH + 8;

  /* ---------------- SHORT DESCRIPTION SECTION ---------------- */
  if (shortDesc && shortDesc !== "No description available") {
    const descSectionH = 28;
    fillR(doc, margin, y, pageW - margin * 2, descSectionH, PANEL, 8);
    strokeR(doc, margin, y, pageW - margin * 2, descSectionH, BORDER, 8);

    doc.setDrawColor(45, 212, 191);
    doc.setLineWidth(0.8);
    doc.line(margin + 8, y + 8, margin + 35, y + 8);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(TEXT[0], TEXT[1], TEXT[2]);
    doc.text("Product Description", margin + 8, y + 14);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(220, 225, 235);
    const descLines2 = pdfWrap(doc, shortDesc, pageW - margin * 2 - 16).slice(0, 2);
    doc.text(descLines2, margin + 8, y + 22);

    y += descSectionH + 6;
  }

  /* ---------------- KEY SPECS ---------------- */
  const gridGap = 6;
  const colW = (pageW - margin * 2 - gridGap) / 2;

  const specs = [
    { k: "Composition", v: firstNonEmpty(getComposition(p), "-") },
    { k: "GSM", v: firstNonEmpty(fmtNum(p?.gsm, 2), "-") },
    { k: "Width", v: firstNonEmpty(getWidthText(p), "-") },
    { k: "Color", v: firstNonEmpty(safeJoin(p?.color), "-") },
    { k: "Finish", v: firstNonEmpty(getFinish(p), "-") },
    { k: "MOQ", v: firstNonEmpty(fmtNum(p?.salesMOQ, 0), "-") },
  ];

  const cardH = 18;

  const drawKV = (x, y0, w, k, v) => {
    fillR(doc, x, y0, w, cardH, PANEL, 8);
    strokeR(doc, x, y0, w, cardH, BORDER, 8);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.2);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text(String(k), x + 6, y0 + 6.8);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.6);
    doc.setTextColor(TEXT[0], TEXT[1], TEXT[2]);
    const lines = pdfWrap(doc, String(v || "-"), w - 12).slice(0, 2);
    doc.text(lines, x + 6, y0 + 13.6);
  };

  for (let i = 0; i < specs.length; i += 2) {
    const left = specs[i];
    const right = specs[i + 1];

    const x1 = margin;
    const x2 = margin + colW + gridGap;

    drawKV(x1, y, colW, left.k, left.v);
    if (right) drawKV(x2, y, colW, right.k, right.v);

    y += cardH + 5;
  }

  /* ---------------- RATING SECTION ---------------- */
  const footerY = pageH - margin - 8;
  const remainingBeforeRating = footerY - y;
  let ratingBoxW = 0;
  let ratingBoxX = 0;

  if (remainingBeforeRating > 32) {
    const ratingBoxH = 30;
    ratingBoxW = 50;
    ratingBoxX = pageW - margin - ratingBoxW;

    fillR(doc, ratingBoxX, y, ratingBoxW, ratingBoxH, PANEL, 8);
    strokeR(doc, ratingBoxX, y, ratingBoxW, ratingBoxH, BORDER, 8);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.8);
    doc.setTextColor(TEXT[0], TEXT[1], TEXT[2]);
    doc.text("Rating", ratingBoxX + 6, y + 8);

    const starsY = y + 13;
    drawStars(doc, ratingBoxX + 6, starsY, ratingSafe, { size: 4.5, gap: 0.5 });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(TEXT[0], TEXT[1], TEXT[2]);
    doc.text(`${fmtNum(ratingSafe, 1)}/5`, ratingBoxX + 6, y + 21);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.2);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    const reviewText = `${fmtNum(ratingCount, 0)} reviews`;
    doc.text(reviewText, ratingBoxX + 6, y + 25.5);
  }

  /* ---------------- SUITABILITY (unique segments, no %) ---------------- */
  const remaining = footerY - y;
  if (remaining > 28) {
    const boxH = Math.min(60, remaining - 6);
    const suitabilityW = ratingBoxW > 0 ? (ratingBoxX - margin - 6) : (pageW - margin * 2);
    const maxSuitabilityW = ratingBoxW > 0
      ? Math.min(suitabilityW, ratingBoxX - margin - 6)
      : suitabilityW;

    fillR(doc, margin, y, maxSuitabilityW, boxH, PANEL, 10);
    strokeR(doc, margin, y, maxSuitabilityW, boxH, BORDER, 10);

    doc.setDrawColor(45, 212, 191);
    doc.setLineWidth(0.8);
    doc.line(margin + 8, y + 10, margin + 28, y + 10);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.8);
    doc.setTextColor(TEXT[0], TEXT[1], TEXT[2]);
    doc.text("Suitability", margin + 8, y + 16.8);

    const rowStartY = y + 24;
    const rowH = 7.2;
    const maxRows = Math.max(1, Math.floor((boxH - 26) / rowH));
    const show = suit.slice(0, maxRows);

    let sy = rowStartY;
    for (let i = 0; i < show.length; i++) {
      const r = show[i];
      const rowBgW = ratingBoxW > 0 ? (ratingBoxX - margin - 14) : (pageW - margin * 2 - 14);
      if (i % 2 === 0) fillR(doc, margin + 7, sy - 5.0, rowBgW, 6.6, [20, 24, 33], 4);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.2);
      doc.setTextColor(TEXT[0], TEXT[1], TEXT[2]);
      doc.text(String(r.seg).slice(0, 22), margin + 10, sy);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.2);
      doc.setTextColor(210, 217, 228);
      const usesMaxW = ratingBoxW > 0 ? (ratingBoxX - margin - 90) : (pageW - margin * 2 - 90);
      const usesLine = pdfWrap(doc, r.uses || "-", Math.max(20, usesMaxW)).slice(0, 1);
      doc.text(usesLine, margin + 55, sy);

      sy += rowH;
      if (sy > y + boxH - 6) break;
    }
  }

  /* ---------------- FOOTER ---------------- */
  const stamp = `Generated • ${new Date().toLocaleString()}`;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.2);
  doc.setTextColor(153, 163, 175);
  doc.text(stamp, margin, pageH - 8);
  doc.text(`1 / 1`, pageW - margin, pageH - 8, { align: "right" });

  doc.save(`${code}.pdf`);
}

/* ------------------------------ UI ------------------------------ */
function Header() {
  return (
    <div className="header">
      <div className="brand">
        <div className="brandMark">AGE</div>
        <div>
          <div className="brandName">Amrita Global Enterprises</div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ DATA HOOK ------------------------------ */
function useProducts() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = async () => {
    setError("");
    setLoading(true);
    try {
      const all = await fetchAllProducts();
      setProducts(all);
    } catch (e) {
      setError(e?.message || "Failed to load products");
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { products, loading, error, reload };
}

/* ------------------------------ PAGE 1 ------------------------------ */
function CataloguePage({ products, loading, error, reload }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      const blob = [
        p.id,
        p.name,
        p.productTitle,
        p.productTagline,
        p.category,
        p.structure,
        p.design,
        safeJoin(p.content),
        safeJoin(p.color),
        safeJoin(p.finish),
        p.fabricCode,
        p.vendorFabricCode,
        p.productslug,
        p.collectionName,
        safeJoin(p.merchTags),
      ].join(" ");
      return textIncludes(blob, q);
    });
  }, [products, query]);

  return (
    <div className="app">
      <Header />

      <div className="filters">
        <div className="searchWrap">
          <span className="searchIcon">⌕</span>
          <input
            className="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, code, category, weave/structure, tags..."
          />
          {query ? (
            <button className="clearBtn" onClick={() => setQuery("")}>
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="loadingBox">Loading products…</div>
      ) : error ? (
        <div className="errorBox">
          <div className="errorTitle">Couldn’t load products</div>
          <div className="errorText">{error}</div>
          <button className="retryBtn" onClick={reload}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="summary">
            <div className="count">
              Showing <b>{filtered.length}</b> of <b>{products.length}</b> products
            </div>
            <div className="note">Tip: try “camel”, “poplin”, “mercerized”, “ecatalogue”</div>
          </div>

          <div className="grid">
            {filtered.map((p) => {
              const img = getPrimaryImage(p) || fallbackImageSvg(getDisplayCode(p));
              const code = getDisplayCode(p);
              const tags = filterTags(p.merchTags).slice(0, 2);

              return (
                <Link key={p.id} to={`/product/${p.id}`} className="card">
                  <div className="cardMedia">
                    <img
                      src={img}
                      alt={p.name || code}
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.onerror = null;
                        e.currentTarget.src = fallbackImageSvg(code);
                      }}
                    />
                    <div className="codeBadge">{code}</div>
                  </div>

                  <div className="cardBody">
                    <div className="cardTop">
                      <div className="title">{firstNonEmpty(p.productTitle, p.name, code)}</div>
                      <div className="meta">
                        {firstNonEmpty(p.category, "-")} • {firstNonEmpty(getStructure(p), "-")}
                      </div>
                    </div>

                    <div className="desc">{getShortDesc(p) || "-"}</div>

                    <div className="specs">
                      <div className="spec">
                        <div className="k">GSM</div>
                        <div className="v">{firstNonEmpty(fmtNum(p.gsm, 2), "-")}</div>
                      </div>
                      <div className="spec">
                        <div className="k">Width</div>
                        <div className="v">
                          {firstNonEmpty(
                            isNum(p.inch) ? `${fmtNum(p.inch, 2)}"` : "",
                            isNum(p.cm) ? `${fmtNum(p.cm, 0)}cm` : "",
                            "-"
                          )}
                        </div>
                      </div>
                      <div className="spec">
                        <div className="k">Colors</div>
                        <div className="v">{Array.isArray(p.color) ? p.color.length : "-"}</div>
                      </div>
                      <div className="spec">
                        <div className="k">MOQ</div>
                        <div className="v">{firstNonEmpty(fmtNum(p.salesMOQ, 0), "-")}</div>
                      </div>
                    </div>

                    {tags.length > 0 && (
                      <div className="chips">
                        {tags.map((t) => (
                          <span key={t} className="chip" title={t}>
                            {t}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="ctaRow">
                      <span className="cta">View details →</span>
                      <span className="hint">Catalogue</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}

      <div className="footer">© {new Date().getFullYear()} Amrita Global Enterprises • Internal catalogue</div>
    </div>
  );
}

/* ------------------------------ FAQ Item ------------------------------ */
function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`faqItem ${open ? "open" : ""}`}>
      <button className="faqQ" onClick={() => setOpen((v) => !v)} type="button">
        <span>{q}</span>
        <span className="faqIcon">{open ? "–" : "+"}</span>
      </button>
      {open && <div className="faqA">{a}</div>}
    </div>
  );
}

/* ------------------------------ PAGE 2 ------------------------------ */
function ProductDetailsPage({ products, loading }) {
  const { id } = useParams();
  const nav = useNavigate();

  const p = useMemo(() => products.find((x) => x.id === id), [products, id]);
  const [qrOpen, setQrOpen] = useState(false);

  const qrRef = useRef(null);

  if (loading) {
    return (
      <div className="app">
        <Header />
        <div className="detailsTop">
          <button className="backBtn" onClick={() => nav("/")}>
            ← Back
          </button>
        </div>
        <div className="loadingBox">Loading product…</div>
      </div>
    );
  }

  if (!p) {
    return (
      <div className="app">
        <Header />
        <div className="detailsTop">
          <button className="backBtn" onClick={() => nav("/")}>
            ← Back
          </button>
        </div>
        <div className="emptyState">
          <div className="emptyTitle">Product not found</div>
          <div className="emptyText">This product id doesn’t exist in your CProduct list.</div>
        </div>
      </div>
    );
  }

  const base = FRONTEND_URL || window.location.origin;
  const productUrl = `${base.replace(/\/$/, "")}/product/${p.id}`;
  const code = getDisplayCode(p);
  const img = getPrimaryImage(p) || fallbackImageSvg(code);

  const tags = filterTags(p.merchTags);

  // ✅ NEW: grouped, unique, no % values
  const suitabilityUnique = useMemo(() => uniqueSuitabilityForUI(p, 14), [p]);

  const faq = getFaqList(p);

  const aboutHtml = firstNonEmpty(p.fullProductDescription, p.description, "");
  const aboutFallback = firstNonEmpty(
    stripHtml(p.fullProductDescription),
    stripHtml(p.description),
    p.shortProductDescription,
    "-"
  );

  const onDownloadPdf = async () => {
    await new Promise((r) => setTimeout(r, 50));
    const qrCanvas = qrRef.current;
    const qrDataUrl = qrCanvas && qrCanvas.toDataURL ? qrCanvas.toDataURL("image/png") : "";
    await downloadProductPdf(p, { productUrl, qrDataUrl });
  };

  return (
    <div className="app">
      <Header />

      <div style={{ position: "fixed", left: "-99999px", top: "-99999px" }}>
        <QRCodeCanvas ref={qrRef} value={productUrl} size={240} includeMargin />
      </div>

      <div className="detailsTop">
        <button className="backBtn" onClick={() => nav("/")}>
          ← Back to Catalogue
        </button>

        <div className="topActions">
          <button className="qrBtn" onClick={() => setQrOpen(true)}>
            QR Code
          </button>

          <button className="pdfBtn" onClick={onDownloadPdf}>
            Download PDF
          </button>
        </div>
      </div>

      <div className="details">
        <div className="detailsMedia">
          <img
            src={img}
            alt={p.name || code}
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = fallbackImageSvg(code);
            }}
          />
        </div>

        <div className="detailsInfo">
          <div className="detailsHeader">
            <div>
              <div className="detailsCode">{code}</div>
              <div className="detailsName">{firstNonEmpty(p.productTitle, p.name, code)}</div>
              <div className="detailsMeta">
                {firstNonEmpty(p.category, "-")} • {firstNonEmpty(getStructure(p), "-")} •{" "}
                {firstNonEmpty(p.design, "-")}
              </div>

              {firstNonEmpty(p.productTagline, "") && (
                <div className="detailsTagline">{p.productTagline}</div>
              )}
            </div>

            {tags.length > 0 && (
              <div className="chips right">
                {tags.slice(0, 6).map((t) => (
                  <span key={t} className="chip" title={t}>
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="detailGrid">
            <div className="kv">
              <div className="k">Composition</div>
              <div className="v">{firstNonEmpty(getComposition(p), "-")}</div>
            </div>
            <div className="kv">
              <div className="k">GSM</div>
              <div className="v">{firstNonEmpty(fmtNum(p.gsm, 2), "-")}</div>
            </div>
            <div className="kv">
              <div className="k">Width</div>
              <div className="v">{getWidthText(p)}</div>
            </div>
            <div className="kv">
              <div className="k">Color</div>
              <div className="v">{firstNonEmpty(safeJoin(p.color), "-")}</div>
            </div>
            <div className="kv">
              <div className="k">Finish</div>
              <div className="v">{firstNonEmpty(getFinish(p), "-")}</div>
            </div>
            <div className="kv">
              <div className="k">MOQ</div>
              <div className="v">{firstNonEmpty(fmtNum(p.salesMOQ, 0), "-")}</div>
            </div>
            <div className="kv">
              <div className="k">Supply Model</div>
              <div className="v">{firstNonEmpty(p.supplyModel, "-")}</div>
            </div>
            <div className="kv">
              <div className="k">Collection</div>
              <div className="v">{firstNonEmpty(p.collectionName, p.collection?.name, "-")}</div>
            </div>
          </div>

          <div className="sectionGrid">
            <div className="panel">
              <div className="panelTitle">About</div>
              {aboutHtml ? (
                <div className="aboutHtml" dangerouslySetInnerHTML={{ __html: safeHtml(aboutHtml) }} />
              ) : (
                <div className="panelText">{aboutFallback}</div>
              )}
            </div>

            <div className="panel">
              <div className="panelTitle">Suitability</div>

              {suitabilityUnique.length > 0 ? (
                <div className="suitRows">
                  {suitabilityUnique.slice(0, 14).map((r, idx) => (
                    <div key={idx} className="suitRow">
                      {/* left column */}
                      <div className="suitA">{r.seg}</div>
                      {/* right column (unique uses, NO %) */}
                      <div className="suitB">{r.uses}</div>
                      {/* keep third column empty to match your existing CSS grid */}
                      <div className="suitC" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="panelText">-</div>
              )}
            </div>
          </div>

          <div className="sectionGrid2">
            <div className="panel">
              <div className="panelTitle">Keywords</div>
              <div className="chips">
                {(p.keywords || []).slice(0, 18).map((k) => (
                  <span key={k} className="chip soft">
                    {k}
                  </span>
                ))}
                {(!p.keywords || p.keywords.length === 0) && <span className="chip soft">-</span>}
              </div>
            </div>

            <div className="panel">
              <div className="panelTitle">Rating</div>
              <div className="ratingBox">
                <div className="ratingStars">
                  {[1, 2, 3, 4, 5].map((star) => {
                    const ratingValue = Number(p.ratingValue) || 0;
                    const filled = star <= ratingValue;
                    const halfFilled = star - 0.5 <= ratingValue && star > ratingValue;
                    return (
                      <span
                        key={star}
                        className={`star ${filled ? "filled" : halfFilled ? "half" : "empty"}`}
                      >
                        ★
                      </span>
                    );
                  })}
                </div>
                <div className="ratingValue">{firstNonEmpty(fmtNum(p.ratingValue, 1), "0")}/5</div>
                <div className="ratingMeta">{firstNonEmpty(fmtNum(p.ratingCount, 0), "0")} reviews</div>
              </div>
            </div>
          </div>

          {faq.length > 0 && (
            <div className="panel faqPanel">
              <div className="panelTitle">FAQs</div>
              <div className="faqList">
                {faq.map((x, i) => (
                  <FaqItem key={i} q={x.q} a={x.a} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {qrOpen && (
        <div className="qrModalOverlay" onClick={() => setQrOpen(false)}>
          <div className="qrModal" onClick={(e) => e.stopPropagation()}>
            <div className="qrModalTop">
              <div>
                <div className="qrModalTitle">Scan to open product</div>
                <div className="qrModalCode">{code}</div>
              </div>
              <button className="qrClose" onClick={() => setQrOpen(false)}>
                ✕
              </button>
            </div>

            <div className="qrBig">
              <QRCodeCanvas value={productUrl} size={260} includeMargin />
            </div>

            <a className="qrOpenLink" href={productUrl} target="_blank" rel="noreferrer">
              Open link
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ ROUTES ------------------------------ */
export default function App() {
  const [theme, setTheme] = useState(() => getInitialTheme());
  const { products, loading, error, reload } = useProducts();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const envOk = ESPO_ENTITY_URL && ESPO_API_KEY;

  if (!envOk) {
    return (
      <div className="app">
        <Header />
        <div className="errorBox">
          <div className="errorTitle">Environment missing</div>
          <div className="errorText">
            Please set <b>VITE_ESPO_BASEURL</b> and <b>VITE_X_API_KEY</b> in <code>.env</code>, then restart the dev server.
          </div>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/"
        element={<CataloguePage products={products} loading={loading} error={error} reload={reload} />}
      />
      <Route path="/product/:id" element={<ProductDetailsPage products={products} loading={loading} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
