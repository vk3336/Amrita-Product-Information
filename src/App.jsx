// src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Routes,
  Route,
  Link,
  useParams,
  Navigate,
  useNavigate,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import "./App.css";

import { QRCodeCanvas } from "qrcode.react";
import { downloadProductPdf } from "./productPdf";
import { trackEvent, trackPageView } from "./ga";


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
function uniqueSuitabilityForUI(p, maxSeg = 12) {
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
                <Link
                  key={p.id}
                  to={`/product/${p.id}`}
                  className="card"
                  onClick={() => {
                    const itemName = firstNonEmpty(p.productTitle, p.name, code);
                    trackEvent("select_item", {
                      item_list_name: "Catalogue",
                      items: [
                        {
                          item_id: p.id,
                          item_name: itemName,
                          item_category: firstNonEmpty(p.category, ""),
                          item_variant: firstNonEmpty(p.design, ""),
                          item_brand: "AGE",
                        },
                      ],
                    });
                  }}
                >
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

      <div className="footer">
        © {new Date().getFullYear()} Amrita Global Enterprises • Internal catalogue
      </div>
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
  const [searchParams] = useSearchParams();
  const src = String(searchParams.get("src") || "").trim().toLowerCase();

  // ✅ ALL HOOKS MUST RUN BEFORE ANY RETURN
  const p = useMemo(() => products.find((x) => x.id === id), [products, id]);
  const [qrOpen, setQrOpen] = useState(false);
  const qrRef = useRef(null);

  // keep derived values safe even when p is null
  const suitabilityUnique = useMemo(() => (p ? uniqueSuitabilityForUI(p, 50) : []), [p]);
  const faq = useMemo(() => (p ? getFaqList(p) : []), [p]);

  // optional: close QR modal when switching product
  useEffect(() => {
    setQrOpen(false);
  }, [id]);

  // Analytics: product view + QR-source detection
  useEffect(() => {
    if (!p) return;

    const codeLocal = getDisplayCode(p);
    const itemName = firstNonEmpty(p.productTitle, p.name, codeLocal);

    trackEvent("view_item", {
      source: src || "web",
      product_id: p.id,
      product_code: codeLocal,
      items: [
        {
          item_id: p.id,
          item_name: itemName,
          item_category: firstNonEmpty(p.category, ""),
          item_variant: firstNonEmpty(p.design, ""),
          item_brand: "AGE",
        },
      ],
    });

    if (src && src.startsWith("qr")) {
      trackEvent("qr_scan_open", {
        src,
        product_id: p.id,
        product_code: codeLocal,
      });
    }
  }, [p?.id, src]);

  // ✅ NOW RETURNS ARE SAFE
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
  const productPath = `/product/${p.id}`;
  const productUrl = `${base.replace(/\/$/, "")}${productPath}`;
  const qrUrlModal = `${productUrl}?src=qr_modal`;
  const qrUrlPdf = `${productUrl}?src=qr_pdf`;
  const code = getDisplayCode(p);
  const img = getPrimaryImage(p) || fallbackImageSvg(code);

  const tags = filterTags(p.merchTags);

  const aboutHtml = firstNonEmpty(p.fullProductDescription, p.description, "");
  const aboutFallback = firstNonEmpty(
    stripHtml(p.fullProductDescription),
    stripHtml(p.description),
    p.shortProductDescription,
    "-"
  );

  const onDownloadPdf = async () => {
    trackEvent("download_pdf", {
      product_id: p.id,
      product_code: code,
      source: src || "web",
    });

    try {
      const qrDataUrl = qrRef.current?.toDataURL?.("image/png") || "";
      await downloadProductPdf(p, { productUrl, qrDataUrl });
      trackEvent("download_pdf_success", {
        product_id: p.id,
        product_code: code,
      });
    } catch (e) {
      trackEvent("download_pdf_error", {
        product_id: p.id,
        product_code: code,
        error_message: String(e?.message || e || "error").slice(0, 120),
      });
      throw e;
    }
  };

  return (
    <div className="app">
      <Header />

      {/* offscreen QR for PDF */}
      <div style={{ position: "fixed", left: "-99999px", top: "-99999px" }}>
        <QRCodeCanvas ref={qrRef} value={qrUrlPdf} size={520} includeMargin={false} />
      </div>

      <div className="detailsTop">
        <button className="backBtn" onClick={() => nav("/")}>
          ← Back to Catalogue
        </button>

        <div className="topActions">
          <button
            className="qrBtn"
            onClick={() => {
              trackEvent("open_qr_modal", {
                product_id: p.id,
                product_code: code,
              });
              setQrOpen(true);
            }}
          >
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
                  {suitabilityUnique.slice(0, 30).map((r, idx) => (
                    <div key={idx} className="suitRow">
                      <div className="suitA">{r.seg}</div>
                      <div className="suitB">{r.uses}</div>
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
                    const halfFilled = ratingValue >= star - 0.5 && ratingValue < star;
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

            <div className="qrBig" style={{ marginTop: 18 }}>
              <QRCodeCanvas value={qrUrlModal} size={260} includeMargin />
            </div>

            <a
              className="qrOpenLink"
              href={productUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => {
                trackEvent("open_product_link", {
                  product_id: p.id,
                  product_code: code,
                  from: "qr_modal",
                });
              }}
            >
              Open link
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ ROUTES ------------------------------ */

function AnalyticsListener() {
  const location = useLocation();
  const lastPath = useRef("");

  useEffect(() => {
    const path = `${location.pathname}${location.search}${location.hash || ""}`;
    if (lastPath.current === path) return;
    lastPath.current = path;
    trackPageView(path);
  }, [location.pathname, location.search, location.hash]);

  return null;
}

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
    <>
      <AnalyticsListener />
      <Routes>
        <Route
          path="/"
          element={<CataloguePage products={products} loading={loading} error={error} reload={reload} />}
        />
        <Route path="/product/:id" element={<ProductDetailsPage products={products} loading={loading} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
