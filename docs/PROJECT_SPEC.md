# NYC Movie Together — Project Specification

## 0. Document purpose

This document defines the **current product requirements, system boundaries, data rules, and accepted product decisions** for NYC Movie Together.

It describes what the product **should be**, not a chronological history of how it was implemented.

Implementation progress belongs in `docs/STATUS.md`.

Historical or superseded product decisions belong in `docs/DECISIONS.md`.

When implementation and this specification disagree:

1. Do not silently rewrite working behavior.
2. Determine whether the implementation or specification is outdated.
3. Surface the discrepancy when it materially affects the requested task.
4. Update this specification only when the accepted product behavior or architecture changes.

---

# 1. Product overview

## 1.1 Product goal

NYC Movie Together is a public website that aggregates schedules from selected New York City repertory and arthouse cinemas.

The primary user question is:

> **“What should I see over the next seven days, where, and at what time?”**

The product should allow a user to quickly determine:

1. What films are showing.
2. Which cinema is showing them.
3. On which date and at what time.
4. Whether a screening has a meaningful format or special event.
5. Where to view the official cinema page or purchase a ticket.

The site is **not** intended to be a comprehensive commercial multiplex search engine.

Its value comes from:

* a curated cinema scope;
* reliable official-source schedules;
* clear chronological organization;
* concise localized descriptions;
* preservation of meaningful screening distinctions;
* lightweight planning and sharing features.

---

## 1.2 Product language

Supported interface languages:

* Simplified Chinese (`zh-CN`)
* US English (`en-US`)

The interface uses locale-neutral URLs and a global `中文 / EN` control. Language
selection precedence is: an explicit device choice, the signed-in account
preference, the browser language, then English. Switching language preserves the
current page, filters, dialogs, scroll position, and application state. The
English control remains behind `VITE_ENABLE_ENGLISH_UI` in production until the
bilingual release checklist is complete. Vercel Preview deployments enable it
automatically for acceptance testing.

Bilingual description backfill is operationally independent from schedule
publication. It may update only `films.description_zh`, `films.description_en`,
`films.description_source`, and the matching description fields in the public
JSON. It must not create, remove, or alter cinema or showing facts. The backfill
is manual so unresolved films do not consume AI requests every day. Manual runs
default to review-only artifact generation; database and public JSON writes
require the explicit `publish=true` input.

Film titles may retain their original-language titles.

Technical identifiers, source metadata, and internal application data do not need to be translated.

---

## 1.3 Timezone

All schedule logic uses:

```text
America/New_York
```

User-visible calendar dates must always correspond to the New York local date of the screening.

Localized date labels and time-of-day names are presentation data derived from
`localDate`; they are not stored as parallel Chinese and English schedule facts.

---

# 2. Cinema scope

## 2.1 Current supported cinemas

The current official cinema scope is:

1. Metrograph
2. Film Forum
3. IFC Center
4. Roxy Cinema New York
5. Paris Theater
6. Film at Lincoln Center
7. Syndicated Bar Theater Kitchen

Each cinema should have an independent ingestion adapter so that one cinema can change or fail without requiring the shared pipeline to be rewritten.

---

## 2.2 Potential future cinemas

Possible future additions include:

* BAM
* Museum of the Moving Image
* Anthology Film Archives
* Quad Cinema

These are not part of the current completion criteria unless explicitly promoted into scope.

---

# 3. Public schedule experience

## 3.1 Homepage date window

The public homepage displays a **rolling seven-day window**:

```text
New York today → New York today + 6 days
```

Example:

```text
Wednesday Aug 12 → Tuesday Aug 18
```

There is no public calendar-week switching interface in the current product.

Ingestion, review, approval, database import, and public export use the same
exact rolling seven-day window. Calendar-week grouping may be used only for
archive presentation; it must not control fetching, fallback, or publication.

The public export combines whatever approved internal weeks are necessary to produce the rolling seven-day window.

---

## 3.2 Homepage capabilities

The public schedule should provide:

* seven-day schedule display;
* date navigation;
* cinema multi-select filtering;
* film and cinema search;
* chronological ordering;
* time-of-day grouping;
* screening count where useful;
* short Chinese or English film descriptions selected by the active interface language;
* screening format and meaningful special-event information;
* official detail or ticket links;
* visible data refresh information;
* responsive desktop and mobile layouts.

---

## 3.3 Time-of-day groups

Default groups are:

| Group | Local start time |
| ----- | ---------------- |
| 上午    | 00:00–11:59      |
| 下午    | 12:00–16:59      |
| 晚间    | 17:00–20:59      |
| 深夜    | 21:00–23:59      |

These boundaries should remain configurable rather than being duplicated throughout the UI.

---

