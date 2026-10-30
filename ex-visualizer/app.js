// EX Visualizer — Truly Free Video Editor (no watermark, 100% local)
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2,9);
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const fmt = t => { t=Math.max(0,t||0); const m=Math.floor(t/60), s=t%60; return `${String(m).padStart(2,'0')}:${s.toFixed(1).padStart(4,'0')}`; };

const canvas = $('#preview'), ctx = canvas.getContext('2d');
let clips = [];            // {id,track,type,name,url,duration,start,trimStart,volume,speed,bright,contrast,sat,text,fontSize,color,x,y,el}
let selectedId = null;
let currentTime = 0, isPlaying = false, zoom = 26, masterVol = 1;
let exporting = false, mediaLibItems = [], userSetRatio = false;
let audioCtx = null, audioDest = null, connectedEls = new Set();
let recorder = null, recChunks = [];
/* projects (home page) */
const LS_PROJECTS='freecut_projects_v1';
let projectsStore=[]; try{ projectsStore=JSON.parse(localStorage.getItem(LS_PROJECTS)||'[]'); if(!Array.isArray(projectsStore)) projectsStore=[]; }catch(e){ projectsStore=[]; }
let currentProjectId=null, autosaveTimer=null, currentExportCount=0;

const totalDuration = () => clips.reduce((m,c)=>Math.max(m,(c.start||0)+(c.duration||0)),0);
const selected = () => clips.find(c=>c.id===selectedId) || null;
const trackForType = t => t==='text'?1 : t==='audio'?2 : 0;

function toast(msg, ms=3200){
  const el=$('#toast'); el.textContent=msg; el.classList.remove('hidden');
  clearTimeout(el._t); el._t=setTimeout(()=>el.classList.add('hidden'),ms);
}

/* ---------- media elements ---------- */
function createMediaEl(clip){
  const holder = $('#hiddenMedia');
  if(clip.type==='video'){ const v=document.createElement('video'); v.src=clip.url; v.preload='auto'; v.playsInline=true; v.crossOrigin='anonymous'; holder.appendChild(v); return v; }
  if(clip.type==='audio'){ const a=document.createElement('audio'); a.src=clip.url; a.preload='auto'; holder.appendChild(a); return a; }
  if(clip.type==='image'){ const img=new Image(); img.src=clip.url; return img; }
  return null;
}
function baseClip(p){ return Object.assign({id:uid(),track:0,type:'video',name:'Clip',url:'',duration:3,start:0,trimStart:0,volume:1,speed:1,bright:1,contrast:1,sat:1,fit:'contain',text:'Your text',fontSize:64,color:'#ffffff',x:50,y:82,el:null},p); }

function sourceSize(clip){
  const el=clip.el; if(!el) return null;
  const w=el.videoWidth||el.naturalWidth||0, h=el.videoHeight||el.naturalHeight||0;
  return (w&&h)?{w,h}:null;
}
function matchCanvasToClip(clip, silent=false){
  const s=sourceSize(clip); if(!s){ if(!silent) toast('Still loading that clip — try Match again in a second'); return false; }
  // Even dimensions keep WebM/MP4 encoders & players happy (odd sizes can be rescaled by players)
  canvas.width=Math.max(2,Math.floor(s.w/2)*2); canvas.height=Math.max(2,Math.floor(s.h/2)*2);
  canvas.style.width=(canvas.height>canvas.width)?'330px':'100%';
  renderTimeline();
  if(!silent) toast(`📐 Canvas matched to clip: ${canvas.width}×${canvas.height} — export will keep this exact shape`);
  return true;
}
function maybeAutoMatch(clip){
  // First visual clip wins: make the canvas exactly its shape so nothing is cropped/stretched.
  // Skipped if the user deliberately picked an aspect ratio (e.g. 9:16 for TikTok).
  if(userSetRatio) return;
  if(!['video','image'].includes(clip.type)) return;
  if(clips.some(c=>c.track===0 && c.id!==clip.id)) return;
  const el=clip.el; if(!el) return;
  if(sourceSize(clip)) matchCanvasToClip(clip,true);
  else el.addEventListener(clip.type==='video'?'loadedmetadata':'load',()=>matchCanvasToClip(clip,true),{once:true});
}
function addClipToTimeline(clip, append=true){
  if(append){ const end = clips.filter(c=>c.track===clip.track).reduce((m,c)=>Math.max(m,c.start+c.duration),0); clip.start = end; }
  clip.el = createMediaEl(clip);
  clips.push(clip); selectedId = clip.id;
  maybeAutoMatch(clip);
  renderAll(); return clip;
}

async function handleFiles(files){
  for(const file of files){
    const url = URL.createObjectURL(file);
    const type = file.type.startsWith('video/')?'video':file.type.startsWith('image/')?'image':file.type.startsWith('audio/')?'audio':null;
    if(!type){ continue; }
    let dur = type==='image'?4:5;
    // probe duration
    if(type!=='image'){
      dur = await new Promise(res=>{ const probe=document.createElement(type); probe.preload='metadata'; probe.onloadedmetadata=()=>res(probe.duration||5); probe.onerror=()=>res(5); probe.src=url; });
    }
    const item={id:uid(),type,name:file.name,url,dur};
    mediaLibItems.push(item); renderLib();
    addClipToTimeline(baseClip({type,name:file.name,url,duration:dur,track:trackForType(type)}));
  }
  if(files.length) toast(`✅ Imported ${files.length} file(s) — added to timeline`);
  updateEmpty();
}
function renderLib(){
  $('#mediaCount').textContent = `${mediaLibItems.length} file${mediaLibItems.length===1?'':'s'}`;
  $('#mediaLib').innerHTML = mediaLibItems.map(it=>`
    <div class="media-item" data-id="${it.id}" title="Click to add again">
      <div class="media-thumb">${it.type==='video'?'🎬':it.type==='image'?'🖼️':'🎵'}</div>
      <b>${escapeHtml(it.name)}</b><span>${it.type} • ${it.dur.toFixed(1)}s</span>
    </div>`).join('');
  $$('.media-item').forEach(el=>el.onclick=()=>{ const it=mediaLibItems.find(x=>x.id===el.dataset.id); if(it) addClipToTimeline(baseClip({type:it.type,name:it.name,url:it.url,duration:it.dur,track:trackForType(it.type)})); });
}
const escapeHtml = s=>String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

