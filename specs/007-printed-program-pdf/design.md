# Design — printed program PDF

## Overview

A new script, `scripts/build-program-pdf.js`, works the same way as
`scripts/build-program.js`: one file, `'use strict'`, Node built-ins only, top-level
`main().catch` that prints `build-program-pdf: <message>` and exits 1. It never
touches the sheet. It reads five repo sources: `_data/program.json`,
`_config.yml`, `_print/welcome.md`, `pages/about/organization.md`, `index.html`,
plus `_data/org-members.yml` when present. From these it builds one
self-contained HTML string, writes it to `_print/program.html` through
`writeIfChanged`, and then has headless Chrome print that file to
`pages/program/program.pdf`.

The script splits into three parts:

1. **Readers** (I/O): small parsers that turn each source into plain data.
2. **Renderers** (pure): data → HTML strings, built the same way
   `renderHTML`/`renderAbstractPage` build theirs (arrays of lines, `esc()`
   on every interpolated value).
3. **Output** (I/O): `writeIfChanged`, Chrome discovery, and PDF rendering.

Page layout uses a short **in-page paginator** script embedded in the HTML.
Chrome runs it before printing. It moves schedule rows onto fixed US Letter
page boxes so a session never splits across pages and the day heading repeats
with ", continued". CSS alone cannot make a repeated heading read differently
on its first page, so the paginator does that job.

## Affected components

| File / module | Change |
| --- | --- |
| `scripts/build-program-pdf.js` | **New.** Readers, renderers, paginator source, Chrome driver, CLI (`--html-only`, `--force`). |
| `_config.yml` | Add `conf_location: "San Jose, CA"`. Add `conf_wifi_ssid` / `conf_wifi_password` as commented-out keys, so the Wi-Fi block stays off until real values exist. |
| `_print/welcome.md` | **New, committed placeholder** (`placeholder: true`). The General Chairs replace it before printing. |
| `_print/program.html` | **New, generated, committed.** Never published, because Jekyll skips `_`-prefixed directories. |
| `pages/program/program.pdf` | **New, generated, committed.** Jekyll serves it as a static file; nothing links to it until it is final. |
| `assets/img/program-qr.svg` | **New, committed by hand** (one-time, any QR tool). Encodes `https://us-rse.org/usrse26/program/`. |
| `scripts/build-program.js` | **Unchanged** (out of scope). Its `CONF.location` stays hard-coded; see "Follow-up" below. |
| `index.html`, `pages/about/organization.md`, `_data/org-members.yml` | Read only. |

## Detailed design

### §1 Shared helpers (copied, not imported)

`build-program.js` calls `main()` as soon as it loads, and changing it is out
of scope, so it cannot be `require`d. The new script copies the few helpers
it needs and notes where each came from:

- `readJekyllConfig`, `configFail` (message prefix becomes `build-program-pdf:`),
  `configValue`. These are the same regex scalar reader, still not a YAML parse.
- `esc(s)` for HTML escaping.
- `writeIfChanged(file, content)` returns `true` when it wrote, and logs
  `wrote` / `unchanged`.
- `SITE_BASE`, built from `url` + `baseurl` (`https://us-rse.org/usrse26/`).

### §2 Configuration

```js
const CONF = {
  title: configValue('title'),                 // USRSE'26
  theme: configValue('conf_theme_short'),
  location: configValue('conf_location'),      // fails if missing (Story 2)
  start: configValue('conf_start_date'),       // "2026-10-19 08:00:00 -0900"
  end: configValue('conf_end_date'),
  wifiSsid: JEKYLL.get('conf_wifi_ssid') || '',
  wifiPassword: JEKYLL.get('conf_wifi_password') || '',
};
```

`dateRange(start, end)` reads `YYYY-MM-DD` as a substring and never creates a
`Date`, for the same reason `TZ_OFFSET` gives in `build-program.js`. Output:

- same month: `October 19–21, 2026`
- different months: `September 30–October 2, 2026`

Month names come from a fixed English array.

The script resolves these paths from `REPO_ROOT`:

- `PROGRAM_JSON`
- `WELCOME_MD = _print/welcome.md`
- `ORG_MD = pages/about/organization.md`
- `INDEX_HTML`
- `ORG_MEMBERS_YML = _data/org-members.yml`
- `QR_SVG = assets/img/program-qr.svg`
- `LOGO_SVG = assets/img/usrse26-long-logo.svg`
- `OUT_HTML = _print/program.html`
- `OUT_PDF = pages/program/program.pdf`

