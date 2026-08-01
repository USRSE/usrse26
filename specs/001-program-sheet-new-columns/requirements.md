# Requirements — Program sheet new columns: People, Format, Info_md, Title

Status: done

## Summary

The Schedule tab of the program Google Sheet is gaining four columns —
**People**, **Format**, **Info_md**, and **Title** — that
`scripts/build-program.js` currently either drops on the floor
(`normalizeHeader()` returns `null` for any header without an alias) or
misinterprets (a "Title" header is currently an alias for Session).

**Terminology.** Each sheet row is an **event** in a session; a **session**
is the collection of events sharing the same Session value, Location, and
time slot (Start/End) — exactly how `fold()` groups rows today. Event rows
are those with a non-empty Talk cell; rows without one (Registration,
breaks, plenary placeholders) define the session itself, as today. An
event's displayed title is its Title cell when present (Title is required
for every Format except "Other"), and its Talk cell otherwise.

Today the script carries event speakers only via the optional `Speakers`
column (the live sheet instead embeds authors inside the talk title as
"… by A, B and C"), has no notion of an event's format beyond hand-typed
"[Paper]"-style title prefixes, and renders the `Info` column as escaped
plain text. The new columns make this explicit in the sheet:

- **People** — the event's speakers/authors, as a comma-separated list that
  may use an "and" before the final name ("A, B and C").
- **Format** — the event's format, one of: **Bird of a Feather, Keynote,
  Other, Paper, Plenary, Poster, Talk, Workshop**. Replaces the hand-typed
  "[Paper]"-style title prefixes. Session-level classification is
  untouched.
- **Info_md** — Markdown content for an event (its abstract), used to
  generate per-format abstract pages modeled on
  [USRSE'25](https://us-rse.org/usrse25/program/), where each format has a
  page listing title, authors, and abstract for every entry.
- **Title** — the event's clean display title. The Talk column is not
  renamed and keeps its legacy content. Title is required for every Format
  except "Other" (an empty Title there is a build error); for "Other" it
  is optional.

All four new columns are event-level: on session rows (empty Talk cell)
they are ignored. No existing sheet columns are removed; the new columns
are additive.

The script currently writes two artifacts consumed by the site:
`_includes/program-schedule.html` (rendered on `pages/program/program.md`)
and `_data/program.json`. This feature adds two more kinds: one generated
Markdown page per event format, and script-managed links to those pages in
the program menubar (`_data/menus/hidden/program.yml`). The offline fixture
`fixtures/schedule.csv` must exercise the new columns.

## User stories

### Story 1 — People column

As a program chair editing the Schedule sheet, I want a People column so
that each event's speakers are listed with it without embedding names in
the title text.

**Acceptance criteria**

- WHEN the sheet header contains "People" (any case, punctuation ignored),
  THE system SHALL recognize the column instead of dropping it.
- WHEN a People cell contains names separated by commas, with or without an
  "and" before the final name ("A, B and C", "A, B, and C", "A and B"),
  THE system SHALL parse the individual names without producing empty
  entries or names polluted with "and".
- WHEN an event row (non-empty Talk cell) has a People value, THE system
  SHALL attach the names to that event, publish them as the entry's byline
  on its abstract page, and include them in `program.json` as a list of
  name strings; the schedule grid SHALL NOT display them (amended
  2026-07-31 — originally people also rendered with the schedule entry).
- WHEN a session row (empty Talk cell) has a People value, THE system SHALL
  ignore it — People is event-level only.
- WHEN a People cell is empty, THE system SHALL render the row exactly as it
  does today.
- WHEN both a Speakers and a People column exist, THE system SHALL treat
  them as the same field (People is an alias of the existing canonical
  `speakers` value for event rows).

### Story 2 — Format column (per event)

As a program chair, I want a Format column on event rows so each event's
format is structured data instead of a hand-typed prefix inside the talk
title.

**Acceptance criteria**

- WHEN the sheet header contains "Format" (any case, punctuation ignored),
  THE system SHALL recognize the column instead of dropping it.
- WHEN an event row has a Format value other than "Other", THE system SHALL
  carry it on that event, render it as a short label with the event entry,
  and include it in `program.json`.
- WHEN an event row's Format is "Other" (case-insensitive), THE system
  SHALL render the event with no format label and exclude it from the
  abstract pages (Story 5); its displayed title follows Story 3 (Title if
  present, Talk cell otherwise) and the format value still appears in
  `program.json`.
- WHEN an event row's Format cell is empty, THE system SHALL render the
  event exactly as it does today.
- WHEN an event row's Format is non-empty but not one of the eight known
  values, THE system SHALL treat it as "Other" (no format label, no
  abstract page, Title optional); the value as typed still appears in
  `program.json`.
- WHEN a session row (empty Talk cell) has a Format value, THE system SHALL
  ignore it — Format is event-level only.
- People and Format SHALL never be merged into the displayed title.
- Session classification (the `classify()` title inference and the existing
  `Type`/`SessionType` aliases, including muted and plenary styling) SHALL
  be unchanged by this feature.

### Story 3 — Title column

As a program chair, I want a Title column so new event rows carry a clean
display title without rewriting the legacy Talk cells.

**Acceptance criteria**

- WHEN the sheet header contains "Title" (any case, punctuation ignored),
  THE system SHALL map it to the new event-title field — superseding the
  current behavior where a "Title" header is an alias for Session.
- WHEN an event row has a non-empty Title, THE system SHALL use it as the
  event's displayed title everywhere it appears (schedule and abstract
  pages) and carry it in `program.json`.
