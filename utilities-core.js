async function toggleDarkMode() {
const html = document.documentElement;
const themeToggle = document.getElementById('themeToggle');
const currentTheme = html.getAttribute('data-theme') || 'dark';
const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
html.setAttribute('data-theme', newTheme);
if (newTheme === 'dark') {
if (themeToggle) { themeToggle.innerHTML = ''; themeToggle.title = "Switch to Light Mode"; }
await sqliteStore.set('theme', 'dark');
} else {
if (themeToggle) { themeToggle.innerHTML = ''; themeToggle.title = "Switch to Dark Mode"; }
await sqliteStore.set('theme', 'light');
}
const metaThemeColor = document.querySelector('meta[name="theme-color"]');
if (metaThemeColor) {
metaThemeColor.setAttribute('content', newTheme === 'light' ? '#ffffff' : '#000000');
}
if (mfgBarChart) mfgBarChart.update();
if (mfgPieChart) mfgPieChart.update();
if (custSalesChart) custSalesChart.update();
if (custPaymentChart) custPaymentChart.update();
if (storeComparisonChart) storeComparisonChart.update();
if (salesPerfChart) salesPerfChart.update();
if (salesCompChart) salesCompChart.update();
if (indPerformanceChart) indPerformanceChart.update();
showToast(newTheme === 'dark' ? ' Dark mode enabled' : 'Light mode enabled', 'info', 2000);
}
const syncState = {
lastUpdate: {
production: 0,
sales: 0,
calculator: 0,
factory: 0,
payments: 0,
entities: 0
},
isRefreshing: false,
pendingUpdates: new Set()
};
const OfflineQueue = {
queue: [],
deadLetterQueue: [],
isProcessing: false,
maxRetries: APP_CONFIG.OFFLINE_MAX_RETRIES,
retryDelay: APP_CONFIG.OFFLINE_RETRY_DELAY_MS,
_dlKey: 'offline_dead_letter_queue',
async init() {
try {
const savedQueue = await sqliteStore.get('offline_operation_queue', []);
this.queue = Array.isArray(savedQueue) ? savedQueue : [];
const savedDL = await sqliteStore.get(this._dlKey, []);
this.deadLetterQueue = Array.isArray(savedDL) ? savedDL : [];
if (this.deadLetterQueue.length > 0) {
this._renderDeadLetterPanel();
}
if (this.queue.length > 0 && navigator.onLine) {
this.processQueue();
}
} catch (error) {
this.queue = [];
this.deadLetterQueue = [];
}
},
async add(operation) {
if (operation.docId && operation.collection && operation.action) {
const existingIdx = this.queue.findIndex(item =>
item.operation.action === operation.action &&
item.operation.collection === operation.collection &&
item.operation.docId === operation.docId
);
if (existingIdx !== -1) {
this.queue[existingIdx].operation = operation;
this.queue[existingIdx].timestamp = Date.now();
this.queue[existingIdx].retries = 0;
this.queue[existingIdx].error = null;
await this.saveQueue();
return;
}
}
const queueItem = {
id: generateUUID('offline'),
operation: operation,
timestamp: Date.now(),
retries: 0,
lastAttempt: null,
error: null
};
this.queue.push(queueItem);
await this.saveQueue();
if (navigator.onLine) {
this.processQueue();
} else if ('serviceWorker' in navigator && 'SyncManager' in window) {
navigator.serviceWorker.ready.then((reg) => {
reg.sync.register('offline-queue-sync').catch(() => {});
}).catch(() => {});
}
},
async saveQueue() {
try {
await sqliteStore.init();
await sqliteStore.set('offline_operation_queue', this.queue);
} catch (error) {
console.warn('[OfflineQueue] saveQueue failed:', _safeErr(error));
}
},
async saveDeadLetterQueue() {
try {
await sqliteStore.set(this._dlKey, this.deadLetterQueue);
} catch (error) {
console.error('Failed to persist dead-letter queue.', _safeErr(error));
}
},
async processQueue() {
if (this.isProcessing || this.queue.length === 0 || !navigator.onLine) {
return;
}
this.isProcessing = true;
const itemsToProcess = [...this.queue];
const successfulIds = [];
for (const item of itemsToProcess) {
if (item.retries >= this.maxRetries) {
const dlEntry = {
...item,
failedAt: Date.now(),
finalError: item.error || `Exhausted ${this.maxRetries} retries`
};
this.deadLetterQueue.push(dlEntry);
await this.saveDeadLetterQueue();
successfulIds.push(item.id);
this._renderDeadLetterPanel();
this._scheduleDlqAutoRetry();
showToast(
` Upload failed permanently — tap "Failed ops" to review`,
'error',
6000
);
continue;
}
try {
await this.executeOperation(item.operation);
successfulIds.push(item.id);
} catch (error) {
console.warn('[OfflineQueue] operation failed, will retry:', _safeErr(error));
item.retries++;
item.lastAttempt = Date.now();
item.error = error.message;
const backoff = Math.min(this.retryDelay * Math.pow(2, item.retries - 1), APP_CONFIG.OFFLINE_MAX_BACKOFF_MS);
await new Promise(resolve => setTimeout(resolve, backoff));
}
}
this.queue = this.queue.filter(item => !successfulIds.includes(item.id));
await this.saveQueue();
this.isProcessing = false;
if (this.queue.length > 0 && navigator.onLine) {
if (this._retryTimer) clearTimeout(this._retryTimer);
this._retryTimer = setTimeout(() => { this._retryTimer = null; this.processQueue(); }, 15000);
}
},
async retryDeadLetter(id) {
const idx = this.deadLetterQueue.findIndex(e => e.id === id);
if (idx === -1) return;
const entry = this.deadLetterQueue.splice(idx, 1)[0];
await this.saveDeadLetterQueue();
const fresh = { ...entry, retries: 0, error: null, lastAttempt: null };
delete fresh.failedAt;
delete fresh.finalError;
this.queue.push(fresh);
await this.saveQueue();
this._renderDeadLetterPanel();
if (navigator.onLine) this.processQueue();
showToast('Operation re-queued for upload', 'info', 3000);
},
async dismissDeadLetter(id) {
this.deadLetterQueue = this.deadLetterQueue.filter(e => e.id !== id);
await this.saveDeadLetterQueue();
this._renderDeadLetterPanel();
showToast('Failed operation dismissed', 'info', 2500);
},
async dismissAllDeadLetters() {
this.deadLetterQueue = [];
await this.saveDeadLetterQueue();
this._renderDeadLetterPanel();
showToast('All failed operations cleared', 'info', 2500);
},
dlqAutoRetryDelay: 30 * 60 * 1000,
_dlqAutoRetryTimer: null,
_scheduleDlqAutoRetry() {
  if (this._dlqAutoRetryTimer) return;
  if (this.deadLetterQueue.length === 0) return;
  this._dlqAutoRetryTimer = setTimeout(async () => {
    try {
      this._dlqAutoRetryTimer = null;
      if (this.deadLetterQueue.length === 0) return;
      showToast('\uD83D\uDD04 Auto-retrying ' + this.deadLetterQueue.length + ' failed operation(s)\u2026', 'info', 4000);
      const items = [...this.deadLetterQueue];
      this.deadLetterQueue = [];
      await this.saveDeadLetterQueue();
      for (const entry of items) {
        const fresh = { ...entry, retries: 0, error: null, lastAttempt: null };
        delete fresh.failedAt; delete fresh.finalError;
        this.queue.push(fresh);
      }
      await this.saveQueue();
      this._renderDeadLetterPanel();
      if (navigator.onLine) await this.processQueue();
      if (this.deadLetterQueue.length > 0) {
        showToast('\u26A0\uFE0F Auto-retry complete \u2014 ' + this.deadLetterQueue.length + ' operation(s) still failing. Use \"Failed ops\" to retry manually or export for safekeeping.', 'error', 8000);
      }
    } catch (e) { console.warn('[DLQ] Auto-retry error:', _safeErr(e)); }
  }, this.dlqAutoRetryDelay);
},
exportDeadLetterQueue() {
  if (this.deadLetterQueue.length === 0) { showToast('No failed operations to export', 'info', 2500); return; }
  const blob = new Blob([JSON.stringify(this.deadLetterQueue, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'failed_ops_' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  showToast('Failed operations exported', 'success', 2500);
},
cancelRetry() {
if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
if (this._dlqAutoRetryTimer) { clearTimeout(this._dlqAutoRetryTimer); this._dlqAutoRetryTimer = null; }
},
_renderDeadLetterPanel() {
const count = this.deadLetterQueue.length;
let dlBadge = document.getElementById('dl-queue-badge');
if (count === 0) {
if (dlBadge) dlBadge.remove();
const panel = document.getElementById('dl-queue-panel');
if (panel) panel.remove();
return;
}
if (!dlBadge) {
const offlineBanner = document.getElementById('offline-banner');
if (offlineBanner) {
dlBadge = document.createElement('button');
dlBadge.id = 'dl-queue-badge';
dlBadge.title = 'Show permanently-failed upload operations';
dlBadge.onclick = () => this._showDeadLetterModal();
offlineBanner.appendChild(dlBadge);
}
}
if (dlBadge) {
dlBadge.textContent = ` ${count} failed op${count !== 1 ? 's' : ''}`;
}
if (document.getElementById('dl-queue-modal')) {
this._showDeadLetterModal();
}
},
_showDeadLetterModal() {
const existing = document.getElementById('dl-queue-modal');
if (existing) existing.remove();
if (this.deadLetterQueue.length === 0) return;
const modal = document.createElement('div');
modal.id = 'dl-queue-modal';
modal.setAttribute('role', 'dialog');
modal.setAttribute('aria-modal', 'true');
modal.setAttribute('aria-label', 'Failed operations');
const rows = this.deadLetterQueue.map(entry => {
const ts = entry.failedAt ? new Date(entry.failedAt).toLocaleString() : '—';
const op = entry.operation || {};
const label = [op.action, op.collection, op.docId ? op.docId.slice(0, 8) + '…' : ''].filter(Boolean).join(' · ');
const errText = esc(entry.finalError || '');
return `<div class="dl-queue-row" data-id="${esc(entry.id)}">
<div class="dl-queue-row-info">
<span class="dl-queue-label">${esc(label)}</span>
<span class="dl-queue-time">${ts}</span>
${errText ? `<span class="dl-queue-error">${errText}</span>` : ''}
</div>
<div class="dl-queue-actions">
<button class="dl-btn dl-btn-retry" onclick="OfflineQueue.retryDeadLetter('${esc(entry.id)}')">Retry</button>
<button class="dl-btn dl-btn-dismiss" onclick="OfflineQueue.dismissDeadLetter('${esc(entry.id)}')">Dismiss</button>
</div>
</div>`;
}).join('');
modal.innerHTML = `
<div class="dl-queue-card">
<div class="dl-queue-header">
<h3 class="dl-queue-title"> Failed Uploads</h3>
</div>
<p class="dl-queue-subtitle">These operations exhausted all ${this.maxRetries} retry attempts. Retry to re-attempt upload, or dismiss to discard.</p>
<div class="dl-queue-list">${rows}</div>
<div class="dl-queue-footer">
<button class="dl-btn dl-btn-export" onclick="OfflineQueue.exportDeadLetterQueue()" title="Save failed operations as JSON">Export JSON</button>
<button class="dl-btn dl-btn-dismiss-all" onclick="OfflineQueue.dismissAllDeadLetters()">Dismiss all</button>
</div>
</div>`;
modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
document.body.appendChild(modal);
},
async executeOperation(operation) {
if (!firebaseDB || !currentUser) {
throw new Error('Database or user not available');
}
const { collection, docId, data, action } = operation;
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
switch (action) {
case 'set': {
const setData = (data && typeof data === 'object') ? { ...data } : data;
if (setData && !setData.isMerged) {
setData.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
}

if (collection === 'inventory') {
  await userRef.collection(collection).doc(docId).set(setData);
} else {
  await userRef.collection(collection).doc(docId).set(setData, { merge: true });
}
trackFirestoreWrite(1);

if (typeof DeltaSync !== 'undefined') {
  DeltaSync.markUploaded(collection, docId);
  await DeltaSync.setLastSyncTimestamp(collection);
}
break;
}
case 'update':
await userRef.collection(collection).doc(docId).update(data);
trackFirestoreWrite(1);
break;
case 'delete':
const deleteBatch = firebaseDB.batch();
deleteBatch.delete(userRef.collection(collection).doc(docId));
const tombstoneRef = userRef.collection('deletions').doc(docId);
deleteBatch.set(tombstoneRef, {
id: docId,
recordId: docId,
collection: collection,
recordType: operation.recordType || collection,
deletedAt: firebase.firestore.Timestamp.now(),
expiresAt: firebase.firestore.Timestamp.fromMillis(Date.now() + (90 * 24 * 60 * 60 * 1000))
}, { merge: true });
await deleteBatch.commit();
trackFirestoreWrite(2);
break;
case 'set-doc':
await userRef.collection(collection).doc(docId).set(data, { merge: true });
trackFirestoreWrite(1);
break;
default:
throw new Error(`Unknown operation action: ${action}`);
}
},
getQueueStatus() {
return {
pendingCount: this.queue.length,
deadLetterCount: this.deadLetterQueue.length,
isProcessing: this.isProcessing,
items: this.queue.map(item => ({
id: item.id,
action: item.operation.action,
collection: item.operation.collection,
docId: item.operation.docId,
retries: item.retries,
timestamp: item.timestamp,
error: item.error
})),
deadLetterItems: this.deadLetterQueue.map(item => ({
id: item.id,
action: item.operation.action,
collection: item.operation.collection,
docId: item.operation.docId,
failedAt: item.failedAt,
finalError: item.finalError
}))
};
}
};
if (typeof window._firestoreNetworkDisabled === 'undefined') window._firestoreNetworkDisabled = false;
function updateOfflineBanner() {
const banner = document.getElementById('offline-banner');
const badge = document.getElementById('offline-queue-badge');
const dot = document.getElementById('connection-indicator');
const isOnline = navigator.onLine;
const pending = (typeof OfflineQueue !== 'undefined') ? OfflineQueue.queue.length : 0;
const failed = (typeof OfflineQueue !== 'undefined') ? OfflineQueue.deadLetterQueue.length : 0;
if (banner) {
if (!isOnline) {
banner.classList.add('visible');
document.body.classList.add('offline-active');
if (badge) {
if (pending > 0) {
badge.textContent = `${pending} pending`;
badge.style.display = '';
} else {
badge.textContent = 'saves queued locally';
badge.style.display = '';
}
}
} else if (pending > 0 || failed > 0) {
banner.classList.add('visible');
document.body.classList.add('offline-active');
if (badge) {
badge.textContent = pending > 0 ? `Syncing ${pending} queued op(s)...` : '';
badge.style.display = pending > 0 ? '' : 'none';
}
} else {
banner.classList.remove('visible');
document.body.classList.remove('offline-active');
}
}
if (dot) {
if (!isOnline) {
dot.className = 'signal-offline';
dot.title = pending > 0
? `Offline — ${pending} operation(s) will sync when back online`
: 'Offline — changes saved locally';
} else if (failed > 0) {
dot.className = 'signal-connecting';
dot.title = `${failed} upload(s) permanently failed — click "Failed ops" to review`;
} else if (pending > 0) {
dot.className = 'signal-connecting';
dot.title = `Syncing ${pending} queued operation(s)...`;
} else if (window.isSyncing) {
dot.className = 'signal-connecting';
dot.title = 'Syncing with cloud...';
} else {
dot.className = 'signal-online';
dot.title = 'Online — connected to Firestore';
}
}
if (typeof OfflineQueue !== 'undefined') {
OfflineQueue._renderDeadLetterPanel();
}
}
(function patchOfflineQueueAdd() {
const _origAdd = OfflineQueue.add.bind(OfflineQueue);
OfflineQueue.add = async function(operation) {
const result = await _origAdd(operation);
updateOfflineBanner();
return result;
};
const _origProcess = OfflineQueue.processQueue.bind(OfflineQueue);
OfflineQueue.processQueue = async function() {
const result = await _origProcess();
updateOfflineBanner();
if (this.queue.length === 0 && navigator.onLine) {
if (typeof showToast === 'function') {
showToast(' Offline changes synced', 'success', 3000);
}
}
return result;
};
})();
if ('serviceWorker' in navigator) {
navigator.serviceWorker.addEventListener('message', (event) => {
if (event.data && event.data.type === 'PROCESS_QUEUE') {
if (typeof OfflineQueue !== 'undefined' && OfflineQueue.queue.length > 0 && navigator.onLine) {
OfflineQueue.processQueue().catch(() => {});
}
}
});
}
window.addEventListener('online', async () => {
updateOfflineBanner();
if (typeof firebaseDB !== 'undefined' && firebaseDB) {
let retries = 0;
const tryEnable = async () => {
try {
await firebaseDB.enableNetwork();
window._firestoreNetworkDisabled = false;
} catch (e) {
retries++;
if (retries < 3) {
setTimeout(tryEnable, retries * 1000);
} else {
console.warn('Failed to enable Firestore network after retries:', _safeErr(e));
}
}
};
tryEnable();
}
if (typeof OfflineQueue !== 'undefined' && OfflineQueue.queue.length > 0) {
await OfflineQueue.processQueue();
}
setTimeout(() => {
if (typeof subscribeToRealtime === 'function' && typeof currentUser !== 'undefined' && currentUser) {
subscribeToRealtime().catch(e => console.warn('subscribeToRealtime failed:', _safeErr(e)));
}
}, 500);
setTimeout(() => {
if (typeof triggerAutoSync === 'function') triggerAutoSync();
if (typeof updateOfflineBanner === 'function') updateOfflineBanner();
}, 2000);
showToast(' Back online — syncing…', 'success', 3000);
});
window.addEventListener('offline', async () => {
updateOfflineBanner();
if (typeof firebaseDB !== 'undefined' && firebaseDB) {
try {
await firebaseDB.disableNetwork();
window._firestoreNetworkDisabled = true;
} catch (e) {
console.warn('Failed to disable network.', _safeErr(e));
}
}
if (typeof isSyncing !== 'undefined' && isSyncing) {
isSyncing = false;
}
showToast('Offline — changes will be saved locally', 'warning', 4000);
});

(function initConnectionMonitor() {
  const SLOW_RTT_MS      = 500;
  const SLOW_DOWNLINK    = 0.5;
  const CHECK_INTERVAL   = 20000;
  const TOAST_COOLDOWN   = 60000;
  let _lastSlowToast     = 0;
  let _slowBannerVisible = false;
  let _monitorTimer      = null;

  function getSlowBanner() {
    let b = document.getElementById('slow-connection-banner');
    if (!b) {
      b = document.createElement('div');
      b.id = 'slow-connection-banner';
      b.style.cssText = [
        'position:fixed', 'bottom:0', 'left:0', 'right:0', 'z-index:9998',
        'background:linear-gradient(90deg,#92400e,#b45309)',
        'color:#fef3c7', 'font-size:0.78rem', 'font-weight:600',
        'padding:6px 16px', 'display:flex', 'align-items:center',
        'gap:8px', 'transition:transform 0.3s ease',
        'transform:translateY(100%)', 'box-shadow:0 -2px 8px rgba(0,0,0,0.4)'
      ].join(';');
      b.innerHTML = '<span>⚠️</span><span id="slow-banner-msg">Weak signal — app running offline, data saves locally</span>' +
        '<button onclick="document.getElementById(\'slow-connection-banner\').style.transform=\'translateY(100%)\'" ' +
        'style="margin-left:auto;background:none;border:none;color:#fef3c7;cursor:pointer;font-size:1rem;padding:0 4px">✕</button>';
      document.body.appendChild(b);
    }
    return b;
  }

  function showSlowBanner(msg) {
    if (_slowBannerVisible) return;
    _slowBannerVisible = true;
    const b = getSlowBanner();
    const m = document.getElementById('slow-banner-msg');
    if (m) m.textContent = msg || 'Weak signal — app running offline, data saves locally';

    const offlineBanner = document.getElementById('offline-banner');
    const bottomOff = offlineBanner && offlineBanner.classList.contains('visible') ? '48px' : '0';
    b.style.bottom = bottomOff;
    requestAnimationFrame(() => { b.style.transform = 'translateY(0)'; });
  }

  function hideSlowBanner() {
    if (!_slowBannerVisible) return;
    _slowBannerVisible = false;
    const b = document.getElementById('slow-connection-banner');
    if (b) b.style.transform = 'translateY(100%)';
  }

  function isConnectionSlow() {
    if (!navigator.onLine) return false;
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) return false;
    const type = conn.effectiveType || '';
    if (type === 'slow-2g' || type === '2g') return true;
    if (conn.rtt && conn.rtt > SLOW_RTT_MS) return true;
    if (conn.downlink && conn.downlink < SLOW_DOWNLINK) return true;
    return false;
  }

  function checkConnection() {
    if (!navigator.onLine) { hideSlowBanner(); return; }
    const slow = isConnectionSlow();
    if (slow) {
      const conn = navigator.connection || {};
      const detail = conn.effectiveType
        ? `${conn.effectiveType.toUpperCase()} signal`
        : conn.rtt ? `${conn.rtt}ms latency` : 'Weak signal';
      showSlowBanner(`${detail} — app works offline, changes queued for sync`);
      if (Date.now() - _lastSlowToast > TOAST_COOLDOWN) {
        _lastSlowToast = Date.now();
        if (typeof showToast === 'function') {
          showToast('⚠️ Weak connection — all changes saved locally', 'warning', 5000);
        }
      }
    } else {
      hideSlowBanner();
    }
  }

  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn) {
    conn.addEventListener('change', checkConnection);
  }

  function startMonitor() {
    if (_monitorTimer) clearInterval(_monitorTimer);
    checkConnection();
    _monitorTimer = setInterval(checkConnection, CHECK_INTERVAL);
  }
  function stopMonitor() {
    if (_monitorTimer) { clearInterval(_monitorTimer); _monitorTimer = null; }
    hideSlowBanner();
  }

  window.addEventListener('online',  () => { startMonitor(); });
  window.addEventListener('offline', () => { stopMonitor(); });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startMonitor);
  } else {
    setTimeout(startMonitor, 1500);
  }
})();