### §3 Readers

**`readProgram()`** parses `program.json`. It throws `program.json does not
exist` or `program.json has no days` with the same wording `mainFromJson`
uses, before anything is written (Story 1).

**`readWelcome()`** returns `null` with a warning when the file is missing.
Otherwise it splits off a leading `---\n…\n---` front matter block, reads
`placeholder: true` with a line regex, and returns
`{ placeholder, bodyMd }`. When `placeholder` is set, it warns
`welcome letter is still the placeholder (_print/welcome.md)`.

**`readCommittee()`** walks `organization.md` line by line:

- Skips the front matter block.
- Skips any line containing `{{` or `{%`.
- On a heading (`^(#{2,4})\s+(.*)`), opens a node at that depth. A `##`
  heading whose text is `Contact` starts skipping until the next `##`.
- A list item (`^\s*[*-]\s+(.*)`) becomes a member of the current node, with
  inline Markdown reduced to text by `mdToText`.
- Any other line (prose, `*Contact: …*` emphasis lines, the reviewers
  sentence) is ignored.

The result is a tree of `{ title, depth, members[], children[] }`. Nodes with
no members and no member-bearing children are pruned, so "Committees" survives
only as the parent of "Technical Program Committee". If the pruned tree is
empty, it throws `organization.md has no committee members` (Story 5).

Today's file produces this tree:

- General Chairs (2)
- Committees
  - Technical Program Committee
    - Technical Program Chairs (2)
    - Committee Members (7)
  - Sponsorship Chairs, Student Chairs, Communications Chairs, Logistics
    Chairs, Community Engagement Chairs

**`readSponsors()`** reads `index.html` and cuts the region from the
`Conference Sponsors` `<h2>` to the next `class="sectionheader"` or `<h1`,
whichever comes first. With PR #63 merged, the "Organizational Founding
Members" header that follows is outside the region, so its Premier/Standard/Basic
`<h3>`s are never mistaken for sponsor tiers. Inside the region, one global
regex scans for two kinds of match:

- a tier heading: `<h[34][^>]*>([^<]+)</h[34]>`
- a logo include: `{%\s*include\s+add-sponsor-logo\.html\b([^%]*)%}`

Attributes come from the include with `(\w+)="([^"]*)"`. Each include goes into
the most recent tier as `{ file: logo_file, alt: logo_alt, url: sponsor_url }`.
Tiers without logos are dropped. If no tiers remain, it throws `index.html has
no sponsor tiers` (Story 6). It checks every `assets/img/sponsor-logos/<file>`
with `fs.existsSync`; the first missing file throws `sponsor logo not found:
assets/img/sponsor-logos/<file>`.

Current tiers, in order: Platinum (4), Gold (3), Silver (1), Bronze (3),
Break (1).

**`readOrgMembers()`** returns `null` when `_data/org-members.yml` is absent.
Otherwise it runs a minimal line parser for exactly the shape PR #63 commits:

```yaml
premier:              # top-level key, column 0, no value
  - name: "Princeton University"   # "- " opens an item
    figure: logo-princeton.png     # indented "key: value"
    date_joined: 2025-04-18
```

Values are unquoted the same way `readJekyllConfig` does it, and trailing
whitespace is trimmed (the PR's `figure: logo-princeton.png` has trailing
spaces). Empty values (`acronym:`) become `''`. Only `name`, `figure`,
`acronym`, `date_joined`, and `background` are kept. `contact` and `url` are
dropped at read time, so they cannot reach the renderer (Story 6).

PR #63's file currently has every top-level key twice: the 121-line block is
repeated. Jekyll's YAML loader (Psych) keeps the **last** value for a
duplicate key. The parser does the same and warns
`org-members.yml repeats key "basic" — using the last one`, so the PDF matches
what the homepage renders and the repetition is still visible.

Levels come out in the fixed order `premier`, `standard`, `basic`, each sorted
by `date_joined` as a string (ISO dates sort lexically), matching
`sort: "date_joined"` in the PR. A missing `assets/img/org-logos/<figure>`
throws, the same as a sponsor logo.

If the YAML has a line the parser does not recognize (a nested map, a
multi-line scalar), it throws `org-members.yml line N: unsupported YAML`
rather than guessing.

### §4 Markdown

`build-program.js` has no Markdown renderer, because Jekyll's `markdownify`
does that work there. The PDF needs only two small functions:

