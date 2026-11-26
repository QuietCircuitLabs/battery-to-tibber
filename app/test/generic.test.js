'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Engine}=require('../lib/engine');
const {discover,sampleDevice}=require('../lib/device-source');
const {MINUTE}=require('../lib/policy');
const START=Date.parse('2026-11-16T12:00:00Z');
const cap=(value,type='number',at=START)=>({value,type,lastUpdated:new Date(at).toISOString()});
function fixture(){
  let now=START;
  const devices={car:{id:'car',name:'A different electric car',driverUri:'homey:app:org.example.car',capabilitiesObj:{
    measure_battery:cap(61.5),charge_plugged_in:cap(true,'boolean')}},
    charger:{id:'charger',name:'A different charger',capabilitiesObj:{vehicle_connected:cap(true,'boolean')}}};
  const config={source:'device',carId:'car',socCapability:'measure_battery',vehicleId:'v',targetMode:'none',
    connectionMode:'device',carConnectionCapability:'charge_plugged_in',chargerId:'charger',chargerCapability:'vehicle_connected',
    homeCheck:false,maxAgeMinutes:30,refreshMode:'off',refreshIntervalMinutes:60};
  const store={config,state:{enabled:true,tested:true},session:{token:'fixture-session'}};
  const writes=[],refreshes=[],triggers=[];
  const io={now:()=>now,load:k=>structuredClone(store[k]),save:async(k,v)=>{store[k]=structuredClone(v);},
    home:()=>({lat:NaN,lon:NaN}),devices:async()=>devices,refresh:async id=>refreshes.push(id),requestRefresh:async()=>triggers.push(now),
    post:async(p,b)=>{
      if(b.query.includes('myVehicles'))return {status:200,json:{data:{me:{myVehicles:{vehicles:[{id:'v',title:'My manual car'}]}}}}};
      writes.push(b.query);return {status:200,json:{data:{me:{setVehicleSettings:{id:'v'}}}}};
    }};
  return {devices,config,store,io,writes,refreshes,triggers,engine:new Engine(io),advance:m=>{now+=m*MINUTE;},
    sample:()=>sampleDevice(devices,config,io.home(),now,null),body:()=>({...config,confirmCar:true,confirmOffline:true})};
}
test('any battery-reporting source is offered without Kia; own telemetry is excluded',()=>{
  const f=fixture();f.devices.remote={id:'remote',name:'Remote control',capabilitiesObj:{measure_battery:cap(80)}};
  f.devices.own={id:'own',driverUri:'homey:app:app.socbridge.ev9',capabilitiesObj:{measure_battery:cap(20)}};
  f.devices.volts={id:'volts',capabilitiesObj:{'measure_battery.12V':cap(90)}};
  f.devices.humidity={id:'humidity',capabilitiesObj:{measure_humidity:{...cap(50),units:'%'}}};
  assert.deepEqual(discover(f.devices).cars.map(c=>c.id),['car','remote']);
});
test('a custom state-of-charge percentage is supported without a manufacturer adapter',()=>{
  const f=fixture();f.devices.car.capabilitiesObj={'measure_soc':{...cap(61),units:'%'}};
  const row=discover(f.devices).cars.find(d=>d.id==='car');assert.equal(row.batteries[0].id,'measure_soc');
  f.config.socCapability='measure_soc';f.config.connectionMode='none';assert.equal(f.sample().planning,61);
});
test('battery health and 12V percentage cannot be selected as the traction battery charge',()=>{
  const f=fixture();Object.assign(f.devices.car.capabilitiesObj,{
    'measure_battery.soh':{...cap(100),title:'Batteriets hälsa (SoH)'},
    'battery_health':{...cap(100),units:'%'},
    'measure_battery.12V':{...cap(90),units:'%'},
  });
  const row=discover(f.devices).cars.find(d=>d.id==='car');
  assert.deepEqual(row.batteries.map(c=>c.id),['measure_battery']);
});
test('no GPS or AC target needed; both cable signals allow actual battery percentage',async()=>{
  const f=fixture();f.io.home=()=>{throw Error('Location must not be read without opt-in');};
  const r=await f.engine.run('tick');assert.equal(r.ok,true);assert.equal(r.snapshot,undefined);
  assert.equal(f.engine.snapshot.homeCheck,false);assert.equal(f.engine.snapshot.target,100);assert.equal(f.engine.snapshot.planning,62);
  assert.match(f.writes[0],/value:62/);assert.equal(f.refreshes.length,0);
});
test('car unplugged or missing confirmation blocks while a different car uses home charger',async()=>{
  for(const value of [false,null,'true']){const f=fixture();f.devices.car.capabilitiesObj.charge_plugged_in.value=value;
    assert.equal((await f.engine.run('tick')).code,'CAR_UNPLUGGED');assert.equal(f.writes.length,0);}
});
test('charger false, unknown or unavailable blocks writes',async()=>{
  for(const value of [false,null,'true']){const f=fixture();f.devices.charger.capabilitiesObj.vehicle_connected.value=value;
    assert.equal((await f.engine.run('tick')).code,'NOT_CONNECTED');assert.equal(f.writes.length,0);}
});
test('generic timestamp freshness is conservative and is not invented by reads or request events',async()=>{
  for(const age of [31,-3]){const f=fixture();f.devices.car.capabilitiesObj.measure_battery.lastUpdated=new Date(START-age*MINUTE).toISOString();
    assert.equal((await f.engine.run('tick')).code,'STALE');assert.equal(f.writes.length,0);}
  const f=fixture();f.devices.car.capabilitiesObj.measure_battery.lastUpdated=null;
  assert.equal((await f.engine.run('tick')).code,'STALE');
});
test('optional fixed or selected target compensates; target 100 restores actual percentage',()=>{
  const f=fixture();f.config.targetMode='fixed';f.config.fixedTarget=80;assert.equal(f.sample().planning,82);
  f.config.fixedTarget=100;assert.equal(f.sample().planning,62);
  f.config.targetMode='device';f.config.targetCapability='charge_target_slow';
  f.devices.car.capabilitiesObj.charge_target_slow=cap('80','enum');assert.equal(f.sample().planning,82);
  f.devices.car.capabilitiesObj.charge_target_slow.lastUpdated=new Date(START-40*MINUTE).toISOString();assert.equal(f.sample().fresh,false);
});
test('optional GPS remains strict when enabled; missing or away position blocks',async()=>{
  const f=fixture();f.engine.config.homeCheck=true;assert.equal((await f.engine.run('tick')).code,'HOME');assert.equal(f.writes.length,0);
  f.engine.config.home={confirmed:true,lat:1,lon:2};assert.equal((await f.engine.run('tick')).code,'POSITION');
  f.devices.car.capabilitiesObj.latitude=cap(1);f.devices.car.capabilitiesObj.longitude=cap(3);
  assert.equal((await f.engine.run('tick')).code,'AWAY');assert.equal(f.writes.length,0);
});
test('disabled connection check requires explicit acknowledgement in server configuration',async()=>{
  const f=fixture();const body={...f.body(),connectionMode:'none'};
  assert.equal((await f.engine.run('configure',body)).code,'CONFIG');
  assert.equal((await f.engine.run('configure',{...body,confirmNoConnection:true})).ok,true);
  assert.equal(f.engine.config.homeCheck,false);
});
test('configuration validates ownership and explicit car/battery/target/connection selections',async()=>{
  const f=fixture();
  for(const patch of [{confirmCar:false},{socCapability:'onoff'},{carId:'missing'},{targetMode:'device',targetCapability:'missing'},
    {carConnectionCapability:'onoff'},{chargerId:'car'},{chargerCapability:'onoff'},{refreshMode:'kia'},
    {maxAgeMinutes:999},{refreshIntervalMinutes:1}]){
    assert.equal((await f.engine.run('configure',{...f.body(),...patch})).code,'CONFIG');
  }
  assert.equal((await f.engine.run('configure',f.body())).ok,true);
});
test('no generic periodic car API calls unless refresh was explicitly configured',async()=>{
  const f=fixture();for(let n=0;n<80;n++){await f.engine.run('tick');f.advance(1);}
  assert.equal(f.refreshes.length,0);assert.equal(f.triggers.length,0);assert.equal(f.writes.length,1);
});
test('opt-in Flow refresh requests persist their interval and never imply fresh battery data',async()=>{
  const f=fixture();f.engine.config.refreshMode='flow';
  f.devices.car.capabilitiesObj.measure_battery.lastUpdated=new Date(START-40*MINUTE).toISOString();
  assert.equal((await f.engine.run('tick')).code,'REFRESH');assert.equal(f.triggers.length,1);assert.equal(f.writes.length,0);
  await f.io.save('config',f.engine.config);f.engine=new Engine(f.io);f.advance(59);assert.equal((await f.engine.run('tick')).code,'STALE');assert.equal(f.triggers.length,1);
  f.advance(1);assert.equal((await f.engine.run('tick')).code,'REFRESH');assert.equal(f.triggers.length,2);assert.equal(f.writes.length,0);
});
test('refresh waits for charger; failure backs off instead of retrying every tick',async()=>{
  const f=fixture();f.engine.config.refreshMode='flow';f.devices.charger.capabilitiesObj.vehicle_connected.value=false;
  await f.engine.run('tick');assert.equal(f.triggers.length,0);
  f.devices.charger.capabilitiesObj.vehicle_connected.value=true;f.io.requestRefresh=async()=>{f.triggers.push('failed');throw Error('failure');};
  assert.equal((await f.engine.run('tick')).code,'NETWORK');f.advance(1);await f.engine.run('tick');assert.equal(f.triggers.length,1);
});
test('verified Kia adapter can refresh periodically but honors explicit choice and 12V guard',async()=>{
  const f=fixture();const car=f.devices.car;car.driverUri='homey:app:com.kia';car.settings={batteryAlarmLevel:50};
  Object.assign(car.capabilitiesObj,{last_refresh:cap('checked','string'),refresh_status:cap(false,'boolean'),'measure_battery.12V':cap(40)});
  f.engine.config.refreshMode='kia';await f.engine.run('tick');assert.equal(f.refreshes.length,0);
  car.capabilitiesObj['measure_battery.12V'].value=80;assert.equal((await f.engine.run('tick')).code,'REFRESH');assert.equal(f.refreshes.length,1);
  f.advance(30);await f.engine.run('tick');assert.equal(f.refreshes.length,1);
  f.advance(30);await f.engine.run('tick');assert.equal(f.refreshes.length,2);
});
test('external charger status expires and is unknown after restart',async()=>{
  const f=fixture();f.engine.config.connectionMode='external';
  assert.equal((await f.engine.run('tick')).code,'NOT_CONNECTED');
  await f.engine.run('connection',{connected:true});assert.equal(f.writes.length,1);
  f.advance(31);f.devices.car.capabilitiesObj.measure_battery=cap(62,'number',START+31*MINUTE);
  assert.equal((await f.engine.run('tick')).code,'NOT_CONNECTED');
  await f.io.save('config',f.engine.config);f.engine=new Engine(f.io);assert.equal((await f.engine.run('tick')).code,'NOT_CONNECTED');
});
test('new Flow card works without a target or any vehicle or charger API',async()=>{
  const f=fixture();f.engine.config={source:'flow',vehicleId:'v'};f.io.devices=async()=>{throw Error('must not read devices');};
  assert.equal((await f.engine.run('flowInput',{soc:73.5})).ok,true);assert.match(f.writes[0],/value:74/);
});
test('changing to generic setup keeps prior tested Tibber destination and pauses until enabled',async()=>{
  const f=fixture();const r=await f.engine.run('configure',f.body());assert.equal(r.ok,true);
  assert.equal(f.engine.state.enabled,false);assert.equal(f.engine.state.tested,true);assert.equal(f.writes.length,0);
});
