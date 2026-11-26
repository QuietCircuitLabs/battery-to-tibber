'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {preflight,preferred}=require('../lib/preflight');
const {Engine}=require('../lib/engine');
const {MINUTE}=require('../lib/policy');
const START=Date.parse('2026-11-10T06:00:00Z');
const cap=value=>({value,lastUpdated:new Date(START).toISOString()});
function cars(){return {car:{id:'car',name:'Kia EV9',driverId:'car',driverUri:'homey:app:com.kia',capabilitiesObj:{
  measure_battery:cap(80),charge_target_slow:cap('80'),latitude:cap(1),longitude:cap(2),
  ev_charging_state:cap('plugged_in'),last_refresh:cap('fresh'),
}}};}
const installed={kia:{id:'com.kia',enabled:true,ready:true}};
test('preflight distinguishes app missing, disabled, starting, no car and missing data',()=>{
  assert.equal(preflight({},{}).code,'KIA_MISSING');
  assert.equal(preflight({kia:{id:'com.kia',enabled:false}},{}).code,'KIA_DISABLED');
  assert.equal(preflight({kia:{id:'com.kia',ready:false}},{}).code,'KIA_STARTING');
  assert.equal(preflight(installed,{}).code,'KIA_NO_CAR');
  const d=cars();delete d.car.capabilitiesObj.charge_target_slow;
  assert.equal(preflight(installed,d).code,'KIA_DATA_MISSING');
});
test('raw Homey driverUri and transformed driverId both find Kia, never unrelated battery devices',()=>{
  const d=cars();let r=preflight(installed,d,START);
  assert.equal(r.ready,true);assert.equal(r.preferredCarId,'car');assert.equal(r.cars[0].soc,80);
  d.car.driverId='homey:app:com.kia:car';delete d.car.driverUri;
  assert.equal(preflight(installed,d,START).ready,true);
  d.car.driverId='homey:app:com.other:car';assert.equal(preflight(installed,d,START).code,'KIA_NO_CAR');
});
test('invalid/unavailable Kia values block setup; stale valid values allow setup with warning',()=>{
  const d=cars();d.car.capabilitiesObj.measure_battery.value=null;
  assert.equal(preflight(installed,d,START).ready,false);
  d.car.capabilitiesObj.measure_battery.value=80;d.car.available=false;
  assert.equal(preflight(installed,d,START).ready,false);
  d.car.available=true;const r=preflight(installed,d,START+40*MINUTE);
  assert.equal(r.ready,true);assert.equal(r.cars[0].stale,true);
});
test('one EV9 is preferred; multiple EV9 matches never produce an arbitrary selection',()=>{
  assert.equal(preferred([{id:'a',name:'Volvo'},{id:'b',name:'KIA EV9'}]),'b');
  assert.equal(preferred([{id:'a',name:'EV9 svart'},{id:'b',name:'EV9 vit'}]),null);
});
function authFixture(){
  let now=START,response;
  const data={config:{source:'flow',vehicleId:'v'},state:{tested:true}},calls=[],notices=[];
  const io={load:k=>structuredClone(data[k]),save:async(k,v)=>{data[k]=structuredClone(v);},now:()=>now,home:()=>({lat:1,lon:2}),
    devices:async()=>{throw Error('Authentication must not read cars');},notify:async m=>notices.push(m),
    post:async(path,body,token)=>{
      calls.push({path,body,token});if(response)return response;
      return {status:200,json:{token:'hdr.'+Buffer.from(JSON.stringify({exp:(now+180*MINUTE)/1000})).toString('base64url')+'.sig'}};
    }};
  return {io,data,calls,notices,engine:new Engine(io),advance:m=>{now+=m*MINUTE;},reply:r=>{response=r;}};
}
async function active(f){
  assert.equal((await f.engine.run('login',{email:'fixture@example.test',password:'fixture-only-secret',remember:true})).ok,true);
  assert.equal((await f.engine.run('enable',{confirmed:true})).ok,true);
}
test('opt-in renews for a simulated day, stores only in private store and survives restart',async()=>{
  const f=authFixture();await active(f);
  assert.equal(f.data.credentials.password,'fixture-only-secret');
  assert.ok(!JSON.stringify(f.engine.status()).includes('fixture-only-secret'));
  assert.ok(!JSON.stringify(f.data.state).includes('fixture-only-secret'));
  for(let m=1;m<=1500;m++){
    f.advance(1);const r=await f.engine.run('maintain');assert.equal(r.ok,true);
    assert.equal(f.calls.length,1+Math.floor(m/170));
    if(m===400)f.engine=new Engine(f.io);
  }
  assert.equal(f.engine.status().enabled,true);assert.equal(f.engine.status().connected,true);
});
test('rejected saved credentials pause once and remain paused after restart',async()=>{
  const f=authFixture();await active(f);f.advance(170);f.reply({status:401,json:{}});
  assert.equal((await f.engine.run('maintain')).code,'AUTH');
  f.advance(180);await f.engine.run('maintain');f.engine=new Engine(f.io);await f.engine.run('maintain');
  assert.equal(f.calls.length,2);assert.equal(f.notices.length,1);assert.equal(f.engine.status().enabled,false);
});
test('automatic login respects rate-limit backoff after restart and logout deletes credentials',async()=>{
  const f=authFixture();await active(f);f.advance(170);f.reply({status:429,retryAfter:'7200',json:{}});
  assert.equal((await f.engine.run('maintain')).code,'RATE');f.engine=new Engine(f.io);
  f.advance(119);await f.engine.run('maintain');assert.equal(f.calls.length,2);
  f.advance(1);f.reply(null);await f.engine.run('maintain');assert.equal(f.calls.length,3);
  await f.engine.run('logout');assert.equal(f.data.credentials,null);assert.equal(f.data.session,null);
});
test('storage failure prevents authentication and pauses without leaking the input',async()=>{
  const f=authFixture();f.io.save=async()=>{throw Error('STORAGE');};
  const r=await f.engine.run('login',{email:'fixture@example.test',password:'fixture-only-secret',remember:true});
  assert.equal(r.code,'STORAGE');assert.equal(r.status.enabled,false);assert.equal(f.calls.length,0);
  assert.ok(!JSON.stringify(r).includes('fixture-only-secret'));
});
