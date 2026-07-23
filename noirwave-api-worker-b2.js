const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const PRESIGN_TTL_SECONDS = 15 * 60;
const MAX_SINGLE_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;

let schemaReady;

export default {
  async fetch(request, env, ctx) {
    try {
      await ensureSchema(env);
      return await route(request, env, ctx);
    } catch (error) {
      if (Number(error?.status || 500) >= 500) console.error(error);
      return json(
        { error: error?.message || "Внутренняя ошибка сервера" },
        Number(error?.status || 500),
        request,
        env
      );
    }
  }
};

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }

  if (request.method === "GET" && path === "/api/health") {
    return json({ ok: true, storage: "Backblaze B2", database: "D1" }, 200, request, env);
  }

  if (request.method === "POST" && path === "/api/auth/google") {
    return googleLogin(request, env);
  }
  if (request.method === "GET" && path === "/api/auth/me") {
    const user = await requireUser(request, env);
    return json({ user }, 200, request, env);
  }
  if (request.method === "POST" && path === "/api/auth/logout") {
    await logout(request, env);
    return json({ ok: true }, 200, request, env);
  }

  if (request.method === "GET" && path === "/api/content") {
    return listPublicContent(request, env);
  }

  const mediaMatch = path.match(/^\/api\/content\/([^/]+)\/(cover|audio|preview)$/);
  if (request.method === "GET" && mediaMatch) {
    return redirectToMedia(request, env, mediaMatch[1], mediaMatch[2]);
  }

  const listenMatch = path.match(/^\/api\/content\/([^/]+)\/listen$/);
  if (request.method === "POST" && listenMatch) {
    await env.DB.prepare(
      "UPDATE content SET listens = listens + 1 WHERE id = ? AND status = 'published'"
    ).bind(listenMatch[1]).run();
    return json({ ok: true }, 200, request, env);
  }

  const downloadMatch = path.match(/^\/api\/content\/([^/]+)\/download$/);
  if (request.method === "POST" && downloadMatch) {
    return createDownload(request, env, downloadMatch[1]);
  }

  if (request.method === "GET" && path === "/api/admin/users") {
    const owner = await requireRole(request, env, ["owner"]);
    return listUsers(request, env, owner);
  }
  if (request.method === "POST" && path === "/api/admin/users/role") {
    const owner = await requireRole(request, env, ["owner"]);
    return changeUserRole(request, env, owner);
  }

  if (request.method === "GET" && path === "/api/admin/content") {
    await requireRole(request, env, ["admin", "owner"]);
    return listAdminContent(request, env);
  }
  if (request.method === "POST" && path === "/api/admin/content") {
    const admin = await requireRole(request, env, ["admin", "owner"]);
    return saveContent(request, env, admin);
  }

  const adminContentMatch = path.match(/^\/api\/admin\/content\/([^/]+)$/);
  if (request.method === "PUT" && adminContentMatch) {
    const admin = await requireRole(request, env, ["admin", "owner"]);
    return saveContent(request, env, admin, adminContentMatch[1]);
  }
  if (request.method === "DELETE" && adminContentMatch) {
    await requireRole(request, env, ["admin", "owner"]);
    return deleteContent(request, env, ctx, adminContentMatch[1]);
  }

  if (request.method === "POST" && path === "/api/admin/uploads/presign") {
    await requireRole(request, env, ["admin", "owner"]);
    return createUploadUrl(request, env);
  }
  if (request.method === "POST" && path === "/api/admin/storage/setup") {
    await requireRole(request, env, ["admin", "owner"]);
    await configureBucketCors(env);
    return json({ ok: true, bucket: env.B2_BUCKET_NAME }, 200, request, env);
  }

  return json({ error: "Маршрут не найден" }, 404, request, env);
}

