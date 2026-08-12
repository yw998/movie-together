export const OPEN_ACCOUNT_EVENT = "movie-together:open-account";
export const OPEN_CHANNEL_CREATE_EVENT = "movie-together:open-channel-create";

export function requestAccountDialog() {
  window.dispatchEvent(new Event(OPEN_ACCOUNT_EVENT));
}

export function requestChannelCreateDialog() {
  window.dispatchEvent(new Event(OPEN_CHANNEL_CREATE_EVENT));
}