# 4. Film and showing semantics

## 4.1 Film versus showing

A `Film` represents the reusable film identity and descriptive metadata.

A `Showing` represents one specific screening of that film.

The same film may therefore have many showings.

---

## 4.2 Showing distinctions

Two screenings must not be incorrectly merged when they differ in any meaningful way, including:

* cinema;
* local date;
* start time;
* screening format;
* special event;
* access restriction;
* official performance identity;
* materially different ticket destination.

Examples of meaningful format or event distinctions include:

* 16mm
* 35mm
* 70mm
* DCP
* 4K DCP
* Q&A
* introduction
* members only
* open captions

## 4.3 Sold-out visibility

Sold-out showings remain part of the public schedule because the product supports
group planning rather than real-time ticket guidance.

When an official source explicitly marks a showing sold out, ingestion retains
that status with its fetch-time provenance. The public interface does not display
a sold-out label because the update frequency cannot guarantee that availability
remains current.

## 4.4 Non-film and interactive programs

Officially scheduled watch parties, interactive film parties, and similar timed
cinema programs are included. They retain the exact official program title and
available official explanation, and the public interface marks them uniformly as
`特别活动` or `Special Event` according to the active interface language. Official
event notes remain in their source language; program-added labels are localized
at render time.

---

# 5. Data trust model

Schedule accuracy is the highest-priority system requirement.

## 5.1 Official-source requirement

Published screening facts must come from:

1. an official cinema website;
2. an official cinema API;
3. an official cinema ticketing system linked to that cinema.

Non-official aggregators must not silently replace an official source when extraction fails.

---

## 5.2 No inference rule

Never invent or infer:

* film titles;
* screening dates;
* screening times;
* formats;
* event labels;
* guest appearances;
* ticket URLs;
* availability.

Do not infer one date from adjacent dates or fill missing values because they appear plausible.

Unknown information should remain unknown.

---

## 5.3 Provenance

Every published showing must be traceable to source evidence.

At minimum retain:

* `sourceUrl`
* `fetchedAt`
* extraction status
* stable showing identity where available

---

## 5.4 Uncertain extraction

If parsing is uncertain:

* do not silently publish the questionable fact;
* mark the record or cinema feed for review;
* preserve the previous approved public dataset when necessary.

A failed parser must never turn into:

```text
0 showings
```

unless the official source provides sufficient evidence that zero showings is correct.

---

## 5.5 Descriptions

Chinese and English film descriptions are separate from schedule facts.

AI-assisted descriptions are allowed when grounded in:

* official cinema copy; or
* another trusted film source.

Every non-empty generated description must retain its evidence URL.

Description generation must never modify:

* cinema;
* date;
* time;
* format;
* event metadata;
* availability;
* ticket URL.

One AI request generates Chinese and English copy together when both are missing.
Each language is validated and cached independently against one shared evidence
URL. A valid language is retained if the other fails; later runs request only the
missing language. Description evidence, generation, or validation failure never
blocks publication of otherwise valid schedule facts. The missing localized
description is hidden rather than replaced with copy from another language.

Manual AI generation uses bounded film batches with exact requested identifiers.
A malformed batch is retried one film at a time so one bad response cannot discard
unrelated valid descriptions. The review artifact reports attempted, accepted,
review-needed, retried, and technical-failure counts. A total technical generation
failure stops the manual backfill before import; daily schedule publication remains
cache-only and is never blocked by description generation.

Approved descriptions should be cached and reused rather than regenerated every schedule refresh.

When automatic description enrichment requests review, an editor may add a
version-controlled, evidence-backed entry to
`data/manual-description-overrides.json`. Each entry records the film ID and
title, at least one Chinese or English description, an official HTTPS source,
reason, and creation time.
The override is validated and then cached in durable storage after a successful
publication. This editorial escape hatch applies only to descriptions and must
never alter schedule facts.

For Syndicated Bar Theater Kitchen, the initial description workflow uses only
official Syndicated/Veezi copy. If official copy is absent, the Chinese
description remains empty; external film metadata is not used as a fallback.

---

# 6. Core data model

Exact TypeScript implementation may evolve, but the domain model should preserve the following concepts.

## 6.1 Cinema

```ts
type Cinema = {
  id: string;
  name: string;
  officialUrl: string;
  scheduleUrl: string;
  timezone: "America/New_York";
  enabled: boolean;
};
```

---

## 6.2 Film

```ts
type Film = {
  id: string;
  canonicalTitle: string;
  displayTitle: string;
  year: number | null;
  director: string | null;
  runtimeMinutes: number | null;

  descriptionZh: string | null;
  descriptionEn: string | null;
  descriptionSource: string | null;
};
```

---

## 6.3 Showing

