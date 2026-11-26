'use strict';
const Homey=require('homey');
const {createClient}=require('./lib/homey-client');
const {post}=require('./lib/transport');
const {Engine}=require('./lib/engine');
const {options}=require('./lib/policy');
const {preflight}=require('./lib/preflight');
const {discover}=require('./lib/device-source');
const {lookup}=require('./lib/geocoder');
const {randomUUID}=require('node:crypto');
const {translate}=require('./settings/locale');
module.exports=class SoCApp extends Homey.App{
  async onInit(){
    this.client=await createClient(this.homey);this.engine=null;this.device=null;this.addressCache=new Map();this.homeChoices=new Map();this.addressAfter=0;
    const bind=(id,action,body)=>this.homey.flow.getActionCard(id).registerRunListener(async args=>{
      const result=await this.run(action,body?body(args):args);
      if(!result.ok)throw Error(result.message);
      return true;
    });
    bind('sync','tick');bind('pause','pause');bind('resume','enable',()=>({confirmed:true}));
    bind('connected','connection',()=>({connected:true}));bind('disconnected','connection',()=>({connected:false}));
    bind('set_soc','flowInput');
    bind('set_soc_only','flowInput',args=>({soc:args.soc}));
    this.timer=this.homey.setInterval(()=>{if(this.engine?.state.enabled)this.run('tick').catch(()=>{});},60000);
    this.log('Battery to Tibber started. Background work requires activation.');
  }
  async attach(device){
    if(this.device&&this.device!==device)throw Error('Only one bridge is supported.');
    this.device=device;
    this.homeChoices=new Map(device.getStoreValue('setup_home_choices')||[]);
    this.engine=new Engine({load:key=>device.getStoreValue(key),save:async(key,value)=>{
      try{await device.setStoreValue(key,value);}catch{throw Error('STORAGE');}
    },
      devices:()=>this.client.devices(),refresh:id=>this.client.refresh(id),post,
      requestRefresh:()=>this.homey.flow.getTriggerCard('refresh_requested').trigger(),
      notify:excerpt=>this.homey.notifications.createNotification({excerpt:translate(excerpt,this.homey.i18n?.getLanguage()||'en')}),
      home:()=>({lat:this.homey.geolocation.getLatitude(),lon:this.homey.geolocation.getLongitude()})});
  }
  async run(action,body={}){
    if(!this.engine)return action==='status'?{needsDevice:true,connected:false,enabled:false,
      message:'Lägg först till en Tibber-uppdatering under Enheter → Lägg till → Battery to Tibber.'}:
      {ok:false,code:'DEVICE',message:'Lägg först till appens Tibber-uppdatering bland dina enheter.'};
    if(action==='enable'){
      try{
        const devices=await this.client.devices();
        if(Object.values(devices).some(d=>{
          const owner=(d.driverUri||'')+' '+(d.driverId||'');
          return !owner.includes('homey:app:app.socbridge.ev9')&&
            d.capabilitiesObj?.measure_soc&&d.capabilitiesObj?.['measure_soc.planning']&&
            d.capabilitiesObj?.onoff?.value===true;
        }))return {ok:false,code:'CONFLICT',message:'En annan Tibber-uppdatering är aktiv. Pausa den innan du aktiverar denna version.'};
        const apps=await this.client.apps();
        if(Object.values(apps).some(a=>a.id==='local.ev9.tibber'&&a.enabled)){
          const legacy=await this.client.legacyStatus();
          if(legacy.enabled)return {ok:false,code:'CONFLICT',message:'Den tidigare EV9-bryggan är aktiv. Pausa den innan du aktiverar denna version, så att bara en brygga uppdaterar Tibber.'};
        }
      }catch{return {ok:false,code:'CONFLICT',message:'Kunde inte kontrollera om en tidigare Tibber-uppdatering körs. Försök igen.'};}
    }
    const result=await this.engine.run(action==='sync'?'tick':action,body);
    const language=this.homey.i18n?.getLanguage()||'en';
    if(result.message)result.message=translate(result.message,language);
    if(result.status?.message)result.status.message=translate(result.status.message,language);
    if(this.device){
      const s=this.engine.status(),value=s.snapshot;
      await this.device.setCapabilityValue('onoff',s.enabled).catch(()=>{});
      if(value){
        await this.device.setCapabilityValue('measure_soc',value.soc).catch(()=>{});
        await this.device.setCapabilityValue('measure_soc.planning',value.planning).catch(()=>{});
      }
    }
    return result;
  }
  async getOptions(){
    const devices=await this.client.devices();
    const data={...discover(devices),ready:true,code:'READY',message:'Välj bilens batterienhet i Homey, eller använd Flow.'};
    return {...data,homeConfigured:!!this.engine?.config.home?.confirmed,
      home:this.engine?.config.home||null};
  }
  async resolveAddress({query}={}){
    if(!this.device)return {ok:false,message:'Lägg först till Tibber-uppdateringen bland dina enheter.'};
    if(query!==undefined&&typeof query!=='string')return {ok:false,message:'Ange en adress som text.'};
    const lat=this.homey.geolocation.getLatitude(),lon=this.homey.geolocation.getLongitude();
    const key=query?.trim()?String(query).trim().slice(0,250):`${lat},${lon}`;
    if(this.addressCache.has(key))return {ok:true,choices:this.addressCache.get(key)};
    if(Date.now()<this.addressAfter)return {ok:false,message:'Vänta några sekunder innan du söker igen.'};
    this.addressAfter=Date.now()+2000;
    try{
      const rows=await lookup({query,lat,lon});
      const choices=rows.slice(0,5).map(row=>{const id=randomUUID();this.homeChoices.set(id,{...row,confirmed:true});return {id,address:row.address};});
      while(this.homeChoices.size>30)this.homeChoices.delete(this.homeChoices.keys().next().value);
      await this.device.setStoreValue('setup_home_choices',[...this.homeChoices]);
      this.addressCache.set(key,choices);
      return {ok:true,choices,message:choices.length?'Välj och bekräfta din hemadress.':'Ingen adress hittades. Prova gata, nummer och ort.'};
    }catch{return {ok:false,message:'Adressökningen svarade inte. Försök igen om en stund.'};}
  }
  async configure(body){
    if(body.source==='device'&&body.homeCheck===true){
      const home=body.homeChoiceId?this.homeChoices.get(body.homeChoiceId):this.engine?.config.home;
      if(body.homeConfirmed!==true||!home?.confirmed)return {ok:false,message:'Bekräfta din hemadress innan du fortsätter.'};
      body={...body,home};
    }
    if(body.source==='kia'){
      const checks=preflight(await this.client.apps(),await this.client.devices());
      if(!checks.ready)return {ok:false,code:checks.code,message:checks.message};
      if(!checks.cars.some(c=>c.id===body.carId&&c.usable))return {ok:false,message:'Välj en Kia-bil med användbara uppgifter.'};
      const home=body.homeChoiceId?this.homeChoices.get(body.homeChoiceId):this.engine?.config.home;
      if(body.homeConfirmed!==true||!home?.confirmed)return {ok:false,message:'Bekräfta din hemadress innan du fortsätter.'};
      body={...body,home};
    }
    return this.run('configure',body);
  }
  async onUninit(){if(this.timer)this.homey.clearInterval(this.timer);}
};
