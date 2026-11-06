// @ts-nocheck
import { runBrain, anthropicCaller, ApiError, prepareThought, CRISIS_RE } from "../../brain/brain-core.ts";

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

/* reframer: the free tier goes through the Reframe server; a visitor's own key goes straight to Anthropic */
const API = document.querySelector('meta[name="reframe-api"]')?.getAttribute('content') || '/api/reframe';
const PATTERN_NAMES={all_or_nothing:"All-or-nothing thinking",overgeneralizing:"Overgeneralizing",labeling:"Labeling",catastrophizing:"Catastrophizing",mind_reading:"Mind reading",fortune_telling:"Fortune telling",emotional_reasoning:"Emotional reasoning",should_statements:"Should statements",discounting_positive:"Discounting the positive",personalization:"Personalization"};

/* The visitor's key lives only in this tab (sessionStorage), or only in memory if storage is blocked. */
const KEY_STORE='reframe.apiKey';
let memKey='';
function getKey(){ try{ return sessionStorage.getItem(KEY_STORE) || memKey; }catch{ return memKey; } }
function setKey(k){ memKey=k; try{ k ? sessionStorage.setItem(KEY_STORE,k) : sessionStorage.removeItem(KEY_STORE); }catch{} }

async function viaServer(text){
  let res;
  try{ res = await fetch(API,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({thought:text}),credentials:'omit'}); }
  catch{ throw {code:'offline'}; }
  const body = await res.json().catch(()=>({}));
  if(!res.ok) throw {code: body.error || 'unavailable'};
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

async function reframe(raw){
  const text = prepareThought(raw);
  const kw = CRISIS_RE.test(text);
  const key = getKey();
  let r, note='';
  try{
    if(key){
      try{ r = await viaOwnKey(text,key); }
      catch(e){
        if(e.code!=='bad_key' && e.code!=='key_billing') throw e;
        note = "Your API key didn't work, so this one used the free version. You can check it in the key settings.";
        r = await viaServer(text);
      }
    } else r = await viaServer(text);
  }catch(e){
    if(kw) return {safety:true}; // never let an outage hide the safety screen
    return {error: e && e.code};
  }
  if(r.category==="crisis") return {safety:true};
  if(r.category==="not_a_thought") return {nudge:true};
  const reframeText = String(r.reframe||"").trim();
  if(!reframeText) return {error:"empty"};
  return {text:reframeText, kind:PATTERN_NAMES[r.pattern]||null, heavy:r.category==="heavy", note};
}

const ERRORS = {
  rate_limited: "That's a lot of thoughts in a short time. Give it a minute and try again.",
  daily_cap: "Reframe has used up today's free reframes. Please come back tomorrow.",
  key_rate_limited: "Your API key is being rate limited by Anthropic. Try again in a moment.",
  offline: "Couldn't reach Reframe. Check your connection and try again.",
};
const notice=$('notice');
function showNotice(msg, withKeyLink){
  notice.textContent=msg;
  if(withKeyLink){
    const b=document.createElement('button'); b.type='button'; b.className='link'; b.textContent='Or use your own API key';
    b.addEventListener('click',openKeyDialog); notice.append(' ',b);
  }
  notice.hidden=!msg;
}

function setState(s){
  bubble.dataset.state=s; document.body.dataset.state=s;
  notice.hidden=true;
  tap.hidden = s!=='idle';
  ta.hidden = !(s==='editing'||s==='charging');
  result.hidden = s!=='revealed';
  tag.hidden = s!=='revealed' || !tag.textContent;
  safety.hidden = s!=='safety';
  enchantBtn.hidden = s!=='editing';
  backBtn.hidden = s!=='editing';
  again.hidden = !(s==='revealed'||s==='safety');
  examples.hidden = s!=='idle';
  eyebrow.hidden = !(s==='editing'||s==='revealed');
  eyebrow.textContent = s==='revealed' ? 'Another way to see it' : "What's the thought?";
  again.textContent = s==='safety' ? 'Back' : 'Let it float away';
}

function startEditing(text){
  setState('editing');
  if(text!=null) ta.value=text;
  enchantBtn.disabled=!ta.value.trim();
  ta.focus({preventScroll:true});
}
tap.addEventListener('click',()=>startEditing());
examples.querySelectorAll('.chip').forEach(c=>c.addEventListener('click',()=>startEditing(c.textContent)));
ta.addEventListener('input',()=>{enchantBtn.disabled=!ta.value.trim()});
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
  const wait=Math.max(0,(reduce?0:1400)-(performance.now()-t0));
  await new Promise(res=>setTimeout(res,wait));
  charging=false; busy=false; ta.readOnly=false;
  if(r.safety){ setState('safety'); $('safetyTitle').focus({preventScroll:true}); return; }
  if(r.nudge||r.error){
    setState('editing');
    if(r.nudge){ eyebrow.textContent="Try writing what your inner critic is saying about you"; }
    else showNotice(ERRORS[r.error] || "That didn't work. Try again in a moment.", r.error==='daily_cap' && !getKey());
    return;
  }
  bubble.classList.add('burst'); if(!reduce) fx.burst();
  setTimeout(()=>{
    result.textContent='';
    r.text.split(' ').forEach((w,i)=>{
      const s=document.createElement('span'); s.textContent=w;
      s.style.animationDelay=(reduce?0:i*60)+'ms';
      result.append(s,' ');
    });
    tag.textContent=''; if(r.kind){ tag.append('Thinking pattern spotted: '); const b=document.createElement('b'); b.textContent=r.kind; tag.append(b); }
    $('note').textContent = r.heavy ? 'This sounds like a lot to carry. Talking to someone you trust can help.' : '';
    setState('revealed'); $('note').hidden=!r.heavy;
    if(r.note){ notice.textContent=r.note; notice.hidden=false; }
    setTimeout(()=>bubble.classList.remove('burst'),1000);
  },reduce?100:300);
}

