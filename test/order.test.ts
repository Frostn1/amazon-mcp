// Ordering safety: the order is placed only through the one-time code the card holds, with the exact
// total, unchanged items and accepted terms. All Amazon traffic here is mocked (fake fixture data).
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AmazonClient } from "../src/client.ts";
import { parseOrderPage, parseOrderPlaced } from "../src/checkout.ts";
import { checkoutAllowed } from "../src/http.ts";
import { buyWithConfirmation, confirmationSchema, type AskUser } from "../src/buy.ts";

const fx = (f: string) => Bun.file(new URL(`./fixtures/${f}`, import.meta.url)).text();
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("purchase guard exceptions", () => {
  const base = "https://www.amazon.com";
  test("read: GET order pages and the confirmation page only", () => {
    expect(checkoutAllowed(`${base}/checkout/entry/cart?proceedToCheckout=1`, { checkout: "read" })).toBe(true);
    expect(checkoutAllowed(`${base}/checkout/p/p-1/spc`, { checkout: "read", method: "GET" })).toBe(true);
    expect(checkoutAllowed(`${base}/gp/buy/thankyou/handlers/display.html`, { checkout: "read" })).toBe(true);
    expect(checkoutAllowed(`${base}/checkout/p/p-1/spc/place-order`, { checkout: "read" })).toBe(false);
    expect(checkoutAllowed(`${base}/checkout/p/p-1/spc`, { checkout: "read", method: "POST" })).toBe(false);
  });
  test("place: only a POST to …/spc/place-order", () => {
    expect(checkoutAllowed(`${base}/checkout/p/p-106-1/spc/place-order?x=1`, { checkout: "place", method: "POST" })).toBe(true);
    expect(checkoutAllowed(`${base}/checkout/p/p-106-1/spc/place-order`, { checkout: "place", method: "GET" })).toBe(false);
    expect(checkoutAllowed(`${base}/gp/buy/spc/handlers/static-submit-decoupled.html`, { checkout: "place", method: "POST" })).toBe(false);
  });
  test("no mode: everything checkout-like is refused", () => {
    expect(checkoutAllowed(`${base}/checkout/entry/cart`, {})).toBe(false);
  });
});

describe("order page", () => {
  test("reads address, card, totals and the place-order form", async () => {
    const o = parseOrderPage(await fx("order-page.html"));
    expect(o).toMatchObject({ recipient: "Test Buyer", payment: "Visa 1111", totalText: "$15.87", total: 15.87 });
    expect(o.address).toContain("SPRINGFIELD");
    expect(o.lines.map((l) => l.label)).toEqual(["Items (1)", "Shipping & handling", "Free Shipping", "Estimated tax to be collected"]);
    expect(o.placeAction).toStartWith("/checkout/p/p-000-0000000-0000000/spc/place-order");
    expect(o.placeFields.get("anti-csrftoken-a2z")).toBe("csrf-test-token");
    expect(o.placeFields.get("placeYourOrder1")).toBeTruthy();
  });
  test("confirmation page", () => {
    expect(parseOrderPlaced("<h1>Order placed, thanks!</h1> Order # 111-2223334-5556667")).toEqual({ placed: true, orderId: "111-2223334-5556667", message: null });
    expect(parseOrderPlaced("<p>There was a problem with your payment method.</p>").placed).toBe(false);
  });
});

