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
let selectedArchetypes=new Set(),othersMode=false,otherIds=[],groups=[],seriesStyleIndex=new Map(),weeklyData=[],weeklySelected='',weeklyFocus='',bestGeneration=0;
const date=pretty;const ModernFilters={today};
const trendDeck=d=>({...d,classification:{id:d.archetype,name:d.archetype},event:{...d.event,event_id:d.event.id,starttime_original:d.event.date}});
let catalog,entries=[],filtered=[],page=0,generation=0,detailGeneration=0,frequencyGeneration=0;
function range(){const start=$('start').value,end=$('end').value;if(!start||!end||start>end)throw Error('Informe um intervalo válido.');return {start,end};}
function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function period(){if(!catalog)return;const value=$('period').value;
 if(value!=='custom'){const last=value==='all'?catalog.events.map(e=>e.date).sort().at(-1):today();$('end').value=last;const d=new Date(last+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-Number(value)+1);$('start').value=value==='all'?catalog.events.map(e=>e.date).sort()[0]:d.toISOString().slice(0,10);}
 $('start').disabled=$('end').disabled=value!=='custom';$('start-label').hidden=$('end-label').hidden=value!=='custom';}
function inPlacement(d){const n=Number($('placement').value);if(!n)return true;const m=/^(\d+)(?:-(\d+))?$/.exec(d.rankLabel);return !!m&&Number(m[2]||m[1])<=n;}
function scopeEvents(){const r=range();return catalog.events.filter(e=>e.date>=r.start&&e.date<=r.end&&($('modality').value==='both'||e.modality===$('modality').value)&&($('partial').checked||e.complete));}
async function refresh(){
 hideWeeklyTooltip();const token=++generation;++frequencyGeneration;++detailGeneration;++bestGeneration;$('best-list').textContent='';if($('deck').open)$('deck').close();$('frequency').textContent='';$('frequency-status').textContent='';
 $('content').hidden=true;$('retry').hidden=true;$('coverage').textContent='';entries=[];filtered=[];
 try{const events=scopeEvents(),r=range();$('status').textContent='Carregando resumos do período…';
  const enabled=$('period').value!=='custom';
  const days=Math.round((new Date(r.end+'T12:00:00Z')-new Date(r.start+'T12:00:00Z'))/86400000)+1;
  const previousStart=ModernTrends.addDays(r.start,-days);
  const historyEvents=enabled?catalog.events.filter(e=>e.date>=previousStart&&e.date<r.start&&($('modality').value==='both'||e.modality===$('modality').value)&&($('partial').checked||e.complete)):[];
  const allEvents=[...events,...historyEvents],months=[...new Set(allEvents.map(e=>e.date.slice(0,7)))];
  const chunks=await Promise.all(months.map(m=>read(catalog.months[m])));if(token!==generation)return;
  const byId=new Map(allEvents.map(e=>[e.id,e]));
  const history=chunks.flat().filter(group=>byId.has(group.eventId)).flatMap(group=>group.entries.map(d=>({...d,event:byId.get(group.eventId)}))).filter(inPlacement);
  const eventIds=new Set(events.map(e=>e.id));entries=history.filter(d=>eventIds.has(d.event.id));
  const trend=ModernTrends.movement(history.map(trendDeck),today(),r);
  groups=[...new Set(history.map(d=>d.archetype))].sort().map(name=>[name,name]);
  seriesStyleIndex=new Map(groups.map(([id],i)=>[id,i]));
  $('trend-note').textContent=!enabled?'Setas desativadas no intervalo personalizado.':`Selecionado: ${pretty(r.start)}–${pretty(r.end)}; anterior: ${pretty(trend.previousStart)}–${pretty(trend.previousEnd)}. Base anterior → atual: ${trend.previous.events} eventos/${trend.previous.total} listas → ${trend.current.events} eventos/${trend.current.total} listas.${trend.sufficient?'':' Comparação indisponível: base insuficiente.'}`;
  const arrow=id=>{if(!enabled)return '';const t=trend.changes.get(id);if(!t)return '';if(t.kind==='new'||t.kind==='absent')return `<small class="trend-tag">${t.kind==='new'?'Novo no recorte':'Ausente no recorte'}</small>`;const label=`${t.kind==='up'?'Subiu':'Desceu'} ${Math.abs(t.delta)} posições: ${t.before}º → ${t.after}º`;return `<span class="trend-arrow ${t.kind}" role="img" aria-label="${esc(label)}" title="${esc(label)}">${(t.kind==='up'?'↑':'↓').repeat(t.large?2:1)}</span>`;};
  const partial=events.filter(e=>!e.complete).length;
  $('coverage').textContent=`${pretty(r.start)} a ${pretty(r.end)} · ${events.length} eventos · ${entries.length} listas. ${partial?`${partial} evento(s) com amostra parcial incluída: percentuais restritos às listas recuperadas.`:'Seleções publicadas integralmente recuperadas; não representam todos os inscritos.'}`;
  $('denominator').textContent=`Percentuais entre ${entries.length} listas ${$('modality').value==='both'?'online e presenciais; cada lista tem o mesmo peso, com nomenclatura padronizada pelas regras do projeto':$('modality').value==='Presencial'?'presenciais publicadas pelo MTGTop8 (classificação automática do projeto)':'de Challenges MTGO'}, não entre todos os inscritos. Barras de 0 a 100%.`;
  const counts=new Map();for(const d of entries)counts.set(d.archetype,(counts.get(d.archetype)||0)+1);
  const sorted=[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));const threshold=sorted[31]?.[1]||0;
  const visible=sorted.filter(x=>x[1]>=threshold);otherIds=sorted.filter(x=>x[1]<threshold).map(x=>x[0]);
  if(othersMode)selectedArchetypes=new Set(otherIds);
  const other=sorted.filter(x=>x[1]<threshold).reduce((n,x)=>n+x[1],0);
  const bars=[...visible,...(other?[['__others__',other]]:[])];
  $('chart').innerHTML=bars.map(([name,n])=>`<button class="bar-row${name!=='__others__'&&n===sorted[0]?.[1]?' leading':''}" data-name="${esc(name)}" aria-pressed="${name==='__others__'?othersMode:selectedArchetypes.has(name)}"><span class="bar-label"><span>${name==='__others__'?'Outros':esc(name)} ${name==='__others__'?'':arrow(name)}</span><span>${n} · ${pct(n,entries.length)}</span></span><span class="track"><span class="fill" style="width:${100*n/entries.length}%"></span></span></button>`).join('');
  renderPicker(counts);renderWeekly(entries.map(trendDeck),r);
  $('status').textContent=entries.length?'Resumos carregados. Cartas disponíveis ao abrir as listas.':'Nenhuma lista neste recorte. Isso não significa que não houve torneios.';
  $('content').hidden=false;consult();
 }catch(error){if(token!==generation)return;$('status').textContent=`Não foi possível carregar o recorte: ${error.message}. Nenhum total parcial foi calculado.`;$('retry').hidden=false;}
}
function consult(){++frequencyGeneration;$('frequency').textContent='';$('frequency-status').textContent='';const q=$('query').value.trim().toLocaleLowerCase();
 filtered=entries.filter(d=>(!(selectedArchetypes.size||othersMode)||selectedArchetypes.has(d.archetype))&&(!q||[d.player,d.archetype].join(' ').toLocaleLowerCase().includes(q)));
 filtered.sort((a,b)=>b.event.date.localeCompare(a.event.date)||Number(a.rankLabel.split('-')[0])-Number(b.rankLabel.split('-')[0])||a.id.localeCompare(b.id));page=0;renderRows();renderBest();}
