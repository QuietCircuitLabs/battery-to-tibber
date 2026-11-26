'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
function fixture(){
  const store=new Map(),geoCalls=[];let kiaPresent=true,legacyEnabled=true;
  const now=new Date().toISOString(),cap=value=>({value,lastUpdated:now});
  const devices={car:{id:'car',name:'EV9',driverId:'car',driverUri:'homey:app:com.kia',capabilitiesObj:{
    measure_battery:cap(80),charge_target_slow:cap('80'),latitude:cap(1),longitude:cap(2),last_refresh:cap('current'),ev_charging_state:cap('plugged_in'),
  }}};
  const client={apps:async()=>({...kiaPresent?{kia:{id:'com.kia',enabled:true,ready:true}}:{},legacy:{id:'local.ev9.tibber',enabled:true}}),
    devices:async()=>devices,legacyStatus:async()=>({enabled:legacyEnabled}),refresh:async()=>{throw Error('Must not refresh during setup');}};
  const homey={setInterval:()=>1,clearInterval:()=>{},flow:{getActionCard:()=>({registerRunListener:()=>{}})},
    geolocation:{getLatitude:()=>1,getLongitude:()=>2},notifications:{createNotification:async()=>{}}};
  class App {constructor(){this.homey=homey;}log(){}}
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),{module,Date,Map,
    require:name=>name==='homey'?{App}:name==='./lib/homey-client'?{createClient:async()=>client}:
      name==='./lib/geocoder'?{lookup:async query=>{geoCalls.push(query);return [{address:'Fixture street, Fixture city',lat:1,lon:2}];}}:
      name==='./lib/transport'?{post:async(p,b)=>({status:200,json:p==='/login.credentials'?{token:'fixture-token'}:
        b.query.includes('myVehicles')?{data:{me:{myVehicles:{vehicles:[{id:'v',title:'Kia EV9'}]}}}}:
        {data:{me:{setVehicleSettings:{id:'v'}}}}})}:name==='node:crypto'?require(name):require(path.join(root,name)),
  });
  let own=false;
  const device={getStoreValue:k=>store.get(k),setStoreValue:async(k,v)=>store.set(k,structuredClone(v)),
    getCapabilityValue:()=>own,setCapabilityValue:async(k,v)=>{assert.equal(k,'onoff');own=v;}};
  return {create:()=>new module.exports(),device,store,geoCalls,legacy:v=>{legacyEnabled=v;},kia:v=>{kiaPresent=v;}};
}
test('setup reads prerequisites without geocoding; explicit address choice survives app restart',async()=>{
  const f=fixture();let app=f.create();await app.onInit();await app.attach(f.device);
  assert.equal((await app.getOptions()).ready,true);assert.equal(f.geoCalls.length,0);
  const address=await app.resolveAddress({});assert.equal(address.ok,true);assert.equal(f.geoCalls.length,1);
  assert.equal(address.choices[0].lat,undefined);assert.equal(address.choices[0].lon,undefined);
  await app.onUninit();app=f.create();await app.onInit();await app.attach(f.device);
  await app.run('login',{email:'fixture@example.test',password:'fixture-password'});
  const body={source:'kia',carId:'car',vehicleId:'v',confirmOffline:true,connectionMode:'kia',homeConfirmed:true,homeChoiceId:address.choices[0].id};
  assert.equal((await app.configure(body)).ok,true);assert.equal(app.engine.config.home.address,'Fixture street, Fixture city');
  f.kia(false);assert.equal((await app.configure(body)).code,'KIA_MISSING');
  await app.onUninit();
});
test('server rejects unconfirmed/unknown home selection and prevents two active bridges',async()=>{
  const f=fixture(),app=f.create();await app.onInit();await app.attach(f.device);
  await app.run('login',{email:'fixture@example.test',password:'fixture-password'});
  const base={source:'kia',carId:'car',vehicleId:'v',confirmOffline:true,connectionMode:'kia'};
  assert.equal((await app.configure({...base,homeConfirmed:false})).ok,false);
  assert.equal((await app.configure({...base,homeConfirmed:true,homeChoiceId:'unknown'})).ok,false);
  const choice=(await app.resolveAddress({})).choices[0];
  assert.equal((await app.configure({...base,homeConfirmed:true,homeChoiceId:choice.id})).ok,true);
  await app.run('testWrite',{existingSoc:100,confirmed:true});
  assert.equal((await app.run('enable',{confirmed:true})).code,'CONFLICT');
  assert.equal(app.engine.status().enabled,false);
  f.legacy(false);assert.equal((await app.run('enable',{confirmed:true})).ok,true);
  await app.onUninit();
});
