const CONFIG = window.NOIRWAVE_CONFIG || {};
const API_BASE = String(CONFIG.API_BASE || "").replace(/\/+$/, "");
const GOOGLE_CLIENT_ID = String(CONFIG.GOOGLE_CLIENT_ID || "");
const AUTH_TOKEN_KEY = "noirwave_auth_token";
const $ = selector => document.querySelector(selector);

const canvas = $("#particles");
const context = canvas.getContext("2d");
let particles = [];

function resizeParticles() {
  const density = devicePixelRatio || 1;
  canvas.width = innerWidth * density;
  canvas.height = innerHeight * density;
  canvas.style.width = innerWidth + "px";
  canvas.style.height = innerHeight + "px";
  context.setTransform(density, 0, 0, density, 0, 0);
  particles = Array.from({ length: Math.min(70, innerWidth / 18) }, () => ({
    x: Math.random() * innerWidth,
    y: Math.random() * innerHeight,
    radius: Math.random() * 1.3 + .25,
    velocity: Math.random() * .2 + .04
  }));
}

function animateParticles() {
  context.clearRect(0, 0, innerWidth, innerHeight);
  context.fillStyle = "rgba(255,255,255,.22)";
  particles.forEach(particle => {
    particle.y -= particle.velocity;
    if (particle.y < 0) particle.y = innerHeight;
    context.beginPath();
    context.arc(particle.x, particle.y, particle.radius, 0, 7);
    context.fill();
  });
  requestAnimationFrame(animateParticles);
}

addEventListener("resize", resizeParticles);
resizeParticles();
animateParticles();

$("#menu")?.addEventListener("click", () => $("#nav")?.classList.toggle("open"));

const revealObserver = new IntersectionObserver(entries => entries.forEach(entry => {
  if (entry.isIntersecting) entry.target.classList.add("show");
}), { threshold: .12 });
document.querySelectorAll(".reveal").forEach(element => revealObserver.observe(element));

const wave = $(".wave");
if (wave) {
  const waveContext = wave.getContext("2d");
  function resizeWave() {
    const density = devicePixelRatio || 1;
    wave.width = wave.clientWidth * density;
    wave.height = wave.clientHeight * density;
    waveContext.setTransform(density, 0, 0, density, 0, 0);
  }
  function drawWave(time = 0) {
    const width = wave.clientWidth;
    const height = wave.clientHeight;
    waveContext.clearRect(0, 0, width, height);
    waveContext.strokeStyle = "rgba(255,255,255,.65)";
    waveContext.lineWidth = 1.4;
    waveContext.beginPath();
    for (let x = 0; x < width; x += 1) {
      const y = height / 2 + Math.sin(x * .045 + time * .003) * 11 +
        Math.sin(x * .014 + time * .0017) * 18;
      x ? waveContext.lineTo(x, y) : waveContext.moveTo(x, y);
    }
    waveContext.stroke();
    requestAnimationFrame(drawWave);
  }
  resizeWave();
  addEventListener("resize", resizeWave);
  drawWave();
}

const authState = {
  token: localStorage.getItem(AUTH_TOKEN_KEY) || "",
  user: null,
  ready: false
};

const catalogState = {
  items: [],
  filter: "all",
  genre: "",
  bpm: ""
};

let currentAudio = null;
let currentPlayButton = null;
let currentPlayerId = "";
let playerVolume = Math.max(0, Math.min(1, Number(localStorage.getItem("noirwave_volume") || .8)));
let coversHidden = localStorage.getItem("noirwave_hide_track_covers") === "1";

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
}

function toast(text) {
  const element = $("#toast");
  if (!element) return;
  element.textContent = text;
  element.classList.remove("hidden");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => element.classList.add("hidden"), 3400);
}

function setAuthMessage(text = "", success = false) {
  const element = $("#authMessage");
  if (!element) return;
  element.textContent = text;
  element.classList.toggle("success", success);
}

function openAuth() {
  $("#authModal")?.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  renderAccountModal();
}

function closeAuth() {
  $("#authModal")?.classList.add("hidden");
  document.body.style.overflow = "";
}

