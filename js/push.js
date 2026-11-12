// Notifikationer på iPhone: kræver iOS 16.4+ og at appen er lagt på hjemmeskærmen.

function b64ToBytes(b64u) {
  const s = b64u.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64u.length + 3) % 4);
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

export async function registerSW() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("sw.js");
  } catch (err) {
    console.error("Service worker kunne ikke registreres", err);
    return null;
  }
}

/** on | off | denied | needs-install | unsupported | not-configured */
export async function pushStatus(vapidKey) {
  if (!vapidKey) return "not-configured";
  if (isIOS() && !isStandalone()) return "needs-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

/** Slå notifikationer til og gem abonnementet i databasen. Skal kaldes fra et tryk. */
export async function enablePush(db, vapidKey) {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Du skal tillade notifikationer for at få påmindelser.");
  const reg = (await navigator.serviceWorker.getRegistration()) || (await registerSW());
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapidKey) });
  await saveSubscription(db, sub);
  return sub;
}

export async function saveSubscription(db, sub) {
  const j = sub.toJSON();
  const { error } = await db.from("push_subscriptions").upsert({
    endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 200),
  }, { onConflict: "endpoint" });
  if (error) throw error;
}

/** Sørg for at abonnementet stadig er gemt (fx efter log ind på ny). */
export async function refreshSubscription(db) {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (sub && Notification.permission === "granted") await saveSubscription(db, sub);
  } catch (err) {
    console.warn("Kunne ikke opdatere abonnement", err);
  }
}

export async function disablePush(db) {
  const reg = await navigator.serviceWorker?.getRegistration();
  const sub = await reg?.pushManager?.getSubscription();
  if (!sub) return;
  await db.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}