setInterval(async () => {
if (!navigator.onLine) return;
if (typeof firebaseDB === 'undefined' || !firebaseDB) return;
if (!window._firestoreNetworkDisabled) return;
try {
await firebaseDB.enableNetwork();
window._firestoreNetworkDisabled = false;
if (typeof updateOfflineBanner === 'function') updateOfflineBanner();
if (typeof triggerAutoSync === 'function') triggerAutoSync();
} catch(e) {  }
}, APP_CONFIG.OFFLINE_MAX_BACKOFF_MS);
function notifyDataChange(dataType) {
syncState.lastUpdate[dataType] = Date.now();
syncState.pendingUpdates.add(dataType);
if (!syncState.isRefreshing) {
requestAnimationFrame(() => processSync());
}
if (typeof triggerSeamlessBackup === 'function') {
triggerSeamlessBackup();
}
}
let autoSyncTimeout = null;
const AUTO_SYNC_DELAY = 5000;
async function invalidateAllCaches() {
const expenseCategories = ensureArray(await sqliteStore.get('expense_categories'));
try {
const freshSettings = await sqliteStore.get('naswar_default_settings');
if (freshSettings && typeof freshSettings === 'object') defaultSettings = freshSettings;
const freshCats = await sqliteStore.get('expense_categories');

if (typeof DeltaSync !== 'undefined' && typeof DeltaSync.loadAllPendingIds === 'function') {
DeltaSync.loadAllPendingIds().catch(() => {});
}
} catch(e) {
console.error('Failed to invalidate caches.', _safeErr(e));
}
}

async function triggerAutoSync() {
if (typeof currentUser === 'undefined' || !currentUser) {
return;
}
if (typeof pushDataToCloud !== 'function') {
return;
}
if (typeof isSyncing !== 'undefined' && isSyncing) {
return;
}
if (autoSyncTimeout) {
clearTimeout(autoSyncTimeout);
}
autoSyncTimeout = setTimeout(async () => {
if (typeof isSyncing !== 'undefined' && isSyncing) return;
try {
await pushDataToCloud(true);
} catch (error) {
if (navigator.onLine) {
const _errMsg = (error && (error.message || error.code || error.name))
? (error.message || error.code || error.name)
: (typeof error === 'string' ? error : 'please try again or check your data');
console.error('Sync failed. Check your connection.', _safeErr(error));
showToast('Sync failed: ' + _errMsg, 'error');
}
}
}, AUTO_SYNC_DELAY);
}

async function updateSettingTimestamp(settingName) {
const timestamp = getTimestamp();
await sqliteStore.set(`${settingName}_timestamp`, timestamp);
}
const _tabSyncInProgress = {};
function processSync() {
if (syncState.isRefreshing || syncState.pendingUpdates.size === 0) return;
syncState.isRefreshing = true;
const updates = Array.from(syncState.pendingUpdates);
syncState.pendingUpdates.clear();
try {
updates.forEach(dataType => {
switch(dataType) {
case 'production':
if (typeof syncProductionTab === 'function' && !_tabSyncInProgress['production']) {
_tabSyncInProgress['production'] = true;
syncProductionTab().finally(() => { _tabSyncInProgress['production'] = false; });
}
if (typeof syncSalesTab === 'function' && !_tabSyncInProgress['sales']) {
_tabSyncInProgress['sales'] = true;
syncSalesTab().finally(() => { _tabSyncInProgress['sales'] = false; });
}
break;
case 'sales':
if (typeof syncSalesTab === 'function' && !_tabSyncInProgress['sales']) {
_tabSyncInProgress['sales'] = true;
syncSalesTab().finally(() => { _tabSyncInProgress['sales'] = false; });
}
if (typeof syncProductionTab === 'function' && !_tabSyncInProgress['production']) {
_tabSyncInProgress['production'] = true;
syncProductionTab().finally(() => { _tabSyncInProgress['production'] = false; });
}
if (typeof syncCalculatorTab === 'function' && !_tabSyncInProgress['calculator']) {
_tabSyncInProgress['calculator'] = true;
syncCalculatorTab().finally(() => { _tabSyncInProgress['calculator'] = false; });
}
break;
case 'calculator':
if (typeof syncCalculatorTab === 'function' && !_tabSyncInProgress['calculator']) {
_tabSyncInProgress['calculator'] = true;
syncCalculatorTab().finally(() => { _tabSyncInProgress['calculator'] = false; });
}
break;
case 'factory':
if (typeof syncFactoryTab === 'function' && !_tabSyncInProgress['factory']) {
_tabSyncInProgress['factory'] = true;
syncFactoryTab().finally(() => { _tabSyncInProgress['factory'] = false; });
}
break;
case 'payments':
case 'entities':
if (typeof syncPaymentsTab === 'function' && !_tabSyncInProgress['payments']) {
_tabSyncInProgress['payments'] = true;
syncPaymentsTab().finally(() => { _tabSyncInProgress['payments'] = false; });
}
break;
case 'rep':
case 'rep_sales':
case 'rep_customers':
if (typeof syncRepTab === 'function' && !_tabSyncInProgress['rep']) {
_tabSyncInProgress['rep'] = true;
syncRepTab().finally(() => { _tabSyncInProgress['rep'] = false; });
}
break;
case 'expenses':
case 'transactions':
if (typeof syncPaymentsTab === 'function' && !_tabSyncInProgress['payments']) {
_tabSyncInProgress['payments'] = true;
syncPaymentsTab().finally(() => { _tabSyncInProgress['payments'] = false; });
}
break;
case 'returns':
case 'production_record':
if (typeof syncProductionTab === 'function' && !_tabSyncInProgress['production']) {
_tabSyncInProgress['production'] = true;
syncProductionTab().finally(() => { _tabSyncInProgress['production'] = false; });
}
break;
case 'inventory':
case 'factory_history':
if (typeof syncFactoryTab === 'function' && !_tabSyncInProgress['factory']) {
_tabSyncInProgress['factory'] = true;
syncFactoryTab().finally(() => { _tabSyncInProgress['factory'] = false; });
}
break;
case 'calculator_history':
case 'noman_history':
if (typeof syncCalculatorTab === 'function' && !_tabSyncInProgress['calculator']) {
_tabSyncInProgress['calculator'] = true;
syncCalculatorTab().finally(() => { _tabSyncInProgress['calculator'] = false; });
}
break;
case 'all':
[
['production', syncProductionTab],
['sales', syncSalesTab],
['calculator', syncCalculatorTab],
['factory', syncFactoryTab],
['payments', syncPaymentsTab],
['rep', syncRepTab]
].forEach(([t, fn]) => {
if (typeof fn === 'function' && !_tabSyncInProgress[t]) {
_tabSyncInProgress[t] = true;
fn().finally(() => { _tabSyncInProgress[t] = false; });
}
});
break;
}
});
syncCoreDisplays();
} catch (error) {
console.error('Tab sync failed.', _safeErr(error));
showToast('Tab sync failed: ' + (_safeErr(error).message || 'please reload the app'), 'error');
} finally {
syncState.isRefreshing = false;
if (syncState.pendingUpdates.size > 0) {
requestAnimationFrame(() => processSync());
}
}
}

function getCurrentActiveTab() {
return currentActiveTab || 'prod';
}

function syncCoreDisplays() {
try {
if (typeof updateUnitsAvailableIndicator === 'function') {
updateUnitsAvailableIndicator();
}
if (typeof calculateNetCash === 'function') {
calculateNetCash();
}
if (typeof calculateCashTracker === 'function') {
calculateCashTracker();
}
} catch (error) {
console.error('Calculation failed.', _safeErr(error));
showToast('Dashboard calculation failed: ' + (_safeErr(error).message || 'please reload the app'), 'error');
}
}
async function syncCalculatorTab() {
try {
if (typeof loadSalesData === 'function') await loadSalesData(currentCompMode);
if (typeof autoFillTotalSoldQuantity === 'function') autoFillTotalSoldQuantity();
} catch (error) {
console.error('Failed to load sales data.', _safeErr(error));
showToast('Failed to load sales data: ' + (_safeErr(error).message || 'please try again'), 'error');
if (typeof loadSalesData === 'function') setTimeout(() => loadSalesData(currentCompMode), 500);
}
}

async function syncFactoryTab() {
try {
if (typeof syncFactoryProductionStats === 'function') await syncFactoryProductionStats();
if (typeof updateFactoryUnitsAvailableStats === 'function') updateFactoryUnitsAvailableStats();
if (typeof updateFactorySummaryCard === 'function') updateFactorySummaryCard();
if (typeof renderFactoryInventory === 'function') renderFactoryInventory();
if (typeof renderFactoryHistory === 'function') renderFactoryHistory();
} catch (error) {
console.error('Failed to render data.', _safeErr(error));
showToast('Factory tab failed to render: ' + (_safeErr(error).message || 'please reload the app'), 'error');
if (typeof updateFactoryUnitsAvailableStats === 'function') setTimeout(updateFactoryUnitsAvailableStats, 500);
}
}

async function syncPaymentsTab() {
try {
if (typeof refreshPaymentTab === 'function') await refreshPaymentTab();
if (typeof renderEntityTable === 'function') await renderEntityTable();
} catch (error) {
console.error('Payment tab refresh failed.', _safeErr(error));
showToast('Payments tab failed to load: ' + (_safeErr(error).message || 'please reload the app'), 'error');
if (typeof refreshPaymentTab === 'function') setTimeout(refreshPaymentTab, 500);
}
}

async function syncProductionTab() {
try {
if (typeof refreshUI === 'function') refreshUI();
if (typeof updateMfgCharts === 'function') updateMfgCharts();
if (typeof calculateCustomerSale === 'function') calculateCustomerSale();
} catch (error) {
console.error('UI refresh failed.', _safeErr(error));
showToast('Production tab failed to refresh: ' + (_safeErr(error).message || 'please reload the app'), 'error');
if (typeof refreshUI === 'function') setTimeout(refreshUI, 500);
}
}

async function syncSalesTab() {
try {
if (typeof calculateCustomerSale === 'function') calculateCustomerSale();
if (typeof refreshCustomerSales === 'function') refreshCustomerSales();
} catch (error) {
console.error('Customer data operation failed.', _safeErr(error));
showToast('Sales tab failed to refresh: ' + (_safeErr(error).message || 'please reload the app'), 'error');
if (typeof refreshCustomerSales === 'function') setTimeout(refreshCustomerSales, 500);
}
}

async function syncRepTab() {
try {
if (typeof renderRepCustomerTable === 'function') await renderRepCustomerTable();
if (typeof calculateRepAnalytics === 'function') calculateRepAnalytics();
} catch (error) {
console.error('Rep tab refresh failed.', _safeErr(error));
showToast('Rep tab failed to refresh: ' + (_safeErr(error).message || 'please reload the app'), 'error');
if (typeof renderRepCustomerTable === 'function') setTimeout(renderRepCustomerTable, 500);
}
}

