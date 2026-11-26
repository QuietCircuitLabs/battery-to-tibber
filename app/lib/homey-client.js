'use strict';
const http=require('node:http'),https=require('node:https');
async function createClient(homey){
  const base=await homey.api.getLocalUrl(),token=await homey.api.getOwnerApiToken();
  function request(method,path,body){
    const url=new URL(path,base),client=url.protocol==='https:'?https:http;
    if(!['http:','https:'].includes(url.protocol))throw Error('CAR');
    const data=body?JSON.stringify(body):null;
    return new Promise((resolve,reject)=>{
      const req=client.request(url,{method,agent:false,headers:{Authorization:`Bearer ${token}`,
        ...(data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{})}},res=>{
        const chunks=[];let bytes=0;
        res.on('data',c=>{bytes+=c.length;if(bytes>5*1024*1024){res.destroy();reject(Error('CAR'));}else chunks.push(c);});
        res.on('error',()=>reject(Error('CAR')));
        res.on('end',()=>{if(res.statusCode<200||res.statusCode>=300)return reject(Error('CAR'));
          try{resolve(chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):null);}catch{reject(Error('CAR'));}});
      });
      const timer=setTimeout(()=>req.destroy(),15000);
      req.on('close',()=>clearTimeout(timer));req.on('error',()=>reject(Error('CAR')));req.end(data);
    });
  }
  return {devices:()=>request('GET','/api/manager/devices/device/'),
    apps:()=>request('GET','/api/manager/apps/app/'),
    legacyStatus:()=>request('GET','/api/app/local.ev9.tibber/status'),
    // The only foreign-device write in the entire app is this Kia status request.
    refresh:id=>request('PUT',`/api/manager/devices/device/${encodeURIComponent(id)}/capability/refresh_status`,{value:true})};
}
module.exports={createClient};
