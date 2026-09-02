# Design — posters sheet page

## Overview

The generator gains a second input, the "Posters" tab, read through the same
gviz CSV endpoint `loadCSV()` already uses (`scripts/build-program.js:974-993`)
or from a new `--posters-file` path offline. Poster rows are parsed by their
own small header map into flat `{title, authors, abstractMd, doi}` records —
they never pass through `fold()`, so the schedule includes and
`_data/program.json` cannot see them.

On the output side nothing new is invented. Poster entries are fed into the
existing abstract-page pipeline: `renderAbstractPage()` (`:871-909`) writes
`pages/program/abstracts/posters.md` with the same front matter, banner,
stylesheet, toolbar, and `<details>` rows, and `writeMenubar()` (`:947-968`)
lists the page because it is registered in the same page map. The one markup
addition is an optional metadata line at the end of `.abstract__body` holding
links: a poster's DOI and permalink, or a schedule event's DOI. An entry with
no links renders exactly as today.

`FORMATS.poster` (`:90`) stays in the vocabulary so the schedule keeps its
"Poster" pill and the menubar keeps its title/permalink/slug, but it is marked
as owned by the Posters tab. `collectAbstracts()` skips such formats, which
removes schedule-derived `posters.md` entries; `assignAnchors()` instead
resolves a Poster event's `href` against the Posters-tab anchors — the
matching entry when the slugified titles agree, the page top otherwise
(Story 5).

The Schedule tab's `DOI` column joins `HEADER_ALIASES` and rides the same
metadata line on the existing pages (Story 7).

## Affected components

| File / module | Change |
| --- | --- |
| `scripts/build-program.js` — config (`:49-50`) | Add `POSTERS_SHEET_NAME = 'Posters'` beside `SHEET_NAME`. |
| `scripts/build-program.js` — `FORMATS.poster` (`:90`) | Add `tab: 'Posters'` marking the page as built from another tab; every other entry is unchanged (absent = Schedule). |
| `scripts/build-program.js` — `HEADER_ALIASES` (`:145-161`) | Add `doi: 'doi'`. |
| `scripts/build-program.js` — `normalizeHeader()` (`:163-165`) | Take the alias map as a second parameter, defaulting to `HEADER_ALIASES`. |
| `scripts/build-program.js` — new `POSTER_HEADER_ALIASES`, `toPosterRecords()` | Parse the Posters tab into records; throw when the `Poster Title` column is missing. |
| `scripts/build-program.js` — `fold()` (`:344-352`, `:362-370`) | Carry `doi` on the raw talk and append `talk.doi` when non-empty. |
| `scripts/build-program.js` — new `nextAnchor(seen, base)` | The `-2`/`-3` dedupe step lifted out of `assignAnchors()` (`:428-432`) so posters share it exactly. |
| `scripts/build-program.js` — new `assignPosterAnchors(posters)` | Slugified-title anchors in sheet order, deduped per page. Returns the anchor set for Poster-event linking. |
| `scripts/build-program.js` — `assignAnchors(days, posterAnchors)` (`:417-441`) | Tab-owned formats resolve `href` against `posterAnchors` instead of getting a page anchor; `doi` joins the "worth linking" test; calls `nextAnchor()`. |
| `scripts/build-program.js` — `renderSession()` (`:507-510`) | Deep-link condition becomes `if (t.href)`. |
| `scripts/build-program.js` — `collectAbstracts()` (`:795-825`) | Skip `_format.tab` formats; add `meta` from `talk.doi`. |
| `scripts/build-program.js` — new `doiHref()`, `hasBody()` | DOI resolution; "collapsible" test shared by entry and toolbar rendering. |
| `scripts/build-program.js` — `renderAbstractEntry()` (`:849-869`) | Collapsible when the entry has an abstract **or** metadata links; body gains an optional `<p class="abstract__meta">`. |
| `scripts/build-program.js` — `renderAbstractPage()` (`:896`) | Toolbar condition uses `hasBody`. |
| `scripts/build-program.js` — new `posterEntries(posters)` | Map poster records to the entry shape with DOI and permalink metadata. |
| `scripts/build-program.js` — `writeAbstractPages()` (`:912-928`) | Take `posters` (`null` when skipped); register or keep the posters page; unchanged pruning loop. |
| `scripts/build-program.js` — `loadCSV()` (`:974-993`) | Split into `argValue()`, `fetchSheet(name)`, `loadScheduleCSV()`, `loadPostersCSV()`. |
| `scripts/build-program.js` — `main()` (`:1007-1026`) | Load and parse posters before anchors, log the count, pass them to `writeAbstractPages()`. |
| `scripts/build-program.js` — file header comment (`:1-38`) | Document the second tab, the flag, and the DOI column. |
| `fixtures/posters.csv` | **New.** Offline fixture covering every poster edge case below. |
| `fixtures/schedule.csv` | Gains a `DOI` column and a few values, including one Poster-event title that matches a posters fixture row. |
| `README.md` — "Building the Program Schedule" | Document the Posters tab, columns, `--posters-file`, the Schedule `DOI` column, and the Poster-event linking rule. |
| `.github/workflows/build-program.yml` | Header comment only: the job now reads two tabs. Pathspecs already cover `pages/program/abstracts` and `_data/menus`. |
| `assets/css/abstracts.css`, `assets/js/abstracts.js` | Unchanged. |
| `pages/program/abstracts/posters.tbd` | Untouched (no banner). |