function stopPeriodicSync() {
}
const RefreshDebouncer = {
timers: {
production: null,
sales: null,
calculator: null,
factory: null,
payments: null,
rep: null
},
delays: {
production: 300,
sales: 300,
calculator: 200,
factory: 300,
payments: 300,
rep: 300
},
debounce(tab, callback) {
if (this.timers[tab]) {
clearTimeout(this.timers[tab]);
}
this.timers[tab] = setTimeout(() => {
callback();
this.timers[tab] = null;
}, this.delays[tab]);
},
immediate(tab, callback) {
if (this.timers[tab]) {
clearTimeout(this.timers[tab]);
this.timers[tab] = null;
}
callback();
}
};
window.debouncedRefreshUI = function() {
RefreshDebouncer.debounce('production', () => {
if (typeof refreshUI === 'function') refreshUI();
});
};
window.debouncedRefreshCustomerSales = function() {
RefreshDebouncer.debounce('sales', () => {
if (typeof refreshCustomerSales === 'function') refreshCustomerSales();
});
};
window.debouncedRefreshFactoryTab = function() {
RefreshDebouncer.debounce('factory', () => {
if (typeof refreshFactoryTab === 'function') refreshFactoryTab();
});
};
window.debouncedRefreshPaymentTab = function() {
RefreshDebouncer.debounce('payments', () => {
if (typeof refreshPaymentTab === 'function') refreshPaymentTab();
});
};
window.debouncedRefreshRepUI = function() {
RefreshDebouncer.debounce('rep', () => {
if (typeof refreshRepUI === 'function') refreshRepUI();
});
};
async function reloadDataFromStorage() {
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
const salesHistory = ensureArray(await sqliteStore.get('noman_history'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const factoryProductionHistory = ensureArray(await sqliteStore.get('factory_production_history'));
try {
await loadAllData();
} catch (error) {
console.error('Failed to load app data.', _safeErr(error));
showToast('Failed to load app data: ' + (_safeErr(error).message || 'please reload the app'), 'error');
}
}
window.forceSync = async function() {
await reloadDataFromStorage();
syncState.pendingUpdates.add('all');
processSync();
};
triggerAutoSync();
window._notifyOnTabChange = function(tab) {
setTimeout(() => {
if (typeof notifyDataChange === 'function') notifyDataChange(tab);
}, 150);
};
window.addEventListener('beforeunload', function() {
if (typeof stopPeriodicSync === 'function') stopPeriodicSync();
});
let defaultSettings = {
production: {
STORE_A: { cost: 0, sale: 0 },
STORE_B: { cost: 0, sale: 0 },
STORE_C: { cost: 0, sale: 0 }
},
get calculator() {
const calc = {};
salesRepsList.forEach(r => { calc[r.replace(/\s+/g, '_')] = { cost: 0, sale: 0 }; });
return calc;
},
sales: { cost: 0, sale: 0 }
};
let mfgBarChart = null, mfgPieChart = null, salesPerfChart = null, salesCompChart = null;
let custSalesChart = null, custPaymentChart = null;
let storeComparisonChart = null;
let indPerformanceChart = null;

const _UI_STATE_KEY = 'ui_state';
const _UI_DEFAULTS = {
  currentMfgMode: 'week',
  currentCompMode: 'all',
  currentCustomerChartMode: 'week',
  currentStore: 'STORE_A',
  currentStoreComparisonMetric: 'weight',
  currentIndMode: 'week',
  currentIndMetric: 'weight',
  currentOverviewMode: 'day',
  currentProductionView: 'store',
  currentFactoryEntryStore: 'STORE_A',
  currentFactorySettingsStore: 'standard',
  currentFactorySummaryMode: 'daily',
  currentCashTrackerMode: 'day',
  currentSalesSummaryMode: 'day',
  currentPerfOverviewMode: 'day',
  currentRepAnalyticsMode: 'day',
  currentActiveTab: 'prod',
  custTransactionMode: 'sale',
  repTransactionMode: 'sale',
  entityViewMode: 'detailed',
  currentEntityId: null,
  currentQuickType: 'OUT',
  currentExpenseOverlayName: null,
  editingFactoryInventoryId: null,
  editingEntityId: null,
  selectedEntityId: null,
  currentFactoryDate: new Date().toISOString().split('T')[0],
};
let _uiState = { ..._UI_DEFAULTS };

function getUI(key) {
  return _uiState[key] !== undefined ? _uiState[key] : _UI_DEFAULTS[key];
}

function setUI(key, val) {
  _uiState[key] = val;
  if (typeof sqliteStore !== 'undefined') {
    sqliteStore.set(_UI_STATE_KEY, _uiState).catch(() => {});
  }
}

async function loadUIState() {
  if (typeof sqliteStore === 'undefined') return;
  try {
    const saved = await sqliteStore.get(_UI_STATE_KEY, null);
    if (saved && typeof saved === 'object') {
      _uiState = { ..._UI_DEFAULTS, ...saved };
    }
  } catch (_) {}
}

Object.defineProperties(window, {
  currentMfgMode:               { get: () => getUI('currentMfgMode'),               set: v => setUI('currentMfgMode', v),               configurable: true },
  currentCompMode:              { get: () => getUI('currentCompMode'),              set: v => setUI('currentCompMode', v),              configurable: true },
  currentCustomerChartMode:     { get: () => getUI('currentCustomerChartMode'),     set: v => setUI('currentCustomerChartMode', v),     configurable: true },
  currentStore:                 { get: () => getUI('currentStore'),                 set: v => setUI('currentStore', v),                 configurable: true },
  currentStoreComparisonMetric: { get: () => getUI('currentStoreComparisonMetric'), set: v => setUI('currentStoreComparisonMetric', v), configurable: true },
  currentIndMode:               { get: () => getUI('currentIndMode'),               set: v => setUI('currentIndMode', v),               configurable: true },
  currentIndMetric:             { get: () => getUI('currentIndMetric'),             set: v => setUI('currentIndMetric', v),             configurable: true },
  currentOverviewMode:          { get: () => getUI('currentOverviewMode'),          set: v => setUI('currentOverviewMode', v),          configurable: true },
  currentProductionView:        { get: () => getUI('currentProductionView'),        set: v => setUI('currentProductionView', v),        configurable: true },
  currentFactoryEntryStore:     { get: () => getUI('currentFactoryEntryStore'),     set: v => setUI('currentFactoryEntryStore', v),     configurable: true },
  currentFactorySettingsStore:  { get: () => getUI('currentFactorySettingsStore'),  set: v => setUI('currentFactorySettingsStore', v),  configurable: true },
  currentFactorySummaryMode:    { get: () => getUI('currentFactorySummaryMode'),    set: v => setUI('currentFactorySummaryMode', v),    configurable: true },
  currentCashTrackerMode:       { get: () => getUI('currentCashTrackerMode'),       set: v => setUI('currentCashTrackerMode', v),       configurable: true },
  currentSalesSummaryMode:      { get: () => getUI('currentSalesSummaryMode'),      set: v => setUI('currentSalesSummaryMode', v),      configurable: true },
  currentPerfOverviewMode:      { get: () => getUI('currentPerfOverviewMode'),      set: v => setUI('currentPerfOverviewMode', v),      configurable: true },
  currentRepAnalyticsMode:      { get: () => getUI('currentRepAnalyticsMode'),      set: v => setUI('currentRepAnalyticsMode', v),      configurable: true },
  currentActiveTab:             { get: () => getUI('currentActiveTab'),             set: v => setUI('currentActiveTab', v),             configurable: true },
  custTransactionMode:          { get: () => getUI('custTransactionMode'),          set: v => setUI('custTransactionMode', v),          configurable: true },
  repTransactionMode:           { get: () => getUI('repTransactionMode'),           set: v => setUI('repTransactionMode', v),           configurable: true },
  entityViewMode:               { get: () => getUI('entityViewMode'),               set: v => setUI('entityViewMode', v),               configurable: true },
  currentEntityId:              { get: () => getUI('currentEntityId'),              set: v => setUI('currentEntityId', v),              configurable: true },
  currentQuickType:             { get: () => getUI('currentQuickType'),             set: v => setUI('currentQuickType', v),             configurable: true },
  currentExpenseOverlayName:    { get: () => getUI('currentExpenseOverlayName'),    set: v => setUI('currentExpenseOverlayName', v),    configurable: true },
  editingFactoryInventoryId:    { get: () => getUI('editingFactoryInventoryId'),    set: v => setUI('editingFactoryInventoryId', v),    configurable: true },
  editingEntityId:              { get: () => getUI('editingEntityId'),              set: v => setUI('editingEntityId', v),              configurable: true },
  selectedEntityId:             { get: () => getUI('selectedEntityId'),             set: v => setUI('selectedEntityId', v),             configurable: true },
  currentFactoryDate:           { get: () => getUI('currentFactoryDate'),           set: v => setUI('currentFactoryDate', v),           configurable: true },
});
const splashQuotes = [
{ quote: "The details are not the details. They make the design.", author: "Charles Eames" },
{ quote: "Perfection is achieved not when there is nothing more to add, but when there is nothing left to take away.", author: "Antoine de Saint-Exupéry" },
{ quote: "Price is what you pay. Value is what you get.", author: "Warren Buffett" },
{ quote: "It is not the strongest of the species that survives, nor the most intelligent — it is the one most adaptable to change.", author: "Charles Darwin" },
{ quote: "The secret of getting ahead is getting started. The secret of getting started is breaking your complex overwhelming tasks into small manageable ones.", author: "Mark Twain" },
{ quote: "An investment in knowledge pays the best interest.", author: "Benjamin Franklin" },
{ quote: "What gets measured gets managed.", author: "Peter Drucker" },
{ quote: "In the middle of every difficulty lies opportunity.", author: "Albert Einstein" },
{ quote: "The purpose of a business is to create a customer who creates customers.", author: "Shiv Singh" },
{ quote: "Simplicity is the ultimate sophistication.", author: "Leonardo da Vinci" },
{ quote: "Without data, you are just another person with an opinion.", author: "W. Edwards Deming" },
{ quote: "Success usually comes to those who are too busy to be looking for it.", author: "Henry David Thoreau" },
{ quote: "Opportunities don't happen. You create them.", author: "Chris Grosser" },
{ quote: "The best way to predict the future is to create it.", author: "Peter Drucker" },
{ quote: "Chase the vision, not the money. The money will end up following you.", author: "Tony Hsieh" },
{ quote: "A small business is an amazing way to serve and leave an impact on the world you live in.", author: "Nicole Snow" },
{ quote: "Build something 100 people love, not something 1 million people kind of like.", author: "Brian Chesky" },
{ quote: "The secret of change is to focus all of your energy not on fighting the old, but on building the new.", author: "Socrates" },
{ quote: "Excellence is never an accident. It is always the result of high intention, sincere effort, and intelligent execution.", author: "Aristotle" },
{ quote: "Your most unhappy customers are your greatest source of learning.", author: "Bill Gates" }
];
function initSplashScreen() {
const randomQuote = splashQuotes[Math.floor(Math.random() * splashQuotes.length)];
document.getElementById('splash-quote').textContent = `"${randomQuote.quote || ''}"`;
document.getElementById('splash-author').textContent = `— ${randomQuote.author || 'Unknown'}`;
setTimeout(() => {
}, 3800);
}

function updatePaymentStatusVisibility() {
}

async function recordEntry() {
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
const factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
if (appMode === 'userrole' && !(window._userRoleAllowedTabs || []).includes('prod')) {
showToast('Access Denied — Production not in your assigned tabs', 'warning', 3000); return;
}
const netElement = document.getElementById('net-wt');
const dateElement = document.getElementById('sys-date');
const storeElement = document.getElementById('storeSelector');
const formulaUnitsElement = document.getElementById('formula-units');
const grossWtEl = document.getElementById('gross-wt');
const contWtEl = document.getElementById('cont-wt');
if (!netElement || !dateElement || !storeElement || !formulaUnitsElement) {
showToast('Form error: Missing required fields', 'error');
return;
}
const net = parseFloat(netElement.value) || 0;
const grossWt = parseFloat(grossWtEl ? grossWtEl.value : 0) || 0;
const contWt = parseFloat(contWtEl ? contWtEl.value : 0) || 0;
const inputDate = dateElement.value;
const store = storeElement.value;
const formulaUnits = parseFloat(formulaUnitsElement.value) || 0;
const formulaStore = typeof getStoreFormulaType === 'function' ? await getStoreFormulaType(store) : (store === 'STORE_C' ? 'asaan' : 'standard');
const salePrice = await getSalePriceForStore(store);
const validation = await validateFormulaAvailability(store, formulaUnits);
if (!validation.sufficient) {
showToast(` Insufficient formula units! Available: ${validation.available}, Requested: ${formulaUnits}`, 'warning', 4000);
return;
}
const costData = await calculateDynamicCost(store, formulaUnits, net);
if (net <= 0) {
showToast('Net production must be greater than zero. Please check weights.', 'warning', 4000);
return;
}
if (!inputDate) {
showToast('Please select a date.', 'warning', 3000);
return;
}
if (salePrice <= 0) {
showToast('Please set a sale price in Factory Formulas first.', 'warning', 3000);
return;
}
if (formulaUnits <= 0) {
showToast('Please enter formula units used.', 'warning', 3000);
return;
}
const totalCost = net * costData.dynamicCostPerKg;
const totalSale = net * salePrice;
const profit = totalSale - totalCost;
let paymentStatus = 'CASH';
const now = new Date();
let hours = now.getHours();
const minutes = now.getMinutes();
const seconds = now.getSeconds();
const ampm = hours >= 12 ? 'PM' : 'AM';
hours = hours % 12;
hours = hours ? hours : 12;
const timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')} ${ampm}`;
let prodId = generateUUID('prod');
if (!validateUUID(prodId)) {
prodId = generateUUID('prod');
}
const prodCreatedAt = getTimestamp();
let newEntry = {
id: prodId,
createdAt: prodCreatedAt,
updatedAt: prodCreatedAt,
date: inputDate,
time: timeString,
store: store,
net,
cp: costData.dynamicCostPerKg,
sp: salePrice,
totalCost,
totalSale,
profit,
formulaUnits: formulaUnits,
formulaStore: costData.formulaStore,
formulaCost: costData.totalFormulaCost,
grossWt: grossWt || 0,
contWt: contWt || 0,
paymentStatus: paymentStatus,
timestamp: prodCreatedAt,
recordDate: new Date(inputDate).getTime(),
syncedAt: new Date().toISOString(),
managedBy: (appMode === 'production' && window._assignedManagerName) ? window._assignedManagerName : null,
createdBy: (appMode === 'userrole' && window._assignedManagerName) ? window._assignedManagerName : null
};
newEntry = ensureRecordIntegrity(newEntry, false);
try {
db.push(newEntry);
await unifiedSave('mfg_pro_pkr', db, newEntry);
notifyDataChange('production');
emitSyncUpdate({ mfg_pro_pkr: null});
} catch (error) {
db.pop();
showToast(" Failed to save production entry. Please try again.", "error");
return;
}
await syncFactoryProductionStats().catch(e => console.warn('[saveProductionEntry] stats failed:', _safeErr(e)));
const _clearGrossWt = document.getElementById('gross-wt');
const _clearContWt = document.getElementById('cont-wt');
const _clearNetWt = document.getElementById('net-wt');
const formulaUnitsEl = document.getElementById('formula-units');
const displayCostValue = document.getElementById('display-cost-value');
const profitPerKg = document.getElementById('profit-per-kg');
const formulaUnitCostDisplay = document.getElementById('formula-unit-cost-display');
const totalFormulaCostDisplay = document.getElementById('total-formula-cost-display');
const dynamicCostPerKg = document.getElementById('dynamic-cost-per-kg');
if (_clearGrossWt) _clearGrossWt.value = '';
if (_clearContWt) _clearContWt.value = '';
if (_clearNetWt) _clearNetWt.value = '';
if (formulaUnitsEl) formulaUnitsEl.value = '1';
if (displayCostValue) displayCostValue.innerText = '0.00';
if (profitPerKg) profitPerKg.innerText = '0.00';
if (formulaUnitCostDisplay) formulaUnitCostDisplay.innerText = '0.00/unit';
if (totalFormulaCostDisplay) totalFormulaCostDisplay.innerText = '0.00';
if (dynamicCostPerKg) dynamicCostPerKg.innerText = '0.00/kg';
await refreshUI();
calculateNetCash();
calculateCashTracker();
showToast("Production record saved successfully!", "success");
}

function _dedupDeletionRecordsLocal(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Map();
  arr.forEach(r => {
    if (!r) return;
    const key = String(r.id || r.recordId || '');
    if (!key) return;
    const existing = seen.get(key);
    if (!existing
        || (!existing.displayName && r.displayName)
        || (!existing.snapshot && r.snapshot)
        || (r.syncedToCloud && !existing.syncedToCloud)) {
      seen.set(key, r);
    }
  });
  return Array.from(seen.values());
}

async function registerDeletion(id, collectionName = 'unknown', preDeletedRecord = null) {

const deletionRecords = ensureArray(await sqliteStore.get('deletion_records'));
const deletedRecordIds = new Set(ensureArray(await sqliteStore.get('deleted_records')));
if (!id) {
return;
}
if (!validateUUID(id)) {
return;
}
const now = getTimestamp();

let _snapshot;
if (preDeletedRecord && typeof preDeletedRecord === 'object') {
  const tempResult = { displayName: null, displayDetail: null, displayAmount: null, record: preDeletedRecord };
  const s = preDeletedRecord;
  switch (collectionName) {
    case 'sales':
      tempResult.displayName   = s.customerName || s.name || 'Unknown Customer';
      tempResult.displayDetail = [s.supplyStore || s.store || '', s.paymentType ? (s.paymentType === 'CASH' ? 'Cash' : s.paymentType === 'CREDIT' ? 'Credit' : s.paymentType) : '', s.date || ''].filter(Boolean).join(' · ');
      tempResult.displayAmount = s.totalValue != null ? `₨${Number(s.totalValue).toLocaleString()}` : (s.quantity ? `${s.quantity} kg` : null);
      break;
    case 'transactions':
      tempResult.displayName   = s.entityName || s.name || s.description || 'Unknown Transaction';
      tempResult.displayDetail = [s.type === 'IN' ? '↓ IN' : s.type === 'OUT' ? '↑ OUT' : (s.type || ''), s.date || ''].filter(Boolean).join(' · ');
      tempResult.displayAmount = s.amount != null ? `₨${Number(s.amount).toLocaleString()}` : (s.totalValue != null ? `₨${Number(s.totalValue).toLocaleString()}` : null);
      break;
    case 'rep_sales':
      tempResult.displayName   = s.customerName || s.name || 'Unknown Rep Customer';
      tempResult.displayDetail = [s.salesRep ? `Rep: ${s.salesRep}` : '', s.paymentType === 'COLLECTION' ? 'Collection' : s.paymentType === 'CREDIT' ? 'Credit' : s.paymentType === 'CASH' ? 'Cash' : (s.paymentType || ''), s.date || ''].filter(Boolean).join(' · ');
      tempResult.displayAmount = s.totalValue != null ? `₨${Number(s.totalValue).toLocaleString()}` : (s.quantity ? `${s.quantity} kg` : null);
      break;
    case 'expenses':
      tempResult.displayName   = s.name || s.description || 'Unknown Expense';
      tempResult.displayDetail = [s.category || '', s.date || ''].filter(Boolean).join(' · ');
      tempResult.displayAmount = s.amount != null ? `₨${Number(s.amount).toLocaleString()}` : null;
      break;
    case 'sales_customers':
      tempResult.displayName   = s.name || null;
      tempResult.displayDetail = s.phone ? ` ${s.phone}` : '';
      break;
    case 'rep_customers':
      tempResult.displayName   = s.name || null;
      tempResult.displayDetail = [s.salesRep ? `Rep: ${s.salesRep}` : '', s.phone || ''].filter(Boolean).join(' · ');
      break;
    case 'production':
      tempResult.displayName   = s.store ? `Production – ${getStoreLabel ? getStoreLabel(s.store) : s.store}` : 'Production Batch';
      tempResult.displayDetail = s.date || '';
      tempResult.displayAmount = s.net != null ? `${s.net} kg` : null;
      break;
    case 'factory_history':
      tempResult.displayName   = s.store ? `Factory – ${getStoreLabel ? getStoreLabel(s.store) : s.store}` : 'Factory Production';
      tempResult.displayDetail = s.date || '';
      tempResult.displayAmount = s.units != null ? `${s.units} units` : null;
      break;
    case 'returns':
      tempResult.displayName   = s.store ? `Return – ${getStoreLabel ? getStoreLabel(s.store) : s.store}` : 'Stock Return';
      tempResult.displayDetail = s.date || '';
      tempResult.displayAmount = s.quantity != null ? `${s.quantity} kg` : null;
      break;
    case 'inventory':
      tempResult.displayName   = s.name || 'Inventory Item';
      tempResult.displayDetail = s.supplierName ? `Supplier: ${s.supplierName}` : '';
      tempResult.displayAmount = s.quantity != null ? `${s.quantity} kg` : null;
      break;
    case 'calculator_history':
      tempResult.displayName   = s.customerName || s.customer || s.name || 'Calculator Entry';
      tempResult.displayDetail = s.supplyStore || s.store || '';
      tempResult.displayAmount = s.totalValue != null ? `₨${Number(s.totalValue).toLocaleString()}` : null;
      break;
    case 'entities':
      tempResult.displayName   = s.name || 'Payment Entity';
      tempResult.displayDetail = s.phone ? ` ${s.phone}` : (s.type || '');
      break;
    default:
      tempResult.displayName   = s.name || s.customerName || s.entityName || s.description || null;
      tempResult.displayDetail = s.date || null;
      tempResult.displayAmount = s.amount != null ? `₨${Number(s.amount).toLocaleString()}` : null;
  }
  _snapshot = tempResult;
} else {
  _snapshot = await _captureRecordSnapshot(id, collectionName);
}
const deletionRecord = {
id: id,
recordId: id,
recordType: collectionName,
deletedAt: now,
collection: collectionName,
syncedToCloud: false,
tombstoned_at: now,
deleted_by: (() => {
  const _mode = typeof appMode !== 'undefined' ? appMode : 'admin';
  if (_mode === 'rep') return (typeof currentRepProfile !== 'undefined' && currentRepProfile) ? currentRepProfile : 'Sales Rep';
  if (_mode === 'userrole' || _mode === 'production' || _mode === 'factory') return (window._assignedManagerName) ? window._assignedManagerName : (_mode === 'userrole' ? 'User Role' : _mode === 'production' ? 'Production' : 'Factory');
  return 'Admin';
})(),
deletion_version: '2.0',
displayName: _snapshot.displayName || null,
displayDetail: _snapshot.displayDetail || null,
displayAmount: _snapshot.displayAmount || null,
snapshot: _snapshot.record || null,
};
if (collectionName === 'expenses' || collectionName === 'transactions') {
  try {
    const _regPhKey = 'expense:' + id;
    const _regPh = (await sqliteStore.get('person_photos')) || {};
    if (_regPh[_regPhKey]) deletionRecord._photoDataUrl = _regPh[_regPhKey];
  } catch(_regPhErr) { console.warn('[registerDeletion] photo snapshot failed', _regPhErr); }
}
if (!validateTimestamp(deletionRecord.deletedAt, false)) {
deletionRecord.deletedAt = now;
deletionRecord.tombstoned_at = now;
}
deletedRecordIds.add(id);

const _sid = String(id);
const existingIndex = deletionRecords.findIndex(r => String(r.id) === _sid || String(r.recordId) === _sid);
if (existingIndex >= 0) {
deletionRecords[existingIndex] = deletionRecord;
} else {
deletionRecords.push(deletionRecord);
}
const _deduped = _dedupDeletionRecordsLocal(deletionRecords);
await sqliteStore.set('deletion_records', _deduped);
await sqliteStore.set('deleted_records', Array.from(deletedRecordIds));
triggerAutoSync();

uploadDeletionToCloud(deletionRecord).catch(e => console.warn('[registerDeletion] cloud upload failed:', _safeErr(e)));
cleanupOldDeletions().catch(e => console.warn('[registerDeletion] cleanup failed:', _safeErr(e)));
}

async function _captureRecordSnapshot(id, collectionName) {
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const salesHistory = ensureArray(await sqliteStore.get('noman_history'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const factoryProductionHistory = ensureArray(await sqliteStore.get('factory_production_history'));
  const result = { displayName: null, displayDetail: null, displayAmount: null, record: null };
  try {
    let record = null;
    const searches = [
      [customerSales,            r => r.id === id],
      [paymentTransactions,      r => r.id === id],
      [repSales,                 r => r.id === id],
      [expenseRecords,           r => r.id === id],
      [db,                       r => r.id === id],
      [factoryProductionHistory, r => r.id === id],
      [stockReturns,             r => r.id === id],
      [salesHistory,             r => r.id === id],
      [paymentEntities,          r => r.id === id],
      [factoryInventoryData,     r => r.id === id],
    ];
    for (const [arr, pred] of searches) {
      if (Array.isArray(arr)) { record = arr.find(pred); if (record) break; }
    }
    if (!record) return result;
    result.record = record;
    switch (collectionName) {
      case 'sales':
        result.displayName   = record.customerName || record.name || 'Unknown Customer';
        result.displayDetail = [
          record.supplyStore || record.store || '',
          record.paymentType ? (record.paymentType === 'CASH' ? 'Cash' : record.paymentType === 'CREDIT' ? 'Credit' : record.paymentType) : '',
          record.date || ''
        ].filter(Boolean).join(' · ');
        result.displayAmount = record.totalValue != null ? `₨${Number(record.totalValue).toLocaleString()}` : (record.quantity ? `${record.quantity} kg` : null);
        break;
      case 'transactions':
        result.displayName   = record.entityName || record.description || record.name || 'Unknown Entity';
        result.displayDetail = [
          record.type === 'IN' ? '↓ IN' : record.type === 'OUT' ? '↑ OUT' : (record.type || ''),
          record.date || ''
        ].filter(Boolean).join(' · ');
        result.displayAmount = record.amount != null ? `₨${Number(record.amount).toLocaleString()}` : (record.totalValue != null ? `₨${Number(record.totalValue).toLocaleString()}` : null);
        break;
      case 'rep_sales':
        result.displayName   = record.customerName || record.name || 'Unknown Rep Customer';
        result.displayDetail = [
          record.salesRep ? `Rep: ${record.salesRep}` : '',
          record.paymentType === 'COLLECTION' ? 'Collection' : record.paymentType === 'CREDIT' ? 'Credit' : record.paymentType === 'CASH' ? 'Cash' : (record.paymentType || ''),
          record.date || ''
        ].filter(Boolean).join(' · ');
        result.displayAmount = record.totalValue != null ? `₨${Number(record.totalValue).toLocaleString()}` : (record.quantity ? `${record.quantity} kg` : null);
        break;
      case 'expenses':
        result.displayName   = record.name || 'Unknown Expense';
        result.displayDetail = record.category || '';
        result.displayAmount = record.amount != null ? `₨${Number(record.amount).toLocaleString()}` : null;
        break;
      case 'production':
        result.displayName   = record.store ? `Store ${record.store}` : 'Production Batch';
        result.displayDetail = record.date || '';
        result.displayAmount = record.net != null ? `${record.net} kg net` : null;
        break;
      case 'factory_history':
        result.displayName   = record.store ? `Factory – ${record.store}` : 'Factory Production';
        result.displayDetail = record.date || '';
        result.displayAmount = record.units != null ? `${record.units} units` : null;
        break;
      case 'returns':
        result.displayName   = record.store ? `Return – ${record.store}` : 'Stock Return';
        result.displayDetail = record.date || '';
        result.displayAmount = record.quantity != null ? `${record.quantity} kg` : null;
        break;
      case 'calculator_history':
        result.displayName   = record.customerName || record.customer || 'Calculator Entry';
        result.displayDetail = record.store || record.supplyStore || '';
        result.displayAmount = record.totalValue != null ? `₨${Number(record.totalValue).toLocaleString()}` : null;
        break;
      case 'inventory':
        result.displayName   = record.name || 'Inventory Item';
        result.displayDetail = record.supplierName ? `Supplier: ${record.supplierName}` : '';
        result.displayAmount = record.quantity != null ? `${record.quantity} kg` : null;
        break;
      case 'sales_customers':
        result.displayName   = record.name || null;
        result.displayDetail = record.phone ? ` ${record.phone}` : '';
        result.displayAmount = null;
        break;
      case 'rep_customers':
        result.displayName   = record.name || null;
        result.displayDetail = [record.salesRep ? `Rep: ${record.salesRep}` : '', record.phone || ''].filter(Boolean).join(' · ');
        result.displayAmount = null;
        break;
      case 'entities':
        result.displayName   = record.name || 'Payment Entity';
        result.displayDetail = record.phone ? ` ${record.phone}` : (record.type || '');
        result.displayAmount = null;
        break;
      default:
        result.displayName   = record.name || record.customerName || record.entityName || record.description || null;
        result.displayDetail = record.date || null;
        result.displayAmount = record.amount != null ? `₨${Number(record.amount).toLocaleString()}` : null;
    }
  } catch(e) {   }
  return result;
}
_captureRecordSnapshot._fromObj = function(snapshotObj, collectionName) {
  const result = { displayName: null, displayDetail: null, displayAmount: null };
  if (!snapshotObj) return result;
  const s = snapshotObj;
  try {
    switch (collectionName) {
      case 'sales':
        result.displayName   = s.customerName || s.name || null;
        result.displayDetail = [s.supplyStore || s.store || '', s.paymentType || '', s.date || ''].filter(Boolean).join(' · ');
        result.displayAmount = s.totalValue != null ? `₨${Number(s.totalValue).toLocaleString()}` : null;
        break;
      case 'rep_sales':
        result.displayName   = s.customerName || s.name || null;
        result.displayDetail = [s.salesRep ? `Rep: ${s.salesRep}` : '', s.paymentType || '', s.date || ''].filter(Boolean).join(' · ');
        result.displayAmount = s.totalValue != null ? `₨${Number(s.totalValue).toLocaleString()}` : null;
        break;
      case 'transactions':
        result.displayName   = s.entityName || s.description || s.name || null;
        result.displayDetail = [s.type === 'IN' ? '↓ IN' : s.type === 'OUT' ? '↑ OUT' : (s.type || ''), s.date || ''].filter(Boolean).join(' · ');
        result.displayAmount = s.amount != null ? `₨${Number(s.amount).toLocaleString()}` : null;
        break;
      case 'expenses':
        result.displayName   = s.name || s.description || null;
        result.displayDetail = [s.category || '', s.date || ''].filter(Boolean).join(' · ');
        result.displayAmount = s.amount != null ? `₨${Number(s.amount).toLocaleString()}` : null;
        break;
      case 'production':
        result.displayName   = s.store ? `Production – ${s.store}` : 'Production Batch';
        result.displayDetail = s.date || '';
        result.displayAmount = s.net != null ? `${s.net} kg` : null;
        break;
      case 'returns':
        result.displayName   = s.store ? `Return – ${s.store}` : 'Stock Return';
        result.displayDetail = s.date || '';
        result.displayAmount = s.quantity != null ? `${s.quantity} kg` : null;
        break;
      case 'factory_history':
        result.displayName   = s.store ? `Factory – ${s.store}` : 'Factory Production';
        result.displayDetail = s.date || '';
        result.displayAmount = s.units != null ? `${s.units} units` : null;
        break;
      case 'calculator_history':
        result.displayName   = s.customerName || s.customer || s.name || 'Calculator Entry';
        result.displayDetail = s.supplyStore || s.store || '';
        result.displayAmount = s.totalValue != null ? `₨${Number(s.totalValue).toLocaleString()}` : null;
        break;
      case 'inventory':
        result.displayName   = s.name || 'Inventory Item';
        result.displayDetail = s.supplierName ? `Supplier: ${s.supplierName}` : '';
        result.displayAmount = s.quantity != null ? `${s.quantity} kg` : null;
        break;
      case 'sales_customers':
        result.displayName   = s.name || null;
        result.displayDetail = s.phone ? ` ${s.phone}` : '';
        result.displayAmount = null;
        break;
      case 'rep_customers':
        result.displayName   = s.name || null;
        result.displayDetail = [s.salesRep ? `Rep: ${s.salesRep}` : '', s.phone || ''].filter(Boolean).join(' · ');
        result.displayAmount = null;
        break;
      case 'entities':
        result.displayName   = s.name || 'Payment Entity';
        result.displayDetail = s.phone ? ` ${s.phone}` : (s.type || '');
        result.displayAmount = null;
        break;
      default:
        result.displayName   = s.name || s.customerName || s.entityName || s.description || null;
        result.displayDetail = s.date || null;
        result.displayAmount = s.amount != null ? `₨${Number(s.amount).toLocaleString()}` : null;
    }
  } catch(e) {   }
  return result;
};
async function uploadDeletionToCloud(deletionRecord) {
const deletionRecords = ensureArray(await sqliteStore.get('deletion_records'));
if (!firebaseDB || typeof currentUser === 'undefined' || !currentUser) {
return;
}
if (window._firestoreNetworkDisabled || !navigator.onLine) {
if (typeof OfflineQueue !== 'undefined') {
await OfflineQueue.add({
action: 'delete',
collection: deletionRecord.collection !== 'unknown' ? deletionRecord.collection : null,
docId: String(deletionRecord.id),
recordType: deletionRecord.collection,
data: null
});
}
return;
}
try {
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
const batch = firebaseDB.batch();
const deletionsRef = userRef.collection('deletions').doc(String(deletionRecord.id));
batch.set(deletionsRef, {
id: String(deletionRecord.id),
recordId: String(deletionRecord.id),
deletedAt: firebase.firestore.Timestamp.fromMillis(deletionRecord.deletedAt),
collection: deletionRecord.collection,
recordType: deletionRecord.collection,
expiresAt: firebase.firestore.Timestamp.fromMillis(deletionRecord.deletedAt + (90 * 24 * 60 * 60 * 1000)),
displayName: deletionRecord.displayName || null,
displayDetail: deletionRecord.displayDetail || null,
displayAmount: deletionRecord.displayAmount || null,
snapshot: deletionRecord.snapshot ? (typeof sanitizeForFirestore === 'function' ? sanitizeForFirestore({...deletionRecord.snapshot}) : deletionRecord.snapshot) : null,
deleted_by: deletionRecord.deleted_by || 'user',
deletion_version: deletionRecord.deletion_version || '2.0'
});
if (deletionRecord.collection && deletionRecord.collection !== 'unknown') {
const itemRef = userRef.collection(deletionRecord.collection).doc(String(deletionRecord.id));
batch.delete(itemRef);
}
await batch.commit();
trackFirestoreWrite(2);
if (Array.isArray(deletionRecords)) {
const index = deletionRecords.findIndex(r => String(r.id) === String(deletionRecord.id) || String(r.recordId) === String(deletionRecord.id));
if (index > -1) {
deletionRecords[index].syncedToCloud = true;
await sqliteStore.set('deletion_records', deletionRecords);
}
}
} catch (error) {
console.warn('[uploadDeletion] cloud commit failed, queuing for retry:', _safeErr(error));
if (typeof OfflineQueue !== 'undefined') {
await OfflineQueue.add({
action: 'delete',
collection: deletionRecord.collection !== 'unknown' ? deletionRecord.collection : null,
docId: String(deletionRecord.id),
recordType: deletionRecord.collection,
data: null
});
}
}
}

async function cleanupOldDeletions() {
const deletionRecords = ensureArray(await sqliteStore.get('deletion_records'));
const deletedRecordIds = new Set(ensureArray(await sqliteStore.get('deleted_records')));
const threeMonthsAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
const validDeletions = deletionRecords.filter(record => record.deletedAt > threeMonthsAgo);
if (validDeletions.length !== deletionRecords.length) {
const expiredIds = new Set(
  deletionRecords.filter(r => r.deletedAt <= threeMonthsAgo).map(r => r.id)
);
expiredIds.forEach(id => deletedRecordIds.delete(id));
await sqliteStore.set('deletion_records', validDeletions);
await sqliteStore.set('deleted_records', Array.from(deletedRecordIds));
}
if (firebaseDB && typeof currentUser !== 'undefined' && currentUser &&
!window._firestoreNetworkDisabled && navigator.onLine) {
try {
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
const expiredQuery = userRef.collection('deletions')
.where('expiresAt', '<=', firebase.firestore.Timestamp.now());
const snapshot = await expiredQuery.get();
if (!snapshot.empty) {
const batch = firebaseDB.batch();
snapshot.docs.forEach(doc => {
batch.delete(doc.ref);
});
await batch.commit();
}
} catch (error) {
console.warn('[cleanupOldDeletions] cloud cleanup failed, will retry when online:', _safeErr(error));
}
}
}

async function _buildPreclosePanel(record, type, panelId) {
  const ms  = record.mergedSummary || {};
  const dr  = ms.dateRange || {};
  const fmt = async (v) => (v != null && v !== '' && !isNaN(Number(v))) ? await formatCurrency(v) : '—';
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'2-digit'}) : '—';
  const row = (label, v, cls) =>
    `<div class="txn-preclose-row"><span class="txn-preclose-label">${label}</span><span class="txn-preclose-val${cls ? ' '+cls : ''}">${v}</span></div>`;
  const sec = (t) => `<div class="txn-preclose-section">${t}</div>`;

  const fromDate = fmtDate(dr.from);
  const toDate   = fmtDate(dr.to);
  const recCount = ms.recordCount || record.mergedRecordCount || '—';

  let html = sec('<svg width="13" height="13" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:-2px;margin-right:4px;"><rect x="4" y="8" width="28" height="22" rx="3" fill="var(--accent)" fill-opacity="0.10" stroke="var(--accent)" stroke-width="1.5"/><line x1="4" y1="15" x2="32" y2="15" stroke="var(--accent)" stroke-width="1.4"/><line x1="12" y1="4" x2="12" y2="11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity="0.65"/><line x1="24" y1="4" x2="24" y2="11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity="0.65"/><circle cx="12" cy="22" r="1.5" fill="var(--accent)" opacity="0.8"/><circle cx="18" cy="22" r="1.5" fill="var(--accent)" opacity="0.8"/><circle cx="24" cy="22" r="1.5" fill="var(--accent)" opacity="0.8"/></svg>Year-Close Overview');
  html += row('Period',          `${fromDate} → ${toDate}`, 'muted');
  html += row('Transactions',    `${recCount} merged`, 'purple');
  html += row('Merge Date',      fmtDate(record.date), 'muted');

  if (type === 'sale') {
    const storeLabel = typeof getStoreLabel === 'function'
      ? getStoreLabel(record.supplyStore || 'STORE_A') : (record.supplyStore || '—');

    if (record.quantity > 0 || record.totalValue > 0) {
      html += sec('Sales Volume');
      if (record.quantity > 0)   html += row('Total Quantity',  `${safeToFixed(record.quantity, 2)} kg`);
      if (record.unitPrice > 0)  html += row('Unit Price',      `${await fmt(record.unitPrice)}/kg`);
      if (record.supplyStore)    html += row('Supply Store',    storeLabel, 'muted');
      html += row('Gross Sale Value', await fmt(record.totalValue));
    }

    html += sec('Sales Breakdown');
    if (ms.cashSales    != null) html += row('Cash Sales',         await fmt(ms.cashSales),    'green');
    if (ms.unpaidCredit  > 0)    html += row('Credit (Unpaid)',    await fmt(ms.unpaidCredit), 'red');
    if (ms.oldDebt       > 0)    html += row('Old Debt Carried',  await fmt(ms.oldDebt),      'warn');

    html += sec('Payments & Collections');
    if (ms.collectionsReceived > 0) html += row('Collections Received', await fmt(ms.collectionsReceived), 'green');
    if (ms.partialPayments     > 0) html += row('Partial Payments',     await fmt(ms.partialPayments),     'green');
    if (ms.advanceCreditHeld   > 0) html += row('Advance Held',         await fmt(ms.advanceCreditHeld),   'green');
    if (record.partialPaymentReceived > 0)
                                    html += row('Total Paid So Far',    await fmt(record.partialPaymentReceived), 'green');
    if (ms.grossOutstanding    > 0) html += row('Gross Outstanding',    await fmt(ms.grossOutstanding), 'red');
    const netOut = ms.netOutstanding != null ? ms.netOutstanding : (record.creditValue || 0);
    html += row('Net Outstanding', await fmt(netOut), netOut <= 0.01 ? 'green' : 'red');

    html += sec('Profitability');
    if (record.totalCost > 0)         html += row('Total Cost',        await fmt(record.totalCost),       'red');
    if (ms.realizedProfit   != null)   html += row('Realized Profit',  await fmt(ms.realizedProfit),      ms.realizedProfit   >= 0 ? 'green' : 'red');
    if (ms.unrealizedProfit != null && ms.unrealizedProfit !== 0)
                                       html += row('Unrealized Profit', await fmt(ms.unrealizedProfit),   'warn');
    if (record.profit != null) {
      const pSign = record.profit < 0 ? '− ' : '';
      html += row('Total Profit', `${pSign}${await fmt(Math.abs(record.profit))}`, record.profit >= 0 ? 'green' : 'red');
    }

    html += sec('Status');
    const settled = ms.isSettled || netOut <= 0.01;
    html += row('Settlement', settled ? '<svg width="12" height="12" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:-1px;margin-right:3px;"><circle cx="18" cy="18" r="13" fill="var(--success)" fill-opacity="0.15" stroke="var(--success)" stroke-width="1.5"/><polyline points="10,18 15,23 26,12" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>Fully Settled' : '<svg width="12" height="12" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:-1px;margin-right:3px;"><circle cx="18" cy="18" r="13" fill="var(--warning)" fill-opacity="0.15" stroke="var(--warning)" stroke-width="1.5"/><line x1="18" y1="10" x2="18" y2="19" stroke="var(--warning)" stroke-width="2" stroke-linecap="round"/><line x1="18" y1="19" x2="23" y2="22" stroke="var(--warning)" stroke-width="1.6" stroke-linecap="round"/></svg>Outstanding', settled ? 'green' : 'red');
    if (record.creditReceivedDate) html += row('Settled On', fmtDate(record.creditReceivedDate), 'muted');
    html += row('Payment Type', record.paymentType || '—', 'muted');
    if (record.salesRep && record.salesRep !== 'NONE' && record.salesRep !== 'ADMIN')
      html += row('Sales Rep', esc(record.salesRep), 'muted');
  }

  if (type === 'entity') {
    const isOut  = record.type === 'OUT';
    const netBal = ms.netBalance != null ? ms.netBalance : (isOut ? -record.amount : record.amount);
    const netLbl = netBal >= 0 ? 'Receivable' : 'Payable';

    html += sec('Payment Breakdown');
    if (ms.originalIn  != null) html += row('Total Payments IN',  await fmt(ms.originalIn),  'green');
    if (ms.originalOut != null) html += row('Total Payments OUT', await fmt(ms.originalOut), 'red');
    html += row('Net Balance',        `${await fmt(Math.abs(netBal))} (${netLbl})`, netBal >= 0 ? 'green' : 'red');
    html += row('Carried Forward As', `${await fmt(record.amount)} ${isOut ? 'Payable' : 'Receivable'}`);
    if (ms.hasSupplierMaterials) html += row('Note', 'Includes supplier material payments', 'muted');

    html += sec('Details');
    html += row('Type',   record.type === 'OUT' ? 'Payment OUT' : 'Payment IN', isOut ? 'red' : 'green');
    html += row('Amount', await fmt(record.amount));
    if (record.description) html += row('Description', esc(record.description), 'muted');
  }

  if (record.notes) {
    html += `<div style="margin-top:8px;font-size:0.67rem;color:var(--text-muted);font-style:italic;line-height:1.5;border-top:1px solid rgba(175,82,222,0.1);padding-top:8px;">${esc(record.notes)}</div>`;
  }

  return `<div class="txn-preclose-panel" id="${panelId}">
    <div class="txn-preclose-title">Pre-Close Year Data</div>
    ${html}
  </div>`;
}

async function _togglePreclosePanel(btn, panelId, recordId, storeKey, type) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const isOpen = panel.classList.contains('open');
  if (isOpen) {
    panel.classList.remove('open');
    btn.classList.remove('active');
    return;
  }

  if (!panel.dataset.built) {
    try {
      const store = ensureArray(await sqliteStore.get(storeKey));
      const rec   = store.find(x => String(x.id) === String(recordId));
      if (rec) {
        const inner = await _buildPreclosePanel(rec, type, panelId);

        const tmp = document.createElement('div');
        tmp.innerHTML = inner;
        const built = tmp.firstElementChild;
        panel.innerHTML = built ? built.innerHTML : '';
        panel.dataset.built = '1';
      }
    } catch(e) { console.warn('preclose panel build error', e); }
  }
  panel.classList.add('open');
  btn.classList.add('active');
}

async function openEntityDetailsOverlay(id) {
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
currentEntityId = id;
const entity = paymentEntities.find(e => String(e.id) === String(id));
if (!entity) return;
const quickAmountEl = document.getElementById('quickEntityAmount');
if (quickAmountEl) quickAmountEl.value = '';
setQuickEntityType('OUT');
await renderEntityOverlayContent(entity);
if (typeof openStandaloneScreen === 'function') openStandaloneScreen('entity-details-screen');
}

function closeEntityDetailsOverlay() {
if (typeof closeStandaloneScreen === 'function') closeStandaloneScreen('entity-details-screen');
currentEntityId = null;
refreshPaymentTab();
}

function openEditEntityFromDetails() {
const id = currentEntityId;
if (!id) return;
editEntityBasicInfo(id);
}

function setQuickEntityType(type) {
currentQuickType = type;
document.getElementById('quick-type-out').className = `toggle-opt ${type === 'OUT' ? 'active' : ''}`;
document.getElementById('quick-type-in').className = `toggle-opt ${type === 'IN' ? 'active' : ''}`;
}

async function renderEntityOverlayContent(entity) {
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
const _manageET = document.getElementById('manageEntityTitle');
if (_manageET) {
const phone = entity.phone || '';
const wallet = entity.wallet || '';
const _safeEntityId = String(entity.id).replace(/'/g, "\\'");
const _entPhotoKey = 'entity:' + String(entity.id);
const _entPhoto = await getPersonPhoto(_entPhotoKey);
const _entAvatarHTML = renderPersonAvatarHTML(_entPhoto, 44);
_manageET.innerHTML = `<div style="display:flex;align-items:center;gap:10px;">${_entAvatarHTML}<div style="min-width:0;flex:1;"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><span class="u-fw-700">${esc(entity.name)}</span><button class="sidebar-settings-btn" style="width:auto;padding:5px 10px;font-size:0.75rem;color:var(--accent);background:rgba(29,233,182,0.07);border-radius:8px;border:1px solid rgba(29,233,182,0.25);display:inline-flex;align-items:center;gap:5px;" onclick="editEntityBasicInfo('${_safeEntityId}')" title="Edit Entity"><svg width="13" height="13" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="5" width="26" height="7" rx="2.5" fill="var(--accent)" fill-opacity="0.18" stroke="var(--accent)" stroke-width="1.4"/><rect x="5" y="15" width="26" height="7" rx="2.5" fill="var(--accent)" fill-opacity="0.12" stroke="var(--accent)" stroke-width="1.4"/><rect x="5" y="25" width="18" height="7" rx="2.5" fill="var(--accent)" fill-opacity="0.08" stroke="var(--accent)" stroke-width="1.4"/><line x1="27" y1="26" x2="32" y2="21" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round"/><circle cx="26" cy="27" r="1" fill="var(--accent)"/></svg>Edit</button></div>${(phone || wallet) ? `<div style="font-size:0.75rem;color:var(--text-muted);font-weight:normal;margin-top:3px;">${phone ? phoneActionHTML(phone) : ''}${phone && wallet ? ' &middot; ' : ''}${esc(wallet)}</div>` : ''}</div></div>`;
}

try {
const _freshInv = await sqliteStore.get('factory_inventory_data', []);
if (_freshInv && Array.isArray(_freshInv) && _freshInv.length > 0) {
}
} catch (_e) {}
const balances = await calculateEntityBalances();
const balance = balances[entity.id] || 0;
const entityTransactions = paymentTransactions.filter(t => t.entityId === entity.id && !t.isExpense);
const totalIn = entityTransactions.filter(t => t.type === 'IN').reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
const totalOut = entityTransactions.filter(t => t.type === 'OUT').reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
const statsEl = document.getElementById('manageEntityStats');
let balanceHtml = '';
if (balance > 0) {
balanceHtml = `<span class="u-danger-bold" >Payable: ${fmtAmt(balance)}</span>`;
} else if (balance < 0) {
balanceHtml = `<span class="u-text-emerald u-fw-800" >Receivable: ${fmtAmt(Math.abs(balance))}</span>`;
} else {
balanceHtml = `<span class="u-text-accent u-fw-800" >Balance Settled</span>`;
}
statsEl.innerHTML = `
${balanceHtml}
<span style="display:inline-flex; gap:8px; margin-left:12px; flex-wrap:wrap;">
<span class="txn-stat-badge txn-in">IN: ${fmtAmt(totalIn)}</span>
<span class="txn-stat-badge txn-out">OUT: ${fmtAmt(totalOut)}</span>
</span>`;
const list = document.getElementById('entityManagementHistoryList');
if (!list) {
return;
}

const _entityFrag = document.createDocumentFragment();
let transactions = paymentTransactions.filter(t => t.entityId === entity.id);
const rangeSelect = document.getElementById('entityPdfRange');
const range = rangeSelect ? rangeSelect.value : 'all';
if (range !== 'all') {
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
transactions = transactions.filter(t => {
if (!t.date) return false;
const transDate = new Date(t.date);
switch(range) {
case 'today':
return transDate >= today;
case 'week':
const weekAgo = new Date(today);
weekAgo.setDate(weekAgo.getDate() - 7);
return transDate >= weekAgo;
case 'month':
const monthAgo = new Date(today);
monthAgo.setMonth(monthAgo.getMonth() - 1);
return transDate >= monthAgo;
case 'year':
const yearAgo = new Date(today);
yearAgo.setFullYear(yearAgo.getFullYear() - 1);
return transDate >= yearAgo;
default:
return true;
}
});
}
transactions.sort((a,b) => b.timestamp - a.timestamp);
if (transactions.length === 0) {
list.replaceChildren(Object.assign(document.createElement('div'), {className:'u-empty-state-sm',textContent:'No transaction history'}));
return;
}
transactions.forEach(t => {
const isOut = t.type === 'OUT';
const colorClass = isOut ? 'cost-val' : 'profit-val';
const badgeColor = isOut ? 'var(--danger)' : 'var(--accent-emerald)';
const label = isOut ? 'PAYMENT OUT' : 'PAYMENT IN';
const safeId = String(t.id).replace(/'/g, "\\'");
const safeExpenseId = t.expenseId ? String(t.expenseId).replace(/'/g, "\\'") : '';
const photoBadgeId = 'ph-badge-' + (t.expenseId || t.id).replace(/[^a-z0-9]/gi, '');
const item = document.createElement('div');
item.className = `cust-history-item${t.isSettled ? ' is-settled-record' : ''}`;
item.style.flexDirection = 'column';
item.style.alignItems = 'stretch';
item.innerHTML = `
<div class="txn-card-row">
  <div class="cust-history-info">
    <div class="u-fs-sm2 u-text-muted">${formatDisplayDateTime(t.date, t.time || null)}</div>
    <div class="u-fs-sm2 u-text-muted">${esc(t.description || 'No description')}${(typeof _creatorBadgeHtml === 'function') ? _creatorBadgeHtml(t) : ''}</div>
    ${t.isMerged ? _mergedBadgeHtml(t) : ''}
  </div>
  <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
    <div style="text-align:right;">
      <span style="color:${badgeColor};padding:2px 6px;border-radius:4px;font-size:0.65rem;font-weight:700;">${label}</span>
      <div class="${colorClass}" style="font-size:0.9rem;margin-top:2px;">${fmtAmt(t.amount)}</div>
    </div>
    <button id="${photoBadgeId}" title="View photo" onclick="_toggleEntityTxnPanel(this,'','${safeId}','${safeExpenseId}')"
      style="display:none;align-items:center;gap:3px;padding:3px 7px;border:none;border-radius:6px;cursor:pointer;font-size:0.62rem;font-weight:700;background:rgba(99,102,241,0.15);color:#818cf8;white-space:nowrap;">
      <svg width="11" height="11" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;">
        <rect x="3" y="7" width="30" height="22" rx="3" stroke="currentColor" stroke-width="1.8" fill="none"/>
        <circle cx="18" cy="18" r="6" stroke="currentColor" stroke-width="1.6" fill="none"/>
        <circle cx="18" cy="18" r="2.5" fill="currentColor"/>
        <rect x="22" y="4" width="8" height="5" rx="1.5" stroke="currentColor" stroke-width="1.4" fill="none"/>
      </svg>
      Photo
    </button>
    <button class="btn btn-sm btn-danger u-p-4-8" onclick="deleteEntityTransaction('${esc(t.id)}')">⌫</button>
  </div>
</div>`;
_entityFrag.appendChild(item);
if (t.expenseId) {
  const _phKey = 'expense:' + t.expenseId;
  sqliteStore.get('person_photos').then(ph => {
    if (ph && ph[_phKey]) {
      const badge = document.getElementById(photoBadgeId);
      if (badge) badge.style.display = 'inline-flex';
    }
  }).catch(() => {});
}
});
list.replaceChildren(_entityFrag);
}

function filterEntityManagementHistory() {
const term = document.getElementById('entity-trans-search').value.toLowerCase();
const items = document.querySelectorAll('#entityManagementHistoryList .cust-history-item');
items.forEach(item => {
const text = item.innerText.toLowerCase();
if (!text.includes(term)) { item.style.display = 'none'; return; }
item.style.display = item.style.flexDirection === 'column' ? 'flex' : 'flex';
});
}

async function _toggleEntityTxnPanel(btn, panelId, txnId, expenseId) {
  const photoKey = expenseId ? 'expense:' + expenseId : null;
  if (photoKey) {
    try {
      const stored = (await sqliteStore.get('person_photos')) || {};
      const dataUrl = stored[photoKey] || null;
      if (dataUrl) { openPhotoLightbox(dataUrl); return; }
    } catch(_) {}
  }
  showToast('No photo attached to this transaction', 'warning', 2000);
}

async function saveQuickEntityTransaction() {
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const quickAmountEl = document.getElementById('quickEntityAmount');
if (!quickAmountEl) {
return;
}
const amount = parseFloat(quickAmountEl.value);
if (!amount || amount <= 0) {
showToast("Please enter a valid amount", "warning");
return;
}
if (!currentEntityId) return;
const entity = paymentEntities.find(e => String(e.id) === String(currentEntityId));
if (!entity) {
showToast('Entity not found. Please refresh and try again.', 'error');
return;
}
if (currentQuickType === 'OUT') {
const _sqetAvail = await getAvailableCashInHand();
if (_sqetAvail < amount) {
showToast(`Insufficient cash in hand. Available: ${fmtAmt(Math.max(0, _sqetAvail))} — Required: ${fmtAmt(amount)}`, 'error', 5000);
return;
}
}
try {
const now = new Date();
const _sqetHours = now.getHours();
const _sqetMins = now.getMinutes();
const _sqetSecs = now.getSeconds();
const _sqetAmpm = _sqetHours >= 12 ? 'PM' : 'AM';
const _sqetH12 = (_sqetHours % 12) || 12;
const timeString = `${String(_sqetH12).padStart(2,'0')}:${String(_sqetMins).padStart(2,'0')}:${String(_sqetSecs).padStart(2,'0')} ${_sqetAmpm}`;
const dateStr = now.toISOString().split('T')[0];
let txnId = generateUUID('pay');
if (!validateUUID(txnId)) {
txnId = generateUUID('pay');
}
let transaction = {
id: txnId,
entityId: entity.id,
entityName: entity.name,
entityType: entity.type,
date: dateStr,
time: timeString,
amount: amount,
description: `Quick ${currentQuickType} from Manager`,
type: currentQuickType,
isPayable: false,
createdAt: now.getTime(),
updatedAt: now.getTime(),
timestamp: now.getTime(),
syncedAt: new Date().toISOString(),
createdBy: (appMode === 'userrole' && window._assignedManagerName) ? window._assignedManagerName : null
};
if (currentQuickType === 'OUT') {
const pendingMaterials = factoryInventoryData
.filter(m =>
String(m.supplierId) === String(entity.id) &&
m.paymentStatus === 'pending' &&
m.totalPayable > 0
)
.sort((a, b) =>
new Date(a.purchaseDate || a.date || a.createdAt || 0) -
new Date(b.purchaseDate || b.date || b.createdAt || 0)
);
if (pendingMaterials.length > 0) {
let remaining = amount;
const materialsToSave = [];
let firstMaterialId = null;
for (const mat of pendingMaterials) {
if (remaining <= 0) break;
if (remaining >= mat.totalPayable) {
remaining -= mat.totalPayable;
mat.totalPayable = 0;
mat.paymentStatus = 'paid';
mat.paidDate = dateStr;
mat.updatedAt = getTimestamp();
} else {
mat.totalPayable = parseFloat((mat.totalPayable - remaining).toFixed(2));
remaining = 0;
mat.updatedAt = getTimestamp();
}
ensureRecordIntegrity(mat, true);
materialsToSave.push(mat);
if (!firstMaterialId) firstMaterialId = mat.id;
}
if (materialsToSave.length > 0) {
transaction.isPayable = true;
transaction.materialId = firstMaterialId;
for (const mat of materialsToSave) {
await unifiedSave('factory_inventory_data', factoryInventoryData, mat);
}
}
}
}
transaction = ensureRecordIntegrity(transaction, false);
paymentTransactions.push(transaction);
await unifiedSave('payment_transactions', paymentTransactions, transaction);
emitSyncUpdate({ payment_transactions: null});
notifyDataChange('payments');
triggerAutoSync();
quickAmountEl.value = '';
renderEntityOverlayContent(entity);
calculateNetCash();
if (typeof calculateCashTracker === 'function') calculateCashTracker();
if (transaction.isPayable) {
if (typeof renderFactoryInventory === 'function') renderFactoryInventory();
}

if (typeof renderUnifiedTable === 'function') renderUnifiedTable(1);
showToast("Transaction saved successfully", "success");
} catch (error) {
showToast('Failed to save transaction. Please try again.', 'error');
}
}

async function _restorePayableFromDeletedTransaction(tx, allTransactions, allInventory) {
if (!tx || !tx.isPayable) return false;
const factoryInventoryData = allInventory || ensureArray(await sqliteStore.get('factory_inventory_data'));
const paymentTransactions = allTransactions || ensureArray(await sqliteStore.get('payment_transactions'));
if (tx.type === 'OUT') {
const supplierId = tx.entityId;
const supplierMaterials = factoryInventoryData.filter(m => String(m.supplierId) === String(supplierId));
if (supplierMaterials.length === 0) return false;
const remainingPayments = paymentTransactions
.filter(t => t.id !== tx.id && t.isPayable === true && t.type === 'OUT' && String(t.entityId) === String(supplierId))
.sort((a, b) => new Date(a.date || a.createdAt || 0) - new Date(b.date || b.createdAt || 0));
const sortedMaterials = supplierMaterials.slice().sort((a, b) =>
new Date(a.purchaseDate || a.createdAt || 0) - new Date(b.purchaseDate || b.createdAt || 0)
);
sortedMaterials.forEach(mat => {
const original = parseFloat((
mat.totalValue ||
(mat.purchaseCost && mat.purchaseQuantity ? mat.purchaseCost * mat.purchaseQuantity : (mat.quantity || 0) * (mat.cost || 0)) ||
0
).toFixed(2));
mat.totalPayable = original;
mat.paymentStatus = 'pending';
delete mat.paidDate;
mat.updatedAt = getTimestamp();
});
remainingPayments.forEach(payment => {
let remaining = parseFloat(payment.amount) || 0;
for (const mat of sortedMaterials) {
if (remaining <= 0) break;
if (mat.totalPayable <= 0) continue;
if (remaining >= mat.totalPayable) {
remaining -= mat.totalPayable;
mat.totalPayable = 0;
mat.paymentStatus = 'paid';
mat.paidDate = payment.date;
mat.updatedAt = getTimestamp();
} else {
mat.totalPayable = parseFloat((mat.totalPayable - remaining).toFixed(2));
remaining = 0;
mat.updatedAt = getTimestamp();
}
ensureRecordIntegrity(mat, true);
}
});
for (const mat of sortedMaterials) {
ensureRecordIntegrity(mat, true);
await unifiedSave('factory_inventory_data', factoryInventoryData, mat);
}
return true;
}
if (tx.type === 'IN') {
return true;
}
return false;
}

async function deleteEntityTransaction(id) {
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
if (!id || !validateUUID(id)) {
showToast('Invalid transaction ID', 'error');
return;
}
const _dt = paymentTransactions.find(t => t.id === id);
if (!_dt) {
const _ent0 = paymentEntities.find(e => String(e.id) === String(currentEntityId));
if (_ent0) renderEntityOverlayContent(_ent0);
if (typeof renderUnifiedTable === 'function') renderUnifiedTable(1);
return;
}
if (_dt.isMerged) {
showToast('Merged opening balance records cannot be deleted', 'warning');
return;
}
const _dtEntity = paymentEntities.find(e => String(e.id) === String(_dt.entityId));
const _dtEntityName = _dtEntity ? _dtEntity.name : 'Unknown';
const _dtTypeLabel = _dt.type === 'IN' ? 'Payment Received (IN)' : 'Payment Made (OUT)';
const _dtAmount = (parseFloat(_dt.amount) || 0).toFixed(2);
const _dtDate = _dt.date || 'Unknown date';
const _dtDesc = _dt.description ? `\nNote: ${_dt.description}` : '';
let _dtMsg = `Delete this ${_dtTypeLabel}?`;
_dtMsg += `\n\nEntity: ${_dtEntityName}`;
_dtMsg += `\nAmount: ${_dtAmount}`;
_dtMsg += `\nDate: ${_dtDate}`;
if (_dtDesc) _dtMsg += _dtDesc;
if (_dt.isPayable && _dt.type === 'OUT') {
_dtMsg += `\n\n↩ Supplier payable status will be restored — material will revert to pending payment.`;
}
if (_dt.isPayable && _dt.type === 'IN') {
_dtMsg += `\n\n↩ Credit purchase record removed — supplier will be unlinked from material.`;
}
_dtMsg += `\n\nThis cannot be undone.`;
if (await showGlassConfirm(_dtMsg, { title: `Delete ${_dt.type === 'IN' ? 'Payment IN' : 'Payment OUT'}`, confirmText: "Delete", danger: true })) {
try {
await _restorePayableFromDeletedTransaction(_dt, paymentTransactions, factoryInventoryData);
const _ptFiltered1 = paymentTransactions.filter(t => t.id !== id);
await unifiedDelete('payment_transactions', _ptFiltered1, id, { strict: true }, _dt);
if (_dt.expenseId) {
try {
const _etPhKey = 'expense:' + _dt.expenseId;
const _etPh = (await sqliteStore.get('person_photos')) || {};
if (_etPh[_etPhKey] !== undefined) {
delete _etPh[_etPhKey];
await sqliteStore.set('person_photos', _etPh);
const _etPhTs = (await sqliteStore.get('person_photos_timestamps')) || {};
delete _etPhTs[_etPhKey];
await sqliteStore.set('person_photos_timestamps', _etPhTs);
const _etDk = (await sqliteStore.get('person_photos_dirty_keys')) || [];
if (!_etDk.includes(_etPhKey)) _etDk.push(_etPhKey);
await sqliteStore.set('person_photos_dirty_keys', _etDk);
if (typeof triggerAutoSync === 'function') { try { triggerAutoSync(); } catch(_) {} }
}
} catch(_etPhErr) { console.warn('[deleteEntityTransaction] photo cleanup failed', _etPhErr); }
}
const _dtEntityRefreshed = paymentEntities.find(e => String(e.id) === String(_dt.entityId));
if (_dtEntityRefreshed) renderEntityOverlayContent(_dtEntityRefreshed);
if (typeof calculateNetCash === 'function') calculateNetCash();
if (typeof calculateCashTracker === 'function') calculateCashTracker();
if (typeof renderFactoryInventory === 'function') renderFactoryInventory();
if (typeof renderUnifiedTable === 'function') renderUnifiedTable(1);
showToast(" Transaction deleted and all balances restored!", "success");
} catch (error) {
showToast('Failed to delete transaction. Please try again.', 'error');
}
}
}

async function deleteCurrentEntity() {
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
if (!currentEntityId) return;
if (!validateUUID(String(currentEntityId))) {
showToast('Invalid entity ID', 'error');
return;
}
const _entityToDel = paymentEntities.find(e => String(e.id) === String(currentEntityId));
if (!_entityToDel) {
showToast('Entity not found', 'error');
return;
}
const _entityName = _entityToDel.name || 'this entity';
const _entityTxs = paymentTransactions.filter(t => String(t.entityId) === String(currentEntityId));
const _totalIn = _entityTxs.filter(t => t.type === 'IN' && !t.isPayable).reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
const _totalOut = _entityTxs.filter(t => t.type === 'OUT' && !t.isPayable).reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
const _linkedMaterials = factoryInventoryData.filter(m => String(m.supplierId) === String(currentEntityId));
let msg = `Permanently delete "${_entityName}"?`;
if (_entityTxs.length > 0) {
msg += `\n\n\u26a0 This entity has ${_entityTxs.length} transaction${_entityTxs.length !== 1 ? 's' : ''} on record`;
if (_totalIn > 0) msg += `\n • Received: ${fmtAmt(_totalIn)}`;
if (_totalOut > 0) msg += `\n • Paid out: ${fmtAmt(_totalOut)}`;
msg += `\n\nAll ${_entityTxs.length} transaction${_entityTxs.length !== 1 ? 's' : ''} will also be permanently deleted.`;
}
if (_linkedMaterials.length > 0) {
msg += `\n\n\u21a9 ${_linkedMaterials.length} linked material${_linkedMaterials.length !== 1 ? 's' : ''} will be unlinked and reverted to pending payment status.`;
}
msg += `\n\nThis cannot be undone.`;
if (!(await showGlassConfirm(msg, { title: `Delete Entity Permanently`, confirmText: "Delete", danger: true }))) return;
try {
for (const mat of _linkedMaterials) {
delete mat.supplierId;
delete mat.supplierName;
delete mat.supplierContact;
delete mat.supplierType;
mat.paymentStatus = 'pending';
delete mat.paidDate;
mat.updatedAt = getTimestamp();
ensureRecordIntegrity(mat, true);
await unifiedSave('factory_inventory_data', factoryInventoryData, mat);
}
const txsToDelete = _entityTxs.slice();
let filteredTx = paymentTransactions.slice();
for (const tx of txsToDelete) {
filteredTx = filteredTx.filter(t => t.id !== tx.id);
await unifiedDelete('payment_transactions', filteredTx, tx.id, { strict: true }, tx);
}
const filteredEntities = paymentEntities.filter(e => String(e.id) !== String(currentEntityId));
await unifiedDelete('payment_entities', filteredEntities, _entityToDel.id, { strict: true }, _entityToDel);
try {
const _delEntPh = (await sqliteStore.get('person_photos')) || {};
const _delEntPhTs = (await sqliteStore.get('person_photos_timestamps')) || {};
const _delEntDk = (await sqliteStore.get('person_photos_dirty_keys')) || [];
let _delEntPhChanged = false;
const _entityPhotoKeys = [
'entity:' + String(currentEntityId),
...txsToDelete.filter(tx => tx.expenseId).map(tx => 'expense:' + tx.expenseId)
];
for (const _epk of _entityPhotoKeys) {
if (_delEntPh[_epk] !== undefined) {
delete _delEntPh[_epk];
delete _delEntPhTs[_epk];
if (!_delEntDk.includes(_epk)) _delEntDk.push(_epk);
_delEntPhChanged = true;
}
}
if (_delEntPhChanged) {
await sqliteStore.set('person_photos', _delEntPh);
await sqliteStore.set('person_photos_timestamps', _delEntPhTs);
await sqliteStore.set('person_photos_dirty_keys', _delEntDk);
if (typeof triggerAutoSync === 'function') { try { triggerAutoSync(); } catch(_) {} }
}
} catch(_delEntPhErr) { console.warn('[deleteCurrentEntity] photo cleanup failed', _delEntPhErr); }
notifyDataChange('entities');
if (typeof calculateNetCash === 'function') calculateNetCash();
if (typeof calculateCashTracker === 'function') calculateCashTracker();
if (typeof renderFactoryInventory === 'function') renderFactoryInventory();
closeEntityDetailsOverlay();
if (typeof refreshPaymentTab === 'function') await refreshPaymentTab();
showToast(`"${_entityName}" and all its transactions deleted.`, 'success');
} catch (error) {
showToast('Failed to delete entity. Please try again.', 'error');
}
}

async function exportEntityData() {
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
let csvContent = "data:text/csv;charset=utf-8,";
csvContent += "Entity Name,Type,Phone,Net Balance (),Status\n";
const balances = await calculateEntityBalances();
paymentEntities.forEach(e => {
const bal = balances[e.id] || 0;
let status = "Settled";
if(bal > 0) status = "Payable (You Owe)";
if(bal < 0) status = "Receivable (Owes You)";
const safeName = safeReplace(e.name, /,/g, " ");
csvContent += `"${safeName}","${e.type}","${e.phone || ''}",${fmtAmt(bal)},"${status}"\n`;
});
const encodedUri = encodeURI(csvContent);
const link = document.createElement("a");
link.setAttribute("href", encodedUri);
link.setAttribute("download", "Entities_List.csv");
document.body.appendChild(link);
link.click();
document.body.removeChild(link);
showToast("Entity list exported", "success");
}

function _pdfMergedPeriodLabel(record) {
  const ms = record.mergedSummary;
  const dr = ms && ms.dateRange;
  if (dr && dr.from && dr.to) {
    const fmt = (d) => {
      try {
        const dd = new Date(d);
        if (isNaN(dd.getTime())) return d;
        return dd.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: '2-digit' });
      } catch (e) { return d; }
    };
    return `${fmt(dr.from)} \u2192 ${fmt(dr.to)}`;
  }
  if (record.date) {
    try {
      const dd = new Date(record.date);
      if (!isNaN(dd.getTime()))
        return dd.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: '2-digit' });
    } catch (e) {}
  }
  return 'Prev. Year';
}

