# Design — build org members from sheet

## Overview

A new standalone script, `scripts/build-org-members.js`, follows the shape of
`scripts/build-program.js` at a fraction of its size: Node 18+, zero
dependencies, CommonJS, `'use strict'`, one file. It reads the `members` tab of
the spreadsheet named by `ORG_MEMBERS_SHEET_ID` through the same gviz CSV
endpoint (`build-program.js:1708-1719`), or a local CSV with `--file`. Rows are
parsed into records by a fixed header map, validated (skip, keep and warn, or
stop), grouped by tier, and serialized by a small hand-written YAML emitter to
`_data/org-members.yml`. `writeIfChanged()` keeps unchanged runs from touching
the file.

Before the YAML is written, the script makes sure every `figure` exists under
`assets/img/org-logos/`. Logos the repository lacks are looked up by exact
name in a link-shared Google Drive folder (`ORG_LOGOS_FOLDER_ID`) through the
Drive API v3, authenticated with an API key (`GOOGLE_API_KEY`) sent in the
`X-Goog-Api-Key` header, and downloaded. All lookups are resolved before
anything is written: if any needed logo is missing or unusable, the build
stops listing every problem and writes neither logos nor YAML (§5). When
nothing needs downloading, Drive is never contacted and neither variable is
required.

The output is shaped to what the templates already read
(`index.html:98-122`, `_includes/org-card-group.html`,
`_includes/org-member-card.html`), so no template changes. Two Liquid details
drive the emitter (§6): an empty `acronym` must be YAML null, not `""` — Liquid
treats `""` as truthy and the card's `alt` would render `Name&nbsp;()` — and
`date_joined` stays an unquoted YAML date so `sort: "date_joined"` compares the
same type it does today.

The program script is not touched. Its helpers (`parseCSV`, `argValue`,
`fetchSheet`, `writeIfChanged`) are copied, not shared: `build-program.js` runs
`main()` on load and exports nothing, so importing from it would mean
refactoring it, which the requirements put out of scope. The copies are
~60 lines; the new script's header comment notes where they came from, and
each script stays a single file anyone can read top to bottom.

A new manual-only workflow, `.github/workflows/build-org-members.yml`, mirrors
`build-program.yml`'s secret gate and commit step, and also commits new logos.
`README.md` gains a section documenting the design and the update procedure.

### Layering inside the script

The script is one file, but it keeps the same separation the program script
does, in this order:

| Layer | Contents | I/O |
| --- | --- | --- |
| Configuration | constants: tab name, tier table, output paths, logo dir, size limit | none |
| Domain (pure) | `parseCSV`, `toMemberRecords`, `parseDate`, `parseBool`, `validate`, `neededLogos`, `matchLogos`, `renderYAML` | none — take strings/arrays, return data; warnings and errors are collected into arrays, not printed |
| Adapters | `fetchSheet`, `loadCSV`, `repoLogos`, `driveSource`, `saveLogo`, `writeIfChanged` | network / filesystem |
| Application | `syncLogos(needed, source)` — list, match, stop on problems, download, save | via the injected source and `saveLogo` |
| Entry point | `main()` picks adapters from argv/env, runs the domain steps, prints warnings, sets exit code | — |

Dependency injection is by plain arguments: `validate()` and `neededLogos()`
take the set of committed logo names rather than reading the directory, and
the logo-sync step takes a *logo source* — `{ list(), download(file) }` —
built by `main()`. Production passes `driveSource` (Drive API); verification
harnesses pass a fake source over a scratch folder (§5.4). The script has one
logo directory, `assets/img/org-logos/`, fixed in configuration and not
overridable from the command line.

## Affected components

