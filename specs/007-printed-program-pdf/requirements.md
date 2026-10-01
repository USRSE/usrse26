# Requirements — printed program PDF

Status: approved

## Summary

USRSE'25 handed attendees an 8-page US Letter printed program
([program_pdf.pdf](https://github.com/USRSE/usrse25/blob/main/pages/program/program_pdf.pdf)),
laid out by hand in Illustrator: a cover (logo, theme, city and dates, a QR code
to the online program, Wi-Fi details), a welcome letter from the General Chairs
plus the Code of Conduct notice, a multi-page "Schedule Overview", the
Organizing Committee, and a "Thank You Sponsors!" logo page. Every schedule
change meant re-editing the Illustrator file.

USRSE'26 already has the schedule as data. `scripts/build-program.js` folds the
program sheet into `_data/program.json` — `days[] → slots[] → sessions[] →
talks[]`, where a day has `weekday`/`label`, a slot has `start`/`end`/`break`,
a session has `title`/`type`/`room`/`info`/`chair`/`plenary`/`muted`, and a
talk has `title`/`speakers`/`format`/`infoMd`/`image`/`href`. The other
content lives elsewhere in the repo: committee in
`pages/about/organization.md`, sponsor tiers and logo files in `index.html`
(via `_includes/add-sponsor-logo.html`, logos in `assets/img/sponsor-logos/`),
and site facts (`title`, `conf_theme_short`, `conf_start_date`,
`conf_end_date`, `url`, `baseurl`) in `_config.yml`.

This feature adds `scripts/build-program-pdf.js`, a sibling of
`build-program.js` in the same style — zero npm dependencies, Node 18+, a
`do not edit`-style generated output, one-line `build-program-pdf: <message>`
failures. It reads `_data/program.json` and the other repo sources, writes a
self-contained print HTML (CSS `@page`, US Letter), and, when a Chrome or
Chromium binary is available, renders it to a committed PDF with
`--headless --print-to-pdf`. It is run by hand before sending the program to
the printer; it is not part of the daily sheet workflow.

## User stories

### Story 1 — One command builds the printed program

As a conference organizer, I want a single command that turns the committed
program data into a print-ready PDF, so that a late schedule change costs one
rebuild instead of an Illustrator session.

**Acceptance criteria**

- WHEN `node scripts/build-program-pdf.js` is run, THE system SHALL read
  `_data/program.json` and SHALL NOT fetch the program sheet or require
  `PROGRAM_SHEET_ID`.
- WHEN the script runs, THE system SHALL write a self-contained print HTML file
  to `_print/program.html` (all CSS inline, images referenced by relative path
  into the repo) sized for US Letter portrait via CSS `@page`. `_print/` is
  underscore-prefixed, so Jekyll never publishes it; the HTML is committed so
  layout changes are reviewable as diffs.
- WHEN a Chrome/Chromium binary is found — from a `CHROME_PATH` environment
  variable, else the standard macOS and Linux install locations / `PATH` names
  — THE system SHALL render the print HTML to `pages/program/program.pdf` with
  headless printing and no browser header/footer.
- WHEN no Chrome/Chromium binary is found, THE system SHALL still write the
  print HTML, SHALL print a message naming the HTML path and how to set
  `CHROME_PATH`, and SHALL exit non-zero so the missing PDF is not mistaken for
  success.
- WHEN `--html-only` is passed, THE system SHALL write the print HTML, skip
  PDF rendering, and exit 0.
- WHEN `_data/program.json` is missing or has no days, THE system SHALL fail
  with a one-line `build-program-pdf: …` message and write nothing.
- WHEN the script uses only Node built-ins (`fs`, `path`, `child_process`,
  `os`), THE system SHALL require no `package.json` or `npm install`.

### Story 2 — Cover page

As an attendee, I want a cover that tells me which conference this is and how
to get online, so that the handout is recognizable and immediately useful.

**Acceptance criteria**

- WHEN the program is built, THE system SHALL render page 1 as a cover with the
  conference logo (`assets/img/usrse26-long-logo.svg`), the
  `conf_theme_short` from `_config.yml`, and the location from a new
  `conf_location` key in `_config.yml` (e.g. "San Jose, CA") with the date
  range.
- WHEN `conf_location` is missing from `_config.yml`, THE system SHALL fail
  with a one-line message, as `build-program.js` does for its required keys.
- WHEN the cover is rendered, THE system SHALL derive the date range from
  `conf_start_date`/`conf_end_date` in `_config.yml` (e.g. "October 19–21,
  2026"), never from a hard-coded string.
- WHEN the cover is rendered, THE system SHALL show the committed QR code
  image `assets/img/program-qr.svg` (generated once, outside the script) and
  the URL of the online program (`url` + `baseurl` + `/program/`).
- WHEN `assets/img/program-qr.svg` does not exist, THE system SHALL fail with a
  one-line message naming the file.
- WHEN `conf_wifi_ssid` (and optionally `conf_wifi_password`) are set in
  `_config.yml`, THE system SHALL show the network name and password on the
  cover; WHEN `conf_wifi_ssid` is not set, THE system SHALL omit the Wi-Fi
  block entirely rather than print a placeholder.

### Story 3 — Welcome letter

As a General Chair, I want my welcome letter in the printed program, so that
attendees get the same welcome as in past years.

**Acceptance criteria**

- WHEN `_print/welcome.md` exists, THE system SHALL render it on its own page
  under the heading "Welcome!", supporting paragraphs, `*emphasis*`,
  `**strong**`, and `[text](url)` links (printed as text). The file lives in
  `_print/`, so it is never published on the website; it becomes public only
  through the committed PDF and the repo, which is acceptable once final.
- WHEN the feature lands, THE system SHALL ship a committed placeholder
  `_print/welcome.md` with front matter `placeholder: true` and a short body
  telling the General Chairs to replace it with their letter.
- WHEN `_print/welcome.md` has `placeholder: true` in its front matter, THE
  system SHALL still render it and SHALL print a warning that the welcome
  letter is still the placeholder.
- WHEN the welcome page is rendered, THE system SHALL append the Code of
  Conduct notice with the report address and the absolute URL of
  `about/code-of-conduct/`, and the conference website URL.
- WHEN the welcome-letter file is missing, THE system SHALL omit the welcome
  page and print a warning, but still build the rest of the program.

### Story 4 — Schedule overview

As an attendee, I want a compact day-by-day schedule I can scan on paper, so
that I can pick sessions without a phone.

**Acceptance criteria**

- WHEN the schedule is rendered, THE system SHALL start with the heading
  "Schedule Overview" and a note that full abstracts and presenter names are
  in the online program, with its URL.
- WHEN a day is rendered, THE system SHALL show a heading of weekday and label
  (e.g. "Monday, October 19") and list its slots in `program.json` order.
- WHEN a slot is rendered, THE system SHALL show its `start`–`end` time once
  in a left column and each of its sessions to the right, in `program.json`
  order.
- WHEN a session is rendered, THE system SHALL show its `title` in bold
  followed by its `room` in italics; WHEN the session is `muted` (Break, Meal,
  Registration), THE system SHALL render it as a single compact line.
- WHEN a session has a `chair`, THE system SHALL NOT show it in the schedule
  overview.
- WHEN a session has one or more talks and is a talk session (`type` is
  `Talks` or it has more than one talk), THE system SHALL list each talk's
  `title` as a bullet, without speakers or abstracts.
- WHEN a session has exactly one talk whose `format` is Keynote, Workshop,
  Bird of a Feather, or Student, THE system SHALL show `<format>: <talk title>`
  and, when the talk has `speakers`, the speakers.
- WHEN a session has non-empty `info`, THE system SHALL render it as a short
  plain-text line (Markdown stripped).
- WHEN a day's schedule crosses a page break, THE system SHALL repeat the day
  heading with ", continued" on the new page and SHALL NOT split a single
  session across pages.
- WHEN sheet text contains `<`, `>`, or `&`, THE system SHALL escape it so
  sheet content can never inject markup into the print HTML.

### Story 5 — Organizing committee

As a committee member, I want the committee listed in the program, so that
attendees know whom to thank and contact.

**Acceptance criteria**

- WHEN the program is built, THE system SHALL render an "Organizing Committee"
  section from `pages/about/organization.md`: each `##`/`###`/`####` heading
  under it as a group title and each list item as a member line, skipping the
  front matter, Liquid tags, the "Contact" section, and non-list prose.
- WHEN `organization.md` contains no list items under its committee headings,
  THE system SHALL fail with a one-line message rather than print an empty
  section.

### Story 6 — Sponsors and organizational members

As a sponsorship chair, I want every sponsor's logo, and the US-RSE
organizational founding members, on a "Thank You Sponsors!" page, so that
the printed program matches what we promised sponsors and members.

**Acceptance criteria**

- WHEN the program is built, THE system SHALL read sponsor tiers from
  `index.html`: each tier heading (`<h3>`/`<h4>` text such as "Platinum
  Sponsors", "Break Sponsors") followed by its
  `{% include add-sponsor-logo.html … logo_file="…" logo_alt="…" %}` calls.
- WHEN the sponsors page is rendered, THE system SHALL title it "Thank You
  Sponsors!" and list sponsor tiers in `index.html` order, each with its logos
  from `assets/img/sponsor-logos/` and `logo_alt` as the image `alt`.
- WHEN logos are rendered, THE system SHALL size them by tier (first tier
  largest, last smallest) and keep the sponsors page to one sheet.
- WHEN `index.html` yields no sponsor tiers, THE system SHALL fail with a
  one-line message rather than print an empty page.
- WHEN `_data/org-members.yml` exists (added by PR #63), THE system SHALL
  render a "US-RSE Organizational Founding Members" section after the sponsor
  tiers, with Premier, Standard, and Basic levels in that order, each sorted by
  `date_joined` ascending, with logos from `assets/img/org-logos/<figure>` and
  `name` (plus `acronym` when set) as the image `alt` — matching the order PR
  #63 renders on the homepage.
- WHEN an org member has a `background`, THE system SHALL render that color
  behind its logo, as PR #63's `org-member-card.html` does.
- WHEN `_data/org-members.yml` does not exist, THE system SHALL omit the
  organizational members section without error.
- WHEN an org member has a `contact`, THE system SHALL NOT print it.
- WHEN a sponsor or org member names a logo file that does not exist, THE
  system SHALL fail with a one-line message naming the file.
- WHEN the sponsors page is rendered, THE system SHALL end with the conference
  website URL.

### Story 7 — Reproducible, reviewable output

As a maintainer, I want the build to behave like `build-program.js`, so that
it is easy to review and safe to re-run.

**Acceptance criteria**

- WHEN the generated HTML is unchanged from the file on disk, THE system SHALL
  not rewrite it and SHALL log `unchanged` (same `writeIfChanged` convention).
- WHEN the PDF is rendered, THE system SHALL write it only when the print HTML
  changed or the PDF does not exist, so re-running on unchanged data does not
  produce a new binary diff from Chrome's embedded timestamps.
- WHEN `--force` is passed, THE system SHALL re-render the PDF regardless.
- WHEN the script finishes, THE system SHALL log the page count Chrome
  reported, or the output path, so an organizer can sanity-check length.

## Out of scope

- Running the script in GitHub Actions or adding it to `build-program.yml`.
- Abstracts, speaker bios, and the posters list (online only, as in 2025).
- Fetching from the Google Sheet — `build-program.js` remains the only sheet
  reader.
- Booklet imposition, bleed/crop marks, or CMYK output for commercial print.
- Changes to `build-program.js`, `_data/program.json`, or any page it
  generates.
- A floor map / venue map page.
- Moving sponsors or committee into new `_data` files consumed by the website.
- Session chairs in the schedule overview (online program only).
- Linking `program.pdf` from the program page — done by hand once the printed
  version is final.
- Generating the QR code; `assets/img/program-qr.svg` is made once with any QR
  tool and committed.
- Merging PR #63; this feature reads its data file only if present.

## Resolved decisions

1. **QR code** — a committed image, `assets/img/program-qr.svg`, made once
   outside the script. No QR encoder in the script.
2. **Wi-Fi** — `conf_wifi_ssid` / `conf_wifi_password` keys in `_config.yml`;
   block omitted when unset.
3. **Sponsors** — parsed from `index.html`. Organizational founding members
   come from `_data/org-members.yml` (PR #63) when present.
4. **Welcome letter** — the General Chairs write it. A placeholder
   `_print/welcome.md` (`placeholder: true`) is committed now; the chairs'
   text replaces it right before printing. It is not published on the
   website; it is public in the repo and PDF once final, which is acceptable.
5. **Print HTML** — committed at `_print/program.html`; Jekyll skips `_print/`.
6. **Site link** — none until the printed program is final.
7. **Location** — new `conf_location` key in `_config.yml`.
8. **Session chairs** — not shown in the schedule overview.