function _pdfMergedCountLabel(record) {
  const cnt = record.mergedRecordCount || (record.mergedSummary && record.mergedSummary.recordCount);
  return cnt ? `${cnt} txn${cnt !== 1 ? 's' : ''} merged` : 'year-end merge';
}

function _pdfDrawMergedSectionHeader(doc, yPos, pageW, label) {
  const purpleLight = [245, 235, 255];
  const purpleDark  = [126, 34, 206];
  const purpleBorder= [175, 82, 222];
  doc.setFillColor(...purpleLight);
  doc.roundedRect(14, yPos, pageW - 28, 12, 2, 2, 'F');
  doc.setDrawColor(...purpleBorder);
  doc.setLineWidth(0.4);
  doc.roundedRect(14, yPos, pageW - 28, 12, 2, 2, 'S');
  doc.setFontSize(8.5);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...purpleDark);
  doc.text('\u2605 ' + (label || 'YEAR-END OPENING BALANCE — MERGED RECORDS'), 20, yPos + 8);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(80, 80, 80);
  return yPos + 16;
}
const PDF_MERGED_HDR_COLOR  = [126, 34, 206];
const PDF_MERGED_ROW_COLOR  = [245, 235, 255];
const PDF_MERGED_TEXT_COLOR = [126, 34, 206];

