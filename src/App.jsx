// src/App.jsx
import React, { useEffect, useMemo, useState } from "react";
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

function getColorsCount(p) {
  if (typeof p?.colors === "number") return p.colors > 0 ? String(p.colors) : "-";
  if (Array.isArray(p?.color)) return p.color.length > 0 ? String(p.color.length) : "-";
  return "-";
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

function stripHtml(html) {
  try {
    const div = document.createElement("div");
    div.innerHTML = String(html || "");
    return (div.textContent || div.innerText || "").trim();
  } catch {
    return String(html || "");
  }
}

/* Safer HTML rendering (removes script/style + inline on* attrs + javascript: links) */
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
    .filter((t) => String(t).trim().toLowerCase() !== "draft"); // remove Draft everywhere
}

function parseSuitabilityLine(line) {
  const raw = String(line || "").trim();
  if (!raw) return null;

  // split on "|" and clean
  const parts = raw.split("|").map((x) => x.trim()).filter(Boolean);

  if (parts.length >= 3) {
    return { a: parts[0], b: parts[1], c: parts.slice(2).join(" - ") };
  }
  // fallback: just replace | with -
  return { a: raw.replace(/\s*\|\s*/g, " - "), b: "", c: "" };
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

/* ------------------------------ PDF ------------------------------ */
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

async function downloadProductPdf(p) {
  const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;

  const base = FRONTEND_URL || window.location.origin;
  const productUrl = `${base.replace(/\/$/, "")}/product/${p.id}`;

  const code = getDisplayCode(p);
  const title = firstNonEmpty(p?.productTitle, p?.name, code);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Amrita Global Enterprises", margin, 16);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("Product Sheet (Auto Generated)", margin, 22);

  doc.setDrawColor(210);
  doc.line(margin, 26, pageW - margin, 26);

  const topY = 34;

  const imgW = 62;
  const imgH = 42;
  const imgX = pageW - margin - imgW;
  const imgY = topY;

  doc.setDrawColor(220);
  doc.roundedRect(imgX, imgY, imgW, imgH, 3, 3);

  const pad = 2;
  const drawImgX = imgX + pad;
  const drawImgY = imgY + pad;
  const drawImgW = imgW - pad * 2;
  const drawImgH = imgH - pad * 2;

  const textMaxW = pageW - margin - (imgW + 10) - margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(title, margin, topY + 8, { maxWidth: textMaxW });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Code: ${code}`, margin, topY + 16);

  const imgUrl = getPrimaryImage(p);
  let imgDataUrl = null;

  try {
    if (imgUrl) imgDataUrl = await toDataUrl(imgUrl);
  } catch {
    imgDataUrl = null;
  }

  if (imgDataUrl && typeof imgDataUrl === "string") {
    const isPng = imgDataUrl.startsWith("data:image/png");
    const isJpeg = imgDataUrl.startsWith("data:image/jpeg");
    const fmt = isPng ? "PNG" : isJpeg ? "JPEG" : null;

    if (fmt) {
      try {
        doc.addImage(imgDataUrl, fmt, drawImgX, drawImgY, drawImgW, drawImgH);
      } catch {}
    }
  }

  const boxTop = 82;
  const boxH = 52;

  doc.setDrawColor(180);
  doc.roundedRect(margin, boxTop, pageW - margin * 2, boxH, 3, 3);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Key Specs", margin + 4, boxTop + 8);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);

  const leftX = margin + 4;
  const midX = margin + (pageW - margin * 2) / 2;

  doc.text(`Composition: ${firstNonEmpty(getComposition(p), "-")}`, leftX, boxTop + 18);
  doc.text(`GSM: ${firstNonEmpty(fmtNum(p?.gsm, 2), "-")}`, leftX, boxTop + 28);
  doc.text(`Width: ${getWidthText(p)}`, leftX, boxTop + 38);
  doc.text(`Finish: ${firstNonEmpty(getFinish(p), "-")}`, leftX, boxTop + 48, {
    maxWidth: (pageW - margin * 2) / 2 - 6,
  });

  doc.text(`Color: ${firstNonEmpty(safeJoin(p?.color), "-")}`, midX, boxTop + 18);
  doc.text(`MOQ: ${firstNonEmpty(fmtNum(p?.salesMOQ, 0), "-")}`, midX, boxTop + 28);
  doc.text(`Supply: ${firstNonEmpty(p?.supplyModel, "-")}`, midX, boxTop + 38);
  doc.text(`Collection: ${firstNonEmpty(p?.collectionName, p?.collection?.name, "-")}`, midX, boxTop + 48, {
    maxWidth: (pageW - margin * 2) / 2 - 6,
  });

  const aboutY = boxTop + boxH + 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("About", margin, aboutY);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const about = firstNonEmpty(stripHtml(p?.fullProductDescription), stripHtml(p?.description), p?.shortProductDescription, "-");
  doc.text(doc.splitTextToSize(about, pageW - margin * 2), margin, aboutY + 7);

  const qrBoxW = 55;
  const qrBoxH = 62;
  const qrX = pageW - margin - qrBoxW;
  const qrY = pageH - margin - qrBoxH - 12;

  doc.setDrawColor(200);
  doc.roundedRect(qrX, qrY, qrBoxW, qrBoxH, 3, 3);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(0);
  doc.text("Scan to open", qrX + 4, qrY + 8);

  const qrCanvas = document.getElementById(`qr-canvas-${p.id}`);
  if (qrCanvas && qrCanvas.toDataURL) {
    const qrPng = qrCanvas.toDataURL("image/png");
    try {
      doc.addImage(qrPng, "PNG", qrX + 6, qrY + 12, 43, 43);
    } catch {}
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(40, 90, 200);
  const shortLink = doc.splitTextToSize(productUrl, qrBoxW - 8);
  doc.text(shortLink, qrX + 4, qrY + qrBoxH - 4, { maxWidth: qrBoxW - 8 });
  doc.link(qrX + 4, qrY + qrBoxH - 10, qrBoxW - 8, 10, { url: productUrl });

  doc.setFontSize(9);
  doc.setTextColor(130);
  doc.text(`Generated • ${new Date().toLocaleString()}`, margin, pageH - 10);

  doc.save(`${code}.pdf`);
}

/* ------------------------------ UI ------------------------------ */
function Header({ theme, onToggleTheme }) {
  const isLight = theme === "light";
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
function CataloguePage({ products, loading, error, reload, theme, onToggleTheme }) {
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
      <Header theme={theme} onToggleTheme={onToggleTheme} />

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

              const tags = filterTags(p.merchTags).slice(0, 2); // ✅ Draft removed

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
                        <div className="v">{getColorsCount(p)}</div>
                      </div>
                      <div className="spec">
                        <div className="k">MOQ</div>
                        <div className="v">{firstNonEmpty(fmtNum(p.salesMOQ, 0), "-")}</div>
                      </div>
                    </div>

                    {/* ✅ No Draft chip here */}
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
function ProductDetailsPage({ products, loading, theme, onToggleTheme }) {
  const { id } = useParams();
  const nav = useNavigate();

  const p = useMemo(() => products.find((x) => x.id === id), [products, id]);
  const [qrOpen, setQrOpen] = useState(false);

  if (loading) {
    return (
      <div className="app">
        <Header theme={theme} onToggleTheme={onToggleTheme} />
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
        <Header theme={theme} onToggleTheme={onToggleTheme} />
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

  const tags = filterTags(p.merchTags); // ✅ Draft removed
  const suitabilityRows = (p.suitability || []).map(parseSuitabilityLine).filter(Boolean);
  const faq = getFaqList(p);

  const aboutHtml = firstNonEmpty(p.fullProductDescription, p.description, "");
  const aboutFallback = firstNonEmpty(stripHtml(p.fullProductDescription), stripHtml(p.description), p.shortProductDescription, "-");

  return (
    <div className="app">
      <Header theme={theme} onToggleTheme={onToggleTheme} />

      {/* Hidden QR canvas ONLY for PDF capture */}
      <div style={{ position: "fixed", left: "-99999px", top: "-99999px" }}>
        <QRCodeCanvas id={`qr-canvas-${p.id}`} value={productUrl} size={220} includeMargin />
      </div>

      <div className="detailsTop">
        <button className="backBtn" onClick={() => nav("/")}>
          ← Back to Catalogue
        </button>

        <div className="topActions">
          <button className="qrBtn" onClick={() => setQrOpen(true)}>
            QR Code
          </button>

          <button className="pdfBtn" onClick={() => downloadProductPdf(p)}>
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
                {firstNonEmpty(p.category, "-")} • {firstNonEmpty(getStructure(p), "-")} • {firstNonEmpty(p.design, "-")}
              </div>

              {firstNonEmpty(p.productTagline, "") && (
                <div className="detailsTagline">{p.productTagline}</div>
              )}
            </div>

            {/* ✅ No Draft anywhere */}
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

          {/* ✅ New attractive panels */}
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

              {suitabilityRows.length > 0 ? (
                <div className="suitRows">
                  {suitabilityRows.slice(0, 14).map((r, idx) => (
                    <div key={idx} className="suitRow">
                      <div className="suitA">{r.a}</div>
                      {r.b ? <div className="suitB">{r.b}</div> : <div className="suitB" />}
                      <div className="suitC">{r.c}</div>
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
                <div className="ratingValue">{firstNonEmpty(fmtNum(p.ratingValue, 1), "-")}</div>
                <div className="ratingMeta">
                  {firstNonEmpty(fmtNum(p.ratingCount, 0), "0")} reviews
                </div>
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

          {/* ✅ Removed the pricing/stock callout completely */}
        </div>
      </div>

      {/* BIG QR MODAL */}
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

  const onToggleTheme = () => setTheme((t) => (t === "light" ? "dark" : "light"));

  const envOk = ESPO_ENTITY_URL && ESPO_API_KEY;

  if (!envOk) {
    return (
      <div className="app">
        <Header theme={theme} onToggleTheme={onToggleTheme} />
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
        element={
          <CataloguePage
            products={products}
            loading={loading}
            error={error}
            reload={reload}
            theme={theme}
            onToggleTheme={onToggleTheme}
          />
        }
      />
      <Route
        path="/product/:id"
        element={<ProductDetailsPage products={products} loading={loading} theme={theme} onToggleTheme={onToggleTheme} />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
