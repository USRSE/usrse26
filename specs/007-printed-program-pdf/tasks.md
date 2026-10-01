# Tasks — printed program PDF

Ordered, small tasks. This repo has no test suite, so after each task "green"
means:

- `node scripts/build-program-pdf.js --html-only` exits 0 (from task 2 on).
- The greps listed in the task match against `_print/program.html`.
- `bundle exec jekyll build` still exits 0 with no new warnings.

Each task lists its expected results before the code that produces them.
Section references (§n) point to `design.md`.

Do **not** run `scripts/build-program.js` as part of this work, and do not
change it; that follow-up is issue #69.

**Data note.** The counts below assume the committed `_data/program.json` (3
days; 10/10/8 slots) and today's `index.html` sponsors: Platinum 4, Gold 3,
Silver 1, Bronze 3, Break 1. `_data/org-members.yml` is not on `main` yet
(PR #63). If any of these change before implementation, recount and update the
expected values.

---

- [x] 1. **Baseline and config keys** (Story 2; §2)
  - **Baseline first.** Run `bundle exec jekyll build` on the untouched tree.
    Record the exit status and any warnings it already prints.
  - **Then the config change.** Add `conf_location: "San Jose, CA"` to
    `_config.yml`, next to `conf_start_date`. Add `conf_wifi_ssid` and
    `conf_wifi_password` as commented-out lines, each with a one-line comment.
  - **Expected after the change.** `grep -n '^conf_location:' _config.yml`
    → 1 line. The Jekyll build is unchanged.

- [x] 2. **Script skeleton and CLI** (Story 1, Story 7; §1, §2, §3 `readProgram`, §8)
  - **Expected results:**
    - `node scripts/build-program-pdf.js --html-only` → exit 0, logs
      `wrote _print/program.html`.
    - A second run logs `unchanged _print/program.html`.
    - `head -1 _print/program.html` contains `do not edit`.
    - `grep -c 'size: letter' _print/program.html` → ≥1.
    - With `_data/program.json` temporarily renamed: exit 1, and stderr is the
      single line `build-program-pdf: _data/program.json does not exist.`
      `_print/program.html` is not touched (check mtime). Restore the file.
  - **Code:**
    - Create `scripts/build-program-pdf.js` with:
      - a header comment (usage, inputs, outputs, `--html-only`, `--force`,
        `CHROME_PATH`, the logo `--force` caveat, a pointer to #69)
      - the copied helpers from §1, each with a "copied from build-program.js"
        note
      - `CONF` and the path constants from §2
      - `readProgram()`
      - a `renderDocument` that, for now, emits only the `<!doctype>`, the
        page-box CSS, and an empty body
      - `main()` with the `--html-only` branch, and
        `main().catch` → `build-program-pdf: <msg>`
    - With `conf_location` temporarily removed from `_config.yml`: exit 1 with
      `build-program-pdf: _config.yml has no "conf_location" …`. Restore it.

- [x] 3. **QR image and cover page** (Story 2; §2 `dateRange`, §5 Cover)
  - **Expected results:**
    - `grep -c 'class="page cover"'` → 1.
    - The HTML contains `San Jose, CA · October 19–21, 2026`.
    - It contains `https://us-rse.org/usrse26/program/`.
    - `grep -c 'program-qr.svg'` → 1.
    - `grep -ci 'wi-fi'` → 0 while the Wi-Fi keys are commented out.
    - With `conf_wifi_ssid: "TestNet"` temporarily uncommented, `TestNet`
      appears. Revert it.
    - With `assets/img/program-qr.svg` temporarily renamed: exit 1, `QR code
      not found: assets/img/program-qr.svg`.
  - **Code:**
    - Generate `assets/img/program-qr.svg` once, encoding
      `https://us-rse.org/usrse26/program/`, with any QR tool (for example
      `npx --yes qrcode -t svg -o assets/img/program-qr.svg <url>`). Commit it,
      and record the command in the script header.
    - Implement `dateRange`, cover rendering, and the QR/logo existence
      checks.
    - Check `dateRange` by hand in `node -e` for both forms: same month and
      across a month boundary.

- [ ] 4. **Markdown helpers and welcome page** (Story 3, Story 4 escaping; §3 `readWelcome`, §4, §5 Welcome, §9)
  - **Expected results:**
    - `grep -c 'class="page welcome"'` → 1.
    - `Welcome!` and `coc@us-rse.org` are present.
    - `https://us-rse.org/usrse26/about/code-of-conduct/` is present.
    - stderr warns that the welcome letter is still the placeholder.
    - No `](` and no `**` appear inside the welcome section (Markdown was
      rendered).
    - With `_print/welcome.md` temporarily renamed: exit 0, a warning, and
      `grep -c 'class="page welcome"'` → 0. Restore the file.
    - Escaping check: `node -e` on `mdInline('<b>x</b> & **y**')` returns
      `&lt;b&gt;x&lt;/b&gt; &amp; <strong>y</strong>`.
  - **Code:** add the `_print/welcome.md` placeholder (§9), `readWelcome`,
    `mdInline`, `mdToText`, and the welcome renderer.

- [ ] 5. **Schedule overview rows** (Story 4; §5 Schedule rows)
  - **Expected results** (before pagination, rows sit flat inside
    `data-flow="schedule"`):
    - `grep -c 'class="row row--day"'` → 3.
    - `Monday, October 19`, `Tuesday, October 20`, and `Wednesday, October 21`
      are present.
    - `Schedule Overview` is present.
    - The number of `data-first="1"` rows equals the total slot count (28).
    - `grep -ci 'chair'` → 0.
    - `<b>Keynote:</b> Fernando Pérez` is present.
    - Muted sessions such as `Registration` render with no `<ul>`.
    - Talk sessions such as `RAG Assistants` render a `<ul>` with 4 `<li>`.
  - **Code:** add `FORMAT_LABELS`, the local `normalizeFormat`,
    `renderSchedule`, and `renderOverviewSession`.

- [ ] 6. **Paginator** (Story 4; §6)
  - **Expected results**, checked with Chrome `--headless=new --dump-dom
    --virtual-time-budget=10000 file://…/_print/program.html`:
    - `data-paginated="true"` on `<html>`.
    - `data-overflow="0"`.
    - No element with `data-flow` remains.
    - Every `.row--session` has a `.page` ancestor.
    - At least one heading ending in `, continued` (Monday spans more than one
      page).
    - No page ends with a `.row--day`.
    - Open the HTML in a browser and confirm it paginates on screen too.
  - **Code:** add `PAGINATOR_JS` and wait for `document.fonts.ready` and image
    loads before it runs.

- [ ] 7. **Organizing committee** (Story 5; §3 `readCommittee`, §5 Committee)
  - **Expected results:**
    - `Organizing Committee` is present.
    - These group titles are present: `General Chairs`, `Technical Program
      Chairs`, `Committee Members`, `Sponsorship Chairs`, `Student Chairs`,
      `Communications Chairs`, `Logistics Chairs`, `Community Engagement
      Chairs`.
    - `Contact` is absent as a heading.
    - `{{` and `{%` do not appear inside the committee section.
    - `Alex Koufos, Stanford University` is present.
    - With a temporary copy of `organization.md` that has no list items:
      exit 1, `organization.md has no committee members`. Restore the file.
  - **Code:** add `readCommittee` and `renderCommittee` in the `back` flow.

- [ ] 8. **Sponsors page** (Story 6; §3 `readSponsors`, §5 Sponsors)
  - **Expected results:**
    - `grep -c 'class="page sponsors"'` → 1.
    - `Thank You Sponsors!` is present.
    - The tier titles appear in order: Platinum, Gold, Silver, Bronze, Break.
    - 12 sponsor `<img>`s, each with a `sponsor-logos/` src and a non-empty
      `alt`.
    - The page ends with `https://us-rse.org/usrse26/`.
    - With a `logo_file` temporarily misspelled in `index.html`: exit 1,
      `sponsor logo not found: assets/img/sponsor-logos/<file>`. Revert it.
  - **Code:** add `readSponsors` (region cut, tier and include scan) and
    `renderSponsors` without org members.

- [ ] 9. **Organizational founding members** (Story 6; §3 `readOrgMembers`, §5 Sponsors)
  - **Expected on `main` (file absent):** no `Organizational Founding Members`
    text, no warning.
  - **Expected with PR #63's file and logos temporarily copied in**
    (`git checkout origin/org-members -- _data/org-members.yml
    assets/img/org-logos`, then unstage and delete afterwards):
    - `US-RSE Organizational Founding Members` is present.
    - The levels appear in the order Premier, Standard, Basic.
    - Within each level, items are in `date_joined` order: Premier starts with
      `University of Illinois Urbana-Champaign`; Basic is `Open OnDemand`.
    - `grep -c '@'` inside the section → 0, so no contacts.
    - The Purdue tile carries `background:rgba(0, 0, 0, 0.7)`.
    - A temporary repeated top-level key produces the "repeats key" warning.
    - A temporary nested map line fails with `org-members.yml line N:
      unsupported YAML`.
  - **Code:** add `readOrgMembers` (line parser, last-key-wins, field
    allowlist, `background` validation) and the org section in
    `renderSponsors`. Remove the temporary PR #63 files before committing.

- [ ] 10. **Chrome rendering and staleness** (Story 1, Story 7; §7, §8)
  - **Expected results:**
    - `node scripts/build-program-pdf.js` → exit 0. It writes
      `pages/program/program.pdf` and logs `program.pdf: N pages`, where N
      equals the `.page` count from the task 6 DOM dump.
    - An immediate re-run logs `unchanged pages/program/program.pdf`, and
      `git status` shows no PDF change.
    - `--force` re-renders.
    - `CHROME_PATH=/nonexistent` → exit 1 with `CHROME_PATH does not exist`.
    - No-Chrome path: temporarily empty `findChrome`'s candidate list and run
      with `CHROME_PATH` unset → exit 1, the message names
      `_print/program.html` and `CHROME_PATH`, and the HTML is still written.
      The next real run re-renders the PDF (mtime rule). Revert the edit.
    - The PDF has no browser header or footer: open it and check that no
      date, title, or file URL appears in the margins.
    - No `program.pdf.tmp` is left behind.
  - **Code:** add `findChrome`, `renderPdf` (temp + rename), page counting,
    the `--dump-dom` overflow check, the mtime staleness rule, and `--force`.

- [ ] 11. **Generate, review, and commit outputs** (all stories)
  - **Expected results:**
    - `node scripts/build-program-pdf.js` → exit 0, `data-overflow` 0.
    - `bundle exec jekyll build` → exit 0.
    - `ls _site/_print` fails, so `_print` is not published.
    - `_site/pages/program/program.pdf` exists.
    - `grep -r 'program.pdf' _site --include=*.html` → no links (Resolved
      decision 6).
    - Visual review of the PDF against the 2025 program: cover, welcome,
      schedule pages with ", continued", committee, and sponsors on one page.
  - **Code:** commit `_print/program.html`, `pages/program/program.pdf`,
    `_print/welcome.md`, and `assets/img/program-qr.svg` together with the
    script.
