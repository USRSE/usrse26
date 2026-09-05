#!/usr/bin/env node
/**
 * build-program.js — build the USRSE'26 program pages from the program sheet.
 *
 * Pulls two tabs of the program Google Sheet via its CSV export endpoint.
 * The "Schedule" tab is folded into days -> time slots -> sessions ->
 * events; the "Posters" tab is a flat list of accepted posters. Together
 * they produce seven kinds of artifact:
 *
 *   _includes/program-schedule.html   Jekyll include rendered on the program page
 *   _includes/program-grid.html       room x time grid view of the same page
 *   _data/program.json                normalized schedule data (site.data.program)
 *   pages/program/abstracts/<slug>.md one page per event format (abstracts);
 *                                     posters.md comes from the Posters tab
 *   _data/menus/program.yml           program menubar linking those pages
 *   program/llms.txt                  plain-text schedule index for AI agents
 *   program/llms-full.txt             the same, with abstracts inlined
 *
 * The sheet stays the only thing anyone edits. Requires Node 18+ (global
 * fetch); zero dependencies.
 *
 *   PROGRAM_SHEET_ID=<id> node scripts/build-program.js    # live from Sheets
 *   node scripts/build-program.js --file fixtures/schedule.csv \
 *                                 --posters-file fixtures/posters.csv   # offline
 *   node scripts/build-program.js --from-json   # llms files only, from _data
 *
 * Offline with --file alone, the posters page is skipped: an existing
 * generated posters.md is left in place rather than rebuilt or pruned.
 *
 * Expected Schedule columns (case-insensitive): Start, End, Location,
 * Session Topic, Event Title, Order, the session-level columns
 * Session Format, Session Chair, and Session Description (Markdown), and
 * the event-level columns People, Event Format, Event Description
 * (Markdown), and DOI — event columns are read only on rows with an Event
 * Title. Start/End carry the date and 24h wall-clock time ("10/19 13:30").
 * Session Format is used exactly as given, never inferred from the topic:
 * Break/Meal/Registration render muted, Plenary gets the plenary field.
 * A row with an Event Title attaches an event to the session matching its
 * Start/Session Topic/Location; events sort by Order. Rows still in the
 * pre-2026 layout (every event column empty) are normalized: a
 * "Session Chair: X" row sets the session's chair instead of listing as
 * an event, and a "<title> by <names>" byline splits into title + People.
 *
 * Expected Posters columns: Authors, Poster Title (or Title), Abstract
 * (Markdown), and DOI, in any order; other columns are ignored. Rows
 * without a Poster Title are skipped. The Posters tab owns posters.md:
 * Schedule events with Event Format "Poster" keep their pill and link into
 * the page (to the entry whose slugified title matches, else the page
 * top) but never become entries on it. A missing or renamed Posters tab
 * fails the build.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REPO_ROOT = path.join(__dirname, '..');

/**
 * Top-level scalars from _config.yml, so the facts Jekyll already knows are
 * stated once rather than restated here.
 *
 * Deliberately not a YAML parse. This script has no dependencies, and the
 * handful of values it wants — url, baseurl, title, description,
 * conf_theme_short, conf_start_date — are all unindented scalars at the top
 * of the file. So: read lines of the form "key: value" at column 0, and stop
 * there. Nested structures (defaults, collections, plugins) are keys with no
 * value on the line and simply never match; their indented children never
 * match either. A quoted value keeps its contents verbatim, an unquoted one
 * loses a trailing " # comment", and nothing else is interpreted — no
 * anchors, no multi-line scalars, no type coercion.
 *
 * Anything this cannot express stays a constant below, with a reason.
 */
function readJekyllConfig() {
  let text;
  try {
    text = fs.readFileSync(path.join(REPO_ROOT, '_config.yml'), 'utf8');
  } catch (err) {
    configFail(`cannot read _config.yml: ${err.message}`);
  }
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]+(\S.*)$/.exec(line);
    if (!m) continue;
    const quoted = /^(["'])([\s\S]*)\1[ \t]*(?:#.*)?$/.exec(m[2]);
    values.set(m[1], quoted ? quoted[2] : m[2].replace(/[ \t]+#.*$/, '').trim());
  }
  return values;
}

/**
 * Config problems are fatal, and they surface while the constants below are
 * being initialized — before main() exists for its .catch to format them. So
 * they report and exit here, in the same one-line shape every other failure
 * uses, rather than reaching the top level as a stack trace.
 */
function configFail(message) {
  console.error(`build-program: ${message}`);
  process.exit(1);
}

const JEKYLL = readJekyllConfig();

/** A _config.yml value that must be present: the output is wrong without it. */
function configValue(key) {
  const v = JEKYLL.get(key);
  if (v === undefined || v === '') {
    configFail(`_config.yml has no "${key}" — cannot build the program.`);
  }
  return v;
}

// ID of the program spreadsheet (the long token in its docs.google.com URL).
// Deliberately kept out of the repo: it must come from the PROGRAM_SHEET_ID
// environment variable (a repository secret in CI). Offline builds with
// --file need no ID at all.
const SHEET_ID = process.env.PROGRAM_SHEET_ID || '';
const SHEET_NAME = 'Schedule';
const POSTERS_SHEET_NAME = 'Posters';

// Sheet dates are "M/DD" with no year; _config.yml dates the conference.
const CONF_YEAR = (() => {
  const m = /^(\d{4})-/.exec(configValue('conf_start_date'));
  if (!m) configFail('_config.yml conf_start_date must start with YYYY-.');
  return Number(m[1]);
})();

// All program times are wall-clock US Pacific. Never construct JS Date
// objects from them — a runner in UTC would shift 8:30am to a different day.
//
// NOT taken from conf_start_date, which ends "-0900". San Jose in October is
// PDT, UTC-7; -0900 would restamp every session two hours off and silently
// move the early ones into the previous day. Reading it here would propagate
// a wrong value into program.json and both llms files, so this stays a
// constant until the config is corrected.
const TZ_OFFSET = '-07:00';

// Concurrent sessions render in this room order regardless of sheet row
// order: the ballroom salons always lead, Willow Glen always trails.
// "Anywhere" suppresses the room line entirely (breaks, meals, registration).
const ROOM_ORDER = [
  'San Jose Ballroom Salon 3 & 4',
  'San Jose Ballroom Salon 1 & 2',
  'San Jose Ballroom Salon 5 & 6',
  'Market Street',
  'Prefunction',
  'Willow Glen Room',
  'Anywhere',
];

// Session Format values that render as a compressed, muted row instead of
// a full session block. The format is always taken from the sheet as
// typed — nothing is inferred from the session topic.
const MUTED_TYPES = new Set(['break', 'meal', 'registration']);

// Event formats (the sheet's Format column), keyed by lowercased trimmed
// cell value. The "page formats" carry a pill label on the schedule
// and generate an abstract page (pageTitle/permalink/slug); "Other" opts an
// event out of both. Unknown values are treated as Other, never an error —
// the raw cell text is carried separately for program.json. A format with
// `tab` has its page built from that other sheet tab instead of from
// schedule rows: its events keep the pill and link into the page, but
// never become entries on it.
/** @type {Record<string, {label: string|null, pageTitle: string|null, permalink: string|null, slug: string|null, tab?: string}>} */
const FORMATS = {
  'bird of a feather': { label: '', pageTitle: 'Birds of a Feather', permalink: 'program/bofs/', slug: 'bofs' },
  'keynote': { label: 'Keynote', pageTitle: 'Keynotes', permalink: 'program/keynotes/', slug: 'keynotes' },
  'notebook': { label: 'Notebook', pageTitle: 'Notebooks', permalink: 'program/notebooks/', slug: 'notebooks' },
  'paper': { label: 'Paper', pageTitle: 'Papers', permalink: 'program/papers/', slug: 'papers' },
  'plenary': { label: 'Plenary', pageTitle: 'Plenaries', permalink: 'program/plenaries/', slug: 'plenaries' },
  'poster': { label: 'Poster', pageTitle: 'Posters', permalink: 'program/posters/', slug: 'posters', tab: 'Posters' },
  'random access microtalk': { label: 'RAM', pageTitle: 'Random Access Microtalks', permalink: 'program/rams/', slug: 'rams' },
  'talk': { label: 'Talk', pageTitle: 'Talks', permalink: 'program/talks/', slug: 'talks' },
  'workshop': { label: '', pageTitle: 'Workshops', permalink: 'program/workshops/', slug: 'workshops' },
  'other': { label: null, pageTitle: null, permalink: null, slug: null },
};

/** Empty cell -> null; known value -> its entry; anything else -> Other.
 * @param {string} raw */
function normalizeFormat(raw) {
  const v = (raw || '').trim();
  if (!v) return null;
  return FORMATS[v.toLowerCase()] || FORMATS.other;
}

const OUT_HTML = path.join(REPO_ROOT, '_includes', 'program-schedule.html');
const OUT_GRID = path.join(REPO_ROOT, '_includes', 'program-grid.html');
const OUT_JSON = path.join(REPO_ROOT, '_data', 'program.json');

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Minimal RFC 4180 parser: quoted fields, embedded commas/quotes/newlines. */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

// Current sheet headers first; the older names each column replaced stay
// recognized as aliases so an in-transition sheet still builds.
/** @type {Record<string, string>} */
const HEADER_ALIASES = {
  date: 'date', day: 'date',
  start: 'start', starttime: 'start',
  end: 'end', endtime: 'end',
  sessionformat: 'type', type: 'type', sessiontype: 'type',
  sessiontopic: 'session', session: 'session', sessiontitle: 'session',
  sessionchair: 'chair',
  room: 'room', location: 'room',
  eventtitle: 'talk', talk: 'talk', talktitle: 'talk',
  title: 'title',
  speakers: 'speakers', speaker: 'speakers', presenters: 'speakers',
  people: 'speakers',
  eventformat: 'format', format: 'format',
  eventdescription: 'infomd', infomd: 'infomd',
  doi: 'doi',
  order: 'order',
  sessiondescription: 'info', info: 'info', notes: 'info',
};

/** Header cell -> canonical key, or null for a column the map ignores.
 * @param {string} h
 * @param {Record<string, string>} aliases */
function normalizeHeader(h, aliases = HEADER_ALIASES) {
  return aliases[h.toLowerCase().replace(/[^a-z]/g, '')] || null;
}

/** Turn raw CSV rows into objects keyed by canonical column names. */
function toRecords(rows) {
  const header = rows[0].map((h) => normalizeHeader(h));
  return rows.slice(1).map((cells, i) => {
    const rec = { _row: i + 2 }; // 1-based sheet row, counting the header
    header.forEach((key, col) => {
      if (key) rec[key] = (cells[col] || '').trim();
    });
    return rec;
  }).filter((r) => r.start && r.session);
}

// The Posters tab has its own small header map. Any other column (a poster
// number, say) maps to null and is read past.
/** @type {Record<string, string>} */
const POSTER_HEADER_ALIASES = {
  authors: 'authors',
  postertitle: 'title', title: 'title',
  abstract: 'abstract',
  doi: 'doi',
};

/**
 * Posters tab rows -> {title, authors, abstractMd, doi, _row} in sheet
 * order, rows without a title dropped. A missing "Poster Title" column is
 * fatal: a renamed or absent tab must fail the build, not serve a stale
 * page.
 * @param {string[][]} rows
 */
function toPosterRecords(rows) {
  const header = (rows[0] || []).map((h) => normalizeHeader(h, POSTER_HEADER_ALIASES));
  if (!header.includes('title')) {
    throw new Error(
      `"${POSTERS_SHEET_NAME}" tab has no "Poster Title" column — is the tab named ${POSTERS_SHEET_NAME}?`);
  }
  return rows.slice(1).map((cells, i) => {
    const rec = { _row: i + 2, title: '', authors: '', abstractMd: '', doi: '' };
    header.forEach((key, col) => {
      if (!key) return;
      const v = (cells[col] || '').trim();
      if (key === 'abstract') rec.abstractMd = v;
      else rec[key] = v;
    });
    return rec;
  }).filter((r) => r.title);
}

/**
 * "A, B and C" / "A, B, and C" / "A and B" -> ["A", "B", "C"]. The parsed
 * list feeds program.json only; display always uses the cell as typed. A
 * single name legitimately containing " and " cannot be told apart from
 * two names — accepted limitation.
 * @param {string} raw
 */
function parsePeople(raw) {
  return raw
    .split(',')
    .map((seg) => seg.trim().replace(/^and\s+/, ''))
    .flatMap((seg) => seg.split(/\s+and\s+/))
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

// ---------------------------------------------------------------------------
// Wall-clock time handling (no JS Date arithmetic on times of day)
// ---------------------------------------------------------------------------

/** "8:30 AM" / "10:30am" / "15:00" -> minutes since midnight. */
function parseTime(raw, ctx) {
  const m = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp])?\.?[Mm]?\.?$/);
  if (!m) throw new Error(`Unparsable time "${raw}" (${ctx})`);
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const half = m[3] ? m[3].toLowerCase() : null;
  if (half === 'p' && h !== 12) h += 12;
  if (half === 'a' && h === 12) h = 0;
  return h * 60 + min;
}