async function _exportDocAsImageAndOpenWhatsApp(doc, phone, filenameBase) {
  const PDFJS_CDN  = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WRKR = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  if (!window.pdfjsLib) {
    await loadScript(PDFJS_CDN);
    await new Promise(r => setTimeout(r, 300));
  }
  if (!window.pdfjsLib) throw new Error('Failed to load pdf.js — please refresh and try again.');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WRKR;

  const pdfBytes = doc.output('arraybuffer');
  const pdfDoc   = await window.pdfjsLib.getDocument({ data: pdfBytes }).promise;
  const page     = await pdfDoc.getPage(1);
  const viewport = page.getViewport({ scale: 2.5 });

  const canvas   = document.createElement('canvas');
  canvas.width   = viewport.width;
  canvas.height  = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

  const imageBlob = await new Promise(resolve =>
    canvas.toBlob(resolve, 'image/jpeg', 0.92)
  );
  const imageFile = new File([imageBlob], `${filenameBase}.jpg`, { type: 'image/jpeg' });

  const hasPhone = phone && phone !== 'N/A' && phone.trim() !== '';
  const cleaned  = hasPhone ? phone.trim().replace(/[^\d+]/g, '') : '';

  if (navigator.canShare && navigator.canShare({ files: [imageFile] })) {
    try {
      await navigator.share({
        files: [imageFile],
        title: 'Account Statement',
      });
      showToast('Statement shared successfully', 'success');
      return;
    } catch (err) {
      if (err.name === 'AbortError') {
        showToast('Share cancelled', 'info');
        return;
      }
      console.warn('[PDF share] Web Share failed, falling back to download:', _safeErr(err));
    }
  }

  const dlLink    = document.createElement('a');
  dlLink.href     = URL.createObjectURL(imageBlob);
  dlLink.download = `${filenameBase}.jpg`;
  document.body.appendChild(dlLink);
  dlLink.click();
  document.body.removeChild(dlLink);
  setTimeout(() => URL.revokeObjectURL(dlLink.href), 5000);

  if (hasPhone) {
    showToast('Image downloaded — opening WhatsApp to send it…', 'success');
    setTimeout(() => window.open(`https://wa.me/${cleaned}`, '_blank'), 600);
  } else {
    showToast('Statement saved as image (no phone number on record)', 'success');
  }
}