```ts
type Showing = {
  id: string;

  // Exact DB window key paired with `id` for watch-mark writes.
  storageWindowStart: string;

  cinemaId: string;
  filmId: string;

  startsAt: string;
  localDate: string;
  localTime: string;

  format:
    | "16mm"
    | "35mm"
    | "70mm"
    | "DCP"
    | "4K DCP"
    | null;

  eventType:
    | "standard"
    | "qa"
    | "intro"
    | "members_only"
    | "open_caption"
    | "other";

  eventNote: string | null;

  detailUrl: string;
  ticketUrl: string | null;

  availability:
    | "available"
    | "sold_out"
    | "unknown";

  sourceUrl: string;
  fetchedAt: string;

  extractionStatus:
    | "verified"
    | "needs_review"
    | "manual";
};
```

---

## 6.4 Source snapshot

Each ingestion run should retain enough evidence to diagnose changes.

```ts
type SourceSnapshot = {
  cinemaId: string;
  fetchedAt: string;
  sourceUrl: string;

  contentHash: string;
  parserVersion: string;

  result:
    | "success"
    | "partial"
    | "failed";

  error: string | null;
};
```

Raw HTML may be retained temporarily outside public build artifacts for debugging.

It should not be exposed publicly or accumulated indefinitely without a retention policy.

---

# 7. System architecture

The intended data flow is:

```text
Official cinema sources
        ↓
Cinema-specific adapters
        ↓
Normalized candidate data
        ↓
Schema + business validation
        ↓
Review / anomaly detection
        ↓
Approval decision
        ↓
Durable database storage
        ↓
Validated public static export
        ↓
Frontend
```

The public export must include the exact durable database identity used by
interactive features. For a showing this is the composite
`(storageWindowStart, id)` key. Publication must fail if that parent row is
missing; the frontend must not reconstruct a storage key from `localDate`.

The ingestion system and public frontend must remain separated.

---

# 8. Cinema adapters

## 8.1 Adapter responsibility

Each cinema adapter should extract candidate facts from that cinema's official sources.

Adapters should not independently implement shared business rules.

Shared infrastructure handles:

* timezone normalization;
* date parsing;
* title normalization;
* deduplication;
* schema validation;
* format normalization;
* event classification;
* provenance;
* extraction status.

---

## 8.2 Source strategy priority

Prefer sources in this order:

1. official JSON/API or embedded structured data;
2. official server-rendered HTML;
3. official detail-page follow-up;
4. browser-rendered extraction;
5. version-controlled manual override.

Do not move to an unofficial aggregator simply because an official extraction strategy becomes inconvenient.

---

## 8.3 Failure isolation

One cinema's failure must not corrupt another cinema's data.

Every cinema ingestion result should independently resolve to:

```text
success
partial
failed
```

A `partial` or `failed` source should be visible in the review process.

## 8.4 Syndicated Bar Theater Kitchen

The Syndicated adapter uses the public Veezi schedule linked from the cinema's
official website. It treats the Veezi JSON-LD event array as canonical showing
data and joins the server-rendered film cards for stable film IDs, official copy,
sold-out evidence, and dated accessibility notes.

The adapter must validate the official theater identity, stable Veezi session
IDs, exact offset timestamps, tenant token, source host, and JSON-LD/HTML showing
counts. Missing or inconsistent evidence produces a `partial` or `failed` result
rather than an empty publishable feed. Projection format remains `null` unless
the official source explicitly supplies a screening format.

A dated accessibility note that is unambiguously outside the candidate window
is historical copy and may be ignored for that window. An in-window note that
does not match exactly one official session remains a parser warning and must
not be attached to a plausible showing.

The initial real-data source review was approved on August 14, 2026. Syndicated
may now participate in the normal candidate, review, and publication workflow.
That one-time source approval does not approve any future schedule candidate;
the normal publication safety rules continue to apply to every run.

---

# 9. Manual overrides

Manual corrections are permitted for:

* special events;
* temporary parser failures;
* unusual official-page structures.

Recommended location:

```text
data/manual-overrides/YYYY-MM-DD.json
```

Each override must include:

* cinema;
* affected showing or film;
* official source URL;
* reason;
* creation timestamp.

Overrides are temporary evidence-backed corrections.

They must not automatically roll forward indefinitely.

---

# 10. Validation rules

At minimum, automated validation should verify:

* `localDate` is inside the candidate publication window;
* `startsAt`, `localDate`, and `localTime` agree;
* the cinema exists in configuration;
* source URLs belong to allowed official domains;
* film titles are non-empty;
* placeholder titles are rejected;
* duplicate showing IDs are rejected;
* obvious duplicate facts are identified;
* legitimate format/event variants survive deduplication;
* zero-result parser failures are not interpreted as empty schedules;
* stale data is detected;
* suspicious cinema-level volume changes trigger review.