/** Minutes since midnight -> "8:30am" / "12pm". */
function fmtTime(mins) {
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const half = h24 < 12 ? 'am' : 'pm';
  let h = h24 % 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h}${half}` : `${h}:${String(m).padStart(2, '0')}${half}`;
}

/** ISO local datetime carrying the conference offset explicitly. */
function fmtISO(isoDate, mins) {
  const h = String(Math.floor(mins / 60)).padStart(2, '0');
  const m = String(mins % 60).padStart(2, '0');
  return `${isoDate}T${h}:${m}:00${TZ_OFFSET}`;
}

/** Accept "2026-10-19", "10/19/2026", or "10/19" (conference year); ISO out. */
function parseDate(raw, ctx) {
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return raw;
  m = raw.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (m) {
    const year = m[3] || String(CONF_YEAR);
    return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  throw new Error(`Unparsable date "${raw}" (${ctx})`);
}

/**
 * Split a sheet Start/End cell — "10/19 13:30" — into ISO date + minutes.
 * A bare time ("13:30") is allowed when the row has a separate Date column.
 * @param {string} raw
 * @param {string | null} fallbackDate
 * @param {string} ctx
 */
function splitDateTime(raw, fallbackDate, ctx) {
  const m = raw.trim().match(/^(\d{1,2}\/\d{1,2}(?:\/\d{4})?|\d{4}-\d{2}-\d{2})\s+(.+)$/);
  if (m) return { date: parseDate(m[1], ctx), mins: parseTime(m[2], ctx) };
  if (!fallbackDate) throw new Error(`Time "${raw}" has no date (${ctx})`);
  return { date: fallbackDate, mins: parseTime(raw, ctx) };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** Weekday/label for an ISO date. Noon UTC keeps this immune to offsets. */
function dateParts(isoDate) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return {
    weekday: WEEKDAYS[d.getUTCDay()],
    label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`,
  };
}

// ---------------------------------------------------------------------------
// Folding: flat rows -> days -> slots -> sessions -> talks
// ---------------------------------------------------------------------------

function roomRank(room) {
  const i = ROOM_ORDER.indexOf(room);
  return i === -1 ? ROOM_ORDER.length : i;
}

