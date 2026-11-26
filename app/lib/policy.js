'use strict';
const MINUTE = 60000;
const BOOLEAN_CONNECTIONS = ['alarm_generic.car_connected','alarm_generic.vehicle_connected','car_connected','vehicle_connected','alarm_car_connected'];
const plugged = value => ['plugged_in','plugged_in_charging','plugged_in_paused','plugged_in_discharging'].includes(value);
function targetNumber(value) {
  return typeof value === 'string' && /^(50|60|70|80|90|100)$/.test(value) ? Number(value) : value;
}
function planning(soc, target) {
  target = targetNumber(target);
  if (typeof soc !== 'number' || !Number.isFinite(soc) || soc < 0 || soc > 100 ||
      typeof target !== 'number' || !Number.isInteger(target) || target < 50 || target > 100) throw Error('DATA');
  return Math.round(Math.min(100,Math.max(0,soc + 100-target)));
}
function coordinate(lat,lon) {
  return typeof lat==='number' && Number.isFinite(lat) && Math.abs(lat)<=90 &&
    typeof lon==='number' && Number.isFinite(lon) && Math.abs(lon)<=180;
}
function distanceMeters(a,b) {
  if(!coordinate(a?.lat,a?.lon)||!coordinate(b?.lat,b?.lon))return null;
  const radians = x => x*Math.PI/180;
  const dLat=radians(b.lat-a.lat),dLon=radians(b.lon-a.lon);
  const h=Math.sin(dLat/2)**2+Math.cos(radians(a.lat))*Math.cos(radians(b.lat))*Math.sin(dLon/2)**2;
  return 6371000*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))));
}
function connectionCapability(device) {
  return BOOLEAN_CONNECTIONS.find(id=>device.capabilitiesObj?.[id]?.type==='boolean') || null;
}
function options(devices) {
  const all=Object.values(devices||{});
  return {
    cars:all.filter(d=>/homey:app:com\.kia(?=[:\s]|$)/.test((d.driverId||'')+' '+(d.driverUri||''))&&
      ['measure_battery','charge_target_slow','latitude','longitude','ev_charging_state','last_refresh'].every(k=>d.capabilitiesObj?.[k]))
      .map(d=>({id:d.id,name:d.name})),
    chargers:all.map(d=>({id:d.id,name:d.name,capability:connectionCapability(d)})).filter(d=>d.capability),
  };
}
function sample(devices,config,home,now,externalConnected) {
  const car=devices?.[config.carId];
  if(!car||car.available===false||car.ready===false)throw Error('CAR');
  const caps=car.capabilitiesObj||{};
  const soc=caps.measure_battery?.value,target=targetNumber(caps.charge_target_slow?.value);
  const value=planning(soc,target);
  const time=cap=>cap?.lastUpdated?new Date(cap.lastUpdated).getTime():NaN;
  const statusTime=time(caps.last_refresh);
  const carPlugged=plugged(caps.ev_charging_state?.value);
  const point={lat:caps.latitude?.value,lon:caps.longitude?.value};
  const meters=distanceMeters(point,home);
  const homeValid=coordinate(home?.lat,home?.lon)&&!(home.lat===0&&home.lon===0);
  const atHome=homeValid&&meters!==null&&meters<=100;
  let chargerConnected=null;
  if(config.connectionMode==='kia')chargerConnected=carPlugged;
  else if(config.connectionMode==='external')chargerConnected=externalConnected;
  else {
    const charger=devices?.[config.chargerId];
    const cap=config.chargerCapability;
    if(charger&&charger.ready!==false&&charger.available!==false&&BOOLEAN_CONNECTIONS.includes(cap)) {
      const raw=charger.capabilitiesObj?.[cap]?.value;
      if(typeof raw==='boolean')chargerConnected=raw;
    }
  }
  const timestamps=[time(caps.measure_battery),time(caps.charge_target_slow),time(caps.latitude),time(caps.longitude),statusTime];
  const validTime=t=>Number.isFinite(t)&&t>0&&t-now<=2*MINUTE;
  const fresh=timestamps.every(validTime)&&typeof caps.last_refresh?.value==='string'&&
    caps.last_refresh.value.trim().length>0&&now-statusTime<=30*MINUTE;
  const ageMinutes=Number.isFinite(statusTime)?Math.max(0,Math.round((now-statusTime)/MINUTE)):null;
  const eligible=atHome&&carPlugged&&chargerConnected===true&&fresh;
  const reason=!homeValid?'HOME':meters===null?'POSITION':!atHome?'AWAY':chargerConnected!==true?'NOT_CONNECTED':
    !fresh?'STALE':!carPlugged?'CAR_UNPLUGGED':'READY';
  const battery12V=caps['measure_battery.12V']?.value,threshold=car.settings?.batteryAlarmLevel;
  const kiaDriver=/com\.(kia|hyundai)|com\.gruijter\.hyundai_kia/.test((car.driverUri||'')+' '+(car.driverId||''));
  const canRefresh=kiaDriver&&!!caps.refresh_status&&typeof battery12V==='number'&&Number.isFinite(battery12V)&&
    typeof threshold==='number'&&Number.isFinite(threshold)&&battery12V>threshold;
  return {soc,target,planning:value,statusTime,ageMinutes,atHome,distanceMeters:meters===null?null:Math.round(meters),
    carPlugged,chargerConnected,fresh,eligible,reason,canRefresh,
    odometer:typeof caps.measure_odo?.value==='number'?caps.measure_odo.value:null};
}
module.exports={MINUTE,BOOLEAN_CONNECTIONS,plugged,planning,distanceMeters,options,sample};
