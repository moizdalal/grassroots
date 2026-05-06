// inbox.js — two-pane email-style inbox for the dashboard.
// Group messages by (listing_id + other_user_id). Track unread counts via
// public.message_reads (per-thread last_read_at, scoped to the user). When
// the recipient opens a thread we update last_read_at and, if both parties
// have read receipts on, stamp messages.read_at so the sender can see ✓✓.

import { getSupabaseClient } from "/supabase-loader.js";

const $ = (id) => document.getElementById(id);
const escape = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function relTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)}m`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h`;
  if (diff < 604800) return `${Math.round(diff / 86400)}d`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function publicAvatarUrl(client, path) {
  if (!path) return null;
  const { data } = client.storage.from("avatars").getPublicUrl(path);
  return data?.publicUrl ?? null;
}

function avatarHtml(client, profile, fallbackName) {
  const url = publicAvatarUrl(client, profile?.avatar_path);
  if (url) return `<img src="${escape(url)}" alt="" />`;
  const initial = (fallbackName || profile?.full_name || "?").trim().charAt(0).toUpperCase() || "?";
  return `<span class="inbox__avatar-fallback">${escape(initial)}</span>`;
}

const THREAD_CONTEXT_SEPARATOR = "";

function parseBody(raw) {
  const body = String(raw || "");
  const sep = body.indexOf(THREAD_CONTEXT_SEPARATOR);
  if (sep === -1) return { context: null, body: body.trim() };
  return {
    context: body.slice(0, sep).replace(/^re:\s*/i, "").trim() || null,
    body: body.slice(sep + 1).trim(),
  };
}

const state = {
  client: null,
  userId: null,
  myProfile: null,
  threads: new Map(), // key = `${listingId}:${otherUserId}` -> thread
  profiles: new Map(),
  listings: new Map(),
  businessNames: new Map(),
  reads: new Map(), // key -> last_read_at iso
  activeKey: null,
  filter: "all",
  search: "",
  channel: null,
  initialized: false,
};

function threadKey(listingId, otherUserId) {
  return `${listingId}:${otherUserId}`;
}

function counterpartLabel(thread) {
  const profile = thread.otherProfile;
  const biz = state.businessNames.get(thread.otherUserId);
  if (profile?.role === "business_owner") return biz || profile?.full_name || "business";
  return profile?.full_name || biz || "consultant";
}

function listingTitle(thread) {
  return state.listings.get(thread.listingId)?.title || "(untitled listing)";
}

async function loadProfiles(ids) {
  const fresh = [...new Set(ids.filter((id) => id && !state.profiles.has(id)))];
  if (!fresh.length) return;
  const { data } = await state.client
    .from("profiles")
    .select("id, full_name, role, avatar_path")
    .in("id", fresh);
  for (const row of data || []) state.profiles.set(row.id, row);

  const ownerIds = (data || []).filter((p) => p.role === "business_owner").map((p) => p.id);
  if (ownerIds.length) {
    const { data: bizRows } = await state.client
      .from("business_profiles")
      .select("user_id, business_name")
      .in("user_id", ownerIds);
    for (const row of bizRows || []) state.businessNames.set(row.user_id, row.business_name);
  }
}

async function loadListings(ids) {
  const fresh = [...new Set(ids.filter((id) => id && !state.listings.has(id)))];
  if (!fresh.length) return;
  const { data } = await state.client
    .from("listings")
    .select("id, owner_id, title, status, business_display_name")
    .in("id", fresh);
  for (const row of data || []) state.listings.set(row.id, row);
}

async function loadReads() {
  const { data } = await state.client
    .from("message_reads")
    .select("listing_id, other_user_id, last_read_at")
    .eq("user_id", state.userId);
  state.reads.clear();
  for (const row of data || []) {
    state.reads.set(threadKey(row.listing_id, row.other_user_id), row.last_read_at);
  }
}

async function loadAllMessages() {
  const { data, error } = await state.client
    .from("messages")
    .select("id, listing_id, sender_id, recipient_id, body, created_at, read_at")
    .or(`sender_id.eq.${state.userId},recipient_id.eq.${state.userId}`)
    .order("created_at", { ascending: true })
    .limit(2000);
  if (error) {
    console.warn("inbox: messages load failed", error);
    return [];
  }
  return data || [];
}

