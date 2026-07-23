const CONFIG = window.NOIRWAVE_CONFIG || {};
const API_BASE = String(CONFIG.API_BASE || "").replace(/\/+$/, "");
const AUTH_TOKEN_KEY = "noirwave_auth_token";
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

let items = [];
let users = [];
let currentUser = null;
let busy = false;
let siteSettings = { project_name: "NOIRWAVE", contact_email: "", currency: "EUR" };

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
}

function adminToast(text, isError = false) {
  const element = $("#adminToast");
  if (!element) return;
  element.textContent = text;
  element.classList.toggle("error", isError);
  element.classList.remove("hidden");
  clearTimeout(window.__adminToastTimer);
  window.__adminToastTimer = setTimeout(() => element.classList.add("hidden"), 4200);
}

function token() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || "";
}

async function api(path, options = {}) {
  if (!API_BASE) throw new Error("Не указан адрес API");
  const headers = new Headers(options.headers || {});
  const sessionToken = token();
  if (sessionToken) headers.set("Authorization", `Bearer ${sessionToken}`);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
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

function deny(message) {
  $("#accessMessage").textContent = message;
  $("#accessScreen").classList.remove("hidden");
  $("#app").classList.add("hidden");
}

function allow() {
  $("#accessScreen").classList.add("hidden");
  $("#app").classList.remove("hidden");
  $$(".owner-only").forEach(element => element.classList.toggle("hidden", currentUser.role !== "owner"));
  $("#adminUserName").textContent = currentUser.name;
  $("#adminUserRole").textContent = currentUser.role.toUpperCase();
}

async function boot() {
  if (!token()) {
    deny("Сначала войдите через Google на основном сайте.");
    return;
  }
  try {
    const data = await api("/api/auth/me");
    currentUser = data.user;
    if (!["admin", "owner"].includes(currentUser.role)) {
      deny("У этого аккаунта нет доступа к админке. Владелец сайта должен назначить роль admin.");
      return;
    }
    allow();
    await Promise.all([loadContent(), loadSettings()]);
    if (currentUser.role === "owner") loadUsers();
    setupStorage();
  } catch (error) {
    if (error.status === 401 || error.status === 403) localStorage.removeItem(AUTH_TOKEN_KEY);
    deny(error.message || "Не удалось проверить доступ.");
  }
}

$("#logoutBtn").addEventListener("click", async () => {
  try { await api("/api/auth/logout", { method: "POST" }); } catch {}
  localStorage.removeItem(AUTH_TOKEN_KEY);
  location.href = "../index.html";
});

const titles = {
  dashboard: "Панель управления",
  packs: "Sample Packs",
  tracks: "Треки",
  users: "Пользователи",
  settings: "Настройки"
};

$$(".nav-item").forEach(button => button.addEventListener("click", () => {
  $$(".nav-item").forEach(item => item.classList.remove("active"));
  button.classList.add("active");
  $$(".view").forEach(view => view.classList.remove("active"));
  $("#" + button.dataset.view + "View").classList.add("active");
  $("#viewTitle").textContent = titles[button.dataset.view];
  $("#sidebar").classList.remove("open");
  if (button.dataset.view === "users" && currentUser?.role === "owner") loadUsers();
}));

$("#menuBtn").addEventListener("click", () => $("#sidebar").classList.toggle("open"));

function openModal(id) {
  $("#" + id).classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeModals() {
  if (busy) return;
  $$(".modal").forEach(modal => modal.classList.add("hidden"));
  document.body.style.overflow = "";
}

$$("[data-open]").forEach(button => button.addEventListener("click", () => {
  resetForm(button.dataset.open === "packModal" ? "pack" : "track");
  openModal(button.dataset.open);
}));
$$("[data-close]").forEach(button => button.addEventListener("click", closeModals));
$$(".modal").forEach(modal => modal.addEventListener("click", event => {
  if (event.target === modal) closeModals();
}));

function previewFile(input, target) {
  const file = input.files[0];
  if (!file) return;
  if (target.dataset.objectUrl) URL.revokeObjectURL(target.dataset.objectUrl);
  const objectUrl = URL.createObjectURL(file);
  target.dataset.objectUrl = objectUrl;
  target.style.backgroundImage =
    `linear-gradient(rgba(0,0,0,.18),rgba(0,0,0,.18)),url("${objectUrl}")`;
  target.textContent = "";
}

$("#packCover").addEventListener("change", event => previewFile(event.target, $("#packCoverPreview")));
$("#trackCover").addEventListener("change", event => previewFile(event.target, $("#trackCoverPreview")));

function resetPreview(target, text) {
  if (target.dataset.objectUrl) URL.revokeObjectURL(target.dataset.objectUrl);
  target.dataset.objectUrl = "";
  target.style.backgroundImage = "";
  target.innerHTML = `<span>${text}</span>`;
}

function resetForm(type) {
  const isPack = type === "pack";
  const form = isPack ? $("#packForm") : $("#trackForm");
  form.reset();
  $(isPack ? "#packId" : "#trackId").value = "";
  $(isPack ? "#packModalTitle" : "#trackModalTitle").textContent =
    isPack ? "Добавить Sample Pack" : "Добавить трек";
  resetPreview(
    $(isPack ? "#packCoverPreview" : "#trackCoverPreview"),
    "Предпросмотр обложки"
  );
  setUploadState(type, "", 0, false);
}

function setUploadState(type, text, progress = 0, error = false) {
  const root = $("#" + type + "UploadState");
  if (!root) return;
  root.classList.toggle("hidden", !text);
  root.classList.toggle("error", error);
  root.querySelector("span").textContent = text;
  root.querySelector("i").style.width = `${Math.max(0, Math.min(progress, 100))}%`;
}

async function setupStorage() {
  const status = $("#storageStatus");
  if (status) status.textContent = "Проверяем подключение…";
  try {
    const data = await api("/api/admin/storage/setup", { method: "POST", body: "{}" });
    if (status) status.textContent = `Подключено: ${data.bucket}`;
    $("#storageDot")?.classList.add("ok");
  } catch (error) {
    if (status) status.textContent = error.message;
    $("#storageDot")?.classList.add("error");
  }
}

$("#storageSetupBtn")?.addEventListener("click", setupStorage);

async function loadSettings() {
  try {
    const data = await api("/api/settings");
    siteSettings = data.settings || siteSettings;
    $("#settingsProjectName").value = siteSettings.project_name || "NOIRWAVE";
    $("#settingsContactEmail").value = siteSettings.contact_email || "";
    $("#settingsCurrency").value = siteSettings.currency || "EUR";
    $("#packPrice").placeholder = siteSettings.currency === "RUB"
      ? "FREE или 900 ₽"
      : siteSettings.currency === "USD"
        ? "FREE или $9"
        : "FREE или €9";
  } catch (error) {
    $("#settingsStatus").textContent = error.message || "Не удалось загрузить настройки";
    $("#settingsStatus").classList.add("error");
  }
}

$("#settingsForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  const button = $("#saveSettingsBtn");
  const status = $("#settingsStatus");
  button.disabled = true;
  button.textContent = "Сохраняем…";
  status.classList.remove("success", "error");
  try {
    const data = await api("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify({
        project_name: $("#settingsProjectName").value.trim(),
        contact_email: $("#settingsContactEmail").value.trim(),
        currency: $("#settingsCurrency").value
      })
    });
    siteSettings = data.settings;
    status.textContent = "Настройки сохранены и уже доступны на сайте.";
    status.classList.add("success");
    adminToast("Настройки проекта сохранены");
  } catch (error) {
    status.textContent = error.message || "Не удалось сохранить настройки";
    status.classList.add("error");
    adminToast(status.textContent, true);
  } finally {
    button.disabled = false;
    button.textContent = "Сохранить настройки";
  }
});