function fold(records) {
  const days = new Map(); // isoDate -> Map(slotKey -> slot)
  for (const rec of records) {
    const ctx = `row ${rec._row}`;
    const rowDate = rec.date ? parseDate(rec.date, ctx) : null;
    const { date, mins: start } = splitDateTime(rec.start, rowDate, ctx);
    const end = rec.end ? splitDateTime(rec.end, date, ctx).mins : start;

    if (!days.has(date)) days.set(date, new Map());
    const slots = days.get(date);
    const slotKey = `${start}|${end}`;
    if (!slots.has(slotKey)) slots.set(slotKey, { start, end, sessions: new Map() });
    const slot = slots.get(slotKey);

    const sessionKey = `${rec.session}|${rec.room || ''}`;
    if (!slot.sessions.has(sessionKey)) {
      slot.sessions.set(sessionKey, {
        title: rec.session,
        type: rec.type || '',
        muted: rec.type ? MUTED_TYPES.has(rec.type.toLowerCase()) : false,
        chair: rec.chair || '',
        room: rec.room || '',
        info: rec.info || '',
        talks: [],
        _row: rec._row,
      });
    }
    const session = slot.sessions.get(sessionKey);
    if (!session.info && rec.info) session.info = rec.info;
    if (!session.chair && rec.chair) session.chair = rec.chair;

    if (rec.talk) {
      // The pre-2026 sheet layout wrote "Session Chair: X" as an event row
      // and embedded authors in the title as "… by A, B and C". Normalize
      // both — absorb the chair, split the byline into People — so
      // unmigrated rows render in the current style. Only rows with every
      // event column empty are treated as legacy, so a new-style row whose
      // title happens to contain " by " is never split.
      const legacy = !rec.title && !rec.speakers && !rec.format && !rec.infomd;
      const chairRow = legacy && rec.talk.match(/^(?:session\s+)?chair\s*:\s*(.*)$/i);
      if (chairRow) {
        if (!session.chair && chairRow[1].trim()) session.chair = chairRow[1].trim();
      } else {
        // Displayed title: the Title cell when present, else the Talk cell.
        let title = rec.title || rec.talk;
        let speakers = rec.speakers || '';
        if (legacy) {
          // Split on the last " by "; the tail must parse as names that
          // each start uppercase, so "… by automating triage" stays whole.
          const m = rec.talk.match(/^(.+)\s+by\s+(.+)$/);
          if (m && parsePeople(m[2]).every((name) => /^[A-Z]/.test(name))) {
            title = m[1];
            speakers = m[2];
          }
        }
        session.talks.push({
          title,
          speakers,
          people: parsePeople(speakers),
          formatRaw: rec.format || '',
          format: normalizeFormat(rec.format || ''),
          infoMd: rec.infomd || '',
          doi: rec.doi || '',
          order: rec.order ? parseInt(rec.order, 10) : Number.MAX_SAFE_INTEGER,
          _row: rec._row,
        });
      }
    }
  }

  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, slots]) => {
      const { weekday, label } = dateParts(date);
      return {
        date,
        weekday,
        label,
        slots: [...slots.values()]
          .sort((a, b) => a.start - b.start || a.end - b.end)
          .map((slot) => {
            const sessions = [...slot.sessions.values()]
              .sort((a, b) => roomRank(a.room) - roomRank(b.room) || a._row - b._row)
              .map((s) => ({
                title: s.title,
                type: s.type,
                ...(s.chair ? { chair: s.chair } : {}),
                room: s.room,
                info: s.info,
                plenary: s.type.toLowerCase() === 'plenary',
                muted: s.muted,
                // Sheet row, for tie-breaking room order in the grid view.
                _row: s._row,
                talks: s.talks
                  .sort((a, b) => a.order - b.order || a._row - b._row)
                  .map((t) => {
                    // New fields append only when non-empty so a CSV
                    // without the new columns produces byte-identical
                    // JSON. Underscored keys are internal (render/anchor
                    // plumbing) — the JSON writer strips them.
                    /** @type {{title: string, speakers: string, people?: string[], format?: string, infoMd?: string, doi?: string, href?: string, _format?: (typeof FORMATS)[string], _anchor?: string}} */
                    const talk = { title: t.title, speakers: t.speakers };
                    if (t.people.length) talk.people = t.people;
                    if (t.formatRaw) talk.format = t.formatRaw;
                    if (t.infoMd) talk.infoMd = t.infoMd;
                    if (t.doi) talk.doi = t.doi;
                    if (t.format && t.format.slug) talk._format = t.format;
                    return talk;
                  }),
              }));
            return {
              start: fmtTime(slot.start),
              end: fmtTime(slot.end),
              startISO: fmtISO(date, slot.start),
              endISO: fmtISO(date, slot.end),
              break: sessions.every((s) => s.muted),
              sessions,
              // Wall-clock minutes for the grid renderer's row lattice.
              _startMins: slot.start,
              _endMins: slot.end,
            };
          }),
      };
    });
}

/** Lowercase, non-alphanumerics -> hyphens, trimmed of hyphens.
 * @param {string} s */
function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Next unique anchor for `base` within `seen` (base -> count so far):
 * the base itself first, then base-2, base-3, …
 * @param {Map<string, number>} seen
 * @param {string} base */
function nextAnchor(seen, base) {
  const n = (seen.get(base) || 0) + 1;
  seen.set(base, n);
  return n === 1 ? base : `${base}-${n}`;
}

/**
 * Sheet-order anchors for the posters page, same slug + dedupe scheme as
 * assignAnchors. Returns the anchor set so Schedule Poster events can be
 * linked to a matching entry.
 * @param {ReturnType<typeof toPosterRecords>} posters
 */
function assignPosterAnchors(posters) {
  const seen = new Map();
  for (const p of posters) p._anchor = nextAnchor(seen, slugify(p.title));
  return new Set(posters.map((p) => p._anchor));
}

/**
 * Assign every page-format event a stable anchor for its abstract-page
 * entry, walking the folded days in schedule traversal order (day -> slot
 * -> room-ranked session -> order-sorted talk) — the same order the pages
 * list entries in, so anchors are deterministic across rebuilds. Anchors
 * are slugified titles, deduplicated per page with -2/-3 suffixes. Events
 * that also carry an Event Description or People get the site-relative
 * deep link the schedule (and program.json) renders — their page entry
 * has an abstract or a byline worth jumping to.
 *
 * Events of a tab-owned format (FORMATS[*].tab) get no entry of their own:
 * they link to the matching Posters-tab entry when the slugified titles
 * agree, else to the page top.
 * @param {ReturnType<typeof fold>} days
 * @param {Set<string>} posterAnchors  anchors on the posters page (empty
 *   when the tab was skipped or had no rows)
 */
function assignAnchors(days, posterAnchors) {
  const used = new Map(); // page slug -> Map(anchor base -> count)
  for (const day of days) {
    for (const slot of day.slots) {
      for (const session of slot.sessions) {
        for (const talk of session.talks) {
          if (!talk._format) continue;
          if (talk._format.tab) {
            const slug = slugify(talk.title);
            talk.href = posterAnchors.has(slug)
              ? `${talk._format.permalink}#${slug}` : talk._format.permalink;
            continue;
          }
          if (!used.has(talk._format.slug)) used.set(talk._format.slug, new Map());
          talk._anchor = nextAnchor(used.get(talk._format.slug), slugify(talk.title));
          if (talk.infoMd || talk.speakers || talk.doi) talk.href = `${talk._format.permalink}#${talk._anchor}`;
        }
      }
    }
  }
}

/**
 * Give every session a stable id for its <article> in the schedule include,
 * so the grid view's cards (and external links) can target it. Same
 * traversal order and dedupe scheme as assignAnchors: base is the weekday
 * plus the slugified title, and repeats across the whole document take
 * -2/-3 suffixes — "Afternoon Tech Session (Workshops / BoFs)" runs in four
 * rooms at once, so its ids are ...-workshops-bofs, -2, -3, -4.
 * @param {ReturnType<typeof fold>} days
 */
