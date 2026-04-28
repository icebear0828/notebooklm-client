import { loadSession, refreshTokens } from './dist/session-store.js';
async function run() {
  const session = await loadSession();
  if (!session) {
    console.log("No session found");
    return;
  }
  try {
    const fresh = await refreshTokens(session);
    console.log("Refresh succeeded, new at:", fresh.at);
  } catch(e) {
    console.error("Refresh failed with exact error:", e);
  }
}
run();
