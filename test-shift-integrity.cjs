const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const integrity=require('./shift-integrity.js');
const exporter=require('./creative-os-export.js');
function shift(values={}) {return {id:'stored-good',title:'Regular Shift',details:'Room 1',colorCode:'blue',start:'2026-10-20T08:00',end:'2026-10-20T17:00',date:'2026-10-20',startTime:'08:00',endTime:'17:00',...values};}
const keys=['vet_shifts_backup','schedule_sync_shifts'];
function app(records=[],options={}) {
  const initial=options.raw??JSON.stringify(records);
  const storage=new Map(keys.map(key=>[key,initial]));
  if(options.secondary!==undefined)storage.set(keys[1],options.secondary);
  const writes=[],alerts=[],nodes=new Map(),events={},dialogs=[]; let qr='';
  class Element {
    constructor(){this.children=[];this.style={};this.value='';this.textContent='';this.handlers={};}
    appendChild(child){this.children.push(child);child.parent=this;return child;}
    replaceChildren(){this.children=[];}
    setAttribute(key,value){this[key]=value;}
    addEventListener(key,handler){this.handlers[key]=handler;}
    showModal(){dialogs.push(this);}
    close(){}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
  }
  const context={window:{location:{hash:options.hash||'',pathname:'/schedule-sync-app/',origin:'https://example.test'},history:{replaceState(){}},addEventListener:(name,fn)=>{events[name]=fn;}},
    document:{getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},createElement:()=>new Element(),body:new Element()},
    ScheduleIntegrity:integrity,CreativeOSExport:exporter,localStorage:{getItem:key=>storage.has(key)?storage.get(key):null,
      setItem:(key,value)=>{writes.push([key,value]);if(options.failSecond&&key===keys[1])throw Error('storage full');storage.set(key,value);},removeItem:key=>storage.delete(key)},
    alert:message=>alerts.push(message),console,URL,Date,setTimeout:fn=>{fn();return 1;},QRious:function(value){qr=value.value;},
    crypto:require('node:crypto').webcrypto,pendingInterimText:''};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(__dirname+'/creative-os-problem.js','utf8'),context);
  const html=options.old?execFileSync('git',['show','58f0529:index.html'],{cwd:__dirname,encoding:'utf8'}):fs.readFileSync(__dirname+'/index.html','utf8');
  let code=html.slice(html.indexOf('  <script>')+10,html.lastIndexOf('  </script>'));
  const last=code.lastIndexOf('    render();');
  code=code.slice(0,last)+'    render = () => {};\n'+code.slice(last);
  vm.runInContext(code,context);
  const state=vm.runInContext('state',context);state.year='2026';state.month='10';
  return {context,state,storage,writes,alerts,nodes,events,dialogs,qr:()=>qr,run:source=>vm.runInContext(source,context),
    input:(id,value)=>context.document.getElementById(id).value=value,
    dictate:text=>{state.transcript=text;context.window.processTranscript();},
    sync:hash=>{context.window.location.hash='#sync='+encodeURIComponent(hash);vm.runInContext('processSyncHash()',context);}};
}
const event={preventDefault(){}};
for(const [name,values] of [['hour',{start:'2026-10-20T30:00'}],['minute',{end:'2026-10-20T08:75'}],
  ['February 30',{start:'2026-02-30T08:00'}],['April 31',{start:'2026-04-31T08:00'}],['non-leap day',{start:'2027-02-29T08:00'}],
  ['month 13',{start:'2026-13-01T08:00'}],['structure',{start:'2026-10-20 08:00'}],['backward',{end:'2026-10-20T07:00'}],['equal',{end:'2026-10-20T08:00'}]]) {
  test(`shared validator rejects ${name} without changing the record`,()=>{
    const record=Object.freeze(shift(values)),before=structuredClone(record);
    assert.throws(()=>integrity.validate(record));assert.deepEqual(record,before);
  });
}
test('valid normal, leap-day and explicitly dated overnight shifts validate unchanged',()=>{
  for(const record of [shift(),shift({start:'2028-02-29T08:00',end:'2028-02-29T17:00'}),shift({start:'2026-12-31T22:00',end:'2027-01-01T06:00'})]){
    const before=structuredClone(record);assert.equal(integrity.validate(record),record);assert.deepEqual(record,before);
  }
});
for(const text of ['October 20 30:00-08:00','October 20 08:75-17:00','February 30 08:00-17:00',
  'April 31 08:00-17:00','13/20 08:00-17:00','October 20 30am-5pm','October 20 08:00-08:00','October 20 18:00-08:00',
  'October 20 100:00-17:00','2/29/2027 08:00-17:00']) {
  test(`dictation rejects ${text} without persisting`,()=>{
    const a=app([shift()]),before=[...a.storage];a.dictate(text);
    assert.equal(a.state.shifts.length,1);assert.equal(a.writes.length,0);assert.deepEqual([...a.storage],before);
    assert.ok(a.alerts.some(message=>message.includes('Not saved from dictation')),a.alerts.join('\n'));
    assert.equal(a.state.transcript,text);
  });
}
test('dictation saves normal and overnight records with actual following dates and respects 24-hour midnight',()=>{
  for(const [text,start,end] of [['October 20 08:00-17:00','2026-10-20T08:00','2026-10-20T17:00'],
    ['December 31 overnight 22:00-06:00','2026-12-31T22:00','2027-01-01T06:00'],
    ['October 20 00:00-05:00','2026-10-20T00:00','2026-10-20T05:00'],
    ['10-20 8am-5pm','2026-10-20T08:00','2026-10-20T17:00'],
    ['October 20 8-5','2026-10-20T08:00','2026-10-20T17:00'],
    ['October 20 8am-5pm','2026-10-20T08:00','2026-10-20T17:00'],
    ['February 28 2027 08:00-17:00','2027-02-28T08:00','2027-02-28T17:00']]) {
    const a=app();a.dictate(text);assert.equal(a.state.shifts.length,1,a.alerts.join('\n'));
    assert.equal(a.state.shifts[0].start,start);assert.equal(a.state.shifts[0].end,end);assert.equal(a.writes.length,2);
  }
});
test('mixed dictation saves only valid new rows and leaves historical rows untouched',()=>{
  const original=shift(),a=app([original]);a.dictate('October 21 08:00-17:00\nFebruary 30 08:00-17:00');
  assert.equal(a.state.shifts.length,2);assert.deepEqual(JSON.parse(JSON.stringify(a.state.shifts[0])),original);
  assert.ok(a.alerts[0].toLowerCase().includes('february 30'));
});
for(const mode of ['add','edit']) for(const value of ['2026-10-20T30:00','2026-02-30T08:00','2026-10-20T08:75','']) {
  test(`${mode} rejects ${value||'empty'} without changing memory or either key`,()=>{
    const a=app([shift()]),before=[...a.storage];
    const original=JSON.stringify(a.state.shifts);
    for(const [field,v] of Object.entries({start:value,end:'2026-10-20T17:00',color:'blue',title:'Edited',details:'Room 2'}))a.input(mode+'-'+field,v);
    if(mode==='edit')a.state.editingShift=a.state.shifts[0];
    a.context.window[mode==='add'?'saveNewShift':'saveEditedShift'](event);
    assert.equal(a.writes.length,0);assert.deepEqual([...a.storage],before);assert.equal(JSON.stringify(a.state.shifts),original);
    assert.ok(a.alerts.length);
  });
}
test('valid add and edit commit only the intended row and preserve stable edit identity',()=>{
  const a=app([shift()]);
  for(const [field,value] of Object.entries({start:'2026-10-21T22:00',end:'2026-10-22T06:00',color:'red',title:'Overnight',details:'Room 4'}))a.input('add-'+field,value);
  a.context.window.saveNewShift(event);assert.equal(a.state.shifts.length,2);
  a.state.editingShift=a.state.shifts[1];const id=a.state.editingShift.id;
  for(const [field,value] of Object.entries({start:'2026-10-21T21:00',end:'2026-10-22T06:00',color:'red',title:'Overnight edited',details:'Room 4'}))a.input('edit-'+field,value);
  a.context.window.saveEditedShift(event);
  assert.equal(a.state.shifts[1].id,id);assert.equal(a.state.shifts[1].start,'2026-10-21T21:00');
  assert.deepEqual(JSON.parse(JSON.stringify(a.state.shifts[0])),shift());assert.equal(a.storage.get(keys[0]),a.storage.get(keys[1]));
});
test('malformed QR batch reports every bad row and preserves current memory and storage',()=>{
  const a=app([shift()]),before=[...a.storage],initial=JSON.stringify(a.state.shifts);
  a.sync('good~2026-10-22~08:00~17:00~Room 1~blue~Good|bad-hour~2026-10-23~30:00~17:00~R~red~Bad hour|bad-date~2026-02-30~08:00~17:00~R~blue~Bad date|garbage');
  assert.equal(a.writes.length,0);assert.deepEqual([...a.storage],before);assert.equal(JSON.stringify(a.state.shifts),initial);
  for(const id of ['bad-hour','bad-date','garbage'])assert.ok(a.alerts[0].includes(id),a.alerts[0]);
});
test('QR normal/explicit overnight succeed; legacy overnight without end date is rejected',()=>{
  const a=app();a.sync('qr-normal~2026-10-22~08:00~17:00~Room~blue~Normal');
  assert.equal(a.state.shifts[0].id,'qr-normal');
  a.sync('qr-night~2026-10-22~22:00~06:00~Room~blue~Night~2026-10-23');
  assert.equal(a.state.shifts[0].end,'2026-10-23T06:00');
  const before=[...a.storage];a.writes.length=0;
  a.sync('bad-night~2026-10-22~22:00~06:00~Room~blue~Night');
  assert.equal(a.writes.length,0);assert.deepEqual([...a.storage],before);
});
test('new QR export preserves overnight end date through the actual QR/hash path',()=>{
  const record=shift({start:'2026-12-31T22:00',end:'2027-01-01T06:00'}),a=app([record]);
  a.state.showQrModal=true;a.run('renderModals()');assert.ok(a.qr().includes('#sync='));
  const b=app();b.sync(decodeURIComponent(a.qr().split('#sync=')[1]));
  assert.equal(b.state.shifts[0].start,record.start);assert.equal(b.state.shifts[0].end,record.end);
});
test('historical load and inspection preserve exact bytes, malformed objects and good records',()=>{
  const records=[shift(),shift({id:'historical-bad',start:'2026-10-20T30:00'})];
  const raw=JSON.stringify(records,null,3)+'\n',a=app(records,{raw});
  assert.equal(a.writes.length,0);for(const key of keys)assert.equal(a.storage.get(key),raw);
  assert.deepEqual(JSON.parse(JSON.stringify(a.state.shifts)),records);
  const panel=a.nodes.get('integrity-status');assert.ok(panel.children[0].textContent.includes('preserved'));
  panel.children.find(child=>child.type==='button').onclick();
  const dialog=a.dialogs[0];
  assert.ok(dialog.children.some(node=>node.textContent.includes('historical-bad')&&node.textContent.includes('30:00')));
  dialog.children.find(node=>node.textContent==='Dismiss').onclick();assert.equal(a.writes.length,0);
  assert.equal(a.run('scheduleForDisplay().length'),1);assert.equal(a.state.shifts.length,2);
  assert.throws(()=>exporter.build(a.state.shifts,{source_timezone:'America/Chicago'}));
});
test('a good new record can save while preserving historical bad rows logically unchanged',()=>{
  const records=[shift(),shift({id:'historic',start:'2026-02-30T08:00'})],a=app(records);
  a.dictate('October 21 08:00-17:00');assert.equal(a.state.shifts.length,3);
  assert.deepEqual(JSON.parse(a.storage.get(keys[0])).slice(0,2),records);
});
test('conflicting or unparseable storage copies are preserved and block writes',()=>{
  for(const options of [{secondary:JSON.stringify([shift({id:'different'})])},{raw:'{bad json',secondary:JSON.stringify([shift()])}]) {
    const a=app([shift()],options),before=[...a.storage];a.dictate('October 21 08:00-17:00');
    assert.equal(a.writes.length,0);assert.deepEqual([...a.storage],before);assert.ok(a.alerts.length);
  }
});
test('second-key write failure rolls back original bytes and never publishes a staged edit',()=>{
  const a=app([shift()],{failSecond:true}),before=[...a.storage],initial=JSON.stringify(a.state.shifts);
  a.dictate('October 21 08:00-17:00');assert.deepEqual([...a.storage],before);assert.equal(JSON.stringify(a.state.shifts),initial);
});
test('storage event detects a malformed record without a rewrite',()=>{
  const a=app([shift()]),bad=JSON.stringify([shift({start:'2026-10-20T30:00'})]);
  for(const key of keys)a.storage.set(key,bad);
  a.events.storage({key:keys[0],newValue:bad});assert.equal(a.writes.length,0);
  assert.equal(a.state.shifts[0].start,'2026-10-20T30:00');assert.equal(a.run('scheduleForDisplay().length'),0);
});
test('old dictation admission reproduces the malformed-date/time class with synthetic input',()=>{
  for(const text of ['October 20 30:00-08:00','October 20 08:75-17:00','February 30 08:00-17:00']) {
    const a=app([],{old:true});a.dictate(text);
    assert.equal(a.state.shifts.length,1);assert.equal(a.writes.length,2);assert.throws(()=>integrity.validate(a.state.shifts[0]));
  }
});
test('an invalid date does not poison the selected month for the next valid dictation line',()=>{
  const a=app();a.dictate('13/20 08:00-17:00\n21st 08:00-17:00');
  assert.equal(a.state.shifts.length,1);assert.equal(a.state.shifts[0].start,'2026-10-21T08:00');
});
test('same-line named dates and bare time ranges are separated without treating hours as dates',()=>{
  const a=app();a.dictate('October 20 8-5 October 21 9-6');
  assert.equal(a.state.shifts.length,2,a.alerts.join('\n'));
  assert.equal(a.state.shifts[0].start,'2026-10-20T08:00');assert.equal(a.state.shifts[1].start,'2026-10-21T09:00');
});
test('QR export identifies malformed historical data without rewriting it',()=>{
  const a=app([shift({start:'2026-10-20T30:00'})]),before=[...a.storage];
  a.state.showQrModal=true;a.run('renderModals()');
  assert.ok(a.nodes.get('qrcode').textContent.includes('QR export failed'));
  assert.equal(a.writes.length,0);assert.deepEqual([...a.storage],before);assert.equal(a.qr(),'');
});
test('an explicitly empty QR end date and an empty incoming schedule cannot clear existing data',()=>{
  for(const payload of ['id~2026-10-20~22:00~06:00~Room~blue~Night~','']){
    const a=app([shift()]),before=[...a.storage];a.sync(payload);
    assert.equal(a.writes.length,0);assert.deepEqual([...a.storage],before);assert.equal(a.state.shifts.length,1);
  }
});
test('valid-only load and non-object historical data are preserved without opening-time migration',()=>{
  for(const records of [[shift()],[null,7,shift()]]){
    const raw=JSON.stringify(records,null,2)+'\n',a=app(records,{raw});
    assert.equal(a.writes.length,0);assert.deepEqual(JSON.parse(JSON.stringify(a.state.shifts)),records);
    assert.equal(a.run('scheduleForDisplay().length'),1);
    for(const key of keys)assert.equal(a.storage.get(key),raw);
  }
});
test('a storage change before its event arrives cannot be overwritten by an older edit',()=>{
  const a=app([shift()]),newer=JSON.stringify([shift({id:'other-tab-newer'})]);
  for(const key of keys)a.storage.set(key,newer);
  a.dictate('October 21 08:00-17:00');
  assert.equal(a.writes.length,0);for(const key of keys)assert.equal(a.storage.get(key),newer);
  assert.ok(a.alerts.some(message=>message.includes('another tab')));
});
