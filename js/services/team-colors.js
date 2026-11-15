/*
 * SBL TEAM COLOURS (CP4.63)
 *
 * Admin assigns one colour per team; it is stored per season in
 * settings.teamColors = { "<team name>": "#rrggbb" }. Pages only ever READ it
 * through this module and apply it as a CSS custom property (--team-color),
 * which the stylesheet turns into faint highlights. Team lookups are
 * case/whitespace-insensitive, like the rest of the site.
 *
 * Also resolves a team's owner usernames from the season's teamMap
 * (username -> team name) so pages can show usernames beside franchise names.
 */
(function () {
  'use strict';
  window.SBL = window.SBL || {};
  const key = s => String(s ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');

  function normalizeColor(v) {
    const t = String(v ?? '').trim();
    let m = /^#?([0-9a-f]{6})$/i.exec(t);
    if (m) return '#' + m[1].toLowerCase();
    m = /^#?([0-9a-f]{3})$/i.exec(t);
    if (m) { const [a, b, c] = m[1]; return ('#' + a + a + b + b + c + c).toLowerCase(); }
    return '';
  }
  function get(settings, team) {
    const map = settings && settings.teamColors;
    if (!map || typeof map !== 'object') return '';
    const k = key(team);
    if (!k) return '';
    for (const [name, c] of Object.entries(map)) if (key(name) === k) return normalizeColor(c);
    return '';
  }
  /* ` style="--team-color:#rrggbb"` (leading space) or '' when no colour is set. */
  function styleAttr(settings, team) {
    const c = get(settings, team);
    return c ? ` style="--team-color:${c}"` : '';
  }
  /* Sets (or, with an empty/invalid colour, clears) a team's colour in place. */
  function set(settings, team, color) {
    if (!settings.teamColors || typeof settings.teamColors !== 'object') settings.teamColors = {};
    const k = key(team);
    for (const name of Object.keys(settings.teamColors)) if (key(name) === k) delete settings.teamColors[name];
    const c = normalizeColor(color);
    if (c) settings.teamColors[String(team).trim()] = c;
    return settings.teamColors;
  }
  const PALETTE = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#2bb5c9', '#d2a800', '#f032e6', '#7ab800', '#008080', '#9a6324', '#808000', '#e8707a', '#5b6bdc', '#00a86b', '#b5651d'];
  /* Fills teams that have no colour yet with distinct palette colours; never overwrites. */
  function autoAssign(settings, teams) {
    let i = 0;
    const used = new Set((teams || []).map(t => get(settings, t)).filter(Boolean));
    (teams || []).forEach(t => {
      if (get(settings, t)) return;
      let c = PALETTE[i % PALETTE.length];
      for (let n = 0; n < PALETTE.length && used.has(c); n++) c = PALETTE[(++i) % PALETTE.length];
      used.add(c); i++;
      set(settings, t, c);
    });
    return settings.teamColors || {};
  }
  function usernamesFor(teamMap, team) {
    const k = key(team);
    if (!k) return [];
    return Object.entries(teamMap || {}).filter(([, t]) => key(t) === k).map(([u]) => u).sort((a, b) => a.localeCompare(b));
  }
  /* "alice" or "alice / bob" (co-owners), or '' when no username is linked. */
  function ownerLabel(teamMap, team) { return usernamesFor(teamMap, team).join(' / '); }
  /* Black or white, whichever reads better on `hex`. */
  function readableOn(hex) {
    const c = normalizeColor(hex);
    if (!c) return '#fff';
    const [r, g, b] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? '#000' : '#fff';
  }
  window.SBL.teamColors = { key, normalizeColor, get, styleAttr, set, autoAssign, usernamesFor, ownerLabel, readableOn, PALETTE };
})();
