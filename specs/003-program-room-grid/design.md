# Design — program room grid

## Overview

`scripts/build-program.js` gains a second renderer, `renderGridHTML(days)`,
that walks the same folded structure `renderHTML()` (`:492-530`) walks and
writes `_includes/program-grid.html` through `writeIfChanged()` (`:748-758`).
Each conference day becomes a CSS Grid: column 1 is a time rail, columns 2..N
are rooms, and rows are 5-minute units, so a card's `grid-row: start / end`
places and sizes it proportionally with no JavaScript. Whole-venue sessions
(muted per `MUTED_TYPES` `:74`, or room empty/"Anywhere") render as bands
spanning all room columns; everything else is a card in its room's column,
split into lanes when two sessions in one room overlap.

The grid ships in the DOM of the Full Program page, `hidden`.
`pages/program/program.md` adds a `hidden` List/Grid toolbar, the grid
include, a stylesheet link, and a deferred script — the exact
progressive-enhancement pattern of the abstracts toolbar
(`renderAbstractPage()` `:645-650` + `abstracts.js`). Without JavaScript the
page is byte-for-byte today's list; with it, `assets/js/program-view.js`
reveals the toolbar, swaps the `hidden` attributes between `.program` and
`.program-grid`, persists the choice in localStorage, and drives the
"Talk details" toggle.

Cards link into the list view. To give them a target, a new
`assignSessionIds(days)` pass — the sibling of `assignAnchors()`
(`:410-428`) — stamps each session a deterministic `_sid`, which
`renderSession()` (`:448-490`) emits as the `<article>`'s `id`. Underscored
keys are already stripped by the JSON writer (`:773-775`), so
`_data/program.json` stays byte-identical.

Two data crumbs must survive folding for the grid's benefit, both
underscore-keyed and therefore invisible to JSON: the slot's numeric minutes
(`fold()` currently formats them away at `:381-384`) and the session's sheet
row (used for room ordering, currently dropped by the mapping at `:356-379`).

## Affected components

| File / module | Change |
| --- | --- |
| `scripts/build-program.js` — `fold()` (`:274-391`) | Mapped slots keep `_startMins`/`_endMins`; mapped sessions keep `_row`. Underscore keys — stripped from JSON. |
| `scripts/build-program.js` — new `assignSessionIds(days)` | Stamps `session._sid`: `slugify(weekday + '-' + title)`, deduplicated document-wide with `-2`/`-3` suffixes, same scheme as `assignAnchors()`. |
| `scripts/build-program.js` — `renderSession()` (`:448-490`) | The `<article>` gains `id="${s._sid}"`. Only markup change to the list view. |
| `scripts/build-program.js` — new `renderGridHTML(days)` + helpers (`computeDayGrid`, `assignLanes`, `renderGridCard`, `renderGridBand`) | Emits `_includes/program-grid.html`. |
| `scripts/build-program.js` — `main()` (`:760-777`) | Writes the new include via `writeIfChanged(OUT_GRID, …)` next to `OUT_HTML`. |
| `_includes/program-schedule.html` | Regenerated: session `id`s only. |
| `_includes/program-grid.html` | **New generated artifact.** |
| `pages/program/program.md` | Adds the `program-grid.css` link, the hidden toolbar, `{% include program-grid.html %}`, and the deferred `program-view.js` script. |
| `assets/css/program.css` | One addition: `scroll-margin-top: 5rem` on `.session`, so card links land clear of the fixed navbar (same value as `.program-day`, `:120`). |
| `assets/css/program-grid.css` | **New.** Tokens, grid geometry, sticky rail/headers, cards, bands, lanes, toolbar, mobile, print. |
| `assets/js/program-view.js` | **New.** View toggle + persistence, card-click view switch with history state, card-title line clamp. |
| `.github/workflows/build-program.yml` | Commit step stages `_includes/program-grid.html` too. |
| `README.md` | "Building the Program Schedule" documents the new artifact and its two assets. |
| `fixtures/schedule.csv` | Gains one same-room overlap pair (Story 4 has no fixture coverage today; the card-over-band cases already exist — Tue 12:45–1:15 inside lunch, Wed 3:00–3:30 vs the 3:15 closing). |
| `_data/program.json`, `_data/menus/program.yml`, abstract pages, `assignAnchors()`, `FORMATS` | Unchanged. |

