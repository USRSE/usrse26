# Tasks — posters sheet page

Ordered, small tasks. After each task the build stays green:
`node scripts/build-program.js --file fixtures/schedule.csv` exits 0 and
`git status` shows only the changes that task intends. From task 8 on, green
also means `node scripts/build-program.js --file fixtures/schedule.csv
--posters-file fixtures/posters.csv` exits 0 and a second run reports every
artifact `unchanged`. Section references (§n) are to `design.md`.

**Fixture-build hygiene** (spec 001 decision 16 / specs 002, 003). A fixture
build rewrites the live-sheet artifacts. After inspecting fixture output,
restore before committing:

```
git checkout -- _includes/program-schedule.html _includes/program-grid.html \
                _data/program.json _data/menus/program.yml pages/program/abstracts
git clean -f pages/program/abstracts     # drops fixture-only pages
```

**Baseline** (Story 8, used by tasks 2-7): before task 2, run the fixture
build and copy `_data/program.json`, `_includes/program-schedule.html`, and
`pages/program/abstracts/*.md` to the scratchpad. After each task through 7,
rerun and `diff -r`; the only permitted differences are the ones that task
names. Comparing against the *committed* files proves nothing — they are
live-sheet output.

---

- [x] 1. **Loader split** (Story 1; §1) — Add `POSTERS_SHEET_NAME`
  beside `SHEET_NAME` (`scripts/build-program.js:50`). Replace `loadCSV()`
  (`:974-993`) with `argValue()`, `fetchSheet(sheetName)`,
  `loadScheduleCSV()`, and `loadPostersCSV()`; `main()` calls
  `loadScheduleCSV()` and, immediately after, `loadPostersCSV()`, storing the
  result unused for now. Keep the "PROGRAM_SHEET_ID is not set" message and
  its `--file` hint. Verify: fixture build green and logs
  `No --posters-file — skipping posters.`; `--posters-file` with a missing
  value throws `--posters-file requires a path`; artifacts unchanged
  (`git status` clean after the run apart from nothing).

- [x] 2. **Posters parser** (Stories 1, 2; §2) — Take the baseline. Add
  `POSTER_HEADER_ALIASES`, give `normalizeHeader()` (`:163-165`) an
  `aliases = HEADER_ALIASES` parameter, and add `toPosterRecords(rows)` with
  the missing-column throw. In `main()`, parse `postersCsv` into `posters`
  (`null` when skipped) and log `Parsed N poster rows.` / `Posters skipped.`
  Verify: fixture build green, baseline diff empty; a scratch CSV with
  header `Poster,Authors,Poster Title,Abstract,DOI`, one blank-title row, and
  two titled rows passed via `--posters-file` logs `Parsed 2 poster rows.`;
  a scratch CSV with header `Authors,Abstract` fails with the
  `no "Poster Title" column` message and exit 1.

- [x] 3. **Shared anchor step and poster anchors** (Stories 2, 6; §3) — Add
  `nextAnchor(seen, base)` and use it inside `assignAnchors()` (`:428-432`).
  Add `assignPosterAnchors(posters)` returning the anchor `Set`; call it in
  `main()` before `assignAnchors()` and keep the set in `posterAnchors`
  (empty `Set` when skipped). Verify: fixture build green, baseline diff
  empty (the refactor is behavior-preserving); the task-2 scratch CSV with a
  duplicated title yields anchors `x` and `x-2` (temporary `console.log`,
  removed before commit).

- [x] 4. **Tab-owned format on the schedule side** (Story 5; §3) — Add
  `tab: 'Posters'` to `FORMATS.poster` (`:90`). Give `assignAnchors()` the
  `posterAnchors` parameter and the tab branch (match → `permalink#slug`,
  else `permalink`; `continue`). Change the `renderSession()` link test
  (`:507-510`) to `if (t.href)`. Skip tab formats in `collectAbstracts()`
  (`:800`). Verify: fixture build green; baseline diff shows exactly: no
  `posters.md` written (and the fixture-only one pruned), fixture rows
  33-34 titles link to `{{ 'program/posters/' | relative_url }}` with no
  fragment (`posterAnchors` is empty offline), `program.json` rows 33-34
  gain `href: "program/posters/"` and row 33 keeps its other keys; every
  other entry and page identical; `_data/menus/program.yml` drops
  "Posters". Restore artifacts.

- [x] 5. **Schedule DOI column** (Story 7; §2, §3) — Add `doi: 'doi'` to
  `HEADER_ALIASES`; in `fold()` carry `doi: rec.doi || ''` on the raw talk
  (`:344-352`) and append `if (t.doi) talk.doi = t.doi;` after `infoMd`
  (`:366`). Widen the `assignAnchors()` link test (`:437`) to
  `talk.infoMd || talk.speakers || talk.doi`. Verify: fixture build green;
  baseline diff identical to task 4's (the fixture has no DOI column yet).

