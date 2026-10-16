/* Explicit snapshot export only. No ingestion, calendar writes, or shift mutation. */
(function (root) {
  'use strict';
  function wall(value, zone) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
    if (!match) throw new Error('Use full ISO start/end datetimes, including the end date.');
    const nums = match.slice(1, 7).map(x => Number(x || 0));
    const [y, m, d, h, min, sec] = nums;
    const base = Date.UTC(y, m - 1, d, h, min, sec);
    const check = new Date(base);
    if (y < 1900 || check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 ||
        check.getUTCDate() !== d || h > 23 || min > 59 || sec > 59) throw new Error('Invalid shift date/time.');
    const formatter = new Intl.DateTimeFormat('en-US', {timeZone: zone, year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'});
    function parts(ms) {
      const p = Object.fromEntries(formatter.formatToParts(new Date(ms)).map(p => [p.type, p.value]));
      return [p.year, p.month, p.day, p.hour, p.minute, p.second].map(Number);
    }
    function same(ms) { return parts(ms).every((v, i) => v === nums[i]); }
    if (match[7]) {
      const ms = Date.parse(value);
      if (!Number.isFinite(ms) || !same(ms)) throw new Error('The shift offset does not match its timezone.');
      return ms;
    }
    const candidates = new Set();
    for (let hours = -36; hours <= 36; hours += 6) {
      const probe = base + hours * 3600000, p = parts(probe);
      const offset = Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4], p[5]) - probe;
      const candidate = base - offset;
      if (same(candidate)) candidates.add(candidate);
    }
    if (candidates.size !== 1) throw new Error('Ambiguous or nonexistent daylight-saving time. Use a valid explicit offset.');
    return [...candidates][0];
  }
  function build(shifts, metadata) {
    if (!Array.isArray(shifts) || shifts.length > 10000) throw new Error('Invalid shift count.');
    const ids = new Set();
    const rows = shifts.map(s => {
      for (const [key, limit] of [['id', 200], ['title', 500], ['details', 4000], ['colorCode', 40]]) {
        if (typeof s[key] !== 'string' || s[key].length > limit || (['id', 'title'].includes(key) && !s[key].trim()))
          throw new Error('Missing or invalid shift ' + key + '. No IDs are generated during export.');
      }
      if (ids.has(s.id)) throw new Error('Duplicate shift ID. Resolve it in Schedule Sync first.');
      ids.add(s.id);
      if (typeof s.start !== 'string' || typeof s.end !== 'string' || wall(s.end, metadata.source_timezone) <= wall(s.start, metadata.source_timezone))
        throw new Error('End must follow start; include the actual end date for overnight work.');
      return {id: s.id, type: 'work_shift', title: s.title, details: s.details, colorCode: s.colorCode, start: s.start, end: s.end};
    });
    // Validate the timezone even for a complete empty snapshot.
    new Intl.DateTimeFormat('en-US', {timeZone: metadata.source_timezone}).format();
    const snapshot = {schema_version: 1, source: 'schedule-sync', ...metadata, complete: true, shifts: rows};
    if (new TextEncoder().encode(JSON.stringify(snapshot)).length > 5 * 1024 * 1024) throw new Error('Export exceeds 5 MiB.');
    return snapshot;
  }
  const api = {build, wall};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CreativeOSExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
