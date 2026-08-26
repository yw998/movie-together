import type { Showing } from "../types/schedule";

type ShowingLink = Pick<Showing, "detailUrl" | "ticketUrl">;
type ShowingEvent = Pick<Showing, "eventNote" | "eventType">;

export function officialShowingUrl(showing: ShowingLink): string {
  return showing.ticketUrl ?? showing.detailUrl;
}

export function visibleShowingEventNote(showing: ShowingEvent): string | null {
  const note = showing.eventNote?.trim() ?? "";
  if (!note || /^sold\s*out!?$/i.test(note)) return null;
  return note;
}

export function showSpecialEventLabel(showing: ShowingEvent): boolean {
  return showing.eventType === "other" && visibleShowingEventNote(showing) !== null;
}
