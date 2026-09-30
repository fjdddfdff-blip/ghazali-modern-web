import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const getSnapshot = makeFunctionReference("sync:getSnapshot");
const saveSnapshot = makeFunctionReference("sync:saveSnapshot");
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64 = (bytes) => {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
};

const fromBase64 = (value) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const createSyncKey = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

export function installCloudSync() {
  const convexUrl = import.meta.env.VITE_CONVEX_URL;
  if (!convexUrl) {
    window.ghazaliCloud = { available: false, createSyncKey };
    return;
  }

  const client = new ConvexHttpClient(convexUrl);
  let syncId = "";
  let encryptionKey;
  let pendingTimer;
  let snapshotProvider;

  const initialize = async (rawKey) => {
    const keyBytes = encoder.encode(rawKey);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", keyBytes));
    syncId = toBase64(digest);
    encryptionKey = await crypto.subtle.importKey(
      "raw",
      digest,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  };

  const encrypt = async (value) => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      encryptionKey,
      encoder.encode(JSON.stringify(value)),
    ));
    return `${toBase64(iv)}.${toBase64(ciphertext)}`;
  };

  const decrypt = async (payload) => {
    const [ivValue, ciphertextValue] = payload.split(".");
    if (!ivValue || !ciphertextValue) throw new Error("Invalid encrypted snapshot");
    const cleartext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(ivValue) },
      encryptionKey,
      fromBase64(ciphertextValue),
    );
    return JSON.parse(decoder.decode(cleartext));
  };

  const push = async (snapshot) => {
    if (!syncId || !encryptionKey || !navigator.onLine) return null;
    const payload = await encrypt(snapshot);
    return await client.mutation(saveSnapshot, { syncId, payload, formatVersion: 1 });
  };

  const pull = async () => {
    if (!syncId || !encryptionKey || !navigator.onLine) return null;
    const remote = await client.query(getSnapshot, { syncId });
    if (!remote) return null;
    return { data: await decrypt(remote.payload), updatedAt: remote.updatedAt };
  };

  const flush = async () => {
    if (!snapshotProvider) return;
    try {
      const updatedAt = await push(snapshotProvider());
      if (updatedAt) window.dispatchEvent(new CustomEvent("ghazali-cloud-synced", { detail: { updatedAt } }));
    } catch (error) {
      console.warn("تعذر مزامنة بيانات الغزالي الآن؛ ستبقى البيانات محفوظة محلياً.", error);
    }
  };

  const schedule = (provider) => {
    snapshotProvider = provider;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(flush, 900);
  };

  window.addEventListener("online", flush);
  window.ghazaliCloud = {
    available: true,
    createSyncKey,
    initialize,
    pull,
    push,
    schedule,
    flush,
  };
}
