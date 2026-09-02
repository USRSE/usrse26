# Requirements — posters sheet page

Status: done

## Summary

`scripts/build-program.js` reads exactly one tab of the program Google Sheet:
`SHEET_NAME = 'Schedule'` (`:50`), fetched by `loadCSV()` (`:974-993`) through
the gviz CSV endpoint, or read from a single `--file` path offline. Every
artifact — the two schedule includes, `_data/program.json`, the abstract pages
under `pages/program/abstracts/`, and `_data/menus/program.yml` — derives from
that one tab.

Posters do not fit that model. They are accepted separately, carry authors and
a DOI rather than a schedule slot, and the program committee keeps them on a
second tab, **"Posters"**, in the same spreadsheet (same `PROGRAM_SHEET_ID`).
Its columns are `Authors`, `Poster Title`, `Abstract`, and `DOI`; any other
column is read past and ignored. Today no
generated page exists for them: the live sheet has no Poster-format events,
`pages/program/abstracts/posters.md` is absent, and only the inactive USRSE'25
placeholder `pages/program/abstracts/posters.tbd` remains.

This feature teaches the generator to fetch the Posters tab as a second input
and write `pages/program/abstracts/posters.md` in exactly the style the other
abstract pages already use (spec 002): a `.abstracts` list of native
`<details>` rows, collapsed rows showing title and authors, the expanded body
showing the abstract, a DOI link, and a permalink to that row. The page joins
the program menubar and inherits `assets/css/abstracts.css` and
`assets/js/abstracts.js` unchanged.

Two existing mechanisms must be reconciled rather than duplicated:

- `FORMATS.poster` (`:90`) already names `program/posters/` and slug `posters`.
  If the Schedule tab ever carries Poster-format events, `collectAbstracts()`
  (`:795-825`) would generate the same `posters.md` from schedule rows, and
  `renderSession()` (`:507-510`) would deep-link those events into it. The
  fixture `fixtures/schedule.csv` (rows 33-34) does exactly that. The
  Posters tab must own the page, but a Schedule Poster event must still link
  to it — to the matching entry when one exists.

The Schedule tab also has a `DOI` column of its own, which the generator does
not read today (`HEADER_ALIASES`, `:145-161`). It should surface on the
existing abstract pages exactly as a poster's DOI does.
- `writeAbstractPages()` (`:912-928`) prunes any banner-carrying `.md` in the
  abstracts directory whose slug is not in the page map, and `writeMenubar()`
  (`:947-968`) lists only slugs in that map. The posters page must be
  registered there or it will be deleted on the next run and missing from the
  menu.

## User stories

### Story 1 — Fetch the Posters tab

As a maintainer running the generator, I want it to read the "Posters" tab of
the same spreadsheet so that the posters page is built from the sheet the
committee already maintains, with no second secret or configuration.

**Acceptance criteria**

- WHEN the generator runs with `PROGRAM_SHEET_ID` set, THE system SHALL fetch
  the "Posters" tab from the same spreadsheet using the same gviz CSV endpoint
  and sheet-name parameter `loadCSV()` uses for "Schedule".
- WHEN the generator runs offline with `--file <schedule.csv>`, THE system
  SHALL accept a second flag `--posters-file <posters.csv>` and read the
  Posters tab from that path instead of the network.
- WHEN the generator runs offline with `--file` and no `--posters-file`, THE
  system SHALL build every schedule artifact as today and skip the posters
  page without error, logging that posters were skipped.
- WHEN the Posters tab fetch returns a non-OK HTTP status, or the response
  has no header row containing a `Poster Title` column, THE system SHALL exit
  non-zero with a message naming the Posters tab, so a renamed or missing tab
  fails the daily workflow instead of silently serving a stale page.
- WHEN the Posters tab header row is read, THE system SHALL match the column
  names `Authors`, `Poster Title`, `Abstract`, and `DOI` case-insensitively
  and ignoring non-letter characters, in any column order, SHALL accept
  `Title` as an alias for `Poster Title`, and SHALL ignore any other column.

### Story 2 — One entry per poster

As a program committee member editing the Posters tab, I want each row to
become one entry on the Posters page so that the sheet stays the only thing
anyone edits.

**Acceptance criteria**

- WHEN a Posters row has a non-empty `Poster Title`, THE system SHALL emit one entry
  for it on `pages/program/abstracts/posters.md`.
- WHEN a Posters row has an empty `Poster Title`, THE system SHALL skip that row.
- WHEN entries are emitted, THE system SHALL list them in sheet row order.
- WHEN an entry is emitted, THE system SHALL give it an `id` anchor derived
  from its slugified title, deduplicated with `-2`/`-3` suffixes, using the
  same `slugify()` and dedupe scheme `assignAnchors()` uses (`:417-441`).
- WHEN `Authors` is non-empty, THE system SHALL render it verbatim as the
  byline (`abstract__people`), as the other pages render People.
- WHEN `Authors` is empty, THE system SHALL render the row with the title
  alone rather than an empty byline.

### Story 3 — Collapsed and expanded presentation

As a conference attendee, I want the Posters page to look and behave like the
Talks and Papers pages so that I can scan titles and open one abstract at a
time.

