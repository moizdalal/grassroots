const PANEL_STORAGE_KEY = "grassroots_control_panel_collapsed";
const THREAD_CONTEXT_SEPARATOR = "\u001F";
const NOTIFICATION_LIMIT = 6;
const MESSAGE_LIMIT = 60;
const ENGAGEMENT_LIMIT = 8;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getRelatedRow(value) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function getFirstName(fullName) {
  const trimmed = String(fullName || "").trim();
  return trimmed ? trimmed.split(/\s+/)[0] : "you";
}

function readNumericCandidate(source, keys) {
  if (!source || typeof source !== "object") return null;
  for (const key of keys) {
    const raw = source[key];
    const value = typeof raw === "string" ? Number(raw) : raw;
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function isMissing(error) {
  if (!error) return false;
  const msg = String(error.message || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("could not find");
}

function publicAvatarUrl(client, path) {
  if (!path) return null;
  const { data } = client.storage.from("avatars").getPublicUrl(path);
  return data?.publicUrl ?? null;
}

function parseMessageBody(rawBody) {
  const body = String(rawBody || "");
  const separatorIndex = body.indexOf(THREAD_CONTEXT_SEPARATOR);
  if (separatorIndex === -1) {
    return { context: null, body: body.trim() };
  }
  return {
    context: body.slice(0, separatorIndex).replace(/^re:\s*/i, "").trim() || null,
    body: body.slice(separatorIndex + 1).trim(),
  };
}

function relativeTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  if (!Number.isFinite(diffMs)) return "";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function calculateStage(engagementsCompleted, avgRating) {
  if (avgRating != null && avgRating > 4 && engagementsCompleted >= 10) {
    return {
      index: 3,
      name: "giant sequoia",
      progressPercent: 100,
      nextCopy: "you've reached the highest stage. keep delivering strong work to hold sequoia status.",
    };
  }

  if (avgRating != null && avgRating >= 4 && engagementsCompleted >= 2) {
    const engagementProgress = clamp(engagementsCompleted / 10, 0, 1);
    const ratingProgress = clamp(avgRating / 4.1, 0, 1);
    return {
      index: 2,
      name: "small tree",
      progressPercent: Math.round((engagementProgress * 0.6 + ratingProgress * 0.4) * 100),
      nextCopy: "complete 10+ engagements and keep your rating above 4.0 to unlock giant sequoia status.",
    };
  }

  if (avgRating != null && avgRating >= 4 && engagementsCompleted >= 1) {
    const engagementProgress = clamp(engagementsCompleted / 2, 0, 1);
    const ratingProgress = clamp(avgRating / 4, 0, 1);
    return {
      index: 1,
      name: "sprout",
      progressPercent: Math.round((engagementProgress * 0.6 + ratingProgress * 0.4) * 100),
      nextCopy: "maintain a 4.0+ rating and complete 2 engagements to reach stage 2.",
    };
  }

  return {
    index: 0,
    name: "seedling",
    progressPercent: Math.round(
      (clamp(engagementsCompleted / 1, 0, 1) * 0.6 + clamp((avgRating || 0) / 4, 0, 1) * 0.4) * 100
    ),
    nextCopy: "complete 1 free engagement and earn an average rating of at least 4.0 stars.",
  };
}

function icon(name) {
  const icons = {
    panel:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 3v18"/><path d="M14 8h3"/><path d="M14 12h3"/><path d="M14 16h3"/></svg>',
    collapse:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    expand:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
    inbox:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7.5"/><path d="M4 13.5h4l2 3h4l2-3h4"/><path d="M4 13.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4.5"/></svg>',
    messages:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    engagement:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>',
    profile:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="8" r="4"/></svg>',
    star:
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 17.3-5.47 3.02 1.04-6.16L3 9.82l6.27-.93L12 3.3l2.73 5.59 6.27.93-4.57 4.34 1.04 6.16z"/></svg>',
    sprout:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20V11"/><path d="M12 11C9 11 6.5 9 6.5 5.5 10.5 5.5 12 7 12 11Z"/><path d="M12 14c3.2 0 5.5-2.1 5.5-5.5-4 0-5.5 1.7-5.5 5.5Z"/></svg>',
    link:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 1 0-7.07-7.07L11 4"/><path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 1 0 7.07 7.07L13 20"/></svg>',
    arrow:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m13 5 7 7-7 7"/></svg>',
    briefcase:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 12h18"/></svg>',
  };
  return icons[name] || "";
}

function renderAvatar(client, profile, fallbackLabel, businessName) {
  const avatarUrl = publicAvatarUrl(client, profile?.avatar_path);
  if (avatarUrl) {
    return `<img class="gr-cp__avatar-image" src="${escapeHtml(avatarUrl)}" alt="" />`;
  }
  const initial = (businessName || fallbackLabel || "g").trim().charAt(0).toUpperCase() || "G";
  return `<span class="gr-cp__avatar-fallback">${escapeHtml(initial)}</span>`;
}

async function loadCurrentProfile(client, userId) {
  try {
    const { data, error } = await client
      .from("profiles")
      .select(
        "id, full_name, role, linkedin_url, avatar_path, consultant_profiles(*), business_profiles(business_name, website_url, business_details, instagram_url, facebook_url, company_linkedin_url)"
      )
      .eq("id", userId)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  } catch (error) {
    console.warn("control panel profile load failed", error);
    return null;
  }
}

async function loadNotifications(client, userId) {
  try {
    const { data, error } = await client
      .from("notifications")
      .select("id, title, body, link, type, read, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(NOTIFICATION_LIMIT);

    if (error) throw error;
    return data || [];
  } catch (error) {
    if (!isMissing(error)) console.warn("control panel notifications load failed", error);
    return [];
  }
}

async function loadMessages(client, userId) {
  try {
    const { data, error } = await client
      .from("messages")
      .select("id, listing_id, sender_id, recipient_id, body, created_at")
      .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
      .order("created_at", { ascending: false })
      .limit(MESSAGE_LIMIT);

    if (error) throw error;
    return data || [];
  } catch (error) {
    if (!isMissing(error)) console.warn("control panel messages load failed", error);
    return [];
  }
}

async function loadEngagementSeedRows(client, userId, role) {
  if (role === "consultant") {
    try {
      const { data, error } = await client
        .from("bids")
        .select("id, listing_id, consultant_id, amount_cents, status, accepted_at")
        .eq("consultant_id", userId)
        .order("accepted_at", { ascending: false, nullsFirst: false })
        .limit(ENGAGEMENT_LIMIT * 3);

      if (error) throw error;
      return (data || []).filter((row) => row?.status === "accepted" || Boolean(row?.accepted_at));
    } catch (error) {
      if (!isMissing(error)) console.warn("control panel consultant engagements failed", error);
      return [];
    }
  }

  if (role === "business_owner") {
    try {
      const { data: listings, error: listingError } = await client
        .from("listings")
        .select("id")
        .eq("owner_id", userId)
        .limit(60);

      if (listingError) throw listingError;
      const listingIds = (listings || []).map((row) => row.id).filter(Boolean);
      if (!listingIds.length) return [];

      const { data: bids, error: bidError } = await client
        .from("bids")
        .select("id, listing_id, consultant_id, amount_cents, status, accepted_at")
        .in("listing_id", listingIds)
        .order("accepted_at", { ascending: false, nullsFirst: false })
        .limit(ENGAGEMENT_LIMIT * 3);

      if (bidError) throw bidError;
      return (bids || []).filter((row) => row?.status === "accepted" || Boolean(row?.accepted_at));
    } catch (error) {
      if (!isMissing(error)) console.warn("control panel owner engagements failed", error);
      return [];
    }
  }

  return [];
}

async function loadProfilesMap(client, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return new Map();

  try {
    const { data, error } = await client
      .from("profiles")
      .select("id, full_name, role, avatar_path")
      .in("id", ids);

    if (error) throw error;
    return new Map((data || []).map((row) => [row.id, row]));
  } catch (error) {
    console.warn("control panel profile map load failed", error);
    return new Map();
  }
}

async function loadBusinessNamesMap(client, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return new Map();

  try {
    const { data, error } = await client.from("business_profiles").select("user_id, business_name").in("user_id", ids);
    if (error) throw error;
    return new Map((data || []).map((row) => [row.user_id, row.business_name]));
  } catch (error) {
    if (!isMissing(error)) console.warn("control panel business names load failed", error);
    return new Map();
  }
}

async function loadListingsMap(client, listingIds) {
  const ids = [...new Set((listingIds || []).filter(Boolean))];
  if (!ids.length) return new Map();

  try {
    const { data, error } = await client
      .from("listings")
      .select("id, owner_id, title, status, business_display_name")
      .in("id", ids);

    if (error) throw error;
    return new Map((data || []).map((row) => [row.id, row]));
  } catch (error) {
    console.warn("control panel listings load failed", error);
    return new Map();
  }
}

function buildEngagementItems(seedRows, role, listingMap, profilesMap, businessNameMap) {
  return seedRows
    .slice(0, ENGAGEMENT_LIMIT)
    .map((row) => {
      const listing = listingMap.get(row.listing_id) || null;
      const counterpartId = role === "consultant" ? listing?.owner_id : row.consultant_id;
      const counterpartProfile = counterpartId ? profilesMap.get(counterpartId) : null;
      const counterpartBusinessName = counterpartId ? businessNameMap.get(counterpartId) : null;
      const counterpartName =
        role === "consultant"
          ? counterpartBusinessName || counterpartProfile?.full_name || listing?.business_display_name || "business"
          : counterpartProfile?.full_name || "consultant";

      return {
        bidId: row.id,
        listingId: row.listing_id,
        amountCents: row.amount_cents,
        title: listing?.title || "ongoing engagement",
        counterpartId,
        counterpartName,
        counterpartProfile,
        statusLabel: row.status === "accepted" ? "active" : "accepted",
        href: `/engagement.html?bid=${row.id}`,
      };
    })
    .filter((item) => item.listingId);
}

function buildThreadGroups(messages, userId, role, engagementItems, listingMap, profilesMap, businessNameMap) {
  const engagementByListing = new Map(engagementItems.map((item) => [item.listingId, item]));
  const grouped = new Map();

  for (const message of messages) {
    const otherUserId = message.sender_id === userId ? message.recipient_id : message.sender_id;
    const key = `${message.listing_id || "none"}:${otherUserId || "unknown"}`;
    if (grouped.has(key)) continue;

    const listing = listingMap.get(message.listing_id) || null;
    const otherProfile = otherUserId ? profilesMap.get(otherUserId) : null;
    const businessName = otherUserId ? businessNameMap.get(otherUserId) : null;
    const parsed = parseMessageBody(message.body);
    const activeEngagement = engagementByListing.get(message.listing_id);
    const isConversation = role === "consultant" ? Boolean(activeEngagement) : true;
    const otherLabel =
      otherProfile?.role === "business_owner"
        ? businessName || otherProfile?.full_name || listing?.business_display_name || "business"
        : otherProfile?.full_name || "consultant";

    grouped.set(key, {
      key,
      title: otherLabel,
      subtitle: listing?.title || parsed.context || "general message",
      preview: parsed.body || "open this thread to view the conversation.",
      time: relativeTime(message.created_at),
      href: activeEngagement ? activeEngagement.href : `/listing.html?id=${message.listing_id}`,
      category: isConversation ? "conversations" : "inquiries",
      avatarProfile: otherProfile,
      businessName,
    });
  }

  const inquiries = [];
  const conversations = [];
  for (const thread of grouped.values()) {
    if (thread.category === "inquiries") inquiries.push(thread);
    else conversations.push(thread);
  }

  return { inquiries, conversations };
}

function buildProfileSummary(profileRow, engagementsCompleted) {
  const role = profileRow?.role || "member";
  const firstName = getFirstName(profileRow?.full_name);
  const consultantProfile = getRelatedRow(profileRow?.consultant_profiles);
  const businessProfile = getRelatedRow(profileRow?.business_profiles);
  const avgRating = readNumericCandidate(consultantProfile, [
    "average_rating",
    "avg_rating",
    "rating_average",
    "rating_avg",
    "stars_average",
    "avg_stars",
    "rating",
  ]);

  if (role === "consultant") {
    const stage = calculateStage(engagementsCompleted, Number.isFinite(avgRating) ? avgRating : null);
    return {
      eyebrow: `stage ${stage.index}: ${stage.name}`,
      title: firstName,
      meta: [
        avgRating == null ? "rating pending" : `${avgRating.toFixed(1)} average rating`,
        `${engagementsCompleted} ${engagementsCompleted === 1 ? "engagement" : "engagements"}`,
      ],
      progressPercent: stage.progressPercent,
      progressCopy: stage.nextCopy,
      buttonLabel: "open full profile",
      href: "/profile.html",
    };
  }

  return {
    eyebrow: businessProfile?.business_name || "business owner",
    title: firstName,
    meta: [
      businessProfile?.website_url ? "website on file" : "profile in progress",
      `${engagementsCompleted} active ${engagementsCompleted === 1 ? "engagement" : "engagements"}`,
    ],
    progressPercent: null,
    progressCopy: "keep your profile current so consultants know how to work with you.",
    buttonLabel: "open full profile",
    href: "/profile.html",
  };
}

function getDefaultSection() {
  const path = window.location.pathname;
  if (path.includes("/profile")) return "profile";
  if (path.includes("/engagement")) return "engagements";
  if (path.includes("/listing")) return "messages";
  return "inbox";
}

function renderThreadList(client, items) {
  if (!items.length) {
    return '<p class="gr-cp__empty">nothing here yet.</p>';
  }

  return items
    .map((item) => {
      const avatar = renderAvatar(client, item.avatarProfile, item.title, item.businessName);
      return `
        <a class="gr-cp__thread" href="${escapeHtml(item.href)}">
          <span class="gr-cp__thread-avatar">${avatar}</span>
          <span class="gr-cp__thread-body">
            <span class="gr-cp__thread-top">
              <span class="gr-cp__thread-title">${escapeHtml(item.title)}</span>
              <span class="gr-cp__thread-time">${escapeHtml(item.time)}</span>
            </span>
            <span class="gr-cp__thread-subtitle">${escapeHtml(item.subtitle)}</span>
            <span class="gr-cp__thread-preview">${escapeHtml(item.preview)}</span>
          </span>
        </a>
      `;
    })
    .join("");
}

function renderNotificationList(notifications) {
  if (!notifications.length) {
    return '<p class="gr-cp__empty">you\'re all caught up.</p>';
  }

  return notifications
    .map((item) => {
      const href = item.link || "/notifications.html";
      const unreadClass = item.read ? "" : " is-unread";
      return `
        <a class="gr-cp__notification${unreadClass}" href="${escapeHtml(href)}">
          <span class="gr-cp__notification-title">${escapeHtml(item.title || "update")}</span>
          ${item.body ? `<span class="gr-cp__notification-body">${escapeHtml(item.body)}</span>` : ""}
          <span class="gr-cp__notification-time">${escapeHtml(relativeTime(item.created_at))}</span>
        </a>
      `;
    })
    .join("");
}

function renderEngagementList(client, role, items) {
  if (!items.length) {
    return `<p class="gr-cp__empty">${
      role === "consultant" ? "accepted work will show up here." : "ongoing work will show up here."
    }</p>`;
  }

  return items
    .map((item) => {
      const avatar = renderAvatar(client, item.counterpartProfile, item.counterpartName, item.counterpartName);
      return `
        <a class="gr-cp__engagement" href="${escapeHtml(item.href)}">
          <span class="gr-cp__engagement-avatar">${avatar}</span>
          <span class="gr-cp__engagement-body">
            <span class="gr-cp__engagement-kicker">${escapeHtml(item.counterpartName)}</span>
            <span class="gr-cp__engagement-title">${escapeHtml(item.title)}</span>
            <span class="gr-cp__engagement-meta">
              <span>${escapeHtml(item.statusLabel)}</span>
              <span>${
                Number.isFinite(Number(item.amountCents))
                  ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
                      Number(item.amountCents) / 100
                    )
                  : ""
              }</span>
            </span>
          </span>
          <span class="gr-cp__engagement-arrow">${icon("arrow")}</span>
        </a>
      `;
    })
    .join("");
}

function buildMarkup(client, data) {
  const {
    profileRow,
    businessName,
    notifications,
    threads,
    engagements,
    profileSummary,
  } = data;
  const avatar = renderAvatar(client, profileRow, profileRow?.full_name, businessName);
  const roleLabel = profileRow?.role === "consultant" ? "consultant" : "business owner";
  const hasUnreadInbox = notifications.some((item) => !item.read);
  const hasUnreadMessages = threads.inquiries.length + threads.conversations.length > 0;
  const activeSection = getDefaultSection();
  const engagementLabel = profileRow?.role === "consultant" ? "active engagements" : "ongoing work";
  const messageSectionLabel = profileRow?.role === "consultant" ? "messages" : "conversations";

  return `
    <aside class="gr-cp" id="gr-control-panel" data-role="${escapeHtml(profileRow?.role || "member")}">
      <div class="gr-cp__surface">
        <div class="gr-cp__top">
          <section class="gr-cp__hero">
            <div class="gr-cp__hero-avatar">${avatar}</div>
            <div class="gr-cp__hero-copy">
              <p class="gr-cp__hero-role">${escapeHtml(roleLabel)}</p>
              <h2 class="gr-cp__hero-name">${escapeHtml(businessName || profileRow?.full_name || "your account")}</h2>
              <p class="gr-cp__hero-subtitle">welcome back, ${escapeHtml(getFirstName(profileRow?.full_name || businessName))}.</p>
            </div>
          </section>
          <button class="gr-cp__toggle" id="gr-cp-toggle" type="button" aria-expanded="true" aria-label="collapse control panel">
            <span class="gr-cp__toggle-icon gr-cp__toggle-icon--collapse">${icon("collapse")}</span>
            <span class="gr-cp__toggle-icon gr-cp__toggle-icon--expand">${icon("expand")}</span>
          </button>
        </div>

        <nav class="gr-cp__nav" aria-label="Control panel sections">
          <button type="button" class="gr-cp__tab${activeSection === "inbox" ? " is-active" : ""}" data-cp-target="inbox">
            <span class="gr-cp__tab-icon">${icon("inbox")}${hasUnreadInbox && activeSection !== "inbox" ? '<span class="gr-cp__tab-dot"></span>' : ""}</span>
            <span class="gr-cp__tab-label">inbox</span>
          </button>
          <button type="button" class="gr-cp__tab${activeSection === "messages" ? " is-active" : ""}" data-cp-target="messages">
            <span class="gr-cp__tab-icon">${icon("messages")}${hasUnreadMessages && activeSection !== "messages" ? '<span class="gr-cp__tab-dot"></span>' : ""}</span>
            <span class="gr-cp__tab-label">${escapeHtml(messageSectionLabel)}</span>
          </button>
          <button type="button" class="gr-cp__tab${activeSection === "engagements" ? " is-active" : ""}" data-cp-target="engagements">
            <span class="gr-cp__tab-icon">${icon("engagement")}</span>
            <span class="gr-cp__tab-label">${escapeHtml(engagementLabel)}</span>
          </button>
          <button type="button" class="gr-cp__tab${activeSection === "profile" ? " is-active" : ""}" data-cp-target="profile">
            <span class="gr-cp__tab-icon">${icon("profile")}</span>
            <span class="gr-cp__tab-label">profile</span>
          </button>
        </nav>

        <div class="gr-cp__panels">
          <section class="gr-cp__panel${activeSection === "inbox" ? " is-active" : ""}" data-cp-panel="inbox">
            <div class="gr-cp__section-head">
              <div>
                <p class="gr-cp__section-kicker">inbox</p>
                <h3 class="gr-cp__section-title">latest notifications</h3>
              </div>
              <a class="gr-cp__section-link" href="/notifications.html">open inbox ${icon("arrow")}</a>
            </div>
            <div class="gr-cp__notification-list">
              ${renderNotificationList(notifications)}
            </div>
          </section>

          <section class="gr-cp__panel${activeSection === "messages" ? " is-active" : ""}" data-cp-panel="messages">
            <div class="gr-cp__section-head">
              <div>
                <p class="gr-cp__section-kicker">messages</p>
                <h3 class="gr-cp__section-title">open conversations</h3>
              </div>
            </div>
            ${
              profileRow?.role === "consultant"
                ? `
                  <div class="gr-cp__thread-group">
                    <div class="gr-cp__thread-group-head">
                      <span>${icon("link")} inquiries</span>
                      <span>${threads.inquiries.length}</span>
                    </div>
                    <div class="gr-cp__thread-list">
                      ${renderThreadList(client, threads.inquiries)}
                    </div>
                  </div>
                  <div class="gr-cp__thread-group">
                    <div class="gr-cp__thread-group-head">
                      <span>${icon("briefcase")} conversations</span>
                      <span>${threads.conversations.length}</span>
                    </div>
                    <div class="gr-cp__thread-list">
                      ${renderThreadList(client, threads.conversations)}
                    </div>
                  </div>
                `
                : `
                  <div class="gr-cp__thread-list">
                    ${renderThreadList(client, threads.conversations)}
                  </div>
                `
            }
          </section>

          <section class="gr-cp__panel${activeSection === "engagements" ? " is-active" : ""}" data-cp-panel="engagements">
            <div class="gr-cp__section-head">
              <div>
                <p class="gr-cp__section-kicker">${escapeHtml(engagementLabel)}</p>
                <h3 class="gr-cp__section-title">${
                  profileRow?.role === "consultant" ? "jump back into the work" : "manage ongoing work"
                }</h3>
              </div>
            </div>
            <div class="gr-cp__engagement-list">
              ${renderEngagementList(client, profileRow?.role, engagements)}
            </div>
          </section>

          <section class="gr-cp__panel${activeSection === "profile" ? " is-active" : ""}" data-cp-panel="profile">
            <div class="gr-cp__section-head">
              <div>
                <p class="gr-cp__section-kicker">profile</p>
                <h3 class="gr-cp__section-title">quick snapshot</h3>
              </div>
            </div>
            <div class="gr-cp__profile-card">
              <p class="gr-cp__profile-eyebrow">${escapeHtml(profileSummary.eyebrow)}</p>
              <h3 class="gr-cp__profile-name">${escapeHtml(profileSummary.title)}</h3>
              <div class="gr-cp__profile-meta">
                ${profileSummary.meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
              </div>
              ${
                profileSummary.progressPercent != null
                  ? `
                    <div class="gr-cp__profile-progress">
                      <div class="gr-cp__profile-progress-bar">
                        <span class="gr-cp__profile-progress-fill" data-progress-fill="${profileSummary.progressPercent}"></span>
                      </div>
                      <span class="gr-cp__profile-progress-label">${profileSummary.progressPercent}% to next stage</span>
                    </div>
                  `
                  : ""
              }
              <p class="gr-cp__profile-copy">${escapeHtml(profileSummary.progressCopy)}</p>
              <a class="gr-cp__profile-link" href="${escapeHtml(profileSummary.href)}">
                ${icon("sprout")}
                ${escapeHtml(profileSummary.buttonLabel)}
              </a>
            </div>
          </section>
        </div>
      </div>
    </aside>
  `;
}

function wirePanelInteractions() {
  document.querySelectorAll("[data-progress-fill]").forEach((node) => {
    const value = Number(node.getAttribute("data-progress-fill"));
    if (Number.isFinite(value)) {
      node.style.width = `${value}%`;
    }
  });

  const panel = document.getElementById("gr-control-panel");
  const toggle = document.getElementById("gr-cp-toggle");
  if (!panel || !toggle) return;

  const body = document.body;
  const tabs = [...panel.querySelectorAll("[data-cp-target]")];
  const panels = [...panel.querySelectorAll("[data-cp-panel]")];

  function setCollapsed(collapsed) {
    body.classList.toggle("gr-body--panel-collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", collapsed ? "expand control panel" : "collapse control panel");
    try {
      window.localStorage.setItem(PANEL_STORAGE_KEY, collapsed ? "1" : "0");
    } catch {}
  }

  function setActivePanel(name) {
    tabs.forEach((tab) => {
      const isTarget = tab.dataset.cpTarget === name;
      tab.classList.toggle("is-active", isTarget);
      if (isTarget) {
        const dot = tab.querySelector(".gr-cp__tab-dot");
        if (dot) dot.remove();
      }
    });
    panels.forEach((section) => {
      section.classList.toggle("is-active", section.dataset.cpPanel === name);
    });
  }

  toggle.addEventListener("click", () => {
    const nextState = !body.classList.contains("gr-body--panel-collapsed");
    setCollapsed(nextState);
  });

  panel.addEventListener("click", (e) => {
    if (!body.classList.contains("gr-body--panel-collapsed")) return;
    if (e.target instanceof Element && e.target.closest("[data-cp-target], #gr-cp-toggle, a, button, input, textarea, select")) {
      return;
    }
    setCollapsed(false);
  });

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      if (body.classList.contains("gr-body--panel-collapsed")) {
        setCollapsed(false);
      }
      setActivePanel(tab.dataset.cpTarget);
    });
  });

  document.addEventListener("click", (e) => {
    if (!body.classList.contains("gr-body--panel-collapsed") && !panel.contains(e.target)) {
      setCollapsed(true);
    }
  });

  let collapsed = false;
  try {
    collapsed = window.localStorage.getItem(PANEL_STORAGE_KEY) === "1";
  } catch {}
  setCollapsed(collapsed);
}

