// @ts-nocheck
import { runBrain, anthropicCaller, ApiError, hasCrisisWords, MAX_CHARS } from "../../brain/brain-core.ts";

const $ = id => document.getElementById(id);
const wrap=$('wrap'), bubble=$('bubble'), tap=$('tap'), ta=$('thought'), eyebrow=$('eyebrow'),
      result=$('result'), tag=$('tag'), safety=$('safety'), enchantBtn=$('enchant'), backBtn=$('back'), again=$('again'), examples=$('examples');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* sky decoration */
(function(){
  const sky=document.querySelector('.sky');
  for(let i=0;i<7;i++){
    const c=document.createElement('div'); c.className='cloud';
    const dur=70+Math.random()*80;
    c.style.cssText=`--w:${180+Math.random()*260}px;--top:${4+Math.random()*82}%;--o:${.45+Math.random()*.5};--dur:${dur}s;--delay:${-Math.random()*dur}s`;
    sky.appendChild(c);
  }
  const s=[]; for(let i=0;i<90;i++) s.push(`${(Math.random()*100).toFixed(1)}vw ${(Math.random()*70).toFixed(1)}vh 0 ${Math.random()<.2?1:0}px rgba(255,255,255,${(.4+Math.random()*.6).toFixed(2)})`);
  $('stars').style.boxShadow=s.join(',');
})();

/* reframer: Claude (free tier), Llama and Qwen go through the Reframe server; a visitor's own key goes straight to Anthropic */
const API = document.querySelector('meta[name="reframe-api"]')?.getAttribute('content') || '/api/reframe';
const PATTERN_NAMES={all_or_nothing:"All-or-nothing thinking",overgeneralizing:"Overgeneralizing",labeling:"Labeling",catastrophizing:"Catastrophizing",mind_reading:"Mind reading",fortune_telling:"Fortune telling",emotional_reasoning:"Emotional reasoning",should_statements:"Should statements",discounting_positive:"Discounting the positive",personalization:"Personalization"};

/* The visitor's key lives only in this tab (sessionStorage), or only in memory if storage is blocked. */
const KEY_STORE='reframe.apiKey';
let memKey='';
function getKey(){ try{ return sessionStorage.getItem(KEY_STORE) || memKey; }catch{ return memKey; } }
function setKey(k){ memKey=k; try{ k ? sessionStorage.setItem(KEY_STORE,k) : sessionStorage.removeItem(KEY_STORE); }catch{} }

/* The picked model is a convenience remembered in this browser: claude | llama | qwen | own. */
const MODEL_STORE='reframe.model', MODELS=['claude','llama','qwen','own'];
const MODEL_NAMES={claude:'Claude',llama:'Llama',qwen:'Qwen',own:'Claude (your key)'};
let memModel='claude';
function getModel(){ let m; try{ m=localStorage.getItem(MODEL_STORE); }catch{} m=m||memModel; return MODELS.includes(m)?m:'claude'; }
function setModel(m){ memModel=m; try{ localStorage.setItem(MODEL_STORE,m); }catch{} }

async function viaServer(text, model){
  let res;
  try{ res = await fetch(API,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({thought:text, model}),credentials:'omit'}); }
  catch{ throw {code:'offline'}; }
  const body = await res.json().catch(()=>({}));
  if(model==='claude') showLeft(body.left);
  if(!res.ok) throw {code: body.error || 'unavailable', detail: typeof body.code==='string' ? body.code.slice(0,60) : ''};
  return body;
}
async function viaOwnKey(text,key){
  try{ return await runBrain(text, anthropicCaller(key,{browser:true})); }
  catch(e){
    if(e instanceof ApiError){
      if(e.status===401||e.status===403) throw {code:'bad_key'};
      if(e.status===429) throw {code:'key_rate_limited'};
      if(e.status===400 && /billing|credit/i.test(e.type)) throw {code:'key_billing'};
    }
    throw {code:'unavailable'};
  }
}

/* Emoji or punctuation with no words: ask gently for a few words instead of guessing. */
const NO_WORDS_RE = /^[\p{Extended_Pictographic}\p{Emoji_Component}\p{P}\p{S}\s]+$/u;