**Acceptance criteria**

- WHEN the Posters page is rendered, THE system SHALL use the same front
  matter shape, generator banner, stylesheet link, `.abstracts` wrapper,
  expand-all toolbar, and deferred script tag `renderAbstractPage()` emits
  for the other formats (`:871-909`).
- WHEN an entry is rendered, THE system SHALL render it as a
  `<details class="abstract">` disclosure whose `<summary>` carries the title
  and byline heading. Every poster row is collapsible, because every body
  carries at least the permalink from Story 6; the static-row branch of
  `renderAbstractEntry()` (`:849-869`) is never used on this page.
- WHEN an entry is expanded and its `Abstract` is non-blank, THE system SHALL
  show the `Abstract` rendered through the same Liquid-capture + `markdownify`
  pipeline and `escLiquid()` escaping the other pages use, so Markdown renders
  and raw HTML/Liquid stays literal.
- WHEN an `Abstract` consists only of whitespace, THE system SHALL treat it as
  absent and omit the abstract block.
- WHEN an entry has a non-blank `DOI`, THE system SHALL show, after the
  abstract, a link whose visible text is the DOI and whose `href` resolves it:
  a value already starting with `http://` or `https://` is used as given, and
  any other value is prefixed with `https://doi.org/`.
- WHEN a `DOI` value is rendered, THE system SHALL HTML-escape it in both the
  text and the `href`.
- WHEN an entry has an empty `DOI`, THE system SHALL omit the DOI link rather
  than render an empty one.

### Story 4 — Page registration: menu and pruning

As a maintainer, I want the posters page to be a first-class generated page so
that it appears in the program menu and survives rebuilds.

**Acceptance criteria**

- WHEN the posters page is written, THE system SHALL include it in the page
  map handed to `writeMenubar()`, so `_data/menus/program.yml` gains a
  "Posters" item at `program/posters/` in the `FORMATS` vocabulary position.
- WHEN the posters page is written, THE system SHALL carry the existing
  `PAGE_BANNER` so pruning recognizes it as generated.
- WHEN the Posters tab is present, THE system SHALL NOT prune `posters.md` in
  the same run.
- WHEN the Posters tab is skipped (offline without `--posters-file`), THE
  system SHALL leave an existing banner-carrying `posters.md` in place rather
  than pruning it, and SHALL keep its menubar entry if the file exists.
- WHEN the Posters tab is fetched successfully but contains zero rows with a
  Poster Title, THE system SHALL prune an existing banner-carrying `posters.md` and
  drop its menu entry, matching how a format that leaves the Schedule is
  handled.
- WHEN `pages/program/abstracts/posters.tbd` exists, THE system SHALL leave it
  untouched (it carries no banner).

### Story 5 — Posters tab owns the posters page; the schedule links into it

As a maintainer, I want one source of truth for the posters page so that the
Schedule tab and the Posters tab never fight over `posters.md`, while a
Schedule row whose Event Format is "Poster" still leads readers to that page.

**Acceptance criteria**

- WHEN the Schedule tab contains events with Event Format "Poster", THE system
  SHALL keep rendering their "Poster" pill on the schedule but SHALL NOT
  generate `posters.md` entries from them.
- WHEN a Schedule Poster-format event's slugified Event Title matches the
  anchor of a Posters-tab entry, THE system SHALL link the event title on the
  schedule to `program/posters/#<that anchor>`.
- WHEN a Schedule Poster-format event has no matching Posters-tab entry (or
  the Posters tab was skipped), THE system SHALL link the event title to the
  page top, `program/posters/`.
- WHEN a Schedule Poster-format event is linked, THE system SHALL do so
  regardless of whether it carries People, an Event Description, or a DOI.
- WHEN the Schedule tab contains Poster-format events, THE system SHALL still
  record them in `_data/program.json` with their format text as today, and
  SHALL record the resolved link as `href` as it does for other page formats.
- WHEN the Posters tab is read, THE system SHALL NOT add its rows to
  `_includes/program-schedule.html`, `_includes/program-grid.html`, or
  `_data/program.json`.
- WHEN the fixture build (`--file fixtures/schedule.csv`) runs, THE system
  SHALL therefore no longer produce a schedule-derived `posters.md` from
  fixture rows 33-34.

### Story 6 — Share a link to one poster

As a visitor, I want to obtain a link to a specific poster row so that I can
send someone straight to that poster's entry.

**Acceptance criteria**

- WHEN an entry is expanded, THE system SHALL show, alongside the DOI link, a
  permalink whose `href` is `#<anchor>` for that entry.
- WHEN a visitor activates the permalink, THE system SHALL update the browser
  URL fragment to that anchor so the address bar holds a shareable link, and
  the existing `assets/js/abstracts.js` hash handling SHALL keep the entry
  open and scrolled clear of the navbar.
- WHEN a visitor loads `program/posters/#<anchor>`, THE system SHALL open that
  entry and scroll it into view, using the existing deep-link behavior from
  spec 002 with no new script.
- WHEN anchors are compared across rebuilds with unchanged titles, THE system
  SHALL produce identical values, so shared links keep working.

