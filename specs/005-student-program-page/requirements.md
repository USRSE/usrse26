# Requirements — student program page

Status: approved

## Summary

`scripts/build-program.js` recognizes event formats through one lookup table,
`FORMATS` (`:174-185`), keyed by the lowercased, trimmed value of the Schedule
tab's **Event Format** column. Each entry carries four fields — `label` (the
pill drawn on the schedule), `pageTitle`, `permalink`, and `slug` (the
`pages/program/abstracts/<slug>.md` filename and the per-page anchor namespace)
— plus an optional `tab` for formats owned by a second sheet tab (posters).
`normalizeFormat()` (`:213-217`) maps an unknown cell to `FORMATS.other`, which
has all four fields `null`: no pill, no page, no menu entry.

Everything downstream keys off that table and nothing else:

- `assignAnchors()` (`:604-625`) gives every page-format event a per-page
  anchor and sets `talk.href` once the event has an abstract, a portrait, a
  byline, or a DOI.
- `renderSession()` (`:690-692`) draws the pill from `_format.label`.
- `collectAbstracts()` (`:1005-1046`) groups page-format events by `slug`.
- `renderAbstractPage()` (`:1111-1147`) writes the front matter from
  `pageTitle`, `label`, and `permalink`.
- `writeAbstractPages()` (`:1172-1204`) writes one file per active slug and
  prunes any banner-carrying `.md` in the abstracts directory whose slug is not
  in the page map.
- `writeMenubar()` (`:1622-1643`) and `abstractPages()` (`:1394-1407`) iterate
  `Object.values(FORMATS)`, so **insertion order in the table is the menubar
  order and the llms.txt page-list order**.

The live sheet already runs a student track. `_data/program.json` holds two
sessions titled "Student Program Activity" (October 19, 10:30am-11:30am and
1:30pm-2:30pm, Market Street, Scott Michael and Stephanie Brink), each with
Session Format `Student` and a single event whose **Event Format cell reads
`Other`**. Because `Other` is the opt-out entry, those events get no pill, no
anchor, no page, and no menu entry today. `fixtures/schedule.csv` has no
student rows at all.

Both sheet columns change. **Event Format** becomes `Student`, the new table
key. **Session Format** becomes `Student/Early Career`, the session-level
label. Session Format needs no code support — `fold()` (`:448`) carries it
through verbatim to the `session__eyebrow` on the list (`:679`), the
`grid__card-eyebrow` on the grid (`:903`), `type` in `_data/program.json`
(`:517`), and the `- Type:` line in llms.txt (`:1553`) — but the exact value
matters, because it is the string attendees read above the session title.

This feature adds a `student` entry to `FORMATS` so that Schedule rows whose
Event Format is `Student` generate `pages/program/abstracts/student-program.md`
— served at `program/student-early-career-program/` — in exactly the shape the
other abstract pages already use, and so that the page joins the program
menubar, the llms.txt page index, and the prune/rebuild cycle with no new
machinery. The filename slug (`student-program`) and the permalink
(`student-early-career-program`) deliberately differ; `FORMATS` already keeps
them independent (`bird of a feather` → slug `bofs`, permalink `program/bofs/`).

## User stories

### Story 1 — A "Student" Event Format the generator understands

As a program committee member editing the Schedule tab, I want to type
`Student` in the Event Format column so that the event is treated as a
first-class program format instead of falling through to `Other`.

**Acceptance criteria**

- WHEN the Schedule tab's Event Format cell for an event row reads `Student`,
  THE system SHALL resolve it through `normalizeFormat()` to a `FORMATS` entry
  whose `slug` is `student-program`, whose `permalink` is
  `program/student-early-career-program/`, whose `pageTitle` is
  `Student & Early Career`, and whose `label` is the empty string.
- WHEN that cell is matched, THE system SHALL match it case-insensitively and
  ignoring surrounding whitespace, exactly as every other `FORMATS` key is
  matched.
- WHEN the Event Format cell reads any other spelling of the student track
  (`Student Program`, `Student & Early Career`, ...), THE system SHALL treat it
  as `Other` — the existing fallback — because the table carries the single key
  `student` and no aliases.
- WHEN a student-format event is rendered on the schedule, THE system SHALL
  draw the empty-label pill `<span class="talk__format"></span>`, as
  `bird of a feather` and `workshop` do today (`:690-692`), rather than a
  visible format pill.
- WHEN an event resolves to the student format, THE system SHALL record the
  sheet's raw cell text in `_data/program.json` as that event's `format`, as it
  does for every other format.