function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = (async () => {
      const statements = [
        `CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          google_sub TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          avatar_url TEXT,
          role TEXT NOT NULL DEFAULT 'user',
          status TEXT NOT NULL DEFAULT 'active',
          email_verified INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`,
        "CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)",
        `CREATE TABLE IF NOT EXISTS content (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL CHECK(type IN ('pack','track')),
          title TEXT NOT NULL,
          artist TEXT,
          price TEXT,
          genre TEXT,
          bpm TEXT,
          musical_key TEXT,
          file_count TEXT,
          description TEXT,
          cover_key TEXT,
          cover_name TEXT,
          cover_mime TEXT,
          cover_size INTEGER NOT NULL DEFAULT 0,
          preview_key TEXT,
          preview_name TEXT,
          preview_mime TEXT,
          preview_size INTEGER NOT NULL DEFAULT 0,
          archive_key TEXT,
          archive_name TEXT,
          archive_mime TEXT,
          archive_size INTEGER NOT NULL DEFAULT 0,
          audio_key TEXT,
          audio_name TEXT,
          audio_mime TEXT,
          audio_size INTEGER NOT NULL DEFAULT 0,
          listens INTEGER NOT NULL DEFAULT 0,
          downloads INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'published',
          created_by TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
        "CREATE INDEX IF NOT EXISTS idx_content_type_created ON content(type, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_content_status ON content(status)"
      ];
      for (const statement of statements) {
        await env.DB.prepare(statement).run();
      }
    })().catch(error => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

async function googleLogin(request, env) {
  const body = await readJson(request);
  if (!body.credential) return json({ error: "Google не передал данные входа" }, 400, request, env);

  const response = await fetch(
    "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(body.credential)
  );
  const profile = await response.json();

  if (!response.ok || profile.aud !== env.GOOGLE_CLIENT_ID) {
    return json({ error: "Google-токен недействителен" }, 401, request, env);
  }
  if (!profile.sub || !profile.email) {
    return json({ error: "В Google-аккаунте не найдена почта" }, 400, request, env);
  }

  const now = unixNow();
  const email = String(profile.email).trim().toLowerCase();
  const ownerEmail = String(env.OWNER_EMAIL || "").trim().toLowerCase();
  const existing = await env.DB.prepare(
    "SELECT * FROM users WHERE google_sub = ? OR lower(email) = ? LIMIT 1"
  ).bind(profile.sub, email).first();

  let userId = existing?.id || crypto.randomUUID();
  let role = existing?.role || "user";
  if (email === ownerEmail) role = "owner";

  if (existing) {
    await env.DB.prepare(`
      UPDATE users
      SET google_sub = ?, email = ?, name = ?, avatar_url = ?, email_verified = ?, role = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      profile.sub,
      email,
      profile.name || email.split("@")[0],
      profile.picture || "",
      profile.email_verified === "true" ? 1 : 0,
      role,
      now,
      userId
    ).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO users
      (id, google_sub, email, name, avatar_url, role, status, email_verified, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).bind(
      userId,
      profile.sub,
      email,
      profile.name || email.split("@")[0],
      profile.picture || "",
      role,
      profile.email_verified === "true" ? 1 : 0,
      now,
      now
    ).run();
  }

  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  try {
    await env.DB.prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
    ).bind(tokenHash, userId, now + SESSION_TTL_SECONDS, now).run();
  } catch {
    await env.DB.prepare(
      "INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
    ).bind(token, userId, now + SESSION_TTL_SECONDS, now).run();
  }

  const user = await getUserById(env, userId);
  return json({ token, user }, 200, request, env);
}

async function logout(request, env) {
  const token = bearerToken(request);
  if (!token) return;
  const tokenHash = await sha256Hex(token);
  try {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
  } catch {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  }
}

async function requireUser(request, env) {
  const token = bearerToken(request);
  if (!token) throw httpError(401, "Сначала войдите в аккаунт");
  const tokenHash = await sha256Hex(token);
  const now = unixNow();
  let row;

  try {
    row = await env.DB.prepare(`
      SELECT u.*
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
      LIMIT 1
    `).bind(tokenHash, now).first();
  } catch {
    row = await env.DB.prepare(`
      SELECT u.*
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ?
      LIMIT 1
    `).bind(token, now).first();
  }

  if (!row) throw httpError(401, "Сессия закончилась. Войдите ещё раз");
  if (row.status === "blocked") throw httpError(403, "Аккаунт заблокирован");
  return publicUser(row);
}

async function requireRole(request, env, roles) {
  const user = await requireUser(request, env);
  if (!roles.includes(user.role)) throw httpError(403, "Недостаточно прав");
  return user;
}