function assignSessionIds(days) {
  const seen = new Map(); // id base -> count
  for (const day of days) {
    for (const slot of day.slots) {
      for (const session of slot.sessions) {
        const base = slugify(`${day.weekday}-${session.title}`);
        const n = (seen.get(base) || 0) + 1;
        seen.set(base, n);
        session._sid = n === 1 ? base : `${base}-${n}`;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escape text bound for a Liquid {% capture %} block: HTML-escape plus
 * neutralize "{" so sheet content can never run Liquid tags or filters.
 * kramdown decodes the entities back to literal text when it renders.
 * @param {string} s */
function escLiquid(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;');
}

function renderSession(s, pad) {
  const cls = ['session'];
  if (s.plenary) cls.push('session--plenary');
  if (s.muted) cls.push('session--muted');
  const lines = [`${pad}<article class="${cls.join(' ')}" id="${s._sid}">`];
  const room = s.room && s.room.toLowerCase() !== 'anywhere'
    ? ` <span class="session__room">— ${esc(s.room)}</span>`
    : '';
  lines.push(`${pad}  <h3 class="session__title">${esc(s.title)}${room}</h3>`);
  if (!s.muted && (s.type || s.chair)) {
    const chair = s.chair
      ? `<span class="session__chair">${s.type ? ' · ' : ''}Chair: ${esc(s.chair)}</span>` : '';
    lines.push(`${pad}  <p class="session__eyebrow">${esc(s.type)}${chair}</p>`);
  }
  if (s.info) {
    // Session Description may be Markdown; the include is Liquid-processed
    // when Jekyll renders it, so markdownify does the conversion with the
    // same kramdown as the rest of the site.
    lines.push(`${pad}  <div class="session__info">{% capture session_info_md %}${escLiquid(s.info)}{% endcapture %}{{ session_info_md | markdownify }}</div>`);
  }
  if (s.talks.length) {
    lines.push(`${pad}  <ol class="session__talks">`);
    for (const t of s.talks) {
      // Page formats render a pill; Other/unknown/empty render nothing.
      const pill = t._format
        ? `<span class="talk__format">${esc(t._format.label)}</span> ` : '';
      // assignAnchors set href when the event has a page entry worth
      // jumping to (or a tab-owned page to land on). The include is
      // Liquid-processed when Jekyll renders it, so relative_url keeps the
      // baseurl correct; the fragment, if any, stays outside the filter.
      let title = `<span class="talk__title">${esc(t.title)}</span>`;
      if (t.href) {
        const [page, anchor] = t.href.split('#');
        const frag = anchor ? `#${anchor}` : '';
        title = `<a class="talk__link" href="{{ '${page}' | relative_url }}${frag}">${title}</a>`;
      }
      // People deliberately don't render here — the schedule stays compact;
      // bylines live on the abstract pages (and in program.json).
      lines.push(`${pad}    <li class="talk">${pill}${title}</li>`);
    }
    lines.push(`${pad}  </ol>`);
  }
  lines.push(`${pad}</article>`);
  return lines.join('\n');
}

/**
 * "7:30am–8:30am" reads as "7:30–8:30am": drop the start meridiem when
 * both ends share it. fmtTime output always ends with am/pm.
 * @param {{start: string, end: string, startISO: string, endISO: string}} slot
 */
function fmtRange(slot) {
  const startText = slot.start.slice(-2) === slot.end.slice(-2)
    ? slot.start.slice(0, -2)
    : slot.start;
  return `<time datetime="${slot.startISO}">${startText}</time>–<time datetime="${slot.endISO}">${slot.end}</time>`;
}

function renderHTML(days) {
  const lines = [
    '<!-- Generated by scripts/build-program.js — do not edit by hand.',
    '     Edit the Schedule sheet and re-run the script instead. -->',
    '<div class="program">',
  ];
  lines.push('  <nav class="program-nav" aria-label="Program days">');
  // Decorative for sighted users; the nav's aria-label already names it.
  lines.push('    <span class="program-nav__label" aria-hidden="true">Jump to</span>');
  for (const day of days) {
    lines.push(`    <a class="program-nav__pill" href="#day-${day.weekday.toLowerCase()}">${day.weekday}</a>`);
  }
  lines.push('  </nav>');
  for (const day of days) {
    const id = `day-${day.weekday.toLowerCase()}`;
    lines.push(`  <section class="program-day" id="${id}" aria-labelledby="${id}-title">`);
    // The draft note comes off once the program is final.
    lines.push(`    <h2 class="program-day__title" id="${id}-title">${day.weekday}<span class="program-day__date">, ${day.label}</span><span class="program-day__draft">  (Draft — subject to change)</span></h2>`);
    lines.push('    <ol class="program-day__slots">');
    for (const slot of day.slots) {
      const cls = slot.break ? 'slot slot--break' : 'slot';
      lines.push(`      <li class="${cls}">`);
      lines.push(`        <p class="slot__time">${fmtRange(slot)}</p>`);
      lines.push('        <div class="slot__body">');
      for (const s of slot.sessions) lines.push(renderSession(s, '          '));
      lines.push('        </div>');
      lines.push('      </li>');
    }
    lines.push('    </ol>');
    lines.push('  </section>');
  }
  lines.push('</div>');
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Grid view — one CSS Grid per day: a time rail, one column per room, and
// one row per five minutes, so a session's grid-row places and sizes it
// proportionally with no script. The generator emits counts and positions;
// assets/css/program-grid.css owns the tracks and everything visual.
// ---------------------------------------------------------------------------

// Minutes per grid row. Every sheet time so far sits on :00/:15/:30/:45,
// but parseTime admits any minute, so placement rounds to this lattice;
// displayed times stay exact.
const GRID_STEP = 5;

// Shortest card, in rows: a session whose End cell is empty has end ==
// start and would otherwise draw at zero height.
const GRID_MIN_SPAN = 3;

/**
 * Whole-venue sessions span every room column instead of occupying one:
 * anything muted (a Break/Meal/Registration in a named room still spans,
 * and names the room in its label — so Prefunction never gets a column of
 * nothing but Registration) and anything with no room or "Anywhere".
 * @param {{muted: boolean, room: string}} s
 */
function isBand(s) {
  return s.muted || !s.room || s.room.toLowerCase() === 'anywhere';
}

/**
 * Lay a day out on the row lattice. Rows are 5-minute units counted from
 * dayStart (the earliest start floored to the half hour); minute m maps to
 * grid line 2 + (m - dayStart) / 5 — line 1 opens the header row. Columns
 * are the rooms hosting at least one card that day, in ROOM_ORDER rank and
 * then by first appearance in the sheet.
 * @param {ReturnType<typeof fold>[number]} day
 */
function computeDayGrid(day) {
  const items = [];
  for (const slot of day.slots) {
    for (const session of slot.sessions) items.push({ session, slot });
  }
  const dayStart = Math.floor(Math.min(...items.map((i) => i.slot._startMins)) / 30) * 30;
  const dayEnd = Math.ceil(Math.max(...items.map((i) => i.slot._endMins)) / 30) * 30;
  const toRow = (mins) => 2 + Math.round((mins - dayStart) / GRID_STEP);

  const placed = items.map(({ session, slot }) => {
    const startRow = toRow(slot._startMins);
    const endRow = Math.max(toRow(slot._endMins), startRow + GRID_MIN_SPAN);
    return { session, slot, startRow, endRow, band: isBand(session) };
  });

  // Rooms come from cards only; a room hosting nothing but bands gets no
  // column. Rank first, then the room's earliest sheet row that day.
  const firstRow = new Map();
  for (const p of placed) {
    if (p.band) continue;
    const seen = firstRow.get(p.session.room);
    if (seen === undefined || p.session._row < seen) firstRow.set(p.session.room, p.session._row);
  }
  const rooms = [...firstRow.keys()]
    .sort((a, b) => roomRank(a) - roomRank(b) || firstRow.get(a) - firstRow.get(b));

  return {
    dayStart,
    dayEnd,
    rows: (dayEnd - dayStart) / GRID_STEP,
    toRow,
    rooms,
    bands: placed.filter((p) => p.band),
    cards: placed.filter((p) => !p.band),
  };
}

/**
 * Split same-room overlaps into side-by-side lanes. Cards are swept in
 * start order; a cluster grows while the next card starts before the
 * cluster's running end, and within it each card takes the lowest lane
 * whose last occupant has finished. Every card in a cluster carries the
 * cluster's lane count, so a lone card keeps --lane:0;--lanes:1 (full
 * width) and a pair of overlaps splits the column in two. Overlap is
 * judged on grid rows, so the minimum-span clamp counts.
 * @param {{startRow: number, endRow: number, session: {_row: number}, lane?: number, lanes?: number}[]} cards
 */
function assignLanes(cards) {
  cards.sort((a, b) => a.startRow - b.startRow || a.session._row - b.session._row);
  let cluster = [];
  let laneEnds = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    for (const c of cluster) c.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };
  for (const c of cards) {
    if (c.startRow >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= c.startRow);
    if (lane === -1) lane = laneEnds.push(c.endRow) - 1;
    else laneEnds[lane] = c.endRow;
    c.lane = lane;
    cluster.push(c);
    clusterEnd = cluster.length === 1 ? c.endRow : Math.max(clusterEnd, c.endRow);
  }
  flush();
}

/**
 * A whole-venue band spanning every room column (the column span lives in
 * CSS). The label names the room when the sheet gave one — Lunch in Salon
 * 3 & 4 still spans, but says where — and carries the compact time range.
 * @param {{session: ReturnType<typeof fold>[number]['slots'][number]['sessions'][number], slot: ReturnType<typeof fold>[number]['slots'][number], startRow: number, endRow: number}} b
 * @param {string} pad
 */
function renderGridBand(b, pad) {
  const { session: s, slot } = b;
  const cls = s.muted ? 'grid__band grid__band--muted' : 'grid__band';
  const room = s.room && s.room.toLowerCase() !== 'anywhere'
    ? ` <span class="grid__band-room">— ${esc(s.room)}</span>` : '';
  return [
    `${pad}<div class="${cls}" style="grid-row:${b.startRow}/${b.endRow}">`,
    `${pad}  <p class="grid__band-label">${esc(s.title)}${room} <span class="grid__band-time">${fmtRange(slot)}</span></p>`,
    `${pad}</div>`,
  ];
}

/**
 * One session card: a link to the session's list-view entry wrapping all
 * its text, so the accessible name reads "time, room, title, …" in that
 * order. The room is visually hidden — the column header carries it for
 * sighted readers. Talks are deliberately not listed: a card is only as
 * tall as its slot, and the list entry it links to has them. No Markdown
 * renders here, so plain esc() suffices.
 * @param {{session: ReturnType<typeof fold>[number]['slots'][number]['sessions'][number], slot: ReturnType<typeof fold>[number]['slots'][number], startRow: number, endRow: number, lane: number, lanes: number}} c
 * @param {number} column
 * @param {string} pad
 */
function renderGridCard(c, column, pad) {
  const { session: s, slot } = c;
  const cls = s.plenary ? 'grid__card grid__card--plenary' : 'grid__card';
  const style = `grid-column:${column};grid-row:${c.startRow}/${c.endRow};--lane:${c.lane};--lanes:${c.lanes}`;
  const lines = [`${pad}<a class="${cls}" href="#${s._sid}" style="${style}">`];
  lines.push(`${pad}  <p class="grid__card-time">${fmtRange(slot)}<span class="grid__sr">, ${esc(s.room)}</span></p>`);
  if (s.type || s.chair) {
    const chair = s.chair
      ? `<span class="grid__card-chair">${s.type ? ' · ' : ''}Chair: ${esc(s.chair)}</span>` : '';
    lines.push(`${pad}  <p class="grid__card-eyebrow">${esc(s.type)}${chair}</p>`);
  }
  lines.push(`${pad}  <h3 class="grid__card-title">${esc(s.title)}</h3>`);
  lines.push(`${pad}</a>`);
  return lines;
}

function renderGridHTML(days) {
  const lines = [
    '<!-- Generated by scripts/build-program.js — do not edit by hand.',
    '     Edit the Schedule sheet and re-run the script instead. -->',
    // Hidden until assets/js/program-view.js reveals it, so without
    // JavaScript the page is the list view alone, exactly as before.
    '<div class="program-grid" hidden>',
  ];
  // Own day nav with grid-day-* ids: both views share the DOM, so nothing
  // here may collide with the list's day-* set.
  lines.push('  <nav class="program-grid__nav" aria-label="Program days (grid)">');
  lines.push('    <span class="program-grid__nav-label" aria-hidden="true">Jump to</span>');
  for (const day of days) {
    lines.push(`    <a class="program-grid__pill" href="#grid-day-${day.weekday.toLowerCase()}">${day.weekday}</a>`);
  }
  lines.push('  </nav>');
  for (const day of days) {
    const id = `grid-day-${day.weekday.toLowerCase()}`;
    const g = computeDayGrid(day);
    lines.push(`  <section class="program-grid__day" id="${id}" aria-labelledby="${id}-title">`);
    // The draft note comes off once the program is final (as in renderHTML).
    lines.push(`    <h2 class="program-grid__title" id="${id}-title">${day.weekday}<span class="program-grid__date">, ${day.label}</span><span class="program-grid__draft">  (Draft — subject to change)</span></h2>`);
    // The scroller owns both scroll axes (sticky headers need a vertical
    // scrollport). Focusable and named so keyboards can scroll it too.
    lines.push(`    <div class="program-grid__scroller" tabindex="0" role="region" aria-label="${day.weekday} room grid">`);
    lines.push(`      <div class="grid" style="--grid-cols:${g.rooms.length};--grid-rows:${g.rows}">`);
    lines.push('        <div class="grid__corner"></div>');
    g.rooms.forEach((room, i) => {
      lines.push(`        <div class="grid__room" style="grid-column:${i + 2}">${esc(room)}</div>`);
    });
    // Rail: a rule every half hour (heavier on the hour) and a label per
    // hour spanning down to the next. Decoration to a screen reader —
    // every band and card announces its own times.
    for (let t = g.dayStart; t < g.dayEnd; t += 30) {
      const hour = t % 60 === 0;
      const cls = hour ? 'grid__rule grid__rule--hour' : 'grid__rule';
      lines.push(`        <div class="${cls}" style="grid-row:${g.toRow(t)}" aria-hidden="true"></div>`);
      if (hour) {
        const next = Math.min(t + 60, g.dayEnd);
        lines.push(`        <div class="grid__time" style="grid-row:${g.toRow(t)}/${g.toRow(next)}" aria-hidden="true">${fmtTime(t)}</div>`);
      }
    }
    // Bands first, then cards grouped by room in column order and sorted
    // by start — the reading order for anyone consuming the DOM linearly.
    // Painting follows DOM order too, which is what draws a card above the
    // band it sits inside (the Working Group Fair during lunch).
    for (const b of g.bands) lines.push(...renderGridBand(b, '        '));
    g.rooms.forEach((room, i) => {
      const cards = g.cards.filter((c) => c.session.room === room);
      assignLanes(cards);
      for (const c of cards) lines.push(...renderGridCard(c, i + 2, '        '));
    });
    lines.push('      </div>');
    lines.push('    </div>');
    lines.push('  </section>');
  }
  lines.push('</div>');
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Abstract pages — one Markdown page per event format (Jekyll renders them)
// ---------------------------------------------------------------------------

const ABSTRACTS_DIR = path.join(REPO_ROOT, 'pages', 'program', 'abstracts');

// Marks script-generated files; pruning only ever deletes files carrying it,
// so human-authored pages and the .tbd placeholders are never touched.
const PAGE_BANNER = '<!-- Generated by scripts/build-program.js — do not edit by hand. -->';

/**
 * One row on an abstract page. `meta` is an optional list of links shown on
 * a line after the abstract (the DOI).
 * @typedef {{title: string, people: string, infoMd: string, anchor: string, meta?: {href: string, text: string}[]}} AbstractEntry
 */

/** DOI cell -> absolute URL: already a URL, as given; else a bare DOI.
 * @param {string} doi */
function doiHref(doi) {
  return /^https?:\/\//i.test(doi) ? doi : `https://doi.org/${doi}`;
}

/** Whether an entry has anything to disclose — an abstract or metadata
 * links — and so renders as a collapsible <details>.
 * @param {AbstractEntry} e */
function hasBody(e) {
  return Boolean(e.infoMd.trim() || (e.meta && e.meta.length));
}

/**
 * Group page-format events by page slug, in the same traversal order
 * assignAnchors used — the entry order on each abstract page.
 * @param {ReturnType<typeof fold>} days
 * @returns {Map<string, {format: (typeof FORMATS)[string], entries: AbstractEntry[]}>}
 */
function collectAbstracts(days) {
  const pages = new Map();
  for (const day of days) {
    for (const slot of day.slots) {
      for (const session of slot.sessions) {
        for (const talk of session.talks) {
          // Tab-owned pages are built from their own tab, not from here.
          if (!talk._format || talk._format.tab) continue;
          if (!pages.has(talk._format.slug)) {
            pages.set(talk._format.slug, { format: talk._format, entries: [] });
          }
          /** @type {AbstractEntry} */
          const entry = {
            title: talk.title,
            people: talk.speakers,
            infoMd: talk.infoMd || '',
            anchor: talk._anchor,
          };
          if (talk.doi) entry.meta = [{ href: doiHref(talk.doi), text: talk.doi }];
          pages.get(talk._format.slug).entries.push(entry);
        }
      }
    }
  }
  return pages;
}

/**
 * The heading both entry shapes share. It lives inside <summary> on a
 * collapsible entry, so it stays a single element: <summary>'s content model
 * allows phrasing content or one heading, never two siblings. The heading is
 * also the disclosure control's accessible name, which is why the byline
 * belongs inside it. People is omitted entirely when empty rather than
 * emitted as an empty span.
 *
 * The entry's anchor goes on the heading: the theme's sidebar contents list
 * (_includes/toc.html) reads ids off h2/h3 elements, so this is what makes
 * the page's contents list carry one link per entry. A fragment lands on the heading, which is
 * always visible even when the entry is closed; abstracts.js then opens
 * the enclosing <details>, and the heading's scroll-margin-top clears the
 * navbar.
 * @param {{title: string, people: string, anchor: string}} e
 * @param {string} pad
 */
function renderAbstractHeading(e, pad) {
  const lines = [`${pad}<h2 class="abstract__heading" id="${e.anchor}">`];
  lines.push(`${pad}  <span class="abstract__title">${esc(e.title)}</span>`);
  if (e.people) lines.push(`${pad}  <span class="abstract__people">${esc(e.people)}</span>`);
  lines.push(`${pad}</h2>`);
  return lines;
}

/**
 * One entry: a native <details> disclosure when there is something to
 * reveal — an abstract or a metadata line — and an inert <div> row when
 * there is not: no control should open onto nothing. The anchor lives on
 * the heading (see renderAbstractHeading), not the wrapper.
 *
 * The body reuses the schedule's Liquid-capture pattern (see renderSession):
 * kramdown will not process Markdown inside a block-level HTML element, so
 * markdownify does the conversion, and escLiquid keeps sheet content from
 * running Liquid tags or raw HTML. The metadata line is plain HTML after
 * the capture; with no meta the body is exactly the capture string.
 * @param {AbstractEntry} e
 * @param {string} pad
 */
function renderAbstractEntry(e, pad) {
  if (!hasBody(e)) {
    return [
      `${pad}<div class="abstract abstract--static">`,
      ...renderAbstractHeading(e, `${pad}  `),
      `${pad}</div>`,
    ];
  }
  const body = [];
  if (e.infoMd.trim()) {
    body.push(`{% capture abstract_md %}${escLiquid(e.infoMd)}{% endcapture %}{{ abstract_md | markdownify }}`);
  }
  if (e.meta && e.meta.length) {
    const links = e.meta.map((m) => `<a href="${esc(m.href)}">${esc(m.text)}</a>`).join(' · ');
    body.push(`<p class="abstract__meta">${links}</p>`);
  }
  return [
    `${pad}<details class="abstract">`,
    `${pad}  <summary class="abstract__summary">`,
    ...renderAbstractHeading(e, `${pad}    `),
    `${pad}  </summary>`,
    `${pad}  <div class="abstract__body">${body.join('')}</div>`,
    `${pad}</details>`,
  ];
}

/**
 * @param {(typeof FORMATS)[string]} format
 * @param {AbstractEntry[]} entries
 */
function renderAbstractPage(format, entries) {
  // menubar_toc: the theme's sidebar contents list (as on the Attend and
  // Sponsor pages), one link per entry — the way to copy a link to one.
  const lines = [
    '---',
    'layout: page',
    `title: ${format.pageTitle}`,
    `description: ${format.label} abstracts at USRSE'26`,
    'menubar: program',
    'menubar_toc: true',
    `permalink: ${format.permalink}`,
    'set_last_modified: true',
    '---',
    PAGE_BANNER,
    // The cache-buster is Liquid, not a build-time value, so re-running the
    // generator on unchanged input still produces byte-identical output.
    "<link rel=\"stylesheet\" href=\"{{ site.baseurl }}/assets/css/abstracts.css?v={{ site.time | date: '%s' }}\">",
    '',
    '<div class="abstracts">',
  ];
  // Rendered hidden and revealed by abstracts.js, so without JS the control
  // never appears promising something it cannot do. A page of entries that
  // all lack a body has nothing to expand, so it gets no toolbar at all.
  if (entries.some(hasBody)) {
    lines.push(
      '  <div class="abstracts__toolbar" hidden>',
      '    <button class="abstracts__toggle-all" type="button">Expand all</button>',
      '  </div>');
  }
  for (const e of entries) lines.push(...renderAbstractEntry(e, '  '));
  lines.push('</div>');
  // Deferred: the tag sits at the end of the body, but the theme renders
  // footer-scripts.html after page content — defer keeps ordering predictable.
  lines.push('', '<script src="{{ site.baseurl }}/assets/js/abstracts.js" defer></script>');
  return lines.join('\n') + '\n';
}

/**
 * Posters-tab records -> page entries, the same shape collectAbstracts
 * builds from schedule rows. Links to individual posters come from the
 * page's sidebar contents list, not from the body.
 * @param {ReturnType<typeof toPosterRecords>} posters
 * @returns {AbstractEntry[]}
 */
function posterEntries(posters) {
  return posters.map((p) => {
    /** @type {AbstractEntry} */
    const entry = { title: p.title, people: p.authors, infoMd: p.abstractMd, anchor: p._anchor };
    if (p.doi) entry.meta = [{ href: doiHref(p.doi), text: p.doi }];
    return entry;
  });
}

/**
 * Write one page per active format and prune banner-carrying pages whose
 * format no longer appears in the sheet. Returns the page map for the
 * menubar writer.
 * @param {ReturnType<typeof fold>} days
 * @param {ReturnType<typeof toPosterRecords>|null} posters  null = Posters
 *   tab skipped (offline without --posters-file)
 */
function writeAbstractPages(days, posters) {
  const pages = collectAbstracts(days);
  if (posters && posters.length) {
    pages.set(FORMATS.poster.slug, { format: FORMATS.poster, entries: posterEntries(posters) });
  }
  for (const [slug, { format, entries }] of pages) {
    writeIfChanged(path.join(ABSTRACTS_DIR, `${slug}.md`), renderAbstractPage(format, entries));
  }
  // Tab skipped: keep an existing generated posters page and its menu entry
  // rather than pruning what this run did not rebuild. Registered after the
  // write loop so the marker is never written; a fetched-but-empty tab
  // (posters = []) falls through to pruning like any format that left.
  const postersFile = path.join(ABSTRACTS_DIR, `${FORMATS.poster.slug}.md`);
  if (posters === null && fs.existsSync(postersFile)
      && fs.readFileSync(postersFile, 'utf8').includes(PAGE_BANNER)) {
    pages.set(FORMATS.poster.slug, { format: FORMATS.poster, entries: [] });
  }
  if (fs.existsSync(ABSTRACTS_DIR)) {
    for (const name of fs.readdirSync(ABSTRACTS_DIR)) {
      if (!name.endsWith('.md') || pages.has(name.slice(0, -3))) continue;
      const file = path.join(ABSTRACTS_DIR, name);
      if (fs.readFileSync(file, 'utf8').includes(PAGE_BANNER)) {
        fs.unlinkSync(file);
        console.log(`  removed    ${path.relative(REPO_ROOT, file)}`);
      }
    }
  }
  return pages;
}

// ---------------------------------------------------------------------------
// llms.txt — the program as plain text, for conference attendees' AI agents
//
// Two files, both generated from the same folded days:
//
//   program/llms.txt        every session and talk with times, rooms, people
//                           and links, but no abstract text
//   program/llms-full.txt   the same, with each abstract inlined
//
// They live in a root-level program/ directory rather than under pages/ so
// Jekyll copies them verbatim to _site/program/. A static file is never
// Liquid-processed, which matters here: abstract text comes from the sheet
// and may legitimately contain "{{" or "{%" (renderAbstractEntry has to
// escape exactly that for the HTML pages). Giving these files front matter
// to set a permalink would reintroduce the hazard for no gain.
//
// Everything below reads only the fields program.json also carries — never
// the _-prefixed internals — so renderLlms() can be driven either from a
// fresh fold() or from the committed _data/program.json.
// ---------------------------------------------------------------------------

// Absolute site root: _config.yml's url + baseurl. Agents fetch these files
// on their own, with no site.baseurl to resolve a relative link against, so
// every URL here is absolute.
const SITE_BASE = (() => {
  const origin = configValue('url').replace(/\/+$/, '');
  const base = (JEKYLL.get('baseurl') || '').replace(/^\/+|\/+$/g, '');
  return base ? `${origin}/${base}/` : `${origin}/`;
})();

// Conference facts that live in _config.yml, not in the schedule sheet, and
// are read from it rather than restated here. The dates are in neither place:
// they are derived from the schedule itself below, where they cannot drift.
//
// org and location have no _config.yml key to read. Inventing one to satisfy
// the pattern would put the site's only copy of a fact in a file nothing else
// consults, which is not a single source of truth — it is a second one.
const CONF = {
  name: configValue('title'),
  fullName: configValue('description'),
  org: 'US Research Software Engineer Association (US-RSE)',
  location: 'San Jose, California, USA',
  theme: configValue('conf_theme_short'),
};

const OUT_LLMS = path.join(REPO_ROOT, 'program', 'llms.txt');
const OUT_LLMS_FULL = path.join(REPO_ROOT, 'program', 'llms-full.txt');

/**
 * Sheet-supplied Markdown as a blockquote. Abstracts are authored text: a
 * submitter writing "## Background" is ordinary, and emitted at column 0 it
 * would open a heading at the level this file reserves for conference days,
 * making the abstract's sections parse as days and sessions. Quoting keeps
 * the prose readable, marks plainly where it starts and stops, and keeps
 * every line out of the document's own heading structure. Blank lines become
 * ">" rather than empty, so quoted text never introduces a paragraph break
 * the assembly below would have to reason about.
 */
function quoteBlock(md) {
  // Split on CRLF as well as LF: parseCSV preserves \r verbatim inside a
  // quoted field, so a cell pasted in from Windows would otherwise leave a
  // stray carriage return at the end of every quoted line.
  return String(md).trim().split(/\r?\n/).map((l) => (l.trim() ? `> ${l}` : '>'));
}

/** Collapse whitespace so a value can occupy a single labelled line. */
function oneLine(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

/** Site-relative href from assignAnchors -> absolute URL. */
function absUrl(href) {
  return SITE_BASE + String(href).replace(/^\/+/, '');
}

/**
 * Wall-clock minutes past midnight from an ISO stamp, read by substring
 * rather than by constructing a Date — the reason given at TZ_OFFSET applies
 * here too. Slots are same-day by construction (fold keys them by date), so
 * subtracting two of these is a valid duration.
 */
function isoMinutes(iso) {
  const m = /T(\d\d):(\d\d)/.exec(String(iso));
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/** Greedy word wrap, each line prefixed. Keeps the preamble readable at any
 * terminal width without hand-wrapping interpolated values. */
function wrap(text, width, prefix) {
  const out = [];
  let line = '';
  for (const word of oneLine(text).split(' ')) {
    if (!line) line = word;
    else if (`${line} ${word}`.length + prefix.length <= width) line += ` ${word}`;
    else { out.push(prefix + line); line = word; }
  }
  if (line) out.push(prefix + line);
  return out;
}

/**
 * Which sessions each session actually competes with, keyed by session
 * object. Slots overlap partially — a 10:30–11:30 session runs against a
 * 10:30–12:00 one in a different slot — so this compares every pair within a
 * day by ISO range rather than trusting the slot grouping. Half-open
 * comparison: a session ending at 12:00 does not conflict with one starting
 * at 12:00.
 * @param {{slots: any[]}} day
 */
function concurrencyMap(day) {
  const items = [];
  for (const slot of day.slots) {
    for (const session of slot.sessions) {
      const start = isoMinutes(slot.startISO);
      items.push({
        session,
        start,
        // A row with a blank End cell folds to end === start. Widen that to a
        // one-minute point so it still overlaps whatever is running: under a
        // half-open test an empty interval overlaps nothing, which would
        // print "Concurrent with: nothing" over four parallel tracks.
        end: Math.max(isoMinutes(slot.endISO), start + 1),
        label: sessionLabel(slot, session),
      });
    }
  }
  const map = new Map();
  for (const a of items) {
    map.set(a.session, items
      .filter((b) => b !== a && b.start < a.end && a.start < b.end)
      .map((b) => b.label));
  }
  return map;
}

/**
 * "Student Program Activity (10:30–11:30am, Market Street)". Session titles
 * repeat within a day — Monday already runs two "Student Program Activity"
 * sessions — so a bare title cannot tell a reader which one it means, which
 * is the whole point of naming what a session competes with.
 */
function sessionLabel(slot, session) {
  const where = session.room && session.room.toLowerCase() !== 'anywhere'
    ? `, ${oneLine(session.room)}` : '';
  return `${oneLine(session.title)} (${textRange(slot)}${where})`;
}

/** "7:30am–8:30am" -> "7:30–8:30am", the way fmtRange does it for HTML. */
function textRange(slot) {
  if (slot.startISO === slot.endISO) return slot.start;
  const startText = slot.start.slice(-2) === slot.end.slice(-2)
    ? slot.start.slice(0, -2)
    : slot.start;
  return `${startText}–${slot.end}`;
}

/** Walk every talk in schedule order. */
function eachTalk(days, fn) {
  for (const day of days) {
    for (const slot of day.slots) {
      for (const session of slot.sessions) {
        for (const talk of session.talks) fn(talk, session, slot, day);
      }
    }
  }
}

/** Whether slug.md exists and is one of ours, not a hand-written page. */
function hasGeneratedPage(slug) {
  const file = path.join(ABSTRACTS_DIR, `${slug}.md`);
  return fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(PAGE_BANNER);
}

/**
 * The abstract pages the site has, as [url, title] pairs in FORMATS order.
 *
 * Schedule-driven pages are keyed off the format cell, matching
 * writeAbstractPages' condition for them exactly — keying off talk.href
 * instead would miss a page whose talks are all still titles only, since
 * assignAnchors sets href only once a talk has an abstract or a byline. A
 * format in that state (talks listed before the abstracts land, say) still
 * gets a page and a menubar entry, and this list would have claimed the site
 * had none.
 *
 * A tab-owned format is built from its own tab instead, so no schedule row
 * need carry it at all: posters.md is written, linked from the menubar, and
 * live on the site while the Schedule tab lists no poster events whatsoever.
 * Its generated page file is the one piece of evidence both callers can read
 * — main() writes the abstract pages before rendering these files, and
 * --from-json runs against the committed tree — so both agree on the list,
 * which is what the pull-request check compares.
 */
function abstractPages(days) {
  const seen = new Set();
  eachTalk(days, (talk) => {
    const format = normalizeFormat(talk.format);
    if (format && format.slug) seen.add(format.slug);
  });
  for (const format of Object.values(FORMATS)) {
    if (format.tab && format.slug && hasGeneratedPage(format.slug)) seen.add(format.slug);
  }
  return Object.values(FORMATS)
    .filter((f) => f.slug && seen.has(f.slug))
    .map((f) => [absUrl(f.permalink), f.pageTitle]);
}

/** A wrapped list item: "- " on the first line, continuations hanging-indented. */
function bullet(text) {
  return wrap(text, 78, '  ').map((line, i) => (i === 0 ? `- ${line.slice(2)}` : line));
}

/**
 * Preamble: what this file is, how to read it, and the conference facts an
 * agent needs before it can reason about any of the sessions below.
 * @param {boolean} full
 */
function renderLlmsHeader(days, timezone, full) {
  let sessions = 0;
  let talks = 0;
  let abstracts = 0;
  for (const day of days) {
    for (const slot of day.slots) {
      sessions += slot.sessions.length;
    }
  }
  eachTalk(days, (talk) => {
    talks += 1;
    if (talk.infoMd && talk.infoMd.trim()) abstracts += 1;
  });

  const first = days[0];
  const last = days[days.length - 1];
  const year = first.date.slice(0, 4);
  // "October 19–21, 2026" when the run stays in one month, "October 31 –
  // November 2, 2026" when it does not.
  const firstMonth = first.label.split(' ')[0];
  const lastMonth = last.label.split(' ')[0];
  let dates;
  if (first === last) dates = `${first.label}, ${year}`;
  else if (firstMonth === lastMonth) dates = `${first.label}–${last.label.split(' ')[1]}, ${year}`;
  else dates = `${first.label} – ${last.label}, ${year}`;

  const other = full
    ? ['Abstracts are included below, inline, for every talk that has published'
       + ' one. For a smaller file carrying the same schedule without abstract'
       + ' text, fetch:', `${SITE_BASE}program/llms.txt`]
    : ['Abstract text is not in this file. For the same schedule with every'
       + ' published abstract inlined, fetch:', `${SITE_BASE}program/llms-full.txt`];

  const lines = [
    `# ${CONF.name} — Program`,
    '',
    ...wrap(
      `The complete program for ${CONF.name} (${CONF.fullName}), the annual `
      + `conference of the ${CONF.org}, held ${dates} in ${CONF.location}. `
      + `Theme: "${CONF.theme}". ${days.length} days, ${sessions} sessions, `
      + `${talks} talks (${abstracts} with published abstracts). All times are `
      + `US Pacific (UTC${timezone}).`, 78, '> '),
    '',
    ...wrap('This file is generated from the conference schedule and changes only'
      + ' when the schedule does. The program is not final and is subject to'
      + ' change — check the program page for the authoritative current version.',
    78, ''),
    '',
    '## How to use this file',
    '',
    ...bullet('Every session carries both a wall-clock time and an ISO 8601'
      + ' range. Prefer the ISO range for anything you compute.'),
    ...bullet('Sessions are listed in chronological order within each day, and'
      + ' each one lists the sessions it runs against under "Concurrent with" —'
      + ' that is the choice to resolve when picking between parallel tracks.'),
    ...bullet('Breaks, meals and registration are listed too. They are not'
      + ' filler: they are the gaps an attendee schedule is built around.'),
    ...bullet('Talk titles link to that talk\'s entry on its abstract page.'),
    ...bullet(other[0]),
    `  ${other[1]}`,
    '',
    `Human-readable program page: ${SITE_BASE}program/`,
    '',
    '## Conference pages',
    '',
  ];
  for (const [url, title] of [
    [`${SITE_BASE}`, `${CONF.name} home`],
    [`${SITE_BASE}program/`, 'Full program (this schedule, as a web page)'],
    ...abstractPages(days).map(([u, t]) => [u, `${t} — abstracts`]),
    [`${SITE_BASE}attend/`, 'Attending: overview'],
    [`${SITE_BASE}attend/registration/`, 'Registration'],
    [`${SITE_BASE}attend/travel/`, 'Travel and venue'],
    [`${SITE_BASE}attend/local-info/`, 'Things to do in San Jose'],
    [`${SITE_BASE}attend/financial-support/`, 'Financial support'],
    [`${SITE_BASE}about/code-of-conduct/`, 'Code of conduct'],
  ]) {
    lines.push(`- ${url} — ${title}`);
  }
  lines.push('');
  return lines;
}

/**
 * One talk as a bullet in the index file: title, format, people, link.
 * @param {string} pad
 */
function renderLlmsTalkBrief(talk, pad) {
  const bits = [`"${oneLine(talk.title)}"`];
  if (talk.format) bits.push(`(${oneLine(talk.format)})`);
  const line = [`${pad}- ${bits.join(' ')}`];
  if (talk.speakers) line.push(`${pad}  Presenters: ${oneLine(talk.speakers)}`);
  if (talk.href) line.push(`${pad}  ${absUrl(talk.href)}`);
  return line;
}

/**
 * One talk as its own block in the full file, abstract included. The abstract
 * goes through quoteBlock: it is author-written Markdown, so emitting it at
 * column 0 would let a submitter's "## Background" open a heading at the level
 * this file reserves for conference days.
 */
function renderLlmsTalkFull(talk) {
  const lines = ['', `#### ${oneLine(talk.title)}`, ''];
  const beforeFields = lines.length;
  if (talk.format) lines.push(`- Format: ${oneLine(talk.format)}`);
  if (talk.speakers) lines.push(`- Presenters: ${oneLine(talk.speakers)}`);
  if (talk.href) lines.push(`- Abstract page: ${absUrl(talk.href)}`);
  if (talk.infoMd && talk.infoMd.trim()) {
    // Only separate from the bullets when there were any: a talk still
    // missing its Event Format and People cells emits none, and the heading
    // above already left a blank line behind it.
    if (lines.length > beforeFields) lines.push('');
    lines.push('Abstract:', '', ...quoteBlock(talk.infoMd));
  } else {
    lines.push('- Abstract: not yet published');
  }
  return lines;
}

/**
 * One session: labelled fields, then its talks.
 * @param {string[]} concurrent titles of the sessions this one runs against
 */
function renderLlmsSession(slot, session, concurrent, full) {
  const lines = [`### ${textRange(slot)} — ${oneLine(session.title)}`, ''];
  const mins = isoMinutes(slot.endISO) - isoMinutes(slot.startISO);
  // A blank End cell folds to end === start; say so rather than claim 0 min.
  lines.push(mins > 0
    ? `- Time: ${slot.startISO} to ${slot.endISO} (${mins} min)`
    : `- Time: ${slot.startISO} (end time not published)`);
  // "Anywhere" means the whole venue; renderSession suppresses it too.
  if (session.room && session.room.toLowerCase() !== 'anywhere') {
    lines.push(`- Room: ${oneLine(session.room)}`);
  }
  if (session.type) lines.push(`- Type: ${oneLine(session.type)}`);
  if (session.plenary) lines.push('- Plenary: yes');
  if (session.chair) lines.push(`- Chair: ${oneLine(session.chair)}`);
  // Computed from the ISO ranges rather than asserted: whether a plenary or
  // anything else has competition is a fact about the sheet, not a rule.
  // One line, not a nested list: the talks below are the only nested list in
  // the file, so "  - " unambiguously means a talk. A second nested list here
  // would share that marker and a parser not tracking which field it sits
  // under would read concurrent sessions as talks.
  lines.push(concurrent.length
    ? `- Concurrent with: ${concurrent.join('; ')}`
    : '- Concurrent with: nothing (the only session at this time)');
  if (session.info && session.info.trim()) {
    // Collapsed to a line in the index, kept whole in the full file — the
    // same split the two files make for abstracts.
    if (full) lines.push('', 'About this session:', '', ...quoteBlock(session.info));
    else lines.push(`- About: ${oneLine(session.info)}`);
  }
  if (session.talks.length) {
    if (full) {
      for (const talk of session.talks) lines.push(...renderLlmsTalkFull(talk));
    } else {
      lines.push(`- Talks (${session.talks.length}):`);
      for (const talk of session.talks) lines.push(...renderLlmsTalkBrief(talk, '  '));
    }
  }
  return lines;
}

/**
 * @param {ReturnType<typeof fold>} days
 * @param {string} timezone UTC offset the ISO stamps carry, e.g. "-07:00"
 * @param {{full: boolean}} opts
 */
function renderLlms(days, timezone, { full }) {
  const lines = renderLlmsHeader(days, timezone, full);
  for (const day of days) {
    const concurrent = concurrencyMap(day);
    lines.push(`## ${day.weekday}, ${day.label}, ${day.date.slice(0, 4)}`, '');
    for (const slot of day.slots) {
      for (const session of slot.sessions) {
        // The separator is added here, at the join, rather than inside the
        // block: a blank line is the assembly's business, and collapsing
        // them afterwards with a global regex would rewrite quoted abstract
        // text this generator does not own.
        lines.push(...renderLlmsSession(slot, session, concurrent.get(session) || [], full), '');
      }
    }
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

// ---------------------------------------------------------------------------
// Program menubar — script-managed while abstract pages exist
// ---------------------------------------------------------------------------

// The live menubar (menubar.html reads _data/menus/<name>, never hidden/).
// _data/menus/hidden/program.yml stays untouched as the human-owned seed.
const OUT_MENU = path.join(REPO_ROOT, '_data', 'menus', 'program.yml');

const MENU_BANNER = '# Generated by scripts/build-program.js — do not edit by hand.';

/**
 * Emit the program menubar linking every abstract page, Full Program
 * first, formats in vocabulary order. With no abstract pages (e.g. a CSV
 * without the new columns) a banner-carrying file is deleted instead, so
 * the menu reverts to its hidden state and a legacy build never creates it.
 * @param {ReturnType<typeof writeAbstractPages>} pages
 */
function writeMenubar(pages) {
  if (!pages.size) {
    if (fs.existsSync(OUT_MENU) && fs.readFileSync(OUT_MENU, 'utf8').includes(MENU_BANNER)) {
      fs.unlinkSync(OUT_MENU);
      console.log(`  removed    ${path.relative(REPO_ROOT, OUT_MENU)}`);
    }
    return;
  }
  const lines = [
    MENU_BANNER,
    '- label: Program',
    '  items:',
    '    - name: Full Program',
    '      link: program/',
  ];
  for (const format of Object.values(FORMATS)) {
    if (format.slug && pages.has(format.slug)) {
      lines.push(`    - name: ${format.pageTitle}`, `      link: ${format.permalink}`);
    }
  }
  writeIfChanged(OUT_MENU, lines.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** Value following a `--flag`, or null when the flag is absent. */
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  const v = process.argv[i + 1];
  if (!v || v.startsWith('--')) throw new Error(`${flag} requires a path`);
  return v;
}

/** One tab of the program spreadsheet, via the gviz CSV export endpoint. */
async function fetchSheet(sheetName) {
  if (!SHEET_ID) {
    throw new Error(
      'PROGRAM_SHEET_ID is not set. Export the sheet ID as an environment '
      + 'variable, or run with --file fixtures/schedule.csv.');
  }
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  console.log(`Fetching "${sheetName}" tab from Google Sheets…`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`"${sheetName}" tab fetch failed: HTTP ${res.status}`);
  return res.text();
}

/** Schedule tab: the --file path when given, else the live sheet. */
async function loadScheduleCSV() {
  const file = argValue('--file');
  if (file) {
    console.log(`Reading ${file}`);
    return fs.readFileSync(path.resolve(file), 'utf8');
  }
  return fetchSheet(SHEET_NAME);
}

/**
 * Posters tab: the --posters-file path when given; null (skipped) when the
 * schedule came from a file and no posters file was given, so an offline
 * build never needs the network; else the live sheet.
 */
async function loadPostersCSV() {
  const file = argValue('--posters-file');
  if (file) {
    console.log(`Reading ${file}`);
    return fs.readFileSync(path.resolve(file), 'utf8');
  }
  if (argValue('--file')) {
    console.log('No --posters-file — skipping posters.');
    return null;
  }
  return fetchSheet(POSTERS_SHEET_NAME);
}

/** Write only when content changed so a scheduled runner commits no churn. */
function writeIfChanged(file, content) {
  const rel = path.relative(REPO_ROOT, file);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) {
    console.log(`  unchanged  ${rel}`);
    return false;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log(`  wrote      ${rel}`);
  return true;
}

/**
 * Rewrite only the llms files, reading the committed _data/program.json
 * instead of the sheet. program.json carries no _-prefixed internals, so the
 * HTML includes, abstract pages and menubar cannot be rebuilt from it — but
 * renderLlms reads public fields only, which is exactly what makes this
 * possible. The pull-request check runs this and fails if anything changed,
 * proving the committed llms files still match the committed schedule.
 */
function mainFromJson() {
  if (!fs.existsSync(OUT_JSON)) {
    throw new Error(`${path.relative(REPO_ROOT, OUT_JSON)} does not exist.`);
  }
  console.log(`Reading ${path.relative(REPO_ROOT, OUT_JSON)}`);
  const { days, timezone } = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
  if (!Array.isArray(days) || !days.length) {
    throw new Error('program.json has no days — refusing to write empty files.');
  }
  writeIfChanged(OUT_LLMS, renderLlms(days, timezone, { full: false }));
  writeIfChanged(OUT_LLMS_FULL, renderLlms(days, timezone, { full: true }));
}

async function main() {
  if (process.argv.includes('--from-json')) return mainFromJson();
  const csv = await loadScheduleCSV();
  const postersCsv = await loadPostersCSV();
  const records = toRecords(parseCSV(csv));
  if (!records.length) throw new Error('No schedule rows found — check the sheet.');
  const posters = postersCsv === null ? null : toPosterRecords(parseCSV(postersCsv));
  const posterAnchors = posters ? assignPosterAnchors(posters) : new Set();
  const days = fold(records);
  assignAnchors(days, posterAnchors);
  assignSessionIds(days);

  const sessionCount = days.reduce(
    (n, d) => n + d.slots.reduce((m, s) => m + s.sessions.length, 0), 0);
  console.log(`Parsed ${records.length} rows -> ${days.length} days, ${sessionCount} sessions.`);
  console.log(posters ? `Parsed ${posters.length} poster rows.` : 'Posters skipped.');

  writeIfChanged(OUT_HTML, renderHTML(days));
  writeIfChanged(OUT_GRID, renderGridHTML(days));
  // Underscored keys are internal plumbing — program.json carries text only.
  writeIfChanged(OUT_JSON, JSON.stringify(
    { timezone: TZ_OFFSET, days },
    (key, value) => (key.startsWith('_') ? undefined : value), 2) + '\n');
  writeMenubar(writeAbstractPages(days, posters));
  writeIfChanged(OUT_LLMS, renderLlms(days, TZ_OFFSET, { full: false }));
  writeIfChanged(OUT_LLMS_FULL, renderLlms(days, TZ_OFFSET, { full: true }));
}

main().catch((err) => {
  console.error(`build-program: ${err.message}`);
  process.exit(1);
});
