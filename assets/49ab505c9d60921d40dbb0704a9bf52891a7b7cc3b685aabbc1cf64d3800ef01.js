'use strict';
// Datas de calendário e rankings de presença nas listas publicadas.
const ModernTrends=(()=>{
 const addDays=(day,n)=>{const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
 const monday=day=>{const d=new Date(day+'T12:00:00Z');return addDays(day,-((d.getUTCDay()+6)%7));};
 function aggregate(decks){
  const counts=new Map();for(const d of decks)counts.set(d.classification.id,(counts.get(d.classification.id)||0)+1);
  const sorted=[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));const ranks=new Map();let last=-1,position=0;
  sorted.forEach(([id,n],i)=>{if(n!==last)position=i+1;ranks.set(id,position);last=n;});
  return {total:decks.length,events:new Set(decks.map(d=>d.event.event_id)).size,counts,ranks,sorted};
 }
 function weekly(decks,start,end,today){
  if(!start||!end||start>end)return [];
  const result=[];
  for(let day=monday(start);day<=end;day=addDays(day,7)){
   const last=addDays(day,6),from=day<start?start:day,to=last>end?end:last;
   const subset=decks.filter(d=>d.event.starttime_original.slice(0,10)>=from&&d.event.starttime_original.slice(0,10)<=to);
   const stats=aggregate(subset);
   result.push({start:day,end:last,from,to,partial:day<start||last>end||last>=today,...stats,top:stats.sorted.filter(([id])=>stats.ranks.get(id)<=8).map(([id])=>id)});
  }
  return result;
 }
 function movement(decks,today,range){
  // O período atual é exatamente o das barras, inclusive hoje quando selecionado.
  const start=range.start,end=range.end;
  const days=range.error?0:Math.max(0,Math.round((new Date(end+'T12:00:00Z')-new Date(start+'T12:00:00Z'))/86400000)+1);
  if(!Number.isFinite(days)||!days)return {days:0,sufficient:false,changes:new Map(),current:aggregate([]),previous:aggregate([])};
  const previousEnd=addDays(start,-1),previousStart=addDays(start,-days);
  const window=(lo,hi)=>aggregate(decks.filter(d=>{const day=d.event.starttime_original.slice(0,10);return day>=lo&&day<=hi;}));
  const current=window(start,end),previous=window(previousStart,previousEnd);
  const sufficient=current.events>=4&&previous.events>=4&&current.total>=64&&previous.total>=64;
  const changes=new Map();
  if(sufficient)for(const id of new Set([...current.counts.keys(),...previous.counts.keys()])){
   const n=current.counts.get(id)||0,old=previous.counts.get(id)||0;
   if(!old&&n>=5){changes.set(id,{kind:'new'});continue;}
   if(!n&&old>=5){changes.set(id,{kind:'absent'});continue;}
   if(n<5||old<5)continue;
   const before=previous.ranks.get(id),after=current.ranks.get(id),delta=before-after;
   if(delta)changes.set(id,{kind:delta>0?'up':'down',delta,before,after,large:Math.abs(delta)>=4});
  }
  return {start,end,previousStart,previousEnd,days,current,previous,sufficient,changes};
 }
 return {addDays,monday,aggregate,weekly,movement};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=ModernTrends;

/* Apresentação compartilhada pela melhor lista e pelos detalhes. Sem rede própria. */
const ModernCards=(()=>{
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const feedbackTimers=new WeakMap();
 const groups=['Criaturas','Spells','Artefatos','Planeswalkers','Encantamentos','Terrenos','Batalhas','Outros','Tipo não identificado'];
 function group(m){if(!m)return 'Tipo não identificado';const t=(m.card_faces?.[0]?.type_line||m.type_line||'').split(' — ')[0];return /Land/.test(t)?'Terrenos':/Creature/.test(t)?'Criaturas':/Planeswalker/.test(t)?'Planeswalkers':/Instant|Sorcery/.test(t)?'Spells':/Artifact/.test(t)?'Artefatos':/Enchantment/.test(t)?'Encantamentos':/Battle/.test(t)?'Batalhas':'Outros'}
 function costs(m){if(!m)return [];const f=m.card_faces;return (f?(m.layout==='transform'||m.layout==='meld'?[f[0].mana_cost]:f.map(x=>x.mana_cost)):[m.mana_cost]).filter(c=>typeof c==='string'&&c.length)}
 function sprite(a,size,label){if(!a||!/^assets\/[a-f0-9]{64}\.webp$/.test(a.file))return '';const scale=size/a.size;return `<span class="card-sprite" role="img" aria-label="${esc(label)}" title="${esc(label)}" style="width:${size}px;height:${size}px"><span style="width:${a.width*scale}px;height:${a.height*scale}px;background-image:url('${a.file}');background-size:${a.imageWidth*scale}px ${a.imageHeight*scale}px;background-position:${-a.x*scale}px ${-a.y*scale}px"></span></span>`}
 function mana(cost,data){return `<span class="card-mana-face">${cost.replace(/\{([^}]+)\}/g,(_,s)=>data.sprites.mana[s]?sprite(data.sprites.mana[s],16,`{${s}}`):`<span class="card-mana-text">${esc(s)}</span>`)}</span>`}
 function typeIcon(g,data){const keys={'Criaturas':['creature'],'Spells':['instant','sorcery'],'Artefatos':['artifact'],'Planeswalkers':['planeswalker'],'Encantamentos':['enchantment'],'Terrenos':['land'],'Batalhas':['battle']};return `<span class="card-type-icons" aria-hidden="true">${(keys[g]||[]).map(k=>sprite(data.sprites.types[k],18,g)).join('')}</span>`}
 function row(c,data){const m=data.cards[c.name_original],cs=costs(m);return `<div class="card deck-card-row"><b class="card-quantity">${c.quantity}</b><span class="card-name" title="${esc(m?.name||c.name_original)}">${esc(m?.layout==='split'?m.name:c.name_original)}</span><span class="card-mana" aria-label="${esc(m?(cs.join(' // ')||'Sem custo de mana'):'Metadados não disponíveis')}">${m?cs.map(x=>mana(x,data)).join('<span class="card-face-divider">//</span>'):'<span class="card-missing">Não disponível</span>'}</span></div>`}
 function modalLands(cards,data){return cards.reduce((n,c)=>{const m=data.cards[c.name_original];return n+(m?.layout==='modal_dfc'&&group(m)!=='Terrenos'&&m.card_faces?.some(f=>/\bLand\b/.test(f.type_line.split(' — ')[0]))?c.quantity:0)},0)}
 function mainGroups(cards,data,lands=false){const mdfcs=modalLands(cards,data);return groups.filter(g=>(g==='Terrenos')===lands).map(g=>{const cs=cards.filter(c=>group(data.cards[c.name_original])===g);return cs.length||(g==='Terrenos'&&mdfcs)?`<div class="deck-type-group"><h4>${typeIcon(g,data)}${g} (${cs.reduce((n,c)=>n+c.quantity,0)})${g==='Terrenos'&&mdfcs?`<small>+${mdfcs} MDFCs com face terreno</small>`:''}</h4>${cs.map(c=>row(c,data)).join('')}</div>`:''}).join('')}
 function zone(cards,title,data,side=false){return `<div class="deck-zone" data-zone="${side?'sideboard':'main'}"><h3>${title} (${cards.reduce((n,c)=>n+c.quantity,0)})</h3>${side?[...cards].sort((a,b)=>a.name_original.localeCompare(b.name_original,'en')).map(c=>row(c,data)).join(''):mainGroups(cards,data)}</div>`}
 function exportText(zones,data){
  const lines=cards=>[...cards].sort((a,b)=>Number(group(data.cards[a.name_original])==='Terrenos')-Number(group(data.cards[b.name_original])==='Terrenos')||a.name_original.localeCompare(b.name_original,'en')).map(c=>`${c.quantity} ${c.name_original}`).join('\n');
  return `${lines(zones.main)}\n\nSideboard\n${lines(zones.sideboard)}`.trimEnd();
 }
 async function copy(button){
  const root=button.closest('[data-copy-scope]'),text=root.querySelector('.deck-copy-text'),status=root.querySelector('.deck-copy-status');
  clearTimeout(feedbackTimers.get(status));button.disabled=true;status.textContent='';
  try{await navigator.clipboard.writeText(text.value);status.textContent='Lista copiada!';text.hidden=true;feedbackTimers.set(status,setTimeout(()=>{status.textContent='';},2500));}
  catch(error){text.hidden=false;text.focus();text.select();status.textContent='Não foi possível copiar automaticamente. Selecione e copie o texto abaixo.';}
  finally{button.disabled=false;}
 }
 function copyControl(){return '<span class="deck-copy-control"><button type="button" class="deck-action deck-copy-icon" data-copy-deck aria-label="Copiar decklist" title="Copiar lista"><span aria-hidden="true">⧉</span></button><span class="deck-copy-status" role="status" aria-live="polite"></span></span>'}
 function render(zones,data){const missing=[...zones.main,...zones.sideboard].some(c=>!data.cards[c.name_original]);return `<div class="deck-display"><textarea class="deck-copy-text" aria-label="Decklist para copiar" readonly hidden>${esc(exportText(zones,data))}</textarea>${missing?'<p class="card-metadata-note">Algumas cartas ainda não têm metadados no Scryfall. Nomes e quantidades foram preservados.</p>':''}<div class="zones">${zone(zones.main,'Main deck',data)}<div class="deck-support"><div class="deck-lands" data-zone="main"><h3>Main · terrenos</h3>${mainGroups(zones.main,data,true)}</div>${zone(zones.sideboard,'Sideboard',data,true)}</div></div></div>`}
 function manaFor(name,data){const m=data.cards[name];return `<span class="card-mana" aria-label="${esc(m?(costs(m).join(' // ')||'Sem custo de mana'):'Metadados não disponíveis')}">${m?costs(m).map(c=>mana(c,data)).join('<span class="card-face-divider">//</span>'):'<span class="card-missing">Não disponível</span>'}</span>`}
 return {render,group,costs,modalLands,exportText,copy,copyControl,manaFor};
})();
if(typeof module!=='undefined')module.exports=ModernCards;

'use strict';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=(n,total)=>total?(100*n/total).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%':'—';
const pretty=s=>s.split('-').reverse().join('/');
const cache=new Map();let active=0,waiters=[];
async function slot(){if(active>=4)await new Promise(resolve=>waiters.push(resolve));else active++;}
function release(){if(waiters.length)waiters.shift()();else active--;}
async function read(desc){
 const url=new URL(desc.path,location.href);
 if(url.origin!==location.origin||!url.pathname.startsWith(new URL('./dados/',location.href).pathname))throw Error('Caminho de dados inválido');
 if(cache.has(url.href)){const hit=cache.get(url.href);cache.delete(url.href);cache.set(url.href,hit);return hit;}
 const task=(async()=>{await slot();try{
  const response=await fetch(url,{cache:'default'});if(!response.ok)throw Error(`Arquivo indisponível (${response.status})`);
  const bytes=await response.arrayBuffer();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(hash!==desc.sha256)throw Error('Arquivo de outra versão ou corrompido');
  return JSON.parse(new TextDecoder().decode(bytes));
 }finally{release();}})();cache.set(url.href,task);
 try{const value=await task;if(cache.size>24){for(const key of cache.keys()){if(key!==url.href){cache.delete(key);break;}}}return value;}
 catch(e){cache.delete(url.href);throw e;}
}
let selectedArchetypes=new Set(),othersMode=false,otherIds=[],groups=[],seriesStyleIndex=new Map(),weeklyData=[],weeklySelected='',weeklySelection=null,bestGeneration=0;
const date=pretty;const ModernFilters={today};
const trendDeck=d=>({...d,classification:{id:d.archetype,name:d.archetype},event:{...d.event,event_id:d.event.id,starttime_original:d.event.date}});
let weeklyEntries=[],catalog,entries=[],filtered=[],page=0,generation=0,detailGeneration=0,frequencyGeneration=0;
function range(){const start=$('start').value,end=$('end').value;if(!start||!end||start>end)throw Error('Informe um intervalo válido.');return {start,end};}
function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function period(){if(!catalog)return;const value=$('period').value;
 if(value!=='custom'){const last=value==='all'?catalog.events.map(e=>e.date).sort().at(-1):today();$('end').value=last;const d=new Date(last+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-Number(value)+1);$('start').value=value==='all'?catalog.events.map(e=>e.date).sort()[0]:d.toISOString().slice(0,10);}
 $('start').disabled=$('end').disabled=value!=='custom';$('start-label').hidden=$('end-label').hidden=value!=='custom';}
function inPlacement(d){const n=Number($('placement').value);if(!n)return true;const m=/^(\d+)(?:-(\d+))?$/.exec(d.rankLabel);return !!m&&Number(m[2]||m[1])<=n;}
function scopeEvents(){const r=range();return catalog.events.filter(e=>e.date>=r.start&&e.date<=r.end&&($('modality').value==='both'||e.modality===$('modality').value)&&e.complete);}
function renderEvents(events){
 const counts=new Map();for(const d of entries)counts.set(d.event.id,(counts.get(d.event.id)||0)+1);
 events=events.filter(e=>counts.has(e.id));
 $('events').innerHTML=events.map(e=>`<article><a href="${esc(e.source)}" target="_blank" rel="noreferrer"><span>${esc(e.name)}</span><span aria-hidden="true">↗</span></a></article>`).join('')||'<p class="muted">Nenhum evento com listas neste recorte.</p>';
}
async function refresh(){
 invalidateFrequency();hideWeeklyTooltip();++cardGeneration;cardIndex=null;cardBase=[];$('card-options').textContent='';const token=++generation;++frequencyGeneration;++detailGeneration;++bestGeneration;$('best-list').textContent='';if($('deck').open)$('deck').close();$('frequency').textContent='';$('frequency-status').textContent='';
 $('events').textContent='Carregando eventos do recorte…';$('content').hidden=true;$('retry').hidden=true;$('coverage').textContent='';entries=[];filtered=[];
 try{const events=scopeEvents(),r=range();$('status').textContent='Carregando resumos do período…';
  const enabled=$('period').value!=='custom';
  const days=Math.round((new Date(r.end+'T12:00:00Z')-new Date(r.start+'T12:00:00Z'))/86400000)+1;
  const previousStart=ModernTrends.addDays(r.start,-days);
  const historyEvents=enabled?catalog.events.filter(e=>e.date>=previousStart&&e.date<r.start&&($('modality').value==='both'||e.modality===$('modality').value)&&e.complete):[];
  const weeklyRange={start:ModernTrends.addDays(today(),-89),end:today()};
  const weeklyEvents=catalog.events.filter(e=>e.date>=weeklyRange.start&&e.date<=weeklyRange.end&&($('modality').value==='both'||e.modality===$('modality').value)&&e.complete);
  const allEvents=[...events,...historyEvents,...weeklyEvents],months=[...new Set(allEvents.map(e=>e.date.slice(0,7)))];
  const chunks=await Promise.all(months.map(m=>read(catalog.months[m])));if(token!==generation)return;
  const byId=new Map(allEvents.map(e=>[e.id,e]));
  const history=chunks.flat().filter(group=>byId.has(group.eventId)).flatMap(group=>group.entries.map(d=>({...d,event:byId.get(group.eventId)}))).filter(inPlacement);
  const eventIds=new Set(events.map(e=>e.id));entries=history.filter(d=>eventIds.has(d.event.id));
  const weeklyIds=new Set(weeklyEvents.map(e=>e.id));weeklyEntries=history.filter(d=>weeklyIds.has(d.event.id));
  renderEvents(events);
  const trend=ModernTrends.movement(history.map(trendDeck),today(),r);
  groups=[...new Set(history.map(d=>d.archetype))].sort().map(name=>[name,name]);
  seriesStyleIndex=new Map([...new Set(weeklyEntries.map(d=>d.archetype))].sort().map((id,i)=>[id,i]));
  $('trend-note').textContent=!enabled?'Comparação indisponível no período personalizado.':`Setas: comparação com ${pretty(trend.previousStart)}–${pretty(trend.previousEnd)}.${trend.sufficient?'':' Dados insuficientes para comparar.'}`;
  const arrow=id=>{if(!enabled)return '';const t=trend.changes.get(id);if(!t)return '';if(t.kind==='new'||t.kind==='absent')return `<small class="trend-tag">${t.kind==='new'?'Novo no recorte':'Ausente no recorte'}</small>`;const label=`${t.kind==='up'?'Subiu':'Desceu'} ${Math.abs(t.delta)} posições: ${t.before}º → ${t.after}º`;return `<span class="trend-arrow ${t.kind}" role="img" aria-label="${esc(label)}" title="${esc(label)}">${(t.kind==='up'?'↑':'↓').repeat(t.large?2:1)}</span>`;};
  $('coverage').textContent=`${pretty(r.start)} a ${pretty(r.end)} · ${events.length} eventos · ${entries.length} listas`;
  $('denominator').textContent=`${entries.length} listas · ${$('modality').selectedOptions[0].textContent}`;
  const counts=new Map();for(const d of entries)counts.set(d.archetype,(counts.get(d.archetype)||0)+1);
  const sorted=[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));const threshold=sorted[31]?.[1]||0;
  const visible=sorted.filter(x=>x[1]>=threshold);otherIds=sorted.filter(x=>x[1]<threshold).map(x=>x[0]);
  if(othersMode)selectedArchetypes=new Set(otherIds);
  const other=sorted.filter(x=>x[1]<threshold).reduce((n,x)=>n+x[1],0);
  const bars=[...visible,...(other?[['__others__',other]]:[])];
  $('chart').innerHTML=bars.map(([name,n])=>`<button class="bar-row${name!=='__others__'&&n===sorted[0]?.[1]?' leading':''}" data-name="${esc(name)}" aria-pressed="${name==='__others__'?othersMode:selectedArchetypes.has(name)}"><span class="bar-label"><span>${name==='__others__'?'Outros':esc(name)} ${name==='__others__'?'':arrow(name)}</span><span>${n} · ${pct(n,entries.length)}</span></span><span class="track"><span class="fill" style="width:${100*n/entries.length}%"></span></span></button>`).join('');
  renderPicker(counts);renderWeekly(weeklyEntries.map(trendDeck),weeklyRange);
  $('status').textContent=entries.length?'':'Nenhuma lista neste recorte. Isso não significa que não houve torneios.';
  $('content').hidden=false;consult();
 }catch(error){if(token!==generation)return;$('events').textContent='Eventos indisponíveis até carregar um recorte válido.';$('status').textContent=`Não foi possível carregar o recorte: ${error.message}. Nenhum total parcial foi calculado.`;$('retry').hidden=false;}
}
let cardGeneration=0,cardBase=[],cardIndex=null,selectedCards=new Set();
function consult(){++frequencyGeneration;$('frequency').textContent='';$('frequency-status').textContent='';const q=$('query').value.trim().toLocaleLowerCase();
 filtered=entries.filter(d=>(!(selectedArchetypes.size||othersMode)||selectedArchetypes.has(d.archetype))&&(!q||[d.player,d.archetype].join(' ').toLocaleLowerCase().includes(q)));
 cardBase=filtered;cardIndex=null;++cardGeneration;$('card-options').textContent='';$('card-status').textContent='';
 if(selectedCards.size||$('card-picker').open)loadCardOptions();
 applyCards();}
function applyCards(){
 ++frequencyGeneration;$('frequency').textContent='';$('frequency-status').textContent='';
 filtered=selectedCards.size?cardBase.filter(d=>cardIndex&&[...selectedCards].every(c=>cardIndex.get(d.id)?.has(c))):[...cardBase];
 filtered.sort((a,b)=>b.event.date.localeCompare(a.event.date)||Number(a.rankLabel.split('-')[0])-Number(b.rankLabel.split('-')[0])||a.id.localeCompare(b.id));page=0;renderRows();renderBest();scheduleFrequency();}
function renderRows(){const size=24;$('list-count').textContent=selectedCards.size&&!cardIndex?'Aguardando cartas para filtrar as listas…':`${filtered.length} de ${entries.length} listas na consulta.`;
 $('results').className='table-scroll';
 $('results').innerHTML=filtered.length?`<table class="deck-table"><thead><tr><th>Data</th><th>Colocação</th><th>Arquétipo</th><th>Jogador</th><th>Torneio</th><th>Decklist</th></tr></thead><tbody>${filtered.slice(page*size,(page+1)*size).map(d=>`<tr class="deck-row"><td>${pretty(d.event.date)}</td><td class="placement">${esc(d.rankLabel)}</td><td><strong>${esc(d.archetype)}</strong></td><td>${esc(d.player)}</td><td>${esc(d.event.name)}${d.event.complete?'':' · AMOSTRA PARCIAL'}</td><td><button class="deck-link" data-deck="${esc(d.id)}">Ver lista ↗</button></td></tr>`).join('')}</tbody></table>`:'<p class="empty">Nenhuma lista neste filtro.</p>';
 $('prev').disabled=page===0;$('next').disabled=(page+1)*size>=filtered.length;$('page').textContent=filtered.length?`${page*size+1}–${Math.min((page+1)*size,filtered.length)} de ${filtered.length}`:'0 listas';}
function deckNotes(d){
 const notes=[];
 if(d.original&&d.original!==d.archetype)notes.push(`Nome na fonte: ${esc(d.original)}`);
 if(d.review&&/pendente|provis|não class|sem regra|automát|conflito/i.test(d.review))notes.push(`Classificação: ${esc(d.review)}`);
 if(d.resultSource)notes.push(`<a href="${esc(d.resultSource)}" target="_blank" rel="noreferrer">Fonte da campanha ↗</a>`);
 return notes.length?`<details class="deck-notes"><summary>Detalhes da lista</summary>${notes.map(n=>`<p>${n}</p>`).join('')}</details>`:'';
}
async function openDeck(id){const d=entries.find(d=>d.id===id);if(!d)return;const token=++detailGeneration;
 $('detail').innerHTML='<p role="status">Carregando lista…</p>';if(!$('deck').open)$('deck').showModal();
 try{const [payload,cardData]=await Promise.all([read(d.event.detail),read(catalog.cardMetadata)]);if(token!==detailGeneration||!$('deck').open)return;const zones=payload[id];if(!zones)throw Error('Lista ausente no arquivo do evento');
 $('detail').innerHTML=`<div data-copy-scope><div class="deck-heading"><div class="deck-title-actions"><h2>${esc(d.archetype)}</h2>${ModernCards.copyControl()}</div><p class="deck-meta" tabindex="0" role="region" aria-label="Dados da lista"><span><b>Jogador:</b> ${esc(d.player)} · <b>Colocação:</b> ${esc(d.rankLabel)}${/^\d+$/.test(d.rankLabel)?'º':''} · <b>Data:</b> ${pretty(d.event.date)} · <b>Torneio:</b> ${esc(d.event.name)} · <a href="${esc(d.source)}" target="_blank" rel="noreferrer">Fonte ↗</a></span></p></div>${ModernCards.render(zones,cardData)}${deckNotes(d)}</div>`;$('deck').scrollTop=0;
 }catch(e){if(token===detailGeneration)$('detail').innerHTML=`<p role="alert">${esc(e.message)}. Feche e abra a lista para tentar novamente.</p>`;}}
let frequencyTimer,frequencyResult=null,frequencyZone='main',frequencyExpanded=new Set();
const frequencyCache=new Map();
function invalidateFrequency(){clearTimeout(frequencyTimer);++frequencyGeneration;frequencyResult=null;$('frequency').textContent='';$('frequency-status').textContent='';$('frequency-retry').hidden=true;$('frequency-section').hidden=true;}
function scheduleFrequency(){
 invalidateFrequency();if(!selectedArchetypes.size)return;
 $('frequency-section').hidden=false;
 if(selectedCards.size&&!cardIndex){$('frequency-status').textContent='Aguardando cartas para aplicar o filtro…';return;}
 if(!filtered.length){$('frequency-status').textContent='Nenhuma lista corresponde aos filtros atuais.';return;}
 $('frequency-status').textContent='Carregando cartas de todas as listas filtradas…';frequencyTimer=setTimeout(frequency,250);
}
async function frequency(){
 if(!selectedArchetypes.size||(selectedCards.size&&!cardIndex)||!filtered.length)return;
 const token=++frequencyGeneration,selected=[...filtered],key=selected.map(d=>d.id).sort().join('|');
 $('frequency-retry').hidden=true;$('frequency-status').textContent='Carregando cartas de todas as listas filtradas…';
 try{
 let result=frequencyCache.get(key);
 if(!result){
  const batches=new Map();for(const d of selected){if(!batches.has(d.event.id))batches.set(d.event.id,[]);batches.get(d.event.id).push(d);}
  const sources=[...batches.values()],counts={main:new Map(),sideboard:new Map()};let cursor=0;
  const metadata=read(catalog.cardMetadata);
  const [,cardData]=await Promise.all([Promise.all(Array.from({length:Math.min(4,sources.length)},async()=>{while(cursor<sources.length){if(token!==frequencyGeneration)return;const batch=sources[cursor++],payload=await read(batch[0].event.detail);if(token!==frequencyGeneration)return;
   for(const d of batch){const zones=payload[d.id];if(!zones)throw Error('Lista ausente');for(const z of ['main','sideboard']){const cards=new Map();for(const c of zones[z])cards.set(c.name_original,(cards.get(c.name_original)||0)+c.quantity);for(const [name,q] of cards){const v=counts[z].get(name)||{n:0,q:0};v.n++;v.q+=q;counts[z].set(name,v);}}}
  }})),metadata]);
  if(token!==frequencyGeneration)return;
  result={counts,cardData,total:selected.length,events:sources.length};frequencyCache.set(key,result);if(frequencyCache.size>8)frequencyCache.delete(frequencyCache.keys().next().value);
 }
 if(token!==frequencyGeneration)return;frequencyResult=result;frequencyExpanded.clear();
 $('frequency-status').textContent=`${result.total} listas · ${result.events} eventos. Presença nas listas filtradas; média de cópias entre as listas que usam a carta.${selectedCards.size?' Base restrita às cartas selecionadas.':''}`;renderFrequency();
 }catch(e){if(token===frequencyGeneration){++frequencyGeneration;frequencyResult=null;$('frequency').textContent='';$('frequency-status').textContent=`Não foi possível calcular a frequência: ${e.message}. Nenhum resultado parcial foi exibido.`;$('frequency-retry').hidden=false;}}
}
function renderFrequency(){
 if(!frequencyResult)return;const {counts,cardData,total}=frequencyResult;
 $('frequency').innerHTML='<div class="frequency-grid">'+['main','sideboard'].map(z=>{const all=[...counts[z]].sort((a,b)=>b[1].n-a[1].n||a[0].localeCompare(b[0])),rows=frequencyExpanded.has(z)?all:all.slice(0,10);return `<div id="frequency-${z}" class="frequency-zone" data-zone="${z}" role="tabpanel" aria-labelledby="frequency-tab-${z}"><h4>${z==='main'?'Main deck':'Sideboard'}</h4><div class="frequency-head"><span>Carta / custo</span><span>Presença</span><span>Média</span></div>${rows.map(([name,v])=>`<div class="frequency-row"><div class="frequency-card"><span>${esc(name)}</span>${ModernCards.manaFor(name,cardData)}</div><span class="frequency-presence">${pct(v.n,total)}<small>${v.n}/${total} listas</small></span><span class="frequency-average">${(v.q/v.n).toLocaleString('pt-BR',{maximumFractionDigits:1})}<small>cópias</small></span></div>`).join('')||'<p class="muted">Nenhuma carta nesta zona nas listas filtradas.</p>'}${all.length>10?`<button class="secondary" data-frequency-expand="${z}" aria-expanded="${frequencyExpanded.has(z)}">${frequencyExpanded.has(z)?'Mostrar só 10':`Ver todas (${all.length})`}</button>`:''}</div>`}).join('')+'</div>';syncFrequencyTabs();
}
function syncFrequencyTabs(){const mobile=matchMedia('(max-width:600px)').matches;for(const z of ['main','sideboard']){const active=z===frequencyZone,tab=$('frequency-tab-'+z),panel=$('frequency-'+z);tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;if(panel){panel.hidden=mobile&&!active;panel.setAttribute('role',mobile?'tabpanel':'region');}}}
document.querySelector('.frequency-tabs').onclick=e=>{const z=e.target.closest('[data-frequency-zone]')?.dataset.frequencyZone;if(z){frequencyZone=z;syncFrequencyTabs();}};
document.querySelector('.frequency-tabs').onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();frequencyZone=e.key==='Home'?'main':e.key==='End'?'sideboard':frequencyZone==='main'?'sideboard':'main';syncFrequencyTabs();$('frequency-tab-'+frequencyZone).focus();}};
$('frequency').onclick=e=>{const z=e.target.closest('[data-frequency-expand]')?.dataset.frequencyExpand;if(z){frequencyExpanded.has(z)?frequencyExpanded.delete(z):frequencyExpanded.add(z);renderFrequency();$('frequency').querySelector(`[data-frequency-expand="${z}"]`)?.focus();}};
matchMedia('(max-width:600px)').addEventListener('change',syncFrequencyTabs);