function renderRows(){const size=24;$('list-count').textContent=`${filtered.length} de ${entries.length} listas na consulta.`;
 $('results').className='table-scroll';
 $('results').innerHTML=filtered.length?`<table class="deck-table"><thead><tr><th>Data</th><th>Colocação</th><th>Arquétipo</th><th>Jogador</th><th>Torneio</th><th>Decklist</th></tr></thead><tbody>${filtered.slice(page*size,(page+1)*size).map(d=>`<tr class="deck-row"><td>${pretty(d.event.date)}</td><td class="placement">${esc(d.rankLabel)}</td><td><strong>${esc(d.archetype)}</strong><small class="badge">${esc(d.review)}</small></td><td>${esc(d.player)}</td><td>${esc(d.event.name)}${d.event.complete?'':' · AMOSTRA PARCIAL'}</td><td><button class="deck-link" data-deck="${esc(d.id)}">Ver lista ↗</button></td></tr>`).join('')}</tbody></table>`:'<p class="empty">Nenhuma lista neste filtro.</p>';
 $('prev').disabled=page===0;$('next').disabled=(page+1)*size>=filtered.length;$('page').textContent=filtered.length?`${page*size+1}–${Math.min((page+1)*size,filtered.length)} de ${filtered.length}`:'0 listas';}
