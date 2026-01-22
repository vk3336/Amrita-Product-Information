import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./index.css";

import { initGA } from "./ga";

const GA_ID = import.meta.env.VITE_GA_MEASUREMENT_ID;

initGA(GA_ID);

console.log("GA_ID:", GA_ID);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
