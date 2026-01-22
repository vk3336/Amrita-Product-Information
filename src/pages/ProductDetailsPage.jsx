// src/pages/ProductDetailsPage.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";

import Header from "../components/Header";
import { downloadProductPdf } from "../productPdf";
import { trackEvent } from "../ga";
import { FRONTEND_URL } from "../config";

import {
  firstNonEmpty,
  fmtNum,
  isNum,
  safeJoin,
  stripHtml,
  fallbackImageSvg,
  getPrimaryImage,
  getDisplayCode,
  getComposition,
  getFinish,
  getStructure,
  getWidthText,
  safeHtml,
  filterTags,
  uniqueSuitabilityForUI,
  getFaqList,
} from "../lib/productUtils";

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

export default function ProductDetailsPage({ theme, onToggleTheme, products, loading }) {
  const { id } = useParams();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const src = String(searchParams.get("src") || "").trim().toLowerCase();

  // ✅ hooks before returns
  const p = useMemo(() => products.find((x) => x.id === id), [products, id]);
  const [qrOpen, setQrOpen] = useState(false);
  const qrRef = useRef(null);

  const suitabilityUnique = useMemo(() => (p ? uniqueSuitabilityForUI(p, 50) : []), [p]);
  const faq = useMemo(() => (p ? getFaqList(p) : []), [p]);

  useEffect(() => {
    setQrOpen(false);
  }, [id]);

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
      <Header theme={theme} onToggleTheme={onToggleTheme} />

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
              trackEvent("open_qr_modal", { product_id: p.id, product_code: code });
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

              {firstNonEmpty(p.productTagline, "") && <div className="detailsTagline">{p.productTagline}</div>}
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
                      <span key={star} className={`star ${filled ? "filled" : halfFilled ? "half" : "empty"}`}>
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