/** A signed-in client whose Amazon is mocked: cart (1 ticked item), order page, confirmation. */
async function setup({ termsAccepted = true, totalOnSecondLoad = "$15.87" } = {}) {
  const cart = (await fx("cart.html")).replace('data-itemtype="active"', 'data-itemtype="active" data-isSelected="1"').replace("Hello, sign in", "Hello, Test");
  const order = await fx("order-page.html");
  const dir = mkdtempSync(join(tmpdir(), "amz-order-"));
  const f = join(dir, "s.json");
  writeFileSync(f, JSON.stringify({ cookies: { "session-id": "s", "at-main": "tok" }, lastUsed: Date.now(), termsAcceptedAt: termsAccepted ? "2026-11-05T00:00:00Z" : null }));
  const calls: { method: string; url: string }[] = [];
  let orderLoads = 0;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    calls.push({ method, url });
    const html = (b: string) => new Response(b, { headers: { "content-type": "text/html" } });
    if (url.includes("/spc/place-order")) return html("<h1>Order placed, thanks!</h1> Order # 111-2223334-5556667");
    if (url.includes("/checkout/")) return html(++orderLoads > 1 ? order.replaceAll("$15.87", totalOnSecondLoad) : order);
    return html(cart);
  }) as unknown as typeof fetch;
  const client = new AmazonClient({ sessionFile: f, minIntervalMs: 0 });
  return { client, calls, placed: () => calls.filter((c) => c.method === "POST" && c.url.includes("place-order")).length };
}

