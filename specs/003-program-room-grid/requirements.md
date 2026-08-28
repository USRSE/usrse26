# Requirements — program room grid

Status: approved

## Summary

The Full Program page (`pages/program/program.md` → `_includes/program-schedule.html`)
renders the schedule as a vertical list: one `.slot` per time range, the
concurrent sessions stacked beneath it. That layout answers "what is
happening now?" well but not "which room do I go to?" — with three to five
parallel rooms per slot, comparing rooms means reading down a stack.

This feature adds a second, room-oriented view in the style of the reference
screenshot (a Sched-like day grid): one grid per conference day, **rooms as
columns**, **time as the vertical axis**, and each session drawn as a card
positioned and sized proportionally to its start/end. Breaks and other
whole-venue sessions render as bands spanning every room column.

The grid lives on the existing Full Program page behind a **List / Grid
toggle** — not on a separate page. The toggle is JavaScript-driven; without
JavaScript the page renders the list exactly as today and never shows the
toggle, following the same progressive-enhancement pattern as the abstracts
toolbar (`renderAbstractPage()` emits it `hidden`; `abstracts.js` reveals it).

The grid is generated, not hand-authored. `scripts/build-program.js` already
folds the sheet into `days → slots → room-ranked sessions → talks` with
wall-clock minutes (`fold()`, `:274-391`), so the grid is a second renderer
over the same data, alongside `renderHTML()` (`:492-530`). It writes a new
include, `_includes/program-grid.html`, which `pages/program/program.md`
includes next to `program-schedule.html`. A new `assets/css/program-grid.css`
styles it in the idiom of `assets/css/program.css`, and a new small
`assets/js/program-view.js` drives the toggle.

Room ordering reuses `ROOM_ORDER` (`:61-69`), muted rows reuse `MUTED_TYPES`
(`:74`), and the day nav / draft note reuse the patterns in `renderHTML()`.
`_data/program.json`, `_data/menus/program.yml`, the abstract pages, and the
schedule sheet columns are untouched.

## User stories

### Story 1 — See a day laid out by room and time

As a conference attendee, I want each day's sessions arranged in a room ×
time grid so that I can see at a glance what runs in parallel and where.

**Acceptance criteria**

- WHEN the grid view renders, THE system SHALL show one grid per conference
  day, in date order, each headed by the weekday and date in the same style
  as the list view's day heading (including the "Draft — subject to change"
  note while it is present in `renderHTML()`).
- WHEN a day's grid renders, THE system SHALL show one column per room that
  hosts at least one non-whole-venue session that day, ordered by
  `ROOM_ORDER` rank and then by first appearance in the sheet, with the room
  name as a column header.
- WHEN a day's grid renders, THE system SHALL show a vertical time rail
  spanning from the day's earliest session start to its latest session end,
  rounded outward to the half hour, with a labelled tick at every hour and a
  lighter unlabelled gridline at every half hour.
- WHEN a session has a start and end, THE system SHALL position its card so
  that its top edge aligns with the start time and its bottom edge with the
  end time on the rail (proportional placement, not one row per slot).
- WHEN a session's end equals its start (no End cell in the sheet), THE
  system SHALL render its card at a minimum legible height rather than zero
  height.
- WHEN a day's grid renders, THE system SHALL keep the room headers visible
  while the reader scrolls vertically within the day and keep the time rail
  visible while the reader scrolls horizontally.

### Story 2 — Read a session card

As an attendee scanning a column, I want each card to tell me what the
session is so that I can decide whether to be in that room.

**Acceptance criteria**

- WHEN a session card renders, THE system SHALL show the session title and,
  when the sheet supplies Session Format, the format as an eyebrow label in
  the style of `.session__eyebrow`.
- WHEN a session has a chair, THE system SHALL show "Chair: <name>" on the
  card in the style of `.session__chair`.
- WHEN a session has events (talks), THE system SHALL NOT list them on the
  card — the card links to the list entry, which has them. (Revised after
  verification: talk lists were clipped inside short cards; see Resolved
  decision 5.)
- WHEN a session title is taller than the space its duration allows, THE
  system SHALL truncate it with an ellipsis on the last line that fits,
  never slicing a line or spilling into the next card.
- WHEN a session is a plenary, THE system SHALL render its card with the
  plenary treatment (accent bar and wash) used by `.session--plenary`.
- WHEN a session is muted (Break / Meal / Registration), THE system SHALL
  render it in the muted style used by `.session--muted` / `.slot--break`.
- WHEN a card renders, THE system SHALL show its start–end time on the card
  in the compact form `renderHTML()` uses ("10:30am–12pm", "7:30–8:30am"), so
  a reader need not track back to the rail.

