/* Interface and confirmed, retryable Google Sheets synchronization. */
'use strict';
const C=window.GNotesCore;
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DEFAULT_ENDPOINT='https://script.google.com/macros/s/AKfycby6NxKDUGWkgUp0amdPSog6WrhVEIOyk8s2eUNJp1eXiI3k84n-vMKlSPOwPQBIS-o/exec';
const demo=new URLSearchParams(location.search).get('demo')==='1';
const STORAGE=demo?'gnotes_v3_demo':'gnotes_v3_library';
let storageFault=false;
function load(){try {const raw=localStorage.getItem(STORAGE);return raw?C.upgrade(JSON.parse(raw)):C.empty();}catch(e){storageFault=true;return C.empty();}}
let state=load(),view='all',category='',selected=null,editing=false,editBaseVersion=0,draftKey='',dirty=false,draftTimer,toastTimer,readingStart=0;
let endpoint=localStorage.getItem('gnotes_v3_endpoint')||DEFAULT_ENDPOINT;
let syncBusy=false,protocolReady=false,syncError='',legacy=false,reviewSession=null,historyItems=[];
const labels={all:'Todas as notas',drafts:'Por desenvolver',pinned:'Fixadas',graph:'Mapa de ligações',review:'Rever ideias',stats:'A minha atividade',trash:'Lixo'};
const date=s=>s?new Intl.DateTimeFormat('pt-PT',{day:'numeric',month:'short'}).format(new Date(s)||new Date()):'Sem data';
function safeDate(s){try{return date(s);}catch{return String(s).slice(0,16)||'Sem data';}}
const today=()=>new Date().toISOString().slice(0,10);
const active=()=>Object.values(state.notes).filter(n=>!n.DeletedAt);
const tags=n=>String(n.Tags||'').split(/[,;]+/).map(t=>t.trim()).filter(Boolean);
const words=n=>String(n.Conteudo||'').trim().split(/\s+/).filter(Boolean).length;
const urlSafe=s=>{try{const u=new URL(s);return ['http:','https:'].includes(u.protocol)?u.href:'';}catch{return '';}};
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5500);}
async function transaction(fn){
  const run=()=>{if(storageFault)throw Error('O armazenamento local não está disponível. Exporta uma cópia antes de continuar.');const next=load();if(storageFault)throw Error('Não foi possível ler a cópia local.');fn(next);try{localStorage.setItem(STORAGE,JSON.stringify(next));}catch(e){throw Error('Não há espaço para guardar no dispositivo. Exporta uma cópia; o texto continua no editor.');}state=next;};
  if(navigator.locks)await navigator.locks.request(STORAGE,run);else run();
  renderNavigation();renderStatus();
}
function confirmAction(title,message,label='Continuar'){return new Promise(resolve=>{const d=$('confirm-dialog');$('confirm-title').textContent=title;$('confirm-text').textContent=message;$('confirm-ok').textContent=label;const finish=value=>{d.close();resolve(value);};$('confirm-ok').onclick=()=>finish(true);$('confirm-cancel').onclick=()=>finish(false);d.oncancel=()=>resolve(false);d.showModal();});}
function seed(){
  if(!demo||Object.keys(state.notes).length)return;
  const sample=[
    {ID:'202607241010',Titulo:'Escrever para descobrir o que pensamos',Categoria:'Aprendizagem',Tags:'escrita, pensamento',Tipo:'Nota permanente',Conteudo:'Escrever não serve apenas para registar uma ideia já formada. É uma maneira de a descobrir.\n\nAo tentar explicar um conceito com as nossas palavras, tornamos visíveis as partes que ainda não compreendemos. A página devolve-nos perguntas que o pensamento, sozinho, deixa passar.\n\n## Da informação à compreensão\n\nUma nota útil começa por uma pergunta: **o que mudou na minha forma de ver este assunto?**\n\n- Reformular a ideia com palavras próprias.\n- Encontrar um exemplo concreto.\n- Ligar a uma ideia que já conhecemos.\n\n> Uma boa nota não guarda apenas uma resposta. Abre uma próxima pergunta.\n\nEste processo aproxima-se da [[202607241011|aprendizagem por recuperação]]: o esforço de reconstruir uma ideia fortalece a compreensão.',Fonte:'Nota de exemplo · reflexão sobre escrita e aprendizagem',DataCriacao:'2026-09-10',DataAtualizacao:'2026-09-11'},
    {ID:'202607241011',Titulo:'Recordar é diferente de reler',Categoria:'Aprendizagem',Tags:'memória, revisão',Conteudo:'Reler pode criar familiaridade. **Recuperar uma ideia sem olhar para a fonte** permite perceber se conseguimos explicá-la.\n\n## Uma pequena experiência\n\nFecha o livro e escreve três frases sobre o que acabaste de ler. Depois compara.\n\nA distância entre as duas versões mostra o que vale a pena rever. Liga-se a [[202607241010]].',DataCriacao:'2026-09-09',DataAtualizacao:'2026-09-10'},
    {ID:'202607241012',Titulo:'Uma ideia por nota, muitas ligações',Categoria:'Zettelkasten',Tags:'notas atómicas, conexões',Conteudo:'Uma nota atómica desenvolve **uma ideia central**. Pode ser curta ou longa; o importante é conseguir ligá-la a outros contextos sem trazer um assunto inteiro consigo.\n\nAs ligações dão contexto a [[202607241010]] e ajudam a construir [[202607241014]].',DataCriacao:'2026-09-08',DataAtualizacao:'2026-09-09'},
    {ID:'202607241013',Titulo:'A atenção precisa de espaço',Categoria:'Criatividade',Tags:'atenção, rotina',Estado:'Rascunho',Tipo:'Captura rápida',Conteudo:'Hipótese: deixar pequenos intervalos sem estímulos ajuda a reconhecer relações entre ideias.\n\nPor desenvolver: encontrar um exemplo e uma fonte para esta hipótese.',DataCriacao:'2026-09-08',DataAtualizacao:'2026-09-08'},
    {ID:'202607241014',Titulo:'Aprender, escrever, ligar',Categoria:'Zettelkasten',Tags:'mapa de conteúdo',Tipo:'Mapa de conteúdo',Conteudo:'## Um percurso pela biblioteca\n\n1. [[202607241010]]\n2. [[202607241011]]\n3. [[202607241012]]\n\nEste mapa reúne ideias que podem ser lidas como um percurso.',DataCriacao:'2026-09-07',DataAtualizacao:'2026-09-07'}
  ];
  sample.forEach(n=>state.notes[n.ID]=C.normalize({...n,Estado:n.Estado||'Concluída'}));state.pins=[sample[0].ID];localStorage.setItem(STORAGE,JSON.stringify(state));
}
function renderStatus(){
  const pending=state.queue.length,conflicts=Object.keys(state.conflicts).length;
  $('sync-label').textContent=demo?'Biblioteca de exemplo':syncBusy?'A verificar sincronização…':conflicts?`${conflicts} conflito(s) por resolver`:pending?`${pending} alteração(ões) por enviar`:legacy?'Ligação precisa de atualização':syncError?'Sem ligação · cópia local':protocolReady?'Sincronização confirmada':'Guardado neste dispositivo';
  $('sync-dot').classList.toggle('ready',!pending&&!syncError&&(protocolReady||demo));
  const b=$('connection-banner');b.hidden=demo||(!legacy&&!syncError&&!conflicts&&!storageFault);
  b.replaceChildren();
  if(!b.hidden){b.append(document.createTextNode(storageFault?'Não foi possível ler o armazenamento local. Não serão feitas gravações.':conflicts?'Há versões diferentes da mesma nota. Abre a nota assinalada para preservar ambas ou escolher a versão do servidor.':legacy?'As notas estão disponíveis. Atualiza o Apps Script para ativar a nova sincronização; as alterações ficam guardadas neste dispositivo.':syncError));const btn=document.createElement('button');btn.dataset.action='settings';btn.textContent='Ver ligação';b.append(btn);}
  const detail=$('connection-detail');if(detail)detail.textContent=demo?'Modo de exemplo: não envia dados.':legacy?'O endereço ainda responde com a versão anterior do Apps Script.':state.lastSync?'Última leitura do servidor: '+new Date(state.lastSync).toLocaleString('pt-PT'):'Ainda sem confirmação do servidor.';
}
function renderNavigation(){
  const notes=active();
  $('count-all').textContent=notes.length;$('count-drafts').textContent=notes.filter(n=>n.Estado==='Rascunho').length;$('count-pinned').textContent=notes.filter(n=>state.pins.includes(n.ID)).length;$('count-trash').textContent=Object.values(state.notes).filter(n=>n.DeletedAt).length;$('count-review').textContent=dueNotes().length;
  const cats=[...new Set(notes.map(n=>n.Categoria).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt'));
  $('category-count').textContent=cats.length;$('categories').innerHTML=cats.length?cats.map((cat,i)=>`<button class="nav-item ${category===cat?'active':''}" data-category="${esc(cat)}"><span class="category-dot" style="background:${['#80cbb9','#cdb079','#8fa7d5','#b29bd2'][i%4]}"></span><span>${esc(cat)}</span><span class="count">${notes.filter(n=>n.Categoria===cat).length}</span></button>`).join(''):'<p class="muted" style="padding:0 12px">As tuas categorias aparecem aqui.</p>';
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view&&!category));
  const drafts=Object.entries(state.drafts).filter(([key])=>key!==draftKey||!editing);
  const banner=$('draft-banner');banner.hidden=!drafts.length;
  if(drafts.length)banner.innerHTML=`Tens ${drafts.length} rascunho(s) recuperável(is). <button data-action="recover">Retomar a escrita</button>`;
}
function snippet(n,q=''){let t=n.Conteudo.replace(/<[^>]*>/g,'').replace(/\[\[([^\]]+)\]\]/g,(_,x)=>resolveLink(x)?.Titulo||x.split('|').pop()).replace(/[#*`>_]/g,'').replace(/\s+/g,' ');const pos=C.text(t).indexOf(C.text(q.trim().split(/\s+/)[0]||''));if(pos>60)t='…'+t.slice(Math.max(0,pos-35));return t.slice(0,160);}
function filtered(){let notes=Object.values(state.notes).filter(n=>view==='trash'?!!n.DeletedAt:!n.DeletedAt);if(view==='drafts')notes=notes.filter(n=>n.Estado==='Rascunho');if(view==='pinned')notes=notes.filter(n=>state.pins.includes(n.ID));if(category)notes=notes.filter(n=>n.Categoria===category);if($('status-filter').value)notes=notes.filter(n=>n.Estado===$('status-filter').value);notes=C.search(notes,$('search').value);if(!$('search').value.trim()||$('sort').value==='quality'){const sort=$('sort').value;notes.sort((a,b)=>sort==='quality'?C.quality(b,state.notes).score-C.quality(a,state.notes).score:sort==='title'?a.Titulo.localeCompare(b.Titulo,'pt'):sort==='old'?a.DataCriacao.localeCompare(b.DataCriacao):b.DataAtualizacao.localeCompare(a.DataAtualizacao));}return notes;}
function renderList(){
  const notes=filtered();$('list-count').textContent=notes.length;$('result-label').textContent=`${notes.length} ${notes.length===1?'nota':'notas'}`;
  $('note-list').innerHTML=notes.length?notes.map(n=>`<button class="note-card ${n.ID===selected?'selected':''}" data-note="${esc(n.ID)}" aria-pressed="${n.ID===selected}"><div class="card-meta"><span class="card-category">${esc(n.Categoria||'Sem categoria')}</span><span>${state.pins.includes(n.ID)?'☆ · ':''}${esc(safeDate(n.DataAtualizacao||n.DataCriacao))}</span></div>${coverMarkup(n.UrlImagem,true)}<h2>${esc(n.Titulo||'Sem título')}</h2><p>${esc(snippet(n,$('search').value))}</p>${qualityBadge(n)}<div class="card-bottom"><span class="card-tag">${esc(tags(n).slice(0,2).map(t=>'#'+t).join(' '))||'Sem etiquetas'}</span><span class="state-label ${n.Estado==='Rascunho'?'draft':''}">${state.conflicts[n.ID]?'Versões em conflito':!demo&&state.queue.some(o=>o.note.ID===n.ID)?'Por enviar':n.Estado==='Rascunho'?'Rascunho':C.links(n,state.notes).length+' ligações'}</span></div></button>`).join(''):`<div class="empty"><h2>${view==='trash'?'O lixo está vazio.':'Ainda sem notas aqui.'}</h2><p>${$('search').value?'Experimenta outras palavras ou remove os filtros.':'Cada ideia pode ser um novo ponto de partida.'}</p>${view==='trash'?'':'<button data-action="new">Criar uma nota</button>'}</div>`;
}
function resolveLink(target){const id=target.split('|')[0].trim();if(state.notes[id])return state.notes[id];const matches=active().filter(n=>C.text(n.Titulo)===C.text(id));return matches.length===1?matches[0]:null;}
function markdown(text){
  if(!window.marked||!window.DOMPurify)return '<p>'+esc(text).replace(/\n/g,'<br>')+'</p>';
  let html=marked.parse(String(text||''),{breaks:false,gfm:true});
  html=DOMPurify.sanitize(html,{FORBID_TAGS:['style','form','input','button','iframe','object','embed','svg','math'],FORBID_ATTR:['style','srcset']});
  const template=document.createElement('template');template.innerHTML=html;
  const walker=document.createTreeWalker(template.content,NodeFilter.SHOW_TEXT);const nodes=[];while(walker.nextNode())if(!walker.currentNode.parentElement?.closest('code,pre,a'))nodes.push(walker.currentNode);
  nodes.forEach(node=>{const parts=node.textContent.split(/(\[\[[^\]\n]+\]\])/g);if(parts.length===1)return;const fragment=document.createDocumentFragment();for(const part of parts){if(part.startsWith('[[')&&part.endsWith(']]')){const raw=part.slice(2,-2),target=resolveLink(raw),a=document.createElement('a');a.className='wikilink'+(!target||target.DeletedAt?' broken':'');a.textContent=raw.split('|')[1]||target?.Titulo||raw;a.href=target?'#note='+encodeURIComponent(target.ID):'#';if(target)a.dataset.note=target.ID;else a.dataset.missing=raw.split('|')[0];fragment.append(a);}else fragment.append(document.createTextNode(part));}node.replaceWith(fragment);});
  template.content.querySelectorAll('a:not([data-note]):not([data-missing])').forEach(a=>{const url=urlSafe(a.getAttribute('href'));if(url){a.href=url;a.target='_blank';a.rel='noopener noreferrer';}else a.removeAttribute('href');});
  template.content.querySelectorAll('img').forEach(img=>{const url=urlSafe(img.getAttribute('src'));if(!url)img.remove();else{img.src=url;img.loading='lazy';img.referrerPolicy='no-referrer';}});
  return template.innerHTML;
}


function coverMarkup(value,small=false){
  const url=urlSafe(value);if(!url)return '';
  return `<span class="cover-frame ${small?'cover-small':''}"><img class="${small?'card-cover':'cover'}" data-cover-image src="${esc(url)}" alt="${small?'':'Capa da nota'}" referrerpolicy="no-referrer"><span class="cover-message">A carregar capa…</span></span>`;
}
function coverLoaded(event){
  const img=event.target;if(!img.matches?.('img[data-cover-image]'))return;
  const frame=img.closest('.cover-frame');if(!frame)return;
  frame.classList.add('cover-ready');frame.classList.remove('cover-failed');
}
function coverFailed(event){
  const img=event.target;if(!img.matches?.('img[data-cover-image]'))return;
  const frame=img.closest('.cover-frame');if(!frame)return;
  frame.classList.add('cover-failed');frame.classList.remove('cover-ready');
  frame.querySelector('.cover-message').textContent='Capa indisponível';
  if(frame.closest('#cover-preview')&&$('cover-status'))$('cover-status').textContent='Esta imagem não carregou. Usa «Procurar outra capa» para voltar a consultar a ligação.';
}
document.addEventListener('load',coverLoaded,true);
document.addEventListener('error',coverFailed,true);

function qualityBadge(note){const q=C.quality(note,state.notes);return `<span class="quality-badge quality-${q.level}" title="${esc(q.label)}">IQR ${q.score}/100 · ${esc(q.label)}</span>`;}
function qualityPanel(note){const q=C.quality(note,state.notes);return `<details class="quality-panel"><summary>${qualityBadge(note)}</summary><p>Indicador de desenvolvimento da nota, calculado com a fórmula original.</p><div class="quality-parts">${Object.entries(q.parts).map(([key,value])=>`<span>${esc(key)} <strong>${value}</strong></span>`).join('')}</div><small>${q.rawScore}/${q.max} pontos brutos · Edição: ${q.editMinutes} min · Leitura: ${q.readMinutes} min</small></details>`;}
function refreshEditorExtras(){
  if(!editing||!$('editor-quality'))return;
  const note=gather(), opened=$('editor-quality').querySelector('details')?.open;
  $('editor-quality').innerHTML=qualityPanel(note);
  if(opened)$('editor-quality').querySelector('details').open=true;
  const image=urlSafe(note.UrlImagem), el=$('cover-preview');
  if(el.dataset.url!==image){el.dataset.url=image;el.innerHTML=coverMarkup(image);}
}
let coverRequest=0;
let coverTimer;
async function fetchCover(replaceExisting=false,includeTitle=false){
  if(!editing||!$('f-url'))return;
  const form=$('editor-form'), image=$('f-image'), title=$('f-title'), status=$('cover-status');
  const value=$('f-url').value, url=coverResources(gather())[0];
  if(!url){status.textContent='Acrescenta uma ligação em Fontes, recursos e ligações.';return;}
  if(image.value.trim()&&!replaceExisting){status.textContent='A capa atual foi preservada. Para procurar outra, limpa o endereço da imagem.';return;}
  const request=++coverRequest, initialTitle=title.value, initialImage=image.value;
  status.textContent='A procurar uma imagem para a capa…';
  try {
    const result=await GNotesMetadata.lookup(url);
    if(result.image)await GNotesMetadata.validateImage(result.image);
    if(request!==coverRequest||!editing||$('editor-form')!==form||$('f-url').value!==value)return;
    if(image.value===initialImage&&result.image)image.value=result.image;
    const host=new URL(url).hostname.replace(/^www\./,'');
    if(includeTitle&&title.value===initialTitle&&(!initialTitle.trim()||initialTitle===host)&&result.title)title.value=result.title;
    form.dispatchEvent(new Event('input',{bubbles:true}));
    status.textContent=result.image?'Capa obtida. Guarda a nota para a sincronizar.':'Este endereço não disponibilizou uma capa. Podes indicar uma imagem manualmente.';
  }catch(error){if(request===coverRequest&&editing&&$('editor-form')===form&&$('f-url').value===value)status.textContent=error.message;}
}


function coverResources(note){
  const found=[];
  for(const field of [note.UrlMedia,note.Fonte,note.Conteudo]){
    for(const match of String(field||'').matchAll(/https?:\/\/[^\s<>"\x27\[\]]+/gi)){
      const url=urlSafe(match[0].replace(/[),.;!?]+$/,'').replace(/&amp;/g,'&'));
      if(url&&!found.includes(url))found.push(url);
    }
  }
  return found;
}
const coverJobs=new Set();
async function fetchReaderCover(){
  const id=selected,note=state.notes[id];if(!note||note.DeletedAt||coverJobs.has(id))return;
  const status=$('reader-cover-status'),message=text=>{if(!editing&&selected===id&&$('reader-cover-status')===status)status.textContent=text;};
  const urls=coverResources(note);
  if(!urls.length){message('Adiciona uma ligação pública em «Editar nota → Fontes, recursos e ligações».');return;}
  if(state.conflicts[id]){message('Resolve o conflito desta nota antes de atualizar a capa.');return;}
  const originalImage=note.UrlImagem, source=urls[0];
  coverJobs.add(id);message('A procurar e verificar a capa…');
  try{
    const result=await GNotesMetadata.lookup(source);
    if(!result.image)throw Error('O site não disponibilizou uma imagem. Em sites como o Instagram, o acesso pode estar bloqueado.');
    await GNotesMetadata.validateImage(result.image);
    if(editing&&selected===id)throw Error('A nota está a ser editada. Usa o botão de capa no editor.');
    await transaction(s=>{
      const latest=s.notes[id];
      if(!latest||latest.DeletedAt||s.conflicts[id]||latest.UrlImagem!==originalImage||coverResources(latest)[0]!==source)throw Error('A nota mudou durante a consulta. Tenta novamente.');
      C.enqueue(s,{...latest,UrlImagem:result.image,DataAtualizacao:new Date().toISOString()});
    });
    renderList();
    if(!editing&&selected===id){renderReader();$('reader-cover-status').textContent='Capa atualizada e guardada. O título foi mantido.';}
    run(sync);
  }catch(error){message(error.message);}
  finally{coverJobs.delete(id);}
}

function noteStatus(n){return demo?'Exemplo · guardado neste dispositivo':state.conflicts[n.ID]?'Versões em conflito':state.queue.some(o=>o.note.ID===n.ID)?'Guardada neste dispositivo · por enviar':protocolReady?'Sincronizada com o Google Sheets':'Cópia local';}
function renderReader(){
  const n=state.notes[selected];if(!n){$('reader').innerHTML='<div class="empty"><div class="empty-symbol">✎</div><h2>Espaço para a próxima ideia.</h2><p>Cria uma nota ou abre uma da tua biblioteca.</p><button class="primary" data-action="new">Escrever uma nota</button></div>';return;}
  const outgoing=C.links(n,state.notes),back=active().filter(x=>x.ID!==n.ID&&C.links(x,state.notes).includes(n.ID));
  const suggestions=active().filter(x=>x.ID!==n.ID&&!outgoing.includes(x.ID)&&!back.some(b=>b.ID===x.ID)).map(x=>({x,score:tags(x).filter(t=>tags(n).map(C.text).includes(C.text(t))).length*2+(x.Categoria&&x.Categoria===n.Categoria?1:0)})).filter(v=>v.score).sort((a,b)=>b.score-a.score).slice(0,3).map(v=>v.x);
  const resources=coverResources(n);
  $('reader').innerHTML=`<div class="reader-toolbar"><div class="button-row"><button class="quiet back-list" data-action="back">← Notas</button><span class="status">${esc(noteStatus(n))}</span></div><div class="button-row">${n.DeletedAt?'<button class="primary" data-action="restore">Restaurar nota</button>':'<button class="quiet" data-action="pin" aria-label="Fixar ou desafixar nota">'+(state.pins.includes(n.ID)?'★':'☆')+'</button><button class="quiet" data-action="zen" title="Modo de leitura">⛶</button><button class="primary" data-action="edit">✎ Editar nota</button>'}</div></div>
  <article class="reader-body">${state.conflicts[n.ID]?`<div class="conflict-box"><strong>Existem duas versões desta nota.</strong><p>A tua versão está preservada. Podes guardá-la como outra nota ou recuperar a versão do servidor.</p><div class="button-row"><button data-action="keep-both">Preservar ambas</button><button data-action="use-remote">Usar versão do servidor</button></div></div>`:''}
  ${n.DeletedAt?'<div class="notice">Esta nota está no lixo. Podes restaurá-la a qualquer momento.</div>':''}
  <div class="note-type">${esc(n.Tipo)} ${n.Estado==='Rascunho'?'· Rascunho':''}</div><h1 class="note-heading">${esc(n.Titulo)}</h1><div class="note-metadata"><span>${esc(n.Categoria||'Sem categoria')}${n.Subcategoria?' / '+esc(n.Subcategoria):''}</span><span>Atualizada a ${esc(safeDate(n.DataAtualizacao))}</span><span>${Math.max(1,Math.ceil(words(n)/200))} min de leitura</span></div>
  ${qualityPanel(n)}<div class="tags">${tags(n).map(t=>`<button class="tag" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}</div>
  ${coverMarkup(n.UrlImagem)}${!n.DeletedAt?`<div class="cover-controls"><button class="quiet" data-action="${n.UrlImagem?'repair-cover':'cover'}">${n.UrlImagem?'Procurar outra capa':'Obter capa da ligação'}</button><small id="reader-cover-status" role="status">${resources.length?'': 'Esta nota não tem uma ligação pública. Adiciona-a em «Editar nota».'}</small></div>`:''}<div class="markdown">${markdown(n.Conteudo)}</div>
  ${n.Fonte||resources.length?`<div class="source"><strong>Fonte e referências</strong>${n.Fonte?'<p>'+esc(n.Fonte)+'</p>':''}${resources.map(url=>`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">↗ ${esc(url)}</a>`).join('')}</div>`:''}
  <section class="connections"><div class="section-label">Ligações desta ideia <span class="pill">${outgoing.length}</span></div>${outgoing.length?outgoing.map(id=>`<button class="link-card" ${state.notes[id]?'data-note="'+esc(id)+'"':'data-missing="'+esc(id)+'"'}>↗ ${esc(state.notes[id]?.Titulo||id)}${!state.notes[id]||state.notes[id].DeletedAt?'<small>Ligação por resolver</small>':''}</button>`).join(''):'<p class="muted">Liga esta ideia a outra nota usando [[ no editor.</p>'}</section>
  <section class="connections"><div class="section-label">Notas que apontam para aqui <span class="pill">${back.length}</span></div>${back.map(x=>`<button class="link-card" data-note="${esc(x.ID)}">↳ ${esc(x.Titulo)}<small>${esc(snippet(x,n.Titulo))}</small></button>`).join('')||'<p class="muted">As referências a esta nota aparecem aqui.</p>'}</section>
  ${suggestions.length&&!n.DeletedAt?`<section class="connections"><div class="section-label">Talvez queiras ligar</div>${suggestions.map(x=>`<button class="link-card suggested" data-connect="${esc(x.ID)}">＋ ${esc(x.Titulo)}<small>${esc(x.Categoria===n.Categoria?'Mesma categoria':'Etiquetas em comum')}</small></button>`).join('')}</section>`:''}
  <hr><div class="button-row"><button class="quiet" data-action="audio">Ouvir</button><button class="quiet" data-action="copy">Copiar</button><button class="quiet" data-action="markdown">Markdown</button><button class="quiet" data-action="word">Word</button><button class="quiet" data-action="history">Histórico</button>${!n.DeletedAt?'<button class="quiet danger" data-action="trash">Mover para o lixo</button>':''}</div></article>`;
}
async function leaveEditor(){if(editing&&dirty){await saveDraft();}if(window.speechSynthesis)speechSynthesis.cancel();editing=false;dirty=false;clearTimeout(draftTimer);}
async function selectNote(id){await leaveEditor();if(!state.notes[id])return toast('Esta ligação ainda não tem uma nota.');selected=id;draftKey='';readingStart=Date.now();if(['graph','review','stats'].includes(view)){view='all';category='';}showSurface();document.body.classList.add('note-open');renderList();renderReader();history.replaceState(null,'','#note='+encodeURIComponent(id));$('reader').focus({preventScroll:true});renderNavigation();}
function showSurface(){const tool=['graph','review','stats'].includes(view);$('split').hidden=tool;$('tool-view').hidden=!tool;$('view-label').textContent=category||labels[view];$('library-title').textContent=category||labels[view];}
async function changeView(next,cat=''){await leaveEditor();view=next;category=cat;draftKey='';document.body.classList.remove('note-open','menu-open');showSurface();renderNavigation();if(view==='graph')renderGraph();else if(view==='stats')renderStats();else if(view==='review')renderReviewHome();else{renderList();if(selected)renderReader();}}
const formFields={Titulo:'f-title',Conteudo:'f-content',Estado:'f-status',Tipo:'f-type',Categoria:'f-category',Subcategoria:'f-subcategory',Tags:'f-tags',Fonte:'f-source',UrlMedia:'f-url',UrlImagem:'f-image',LinksPara:'f-links',Plataforma:'f-platform'};
function gather(){const n=C.normalize(state.notes[selected]||{ID:selected,Estado:'Rascunho'});for(const [key,id] of Object.entries(formFields))if($(id))n[key]=$(id).value;return n;}
async function saveDraft(){if(!editing||!dirty)return;const note=gather();await transaction(s=>{s.drafts[draftKey]={note,baseVersion:editBaseVersion,savedAt:new Date().toISOString()};});dirty=false;if($('draft-status'))$('draft-status').textContent='Rascunho guardado neste dispositivo';}
async function openEditor(note,recover=true){
  await leaveEditor();selected=note.ID||C.uid();draftKey=selected;editing=true;editBaseVersion=Number(note.Version)||0;readingStart=Date.now();
  document.body.classList.remove('menu-open');
  if(recover&&state.drafts[draftKey]){note=state.drafts[draftKey].note;editBaseVersion=state.drafts[draftKey].baseVersion;}
  if(['graph','review','stats','trash'].includes(view))view='all';showSurface();document.body.classList.add('note-open');renderList();
  const options=(values,current)=>values.map(v=>`<option ${v===current?'selected':''}>${esc(v)}</option>`).join('');
  $('reader').innerHTML=`<div class="reader-toolbar"><div class="button-row"><button class="quiet" data-action="close-editor">← Voltar</button><span class="status">${state.notes[selected]?'Editar nota':'Nova ideia'}</span></div><button class="primary" data-action="save">Guardar nota</button></div>
  <form id="editor-form" class="editor"><label for="f-title" class="muted">Título da ideia</label><input id="f-title" class="editor-title" required maxlength="500" placeholder="Uma ideia começa aqui…" value="${esc(note.Titulo)}">
  <div class="editor-tools"><button type="button" data-format="bold" title="Negrito"><b>B</b></button><button type="button" data-format="italic" title="Itálico"><i>I</i></button><button type="button" data-format="heading">H2</button><button type="button" data-format="quote">Citação</button><button type="button" data-format="list">Lista</button><button type="button" data-format="link">[[ Ligação ]]</button><button type="button" data-action="preview">Pré-visualizar</button><small id="word-count">${words(note)} palavras</small></div>
  <label for="f-content" class="muted" style="margin-top:14px">Ideia em Markdown</label><textarea id="f-content" class="editor-content" required maxlength="40000" placeholder="Explica a ideia com as tuas palavras. Escreve [[ para ligar outra nota.">${esc(note.Conteudo)}</textarea><div id="link-suggestions" class="autocomplete" hidden></div><div id="editor-preview" class="markdown" hidden></div>
  <div id="editor-quality">${qualityPanel(note)}</div><div class="cover-controls"><button type="button" data-action="cover">Obter capa da ligação</button><button type="button" data-action="repair-cover">Procurar outra capa</button><small id="cover-status" role="status">YouTube ou Microlink consultam a ligação pública. A imagem atual é preservada.</small><div id="cover-preview"></div></div><div class="metadata-grid"><label>Estado<select id="f-status">${options(['Rascunho','Concluída'],note.Estado||'Rascunho')}</select></label><label>Tipo de nota<select id="f-type">${options(['Captura rápida','Nota de leitura','Nota permanente','Mapa de conteúdo'],note.Tipo||'Nota permanente')}</select></label><label>Categoria<input id="f-category" list="category-options" value="${esc(note.Categoria)}"></label><label>Etiquetas<input id="f-tags" placeholder="escrita, aprendizagem" value="${esc(note.Tags)}"></label></div>
  <datalist id="category-options">${[...new Set(active().map(n=>n.Categoria).filter(Boolean))].map(cat=>`<option value="${esc(cat)}"></option>`).join('')}</datalist>
  <details><summary>Fontes, recursos e ligações</summary><div class="metadata-grid"><label>Subcategoria<input id="f-subcategory" value="${esc(note.Subcategoria)}"></label><label>Plataforma<select id="f-platform">${options([...new Set(['Nota','Artigo','Livro','YouTube','Podcast','X','Instagram',note.Plataforma].filter(Boolean))],note.Plataforma||'Nota')}</select></label><label class="wide">Fonte / citação<input id="f-source" value="${esc(note.Fonte)}" placeholder="Autor, obra, página…"></label><label class="wide">Endereços dos recursos<textarea id="f-url" rows="2" placeholder="Um endereço por linha">${esc(note.UrlMedia)}</textarea></label><label class="wide">Endereço da imagem<input id="f-image" type="url" value="${esc(note.UrlImagem)}"></label><label class="wide">Identificadores das notas relacionadas<input id="f-links" value="${esc(note.LinksPara)}" placeholder="Separados por vírgulas"></label></div></details>
  <div class="editor-footer"><button class="primary" type="submit">Guardar nota</button><small id="draft-status">${recover?'Rascunho recuperado':'As alterações são guardadas como rascunho.'}</small><button type="button" class="quiet danger" data-action="discard-draft">Descartar rascunho</button></div></form>`;
  $('editor-form').onsubmit=e=>{e.preventDefault();run(saveNote);};
  $('editor-form').addEventListener('input',()=>{dirty=true;$('draft-status').textContent='A guardar rascunho…';$('word-count').textContent=words(gather())+' palavras';refreshEditorExtras();clearTimeout(draftTimer);draftTimer=setTimeout(()=>run(saveDraft),450);});
  const currentForm=$('editor-form');
  $('f-url').addEventListener('input',()=>{clearTimeout(coverTimer);coverTimer=setTimeout(()=>{if(editing&&$('editor-form')===currentForm&&!$('f-image').value.trim()&&GNotesMetadata.publicUrl($('f-url').value.split(/\r?\n/)[0].trim()))run(fetchCover);},900);});
  refreshEditorExtras();$('f-content').addEventListener('input',autocomplete);$('f-title').focus();renderNavigation();
}
async function newNote(){await openEditor(C.normalize({ID:C.uid(),Estado:'Rascunho',Tipo:'Nota permanente'}));}
function autocomplete(){const input=$('f-content'),before=input.value.slice(0,input.selectionStart),match=before.match(/\[\[([^\]\n]*)$/),el=$('link-suggestions');if(!match){el.hidden=true;return;}const suggestions=C.search(active().filter(n=>n.ID!==selected),match[1]).slice(0,6);el.hidden=!suggestions.length;el.innerHTML=suggestions.map(n=>`<button type="button" data-insert-link="${esc(n.ID)}">${esc(n.Titulo)}</button>`).join('');}
function insertLink(id){const input=$('f-content'),before=input.value.slice(0,input.selectionStart),start=before.lastIndexOf('[[');if(start<0)return;let end=input.selectionStart;if(input.value.slice(end,end+2)===']]')end+=2;const str='[['+id+'|'+state.notes[id].Titulo+']]';input.setRangeText(str,start,end,'end');$('link-suggestions').hidden=true;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();}
function format(type){const input=$('f-content'),start=input.selectionStart,end=input.selectionEnd,[a,b]=({bold:['**','**'],italic:['*','*'],heading:['\n## ',''],quote:['\n> ',''],list:['\n- ',''],link:['[[',']]']})[type];input.setRangeText(a+input.value.slice(start,end)+b,start,end,'select');input.focus();if(type==='link')input.setSelectionRange(start+2,start+2);input.dispatchEvent(new Event('input',{bubbles:true}));}
async function saveNote(){
  if(!editing||!$('editor-form').reportValidity())return;
  const note=gather();if(!note.Titulo.trim()||!note.Conteudo.trim())return toast('Escreve um título e uma ideia antes de guardar.');
  note.Titulo=note.Titulo.trim();const now=new Date().toISOString();note.DataCriacao=note.DataCriacao||now;note.DataAtualizacao=now;note.DataConclusao=note.Estado==='Concluída'?(note.DataConclusao||now):'';note.TempoDeEdicao=String(Number(note.TempoDeEdicao||0)+Math.min(1800,Math.floor((Date.now()-readingStart)/1000)));
  let conflict=false;
  await transaction(s=>{if(s.conflicts[note.ID])throw Error('Resolve primeiro o conflito desta nota.');const current=s.notes[note.ID];if(current&&Number(current.Version)!==editBaseVersion){s.conflicts[note.ID]={local:note,remote:current,message:'A nota mudou enquanto escrevias.'};s.notes[note.ID]=note;conflict=true;}else C.enqueue(s,note);delete s.drafts[draftKey];});
  dirty=false;editing=false;clearTimeout(draftTimer);draftKey='';renderList();renderReader();toast(conflict?'A tua versão foi preservada. Resolve o conflito para continuar.':demo?'Nota guardada na biblioteca de exemplo.':'Nota guardada neste dispositivo.');if(!conflict)run(sync);
}
async function apiGet(params={}){const u=new URL(endpoint);u.searchParams.set('v','3');u.searchParams.set('_',Date.now());Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));const response=await fetch(u,{cache:'no-store',signal:AbortSignal.timeout(25000),referrerPolicy:'no-referrer'});if(!response.ok)throw Error('Não foi possível ler o Google Sheets.');return response.json();}
async function sync(){
  if(syncBusy||storageFault)return;if(demo){renderStatus();return;}
  syncBusy=true;renderStatus();
  const perform=async()=>{
    let payload=await apiGet();legacy=Array.isArray(payload);protocolReady=payload.protocol==='gnotes/3';
    if(legacy){await transaction(s=>C.merge(s,payload));syncError='';return;}
    if(!protocolReady||!Array.isArray(payload.notes))throw Error(payload.message||'O Apps Script ainda não está preparado para esta versão.');
    syncError='';await transaction(s=>C.merge(s,payload.notes));
    let sent=0;
    while(sent<50){state=load();const op=state.queue[0];if(!op)break;
      try{await fetch(endpoint,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({protocol:'gnotes/3',...op}),signal:AbortSignal.timeout(25000),referrerPolicy:'no-referrer'});}catch(e){/* An interrupted response is ambiguous: read the receipt before retrying. */}
      let receipt;
      for(let i=0;i<3;i++){payload=await apiGet({operationId:op.operationId});receipt=payload.receipt;if(receipt)break;if(i<2)await new Promise(r=>setTimeout(r,700*(i+1)));}
      if(!receipt)throw Error('A gravação ainda não foi confirmada. A alteração continua guardada e será tentada novamente.');
      await transaction(s=>{C.acknowledge(s,op,receipt);if(Array.isArray(payload.notes))C.merge(s,payload.notes);});sent++;
    }
  };
  try{if(navigator.locks)await navigator.locks.request(STORAGE+'-sync',perform);else await perform();}
  catch(e){syncError=e.name==='TimeoutError'?'A ligação demorou demasiado. As alterações continuam guardadas neste dispositivo.':e.message||'Sem ligação. As alterações continuam guardadas neste dispositivo.';}
  finally{syncBusy=false;renderStatus();renderList();renderNavigation();if(!editing&&selected)renderReader();if(view==='stats')renderStats();}
}
async function updateNote(id,patch){await transaction(s=>{const n=s.notes[id];if(!n)throw Error('Nota não encontrada.');C.enqueue(s,{...n,...patch,DataAtualizacao:new Date().toISOString()});});renderList();if(!editing)renderReader();run(sync);}
async function trashNote(){const n=state.notes[selected];if(!n)return;if(!await confirmAction('Mover esta nota para o lixo?',`“${n.Titulo}” ficará disponível no lixo e poderá ser restaurada.`,'Mover para o lixo'))return;await updateNote(n.ID,{DeletedAt:new Date().toISOString()});toast('Nota movida para o lixo.');}
async function restore(){await updateNote(selected,{DeletedAt:''});toast('Nota restaurada.');await changeView('all');renderReader();}
async function resolveConflict(keepBoth){const id=selected,c=state.conflicts[id];if(!c)return;if(!keepBoth&&!await confirmAction('Usar a versão do servidor?','A versão local será conservada no histórico deste dispositivo.','Usar versão do servidor'))return;let duplicate;
  await transaction(s=>{s.history[id]=[c.local,...(s.history[id]||[])].slice(0,30);delete s.conflicts[id];s.queue=s.queue.filter(o=>o.note.ID!==id);if(c.remote)s.notes[id]=c.remote;else delete s.notes[id];if(keepBoth){duplicate=C.uid();C.enqueue(s,{...c.local,ID:duplicate,Titulo:c.local.Titulo+' (versão local)',Version:0,DeletedAt:'',DataCriacao:new Date().toISOString()});}});
  selected=duplicate||id;renderList();renderReader();toast(keepBoth?'As duas versões foram preservadas.':'Versão do servidor recuperada.');run(sync);
}
function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.hidden=true;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function backup(){download(new Blob([JSON.stringify({format:'gnotes-backup',version:3,exportedAt:new Date().toISOString(),state},null,2)],{type:'application/json'}),'gNOTES-copia-'+today()+'.json');}
async function exportZip(){if(!window.JSZip)throw Error('A exportação ZIP não está disponível. Usa a cópia JSON.');const zip=new JSZip();active().forEach(n=>zip.file(n.ID+'.md',C.markdown(n,state.notes)));zip.file('LEIA-ME.txt','As notas usam identificadores estáveis como nomes de ficheiro. Os títulos são preservados nos aliases e no cabeçalho. O lixo e os rascunhos estão na cópia completa JSON.');download(await zip.generateAsync({type:'blob'}),'gNOTES-Obsidian-'+today()+'.zip');}
async function exportWord(){const n=state.notes[selected];if(!n)return;if(!window.docx)throw Error('A exportação Word não está disponível. Usa Markdown.');const{Document,Paragraph,HeadingLevel,Packer,TextRun}=docx;const children=[new Paragraph({text:n.Titulo,heading:HeadingLevel.TITLE}),new Paragraph({text:[n.Categoria,n.Tipo,n.Fonte].filter(Boolean).join(' · ')})];n.Conteudo.split('\n').forEach(line=>{const m=line.match(/^(#{1,3})\s+(.*)/);children.push(new Paragraph(m?{text:m[2],heading:[HeadingLevel.HEADING_1,HeadingLevel.HEADING_2,HeadingLevel.HEADING_3][m[1].length-1]}:{children:[new TextRun({text:line.replace(/\[\[([^\]]+)\]\]/g,(_,x)=>resolveLink(x)?.Titulo||x).replace(/\*\*/g,'')})],...(line.startsWith('- ')?{bullet:{level:0}}:{})}));});download(await Packer.toBlob(new Document({sections:[{children}]})),n.ID+'.docx');}
async function importFile(file){
  if(!file)return;if(file.size>30000000)throw Error('O ficheiro é demasiado grande para importar de uma vez.');const parsed=JSON.parse(await file.text());
  const complete=parsed.format==='gnotes-backup'&&parsed.state;const raw=Array.isArray(parsed)?parsed:complete?Object.values(parsed.state.notes||{}):null;if(!raw)throw Error('Escolhe uma cópia JSON de notas gNOTES.');
  const notes=raw.map(C.normalize);if(notes.some(n=>!C.validId(n.ID)||!n.Titulo))throw Error('A cópia contém notas sem identificador ou título.');if(new Set(notes.map(n=>n.ID)).size!==notes.length)throw Error('A cópia contém identificadores repetidos.');
  if(!Object.keys(state.notes).length&&complete){if(!await confirmAction('Recuperar a biblioteca completa?',`Serão recuperadas ${notes.length} notas, o lixo, os rascunhos e as alterações pendentes. Confirma que esta cópia pertence ao mesmo Google Sheets.`,'Recuperar biblioteca'))return;await transaction(s=>{const restored=C.restoreBackup(parsed.state);Object.assign(s,restored);});}
  else{if(!await confirmAction('Importar notas?',`Serão importadas ${notes.length} notas. As versões diferentes de notas existentes serão preservadas como cópias; as ligações entre as notas importadas serão mantidas.`,'Importar'))return;
    await transaction(s=>{const remap={};for(const n of notes){if(s.notes[n.ID]&&JSON.stringify(C.normalize(s.notes[n.ID]))!==JSON.stringify(n))remap[n.ID]=C.uid();}
      for(const n of notes){if(s.notes[n.ID]&&!remap[n.ID])continue;const old=n.ID;n.ID=remap[old]||old;n.Conteudo=n.Conteudo.replace(/\[\[([^\]\n]+)\]\]/g,(full,ref)=>{const p=ref.split('|'),target=p[0].trim();return remap[target]?'[['+remap[target]+(p[1]?'|'+p[1]:'')+']]':full;});n.LinksPara=n.LinksPara.split(/[,;]+/).map(id=>remap[id.trim()]||id.trim()).join(', ');if(remap[old])n.Titulo+=' (importada)';C.enqueue(s,n);}
      if(complete)for(const [id,d]of Object.entries(parsed.state.drafts||{})){const key=remap[id]||id;if(!s.drafts[key])s.drafts[key]={...d,note:{...d.note,ID:key}};}
    });}
  renderList();renderNavigation();toast('Cópia importada.');run(sync);
}
function dueNotes(){return active().filter(n=>n.Estado==='Concluída'&&(!n.ReviewDue||n.ReviewDue<=today()));}
function renderReviewHome(){reviewSession=null;const due=dueNotes();$('tool-view').innerHTML=`<div class="tool-heading"><div><p class="eyebrow">VOLTA ÀS TUAS IDEIAS</p><h1>Rever ideias</h1><p>Recorda antes de revelar. O próximo encontro fica agendado.</p></div></div><div class="review-card"><div class="review-progress">REVISÃO ESPAÇADA</div><h2>${due.length?due.length+' ideias à tua espera.':'Por hoje, estás em dia.'}</h2><p class="muted">As notas concluídas regressam de acordo com a dificuldade da última revisão. Os resultados são guardados com a nota.</p><div class="button-row"><button class="primary" data-action="start-review" ${due.length?'':'disabled'}>Começar revisão</button><button data-action="review-all" ${active().some(n=>n.Estado==='Concluída')?'':'disabled'}>Praticar todas</button></div></div>`;}
function startReview(all=false){const notes=all?active().filter(n=>n.Estado==='Concluída'):dueNotes();reviewSession={ids:notes.map(n=>n.ID),index:0,revealed:false};renderReviewCard();}
function renderReviewCard(){const session=reviewSession;if(!session)return;const n=state.notes[session.ids[session.index]];if(!n){$('tool-view').innerHTML='<div class="review-card"><p class="eyebrow">SESSÃO CONCLUÍDA</p><h2>Uma ideia mais presente.</h2><p>Os resultados foram guardados. Podes regressar à biblioteca ou iniciar outra sessão.</p><button class="primary" data-view="all">Voltar às notas</button></div>';return;}const bold=n.Conteudo.match(/\*\*([^*]+)\*\*/);let question='Como explicarias a ideia central de “'+n.Titulo+'”?';if(bold){const paragraph=n.Conteudo.split(/\n\s*\n/).find(p=>p.includes(bold[0]))||n.Conteudo;question='Completa: '+paragraph.replace(bold[0],'[…]');}
  $('tool-view').innerHTML=`<div class="tool-heading"><h1>Rever ideias</h1><button data-view="review">Terminar sessão</button></div><div class="review-card"><div class="review-progress">${session.index+1} / ${session.ids.length} · ${esc(n.Categoria||'Sem categoria')}</div><h2>${esc(question)}</h2>${session.revealed?`<div class="markdown">${markdown(n.Conteudo)}</div><div class="button-row"><button data-rate="hard">Difícil · amanhã</button><button data-rate="good">Bom · ${Math.max(3,Number(n.ReviewInterval||0)*2)} dias</button><button class="primary" data-rate="easy">Fácil · ${Math.max(7,Number(n.ReviewInterval||0)*3)} dias</button></div>`:'<button class="primary" data-action="reveal">Revelar a ideia</button>'}</div>`;
}
async function rateReview(rate){const n=state.notes[reviewSession.ids[reviewSession.index]],days=rate==='hard'?1:rate==='good'?Math.max(3,Number(n.ReviewInterval||0)*2):Math.max(7,Number(n.ReviewInterval||0)*3);const due=new Date();due.setDate(due.getDate()+days);await updateNote(n.ID,{ReviewDue:due.toISOString().slice(0,10),ReviewInterval:String(days),ReviewCount:String(Number(n.ReviewCount||0)+1)});reviewSession.index++;reviewSession.revealed=false;renderReviewCard();}
function renderGraph(){const cats=[...new Set(active().map(n=>n.Categoria).filter(Boolean))];$('tool-view').innerHTML=`<div class="tool-heading"><div><p class="eyebrow">A TUA REDE DE CONHECIMENTO</p><h1>Mapa de ligações</h1><p>Seleciona uma ideia para a abrir. Usa os filtros para explorar.</p></div><div class="button-row"><select id="graph-category" aria-label="Categoria do grafo" style="width:auto"><option value="">Todas as categorias</option>${cats.map(c=>`<option>${esc(c)}</option>`).join('')}</select><label><input id="graph-orphans" type="checkbox" style="width:auto"> Ocultar isoladas</label></div></div><div id="graph-drawing"></div>`;$('graph-category').onchange=drawGraph;$('graph-orphans').onchange=drawGraph;drawGraph();}
function drawGraph(){const all=active(),cat=$('graph-category').value;let notes=all.filter(n=>!cat||n.Categoria===cat);if($('graph-orphans').checked)notes=notes.filter(n=>C.links(n,state.notes).length||all.some(x=>C.links(x,state.notes).includes(n.ID)));const total=notes.length;notes=notes.slice(0,120);if(!notes.length){$('graph-drawing').innerHTML='<div class="empty"><h2>A rede começa com uma ligação.</h2><p>Cria notas e liga-as com [[ no editor.</p></div>';return;}const w=1000,h=560,points=new Map(notes.map((n,i)=>{const angle=i*2.399963,rad=notes.length===1?0:Math.sqrt((i+.5)/notes.length)*225;return[n.ID,{x:w/2+Math.cos(angle)*rad*1.6,y:h/2+Math.sin(angle)*rad}];}));const edges=notes.flatMap(n=>C.links(n,state.notes).filter(id=>points.has(id)).map(id=>{const a=points.get(n.ID),b=points.get(id);return`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;})).join('');$('graph-drawing').innerHTML=`${total>120?'<p class="muted">A mostrar 120 notas. Filtra por categoria para explorar o restante.</p>':''}<svg class="graph-canvas" viewBox="0 0 ${w} ${h}" role="group" aria-label="Mapa interativo das notas">${edges}${notes.map(n=>{const p=points.get(n.ID);return`<g class="graph-node" role="button" tabindex="0" aria-label="Abrir ${esc(n.Titulo)}" data-note="${esc(n.ID)}"><title>${esc(n.Titulo)}</title><circle cx="${p.x}" cy="${p.y}" r="${8+Math.min(C.links(n,state.notes).length,8)*2}"/><text text-anchor="middle" x="${p.x}" y="${p.y+31}">${esc(n.Titulo.length>28?n.Titulo.slice(0,26)+'…':n.Titulo)}</text></g>`;}).join('')}</svg>`;}
function renderStats(){const notes=active(),connected=new Set();notes.forEach(n=>C.links(n,state.notes).forEach(id=>{if(state.notes[id]&&!state.notes[id].DeletedAt){connected.add(id);connected.add(n.ID);}}));const orphan=notes.filter(n=>!connected.has(n.ID));let cells='';for(let i=89;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const key=d.toISOString().slice(0,10),count=notes.filter(n=>n.DataCriacao.startsWith(key)).length;cells+=`<span class="${count?'used':''}" title="${key}: ${count} notas" aria-label="${key}: ${count} notas" style="${count?'opacity:'+Math.min(1,.35+count*.2):''}"></span>`;}
  $('tool-view').innerHTML=`<div class="tool-heading"><div><p class="eyebrow">A BIBLIOTECA EM MOVIMENTO</p><h1>A minha atividade</h1><p>Pequenas ideias, construídas ao longo do tempo.</p></div></div><div class="stat-grid"><div class="stat"><strong>${notes.length}</strong><span>Notas na biblioteca</span></div><div class="stat"><strong>${notes.reduce((sum,n)=>sum+C.links(n,state.notes).filter(id=>state.notes[id]&&!state.notes[id].DeletedAt).length,0)}</strong><span>Ligações entre notas</span></div><div class="stat"><strong>${notes.filter(n=>n.Estado==='Rascunho').length}</strong><span>Por desenvolver</span></div><div class="stat"><strong>${notes.reduce((sum,n)=>sum+Number(n.ReviewCount||0),0)}</strong><span>Revisões realizadas</span></div></div><h3>Notas criadas · últimos 90 dias</h3><div class="heatmap">${cells}</div><p class="muted">${notes.reduce((s,n)=>s+words(n),0).toLocaleString('pt-PT')} palavras · ${Math.round(notes.reduce((s,n)=>s+Number(n.TempoDeEdicao||0),0)/60)} minutos de escrita registados</p><hr><h3>Ideias à procura de uma ligação</h3><p class="muted">Estas notas ainda não têm ligações a outras notas da biblioteca.</p>${orphan.slice(0,15).map(n=>`<button class="link-card" data-note="${esc(n.ID)}">${esc(n.Titulo)}</button>`).join('')||'<p class="muted">Todas as tuas notas fazem parte da rede.</p>'}`;
}
async function historyDialog(){historyItems=state.history[selected]||[];const paint=()=>{$('history-content').innerHTML=historyItems.length?historyItems.map((n,i)=>`<div class="history-entry"><strong>${esc(safeDate(n.DataAtualizacao))} · ${esc(n.Titulo)}</strong><pre>${esc(n.Conteudo)}</pre><button data-history="${i}">Recuperar esta versão como rascunho</button></div>`).join(''):'<p>Ainda não existem versões anteriores. As próximas alterações serão guardadas no histórico.</p>';};paint();$('history-dialog').showModal();if(!demo&&protocolReady){try{const result=await apiGet({historyId:selected});if(Array.isArray(result.history)){const seen=new Set();historyItems=[...historyItems,...result.history.map(C.normalize)].filter(n=>{const key=n.Version+':'+n.Conteudo;if(seen.has(key))return false;seen.add(key);return true;});paint();}}catch{toast('A mostrar apenas o histórico deste dispositivo.');}}}
async function capture(){const url=urlSafe($('capture-url').value);if(!url)return toast('Introduz um endereço http ou https válido.');$('settings-dialog').close();const u=new URL(url);await openEditor(C.normalize({ID:C.uid(),Titulo:u.hostname.replace(/^www\./,''),Conteudo:'## Ideia principal\n\n\n## Reflexão pessoal\n\n',UrlMedia:url,Estado:'Rascunho',Tipo:'Nota de leitura',Plataforma:/youtube\.com|youtu\.be/.test(u.hostname)?'YouTube':'Artigo'}));dirty=true;await saveDraft();await fetchCover(false,true);}
async function connect(){const value=$('endpoint').value.trim();let url;try{url=new URL(value);}catch{return toast('Introduz o endereço da aplicação Web.');}if(url.protocol!=='https:'||url.hostname!=='script.google.com'||!/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname))return toast('Usa o endereço /exec da aplicação Web do Google Apps Script.');if(demo)return toast('A ligação está desativada na biblioteca de exemplo. Abre a tua biblioteca para configurar.');if(value!==endpoint&&state.queue.length)return toast('Envia ou recupera as alterações pendentes antes de mudar de ligação.');if(value!==endpoint&&Object.keys(state.notes).length){if(!await confirmAction('Mudar de biblioteca?','Será descarregada uma cópia completa antes de abrir os dados do novo endereço.','Guardar cópia e mudar'))return;backup();await transaction(s=>Object.assign(s,C.empty()));}endpoint=value;localStorage.setItem('gnotes_v3_endpoint',value);legacy=false;protocolReady=false;await sync();}
async function action(name){switch(name){
  case'repair-cover':return editing?fetchCover(true):fetchReaderCover();case'cover':return editing?fetchCover():fetchReaderCover();case'new':return newNote();case'edit':return openEditor(state.notes[selected]);case'save':return saveNote();case'sync':return sync();case'trash':return trashNote();case'restore':return restore();case'keep-both':return resolveConflict(true);case'use-remote':return resolveConflict(false);
  case'settings':$('endpoint').value=endpoint;renderStatus();$('settings-dialog').showModal();break;case'connect':return connect();case'backup':return backup();case'zip':return exportZip();case'import':$('import-file').click();break;case'capture':return capture();
  case'pin':await transaction(s=>s.pins=s.pins.includes(selected)?s.pins.filter(id=>id!==selected):[...s.pins,selected]);renderList();renderReader();break;
  case'back':await leaveEditor();document.body.classList.remove('note-open');renderList();break;
  case'close-editor':await leaveEditor();draftKey='';renderReader();renderNavigation();break;
  case'discard-draft':if(await confirmAction('Descartar este rascunho?','A nota guardada anteriormente não será alterada.','Descartar')){clearTimeout(draftTimer);dirty=false;await transaction(s=>delete s.drafts[draftKey]);editing=false;draftKey='';renderReader();renderNavigation();}break;
  case'recover':{const entry=Object.entries(state.drafts).sort((a,b)=>b[1].savedAt.localeCompare(a[1].savedAt))[0];if(entry)await openEditor({...entry[1].note,ID:entry[0]},true);break;}
  case'preview':$('editor-preview').innerHTML=markdown($('f-content').value);$('editor-preview').hidden=!$('editor-preview').hidden;$('f-content').hidden=!$('editor-preview').hidden;break;
  case'zen':document.body.classList.toggle('zen');break;case'menu':document.body.classList.toggle('menu-open');break;
  case'theme':{const themes=['light','dark','sepia'],theme=themes[(themes.indexOf(document.documentElement.dataset.theme)+1)%3];setTheme(theme);break;}
  case'random':{const notes=active();if(!notes.length)return toast('Cria uma nota para começar.');return selectNote(notes[Math.floor(Math.random()*notes.length)].ID);}
  case'copy':await navigator.clipboard.writeText(state.notes[selected].Titulo+'\n\n'+state.notes[selected].Conteudo);toast('Nota copiada.');break;
  case'markdown':{const n=state.notes[selected];download(new Blob([C.markdown(n,state.notes)],{type:'text/markdown;charset=utf-8'}),n.ID+'.md');break;}
  case'word':return exportWord();case'history':return historyDialog();
  case'audio':if(!window.speechSynthesis)return toast('A leitura em voz alta não está disponível neste navegador.');if(speechSynthesis.speaking){speechSynthesis.cancel();break;}const utterance=new SpeechSynthesisUtterance(state.notes[selected].Titulo+'. '+state.notes[selected].Conteudo.replace(/[#*`]/g,''));utterance.lang='pt-PT';speechSynthesis.speak(utterance);break;
  case'start-review':startReview();break;case'review-all':startReview(true);break;case'reveal':reviewSession.revealed=true;renderReviewCard();break;
}}
function setTheme(theme){document.documentElement.dataset.theme=theme;localStorage.setItem('gnotes_v3_theme',theme);}
async function run(fn){try{await fn();}catch(e){console.error(e);toast(e.message||'Não foi possível concluir esta ação.');}}
document.addEventListener('click',e=>{const target=e.target.closest('[data-action],[data-view],[data-category],[data-note],[data-tag],[data-format],[data-insert-link],[data-connect],[data-rate],[data-history],[data-theme-choice],[data-missing]');if(!target)return;e.preventDefault();run(async()=>{
  if(target.dataset.action)return action(target.dataset.action);if(target.dataset.view)return changeView(target.dataset.view);if(target.hasAttribute('data-category'))return changeView('all',target.dataset.category);if(target.dataset.note)return selectNote(target.dataset.note);if(target.dataset.tag){await changeView('all');$('search').value=target.dataset.tag;renderList();return;}
  if(target.dataset.format)return format(target.dataset.format);if(target.dataset.insertLink)return insertLink(target.dataset.insertLink);if(target.dataset.connect){const n=state.notes[selected];await updateNote(n.ID,{LinksPara:[...new Set([...String(n.LinksPara).split(/[,;]+/).map(s=>s.trim()).filter(Boolean),target.dataset.connect])].join(', ')});toast('Ligação adicionada.');return;}
  if(target.dataset.rate)return rateReview(target.dataset.rate);if(target.hasAttribute('data-history')){const n=historyItems[Number(target.dataset.history)];$('history-dialog').close();await openEditor({...n,Version:state.notes[selected].Version},false);dirty=true;return saveDraft();}if(target.dataset.themeChoice)return setTheme(target.dataset.themeChoice);if(target.dataset.missing)return toast('A nota “'+target.dataset.missing+'” ainda não existe. Cria-a e insere a ligação no editor.');
});});
document.addEventListener('keydown',e=>{if(e.target.closest('.graph-node')&&['Enter',' '].includes(e.key)){e.preventDefault();e.target.closest('.graph-node').dispatchEvent(new MouseEvent('click',{bubbles:true}));}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();run(async()=>{if(['graph','review','stats'].includes(view))await changeView('all');document.body.classList.remove('note-open');$('search').focus();});}if(e.altKey&&e.key.toLowerCase()==='n'){e.preventDefault();run(newNote);}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'&&editing){e.preventDefault();run(saveNote);}if(e.key==='Escape'){document.body.classList.remove('zen','menu-open');if($('link-suggestions'))$('link-suggestions').hidden=true;}});
$('search').oninput=renderList;$('status-filter').onchange=renderList;$('sort').onchange=renderList;
$('import-file').onchange=e=>{run(()=>importFile(e.target.files[0]));e.target.value='';};
window.addEventListener('beforeunload',e=>{if(editing&&dirty){e.preventDefault();e.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&editing&&dirty)run(saveDraft);});
window.addEventListener('online',()=>run(sync));
window.addEventListener('storage',e=>{if(e.key!==STORAGE)return;state=load();renderList();renderNavigation();renderStatus();if(!editing&&selected)renderReader();});
async function init(){seed();setTheme(localStorage.getItem('gnotes_v3_theme')||'light');$('demo-banner').hidden=!demo;const hash=decodeURIComponent(location.hash.replace(/^#note=/,''));selected=state.notes[hash]?hash:active()[0]?.ID||null;renderNavigation();renderStatus();renderList();renderReader();await sync();if(!selected&&active().length){selected=active()[0].ID;renderList();renderReader();}if('serviceWorker'in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('sw.js').catch(()=>{});setInterval(()=>{if(!document.hidden&&state.queue.length&&!syncBusy)run(sync);},30000);}
run(init);