async function getUserById(env, id) {
  const row = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  return row ? publicUser(row) : null;
}

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatar_url: row.avatar_url || "",
    role: row.role,
    status: row.status,
    email_verified: Boolean(row.email_verified),
    created_at: Number(row.created_at || 0)
  };
}

async function listUsers(request, env) {
  const result = await env.DB.prepare(
    "SELECT * FROM users ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at DESC"
  ).all();
  return json({ users: result.results.map(publicUser) }, 200, request, env);
}

async function changeUserRole(request, env, owner) {
  const body = await readJson(request);
  if (!["user", "admin"].includes(body.role)) {
    return json({ error: "Можно выбрать только user или admin" }, 400, request, env);
  }
  const target = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(body.user_id).first();
  if (!target) return json({ error: "Пользователь не найден" }, 404, request, env);
  if (target.role === "owner" || target.id === owner.id) {
    return json({ error: "Роль владельца изменить нельзя" }, 400, request, env);
  }

  await env.DB.prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?")
    .bind(body.role, unixNow(), target.id).run();
  return json({ user: await getUserById(env, target.id) }, 200, request, env);
}

async function listPublicContent(request, env) {
  const result = await env.DB.prepare(
    "SELECT * FROM content WHERE status = 'published' ORDER BY created_at DESC"
  ).all();
  const base = new URL(request.url).origin;
  return json({ items: result.results.map(row => serializeContent(row, base, false)) }, 200, request, env);
}

async function listAdminContent(request, env) {
  const result = await env.DB.prepare("SELECT * FROM content ORDER BY created_at DESC").all();
  const base = new URL(request.url).origin;
  return json({ items: result.results.map(row => serializeContent(row, base, true)) }, 200, request, env);
}

function serializeContent(row, base, admin) {
  const item = {
    id: row.id,
    type: row.type,
    title: row.title,
    artist: row.artist || "",
    price: row.price || (row.type === "pack" ? "FREE" : ""),
    genre: row.genre || "",
    bpm: row.bpm || "",
    key: row.musical_key || "",
    files: row.file_count || "",
    description: row.description || "",
    listens: Number(row.listens || 0),
    downloads: Number(row.downloads || 0),
    created_at: Number(row.created_at || 0),
    cover_url: row.cover_key ? `${base}/api/content/${encodeURIComponent(row.id)}/cover` : "",
    preview_url: row.preview_key ? `${base}/api/content/${encodeURIComponent(row.id)}/preview` : "",
    audio_url: row.audio_key ? `${base}/api/content/${encodeURIComponent(row.id)}/audio` : ""
  };
  if (admin) {
    item.status = row.status;
    item.assets = {
      cover: assetInfo(row, "cover"),
      preview: assetInfo(row, "preview"),
      archive: assetInfo(row, "archive"),
      audio: assetInfo(row, "audio")
    };
  }
  return item;
}

function assetInfo(row, kind) {
  const key = row[`${kind}_key`];
  if (!key) return null;
  return {
    name: row[`${kind}_name`] || "",
    mime: row[`${kind}_mime`] || "",
    size: Number(row[`${kind}_size`] || 0)
  };
}