| File / module | Change |
| --- | --- |
| `scripts/build-org-members.js` | **New.** The generator (§1-§8). |
| `fixtures/org-members.csv` | **New.** Offline fixture: every current member from `_data/org-members.yml` in the sheet's column order, plus edge-case rows (§9). |
| `_data/org-members.yml` | Regenerated output. Gains a generated-file header comment; values unchanged. Committed only after a live build. |
| `assets/img/org-logos/` | Receives downloaded logos. Existing files are never overwritten or deleted. |
| `.github/workflows/build-org-members.yml` | **New.** `workflow_dispatch` only; gates on `ORG_MEMBERS_SHEET_ID`; passes the Drive secrets; commits the YAML and new logos when changed (§10). |
| `README.md` | New `## Updating Organizational Members` section between `## Building the Program Schedule` (`:67`) and `## Adding logos to the website` (`:222`) (§11). |
| `index.html`, `_includes/org-card-group.html`, `_includes/org-member-card.html` | Unchanged. |
| `scripts/build-program.js`, `.github/workflows/build-program.yml` | Unchanged. |
| `_config.yml` | Unchanged — `scripts` and `fixtures` are already in `exclude` (`:56-62`). |

## Detailed design

### 1. Configuration

```js
const REPO_ROOT = path.join(__dirname, '..');
const SHEET_ID = process.env.ORG_MEMBERS_SHEET_ID || '';
const SHEET_NAME = 'members';
const OUT_YML = path.join(REPO_ROOT, '_data', 'org-members.yml');
const LOGO_DIR = path.join(REPO_ROOT, 'assets', 'img', 'org-logos');

// Read only when a logo has to be downloaded.
const DRIVE_API_KEY = process.env.GOOGLE_API_KEY || '';
const LOGO_FOLDER_ID = process.env.ORG_LOGOS_FOLDER_ID || '';
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

// A figure is a bare filename: no path separators, no leading dot, an image
// extension. It becomes a path on disk and an <img src>, so anything else is
// refused rather than escaped.
const FIGURE_NAME = /^[\w-][\w.-]*\.(?:png|jpe?g|svg|webp|gif|avif)$/i;

// Output order matches today's file; the key is what index.html reads,
// the label is what goes in each member's `tier` field.
const TIERS = [
  { key: 'basic', label: 'Basic' },
  { key: 'standard', label: 'Standard' },
  { key: 'premier', label: 'Premier' },
];
```

No `_config.yml` read — the script needs nothing from it.

### 2. Input

- `argValue(flag)` — copied from `build-program.js:1699-1705`; throws
  `--file requires a path` on a missing value. `--file` is the only flag.
- `fetchSheet()` — same URL shape as `build-program.js:1714` with
  `sheet=members`; `redirect: 'follow'`; non-2xx → throw
  `"members" tab fetch failed: HTTP <status>`. Missing ID → throw
  `ORG_MEMBERS_SHEET_ID is not set. Export the sheet ID as an environment
  variable, or run with --file fixtures/org-members.csv.`
- `loadCSV()` — `--file` path if given (logs `Reading <file>`), else
  `fetchSheet()`.
- `parseCSV(text)` — verbatim copy of `build-program.js:268-295`.

### 3. Records

```js
const COLUMNS = ['tier', 'name', 'url', 'figure', 'acronym',
  'date_joined', 'founding_member', 'contact', 'background'];
const REQUIRED_COLUMNS = ['name', 'tier'];
```

`toMemberRecords(rows)`:

