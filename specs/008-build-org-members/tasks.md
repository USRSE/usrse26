# Tasks — build org members from sheet

Ordered, small tasks. After each task the build stays green:
`node scripts/build-org-members.js --file fixtures/org-members.csv` exits 0
(from task 1 on), and `node scripts/build-program.js --file
fixtures/schedule.csv` is unaffected (this spec never touches it). Section
references (§n) are to `design.md`.

The repo has no JS test framework and none is added (requirements, Out of
scope); each task's **Verify** list is its test, run before the task is
checked off. Scratch CSVs and scratch logo folders live in the session
scratchpad, never in the repo.

**Baseline** (Story 3): before task 1, copy the committed
`_data/org-members.yml` to the scratchpad as `baseline.yml`. "Equivalent"
below means the Ruby check in §9 prints `equivalent` against it.

**Fixture-build hygiene** (§9): a fixture build rewrites
`_data/org-members.yml`; a `syncLogos()` harness test adds files to
`assets/img/org-logos/`. Before every commit:

```
git checkout -- _data/org-members.yml
git clean -f assets/img/org-logos
```

---

- [x] 1. **Fixture and skeleton** (Stories 2, 3; §1, §2, §3, §8, §9) —
  Create `fixtures/org-members.csv` (§9: all 15 current members, the trailing
  empty header column, and the four drop rows). Create
  `scripts/build-org-members.js` with the header comment (§8), configuration
  (§1), copied `parseCSV`, `argValue`, `fetchSheet`, `loadCSV`,
  `writeIfChanged` (§2), `toMemberRecords` (§3), and a `main()` that loads,
  parses, and logs `Parsed N rows` without writing anything yet. Add the
  `require.main === module` guard and `module.exports` from §7 now; extend
  the exports as later tasks add functions.
  Verify:
  - fixture run exits 0 and logs the row count (blank-name row excluded);
  - `--file` with no value → `--file requires a path`, exit 1;
  - no `--file` and `ORG_MEMBERS_SHEET_ID` unset → the "is not set" message
    naming `--file fixtures/org-members.csv`, exit 1;
  - a scratch CSV with header `Name,URL` (no tier) → `no "tier" column — is
    the tab named members?`, exit 1; header `  NAME ,Tier` is accepted;
  - `node -e 'require("./scripts/build-org-members.js")'` prints nothing
    and exits 0 (no build on require);
  - `git status` shows only the two new files.

- [x] 2. **Validation** (Story 4; §4) — Add `parseDate`, `parseBool`, and
  `validate(records)` returning `{ members, warnings, errors }`; `main()`
  prints warnings, throws on errors and on zero members. Still no write.
  Verify:
  - fixture run prints exactly three warnings (tier `Gold`, date
    `13/40/2025`, duplicate name) with correct row numbers, and logs 15
    members;
  - scratch CSV rows: `2/30/2025` skipped; `2025-03-10` and `3/10/2025`
    both accepted; `TRUE`, `yes`, `false`, empty accepted silently;
    `maybe` warns "read as false"; empty url and empty figure each keep the
    row and warn;
  - figure `../x.png`, `logo.pdf`, `.hidden.png`, `a b.png` → each an error;
    all listed in one message, exit 1;
  - a scratch CSV whose only rows are skipped → `No members found`, exit 1.

- [ ] 3. **YAML emitter and first write** (Story 3; §6, §7) — Add
  `renderYAML(members)` and call `writeIfChanged(OUT_YML, …)` at the end of
  `main()`. Logo handling not yet wired (task 4).
  Verify:
  - fixture run writes `_data/org-members.yml`; the file starts with the
    generated-file comment; Ruby check vs `baseline.yml` → `equivalent`;
  - second fixture run logs `unchanged`;
  - every empty acronym is `acronym: null`; dates unquoted; booleans bare;
    `contact`/`background` present only where the fixture has them;
  - scratch CSV with a name containing `: # "quoted" ` and a leading space,
    and a single Premier row: Ruby loads the name back byte-identical, and
    `basic`/`standard` keys are absent;
  - restore (hygiene).

- [ ] 4. **Logo planning and offline warning** (Stories 4, 7; §5.1, §5.6) —
  Add `repoLogos()`, `neededLogos(members, present)`, and the `--file`
  branch of source selection that turns needed logos into keep-and-warn
  warnings. The live branch throws `not implemented` for now.
  Verify:
  - fixture run: no logo warnings (all 15 figures exist), still equivalent;
  - scratch CSV with figure `logo-missing.png` on two rows → one warning per
    row naming the file; both members kept;
  - scratch CSV with figure `Logo-ADSA.png` (wrong case of an existing file)
    → warned as missing, on macOS too;
  - restore.

- [ ] 5. **Matching** (Story 7; §5.2) — Add pure `matchLogos(needed, files)`.
  Verify with a `node -e` harness that `require()`s the script (§7 guard and
  exports — add them in task 1 if not already there):
  - absent name → problem listing every row that named it;
  - two files of that name → "matches 2 files";
  - `application/vnd.google-apps.document` and `application/pdf` →
    "not an image";
  - `size: 6 * 1024 * 1024` → "the limit is 5 MB";
  - one `image/svg+xml` within the limit → a download entry;
  - fixture build still green and equivalent.