- WHEN an event resolves to the student format and has an abstract, a portrait,
  a byline, or a DOI, THE system SHALL set its `href` to
  `program/student-early-career-program/#<anchor>` and deep-link its title on
  the schedule, using the existing `assignAnchors()` rule with no change to it.
- WHEN no Schedule row carries the student format, THE system SHALL behave
  exactly as it does today: no student page, no menu entry, and byte-identical
  output for every other artifact.
- WHEN a student session's Session Format cell reads `Student/Early Career`,
  THE system SHALL carry that string through verbatim as the session `type`:
  the `session__eyebrow` on the schedule list (`:679`), the
  `grid__card-eyebrow` on the grid (`:903`), `type` in `_data/program.json`
  (`:517`), and the `- Type: Student/Early Career` line in llms.txt (`:1553`).
- WHEN `Student/Early Career` is read as a Session Format, THE system SHALL NOT
  treat the session as muted — the value is absent from `MUTED_TYPES` (`:163`)
  — and SHALL NOT mark it plenary (`:521`), so the session renders as a full
  session block.
- WHEN Session Format is `Student/Early Career`, THE system SHALL NOT derive
  any event format, page, anchor, or menu entry from it; page generation keys
  off the Event Format column alone.

### Story 2 — The student program abstract page

As a conference attendee, I want a Student & Early Career Program page that
looks and behaves like the Talks and Keynotes pages so that I can scan the
student track and open one entry at a time.

**Acceptance criteria**

- WHEN at least one Schedule event carries the student format, THE system SHALL
  write `pages/program/abstracts/student-program.md`.
- WHEN that page is written, THE system SHALL emit the front matter
  `renderAbstractPage()` (`:1111-1127`) already emits — `layout: page`,
  `menubar: program`, `menubar_toc: true`, `set_last_modified: true` — with
  `title: Student & Early Career` and
  `permalink: program/student-early-career-program/`.
- WHEN the `description` front matter is emitted from the empty `label`, THE
  system SHALL produce `description:  abstracts at USRSE'26` with the same
  leading space `workshops.md` and `bofs.md` already carry — pre-existing
  behavior of the shared renderer, not a new defect to fix here.
- WHEN that page is written, THE system SHALL carry the existing `PAGE_BANNER`
  (`:978`), the `abstracts.css` link, the `.abstracts` wrapper, the hidden
  expand-all toolbar, and the deferred `abstracts.js` tag, unchanged.
- WHEN a student event has an abstract, a portrait, or a DOI, THE system SHALL
  render it as a `<details class="abstract">` entry; WHEN it has none of those,
  THE system SHALL render the static `abstract--static` row, per the existing
  `hasBody()` branch (`:995-998`, `:1072-1105`).
- WHEN entries are emitted, THE system SHALL list them in the same schedule
  traversal order `collectAbstracts()` uses (day → time slot → session → event).
- WHEN two student events share a title — as the two "Student Program Activity"
  sessions do today — THE system SHALL give the second the `-2` anchor suffix
  through the existing `nextAnchor()` dedupe (`:569-578`), producing
  `student-program-activity` and `student-program-activity-2`.
- WHEN a student event has non-empty People, THE system SHALL render it
  verbatim as the byline, as the other pages do.

### Story 3 — Menubar, llms.txt, and pruning

As a maintainer, I want the student page to be a first-class generated page so
that it appears in the program menu, in the agent-facing index, and survives
rebuilds.

**Acceptance criteria**

- WHEN the student page is written, THE system SHALL include its slug in the
  page map handed to `writeMenubar()`, so `_data/menus/program.yml` gains a
  `Student & Early Career` item at `program/student-early-career-program/`.
- WHEN the `student` key is added to `FORMATS`, THE system SHALL place it in
  the table's existing alphabetical key order — between
  `random access microtalk` and `talk` — so the menubar item lands between
  `Random Access Microtalks` and `Talks`, and SHALL leave every other item's
  relative order unchanged.
- WHEN `program/llms.txt` and `program/llms-full.txt` are rendered, THE system
  SHALL list the student page in `abstractPages()` output (`:1394-1407`) at the
  same alphabetical `FORMATS` position, with its absolute URL and the
  `Student & Early Career` title.
- WHEN a rebuild finds no student-format Schedule rows, THE system SHALL prune
  a banner-carrying `student-program.md` and drop its menubar and llms.txt
  entries, exactly as it does for any format that leaves the sheet.
- WHEN `node scripts/build-program.js --from-json` runs against the committed
  tree, THE system SHALL produce the same llms.txt page list as a full build,
  so the `check-program-llms` workflow stays green.

### Story 4 — Reproducible, testable build

