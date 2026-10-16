const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const exporter = require('./creative-os-export.js');
const metadata = {source_instance_id: '11111111-1111-4111-8111-111111111111', snapshot_id: '22222222-2222-4222-8222-222222222222', exported_at: '2026-10-15T13:00:00Z', source_timezone: 'America/Chicago'};
function shift(extra={}) { return {id:'problem-123', title:'Regular Shift', details:'Room 2', room:'Room 2', colorCode:'blue', start:'2026-10-20T18:00', end:'2026-10-20T08:00', date:'2026-10-20', startTime:'18:00', endTime:'08:00', ...extra}; }
function failure(shifts) {
  try { exporter.build(shifts, metadata); assert.fail('Expected strict export failure'); }
  catch (error) { assert.ok(error.problemShift); return error; }
}
function harness(shifts) {
  class Element {
    constructor(tag) { this.tag=tag; this.children=[]; this.style={}; this.handlers={}; this.textContent=''; }
    appendChild(child) { this.children.push(child); child.parent=this; return child; }
    setAttribute(key,value) { this[key]=value; }
    addEventListener(key,handler) { this.handlers[key]=handler; }
    showModal() { this.open=true; }
    close() { this.open=false; }
    remove() { this.parent.children=this.parent.children.filter(c=>c!==this); }
  }
  const body=new Element('body');
  const state={shifts,editingShift:null}; let renders=0;
  const forbidden=()=>assert.fail('Diagnostics must not persist, save, delete or download');
  const context={document:{body,createElement:tag=>new Element(tag)}, state, window:{}, CreativeOSExport:exporter,
    render:()=>renders++, localStorage:{getItem:()=>metadata.source_instance_id,setItem:forbidden,removeItem:forbidden},
    persist:forbidden, prompt:()=>metadata.source_timezone, crypto:{randomUUID:()=>metadata.snapshot_id}, alert:forbidden,
    URL:{createObjectURL:forbidden}};
  vm.createContext(context);
  vm.runInContext(readFileSync(__dirname+'/creative-os-problem.js','utf8'),context);
  const html=readFileSync(__dirname+'/index.html','utf8');
  vm.runInContext(html.slice(html.indexOf('    window.exportCreativeOS ='),html.indexOf('    window.exportCalendar =')),context);
  vm.runInContext(html.slice(html.indexOf('    window.editShift ='),html.indexOf('    window.removeShift =')),context);
  return {context,state,body,dialog:()=>body.children[0],renders:()=>renders,
    button:text=>body.children[0].children.find(n=>n.tag==='button'&&n.textContent===text),
    message:()=>body.children[0].children.find(n=>n.tag==='pre').textContent};
}
test('strict failure surfaces stable ID and useful original diagnostic context without mutation',()=>{
  const shifts=[Object.freeze(shift())],before=structuredClone(shifts); Object.freeze(shifts);
  const error=failure(shifts);
  assert.equal(error.problemShift.id,'problem-123');
  assert.ok(error.message.includes('Problem: interval (start/end)'));
  assert.deepEqual(shifts,before);
});
test('real export action locates by ID after reordering and uses the existing editor; editor cancel preserves data',()=>{
  const problem=Object.freeze(shift()),other=Object.freeze(shift({id:'other-id',start:'2026-10-20T08:00',end:'2026-10-20T18:00'}));
  const shifts=Object.freeze([other,problem]),before=structuredClone(shifts),h=harness(shifts);
  h.context.window.exportCreativeOS();
  assert.ok(h.message().includes('ID: "problem-123"'));
  // Reorder after failure to prove selection follows ID, never array position/title.
  h.state.shifts=Object.freeze([problem,other]);
  h.button('Open Problem Shift').onclick();
  assert.equal(h.state.editingShift,problem); assert.equal(h.renders(),1); assert.equal(h.body.children.length,0);
  h.context.window.closeEditModal();
  assert.equal(h.state.editingShift,null); assert.deepEqual(shifts,before);
});
test('malformed start/end opens read-only exact raw/legacy fields and never calls the editor',()=>{
  const record=Object.freeze(shift({start:'<bad start>',end:'2026-10-20T25:00',title:'<script>raw</script>'}));
  const shifts=Object.freeze([record]),before=structuredClone(shifts),h=harness(shifts);
  h.context.window.exportCreativeOS(); h.button('Open Problem Shift').onclick();
  for(const [label,key] of [['Title','title'],['ID','id'],['Details','details'],['Room','room'],['Color / category','colorCode'],
    ['Stored start','start'],['Stored end','end'],['Legacy date','date'],['Legacy startTime','startTime'],['Legacy endTime','endTime']])
    assert.ok(h.message().includes(label+': '+JSON.stringify(record[key])),h.message());
  assert.ok(h.message().includes('read-only')); assert.equal(h.state.editingShift,null); assert.equal(h.renders(),0);
  assert.equal(h.button('Open Problem Shift').hidden,true);
  h.button('Dismiss').onclick(); assert.equal(h.body.children.length,0); assert.deepEqual(shifts,before);
});
test('dismiss and Escape leave the schedule unchanged before locating a record',()=>{
  for(const escape of [false,true]) {
    const shifts=Object.freeze([Object.freeze(shift())]),before=structuredClone(shifts),h=harness(shifts);
    h.context.window.exportCreativeOS();
    if(escape) h.dialog().handlers.cancel({preventDefault(){}}); else h.button('Dismiss').onclick();
    assert.equal(h.body.children.length,0); assert.equal(h.state.editingShift,null); assert.equal(h.renders(),0);
    assert.deepEqual(shifts,before);
  }
});
for(const kind of ['removed','duplicate']) test(`${kind} stable ID refuses an arbitrary editor target`,()=>{
  const shifts=Object.freeze([Object.freeze(shift())]),before=structuredClone(shifts),h=harness(shifts);
  h.context.window.exportCreativeOS();
  h.state.shifts=kind==='removed'?[]:[shifts[0],shift()];
  h.button('Open Problem Shift').onclick();
  assert.equal(h.state.editingShift,null); assert.equal(h.renders(),0);
  assert.ok(h.message().includes('missing or no longer unique'));
  h.button('Dismiss').onclick(); assert.deepEqual(shifts,before);
});