- [ ] 6. **Logo sync and saving** (Story 7; §5.4, §5.5, §7) — Add
  `syncLogos(needed, source)`, `saveLogo()`, and the final `main()` ordering
  (all checks → downloads → YAML); export both. Verify with a `require()`
  harness that builds a fake source over a scratch folder `logos/` (§5.4) and
  calls `syncLogos(neededLogos(...), fake)`:
  - one figure only in `logos/` → logged `downloaded
    assets/img/org-logos/<name>`, file byte-identical (`cmp`); rerun →
    `neededLogos` returns nothing, no download;
  - a figure missing from `logos/` plus another present → exit 1 listing
    the missing one; **neither** file appears in `assets/img/org-logos/`
    (`git status`);
  - a 6 MB `big.png` in `logos/` → size problem, nothing written (the
    non-image case is covered by task 5, since the fake source derives
    mimeType from the extension and `FIGURE_NAME` only admits image
    extensions);
  - an existing committed logo whose name is also in `logos/` with different
    bytes → not needed, not downloaded, unchanged (`git status`);
  - call `saveLogo()` from a `require()` harness on a name that already
    exists → throws `EEXIST`, original bytes intact, no temp file left;
  - a fake `download()` that rejects for the second of two logos → throws;
    the first is complete, the second absent, no `.<name>.download` left;
  - simulate a failed write (make `assets/img/org-logos` read-only for one
    call) → throws, no `.<name>.download` left behind; restore permissions;
  - fixture build still green and equivalent;
  - restore (hygiene, including `git clean` of the logo dir).

- [ ] 7. **Drive source** (Story 7; §5.3, §5.6) — Add `driveSource(apiKey,
  folderId, needed)` with paging, `X-Goog-Api-Key` header, size guard on the body,
  status hints, and the preconditions; wire it into the live branch,
  constructed only when `needed` is non-empty.
  Verify:
  - nothing needed (fixture run, Drive variables unset) → succeeds, no
    Drive request;
  - the precondition cases below call `driveSource()` from a `node -e`
    harness that `require()`s the script, since `--file` never selects
    Drive (§5.6);
  - needed logo, `GOOGLE_API_KEY` unset → message names only that variable
    and lists the logo + row; both unset → names both; folder ID
    `abc'or'1` → rejected before any request;
  - `grep -n "key=" scripts/build-org-members.js` finds nothing (key never in
    a URL); every thrown message built from status/name only;
  - **manual, with real secrets** (whoever holds them): upload a test image
    to the Drive folder and add a temporary sheet row naming it; a live run
    logs `downloaded` and the file matches the Drive original. A second
    temporary row naming a file not in Drive stops the build listing it.
    A deliberately wrong key yields the 403 hint and no key text. Remove
    the temporary rows, the Drive file, and the downloaded file.
  - restore.

- [ ] 8. **Workflow** (Story 5; §10) — Add
  `.github/workflows/build-org-members.yml` with the header comment.
  Verify:
  - `ruby -ryaml -e 'YAML.load_file(".github/workflows/build-org-members.yml")'`
    parses;
  - trigger is only `workflow_dispatch`; env carries the three secrets; the
    gate checks only `ORG_MEMBERS_SHEET_ID`; `git add -A` names exactly
    `_data/org-members.yml assets/img/org-logos`;
  - after merge (manual): dispatch with the secret unset → `::error::`; with
    secrets set and no sheet change → "nothing to commit".

- [ ] 9. **README** (Story 6; §11) — Add `## Updating Organizational Members`
  between `## Building the Program Schedule` and `## Adding logos to the
  website`, with the six subsections of §11.
  Verify:
  - every column, warning, and error in the script appears in the README
    tables (cross-check against the script's message strings);
  - no bare URLs containing `<id>` placeholders outside inline code;
  - `typos README.md` (if installed) is clean;
  - commands copied from the README run as written (fixture command).

- [ ] 10. **Jekyll build and page check** (Story 3) — Fixture build, then
  `bundle exec jekyll build` exits 0. Serve and compare the home page's
  "Organizational Founding Members" section against `main`: same tiers,
  logos, order, links, `alt` text (no `&nbsp;()` on acronym-less members),
  and the RCAC dark background. Restore.

- [ ] 11. **Switch to the live sheet** (Stories 1, 3, 7) — With the real
  sheet populated, run `ORG_MEMBERS_SHEET_ID=<id> ORG_LOGOS_FOLDER_ID=<id>
  GOOGLE_API_KEY=<key> node scripts/build-org-members.js` locally (or merge
  and dispatch the workflow). Verify: Ruby check vs `baseline.yml` →
  `equivalent`, or every difference is an intentional sheet correction the
  coordinator confirms; any new logos are images that render. Commit the
  regenerated `_data/org-members.yml` (and new logos).