Volume anomaly thresholds are **review signals**, not factual conclusions.

---

# 11. Review and publication workflow

## 11.1 Daily ingestion

The schedule workflow runs daily at:

```text
05:00 America/New_York
```

It fetches the exact public rolling seven-day window once and imports the
approved result in one database transaction.

---

## 11.2 Review report

Before publication, generate a report containing at minimum:

* cinema ingestion status;
* number of showings;
* added showings;
* removed showings;
* changed factual fields;
* parser warnings;
* failed feeds;
* `needs_review` records;
* suspicious volume changes.

Example:

```text
IFC Center
status: success
showings: 126
added: 14
removed: 9

Film Forum
status: success
showings: 73
added: 6
removed: 12

Roxy Cinema
status: partial
showings: 18
needs review: 2

Metrograph
status: failed
reason: expected schedule structure not found
```

---

## 11.3 Publication safety

The currently published schedule remains active until a replacement candidate successfully passes the publication workflow.

A cinema feed with a `partial` or `failed` result is isolated from the clean
feeds and its entire current payload is discarded. For each date also covered
by the previous approved rolling window, the workflow carries forward that
cinema's approved date facts without changing their provenance. For a date with
no approved coverage, that cinema-date is omitted and reported as unavailable;
other verified cinemas continue publishing. The frontend identifies the
temporarily unavailable cinema on that date. Current partial facts and approved
facts are never mixed. Publication stops when no verified or approved showings
remain anywhere in the seven-day window.

A new dataset must not replace the public dataset when any blocking condition remains, including:

* no verified or previously approved showings remain in the rolling window;
* schema validation failure;
* questionable showing;
* duplicate stable ID;
* database import failure;
* round-trip verification failure;
* required test failure;
* production build failure.

For clean runs with no blocking concerns, the workflow may use the approved automatic publication path.

Any exception requiring judgment must stop and enter manual review.

---

## 11.4 Failure notification

A failed or ambiguous workflow should create or update one actionable review issue rather than generating duplicate alerts.

The alert should identify:

* affected cinema;
* failure type;
* relevant showing changes;
* local date/time;
* stable showing ID where available;
* official source or detail URL.

Detailed JSON and Markdown review artifacts may remain private workflow artifacts.

---

# 12. Storage architecture

Supabase PostgreSQL is the durable system of record.

Durable relational data includes:

* cinemas;
* films;
* showings;
* publication windows;
* ingestion runs;
* source snapshots;
* overrides;
* reviews;
* approvals.

Exact workflow artifacts may be retained separately.

---

## 12.1 Public-site boundary

The public website does **not** query PostgreSQL directly for official weekly schedule data.

Instead:

```text
approved database data
        ↓
validated static JSON export
        ↓
public frontend
```

This keeps the official schedule frontend simple and prevents incomplete ingestion data from becoming public.

---

## 12.2 Stable showing identity

Schedule refreshes must preserve stable showing records whenever possible.

If a previously known showing disappears upstream:

* do not delete the durable identity when user data references it;
* mark it appropriately as removed or inactive;
* exclude inactive records from the current public schedule.

This prevents existing user marks from breaking when official cinema schedules change.

---

# 13. Authentication and privacy

## 13.1 Authentication model

Formal accounts use Supabase Auth with:

* unique public username;
* private email;
* password.

Email is used only for:

* authentication;
* verification;
* account recovery;
* private account invitation lookup where explicitly required.

Email must never be displayed publicly or in Channel member views.

Production account email is delivered by Supabase Auth through a verified
custom SMTP provider. Confirmation and recovery links return only to an
allow-listed canonical application origin. Public email-triggering forms use
server-validated CAPTCHA when configured. Reviewed bilingual templates are
version-controlled without tracking pixels or remote images.

People who do not want a formal account may use a Channel-only identity. A
Channel-only identity is not a Supabase Auth user, has no email address, and is
authorized for exactly one Channel. It uses a separate server-validated session
and must never receive access to normal account APIs.

People without either identity type may browse, search, and filter the public
schedule, but they cannot create watch marks. The application does not maintain
anonymous local watch marks.

---

## 13.2 Password requirements

Formal-account passwords require at least:

```text
8 characters
```

Passwords are managed only through Supabase Auth and must not be stored in application tables.

---

## 13.3 Data minimization

The application does not require:

* real name;
* phone number;
* birthday;
* address;
* contact list;
* profile photo.

---

# 14. Personal watch marks

A signed-in user can mark one exact official showing as:

```text
想看
```

A mark belongs exclusively to its creator.

Different times or cinemas for the same film are separate marks.

---