- WHEN an event row has a Format other than "Other" AND an empty Title
  cell, THE system SHALL abort the build with an error identifying the
  row.
- WHEN an event row's Format is "Other", Title MAY be empty; WHEN it is,
  THE system SHALL use the Talk cell as the displayed title, exactly as
  today.
- WHEN an event row has an empty Format, THE system SHALL use the Talk
  cell as the displayed title, exactly as today.
- Event rows SHALL still be identified by a non-empty Talk cell; Title
  alone does not make a row an event.
- WHEN a session row has a Title value, THE system SHALL ignore it — Title
  is event-level only.

### Story 4 — Info_md column

As a program chair, I want an Info_md column holding Markdown so each
event's abstract can be written once in the sheet and published with links
and emphasis intact.

**Acceptance criteria**

- WHEN the sheet header contains "Info_md" (any case, punctuation ignored),
  THE system SHALL recognize the column instead of dropping it.
- Info_md content SHALL be interpreted as Markdown wherever it is
  published (the generated abstract pages, Story 5).
- WHEN Info_md contains raw HTML (tags, script, event handlers), THE system
  SHALL NOT let it pass through into rendered page output.
- WHEN a session row (empty Talk cell) has an Info_md value, THE system
  SHALL ignore it — Info_md is event-level only.
- The existing Info column SHALL keep its current behavior on the schedule
  (escaped plain text in the session info block).
- `program.json` SHALL carry text only — the raw Info_md Markdown string
  per event, never rendered HTML.

### Story 5 — Per-format abstract pages

As a site visitor, I want a page per submission format — like USRSE'25's
program section — listing every event of that format with its title,
authors, and abstract, so I can browse abstracts outside the schedule
grid.

**Acceptance criteria**

- WHEN at least one event row has a Format value other than "Other", THE
  system SHALL generate one Markdown page per such distinct format.
- Events with Format "Other" or an empty Format SHALL never appear on an
  abstract page, and "Other" SHALL never produce a page.
- Each page SHALL list every event of that format; each entry SHALL render
  the event's Title as a heading, the event's People as an italic byline,
  and the event's Info_md content as Markdown body text (mirroring the
  USRSE'25 layout: `##` title, `_names_`, abstract paragraph, horizontal
  rules between entries, and a `menubar_toc` sidebar contents).
- WHEN an event has a Format but an empty Info_md, THE system SHALL still
  list the entry (title and byline, no abstract).
- Each generated page SHALL carry Jekyll front matter consistent with the
  existing program pages (`layout: page`, `menubar: program`, a
  `permalink` under `program/`) plus a do-not-edit banner naming the
  script, matching `_includes/program-schedule.html`.
- THE system SHALL update the program menubar
  (`_data/menus/hidden/program.yml`) to link every generated page,
  preserving the existing "Full Program" entry; WHEN a format no longer
  appears in the sheet, its menubar entry SHALL be removed along with its
  page.
- Generated pages and the menubar SHALL be written with the same
  write-only-when-changed behavior as the existing artifacts so the daily
  Action commits no churn.
- Entries on a page SHALL appear in a stable, deterministic order across
  rebuilds (exact ordering decided in design).
- Each entry on a format page SHALL have a stable anchor so it can be
  linked directly.
- WHEN an event has a non-empty Info_md and a Format that produces a page,
  THE system SHALL render the event's title on the full-program schedule as
  a link to that event's section on its format page.
- WHEN an event has Info_md but no format page exists for it (Format
  "Other" or empty), THE system SHALL render the title without a link, as
  today.
- WHEN a format no longer appears in the sheet, its previously generated
  page SHALL NOT linger in the repo (mechanism decided in design).

### Story 6 — Schedule styling for the new data

As a site visitor, I want events and sessions that carry the new data to be
readable at a glance.

**Acceptance criteria**

- WHEN an event has a value for one or more of the new columns,
  `assets/css/program.css` SHALL style the new elements it renders — no
  unstyled bare text.
- An event's format label SHALL be styled distinct from the event title
  (amended 2026-07-31: people no longer render on the schedule, so no
  author styling applies there).
- WHEN an entry has none of the new values, its appearance SHALL be
  unchanged from today.

### Story 7 — Backwards compatibility