- **`mdInline(md)`** turns trusted text into HTML. It escapes with `esc`
  first, then applies:
  - `\*\*(.+?)\*\*` → `<strong>`
  - `\*(.+?)\*` / `_(.+?)_` → `<em>`
  - `\[(.+?)\]\((.+?)\)` → the link text only (print has no clickable links,
    and this matches the 2025 style)

  Used by the welcome letter. Paragraphs split on blank lines, each wrapped in
  `<p>`, and single newlines inside a paragraph become spaces.
- **`mdToText(md)`** applies the same patterns but emits plain text, then
  `oneLine()`. Used for `session.info`, talk titles, and committee members.

Every sheet-sourced string goes through `esc` (directly or inside `mdInline`)
before it reaches the HTML (Story 4, injection).

### §5 Rendering

`renderDocument({ conf, program, welcome, committee, sponsors, orgMembers })`
returns one HTML string:

```text
<!doctype html> … <style>…</style>
<body>
  <section class="page cover">…</section>
  <section class="page welcome">…</section>        (only when welcome != null)
  <div class="flow" data-flow="schedule">…rows…</div>
  <div class="flow" data-flow="back">…committee…</div>
  <section class="page sponsors">…</section>
  <script>/* paginator */</script>
</body>
```

The output file starts with `<!-- Generated by scripts/build-program-pdf.js — do not edit -->`.

**Page box.** Each page is `@page { size: letter; margin: 0 }` plus a
`.page { width: 8.5in; height: 11in; padding: 0.6in 0.65in; overflow: hidden;
break-after: page; }`. With fixed boxes, the PDF page count equals the number
of `.page` elements.

**Typography and color.** The font stack is `system-ui, -apple-system,
"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`, with no web fonts
because the render is offline. The accent is the site's brand color,
`--us-rse-main` (`#741755`), read from `assets/css/bootstrap.css` at build
time by `readAccent()` and set as the `--accent` custom property; a missing
or non-hex value fails the build. Body text is 9.5pt, matching the 2025 density. Colors
are print-safe and there is no dark mode.

**Backdrop squares.** The cover and the sponsors page carry the USRSE'25
program's backdrop: light-gray (`#E6E6E4`) squares, dense at the top and
thinning downward. `renderSquares(rows, seed, bleed)` emits it as an
absolutely positioned inline SVG behind the content, from a fixed-seed PRNG
(mulberry32), so the pattern, and with it the HTML, is identical on every
run. Squares are separated by 0.05in gaps and sized so a whole number spans
the width exactly; the non-bleed form (15 squares across the 7.2in content
width, inside the page margins) remains available.

Both pages are full bleed (`bleed`), as in 2025: 17 squares span the whole
8.5in page from its top edge.

- **Cover**: 8 rows, down to just above the USRSE logo. The QR band also
  runs edge to edge (negative side margins, square corners), and the cover
  content sits at the bottom of the page.
- **Sponsors page**: 10 rows, reaching to about 5in, just above the middle
  of the page.

Full bleed needs a printer (or print shop) that prints to the paper edge;
on a desktop printer the outer edge is clipped by its unprintable margin.

**Cover (Story 2).** From top to bottom:

- `../assets/img/usrse26-long-logo.svg` at full width
- `CONF.theme` as a large title
- `${CONF.location} · ${dateRange}`
- an accent band holding two cells:
  - left: `../assets/img/program-qr.svg` + "Full program details and
    abstracts" + `SITE_BASE + 'program/'`
  - right: "Wi-Fi" + SSID + password, rendered only when `CONF.wifiSsid` is
    non-empty

Before rendering, `fs.existsSync(QR_SVG)` is checked and throws `QR code not
found: assets/img/program-qr.svg` when missing.

**Welcome (Story 3).** In order:

- `<h1>Welcome!</h1>`
- the paragraphs from `mdInline`
- a rule
- the Code of Conduct notice in small type: "All conference participants are
  expected to abide by the Code of Conduct … report problems or concerns to
  coc@us-rse.org." followed by `SITE_BASE + 'about/code-of-conduct/'`
- "Full program details and conference policies: `SITE_BASE`"

`coc@us-rse.org` is a constant with a comment pointing to
`pages/about/code-of-conduct.md:14`.

**Schedule rows (Story 4).** `renderSchedule(days)` emits one flat list of
`.row` elements so the paginator can move them one at a time:

