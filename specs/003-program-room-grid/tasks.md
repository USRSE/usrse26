# Tasks — program room grid

Ordered, small tasks. After each task the build stays green:
`node scripts/build-program.js --file fixtures/schedule.csv` exits 0 and
`git status` shows only the changes that task intends. From task 7 on,
"green" also means `bundle exec jekyll build` succeeds **against the working
tree after a generator run** — `pages/program/program.md` will reference
`_includes/program-grid.html`, which is generated, so a fresh checkout of an
intermediate commit will not Jekyll-build until task 11 commits the live
include. **The branch must not merge before task 11 lands.** Design section
references are to `design.md`.

**Fixture-build hygiene** (per spec 001 decision 16 / spec 002). A fixture
build rewrites the live-sheet artifacts. After inspecting fixture output,
restore before committing:

```
git checkout -- _includes/program-schedule.html _data/program.json \
                _data/menus/program.yml pages/program/abstracts
git clean -f pages/program/abstracts     # drops fixture-only pages
rm -f _includes/program-grid.html        # untracked fixture output (tasks 4-10)
```

Once task 11 has committed `_includes/program-grid.html`, replace the `rm`
with `git checkout -- _includes/program-grid.html`.

**JSON byte-identity check** (Story 9, used by tasks 2-3): before the task's
code change, run the fixture build and copy `_data/program.json` to the
scratchpad; after the change, rerun and `diff` the two. Comparing against the
*committed* file proves nothing — it is live-sheet output.

---

- [x] 1. **Fixture: same-room overlap** (Stories 4, 9) — The fixture has both
  card-over-band cases (Tue 12:45–1:15 Working Group Fair inside the
  12:00–1:30 lunch; Wed 3:00–3:30 break vs the 3:15–4:30 closing) but no
  same-room card overlap, so lanes (§4) would ship untested. Add one row
  overlapping an existing non-muted session in its own room, e.g. Market
  Street on 10/20: `10/20 16:00,10/20 16:45,Market Street,Mentoring
  Circles,…` with a non-muted Session Format (`BoF`), overlapping the
  existing 15:30–17:00 Decision Makers Panel. Verify: fixture build exits 0;
  restore artifacts per the hygiene note; only `fixtures/schedule.csv`
  committed.

- [x] 2. **`fold()` keeps minutes and rows** (Story 9; §1) — Take the JSON
  baseline first. Then: slot return object (`scripts/build-program.js:380-387`)
  gains `_startMins: slot.start, _endMins: slot.end`; session mapping
  (`:356`) gains `_row: s._row`. Verify: fixture build green;
  `_data/program.json` byte-identical to the baseline (the JSON replacer
  `:773-775` strips underscore keys); `_includes/program-schedule.html`
  unchanged. Restore artifacts.

- [x] 3. **Session ids in the list view** (Story 5; §1) — Add
  `assignSessionIds(days)`: schedule-traversal walk, base
  `slugify(day.weekday + '-' + session.title)`, document-wide dedup map with
  `-2`/`-3` suffixes (mirror `assignAnchors()` `:410-428`); call it from
  `main()` after `assignAnchors`. `renderSession()` (`:452`) emits
  `id="${s._sid}"` on the `<article>`. Verify: fixture build green; diff of
  fixture `program-schedule.html` against a pre-change fixture build shows
  *only* added `id` attributes; the four same-day "Afternoon Tech Session"
  articles carry `-2`/`-3`/`-4` suffixes; rerunning the build changes
  nothing; JSON byte-identical. Restore artifacts.

