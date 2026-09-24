# Design — student program page

## Overview

The whole behavior change is one row in the `FORMATS` table
(`scripts/build-program.js:174-185`). Every downstream consumer — the pill,
the anchors, the abstract page, the menubar, the llms.txt page index, and the
pruning loop — already reads that table and nothing else, so adding a key is
what "supporting a format" means here. No new function, no new branch, no new
parameter.

The rest of the work is making that one row verifiable and honest: a fixture
that exercises both entry shapes, a README line, and a regeneration of the
committed artifacts once the live sheet carries the new cell values.

Two facts about the table make the requested shape a drop-in:

- `slug`, `permalink`, and `pageTitle` are independent fields. `slug` names
  the file (`pages/program/abstracts/<slug>.md`) and the anchor namespace;
  `permalink` is the served URL; `pageTitle` is the `<title>` and the menu
  label. `bird of a feather` already uses three different strings this way.
  So `slug: 'student-program'` with
  `permalink: 'program/student-early-career-program/'` needs no new mechanism.
- Insertion order is output order. `writeMenubar()` (`:1637-1640`) and
  `abstractPages()` (`:1400-1404`) both iterate `Object.values(FORMATS)`, so
  placing the key alphabetically between `random access microtalk` and `talk`
  is what puts the menu item between Random Access Microtalks and Talks.

Session Format `Student/Early Career` is a passthrough and needs no code at
all (§3).

## Affected components

| File / module | Change |
| --- | --- |
| `scripts/build-program.js` — `FORMATS` (`:174-185`) | **The change.** One new key, `student`, inserted between `'random access microtalk'` and `'talk'`. |
| `fixtures/schedule.csv` | Two new session rows with Session Format `Student/Early Career` and three event rows with Event Format `Student`, covering both entry shapes and the anchor dedupe (§7). |
| `README.md` — "Building the Program Schedule" (`:89-90`) | `Student` joins the parenthesized Event Format list. |
| `pages/program/abstracts/student-program.md` | **New, generated.** Written by the existing `writeAbstractPages()`; never hand-edited. |
| `_data/menus/program.yml` | **Regenerated.** Gains one item (§5). |
| `program/llms.txt`, `program/llms-full.txt` | **Regenerated.** Gain one line in the abstract-page index (§5). |
| `_includes/program-schedule.html`, `_includes/program-grid.html`, `_data/program.json` | **Regenerated** once the live sheet changes: student event titles become links, and session `type` becomes `Student/Early Career` (§9). |
| `normalizeFormat()`, `assignAnchors()`, `collectAbstracts()`, `renderAbstractEntry()`, `renderAbstractPage()`, `writeAbstractPages()`, `writeMenubar()`, `abstractPages()` | **Unchanged.** §2 traces each one to show why. |
| `scripts/build-program.js` — file header comment (`:30-45`) | Unchanged. The header names the Schedule *columns* and the Session Format special cases; it has never enumerated the Event Format vocabulary, so there is no list to extend. |
| `assets/css/abstracts.css`, `assets/js/abstracts.js` | Unchanged. |
| `.github/workflows/build-program.yml` | Unchanged. Its `git add -A -- pages/program/abstracts _data/menus` pathspecs already cover the new page and the menu. |

## Detailed design

### 1. The table entry

Inserted in alphabetical key position, between `random access microtalk`
(`:181`) and `talk` (`:182`):

```js
'student': { label: '', pageTitle: 'Student & Early Career', permalink: 'program/student-early-career-program/', slug: 'student-program' },
```

Field by field, against the `FORMATS` type (`:173`):

| Field | Value | Why |
| --- | --- | --- |
| key | `student` | `normalizeFormat()` (`:213-217`) lowercases and trims the cell, then does an exact lookup. One key, no aliases (requirements, Resolved decisions). |
| `label` | `''` | Empty pill, as `bird of a feather` (`:175`) and `workshop` (`:183`). Non-`null` matters: `null` is the `other` sentinel. |
| `pageTitle` | `Student & Early Career` | Page `<title>`/`<h2>` and menu label. |
| `permalink` | `program/student-early-career-program/` | Served URL. Trailing slash matches every other entry; `absUrl()` (`:1273`) joins it to `SITE_BASE` for llms.txt. |
| `slug` | `student-program` | File name and anchor namespace. |

No entry may collide with another on `slug` (the file would be written twice)
or on `permalink` (Jekyll would refuse the duplicate). Neither
`student-program` nor `program/student-early-career-program/` is in use.

### 2. What the existing pipeline does with it

Traced in execution order, to show that each step needs no edit:

