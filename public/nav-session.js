import { getSupabaseClient } from "/supabase-loader.js";

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

function buildProfileMenu(profileItem, currentPath, onSignOut) {
  if (!profileItem) return;

  profileItem.hidden = false;
  profileItem.classList.add("gr-nav__menu");

  const onProfilePage = currentPath === "/profile.html";

  profileItem.innerHTML = `
    <button
      type="button"
      class="gr-nav__menu-trigger"
      aria-haspopup="menu"
      aria-expanded="false"
      ${onProfilePage ? 'aria-current="page"' : ""}
    >
      <span>profile</span>
      <span class="gr-nav__menu-caret" aria-hidden="true">▾</span>
    </button>
    <div class="gr-nav__menu-panel" role="menu" hidden>
      <a class="gr-nav__menu-item" href="/profile.html" role="menuitem" ${onProfilePage ? 'aria-current="page"' : ""}>settings</a>
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

function renderSignedInNav(links, currentPath, onSignOut) {
  if (!links) return;
  if (links.signInItem) links.signInItem.hidden = true;
  if (links.registerItem) links.registerItem.hidden = true;
  if (links.profileItem) buildProfileMenu(links.profileItem, currentPath, onSignOut);
}

async function initNavSession() {
  const links = findNavLinks();
  if (!links) return;

  try {
    const client = await getSupabaseClient();

    const applySession = async (session) => {
      if (session?.user) {
        renderSignedInNav(links, window.location.pathname, async () => {
          await client.auth.signOut();
          window.location.href = "/";
        });
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