- [x] 4. **Grid skeleton renderer** (Stories 1, 9; §2, §3, §8) — Add
  `OUT_GRID` beside `OUT_HTML` (`:104`) and `renderGridHTML(days)` emitting:
  generator banner, `<div class="program-grid" hidden>`, the
  `program-grid__nav` pills (`#grid-day-<weekday>`), and per day: the
  `grid-day-*` section, list-style title with draft note, the
  `tabindex="0" role="region"` scroller, and the `.grid` element with
  `--grid-cols`/`--grid-rows` inline. Compute day bounds (floor/ceil to
  :00/:30), the 5-minute row lattice with nearest-5 rounding, band-vs-card
  classification (`muted || !room || room.toLowerCase() === 'anywhere'`),
  and columns (rooms with ≥1 card, `roomRank()` then min `_row`). Emit the
  corner, room header cells, half-hour `grid__rule`s (`--hour` on hours),
  and hour `grid__time` labels — no bands or cards yet. Wire
  `writeIfChanged(OUT_GRID, renderGridHTML(days))` into `main()` after the
  schedule write (`:771`). Verify: fixture build green and reports
  `wrote _includes/program-grid.html`, rerun reports `unchanged`; spot-check
  one day's `--grid-rows` against hand-computed bounds; Tue/Wed have no
  Prefunction column (Registration is muted). Restore artifacts (the `rm`).

- [x] 5. **Bands, cards, lanes** (Stories 2, 3, 4; §2, §3, §4) — Emit per
  day, after the rail: chronological `grid__band`s (`grid-row` from slot
  minutes; label = title + `— room` when the sheet named one + compact time;
  `--muted` modifier), then per room in column order, start-sorted
  `grid__card` anchors: `href="#<_sid>"`, inline
  `grid-column`/`grid-row`/`--lane`/`--lanes`, and content per §3 — compact
  `<time>` range (meridiem-deduped like `renderHTML()` `:516-518`, ISO via
  `fmtISO()`), visually-hidden room span, eyebrow (type `· Chair: …`),
  `<h3>` title, and the Order-sorted talks `<ol>` with format-pill spans
  (condition as `renderSession()` `:472-473`); all text through `esc()`.
  Implement `assignLanes()` (§4 sweep) and the `rowSpan ≥ 3` clamp.
  Verify on the fixture build: the task-1 Market Street pair carries
  `--lanes:2` with distinct `--lane`; Tue Working Group Fair card appears
  *after* the lunch band in DOM; Tue/Wed lunch bands name Salon 3 & 4 in
  their label; every card `href` matches a session `id` in the fixture
  schedule include (`grep` both, compare sets). Restore artifacts.

- [x] 6. **`assets/css/program-grid.css`** (Stories 1, 2, 3, 4, 6, 7, 8;
  §6) — New stylesheet, header comment in the `program.css:1-21` idiom.
  Token block on `.program-grid` (palette duplicated as in `abstracts.css`),
  theme neutralization (`program.css:52-68` pattern), `--grid-rail`,
  `--grid-col-min: 10rem`, `--grid-row-h: 0.5rem`; grid tracks from the
  inline vars; sticky room headers (`top:0`), rail (`left:0`), corner (both,
  z-index 4, solid backgrounds); rules as hairline/lighter borders spanning
  `1 / -1`; cards (white, hairline, `overflow:hidden`, hover and
  `:focus-visible` accent per `.program-nav__pill`, `--plenary` wash +
  inset shadow per `.session--plenary`); bands (`#fafafa`, dashed rules,
  muted ramp); the lane `width`/`margin-left` calc (§4); toolbar pills with
  `[aria-pressed="true"]` accent; `.program-grid--no-details
  .grid__card-talks { display:none }`; `@media (max-width: 40rem)`
  (`--grid-col-min: 7.5rem`, tighter ramp); `@media print` (scroller
  unclamped, sticky off, `break-before: page` per day after the first,
  `--grid-col-min: 0` + ~8pt ramp, nav/toolbar hidden, plenary
  `border-left` instead of wash). Verify: fixture build green (generator
  ignores CSS); `bundle exec jekyll build` clean.