/* ---------- projects: home, autosave, list ---------- */
function persistProjects(){ try{ localStorage.setItem(LS_PROJECTS,JSON.stringify(projectsStore)); }catch(e){ console.warn('Project autosave skipped (storage full)',e); } }
function currentProjectName(){ return ($('#projectNameInput').value||'Untitled Project').trim()||'Untitled Project'; }
function serializeClips(){ return clips.map(({el,...rest})=>rest); }
function upsertCurrentProject(){
  if(!currentProjectId) return;
  const now=Date.now();
  const entry={id:currentProjectId,name:currentProjectName(),createdAt:(projectsStore.find(p=>p.id===currentProjectId)||{}).createdAt||now,updatedAt:now,canvas:[canvas.width,canvas.height],duration:totalDuration(),clipCount:clips.length,exportCount:currentExportCount,firstType:(clips.find(c=>c.track===0)||{}).type||'',firstName:(clips.find(c=>c.track===0)||{}).name||'',clips:serializeClips()};
  const i=projectsStore.findIndex(p=>p.id===currentProjectId);
  if(i>=0) projectsStore[i]=entry; else projectsStore.unshift(entry);
  projectsStore.sort((a,b)=>b.updatedAt-a.updatedAt); persistProjects();
}
function scheduleAutosave(){ clearTimeout(autosaveTimer); autosaveTimer=setTimeout(()=>{ upsertCurrentProject(); },350); }
function ensureProject(name){
  if(currentProjectId) return;
  currentProjectId=uid(); currentExportCount=0;
  $('#projectNameInput').value=name||`Untitled Project`;
  upsertCurrentProject();
}
function clearTimelineMedia(){ pause(); clips.forEach(c=>{ if(c.el instanceof HTMLMediaElement){ try{c.el.pause(); c.el.remove();}catch(e){} } }); clips=[]; selectedId=null; currentTime=0; mediaLibItems=[]; renderLib(); }
function createProject(name){
  upsertCurrentProject();
  clearTimelineMedia(); currentProjectId=uid(); currentExportCount=0;
  $('#projectNameInput').value=name||`Untitled Project ${projectsStore.length+1}`;
  canvas.width=1280; canvas.height=720; canvas.style.width='100%'; userSetRatio=false;
  const rs=$('#ratioSelect'); if(rs) rs.value='16:9';
  upsertCurrentProject(); renderAll();
}
function enterEditor(){ document.body.classList.remove('home-mode'); renderAll(); }
function enterHome(){ pause(); upsertCurrentProject(); renderProjectList(); document.body.classList.add('home-mode'); }
function renderProjectList(){
  const list=$('#projectList'); if(!list) return;
  $('#projectCount').textContent=`${projectsStore.length} project${projectsStore.length===1?'':'s'}`;
  $('#projectEmpty').style.display=projectsStore.length?'none':'block';
  list.innerHTML=projectsStore.map(p=>{
    const when=new Date(p.updatedAt||p.createdAt||Date.now()).toLocaleString([], {dateStyle:'medium',timeStyle:'short'});
    const icon=p.firstType==='image'?'🖼️':p.firstType==='video'?'🎬':'✂️';
    return `<div class="project-card" data-open="${p.id}" title="Open project">
      <div class="project-thumb">${icon}</div>
      <div class="project-meta"><b>${escapeHtml(p.name||'Untitled Project')}</b>
      <p>${p.clipCount||0} clips • ${(p.duration||0).toFixed(1)}s • ${(p.canvas||[1280,720]).join('×')} • ${p.exportCount||0} export${(p.exportCount||0)===1?'':'s'}<br>Edited ${escapeHtml(when)}</p>
      <div class="project-actions"><button data-open="${p.id}">Open</button><button data-rename="${p.id}">✏️ Rename</button><button class="del" data-del="${p.id}" title="Delete project">🗑</button></div></div></div>`;
  }).join('');
  list.querySelectorAll('[data-open]').forEach(el=>el.addEventListener('click',ev=>{ ev.stopPropagation(); openProject(el.dataset.open); }));
  list.querySelectorAll('[data-rename]').forEach(el=>el.addEventListener('click',ev=>{ ev.stopPropagation(); const p=projectsStore.find(x=>x.id===el.dataset.rename); if(!p)return; const n=prompt('Project name:',p.name||''); if(n&&n.trim()){ p.name=n.trim(); p.updatedAt=Date.now(); persistProjects(); if(p.id===currentProjectId) $('#projectNameInput').value=p.name; renderProjectList(); } }));
  list.querySelectorAll('[data-del]').forEach(el=>el.addEventListener('click',ev=>{ ev.stopPropagation(); const p=projectsStore.find(x=>x.id===el.dataset.del); if(p&&confirm(`Delete "${p.name}"? This removes it from this device's project list.`)){ projectsStore=projectsStore.filter(x=>x.id!==p.id); persistProjects(); if(p.id===currentProjectId) currentProjectId=null; renderProjectList(); } }));
}
function openProject(id){
  const p=projectsStore.find(x=>x.id===id); if(!p) return;
  upsertCurrentProject();
  clearTimelineMedia(); currentProjectId=p.id; currentExportCount=p.exportCount||0; $('#projectNameInput').value=p.name||'Untitled Project';
  if(p.canvas){ canvas.width=p.canvas[0]; canvas.height=p.canvas[1]; canvas.style.width=(canvas.height>canvas.width)?'330px':'100%'; }
  let missing=0;
  (p.clips||[]).forEach(raw=>{ const c=baseClip(raw); c.id=raw.id||uid(); if(c.url && !c.url.startsWith('blob:')){ c.el=createMediaEl(c); } else if(c.url){ missing++; } clips.push(c); });
  selectedId=clips[0]?.id||null; currentTime=0;
  enterEditor();
  toast(missing?`Project opened — ${missing} local file(s) need re-importing (browsers can't keep them). Timeline & edits are intact.`:'Project opened ✅');
}
function openChoice(){ $('#choiceModal').classList.remove('hidden'); }
function closeChoice(){ $('#choiceModal').classList.add('hidden'); }

/* ---------- timeline ---------- */
function renderTimeline(){
  const total = Math.max(totalDuration(), 10);
  const width = Math.max(2200, (total+12)*zoom);
  $('#ruler').style.width = width+'px'; $('.tracks').style.width = width+'px';
  // ruler ticks
  let ticks=''; const step = zoom<16?5:1;
  for(let t=0;t<=total+10;t+=step){ ticks += `<div class="tick" style="left:${t*zoom}px">${fmt(t)}</div>`; }
  $('#ruler').innerHTML = ticks;
  // tracks
  [0,1,2].forEach(tr=>{
    const box = $('#track'+tr); box.innerHTML='';
    clips.filter(c=>c.track===tr).sort((a,b)=>a.start-b.start).forEach(c=>{
      const d=document.createElement('div');
      d.className=`clip c-${c.type} ${c.id===selectedId?'selected':''}`;
      d.style.left=(c.start*zoom)+'px'; d.style.width=Math.max(28,c.duration*zoom)+'px';
      d.innerHTML=`<div class="trim left"></div><b>${escapeHtml(c.type==='text'?c.text:c.name)}</b><span>${c.duration.toFixed(1)}s</span><div class="trim right"></div>`;
      d.addEventListener('pointerdown', ev=>startDrag(ev,c,d));
      box.appendChild(d);
    });
  });
  $('#projInfo').textContent = `${clips.length} clips • ${totalDuration().toFixed(1)}s • ${canvas.width}×${canvas.height}`;
  updatePlayhead(); updateEmpty();
}
function updatePlayhead(){
  $('#playhead').style.left = (74 + currentTime*zoom)+'px';
  $('#timeLabel').textContent = `${fmt(currentTime)} / ${fmt(totalDuration())}`;
}
function updateEmpty(){ $('#emptyHint').classList.toggle('hidden', clips.length>0); }