async function loadContent() {
  try {
    const data = await api("/api/admin/content");
    items = Array.isArray(data.items) ? data.items : [];
    render();
  } catch (error) {
    adminToast(error.message || "Не удалось загрузить каталог", true);
    throw error;
  }
}

function packItems() {
  return items.filter(item => item.type === "pack");
}

function trackItems() {
  return items.filter(item => item.type === "track");
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "—";
  const units = ["Б", "КБ", "МБ", "ГБ"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function row(item) {
  const isPack = item.type === "pack";
  const mainAsset = isPack ? item.assets?.archive : item.assets?.audio;
  return `<article class="content-row">
    <div class="thumb" style="${item.cover_url ? `background-image:url('${esc(item.cover_url)}')` : ""}"></div>
    <div><h4>${esc(item.title)}</h4><p>${esc(item.description || (isPack ? "Sample Pack" : item.artist || "Трек"))}</p></div>
    <div class="meta">
      <span>${esc(item.genre || "Без жанра")}${item.bpm ? " · " + esc(item.bpm) + " BPM" : ""}</span>
      <span>${item.listens} прослушиваний</span>
    </div>
    <div class="meta">
      <span>${esc(mainAsset?.name || "Файл не выбран")}</span>
      <span>${formatBytes(mainAsset?.size)} · ${item.downloads} скачиваний</span>
    </div>
    <div class="row-actions">
      <button onclick="editItem('${item.type}','${item.id}')">Редактировать</button>
      <button class="delete" onclick="deleteItem('${item.id}')">Удалить</button>
    </div>
  </article>`;
}

function render() {
  const packs = packItems();
  const tracks = trackItems();
  $("#packCount").textContent = packs.length;
  $("#trackCount").textContent = tracks.length;
  $("#packsTable").innerHTML = packs.length
    ? packs.map(row).join("")
    : '<div class="empty-state">Паков пока нет. Добавьте первый настоящий пак.</div>';
  $("#tracksTable").innerHTML = tracks.length
    ? tracks.map(row).join("")
    : '<div class="empty-state">Треков пока нет. Добавьте первый настоящий трек.</div>';

  const recent = [...items].sort((a, b) => b.created_at - a.created_at).slice(0, 4);
  $("#recentContent").innerHTML = recent.length ? recent.map(item => `<div class="content-row">
    <div class="thumb" style="${item.cover_url ? `background-image:url('${esc(item.cover_url)}')` : ""}"></div>
    <div><h4>${esc(item.title)}</h4><p>${item.type === "pack" ? "Sample Pack" : "Трек"}</p></div>
    <div class="meta"><span>${esc(item.genre || "Без жанра")}</span></div>
    <div class="meta"><span>${item.listens} прослушиваний</span></div><div></div>
  </div>`).join("") : '<div class="empty-state">Пока ничего не опубликовано.</div>';
}

async function presignAndUpload(file, kind, onProgress) {
  const data = await api("/api/admin/uploads/presign", {
    method: "POST",
    body: JSON.stringify({
      kind,
      name: file.name,
      mime: file.type || "application/octet-stream",
      size: file.size
    })
  });

  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", data.upload.url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`B2 отклонил файл: ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error(
      "Не удалось загрузить файл в B2. Нажмите «Проверить B2» в настройках и повторите."
    ));
    xhr.send(file);
  });

  return {
    key: data.upload.key,
    name: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size
  };
}

