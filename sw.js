const BUILD_HASH = 'sarim-V.12.042026';
const CACHE_NAME = 'app-' + BUILD_HASH;

const ASSETS_TO_CACHE = [
  '/sarim/',
  '/sarim/index.html',
  '/sarim/app.css',
  '/sarim/constants.js',
  '/sarim/business.js',
  '/sarim/sync.js',
  '/sarim/utilities.js',
  '/sarim/factory.js',
  '/sarim/customers.js',
  '/sarim/rep-sales.js',
  '/sarim/admin-data.js',
  '/sarim/manifest.json',
  '/sarim/192.png',
  '/sarim/512.png',

  '/sarim/sql-wasm.js',
  '/sarim/sql-wasm.wasm',
  '/sarim/sql.js'
];

const CDN_ASSETS_TO_PRECACHE = [

  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js',

  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',

  'https://accounts.google.com/gsi/client',

  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js',

  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',

  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300;12..96,400;12..96,500;12..96,600;12..96,700;12..96,800&family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600;700;800;900&family=Geist+Mono:wght@300;400;500;600;700&family=Noto+Nastaliq+Urdu:wght@400;500;600;700&display=swap',
];

const CACHE_FIRST_ORIGINS = [
  'https://www.gstatic.com',
  'https://unpkg.com',
  'https://accounts.google.com',
  'https://cdnjs.cloudflare.com',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

const NOMINATIM_ORIGIN = 'https://nominatim.openstreetmap.org';

const OSM_TILE_ORIGIN = 'https://tile.openstreetmap.org';

const OFFLINE_TILE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)

      .then((cache) => cache.addAll(ASSETS_TO_CACHE))

      .then(() =>
        caches.open(CACHE_NAME).then((cache) =>
          Promise.allSettled(
            CDN_ASSETS_TO_PRECACHE.map((url) =>
              cache.add(new Request(url, { mode: 'cors', credentials: 'omit' })).catch(() => {})
            )
          )
        )
      )

      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => { if (key !== CACHE_NAME) return caches.delete(key); })))
      .then(() => clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

const FIREBASE_PROJECT = 'calculator-fabd3';
const FIRESTORE_BASE   = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;
const SW_TOKEN_FILE    = 'sw_sync_token.json';
const SQLITE_DB_FILE   = 'naswar_dealers.sqlite';

async function opfsRead(filename) {
  try {
    const root = await navigator.storage.getDirectory();
    const fh   = await root.getFileHandle(filename);
    return await (await fh.getFile()).text();
  } catch { return null; }
}
async function opfsWrite(filename, text) {
  try {
    const root = await navigator.storage.getDirectory();
    const fh   = await root.getFileHandle(filename, { create: true });
    const wr   = await fh.createWritable();
    await wr.write(text);
    await wr.close();
  } catch (e) { console.warn('[SW-BgSync] opfsWrite failed:', e); }
}

async function getSWAuthToken() {
  const raw = await opfsRead(SW_TOKEN_FILE);
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw);
    if (rec.expiry && Date.now() > rec.expiry - 60_000) return null;
    return rec;
  } catch { return null; }
}

function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean')          return { booleanValue: val };
  if (typeof val === 'number')           return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  if (typeof val === 'string')           return { stringValue: val };
  if (Array.isArray(val))                return { arrayValue: { values: val.map(toFirestoreValue) } };
  if (typeof val === 'object')           return { mapValue: { fields: toFirestoreFields(val) } };
  return { stringValue: String(val) };
}
function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) fields[k] = toFirestoreValue(v);
  }
  return fields;
}