## Detailed design

### 1. Loading two tabs

`loadCSV()` is replaced by three small functions plus an argv helper:

```js
/** Value following a `--flag`, or null when the flag is absent. */
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  const v = process.argv[i + 1];
  if (!v || v.startsWith('--')) throw new Error(`${flag} requires a path`);
  return v;
}

async function fetchSheet(sheetName) {
  if (!SHEET_ID) throw new Error('PROGRAM_SHEET_ID is not set. …');
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  console.log(`Fetching "${sheetName}" tab from Google Sheets…`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`"${sheetName}" tab fetch failed: HTTP ${res.status}`);
  return res.text();
}

/** Schedule: --file path, else the live sheet. */
async function loadScheduleCSV() {
  const file = argValue('--file');
  if (file) { console.log(`Reading ${file}`); return fs.readFileSync(path.resolve(file), 'utf8'); }
  return fetchSheet(SHEET_NAME);
}

/** Posters: --posters-file path; null (skipped) when the schedule came from
 * a file and no posters file was given; else the live sheet. */
async function loadPostersCSV() {
  const file = argValue('--posters-file');
  if (file) { console.log(`Reading ${file}`); return fs.readFileSync(path.resolve(file), 'utf8'); }
  if (argValue('--file')) { console.log('No --posters-file — skipping posters.'); return null; }
  return fetchSheet(POSTERS_SHEET_NAME);
}
```

Each input resolves independently, so `PROGRAM_SHEET_ID=… node
scripts/build-program.js --posters-file x.csv` reads the schedule live and the
posters from disk. The existing "PROGRAM_SHEET_ID is not set" message keeps its
`--file fixtures/schedule.csv` hint. (Story 1)

### 2. Parsing

**Schedule DOI.** `HEADER_ALIASES` gains `doi: 'doi'`. `toRecords()` then
carries `rec.doi` for free. In `fold()` the raw talk (`:344-352`) gains
`doi: rec.doi || ''`, and the output mapping (`:362-370`) appends
`if (t.doi) talk.doi = t.doi;` after `infoMd`, following the append-only
convention that keeps a DOI-less CSV byte-identical in `program.json`. The
legacy-row test (`:322`) is unchanged: a DOI-only row is still "legacy" for
byline splitting, which is harmless. (Story 7)

**Posters tab.**