- Header cells are normalized with `h.trim().toLowerCase()` and kept only if in
  `COLUMNS`; anything else (the sheet's trailing empty columns) maps to `null`
  and is read past.
- Any of `REQUIRED_COLUMNS` absent → throw
  `"members" tab has no "<col>" column — is the tab named members?`.
- Each data row → `{ _row, tier, name, url, figure, acronym, date_joined,
  founding_member, contact, background }`, all trimmed strings (`''` for a
  missing column). `_row` is the 1-based sheet row counting the header, as in
  `build-program.js:330`.
- Rows with empty `name` are dropped here, silently (Story 4).

### 4. Validation and normalization

`validate(records)` → `{ members, warnings, errors }`. Each message is a
string `row <n>: <message>`. Per record, in sheet order:

| Check | Outcome |
| --- | --- |
| `tier` lowercased not in `TIERS` keys (incl. empty) | skip; warn `row N: unknown tier "X" — expected Basic, Standard, or Premier` |
| `parseDate(date_joined)` returns null | skip; warn `row N: unparseable date_joined "X" — expected M/D/YYYY or YYYY-MM-DD` |
| `name` (case-insensitive) already kept | skip; warn `row N: duplicate name "X" (first on row M)` |
| `url` empty | keep; warn `row N: "X" has no url` |
| `figure` empty | keep; warn `row N: "X" has no figure` |
| `figure` non-empty and not `FIGURE_NAME` | **error** `row N: figure "F" is not a plain image filename` |
| `founding_member` non-empty and not true/false/yes/no | keep; warn `row N: founding_member "X" read as false` |

Skip checks run first, so a skipped row produces exactly one warning and its
figure is never checked or downloaded. The duplicate check runs after
tier/date so a malformed first copy does not shadow a good second one. Errors
are collected, not thrown, so `main()` can report all of them at once (§7).

Whether a figure *exists* is not checked here — that is §5.

`parseDate(raw)`:

- `YYYY-MM-DD` or `M/D/YYYY` (1–2 digit month/day). gviz exports a date-typed
  cell in its display format; both a date-formatted column and a plain-text
  column in either form are accepted.
- Validated by round-tripping through `Date.UTC(y, m - 1, d)` and checking the
  UTC getters return the same y/m/d (rejects `2/30/2025`). UTC only, so runner
  timezone cannot shift the day.
- Returns `YYYY-MM-DD` or `null`.

`parseBool(raw)` — `true` for `true`/`yes` (case-insensitive); everything else,
including empty, is `false`.

Normalized member: `{ _row, name, url, figure, acronym, date_joined,
founding_member, tier: <label>, contact?, background? }` where
`contact`/`background` are present only when non-empty, `acronym` is `null`
when empty, and `_row` is internal (never emitted).

### 5. Logo sync

#### 5.1 Which logos are needed (pure)

`repoLogos()` (adapter) returns a `Set` of the file names in `LOGO_DIR`
from `fs.readdirSync`. Comparing against the listing — not `fs.existsSync` —
keeps the match exact and case-sensitive on macOS's case-insensitive
filesystem as on Linux CI.

`neededLogos(members, present)` → `[{ figure, rows: [n, …] }]`: distinct
non-empty figures not in `present`, in first-seen order, each with every sheet
row that names it (two members may share a logo).

#### 5.2 Matching against the source (pure)

`matchLogos(needed, files)` where `files` is the source listing
`[{ id, name, mimeType, size }]` → `{ downloads: [{ figure, file }], problems:
[string] }`. Per needed figure, by exact `name`:

| Folder contents | Outcome |
| --- | --- |
| no file named `figure` | problem `row N[, M]: figure "F" is not in the logo folder` |
| more than one file named `figure` | problem `… matches K files in the logo folder` |
| `mimeType` not `image/*` (e.g. `application/vnd.google-apps.document`, `application/pdf`) | problem `… is <mimeType>, not an image` |
| `size` > `MAX_LOGO_BYTES` | problem `… is <n> MB; the limit is 5 MB` |
| exactly one image within the limit | download |

#### 5.3 Drive source (adapter)

`driveSource(apiKey, folderId, needed)` — `needed` is used only to name the
waiting logos in the precondition error:

- **Preconditions** (checked on construction, which `main()` does only when
  `needed` is non-empty):
  missing `GOOGLE_API_KEY` and/or `ORG_LOGOS_FOLDER_ID` → throw
  `GOOGLE_API_KEY and ORG_LOGOS_FOLDER_ID must be set to download: a.png
  (row 4), b.svg (row 9)` (naming only the unset ones). `folderId` must match
  `/^[\w-]+$/` or throw — it is interpolated into the Drive query string.
- **`list()`** — `GET https://www.googleapis.com/drive/v3/files` with
  `q='<folderId>' in parents and trashed = false`,
  `fields=nextPageToken,files(id,name,mimeType,size)`, `pageSize=1000`,
  `supportsAllDrives=true`, `includeItemsFromAllDrives=true`; follows
  `nextPageToken` until absent. `size` arrives as a string and is converted
  with `Number()`; Google-native files have none (treated as 0, and rejected by
  the mimeType check anyway).
- **`download(file)`** — `GET https://www.googleapis.com/drive/v3/files/<id>?alt=media&supportsAllDrives=true`
  → `Buffer`. Rejects with an error if the body exceeds `MAX_LOGO_BYTES`
  (defends against a listing/body mismatch).
- The key is sent as the `X-Goog-Api-Key` request header, never in a URL, so
  it cannot leak through a logged URL or an error message that quotes one.
  Error messages contain only the operation, filename, and HTTP status, plus a
  hint for the common cases: 403 → `check the key is enabled for the Drive API
  and the folder is shared "Anyone with the link"`; 404 → `folder not found or
  not shared`.

#### 5.4 Logo sync step (application)

`syncLogos(needed, source)` — the only code that talks to a logo source:

1. `files = await source.list()`
2. `{ downloads, problems } = matchLogos(needed, files)`; any problem → throw
   one error listing all of them (nothing written yet).
3. For each download: `saveLogo(figure, await source.download(file))`.

`source` is any object with `list()` and `download(file)`. `main()` passes
`driveSource(...)`. There is no command-line way to substitute another source
or another logo directory; offline verification (task 6) instead
`require()`s the script and calls `syncLogos()` with a small fake source
written in the harness — `list()` over a scratch folder with `mimeType` from
the extension, `download()` reading the file — so no test-only code ships in
the script.

#### 5.5 Saving (adapter)

`saveLogo(figure, buffer)`:

1. Write `buffer` to `LOGO_DIR/.<figure>.download` (dot-prefixed, so a crash
   leaves a file Jekyll ignores and `repoLogos()` never matches as a figure).
2. `fs.linkSync(temp, LOGO_DIR/<figure>)` — fails with `EEXIST` rather than
   overwrite, so an existing logo is never replaced even if one appeared
   mid-run.
3. `fs.unlinkSync(temp)` in a `finally`, whether step 2 succeeded or not.
4. Log `downloaded <repo-relative path>`, indented like `writeIfChanged`'s
   `wrote` / `unchanged` lines.

A failure anywhere throws; the target file is either complete or absent.

#### 5.6 Source selection

| Invocation | Logo source | Missing logos |
| --- | --- | --- |
| live (no `--file`) | `driveSource` (only constructed if something is needed) | downloaded, or build stops (§5.2) |
| `--file` | none | warn per row `row N: figure "F" not found in assets/img/org-logos/` and keep the member (Story 4, offline) |

### 6. YAML emitter

`renderYAML(members)` → string. Hand-written; the output space is small and
fixed, so no general serializer is needed.

```yaml
# Generated by scripts/build-org-members.js from the "members" tab of the
# org members Google Sheet. Do not edit by hand — edit the sheet and rerun
# the script (or the "Rebuild org members" workflow). See README.md.

basic:
  - name: "Open OnDemand"
    url: "https://openondemand.org/"
    figure: "logo-open-ondemand.png"
    acronym: "OOO"
    date_joined: 2025-04-10
    founding_member: true
    tier: "Basic"
    contact: "Alan Chalker <alanc@osc.edu>"

standard:
  ...
```

Rules:

- Tier keys in `TIERS` order; a tier with no members is omitted entirely
  (Story 3). A blank line separates tiers, matching today's file.
- Members within a tier in sheet row order. `index.html` sorts by
  `date_joined` anyway.
- Field order: `name, url, figure, acronym, date_joined, founding_member, tier,
  contact, background` — today's order, with the two optional keys last.
- **Strings** are always emitted as `JSON.stringify(value)`. A JSON string is a
  valid YAML double-quoted scalar with identical escapes, so `:`, `#`, quotes,
  `<`, leading/trailing spaces and non-ASCII all round-trip exactly — no
  "does this need quoting" heuristic to get wrong.
- `acronym` empty → `acronym: null` (Liquid falsy; see Overview).
- `date_joined` → bare `YYYY-MM-DD` (YAML/Ruby `Date`, as today).
- `founding_member` → bare `true` / `false`.
- File ends with a single `\n`.

### 7. Main

```js
async function main() {
  const records = toMemberRecords(parseCSV(await loadCSV()));
  const { members, warnings, errors } = validate(records);
  if (errors.length) throw new Error(list('invalid figure', errors));
  if (!members.length) throw new Error('No members found — refusing to write an empty file.');

  const needed = neededLogos(members, repoLogos());
  if (needed.length && offline) {
    warnings.push(...missingLogoWarnings(needed));       // --file (§5.6)
  } else if (needed.length) {
    await syncLogos(needed, driveSource(DRIVE_API_KEY, LOGO_FOLDER_ID, needed));
  }                                     // driveSource may throw (§5.3 preconditions)

  for (const w of warnings) console.error(`build-org-members: ${w}`);
  console.log(`Parsed ${records.length} rows -> ${members.length} members (${counts}).`);
  writeIfChanged(OUT_YML, renderYAML(members));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`build-org-members: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  parseCSV, toMemberRecords, parseDate, parseBool, validate,
  neededLogos, matchLogos, renderYAML, driveSource, syncLogos, saveLogo,
};
```

Unlike `build-program.js`, `main()` runs only when the file is executed, and
the domain functions and adapters are exported. That lets the verification
harnesses in `tasks.md` `require()` the script and call a single function
(e.g. `matchLogos`, `syncLogos` with a fake source, or `driveSource` with a
variable unset) without running a
build. The exports are for testing only; nothing else imports the script.

`list(label, items)` formats `N <label>s:` followed by one indented line per
item, so a coordinator sees every problem from one run.

Ordering guarantees:

- Every check that can stop the build (sheet, header, figure names, zero
  members, Drive credentials, Drive listing, matching) runs before the first
  write of any kind. A stopped build writes nothing.
- Logos are downloaded before the YAML is written, so a committed YAML never
  references a logo the same run failed to fetch. If a download fails after
  others succeeded, those complete logos stay on disk (untracked, harmless;
  the next run sees them as present) and the YAML is not written.
- Warnings never change the exit code; only thrown errors do.

`writeIfChanged()` is copied from `build-program.js:1756-1767` (logs
`unchanged` / `wrote` with the repo-relative path).

### 8. File header comment

Like `build-program.js:1-38`: purpose; inputs (sheet variable, tab, columns;
Drive folder and key variables, used only when a logo is missing); outputs
(YAML, new logos); usage lines for live and `--file`; the
validation rules in brief; and why helpers are copied rather than shared.

### 9. Fixture and test approach

`fixtures/org-members.csv`, header in the sheet's order
(`tier,name,url,figure,acronym,date_joined,founding_member,contact,background`)
plus one trailing empty header cell to exercise ignored columns. Rows:

- All 15 members currently in `_data/org-members.yml`, values copied exactly,
  dates in `M/D/YYYY`, `founding_member` as `TRUE`, tier capitalized as in the
  sheet. Every figure already exists in the repo, so a fixture build needs no
  logo source. This makes the fixture build a structural-equivalence check
  against the committed YAML (Story 3).
- Edge cases, each expected to be dropped:
  - blank-name row (dropped silently)
  - tier `Gold` (skipped, warn)
  - date `13/40/2025` (skipped, warn)
  - duplicate of an existing name (skipped, warn)

The edge rows are deliberately all *skipped* ones so that the fixture output
equals today's YAML exactly. Keep-and-warn cases, invalid figures, and every
logo-sync path are exercised with scratch CSVs and `require()` harnesses that
call `syncLogos()` with a fake source over a scratch folder — putting them in the fixture would add members
not in the committed file. The live Drive adapter is verified once, manually,
with real secrets.

**Equivalence check** (used by tasks and by the live switch):

```bash
ruby -ryaml -rdate -e '
  load = ->(f) { YAML.safe_load(File.read(f), permitted_classes: [Date]) }
  a, b = load.(ARGV[0]), load.(ARGV[1])
  puts(a == b ? "equivalent" : "DIFFERENT"); exit(a == b ? 0 : 1)