## Detailed design

### 1. Data passes

**`fold()` additions.** The slot return object (`:380-387`) gains
`_startMins: slot.start, _endMins: slot.end`; the session mapping (`:356`)
gains `_row: s._row`. Sessions inherit their slot's time range — the sheet
gives events an Order, not times, so a card's geometry is its slot's.

**`assignSessionIds(days)`** runs in `main()` after `assignAnchors(days)`.
Traversal order is the render order (day → slot → room-ranked session), so
ids are deterministic for a given sheet. Base:
`slugify(day.weekday + '-' + session.title)` (`slugify()` `:395-397`) —
"Afternoon Tech Session (Workshops / BoFs)" appears in four rooms on one day,
so a document-wide `Map(base -> count)` appends `-2`/`-3`/`-4` exactly as
`assignAnchors()` does (`:418-421`). Examples:
`monday-welcome-and-plenary-session`,
`monday-afternoon-tech-session-workshops-bofs-3`.

### 2. Grid geometry

Per day:

- `dayStart` = earliest `slot._startMins`, floored to :00/:30;
  `dayEnd` = latest `slot._endMins`, ceiled to :00/:30.
- One row per 5 minutes, plus a header row:
  `rows = (dayEnd - dayStart) / 5`; minute *m* maps to grid line
  `2 + (m - dayStart) / 5` (line 1 opens the header row).
- Live Monday: 7:30am (450) → 5pm (1020) = 114 rows. All current times are
  :00/:15/:30/:45, and `parseTime` (`:198-207`) admits any minute — a 12:47
  start would break a 5-minute lattice, so minute values are rounded to the
  nearest 5 when mapping (display strings stay exact; a criterion-level
  placement error of ≤2.5 minutes is invisible at 0.5rem per row).

The generator emits counts, not layout, as inline custom properties:

```html
<div class="grid" style="--grid-cols:5;--grid-rows:114">
```

and the stylesheet owns the tracks:

```css
.program-grid .grid {
  display: grid;
  grid-template-columns: var(--grid-rail) repeat(var(--grid-cols), minmax(var(--grid-col-min), 1fr));
  grid-template-rows: auto repeat(var(--grid-rows), var(--grid-row-h));
}
```

`--grid-row-h: 0.5rem` (90 min ≈ 9rem of card) and `--grid-col-min: 10rem`
at desktop; both shrink at the 40rem breakpoint and again in print. Because
the row height lives in one token, the "zoom" the reference screenshot offers
is out of scope but trivially retrofittable.

**Columns.** A session is a **band** when `muted || !room || room ===
'Anywhere'` (case-insensitive, matching `renderSession()`'s room test
`:453`); otherwise a **card**. Rooms come from cards only (Story 3: a room
hosting nothing but Registration gets no column), ordered by `roomRank()`
(`:269-272`) then by the room's minimum `_row` that day. Live data yields
Mon 5 columns, Tue/Wed 4.

