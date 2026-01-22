// src/config.js
export const FRONTEND_URL = String(import.meta.env.VITE_FRONTEND_URL || "").replace(/\/$/, "");
export const ESPO_ENTITY_URL = String(import.meta.env.VITE_ESPO_BASEURL || "").replace(/\/$/, "");
export const ESPO_API_KEY = String(import.meta.env.VITE_X_API_KEY || "");
export const THEME_KEY = "age_theme";
