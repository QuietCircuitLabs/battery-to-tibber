'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
test('all app API routes require Homey authentication',()=>{
  const manifest=require('../app.json');
  for(const entry of Object.values(manifest.api))assert.ok(!entry.public);
});

test('settings JavaScript parses, masks password and never reads saved credentials',()=>{
  const html=fs.readFileSync(path.join(root,'settings/index.html'),'utf8');
  new vm.Script(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1]);
  assert.match(html,/id="password" type="password"/);assert.ok(!/Homey\.(get|set)\(/.test(html));
});
test('Homey client has exactly one device-write destination: refresh_status',()=>{
  const source=fs.readFileSync(path.join(root,'lib/homey-client.js'),'utf8');
  assert.equal((source.match(/request\('PUT'/g)||[]).length,1);assert.ok(source.includes('/capability/refresh_status'));
  assert.ok(!source.includes('/capability/charging_button'));assert.ok(!source.includes('/capability/charge'));
});
test('persistent session uses backend Device Store, never public userdata or app settings',()=>{
  const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
  assert.ok(source.includes('device.setStoreValue'));
  assert.ok(!source.includes('homey.settings.set'));
  assert.ok(!source.includes('/userdata'));
});
