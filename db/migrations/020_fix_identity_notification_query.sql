-- Session authentication refreshes identity activity timestamps, so this
-- notification query cannot be declared STABLE.
alter function public.list_channel_identity_notifications(text) volatile;
