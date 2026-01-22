// src/App.jsx
import React, { useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import "./App.css";

import Header from "./components/Header";
import CataloguePage from "./pages/CataloguePage";
import ProductDetailsPage from "./pages/ProductDetailsPage";
import { trackPageView } from "./ga";

import { ESPO_ENTITY_URL, ESPO_API_KEY, THEME_KEY } from "./config";
import { useProducts } from "./hooks/useProducts";

/* ------------------------------ THEME ------------------------------ */
function getInitialTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  const prefersLight =
    window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  return prefersLight ? "light" : "dark";
}

/* ------------------------------ ROUTE ANALYTICS ------------------------------ */
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

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  const envOk = ESPO_ENTITY_URL && ESPO_API_KEY;

  if (!envOk) {
    return (
      <div className="app">
        <Header theme={theme} onToggleTheme={toggleTheme} />
        <div className="errorBox">
          <div className="errorTitle">Environment missing</div>
          <div className="errorText">
            Please set <b>VITE_ESPO_BASEURL</b> and <b>VITE_X_API_KEY</b> in <code>.env</code>,
            then restart the dev server.
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
          element={
            <CataloguePage
              theme={theme}
              onToggleTheme={toggleTheme}
              products={products}
              loading={loading}
              error={error}
              reload={reload}
            />
          }
        />
        <Route
          path="/product/:id"
          element={
            <ProductDetailsPage
              theme={theme}
              onToggleTheme={toggleTheme}
              products={products}
              loading={loading}
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