1. **`fold()` (`:490-491`)** stores `formatRaw: rec.format` and
   `format: normalizeFormat(rec.format)`. A `Student` cell now resolves to the
   new object instead of `FORMATS.other`.
2. **`fold()` (`:532-539`)** copies `formatRaw` onto `talk.format` (so
   `_data/program.json` carries the literal sheet text `"Student"`) and
   attaches `talk._format` because `format.slug` is truthy — the gate that
   `other` fails.
3. **`assignAnchors()` (`:604-625`)** takes the non-`tab` branch: allocates a
   per-slug anchor counter under `student-program` and calls `nextAnchor()`
   with the slugified title. It then sets
   `talk.href = 'program/student-early-career-program/#<anchor>'` when the
   event has `infoMd || image || speakers || doi` (`:619`).
4. **`renderSession()` (`:691-692`)** emits
   `<span class="talk__format"></span>` because `_format` is truthy and
   `label` is `''` — the same empty pill BoF and Workshop events get today.
   `:698-703` then wraps the title in a link because `href` is set.
5. **`renderGridCard()` (`:894-908`)** is unaffected: the grid shows session
   titles and eyebrows, never event formats.
6. **`collectAbstracts()` (`:1005-1046`)** creates the `student-program` page
   bucket on first sight (`_format.tab` is undefined, so the poster skip at
   `:1012` does not fire) and appends one entry per event in traversal order.
7. **`renderAbstractEntry()` (`:1072-1105`)** picks the shape from `hasBody()`
   (`:995-998`): `<details>` when the entry has an abstract, a portrait, or a
   DOI; an inert `<div class="abstract abstract--static">` when it has only a
   title and a byline.
8. **`renderAbstractPage()` (`:1111-1147`)** writes the front matter from the
   three string fields and emits the toolbar only when
   `entries.some(hasBody)`.
9. **`writeAbstractPages()` (`:1172-1204`)** writes
   `pages/program/abstracts/student-program.md` through `writeIfChanged()`
   and returns the page map.
10. **`writeMenubar()` (`:1622-1643`)** and **`abstractPages()`
    (`:1394-1407`)** emit the item at the key's table position (§5).

### 3. Session Format is a passthrough

`Student/Early Career` reaches `fold()` as `rec.type` and is stored verbatim
(`:448`). It is used in exactly four places, none of which needs a vocabulary
entry:

| Site | Line | Result |
| --- | --- | --- |
| Muted-row test | `:449` | `MUTED_TYPES` (`:163`) holds `break`, `meal`, `registration`. `student/early career` is absent → `muted: false` → full session block. |
| Plenary test | `:521` | `'student/early career' !== 'plenary'` → `plenary: false`. |
| List eyebrow | `:679` | `<p class="session__eyebrow">Student/Early Career</p>`, HTML-escaped by `esc()`. |
| Grid eyebrow | `:903` | Same string on the grid card. |
| llms.txt | `:1553` | `- Type: Student/Early Career`. |

The `/` needs no escaping in any of those contexts. This is why the
requirements pin the string as a verification criterion rather than a code
requirement: the risk is a typo in the sheet, not a gap in the generator.

### 4. The generated page, concretely

With today's live content — two events titled "Student Program Activity",
People `Scott Michael, Stephanie Brink`, no Event Description, no image, no
DOI — `hasBody()` is false for both, so the page is two static rows and
**no expand-all toolbar**:

```markdown
---
layout: page
title: Student & Early Career
description:  abstracts at USRSE'26
menubar: program
menubar_toc: true
permalink: program/student-early-career-program/
set_last_modified: true
---
<!-- Generated by scripts/build-program.js — do not edit by hand. -->
<link rel="stylesheet" href="{{ site.baseurl }}/assets/css/abstracts.css?v={{ site.time | date: '%s' }}">

<div class="abstracts">
  <div class="abstract abstract--static">
    <h2 class="abstract__heading" id="student-program-activity">
      <span class="abstract__title">Student Program Activity</span>
      <span class="abstract__people">Scott Michael, Stephanie Brink</span>
    </h2>
  </div>
  <div class="abstract abstract--static">
    <h2 class="abstract__heading" id="student-program-activity-2">
      ...
    </h2>
  </div>
</div>

<script src="{{ site.baseurl }}/assets/js/abstracts.js" defer></script>
```

Three consequences worth stating rather than discovering:

- **The double space in `description`** is the shared renderer interpolating
  an empty `label` (`:1118`). `workshops.md:4` and `bofs.md` carry it today.
  Pre-existing; not fixed here.