```js
/** @type {Record<string, string>} */
const POSTER_HEADER_ALIASES = {
  authors: 'authors',
  postertitle: 'title', title: 'title',
  abstract: 'abstract',
  doi: 'doi',
};

function normalizeHeader(h, aliases = HEADER_ALIASES) {
  return aliases[h.toLowerCase().replace(/[^a-z]/g, '')] || null;
}

/**
 * Posters tab rows -> {title, authors, abstractMd, doi, _row}, sheet order,
 * rows without a title dropped. Unknown columns map to null and are skipped,
 * so a "Poster" number column (or any future one) is harmless.
 */
function toPosterRecords(rows) {
  const header = (rows[0] || []).map((h) => normalizeHeader(h, POSTER_HEADER_ALIASES));
  if (!header.includes('title')) {
    throw new Error(`"${POSTERS_SHEET_NAME}" tab has no "Poster Title" column — is the tab named ${POSTERS_SHEET_NAME}?`);
  }
  return rows.slice(1).map((cells, i) => {
    const rec = { _row: i + 2, title: '', authors: '', abstractMd: '', doi: '' };
    header.forEach((key, col) => {
      if (!key) return;
      const v = (cells[col] || '').trim();
      if (key === 'abstract') rec.abstractMd = v; else rec[key] = v;
    });
    return rec;
  }).filter((r) => r.title);
}
```

`parseCSV()` (`:114-142`) already drops all-blank rows and handles quoted
multi-line abstracts. A gviz response for a nonexistent tab is either a non-OK
status (caught in `fetchSheet`) or a body without the expected header (caught
here); both are fatal (resolved decision). (Stories 1, 2)

### 3. Anchors and Poster-event links

The dedupe step is lifted out so both walkers use one implementation:

```js
/** Next unique anchor for `base` within `seen` (base -> count). */
function nextAnchor(seen, base) {
  const n = (seen.get(base) || 0) + 1;
  seen.set(base, n);
  return n === 1 ? base : `${base}-${n}`;
}

/** Sheet-order anchors for the posters page. Returns the set of anchors so
 * Schedule Poster events can be linked to a matching entry. */
function assignPosterAnchors(posters) {
  const seen = new Map();
  for (const p of posters) p._anchor = nextAnchor(seen, slugify(p.title));
  return new Set(posters.map((p) => p._anchor));
}
```

`assignAnchors(days, posterAnchors)` (`:417-441`) gains one branch inside the
talk loop, before the page-anchor logic:

```js
if (talk._format.tab) {
  // Page owned by another tab: no entry here. Link to the matching entry
  // when the slugified titles agree, else the page top.
  const slug = slugify(talk.title);
  talk.href = posterAnchors.has(slug)
    ? `${talk._format.permalink}#${slug}` : talk._format.permalink;
  continue;
}
```

and its "worth linking" test (`:437`) becomes
`if (talk.infoMd || talk.speakers || talk.doi)`. `posterAnchors` is an empty
`Set` when the tab was skipped or empty, so every Poster event then links to
the page top. Match is on the first occurrence's anchor (a duplicate poster
title's `-2` entry is never matched — accepted; titles are unique in
practice). `renderSession()` (`:507-510`) changes its link test to `t.href`,
which today is set under exactly the old condition (`:437`), and the pill
still renders because `fold()` (`:369`) sets `_format` whenever `slug` is
non-null. `program.json` carries the resolved `href` for Poster events as it
does for other page formats. (Stories 2, 5, 6, 7)

### 4. Entry shape and rendering

Entries are `{title, people, infoMd, anchor, meta?}` where `meta` is an
optional list of `{href, text}` links. Two producers:

```js
/** DOI cell -> absolute URL. Already a URL: as given; else a bare DOI. */
function doiHref(doi) {
  return /^https?:\/\//i.test(doi) ? doi : `https://doi.org/${doi}`;
}

// collectAbstracts(): per talk
if (!talk._format || talk._format.tab) continue;
const entry = { title: talk.title, people: talk.speakers, infoMd: talk.infoMd || '', anchor: talk._anchor };
if (talk.doi) entry.meta = [{ href: doiHref(talk.doi), text: talk.doi }];

