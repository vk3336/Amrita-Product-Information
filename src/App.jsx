// src/App.jsx
import React, { useMemo, useState } from "react";
import {
  Routes,
  Route,
  Link,
  useParams,
  Navigate,
  useNavigate,
} from "react-router-dom";
import "./App.css";
import jsPDF from "jspdf";

/* ------------------ STATIC DATA (later replace by API) ------------------ */
const PRODUCTS = [
  {
    id: "AGE-CT-001",
    name: "100% Cotton Twill",
    category: "Cotton",
    weave: "Twill",
    finish: "Dyed",
    composition: "100% Cotton",
    gsm: 125,
    widthInch: "56-57",
    colors: 72,
    leadTimeDays: 10,
    moqMeters: 300,
    tags: ["Best Seller", "Ready Stock"],
    usage: ["Uniform", "Workwear", "Menswear"],
    image:
      "https://images.unsplash.com/photo-1520975958225-ff9f7ee4f983?q=80&w=1200&auto=format&fit=crop",
    short:
      "Premium dyed cotton twill with consistent shade. Ideal for uniforms and durable garments.",
    long:
      "Our cotton twill is dyed in excellent color depth with consistent shade matching. Suitable for daily-wear garments, uniforms, and workwear. Available in wide shade range and flexible packing.",
    packing: "Bale / Roll (as available)",
    applications: ["Pants", "Uniforms", "Jackets", "Workwear"],
  },
  {
    id: "AGE-DN-011",
    name: "Indigo Denim 5.5 oz",
    category: "Denim",
    weave: "Denim",
    finish: "Rinse",
    composition: "100% Cotton",
    gsm: 187,
    widthInch: "58-59",
    colors: 8,
    leadTimeDays: 15,
    moqMeters: 500,
    tags: ["Trending", "Premium"],
    usage: ["Menswear", "Womenswear"],
    image:
      "https://images.unsplash.com/photo-1541099649105-f69ad21f3246?q=80&w=1200&auto=format&fit=crop",
    short:
      "Lightweight indigo denim for shirts & summer denim wear. Smooth hand-feel.",
    long:
      "A breathable 5.5 oz indigo denim designed for comfort and movement. Ideal for casual shirts, light jackets, and premium summer denim programs.",
    packing: "Roll",
    applications: ["Shirts", "Light Jackets", "Summer Denim"],
  },
  {
    id: "AGE-PC-007",
    name: "Poly Cotton Poplin",
    category: "Blend",
    weave: "Poplin",
    finish: "Soft Finish",
    composition: "65% Polyester / 35% Cotton",
    gsm: 110,
    widthInch: "57-58",
    colors: 36,
    leadTimeDays: 12,
    moqMeters: 400,
    tags: ["Value", "Easy Care"],
    usage: ["Shirting", "Uniform"],
    image:
      "https://images.unsplash.com/photo-1527576539890-dfa815648363?q=80&w=1200&auto=format&fit=crop",
    short:
      "Easy-care poplin for uniforms & daily shirting. Crisp look, low maintenance.",
    long:
      "Balanced poly-cotton poplin with a crisp appearance and soft finish. Excellent for uniforms and bulk programs that need easy wash-care and durability.",
    packing: "Roll",
    applications: ["Uniform Shirts", "Corporate Wear", "School Uniforms"],
  },
];

