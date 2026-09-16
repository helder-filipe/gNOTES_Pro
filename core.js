/* gNOTES: data model shared by the interface and regression tests. */
(function (root) {
  'use strict';
  const fields = ['ID','Titulo','Conteudo','Plataforma','Estado','Categoria','Subcategoria','UrlMedia','UrlImagem','Fonte','Tags','LinksPara','DataCriacao','DataAtualizacao','DataConclusao','TempoDeEdicao','TempoDeLeitura','Tipo','DeletedAt','Version','LastOperation','ReviewDue','ReviewInterval','ReviewCount'];
  const fold = x => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,'');
  const text = x => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const aliases = {citacao:'Fonte',linkdaimagem:'UrlImagem',imagem:'UrlImagem',tempoedicao:'TempoDeEdicao',tempoleitura:'TempoDeLeitura'};
  const canonical = Object.fromEntries(fields.map(f=>[fold(f),f]));
  function normalize(raw) {
    const n = Object.fromEntries(fields.map(f=>[f,'']));
    for (const [key,value] of Object.entries(raw || {})) {
      const target = canonical[fold(key)] || aliases[fold(key)] || (fold(key).startsWith('linkspara')?'LinksPara':null);
      if (target) n[target] = String(value ?? '');
    }
    n.ID=n.ID.trim(); n.Version=Number(n.Version)||0;
    n.Estado=n.Estado||'Concluída'; n.Tipo=n.Tipo||'Nota permanente';
    return n;
  }
  function uid() { return 'n'+crypto.randomUUID().replace(/-/g,''); }
  function validId(id) { return /^[A-Za-z0-9_-]{1,100}$/.test(String(id))&&!['__proto__','constructor','prototype'].includes(String(id)); }
  function empty() { return {schema:3,notes:{},queue:[],conflicts:{},drafts:{},history:{},pins:[],lastSync:null}; }
  function upgrade(s) { return Object.assign(empty(),s,{schema:3}); }
  function links(n, notes) {
    const result = new Set(String(n.LinksPara||'').split(/[,;\n]+/).map(s=>s.trim()).filter(Boolean));
    for (const m of String(n.Conteudo||'').matchAll(/\[\[([^\]\n]+)\]\]/g)) {
      const target=m[1].split('|')[0].trim();
      if(notes[target]){result.add(target);continue;}
      const byTitle=Object.values(notes).filter(v=>!v.DeletedAt&&text(v.Titulo)===text(target));
      result.add(byTitle.length===1?byTitle[0].ID:target);
    }
    result.delete(n.ID); return [...result];
  }
  function merge(s, remote) {
    const pending=new Set(s.queue.map(o=>o.note.ID));
    const next={};
    for(const raw of remote) { const n=normalize(raw); if(n.ID)next[n.ID]=n; }
    for(const id of new Set([...pending,...Object.keys(s.conflicts)])) if(s.notes[id])next[id]=s.notes[id];
    s.notes=next;
    s.lastSync=new Date().toISOString();
    return s;
  }
  function enqueue(s,raw,operationId=uid()) {
    const note=normalize(raw);
    if(!validId(note.ID)) throw Error('A nota precisa de um identificador válido.');
    if(s.conflicts[note.ID]) throw Error('Resolve primeiro o conflito desta nota.');
    const previous=s.notes[note.ID];
    const baseVersion=Number(previous?.Version)||0;
    note.Version=baseVersion+1; note.LastOperation=operationId;
    if(previous) {
      s.history[note.ID] = [structuredClone(previous),...(s.history[note.ID]||[])].slice(0,30);
    }
    s.notes[note.ID]=note;
    s.queue.push({operationId,baseVersion,note:structuredClone(note),createdAt:new Date().toISOString()});
    return note;
  }
  function acknowledge(s,op,result) {
    if(result.status==='success') {
      s.queue=s.queue.filter(o=>o.operationId!==op.operationId);
      if(!s.queue.some(o=>o.note.ID===op.note.ID)) s.notes[op.note.ID]=normalize(result.note);
    } else if(result.status==='conflict') {
      const id=op.note.ID;
      s.conflicts[id]={local:structuredClone(s.notes[id]),remote:result.note?normalize(result.note):null,message:result.message||'A nota foi alterada noutro dispositivo.'};
      s.queue=s.queue.filter(o=>o.note.ID!==id);
    } else throw Error(result.message||'O servidor não confirmou a gravação.');
  }
  function search(notes,query) {
    const words=text(query).trim().split(/\s+/).filter(Boolean);
    return notes.map(n=>({n,score:words.reduce((sum,w)=>sum+(text(n.Titulo).includes(w)?10:0)+(text(n.Tags).includes(w)?7:0)+(text(n.Categoria).includes(w)?4:0)+(text(n.Conteudo).includes(w)?2:0)+(text(n.Fonte).includes(w)?2:0)+(text(n.ID).includes(w)?1:0),0)}))
      .filter(({n})=>words.every(w=>text([n.Titulo,n.Conteudo,n.Tags,n.Categoria,n.Subcategoria,n.Fonte,n.ID].join(' ')).includes(w)))
      .sort((a,b)=>b.score-a.score||String(b.n.DataAtualizacao).localeCompare(String(a.n.DataAtualizacao))).map(x=>x.n);
  }
  function markdown(n,notes) {
    const quote=x=>JSON.stringify(String(x||''));
    const tags=String(n.Tags||'').split(/[,;]+/).map(t=>t.trim()).filter(Boolean);
    let content=n.Conteudo.replace(/\[\[([^\]\n]+)\]\]/g,(full,target)=>{
      const [id,label]=target.split('|'); const found=notes[id.trim()]||Object.values(notes).find(x=>text(x.Titulo)===text(id.trim()));
      return found?'[['+found.ID+'|'+(label||found.Titulo)+']]':full;
    });
    const existing=new Set(links({...n,LinksPara:''},notes));
    const manual=links(n,notes).filter(id=>!existing.has(id));
    if(manual.length)content+='\n\n## Ligações\n'+manual.map(id=>'- [['+id+'|'+(notes[id]?.Titulo||id)+']]').join('\n');
    return '---\n'+['id: '+quote(n.ID),'title: '+quote(n.Titulo),'status: '+quote(n.Estado),'type: '+quote(n.Tipo),'category: '+quote(n.Categoria),'subcategory: '+quote(n.Subcategoria),'tags: '+JSON.stringify(tags),'created: '+quote(n.DataCriacao),'updated: '+quote(n.DataAtualizacao),'source: '+quote(n.Fonte)].join('\n')+'\n---\n\n# '+n.Titulo+'\n\n'+content+'\n';
  }
  function restoreBackup(raw) {
    if(!raw||typeof raw!=='object'||!raw.notes||!Array.isArray(raw.queue))throw Error('A cópia completa tem um formato inválido.');
    const s=empty();
    for(const [id,value]of Object.entries(raw.notes)){if(!validId(id))throw Error('Identificador inválido na cópia.');const n=normalize(value);if(n.ID!==id)throw Error('Identificadores inconsistentes na cópia.');s.notes[id]=n;}
    const seen=new Set();
    for(const op of raw.queue){if(!op||!validId(op.operationId)||seen.has(op.operationId)||!Number.isInteger(op.baseVersion)||op.baseVersion<0||!op.note||!validId(op.note.ID)||!s.notes[op.note.ID])throw Error('Alteração pendente inválida na cópia.');seen.add(op.operationId);s.queue.push({operationId:op.operationId,baseVersion:op.baseVersion,note:normalize(op.note),createdAt:String(op.createdAt||'')});}
    for(const [id,c]of Object.entries(raw.conflicts||{})){if(!validId(id)||!c.local)throw Error('Conflito inválido na cópia.');s.conflicts[id]={local:normalize(c.local),remote:c.remote?normalize(c.remote):null,message:String(c.message||'')};}
    for(const [id,d]of Object.entries(raw.drafts||{})){if(!validId(id)||!d.note)throw Error('Rascunho inválido na cópia.');s.drafts[id]={note:normalize({...d.note,ID:id}),baseVersion:Number(d.baseVersion)||0,savedAt:String(d.savedAt||'')};}
    for(const [id,items]of Object.entries(raw.history||{})){if(!validId(id)||!Array.isArray(items))throw Error('Histórico inválido na cópia.');s.history[id]=items.slice(0,30).map(normalize);}
    s.pins=Array.isArray(raw.pins)?raw.pins.filter(validId):[];s.lastSync=raw.lastSync?String(raw.lastSync):null;return s;
  }
  function quality(raw, notes={}) {
    const n=normalize(raw), p=n.Plataforma.toLowerCase(), moc=p.includes('moc')||n.Tipo==='Mapa de conteúdo';
    const words=n.Conteudo.trim()?n.Conteudo.trim().split(/\s+/).length:0;
    const minutes=value=>Math.floor(Math.max(0,parseFloat(value)||0)/60);
    const editMinutes=minutes(n.TempoDeEdicao), readMinutes=minutes(n.TempoDeLeitura);
    const origin=moc?35:/livro|e-book/.test(p)?30:/revista|artigo|jornal/.test(p)?25:p.includes('podcast')?15:/youtube|vídeo/.test(p)?5:/instagram|x|twitter/.test(p)?0:10;
    const parts={Texto:Math.min(Math.round(Math.log(words+1)*10),50),Origem:origin,
      Ligações:Math.min(links(n,notes).length*15,moc?120:60),
      Etiquetas:Math.min(new Set(n.Tags.split(/[,;]+/).map(t=>t.trim().toLowerCase()).filter(Boolean)).size*3,15),
      Imagem:n.UrlImagem?2:0,
      'Recurso sem reflexão':(n.UrlMedia||n.UrlImagem||/instagram|x/.test(p))&&words<30?-15:0,
      Edição:Math.min(editMinutes,30),Leitura:Math.min(Math.floor(readMinutes*.5),15)};
    const max=moc?267:202, rawScore=Math.max(0,Object.values(parts).reduce((a,b)=>a+b,0));
    const score=Math.min(100,Math.round(rawScore/max*100));
    const level=score>=70?3:score>=50?2:score>=30?1:0;
    return {score,level,label:['🥉 Superficial','🥈 Consistente','🥇 Elevada Qualidade','🏆 Académica / Profunda'][level],parts,rawScore,max,words,editMinutes,readMinutes};
  }
  const api={fields,normalize,uid,validId,empty,upgrade,restoreBackup,links,merge,enqueue,acknowledge,search,markdown,text,quality};
  if(typeof module!=='undefined'&&module.exports)module.exports=api; else root.GNotesCore=api;
})(typeof window!=='undefined'?window:this);