function ingestMessages(messages) {
  state.threads.clear();
  for (const msg of messages) {
    const otherUserId = msg.sender_id === state.userId ? msg.recipient_id : msg.sender_id;
    if (!otherUserId || !msg.listing_id) continue;
    const key = threadKey(msg.listing_id, otherUserId);
    let thread = state.threads.get(key);
    if (!thread) {
      thread = {
        key,
        listingId: msg.listing_id,
        otherUserId,
        messages: [],
        lastAt: msg.created_at,
        lastBody: msg.body,
        lastFromMe: msg.sender_id === state.userId,
      };
      state.threads.set(key, thread);
    }
    thread.messages.push(msg);
    if (!thread.lastAt || new Date(msg.created_at) > new Date(thread.lastAt)) {
      thread.lastAt = msg.created_at;
      thread.lastBody = msg.body;
      thread.lastFromMe = msg.sender_id === state.userId;
    }
  }
  // Annotate per-thread unread count (incoming messages newer than last_read_at)
  for (const thread of state.threads.values()) {
    const lastReadIso = state.reads.get(thread.key);
    const lastRead = lastReadIso ? new Date(lastReadIso).getTime() : 0;
    thread.unread = thread.messages.filter(
      (m) => m.recipient_id === state.userId && new Date(m.created_at).getTime() > lastRead
    ).length;
    thread.otherProfile = state.profiles.get(thread.otherUserId);
  }
}

function sortedThreads() {
  return [...state.threads.values()].sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
}

