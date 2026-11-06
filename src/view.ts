// MCP App view: product cards, product detail and cart, rendered inline by hosts that support
// MCP Apps (Claude Chat, claude.ai, ChatGPT, VS Code). Text-only hosts (Claude Code) ignore it and
// keep using the markdown + image blocks every tool already returns.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export const VIEW_URI = "ui://amazon/shop";
/** Image host for product photos; the view's sandbox must be allowed to load from it. */
export const VIEW_IMAGE_DOMAINS = ["https://m.media-amazon.com"];
/** Key under a tool result's _meta that carries the view payload. */
export const VIEW_META_KEY = "amazon-agent/view";

export type ViewKind = "search" | "product" | "cart" | "order" | "placed" | "confirm" | "orders" | "tracking" | "watch";

/**
 * The SDK's browser client, inlined so the view needs no CDN. The bundle ends in an ES
 * `export{a as App,…}`; rewrite that into a global so an inline module can use it.
 */
function inlineClient(): string {
  const require = createRequire(import.meta.url);
  const pkgDir = dirname(require.resolve("@modelcontextprotocol/ext-apps/package.json"));
  const src = readFileSync(join(pkgDir, "dist/src/app-with-deps.js"), "utf8");
  const m = src.match(/export\s*\{([^}]*)\};?\s*(\/\/#.*)?\s*$/);
  if (!m) throw new Error("Unexpected ext-apps bundle format (no trailing export)");
  const pairs = m[1]!
    .split(",")
    .map((p) => p.trim().split(/\s+as\s+/))
    .filter((p) => p[0])
    .map(([local, exported]) => `${JSON.stringify(exported ?? local)}:${local}`);
  return `${src.slice(0, m.index)};globalThis.McpApps={${pairs.join(",")}};`;
}

let cached: string | null = null;

export function viewHtml(): string {
  if (cached) return cached;
  cached = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Amazon</title>
<style>
  :root {
    --bg: var(--color-background-primary, #fff); --bg2: var(--color-background-secondary, #f5f5f3);
    --fg: var(--color-text-primary, #1d1d1b); --muted: var(--color-text-secondary, #6b6b66);
    --line: var(--color-border-tertiary, #e3e3de); --accent: #e47911; --ok: var(--color-text-success, #1d7a3a);
    --radius: var(--border-radius-lg, 12px); --font: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: var(--color-background-primary, #1f1f1d); --bg2: var(--color-background-secondary, #2a2a27); --fg: var(--color-text-primary, #ececea); --muted: var(--color-text-secondary, #a3a39e); --line: var(--color-border-tertiary, #3a3a36); } }
  :root[data-theme="dark"] { --bg: var(--color-background-primary, #1f1f1d); --bg2: var(--color-background-secondary, #2a2a27); --fg: var(--color-text-primary, #ececea); --muted: var(--color-text-secondary, #a3a39e); --line: var(--color-border-tertiary, #3a3a36); }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 12px; background: var(--bg); color: var(--fg); font: 14px/1.4 var(--font); }
  .bar { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; flex-wrap: wrap; }
  .bar .title { font-weight: 600; font-size: 15px; }
  .bar .meta { color: var(--muted); font-size: 13px; }
  .bar .spacer { flex: 1; }
  button, .btn { font: inherit; font-size: 13px; font-weight: 600; border-radius: 999px; padding: 7px 12px; cursor: pointer; border: 1px solid var(--line); background: var(--bg); color: var(--fg); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button:disabled { opacity: .55; cursor: default; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
  .card { border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; display: flex; flex-direction: column; background: var(--bg); }
  .card .img { height: 120px; background: #fff; display: grid; place-items: center; padding: 8px; overflow: hidden; }
  .card img { max-width: 100%; max-height: 104px; object-fit: contain; }
  .card .body { padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 3px; flex: 1; }
  .card .name { -webkit-line-clamp: 2; font-size: 12.5px; }
  .card .price { font-size: 15px; }
  .more { display: flex; justify-content: center; margin-top: 10px; }
  .name { font-size: 13px; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .price { font-size: 17px; font-weight: 700; }
  .list { color: var(--muted); text-decoration: line-through; font-size: 12px; margin-left: 6px; font-weight: 400; }
  .stars { color: var(--muted); font-size: 12px; }
  .stars b { color: #c77700; font-weight: 600; }
  .tag { align-self: flex-start; font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 1px 7px; }
  .actions { display: flex; gap: 6px; margin-top: auto; padding-top: 6px; }
  .actions button { flex: 1; padding: 6px 4px; font-size: 12px; white-space: nowrap; }
  .detail { display: grid; grid-template-columns: minmax(140px, 260px) 1fr; gap: 16px; }
  .detail .img { background: #fff; border-radius: var(--radius); border: 1px solid var(--line); display: grid; place-items: center; padding: 12px; aspect-ratio: 1; }
  .detail img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .detail h2 { font-size: 16px; margin: 0 0 6px; line-height: 1.35; }
  .detail ul { margin: 8px 0; padding-left: 18px; color: var(--muted); font-size: 13px; }
  .detail .row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
  @media (max-width: 520px) { .detail { grid-template-columns: 1fr; } .detail .img { max-width: 240px; } }
  .banner { border-radius: var(--radius); padding: 10px 12px; margin-bottom: 10px; background: var(--bg2); }
  .banner.ok { color: var(--ok); font-weight: 600; }
  .items { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
  .item { display: grid; grid-template-columns: 56px 1fr auto; gap: 10px; align-items: center; padding: 10px; border-top: 1px solid var(--line); }
  .item:first-child { border-top: 0; }
  .item .thumb { width: 56px; height: 56px; background: #fff; border-radius: 8px; display: grid; place-items: center; overflow: hidden; }
  .item .thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .item .name { -webkit-line-clamp: 2; }
  .item .sub { color: var(--muted); font-size: 12px; }
  .item.just-added { background: var(--bg2); }
  .item { grid-template-columns: auto 1fr auto; }
  .item.off .name, .item.off .sub { color: var(--muted); }
  .item.off .thumb img { opacity: .55; }
  .pick { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .pick input { width: 18px; height: 18px; accent-color: var(--accent); margin: 0; }
  .total .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .facts { border: 1px solid var(--line); border-radius: var(--radius); padding: 10px 12px; margin-top: 10px; display: grid; gap: 6px; font-size: 13px; }
  .facts > div { display: flex; justify-content: space-between; gap: 12px; }
  .facts .k { color: var(--muted); white-space: nowrap; }
  .facts .line { font-size: 12px; } .facts .grand { font-size: 15px; border-top: 1px solid var(--line); padding-top: 6px; }
  .terms { border: 1px solid var(--accent); border-radius: var(--radius); padding: 10px 12px; margin-top: 10px; font-size: 13px; }
  .terms ul { margin: 6px 0; padding-left: 18px; color: var(--muted); }
  button.big { padding: 10px 16px; font-size: 14px; }
  .col { display: flex; flex-direction: column; gap: 6px; }
  .status-chip { display: inline-block; margin-top: 4px; font-size: 11.5px; padding: 2px 8px; border-radius: 999px; background: var(--bg2); color: var(--fg); }
  .status-chip.done { color: var(--ok); }
  .steps { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
  .step { flex: 1; min-width: 90px; display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 12px; color: var(--muted); }
  .step .dot { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--line); }
  .step.done { color: var(--fg); font-weight: 600; } .step.done .dot { background: var(--accent); border-color: var(--accent); }
  .opts { display: grid; gap: 8px; margin: 8px 0; }
  .dim-name { font-size: 12px; color: var(--muted); display: block; margin-bottom: 4px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { font-size: 12px; font-weight: 500; padding: 5px 10px; border-radius: 999px; }
  .chip.on { border-color: var(--accent); color: var(--accent); font-weight: 700; }
  .code-box { border: 2px solid var(--accent); border-radius: var(--radius); padding: 12px; margin-top: 10px; text-align: center; }
  .code-label { color: var(--muted); font-size: 13px; }
  .code-box.small .code { font-size: 20px; }
  .code-box.flash { background: var(--bg2); }
  .code { font: 700 26px/1.4 var(--font-mono, ui-monospace, Menlo, monospace); letter-spacing: 2px; margin: 4px 0; user-select: all; }
  .total { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; gap: 8px; flex-wrap: wrap; }
  .total .sum { font-size: 15px; } .total .sum b { font-size: 17px; }
  .empty, .error { color: var(--muted); padding: 16px; text-align: center; }
  .error { color: var(--color-text-danger, #b42318); }
  .banner.error { color: var(--color-text-danger, #b42318); }
  .in-cart { flex: 1; align-self: center; text-align: center; color: var(--ok); font-weight: 600; font-size: 13px; }
</style>
</head>
<body>
<div id="root"><div class="empty">Loading…</div></div>
<!-- The SDK client gets its own module scope: its minified top-level names (h, CN, …) must not
     collide with the view code. Module scripts run in document order, so McpApps exists below. -->
<script type="module">${inlineClient()}</script>
<script type="module">
const { App, applyDocumentTheme, applyHostStyleVariables } = globalThis.McpApps;
const VIEW_KEY = ${JSON.stringify(VIEW_META_KEY)};
const app = new App({ name: "Amazon view", version: "0.4.0" }, {}, { autoResize: true });
const root = document.getElementById("root");
let lastSearch = null;   // { args, data } — for "Back to results" and paging
let lastInput = {};

// ── tiny DOM helper (textContent only: product titles are untrusted text) ──
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}
const short = (t, n) => t.length <= n ? t : t.slice(0, t.lastIndexOf(" ", n - 1) > n * 0.6 ? t.lastIndexOf(" ", n - 1) : n - 1).replace(/[,;:\\s-]+$/, "") + "…";
const money = (n) => n == null ? null : "$" + Number(n).toFixed(2);
const sized = (url, side) => url ? url.replace(/(\\/images\\/I\\/[^./]+)(?:\\.[^/]*)?\\.(jpe?g|png|webp)$/i, "$1._AC_SL" + side + "_.$2") : null;
function stars(rating, reviews) {
  if (rating == null) return null;
  return h("div", { class: "stars" }, h("b", {}, "★ " + Number(rating).toFixed(1)), reviews != null ? " (" + Number(reviews).toLocaleString("en-US") + ")" : "");
}
function notice(text) {
  root.querySelector(".banner.error")?.remove();
  const b = h("div", { class: "banner error" }, text);
  root.prepend(b);
  b.scrollIntoView({ block: "nearest" });
}
const open = (url) => app.openLink({ url }).catch(() => {});

// ── payload: our _meta first, else the "data: {...}" text block every result ends with ──
function payload(result) {
  const meta = result?._meta?.[VIEW_KEY];
  if (meta) return meta;
  const block = (result?.content || []).find((b) => b.type === "text" && b.text.startsWith("data: "));
  if (!block) return null;
  try {
    const data = JSON.parse(block.text.slice(6));
    const kind = Array.isArray(data.results) ? "search" : Array.isArray(data.items) ? "cart" : data.asin ? "product" : null;
    return kind ? { kind, data } : null;
  } catch { return null; }
}
function errorText(result) { return (result?.content || []).find((b) => b.type === "text")?.text || "Something went wrong."; }

// Some hosts render the view but don't let it call tools itself (e.g. the Claude Code tab:
// "IPC not available for MCP tool call"). Then the button asks Claude in the chat instead,
// and Claude runs the same tool. Returns null when it went through the chat.
async function call(name, args, chatText) {
  let result;
  try {
    result = await app.callServerTool({ name, arguments: args });
  } catch (e) {
    if (!chatText) throw e;
    const sent = await app.sendMessage({ role: "user", content: [{ type: "text", text: chatText }] }).catch(() => ({ isError: true }));
    if (sent?.isError) throw e;
    return null;
  }
  if (result.isError) throw new Error(errorText(result));
  return result;
}
const viaChatNote = "Asked Claude in the chat ↓";
function busy(btn, label) { const old = btn.textContent; btn.disabled = true; btn.textContent = label; return () => { btn.disabled = false; btn.textContent = old; }; }

// Confirmation goes right where the user clicked: hosts grow the view to full height, so
// anything pinned to its top or bottom can be out of sight in a long grid.
async function addToCart(asin, title, btn) {
  const done = busy(btn, "Adding…");
  try {
    const result = await call("amazon_cart_add", { asin }, "Add this to my Amazon cart: " + title + " (ASIN " + asin + ")");
    if (!result) { btn.parentElement.replaceChildren(h("span", { class: "in-cart" }, viaChatNote)); return; }
    btn.parentElement.replaceChildren(
      h("span", { class: "in-cart" }, "✓ In cart"),
      h("button", { onclick: () => { draw(result); scrollTo(0, 0); } }, "View cart"));
    app.updateModelContext?.({ content: [{ type: "text", text: "The user added " + asin + " (" + title + ") to their Amazon cart from the product view." }] }).catch(() => {});
  } catch (e) { done(); btn.title = e.message; notice("⚠️ Couldn't add to cart: " + e.message); }
}

// ── views ──
function renderSearch(d) {
  const results = d.results || [];
  const head = h("div", { class: "bar" },
    h("span", { class: "title" }, "“" + d.query + "”"),
    h("span", { class: "meta" }, (d.total != null ? "about " + d.total.toLocaleString("en-US") + " results" : results.length + " results") + " · page " + d.page),
    h("span", { class: "spacer" }),
    d.page > 1 ? h("button", { onclick: (e) => page(d.page - 1, e.currentTarget) }, "← Prev") : null,
    d.hasNext ? h("button", { onclick: (e) => page(d.page + 1, e.currentTarget) }, "Next →") : null);
  if (!results.length) return [head, h("div", { class: "empty" }, "No results.")];
  const grid = h("div", { class: "grid" }, results.map((r) => h("div", { class: "card" },
    h("div", { class: "img" }, r.image ? h("img", { src: sized(r.image, 320), alt: "", loading: "lazy" }) : null),
    h("div", { class: "body" },
      r.sponsored ? h("span", { class: "tag" }, "Sponsored") : null,
      h("div", { class: "name", title: r.title }, r.title),
      h("div", { class: "price" }, r.priceText || "—", r.listPrice && r.listPrice !== r.priceText ? h("span", { class: "list" }, r.listPrice) : null),
      stars(r.rating, r.reviews),
      h("div", { class: "actions" },
        h("button", { onclick: (e) => details(r.asin, e.currentTarget) }, "Details"),
        h("button", { class: "primary", onclick: (e) => addToCart(r.asin, r.title, e.currentTarget) }, "+ Cart"))))));
  const more = d.moreOnPage ? h("div", { class: "more" }, h("button", { onclick: (e) => showMore(d, e.currentTarget) }, "Show more")) : null;
  return [head, grid, more];
}

async function showMore(d, btn) {
  const done = busy(btn, "Loading…");
  const offset = (d.offset || 0) + (d.limit || d.results.length);
  try {
    const r = await call("amazon_search", { ...(lastSearch?.args || {}), query: d.query, page: d.page, offset, limit: d.limit || 8, images: 0 }, "Show more Amazon results for \u201c" + d.query + "\u201d");
    if (!r) { done(); notice(viaChatNote); return; }
    const p = payload(r);
    if (!p || p.kind !== "search") { done(); return; }
    const merged = { ...p.data, results: [...d.results, ...p.data.results], offset: d.offset || 0, limit: (d.limit || 8) + p.data.results.length };
    lastSearch = { args: lastSearch?.args || {}, data: merged };
    render("search", merged);
  } catch (e) { done(); notice("⚠️ " + e.message); }
}

function renderProduct(p) {
  const img = (p.images || [])[0];
  return [
    lastSearch ? h("div", { class: "bar" }, h("button", { onclick: () => render("search", lastSearch.data) }, "← Back to results")) : null,
    h("div", { class: "detail" },
      h("div", { class: "img" }, img ? h("img", { src: sized(img, 500), alt: "" }) : null),
      h("div", {},
        h("h2", {}, p.title),
        p.brand ? h("div", { class: "stars" }, "by " + p.brand) : null,
        h("div", { class: "price" }, p.priceText || "No price shown"),
        p.variants ? h("div", { class: "opts" }, p.variants.dimensions.map((d) => h("div", { class: "dim" },
          h("span", { class: "dim-name" }, d.name),
          h("div", { class: "chips" }, d.values.map((val) => h("button", {
            class: "chip" + (p.variants.selected[d.name] === val ? " on" : ""),
            onclick: (e) => pickOption(p, d.name, val, e.currentTarget),
          }, val)))))) : null,
        stars(p.rating, p.reviews),
        p.availability ? h("div", { class: "stars" }, p.availability) : null,
        h("div", { class: "row" },
          p.canAddToCart ? h("button", { class: "primary", onclick: (e) => addToCart(p.asin, p.title, e.currentTarget) }, "Add to cart") : h("span", { class: "stars" }, "Not available to add directly"),
          h("button", { onclick: () => open(p.url) }, "Open on Amazon")),
        (p.bullets || []).length ? h("ul", {}, p.bullets.slice(0, 3).map((b) => h("li", {}, short(b, 140)))) : null)),
  ];
}

function renderCart(c) {
  const items = c.items || [];
  const where = c.mode === "account" ? "your Amazon cart" : "the guest cart";
  const added = c.added ? items.find((i) => i.asin === c.added) : null;
  const checked = items.filter((i) => i.selected !== false);
  const count = items.reduce((n, i) => n + i.quantity, 0);
  const checkedCount = checked.reduce((n, i) => n + i.quantity, 0);
  const allOn = items.length > 0 && checked.length === items.length;
  const selectable = items.some((i) => i.selectable);
  return [
    c.alreadyInCart ? h("div", { class: "banner" }, "ℹ️ Already in " + where + " — nothing added") : added ? h("div", { class: "banner ok" }, "✅ Added " + short(added.title, 70) + " to " + where) : null,
    c.removed ? h("div", { class: "banner" }, "Removed from " + where) : null,
    h("div", { class: "bar" },
      h("span", { class: "title" }, "🛒 Cart"),
      h("span", { class: "meta" }, count + " item" + (count === 1 ? "" : "s") + (c.mode === "guest" ? " · guest cart" : "")),
      h("span", { class: "spacer" }),
      items.length && selectable ? h("button", { onclick: (e) => select(items.map((i) => i.asin), !allOn, e.currentTarget) }, allOn ? "Select none" : "Select all") : null),
    items.length ? h("div", { class: "items" }, items.map((i) => h("div", { class: "item" + (i.asin === c.added ? " just-added" : "") + (i.selected === false ? " off" : "") },
      h("label", { class: "pick", title: i.selected === false ? "Include in checkout" : "Leave out of checkout" },
        i.selectable ? h("input", { type: "checkbox", checked: i.selected !== false, onchange: (e) => select([i.asin], e.currentTarget.checked, e.currentTarget) }) : null,
        h("div", { class: "thumb" }, i.image ? h("img", { src: sized(i.image, 160), alt: "" }) : null)),
      h("div", {},
        h("div", { class: "name", title: i.title }, i.title),
        h("div", { class: "sub" }, i.quantity + " × " + (money(i.price) || "—") + (i.outOfStock ? " · out of stock" : ""))),
      h("button", { onclick: (e) => remove(i.asin, e.currentTarget) }, "Remove")))) : h("div", { class: "empty" }, "Your cart is empty."),
    h("div", { class: "total" },
      h("div", { class: "sum" }, checked.length ? ["Subtotal (" + checkedCount + " item" + (checkedCount === 1 ? "" : "s") + ") ", h("b", {}, c.subtotalText || "—")] : "No items checked"),
      h("div", { class: "row" },
        h("button", { onclick: () => open(c.cartUrl) }, "Open cart"),
        h("button", { disabled: !checked.length, onclick: () => open(c.checkoutUrl) }, "Checkout on Amazon"),
        c.mode === "account" ? h("button", { class: "primary", disabled: !checked.length, onclick: (e) => buyHere(e.currentTarget) }, "Buy here →") : null)),
    h("div", { class: "stars", style: "margin-top:8px" }, "Checkout on Amazon opens Amazon's order page with the checked items. Buy here shows the order in this card, and you place it with one button."),
  ];
}

// ── ordering: only the user's click places an order (two-step), using the card's one-time code ──
function renderOrder(o) {
  const terms = o.termsAccepted ? null : h("div", { class: "terms" },
    h("b", {}, "Before your first order"),
    h("ul", {},
      h("li", {}, "You place every order yourself with the button below — the assistant can't."),
      h("li", {}, "Check items, address, card and total. Orders follow Amazon's terms, cancellation and returns."),
      h("li", {}, "Amazon may restrict accounts that use automated tools. Not affiliated with Amazon. No warranty."),
      h("li", {}, "No card numbers are seen or stored — Amazon's saved address and card are used.")),
    h("div", { class: "row" }, h("button", { class: "primary", onclick: (e) => accept(o, e.currentTarget) }, "I agree")));
  const placeBtn = h("button", { class: "primary big", disabled: !o.termsAccepted, onclick: (e) => place(o, e.currentTarget) }, "Place order · " + o.totalText);
  return [
    h("div", { class: "bar" }, h("span", { class: "title" }, "🧾 Your order"), h("span", { class: "meta" }, o.items.length + " item" + (o.items.length === 1 ? "" : "s"))),
    h("div", { class: "items" }, o.items.map((i) => h("div", { class: "item" },
      h("div", { class: "thumb" }, i.image ? h("img", { src: sized(i.image, 160), alt: "" }) : null),
      h("div", {}, h("div", { class: "name", title: i.title }, i.title), h("div", { class: "sub" }, i.quantity + " × " + (money(i.price) || "—"))),
      h("span", {})))),
    h("div", { class: "facts" },
      h("div", {}, h("span", { class: "k" }, "📦 Ship to"), h("span", {}, [o.recipient, o.address].filter(Boolean).join(" — ") || "—")),
      h("div", {}, h("span", { class: "k" }, "💳 Pay with"), h("span", {}, o.payment || "—")),
      o.delivery ? h("div", {}, h("span", { class: "k" }, "🚚 Delivery"), h("span", {}, o.delivery)) : null,
      ...o.lines.map((l) => h("div", { class: "line" }, h("span", { class: "k" }, l.label), h("span", {}, l.amount))),
      h("div", { class: "line grand" }, h("span", { class: "k" }, "Order total"), h("b", {}, o.totalText))),
    terms,
    h("div", { class: "total" },
      h("button", { onclick: () => open(o.checkoutUrl) }, "Change address or card on Amazon"),
      placeBtn),
    h("div", { class: "stars", style: "margin-top:8px" }, "Pressing Place order buys these items on Amazon with the card and address above."),
    o.code ? h("div", { class: "code-box small", id: "code-box" },
      h("div", { class: "code-label" }, "Buttons not working here? Type in the chat:"),
      h("div", { class: "code" }, "confirm " + o.code),
      h("div", { class: "stars" }, "Only you can see this code. It works once, expires in 10 minutes" + (o.termsAccepted ? "." : ", and typing it accepts the terms above."))) : null,
  ];
}

// The user reads this code here and types it in the chat. Only this card ever shows it.
function renderConfirm(o) {
  const parts = renderOrder({ ...o, termsAccepted: true });
  const kept = parts.slice(0, 3); // header, items, facts
  return [
    ...kept,
    h("div", { class: "code-box" },
      h("div", { class: "code-label" }, "To buy this, type in the chat:"),
      h("div", { class: "code" }, "confirm " + o.code),
      h("div", { class: "stars" }, "Only you can see this code. It works once and expires in 10 minutes." +
        (o.termsAccepted ? "" : " Typing it also accepts the ordering terms: you place this order yourself, Amazon's terms apply, not affiliated with Amazon, no warranty."))),
    h("div", { class: "total" }, h("button", { onclick: () => open(o.checkoutUrl) }, "Change address or card on Amazon"), h("span", {})),
  ];
}

function renderOrders(d) {
  const list = d.orders || [];
  if (!list.length) return [h("div", { class: "empty" }, "No recent orders.")];
  return [
    h("div", { class: "bar" }, h("span", { class: "title" }, "📦 Your orders"), h("span", { class: "meta" }, list.length + " recent")),
    h("div", { class: "items" }, list.map((o) => h("div", { class: "item order-row" },
      h("div", { class: "thumb" }, o.items[0]?.image ? h("img", { src: sized(o.items[0].image, 160), alt: "" }) : null),
      h("div", {},
        h("div", { class: "name" }, o.items.map((i) => i.title).join(" · ")),
        h("div", { class: "sub" }, [o.date, o.totalText].filter(Boolean).join(" · ")),
        o.status ? h("span", { class: "status-chip" + (/delivered/i.test(o.status) ? " done" : "") }, o.status) : null),
      h("div", { class: "col" },
        o.trackHref && o.orderId ? h("button", { onclick: (e) => trackOrder(o.orderId, e.currentTarget) }, "Track") : null,
        o.items[0]?.asin ? h("button", { onclick: (e) => addToCart(o.items[0].asin, o.items[0].title, e.currentTarget) }, "Buy again") : null)))),
  ];
}

function renderTracking(d) {
  const o = d.order, t = d.tracking;
  return [
    h("div", { class: "bar" }, h("span", { class: "title" }, "🚚 " + (t?.promise || o.status || "Tracking"))),
    h("div", { class: "items" }, h("div", { class: "item" },
      h("div", { class: "thumb" }, o.items[0]?.image ? h("img", { src: sized(o.items[0].image, 160), alt: "" }) : null),
      h("div", {}, h("div", { class: "name" }, o.items.map((i) => i.title).join(" · ")), h("div", { class: "sub" }, [o.date, o.totalText].filter(Boolean).join(" · "))),
      h("span", {}))),
    t ? h("div", { class: "steps" }, t.milestones.map((m) => h("div", { class: "step" + (m.done ? " done" : "") }, h("span", { class: "dot" }), m.label))) : h("div", { class: "empty" }, "No tracking for this order yet."),
    t?.trackingId ? h("div", { class: "stars", style: "margin-top:8px" }, "Tracking ID: " + t.trackingId) : null,
  ];
}

function renderWatch(d) {
  const list = d.watchlist || [];
  const hits = new Set((d.hits || []).map((w) => w.asin));
  if (!list.length) return [h("div", { class: "empty" }, "Nothing watched yet — ask: “tell me when the Lamy drops under $25”.")];
  return [
    h("div", { class: "bar" }, h("span", { class: "title" }, "👀 Price watch"), h("span", { class: "meta" }, list.length + " item" + (list.length === 1 ? "" : "s"))),
    h("div", { class: "items" }, list.map((w) => h("div", { class: "item" + (hits.has(w.asin) || (w.lastPrice != null && w.lastPrice <= w.below) ? " just-added" : "") },
      h("div", { class: "thumb" }, w.image ? h("img", { src: sized(w.image, 160), alt: "" }) : null),
      h("div", {},
        h("div", { class: "name" }, w.title),
        h("div", { class: "sub" }, "Now " + (money(w.lastPrice) || "?") + " · alert at " + money(w.below) + (w.lowestPrice != null ? " · lowest " + money(w.lowestPrice) : "")),
        w.lastPrice != null && w.lastPrice <= w.below ? h("span", { class: "status-chip done" }, "🔔 Below your target") : null),
      h("div", { class: "col" },
        h("button", { class: "primary", onclick: (e) => addToCart(w.asin, w.title, e.currentTarget) }, "+ Cart"),
        h("button", { onclick: (e) => unwatch(w.asin, e.currentTarget) }, "Stop"))))),
    h("div", { class: "stars", style: "margin-top:8px" }, "Prices are checked every morning; you get a push alert when one drops to your target."),
  ];
}

async function trackOrder(orderId, btn) {
  const done = busy(btn, "…");
  try { const r = await call("amazon_track", { orderId }, "Track my Amazon order " + orderId); r ? draw(r) : (done(), notice(viaChatNote)); } catch (e) { done(); notice("⚠️ " + e.message); }
}
async function unwatch(asin, btn) {
  const done = busy(btn, "…");
  try { const r = await call("amazon_unwatch", { asin }, "Stop watching the price of Amazon product " + asin); r ? draw(r) : (done(), notice(viaChatNote)); } catch (e) { done(); notice("⚠️ " + e.message); }
}

function renderPlaced(r) {
  return [
    h("div", { class: "banner ok" }, "✅ Order placed" + (r.orderId ? " · #" + r.orderId : "") + " · " + r.totalText),
    h("div", { class: "items" }, r.items.map((i) => h("div", { class: "item" },
      h("div", { class: "thumb" }, i.image ? h("img", { src: sized(i.image, 160), alt: "" }) : null),
      h("div", {}, h("div", { class: "name" }, i.title), h("div", { class: "sub" }, i.quantity + " × " + (money(i.price) || "—"))),
      h("span", {})))),
    h("div", { class: "stars", style: "margin-top:8px" }, "Track or cancel it in Amazon → Your Orders."),
  ];
}

async function accept(o, btn) {
  btn.disabled = true;
  try {
    await call("amazon_accept_terms", { token: o.token }); // no chat fallback: only the user agrees
    render("order", { ...o, termsAccepted: true });
  } catch (e) { btn.disabled = false; notice(cardOnly(e)); }
}

async function place(o, btn) {
  if (!btn.dataset.armed) {  // first click arms, second click places
    btn.dataset.armed = "1";
    btn.textContent = "Confirm — buy for " + o.totalText;
    setTimeout(() => { if (btn.isConnected && btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = "Place order · " + o.totalText; } }, 8000);
    return;
  }
  btn.disabled = true; btn.textContent = "Placing order…";
  try {
    const r = await call("amazon_order_place", { token: o.token, expectedTotal: o.totalText }); // no chat fallback
    draw(r);
  } catch (e) { btn.disabled = false; delete btn.dataset.armed; btn.textContent = "Place order · " + o.totalText; notice(cardOnly(e)); }
}

function cardOnly(e) {
  if (!/IPC not available|not supported|Method not found/i.test(e.message)) return "⚠️ " + e.message;
  const box = document.getElementById("code-box");
  if (box) { box.classList.add("flash"); box.scrollIntoView({ block: "center" }); return "This app can't run buttons inside the card — type the confirmation code below in the chat instead."; }
  return "This app can't run order buttons inside the card — use “Change address or card on Amazon” to place the order there.";
}

function render(kind, data) {
  const parts = kind === "search" ? renderSearch(data) : kind === "product" ? renderProduct(data) : kind === "order" ? renderOrder(data) : kind === "placed" ? renderPlaced(data) : kind === "confirm" ? renderConfirm(data) : kind === "orders" ? renderOrders(data) : kind === "tracking" ? renderTracking(data) : kind === "watch" ? renderWatch(data) : renderCart(data);
  root.replaceChildren(...parts.filter(Boolean));
}

function draw(result) {
  const p = payload(result);
  if (!p) { root.replaceChildren(h("div", { class: result?.isError ? "error" : "empty" }, errorText(result))); return; }
  if (p.kind === "search") lastSearch = { args: { ...lastInput, query: p.data.query }, data: p.data };
  render(p.kind, p.data);
}

async function pickOption(p, dim, val, btn) {
  if (p.variants.selected[dim] === val) return;
  const choose = { ...p.variants.selected, [dim]: val };
  const done = busy(btn, val);
  try { const r = await call("amazon_variant", { asin: p.asin, choose }, "Show the " + Object.entries(choose).map(([k, v]) => k + " " + v).join(", ") + " option of Amazon product " + p.asin); r ? draw(r) : (done(), notice(viaChatNote)); }
  catch (e) { done(); notice("⚠️ " + e.message); }
}
async function details(asin, btn) {
  const done = busy(btn, "…");
  try { const r = await call("amazon_product", { asin }, "Show me the details for Amazon product " + asin); r ? draw(r) : (done(), notice(viaChatNote)); } catch (e) { done(); notice("⚠️ " + e.message); }
}
async function page(n, btn) {
  if (!lastSearch) return;
  const done = busy(btn, "…");
  try { const r = await call("amazon_search", { ...lastSearch.args, page: n, images: 0 }, "Show page " + n + " of the Amazon results for \u201c" + lastSearch.data.query + "\u201d"); r ? (draw(r), scrollTo(0, 0)) : (done(), notice(viaChatNote)); } catch (e) { done(); notice("⚠️ " + e.message); }
}
async function select(asins, selected, el) {
  if (el) el.disabled = true;
  try {
    const r = await call("amazon_cart_select", { asins, selected }, (selected ? "Check " : "Uncheck ") + asins.join(", ") + " in my Amazon cart" + (selected ? " for checkout" : ""));
    r ? draw(r) : notice(viaChatNote);
  } catch (e) { notice("⚠️ " + e.message); }
  finally { if (el) el.disabled = false; }
}
async function buyHere(btn) {
  const done = busy(btn, "Loading order…");
  try { const r = await call("amazon_order_preview", {}, "Show me the order for the checked items in my Amazon cart"); r ? draw(r) : (done(), notice(viaChatNote)); }
  catch (e) { done(); notice("⚠️ " + e.message); }
}
async function remove(asin, btn) {
  const done = busy(btn, "…");
  try { const r = await call("amazon_cart_remove", { asin }, "Remove Amazon product " + asin + " from my cart"); r ? draw(r) : (done(), notice(viaChatNote)); } catch (e) { done(); notice("⚠️ " + e.message); }
}

// ── host wiring: handlers before connect() so the first notifications aren't missed ──
function theme(ctx) {
  if (ctx?.theme) { applyDocumentTheme?.(ctx.theme); document.documentElement.dataset.theme = ctx.theme; }
  if (ctx?.styles?.variables) applyHostStyleVariables?.(ctx.styles.variables);
}
app.ontoolinput = ({ arguments: a }) => { if (a) lastInput = a; };
app.ontoolresult = draw;
app.onhostcontextchanged = theme;
await app.connect();
theme(app.getHostContext());
</script>
</body></html>`;
  return cached;
}
