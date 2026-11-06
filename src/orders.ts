// Your Orders (read-only): order history cards and the package tracking page.
import { parse, type HTMLElement } from "node-html-parser";
import { money } from "./parse.ts";

export interface OrderItem {
  asin: string | null;
  title: string;
  image: string | null;
  url: string | null;
}

export interface OrderSummary {
  orderId: string | null;
  date: string | null;
  totalText: string | null;
  total: number | null;
  /** e.g. "Arriving tomorrow", "Delivered November 3". */
  status: string | null;
  items: OrderItem[];
  /** Relative link to the tracking page, when Amazon offers one. */
  trackHref: string | null;
}

export interface Tracking {
  promise: string | null;
  status: string | null;
  milestones: { label: string; done: boolean }[];
  trackingId: string | null;
}

const clean = (s: string | undefined | null) => (s ?? "").replace(/\s+/g, " ").trim();
const asinOf = (href: string | undefined | null) => href?.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/)?.[1] ?? null;

function headerValue(card: HTMLElement, label: RegExp): string | null {
  for (const li of card.querySelectorAll(".order-header__header-list-item")) {
    const t = clean(li.text);
    if (label.test(t)) return t.replace(label, "").trim() || null;
  }
  return null;
}

export function parseOrders(html: string): OrderSummary[] {
  const doc = parse(html);
  return doc.querySelectorAll(".order-card").map((card) => {
    const totalText = headerValue(card, /^Total\s*/i);
    const items = card.querySelectorAll(".item-box").map((it) => {
      const a = it.querySelector(".yohtmlc-product-title a, a[href*='/dp/'], a[href*='/gp/product/']");
      const href = a?.getAttribute("href") ?? null;
      return {
        asin: asinOf(href),
        title: clean(it.querySelector(".yohtmlc-product-title")?.text) || clean(a?.text),
        image: it.querySelector("img")?.getAttribute("src") ?? null,
        url: href ? href.split("?")[0]! : null,
      };
    }).filter((i) => i.title);
    const track = card.querySelector("a[href*='progress-tracker'], a[href*='ship-track']");
    return {
      orderId: clean(card.querySelector(".yohtmlc-order-id")?.text).match(/\d{3}-\d{7}-\d{7}/)?.[0] ?? null,
      date: headerValue(card, /^Order placed\s*/i),
      totalText,
      total: money(totalText),
      status: clean(card.querySelector(".delivery-box__primary-text, .yohtmlc-shipment-status-primaryText")?.text) || null,
      items,
      trackHref: track?.getAttribute("href")?.replace(/&amp;/g, "&") ?? null,
    };
  });
}

export function parseTracking(html: string): Tracking {
  const doc = parse(html);
  const status = clean(doc.querySelector(".pt-status-main-status")?.text) || null;
  // The page's progress bar is drawn by script; the main status tells which step we're on.
  const labels = doc.querySelectorAll(".pt-status-milestone").map((m) => clean(m.querySelector(".pt-status-milestone-label")?.text) || clean(m.text)).filter(Boolean);
  const at = status ? labels.findIndex((l) => l.toLowerCase() === status.toLowerCase()) : -1;
  const milestones = labels.map((label, i) => ({ label, done: at >= 0 && i <= at }));
  return {
    promise: clean(doc.querySelector(".pt-promise-main-slot")?.text) || null,
    status,
    milestones,
    trackingId: clean(doc.querySelector(".pt-delivery-card-trackingId")?.text).replace(/^Tracking ID:\s*/i, "") || null,
  };
}
