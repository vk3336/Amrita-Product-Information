// src/pages/CataloguePage.jsx
import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import Header from "../components/Header";
import { trackEvent } from "../ga";

import {
  textIncludes,
  safeJoin,
  firstNonEmpty,
  isNum,
  fmtNum,
  fallbackImageSvg,
  getPrimaryImage,
  getDisplayCode,
  getStructure,
  getShortDesc,
  filterTags,
} from "../lib/productUtils";

export default function CataloguePage({ theme, onToggleTheme, products, loading, error, reload }) {
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
              const code = getDisplayCode(p);
              const img = getPrimaryImage(p) || fallbackImageSvg(code);
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

      <div className="footer">© {new Date().getFullYear()} Amrita Global Enterprises • Internal catalogue</div>
    </div>
  );
}
