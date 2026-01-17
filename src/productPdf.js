// src/productPdf.js
import jsPDF from "jspdf";

/* ------------------------------ small helpers (PDF needs its own) ------------------------------ */
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

  return { seg: seg || "-", use: use || "-", score: scoreOnly || "" };
}
function uniqueSuitabilityForUI(p, maxSeg = 12) {
  const rows = (p?.suitability || []).map(parseSuitabilityLine).filter(Boolean);

  const map = new Map();
  for (const r of rows) {
    const segLabel = normalizeSuitabilityText(r.seg || "");
    const segKey = segLabel.toLowerCase();
    if (!segKey) continue;

    if (!map.has(segKey)) map.set(segKey, { seg: segLabel, usesMap: new Map() });

    const useLabel = normalizeSuitabilityText(r.use || "");
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
function uniqueSuitabilityCompact(p) {
  const grouped = uniqueSuitabilityForUI(p, 999);
  if (!grouped.length) return [{ seg: "-", uses: "-" }];
  return grouped.slice(0, 12);
}

/* ------------------------------ PDF utils ------------------------------ */
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

/* ------------------------------ Stars in PDF (FIXED) ------------------------------ */
/* This is the exact safer approach that worked earlier:
   - draw star using moveTo/lineTo
   - for partial star, clip with doc.rect(..., null) so it DOES NOT draw a rectangle (no square artifact)
*/
function drawStarShape(doc, x, y, size, fillPercent, color, emptyColor) {
  const outerRadius = size / 2;
  const innerRadius = outerRadius * 0.38;

  const points = [];
  for (let i = 0; i < 5; i++) {
    const outerAngle = Math.PI / 2 + (i * 2 * Math.PI) / 5;
    points.push({
      x: x + outerRadius * Math.cos(outerAngle),
      y: y - outerRadius * Math.sin(outerAngle),
    });
    const innerAngle = outerAngle + Math.PI / 5;
    points.push({
      x: x + innerRadius * Math.cos(innerAngle),
      y: y - innerRadius * Math.sin(innerAngle),
    });
  }

  const drawStarPath = () => {
    doc.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) doc.lineTo(points[i].x, points[i].y);
    doc.close();
  };

  const fill = Math.max(0, Math.min(1, Number(fillPercent) || 0));
  doc.setLineWidth(0.25);

  const doFillStroke = () => {
    if (typeof doc.fillStroke === "function") doc.fillStroke();
    else {
      doc.fill();
      doc.stroke();
    }
  };

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
    doFillStroke();
    return;
  }

  // outline first
  doc.setDrawColor(emptyColor[0], emptyColor[1], emptyColor[2]);
  drawStarPath();
  doc.stroke();

  // partial fill (clip) — IMPORTANT: style=null to avoid drawing a rectangle/square
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

  const size = Number(opts.size ?? 3);
  const gap = Number(opts.gap ?? 0.7);

  const goldColor = [255, 215, 0];
  const emptyColor = [160, 165, 175];

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

/* ------------------------------ EXPORT: main PDF function ------------------------------ */
export async function downloadProductPdf(
  p,
  {
    productUrl,
    qrDataUrl,
    logoPath = "/logo1.png",
    companyName = "Amrita Global Enterprises",
    sheetLabel = "Product sheet",
  } = {}
) {
  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;

  // ✅ WHITE PDF THEME (clean)
  const BG = [255, 255, 255];
  const PANEL = [248, 250, 252];
  const BORDER = [226, 232, 240];
  const MUTED = [71, 85, 105];
  const TEXT = [15, 23, 42];
  const ACCENT = [45, 212, 191];

  // background
  doc.setFillColor(BG[0], BG[1], BG[2]);
  doc.rect(0, 0, pageW, pageH, "F");

  const code = getDisplayCode(p);
  const title = firstNonEmpty(p?.productTitle, p?.name, code);
  const tagline = firstNonEmpty(p?.productTagline, "");
  const metaLine = `${firstNonEmpty(p?.category, "-")} • ${firstNonEmpty(
    getStructure(p),
    "-"
  )} • ${firstNonEmpty(p?.design, "-")}`;

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
    logoDataUrl = await toDataUrl(logoPath);
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
    } catch {}
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(TEXT[0], TEXT[1], TEXT[2]);
  doc.text(companyName, margin + 6 + logoW + 6, margin + 10);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.2);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text(sheetLabel, pageW - margin - 6, margin + 10, { align: "right" });

  let y = margin + headerH + 7;

  /* ---------------- HERO ---------------- */
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

  // image box
  const imgBoxY = y + 6;
  const imgBoxH = heroH - 12;
  fillR(doc, imgBoxX, imgBoxY, imgBoxW, imgBoxH, [255, 255, 255], 8);
  strokeR(doc, imgBoxX, imgBoxY, imgBoxW, imgBoxH, BORDER, 8);

  if (imgDataUrl && typeof imgDataUrl === "string") {
    const isPng = imgDataUrl.startsWith("data:image/png");
    const isJpeg = imgDataUrl.startsWith("data:image/jpeg");
    const fmt = isPng ? "PNG" : isJpeg ? "JPEG" : null;
    if (fmt) {
      try {
        doc.addImage(imgDataUrl, fmt, imgBoxX + 2, imgBoxY + 2, imgBoxW - 4, imgBoxH - 4);
      } catch {}
    }
  }

  // QR box
  fillR(doc, qrX, qrY, qrBoxW, qrBoxH, [255, 255, 255], 6);
  strokeR(doc, qrX, qrY, qrBoxW, qrBoxH, BORDER, 6);

  if (qrDataUrl && typeof qrDataUrl === "string") {
    try {
      doc.addImage(qrDataUrl, "PNG", qrX + 3, qrY + 3, qrBoxW - 6, qrBoxH - 6);
    } catch {}
  }
  if (productUrl) doc.link(qrX, qrY, qrBoxW, qrBoxH, { url: productUrl });

  // code pill
  const pillW = Math.min(58, rightW);
  fillR(doc, rightX, y + 8, pillW, 8, [237, 233, 254], 5);
  strokeR(doc, rightX, y + 8, pillW, 8, [221, 214, 254], 5);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.8);
  doc.setTextColor(76, 29, 149);
  doc.text(code, rightX + 4, y + 13.5);

  // title/meta/desc
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
    doc.setTextColor(51, 65, 85);
    const tLines = pdfWrap(doc, tagline, textMaxW).slice(0, 1);
    doc.text(tLines, rightX, ty);
    ty += 5.5;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.8);
  doc.setTextColor(51, 65, 85);
  doc.text(descLines, rightX, ty);

  y += heroH + 8;

  /* ---------------- SHORT DESCRIPTION SECTION ---------------- */
  if (shortDesc && shortDesc !== "No description available") {
    const descSectionH = 28;
    fillR(doc, margin, y, pageW - margin * 2, descSectionH, PANEL, 8);
    strokeR(doc, margin, y, pageW - margin * 2, descSectionH, BORDER, 8);

    doc.setDrawColor(ACCENT[0], ACCENT[1], ACCENT[2]);
    doc.setLineWidth(0.8);
    doc.line(margin + 8, y + 8, margin + 35, y + 8);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(TEXT[0], TEXT[1], TEXT[2]);
    doc.text("Product Description", margin + 8, y + 14);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(51, 65, 85);
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
    doc.text(`${fmtNum(ratingCount, 0)} reviews`, ratingBoxX + 6, y + 25.5);
  }

  /* ---------------- SUITABILITY ---------------- */
  const remaining = footerY - y;
  if (remaining > 28) {
    const boxH = Math.min(66, remaining - 6);
    const maxSuitabilityW = ratingBoxW > 0 ? ratingBoxX - margin - 6 : pageW - margin * 2;

    fillR(doc, margin, y, maxSuitabilityW, boxH, PANEL, 10);
    strokeR(doc, margin, y, maxSuitabilityW, boxH, BORDER, 10);

    doc.setDrawColor(ACCENT[0], ACCENT[1], ACCENT[2]);
    doc.setLineWidth(0.8);
    doc.line(margin + 8, y + 10, margin + 28, y + 10);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.8);
    doc.setTextColor(TEXT[0], TEXT[1], TEXT[2]);
    doc.text("Suitability", margin + 8, y + 16.8);

    const rowStartY = y + 24;
    const rowH = 6.6;
    const maxRows = Math.max(1, Math.floor((boxH - 26) / rowH));
    const show = suit.slice(0, maxRows);

    let sy = rowStartY;
    for (let i = 0; i < show.length; i++) {
      const r = show[i];
      const rowBgW = ratingBoxW > 0 ? ratingBoxX - margin - 14 : pageW - margin * 2 - 14;

      if (i % 2 === 0) {
        fillR(doc, margin + 7, sy - 4.8, rowBgW, 6.0, [255, 255, 255], 4);
        strokeR(doc, margin + 7, sy - 4.8, rowBgW, 6.0, BORDER, 4, 0.15);
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.1);
      doc.setTextColor(TEXT[0], TEXT[1], TEXT[2]);
      doc.text(String(r.seg).slice(0, 24), margin + 10, sy);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.1);
      doc.setTextColor(51, 65, 85);
      const usesMaxW = ratingBoxW > 0 ? ratingBoxX - margin - 90 : pageW - margin * 2 - 90;
      const usesLine = pdfWrap(doc, r.uses || "-", Math.max(20, usesMaxW)).slice(0, 1);
      doc.text(usesLine, margin + 58, sy);

      sy += rowH;
      if (sy > y + boxH - 6) break;
    }
  }

  /* ---------------- FOOTER ---------------- */
  const stamp = `Generated • ${new Date().toLocaleString()}`;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.2);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text(stamp, margin, pageH - 8);
  doc.text(`1 / 1`, pageW - margin, pageH - 8, { align: "right" });

  doc.save(`${code}.pdf`);
}