### Story 7 — DOI on schedule events

As a program committee member, I want the Schedule tab's `DOI` column to show
up on the abstract pages the same way a poster's DOI does, so that talks,
papers, and notebooks with a published artifact link to it.

**Acceptance criteria**

- WHEN the Schedule tab header row contains a `DOI` column, THE system SHALL
  read it on event rows (rows with an Event Title) as the event's DOI.
- WHEN an event on a page format has a non-blank DOI, THE system SHALL render,
  after its abstract in the expanded body of its abstract-page entry, a link
  whose visible text is the DOI and whose `href` resolves it by the same rule
  as Story 3 (`http(s)://` used as given, otherwise `https://doi.org/`
  prefixed), HTML-escaped in both text and `href`.
- WHEN an event has a DOI but no Event Description, THE system SHALL still
  render it as a collapsible `<details>` entry, because the body has a link
  to show.
- WHEN an event has a DOI but neither People nor an Event Description, THE
  system SHALL deep-link its schedule title to its abstract-page entry, since
  that entry now has something worth jumping to.
- WHEN an event's DOI is empty, THE system SHALL render its entry exactly as
  today, with no metadata line.
- WHEN an event has a non-empty DOI, THE system SHALL record it in
  `_data/program.json` as `doi`, appended only when non-empty so a sheet
  without the column produces byte-identical JSON.
- WHEN a Schedule Poster-format event carries a DOI, THE system SHALL record
  it in `_data/program.json` only; its page entry comes from the Posters tab.

### Story 8 — Keep the build honest

As a maintainer, I want the new input and output to behave like the existing
generated artifacts so that scheduled rebuilds stay quiet and reproducible.

**Acceptance criteria**

- WHEN the generator runs twice against unchanged input, THE system SHALL
  report `posters.md` as unchanged on the second run and write nothing.
- WHEN the generator runs, THE system SHALL log the number of poster rows
  parsed alongside the existing schedule summary line.
- WHEN the repo ships `fixtures/posters.csv` and `fixtures/schedule.csv`
  gains a `DOI` column, THE system SHALL build them offline with
  `node scripts/build-program.js --file fixtures/schedule.csv
  --posters-file fixtures/posters.csv` exiting zero and producing pages
  Jekyll builds without error.
- WHEN a Schedule CSV has no `DOI` column, THE system SHALL produce
  byte-identical `_data/program.json` and abstract pages to today's output
  for every non-Poster event.
- WHEN the GitHub workflow `build-program.yml` runs, THE system SHALL commit
  `posters.md` and menubar changes through the existing `git add -A --
  pages/program/abstracts _data/menus` pathspecs with no workflow edit
  beyond documentation.
- WHEN README's "Building the Program Schedule" section is read, THE system
  documentation SHALL describe the Posters tab, its columns, the
  `--posters-file` flag, and the Posters-tab-wins rule from Story 5.

## Out of scope

- Any change to `assets/css/abstracts.css` or `assets/js/abstracts.js`. The
  DOI link and permalink render inside the existing `.abstract__body`; design
  may add a class for the metadata line but must not require new CSS to be
  readable.
- Adding posters to `_data/program.json` or a new `_data/posters.json`.
- Rendering any Posters-tab column other than `Authors`, `Poster Title`,
  `Abstract`, and `DOI`.
- Placing Posters-tab rows on the schedule (list or grid): the Schedule
  tab's own rows do that.
- Showing DOI links on the schedule list or grid views.
- A permalink line on non-poster abstract entries.
- Validating DOI syntax or checking that DOI links resolve.
- A copy-to-clipboard button for the permalink.
- Retiring `pages/program/abstracts/posters.tbd`.
- Search indexing of poster abstracts.

## Resolved decisions

- **Entry order:** sheet row order.
- **Missing or renamed Posters tab:** the build fails.
- **Schedule Poster events:** keep the pill, no page entries; the title links
  to the matching Posters-tab entry by slugified title, else to the page top.
  Posters-tab rows never appear in the list or grid views.
- **Schedule DOI:** rendered on the abstract pages as a body metadata link,
  same rule as posters. Not shown on the schedule list or grid.
- **Permalinks:** posters only. Schedule-derived entries already have deep
  links from the schedule and get no permalink line (unchanged output).
  *Superseded 2026-09-02 after review:* the in-body "Link to this poster"
  line was dropped in favor of the theme's sidebar contents list
  (`menubar_toc`, as on the Attend and Sponsor pages), one link per
  entry, on every abstract page. To make the theme's TOC include find
  them, entry anchors moved
  from the `<details>` wrapper to the `<h2>` heading on every abstract
  page, and `abstracts.js` opens the enclosing `<details>`.
- **Columns:** `Authors`, `Poster Title`, `Abstract`, `DOI`. The generator
  ignores any column it does not recognize.
- **Permalink placement:** inside the expanded body, on a metadata line with
  the DOI link, so every poster row is a collapsible entry. Placing it in the
  `<summary>` was rejected: a link inside `<summary>` competes with the
  disclosure toggle for the click.

## Open questions

- None outstanding.