/* ------------------------------ helpers ------------------------------ */
function textIncludes(haystack, needle) {
  return String(haystack || "")
    .toLowerCase()
    .includes(String(needle || "").toLowerCase());
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

/* -------- PDF generator for single product (simple + clean) -------- */
/* -------- image helper: url -> dataURL (works for PDF) -------- */
async function toDataUrl(url) {
  const res = await fetch(url, { mode: "cors" }); // if CORS blocks, this will fail
  if (!res.ok) throw new Error("Image fetch failed");
  const blob = await res.blob();

  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

/* -------- PDF generator for single product (same design + image) -------- */
async function downloadProductPdf(p) {
  const doc = new jsPDF({
    orientation: "p",
    unit: "mm",
    format: "a4",
  });

  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;

  const title = `${p.name}`;
  const codeLine = `Code: ${p.id}`;
  const metaLine = `${p.category} • ${p.weave} • ${p.finish}`;
  const company = "Amrita Global Enterprises";

  // ---------------- Header ----------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(company, margin, 16);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("Internal Product Catalogue", margin, 22);

  doc.setDrawColor(200);
  doc.line(margin, 26, pageW - margin, 26);

  // ---------------- Title (left) + Image (right) ----------------
  const topY = 34;

  // Image box (right side)
  const imgW = 58;
  const imgH = 38;
  const imgX = pageW - margin - imgW;
  const imgY = topY;

  // Draw subtle rounded image container (like your design)
  doc.setDrawColor(220);
  doc.roundedRect(imgX, imgY, imgW, imgH, 3, 3);

  // Add image inside container with padding
  const pad = 2;
  const drawImgX = imgX + pad;
  const drawImgY = imgY + pad;
  const drawImgW = imgW - pad * 2;
  const drawImgH = imgH - pad * 2;

  // Left text area width (avoid colliding with image)
  const textMaxW = pageW - margin - (imgW + 10) - margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(title, margin, topY + 8, { maxWidth: textMaxW });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(codeLine, margin, topY + 16);
  doc.text(metaLine, margin, topY + 22);

  // Try to load real image; fallback to SVG
  let imgDataUrl = null;
  try {
    imgDataUrl = await toDataUrl(p.image);
  } catch (e) {
    // fallback SVG always works
    imgDataUrl = fallbackImageSvg(p.id);
  }

  // Decide format for addImage
  const isPng = typeof imgDataUrl === "string" && imgDataUrl.startsWith("data:image/png");
  const isJpeg = typeof imgDataUrl === "string" && imgDataUrl.startsWith("data:image/jpeg");
  const isSvg = typeof imgDataUrl === "string" && imgDataUrl.startsWith("data:image/svg+xml");

  // jsPDF supports PNG/JPEG reliably. SVG data-url may work depending on jsPDF build;
  // if SVG doesn't render for you, we can swap fallback to a PNG generator.
  const format = isPng ? "PNG" : "JPEG";

  try {
    if (isJpeg || isPng) {
      doc.addImage(imgDataUrl, format, drawImgX, drawImgY, drawImgW, drawImgH);
    } else {
      // last resort: still try
      doc.addImage(imgDataUrl, format, drawImgX, drawImgY, drawImgW, drawImgH);
    }
  } catch {
    // If addImage fails on SVG, just leave blank (box still looks clean)
  }

  // ---------------- Specs box ----------------
  const boxTop = 78; // pushed down because image is added
  doc.setDrawColor(180);
  doc.roundedRect(margin, boxTop, pageW - margin * 2, 34, 3, 3);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Key Specs", margin + 4, boxTop + 8);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);

  const leftX = margin + 4;
  const midX = margin + (pageW - margin * 2) / 2;

  doc.text(`Composition: ${p.composition}`, leftX, boxTop + 16);
  doc.text(`GSM: ${p.gsm}`, leftX, boxTop + 24);
  doc.text(`Width: ${p.widthInch}"`, leftX, boxTop + 32);

  doc.text(`Colors: ${p.colors}`, midX, boxTop + 16);
  doc.text(`MOQ: ${p.moqMeters} m`, midX, boxTop + 24);
  doc.text(`Lead Time: ${p.leadTimeDays} days`, midX, boxTop + 32);

  // ---------------- Suitable for ----------------
  const suitable = (p.usage || []).join(", ") || "-";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Suitable For", margin, boxTop + 54);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const suitableLines = doc.splitTextToSize(suitable, pageW - margin * 2);
  doc.text(suitableLines, margin, boxTop + 61);

  // ---------------- Applications ----------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Applications", margin, boxTop + 80);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const apps = (p.applications || []).map((x) => `• ${x}`).join("\n") || "• -";
  const appsLines = doc.splitTextToSize(apps, pageW - margin * 2);
  doc.text(appsLines, margin, boxTop + 87);

  // ---------------- About ----------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("About this product", margin, boxTop + 117);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const aboutLines = doc.splitTextToSize(p.long || "-", pageW - margin * 2);
  doc.text(aboutLines, margin, boxTop + 124);

  // ---------------- Footer ----------------
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(
    `Generated from AGE Internal Catalogue • ${new Date().toLocaleString()}`,
    margin,
    290
  );

  doc.save(`${p.id}.pdf`);
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

      <div className="headerRight">
        
      </div>
    </div>
  );
}

/* ------------------------------ PAGE 1 ------------------------------ */
function CataloguePage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [usage, setUsage] = useState("All");
  const [sort, setSort] = useState("popular");

  const categories = useMemo(() => {
    const set = new Set(PRODUCTS.map((p) => p.category));
    return ["All", ...Array.from(set)];
  }, []);

  const usages = useMemo(() => {
    const set = new Set(PRODUCTS.flatMap((p) => p.usage || []));
    return ["All", ...Array.from(set)];
  }, []);

  const filtered = useMemo(() => {
    let list = [...PRODUCTS];

    if (category !== "All") list = list.filter((p) => p.category === category);
    if (usage !== "All")
      list = list.filter((p) => (p.usage || []).includes(usage));

    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((p) => {
        const blob = [
          p.id,
          p.name,
          p.category,
          p.weave,
          p.finish,
          p.composition,
          ...(p.tags || []),
          ...(p.usage || []),
        ].join(" ");
        return textIncludes(blob, q);
      });
    }

    if (sort === "name_asc") list.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "gsm_desc")
      list.sort((a, b) => (b.gsm || 0) - (a.gsm || 0));
    if (sort === "lead_asc")
      list.sort((a, b) => (a.leadTimeDays || 999) - (b.leadTimeDays || 999));

    return list;
  }, [query, category, usage, sort]);

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
            placeholder="Search by name, code, category, weave, tags..."
          />
          {query ? (
            <button className="clearBtn" onClick={() => setQuery("")}>
              Clear
            </button>
          ) : null}
        </div>

        
      </div>

      <div className="summary">
        <div className="count">
          Showing <b>{filtered.length}</b> of <b>{PRODUCTS.length}</b> products
        </div>
        <div className="note">
          Tip: try “AGE-”, “Denim”, “Twill”, “Best Seller”
        </div>
      </div>

      <div className="grid">
        {filtered.map((p) => (
          <Link key={p.id} to={`/product/${p.id}`} className="card">
            <div className="cardMedia">
              <img
                src={p.image}
                alt={p.name}
                loading="lazy"
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.src = fallbackImageSvg(p.id);
                }}
              />
              <div className="codeBadge">{p.id}</div>
            </div>

            <div className="cardBody">
              <div className="cardTop">
                <div className="title">{p.name}</div>
                <div className="meta">
                  {p.category} • {p.weave}
                </div>
              </div>

              <div className="desc">{p.short}</div>

              <div className="specs">
                <div className="spec">
                  <div className="k">GSM</div>
                  <div className="v">{p.gsm}</div>
                </div>
                <div className="spec">
                  <div className="k">Width</div>
                  <div className="v">{p.widthInch}"</div>
                </div>
                <div className="spec">
                  <div className="k">Colors</div>
                  <div className="v">{p.colors}</div>
                </div>
                <div className="spec">
                  <div className="k">Lead</div>
                  <div className="v">{p.leadTimeDays}d</div>
                </div>
              </div>

              <div className="chips">
                {(p.tags || []).slice(0, 2).map((t) => (
                  <span key={t} className="chip" title={t}>
                    {t}
                  </span>
                ))}
              </div>

              <div className="ctaRow">
                <span className="cta">View details →</span>
                <span className="hint">Catalogue</span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="footer">
        © {new Date().getFullYear()} Amrita Global Enterprises • Internal catalogue
      </div>
    </div>
  );
}

