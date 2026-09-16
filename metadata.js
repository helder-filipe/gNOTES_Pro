/* Public link previews. No note text is sent to these services. */
(function(root){
  'use strict';
  function publicUrl(value){
    try {
      const u=new URL(value), h=u.hostname.toLowerCase();
      if(!['http:','https:'].includes(u.protocol)||u.username||u.password||!h.includes('.')||h.includes(':')||/^(localhost|127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)||/\.(local|localhost|internal)$/.test(h))return '';
      return u.href;
    }catch{return '';}
  }
  function youtubeId(value){
    const safe=publicUrl(value);if(!safe)return '';
    const u=new URL(safe), h=u.hostname.toLowerCase();let id='';
    if(h==='youtu.be')id=u.pathname.split('/')[1];
    else if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','www.youtube-nocookie.com'].includes(h))id=u.searchParams.get('v')||u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1]||'';
    return /^[\w-]{11}$/.test(id)?id:'';
  }
  async function lookup(value,fetcher=root.fetch?.bind(root)){
    const url=publicUrl(value);if(!url)throw Error('Usa uma ligação pública http ou https.');
    if(/\.(png|jpe?g|webp|gif|avif)(?:$|[?#])/i.test(url))return {title:'',image:url};
    const id=youtubeId(url), fallback=id?'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg':'';
    try {
      const endpoint=id?'https://www.youtube.com/oembed?format=json&url='+encodeURIComponent(url):'https://api.microlink.io/?url='+encodeURIComponent(url);
      const response=await fetcher(endpoint,{signal:AbortSignal.timeout(12000),referrerPolicy:'no-referrer',credentials:'omit'});
      if(!response.ok)throw Error('Serviço indisponível');
      const json=await response.json();
      if(!id&&json.status!=='success')throw Error('Sem metadados');
      const data=id?json:json.data||{};
      return {title:String(data.title||'').slice(0,500),image:publicUrl(id?data.thumbnail_url:(data.image?.url||data.image))||fallback};
    }catch(error){if(fallback)return {title:'',image:fallback};throw Error('Não foi possível obter a capa. O site pode bloquear a consulta ou o serviço ter atingido o limite. Podes tentar novamente ou indicar uma imagem.');}
  }
  function validateImage(value,ImageClass=root.Image,timeoutMs=12000){
    const url=publicUrl(value);
    if(!url)return Promise.reject(Error('O endereço encontrado não é uma imagem pública válida.'));
    return new Promise((resolve,reject)=>{
      const img=new ImageClass();let timer;
      const finish=(ok)=>{clearTimeout(timer);img.onload=img.onerror=null;ok?resolve(url):reject(Error('O endereço da capa existe, mas a imagem não carregou. Pode ter expirado ou o site pode bloquear imagens externas.'));};
      img.referrerPolicy='no-referrer';
      img.onload=()=>finish(img.naturalWidth>0&&img.naturalHeight>0);
      img.onerror=()=>finish(false);
      timer=setTimeout(()=>finish(false),timeoutMs);img.src=url;
    });
  }
  const api={publicUrl,youtubeId,lookup,validateImage};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.GNotesMetadata=api;
})(typeof window!=='undefined'?window:globalThis);
