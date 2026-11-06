// "Claude, buy it": the model asks, the USER confirms in a native confirmation dialog from the app
// (MCP elicitation), and only then is the order placed. The model can trigger the dialog but can't
// answer it, so text in a chat or on a web page can't buy anything.
import type { AmazonClient, OrderPreview, OrderResult } from "./client.ts";

export interface ConfirmAnswer {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
}
/** Shows the confirmation to the user (MCP elicitation) and returns their answer. */
export type AskUser = (message: string, schema: ConfirmSchema) => Promise<ConfirmAnswer>;

export interface ConfirmSchema {
  type: "object";
  properties: Record<string, { type: "boolean"; title: string; description?: string; default?: boolean }>;
  required: string[];
}

export type BuyOutcome =
  | { placed: true; order: OrderResult }
  | { placed: false; reason: string; preview: Omit<OrderPreview, "token"> }
  /** The app couldn't really show the dialog: the user confirms with a code shown only in the card. */
  | { placed: false; needsCode: true; code: string; preview: Omit<OrderPreview, "token"> };

/** A decline faster than this came from the app, not a person (some apps auto-decline dialogs they can't show). */
export const AUTO_DECLINE_MS = 1500;

const shortAddress = (a: string | null) => (a ? a.split(",").slice(-4, -2).join(",").trim() || a : "?");

export function confirmationText(o: Omit<OrderPreview, "token">): string {
  const items = o.items.map((i) => `• ${i.quantity} × ${i.title.length > 70 ? i.title.slice(0, 69) + "…" : i.title}`).join("\n");
  return [
    `Buy on Amazon for ${o.totalText}?`,
    "",
    items,
    "",
    `Ship to: ${o.recipient ?? "?"} (${shortAddress(o.address)})`,
    `Pay with: ${o.payment ?? "?"}`,
    ...(o.delivery ? [`Delivery: ${o.delivery}`] : []),
    "",
    "This places a real order with your saved card. Cancel later in Amazon → Your Orders.",
  ].join("\n");
}

export function confirmationSchema(needTerms: boolean): ConfirmSchema {
  const properties: ConfirmSchema["properties"] = {
    confirm: { type: "boolean", title: "Place this order", description: "Tick to buy now", default: false },
  };
  if (needTerms) {
    properties.agreeTerms = {
      type: "boolean",
      title: "I agree to the ordering terms",
      description: "I place every order myself; Amazon's terms apply; not affiliated with Amazon; no warranty (TERMS.md).",
      default: false,
    };
  }
  return { type: "object", properties, required: Object.keys(properties) };
}

/**
 * Preview the ticked items' order, ask the user to confirm, and place it only on an explicit
 * accept with the box ticked (and the terms ticked the first time).
 */
export async function buyWithConfirmation(client: AmazonClient, ask: AskUser | null, now: () => number = Date.now): Promise<BuyOutcome> {
  const { token, ...preview } = await client.previewOrder();
  const needTerms = !preview.termsAccepted;
  const viaCode = (): BuyOutcome => ({ placed: false, needsCode: true, code: client.issueConfirmationCode(token, preview.totalText!, needTerms), preview });
  if (!ask) return viaCode();
  const started = now();
  let answer: ConfirmAnswer;
  try {
    answer = await ask(confirmationText(preview), confirmationSchema(needTerms));
  } catch {
    return viaCode(); // the app rejected the dialog request
  }
  const c = answer.content ?? {};
  if (answer.action !== "accept") {
    if (now() - started < AUTO_DECLINE_MS) return viaCode(); // nobody could have read it that fast
    return { placed: false, reason: answer.action === "decline" ? "You declined." : "Cancelled.", preview };
  }
  if (c.confirm !== true) return { placed: false, reason: "The “Place this order” box wasn't ticked.", preview };
  if (needTerms && c.agreeTerms !== true) return { placed: false, reason: "The ordering terms weren't accepted.", preview };
  if (needTerms) client.acceptTerms(token);
  const order = await client.placeOrder(token, preview.totalText!);
  return { placed: true, order };
}