## 14.1 Privacy default

Every newly created formal-account mark is private by default.

Creating a mark must never automatically make it public to unrelated users.

---

## 14.2 Showing removal

If the official showing later disappears from the active schedule:

* the mark remains attached to the stable showing identity;
* the application must not invent missing current film/time information.

---

# 15. Channels

Channels provide private small-group sharing.

The collaboration model is closer to a shared private space than a public social network.

---

## 15.1 Roles

V1 roles:

```text
owner
member
```

There is no separate administrator role.

### Owner

Can:

* rename the Channel;
* delete the Channel;
* create or revoke invitations;
* remove members;
* remove Channel-only identities;
* transfer ownership to another current member, after explicit confirmation.

A Channel-only owner has the same management authority within its one Channel,
except that it may invite only through revocable invitation links. It cannot use
email or Friend ID invitations, join another Channel, or create a second Channel.
Invitation links belong to the Channel: they remain valid across owner transfers
and identity upgrades, and the current owner may view or revoke them.

### Member

Can:

* view Channel content;
* share their own marks;
* remove their own shares;
* leave the Channel.

Members cannot edit or delete another user's underlying content.

A Channel-only member has the same read and self-management boundary within its
one Channel, but cannot make marks private, share them elsewhere, or discover
another Channel.

---

## 15.2 Shared marks

A user's underlying watch mark remains personal.

Channel visibility is represented separately.

Conceptually:

```text
watch_mark
    +
channel_mark_share
```

Removing a Channel share must not delete the personal mark.

Deleting the personal mark removes all shares derived from it.

Channel-only marks are different: they have no separate private record or share
row. Creating one makes it immediately visible in the identity's Channel, and
deleting it removes it from that Channel.

---

## 15.3 Auto-share preference

A formal-account user may maintain per-Channel sharing defaults.

These defaults may preselect sharing when a new mark is created.

The user must still be able to override the sharing choice for an individual mark.

This privacy and sharing model applies to formal accounts. Channel-only marks
follow Section 17 and are always part of their single Channel.

---

# 16. Channel invitations

## 16.1 Direct invitation

Existing account users may be invited through:

* private email; or
* random Friend ID.

Username must not function as an invitation identifier.

---

## 16.2 Friend ID

Friend IDs:

* are distinct from username;
* contain no personal information;
* are randomly generated;
* may be regenerated to invalidate the previous value.

---

## 16.3 Email lookup

Email invitation matching must occur only in trusted server-side code.

Email lookup creates an in-application invitation for an already registered
account. It does not send an email and must be labelled accordingly. Inviting an
unregistered address by email would require a separate token and delivery flow.

The interface must not reveal whether arbitrary email addresses correspond to registered users.

---

## 16.4 Invitation links

Owners may create revocable Channel invitation links.

Default behavior:

```text
expiration: 7 days
maximum successful joins: 20
```

The owner may revoke the link earlier.

A valid invitation link may create either a formal-account membership or a new
Channel-only member identity. Only a successful join consumes one use. Preview,
failed verification, and repeated submissions must not consume uses.

Invitation tokens must:

* use cryptographically secure randomness;
* be stored only as hashes;
* not appear in analytics or application logs;
* be rate-limited when verified.

---

# 17. Channel-only identities

A person who does not want to register a formal email account may create or join
a Channel with a persistent Channel-only identity. This replaces the former
read-only guest model.

A Channel-only identity:

* belongs to exactly one Channel;
* is either that Channel's `owner` or a `member`;
* has no email address and cannot recover access through email;
* has one immutable display name that is unique within the Channel without
  regard to case;
* is visibly labelled `小组身份` in member-facing interfaces;
* cannot discover, join, or operate on another Channel;
* cannot query normal account profiles or use normal authenticated-account APIs.

One person may hold separate Channel-only credentials for multiple Channels, but
each identity and session remains isolated. The interface must not provide a
cross-Channel identity list or switcher; the person must log out before entering
another Channel-only identity.

## 17.1 Creating a Channel-only owner

An unauthenticated visitor may create a Channel by providing only:

* a Channel name; and
* an immutable display name.

The operation must atomically create the Channel and its Channel-only owner. A
Channel-only owner may own only that one Channel. It may manage the Channel,
create or revoke invitation links, remove members, and delete the Channel. It may
not use email or Friend ID invitations.

The application assigns every Channel a separate immutable, globally unique,
human-readable public ID, for example:

```text
CH-7KDM4QPX
```

The internal Channel UUID remains the database key. The public Channel ID is a
login locator and is not a secret.

## 17.2 Joining through an invitation link

Only a valid, unexpired, unrevoked invitation link may create a Channel-only
member. The standard invitation-link expiration and use limit apply. Identity
creation must be rate-limited, but legitimate shared-device use must not be
blocked merely because another identity was created in the same browser.