function syncSafeSize(bytes, offset) {
  return ((bytes[offset] & 0x7f) << 21) |
    ((bytes[offset + 1] & 0x7f) << 14) |
    ((bytes[offset + 2] & 0x7f) << 7) |
    (bytes[offset + 3] & 0x7f);
}

function unsignedSize(bytes, offset) {
  return ((bytes[offset] << 24) >>> 0) +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3];
}

function findDescriptionEnd(bytes, offset, end, encoding) {
  if (encoding === 1 || encoding === 2) {
    for (let index = offset; index + 1 < end; index += 2) {
      if (bytes[index] === 0 && bytes[index + 1] === 0) return index + 2;
    }
    return end;
  }
  for (let index = offset; index < end; index += 1) {
    if (bytes[index] === 0) return index + 1;
  }
  return end;
}

function embeddedCoverFile(bytes, start, end, mime, sourceName) {
  if (start >= end || !mime.startsWith("image/")) return null;
  const normalizedMime = mime === "image/jpg" ? "image/jpeg" : mime;
  const extension = normalizedMime === "image/png" ? "png" : "jpg";
  const baseName = sourceName.replace(/\.[^.]+$/, "") || "track";
  const imageBytes = bytes.slice(start, end);
  return new File([imageBytes], `${baseName}-embedded-cover.${extension}`, {
    type: normalizedMime
  });
}