- **The page is thin until the sheet grows Event Descriptions.** Two headings
  with bylines and nothing to open. That is the correct rendering of the
  current data — `renderAbstractEntry()` deliberately refuses to emit a
  disclosure control that opens onto nothing — and it fills in the moment the
  committee adds abstract text. It is a content state, not a defect, but it is
  what the page will look like on the day this ships.
- **The schedule still deep-links to it.** `assignAnchors()` sets `href` on
  the strength of People alone (`:619`), so both schedule titles become links
  to `#student-program-activity` / `-2`, landing on the static rows. The
  theme's `menubar_toc` sidebar also lists both, since it reads `id`s off
  `h2` elements.

**Duplicate titles.** Both events slugify to `student-program-activity`;
`nextAnchor()` (`:569-578`) gives the second `-2`. Anchors are assigned in
schedule traversal order, so they are stable across rebuilds as long as the
two sessions keep their relative order and titles — the same guarantee every
other page has.

**The `&` in `pageTitle`** is the first ampersand in a `FORMATS` title. It is
safe in all three destinations, but worth having checked once:

- YAML front matter — `title: Student & Early Career` is a plain scalar. `&`
  is an indicator only at the *start* of a token, so no anchor is parsed.
- `_data/menus/program.yml` — `- name: Student & Early Career`, same rule.
- HTML — the theme emits `{{ page.title }}` and `{{ item.name }}` unescaped
  (`_layouts/page.html:10`, `_includes/menubar.html:9`,
  `_includes/metatags.html:13`). A bare `&` followed by a space is not an
  ambiguous ampersand, so it renders literally in `<h2>`, `<title>`, the
  `og:title` attribute, and the JSON-LD string. No escaping change is needed,
  and none is in scope.

### 5. Menubar and llms.txt position

`writeMenubar()` iterates the table and emits every entry whose slug is in the
page map, so the new key's alphabetical position produces:

```yaml
    - name: Random Access Microtalks      # only when present
      link: program/rams/
    - name: Student & Early Career
      link: program/student-early-career-program/
    - name: Talks
      link: program/talks/
```

Against the current `_data/menus/program.yml` — which has no RAMs or Plenaries
line, because no live event carries those formats — the diff is exactly two
lines inserted between `Posters` and `Talks`.

`abstractPages()` (`:1394-1407`) filters the same table the same way, so
`program/llms.txt` and `program/llms-full.txt` gain one entry in the same
relative position, rendered as
`https://us-rse.org/usrse26/program/student-early-career-program/` with the
title `Student & Early Career`.

Both callers must agree, because `check-program-llms.yml` rebuilds the
llms files with `--from-json` and fails on a diff. They do agree here without
special handling: `abstractPages()` keys schedule-driven formats off the
Event Format cell in `program.json` (`:1396-1399`), and `student` is not a
`tab` format, so the `hasGeneratedPage()` branch (`:1401`) never applies to
it.

### 6. Lifecycle: pruning and rollback

The new page is governed by the same rule as every other generated page. It
carries `PAGE_BANNER` (`:978`), so:

- **Format present in the sheet** → slug is in the page map → written, and
  skipped by the pruning loop (`:1189-1199`).
- **Format leaves the sheet** → slug absent from the map → the banner-carrying
  `student-program.md` is deleted and the menu item disappears. Reverting the
  sheet cells to `Other` is therefore a complete rollback, with no code change
  and no orphan file.
- **A hand-written `student-program.md`** would lack the banner and never be
  deleted — but it would be overwritten on the next run if the format is
  active. The page is script-owned.

No `.tbd` placeholder exists for this slug, and none is added.

### 7. Fixture design

`fixtures/schedule.csv` has 72 rows in the 13-column layout
`Start,End,Location,Session Topic,Event Title,Order,Session Description,People,Event Format,Event Description,Session Format,Session Chair,DOI`.
Session rows carry Session Format with an empty Event Title; event rows carry
Event Format.

Two sessions and three events are appended, covering every branch §2 and §4
describe:

| Row | Event Title | People | Event Description | Purpose |
| --- | --- | --- | --- | --- |
| session | — | — | — | Session Format `Student/Early Career`; exercises §3's eyebrow and `- Type:` output, and proves it is not muted. |
| event 1 | `Student Program Activity` | two names | — | Static `abstract--static` row; `href` set from People alone. |
| event 2 | `Student Program Activity` | two names | — | Anchor dedupe → `-2`. |
| session | — | — | — | A second `Student/Early Career` session in a later slot. |
| event 3 | `Early Career Lightning Round` | one name | Markdown, one paragraph | `<details>` entry; makes `entries.some(hasBody)` true so the page renders its toolbar. |

