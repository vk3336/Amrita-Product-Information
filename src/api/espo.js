// src/api/espo.js
import { ESPO_ENTITY_URL, ESPO_API_KEY } from "../config";

export async function espoFetchJson(url) {
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

export async function fetchAllProducts() {
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
