// SmartDrugstore — static stock & report viewer.
// Reads data/products.json (+ data/meta.json) and renders everything client-side.
// No build step, no dependencies. Works on GitHub Pages and offline.

const THB = new Intl.NumberFormat("en-US", { style: "currency", currency: "THB" });
const INT = new Intl.NumberFormat("en-US");
const DAY = 86400000;

let PRODUCTS = [];
let sortKey = "name";
let sortDir = 1;

const $ = (sel) => document.querySelector(sel);

init();

async function init() {
  try {
    const [products, meta] = await Promise.all([
      fetch("data/products.json").then((r) => r.json()),
      fetch("data/meta.json").then((r) => r.json()).catch(() => null),
    ]);
    PRODUCTS = products.map(normalize);
    renderMeta(meta);
    buildCategoryFilter();
    wireUp();
    renderStock();
    renderReport();
  } catch (e) {
    $("#meta").textContent = "Failed to load data/products.json";
    console.error(e);
  }
}

// Tolerate missing fields so the page survives schema drift in the export.
function normalize(p) {
  return {
    id: p.id ?? "",
    name: p.name ?? "",
    name_th: p.name_th ?? "",
    category: p.category ?? "—",
    unit: p.unit ?? "",
    price: num(p.price),
    cost: num(p.cost),
    on_hand: num(p.on_hand),
    reorder_point: num(p.reorder_point),
    active: p.active !== false,
    expiry: p.expiry || null,
  };
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function renderMeta(meta) {
  if (!meta) { $("#meta").textContent = `${PRODUCTS.length} products`; return; }
  const when = meta.generated_at ? new Date(meta.generated_at).toLocaleString() : "unknown";
  $("#meta").textContent = `${INT.format(meta.row_count ?? PRODUCTS.length)} products · updated ${when}`;
}

function isLow(p) { return p.active && p.reorder_point > 0 && p.on_hand < p.reorder_point; }
function daysToExpiry(p) {
  if (!p.expiry) return null;
  return Math.round((new Date(p.expiry) - Date.now()) / DAY);
}

/* ---------- tabs ---------- */
function wireUp() {
  document.querySelectorAll('[role="tab"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll('[role="tab"]').forEach((b) =>
        b.setAttribute("aria-selected", b === btn));
      $("#tab-stock").classList.toggle("hidden", btn.dataset.tab !== "stock");
      $("#tab-reports").classList.toggle("hidden", btn.dataset.tab !== "reports");
    });
  });

  $("#search").addEventListener("input", renderStock);
  $("#category").addEventListener("change", renderStock);
  $("#lowOnly").addEventListener("change", renderStock);
  $("#inactive").addEventListener("change", renderStock);
  $("#report").addEventListener("change", renderReport);

  document.querySelectorAll("#stockTable th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      sortDir = key === sortKey ? -sortDir : 1;
      sortKey = key;
      document.querySelectorAll("#stockTable th").forEach((h) => h.classList.remove("asc", "desc"));
      th.classList.add(sortDir === 1 ? "asc" : "desc");
      renderStock();
    });
  });
}

function buildCategoryFilter() {
  const cats = [...new Set(PRODUCTS.map((p) => p.category))].sort();
  const sel = $("#category");
  for (const c of cats) {
    const opt = document.createElement("option");
    opt.value = opt.textContent = c;
    sel.appendChild(opt);
  }
}

/* ---------- stock view ---------- */
function renderStock() {
  const q = $("#search").value.trim().toLowerCase();
  const cat = $("#category").value;
  const lowOnly = $("#lowOnly").checked;
  const showInactive = $("#inactive").checked;

  let rows = PRODUCTS.filter((p) => {
    if (!showInactive && !p.active) return false;
    if (cat && p.category !== cat) return false;
    if (lowOnly && !isLow(p)) return false;
    if (q && !(`${p.id} ${p.name} ${p.name_th}`.toLowerCase().includes(q))) return false;
    return true;
  });

  rows.sort((a, b) => {
    const x = a[sortKey], y = b[sortKey];
    const cmp = typeof x === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
    return cmp * sortDir;
  });

  const active = PRODUCTS.filter((p) => p.active);
  renderCards("#stockCards", [
    ["Active products", INT.format(active.length)],
    ["Low stock", INT.format(active.filter(isLow).length)],
    ["Stock value (cost)", THB.format(active.reduce((s, p) => s + p.on_hand * p.cost, 0))],
  ]);

  const tbody = $("#stockTable tbody");
  tbody.innerHTML = "";
  for (const p of rows) tbody.appendChild(stockRow(p));
  $("#stockEmpty").classList.toggle("hidden", rows.length > 0);
}