Titles deliberately mirror the live sheet's "Student Program Activity" so the
duplicate-anchor path is the same one production will hit. One event carries a
description precisely so the fixture page is not entirely static rows — both
`renderAbstractEntry()` branches and both `renderAbstractPage()` toolbar
branches are then covered by a single build.

### 8. Documentation

README `:89-90` lists the recognized Event Format values inline:

> Event Format (Bird of a Feather, Keynote, Notebook, Other, Paper, Plenary,
> Poster, Random Access Microtalk, Talk, or Workshop)

`Student` joins that list in alphabetical position, between
`Random Access Microtalk` and `Talk`. The surrounding sentence (`:91-95`)
already explains that non-`Other` formats generate an abstract page and a
menubar entry, so no new paragraph is needed.

`scripts/build-program.js`'s file header (`:30-45`) is **not** touched: it
documents the Schedule *columns* and the Session Format special cases
(Break/Meal/Registration/Plenary), and has never enumerated the Event Format
vocabulary. Adding one there would create a second list to drift.

Requirements Story 4 also asks the docs to carry the page title and permalink.
`FORMATS` is the single source for that mapping; README states the accepted
cell value and points at the generated menubar for where it lands, rather than
restating three strings that only the table can keep true.

### 9. Expected diff after live regeneration

Once the committee has edited the sheet (Event Format `Student`, Session
Format `Student/Early Career`) and `PROGRAM_SHEET_ID=<id> node
scripts/build-program.js` has run, the commit should contain exactly:

- `pages/program/abstracts/student-program.md` — new.
- `_data/menus/program.yml` — two lines inserted.
- `program/llms.txt`, `program/llms-full.txt` — one index entry each; the two
  student sessions' `- Type:` lines change from `Student` to
  `Student/Early Career`.
- `_data/program.json` — for the two student events: `format` changes
  `"Other"` → `"Student"` and an `href` key is added; for their sessions,
  `type` changes `"Student"` → `"Student/Early Career"`.
- `_includes/program-schedule.html` — those two events gain an empty
  `talk__format` span and a `talk__link` anchor; the two eyebrows change text.
- `_includes/program-grid.html` — the two card eyebrows change text.

Anything outside that list means something unintended moved.

## Requirements coverage

| Story / criterion | Where addressed |
| --- | --- |
| 1 — `Student` resolves to the new entry (slug/permalink/pageTitle/label) | §1 |
| 1 — case-insensitive, trimmed match | §1 (key table), §2 step 1 |
| 1 — other spellings fall to `Other` | §1 (one key, no aliases) |
| 1 — empty-label pill on the schedule | §2 step 4 |
| 1 — raw cell text in `program.json` as `format` | §2 step 2, §9 |
| 1 — `href` deep-link when the event has content | §2 step 3, §4 |
| 1 — no student rows → output unchanged | §6 (pruning), §1 (additive key) |
| 1 — Session Format verbatim in eyebrows, `type`, llms.txt | §3 |
| 1 — not muted, not plenary | §3 |
| 1 — no page/anchor/menu derived from Session Format | §3 |
| 2 — page written when a student event exists | §2 step 9 |
| 2 — front matter with the title and permalink | §4 |
| 2 — banner, stylesheet, wrapper, toolbar, script tag | §4 |
| 2 — `<details>` vs `abstract--static` by `hasBody()` | §2 step 7, §4, §7 |
| 2 — traversal order | §2 step 6 |
| 2 — `-2` anchor dedupe on the repeated title | §4, §7 |
| 2 — People rendered verbatim as the byline | §4 |
| 3 — menubar item at the alphabetical position | §5 |
| 3 — llms.txt index entry at the same position | §5 |
| 3 — pruning when the format leaves | §6 |
| 3 — `--from-json` agrees with the full build | §5 |
| 4 — fixture covers both entry shapes and the dedupe | §7 |
| 4 — fixture sessions carry `Student/Early Career` | §7 |
| 4 — fixture build exits zero, second run unchanged | §7 (deferred to tasks for the run itself) |
| 4 — Jekyll builds and serves the permalink | §4 (front matter), tasks |
| 4 — README documents the value | §8 |
| 4 — workflow commits the new files unedited | Affected components (pathspecs) |

**Nothing is intentionally dropped.** Two criteria are satisfied by
verification rather than by code — the Session Format passthrough (§3) and the
`--from-json` parity (§5) — and the tasks document names the checks.