function startDrag(ev, clip, el){
  ev.preventDefault(); selectClip(clip.id);
  const isLeft = ev.target.classList.contains('left'), isRight = ev.target.classList.contains('right');
  const mode = isLeft?'trimL':isRight?'trimR':'move';
  const startX=ev.clientX, o={start:clip.start,duration:clip.duration,trim:clip.trimStart};
  const move = e=>{
    const d=(e.clientX-startX)/zoom;
    if(mode==='move'){ clip.start=clamp(o.start+d,0,600); }
    if(mode==='trimL'){ const nd=clamp(d,-o.trim/Math.max(clip.speed,0.01),o.duration-0.2); clip.start=o.start+nd; clip.duration=o.duration-nd; clip.trimStart=o.trim+nd*(clip.speed||1); }
    if(mode==='trimR'){ clip.duration=clamp(o.duration+d,0.2,3600); }
    renderTimeline(); showProps(false);
  };
  const up=()=>{ window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',up); renderAll(); };
  window.addEventListener('pointermove',move); window.addEventListener('pointerup',up);
}

/* ruler seek */
let seeking=false;
function seekFromEvent(e){ const r=$('#ruler').getBoundingClientRect(); seek(clamp((e.clientX-r.left)/zoom,0,Math.max(totalDuration(),0.01))); }
$('#ruler').addEventListener('pointerdown',e=>{seeking=true;seekFromEvent(e);});
window.addEventListener('pointermove',e=>{ if(seeking) seekFromEvent(e); });
window.addEventListener('pointerup',()=>seeking=false);

function seek(t){ currentTime=clamp(t,0,totalDuration()||0); syncMedia(true); updatePlayhead(); }

/* ---------- selection / properties ---------- */
function selectClip(id){ selectedId=id; renderTimeline(); showProps(true); }
function showProps(fill=true){
  const c=selected();
  $('#propsEmpty').classList.toggle('hidden',!!c);
  $('#propsBody').classList.toggle('hidden',!c);
  $('#selLabel').textContent = c?c.name:'Nothing selected';
  if(!c) return;
  if(fill){
    $('#pName').value=c.name||''; $('#pStart').value=c.start.toFixed(1); $('#pDuration').value=c.duration.toFixed(1);
    $('#pText').value=c.text||''; $('#pFont').value=c.fontSize; $('#pColor').value=c.color||'#ffffff'; $('#pX').value=c.x; $('#pY').value=c.y;
    $('#pTrim').max=Math.max(10,(c.trimStart||0)+10); $('#pTrim').value=c.trimStart||0; $('#pTrimVal').textContent=` ${(c.trimStart||0).toFixed(1)}s`;
    $('#pVolume').value=c.volume; $('#pSpeed').value=c.speed; $('#pBright').value=c.bright; $('#pContrast').value=c.contrast; $('#pSat').value=c.sat;
  } else {
    $('#pStart').value=c.start.toFixed(1); $('#pDuration').value=c.duration.toFixed(1);
    $('#pTrim').value=c.trimStart||0; $('#pTrimVal').textContent=` ${(c.trimStart||0).toFixed(1)}s`;
  }
  if($('#pFit')) $('#pFit').value = c.fit || 'contain';
  $('#textProps').style.display = c.type==='text'?'block':'none';
  $('#avProps').style.display = (c.type==='video'||c.type==='audio')?'block':'none';
  $('#fitProps').style.display = (c.type==='video'||c.type==='image')?'block':'none';
  $('#filterProps').style.display = (c.type==='video'||c.type==='image')?'block':'none';
}
function bindProps(){
  const c=()=>selected(); if(!c()) return;
  $('#pName').oninput=e=>{c().name=e.target.value;};
  $('#pName').onchange=()=>renderTimeline();
  $('#pStart').onchange=e=>{c().start=clamp(parseFloat(e.target.value)||0,0,600); renderAll();};
  $('#pDuration').onchange=e=>{c().duration=clamp(parseFloat(e.target.value)||0.2,0.2,3600); renderAll();};
  $('#pText').oninput=e=>{c().text=e.target.value; c().name=e.target.value.slice(0,24)||'Text';};
  $('#pText').onchange=()=>renderTimeline();
  $('#pFont').oninput=e=>c().fontSize=parseFloat(e.target.value)||48;
  $('#pColor').oninput=e=>c().color=e.target.value;
  $('#pX').oninput=e=>c().x=parseFloat(e.target.value);
  $('#pY').oninput=e=>c().y=parseFloat(e.target.value);
  $('#pTrim').oninput=e=>{c().trimStart=parseFloat(e.target.value)||0; $('#pTrimVal').textContent=` ${c().trimStart.toFixed(1)}s`; syncMedia(true);};
  $('#pVolume').oninput=e=>c().volume=parseFloat(e.target.value);
  $('#pSpeed').oninput=e=>c().speed=parseFloat(e.target.value);
  if($('#pFit')) $('#pFit').onchange=e=>{ c().fit=e.target.value; toast(e.target.value==='contain'?'Fit: whole video visible, no crop':e.target.value==='cover'?'Fill: fills canvas, edges may crop':'Stretch: can distort — only use if you want that'); };
  if($('#matchCanvasBtn')) $('#matchCanvasBtn').onclick=()=>{ if(c()) matchCanvasToClip(c()); };
  $('#pBright').oninput=e=>c().bright=parseFloat(e.target.value);
  $('#pContrast').oninput=e=>c().contrast=parseFloat(e.target.value);
  $('#pSat').oninput=e=>c().sat=parseFloat(e.target.value);
  $$('.chip').forEach(ch=>ch.onclick=()=>{ const cl=c(); if(!cl)return; const p=ch.dataset.preset;
    if(p==='none'){cl.bright=1;cl.contrast=1;cl.sat=1} if(p==='Vivid'){cl.bright=1.08;cl.contrast=1.18;cl.sat=1.65}
    if(p==='mono'){cl.bright=1.02;cl.contrast=1.12;cl.sat=0} if(p==='warm'){cl.bright=1.08;cl.contrast=1.05;cl.sat=1.25}
    if(p==='cool'){cl.bright=.96;cl.contrast=1.08;cl.sat=.82} showProps(true); bindProps(); });
}

/* ---------- playback & drawing ---------- */
function activeAt(track,t){ return clips.filter(c=>c.track===track && t>=c.start && t<c.start+c.duration).sort((a,b)=>b.start-a.start)[0] || null; }
function syncMedia(force=false){
  clips.forEach(c=>{
    if(!c.el || !(c.el instanceof HTMLMediaElement)) return;
    const active = isPlaying && currentTime>=c.start && currentTime<c.start+c.duration;
    c.el.volume = clamp((c.volume??1)*masterVol,0,1); c.el.playbackRate=c.speed||1;
    if(active){
      const expected=(c.trimStart||0)+(currentTime-c.start)*(c.speed||1);
      if(force || Math.abs(c.el.currentTime-expected)>0.35){ try{c.el.currentTime=expected;}catch(e){} }
      if(c.el.paused) c.el.play().catch(()=>{});
    } else if(!c.el.paused) c.el.pause();
  });
}
function drawMedia(el, cw, ch, fit='contain'){
  const sw=el.videoWidth||el.naturalWidth||cw, sh=el.videoHeight||el.naturalHeight||ch;
  if(fit==='stretch'){ ctx.drawImage(el,0,0,cw,ch); return; } // only mode that can distort — user's explicit choice
  // 'contain' = whole source visible (letterbox, NEVER cropped/distorted)
  // 'cover'   = fill canvas (may crop overflow) — old v1 behaviour, now opt-in only
  const scale = fit==='cover' ? Math.max(cw/sw,ch/sh) : Math.min(cw/sw,ch/sh);
  const dw=sw*scale, dh=sh*scale;
  ctx.drawImage(el,(cw-dw)/2,(ch-dh)/2,dw,dh);
}
function wrapText(text,x,y,maxW,lh){
  const words=String(text).split(/\s+/); let line='', lines=[];
  words.forEach(w=>{ const test=line?line+' '+w:w; if(ctx.measureText(test).width>maxW && line){lines.push(line);line=w;} else line=test; });
  if(line) lines.push(line);
  // honour manual newlines roughly
  lines = String(text).split('\n').flatMap(part=>{ if(ctx.measureText(part).width<=maxW) return [part]; return [part]; });
  lines.forEach((l,i)=>ctx.fillText(l,x,y+i*lh));
  return lines.length;
}
function draw(){
  const cw=canvas.width, ch=canvas.height;
  ctx.save(); ctx.filter='none'; ctx.fillStyle='#050508'; ctx.fillRect(0,0,cw,ch);
  const main=activeAt(0,currentTime);
  if(main && main.el){
    ctx.filter=`brightness(${main.bright}) contrast(${main.contrast}) saturate(${main.sat})`;
    try{ if(main.type==='video' && main.el.readyState>=2) drawMedia(main.el,cw,ch,main.fit||'contain'); if(main.type==='image' && main.el.complete) drawMedia(main.el,cw,ch,main.fit||'contain'); }catch(e){}
    ctx.filter='none';
  } else if(clips.length){
    ctx.fillStyle='#14141f'; ctx.fillRect(0,0,cw,ch);
    ctx.fillStyle='#77778c'; ctx.font=`600 ${34*renderScale}px Inter, Arial`; ctx.textAlign='center'; ctx.fillText('— gap —',cw/2,ch/2);
  }
  clips.filter(c=>c.track===1 && currentTime>=c.start && currentTime<c.start+c.duration).forEach(c=>{
    const fs=(c.fontSize||48)*renderScale;
    ctx.save(); ctx.font=`800 ${fs}px Inter, Arial, sans-serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.shadowColor='rgba(0,0,0,.65)'; ctx.shadowBlur=14*renderScale; ctx.shadowOffsetY=3*renderScale;
    ctx.fillStyle=c.color||'#fff'; ctx.lineWidth=Math.max(2,fs/14); ctx.strokeStyle='rgba(0,0,0,.35)';
    const x=cw*(c.x/100), y=ch*(c.y/100);
    String(c.text||'').split('\n').forEach((line,i)=>{ ctx.strokeText(line,x,y+i*fs*1.12); ctx.fillText(line,x,y+i*fs*1.12); });
    ctx.restore();
  });
  ctx.restore();
  if(exporting){ const p=totalDuration()?clamp(currentTime/totalDuration()*100,0,100):0; $('#epFill').style.width=p+'%'; $('#epPct').textContent=p.toFixed(0)+'%'; }
}
/* --- export stall protection ---
   During export the timeline must follow the actual media, not the wall clock.
   If a clip's decoder stalls, we hold the timeline AND pause the recorder —
   so a stall becomes a brief pause in rendering, not a frozen/muted stretch
   burned into the exported file. */
function exportClockItem(){
  const main=activeAt(0,currentTime);
  if(main && main.el instanceof HTMLMediaElement) return main;
  const aud=activeAt(2,currentTime);
  if(aud && aud.el instanceof HTMLMediaElement) return aud;
  return null;
}
function mediaStalled(clip){
  if(!clip || !(clip.el instanceof HTMLMediaElement)) return false;
  return clip.el.seeking || clip.el.readyState<3;
}
function updateRecorderStallState(){
  if(!exporting || !recorder) return;
  try{
    if(mediaStalled(exportClockItem())){ if(recorder.state==='recording') recorder.pause(); }
    else if(recorder.state==='paused'){ recorder.resume(); }
  }catch(e){}
}
function waitForMediaReady(el, timeout=3000){
  if(!(el instanceof HTMLMediaElement) || el.readyState>=3) return Promise.resolve();
  return new Promise(res=>{
    const done=()=>{ cleanup(); res(); };
    const cleanup=()=>{ el.removeEventListener('canplay',done); el.removeEventListener('loadeddata',done); clearTimeout(t); };
    const t=setTimeout(done,timeout);
    el.addEventListener('canplay',done); el.addEventListener('loadeddata',done);
  });
}
async function prepareExportMedia(){
  // Prime every clip's decoder at its trim point before we start recording,
  // so clip starts (and seeks) don't stall mid-export
  for(const c of clips){
    if(c.el instanceof HTMLMediaElement){
      try{ c.el.preload='auto'; if(Math.abs(c.el.currentTime-(c.trimStart||0))>0.05) c.el.currentTime=c.trimStart||0; }catch(e){}
      await waitForMediaReady(c.el, 1800);
    }
  }
  seek(0);
  const first=exportClockItem(); if(first) await waitForMediaReady(first.el, 3000);
}

let lastTs=performance.now();
function loop(ts){
  const dt=Math.min(0.05,(ts-lastTs)/1000); lastTs=ts;
  if(isPlaying){
    if(exporting){
      const item=exportClockItem();
      if(mediaStalled(item)){
        // hold the timeline exactly here until the media can actually play
      } else if(item && !item.el.paused && item.el.readyState>=2){
        // media-driven clock: the playhead is wherever the clip really is
        currentTime=item.start + ((item.el.currentTime-(item.trimStart||0))/(item.speed||1));
        if(currentTime<0) currentTime=0;
      } else {
        currentTime+=dt;
      }
      if(currentTime>=totalDuration() && totalDuration()>0){ currentTime=totalDuration(); pause(); if(exporting) finishExport(); }
      syncMedia(false); updateRecorderStallState();
    } else {
      currentTime+=dt;
      if(currentTime>=totalDuration() && totalDuration()>0){ currentTime=totalDuration(); pause(); }
      syncMedia(false);
    }
  }
  draw(); updatePlayhead();
  requestAnimationFrame(loop);
}
function play(){ if(!clips.length){toast('Add a video or load the demo first 🙂');return;} if(currentTime>=totalDuration()) currentTime=0; isPlaying=true; $('#playBtn').textContent='⏸'; if(audioCtx && audioCtx.state==='suspended') audioCtx.resume(); syncMedia(true); }
function pause(){ isPlaying=false; $('#playBtn').textContent='▶'; clips.forEach(c=>{ if(c.el instanceof HTMLMediaElement) c.el.pause(); }); }

/* ---------- actions ---------- */
function splitAtPlayhead(target){
  const c = target || selected() || clips.find(x=>currentTime>x.start && currentTime<x.start+x.duration);
  if(!c || currentTime<=c.start+0.05 || currentTime>=c.start+c.duration-0.05){ toast('Move the playhead inside a clip, then split ✂'); return; }
  const offset=currentTime-c.start, remaining=c.duration-offset;
  const copy=baseClip({...c,id:uid(),start:currentTime,duration:remaining,trimStart:(c.trimStart||0)+offset*(c.speed||1),el:null});
  delete copy.el; copy.el=createMediaEl(copy);
  c.duration=offset; clips.push(copy); selectedId=copy.id; renderAll(); toast('✂ Clip split');
}
function deleteSelected(){ const c=selected(); if(!c)return; if(c.el instanceof HTMLMediaElement){c.el.pause(); c.el.remove();} clips=clips.filter(x=>x.id!==c.id); selectedId=clips[0]?.id||null; if(currentTime>totalDuration()) currentTime=totalDuration(); renderAll(); }
function duplicateSelected(){ const c=selected(); if(!c)return; const copy=baseClip({...c,id:uid(),start:c.start+c.duration+0.05,el:null}); copy.el=createMediaEl(copy); clips.push(copy); selectedId=copy.id; renderAll(); }
function addText(text='Your text', big=false){
  const c=baseClip({type:'text',track:1,name:text.slice(0,24),text,duration:3,start:currentTime,fontSize:big?92:58,y:big?50:82});
  clips.push(c); selectedId=c.id; renderAll(); toast('Text added — edit it in Properties →');
}
function renderAll(){ renderTimeline(); showProps(true); bindProps(); scheduleAutosave(); }

/* demo project */
function makeDemoImage(title, sub, c1, c2, emoji){
  const cv=document.createElement('canvas'); cv.width=1280; cv.height=720; const g=cv.getContext('2d');
  const grad=g.createLinearGradient(0,0,1280,720); grad.addColorStop(0,c1); grad.addColorStop(1,c2); g.fillStyle=grad; g.fillRect(0,0,1280,720);
  g.globalAlpha=.18; g.fillStyle='#fff'; for(let i=0;i<7;i++){ g.beginPath(); g.arc(120+i*180,120+(i%3)*180,70+(i%4)*22,0,7); g.fill(); } g.globalAlpha=1;
  g.font='120px Arial'; g.textAlign='center'; g.fillText(emoji,640,300);
  g.fillStyle='#fff'; g.font='800 64px Arial'; g.shadowColor='rgba(0,0,0,.4)'; g.shadowBlur=16; g.fillText(title,640,430);
  g.font='400 30px Arial'; g.fillText(sub,640,485);
  return cv.toDataURL('image/jpeg',0.82);
}
function loadDemo(){
  ensureProject('Demo Project');
  pause(); clips.forEach(c=>{if(c.el instanceof HTMLMediaElement)c.el.remove();}); clips=[]; mediaLibItems=[]; renderLib();
  const scenes=[
    ['Welcome to EX Visualizer','Truly free — no watermark','#04150a','#00c853','🎬'],
    ['Edit on the timeline','Drag • Trim • Split • Add text','#f59e0b','#ef4444','✂️'],
    ['Export for free','No paywall. Ever.','#0ea47a','#14532d','🚀'],
  ];
  scenes.forEach((s,i)=>{
    const url=makeDemoImage(...s);
    mediaLibItems.push({id:uid(),type:'image',name:s[0]+'.png',url,dur:3});
    const c=baseClip({type:'image',track:0,name:s[0],url,duration:3,start:i*3}); c.el=createMediaEl(c); clips.push(c);
  });
  const t1=baseClip({type:'text',track:1,name:'My first video!',text:'My first video! 🎉',duration:3,start:0,fontSize:84,y:50}); clips.push(t1);
  const t2=baseClip({type:'text',track:1,name:'Made with EX Visualizer',text:'Made with EX Visualizer — free forever',duration:3,start:6,fontSize:52,y:84}); clips.push(t2);
  selectedId=clips[0].id; currentTime=0; renderLib(); renderAll(); toast('Demo loaded — press ▶ Play, then Export!');
}

/* ---------- export: choose a folder once, export forever ---------- */
let pendingExportDest=null;   // folder chosen in the dialog (not saved yet)
let defaultExportDest=null;   // saved default: {kind:'path',path,name} | {kind:'handle',handle,name} | {kind:'downloads',name}
let lastExportDest=null;      // where the last successful export went
let activeExport=null;        // {dest, filename} for the render in flight

const isDesktopApp = () => !!(window.freecutDesktop && window.freecutDesktop.isDesktop);
const canPickFolder = () => isDesktopApp() || typeof window.showDirectoryPicker==='function';
const slugify = s => (s||'ex-project').toLowerCase().replace(/[^a-z0-9-_ ]+/gi,'').trim().replace(/\s+/g,'-').slice(0,60) || 'ex-project';
const destLabel = d => d ? (d.kind==='path' ? d.path : d.kind==='handle' ? `Folder: ${d.name}` : 'Downloads folder (set by your browser)') : 'No folder chosen yet';

/* tiny IndexedDB store — needed to remember a browser folder handle between sessions */
function idbSet(key,val){ return new Promise(res=>{ const r=indexedDB.open('freecut-settings',1); r.onupgradeneeded=()=>r.result.createObjectStore('kv'); r.onsuccess=()=>{ const tx=r.result.transaction('kv','readwrite'); tx.objectStore('kv').put(val,key); tx.oncomplete=()=>res(true); tx.onerror=()=>res(false); }; r.onerror=()=>res(false); }); }
function idbGet(key){ return new Promise(res=>{ const r=indexedDB.open('freecut-settings',1); r.onupgradeneeded=()=>r.result.createObjectStore('kv'); r.onsuccess=()=>{ const q=r.result.transaction('kv','readonly').objectStore('kv').get(key); q.onsuccess=()=>res(q.result||null); q.onerror=()=>res(null); }; r.onerror=()=>res(null); }); }

async function loadDefaultExportDest(){
  if(defaultExportDest) return defaultExportDest;
  try{
    if(isDesktopApp()){ const p=localStorage.getItem('freecut_default_export_path'); if(p) return (defaultExportDest={kind:'path',path:p,name:p}); }
    const h=await idbGet('defaultExportDir'); if(h && h.name) return (defaultExportDest={kind:'handle',handle:h,name:h.name});
    if(localStorage.getItem('freecut_default_export_downloads')==='1') return (defaultExportDest={kind:'downloads',name:'Downloads'});
  }catch(e){ console.warn(e); }
  return null;
}
async function saveDefaultExportDest(d){
  defaultExportDest=d;
  try{
    if(d.kind==='path'){ localStorage.setItem('freecut_default_export_path',d.path); }
    if(d.kind==='handle'){ await idbSet('defaultExportDir',d.handle); }
    if(d.kind==='downloads'){ localStorage.setItem('freecut_default_export_downloads','1'); }
  }catch(e){ console.warn('Could not save default folder',e); }
}
function nextExportFilename(){
  return `${slugify(currentProjectName())}-export-${(currentExportCount||0)+1}`;
}
/* --- export settings: quality / fps / bitrate / format --- */
const QUALITY_STOPS=[144,240,360,480,720,1080,1440,2160];
const QUALITY_NAMES={144:'144p',240:'240p',360:'360p',480:'480p SD',720:'720p HD',1080:'1080p Full HD',1440:'1440p QHD',2160:'4K Ultra HD'};
let renderScale=1; // >1 / <1 only while rendering an export at a different resolution
const even = n => Math.max(2,Math.round(n/2)*2);
function selectedFormat(){ const el=document.querySelector('input[name="exportFormat"]:checked'); return el?el.value:'webm'; }
function outputDims(targetH){
  const scale=targetH/(canvas.height||720);
  return {w:even((canvas.width||1280)*scale), h:even(targetH)};
}
function readExportSettings(){
  const qIdx=clamp(parseInt($('#qualityRange').value||'4',10),0,QUALITY_STOPS.length-1);
  const targetH=QUALITY_STOPS[qIdx];
  const dims=outputDims(targetH);
  return {qualityIndex:qIdx, quality:targetH, width:dims.w, height:dims.h,
    fps:clamp(parseInt($('#fpsRange').value||'30',10),12,60),
    bitrate:clamp(parseInt($('#bitrateRange').value||'12',10),5,45),
    format:selectedFormat()};
}
function updateExportSettingsUI(){
  const s=readExportSettings();
  // Paint the filled portion to the thumb's EXACT position on each scale,
  // and keep the type-in controls in sync with the sliders
  $('#qualityRange').style.setProperty('--fill',(s.qualityIndex/(QUALITY_STOPS.length-1)*100)+'%');
  $('#fpsRange').style.setProperty('--fill',((s.fps-12)/(60-12)*100)+'%');
  $('#bitrateRange').style.setProperty('--fill',((s.bitrate-5)/(45-5)*100)+'%');
  if(document.activeElement!==$('#qualitySelect')) $('#qualitySelect').value=String(s.qualityIndex);
  if(document.activeElement!==$('#fpsNumber')) $('#fpsNumber').value=s.fps;
  if(document.activeElement!==$('#bitrateNumber')) $('#bitrateNumber').value=s.bitrate;
  $('#qualityVal').textContent=QUALITY_NAMES[s.quality];
  $('#qualityDesc').textContent=`Output: ${s.width}×${s.height} (project shape kept)` + (s.height>canvas.height?' • Upscaling — makes a bigger file, but can’t add detail that isn’t in the source' : s.height<canvas.height?' • Downscaling from your project size' : ' • Same as your project size');
  $('#fpsVal').textContent='fps';
  $('#bitrateVal').textContent='Mbps';
  $('#formatVal').textContent=s.format.toUpperCase();
  $('#exportExt').textContent='.'+s.format;
  const dur=totalDuration();
  $('#sizeEstimate').textContent=dur?`Rough size for this ${dur.toFixed(1)}s project: ~${(dur*(s.bitrate+0.192)/8).toFixed(1)} MB (actual size varies with motion)`:'';
  $('#formatNote').textContent = isDesktopApp()
    ? (s.format==='webm' ? 'Native WebM — recorded directly, no conversion step.' : `Rendered, then converted to real .${s.format} with the converter built into the desktop app (this adds a little time after rendering).`)
    : (s.format==='webm' ? 'Native WebM — recorded directly by your browser.' : s.format==='mp4' ? 'MP4 recording depends on your browser (supported in recent Chrome/Edge). If unsupported, EX Visualizer will tell you before rendering.' : `.${s.format} needs format conversion — available in the EX Visualizer desktop app. In the browser, please use .webm or .mp4.`);
  try{ localStorage.setItem('exvisualizer_export_settings',JSON.stringify({q:s.qualityIndex,fps:s.fps,bitrate:s.bitrate,format:s.format})); }catch(e){}
  return s;
}
function loadExportSettings(){
  try{ const s=JSON.parse(localStorage.getItem('exvisualizer_export_settings')||'null'); if(!s) return;
    if(s.q!=null) $('#qualityRange').value=s.q;
    if(s.fps) $('#fpsRange').value=s.fps;
    if(s.bitrate) $('#bitrateRange').value=s.bitrate;
    if(s.format){ const r=document.querySelector(`input[name="exportFormat"][value="${s.format}"]`); if(r) r.checked=true; }
  }catch(e){}
}
function chosenFilename(){
  const format=selectedFormat();
  const raw=($('#exportFilename').value||'').trim().replace(/[\\/:*?"<>|]+/g,'-').replace(/\.(webm|mp4|mov|mkv|avi)$/i,'');
  return (raw||nextExportFilename())+'.'+format;
}

function updateExportModal(){
  const hasPending=!!pendingExportDest, hasDefault=!!defaultExportDest, picker=canPickFolder();
  $('#chooseFolderBtn').textContent = hasDefault ? '📁 Use a Different Folder…' : '📁 Choose Folder…';
  $('#chooseFolderBtn').style.display = picker ? '' : 'none';
  if(hasPending){
    $('#exportDestLabel').textContent = 'This export will go to: ' + destLabel(pendingExportDest);
    $('#exportDestHint').textContent = '“Export to This Folder” uses it just this once. “Use as Default” remembers it for every future export.';
  } else if(hasDefault){
    $('#exportDestLabel').textContent = '⭐ Your default folder: ' + destLabel(defaultExportDest);
    $('#exportDestHint').textContent = 'Exports go there automatically. Pick a different folder above only if you want to change it for one export.';
  } else if(picker){
    $('#exportDestLabel').textContent = '⚠️ First export: please choose a folder on your PC.';
    $('#exportDestHint').textContent = 'Your video will be saved into that folder — no more hunting through Downloads.';
  } else {
    $('#exportDestLabel').textContent = 'This browser cannot let a website pick folders, so the file will go to your browser’s Downloads folder.';
    $('#exportDestHint').textContent = 'Tip: use the EX Visualizer desktop app (.exe) or Chrome/Edge to choose any folder you like.';
  }
  $('#exportIntro').textContent = hasDefault ? 'Ready to export — you can export this project as many times as you want.' : 'First, tell EX Visualizer where your exported video should end up.';
  $('#exportToDefaultBtn').classList.toggle('hidden',!(hasDefault && !hasPending));
  $('#exportOnceBtn').classList.toggle('hidden',!picker);
  $('#exportSetDefaultBtn').classList.toggle('hidden',!picker);
  $('#exportOnceBtn').disabled=!hasPending; $('#exportSetDefaultBtn').disabled=!hasPending;
  $('#exportDownloadsBtn').classList.toggle('hidden',picker || hasPending || hasDefault);
}
async function openExportModal(){
  if(!clips.length){ toast('Nothing to export — add media first'); return; }
  if(exporting){ toast('An export is already running…'); return; }
  pendingExportDest=null;
  await loadDefaultExportDest();
  $('#exportFilename').value=nextExportFilename();
  updateExportSettingsUI();
  updateExportModal();
  $('#exportModal').classList.remove('hidden');
}
function closeExportModal(){ $('#exportModal').classList.add('hidden'); }

async function chooseExportFolder(){
  try{
    if(isDesktopApp()){
      const p=await window.freecutDesktop.chooseExportFolder();
      if(p) pendingExportDest={kind:'path',path:p,name:p};
    } else if(typeof window.showDirectoryPicker==='function'){
      const h=await window.showDirectoryPicker();
      pendingExportDest={kind:'handle',handle:h,name:h.name};
    }
  }catch(e){ if(e && e.name!=='AbortError') toast('Could not use that folder — please try another'); }
  updateExportModal();
}

let lastExportFullPath=null;
function blobToBase64(blob){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>resolve(String(r.result).split(',')[1]||'');
    r.onerror=()=>reject(new Error('Could not read the rendered video'));
    r.readAsDataURL(blob);
  });
}
/* Returns {where, fullPath} — and only returns at all if the file is verified on disk. */
async function deliverExport(blob, dest, filename){
  if(!blob || !blob.size) throw new Error('The render produced an empty video — please try exporting again');
  if(dest && dest.kind==='path'){
    if(!isDesktopApp() || !window.freecutDesktop.saveExport) throw new Error('Desktop saving is not available in this window — please use the EX Visualizer app');
    const base64=await blobToBase64(blob);
    const result=await window.freecutDesktop.saveExport(dest.path, filename, base64);
    const fullPath = typeof result==='string' ? result : result && result.fullPath;
    const size = typeof result==='object' && result ? result.size : blob.size;
    if(!fullPath) throw new Error('The app did not confirm where the video was saved');
    if(size!==blob.size) throw new Error(`Saved file size mismatch (${size}/${blob.size} bytes)`);
    return {where:fullPath, fullPath};
  }
  if(dest && dest.kind==='handle'){
    let perm='granted';
    try{ perm=await dest.handle.queryPermission({mode:'readwrite'}); if(perm!=='granted') perm=await dest.handle.requestPermission({mode:'readwrite'}); }catch(e){}
    if(perm!=='granted') throw new Error('Permission to that folder was not granted');
    const fh=await dest.handle.getFileHandle(filename,{create:true});
    const w=await fh.createWritable(); await w.write(blob); await w.close();
    const check=await (await dest.handle.getFileHandle(filename)).getFile();
    if(check.size!==blob.size) throw new Error(`Saved file size mismatch (${check.size}/${blob.size} bytes)`);
    return {where:`${dest.name}\\${filename}  (inside the folder you chose)`, fullPath:null};
  }
  // Fallback: normal browser download
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),4000);
  return {where:`Downloads/${filename}  (your browser’s Downloads folder)`, fullPath:null};
}

async function deliverConvertedExport(blob, dest, filename, settings, plan){
  if(!isDesktopApp() || !window.freecutDesktop.convertAndSaveExport) throw new Error(`.${settings.format} conversion is only available in the desktop app`);
  if(!dest || dest.kind!=='path') throw new Error('Please choose a folder on your PC for converted exports');
  toast(`⚙️ Rendering done — converting to .${settings.format}… this can take a while for long videos`,6000);
  const base64=await blobToBase64(blob);
  const masterExt=(plan && plan.blobType==='video/mp4')?'mp4':'webm';
  const result=await window.freecutDesktop.convertAndSaveExport({folder:dest.path, filename, format:settings.format, fps:settings.fps, bitrateMbps:settings.bitrate, base64, masterExt});
  const fullPath=typeof result==='string'?result:result&&result.fullPath;
  const size=typeof result==='object'&&result?result.size:0;
  if(!fullPath || !size) throw new Error('The converter did not produce a file');
  return {where:fullPath, fullPath, size};
}
function recordingPlan(settings){
  if(!window.MediaRecorder) return null;
  if(isDesktopApp()){
    // Master recording must be CHEAP to encode in real time, or the recorder
    // falls behind and you get frozen frames + audio gaps mid-clip (the old
    // VP9 master did exactly that). Prefer H.264 (often hardware-assisted),
    // then lightweight VP8. The desktop converter makes the final format.
    const candidates=[
      ['video/mp4;codecs=avc1.640028,mp4a.40.2','video/mp4'],
      ['video/mp4','video/mp4'],
      ['video/webm;codecs=vp8,opus','video/webm'],
      ['video/webm','video/webm'],
    ];
    for(const [mime,blobType] of candidates){
      if(MediaRecorder.isTypeSupported(mime)) return {mime, blobType, convert:!(settings.format==='webm' && blobType==='video/webm')};
    }
    return null;
  }
  if(settings.format==='webm'){
    // VP8 first: far easier to encode in real time than VP9
    const mime=['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm'].find(m=>MediaRecorder.isTypeSupported(m));
    return mime?{mime, blobType:'video/webm', convert:false}:null;
  }
  if(settings.format==='mp4'){
    const mime=['video/mp4;codecs=avc1.640028,mp4a.40.2','video/mp4'].find(m=>MediaRecorder.isTypeSupported(m));
    return mime?{mime, blobType:'video/mp4', convert:false}:null;
  }
  return null; // mov / mkv / avi in a plain browser
}

function ensureAudioGraph(){
  try{
    if(!audioCtx){ audioCtx=new (window.AudioContext||window.webkitAudioContext)(); audioDest=audioCtx.createMediaStreamDestination(); }
    clips.forEach(c=>{ if(c.el instanceof HTMLMediaElement && !connectedEls.has(c.el)){ const src=audioCtx.createMediaElementSource(c.el); src.connect(audioDest); src.connect(audioCtx.destination); connectedEls.add(c.el); } });
  }catch(e){ console.warn('Audio graph skipped',e); }
}

async function startExport(dest, makeDefault=false){
  if(exporting) return;
  if(!dest){ openExportModal(); return; }
  if(makeDefault) await saveDefaultExportDest(dest);
  if(dest.kind==='handle'){ // ask while we still have the click gesture, not after a long render
    try{ let p=await dest.handle.queryPermission({mode:'readwrite'}); if(p!=='granted') p=await dest.handle.requestPermission({mode:'readwrite'}); if(p!=='granted'){ toast('Please allow access to that folder, or choose another'); openExportModal(); return; } }catch(e){}
  }
  const settings=updateExportSettingsUI();
  const plan=recordingPlan(settings);
  if(!plan){
    toast(settings.format==='mp4' ? '⚠️ This browser cannot record MP4. Use .webm here, or the desktop app for MP4.' : `⚠️ .${settings.format} export needs the EX Visualizer desktop app (it converts the file for real). In the browser, please pick .webm or .mp4.`,6000);
    updateExportModal(); return;
  }
  const filename=chosenFilename();
  const projectDims={w:canvas.width,h:canvas.height};
  activeExport={dest,filename,settings,plan,projectDims};
  closeExportModal(); $('#exportDoneModal').classList.add('hidden');
  toast('⏳ Preparing clips for a clean export…');
  await prepareExportMedia();
  ensureAudioGraph();
  if(audioCtx && audioCtx.state==='suspended'){ try{ await audioCtx.resume(); }catch(e){} }
  // Render at the chosen export resolution, then restore the project canvas afterwards
  renderScale=settings.height/projectDims.h;
  canvas.width=settings.width; canvas.height=settings.height;
  const stream=canvas.captureStream(settings.fps);
  if(audioDest) audioDest.stream.getAudioTracks().forEach(t=>stream.addTrack(t));
  const chunks=[]; // fresh every export — this is what makes repeat exports reliable
  try{ recorder=new MediaRecorder(stream, {mimeType:plan.mime,videoBitsPerSecond:settings.bitrate*1_000_000,audioBitsPerSecond:192_000}); }
  catch(e){ canvas.width=projectDims.w; canvas.height=projectDims.h; renderScale=1; exporting=false; toast('Export not supported in this browser — try Chrome / the desktop app'); return; }
  recorder.ondataavailable=e=>{ if(e.data.size) chunks.push(e.data); };
  recorder.onstop=async ()=>{
    stream.getVideoTracks().forEach(t=>t.stop()); // borrowed audio tracks are left alive for the next export
    const blob=new Blob(chunks,{type:activeExport.plan.blobType});
    $('#exportProgress').classList.add('hidden'); exporting=false; pause(); recorder=null;
    // restore the project canvas exactly as it was before the export render
    canvas.width=activeExport.projectDims.w; canvas.height=activeExport.projectDims.h;
    canvas.style.width=(canvas.height>canvas.width)?'330px':'100%'; renderScale=1; renderTimeline();
    try{
      const delivered=activeExport.plan.convert
        ? await deliverConvertedExport(blob, activeExport.dest, activeExport.filename, activeExport.settings, activeExport.plan)
        : await deliverExport(blob, activeExport.dest, activeExport.filename);
      const outBytes=delivered.size||blob.size;
      currentExportCount=(currentExportCount||0)+1; lastExportDest=activeExport.dest;
      lastExportFullPath=delivered.fullPath||null;
      upsertCurrentProject(); seek(0);
      const mb=(outBytes/1024/1024).toFixed(2);
      const s=activeExport.settings;
      $('#exportDoneText').innerHTML=`<b>${escapeHtml(activeExport.filename)}</b> &nbsp;•&nbsp; ${mb} MB<br>${s.width}×${s.height} • ${s.fps} fps • ${s.bitrate} Mbps • .${s.format}<br>saved to:<br><b>${escapeHtml(delivered.where)}</b><br><br><span class="muted">✔ Verified on disk (${outBytes.toLocaleString()} bytes). That was export #${currentExportCount} of this project.</span>`;
      $('#exportRevealBtn').style.display=(lastExportFullPath && isDesktopApp())?'':'none';
      $('#exportDoneModal').classList.remove('hidden');
    }catch(err){
      console.error(err);
      toast(`⚠️ The video rendered but was NOT saved: ${err.message||err}. No file was created — please choose a folder and try again.`,6500);
      openExportModal();
    }
    activeExport=null;
  };
  exporting=true; $('#exportProgress').classList.remove('hidden'); $('#epFill').style.width='0%';
  const epNote=document.querySelector('.ep-note'); if(epNote) epNote.textContent=`Saving ${filename} (${settings.width}×${settings.height} • ${settings.fps} fps • ${settings.bitrate} Mbps • .${settings.format}) → ${destLabel(dest)} • No watermark, no upload.`;
  seek(0); recorder.start(250); play();
  toast(`🎬 Export #${(currentExportCount||0)+1} rendering… please keep EX Visualizer open until it finishes`,5000);
}
function finishExport(){ if(recorder && recorder.state!=='inactive') recorder.stop(); }

/* ---------- project save / open (media embedded as URLs may need re-import for local files) ---------- */
function saveProject(){
  ensureProject();
  upsertCurrentProject();
  const filename = `${slugify(currentProjectName())}.EXvid`;
  const data={app:'EX Visualizer',format:'EXvid',version:1,name:currentProjectName(),canvas:[canvas.width,canvas.height],exportCount:currentExportCount,clips:serializeClips()};
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})); a.download=filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),4000);
  toast(`💾 Project saved as ${filename} — keep your original media files handy, browsers can't embed them in the project file.`);
}