function zone(cards,title){return `<div><h3>${title} (${cards.reduce((n,c)=>n+c.quantity,0)})</h3>${cards.map(c=>`<div class="card"><span>${esc(c.name_original)}</span><b>${c.quantity}</b></div>`).join('')}</div>`;}
async function openDeck(id){const d=entries.find(d=>d.id===id);if(!d)return;const token=++detailGeneration;
 $('detail').innerHTML='<p role="status">Carregando lista…</p>';if(!$('deck').open)$('deck').showModal();
 try{const payload=await read(d.event.detail);if(token!==detailGeneration||!$('deck').open)return;const zones=payload[id];if(!zones)throw Error('Lista ausente no arquivo do evento');
 $('detail').innerHTML=`<h2>${esc(d.archetype)}</h2><p>${esc(d.player)} · ${esc(d.rankLabel)} · ${pretty(d.event.date)}</p><p>${esc(d.event.rule)}${d.event.complete?'':' · amostra parcial'}</p><p>${esc(d.review)}</p><p>Nome original da fonte: ${esc(d.original??'não informado')}</p><a href="${esc(d.source)}" target="_blank" rel="noreferrer">Fonte da lista ↗</a>${d.resultSource?` · <a href="${esc(d.resultSource)}" target="_blank" rel="noreferrer">Fonte da campanha ↗</a>`:''}<div class="zones">${zone(zones.main,'Main deck')}${zone(zones.sideboard,'Sideboard')}</div>`;
 }catch(e){if(token===detailGeneration)$('detail').innerHTML=`<p role="alert">${esc(e.message)}. Feche e abra a lista para tentar novamente.</p>`;}}
async function frequency(){const token=++frequencyGeneration,selected=[...filtered];$('frequency').textContent='';$('frequency-status').textContent='Carregando cartas de todas as listas filtradas…';
 try{const ids=new Set(selected.map(d=>d.event.id));const sources=[...new Map(selected.map(d=>[d.event.id,d.event])).values()];
  const counts={main:new Map(),sideboard:new Map()};let cursor=0;
  // Quatro trabalhadores: não enfileira nem mantém todos os arquivos de cartas ao mesmo tempo.
  await Promise.all(Array.from({length:Math.min(4,sources.length)},async()=>{while(cursor<sources.length){if(token!==frequencyGeneration)return;const event=sources[cursor++];const payload=await read(event.detail);if(token!==frequencyGeneration)return;
   for(const d of selected.filter(d=>d.event.id===event.id)){const zones=payload[d.id];if(!zones)throw Error('Lista ausente');for(const z of ['main','sideboard']){const cards=new Map();for(const c of zones[z])cards.set(c.name_original,(cards.get(c.name_original)||0)+c.quantity);for(const [name,q] of cards){const v=counts[z].get(name)||{n:0,q:0};v.n++;v.q+=q;counts[z].set(name,v);}}}
  }}));if(token!==frequencyGeneration)return;
  $('frequency-status').textContent=`${selected.length} listas verificadas em ${ids.size} eventos. Média de cópias entre listas que usam a carta; presença entre todas as listas filtradas.`;
  $('frequency').innerHTML='<div class="zones">'+['main','sideboard'].map(z=>`<div><h3>${z==='main'?'Main deck':'Sideboard'}</h3>${[...counts[z]].sort((a,b)=>b[1].n-a[1].n||a[0].localeCompare(b[0])).map(([name,v])=>`<div class="card"><span>${esc(name)}</span><b>${(v.q/v.n).toLocaleString('pt-BR',{maximumFractionDigits:1})} · ${pct(v.n,selected.length)}</b></div>`).join('')}</div>`).join('')+'</div>';
 }catch(e){if(token===frequencyGeneration){$('frequency').textContent='';$('frequency-status').textContent=`Falha: ${e.message}. Frequência não calculada; tente novamente.`;}}}
