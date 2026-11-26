'use strict';
const https=require('node:https');
// Only called after the user presses an address lookup button. No background
// location requests, credentials or Tibber tokens ever enter this module.
function lookup({query,lat,lon}){
  const forward=typeof query==='string'&&query.trim();
  const url=new URL(forward?'https://photon.komoot.io/api/':'https://photon.komoot.io/reverse');
  if(forward){url.searchParams.set('q',query.trim().slice(0,250));url.searchParams.set('limit','5');}
  else{if(!Number.isFinite(lat)||!Number.isFinite(lon))return Promise.reject(Error('HOME'));url.searchParams.set('lat',lat);url.searchParams.set('lon',lon);}
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{headers:{'User-Agent':'Homey-Tibber-SoC-Bridge/0.3 (private Homey beta)','Accept-Language':'sv,en;q=0.8'}},res=>{
      let size=0;const chunks=[];
      res.on('data',chunk=>{size+=chunk.length;if(size>262144)res.destroy();else chunks.push(chunk);});
      res.on('error',()=>reject(Error('ADDRESS')));
      res.on('end',()=>{
        if(res.statusCode!==200)return reject(Error('ADDRESS'));
        try{
          const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const rows=Array.isArray(parsed.features)?parsed.features:[];
          resolve(rows.filter(r=>Array.isArray(r.geometry?.coordinates)&&r.geometry.coordinates.every(Number.isFinite))
            .map(r=>{const p=r.properties||{};return {address:[
              [p.street||p.name,p.housenumber].filter(Boolean).join(' '),
              [p.postcode,p.city||p.town||p.village].filter(Boolean).join(' '),p.country,
            ].filter(Boolean).join(', '),lat:forward?r.geometry.coordinates[1]:lat,lon:forward?r.geometry.coordinates[0]:lon};})
            .filter(r=>r.address));
        }catch{reject(Error('ADDRESS'));}
      });
    });
    const timeout=setTimeout(()=>req.destroy(),12000);req.on('close',()=>clearTimeout(timeout));req.on('error',()=>reject(Error('ADDRESS')));
  });
}
module.exports={lookup};
