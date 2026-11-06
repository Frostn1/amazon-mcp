// The agent-facing client: suggest → search → product → cart, guest or signed in.
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { parseOrderPage, parseOrderPlaced } from "./checkout.ts";
import { Session, type AccountInfo, type LedgerItem, type SessionOptions, type WatchItem } from "./http.ts";
import { parseOrders, parseTracking, type OrderSummary, type Tracking } from "./orders.ts";
import {
  asinFrom,
  buyBoxForm,
  parseCart,
  parseProduct,
  resolveVariant,
  parseSearchPage,
  parseSearchStream,
  type CartItem,
  type Product,
  type Refinement,
  type SearchResult,
} from "./parse.ts";

export const SORTS = ["featured", "price-asc-rank", "price-desc-rank", "review-rank", "date-desc-rank", "exact-aware-popularity-rank"] as const;
export type Sort = (typeof SORTS)[number];

export interface SearchOptions {
  /** Department alias, e.g. "electronics" (same as suggest's dept). */
  dept?: string;
  /** rh filter string, e.g. "p_72:1248915011,p_123:486782" — take values from refinements. */
  filters?: string;
  sort?: Sort;
  page?: number;
  /** Price bounds in the marketplace currency (e.g. dollars). */
  minPrice?: number;
  maxPrice?: number;
}

export interface SearchResponse {
  query: string;
  page: number;
  total: number | null;
  hasNext: boolean;
  results: SearchResult[];
  /** Only returned for page 1 (the stream endpoint doesn't carry them). */
  refinements?: Refinement[];
}

export interface Cart {
  items: CartItem[];
  subtotal: number | null;
  subtotalText: string | null;
  /** "account" = the user's real Amazon cart; "guest" = this client's anonymous cart. */
  mode: "account" | "guest";
  /** The cart page, for the user to open. */
  cartUrl: string;
  /** Amazon's checkout for the checked items — opened in the USER's browser; this client never visits it. */
  checkoutUrl: string;
  /** Set when addToCart found the item already in the cart and added nothing. */
  alreadyInCart?: string;
  /** Present once after the session was renewed and the cart rebuilt from the ledger. */
  restored?: CartRestore;
}

export interface CartRestore {
  restored: string[];
  failed: { asin: string; reason: string }[];
}

export interface SessionStatus {
  mode: "account" | "guest";
  signedInAs: string | null;
  signedInAt: string | null;
  lastUsed: string | null;
  sessionFile: string | null;
  cartItems: number;
  /**
   * Account mode only: whether Amazon still accepts the sign-in, checked live by verifyStatus().
   * null = not checked (status() is local-only).
   */
  signInValid: boolean | null;
  /** A sign-in link is open and waiting for the user. */
  pendingSignIn: { url: string; expiresAt: string } | null;
  /** How the last link sign-in ended, if it failed. */
  lastSignInError: string | null;
}

export type SignInVia = "window" | "link";

export interface SignInLinkOutcome {
  /** One-time link for the user to open (phone or any computer). Empty when already signed in. */
  url: string;
  expiresAt: string;
  /** Already signed in via the saved profile — no link needed. */
  alreadySignedIn?: SignInOutcome;
}

export interface SignInOutcome {
  signedInAs: string | null;
  /** Browser profile was already signed in; no input needed. */
  reused: boolean;
  /** Guest-cart items moved into the account cart. */
  movedFromGuestCart?: CartRestore;
}

const SIGN_IN_HINT = "This is a temporary guest cart, not your Amazon account. Sign in (amazon_signin) to add items straight to your own cart.";

/**
 * Amazon's checkout for the TICKED items only. Without partialCheckoutCart=1 Amazon checks out the
 * whole cart (verified: the plain proceedToCheckout link listed every item). These are the same
 * parameters the cart page's own "Proceed to checkout" button sends.
 */
export function checkoutUrlFor(base: string, checkedLines: number): string {
  const q = new URLSearchParams({
    proceedToCheckout: "1",
    useDefaultCart: "1",
    partialCheckoutCart: "1",
    cartItemCount: String(checkedLines),
    referrer: "cart",
  });
  return `${base}/checkout/entry/cart?${q}`;
}

