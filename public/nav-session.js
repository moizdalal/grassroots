import { getSupabaseClient } from "/supabase-loader.js";
import { getInitials } from "/initials.js";

function findNavLinks() {
  const navLinks = document.querySelector(".gr-nav__links");
  if (!navLinks) return null;

  return {
    navLinks,
    signInItem: navLinks.querySelector('a[href="/signin.html"]')?.closest("li") || null,
    registerItem: navLinks.querySelector('a[href="/register.html"]')?.closest("li") || null,
    profileItem: navLinks.querySelector('a[href="/profile.html"]')?.closest("li") || null,
  };
}

function closeProfileMenu(menuRoot) {
  if (!menuRoot) return;
  const trigger = menuRoot.querySelector(".gr-nav__menu-trigger");
  const panel = menuRoot.querySelector(".gr-nav__menu-panel");
  if (!trigger || !panel) return;
  menuRoot.classList.remove("is-open");
  trigger.setAttribute("aria-expanded", "false");
  panel.hidden = true;
}

function buildProfileMenu(profileItem, currentPath, onSignOut, opts) {
  if (!profileItem) return;

  profileItem.hidden = false;
  profileItem.classList.add("gr-nav__menu");

  const onSettingsLikePath =
    currentPath === "/settings.html" || currentPath === "/profile.html";

  const initial = getInitials(opts?.fullName || opts?.email);
  const avatarUrl = opts?.avatarUrl || "";
  const avatarMarkup = avatarUrl
    ? `<img class="gr-nav__avatar" src="${avatarUrl}" alt="" />`
    : `<span class="gr-nav__avatar gr-nav__avatar--placeholder" aria-hidden="true">${initial}</span>`;

  profileItem.innerHTML = `
    <button
      type="button"
      class="gr-nav__menu-trigger gr-nav__menu-trigger--avatar"
      aria-haspopup="menu"
      aria-label="account menu"
      aria-expanded="false"
      ${onSettingsLikePath ? 'aria-current="page"' : ""}
    >
      ${avatarMarkup}
      <span class="gr-nav__menu-caret" aria-hidden="true">▾</span>
    </button>
    <div class="gr-nav__menu-panel" role="menu" hidden>
      <a class="gr-nav__menu-item" href="/settings.html" role="menuitem" ${currentPath === "/settings.html" ? 'aria-current="page"' : ""}>settings</a>
      <button type="button" class="gr-nav__menu-item" role="menuitem" data-nav-signout>sign out</button>
    </div>
  `;

  const trigger = profileItem.querySelector(".gr-nav__menu-trigger");
  const panel = profileItem.querySelector(".gr-nav__menu-panel");
  const signOutButton = profileItem.querySelector("[data-nav-signout]");

  trigger?.addEventListener("click", () => {
    const isOpen = profileItem.classList.toggle("is-open");
    trigger.setAttribute("aria-expanded", String(isOpen));
    panel.hidden = !isOpen;
  });

  signOutButton?.addEventListener("click", async () => {
    closeProfileMenu(profileItem);
    await onSignOut();
  });

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Node)) return;
    if (!profileItem.contains(event.target)) {
      closeProfileMenu(profileItem);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeProfileMenu(profileItem);
    }
  });
}

function renderGuestNav(links) {
  if (!links) return;
  if (links.signInItem) links.signInItem.hidden = false;
  if (links.registerItem) links.registerItem.hidden = false;
  if (links.profileItem) links.profileItem.hidden = true;
}

function renderSignedInNav(links, currentPath, onSignOut, opts) {
  if (!links) return;
  if (links.signInItem) links.signInItem.hidden = true;
  if (links.registerItem) links.registerItem.hidden = true;
  if (links.profileItem) buildProfileMenu(links.profileItem, currentPath, onSignOut, opts);
}

async function fetchProfileMeta(client, user) {
  try {
    const { data } = await client
      .from("profiles")
      .select("full_name, avatar_path")
      .eq("id", user.id)
      .maybeSingle();
    let avatarUrl = "";
    if (data?.avatar_path) {
      const { data: pub } = client.storage.from("avatars").getPublicUrl(data.avatar_path);
      avatarUrl = pub?.publicUrl || "";
    }
    return {
      fullName: data?.full_name || user.user_metadata?.full_name || "",
      email: user.email || "",
      avatarUrl,
    };
  } catch {
    return {
      fullName: user.user_metadata?.full_name || "",
      email: user.email || "",
      avatarUrl: "",
    };
  }
}

async function initNavSession() {
  const links = findNavLinks();
  if (!links) return;

  try {
    const client = await getSupabaseClient();

    const applySession = async (session) => {
      if (session?.user) {
        const meta = await fetchProfileMeta(client, session.user);
        renderSignedInNav(
          links,
          window.location.pathname,
          async () => {
            await client.auth.signOut();
            window.location.href = "/";
          },
          meta
        );
      } else {
        renderGuestNav(links);
      }
    };

    const {
      data: { session },
    } = await client.auth.getSession();

    await applySession(session);
    client.auth.onAuthStateChange(async (_event, nextSession) => {
      await applySession(nextSession);
    });
  } catch {
    renderGuestNav(links);
  }
}

initNavSession();