async function init(){try{catalog=await read({path:document.body.dataset.catalog,sha256:document.body.dataset.hash});period();
 $('events').innerHTML=catalog.events.map(e=>`<article><strong>${esc(e.name)} · ${pretty(e.date)}</strong><p>${e.modality==='MTGO'?'Online':'Presencial'} · ${esc(e.rule)} · ${e.count} listas recuperadas · ${e.complete?'seleção publicada completa':'PARCIAL; seleção publicada ainda incompleta'} · participantes: ${e.participants??'desconhecido'}</p><a href="${esc(e.source)}" target="_blank" rel="noreferrer">Fonte ↗</a></article>`).join('');await refresh();
 }catch(e){$('status').textContent=`Falha no catálogo: ${e.message}`;$('retry').hidden=false;}}
$('retry').onclick=()=>catalog?refresh():init();$('modality').onchange=refresh;$('period').onchange=()=>{period();refresh();};
for(const id of ['start','end','placement','partial'])$(id).onchange=refresh;
$('query').oninput=consult;$('frequency-button').onclick=frequency;
$('prev').onclick=()=>{page--;renderRows();};$('next').onclick=()=>{page++;renderRows();};
$('results').onclick=e=>{const b=e.target.closest('[data-deck]');if(b)openDeck(b.dataset.deck);};
function updateSelection(){const counts=new Map();for(const d of entries)counts.set(d.archetype,(counts.get(d.archetype)||0)+1);renderPicker(counts);for(const b of $('chart').querySelectorAll('[data-name]'))b.setAttribute('aria-pressed',String(b.dataset.name==='__others__'?othersMode:selectedArchetypes.has(b.dataset.name)));consult();}
$('chart').onclick=e=>{const b=e.target.closest('[data-name]');if(b){if(b.dataset.name==='__others__'){othersMode=true;selectedArchetypes=new Set(otherIds);}else{const clear=!othersMode&&selectedArchetypes.size===1&&selectedArchetypes.has(b.dataset.name);othersMode=false;selectedArchetypes=clear?new Set():new Set([b.dataset.name]);}updateSelection();$('listas').scrollIntoView();}};
$('arquetipo-options').onchange=e=>{const id=e.target.dataset.pick;if(id){othersMode=false;if(e.target.checked)selectedArchetypes.add(id);else selectedArchetypes.delete(id);updateSelection();}};
$('arquetipo-options').onclick=e=>{const b=e.target.closest('[data-only]');if(b){othersMode=false;selectedArchetypes=new Set([b.dataset.only]);updateSelection();$('arquetipo').open=false;}};
$('arquetipo-all').onclick=()=>{othersMode=false;selectedArchetypes.clear();updateSelection();};
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
function drawWeekly(){
 hideWeeklyTooltip();
 const week=weeklyData.find(w=>w.start===weeklySelected);
 if(!week){$('weekly-chart').innerHTML='<p class="empty">Sem listas disponíveis para a evolução semanal neste recorte.</p>';for(const id of ['weekly-context','weekly-changes','weekly-legend','weekly-table'])$(id).textContent='';return;}
 const ids=week.top,names=new Map(groups),index=weeklyData.indexOf(week),previous=weeklyData[index-1];
 if(!ids.includes(weeklyFocus))weeklyFocus='';
 $('weekly-context').textContent=`Semana de ${date(week.start)} a ${date(week.end)}${week.partial?' · parcial':''}: ${week.total} listas de ${week.events} eventos. Cada ponto divide as ocorrências do arquétipo pelas listas daquela semana. A distribuição acima usa todas as listas do período selecionado. Mesmos filtros de modalidade e colocação. Busca e arquétipo não alteram o gráfico. ${ids.length>8?`${ids.length} arquétipos exibidos por empate no corte.`:''}`;
 const entered=previous?.total?ids.filter(id=>!previous.top.includes(id)):[],left=previous?.total?previous.top.filter(id=>!ids.includes(id)):[];
 $('weekly-changes').textContent=previous?.total?`Entraram no Top 8 desde a semana anterior: ${entered.map(id=>names.get(id)).join(', ')||'nenhum'}. Saíram: ${left.map(id=>names.get(id)).join(', ')||'nenhum'}. Selecione a semana anterior para acompanhar quem saiu.`:'Sem semana anterior com dados no recorte para comparar entradas e saídas.';
 const colors=['#bd93f9','#50fa7b','#8be9fd','#ffb86c','#ff79c6','#f1fa8c','#f8f8f2','#ff5555'];
 const width=Math.max(680,weeklyData.length*65),height=340,leftPad=48,rightPad=20,top=20,bottom=55;
 const max=Math.max(5,...weeklyData.flatMap(w=>w.total?w.sorted.map(([,n])=>100*n/w.total):[]));
 const tick=max<=25?5:max<=50?10:20,ceiling=Math.ceil(max/tick)*tick,x=i=>leftPad+(width-leftPad-rightPad)*(weeklyData.length===1?.5:i/(weeklyData.length-1)),y=v=>height-bottom-(height-top-bottom)*v/ceiling;
 let svg=`<svg style="min-width:${width}px" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="group" aria-label="Participação semanal dos líderes da semana selecionada"><title>Participação semanal entre listas publicadas</title><desc>Percentuais e cobertura exatos na tabela abaixo. Pontos cheios indicam posição até 8; vazios, fora do Top 8. Lacunas representam semanas sem listas.</desc>`;
 for(let value=0;value<=ceiling;value+=tick){svg+=`<line x1="${leftPad}" y1="${y(value)}" x2="${width-rightPad}" y2="${y(value)}" stroke="var(--line)"/><text x="${leftPad-8}" y="${y(value)+4}" text-anchor="end">${value.toLocaleString('pt-BR',{maximumFractionDigits:1})}%</text>`;}
 svg+=`<rect x="${Math.max(leftPad,x(index)-18)}" y="${top}" width="${Math.min(36,width-rightPad-Math.max(leftPad,x(index)-18))}" height="${height-top-bottom}" fill="var(--accent)" opacity=".12"/>`;
 weeklyData.forEach((w,i)=>{svg+=`<text x="${x(i)}" y="${height-27}" text-anchor="middle">${date(w.start).slice(0,5)}${w.partial?'*':''}</text>`;});
 ids.forEach((id,j)=>{
  const style=seriesStyleIndex.get(id)||0,color=colors[style%colors.length],dash=['','7 3','2 3','9 3 2 3','12 4','4 2 1 2','10 2 4 2','1 3','8 2 1 2 1 2','3 5'][Math.floor(style/colors.length)%10],opacity=weeklyFocus&&weeklyFocus!==id?.16:1;let path='',connected=false;
  weeklyData.forEach((w,i)=>{if(!w.total){connected=false;return;}const value=100*(w.counts.get(id)||0)/w.total;path+=`${connected?'L':'M'}${x(i)},${y(value)} `;connected=true;});
  svg+=`<g opacity="${opacity}"><path d="${path}" fill="none" stroke="${color}" stroke-width="${weeklyFocus===id?3.5:2}" stroke-dasharray="${dash}"/>`;
  weeklyData.forEach((w,i)=>{if(!w.total)return;const n=w.counts.get(id)||0,value=100*n/w.total;const label=`${names.get(id)} · Semana de ${date(w.start)} a ${date(w.end)}${w.partial?' (parcial)':''} · Participação nesta semana: ${pct(n,w.total)} (${n} de ${w.total} listas); no período selecionado: ${pct(entries.filter(d=>d.archetype===id).length,entries.length)} (${entries.filter(d=>d.archetype===id).length} de ${entries.length} listas)`;svg+=`<g class="weekly-point" tabindex="0" role="button" aria-label="${esc(label)}" data-tooltip="${esc(label)}"><circle cx="${x(i)}" cy="${y(value)}" r="11" fill="transparent"/><circle class="point-dot" cx="${x(i)}" cy="${y(value)}" r="${weeklyFocus===id?4.5:3.5}" stroke="${color}" stroke-width="1.5" fill="${w.top.includes(id)?color:'var(--bg)'}"/></g>`;});svg+='</g>';
 });
 $('weekly-chart').innerHTML=svg+'</svg>';
 $('weekly-legend').innerHTML=ids.map(id=>{const style=seriesStyleIndex.get(id)||0,color=colors[style%colors.length],dash=['','7 3','2 3','9 3 2 3','12 4','4 2 1 2','10 2 4 2','1 3','8 2 1 2 1 2','3 5'][Math.floor(style/colors.length)%10];return `<button class="legend-button" data-series="${esc(id)}" aria-pressed="${weeklyFocus===id}"><svg width="26" height="12" aria-hidden="true"><line x1="0" y1="6" x2="26" y2="6" stroke="${color}" stroke-width="2" stroke-dasharray="${dash}"/></svg> ${esc(names.get(id))}</button>`;}).join('');
 $('weekly-table').innerHTML=`<table class="weekly-values"><thead><tr><th scope="col">Semana (seg.–dom.)</th><th scope="col">Base</th>${ids.map(id=>`<th scope="col">${esc(names.get(id))}</th>`).join('')}</tr></thead><tbody>${weeklyData.map(w=>`<tr><th scope="row">${date(w.start)}–${date(w.end)}${w.partial?' · parcial':''}</th><td>${w.events} eventos / ${w.total} listas</td>${ids.map(id=>`<td>${w.total?`${pct(w.counts.get(id)||0,w.total)} · ${w.counts.get(id)||0}/${w.total}${w.top.includes(id)?' · Top 8':''}`:'Sem dados'}</td>`).join('')}</tr>`).join('')}</tbody></table><p class="muted">* Semana parcial por limite do período, início da base ou semana em andamento. Semanas completas no calendário não garantem coleta de todos os eventos.</p>`;
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
$('trend-week').addEventListener('change',()=>{weeklySelected=$('trend-week').value;weeklyFocus='';drawWeekly();});
$('weekly-legend').addEventListener('click',e=>{const b=e.target.closest('[data-series]');if(b){weeklyFocus=weeklyFocus===b.dataset.series?'':b.dataset.series;drawWeekly();$('weekly-legend').querySelector(`[data-series="${CSS.escape(b.dataset.series)}"]`)?.focus();}});

async function renderBest(){
 const token=++bestGeneration;
 if(!selectedArchetypes.size&&!othersMode){$('best-list').innerHTML='<p class="muted">Selecione um arquétipo para ver sua lista de melhor colocação; entre empates, a mais recente.</p>';return;}
 const order=d=>Number(d.rankLabel.split('-').at(-1))||Infinity;
 const best=[...filtered].sort((a,b)=>order(a)-order(b)||b.event.date.localeCompare(a.event.date)||a.id.localeCompare(b.id))[0];
 if(!best){$('best-list').innerHTML='<p class="empty">Nenhuma lista neste filtro para destacar.</p>';return;}
 $('best-list').innerHTML='<p role="status">Carregando a lista de melhor colocação…</p>';
 try{const payload=await read(best.event.detail);if(token!==bestGeneration)return;const zones=payload[best.id];if(!zones)throw Error('Lista ausente');
 $('best-list').innerHTML=`<div class="insight-panel" data-best-id="${esc(best.id)}"><div class="eyebrow">Melhor resultado nas listas filtradas</div><h3>${esc(best.rankLabel)} · ${esc(best.archetype)}</h3><p>${esc(best.player)} · ${esc(best.event.name)} · ${pretty(best.event.date)}</p><p>${esc(best.review)}</p><p class="muted">Melhor colocação publicada; entre empates, a mais recente. Faixas são preservadas e comparadas pelo limite superior, sem inventar posições individuais.</p><button data-best-deck="${esc(best.id)}">Abrir detalhes e fonte ↗</button><div class="zones">${zone(zones.main,'Main deck')}${zone(zones.sideboard,'Sideboard')}</div></div>`;
 }catch(error){if(token===bestGeneration)$('best-list').innerHTML=`<p role="alert">${esc(error.message)}</p><button data-retry-best>Tentar novamente</button>`;}
}