export interface OrderPreview {
  /** One-time code for placeOrder. Goes to the order card only — never to the model. */
  token: string;
  expiresAt: string;
  items: CartItem[];
  recipient: string | null;
  address: string | null;
  payment: string | null;
  delivery: string | null;
  lines: { label: string; amount: string }[];
  total: number | null;
  totalText: string | null;
  /** Amazon's own order page (to change address/card there). */
  checkoutUrl: string;
  termsAccepted: boolean;
}

export interface OrderResult {
  orderId: string | null;
  totalText: string;
  items: CartItem[];
}

const ORDER_TOKEN_TTL_MS = 10 * 60_000;

export class AmazonClient {
  readonly session: Session;
  private pendingRestore?: CartRestore;

  constructor(opts: SessionOptions = {}) {
    this.session = new Session(opts);
    this.session.onRenew = (ledger) => this.restoreCart(ledger);
  }

  private orderTokens = new Map<string, { createdAt: number; totalText: string; asins: string }>();
  /** The one order waiting for the user to type its confirmation code (shown only in the order card). */
  private pendingCode: { code: string; token: string; totalText: string; needTerms: boolean; createdAt: number; attempts: number } | null = null;

  /** Re-add the ledger's items to a fresh guest cart (called by Session.renew). */
  private async restoreCart(ledger: LedgerItem[]): Promise<void> {
    const report: CartRestore = { restored: [], failed: [] };
    for (const { asin, quantity } of ledger) {
      try {
        await this.postAddToCart(asin, quantity);
        report.restored.push(asin);
      } catch (e) {
        report.failed.push({ asin, reason: (e as Error).message });
      }
    }
    this.pendingRestore = report;
  }

  private get base() {
    return this.session.base;
  }

  async suggest(prefix: string, opts: { dept?: string; limit?: number } = {}): Promise<string[]> {
    const { mp } = this.session;
    const q = new URLSearchParams({
      prefix,
      alias: opts.dept ?? "aps",
      mid: mp.mid,
      limit: String(opts.limit ?? 11),
      "suggestion-type": "KEYWORD",
      "plain-mid": "1",
      "client-info": "amazon-search-ui",
    });
    const res = await this.session.request(`https://${mp.completionHost}/api/2017/suggestions?${q}`);
    const data = (await res.json()) as { suggestions?: { value: string }[] };
    return (data.suggestions ?? []).map((s) => s.value);
  }

  async search(query: string, opts: SearchOptions = {}): Promise<SearchResponse> {
    await this.session.ensure();
    const page = Math.max(1, opts.page ?? 1);
    const q = new URLSearchParams({ k: query });
    if (opts.dept) q.set("i", opts.dept);
    const rh = [opts.filters];
    if (opts.minPrice != null || opts.maxPrice != null) {
      const c = (v?: number) => (v == null ? "" : String(Math.round(v * 100)));
      rh.push(`p_36:${c(opts.minPrice)}-${c(opts.maxPrice)}`);
    }
    const rhs = rh.filter(Boolean).join(",");
    if (rhs) q.set("rh", rhs);
    if (opts.sort && opts.sort !== "featured") q.set("s", opts.sort);
    if (page > 1) q.set("page", String(page));

    // Page 1 → full HTML (has total + refinements). Later pages → the lighter JSON stream.
    if (page > 1) {
      try {
        const r = await this.session.text(`${this.base}/s/query?${q}`, {
          method: "POST",
          body: JSON.stringify({ "customer-action": "pagination" }),
          headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest", Referer: `${this.base}/s?${q}` },
        });
        const s = parseSearchStream(r.body, this.base);
        if (s.results.length) return { query, page, total: null, ...s };
      } catch (e) {
        if ((e as Error).name === "BlockedError") throw e;
      }
    }
    const r = await this.session.text(`${this.base}/s?${q}`);
    const p = parseSearchPage(r.body, this.base);
    if (p.unexpected) throw new Error("Amazon returned a page without results (possibly a challenge or a layout change). Nothing was searched — try again later.");
    return { query, page, total: p.total, hasNext: p.hasNext, results: p.results, ...(page === 1 ? { refinements: p.refinements } : {}) };
  }

