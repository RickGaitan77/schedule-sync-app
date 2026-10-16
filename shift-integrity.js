/* Validate inputs without repairing, normalizing or persisting source records. */
(function (root) {
  'use strict';
  function fail(field, message) { const error = new Error(message); error.field = field; throw error; }
  function date(year, month, day) {
    if (![year, month, day].every(Number.isInteger) || year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31)
      fail('date', 'Invalid calendar date.');
    const value = new Date(Date.UTC(year, month - 1, day));
    if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day)
      fail('date', 'Impossible month/day combination.');
    return value;
  }
  function clock(hour, minute, period) {
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59 ||
        hour < (period ? 1 : 0) || hour > (period ? 12 : 23)) fail('time', 'Invalid hour or minute; use 00–23 and 00–59 (1–12 with AM/PM).');
  }
  function parse(value) {
    if (typeof value !== 'string') fail('time', 'Start/end must be full ISO date/time strings.');
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
    if (!m) fail('time', 'Invalid full ISO date/time structure.');
    const [year, month, day, hour, minute, second] = m.slice(1, 7).map(n => Number(n || 0));
    date(year, month, day); clock(hour, minute);
    if (second > 59) fail('time', 'Invalid seconds.');
    const local = Date.UTC(year, month - 1, day, hour, minute, second);
    if (!m[7]) return {instant: local, offset: false};
    const instant = Date.parse(value);
    if (!Number.isFinite(instant)) fail('time', 'Invalid UTC offset.');
    return {instant, offset: true};
  }
  function validate(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) fail('record', 'Shift must be an object.');
    if (typeof record.id !== 'string' || !record.id.trim()) fail('id', 'Shift ID is missing.');
    if (typeof record.title !== 'string' || !record.title.trim()) fail('title', 'Shift title is missing.');
    let start, end;
    try { start = parse(record.start); } catch (error) { error.field = 'start'; throw error; }
    try { end = parse(record.end); } catch (error) { error.field = 'end'; throw error; }
    if (start.offset !== end.offset) fail('interval', 'Use consistent local times or explicit offsets for both endpoints.');
    if (end.instant <= start.instant) fail('interval', 'End must be later than start. Overnight work requires its actual following end date.');
    return record;
  }
  function inspect(records) {
    if (!Array.isArray(records)) return [{index: 0, record: records, field: 'schedule', reason: 'Stored schedule is not an array.'}];
    const issues = [], seen = new Set();
    records.forEach((record, index) => {
      try {
        validate(record);
        if (seen.has(record.id)) fail('id', 'Duplicate shift ID.');
      } catch (error) { issues.push({index, record, field: error.field, reason: error.message}); }
      if (record && typeof record.id === 'string') seen.add(record.id);
    });
    return issues;
  }
  function problem(issue, heading = 'Schedule record needs attention') {
    const record = issue.record;
    const error = new Error(`${heading}\nItem ${issue.index + 1}\nID: ${JSON.stringify(record?.id)}\nTitle: ${JSON.stringify(record?.title)}\nStart: ${JSON.stringify(record?.start)}\nEnd: ${JSON.stringify(record?.end)}\nProblem: ${issue.field} — ${issue.reason}`);
    error.problemShift = {id: record?.id, record}; return error;
  }
  function readStorage(storage) {
    const keys = ['vet_shifts_backup', 'schedule_sync_shifts'];
    const copies = keys.map(key => {
      const raw = storage.getItem(key);
      if (raw === null) return {key, raw, records: null};
      try {
        const records = JSON.parse(raw);
        if (!Array.isArray(records)) throw new Error('Stored schedule is not an array.');
        return {key, raw, records};
      } catch (error) { return {key, raw, records: null, error: error.message}; }
    });
    const selected = copies.find(copy => copy.raw !== null);
    const warnings = copies.filter(copy => copy.error).map(copy => copy.key + ': ' + copy.error);
    const present = copies.filter(copy => copy.raw !== null);
    if (present.length === 2 && !warnings.length && JSON.stringify(present[0].records) !== JSON.stringify(present[1].records))
      warnings.push('The two stored schedule copies differ. Both are preserved; saves are blocked until reviewed.');
    return {records: selected?.records || [], copies, warnings, blocked: warnings.length > 0};
  }
  const api = {date, clock, parse, validate, inspect, problem, readStorage};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScheduleIntegrity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
