import type { Showing } from "../types/schedule";

export function availabilityLabel(availability: Showing["availability"]): string | null {
  if (availability === "sold_out") return "已售罄";
  return null;
}