async function exportEntityToPDF() {
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
if (!currentEntityId) {
showToast("No entity selected", "warning");
return;
}
const entity = paymentEntities.find(e => String(e.id) === String(currentEntityId));
if (!entity) {
showToast("Entity not found", "error");
return;
}
const rangeSelect = document.getElementById('entityPdfRange');
const range = rangeSelect ? rangeSelect.value : 'all';
showToast("Generating PDF...", "info");
try {
if (!window.jspdf) {
await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js');
await new Promise(r => setTimeout(r, 200));
}
if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("Failed to load PDF library. Please refresh and try again.");
const allEntityTxns = paymentTransactions.filter(t => String(t.entityId) === String(entity.id) && !t.isExpense);
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
let periodCutoff = null;
if (range !== 'all') {
  switch(range) {
    case 'today':  periodCutoff = today; break;
    case 'week':   { const w = new Date(today); w.setDate(w.getDate() - 7);       periodCutoff = w; break; }
    case 'month':  { const m = new Date(today); m.setMonth(m.getMonth() - 1);     periodCutoff = m; break; }
    case 'year':   { const y = new Date(today); y.setFullYear(y.getFullYear()-1);  periodCutoff = y; break; }
  }
}
const priorTxns = periodCutoff
  ? allEntityTxns.filter(t => { if (!t.date) return false; return new Date(t.date) < periodCutoff; })
  : [];
let transactions = periodCutoff
  ? allEntityTxns.filter(t => { if (!t.date) return false; return new Date(t.date) >= periodCutoff; })
  : allEntityTxns;
const openingBalance = priorTxns.reduce((bal, t) => {
  const amt = parseFloat(t.amount) || 0;
  return t.type === 'OUT' ? bal - amt : bal + amt;
}, 0);
transactions.sort((a, b) => {
const da = toSafeDate(a.date);
const db = toSafeDate(b.date);
return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
});
const isPayee = entity.type === 'payee';
const isPayor = entity.type === 'payor';
const headerColor = isPayee ? [230, 100, 20] : [0, 122, 200];
const isSupplier = typeof factoryInventoryData !== 'undefined' &&
factoryInventoryData.some(m => String(m.supplierId) === String(entity.id));
const supplierMaterials = isSupplier
? factoryInventoryData.filter(m => String(m.supplierId) === String(entity.id))
: [];
const { jsPDF } = window.jspdf;
const doc = new jsPDF('p', 'mm', 'a4');
const pageW = doc.internal.pageSize.getWidth();
doc.setFillColor(...headerColor);
doc.rect(0, 0, pageW, 22, 'F');
doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.setTextColor(255, 255, 255);
doc.text('GULL AND ZUBAIR NASWAR DEALERS', pageW / 2, 10, { align: 'center' });
doc.setFontSize(9); doc.setFont(undefined, 'normal');
doc.text('Naswar Manufacturers & Dealers', pageW / 2, 17, { align: 'center' });
const rangeName = range === 'all' ? 'All Time' : range === 'today' ? 'Today' :
range === 'week' ? 'This Week' : range === 'month' ? 'This Month' : 'This Year';
doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.setTextColor(50, 50, 50);
doc.text(`Account Statement · ${rangeName}`, pageW / 2, 30, { align: 'center' });
doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(80, 80, 80);
let yPos = 38;
const _entPdfPhoto = await getPersonPhoto('entity:' + String(entity.id));
if (_entPdfPhoto) {
  try {
    const _pdfPhotoX = pageW - 14 - 22;
    doc.addImage(_entPdfPhoto, 'JPEG', _pdfPhotoX, 25, 22, 22);
  } catch(e) {}
}
doc.setFont(undefined, 'bold'); doc.text('Name:', 14, yPos);
doc.setFont(undefined, 'normal'); doc.text(entity.name, 32, yPos);
doc.setFont(undefined, 'bold'); doc.text('Phone:', 14, yPos + 5);
doc.setFont(undefined, 'normal'); doc.text(entity.phone || 'N/A', 32, yPos + 5);
if (entity.wallet) {
doc.setFont(undefined, 'bold'); doc.text('Wallet/Account:', pageW / 2, yPos);
doc.setFont(undefined, 'normal'); doc.text(entity.wallet, pageW / 2 + 30, yPos);
}
doc.setFont(undefined, 'bold'); doc.text('Generated:', pageW / 2, yPos + 5);
doc.setFont(undefined, 'normal');
doc.text(now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), pageW / 2 + 22, yPos + 5);
yPos += 18;
doc.setDrawColor(...headerColor); doc.setLineWidth(0.5);
doc.line(14, yPos, pageW - 14, yPos);
yPos += 5;
if (transactions.length > 0 || priorTxns.length > 0) {
doc.setFontSize(9); doc.setFont(undefined, 'bold'); doc.setTextColor(...headerColor);
doc.text('PAYMENT TRANSACTIONS', 14, yPos);
doc.setTextColor(80, 80, 80); doc.setFont(undefined, 'normal');
yPos += 5;
const mergedTxns  = transactions.filter(t => t.isMerged === true);
const normalTxns  = transactions.filter(t => !t.isMerged);
const buildTxRow = (t, runBal) => {
  const amt = parseFloat(t.amount) || 0;
  const isOut = t.type === 'OUT';
  const isPayableTx = t.isPayable === true;
  runBal.val += isOut ? -amt : amt;
  let balDisplay;
  if (Math.abs(runBal.val) < 0.01) balDisplay = 'SETTLED';
  else balDisplay = fmtAmt(Math.abs(runBal.val));
  let desc = (t.description || '-').substring(0, 35);
  if (isPayableTx && !isOut) desc = '\u21a9 Credit Purchase\n' + desc;
  else if (isPayableTx && isOut) desc = '\u2714 Supplier Pmt\n' + desc;
  const typeLabel = isPayableTx && !isOut ? 'CR' : t.type;
  return [
    formatDisplayDate(t.date),
    desc,
    typeLabel,
    isOut ? fmtAmt(amt) : '-',
    !isOut ? fmtAmt(amt) : '-',
    balDisplay
  ];
};
if (mergedTxns.length > 0) {
  yPos = _pdfDrawMergedSectionHeader(doc, yPos, pageW, 'YEAR-END OPENING BALANCES (Carried Forward)');
  const mergedRunBal = { val: 0 };
  const mergedRows = mergedTxns.map(t => {
    const row = buildTxRow(t, mergedRunBal);
    const ms = t.mergedSummary || {};
    const periodLabel = _pdfMergedPeriodLabel(t);
    const countLabel  = _pdfMergedCountLabel(t);
    const origIn  = ms.originalIn  != null ? 'In: ' + fmtAmt(ms.originalIn) : '';
    const origOut = ms.originalOut != null ? 'Out: ' + fmtAmt(ms.originalOut) : '';
    const summary = [periodLabel, countLabel, origIn, origOut].filter(Boolean).join('\n');
    row[1] = summary.substring(0, 70);
    return row;
  });
  doc.autoTable({
    startY: yPos,
    head: [['Date', 'Year Period / Summary', 'Type', 'Payment OUT', 'Payment IN', 'Balance']],
    body: mergedRows,
    theme: 'grid',
    headStyles: { fillColor: PDF_MERGED_HDR_COLOR, textColor: 255, fontSize: 8.5, fontStyle: 'bold', halign: 'center' },
    styles: { fontSize: 7.5, cellPadding: 2.5, lineWidth: 0.15, lineColor: [200, 180, 230], overflow: 'linebreak' },
    columnStyles: {
      0: { cellWidth: 22, halign: 'center' },
      1: { cellWidth: 55 },
      2: { cellWidth: 13, halign: 'center', fontStyle: 'bold' },
      3: { cellWidth: 28, halign: 'right', fontStyle: 'bold' },
      4: { cellWidth: 28, halign: 'right', fontStyle: 'bold' },
      5: { cellWidth: 30, halign: 'center', fontStyle: 'bold' }
    },
    didParseCell: function(data) {
      data.cell.styles.fillColor = PDF_MERGED_ROW_COLOR;
      data.cell.styles.textColor = [80, 40, 120];
      if (data.column.index === 2)
        data.cell.styles.textColor = data.cell.text[0] === 'OUT' ? [180, 40, 40] : data.cell.text[0] === 'CR' ? [200, 100, 0] : [40, 130, 60];
      if (data.column.index === 3) data.cell.styles.textColor = [180, 40, 40];
      if (data.column.index === 4) data.cell.styles.textColor = [40, 130, 60];
      if (data.column.index === 5) {
        const txt = (data.cell.text||[]).join('');
        data.cell.styles.textColor = txt==='SETTLED'?[100,100,100]:[126,34,206];
      }
    },
    margin: { left: 14, right: 14 }
  });
  yPos = doc.lastAutoTable.finalY + 6;
  if (yPos > 255) { doc.addPage(); yPos = 20; }
}
const hasPriorBalance = periodCutoff !== null && priorTxns.length > 0;
const txRunBal = { val: hasPriorBalance ? openingBalance : 0 };
const txRows = normalTxns.map(t => buildTxRow(t, txRunBal));

if (hasPriorBalance) {
  const obAbs = Math.abs(openingBalance);
  const obDisplay = obAbs < 0.01 ? 'SETTLED' : fmtAmt(obAbs);
  const obLabel = obAbs < 0.01
    ? 'Settled'
    : openingBalance > 0 ? 'Receivable (they owe)' : 'Payable (we owe)';
  txRows.unshift([
    'Prior',
    `Opening Balance\n(All activity before this period)`,
    '—',
    '-',
    '-',
    obDisplay
  ]);
}

const totalOut          = normalTxns.filter(t => t.type === 'OUT').reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
const totalCashIn       = normalTxns.filter(t => t.type === 'IN' && !t.isPayable).reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
const totalCreditPurch  = normalTxns.filter(t => t.type === 'IN' && t.isPayable).reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
const totalIn           = totalCashIn + totalCreditPurch;
const finalBal          = (hasPriorBalance ? openingBalance : 0) + totalIn - totalOut;
let finalBalDisplay;
if (Math.abs(finalBal) < 0.01) finalBalDisplay = 'SETTLED';
else finalBalDisplay = fmtAmt(Math.abs(finalBal));
const openingRowOffset  = hasPriorBalance ? 1 : 0;
if (normalTxns.length > 0 || hasPriorBalance) {
  doc.setFontSize(8.5); doc.setFont(undefined, 'bold');
  doc.setTextColor(...headerColor);
  doc.text('INDIVIDUAL TRANSACTIONS', 14, yPos);
  doc.setTextColor(80, 80, 80); doc.setFont(undefined, 'normal');
  yPos += 5;
  doc.autoTable({
    startY: yPos,
    head: [['Date', 'Description', 'Type', 'Payment OUT', 'Payment IN', 'Running Balance']],
    body: txRows,
    theme: 'grid',
    headStyles: { fillColor: headerColor, textColor: 255, fontSize: 8.5, fontStyle: 'bold', halign: 'center' },
    styles: { fontSize: 7.5, cellPadding: 2.5, lineWidth: 0.15, lineColor: [180, 180, 180], overflow: 'linebreak' },
    columnStyles: {
      0: { cellWidth: 22, halign: 'center' },
      1: { cellWidth: 55 },
      2: { cellWidth: 13, halign: 'center', fontStyle: 'bold' },
      3: { cellWidth: 28, halign: 'right', textColor: [220, 53, 69], fontStyle: 'bold' },
      4: { cellWidth: 28, halign: 'right', textColor: [40, 167, 69], fontStyle: 'bold' },
      5: { cellWidth: 30, halign: 'center', fontStyle: 'bold' }
    },
    didParseCell: function(data) {
      const isOpeningRow = hasPriorBalance && data.row.index === 0;
      if (isOpeningRow) {
        data.cell.styles.fillColor  = [220, 235, 255];
        data.cell.styles.fontStyle  = 'bold';
        data.cell.styles.textColor  = [30, 80, 160];
        data.cell.styles.fontSize   = 8;
      }
      if (!isOpeningRow) {
        if (data.column.index===2)
          data.cell.styles.textColor = data.cell.text[0]==='OUT'?[220,53,69]:data.cell.text[0]==='CR'?[200,100,0]:[40,167,69];
        if (data.column.index===5) {
          const txt=(data.cell.text||[]).join('');
          if (txt.includes('SETTLED')) data.cell.styles.textColor=[100,100,100];
          else if (txt.includes('OWE')) data.cell.styles.textColor=[220,53,69];
          else data.cell.styles.textColor=[40,167,69];
        }
      }
    },
    margin: { left: 14, right: 14 }
  });
}
const afterTx = ((normalTxns.length > 0 || hasPriorBalance) ? doc.lastAutoTable.finalY : yPos - 5) + 5;
if (afterTx < 255) {
doc.setFillColor(245, 245, 245);
const summaryRows = totalCreditPurch > 0 ? 2 : 1;
doc.roundedRect(14, afterTx, pageW - 28, summaryRows * 11 + 3, 2, 2, 'F');
doc.setFontSize(8.5); doc.setFont(undefined, 'normal');
if (hasPriorBalance && Math.abs(openingBalance) >= 0.01) {
  doc.setTextColor(30, 80, 160);
  const obSign = openingBalance > 0 ? '+' : '-';
  doc.text(`Opening Bal: ${obSign}${fmtAmt(Math.abs(openingBalance))}`, 20, afterTx + 9);
  doc.setTextColor(220, 53, 69);
  doc.text(`Period OUT: ${fmtAmt(totalOut)}`, 75, afterTx + 9);
  doc.setTextColor(40, 167, 69);
  doc.text(`Period IN: ${fmtAmt(totalIn)}`, 125, afterTx + 9);
} else {
  doc.setTextColor(220, 53, 69);
  doc.text(`Total OUT: ${fmtAmt(totalOut)}`, 20, afterTx + 9);
  doc.setTextColor(40, 167, 69);
  doc.text(`Cash IN: ${fmtAmt(totalCashIn)}`, 75, afterTx + 9);
}
if (totalCreditPurch > 0) {
doc.setTextColor(200, 100, 0);
doc.text(`Credit Purchases: ${fmtAmt(totalCreditPurch)}`, 20, afterTx + 17);
}
doc.setTextColor(Math.abs(finalBal) < 0.01 ? 100 : finalBal < 0 ? 220 : 40,
Math.abs(finalBal) < 0.01 ? 100 : finalBal < 0 ? 53 : 167,
Math.abs(finalBal) < 0.01 ? 100 : finalBal < 0 ? 69 : 69);
doc.setFont(undefined, 'bold');
doc.text(`Net Balance: ${finalBalDisplay}`, 138, afterTx + 9);
yPos = afterTx + (summaryRows * 11 + 7);
} else {
yPos = afterTx + 5;
}
} else {
doc.setFont(undefined, 'normal'); doc.setFontSize(9); doc.setTextColor(150);
doc.text('No payment transactions recorded for this period.', pageW / 2, yPos + 8, { align: 'center' });
yPos += 15;
}
if (isSupplier && supplierMaterials.length > 0) {
if (yPos > 240) { doc.addPage(); yPos = 20; }
doc.setFontSize(9); doc.setFont(undefined, 'bold'); doc.setTextColor(...headerColor);
doc.text('SUPPLIER INVOICES — RAW MATERIAL PAYABLES', 14, yPos);
doc.setFontSize(7.5); doc.setFont(undefined, 'normal'); doc.setTextColor(120, 120, 120);
doc.text('Each row = one material invoice. Payments are applied FIFO (oldest invoice first).', 14, yPos + 4.5);
doc.setTextColor(80, 80, 80);
yPos += 9;
let totalInvoice = 0, totalPaid = 0, totalRemaining = 0;
const matRows = supplierMaterials
.sort((a, b) => {
const da = toSafeDate(a.purchaseDate || a.date || a.createdAt);
const db = toSafeDate(b.purchaseDate || b.date || b.createdAt);
return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
})
.map(mat => {
const originalAmt = parseFloat((
mat.totalValue ||
(mat.purchaseCost && mat.purchaseQuantity ? mat.purchaseCost * mat.purchaseQuantity : (mat.quantity || 0) * (mat.cost || 0)) ||
0
).toFixed(2));
const remaining = parseFloat(mat.totalPayable || 0);
const paid = Math.max(0, originalAmt - remaining);
totalInvoice += originalAmt;
totalPaid += paid;
totalRemaining += remaining;
const status = mat.paymentStatus === 'paid' || remaining <= 0
? 'PAID'
: remaining < originalAmt
? 'PARTIAL'
: 'PENDING';
const qtyStr = mat.purchaseQuantity && mat.purchaseUnitName && mat.conversionFactor && mat.conversionFactor !== 1
? `${fmtAmt(mat.purchaseQuantity)} ${mat.purchaseUnitName}\n(${fmtAmt(mat.quantity || 0)} kg)`
: `${fmtAmt(mat.quantity || 0)} kg`;
return [
formatDisplayDate(mat.purchaseDate || mat.date || mat.createdAt || '') || '-',
(mat.name || 'Material').substring(0, 25),
qtyStr,
fmtAmt(originalAmt),
paid > 0 ? fmtAmt(paid) : '-',
remaining > 0 ? fmtAmt(remaining) : '-',
status
];
});
doc.autoTable({
startY: yPos,
head: [['Invoice Date', 'Material', 'Qty', 'Invoice Amt', 'Paid So Far', 'Remaining', 'Status']],
body: matRows,
theme: 'grid',
headStyles: { fillColor: headerColor, textColor: 255, fontSize: 8, fontStyle: 'bold', halign: 'center' },
styles: { fontSize: 7.5, cellPadding: 2.5, lineWidth: 0.15, lineColor: [180, 180, 180], overflow: 'linebreak' },
columnStyles: {
0: { cellWidth: 22, halign: 'center' },
1: { cellWidth: 36 },
2: { cellWidth: 24, halign: 'center' },
3: { cellWidth: 27, halign: 'right', fontStyle: 'bold' },
4: { cellWidth: 25, halign: 'right', textColor: [40, 167, 69], fontStyle: 'bold' },
5: { cellWidth: 25, halign: 'right', textColor: [220, 53, 69], fontStyle: 'bold' },
6: { cellWidth: 17, halign: 'center', fontStyle: 'bold' }
},
didParseCell: function(data) {
if (data.column.index === 6) {
const txt = (data.cell.text || []).join('');
if (txt === 'PAID') data.cell.styles.textColor = [40, 167, 69];
if (txt === 'PARTIAL') data.cell.styles.textColor = [200, 100, 0];
if (txt === 'PENDING') data.cell.styles.textColor = [220, 53, 69];
}
},
margin: { left: 14, right: 14 }
});
const afterMat = doc.lastAutoTable.finalY + 5;
if (afterMat < 265) {
doc.setFillColor(255, 245, 230);
doc.roundedRect(14, afterMat, pageW - 28, 14, 2, 2, 'F');
doc.setFontSize(8.5); doc.setFont(undefined, 'normal');
doc.setTextColor(50, 50, 50);
doc.text(`Total Invoiced: ${fmtAmt(totalInvoice)}`, 20, afterMat + 9);
doc.setTextColor(40, 167, 69);
doc.text(`Paid: ${fmtAmt(totalPaid)}`, 88, afterMat + 9);
doc.setTextColor(totalRemaining > 0 ? 220 : 100, totalRemaining > 0 ? 53 : 100, totalRemaining > 0 ? 69 : 100);
doc.setFont(undefined, 'bold');
doc.text(`Outstanding Payable: ${fmtAmt(totalRemaining)}`, 138, afterMat + 9);
}
}
const pageCount = doc.internal.getNumberOfPages();
for (let i = 1; i <= pageCount; i++) {
doc.setPage(i);
doc.setFontSize(7); doc.setTextColor(160);
doc.text(
`Generated on ${now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} at ${now.toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit', hour12: true})} | GULL AND ZUBAIR NASWAR DEALERS`,
pageW / 2, 291, { align: 'center' }
);
doc.text(`Page ${i} of ${pageCount}`, pageW / 2, 287, { align: 'center' });
}
await new Promise(r => setTimeout(r, 100));
const dateStamp  = new Date().toISOString().split('T')[0];
const safeName   = entity.name.replace(/[^a-z0-9]/gi, '_');
if (pageCount === 1) {
  showToast('Single-page statement — converting to image…', 'info');
  await _exportDocAsImageAndOpenWhatsApp(
    doc,
    entity.phone || '',
    `Entity_Statement_${safeName}_${dateStamp}`
  );
} else {
  doc.save(`Entity_Statement_${safeName}_${dateStamp}.pdf`);
  showToast('PDF exported successfully', 'success');
}
} catch (error) {
showToast("Error generating PDF: " + error.message, "error");
}
}

