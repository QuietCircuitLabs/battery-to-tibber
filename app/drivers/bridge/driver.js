'use strict';
const Homey=require('homey');
module.exports=class BridgeDriver extends Homey.Driver{
  async onPairListDevices(){
    if(this.getDevices().length)return [];
    return [{name:this.homey.i18n.getLanguage()==='sv'?'Tibber-uppdatering':'Tibber updates',data:{id:'bridge'}}];
  }
};