/* ------------------------------ PAGE 2 ------------------------------ */
function ProductDetailsPage() {
  const { id } = useParams();
  const nav = useNavigate();

  const p = useMemo(() => PRODUCTS.find((x) => x.id === id), [id]);

  if (!p) {
    return (
      <div className="app">
        <div className="detailsTop">
          <button className="backBtn" onClick={() => nav("/")}>
            ← Back
          </button>
        </div>
        <div className="emptyState">
          <div className="emptyTitle">Product not found</div>
          <div className="emptyText">
            This product code doesn’t exist in static data.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="detailsTop">
        <button className="backBtn" onClick={() => nav("/")}>
          ← Back to Catalogue
        </button>

        {/* ✅ PDF Button */}
        <button className="pdfBtn" onClick={() => downloadProductPdf(p)}>
          Download PDF
        </button>
      </div>

      <div className="details">
        <div className="detailsMedia">
          <img
            src={p.image}
            alt={p.name}
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = fallbackImageSvg(p.id);
            }}
          />
        </div>

        <div className="detailsInfo">
          <div className="detailsHeader">
            <div>
              <div className="detailsCode">{p.id}</div>
              <div className="detailsName">{p.name}</div>
              <div className="detailsMeta">
                {p.category} • {p.weave} • {p.finish}
              </div>
            </div>

            <div className="chips right">
              {(p.tags || []).map((t) => (
                <span key={t} className="chip" title={t}>
                  {t}
                </span>
              ))}
            </div>
          </div>

          <div className="detailGrid">
            <div className="kv">
              <div className="k">Composition</div>
              <div className="v">{p.composition}</div>
            </div>
            <div className="kv">
              <div className="k">GSM</div>
              <div className="v">{p.gsm}</div>
            </div>
            <div className="kv">
              <div className="k">Width</div>
              <div className="v">{p.widthInch}"</div>
            </div>
            <div className="kv">
              <div className="k">Colors</div>
              <div className="v">{p.colors}</div>
            </div>
            <div className="kv">
              <div className="k">MOQ</div>
              <div className="v">{p.moqMeters} m</div>
            </div>
            <div className="kv">
              <div className="k">Lead Time</div>
              <div className="v">{p.leadTimeDays} days</div>
            </div>
            <div className="kv">
              <div className="k">Packing</div>
              <div className="v">{p.packing}</div>
            </div>
            <div className="kv">
              <div className="k">Suitable For</div>
              <div className="v">{(p.usage || []).join(", ") || "-"}</div>
            </div>
          </div>

          <div className="section">
            <div className="sectionTitle">About this product</div>
            <div className="sectionText">{p.long}</div>
          </div>

          <div className="twoCols">
            <div className="section">
              <div className="sectionTitle">Applications</div>
              <ul className="list">
                {(p.applications || []).map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>

            <div className="section">
              <div className="sectionTitle">Suitable for</div>
              <div className="chips">
                {(p.usage || []).map((u) => (
                  <span key={u} className="chip soft">
                    {u}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="callout">
            For pricing, stock, or sampling: contact sales/admin team (this app is catalogue-only).
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ ROUTES ------------------------------ */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<CataloguePage />} />
      <Route path="/product/:id" element={<ProductDetailsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
