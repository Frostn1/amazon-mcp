// Human-readable markdown for tool results — what the user should actually see.
import type { Cart, OrderPreview, OrderResult, SearchResponse, SessionStatus, SignInLinkOutcome, SignInOutcome } from "./client.ts";
import type { WatchItem } from "./http.ts";
import type { OrderSummary, Tracking } from "./orders.ts";
import type { Product, SearchResult } from "./parse.ts";

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const int = (n: number) => n.toLocaleString("en-US");
const usd = (n: number | null) => (n == null ? null : `$${n.toFixed(2)}`);

function stars(rating: number | null, reviews: number | null) {
  if (rating == null) return null;
  return `★ ${rating.toFixed(1)}${reviews != null ? ` (${int(reviews)})` : ""}`;
}

function priceLine(price: string | null, list: string | null) {
  if (!price) return null;
  return list && list !== price ? `**${price}** ~~${list}~~` : `**${price}**`;
}

export function productCard(p: Product): string {
  const meta = [
    priceLine(p.priceText, null) ?? "_no price shown_",
    p.rating != null && `★ ${p.rating.toFixed(1)}${p.reviews != null ? ` (${int(p.reviews)} reviews)` : ""}`,
    p.availability,
    p.brand && `by ${p.brand}`,
  ].filter(Boolean);
  const bullets = p.bullets.slice(0, 3).map((b) => `- ${cut(b, 160)}`);
  const opts = p.variants?.dimensions.map((d) => `${d.name}: ${p.variants!.selected[d.name] ? `**${p.variants!.selected[d.name]}**` : "—"} (${d.values.length} options: ${d.values.slice(0, 8).join(", ")}${d.values.length > 8 ? ", …" : ""})`) ?? [];
  return [
    `### [${cut(p.title, 110)}](${p.url})`,
    meta.join(" · "),
    ...(opts.length ? ["", ...opts.map((o) => `🎛️ ${o}`)] : []),
    ...(bullets.length ? ["", ...bullets] : []),
    ...(p.canAddToCart ? [] : ["", "_Not available to add to cart directly._"]),
  ].join("\n");
}

export function resultLine(r: SearchResult, i: number): string {
  const bits = [priceLine(r.priceText, r.listPrice) ?? "_no price_", stars(r.rating, r.reviews), `\`${r.asin}\``];
  if (r.sponsored) bits.push("_Sponsored_");
  return `${i + 1}. [**${cut(r.title, 80)}**](${r.url}) — ${bits.filter(Boolean).join(" · ")}`;
}

export function searchList(s: SearchResponse, limit = 10): string {
  const head = `**"${s.query}"** — ${s.total != null ? `about ${int(s.total)} results` : "results"} · page ${s.page}`;
  if (!s.results.length) return `${head}\n\nNo results.`;
  const lines = s.results.slice(0, limit).map(resultLine);
  const extra = (s as { moreOnPage?: boolean }).moreOnPage ? 1 : 0;
  const more = s.results.length > limit ? [`…and ${s.results.length - limit} more on this page.`] : extra ? ["More results available (raise limit or page)."] : [];
  const groups = new Map<string, number>();
  for (const r of s.refinements ?? []) groups.set(r.group, (groups.get(r.group) ?? 0) + 1);
  const filters = groups.size
    ? [`Filters: ${[...groups].slice(0, 8).map(([g, n]) => `${g} (${n})`).join(", ")}${groups.size > 8 ? ", …" : ""}`]
    : [];
  const next = s.hasNext ? [`Next: page ${s.page + 1}`] : [];
  return [head, "", ...lines, ...more, ...(filters.length || next.length ? [""] : []), ...filters, ...next].join("\n");
}