/* ---------- wiring ---------- */
$('#fileInput').addEventListener('change',e=>{ handleFiles([...e.target.files]); e.target.value=''; });
$('#dropzone').addEventListener('dragover',e=>{e.preventDefault();e.currentTarget.classList.add('drag');});
$('#dropzone').addEventListener('dragleave',e=>e.currentTarget.classList.remove('drag'));
$('#dropzone').addEventListener('drop',e=>{e.preventDefault();e.currentTarget.classList.remove('drag');handleFiles([...e.dataTransfer.files]);});
window.addEventListener('dragover',e=>e.preventDefault()); window.addEventListener('drop',e=>e.preventDefault());
$('#playBtn').onclick=()=>isPlaying?pause():play();
$('#toStartBtn').onclick=()=>seek(0); $('#toEndBtn').onclick=()=>seek(totalDuration());
$('#masterVol').oninput=e=>{masterVol=parseFloat(e.target.value); syncMedia(false);};
$('#addTextBtn').onclick=()=>addText(); $('#tlText').onclick=()=>addText();
$('#addTitleBtn').onclick=()=>addText('BIG TITLE',true);
$('#splitBtn').onclick=()=>splitAtPlayhead(); $('#tlSplit').onclick=()=>splitAtPlayhead();
$('#delBtn').onclick=deleteSelected; $('#tlDelete').onclick=deleteSelected;
$('#dupBtn').onclick=duplicateSelected;
$('#demoBtn').onclick=loadDemo;
$('#exportBtn').onclick=openExportModal;
$('#exportClose').onclick=closeExportModal;
$('#exportModal').addEventListener('click',e=>{ if(e.target.id==='exportModal') closeExportModal(); });
$('#chooseFolderBtn').onclick=chooseExportFolder;
['qualityRange','fpsRange','bitrateRange'].forEach(id=>{ $('#'+id).addEventListener('input',()=>updateExportSettingsUI()); });
$('#qualitySelect').addEventListener('change',e=>{ $('#qualityRange').value=e.target.value; updateExportSettingsUI(); });
$('#fpsNumber').addEventListener('change',e=>{ $('#fpsRange').value=clamp(parseInt(e.target.value||'30',10),12,60); updateExportSettingsUI(); });
$('#bitrateNumber').addEventListener('change',e=>{ $('#bitrateRange').value=clamp(parseInt(e.target.value||'12',10),5,45); updateExportSettingsUI(); });
$$('.fps-presets [data-fps]').forEach(b=>b.addEventListener('click',()=>{ $('#fpsRange').value=b.dataset.fps; updateExportSettingsUI(); }));
$$('input[name="exportFormat"]').forEach(r=>r.addEventListener('change',()=>{ updateExportSettingsUI(); }));
loadExportSettings(); updateExportSettingsUI();
$('#exportOnceBtn').onclick=()=>startExport(pendingExportDest,false);
$('#exportSetDefaultBtn').onclick=()=>startExport(pendingExportDest,true);
$('#exportToDefaultBtn').onclick=()=>startExport(defaultExportDest,false);
$('#exportDownloadsBtn').onclick=()=>startExport({kind:'downloads',name:'Downloads'},false);
$('#exportDoneCloseBtn').onclick=()=>$('#exportDoneModal').classList.add('hidden');
$('#exportRevealBtn').onclick=async ()=>{
  if(lastExportFullPath && window.freecutDesktop && window.freecutDesktop.showExportInFolder){
    const ok=await window.freecutDesktop.showExportInFolder(lastExportFullPath);
    if(!ok) toast('That file could not be found anymore — it may have been moved or deleted');
  }
};
$('#exportChangeFolderBtn').onclick=()=>{ $('#exportDoneModal').classList.add('hidden'); openExportModal(); };
$('#exportAgainBtn').onclick=()=>{
  $('#exportDoneModal').classList.add('hidden');
  $('#exportFilename').value=nextExportFilename();
  if(lastExportDest) startExport(lastExportDest,false); else openExportModal();
};
$('#saveBtn').onclick=saveProject;
/* home / new-project flow */
$('#homeBtn').onclick=enterHome;
$('#brandHome').onclick=enterHome;
$('#newProjectBtn').onclick=openChoice;
$('#homeNewBtn').onclick=openChoice;
$('#choiceClose').onclick=closeChoice;
$('#choiceModal').addEventListener('click',e=>{ if(e.target.id==='choiceModal') closeChoice(); });
$('#choiceBlank').onclick=()=>{ closeChoice(); createProject(); enterEditor(); toast('Blank project created — import media on the left, or add text to start ✂️'); };
$('#choiceInsert').onclick=()=>{ closeChoice(); $('#homeFileInput').click(); };
$('#homeFileInput').addEventListener('change',async e=>{
  const files=[...e.target.files].filter(f=>f.type.startsWith('video/')||f.type.startsWith('image/'));
  e.target.value='';
  if(!files.length){ toast('Please choose at least one video or image'); return; }
  createProject(files[0].name.replace(/\.[^.]+$/,'')||'Untitled Project');
  enterEditor();
  await handleFiles(files);
  upsertCurrentProject();
  toast(`✅ Added ${files.length} file(s) to the main track`);
});
$('#projectNameInput').addEventListener('input',()=>scheduleAutosave());
$('#projectNameInput').addEventListener('change',()=>{ upsertCurrentProject(); });
$('#tlUndoDemo').onclick=()=>{ if(confirm('Clear the whole timeline?')){ pause(); clips.forEach(c=>{if(c.el instanceof HTMLMediaElement)c.el.remove();}); clips=[]; selectedId=null; currentTime=0; renderAll(); } };
$('#zoomRange').oninput=e=>{ zoom=parseFloat(e.target.value); $('#zoomLabel').textContent=`${zoom} px/s`; renderTimeline(); };
$('#ratioSelect').onchange=e=>{
  userSetRatio=true;
  const r=e.target.value; const map={'16:9':[1280,720],'9:16':[720,1280],'1:1':[1080,1080],'4:5':[1080,1350]};
  [canvas.width,canvas.height]=map[r]; canvas.style.width=(r==='9:16'||r==='4:5')?'330px':'100%'; renderTimeline(); toast(`Canvas: ${canvas.width}×${canvas.height} (${r})`);
};
$('#openProjectInput').addEventListener('change',async e=>{
  const f=e.target.files[0]; if(!f)return;
  try{ const data=JSON.parse(await f.text());
    if(!data || !Array.isArray(data.clips)) throw new Error('Not an EXvid project');
    upsertCurrentProject(); clearTimelineMedia();
    currentProjectId=uid(); currentExportCount=data.exportCount||0;
    $('#projectNameInput').value=data.name||f.name.replace(/(\.EXvid|\.json)$/i,'')||'Untitled Project';
    data.clips.forEach(raw=>{ const c=baseClip(raw); c.id=raw.id||uid(); if(c.url && !c.url.startsWith('blob:')) c.el=createMediaEl(c); clips.push(c); });
    if(data.canvas){canvas.width=data.canvas[0];canvas.height=data.canvas[1]; canvas.style.width=(canvas.height>canvas.width)?'330px':'100%';}
    selectedId=clips[0]?.id||null; enterEditor(); upsertCurrentProject();
    toast('📂 .EXvid project opened — re-import any local videos that show as gaps');
  }catch(err){ toast('Could not open that file — it is not a valid .EXvid project'); }
  e.target.value='';
});
window.addEventListener('keydown',e=>{
  if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;
  if(e.code==='Space'){ e.preventDefault(); isPlaying?pause():play(); }
  if(e.key==='s'||e.key==='S') splitAtPlayhead();
  if(e.key==='Delete'||e.key==='Backspace') deleteSelected();
  if(e.key==='ArrowRight') seek(currentTime+0.5);
  if(e.key==='ArrowLeft') seek(currentTime-0.5);
});
renderProjectList(); renderAll(); requestAnimationFrame(loop);
