const CONFIG=window.NOIRWAVE_CONFIG||{};
const API_BASE=String(CONFIG.API_BASE||"").replace(/\/+$/,"");
const AUTH_TOKEN_KEY="noirwave_auth_token";
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];

const KEYS={packs:"noirwave_packs",tracks:"noirwave_tracks"};
let packs=safeJson(localStorage.getItem(KEYS.packs),[]);
let tracks=safeJson(localStorage.getItem(KEYS.tracks),[]);
let currentUser=null;

function safeJson(value,fallback){
  try{return JSON.parse(value)||fallback}catch{return fallback}
}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7)}
function esc(s=""){return String(s).replace(/[&<>"']/g,m=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
}[m]))}
function token(){return localStorage.getItem(AUTH_TOKEN_KEY)||""}
async function api(path,options={}){
  const headers=new Headers(options.headers||{});
  const sessionToken=token();
  if(sessionToken)headers.set("Authorization",`Bearer ${sessionToken}`);
  if(options.body&&!headers.has("Content-Type"))headers.set("Content-Type","application/json");
  const response=await fetch(API_BASE+path,{...options,headers});
  let data={};try{data=await response.json()}catch{}
  if(!response.ok){
    const error=new Error(data.error||`Ошибка API: ${response.status}`);
    error.status=response.status;throw error;
  }
  return data;
}
function deny(message){
  $("#accessMessage").textContent=message;
  $("#accessScreen").classList.remove("hidden");
  $("#app").classList.add("hidden");
}
function allow(){
  $("#accessScreen").classList.add("hidden");
  $("#app").classList.remove("hidden");
  $$(".owner-only").forEach(el=>el.classList.toggle("hidden",currentUser.role!=="owner"));
  $("#adminUserName").textContent=currentUser.name;
  $("#adminUserRole").textContent=currentUser.role.toUpperCase();
  render();
}
async function boot(){
  if(!token()){
    deny("Сначала войдите через Google на основном сайте.");
    return;
  }
  try{
    const data=await api("/api/auth/me");
    currentUser=data.user;
    if(!["admin","owner"].includes(currentUser.role)){
      deny("У этого аккаунта нет доступа к админке. Владелец сайта должен назначить роль admin.");
      return;
    }
    allow();
  }catch(error){
    if(error.status===401||error.status===403)localStorage.removeItem(AUTH_TOKEN_KEY);
    deny(error.message||"Не удалось проверить доступ.");
  }
}

$("#logoutBtn").addEventListener("click",async()=>{
  try{await api("/api/auth/logout",{method:"POST"})}catch{}
  localStorage.removeItem(AUTH_TOKEN_KEY);
  location.href="../index.html";
});

const titles={dashboard:"Панель управления",packs:"Sample Packs",tracks:"Треки",users:"Пользователи",settings:"Настройки"};
$$(".nav-item").forEach(btn=>btn.addEventListener("click",()=>{
  $$(".nav-item").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active");
  $$(".view").forEach(x=>x.classList.remove("active"));
  $("#"+btn.dataset.view+"View").classList.add("active");
  $("#viewTitle").textContent=titles[btn.dataset.view];
  $("#sidebar").classList.remove("open");
}));
$("#menuBtn").addEventListener("click",()=>$("#sidebar").classList.toggle("open"));

function openModal(id){
  $("#"+id).classList.remove("hidden");
  document.body.style.overflow="hidden";
}
function closeModals(){
  $$(".modal").forEach(m=>m.classList.add("hidden"));
  document.body.style.overflow="";
}
$$("[data-open]").forEach(b=>b.addEventListener("click",()=>openModal(b.dataset.open)));
$$("[data-close]").forEach(b=>b.addEventListener("click",closeModals));
$$(".modal").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)closeModals()}));

function previewFile(input,target){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    target.style.backgroundImage=`linear-gradient(rgba(0,0,0,.18),rgba(0,0,0,.18)),url("${e.target.result}")`;
    target.textContent="";
  };
  reader.readAsDataURL(file);
}
$("#packCover").addEventListener("change",e=>previewFile(e.target,$("#packCoverPreview")));
$("#trackCover").addEventListener("change",e=>previewFile(e.target,$("#trackCoverPreview")));