// posters
function posterEntries(posters) {
  return posters.map((p) => {
    const meta = [];
    if (p.doi) meta.push({ href: doiHref(p.doi), text: p.doi });
    meta.push({ href: `#${p._anchor}`, text: 'Link to this poster' });
    return { title: p.title, people: p.authors, infoMd: p.abstractMd, anchor: p._anchor, meta };
  });
}
```

`renderAbstractEntry()` becomes:

```js
const hasBody = (e) => Boolean(e.infoMd.trim() || (e.meta && e.meta.length));

function renderAbstractEntry(e, pad) {
  if (!hasBody(e)) { /* static <div> branch, unchanged */ }
  const body = [];
  if (e.infoMd.trim()) {
    body.push(`{% capture abstract_md %}${escLiquid(e.infoMd)}{% endcapture %}{{ abstract_md | markdownify }}`);
  }
  if (e.meta && e.meta.length) {
    const links = e.meta.map((m) => `<a href="${esc(m.href)}">${esc(m.text)}</a>`).join(' · ');
    body.push(`<p class="abstract__meta">${links}</p>`);
  }
  return [
    `${pad}<details class="abstract" id="${e.anchor}">`,
    `${pad}  <summary class="abstract__summary">`,
    ...renderAbstractHeading(e, `${pad}    `),
    `${pad}  </summary>`,
    `${pad}  <div class="abstract__body">${body.join('')}</div>`,
    `${pad}</details>`,
  ];
}
```

With no `meta`, `body.join('')` is exactly today's capture string, so every
existing entry is byte-identical. The body `<div>` stays on one line for the
same reason. `renderAbstractPage()` (`:896`) swaps
`entries.some((e) => e.infoMd.trim())` for `entries.some(hasBody)`.

Rendering notes:

- Every poster entry has at least the permalink, so `hasBody` is always true
  and the static branch is never taken on the posters page (Story 3). A
  schedule event with a DOI and no description is likewise collapsible
  (Story 7); one with neither stays static.
- DOI text is the cell as typed; href is `doiHref()`; both through `esc()`
  (Stories 3, 7). A URL-typed DOI reads as its URL.
- `<p class="abstract__meta">` is plain HTML inside the `.abstract__body`
  `<div>`. The whole `.abstracts` wrapper is a block-level HTML element, so
  kramdown passes its contents through untouched and the theme's `.content a`
  link styling applies. No new CSS is required; the class is a hook only.
- The permalink is `href="#<anchor>"`. Clicking it fires `hashchange`, which
  `abstracts.js` already handles (`reveal()` at `:36-45`, listener at `:49`):
  the entry stays open and is scrolled clear of the navbar; the address bar
  now carries the shareable URL. A cold load runs `reveal()` on startup
  (`:47`). Arriving from a Schedule Poster-event link with a fragment behaves
  the same. (Stories 5, 6)
- Order is sheet order because `toPosterRecords()` preserves it (Story 2).

### 5. Page registration

```js
/**
 * @param {ReturnType<typeof fold>} days
 * @param {ReturnType<typeof toPosterRecords>|null} posters  null = tab skipped
 */