function renderCardOptions(){
 const q=$('card-query').value.trim().toLocaleLowerCase();
 const names=[...new Set([...(cardIndex?[...cardIndex.values()].flatMap(s=>[...s]):[]),...selectedCards])].sort((a,b)=>a.localeCompare(b,'en'));
 const focused=document.activeElement?.dataset.card;
 $('card-options').innerHTML=names.filter(n=>!q||n.toLocaleLowerCase().includes(q)).map(n=>`<label class="check"><input type="checkbox" data-card="${esc(n)}" ${selectedCards.has(n)?'checked':''}><span>${esc(n)}</span></label>`).join('');
 $('card-summary').textContent=selectedCards.size?`${selectedCards.size} carta(s) selecionada(s)`:'Todas as cartas';
 $('card-selected').innerHTML=[...selectedCards].map(n=>`<button class="secondary" data-remove-card="${esc(n)}" aria-label="Remover ${esc(n)}">${esc(n)} ×</button>`).join('');
 if(focused)$('card-options').querySelector(`[data-card="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
}
async function loadCardOptions(){
 if(cardIndex){renderCardOptions();return;}
 const token=++cardGeneration,base=[...cardBase],index=new Map(),byEvent=new Map();
 for(const d of base){if(!byEvent.has(d.event.id))byEvent.set(d.event.id,[]);byEvent.get(d.event.id).push(d);}
 const batches=[...byEvent.values()];let cursor=0;
 $('card-options').textContent='';$('card-retry').hidden=true;$('card-status').textContent=`Carregando cartas de ${base.length} listas em ${batches.length} eventos…`;
 try{
  await Promise.all(Array.from({length:Math.min(4,batches.length)},async()=>{while(cursor<batches.length){
   if(token!==cardGeneration)return;const batch=batches[cursor++],payload=await read(batch[0].event.detail);
   if(token!==cardGeneration)return;
   for(const d of batch){const zones=payload[d.id];if(!zones)throw Error('Lista ausente');index.set(d.id,new Set([...zones.main,...zones.sideboard].map(c=>c.name_original)));}
  }}));
  if(token!==cardGeneration)return;cardIndex=index;
  $('card-status').textContent=base.length?'':'Nenhuma lista nos filtros atuais.';
  renderCardOptions();if(selectedCards.size)applyCards();
 }catch(e){if(token!==cardGeneration)return;$('card-status').textContent=`Não foi possível carregar as cartas: ${e.message}. Tente novamente.`;$('card-retry').hidden=false;}
}
$('card-picker').ontoggle=()=>{if($('card-picker').open)loadCardOptions();};
$('card-query').oninput=renderCardOptions;
$('card-retry').onclick=loadCardOptions;
$('card-options').onchange=e=>{const name=e.target.dataset.card;if(!name)return;if(e.target.checked)selectedCards.add(name);else selectedCards.delete(name);renderCardOptions();applyCards();};
$('card-clear').onclick=()=>{selectedCards.clear();renderCardOptions();applyCards();};
$('card-selected').onclick=e=>{const b=e.target.closest('[data-remove-card]');if(b){selectedCards.delete(b.dataset.removeCard);renderCardOptions();applyCards();}};

async function init(){try{catalog=await read({path:document.body.dataset.catalog,sha256:document.body.dataset.hash});period();
 await refresh();
 }catch(e){$('status').textContent=`Falha no catálogo: ${e.message}`;$('retry').hidden=false;}}
document.querySelector('.skip').addEventListener('click',()=>{$('listas').open=true;});
$('retry').onclick=()=>catalog?refresh():init();$('modality').onchange=refresh;$('period').onchange=()=>{period();refresh();};
for(const id of ['start','end','placement'])$(id).onchange=refresh;
let queryTimer;
$('query').oninput=()=>{invalidateFrequency();clearTimeout(queryTimer);queryTimer=setTimeout(consult,250);};
$('frequency-retry').onclick=frequency;
$('prev').onclick=()=>{page--;renderRows();};$('next').onclick=()=>{page++;renderRows();};
$('results').onclick=e=>{const b=e.target.closest('[data-deck]');if(b)openDeck(b.dataset.deck);};
function updateSelection(){const counts=new Map();for(const d of entries)counts.set(d.archetype,(counts.get(d.archetype)||0)+1);renderPicker(counts);for(const b of $('chart').querySelectorAll('[data-name]'))b.setAttribute('aria-pressed',String(b.dataset.name==='__others__'?othersMode:selectedArchetypes.has(b.dataset.name)));consult();}
$('chart').onclick=e=>{const b=e.target.closest('[data-name]');if(b){if(b.dataset.name==='__others__'){othersMode=true;selectedArchetypes=new Set(otherIds);}else{const clear=!othersMode&&selectedArchetypes.size===1&&selectedArchetypes.has(b.dataset.name);othersMode=false;selectedArchetypes=clear?new Set():new Set([b.dataset.name]);}updateSelection();$('listas').open=true;$('listas').scrollIntoView();}};
$('arquetipo-options').onchange=e=>{const id=e.target.dataset.pick;if(id){othersMode=false;if(e.target.checked)selectedArchetypes.add(id);else selectedArchetypes.delete(id);updateSelection();}};
$('arquetipo-options').onclick=e=>{const b=e.target.closest('[data-only]');if(b){othersMode=false;selectedArchetypes=new Set([b.dataset.only]);updateSelection();$('arquetipo').open=false;}};
$('arquetipo-all').onclick=()=>{othersMode=false;selectedArchetypes.clear();updateSelection();$('arquetipo').open=false;};
for(const id of ['arquetipo','card-picker','weekly-picker']){document.addEventListener('click',e=>{if(!$(id).contains(e.target))$(id).open=false;});$(id).addEventListener('keydown',e=>{if(e.key==='Escape'){$(id).open=false;$(id).querySelector('summary').focus();}});}
document.addEventListener('click',e=>{const button=e.target.closest('[data-copy-deck]');if(button)ModernCards.copy(button);});
$('best-list').onclick=e=>{const b=e.target.closest('[data-best-deck]');if(b)openDeck(b.dataset.bestDeck);const retry=e.target.closest('[data-retry-best]');if(retry)renderBest();};
$('close').onclick=()=>{$('deck').close();++detailGeneration;};$('deck').addEventListener('close',()=>++detailGeneration);
init();

function renderPicker(counts){
 const focused=document.activeElement;
 const focusId=focused?.dataset.pick??focused?.dataset.only;
 const focusKind=focused?.hasAttribute('data-pick')?'pick':'only';
 $('arquetipo-summary').textContent=othersMode?`Outros · ${selectedArchetypes.size} arquétipos selecionados`:selectedArchetypes.size===1?(groups.find(([id])=>selectedArchetypes.has(id))||[...selectedArchetypes])[1]||[...selectedArchetypes][0]:selectedArchetypes.size?`${selectedArchetypes.size} arquétipos selecionados`:'Todos os arquétipos';
 const options=[...new Map([...groups,...[...selectedArchetypes].map(id=>[id,id])])].sort((a,b)=>Number(selectedArchetypes.has(b[0]))-Number(selectedArchetypes.has(a[0]))||a[1].localeCompare(b[1]));
 $('arquetipo-options').innerHTML=options.map(([id,name])=>`<div class="archetype-option"><label><input type="checkbox" data-pick="${esc(id)}" ${selectedArchetypes.has(id)?'checked':''}><span>${esc(name)} <small>(${counts.get(id)||0} listas)</small></span></label><button class="secondary" data-only="${esc(id)}" aria-label="Somente ${esc(name)}">Somente este</button></div>`).join('');
 if(focusId)$('arquetipo-options').querySelector(`[data-${focusKind}="${CSS.escape(focusId)}"]`)?.focus({preventScroll:true});
}

function renderWeekly(base,range){
 const requestedEnd=range.end||catalog.events.map(e=>e.date).sort().at(-1);
 const end=requestedEnd<ModernFilters.today()?requestedEnd:ModernFilters.today();
 const start=range.start||catalog.events.map(e=>e.date).sort()[0];
 // Sem dados no período não produz uma cronologia vazia até a data atual.
 weeklyData=range.error||!base.length?[]:ModernTrends.weekly(base,start,end,ModernFilters.today());
 if(!weeklyData.some(w=>w.start===weeklySelected&&w.total))weeklySelected=[...weeklyData].reverse().find(w=>w.total&&!w.partial)?.start||[...weeklyData].reverse().find(w=>w.total)?.start||'';
 $('trend-week').innerHTML=weeklyData.map(w=>`<option value="${w.start}" ${w.start===weeklySelected?'selected':''} ${!w.total?'disabled':''}>${date(w.start)}${w.partial?' · parcial':''}${!w.total?' · sem listas':''}</option>`).join('');
 $('trend-week').disabled=!weeklyData.length;
 drawWeekly();
}
const weeklyColors=['#bd93f9','#8be9fd','#50fa7b','#ffb86c','#ff79c6','#f1fa8c','#f8f8f2','#ff5555'];
function weeklyStyle(id){const index=seriesStyleIndex.get(id)||0;return {color:weeklyColors[index%weeklyColors.length],dash:['','7 4','2 4','10 4 2 4'][Math.floor(index/weeklyColors.length)%4]};}
function weeklySwatch(id){const {color,dash}=weeklyStyle(id);return `<svg width="24" height="12" aria-hidden="true"><line x1="1" y1="6" x2="23" y2="6" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${dash}"/></svg>`;}
function weeklyIds(){return weeklySelection===null?(weeklyData.find(w=>w.start===weeklySelected)?.top||[]):[...weeklySelection];}
function renderWeeklyPicker(){
 const ids=weeklyIds(),available=[...new Set(weeklyEntries.map(d=>d.archetype))],q=$('weekly-query').value.trim().toLocaleLowerCase();
 seriesStyleIndex=new Map([...new Set([...ids,...available.sort()])].map((id,i)=>[id,i]));
 $('weekly-selected').innerHTML=ids.length?'<h4>Selecionados</h4>'+ids.map(id=>`<button type="button" class="weekly-selected-item" data-weekly-remove="${esc(id)}" aria-label="Remover ${esc(id)}">${weeklySwatch(id)}<span>${esc(id)}${available.includes(id)?'':' · sem dados'}</span><span aria-hidden="true">×</span></button>`).join(''):'';
 const options=[...new Set([...available,...ids])].sort((a,b)=>a.localeCompare(b,'pt-BR'));
 $('weekly-picker-summary').textContent=weeklySelection===null?`Líderes da semana · ${ids.length}`:ids.length===1?ids[0]:`${ids.length} arquétipos selecionados`;
 $('weekly-options').innerHTML=options.filter(id=>id.toLocaleLowerCase().includes(q)).map(id=>`<label class="weekly-option"><input type="checkbox" data-weekly-id="${esc(id)}" ${ids.includes(id)?'checked':''}>${weeklySwatch(id)}<span>${esc(id)}${available.includes(id)?'':' <small>· sem listas nesta modalidade/colocação</small>'}</span></label>`).join('')||'<p class="muted">Nenhum arquétipo encontrado.</p>';
}
function drawWeekly(){
 hideWeeklyTooltip();renderWeeklyPicker();
 const week=weeklyData.find(w=>w.start===weeklySelected);
 if(!week){$('weekly-chart').innerHTML='<p class="empty">Sem listas disponíveis nos últimos 90 dias para estes filtros.</p>';for(const id of ['weekly-context','weekly-changes','weekly-legend','weekly-table'])$(id).textContent='';return;}
 const available=new Set(weeklyEntries.map(d=>d.archetype)),ids=weeklyIds().filter(id=>available.has(id)),index=weeklyData.indexOf(week),previous=weeklyData[index-1];
 $('weekly-context').textContent=`Semana de ${date(week.start)} a ${date(week.end)}${week.partial?' · incompleta':''} · ${week.total} listas · ${week.events} eventos`;
 const entered=previous?.total?week.top.filter(id=>!previous.top.includes(id)):[],left=previous?.total?previous.top.filter(id=>!week.top.includes(id)):[];
 $('weekly-changes').textContent=previous?.total?`Entraram no Top 8 desde a semana anterior: ${entered.join(', ')||'nenhum'}. Saíram: ${left.join(', ')||'nenhum'}.`:'Sem semana anterior com dados na janela para comparar entradas e saídas.';
 const width=Math.max(280,$('weekly-chart').clientWidth||960),compact=width<700,height=compact?300:360,leftPad=42,rightPad=compact?18:170,top=38,bottom=42;
 const max=Math.max(5,...weeklyData.flatMap(w=>w.total?ids.map(id=>100*(w.counts.get(id)||0)/w.total):[]));
 const tick=max<=20?5:max<=50?10:20,ceiling=Math.ceil(max/tick)*tick,x=i=>leftPad+(width-leftPad-rightPad)*(weeklyData.length===1?.5:i/(weeklyData.length-1)),y=v=>height-bottom-(height-top-bottom)*v/ceiling;
 let svg=`<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-label="Participação semanal dos arquétipos selecionados"><title>O Modern em movimento</title><desc>Participação nas listas publicadas de cada semana. Linhas sem interpolação; lacunas indicam semanas sem listas. Valores exatos na tabela abaixo.</desc>`;
 for(let value=0;value<=ceiling;value+=tick){svg+=`<line class="weekly-gridline" x1="${leftPad}" y1="${y(value)}" x2="${width-rightPad}" y2="${y(value)}"/><text class="weekly-axis" x="${leftPad-10}" y="${y(value)+4}" text-anchor="end">${value}%</text>`;}
 const selectedX=x(index);svg+=`<rect x="${Math.max(leftPad,selectedX-14)}" y="${top}" width="${Math.min(28,width-rightPad-Math.max(leftPad,selectedX-14))}" height="${height-top-bottom}" rx="6" fill="#bd93f9" opacity=".07"/><line x1="${selectedX}" y1="${top}" x2="${selectedX}" y2="${height-bottom}" stroke="#bd93f9" stroke-opacity=".35" stroke-dasharray="3 5"/><text class="weekly-reference" x="${Math.max(leftPad+28,Math.min(width-rightPad-28,selectedX))}" y="20" text-anchor="middle">${date(week.start).slice(0,5)}${week.partial?'*':''}</text>`;
 const step=compact?3:2;
 weeklyData.forEach((w,i)=>{if((i%step===0&&i<weeklyData.length-(compact?3:2))||i===weeklyData.length-1)svg+=`<text class="weekly-axis" x="${x(i)}" y="${height-16}" text-anchor="middle">${date(w.start).slice(0,5)}${w.partial?'*':''}</text>`;});
 const labels=[];
 ids.forEach(id=>{
  const {color,dash}=weeklyStyle(id);let path='',connected=false;
  weeklyData.forEach((w,i)=>{if(!w.total){connected=false;return;}const value=100*(w.counts.get(id)||0)/w.total;path+=`${connected?'L':'M'}${x(i)},${y(value)} `;connected=true;});
  svg+=`<g data-weekly-series="${esc(id)}"><path class="weekly-series-line" d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${dash}"/>`;
  const total=weeklyEntries.filter(d=>d.archetype===id).length;
  weeklyData.forEach((w,i)=>{if(!w.total)return;const n=w.counts.get(id)||0,value=100*n/w.total,label=`${id} · Semana de ${date(w.start)} a ${date(w.end)}${w.partial?' (parcial)':''} · Participação nesta semana: ${pct(n,w.total)} (${n} de ${w.total} listas); nos últimos 90 dias: ${pct(total,weeklyEntries.length)} (${total} de ${weeklyEntries.length} listas)`;svg+=`<g class="weekly-point" tabindex="0" role="button" aria-label="${esc(label)}" data-tooltip="${esc(label)}"><circle cx="${x(i)}" cy="${y(value)}" r="10" fill="transparent"/><circle class="point-dot" cx="${x(i)}" cy="${y(value)}" r="${i===index?4:2.5}" stroke="${color}" stroke-width="1.5" fill="${w.top.includes(id)?color:'#242631'}"/></g>`;});svg+='</g>';
  const last=weeklyData.at(-1);if(last?.total)labels.push({id,color,value:100*(last.counts.get(id)||0)/last.total});
 });
 // Rótulos diretos só quando há espaço para evitar sobreposição; legenda textual sempre disponível.
 if(!compact&&labels.length<=10){labels.sort((a,b)=>b.value-a.value);labels.forEach((l,i)=>{l.labelY=Math.max(y(l.value),i?labels[i-1].labelY+22:top+4)});const overflow=Math.max(0,(labels.at(-1)?.labelY||0)-(height-bottom));for(const l of labels){l.labelY-=overflow;const endX=width-rightPad;svg+=`<path d="M${endX+6},${y(l.value)} L${endX+18},${l.labelY} H${endX+26}" fill="none" stroke="${l.color}" opacity=".4"/><text class="weekly-end-label" x="${endX+32}" y="${l.labelY+4}" style="fill:${l.color}">${esc(l.id.length>19?l.id.slice(0,18)+'…':l.id)}<title>${esc(l.id)} · ${pct(l.value,100)}</title></text>`;}}
 $('weekly-chart').innerHTML=ids.length?svg+'</svg>':'<div class="weekly-empty"><h3>Escolha os decks que quer acompanhar</h3><p>Abra o seletor de arquétipos ou use os líderes da semana.</p></div>';
 $('weekly-legend').innerHTML=ids.map(id=>`<span class="weekly-legend-item">${weeklySwatch(id)}<span>${esc(id)}</span></span>`).join('');
 $('weekly-table').innerHTML=`<table class="weekly-values"><thead><tr><th scope="col">Semana (seg.–dom.)</th><th scope="col">Base</th>${ids.map(id=>`<th scope="col">${esc(id)}</th>`).join('')}</tr></thead><tbody>${weeklyData.map(w=>`<tr><th scope="row">${date(w.start)}–${date(w.end)}${w.partial?' · parcial':''}</th><td>${w.events} eventos / ${w.total} listas</td>${ids.map(id=>`<td>${w.total?`${pct(w.counts.get(id)||0,w.total)} · ${w.counts.get(id)||0}/${w.total}${w.top.includes(id)?' · Top 8':''}`:'Sem dados'}</td>`).join('')}</tr>`).join('')}</tbody></table><p class="muted">* Semana parcial por limite da janela, início da base ou semana em andamento. Semanas completas no calendário não garantem coleta de todos os eventos.</p>`;
}
function hideWeeklyTooltip(){
 $('weekly-tooltip').hidden=true;
 $('weekly-chart').querySelectorAll('[aria-describedby="weekly-tooltip"]').forEach(n=>n.removeAttribute('aria-describedby'));
}
function showWeeklyTooltip(point){
 if(!point)return;
 const tip=$('weekly-tooltip');hideWeeklyTooltip();tip.textContent=point.dataset.tooltip;tip.hidden=false;point.setAttribute('aria-describedby','weekly-tooltip');
 const r=point.getBoundingClientRect(),t=tip.getBoundingClientRect();
 tip.style.left=Math.max(8,Math.min(innerWidth-t.width-8,r.left+r.width/2-t.width/2))+'px';
 tip.style.top=Math.max(8,r.top-t.height-10>=8?r.top-t.height-10:Math.min(innerHeight-t.height-8,r.bottom+10))+'px';
}
$('weekly-chart').addEventListener('focusin',e=>{const point=e.target.closest('.weekly-point');if(point)requestAnimationFrame(()=>requestAnimationFrame(()=>{if(document.activeElement===point)showWeeklyTooltip(point);}));});
for(const type of ['pointerover','click'])$('weekly-chart').addEventListener(type,e=>showWeeklyTooltip(e.target.closest('.weekly-point')));
$('weekly-chart').addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)&&e.target.closest('.weekly-point')){e.preventDefault();showWeeklyTooltip(e.target.closest('.weekly-point'));}});
$('weekly-chart').addEventListener('pointerout',e=>{if(e.pointerType==='touch')return;if(!e.relatedTarget?.closest?.('.weekly-point, #weekly-tooltip'))hideWeeklyTooltip();});
$('weekly-tooltip').addEventListener('pointerleave',hideWeeklyTooltip);
$('weekly-chart').addEventListener('focusout',hideWeeklyTooltip);
document.addEventListener('keydown',e=>{if(e.key==='Escape')hideWeeklyTooltip();});
document.addEventListener('click',e=>{if(!e.target.closest('.weekly-point, #weekly-tooltip'))hideWeeklyTooltip();});
window.addEventListener('resize',hideWeeklyTooltip);document.addEventListener('scroll',hideWeeklyTooltip,true);
$('trend-week').addEventListener('change',()=>{weeklySelected=$('trend-week').value;drawWeekly();});
$('weekly-selected').onclick=e=>{const b=e.target.closest('[data-weekly-remove]');if(!b)return;const id=b.dataset.weeklyRemove,ids=weeklyIds(),i=ids.indexOf(id);weeklySelection=new Set(ids);weeklySelection.delete(id);drawWeekly();const next=$('weekly-selected').querySelectorAll('button');(next[Math.min(i,next.length-1)]||$('weekly-query')).focus();};
$('weekly-query').addEventListener('input',renderWeeklyPicker);
$('weekly-options').addEventListener('change',e=>{const id=e.target.dataset.weeklyId;if(!id)return;weeklySelection=new Set(weeklyIds());if(e.target.checked)weeklySelection.add(id);else weeklySelection.delete(id);drawWeekly();$('weekly-options').querySelector(`[data-weekly-id="${CSS.escape(id)}"]`)?.focus({preventScroll:true});});
$('weekly-reset').addEventListener('click',()=>{weeklySelection=null;drawWeekly();});
$('weekly-clear').addEventListener('click',()=>{weeklySelection=new Set();drawWeekly();});
$('weekly-picker').addEventListener('keydown',e=>{if(e.key==='Escape'){$('weekly-picker').open=false;$('weekly-picker-summary').focus();}});
let weeklyWidth=0;
new ResizeObserver(items=>{const width=items[0].contentRect.width;if(width>0&&width!==weeklyWidth){weeklyWidth=width;requestAnimationFrame(drawWeekly);}}).observe($('weekly-chart'));


