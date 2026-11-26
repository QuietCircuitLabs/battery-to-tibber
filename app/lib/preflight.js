'use strict';
const {options,planning,MINUTE}=require('./policy');
function preferred(rows){
  const ev9=rows.filter(row=>/\bev\s*9\b/i.test(row.name));
  return ev9.length===1?ev9[0].id:rows.length===1?rows[0].id:null;
}
function preflight(apps,devices,now=Date.now()){
  const app=Object.values(apps||{}).find(a=>a.id==='com.kia');
  const data=options(devices);
  let code='READY',message='Kia-appen och bilens uppgifter finns i Homey.';
  if(!app){code='KIA_MISSING';message='Installera Kia-appen i Homey och lägg till din EV9 där. Kom sedan tillbaka hit.';}
  else if(app.enabled===false||app.crashed){code='KIA_DISABLED';message='Kia-appen är avstängd eller har stannat. Starta den i Homey och försök igen.';}
  else if(app.ready===false){code='KIA_STARTING';message='Kia-appen startar. Vänta en stund och kontrollera igen.';}
  else if(!Object.values(devices||{}).some(d=>/homey:app:com\.kia(?=[:\s]|$)/.test((d.driverId||'')+' '+(d.driverUri||'')))){
    code='KIA_NO_CAR';message='Kia-appen är installerad. Lägg nu till din EV9 i den appen.';
  }else if(!data.cars.length){code='KIA_DATA_MISSING';message='Kia-bilen finns, men batteri, AC-gräns, inkopplingsstatus eller GPS saknas. Kontrollera bilen i Kia-appen.';}
  const cars=data.cars.map(row=>{
    const d=devices[row.id],c=d.capabilitiesObj;let valid=true,soc,target;
    try{planning(c.measure_battery.value,c.charge_target_slow.value);soc=c.measure_battery.value;target=Number(c.charge_target_slow.value);}catch{valid=false;}
    valid=valid&&d.available!==false&&Number.isFinite(c.latitude.value)&&Number.isFinite(c.longitude.value);
    const stamp=Date.parse(c.last_refresh.lastUpdated),age=Number.isFinite(stamp)?Math.round((now-stamp)/MINUTE):null;
    return {...row,usable:valid,soc,target,ageMinutes:age,stale:age===null||age>30||age< -2};
  });
  if(code==='READY'&&!cars.some(c=>c.usable)){code='KIA_DATA_MISSING';message='Bilen finns, men har ännu inga användbara värden. Kontrollera anslutningen i Kia-appen.';}
  return {code,message,ready:code==='READY',cars,chargers:data.chargers,
    preferredCarId:preferred(cars.filter(c=>c.usable)),preferredChargerId:data.chargers.length===1?data.chargers[0].id:null};
}
module.exports={preflight,preferred};