## 17.3 Access code and sessions

Identity creation returns the public Channel ID and a random eight-character,
human-readable alphanumeric access code, for example:

```text
7KDM-4QPX
```

Ambiguous characters such as `0/O` and `1/I` should be excluded. Codes must be
unique within their Channel and stored by the service only as slow, salted
hashes. Login failures must not reveal whether the Channel, identity, or code was
incorrect. Basic request throttling applies; the default is no more than 20
login attempts per IP address per minute. Failed attempts do not automatically
lock or revoke an identity.

The application may store the original code locally on a device so the signed-in
person can reveal it in their identity view. The server must not retain a
reversibly encrypted or plaintext copy. A new device can display the code only
after the person supplies it and chooses to save it on that device.

The member-facing display-name field is labelled `昵称` with an explicit
`创建后不可修改` warning before submission. After owner or invited-member
creation, keep the credential receipt open with copy controls plus explicit
`进入我的小组` and `关闭` actions; do not leave the person at an unexplained code
screen.

A Channel-only session:

* is scoped to exactly one identity and one Channel;
* lasts 30 days by default and renews with valid activity;
* stores no plaintext access code in its server token;
* can be ended explicitly by the person;
* is revoked when the identity is removed, merged, or rotates its code.

An already signed-in identity may rotate its code. Rotation displays the new
code once, invalidates the old code and other device sessions, and keeps the
current device signed in. Without a valid session or the code, access cannot be
recovered. The owner cannot view or reset another identity's code.

## 17.4 Channel-only permissions and marks

A Channel-only identity may:

* view its Channel's members and shared marks;
* create and delete its own marks for current published official showings;
* view and rotate its own access code;
* merge itself into a formal account.

It may not:

* maintain a private mark;
* remove a share while retaining a private copy;
* share into another Channel;
* create user events;
* modify content owned by another identity.

Every Channel-only mark is directly and exclusively part of the identity's
Channel. When a marked showing leaves the public schedule window, retain its
stable record but do not invent or display missing current schedule facts.

## 17.5 Leaving, removal, and inactivity

A Channel-only member may leave. The owner may remove it. Either action
permanently deletes the identity's marks, revokes its code and sessions, and
deletes the identity. Rejoining requires a new invitation link and identity.

A Channel-only owner cannot leave until it transfers ownership, deletes the
Channel, or merges into a formal account. Channels and identity-owned marks must
not be silently deleted for inactivity. A future retention policy requires an
explicit archive, warning, and recovery design before it may delete user data.

## 17.6 Merging into a formal account

A signed-in formal account may claim any number of Channel-only identities, one
at a time, by supplying each public Channel ID and access code. Starting an
upgrade from the Channel-only identity view must complete the merge automatically
after registration or login; it must not require the same credentials a second time.
Before confirmation, show the Channel, role, and number of marks that will move.
If the submitted email already belongs to a personal account, explain that fact
and provide a direct route to personal-account login with the email preserved.
After a manual credential merge, show a completion state with `进入我的小组`
and `关闭` rather than leaving the completed credential form on screen.

The merge is irreversible and must be one atomic server-side transaction:

1. verify the formal account and Channel-only credential;
2. add or reconcile the formal account's Channel membership;
3. transfer all marks and preserve their Channel visibility;
4. deduplicate marks for the same exact showing;
5. transfer full Channel ownership when the old identity was the owner;
6. preserve original mark/share timestamps and transfer active invitation links;
7. replace product-facing attribution with the formal account username;
8. revoke the old code and every Channel-only session;
9. delete the old Channel-only identity.

Failure at any step must roll back the entire merge. The former display name may
remain only in restricted security audit data and must no longer appear in the
product interface.

## 17.7 Storage and trust boundary

Channel-only identities must not be represented by fabricated emails or normal
Supabase Auth users. Keep their data separate, conceptually:

```text
channel_identities
channel_identity_sessions
channel_identity_marks
channel_identity_audit
```

Channel reads may combine formal-account shares with Channel-only marks, but
Channel-only writes must pass through narrowly scoped trusted server endpoints.
Do not weaken the existing formal-account RLS policies or authorize requests from
client-supplied identity or Channel IDs alone.

Owners may see a Channel-only identity's display name, `GUEST` label, role, join
time, last activity time, and mark count. They must never see its access code,
code hash, IP address, device details, or failed-login records.

All credentials created under the former read-only guest model must be revoked
when this model is introduced. They must not silently gain write access.

---

# 18. User-created events

Signed-in formal-account users may create an event that does not exist in the official cinema dataset.

User events are separate from official schedule records.

They must:

