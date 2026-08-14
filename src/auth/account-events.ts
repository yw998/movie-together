export const OPEN_ACCOUNT_EVENT = "movie-together:open-account";
export const OPEN_CHANNEL_CREATE_EVENT = "movie-together:open-channel-create";
export const OPEN_GROUP_PANEL_EVENT = "movie-together:open-group-panel";
export const OPEN_REGISTERED_GROUP_CREATE_EVENT = "movie-together:open-registered-group-create";

export function requestAccountDialog() {
  window.dispatchEvent(new Event(OPEN_ACCOUNT_EVENT));
}

export function requestChannelCreateDialog() {
  window.dispatchEvent(new Event(OPEN_CHANNEL_CREATE_EVENT));
}

export function requestGroupPanel() {
  window.dispatchEvent(new Event(OPEN_GROUP_PANEL_EVENT));
}

export function requestRegisteredGroupCreate() {
  window.dispatchEvent(new Event(OPEN_REGISTERED_GROUP_CREATE_EVENT));
}
