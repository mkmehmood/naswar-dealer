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
    try {
      let child = topSpacer.nextSibling;
      while (child && child !== botSpacer) {
        const next = child.nextSibling;
        tbody.removeChild(child);
        child = next;
      }
      tbody.insertBefore(frag, botSpacer);
    } catch (_domErr) {
      if (_domErr instanceof DOMException) return;
      throw _domErr;
    }
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
      try {
        _measureRowHeight(inst);
        _render(inst);
      } catch (_rafErr) {
        if (!(_rafErr instanceof DOMException)) throw _rafErr;
      }
    });
    inst.scrollHandler = () => {
      if (inst.rafId) return;
      inst.rafId = requestAnimationFrame(() => {
        inst.rafId = null;
        try { _render(inst); }
        catch (_scrollErr) { if (!(_scrollErr instanceof DOMException)) throw _scrollErr; }
      });
    };
    scroller.addEventListener('scroll', inst.scrollHandler, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      inst.resizeObs = new ResizeObserver(() => {
        try {
          inst.renderedFirst = -1;
          inst.renderedLast  = -1;
          _measureRowHeight(inst);
          _render(inst);
        } catch (_resizeErr) {
          if (!(_resizeErr instanceof DOMException)) throw _resizeErr;
        }
      });
      inst.resizeObs.observe(scroller);
    }
    if (typeof IntersectionObserver !== 'undefined') {
      inst.intersectionObs = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting) {
          try {
            inst.renderedFirst = -1;
            inst.renderedLast  = -1;
            _measureRowHeight(inst);
            _render(inst);
          } catch (_intErr) {
            if (!(_intErr instanceof DOMException)) throw _intErr;
          }
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

const MAGIC_V2 = new Uint8Array([0x47,0x5A,0x4E,0x44,0x5F,0x45,0x4E,0x43,0x5F,0x56,0x32]);

const MAGIC_V4 = new Uint8Array([0x47,0x5A,0x4E,0x44,0x5F,0x45,0x4E,0x43,0x5F,0x56,0x34]);
const SALT_LEN = 32;
const IV_LEN = 12;
const UID_HASH_LEN = 32;
const PBKDF2_ITERS_V4 = 210000;
const PBKDF2_ITERS_V2 = 100000;

async function deriveKeyV4(email, password, uid, salt) {
  const enc = new TextEncoder();

  const ikm = enc.encode(email.toLowerCase().trim() + ':' + password + ':' + (uid || ''));
  const keyMaterial = await crypto.subtle.importKey('raw', ikm, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERS_V4, hash: 'SHA-512' },
    keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

async function deriveKeyV2(email, password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(email.toLowerCase().trim() + ':' + password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERS_V2, hash: 'SHA-256' },
    keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

async function _hashUID(uid) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(uid || ''));
  return new Uint8Array(buf);
}

async function deriveKeyHashV4(email, password, salt) {
  const enc = new TextEncoder();
  const ikm = enc.encode(email.toLowerCase().trim() + ':' + password);
  const keyMaterial = await crypto.subtle.importKey('raw', ikm, 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERS_V4, hash: 'SHA-512' },
    keyMaterial, { name: 'AES-GCM', length: 256 }, true, ['encrypt']
  );
  const raw = await crypto.subtle.exportKey('raw', key);
  const hashBuf = await crypto.subtle.digest('SHA-512', raw);
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

return {

  async encrypt(dataObj, email, password, uid) {
    const _uid = uid || (typeof currentUser !== 'undefined' && currentUser ? (currentUser.uid || currentUser.email || '') : '');
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
    const uidHash = await _hashUID(_uid);
    const key = await deriveKeyV4(email, password, _uid, salt);
    const plaintext = new TextEncoder().encode(JSON.stringify(dataObj));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    const ctBytes = new Uint8Array(ciphertext);

    const out = new Uint8Array(MAGIC_V4.length + UID_HASH_LEN + SALT_LEN + IV_LEN + ctBytes.length);
    let offset = 0;
    out.set(MAGIC_V4, offset); offset += MAGIC_V4.length;
    out.set(uidHash, offset); offset += UID_HASH_LEN;
    out.set(salt, offset);    offset += SALT_LEN;
    out.set(iv, offset);      offset += IV_LEN;
    out.set(ctBytes, offset);
    return new Blob([out], { type: 'application/octet-stream' });
  },

  async decrypt(arrayBuffer, email, password, uid) {
    const bytes = new Uint8Array(arrayBuffer);
    const magicLen = MAGIC_V4.length;

    const isV4 = bytes.length >= magicLen && MAGIC_V4.every((b, i) => bytes[i] === b);
    const isV2 = !isV4 && bytes.length >= magicLen && MAGIC_V2.every((b, i) => bytes[i] === b);
    if (!isV4 && !isV2) throw new Error('INVALID_FORMAT');

    let offset = magicLen;
    if (isV4) {

      const storedUidHash = bytes.slice(offset, offset + UID_HASH_LEN); offset += UID_HASH_LEN;
      const _uid = uid || (typeof currentUser !== 'undefined' && currentUser ? (currentUser.uid || currentUser.email || '') : '');
      const actualUidHash = await _hashUID(_uid);
      const uidMatch = storedUidHash.every((b, i) => b === actualUidHash[i]);
      if (!uidMatch) throw new Error('WRONG_ACCOUNT');
      const salt = bytes.slice(offset, offset + SALT_LEN); offset += SALT_LEN;
      const iv  = bytes.slice(offset, offset + IV_LEN);   offset += IV_LEN;
      const ciphertext = bytes.slice(offset);
      const key = await deriveKeyV4(email, password, _uid, salt);
      try {
        const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
        return JSON.parse(new TextDecoder().decode(plaintext));
      } catch(e) { throw new Error('WRONG_CREDENTIALS'); }
    } else {

      const salt = bytes.slice(offset, offset + SALT_LEN); offset += SALT_LEN;
      const iv  = bytes.slice(offset, offset + IV_LEN);   offset += IV_LEN;
      const ciphertext = bytes.slice(offset);
      const key = await deriveKeyV2(email, password, salt);
      try {
        const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
        return JSON.parse(new TextDecoder().decode(plaintext));
      } catch(e) { throw new Error('WRONG_CREDENTIALS'); }
    }
  },

  async hashCredentials(email, password, existingSaltHex) {
    let salt;
    if (existingSaltHex) {
      salt = new Uint8Array(existingSaltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
    } else {
      salt = crypto.getRandomValues(new Uint8Array(32));
    }
    const hash = await deriveKeyHashV4(email, password, salt);
    const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2,'0')).join('');
    return { hash, saltHex };
  }
};
})();
const _OPFSStore = (() => {
  const _SUPPORTED = typeof navigator !== 'undefined' &&
                     !!navigator.storage &&
                     typeof navigator.storage.getDirectory === 'function';
  async function read(filename, lsKey) {
    if (_SUPPORTED) {
      try {
        const root = await navigator.storage.getDirectory();
        const fh   = await root.getFileHandle(filename);
        return JSON.parse(await (await fh.getFile()).text());
      } catch { /* fall through to localStorage */ }
    }
    try { const r = localStorage.getItem(lsKey); return r ? JSON.parse(r) : {}; } catch { return {}; }
  }
  async function write(filename, lsKey, data) {
    const json = JSON.stringify(data);
    if (_SUPPORTED) {
      try {
        const root = await navigator.storage.getDirectory();
        const fh   = await root.getFileHandle(filename, { create: true });
        const wr   = await fh.createWritable();
        await wr.write(json);
        await wr.close();
      } catch (e) { console.warn('[OPFSStore] write failed for', filename, _safeErr(e)); }
    }
    try { localStorage.setItem(lsKey, json); } catch {}
  }
  async function remove(filename, lsKey) {
    if (_SUPPORTED) {
      try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry(filename).catch(() => {});
      } catch {}
    }
    try { localStorage.removeItem(lsKey); } catch {}
  }
  return { read, write, remove };
})();

