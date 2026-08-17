# Tasks — Program sheet new columns: People, Format, Info_md, Title

Ordered, small tasks. After each task the build stays green:
`node scripts/build-program.js --file fixtures/schedule.csv` exits 0, and
`git status` shows only the changes that task intends. Tasks 1–8 run
against the unmodified fixture (which lacks the new columns), so the
committed artifacts must come out byte-identical — that is the Story 7
regression check, applied continuously. Design section references are to
`design.md`.

- [x] 1. **Header aliases and docstring** (Stories 1–4; §1) — In
  `scripts/build-program.js`: repoint `title` from `session` to a new
  `title` canonical, add `people → speakers`, `format`, `infomd` aliases;
  update the docstring's expected-columns list. Verify: fixture build
  green, `_includes/program-schedule.html` and `_data/program.json`
  unchanged (`git diff --stat` clean).

- [x] 2. **Format vocabulary and normalization** (Story 2; §2) — Add the
  `FORMATS` lookup (seven page formats with label/page-title/permalink/slug
  plus Other) and `normalizeFormat()` mapping empty → null, known values →
  entry, unknown → Other while preserving the raw text. Verify: fixture
  build green, artifacts unchanged.

- [x] 3. **Title validation** (Story 3; §3) — After `toRecords`, collect
  every event record whose format is a page format but whose `title` is
  empty; throw one Error listing all offenders with row numbers. Verify:
  fixture build green; a scratch CSV with two offending rows fails with
  both rows named in the message (scratch file not committed).

- [x] 4. **People parser** (Story 1; §4) — Add `parsePeople()` splitting on
  commas and "and" per §4. Verify with `node -e` spot checks: "A, B and C",
  "A, B, and C", "A and B", single name, empty → expected arrays with no
  empty or "and"-polluted entries; fixture build green, artifacts
  unchanged.

- [x] 5. **fold() carries the new fields and assigns anchors** (Stories
  1–3, 5; §5) — Talk entries gain displayed title (`rec.title ||
  rec.talk`), `peopleRaw`, `people`, `formatRaw`, `FORMATS` entry, and
  `infoMd`; add the traversal pass assigning per-page deduplicated
  `slugify(title)` anchors. Verify: fixture build green, artifacts
  unchanged (new JSON fields append only when non-empty).

- [x] 6. **Schedule rendering and JSON output** (Stories 1–3, 7; §6, §7) —
  In `renderSession`: format pill for page formats, title wrapped in the
  `relative_url` deep link when `infoMd` and a page format are present,
  people span as typed. In the JSON writer: conditional `people`, `format`,
  `infoMd`, `href` fields. Verify: fixture build green, artifacts still
  byte-identical.

- [x] 7. **Abstract page generator with pruning** (Stories 4, 5; §8) —
  Emit `pages/program/abstracts/<slug>.md` per active format: program.md
  -style front matter, generator banner, entries in traversal order
  (`##### title {#anchor}`, bold byline, HTML-escaped Info_md), via
  `writeIfChanged`; prune banner-carrying `.md` files for inactive slugs,
  never touching banner-less files. Verify: fixture build green, no pages
  generated (fixture has no Format column yet), `.tbd` files untouched.

- [x] 8. **Menubar generator** (Story 5; §9) — Emit
  `_data/menus/program.yml` (banner comment, Full Program first, format
  entries in vocabulary order) when abstract pages exist; delete a
  banner-carrying file when none do; `_data/menus/hidden/program.yml` is
  never touched. Verify: fixture build green, no menubar file created.

- [x] 9. **CSS for the new elements** (Story 6) — Add `.talk__format` pill
  and `.talk__link` styles to `assets/css/program.css` per §6, visually
  distinct from `.talk__speakers` and the plain title. Verify: fixture
  build green (CSS not touched by the script).

- [x] 10. **Fixture extension and end-to-end check** (Story 7 + all; §11,
  §12) — Add the four columns to `fixtures/schedule.csv` with the §11
  cases (several formats, "and"-variant People, Other with and without
  Title, legacy empty-format row, multi-paragraph quoted Info_md). Build
  and inspect: pill/link/people markup in the include, conditional JSON
  fields, abstract pages with pinned anchors matching the schedule hrefs,
  menubar file. Then per decision 16 restore the live-sheet artifacts
  (`git checkout -- _includes/program-schedule.html _data/program.json`)
  and delete the fixture-generated abstract pages and menubar so only
  `fixtures/schedule.csv` is committed from this task.

- [x] 11. **Workflow and README** (Story 5; §10, §11) — Extend the commit
  step in `.github/workflows/build-program.yml` (diff guard + `git add -A`)
  to cover `pages/program/abstracts` and `_data/menus/program.yml`; update
  the README's build section with the new columns and artifacts. Verify:
  `actionlint`-free if available, otherwise YAML loads; fixture build
  green.
