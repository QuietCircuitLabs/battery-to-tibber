'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Engine}=require('../lib/engine');
const {planning,distanceMeters,options,sample,MINUTE}=require('../lib/policy');
const START=Date.parse('2026-11-09T12:00:00Z');
const cap=(value,type='number',time=START)=>({value,type,lastUpdated:new Date(time).toISOString()});
function devices(){return {
  carA:{id:'carA',name:'My car',driverUri:'homey:app:com.kia',ready:true,available:true,settings:{batteryAlarmLevel:50},capabilitiesObj:{
    measure_battery:cap(50),charge_target_slow:cap('80','enum'),latitude:cap(0),longitude:cap(1),
    last_refresh:cap('Nov 09 13:00','string'),ev_charging_state:cap('plugged_in','enum'),refresh_status:cap(false,'boolean'),
    'measure_battery.12V':cap(90),measure_odo:cap(1000),}},
  chargerA:{id:'chargerA',name:'Another brand charger',driverUri:'homey:app:com.anybrand',ready:true,available:true,
    capabilitiesObj:{'alarm_generic.car_connected':cap(true,'boolean'),onoff:cap(true,'boolean')}},
};}
function setup(changes={}){
  let now=START,rows=devices(),reply;
  const store={config:{source:'kia',vehicleId:'vehicleA',carId:'carA',connectionMode:'device',chargerId:'chargerA',chargerCapability:'alarm_generic.car_connected'},
    state:{enabled:true,tested:true},session:{token:'dummy-private-session'},...changes};
  const calls=[],refreshes=[];
  const io={load:k=>structuredClone(store[k]),save:async(k,v)=>{store[k]=structuredClone(v);},now:()=>now,
    home:()=>({lat:0,lon:1}),devices:async()=>rows,refresh:async id=>{refreshes.push(id);},
    post:async(path,body,token)=>{
      calls.push({path,body,token});
      if(reply)return typeof reply==='function'?reply():reply;
      if(path==='/login.credentials')return {status:200,json:{token:'new-private-token'}};
      if(body.query.includes('myVehicles'))return {status:200,json:{data:{me:{myVehicles:{vehicles:[{id:'vehicleA',title:'My offline car'}]}}}}};
      return {status:200,json:{data:{me:{setVehicleSettings:{id:'vehicleA'}}}}};
    }};
  return {io,store,calls,refreshes,engine:new Engine(io),rows:()=>rows,reply:v=>{reply=v;},advance:m=>{now+=m*MINUTE;},now:()=>now};
}
test('exact compensation, enum targets and bounded percentages',()=>{
  for(const [soc,target,want]of [[73.5,80,94],[73.5,'90',84],[73.5,100,74],[90,80,100],[0,100,0]])assert.equal(planning(soc,target),want);
  for(const [soc,target]of [[null,80],['50',80],[101,80],[50,'none'],[50,'80x'],[50,0]])assert.throws(()=>planning(soc,target),/DATA/);
});
test('100 metre filter uses raw coordinates, not rounded distance capability',()=>{
  const delta=m=>m/6371000*180/Math.PI;
  const f=setup();assert.ok(distanceMeters({lat:0,lon:1},{lat:0,lon:1+delta(99)})<100);
  f.rows().carA.capabilitiesObj.longitude.value=1+delta(101);
  assert.equal(sample(f.rows(),f.engine.config,f.io.home(),START,null).atHome,false);
  f.rows().carA.capabilitiesObj.longitude.value=1+delta(99);
  assert.equal(sample(f.rows(),f.engine.config,f.io.home(),START,null).eligible,true);
});
test('any charger with explicit connection capability works; onoff is never inferred',()=>{
  const f=setup();assert.equal(options(f.rows()).chargers[0].name,'Another brand charger');
  delete f.rows().chargerA.capabilitiesObj['alarm_generic.car_connected'];
  assert.equal(options(f.rows()).chargers.length,0);
  f.engine.config.chargerCapability='onoff';
  assert.equal(sample(f.rows(),f.engine.config,f.io.home(),START,null).chargerConnected,null);
});
test('EV at work + another car at home cannot write',async()=>{
  const f=setup();f.rows().carA.capabilitiesObj.longitude.value=1.1;
  const r=await f.engine.run('tick');assert.equal(r.code,'AWAY');assert.equal(f.calls.length,0);
});
test('disconnected charger, car unplugged and unknown charger block writes',async()=>{
  const f=setup();f.rows().chargerA.capabilitiesObj['alarm_generic.car_connected'].value=false;
  assert.equal((await f.engine.run('tick')).code,'NOT_CONNECTED');assert.equal(f.calls.length,0);
  f.rows().chargerA.capabilitiesObj['alarm_generic.car_connected'].value=true;
  f.rows().carA.capabilitiesObj.ev_charging_state.value='plugged_out';
  await f.engine.run('tick');assert.equal(f.calls.length,0);
  f.rows().chargerA.available=false;assert.equal((await f.engine.run('tick')).code,'NOT_CONNECTED');
});
test('old/future/missing status never writes changed values',async()=>{
  for(const stamp of [null,'bad',new Date(START-31*MINUTE).toISOString(),new Date(START+3*MINUTE).toISOString()]){
    const f=setup();f.rows().carA.capabilitiesObj.last_refresh.lastUpdated=stamp;
    f.engine.state.lastConnected=true;f.engine.state.refreshAfter=START+MINUTE;
    await f.engine.run('tick');assert.equal(f.calls.length,0);
  }
});
test('fresh global status permits unchanged older coordinates and target',()=>{
  const f=setup();for(const k of ['latitude','longitude','charge_target_slow','measure_battery'])
    f.rows().carA.capabilitiesObj[k].lastUpdated=new Date(START-120*MINUTE).toISOString();
  assert.equal(sample(f.rows(),f.engine.config,f.io.home(),START,null).eligible,true);
});
test('connection requests one refresh and never repeats on a timer',async()=>{
  const f=setup();f.rows().carA.capabilitiesObj.last_refresh.lastUpdated=new Date(START-40*MINUTE).toISOString();
  assert.equal((await f.engine.run('tick')).code,'REFRESH');assert.deepEqual(f.refreshes,['carA']);assert.equal(f.calls.length,0);
  f.advance(1);await f.engine.run('tick');assert.equal(f.refreshes.length,1);
  f.rows().carA.capabilitiesObj.last_refresh.lastUpdated=new Date(f.now()).toISOString();
  assert.equal((await f.engine.run('tick')).ok,true);assert.equal(f.calls.length,1);
});
test('12V guard and refresh cooldown are respected',async()=>{
  const f=setup();f.rows().carA.capabilitiesObj.ev_charging_state.value='plugged_out';
  f.rows().carA.capabilitiesObj['measure_battery.12V'].value=40;
  await f.engine.run('tick');assert.equal(f.refreshes.length,0);
  f.rows().carA.capabilitiesObj['measure_battery.12V'].value=90;
  f.engine.state.lastConnected=false;f.engine.state.refreshAfter=START+MINUTE;
  await f.engine.run('tick');assert.equal(f.refreshes.length,0);
});
test('fresh changed value is sent, unchanged value never reasserts hourly',async()=>{
  const f=setup();await f.engine.run('tick');assert.equal(f.calls.length,1);assert.match(f.calls[0].body.query,/value:70/);
  f.advance(120);await f.engine.run('tick');assert.equal(f.calls.length,1);
});
test('15 minute write limit persists across restart',async()=>{
  const f=setup();await f.engine.run('tick');f.rows().carA.capabilitiesObj.measure_battery.value=51;
  assert.equal((await f.engine.run('tick')).code,'WAIT');assert.equal(f.calls.length,1);
  const restarted=new Engine(f.io);assert.equal(restarted.status().connected,true);assert.equal(restarted.status().enabled,true);
  assert.equal((await restarted.run('tick')).code,'WAIT');assert.equal(f.calls.length,1);
});
test('external connection Flow supports arbitrary charger apps and resets after restart',async()=>{
  const f=setup();f.engine.config.connectionMode='external';
  assert.equal((await f.engine.run('tick')).code,'NOT_CONNECTED');
  await f.engine.run('connection',{connected:true});assert.equal(f.calls.length,1);
  await f.engine.run('connection',{connected:false});assert.equal(f.calls.length,1);
  assert.equal(new Engine(f.io).externalConnected,null);
});
test('Kia-only has one delayed arrival refresh and does not poll car indefinitely',async()=>{
  const f=setup();f.engine.config.connectionMode='kia';f.rows().carA.capabilitiesObj.ev_charging_state.value='plugged_out';
  await f.engine.run('tick');assert.equal(f.refreshes.length,0);
  f.advance(3);await f.engine.run('tick');assert.equal(f.refreshes.length,1);
  f.advance(60);await f.engine.run('tick');assert.equal(f.refreshes.length,1);
});
test('arrival refresh is cancelled if the vehicle leaves home',async()=>{
  const f=setup();f.engine.config.connectionMode='kia';f.rows().carA.capabilitiesObj.ev_charging_state.value='plugged_out';
  await f.engine.run('tick');f.rows().carA.capabilitiesObj.longitude.value=1.1;f.advance(3);
  await f.engine.run('tick');assert.equal(f.refreshes.length,0);
});
test('standalone Flow input needs no car or charger app',async()=>{
  const f=setup();f.engine.config={source:'flow',vehicleId:'vehicleA'};
  const r=await f.engine.run('flowInput',{soc:73.5,target:80});assert.equal(r.ok,true);assert.match(f.calls[0].body.query,/value:94/);
  assert.equal(f.refreshes.length,0);assert.equal((await f.engine.run('tick')).code,'FLOW');
});
test('login is manual, cooldown survives restart, password is never saved',async()=>{
  const f=setup();await f.engine.run('login',{email:'test@example.test',password:'dummy-password'});
  assert.ok(!JSON.stringify(f.store).includes('dummy-password'));
  assert.equal(f.store.session.token,'new-private-token');
  assert.ok(!JSON.stringify(f.engine.status()).includes('private-token'));
  assert.equal((await new Engine(f.io).run('login',{email:'test@example.test',password:'dummy-password'})).code,'LOGIN_WAIT');
  assert.equal(f.calls.length,1);
});
test('vehicle picker reads names, caches list and rejects IDs not belonging to session',async()=>{
  const f=setup();const v=await f.engine.run('vehicles');assert.deepEqual(v.vehicles,[{id:'vehicleA',name:'My offline car'}]);
  await f.engine.run('vehicles');assert.equal(f.calls.length,1);
  assert.equal((await f.engine.run('configure',{source:'flow',vehicleId:'other',confirmOffline:true})).code,'CONFIG');
});
test('two Tibber cars with identical names cannot be configured by guessing an ID',async()=>{
  const f=setup();f.reply({status:200,json:{data:{me:{myVehicles:{vehicles:[
    {id:'vehicleA',title:'Kia EV9'},{id:'vehicleB',title:'Kia EV9'},
  ]}}}}});
  assert.equal((await f.engine.run('configure',{source:'flow',vehicleId:'vehicleA',confirmOffline:true})).code,'VEHICLE_AMBIGUOUS');
});
test('safe test returns existing integer, arming does not require waking a car',async()=>{
  const f=setup();f.engine.state.enabled=false;f.rows().carA.capabilitiesObj.longitude.value=1.1;
  assert.equal((await f.engine.run('testWrite',{existingSoc:null,confirmed:true})).code,'TEST');
  assert.equal((await f.engine.run('testWrite',{existingSoc:40,confirmed:true})).ok,true);
  assert.match(f.calls.at(-1).body.query,/value:40/);
  assert.equal((await f.engine.run('enable',{confirmed:true})).ok,true);assert.equal(f.refreshes.length,0);
});
test('first planning sync respects fifteen minutes after safe test',async()=>{
  const f=setup();f.engine.config={source:'flow',vehicleId:'vehicleA'};f.engine.state.enabled=false;
  await f.engine.run('testWrite',{existingSoc:40,confirmed:true});await f.engine.run('enable',{confirmed:true});
  assert.equal((await f.engine.run('flowInput',{soc:50,target:80})).code,'WAIT');
  f.advance(1);assert.equal((await f.engine.run('flowInput',{soc:50,target:80})).code,'WAIT');
  f.advance(14);assert.equal((await f.engine.run('flowInput',{soc:50,target:80})).ok,true);
  f.advance(1);assert.equal((await f.engine.run('flowInput',{soc:55,target:80})).code,'WAIT');assert.equal(f.calls.length,2);
});
test('401 pauses, clears persisted session and never retries login',async()=>{
  const f=setup();f.reply({status:401,json:{}});
  assert.equal((await f.engine.run('tick')).code,'AUTH');assert.equal(f.engine.status().enabled,false);
  assert.equal(f.store.session,null);await f.engine.run('tick');assert.equal(f.calls.length,1);
});
test('429 honors longer Retry-After and blocks subsequent writes',async()=>{
  const f=setup();f.reply({status:429,retryAfter:'7200',json:{}});
  assert.equal((await f.engine.run('tick')).code,'RATE');f.advance(60);
  f.rows().carA.capabilitiesObj.last_refresh.lastUpdated=new Date(f.now()).toISOString();
  assert.equal((await f.engine.run('tick')).code,'WAIT');assert.equal(f.calls.length,1);
});
test('GraphQL errors do not leak server data and unknown vehicle schema fails closed',async()=>{
  const f=setup();f.reply({status:200,json:{errors:[{message:'private-server-value'}]}});
  const result=await f.engine.run('tick');assert.equal(result.code,'RESPONSE');assert.ok(!JSON.stringify(result).includes('private-server-value'));
  const g=setup();g.reply({status:200,json:{data:{me:{}}}});
  assert.equal((await g.engine.run('vehicles')).code,'VEHICLES');assert.equal(g.engine.status().enabled,true);
});
test('concurrent operations cannot double-write',async()=>{
  const f=setup();let release;f.reply(()=>new Promise(resolve=>{release=resolve;}));
  const pending=f.engine.run('tick');await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await f.engine.run('tick')).code,'BUSY');
  release({status:200,json:{data:{me:{setVehicleSettings:{id:'vehicleA'}}}}});
  assert.equal((await pending).ok,true);assert.equal(f.calls.length,1);
});
