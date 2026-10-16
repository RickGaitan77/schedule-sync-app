const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const {build} = require('./creative-os-export.js');
const metadata = {source_instance_id: '11111111-1111-4111-8111-111111111111', snapshot_id: '22222222-2222-4222-8222-222222222222', exported_at: '2026-10-15T13:00:00Z', source_timezone: 'America/Chicago'};
function shift(values = {}) {
  return {id: 'good-first', title: 'Regular Shift', details: 'Room 2', colorCode: 'blue', start: '2026-10-20T08:00', end: '2026-10-20T18:00', ...values};
}
const cases = [
  ['invalid start', {start: '2026-02-30T08:00'}, 'start', 'Invalid shift date/time.'],
  ['invalid end', {end: '2026-10-20T25:00'}, 'end', 'Invalid shift date/time.'],
  ['malformed start', {start: 'not-a-date'}, 'start', 'Use full ISO start/end datetimes, including the end date.'],
  ['malformed end', {end: '2026-10-20'}, 'end', 'Use full ISO start/end datetimes, including the end date.'],
  ['non-string start', {start: null}, 'start', 'End must follow start; include the actual end date for overnight work.'],
  ['non-string end', {end: 123}, 'end', 'End must follow start; include the actual end date for overnight work.'],
  ['backward interval', {end: '2026-10-20T07:00'}, 'interval (start/end)', 'End must follow start; include the actual end date for overnight work.'],
  ['equal interval', {end: '2026-10-20T08:00'}, 'interval (start/end)', 'End must follow start; include the actual end date for overnight work.'],
  ['DST gap in start', {start: '2026-03-08T02:30', end: '2026-03-08T04:00'}, 'start', 'Ambiguous or nonexistent daylight-saving time. Use a valid explicit offset.'],
  ['DST fold in end', {start: '2026-11-01T00:30', end: '2026-11-01T01:30'}, 'end', 'Ambiguous or nonexistent daylight-saving time. Use a valid explicit offset.'],
];
for (const [name, values, field, reason] of cases) {
  test(`${name}: correct identity, field, original reason and unchanged schedule`, () => {
    const offending = shift({id: 'offending-abc123', title: 'Surgery — café', ...values});
    const schedule = [shift(), offending], before = structuredClone(schedule);
    Object.freeze(offending); Object.freeze(schedule[0]); Object.freeze(schedule);
    assert.throws(() => build(schedule, metadata), error => {
      for (const line of ['Shift index: 1 (item 2)', `Shift: ${JSON.stringify(offending.title)}`, `ID: ${JSON.stringify(offending.id)}`,
        `Start: ${JSON.stringify(offending.start)}`, `End: ${JSON.stringify(offending.end)}`, `Problem: ${field} — ${reason}`])
        assert.ok(error.message.includes(line), error.message);
      return true;
    });
    assert.deepEqual(schedule, before);
  });
}
test('existing alert displays the diagnostic and failure makes no browser writes or downloads', () => {
  const html = readFileSync(__dirname + '/index.html', 'utf8');
  const handler = html.slice(html.indexOf('    window.exportCreativeOS ='), html.indexOf('    window.exportCalendar ='));
  const schedule = [shift({end: '2026-10-20T25:00'})], before = structuredClone(schedule);
  const alerts = [];
  const forbidden = () => assert.fail('Invalid export must not write browser data or download');
  const sandbox = {window: {}, state: {shifts: schedule}, CreativeOSExport: {build}, prompt: () => 'America/Chicago',
    localStorage: {getItem: () => metadata.source_instance_id, setItem: forbidden}, crypto: {randomUUID: () => metadata.snapshot_id},
    URL: {createObjectURL: forbidden}, alert: message => alerts.push(message),
    CreativeOSProblem: {show: (error, getShifts) => {
      assert.equal(error.problemShift.id, 'good-first');
      assert.equal(getShifts(), schedule);
      alerts.push('Creative OS export failed: ' + error.message);
    }}};
  vm.runInNewContext(handler, sandbox);
  sandbox.window.exportCreativeOS();
  assert.equal(alerts.length, 1);
  assert.ok(alerts[0].startsWith('Creative OS export failed:'));
  assert.ok(alerts[0].includes('\nShift index: 0 (item 1)'));
  assert.ok(alerts[0].includes('Problem: end — Invalid shift date/time.'));
  assert.deepEqual(schedule, before);
});
