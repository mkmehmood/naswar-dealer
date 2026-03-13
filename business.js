function _safeErr(err) {
  if (err === null || err === undefined) return new Error('Unknown error (null)');
  if (err instanceof Error) return err;
  if (err instanceof DOMException) return new Error('[DOMException] ' + err.name + ': ' + err.message);
  if (typeof err === 'object') {
    try { return new Error(JSON.stringify(err)); } catch (_) { return new Error(String(err)); }
  }
  return new Error(String(err));
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
const esc = escapeHtml;
function _triggerFileDownload(blob, filename) {
  if (typeof window.navigator.msSaveBlob === 'function') {
    window.navigator.msSaveBlob(blob, filename);
    return;
  }
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  setTimeout(() => {
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    }, 300);
  }, 0);
}
function _readFileAsArrayBuffer(file) {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload  = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error('FileReader failed'));
    fr.readAsArrayBuffer(file);
  });
}
function _readFileAsText(file) {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload  = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error('FileReader failed'));
    fr.readAsText(file);
  });
}
const GNDVirtualScroll = (() => {
  const OVERSCAN   = 5;
  const FALLBACK_H = 44;
  const _instances = new Map();
  function _makeSpacerRow(colSpan) {
    const tr = document.createElement('tr');
    tr.setAttribute('aria-hidden', 'true');
    const td = document.createElement('td');
    td.colSpan  = colSpan;
    td.style.cssText = 'height:0px; padding:0; border:none; pointer-events:none;';
    tr.appendChild(td);
    tr.style.cssText = 'height:0px; pointer-events:none;';
    return tr;
  }
  function _setSpacerHeight(spacerRow, px) {
    const h = Math.max(0, Math.round(px)) + 'px';
    spacerRow.style.height = h;
    spacerRow.firstElementChild.style.height = h;
  }
  function _colSpanOf(tbody) {
    const first = Array.from(tbody.rows).find(r => !r.hasAttribute('aria-hidden'));
    if (first) return first.cells.length || 5;
    const table = tbody.closest('table');
    if (table) {
      const hRow = table.querySelector('thead tr');
      if (hRow) return hRow.cells.length || 5;
    }
    return 5;
  }
  function _render(inst) {
    const { scroller, tbody, items, buildRow, topSpacer, botSpacer } = inst;
    const rowH    = inst.rowHeight || FALLBACK_H;
    const scrollH = scroller.clientHeight;
    const scrollT = scroller.scrollTop;
    if (items.length === 0) return;
    const firstVis = Math.max(0, Math.floor(scrollT / rowH) - OVERSCAN);
    const lastVis  = Math.min(items.length - 1,
                       Math.ceil((scrollT + scrollH) / rowH) + OVERSCAN);
    if (inst.renderedFirst === firstVis && inst.renderedLast === lastVis) return;
    inst.renderedFirst = firstVis;
    inst.renderedLast  = lastVis;
    const frag = document.createDocumentFragment();
    for (let i = firstVis; i <= lastVis; i++) {
      const el = buildRow(items[i], i);
      if (el) frag.appendChild(el);
    }
    _setSpacerHeight(topSpacer, firstVis * rowH);
    _setSpacerHeight(botSpacer, (items.length - 1 - lastVis) * rowH);
    let child = topSpacer.nextSibling;
    while (child && child !== botSpacer) {
      const next = child.nextSibling;
      tbody.removeChild(child);
      child = next;
    }
    tbody.insertBefore(frag, botSpacer);
  }
  function _measureRowHeight(inst) {
    const first = Array.from(inst.tbody.rows).find(r => !r.hasAttribute('aria-hidden'));
    if (first && first.offsetHeight > 0) {
      inst.rowHeight = first.offsetHeight;
    }
  }
  function mount(scrollerId, items, buildRow, tbody) {
    destroy(scrollerId);
    const scroller = document.getElementById(scrollerId);
    if (!scroller) {
      tbody.innerHTML = '';
      const frag = document.createDocumentFragment();
      items.forEach((item, i) => {
        const el = buildRow(item, i);
        if (el) frag.appendChild(el);
      });
      tbody.appendChild(frag);
      return;
    }
    if (!items || items.length === 0) {
      tbody.innerHTML = '';
      return;
    }
    const colSpan  = _colSpanOf(tbody) || 5;
    const topSpacer = _makeSpacerRow(colSpan);
    const botSpacer = _makeSpacerRow(colSpan);
    tbody.innerHTML = '';
    tbody.appendChild(topSpacer);
    tbody.appendChild(botSpacer);
    const inst = {
      scroller, tbody, items, buildRow,
      topSpacer, botSpacer,
      rowHeight: FALLBACK_H,
      renderedFirst: -1,
      renderedLast:  -1,
      rafId: null,
      scrollHandler: null,
      resizeObs: null,
      intersectionObs: null,
    };
    _instances.set(scrollerId, inst);
    _render(inst);
    requestAnimationFrame(() => {
      _measureRowHeight(inst);
      _render(inst);
    });
    inst.scrollHandler = () => {
      if (inst.rafId) return;
      inst.rafId = requestAnimationFrame(() => {
        inst.rafId = null;
        _render(inst);
      });
    };
    scroller.addEventListener('scroll', inst.scrollHandler, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      inst.resizeObs = new ResizeObserver(() => {
        inst.renderedFirst = -1;
        inst.renderedLast  = -1;
        _measureRowHeight(inst);
        _render(inst);
      });
      inst.resizeObs.observe(scroller);
    }
    if (typeof IntersectionObserver !== 'undefined') {
      inst.intersectionObs = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting) {
          inst.renderedFirst = -1;
          inst.renderedLast  = -1;
          _measureRowHeight(inst);
          _render(inst);
        }
      }, { threshold: 0 });
      inst.intersectionObs.observe(scroller);
    }
  }
  function destroy(scrollerId) {
    const inst = _instances.get(scrollerId);
    if (!inst) return;
    if (inst.rafId) cancelAnimationFrame(inst.rafId);
    if (inst.scrollHandler) inst.scroller.removeEventListener('scroll', inst.scrollHandler);
    if (inst.resizeObs)      inst.resizeObs.disconnect();
    if (inst.intersectionObs) inst.intersectionObs.disconnect();
    _instances.delete(scrollerId);
  }
  return { mount, destroy };
})();
if (window.trustedTypes && window.trustedTypes.createPolicy) {
  window._gndHTMLPolicy = window.trustedTypes.createPolicy('gnd-html-policy', {
    createHTML: (s) => s
  });
  window.setHTML = (el, html) => {
    el.innerHTML = window._gndHTMLPolicy.createHTML(html);
  };
} else {
  window.setHTML = (el, html) => { el.innerHTML = html; };
}
const CryptoEngine = (() => {
const MAGIC = new Uint8Array([0x47,0x5A,0x4E,0x44,0x5F,0x45,0x4E,0x43,0x5F,0x56,0x32]);
const SALT_LEN = 32;
const IV_LEN = 12;
const PBKDF2_ITERS = 100000;
async function deriveKey(email, password, salt) {
const enc = new TextEncoder();
const keyMaterial = await crypto.subtle.importKey(
'raw',
enc.encode(email.toLowerCase().trim() + ':' + password),
'PBKDF2',
false,
['deriveKey']
);
return crypto.subtle.deriveKey(
{ name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
keyMaterial,
{ name: 'AES-GCM', length: 256 },
false,
['encrypt', 'decrypt']
);
}
async function deriveKeyHash(email, password) {
const enc = new TextEncoder();
const keyMaterial = await crypto.subtle.importKey(
'raw', enc.encode(email.toLowerCase().trim() + ':' + password),
'PBKDF2', false, ['deriveKey']
);
const fixedSalt = enc.encode('GZND_LOCAL_AUTH_SALT_v2_' + email.toLowerCase().trim());
const key = await crypto.subtle.deriveKey(
{ name: 'PBKDF2', salt: fixedSalt, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
keyMaterial, { name: 'AES-GCM', length: 256 }, true, ['encrypt']
);
const raw = await crypto.subtle.exportKey('raw', key);
const hashBuf = await crypto.subtle.digest('SHA-256', raw);
return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
}
return {
async encrypt(dataObj, email, password) {
const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
const key = await deriveKey(email, password, salt);
const plaintext = new TextEncoder().encode(JSON.stringify(dataObj));
const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
const ctBytes = new Uint8Array(ciphertext);
const out = new Uint8Array(MAGIC.length + SALT_LEN + IV_LEN + ctBytes.length);
let offset = 0;
out.set(MAGIC, offset); offset += MAGIC.length;
out.set(salt, offset); offset += SALT_LEN;
out.set(iv, offset); offset += IV_LEN;
out.set(ctBytes, offset);
return new Blob([out], { type: 'application/octet-stream' });
},
async decrypt(arrayBuffer, email, password) {
const bytes = new Uint8Array(arrayBuffer);
const magic = bytes.slice(0, MAGIC.length);
for (let i = 0; i < MAGIC.length; i++) {
if (magic[i] !== MAGIC[i]) throw new Error('INVALID_FORMAT');
}
let offset = MAGIC.length;
const salt = bytes.slice(offset, offset + SALT_LEN); offset += SALT_LEN;
const iv = bytes.slice(offset, offset + IV_LEN); offset += IV_LEN;
const ciphertext = bytes.slice(offset);
const key = await deriveKey(email, password, salt);
let plaintext;
try {
plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
} catch(e) {
throw new Error('WRONG_CREDENTIALS');
}
return JSON.parse(new TextDecoder().decode(plaintext));
},
async hashCredentials(email, password) {
return deriveKeyHash(email, password);
}
};
})();
const OfflineAuth = {
IDB_NAME: 'GZND_AuthDB',
STORE: 'credentials',
async _getDB() {
return new Promise((res, rej) => {
const req = indexedDB.open(this.IDB_NAME, 1);
req.onupgradeneeded = e => {
e.target.result.createObjectStore(this.STORE);
};
req.onsuccess = e => res(e.target.result);
req.onerror = e => rej(e.target.error || new Error('OfflineAuth: IDB open failed'));
});
},
async saveCredentials(email, password) {
const hash = await CryptoEngine.hashCredentials(email, password);
const db = await this._getDB();
return new Promise((res, rej) => {
const tx = db.transaction(this.STORE, 'readwrite');
tx.objectStore(this.STORE).put({ hash, email, savedAt: Date.now() }, 'active');
tx.oncomplete = () => res(true);
tx.onerror = e => rej(e.target.error || new Error('OfflineAuth: saveCredentials failed'));
});
},
async verifyCredentials(email, password) {
const db = await this._getDB();
const record = await new Promise((res, rej) => {
const tx = db.transaction(this.STORE, 'readonly');
const req = tx.objectStore(this.STORE).get('active');
req.onsuccess = e => res(e.target.result);
req.onerror = e => rej(e.target.error || new Error('OfflineAuth: verifyCredentials read failed'));
});
if (!record) return false;
if (record.email.toLowerCase().trim() !== email.toLowerCase().trim()) return false;
const hash = await CryptoEngine.hashCredentials(email, password);
return hash === record.hash;
},
async getSavedEmail() {
const db = await this._getDB();
const record = await new Promise((res, rej) => {
const tx = db.transaction(this.STORE, 'readonly');
const req = tx.objectStore(this.STORE).get('active');
req.onsuccess = e => res(e.target.result);
req.onerror = () => res(null);
});
return record ? record.email : null;
},
async hasStoredCredentials() {
const email = await this.getSavedEmail();
return !!email;
},
async clearCredentials() {
const db = await this._getDB();
return new Promise((res, rej) => {
const tx = db.transaction(this.STORE, 'readwrite');
tx.objectStore(this.STORE).delete('active');
tx.oncomplete = () => res(true);
tx.onerror = e => rej(e.target.error || new Error('OfflineAuth: clearCredentials failed'));
});
}
};
async function _checkFirebaseSessionExists() {
try {
if ('databases' in indexedDB) {
const dbs = await indexedDB.databases();
const hasFirebaseDB = dbs.some(d =>
d.name && (d.name.includes('firebaseLocalStorage') || d.name.includes('firebase'))
);
if (hasFirebaseDB) {
const tokenExists = await _readFirebaseTokenFromIDB();
if (tokenExists) return true;
}
}
const sessionFlag = sessionStorage.getItem('_gznd_session_active');
if (sessionFlag === '1') return true;
try {
  const lsFlag = localStorage.getItem('_gznd_session_active');
  if (lsFlag === '1') return true;
  const persistentLogin = localStorage.getItem('persistentLogin');
  if (persistentLogin) {
    const parsed = JSON.parse(persistentLogin);
    if (parsed && parsed.uid) return true;
  }
} catch(e) {}
return false;
} catch(e) {
return false;
}
}
async function _readFirebaseTokenFromIDB() {
try {
const dbs = await indexedDB.databases();
const firebaseDB_name = dbs.find(d => d.name && d.name.includes('firebaseLocalStorage'));
if (!firebaseDB_name) return false;
return new Promise((resolve) => {
const req = indexedDB.open(firebaseDB_name.name);
req.onsuccess = (e) => {
const db = e.target.result;
const stores = Array.from(db.objectStoreNames);
if (stores.length === 0) { db.close(); resolve(false); return; }
try {
const tx = db.transaction(stores[0], 'readonly');
const store = tx.objectStore(stores[0]);
const getAllReq = store.getAll();
getAllReq.onsuccess = () => {
db.close();
const results = getAllReq.result || [];
const hasUser = results.some(r => r && r.value && (r.value.uid || r.value.email));
resolve(hasUser);
};
getAllReq.onerror = () => { db.close(); resolve(false); };
} catch(txErr) { db.close(); resolve(false); }
};
req.onerror = () => resolve(false);
});
} catch(e) { return false; }
}
const IDBCrypto = (() => {
  let _sessionKey = null;
  let _keyEmail = null;
  let _db = null;
  let _initPromise = null;
  let _preWarmPromise = null;
  const PBKDF2_ITERS = 100000;
  const DB_NAME = 'GZND_SecureStorage';
  const DB_VERSION = 3;
  const KEY_STORE = 'encryptedKeys';
  const ENTROPY_STORE = 'deviceEntropy';
  const SESSION_STORE = 'userSession';
  const WRAPKEY_CACHE_STORE = 'wrapKeyCache';
  const IDB_KDF_SALT = new Uint8Array([
    0x47,0x5A,0x4E,0x44,0x49,0x44,0x42,0x4B,
    0x45,0x59,0x53,0x41,0x4C,0x54,0x76,0x31,
    0x32,0x30,0x32,0x34,0x41,0x45,0x53,0x32,
    0x35,0x36,0x47,0x43,0x4D,0x45,0x4E,0x43
  ]);
  const IV_LEN = 12;
  const ENC_PREFIX = 'GZND_ENC_';
  const KEY_VERSION = '3';
  const LEGACY_LS_KEY = '_gznd_idbk_v2';
  const LEGACY_LS_SECRET = '_gznd_wksec_v2';
  const LEGACY_LS_EMAIL = '_gznd_key_email';
  async function _initDB() {
    if (_db) return _db;
    if (_initPromise) return _initPromise;
    _initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => {
        _initPromise = null;
        reject(request.error || new Error("IDB request failed"));
      };
      request.onsuccess = () => {
        _db = request.result;
        resolve(_db);
      };
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(KEY_STORE)) {
          const keyStore = db.createObjectStore(KEY_STORE, { keyPath: 'id' });
          keyStore.createIndex('email', 'email', { unique: false });
          keyStore.createIndex('version', 'version', { unique: false });
        }
        if (!db.objectStoreNames.contains(ENTROPY_STORE)) {
          db.createObjectStore(ENTROPY_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(SESSION_STORE)) {
          db.createObjectStore(SESSION_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(WRAPKEY_CACHE_STORE)) {
          db.createObjectStore(WRAPKEY_CACHE_STORE, { keyPath: 'id' });
        }
      };
    });
    return _initPromise;
  }
  async function _getDeviceEntropy() {
    const db = await _initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ENTROPY_STORE, 'readonly');
      const store = tx.objectStore(ENTROPY_STORE);
      const request = store.get('primary');
      request.onsuccess = async () => {
        if (request.result) {
          const entropyHex = request.result.entropy;
          const entropy = new Uint8Array(entropyHex.match(/.{2}/g).map(h => parseInt(h, 16)));
          resolve(entropy);
        } else {
          const newEntropy = crypto.getRandomValues(new Uint8Array(32));
          const entropyHex = Array.from(newEntropy).map(b => b.toString(16).padStart(2, '0')).join('');
          try {
            const writeTx = db.transaction(ENTROPY_STORE, 'readwrite');
            const writeStore = writeTx.objectStore(ENTROPY_STORE);
            await new Promise((res, rej) => {
              const writeReq = writeStore.put({ id: 'primary', entropy: entropyHex });
              writeReq.onsuccess = () => res();
              writeReq.onerror = () => rej(writeReq.error);
            });
          } catch (e) {
            console.warn('IDBCrypto: Could not persist device entropy, using memory-only');
          }
          resolve(newEntropy);
        }
      };
      request.onerror = () => reject(request.error || new Error("IDB request failed"));
    });
  }
  async function _getCachedWrapKeyBytes(saltHex) {
    try {
      const db = await _initDB();
      const result = await new Promise((res, rej) => {
        const tx = db.transaction(WRAPKEY_CACHE_STORE, 'readonly');
        const req = tx.objectStore(WRAPKEY_CACHE_STORE).get('primary');
        req.onsuccess = () => res(req.result);
        req.onerror = () => res(null);
      });
      if (result && result.saltHex === saltHex && result.keyBytes) return result.keyBytes;
    } catch (e) {}
    return null;
  }
  async function _setCachedWrapKeyBytes(saltHex, keyBytes) {
    try {
      const db = await _initDB();
      const tx = db.transaction(WRAPKEY_CACHE_STORE, 'readwrite');
      tx.objectStore(WRAPKEY_CACHE_STORE).put({ id: 'primary', saltHex, keyBytes, ts: Date.now() });
    } catch (e) {}
  }
  async function _idbSessionSet(id, value) {
    try {
      const db = await _initDB();
      await new Promise((res, rej) => {
        const tx = db.transaction(SESSION_STORE, 'readwrite');
        const req = tx.objectStore(SESSION_STORE).put({ id, ...value });
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      if (id === 'active') {
        try { localStorage.setItem('_gznd_session_active', '1'); } catch(e) {}
      }
      if (id === 'login') {
        try { localStorage.setItem('persistentLogin', JSON.stringify(value)); } catch(e) {}
      }
    } catch (e) {}
  }
  async function _idbSessionGet(id) {
    try {
      const db = await _initDB();
      return await new Promise((res) => {
        const tx = db.transaction(SESSION_STORE, 'readonly');
        const req = tx.objectStore(SESSION_STORE).get(id);
        req.onsuccess = () => res(req.result || null);
        req.onerror = () => res(null);
      });
    } catch (e) { return null; }
  }
  async function _idbSessionDelete(id) {
    try {
      const db = await _initDB();
      await new Promise((res) => {
        const tx = db.transaction(SESSION_STORE, 'readwrite');
        tx.objectStore(SESSION_STORE).delete(id);
        tx.oncomplete = () => res();
        tx.onerror = () => res();
      });
    } catch(e) {}
  }
  async function deriveSessionKey(email, password) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(email.toLowerCase().trim() + ':' + password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: IDB_KDF_SALT,
        iterations: PBKDF2_ITERS,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }
  async function deriveWrappingKey(wrapSalt) {
    const saltHex = Array.from(wrapSalt).map(b => b.toString(16).padStart(2, '0')).join('');
    const cachedBytes = await _getCachedWrapKeyBytes(saltHex);
    if (cachedBytes) {
      try {
        return await crypto.subtle.importKey(
          'raw',
          new Uint8Array(cachedBytes),
          { name: 'AES-KW' },
          false,
          ['wrapKey', 'unwrapKey']
        );
      } catch (e) {
      }
    }
    const deviceEntropy = await _getDeviceEntropy();
    const combined = new Uint8Array(deviceEntropy.length + wrapSalt.length);
    combined.set(deviceEntropy, 0);
    combined.set(wrapSalt, deviceEntropy.length);
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      combined,
      'PBKDF2',
      false,
      ['deriveKey']
    );
    const wrapKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: IDB_KDF_SALT,
        iterations: PBKDF2_ITERS,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-KW', length: 256 },
      true,
      ['wrapKey', 'unwrapKey']
    );
    try {
      const rawBuf = await crypto.subtle.exportKey('raw', wrapKey);
      await _setCachedWrapKeyBytes(saltHex, Array.from(new Uint8Array(rawBuf)));
      return await crypto.subtle.importKey(
        'raw',
        new Uint8Array(rawBuf),
        { name: 'AES-KW' },
        false,
        ['wrapKey', 'unwrapKey']
      );
    } catch (e) {
      return wrapKey;
    }
  }
  async function _persistKey(key, email) {
    try {
      const db = await _initDB();
      const wrapSalt = crypto.getRandomValues(new Uint8Array(16));
      const wrapKey = await deriveWrappingKey(wrapSalt);
      const wrapped = await crypto.subtle.wrapKey('raw', key, wrapKey, 'AES-KW');
      const wrappedBytes = new Uint8Array(wrapped);
      const saltHex = Array.from(wrapSalt).map(b => b.toString(16).padStart(2, '0')).join('');
      const keyHex = Array.from(wrappedBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      await new Promise((resolve, reject) => {
        const tx = db.transaction(KEY_STORE, 'readwrite');
        const store = tx.objectStore(KEY_STORE);
        const request = store.put({
          id: 'primary',
          email: email,
          salt: saltHex,
          wrappedKey: keyHex,
          version: KEY_VERSION,
          createdAt: Date.now()
        });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || new Error("IDB request failed"));
      });
      try {
        const keyBackup = { email, salt: saltHex, wrappedKey: keyHex, version: KEY_VERSION, ts: Date.now() };
        await _idbSessionSet('keyBackup', keyBackup);
        localStorage.setItem('_gznd_session_key_backup', JSON.stringify(keyBackup));
        sessionStorage.setItem('_gznd_session_key_backup', JSON.stringify(keyBackup));
      } catch (e) {}
      _keyEmail = email;
      _clearLegacyStorage();
    } catch (e) {
      console.error('IDBCrypto: Failed to persist key:', _safeErr(e));
      throw e;
    }
  }
  async function _restoreKey() {
    try {
      const db = await _initDB();
      const stored = await new Promise((resolve, reject) => {
        const tx = db.transaction(KEY_STORE, 'readonly');
        const store = tx.objectStore(KEY_STORE);
        const request = store.get('primary');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("IDB request failed"));
      });
      if (stored && stored.salt && stored.wrappedKey) {
        const wrapSalt = new Uint8Array(stored.salt.match(/.{2}/g).map(h => parseInt(h, 16)));
        const wrappedBytes = new Uint8Array(stored.wrappedKey.match(/.{2}/g).map(h => parseInt(h, 16)));
        const wrapKey = await deriveWrappingKey(wrapSalt);
        const key = await crypto.subtle.unwrapKey(
          'raw',
          wrappedBytes,
          wrapKey,
          'AES-KW',
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
        _keyEmail = stored.email;
        return key;
      }
      const idbBackup = await _idbSessionGet('keyBackup');
      if (idbBackup && idbBackup.salt && idbBackup.wrappedKey) {
        const wrapSalt = new Uint8Array(idbBackup.salt.match(/.{2}/g).map(h => parseInt(h, 16)));
        const wrappedBytes = new Uint8Array(idbBackup.wrappedKey.match(/.{2}/g).map(h => parseInt(h, 16)));
        const wrapKey = await deriveWrappingKey(wrapSalt);
        const key = await crypto.subtle.unwrapKey(
          'raw', wrappedBytes, wrapKey, 'AES-KW',
          { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
        );
        _keyEmail = idbBackup.email;
        await _persistKey(key, idbBackup.email);
        return key;
      }
      const sessionBackup = sessionStorage.getItem('_gznd_session_key_backup') || localStorage.getItem('_gznd_session_key_backup');
      if (sessionBackup) {
        const backup = JSON.parse(sessionBackup);
        if (backup.salt && backup.wrappedKey) {
          const wrapSalt = new Uint8Array(backup.salt.match(/.{2}/g).map(h => parseInt(h, 16)));
          const wrappedBytes = new Uint8Array(backup.wrappedKey.match(/.{2}/g).map(h => parseInt(h, 16)));
          const wrapKey = await deriveWrappingKey(wrapSalt);
          const key = await crypto.subtle.unwrapKey(
            'raw',
            wrappedBytes,
            wrapKey,
            'AES-KW',
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
          );
          _keyEmail = backup.email;
          await _persistKey(key, backup.email);
          return key;
        }
      }
      return await _migrateFromLegacy();
    } catch (e) {
      console.error('IDBCrypto: Failed to restore key:', _safeErr(e));
      return null;
    }
  }
  async function _migrateFromLegacy() {
    try {
      const stored = localStorage.getItem(LEGACY_LS_KEY);
      const wrapSecret = localStorage.getItem(LEGACY_LS_SECRET);
      const email = localStorage.getItem(LEGACY_LS_EMAIL);
      if (!stored || !wrapSecret || !email) return null;
      const [saltHex, keyHex] = stored.split(':');
      if (!saltHex || !keyHex) return null;
      const wrapSalt = new Uint8Array(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
      const wrappedBytes = new Uint8Array(keyHex.match(/.{2}/g).map(h => parseInt(h, 16)));
      const enc = new TextEncoder();
      const wkMaterial = await crypto.subtle.importKey('raw', enc.encode(wrapSecret), 'PBKDF2', false, ['deriveKey']);
      const wrapKey = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: wrapSalt, iterations: APP_CONFIG.PBKDF2_ITERATIONS_LEGACY, hash: 'SHA-256' },
        wkMaterial,
        { name: 'AES-KW', length: 256 },
        false,
        ['unwrapKey']
      );
      const key = await crypto.subtle.unwrapKey(
        'raw',
        wrappedBytes,
        wrapKey,
        'AES-KW',
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
      await _persistKey(key, email);
      _keyEmail = email;
      return key;
    } catch (e) {
      console.error('IDBCrypto: Legacy migration failed:', _safeErr(e));
      return null;
    }
  }
  function _clearLegacyStorage() {
    try {
      localStorage.removeItem(LEGACY_LS_KEY);
      localStorage.removeItem(LEGACY_LS_SECRET);
      localStorage.removeItem(LEGACY_LS_EMAIL);
      localStorage.removeItem('_gznd_key_version');
    } catch (e) {
    }
  }
  return {
    async initialize() {
      try {
        await _initDB();
        return true;
      } catch (e) {
        console.error('IDBCrypto: Initialization failed:', _safeErr(e));
        return false;
      }
    },
    preWarm() {
      if (!_preWarmPromise) {
        _preWarmPromise = _restoreKey().then(key => {
          if (key) { _sessionKey = key; }
          _preWarmPromise = null;
          return !!key;
        }).catch(() => { _preWarmPromise = null; return false; });
      }
      return _preWarmPromise;
    },
    async setSessionKey(email, password) {
      _sessionKey = await deriveSessionKey(email, password);
      await _persistKey(_sessionKey, email);
      _keyEmail = email;
      await _idbSessionSet('login', {
        uid: null,
        email,
        lastLogin: new Date().toISOString()
      });
      await _idbSessionSet('active', { value: '1', ts: Date.now() });
    },
    async sessionSet(id, value) { return _idbSessionSet(id, value); },
    async sessionGet(id) { return _idbSessionGet(id); },
    async sessionDelete(id) { return _idbSessionDelete(id); },
    async restoreSessionKeyFromStorage() {
      if (_sessionKey) return true;
      if (_preWarmPromise) return _preWarmPromise;
      if (!this._restorePromise) {
        this._restorePromise = _restoreKey().then(key => {
          this._restorePromise = null;
          if (key) { _sessionKey = key; return true; }
          return false;
        }).catch(() => { this._restorePromise = null; return false; });
      }
      return this._restorePromise;
    },
    async rederiveKey(email, password) {
      try {
        _sessionKey = await deriveSessionKey(email, password);
        await _persistKey(_sessionKey, email);
        _keyEmail = email;
        return true;
      } catch (e) {
        console.error('IDBCrypto: Failed to re-derive key:', _safeErr(e));
        return false;
      }
    },
    getStoredEmail() {
      return _keyEmail;
    },
    clearSessionKey() {
      _sessionKey = null;
      _keyEmail = null;
      _initDB().then(db => {
        const tx = db.transaction([KEY_STORE, ENTROPY_STORE, SESSION_STORE, WRAPKEY_CACHE_STORE], 'readwrite');
        tx.objectStore(KEY_STORE).delete('primary');
        tx.objectStore(ENTROPY_STORE).delete('primary');
        tx.objectStore(SESSION_STORE).clear();
        tx.objectStore(WRAPKEY_CACHE_STORE).clear();
      }).catch(() => {});
      try {
        sessionStorage.removeItem('_gznd_session_key_backup');
        sessionStorage.removeItem('_gznd_session_active');
        localStorage.removeItem('_gznd_session_key_backup');
        localStorage.removeItem('_gznd_session_active');
        localStorage.removeItem('persistentLogin');
      } catch (e) {}
      _clearLegacyStorage();
    },
    isReady() {
      return _sessionKey !== null;
    },
    async encrypt(plainValue) {
      if (!_sessionKey) {
        console.warn('IDBCrypto: Cannot encrypt - no session key');
        return plainValue;
      }
      try {
        const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
        const plaintext = new TextEncoder().encode(
          typeof plainValue === 'string' ? plainValue : JSON.stringify(plainValue)
        );
        const ciphertext = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          _sessionKey,
          plaintext
        );
        const ctBytes = new Uint8Array(ciphertext);
        const combined = new Uint8Array(IV_LEN + ctBytes.length);
        combined.set(iv, 0);
        combined.set(ctBytes, IV_LEN);
        let binary = '';
        combined.forEach(b => { binary += String.fromCharCode(b); });
        return ENC_PREFIX + btoa(binary);
      } catch (e) {
        console.error('IDBCrypto: Encryption failed:', _safeErr(e));
        return plainValue;
      }
    },
    async decrypt(encValue) {
      if (!_sessionKey) {
        await this.restoreSessionKeyFromStorage();
      }
      if (!_sessionKey) {
        console.warn('IDBCrypto: Cannot decrypt - no session key available');
        return null;
      }
      if (typeof encValue !== 'string' || !encValue.startsWith(ENC_PREFIX)) {
        return encValue;
      }
      try {
        const b64 = encValue.slice(ENC_PREFIX.length);
        const binary = atob(b64);
        const combined = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          combined[i] = binary.charCodeAt(i);
        }
        const iv = combined.slice(0, IV_LEN);
        const ciphertext = combined.slice(IV_LEN);
        const plaintext = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv },
          _sessionKey,
          ciphertext
        );
        const decoded = new TextDecoder().decode(plaintext);
        try {
          return JSON.parse(decoded);
        } catch (e) {
          return decoded;
        }
      } catch (decErr) {
        console.error('IDBCrypto: Decryption failed:', _safeErr(decErr));
        return null;
      }
    },
    async validateKey() {
      if (!_sessionKey) return false;
      try {
        const testValue = 'test_' + Date.now();
        const encrypted = await this.encrypt(testValue);
        if (encrypted === testValue) return false;
        const decrypted = await this.decrypt(encrypted);
        return decrypted === testValue;
      } catch (e) {
        return false;
      }
    }
  };
})();
IDBCrypto.preWarm();
let currentActiveTab = 'prod';
const USE_IDB_ONLY = true;
function safeNumber(value, defaultValue = 0) {
const num = Number(value);
return (isNaN(num) || !isFinite(num)) ? defaultValue : num;
}
function safeToFixed(value, decimals = 2) {
return safeNumber(value, 0).toFixed(decimals);
}
function formatIndianCurrency(value) {
const num = Math.round(safeNumber(value, 0));
if (isNaN(num)) return '0';
const isNeg = num < 0;
const abs = Math.abs(num);
const s = abs.toString();
let result;
if (s.length <= 3) {
result = s;
} else {
const last3 = s.slice(-3);
const rest = s.slice(0, s.length - 3);
const restFormatted = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
result = restFormatted + ',' + last3;
}
return isNeg ? '-' + result : result;
}
function fmtAmt(value) {
return formatIndianCurrency(value);
}
function safeString(value, defaultValue = '') {
if (value === null || value === undefined) return defaultValue;
return String(value);
}
function safeReplace(value, searchValue, replaceValue) {
return safeString(value).replace(searchValue, replaceValue);
}
const IDB_CONFIG = {
name: 'NaswarDealersDB',
version: 2,
store: 'app_data',
indexes: {
timestamp: 'timestamp',
type: 'type',
userId: 'userId',
composite: 'type_timestamp'
},
performance: {
batchSize: 100,
compressThreshold: 10240
}
};
const idb = {
db: null,
_initPromise: null,
_prefix: '',
_quotaToastShown: false,
_DEVICE_GLOBAL: new Set(['device_id', 'device_name', 'theme', 'appMode', 'appMode_timestamp', 'repProfile', 'repProfile_timestamp', 'assignedManager', 'assignedUserTabs']),
_PLAINTEXT_KEYS: new Set(['appMode', 'appMode_timestamp', 'repProfile', 'repProfile_timestamp', 'assignedManager', 'assignedUserTabs', 'device_name', 'theme', 'last_synced', 'firestore_initialized', 'firestore_init_timestamp']),
setUserPrefix(uid) {
  const newPrefix = uid ? 'u_' + uid + '_' : '';
  if (this._prefix !== newPrefix) {
    this._prefix = newPrefix;
    if (typeof DeltaSync !== 'undefined') {
      DeltaSync._cache = {};
      DeltaSync._dirty = new Map();
    }
  }
},
clearUserPrefix() {
  this._prefix = '';
  if (typeof DeltaSync !== 'undefined') {
    DeltaSync._cache = {};
    DeltaSync._dirty = new Map();
  }
},
_k(key) {
  if (!this._prefix) return key;
  if (this._DEVICE_GLOBAL.has(key)) return key;
  return this._prefix + key;
},
async init() {
if (this.db) return this.db;
if (this._initPromise) return this._initPromise;
this._initPromise = new Promise((resolve, reject) => {
const request = indexedDB.open(IDB_CONFIG.name, IDB_CONFIG.version);
request.onupgradeneeded = (e) => {
const db = e.target.result;
const oldVersion = e.oldVersion;
if (!db.objectStoreNames.contains(IDB_CONFIG.store)) {
const objectStore = db.createObjectStore(IDB_CONFIG.store);
try {
objectStore.createIndex(IDB_CONFIG.indexes.timestamp, 'metadata.timestamp', { unique: false });
objectStore.createIndex(IDB_CONFIG.indexes.type, 'metadata.type', { unique: false });
objectStore.createIndex(IDB_CONFIG.indexes.userId, 'metadata.userId', { unique: false });
objectStore.createIndex(IDB_CONFIG.indexes.composite, ['metadata.type', 'metadata.timestamp'], { unique: false });
} catch (e) {
console.error('An unexpected error occurred.', _safeErr(e));
showToast('An unexpected error occurred.', 'error');
}
} else if (oldVersion < 2) {
}
};
request.onsuccess = (e) => {
this.db = e.target.result;
this.db.onerror = (event) => {
const err = event.target.error;
if (err) console.error('IDB: Uncaught database error:', err.name, err.message);
};
this.db.onversionchange = () => {
this.db.close();
this.db = null;
this._initPromise = null;
if (typeof showToast === 'function') {
  showToast('App updated in another tab — please reload to continue.', 'warning', 0);
}
};
resolve(this.db);
};
request.onerror = (e) => {
this._initPromise = null;
reject(e.target.error || new Error("IDB open failed"));
};
request.onblocked = () => {
  console.warn('IDB: open blocked by another tab holding the DB connection. Reload required.');
  if (typeof showToast === 'function') {
    showToast('App update pending — please close other tabs and reload.', 'warning', 8000);
  }
};
});
return this._initPromise;
},
_wrapValue(key, value) {
let recordIds = [];
let recordCount = 0;
const isCollectionString = typeof value === 'string' && (value.trimStart()[0] === '[' || value.trimStart()[0] === '{');
if (isCollectionString || (typeof value !== 'string')) {
try {
const parsedData = typeof value === 'string' ? JSON.parse(value) : value;
if (Array.isArray(parsedData)) {
recordCount = parsedData.length;
recordIds = parsedData.slice(0, 10).map(item => item.id).filter(Boolean);
}
} catch (e) {
console.warn('IDB record parsing error', e);
}
}
const serialized = typeof value === 'string' ? value : JSON.stringify(value);
const wrapped = {
data: serialized,
metadata: {
timestamp: Date.now(),
type: this._inferType(key),
userId: 'default_user',
key: key,
compressed: false,
encrypted: false,
recordCount: recordCount,
sampleIds: [],
version: 2
}
};
return wrapped;
},
_unwrapValue(wrapped) {
if (!wrapped) return null;
if (!wrapped.metadata) {
try {
return JSON.parse(wrapped);
} catch (e) {
return wrapped;
}
}
return wrapped.data;
},
_inferType(key) {
if (key.includes('payment')) return 'payment';
if (key.includes('expense')) return 'expense';
if (key.includes('factory')) return 'factory';
if (key.includes('customer') || key.includes('sales')) return 'sales';
if (key.includes('mfg') || key.includes('production')) return 'production';
return 'other';
},
async get(key, defaultValue = null) {
await this.init();
return new Promise((resolve, reject) => {
const transaction = this.db.transaction(IDB_CONFIG.store, 'readonly');
const store = transaction.objectStore(IDB_CONFIG.store);
const request = store.get(this._k(key));
request.onsuccess = async () => {
const wrapped = request.result;
if (wrapped === undefined) {
resolve(defaultValue);
} else {
const rawData = this._unwrapValue(wrapped);
if (rawData === null || rawData === undefined) { resolve(defaultValue); return; }
try {
const isPlaintext = this._PLAINTEXT_KEYS && this._PLAINTEXT_KEYS.has(key);
if (isPlaintext) {
if (typeof rawData === 'string' && rawData.startsWith('GZND_ENC_')) {
// Stale encrypted value for a now-plaintext key — clear it and return default
this.remove(key).catch(() => {});
resolve(defaultValue);
return;
}
if (typeof rawData === 'string') {
try { resolve(JSON.parse(rawData)); } catch(e) { resolve(rawData); }
} else { resolve(rawData); }
return;
}
const decrypted = await IDBCrypto.decrypt(rawData);
if (decrypted === null) {
console.warn('IDB: Decryption returned null for key:', key);
resolve(defaultValue);
return;
}
if (typeof decrypted === 'string') {
try { resolve(JSON.parse(decrypted)); } catch(e) { resolve(decrypted); }
} else {
resolve(decrypted);
}
} catch(decErr) {
console.warn('IDB: Decryption error for key:', key, decErr);
try { resolve(JSON.parse(rawData)); } catch(e) { resolve(rawData); }
}
}
};
request.onerror = () => reject(request.error || new Error("IDB get request failed for key: " + key));
transaction.onerror = () => reject(transaction.error || new Error("IDB get transaction failed for key: " + key));
transaction.onabort = () => resolve(defaultValue);
});
},
_handleWriteError(err, context) {
  if (err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
    console.error('IDB: QuotaExceededError on', context, _safeErr(err));
    if (!this._quotaToastShown) {
      this._quotaToastShown = true;
      if (typeof showToast === 'function') {
        showToast(
          'Storage full — data could not be saved. Free up device storage and try again.',
          'error', 8000
        );
      }
      setTimeout(() => { this._quotaToastShown = false; }, 10000);
    }
  } else {
    console.error('IDB: Write error on', context, _safeErr(err));
  }
  throw err;
},
async set(key, value) {
await this.init();
if (Array.isArray(value)) {
value = value.map(record => {
if (typeof record === 'object' && record !== null) {
return ensureRecordIntegrity(record);
}
return record;
});
} else if (typeof value === 'object' && value !== null) {
value = ensureRecordIntegrity(value);
}
const serialized = typeof value === 'string' ? value : JSON.stringify(value);
const isPlaintext = this._PLAINTEXT_KEYS && this._PLAINTEXT_KEYS.has(key);
const encryptedData = isPlaintext ? serialized : await IDBCrypto.encrypt(serialized);
try {
return await new Promise((resolve, reject) => {
const transaction = this.db.transaction(IDB_CONFIG.store, 'readwrite');
const store = transaction.objectStore(IDB_CONFIG.store);
const wrapped = this._wrapValue(key, value);
wrapped.data = encryptedData;
wrapped.metadata.encrypted = isPlaintext ? false : IDBCrypto.isReady();
const request = store.put(wrapped, this._k(key));
request.onsuccess = () => {
resolve();
};
request.onerror = () => {
reject(request.error || new Error("IDB set request failed for key: " + key));
};
transaction.onerror = () => {
reject(transaction.error || request.error || new Error("IDB set transaction failed for key: " + key));
};
transaction.onabort = () => {
reject(transaction.error || request.error || new Error("IDB set transaction aborted for key: " + key));
};
});
} catch (err) {
this._handleWriteError(err, key);
}
},
async setBatch(entries) {
await this.init();
const validatedEntries = entries.map(([key, value]) => {
if (Array.isArray(value)) {
value = value.map(record => {
if (typeof record === 'object' && record !== null) {
return ensureRecordIntegrity(record);
}
return record;
});
} else if (typeof value === 'object' && value !== null) {
value = ensureRecordIntegrity(value);
}
return [key, value];
});
const encryptedEntries = await Promise.all(
validatedEntries.map(async ([key, value]) => {
try {
const serialized = typeof value === 'string' ? value : JSON.stringify(value);
const isPlaintext = this._PLAINTEXT_KEYS && this._PLAINTEXT_KEYS.has(key);
const encryptedData = isPlaintext ? serialized : await IDBCrypto.encrypt(serialized);
return [key, value, encryptedData, isPlaintext];
} catch (encErr) {
console.error('IDB: Encryption failed for key:', key, _safeErr(encErr));
return [key, value, typeof value === 'string' ? value : JSON.stringify(value), false];
}
})
);
const batches = [];
for (let i = 0; i < encryptedEntries.length; i += IDB_CONFIG.performance.batchSize) {
batches.push(encryptedEntries.slice(i, i + IDB_CONFIG.performance.batchSize));
}
try {
for (const batch of batches) {
await new Promise((resolve, reject) => {
const transaction = this.db.transaction(IDB_CONFIG.store, 'readwrite');
const store = transaction.objectStore(IDB_CONFIG.store);
batch.forEach(([key, value, encryptedData, isPlaintext]) => {
const wrapped = this._wrapValue(key, value);
wrapped.data = encryptedData;
wrapped.metadata.encrypted = isPlaintext ? false : IDBCrypto.isReady();
const putReq = store.put(wrapped, this._k(key));
putReq.onerror = () => reject(putReq.error || new Error("IDB setBatch put failed for key: " + key));
});
transaction.oncomplete = () => {
resolve();
};
transaction.onerror = () => reject(transaction.error || new Error("IDB setBatch transaction failed"));
transaction.onabort = () => reject(transaction.error || new Error("IDB setBatch transaction aborted"));
});
}
} catch (err) {
this._handleWriteError(err, 'setBatch[' + entries.map(([k]) => k).join(',') + ']');
}
},
DECRYPT_FAILED: Symbol('DECRYPT_FAILED'),
async getBatch(keys) {
await this.init();
const results = new Map();
if (keys.length === 0) return results;
await IDBCrypto.restoreSessionKeyFromStorage();
const rawMap = new Map();
await new Promise((resolve, reject) => {
const transaction = this.db.transaction(IDB_CONFIG.store, 'readonly');
const store = transaction.objectStore(IDB_CONFIG.store);
let completed = 0;
keys.forEach(key => {
const request = store.get(this._k(key));
request.onsuccess = () => {
rawMap.set(key, this._unwrapValue(request.result));
if (++completed === keys.length) resolve();
};
request.onerror = () => { rawMap.set(key, null); if (++completed === keys.length) resolve(); };
});
transaction.onerror = () => {
keys.forEach(k => { if (!rawMap.has(k)) rawMap.set(k, null); });
resolve();
};
transaction.onabort = () => {
keys.forEach(k => { if (!rawMap.has(k)) rawMap.set(k, null); });
resolve();
};
});
await Promise.all(keys.map(async key => {
const rawData = rawMap.get(key);
if (rawData === null || rawData === undefined) { results.set(key, null); return; }
try {
const isPlaintext = this._PLAINTEXT_KEYS && this._PLAINTEXT_KEYS.has(key);
if (isPlaintext) {
// Plaintext keys: parse directly, no decryption needed.
// If a stale encrypted value exists (GZND_ENC_ prefix), treat as missing
// so it gets written fresh (unencrypted) on next save.
if (typeof rawData === 'string' && rawData.startsWith('GZND_ENC_')) {
results.set(key, null);
// Schedule async deletion of stale encrypted value
this.remove(key).catch(() => {});
return;
}
if (typeof rawData === 'string') {
try { results.set(key, JSON.parse(rawData)); } catch(e) { results.set(key, rawData); }
} else { results.set(key, rawData); }
return;
}
const decrypted = await IDBCrypto.decrypt(rawData);
if (decrypted === null) {
const wasEncrypted = typeof rawData === 'string' && rawData.startsWith('GZND_ENC_');
if (wasEncrypted) {
console.warn('IDB: Decryption returned null for encrypted key in batch:', key);
results.set(key, idb.DECRYPT_FAILED);
} else {
console.warn('IDB: Decryption returned null for key in batch:', key);
results.set(key, null);
}
} else if (typeof decrypted === 'string') {
try { results.set(key, JSON.parse(decrypted)); } catch(e) { results.set(key, decrypted); }
} else {
results.set(key, decrypted);
}
} catch(e) {
const wasEncrypted = typeof rawData === 'string' && rawData.startsWith('GZND_ENC_');
if (wasEncrypted) {
console.warn('IDB: Decryption exception for encrypted key in batch:', key, e);
results.set(key, idb.DECRYPT_FAILED);
} else {
console.warn('IDB: Decryption error for key in batch:', key, e);
try { results.set(key, JSON.parse(rawData)); } catch(e2) { results.set(key, rawData); }
}
}
}));
return results;
},
async remove(key) {
await this.init();
return new Promise((resolve, reject) => {
const transaction = this.db.transaction(IDB_CONFIG.store, 'readwrite');
const store = transaction.objectStore(IDB_CONFIG.store);
const request = store.delete(this._k(key));
request.onsuccess = () => resolve();
request.onerror = () => reject(request.error || new Error("IDB remove request failed for key: " + key));
transaction.onerror = () => reject(transaction.error || request.error || new Error("IDB remove transaction failed for key: " + key));
transaction.onabort = () => reject(transaction.error || new Error("IDB remove transaction aborted for key: " + key));
});
},
async queryByType(type, options = {}) {
await this.init();
return new Promise((resolve, reject) => {
const transaction = this.db.transaction(IDB_CONFIG.store, 'readonly');
const store = transaction.objectStore(IDB_CONFIG.store);
try {
const index = store.index(IDB_CONFIG.indexes.type);
const range = IDBKeyRange.only(type);
const request = index.openCursor(range);
const results = [];
const limit = options.limit || Infinity;
let count = 0;
request.onsuccess = (e) => {
const cursor = e.target.result;
if (cursor && count < limit) {
const value = this._unwrapValue(cursor.value);
results.push({
key: cursor.primaryKey,
value: value,
metadata: cursor.value.metadata
});
count++;
cursor.continue();
} else {
resolve(results);
}
};
request.onerror = () => reject(request.error || new Error("IDB request failed"));
} catch (e) {
resolve([]);
}
});
},
async queryByTimeRange(type, startTime, endTime, options = {}) {
await this.init();
return new Promise((resolve, reject) => {
const transaction = this.db.transaction(IDB_CONFIG.store, 'readonly');
const store = transaction.objectStore(IDB_CONFIG.store);
try {
const index = store.index(IDB_CONFIG.indexes.composite);
const range = IDBKeyRange.bound([type, startTime], [type, endTime]);
const request = index.openCursor(range);
const results = [];
const limit = options.limit || Infinity;
let count = 0;
request.onsuccess = (e) => {
const cursor = e.target.result;
if (cursor && count < limit) {
const value = this._unwrapValue(cursor.value);
results.push({
key: cursor.primaryKey,
value: value,
metadata: cursor.value.metadata
});
count++;
cursor.continue();
} else {
resolve(results);
}
};
request.onerror = () => reject(request.error || new Error("IDB request failed"));
} catch (e) {
console.error('An unexpected error occurred.', _safeErr(e));
showToast('An unexpected error occurred.', 'error');
this.queryByType(type, options).then(resolve).catch(reject);
}
});
},
async count(options = {}) {
await this.init();
return new Promise((resolve, reject) => {
const transaction = this.db.transaction(IDB_CONFIG.store, 'readonly');
const store = transaction.objectStore(IDB_CONFIG.store);
if (options.type) {
try {
const index = store.index(IDB_CONFIG.indexes.type);
const range = IDBKeyRange.only(options.type);
const request = index.count(range);
request.onsuccess = () => resolve(request.result);
request.onerror = () => reject(request.error || new Error("IDB request failed"));
} catch (e) {
console.error('An unexpected error occurred.', _safeErr(e));
showToast('An unexpected error occurred.', 'error');
const request = store.count();
request.onsuccess = () => resolve(request.result);
request.onerror = () => reject(request.error || new Error("IDB request failed"));
}
} else {
const request = store.count();
request.onsuccess = () => resolve(request.result);
request.onerror = () => reject(request.error || new Error("IDB request failed"));
}
});
}
};
function ensureArray(value) {
if (Array.isArray(value)) {
return value;
}
if (value === null || value === undefined) {
return [];
}
if (typeof value === 'object') {
try {
return Array.isArray(value) ? value : [];
} catch(e) {
return [];
}
}
return [];
}
async function loadAllData() {
const dataKeys = [
'mfg_pro_pkr', 'noman_history', 'customer_sales', 'rep_sales', 'rep_customers',
'sales_customers',
'factory_inventory_data', 'factory_production_history',
'payment_entities', 'payment_transactions', 'expenses',
'stock_returns', 'deletion_records', 'deleted_records',
'factory_default_formulas', 'factory_additional_costs',
'factory_sale_prices', 'factory_cost_adjustment_factor',
'factory_unit_tracking', 'naswar_default_settings',
'appMode', 'repProfile', 'expense_categories', 'sales_reps_list',
'assignedManager', 'assignedUserTabs',
'factory_default_formulas_timestamp', 'factory_additional_costs_timestamp',
'factory_sale_prices_timestamp', 'factory_cost_adjustment_factor_timestamp',
'factory_unit_tracking_timestamp', 'naswar_default_settings_timestamp',
'appMode_timestamp', 'repProfile_timestamp'
];
const batchResults = await idb.getBatch(dataKeys);
db = ensureArray(batchResults.get('mfg_pro_pkr'));
salesHistory = ensureArray(batchResults.get('noman_history'));
customerSales = ensureArray(batchResults.get('customer_sales'));
repSales = ensureArray(batchResults.get('rep_sales'));
repCustomers = ensureArray(batchResults.get('rep_customers'));
salesCustomers = ensureArray(batchResults.get('sales_customers'));
stockReturns = ensureArray(batchResults.get('stock_returns'));
factoryInventoryData = ensureArray(batchResults.get('factory_inventory_data'));
factoryProductionHistory = ensureArray(batchResults.get('factory_production_history'));
paymentEntities = ensureArray(batchResults.get('payment_entities'));
paymentTransactions = ensureArray(batchResults.get('payment_transactions'));
expenseRecords = ensureArray(batchResults.get('expenses'));
deletionRecordsArray = ensureArray(batchResults.get('deletion_records'));
deletionRecords = deletionRecordsArray;
const deletedRecordsArray = ensureArray(batchResults.get('deleted_records'));
deletedRecordIds = new Set(deletedRecordsArray);
const loadedFormulas = batchResults.get('factory_default_formulas');
if (loadedFormulas && typeof loadedFormulas === 'object' && 'standard' in loadedFormulas && 'asaan' in loadedFormulas) {
factoryDefaultFormulas = loadedFormulas;
}
const loadedAdditionalCosts = batchResults.get('factory_additional_costs');
if (loadedAdditionalCosts && typeof loadedAdditionalCosts === 'object' && 'standard' in loadedAdditionalCosts && 'asaan' in loadedAdditionalCosts) {
factoryAdditionalCosts = loadedAdditionalCosts;
}
const loadedSalePrices = batchResults.get('factory_sale_prices');
if (loadedSalePrices && typeof loadedSalePrices === 'object' && 'standard' in loadedSalePrices && 'asaan' in loadedSalePrices) {
factorySalePrices = loadedSalePrices;
}
const loadedAdjustmentFactor = batchResults.get('factory_cost_adjustment_factor');
if (loadedAdjustmentFactor && typeof loadedAdjustmentFactor === 'object' && 'standard' in loadedAdjustmentFactor && 'asaan' in loadedAdjustmentFactor) {
factoryCostAdjustmentFactor = loadedAdjustmentFactor;
}
const loadedUnitTracking = batchResults.get('factory_unit_tracking');
if (loadedUnitTracking && typeof loadedUnitTracking === 'object') {
factoryUnitTracking = loadedUnitTracking;
}
const loadedDefaultSettings = batchResults.get('naswar_default_settings');
if (loadedDefaultSettings && typeof loadedDefaultSettings === 'object') {
defaultSettings = loadedDefaultSettings;
}
const _notFailed = v => v !== null && v !== undefined && v !== idb.DECRYPT_FAILED;
const loadedAppMode = batchResults.get('appMode');
if (_notFailed(loadedAppMode) && typeof loadedAppMode === 'string') {
appMode = loadedAppMode;
}
const loadedRepProfile = batchResults.get('repProfile');
if (_notFailed(loadedRepProfile) && typeof loadedRepProfile === 'string') {
currentRepProfile = loadedRepProfile;
} else if (loadedRepProfile === idb.DECRYPT_FAILED) {
console.warn('loadAllData: repProfile decryption failed — will re-acquire from Firestore on registerDevice');
}
const loadedExpenseCategories = batchResults.get('expense_categories');
if (_notFailed(loadedExpenseCategories) && Array.isArray(loadedExpenseCategories)) {
expenseCategories = loadedExpenseCategories;
}
const loadedSalesRepsList = batchResults.get('sales_reps_list');
if (_notFailed(loadedSalesRepsList) && Array.isArray(loadedSalesRepsList) && loadedSalesRepsList.length > 0) {
salesRepsList = loadedSalesRepsList;
}
const loadedAssignedManager = batchResults.get('assignedManager');
if (_notFailed(loadedAssignedManager) && typeof loadedAssignedManager === 'string') {
window._assignedManagerName = loadedAssignedManager;
}
const loadedAssignedUserTabs = batchResults.get('assignedUserTabs');
if (_notFailed(loadedAssignedUserTabs) && Array.isArray(loadedAssignedUserTabs)) {
window._assignedUserTabs = loadedAssignedUserTabs;
window._userRoleAllowedTabs = loadedAssignedUserTabs;
}
const CRITICAL_KEYS = [
  'mfg_pro_pkr', 'customer_sales', 'payment_transactions', 'payment_entities',
  'noman_history', 'expenses'
];
const failedKeys = CRITICAL_KEYS.filter(
  k => batchResults.get(k) === idb.DECRYPT_FAILED
);
if (failedKeys.length > 0) {
  const keyReady = IDBCrypto.isReady();
  const reason = keyReady
    ? 'Decryption failed — data may be corrupted or the encryption key has changed.'
    : 'Encryption key unavailable — please log in again to restore your data.';
  console.error(
    'loadAllData: decryption failure on critical keys:', failedKeys, '| keyReady:', keyReady
  );
  const err = new Error(reason);
  err.code = 'DECRYPT_FAILED';
  err.failedKeys = failedKeys;
  throw err;
}
if (!IDBCrypto.isReady()) {
  const criticalEmpty = [db, customerSales, paymentTransactions, paymentEntities]
    .every(arr => arr.length === 0);
  if (criticalEmpty) {
    console.warn('loadAllData: session key not ready and all critical collections empty — possible key loss');
    if (typeof showToast === 'function') {
      showToast(
        'Encryption key unavailable — if you have existing data, please log in again.',
        'warning', 6000
      );
    }
  }
}
if (typeof DeltaSync !== 'undefined' && typeof DeltaSync.loadAllUploadedIds === 'function') {
  DeltaSync.loadAllUploadedIds().catch(() => {});
}
}
const DEVICE_ID_COOKIE = 'gz_did';
const INSTALL_TOKEN_COOKIE = 'gz_itk';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 3650;
const _CACHE_DEVICE_KEY = 'gz_device_anchor';
const _CACHE_STORE_NAME = 'gz-device-anchor-v1';
function _readCookie(name) {
try {
const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
return match ? decodeURIComponent(match[1]) : null;
} catch (e) { return null; }
}
function _writeCookie(name, value) {
try {
document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${COOKIE_MAX_AGE}; path=/; SameSite=Strict`;
} catch (e) {
console.warn('_writeCookie failed:', e);
}
}
function _generateUUID() {

  const buf = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(buf);
  } else {

    let s0 = (Date.now() ^ 0xdeadbeef) >>> 0;
    let s1 = ((Date.now() / 1000) ^ 0xcafebabe) >>> 0;
    for (let i = 0; i < 16; i++) {
      let t = s1 ^ (s1 << 17);
      s1 = s0;
      s0 = (s0 ^ (s0 >>> 26)) ^ (t ^ (t ^ (t >>> 7)));
      buf[i] = s0 & 0xff;
    }
  }
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const hex = Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
  const core = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
  return 'dev-' + core;
}
async function _readCacheAnchor() {
try {
if (!('caches' in window)) return null;
const cache = await caches.open(_CACHE_STORE_NAME);
const resp = await cache.match(_CACHE_DEVICE_KEY);
if (!resp) return null;
const text = await resp.text();
return text || null;
} catch (e) { return null; }
}
async function _writeCacheAnchor(value) {
try {
if (!('caches' in window)) return;
const cache = await caches.open(_CACHE_STORE_NAME);
await cache.put(_CACHE_DEVICE_KEY, new Response(value));
} catch (e) {  }
}
function _readSession(key) {
try { return sessionStorage.getItem(key) || null; } catch (e) { return null; }
}
function _writeSession(key, value) {
try { sessionStorage.setItem(key, value); } catch (e) {  }
}
async function _persistDeviceId(deviceId) {
_writeCookie(DEVICE_ID_COOKIE, deviceId);
try { localStorage.setItem('persistent_device_id', deviceId); } catch (e) {  }
_writeSession('gz_did_session', deviceId);
try { await idb.set('device_id', deviceId); } catch (e) {  }
await _writeCacheAnchor(deviceId);
}
async function _recoverDeviceIdByFingerprint() {
if (!firebaseDB || !currentUser) return null;
try {
const fp = await getDeviceFingerprint();
const snap = await firebaseDB
.collection('users').doc(currentUser.uid)
.collection('devices')
.where('fingerprint.stableHash', '==', fp.stableHash)
.limit(1)
.get();
if (!snap.empty) {
const data = snap.docs[0].data();
return data.deviceId || null;
}
} catch (e) {
console.warn('Fingerprint-based device ID recovery failed:', e);
}
return null;
}
async function _recoverDeviceIdByToken() {
if (!firebaseDB || !currentUser) return null;
try {
const installToken = _readCookie(INSTALL_TOKEN_COOKIE)
|| _readSession('gz_itk_session')
|| null;
if (!installToken) return null;
const snap = await firebaseDB
.collection('users').doc(currentUser.uid)
.collection('devices')
.where('installationToken', '==', installToken)
.limit(1)
.get();
if (!snap.empty) {
return snap.docs[0].data().deviceId || null;
}
} catch (e) {
console.warn('Token-based device ID recovery failed:', e);
}
return null;
}
async function getDeviceId() {
let deviceId = _readCookie(DEVICE_ID_COOKIE);
if (!deviceId) deviceId = _readSession('gz_did_session');
if (!deviceId) {
try { deviceId = localStorage.getItem('persistent_device_id') || null; } catch (e) {  }
}
if (!deviceId) {
try { deviceId = await idb.get('device_id'); } catch (e) {  }
}
if (!deviceId) deviceId = await _readCacheAnchor();
if (!deviceId && firebaseDB && currentUser) {
deviceId = await _recoverDeviceIdByToken();
}
if (!deviceId && firebaseDB && currentUser) {
deviceId = await _recoverDeviceIdByFingerprint();
}
if (!deviceId) deviceId = _generateUUID();
await _persistDeviceId(deviceId);
const existingToken = _readCookie(INSTALL_TOKEN_COOKIE) || _readSession('gz_itk_session');
if (!existingToken) {
const token = _generateUUID();
_writeCookie(INSTALL_TOKEN_COOKIE, token);
_writeSession('gz_itk_session', token);
} else {
_writeCookie(INSTALL_TOKEN_COOKIE, existingToken);
_writeSession('gz_itk_session', existingToken);
}
return deviceId;
}
async function refreshDeviceIdAnchors() {
try {
if (firebaseDB && currentUser) {
try { _writeCookie(DEVICE_ID_COOKIE, ''); } catch(e) {}
try { localStorage.removeItem('persistent_device_id'); } catch(e) {}
try { await idb.set('device_id', null); } catch(e) {}
}
const deviceId = await getDeviceId();
await _persistDeviceId(deviceId);
} catch (e) {  }
}
async function getDeviceFingerprint() {
const ua = navigator.userAgent;
let os = 'Unknown OS';
if (/Windows NT 10/.test(ua)) os = 'Windows 10/11';
else if (/Windows NT 6\.3/.test(ua)) os = 'Windows 8.1';
else if (/Windows NT 6\.1/.test(ua)) os = 'Windows 7';
else if (/Windows/.test(ua)) os = 'Windows';
else if (/Android (\d+\.\d+)/.test(ua)) os = 'Android ' + ua.match(/Android (\d+\.\d+)/)[1];
else if (/iPhone OS ([\d_]+)/.test(ua)) os = 'iOS ' + ua.match(/iPhone OS ([\d_]+)/)[1].replace(/_/g,'.');
else if (/iPad.*OS ([\d_]+)/.test(ua)) os = 'iPadOS ' + ua.match(/iPad.*OS ([\d_]+)/)[1].replace(/_/g,'.');
else if (/Mac OS X ([\d_]+)/.test(ua)) os = 'macOS ' + ua.match(/Mac OS X ([\d_]+)/)[1].replace(/_/g,'.');
else if (/Linux/.test(ua)) os = 'Linux';
let browser = 'Unknown';
let browserVer = '';
if (/Edg\/([\d.]+)/.test(ua)) { browser = 'Edge'; browserVer = ua.match(/Edg\/([\d.]+)/)[1].split('.')[0]; }
else if (/OPR\/([\d.]+)/.test(ua)) { browser = 'Opera'; browserVer = ua.match(/OPR\/([\d.]+)/)[1].split('.')[0]; }
else if (/SamsungBrowser\/([\d.]+)/.test(ua)) { browser = 'Samsung'; browserVer = ua.match(/SamsungBrowser\/([\d.]+)/)[1].split('.')[0]; }
else if (/CriOS\/([\d.]+)/.test(ua)) { browser = 'Chrome iOS'; browserVer = ua.match(/CriOS\/([\d.]+)/)[1].split('.')[0]; }
else if (/FxiOS\/([\d.]+)/.test(ua)) { browser = 'Firefox iOS'; browserVer = ua.match(/FxiOS\/([\d.]+)/)[1].split('.')[0]; }
else if (/Chrome\/([\d.]+)/.test(ua) && !/Chromium/.test(ua)) { browser = 'Chrome'; browserVer = ua.match(/Chrome\/([\d.]+)/)[1].split('.')[0]; }
else if (/Firefox\/([\d.]+)/.test(ua)) { browser = 'Firefox'; browserVer = ua.match(/Firefox\/([\d.]+)/)[1].split('.')[0]; }
else if (/Version\/([\d.]+).*Safari/.test(ua)){ browser = 'Safari'; browserVer = ua.match(/Version\/([\d.]+)/)[1].split('.')[0]; }
else if (/Chromium\/([\d.]+)/.test(ua)) { browser = 'Chromium'; browserVer = ua.match(/Chromium\/([\d.]+)/)[1].split('.')[0]; }
const browserFull = browserVer ? `${browser} ${browserVer}` : browser;
const screenRes = `${screen.width}×${screen.height}`;
const colorDepth = screen.colorDepth || 24;
const pixelRatio = (window.devicePixelRatio || 1).toFixed(1);
const cores = navigator.hardwareConcurrency || '?';
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const lang = navigator.language || 'en';
const platform = navigator.platform || 'Unknown';
const touch = navigator.maxTouchPoints > 0 ? `Touch(${navigator.maxTouchPoints})` : 'NoTouch';
let canvasHash = 'X';
try {
const c = document.createElement('canvas');
c.width = 120; c.height = 30;
const ctx = c.getContext('2d');
ctx.textBaseline = 'top';
ctx.font = '13px Arial';
ctx.fillStyle = '#f00';
ctx.fillText('Gull&Zubair', 2, 2);
ctx.fillStyle = 'rgba(0,200,100,0.6)';
ctx.fillRect(30, 10, 60, 8);
const raw = c.toDataURL();
let h = 0;
for (let i = 0; i < raw.length; i++) {
h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
}
canvasHash = Math.abs(h).toString(36).toUpperCase().padStart(6, '0');
} catch (e) {
console.warn('Canvas fingerprint hash failed', e);
}
const stableStr = `${os}|${screenRes}|${colorDepth}|${pixelRatio}|${cores}|${tz}|${platform}|${canvasHash}`;
let stableHash = 0;
for (let i = 0; i < stableStr.length; i++) {
stableHash = ((stableHash << 5) - stableHash + stableStr.charCodeAt(i)) | 0;
}
stableHash = Math.abs(stableHash).toString(36).padStart(8, '0');
const readableName = `${os} · ${browserFull} · ${screenRes} · ${cores}c · ${tz}`;
return {
os,
browser,
browserFull,
screenRes,
colorDepth,
pixelRatio,
cores,
tz,
lang,
platform,
touch,
canvasHash,
stableHash,
readableName,
fullUserAgent: ua
};
}
async function getDeviceName() {
let deviceName = await idb.get('device_name');
if (!deviceName) {
const fp = await getDeviceFingerprint();
deviceName = fp.readableName;
await idb.set('device_name', deviceName);
}
return deviceName;
}
async function registerDevice() {
if (!firebaseDB) {
return;
}
if (!currentUser) {
return;
}
try {
const deviceId = await getDeviceId();
const fp = await getDeviceFingerprint();
const deviceName = fp.readableName;
try { await idb.set('device_name', deviceName); } catch(e) {
console.warn('Failed to save data locally.', e);
}
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
try {
const dupSnap = await userRef.collection('devices')
.where('fingerprint.stableHash', '==', fp.stableHash)
.get();
const deleteOps = dupSnap.docs
.filter(doc => doc.id !== deviceId && doc.id !== 'default_device')
.map(doc => doc.ref.delete());
if (deleteOps.length > 0) {
await Promise.all(deleteOps);
}
} catch (dupErr) {
console.warn('Duplicate cleanup failed:', dupErr);
}
const userAgent = navigator.userAgent;
const deviceType = /Mobile|Android|iPhone/.test(userAgent)
? 'mobile'
: /Tablet|iPad/.test(userAgent)
? 'tablet'
: 'desktop';
const browser = fp.browserFull;
const deviceRef = userRef.collection('devices').doc(deviceId);
const existingDoc = await deviceRef.get();
const existing = existingDoc.exists ? existingDoc.data() : {};
const persistedMode = existing.currentMode || appMode || 'admin';
const persistedRoleType = existing.assignedRoleType || persistedMode;
const persistedRoleName = existing.assignedRoleName
|| (persistedRoleType === 'rep' ? existing.assignedRep : existing.assignedManager)
|| null;
const persistedRep = persistedRoleType === 'rep' ? (persistedRoleName || currentRepProfile || null) : null;
const persistedManager = (persistedRoleType === 'production' || persistedRoleType === 'factory') ? persistedRoleName : null;
if (persistedMode !== appMode) {
appMode = persistedMode;
const idbBatch = [
['appMode', appMode],
['appMode_timestamp', existing.appMode_timestamp || Date.now()]
];
if (persistedMode === 'rep' && persistedRep) {
currentRepProfile = persistedRep;
idbBatch.push(['repProfile', persistedRep]);
} else if (persistedMode === 'userrole') {
const persistedUserManager = existing.assignedManager || existing.assignedRoleName || null;
const persistedUserTabs = Array.isArray(existing.assignedUserTabs) ? existing.assignedUserTabs : [];
window._assignedManagerName = persistedUserManager;
window._assignedUserTabs = persistedUserTabs;
window._userRoleAllowedTabs = persistedUserTabs;
idbBatch.push(['assignedManager', persistedUserManager]);
idbBatch.push(['assignedUserTabs', persistedUserTabs]);
} else if ((persistedMode === 'production' || persistedMode === 'factory') && persistedManager) {
window._assignedManagerName = persistedManager;
idbBatch.push(['assignedManager', persistedManager]);
}
await idb.setBatch(idbBatch);
}

const isFirstRegistration = !existingDoc.exists;
await deviceRef.set({
deviceId: deviceId,
deviceName: deviceName,
deviceType: deviceType,
browser: browser,
platform: fp.platform,
userAgent: fp.fullUserAgent,
fingerprint: {
os: fp.os,
browser: fp.browserFull,
screenRes: fp.screenRes,
colorDepth: fp.colorDepth,
pixelRatio: fp.pixelRatio,
cpuCores: fp.cores,
timezone: fp.tz,
language: fp.lang,
touch: fp.touch,
canvasHash: fp.canvasHash,
stableHash: fp.stableHash
},
online: true,
lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
lastActivity: firebase.firestore.FieldValue.serverTimestamp(),
...(isFirstRegistration ? { registeredAt: firebase.firestore.FieldValue.serverTimestamp() } : {}),
currentMode: persistedMode,
assignedRoleType: persistedRoleType,
assignedRoleName: persistedRoleName,
assignedRep: persistedMode === 'rep' ? persistedRep : null,
assignedManager: (persistedMode === 'userrole' || persistedMode === 'production' || persistedMode === 'factory') ? persistedManager : null,
assignedUserTabs: persistedMode === 'userrole' ? (window._assignedUserTabs || []) : null,
installationToken: _readCookie(INSTALL_TOKEN_COOKIE) || null,
capabilities: {
canSync: true,
canReceiveCommands: true,
supportsBiometric: false,
supportsNotifications: 'Notification' in window
},
lastSyncTimestamp: existing.lastSyncTimestamp || null,
dataUsage: existing.dataUsage || { reads: 0, writes: 0, deletes: 0 }
}, { merge: true });
const accountInfoRef = userRef.collection('account').doc('info');
await accountInfoRef.set({
email: currentUser.email || 'unknown@example.com',
displayName: currentUser.displayName || currentUser.email?.split('@')[0] || 'User',
lastActivity: firebase.firestore.FieldValue.serverTimestamp(),
accountCreated: firebase.firestore.FieldValue.serverTimestamp()
}, { merge: true });
const preferencesRef = userRef.collection('account').doc('preferences');
await preferencesRef.set({
defaultRepProfile: currentRepProfile || salesRepsList[0] || 'NORAN SHAH',
timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
language: navigator.language || 'en',
theme: document.documentElement.getAttribute('data-theme') || 'dark'
}, { merge: true });
startDeviceHeartbeat(deviceRef);
// Defer the device command listener by one tick to ensure the Firestore SDK
// has fully settled after the preceding .set() writes — avoids the
// "INTERNAL ASSERTION FAILED: Unexpected state" error on cold start.
setTimeout(() => {
listenForDeviceCommands().catch(e => console.warn('Device command listener failed.', e));
}, 2000);
listenForTeamChanges();
await logDeviceActivity('device_registered', {
deviceId: deviceId,
deviceName: deviceName,
deviceType: deviceType,
browser: browser
});
} catch (error) {
console.warn('Device command listener failed.', error);
}
}
function startDeviceHeartbeat(deviceRef) {
if (window.deviceHeartbeatInterval) {
clearInterval(window.deviceHeartbeatInterval);
}
window.deviceHeartbeatInterval = setInterval(async () => {
if (document.hidden) return;
if (firebaseDB && currentUser) {
try {
const _isRepMode = appMode === 'rep';
const _isUserRole = appMode === 'userrole';
const _isMgrMode = appMode === 'production' || appMode === 'factory';
await deviceRef.update({
lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
lastActivity: firebase.firestore.FieldValue.serverTimestamp(),
online: true,
currentMode: appMode,
assignedRoleType: appMode,
assignedRoleName: _isRepMode ? (currentRepProfile || null) : (_isUserRole || _isMgrMode) ? (window._assignedManagerName || null) : null,
assignedRep: _isRepMode ? (currentRepProfile || null) : null,
assignedManager: (_isUserRole || _isMgrMode) ? (window._assignedManagerName || null) : null,
assignedUserTabs: _isUserRole ? (window._assignedUserTabs || []) : null,
});
} catch (error) {
console.warn('Heartbeat update failed.', error);
}
}
}, APP_CONFIG.HEARTBEAT_INTERVAL_MS);
}
async function logDeviceActivity(activityType, details = {}) {
if (!firebaseDB || !currentUser) return;
const LOGGABLE_EVENTS = new Set([
'device_registered',
'account_initialized',
'restore_completed',
'backup_completed',
'auth_login',
'auth_logout',
'sync_error',
'data_error',
'factory_formula_saved',
]);
if (!LOGGABLE_EVENTS.has(activityType)) {
return;
}
try {
const deviceId = await getDeviceId();
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
const activityRef = userRef.collection('activityLog').doc();
await activityRef.set({
timestamp: firebase.firestore.FieldValue.serverTimestamp(),
deviceId: deviceId,
activityType: activityType,
details: details,
userId: currentUser.uid
});
} catch (error) {
console.warn('Firebase operation failed.', error);
}
}
window.logDeviceActivity = logDeviceActivity;
async function initializeDeviceListeners() {
try {
setTimeout(() => {
listenForDeviceCommands().catch(e => console.warn('Device command listener failed.', e));
}, 2000);
listenForTeamChanges();
} catch (error) {
console.error('Device command listener failed.', _safeErr(error));
showToast('Device command listener failed.', 'error');
}
await cleanupOldDeletions();
}
window.initializeDeviceListeners = initializeDeviceListeners;
const AppState = Object.seal({
  currentUser:              null,
  firebaseDB:               null,
  database:                 null,
  auth:                     null,
  isSyncing:                false,
  appMode:                  'admin',
  currentRepProfile:        'admin',
  salesRepsList:            ['NORAN SHAH', 'NOMAN SHAH'],
  userRolesList:            [],
  db:                       [],
  salesHistory:             [],
  customerSales:            [],
  repSales:                 [],
  repCustomers:             [],
  salesCustomers:           [],
  stockReturns:             [],
  expenseRecords:           [],
  expenseCategories:        [],
  deletedRecordIds:         new Set(),
  deletionRecordsArray:     [],
  deletionRecords:          [],
  paymentEntities:          [],
  paymentTransactions:      [],
  factoryInventoryData:     [],
  factoryProductionHistory: [],
  factoryDefaultFormulas:   { standard: [], asaan: [] },
  factoryAdditionalCosts:   { standard: 0,  asaan: 0  },
  factorySalePrices:        { standard: 0,  asaan: 0  },
  factoryCostAdjustmentFactor: { standard: 1, asaan: 1 },
  factoryUnitTracking: {
    standard: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
    asaan:    { produced: 0, consumed: 0, available: 0, unitCostHistory: [] }
  },
});
const _VALID_APP_MODES = new Set(['admin','rep','production','factory','userrole']);
const _AppStateDescriptors = {
  isSyncing: {
    get() { return AppState.isSyncing; },
    set(v) {
      if (typeof v !== 'boolean') {
        console.warn('[AppState] isSyncing must be boolean, got:', typeof v, v);
        return;
      }
      AppState.isSyncing = v;
    }
  },
  appMode: {
    get() { return AppState.appMode; },
    set(v) {
      if (!_VALID_APP_MODES.has(v)) {
        console.warn('[AppState] Invalid appMode value:', v, '— must be one of', [..._VALID_APP_MODES]);
        return;
      }
      AppState.appMode = v;
    }
  },
  currentUser: {
    get() { return AppState.currentUser; },
    set(v) {
      if (v !== null && typeof v !== 'object') {
        console.warn('[AppState] currentUser must be object or null, got:', typeof v);
        return;
      }
      AppState.currentUser = v;
    }
  },
  firebaseDB: {
    get() { return AppState.firebaseDB; },
    set(v) {
      if (v !== null && typeof v !== 'object') {
        console.warn('[AppState] firebaseDB must be object or null, got:', typeof v);
        return;
      }
      AppState.firebaseDB = v;
    }
  },
};
const _plain = (key) => ({
  get() { return AppState[key]; },
  set(v) { AppState[key] = v; }
});
[
  'database','auth',
  'currentRepProfile','salesRepsList','userRolesList',
  'db','salesHistory','customerSales','repSales','repCustomers','salesCustomers',
  'stockReturns','expenseRecords','expenseCategories','deletedRecordIds',
  'deletionRecordsArray','deletionRecords',
  'paymentEntities','paymentTransactions',
  'factoryInventoryData','factoryProductionHistory','factoryDefaultFormulas',
  'factoryAdditionalCosts','factorySalePrices','factoryCostAdjustmentFactor',
  'factoryUnitTracking',
].forEach(key => { _AppStateDescriptors[key] = _plain(key); });
Object.defineProperties(window, Object.fromEntries(
  Object.entries(_AppStateDescriptors).map(([k, desc]) => [k, {
    get: desc.get,
    set: desc.set,
    enumerable: true,
    configurable: false
  }])
));

const _MODE_CODES = {
  'admin':      '0',
  'rep':        '1',
  'production': '2',
  'factory':    '3',
  'userrole':   '4',
};
const _MODE_LABELS = { '0':'admin', '1':'rep', '2':'production', '3':'factory', '4':'userrole' };

const _UUID_V5_NS = new Uint8Array([
  0x6b,0xa7,0xb8,0x10, 0x9d,0xad, 0x11,0xd1,
  0x80,0xb4, 0x00,0xc0,0x4f,0xd4,0x30,0xc8,
]);
let _cachedDeviceShard = null;
let _uuidLastMs = 0;
let _uuidSeq    = 0;

function _deriveDeviceShard(did) {
  if (!did || typeof did !== 'string') return '0000';
  let h = 0x811c9dc5;
  for (let i = 0; i < did.length; i++) {
    h ^= did.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return (h & 0xffff).toString(16).padStart(4, '0');
}
function _randomBytes(n) {
  const buf = new Uint8Array(n);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(buf);
  } else {
    let s0 = (Date.now() ^ 0xdeadbeef) >>> 0;
    let s1 = (Date.now() ^ 0xcafebabe) >>> 0;
    for (let i = 0; i < n; i++) {
      let t = s1 ^ (s1 << 17);
      s1 = s0;
      s0 = (s0 ^ (s0 >>> 26)) ^ (t ^ (t >>> 7));
      buf[i] = s0 & 0xff;
    }
  }
  return buf;
}
function _nextSeq(nowMs) {
  if (nowMs > _uuidLastMs) {
    _uuidLastMs = nowMs;
    _uuidSeq    = _randomBytes(1)[0];
    return { ts: _uuidLastMs, seq: _uuidSeq };
  }
  _uuidSeq = (_uuidSeq + 1) & 0xff;
  if (_uuidSeq === 0) {
    _uuidLastMs += 1;
    _uuidSeq = _randomBytes(1)[0];
  }
  return { ts: _uuidLastMs, seq: _uuidSeq };
}
function _encodeModeTag() {
  const mode = (typeof appMode !== 'undefined' ? appMode : 'admin') || 'admin';
  return _MODE_CODES[mode] || '0';
}

let _uuidV5Cache   = null;
let _uuidV5Pending = false;
function _refreshV5Cache() {
  if (_uuidV5Pending) return;
  _uuidV5Pending = true;
  const name = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : Array.from(_randomBytes(16)).map(b => b.toString(16).padStart(2,'0')).join('');
  try {
    const nameBytes = new TextEncoder().encode(name);
    const input = new Uint8Array(_UUID_V5_NS.length + nameBytes.length);
    input.set(_UUID_V5_NS, 0);
    input.set(nameBytes, _UUID_V5_NS.length);
    crypto.subtle.digest('SHA-1', input).then(buf => {
      const b = new Uint8Array(buf.slice(0, 16));
      b[6] = (b[6] & 0x0f) | 0x50;
      b[8] = (b[8] & 0x3f) | 0x80;
      _uuidV5Cache   = b;
      _uuidV5Pending = false;
    }).catch(() => { _uuidV5Pending = false; });
  } catch (_) {
    _uuidV5Pending = false;
  }
}
function _buildUUIDv3Base() {

  if (_uuidV5Cache !== null) {
    const cached = _uuidV5Cache;
    _uuidV5Cache = null;
    _refreshV5Cache();
    return cached;
  }

  const name = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : null;
  const b = _randomBytes(16);
  if (name) {
    const clean = name.replace(/-/g, '');
    for (let i = 0; i < 16; i++) {
      b[i] ^= parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
  }
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  _refreshV5Cache();
  return b;
}

async function initUUIDSalts() {
  try {
    const did = await getDeviceId();
    _cachedDeviceShard = _deriveDeviceShard(did);
  } catch (e) {
    _cachedDeviceShard = '0000';
  }
  if (typeof UUIDSyncRegistry !== 'undefined') {
    UUIDSyncRegistry.setDeviceShard(_cachedDeviceShard);
  }
  _refreshV5Cache();
}
async function initDeviceShard() { return initUUIDSalts(); }

function generateUUID(prefix = '', retryCount = 0, tsMs = null, modeOverride = null) {
  const MAX_RETRIES = 3;
  const nowMs = tsMs != null ? tsMs : Date.now();
  const { ts, seq } = _nextSeq(nowMs);
  const base = _buildUUIDv3Base();

  const tsHi32 = Math.floor(ts / 0x10000);
  base[0] = (tsHi32 >>> 24) & 0xff;
  base[1] = (tsHi32 >>> 16) & 0xff;
  base[2] = (tsHi32 >>>  8) & 0xff;
  base[3] = (tsHi32       ) & 0xff;

  const tsLo16 = ts & 0xffff;
  base[4] = (tsLo16 >>> 8) & 0xff;
  base[5] = (tsLo16      ) & 0xff;

  const modeNib = modeOverride != null
    ? (parseInt(modeOverride, 16) & 0xf)
    : parseInt(_encodeModeTag(), 16);
  base[6] = 0x40 | ((seq >>> 4) & 0xf);
  base[7] = ((seq & 0xf) << 4) | modeNib;

  const shard = parseInt(_cachedDeviceShard || '0000', 16);
  base[10] = (shard >>> 8) & 0xff;
  base[11] = (shard      ) & 0xff;

  const h = Array.from(base).map(b => b.toString(16).padStart(2, '0')).join('');
  const uuid = `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
  const finalUUID = prefix ? `${prefix}-${uuid}` : uuid;
  if (retryCount < MAX_RETRIES && !validateUUID(finalUUID)) {
    return generateUUID(prefix, retryCount + 1, tsMs, modeOverride);
  }
  return finalUUID;
}
function validateUUID(uuid) {
  if (!uuid || typeof uuid !== 'string') return false;
  const standardRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const prefixedRegex = /^[a-z0-9][a-z0-9_-]*-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return standardRegex.test(uuid) || prefixedRegex.test(uuid);
}
function extractUUIDMeta(uuid) {
  if (!validateUUID(uuid)) return null;
  const allParts = uuid.split('-');
  const coreParts = allParts.slice(allParts.length - 5);
  const [cp1, cp2, cp3, , node] = coreParts;
  const modeNib    = cp3[3];
  const appModeNew = _MODE_LABELS[modeNib] || null;
  if (appModeNew !== null) {
    const tsHi = parseInt(cp1, 16);
    const tsLo = parseInt(cp2, 16);
    const tsMs = tsHi * 0x10000 + tsLo;
    const _V3_TS_MIN = 1577836800000;
    const _V3_TS_MAX = 4102358400000;
    if (tsMs >= _V3_TS_MIN && tsMs <= _V3_TS_MAX) {
      const seq = (parseInt(cp3[1], 16) << 4) | parseInt(cp3[2], 16);

      const deviceShard = node.slice(0, 4);
      const v5entropy   = node.slice(4, 12);
      return {
        deviceShard,
        v5entropy,
        timestamp: new Date(tsMs),
        appMode: appModeNew,
        sequence: seq,
        isEnriched: true,
        version: 3,
      };
    }
    return null;
  }
  return null;
}
window.generateUUID       = generateUUID;
window.validateUUID       = validateUUID;
window.extractUUIDMeta    = extractUUIDMeta;
window.initUUIDSalts      = initUUIDSalts;
window.deriveDeviceShard  = _deriveDeviceShard;
window._creatorBadgeHtml  = _creatorBadgeHtml;
window._mergedBadgeHtml   = _mergedBadgeHtml;
function compareRecordVersions(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  const metaA = (a.id && typeof extractUUIDMeta === 'function') ? extractUUIDMeta(a.id) : null;
  const metaB = (b.id && typeof extractUUIDMeta === 'function') ? extractUUIDMeta(b.id) : null;
  const aIsV2 = metaA && metaA.isEnriched && metaA.version === 2;
  const bIsV2 = metaB && metaB.isEnriched && metaB.version === 2;
  if (aIsV2 && bIsV2) {
    const tA = metaA.timestamp instanceof Date ? metaA.timestamp.getTime() : 0;
    const tB = metaB.timestamp instanceof Date ? metaB.timestamp.getTime() : 0;
    if (tA !== tB) return tA - tB;
    const seqA = typeof metaA.sequence === 'number' ? metaA.sequence : -1;
    const seqB = typeof metaB.sequence === 'number' ? metaB.sequence : -1;
    if (seqA !== seqB) return seqA - seqB;
    const shardA = metaA.deviceShard || '';
    const shardB = metaB.deviceShard || '';
    if (shardA !== shardB) return shardA > shardB ? 1 : -1;
    return 0;
  }
  if (aIsV2 && !bIsV2) return 1;
  if (!aIsV2 && bIsV2) return -1;
  const _fieldMs = (rec) => {
    if (!rec) return 0;
    const ts = rec.updatedAt || rec.timestamp || rec.createdAt || 0;
    if (typeof ts === 'number') return ts;
    if (ts && typeof ts.toMillis === 'function') return ts.toMillis();
    if (ts && typeof ts === 'object') {
      if (typeof ts.seconds === 'number') return ts.seconds * 1000 + Math.round((ts.nanoseconds || 0) / 1e6);
      if (typeof ts._seconds === 'number') return ts._seconds * 1000;
    }
    if (ts instanceof Date) return ts.getTime();
    if (typeof ts === 'string') { try { const t = new Date(ts).getTime(); if (!isNaN(t)) return t; } catch(e){} }
    return 0;
  };
  return _fieldMs(a) - _fieldMs(b);
}
window.compareRecordVersions = compareRecordVersions;
function getTimestamp() {
return Date.now();
}
function validateTimestamp(timestamp, allowFuture = false) {
if (!timestamp || typeof timestamp !== 'number') return false;
if (timestamp < 946684800000 || timestamp > 4102444800000) return false;
if (!allowFuture) {
const now = Date.now();
const clockSkewTolerance = 5 * 60 * 1000;
if (timestamp > (now + clockSkewTolerance)) {
return false;
}
}
return true;
}
function _mergedBadgeHtml(record, opts = {}) {
if (!record || !record.isMerged) return '';
if (opts.inline) {
  return ` <span style="background:rgba(175, 82, 222, 0.15); color:#af52de; padding:2px 6px; border-radius:4px; font-size:0.65rem; margin-left:6px; font-weight:600;">MERGED</span>`;
}
return `<span style="font-size:0.6rem; background:rgba(175, 82, 222, 0.15); color:#af52de; padding:1px 5px; border-radius:3px; border:1px solid rgba(175, 82, 222, 0.3); display:inline-block; margin-top:3px;">MERGED</span>`;
}
function _creatorBadgeHtml(record) {
if (!record || !record.createdBy) return '';
const name = String(record.createdBy).trim();
if (!name) return '';
return `<span class="creator-badge" title="Created by ${esc(name)}">${esc(name)}</span>`;
}
function compareTimestamps(timestamp1, timestamp2) {
if (!validateTimestamp(timestamp1) || !validateTimestamp(timestamp2)) {
return 0;
}
if (timestamp1 < timestamp2) return -1;
if (timestamp1 > timestamp2) return 1;
return 0;
}
function resolveConflict(local, remote) {
if (!local) return remote;
if (!remote) return local;
const localTime = getRecordTimestamp(local);
const remoteTime = getRecordTimestamp(remote);
return localTime >= remoteTime ? local : remote;
}
function getRecordTimestamp(record) {
if (!record) return 0;
if (record.timestamp && typeof record.timestamp === 'number') {
return record.timestamp;
}
if (record.timestamp && typeof record.timestamp === 'string') {
return new Date(record.timestamp).getTime();
}
if (record.updatedAt) {
return typeof record.updatedAt === 'number' ? record.updatedAt : new Date(record.updatedAt).getTime();
}
if (record.createdAt) {
return typeof record.createdAt === 'number' ? record.createdAt : new Date(record.createdAt).getTime();
}
if (record.date) {
return new Date(record.date).getTime();
}
return 0;
}
function ensureRecordIntegrity(record, isEdit = false, isMigration = false) {
if (!record) return record;
const isTrackingObject = record.produced !== undefined ||
record.consumed !== undefined ||
record.available !== undefined ||
record.unitCostHistory !== undefined;
if (isTrackingObject) {
return record;
}
if (!record.id) {
record.id = generateUUID('repair');
if (!isMigration) {
const hasUserData = Object.keys(record).some(key =>
!['id', 'createdAt', 'updatedAt', 'timestamp', 'deletedAt', 'tombstoned_at'].includes(key)
);
if (hasUserData) {
}
}
} else if (!validateUUID(record.id)) {
const oldId = record.id;
record.id = generateUUID('repair');
if (!isMigration) {
}
}
const now = getTimestamp();
if (isMigration) {
if (!record.createdAt || !validateTimestamp(record.createdAt, true)) {
record.createdAt = now;
}
if (!record.updatedAt || !validateTimestamp(record.updatedAt, true)) {
record.updatedAt = record.createdAt;
}
if (!record.timestamp || !validateTimestamp(record.timestamp, true)) {
record.timestamp = record.createdAt;
}
if (record.updatedAt < record.createdAt) {
record.updatedAt = record.createdAt;
}
} else {
if (!record.createdAt || !validateTimestamp(record.createdAt, false)) {
record.createdAt = now;
}
const isMergedRecord = record.isMerged === true;
if (!isMergedRecord && (isEdit || !record.updatedAt || !validateTimestamp(record.updatedAt, false))) {
record.updatedAt = now;
} else if (!record.updatedAt || !validateTimestamp(record.updatedAt, false)) {
record.updatedAt = record.createdAt;
}
if (!record.timestamp || !validateTimestamp(record.timestamp, true)) {
record.timestamp = record.createdAt || now;
}
if (record.updatedAt < record.createdAt) {
record.updatedAt = record.createdAt;
}
}
return record;
}
async function cleanupOldTombstones() {
const ninetyDaysAgo = Date.now() - APP_CONFIG.TOMBSTONE_EXPIRY_MS;
const dataTypes = [
'expenses',
'mfg_pro_pkr',
'customer_sales',
'rep_sales',
'noman_history',
'payment_transactions',
'payment_entities',
'factory_production_history',
'stock_returns'
];
let totalCleaned = 0;
for (const dataType of dataTypes) {
try {
const allData = await idb.get(dataType) || [];
const beforeCount = allData.length;
const cleaned = allData.filter(record => {
if (!record.deletedAt && !record.tombstoned_at) {
return true;
}
const deletionTime = record.deletedAt || record.tombstoned_at;
if (validateTimestamp(deletionTime) && deletionTime > ninetyDaysAgo) {
return true;
}
return false;
});
if (cleaned.length !== beforeCount) {
await idb.set(dataType, cleaned);
const removedCount = beforeCount - cleaned.length;
totalCleaned += removedCount;
}
} catch (error) {
console.error('Failed to save data locally.', _safeErr(error));
showToast('Failed to save data locally.', 'error');
}
}
if (totalCleaned > 0) {
}
return totalCleaned;
}
function scheduleAutomaticCleanup() {
setTimeout(() => cleanupOldTombstones(), 5000);
if (window._tombstoneCleanupInterval) clearInterval(window._tombstoneCleanupInterval);
window._tombstoneCleanupInterval = setInterval(() => cleanupOldTombstones(), APP_CONFIG.TOMBSTONE_CLEANUP_INTERVAL_MS);
}
async function validateAndFixRecords(dataType, records) {
if (!Array.isArray(records) || records.length === 0) {
return { fixed: 0, valid: 0, total: 0 };
}
const validRecords = records.filter(record => {
if (!record || typeof record !== 'object') return false;
const dataKeys = Object.keys(record).filter(key =>
!['id', 'createdAt', 'updatedAt', 'timestamp', 'deletedAt', 'tombstoned_at'].includes(key)
);
return dataKeys.length > 0;
});
if (validRecords.length === 0) {
return { fixed: 0, valid: 0, total: 0 };
}
let fixedCount = 0;
let validCount = 0;
const validatedRecords = validRecords.map(record => {
let needsFix = false;
if (!record.id || !validateUUID(record.id)) {
needsFix = true;
}
if (!record.createdAt || !validateTimestamp(record.createdAt)) {
needsFix = true;
}
if (!record.updatedAt || !validateTimestamp(record.updatedAt)) {
needsFix = true;
}
if (record.updatedAt && record.createdAt && record.updatedAt < record.createdAt) {
needsFix = true;
}
if (needsFix) {
record = ensureRecordIntegrity(record, false, true);
fixedCount++;
} else {
validCount++;
}
return record;
});
if (fixedCount > 0) {
await idb.set(dataType, validatedRecords);
}
return {
fixed: fixedCount,
valid: validCount,
total: validRecords.length,
records: validatedRecords
};
}
async function validateAllDataOnStartup() {
const dataTypes = [
'expenses',
'mfg_pro_pkr',
'customer_sales',
'rep_sales',
'noman_history',
'payment_transactions',
'payment_entities',
'factory_production_history',
'stock_returns'
];
let totalFixed = 0;
let totalValid = 0;
let totalRecords = 0;
for (const dataType of dataTypes) {
try {
const records = await idb.get(dataType) || [];
if (records.length > 0) {
const result = await validateAndFixRecords(dataType, records);
totalFixed += result.fixed;
totalValid += result.valid;
totalRecords += result.total;
}
} catch (error) {
console.error('Data validation encountered an error.', _safeErr(error));
showToast('Data validation encountered an error.', 'error');
}
}
if (totalFixed > 0) {
} else {
}
return { totalFixed, totalValid, totalRecords };
}