As a maintainer, I want the new format covered by the offline fixture so that
the behavior is verifiable without the live sheet.

**Acceptance criteria**

- WHEN `fixtures/schedule.csv` is updated, THE system SHALL include at least
  two events whose Event Format is `Student` — one with an Event Description
  and one without — including a repeated title, so the collapsible entry, the
  static row, and the anchor dedupe are all exercised.
- WHEN those fixture rows are added, THE system SHALL give their sessions the
  Session Format `Student/Early Career`, matching the live sheet, so the
  eyebrow and `- Type:` output are exercised offline.
- WHEN `node scripts/build-program.js --file fixtures/schedule.csv
  --posters-file fixtures/posters.csv` runs, THE system SHALL exit zero and
  write `pages/program/abstracts/student-program.md`.
- WHEN that command runs twice against unchanged input, THE system SHALL report
  `student-program.md` as unchanged on the second run and write nothing.
- WHEN `bundle exec jekyll build` runs after the fixture build, THE system
  SHALL build the student page without error and serve it at
  `program/student-early-career-program/`.
- WHEN the README's "Building the Program Schedule" section is read, THE system
  documentation SHALL list `Student` among the recognized Event Format values,
  with page title `Student & Early Career` and permalink
  `program/student-early-career-program/`, and SHALL note that no other
  spelling of the value is recognized.
- WHEN the `build-program.yml` workflow runs, THE system SHALL commit
  `student-program.md` and the menubar change through the existing
  `git add -A -- pages/program/abstracts _data/menus` pathspecs, with no
  workflow edit.

## Out of scope

- Any change to `assets/css/abstracts.css` or `assets/js/abstracts.js`.
- Reading the **Session Format** column to infer an event format. Session
  Format `Student/Early Career` stays a display label; this feature keys page
  generation off the **Event Format** column only, as every other format does.
- Adding `Student/Early Career` to `MUTED_TYPES` (`:163`) or to any other
  session-type vocabulary. It is carried through as free text.
- A second sheet tab for the student program. The student page is built from
  Schedule rows, like talks and keynotes, not like posters.
- Alias spellings for the Event Format cell. One exact value, `Student`, is
  recognized; see Resolved decisions for why.
- A warning or non-zero exit for an Event Format cell the table does not know.
  Unknown values have always fallen through to `Other` silently, and changing
  that would affect every format at once.
- Hand-authored prose (track description, eligibility, application deadlines)
  on the student page. The page is generated from sheet rows and carries the
  same banner as the others; any narrative content would need a separate
  mechanism.
- Changing the grid or list rendering of student sessions beyond the pill and
  the deep link the shared code paths already produce.
- Retiring or editing any `.tbd` placeholder.
- Renaming the existing `Other` Event Format cells in the live sheet — that is
  a sheet edit, not a code change.

## Resolved decisions

- **The sheet gets edited, not the code.** The two live student events carry
  Event Format `Other` today. The committee will change those cells to
  `Student` — the new table key — and will set Session Format to
  `Student/Early Career`. The generator keys page generation off the **Event
  Format** column only, as it does for every other format.
- **Session Format `Student/Early Career`.** A passthrough label, not a code
  path: it needs no table entry and no parsing, but it is what attendees read
  in the session eyebrow, so the fixture and the acceptance criteria pin the
  exact string. It is deliberately spelled differently from the Event Format
  value (`Student`) and from the page title (`Student & Early Career`); the
  three strings serve three different surfaces.
- **Empty pill label.** `label: ''`, following `bird of a feather` and
  `workshop`. The schedule shows the event title and its deep link without a
  format badge.
- **Page title `Student & Early Career`.** Used for the page `<title>` and the
  menubar item. The permalink keeps the longer
  `program/student-early-career-program/` form the user specified; `FORMATS`
  already treats `pageTitle`, `permalink`, and `slug` as independent fields.
- **Alphabetical position.** The `student` key goes between
  `random access microtalk` and `talk`, preserving the table's existing
  alphabetical order, which is also the menubar and llms.txt order.
- **No aliases (confirmed).** `normalizeFormat()` (`:213-217`) is an exact key lookup, and
  both `writeMenubar()` (`:1635`) and `abstractPages()` (`:1400`) emit one item
  per `Object.values(FORMATS)` entry whose slug is in the page map. A second
  key for the same page would therefore duplicate the menubar line and the
  llms.txt entry unless a dedupe pass were added in two places. No existing
  format carries aliases; `Student` is a single exact value, and the trade-off
  is that a mistyped cell falls silently to `Other`.

## Open questions

- None outstanding.