' <baseline.yml> _data/org-members.yml
```

Ruby is what Jekyll itself uses to load `_data`, so this compares exactly what
`site.data.org-members` will see. The baseline is the committed file copied to
the scratchpad before the first build.

**Fixture-build hygiene:** a fixture build overwrites `_data/org-members.yml`,
and a `syncLogos()` harness test adds files to `assets/img/org-logos/`. Restore with
`git checkout -- _data/org-members.yml` and
`git clean -f assets/img/org-logos` before committing; the real regenerated
file and logos are committed only from a live build.

### 10. Workflow

`.github/workflows/build-org-members.yml`, modeled on `build-program.yml`:

```yaml
name: Rebuild org members
on:
  workflow_dispatch:
permissions:
  contents: write
jobs:
  build:
    runs-on: ubuntu-latest
    env:
      ORG_MEMBERS_SHEET_ID: ${{ secrets.ORG_MEMBERS_SHEET_ID }}
      ORG_LOGOS_FOLDER_ID: ${{ secrets.ORG_LOGOS_FOLDER_ID }}
      GOOGLE_API_KEY: ${{ secrets.GOOGLE_API_KEY }}
    steps:
      - name: Check the sheet ID is configured
        run: |
          if [ -z "$ORG_MEMBERS_SHEET_ID" ]; then
            echo "::error::The ORG_MEMBERS_SHEET_ID secret is not set."
            exit 1
          fi
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: node scripts/build-org-members.js
      - name: Commit if changed
        run: |
          git add -A -- _data/org-members.yml assets/img/org-logos
          if git diff --quiet --cached; then
            echo "Org members unchanged — nothing to commit."
          else
            git config user.name "github-actions[bot]"
            git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
            git commit -m "Rebuild org members from sheet"
            git push
          fi
