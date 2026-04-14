const form = document.getElementById("registration-form");
const roleSelect = document.getElementById("role");
const businessFields = document.getElementById("business-fields");
const statusEl = document.getElementById("status");

const toggleRoleSections = () => {
  const isBusinessOwner = roleSelect.value === "business_owner";
  businessFields.classList.toggle("hidden", !isBusinessOwner);
};

roleSelect.addEventListener("change", toggleRoleSections);
toggleRoleSections();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.textContent = "Submitting registration...";
  statusEl.className = "";

  try {
    const formData = new FormData(form);
    const response = await fetch("/api/register", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Registration failed.");
    }

    statusEl.innerHTML = `Success! Account created as ${data.role}. You can <a href="/signin.html">sign in</a> next.`;
    statusEl.className = "success";
    form.reset();
    toggleRoleSections();
  } catch (error) {
    statusEl.textContent = error.message || "Unexpected error.";
    statusEl.className = "error";
  }
});
