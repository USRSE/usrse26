# Requirements — build org members from sheet

Status: approved

## Summary

The home page's "US-RSE Organizational Founding Members" section
(`index.html:98-122`) renders `site.data.org-members` — three tier lists
(`premier`, `standard`, `basic`), each sorted by `date_joined` and drawn by
`_includes/org-card-group.html` → `_includes/org-member-card.html`. Each card
reads `figure` (a filename under `assets/img/org-logos/`), `name`, `acronym`,
`url`, and an optional `background` CSS color. `founding_member`, `tier`,
`date_joined` (beyond sorting), and `contact` are carried in the YAML but never
rendered.

`_data/org-members.yml` is hand-edited today, and the hand edits have already
gone wrong: commit `1083cc4` removed 125 lines of duplicated entries, and
`7f36c71` had to fix the same URL in two places. The membership list already
lives in a Google Sheet, so the YAML is a second copy kept in step by hand.

This feature adds `scripts/build-org-members.js`, a zero-dependency Node 18+
script modeled on `scripts/build-program.js`: it pulls one sheet tab through
the gviz CSV endpoint (or reads a local CSV with `--file`), groups rows by
tier, and writes `_data/org-members.yml` in the shape the templates already
read. The templates do not change. The sheet becomes the only thing anyone
edits.

The source is a separate spreadsheet from the program sheet, identified by a
new `ORG_MEMBERS_SHEET_ID` environment variable (a repository secret in CI),
tab **`members`**. Its header row uses the YAML keys verbatim: `tier`, `name`,
`url`, `figure`, `acronym`, `date_joined`, `founding_member`, `contact`,
`background`. Other columns (the sheet has trailing empty ones) are ignored.

Each `figure` cell names a logo file. The logos live in a Google Drive folder
(shared "anyone with the link", identified by `ORG_LOGOS_FOLDER_ID`); the
script downloads any logo the repository does not yet have into
`assets/img/org-logos/`, using the Drive API v3 with an API key
(`GOOGLE_API_KEY`). Logos already committed are never re-downloaded, so the
Drive folder need not hold them.

Patterns reused from `build-program.js`: sheet ID from an environment variable,
never committed (`:162-165`); `fetchSheet()` via
`/gviz/tq?tqx=out:csv&sheet=<tab>` (`:1708-1719`); `--file` for offline builds
(`:1722-1729`); the RFC 4180 `parseCSV()` (`:268-295`); case/punctuation-
insensitive header aliases (`:299-324`); a missing required column is fatal
(`:355-361`); `writeIfChanged()` so a scheduled runner commits no churn
(`:1756-1767`); one-line `build-…: message` errors with exit 1.

## User stories

### Story 1 — Build the YAML from the live sheet

As a site maintainer, I want to run one command that regenerates
`_data/org-members.yml` from the membership sheet so that I never edit the
YAML by hand.

**Acceptance criteria**

- WHEN the script runs with `ORG_MEMBERS_SHEET_ID` set and no `--file`, THE
  system SHALL fetch the `members` tab via the gviz CSV endpoint and write
  `_data/org-members.yml`.
- WHEN `ORG_MEMBERS_SHEET_ID` is unset and no `--file` is given, THE system
  SHALL exit 1 with a one-line message naming the variable and the `--file`
  alternative.
- WHEN the fetch returns a non-2xx status, THE system SHALL exit 1 with a
  message naming the tab and the HTTP status, and SHALL leave the existing YAML
  untouched.
- WHEN the generated content is byte-identical to the file on disk, THE system
  SHALL NOT rewrite the file and SHALL log it as `unchanged`.

### Story 2 — Build offline from a fixture

As a developer, I want to build from a local CSV so that I can test the script
without network access or the secret.

**Acceptance criteria**

- WHEN the script runs with `--file <path>`, THE system SHALL read that CSV
  instead of fetching, and SHALL NOT require the sheet ID.
- WHEN `--file` is given without a path, THE system SHALL exit 1 with
  `--file requires a path`.
- THE repository SHALL include `fixtures/org-members.csv` covering every tier,
  an optional-column-empty row, and a row that must be skipped.

### Story 3 — Output matches what the templates read

As a site visitor, I want the home page to look the same after the switch so
that the change is invisible to me.

**Acceptance criteria**

- THE system SHALL write a YAML map with tier keys `basic`, `standard`,
  `premier`, in that order, each a list of members in sheet row order.