async function saveContent(request, env, admin, routeId = "") {
  const body = await readJson(request);
  const type = body.type;
  if (!["pack", "track"].includes(type)) {
    return json({ error: "Неизвестный тип материала" }, 400, request, env);
  }
  const title = String(body.title || "").trim();
  if (!title) return json({ error: "Укажите название" }, 400, request, env);

  const id = routeId || crypto.randomUUID();
  const old = routeId
    ? await env.DB.prepare("SELECT * FROM content WHERE id = ?").bind(routeId).first()
    : null;
  if (routeId && !old) return json({ error: "Материал не найден" }, 404, request, env);
  if (old && old.type !== type) return json({ error: "Тип материала нельзя изменить" }, 400, request, env);

  const assets = {};
  for (const kind of ["cover", "preview", "archive", "audio"]) {
    const incoming = body.assets?.[kind];
    assets[kind] = incoming ? validateAsset(incoming) : old ? {
      key: old[`${kind}_key`] || "",
      name: old[`${kind}_name`] || "",
      mime: old[`${kind}_mime`] || "",
      size: Number(old[`${kind}_size`] || 0)
    } : { key: "", name: "", mime: "", size: 0 };
  }

  if (type === "pack" && !assets.archive.key) {
    return json({ error: "Для пака выберите ZIP-архив" }, 400, request, env);
  }
  if (type === "track" && !assets.audio.key) {
    return json({ error: "Для трека выберите аудиофайл" }, 400, request, env);
  }

  const now = unixNow();
  const values = [
    type,
    title,
    clean(body.artist, 160),
    clean(body.price, 40) || (type === "pack" ? "FREE" : ""),
    clean(body.genre, 120),
    clean(body.bpm, 40),
    clean(body.key, 80),
    clean(body.files, 40),
    clean(body.description, 4000),
    assets.cover.key, assets.cover.name, assets.cover.mime, assets.cover.size,
    assets.preview.key, assets.preview.name, assets.preview.mime, assets.preview.size,
    assets.archive.key, assets.archive.name, assets.archive.mime, assets.archive.size,
    assets.audio.key, assets.audio.name, assets.audio.mime, assets.audio.size,
    now
  ];

  if (old) {
    await env.DB.prepare(`
      UPDATE content SET
        type=?, title=?, artist=?, price=?, genre=?, bpm=?, musical_key=?, file_count=?, description=?,
        cover_key=?, cover_name=?, cover_mime=?, cover_size=?,
        preview_key=?, preview_name=?, preview_mime=?, preview_size=?,
        archive_key=?, archive_name=?, archive_mime=?, archive_size=?,
        audio_key=?, audio_name=?, audio_mime=?, audio_size=?,
        updated_at=?
      WHERE id=?
    `).bind(...values, id).run();

    for (const kind of ["cover", "preview", "archive", "audio"]) {
      const oldKey = old[`${kind}_key`];
      if (oldKey && oldKey !== assets[kind].key) {
        await deleteObject(env, oldKey).catch(console.error);
      }
    }
  } else {
    await env.DB.prepare(`
      INSERT INTO content (
        id, type, title, artist, price, genre, bpm, musical_key, file_count, description,
        cover_key, cover_name, cover_mime, cover_size,
        preview_key, preview_name, preview_mime, preview_size,
        archive_key, archive_name, archive_mime, archive_size,
        audio_key, audio_name, audio_mime, audio_size,
        listens, downloads, status, created_by, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        0, 0, 'published', ?, ?, ?
      )
    `).bind(id, ...values.slice(0, -1), admin.id, now, now).run();
  }

  const row = await env.DB.prepare("SELECT * FROM content WHERE id = ?").bind(id).first();
  return json({ item: serializeContent(row, new URL(request.url).origin, true) }, old ? 200 : 201, request, env);
}

function validateAsset(asset) {
  const key = String(asset.key || "");
  if (!key.startsWith("uploads/") || key.includes("..")) throw httpError(400, "Некорректный ключ файла");
  const size = Number(asset.size || 0);
  if (!Number.isFinite(size) || size < 0 || size > MAX_SINGLE_UPLOAD_BYTES) {
    throw httpError(400, "Некорректный размер файла");
  }
  return {
    key,
    name: clean(asset.name, 500),
    mime: clean(asset.mime, 200) || "application/octet-stream",
    size
  };
}

async function deleteContent(request, env, ctx, id) {
  const row = await env.DB.prepare("SELECT * FROM content WHERE id = ?").bind(id).first();
  if (!row) return json({ error: "Материал не найден" }, 404, request, env);
  await env.DB.prepare("DELETE FROM content WHERE id = ?").bind(id).run();

  const deletion = Promise.all(
    ["cover_key", "preview_key", "archive_key", "audio_key"]
      .map(key => row[key])
      .filter(Boolean)
      .map(key => deleteObject(env, key).catch(console.error))
  );
  ctx.waitUntil(deletion);
  return json({ ok: true }, 200, request, env);
}