- [x] 7. **Page wiring** (Stories 5, 8; §5) — In
  `pages/program/program.md`: add the `program-grid.css` link with the
  `site.time` cache-buster after the `program.css` link (`:13`), the hidden
  `program-toolbar` markup (List/Grid `aria-pressed` buttons + hidden
  fixed-label "Talk details" button), `{% include program-grid.html %}`
  after the schedule include, and the deferred `program-view.js` script. In
  `assets/css/program.css`: add `scroll-margin-top: 5rem` to `.session`.
  Verify: generator run then `bundle exec jekyll build` clean; rendered
  page shows the list exactly as before (toolbar and grid both `hidden`);
  commit `program.md` + `program.css` only (grid include stays uncommitted
  — see the header note).

- [x] 8. **`assets/js/program-view.js`** (Stories 2, 5, 7, 8; §7) — New
  dependency-free deferred IIFE per the §7 skeleton: bail unless toolbar,
  `.program`, and `.program-grid` all exist; try/catch localStorage
  (`usrse26:program-view`, `usrse26:program-details`); `setView()` swaps
  the two `hidden` attributes, syncs `aria-pressed`, shows/hides the
  details button, persists; `setDetails()` flips
  `.program-grid--no-details` + `aria-pressed`, persists; init toolbar
  visible, view from storage (default list), details from storage (default
  shown); card-click delegation on `.program-grid` with
  `preventDefault` + `stopPropagation` (keeps SmoothScroll `app.js:34-40`
  out), `setView('list')`, then `location.hash` (or `scrollIntoView()`
  when the hash already matches). Day-pill clicks are *not* intercepted.
  Verify: fixture build green; behavior exercised in task 10.

- [x] 9. **Workflow and README** (Story 9; §8) — Add
  `_includes/program-grid.html` to the commit step's pathspec list in
  `.github/workflows/build-program.yml` (`:57-59`), with a comment line
  noting the generator writes it unconditionally in the same job so naming
  it is safe. Update README's "Building the Program Schedule": the new
  artifact, `program-grid.css`, `program-view.js`, the List/Grid toggle,
  and the no-JS fallback. Verify: YAML loads (`actionlint` if available);
  fixture build green.

- [x] 10. **Browser verification** (all stories) — Generator run, then serve
  (`bundle exec jekyll serve` or the Docker path) and check on the fixture
  data: toggle appears and swaps views with no page load; choice survives
  reload; Grid shows its own working day pills (SmoothScroll animates, clears
  navbar); sticky room headers and rail hold while the scroller scrolls both
  axes; page body never scrolls horizontally at narrow widths; the task-1
  overlap renders side-by-side lanes; Tue Working Group Fair card sits on
  the lunch band; plenary card carries wash + bar; clicking a card lands on
  the list entry clear of the navbar (twice in a row too); "Talk details"
  hides/shows talk lists and persists; Tab reaches toggle buttons, cards,
  and the scroller with visible focus rings; a screen reader (or
  accessibility-tree inspection) announces card name as time, room, title;
  print preview with Grid active: one page per day, all columns fit, no
  pills/toolbar, plenary/muted distinct in greyscale; with JS disabled the
  page is today's list, no toolbar, no grid. Fix what fails; restore
  artifacts.

- [ ] 11. **Regenerate the committed artifacts from the live sheet**
  (Story 9) — The committed `_includes/program-schedule.html` lacks the new
  session ids and `_includes/program-grid.html` does not exist yet, so a
  fresh checkout cannot Jekyll-build `program.md`. Run
  `PROGRAM_SHEET_ID=<id> node scripts/build-program.js` locally and commit
  the regenerated `_includes/program-schedule.html` and new
  `_includes/program-grid.html` (or merge-and-dispatch the
  `build-program.yml` workflow, whose staging now covers the grid — task 9).
  Verify: committed schedule include diff is id attributes only; every grid
  card `href` fragment matches a session id; `bundle exec jekyll build`
  clean from a pristine checkout. From now on the hygiene note's `rm`
  becomes a `git checkout`.
