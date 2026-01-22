// src/ga.js
// Minimal GA4 (gtag) integration for Vite + React.

let _inited = false;
let _measurementId = "";

const SCRIPT_ID = "ga-gtag";

function safeString(v) {
  return String(v ?? "").trim();
}

function getGtag() {
  return typeof window !== "undefined" ? window.gtag : undefined;
}

function ensureStubGtag() {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  // queue events before the script loads
  window.gtag = window.gtag || function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments);
  };
}

function injectScript(measurementId) {
  if (typeof document === "undefined") return;
  if (document.getElementById(SCRIPT_ID)) return;
  const s = document.createElement("script");
  s.id = SCRIPT_ID;
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(s);
}

export function initGA(measurementId) {
  const id = safeString(measurementId);
  if (!id) return false;
  if (_inited && _measurementId === id) return true;

  _inited = true;
  _measurementId = id;

  ensureStubGtag();
  injectScript(id);

  const gtag = getGtag();
  if (typeof gtag === "function") {
    gtag("js", new Date());
    // We will send page_view manually on route changes.
    gtag("config", id, {
      send_page_view: false,
      anonymize_ip: true,
    });
  }

  return true;
}

export function trackEvent(name, params = {}) {
  const evt = safeString(name);
  if (!evt) return;
  const gtag = getGtag();
  if (typeof gtag !== "function") return;
  gtag("event", evt, params);
}

export function trackPageView(path, extra = {}) {
  const p = safeString(path) || (typeof window !== "undefined" ? window.location.pathname : "");
  const gtag = getGtag();
  if (typeof gtag !== "function") return;

  const loc = typeof window !== "undefined" ? window.location : null;
  const page_location = loc ? loc.href : undefined;
  const page_path = p;
  const page_title = typeof document !== "undefined" ? document.title : undefined;

  gtag("event", "page_view", {
    page_location,
    page_path,
    page_title,
    ...extra,
  });
}