async function reframe(raw){
  const text = String(raw||'').trim();
  const kw = hasCrisisWords(text);
  const picked = getModel();
  const key = picked==='own' ? getKey() : '';
  let r, note='';
  try{
    if(key){
      try{ r = await viaOwnKey(text,key); }
      catch(e){
        if(e.code!=='bad_key' && e.code!=='key_billing') throw e;
        note = "Your API key didn't work, so this one used the free version. You can check it in the model settings.";
        r = await viaServer(text,'claude');
      }
    } else {
      const model = picked==='own' ? 'claude' : picked;
      r = await viaServer(text, model);
      // Llama or Qwen couldn't give a usable answer (or ran out of today's free allowance), so Claude wrote it. Say so.
      if((model==='llama'||model==='qwen') && r.writer==='claude') note = `${MODEL_NAMES[model]} couldn't answer this one, so Claude wrote it.`;
    }
  }catch(e){
    if(kw) return {safety:true}; // never let an outage hide the safety screen
    return {error: e && e.code, detail: e && e.detail};
  }
  if(r.category==="crisis") return {safety:true, someoneElse:r.about==="someone_else"};
  if(r.category==="harm_to_others") return {pause:true};
  if(r.category==="not_a_thought") return {nudge: NO_WORDS_RE.test(text) ? 'words' : 'general'};
  const reframeText = String(r.reframe||"").trim();
  if(!reframeText) return {error:"empty"};
  if(r.category==="positive") return {text:reframeText, savour:true, note};
  return {text:reframeText, kind:PATTERN_NAMES[r.pattern]||null, heavy:r.category==="heavy", note};
}

const ERRORS = {
  rate_limited: "That's a lot of thoughts in a short time. Give it a minute and try again.",
  busy: "Lots of people are reframing right now. Try again in a few seconds.",
  daily_cap: "Today's free reframes are used up. More tomorrow.",
  key_rate_limited: "Your API key is being rate limited by Anthropic. Try again in a moment.",
  offline: "Couldn't reach Reframe. Check your connection and try again.",
};
const NUDGES = {
  general: "Anything on your mind? It can be a worry or something good.",
  words: "Want to put a few words to it? Even one is enough.",
};
const SAFETY_COPY = {
  self: ["This one deserves more than a reframe.", "It sounds like you're carrying something really heavy. Please reach out to someone who can be with you in it right now."],
  someoneElse: ["It sounds like you're worried about someone.", "That's a lot to hold. SOS can help you work out how to support them, and you can call 995 if they're in danger right now."],
};
function setSafetyCopy(someoneElse){
  const [title, body] = someoneElse ? SAFETY_COPY.someoneElse : SAFETY_COPY.self;
  $('safetyTitle').textContent = title; $('safetyBody').textContent = body;
}
const notice=$('notice');
function showNotice(msg, withKeyLink){
  notice.textContent=msg;
  if(withKeyLink){
    const b=document.createElement('button'); b.type='button'; b.className='link'; b.textContent='Or use your own API key';
    b.addEventListener('click',()=>openKeyDialog('own')); notice.append(' ',b);
  }
  notice.hidden=!msg;
}

function setState(s){
  bubble.dataset.state=s; document.body.dataset.state=s;
  notice.hidden=true;
  tap.hidden = s!=='idle';
  ta.hidden = !(s==='editing'||s==='charging');
  const shown = s==='revealed'||s==='savoured';
  result.hidden = !shown;
  tag.hidden = s!=='revealed' || !tag.textContent;
  safety.hidden = s!=='safety';
  $('pause').hidden = s!=='pause';
  enchantBtn.hidden = s!=='editing';
  backBtn.hidden = s!=='editing';
  again.hidden = !(shown||s==='safety'||s==='pause');
  examples.hidden = s!=='idle';
  eyebrow.hidden = !(s==='editing'||shown);
  eyebrow.textContent = s==='revealed' ? 'Another way to see it' : s==='savoured' ? 'Worth holding onto' : "What's the thought?";
  again.textContent = (s==='safety'||s==='pause') ? 'Back' : s==='savoured' ? 'Let it float up' : 'Let it float away';
  counter.hidden = s!=='editing' || ta.value.length < COUNTER_FROM;
}

/* Character counter: shown only near the limit, so long pastes are never cut silently. */
const counter=$('counter');
ta.maxLength = MAX_CHARS;
const COUNTER_FROM = MAX_CHARS - 100;
function updateCounter(){
  const n = ta.value.length;
  counter.hidden = bubble.dataset.state!=='editing' || n < COUNTER_FROM;
  counter.textContent = `${n} / ${MAX_CHARS}`;
}