function fileName(selector){return $(selector).files[0]?.name||""}
function bgData(target){
  const value=target.style.backgroundImage;
  const match=value.match(/url\(["']?(.+?)["']?\)/);
  return match?match[1]:"";
}
function resetPreview(target,text){
  target.style.backgroundImage="";
  target.innerHTML=`<span>${text}</span>`;
}
function save(){
  try{
    localStorage.setItem(KEYS.packs,JSON.stringify(packs));
    localStorage.setItem(KEYS.tracks,JSON.stringify(tracks));
  }catch{
    alert("Браузеру не хватило места для сохранения изображения. Выбери обложку меньшего размера.");
  }
  render();
}

$("#packForm").addEventListener("submit",e=>{
  e.preventDefault();
  const id=$("#packId").value||uid();
  const old=packs.find(x=>x.id===id)||{};
  const item={
    id,
    title:$("#packTitle").value.trim(),
    price:$("#packPrice").value.trim()||"FREE",
    genre:$("#packGenre").value.trim(),
    bpm:$("#packBpm").value.trim(),
    key:$("#packKey").value.trim(),
    files:$("#packFiles").value.trim(),
    description:$("#packDescription").value.trim(),
    cover:bgData($("#packCoverPreview"))||old.cover||"",
    previewName:fileName("#packPreview")||old.previewName||"",
    zipName:fileName("#packZip")||old.zipName||"",
    createdAt:old.createdAt||Date.now()
  };
  packs=packs.filter(x=>x.id!==id);packs.unshift(item);
  save();e.target.reset();$("#packId").value="";
  $("#packModalTitle").textContent="Добавить Sample Pack";
  resetPreview($("#packCoverPreview"),"Предпросмотр обложки");
  closeModals();
});

$("#trackForm").addEventListener("submit",e=>{
  e.preventDefault();
  const id=$("#trackId").value||uid();
  const old=tracks.find(x=>x.id===id)||{};
  const item={
    id,
    title:$("#trackTitle").value.trim(),
    artist:$("#trackArtist").value.trim()||"NOIRWAVE",
    genre:$("#trackGenre").value.trim(),
    bpm:$("#trackBpm").value.trim(),
    description:$("#trackDescription").value.trim(),
    cover:bgData($("#trackCoverPreview"))||old.cover||"",
    audioName:fileName("#trackAudio")||old.audioName||"",
    createdAt:old.createdAt||Date.now()
  };
  tracks=tracks.filter(x=>x.id!==id);tracks.unshift(item);
  save();e.target.reset();$("#trackId").value="";
  $("#trackModalTitle").textContent="Добавить трек";
  resetPreview($("#trackCoverPreview"),"Предпросмотр обложки");
  closeModals();
});

function row(item,type){
  const isPack=type==="pack";
  return `<article class="content-row">
    <div class="thumb" style="${item.cover?`background-image:url('${item.cover}')`:""}"></div>
    <div><h4>${esc(item.title)}</h4><p>${isPack?esc(item.description||"Sample Pack"):esc(item.artist)}</p></div>
    <div class="meta"><span>${esc(item.genre||"Без жанра")}${item.bpm?" · "+esc(item.bpm)+" BPM":""}</span></div>
    <div class="meta"><span>${isPack?esc(item.price):esc(item.audioName||"MP3 не выбран")}</span></div>
    <div class="row-actions">
      <button onclick="editItem('${type}','${item.id}')">Редактировать</button>
      <button class="delete" onclick="deleteItem('${type}','${item.id}')">Удалить</button>
    </div>
  </article>`;
}
function render(){
  $("#packCount").textContent=packs.length;
  $("#trackCount").textContent=tracks.length;
  $("#packsTable").innerHTML=packs.length?packs.map(x=>row(x,"pack")).join(""):'<div class="empty-state">Паков пока нет. Добавь первый тестовый пак.</div>';
  $("#tracksTable").innerHTML=tracks.length?tracks.map(x=>row(x,"track")).join(""):'<div class="empty-state">Треков пока нет. Добавь первый тестовый трек.</div>';

  const all=[
    ...packs.map(x=>({...x,type:"Sample Pack"})),
    ...tracks.map(x=>({...x,type:"Трек"}))
  ].sort((a,b)=>b.createdAt-a.createdAt).slice(0,4);

  $("#recentContent").innerHTML=all.length?all.map(x=>`<div class="content-row">
    <div class="thumb" style="${x.cover?`background-image:url('${x.cover}')`:""}"></div>
    <div><h4>${esc(x.title)}</h4><p>${x.type}</p></div>
    <div class="meta"><span>${esc(x.genre||"Без жанра")}</span></div><div class="meta"></div><div></div>
  </div>`).join(""):"Пока ничего не добавлено.";

  if(currentUser?.role==="owner"){
    $("#usersTable").innerHTML='<div class="empty-state">Вход владельца подтверждён через Google и D1. Общий список пользователей и выдачу роли admin подключим следующим шагом.</div>';
  }
}
window.deleteItem=(type,id)=>{
  if(!confirm("Удалить этот материал?"))return;
  if(type==="pack")packs=packs.filter(x=>x.id!==id);
  else tracks=tracks.filter(x=>x.id!==id);
  save();
};
window.editItem=(type,id)=>{
  if(type==="pack"){
    const item=packs.find(x=>x.id===id);if(!item)return;
    $("#packId").value=item.id;$("#packTitle").value=item.title;$("#packPrice").value=item.price;
    $("#packGenre").value=item.genre;$("#packBpm").value=item.bpm;$("#packKey").value=item.key;
    $("#packFiles").value=item.files;$("#packDescription").value=item.description;
    if(item.cover){$("#packCoverPreview").style.backgroundImage=`url('${item.cover}')`;$("#packCoverPreview").textContent=""}
    $("#packModalTitle").textContent="Редактировать Sample Pack";openModal("packModal");
  }else{
    const item=tracks.find(x=>x.id===id);if(!item)return;
    $("#trackId").value=item.id;$("#trackTitle").value=item.title;$("#trackArtist").value=item.artist;
    $("#trackGenre").value=item.genre;$("#trackBpm").value=item.bpm;$("#trackDescription").value=item.description;
    if(item.cover){$("#trackCoverPreview").style.backgroundImage=`url('${item.cover}')`;$("#trackCoverPreview").textContent=""}
    $("#trackModalTitle").textContent="Редактировать трек";openModal("trackModal");
  }
};

boot();
