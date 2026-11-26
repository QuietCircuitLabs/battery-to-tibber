'use strict';
// Generic device input. No assumption that a battery-powered device is a car:
// setup requires the user to select and confirm the source explicitly.
const {MINUTE,planning,distanceMeters,BOOLEAN_CONNECTIONS,plugged}=require('./policy');
const OWN='homey:app:app.socbridge.ev9';
const driver=d=>`${d.driverUri||''} ${d.driverId||''}`;
const isKia=d=>/homey:app:com\.kia(?=[:\s]|$)/.test(driver(d));
const time=c=>c?.lastUpdated?Date.parse(c.lastUpdated):NaN;
const valid=(t,now)=>Number.isFinite(t)&&t>0&&t<=now+2*MINUTE;
const fresh=(t,now,age)=>valid(t,now)&&now-t<=age*MINUTE;
function batteryCapabilities(d){
  return Object.entries(d.capabilitiesObj||{}).filter(([id,c])=>
    (/^measure_battery(?:\.|$)/.test(id)||(c.units==='%'&&
      (/battery|(?:^|[._-])soc(?:$|[._-])|state.?of.?charge/i.test(id)||/battery|batteri|state.?of.?charge/i.test(JSON.stringify(c.title||'')))))&&
    !/12v|(?:^|[._-])soh(?:$|[._-])|health|degrad/i.test(id)&&
    !/health|hälsa|\bsoh\b/i.test(JSON.stringify(c.title||''))&&['number',undefined].includes(c.type))
    .map(([id,c])=>({id,name:typeof c.title==='string'?c.title:id,
      titles:c.title&&typeof c.title==='object'?c.title:id==='measure_battery'?{en:'Vehicle battery',sv:'Bilens batteri'}:null,value:c.value}));
}
function connectionCapabilities(d){
  return Object.entries(d.capabilitiesObj||{}).filter(([id,c])=>
    id==='ev_charging_state'||(c.type==='boolean'&&
      [...BOOLEAN_CONNECTIONS,'charging_cable_connected','charge_plugged_in','plugged_in'].includes(id)))
    .map(([id,c])=>({id,name:typeof c.title==='string'?c.title:id,
      titles:c.title&&typeof c.title==='object'?c.title:{en:'Cable connected',sv:'Laddkabel ansluten'},value:c.value}));
}
function discover(devices,now=Date.now()){
  const all=Object.values(devices||{}).filter(d=>!driver(d).includes(OWN)&&
    !/homey:app:local\.ev9\.tibber(?=[:\s]|$)/.test(driver(d))&&
    !(d.capabilitiesObj?.measure_soc&&d.capabilitiesObj?.['measure_soc.planning']));
  return {
    cars:all.filter(d=>batteryCapabilities(d).length).map(d=>{
      const batteries=batteryCapabilities(d),connections=connectionCapabilities(d);
      const stamp=isKia(d)?time(d.capabilitiesObj.last_refresh):time(d.capabilitiesObj[batteries[0].id]);
      return {id:d.id,name:d.name,usable:d.available!==false&&d.ready!==false,
        batteries,connections,targets:Object.entries(d.capabilitiesObj||{}).filter(([id,c])=>
          id==='charge_target_slow'||(/(?:target|limit)/i.test(id)&&c.units==='%'))
          .map(([id,c])=>({id,name:typeof c.title==='string'?c.title:id,value:c.value})),
        soc:batteries[0].value,ageMinutes:valid(stamp,now)?Math.max(0,Math.round((now-stamp)/MINUTE)):null,
        freshnessSource:isKia(d)?'kia_status':'battery_timestamp',canRefresh:isKia(d)&&!!d.capabilitiesObj.refresh_status,
        hasPosition:!!(d.capabilitiesObj.latitude&&d.capabilitiesObj.longitude)};
    }),
    chargers:all.flatMap(d=>connectionCapabilities(d).filter(c=>c.id!=='ev_charging_state')
      .map(c=>({id:d.id,name:d.name,capability:c.id}))),
  };
}
function connection(d,id){
  if(!d||d.ready===false||d.available===false||!connectionCapabilities(d).some(c=>c.id===id))return null;
  const value=d.capabilitiesObj[id].value;
  if(id==='ev_charging_state')return typeof value==='string'?
    plugged(value)?true:['plugged_out','unplugged','not_plugged_in'].includes(value)?false:null:null;
  return typeof value==='boolean'?value:null;
}
function sampleDevice(devices,config,home,now,external){
  const car=devices?.[config.carId];
  if(!car||car.available===false||car.ready===false)throw Error('CAR');
  if(!batteryCapabilities(car).some(c=>c.id===config.socCapability))throw Error('DATA');
  const caps=car.capabilitiesObj||{},soc=caps[config.socCapability]?.value;
  const target=config.targetMode==='device'?caps[config.targetCapability]?.value:
    config.targetMode==='fixed'?config.fixedTarget:100;
  const normalized=typeof target==='string'&&/^\d+(?:\.\d+)?$/.test(target)?Number(target):target;
  const value=planning(soc,normalized);
  // Only the verified Kia adapter treats last_refresh as a full status check.
  // Generic timestamps are conservative: last change != a proven live poll.
  const global=isKia(car)&&typeof caps.last_refresh?.value==='string'&&caps.last_refresh.value.trim()?time(caps.last_refresh):NaN;
  const statusTime=Number.isFinite(global)?global:time(caps[config.socCapability]);
  const maxAge=config.maxAgeMinutes||30;
  let current=fresh(statusTime,now,maxAge);
  if(config.targetMode==='device')current=current&&
    valid(time(caps[config.targetCapability]),now)&&
    (Number.isFinite(global)||fresh(time(caps[config.targetCapability]),now,maxAge));
  const carPlugged=connection(car,config.carConnectionCapability);
  if(config.connectionMode!=='none'){
    const c=caps[config.carConnectionCapability];
    current=current&&!!c&&valid(time(c),now)&&(Number.isFinite(global)||fresh(time(c),now,maxAge));
  }
  let chargerConnected=null;
  if(config.connectionMode==='device')chargerConnected=connection(devices[config.chargerId],config.chargerCapability);
  if(config.connectionMode==='external')chargerConnected=external&&fresh(external.at,now,maxAge)?external.value:null;
  if(config.connectionMode==='none')chargerConnected=true;
  const requireHome=config.homeCheck===true;
  const meters=distanceMeters({lat:caps.latitude?.value,lon:caps.longitude?.value},home);
  const atHome=meters!==null&&meters<=100;
  const homeValid=Number.isFinite(home?.lat)&&Number.isFinite(home?.lon)&&!(home.lat===0&&home.lon===0);
  if(requireHome)current=current&&['latitude','longitude'].every(id=>valid(time(caps[id]),now)&&
    (Number.isFinite(global)||fresh(time(caps[id]),now,maxAge)));
  const cableOK=config.connectionMode==='none'||(carPlugged===true&&chargerConnected===true);
  const reason=requireHome&&!homeValid?'HOME':requireHome&&meters===null?'POSITION':requireHome&&!atHome?'AWAY':
    config.connectionMode!=='none'&&carPlugged!==true?'CAR_UNPLUGGED':chargerConnected!==true?'NOT_CONNECTED':!current?'STALE':'READY';
  const battery12V=caps['measure_battery.12V']?.value,threshold=car.settings?.batteryAlarmLevel;
  const canRefresh=isKia(car)&&!!caps.refresh_status&&Number.isFinite(battery12V)&&Number.isFinite(threshold)&&battery12V>threshold;
  return {soc,target:normalized,planning:value,statusTime:Number.isFinite(statusTime)?statusTime:null,
    ageMinutes:valid(statusTime,now)?Math.max(0,Math.round((now-statusTime)/MINUTE)):null,
    freshnessSource:Number.isFinite(global)?'kia_status':'battery_timestamp',atHome,homeCheck:requireHome,
    distanceMeters:meters===null?null:Math.round(meters),carPlugged,chargerConnected,
    fresh:current,eligible:cableOK&&(!requireHome||atHome)&&current,reason,canRefresh};
}
module.exports={discover,sampleDevice,batteryCapabilities,connectionCapabilities,isKia};
