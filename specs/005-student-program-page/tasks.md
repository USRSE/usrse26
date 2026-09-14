# Tasks — student program page

Ordered, small tasks. After each task the build stays green:
`node scripts/build-program.js --file fixtures/schedule.csv
--posters-file fixtures/posters.csv` exits 0 and `git status` shows only the
changes that task intends. Section references (§n) are to `design.md`.

**Fixture-build hygiene** (spec 001 decision 16 / specs 002, 003, 004). A
fixture build rewrites the live-sheet artifacts. After inspecting fixture
output, restore before committing:

```
git checkout -- _includes/program-schedule.html _includes/program-grid.html \
                _data/program.json _data/menus/program.yml pages/program/abstracts
git clean -f pages/program/abstracts     # drops fixture-only pages
```

**Baseline.** Task 1 establishes it and task 2 diffs against it. Comparing
against the *committed* files proves nothing — they are live-sheet output.

---

- [x] 1. **Fixture rows, before the code** (Story 4; §7) — Append to
  `fixtures/schedule.csv`, keeping all 13 columns and the trailing empty `DOI`
  field on every row:

  ```
  10/19 10:30,10/19 12:00,Market Street,Student & Early Career Program,,,,,,,Student/Early Career,,
  10/19 10:30,10/19 12:00,Market Street,Student & Early Career Program,Student Program Activity,1,,Scott Michael and Stephanie Brink,Student,,,,
  10/19 10:30,10/19 12:00,Market Street,Student & Early Career Program,Student Program Activity,2,,Scott Michael and Stephanie Brink,Student,,,,
  10/19 13:30,10/19 15:00,Market Street,Student & Early Career Program,,,,,,,Student/Early Career,,
  10/19 13:30,10/19 15:00,Market Street,Student & Early Career Program,Early Career Lightning Round,1,,Dana Reyes,Student,"Five-minute talks from students and early-career RSEs, followed by open Q&A.",,,
  ```

  Run the fixture build and copy `_data/program.json`,
  `_includes/program-schedule.html`, `_includes/program-grid.html`,
  `_data/menus/program.yml`, and `pages/program/abstracts/*.md` to the
  scratchpad as the **baseline**.

  Verify — this task deliberately lands *before* the table entry, so the new
  rows must behave as unknown formats: build exits 0 and the row count in the
  `Parsed N rows` line rises by 5; `program.json` has two new Market Street
  sessions with `"type": "Student/Early Career"`, `"muted": false`,
  `"plenary": false`, and three events each carrying `"format": "Student"`
  with **no** `href` key; the schedule include shows those three titles as
  plain `talk__title` spans with **no** `talk__format` pill and **no**
  `talk__link`; the grid shows two new Market Street cards whose eyebrow reads
  `Student/Early Career`; **no** `student-program.md` exists and
  `_data/menus/program.yml` is unchanged. Restore artifacts; commit only
  `fixtures/schedule.csv`.

- [ ] 2. **The `FORMATS` entry** (Stories 1, 2, 3; §1, §2, §4, §5) — Insert
  one key in `scripts/build-program.js` `FORMATS` (`:174-185`), between
  `'random access microtalk'` (`:181`) and `'talk'` (`:182`):

  ```js
  'student': { label: '', pageTitle: 'Student & Early Career', permalink: 'program/student-early-career-program/', slug: 'student-program' },
  ```

  No other edit in this task.

  Verify against the task-1 baseline — the diff must be exactly:
  - `pages/program/abstracts/student-program.md` is **new**, with
    `title: Student & Early Career`,
    `permalink: program/student-early-career-program/`, the `PAGE_BANNER`,
    and — because one entry has a description — the
    `abstracts__toolbar` block (§4).
  - Its entries in schedule order: two `div.abstract.abstract--static` rows
    with ids `student-program-activity` and `student-program-activity-2`,
    each carrying the `abstract__people` byline, then one
    `details.abstract` for `Early Career Lightning Round` whose body is the
    `{% capture abstract_md %}` string.
  - `_data/menus/program.yml` gains exactly two lines,
    `- name: Student & Early Career` / `link: program/student-early-career-program/`,
    positioned between `Posters` and `Talks` (§5).
  - `_includes/program-schedule.html`: the three student titles gain an empty
    `<span class="talk__format"></span>` and a `talk__link` anchor to
    `{{ 'program/student-early-career-program/' | relative_url }}#<anchor>`.
  - `_data/program.json`: those three events gain an `href`; `format` stays
    the literal `"Student"`; session `type` is unchanged from task 1.
  - `program/llms.txt` and `program/llms-full.txt` gain one index line,
    `https://us-rse.org/usrse26/program/student-early-career-program/`, in the
    same relative position as the menu item.
  - `_includes/program-grid.html` is **unchanged** from the baseline (§2
    step 5 — the grid never renders event formats).

  Nothing else moves. Restore artifacts.