async function executeViaREST(operation, uid, token) {
  const { collection, docId, data, action } = operation;
  const docPath = `users/${uid}/${collection}/${docId}`;
  const docURL  = `${FIRESTORE_BASE}/${docPath}`;
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  if (action === 'delete') {
    const delRes = await fetch(docURL, { method: 'DELETE', headers });
    if (!delRes.ok && delRes.status !== 404) throw new Error(`DELETE ${delRes.status}`);
    const tombURL  = `${FIRESTORE_BASE}/users/${uid}/deletions/${docId}`;
    const tombBody = {
      fields: toFirestoreFields({
        id: docId, recordId: docId, collection,
        recordType: operation.recordType || collection,
        deletedAt:  { seconds: Math.floor(Date.now() / 1000), nanos: 0 },
        expiresAt:  { seconds: Math.floor(Date.now() / 1000) + 90 * 24 * 3600, nanos: 0 },
      })
    };
    await fetch(
      `${tombURL}?updateMask.fieldPaths=id&updateMask.fieldPaths=recordId&updateMask.fieldPaths=collection&updateMask.fieldPaths=recordType&updateMask.fieldPaths=deletedAt&updateMask.fieldPaths=expiresAt`,
      { method: 'PATCH', headers, body: JSON.stringify(tombBody) }
    );
    return;
  }

  if (action === 'set' || action === 'update' || action === 'set-doc') {
    const payload = (data && typeof data === 'object') ? { ...data } : { value: data };
    if (!payload.isMerged) payload.updatedAt = new Date().toISOString();
    const body      = { fields: toFirestoreFields(payload) };
    const fieldMask = Object.keys(payload).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
    const url       = collection === 'inventory' ? docURL : `${docURL}?${fieldMask}`;
    const method    = collection === 'inventory' ? 'PUT' : 'PATCH';
    const res       = await fetch(url, { method, headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${method} ${res.status}: ${await res.text()}`);
    return;
  }

  throw new Error(`Unknown action: ${action}`);
}

async function readQueueFromOPFS(uid) {
  try {
    const root = await navigator.storage.getDirectory();
    const fh   = await root.getFileHandle(SQLITE_DB_FILE);
    const buf  = await (await fh.getFile()).arrayBuffer();
    return parseQueueFromSQLite(new Uint8Array(buf), uid);
  } catch (e) {
    console.warn('[SW-BgSync] Could not read SQLite from OPFS:', e);
    return null;
  }
}

function parseQueueFromSQLite(bytes, uid) {
  try {
    const dv       = new DataView(bytes.buffer);
    const pageSize = dv.getUint16(16);
    if (pageSize < 512) return null;
    const numPages  = Math.floor(bytes.length / pageSize);
    const targetKey = `${uid}:offline_operation_queue`;
    for (let p = 0; p < numPages; p++) {
      const off      = p * pageSize;
      const pageType = bytes[off];
      if (pageType !== 0x0d) continue;
      const cellCount = dv.getUint16(off + 3);
      for (let c = 0; c < cellCount; c++) {
        const cellPtrOff = off + 8 + c * 2;
        if (cellPtrOff + 2 > bytes.length) continue;
        const cellOff = dv.getUint16(cellPtrOff);
        if (cellOff + 10 > bytes.length) continue;
        try {
          const [payloadLen, bytesRead] = readVarint(bytes, off + cellOff);
          if (payloadLen <= 0 || payloadLen > 200_000) continue;
          const [, ridBytes]  = readVarint(bytes, off + cellOff + bytesRead);
          const headerStart   = off + cellOff + bytesRead + ridBytes;
          if (headerStart >= bytes.length) continue;
          const row = extractRowStrings(bytes, headerStart);
          if (row && row.some((s) => s === targetKey)) {
            const valueStr = row.find((s, i) => i > 0 && s && s.startsWith('['));
            if (valueStr) {
              const parsed = JSON.parse(valueStr);
              return Array.isArray(parsed) ? parsed : null;
            }
          }
        } catch { continue; }
      }
    }
    return null;
  } catch (e) {
    console.warn('[SW-BgSync] SQLite parse error:', e);
    return null;
  }
}

function readVarint(bytes, offset) {
  let result = 0, shift = 0, i = 0;
  while (offset + i < bytes.length) {
    const byte = bytes[offset + i++];
    result |= (byte & 0x7f) << shift;
    shift  += 7;
    if (!(byte & 0x80)) break;
  }
  return [result, i];
}

function extractRowStrings(bytes, start) {
  try {
    const [headerLen] = readVarint(bytes, start);
    const columns = [];
    let pos = start + 1;
    const headerEnd = start + headerLen;
    while (pos < headerEnd && columns.length < 10) {
      const [serial, n] = readVarint(bytes, pos);
      columns.push(serial);
      pos += n;
    }
    const strings = [];
    let dataPos = headerEnd;
    for (const serial of columns) {
      if (serial === 0) { strings.push(null); continue; }
      if (serial >= 13 && serial % 2 === 1) {
        const len = (serial - 13) / 2;
        strings.push(new TextDecoder().decode(bytes.slice(dataPos, dataPos + len)));
        dataPos += len;
      } else if (serial >= 12 && serial % 2 === 0) {
        const len = (serial - 12) / 2;
        strings.push(null);
        dataPos += len;
      } else {
        const sizes = [0, 1, 2, 3, 4, 6, 8, 8, 0, 0];
        strings.push(null);
        dataPos += (serial < sizes.length ? sizes[serial] : 0);
      }
    }
    return strings;
  } catch { return null; }
}

async function doBackgroundSync() {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  if (clients.length > 0) {
    clients.forEach((c) => c.postMessage({ type: 'PROCESS_QUEUE' }));
    return;
  }
  console.log('[SW-BgSync] App is closed, attempting direct Firestore sync…');
  const authRec = await getSWAuthToken();
  if (!authRec) { console.warn('[SW-BgSync] No valid auth token available, skipping.'); return; }
  const { token, uid } = authRec;
  const queue = await readQueueFromOPFS(uid);
  if (!queue || queue.length === 0) { console.log('[SW-BgSync] Queue is empty.'); return; }
  console.log(`[SW-BgSync] Processing ${queue.length} queued operation(s) for uid=${uid}`);
  const successIds = [];
  for (const item of queue) {
    if (!item || !item.operation) continue;
    try {
      await executeViaREST(item.operation, uid, token);
      successIds.push(item.id);
      console.log(`[SW-BgSync] ✓ synced ${item.operation.action} → ${item.operation.collection}/${item.operation.docId}`);
    } catch (e) {
      console.warn(`[SW-BgSync] ✗ failed ${item.operation.collection}/${item.operation.docId}:`, e.message);
    }
  }
  if (successIds.length > 0) {
    self.clients.matchAll({ includeUncontrolled: true }).then((cs) =>
      cs.forEach((c) => c.postMessage({ type: 'BG_SYNC_COMPLETE', syncedIds: successIds }))
    );
    console.log(`[SW-BgSync] Completed: ${successIds.length}/${queue.length} operations synced.`);
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'offline-queue-sync') event.waitUntil(doBackgroundSync());
});

const NETWORK_TIMEOUT_MS  = 4000;
const NAVIGATE_TIMEOUT_MS = 3000;
const API_TIMEOUT_MS      = 8000;

function fetchWithTimeout(request, timeout, opts) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error('SW timeout after ' + timeout + 'ms')); }, timeout);
    fetch(request, opts || {})
      .then(function (res) { clearTimeout(timer); resolve(res); })
      .catch(function (err) { clearTimeout(timer); reject(err); });
  });
}

function revalidateInBackground(cache, request, opts) {
  fetchWithTimeout(request, NETWORK_TIMEOUT_MS, opts)
    .then(function (res) { if (res && res.ok) cache.put(request, res); })
    .catch(function () {});
}

function cacheFirstResponse(event, opts) {
  event.respondWith(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(event.request).then(function (cached) {
        if (cached) {
          revalidateInBackground(cache, event.request, opts);
          return cached;
        }
        return fetchWithTimeout(event.request, NETWORK_TIMEOUT_MS, opts)
          .then(function (res) { if (res.ok) cache.put(event.request, res.clone()); return res; })
          .catch(function () { return new Response('', { status: 503 }); });
      });
    })
  );
}

self.addEventListener('fetch', function (event) {
  var url    = new URL(event.request.url);
  var method = event.request.method;

  if (method !== 'GET') return;

  if (url.origin === 'https://cdnjs.cloudflare.com' &&
      url.pathname.toLowerCase().includes('sql.js')) {
    return;
  }

  var isFirestoreAPI =
    url.hostname === 'firestore.googleapis.com' ||
    url.hostname === 'identitytoolkit.googleapis.com' ||
    url.hostname === 'securetoken.googleapis.com' ||
    (url.hostname === 'www.googleapis.com' && url.pathname.indexOf('/identitytoolkit') === 0);

  if (isFirestoreAPI) {
    event.respondWith(
      fetchWithTimeout(event.request, API_TIMEOUT_MS).catch(function () {
        return new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      })
    );
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE_NAME).then(function (cache) {

        return cache.match('/sarim/index.html')
          .then(function (cached) { return cached || cache.match(event.request); })
          .then(function (cached) {
            if (cached) {
              revalidateInBackground(cache, event.request);
              return cached;
            }
            return fetchWithTimeout(event.request, NAVIGATE_TIMEOUT_MS)
              .then(function (res) { if (res.ok) cache.put(event.request, res.clone()); return res; })
              .catch(function () {
                return new Response(
                  '<!doctype html><html><head><meta charset=utf-8><title>Offline</title>' +
                  '<meta name=viewport content="width=device-width,initial-scale=1">' +
                  '<style>body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;' +
                  'justify-content:center;min-height:100vh;margin:0;background:#121212;color:#e2e8f0;' +
                  'text-align:center;padding:2rem}h1{font-size:1.5rem;margin-bottom:.5rem}' +
                  'p{color:#94a3b8;margin-bottom:1.5rem}' +
                  'button{background:#009688;color:#fff;border:none;padding:.75rem 2rem;' +
                  'border-radius:8px;font-size:1rem;cursor:pointer}</style></head><body>' +
                  '<h1>You\'re Offline</h1>' +
                  '<p>Open the app once with internet to enable full offline access.</p>' +
                  '<button onclick="location.reload()">Try Again</button></body></html>',
                  { headers: { 'Content-Type': 'text/html' } }
                );
              });
          });
      })
    );
    return;
  }

  if (url.hostname.endsWith('.tile.openstreetmap.org') || url.origin === OSM_TILE_ORIGIN) {
    event.respondWith(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(event.request).then(function (cached) {
          if (cached) {
            revalidateInBackground(cache, event.request);
            return cached;
          }
          return fetchWithTimeout(event.request, NETWORK_TIMEOUT_MS)
            .then(function (res) { if (res.ok) cache.put(event.request, res.clone()); return res; })
            .catch(function () {

              var b64 = OFFLINE_TILE.split(',')[1];
              var bin = atob(b64);
              var bytes = new Uint8Array(bin.length);
              for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              return new Response(bytes.buffer, {
                status: 200,
                headers: { 'Content-Type': 'image/png' },
              });
            });
        });
      })
    );
    return;
  }

  if (url.origin === NOMINATIM_ORIGIN) {
    event.respondWith(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(event.request).then(function (cached) {
          if (cached) {
            revalidateInBackground(cache, event.request);
            return cached;
          }
          return fetchWithTimeout(event.request, NETWORK_TIMEOUT_MS)
            .then(function (res) { if (res.ok) cache.put(event.request, res.clone()); return res; })
            .catch(function () {
              return new Response(JSON.stringify({ error: 'offline' }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' },
              });
            });
        });
      })
    );
    return;
  }

  var isLocal = url.origin === self.location.origin && (
    url.pathname.endsWith('.js')   || url.pathname.endsWith('.css')  ||
    url.pathname.endsWith('.json') || url.pathname.endsWith('.png')  ||
    url.pathname.endsWith('.webp') || url.pathname.endsWith('.wasm') ||
    url.pathname.endsWith('.html') || url.pathname.endsWith('.ico')
  );

  if (isLocal) {
    cacheFirstResponse(event);
    return;
  }

  var isCachFirstOrigin = CACHE_FIRST_ORIGINS.some(function (o) { return url.origin === o; });

  if (isCachFirstOrigin) {
    cacheFirstResponse(event, { mode: 'cors', credentials: 'omit' });
    return;
  }

  cacheFirstResponse(event);
});