**Rounding guard.** `end < start` never happens today (`fold()` sets
`end = start` when the End cell is empty, `:280`); the renderer clamps
`rowSpan = max(endRow - startRow, 3)` so a zero-duration session still draws
a 15-minute-tall card (Story 1's minimum-height criterion).

### 3. Include markup

```html
<!-- Generated by scripts/build-program.js — do not edit by hand. … -->
<div class="program-grid" hidden>
  <nav class="program-grid__nav" aria-label="Program days (grid)">
    <span class="program-grid__nav-label" aria-hidden="true">Jump to</span>
    <a class="program-grid__pill" href="#grid-day-monday">Monday</a>…
  </nav>
  <section class="program-grid__day" id="grid-day-monday" aria-labelledby="grid-day-monday-title">
    <h2 class="program-grid__title" id="grid-day-monday-title">Monday<span class="program-grid__date">, October 19</span><span class="program-grid__draft">  (Draft — subject to change)</span></h2>
    <div class="program-grid__scroller" tabindex="0" role="region" aria-label="Monday room grid">
      <div class="grid" style="--grid-cols:5;--grid-rows:114">
        <div class="grid__corner"></div>
        <div class="grid__room" style="grid-column:2">San Jose Ballroom Salon 3 &amp; 4</div>
        …
        <div class="grid__rule grid__rule--hour" style="grid-row:8" aria-hidden="true"></div>
        <div class="grid__time" style="grid-row:8/20" aria-hidden="true">8am</div>
        …
        <div class="grid__band grid__band--muted" style="grid-row:2/14">
          <p class="grid__band-label">Registration <span class="grid__band-room">— Prefunction</span> <span class="grid__band-time">7:30–8:30am</span></p>
        </div>
        …
        <a class="grid__card grid__card--plenary" href="#monday-welcome-and-plenary-session"
           style="grid-column:2;grid-row:14/32;--lane:0;--lanes:1">
          <p class="grid__card-time"><time datetime="2026-10-19T08:30:00-07:00">8:30</time>–<time datetime="2026-10-19T10:00:00-07:00">10am</time><span class="grid__sr">, San Jose Ballroom Salon 3 &amp; 4</span></p>
          <p class="grid__card-eyebrow">Plenary</p>
          <h3 class="grid__card-title">Welcome and Plenary Session</h3>
        </a>
        …
      </div>
    </div>
  </section>
  …
</div>
```

Element by element:

- **Root `hidden`.** The generator emits it; `program-view.js` swaps it with
  `.program`'s. `[hidden]` wins because neither wrapper carries a `display`
  rule. With JS off the grid never renders and print output is unchanged —
  Stories 5, 7, 8.
- **Day nav** mirrors `renderHTML()`'s (`:498-504`) with `grid-day-` ids and
  a distinct `aria-label`, so no id collides with the list's `day-monday`
  set (both markups share the DOM — Story 5).
- **Scroller** is the two-axis scroll container (§6). `tabindex="0"` +
  `role="region"` + a day-naming label make it keyboard-scrollable and
  announceable — Story 8. (A focusable scroll container is the established
  fix for keyboard-trapped overflow; the label prevents a bare "region".)
- **Header cells** (`grid__corner`, `grid__room`) occupy the `auto` first
  row and stick to the scroller's top.
- **Rules and rail.** One `grid__rule` per half hour (`--hour` modifier on
  the hour, lighter otherwise), spanning `grid-column: 1 / -1` via CSS; one
  `grid__time` label per hour, `grid-column: 1`, spanning down to the next
  hour, text via `fmtTime()` (`:210-217`). All `aria-hidden` — every card
  and band already announces its own times, so the rail is decoration to a
  screen reader (Story 8).
- **Bands** span `grid-column: 2 / -1` via CSS. The label carries the title,
  the room (when the sheet named one — Resolved decision 4), and the compact
  time range. Muted bands take the muted treatment; a non-muted "Anywhere"
  band (none in live data, but legal) renders neutral.
- **Cards** are `<a href="#<sid>">` wrapping all their text, so the
  accessible name is "time, room, title, …" for free (Story 8's naming
  criterion). Content, in order: compact time range (`<time>` elements with
  `fmtISO()` datetimes, meridiem-deduped exactly like `renderHTML()`
  `:516-518`), a visually-hidden room span (`grid__sr` — the column header
  conveys room only visually), the eyebrow (`type`, and
  `· Chair: <name>` when present, mirroring `renderSession()` `:457-461`),
  and the `<h3>` title. Talks are not listed (Resolved decision 5, revised
  after verification). Card text goes through `esc()` (`:434-437`); no
  Markdown is rendered on cards, so no Liquid capture is involved.
- **DOM order** inside `.grid`: header cells, rail, bands (chronological),
  then cards **grouped by room in column order, sorted by start** — the
  Story 8 reading order. Grid placement is independent of source order, and
  painting order follows DOM, which is what puts cards above bands
  (Story 3) with no z-index arithmetic between them.

### 4. Lanes — same-room overlaps

Per room, per day (`assignLanes(cards)`):

1. Sort cards by `startMins`, then `_row`.
2. Sweep chronologically, growing a **cluster** while the next card starts
   before the cluster's running max end.
3. Within a cluster, assign each card the lowest-numbered lane whose last
   occupant has ended; the cluster's lane count is the max concurrency.
4. Every card in the cluster gets `--lane:i;--lanes:k`; non-overlapping
   cards keep the default `--lane:0;--lanes:1` (full width — Story 4).

CSS turns lanes into horizontal splits — grid items sharing an area overlap
by default, so the split is width + offset, not extra columns:

```css
.program-grid .grid__card {
  --lane-w: calc((100% - 0.5rem * (var(--lanes) - 1)) / var(--lanes));
  width: var(--lane-w);
  margin-left: calc((var(--lane-w) + 0.5rem) * var(--lane));
}
```

(a 0.5rem gap between lanes; with `--lane:0;--lanes:1` this collapses to
full width and zero offset, so the default card needs no special case). Cross-room overlaps need nothing —
they are different columns (Story 4, third criterion).

### 5. `pages/program/program.md`

After the existing `program.css` link (`:13`) and before the schedule
include (`:23`):

```html
<link rel="stylesheet" href="{{ site.baseurl }}/assets/css/program-grid.css?v={{ site.time | date: '%s' }}">

<div class="program-toolbar" hidden>
  <div class="program-toolbar__views" role="group" aria-label="Schedule view">
    <button type="button" class="program-toolbar__view" data-view="list" aria-pressed="true">List</button>
    <button type="button" class="program-toolbar__view" data-view="grid" aria-pressed="false">Grid</button>
  </div>
</div>

{% include program-schedule.html %}
{% include program-grid.html %}

<script src="{{ site.baseurl }}/assets/js/program-view.js" defer></script>
```

- The toolbar is hand-authored (it controls both views, so it belongs to
  the page, not to either generated include) and ships `hidden` — Story 8's
  no-JS criterion.
- View buttons use `aria-pressed`, one true at a time — a segmented control
  a screen reader announces as "List, toggle button, pressed".
- Liquid processes the includes as before; nothing else on the page moves.

### 6. `assets/css/program-grid.css`

Header comment and conventions per `program.css:1-21`; tokens duplicated on
`.program-grid` (accent `var(--us-rse-main)`, ink `#4a4a4a`, strong
`#363636`, muted `#757575`, hairline `#dbdbdb`, wash `#f4ecf1`) for the same
reason `abstracts.css` duplicates them: `program.css` scopes its block to
`.program`. Single accent throughout — Resolved decision 1.

- **Theme neutralization**: `.content .program-grid :is(h2, h3, p)` /
  `ol` / `li + li` margins re-zeroed, the same block `program.css:52-68`
  uses; `.program-grid .program-grid__title` copies the two-class
  day-title override (`program.css:118-128`). The theme's `reboot.css`
  also styles a generic `.grid` (flex row, `-0.9375em` side margins), so
  `.program-grid .grid` resets `margin: 0` alongside `display: grid`.
- **Scroller**: `overflow: auto; max-height: 85vh` — both axes scroll
  *inside* it, which is the only way `position: sticky` headers can work
  while the grid also scrolls horizontally (sticky pins to the nearest
  scrollport; a horizontal-only scroller has no vertical scrollport to pin
  to). The page body never scrolls horizontally — Stories 1 and 6.
  `:focus-visible` outline on the scroller for its `tabindex="0"`.
- **Sticky chrome**: `.grid__room { position: sticky; top: 0; z-index: 3 }`,
  `.grid__time { position: sticky; left: 0; z-index: 2 }`,
  `.grid__corner` sticky both with `z-index: 4`; all with solid `#fff`
  backgrounds so cards slide beneath them.
- **Cards**: white card, hairline border, small radius, `overflow: hidden`
  (Story 2's clipping), left inset echoing `--session-inset`; hover /
  `:focus-visible` accent border like `.program-nav__pill`
  (`program.css:108-112`). `grid__card--plenary` reuses the wash +
  `inset 3px 0 0` accent shadow of `.session--plenary` (`program.css:305-311`);
  muted cards never exist (muted ⇒ band). Type ramp: time and eyebrow at
  0.6875rem like `.session__eyebrow`, title at 0.9375rem/600. The title is
  a `-webkit-box` with `overflow: hidden`; `program-view.js` sets its
  `-webkit-line-clamp` per card to the lines that fit below the time and
  eyebrow, so an over-long title ends in an ellipsis instead of a sliced
  line.
- **Bands**: full-track background (`#fafafa`), dashed top/bottom hairlines,
  centered single-line label in the muted ramp of `.session--muted`
  (`program.css:340-345`).
- **Toolbar**: pill-styled buttons matching `.program-nav__pill`;
  `[aria-pressed="true"]` gets the accent border + wash.
- **Mobile (`max-width: 40rem`)**: `--grid-col-min: 7.5rem`, tighter card
  padding, smaller title, rail narrows — Story 6.
- **Print**: `.program-grid__scroller { overflow: visible; max-height: none }`;
  sticky dropped; `.program-grid__day { break-before: page }` (first day
  excepted via `.program-grid__nav + .program-grid__day`);
  `--grid-col-min: 0` and a ~8pt ramp so all columns fit the page;
  toolbar and nav hidden; plenary wash swapped for a solid 3px black
  `border-left` and bands keep their dashed rules — box-shadows and
  background colours are exactly what greyscale printing drops (Story 7).
  Which view prints is not a print-CSS question: the inactive view carries
  `hidden`, so printing the page prints the active view only.

### 7. `assets/js/program-view.js`

Dependency-free IIFE, deferred. Skeleton (as first built; see the notes
for the two later revisions — the details toggle is gone, and card clicks
now go through `history.pushState` so Back restores the grid):

```js
(function () {
  'use strict';
  var toolbar = document.querySelector('.program-toolbar');
  var list = document.querySelector('.program');
  var grid = document.querySelector('.program-grid');
  if (!toolbar || !list || !grid) return;

  var KEY_VIEW = 'usrse26:program-view';
  var KEY_DETAILS = 'usrse26:program-details';
  // localStorage throws in some private modes — degrade to in-page state.
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  function setView(view) { /* swap [hidden], sync aria-pressed, show/hide
                              details button, store(KEY_VIEW, view) */ }
  function setDetails(shown) { /* toggle .program-grid--no-details,
                                  aria-pressed, store */ }

  toolbar.hidden = false;
  setView(read(KEY_VIEW) === 'grid' ? 'grid' : 'list');
  setDetails(read(KEY_DETAILS) !== 'hidden');

  // Card click: switch to the list, then jump. stopPropagation keeps
  // app.js's SmoothScroll (bound on document, bubble phase) from seeing
  // the click and trying to animate to a just-unhidden target.
  grid.addEventListener('click', function (e) {
    var card = e.target.closest('a.grid__card');
    if (!card) return;
    e.preventDefault();
    e.stopPropagation();
    setView('list');
    var id = card.getAttribute('href').slice(1);
    if ('#' + id === location.hash) {
      var el = document.getElementById(id);
      if (el) el.scrollIntoView();
    } else {
      location.hash = id;
    }
  });
})();
```

Notes:

- **View switch** is two `hidden` swaps plus button state — no classes on
  the views themselves, so print and no-JS fall out of the same attribute.
  Default is the list (Story 5), so first paint never flashes.
- **Card navigation.** Setting `location.hash` after the list is visible
  makes the browser do the scroll natively; the new
  `.session { scroll-margin-top: 5rem }` clears the fixed navbar (Story 5).
  The same-hash branch covers clicking the same card twice. SmoothScroll
  (`app.js:34-40`) binds one delegated listener on `document`; this
  handler sits on `.program-grid`, an ancestor of the card, so in the
  bubble phase it runs first and `stopPropagation()` ends the matter.
  Grid **day-pill** clicks are deliberately *not* intercepted: their
  targets are visible whenever the pills are, so SmoothScroll handles them
  with the same animated, navbar-offset scroll the list pills get.
- **History.** Card clicks `replaceState({programView:'grid'})` on the
  entry being left and `pushState({programView:'list'}, '', '#<sid>')`,
  then call `scrollIntoView()` themselves (pushState never scrolls). A
  `popstate` listener restores whichever view the entry recorded, so Back
  returns to the grid and Forward to the list entry; on load a recorded
  view wins over the stored preference for that entry. Toolbar switches
  re-stamp the current entry too (merged over SmoothScroll's record, never
  replacing it), otherwise Back after "card → Back → List → day pill"
  would land on a stale "grid" stamp. Stamped entries without a
  SmoothScroll record get their scroll from this script on `popstate`:
  the hash target if any, else the top.
- **Title clamp.** `clampTitles()` measures each card's room below the
  time and eyebrow and sets `-webkit-line-clamp` on the title; it runs on
  every `setView('grid')` (hidden elements have no layout) and, debounced,
  on resize.

### 8. Generator wiring, workflow, README

- `const OUT_GRID = path.join(REPO_ROOT, '_includes', 'program-grid.html')`
  next to `OUT_HTML` (`:104`); `main()` adds
  `writeIfChanged(OUT_GRID, renderGridHTML(days))` after the schedule write
  (`:771`). Unchanged input ⇒ `unchanged` log, no write — Story 9. The grid
  include, like the schedule include, contains no build-time-varying bytes
  (all times come from the sheet).
- Workflow commit step (`build-program.yml:57-59`): the pathspec list gains
  `_includes/program-grid.html`. The file always exists by then — the
  generator writes it unconditionally in the same job — so the "never name
  a maybe-missing file" caveat in the step's comment doesn't bite; the
  comment gets a line saying so.
- README "Building the Program Schedule": new artifact
  `_includes/program-grid.html` and the two hand-written assets
  `assets/css/program-grid.css` / `assets/js/program-view.js`, plus a
  sentence on the toggle and its no-JS behavior.

### 9. Edge cases

| Case | Behavior |
| --- | --- |
| Non-muted session in a named room with empty Session Format (live: Monday "Lunch Break (Sponsorship available)" in Salon 3 & 4, type "") | Honest to the data: renders as a normal card in its column. Fix belongs in the sheet (set Session Format: Meal), not the renderer. |
| Muted session in a named room (Registration/Prefunction, Tue/Wed lunch in Salon 3 & 4) | Band spanning all columns, room named in the label — Resolved decision 4; Prefunction never spawns a column. |
| Card inside a band's time range (Tue 12:45–1:15 Working Group Fair inside 12:00–1:30 lunch) | Both drawn; card paints above (DOM order) — Story 3. |
| Overlapping non-muted sessions, same room | Lanes (§4); fixture gains a covering case. |
| Overlapping band and band (Wed 3:00–3:30 break vs 3:15–4:30 plenary — plenary is a card, but two muted rows could overlap) | Bands don't lane; they stack translucent-free in DOM order. Later band's dashed rules keep both legible. Accepted: the sheet has never produced it. |
| Session with `end == start` | 3-row (15-min) minimum span (§2). |
| Times off the 5-minute lattice | Rounded to nearest 5 for placement only (§2); displayed text exact. |
| Day whose sessions are all bands | Grid renders rail + bands, zero room columns (`--grid-cols:0` → `repeat(0, …)` is valid and empty). Cannot occur in current data. |
| Duplicate session titles | `assignSessionIds` dedupe suffixes; deterministic by traversal order. |
| localStorage unavailable | try/catch → toggle still works, choice lasts the page view. |
| Generator re-run on unchanged input | `writeIfChanged` reports all three includes unchanged. |
| `--file fixtures/schedule.csv` | Grid renders fixture days incl. both overlap flavours; Jekyll builds the include (plain HTML, no Liquid beyond none — card text is `esc()`ed, no captures). |

### 10. Intentionally dropped

Nothing. Every acceptance criterion is mapped below.

## Requirements coverage

| Story / criterion | Where addressed |
| --- | --- |
| 1 — one grid per day, list-style heading + draft note | §3 day section / `program-grid__title` |
| 1 — columns = rooms with non-band sessions, ROOM_ORDER then first appearance | §2 Columns; `_row` kept in §1 |
| 1 — rail spans day rounded to half hour; hour labels, half-hour rules | §2 bounds; §3 rules/rail |
| 1 — proportional placement | §2 row lattice |
| 1 — zero-duration minimum height | §2 rounding guard; §9 |
| 1 — sticky headers (vertical) and rail (horizontal) | §6 Scroller + Sticky chrome |
| 2 — eyebrow with Session Format | §3 card eyebrow |
| 2 — chair on card | §3 card eyebrow |
| 2 — no talks on cards | §3 card content |
| 2 — title ellipsis | §6 title clamp; §7 clampTitles |
| 2 — plenary treatment | §6 `grid__card--plenary` |
| 2 — muted treatment | §6 bands (muted ⇒ band, §2) |
| 2 — compact time on card | §3 card time / `fmtTime` dedupe |
| 3 — Anywhere/empty ⇒ band | §2 band classification |
| 3 — muted named-room ⇒ band with room text | §2, §3 band label; §9 |
| 3 — card above overlapping band | §3 DOM order; §9 |
| 3 — muted-only room ⇒ no column | §2 Columns |
| 4 — same-room overlap ⇒ lanes, none hidden | §4 |
| 4 — no overlap ⇒ full width | §4 step 4 |
| 4 — cross-room overlap unaffected | §4 closing note |
| 5 — toggle shown with JS, near day nav | §5 toolbar; §7 init |
| 5 — one view visible, no page load | §7 setView |
| 5 — persisted choice, default list | §7 localStorage |
| 5 — grid's own pills, no id collisions | §3 day nav |
| 5 — card ⇒ list view + scroll clear of navbar | §7 card click; `scroll-margin-top` in program.css |
| 5 — Back returns to the grid | §7 History |
| 5 — stable deterministic session ids | §1 assignSessionIds |
| 6 — horizontal scroll in container, body never scrolls | §6 Scroller |
| 6 — heading/pills outside scroller | §3 structure (nav and h2 precede scroller) |
| 6 — 40rem reductions | §6 Mobile |
| 7 — active view prints; list-active unchanged | §6 Print closing note |
| 7 — page per day | §6 Print `break-before` |
| 7 — columns fit, sticky dropped | §6 Print |
| 7 — no pills/toggles in print | §6 Print |
| 7 — greyscale-safe distinctions | §6 Print borders/dashes |
| 8 — DOM reading order by room/start with time+room+title | §3 DOM order + card `grid__sr` room span |
| 8 — cards tabbable, focus ring, accessible name | §3 cards as `<a>`; §6 focus styles |
| 8 — toggle keyboard-operable, state exposed | §5 `aria-pressed`; §6 toolbar styles |
| 8 — no JS ⇒ today's list, no toggle/grid | §3 root `hidden`; §5 toolbar `hidden` |
| 9 — unchanged input ⇒ no write | §8 |
| 9 — written via writeIfChanged | §8 |
| 9 — workflow stages the include | §8 |
| 9 — fixture build green incl. overlaps | §9 fixture row + existing cases; tasks verify |
| 9 — program.json byte-identical | §1 underscore keys; JSON replacer `:773-775` |
| 9 — README updated | §8 |