- WHEN a tier has no members, THE system SHALL omit its key, so the
  `{% if site.data.org-members.<tier> %}` guards in `index.html` hide the
  heading.
- THE system SHALL write, per member: `name`, `url`, `figure`, `acronym`,
  `date_joined` (ISO `YYYY-MM-DD`), `founding_member` (boolean), and `tier`
  (display form: `Basic` / `Standard` / `Premier`).
- WHEN a member's `background` or `contact` cell is non-empty, THE system SHALL
  write that key; WHEN empty, THE system SHALL omit it.
- WHEN a string value contains YAML-significant characters (`:`, `#`, quotes,
  leading/trailing space, etc.), THE system SHALL quote it so the YAML parses
  back to the exact cell text.
- WHEN the current live sheet is built, THE resulting
  `site.data.org-members` SHALL be equivalent (same members, tiers, and field
  values) to the committed `_data/org-members.yml` at the time of the switch,
  modulo intentional sheet corrections.
- THE output file SHALL begin with a comment stating it is generated by
  `scripts/build-org-members.js` and that edits belong in the sheet.

### Story 4 — Tolerate and report sheet mistakes

As a membership coordinator editing the sheet, I want typos reported clearly
so that a bad row neither breaks the home page nor silently disappears.

**Acceptance criteria**

- THE system SHALL match header cells case-insensitively, ignoring
  surrounding whitespace, and SHALL ignore any column not in the list above.
- WHEN a required column (`name`, `tier`) is missing from the header, THE
  system SHALL exit 1 naming the missing column and the expected tab name
  `members`.
- WHEN a row's `name` is empty, THE system SHALL skip it silently (blank or
  spacer rows).
- WHEN a named row has an unrecognized or empty `tier`, THE system SHALL skip it
  and print a warning with the sheet row number and the value.
- WHEN a named row has an unparseable `date_joined`, THE system SHALL skip it and
  warn with the row number and value.
- WHEN a named row has an empty `url` or `figure`, THE system SHALL warn with
  the row number and column, and still include the member.
- WHEN building with `--file` and a row's `figure` does not exist under
  `assets/img/org-logos/`, THE system SHALL warn with the row number and
  filename, and still include the member (offline builds never contact Drive;
  see Story 7 for live builds).
- WHEN the same `name` appears more than once, THE system SHALL keep the first
  occurrence and warn about each duplicate row.
- WHEN parsing yields zero members, THE system SHALL exit 1 without writing,
  rather than empty the home-page section.
- THE system SHALL accept `founding_member` as `TRUE`/`FALSE` (sheet checkbox),
  `yes`/`no`, or empty (= false), case-insensitive.
- THE system SHALL accept `date_joined` as `M/D/YYYY` (gviz export of a date
  cell) or `YYYY-MM-DD`.

### Story 5 — Rebuild on demand in CI

As a site maintainer, I want a new GitHub Actions workflow
(`.github/workflows/build-org-members.yml`, separate from
`build-program.yml`) that runs the script
and commits the YAML when it changes so that sheet edits reach the site
without a local checkout.

**Acceptance criteria**

- THE workflow SHALL be triggered only by `workflow_dispatch`.
- WHEN the workflow is dispatched manually and the `ORG_MEMBERS_SHEET_ID`
  secret is set, THE system SHALL run the script with `GOOGLE_API_KEY` and
  `ORG_LOGOS_FOLDER_ID` from secrets, and commit `_data/org-members.yml` and
  any new files in `assets/img/org-logos/` only if something changed.
- WHEN the workflow is dispatched and the secret is unset, THE system SHALL
  fail with an `::error::` naming the secret.
- WHEN neither the YAML nor the logo folder changed, THE workflow SHALL make
  no commit.

### Story 6 — Document the design and the update process

As a membership coordinator or new maintainer, I want a README section that
explains how the org-members list is built and how to change it so that I can
add or edit a member without reading the script.

**Acceptance criteria**

- THE `README.md` SHALL gain a `## Updating Organizational Members` section,
  placed after `## Building the Program Schedule` and before
  `## Adding logos to the website`.
- THE section SHALL explain the design: the `members` tab of the sheet named by
  `ORG_MEMBERS_SHEET_ID` and the logo folder named by `ORG_LOGOS_FOLDER_ID`
  → `scripts/build-org-members.js` →
  `_data/org-members.yml` → the home-page cards via `index.html` and
  `_includes/org-card-group.html` / `_includes/org-member-card.html`; and that
  the YAML is generated and must not be edited by hand.
