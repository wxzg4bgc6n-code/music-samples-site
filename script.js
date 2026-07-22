const CONFIG=window.NOIRWAVE_CONFIG||{};
const API_BASE=String(CONFIG.API_BASE||"").replace(/\/+$/,"");
const GOOGLE_CLIENT_ID=String(CONFIG.GOOGLE_CLIENT_ID||"");
const AUTH_TOKEN_KEY="noirwave_auth_token";

const c=document.getElementById("particles"),x=c.getContext("2d");
let ps=[];
function rs(){
  const d=devicePixelRatio||1;
  c.width=innerWidth*d;c.height=innerHeight*d;
  c.style.width=innerWidth+"px";c.style.height=innerHeight+"px";
  x.setTransform(d,0,0,d,0,0);
  ps=Array.from({length:Math.min(70,innerWidth/18)},()=>({
    x:Math.random()*innerWidth,y:Math.random()*innerHeight,
    r:Math.random()*1.3+.25,v:Math.random()*.2+.04
  }));
}
function ap(){
  x.clearRect(0,0,innerWidth,innerHeight);
  x.fillStyle="rgba(255,255,255,.22)";
  ps.forEach(p=>{
    p.y-=p.v;if(p.y<0)p.y=innerHeight;
    x.beginPath();x.arc(p.x,p.y,p.r,0,7);x.fill();
  });
  requestAnimationFrame(ap);
}
addEventListener("resize",rs);rs();ap();

document.getElementById("menu")?.addEventListener("click",()=>{
  document.getElementById("nav")?.classList.toggle("open");
});

const io=new IntersectionObserver(es=>es.forEach(e=>{
  if(e.isIntersecting)e.target.classList.add("show");
}),{threshold:.12});
document.querySelectorAll(".reveal").forEach(e=>io.observe(e));

let counted=false;
const co=new IntersectionObserver(([e])=>{
  if(!e.isIntersecting||counted)return;
  counted=true;
  document.querySelectorAll("[data-count]").forEach(el=>{
    const t=Number(el.dataset.count||0),s=performance.now();
    function f(n){
      const p=Math.min((n-s)/1300,1);
      const v=Math.floor(t*(1-Math.pow(1-p,3)));
      el.textContent=v+(t>=1000?"+":"");
      if(p<1)requestAnimationFrame(f);
    }
    requestAnimationFrame(f);
  });
},{threshold:.5});
const statsBlock=document.querySelector(".stats");
if(statsBlock)co.observe(statsBlock);

function bars(el){
  for(let i=0;i<24;i++){
    const b=document.createElement("i");
    b.style.height=(5+Math.random()*25)+"px";
    el.appendChild(b);
  }
}
document.querySelectorAll(".mini-wave").forEach(bars);