function renderHeader() {
  const button = $("#accountBtn");
  const adminLink = $("#adminNav");
  if (button) {
    button.classList.toggle("loading", !authState.ready);
    button.textContent = authState.user ? authState.user.name : authState.ready ? "Войти" : "Проверка…";
  }
  if (adminLink) {
    adminLink.classList.toggle(
      "hidden",
      !authState.user || !["admin", "owner"].includes(authState.user.role)
    );
  }
  document.querySelectorAll("[data-download]").forEach(button => {
    button.classList.toggle("locked", !authState.user);
  });
}

function renderAccountModal() {
  const guest = $("#authGuestView");
  const account = $("#accountView");
  if (authState.user) {
    guest?.classList.add("hidden");
    account?.classList.remove("hidden");
    $("#accountName").textContent = authState.user.name;
    $("#accountEmail").textContent = authState.user.email;
    $("#accountRole").textContent = authState.user.role.toUpperCase();
    $("#accountAdminLink")?.classList.toggle(
      "hidden",
      !["admin", "owner"].includes(authState.user.role)
    );
    const avatar = $("#accountAvatar");
    if (avatar && authState.user.avatar_url) {
      avatar.src = authState.user.avatar_url;
      avatar.classList.remove("hidden");
    } else {
      avatar?.classList.add("hidden");
    }
  } else {
    account?.classList.add("hidden");
    guest?.classList.remove("hidden");
  }
}