async function createUploadUrl(request, env) {
  const body = await readJson(request);
  const kind = String(body.kind || "");
  const allowedKinds = ["cover", "preview", "archive", "audio"];
  if (!allowedKinds.includes(kind)) return json({ error: "Неизвестный тип файла" }, 400, request, env);

  const name = clean(body.name, 500);
  const mime = clean(body.mime, 200) || "application/octet-stream";
  const size = Number(body.size || 0);
  if (!name || !Number.isFinite(size) || size <= 0) {
    return json({ error: "Файл пустой или повреждён" }, 400, request, env);
  }
  if (size > MAX_SINGLE_UPLOAD_BYTES) {
    return json({ error: "Один файл не может быть больше 5 ГБ" }, 413, request, env);
  }
  if (kind === "cover" && !mime.startsWith("image/")) {
    return json({ error: "Обложка должна быть изображением" }, 400, request, env);
  }
  if (["preview", "audio"].includes(kind) && !mime.startsWith("audio/")) {
    return json({ error: "Выберите аудиофайл" }, 400, request, env);
  }
  if (kind === "archive" && !/\.(zip|rar|7z)$/i.test(name)) {
    return json({ error: "Архив должен быть ZIP, RAR или 7Z" }, 400, request, env);
  }

  const key = `uploads/${kind}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeFileName(name)}`;
  const url = await presignObject(env, "PUT", key, PRESIGN_TTL_SECONDS);
  return json({
    upload: { url, key, name, mime, size, expires_in: PRESIGN_TTL_SECONDS }
  }, 200, request, env);
}

async function redirectToMedia(request, env, id, kind) {
  const column = kind === "cover" ? "cover_key" : kind === "preview" ? "preview_key" : "audio_key";
  const row = await env.DB.prepare(
    `SELECT ${column} AS object_key FROM content WHERE id = ? AND status = 'published'`
  ).bind(id).first();
  if (!row?.object_key) return json({ error: "Файл не найден" }, 404, request, env);

  const location = await presignObject(env, "GET", row.object_key, 60 * 60);
  return new Response(null, {
    status: 302,
    headers: { ...corsHeaders(request, env), Location: location, "Cache-Control": "public, max-age=300" }
  });
}

async function createDownload(request, env, id) {
  await requireUser(request, env);
  const row = await env.DB.prepare(
    `SELECT type, archive_key, archive_name, audio_key, audio_name
     FROM content
     WHERE id = ? AND status = 'published'`
  ).bind(id).first();
  if (!row) return json({ error: "Материал не найден" }, 404, request, env);

  const objectKey = row.type === "pack" ? row.archive_key : row.audio_key;
  const filename = row.type === "pack"
    ? (row.archive_name || "noirwave-pack.zip")
    : (row.audio_name || "noirwave-track.mp3");

  if (!objectKey) {
    return json(
      { error: row.type === "pack" ? "Архив не найден" : "Аудиофайл не найден" },
      404,
      request,
      env
    );
  }

  await env.DB.prepare("UPDATE content SET downloads = downloads + 1 WHERE id = ?").bind(id).run();
  const url = await presignObject(env, "GET", objectKey, 10 * 60, {
    "response-content-disposition": `attachment; filename="${safeFileName(filename)}"`
  });
  return json({ url, filename }, 200, request, env);
}