  /** Accepts an ASIN or any Amazon product URL. */
  async product(asinOrUrl: string): Promise<Product> {
    await this.session.ensure();
    const asin = asinFrom(asinOrUrl);
    const r = await this.session.text(`${this.base}/dp/${asin}`);
    if (r.status === 404) throw new Error(`Product ${asin} not found`);
    return parseProduct(r.body, asin, this.base);
  }

  /**
   * The product with specific options picked, e.g. { size: "M", color: "black 7 pack" }.
   * Returns the child listing (its own price, stock and photos) with the full option list.
   */
  async productVariant(asinOrUrl: string, choose: Record<string, string>): Promise<Product> {
    const base = await this.product(asinOrUrl);
    if (!base.variants) throw new Error("This product has no size/colour options.");
    const pick = resolveVariant(base.variants, choose);
    return pick.asin === base.asin ? base : this.product(pick.asin);
  }

  /**
   * Add to the cart. Never buys. If the item is already in the cart and no quantity was asked for,
   * nothing is added (Amazon would bump it to 2) and the cart comes back with `alreadyInCart`.
   */
  async addToCart(asinOrUrl: string, quantity?: number, options?: Record<string, string>): Promise<Cart> {
    await this.session.ensure();
    const asin = options && Object.keys(options).length ? (await this.productVariant(asinOrUrl, options)).asin : asinFrom(asinOrUrl);
    if (quantity == null) {
      const current = await this.viewCart();
      if (current.items.some((i) => i.asin === asin)) return { ...current, alreadyInCart: asin };
    }
    const status = await this.postAddToCart(asin, quantity ?? 1);
    const cart = await this.viewCart();
    if (!cart.items.some((i) => i.asin === asin)) {
      throw new Error(`Amazon did not add ${asin} to the cart (HTTP ${status}).`);
    }
    return cart;
  }