export function cartSummary(c: Cart, opts: { added?: string; removed?: string; hint?: string | null } = {}): string {
  const where = c.mode === "account" ? "your Amazon cart" : "the agent's guest cart";
  const out: string[] = [];
  const addedItem = opts.added ? c.items.find((i) => i.asin === opts.added) : undefined;
  const already = c.alreadyInCart ? c.items.find((i) => i.asin === c.alreadyInCart) : undefined;
  if (already) out.push(`ℹ️ **${cut(already.title, 90)}** is already in ${where} (${already.quantity}) — nothing added.`);
  else if (addedItem) out.push(`✅ Added **${cut(addedItem.title, 90)}** to ${where}.`);
  if (opts.removed) out.push(`🗑️ Removed \`${opts.removed}\` from ${where}.`);
  if (c.restored?.restored.length) out.push(`♻️ Restored ${c.restored.restored.length} item(s) after the session was renewed.`);
  if (c.restored?.failed.length) out.push(`⚠️ Could not restore: ${c.restored.failed.map((f) => f.asin).join(", ")}.`);
  if (out.length) out.push("");
  const count = c.items.reduce((n, i) => n + i.quantity, 0);
  if (!c.items.length) {
    out.push(`**Cart** is empty — [open cart](${c.cartUrl})`);
  } else {
    const unchecked = c.items.filter((i) => !i.selected).length;
    const sub = c.subtotalText ? ` · subtotal **${c.subtotalText}**${unchecked ? " (checked items)" : ""}` : "";
    out.push(`**Cart** · ${count} item${count === 1 ? "" : "s"}${sub} — [open cart](${c.cartUrl})`);
    for (const i of c.items) {
      const flags = [i.outOfStock && "_out of stock_", unchecked && !i.selected && "_unchecked_"].filter(Boolean).join(" · ");
      out.push(`- ${i.quantity} × [${cut(i.title, 80)}](${i.url})${i.price != null ? ` — ${usd(i.price)}` : ""}${flags ? ` · ${flags}` : ""}`);
    }
  }
  if (c.items.some((i) => i.selected)) {
    out.push("", `👉 [Checkout on Amazon](${c.checkoutUrl}) — opens Amazon's order page with the checked items; you place the order there.`);
  }
  if (c.mode === "guest" && opts.hint) out.push("", `_${opts.hint}_`);
  return out.join("\n");
}

export function statusText(s: SessionStatus): string {
  if (s.mode === "account" && s.signInValid === false) {
    return `⚠️ The Amazon sign-in${s.signedInAs ? ` for **${s.signedInAs}**` : ""} has expired. Call amazon_signin and send the user the link to sign in again.`;
  }
  if (s.mode === "account") {
    return `${s.signInValid ? "✅ " : ""}Signed in to Amazon${s.signedInAs ? ` as **${s.signedInAs}**` : ""}. Cart actions go to the user's own cart.${
      s.lastUsed ? ` Last used ${s.lastUsed}.` : ""
    }`;
  }
  if (s.pendingSignIn) return `⏳ Waiting for the user to sign in with the link: ${s.pendingSignIn.url} (expires ${s.pendingSignIn.expiresAt}).`;
  const failed = s.lastSignInError ? ` The last sign-in link failed: ${s.lastSignInError}` : "";
  return `Not signed in — cart actions use an anonymous guest cart. Run amazon_signin to use the user's own cart.${failed}`;
}

export function signInLinkText(o: SignInLinkOutcome): string {
  if (o.alreadySignedIn) return signInText(o.alreadySignedIn);
  const mins = Math.max(1, Math.round((Date.parse(o.expiresAt) - Date.now()) / 60_000));
  return [
    `🔐 **Sign in to Amazon:** ${o.url}`,
    "",
    `Open it on your phone or any computer within ${mins} minutes. You'll see Amazon's real sign-in page — sign in as usual.`,
    "The link works once: the first device that opens it keeps it.",
  ].join("\n");
}