async function extractEmbeddedCover(audioFile) {
  if (!audioFile || !/(\.mp3$|audio\/mpeg)/i.test(`${audioFile.name} ${audioFile.type}`)) {
    return null;
  }
  const header = new Uint8Array(await audioFile.slice(0, 10).arrayBuffer());
  if (header.length < 10 || String.fromCharCode(...header.slice(0, 3)) !== "ID3") return null;

  const version = header[3];
  const tagSize = syncSafeSize(header, 6);
  if (![2, 3, 4].includes(version) || tagSize <= 0) return null;
  const readSize = Math.min(audioFile.size, tagSize + 10);
  const bytes = new Uint8Array(await audioFile.slice(0, readSize).arrayBuffer());
  const tagEnd = Math.min(bytes.length, tagSize + 10);
  let offset = 10;

  if ((header[5] & 0x40) && version >= 3 && offset + 4 <= tagEnd) {
    const extendedSize = version === 4
      ? syncSafeSize(bytes, offset)
      : unsignedSize(bytes, offset);
    offset += version === 3 ? extendedSize + 4 : extendedSize;
  }

  while (offset < tagEnd) {
    if (version === 2) {
      if (offset + 6 > tagEnd) break;
      const frameId = String.fromCharCode(...bytes.slice(offset, offset + 3));
      const frameSize = (bytes[offset + 3] << 16) | (bytes[offset + 4] << 8) | bytes[offset + 5];
      const frameStart = offset + 6;
      const frameEnd = Math.min(tagEnd, frameStart + frameSize);
      if (!frameId.trim() || frameSize <= 0 || frameEnd <= frameStart) break;
      if (frameId === "PIC" && frameStart + 5 < frameEnd) {
        const encoding = bytes[frameStart];
        const format = String.fromCharCode(...bytes.slice(frameStart + 1, frameStart + 4)).toLowerCase();
        const mime = format === "png" ? "image/png" : "image/jpeg";
        const imageStart = findDescriptionEnd(bytes, frameStart + 5, frameEnd, encoding);
        return embeddedCoverFile(bytes, imageStart, frameEnd, mime, audioFile.name);
      }
      offset = frameEnd;
      continue;
    }

    if (offset + 10 > tagEnd) break;
    const frameId = String.fromCharCode(...bytes.slice(offset, offset + 4));
    const frameSize = version === 4
      ? syncSafeSize(bytes, offset + 4)
      : unsignedSize(bytes, offset + 4);
    const frameStart = offset + 10;
    const frameEnd = Math.min(tagEnd, frameStart + frameSize);
    if (!frameId.trim() || frameSize <= 0 || frameEnd <= frameStart) break;
    if (frameId === "APIC") {
      const encoding = bytes[frameStart];
      let mimeEnd = frameStart + 1;
      while (mimeEnd < frameEnd && bytes[mimeEnd] !== 0) mimeEnd += 1;
      const mime = new TextDecoder("latin1").decode(bytes.slice(frameStart + 1, mimeEnd));
      const descriptionStart = mimeEnd + 2;
      const imageStart = findDescriptionEnd(bytes, descriptionStart, frameEnd, encoding);
      return embeddedCoverFile(bytes, imageStart, frameEnd, mime, audioFile.name);
    }
    offset = frameEnd;
  }
  return null;
}

async function uploadFormFiles(type) {
  const isPack = type === "pack";
  let trackCover = isPack ? null : $("#trackCover").files[0];
  const trackAudio = isPack ? null : $("#trackAudio").files[0];
  if (!isPack && !trackCover && trackAudio) {
    setUploadState(type, "Проверяем встроенную обложку аудиофайла…", 2);
    try {
      trackCover = await extractEmbeddedCover(trackAudio);
      if (trackCover) {
        previewFile({ files: [trackCover] }, $("#trackCoverPreview"));
        adminToast("Встроенная обложка найдена и будет использована");
      }
    } catch {
      trackCover = null;
    }
  }

  const definitions = isPack ? [
    ["cover", $("#packCover").files[0], "обложка"],
    ["preview", $("#packPreview").files[0], "аудиопревью"],
    ["archive", $("#packZip").files[0], "архив"]
  ] : [
    ["cover", trackCover, "обложка"],
    ["audio", trackAudio, "аудиофайл"]
  ];
  const selected = definitions.filter(([, file]) => file);
  const assets = {};
  for (let index = 0; index < selected.length; index += 1) {
    const [kind, file, label] = selected[index];
    setUploadState(type, `Загружается ${label}: ${file.name}`, index / selected.length * 100);
    assets[kind] = await presignAndUpload(file, kind, fileProgress => {
      const overall = ((index + fileProgress / 100) / selected.length) * 100;
      setUploadState(type, `Загружается ${label}: ${file.name}`, overall);
    });
  }
  return assets;
}