- [ ] 3. **Idempotence and `--from-json` parity** (Story 3, Story 4) — No code
  change. Run the fixture build twice in a row; the second run must report
  `student-program.md`, `_data/menus/program.yml`, and both llms files as
  `unchanged` and write nothing. Then, with the fixture-built
  `_data/program.json` in place, run
  `node scripts/build-program.js --from-json` and confirm it rewrites the two
  llms files byte-identically — `git diff` empty for them — which is the check
  `.github/workflows/check-program-llms.yml` runs (§5).

  Also exercise the rollback path (§6): temporarily change the three fixture
  `Student` cells to `Other`, rebuild, and confirm `student-program.md` is
  deleted (logged `removed`) and the two menu lines disappear. Revert the
  fixture. Restore artifacts.

- [ ] 4. **Jekyll build and browser check** (Stories 2, 4) — Fixture build,
  then `bundle exec jekyll build` (or the Docker path) must exit 0. Serve and
  check `program/student-early-career-program/`: the page title reads
  `Student & Early Career` with a literal ampersand in the `<h2>`, the browser
  tab, and `view-source` of the `og:title` meta tag (§4); the two static rows
  show title and byline with **no** disclosure triangle; the Lightning Round
  row opens and closes; Expand all works on it; the sidebar contents list
  (`menubar_toc`) has three links. Confirm the Program menubar shows
  `Student & Early Career` between `Posters` and `Talks`. On `program/`, each
  of the three student titles links to its own anchor and lands on the right
  row — the two duplicates landing on `#student-program-activity` and
  `#student-program-activity-2` respectively — and the session eyebrows read
  `Student/Early Career` in both list and grid views. Restore artifacts.

- [ ] 5. **README** (Story 4; §8) — In README's "Building the Program
  Schedule" (`:89-90`), add `Student` to the parenthesized Event Format list,
  in alphabetical position between `Random Access Microtalk` and `Talk`. Do
  **not** touch the file header comment of `scripts/build-program.js` (`:30-45`):
  it documents columns and the Session Format special cases, never the Event
  Format vocabulary (§8).

  Verify: fixture build green; `git diff` touches `README.md` only.

- [ ] 6. **Regenerate the committed artifacts from the live sheet**
  (Stories 1, 3, 4; §9) — **Gated on the sheet edit**: the program committee
  must first set Event Format to `Student` and Session Format to
  `Student/Early Career` on the two student sessions. Until then this task
  cannot run, and tasks 1-5 ship on their own — the table entry is inert with
  no matching sheet rows (Story 1's last criterion).

  Once the sheet is updated, run
  `PROGRAM_SHEET_ID=<id> node scripts/build-program.js` locally (or merge and
  dispatch `build-program.yml`). Verify the diff is exactly §9's list:
  `student-program.md` new; two lines in `_data/menus/program.yml`; one index
  entry plus the two `- Type:` lines in each llms file; `format`/`href`/`type`
  changes on the two student events in `program.json`; pill, link, and eyebrow
  changes in the schedule include; eyebrow text in the grid include. Anything
  outside that list means something unintended moved.

  Expect the live page to be **two static rows and no toolbar** until the
  committee adds Event Descriptions (§4) — that is the correct rendering of
  the current sheet content, not a defect. Commit the regenerated artifacts.
