# The US-RSE Association Conference 2026 (USRSE'26)

This repo is website landing page for the [US-RSE Association Conference 2026](https://us-rse.org/usrse26/).

## Previewing the Site Locally

To preview the site locally, you'll need to [install jekyll](https://jekyllrb.com/docs/installation/).
Then go to the root of the directory and run (only needed once):

```bash
$ bundle install
```

Then run 

```bash
$ jekyll serve
# or
$ bundle exec jekyll serve
```

and open your browser to <http://localhost:4000/usrse26/>.

If you are having trouble try `rm -rf _site`, followed by `bundle update`,
then `bundle exec jekyll serve`.


## Container-based development

Build and run a Docker container to preview the site locally and support a local development workflow.
If you do not already have Docker installed, please visit https://docs.docker.com/get-docker/ and
follow the links to get started with Docker on your operating system.

Build the container image:

```bash
docker build -t us-rse-con-2024-website:latest .
```

Run the container to access the website at the URL http://127.0.0.1:4000/usrse26/

```bash
$ docker run --rm -it -p 4000:4000 us-rse-con-2024-website:latest
Configuration file: /srv/jekyll/_config.yml
            Source: /srv/jekyll
       Destination: /srv/jekyll/_site
 Incremental build: disabled. Enable with --incremental
      Generating... 
                    done in 1.616 seconds.
 Auto-regeneration: enabled for '/srv/jekyll'
    Server address: http://0.0.0.0:4000/usrse26/
  Server running... press ctrl-c to stop.
```

To develop the website, launch the container using the following command, where the source files are mounted into the container:

```bash
docker run --rm -it -p 4000:4000 \
    -v $(pwd):/srv/jekyll \
    us-rse-con-2024-website:latest \
    bundle exec jekyll serve --host=0.0.0.0 --watch --drafts
```

Change a source file, such as `index.html` for example, and save the changes. You will see Jekyll automatically regenerate the site,
after which you can reload the page in your browser to see the rendered changes.

## Building the Program Schedule

The program page is generated from the program Google Sheet by `scripts/build-program.js`
(Node 18+, no dependencies). The "Schedule" tab drives `_includes/program-schedule.html`
(the list view), `_includes/program-grid.html` (the room × time grid view), `_data/program.json`,
and the two plain-text files described under
[Program files for AI assistants](#program-files-for-ai-assistants); the "Posters" tab in the
same spreadsheet drives the Posters abstract page. Edit the sheet, not those files.

The Full Program page shows the list by default with a List / Grid toggle above it; the
grid lays each day out with rooms as columns and time down the side, breaks and other
venue-wide sessions spanning every column, and each card linking to its entry in the list.
The toggle, the reader's remembered choice, and card-to-list navigation are driven by
`assets/js/program-view.js`, and `assets/css/program-grid.css` styles the grid — both
hand-written and must ship alongside the generator. With JavaScript off the page is the
list alone: the toggle and the grid include ship hidden and are never revealed.

The sheet's core columns are Start, End, Location, Session Topic, Event Title, and Order.
Session rows may carry Session Format (used exactly as given — never inferred from the
topic; Break, Meal, and Registration render as muted rows, Plenary gets the highlighted
plenary treatment), Session Chair (shown next to the format), and Session Description
(Markdown). Event rows (rows with an Event Title) may also carry People (speakers as
"A, B and C"), Event Format (Bird of a Feather, Keynote, Notebook, Other, Paper, Plenary,
Poster, Random Access Microtalk, Student, Talk, or Workshop — any other value is treated as
"Other"), Event Description (the event's abstract, as Markdown), and DOI (a bare DOI such as
`10.5281/zenodo.123`, or a full URL). In the Markdown columns a blank line starts a new
paragraph and a single line break (Alt+Enter in a cell) is kept as a line break. When events
carry an Event Format other than "Other", the script also generates one abstract page per
format under `pages/program/abstracts/` and the program menubar `_data/menus/program.yml`
linking those pages — both script-managed: they carry a generator banner, are pruned when
their format leaves the sheet, and must not be edited by hand.

Posters are the exception: the Posters page is built from the "Posters" tab rather than from
Schedule rows. Its columns are Authors, Poster Title (or Title), Abstract (Markdown), and
DOI, in any order; other columns are ignored and rows with no Poster Title are skipped. A
Schedule event whose Event Format is "Poster" keeps its pill on the schedule and links into
the Posters page — to the entry whose slugified title matches its own, otherwise to the top
of the page — but never becomes an entry there. If the Posters tab is missing or renamed,
the build fails rather than serving a stale page.

Each abstract page lists its entries as collapsed rows carrying the title and byline, with
the abstract behind a native `<details>` disclosure. Below the abstract, a metadata line
carries the DOI link when the row has one. An entry with no Event Description and no DOI
renders as a plain row with no control to open. Every abstract page also gets the theme's
sidebar contents list (`menubar_toc`, as on the Attend and Sponsor pages), one link per
entry, which is how a visitor gets a shareable link to a single abstract. The pages link two hand-written assets, so
both must ship alongside the generator: `assets/css/abstracts.css` styles the rows, and
`assets/js/abstracts.js` opens the entry a schedule deep link points at, drives the
expand/collapse-all control, and opens every entry for printing. The disclosure toggle
itself is native browser behavior — with JavaScript off the rows still open, minus the
expand-all control.

Rows still in the pre-2026 sheet layout — an Event Title with every other event column
empty — are normalized while the sheet migrates: a "Session Chair: X" row sets the
session's chair instead of listing as an event, and a "&lt;title&gt; by &lt;names&gt;"
byline splits into a clean title plus People.

The sheet ID is intentionally not committed to the repo. The script reads it from the
`PROGRAM_SHEET_ID` environment variable — it is the long token in the sheet's
`docs.google.com/spreadsheets/d/<id>/...` URL.

The conference facts the generated files state — the site's absolute URL, the conference
name, its full name, its theme, and the year the sheet's "M/DD" dates fall in — are read
from `_config.yml` (`url` + `baseurl`, `title`, `description`, `conf_theme_short`,
`conf_start_date`), so Jekyll and the generator cannot disagree about them. Change them
there. A missing one fails the build rather than emitting a page with a blank in it. Two
values are deliberately not read: the room ordering and the `-07:00` program timezone,
because `conf_start_date` ends `-0900` and San Jose in October is UTC-7 — sourcing it would
restamp every session two hours off.

### Program files for AI assistants

The generator also writes `program/llms.txt` and `program/llms-full.txt`, served at
`https://us-rse.org/usrse26/program/llms.txt` and `.../llms-full.txt`. They are the whole
schedule as plain text, for attendees who want an AI assistant to build them a personal
schedule; the Full Program page links both and shows an example prompt.

`llms.txt` carries every session and talk — times (wall-clock and ISO 8601), room, type,
chair, presenters, which sessions each one is concurrent with, and a link to each talk's
abstract entry. `llms-full.txt` is the same document with abstract text inlined.
"Concurrent with" is computed by comparing ISO ranges across the whole day, not by slot
grouping, so partially overlapping sessions are caught.

They live in a root-level `program/` directory rather than under `pages/` so Jekyll copies
them verbatim to `_site/program/`. That is deliberate: a static file is never
Liquid-processed, and abstract text out of the sheet may contain `{{` or `{%` — the HTML
abstract pages have to escape exactly that. Giving these files front matter to set a
permalink would reintroduce the hazard for nothing. The directory does not collide with the
Full Program page, which has `permalink: program/` and so writes `_site/program/index.html`.

Both are generated: they carry no banner (a comment would be noise in a file meant to be
read as prose), but they are rebuilt on every run and must not be edited by hand. The
renderer reads only the fields `_data/program.json` also carries, so it can be driven from
the committed JSON as well as from a fresh sheet fetch:

```bash
node scripts/build-program.js --from-json
```

That rewrites just the two `.txt` files, needs no sheet ID, and is the quickest way to see
a renderer change. It cannot rebuild the HTML includes or the abstract pages — those need
the `_`-prefixed internals that `program.json` deliberately drops.

The `Check program llms.txt` workflow (`.github/workflows/check-program-llms.yml`) runs
that same command on every pull request touching `_data/program.json`,
`scripts/build-program.js`, or `program/`, and fails if the result differs from what is
committed. On the normal path — the `Rebuild program schedule` workflow — the `.txt` files
and the program page are written in the same run and cannot drift; this catches the other
path, a pull request that edits the schedule data or the generator by hand without
regenerating. It is read-only, needs no secret, and works on pull requests from forks.

### Local development

Rebuild from the live sheet:

```bash
PROGRAM_SHEET_ID=<sheet-id> node scripts/build-program.js
```

Or build offline from the checked-in fixtures, which need no sheet ID:

```bash
node scripts/build-program.js --file fixtures/schedule.csv --posters-file fixtures/posters.csv
```

With `--file` alone the Posters tab is skipped: every Schedule artifact is rebuilt, and an
existing generated `posters.md` is left in place rather than rebuilt or pruned.

Then preview the site as described above to see the regenerated program page.

### GitHub Action

The `Rebuild program schedule` workflow (`.github/workflows/build-program.yml`) rebuilds the
program daily and commits only when the schedule changed. It requires the sheet ID as a
repository **secret** (not a variable) so it stays out of the source and is masked in logs:

1. Go to the repo's **Settings → Secrets and variables → Actions → Secrets**.
2. Add a repository secret named `PROGRAM_SHEET_ID` with the sheet ID as its value.

Until the secret is set, scheduled runs skip quietly; a manual **Run workflow** fails with an
explicit error instead, so you can tell the workflow is unconfigured rather than broken.

### CircleCI PR previews

Every pull request gets a site preview from the CircleCI `build-site` job
(`.circleci/config.yml`), which runs `bundle exec jekyll build` and stores the resulting
`_site` as build artifacts. That job never runs `scripts/build-program.js` and has no access
to the sheet — the preview renders whatever versions of `_includes/program-schedule.html`
and `_data/program.json` are committed on the branch. So if a change should affect the
program page, commit the regenerated artifacts and the preview will reflect them; no
CircleCI configuration is needed.

`scripts/` and `fixtures/` are listed under `exclude` in `_config.yml` so the build tooling
is not copied into the built site or the preview artifacts.

## Updating Organizational Members

The home page's "US-RSE Organizational Founding Members" section is generated from the
org members Google Sheet by `scripts/build-org-members.js` (Node 18+, no dependencies).
Edit the sheet, not `_data/org-members.yml`.

### How it works

```text
"members" tab of the sheet (ORG_MEMBERS_SHEET_ID) ─┐
Drive logo folder (ORG_LOGOS_FOLDER_ID) ───────────┤
                                                   ▼
                              scripts/build-org-members.js
                                                   │
               _data/org-members.yml  +  new files in assets/img/org-logos/
                                                   │
       index.html → _includes/org-card-group.html → _includes/org-member-card.html
```

- `_data/org-members.yml` is generated. Hand edits are overwritten on the next build.
- Members are grouped by tier (Premier, Standard, Basic) and sorted by `date_joined` on
  the page, members without a date last. A tier with no members has no heading.
- Each `figure` names a logo file in `assets/img/org-logos/`. On a live build, a logo the
  repo does not have yet is downloaded by its exact name from the Drive folder. Logos
  already in the repo are never re-downloaded, overwritten, or deleted, so the Drive folder
  only needs to hold new ones.

### Sheet columns

The header row uses these names (any case, any order). Other columns are ignored.

| Column | Required | Meaning | Accepted values |
| --- | --- | --- | --- |
| `tier` | yes | Membership tier | `Basic`, `Standard`, `Premier`, or `Inactive` (any case). `Inactive` keeps the row in the sheet but off the page. |
| `name` | yes | Organization name, shown as the logo's alt text | Any text. Rows without a name are skipped. |
| `url` | no (warns) | Where the logo links | A full URL |
| `figure` | yes (row skipped without it) | Logo filename | The exact name of an image in the Drive folder or in `assets/img/org-logos/`. Letters, digits, `.`, `_`, and `-` only; no leading dot; extension `png`, `jpg`, `jpeg`, `svg`, `webp`, `gif`, or `avif` |
| `acronym` | no | Added to the alt text, e.g. "Name (ACR)" | Any text |
| `date_joined` | no | Sort order within a tier | `M/D/YYYY` (a sheet date cell), `YYYY-MM-DD`, or empty (listed last in its tier) |
| `founding_member` | no | Kept in the YAML; not displayed | Checkbox, `TRUE`/`FALSE`, `yes`/`no`, or empty (= false) |
| `contact` | no | Kept in the YAML; not displayed | Any text |
| `background` | no | Color shown behind the logo | Any CSS color, e.g. `rgba(0, 0, 0, 0.7)` |

Keep each column a single type in the sheet (all dates, or all text). The CSV export can
blank out cells whose type differs from most of their column.

### Adding or editing a member

1. **New logo:** upload it to the Drive logo folder under the exact name you will put in
   `figure`. It must be an image file, no larger than 5 MB, and not a Google Drawing.
   You can also commit the file to `assets/img/org-logos/` yourself instead.
2. Add or edit the member's row in the `members` tab.
3. Run **Actions → Rebuild org members → Run workflow** (or run the script locally, below).
4. Read the run log for `build-org-members:` warnings and fix any rows they name.
5. Check the home page once the site redeploys.

To remove a member from the page, set their `tier` to `Inactive` rather than deleting the row.

To replace a logo that is already in the repo, delete it from `assets/img/org-logos/` in a
commit, put the new version in the Drive folder under the same name, and rerun.

### Running locally

Rebuild from the live sheet:

```bash
ORG_MEMBERS_SHEET_ID=<sheet-id> ORG_LOGOS_FOLDER_ID=<folder-id> GOOGLE_API_KEY=<key> \
  node scripts/build-org-members.js
```

The two Drive variables are only needed when a logo has to be downloaded.

Or build offline from the checked-in fixture, which needs no IDs and never contacts Drive:

```bash
node scripts/build-org-members.js --file fixtures/org-members.csv
```

A fixture build rewrites `_data/org-members.yml`. Restore it before committing:

```bash
git checkout -- _data/org-members.yml
```

### GitHub Action and secrets

The `Rebuild org members` workflow (`.github/workflows/build-org-members.yml`) runs only
when started by hand. It commits `_data/org-members.yml` and any new logos only when
something changed. It reads three repository **secrets**:

1. Go to the repo's **Settings → Secrets and variables → Actions → Secrets**.
2. Add `ORG_MEMBERS_SHEET_ID`: the sheet ID from its URL,
   `docs.google.com/spreadsheets/d/<sheet-id>/edit`. A run without it fails with an error.
3. Add `ORG_LOGOS_FOLDER_ID`: the folder ID from its URL,
   `drive.google.com/drive/folders/<folder-id>`.
4. Add `GOOGLE_API_KEY`: in a Google Cloud project, enable the **Google Drive API**, then
   create an API key under **APIs & Services → Credentials**. Restrict the key to the Drive
   API only.

In Drive, share the logo folder as **General access → Anyone with the link → Viewer**. The
API key can only read files shared that way.

### Warnings and errors

Warnings appear in the log and the build still succeeds. Errors stop the build before
anything is written.

| Message | Result |
| --- | --- |
| `"X" is inactive — not listed` | Row skipped |
| `unknown tier "X" — expected Basic, Standard, Premier, or Inactive` | Row skipped |
| `unparsable date_joined "X" — expected M/D/YYYY or YYYY-MM-DD` | Row skipped |
| `duplicate name "X" (first on row M)` | Row skipped; the first row is kept |
| `"X" has no url` | Member kept with an empty link |
| `"X" has no figure — not listed` | Row skipped |
| `founding_member "X" read as false` | Member kept |
| `figure "F" not found in assets/img/org-logos/ — "X" not listed` (offline `--file` builds only) | Row skipped |
| `figure "F" is not a plain image filename` | **Error** |
| `figure "F" is not in the logo folder` / `matches N files in the logo folder` / `is <type>, not an image` / `is N MB; the limit is 5 MB` | **Error**: every problem is listed together |
| `GOOGLE_API_KEY and/or ORG_LOGOS_FOLDER_ID must be set to download: …` | **Error**: a logo is needed but a Drive variable is unset |
| `ORG_LOGOS_FOLDER_ID is not a Drive folder ID` | **Error** |
| `Drive logo folder listing failed` / `Download of "F" failed: HTTP …` | **Error**: a 403 means the key is not enabled for the Drive API or the folder is not shared; a 404 means the folder was not found |
| `"F" is larger than the 5 MB limit` | **Error**: the downloaded file was bigger than Drive's listing said |
| `"members" tab has no "name"/"tier" column — is the tab named members?` | **Error** |
| `"members" tab fetch failed: HTTP N` | **Error** |
| `ORG_MEMBERS_SHEET_ID is not set` | **Error** |
| `--file requires a path` | **Error** |
| `No members found — refusing to write an empty file.` | **Error** |

## Adding logos to the website

There is an `_include` file, `add-sponsor-logo.html`, that can be used to add a
sponsor's logo anywhere on the website.
You can use the function by calling:
`{% include add-sponsor-logo.html sponsor_url="some_url" logo_file="logo-filename.png" logo_alt="Some alt text for users" %}`
See the include file for details on the variable names.
The logo files need to be added to the `assets/img/sponsor-logos/` directory.

### Logos on the main page

To add the sponsor logos to the main page, follow the same directions as above,
but make sure the include call is in the correct tier section for the sponsor.
For example, UIUC is a platinum sponsor, so they are added to the
`<div class="row sponsor-platinum ...>` block.
