export const OPEN_ACCOUNT_EVENT = "movie-together:open-account";

export function requestAccountDialog() {
  window.dispatchEvent(new Event(OPEN_ACCOUNT_EVENT));
}