async function exportCustomerToPDF() {
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const titleElement = document.getElementById('manageCustomerTitle');
if (!titleElement) { showToast("No customer selected", "warning"); return; }
const titleHTML = titleElement.innerHTML;
const nameMatch = titleHTML.match(/<span>([^<]+)<\/span>/) || titleHTML.match(/^([^<]+)/);
const customerName = nameMatch ? nameMatch[1].trim() : titleElement.innerText.split('\n')[0].trim();
if (!customerName) { showToast("No customer selected", "warning"); return; }
const rangeSelect = document.getElementById('customerPdfRange');
const range = rangeSelect ? rangeSelect.value : 'all';
showToast("Generating PDF...", "info");
try {
if (!window.jspdf) {
await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js');
await new Promise(r => setTimeout(r, 200));
}
if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("Failed to load PDF library. Please refresh and try again.");
const allCustTxns = customerSales.filter(s => s && s.customerName === customerName);
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
let custPeriodCutoff = null;
if (range !== 'all') {
  switch(range) {
    case 'today':  custPeriodCutoff = today; break;
    case 'week':   { const w = new Date(today); w.setDate(w.getDate() - 7);      custPeriodCutoff = w; break; }
    case 'month':  { const m = new Date(today); m.setMonth(m.getMonth() - 1);    custPeriodCutoff = m; break; }
    case 'year':   { const y = new Date(today); y.setFullYear(y.getFullYear()-1); custPeriodCutoff = y; break; }
  }
}
const custPriorTxns = custPeriodCutoff
  ? allCustTxns.filter(t => {
      if (t.transactionType === 'OLD_DEBT') return true;
      if (!t.date) return false;
      return new Date(t.date) < custPeriodCutoff;
    })
  : [];
let transactions = custPeriodCutoff
  ? allCustTxns.filter(t => {
      if (t.transactionType === 'OLD_DEBT') return false;
      if (!t.date) return false;
      return new Date(t.date) >= custPeriodCutoff;
    })
  : allCustTxns;
const custOpeningBalance = custPriorTxns.reduce((bal, t) => {
  const pt = t.paymentType || 'CASH';
  const isOldDebt = t.transactionType === 'OLD_DEBT';
  let debit = 0, credit = 0;
  if (isOldDebt) {
    debit = parseFloat(t.totalValue) || 0;
    credit = parseFloat(t.partialPaymentReceived) || 0;
  } else if (pt === 'CASH' || (pt === 'CREDIT' && t.creditReceived)) {
  } else if (pt === 'CREDIT' && !t.creditReceived) {
    debit = parseFloat(t.totalValue) || 0;
    credit = parseFloat(t.partialPaymentReceived) || 0;
  } else if (pt === 'COLLECTION' || pt === 'PARTIAL_PAYMENT') {
    credit = parseFloat(t.totalValue) || 0;
  }
  return bal + (debit - credit);
}, 0);
const _custEffDate = (t) => {
const pt = t.paymentType || 'CASH';
if (t.transactionType === 'OLD_DEBT') return new Date(0);
if (pt === 'COLLECTION' || pt === 'PARTIAL_PAYMENT' || (pt === 'CREDIT' && t.creditReceived)) {
return new Date(t.creditReceivedDate || t.date || 0);
}
return new Date(t.supplyDate || t.date || 0);
};
transactions.sort((a, b) => {
if (a.isMerged && !b.isMerged) return -1;
if (!a.isMerged && b.isMerged) return 1;
if (a.transactionType === 'OLD_DEBT' && b.transactionType !== 'OLD_DEBT') return -1;
if (a.transactionType !== 'OLD_DEBT' && b.transactionType === 'OLD_DEBT') return 1;
return _custEffDate(a) - _custEffDate(b);
});
const salesContact = salesCustomers.find(c => c && c.name && c.name.toLowerCase() === customerName.toLowerCase());
const phone = salesContact?.phone || transactions.find(t => t.customerPhone)?.customerPhone || 'N/A';
const address = salesContact?.address || transactions.find(t => t.customerAddress)?.customerAddress || 'N/A';
const { jsPDF } = window.jspdf;
const doc = new jsPDF('p', 'mm', 'a4');
const pageW = doc.internal.pageSize.getWidth();
const hdrColor = [40, 167, 69];
doc.setFillColor(...hdrColor);
doc.rect(0, 0, pageW, 22, 'F');
doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.setTextColor(255, 255, 255);
doc.text('GULL AND ZUBAIR NASWAR DEALERS', pageW / 2, 10, { align: 'center' });
doc.setFontSize(9); doc.setFont(undefined, 'normal');
doc.text('Naswar Manufacturers & Dealers', pageW / 2, 17, { align: 'center' });
const rangeName = range === 'all' ? 'All Time' : range === 'today' ? 'Today' :
range === 'week' ? 'This Week' : range === 'month' ? 'This Month' : 'This Year';
doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.setTextColor(50, 50, 50);
doc.text(`Customer Account Statement · ${rangeName}`, pageW / 2, 30, { align: 'center' });
doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(80, 80, 80);
let yPos = 38;
const _custPdfPhoto = await getPersonPhoto('cust:' + customerName.toLowerCase());
if (_custPdfPhoto) {
  try { doc.addImage(_custPdfPhoto, 'JPEG', pageW - 14 - 22, 25, 22, 22); } catch(e) {}
}
doc.setFont(undefined, 'bold'); doc.text('Customer:', 14, yPos);
doc.setFont(undefined, 'normal'); doc.text(customerName, 36, yPos);
doc.setFont(undefined, 'bold'); doc.text('Phone:', 14, yPos + 5);
doc.setFont(undefined, 'normal'); doc.text(phone, 36, yPos + 5);
doc.setFont(undefined, 'bold'); doc.text('Address:', 14, yPos + 10);
doc.setFont(undefined, 'normal'); doc.text(address.substring(0, 60), 36, yPos + 10);
doc.setFont(undefined, 'bold'); doc.text('Generated:', pageW / 2, yPos);
doc.setFont(undefined, 'normal');
doc.text(now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), pageW / 2 + 22, yPos);
yPos += 18;
doc.setDrawColor(...hdrColor); doc.setLineWidth(0.5);
doc.line(14, yPos, pageW - 14, yPos);
yPos += 5;
if (transactions.length > 0) {
const getSalePrice = async (t) => {
  if (t.unitPrice && t.unitPrice > 0) return t.unitPrice;
  return await getEffectiveSalePriceForCustomer(t.customerName, t.supplyStore || 'STORE_A');
};
const buildSaleRow = async (t, runBal) => {
  const pt = t.paymentType || 'CASH';
  const isOldDebt = t.transactionType === 'OLD_DEBT';
  let debit = 0, credit = 0, typeLabel = '', detailLabel = '', displayDate = formatDisplayDate(t.supplyDate || t.date);
  if (isOldDebt) {
    debit = parseFloat(t.totalValue) || 0;
    credit = parseFloat(t.partialPaymentReceived) || 0;
    typeLabel = 'OLD DEBT';
    detailLabel = t.notes || 'Brought forward from previous records';
    displayDate = formatDisplayDate(t.date);
  } else if (pt === 'CASH') {
    const val = await getSaleTransactionValue(t);
    debit = val; credit = val;
    typeLabel = 'CASH';
    detailLabel = `${fmtAmt(t.quantity||0)} kg \xd7 ${fmtAmt(await getSalePrice(t))}\n${t.supplyStore?getStoreLabel(t.supplyStore):''}`;
  } else if (pt === 'CREDIT' && !t.creditReceived) {
    const val = await getSaleTransactionValue(t);
    const partial = parseFloat(t.partialPaymentReceived) || 0;
    debit = val; credit = partial;
    typeLabel = partial > 0 ? 'CREDIT\n(PARTIAL)' : 'CREDIT';
    detailLabel = `${fmtAmt(t.quantity||0)} kg \xd7 ${fmtAmt(await getSalePrice(t))}`;
    if (partial > 0) detailLabel += `\nPaid: ${fmtAmt(partial)} | Due: ${fmtAmt(val-partial)}`;
  } else if (pt === 'CREDIT' && t.creditReceived) {
    const val = await getSaleTransactionValue(t);
    debit = val; credit = val;
    typeLabel = 'CREDIT\n(PAID)';
    detailLabel = `${fmtAmt(t.quantity||0)} kg \xd7 ${fmtAmt(await getSalePrice(t))}`;
    displayDate = formatDisplayDate(t.creditReceivedDate || t.supplyDate || t.date);
  } else if (pt === 'COLLECTION') {
    credit = parseFloat(t.totalValue) || 0;
    typeLabel = 'COLLECTION';
    detailLabel = 'Cash payment received';
    displayDate = formatDisplayDate(t.creditReceivedDate || t.date);
  } else if (pt === 'PARTIAL_PAYMENT') {
    credit = parseFloat(t.totalValue) || 0;
    typeLabel = 'PARTIAL\nPAYMENT';
    detailLabel = 'Partial payment received';
    displayDate = formatDisplayDate(t.creditReceivedDate || t.date);
  }
  runBal.val += (debit - credit);
  let balDisplay;
  if (Math.abs(runBal.val) < 0.01) balDisplay = 'SETTLED';
  else if (runBal.val > 0) balDisplay = fmtAmt(runBal.val);
  else balDisplay = 'OVERPAID\n' + fmtAmt(Math.abs(runBal.val));
  return { row: [displayDate, typeLabel, detailLabel.substring(0,55),
    debit>0?fmtAmt(debit):'-', credit>0?fmtAmt(credit):'-', balDisplay],
    debit, credit, qty: t.quantity||0 };
};
const mergedSalesTxns = transactions.filter(t => t.isMerged === true);
const normalSalesTxns = transactions.filter(t => !t.isMerged);
if (mergedSalesTxns.length > 0) {
  yPos = _pdfDrawMergedSectionHeader(doc, yPos, pageW, 'YEAR-END OPENING BALANCES (Carried Forward)');
  const mRunBal = { val: 0 };
  const mergedRows = mergedSalesTxns.map(t => {
    const ms = t.mergedSummary || {};
    const periodLabel = _pdfMergedPeriodLabel(t);
    const countLabel  = _pdfMergedCountLabel(t);
    const isSettled = ms.isSettled || t.creditReceived;
    const netOut = ms.netOutstanding != null ? ms.netOutstanding : (t.totalValue || 0);
    const cashS  = ms.cashSales != null ? ms.cashSales : 0;
    const details = [
      periodLabel,
      countLabel,
      cashS > 0 ? `Cash sales: ${fmtAmt(cashS)}` : '',
      !isSettled ? `Net due: ${fmtAmt(netOut)}` : 'Settled'
    ].filter(Boolean).join('\n');
    mRunBal.val += netOut;
    const balTxt = isSettled ? 'SETTLED' : fmtAmt(netOut);
    const pt = t.paymentType || 'CASH';
    const typeLabel = isSettled ? 'SETTLED\n(MERGED)' : (pt === 'CREDIT' ? 'CREDIT\n(MERGED)' : 'CASH\n(MERGED)');
    return [formatDisplayDate(t.date), typeLabel, details.substring(0,70),
      netOut>0?fmtAmt(netOut):'-', isSettled?fmtAmt(cashS):'-', balTxt];
  });
  doc.autoTable({
    startY: yPos,
    head: [['Date', 'Type', 'Year Period / Summary', 'Outstanding', 'Settled', 'Balance']],
    body: mergedRows,
    theme: 'grid',
    headStyles: { fillColor: PDF_MERGED_HDR_COLOR, textColor: 255, fontSize: 8.5, fontStyle: 'bold', halign: 'center' },
    styles: { fontSize: 7.5, cellPadding: 2.5, lineWidth: 0.15, lineColor: [200, 180, 230], overflow: 'linebreak' },
    columnStyles: {
      0:{cellWidth:22,halign:'center'},1:{cellWidth:22,halign:'center',fontStyle:'bold'},
      2:{cellWidth:52},3:{cellWidth:27,halign:'right',fontStyle:'bold'},
      4:{cellWidth:27,halign:'right',fontStyle:'bold'},5:{cellWidth:26,halign:'center',fontStyle:'bold'}
    },
    didParseCell: function(data) {
      data.cell.styles.fillColor=PDF_MERGED_ROW_COLOR; data.cell.styles.textColor=[80,40,120];
      if (data.column.index===3) data.cell.styles.textColor=[180,40,40];
      if (data.column.index===4) data.cell.styles.textColor=[40,130,60];
      if (data.column.index===5) {
        const txt=(data.cell.text||[]).join('');
        data.cell.styles.textColor = txt==='SETTLED'?[100,100,100]:[126,34,206];
      }
    },
    margin: { left: 14, right: 14 }
  });
  yPos = doc.lastAutoTable.finalY + 6;
  if (yPos > 255) { doc.addPage(); yPos = 20; }
}
const custHasPrior = custPeriodCutoff !== null && custPriorTxns.length > 0;
const txRunBal = { val: custHasPrior ? custOpeningBalance : 0 };
const txRows = [];
let totDebit = 0, totCredit = 0, totQty = 0;
for (const t of normalSalesTxns) {
  const r = await buildSaleRow(t, txRunBal);
  txRows.push(r.row);
  totDebit  += r.debit;
  totCredit += r.credit;
  totQty    += r.qty;
}
if (custHasPrior) {
  const obAbs = Math.abs(custOpeningBalance);
  const obDisplay = obAbs < 0.01 ? 'SETTLED' : fmtAmt(obAbs);
  txRows.unshift([
    'Prior', '—',
    'Opening Balance\n(All activity before this period)',
    '-', '-', obDisplay
  ]);
}
const finalBal = (custHasPrior ? custOpeningBalance : 0) + totDebit - totCredit;
if (normalSalesTxns.length > 0 || custHasPrior) {
  doc.setFontSize(8.5); doc.setFont(undefined,'bold');
  doc.setTextColor(...hdrColor);
  doc.text('INDIVIDUAL TRANSACTIONS', 14, yPos);
  doc.setTextColor(80,80,80); doc.setFont(undefined,'normal');
  yPos += 5;
  doc.autoTable({
    startY: yPos,
    head: [['Date', 'Type', 'Details', 'Debit (Sale)', 'Credit (Rcvd)', 'Balance']],
    body: txRows,
    theme: 'grid',
    headStyles: { fillColor: hdrColor, textColor: 255, fontSize: 8.5, fontStyle: 'bold', halign: 'center' },
    styles: { fontSize: 7.5, cellPadding: 2.5, lineWidth: 0.15, lineColor: [180,180,180], overflow: 'linebreak' },
    columnStyles: {
      0:{cellWidth:22,halign:'center'},1:{cellWidth:22,halign:'center',fontStyle:'bold'},
      2:{cellWidth:52},3:{cellWidth:27,halign:'right',textColor:[220,53,69],fontStyle:'bold'},
      4:{cellWidth:27,halign:'right',textColor:[40,167,69],fontStyle:'bold'},5:{cellWidth:26,halign:'center',fontStyle:'bold'}
    },
    didParseCell: function(data) {
      const isOpeningRow = custHasPrior && data.row.index === 0;
      if (isOpeningRow) {
        data.cell.styles.fillColor = [220, 235, 255];
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.textColor = [30, 80, 160];
        data.cell.styles.fontSize  = 8;
      }
      if (!isOpeningRow) {
        if (data.column.index===1){
          const txt=(data.cell.text||[]).join('');
          if(txt.includes('CASH')) data.cell.styles.textColor=[40,167,69];
          if(txt.includes('CREDIT')) data.cell.styles.textColor=[200,100,0];
          if(txt.includes('COLLECTION')) data.cell.styles.textColor=[40,167,69];
          if(txt.includes('PARTIAL')) data.cell.styles.textColor=[200,100,0];
          if(txt.includes('OLD DEBT')) data.cell.styles.textColor=[220,53,69];
        }
        if (data.column.index===5){
          const txt=(data.cell.text||[]).join('');
          if(txt==='SETTLED') data.cell.styles.textColor=[100,100,100];
          else if(txt.includes('OVERPAID')) data.cell.styles.textColor=[40,167,69];
          else data.cell.styles.textColor=[220,53,69];
        }
      }
    },
    margin: { left: 14, right: 14 }
  });
}
const afterY = ((normalSalesTxns.length > 0 || custHasPrior) ? doc.lastAutoTable.finalY : yPos - 5) + 5;
if (afterY < 252) {
const custSummaryH = custHasPrior && Math.abs(custOpeningBalance) >= 0.01 ? 28 : 20;
doc.setFillColor(245, 255, 245);
doc.roundedRect(14, afterY, pageW - 28, custSummaryH, 2, 2, 'F');
doc.setDrawColor(...hdrColor); doc.setLineWidth(0.3);
doc.roundedRect(14, afterY, pageW - 28, custSummaryH, 2, 2, 'S');
doc.setFontSize(8); doc.setFont(undefined, 'normal');
if (custHasPrior && Math.abs(custOpeningBalance) >= 0.01) {
  const obSign = custOpeningBalance > 0 ? '+' : '-';
  doc.setTextColor(30, 80, 160);
  doc.text(`Opening Balance: ${obSign}${fmtAmt(Math.abs(custOpeningBalance))}`, pageW / 2, afterY + 7, { align: 'center' });
  doc.setTextColor(220, 53, 69);
  doc.text(`Period Debit: ${fmtAmt(totDebit)}`, pageW / 4, afterY + 15, { align: 'center' });
  doc.setTextColor(40, 167, 69);
  doc.text(`Period Credit: ${fmtAmt(totCredit)}`, (pageW * 3) / 4, afterY + 15, { align: 'center' });
} else {
  doc.setTextColor(220, 53, 69);
  doc.text(`Total Debit (Sales): ${fmtAmt(totDebit)}`, pageW / 4, afterY + 8, { align: 'center' });
  doc.setTextColor(40, 167, 69);
  doc.text(`Total Credit (Rcvd): ${fmtAmt(totCredit)}`, (pageW * 3) / 4, afterY + 8, { align: 'center' });
}
doc.setTextColor(Math.abs(finalBal) < 0.01 ? 100 : finalBal > 0 ? 220 : 40,
Math.abs(finalBal) < 0.01 ? 100 : finalBal > 0 ? 53 : 167,
Math.abs(finalBal) < 0.01 ? 100 : finalBal > 0 ? 69 : 69);
doc.setFont(undefined, 'bold');
const balStr = Math.abs(finalBal) < 0.01 ? 'SETTLED'
: finalBal > 0 ? `Outstanding Due: ${fmtAmt(finalBal)}`
: `Overpaid by: ${fmtAmt(Math.abs(finalBal))}`;
doc.text(balStr, pageW / 2, afterY + (custHasPrior && Math.abs(custOpeningBalance) >= 0.01 ? 23 : 15), { align: 'center' });
}
} else {
doc.setFont(undefined, 'normal'); doc.setFontSize(10); doc.setTextColor(150);
doc.text('No sales recorded for this period.', pageW / 2, yPos + 15, { align: 'center' });
}
const pageCount = doc.internal.getNumberOfPages();
for (let i = 1; i <= pageCount; i++) {
doc.setPage(i);
doc.setFontSize(7); doc.setTextColor(160);
doc.text(
`Generated on ${now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} at ${now.toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit', hour12: true})} | GULL AND ZUBAIR NASWAR DEALERS`,
pageW / 2, 291, { align: 'center' }
);
doc.text(`Page ${i} of ${pageCount}`, pageW / 2, 287, { align: 'center' });
}
await new Promise(r => setTimeout(r, 100));
const dateStamp    = new Date().toISOString().split('T')[0];
const safeCustName = customerName.replace(/[^a-z0-9]/gi, '_');
if (pageCount === 1) {
  showToast('Single-page statement — converting to image…', 'info');
  await _exportDocAsImageAndOpenWhatsApp(
    doc,
    phone,
    `Customer_Statement_${safeCustName}_${dateStamp}`
  );
} else {
  doc.save(`Customer_Statement_${safeCustName}_${dateStamp}.pdf`);
  showToast('PDF exported successfully', 'success');
}
} catch (error) {
showToast("Error generating PDF: " + error.message, "error");
}
}
const SCRIPT_INTEGRITY = {
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js':
    'sha256-4C8gBRoAE0XFxW0C7SsQ+X/TBkHSFM3YMwVaF4F8hk=',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js':
    'sha256-0ZQJSA5vPBL+6L5uyIjovZ/m7VBpAOUGc7BHOH/RBHE='
};
const _scriptLoadPromises = {};

let _photoCaptureTarget = null;
let _photoCaptureStream = null;

function _photoIds(prefix) {
  return {
    preview: prefix + '-photo-preview',
    placeholder: prefix + '-photo-placeholder',
    img: prefix + '-photo-img',
    clearBtn: prefix + '-photo-clear-btn',
    fileInput: prefix + '-photo-file',
  };
}

function handlePersonPhotoFile(event, prefix) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => applyPersonPhoto(prefix, e.target.result);
  reader.readAsDataURL(file);
  event.target.value = '';
}

function applyPersonPhoto(prefix, dataUrl) {
  const ids = _photoIds(prefix);
  const ph = document.getElementById(ids.placeholder);
  const img = document.getElementById(ids.img);
  const clearBtn = document.getElementById(ids.clearBtn);
  if (ph) ph.style.display = 'none';
  if (img) { img.src = dataUrl; img.style.display = 'block'; }
  if (clearBtn) clearBtn.style.display = '';
  const preview = document.getElementById(ids.preview);
  if (preview) preview.dataset.pendingPhoto = dataUrl;
}

function clearPersonPhoto(prefix) {
  const ids = _photoIds(prefix);
  const ph = document.getElementById(ids.placeholder);
  const img = document.getElementById(ids.img);
  const clearBtn = document.getElementById(ids.clearBtn);
  if (ph) ph.style.display = '';
  if (img) { img.src = ''; img.style.display = 'none'; }
  if (clearBtn) clearBtn.style.display = 'none';
  const preview = document.getElementById(ids.preview);
  if (preview) { preview.dataset.pendingPhoto = ''; preview.dataset.existingPhotoKey = ''; }
}

async function loadPersonPhotoIntoEditor(prefix, storageKey) {
  const ids = _photoIds(prefix);
  const preview = document.getElementById(ids.preview);
  if (preview) { preview.dataset.pendingPhoto = ''; preview.dataset.existingPhotoKey = storageKey || ''; }
  clearPersonPhoto(prefix);
  if (!storageKey) return;
  try {
    const stored = await sqliteStore.get('person_photos');
    const photos = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    const dataUrl = photos[storageKey];
    if (dataUrl) applyPersonPhoto(prefix, dataUrl);
  } catch(e) {}
}

async function savePersonPhoto(prefix, storageKey) {
  if (!storageKey) return;
  const ids = _photoIds(prefix);
  const preview = document.getElementById(ids.preview);
  if (!preview) return;
  const pending = preview.dataset.pendingPhoto;
  if (pending === undefined) return;
  try {
    const stored = await sqliteStore.get('person_photos');
    const photos = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    const timestamps = (await sqliteStore.get('person_photos_timestamps')) || {};
    const now = Date.now();
    if (pending) {
      const compressed = await _compressPhoto(pending, 1600, 0.88);
      photos[storageKey] = compressed;
      timestamps[storageKey] = now; // record local write time for future conflict resolution
    } else {
      delete photos[storageKey];
      delete timestamps[storageKey];
    }
    await sqliteStore.set('person_photos', photos);
    await sqliteStore.set('person_photos_timestamps', timestamps);
    const _dirtyKeys = (await sqliteStore.get('person_photos_dirty_keys')) || [];
    if (!_dirtyKeys.includes(storageKey)) _dirtyKeys.push(storageKey);
    await sqliteStore.set('person_photos_dirty_keys', _dirtyKeys);
    await sqliteStore.set('person_photos_timestamp', now);
    if (typeof triggerAutoSync === 'function') { try { triggerAutoSync(); } catch(_) {} }
  } catch(e) { console.warn('Photo save failed', e); }
}

async function getPersonPhoto(storageKey) {
  if (!storageKey) return null;
  try {
    const stored = await sqliteStore.get('person_photos');
    const photos = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    return photos[storageKey] || null;
  } catch(e) { return null; }
}

async function _compressPhoto(dataUrl, maxDim, quality) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
        else { w = Math.round(w * maxDim / h); h = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function openPhotoCapture(prefix) {
  _photoCaptureTarget = prefix;
  const modal = document.getElementById('photo-capture-modal');
  const video = document.getElementById('photo-capture-video');
  if (!modal || !video) return;
  modal.style.display = 'flex';
  const torchBtn = document.getElementById('torch-btn');
  if (torchBtn) { torchBtn.style.color = 'var(--text-muted)'; torchBtn.style.background = 'none'; }
  window._torchOn = false;
  try {
    _photoCaptureStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width:  { ideal: 4096 },
        height: { ideal: 4096 }
      },
      audio: false
    });
    video.srcObject = _photoCaptureStream;
    const track = _photoCaptureStream.getVideoTracks()[0];
    const caps = track && track.getCapabilities ? track.getCapabilities() : {};
    if (torchBtn) torchBtn.style.display = caps.torch ? 'flex' : 'none';
  } catch(e) {
    modal.style.display = 'none';
    showToast('Camera not available. Please use Gallery instead.', 'warning');
  }
}

function closePhotoCapture() {
  const modal = document.getElementById('photo-capture-modal');
  const video = document.getElementById('photo-capture-video');
  if (modal) modal.style.display = 'none';
  if (_photoCaptureStream) {
    try {
      const track = _photoCaptureStream.getVideoTracks()[0];
      if (track && track.applyConstraints) track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
    } catch(_) {}
    _photoCaptureStream.getTracks().forEach(t => t.stop());
    _photoCaptureStream = null;
  }
  if (video) video.srcObject = null;
  window._torchOn = false;
  _photoCaptureTarget = null;
}

async function toggleTorch() {
  if (!_photoCaptureStream) return;
  const track = _photoCaptureStream.getVideoTracks()[0];
  if (!track) return;
  window._torchOn = !window._torchOn;
  try {
    await track.applyConstraints({ advanced: [{ torch: window._torchOn }] });
    const btn = document.getElementById('torch-btn');
    if (btn) {
      btn.style.color = window._torchOn ? '#f59e0b' : 'var(--text-muted)';
      btn.style.background = window._torchOn ? 'rgba(245,158,11,0.15)' : 'none';
      btn.style.borderColor = window._torchOn ? '#f59e0b' : 'var(--glass-border)';
    }
  } catch(e) {
    showToast('Flashlight not supported on this device', 'warning');
    window._torchOn = false;
  }
}

function capturePhotoFromCamera() {
  const video = document.getElementById('photo-capture-video');
  const canvas = document.getElementById('photo-capture-canvas');
  if (!video || !canvas || !_photoCaptureTarget) return;
  const w = video.videoWidth  || 1920;
  const h = video.videoHeight || 1080;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, 0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
  const target = _photoCaptureTarget;
  closePhotoCapture();
  if (target === 'expense') {
    _applyExpensePendingPhoto(dataUrl);
  } else {
    applyPersonPhoto(target, dataUrl);
  }
}

window._expensePendingPhoto = null;

function openExpensePhotoCapture() {
  openPhotoCapture('expense');
}

function handleExpensePhotoFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => _applyExpensePendingPhoto(e.target.result);
  reader.readAsDataURL(file);
  event.target.value = '';
}