async function api(path, options = {}) {
  if (!API_BASE) throw new Error("Не указан адрес API");
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (authState.token) headers.set("Authorization", `Bearer ${authState.token}`);
  const response = await fetch(API_BASE + path, { ...options, headers });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(data.error || `Ошибка API: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function restoreSession() {
  if (!authState.token) {
    authState.ready = true;
    renderHeader();
    return;
  }
  try {
    const data = await api("/api/auth/me");
    authState.user = data.user;
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      authState.token = "";
      localStorage.removeItem(AUTH_TOKEN_KEY);
    } else {
      toast("Не удалось проверить вход. Попробуйте обновить страницу.");
    }
  } finally {
    authState.ready = true;
    renderHeader();
    renderAccountModal();
  }
}

async function handleGoogleCredential(response) {
  if (!response?.credential) return;
  setAuthMessage("Выполняется вход…");
  try {
    const data = await api("/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential: response.credential })
    });
    authState.token = data.token;
    authState.user = data.user;
    localStorage.setItem(AUTH_TOKEN_KEY, data.token);
    authState.ready = true;
    renderHeader();
    renderAccountModal();
    setAuthMessage("", true);
    toast(data.user.role === "owner" ? "Вы вошли как владелец сайта" : "Вы вошли через Google");
  } catch (error) {
    setAuthMessage(error.message || "Не удалось войти через Google");
  }
}

function initGoogleButton() {
  const target = $("#googleSignInButton");
  if (!target || !GOOGLE_CLIENT_ID) return;
  if (!window.google?.accounts?.id) {
    setTimeout(initGoogleButton, 250);
    return;
  }
  window.google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleCredential,
    auto_select: false,
    cancel_on_tap_outside: true
  });
  target.innerHTML = "";
  window.google.accounts.id.renderButton(target, {
    type: "standard",
    theme: "filled_black",
    size: "large",
    text: "continue_with",
    shape: "pill",
    width: 340,
    locale: "ru"
  });
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "";
  const units = ["Б", "КБ", "МБ", "ГБ"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function miniWave() {
  return Array.from({ length: 24 }, (_, index) =>
    `<i style="height:${7 + ((index * 17) % 24)}px"></i>`).join("");
}

function packCard(item) {
  const coverStyle = item.cover_url
    ? `background-image:linear-gradient(rgba(0,0,0,.18),rgba(0,0,0,.38)),url('${esc(item.cover_url)}');background-size:cover;background-position:center`
    : "";
  return `<article class="pack">
    <div class="pack-cover" style="${coverStyle}">
      <span class="price">${esc(item.price || "FREE")}</span><h3>${esc(item.title)}</h3>
    </div>
    <div class="pack-body">
      <div class="pack-tags">
        ${item.genre ? `<span class="tag">${esc(item.genre)}</span>` : ""}
        ${item.bpm ? `<span class="tag">${esc(item.bpm)} BPM</span>` : ""}
        <span class="tag">PACK</span>
      </div>
      <div class="pack-info">
        <span>${item.files ? `${esc(item.files)} файлов` : "Sample Pack"}</span>
        <span>${item.key ? esc(item.key) : `${item.downloads} скачиваний`}</span>
      </div>
      <div class="pack-actions">
        <button class="preview-btn" data-play="${item.id}" ${item.preview_url ? "" : "disabled"}>▶ Preview</button>
        <button class="download" data-download="${item.id}">Скачать</button>
      </div>
    </div>
  </article>`;
}

function trackCard(item) {
  const coverStyle = item.cover_url
    ? `background-image:url('${esc(item.cover_url)}');background-size:cover;background-position:center`
    : "";
  return `<article class="track track-card" data-track="${item.id}">
    <div class="track-cover" style="${coverStyle}"></div>
    <div class="track-player">
      <div class="track-player-head">
        <button class="track-play" data-play="${item.id}" aria-label="Воспроизвести">▶</button>
        <div class="track-title">
          <h3>${esc(item.title)}</h3>
          <p>${esc(item.artist || "NOIRWAVE")}${item.genre ? " · " + esc(item.genre) : ""}</p>
        </div>
        <button class="track-download" data-download="${item.id}" title="Скачать трек">
          <b>↓</b><span data-download-count="${item.id}">${item.downloads}</span>
        </button>
      </div>
      <div class="track-timeline">
        <span data-current-time="${item.id}">0:00</span>
        <input data-seek="${item.id}" type="range" min="0" max="1000" value="0" aria-label="Позиция трека">
        <span data-duration="${item.id}">0:00</span>
      </div>
      <div class="track-player-foot">
        <button class="track-mute" data-mute="${item.id}" aria-label="Выключить звук">🔊</button>
        <input data-volume="${item.id}" type="range" min="0" max="1" step="0.01" value="${playerVolume}" aria-label="Громкость">
        <span data-listen-count="${item.id}">${item.listens} прослушиваний</span>
        ${item.bpm ? `<span>${esc(item.bpm)} BPM</span>` : ""}
      </div>
    </div>
  </article>`;
}

function previewRow(item) {
  const label = item.type === "pack" ? "Превью пака" : item.artist || "Трек";
  return `<div class="preview">
    <button class="play" data-play="${item.id}">▶</button>
    <div><strong>${esc(item.title)}</strong><br><span>${esc(label)}</span></div>
    <span class="hide-mobile">${item.bpm ? esc(item.bpm) + " BPM" : "—"}</span>
    <span class="hide-mobile">${item.key ? esc(item.key) : "—"}</span>
    <div class="mini-wave">${miniWave()}</div>
  </div>`;
}

function filteredPacks() {
  let packs = catalogState.items.filter(item => item.type === "pack");
  if (catalogState.filter === "free") {
    packs = packs.filter(item => String(item.price || "").toUpperCase() === "FREE" || item.price === "0");
  }
  if (catalogState.genre) {
    packs = packs.filter(item => item.genre.toLowerCase().includes(catalogState.genre.toLowerCase()));
  }
  if (catalogState.bpm) {
    const [min, max] = catalogState.bpm.split("-").map(Number);
    packs = packs.filter(item => {
      const bpm = Number(item.bpm);
      return bpm && bpm >= min && bpm <= max;
    });
  }
  return packs;
}

function renderCatalog() {
  const packs = filteredPacks();
  const tracks = catalogState.items.filter(item => item.type === "track");
  const playable = catalogState.items.filter(item =>
    item.type === "track" ? item.audio_url : item.preview_url
  );

  $("#dynamicPacks").innerHTML = packs.length
    ? packs.map(packCard).join("")
    : '<div class="catalog-empty">Пока ничего не опубликовано.</div>';
  $("#dynamicTracks").innerHTML = tracks.length
    ? tracks.map(trackCard).join("")
    : '<div class="catalog-empty">Пока ничего не опубликовано.</div>';
  $("#dynamicPreviews").innerHTML = playable.length
    ? playable.map(previewRow).join("")
    : '<div class="catalog-empty compact">Превью появятся после публикации первого пака или трека.</div>';

  const totalFiles = catalogState.items
    .filter(item => item.type === "pack")
    .reduce((sum, item) => sum + (Number.parseInt(item.files, 10) || 0), 0);
  $("#sampleStat").textContent = totalFiles;
  $("#packStat").textContent = catalogState.items.filter(item => item.type === "pack").length;
  $("#trackStat").textContent = tracks.length;

  renderFeatured(catalogState.items.find(item => item.type === "pack"));
  renderFreePack(catalogState.items.find(item =>
    item.type === "pack" &&
    (String(item.price || "").toUpperCase() === "FREE" || item.price === "0")
  ));
  updateCategoryCounts();
  applyTrackView();
  renderHeader();
}

function applyTrackView() {
  $("#dynamicTracks")?.classList.toggle("covers-hidden", coversHidden);
  const button = $("#trackViewToggle");
  if (button) button.textContent = coversHidden ? "Показать обложки" : "Скрыть обложки";
}

function renderFeatured(item) {
  const root = $("#featured");
  if (!root) return;
  if (!item) {
    root.classList.add("featured-empty");
    $("#featuredBadge").textContent = "КАТАЛОГ ГОТОВ";
    $("#featuredTitle").textContent = "Пока нет опубликованных паков";
    $("#featuredName").textContent = "Первый пак появится здесь";
    $("#featuredMeta").textContent = "Загрузите его через админку";
    $("#featuredPlay").disabled = true;
    return;
  }
  root.classList.remove("featured-empty");
  $("#featuredBadge").textContent = "NEW PACK";
  $("#featuredTitle").textContent = item.title;
  $("#featuredName").textContent = item.title;
  $("#featuredMeta").textContent = [
    item.files ? `${item.files} файлов` : "",
    item.genre,
    item.bpm ? `${item.bpm} BPM` : ""
  ].filter(Boolean).join(" · ");
  $("#featuredPlay").dataset.play = item.id;
  $("#featuredPlay").disabled = !item.preview_url;
  const art = root.querySelector(".art");
  if (item.cover_url) {
    art.style.backgroundImage =
      `linear-gradient(rgba(0,0,0,.28),rgba(0,0,0,.48)),url('${item.cover_url}')`;
    art.style.backgroundSize = "cover";
    art.style.backgroundPosition = "center";
  }
}

function renderFreePack(item) {
  const root = $("#freePack");
  if (!root) return;
  if (!item) {
    root.innerHTML = `<div class="weekly-copy">
      <p class="eyebrow">FREE DOWNLOADS</p>
      <h2>Пока пусто</h2>
      <p>Бесплатные паки появятся здесь после публикации через админку.</p>
    </div><div class="weekly-art weekly-empty"><strong>NOIRWAVE</strong></div>`;
    return;
  }
  root.innerHTML = `<div class="weekly-copy">
    <p class="eyebrow">FREE DOWNLOAD</p>
    <h2>${esc(item.title)}</h2>
    <p>${esc(item.description || "Бесплатный авторский Sample Pack.")}</p>
    <div class="actions">
      <button class="btn primary" data-download="${item.id}">Скачать бесплатно</button>
      <button class="btn ghost" data-play="${item.id}" ${item.preview_url ? "" : "disabled"}>Послушать превью</button>
    </div>
  </div><div class="weekly-art" style="${item.cover_url ? `background-image:linear-gradient(rgba(0,0,0,.2),rgba(0,0,0,.35)),url('${esc(item.cover_url)}');background-size:cover;background-position:center` : ""}">
    <div class="box3d"><strong>${esc(item.title)}</strong></div>
  </div>`;
}

function updateCategoryCounts() {
  document.querySelectorAll("[data-category]").forEach(element => {
    const category = element.dataset.category.toLowerCase();
    const count = catalogState.items.filter(item =>
      item.type === "pack" &&
      `${item.genre} ${item.title} ${item.description}`.toLowerCase().includes(category)
    ).length;
    element.querySelector("span").textContent = String(count).padStart(2, "0");
  });
}

async function loadCatalog() {
  try {
    const data = await api("/api/content");
    catalogState.items = Array.isArray(data.items) ? data.items : [];
    renderCatalog();
  } catch (error) {
    $("#dynamicPacks").innerHTML =
      `<div class="catalog-empty error">${esc(error.message || "Не удалось загрузить каталог")}</div>`;
    $("#dynamicTracks").innerHTML =
      '<div class="catalog-empty error">Треки временно недоступны.</div>';
    toast("Не удалось загрузить каталог");
  }
}

function findItem(id) {
  return catalogState.items.find(item => item.id === id);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function resetPlayerProgress(id) {
  if (!id) return;
  const seek = document.querySelector(`[data-seek="${CSS.escape(id)}"]`);
  const current = document.querySelector(`[data-current-time="${CSS.escape(id)}"]`);
  if (seek) seek.value = 0;
  if (current) current.textContent = "0:00";
}

function stopAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
  }
  if (currentPlayButton) {
    currentPlayButton.textContent = currentPlayButton.classList.contains("preview-btn")
      ? "▶ Preview" : "▶";
    currentPlayButton.classList.remove("playing");
  }
  resetPlayerProgress(currentPlayerId);
  currentAudio = null;
  currentPlayButton = null;
  currentPlayerId = "";
}

async function playItem(item, button) {
  if (currentPlayButton === button) {
    stopAudio();
    return;
  }
  stopAudio();
  const source = item.type === "track" ? item.audio_url : item.preview_url;
  if (!source) {
    toast("Для этого материала ещё нет аудиопревью");
    return;
  }
  currentAudio = new Audio(source);
  currentPlayButton = button;
  currentPlayerId = item.id;
  currentAudio.volume = playerVolume;
  button.textContent = "❚❚";
  button.classList.add("playing");
  const seek = document.querySelector(`[data-seek="${CSS.escape(item.id)}"]`);
  const currentTime = document.querySelector(`[data-current-time="${CSS.escape(item.id)}"]`);
  const duration = document.querySelector(`[data-duration="${CSS.escape(item.id)}"]`);
  const muteButton = document.querySelector(`[data-mute="${CSS.escape(item.id)}"]`);
  const volume = document.querySelector(`[data-volume="${CSS.escape(item.id)}"]`);
  if (volume) volume.value = playerVolume;
  if (muteButton) muteButton.textContent = playerVolume === 0 ? "🔇" : "🔊";
  currentAudio.addEventListener("loadedmetadata", () => {
    if (duration) duration.textContent = formatTime(currentAudio.duration);
  });
  currentAudio.addEventListener("timeupdate", () => {
    if (!currentAudio?.duration) return;
    if (seek) seek.value = Math.round(currentAudio.currentTime / currentAudio.duration * 1000);
    if (currentTime) currentTime.textContent = formatTime(currentAudio.currentTime);
  });
  currentAudio.addEventListener("ended", stopAudio, { once: true });
  currentAudio.addEventListener("error", () => {
    stopAudio();
    toast("Не удалось открыть аудиофайл");
  }, { once: true });
  try {
    await currentAudio.play();
    api(`/api/content/${item.id}/listen`, { method: "POST", body: "{}" }).then(() => {
      item.listens += 1;
      const counter = document.querySelector(`[data-listen-count="${CSS.escape(item.id)}"]`);
      if (counter) counter.textContent = `${item.listens} прослушиваний`;
    }).catch(() => {});
  } catch {
    stopAudio();
    toast("Браузер не разрешил воспроизведение");
  }
}

async function downloadItem(item) {
  if (!authState.user) {
    openAuth();
    toast("Для скачивания войдите через Google");
    return;
  }
  try {
    toast("Готовим защищённую ссылку…");
    const data = await api(`/api/content/${item.id}/download`, {
      method: "POST",
      body: "{}"
    });
    const anchor = document.createElement("a");
    anchor.href = data.url;
    anchor.download = data.filename || "";
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    item.downloads += 1;
    const counter = document.querySelector(`[data-download-count="${CSS.escape(item.id)}"]`);
    if (counter) counter.textContent = item.downloads;
  } catch (error) {
    if (error.status === 401) {
      authState.user = null;
      authState.token = "";
      localStorage.removeItem(AUTH_TOKEN_KEY);
      renderHeader();
      openAuth();
    }
    toast(error.message || "Не удалось начать скачивание");
  }
}

document.addEventListener("click", event => {
  const playButton = event.target.closest("[data-play]");
  if (playButton) {
    event.preventDefault();
    const item = findItem(playButton.dataset.play);
    if (item) playItem(item, playButton);
    return;
  }
  const muteButton = event.target.closest("[data-mute]");
  if (muteButton) {
    event.preventDefault();
    if (currentAudio && currentPlayerId === muteButton.dataset.mute) {
      currentAudio.muted = !currentAudio.muted;
      muteButton.textContent = currentAudio.muted || currentAudio.volume === 0 ? "🔇" : "🔊";
    }
    return;
  }
  const downloadButton = event.target.closest("[data-download]");
  if (downloadButton) {
    event.preventDefault();
    const item = findItem(downloadButton.dataset.download);
    if (item) downloadItem(item);
  }
});

document.addEventListener("input", event => {
  const volume = event.target.closest("[data-volume]");
  if (volume) {
    playerVolume = Number(volume.value);
    localStorage.setItem("noirwave_volume", String(playerVolume));
    document.querySelectorAll("[data-volume]").forEach(input => {
      if (input !== volume) input.value = playerVolume;
    });
    if (currentAudio) {
      currentAudio.volume = playerVolume;
      currentAudio.muted = false;
      const mute = document.querySelector(`[data-mute="${CSS.escape(currentPlayerId)}"]`);
      if (mute) mute.textContent = playerVolume === 0 ? "🔇" : "🔊";
    }
    return;
  }
  const seek = event.target.closest("[data-seek]");
  if (seek && currentAudio?.duration && currentPlayerId === seek.dataset.seek) {
    currentAudio.currentTime = Number(seek.value) / 1000 * currentAudio.duration;
  }
});

$("#trackViewToggle")?.addEventListener("click", () => {
  coversHidden = !coversHidden;
  localStorage.setItem("noirwave_hide_track_covers", coversHidden ? "1" : "0");
  applyTrackView();
});

document.querySelectorAll("[data-pack-filter]").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-pack-filter]").forEach(item => item.classList.remove("active"));
    button.classList.add("active");
    catalogState.filter = button.dataset.packFilter;
    renderCatalog();
  });
});

$("#genreFilter")?.addEventListener("change", event => {
  catalogState.genre = event.target.value;
  renderCatalog();
});
$("#bpmFilter")?.addEventListener("change", event => {
  catalogState.bpm = event.target.value;
  renderCatalog();
});

$("#accountBtn")?.addEventListener("click", () => {
  $("#nav")?.classList.remove("open");
  openAuth();
});
$("#authClose")?.addEventListener("click", closeAuth);
$("#authModal")?.addEventListener("click", event => {
  if (event.target.id === "authModal") closeAuth();
});
$("#logoutPublic")?.addEventListener("click", async () => {
  try {
    if (authState.token) await api("/api/auth/logout", { method: "POST" });
  } catch {}
  authState.token = "";
  authState.user = null;
  localStorage.removeItem(AUTH_TOKEN_KEY);
  renderHeader();
  renderAccountModal();
  closeAuth();
  window.google?.accounts?.id?.disableAutoSelect();
  toast("Вы вышли из аккаунта");
});

renderHeader();
restoreSession();
loadCatalog();
window.addEventListener("load", initGoogleButton);
