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
`_includes/program-schedule.html` and `_data/program.json`. Edit the sheet, not those files.

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