again.addEventListener('click',()=>{
  const reset=()=>{ ta.value=''; result.textContent=''; tag.textContent=''; $('note').hidden=true; setState('idle'); };
  if(reduce){ reset(); tap.focus(); return; }
  wrap.classList.add('away');
  setTimeout(()=>{ reset(); wrap.classList.remove('away'); wrap.classList.add('arrive');
    setTimeout(()=>wrap.classList.remove('arrive'),820); tap.focus({preventScroll:true}); },760);
});

/* sparkle particles */
const fx=(()=>{
  const c=$('fx'), ctx=c.getContext('2d'); let W=0,H=0,parts=[],running=false,chargeUntil=0;
  function resize(){const d=Math.min(devicePixelRatio||1,2); W=innerWidth; H=innerHeight; c.width=W*d; c.height=H*d; c.style.width=W+'px'; c.style.height=H+'px'; ctx.setTransform(d,0,0,d,0,0);}
  addEventListener('resize',resize); resize();
  const cols=['255,255,255','255,255,255','255,173,196','255,214,228'];
  const pick=()=>cols[Math.random()*cols.length|0];
  function center(){const r=bubble.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,rad:Math.max(r.width,r.height)/2};}
  function spawnIn(){const {x,y,rad}=center(), a=Math.random()*Math.PI*2;
    parts.push({in:true,cx:x,cy:y,a,d:rad*(1.05+Math.random()*.7),spin:.02+Math.random()*.035,size:1.2+Math.random()*2.6,col:pick()});}
  function burst(){const {x,y,rad}=center();
    for(let i=0;i<110;i++){const a=Math.random()*Math.PI*2, s=2+Math.random()*6;
      parts.push({in:false,x:x+Math.cos(a)*rad*.25,y:y+Math.sin(a)*rad*.25,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:1,decay:.01+Math.random()*.016,size:1+Math.random()*3.2,col:pick()});}
    start();}
  function charge(ms){chargeUntil=performance.now()+ms; start();}
  function start(){if(!running){running=true; requestAnimationFrame(tick);}}
  function dot(x,y,size,col,a){const r=size*3.2, g=ctx.createRadialGradient(x,y,0,x,y,r);
    g.addColorStop(0,`rgba(${col},${a})`); g.addColorStop(.35,`rgba(${col},${a*.55})`); g.addColorStop(1,`rgba(${col},0)`);
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();}
  function tick(now){
    ctx.clearRect(0,0,W,H);
    if(now<chargeUntil) for(let i=0;i<5;i++) spawnIn();
    parts=parts.filter(p=>{
      if(p.in){ p.a+=p.spin; p.d*=.952; if(p.d<10) return false;
        dot(p.cx+Math.cos(p.a)*p.d, p.cy+Math.sin(p.a)*p.d, p.size, p.col, Math.min(1,p.d/50)); }
      else { p.x+=p.vx; p.y+=p.vy; p.vx*=.955; p.vy=p.vy*.955-.03; p.life-=p.decay; if(p.life<=0) return false;
        dot(p.x,p.y,p.size,p.col,p.life); }
      return true;
    });
    if(parts.length||now<chargeUntil) requestAnimationFrame(tick); else {running=false; ctx.clearRect(0,0,W,H);}
  }
  return {charge,burst};
})();

setState('idle');

/* own-key settings */
const keyDialog=$('keyDialog'), keyInput=$('keyInput'), keyMsg=$('keyMsg'), keyRemove=$('keyRemove'), keyOpen=$('keyOpen');
function refreshKeyLink(){ keyOpen.textContent = getKey() ? 'Using your own API key · change' : 'Use your own API key'; }
function openKeyDialog(){
  keyInput.value=''; keyMsg.textContent = getKey() ? 'A key is saved for this tab. Paste a new one to replace it.' : '';
  keyRemove.hidden=!getKey();
  keyDialog.showModal(); keyInput.focus();
}
keyOpen.addEventListener('click',openKeyDialog);
keyRemove.addEventListener('click',()=>{ setKey(''); refreshKeyLink(); keyDialog.close(); });
$('keyForm').addEventListener('submit',e=>{
  if(e.submitter && e.submitter.value!=='save') return;
  const k=keyInput.value.trim();
  if(!k){ if(getKey()) return; e.preventDefault(); keyMsg.textContent='Paste a key first, or press Cancel.'; return; }
  if(!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k)){ e.preventDefault(); keyMsg.textContent="That doesn't look like an Anthropic API key. They start with sk-ant-."; return; }
  setKey(k); refreshKeyLink();
});
keyDialog.addEventListener('close',()=>{ keyInput.value=''; });
refreshKeyLink();
