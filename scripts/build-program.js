#!/usr/bin/env node
/**
 * build-program.js — build the USRSE'26 program pages from the program sheet.
 *
 * Pulls two tabs of the program Google Sheet via its CSV export endpoint.
 * The "Schedule" tab is folded into days -> time slots -> sessions ->
 * events; the "Posters" tab is a flat list of accepted posters. Together
 * they produce five kinds of artifact:
 *
 *   _includes/program-schedule.html   Jekyll include rendered on the program page
 *   _includes/program-grid.html       room x time grid view of the same page
 *   _data/program.json                normalized schedule data (site.data.program)
 *   pages/program/abstracts/<slug>.md one page per event format (abstracts);
 *                                     posters.md comes from the Posters tab
 *   _data/menus/program.yml           program menubar linking those pages
 *
 * The sheet stays the only thing anyone edits. Requires Node 18+ (global
 * fetch); zero dependencies.
 *
 *   PROGRAM_SHEET_ID=<id> node scripts/build-program.js    # live from Sheets
 *   node scripts/build-program.js --file fixtures/schedule.csv \
 *                                 --posters-file fixtures/posters.csv   # offline
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

// ID of the program spreadsheet (the long token in its docs.google.com URL).
// Deliberately kept out of the repo: it must come from the PROGRAM_SHEET_ID
// environment variable (a repository secret in CI). Offline builds with
// --file need no ID at all.
const SHEET_ID = process.env.PROGRAM_SHEET_ID || '';
const SHEET_NAME = 'Schedule';
const POSTERS_SHEET_NAME = 'Posters';

// Sheet dates are "M/DD" with no year.
const CONF_YEAR = 2026;

// All program times are wall-clock US Pacific. Never construct JS Date
// objects from them — a runner in UTC would shift 8:30am to a different day.
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

const REPO_ROOT = path.join(__dirname, '..');
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
}

main().catch((err) => {
  console.error(`build-program: ${err.message}`);
  process.exit(1);
});
