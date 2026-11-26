'use strict';
const https = require('node:https');
// Fixed destinations; never forward credentials through redirects or print responses.
function post(path, body, token) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({ hostname: 'app.tibber.com', path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data),
        ...(token ? { Authorization: `Bearer ${token}` } : {}) } }, res => {
      let chunks = [], size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 262144) { res.destroy(); reject(new Error('NETWORK')); }
        else chunks.push(chunk);
      });
      res.on('error', () => reject(new Error('NETWORK')));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
        resolve({ status: res.statusCode, retryAfter: res.headers['retry-after'], json });
      });
    });
    const timer = setTimeout(() => req.destroy(), 15000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', () => reject(new Error('NETWORK')));
    req.end(data);
  });
}
module.exports = { post };