function writeAbstractPages(days, posters) {
  const pages = collectAbstracts(days);
  if (posters && posters.length) {
    pages.set(FORMATS.poster.slug, { format: FORMATS.poster, entries: posterEntries(posters) });
  }
  for (const [slug, { format, entries }] of pages) {
    writeIfChanged(path.join(ABSTRACTS_DIR, `${slug}.md`), renderAbstractPage(format, entries));
  }
  // Tab skipped (offline, no --posters-file): keep an existing generated page
  // and its menu entry rather than pruning what we did not rebuild.
  const postersFile = path.join(ABSTRACTS_DIR, `${FORMATS.poster.slug}.md`);
  if (posters === null && fs.existsSync(postersFile)
      && fs.readFileSync(postersFile, 'utf8').includes(PAGE_BANNER)) {
    pages.set(FORMATS.poster.slug, { format: FORMATS.poster, entries: [] });
  }
  /* pruning loop unchanged (:917-926) */
  return pages;
}
```

The keep-marker is added *after* the write loop so it is never written. The
pruning loop then leaves `posters.md` alone, and `writeMenubar()` (which
iterates `FORMATS` in vocabulary order and checks `pages.has(slug)`) emits
"Posters" between "Papers" and "Random Access Microtalks". Cases:

| Posters input | `posters.md` present before | Result |
| --- | --- | --- |
| rows > 0 | any | written; in menu |
| rows = 0 (tab fetched, empty) | generated | pruned; out of menu |
| rows = 0 | absent | nothing; out of menu |
| `null` (skipped) | generated | kept; in menu |
| `null` (skipped) | absent | nothing; out of menu |

`posters.tbd` has no banner and a `.tbd` extension, so the loop never sees it.
Note the skipped-and-kept case links Schedule Poster events to the page top
(§3: empty anchor set), which is still a valid link. (Story 4)

### 6. `main()`

```js
async function main() {
  const csv = await loadScheduleCSV();
  const postersCsv = await loadPostersCSV();
  const records = toRecords(parseCSV(csv));
  if (!records.length) throw new Error('No schedule rows found — check the sheet.');
  const posters = postersCsv === null ? null : toPosterRecords(parseCSV(postersCsv));
  const posterAnchors = posters ? assignPosterAnchors(posters) : new Set();

  const days = fold(records);
  assignAnchors(days, posterAnchors);
  assignSessionIds(days);

  /* existing summary line */
  console.log(posters ? `Parsed ${posters.length} poster rows.` : 'Posters skipped.');

  /* existing writes */
  writeMenubar(writeAbstractPages(days, posters));
}
```

Posters are parsed before `assignAnchors()` because Poster-event links need
the anchor set. Both fetches complete before any parsing so a failed Posters
fetch aborts before anything is written. (Stories 1, 5, 8)

### 7. Fixtures

**`fixtures/posters.csv`** (new). Header order deliberately differs from the
request, and an extra column is included to prove it is ignored:

| Row | Purpose |
| --- | --- |
| `Poster,Authors,Poster Title,Abstract,DOI` header | column-order independence; extra `Poster` column ignored |
| bare DOI, Markdown abstract with `**bold**` and two paragraphs (quoted, embedded newlines) | markdownify path; `doi.org` prefixing |
| URL DOI (`https://doi.org/10…`) | used as given |
| empty DOI, non-empty abstract | DOI link omitted |
| non-empty DOI, empty abstract | body is metadata only, still collapsible |
| empty authors | title-only heading |
| duplicate title | `-2` anchor |
| abstract containing `{% raw %}` and `<script>` text | `escLiquid()` keeps it literal |
| empty Poster Title, other cells filled | row skipped |
| title "Reproducible Pipelines on a Budget" | matches fixture schedule row 33 → deep link |

**`fixtures/schedule.csv`** gains a trailing `DOI` column (empty on every row
not listed):

| Row | Value | Purpose |
| --- | --- | --- |
| a Talk with People and description | bare DOI | meta line after abstract |
| a Paper with People, no description | bare DOI | DOI-only body, now collapsible; schedule title now links |
| row 33 (Poster, People + description) | — | links to `program/posters/#reproducible-pipelines-on-a-budget` |
| row 34 (Poster, People only) | — | no posters match → links to `program/posters/` |

(Story 8)

### 8. Verification plan (design-level)

- **Byte-identity of the live artifacts.** The committed schedule includes,
  `program.json`, menubar, and the four existing abstract pages come from a
  sheet with no Poster-format events. Whether the live sheet's `DOI` column
  has values is unknown; a live rebuild must show only `posters.md`, the
  menubar's "Posters" line, and — if DOIs exist — `doi` keys in JSON and
  `abstract__meta` lines on the affected entries, nothing else.
- **Fixture build.** `--file fixtures/schedule.csv` alone: no `posters.md`,
  row 33/34 titles link to the page top, DOI meta lines present. With
  `--posters-file fixtures/posters.csv`: `posters.md` written, row 33 links
  to its entry; a second run reports everything unchanged;
  `bundle exec jekyll build` clean.
- **Pre-change baseline.** Before touching the parser, build the fixture and
  keep `program.json` and the abstract pages in the scratchpad; after the
  refactor and *before* the fixture gains DOI values, the diff must be empty
  except for the poster-related changes above.
