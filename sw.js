const CACHE='gnotes-pro-v3-2';
const FILES=['./','index.html','styles.css','app.js','core.js','manifest.json','logo_simplificado.png','vendor/marked.js','vendor/purify.js','vendor/jszip.js','vendor/docx.js'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)));});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('gnotes-pro-v3-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  // Google Sheets requests never enter this cache. Only the application shell.
  event.respondWith(fetch(event.request).then(response=>{if(response.ok&&FILES.some(f=>new URL(f,self.registration.scope).pathname===url.pathname)){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}return response;}).catch(async()=>await caches.match(event.request)||((event.request.mode==='navigate')?await caches.match('index.html'):Response.error())));
});
