import type { ReviewBundle } from "./review-report";

export async function digestReviewBundle(bundle: ReviewBundle): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(bundle));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
