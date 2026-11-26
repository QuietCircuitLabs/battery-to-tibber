'use strict';
const {MINUTE,planning,options,sample}=require('./policy');
const {sessionInfo}=require('./session-info');
const {discover,sampleDevice,isKia}=require('./device-source');
const MESSAGES={
  BUSY:'En kontroll pågår redan.', LOGIN:'Logga in på Tibber.', LOGIN_WAIT:'Vänta innan du försöker logga in igen.',
  AUTH:'Tibber-sessionen har gått ut eller nekats. Logga in manuellt igen.', RATE:'Tibber begränsar anropen. Appen väntar.',
  NETWORK:'Tjänsten svarar inte. Appen väntar före nästa försök.', RESPONSE:'Tibber svarade på ett oväntat sätt. Synken har pausats.',
  VEHICLES:'Billistan kunde inte hämtas från Tibber. Inga batterivärden har ändrats.', CONFIG:'Slutför valen i installationsguiden.',
  VEHICLE_AMBIGUOUS:'Flera bilar har samma namn i Tibber. Ge dem olika namn där och hämta billistan igen så att rätt bil kan väljas.',
  TEST:'Skriv först tillbaka det värde som redan visas i Tibber och bekräfta testet.', DATA:'Ogiltigt batterivärde eller laddgräns.',
  CAR:'Den valda bilen är inte tillgänglig i Homey.', HOME:'Kontrollera hemmets plats i Homeys inställningar.',
  POSITION:'Bilens position saknas.', AWAY:'Bilen är längre än 100 meter från hemmet.', NOT_CONNECTED:'Väntar på kabelanslutning.',
  STALE:'Väntar på ny fordonsstatus.', CAR_UNPLUGGED:'Bilen har ännu inte bekräftat att den är inkopplad.',
  WAIT:'Väntar före nästa Tibber-skrivning.', PAUSED:'Automatiken är pausad.', FLOW:'Väntar på ett batterivärde från Flow.',
  REFRESH:'Statusuppdatering begärd från bilappen. Väntar på svaret.', UNCHANGED:'Oförändrat planeringsvärde. Ingen skrivning behövs.',
  READY:'Uppgifterna är aktuella och valda kontroller är uppfyllda.',
  STORAGE:'Homey kunde inte spara uppgifterna. Automatiken har pausats. Försök igen.',
  JUMP:'Batterivärdet ändrades orimligt snabbt. Väntar på nya uppgifter.',
};
function fault(code){const e=new Error(code);e.code=code;throw e;}
class Engine {
  #token=null;
  #credentials=null;
  #session=null;
  constructor(io){
    this.io=io;this.now=io.now||Date.now;
    this.config={source:'flow',connectionMode:'device',...io.load('config')};
    this.state={enabled:false,tested:false,loginAfter:0,writeAfter:0,blockedUntil:0,refreshAfter:0,...io.load('state')};
    const session=io.load('session');
    this.#token=typeof session?.token==='string'?session.token:null;
    this.#session=session?.meta||{startedAt:this.now(),expiresAt:null};
    if(this.state.autoLogin)this.#credentials=io.load('credentials')||null;
    if(!this.#token&&!this.#credentials)this.state.enabled=false;
    this.busy=false;this.externalConnected=null;this.externalConnectionSample=null;this.vehiclesCache=[];this.snapshot=null;
  }
  async save(){await this.io.save('state',this.state);}
  tokenValid(){return !!this.#token&&(!this.#session?.expiresAt||this.#session.expiresAt>this.now());}
  home(){return this.config.home?.confirmed?this.config.home:this.io.home();}
  status(){return {needsDevice:false,connected:this.tokenValid(),config:this.config,
    enabled:this.state.enabled,tested:this.state.tested,message:this.state.message||MESSAGES.PAUSED,
    lastCode:this.state.lastCode,lastWrite:this.state.lastWrite,snapshot:this.snapshot,
    credentialsSaved:!!this.#credentials,autoLogin:!!this.state.autoLogin,
    nextRenewalAt:this.#credentials&&this.state.enabled?Math.max(this.state.loginAfter,this.state.blockedUntil,
      (this.#session?.expiresAt||(this.#session?.startedAt||this.now())+180*MINUTE)-10*MINUTE):null,
    nextWriteAt:Math.max(this.state.writeAfter,this.state.blockedUntil),loginAfter:this.state.loginAfter};}
  async run(action,body={}){
    if(action==='status')return this.status();
    if(this.busy)return {ok:false,code:'BUSY',message:MESSAGES.BUSY};
    this.busy=true;
    try {const result=await this[action](body);await this.save();return {ok:true,...result,status:this.status()};}
    catch(error){
      const code=Object.hasOwn(MESSAGES,error.code||error.message)?(error.code||error.message):'RESPONSE';
      if(['AUTH','RESPONSE'].includes(code)){
        this.#token=null;
        const recover=code==='AUTH'&&error.operation==='/v4/gql'&&this.#credentials&&this.state.enabled;
        if(!recover){
          this.state.enabled=false;
          if(code==='AUTH')try{await this.io.notify?.('Tibber-uppdateringen har pausats. Öppna appen och kontrollera Tibber-inloggningen.');}catch{}
        }
        try{await this.io.save('session',null);}catch{this.state.enabled=false;}
      }
      if(code==='STORAGE'){this.state.enabled=false;this.#credentials=null;this.state.autoLogin=false;}
      this.state.lastCode=code;this.state.message=MESSAGES[code];
      try{await this.save();}catch{this.state.enabled=false;}
      return {ok:false,code,message:MESSAGES[code],status:this.status()};
    }finally{this.busy=false;}
  }
  note(code){this.state.lastCode=code;this.state.message=MESSAGES[code];return {code,message:MESSAGES[code]};}
  async request(path,body,useSession=true){
    if(useSession&&!this.#token)fault('LOGIN');
    if(this.now()<this.state.blockedUntil)fault('WAIT');
    let r;try{r=await this.io.post(path,body,useSession?this.#token:null);}catch{this.state.blockedUntil=this.now()+30*MINUTE;fault('NETWORK');}
    if(r.status===429){
      const seconds=Number(r.retryAfter);const delay=Number.isFinite(seconds)?seconds*1000:Date.parse(r.retryAfter)-this.now();
      this.state.blockedUntil=this.now()+Math.max(60*MINUTE,Number.isFinite(delay)?delay:0);
      this.state.loginAfter=Math.max(this.state.loginAfter,this.state.blockedUntil);fault('RATE');
    }
    if(r.status===401||r.status===403){const e=new Error('AUTH');e.operation=path;throw e;}
    if(r.status>=500){this.state.blockedUntil=this.now()+30*MINUTE;fault('NETWORK');}
    if(r.status!==200||!r.json)fault('RESPONSE');
    return r.json;
  }
  async authenticate(email,password){
    if(this.now()<Math.max(this.state.loginAfter,this.state.blockedUntil))fault('LOGIN_WAIT');
    if(typeof email!=='string'||!email.includes('@')||typeof password!=='string'||!password.length)fault('AUTH');
    this.state.loginAfter=this.now()+30*MINUTE;await this.save();
    const result=await this.request('/login.credentials',{'@type':'login',email,password},false);
    if(typeof result.token!=='string'||!result.token.length||/[\r\n]/.test(result.token))fault('AUTH');
    this.#token=result.token;
    this.#session=sessionInfo(result,this.now());
    // Device Store only: not App Settings, source, logs or public /userdata.
    await this.io.save('session',{token:this.#token,meta:this.#session});
  }
  async login({email,password,remember=false}){
    if(this.now()<Math.max(this.state.loginAfter,this.state.blockedUntil))fault('LOGIN_WAIT');
    this.state.enabled=false;this.vehiclesCache=[];
    await this.authenticate(email,password);
    this.#credentials=remember===true?{email,password}:null;
    this.state.autoLogin=remember===true;
    await this.io.save('credentials',this.#credentials);
    return {message:remember?'Ansluten. Inloggningen sparas lokalt för automatisk återanslutning.':'Ansluten utan sparat lösenord.'};
  }
  async ensureSession(){
    const renewAt=(this.#session?.expiresAt||(this.#session?.startedAt||this.now())+180*MINUTE)-10*MINUTE;
    if(this.tokenValid()&&(!this.#credentials||this.now()<renewAt))return;
    if(!this.#credentials){this.state.enabled=false;fault('LOGIN');}
    await this.authenticate(this.#credentials.email,this.#credentials.password);
  }
  async maintain(){
    if(!this.state.enabled)return {message:MESSAGES.PAUSED};
    if(this.now()<Math.max(this.state.loginAfter,this.state.blockedUntil))return {message:'Inväntar nästa tillåtna sessionskontroll.'};
    await this.ensureSession();return {message:'Tibber-anslutningen är kontrollerad.'};
  }
  async vehicles(){
    if(this.vehiclesCache.length&&this.now()-(this.vehiclesAt||0)<5*MINUTE)return {vehicles:this.vehiclesCache};
    await this.ensureSession();
    const result=await this.request('/v4/gql',{query:'query { me { myVehicles { vehicles { id title } } } }'});
    const rows=result.data?.me?.myVehicles?.vehicles;
    if(result.errors?.length||!Array.isArray(rows))fault('VEHICLES');
    this.vehiclesCache=rows.filter(x=>typeof x.id==='string'&&typeof x.title==='string').map(x=>({id:x.id,name:x.title}));
    this.vehiclesAt=this.now();return {vehicles:this.vehiclesCache};
  }
  async configure(body){
    if(!['device','kia','flow'].includes(body.source)||typeof body.vehicleId!=='string'||body.confirmOffline!==true)fault('CONFIG');
    const listed=(await this.vehicles()).vehicles;
    if(!listed.some(v=>v.id===body.vehicleId))fault('CONFIG');
    const selected=listed.find(v=>v.id===body.vehicleId);
    if(listed.filter(v=>v.name.trim().toLowerCase()===selected.name.trim().toLowerCase()).length>1)fault('VEHICLE_AMBIGUOUS');
    const next={source:body.source,vehicleId:body.vehicleId,confirmOffline:true,connectionMode:body.connectionMode||'device'};
    if(body.source==='device'){
      const devices=await this.io.devices(),choices=discover(devices,this.now());
      const car=choices.cars.find(c=>c.id===body.carId&&c.usable);
      if(!car||body.confirmCar!==true||!car.batteries.some(c=>c.id===body.socCapability))fault('CONFIG');
      next.carId=car.id;next.socCapability=body.socCapability;
      next.targetMode=body.targetMode||'none';
      if(!['none','fixed','device'].includes(next.targetMode))fault('CONFIG');
      if(next.targetMode==='fixed'){planning(0,body.fixedTarget);next.fixedTarget=body.fixedTarget;}
      if(next.targetMode==='device'){
        if(!car.targets.some(c=>c.id===body.targetCapability))fault('CONFIG');
        next.targetCapability=body.targetCapability;
      }
      if(!['device','external','none'].includes(next.connectionMode))fault('CONFIG');
      if(next.connectionMode==='none'&&body.confirmNoConnection!==true)fault('CONFIG');
      if(next.connectionMode!=='none'){
        if(!car.connections.some(c=>c.id===body.carConnectionCapability))fault('CONFIG');
        next.carConnectionCapability=body.carConnectionCapability;
      }
      if(next.connectionMode==='device'){
        const charger=choices.chargers.find(c=>c.id===body.chargerId&&c.capability===body.chargerCapability);
        if(!charger||charger.id===next.carId)fault('CONFIG');
        next.chargerId=charger.id;next.chargerCapability=charger.capability;
      }
      next.homeCheck=body.homeCheck===true;
      if(next.homeCheck){
        if(!car.hasPosition||body.home?.confirmed!==true||typeof body.home.address!=='string'||!body.home.address.trim()||
          !Number.isFinite(body.home.lat)||Math.abs(body.home.lat)>90||
          !Number.isFinite(body.home.lon)||Math.abs(body.home.lon)>180||
          (body.home.lat===0&&body.home.lon===0))fault('HOME');
        next.home=body.home;
      }
      next.maxAgeMinutes=body.maxAgeMinutes??30;
      if(!Number.isInteger(next.maxAgeMinutes)||next.maxAgeMinutes<5||next.maxAgeMinutes>120)fault('CONFIG');
      next.refreshMode=body.refreshMode||'off';
      if(!['off','kia','flow'].includes(next.refreshMode))fault('CONFIG');
      if(next.refreshMode==='kia'&&(!isKia(devices[car.id])||!car.canRefresh))fault('CONFIG');
      next.refreshIntervalMinutes=body.refreshIntervalMinutes??60;
      if(![30,60,120,360].includes(next.refreshIntervalMinutes))fault('CONFIG');
    }
    if(body.source==='kia'){
      const devices=await this.io.devices(),choices=options(devices);
      if(!choices.cars.some(c=>c.id===body.carId))fault('CONFIG');
      if(!['device','external','kia'].includes(next.connectionMode))fault('CONFIG');
      next.carId=body.carId;
      if(body.home){
        if(body.home.confirmed!==true||typeof body.home.address!=='string'||!body.home.address.trim()||
          !Number.isFinite(body.home.lat)||Math.abs(body.home.lat)>90||!Number.isFinite(body.home.lon)||Math.abs(body.home.lon)>180)fault('HOME');
        next.home=body.home;
      }
      if(next.connectionMode==='device'){
        const charger=choices.chargers.find(c=>c.id===body.chargerId);if(!charger)fault('CONFIG');
        next.chargerId=charger.id;next.chargerCapability=charger.capability;
      }
      const home=next.home||this.io.home();if(!Number.isFinite(home.lat)||!Number.isFinite(home.lon)||(home.lat===0&&home.lon===0))fault('HOME');
    }
    if(this.config.vehicleId!==next.vehicleId){this.state.tested=false;this.state.lastWrite=null;}
    this.config=next;this.state.enabled=false;this.state.lastConnected=null;this.state.lastHome=null;this.state.pendingRefreshAt=0;
    this.state.observation=null;this.snapshot=null;this.state.message=MESSAGES.PAUSED;this.state.lastCode='PAUSED';
    this.externalConnected=null;this.externalConnectionSample=null;await this.io.save('config',next);
    return {message:'Valen är sparade. Automatiken är pausad tills du aktiverar den.'};
  }
  async preview(){
    if(this.config.source==='flow')return this.note('FLOW');
    this.snapshot=this.config.source==='device'?
      sampleDevice(await this.io.devices(),this.config,this.config.homeCheck?this.home():null,this.now(),this.externalConnectionSample):
      sample(await this.io.devices(),this.config,this.home(),this.now(),this.externalConnected);
    return {snapshot:this.snapshot,...this.note(this.snapshot.reason)};
  }
  async write(value,kind){
    if(!this.config.vehicleId)fault('CONFIG');
    if(this.now()<Math.max(this.state.blockedUntil,this.state.writeAfter))fault('WAIT');
    await this.ensureSession();
    this.state.firstSyncPending=false;this.state.writeAfter=this.now()+15*MINUTE;await this.save();
    const query=`mutation { me { setVehicleSettings(id:${JSON.stringify(this.config.vehicleId)},settings:[{key:"offline.vehicle.batteryLevel",value:${value}}]){id}}}`;
    const result=await this.request('/v4/gql',{query});
    if(result.errors?.length||result.data?.me?.setVehicleSettings?.id!==this.config.vehicleId)fault('RESPONSE');
    this.state.lastWrite={value,at:this.now(),kind};
    return {message:`Tibber accepterade ${value} %.`};
  }
  async testWrite({existingSoc,confirmed}){
    if(this.state.enabled||confirmed!==true||!Number.isInteger(existingSoc)||existingSoc<0||existingSoc>100)fault('TEST');
    const result=await this.write(existingSoc,'test');this.state.tested=true;return result;
  }
  async enable({confirmed}){
    await this.ensureSession();if(!this.config.vehicleId)fault('CONFIG');
    if(!this.state.tested||confirmed!==true)fault('TEST');
    this.state.enabled=true;this.state.lastCode='WAIT';
    this.state.message='Aktiverad. Väntar på rätt anslutning och aktuella uppgifter.';
    return {message:this.state.message};
  }
  async pause(){this.state.enabled=false;return this.note('PAUSED');}
  async logout(){this.#token=null;this.#credentials=null;this.state.autoLogin=false;this.state.enabled=false;
    await this.io.save('session',null);await this.io.save('credentials',null);return this.note('LOGIN');}
  async connection({connected}){
    if(typeof connected!=='boolean'||this.config.connectionMode!=='external')fault('CONFIG');
    this.externalConnected=connected;this.externalConnectionSample={value:connected,at:this.now()};return this.tick();
  }
  async flowInput({soc,target}){
    if(this.config.source!=='flow')fault('CONFIG');if(!this.state.enabled)return this.note('PAUSED');
    const value=planning(soc,target===undefined?100:target);if(this.state.lastWrite?.value===value)return this.note('UNCHANGED');
    return this.write(value,'planning');
  }
  async tick(){
    if(!this.state.enabled)return this.note('PAUSED');
    // Renewal is independent of car freshness, cable events and deduplication.
    if(this.now()>=Math.max(this.state.loginAfter,this.state.blockedUntil))await this.ensureSession();
    if(this.config.source==='flow')return this.note('FLOW');
    if(this.config.source==='device')return this.deviceTick();
    const devices=await this.io.devices();
    const s=sample(devices,this.config,this.home(),this.now(),this.externalConnected);this.snapshot=s;
    const rising=s.chargerConnected===true&&this.state.lastConnected!==true;
    const arrival=s.atHome&&(this.state.lastHome!==true||
      (s.odometer!==null&&this.state.homeOdometer!==undefined&&s.odometer>this.state.homeOdometer+0.1));
    this.state.lastConnected=s.chargerConnected;this.state.lastHome=s.atHome;
    if(s.atHome&&s.odometer!==null)this.state.homeOdometer=s.odometer;
    // No charger signal: one delayed refresh on arrival, not recurring car polling.
    if(this.config.connectionMode==='kia'&&arrival)this.state.pendingRefreshAt=this.now()+2*MINUTE;
    if(!s.atHome)this.state.pendingRefreshAt=0;
    const due=this.state.pendingRefreshAt>0&&this.now()>=this.state.pendingRefreshAt;
    if(due)this.state.pendingRefreshAt=0;
    const ask=this.config.connectionMode==='kia'?due:rising;
    const needsRefresh=!s.fresh||s.ageMinutes>2||!s.carPlugged;
    if(ask&&needsRefresh&&s.canRefresh&&this.now()>=this.state.refreshAfter){
      this.state.refreshAfter=this.now()+30*MINUTE;await this.save();
      try{await this.io.refresh(this.config.carId);}catch{ return {...this.note('NETWORK'),message:'Kia-statusfrågan misslyckades. Inga upprepade försök görs.'};}
      return this.note('REFRESH');
    }
    if(!s.atHome||s.chargerConnected!==true||!s.carPlugged)return this.note(s.reason);
    if(this.state.lastWrite?.value===s.planning)return this.note('UNCHANGED');
    if(!s.fresh)return this.note('STALE');
    const previous=this.state.observation;
    if(previous&&(s.statusTime<previous.statusTime||Math.abs(s.soc-previous.soc)>Math.max(5,(s.statusTime-previous.statusTime)/MINUTE*2)))fault('JUMP');
    this.state.observation={soc:s.soc,statusTime:s.statusTime};
    return this.write(s.planning,'planning');
  }
  async deviceTick(){
    const s=sampleDevice(await this.io.devices(),this.config,this.config.homeCheck?this.home():null,this.now(),this.externalConnectionSample);
    this.snapshot=s;
    const connected=this.config.connectionMode==='none'||s.chargerConnected===true;
    const refreshAllowed=connected&&(!this.config.homeCheck||s.atHome);
    if(refreshAllowed&&this.config.refreshMode!=='off'&&this.now()>=this.state.refreshAfter){
      const adapter=this.config.refreshMode==='kia'&&s.canRefresh;
      const flow=this.config.refreshMode==='flow'&&typeof this.io.requestRefresh==='function';
      if(adapter||flow){
        this.state.refreshAfter=this.now()+(this.config.refreshIntervalMinutes||60)*MINUTE;
        await this.save();
        try{if(adapter)await this.io.refresh(this.config.carId);else await this.io.requestRefresh();}
        catch{return this.note('NETWORK');}
        return this.note('REFRESH');
      }
    }
    if(!s.eligible)return this.note(s.reason);
    if(this.state.lastWrite?.value===s.planning)return this.note('UNCHANGED');
    const previous=this.state.observation;
    if(previous&&previous.carId===this.config.carId&&
      (s.statusTime<previous.statusTime||Math.abs(s.soc-previous.soc)>Math.max(5,(s.statusTime-previous.statusTime)/MINUTE*2)))fault('JUMP');
    this.state.observation={carId:this.config.carId,soc:s.soc,statusTime:s.statusTime};
    return this.write(s.planning,'planning');
  }
}
module.exports={Engine,MESSAGES};
