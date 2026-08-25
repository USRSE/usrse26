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

The program page is generated from the "Schedule" tab of the program Google Sheet by
`scripts/build-program.js` (Node 18+, no dependencies), which writes
`_includes/program-schedule.html` (the list view), `_includes/program-grid.html` (the room ×
time grid view), and `_data/program.json`. Edit the sheet, not those files.

The Full Program page shows the list by default with a List / Grid toggle above it; the
grid lays each day out with rooms as columns and time down the side, breaks and other
venue-wide sessions spanning every column, and each card linking to its entry in the list.
The toggle, the reader's remembered choice, and the grid's "Talk details" switch are driven
by `assets/js/program-view.js`, and `assets/css/program-grid.css` styles the grid — both
hand-written and must ship alongside the generator. With JavaScript off the page is the
list alone: the toggle and the grid include ship hidden and are never revealed.

The sheet's core columns are Start, End, Location, Session Topic, Event Title, and Order.
Session rows may carry Session Format (used exactly as given — never inferred from the
topic; Break, Meal, and Registration render as muted rows, Plenary gets the highlighted
plenary treatment), Session Chair (shown next to the format), and Session Description
(Markdown). Event rows (rows with an Event Title) may also carry People (speakers as
"A, B and C"), Event Format (Bird of a Feather, Keynote, Notebook, Other, Paper, Plenary,
Poster, Random Access Microtalk, Talk, or Workshop), and Event Description (the event's abstract,
as Markdown). When events carry an Event Format other than "Other", the script also
generates one abstract page per format under `pages/program/abstracts/` and the program
menubar `_data/menus/program.yml` linking those pages — both script-managed: they carry a
generator banner, are pruned when their format leaves the sheet, and must not be edited by
hand.

Each abstract page lists its entries as collapsed rows carrying the title and byline, with
the abstract behind a native `<details>` disclosure; an entry with no Event Description
renders as a plain row with no control to open. The pages link two hand-written assets, so
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

### Local development

Rebuild from the live sheet:

```bash
PROGRAM_SHEET_ID=<sheet-id> node scripts/build-program.js
```

Or build offline from the checked-in fixture, which needs no sheet ID:

```bash
node scripts/build-program.js --file fixtures/schedule.csv
```

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