export async function initControlPanel(client) {
  const {
    data: { session },
  } = await client.auth.getSession();

  if (!session?.user) return null;
  if (document.getElementById("gr-control-panel")) return null;

  const main = document.querySelector("main");
  if (!main) return null;

  const profileRow = await loadCurrentProfile(client, session.user.id);
  if (!profileRow) return null;

  const [notifications, messages, engagementSeedRows] = await Promise.all([
    loadNotifications(client, session.user.id),
    loadMessages(client, session.user.id),
    loadEngagementSeedRows(client, session.user.id, profileRow.role),
  ]);

  const listingIds = new Set();
  const relatedUserIds = new Set();

  for (const message of messages) {
    if (message.listing_id) listingIds.add(message.listing_id);
    const otherUserId = message.sender_id === session.user.id ? message.recipient_id : message.sender_id;
    if (otherUserId) relatedUserIds.add(otherUserId);
  }

  for (const item of engagementSeedRows) {
    if (item.listing_id) listingIds.add(item.listing_id);
    if (profileRow.role === "business_owner" && item.consultant_id) relatedUserIds.add(item.consultant_id);
  }

  const listingMap = await loadListingsMap(client, [...listingIds]);
  if (profileRow.role === "consultant") {
    for (const listing of listingMap.values()) {
      if (listing?.owner_id) relatedUserIds.add(listing.owner_id);
    }
  }

  const profilesMap = await loadProfilesMap(client, [...relatedUserIds]);
  const businessNameMap = await loadBusinessNamesMap(client, [
    ...[...relatedUserIds].filter((id) => (profilesMap.get(id)?.role || "") === "business_owner"),
    profileRow.role === "business_owner" ? session.user.id : null,
  ]);

  const businessProfile = getRelatedRow(profileRow.business_profiles);
  const businessName = businessProfile?.business_name || businessNameMap.get(session.user.id) || null;
  const engagements = buildEngagementItems(
    engagementSeedRows,
    profileRow.role,
    listingMap,
    profilesMap,
    businessNameMap
  );
  const threads = buildThreadGroups(
    messages,
    session.user.id,
    profileRow.role,
    engagements,
    listingMap,
    profilesMap,
    businessNameMap
  );
  const profileSummary = buildProfileSummary(profileRow, engagements.length);

  document.body.classList.add("gr-body--with-control-panel");
  main.classList.add("gr-main-with-panel");
  main.insertAdjacentHTML("beforebegin", buildMarkup(client, {
    profileRow,
    businessName,
    notifications,
    threads,
    engagements,
    profileSummary,
  }));

  wirePanelInteractions();
  return {
    role: profileRow.role,
    unreadCount: notifications.filter((item) => !item.read).length,
    threadCount: threads.inquiries.length + threads.conversations.length,
    engagementCount: engagements.length,
  };
}
