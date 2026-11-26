'use strict';
// Inspect only expiry metadata from the TLS-authenticated login response.
// Never return JWT claims, session tokens, account data or refresh credentials.
function sessionInfo(result,now){
  let expiresAt=null;
  const token=result?.token;
  if(typeof token==='string'){
    const parts=token.split('.');
    if(parts.length===3&&parts[1].length<32768){
      try{const exp=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8')).exp;
        if(typeof exp==='number'&&Number.isFinite(exp)&&exp>0&&exp*1000<8640000000000000)expiresAt=exp*1000;
      }catch{}
    }
  }
  return {startedAt:now,expiresAt,hasRefreshCredential:
    typeof result?.refreshToken==='string'||typeof result?.refresh_token==='string'};
}
module.exports={sessionInfo};