- **Fixture-build hygiene** as in spec 003: restore live artifacts with
  `git checkout` / `git clean` before committing.

### Acceptance criteria intentionally dropped

None.

## Requirements coverage

| Story / criterion | Where addressed |
| --- | --- |
| 1 — fetch Posters tab via same endpoint | §1 `fetchSheet(POSTERS_SHEET_NAME)` |
| 1 — `--posters-file` | §1 `loadPostersCSV()` |
| 1 — `--file` without `--posters-file` skips with a log line | §1 returns `null`; §6 logs "Posters skipped." |
| 1 — non-OK status or missing header is fatal | §1 `fetchSheet` throw; §2 `toPosterRecords` throw |
| 1 — column matching, `Title` alias, unknown columns ignored | §2 `POSTER_HEADER_ALIASES`, `normalizeHeader(h, aliases)` |
| 2 — one entry per titled row; blank titles skipped | §2 filter |
| 2 — sheet row order | §2 preserves order; §4 maps in order |
| 2 — slugified deduped anchors, same scheme | §3 `nextAnchor()` shared with `assignAnchors()` |
| 2 — Authors byline / omitted when empty | §4 `people: p.authors`; `renderAbstractHeading()` unchanged |
| 3 — same page chrome | §4 `renderAbstractPage()` reused |
| 3 — every poster row is a `<details>` | §4 `hasBody` always true (permalink) |
| 3 — abstract via capture + markdownify + `escLiquid` | §4 body capture |
| 3 — whitespace abstract treated as absent | §4 `e.infoMd.trim()` guard |
| 3 — DOI link text/href, http(s) passthrough, escaping | §4 `doiHref()`, `esc()` on both |
| 3 — empty DOI omitted | §4 `if (p.doi)` |
| 4 — in page map, menubar position | §5 `pages.set(FORMATS.poster.slug, …)`; `writeMenubar()` vocabulary order |
| 4 — carries `PAGE_BANNER` | §4 `renderAbstractPage()` unchanged |
| 4 — not pruned when present; kept when skipped; pruned when empty | §5 table |
| 4 — `posters.tbd` untouched | §5 |
| 5 — pill kept, no page entries | §3 `_format` still set; §4 `collectAbstracts()` skip |
| 5 — title-match deep link, else page top, regardless of People/description/DOI | §3 tab branch in `assignAnchors()` |
| 5 — still in `program.json` with `href` | §3 |
| 5 — Posters-tab rows never in includes or JSON | §6: posters never enter `fold()` |
| 5 — fixture no longer yields schedule-derived `posters.md` | §4 skip; §8 |
| 6 — permalink beside DOI | §4 `posterEntries()` |
| 6 — click updates fragment, entry stays open and scrolled | §4 (`abstracts.js` `hashchange`) |
| 6 — cold load opens entry | §4 (`abstracts.js` `reveal()` on start) |
| 6 — anchors stable across rebuilds | §3 |
| 7 — Schedule `DOI` column read on event rows | §2 `HEADER_ALIASES`, `fold()` |
| 7 — DOI link after abstract, same resolution and escaping | §4 `collectAbstracts()` meta + `renderAbstractEntry()` |
| 7 — DOI with no description is collapsible | §4 `hasBody` |
| 7 — DOI-only event gets a schedule deep link | §3 widened test |
| 7 — empty DOI renders as today | §4 no `meta` → identical string |
| 7 — `doi` in `program.json`, append-only | §2 `fold()` |
| 7 — Poster-event DOI in JSON only | §2 `fold()`; §4 skip |
| 8 — idempotent second run | `writeIfChanged()` unchanged; §8 |
| 8 — poster row count logged | §6 |
| 8 — fixtures build and Jekyll-build | §7, §8 |
| 8 — no-DOI CSV byte-identical for non-Poster events | §2 append-only; §4 identical string; §8 baseline |
| 8 — workflow pathspecs already cover output | Affected components (workflow row) |
| 8 — README documents the tab and DOI | Affected components (README row) |
