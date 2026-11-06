import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AmazonClient } from "../src/client.ts";
import { parseOrders, parseTracking } from "../src/orders.ts";

const fx = (f: string) => Bun.file(new URL(`./fixtures/${f}`, import.meta.url)).text();
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const accountFile = () => {
  const f = join(mkdtempSync(join(tmpdir(), "amz-ow-")), "s.json");
  writeFileSync(f, JSON.stringify({ cookies: { "session-id": "s", "at-main": "tok" }, lastUsed: Date.now() }));
  return f;
};

describe("orders", () => {
  test("reads order cards", async () => {
    const o = parseOrders(await fx("orders.html"));
    expect(o).toHaveLength(2);
    expect(o[0]).toMatchObject({ orderId: "111-2223334-5556667", date: "November 4, 2026", totalText: "$11.02", total: 11.02, status: "Arriving tomorrow" });
    expect(o[0]!.items[0]).toMatchObject({ asin: "B0TESTWASH", title: "Test Body Wash", url: "/dp/B0TESTWASH" });
    expect(o[0]!.trackHref).toBe("/progress-tracker/package?orderId=111-2223334-5556667&shipmentId=abc");
    expect(o[1]!.items[0]!.asin).toBe("B001GAOTSW");
    expect(o[1]!.trackHref).toBeNull();
  });

  test("tracking progress follows the main status", async () => {
    const t = parseTracking(await fx("tracking.html"));
    expect(t.promise).toBe("Arriving tomorrow");
    expect(t.milestones.map((m) => m.done)).toEqual([true, true, false, false]);
    expect(t.trackingId).toBe("TBA000000000000");
  });

  test("track(): finds the order's tracking page", async () => {
    const [orders, tracking] = [await fx("orders.html"), await fx("tracking.html")];
    globalThis.fetch = (async (url: string) => new Response(url.includes("progress-tracker") ? tracking : orders, { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    const r = await new AmazonClient({ sessionFile: accountFile(), minIntervalMs: 0 }).track("111-2223334-5556667");
    expect(r.tracking?.milestones[1]).toEqual({ label: "Shipped", done: true });
  });

  test("orders need a signed-in account", async () => {
    const f = join(mkdtempSync(join(tmpdir(), "amz-ow-")), "g.json");
    await expect(new AmazonClient({ sessionFile: f, minIntervalMs: 0 }).orders()).rejects.toThrow(/own Amazon account/);
  });
});

describe("price watch", () => {
  const productPage = async (price: string) => (await fx("product.html")).replace("Hello, sign in", "Hello, Test").replaceAll("$49.99", price);

  test("watch → check reports a hit at or below the target, tracks the lowest price", async () => {
    let price = "$49.99";
    globalThis.fetch = (async () => new Response(await productPage(price), { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    const c = new AmazonClient({ sessionFile: accountFile(), minIntervalMs: 0 });
    await c.watch("B0FB2WX15J", 45);
    expect(c.watchlist[0]).toMatchObject({ asin: "B0FB2WX15J", below: 45, lastPrice: 49.99 });
    expect((await c.checkWatches()).hits).toHaveLength(0);
    price = "$44.00";
    const r = await c.checkWatches();
    expect(r.hits.map((w) => w.lastPrice)).toEqual([44]);
    price = "$47.00";
    await c.checkWatches();
    expect(c.watchlist[0]).toMatchObject({ lastPrice: 47, lowestPrice: 44 });
  });

  test("the watchlist survives a restart and unwatch removes", async () => {
    globalThis.fetch = (async () => new Response(await productPage("$49.99"), { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    const f = accountFile();
    await new AmazonClient({ sessionFile: f, minIntervalMs: 0 }).watch("B0FB2WX15J", 40);
    const again = new AmazonClient({ sessionFile: f, minIntervalMs: 0 });
    expect(again.watchlist.map((w) => w.asin)).toEqual(["B0FB2WX15J"]);
    again.unwatch("B0FB2WX15J");
    expect(new AmazonClient({ sessionFile: f, minIntervalMs: 0 }).watchlist).toHaveLength(0);
  });
});