function stockRow(p) {
  const tr = document.createElement("tr");
  const nm = p.name_th ? `${esc(p.name)}<br><span class="meta" style="color:var(--muted)">${esc(p.name_th)}</span>` : esc(p.name);
  tr.innerHTML = `
    <td>${esc(p.id)}</td>
    <td>${nm}</td>
    <td>${esc(p.category)}</td>
    <td class="num">${INT.format(p.on_hand)}</td>
    <td class="num">${p.reorder_point ? INT.format(p.reorder_point) : "—"}</td>
    <td class="num">${THB.format(p.price)}</td>
    <td>${statusBadge(p)}</td>`;
  return tr;
}

function statusBadge(p) {
  if (!p.active) return '<span class="badge off">inactive</span>';
  if (isLow(p)) return '<span class="badge low">low</span>';
  const d = daysToExpiry(p);
  if (d !== null && d <= 90) return `<span class="badge warn">exp ${d}d</span>`;
  return '<span class="badge ok">ok</span>';
}

/* ---------- reports ---------- */
function renderReport() {
  const kind = $("#report").value;
  const active = PRODUCTS.filter((p) => p.active);
  let cols, rows, cards = [];

  if (kind === "low") {
    cols = ["Code", "Name", "Category", "On hand", "Reorder", "Short by"];
    const low = active.filter(isLow);
    rows = low.map((p) => [p.id, p.name, p.category, INT.format(p.on_hand), INT.format(p.reorder_point), INT.format(p.reorder_point - p.on_hand)]);
    cards = [["Items below reorder", INT.format(low.length)]];
  } else if (kind === "valuation") {
    cols = ["Category", "Items", "Units on hand", "Value (cost)", "Value (retail)"];
    const g = groupBy(active, "category", (items) => ({
      items: items.length,
      units: items.reduce((s, p) => s + p.on_hand, 0),
      cost: items.reduce((s, p) => s + p.on_hand * p.cost, 0),
      retail: items.reduce((s, p) => s + p.on_hand * p.price, 0),
    }));
    rows = g.map(([c, v]) => [c, INT.format(v.items), INT.format(v.units), THB.format(v.cost), THB.format(v.retail)]);
    cards = [
      ["Total cost value", THB.format(active.reduce((s, p) => s + p.on_hand * p.cost, 0))],
      ["Total retail value", THB.format(active.reduce((s, p) => s + p.on_hand * p.price, 0))],
    ];
  } else if (kind === "count") {
    cols = ["Category", "Products"];
    rows = groupBy(active, "category", (items) => items.length).map(([c, n]) => [c, INT.format(n)]);
  } else if (kind === "expiry") {
    cols = ["Code", "Name", "Category", "Expiry", "Days left", "On hand"];
    const soon = active
      .map((p) => ({ p, d: daysToExpiry(p) }))
      .filter((x) => x.d !== null && x.d <= 90)
      .sort((a, b) => a.d - b.d);
    rows = soon.map(({ p, d }) => [p.id, p.name, p.category, p.expiry, INT.format(d), INT.format(p.on_hand)]);
    cards = [["Expiring ≤ 90 days", INT.format(soon.length)]];
  } else {
    cols = ["Code", "Name", "Category", "On hand"];
    const off = PRODUCTS.filter((p) => !p.active);
    rows = off.map((p) => [p.id, p.name, p.category, INT.format(p.on_hand)]);
    cards = [["Inactive products", INT.format(off.length)]];
  }

  renderCards("#reportCards", cards);
  const numericCols = new Set(cols.map((c, i) => /on hand|reorder|short|units|value|days|products|items/i.test(c) ? i : -1));
  $("#reportTable thead tr").innerHTML = cols.map((c, i) =>
    `<th class="${numericCols.has(i) ? "num" : ""}">${esc(c)}</th>`).join("");
  $("#reportTable tbody").innerHTML = rows.map((r) =>
    "<tr>" + r.map((v, i) => `<td class="${numericCols.has(i) ? "num" : ""}">${esc(v)}</td>`).join("") + "</tr>").join("");
  $("#reportEmpty").classList.toggle("hidden", rows.length > 0);
}

function groupBy(items, key, reduce) {
  const m = new Map();
  for (const it of items) (m.get(it[key]) ?? m.set(it[key], []).get(it[key])).push(it);
  return [...m.entries()].map(([k, v]) => [k, reduce(v)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

/* ---------- helpers ---------- */
function renderCards(sel, pairs) {
  $(sel).innerHTML = pairs.map(([k, v]) =>
    `<div class="card"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join("");
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
