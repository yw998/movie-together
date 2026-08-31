# Unified account model

Status: accepted for implementation on 2026-08-30. This document is canonical
for authentication, user identity, Film Fams, invitations, and mark sharing.

## Identity and authentication

- One global account represents one person. A Film Fam is a resource, never a
  second identity.
- Registration and login use only an immutable public username and password.
  The product does not collect or display an email address.
- Supabase Auth uses a random, non-deliverable internal identifier for each
  account. It is not derived from the username, preventing direct Auth calls
  from bypassing the username endpoint's rate limits.
- Usernames are globally unique without regard to case, normalized to lowercase,
  and contain 3â€“24 lowercase letters, digits, or underscores. A deleted username
  is permanently reserved.
- Passwords contain at least six characters. The server rejects common
  compromised passwords and obvious username/repeated-character values.
- Authentication errors do not reveal whether a username exists. IP and account
  attempt limits apply. Turnstile appears only after suspicious activity.
- Sessions persist until logout. Password changes, recovery, and recovery-code
  rotation revoke other sessions.

## Recovery and deletion

- Signup displays a random human-readable recovery code once, with copy and
  download actions. The server retains only a slow salted hash.
- Recovery requires username, current recovery code, and a new password. A
  successful recovery rotates the code; an old code cannot be reused.
- There is no administrator or email recovery path.
- Account deletion requires manually typing the username and current password.
  An owner must transfer or delete every owned Film Fam first. Deletion removes
  the profile, marks, memberships, and shares while tombstoning the username.

## Film Fams

- A signed-in account may create or join multiple private Film Fams. Roles are
  Organizer and Member.
- Only the Organizer may rename or delete the group, remove members, manage
  invitation links, or transfer the Organizer role to a current member.
- A Member may leave. Leaving/removal deletes group shares but retains private
  personal marks.
- Joining is available only through a cryptographically random invitation link.
  The token is stored as a hash, remains valid until revoked or replaced, and is
  never used as an identity credential. Preview shows the group name and current
  member count. Login/registration is followed by an explicit join confirmation.
- Copying an invitation places a localized two-line message on the clipboard:
  `@username` invites the recipient to join the named Film Fam, followed by the
  invitation URL on its own line.
- Direct email invitations, Friend IDs, public group IDs, guest accounts, and
  Channel-only identities do not exist.

## Marks and sharing

- The public seven-day schedule remains browseable without an account.
- A homepage `Want to watch` action creates a private personal mark and never
  opens a share prompt automatically.
- Sharing is a separate explicit action that selects one or more Film Fams.
  Per-group auto-share settings do not exist.
- Inside a Film Fam, `Me too` creates the member's personal mark when needed and
  explicitly shares it to the current Film Fam. Removing a group share retains
  the personal mark; deleting the personal mark removes all derived shares.

## Cutover and legacy data

- Cutover is atomic from the product's perspective: pause account/group writes,
  create an encrypted rollback backup, apply the schema migration, replace real
  Auth emails with internal non-deliverable identifiers, revoke existing refresh
  sessions, deploy both Edge Functions and frontend, verify, wait out the maximum
  lifetime of already-issued access tokens, then resume writes.
- Existing formal accounts keep usernames, passwords, marks, memberships, and
  groups. Real Auth emails exist only in an encrypted rollback backup retained
  for no more than 30 days.
- Every test Channel-only identity is deleted. Groups owned by such identities
  are deleted; those identities are removed from account-owned groups.
- No compatibility login or dual identity system remains after cutover.
