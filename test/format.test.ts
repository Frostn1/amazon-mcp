import { describe, expect, test } from "bun:test";
import type { Cart } from "../src/client.ts";
import { cartSummary, productCard, searchList, statusText } from "../src/format.ts";
import { parseProduct, parseSearchPage } from "../src/parse.ts";

const B = "https://www.amazon.com";
const fx = (f: string) => Bun.file(new URL(`./fixtures/${f}`, import.meta.url)).text();

describe("format", () => {
  test("product card", async () => {
    const md = productCard(parseProduct(await fx("product.html"), "B0FB2WX15J", B));
    expect(md).toStartWith("### [BEILUNER Gold Fountain Pen");
    expect(md).toContain("(https://www.amazon.com/dp/B0FB2WX15J)");
    expect(md).toContain("**$49.99**");
    expect(md).toMatch(/★ 4\.5 \([\d,]+ reviews\)/);
    expect(md.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(3);
  });

  test("search list", async () => {
    const p = parseSearchPage(await fx("search.html"), B);
    const md = searchList({ query: "pen", page: 1, total: p.total, hasNext: true, results: p.results, refinements: p.refinements }, 5);
    const lines = md.split("\n");
    expect(lines[0]).toBe('**"pen"** — about 100,000 results · page 1');
    expect(lines.filter((l) => /^\d+\. \[\*\*/.test(l))).toHaveLength(5);
    expect(md).toContain("_Sponsored_");
    expect(md).toContain("Filters: ");
    expect(md).toContain("Next: page 2");
  });

  const cart: Cart = {
    mode: "guest",
    cartUrl: `${B}/gp/cart/view.html`,
    checkoutUrl: `${B}/checkout/entry/cart?proceedToCheckout=1`,
    subtotal: 76.99,
    subtotalText: "$76.99",
    items: [
      { asin: "B07VQS7SSC", itemId: "a", title: "Sailor Fountain Pen", price: 13.5, quantity: 2, outOfStock: false, selected: true, selectable: true, isPrime: false, image: null, url: `${B}/dp/B07VQS7SSC` },
      { asin: "B0FB2WX15J", itemId: "b", title: "BEILUNER Gold Fountain Pen", price: 49.99, quantity: 1, outOfStock: false, selected: true, selectable: true, isPrime: false, image: null, url: `${B}/dp/B0FB2WX15J` },
    ],
  };

  test("cart summary — guest, after add", () => {
    const md = cartSummary(cart, { added: "B0FB2WX15J", hint: "sign in" });
    expect(md).toStartWith("✅ Added **BEILUNER Gold Fountain Pen** to the agent's guest cart.");
    expect(md).toContain("**Cart** · 3 items · subtotal **$76.99** — [open cart](https://www.amazon.com/gp/cart/view.html)");
    expect(md).toContain("- 2 × [Sailor Fountain Pen](https://www.amazon.com/dp/B07VQS7SSC) — $13.50");
    expect(md).toEndWith("_sign in_");
  });

  test("cart summary — account mode says 'your Amazon cart' and drops the hint", () => {
    const md = cartSummary({ ...cart, mode: "account" }, { added: "B07VQS7SSC", hint: "sign in" });
    expect(md).toContain("to your Amazon cart.");
    expect(md).not.toContain("sign in");
  });

  test("cart summary — unchecked items are flagged and the subtotal is qualified", () => {
    const md = cartSummary({ ...cart, items: [cart.items[0]!, { ...cart.items[1]!, selected: false }] });
    expect(md).toContain("subtotal **$76.99** (checked items)");
    expect(md).toMatch(/BEILUNER.*_unchecked_/);
    expect(md).not.toMatch(/Sailor.*_unchecked_/);
  });

  test("status", () => {
    expect(statusText({ mode: "guest", signedInAs: null, signedInAt: null, lastUsed: null, sessionFile: null, cartItems: 0, signInValid: null, pendingSignIn: null, lastSignInError: null })).toContain("Not signed in");
    expect(statusText({ mode: "account", signedInAs: "Alex", signedInAt: null, lastUsed: null, sessionFile: null, cartItems: 0, signInValid: null, pendingSignIn: null, lastSignInError: null })).toContain("as **Alex**");
    const expired = statusText({ mode: "account", signedInAs: "Alex", signedInAt: null, lastUsed: null, sessionFile: null, cartItems: 0, signInValid: false, pendingSignIn: null, lastSignInError: null });
    expect(expired).toStartWith("⚠️ The Amazon sign-in for **Alex** has expired.");
  });
});