async function submitContent(type, form) {
  if (busy) return;
  const isPack = type === "pack";
  const id = $(isPack ? "#packId" : "#trackId").value;
  const existing = id ? items.find(item => item.id === id) : null;

  if (isPack && !existing && !$("#packZip").files[0]) {
    adminToast("Выберите ZIP, RAR или 7Z-архив пака", true);
    return;
  }
  if (!isPack && !existing && !$("#trackAudio").files[0]) {
    adminToast("Выберите аудиофайл трека", true);
    return;
  }

  busy = true;
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = "Загрузка…";

  try {
    const assets = await uploadFormFiles(type);
    setUploadState(type, "Сохраняем карточку в каталоге…", 100);
    const payload = isPack ? {
      type,
      title: $("#packTitle").value.trim(),
      price: $("#packPrice").value.trim() || "FREE",
      genre: $("#packGenre").value.trim(),
      bpm: $("#packBpm").value.trim(),
      key: $("#packKey").value.trim(),
      files: $("#packFiles").value.trim(),
      description: $("#packDescription").value.trim(),
      assets
    } : {
      type,
      title: $("#trackTitle").value.trim(),
      artist: $("#trackArtist").value.trim() || "NOIRWAVE",
      genre: $("#trackGenre").value.trim(),
      bpm: $("#trackBpm").value.trim(),
      description: $("#trackDescription").value.trim(),
      assets
    };

    const data = await api(id ? `/api/admin/content/${id}` : "/api/admin/content", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
    items = [data.item, ...items.filter(item => item.id !== data.item.id)];
    render();
    busy = false;
    closeModals();
    resetForm(type);
    adminToast(id ? "Изменения опубликованы" : "Материал опубликован на сайте");
  } catch (error) {
    setUploadState(type, error.message || "Ошибка загрузки", 0, true);
    adminToast(error.message || "Не удалось опубликовать материал", true);
  } finally {
    busy = false;
    submitButton.disabled = false;
    submitButton.textContent = "Опубликовать";
  }
}

$("#packForm").addEventListener("submit", event => {
  event.preventDefault();
  submitContent("pack", event.currentTarget);
});
$("#trackForm").addEventListener("submit", event => {
  event.preventDefault();
  submitContent("track", event.currentTarget);
});

window.deleteItem = async id => {
  const item = items.find(entry => entry.id === id);
  if (!item || !confirm(`Удалить «${item.title}» вместе с файлами из B2?`)) return;
  try {
    await api(`/api/admin/content/${id}`, { method: "DELETE" });
    items = items.filter(entry => entry.id !== id);
    render();
    adminToast("Материал и его файлы удалены");
  } catch (error) {
    adminToast(error.message || "Не удалось удалить материал", true);
  }
};

window.editItem = (type, id) => {
  const item = items.find(entry => entry.id === id && entry.type === type);
  if (!item) return;
  const isPack = type === "pack";
  resetForm(type);

  if (isPack) {
    $("#packId").value = item.id;
    $("#packTitle").value = item.title;
    $("#packPrice").value = item.price;
    $("#packGenre").value = item.genre;
    $("#packBpm").value = item.bpm;
    $("#packKey").value = item.key;
    $("#packFiles").value = item.files;
    $("#packDescription").value = item.description;
    $("#packModalTitle").textContent = "Редактировать Sample Pack";
    if (item.cover_url) {
      $("#packCoverPreview").style.backgroundImage = `url('${item.cover_url}')`;
      $("#packCoverPreview").textContent = "";
    }
    setUploadState("pack", `Текущий архив: ${item.assets?.archive?.name || "не выбран"}`, 0);
    openModal("packModal");
  } else {
    $("#trackId").value = item.id;
    $("#trackTitle").value = item.title;
    $("#trackArtist").value = item.artist;
    $("#trackGenre").value = item.genre;
    $("#trackBpm").value = item.bpm;
    $("#trackDescription").value = item.description;
    $("#trackModalTitle").textContent = "Редактировать трек";
    if (item.cover_url) {
      $("#trackCoverPreview").style.backgroundImage = `url('${item.cover_url}')`;
      $("#trackCoverPreview").textContent = "";
    }
    setUploadState("track", `Текущий аудиофайл: ${item.assets?.audio?.name || "не выбран"}`, 0);
    openModal("trackModal");
  }
};

function userInitial(name, email) {
  return String(name || email || "?").trim().charAt(0).toUpperCase();
}

function formatDate(timestamp) {
  if (!timestamp) return "—";
  return new Date(Number(timestamp) * 1000).toLocaleDateString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric"
  });
}

