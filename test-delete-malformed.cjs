const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const keys=['vet_shifts_backup','schedule_sync_shifts'];
function valid(extra={}) {return {id:'valid-id',title:'Regular Shift',details:'Synthetic room',room:'Synthetic room',colorCode:'blue',start:'2026-10-20T08:00',end:'2026-10-20T17:00',...extra};}
function bad(extra={}) {return valid({id:'malformed-id',start:'2026-10-20T30:00',...extra});}
function app(records,options={}) {
  const original=JSON.stringify(records,null,2)+'\n',storage=new Map(keys.map(key=>[key,original]));
  if(options.secondary)storage.set(keys[1],options.secondary);
  const writes=[],alerts=[],confirmations=[],nodes=new Map(),dialogs=[];
  class Element {
    constructor(){this.children=[];this.style={};this.handlers={};this.textContent='';}
    appendChild(child){this.children.push(child);child.parent=this;return child;}
    replaceChildren(){this.children=[];}
    setAttribute(key,value){this[key]=value;}
    addEventListener(key,handler){this.handlers[key]=handler;}
    showModal(){dialogs.push(this);}
    close(){this.closed=true;}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);}
  }
  const context={window:{location:{hash:''},addEventListener(){}},document:{body:new Element(),createElement:()=>new Element(),
    getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);}},
    ScheduleIntegrity:require('./shift-integrity.js'),CreativeOSExport:require('./creative-os-export.js'),
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>{writes.push([key,value]);if(options.failSecond&&key===keys[1])throw Error('full');storage.set(key,value);},removeItem:key=>storage.delete(key)},
    alert:text=>alerts.push(text),confirm:text=>{confirmations.push(text);return options.confirm?.(text)??false;},Date,console,setTimeout:fn=>fn()};
  vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/creative-os-problem.js','utf8'),context);
  const html=fs.readFileSync(__dirname+'/index.html','utf8');
  let code=html.slice(html.indexOf('  <script>')+10,html.lastIndexOf('  </script>'));
  const last=code.lastIndexOf('    render();');code=code.slice(0,last)+'    render = () => {};\n'+code.slice(last);
  vm.runInContext(code,context);
  const state=vm.runInContext('state',context);
  function inspect(id='malformed-id') {
    const buttons=nodes.get('integrity-status').children.filter(node=>node.type==='button');
    const issuePosition=context.ScheduleIntegrity.inspect(state.shifts).findIndex(issue=>issue.record?.id===id);
    assert.ok(issuePosition>=0);buttons[issuePosition].onclick();return dialogs.at(-1);
  }
  return {context,state,storage,writes,alerts,confirmations,dialogs,nodes,inspect,
    button:(dialog,label)=>dialog.children.find(node=>node.textContent===label),
    delete:(id,expected)=>{context.targetId=id;context.expected=expected;return vm.runInContext('deleteMalformedRecord(targetId, expected)',context);}};
}
test('confirmed deletion follows exact stable ID after reorder and preserves every other record',()=>{
  const good=valid(),other=bad({id:'other-malformed'}),a=app([good,bad(),other],{confirm:()=>true});
  const dialog=a.inspect(),target=a.state.shifts[1],survivors=[a.state.shifts[0],a.state.shifts[2]];
  a.state.shifts=[survivors[1],survivors[0],target];
  a.button(dialog,'Delete malformed record').onclick();
  assert.equal(a.state.shifts.length,2);assert.equal(a.state.shifts[0],survivors[1]);assert.equal(a.state.shifts[1],survivors[0]);
  assert.deepEqual(JSON.parse(a.storage.get(keys[0])),[other,good]);assert.equal(a.storage.get(keys[0]),a.storage.get(keys[1]));
  assert.equal(a.writes.length,2);assert.equal(dialog.closed,true);
  const text=a.confirmations[0];for(const [label,key] of [['Title','title'],['Stable ID','id'],['Details','details'],['Room','room'],['Stored start','start'],['Stored end','end']])
    assert.ok(text.includes(label+': '+JSON.stringify(target[key])),text);
});
test('cancel confirmation makes zero writes and keeps the inspection open',()=>{
  const a=app([valid(),bad()]),before=[...a.storage],initial=JSON.stringify(a.state.shifts),dialog=a.inspect();
  a.button(dialog,'Delete malformed record').onclick();
  assert.equal(a.confirmations.length,1);assert.equal(a.writes.length,0);assert.deepEqual([...a.storage],before);
  assert.equal(JSON.stringify(a.state.shifts),initial);assert.notEqual(dialog.closed,true);
});
test('Dismiss and Escape make zero changes without requesting confirmation',()=>{
  for(const escape of [false,true]){
    const a=app([valid(),bad()]),before=[...a.storage],dialog=a.inspect();
    if(escape)dialog.handlers.cancel({preventDefault(){}});else a.button(dialog,'Dismiss').onclick();
    assert.equal(a.writes.length,0);assert.equal(a.confirmations.length,0);assert.deepEqual([...a.storage],before);assert.equal(a.state.shifts.length,2);
  }
});
test('missing, wrong, empty, duplicate and index-like targets are refused',()=>{
  for(const id of [undefined,'','wrong-id',1,'1']){
    const a=app([valid(),bad()],{confirm:()=>true}),before=[...a.storage];
    assert.equal(a.delete(id,JSON.stringify(a.state.shifts[1])),false);
    assert.equal(a.confirmations.length,0);assert.equal(a.writes.length,0);assert.deepEqual([...a.storage],before);
  }
  const a=app([bad(),bad()],{confirm:()=>true});
  assert.equal(a.delete('malformed-id',JSON.stringify(a.state.shifts[0])),false);assert.equal(a.writes.length,0);
  assert.equal(a.button(a.inspect(),'Delete malformed record'),undefined);
});
test('valid records and stale inspection snapshots cannot be deleted',()=>{
  const a=app([valid(),bad()],{confirm:()=>true}),before=[...a.storage],good=a.state.shifts[0];
  assert.equal(a.delete(good.id,JSON.stringify(good)),false);
  const dialog=a.inspect();a.state.shifts[1]=valid({id:'malformed-id'});
  a.button(dialog,'Delete malformed record').onclick();
  assert.equal(a.writes.length,0);assert.equal(a.confirmations.length,0);assert.deepEqual([...a.storage],before);
});
test('a record changed during confirmation is refused after confirmation',()=>{
  let a;a=app([valid(),bad()],{confirm:()=>{a.state.shifts[1]=bad({details:'changed'});return true;}});
  const before=[...a.storage],dialog=a.inspect();a.button(dialog,'Delete malformed record').onclick();
  assert.equal(a.confirmations.length,1);assert.equal(a.writes.length,0);assert.deepEqual([...a.storage],before);
});
test('failed persistence rolls back both key bytes and keeps memory and panel intact',()=>{
  const a=app([valid(),bad()],{confirm:()=>true,failSecond:true}),before=[...a.storage],initial=JSON.stringify(a.state.shifts),dialog=a.inspect();
  a.button(dialog,'Delete malformed record').onclick();
  assert.deepEqual([...a.storage],before);assert.equal(JSON.stringify(a.state.shifts),initial);assert.notEqual(dialog.closed,true);
  assert.ok(a.alerts.some(text=>text.includes('not saved')));
});
test('conflicting stored copies offer no delete action and cannot be overwritten',()=>{
  const a=app([valid(),bad()],{confirm:()=>true,secondary:JSON.stringify([valid({id:'different-copy'})])}),before=[...a.storage];
  assert.equal(a.button(a.inspect(),'Delete malformed record'),undefined);
  assert.equal(a.delete('malformed-id',JSON.stringify(a.state.shifts[1])),false);
  assert.equal(a.writes.length,0);assert.deepEqual([...a.storage],before);
});
test('a newer stored copy before confirmation cannot be overwritten by deletion',()=>{
  const a=app([valid(),bad()],{confirm:()=>true}),dialog=a.inspect(),newer=JSON.stringify([valid({id:'newer'})]);
  for(const key of keys)a.storage.set(key,newer);
  a.button(dialog,'Delete malformed record').onclick();
  assert.equal(a.writes.length,0);for(const key of keys)assert.equal(a.storage.get(key),newer);
  assert.equal(a.state.shifts.length,2);assert.notEqual(dialog.closed,true);
});