* display a clear `用户创建` label;
* never receive official extraction status;
* never be merged into the official cinema schedule dataset;
* remain private unless explicitly shared to a Channel.

User-event details may include:

* title;
* description/content;
* New York date;
* time;
* optional location;
* optional external URL.

Exact optional-field requirements may be refined when this feature is implemented.

---

# 19. Authorization invariants

Database constraints and RLS must enforce the following:

* users can modify only their own marks;
* users can modify only their own user events;
* users can share only items they own;
* users can share only into Channels they currently belong to;
* Channel membership allows reading only content explicitly shared into that Channel;
* shared visibility never grants edit/delete permission;
* leaving a Channel immediately revokes Channel-derived visibility;
* removing a membership removes that user's Channel shares without deleting their private items;
* deleting a Channel removes Channel-derived visibility;
* invitation acceptance binds the trusted authenticated identity;
* client-supplied user IDs must never determine authorization;
* a Channel-only session can authorize operations only for its bound identity
  and Channel;
* Channel-only marks are always visible to their bound Channel and cannot have a
  private or cross-Channel state;
* Channel-only owner and member permissions are enforced by trusted server code,
  not by client-supplied roles;
* merging an identity, its marks, membership, and possible ownership transfer is
  atomic and immediately revokes the old credential and sessions;
* deleting a Channel-only identity deletes its marks rather than retaining
  ownerless content.

Authorization behavior must be covered by tests before a new collaboration capability is considered complete.

---

# 20. Product positioning, navigation, and layout

## 20.1 Product identity and user-facing language

The public homepage title remains:

```text
这周看什么？
```

---

The positioning sentence explains that users can browse the next seven days of
NYC arthouse schedules and collaboratively mark and share exact showings with
friends. Schedule discovery is the entry point; private small-group
collaboration is the differentiating feature. This is not an itinerary planner.

Database, RPC, and source-code identifiers retain `Channel`. User-facing copy
uses the following terms consistently:

* `观影小组` for Channel;
* `小组编号` for the public Channel locator;
* `个人账号` for a Supabase Auth account;
* `小组身份（无需邮箱）` for a Channel-only identity;
* `组长` and `成员` for the independent in-group role axis.

English user-facing copy uses `Film Fam`, `Film Fam ID`, `Film Fam profile (no
email required)`, `Organizer`, `Member`, `Personal account`, `Want to watch`, and
`Notifications`. `Film Fam` is the feature name; the product remains **NYC Movie
Together**. User-created names and future user-event content are displayed in
their original language and are never machine-translated.

Do not show `GUEST`, `OWNER`, `正式账号`, `Channel-only`, or `Channel` as
user-facing identity or group labels.

## 20.2 Primary navigation

Desktop and mobile expose the same four primary destinations:

* 排片;
* 观影小组;
* 通知;
* 账号.

For a signed-in personal account, the account destination opens an account
summary rather than the password form. The summary shows the number of distinct
films with personal `想看` marks, the number of current viewing-group
memberships, and the time since the account was created. Password changes remain
available as an explicit secondary action from this summary.

The viewing-group drawer's neutral state is a group overview, not a duplicate
personal home. It shows joined groups with full names and the member's `组长` or
`成员` role. The rail's `我` control returns to the schedule and closes the
drawer.

An unauthenticated visitor starts on the schedule. A group identity starts in
its unique group. A personal account restores its most recent location, while a
new personal account without history starts on the schedule.

The homepage primary call to action is `创建观影小组`, with `如何使用` as a
secondary action. The guide explains the four-step flow and compares both
identity types without blocking schedule browsing.

## 20.3 Group navigation

Use a two-level Channel navigation model.

### Primary rail

Contains:

* personal home;
* joined Channels;
* create-Channel control;
* persistent account/Friend-ID area.

This multi-Channel rail applies fully to personal accounts. A Channel-only session
retains a personal schedule home for browsing dates, filters, and films, plus its
one Channel entry. Marks made from that home are immediately part of the bound
Channel. It must not reveal unrelated Channels. It must not show a create-group
control; users who need multiple groups are prompted to upgrade to a personal
account.

### Contextual rail

Appears only when viewing a Channel.

Contains Channel-specific navigation and controls.

Selecting personal home collapses the contextual rail.

Creating a Channel opens an independent modal rather than expanding the contextual rail.

---

## 20.4 Mobile navigation

On narrow screens:

* both rails become drawer-based navigation;
* film cards retain the available content width;
* drawers may use a backdrop;
* navigation must not permanently compress the schedule content.

---

# 21. Channel schedule behavior

The Channel activity view shows shared official showings grouped by:

1. local date;
2. local showing time.

A showing card may group members who independently shared the same showing.

Member identity is displayed using:

