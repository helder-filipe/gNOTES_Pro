/**
 * gNOTES Pro — Google Sheets, protocol gnotes/3.
 * Paste into the Apps Script project bound to the existing spreadsheet.
 * Existing IDs and columns are preserved. No note rows are deleted.
 * Deployment access remains controlled by the Google Apps Script settings.
 */
const GNOTES = {
  NOTES_SHEET_NAME: 'gNOTES', // Optional: exact name of the notes tab. Required if several tabs match.
  OPERATIONS: '_gnotes_operations',
  HISTORY: '_gnotes_history',
  PROTOCOL: 'gnotes/3'
};
const G_FIELDS = ['ID','Titulo','Conteudo','Plataforma','Estado','Categoria','Subcategoria','UrlMedia','UrlImagem','Fonte','Tags','LinksPara','DataCriacao','DataAtualizacao','DataConclusao','TempoDeEdicao','TempoDeLeitura','Tipo','DeletedAt','Version','LastOperation','ReviewDue','ReviewInterval','ReviewCount'];

function gKey(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,''); }
function gField(value) {
  const key=gKey(value), aliases={citacao:'Fonte',linkdaimagem:'UrlImagem',imagem:'UrlImagem',tempoedicao:'TempoDeEdicao',tempoleitura:'TempoDeLeitura'};
  return G_FIELDS.find(f=>gKey(f)===key)||aliases[key]||(key.indexOf('linkspara')===0?'LinksPara':null);
}
function gJSON(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
function gNotesSheet() {
  const book=SpreadsheetApp.getActiveSpreadsheet();
  if(!book)throw Error('Este script tem de estar associado à folha de cálculo das notas.');
  if(GNOTES.NOTES_SHEET_NAME){const sheet=book.getSheetByName(GNOTES.NOTES_SHEET_NAME);if(!sheet)throw Error('A folha de notas configurada não existe.');return sheet;}
  const saved=PropertiesService.getScriptProperties().getProperty('GNOTES_NOTES_SHEET_ID');
  if(saved){const sheet=book.getSheets().find(s=>String(s.getSheetId())===saved);if(sheet)return sheet;throw Error('A folha de notas anteriormente configurada já não existe.');}
  const candidates=book.getSheets().filter(s=>!s.getName().startsWith('_gnotes_')&&s.getLastColumn()>0).filter(s=>{const h=s.getRange(1,1,1,s.getLastColumn()).getDisplayValues()[0].map(gField);return h.includes('ID')&&h.includes('Titulo')&&h.includes('Conteudo');});
  if(candidates.length!==1)throw Error('Define NOTES_SHEET_NAME com o nome exato da folha que contém ID, Titulo e Conteudo.');
  return candidates[0];
}
function gRead(sheet) {
  const rows=sheet.getDataRange().getDisplayValues();
  const headers=rows[0].map(String), fields=headers.map(gField), notes=[];
  const seen={};
  for(let i=1;i<rows.length;i++){
    const note={};fields.forEach((field,j)=>{if(field)note[field]=String(rows[i][j]||'');});
    note.ID=String(note.ID||'').trim();if(!note.ID)continue;
    if(seen[note.ID])throw Error('Há identificadores de nota repetidos na folha. Corrige-os antes de sincronizar.');seen[note.ID]=true;
    note.Version=Number(note.Version)||0;notes.push({note:note,row:i+1});
  }
  return {headers:headers,fields:fields,notes:notes};
}
function gInternal(name,headers,create) {
  const book=SpreadsheetApp.getActiveSpreadsheet();let sheet=book.getSheetByName(name);
  if(!sheet&&create){sheet=book.insertSheet(name);sheet.getRange(1,1,1,headers.length).setValues([headers]);sheet.setFrozenRows(1);}
  return sheet;
}
function gReceipt(operationId,notes) {
  if(!operationId)return null;
  const sheet=gInternal(GNOTES.OPERATIONS,[],false);
  if(sheet&&sheet.getLastRow()>1){
    const cell=sheet.getRange(2,1,sheet.getLastRow()-1,1).createTextFinder(operationId).matchEntireCell(true).findNext();
    if(cell){const row=sheet.getRange(cell.getRow(),1,1,6).getDisplayValues()[0];return {status:row[2],note:notes.find(n=>n.ID===row[1])||null,version:Number(row[3])||0,message:row[4]};}
  }
  // A note write may succeed before the receipt write is interrupted.
  const applied=notes.find(n=>n.LastOperation===operationId);
  return applied?{status:'success',note:applied,version:applied.Version}:null;
}
function doGet(e) {
  const lock=LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const notes=gRead(gNotesSheet()).notes.map(x=>x.note),params=e&&e.parameter||{};
    // Read compatibility for older clients. Writes require the new protocol.
    if(params.v!=='3')return gJSON(notes.filter(n=>!n.DeletedAt));
    const result={protocol:GNOTES.PROTOCOL,notes:notes,receipt:gReceipt(params.operationId,notes),serverTime:new Date().toISOString()};
    if(params.historyId){const history=gInternal(GNOTES.HISTORY,[],false);result.history=[];if(history&&history.getLastRow()>1){const rows=history.getDataRange().getDisplayValues();const fields=rows[0];result.history=rows.slice(1).filter(row=>String(row[0])===String(params.historyId)).slice(-30).reverse().map(row=>{const note={};fields.forEach((f,i)=>note[f]=row[i]);return note;});}}
    return gJSON(result);
  } catch(error) { return gJSON({protocol:GNOTES.PROTOCOL,status:'error',message:error.message}); }
  finally { if(lock.hasLock())lock.releaseLock(); }
}
function gCell(value) {const s=String(value==null?'':value);return s.startsWith('=')?"'"+s:s;}
function gRecord(op,status,note,message) {
  const sheet=gInternal(GNOTES.OPERATIONS,['OperationID','NoteID','Status','Version','Message','CreatedAt'],true);
  const row=[op.operationId,op.note.ID,status,note?note.Version:0,message||'',new Date().toISOString()].map(gCell);
  sheet.getRange(sheet.getLastRow()+1,1,1,row.length).setValues([row]);
}
function gValidate(op) {
  if(!op||op.protocol!==GNOTES.PROTOCOL)throw Error('Atualiza a interface: este servidor só aceita gravações confirmadas gnotes/3.');
  if(!/^[A-Za-z0-9_-]{8,100}$/.test(op.operationId||''))throw Error('Identificador de operação inválido.');
  if(!op.note||typeof op.note!=='object'||Array.isArray(op.note))throw Error('Nota inválida.');
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(String(op.note.ID||'')))throw Error('Identificador de nota inválido.');
  if(!Number.isInteger(op.baseVersion)||op.baseVersion<0)throw Error('Versão de origem inválida.');
  if(!String(op.note.Titulo||'').trim()||String(op.note.Titulo).length>500)throw Error('O título é obrigatório e deve ter até 500 caracteres.');
  if(!String(op.note.Conteudo||'').trim()||String(op.note.Conteudo).length>40000)throw Error('A ideia é obrigatória e deve ter até 40 000 caracteres.');
  for(const f of G_FIELDS)if(op.note[f]!=null&&typeof op.note[f]==='object')throw Error('Campo inválido: '+f);
  for(const f of G_FIELDS)if(String(op.note[f]||'').length>40000)throw Error('Campo demasiado longo: '+f);
  if(!['Rascunho','Concluída'].includes(op.note.Estado))throw Error('Estado inválido.');
  for(const f of ['TempoDeEdicao','TempoDeLeitura','ReviewInterval','ReviewCount'])if(op.note[f]!==''&&op.note[f]!=null&&(!Number.isFinite(Number(op.note[f]))||Number(op.note[f])<0))throw Error('Valor numérico inválido: '+f);
}
function doPost(e) {
  const lock=LockService.getScriptLock();let op;
  try {
    if(!e||!e.postData||e.postData.contents.length>250000)throw Error('Pedido inválido ou demasiado grande.');
    op=JSON.parse(e.postData.contents);gValidate(op);lock.waitLock(20000);
    const sheet=gNotesSheet();let data=gRead(sheet);const previous=data.notes.find(x=>x.note.ID===String(op.note.ID));
    const receipt=gReceipt(op.operationId,data.notes.map(x=>x.note));if(receipt)return gJSON(receipt);
    if((previous?previous.note.Version:0)!==op.baseVersion){const remote=previous?previous.note:null;gRecord(op,'conflict',remote,'A nota foi alterada noutro dispositivo.');SpreadsheetApp.flush();return gJSON({status:'conflict',note:remote,message:'A nota foi alterada noutro dispositivo.'});}
    const mapped=data.fields.filter(Boolean);if(new Set(mapped).size!==mapped.length)throw Error('Há colunas equivalentes repetidas na folha. Mantém apenas uma coluna para cada campo.');
    const missing=G_FIELDS.filter(f=>!data.fields.includes(f));
    if(missing.length){const required=data.headers.length+missing.length;if(required>sheet.getMaxColumns())sheet.insertColumnsAfter(sheet.getMaxColumns(),required-sheet.getMaxColumns());sheet.getRange(1,data.headers.length+1,1,missing.length).setValues([missing]);data=gRead(sheet);}
    PropertiesService.getScriptProperties().setProperty('GNOTES_NOTES_SHEET_ID',String(sheet.getSheetId()));
    const note={};G_FIELDS.forEach(f=>note[f]=String(op.note[f]??''));
    note.ID=String(op.note.ID);note.Version=op.baseVersion+1;note.LastOperation=op.operationId;
    note.DataCriacao=previous?previous.note.DataCriacao:(note.DataCriacao||new Date().toISOString());note.DataAtualizacao=new Date().toISOString();
    if(previous){const history=gInternal(GNOTES.HISTORY,G_FIELDS,true);history.getRange(history.getLastRow()+1,1,1,G_FIELDS.length).setValues([G_FIELDS.map(f=>gCell(previous.note[f]))]);}
    const rowIndex=previous?previous.row:sheet.getLastRow()+1;
    if(rowIndex>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),rowIndex-sheet.getMaxRows());
    const range=sheet.getRange(rowIndex,1,1,data.headers.length);
    const values=previous?range.getValues()[0]:new Array(data.headers.length).fill('');
    const formulas=previous?range.getFormulas()[0]:[];
    data.fields.forEach((f,i)=>{if(f)values[i]=gCell(note[f]);else if(formulas[i])values[i]=formulas[i];});
    range.setValues([values]);SpreadsheetApp.flush();
    gRecord(op,'success',note,'');SpreadsheetApp.flush();
    return gJSON({status:'success',note:note,version:note.Version});
  } catch(error) { return gJSON({status:'error',message:error.message}); }
  finally { if(lock.hasLock())lock.releaseLock(); }
}