function filteredThreads() {
  const q = state.search.trim().toLowerCase();
  return sortedThreads().filter((t) => {
    if (state.filter === "unread" && !t.unread) return false;
    if (q) {
      const hay = `${counterpartLabel(t)} ${listingTitle(t)} ${t.lastBody}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function totalUnread() {
  let n = 0;
  for (const t of state.threads.values()) n += t.unread;
  return n;
}

function renderThreads() {
  const root = $("inbox-threads");
  const empty = $("inbox-list-empty");
  if (!root || !empty) return;
  const list = filteredThreads();
  if (!list.length) {
    root.innerHTML = "";
    empty.hidden = false;
    empty.textContent = state.search
      ? "no conversations match that search."
      : state.filter === "unread"
        ? "no unread conversations."
        : "no conversations yet.";
  } else {
    empty.hidden = true;
    root.innerHTML = list
      .map((t) => {
        const parsed = parseBody(t.lastBody);
        const preview = (t.lastFromMe ? "you: " : "") + (parsed.body || "[no text]");
        return `
          <button type="button" class="inbox__thread${t.unread ? " is-unread" : ""}${state.activeKey === t.key ? " is-active" : ""}" data-key="${escape(t.key)}">
            <span class="inbox__thread-avatar">${avatarHtml(state.client, t.otherProfile, counterpartLabel(t))}</span>
            <span class="inbox__thread-body">
              <span class="inbox__thread-row1">
                <span class="inbox__thread-name">${escape(counterpartLabel(t))}</span>
                <span class="inbox__thread-time">${escape(relTime(t.lastAt))}</span>
              </span>
              <span class="inbox__thread-listing">re: ${escape(listingTitle(t))}</span>
              <span class="inbox__thread-preview">${escape(preview)}</span>
            </span>
            ${t.unread ? `<span class="inbox__thread-unread" aria-label="${t.unread} unread">${t.unread}</span>` : ""}
          </button>
        `;
      })
      .join("");
  }

  // sidebar inbox badge + filter pill
  const total = totalUnread();
  const sidebarBadge = $("dash-inbox-badge");
  if (sidebarBadge) {
    sidebarBadge.textContent = String(total);
    sidebarBadge.hidden = total === 0;
  }
  const filterPill = $("inbox-unread-pill");
  if (filterPill) {
    filterPill.textContent = String(total);
    filterPill.hidden = total === 0;
  }
}

function renderConversation() {
  const placeholder = $("inbox-placeholder");
  const conv = $("inbox-conversation");
  const body = $("inbox-conv-body");
  const nameEl = $("inbox-conv-name");
  const listingEl = $("inbox-conv-listing");
  const avatarEl = $("inbox-conv-avatar");
  if (!placeholder || !conv || !body || !nameEl || !listingEl || !avatarEl) return;

  const thread = state.activeKey ? state.threads.get(state.activeKey) : null;
  if (!thread) {
    conv.hidden = true;
    placeholder.hidden = false;
    return;
  }
  conv.hidden = false;
  placeholder.hidden = true;

  nameEl.textContent = counterpartLabel(thread);
  listingEl.textContent = listingTitle(thread);
  listingEl.href = `/listing.html?id=${encodeURIComponent(thread.listingId)}`;
  avatarEl.innerHTML = avatarHtml(state.client, thread.otherProfile, counterpartLabel(thread));

  // Render messages with day separators
  const html = [];
  let lastDay = "";
  for (const msg of thread.messages) {
    const d = new Date(msg.created_at);
    const dayKey = d.toDateString();
    if (dayKey !== lastDay) {
      html.push(`<div class="inbox__day-divider">${escape(d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }))}</div>`);
      lastDay = dayKey;
    }
    const fromMe = msg.sender_id === state.userId;
    const parsed = parseBody(msg.body);
    const receipt =
      fromMe && msg.read_at
        ? `<span class="inbox__msg-receipt" title="read ${fmtTime(msg.read_at)}">✓✓ read</span>`
        : fromMe
          ? `<span class="inbox__msg-receipt inbox__msg-receipt--sent">sent</span>`
          : "";
    html.push(`
      <div class="inbox__msg${fromMe ? " is-mine" : ""}">
        ${parsed.context ? `<div class="inbox__msg-context">re: ${escape(parsed.context)}</div>` : ""}
        <div class="inbox__msg-bubble">${escape(parsed.body || "")}</div>
        <div class="inbox__msg-meta"><span>${escape(fmtTime(msg.created_at))}</span>${receipt}</div>
      </div>
    `);
  }
  body.innerHTML = html.join("");
  body.scrollTop = body.scrollHeight;
}

async function markThreadRead(thread) {
  if (!thread) return;
  // Update message_reads (upsert)
  const nowIso = new Date().toISOString();
  state.reads.set(thread.key, nowIso);
  thread.unread = 0;
  await state.client
    .from("message_reads")
    .upsert(
      {
        user_id: state.userId,
        listing_id: thread.listingId,
        other_user_id: thread.otherUserId,
        last_read_at: nowIso,
      },
      { onConflict: "user_id,listing_id,other_user_id" }
    );

  // If I have read receipts on, stamp read_at on incoming unread messages
  // so the sender can see ✓✓ when they have receipts on too.
  if (state.myProfile?.read_receipts_enabled) {
    const ids = thread.messages
      .filter((m) => m.recipient_id === state.userId && !m.read_at)
      .map((m) => m.id);
    if (ids.length) {
      await state.client
        .from("messages")
        .update({ read_at: nowIso })
        .in("id", ids);
      for (const id of ids) {
        const m = thread.messages.find((x) => x.id === id);
        if (m) m.read_at = nowIso;
      }
    }
  }
}

async function selectThread(key) {
  state.activeKey = key;
  renderThreads();
  renderConversation();
  const thread = state.threads.get(key);
  if (thread && thread.unread) {
    await markThreadRead(thread);
    renderThreads();
    renderConversation();
  }
}

async function sendMessage(text) {
  const thread = state.threads.get(state.activeKey);
  if (!thread || !text.trim()) return;
  const payload = {
    listing_id: thread.listingId,
    sender_id: state.userId,
    recipient_id: thread.otherUserId,
    body: text.trim(),
  };
  const { data, error } = await state.client
    .from("messages")
    .insert(payload)
    .select("id, listing_id, sender_id, recipient_id, body, created_at, read_at")
    .single();
  if (error) {
    console.warn("inbox: send failed", error);
    return;
  }
  thread.messages.push(data);
  thread.lastAt = data.created_at;
  thread.lastBody = data.body;
  thread.lastFromMe = true;
  renderThreads();
  renderConversation();
}

function handleIncoming(msg) {
  // Realtime arrival. We only render messages in our threads.
  const otherUserId = msg.sender_id === state.userId ? msg.recipient_id : msg.sender_id;
  if (otherUserId !== msg.sender_id && otherUserId !== msg.recipient_id) return;
  if (msg.sender_id !== state.userId && msg.recipient_id !== state.userId) return;

  const key = threadKey(msg.listing_id, otherUserId);
  let thread = state.threads.get(key);
  const existed = !!thread;
  if (!thread) {
    thread = {
      key,
      listingId: msg.listing_id,
      otherUserId,
      messages: [],
      lastAt: msg.created_at,
      lastBody: msg.body,
      lastFromMe: msg.sender_id === state.userId,
      unread: 0,
    };
    state.threads.set(key, thread);
  }
  if (thread.messages.find((m) => m.id === msg.id)) return; // dedupe
  thread.messages.push(msg);
  thread.lastAt = msg.created_at;
  thread.lastBody = msg.body;
  thread.lastFromMe = msg.sender_id === state.userId;

  if (msg.recipient_id === state.userId) {
    const lastReadIso = state.reads.get(key);
    const lastRead = lastReadIso ? new Date(lastReadIso).getTime() : 0;
    if (new Date(msg.created_at).getTime() > lastRead) {
      thread.unread = (thread.unread || 0) + 1;
    }
  }

  // Hydrate profile/listing for new threads as needed
  if (!existed) {
    Promise.all([
      loadProfiles([thread.otherUserId]),
      loadListings([thread.listingId]),
    ]).then(() => {
      thread.otherProfile = state.profiles.get(thread.otherUserId);
      renderThreads();
      if (state.activeKey === key) renderConversation();
    });
  }

  renderThreads();
  if (state.activeKey === key) {
    renderConversation();
    // If we're viewing this thread, immediately mark as read
    if (msg.recipient_id === state.userId) markThreadRead(thread).then(renderThreads);
  }
}

function handleUpdate(msg) {
  // A message we sent was just stamped read_at.
  for (const thread of state.threads.values()) {
    const local = thread.messages.find((m) => m.id === msg.id);
    if (local) {
      local.read_at = msg.read_at;
      if (state.activeKey === thread.key) renderConversation();
      break;
    }
  }
}

function subscribeRealtime() {
  if (state.channel) return;
  try {
    state.channel = state.client
      .channel(`inbox:${state.userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const m = payload.new;
        if (m.sender_id === state.userId || m.recipient_id === state.userId) handleIncoming(m);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => {
        const m = payload.new;
        if (m.sender_id === state.userId || m.recipient_id === state.userId) handleUpdate(m);
      })
      .subscribe();
  } catch (err) {
    console.warn("inbox: realtime subscribe failed", err);
  }
}

