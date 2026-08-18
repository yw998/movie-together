# AGENTS.md — NYC Repertory Cinema Week

## Read this first

This repository is a long-term public website that aggregates weekly film schedules from selected New York City repertory and arthouse cinemas. Before changing code, read `docs/PROJECT_SPEC.md`, inspect the current implementation, and compare the code with the specification. If they disagree, preserve working behavior and document the discrepancy before making a broad rewrite.

## Product goal

Help a New York moviegoer answer: **“What should I see this week, where, and at what time?”**

The experience should be fast, editorially clear, mobile-friendly, and trustworthy. It is not a generic multiplex search engine.

## Current cinema scope

1. Metrograph
2. Film Forum
3. IFC Center
4. Roxy Cinema New York
5. Paris Theater
6. Lincoln Center
7. Syndicated Bar Theater Kitchen

Design data adapters so additional cinemas can be added later without rewriting the shared pipeline.

## Initial public product

- Public URL: https://nyc-rep-cinema-week.wyzmanto.chatgpt.site
- Chinese-first interface
- Seven-day schedule view
- Date tabs
- Cinema filters
- Film/cinema search
- Time-of-day clusters: morning, afternoon, evening, late night
- Short Chinese film descriptions
- Official detail or ticket links

The initial prototype contains hard-coded weekly data. The long-term project must replace hard-coded schedules with a repeatable ingestion and review workflow.

## Non-negotiable accuracy rules

- Never invent, infer, or “fill in” a movie title, date, showtime, format, guest appearance, or ticket URL.
- A published showing must have evidence from an official cinema source.
- Store `source_url`, `fetched_at`, and extraction status for every showing.
- Preserve special labels exactly when material: Q&A, introduction, members only, open captions, 35mm, 70mm, DCP, sold out.
- If a value is unavailable, use `null`, an empty value, or exclude the record. Do not use plausible placeholders.
- When a cinema page changes or parsing becomes uncertain, fail visibly and route the cinema to manual review.
- Descriptions may be AI-assisted, but factual claims must be grounded in the cinema page or a trusted film source. Descriptions must never alter showtime facts.
- All dates and times use `America/New_York` and must retain their local calendar date.

## Preferred engineering shape

- One adapter per cinema.
- Shared normalized schema and validation layer.
- Raw evidence retained separately from normalized public data.
- Static JSON is acceptable for the first reliable version; a database is optional until archives or user state require it.
- Prefer direct HTTP + HTML parsing for stable server-rendered pages.
- Use browser rendering only when the official data is unavailable in returned HTML.
- Support a manual override file for special events and temporary parser failures.
- Keep ingestion separate from the public frontend.
- Do not expose scraping errors, secrets, or raw HTML to site visitors.

## Definition of done for schedule changes

1. Official source evidence exists.
2. Data validates against the normalized schema.
3. Duplicate films/showings are resolved without dropping distinct formats or events.
4. Times sort correctly across noon and midnight.
5. Mobile and desktop views remain usable.
6. Source links open the relevant official page.
7. Failed or stale cinema feeds are clearly identified before publication.
8. Tests and the production build pass.

## Immediate task order

Work through these in order unless the user changes priorities:

1. Inspect the repository and inventory hard-coded schedule data, frontend components, deployment configuration, and missing tests.
2. Move schedule content into a typed normalized data file; render the existing UI from that file without changing the visual behavior.
3. Add schema validation, timezone-safe parsing, deduplication, provenance fields, and stale-data checks.
4. Build official-source adapters, beginning with Film Forum and IFC Center, then Roxy, Metrograph, and Paris Theater.
5. Add a review report that shows new records, removed records, parser failures, and questionable changes before publishing.
6. Make the displayed seven-day window dynamic and clearly label the data's last refresh time.
7. Add a scheduled weekly workflow only after the adapters and review report are reliable.
8. Add archives and optional user features only after weekly updates are stable.

## Open product decisions

Do not silently decide these. Surface them to the user when the implementation reaches them:

- “This week” means a calendar week or a rolling seven-day window.
- Automatic publication versus user approval after each weekly refresh.
- Whether sold-out events remain visible.
- Whether Chinese descriptions should come only from official copy or may use trusted external film metadata.
- Which additional cinemas should enter the next expansion wave.

## Working style for Codex agents

- Start by stating what you found and the smallest coherent change you will make.
- Preserve unrelated user changes.
- Prefer small, testable commits and adapters over large rewrites.
- If an official site blocks or changes extraction, report the exact cinema and failure mode; implement a safe manual fallback instead of fabricating data.
- Update `docs/PROJECT_SPEC.md` when product behavior, schema, cinema scope, or workflow decisions change.

