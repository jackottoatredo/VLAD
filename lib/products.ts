export type Product = {
  /** Human-readable display label (e.g., "Returns & Claims"). */
  label: string;
  /** URL-safe identifier used in render URLs and stored on vlad_renders.product_name. */
  safe: string;
};

export const PRODUCTS: readonly Product[] = [
  { label: "Returns & Claims", safe: "returns-claims" },
  { label: "Chargebacks", safe: "chargebacks" },
  { label: "Recover", safe: "recover" },
  { label: "Checkout Optimization", safe: "checkout-optimization" },
  { label: "Email & SMS", safe: "email-sms" },
  { label: "Order Editing", safe: "order-editing" },
  { label: "Shipping & Fulfillment", safe: "shipping-fulfillment" },
  { label: "Order Tracking", safe: "order-tracking" },
  { label: "AI Sales Support", safe: "ai-sales-support" },
  { label: "Warranties", safe: "warranties" },
  { label: "Inventory Management", safe: "inventory-management" },
  { label: "Agentic Catalog", safe: "agentic-catalog" },
] as const;

/** Look up a product's display label by its safe identifier; null if not found. */
export function findProductLabel(safe: string): string | null {
  return PRODUCTS.find((p) => p.safe === safe)?.label ?? null;
}
