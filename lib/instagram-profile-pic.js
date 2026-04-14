const https = require("https");
const http = require("http");

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IG_API_UA = "Instagram 219.0.0.12.117 Android";

function parseInstagramUsername(urlString) {
  if (!urlString || typeof urlString !== "string") return null;
  const raw = urlString.trim();
  /* Allow bare @handle or handle paths without full URL */
  if (/^@?[a-zA-Z0-9._]+$/.test(raw.replace(/^@/, ""))) {
    const h = raw.replace(/^@/, "");
    if (/^[a-zA-Z0-9._]+$/.test(h)) return h;
  }
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== "instagram.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return null;
    const reserved = new Set([
      "p",
      "reel",
      "reels",
      "stories",
      "explore",
      "accounts",
      "direct",
      "tv",
    ]);
    if (reserved.has(parts[0])) return null;
    const user = parts[0];
    if (!/^[a-zA-Z0-9._]+$/.test(user)) return null;
    return user;
  } catch {
    return null;
  }
}

/** Canonical profile URL for storage and stable comparisons. */
function normalizeInstagramProfileUrl(input) {
  if (!input || typeof input !== "string") return null;
  const user = parseInstagramUsername(input.trim());
  if (!user) return null;
  return `https://www.instagram.com/${user}/`;
}

function httpsRequestJson(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      path: `${parsed.pathname}${parsed.search}`,
      method: "GET",
      headers: {
        "User-Agent": IG_API_UA,
        Accept: "application/json",
      },
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString("utf8");
        if (res.statusCode !== 200) {
          resolve({ ok: false, status: res.statusCode });
          return;
        }
        try {
          const j = JSON.parse(text);
          resolve({ ok: true, json: j });
        } catch {
          resolve({ ok: false, status: res.statusCode, parseError: true });
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(20000, () => {
      req.destroy(new Error("timeout"));
    });
    req.end();
  });
}

async function fetchInstagramProfilePicUrl(username) {
  const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
  const res = await httpsRequestJson(url);
  if (!res.ok || !res.json) return null;
  const user = res.json?.data?.user;
  const pic = user?.profile_pic_url_hd || user?.profile_pic_url;
  if (typeof pic !== "string" || !pic.startsWith("https://")) return null;
  return pic;
}

function allowedImageHost(hostname) {
  const h = hostname.toLowerCase();
  return (
    h.endsWith("cdninstagram.com") ||
    h.endsWith("fbcdn.net") ||
    h === "instagram.com" ||
    h.endsWith(".instagram.com")
  );
}

function downloadBinary(imageUrl, { maxBytes = MAX_IMAGE_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const follow = (u, redirects = 0) => {
      if (redirects > 5) {
        resolve(null);
        return;
      }
      let parsed;
      try {
        parsed = new URL(u);
      } catch {
        resolve(null);
        return;
      }
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        resolve(null);
        return;
      }
      if (!allowedImageHost(parsed.hostname)) {
        resolve(null);
        return;
      }
      const lib = parsed.protocol === "https:" ? https : http;
      const req = lib.request(
        {
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          method: "GET",
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; GrassrootsAvatar/1.0)",
            Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          },
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            follow(res.headers.location, redirects + 1);
            return;
          }
          if (res.statusCode !== 200) {
            resolve(null);
            return;
          }
          const chunks = [];
          let size = 0;
          res.on("data", (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
              res.destroy();
              resolve(null);
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () => {
            const buf = Buffer.concat(chunks);
            if (!buf.length) {
              resolve(null);
              return;
            }
            const ct = (res.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
            resolve({ buffer: buf, contentType: ct || "image/jpeg" });
          });
        }
      );
      req.on("error", () => resolve(null));
      req.setTimeout(25000, () => {
        req.destroy();
        resolve(null);
      });
      req.end();
    };
    follow(imageUrl, 0);
  });
}

function pickStorageContentType(downloaded) {
  const ct = downloaded.contentType;
  if (ct === "image/jpeg" || ct === "image/jpg") return { ext: "jpg", contentType: "image/jpeg" };
  if (ct === "image/png") return { ext: "png", contentType: "image/png" };
  if (ct === "image/webp") return { ext: "webp", contentType: "image/webp" };
  if (ct === "image/gif") return { ext: "gif", contentType: "image/gif" };
  /* Instagram CDN typically serves JPEG for profile pics */
  return { ext: "jpg", contentType: "image/jpeg" };
}

/**
 * Fetches Instagram profile picture and uploads to Supabase avatars bucket; updates profiles.avatar_path.
 * No-op style: returns { ok: false } on any failure.
 */
async function syncInstagramProfileAvatar({ supabase, userId, instagramUrl }) {
  const canonical = normalizeInstagramProfileUrl(instagramUrl) || instagramUrl;
  const username = parseInstagramUsername(canonical);
  if (!username) return { ok: false };

  let picUrl;
  try {
    picUrl = await fetchInstagramProfilePicUrl(username);
  } catch {
    return { ok: false };
  }
  if (!picUrl) return { ok: false };

  let downloaded;
  try {
    downloaded = await downloadBinary(picUrl);
  } catch {
    return { ok: false };
  }
  if (!downloaded?.buffer?.length) return { ok: false };

  const { ext, contentType } = pickStorageContentType(downloaded);

  const { data: row, error: selErr } = await supabase
    .from("profiles")
    .select("avatar_path")
    .eq("id", userId)
    .maybeSingle();
  if (selErr) return { ok: false };

  const oldPath = row?.avatar_path || null;
  const path = `${userId}/${Date.now()}-instagram.${ext}`;

  const { error: upErr } = await supabase.storage.from("avatars").upload(path, downloaded.buffer, {
    contentType,
    upsert: false,
  });
  if (upErr) return { ok: false };

  const { error: upProfileErr } = await supabase.from("profiles").update({ avatar_path: path }).eq("id", userId);
  if (upProfileErr) {
    await supabase.storage.from("avatars").remove([path]).catch(() => {});
    return { ok: false };
  }

  if (oldPath && oldPath !== path) {
    await supabase.storage.from("avatars").remove([oldPath]).catch(() => {});
  }

  const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
  return { ok: true, avatarPath: path, publicUrl: pub?.publicUrl || null };
}

module.exports = {
  parseInstagramUsername,
  normalizeInstagramProfileUrl,
  fetchInstagramProfilePicUrl,
  syncInstagramProfileAvatar,
  MAX_IMAGE_BYTES,
};