function startEditing(text){
  setState('editing');
  if(text!=null) ta.value=text;
  enchantBtn.disabled=!ta.value.trim();
  updateCounter();
  ta.focus({preventScroll:true});
}
tap.addEventListener('click',()=>startEditing());
examples.querySelectorAll('.chip').forEach(c=>c.addEventListener('click',()=>startEditing(c.textContent)));
ta.addEventListener('input',()=>{enchantBtn.disabled=!ta.value.trim(); updateCounter();});
ta.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();enchant()}});
enchantBtn.addEventListener('click',enchant);
backBtn.addEventListener('click',()=>{ if(busy) return; ta.value=''; setState('idle'); tap.focus({preventScroll:true}); });

let busy=false;
async function enchant(){
  const t=ta.value.trim(); if(!t||busy||bubble.dataset.state!=='editing') return;
  busy=true; ta.readOnly=true; setState('charging');
  eyebrow.hidden=false; eyebrow.textContent='Listening to it...';
  const t0=performance.now();
  let charging=true;
  (function keep(){ if(!reduce&&charging){ fx.charge(700); setTimeout(keep,600);} })();
  const r=await reframe(t);
  const wait=Math.max(0,(reduce?0:900)-(performance.now()-t0)); // a short minimum so a fast answer still gets a moment of sparkle
  await new Promise(res=>setTimeout(res,wait));
  charging=false; busy=false; ta.readOnly=false; fx.settle();
  if(r.safety){ setSafetyCopy(r.someoneElse); setState('safety'); $('safetyTitle').focus({preventScroll:true}); return; }
  if(r.pause){ setState('pause'); $('pauseTitle').focus({preventScroll:true}); return; }
  if(r.nudge||r.error){
    setState('editing');
    if(r.nudge){ eyebrow.textContent=NUDGES[r.nudge]; }
    else if(r.error==='daily_cap' && !(getModel()==='own' && getKey())){
      // Today's free Claude is used up: ask for their own key right away. Their thought stays in the bubble, ready to send again.
      showNotice(ERRORS.daily_cap, true);
      retryAfterPick=true;
      openKeyDialog('own', getModel()==='claude' || getModel()==='own'
        ? "Today's free Claude reframes are used up. Paste your own Anthropic API key to keep going, or pick Llama or Qwen, which are still free today."
        : "Today's free reframes are used up. Paste your own Anthropic API key to keep going.");
    }
    else showNotice((ERRORS[r.error] || "That didn't work. Try again in a moment.") + (r.detail ? ` (${r.detail})` : ''), r.error==='daily_cap' && getModel()!=='own');
    return;
  }
  if(r.savour){
    // A happy thought isn't transformed, so no burst: the bubble warms slowly and sparkles drift upward.
    if(!reduce) fx.rise();
    showWords(r.text);
    tag.textContent=''; $('note').textContent='';
    setState('savoured'); $('note').hidden=true;
    if(r.note){ notice.textContent=r.note; notice.hidden=false; }
    return;
  }
  bubble.classList.add('burst'); if(!reduce) fx.burst();
  setTimeout(()=>{
    showWords(r.text);
    tag.textContent=''; if(r.kind){ tag.append('Thinking pattern spotted: '); const b=document.createElement('b'); b.textContent=r.kind; tag.append(b); }
    $('note').textContent = r.heavy ? 'This sounds like a lot to carry. Talking to someone you trust can help.' : '';
    setState('revealed'); $('note').hidden=!r.heavy;
    if(r.note){ notice.textContent=r.note; notice.hidden=false; }
    setTimeout(()=>bubble.classList.remove('burst'),1000);
  },reduce?100:300);
}

function showWords(text){
  result.textContent='';
  text.split(' ').forEach((w,i)=>{
    const s=document.createElement('span'); s.textContent=w;
    s.style.animationDelay=(reduce?0:i*60)+'ms';
    result.append(s,' ');
  });
}