function _applyExpensePendingPhoto(dataUrl) {
  window._expensePendingPhoto = dataUrl;
  const dot = document.getElementById('expense-photo-dot');
  const btn = document.getElementById('expense-photo-btn');
  if (dot) dot.style.display = dataUrl ? '' : 'none';
  if (btn) {
    btn.style.borderColor = dataUrl ? 'var(--accent)' : 'var(--glass-border)';
    btn.title = dataUrl ? 'Photo attached — click to replace' : 'Attach photo';
  }
}

function renderPersonAvatarHTML(photoDataUrl, size) {
  const sz = size || 44;
  if (photoDataUrl) {
    const safe = photoDataUrl.replace(/'/g, '&#39;');
    return `<div class="person-avatar-ring" style="width:${sz}px;height:${sz}px;cursor:pointer;position:relative;" onclick="openPhotoLightbox('${safe}')" title="View photo"><img src="${photoDataUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;"><div style="position:absolute;inset:0;border-radius:50%;background:rgba(0,0,0,0);transition:background 0.15s;" onmouseover="this.style.background='rgba(0,0,0,0.18)'" onmouseout="this.style.background='rgba(0,0,0,0)'"></div></div>`;
  }
  return `<div class="person-avatar-ring" style="width:${sz}px;height:${sz}px;"><svg width="${Math.round(sz*0.5)}" height="${Math.round(sz*0.5)}" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="18" cy="13" r="6" fill="currentColor"/><path d="M6 30c0-6.627 5.373-10 12-10s12 3.373 12 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg></div>`;
}

(function() {
  let _lbScale = 1, _lbMinScale = 1, _lbMaxScale = 6;
  let _lbTransX = 0, _lbTransY = 0;
  let _lbDragging = false, _lbLastX = 0, _lbLastY = 0;
  let _lbPinchDist = 0, _lbPinchMidX = 0, _lbPinchMidY = 0;
  let _lbLastTap = 0;

  function _lbApply(animated) {
    const img = document.getElementById('photo-lightbox-img');
    if (!img) return;
    img.style.transition = animated ? 'transform 0.22s cubic-bezier(0.25,0.46,0.45,0.94)' : 'none';
    img.style.transform = `translate(${_lbTransX}px, ${_lbTransY}px) scale(${_lbScale})`;
    img.style.cursor = _lbScale > 1 ? 'grab' : 'default';
    const lbl = document.getElementById('photo-lb-zoom-label');
    if (lbl) lbl.textContent = _lbScale.toFixed(1).replace('.0','') + '×';
  }

  function _lbClamp() {
    const img = document.getElementById('photo-lightbox-img');
    if (!img) return;
    const iw = img.offsetWidth * _lbScale, ih = img.offsetHeight * _lbScale;
    const vw = window.innerWidth, vh = window.innerHeight;
    const maxX = Math.max(0, (iw - vw) / 2);
    const maxY = Math.max(0, (ih - vh) / 2);
    _lbTransX = Math.max(-maxX, Math.min(maxX, _lbTransX));
    _lbTransY = Math.max(-maxY, Math.min(maxY, _lbTransY));
  }

  window._lbZoom = function(dir) {
    const step = 0.5;
    _lbScale = Math.max(_lbMinScale, Math.min(_lbMaxScale, _lbScale + dir * step));
    if (_lbScale === _lbMinScale) { _lbTransX = 0; _lbTransY = 0; }
    _lbClamp();
    _lbApply(true);
  };

  window._lbResetZoom = function() {
    _lbScale = 1; _lbTransX = 0; _lbTransY = 0;
    _lbApply(true);
  };

  window.openPhotoLightbox = function(src) {
    const modal = document.getElementById('photo-lightbox-modal');
    const img   = document.getElementById('photo-lightbox-img');
    if (!modal || !img) return;
    _lbScale = 1; _lbTransX = 0; _lbTransY = 0;
    img.src = src;
    img.style.transform = 'translate(0,0) scale(1)';
    img.style.transition = 'none';
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    const lbl = document.getElementById('photo-lb-zoom-label');
    if (lbl) lbl.textContent = '1×';
    _lbBindEvents(modal, img);
  };

  window.closePhotoLightbox = function() {
    const modal = document.getElementById('photo-lightbox-modal');
    if (modal) {
      modal.style.display = 'none';
      _lbUnbindEvents(modal);
    }
    document.body.style.overflow = '';
    _lbScale = 1; _lbTransX = 0; _lbTransY = 0;
  };

  function _onWheel(e) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    _lbScale = Math.max(_lbMinScale, Math.min(_lbMaxScale, _lbScale * factor));
    if (_lbScale === _lbMinScale) { _lbTransX = 0; _lbTransY = 0; }
    _lbClamp();
    _lbApply(false);
  }

  function _onMouseDown(e) {
    if (_lbScale <= 1) return;
    _lbDragging = true;
    _lbLastX = e.clientX; _lbLastY = e.clientY;
    const img = document.getElementById('photo-lightbox-img');
    if (img) img.style.cursor = 'grabbing';
  }
  function _onMouseMove(e) {
    if (!_lbDragging) return;
    _lbTransX += e.clientX - _lbLastX;
    _lbTransY += e.clientY - _lbLastY;
    _lbLastX = e.clientX; _lbLastY = e.clientY;
    _lbClamp();
    _lbApply(false);
  }
  function _onMouseUp() {
    _lbDragging = false;
    const img = document.getElementById('photo-lightbox-img');
    if (img) img.style.cursor = _lbScale > 1 ? 'grab' : 'default';
  }

  function _pinchDist(t) {
    return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  }
  function _pinchMid(t) {
    return { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 };
  }

  function _onTouchStart(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      _lbPinchDist = _pinchDist(e.touches);
      const m = _pinchMid(e.touches);
      _lbPinchMidX = m.x; _lbPinchMidY = m.y;
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - _lbLastTap < 280) {
        _lbScale === 1 ? (_lbScale = 2.5) : (_lbScale = 1, _lbTransX = 0, _lbTransY = 0);
        _lbClamp();
        _lbApply(true);
        _lbLastTap = 0;
      } else {
        _lbLastTap = now;
        if (_lbScale > 1) {
          _lbDragging = true;
          _lbLastX = e.touches[0].clientX;
          _lbLastY = e.touches[0].clientY;
        }
      }
    }
  }

  function _onTouchMove(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      const newDist = _pinchDist(e.touches);
      const delta = newDist / _lbPinchDist;
      _lbPinchDist = newDist;
      _lbScale = Math.max(_lbMinScale, Math.min(_lbMaxScale, _lbScale * delta));
      if (_lbScale === _lbMinScale) { _lbTransX = 0; _lbTransY = 0; }
      _lbClamp();
      _lbApply(false);
    } else if (e.touches.length === 1 && _lbDragging) {
      e.preventDefault();
      _lbTransX += e.touches[0].clientX - _lbLastX;
      _lbTransY += e.touches[0].clientY - _lbLastY;
      _lbLastX = e.touches[0].clientX;
      _lbLastY = e.touches[0].clientY;
      _lbClamp();
      _lbApply(false);
    }
  }

  function _onTouchEnd(e) {
    if (e.touches.length < 2) _lbPinchDist = 0;
    if (e.touches.length === 0) _lbDragging = false;
  }

  function _onBackdropClick(e) {
    if (e.target === document.getElementById('photo-lightbox-modal') ||
        e.target === document.getElementById('photo-lightbox-inner')) {
      closePhotoLightbox();
    }
  }

  function _lbBindEvents(modal, img) {
    modal.addEventListener('wheel',      _onWheel,      { passive: false });
    modal.addEventListener('mousedown',  _onMouseDown);
    modal.addEventListener('mousemove',  _onMouseMove);
    modal.addEventListener('mouseup',    _onMouseUp);
    modal.addEventListener('touchstart', _onTouchStart, { passive: false });
    modal.addEventListener('touchmove',  _onTouchMove,  { passive: false });
    modal.addEventListener('touchend',   _onTouchEnd);
    modal.addEventListener('click',      _onBackdropClick);
    window._lbKeyHandler = (e) => {
      if (e.key === 'Escape') closePhotoLightbox();
      if (e.key === '+' || e.key === '=') _lbZoom(1);
      if (e.key === '-') _lbZoom(-1);
      if (e.key === '0') _lbResetZoom();
    };
    document.addEventListener('keydown', window._lbKeyHandler);
  }

  function _lbUnbindEvents(modal) {
    modal.removeEventListener('wheel',      _onWheel);
    modal.removeEventListener('mousedown',  _onMouseDown);
    modal.removeEventListener('mousemove',  _onMouseMove);
    modal.removeEventListener('mouseup',    _onMouseUp);
    modal.removeEventListener('touchstart', _onTouchStart);
    modal.removeEventListener('touchmove',  _onTouchMove);
    modal.removeEventListener('touchend',   _onTouchEnd);
    modal.removeEventListener('click',      _onBackdropClick);
    if (window._lbKeyHandler) {
      document.removeEventListener('keydown', window._lbKeyHandler);
      window._lbKeyHandler = null;
    }
  }
})();

function previewPhotoClick(prefix) {
  const img = document.getElementById(prefix + '-photo-img');
  if (img && img.style.display !== 'none' && img.src && img.src !== window.location.href) {
    openPhotoLightbox(img.src);
  } else {
    document.getElementById(prefix + '-photo-file').click();
  }
}

function loadScript(url, integrity) {
  const existing = document.querySelector('script[src="' + url + '"]');
  if (existing && !existing.dataset.failed) {
    if (_scriptLoadPromises[url]) return _scriptLoadPromises[url];
    return Promise.resolve();
  }
  if (_scriptLoadPromises[url]) return _scriptLoadPromises[url];
  _scriptLoadPromises[url] = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    const sri = integrity || SCRIPT_INTEGRITY[url];
    if (sri) {
      script.integrity = sri;
      script.crossOrigin = 'anonymous';
    }
    script.onload = () => {
      delete _scriptLoadPromises[url];
      resolve();
    };
    script.onerror = () => {
      script.dataset.failed = '1';
      document.head.removeChild(script);
      delete _scriptLoadPromises[url];
      if (sri) {
        const fallback = document.createElement('script');
        fallback.src = url;
        fallback.crossOrigin = 'anonymous';
        fallback.onload = () => resolve();
        fallback.onerror = () => reject(new Error('Failed to load: ' + url));
        document.head.appendChild(fallback);
      } else {
        reject(new Error('Failed to load: ' + url));
      }
    };
    document.head.appendChild(script);
  });
  return _scriptLoadPromises[url];
}
const SarimChart = (() => {
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }
  function _fmt(v) { return typeof fmtAmt === 'function' ? fmtAmt(+v || 0) : Math.round(+v || 0).toLocaleString(); }
  function _short(v) {
    v = +v || 0;
    if (v >= 1e6) return (v/1e6).toFixed(1)+'M';
    if (v >= 1e3) return (v/1e3).toFixed(0)+'k';
    return Math.round(v).toString();
  }
  let _bodyTip = null;
  function _getBodyTip() {
    if (!_bodyTip || !_bodyTip.isConnected) {
      _bodyTip = document.createElement('div');
      _bodyTip.className = 'sc-tooltip';
      _bodyTip.style.cssText = 'display:none;position:fixed;pointer-events:none;z-index:10002;';
      document.body.appendChild(_bodyTip);
    }
    return _bodyTip;
  }
  function _bindTips(host) {
    host.querySelectorAll('[data-tip]').forEach(el => {
      const show = () => {
        const tip = _getBodyTip();
        tip.textContent = el.dataset.tip;
        tip.style.display = 'block';
        const r = el.getBoundingClientRect();
        const tw = tip.offsetWidth || 120;
        let left = r.left + r.width / 2 - tw / 2;
        let top = r.top - 38;
        if (top < 4) top = r.bottom + 4;
        left = Math.max(4, Math.min(left, window.innerWidth - tw - 4));
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
      };
      el.addEventListener('mouseenter', show);
      el.addEventListener('touchstart', e => { e.preventDefault(); show(); }, {passive:false});
      el.addEventListener('mouseleave', () => { const tip = _getBodyTip(); tip.style.display = 'none'; });
      el.addEventListener('touchend', () => setTimeout(() => { const tip = _getBodyTip(); tip.style.display = 'none'; }, 1800));
    });
  }
  class SarimChart {
    constructor(el, cfg) {
      this.el = el; this.config = cfg;
      this.data = JSON.parse(JSON.stringify(cfg.data || {labels:[],datasets:[]}));
      this.options = cfg.options || {};
      if (this.el) { this.el.classList.add('sc-host'); this._render(); }
    }
    destroy() { if (this.el) { this.el.innerHTML = ''; this.el.classList.remove('sc-host'); } }
    update() { if (this.el) this._render(); }
    _render() {
      if (!this.el) return;
      const t = this.config.type;
      if (t === 'bar') this._bar();
      else if (t === 'pie') this._pie();
      else if (t === 'line') this._line();
    }
    _titleHtml() {
      const p = this.options?.plugins?.title;
      return (p?.display && p?.text) ? `<div class="sc-title">${_esc(p.text)}</div>` : '';
    }
    _legendHtml(datasets, override) {
      if (this.options?.plugins?.legend?.display === false) return '';
      return '<div class="sc-legend">' + datasets.map((ds, i) => {
        const c = override?.[i] || (Array.isArray(ds.backgroundColor) ? ds.backgroundColor[i] || ds.backgroundColor[0] : (ds.backgroundColor || ds.borderColor || '#888'));
        return `<div class="sc-legend-item"><span class="sc-legend-dot" style="background:${c}"></span><span>${_esc(ds.label||'')}</span></div>`;
      }).join('') + '</div>';
    }
    _bar() {
      const { datasets=[], labels=[] } = this.data;
      const stacked = !!this.options?.scales?.y?.stacked;
      let maxVal = 0;
      if (stacked) {
        labels.forEach((_, i) => { const s = datasets.reduce((a,ds)=>a+(+ds.data[i]||0),0); if(s>maxVal)maxVal=s; });
      } else {
        datasets.forEach(ds => ds.data.forEach(v => { if(+v>maxVal)maxVal=+v; }));
      }
      if (!maxVal) maxVal = 1;
      let yTicks = '';
      for (let i = 4; i >= 0; i--)
        yTicks += `<div class="sc-y-tick" style="bottom:${(i/4*100).toFixed(1)}%"><span>${_short(maxVal*i/4)}</span></div>`;
      let gridLines = '';
      for (let i = 1; i <= 4; i++)
        gridLines += `<div class="sc-grid-line" style="bottom:${(i/4*100).toFixed(1)}%"></div>`;
      const single = datasets.length === 1;
      const barsHtml = labels.map((lbl, i) => {
        let inner = '';
        if (stacked) {
          const total = datasets.reduce((a,ds)=>a+(+ds.data[i]||0),0);
          const ht = (total/maxVal*100).toFixed(2);
          const segs = datasets.map(ds => {
            const v = +ds.data[i]||0, p = total>0?(v/total*100).toFixed(2):'0';
            const c = Array.isArray(ds.backgroundColor) ? ds.backgroundColor[i] : ds.backgroundColor;
            return `<div class="sc-seg" style="height:${p}%;background:${c}" data-tip="${_esc(`${ds.label||''}: ${_fmt(v)}`)}" tabindex="0"></div>`;
          }).join('');
          inner = `<div class="sc-bar-fill sc-stacked" style="height:${ht}%">${segs}</div>`;
        } else if (single) {
          const ds = datasets[0], v = +ds.data[i]||0, ht = (v/maxVal*100).toFixed(2);
          const c = Array.isArray(ds.backgroundColor) ? ds.backgroundColor[i] : ds.backgroundColor;
          inner = `<div class="sc-bar-fill" style="height:${ht}%;background:${c};border-top:2px solid ${ds.borderColor||c}" data-tip="${_esc(`${_esc(String(lbl))}: ${_fmt(v)}`)}" tabindex="0"></div>`;
        } else {
          inner = '<div class="sc-bar-group">' + datasets.map(ds => {
            const v = +ds.data[i]||0, ht = (v/maxVal*100).toFixed(2);
            const c = Array.isArray(ds.backgroundColor) ? ds.backgroundColor[i] : ds.backgroundColor;
            return `<div class="sc-bar-fill" style="height:${ht}%;background:${c}" data-tip="${_esc(`${ds.label||''}: ${_fmt(v)}`)}" tabindex="0"></div>`;
          }).join('') + '</div>';
        }
        const s = String(lbl), short = s.length > 5 ? s.slice(0,4)+'…' : s;
        return `<div class="sc-bar-col">${inner}<div class="sc-bar-lbl" title="${_esc(s)}">${_esc(short)}</div></div>`;
      }).join('');
      this.el.innerHTML = `${this._titleHtml()}${datasets.length>1?this._legendHtml(datasets):''}
<div class="sc-bar-chart">
<div class="sc-y-axis">${yTicks}</div>
<div class="sc-bars">${gridLines}${barsHtml}</div>
</div>
`;
      _bindTips(this.el);
    }
    _pie() {
      const { datasets=[], labels=[] } = this.data;
      if (!datasets.length) return;
      const ds = datasets[0];
      const raw = (ds.data||[]).map(v => +v||0);
      const total = raw.reduce((a,b)=>a+b,0);
      const cols = Array.isArray(ds.backgroundColor) ? ds.backgroundColor : ['#2563eb','#059669','#dc2626','#f59e0b','#7c3aed','#0891b2'];
      const sz=120, cx=60, cy=60, r=54;
      let paths = '';
      if (total <= 0) {
        paths = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--glass-border)"/>`;
      } else {
        let ang = -Math.PI/2;
        raw.forEach((v, i) => {
          if (v <= 0) return;
          const pct = v/total, end = ang + pct*2*Math.PI;
          const x1=cx+r*Math.cos(ang), y1=cy+r*Math.sin(ang);
          const x2=cx+r*Math.cos(end), y2=cy+r*Math.sin(end);
          const c = cols[i%cols.length], tip = _esc(`${labels[i]||''}: ${_fmt(v)} (${(pct*100).toFixed(1)}%)`);
          paths += `<path d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${pct>.5?1:0},1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${c}" stroke="var(--glass-bg,#0f172a)" stroke-width="1.5" class="sc-pie-slice" data-tip="${tip}" tabindex="0"/>`;
          ang = end;
        });
      }
      const leg = raw.map((v, i) => {
        const c = cols[i%cols.length], p = total>0?(v/total*100).toFixed(1):'0';
        return `<div class="sc-pie-leg-row"><span class="sc-legend-dot" style="background:${c}"></span><span class="sc-pie-lbl">${_esc(labels[i]||'')}</span><span class="sc-pie-val">${_fmt(v)}</span><span class="sc-pie-pct">${p}%</span></div>`;
      }).join('');
      this.el.innerHTML = `${this._titleHtml()}
<div class="sc-pie-row">
<div class="sc-pie-svg-wrap"><svg viewBox="0 0 ${sz} ${sz}" class="sc-pie-svg">${paths}</svg></div>
<div class="sc-pie-leg">${leg}</div>
</div>
`;
      _bindTips(this.el);
    }
    _line() {
      const { datasets=[], labels=[] } = this.data;
      if (!datasets.length || !labels.length) {
        this.el.innerHTML = `${this._titleHtml()}${this._legendHtml(datasets)}<div class="sc-empty">No data yet</div>`;
        return;
      }
      let maxVal = 0;
      datasets.forEach(ds => ds.data.forEach(v => { if(+v>maxVal)maxVal=+v; }));
      if (!maxVal) maxVal = 1;
      const W=280, H=108, pL=34, pR=6, pT=6, pB=18, cW=W-pL-pR, cH=H-pT-pB, n=labels.length;
      const xf = i => pL + (n>1?(i/(n-1))*cW:cW/2);
      const yf = v => pT + cH - (+v||0)/maxVal*cH;
      let svg = '';
      for (let i=0; i<=4; i++) {
        const y = pT+cH-(i/4)*cH;
        svg += `<line x1="${pL}" y1="${y.toFixed(1)}" x2="${W-pR}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>`;
        svg += `<text x="${pL-3}" y="${(y+3).toFixed(1)}" text-anchor="end" font-size="7" fill="var(--text-muted,#94a3b8)">${_short(maxVal*i/4)}</text>`;
      }
      const xStep = Math.max(1, Math.ceil(n/6));
      labels.forEach((lbl, i) => {
        if (i%xStep!==0 && i!==n-1) return;
        svg += `<text x="${xf(i).toFixed(1)}" y="${H-2}" text-anchor="middle" font-size="7" fill="var(--text-muted,#94a3b8)">${_esc(String(lbl))}</text>`;
      });
      datasets.forEach(ds => {
        const pts = ds.data.map((v,i)=>({x:xf(i),y:yf(v),v}));
        const lpts = pts.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        if (ds.fill !== false && pts.length) {
          const ap = `${pts[0].x.toFixed(1)},${pT+cH} ${lpts} ${pts[pts.length-1].x.toFixed(1)},${pT+cH}`;
          svg += `<polyline points="${ap}" fill="${ds.backgroundColor||ds.borderColor+'22'}" stroke="none"/>`;
        }
        svg += `<polyline points="${lpts}" fill="none" stroke="${ds.borderColor||'#2563eb'}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`;
        pts.forEach((p,i) => {
          svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${ds.borderColor||'#2563eb'}" stroke="var(--glass-bg,#0f172a)" stroke-width="1.2" class="sc-dot" data-tip="${_esc(`${ds.label||''}: ${_fmt(p.v)}`)}"/>`;
        });
      });
      svg += `<line x1="${pL}" y1="${pT}" x2="${pL}" y2="${pT+cH}" stroke="var(--glass-border,rgba(255,255,255,0.1))" stroke-width="1"/>`;
      svg += `<line x1="${pL}" y1="${pT+cH}" x2="${W-pR}" y2="${pT+cH}" stroke="var(--glass-border,rgba(255,255,255,0.1))" stroke-width="1"/>`;
      this.el.innerHTML = `${this._titleHtml()}${this._legendHtml(datasets)}
<div class="sc-line-wrap"><svg viewBox="0 0 ${W} ${H}" class="sc-line-svg">${svg}</svg></div>
`;
      _bindTips(this.el);
    }
  }
  return SarimChart;
})();