let ac,osc,gain,playing=false,timer,progress=0,currentButton=null;
function stopTone(){
  try{osc?.stop()}catch{}
  playing=false;clearInterval(timer);
  if(currentButton){
    currentButton.textContent=currentButton.classList.contains("preview-btn")?"▶ Preview":"▶";
  }
  currentButton=null;
}
function tone(button,progressBar){
  if(playing){stopTone();return}
  ac=ac||new(window.AudioContext||window.webkitAudioContext)();
  osc=ac.createOscillator();gain=ac.createGain();
  osc.type="sine";osc.frequency.value=82+Math.random()*180;
  gain.gain.setValueAtTime(.0001,ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(.05,ac.currentTime+.12);
  gain.gain.exponentialRampToValueAtTime(.0001,ac.currentTime+5);
  osc.connect(gain).connect(ac.destination);osc.start();osc.stop(ac.currentTime+5);
  playing=true;currentButton=button;button.textContent="❚❚";progress=0;
  if(progressBar){
    timer=setInterval(()=>{
      progress+=2;progressBar.style.width=progress+"%";
      if(progress>=100){clearInterval(timer);progressBar.style.width="0"}
    },100);
  }
  osc.onended=()=>{
    if(progressBar)progressBar.style.width="0";
    if(currentButton===button){
      playing=false;button.textContent=button.classList.contains("preview-btn")?"▶ Preview":"▶";
      currentButton=null;
    }
  };
}

const w=document.querySelector(".wave");
if(w){
  const wc=w.getContext("2d");
  function rw(){
    const d=devicePixelRatio||1;
    w.width=w.clientWidth*d;w.height=w.clientHeight*d;
    wc.setTransform(d,0,0,d,0,0);
  }
  rw();addEventListener("resize",rw);
  function dw(t=0){
    const W=w.clientWidth,H=w.clientHeight;
    wc.clearRect(0,0,W,H);
    wc.strokeStyle="rgba(255,255,255,.65)";wc.lineWidth=1.4;wc.beginPath();
    for(let i=0;i<W;i++){
      const y=H/2+Math.sin(i*.045+t*.003)*11+Math.sin(i*.014+t*.0017)*18;
      i?wc.lineTo(i,y):wc.moveTo(i,y);
    }
    wc.stroke();requestAnimationFrame(dw);
  }
  dw();
}

// Материалы из демонстрационной админки пока хранятся в этом браузере.
(function renderDemoContent(){
  const esc=s=>String(s||"").replace(/[&<>"']/g,m=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
  const packs=JSON.parse(localStorage.getItem("noirwave_packs")||"[]");
  const tracks=JSON.parse(localStorage.getItem("noirwave_tracks")||"[]");

  const packsRoot=document.getElementById("dynamicPacks");
  if(packsRoot&&packs.length){
    packs.forEach(p=>{
      const card=document.createElement("article");
      card.className="pack admin-added";
      card.innerHTML=`<div class="pack-cover" style="${p.cover?`background-image:linear-gradient(rgba(0,0,0,.18),rgba(0,0,0,.35)),url('${p.cover}');background-size:cover;background-position:center`:''}">
        <span class="price">${esc(p.price||"FREE")}</span><h3>${esc(p.title)}</h3></div>
        <div class="pack-body"><div class="pack-tags"><span class="tag">${esc(p.genre||"PACK")}</span>${p.bpm?`<span class="tag">${esc(p.bpm)} BPM</span>`:""}<span class="tag">DEMO</span></div>
        <div class="pack-info"><span>${esc(p.files||"?")} файлов</span><span>${esc(p.key||"")}</span></div>
        <div class="pack-actions"><button class="preview-btn">▶ Preview</button><button class="download">${p.price==="FREE"?"Скачать":"Получить"}</button></div></div>`;
      packsRoot.prepend(card);
    });
  }

  const tracksRoot=document.getElementById("dynamicTracks");
  if(tracksRoot&&tracks.length){
    tracks.forEach(t=>{
      const card=document.createElement("article");
      card.className="track admin-added";
      card.innerHTML=`<div class="track-cover" style="${t.cover?`background-image:url('${t.cover}');background-size:cover;background-position:center`:""}"></div><h3>${esc(t.title)}</h3><p>${esc(t.genre||"Track")}${t.bpm?" · "+esc(t.bpm)+" BPM":""}</p>`;
      tracksRoot.prepend(card);
    });
  }
})();

const authState={
  token:localStorage.getItem(AUTH_TOKEN_KEY)||"",
  user:null,
  ready:false
};

const $=s=>document.querySelector(s);
function toast(text){
  const el=$("#toast");if(!el)return;
  el.textContent=text;el.classList.remove("hidden");
  clearTimeout(window.__toastTimer);
  window.__toastTimer=setTimeout(()=>el.classList.add("hidden"),3400);
}
function setAuthMessage(text="",success=false){
  const el=$("#authMessage");if(!el)return;
  el.textContent=text;el.classList.toggle("success",success);
}
function openAuth(){
  $("#authModal")?.classList.remove("hidden");
  document.body.style.overflow="hidden";
  renderAccountModal();
}
function closeAuth(){
  $("#authModal")?.classList.add("hidden");
  document.body.style.overflow="";
}
function renderHeader(){
  const btn=$("#accountBtn"),nav=$("#adminNav");
  if(btn){
    btn.classList.toggle("loading",!authState.ready);
    btn.textContent=authState.user?authState.user.name:authState.ready?"Войти":"Проверка…";
  }
  if(nav){
    nav.classList.toggle("hidden",!authState.user||!["admin","owner"].includes(authState.user.role));
  }
  document.querySelectorAll(".download").forEach(button=>{
    button.classList.toggle("locked",!authState.user);
  });
}
function renderAccountModal(){
  const guest=$("#authGuestView"),account=$("#accountView");
  if(authState.user){
    guest?.classList.add("hidden");account?.classList.remove("hidden");
    $("#accountName").textContent=authState.user.name;
    $("#accountEmail").textContent=authState.user.email;
    $("#accountRole").textContent=authState.user.role.toUpperCase();
    $("#accountAdminLink")?.classList.toggle("hidden",!["admin","owner"].includes(authState.user.role));
    const avatar=$("#accountAvatar");
    if(avatar&&authState.user.avatar_url){
      avatar.src=authState.user.avatar_url;avatar.classList.remove("hidden");
    }else avatar?.classList.add("hidden");
  }else{
    account?.classList.add("hidden");guest?.classList.remove("hidden");
  }
}
async function api(path,options={}){
  if(!API_BASE)throw new Error("Не указан адрес API");
  const headers=new Headers(options.headers||{});
  if(options.body&&!headers.has("Content-Type"))headers.set("Content-Type","application/json");
  if(authState.token)headers.set("Authorization",`Bearer ${authState.token}`);
  const response=await fetch(API_BASE+path,{...options,headers});
  let data={};
  try{data=await response.json()}catch{}
  if(!response.ok){
    const error=new Error(data.error||`Ошибка API: ${response.status}`);
    error.status=response.status;throw error;
  }
  return data;
}
async function restoreSession(){
  if(!authState.token){
    authState.ready=true;renderHeader();return;
  }
  try{
    const data=await api("/api/auth/me");
    authState.user=data.user;
  }catch(error){
    if(error.status===401||error.status===403){
      authState.token="";localStorage.removeItem(AUTH_TOKEN_KEY);
    }else{
      toast("Не удалось проверить вход. Попробуйте обновить страницу.");
    }
  }finally{
    authState.ready=true;renderHeader();renderAccountModal();
  }
}
async function handleGoogleCredential(response){
  if(!response?.credential)return;
  setAuthMessage("Выполняется вход…");
  try{
    const data=await api("/api/auth/google",{
      method:"POST",
      body:JSON.stringify({credential:response.credential})
    });
    authState.token=data.token;
    authState.user=data.user;
    localStorage.setItem(AUTH_TOKEN_KEY,data.token);
    authState.ready=true;
    renderHeader();renderAccountModal();
    setAuthMessage("",true);
    toast(data.user.role==="owner"?"Вы вошли как владелец сайта":"Аккаунт создан. Вы вошли через Google");
  }catch(error){
    setAuthMessage(error.message||"Не удалось войти через Google");
  }
}
function initGoogleButton(){
  const target=$("#googleSignInButton");
  if(!target||!GOOGLE_CLIENT_ID)return;
  if(!window.google?.accounts?.id){
    setTimeout(initGoogleButton,250);return;
  }
  window.google.accounts.id.initialize({
    client_id:GOOGLE_CLIENT_ID,
    callback:handleGoogleCredential,
    auto_select:false,
    cancel_on_tap_outside:true
  });
  target.innerHTML="";
  window.google.accounts.id.renderButton(target,{
    type:"standard",
    theme:"filled_black",
    size:"large",
    text:"continue_with",
    shape:"pill",
    width:340,
    locale:"ru"
  });
}

$("#accountBtn")?.addEventListener("click",()=>{
  document.getElementById("nav")?.classList.remove("open");
  openAuth();
});
$("#authClose")?.addEventListener("click",closeAuth);
$("#authModal")?.addEventListener("click",e=>{if(e.target.id==="authModal")closeAuth()});
$("#logoutPublic")?.addEventListener("click",async()=>{
  try{if(authState.token)await api("/api/auth/logout",{method:"POST"})}catch{}
  authState.token="";authState.user=null;
  localStorage.removeItem(AUTH_TOKEN_KEY);
  renderHeader();renderAccountModal();closeAuth();
  window.google?.accounts?.id?.disableAutoSelect();
  toast("Вы вышли из аккаунта");
});

document.addEventListener("click",e=>{
  const main=e.target.closest(".main-play");
  if(main){tone(main,document.querySelector(".progress i"));return}
  const play=e.target.closest(".play,.preview-btn");
  if(play){tone(play);return}

  const download=e.target.closest(".download");
  if(download){
    e.preventDefault();
    if(!authState.user){
      openAuth();toast("Для скачивания войдите через Google");
      return;
    }
    toast("Доступ подтверждён. Сам файл подключим после настройки R2.");
  }
});

renderHeader();
restoreSession();
window.addEventListener("load",initGoogleButton);