* a formal account's public username, or a Channel-only identity's immutable
  display name and `GUEST` label;
* stable colored identity initials.

No profile photo or additional personal information is required.

---

## 21.1 Joining another member's showing

If User A shares a showing and User B clicks `想看` on it:

* a formal-account User B receives their own personal watch mark, which may be
  shared into the current Channel;
* a Channel-only User B creates a Channel-only mark that is immediately visible
  in the current Channel;
* User A's mark remains unchanged.

---

## 21.2 Removing a mark from a Channel

For a mark owned by the current user, the Channel UI must distinguish:

```text
Remove from this Channel
```

from:

```text
Delete my personal mark
```

Deleting the personal mark has a wider effect and must be explained before confirmation.

This distinction does not apply to a Channel-only identity. Its only available
removal action deletes its Channel-only mark from the Channel.

---

# 22. Social context on personal schedule

On personal-home schedule cards, the interface may display how many **distinct other users** in shared Channels explicitly shared the same showing.

Rules:

* exclude the current user;
* count the same person once even across multiple shared Channels;
* never include private/unshared marks;
* do not expose identities the current user is not authorized to see.

---

# 23. Notifications

Both personal accounts and Channel-only identities expose the same top-right
notification entry and unread-count treatment.

The notification page includes:

* pending direct Channel invitations;
* recent watch marks shared by other members in Channels the user currently belongs to.

Channel-only identities have no direct-invitation inbox because they are bound to
one existing Channel, but they use the same activity cards and read interaction.
Activity from formal accounts and Channel-only identities must notify every other
member regardless of identity kind. Multiple people marking the same exact showing
are aggregated into one item with an actor count. Read and unread activity remains
visible for 14 days.

Invitation acceptance is always explicit.

---

## 23.1 Read state

Watch-mark activity uses private per-Channel read cursors.

The cursor:

* defaults to the membership join time;
* advances for one Channel when that Channel is opened;
* advances for all joined Channels when the user chooses “mark all as read”;
* disappears when membership is removed.

Notifications use one reverse-chronological feed rather than separate sections for each reminder type.

Opening the notification page alone does not advance a cursor. A Channel-only
identity has one cursor for its one Channel; a personal account has one cursor per
Channel.

---

# 24. UI feedback principles

Async operations must provide visible progress, success, or failure feedback.

Feedback should:

* appear near the action when practical;
* clear automatically when appropriate;
* not permanently occupy layout space;
* never require a full page reload to reveal a successful write.

Non-modal sharing interactions must not block scrolling or unrelated UI.

Destructive actions require explicit confirmation.

---

# 25. Non-goals

Unless explicitly moved into scope, do not build:

* comprehensive NYC commercial-cinema coverage;
* public user profiles;
* public social feeds;
* followers;
* private messaging;
* comments;
* group chat;
* RSVP or attendance tracking;
* polls;
* itinerary planning;
* public groups;
* email, SMS, or operating-system push notifications;
* ratings/reviews;
* paid subscriptions;
* complex social-network mechanics;
* unsupported third-party schedule aggregation;
* administrative infrastructure without a concrete requirement.

Avoid speculative architecture for features outside the accepted roadmap.

---

# 26. Product success criteria

The project is successful when:

* a user can identify an appropriate screening in roughly one minute;
* every official screening can be traced to an official source;
* routine schedule updates require no frontend-code changes;
* one cinema parser failure cannot contaminate the other cinema feeds;
* stale or questionable data cannot silently replace approved data;
* schedule updates can operate reliably over long periods;
* maintainers can understand publication changes quickly;
* formal-account personal marks remain private by default;
* Channel sharing does not weaken ownership or authorization boundaries;
* people can create or join one Channel without providing an email address;
* Channel-only identities cannot access or discover unrelated Channels;
* the system remains understandable as cinema and collaboration features expand.

---

# 27. Current product priorities

Current work should focus on:

1. Add and stabilize the **Syndicated Bar Theater Kitchen** cinema adapter and schedule integration.
2. Replace the read-only guest model with the specified **Channel-only identity**
   creation, access, marking, ownership, and formal-account merge workflow.
3. 接受邀请时选择要不要共享当前的个人标记，也可以选择以后自己手动分享.
4. 接受邀请时要立刻在左侧出现channel.


These priorities may be changed directly by the user.

They are current tasks, not permanent architectural requirements.

---

# 28. Open product decisions

The following decisions remain unresolved:

1. Which cinemas should be added after the current seven-cinema scope?
2. Whether user-created events require location.
3. Whether user-created events require an end time.
4. Whether user-created events may contain an external URL.

Do not silently decide the remaining items when implementation reaches the relevant boundary.

Surface the decision to the user first.
