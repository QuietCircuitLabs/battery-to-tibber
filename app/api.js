'use strict';
const methods={};
for(const name of ['status','configure','login','vehicles','preview','testWrite','enable','pause','sync','logout'])
  methods[name]=({homey,body})=>homey.app.run(name,body||{});
methods.options=async({homey})=>{
  try{return {ok:true,...await homey.app.getOptions()};}
  catch{return {ok:false,message:'Kunde inte läsa Homeys enheter. Försök igen senare.'};}
};
methods.address=({homey,body})=>homey.app.resolveAddress(body||{});
methods.configure=({homey,body})=>homey.app.configure(body||{});
module.exports=methods;
