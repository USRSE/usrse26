# Tasks — collapsible abstracts

Ordered, small tasks. After each task the build stays green:
`node scripts/build-program.js --file fixtures/schedule.csv` exits 0 and
`git status` shows only the changes that task intends. Design section
references are to `design.md`.

**Fixture-build hygiene.** Unlike spec 001, the fixture now carries an Event
Format column, so a fixture build *rewrites* `pages/program/abstracts/*.md`,
*rewrites* `_data/menus/program.yml`, and **prunes** any committed abstract page
whose format the fixture lacks. Per spec 001 decision 16, after inspecting
fixture output always restore the live-sheet artifacts before committing:

```
git checkout -- _includes/program-schedule.html _data/program.json \
                _data/menus/program.yml pages/program/abstracts
git clean -f pages/program/abstracts   # drops fixture-only pages
```

The one deliberate exception is task 8, which lands the regenerated pages.

---

- [x] 1. **Extend the fixture to cover the new branches** (Stories 1, 4, 5;
  §3, §5, §9) — `fixtures/schedule.csv` today has no case for three design
  branches. Add: (a) a **Bird of a Feather** event with People and an empty
  Event Description, so `bofs` becomes a page whose entries are *all* static
  and whose toolbar must therefore be omitted; (b) a **Talk** with an Event
  Description and an empty People cell; (c) an event whose Event Description is
  **whitespace only**. The existing Poster pair (one with a description, one
  without) already covers a mixed page and needs no change. Verify: fixture
  build exits 0; restore artifacts per the hygiene note; only
  `fixtures/schedule.csv` is committed.

- [x] 2. **Heading and entry helpers** (Stories 1, 4; §2, §3) — In
  `scripts/build-program.js`, add `renderAbstractHeading(entry)` emitting
  `<h2 class="abstract__heading">` with an `.abstract__title` span and, only
  when People is non-empty, an `.abstract__people` span — both through `esc()`
  (`:433`). Add `renderAbstractEntry(entry)` branching on
  `entry.infoMd.trim()`: truthy → `<details class="abstract" id="…">` with the
  heading inside `<summary class="abstract__summary">` and the body div from
  §4; falsy → `<div class="abstract abstract--static" id="…">` with the bare
  heading. Not yet wired into `renderAbstractPage`. Verify: fixture build green,
  no artifact changes (helpers unreferenced).

- [x] 3. **Rewrite `renderAbstractPage`** (Stories 1–4, 8; §1–§4) — Drop
  `menubar_toc: true` from the front matter; keep `PAGE_BANNER` immediately
  after it; emit the `abstracts.css` `<link>` with the
  `?v={{ site.time | date: '%s' }}` cache-buster (mirroring
  `pages/program/program.md:13`); wrap entries in `<div class="abstracts">`;
  call `renderAbstractEntry()` per entry; emit the deferred `abstracts.js`
  `<script>` after the wrapper. Delete `escMd()` (`:544-546`) — task 2 left it
  with no callers. Verify: fixture build green; read the generated
  `pages/program/abstracts/posters.md` and confirm one `<details>` and one
  `.abstract--static` block with ids matching the `#anchor` fragments in
  `_includes/program-schedule.html`; confirm `talks.md` has an entry with no
  `.abstract__people` span (task 1b) and that the whitespace-only description
  (task 1c) rendered static. Restore artifacts.

- [x] 4. **Toolbar** (Stories 5, 7; §5) — Emit
  `<div class="abstracts__toolbar" hidden><button class="abstracts__toggle-all"
  type="button">Expand all</button></div>` as the first child of `.abstracts`,
  and omit it entirely when the page has no collapsible entries. Verify:
  fixture build green; `talks.md` has the toolbar, the all-static `bofs.md`
  from task 1a does not. Restore artifacts.

- [ ] 5. **`assets/css/abstracts.css`** (Stories 1, 2, 4, 6, 7; §7) — New
  stylesheet with a header comment in the idiom of
  `assets/css/program.css:1-21`. Scoped token block on `.abstracts` mirroring
  program.css's palette; **narrow** theme neutralization (heading and wrapper
  only — `.abstract__body` keeps Bulma's prose margins); marker suppression
  plus a chevron `::before` rotated under `.abstract[open] > .abstract__summary`;
  hover and `:focus-visible` following `.program-nav__pill`
  (`program.css:108-112`); `.abstract + .abstract` hairline mirroring
  `.session + .session` (`program.css:228-232`); `scroll-margin-top: 5rem`
  matching `.program-day` (`program.css:120`); a quieter `.abstract--static`;
  `@media (max-width: 40rem)`; and `@media print` hiding the toolbar and
  chevron plus the `display: block` fallback. Verify: fixture build green (the
  generator does not touch CSS); `bundle exec jekyll build` clean.

- [ ] 6. **`assets/js/abstracts.js`** (Stories 3, 5, 6; §6) — New IIFE, no
  jQuery/Bootstrap/Alpine. (a) `reveal()` on load and on `hashchange`: resolve
  `location.hash`, guard with `root.contains(el)`, set `open` when the target is
  a `DETAILS`, then `scrollIntoView()` — non-`DETAILS` targets fall through to
  the same scroll. (b) Remove the toolbar's `hidden`; wire the button to open or
  close every `details.abstract`; bind a `toggle` listener per panel that
  recomputes the label ("Collapse all" only when every panel is open). No
  `aria-expanded` anywhere — §2 and §5 explain why. (c) `beforeprint` records
  each panel's `open` and opens all; `afterprint` restores from that record.
  Verify: fixture build green; serve the site and exercise each behavior in a
  browser.

- [ ] 7. **Browser verification and README** (all stories; §8, §9) — Build and
  serve (`bundle exec jekyll serve`, or the `Rakefile`/`Dockerfile` path).
  Check, on a fixture-generated abstracts page: collapsed rows show title and
  byline; opening one leaves others open; Tab reaches each summary with a
  visible focus ring; a `program/posters/#<anchor>` URL typed directly opens and
  scrolls to that panel clear of the navbar; the same for a static entry;
  Expand all / Collapse all relabels correctly, including after individual
  toggling; print preview shows every abstract and no toolbar; the page still
  toggles with JS disabled and shows no toolbar; the sidebar shows the program
  menubar and no Contents list. Then update the README build section to note
  that abstract pages depend on `assets/css/abstracts.css` and
  `assets/js/abstracts.js`. Restore artifacts.

- [ ] 8. **Regenerate the committed abstract pages** (Story 8) — The four
  committed pages under `pages/program/abstracts/` are live-sheet output in the
  old flat format and stay stale until the generator runs against the real
  sheet. Either run `PROGRAM_SHEET_ID=<id> node scripts/build-program.js`
  locally and commit the result, or merge and trigger the `workflow_dispatch`
  job in `.github/workflows/build-program.yml`, which already stages
  `pages/program/abstracts` and `_data/menus` (spec 001 task 11). This is the
  one task that intentionally commits regenerated pages rather than restoring
  them. Verify: the committed pages carry the new markup and their ids match
  the `#anchor` fragments in `_includes/program-schedule.html`.
