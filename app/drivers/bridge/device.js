'use strict';
const Homey=require('homey');
module.exports=class BridgeDevice extends Homey.Device{
  async onInit(){
    // This virtual device displays vehicle telemetry. It has no physical
    // battery of its own and must not register a second battery in Homey.
    for(const [oldId,newId] of [['measure_battery','measure_soc'],['measure_battery.planning','measure_soc.planning']]){
      if(!this.hasCapability(newId))await this.addCapability(newId);
      if(this.hasCapability(oldId)){
        const value=this.getCapabilityValue(oldId);
        if(typeof value==='number'&&Number.isFinite(value))await this.setCapabilityValue(newId,value);
        await this.removeCapability(oldId);
      }
    }
    await this.homey.app.attach(this);
    this.registerCapabilityListener('onoff',async enabled=>{
      const r=await this.homey.app.run(enabled?'enable':'pause',{confirmed:true});
      if(!r.ok)throw Error(r.message);
    });
  }
  async onDeleted(){
    if(this.homey.app.device===this){this.homey.app.engine=null;this.homey.app.device=null;}
  }
};