function renderUsers() {
  const root = $("#usersTable");
  if (!root) return;
  if (currentUser?.role !== "owner") {
    root.innerHTML = '<div class="empty-state">Этот раздел доступен только владельцу сайта.</div>';
    return;
  }
  $("#usersCount").textContent = users.length;
  if (!users.length) {
    root.innerHTML = '<div class="empty-state">В базе пока нет пользователей.</div>';
    return;
  }

  root.innerHTML = users.map(user => {
    const isOwner = user.role === "owner";
    const isCurrent = user.id === currentUser.id;
    const avatar = user.avatar_url
      ? `<img class="user-avatar" src="${esc(user.avatar_url)}" alt="">`
      : `<div class="user-avatar user-avatar-fallback">${esc(userInitial(user.name, user.email))}</div>`;
    const roleControl = isOwner
      ? '<span class="role-label role-owner">OWNER</span>'
      : `<select aria-label="Роль пользователя" onchange="changeUserRole('${user.id}',this.value,this)">
          <option value="user" ${user.role === "user" ? "selected" : ""}>user</option>
          <option value="admin" ${user.role === "admin" ? "selected" : ""}>admin</option>
        </select>`;
    return `<article class="real-user-row ${isCurrent ? "current" : ""}">
      ${avatar}
      <div class="user-main"><h4>${esc(user.name)}${isCurrent ? " · вы" : ""}</h4><p>${esc(user.email)}</p></div>
      <div class="user-meta created-cell"><span>Регистрация</span><span>${formatDate(user.created_at)}</span></div>
      <div class="role-control"><span>Роль</span>${roleControl}</div>
      <div class="user-meta">
        <span class="user-status ${user.status === "blocked" ? "blocked" : ""}">${user.status === "blocked" ? "Заблокирован" : "Активен"}</span>
        <span>${user.email_verified ? "Почта подтверждена" : "Почта не подтверждена"}</span>
      </div>
    </article>`;
  }).join("");
}

async function loadUsers() {
  const root = $("#usersTable");
  if (currentUser?.role !== "owner" || !root) return;
  root.innerHTML = '<div class="empty-state loading-line">Загружаем пользователей из D1…</div>';
  try {
    const data = await api("/api/admin/users");
    users = Array.isArray(data.users) ? data.users : [];
    renderUsers();
  } catch (error) {
    root.innerHTML = `<div class="empty-state">${esc(error.message || "Не удалось загрузить пользователей")}</div>`;
    adminToast(error.message || "Не удалось загрузить пользователей", true);
  }
}

window.changeUserRole = async (userId, newRole, select) => {
  const user = users.find(item => item.id === userId);
  if (!user) return;
  const oldRole = user.role;
  const label = newRole === "admin" ? "администратором" : "обычным пользователем";
  if (!confirm(`Сделать ${user.name} ${label}?`)) {
    select.value = oldRole;
    return;
  }
  select.disabled = true;
  try {
    const data = await api("/api/admin/users/role", {
      method: "POST",
      body: JSON.stringify({ user_id: userId, role: newRole })
    });
    users = users.map(item => item.id === userId ? data.user : item);
    renderUsers();
    adminToast(newRole === "admin"
      ? `${data.user.name} теперь администратор`
      : `У ${data.user.name} убран доступ к админке`);
  } catch (error) {
    select.disabled = false;
    select.value = oldRole;
    adminToast(error.message || "Не удалось изменить роль", true);
  }
};

$("#refreshUsersBtn")?.addEventListener("click", loadUsers);

boot();
