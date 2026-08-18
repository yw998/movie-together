# English interface release checklist

The English interface stays hidden unless `VITE_ENABLE_ENGLISH_UI=true`.
Before enabling it in production, review these flows once in both `zh-CN` and
`en-US`, on mobile and desktop:

- Schedule dates, cinema filters, search, time groups, empty and stale states.
- Film descriptions, official event notes, and localized `Special Event` labels.
- Personal-account registration, sign-in, recovery, password change, and summary.
- Film Fam creation, joining, invitations, member management, Organizer transfer,
  leaving, and deletion.
- Film Fam profile creation, credentials, sign-in, upgrade, and account merge.
- Want-to-watch marking, sharing, editing, removal, and destructive confirmations.
- Notifications, unread state, invitation acceptance, and every async error state.
- State and scroll preservation while switching language; `<html lang>`, title,
  and meta description updates.
- Current-window films have English descriptions or intentionally hide the
  missing copy; description failures do not block schedule publication.

The static catalog receives this one-time review before release. Afterward, new
or changed user-facing keys are reviewed in their pull request; no daily manual
translation review is required. Daily bilingual description generation remains
automated and nonblocking.
