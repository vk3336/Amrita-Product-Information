// src/components/Header.jsx
import React from "react";

export default function Header({ theme, onToggleTheme }) {
  return (
    <div className="header">
      <div className="brand">
        <div className="brandMark">AGE</div>
        <div>
          <div className="brandName">Amrita Global Enterprises</div>
        </div>
      </div>

      <div className="headerRight">
        <button className="themeBtn" onClick={onToggleTheme} type="button">
          <span className="themeIcon">{theme === "dark" ? "🌙" : "☀️"}</span>
          <span className="themeText">{theme === "dark" ? "Dark" : "Light"}</span>
        </button>
      </div>
    </div>
  );
}
