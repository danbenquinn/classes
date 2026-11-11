// ─────────────────────────────────────────────────────────────
// Shared config + transport for the accelerometer prototype.
//
// Fill these two values from your Supabase project:
//   URL: Connect button (or Settings → Data API). Key: Settings → API Keys,
//   the *publishable* key (sb_publishable_...). It is meant to be public.
// Leave them empty to run in LOCAL TEST MODE: analyzer and phone
// talk through BroadcastChannel, so both must be tabs in the same
// browser (add ?sim=1 to the phone URL for a fake sensor).
// ─────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://rdbacwwbeyeqdkswwvjt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_IQNxMMynit0aWtOS3tjiRQ_h5sNo159";

// ?local=1 forces local mode even with keys set (testing on one laptop; the workshop deck's ?livetest=1 uses it)
const LOCAL_MODE = !SUPABASE_URL || !SUPABASE_ANON_KEY || new URLSearchParams(location.search).has("local");
const PEER_TIMEOUT_MS = 4000;

function randomId(n = 8) {
  const a = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  const r = crypto.getRandomValues(new Uint8Array(n));
  for (const b of r) s += a[b % a.length];
  return s;
}

/**
 * openRoom(room, me, {onMessage, onPeers})
 *   me      = { id, role: "analyzer" | "phone" }
 *   onPeers(list of {id, role}) fires whenever who-is-here changes
 * returns { send(msg), close() }
 *
 * Supabase: Realtime broadcast for messages + Presence for who is here
 * (no tables, nothing stored). Local: BroadcastChannel + heartbeats.
 */
async function openRoom(room, me, { onMessage, onPeers, onStatus }) {
  const status = (s) => onStatus && onStatus(s);
  if (!LOCAL_MODE) return openSupabaseRoom(room, me, onMessage, onPeers, status);
  return openLocalRoom(room, me, onMessage, onPeers, status);
}

const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js";

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve;
    s.onerror = () => reject(new Error("Could not load " + src));
    document.head.appendChild(s);
  });
}

async function openSupabaseRoom(room, me, onMessage, onPeers, status) {
  if (!window.supabase) await loadScript(SUPABASE_JS);
  // supabase-js throttles each client to 10 sends/s by default; the phone sends 5 batches/s plus
  // the odd control message, so give it headroom rather than silently dropping a batch.
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY,
    { realtime: { params: { eventsPerSecond: 20 } } });
  const ch = client.channel("accel-" + room, {
    config: { broadcast: { self: false, ack: false }, presence: { key: me.id } },
  });
  ch.on("broadcast", { event: "msg" }, ({ payload }) => onMessage(payload));
  ch.on("presence", { event: "sync" }, () => {
    const state = ch.presenceState();
    const list = [];
    for (const key in state) {
      const meta = state[key][0];
      if (key !== me.id && meta) list.push({ id: key, role: meta.role });
    }
    onPeers(list);
  });
  return new Promise((resolve, reject) => {
    ch.subscribe(async (s) => {
      status(s);
      if (s === "SUBSCRIBED") {
        await ch.track({ role: me.role });
        resolve({
          send: (msg) => ch.send({ type: "broadcast", event: "msg", payload: msg }),
          close: async () => { await ch.untrack(); await client.removeChannel(ch); },
        });
      } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
        reject(new Error("Realtime connection failed (" + s + ")"));
      }
    });
  });
}

function openLocalRoom(room, me, onMessage, onPeers, status) {
  const bc = new BroadcastChannel("accel-" + room);
  const peers = new Map(); // id -> {role, seen}
  let lastSig = "";
  const emitPeers = () => {
    const now = Date.now();
    for (const [id, p] of peers) if (now - p.seen > PEER_TIMEOUT_MS) peers.delete(id);
    const list = [...peers].map(([id, p]) => ({ id, role: p.role }));
    const sig = JSON.stringify(list);
    if (sig !== lastSig) { lastSig = sig; onPeers(list); }
  };
  bc.onmessage = (e) => {
    const m = e.data;
    if (m.__hb) {
      if (m.leave) peers.delete(m.id);
      else peers.set(m.id, { role: m.role, seen: Date.now() });
      emitPeers();
    } else onMessage(m);
  };
  const beat = () => bc.postMessage({ __hb: 1, id: me.id, role: me.role });
  beat();
  const hb = setInterval(() => { beat(); emitPeers(); }, 1000);
  let closed = false;
  const bye = () => { if (!closed) bc.postMessage({ __hb: 1, id: me.id, leave: 1 }); };
  window.addEventListener("pagehide", bye);
  status("SUBSCRIBED");
  return Promise.resolve({
    send: (msg) => { if (!closed) bc.postMessage(msg); },
    close: () => { clearInterval(hb); bye(); closed = true; bc.close(); },
  });
}