```

- Only the sheet ID is gated up front. The Drive secrets are needed only when a
  logo is missing, and the script itself reports which are unset and which
  logos needed them (§5.3) — gating on them here would block sheet-only
  updates for no reason.
- `git add -A` on the logo directory stages newly downloaded files. The script
  never deletes or overwrites there, so the only possible change is additions;
  a dot-prefixed temp file cannot survive a successful run (§5.5).
- With no scheduled trigger there is no "skip quietly" branch: an unset sheet
  secret is always an error.
- A header comment explains the three secrets, the manual trigger, and that
  warnings appear in the run log while the job still succeeds.

### 11. README section

`## Updating Organizational Members`, inserted before
`## Adding logos to the website` (`README.md:222`). Subsections:

1. **How it works** — data flow: sheet (`members` tab, `ORG_MEMBERS_SHEET_ID`)
   and Drive logo folder (`ORG_LOGOS_FOLDER_ID`) →
   `scripts/build-org-members.js` → `_data/org-members.yml` +
   `assets/img/org-logos/` → `index.html` → `org-card-group.html` →
   `org-member-card.html`. The YAML is generated; hand edits are overwritten on
   the next build. Logos already in the repo are never re-downloaded.
2. **Sheet columns** — table: column, required?, meaning, accepted values
   (`tier`: Basic/Standard/Premier; `date_joined`: M/D/YYYY or YYYY-MM-DD;
   `founding_member`: checkbox / TRUE/FALSE / yes/no; `figure`: exact filename
   of an image in the Drive folder or `assets/img/org-logos/`, allowed
   characters and extensions; `background`: any CSS color, shown behind the
   logo; `contact`: kept in the YAML, not displayed). Note: keep each column a
   single type in the sheet — gviz may blank minority-type cells in a mixed
   column.