again.addEventListener('click',()=>{
  const reset=()=>{ ta.value=''; result.textContent=''; tag.textContent=''; $('note').hidden=true; setSafetyCopy(false); setState('idle'); };
  if(reduce){ reset(); tap.focus(); return; }
  wrap.classList.add('away');
  setTimeout(()=>{ reset(); wrap.classList.remove('away'); wrap.classList.add('arrive');
    setTimeout(()=>wrap.classList.remove('arrive'),820); tap.focus({preventScroll:true}); },760);
});

/* sparkle particles */
const fx=(()=>{
  const c=$('fx'), ctx=c.getContext('2d'); let W=0,H=0,parts=[],running=false,chargeUntil=0;
  function resize(){const d=Math.min(devicePixelRatio||1,1.5); /* soft glow dots don't need full retina resolution */ W=innerWidth; H=innerHeight; c.width=W*d; c.height=H*d; c.style.width=W+'px'; c.style.height=H+'px'; ctx.setTransform(d,0,0,d,0,0);}
  addEventListener('resize',resize); resize();
  const cols=['255,255,255','255,255,255','255,173,196','255,214,228'];
  // Each glow dot is drawn once per colour into a small sprite, then stamped with drawImage.
  // Building a gradient per dot per frame was the main cost on phones.
  const SPRITE=64, sprites={};
  for(const col of cols){ if(sprites[col]) continue;
    const s=document.createElement('canvas'); s.width=s.height=SPRITE; const g=s.getContext('2d'), h=SPRITE/2;
    const grad=g.createRadialGradient(h,h,0,h,h,h);
    grad.addColorStop(0,`rgba(${col},1)`); grad.addColorStop(.35,`rgba(${col},.55)`); grad.addColorStop(1,`rgba(${col},0)`);
    g.fillStyle=grad; g.fillRect(0,0,SPRITE,SPRITE); sprites[col]=s; }
  const pick=()=>cols[Math.random()*cols.length|0];
  const MAX_PARTS=180;
  function center(){const r=bubble.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,rad:Math.max(r.width,r.height)/2};}
  function spawnIn(c){const {x,y,rad}=c, a=Math.random()*Math.PI*2;
    parts.push({in:true,cx:x,cy:y,a,d:rad*(1.05+Math.random()*.7),spin:.02+Math.random()*.035,size:1.2+Math.random()*2.6,col:pick()});}
  function burst(){const {x,y,rad}=center();
    for(let i=0;i<110;i++){const a=Math.random()*Math.PI*2, s=2+Math.random()*6;
      parts.push({in:false,x:x+Math.cos(a)*rad*.25,y:y+Math.sin(a)*rad*.25,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:1,decay:.01+Math.random()*.016,size:1+Math.random()*3.2,col:pick()});}
    start();}
  function rise(){const {x,y,rad}=center();
    for(let i=0;i<46;i++){const a=Math.random()*Math.PI*2, r=rad*(.35+Math.random()*.75);
      parts.push({in:false,x:x+Math.cos(a)*r,y:y+Math.sin(a)*r*.8,vx:(Math.random()-.5)*.5,vy:-(.35+Math.random()*.9),life:1,decay:.004+Math.random()*.006,size:1+Math.random()*2.4,col:pick(),float:true});}
    start();}
  function charge(ms){chargeUntil=performance.now()+ms; start();}
  // The answer is in: stop spawning and pull the swirling dots in quickly, so the reveal isn't held up.
  function settle(){chargeUntil=0; for(const p of parts) if(p.in) p.fast=true;}
  function start(){if(!running){running=true; requestAnimationFrame(tick);}}
  function dot(x,y,size,col,a){const r=size*3.2;
    ctx.globalAlpha=a; ctx.drawImage(sprites[col],x-r,y-r,r*2,r*2);}
  function tick(now){
    ctx.clearRect(0,0,W,H);
    if(now<chargeUntil && parts.length<MAX_PARTS){ const c=center(); for(let i=0;i<4;i++) spawnIn(c); }
    parts=parts.filter(p=>{
      if(p.in){ p.a+=p.spin; p.d*=p.fast?.86:.952; if(p.d<10) return false;
        dot(p.cx+Math.cos(p.a)*p.d, p.cy+Math.sin(p.a)*p.d, p.size, p.col, Math.min(1,p.d/50)); }
      else if(p.float){ p.x+=p.vx+Math.sin(now/600+p.y/40)*.15; p.y+=p.vy; p.life-=p.decay; if(p.life<=0) return false;
        dot(p.x,p.y,p.size,p.col,Math.min(1,p.life*1.6)); }
      else { p.x+=p.vx; p.y+=p.vy; p.vx*=.955; p.vy=p.vy*.955-.03; p.life-=p.decay; if(p.life<=0) return false;
        dot(p.x,p.y,p.size,p.col,p.life); }
      return true;
    });
    ctx.globalAlpha=1;
    if(parts.length||now<chargeUntil) requestAnimationFrame(tick); else {running=false; ctx.clearRect(0,0,W,H);}
  }
  return {charge,burst,rise,settle};
})();