async function configureBucketCors(env) {
  const origin = String(env.SITE_ORIGIN || "").replace(/\/+$/, "");
  if (!origin) throw httpError(500, "Не указана переменная SITE_ORIGIN");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <CORSRule>
    <AllowedOrigin>${escapeXml(origin)}</AllowedOrigin>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>`;
  const target = bucketUrl(env, "", "cors=");
  const response = await signedFetch(env, "PUT", target, xml, "application/xml");
  if (!response.ok) {
    const text = await response.text();
    throw httpError(502, `B2 не принял CORS-настройку (${response.status}): ${text.slice(0, 180)}`);
  }
}

async function deleteObject(env, key) {
  const url = await presignObject(env, "DELETE", key, 5 * 60);
  const response = await fetch(url, { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new Error(`B2 delete: ${response.status}`);
}

async function presignObject(env, method, key, expires, extraParams = {}) {
  assertB2Env(env);
  const endpoint = new URL(env.B2_ENDPOINT);
  const region = b2Region(endpoint.hostname);
  const now = new Date();
  const amzDate = awsDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const canonicalUri = objectPath(env, key);

  const params = new Map([
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${env.B2_KEY_ID}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expires)],
    ["X-Amz-SignedHeaders", "host"]
  ]);
  for (const [name, value] of Object.entries(extraParams)) {
    params.set(name, String(value));
  }
  const canonicalQuery = queryString(params);
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    `host:${endpoint.host}\n`,
    "host",
    "UNSIGNED-PAYLOAD"
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256Hex(canonicalRequest)
  ].join("\n");
  const signingKey = await awsSigningKey(env.B2_APPLICATION_KEY, dateStamp, region);
  const signature = bytesToHex(await hmac(signingKey, stringToSign));
  return `${endpoint.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

async function signedFetch(env, method, url, body = "", contentType = "application/octet-stream") {
  assertB2Env(env);
  const target = new URL(url);
  const region = b2Region(target.hostname);
  const now = new Date();
  const amzDate = awsDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const payloadBytes = typeof body === "string" ? textBytes(body) : body;
  const payloadDigest = await sha256Bytes(payloadBytes);
  const payloadHash = bytesToHex(payloadDigest);
  const checksumSha256 = bytesToBase64(payloadDigest);
  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${target.host}\n` +
    `x-amz-checksum-sha256:${checksumSha256}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-checksum-sha256;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    method,
    target.pathname,
    target.search.slice(1),
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256Hex(canonicalRequest)
  ].join("\n");
  const signingKey = await awsSigningKey(env.B2_APPLICATION_KEY, dateStamp, region);
  const signature = bytesToHex(await hmac(signingKey, stringToSign));
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${env.B2_KEY_ID}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(target.toString(), {
    method,
    headers: {
      "Content-Type": contentType,
      "x-amz-checksum-sha256": checksumSha256,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: authorization
    },
    body
  });
}

function bucketUrl(env, key = "", rawQuery = "") {
  const endpoint = new URL(env.B2_ENDPOINT);
  const path = key ? objectPath(env, key) : `/${awsEncode(env.B2_BUCKET_NAME)}/`;
  return `${endpoint.origin}${path}${rawQuery ? `?${rawQuery}` : ""}`;
}

function objectPath(env, key) {
  return `/${awsEncode(env.B2_BUCKET_NAME)}/${String(key).split("/").map(awsEncode).join("/")}`;
}

function queryString(params) {
  return [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`)
    .join("&");
}

function b2Region(hostname) {
  const match = hostname.match(/^s3\.([^.]+)\./);
  if (!match) throw new Error("Не удалось определить регион B2 из B2_ENDPOINT");
  return match[1];
}

async function awsSigningKey(secret, dateStamp, region) {
  const kDate = await hmac(textBytes("AWS4" + secret), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

async function hmac(key, data) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key instanceof Uint8Array ? key : textBytes(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, textBytes(data)));
}

async function sha256Hex(data) {
  const bytes = typeof data === "string" ? textBytes(data) : data;
  return bytesToHex(await sha256Bytes(bytes));
}

async function sha256Bytes(data) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

function awsDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function awsEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, char =>
    "%" + char.charCodeAt(0).toString(16).toUpperCase()
  );
}

function safeFileName(value) {
  const cleaned = String(value)
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned.slice(-180) || "file";
}

function assertB2Env(env) {
  for (const key of ["B2_KEY_ID", "B2_APPLICATION_KEY", "B2_BUCKET_NAME", "B2_ENDPOINT"]) {
    if (!env[key]) throw httpError(500, `Не указана переменная ${key}`);
  }
}

function corsHeaders(request, env) {
  const requestOrigin = request.headers.get("Origin") || "";
  const allowedOrigin = String(env.SITE_ORIGIN || "").replace(/\/+$/, "");
  const origin = requestOrigin === allowedOrigin ? requestOrigin : allowedOrigin || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function json(data, status, request, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(request, env)
    }
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw httpError(400, "Некорректные данные запроса");
  }
}

function bearerToken(request) {
  const value = request.headers.get("Authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

function randomToken(length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function clean(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function unixNow() {
  return Math.floor(Date.now() / 1000);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function textBytes(value) {
  return new TextEncoder().encode(value);
}

function bytesToHex(bytes) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, char => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;"
  }[char]));
}