- [x] 6. **Metadata line in entries** (Stories 3, 7; §4) — Add `doiHref()`
  and `hasBody()`. `collectAbstracts()` attaches `meta` from `talk.doi`.
  Rewrite `renderAbstractEntry()` (`:849-869`) to build the body from the
  optional capture and the optional `<p class="abstract__meta">`, keeping
  the single-line `<div class="abstract__body">…</div>`. Swap the toolbar
  test in `renderAbstractPage()` (`:896`) for `entries.some(hasBody)`.
  Verify: fixture build green; baseline diff identical to task 4's (no DOI
  values → no meta → identical strings). Unit-check `doiHref()` by hand:
  `10.5281/zenodo.1` → `https://doi.org/10.5281/zenodo.1`;
  `https://doi.org/10.1/x` and `HTTP://…` pass through.

- [x] 7. **Poster entries and page registration** (Stories 3, 4, 6; §4, §5)
  — Add `posterEntries(posters)` (DOI link when present, then the
  `Link to this poster` permalink). Change `writeAbstractPages(days, posters)`
  per §5: register the page when `posters.length`, add the keep-marker after
  the write loop when `posters === null` and a banner-carrying `posters.md`
  exists, pruning loop untouched. Pass `posters` from `main()`. Verify:
  fixture build with the task-2 scratch CSV writes `posters.md` whose every
  entry is a `<details>` with a trailing `abstract__meta` paragraph, the
  duplicate title carries `id="x-2"`, and `_data/menus/program.yml` lists
  "Posters" between "Papers" and the next present format; rerun reports
  `unchanged`; a run with `--file` only leaves that `posters.md` in place
  and keeps the menu line; a run with an empty-but-headed posters CSV
  prunes it and drops the menu line. Restore artifacts.

- [x] 8. **Fixtures** (Stories 5, 7, 8; §7) — Create `fixtures/posters.csv`
  with every row in the §7 table, including the title
  `Reproducible Pipelines on a Budget`. Append a `DOI` column to
  `fixtures/schedule.csv` (header plus a trailing comma on every row) with
  values on one Talk that has People and a description and one Paper that
  has People but no description. Verify: two-flag fixture build green; row
  33's title links to `program/posters/#reproducible-pipelines-on-a-budget`
  and row 34's to `program/posters/`; the Talk's entry shows the capture
  then the meta line; the Paper's entry is now a `<details>` with a
  meta-only body and its schedule title is now a link; `program.json`
  carries `doi` on exactly those two talks; the `{% raw %}` / `<script>`
  abstract appears escaped in `posters.md`; the blank-title row is absent;
  second run all `unchanged`. Restore artifacts; commit only `fixtures/`.

- [x] 9. **Jekyll build and browser check** (Stories 3, 6, 7) — Two-flag
  fixture build, then `bundle exec jekyll build` (or the Docker path) must
  exit 0. Serve and check `program/posters/`: rows collapsed showing title
  and authors; expanding shows abstract, DOI link opening `doi.org`, and
  the permalink; clicking the permalink puts `#<anchor>` in the address bar
  and the row stays open; a cold load of that URL opens and scrolls to the
  row; the title-only row and the DOI-only row both open; Expand all /
  Collapse all still works; on `program/`, the row-33 Poster title lands on
  its poster entry and the Paper's title lands on its DOI-only entry.
  Restore artifacts.

- [x] 10. **Docs and comments** (Story 8) — Update the file header comment
  of `scripts/build-program.js` (`:1-38`) for the second tab, the flag, and
  the DOI column; the header comment of
  `.github/workflows/build-program.yml` (`:1-2`) to say the job reads the
  Schedule and Posters tabs; and README's "Building the Program Schedule":
  the Posters tab and its four columns, `--posters-file`, the Schedule `DOI`
  column, the DOI/permalink metadata line, and the rule that Poster-format
  schedule events link into the posters page (matching entry, else page
  top). Verify: fixture build green; `git diff` touches only comments and
  README.

- [x] 11. **Regenerate the committed artifacts from the live sheet**
  (Stories 4, 8) — Run `PROGRAM_SHEET_ID=<id> node scripts/build-program.js`
  locally (or merge and dispatch the workflow). Verify against §8: the diff
  is `pages/program/abstracts/posters.md` (new), the "Posters" line in
  `_data/menus/program.yml`, and — only if the live Schedule tab has DOI
  values — `doi` keys in `program.json` plus `abstract__meta` lines on those
  entries; nothing else changes. Commit the regenerated artifacts.
