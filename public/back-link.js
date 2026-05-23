// Role-aware back link. Pages opt in by adding data-role-back to the
// back anchor, plus data-owner-href / data-consultant-href / data-default-href
// (the default is also what's served to logged-out visitors).
import { getSupabaseClient } from "/supabase-loader.js";

(async () => {
  const back = document.querySelector("a[data-role-back]");
  if (!back) return;

  try {
    const client = await getSupabaseClient();
    const { data: { session } } = await client.auth.getSession();
    if (!session?.user) return;
    const { data: profile } = await client
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();
    const role = profile?.role;
    if (role === "consultant" && back.dataset.consultantHref) {
      back.setAttribute("href", back.dataset.consultantHref);
    } else if (role === "business_owner" && back.dataset.ownerHref) {
      back.setAttribute("href", back.dataset.ownerHref);
    }
  } catch {
    // keep the default href
  }
})();
