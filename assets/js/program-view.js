/* ==========================================================================
   USRSE'26 program page — List / Grid view switch
   Drives the toolbar hand-authored in pages/program/program.md over the two
   generated includes (_includes/program-schedule.html, the list, and
   _includes/program-grid.html, the room grid).

   Both views ship in the DOM; the grid and the toolbar carry `hidden`, so
   with JavaScript off the page is the list alone and nothing here is
   missed. This file adds the three things that need a script:

     1. the view switch itself, remembered in localStorage,
     2. card clicks, which switch to the list and jump to the entry — and
        put the grid back when the reader presses Back,
     3. the ellipsis on card titles that do not fit their card.

   Dependency-free on purpose: the site's jQuery/Bootstrap bundle loads
   after this script and has nothing to offer it.
   ========================================================================== */

(function () {
  'use strict';

  var toolbar = document.querySelector('.program-toolbar');
  var list = document.querySelector('.program');
  var grid = document.querySelector('.program-grid');
  if (!toolbar || !list || !grid) return;

  var viewButtons = toolbar.querySelectorAll('.program-toolbar__view');

  var KEY_VIEW = 'usrse26:program-view';

  // localStorage throws in some private modes and when site data is
  // blocked; the switch still works, the choice just lasts the page view.
  function store(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* no-op */ }
  }
  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  // ------------------------------------------------------------------
  // 3. Card titles — clamp to the lines that fit, with an ellipsis
  // ------------------------------------------------------------------

  // A card is exactly as tall as its slot, so a long title in a short
  // session would be sliced mid-line by the card's overflow: hidden.
  // Measure what is left below the time and eyebrow and let
  // -webkit-line-clamp end the last fitting line with "…". Runs whenever
  // the grid becomes visible (hidden elements have no layout) and on
  // resize, since the breakpoints change the type size.
  function clampTitles() {
    if (grid.hidden) return;
    Array.prototype.forEach.call(grid.querySelectorAll('.grid__card-title'), function (title) {
      var card = title.parentNode;
      var cs = getComputedStyle(card);
      var avail = card.clientHeight - parseFloat(cs.paddingBottom) - title.offsetTop;
      var lineHeight = parseFloat(getComputedStyle(title).lineHeight);
      var lines = Math.max(1, Math.floor(avail / lineHeight));
      title.style.webkitLineClamp = String(lines);
    });
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(clampTitles, 100);
  });

  // ------------------------------------------------------------------
  // 1. List / Grid
  // ------------------------------------------------------------------

  // Two `hidden` swaps plus button state — no classes on the views, so
  // print and the no-JS page fall out of the same attribute. Exactly one
  // view is visible at a time.
  function setView(view) {
    var showGrid = view === 'grid';
    list.hidden = showGrid;
    grid.hidden = !showGrid;
    Array.prototype.forEach.call(viewButtons, function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === view));
    });
    store(KEY_VIEW, view);
    clampTitles();
  }

  // Stamp the current history entry with the view the reader chose, so a
  // later Back that lands on this entry restores what they were looking
  // at — not what an earlier card click recorded for it. Merged, not
  // replaced: SmoothScroll keeps its own record on the same entry, and
  // that record is what scrolls the page back to where it was.
  function recordView(view) {
    history.replaceState(Object.assign({}, history.state, { programView: view }), '');
  }

  Array.prototype.forEach.call(viewButtons, function (b) {
    b.addEventListener('click', function () {
      var view = b.getAttribute('data-view');
      setView(view);
      recordView(view);
    });
  });

  // ------------------------------------------------------------------
  // 2. Card clicks — switch to the list, jump to the entry, keep Back
  // ------------------------------------------------------------------

  // A card's href is the id of its <article> in the list, which is hidden
  // while the grid shows, so the list must come back before anything
  // scrolls. The jump is a pushed history entry that records the view, and
  // the entry we leave is stamped with the grid, so Back restores the grid
  // (and Forward the list) instead of dropping the reader on a list they
  // never chose — or off the page. scrollIntoView does the scroll itself
  // (pushState never scrolls); .session's scroll-margin-top clears the
  // fixed navbar. stopPropagation keeps app.js's SmoothScroll (one
  // delegated listener on document, bubble phase) from seeing the click
  // and animating toward a target that was hidden when it measured it.
  // Day-pill clicks are deliberately left alone: their targets are visible
  // whenever the pills are, so SmoothScroll gives them the same animated,
  // navbar-offset scroll the list's pills get.
  grid.addEventListener('click', function (e) {
    var card = e.target.closest('a.grid__card');
    if (!card) return;
    e.preventDefault();
    e.stopPropagation();
    var id = card.getAttribute('href').slice(1);
    var el = document.getElementById(id);
    if (!el) return;
    recordView('grid');
    history.pushState({ programView: 'list' }, '', '#' + id);
    setView('list');
    el.scrollIntoView();
  });

  // Landing on an entry this script stamped: restore its view, then put
  // the page where the entry says. SmoothScroll animates entries carrying
  // its own record (day pills, and the initial entry when it was still
  // unstamped at the first pill click), so those are left to it; the rest
  // — a stamped initial entry, a card jump — scroll to their hash target
  // or, with no hash, to the top.
  window.addEventListener('popstate', function () {
    var state = history.state;
    if (!state || !state.programView) return;
    setView(state.programView);
    if (state.smoothScroll) return;
    var target = location.hash && document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
  });

  // ------------------------------------------------------------------
  // Init
  // ------------------------------------------------------------------

  // The toolbar is rendered hidden, so it never appears on a page where
  // this script didn't run. Default view is the list, so first paint
  // never flashes. A history entry that recorded a view (a reload after a
  // card jump, say) wins over the stored preference for that entry.
  toolbar.hidden = false;
  var initial = history.state && history.state.programView;
  setView(initial || (read(KEY_VIEW) === 'grid' ? 'grid' : 'list'));
})();