function wireUI() {
  const threads = $("inbox-threads");
  const search = $("inbox-search");
  const composer = $("inbox-composer");
  const composerInput = $("inbox-composer-input");
  const closeBtn = $("inbox-conv-close");

  threads?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-key]");
    if (btn) selectThread(btn.dataset.key);
  });

  document.querySelectorAll(".inbox__filter").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".inbox__filter").forEach((x) => x.classList.toggle("active", x === b));
      state.filter = b.dataset.filter;
      renderThreads();
    });
  });

  search?.addEventListener("input", (e) => {
    state.search = e.target.value;
    renderThreads();
  });

  composer?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = composerInput.value;
    if (!text.trim()) return;
    composerInput.value = "";
    composerInput.focus();
    await sendMessage(text);
  });

  composerInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      composer.requestSubmit();
    }
  });

  closeBtn?.addEventListener("click", () => {
    state.activeKey = null;
    renderThreads();
    renderConversation();
  });
}

function maybeOpenFromHash() {
  const hash = window.location.hash;
  // accepts #inbox?thread=<listingId>:<otherUserId>
  const m = /thread=([0-9a-f-]+):([0-9a-f-]+)/i.exec(hash);
  if (!m) return;
  const key = `${m[1]}:${m[2]}`;
  if (state.threads.has(key)) selectThread(key);
}

export async function initInbox() {
  if (state.initialized) return;
  state.initialized = true;
  state.client = await getSupabaseClient();
  const { data: { session } } = await state.client.auth.getSession();
  if (!session?.user) return;
  state.userId = session.user.id;

  const { data: me } = await state.client
    .from("profiles")
    .select("id, full_name, role, avatar_path, read_receipts_enabled")
    .eq("id", state.userId)
    .single();
  state.myProfile = me || null;

  const messages = await loadAllMessages();
  const otherIds = new Set();
  const listingIds = new Set();
  for (const m of messages) {
    listingIds.add(m.listing_id);
    otherIds.add(m.sender_id === state.userId ? m.recipient_id : m.sender_id);
  }
  await Promise.all([loadProfiles([...otherIds]), loadListings([...listingIds]), loadReads()]);
  ingestMessages(messages);

  wireUI();
  renderThreads();
  renderConversation();
  subscribeRealtime();
  maybeOpenFromHash();
  window.addEventListener("hashchange", maybeOpenFromHash);
}