const OfflineAuth = {
  _FILE: 'gznd_auth.json',
  _LS:   '_gznd_auth_data',
  async saveCredentials(email, password) {
    const { hash, saltHex } = await CryptoEngine.hashCredentials(email, password);
    await _OPFSStore.write(this._FILE, this._LS, { hash, saltHex, email, savedAt: Date.now(), version: 4 });
    return true;
  },
  async verifyCredentials(email, password) {
    const record = await _OPFSStore.read(this._FILE, this._LS);
    if (!record || !record.email) return false;
    if (record.email.toLowerCase().trim() !== email.toLowerCase().trim()) return false;
    if (!record.saltHex) {
      console.warn('OfflineAuth: legacy credential record — re-authentication required');
      return false;
    }
    const { hash } = await CryptoEngine.hashCredentials(email, password, record.saltHex);
    return hash === record.hash;
  },
  async getSavedEmail() {
    const record = await _OPFSStore.read(this._FILE, this._LS);
    return (record && record.email) ? record.email : null;
  },
  async hasStoredCredentials() {
    return !!(await this.getSavedEmail());
  },
  async clearCredentials() {
    await _OPFSStore.remove(this._FILE, this._LS);
    return true;
  }
};
async function _checkFirebaseSessionExists() {
try {
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
const SQLiteCrypto = (() => {
  let _sessionKey = null;
  let _keyEmail = null;
  let _keyUid = null;
  let _preWarmPromise = null;

  const _wrapKeyMemCache = new Map();
  const PBKDF2_ITERS = 210000;
  const PBKDF2_HASH  = 'SHA-512';

  const _KEY_FILE      = 'gznd_keystore.json';
  const _KEY_LS        = '_gznd_keystore';
  const _ENTROPY_FILE  = 'gznd_entropy.json';
  const _ENTROPY_LS    = '_gznd_entropy';
  const _SESSION_FILE  = 'gznd_session.json';
  const _SESSION_LS    = '_gznd_session_store';

  const IV_LEN = 12;
  const ENC_PREFIX = 'GZND_ENC_';
  const KEY_VERSION = '4';

  async function _getDeviceEntropy() {
    const stored = await _OPFSStore.read(_ENTROPY_FILE, _ENTROPY_LS);
    if (stored && stored.entropy) {
      return new Uint8Array(stored.entropy.match(/.{2}/g).map(h => parseInt(h, 16)));
    }
    const newEntropy = crypto.getRandomValues(new Uint8Array(32));
    const entropyHex = Array.from(newEntropy).map(b => b.toString(16).padStart(2, '0')).join('');
    await _OPFSStore.write(_ENTROPY_FILE, _ENTROPY_LS, { entropy: entropyHex });
    return newEntropy;
  }

  async function _sqliteSessionSet(id, value) {
    try {
      const all = await _OPFSStore.read(_SESSION_FILE, _SESSION_LS) || {};
      all[id] = value;
      await _OPFSStore.write(_SESSION_FILE, _SESSION_LS, all);
      if (id === 'active') {
        try { localStorage.setItem('_gznd_session_active', '1'); } catch(e) {}
      }
      if (id === 'login') {
        try { localStorage.setItem('persistentLogin', JSON.stringify(value)); } catch(e) {}
      }
    } catch (e) {}
  }

  async function _sqliteSessionGet(id) {
    try {
      const all = await _OPFSStore.read(_SESSION_FILE, _SESSION_LS) || {};
      return all[id] || null;
    } catch (e) { return null; }
  }

  async function _sqliteSessionDelete(id) {
    try {
      const all = await _OPFSStore.read(_SESSION_FILE, _SESSION_LS) || {};
      delete all[id];
      await _OPFSStore.write(_SESSION_FILE, _SESSION_LS, all);
    } catch(e) {}
  }

  function _getCachedWrapKey(saltHex) { return _wrapKeyMemCache.get(saltHex) || null; }
  function _setCachedWrapKey(saltHex, cryptoKey) { _wrapKeyMemCache.set(saltHex, cryptoKey); }

  async function deriveSessionKey(email, password, kdfSalt) {
    const enc = new TextEncoder();
    const ikm = enc.encode(email.toLowerCase().trim() + ':' + password);
    const keyMaterial = await crypto.subtle.importKey('raw', ikm, 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: kdfSalt, iterations: PBKDF2_ITERS, hash: PBKDF2_HASH },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }

  async function deriveWrappingKey(wrapSalt, uid) {
    const saltHex = Array.from(wrapSalt).map(b => b.toString(16).padStart(2, '0')).join('');
    const cacheKey = saltHex + ':' + (uid || '');
    const cached = _getCachedWrapKey(cacheKey);
    if (cached) return cached;
    const deviceEntropy = await _getDeviceEntropy();
    const enc = new TextEncoder();
    const uidBytes = enc.encode(uid || '');
    const combined = new Uint8Array(deviceEntropy.length + wrapSalt.length + uidBytes.length);
    combined.set(deviceEntropy, 0);
    combined.set(wrapSalt, deviceEntropy.length);
    combined.set(uidBytes, deviceEntropy.length + wrapSalt.length);
    const wkSalt = enc.encode('GZND_WK_SALT_v4:' + (uid || 'anon'));
    const keyMaterial = await crypto.subtle.importKey('raw', combined, 'PBKDF2', false, ['deriveKey']);
    const wrapKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: wkSalt, iterations: PBKDF2_ITERS, hash: PBKDF2_HASH },
      keyMaterial,
      { name: 'AES-KW', length: 256 },
      false,
      ['wrapKey', 'unwrapKey']
    );
    _setCachedWrapKey(cacheKey, wrapKey);
    return wrapKey;
  }

  async function _persistKey(key, email, uid, kdfSalt) {
    try {
      const wrapSalt = crypto.getRandomValues(new Uint8Array(16));
      const wrapKey  = await deriveWrappingKey(wrapSalt, uid);
      const wrapped  = await crypto.subtle.wrapKey('raw', key, wrapKey, 'AES-KW');
      const wrappedBytes   = new Uint8Array(wrapped);
      const wrapSaltHex    = Array.from(wrapSalt).map(b => b.toString(16).padStart(2, '0')).join('');
      const keyHex         = Array.from(wrappedBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const kdfSaltHex     = kdfSalt
        ? Array.from(kdfSalt).map(b => b.toString(16).padStart(2, '0')).join('')
        : null;
      const record = { id: 'primary', email, uid: uid || null, salt: wrapSaltHex, kdfSalt: kdfSaltHex, wrappedKey: keyHex, version: KEY_VERSION, createdAt: Date.now() };
      await _OPFSStore.write(_KEY_FILE, _KEY_LS, record);
      try {
        const keyBackup = { email, uid: uid || null, salt: wrapSaltHex, kdfSalt: kdfSaltHex, wrappedKey: keyHex, version: KEY_VERSION, ts: Date.now() };
        await _sqliteSessionSet('keyBackup', keyBackup);
      } catch (e) {}
      _keyEmail = email;
      _keyUid   = uid || null;
    } catch (e) {
      console.error('SQLiteCrypto: Failed to persist key:', _safeErr(e));
      throw e;
    }
  }

  async function _restoreKey() {
    try {
      const stored = await _OPFSStore.read(_KEY_FILE, _KEY_LS);
      if (stored && stored.salt && stored.wrappedKey) {
        const wrapSalt     = new Uint8Array(stored.salt.match(/.{2}/g).map(h => parseInt(h, 16)));
        const wrappedBytes = new Uint8Array(stored.wrappedKey.match(/.{2}/g).map(h => parseInt(h, 16)));
        const uid = stored.uid || null;
        const wrapKey = await deriveWrappingKey(wrapSalt, uid);
        try {
          const key = await crypto.subtle.unwrapKey(
            'raw', wrappedBytes, wrapKey, 'AES-KW',
            { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
          );
          _keyEmail = stored.email;
          _keyUid   = uid;
          return key;
        } catch(unwrapErr) {
          console.warn('SQLiteCrypto: Primary key unwrap failed, trying backup', _safeErr(unwrapErr));
        }
      }
      const sqliteKeyBackup = await _sqliteSessionGet('keyBackup');
      if (sqliteKeyBackup && sqliteKeyBackup.salt && sqliteKeyBackup.wrappedKey) {
        const wrapSalt     = new Uint8Array(sqliteKeyBackup.salt.match(/.{2}/g).map(h => parseInt(h, 16)));
        const wrappedBytes = new Uint8Array(sqliteKeyBackup.wrappedKey.match(/.{2}/g).map(h => parseInt(h, 16)));
        const uid = sqliteKeyBackup.uid || null;
        const wrapKey = await deriveWrappingKey(wrapSalt, uid);
        try {
          const key = await crypto.subtle.unwrapKey(
            'raw', wrappedBytes, wrapKey, 'AES-KW',
            { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
          );
          _keyEmail = sqliteKeyBackup.email;
          _keyUid   = uid;
          const kdfSalt = sqliteKeyBackup.kdfSalt
            ? new Uint8Array(sqliteKeyBackup.kdfSalt.match(/.{2}/g).map(h => parseInt(h, 16)))
            : null;
          await _persistKey(key, sqliteKeyBackup.email, uid, kdfSalt);
          return key;
        } catch(e) {
          console.warn('SQLiteCrypto: Backup key unwrap failed', _safeErr(e));
        }
      }
      return null;
    } catch (e) {
      console.error('SQLiteCrypto: Failed to restore key:', _safeErr(e));
      return null;
    }
  }

  return {
    async initialize() {
      try { return true; } catch (e) {
        console.error('SQLiteCrypto: Initialization failed:', _safeErr(e));
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

    async setSessionKey(email, password, uid) {
      const _uid = uid || null;
      const kdfSalt = crypto.getRandomValues(new Uint8Array(32));
      _sessionKey = await deriveSessionKey(email, password, kdfSalt);
      await _persistKey(_sessionKey, email, _uid, kdfSalt);
      _keyEmail = email;
      _keyUid   = _uid;
      await _sqliteSessionSet('login',  { uid: _uid, email, lastLogin: new Date().toISOString() });
      await _sqliteSessionSet('active', { value: '1', ts: Date.now() });
    },
    async sessionSet(id, value)  { return _sqliteSessionSet(id, value); },
    async sessionGet(id)          { return _sqliteSessionGet(id); },
    async sessionDelete(id)       { return _sqliteSessionDelete(id); },
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

    async rederiveKey(email, password, uid) {
      try {
        const _uid = uid || _keyUid || null;
        let kdfSalt = null;
        try {
          const stored = await _OPFSStore.read(_KEY_FILE, _KEY_LS);
          if (stored && stored.kdfSalt) {
            kdfSalt = new Uint8Array(stored.kdfSalt.match(/.{2}/g).map(h => parseInt(h, 16)));
          }
        } catch(e) {}
        if (!kdfSalt) kdfSalt = crypto.getRandomValues(new Uint8Array(32));
        _sessionKey = await deriveSessionKey(email, password, kdfSalt);
        await _persistKey(_sessionKey, email, _uid, kdfSalt);
        _keyEmail = email;
        _keyUid   = _uid;
        return true;
      } catch (e) {
        console.error('SQLiteCrypto: Failed to re-derive key:', _safeErr(e));
        return false;
      }
    },
    getStoredEmail() { return _keyEmail; },
    getStoredUid()   { return _keyUid; },
    clearSessionKey() {
      _sessionKey = null;
      _keyEmail   = null;
      _keyUid     = null;
      _wrapKeyMemCache.clear();
      _OPFSStore.remove(_KEY_FILE, _KEY_LS).catch(() => {});
      _OPFSStore.remove(_ENTROPY_FILE, _ENTROPY_LS).catch(() => {});
      _OPFSStore.remove(_SESSION_FILE, _SESSION_LS).catch(() => {});
      try {
        sessionStorage.removeItem('_gznd_session_active');
        localStorage.removeItem('_gznd_session_active');
        localStorage.removeItem('persistentLogin');
      } catch (e) {}
    },
    isReady() { return _sessionKey !== null; },
    async encrypt(plainValue) {
      if (!_sessionKey) {
        return plainValue;
      }
      try {
        const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
        const plaintext = new TextEncoder().encode(
          typeof plainValue === 'string' ? plainValue : JSON.stringify(plainValue)
        );
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, _sessionKey, plaintext);
        const ctBytes  = new Uint8Array(ciphertext);
        const combined = new Uint8Array(IV_LEN + ctBytes.length);
        combined.set(iv, 0);
        combined.set(ctBytes, IV_LEN);
        let binary = '';
        combined.forEach(b => { binary += String.fromCharCode(b); });
        return ENC_PREFIX + btoa(binary);
      } catch (e) {
        console.error('SQLiteCrypto: Encryption failed:', _safeErr(e));
        return plainValue;
      }
    },
    async decrypt(encValue) {
      if (!_sessionKey) { await this.restoreSessionKeyFromStorage(); }
      if (!_sessionKey) {
        console.warn('SQLiteCrypto: Cannot decrypt - no session key available');
        return null;
      }
      if (typeof encValue !== 'string' || !encValue.startsWith(ENC_PREFIX)) return encValue;
      try {
        const b64 = encValue.slice(ENC_PREFIX.length);
        const binary = atob(b64);
        const combined = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) combined[i] = binary.charCodeAt(i);
        const iv         = combined.slice(0, IV_LEN);
        const ciphertext = combined.slice(IV_LEN);
        const plaintext  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, _sessionKey, ciphertext);
        const decoded = new TextDecoder().decode(plaintext);
        try { return JSON.parse(decoded); } catch (e) { return decoded; }
      } catch (decErr) {
        console.error('SQLiteCrypto: Decryption failed:', _safeErr(decErr));
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
      } catch (e) { return false; }
    }
  };
})();

SQLiteCrypto.preWarm();

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

const SQLITE_DB_NAME      = 'naswar_dealers.sqlite';

const SQLITE_JS_LOCAL      = './sql-wasm.js';
const SQLITE_WASM_LOCAL    = './sql-wasm.wasm';
const SQLITE_ASMJS_LOCAL   = './sql.js';
const SQLITE_CDN           = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.13.0/sql-wasm.js';
const SQLITE_WASM_CDN      = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.13.0/sql-wasm.wasm';
const SQLITE_ASMJS_CDN     = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.13.0/sql.js';
const SQLITE_MAGIC        = 'SQLite format 3\0';
const SQLITE_SCHEMA_VERSION = 2;

const PERSIST_URGENT_MS   = 0;
const PERSIST_NORMAL_MS   = 3000;
const PERSIST_LAZY_MS     = 8000;

const sqliteStore = (() => {

  let _sqlDB           = null;
  let _SQL             = null;
  let _initPromise     = null;
  let _prefix          = '';
  let _uid             = '';
  let _quotaToastShown = false;
  let _pendingWrites   = 0;
  let _persistTimer    = null;
  let _persistUrgency  = PERSIST_LAZY_MS;
  let _lastPersistAt   = 0;
  let _hasOPFS         = false;
  let _persistChannel  = null;

  const _DEVICE_GLOBAL = new Set([
    'device_id', 'device_name', 'theme',
    'appMode', 'appMode_timestamp',
    'repProfile', 'repProfile_timestamp',
    'assignedManager', 'assignedUserTabs',
  ]);

  const _PLAINTEXT_KEYS = new Set([
    'appMode', 'appMode_timestamp',
    'repProfile', 'repProfile_timestamp',
    'assignedManager', 'assignedUserTabs',
    'device_name', 'theme', 'app_theme',
    'last_synced', 'firestore_initialized', 'firestore_init_timestamp',
    'ui_state', 'firestore_stats', 'session_start',
  ]);

  const _IDB_KEY_TO_COLLECTION = {
    'mfg_pro_pkr':                'production',
    'customer_sales':             'sales',
    'noman_history':              'calculator_history',
    'rep_sales':                  'rep_sales',
    'rep_customers':              'rep_customers',
    'sales_customers':            'sales_customers',
    'payment_transactions':       'transactions',
    'payment_entities':           'entities',
    'factory_inventory_data':     'inventory',
    'factory_production_history': 'factory_history',
    'stock_returns':              'returns',
    'expenses':                   'expenses',
    'deletion_records':           'deletions',
    'deleted_records':            'deleted_ids',
  };

  const _SETTINGS_KEYS = new Set([
    'factory_default_formulas', 'factory_additional_costs',
    'factory_sale_prices', 'factory_cost_adjustment_factor',
    'factory_unit_tracking', 'naswar_default_settings',
    'expense_categories', 'sales_reps_list', 'user_roles_list',
    'offline_operation_queue', 'offline_dead_letter_queue',
    'ui_state', 'app_theme', 'firestore_stats', 'session_start',
  ]);

  function _rowType(key) {
    if (_DEVICE_GLOBAL.has(key))                                  return 'device';
    if (_IDB_KEY_TO_COLLECTION[key])                              return 'collection';
    if (_SETTINGS_KEYS.has(key))                                  return 'settings';
    if (key.startsWith('lastSync_'))                              return 'sync_meta';
    if (key.startsWith('lastLocalMod_'))                          return 'sync_meta';
    if (key.startsWith('uploadedIds_'))                           return 'sync_meta';
    if (key.startsWith('factory_') && key.endsWith('_timestamp')) return 'sync_meta';
    if (key.endsWith('_timestamp'))                               return 'sync_meta';
    if (key === 'last_synced' || key === 'deltaSyncStats'
      || key === 'firestore_initialized' || key === 'firestore_init_timestamp'
      || key === 'pendingFirestoreYearClose' || key === 'team_list_timestamp'
      || key === 'user_state')                                    return 'sync_meta';
    return 'config';
  }

  function _persistUrgencyFor(key) {
    const rt = _rowType(key);
    if (rt === 'collection') return PERSIST_URGENT_MS;
    if (rt === 'settings')   return PERSIST_NORMAL_MS;
    return PERSIST_LAZY_MS;
  }

  function _isValidSQLite(bytes) {
    if (!bytes || bytes.length < 16) return false;
    for (let i = 0; i < 16; i++) {
      if (bytes[i] !== SQLITE_MAGIC.charCodeAt(i)) return false;
    }
    return true;
  }

  function _integrityCheck(db) {
    try {
      const rows = db.exec('PRAGMA integrity_check');
      const val  = rows.length && rows[0].values.length
        ? rows[0].values[0][0] : 'error';
      if (val !== 'ok') {
        console.error('[SQLite] integrity_check failed:', val);
        return false;
      }
      return true;
    } catch (e) {
      console.error('[SQLite] integrity_check threw:', _safeErr(e));
      return false;
    }
  }

  async function _checkQuota(requiredBytes = 0) {
    try {
      if (!navigator.storage || !navigator.storage.estimate) return true;
      const { usage, quota } = await navigator.storage.estimate();
      const available = quota - usage;
      if (available < requiredBytes + 512 * 1024) {
        if (!_quotaToastShown) {
          _quotaToastShown = true;
          const mbFree = Math.round(available / 1024 / 1024);
          if (typeof showToast === 'function')
            showToast(`Storage nearly full (${mbFree} MB free) — free space to keep saving data.`, 'warning', 10000);
          setTimeout(() => { _quotaToastShown = false; }, 30000);
        }
        return false;
      }
      return true;
    } catch { return true; }
  }

  async function _opfsWrite(filename, data) {
    const root = await navigator.storage.getDirectory();
    const fh   = await root.getFileHandle(filename, { create: true });
    const wr   = await fh.createWritable();
    await wr.write(data);
    await wr.close();
  }
  async function _opfsRead(filename) {
    try {
      const root = await navigator.storage.getDirectory();
      const fh   = await root.getFileHandle(filename);
      return new Uint8Array(await (await fh.getFile()).arrayBuffer());
    } catch { return null; }
  }
  async function _opfsDelete(filename) {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(filename);
    } catch {}
  }

  async function _opfsShadowWrite(data) {
    await _opfsWrite(SQLITE_DB_NAME, data);
  }

  const _LS_BLOB_KEY     = '_gznd_sqlite_db';
  const _LS_BLOB_KEY_BAK = '_gznd_sqlite_db_bak';

  async function _lsBlobWrite(lsKey, data) {
    try {
      const CHUNK = 0x8000;
      let binary = '';
      for (let i = 0; i < data.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, data.subarray(i, i + CHUNK));
      }
      localStorage.setItem(lsKey, btoa(binary));
    } catch(e) {
      console.warn('[SQLite] localStorage blob write failed (storage full?):', _safeErr(e));
    }
  }
  function _lsBlobRead(lsKey) {
    try {
      const b64 = localStorage.getItem(lsKey);
      if (!b64) return null;
      const binary = atob(b64);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    } catch { return null; }
  }

  async function _dualPersist() {
    if (!_sqlDB) return;
    const data     = _sqlDB.export();
    const required = data.byteLength * 2 + 1024 * 1024;
    await _checkQuota(required);
    const writes = [];
    if (_hasOPFS) {
      writes.push(
        _opfsShadowWrite(data)
          .then(() => _opfsWrite(SQLITE_DB_NAME + '.bak', data))
          .catch(e => console.warn('[SQLite] OPFS write failed:', _safeErr(e)))
      );
    } else {
      writes.push(
        Promise.resolve()
          .then(() => _lsBlobWrite(_LS_BLOB_KEY, data))
          .then(() => _lsBlobWrite(_LS_BLOB_KEY_BAK, data))
          .catch(e => console.warn('[SQLite] localStorage blob write failed:', _safeErr(e)))
      );
    }
    await Promise.allSettled(writes);
    _pendingWrites = 0;
    _lastPersistAt = Date.now();
  }

  function _schedulePersist(urgencyMs) {
    _pendingWrites++;
    if (urgencyMs < _persistUrgency || _persistTimer === null) {
      _persistUrgency = urgencyMs;
      if (_persistTimer) clearTimeout(_persistTimer);
      _persistTimer = setTimeout(() => {
        _persistTimer   = null;
        _persistUrgency = PERSIST_LAZY_MS;
        _dualPersist()
          .then(() => _notifyPersisted())
          .catch(e => console.warn('[SQLite] persist error:', _safeErr(e)));
      }, urgencyMs);
    }
  }

  async function _flushPersist() {
    if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null; }
    _persistUrgency = PERSIST_LAZY_MS;
    if (_pendingWrites > 0) await _dualPersist();
  }

  function _notifyPersisted() {
    if (!_persistChannel) return;
    try { _persistChannel.postMessage({ type: 'sqlite-persisted', uid: _uid, ts: Date.now() }); }
    catch {}
  }

  async function _loadBestDB() {
    const sources = [];
    if (_hasOPFS) {
      sources.push({ name: 'OPFS primary', load: () => _opfsRead(SQLITE_DB_NAME) });
      sources.push({ name: 'OPFS backup',  load: () => _opfsRead(SQLITE_DB_NAME + '.bak') });
    } else {
      sources.push({ name: 'localStorage primary', load: async () => _lsBlobRead(_LS_BLOB_KEY)     });
      sources.push({ name: 'localStorage backup',  load: async () => _lsBlobRead(_LS_BLOB_KEY_BAK) });
    }
    for (const src of sources) {
      try {
        const bytes = await src.load();
        if (bytes && _isValidSQLite(bytes)) {
          return bytes;
        }
        if (bytes) console.warn(`[SQLite] ${src.name} failed integrity check — trying next`);
      } catch (e) {
        console.warn(`[SQLite] ${src.name} error:`, _safeErr(e));
      }
    }
    return null;
  }

  async function _canFetch(url) {
    try {
      const r = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
      return r.ok;
    } catch { return false; }
  }

  function _injectScript(src) {
    return new Promise((resolve, reject) => {

      if (document.querySelector('script[src="' + src + '"]')) { resolve(); return; }
      const s   = document.createElement('script');
      s.src     = src;
      s.onload  = () => resolve();
      s.onerror = () => reject(new Error('[SQLite] script load failed: ' + src));
      document.head.appendChild(s);
    });
  }

  async function _tryLoadWasm() {

    const wasmUrl = (await _canFetch(SQLITE_WASM_LOCAL))
      ? SQLITE_WASM_LOCAL
      : SQLITE_WASM_CDN;

    if (typeof window.initSqlJs !== 'function') {
      const jsUrl = (await _canFetch(SQLITE_JS_LOCAL)) ? SQLITE_JS_LOCAL : SQLITE_CDN;
      await _injectScript(jsUrl);
    }

    if (typeof window.initSqlJs !== 'function') {
      throw new Error('[SQLite] initSqlJs not available after script load');
    }

    const resp   = await fetch(wasmUrl);
    if (!resp.ok) throw new Error('[SQLite] WASM fetch failed: ' + resp.status);
    const buffer = await resp.arrayBuffer();
    return window.initSqlJs({ wasmBinary: buffer });
  }

  async function _tryLoadAsmJs() {

    delete window.initSqlJs;
    delete window.SQL;

    const jsUrl = (await _canFetch(SQLITE_ASMJS_LOCAL))
      ? SQLITE_ASMJS_LOCAL
      : SQLITE_ASMJS_CDN;

    await _injectScript(jsUrl);

    if (typeof window.initSqlJs !== 'function') {
      throw new Error('[SQLite] asm.js initSqlJs not available after script load');
    }

    return window.initSqlJs();
  }

  async function _loadSqlJs() {
    if (window.SQL) return window.SQL;

    try {
      const SQL = await _tryLoadWasm();
      return (window.SQL = SQL);
    } catch (e1) {
      console.warn('[SQLite] WASM build failed, falling back to asm.js:', _safeErr(e1));
    }

    try {
      const SQL = await _tryLoadAsmJs();
      return (window.SQL = SQL);
    } catch (e2) {

      const msg = '[SQLite] Both WASM and asm.js builds failed. '
        + 'Run: node download-sqljs.js to install local files. '
        + 'Details: ' + e2.message;
      console.error(msg);
      throw new Error(msg);
    }
  }

  let _stmtGet = null;
  function _clearStmtCache() {
    if (_stmtGet) { try { _stmtGet.free(); } catch {} _stmtGet = null; }
  }

  function _bootstrapSchema(db) {

    db.run('PRAGMA journal_mode=WAL');
    db.run('PRAGMA synchronous=NORMAL');
    db.run('PRAGMA temp_store=MEMORY');
    db.run('PRAGMA cache_size=-8000');

    db.run(`CREATE TABLE IF NOT EXISTS schema_version (
      version     INTEGER NOT NULL,
      upgraded_at INTEGER NOT NULL
    )`);
    const vRows          = db.exec('SELECT version FROM schema_version LIMIT 1');
    const currentVersion = (vRows.length && vRows[0].values.length)
      ? vRows[0].values[0][0] : 0;

    db.run(`CREATE TABLE IF NOT EXISTS kv_store (
      full_key   TEXT    NOT NULL PRIMARY KEY,
      user_key   TEXT    NOT NULL,
      uid        TEXT    NOT NULL DEFAULT '',
      collection TEXT    NOT NULL DEFAULT '',
      row_type   TEXT    NOT NULL DEFAULT 'config',
      encrypted  INTEGER NOT NULL DEFAULT 0,
      value      TEXT,
      ts         INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS ndapp_outbox (
      id           TEXT    NOT NULL PRIMARY KEY,
      uid          TEXT    NOT NULL DEFAULT '',
      action       TEXT    NOT NULL,
      collection   TEXT    NOT NULL DEFAULT '',
      doc_id       TEXT    NOT NULL DEFAULT '',
      payload      TEXT,
      created_at   INTEGER NOT NULL DEFAULT 0,
      attempts     INTEGER NOT NULL DEFAULT 0,
      last_attempt INTEGER NOT NULL DEFAULT 0
    )`);

    db.run(`CREATE INDEX IF NOT EXISTS idx_kv_uid_key
            ON kv_store (uid, user_key)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_kv_collection
            ON kv_store (uid, collection) WHERE collection != ''`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_kv_row_type
            ON kv_store (uid, row_type)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_kv_ts
            ON kv_store (ts)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_kv_device
            ON kv_store (row_type) WHERE row_type = 'device'`);

    db.run(`CREATE INDEX IF NOT EXISTS idx_outbox_uid
            ON ndapp_outbox (uid, created_at)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_outbox_col
            ON ndapp_outbox (uid, collection)`);

  }

  function _fullKey(key) {
    if (!_prefix || _DEVICE_GLOBAL.has(key)) return key;
    return _prefix + key;
  }

  function _rawGet(fullKey) {
    try {
      if (!_stmtGet) _stmtGet = _sqlDB.prepare('SELECT value, encrypted FROM kv_store WHERE full_key = ?');
      _stmtGet.bind([fullKey]);
      let row = null;
      if (_stmtGet.step()) row = _stmtGet.getAsObject();
      _stmtGet.reset();
      return row;
    } catch (e) {
      _stmtGet = null;
      const stmt = _sqlDB.prepare('SELECT value, encrypted FROM kv_store WHERE full_key = ?');
      stmt.bind([fullKey]);
      let row = null;
      if (stmt.step()) row = stmt.getAsObject();
      stmt.free();
      return row;
    }
  }

  function _rawSet(key, serialized, isEncrypted) {
    const now        = Date.now();
    const fk         = _fullKey(key);
    const uid        = _DEVICE_GLOBAL.has(key) ? '' : _uid;
    const collection = _IDB_KEY_TO_COLLECTION[key] || '';
    const rowType    = _rowType(key);
    _sqlDB.run(`
      INSERT INTO kv_store
        (full_key, user_key, uid, collection, row_type, encrypted, value, ts, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(full_key) DO UPDATE SET
        value      = excluded.value,
        encrypted  = excluded.encrypted,
        ts         = excluded.ts,
        row_type   = excluded.row_type,
        collection = excluded.collection
    `, [fk, key, uid, collection, rowType, isEncrypted ? 1 : 0, serialized, now, now]);
  }

  function _rawDelete(fullKey) {
    _sqlDB.run('DELETE FROM kv_store WHERE full_key = ?', [fullKey]);
    _schedulePersist(PERSIST_NORMAL_MS);
  }

  async function _decrypt(key, rawData) {
    if (rawData === null || rawData === undefined) return null;
    const isPlain = _PLAINTEXT_KEYS.has(key);
    if (isPlain) {
      if (typeof rawData === 'string' && rawData.startsWith('GZND_ENC_')) return null;
      try { return JSON.parse(rawData); } catch { return rawData; }
    }
    const dec = await SQLiteCrypto.decrypt(rawData);
    if (dec === null) return null;
    try { return JSON.parse(dec); } catch { return dec; }
  }

  function _outboxAdd(action, collection, docId, payload) {
    if (!_sqlDB) return;
    const id = (typeof generateUUID === 'function')
      ? generateUUID('ob')
      : Date.now().toString(36) + Math.random().toString(36).slice(2);
    _sqlDB.run(`
      INSERT OR IGNORE INTO ndapp_outbox
        (id, uid, action, collection, doc_id, payload, created_at, attempts, last_attempt)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)
    `, [id, _uid, action, collection || '', docId || '', payload ? JSON.stringify(payload) : null, Date.now()]);
    _schedulePersist(PERSIST_URGENT_MS);
  }

  function _outboxGetAll() {
    if (!_sqlDB) return [];
    return _sqlDB.exec(
      'SELECT id, action, collection, doc_id, payload FROM ndapp_outbox WHERE uid=? ORDER BY created_at',
      [_uid]
    ).flatMap(r => r.values.map(v => ({
      id: v[0], action: v[1], collection: v[2], doc_id: v[3],
      data: v[4] ? JSON.parse(v[4]) : null,
    })));
  }

  function _outboxRemove(id) {
    if (!_sqlDB) return;
    _sqlDB.run('DELETE FROM ndapp_outbox WHERE id = ?', [id]);
    _schedulePersist(PERSIST_NORMAL_MS);
  }

  function _outboxBumpAttempt(id) {
    if (!_sqlDB) return;
    _sqlDB.run(
      'UPDATE ndapp_outbox SET attempts=attempts+1, last_attempt=? WHERE id=?',
      [Date.now(), id]
    );
  }

  async function _drainOutbox() {
    if (!_sqlDB || !navigator.onLine) return;
    if (typeof firebaseDB === 'undefined' || !firebaseDB) return;
    if (typeof currentUser === 'undefined' || !currentUser) return;
    const ops = _outboxGetAll();
    if (ops.length === 0) return;
    const userRef = firebaseDB.collection('users').doc(currentUser.uid);
    let drained = 0;
    for (const op of ops) {
      try {
        if (op.action === 'set' || op.action === 'set-doc') {
          const ref = userRef.collection(op.collection).doc(op.doc_id);
          const drainData = { ...(op.data || {}) };
          if (typeof firebase !== 'undefined' && firebase.firestore && !drainData.isMerged) {
            drainData.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
          }
          await ref.set(drainData, { merge: true });
        } else if (op.action === 'delete') {
          const ref = userRef.collection(op.collection).doc(op.doc_id);
          await ref.delete();
        }
        _outboxRemove(op.id);
        drained++;
      } catch (e) {
        _outboxBumpAttempt(op.id);
        console.warn(`[SQLite.outbox] op ${op.id} failed (will retry):`, _safeErr(e));
      }
    }
    if (drained > 0) {
      await _flushPersist();
    }
  }

  return {

    DECRYPT_FAILED: Symbol('DECRYPT_FAILED'),

    setUserPrefix(uid) {
      const newPrefix = uid ? 'u_' + uid + '_' : '';
      if (_prefix !== newPrefix) {
        _prefix = newPrefix;
        _uid    = uid || '';
        if (typeof DeltaSync !== 'undefined') {
          DeltaSync._cache = {};
          DeltaSync._dirty = new Map();
          DeltaSync._uploaded = new Map();
          DeltaSync._downloaded = new Map();
          if (typeof DeltaSync.loadAllPendingIds === 'function') {
            setTimeout(() => DeltaSync.loadAllPendingIds().catch(() => {}), 100);
          }
        }
      }
    },

    clearUserPrefix() {
      _prefix = '';
      _uid    = '';
      if (typeof DeltaSync !== 'undefined') {
        DeltaSync._cache = {};
        DeltaSync._dirty = new Map();
      }
    },

    async init() {
      if (_sqlDB)       return _sqlDB;
      if (_initPromise) return _initPromise;
      _initPromise = (async () => {
        try {

          _hasOPFS = typeof navigator !== 'undefined' &&
                     !!navigator.storage &&
                     typeof navigator.storage.getDirectory === 'function';

          _SQL = await _loadSqlJs();
          const existing = await _loadBestDB();
          _clearStmtCache();
          _sqlDB = existing ? new _SQL.Database(existing) : new _SQL.Database();
          _bootstrapSchema(_sqlDB);

          if (existing && !_integrityCheck(_sqlDB)) {
            console.error('[SQLite] Integrity check failed — proceeding with caution');
          }

          if (!existing) await _dualPersist();

          if (navigator.onLine) {
            setTimeout(() => _drainOutbox().catch(() => {}), 2000);
          }

          try { _persistChannel = new BroadcastChannel('sqlite-persist-channel'); }
          catch {}

          window.addEventListener('online', () => {
            _drainOutbox().catch(() => {});
            if (typeof triggerAutoSync === 'function') triggerAutoSync();
          });

          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && _pendingWrites > 0) {
              _dualPersist().catch(() => {});
            }
          });

          window.addEventListener('beforeunload', () => {
            if (_pendingWrites > 0 && _sqlDB) {
              if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null; }
              try {
                const data = _sqlDB.export();
                _lsBlobWrite(_LS_BLOB_KEY, data).catch(() => {});
                if (_hasOPFS) {
                  _opfsShadowWrite(data).catch(() => {});
                }
              } catch {}
            }
          });

          return _sqlDB;
        } catch (e) {
          _initPromise = null;
          throw e;
        }
      })();
      return _initPromise;
    },

    async get(key, defaultValue = null) {
      await this.init();
      const row = _rawGet(_fullKey(key));
      if (!row) return defaultValue;
      try {
        if (row.encrypted) {
          const val = await _decrypt(key, row.value);
          return val === null ? defaultValue : val;
        }
        try { return JSON.parse(row.value); } catch { return row.value; }
      } catch (e) {
        console.warn('[SQLite.get]', key, _safeErr(e));
        return defaultValue;
      }
    },

    async set(key, value) {
      await this.init();
      if (!SQLiteCrypto.isReady()) await SQLiteCrypto.restoreSessionKeyFromStorage().catch(() => {});
      const _rt = _rowType(key);
      if (_rt === 'collection') {
        if (Array.isArray(value)) {
          value = value.map(r => (typeof r === 'object' && r !== null) ? ensureRecordIntegrity(r) : r);
        } else if (typeof value === 'object' && value !== null) {
          value = ensureRecordIntegrity(value);
        }
      }
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      const isPlain    = _PLAINTEXT_KEYS.has(key);
      let stored, isEncrypted;
      if (isPlain) {
        stored = serialized; isEncrypted = false;
      } else {
        try {
          stored = await SQLiteCrypto.encrypt(serialized);
          isEncrypted = SQLiteCrypto.isReady();
        } catch (e) {
          console.warn('[SQLite.set] encryption failed for', key, _safeErr(e));
          stored = serialized; isEncrypted = false;
        }
      }
      _rawSet(key, stored, isEncrypted);
      _schedulePersist(_persistUrgencyFor(key));
    },

    async setBatch(entries) {
      await this.init();
      if (!SQLiteCrypto.isReady()) await SQLiteCrypto.restoreSessionKeyFromStorage().catch(() => {});
      const validated = entries.map(([key, value]) => {
        if (_rowType(key) === 'collection') {
          if (Array.isArray(value)) {
            value = value.map(r => (typeof r === 'object' && r !== null) ? ensureRecordIntegrity(r) : r);
          } else if (typeof value === 'object' && value !== null) {
            value = ensureRecordIntegrity(value);
          }
        }
        return [key, value];
      });
      const prepared = await Promise.all(validated.map(async ([key, value]) => {
        const serialized = typeof value === 'string' ? value : JSON.stringify(value);
        const isPlain    = _PLAINTEXT_KEYS.has(key);
        if (isPlain) return [key, serialized, false];
        try {
          const enc = await SQLiteCrypto.encrypt(serialized);
          return [key, enc, SQLiteCrypto.isReady()];
        } catch { return [key, serialized, false]; }
      }));
      let batchUrgency = PERSIST_LAZY_MS;
      for (const [key] of entries) {
        const u = _persistUrgencyFor(key);
        if (u < batchUrgency) batchUrgency = u;
      }
      _sqlDB.run('BEGIN TRANSACTION');
      try {
        for (const [key, stored, isEnc] of prepared) _rawSet(key, stored, isEnc);
        _sqlDB.run('COMMIT');
      } catch (e) {
        try { _sqlDB.run('ROLLBACK'); } catch {}
        throw e;
      }
      _schedulePersist(batchUrgency);
    },

    async getBatch(keys) {
      await this.init();
      const results = new Map();
      if (keys.length === 0) return results;
      await SQLiteCrypto.restoreSessionKeyFromStorage();

      for (const key of keys) {
        const row = _rawGet(_fullKey(key));
        if (!row) { results.set(key, null); continue; }
        try {
          if (row.encrypted) {
            const val = await _decrypt(key, row.value);
            if (val === null) {
              const wasEnc = typeof row.value === 'string' && row.value.startsWith('GZND_ENC_');
              results.set(key, wasEnc ? this.DECRYPT_FAILED : null);
            } else {
              results.set(key, val);
            }
          } else {
            const isPlain = _PLAINTEXT_KEYS.has(key);
            if (isPlain && typeof row.value === 'string' && row.value.startsWith('GZND_ENC_')) {
              results.set(key, null); continue;
            }
            try { results.set(key, JSON.parse(row.value)); }
            catch { results.set(key, row.value); }
          }
        } catch (e) {
          const wasEnc = typeof row.value === 'string' && row.value.startsWith('GZND_ENC_');
          if (wasEnc) {
            console.warn('[SQLite.getBatch] decrypt exception for', key, _safeErr(e));
            results.set(key, this.DECRYPT_FAILED);
          } else {
            try { results.set(key, JSON.parse(row.value)); }
            catch { results.set(key, row.value); }
          }
        }
      }
      return results;
    },

    async remove(key) {
      await this.init();
      _rawDelete(_fullKey(key));
    },

    async clearUserData() {
      await this.init();
      _clearStmtCache();
      if (!_uid) {
        _sqlDB.run(`DELETE FROM kv_store WHERE row_type != 'device'`);
        _sqlDB.run('DELETE FROM ndapp_outbox');
      } else {
        _sqlDB.run(`DELETE FROM kv_store WHERE uid=? AND row_type != 'device'`, [_uid]);
        _sqlDB.run('DELETE FROM ndapp_outbox WHERE uid=?', [_uid]);
      }
      _sqlDB.run('PRAGMA wal_checkpoint(TRUNCATE)');
      await _flushPersist();
    },

    async clearAll() {
      await this.init();
      _clearStmtCache();
      _sqlDB.run('DELETE FROM kv_store');
      _sqlDB.run('DELETE FROM ndapp_outbox');
      _sqlDB.run('PRAGMA wal_checkpoint(TRUNCATE)');
      await _flushPersist();
    },

    async flush() {
      await _flushPersist();
    },

    query(sql, params = []) {
      if (!_sqlDB) throw new Error('[SQLite] not initialised');
      const out  = [];
      const stmt = _sqlDB.prepare(sql);
      stmt.bind(params);
      while (stmt.step()) out.push(stmt.getAsObject());
      stmt.free();
      return out;
    },

    async reEncryptAll() {
      if (!SQLiteCrypto.isReady() || !_sqlDB) return;
      try {
        const rows = _sqlDB.exec(
          "SELECT full_key, user_key, value, encrypted FROM kv_store WHERE encrypted=0 AND row_type IN ('collection','settings')"
        );
        if (!rows.length || !rows[0].values.length) return;
        let updated = 0;
        for (const [fk, uk, rawVal] of rows[0].values) {
          if (!rawVal || typeof rawVal !== 'string') continue;
          if (rawVal.startsWith('GZND_ENC_')) continue;
          try {
            const enc = await SQLiteCrypto.encrypt(rawVal);
            if (enc !== rawVal) {
              _sqlDB.run(
                'UPDATE kv_store SET value=?, encrypted=1 WHERE full_key=?',
                [enc, fk]
              );
              updated++;
            }
          } catch { /* skip individual row failures */ }
        }
        if (updated > 0) {
          _schedulePersist(PERSIST_NORMAL_MS);
        }
      } catch (e) {
        console.warn('[SQLite] reEncryptAll error:', _safeErr(e));
      }
    },

    outboxAdd(action, collection, docId, payload) {
      _outboxAdd(action, collection, docId, payload);
    },

    outboxGetAll() {
      return _outboxGetAll();
    },

    outboxAck(id) {
      _outboxRemove(id);
    },

    drainOutbox() {
      return _drainOutbox();
    },

    outboxPending() {
      if (!_sqlDB) return 0;
      try {
        const r = _sqlDB.exec(
          'SELECT COUNT(*) FROM ndapp_outbox WHERE uid=?', [_uid]
        );
        return (r.length && r[0].values.length) ? r[0].values[0][0] : 0;
      } catch { return 0; }
    },

    exportDB() {
      if (!_sqlDB) return null;
      return _sqlDB.export();
    },

    exportWithMeta() {
      if (!_sqlDB) return null;
      const data = _sqlDB.export();
      return {
        version:       SQLITE_SCHEMA_VERSION,
        exportedAt:    new Date().toISOString(),
        uid:           _uid,
        dbSizeBytes:   data.byteLength,
        rowCount:      this.query('SELECT COUNT(*) as n FROM kv_store')[0]?.n || 0,
        outboxCount:   this.outboxPending(),
        bytes:         data,
      };
    },

    async importDB(bytes) {
      if (!_isValidSQLite(bytes)) throw new Error('[SQLite] importDB: invalid SQLite file');
      await this.init();
      _clearStmtCache();
      _sqlDB = new _SQL.Database(bytes);
      _bootstrapSchema(_sqlDB);
      if (!_integrityCheck(_sqlDB)) throw new Error('[SQLite] importDB: integrity check failed');
      await _dualPersist();
    },

    async offlineStatus() {
      await this.init();
      const schemaRows = _sqlDB.exec('SELECT version, upgraded_at FROM schema_version LIMIT 1');
      const schemaVer  = schemaRows.length ? schemaRows[0].values[0][0] : 0;
      const schemaAt   = schemaRows.length ? schemaRows[0].values[0][1] : 0;

      const countRows  = _sqlDB.exec(
        `SELECT row_type, COUNT(*) as n FROM kv_store
         WHERE uid=? OR row_type='device' GROUP BY row_type`,
        [_uid]
      );
      const rowCounts  = {};
      if (countRows.length) countRows[0].values.forEach(([rt, n]) => { rowCounts[rt] = n; });

      const outboxRows = _sqlDB.exec(
        'SELECT COUNT(*) as n, MAX(attempts) as max_attempts FROM ndapp_outbox WHERE uid=?',
        [_uid]
      );
      const outboxN    = outboxRows.length ? outboxRows[0].values[0][0] : 0;
      const maxAttempt = outboxRows.length ? outboxRows[0].values[0][1] : 0;

      let quota = null;
      try {
        if (navigator.storage && navigator.storage.estimate) {
          const est = await navigator.storage.estimate();
          quota = {
            usedMB:  (est.usage  / 1024 / 1024).toFixed(1),
            quotaMB: (est.quota  / 1024 / 1024).toFixed(1),
            freeMB:  ((est.quota - est.usage) / 1024 / 1024).toFixed(1),
            pct:     ((est.usage / est.quota) * 100).toFixed(1) + '%',
          };
        }
      } catch {}

      const dbBytes  = _sqlDB.export().byteLength;
      const cacheHit = 0;

      return {
        sqlite: {
          schemaVersion:   schemaVer,
          upgradedAt:      schemaAt ? new Date(schemaAt).toISOString() : null,
          dbSizeKB:        (dbBytes / 1024).toFixed(1),
          pendingWrites:   _pendingWrites,
          lastPersistedAt: _lastPersistAt ? new Date(_lastPersistAt).toISOString() : null,
          opfsPrimary:     _hasOPFS,
          rowsByType:      rowCounts,
          readCacheSize:   cacheHit,
        },
        outbox: {
          pendingOps:  outboxN,
          maxAttempts: maxAttempt,
        },
        network: {
          online:     navigator.onLine,
          offlineQueue: typeof OfflineQueue !== 'undefined' ? OfflineQueue.queue.length      : 0,
          failedOps:    typeof OfflineQueue !== 'undefined' ? OfflineQueue.deadLetterQueue.length : 0,
        },
        storage: quota,
      };
    },

    schemaVersion() {
      if (!_sqlDB) return null;
      try {
        const r = _sqlDB.exec('SELECT version FROM schema_version LIMIT 1');
        return (r.length && r[0].values.length) ? r[0].values[0][0] : 0;
      } catch { return 0; }
    },

    walCheckpoint() {
      if (!_sqlDB) return;
      try { _sqlDB.run('PRAGMA wal_checkpoint(PASSIVE)'); }
      catch {}
    },

    collectionStats() {
      if (!_sqlDB) return {};
      try {
        const rows = _sqlDB.exec(
          `SELECT collection, COUNT(*) as n
           FROM kv_store WHERE uid=? AND collection != ''
           GROUP BY collection`,
          [_uid]
        );
        const out = {};
        if (rows.length) rows[0].values.forEach(([col, n]) => { out[col] = n; });
        return out;
      } catch { return {}; }
    },

  };
})();

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
if (typeof loadUIState === 'function') await loadUIState();
const configKeys = [
'naswar_default_settings', 'appMode', 'repProfile', 'expense_categories',
'sales_reps_list', 'assignedManager', 'assignedUserTabs',
'appMode_timestamp', 'repProfile_timestamp'
];
const batchResults = await sqliteStore.getBatch(configKeys);
const _notFailed = v => v !== null && v !== undefined && v !== sqliteStore.DECRYPT_FAILED;
const loadedDefaultSettings = batchResults.get('naswar_default_settings');
if (loadedDefaultSettings && typeof loadedDefaultSettings === 'object') {
defaultSettings = loadedDefaultSettings;
}
const loadedAppMode = batchResults.get('appMode');
if (_notFailed(loadedAppMode) && typeof loadedAppMode === 'string') {
appMode = loadedAppMode;
}
const loadedRepProfile = batchResults.get('repProfile');
if (_notFailed(loadedRepProfile) && typeof loadedRepProfile === 'string') {
currentRepProfile = loadedRepProfile;
}
const loadedExpenseCategories = batchResults.get('expense_categories');
if (_notFailed(loadedExpenseCategories) && Array.isArray(loadedExpenseCategories)) {
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
const criticalResults = await sqliteStore.getBatch(CRITICAL_KEYS);
const failedKeys = CRITICAL_KEYS.filter(k => criticalResults.get(k) === sqliteStore.DECRYPT_FAILED);
if (failedKeys.length > 0 && SQLiteCrypto.isReady()) {
const err = new Error('Decryption failed — data may be corrupted or the encryption key has changed.');
err.code = 'DECRYPT_FAILED';
err.failedKeys = failedKeys;
throw err;
}
if (!SQLiteCrypto.isReady()) {
const criticalEmpty = CRITICAL_KEYS.every(k => ensureArray(criticalResults.get(k)).length === 0);
if (criticalEmpty && typeof showToast === 'function') {
showToast('Encryption key unavailable — if you have existing data, please log in again.', 'warning', 6000);
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
console.warn('_writeCookie failed:', _safeErr(e));
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
/**
 * Extracts the first-login timestamp embedded in a composite device ID.
 * Composite format: "<prefix>-<uuid>_<epochMs>"  e.g. "dev-abc123..._1711234567890"
 * Returns a Date if the suffix is present, otherwise null.
 */
function _extractDeviceFirstLoginTime(deviceId) {
  if (!deviceId || typeof deviceId !== 'string') return null;
  const match = deviceId.match(/_(\d{13})$/);
  if (!match) return null;
  const ms = parseInt(match[1], 10);
  if (!isFinite(ms) || ms < 1577836800000 || ms > 4102358400000) return null;
  return new Date(ms);
}
window._extractDeviceFirstLoginTime = _extractDeviceFirstLoginTime;

async function _persistDeviceId(deviceId) {
_writeCookie(DEVICE_ID_COOKIE, deviceId);
try { localStorage.setItem('persistent_device_id', deviceId); } catch (e) {  }
_writeSession('gz_did_session', deviceId);
try { await sqliteStore.set('device_id', deviceId); } catch (e) {  }
await _writeCacheAnchor(deviceId);
}

/**
 * Wipes every storage location that holds the device ID and install token so
 * a brand-new composite ID (uuid + first-login timestamp) is generated on the
 * next login. Does NOT touch appMode, repProfile, or any other device-global
 * key — those are intentionally preserved across logouts.
 */
async function _clearDeviceIdStorage() {
  // Expire cookies immediately
  try {
    document.cookie = `${DEVICE_ID_COOKIE}=; max-age=0; path=/; SameSite=Strict`;
  } catch(_) {}
  try {
    document.cookie = `${INSTALL_TOKEN_COOKIE}=; max-age=0; path=/; SameSite=Strict`;
  } catch(_) {}
  // localStorage
  try { localStorage.removeItem('persistent_device_id'); } catch(_) {}
  // sessionStorage (belt-and-suspenders — signOut also calls sessionStorage.clear())
  try {
    sessionStorage.removeItem('gz_did_session');
    sessionStorage.removeItem('gz_itk_session');
  } catch(_) {}
  // Cache API anchor
  try {
    if ('caches' in window) {
      const cache = await caches.open(_CACHE_STORE_NAME);
      await cache.delete(_CACHE_DEVICE_KEY);
    }
  } catch(_) {}
  // SQLite device_id row
  try { await sqliteStore.set('device_id', null); } catch(_) {}
  // Reset in-memory cached shard so the next UUID batch picks up the new shard
  _cachedDeviceShard = null;
  // Reset UID ownership so the next login is always treated as a fresh session
  _deviceIdOwnerUid = null;
}
window._clearDeviceIdStorage = _clearDeviceIdStorage;

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
console.warn('Fingerprint-based device ID recovery failed:', _safeErr(e));
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
console.warn('Token-based device ID recovery failed:', _safeErr(e));
}
return null;
}
async function getDeviceId() {
// ── Login-timestamp self-expiry ───────────────────────────────────────────
// Every genuine login stamps _gznd_login_ts = Date.now() into sessionStorage
// (sync.js onAuthStateChanged).  sessionStorage survives page reloads but
// is cleared by signOut() and wiped between browser sessions.
//
// The device ID format is "<uuid>_<epochMs>" — the suffix IS the session
// birth time.  We compare it against _gznd_login_ts:
//   • suffix >= login_ts  → ID belongs to this login session, keep it
//   • suffix <  login_ts  → ID is from a previous session, discard it
//     (this also skips Firestore fingerprint/token recovery, so the old
//      shard can never be pulled back from the cloud)
//
// If _gznd_login_ts is absent (auth-state restore on hard reload without an
// explicit login flow) we treat any stored ID as valid — the session is
// genuinely continuing.
let _loginTs = 0;
try { _loginTs = parseInt(sessionStorage.getItem('_gznd_login_ts') || '0', 10) || 0; } catch(_) {}

// ── Per-user guard (belt-and-suspenders for same-tab account switch) ─────
const _callerUid = currentUser ? (currentUser.uid || currentUser.id) : null;
const _uidChanged = _callerUid && _deviceIdOwnerUid && _callerUid !== _deviceIdOwnerUid;

// Helper: is a candidate device ID fresh enough for this login session?
function _isStale(did) {
  if (!did || !_loginTs) return false; // no login stamp → accept anything
  const match = did.match(/_(\d{13})$/);
  if (!match) return true;             // legacy format without timestamp → always stale
  const idTs = parseInt(match[1], 10);
  return idTs < _loginTs;              // predates this login → stale
}

let deviceId = null;

if (!_uidChanged) {
  // Read from every persistent store in priority order
  let candidate = _readCookie(DEVICE_ID_COOKIE);
  if (!candidate) candidate = _readSession('gz_did_session');
  if (!candidate) {
    try { candidate = localStorage.getItem('persistent_device_id') || null; } catch(e) {}
  }
  if (!candidate) {
    try { candidate = await sqliteStore.get('device_id'); } catch(e) {}
  }
  if (!candidate) candidate = await _readCacheAnchor();

  // Only accept the candidate if it belongs to this login session
  if (candidate && !_isStale(candidate)) {
    deviceId = candidate;
  }
  // If candidate is stale (predates _loginTs), drop it and fall through to
  // UUID generation.  Firestore recovery is intentionally skipped — it
  // would only return the same old ID/shard we just discarded.
}

if (!deviceId) {
  // Mint a brand-new ID whose embedded timestamp = now (this login session)
  deviceId = _generateUUID() + '_' + Date.now();
}

await _persistDeviceId(deviceId);
// Record which user owns this device ID so we can detect future account switches.
if (_callerUid) _deviceIdOwnerUid = _callerUid;

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
try { await sqliteStore.set('device_id', null); } catch(e) {}
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
console.warn('Canvas fingerprint hash failed', _safeErr(e));
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
let deviceName = await sqliteStore.get('device_name');
if (!deviceName) {
const fp = await getDeviceFingerprint();
deviceName = fp.readableName;
await sqliteStore.set('device_name', deviceName);
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
try { await sqliteStore.set('device_name', deviceName); } catch(e) {
console.warn('Failed to save data locally.', _safeErr(e));
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
console.warn('Duplicate cleanup failed:', _safeErr(dupErr));
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
const sqliteBatch = [
['appMode', appMode],
['appMode_timestamp', existing.appMode_timestamp || Date.now()]
];
if (persistedMode === 'rep' && persistedRep) {
currentRepProfile = persistedRep;
sqliteBatch.push(['repProfile', persistedRep]);
} else if (persistedMode === 'userrole') {
const persistedUserManager = existing.assignedManager || existing.assignedRoleName || null;
const persistedUserTabs = Array.isArray(existing.assignedUserTabs) ? existing.assignedUserTabs : [];
window._assignedManagerName = persistedUserManager;
window._assignedUserTabs = persistedUserTabs;
window._userRoleAllowedTabs = persistedUserTabs;
sqliteBatch.push(['assignedManager', persistedUserManager]);
sqliteBatch.push(['assignedUserTabs', persistedUserTabs]);
} else if ((persistedMode === 'production' || persistedMode === 'factory') && persistedManager) {
window._assignedManagerName = persistedManager;
sqliteBatch.push(['assignedManager', persistedManager]);
}
await sqliteStore.setBatch(sqliteBatch);
}

const isFirstRegistration = !existingDoc.exists;

// Derive the unique shard from the composite device ID (which embeds the
// first-login timestamp), so each device always maps to a stable, unique shard.
const deviceShard = _deriveDeviceShard(deviceId);

// Extract the first-login timestamp that was baked into the device ID at
// creation time, falling back to server time for legacy IDs that pre-date
// this scheme.
const firstLoginDate = _extractDeviceFirstLoginTime(deviceId);
const firstLoginAtMs = firstLoginDate ? firstLoginDate.getTime() : null;

// Read the canonical mode timestamp from SQLite so restoreDeviceModeOnLogin
// can correctly compare cloudTimestamp vs localTimestamp.  Without this,
// cloudTimestamp would be 0 (field absent) and the comparison would be
// meaningless for newly-created device documents.
let _persistedModeTs = existing.appMode_timestamp || 0;
try {
  const _sqliteTs = await sqliteStore.get('appMode_timestamp');
  if (_sqliteTs && Number(_sqliteTs) > _persistedModeTs) _persistedModeTs = Number(_sqliteTs);
} catch(_) {}

await deviceRef.set({
deviceId: deviceId,
deviceShard: deviceShard,
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
// Always persist firstLoginAt from the device ID's embedded timestamp so it
// survives document merges; fall back to server time for legacy devices.
...(isFirstRegistration ? {
  registeredAt: firebase.firestore.FieldValue.serverTimestamp(),
  firstLoginAt: firstLoginAtMs !== null
    ? firstLoginAtMs
    : firebase.firestore.FieldValue.serverTimestamp(),
} : {
  // For returning devices: fill in firstLoginAt if the field is missing
  // (migration from legacy IDs that had no embedded timestamp).
  ...((!existing.firstLoginAt && firstLoginAtMs !== null)
    ? { firstLoginAt: firstLoginAtMs } : {}),
}),
currentMode: persistedMode,
// Write the canonical timestamp so restoreDeviceModeOnLogin can compare
// cloudTimestamp === localTimestamp and correctly skip re-applying the mode
// (it is already active).  This prevents a spurious reload on every login.
appMode_timestamp: _persistedModeTs || Date.now(),
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

setTimeout(() => {
listenForDeviceCommands().catch(e => console.warn('Device command listener failed.', _safeErr(e)));
}, 2000);
listenForTeamChanges();
await logDeviceActivity('device_registered', {
deviceId: deviceId,
deviceName: deviceName,
deviceType: deviceType,
browser: browser
});
} catch (error) {
console.error('Device registration failed.', _safeErr(error));
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
console.warn('Heartbeat update failed.', _safeErr(error));
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
console.warn('Firebase operation failed.', _safeErr(error));
}
}
window.logDeviceActivity = logDeviceActivity;
async function initializeDeviceListeners() {
try {
setTimeout(() => {
listenForDeviceCommands().catch(e => console.warn('Device command listener failed.', _safeErr(e)));
}, 2000);
listenForTeamChanges();
} catch (error) {
console.error('Device command listener failed.', _safeErr(error));
showToast('Device command listener failed.', 'error');
}
await cleanupOldDeletions();
}
window.initializeDeviceListeners = initializeDeviceListeners;
window.currentUser = null;
window.firebaseDB = null;
window.database = null;
window.auth = null;
window.isSyncing = false;
window.appMode = 'admin';
window.currentRepProfile = 'admin';
window.salesRepsList = ['NORAN SHAH', 'NOMAN SHAH'];
window.userRolesList = [];
const _VALID_APP_MODES = new Set(['admin','rep','production','factory','userrole']);

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
// Tracks the UID for whom the current in-memory device ID was generated.
// If a different user logs in within the same page session the stored ID is
// stale and must not be reused.
let _deviceIdOwnerUid = null;

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
  // Always reset first — guarantees we derive from whatever device ID is
  // current in storage, never from a stale in-memory value left over from a
  // previous session or a pre-login state.
  _cachedDeviceShard = null;
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
  return _cachedDeviceShard;
}
async function initDeviceShard() { return initUUIDSalts(); }
window.initDeviceShard = initDeviceShard;

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
  // Prefixed format also accepts an optional _<timestamp> suffix appended to
  // composite device IDs (e.g. dev-<uuid>_1711234567890).
  const prefixedRegex = /^[a-z0-9][a-z0-9_-]*-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(_\d+)?$/i;
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
const allData = await sqliteStore.get(dataType) || [];
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
await sqliteStore.set(dataType, cleaned);
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
await sqliteStore.set(dataType, validatedRecords);
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
const records = await sqliteStore.get(dataType) || [];
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
