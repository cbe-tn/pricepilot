// Resets a user's password directly in the database (no e-mail server is configured).
// Usage:  DATABASE_URL=<url> bun scripts/reset-password.ts <email> <new-password>
// Also signs the user out everywhere.
import { Client } from "pg";
import { hashPassword } from "../src/lib/auth-password";

const [email, password] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url || !email || !password) {
  console.error("Usage: DATABASE_URL=<url> bun scripts/reset-password.ts <email> <new-password>");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Le mot de passe doit contenir au moins 8 caractères.");
  process.exit(1);
}
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const db = new Client({ connectionString: url.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, ""), ssl: local ? undefined : { rejectUnauthorized: false } });
await db.connect();
const res = await db.query("update users set password_hash = $1 where lower(email) = lower($2) returning id", [await hashPassword(password), email]);
if (!res.rowCount) {
  console.error(`Aucun utilisateur avec l'e-mail ${email}.`);
  process.exit(1);
}
await db.query("delete from sessions where user_id = $1", [res.rows[0].id]);
console.log(`Mot de passe de ${email} réinitialisé.`);
await db.end();