### Story 3 — Whole-venue sessions span every room

As an attendee, I want breaks, meals, and other venue-wide sessions to read as
horizontal bands so that they visually separate the session blocks and are
not mistaken for a room-specific event.

**Acceptance criteria**

- WHEN a session's room is "Anywhere" or empty, THE system SHALL render it as
  a band spanning all room columns for its time range.
- WHEN a session is muted (per `MUTED_TYPES`), THE system SHALL render it as a
  band spanning all room columns even if the sheet names a specific room,
  and SHALL keep the room name visible on the band (e.g. "Lunch — San Jose
  Ballroom Salon 3 & 4"), matching the list view where muted rows show the
  room inline.
- WHEN a band and a room-specific card overlap in time (e.g. the 12:45–1:15pm
  Working Group Fair inside the 12:00–1:30pm lunch), THE system SHALL draw
  the card above the band so both remain readable.
- WHEN a room hosts only muted sessions on a given day (e.g. Prefunction
  hosting Registration only), THE system SHALL NOT create a column for that
  room that day.

### Story 4 — Overlapping sessions in one room

As a maintainer, I want the grid to remain honest when the sheet puts two
sessions in the same room at overlapping times so that nothing is silently
hidden.

**Acceptance criteria**

- WHEN two or more non-muted sessions in the same room overlap in time, THE
  system SHALL render every one of them side by side within that room's
  column, each at reduced width, none hidden behind another.
- WHEN sessions in the same room do not overlap, THE system SHALL render each
  at the column's full width.
- WHEN sessions overlap across different rooms (the normal parallel case),
  THE system SHALL render them in their own columns unaffected.

### Story 5 — Switch between list and grid

As an attendee, I want to flip the Full Program page between the list and the
room grid and to jump from a card to its full entry so that the grid stays a
navigation aid, not a dead end.

**Acceptance criteria**

- WHEN JavaScript is available on the Full Program page, THE system SHALL
  show a List / Grid view toggle above the schedule, near the "Jump to" day
  navigation.
- WHEN a reader activates "Grid", THE system SHALL hide the list view
  (including its day pills) and show the grid view, and vice versa, without
  a page load; exactly one view SHALL be visible at a time.
- WHEN a reader returns to the page later in the same browser, THE system
  SHALL restore their last chosen view (persisted client-side, e.g.
  localStorage), defaulting to the list.
- WHEN the grid view is shown, THE system SHALL show its own "Jump to"
  weekday pills targeting the grid's day sections; grid element ids SHALL
  NOT collide with the list view's ids (both markups are in the DOM at
  once).
- WHEN a reader activates a session card in the grid, THE system SHALL
  switch to the list view and scroll to that session's entry, landing clear
  of the fixed navbar.
- WHEN a reader presses the browser's Back button after activating a card,
  THE system SHALL return to the grid view on the same page (and Forward
  SHALL return to the list entry), never leaving the page on that first
  Back.
- WHEN the list view renders, THE system SHALL give every `.session` article
  a stable, deterministic `id` so that cards (and external links) can target
  it, and rerunning the generator on unchanged input SHALL yield the same
  ids.

### Story 6 — Narrow viewports

As an attendee on a phone or in a narrow browser window, I want the grid to
remain usable so that I am not forced back to the list.

**Acceptance criteria**

- WHEN the available width is narrower than the sum of the room columns at
  their minimum width, THE system SHALL let the grid scroll horizontally
  inside its own container, with the time rail pinned at the left edge, and
  SHALL NOT cause the page body to scroll horizontally.
- WHEN the grid scrolls horizontally, THE system SHALL keep the day heading
  and the day navigation pills in place (they are outside the scroll
  container).
- WHEN the viewport is narrower than 40rem (the breakpoint `program.css` and
  `abstracts.css` use), THE system SHALL reduce card padding and type scale
  so the minimum column width can shrink without cards becoming unreadable.

### Story 7 — Print

As a program committee member, I want a printed grid to be legible so that a
one-page-per-day room chart can be handed out.

**Acceptance criteria**

- WHEN the Full Program page is printed, THE system SHALL print only the
  currently active view (printing with the list active behaves exactly as
  today).
- WHEN the grid view is printed, THE system SHALL start each day on a new
  page.
- WHEN the grid view is printed, THE system SHALL fit all of a day's columns
  within the page width (no clipping from the on-screen scroll container)
  and drop sticky positioning.
- WHEN the grid view is printed, THE system SHALL omit the day navigation
  pills and the view toggle.