  /** Product page → buy-box form → POST add-to-cart. Returns the HTTP status. */
  private async postAddToCart(asin: string, quantity: number): Promise<number> {
    const dp = await this.session.text(`${this.base}/dp/${asin}`);
    const form = buyBoxForm(dp.body);
    if (!form) {
      throw new Error(`${asin} has no add-to-cart button (unavailable, or only sold through "See all buying options").`);
    }
    form.set("items[0.base][quantity]", String(quantity));
    form.set("quantity", String(quantity));
    const r = await this.session.text(`${this.base}/cart/add-to-cart/ref=dp_start-bbf_1_glance`, {
      method: "POST",
      body: form.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: dp.url, Origin: this.base },
    });
    return r.status;
  }

  async viewCart(): Promise<Cart> {
    await this.session.ensure();
    const r = await this.session.text(`${this.base}/gp/cart/view.html`);
    const c = parseCart(r.body);
    this.session.setCart(c.items); // the real cart is the source of truth for the ledger
    const restored = this.pendingRestore;
    this.pendingRestore = undefined;
    return {
      items: c.items.map((i) => ({ ...i, url: new URL(i.url, this.base).toString() })),
      subtotal: c.subtotal,
      subtotalText: c.subtotalText,
      mode: this.session.mode,
      cartUrl: `${this.base}/gp/cart/view.html`,
      checkoutUrl: checkoutUrlFor(this.base, c.items.filter((i) => i.selected).length),
      ...(restored ? { restored } : {}),
    };
  }

  /**
   * Tick or untick cart items (Amazon only checks out ticked items). Uses the same call the cart
   * page makes when you click an item's checkbox.
   */
  async selectCartItems(asinsOrUrls: string[], selected: boolean): Promise<Cart> {
    await this.session.ensure();
    const want = new Set(asinsOrUrls.map(asinFrom));
    const r = await this.session.text(`${this.base}/gp/cart/view.html`);
    const c = parseCart(r.body);
    const csrf = c.hidden.get("anti-csrftoken-a2z") ?? "";
    if (c.items.length && !c.items.some((i) => i.selectable)) {
      throw new Error("Choosing items for checkout needs a signed-in cart. Ask the user to run amazon_signin.");
    }
    const targets = c.items.filter((i) => want.has(i.asin));
    const missing = [...want].filter((a) => !targets.some((i) => i.asin === a));
    if (missing.length) throw new Error(`Not in the cart: ${missing.join(", ")}`);
    for (const item of targets.filter((i) => i.selected !== selected)) {
      const body = new URLSearchParams({
        "submit.cart-actions": "1",
        pageAction: "cart-actions",
        actionPayload: JSON.stringify([
          { type: "UPDATE_ITEM_SELECTION_START", payload: { itemId: item.itemId, list: "activeItems", relatedItemIds: [], isPrimeAsin: item.isPrime, isSelected: selected } },
        ]),
        "anti-csrftoken-a2z": csrf,
      });
      await this.session.text(`${this.base}/cart/ref=ox_sc_cart_actions_1`, {
        method: "POST",
        body: body.toString(),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          "anti-csrftoken-a2z": csrf,
          Referer: r.url,
          Origin: this.base,
        },
      });
    }
    return this.viewCart();
  }

  async removeFromCart(asinOrUrl: string): Promise<Cart> {
    await this.session.ensure();
    const asin = asinFrom(asinOrUrl);
    const r = await this.session.text(`${this.base}/gp/cart/view.html`);
    const c = parseCart(r.body);
    const item = c.items.find((i) => i.asin === asin);
    if (!item) throw new Error(`${asin} is not in the cart`);
    if (!c.formAction) throw new Error("Cart form not found; Amazon markup may have changed");
    const body = new URLSearchParams(c.hidden);
    body.set(`submit.delete-active.${item.itemId}`, "Delete");
    await this.session.text(new URL(c.formAction, this.base).toString(), {
      method: "POST",
      body: body.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: r.url, Origin: this.base },
    });
    return this.viewCart();
  }

  /**
   * Open a browser window for the user to sign in (or clear a security check).
   * Items collected in the guest cart are then moved into the account cart.
   */
  async signIn(opts: { timeoutMs?: number } = {}): Promise<SignInOutcome> {
    const guestItems = this.session.mode === "guest" ? [...this.session.cart] : [];
    const { interactiveSignIn } = await import("./signin.ts"); // loads Playwright only when needed
    const { account, reused } = await interactiveSignIn(this.session, opts);
    return this.afterSignIn(account.name, reused, guestItems);
  }

  /**
   * Remote sign-in: returns a one-time link right away (valid 10 min, locks to the first device).
   * The sign-in completes in the background; poll status() or await waitForSignIn().
   */
  async signInLink(): Promise<SignInLinkOutcome> {
    if (this.linkPending) {
      return { url: this.linkPending.url, expiresAt: this.linkPending.expiresAt.toISOString() };
    }
    const guestItems = this.session.mode === "guest" ? [...this.session.cart] : [];
    const { startLinkSignIn } = await import("./signin.ts");
    const link = await startLinkSignIn(this.session);
    if (!link.url) {
      const { account } = await link.done;
      return { url: "", expiresAt: link.expiresAt.toISOString(), alreadySignedIn: await this.afterSignIn(account.name, true, guestItems) };
    }
    this.lastSignInError = null;
    this.linkPending = link;
    this.linkResult = link.done
      .then(({ account }) => this.afterSignIn(account.name, false, guestItems))
      .catch((e) => {
        this.lastSignInError = (e as Error).message;
        throw e;
      })
      .finally(() => {
        this.linkPending = null;
      });
    this.linkResult.catch(() => {});
    return { url: link.url, expiresAt: link.expiresAt.toISOString() };
  }

  /** Wait for the pending link sign-in to finish (resolves immediately if none is pending). */
  async waitForSignIn(): Promise<SignInOutcome | null> {
    return this.linkResult ?? null;
  }

  private linkPending: { url: string; expiresAt: Date } | null = null;
  private linkResult: Promise<SignInOutcome> | null = null;
  private lastSignInError: string | null = null;

  private async afterSignIn(name: string | null, reused: boolean, guestItems: LedgerItem[]): Promise<SignInOutcome> {
    const out: SignInOutcome = { signedInAs: name, reused };
    if (guestItems.length) {
      await this.restoreCart(guestItems);
      out.movedFromGuestCart = this.pendingRestore;
      this.pendingRestore = undefined;
      await this.viewCart(); // sync the ledger with the account cart
    }
    return out;
  }

  status(): SessionStatus {
    const s = this.session;
    const acc: AccountInfo | null = s.account;
    return {
      mode: s.mode,
      signedInAs: acc?.name ?? null,
      signedInAt: acc?.signedInAt ?? null,
      lastUsed: s.lastUsedAt?.toISOString() ?? null,
      sessionFile: s.file,
      cartItems: s.cart.length,
      signInValid: null,
      pendingSignIn: this.linkPending ? { url: this.linkPending.url, expiresAt: this.linkPending.expiresAt.toISOString() } : null,
      lastSignInError: this.lastSignInError,
    };
  }

  /**
   * status() plus a live check with Amazon: one home-page request in account mode. Uses the
   * session's own sign-out / CAPTCHA detection, so an expired login shows up here instead of
   * on the next cart call.
   */
  async verifyStatus(): Promise<SessionStatus> {
    const s = this.status();
    if (s.mode !== "account") return s;
    try {
      await this.session.request(`${this.base}/`);
      return { ...this.status(), signInValid: true };
    } catch (e) {
      if ((e as Error).name === "SignInRequiredError") return { ...s, signInValid: false };
      throw e; // blocked / network: report as an error, not as "signed out"
    }
  }

  /** Forget the account here: session cookies and the sign-in browser profile. Amazon itself is untouched. */
  async signOut(): Promise<void> {
    this.session.signOut();
    const { clearBrowserProfile } = await import("./signin.ts");
    clearBrowserProfile();
  }

  get termsAccepted(): boolean {
    return !!this.session.termsAcceptedAt;
  }

  /**
   * Recorded only when the user presses "I agree" in the order card (see TERMS.md). Needs the card's
   * one-time code, so the model can't accept on the user's behalf even where app-only tools leak.
   */
  acceptTerms(token: string): void {
    const t = this.orderTokens.get(token);
    if (!t || Date.now() - t.createdAt > ORDER_TOKEN_TTL_MS) throw new Error("Open the order card again to accept the terms.");
    this.session.acceptTerms();
  }

  /**
   * Read Amazon's order page for the ticked items: address, card (brand + last 4), totals.
   * Read-only — nothing is ordered. Returns a one-time code the order card needs to place it.
   */
  async previewOrder(): Promise<OrderPreview> {
    if (!this.session.signedIn) throw new Error("Ordering needs the user's own Amazon account. Call amazon_signin first.");
    await this.session.ensure();
    const cart = await this.viewCart();
    const items = cart.items.filter((i) => i.selected);
    if (!items.length) throw new Error("No items are ticked for checkout. Tick items in the cart first (amazon_cart_select).");
    const page = await this.session.text(cart.checkoutUrl, { checkout: "read" });
    const o = parseOrderPage(page.body);
    if (!o.placeAction || !o.totalText) {
      throw new Error(`Amazon's order page needs something only you can do there (a sign-in, card check or address). Open checkout: ${cart.checkoutUrl}`);
    }
    const token = randomBytes(16).toString("hex");
    this.orderTokens.set(token, { createdAt: Date.now(), totalText: o.totalText, asins: items.map((i) => `${i.asin}x${i.quantity}`).sort().join(",") });
    return {
      token,
      expiresAt: new Date(Date.now() + ORDER_TOKEN_TTL_MS).toISOString(),
      items,
      recipient: o.recipient,
      address: o.address,
      payment: o.payment,
      delivery: o.delivery,
      lines: o.lines,
      total: o.total,
      totalText: o.totalText,
      checkoutUrl: cart.checkoutUrl,
      termsAccepted: this.termsAccepted,
    };
  }

  /**
   * Place the order the user confirmed in the order card. Refuses unless: the terms were accepted,
   * the one-time code is valid and unused, the ticked items are unchanged, and Amazon's total still
   * equals the total the user saw.
   */
  async placeOrder(token: string, expectedTotal: string): Promise<OrderResult> {
    const t = this.orderTokens.get(token);
    this.orderTokens.delete(token); // single use, whatever happens next
    if (!t) throw new Error("This order confirmation has expired or was already used. Show the order again.");
    if (Date.now() - t.createdAt > ORDER_TOKEN_TTL_MS) throw new Error("This order confirmation expired (10 minutes). Show the order again.");
    if (!this.termsAccepted) throw new Error("The ordering terms haven't been accepted in the order card.");
    if (expectedTotal !== t.totalText) throw new Error("The total doesn't match what was shown. Nothing was ordered.");
    const cart = await this.viewCart();
    const items = cart.items.filter((i) => i.selected);
    if (items.map((i) => `${i.asin}x${i.quantity}`).sort().join(",") !== t.asins) {
      throw new Error("The ticked items changed since the order was shown. Nothing was ordered — show the order again.");
    }
    const page = await this.session.text(cart.checkoutUrl, { checkout: "read" });
    const o = parseOrderPage(page.body);
    if (!o.placeAction) throw new Error(`Amazon's order page changed or needs you there. Nothing was ordered. Open checkout: ${cart.checkoutUrl}`);
    if (o.totalText !== expectedTotal) throw new Error(`Amazon's total is now ${o.totalText}, not ${expectedTotal}. Nothing was ordered.`);
    const res = await this.session.text(new URL(o.placeAction, this.base).toString(), {
      method: "POST",
      checkout: "place",
      body: o.placeFields.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: page.url, Origin: this.base },
    });
    const done = parseOrderPlaced(res.body);
    if (!done.placed) {
      throw new Error(`Amazon didn't confirm the order${done.message ? `: ${done.message}` : ""}. Check your orders on Amazon before trying again.`);
    }
    await this.viewCart().catch(() => {}); // sync the ledger: ordered items leave the cart
    return { orderId: done.orderId, totalText: expectedTotal, items };
  }

  /**
   * For apps that can't show a confirmation dialog: a 6-digit code drawn only inside the order card
   * (never in text the model reads). The user types it in the chat to confirm; the model can't know it.
   */
  issueConfirmationCode(token: string, totalText: string, needTerms: boolean): string {
    if (!this.orderTokens.has(token)) throw new Error("Show the order again.");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.pendingCode = { code, token, totalText, needTerms, createdAt: Date.now(), attempts: 0 };
    return code;
  }

  /** Place the pending order if `typed` matches its code. 3 wrong tries or 10 minutes and it's gone. */
  async confirmWithCode(typed: string): Promise<OrderResult> {
    const p = this.pendingCode;
    if (!p) throw new Error("No order is waiting for a confirmation code. Ask to buy again.");
    if (Date.now() - p.createdAt > ORDER_TOKEN_TTL_MS) {
      this.pendingCode = null;
      throw new Error("The confirmation code expired (10 minutes). Nothing was ordered — ask to buy again.");
    }
    const digits = typed.replace(/\D/g, "");
    const ok = digits.length === 6 && timingSafeEqual(Buffer.from(digits), Buffer.from(p.code));
    if (!ok) {
      p.attempts++;
      if (p.attempts >= 3) {
        this.pendingCode = null;
        throw new Error("Wrong code 3 times — that confirmation is cancelled. Nothing was ordered.");
      }
      throw new Error(`That code doesn't match (try ${p.attempts} of 3). Nothing was ordered.`);
    }
    this.pendingCode = null;
    if (p.needTerms) this.acceptTerms(p.token); // the card shows the terms next to the code
    return this.placeOrder(p.token, p.totalText);
  }

  // ── Your Orders (read-only) ────────────────────────────────────────────────────────────────

  async orders(): Promise<OrderSummary[]> {
    if (!this.session.signedIn) throw new Error("Your orders need the user's own Amazon account. Call amazon_signin first.");
    await this.session.ensure();
    const r = await this.session.text(`${this.base}/gp/your-account/order-history`);
    return parseOrders(r.body).map((o) => ({ ...o, items: o.items.map((i) => ({ ...i, url: i.url ? new URL(i.url, this.base).toString() : null })) }));
  }

  /** Tracking for one order (by order number, or the most recent order when omitted). */
  async track(orderId?: string): Promise<{ order: OrderSummary; tracking: Tracking | null }> {
    const list = await this.orders();
    const order = orderId ? list.find((o) => o.orderId === orderId.trim()) : list[0];
    if (!order) throw new Error(orderId ? `Order ${orderId} isn't among your recent orders.` : "No recent orders.");
    if (!order.trackHref) return { order, tracking: null };
    const r = await this.session.text(new URL(order.trackHref, this.base).toString());
    return { order, tracking: parseTracking(r.body) };
  }

  // ── Price-drop alerts ─────────────────────────────────────────────────────────────────────

  get watchlist(): readonly WatchItem[] {
    return this.session.watchlist;
  }

  async watch(asinOrUrl: string, below: number): Promise<WatchItem> {
    const p = await this.product(asinOrUrl);
    const prev = this.session.watchlist.find((w) => w.asin === p.asin);
    const item: WatchItem = {
      asin: p.asin,
      title: p.title,
      below,
      lastPrice: p.price,
      lowestPrice: p.price != null ? Math.min(p.price, prev?.lowestPrice ?? Infinity) : (prev?.lowestPrice ?? null),
      checkedAt: new Date().toISOString(),
      url: p.url,
      image: p.images[0] ?? null,
    };
    this.session.setWatchlist([...this.session.watchlist.filter((w) => w.asin !== p.asin), item]);
    return item;
  }

  unwatch(asinOrUrl: string): void {
    const asin = asinFrom(asinOrUrl);
    if (!this.session.watchlist.some((w) => w.asin === asin)) throw new Error(`${asin} isn't on the watchlist.`);
    this.session.setWatchlist(this.session.watchlist.filter((w) => w.asin !== asin));
  }

  /** Re-check every watched item (one product page each, at the normal throttle). */
  async checkWatches(): Promise<{ hits: WatchItem[]; checked: WatchItem[]; failed: { asin: string; reason: string }[] }> {
    const checked: WatchItem[] = [];
    const failed: { asin: string; reason: string }[] = [];
    for (const w of this.session.watchlist) {
      try {
        const p = await this.product(w.asin);
        checked.push({
          ...w,
          title: p.title || w.title,
          lastPrice: p.price,
          lowestPrice: p.price != null ? Math.min(p.price, w.lowestPrice ?? Infinity) : w.lowestPrice,
          checkedAt: new Date().toISOString(),
          image: p.images[0] ?? w.image,
        });
      } catch (e) {
        failed.push({ asin: w.asin, reason: (e as Error).message });
        checked.push(w);
      }
    }
    this.session.setWatchlist(checked);
    return { hits: checked.filter((w) => w.lastPrice != null && w.lastPrice <= w.below), checked, failed };
  }

  /** Guest mode only: throw away cookies and the guest cart; start a fresh anonymous session. */
  async resetSession(): Promise<void> {
    if (this.session.signedIn) throw new Error("Signed in — use amazon_signout to drop the account session instead.");
    await this.session.renew({ keepCart: false });
  }

  /** Hint shown to agents in guest mode. */
  get guestHint(): string | null {
    return this.session.signedIn ? null : SIGN_IN_HINT;
  }
}