As a maintainer, I want builds from a sheet or fixture without the new
columns to keep working unchanged.

**Acceptance criteria**

- WHEN the CSV lacks People/Format/Info_md/Title headers, THE system SHALL
  produce schedule output identical to the current build, generate no
  abstract pages, and leave the menubar untouched.
- WHEN the new columns exist but every cell in them is empty, THE system
  SHALL produce output identical to the columns being absent.
- The fixture `fixtures/schedule.csv` SHALL be extended so the offline build
  (`node scripts/build-program.js --file fixtures/schedule.csv`) exercises
  all four new columns.

## Out of scope

- Redesigning the program page layout; only the CSS additions Story 6
  requires (existing classes are reused everywhere else).
- Changes to the GitHub Action (`.github/workflows/build-program.yml`) or
  CircleCI preview beyond committing any newly generated pages — the
  sheet's column set is invisible to both.
- Validating sheet content beyond the Format-vocabulary and required-Title
  checks above (no name-spelling or Markdown linting; the script otherwise
  keeps its current fail-loud-on-unparsable-dates posture).
- A general-purpose Markdown engine — only a minimal zero-dependency
  treatment sufficient for abstracts (the generated pages are Markdown that
  Jekyll itself renders; see design).
- Rewriting the "by Author1, Author2" text already embedded in existing
  Talk cells — legacy rows keep rendering their Talk cell; clean titles
  come from the new Title column on rows with a valid Format.

## Resolved decisions

1. **Format is per event** — it describes an individual event, not the
   session. Session classification is untouched.
2. **Format vocabulary** — Bird of a Feather, Keynote, Other, Paper,
   Plenary, Poster, Talk, Workshop.
3. **Format "Other" opts out** — such events render exactly as today and
   get no abstract page.
4. **No columns are removed** — the new columns are additive; Info,
   Speakers, Talk, and every existing column stay valid.
5. **Info_md is Markdown** — and its purpose is to populate generated
   per-format abstract pages modeled on USRSE'25's program section.
6. **program.json is text only** — raw Markdown strings and name lists;
   rendered HTML never appears in the JSON artifact.
7. **People is a comma-separated name list** — possibly with an "and"
   before the final name; the parser must handle both.
8. **Title source** — the Talk column is not renamed; a new Title column
   supplies the displayed title when present, and the Talk cell remains
   the displayed title otherwise. Title is required for every Format
   except "Other" (an empty Title there fails the build); for "Other" and
   format-less rows it is optional. People and Format are never merged
   into the title.
9. **CSS is updated** for entries carrying new-column values; author and
   format get visibly different styling.
10. **The script updates the menubar** — format-page links in
    `_data/menus/hidden/program.yml` are script-managed.
11. **Terminology** — a sheet row is an event; a session is the set of
    events sharing the same Session value, Location, and time slot.
12. **Session grouping is unchanged** — `fold()`'s grouping by Session +
    Location + time slot is correct and stays as implemented.
13. **Schedule links into abstract pages** — when an event has Info_md and
    a format page, its title on the full program links to its section on
    that page.
14. **Page titles/permalinks per format** — Bird of a Feather → "Birds of
    a Feather" at `program/bofs/`; Keynote → "Keynotes" at
    `program/keynotes/`; Paper → "Papers" at `program/papers/`; Plenary →
    "Plenaries" at `program/plenaries/`; Poster → "Posters" at
    `program/posters/`; Talk → "Talks" at `program/talks/`; Workshop →
    "Workshops" at `program/workshops/`.
15. **New columns are event-level only** — People, Format, Info_md, and
    Title are all ignored on session rows (empty Talk cell); the
    schedule's session blocks are untouched by this feature.
16. **Committed artifacts** — the daily Action refreshes them from the
    live sheet after merge; the implementation PR must not overwrite the
    live-sheet-derived artifacts with fixture-derived content.
17. **Unknown Format values are treated as "Other"** — no build error; the
    event renders with no format label and joins no abstract page.

## Open questions

None — all resolved (see Resolved decisions). Requirements approved
2026-07-31.

## Amendments

- 2026-08-01 — sheet columns renamed: Session → Session Topic, Talk →
  Event Title, Info → Session Description, Info_md → Event Description,
  Format → Event Format (old headers stay recognized as aliases). Session
  classification is no longer inferred from titles: the new Session Format
  column is used exactly as given (Break/Meal/Registration mute the row,
  Plenary gets the plenary field), so the Story 2 "classification
  unchanged" and Story 7 legacy-CSV criteria are superseded. A new Session
  Chair column renders next to the Session Format value. Session
  Description and Event Description are both Markdown (session
  descriptions render via Liquid markdownify in the include). Event Format
  gains "Random Access Microtalk" (page "Random Access Microtalks" at
  `program/microtalks/`). The Title column and its required-Title build
  error are retired — Event Title is the clean display title (a Title
  column still overrides it if present).