```html
<div class="row row--intro">…"Schedule Overview" + note + URL…</div>
<div class="row row--day" data-day="Monday, October 19">…</div>
<div class="row row--session" data-day="Monday, October 19"
     data-slot="s-0-3" data-time="10:30am–12pm" data-first="1">
  <div class="time">10:30am–12pm</div>
  <div class="body">…session…</div>
</div>
```

- The day heading is `${day.weekday}, ${day.label}`.
- Time is `${slot.start}–${slot.end}` with an en dash, as `fmtRange` writes
  it. Only the first session in a slot (`data-first="1"`) shows the time.
- The session body (`renderOverviewSession(session)`) is built as follows:
  - The title has any "(Sponsorship available)" note removed
    (`SPONSORSHIP_NOTE`, case-insensitive): it is sponsor outreach, not
    attendee information.
  - **Muted** (`session.muted`): one line, **title**, *room*.
  - **Otherwise**: **title**, *room* on the first line, then:
    - non-empty `session.info` → `<p class="info">` with `mdToText(info)`
    - `talks.length === 1` and `normalizeFormat(talk.format)` is one of
      Keynote, Workshop, Bird of a Feather, Student → `<p>Keynote —
      Fernando Pérez</p>` (regular weight, like the time column), using
      `FORMAT_LABELS`, with no speakers line
    - `session.type === 'Talks'` or `talks.length > 1` → `<ul>` with one
      `<li>` per talk title
    - otherwise (one talk with any other format) → one `<li>`, so the talk is
      still listed
- `session.chair` is never read (Story 4, Resolved decision 8).

`FORMAT_LABELS` is a small local map: `keynote` → `Keynote`, `workshop` →
`Workshop`, `bird of a feather` → `Birds of a Feather`, `student` → `Student &
Early Career`. Lookup goes through a local `normalizeFormat` that matches
`build-program.js` (trim + lowercase). The labels come from `FORMATS[*].pageTitle`
there. It is a copy, with a comment saying so.

**Committee (Story 5).** `renderCommittee(tree)` emits rows into the `back`
flow: `<h1>Organizing Committee</h1>`, then each node as `<h3>`/`<h4>` (by
depth) followed by a `<ul>` of members. CSS uses a two-column layout
(`columns: 2`), as 2025 did. Each top-level group is one row, so the paginator
keeps groups whole.

**Sponsors (Story 6).** `renderSponsors(sponsors, orgMembers)` is one fixed
`.page`:

- `<h1>Thank You Sponsors!</h1>`
- one `<section>` per tier, with its tier name in small caps and the logos in
  a centered flex-wrap row