3. **Adding or editing a member** — numbered steps: upload the logo to the
   Drive folder with the exact `figure` name (≤ 5 MB, an image file, not a
   Google Drawing); add or edit the row in the sheet; run **Actions → Rebuild
   org members → Run workflow**; read the run log for warnings; check the home
   page. To replace an existing logo: delete it from `assets/img/org-logos/`
   in a commit, update it in Drive, rerun.
4. **Running locally** — live command with all three variables;
   `--file fixtures/org-members.csv` offline; the fixture-build restore note.
5. **GitHub Action and secrets** — adding `ORG_MEMBERS_SHEET_ID`,
   `ORG_LOGOS_FOLDER_ID`, and `GOOGLE_API_KEY` as repository secrets (same
   click path as `README.md:203-204`); creating the key in a Google Cloud
   project with the Drive API enabled and the key restricted to that API;
   sharing the folder **Anyone with the link → Viewer**; where to find the
   folder ID in its URL.
6. **Warnings and errors** — table of each warning/error, whether the row is
   kept, skipped, or the build stops.

URLs in the section are placeholders written as inline code
(`` `drive.google.com/drive/folders/<id>` ``), never as links, so the
`urlchecker` step in `linting.yaml` does not try to fetch them.

## Requirements coverage

| Story / criterion | Where addressed |
| --- | --- |
| 1 — fetch `members` tab with `ORG_MEMBERS_SHEET_ID`, write YAML | §2 `fetchSheet`, §7 |
| 1 — unset ID → exit 1 naming var and `--file` | §2 |
| 1 — non-2xx → exit 1 naming tab + status, YAML untouched | §2, §7 (throws before write) |
| 1 — unchanged → no rewrite, log `unchanged` | §7 `writeIfChanged` |
| 2 — `--file` reads CSV, no ID needed | §2 `loadCSV` |
| 2 — `--file` without path → `--file requires a path` | §2 `argValue` |
| 2 — fixture covers every tier, empty optional, skipped row | §9 (Open OnDemand is the only Basic; several rows have empty acronym/contact/background) |
| 3 — tier keys `basic, standard, premier`, sheet order | §6 |
| 3 — empty tier omitted | §6 |
| 3 — required fields, ISO date, boolean, display tier | §4 normalized member, §6 |
| 3 — `background`/`contact` only when non-empty | §4, §6 |
| 3 — YAML-significant characters quoted exactly | §6 `JSON.stringify` |
| 3 — equivalent to committed YAML | §9 fixture + Ruby equivalence check; live build checked the same way before commit |
| 3 — generated-file header comment | §6 |
| 4 — header match case-insensitive, extra columns ignored | §3 |
| 4 — missing `name`/`tier` column → exit 1 naming tab | §3 |
| 4 — empty name skipped silently | §3 |
| 4 — bad/empty tier → skip + warn | §4 |
| 4 — bad date → skip + warn | §4 `parseDate` |
| 4 — empty url/figure → keep + warn | §4 |
| 4 — `--file`: missing logo file → keep + warn | §5.6 |
| 4 — duplicate name → keep first, warn | §4 |
| 4 — zero members → exit 1, no write | §7 |
| 4 — `founding_member` TRUE/FALSE/yes/no/empty | §4 `parseBool` |
| 4 — `date_joined` M/D/YYYY or YYYY-MM-DD | §4 `parseDate` |
| 5 — new manual-only workflow | §10 |
| 5 — passes Drive secrets; commits YAML and new logos only when changed | §10 |
| 5 — unset sheet secret → `::error::` | §10 |
| 6 — README section placement | §11 |
| 6 — design / data flow incl. logo folder, generated file | §11.1 |
| 6 — every column, required, formats | §11.2 |
| 6 — add/edit steps | §11.3 |
| 6 — local live + offline commands | §11.4 |
| 6 — workflow, three secrets, key creation, folder sharing | §11.5 |
| 6 — warnings and refusals | §11.6 |
| 7 — live build downloads logos missing from the repo by exact name | §5.1–§5.5 |
| 7 — nothing missing → no Drive call, no key/folder needed | §5.6, §7 (`driveSource` built only when `needed` non-empty) |
| 7 — download needed but key/folder unset → exit 1 naming vars + logos | §5.3 preconditions |
| 7 — needed logo absent from folder → exit 1 listing all, nothing written | §5.2, §7 ordering |
| 7 — duplicate name / non-image / > 5 MB → same error | §5.2, §5.3 `download` size guard |
| 7 — figure not a plain image filename → exit 1 before download | §1 `FIGURE_NAME`, §4 errors, §7 |
| 7 — failed download leaves no partial file | §5.5 |
| 7 — log `downloaded` | §5.5 |
| 7 — API key never printed | §5.3 (header, not URL; messages carry status only) |
| 7 — never overwrite or delete existing logos | §5.5 `linkSync`; no delete code path |

No acceptance criterion is dropped. Additions beyond the requirements:

- An unrecognized non-empty `founding_member` value warns (§4) instead of being
  silently read as false.
- `syncLogos()` and the domain functions are exported, with `main()` behind a
  `require.main` guard (§7), so harnesses can test logo sync offline without a
  test-only command-line flag.
