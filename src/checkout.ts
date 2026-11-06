// Reading Amazon's "Place Your Order" page (SPC). Only facts the user needs to confirm an order:
// who/where it ships to, the payment method as Amazon labels it (brand + last 4), the totals, and the
// place-order form. Card numbers never appear on this page and are never stored.
import { parse } from "node-html-parser";
import { money } from "./parse.ts";

export interface OrderPage {
  recipient: string | null;
  address: string | null;
  /** e.g. "Visa 0327" — Amazon's own label for the selected card. */
  payment: string | null;
  delivery: string | null;
  lines: { label: string; amount: string }[];
  total: number | null;
  totalText: string | null;
  /** Relative path of the place-order form, e.g. /checkout/p/p-…/spc/place-order?… */
  placeAction: string | null;
  /** All fields of the place-order form, including the CSRF token. */
  placeFields: URLSearchParams;
}

const clean = (s: string | undefined | null) => (s ?? "").replace(/\s+/g, " ").trim();

export function parseOrderPage(html: string): OrderPage {
  const d = parse(html);
  const recipient = clean(d.querySelector("#deliver-to-customer-text")?.text).replace(/^Delivering to\s*/i, "") || null;
  const address = clean(d.querySelector("#deliver-to-address-text")?.text) || null;
  const payment = clean(d.querySelector("#payment-option-text-default")?.text).replace(/^Paying with\s*/i, "") || null;

  const table = d.querySelector("#subtotals-marketplace-table");
  const lines: { label: string; amount: string }[] = [];
  for (const row of table?.querySelectorAll("tr, li, .order-summary-line-item, [class*=line]") ?? []) {
    const m = clean(row.text).match(/^(.+?):\s*(-?\$[\d,]+\.\d{2})$/);
    if (m && !lines.some((l) => l.label === m[1])) lines.push({ label: m[1]!, amount: m[2]! });
  }
  if (!lines.length && table) {
    for (const m of clean(table.text).matchAll(/([A-Z][^:$]*?):\s*(-?\$[\d,]+\.\d{2})/g)) lines.push({ label: m[1]!.trim(), amount: m[2]! });
  }
  const totalLine = lines.find((l) => /order total/i.test(l.label));
  const totalText = totalLine?.amount ?? (clean(d.querySelector("#checkout-pyo-button-block")?.text).match(/Order total:\s*(\$[\d,]+\.\d{2})/)?.[1] ?? null);

  const delivery =
    clean(d.querySelector("#delivery-message-rush, .delivery-information, [id^=delivery-message]")?.text).slice(0, 120) ||
    (clean(d.text).match(/Arriving [A-Z][a-z]+[^.]{0,40}/)?.[0] ?? null);

  const form = d.querySelector("form#spc-form");
  const placeFields = new URLSearchParams();
  for (const i of form?.querySelectorAll("input") ?? []) {
    const n = i.getAttribute("name");
    if (n && !placeFields.has(n)) placeFields.append(n, i.getAttribute("value") ?? (n === "placeYourOrder1" ? "1" : ""));
  }
  if (form && !placeFields.get("placeYourOrder1")) placeFields.set("placeYourOrder1", "1");

  return {
    recipient,
    address,
    payment,
    delivery: delivery || null,
    lines: lines.filter((l) => !/order total/i.test(l.label)),
    total: money(totalText),
    totalText,
    placeAction: form?.getAttribute("action") ?? null,
    placeFields,
  };
}

/** The confirmation page after placing an order: order number when Amazon shows one. */
export function parseOrderPlaced(html: string): { placed: boolean; orderId: string | null; message: string | null } {
  const text = clean(parse(html).text);
  const placed = /order placed|thank you,? your order has been placed|thanks for your order/i.test(text);
  const orderId = text.match(/\b\d{3}-\d{7}-\d{7}\b/)?.[0] ?? null;
  const message = placed ? null : (text.match(/(There (was|is) a problem[^.]*\.|[^.]{0,80}(declined|verify|re-?enter)[^.]{0,80}\.)/i)?.[0] ?? null);
  return { placed, orderId, message };
}