- logo heights stepped by tier index: `[0.65in, 0.55in, 0.45in, 0.4in, 0.35in]`,
  clamped to the last value, each logo at most 1.55in wide so four Platinum
  logos fit on one row (reduced during implementation from 0.9in-first: with
  PR #63's 15 org members, the larger sizes overflowed the sheet)
- when `orgMembers` is present:
  - `<h2>US-RSE Organizational Founding Members</h2>`
  - Premier / Standard / Basic sub-sections, logos at 0.4in / 0.32in /
    0.3in, at most 1.3in wide
  - an item with `background` gets `style="background:<value>"` on its tile.
    The value is checked against
    `^(#[0-9a-f]{3,8}|rgba?\([\d.,\s]+\))$/i` and dropped with a warning if it
    does not match, since the value is interpolated into CSS
- `SITE_BASE` as the footer

If the content overflows the one page, the paginator counts it in
`data-overflow`, which the script reports as a warning (see §7).

All image paths are relative to `_print/` (`../assets/img/...`) and go
through `esc`.

### §6 Paginator (in-page JS)

About 60 lines, stored as a template literal `PAGINATOR_JS` in the script and
emitted verbatim. It runs on `DOMContentLoaded`, after
`document.fonts.ready` and every `<img>` has loaded, because image heights
affect layout.

```text
for each .flow:
  page = newPage(flow)                      // <section class="page">
  for each row in flow.children (moved, in order):
    if row is a day heading: currentDay = row.dataset.day
    page.content.append(row)
    if page.content overflows (scrollHeight > clientHeight):
      page.content.removeChild(row)
      page = newPage(flow)
      if row is a session and currentDay and row is not preceded by its day heading on this page:
        append <h2 class="day">{currentDay}, continued</h2>
      if row is a session and not data-first:
        row.querySelector('.time').innerHTML = `${row.dataset.time}<br><i>continued</i>`
      page.content.append(row)
      if still overflowing: overflow++ (one session taller than a page; it is clipped —
                            not expected with current data)
  flow.replaceWith(...pages)
for each fixed .page (cover, welcome, sponsors): if it overflows, overflow++
document.documentElement.dataset.overflow = overflow
document.documentElement.dataset.paginated = 'true'
```

- A day heading row that would be the last thing on a page is also moved to
  the next page (keep-with-next). The check is: after appending a day
  heading, if the next row would not fit, start the new page now.
- The ", continued" heading is added only for a page break **inside** a day.
  A page that starts with the day's own heading does not get it.
- The 2025 PDF shows "continued" in the time column when a slot spans a page
  break. The `data-first`/`data-time` rule reproduces that.

The HTML works when opened in a browser too: the same script paginates it on
screen, which is handy for checking layout without Chrome's CLI.

### §7 Chrome rendering

**`findChrome()`** checks, in order:

1. `process.env.CHROME_PATH` (if set and it does not exist → throw `CHROME_PATH
   does not exist: <path>`)
2. macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
   `/Applications/Chromium.app/Contents/MacOS/Chromium`
3. `PATH` lookups via `execFileSync('which', [name])` for `google-chrome`,
   `google-chrome-stable`, `chromium`, `chromium-browser`

It returns the path or `null`.

**`renderPdf(chrome, htmlFile, pdfFile)`** writes to a temp file next to the
target (`program.pdf.tmp`) and then renames it, so a crash never leaves a
truncated PDF:

```js
execFileSync(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--no-pdf-header-footer', '--print-to-pdf-no-header',   // new + old flag names
  '--virtual-time-budget=10000',                           // let the paginator run
  '--allow-file-access-from-files',
  `--print-to-pdf=${tmp}`,
  pathToFileURL(htmlFile).href,
], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
```

A non-zero exit or a missing temp file throws `Chrome failed to print:
<stderr first line>`.

**Page count.** Chrome does not report one, so the script counts
`/Type\s*\/Page(?!s)` in the PDF bytes and logs `program.pdf: N pages`
(Story 7). This is a deliberate reading of the "page count Chrome reported"
criterion: the count comes from the file Chrome wrote.

**Overflow warnings.** The paginator sets `data-overflow="<n>"` on `<html>`
when any row is too tall or a fixed page (sponsors) overflows. To read that,
the script makes a second, cheap Chrome call with `--dump-dom` and the same
flags (without `--print-to-pdf`) and checks that attribute. It warns, and does not fail, because the PDF is
still usable and an organizer can trim content. To keep the run fast, this
call only happens when a PDF is actually rendered.

### §8 Main and CLI

```
main():
  conf = CONF (config errors already exit via configFail)
  program = readProgram()                     // throws before any write
  welcome = readWelcome(); committee = readCommittee()
  sponsors = readSponsors(); orgMembers = readOrgMembers()
  check QR_SVG and LOGO_SVG exist
  html = renderDocument(...)
  htmlChanged = writeIfChanged(OUT_HTML, html)
  if --html-only: return
  chrome = findChrome()
  if !chrome: throw 'no Chrome/Chromium found — wrote _print/program.html; set CHROME_PATH to render the PDF'
  stale = --force || !exists(OUT_PDF) || mtime(OUT_PDF) < mtime(OUT_HTML)
  if !stale: log '  unchanged  pages/program/program.pdf'; return
  renderPdf(...); log page count; check overflow
```

- The **staleness test uses mtime, not the `htmlChanged` flag.** If a run
  writes the HTML and then fails before the PDF (no Chrome, Chrome crash), the
  next run must still render, even though the HTML is now `unchanged`.
  `writeIfChanged` leaves an unchanged file's mtime alone, so once a PDF has
  been rendered from the current HTML, re-running is a no-op (Story 7).
- If you change a logo file, the HTML stays the same and the PDF is not
  re-rendered. `--force` covers that case, and the script header says so.
- After a fresh `git clone`, the two files can get mtimes in either order,
  which may trigger one harmless re-render. That is acceptable.
- Throwing "no Chrome found" after writing the HTML satisfies Story 1:
  the HTML exists, the message names it and `CHROME_PATH`, and the exit code
  is 1.

### §9 Welcome placeholder

`_print/welcome.md`:

```markdown
---
placeholder: true
---

*Placeholder.* The General Chairs replace this file with their welcome
letter before the program is printed, and remove `placeholder: true` above.
Plain Markdown paragraphs, *emphasis*, **strong**, and [links](https://…)
are supported; links print as their text.

Alex Koufos and Keith Beattie
**General Chairs, USRSE'26**
```

### Follow-up (not in this feature)

`build-program.js` has `CONF.location = 'San Jose, California, USA'`, and its
comment explains it is hard-coded because no `_config.yml` key existed. Once
`conf_location` exists, that comment is out of date. Switching it to
`configValue('conf_location')` would change `llms.txt` output
(`San Jose, CA`), so it belongs in its own change. The new script's header
comment points to this.

### Criteria intentionally adjusted

- Story 7 "page count Chrome reported": counted from the PDF Chrome wrote
  (§7), because Chrome's CLI does not print one.
- Story 7 "write only when the print HTML changed": uses an mtime comparison
  instead of the changed flag (§8). It is a stricter version of the same
  intent, and covers interrupted runs.

## Requirements coverage

| Story / criterion | Where addressed |
| --- | --- |
| 1 — reads `program.json`, no sheet / `PROGRAM_SHEET_ID` | §3 `readProgram`; no `fetch` in the script |
| 1 — self-contained print HTML at `_print/program.html`, Letter `@page` | §5 page box; §8 `writeIfChanged(OUT_HTML)` |
| 1 — Chrome via `CHROME_PATH` / standard paths → `program.pdf`, no header/footer | §7 `findChrome`, `renderPdf` flags |
| 1 — no Chrome → HTML written, message, non-zero | §8 throw after HTML write |
| 1 — `--html-only` | §8 |
| 1 — missing / empty `program.json` → one-line failure, nothing written | §3 `readProgram` runs before any write |
| 1 — built-ins only | §1, §7 (`fs`, `path`, `child_process`, `url`) |
| 2 — cover: logo, theme, `conf_location`, date range | §2 `CONF`, `dateRange`; §5 Cover |
| 2 — missing `conf_location` fails | §2 `configValue` |
| 2 — QR image + program URL; missing QR fails | §5 Cover |
| 2 — Wi-Fi shown only when `conf_wifi_ssid` set | §2, §5 Cover |
| 3 — render `_print/welcome.md` with inline Markdown | §3 `readWelcome`, §4 `mdInline`, §5 Welcome |
| 3 — committed placeholder with `placeholder: true` | §9 |
| 3 — placeholder warning | §3 `readWelcome` |
| 3 — CoC notice + URLs | §5 Welcome |
| 3 — missing file → page omitted, warning | §3 `readWelcome`, §5 conditional section |
| 4 — "Schedule Overview" heading + online note | §5 `row--intro` |
| 4 — day headings, slot order, time column, session order | §5 Schedule rows |
| 4 — bold title + italic room; muted one-liner | §5 `renderOverviewSession` |
| 4 — no chair | §5 (never read) |
| 4 — talk bullets | §5 |
| 4 — single Keynote/Workshop/BoF/Student → "Format: title", no speakers | §5, `FORMAT_LABELS` |
| 4 — "(Sponsorship available)" dropped from titles | §5 `SPONSORSHIP_NOTE` |
| 4 — `info` as plain text | §4 `mdToText` |
| 4 — ", continued" day heading; no session split | §6 paginator |
| 4 — escaping | §4, §5 (`esc` everywhere) |
| 5 — committee from `organization.md`, skipping front matter / Liquid / Contact / prose | §3 `readCommittee`, §5 Committee |
| 5 — empty committee fails | §3 |
| 6 — tiers parsed from `index.html`, in order, with `logo_alt` | §3 `readSponsors`, §5 Sponsors |
| 6 — size by tier, one sheet | §5 heights; §7 overflow warning |
| 6 — no tiers fails | §3 |
| 6 — org members when file present, level order, `date_joined` sort, alt | §3 `readOrgMembers`, §5 Sponsors |
| 6 — `background` honored | §5 (validated) |
| 6 — file absent → section omitted | §3 returns `null` |
| 6 — `contact` never printed | §3 dropped at read |
| 6 — missing logo file fails | §3 |
| 6 — website URL footer | §5 Sponsors |
| 7 — `writeIfChanged` for HTML | §1, §8 |
| 7 — PDF only when stale | §8 mtime rule (adjusted) |
| 7 — `--force` | §8 |
| 7 — log page count / path | §7 page count (adjusted) |
