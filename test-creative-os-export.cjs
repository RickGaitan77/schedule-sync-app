const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const {build, wall} = require('./creative-os-export.js');
const meta = {source_instance_id: '11111111-1111-4111-8111-111111111111', snapshot_id: '22222222-2222-4222-8222-222222222222', exported_at: '2026-10-15T13:00:00Z', source_timezone: 'America/Chicago'};
function shift(extra = {}) { return {id: 'stable-1', title: 'Surgery — café', details: 'Room 2\nDental ~ |', colorCode: 'amber', start: '2026-10-16T22:00', end: '2026-10-17T06:00', ...extra}; }
test('complete versioned export preserves IDs, details, all dates and all categories without mutation', () => {
  const input = ['blue', 'amber', 'red', 'violet'].map((colorCode, i) => shift({id: 'stable-' + i, colorCode}));
  const before = JSON.stringify(input), value = build(input, meta);
  assert.equal(JSON.stringify(input), before);
  assert.equal(value.schema_version, 1); assert.equal(value.complete, true);
  assert.equal(value.shifts.length, 4); assert.equal(value.shifts[0].end, '2026-10-17T06:00');
  assert.equal(value.shifts[0].details, input[0].details); assert.equal(value.shifts[0].type, 'work_shift');
  assert.deepEqual(build([], meta).shifts, []);
  const legacy = shift({details: undefined, colorCode: undefined, room: 'Room 4', urgentCare: true});
  const exported = build([legacy], meta).shifts[0];
  assert.equal(exported.details, 'Room 4'); assert.equal(exported.colorCode, 'red');
  assert.equal(legacy.details, undefined); assert.equal(legacy.colorCode, undefined);
});
test('DST gaps, folds, invalid dates and offset mismatch fail; valid explicit folds work', () => {
  for (const date of ['2026-03-08T02:30', '2026-11-01T01:30', '2026-02-30T12:00', '2026-10-16T08:00-06:00'])
    assert.throws(() => wall(date, meta.source_timezone));
  assert.equal(wall('2026-11-01T01:30-06:00', meta.source_timezone) - wall('2026-11-01T01:30-05:00', meta.source_timezone), 3600000);
  assert.throws(() => build([shift(), shift()], meta));
  assert.throws(() => build([shift({id: ''})], meta));
  assert.throws(() => build([shift({end: '2026-10-16T06:00'})], meta));
  assert.throws(() => build([], {...meta, source_timezone: 'invalid'}));
});
test('actual user export handler downloads JSON, changes only bridge metadata and leaves Apple/QR/shift paths untouched', async () => {
  const html = readFileSync(__dirname + '/index.html', 'utf8');
  const handler = html.slice(html.indexOf('    window.exportCreativeOS ='), html.indexOf('    window.exportCalendar ='));
  const shifts = [shift()], before = JSON.stringify(shifts), storage = new Map();
  let blob, clicks = 0, alerts = [], confirmations = 0;
  const sandbox = {window: {}, state: {shifts}, CreativeOSExport: {build},
    prompt: () => 'America/Chicago', confirm: () => { confirmations++; return true; },
    localStorage: {getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value)},
    crypto: require('node:crypto').webcrypto, Blob, Date, setTimeout: fn => fn(),
    URL: {createObjectURL: value => {blob = value; return 'blob:test';}, revokeObjectURL: () => {}},
    document: {body: {appendChild: () => {}}, createElement: () => ({click: () => clicks++, remove: () => {}})},
    alert: value => alerts.push(value)};
  vm.runInNewContext(handler, sandbox);
  sandbox.window.exportCreativeOS();
  const first = JSON.parse(await blob.text());
  assert.equal(clicks, 1); assert.deepEqual(alerts, []); assert.equal(JSON.stringify(shifts), before);
  assert.equal(storage.size, 1); assert.equal(confirmations, 0);
  sandbox.window.exportCreativeOS();
  const second = JSON.parse(await blob.text());
  assert.equal(first.source_instance_id, second.source_instance_id); assert.notEqual(first.snapshot_id, second.snapshot_id);
  sandbox.state.shifts = []; sandbox.window.exportCreativeOS();
  assert.equal(confirmations, 1); assert.deepEqual(JSON.parse(await blob.text()).shifts, []);
  sandbox.prompt = () => null; sandbox.window.exportCreativeOS(); assert.equal(clicks, 3);
});