async function renderBest(){
 const token=++bestGeneration;
 if(selectedCards.size&&!cardIndex){$('best-list').innerHTML='<p role="status">Aguardando cartas para encontrar a melhor lista do filtro.</p>';return;}
 if(!selectedArchetypes.size&&!othersMode){$('best-list').textContent='';return;}
 const order=d=>Number(d.rankLabel.split('-').at(-1))||Infinity;
 const best=[...filtered].sort((a,b)=>order(a)-order(b)||b.event.date.localeCompare(a.event.date)||a.id.localeCompare(b.id))[0];
 if(!best){$('best-list').innerHTML='<p class="empty">Nenhuma lista neste filtro para destacar.</p>';return;}
 $('best-list').innerHTML='<p role="status">Carregando a lista de melhor colocação…</p>';
 try{const [payload,cardData]=await Promise.all([read(best.event.detail),read(catalog.cardMetadata)]);if(token!==bestGeneration)return;const zones=payload[best.id];if(!zones)throw Error('Lista ausente');
 $('best-list').innerHTML=`<div class="insight-panel" data-copy-scope data-best-id="${esc(best.id)}"><div class="eyebrow">Melhor resultado nas listas filtradas</div><div class="deck-title-actions"><h3>${esc(best.rankLabel)} · ${esc(best.archetype)}</h3>${ModernCards.copyControl()}<button type="button" class="deck-action best-details" data-best-deck="${esc(best.id)}">Detalhes <span aria-hidden="true">↗</span></button></div><p class="best-deck-meta">${esc(best.player)} · ${esc(best.event.name)} · ${pretty(best.event.date)}</p>${ModernCards.render(zones,cardData)}</div>`;
 }catch(error){if(token===bestGeneration)$('best-list').innerHTML=`<p role="alert">${esc(error.message)}</p><button data-retry-best>Tentar novamente</button>`;}
}