export function signInText(o: SignInOutcome): string {
  const who = o.signedInAs ? ` as **${o.signedInAs}**` : "";
  const lines = [o.reused ? `Already signed in${who} — session refreshed.` : `Signed in${who}. Cart actions now go to your own Amazon cart.`];
  const moved = o.movedFromGuestCart;
  if (moved?.restored.length) lines.push(`Moved ${moved.restored.length} item(s) from the guest cart into your cart.`);
  if (moved?.failed.length) lines.push(`Could not move: ${moved.failed.map((f) => `${f.asin} (${f.reason})`).join(", ")}.`);
  return lines.join("\n");
}

export function orderSummary(o: Omit<OrderPreview, "token">): string {
  const out = [
    `🧾 **Ready to order** · total **${o.totalText ?? "?"}**`,
    ...o.items.map((i) => `- ${i.quantity} × ${cut(i.title, 80)}${i.price != null ? ` — ${usd(i.price)}` : ""}`),
    "",
    `📦 Ship to: ${o.recipient ?? "?"}${o.address ? `, ${o.address}` : ""}`,
    `💳 Pay with: ${o.payment ?? "?"}`,
    ...(o.delivery ? [`🚚 ${o.delivery}`] : []),
    ...o.lines.map((l) => `   ${l.label}: ${l.amount}`),
    "",
    o.termsAccepted
      ? "The user places this order by pressing **Place order** in the order card. You cannot place it. To change the address or card, they use Amazon's page:"
      : "Before ordering, the user must accept the ordering terms in the order card (I agree), then press **Place order**. You cannot place it. Amazon's page:",
    o.checkoutUrl,
  ];
  return out.join("\n");
}

export function orderPlacedText(r: OrderResult): string {
  return `✅ **Order placed**${r.orderId ? ` · #${r.orderId}` : ""} · ${r.totalText}\n${r.items.map((i) => `- ${i.quantity} × ${cut(i.title, 80)}`).join("\n")}\n\nTrack or cancel it in Amazon → Your Orders.`;
}

export function ordersText(list: OrderSummary[]): string {
  if (!list.length) return "No recent orders.";
  return [
    `📦 **Your recent orders** (${list.length})`,
    ...list.map((o) => `- ${o.date ?? "?"} · ${o.totalText ?? "?"} · ${o.status ?? "—"} — ${o.items.map((i) => cut(i.title, 50)).join("; ")}${o.orderId ? ` (#${o.orderId})` : ""}`),
  ].join("\n");
}

export function trackingText(o: OrderSummary, t: Tracking | null): string {
  const head = `🚚 **${o.items.map((i) => cut(i.title, 50)).join("; ")}**${o.orderId ? ` (#${o.orderId})` : ""}`;
  if (!t) return `${head}\n${o.status ?? "No tracking available for this order."}`;
  return [head, `${t.promise ?? o.status ?? ""}${t.status ? ` · now: ${t.status}` : ""}`, t.milestones.map((m) => `${m.done ? "●" : "○"} ${m.label}`).join(" → "), ...(t.trackingId ? [`Tracking ID: ${t.trackingId}`] : [])].join("\n");
}

export function watchText(list: readonly WatchItem[], hits: readonly WatchItem[] = []): string {
  if (!list.length) return "The watchlist is empty. Add one: \"tell me when X drops under $Y\".";
  return [
    ...(hits.length ? [`🔔 **Price drop!** ${hits.map((w) => `${cut(w.title, 50)} is ${usd(w.lastPrice)} (your target ${usd(w.below)})`).join("; ")}`, ""] : []),
    `👀 **Watching** (${list.length})`,
    ...list.map((w) => `- ${cut(w.title, 60)} — now ${usd(w.lastPrice) ?? "?"} · alert at ${usd(w.below)}${w.lowestPrice != null ? ` · lowest seen ${usd(w.lowestPrice)}` : ""}${w.lastPrice != null && w.lastPrice <= w.below ? " · ✅ below target" : ""}`),
  ].join("\n");
}