- WHEN the grid view is printed, THE system SHALL preserve the plenary and
  muted distinctions in a way that survives greyscale printing (borders or
  hatching, not colour alone).

### Story 8 — Accessible without a pointer or a screen

As a keyboard or screen-reader user, I want the grid's information to be
reachable in reading order so that the visual layout does not hide the
schedule from me.

**Acceptance criteria**

- WHEN the grid include is read in DOM order, THE system SHALL present, per
  day, sessions grouped by room in column order and sorted by start time
  within each room, each announcing its time range, room, and title.
- WHEN a card is a link (Story 5), THE system SHALL make it reachable by Tab
  with a visible focus indicator, and its accessible name SHALL include the
  session title and time range.
- WHEN the view toggle renders, THE system SHALL make it keyboard-operable
  with a visible focus indicator, and each button SHALL expose its current
  state to assistive technology.
- WHEN JavaScript is unavailable, THE system SHALL render the list view
  exactly as today, and SHALL NOT display the view toggle or the grid markup
  (the grid ships `hidden`, the same pattern as the abstracts toolbar).

### Story 9 — Keep the generator honest

As a maintainer re-running the generator, I want the new artifact to behave
like the existing ones so that scheduled rebuilds stay quiet and the fixture
build stays green.

**Acceptance criteria**

- WHEN the generator runs against unchanged input, THE system SHALL report
  `_includes/program-grid.html` as unchanged and write nothing.
- WHEN the generator runs, THE system SHALL write `_includes/program-grid.html`
  through `writeIfChanged()` alongside `_includes/program-schedule.html`.
- WHEN the `Rebuild program schedule` workflow commits, THE system SHALL
  stage `_includes/program-grid.html` alongside the artifacts it already
  stages.
- WHEN the generator runs with `--file fixtures/schedule.csv`, THE system
  SHALL exit zero and produce a grid include that Jekyll builds without
  error, exercising the fixture's overlapping cases (Tue 12:45–1:15pm inside
  lunch, Wed 15:00–15:30 break overlapping the 15:15 closing session).
- WHEN `_data/program.json` is compared before and after this change on the
  same input, THE system SHALL produce byte-identical output — the grid adds
  no new JSON fields.
- WHEN the README's "Building the Program Schedule" section is read, THE
  system SHALL list the new artifact, its stylesheet, and its script.

## Out of scope

- A separate grid page or any change to `_data/menus/program.yml` — the grid
  lives behind the on-page toggle (Resolved decision 6).
- A zoom (−/+) control for the vertical time scale, as in the reference
  screenshot. The scale is fixed per breakpoint.
- Filtering by room, format, or track; a "my schedule" / favourites feature;
  a "now" indicator line.
- Any change to the schedule sheet columns, `HEADER_ALIASES`, `fold()`'s data
  shape, `assignAnchors()`, `FORMATS`, or `_data/program.json`.
- The abstract pages, `abstracts.css`, and `abstracts.js`.
- Per-event (talk) timing — the sheet gives events an Order, not a time, so
  cards are per session; talks are listed within a card, not placed on the
  rail.
- Changing `_layouts/default.html` or the Bulma container to give the grid a
  wider canvas — the grid scrolls horizontally inside the existing content
  column instead.
- Deep-linking to the grid view via URL (fragment or query param) — the view
  choice is a client-side preference only.
- Search indexing of the grid markup.

## Resolved decisions

1. **Single accent system.** Cards are not tinted by track or type. The grid
   keeps `program.css`'s palette: brand purple for plenary, grey for muted,
   neutral otherwise, with the type eyebrow carrying the category as text —
   colour is never the only cue.
2. **Sidebar stays.** The Full Program page keeps `menubar: program`; the grid
   scrolls horizontally inside the content column when it does not fit.
3. **Session ids in the list include.** `.session` articles in
   `_includes/program-schedule.html` gain stable, deterministic ids (markup
   change only, no visual change) so grid cards can deep-link to them.
4. **Muted sessions always span.** A muted session in a named room (e.g.
   Lunch in Salon 3 & 4) renders as a full-width band with the room named in
   its text, so Prefunction/Registration never spawns a lonely column.
5. **No talks on cards.** Originally cards listed their talks behind a
   "Talk details" toggle; in verification the lists were cut off inside
   short cards, so both the lists and the toggle were removed. Cards carry
   time, eyebrow, and title, and the title ends in an ellipsis when it does
   not fit.
6. **On-page toggle, not a separate page.** The grid renders on `program/`
   behind a JS-driven List / Grid toggle. Without JS the page is the list,
   exactly as today.

## Open questions

- None outstanding.