describe("placeOrder", () => {
  test("happy path: preview → place with the code and exact total → one place-order POST", async () => {
    const { client, placed } = await setup();
    const p = await client.previewOrder();
    expect(p.token).toMatch(/^[0-9a-f]{32}$/);
    expect(p.totalText).toBe("$15.87");
    const r = await client.placeOrder(p.token, "$15.87");
    expect(r.orderId).toBe("111-2223334-5556667");
    expect(placed()).toBe(1);
  });

  test("the code works once", async () => {
    const { client, placed } = await setup();
    const p = await client.previewOrder();
    await client.placeOrder(p.token, "$15.87");
    await expect(client.placeOrder(p.token, "$15.87")).rejects.toThrow(/expired or was already used/);
    expect(placed()).toBe(1);
  });

  test("a made-up code is refused before anything is sent", async () => {
    const { client, placed } = await setup();
    await expect(client.placeOrder("0".repeat(32), "$15.87")).rejects.toThrow(/expired or was already used/);
    expect(placed()).toBe(0);
  });

  test("a different total than shown is refused", async () => {
    const { client, placed } = await setup();
    const p = await client.previewOrder();
    await expect(client.placeOrder(p.token, "$1.00")).rejects.toThrow(/doesn't match/);
    expect(placed()).toBe(0);
  });

  test("if Amazon's total changed since the preview, nothing is ordered", async () => {
    const { client, placed } = await setup({ totalOnSecondLoad: "$19.99" });
    const p = await client.previewOrder();
    await expect(client.placeOrder(p.token, "$15.87")).rejects.toThrow(/total is now \$19\.99/);
    expect(placed()).toBe(0);
  });

  test("terms must be accepted first, and only with the card's code", async () => {
    const { client, placed } = await setup({ termsAccepted: false });
    const p = await client.previewOrder();
    expect(p.termsAccepted).toBe(false);
    expect(() => client.acceptTerms("f".repeat(32))).toThrow();
    expect(client.termsAccepted).toBe(false);
    await expect(client.placeOrder(p.token, "$15.87")).rejects.toThrow(/terms/);
    expect(placed()).toBe(0);
    const p2 = await client.previewOrder();
    client.acceptTerms(p2.token);
    expect(client.termsAccepted).toBe(true);
  });
});

describe("buy with the app's confirmation dialog", () => {
  const answer = (action: "accept" | "decline" | "cancel", content?: Record<string, unknown>): AskUser => async () => ({ action, content });

  test("accept with the box ticked → one order", async () => {
    const { client, placed } = await setup();
    let shown = "";
    const out = await buyWithConfirmation(client, async (msg, schema) => ((shown = msg), { action: "accept", content: { confirm: true } }));
    expect(out.placed).toBe(true);
    expect(placed()).toBe(1);
    expect(shown).toContain("Buy on Amazon for $15.87?");
    expect(shown).toContain("Visa 1111");
    expect(shown).toContain("Test Buyer");
  });

  test("decline / cancel → nothing ordered", async () => {
    for (const a of ["decline", "cancel"] as const) {
      const { client, placed } = await setup();
      const out = await buyWithConfirmation(client, answer(a));
      expect(out.placed).toBe(false);
      expect(placed()).toBe(0);
    }
  });

  test("accept without ticking 'Place this order' → nothing ordered", async () => {
    const { client, placed } = await setup();
    const out = await buyWithConfirmation(client, answer("accept", { confirm: false }));
    expect(out).toMatchObject({ placed: false });
    expect(placed()).toBe(0);
  });

  test("first order asks for the terms too; without them nothing is ordered", async () => {
    const { client, placed } = await setup({ termsAccepted: false });
    let schemaSeen: unknown;
    const out = await buyWithConfirmation(client, async (_m, schema) => ((schemaSeen = schema), { action: "accept", content: { confirm: true } }));
    expect(schemaSeen).toEqual(confirmationSchema(true));
    expect(out).toMatchObject({ placed: false });
    expect(placed()).toBe(0);
    expect(client.termsAccepted).toBe(false);
  });

  test("first order with terms ticked → terms recorded and order placed", async () => {
    const { client, placed } = await setup({ termsAccepted: false });
    const out = await buyWithConfirmation(client, answer("accept", { confirm: true, agreeTerms: true }));
    expect(out.placed).toBe(true);
    expect(client.termsAccepted).toBe(true);
    expect(placed()).toBe(1);
  });

  test("Amazon's total changing between dialog and order → nothing ordered", async () => {
    const { client, placed } = await setup({ totalOnSecondLoad: "$19.99" });
    await expect(buyWithConfirmation(client, answer("accept", { confirm: true }))).rejects.toThrow(/total is now/);
    expect(placed()).toBe(0);
  });
});

describe("confirmation code (apps that can't show the dialog)", () => {
  test("no dialog support → a 6-digit code for the card, nothing ordered yet", async () => {
    const { client, placed } = await setup();
    const out = await buyWithConfirmation(client, null);
    expect(out).toMatchObject({ placed: false, needsCode: true });
    expect((out as { code: string }).code).toMatch(/^\d{6}$/);
    expect(placed()).toBe(0);
  });

  test("an instant 'decline' is the app, not the user → code instead", async () => {
    const { client } = await setup();
    let t = 1000;
    const out = await buyWithConfirmation(client, async () => ((t += 50), { action: "decline" }), () => t);
    expect(out).toMatchObject({ needsCode: true });
  });

  test("a considered decline is respected", async () => {
    const { client, placed } = await setup();
    let t = 1000;
    const out = await buyWithConfirmation(client, async () => ((t += 4000), { action: "decline" }), () => t);
    expect(out).toMatchObject({ placed: false, reason: "You declined." });
    expect(placed()).toBe(0);
  });

  test("typing the right code places the order once", async () => {
    const { client, placed } = await setup();
    const out = (await buyWithConfirmation(client, null)) as { code: string };
    const r = await client.confirmWithCode(`confirm ${out.code}`);
    expect(r.orderId).toBe("111-2223334-5556667");
    expect(placed()).toBe(1);
    await expect(client.confirmWithCode(out.code)).rejects.toThrow(/No order is waiting/);
    expect(placed()).toBe(1);
  });

  test("wrong codes: 3 tries then the confirmation is cancelled", async () => {
    const { client, placed } = await setup();
    const out = (await buyWithConfirmation(client, null)) as { code: string };
    const wrong = out.code === "000000" ? "111111" : "000000";
    await expect(client.confirmWithCode(wrong)).rejects.toThrow(/try 1 of 3/);
    await expect(client.confirmWithCode(wrong)).rejects.toThrow(/try 2 of 3/);
    await expect(client.confirmWithCode(wrong)).rejects.toThrow(/cancelled/);
    await expect(client.confirmWithCode(out.code)).rejects.toThrow(/No order is waiting/);
    expect(placed()).toBe(0);
  });

  test("first order: typing the code also records the terms", async () => {
    const { client, placed } = await setup({ termsAccepted: false });
    const out = (await buyWithConfirmation(client, null)) as { code: string };
    await client.confirmWithCode(out.code);
    expect(client.termsAccepted).toBe(true);
    expect(placed()).toBe(1);
  });
});
