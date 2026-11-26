'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('virtual telemetry migration preserves percentages and only changes its own capabilities',async()=>{
  const values=new Map([['onoff',true],['measure_battery',73.5],['measure_battery.planning',94]]);
  let attached=false;
  class Device {
    constructor(){this.homey={app:{attach:async()=>{attached=true;}}};}
    hasCapability(k){return values.has(k);}
    async addCapability(k){values.set(k,null);}
    getCapabilityValue(k){return values.get(k);}
    async setCapabilityValue(k,v){assert.ok(k.startsWith('measure_soc'));values.set(k,v);}
    async removeCapability(k){assert.ok(k.startsWith('measure_battery'));values.delete(k);}
    registerCapabilityListener(k){assert.equal(k,'onoff');}
  }
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../drivers/bridge/device.js'),'utf8'),{module,require:()=>({Device})});
  await new module.exports().onInit();
  assert.equal(values.get('measure_soc'),73.5);assert.equal(values.get('measure_soc.planning'),94);
  assert.equal(values.get('onoff'),true);assert.equal(values.has('measure_battery'),false);assert.equal(attached,true);
});
