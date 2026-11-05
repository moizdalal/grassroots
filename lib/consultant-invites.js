const crypto = require("crypto");
const { isEduHost, emailHost } = require("./schools");

const DEFAULT_DAYS = 30;
const MAX_DAYS = 180;

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isEduEmail(email) {
  const normalized = normalizeEmail(email);
  const host = emailHost(normalized);
  return normalized.includes("@") && isEduHost(host) && !normalized.includes(" ");
}

function newToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function inviteError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function createInvite(supabase, { email, expiresInDays, appUrl }) {
  const normalized = normalizeEmail(email);
  if (!isEduEmail(normalized)) {
    throw inviteError("Invite email must be a .edu address.");
  }
  const requested = Number(expiresInDays);
  const days = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.round(requested), MAX_DAYS)
    : DEFAULT_DAYS;
  const token = newToken();
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const { error: revokeError } = await supabase
    .from("consultant_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("email", normalized)
    .is("used_at", null)
    .is("revoked_at", null);
  if (revokeError) throw inviteError(revokeError.message, 500);

  const { error } = await supabase.from("consultant_invites").insert({
    email: normalized,
    token_hash: hashToken(token),
    expires_at: expiresAt,
  });
  if (error) throw inviteError(error.message, 500);

  const origin = String(appUrl || "").replace(/\/$/, "");
  return {
    email: normalized,
    url: `${origin}/register.html?invite=${encodeURIComponent(token)}`,
    expiresAt,
  };
}

async function lookupInvite(supabase, token) {
  if (!token) return null;
  const { data, error } = await supabase
    .from("consultant_invites")
    .select("id, email, expires_at, used_at, revoked_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (error || !data) return null;
  if (data.used_at || data.revoked_at) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;
  return data;
}

async function claimInvite(supabase, token, email) {
  const row = await lookupInvite(supabase, token);
  if (!row) return { ok: false, error: "This invite link is no longer valid." };
  if (row.email !== normalizeEmail(email)) {
    return { ok: false, error: "Use the school email this invite was sent to." };
  }

  const { data, error } = await supabase
    .from("consultant_invites")
    .update({ used_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("used_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "This invite link is no longer valid." };
  return { ok: true, id: row.id, email: row.email };
}

async function releaseInvite(supabase, id, { force = false } = {}) {
  if (!id) return;
  const patch = force ? { used_at: null, used_by: null } : { used_at: null };
  let query = supabase.from("consultant_invites").update(patch).eq("id", id);
  if (!force) query = query.is("used_by", null);
  await query;
}

async function attachInviteUser(supabase, id, userId) {
  if (!id || !userId) return;
  await supabase.from("consultant_invites").update({ used_by: userId }).eq("id", id);
}

module.exports = {
  normalizeEmail,
  isEduEmail,
  createInvite,
  lookupInvite,
  claimInvite,
  releaseInvite,
  attachInviteUser,
};