setState('idle');

/* how many free reframes are left today, shared by everyone */
const STATUS = API.replace(/\/reframe$/, '/status');
const leftEl=$('left');
let lastLeft=null;
function showLeft(n){
  if(typeof n!=='number' || n<0) return;
  lastLeft=n;
  if(getModel()!=='claude'){ leftEl.hidden=true; return; } // the count is for the Claude free tier only
  leftEl.textContent = n===0 ? "Today's free reframes are used up. More tomorrow."
    : n===1 ? 'About 1 free reframe left today, shared by everyone.'
    : `About ${n.toLocaleString()} free reframes left today, shared by everyone.`;
  leftEl.hidden=false;
}
fetch(STATUS,{credentials:'omit'}).then(r=>r.ok?r.json():null).then(b=>b&&showLeft(b.left)).catch(()=>{});

/* model settings, including the visitor's own key */
const keyDialog=$('keyDialog'), keyInput=$('keyInput'), keyMsg=$('keyMsg'), keyRemove=$('keyRemove'), keyOpen=$('keyOpen'), keyBox=$('keyBox');
const radios=[...keyDialog.querySelectorAll('input[name="model"]')];
const chosen=()=>radios.find(r=>r.checked)?.value || 'claude';
function refreshKeyLink(){
  const m = getModel()==='own' && !getKey() ? 'claude' : getModel();
  keyOpen.textContent = `Model: ${MODEL_NAMES[m]} · change`;
  if(m==='claude' && lastLeft!=null) showLeft(lastLeft); else if(m!=='claude') leftEl.hidden=true;
}
function syncKeyBox(){
  const own = chosen()==='own';
  keyBox.hidden=!own;
  keyRemove.hidden=!(own && getKey());
  keyMsg.textContent = own && getKey() ? 'A key is saved for this tab. Paste a new one to replace it, or leave it empty to keep it.' : '';
}
const keyIntro=$('keyIntro');
let retryAfterPick=false; // set when the dialog opened because free Claude ran out: send the thought again once they pick
function openKeyDialog(prefer, intro){
  keyInput.value='';
  keyIntro.textContent = intro || ''; keyIntro.hidden = !intro;
  const m = typeof prefer==='string' ? prefer : getModel();
  radios.forEach(r=>{ r.checked = r.value===m; });
  syncKeyBox();
  keyDialog.showModal();
  if(m==='own') keyInput.focus(); else radios.find(r=>r.checked)?.focus();
}
radios.forEach(r=>r.addEventListener('change',()=>{ syncKeyBox(); if(chosen()==='own') keyInput.focus(); }));
keyOpen.addEventListener('click',()=>openKeyDialog());
keyRemove.addEventListener('click',()=>{ setKey(''); setModel('claude'); refreshKeyLink(); keyDialog.close(); });
$('keyForm').addEventListener('submit',e=>{
  if(e.submitter && e.submitter.value!=='save') return;
  const m=chosen();
  if(m==='own'){
    const k=keyInput.value.trim();
    if(!k && !getKey()){ e.preventDefault(); keyMsg.textContent='Paste a key first, or pick another model.'; return; }
    if(k && !/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k)){ e.preventDefault(); keyMsg.textContent="That doesn't look like an Anthropic API key. They start with sk-ant-."; return; }
    if(k) setKey(k);
  }
  setModel(m); refreshKeyLink();
  if(retryAfterPick && bubble.dataset.state==='editing' && ta.value.trim()){ retryAfterPick=false; setTimeout(enchant,250); }
});
keyDialog.addEventListener('close',()=>{ keyInput.value=''; if(keyDialog.returnValue!=='save') retryAfterPick=false; });
refreshKeyLink();
