const app = require("./app");

const port = Number(process.env.PORT || 3000);
const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();

app.listen(port, () => {
  console.log(`MVP registration app running on http://localhost:${port}`);
  if (supabaseUrl) {
    console.log(
      `[supabase] ${supabaseUrl} — if you edited .env, restart this process (old env sticks until restart).`
    );
  }
});