- THE section SHALL list every sheet column with its meaning, which are
  required, and accepted value formats (`tier` values, `date_joined` formats,
  `founding_member` values, `figure` as a filename under
  `assets/img/org-logos/`, `background` as a CSS color).
- THE section SHALL give step-by-step instructions for adding or editing a
  member: commit the logo to `assets/img/org-logos/` (when new), edit the sheet,
  run the workflow (or the script locally), and check the warnings.
- THE section SHALL show the local commands for a live build
  (`ORG_MEMBERS_SHEET_ID=<id> node scripts/build-org-members.js`) and an
  offline build (`--file fixtures/org-members.csv`).
- THE section SHALL explain the `Rebuild org members` workflow: manual-only
  trigger and how to add the `ORG_MEMBERS_SHEET_ID`, `ORG_LOGOS_FOLDER_ID`, and
  `GOOGLE_API_KEY` repository secrets, including how to create a Drive-API-only
  key and share the folder "anyone with the link".
- THE section SHALL list what each warning means and what the build refuses to
  do (zero members, missing required column).

### Story 7 — Download missing logos from Google Drive

As a membership coordinator, I want to drop a new member's logo into the shared
Drive folder and name it in the sheet so that I never need to commit image
files by hand.

**Acceptance criteria**

- WHEN a live build (no `--file`) finds members whose `figure` is not present
  under `assets/img/org-logos/`, THE system SHALL list the Drive folder
  `ORG_LOGOS_FOLDER_ID` and download each such file, by exact name, into
  `assets/img/org-logos/`.
- WHEN every `figure` is already present in the repository, THE system SHALL
  NOT contact Drive and SHALL NOT require `GOOGLE_API_KEY` or
  `ORG_LOGOS_FOLDER_ID`.
- WHEN a logo must be downloaded and `GOOGLE_API_KEY` or `ORG_LOGOS_FOLDER_ID`
  is unset, THE system SHALL exit 1 naming the unset variable(s) and the
  logos that needed downloading.
- WHEN one or more needed logos are not in the Drive folder, THE system SHALL
  exit 1 with one message listing every such filename and its sheet row, and
  SHALL write neither the YAML nor any logo.
- WHEN a needed name matches more than one file in the folder, or matches a
  file that is not an image (a Google Doc, a PDF, …), or a file larger than
  5 MB, THE system SHALL treat it as an error in the same way.
- WHEN a `figure` is not a plain image filename (letters, digits, `.`, `_`,
  `-`; extension png, jpg, jpeg, svg, webp, gif, or avif; no path
  separators), THE system SHALL exit 1 naming the row and value, before any
  download.
- WHEN a download fails partway, THE system SHALL exit 1 and SHALL NOT leave a
  partial file under `assets/img/org-logos/`.
- WHEN a logo is downloaded, THE system SHALL log its filename as `downloaded`.
- THE system SHALL NOT print the API key in any log or error message.
- THE system SHALL never overwrite or delete an existing file in
  `assets/img/org-logos/`.

## Out of scope

- Any change to `index.html`, `_includes/org-card-group.html`, or
  `_includes/org-member-card.html`.
- Updating a logo that already exists in the repository from a newer Drive
  copy (replace it by deleting the committed file and rerunning).
- Deleting committed logos that no member references anymore.
- Accessing a private Drive folder (OAuth or service account).
- Rendering currently unrendered fields (`contact`, `founding_member`,
  `date_joined`) on the page.
- Refactoring `build-program.js` or extracting a shared module (to be decided
  in design; requirements assume no behavior change to `build-program.js`).
- A scheduled (cron) trigger.
- Any change to `build-program.yml` or the program sheet.
- Adding a JS test framework; verification follows the repo's existing
  fixture-build convention.

## Decisions (from review)

1. Separate spreadsheet, `ORG_MEMBERS_SHEET_ID`, tab `members`.
2. Headers are the YAML keys: `tier name url figure acronym date_joined
   founding_member contact background`.
3. `contact` stays in the output.
4. Manual-only trigger, in a new workflow file.
5. Missing `url`/`figure`: keep the member and warn.
6. Spec number 008 (006/007 are taken elsewhere).
7. `README.md` gets a section on the design and how to update members (Story 6).
8. Logos download from a link-shared Drive folder via Drive API v3 + API key
   (Story 7).
9. Drive is consulted only for logos the repo lacks; committed logos need not
   be in the folder.
10. A needed logo missing from the folder stops the build, listing every
    missing file; nothing is written.

## Open questions

- None.
