'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {translate,en}=require('../settings/locale');
const {MESSAGES}=require('../lib/engine');
test('English covers every engine status and Swedish preserves original text',()=>{
  for(const [code,message]of Object.entries(MESSAGES)){
    assert.equal(translate(message,'sv'),message);
    assert.notEqual(translate(message,'en'),message,'Missing English status: '+code);
    assert.ok(!/[åäöÅÄÖ]/.test(translate(message,'en')),'Swedish remaining: '+code);
  }
});
test('dynamic values and dates survive English translation',()=>{
  assert.equal(translate('Tibber accepterade 100 %. Kontrollera i Tibber innan du aktiverar.','en'),
    'Tibber accepted 100 %. Check in Tibber before enabling automation.');
  assert.equal(translate('Steg 3 av 6.','en'),'Step 3 of 6.');
  assert.equal(translate('Nästa loginförsök är tillåtet efter 12:34.','en'),'The next sign-in attempt is allowed after 12:34.');
  for(const output of Object.values(en))assert.ok(!/[åäöÅÄÖ]/.test(output));
});
