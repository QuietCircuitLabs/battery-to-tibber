'use strict';
window.BatterySetup={start(Homey){
  // Keep configuration in English, independently of Homey/browser language.
  const lang='en';
  document.documentElement.lang=lang;
  const $=id=>document.getElementById(id),t=(sv,en)=>lang==='sv'?sv:en;
  for(const node of document.querySelectorAll('[data-sv]'))node.textContent=node.dataset[lang];
  let state={},choices={cars:[],chargers:[]},vehicles=[],step=1,busy=false,configured=false;
  const note=(message,error=false)=>{$('live').textContent=lang==='sv'?message:SocLocale.translate(message,'en');$('live').className='notice'+(error?' error':'');};
  const api=(path,body={},method='POST')=>new Promise((resolve,reject)=>Homey.api(method,'/'+path,body,(error,result)=>{
    if(error)return reject(Error(t('Homey kunde inte nås. Försök igen.','Could not reach Homey. Try again.')));
    if(result?.status)state=result.status;
    if(result?.ok===false)return reject(Error(result.message));
    resolve(result);
  }));
  async function task(button,work){
    if(busy)return;busy=true;controls();button?.classList.add('busy');note(t('Arbetar…','Working…'));
    try{await work();if($('live').textContent===t('Arbetar…','Working…'))note(t('Klart. Fortsätt med nästa steg.','Done. Continue with the next step.'));}
    catch(error){note(error.message,true);}finally{busy=false;button?.classList.remove('busy');controls();}
  }
  function fill(id,rows,selected){const select=$(id);select.replaceChildren(new Option(t('Välj…','Choose…'),''));
    for(const row of rows)select.add(new Option(row.titles?.[lang]||row.name,row.id));
    if(rows.some(r=>r.id===selected))select.value=selected;else if(rows.length===1)select.value=rows[0].id;
  }
  const car=()=>choices.cars.find(row=>row.id===$('car').value);
  function carValues(selected={}){
    const oldCharger=$('charger').value;
    const c=car();fill('battery',(c?.batteries||[]).map(b=>({...b,titles:null,name:`${b.titles?.[lang]||b.name} · ${b.value??'—'} %`})),selected.socCapability);
    fill('charger',choices.chargers.map((charger,i)=>({id:String(i),deviceId:charger.id,name:charger.name}))
      .filter(charger=>charger.deviceId!==c?.id),oldCharger);
    fill('car-connection',c?.connections||[],selected.carConnectionCapability);
    fill('target-cap',c?.targets||[],selected.targetCapability);
    $('confirm-car').checked=false;
    $('refresh').querySelector('[value="kia"]').disabled=!c?.canRefresh;
    if(!c?.canRefresh&&$('refresh').value==='kia')$('refresh').value='off';
    $('home-check').disabled=!c?.hasPosition;
    if(!c?.hasPosition)$('home-check').checked=false;
    showReading();
  }
  function showReading(){const c=car(),b=c?.batteries.find(v=>v.id===$('battery').value);
    $('reading').textContent=b?`${t('Batteri','Battery')}: ${b.value??'—'} %. ${t('Tidsstämpelns ålder','Timestamp age')}: ${c.ageMinutes??'—'} min. `+
      (c.freshnessSource==='kia_status'?t('Verifierad Kia-status.','Verified Kia status.'):
        t('Tidsstämpeln kan avse senaste värdeändring.','The timestamp may represent the last value change.')):'';
  }
  function sourceValid(){if($('source').value==='flow')return true;
    const c=car(),b=c?.batteries.find(v=>v.id===$('battery').value);
    if(!c?.usable||!b||!Number.isFinite(b.value)||b.value<0||b.value>100||!$('confirm-car').checked)return false;
    return $('target-mode').value!=='device'||!!$('target-cap').value;
  }
  function signalsValid(){
    const mode=$('connection').value;
    if(mode==='none'&&!$('confirm-none').checked)return false;
    if(mode!=='none'&&!$('car-connection').value)return false;
    if(mode==='device'&&!$('charger').value)return false;
    if($('home-check').checked&&($('home-choice').value?!$('home-confirm').checked:!state.config?.home?.confirmed))return false;
    const age=Number($('max-age').value);return Number.isInteger(age)&&age>=5&&age<=120;
  }
  function controls(){
    $('device-options').hidden=$('source').value!=='device';$('flow-info').hidden=$('source').value!=='flow';
    $('target-cap').hidden=$('target-mode').value!=='device';$('fixed-target').hidden=$('target-mode').value!=='fixed';
    $('car-plug').hidden=$('connection').value==='none';$('charger-choice').hidden=$('connection').value!=='device';
    $('external-note').hidden=$('connection').value!=='external';$('none-warning').hidden=$('connection').value!=='none';
    $('home-options').hidden=!$('home-check').checked;
    for(const button of document.querySelectorAll('button'))button.disabled=busy;
    $('next').hidden=step===4;$('back').disabled=busy||step===1;
    $('next').disabled=busy||(step===1&&!sourceValid())||(step===2&&!signalsValid())||
      (step===3&&(!state.connected||!$('vehicle').value||!$('offline').checked));
    $('test').disabled=busy||!configured||!$('same').checked||$('existing').value===''||
      !Number.isInteger(Number($('existing').value))||Number($('existing').value)<0||Number($('existing').value)>100;
    $('enable').disabled=busy||!configured||!state.tested||!$('verified').checked;
    $('login').disabled=busy||!$('email').value||!$('password').value;
    $('load-vehicles').disabled=busy||!state.connected;
  }
  function showStep(next){step=next;for(let n=1;n<=4;n++)$('step-'+n).hidden=n!==step;
    $('step-number').textContent=t(`STEG ${step} / 4`,`STEP ${step} / 4`);$('progress').style.width=(step/4*100)+'%';controls();}
  function dashboard(){
    $('wizard').hidden=true;$('dashboard').hidden=false;
    $('current-state').textContent=(state.enabled?t('Aktiv. ','Active. '):t('Pausad. ','Paused. '))+
      (lang==='sv'?state.message||'':SocLocale.translate(state.message||'','en'));
    $('metrics').replaceChildren();
    for(const [label,value]of [[t('Bilens batteri','Vehicle battery'),state.snapshot?.soc],[t('Till Tibber','Sent to Tibber'),state.lastWrite?.value]]){
      const box=document.createElement('div');box.className='metric';const strong=document.createElement('strong');strong.textContent=(value??'—')+' %';
      const title=document.createElement('span');title.textContent=label;box.append(strong,title);$('metrics').append(box);
    }
    const at=state.nextWriteAt;
    $('next-write').textContent=at>Date.now()?t('Tidigaste nästa skrivning: ','Earliest next write: ')+new Date(at).toLocaleTimeString(lang):'';
    controls();
  }
  async function loadVehicles(){const result=await api('vehicles');vehicles=result.vehicles;
    fill('vehicle',vehicles,state.config?.vehicleId);note(t('Välj den manuellt tillagda bilen i Tibber.','Choose the manually added vehicle in Tibber.'));
  }
  async function init(){state=await api('status',{},'GET');$('add').hidden=!state.needsDevice;
    if(state.needsDevice){$('wizard').hidden=true;note(t('Lägg till appens enhet först.','Add the app device first.'));return;}
    choices=await api('options',{},'GET');fill('car',choices.cars,state.config?.carId);
    fill('charger',choices.chargers.map((c,i)=>({id:String(i),name:`${c.name} · ${c.capability}`})),
      String(choices.chargers.findIndex(c=>c.id===state.config?.chargerId&&c.capability===state.config?.chargerCapability)));
    carValues(state.config||{});
    if(state.config?.vehicleId&&state.tested){dashboard();note(t('Inställningarna är inlästa.','Settings loaded.'));}
    else{$('wizard').hidden=false;showStep(1);note(t('Välj källa för batterivärdet.','Choose your battery source.'));}
  }
  function configBody(){
    const source=$('source').value,body={source,vehicleId:$('vehicle').value,confirmOffline:$('offline').checked};
    if(source==='flow')return body;
    const charger=choices.chargers[Number($('charger').value)];
    return {...body,carId:$('car').value,socCapability:$('battery').value,confirmCar:$('confirm-car').checked,
      targetMode:$('target-mode').value,targetCapability:$('target-cap').value,fixedTarget:Number($('fixed-target').value),
      connectionMode:$('connection').value,carConnectionCapability:$('car-connection').value,
      chargerId:charger?.id,chargerCapability:charger?.capability,confirmNoConnection:$('confirm-none').checked,
      homeCheck:$('home-check').checked,homeConfirmed:$('home-choice').value?$('home-confirm').checked:!!state.config?.home?.confirmed,
      homeChoiceId:$('home-choice').value,maxAgeMinutes:Number($('max-age').value),
      refreshMode:$('refresh').value,refreshIntervalMinutes:Number($('refresh-interval').value)};
  }
  $('next').onclick=()=>task($('next'),async()=>{
    if(step===1){showStep($('source').value==='flow'?3:2);if(state.connected&&step===3)await loadVehicles();}
    else if(step===2){showStep(3);if(state.connected)await loadVehicles();}
    else if(step===3){
      const body=configBody();await api('configure',body);configured=true;$('verified').checked=false;
      const lines=[($('source').value==='device'?`${car().name} → `:'Flow → ')+vehicles.find(v=>v.id===$('vehicle').value)?.name];
      if(body.source==='device'){
        lines.push($('target-mode').selectedOptions[0].textContent+(body.targetMode==='fixed'?` · ${body.fixedTarget} %`:''));
        lines.push($('connection').selectedOptions[0].textContent+(body.connectionMode==='device'?' · '+$('charger').selectedOptions[0].textContent:''));
        lines.push(body.homeCheck?t('Hemkontroll: på','Home check: on'):t('Hemkontroll: av','Home check: off'));
        lines.push($('refresh').selectedOptions[0].textContent+(body.refreshMode!=='off'?` · ${body.refreshIntervalMinutes} min`:''));
      }else lines.push(t('Ditt Flow ansvarar för aktuella data och önskade inkopplingsvillkor.','Your Flow is responsible for current data and any desired connection checks.'));
      $('review').textContent=lines.join('\n');
      showStep(4);note(t('Valen är sparade. Automatiken är pausad.','Choices saved. Automation is paused.'));
    }
  });
  $('back').onclick=()=>{configured=false;showStep(step===3&&$('source').value==='flow'?1:step-1);};
  $('login').onclick=()=>task($('login'),async()=>{try{const result=await api('login',{email:$('email').value,password:$('password').value,remember:$('remember').checked});note(result.message);await loadVehicles();}finally{$('password').value='';}});
  $('load-vehicles').onclick=()=>task($('load-vehicles'),loadVehicles);
  $('test').onclick=()=>task($('test'),async()=>{const r=await api('test',{existingSoc:Number($('existing').value),confirmed:$('same').checked});note(r.message);});
  $('enable').onclick=()=>task($('enable'),async()=>{const r=await api('enable',{confirmed:$('verified').checked});note(r.message);dashboard();});
  for(const [id,path,body]of [['pause','pause',{}],['resume','enable',{confirmed:true}],['sync','sync',{}]])
    $(id).onclick=()=>task($(id),async()=>{const r=await api(path,body);note(r.message);dashboard();});
  $('edit').onclick=()=>task($('edit'),async()=>{await api('pause');const c=state.config||{};
    $('source').value=c.source==='flow'?'flow':'device';$('target-mode').value=c.source==='kia'?'device':c.targetMode||'none';
    $('fixed-target').value=c.fixedTarget||80;$('connection').value=['device','external','none'].includes(c.connectionMode)?c.connectionMode:'device';
    $('home-check').checked=c.source==='kia'||c.homeCheck===true;$('home-confirm').checked=!!c.home?.confirmed;
    $('refresh').value=c.refreshMode||'off';$('refresh-interval').value=String(c.refreshIntervalMinutes||60);$('max-age').value=c.maxAgeMinutes||30;
    carValues({...c,socCapability:c.socCapability||'measure_battery',targetCapability:c.targetCapability||'charge_target_slow',carConnectionCapability:c.carConnectionCapability||'ev_charging_state'});
    $('dashboard').hidden=true;$('wizard').hidden=false;configured=false;showStep(1);note(t('Automatiken är pausad medan du ändrar inställningarna.','Automation is paused while you change settings.'));
  });
  async function address(useHome){const r=await api('address',useHome?{}:{query:$('address-query').value});fill('home-choice',r.choices.map(c=>({id:c.id,name:c.address})));$('home-confirm').checked=false;note(r.message);}
  $('search-address').onclick=()=>task($('search-address'),()=>address(false));$('home-address').onclick=()=>task($('home-address'),()=>address(true));
  $('logout').onclick=()=>task($('logout'),async()=>{await api('logout');await init();note(t('Utloggad. Sparad inloggning är raderad.','Signed out. Saved credentials deleted.'));});
  $('reload').onclick=()=>task($('reload'),init);
  $('car').onchange=()=>{configured=false;carValues();controls();};$('battery').onchange=()=>{showReading();controls();};
  for(const node of document.querySelectorAll('input,select'))node.addEventListener('input',controls);
  $('home-choice').addEventListener('change',()=>{$('home-confirm').checked=false;controls();});
  Homey.ready();task($('reload'),init);
  const poll=setInterval(()=>{if(!busy&&!$('dashboard').hidden)task(null,async()=>{state=await api('status',{},'GET');dashboard();});},30000);
  window.addEventListener('unload',()=>clearInterval(poll),{once:true});
}};
