async function toggleDarkMode() {
const html = document.documentElement;
const themeToggle = document.getElementById('themeToggle');
const currentTheme = html.getAttribute('data-theme') || 'dark';
const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
html.setAttribute('data-theme', newTheme);
if (newTheme === 'dark') {
themeToggle.innerHTML = '';
themeToggle.title = "Switch to Light Mode";
await idb.set('theme', 'dark');
} else {
themeToggle.innerHTML = '';
themeToggle.title = "Switch to Dark Mode";
await idb.set('theme', 'light');
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
const savedQueue = await idb.get('offline_operation_queue', []);
this.queue = Array.isArray(savedQueue) ? savedQueue : [];
const savedDL = await idb.get(this._dlKey, []);
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
}
},
async saveQueue() {
try {
await idb.set('offline_operation_queue', this.queue);
} catch (error) {
console.error('Failed to save data locally.', _safeErr(error));
showToast('Failed to save data locally.', 'error');
}
},
async saveDeadLetterQueue() {
try {
await idb.set(this._dlKey, this.deadLetterQueue);
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
`⚠️ Upload failed permanently — tap "Failed ops" to review`,
'error',
6000
);
continue;
}
try {
await this.executeOperation(item.operation);
successfulIds.push(item.id);
} catch (error) {
console.error('Failed to save data locally.', _safeErr(error));
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
dlBadge.textContent = `⚠️ ${count} failed op${count !== 1 ? 's' : ''}`;
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
<h3 class="dl-queue-title">⚠️ Failed Uploads</h3>
<button class="dl-queue-close" aria-label="Close" onclick="document.getElementById('dl-queue-modal').remove()">✕</button>
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
await userRef.collection(collection).doc(docId).set(setData, { merge: true });
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
window._firestoreNetworkDisabled = false;
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
showToast('All offline changes synced to cloud', 'success', 3000);
}
}
return result;
};
})();
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
console.warn('Failed to enable Firestore network after retries:', e);
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
subscribeToRealtime();
}
}, 500);
setTimeout(() => {
if (typeof triggerAutoSync === 'function') triggerAutoSync();
if (typeof updateOfflineBanner === 'function') updateOfflineBanner();
}, 2000);
showToast('Back online — syncing...', 'success', 3000);
});
window.addEventListener('offline', async () => {
updateOfflineBanner();
if (typeof firebaseDB !== 'undefined' && firebaseDB) {
try {
await firebaseDB.disableNetwork();
window._firestoreNetworkDisabled = true;
} catch (e) {
console.warn('Failed to disable network.', e);
}
}
if (typeof isSyncing !== 'undefined' && isSyncing) {
isSyncing = false;
}
showToast('Offline — changes will be saved locally', 'warning', 4000);
});
document.addEventListener('visibilitychange', async () => {
if (document.visibilityState !== 'visible') return;
if (syncState.pendingUpdates.size > 0 && !syncState.isRefreshing) {
requestAnimationFrame(() => processSync());
}
if (!navigator.onLine) return;
if (typeof firebaseDB === 'undefined' || !firebaseDB) return;
if (window._firestoreNetworkDisabled) {
try {
await firebaseDB.enableNetwork();
window._firestoreNetworkDisabled = false;
} catch(e) {  }
}
setTimeout(() => {
if (typeof triggerAutoSync === 'function') triggerAutoSync();
}, 1500);
});
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
if (!syncState.isRefreshing && !document.hidden) {
requestAnimationFrame(() => processSync());
}
if (typeof triggerSeamlessBackup === 'function') {
triggerSeamlessBackup();
}
}
let autoSyncTimeout = null;
const AUTO_SYNC_DELAY = 5000;
async function invalidateAllCaches() {
try {
const keys = [
'mfg_pro_pkr', 'noman_history', 'customer_sales', 'rep_sales', 'rep_customers',
'sales_customers',
'factory_inventory_data', 'factory_production_history',
'payment_entities', 'payment_transactions', 'expenses',
'stock_returns', 'deletion_records', 'deleted_records',
'factory_default_formulas', 'factory_additional_costs',
'factory_sale_prices', 'factory_cost_adjustment_factor', 'factory_unit_tracking',
'naswar_default_settings', 'expense_categories'
];
const results = await idb.getBatch(keys);
db = ensureArray(results.get('mfg_pro_pkr'));
salesHistory = ensureArray(results.get('noman_history'));
customerSales = ensureArray(results.get('customer_sales'));
repSales = ensureArray(results.get('rep_sales'));
repCustomers = ensureArray(results.get('rep_customers'));
salesCustomers = ensureArray(results.get('sales_customers'));
stockReturns = ensureArray(results.get('stock_returns'));
expenseRecords = ensureArray(results.get('expenses'));
factoryInventoryData = ensureArray(results.get('factory_inventory_data'));
factoryProductionHistory = ensureArray(results.get('factory_production_history'));
paymentEntities = ensureArray(results.get('payment_entities'));
paymentTransactions = ensureArray(results.get('payment_transactions'));
deletionRecordsArray = ensureArray(results.get('deletion_records'));
deletionRecords = deletionRecordsArray;
const deletedArr = ensureArray(results.get('deleted_records'));
deletedRecordIds = new Set(deletedArr);
if (deletedRecordIds.size > 0) {
const _notDeleted = r => r && !deletedRecordIds.has(r.id);
db = db.filter(_notDeleted);
salesHistory = salesHistory.filter(_notDeleted);
customerSales = customerSales.filter(_notDeleted);
repSales = repSales.filter(_notDeleted);
repCustomers = repCustomers.filter(_notDeleted);
salesCustomers = salesCustomers.filter(_notDeleted);
stockReturns = stockReturns.filter(_notDeleted);
expenseRecords = expenseRecords.filter(_notDeleted);
factoryInventoryData = factoryInventoryData.filter(_notDeleted);
factoryProductionHistory = factoryProductionHistory.filter(_notDeleted);
paymentEntities = paymentEntities.filter(_notDeleted);
paymentTransactions = paymentTransactions.filter(_notDeleted);
}
const freshFormulas = results.get('factory_default_formulas');
if (freshFormulas && typeof freshFormulas === 'object') factoryDefaultFormulas = freshFormulas;
const freshCosts = results.get('factory_additional_costs');
if (freshCosts && typeof freshCosts === 'object') factoryAdditionalCosts = freshCosts;
const freshPrices = results.get('factory_sale_prices');
if (freshPrices && typeof freshPrices === 'object') factorySalePrices = freshPrices;
const freshFactor = results.get('factory_cost_adjustment_factor');
if (freshFactor && typeof freshFactor === 'object') factoryCostAdjustmentFactor = freshFactor;
const freshTracking = results.get('factory_unit_tracking');
if (freshTracking && typeof freshTracking === 'object') factoryUnitTracking = freshTracking;
const freshSettings = results.get('naswar_default_settings');
if (freshSettings && typeof freshSettings === 'object') defaultSettings = freshSettings;
const freshCats = results.get('expense_categories');
if (Array.isArray(freshCats)) expenseCategories = freshCats;
} catch(e) {
console.error('Failed to load expense categories.', _safeErr(e));
showToast('Failed to load expense categories.', 'error');
}
try {
let _bfSalesChanged = false;
const _bfSalesMap = new Map((Array.isArray(salesCustomers) ? salesCustomers : []).map(c => [c.name.toLowerCase(), c]));
(Array.isArray(customerSales) ? customerSales : []).forEach(s => {
if (s.salesRep !== 'NONE') return;
const _bfName = s && s.customerName;
if (_bfName && _bfName.trim() && !_bfSalesMap.has(_bfName.toLowerCase())) {
const _bfC = { id: generateUUID('cust'), name: _bfName, phone: s.customerPhone || '', address: '', oldDebit: 0, createdAt: getTimestamp(), updatedAt: getTimestamp(), timestamp: getTimestamp() };
_bfSalesMap.set(_bfName.toLowerCase(), _bfC);
if (!Array.isArray(salesCustomers)) salesCustomers = [];
salesCustomers.push(_bfC);
_bfSalesChanged = true;
}
});
if (_bfSalesChanged) {
saveWithTracking('sales_customers', salesCustomers).catch(e => console.warn('Backfill sales_customers save failed:', e));
}
let _bfRepChanged = false;
const _bfRepMap = new Map(
(Array.isArray(repCustomers) ? repCustomers : [])
.filter(c => c && c.name)
.map(c => [`${(c.salesRep || '').toLowerCase()}::${c.name.toLowerCase()}`, c])
);
(Array.isArray(repSales) ? repSales : []).forEach(s => {
const _bfRName = s && s.customerName;
const _bfRRep = s.salesRep;
if (_bfRName && _bfRName.trim() && _bfRRep && _bfRRep.trim()) {
const _bfKey = `${_bfRRep.toLowerCase()}::${_bfRName.toLowerCase()}`;
if (!_bfRepMap.has(_bfKey)) {
const _bfRC = { id: generateUUID('rep_cust'), name: _bfRName, salesRep: _bfRRep, phone: s.customerPhone || '', address: '', oldDebit: 0, createdAt: getTimestamp(), updatedAt: getTimestamp(), timestamp: getTimestamp() };
_bfRepMap.set(_bfKey, _bfRC);
if (!Array.isArray(repCustomers)) repCustomers = [];
repCustomers.push(_bfRC);
_bfRepChanged = true;
}
}
});
if (_bfRepChanged) {
saveWithTracking('rep_customers', repCustomers).catch(e => console.warn('Backfill rep_customers save failed:', e));
}
} catch (_bfErr) { console.warn('Customer registry backfill failed:', _bfErr); }
}
function triggerAutoSync() {
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
console.error('Sync failed. Check your connection.', _safeErr(error));
showToast('Sync failed. Check your connection.', 'error');
}
}, AUTO_SYNC_DELAY);
}
async function updateSettingTimestamp(settingName) {
const timestamp = getTimestamp();
await idb.set(`${settingName}_timestamp`, timestamp);
}
const _tabSyncInProgress = {};
function processSync() {
if (document.hidden) return;
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
showToast('Tab sync failed.', 'error');
} finally {
syncState.isRefreshing = false;
if (syncState.pendingUpdates.size > 0) {
requestAnimationFrame(() => processSync());
}
}
}
function getCurrentActiveTab() {
if (!document.getElementById('tab-prod').classList.contains('hidden')) return 'prod';
if (!document.getElementById('tab-sales').classList.contains('hidden')) return 'sales';
if (!document.getElementById('tab-calc').classList.contains('hidden')) return 'calc';
if (!document.getElementById('tab-factory').classList.contains('hidden')) return 'factory';
if (!document.getElementById('tab-payments').classList.contains('hidden')) return 'payments';
return 'prod';
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
showToast('Calculation failed.', 'error');
}
}
async function syncCalculatorTab() {
try {
await idb.init();
const fresh = await idb.get('noman_history', []);
if (Array.isArray(fresh)) {
const map = new Map(fresh.map(r => [r.id, r]));
(salesHistory || []).forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
salesHistory = Array.from(map.values()).filter(r => !deletedRecordIds.has(r.id));
}
const freshSales = await idb.get('customer_sales', []);
if (Array.isArray(freshSales)) {
const map = new Map(freshSales.map(r => [r.id, r]));
(customerSales || []).forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
customerSales = Array.from(map.values()).filter(r => !deletedRecordIds.has(r.id));
}
const freshRepSales = await idb.get('rep_sales', []);
if (Array.isArray(freshRepSales)) {
const map = new Map(freshRepSales.map(r => [r.id, r]));
(repSales || []).forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
repSales = Array.from(map.values()).filter(r => !deletedRecordIds.has(r.id));
}
if (typeof loadSalesData === 'function') await loadSalesData(currentCompMode);
if (typeof autoFillTotalSoldQuantity === 'function') autoFillTotalSoldQuantity();
} catch (error) {
console.error('Failed to load sales data.', _safeErr(error));
showToast('Failed to load sales data.', 'error');
if (typeof loadSalesData === 'function') setTimeout(() => loadSalesData(currentCompMode), 500);
}
}
async function syncFactoryTab() {
try {
await idb.init();
const keys = ['factory_inventory_data', 'factory_production_history',
'factory_unit_tracking', 'factory_default_formulas',
'factory_additional_costs', 'factory_sale_prices',
'factory_cost_adjustment_factor'];
const dataMap = await idb.getBatch(keys);
const freshInv = dataMap.get('factory_inventory_data');
if (Array.isArray(freshInv)) {
const map = new Map((factoryInventoryData || []).filter(r => r && r.id).map(r => [r.id, r]));
freshInv.forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
factoryInventoryData = Array.from(map.values()).filter(r => !deletedRecordIds.has(r.id));
}
const freshHist = dataMap.get('factory_production_history');
if (Array.isArray(freshHist)) {
const map = new Map((factoryProductionHistory || []).filter(r => r && r.id).map(r => [r.id, r]));
freshHist.forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
factoryProductionHistory = Array.from(map.values()).filter(r => !deletedRecordIds.has(r.id));
}
const freshFormulas = dataMap.get('factory_default_formulas');
if (freshFormulas && typeof freshFormulas === 'object') factoryDefaultFormulas = freshFormulas;
const freshCosts = dataMap.get('factory_additional_costs');
if (freshCosts && typeof freshCosts === 'object') factoryAdditionalCosts = freshCosts;
const freshPrices = dataMap.get('factory_sale_prices');
if (freshPrices && typeof freshPrices === 'object') factorySalePrices = freshPrices;
const freshFactor = dataMap.get('factory_cost_adjustment_factor');
if (freshFactor && typeof freshFactor === 'object') factoryCostAdjustmentFactor = freshFactor;
const freshTracking = dataMap.get('factory_unit_tracking');
if (freshTracking && typeof freshTracking === 'object') factoryUnitTracking = freshTracking;
if (typeof updateFactoryUnitsAvailableStats === 'function') updateFactoryUnitsAvailableStats();
if (typeof updateFactorySummaryCard === 'function') updateFactorySummaryCard();
if (typeof renderFactoryInventory === 'function') renderFactoryInventory();
if (typeof renderFactoryHistory === 'function') renderFactoryHistory();
} catch (error) {
console.error('Failed to render data.', _safeErr(error));
showToast('Failed to render data.', 'error');
if (typeof updateFactoryUnitsAvailableStats === 'function') setTimeout(updateFactoryUnitsAvailableStats, 500);
}
}
async function syncPaymentsTab() {
try {
await idb.init();
const dataMap = await idb.getBatch(['expenses', 'payment_entities', 'payment_transactions']);
const freshExp = dataMap.get('expenses');
if (Array.isArray(freshExp)) {
const map = new Map((expenseRecords || []).filter(r => r && r.id).map(r => [r.id, r]));
freshExp.forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
expenseRecords = Array.from(map.values()).filter(r => !deletedRecordIds.has(r.id));
}
const freshEnt = dataMap.get('payment_entities');
if (Array.isArray(freshEnt)) {
const map = new Map((paymentEntities || []).filter(r => r && r.id).map(r => [r.id, r]));
freshEnt.forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
paymentEntities = Array.from(map.values()).filter(r => !deletedRecordIds.has(r.id));
}
const freshTx = dataMap.get('payment_transactions');
if (Array.isArray(freshTx)) {
const map = new Map((paymentTransactions || []).filter(r => r && r.id).map(r => [r.id, r]));
freshTx.forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
paymentTransactions = Array.from(map.values()).filter(r => !deletedRecordIds.has(r.id));
}
if (typeof refreshPaymentTab === 'function') refreshPaymentTab();
if (typeof renderEntityTable === 'function') renderEntityTable();
} catch (error) {
console.error('Payment tab refresh failed.', _safeErr(error));
showToast('Payment tab refresh failed.', 'error');
if (typeof refreshPaymentTab === 'function') setTimeout(refreshPaymentTab, 500);
}
}
async function syncProductionTab() {
try {
await idb.init();
const dataMap = await idb.getBatch(['mfg_pro_pkr', 'naswar_default_settings', 'stock_returns', 'customer_sales']);
const freshProd = dataMap.get('mfg_pro_pkr');
if (Array.isArray(freshProd) && freshProd.length > 0) {
let fixed = 0;
const validated = freshProd.map(record => {
if (!record.id || !validateUUID(record.id) ||
!record.createdAt || !validateTimestamp(record.createdAt) ||
!record.updatedAt || !validateTimestamp(record.updatedAt)) {
fixed++;
return ensureRecordIntegrity(record, false, true);
}
return record;
});
if (fixed > 0) {
await idb.set('mfg_pro_pkr', validated);
}
validated.sort((a, b) => compareTimestamps(getRecordTimestamp(b), getRecordTimestamp(a)));
const map = new Map((db || []).filter(r => r && r.id).map(r => [r.id, r]));
validated.forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
db = Array.from(map.values()).filter(r => !deletedRecordIds.has(r.id));
}
const freshSettings = dataMap.get('naswar_default_settings');
if (freshSettings && typeof freshSettings === 'object') defaultSettings = freshSettings;
const freshReturns = dataMap.get('stock_returns');
if (Array.isArray(freshReturns)) {
const map = new Map((stockReturns || []).filter(r => r && r.id).map(r => [r.id, r]));
freshReturns.forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
stockReturns = Array.from(map.values()).filter(r => !deletedRecordIds.has(r.id));
}
const freshSalesForProd = dataMap.get('customer_sales');
if (Array.isArray(freshSalesForProd)) {
const map = new Map((customerSales || []).filter(r => r && r.id).map(r => [r.id, r]));
freshSalesForProd.forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
customerSales = Array.from(map.values()).filter(r => !deletedRecordIds.has(r.id));
}
if (typeof refreshUI === 'function') refreshUI();
if (typeof updateMfgCharts === 'function') updateMfgCharts();
if (typeof calculateCustomerSale === 'function') calculateCustomerSale();
} catch (error) {
console.error('UI refresh failed.', _safeErr(error));
showToast('UI refresh failed.', 'error');
if (typeof refreshUI === 'function') setTimeout(refreshUI, 500);
}
}
async function syncSalesTab() {
try {
await idb.init();
const salesDataMap = await idb.getBatch(['customer_sales', 'mfg_pro_pkr', 'stock_returns']);
const freshSales = salesDataMap.get('customer_sales');
if (Array.isArray(freshSales)) {
const validated = freshSales.map(r => ensureRecordIntegrity(r, false, true));
validated.sort((a, b) => compareTimestamps(getRecordTimestamp(b), getRecordTimestamp(a)));
const map = new Map((customerSales || []).filter(r => r && r.id).map(r => [r.id, r]));
validated.forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
customerSales = Array.from(map.values()).filter(r => !deletedRecordIds.has(r.id));
}
const freshProdForSales = salesDataMap.get('mfg_pro_pkr');
if (Array.isArray(freshProdForSales) && freshProdForSales.length > 0) {
const map = new Map((db || []).filter(r => r && r.id).map(r => [r.id, r]));
freshProdForSales.forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
db = Array.from(map.values()).filter(r => !deletedRecordIds.has(r.id));
}
const freshReturnsForSales = salesDataMap.get('stock_returns');
if (Array.isArray(freshReturnsForSales)) {
const map = new Map((stockReturns || []).filter(r => r && r.id).map(r => [r.id, r]));
freshReturnsForSales.forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
stockReturns = Array.from(map.values()).filter(r => !deletedRecordIds.has(r.id));
}
if (typeof calculateCustomerSale === 'function') calculateCustomerSale();
if (typeof refreshCustomerSales === 'function') refreshCustomerSales();
} catch (error) {
console.error('Customer data operation failed.', _safeErr(error));
showToast('Customer data operation failed.', 'error');
if (typeof refreshCustomerSales === 'function') setTimeout(refreshCustomerSales, 500);
}
}
async function syncRepTab() {
try {
await idb.init();
const dataMap = await idb.getBatch([
'rep_sales', 'rep_customers',
'factory_default_formulas', 'factory_additional_costs',
'factory_sale_prices', 'factory_cost_adjustment_factor', 'factory_unit_tracking'
]);
const freshRepSales = dataMap.get('rep_sales');
if (Array.isArray(freshRepSales)) {
let fixed = 0;
const validated = freshRepSales
  .map(record => {
try {
if (!record.id || !validateUUID(record.id) ||
!record.createdAt || !validateTimestamp(record.createdAt) ||
!record.updatedAt || !validateTimestamp(record.updatedAt)) {
fixed++;
return ensureRecordIntegrity(record, false, true);
}
return record;
} catch (e) { return record; }
});
if (fixed > 0) {
await idb.set('rep_sales', validated);
}
validated.sort((a, b) => compareTimestamps(getRecordTimestamp(b), getRecordTimestamp(a)));
const map = new Map((repSales || []).filter(r => r && r.id).map(r => [r.id, r]));
validated.forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
repSales = Array.from(map.values()).filter(r => !deletedRecordIds.has(r.id));
}
const freshRepCustomers = dataMap.get('rep_customers');
if (Array.isArray(freshRepCustomers)) {
let fixed = 0;
const validated = freshRepCustomers.map(record => {
try {
if (!record.id || !validateUUID(record.id) ||
!record.createdAt || !validateTimestamp(record.createdAt) ||
!record.updatedAt || !validateTimestamp(record.updatedAt)) {
fixed++;
return ensureRecordIntegrity(record, false, true);
}
return record;
} catch (e) { return record; }
});
if (fixed > 0) {
await idb.set('rep_customers', validated);
}
const map = new Map(validated.map(r => [r.id, r]));
(repCustomers || []).forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
repCustomers = Array.from(map.values()).filter(r => !deletedRecordIds.has(r.id));
}
const freshFormulas = dataMap.get('factory_default_formulas');
if (freshFormulas && typeof freshFormulas === 'object') factoryDefaultFormulas = freshFormulas;
const freshCosts = dataMap.get('factory_additional_costs');
if (freshCosts && typeof freshCosts === 'object') factoryAdditionalCosts = freshCosts;
const freshPrices = dataMap.get('factory_sale_prices');
if (freshPrices && typeof freshPrices === 'object') factorySalePrices = freshPrices;
const freshFactor = dataMap.get('factory_cost_adjustment_factor');
if (freshFactor && typeof freshFactor === 'object') factoryCostAdjustmentFactor = freshFactor;
const freshTracking = dataMap.get('factory_unit_tracking');
if (freshTracking && typeof freshTracking === 'object') factoryUnitTracking = freshTracking;
if (typeof refreshRepUI === 'function') refreshRepUI();
if (typeof updateRepLiveMap === 'function' && appMode === 'admin') updateRepLiveMap();
} catch (error) {
console.error('An unexpected error occurred.', _safeErr(error));
showToast('An unexpected error occurred.', 'error');
if (typeof refreshRepUI === 'function') setTimeout(refreshRepUI, 500);
}
}
function startPeriodicSync() {
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
try {
await loadAllData();
} catch (error) {
console.error('Failed to load app data.', _safeErr(error));
showToast('Failed to load app data.', 'error');
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
let currentMfgMode = 'week';
let currentCompMode = 'all';
let currentCustomerChartMode = 'week';
let currentStore = 'STORE_A';
let currentStoreComparisonMetric = 'weight';
let currentIndMode = 'week';
let currentIndMetric = 'weight';
let currentOverviewMode = 'day';
let currentProductionView = 'store';
let currentFactoryEntryStore = 'standard';
let currentFactorySettingsStore = 'standard';
let currentFactorySummaryMode = 'daily';
let editingFactoryInventoryId = null;
let currentFactoryDate = new Date().toISOString().split('T')[0];
let editingEntityId = null;
let selectedEntityId = null;
let mfgPieChartShowPercentage = false;
let custPaymentChartShowPercentage = false;
let compositionChartShowPercentage = false;
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
if (appMode === 'userrole' && !(window._userRoleAllowedTabs || []).includes('prod')) {
showToast('Access Denied — Production not in your assigned tabs', 'warning', 3000); return;
}
const netElement = document.getElementById('net-wt');
const dateElement = document.getElementById('sys-date');
const storeElement = document.getElementById('storeSelector');
const formulaUnitsElement = document.getElementById('formula-units');
if (!netElement || !dateElement || !storeElement || !formulaUnitsElement) {
showToast('Form error: Missing required fields', 'error');
return;
}
const net = parseFloat(netElement.value) || 0;
const inputDate = dateElement.value;
const store = storeElement.value;
const formulaUnits = parseFloat(formulaUnitsElement.value) || 0;
let formulaStore = 'standard';
let salePrice = 0;
if (store === 'STORE_C') {
formulaStore = 'asaan';
salePrice = getSalePriceForStore('STORE_C');
} else {
salePrice = getSalePriceForStore(store);
}
const validation = validateFormulaAvailability(store, formulaUnits);
if (!validation.sufficient) {
showToast(` Insufficient formula units! Available: ${validation.available}, Requested: ${formulaUnits}`, 'warning', 4000);
return;
}
const costData = calculateDynamicCost(store, formulaUnits, net);
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
emitSyncUpdate({ mfg_pro_pkr: db });
} catch (error) {
db.pop();
showToast(" Failed to save production entry. Please try again.", "error");
return;
}
syncFactoryProductionStats();
const grossWt = document.getElementById('gross-wt');
const contWt = document.getElementById('cont-wt');
const netWt = document.getElementById('net-wt');
const formulaUnitsEl = document.getElementById('formula-units');
const displayCostValue = document.getElementById('display-cost-value');
const profitPerKg = document.getElementById('profit-per-kg');
const formulaUnitCostDisplay = document.getElementById('formula-unit-cost-display');
const totalFormulaCostDisplay = document.getElementById('total-formula-cost-display');
const dynamicCostPerKg = document.getElementById('dynamic-cost-per-kg');
if (grossWt) grossWt.value = '';
if (contWt) contWt.value = '';
if (netWt) netWt.value = '';
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
      tempResult.displayDetail = s.phone ? `📞 ${s.phone}` : '';
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
      tempResult.displayDetail = s.phone ? `📞 ${s.phone}` : (s.type || '');
      break;
    default:
      tempResult.displayName   = s.name || s.customerName || s.entityName || s.description || null;
      tempResult.displayDetail = s.date || null;
      tempResult.displayAmount = s.amount != null ? `₨${Number(s.amount).toLocaleString()}` : null;
  }
  _snapshot = tempResult;
} else {
  _snapshot = _captureRecordSnapshot(id, collectionName);
}
const deletionRecord = {
id: id,
recordId: id,
recordType: collectionName,
deletedAt: now,
collection: collectionName,
syncedToCloud: false,
tombstoned_at: now,
deleted_by: 'user',
deletion_version: '2.0',
displayName: _snapshot.displayName || null,
displayDetail: _snapshot.displayDetail || null,
displayAmount: _snapshot.displayAmount || null,
snapshot: _snapshot.record || null,
};
if (!validateTimestamp(deletionRecord.deletedAt, false)) {
deletionRecord.deletedAt = now;
deletionRecord.tombstoned_at = now;
}
deletedRecordIds.add(id);
let deletionRecords = await idb.get('deletion_records', []);
if (!Array.isArray(deletionRecords)) deletionRecords = [];
const _sid = String(id);
const existingIndex = deletionRecords.findIndex(r => String(r.id) === _sid || String(r.recordId) === _sid);
if (existingIndex >= 0) {
deletionRecords[existingIndex] = deletionRecord;
} else {
deletionRecords.push(deletionRecord);
}
const _deduped = _dedupDeletionRecordsLocal(deletionRecords);
await idb.set('deletion_records', _deduped);
await idb.set('deleted_records', Array.from(deletedRecordIds));
triggerAutoSync();
await uploadDeletionToCloud(deletionRecord);
await cleanupOldDeletions();
}
function _captureRecordSnapshot(id, collectionName) {
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
        result.displayDetail = record.phone ? `📞 ${record.phone}` : '';
        result.displayAmount = null;
        break;
      case 'rep_customers':
        result.displayName   = record.name || null;
        result.displayDetail = [record.salesRep ? `Rep: ${record.salesRep}` : '', record.phone || ''].filter(Boolean).join(' · ');
        result.displayAmount = null;
        break;
      case 'entities':
        result.displayName   = record.name || 'Payment Entity';
        result.displayDetail = record.phone ? `📞 ${record.phone}` : (record.type || '');
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
        result.displayDetail = s.phone ? `📞 ${s.phone}` : '';
        result.displayAmount = null;
        break;
      case 'rep_customers':
        result.displayName   = s.name || null;
        result.displayDetail = [s.salesRep ? `Rep: ${s.salesRep}` : '', s.phone || ''].filter(Boolean).join(' · ');
        result.displayAmount = null;
        break;
      case 'entities':
        result.displayName   = s.name || 'Payment Entity';
        result.displayDetail = s.phone ? `📞 ${s.phone}` : (s.type || '');
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
let deletionRecords = await idb.get('deletion_records', []);
if (Array.isArray(deletionRecords)) {
const index = deletionRecords.findIndex(r => String(r.id) === String(deletionRecord.id) || String(r.recordId) === String(deletionRecord.id));
if (index > -1) {
deletionRecords[index].syncedToCloud = true;
await idb.set('deletion_records', deletionRecords);
}
}
} catch (error) {
console.error('Failed to save data locally.', _safeErr(error));
showToast('Failed to save data locally.', 'error');
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
const threeMonthsAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
let deletionRecords = await idb.get('deletion_records', []);
const validDeletions = deletionRecords.filter(record => record.deletedAt > threeMonthsAgo);
if (validDeletions.length !== deletionRecords.length) {
const expiredIds = new Set(
  deletionRecords.filter(r => r.deletedAt <= threeMonthsAgo).map(r => r.id)
);
expiredIds.forEach(id => deletedRecordIds.delete(id));
await idb.set('deletion_records', validDeletions);
await idb.set('deleted_records', Array.from(deletedRecordIds));
}
if (firebaseDB && typeof currentUser !== 'undefined' && currentUser) {
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
console.error('Failed to save data locally.', _safeErr(error));
showToast('Failed to save data locally.', 'error');
}
}
}
async function openEntityDetailsOverlay(id) {
currentEntityId = id;
const entity = paymentEntities.find(e => String(e.id) === String(id));
if (!entity) return;
const quickAmountEl = document.getElementById('quickEntityAmount');
if (quickAmountEl) quickAmountEl.value = '';
setQuickEntityType('OUT');
await renderEntityOverlayContent(entity);
requestAnimationFrame(() => {
document.body.style.overflow = 'hidden';
document.documentElement.style.overflow = 'hidden';
const overlayEl = document.getElementById('entityDetailsOverlay');
if (overlayEl) overlayEl.style.display = 'flex';
});
}
function closeEntityDetailsOverlay() {
requestAnimationFrame(() => {
document.body.style.overflow = '';
document.documentElement.style.overflow = '';
document.getElementById('entityDetailsOverlay').style.display = 'none';
});
currentEntityId = null;
refreshPaymentTab();
}
function openEditEntityFromDetails() {
const id = currentEntityId;
if (!id) return;
editEntityBasicInfo(id);
requestAnimationFrame(() => {
const editOverlay = document.getElementById('entityManagementOverlay');
if (editOverlay) editOverlay.style.zIndex = '10004';
});
}
function setQuickEntityType(type) {
currentQuickType = type;
document.getElementById('quick-type-out').className = `toggle-opt ${type === 'OUT' ? 'active' : ''}`;
document.getElementById('quick-type-in').className = `toggle-opt ${type === 'IN' ? 'active' : ''}`;
}
async function renderEntityOverlayContent(entity) {
const _manageET = document.getElementById('manageEntityTitle');
if (_manageET) {
const phone = entity.phone || '';
const wallet = entity.wallet || '';
_manageET.innerHTML = `<div class="u-fw-700" >${esc(entity.name)}</div>${(phone || wallet) ? `<div style="font-size:0.75rem; color:var(--text-muted); font-weight:normal; margin-top:3px;">${phone ? phoneActionHTML(phone) : ''}${phone && wallet ? ' &middot; ' : ''}${esc(wallet)}</div>` : ''}`;
}

try {
const _freshInv = await idb.get('factory_inventory_data', []);
if (_freshInv && Array.isArray(_freshInv) && _freshInv.length > 0) {
factoryInventoryData = _freshInv;
}
} catch (_e) {}
const balances = calculateEntityBalances();
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
<span style="background:rgba(52,217,116,0.15); color:var(--accent-emerald); padding:2px 8px; border-radius:10px; font-size:0.7rem; font-weight:700;">
IN: ${fmtAmt(totalIn)}
</span>
<span style="background:rgba(255,77,109,0.15); color:var(--danger); padding:2px 8px; border-radius:10px; font-size:0.7rem; font-weight:700;">
OUT: ${fmtAmt(totalOut)}
</span>
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
const badgeBg = isOut ? 'rgba(220, 38, 38, 0.1)' : 'rgba(5, 150, 105, 0.1)';
const badgeColor = isOut ? 'var(--danger)' : 'var(--accent-emerald)';
const label = isOut ? 'PAYMENT OUT' : 'PAYMENT IN';
const item = document.createElement('div');
item.className = `cust-history-item${t.isSettled ? ' is-settled-record' : ''}`;
item.innerHTML = `
<div class="cust-history-info">
<div class="u-mono-bold" >${formatDisplayDate(t.date)}</div>
<div class="u-fs-sm2 u-text-muted" >${esc(t.description || 'No description')}${(typeof _creatorBadgeHtml === 'function') ? _creatorBadgeHtml(t) : ''}</div>
${t.isMerged ? _mergedBadgeHtml(t) : ''}
</div>
<div style="text-align:right; margin-right:10px;">
<span style="background:${badgeBg}; color:${badgeColor}; padding:2px 6px; border-radius:4px; font-size:0.65rem; font-weight:700;">${label}</span>
<div class="${colorClass}" style="font-size:0.9rem; margin-top:2px;">${fmtAmt(t.amount)}</div>
</div>
${t.isMerged ? '' : `<button class="btn btn-sm btn-danger u-p-4-8" onclick="deleteEntityTransaction('${esc(t.id)}')">⌫</button>`}
`;
_entityFrag.appendChild(item);
});
list.replaceChildren(_entityFrag);
}
function filterEntityManagementHistory() {
const term = document.getElementById('entity-trans-search').value.toLowerCase();
const items = document.querySelectorAll('#entityManagementHistoryList .cust-history-item');
items.forEach(item => {
const text = item.innerText.toLowerCase();
item.style.display = text.includes(term) ? 'flex' : 'none';
});
}
async function saveQuickEntityTransaction() {
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
try {
const now = new Date();
const dateStr = now.toISOString().split('T')[0];
const timeString = now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
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
emitSyncUpdate({ payment_transactions: paymentTransactions });
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
async function deleteEntityTransaction(id) {
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
_dtMsg += `\n\nThis cannot be undone.`;
if (await showGlassConfirm(_dtMsg, { title: `Delete ${_dt.type === 'IN' ? 'Payment IN' : 'Payment OUT'}`, confirmText: "Delete", danger: true })) {
try {
const _txToDelete1 = _dt;
paymentTransactions = paymentTransactions.filter(t => t.id !== id);
await unifiedDelete('payment_transactions', paymentTransactions, id, { strict: true }, _txToDelete1);
const _dtEntityRefreshed = paymentEntities.find(e => String(e.id) === String(_dt.entityId));
if (_dtEntityRefreshed) renderEntityOverlayContent(_dtEntityRefreshed);
if (typeof calculateNetCash === 'function') calculateNetCash();
if (typeof calculateCashTracker === 'function') calculateCashTracker();
if (typeof renderFactoryInventory === 'function') renderFactoryInventory();
if (typeof renderUnifiedTable === 'function') renderUnifiedTable(1);
showToast(" Transaction deleted and all views restored successfully!", "success");
} catch (error) {
showToast('Failed to delete transaction. Please try again.', 'error');
}
}
}
async function deleteCurrentEntity() {
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
const _totalIn  = _entityTxs.filter(t => t.type === 'IN').reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
const _totalOut = _entityTxs.filter(t => t.type === 'OUT').reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
let msg = `Permanently delete "${_entityName}"?`;
if (_entityTxs.length > 0) {
msg += `\n\n\u26a0 This entity has ${_entityTxs.length} transaction${_entityTxs.length !== 1 ? 's' : ''} on record`;
if (_totalIn  > 0) msg += `\n • Received: ${fmtAmt(_totalIn)}`;
if (_totalOut > 0) msg += `\n • Paid out: ${fmtAmt(_totalOut)}`;
msg += `\n\nAll ${_entityTxs.length} transaction${_entityTxs.length !== 1 ? 's' : ''} will also be permanently deleted.`;
}
msg += `\n\nThis cannot be undone.`;
if (!(await showGlassConfirm(msg, { title: `Delete Entity Permanently`, confirmText: "Delete", danger: true }))) return;
try {
const txsToDelete = _entityTxs.slice();
const txIdsToDelete = new Set(txsToDelete.map(t => t.id));
paymentTransactions = paymentTransactions.filter(t => !txIdsToDelete.has(t.id));
await saveWithTracking('payment_transactions', paymentTransactions);
for (const tx of txsToDelete) {
await registerDeletion(tx.id, 'transactions', tx);
await deleteRecordFromFirestore('payment_transactions', tx.id);
}
await registerDeletion(_entityToDel.id, 'entities', _entityToDel);
paymentEntities = paymentEntities.filter(e => String(e.id) !== String(currentEntityId));
await saveWithTracking('payment_entities', paymentEntities);
await deleteRecordFromFirestore('payment_entities', _entityToDel.id);
notifyDataChange('entities');
if (typeof calculateNetCash === 'function') calculateNetCash();
if (typeof calculateCashTracker === 'function') calculateCashTracker();
closeEntityDetailsOverlay();
if (typeof refreshPaymentTab === 'function') await refreshPaymentTab();
showToast(`"${_entityName}" and all its transactions deleted.`, 'success');
} catch (error) {
showToast('Failed to delete entity. Please try again.', 'error');
}
}
function exportEntityData() {
let csvContent = "data:text/csv;charset=utf-8,";
csvContent += "Entity Name,Type,Phone,Net Balance (),Status\n";
const balances = calculateEntityBalances();
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
async function exportEntityToPDF() {
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
let transactions = paymentTransactions.filter(t => String(t.entityId) === String(entity.id) && !t.isExpense);
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
if (range !== 'all') {
transactions = transactions.filter(t => {
if (!t.date) return false;
const d = new Date(t.date);
switch(range) {
case 'today': return d >= today;
case 'week': { const w = new Date(today); w.setDate(w.getDate() - 7); return d >= w; }
case 'month': { const m = new Date(today); m.setMonth(m.getMonth() - 1); return d >= m; }
case 'year': { const y = new Date(today); y.setFullYear(y.getFullYear() - 1); return d >= y; }
default: return true;
}
});
}
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
if (transactions.length > 0) {
doc.setFontSize(9); doc.setFont(undefined, 'bold'); doc.setTextColor(...headerColor);
doc.text('PAYMENT TRANSACTIONS', 14, yPos);
doc.setTextColor(80, 80, 80); doc.setFont(undefined, 'normal');
yPos += 5;
const mergedTxns  = transactions.filter(t => t.isMerged === true);
const normalTxns  = transactions.filter(t => !t.isMerged);
const buildTxRow = (t, runBal) => {
  const amt = parseFloat(t.amount) || 0;
  const isOut = t.type === 'OUT';
  const isSupplierPmt = t.isPayable === true;
  runBal.val += isOut ? -amt : amt;
  let balDisplay;
  if (Math.abs(runBal.val) < 0.01) balDisplay = 'SETTLED';
  else balDisplay = 'Rs ' + fmtAmt(Math.abs(runBal.val));
  let desc = (t.description || '-').substring(0, 35);
  if (isSupplierPmt) desc = '\u21a9 Supplier Pmt\n' + desc;
  return [
    formatDisplayDate(t.date),
    desc,
    t.type,
    isOut ? 'Rs ' + fmtAmt(amt) : '-',
    !isOut ? 'Rs ' + fmtAmt(amt) : '-',
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
    const origIn  = ms.originalIn  != null ? 'In: Rs '  + fmtAmt(ms.originalIn) : '';
    const origOut = ms.originalOut != null ? 'Out: Rs ' + fmtAmt(ms.originalOut) : '';
    const summary = [periodLabel, countLabel, origIn, origOut].filter(Boolean).join('\n');
    row[1] = summary.substring(0, 70);
    return row;
  });
  const mTotOut = mergedTxns.filter(t => t.type === 'OUT').reduce((s,t) => s+(parseFloat(t.amount)||0), 0);
  const mTotIn  = mergedTxns.filter(t => t.type === 'IN' ).reduce((s,t) => s+(parseFloat(t.amount)||0), 0);
  const mFin    = mTotIn - mTotOut;
  mergedRows.push(['', 'SUBTOTAL', '', 'Rs '+fmtAmt(mTotOut), 'Rs '+fmtAmt(mTotIn),
    Math.abs(mFin)<0.01?'SETTLED':'Rs '+fmtAmt(Math.abs(mFin))]);
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
      const isSubtotal = data.row.index === mergedRows.length - 1;
      if (isSubtotal) {
        data.cell.styles.fillColor = [230, 210, 255];
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fontSize  = 8.5;
      } else {
        data.cell.styles.fillColor = PDF_MERGED_ROW_COLOR;
        data.cell.styles.textColor = [80, 40, 120];
      }
      if (data.column.index === 2 && !isSubtotal)
        data.cell.styles.textColor = data.cell.text[0] === 'OUT' ? [180, 40, 40] : [40, 130, 60];
      if (data.column.index === 3 && !isSubtotal) data.cell.styles.textColor = [180, 40, 40];
      if (data.column.index === 4 && !isSubtotal) data.cell.styles.textColor = [40, 130, 60];
      if (data.column.index === 5 && !isSubtotal) {
        const txt = (data.cell.text||[]).join('');
        data.cell.styles.textColor = txt==='SETTLED'?[100,100,100]:[126,34,206];
      }
    },
    margin: { left: 14, right: 14 }
  });
  yPos = doc.lastAutoTable.finalY + 6;
  if (yPos > 255) { doc.addPage(); yPos = 20; }
}
let runningBalance = 0;
const txRunBal = { val: 0 };
const txRows = normalTxns.map(t => buildTxRow(t, txRunBal));
const totalOut = normalTxns.filter(t => t.type === 'OUT').reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
const totalIn  = normalTxns.filter(t => t.type === 'IN' ).reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
const finalBal = totalIn - totalOut;
let finalBalDisplay;
if (Math.abs(finalBal) < 0.01) finalBalDisplay = 'SETTLED';
else finalBalDisplay = 'Rs ' + fmtAmt(Math.abs(finalBal));
if (normalTxns.length > 0) {
  doc.setFontSize(8.5); doc.setFont(undefined, 'bold');
  doc.setTextColor(...headerColor);
  doc.text('INDIVIDUAL TRANSACTIONS', 14, yPos);
  doc.setTextColor(80, 80, 80); doc.setFont(undefined, 'normal');
  yPos += 5;
  txRows.push(['', 'TOTAL', '', 'Rs ' + fmtAmt(totalOut), 'Rs ' + fmtAmt(totalIn), finalBalDisplay]);
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
      const isTotal = data.row.index === txRows.length - 1;
      if (isTotal) { data.cell.styles.fontStyle='bold'; data.cell.styles.fillColor=[240,240,240]; data.cell.styles.fontSize=9; }
      if (data.column.index===2 && !isTotal)
        data.cell.styles.textColor = data.cell.text[0]==='OUT'?[220,53,69]:[40,167,69];
      if (data.column.index===5 && !isTotal) {
        const txt=(data.cell.text||[]).join('');
        if (txt.includes('SETTLED')) data.cell.styles.textColor=[100,100,100];
        else if (txt.includes('OWE')) data.cell.styles.textColor=[220,53,69];
        else data.cell.styles.textColor=[40,167,69];
      }
    },
    margin: { left: 14, right: 14 }
  });
}
const afterTx = (normalTxns.length > 0 ? doc.lastAutoTable.finalY : yPos - 5) + 5;
if (afterTx < 270) {
doc.setFillColor(245, 245, 245);
doc.roundedRect(14, afterTx, pageW - 28, 14, 2, 2, 'F');
doc.setFontSize(8.5); doc.setFont(undefined, 'normal');
doc.setTextColor(220, 53, 69);
doc.text(`Total OUT: Rs ${fmtAmt(totalOut)}`, 20, afterTx + 9);
doc.setTextColor(40, 167, 69);
doc.text(`Total IN: Rs ${fmtAmt(totalIn)}`, 75, afterTx + 9);
doc.setTextColor(Math.abs(finalBal) < 0.01 ? 100 : finalBal < 0 ? 220 : 40,
Math.abs(finalBal) < 0.01 ? 100 : finalBal < 0 ? 53 : 167,
Math.abs(finalBal) < 0.01 ? 100 : finalBal < 0 ? 69 : 69);
doc.setFont(undefined, 'bold');
doc.text(`Net Balance: ${finalBalDisplay}`, 138, afterTx + 9);
yPos = afterTx + 18;
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
'Rs ' + fmtAmt(originalAmt),
paid > 0 ? 'Rs ' + fmtAmt(paid) : '-',
remaining > 0 ? 'Rs ' + fmtAmt(remaining) : '-',
status
];
});
matRows.push([
'', 'TOTAL', '',
'Rs ' + fmtAmt(totalInvoice),
'Rs ' + fmtAmt(totalPaid),
'Rs ' + fmtAmt(totalRemaining),
totalRemaining <= 0 ? 'CLEARED' : ''
]);
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
const isTotal = data.row.index === matRows.length - 1;
if (isTotal) {
data.cell.styles.fontStyle = 'bold';
data.cell.styles.fillColor = [255, 245, 230];
data.cell.styles.fontSize = 9;
}
if (data.column.index === 6 && !isTotal) {
const txt = (data.cell.text || []).join('');
if (txt === 'PAID') data.cell.styles.textColor = [40, 167, 69];
if (txt === 'PARTIAL') data.cell.styles.textColor = [200, 100, 0];
if (txt === 'PENDING') data.cell.styles.textColor = [220, 53, 69];
}
},
margin: { left: 14, right: 14 }
});
const afterMat = doc.lastAutoTable.finalY + 5;
if (afterMat < 272) {
doc.setFillColor(255, 245, 230);
doc.roundedRect(14, afterMat, pageW - 28, 14, 2, 2, 'F');
doc.setFontSize(8.5); doc.setFont(undefined, 'normal');
doc.setTextColor(50, 50, 50);
doc.text(`Total Invoiced: Rs ${fmtAmt(totalInvoice)}`, 20, afterMat + 9);
doc.setTextColor(40, 167, 69);
doc.text(`Paid: Rs ${fmtAmt(totalPaid)}`, 88, afterMat + 9);
doc.setTextColor(totalRemaining > 0 ? 220 : 100, totalRemaining > 0 ? 53 : 100, totalRemaining > 0 ? 69 : 100);
doc.setFont(undefined, 'bold');
doc.text(`Outstanding Payable: Rs ${fmtAmt(totalRemaining)}`, 138, afterMat + 9);
}
}
const pageCount = doc.internal.getNumberOfPages();
for (let i = 1; i <= pageCount; i++) {
doc.setPage(i);
doc.setFontSize(7); doc.setTextColor(160);
doc.text(
`Generated on ${now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} at ${now.toLocaleTimeString('en-US')} | GULL AND ZUBAIR NASWAR DEALERS`,
pageW / 2, 291, { align: 'center' }
);
doc.text(`Page ${i} of ${pageCount}`, pageW / 2, 287, { align: 'center' });
}
await new Promise(r => setTimeout(r, 100));
const filename = `Entity_Statement_${entity.name.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
doc.save(filename);
showToast("PDF exported successfully", "success");
} catch (error) {
showToast("Error generating PDF: " + error.message, "error");
}
}
async function exportCustomerToPDF() {
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
let transactions = customerSales.filter(s =>
s &&
s.customerName === customerName
);
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
if (range !== 'all') {
transactions = transactions.filter(t => {
if (t.transactionType === 'OLD_DEBT') return true;
if (!t.date) return false;
const d = new Date(t.date);
switch(range) {
case 'today': return d >= today;
case 'week': { const w = new Date(today); w.setDate(w.getDate() - 7); return d >= w; }
case 'month': { const m = new Date(today); m.setMonth(m.getMonth() - 1); return d >= m; }
case 'year': { const y = new Date(today); y.setFullYear(y.getFullYear() - 1); return d >= y; }
default: return true;
}
});
}
transactions.sort((a, b) => {
if (a.isMerged && !b.isMerged) return -1;
if (!a.isMerged && b.isMerged) return 1;
const ap = (a.paymentType === 'CREDIT' && !a.creditReceived) ? 1 : 0;
const bp = (b.paymentType === 'CREDIT' && !b.creditReceived) ? 1 : 0;
if (bp !== ap) return bp - ap;
return new Date(a.date) - new Date(b.date);
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
doc.text('Naswar Manufacturers & Dealers · Sales Tab Statement', pageW / 2, 17, { align: 'center' });
const rangeName = range === 'all' ? 'All Time' : range === 'today' ? 'Today' :
range === 'week' ? 'This Week' : range === 'month' ? 'This Month' : 'This Year';
doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.setTextColor(50, 50, 50);
doc.text(`Customer Account Statement · ${rangeName}`, pageW / 2, 30, { align: 'center' });
doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(80, 80, 80);
let yPos = 38;
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
const getSalePrice = (t) => {
  if (t.unitPrice && t.unitPrice > 0) return t.unitPrice;
  return getEffectiveSalePriceForCustomer(t.customerName, t.supplyStore || 'STORE_A');
};
const buildSaleRow = (t, runBal) => {
  const pt = t.paymentType || 'CASH';
  const isOldDebt = t.transactionType === 'OLD_DEBT';
  let debit = 0, credit = 0, typeLabel = '', detailLabel = '', displayDate = formatDisplayDate(t.date);
  if (isOldDebt) {
    debit = parseFloat(t.totalValue) || 0;
    credit = parseFloat(t.partialPaymentReceived) || 0;
    typeLabel = 'OLD DEBT';
    detailLabel = t.notes || 'Brought forward from previous records';
  } else if (pt === 'CASH') {
    const val = getSaleTransactionValue(t);
    debit = val; credit = val;
    typeLabel = 'CASH';
    detailLabel = `${fmtAmt(t.quantity||0)} kg \xd7 Rs ${fmtAmt(getSalePrice(t))}\n${t.supplyStore?getStoreLabel(t.supplyStore):''}`;
  } else if (pt === 'CREDIT' && !t.creditReceived) {
    const val = getSaleTransactionValue(t);
    const partial = parseFloat(t.partialPaymentReceived) || 0;
    debit = val; credit = partial;
    typeLabel = partial > 0 ? 'CREDIT\n(PARTIAL)' : 'CREDIT';
    detailLabel = `${fmtAmt(t.quantity||0)} kg \xd7 Rs ${fmtAmt(getSalePrice(t))}`;
    if (partial > 0) detailLabel += `\nPaid: Rs ${fmtAmt(partial)} | Due: Rs ${fmtAmt(val-partial)}`;
  } else if (pt === 'CREDIT' && t.creditReceived) {
    const val = getSaleTransactionValue(t);
    debit = val; credit = val;
    typeLabel = 'CREDIT\n(PAID)';
    detailLabel = `${fmtAmt(t.quantity||0)} kg \xd7 Rs ${fmtAmt(getSalePrice(t))}`;
    displayDate = formatDisplayDate(t.creditReceivedDate || t.date);
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
  else if (runBal.val > 0) balDisplay = 'Rs ' + fmtAmt(runBal.val);
  else balDisplay = 'OVERPAID\nRs ' + fmtAmt(Math.abs(runBal.val));
  return { row: [displayDate, typeLabel, detailLabel.substring(0,55),
    debit>0?'Rs '+fmtAmt(debit):'-', credit>0?'Rs '+fmtAmt(credit):'-', balDisplay],
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
      cashS > 0 ? `Cash sales: Rs ${fmtAmt(cashS)}` : '',
      !isSettled ? `Net due: Rs ${fmtAmt(netOut)}` : 'Settled'
    ].filter(Boolean).join('\n');
    mRunBal.val += netOut;
    const balTxt = isSettled ? 'SETTLED' : 'Rs ' + fmtAmt(netOut);
    const pt = t.paymentType || 'CASH';
    const typeLabel = isSettled ? 'SETTLED\n(MERGED)' : (pt === 'CREDIT' ? 'CREDIT\n(MERGED)' : 'CASH\n(MERGED)');
    return [formatDisplayDate(t.date), typeLabel, details.substring(0,70),
      netOut>0?'Rs '+fmtAmt(netOut):'-', isSettled?'Rs '+fmtAmt(cashS):'-', balTxt];
  });
  const mNetTotal = mergedSalesTxns.reduce((s,t)=>{
    const ms=t.mergedSummary||{}; return s+(ms.netOutstanding||t.totalValue||0);},0);
  mergedRows.push(['','SUBTOTAL',`${mergedSalesTxns.length} year-end record${mergedSalesTxns.length!==1?'s':''}`,
    mNetTotal>0?'Rs '+fmtAmt(mNetTotal):'-','',
    mNetTotal<=0.01?'SETTLED':'Rs '+fmtAmt(mNetTotal)]);
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
      const isSubtotal = data.row.index === mergedRows.length - 1;
      if (isSubtotal) { data.cell.styles.fillColor=[230,210,255]; data.cell.styles.fontStyle='bold'; }
      else { data.cell.styles.fillColor=PDF_MERGED_ROW_COLOR; data.cell.styles.textColor=[80,40,120]; }
      if (data.column.index===3&&!isSubtotal) data.cell.styles.textColor=[180,40,40];
      if (data.column.index===4&&!isSubtotal) data.cell.styles.textColor=[40,130,60];
      if (data.column.index===5&&!isSubtotal) {
        const txt=(data.cell.text||[]).join('');
        data.cell.styles.textColor = txt==='SETTLED'?[100,100,100]:[126,34,206];
      }
    },
    margin: { left: 14, right: 14 }
  });
  yPos = doc.lastAutoTable.finalY + 6;
  if (yPos > 255) { doc.addPage(); yPos = 20; }
}
const txRows = [];
const txRunBal = { val: 0 };
let totDebit = 0, totCredit = 0, totQty = 0;
for (const t of normalSalesTxns) {
  const r = buildSaleRow(t, txRunBal);
  txRows.push(r.row);
  totDebit  += r.debit;
  totCredit += r.credit;
  totQty    += r.qty;
}
const finalBal = totDebit - totCredit;
if (normalSalesTxns.length > 0) {
  doc.setFontSize(8.5); doc.setFont(undefined,'bold');
  doc.setTextColor(...hdrColor);
  doc.text('INDIVIDUAL TRANSACTIONS', 14, yPos);
  doc.setTextColor(80,80,80); doc.setFont(undefined,'normal');
  yPos += 5;
  txRows.push(['TOTALS','',`${fmtAmt(totQty)} kg total`,
    'Rs '+fmtAmt(totDebit),'Rs '+fmtAmt(totCredit),
    Math.abs(finalBal)<0.01?'SETTLED':(finalBal>0?'DUE\nRs '+fmtAmt(finalBal):'OVERPAID\nRs '+fmtAmt(Math.abs(finalBal)))]);
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
      const isTotal = data.row.index === txRows.length - 1;
      if (isTotal) { data.cell.styles.fontStyle='bold'; data.cell.styles.fillColor=[235,255,235]; data.cell.styles.fontSize=9; }
      if (data.column.index===1&&!isTotal){
        const txt=(data.cell.text||[]).join('');
        if(txt.includes('CASH')) data.cell.styles.textColor=[40,167,69];
        if(txt.includes('CREDIT')) data.cell.styles.textColor=[200,100,0];
        if(txt.includes('COLLECTION')) data.cell.styles.textColor=[40,167,69];
        if(txt.includes('PARTIAL')) data.cell.styles.textColor=[200,100,0];
        if(txt.includes('OLD DEBT')) data.cell.styles.textColor=[220,53,69];
      }
      if (data.column.index===5&&!isTotal){
        const txt=(data.cell.text||[]).join('');
        if(txt==='SETTLED') data.cell.styles.textColor=[100,100,100];
        else if(txt.includes('OVERPAID')) data.cell.styles.textColor=[40,167,69];
        else data.cell.styles.textColor=[220,53,69];
      }
    },
    margin: { left: 14, right: 14 }
  });
}
const afterY = (normalSalesTxns.length > 0 ? doc.lastAutoTable.finalY : yPos - 5) + 5;
if (afterY < 268) {
doc.setFillColor(245, 255, 245);
doc.roundedRect(14, afterY, pageW - 28, 20, 2, 2, 'F');
doc.setDrawColor(...hdrColor); doc.setLineWidth(0.3);
doc.roundedRect(14, afterY, pageW - 28, 20, 2, 2, 'S');
doc.setFontSize(8); doc.setFont(undefined, 'normal');
doc.setTextColor(220, 53, 69);
doc.text(`Total Debit (Sales): Rs ${fmtAmt(totDebit)}`, 20, afterY + 7);
doc.setTextColor(40, 167, 69);
doc.text(`Total Credit (Rcvd): Rs ${fmtAmt(totCredit)}`, 20, afterY + 14);
doc.setTextColor(Math.abs(finalBal) < 0.01 ? 100 : finalBal > 0 ? 220 : 40,
Math.abs(finalBal) < 0.01 ? 100 : finalBal > 0 ? 53 : 167,
Math.abs(finalBal) < 0.01 ? 100 : finalBal > 0 ? 69 : 69);
doc.setFont(undefined, 'bold');
const balStr = Math.abs(finalBal) < 0.01 ? 'SETTLED'
: finalBal > 0 ? `Outstanding Due: Rs ${fmtAmt(finalBal)}`
: `Overpaid by: Rs ${fmtAmt(Math.abs(finalBal))}`;
doc.text(balStr, 110, afterY + 10.5);
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
`Generated on ${now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} at ${now.toLocaleTimeString('en-US')} | GULL AND ZUBAIR NASWAR DEALERS`,
pageW / 2, 291, { align: 'center' }
);
doc.text(`Page ${i} of ${pageCount}`, pageW / 2, 287, { align: 'center' });
}
await new Promise(r => setTimeout(r, 100));
const filename = `Customer_Statement_${customerName.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
doc.save(filename);
showToast("PDF exported successfully", "success");
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
const _CHARTJS_URLS = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.4/chart.umd.min.js',
  'https://unpkg.com/chart.js@4.4.4/dist/chart.umd.min.js'
];
let _chartJsPromise = null;
function loadChartJs() {
  if (window.Chart) return Promise.resolve();
  if (_chartJsPromise) return _chartJsPromise;
  _chartJsPromise = (async () => {
    for (const url of _CHARTJS_URLS) {
      try {
        await loadScript(url);
        if (window.Chart) return;
      } catch (e) {
        console.warn('Chart.js CDN failed, trying next:', url, e.message);
      }
    }
    _chartJsPromise = null;
    throw new Error('Chart.js could not be loaded from any CDN.');
  })();
  return _chartJsPromise;
}
let currentCashTrackerMode = 'day';
function setCashTrackerMode(mode) {
currentCashTrackerMode = mode;
document.querySelectorAll('#tab-payments .toggle-group .toggle-opt').forEach(opt => {
opt.classList.remove('active');
});
const parent = event.target.parentElement;
parent.querySelectorAll('.toggle-opt').forEach(opt => {
opt.classList.remove('active');
});
event.target.classList.add('active');
calculateCashTracker();
}
function calculateCashTracker() {
const paymentDateEl = document.getElementById('paymentDate');
const selectedDate = (paymentDateEl && paymentDateEl.value) || new Date().toISOString().split('T')[0];
const selectedDateObj = new Date(selectedDate);
const selectedYear = selectedDateObj.getFullYear();
const selectedMonth = selectedDateObj.getMonth();
let startDate = new Date(selectedDate);
let endDate = new Date(selectedDate);
startDate.setHours(0,0,0,0);
endDate.setHours(23,59,59,999);
if (currentCashTrackerMode === 'week') {
startDate.setDate(selectedDateObj.getDate() - 6);
} else if (currentCashTrackerMode === 'month') {
startDate = new Date(selectedYear, selectedMonth, 1);
endDate = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59);
} else if (currentCashTrackerMode === 'year') {
startDate = new Date(selectedYear, 0, 1);
endDate = new Date(selectedYear, 11, 31, 23, 59, 59);
} else if (currentCashTrackerMode === 'all') {
startDate = new Date('2000-01-01');
endDate = new Date('2100-12-31');
}
let rawData = {
totalProductionValue: 0,
totalProductionQuantity: 0,
salesCash: 0,
salesCredits: 0,
calculatorCash: 0,
calculatorCredits: 0,
calculatorRecovered: 0,
paymentsIn: 0,
paymentsOut: 0,
expenses: 0
};
db.forEach(item => {
if (item.isReturn) return;
const itemDate = new Date(item.date);
if (itemDate >= startDate && itemDate <= endDate) {
rawData.totalProductionValue += item.totalSale || 0;
rawData.totalProductionQuantity += item.net || 0;
}
});
customerSales.forEach(sale => {
const saleDate = new Date(sale.date);
if (saleDate >= startDate && saleDate <= endDate) {
const isRepLinked = sale.salesRep && sale.salesRep !== 'NONE';
if (sale.isMerged && sale.mergedSummary) {
const ms = sale.mergedSummary;
rawData.salesCash    += (ms.cashSales    || 0);
rawData.salesCredits += (ms.unpaidCredit || 0);
} else if (sale.paymentType === 'CREDIT' && !sale.creditReceived) {

const partialPaid = sale.partialPaymentReceived || 0;
rawData.salesCredits += Math.max(0, (sale.totalValue || 0) - partialPaid);
} else if (isRepLinked) {

rawData.salesCredits += sale.totalValue || 0;
} else {

if (sale.paymentType === 'CASH' || sale.creditReceived) {
rawData.salesCash += sale.totalValue || 0;
} else if (sale.paymentType === 'COLLECTION') {
rawData.salesCash += sale.totalValue || 0;
rawData.salesCredits -= sale.totalValue || 0;
} else if (sale.paymentType === 'PARTIAL_PAYMENT') {
rawData.salesCash += sale.totalValue || 0;
rawData.salesCredits -= sale.totalValue || 0;
}
}
}
});
salesHistory.forEach(item => {
const itemDate = new Date(item.date);
if (itemDate >= startDate && itemDate <= endDate) {
rawData.calculatorCash += item.received || 0;
rawData.calculatorCredits += item.creditValue || 0;
rawData.calculatorRecovered += item.prevColl || 0;
}
});
paymentTransactions.forEach(transaction => {
const transDate = new Date(transaction.date);
if (transDate >= startDate && transDate <= endDate) {
if (transaction.type === 'IN') {
rawData.paymentsIn += transaction.amount;
} else if (transaction.type === 'OUT') {
if (transaction.isExpense && transaction.category === 'operating') {
rawData.expenses += transaction.amount;
}
else if (!transaction.isExpense) {
rawData.paymentsOut += transaction.amount;
}
}
}
});
if (Array.isArray(expenseRecords)) {
expenseRecords.forEach(exp => {
if (exp.isMerged !== true) return;
if (exp.category !== 'operating') return;
const expDate = new Date(exp.date);
if (expDate >= startDate && expDate <= endDate) {
rawData.expenses += (parseFloat(exp.amount) || 0);
}
});
}
const netSalesCash = rawData.salesCash;
const netSalesCredits = rawData.salesCredits;
const netCalculatorDebt = rawData.calculatorCredits - rawData.calculatorRecovered;
const finalTotals = {
productionValue: rawData.totalProductionValue,
productionQuantity: rawData.totalProductionQuantity,
salesTabCash: netSalesCash,
salesTabCredits: netSalesCredits,
calculatorCash: rawData.calculatorCash,
calculatorCredits: netCalculatorDebt,
paymentsIn: rawData.paymentsIn,
paymentsOut: rawData.paymentsOut,
expenses: rawData.expenses
};
const netCash = finalTotals.productionValue +
finalTotals.salesTabCash + finalTotals.calculatorCash +
finalTotals.paymentsIn - finalTotals.paymentsOut - finalTotals.expenses;
const totalCredits = finalTotals.salesTabCredits +
finalTotals.calculatorCredits;
const elCashProdValue = document.getElementById('cash-prod-value');
if (elCashProdValue) elCashProdValue.textContent = `Rs ${fmtAmt(safeValue(finalTotals.productionValue))}`;
const elCashSalesCash = document.getElementById('cash-sales-cash');
if (elCashSalesCash) elCashSalesCash.textContent = `Rs ${fmtAmt(safeValue(finalTotals.salesTabCash))}`;
const elCashCalcCash = document.getElementById('cash-calculator-cash');
if (elCashCalcCash) elCashCalcCash.textContent = `Rs ${fmtAmt(safeValue(finalTotals.calculatorCash))}`;
const elCashPayIn = document.getElementById('cash-payments-in');
if (elCashPayIn) elCashPayIn.textContent = `Rs ${fmtAmt(safeValue(finalTotals.paymentsIn))}`;
const elCashPayOut = document.getElementById('cash-payments-out');
if (elCashPayOut) elCashPayOut.textContent = `Rs ${fmtAmt(safeValue(finalTotals.paymentsOut))}`;
const elCashExpenses = document.getElementById('cash-expenses');
if (elCashExpenses) elCashExpenses.textContent = `Rs ${fmtAmt(safeValue(finalTotals.expenses))}`;
const elCashNet = document.getElementById('cash-net-total');
if (elCashNet) {
elCashNet.textContent = `Rs ${fmtAmt(safeValue(netCash))}`;
if (netCash < 0) {
elCashNet.style.color = 'var(--danger)';
} else {
elCashNet.style.color = 'var(--accent-emerald)';
}
}
const elCreditSales = document.getElementById('credit-sales-tab');
if (elCreditSales) elCreditSales.textContent = `Rs ${fmtAmt(safeValue(finalTotals.salesTabCredits))}`;
const elCreditCalc = document.getElementById('credit-calculator');
if (elCreditCalc) elCreditCalc.textContent = `Rs ${fmtAmt(safeValue(finalTotals.calculatorCredits))}`;
const elCreditTotal = document.getElementById('credit-total');
if (elCreditTotal) elCreditTotal.textContent = `Rs ${fmtAmt(safeValue(totalCredits))}`;
return finalTotals;
}
function updateEconomicDashboardWithNetValues(totals, totalCredits) {
const operatingCashFlow = totals.salesTabCash + totals.calculatorCash;
const operatingCashElement = document.getElementById('operatingCashFlow');
if (operatingCashElement) {
operatingCashElement.textContent = `${fmtAmt(safeValue(operatingCashFlow))}`;
}
document.getElementById('cashDetailDirectSales').textContent = `${fmtAmt(safeValue(totals.salesTabCash))}`;
document.getElementById('cashDetailRepCollections').textContent = `${fmtAmt(safeValue(totals.calculatorCash))}`;
const creditTotalElement = document.getElementById('formulaSalesCredit');
if (creditTotalElement) {
creditTotalElement.textContent = `${fmtAmt(safeValue(totalCredits))}`;
}
const salesReceivablesElement = document.getElementById('salesReceivables');
if (salesReceivablesElement) {
salesReceivablesElement.textContent = `${fmtAmt(safeValue(totals.salesTabCredits))}`;
}
const productionValueElement = document.getElementById('formulaProdTotal');
if (productionValueElement) {
productionValueElement.textContent = `${fmtAmt(safeValue(totals.productionValue))}`;
}
}
function openEntityTransactions(entityId) {
const entity = paymentEntities.find(e => String(e.id) === String(entityId));
if (!entity) return;
const entityTransactions = paymentTransactions.filter(t => String(t.entityId) === String(entityId));
let totalIn = 0, totalOut = 0;
entityTransactions.forEach(t => {
const amount = parseFloat(t.amount) || 0;
if (t.type === 'IN') totalIn += amount;
else if (t.type === 'OUT') totalOut += amount;
});
const netBalance = totalIn - totalOut;
const _setTC = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
_setTC('entityTransactionsTitle', `${entity.name || 'Unknown'} - Transactions`);
_setTC('entityTotalIn', `${fmtAmt(totalIn)}`);
_setTC('entityTotalOut', `${fmtAmt(totalOut)}`);
_setTC('entityNetBalance', `${fmtAmt(netBalance)}`);
_setTC('entityTotalTransactions', entityTransactions.length);
const transactionsList = document.getElementById('entityTransactionsList');
if (entityTransactions.length === 0) {
transactionsList.replaceChildren(Object.assign(document.createElement('div'), {textContent:'No transactions found for this entity.',style:'text-align:center;padding:40px;color:var(--text-muted)'}));
} else {
const _etFrag = document.createDocumentFragment();
const sortedTransactions = [...entityTransactions].sort((a, b) => b.timestamp - a.timestamp);
sortedTransactions.forEach(transaction => {
const transactionCard = document.createElement('div');
transactionCard.className = 'liquid-card';
transactionCard.style.padding = '15px';
transactionCard.style.position = 'relative';
const badgeClass = transaction.type === 'IN' ? 'transaction-in' : 'transaction-out';
const badgeText = transaction.type === 'IN' ? 'IN' : 'OUT';
const amountClass = transaction.type === 'IN' ? 'profit-val' : 'cost-val';
const safeAmount = parseFloat(transaction.amount) || 0;
const etCreatorBadge = (typeof _creatorBadgeHtml === 'function') ? _creatorBadgeHtml(transaction) : '';
transactionCard.innerHTML = `
<span class="transaction-badge ${badgeClass}" style="position: absolute; top: 10px; right: 10px;">${badgeText}</span>
<div style="margin-bottom: 8px;">
<strong style="color: var(--accent); font-size: 0.9rem;">${transaction.date ? formatDisplayDate(transaction.date) : 'N/A'}</strong>
<span style="color: var(--text-muted); font-size: 0.75rem; margin-left: 10px;">${esc(transaction.time || '')}</span>
</div>
<div style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 8px;">
${esc(transaction.description || 'No description')}${etCreatorBadge}
</div>
<div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--glass-border);">
<span class="u-fs-sm2 u-text-muted" >Amount:</span>
<span class="${amountClass}" style="font-size: 1.1rem; font-weight: 800;">${fmtAmt(safeAmount)}</span>
</div>
`;
_etFrag.appendChild(transactionCard);
});
transactionsList.replaceChildren(_etFrag);
}
requestAnimationFrame(() => {
document.body.style.overflow = 'hidden';
document.documentElement.style.overflow = 'hidden';
document.getElementById('entityTransactionsOverlay').style.display = 'flex';
});
}
function closeEntityTransactions() {
requestAnimationFrame(() => {
document.body.style.overflow = '';
document.documentElement.style.overflow = '';
document.getElementById('entityTransactionsOverlay').style.display = 'none';
});
}
async function savePaymentTransaction() {
const entityInput = document.getElementById('paymentEntity');
const dateEl = document.getElementById('paymentDate');
const amountEl = document.getElementById('paymentAmount');
const descriptionEl = document.getElementById('paymentDescription');
if (!entityInput || !dateEl || !amountEl || !descriptionEl) {
showToast("Payment form not ready. Please try again.", 'error');
return;
}
const entityId = (entityInput.getAttribute('data-entity-id') || entityInput.value || '').trim();
const date = dateEl.value;
const amount = parseFloat(amountEl.value) || 0;
const description = descriptionEl.value.trim();
const type = window._expenseCategory || 'operating';
if (!entityId) {
showToast("Please select an entity", 'warning');
return;
}
if (!date) {
showToast("Please select a date", 'warning');
return;
}
if (amount <= 0) {
showToast("Please enter a valid amount", 'warning');
return;
}
if (!description) {
showToast("Please enter a description", 'warning');
return;
}
const entity = paymentEntities.find(e => String(e.id) === String(entityId));
if (!entity) {
showToast("Selected entity not found", 'error');
return;
}
const now = new Date();
let hours = now.getHours();
const minutes = now.getMinutes();
const seconds = now.getSeconds();
const ampm = hours >= 12 ? 'PM' : 'AM';
hours = hours % 12;
hours = hours ? hours : 12;
const timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')} ${ampm}`;
let isPayable = false;
let materialId = null;
try {
if (type === 'OUT') {
const pendingMaterials = factoryInventoryData
.filter(m =>
String(m.supplierId) === String(entityId) &&
m.paymentStatus === 'pending' &&
m.totalPayable > 0
)
.sort((a, b) => {
const da = new Date(a.purchaseDate || a.date || a.createdAt || 0).getTime();
const db = new Date(b.purchaseDate || b.date || b.createdAt || 0).getTime();
return da - db;
});
if (pendingMaterials.length > 0) {
let remaining = amount;
const materialsToSave = [];
for (const mat of pendingMaterials) {
if (remaining <= 0) break;
if (remaining >= mat.totalPayable) {
remaining -= mat.totalPayable;
mat.totalPayable = 0;
mat.paymentStatus = 'paid';
mat.paidDate = date;
mat.updatedAt = getTimestamp();
} else {
mat.totalPayable = parseFloat((mat.totalPayable - remaining).toFixed(2));
remaining = 0;
mat.updatedAt = getTimestamp();
}
ensureRecordIntegrity(mat, true);
materialsToSave.push(mat);
if (!materialId) materialId = mat.id;
}
if (materialsToSave.length > 0) {
isPayable = true;
for (const mat of materialsToSave) {
await unifiedSave('factory_inventory_data', factoryInventoryData, mat);
}
}
}
}
let payId = generateUUID('pay');
if (!validateUUID(payId)) {
payId = generateUUID('pay');
}
const payCreatedAt = getTimestamp();
let payment = {
id: payId,
createdAt: payCreatedAt,
updatedAt: payCreatedAt,
entityId: entityId,
entityName: entity.name,
entityType: entity.type,
date: date,
time: timeString,
amount: amount,
description: description,
type: type,
materialId: materialId,
isPayable: isPayable,
timestamp: payCreatedAt,
syncedAt: new Date().toISOString(),
createdBy: (appMode === 'userrole' && window._assignedManagerName) ? window._assignedManagerName : null
};
payment = ensureRecordIntegrity(payment, false);
paymentTransactions.push(payment);
await unifiedSave('payment_transactions', paymentTransactions, payment);
notifyDataChange('payments');
emitSyncUpdate({ payment_transactions: paymentTransactions });
if (amountEl) amountEl.value = '';
if (descriptionEl) descriptionEl.value = '';
const typeOutEl = document.getElementById('payment-type-out');
if (typeOutEl) typeOutEl.checked = true;
if (typeof refreshPaymentTab === 'function') await refreshPaymentTab();
if (typeof calculateNetCash === 'function') calculateNetCash();
if (typeof calculateCashTracker === 'function') calculateCashTracker();
if (isPayable) {
if (typeof renderFactoryInventory === 'function') renderFactoryInventory();
}

if (typeof renderUnifiedTable === 'function') renderUnifiedTable(1);
let message = `Payment ${type === 'IN' ? 'received from' : 'made to'} ${entity.name}`;
if (isPayable) {
message += ' (Material purchase settled - liability reduced)';
}
} catch (error) {
showToast('Failed to save payment transaction. Please try again.', 'error');
return;
}
showToast(message, 'success');
}
async function deletePaymentTransaction(id) {
if (!id || !validateUUID(id)) {
showToast('Invalid transaction ID', 'error');
return;
}
const _dpTx = paymentTransactions.find(t => t.id === id);
if (_dpTx && _dpTx.isMerged) {
showToast('Merged opening balance records cannot be deleted', 'warning');
return;
}
const _dpEntity = _dpTx ? paymentEntities.find(e => String(e.id) === String(_dpTx.entityId)) : null;
const _dpEntityName = _dpEntity ? _dpEntity.name : 'Unknown Entity';
const _dpTypeLabel = _dpTx?.type === 'IN' ? 'Payment Received (IN)' : 'Payment Made (OUT)';
const _dpAmount = (parseFloat(_dpTx?.amount) || 0).toFixed(2);
const _dpDate = _dpTx?.date || 'Unknown date';
let _dpMsg = `Delete this ${_dpTypeLabel}?`;
_dpMsg += `\n\nEntity: ${_dpEntityName}`;
_dpMsg += `\nAmount: ${_dpAmount}`;
_dpMsg += `\nDate: ${_dpDate}`;
if (_dpTx?.description) _dpMsg += `\nNote: ${_dpTx.description}`;
_dpMsg += `\n\nThis cannot be undone.`;
if (await showGlassConfirm(_dpMsg, { title: `Delete ${_dpTx?.type === 'IN' ? 'Payment IN' : 'Payment OUT'}`, confirmText: "Delete", danger: true })) {
try {
const transaction = paymentTransactions.find(t => t.id === id);
if (!transaction) {
if (typeof refreshPaymentTab === 'function') await refreshPaymentTab();
if (typeof calculateNetCash === 'function') calculateNetCash();
return;
}
paymentTransactions = paymentTransactions.filter(t => t.id !== id);
await unifiedDelete('payment_transactions', paymentTransactions, id, { strict: true }, transaction);
notifyDataChange('payments');
if (typeof refreshPaymentTab === 'function') await refreshPaymentTab();
if (typeof calculateNetCash === 'function') calculateNetCash();
if (typeof calculateCashTracker === 'function') calculateCashTracker();
if (typeof renderFactoryInventory === 'function') renderFactoryInventory();
if (typeof renderUnifiedTable === 'function') renderUnifiedTable(1);
showToast(" Transaction deleted and all views restored successfully!", "success");
} catch (error) {
showToast(" Failed to delete transaction. Please try again.", "error");
}
}
}
function filterPaymentHistory() {
const searchTerm = document.getElementById('payment-search').value.toLowerCase();
const allCards = document.querySelectorAll('#paymentHistoryList .card');
allCards.forEach(card => {
const cardText = card.textContent.toLowerCase();
if (cardText.includes(searchTerm)) {
card.style.display = '';
} else {
card.style.display = 'none';
}
});
}
function calculateNetCash() {
try {
let rawData = {
totalProductionValue: 0,
totalProductionQuantity: 0,
salesCash: 0,
salesCredits: 0,
calculatorCash: 0,
calculatorTotalIssued: 0,
calculatorTotalRecovered: 0,
paymentsIn: 0,
paymentsOut: 0
};
db.forEach(item => {
if (item.isReturn) return;
rawData.totalProductionValue += item.totalSale || 0;
rawData.totalProductionQuantity += item.net || 0;
});
customerSales.forEach(sale => {
const isRepLinked = sale.salesRep && sale.salesRep !== 'NONE';
if (sale.isMerged && sale.mergedSummary) {
const ms = sale.mergedSummary;
rawData.salesCash    += (ms.cashSales    || 0);
rawData.salesCredits += (ms.unpaidCredit || 0);
} else if (sale.paymentType === 'CREDIT' && !sale.creditReceived) {

const partialPaid = sale.partialPaymentReceived || 0;
rawData.salesCredits += Math.max(0, (sale.totalValue || 0) - partialPaid);
} else if (isRepLinked) {

rawData.salesCredits += sale.totalValue || 0;
} else {

if (sale.paymentType === 'CASH' || sale.creditReceived) {
rawData.salesCash += sale.totalValue || 0;
} else if (sale.paymentType === 'COLLECTION') {
rawData.salesCash += sale.totalValue || 0;
rawData.salesCredits -= sale.totalValue || 0;
} else if (sale.paymentType === 'PARTIAL_PAYMENT') {
rawData.salesCash += sale.totalValue || 0;
rawData.salesCredits -= sale.totalValue || 0;
}
}
});
salesHistory.forEach(item => {
rawData.calculatorCash += item.received || 0;
rawData.calculatorTotalIssued += item.creditValue || 0;
rawData.calculatorTotalRecovered += item.prevColl || 0;
});
let totalExpenses = 0;
paymentTransactions.forEach(trans => {
if (trans.type === 'IN') {
rawData.paymentsIn += trans.amount;
} else if (trans.type === 'OUT') {
if (trans.isExpense && trans.category === 'operating') {
totalExpenses += trans.amount;
}
else if (!trans.isExpense) {
rawData.paymentsOut += trans.amount;
}
}
});
if (Array.isArray(expenseRecords)) {
expenseRecords.forEach(exp => {
if (exp.isMerged !== true) return;
if (exp.category === 'operating') {
totalExpenses += (parseFloat(exp.amount) || 0);
}
});
}
const netSalesCash = rawData.salesCash;
const netSalesCredits = rawData.salesCredits;
const combinedMarketDebt = rawData.calculatorTotalIssued - rawData.calculatorTotalRecovered;
const cashInHand = rawData.totalProductionValue +
netSalesCash + rawData.calculatorCash +
rawData.paymentsIn - rawData.paymentsOut;
let AccountsReceivable = {
salesTabCredit: netSalesCredits,
calculatorCredit: Math.max(0, combinedMarketDebt),
total: 0
};
AccountsReceivable.total = AccountsReceivable.salesTabCredit +
AccountsReceivable.calculatorCredit;
let RawMaterialsValue = 0;
factoryInventoryData.forEach(item => {
RawMaterialsValue += (item.quantity * item.cost) || 0;
});
let FormulaUnitsValue = 0;
const stdTracking = factoryUnitTracking?.standard || { available: 0 };
const asaanTracking = factoryUnitTracking?.asaan || { available: 0 };
const stdCostPerUnit = getCostPerUnit('standard');
const asaanCostPerUnit = getCostPerUnit('asaan');
FormulaUnitsValue = (stdTracking.available * stdCostPerUnit) +
(asaanTracking.available * asaanCostPerUnit);
const CURRENT_ASSETS = cashInHand +
RawMaterialsValue +
FormulaUnitsValue +
AccountsReceivable.total;
let CurrentLiabilities = {
accountsPayable: {
supplierPayables: 0,
entityPayables: 0,
otherPayables: {
operating: 0,
total: 0
},
total: 0
},
total: 0
};
const rawMaterialSupplierIds = new Set();
if (factoryInventoryData && factoryInventoryData.length > 0) {
factoryInventoryData.forEach(material => {
if (material.supplierId) {
rawMaterialSupplierIds.add(String(material.supplierId));
}
});
}
const entityBalances = {};
paymentEntities.forEach(entity => {
if (entity.isExpenseEntity === true) return;
entityBalances[entity.id] = 0;
});
paymentTransactions.forEach(transaction => {
if (transaction.isExpense === true) return;
if (entityBalances[transaction.entityId] !== undefined) {
if (transaction.type === 'OUT') {
entityBalances[transaction.entityId] -= parseFloat(transaction.amount) || 0;
} else if (transaction.type === 'IN') {
entityBalances[transaction.entityId] += parseFloat(transaction.amount) || 0;
}
}
});
if (factoryInventoryData && factoryInventoryData.length > 0) {
const pendingPerSupplier = {};
factoryInventoryData.forEach(material => {
if (material.supplierId && material.paymentStatus === 'pending' && material.totalPayable > 0) {
const sid = String(material.supplierId);
pendingPerSupplier[sid] = (pendingPerSupplier[sid] || 0) + material.totalPayable;
}
});
for (const sid in pendingPerSupplier) {
const pendingAmount = pendingPerSupplier[sid];
if (pendingAmount > 0) {
CurrentLiabilities.accountsPayable.supplierPayables += pendingAmount;
}
}
}
for (const entityId in entityBalances) {
if (rawMaterialSupplierIds.has(String(entityId))) continue;
const balance = entityBalances[entityId];
if (balance > 0) {
CurrentLiabilities.accountsPayable.entityPayables += balance;
}
}
CurrentLiabilities.accountsPayable.otherPayables.operating = 0;
paymentTransactions.forEach(trans => {
if (trans.isExpense && trans.category === 'operating') {
CurrentLiabilities.accountsPayable.otherPayables.operating += trans.amount;
}
});
if (Array.isArray(expenseRecords)) {
expenseRecords.forEach(exp => {
if (exp.isMerged !== true) return;
if (exp.category === 'operating') {
CurrentLiabilities.accountsPayable.otherPayables.operating += (parseFloat(exp.amount) || 0);
}
});
}
CurrentLiabilities.accountsPayable.otherPayables.total =
CurrentLiabilities.accountsPayable.otherPayables.operating;
CurrentLiabilities.accountsPayable.total =
CurrentLiabilities.accountsPayable.supplierPayables +
CurrentLiabilities.accountsPayable.entityPayables +
CurrentLiabilities.accountsPayable.otherPayables.total;
CurrentLiabilities.total = CurrentLiabilities.accountsPayable.total;
const WORKING_CAPITAL = CURRENT_ASSETS - CurrentLiabilities.total;
const ENTERPRISE_VALUE = CURRENT_ASSETS - CurrentLiabilities.total;
const liquidityRatios = {
currentRatio: CurrentLiabilities.total > 0 ? CURRENT_ASSETS / CurrentLiabilities.total : 0,
quickRatio: CurrentLiabilities.total > 0 ? (CURRENT_ASSETS - RawMaterialsValue - FormulaUnitsValue) / CurrentLiabilities.total : 0,
cashRatio: CurrentLiabilities.total > 0 ? cashInHand / CurrentLiabilities.total : 0
};
const indicators = {
cashInHand: cashInHand,
cashDetails: {
directSales: netSalesCash,
productionCash: rawData.totalProductionValue,
repCollections: rawData.calculatorCash,
paymentsIn: rawData.paymentsIn,
paymentsOut: rawData.paymentsOut
},
operatingCashFlow: netSalesCash + rawData.totalProductionValue + rawData.calculatorCash,
assets: {
cash: cashInHand,
rawMaterials: RawMaterialsValue,
formulaUnits: FormulaUnitsValue,
accountsReceivable: AccountsReceivable.total,
currentAssetsTotal: CURRENT_ASSETS
},
receivables: {
salesTab: AccountsReceivable.salesTabCredit,
calculator: AccountsReceivable.calculatorCredit,
total: AccountsReceivable.total
},
liabilities: {
accountsPayable: {
supplierPayables: CurrentLiabilities.accountsPayable.supplierPayables,
entityPayables: CurrentLiabilities.accountsPayable.entityPayables,
otherPayables: CurrentLiabilities.accountsPayable.otherPayables,
total: CurrentLiabilities.accountsPayable.total
},
total: CurrentLiabilities.total
},
workingCapital: WORKING_CAPITAL,
netWorkingCapital: WORKING_CAPITAL,
totalEnterpriseValue: ENTERPRISE_VALUE,
liquidityRatios: liquidityRatios
};
updateEconomicDashboard(indicators);
return indicators;
} catch (error) {
return null;
}
}
function updateEconomicDashboard(indicators) {
const netCashValueElement = document.getElementById('netCashValue');
if (netCashValueElement) {
netCashValueElement.textContent = `${fmtAmt(safeValue(indicators.cashInHand))}`;
netCashValueElement.style.color = indicators.cashInHand < 0 ? 'var(--danger)' :
indicators.cashInHand < 10000 ? 'var(--warning)' :
'var(--accent-emerald)';
}
const operatingCashElement = document.getElementById('operatingCashFlow');
if (operatingCashElement) {
operatingCashElement.textContent = `${fmtAmt(safeValue(indicators.operatingCashFlow))}`;
}
document.getElementById('cashDetailDirectSales').textContent = `${fmtAmt(safeValue(indicators.cashDetails.directSales))}`;
document.getElementById('cashDetailProductionCash').textContent = `${fmtAmt(safeValue(indicators.cashDetails.productionCash))}`;
document.getElementById('cashDetailRepCollections').textContent = `${fmtAmt(safeValue(indicators.cashDetails.repCollections))}`;
document.getElementById('cashDetailPaymentsIn').textContent = `${fmtAmt(safeValue(indicators.cashDetails.paymentsIn))}`;
document.getElementById('cashDetailPaymentsOut').textContent = `${fmtAmt(safeValue(indicators.cashDetails.paymentsOut))}`;
document.getElementById('cashDetailNet').textContent = `${fmtAmt(safeValue(indicators.cashInHand))}`;
document.getElementById('formulaProdTotal').textContent = `${fmtAmt(safeValue(indicators.assets.cash))}`;
document.getElementById('formulaRawMaterials').textContent = `${fmtAmt(safeValue(indicators.assets.rawMaterials))}`;
document.getElementById('formulaUnitsValue').textContent = `${fmtAmt(safeValue(indicators.assets.formulaUnits))}`;
const salesReceivablesEl = document.getElementById('salesReceivables');
const calculatorReceivablesEl = document.getElementById('calculatorReceivables');
const formulaReceivablesEl = document.getElementById('formulaReceivables');
if (salesReceivablesEl) salesReceivablesEl.textContent = `${fmtAmt(safeValue(indicators.receivables.salesTab))}`;
if (calculatorReceivablesEl) calculatorReceivablesEl.textContent = `${fmtAmt(safeValue(indicators.receivables.calculator))}`;
if (formulaReceivablesEl) formulaReceivablesEl.textContent = `${fmtAmt(safeValue(indicators.receivables.total))}`;
const supplierPayablesEl = document.getElementById('supplierPayables');
const entityPayablesEl = document.getElementById('entityPayables');
const otherPayablesOperatingEl = document.getElementById('otherPayablesOperating');
const formulaPayOutEl = document.getElementById('formulaPayOut');
if (supplierPayablesEl) supplierPayablesEl.textContent = `${fmtAmt(safeValue(indicators.liabilities.accountsPayable.supplierPayables))}`;
if (entityPayablesEl) entityPayablesEl.textContent = `${fmtAmt(safeValue(indicators.liabilities.accountsPayable.entityPayables))}`;
if (otherPayablesOperatingEl) otherPayablesOperatingEl.textContent = `${fmtAmt(safeValue(indicators.liabilities.accountsPayable.otherPayables.operating))}`;
if (formulaPayOutEl) formulaPayOutEl.textContent = `${fmtAmt(safeValue(indicators.liabilities.accountsPayable.total))}`;
const currentAssetsTotalEl = document.getElementById('currentAssetsTotal');
const currentLiabilitiesTotalEl = document.getElementById('currentLiabilitiesTotal');
if (currentAssetsTotalEl) currentAssetsTotalEl.textContent = `${fmtAmt(safeValue(indicators.assets.currentAssetsTotal))}`;
if (currentLiabilitiesTotalEl) currentLiabilitiesTotalEl.textContent = `${fmtAmt(safeValue(indicators.liabilities.total))}`;
const workingCapitalElement = document.getElementById('formulaPayIn');
if (workingCapitalElement) {
workingCapitalElement.textContent = `${fmtAmt(safeValue(indicators.workingCapital))}`;
workingCapitalElement.style.color = indicators.workingCapital < 0 ? 'var(--danger)' :
indicators.workingCapital < 50000 ? 'var(--warning)' :
'var(--accent-emerald)';
}
document.getElementById('formulaFinal').textContent = `${fmtAmt(safeValue(indicators.totalEnterpriseValue))}`;
const currentRatioElement = document.getElementById('formulaCalcDisc');
if (currentRatioElement) {
const currentRatio = safeNumber(parseFloat(indicators.liquidityRatios?.currentRatio), 0);
currentRatioElement.textContent = safeNumber(currentRatio, 0).toFixed(2);
currentRatioElement.style.color = currentRatio < 1 ? 'var(--danger)' :
currentRatio < 2 ? 'var(--warning)' :
'var(--accent-emerald)';
}
const quickRatioElement = document.getElementById('quickRatio');
if (quickRatioElement) {
const quickRatio = safeNumber(parseFloat(indicators.liquidityRatios?.quickRatio), 0);
quickRatioElement.textContent = safeNumber(quickRatio, 0).toFixed(2);
}
const cashRatioElement = document.getElementById('cashRatio');
if (cashRatioElement) {
const cashRatio = safeNumber(parseFloat(indicators.liquidityRatios?.cashRatio), 0);
cashRatioElement.textContent = safeNumber(cashRatio, 0).toFixed(2);
}
}
async function saveCustomerSale() {
if (appMode === 'userrole' && !(window._userRoleAllowedTabs || []).includes('sales')) {
showToast('Access Denied — Sales not in your assigned tabs', 'warning', 3000); return;
}
const date = document.getElementById('cust-date').value;
const name = document.getElementById('cust-name').value.trim();
const quantity = parseFloat(document.getElementById('cust-quantity').value) || 0;
const store = document.getElementById('supply-store-value').value;
const paymentType = document.getElementById('payment-type-value').value;
const salesRep = document.getElementById('sales-rep-value').value;
const phoneInput = document.getElementById('new-cust-phone');
const phoneNumber = (!document.getElementById('new-customer-phone-container').classList.contains('hidden'))
? phoneInput.value.trim()
: '';
if (!date) {
showToast('Please select a date.', 'warning', 3000);
return;
}
if (!name) {
showToast('Please enter customer name.', 'warning', 3000);
return;
}
if (quantity <= 0) {
showToast('Please enter a valid quantity.', 'warning', 3000);
return;
}
let storeSpecificProduction = 0;
db.forEach(production => {
if (production.date === date) {
if (store === 'STORE_A' && production.store === 'STORE_A') {
storeSpecificProduction += production.net || 0;
} else if (store === 'STORE_B' && production.store === 'STORE_B') {
storeSpecificProduction += production.net || 0;
} else if (store === 'STORE_C' && production.store === 'STORE_C') {
storeSpecificProduction += production.net || 0;
}
}
});
let storeSpecificSales = 0;
customerSales.forEach(sale => {
if (sale.date === date && sale.supplyStore === store) {
storeSpecificSales += sale.quantity || 0;
}
});
let storeReturns = 0;
stockReturns.forEach(returnEntry => {
if (returnEntry.date === date && returnEntry.store === store) {
storeReturns += returnEntry.quantity || 0;
}
});
const totalAvailableInventory = storeSpecificProduction + storeReturns;
const storeAvailableInventory = totalAvailableInventory - storeSpecificSales;
if (totalAvailableInventory === 0) {
showToast(` No production recorded for ${date}. You cannot sell what has not been produced.`, 'warning', 5000);
return;
}
if (storeSpecificProduction === 0 && storeReturns === 0) {
showToast(` No production or returns for ${getStoreLabel(store)} on ${date}. Check available stores.`, 'warning', 5000);
return;
}
const remainingAfterSale = storeAvailableInventory - quantity;
if (remainingAfterSale < 0) {
showToast(` Insufficient stock! Available: ${safeNumber(storeAvailableInventory, 0).toFixed(2)} kg, Requested: ${safeNumber(quantity, 0).toFixed(2)} kg. Shortage: ${safeNumber(Math.abs(remainingAfterSale), 0).toFixed(2)} kg`, 'error', 6000);
return;
}
const costData = calculateSalesCost(store, quantity);
const totalCost = costData.totalCost;
const _effectiveSalePrice = getEffectiveSalePriceForCustomer(name, store);
const totalValue = quantity * _effectiveSalePrice;
const profit = totalValue - totalCost;
const existingCustomer = customerSales.find(s => s && s.customerName && name && s.customerName.toLowerCase() === name.toLowerCase());
let existingCredit = 0;
if (existingCustomer) {
customerSales.forEach(sale => {
if (!(sale && sale.customerName && name && sale.customerName.toLowerCase() === name.toLowerCase())) return;
if (sale.transactionType === 'OLD_DEBT' && !sale.creditReceived) {
existingCredit += getSaleTransactionValue(sale) - (sale.partialPaymentReceived || 0);
} else if (sale.paymentType === 'CREDIT' && !sale.creditReceived) {
if (sale.isMerged && typeof sale.creditValue === 'number') {
existingCredit += sale.creditValue;
} else {
existingCredit += getSaleTransactionValue(sale) - (sale.partialPaymentReceived || 0);
}
} else if (sale.paymentType === 'COLLECTION') {
existingCredit -= (sale.totalValue || 0);
} else if (sale.paymentType === 'PARTIAL_PAYMENT') {
existingCredit -= (sale.totalValue || 0);
}
});
existingCredit = Math.max(0, existingCredit);
}
if (paymentType === 'CREDIT') {
const creditWarningThreshold = 5000;
if (existingCredit > creditWarningThreshold) {
const _cwMsg = `${name} already has an outstanding credit balance.
Current unpaid balance: ${fmtAmt(safeNumber(existingCredit, 0))}
This new credit sale: ${fmtAmt(safeNumber(totalValue, 0))}
New total if you proceed: ${fmtAmt(safeNumber(existingCredit + totalValue, 0))}
⚠ Consider collecting the existing balance before adding more credit. Proceeding will increase their total debt beyond the threshold.`;
if (!(await showGlassConfirm(_cwMsg, { title: "⚠ High Credit Warning", confirmText: "Add Credit Anyway", cancelText: "Cancel" }))) {
return;
}
}
}
const now = new Date();
let hours = now.getHours();
const minutes = now.getMinutes();
const seconds = now.getSeconds();
const ampm = hours >= 12 ? 'PM' : 'AM';
hours = hours % 12;
hours = hours ? hours : 12;
const timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')} ${ampm}`;
const recordId = generateUUID('sale');
const recordTimestamp = getTimestamp();
if (!validateUUID(recordId)) {
showToast(' Error generating transaction ID. Please try again.', 'error');
return;
}
const saleRecord = {
id: recordId,
timestamp: recordTimestamp,
createdAt: recordTimestamp,
updatedAt: recordTimestamp,
date: date,
time: timeString,
customerName: name,
customerPhone: phoneNumber,
quantity: quantity,
supplyStore: store,
paymentType: paymentType,
salesRep: salesRep,
currentRepProfile: 'admin',
totalCost: totalCost,
totalValue: totalValue,
profit: profit,
unitPrice: _effectiveSalePrice,
creditReceived: paymentType === 'CASH' ? true : false,
syncedAt: new Date().toISOString(),
createdBy: (appMode === 'userrole' && window._assignedManagerName) ? window._assignedManagerName : null,
};
const validatedRecord = ensureRecordIntegrity(saleRecord);
const salesSnapshot = [...customerSales];
try {
customerSales.push(validatedRecord);
await saveWithTracking('customer_sales', customerSales, validatedRecord);
await saveRecordToFirestore('customer_sales', validatedRecord);
try {
const _scName = validatedRecord.customerName;
const _scPhone = validatedRecord.customerPhone || '';
if (_scName && _scName.trim() && !(validatedRecord.salesRep !== 'NONE')) {
const _scIdx = Array.isArray(salesCustomers) ? salesCustomers.findIndex(c => c && c.name && c.name.toLowerCase() === _scName.toLowerCase()) : -1;
if (_scIdx === -1) {
const _scContact = { id: generateUUID('cust'), name: _scName, phone: _scPhone, address: '', oldDebit: 0, customSalePrice: 0, createdAt: getTimestamp(), updatedAt: getTimestamp(), timestamp: getTimestamp() };
if (!Array.isArray(salesCustomers)) salesCustomers = [];
salesCustomers.push(_scContact);
await saveWithTracking('sales_customers', salesCustomers, _scContact);
await saveRecordToFirestore('sales_customers', _scContact);
}
}
} catch (_scErr) { console.warn('Auto-register sales customer failed:', _scErr); }
notifyDataChange('sales');
triggerAutoSync();
if (typeof calculateCashTracker === 'function') calculateCashTracker();
if (typeof calculateNetCash === 'function') calculateNetCash();
emitSyncUpdate({ customer_sales: customerSales });
document.getElementById('cust-name').value = '';
document.getElementById('cust-quantity').value = '';
selectSalesRep(document.querySelector('#sales-rep-toggle-group .toggle-opt'), 'NONE');
selectPaymentType(document.getElementById('btn-payment-cash'), 'CASH');
selectSupplyStore(document.getElementById('btn-supply-store-a'), 'STORE_A');
if (phoneInput) phoneInput.value = '';
document.getElementById('new-customer-phone-container').classList.add('hidden');
if (typeof renderCustomersTable === 'function') {
renderCustomersTable();
}
if (typeof refreshCustomerSales === 'function') {
refreshCustomerSales();
}
showToast(` Sale recorded successfully! ${name} - ${safeNumber(quantity, 0).toFixed(2)} kg`, "success");
} catch (error) {
customerSales.length = 0;
customerSales.push(...salesSnapshot);
try {
await saveWithTracking('customer_sales', customerSales);
} catch (rollbackError) {
console.error('UI refresh failed.', _safeErr(rollbackError));
showToast('UI refresh failed.', 'error');
}
showToast(' Failed to save sale. Please try again.', 'error');
}
}
// ── Sales tab: Sale / Collection mode ────────────────────────────────────
let custTransactionMode = 'sale';
function setSaleMode(mode) {
custTransactionMode = mode;
const isSale = mode === 'sale';
const _el = id => document.getElementById(id);
// toggle buttons
const btnSale = _el('btn-cust-mode-sale');
const btnColl = _el('btn-cust-mode-coll');
if (btnSale) btnSale.className = `toggle-opt${isSale ? ' active' : ''}`;
if (btnColl) btnColl.className = `toggle-opt${!isSale ? ' active' : ''}`;
// show/hide input sections
const saleIn  = _el('cust-sale-inputs');
const collIn  = _el('cust-coll-inputs');
const supPay  = _el('cust-sale-supply-payment');
const collRes = _el('cust-coll-result');
if (saleIn)  isSale ? saleIn.classList.remove('hidden')  : saleIn.classList.add('hidden');
if (collIn)  isSale ? collIn.classList.add('hidden')     : collIn.classList.remove('hidden');
if (supPay)  { supPay.style.display = isSale ? '' : 'none'; }
if (collRes) { collRes.style.display = isSale ? 'none' : ''; }
// qty row in customer-info-display
const qtyRow = _el('customer-qty-row');
if (qtyRow) { qtyRow.style.display = isSale ? '' : 'none'; }
// button label
const btn = _el('btn-save-cust-transaction');
if (btn) btn.textContent = isSale ? 'Save Transaction' : 'Save Collection';
// reset collection amount and update preview
if (!isSale) {
const amtEl = _el('cust-amount-collected');
if (amtEl) amtEl.value = '';
updateCollectionPreview();
} else {
calculateCustomerSale();
}
}
function updateCollectionPreview() {
if (custTransactionMode !== 'collection') return;
const creditEl = document.getElementById('customer-current-credit');
const collRes  = document.getElementById('cust-coll-result');
const balEl    = document.getElementById('cust-coll-balance');
const amtEl    = document.getElementById('cust-amount-collected');
const currentDebt = creditEl
? parseFloat((creditEl.innerText || '0').replace(/[^0-9.-]/g, '')) || 0
: 0;
const collected = parseFloat(amtEl?.value) || 0;
const remaining = Math.max(0, currentDebt - collected);
if (collRes) collRes.style.display = '';
if (balEl) {
balEl.textContent = fmtAmt(remaining);
balEl.style.color = remaining === 0 ? 'var(--accent-emerald)' : 'var(--warning)';
}
}
async function saveCustomerCollection() {
if (appMode === 'userrole' && !(window._userRoleAllowedTabs || []).includes('sales')) {
showToast('Access Denied — Sales not in your assigned tabs', 'warning', 3000); return;
}
const date = document.getElementById('cust-date').value;
const name = document.getElementById('cust-name').value.trim();
const amountEl = document.getElementById('cust-amount-collected');
const amount = parseFloat(amountEl?.value) || 0;
const phoneInput = document.getElementById('new-cust-phone');
const phoneNumber = (!document.getElementById('new-customer-phone-container').classList.contains('hidden'))
? phoneInput.value.trim()
: '';
if (!date) { showToast('Please select a date.', 'warning', 3000); return; }
if (!name) { showToast('Please enter customer name.', 'warning', 3000); return; }
if (amount <= 0) { showToast('Please enter a valid amount.', 'warning', 3000); return; }
const btn = document.getElementById('btn-save-cust-transaction');
if (btn) { if (btn.disabled) return; btn.disabled = true; }
const restoreBtn = () => { if (btn) btn.disabled = false; };
try {
let gpsCoords = null;
try {
gpsCoords = await Promise.race([
getPosition(),
new Promise(resolve => setTimeout(() => resolve(null), 10000))
]);
} catch (e) {}
const now = new Date();
const hours = now.getHours(), mins = now.getMinutes(), secs = now.getSeconds();
const ampm = hours >= 12 ? 'PM' : 'AM';
const h12 = hours % 12 || 12;
const timeString = `${String(h12).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')} ${ampm}`;
const recordId = generateUUID('sale');
if (!validateUUID(recordId)) {
showToast('Error generating transaction ID. Please try again.', 'error');
restoreBtn(); return;
}
const recordTimestamp = getTimestamp();
const collRecord = {
id: recordId,
timestamp: recordTimestamp,
createdAt: recordTimestamp,
updatedAt: recordTimestamp,
date: date,
time: timeString,
customerName: name,
customerPhone: phoneNumber,
quantity: 0,
supplyStore: null,
paymentType: 'COLLECTION',
salesRep: 'NONE',
currentRepProfile: 'admin',
totalCost: 0,
totalValue: amount,
profit: amount,
creditReceived: true,
isCollection: true,
gps: gpsCoords,
syncedAt: new Date().toISOString(),
createdBy: (appMode === 'userrole' && window._assignedManagerName) ? window._assignedManagerName : null,
};
const validated = ensureRecordIntegrity(collRecord);
const snapshot = [...customerSales];
try {
customerSales.push(validated);
await saveWithTracking('customer_sales', customerSales, validated);
await saveRecordToFirestore('customer_sales', validated);
notifyDataChange('sales');
triggerAutoSync();
if (typeof calculateCashTracker === 'function') calculateCashTracker();
if (typeof calculateNetCash === 'function') calculateNetCash();
emitSyncUpdate({ customer_sales: customerSales });
// keep name so user can collect again; refresh credit display
const savedName = name;
if (amountEl) amountEl.value = '';
document.getElementById('new-customer-phone-container').classList.add('hidden');
if (phoneInput) phoneInput.value = '';
if (typeof renderCustomersTable === 'function') renderCustomersTable();
if (typeof refreshCustomerSales === 'function') refreshCustomerSales();
if (typeof calculateCustomerStatsForDisplay === 'function') calculateCustomerStatsForDisplay(savedName);
updateCollectionPreview();
showToast(` Collection of ${fmtAmt(amount)} recorded for ${name}`, 'success');
} catch (error) {
customerSales.length = 0;
customerSales.push(...snapshot);
try { await saveWithTracking('customer_sales', customerSales); } catch (_) {}
showToast('Failed to save collection. Please try again.', 'error');
}
} finally {
restoreBtn();
}
}
async function saveCustomerTransaction() {
if (custTransactionMode === 'collection') {
await saveCustomerCollection();
} else {
await saveCustomerSale();
}
}
// ── End Sales tab collection mode ─────────────────────────────────────────
function getStoreLabel(storeCode) {
switch(storeCode) {
case 'STORE_A': return 'ZUBAIR';
case 'STORE_B': return 'MAHMOOD';
case 'STORE_C': return 'ASAAN';
default: return storeCode;
}
}
function getAvailableStoresForDate(date) {
const stores = new Set();
db.forEach(production => {
if (production.date === date && production.net > 0) {
stores.add(getStoreLabel(production.store));
}
});
return Array.from(stores).join(', ') || 'None';
}
function calculateSalesCost(store, quantity) {
let costPerKg = 0;
let salePricePerKg = 0;
if (store === 'STORE_C') {
const formulaCost = getCostPerUnit('asaan');
const adjustmentFactor = factoryCostAdjustmentFactor.asaan || 1;
costPerKg = adjustmentFactor > 0 ? formulaCost / adjustmentFactor : formulaCost;
			salePricePerKg = getSalePriceForStore('STORE_C');
} else {
const formulaCost = getCostPerUnit('standard');
const adjustmentFactor = factoryCostAdjustmentFactor.standard || 1;
costPerKg = adjustmentFactor > 0 ? formulaCost / adjustmentFactor : formulaCost;
salePricePerKg = getSalePriceForStore('STORE_A');
}
const totalCost = quantity * costPerKg;
const totalValue = quantity * salePricePerKg;
return {
costPerKg: costPerKg,
salePricePerKg: salePricePerKg,
totalCost: totalCost,
totalValue: totalValue
};
}
function calculateCustomerSale() {
if (typeof custTransactionMode !== 'undefined' && custTransactionMode === 'collection') return;
const quantity = parseFloat(document.getElementById('cust-quantity').value) || 0;
const date = document.getElementById('cust-date').value;
const store = document.getElementById('supply-store-value').value;
const customerName = (document.getElementById('cust-name')?.value || '').trim();
const costData = calculateSalesCost(store, quantity);
const effectiveSalePrice = getEffectiveSalePriceForCustomer(customerName, store);
const totalValue = quantity * effectiveSalePrice;
const totalCost = costData?.totalCost || 0;
document.getElementById('cust-total-cost').textContent = fmtAmt(safeNumber(totalCost, 0));
document.getElementById('cust-total-value').textContent = fmtAmt(safeNumber(totalValue, 0));
document.getElementById('cust-profit').textContent = fmtAmt(safeNumber(totalValue - totalCost, 0));
if (date) {
let storeProduction = 0;
db.forEach(production => {
if (production.date === date && production.store === store) {
storeProduction += production.net || 0;
}
});
let storeReturns = 0;
stockReturns.forEach(returnEntry => {
if (returnEntry.date === date && returnEntry.store === store) {
storeReturns += returnEntry.quantity || 0;
}
});
let storeSales = 0;
customerSales.forEach(sale => {
if (sale.date === date && sale.supplyStore === store) {
storeSales += sale.quantity || 0;
}
});
const totalAvailable = storeProduction + storeReturns;
const availableInventory = totalAvailable - storeSales;
const inventoryWarning = document.getElementById('inventory-warning') || createInventoryWarningElement();
if (quantity > availableInventory) {
inventoryWarning.innerHTML = ` Warning: Only ${safeNumber(availableInventory, 0).toFixed(2)} kg available.<br><small>Production: ${safeNumber(storeProduction, 0).toFixed(2)} kg + Returns: ${safeNumber(storeReturns, 0).toFixed(2)} kg = ${safeNumber(totalAvailable, 0).toFixed(2)} kg total</small>`;
inventoryWarning.style.display = 'block';
inventoryWarning.style.color = 'var(--danger)';
inventoryWarning.style.background = 'rgba(220, 38, 38, 0.1)';
} else if (availableInventory < (quantity * 1.5)) {
inventoryWarning.innerHTML = ` Inventory: ${safeNumber(availableInventory, 0).toFixed(2)} kg available (${safeNumber(availableInventory - quantity, 0).toFixed(2)} kg remaining)<br><small>Production: ${safeNumber(storeProduction, 0).toFixed(2)} kg + Returns: ${safeNumber(storeReturns, 0).toFixed(2)} kg</small>`;
inventoryWarning.style.display = 'block';
inventoryWarning.style.color = 'var(--warning)';
inventoryWarning.style.background = 'rgba(245, 158, 11, 0.1)';
} else {
inventoryWarning.innerHTML = ` Inventory: ${safeNumber(availableInventory, 0).toFixed(2)} kg available<br><small>Production: ${safeNumber(storeProduction, 0).toFixed(2)} kg + Returns: ${safeNumber(storeReturns, 0).toFixed(2)} kg = ${safeNumber(totalAvailable, 0).toFixed(2)} kg total</small>`;
inventoryWarning.style.display = 'block';
inventoryWarning.style.color = 'var(--accent-emerald)';
inventoryWarning.style.background = 'rgba(5, 150, 105, 0.1)';
}
}
}
function selectSalesRep(btn, value) {
document.querySelectorAll('#sales-rep-toggle-group .toggle-opt').forEach(b => b.classList.remove('active'));
btn.classList.add('active');
document.getElementById('sales-rep-value').value = value;
autoFillCustomerName();
calculateCustomerSale();
}
function selectSupplyStore(btn, value) {
document.querySelectorAll('#btn-supply-store-a, #btn-supply-store-b, #btn-supply-store-c').forEach(b => b.classList.remove('active'));
btn.classList.add('active');
document.getElementById('supply-store-value').value = value;
calculateCustomerSale();
}
function selectPaymentType(btn, value) {
if (!btn) return;
document.querySelectorAll('#btn-payment-cash, #btn-payment-credit').forEach(b => b.classList.remove('active'));
btn.classList.add('active');
document.getElementById('payment-type-value').value = value;
calculateCustomerSale();
}
function selectRepPaymentType(btn, value) {
document.querySelectorAll('#btn-rep-pay-credit, #btn-rep-pay-cash').forEach(b => b.classList.remove('active'));
btn.classList.add('active');
document.getElementById('rep-payment-value').value = value;
calculateRepSalePreview();
}
function autoFillCustomerName() {
const salesRepValue = document.getElementById('sales-rep-value').value;
const nameInput = document.getElementById('cust-name');
if (salesRepValue === 'NONE') {
nameInput.value = '';
nameInput.placeholder = "Enter Customer Name";
nameInput.readOnly = false;
const cashBtn = document.getElementById('btn-payment-cash');
const creditBtn = document.getElementById('btn-payment-credit');
if (cashBtn) { cashBtn.disabled = false; selectPaymentType(cashBtn, 'CASH'); }
if (creditBtn) creditBtn.disabled = false;
} else {
nameInput.value = salesRepValue;
nameInput.readOnly = true;
const cashBtn = document.getElementById('btn-payment-cash');
const creditBtn = document.getElementById('btn-payment-credit');
if (creditBtn) selectPaymentType(creditBtn, 'CREDIT');
if (cashBtn) cashBtn.disabled = true;
}
if (nameInput.value) {
calculateCustomerStatsForDisplay(nameInput.value);
} else {
const infoDisplay = document.getElementById('customer-info-display');
if (infoDisplay) {
infoDisplay.classList.add('hidden');
}
}
}
function createInventoryWarningElement() {
const warningDiv = document.createElement('div');
warningDiv.id = 'inventory-warning';
warningDiv.style.fontSize = '0.8rem';
warningDiv.style.marginTop = '8px';
warningDiv.style.padding = '6px';
warningDiv.style.borderRadius = '6px';
warningDiv.style.display = 'none';
const salesSection = document.querySelector('#tab-sales .section.liquid-card');
const calculateButton = salesSection.querySelector('.btn-main');
salesSection.insertBefore(warningDiv, calculateButton);
return warningDiv;
}
async function deleteCustomerSale(id) {
if (!id || !validateUUID(id)) {
showToast(' Invalid transaction ID. Cannot delete.', 'error');
return;
}
const recordToDelete = customerSales.find(item => item.id === id);
if (!recordToDelete) {
await refreshCustomerSales();
renderCustomersTable();
return;
}
if (recordToDelete.isMerged) {
showToast('Merged opening balance records cannot be deleted', 'warning');
return;
}
const recordDate = recordToDelete.date || 'Unknown date';
const _dcStoreLabel = recordToDelete.supplyStore ? getStoreLabel(recordToDelete.supplyStore) : '';
const _dcIsCollection = recordToDelete.paymentType === 'COLLECTION' && recordToDelete.currentRepProfile === 'admin';
const _dcIsCredit = recordToDelete.paymentType === 'CREDIT';
const _dcIsPaid = _dcIsCredit && recordToDelete.creditReceived;
const _dcPartialPaid = recordToDelete.partialPaymentReceived || 0;
const _dcPayLabel = _dcIsCollection ? 'Collection' : (_dcIsCredit ? 'Credit Sale' : 'Cash Sale');
let _dcMsg = `Permanently delete this ${_dcPayLabel}?`;
_dcMsg += `\nCustomer: ${recordToDelete.customerName || 'Unknown'}`;
_dcMsg += `\nDate: ${recordDate}`;
if (_dcIsCollection) {
_dcMsg += `\nAmount: ${fmtAmt(recordToDelete.totalValue||0)}`;
_dcMsg += `\n\n⚠ Deleting this collection will restore the credit balance to this customer.`;
} else {
_dcMsg += `\nQty: ${recordToDelete.quantity || 0} kg`;
if (recordToDelete.totalValue) _dcMsg += `\nValue: ${fmtAmt(recordToDelete.totalValue||0)}`;
if (_dcStoreLabel) _dcMsg += `\nStore: ${_dcStoreLabel}`;
if (_dcIsCredit) {
if (_dcIsPaid) _dcMsg += `\n\n\u2714 This sale is already marked PAID. Deleting will erase the payment record.`;
else if (_dcPartialPaid > 0) _dcMsg += `\n\n\u26a0 ${fmtAmt(_dcPartialPaid)} partially collected. Deleting will erase the sale and partial payment.`;
else _dcMsg += `\n\n\u26a0 This credit sale is UNPAID. Deleting removes the outstanding balance of ${fmtAmt(recordToDelete.totalValue||0)}.`;
} else {
_dcMsg += `\n\n\u21a9 ${(recordToDelete.quantity||0).toFixed(2)} kg will be restored to ${recordDate} inventory.`;
}
}
_dcMsg += `\n\nThis cannot be undone.`;
if (await showGlassConfirm(_dcMsg, { title: `Delete ${_dcPayLabel}`, confirmText: "Delete", danger: true })) {
try {
await registerDeletion(id, 'sales', recordToDelete);
const originalLength = customerSales.length;
customerSales = customerSales.filter(item => item.id !== id);
if (customerSales.length === originalLength) throw new Error('Record not found or not deleted');
await saveWithTracking('customer_sales', customerSales);
await deleteRecordFromFirestore('customer_sales', id);
await refreshCustomerSales();
calculateNetCash();
calculateCashTracker();
renderCustomersTable();
if (currentManagingCustomer && typeof renderCustomerTransactions === 'function') {
await renderCustomerTransactions(currentManagingCustomer);
}
notifyDataChange('sales');
triggerAutoSync();
emitSyncUpdate({ customer_sales: customerSales });
const _delToast = _dcIsCollection
? ` Collection of ${fmtAmt(recordToDelete.totalValue||0)} deleted.`
: ` Sale deleted! ${recordToDelete.quantity} kg restored to ${recordDate} inventory.`;
showToast(_delToast, "success");
} catch (error) {
showToast(" Failed to delete sale. Please try again.", "error");
}
}
}
function calculateSales() {
const seller = document.getElementById('sellerSelect').value;
const costPerKg = getCostPriceForStore('STORE_A');
const salePrice = getSalePriceForStore('STORE_A');
const sold = parseFloat(document.getElementById('totalSold').value) || 0;
const ret = parseFloat(document.getElementById('returnedQuantity').value) || 0;
const exp = parseFloat(document.getElementById('expiredQuantity').value) || 0;
const cred = parseFloat(document.getElementById('creditSales').value) || 0;
const prev = parseFloat(document.getElementById('prevCreditReceived').value) || 0;
const rec = parseFloat(document.getElementById('receivedCash').value) || 0;
const netSold = Math.max(0, sold - ret - exp);
const cashQty = Math.max(0, netSold - cred);
const expected = (cashQty * salePrice) + prev;
document.getElementById('totalExpectedCash').textContent = fmtAmt(safeValue(expected));
const diff = rec - expected;
const box = document.getElementById('discrepancyBox');
const _discEl = document.getElementById('discrepancyStatus');
if(Math.abs(diff) < 0.01) {
if (box) box.className = 'result-box discrepancy-ok';
if (_discEl) _discEl.innerText = "PERFECT MATCH ";
} else if(diff < -0.01) {
if (box) box.className = 'result-box discrepancy-alert';
if (_discEl) _discEl.innerText = `SHORT: ${fmtAmt(Math.abs(diff))}`;
} else {
if (box) box.className = 'result-box discrepancy-ok';
if (_discEl) _discEl.innerText = `OVER: ${fmtAmt(safeNumber(diff, 0))}`;
}
}

const firebaseConfig = {
  apiKey: "AIzaSyDYjGQILtrcG2nfKACSfsVtfIPZOAgbr_s",
  authDomain: "calculator-fabd3.firebaseapp.com",
  databaseURL: "https://calculator-fabd3-default-rtdb.firebaseio.com",
  projectId: "calculator-fabd3",
  storageBucket: "calculator-fabd3.firebasestorage.app",
  messagingSenderId: "124313576124",
  appId: "1:124313576124:web:fb721bb61bc19b51db26b9"
};
function loadFirestoreStats() {
const saved = localStorage.getItem('firestoreStats');
if (saved) {
try {
firestoreStats = JSON.parse(saved);
if (!firestoreStats.lastReset) {
firestoreStats.lastReset = Date.now();
}
checkAndAutoResetFirestoreStats();
} catch (e) {
firestoreStats = {
reads: 0,
writes: 0,
history: [],
lastReset: Date.now()
};
}
} else {
firestoreStats = {
reads: 0,
writes: 0,
history: [],
lastReset: Date.now()
};
}
}
function saveFirestoreStats() {
try {
localStorage.setItem('firestoreStats', JSON.stringify(firestoreStats));
} catch (e) {
console.error('Firebase operation failed.', _safeErr(e));
showToast('Firebase operation failed.', 'error');
}
}
let firestoreStats = {
reads: 0,
writes: 0,
history: [],
lastReset: Date.now()
};
let firestoreUsageChart = null;
function checkAndAutoResetFirestoreStats() {
const now = Date.now();
const hoursSinceReset = (now - firestoreStats.lastReset) / (1000 * 60 * 60);
if (hoursSinceReset >= 24) {
firestoreStats.reads = 0;
firestoreStats.writes = 0;
firestoreStats.history = [];
firestoreStats.lastReset = now;
saveFirestoreStats();
updateFirestoreDisplay();
if (firestoreUsageChart) {
firestoreUsageChart.data.labels = [];
firestoreUsageChart.data.datasets[0].data = [];
firestoreUsageChart.data.datasets[1].data = [];
firestoreUsageChart.update();
}
}
}
function initFirestoreUsageChart() {
const canvas = document.getElementById('firestoreUsageChart');
if (!canvas) {
return;
}
if (!(canvas instanceof HTMLCanvasElement)) {
return;
}
const ctx = canvas.getContext('2d');
if (!ctx) {
return;
}
firestoreUsageChart = new Chart(ctx, {
type: 'line',
data: {
labels: [],
datasets: [
{
label: 'Reads',
data: [],
borderColor: '#30d158',
backgroundColor: 'rgba(48, 209, 88, 0.1)',
tension: 0.4,
fill: true
},
{
label: 'Writes',
data: [],
borderColor: '#007aff',
backgroundColor: 'rgba(0, 122, 255, 0.1)',
tension: 0.4,
fill: true
}
]
},
options: {
responsive: true,
maintainAspectRatio: false,
plugins: {
legend: {
display: false
}
},
scales: {
y: {
beginAtZero: true,
ticks: {
color: 'var(--text-muted)',
font: { size: 10 }
},
grid: {
color: 'rgba(255, 255, 255, 0.05)'
}
},
x: {
ticks: {
color: 'var(--text-muted)',
font: { size: 9 }
},
grid: {
color: 'rgba(255, 255, 255, 0.05)'
}
}
}
}
});
}
const FIRESTORE_THRESHOLDS = {
  reads:  { warn: 40000, critical: 48000 },
  writes: { warn: 16000, critical: 19000 },
  _alerted: { reads_warn: false, reads_critical: false, writes_warn: false, writes_critical: false }
};
function _checkFirestoreCostThresholds() {
  const r = firestoreStats.reads;
  const w = firestoreStats.writes;
  if (r >= FIRESTORE_THRESHOLDS.reads.critical && !FIRESTORE_THRESHOLDS._alerted.reads_critical) {
    FIRESTORE_THRESHOLDS._alerted.reads_critical = true;
    showToast('\uD83D\uDD34 Firestore reads at ' + r.toLocaleString() + ' today \u2014 approaching the 50\u202f000/day free-tier limit', 'error', 8000);
  } else if (r >= FIRESTORE_THRESHOLDS.reads.warn && !FIRESTORE_THRESHOLDS._alerted.reads_warn) {
    FIRESTORE_THRESHOLDS._alerted.reads_warn = true;
    showToast('\u26A0\uFE0F Firestore reads at ' + r.toLocaleString() + ' today \u2014 80\u202f% of 50\u202f000/day free tier used', 'warning', 6000);
  }
  if (w >= FIRESTORE_THRESHOLDS.writes.critical && !FIRESTORE_THRESHOLDS._alerted.writes_critical) {
    FIRESTORE_THRESHOLDS._alerted.writes_critical = true;
    showToast('\uD83D\uDD34 Firestore writes at ' + w.toLocaleString() + ' today \u2014 approaching the 20\u202f000/day free-tier limit', 'error', 8000);
  } else if (w >= FIRESTORE_THRESHOLDS.writes.warn && !FIRESTORE_THRESHOLDS._alerted.writes_warn) {
    FIRESTORE_THRESHOLDS._alerted.writes_warn = true;
    showToast('\u26A0\uFE0F Firestore writes at ' + w.toLocaleString() + ' today \u2014 80\u202f% of 20\u202f000/day free tier used', 'warning', 6000);
  }
}
function buildFirestoreCostEstimate(estimatedReads, estimatedWrites) {
  const totalR = firestoreStats.reads  + estimatedReads;
  const totalW = firestoreStats.writes + estimatedWrites;
  const lines = [
    'Estimated Firestore operations for this action:',
    '  \u2022 Reads : ~' + estimatedReads.toLocaleString()  + '  (daily total after: ' + totalR.toLocaleString() + ' / 50\u202f000 free)',
    '  \u2022 Writes: ~' + estimatedWrites.toLocaleString() + '  (daily total after: ' + totalW.toLocaleString() + ' / 20\u202f000 free)'
  ];
  if (totalR > FIRESTORE_THRESHOLDS.reads.warn || totalW > FIRESTORE_THRESHOLDS.writes.warn) {
    lines.push('\n\u26A0\uFE0F This will push your daily usage above 80\u202f% of the free-tier limit.');
  }
  return lines.join('\n');
}
function trackFirestoreRead(count = 1) {
checkAndAutoResetFirestoreStats();
firestoreStats.reads += count;
saveFirestoreStats();
updateFirestoreDisplay();
_checkFirestoreCostThresholds();
}
function trackFirestoreWrite(count = 1) {
checkAndAutoResetFirestoreStats();
firestoreStats.writes += count;
saveFirestoreStats();
updateFirestoreDisplay();
_checkFirestoreCostThresholds();
}
function updateFirestoreDisplay() {
const readsEl = document.getElementById('firestore-reads-count');
const writesEl = document.getElementById('firestore-writes-count');
if (readsEl) readsEl.textContent = firestoreStats.reads;
if (writesEl) writesEl.textContent = firestoreStats.writes;
if ((firestoreStats.reads + firestoreStats.writes) % 10 === 0) {
updateFirestoreChart();
}
}
function updateFirestoreChart() {
if (!firestoreUsageChart) return;
const now = new Date();
const timeLabel = now.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
firestoreUsageChart.data.labels.push(timeLabel);
firestoreUsageChart.data.datasets[0].data.push(firestoreStats.reads);
firestoreUsageChart.data.datasets[1].data.push(firestoreStats.writes);
if (firestoreUsageChart.data.labels.length > 10) {
firestoreUsageChart.data.labels.shift();
firestoreUsageChart.data.datasets[0].data.shift();
firestoreUsageChart.data.datasets[1].data.shift();
}
firestoreUsageChart.update();
}
function resetFirestoreStats() {
firestoreStats = { reads: 0, writes: 0, history: [], lastReset: Date.now() };
updateFirestoreDisplay();
if (firestoreUsageChart) {
firestoreUsageChart.data.labels = [];
firestoreUsageChart.data.datasets[0].data = [];
firestoreUsageChart.data.datasets[1].data = [];
firestoreUsageChart.update();
}
}
const originalOpenDataMenu = window.openDataMenu;
window.openDataMenu = function() {

if (typeof updateSyncButton === 'function') updateSyncButton();
if (typeof originalOpenDataMenu === 'function') {
originalOpenDataMenu();
} else {
document.getElementById('dataMenuOverlay').style.display = 'flex';
}
setTimeout(async () => {
if (!firestoreUsageChart) {
await loadChartJs();
initFirestoreUsageChart();
}
}, 100);
};
const DeltaSync = {
_cache: {},
_cacheGet(key) {
  return Object.prototype.hasOwnProperty.call(this._cache, key)
    ? this._cache[key]
    : undefined;
},
_cacheSet(key, value) {
  this._cache[key] = value;
},
_cacheDel(key) {
  delete this._cache[key];
},
_dirty: new Map(),
_uploaded: new Map(),
_downloaded: new Map(),
trackId(collection, id) {
  if (!id) return;
  const sid = String(id);
  if (!this._dirty.has(collection)) this._dirty.set(collection, new Set());
  this._dirty.get(collection).add(sid);
  if (this._downloaded.has(collection)) this._downloaded.get(collection).delete(sid);
},
trackCollection(collection) {
  if (!this._dirty.has(collection)) this._dirty.set(collection, new Set());
  this._dirty.get(collection).add('*');
},
clearDirty(collection) {
  this._dirty.delete(collection);
},
isDirty(collection) {
  const s = this._dirty.get(collection);
  return s !== undefined && s.size > 0;
},
markUploaded(collection, id) {
  const sid = String(id);
  if (!this._uploaded.has(collection)) this._uploaded.set(collection, new Set());
  this._uploaded.get(collection).add(sid);
  if (this._dirty.has(collection)) this._dirty.get(collection).delete(sid);

  idb.get(`uploadedIds_${collection}`, []).then(existing => {
    const arr = Array.isArray(existing) ? existing : [];
    if (!arr.includes(sid)) {
      arr.push(sid);

      const trimmed = arr.length > 5000 ? arr.slice(arr.length - 5000) : arr;
      idb.set(`uploadedIds_${collection}`, trimmed).catch(() => {});
    }
  }).catch(() => {});
},
async loadUploadedIds(collection) {
  try {
    const arr = await idb.get(`uploadedIds_${collection}`, []);
    if (Array.isArray(arr) && arr.length > 0) {
      if (!this._uploaded.has(collection)) this._uploaded.set(collection, new Set());
      arr.forEach(id => this._uploaded.get(collection).add(String(id)));
    }
  } catch (_e) {}
},
async loadAllUploadedIds() {
  const cols = ['production','sales','calculator_history','rep_sales','rep_customers',
    'sales_customers','transactions','entities','inventory','factory_history',
    'returns','expenses'];
  await Promise.all(cols.map(c => this.loadUploadedIds(c)));
},
markDownloaded(collection, id) {
  const sid = String(id);
  if (!this._downloaded.has(collection)) this._downloaded.set(collection, new Set());
  this._downloaded.get(collection).add(sid);
},
wasUploaded(collection, id) {
  const s = this._uploaded.get(collection);
  return s ? s.has(String(id)) : false;
},
wasDownloaded(collection, id) {
  const s = this._downloaded.get(collection);
  return s ? s.has(String(id)) : false;
},
async getLastSyncTimestamp(collection) {
  const key = `lastSync_${collection}`;
  const cached = this._cacheGet(key);
  if (cached !== undefined) return cached === null ? null : new Date(cached).getTime();
  const isoStr = await idb.get(key);
  this._cacheSet(key, isoStr || null);
  if (!isoStr) return null;
  return new Date(isoStr).getTime();
},
async getLastSyncMs(collection) {
  return (await this.getLastSyncTimestamp(collection)) || 0;
},
async getLastSyncFirestoreTimestamp(collection) {
  const key = `lastSync_${collection}`;
  const cached = this._cacheGet(key);
  const isoStr = cached !== undefined ? cached : await idb.get(key);
  if (!isoStr) return null;
  try {
    return firebase.firestore.Timestamp.fromDate(new Date(isoStr));
  } catch (e) {
    return null;
  }
},
async setLastSyncTimestamp(collection, explicitMs) {
  const key = `lastSync_${collection}`;
  const ts = explicitMs ? new Date(explicitMs).toISOString() : new Date().toISOString();
  this._cacheSet(key, ts);

  await idb.set(key, ts);
},
async getLastLocalModification(collection) {
  const key = `lastLocalMod_${collection}`;
  const cached = this._cacheGet(key);
  if (cached !== undefined) return cached === null ? 0 : cached;
  const raw = await idb.get(key);
  const val = raw !== null && raw !== undefined ? (typeof raw === 'number' ? raw : parseInt(raw)) : 0;
  this._cacheSet(key, val || null);
  return val || 0;
},
async setLastLocalModification(collection, timestamp) {
  const key = `lastLocalMod_${collection}`;
  const val = Number(timestamp);
  this._cacheSet(key, val);
  await idb.set(key, val);
},
async trackModification(collection) {
  this.trackCollection(collection);
},
async hasLocalChanges(collection) {
  return this.isDirty(collection);
},
async getChangedItemsCount(collectionName, dataArray) {
  const ids = this._dirty.get(collectionName);
  if (!ids || ids.size === 0) return 0;
  if (ids.has('*')) return Array.isArray(dataArray) ? dataArray.filter(i => i).length : 0;
  return ids.size;
},
async getChangedItems(collectionName, dataArray) {
  if (!Array.isArray(dataArray)) return [];
  const ids = this._dirty.get(collectionName);
  if (!ids || ids.size === 0) return [];
  const uploaded = this._uploaded.get(collectionName) || new Set();
  if (ids.has('*')) {
    return dataArray.filter(item => item && item.id && !uploaded.has(String(item.id)));
  }
  return dataArray.filter(item => {
    if (!item || !item.id) return false;
    const sid = String(item.id);
    return ids.has(sid) && !uploaded.has(sid);
  });
},
async hasAnyChanges(collections) {
  for (const collection of collections) {
    if (await this.hasLocalChanges(collection)) return true;
  }
  return false;
},
async clearAllTimestamps() {
  const knownCollections = [
    'production', 'sales', 'calculator_history', 'rep_sales', 'rep_customers',
    'sales_customers', 'transactions', 'entities', 'inventory',
    'factory_history', 'returns', 'expenses', 'sales_customers', 'deletions'
  ];
  for (const col of knownCollections) {
    const lsKey = `lastSync_${col}`;
    const lmKey = `lastLocalMod_${col}`;
    this._cacheDel(lsKey);
    this._cacheDel(lmKey);
    this.clearDirty(col);
    this._uploaded.delete(col);
    this._downloaded.delete(col);
    await idb.remove(lsKey);
    await idb.remove(lmKey);
    await idb.remove(`uploadedIds_${col}`);
    localStorage.removeItem(lsKey);
    localStorage.removeItem(lmKey);
  }
},
async getSyncSummary() {
  const currentAppMode = appMode || 'admin';
  const isRepMode = currentAppMode === 'rep';
  const collections = [
    'production', 'sales', 'calculator_history', 'rep_sales', 'rep_customers',
    'sales_customers', 'transactions', 'entities', 'inventory',
    'factory_history', 'returns', 'expenses', 'deletions'
  ];
  const summary = { mode: currentAppMode, isRepMode };
  for (const collection of collections) {
    const lastSyncMs = await this.getLastSyncTimestamp(collection);
    const hasChanges = await this.hasLocalChanges(collection);
    const uploadedCount = (this._uploaded.get(collection) || new Set()).size;
    const downloadedCount = (this._downloaded.get(collection) || new Set()).size;
    summary[collection] = {
      lastSync: lastSyncMs ? new Date(lastSyncMs).toISOString() : 'Never',
      hasChanges,
      needsUpload: hasChanges,
      needsDownload: !lastSyncMs,
      uploadedUUIDs: uploadedCount,
      downloadedUUIDs: downloadedCount
    };
  }
  return summary;
},
async updateSyncStats(collection) {
  const stats = await this.getSyncStats();
  if (!stats[collection]) {
    stats[collection] = { syncCount: 0, lastSync: null, totalReads: 0, totalWrites: 0 };
  }
  stats[collection].syncCount++;
  stats[collection].lastSync = new Date().toISOString();
  await idb.set('deltaSyncStats', stats);
},
async getSyncStats() {
  try {
    const stats = await idb.get('deltaSyncStats');
    return (stats && typeof stats === 'object') ? stats : {};
  } catch (e) {
    return {};
  }
},
async recordOperation(collection, reads = 0, writes = 0) {
  const stats = await this.getSyncStats();
  if (!stats[collection]) {
    stats[collection] = { syncCount: 0, lastSync: null, totalReads: 0, totalWrites: 0 };
  }
  stats[collection].totalReads += reads;
  stats[collection].totalWrites += writes;
  await idb.set('deltaSyncStats', stats);
}
};
async function initializeSyncStatsIfNeeded() {
const stats = await DeltaSync.getSyncStats();
const hasStats = Object.keys(stats).length > 0;
if (!hasStats) {
let lastSyncTime = new Date().toISOString();
try {
const lastSynced = await idb.get('last_synced');
if (lastSynced) {
lastSyncTime = lastSynced;
}
} catch (e) {
console.warn('Could not read last sync time', e);
}
const collections = [
'production', 'sales', 'calculator_history', 'rep_sales', 'rep_customers',
'sales_customers',
'transactions', 'entities', 'inventory', 'factory_history',
'returns', 'expenses', 'deletions'
];
for (const collection of collections) {
stats[collection] = {
syncCount: 1,
lastSync: lastSyncTime,
totalReads: 0,
totalWrites: 0
};
}
await idb.set('deltaSyncStats', stats);
return true;
}
return false;
}

const UUIDSyncRegistry = (() => {
  const MAX_IDS_PER_COL = 10000;
  const ALL_COLLECTIONS = [
    'production', 'sales', 'calculator_history', 'rep_sales', 'rep_customers',
    'sales_customers', 'transactions', 'entities', 'inventory',
    'factory_history', 'returns', 'expenses',
  ];

  const _uploaded   = new Map();
  const _downloaded = new Map();
  let   _myDeviceShard = null;

  function _set(map, col) {
    if (!map.has(col)) map.set(col, new Set());
    return map.get(col);
  }

  function _shardOf(id) {
    if (!id || typeof id !== 'string') return null;
    try {
      const meta = (typeof extractUUIDMeta === 'function') ? extractUUIDMeta(id) : null;
      return (meta && meta.deviceShard) ? String(meta.deviceShard).toLowerCase() : null;
    } catch (_) { return null; }
  }

  function _isLocalOrigin(id) {
    if (!_myDeviceShard) return false;
    const shard = _shardOf(id);
    return shard !== null && shard === _myDeviceShard;
  }

  function setDeviceShard(shard) {
    _myDeviceShard = shard ? String(shard).toLowerCase() : null;
  }

  function markUploaded(col, id) {
    const sid = String(id);

    _set(_uploaded, col).add(sid);

    DeltaSync.markUploaded(col, sid);
  }

  function skipUpload(col, id) {
    const sid = String(id);

    const up = _uploaded.get(col);
    if (up && up.has(sid)) return true;

    if (_isLocalOrigin(sid)) return false;

    return DeltaSync.wasUploaded(col, sid);
  }

  function markDownloaded(col, id) {
    const sid = String(id);
    _set(_downloaded, col).add(sid);
    DeltaSync.markDownloaded(col, sid);
  }

  function skipDownload(col, id) {
    const sid = String(id);

    const dn = _downloaded.get(col);
    if (dn && dn.has(sid)) return true;

    if (_isLocalOrigin(sid)) return true;
    return false;
  }

  function shouldApplyCloud(cloudRecord, localRecord) {
    if (!localRecord) return true;
    if (!cloudRecord) return false;
    try {
      return (typeof compareRecordVersions === 'function')
        ? compareRecordVersions(cloudRecord, localRecord) > 0
        : false;
    } catch (_) { return false; }
  }

  function stats() {
    const out = { _myDeviceShard };
    for (const [col, s] of _uploaded)   out[col] = { ...(out[col] || {}), uploaded:   s.size };
    for (const [col, s] of _downloaded) out[col] = { ...(out[col] || {}), downloaded: s.size };
    return out;
  }

  async function loadCollection(col) {
    try {
      const arr = await idb.get(`uploadedIds_${col}`, []);
      if (Array.isArray(arr) && arr.length > 0) {
        const s = _set(_uploaded, col);
        arr.forEach(id => s.add(String(id)));

      }
    } catch (_) {}
  }

  async function loadAll() {
    await Promise.all(ALL_COLLECTIONS.map(c => loadCollection(c)));
  }

  async function clearAll() {
    _uploaded.clear();
    _downloaded.clear();
    await Promise.all(ALL_COLLECTIONS.flatMap(c => [
      idb.remove(`uploadedIds_${c}`).catch(() => {}),
    ]));
  }

  return {
    setDeviceShard,
    markUploaded,
    skipUpload,
    markDownloaded,
    skipDownload,
    shouldApplyCloud,
    stats,
    loadCollection,
    loadAll,
    clearAll,

    isLocalOrigin: _isLocalOrigin,
    shardOf: _shardOf,
  };
})();

window.UUIDSyncRegistry = UUIDSyncRegistry;

updateSyncButton();
function addSignOutButton() {
removeSignOutButton();
const systemControls = document.querySelector('.system-controls');
if (systemControls && currentUser) {
const btnContainer = systemControls.querySelector('div');
if (btnContainer) {
const signOutBtn = document.createElement('button');
}
}
}
function removeSignOutButton() {
const btn = document.getElementById('cloud-signout-btn');
if (btn) btn.remove();
}
function handleReturnQtyInput() {
const retQty = parseFloat(document.getElementById('returnedQuantity').value) || 0;
const section = document.getElementById('returnStoreSection');
if (retQty > 0) {
section.classList.remove('hidden');
} else {
section.classList.add('hidden');
}
if (typeof calculateSales === 'function') calculateSales();
}
function handleExpiredQtyInput() {
const expQty = parseFloat(document.getElementById('expiredQuantity').value) || 0;
const section = document.getElementById('expiredSection');
if (expQty > 0) {
section.classList.remove('hidden');
} else {
section.classList.add('hidden');
}
if (typeof calculateSales === 'function') calculateSales();
}
function handleTripleTap(el, targetTab) {
const now = Date.now();
const TAP_WINDOW = 600;
if (!el._tapTimes) el._tapTimes = [];
el._tapTimes.push(now);
el._tapTimes = el._tapTimes.filter(t => now - t < TAP_WINDOW);
if (el._tapTimes.length >= 3) {
el._tapTimes = [];
showTab(targetTab);
}
}
async function saveTransaction() {
const seller = document.getElementById('sellerSelect').value;
const date = document.getElementById('sale-date').value;
const sold = parseFloat(document.getElementById('totalSold').value) || 0;
const ret = parseFloat(document.getElementById('returnedQuantity').value) || 0;
const exp = parseFloat(document.getElementById('expiredQuantity').value) || 0;
const cred = parseFloat(document.getElementById('creditSales').value) || 0;
const prev = parseFloat(document.getElementById('prevCreditReceived').value) || 0;
const rec = parseFloat(document.getElementById('receivedCash').value) || 0;
let selectedStore = null;
if (ret > 0) {
if (!window._returnStore) {
showToast('Please select a store (ZUBAIR or MAHMOOD) for the returned stock!', 'warning', 3000);
return;
}
selectedStore = { value: window._returnStore };
}
const costPerKg = getCostPriceForStore('STORE_A') || 0;
const salePrice = getSalePriceForStore('STORE_A');
if(!date) return showToast('Please select a date', 'warning', 3000);
if(salePrice <= 0) return showToast('Please set a sale price in Factory Formulas first', 'warning', 3000);
if(ret > sold) return showToast('Returned quantity cannot exceed total sold', 'warning', 3000);
if(exp < 0) return showToast('Expired quantity cannot be negative', 'warning', 3000);
if((ret + exp) > sold) return showToast('Combined returned + expired quantity cannot exceed total sold', 'warning', 3000);
const netSold = Math.max(0, sold - ret - exp);
const cashQty = Math.max(0, netSold - cred);
const creditValue = cred * salePrice;
const revenue = netSold * salePrice;
const totalCost = netSold * costPerKg;
const profit = revenue - totalCost;
const totalExpected = (cashQty * salePrice) + prev;
const diff = rec - totalExpected;
let statusText = "PERFECT MATCH ";
let statusClass = "result-box discrepancy-ok";
if (Math.abs(diff) > 0.01) {
if (diff < 0) {
statusText = `SHORT: ${fmtAmt(safeNumber(Math.abs(diff), 0))}`;
statusClass = "result-box discrepancy-alert";
} else {
statusText = `OVER: ${fmtAmt(safeNumber(diff, 0))}`;
statusClass = "result-box discrepancy-ok";
}
}
if (ret > 0 && selectedStore) {
await processReturnToProduction(selectedStore.value, ret, date, seller);
}
if (exp > 0) {
await processExpiredToChora(exp, date, seller);
}
let calcId = generateUUID('calc');
if (!validateUUID(calcId)) {
calcId = generateUUID('calc');
}
const calcCreatedAt = getTimestamp();
let entry = {
id: calcId,
seller: seller,
date: date,
createdAt: calcCreatedAt,
updatedAt: calcCreatedAt,
timestamp: calcCreatedAt,
unitPrice: Number(safeNumber(salePrice, 0).toFixed(2)),
costPrice: Number(safeNumber(costPerKg, 0).toFixed(2)),
revenue: Number(safeNumber(revenue, 0).toFixed(2)),
profit: Number(safeNumber(profit, 0).toFixed(2)),
totalCost: Number(safeNumber(totalCost, 0).toFixed(2)),
totalSold: Number(safeNumber(sold, 0).toFixed(2)),
returned: Number(safeNumber(ret, 0).toFixed(2)),
returnStore: selectedStore ? selectedStore.value : null,
expired: Number(safeNumber(exp, 0).toFixed(2)),
creditQty: Number(safeNumber(cred, 0).toFixed(2)),
cashQty: Number(safeNumber(cashQty, 0).toFixed(2)),
creditValue: Number(safeNumber(creditValue, 0).toFixed(2)),
prevColl: Number(safeNumber(prev, 0).toFixed(2)),
totalExpected: Number(safeNumber(totalExpected, 0).toFixed(2)),
received: Number(safeNumber(rec, 0).toFixed(2)),
statusText: statusText,
statusClass: statusClass,
linkedSalesIds: [],
linkedRepSalesIds: [],
syncedAt: new Date().toISOString()
};
entry = ensureRecordIntegrity(entry, false);

const reconciledCustomerIds = new Set();
if (Array.isArray(salesHistory)) {
  salesHistory.forEach(h => { if (Array.isArray(h.linkedSalesIds)) h.linkedSalesIds.forEach(id => reconciledCustomerIds.add(id)); });
}
const pendingCreditQty = (Array.isArray(customerSales) ? customerSales : [])
  .filter(s => s.currentRepProfile === 'admin' && s.customerName === seller && s.paymentType === 'CREDIT' && !s.creditReceived && !reconciledCustomerIds.has(s.id) && s.transactionType !== 'OLD_DEBT')
  .reduce((sum, s) => sum + (s.quantity || 0), 0);
const linkedIds = await markSalesEntriesAsReceived(seller, pendingCreditQty);
entry.linkedSalesIds = linkedIds;
const linkedRepIds = await markRepSalesEntriesAsUsed(seller, date, calcId);
entry.linkedRepSalesIds = linkedRepIds;
try {
let history = await idb.get('noman_history', []);
if (!Array.isArray(history)) history = [];
history.push(entry);
await unifiedSave('noman_history', history, entry);
notifyDataChange('calculator');
emitSyncUpdate({ noman_history: history });
if (Array.isArray(salesHistory)) {
salesHistory.push(entry);
}
document.getElementById('totalSold').value = '';
document.getElementById('returnedQuantity').value = '';
document.getElementById('expiredQuantity').value = '';
document.getElementById('creditSales').value = '';
document.getElementById('prevCreditReceived').value = '';
document.getElementById('receivedCash').value = '';
document.getElementById('returnStoreSection').classList.add('hidden');
document.getElementById('expiredSection').classList.add('hidden');
showToast(`Transaction saved! ${linkedIds.length} sales entries reconciled.`, 'success');
await loadSalesData(currentCompMode);
if (typeof refreshCustomerSales === 'function') await refreshCustomerSales(1, true);
if (entry.returned > 0 && entry.returnStore) {
if (typeof refreshUI === 'function') await refreshUI();
}
if (entry.expired > 0) {
if (typeof renderFactoryInventory === 'function') renderFactoryInventory();
}
} catch (error) {
showToast('Failed to save transaction. Please try again.', 'error', 4000);
}
}
async function exportCustomerData(type) {
showToast("Generating PDF...", "info");
try {
if (!window.jspdf) {
await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js');
}
if (!window.jspdf || !window.jspdf.jsPDF) {
throw new Error("Failed to load PDF library. Please refresh and try again.");
}
const fileName = type === 'rep' ? "My_Customer_List.pdf" : "All_Customers_List.pdf";
const customerMap = new Map();
const initCust = (name) => ({ name, phone:"N/A", address:"N/A", debt:0, paid:0, qty:0, lastDate:"", lastType:"" });
const salesData = type === 'rep' ? repSales : customerSales;
let hasMergedEntries = false;
salesData.forEach(sale => {
if (type === 'rep' && (sale.salesRep !== currentRepProfile)) return;
const name = sale.customerName;
if (!name) return;
if (!customerMap.has(name)) customerMap.set(name, initCust(name));
const cust = customerMap.get(name);
if (sale.customerPhone) cust.phone = sale.customerPhone;
if (sale.customerAddress) cust.address = sale.customerAddress;
if (sale.isMerged === true) {
  hasMergedEntries = true;
  const ms = sale.mergedSummary || {};
  const net = ms.netOutstanding != null ? ms.netOutstanding : (sale.totalValue || 0);
  const cash = ms.cashSales || 0;
  cust.debt += (net + cash);
  cust.paid += cash;
  cust.qty  += (sale.quantity || 0);
  if (sale.date > cust.lastDate) { cust.lastDate = sale.date; cust.lastType = 'MERGED'; }
  return;
}
const sp = sale.totalValue && sale.quantity && sale.quantity > 0 && !['COLLECTION','PARTIAL_PAYMENT'].includes(sale.paymentType)
? sale.totalValue / sale.quantity
: (sale.supplyStore === 'STORE_C' ? (factorySalePrices?.asaan||0) : (factorySalePrices?.standard||0));
if (sale.paymentType === 'CREDIT' && !sale.creditReceived) {
const val = sale.totalValue || (sale.quantity||0) * sp;
cust.debt += val;
cust.paid += parseFloat(sale.partialPaymentReceived) || 0;
cust.qty += (sale.quantity || 0);
} else if (sale.paymentType === 'CASH') {
const val = sale.totalValue || (sale.quantity||0) * sp;
cust.debt += val; cust.paid += val; cust.qty += (sale.quantity || 0);
} else if (sale.paymentType === 'CREDIT' && sale.creditReceived) {
const val = sale.totalValue || (sale.quantity||0) * sp;
cust.debt += val; cust.paid += val; cust.qty += (sale.quantity || 0);
} else if (sale.paymentType === 'COLLECTION') {
cust.paid += (sale.totalValue || 0);
} else if (sale.paymentType === 'PARTIAL_PAYMENT') {
cust.paid += (sale.totalValue || 0);
}
if (sale.date > cust.lastDate) { cust.lastDate = sale.date; cust.lastType = sale.paymentType; }
});
if (type === 'admin') {
paymentEntities.forEach(entity => {
const entityTxs = paymentTransactions.filter(t => String(t.entityId) === String(entity.id));
const hasIN = entityTxs.some(t => t.type === 'IN');
const hasOUT = entityTxs.some(t => t.type === 'OUT');
const isDerivedPayor = hasIN && !hasOUT;
if (!isDerivedPayor) return;
if (!customerMap.has(entity.name)) {
const nc = initCust(entity.name);
nc.phone = entity.phone || "N/A";
nc.address = entity.address || "N/A";
customerMap.set(entity.name, nc);
} else {
const ex = customerMap.get(entity.name);
if (ex.phone === "N/A" && entity.phone) ex.phone = entity.phone;
if (ex.address === "N/A" && entity.address) ex.address = entity.address;
}
});
}
if (customerMap.size === 0) { showToast("No customers found to export.", "warning"); return; }
const { jsPDF } = window.jspdf;
const doc = new jsPDF('l', 'mm', 'a4');
const pageW = doc.internal.pageSize.getWidth();
const pageH = doc.internal.pageSize.getHeight();
const hdrColor = [40, 167, 69];
doc.setFillColor(...hdrColor);
doc.rect(0, 0, pageW, 22, 'F');
doc.setFontSize(16); doc.setFont(undefined,'bold'); doc.setTextColor(255,255,255);
doc.text('GULL AND ZUBAIR NASWAR DEALERS', pageW/2, 10, { align:'center' });
doc.setFontSize(9); doc.setFont(undefined,'normal');
doc.text('Naswar Manufacturers & Dealers', pageW/2, 17, { align:'center' });
doc.setFontSize(12); doc.setFont(undefined,'bold'); doc.setTextColor(50,50,50);
const titleText = type === 'rep' ? `My Customers — ${currentRepProfile || ''}` : 'All Customers — Complete List';
doc.text(titleText, pageW/2, 30, { align:'center' });
doc.setFontSize(8.5); doc.setFont(undefined,'normal'); doc.setTextColor(100,100,100);
doc.text(`Generated: ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})} at ${new Date().toLocaleTimeString('en-US')}`, pageW/2, 36, { align:'center' });
doc.setDrawColor(...hdrColor); doc.setLineWidth(0.5);
doc.line(14, 39, pageW - 14, 39);
const customerRows = [];
let totDebt = 0, totPaid = 0, totQty = 0, totNet = 0;
let cntDebtors = 0, cntSettled = 0;
const sortedCustomers = [...customerMap.values()].sort((a,b) => (b.debt - b.paid) - (a.debt - a.paid));
sortedCustomers.forEach(cust => {
const net = cust.debt - cust.paid;
totDebt += cust.debt; totPaid += cust.paid; totQty += cust.qty; totNet += net;
if (net > 0.01) cntDebtors++; else cntSettled++;
customerRows.push([
cust.name,
cust.phone,
cust.address.substring(0, 35),
cust.debt > 0 ? 'Rs ' + fmtAmt(cust.debt) : '-',
cust.paid > 0 ? 'Rs ' + fmtAmt(cust.paid) : '-',
Math.abs(net) < 0.01 ? 'SETTLED'
: (net > 0 ? 'Rs ' + fmtAmt(net) : 'OVERPAID\nRs ' + fmtAmt(Math.abs(net))),
fmtAmt(cust.qty),
formatDisplayDate(cust.lastDate) || '-'
]);
});
customerRows.push([
'TOTAL (' + customerMap.size + ' customers)',
'', '',
'Rs ' + fmtAmt(totDebt),
'Rs ' + fmtAmt(totPaid),
'Rs ' + fmtAmt(Math.abs(totNet)) + (totNet > 0 ? '\n(DUE)' : totNet < 0 ? '\n(OVERPAID)' : '\nSETTLED'),
fmtAmt(totQty),
''
]);
doc.autoTable({
startY: 43,
head: [['Customer Name', 'Phone', 'Address', 'Total Debit', 'Total Credit', 'Net Balance', 'Qty (kg)', 'Last Sale']],
body: customerRows,
theme: 'grid',
headStyles: { fillColor: hdrColor, textColor: 255, fontSize: 8.5, fontStyle:'bold', halign:'center' },
styles: { fontSize: 7.5, cellPadding: 2, lineWidth: 0.15, lineColor:[180,180,180], overflow:'linebreak' },
columnStyles: {
0: { cellWidth: 42 },
1: { cellWidth: 26, halign:'center' },
2: { cellWidth: 44 },
3: { cellWidth: 26, halign:'right', textColor:[220,53,69], fontStyle:'bold' },
4: { cellWidth: 26, halign:'right', textColor:[40,167,69], fontStyle:'bold' },
5: { cellWidth: 30, halign:'center', fontStyle:'bold' },
6: { cellWidth: 20, halign:'right' },
7: { cellWidth: 22, halign:'center' }
},
didParseCell: function(data) {
const isTotal = data.row.index === customerRows.length - 1;
if (isTotal) {
data.cell.styles.fontStyle = 'bold';
data.cell.styles.fillColor = [235, 255, 235];
data.cell.styles.fontSize = 8.5;
}
if (data.column.index === 5 && !isTotal) {
const txt = (data.cell.text || []).join('');
if (txt === 'SETTLED') data.cell.styles.textColor = [100,100,100];
else if (txt.includes('OVERPAID')) data.cell.styles.textColor = [40,167,69];
else data.cell.styles.textColor = [220,53,69];
}
},
margin: { left: 14, right: 14 }
});
const afterY = doc.lastAutoTable.finalY + 6;
if (afterY < pageH - 25) {
doc.setFontSize(8); doc.setFont(undefined,'normal'); doc.setTextColor(100,100,100);
doc.text(`Customers with outstanding debt: ${cntDebtors} | Settled accounts: ${cntSettled} | Total outstanding: Rs ${fmtAmt(Math.max(totNet), 2)}`, 14, afterY);
if (hasMergedEntries) {
  const noteY = afterY + 6;
  if (noteY < pageH - 12) {
    doc.setFillColor(245, 235, 255);
    doc.roundedRect(14, noteY, pageW - 28, 9, 1.5, 1.5, 'F');
    doc.setFontSize(7.5); doc.setFont(undefined,'bold'); doc.setTextColor(126, 34, 206);
    doc.text('\u2605 Balances include year-end opening balance records (MERGED) from Close Financial Year — these represent carried-forward net positions.', 18, noteY + 6);
    doc.setFont(undefined,'normal'); doc.setTextColor(80,80,80);
  }
}
}
const pageCount = doc.internal.getNumberOfPages();
for (let i = 1; i <= pageCount; i++) {
doc.setPage(i);
doc.setFontSize(7); doc.setTextColor(160);
doc.text(
`Generated on ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})} at ${new Date().toLocaleTimeString('en-US')} | GULL AND ZUBAIR NASWAR DEALERS`,
pageW/2, pageH - 5, { align:'center' }
);
doc.text(`Page ${i} of ${pageCount}`, pageW/2, pageH - 9, { align:'center' });
}
doc.save(fileName);
showToast(`Exported ${customerMap.size} customers successfully!`, "success");
} catch (error) {
showToast('Error generating PDF: ' + error.message, 'error');
}
}
async function markSalesEntriesAsReceived(seller, quantityToMark) {
if (!seller || seller === 'COMBINED' || quantityToMark <= 0) return [];
const linkedIds = [];
let remainingQty = quantityToMark;
const pendingSales = customerSales
.filter(sale =>
sale.currentRepProfile === 'admin' &&
sale.customerName === seller &&
sale.paymentType === 'CREDIT' &&
!sale.creditReceived
)
.sort((a, b) => a.timestamp - b.timestamp);
for (const sale of pendingSales) {
if (remainingQty <= 0) break;
if (sale.quantity <= remainingQty) {
sale.paymentType = 'CASH';
sale.creditReceived = true;
sale.creditReceivedDate = new Date().toISOString().split('T')[0];
sale.creditReceivedTime = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
sale.updatedAt = getTimestamp();
ensureRecordIntegrity(sale, true);
linkedIds.push(sale.id);
remainingQty -= sale.quantity;
} else {
break;
}
}
if (linkedIds.length > 0) {
await saveWithTracking('customer_sales', customerSales, null, linkedIds);
const modifiedSales = customerSales.filter(s => linkedIds.includes(s.id));
for (const sale of modifiedSales) {
await saveRecordToFirestore('customer_sales', sale);
}
if (typeof refreshCustomerSales === 'function') {
refreshCustomerSales(1, false);
}
}
return linkedIds;
}
async function markRepSalesEntriesAsUsed(seller, date, calcId) {
  if (!seller || seller === 'COMBINED' || !date || !calcId) return [];
  const linkedRepIds = [];
  repSales.forEach(sale => {
    if (
      sale.salesRep === seller &&
      sale.date === date &&
      !sale.usedInCalcId &&
      (sale.paymentType === 'CREDIT' || sale.paymentType === 'COLLECTION')
    ) {
      sale.usedInCalcId = calcId;
      sale.updatedAt = getTimestamp();
      ensureRecordIntegrity(sale, true);
      linkedRepIds.push(sale.id);
    }
  });
  if (linkedRepIds.length > 0) {
    await saveWithTracking('rep_sales', repSales, null, linkedRepIds);
    const modifiedSales = repSales.filter(s => linkedRepIds.includes(s.id));
    for (const sale of modifiedSales) {
      await saveRecordToFirestore('rep_sales', sale);
    }
  }
  return linkedRepIds;
}
async function revertRepSalesEntries(repSaleIds) {
  if (!repSaleIds || repSaleIds.length === 0) return 0;
  let revertedCount = 0;
  repSaleIds.forEach(saleId => {
    const saleIndex = repSales.findIndex(s => s.id === saleId);
    if (saleIndex !== -1) {
      delete repSales[saleIndex].usedInCalcId;
      repSales[saleIndex].updatedAt = getTimestamp();
      ensureRecordIntegrity(repSales[saleIndex], true);
      revertedCount++;
    }
  });
  if (revertedCount > 0) {
    await saveWithTracking('rep_sales', repSales, null, repSaleIds);
    const revertedSales = repSales.filter(s => repSaleIds.includes(s.id));
    for (const sale of revertedSales) {
      await saveRecordToFirestore('rep_sales', sale);
    }
    notifyDataChange('rep');
    triggerAutoSync();
  }
  return revertedCount;
}
function togglePercentage(chartId) {
let btnId = '';
if (chartId === 'mfgPieChart') {
btnId = 'mfgPiePercentageToggle';
} else if (chartId === 'custPaymentChart') {
btnId = 'custPaymentPercentageToggle';
} else if (chartId === 'compositionChart') {
btnId = 'compositionPercentageToggle';
}
const btn = document.getElementById(btnId);
if (!btn) {
return;
}
switch(chartId) {
case 'mfgPieChart':
mfgPieChartShowPercentage = !mfgPieChartShowPercentage;
btn.textContent = mfgPieChartShowPercentage ? 'Show Values' : 'Show %';
updateMfgPieChart();
break;
case 'custPaymentChart':
custPaymentChartShowPercentage = !custPaymentChartShowPercentage;
btn.textContent = custPaymentChartShowPercentage ? 'Show Values' : 'Show %';
updateCustomerPieChart();
break;
case 'compositionChart':
compositionChartShowPercentage = !compositionChartShowPercentage;
btn.textContent = compositionChartShowPercentage ? 'Show Values' : 'Show %';
updateCompositionChart();
break;
}
}
function updateMfgPieChart() {
if (!mfgPieChart) return;
const data = mfgPieChart.data.datasets[0].data;
const total = data.reduce((a, b) => a + b, 0);
if (mfgPieChartShowPercentage) {
mfgPieChart.data.datasets[0].data = data.map(value => total > 0 ? ((value / total) * 100).toFixed(2) : 0);
mfgPieChart.options.plugins.tooltip = {
callbacks: {
label: function(context) {
return `${context.label}: ${context.parsed}%`;
}
}
};
} else {
updateMfgCharts();
}
mfgPieChart.update();
}
function updateCustomerPieChart() {
if (!custPaymentChart) return;
const data = custPaymentChart.data.datasets[0].data;
const total = data.reduce((a, b) => a + b, 0);
if (custPaymentChartShowPercentage) {
custPaymentChart.data.datasets[0].data = data.map(value => total > 0 ? ((value / total) * 100).toFixed(2) : 0);
custPaymentChart.options.plugins.tooltip = {
callbacks: {
label: function(context) {
return `${context.label}: ${context.parsed}%`;
}
}
};
} else {
updateCustomerCharts();
}
custPaymentChart.update();
}
async function updateCompositionChart() {
if (!salesCompChart) return;
const data = salesCompChart.data.datasets[0].data;
const total = data.reduce((a, b) => a + b, 0);
if (compositionChartShowPercentage) {
salesCompChart.data.datasets[0].data = data.map(value => total > 0 ? ((value / total) * 100).toFixed(2) : 0);
salesCompChart.options.plugins.tooltip = {
callbacks: {
label: function(context) {
return `${context.label}: ${context.parsed}%`;
}
}
};
} else {
const seller = document.getElementById('sellerSelect').value;
if (seller === 'COMBINED') {
const comp = await calculateComparisonData();
updateSalesCharts(comp);
}
}
salesCompChart.update();
}
async function setIndChartMode(mode) {
currentIndMode = mode;
document.getElementById('ind-week-btn').className = `toggle-opt ${mode === 'week' ? 'active' : ''}`;
document.getElementById('ind-month-btn').className = `toggle-opt ${mode === 'month' ? 'active' : ''}`;
document.getElementById('ind-year-btn').className = `toggle-opt ${mode === 'year' ? 'active' : ''}`;
document.getElementById('ind-all-btn').className = `toggle-opt ${mode === 'all' ? 'active' : ''}`;
await updateIndChart();
}
async function setIndChartMetric(metric) {
currentIndMetric = metric;
await updateIndChart();
}
async function updateIndChart() {
if (typeof Chart === 'undefined') {
try { await loadChartJs(); } catch (e) { return; }
}
const seller = document.getElementById('sellerSelect').value;
if (seller === 'COMBINED') return;
if(indPerformanceChart) indPerformanceChart.destroy();
let history; history = await idb.get('noman_history', []);
const sellerHistory = history.filter(h => h.seller === seller);
const now = new Date(document.getElementById('sale-date').value);
const selectedYear = now.getFullYear();
const selectedMonth = now.getMonth();
const selectedDay = now.getDate();
let labels = [];
let data = [];
if (currentIndMode === 'week') {
for(let i=6; i>=0; i--) {
const d = new Date(now);
d.setDate(now.getDate() - i);
const dateStr = d.toISOString().split('T')[0];
labels.push(d.toLocaleDateString('en-US', {weekday:'short'}));
let metricValue = 0;
sellerHistory.forEach(h => {
if(h.date === dateStr) {
metricValue += getMetricValue(h, currentIndMetric);
}
});
data.push(metricValue);
}
} else if (currentIndMode === 'month') {
const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
labels = Array.from({length: daysInMonth}, (_, i) => i + 1);
data = new Array(daysInMonth).fill(0);
sellerHistory.forEach(h => {
const d = new Date(h.date);
if(d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
const day = d.getDate();
data[day - 1] += getMetricValue(h, currentIndMetric);
}
});
} else if (currentIndMode === 'year') {
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
labels = months;
data = new Array(12).fill(0);
sellerHistory.forEach(h => {
const d = new Date(h.date);
if(d.getFullYear() === now.getFullYear()) {
const month = d.getMonth();
data[month] += getMetricValue(h, currentIndMetric);
}
});
} else if (currentIndMode === 'all') {
const allMonths = [];
const monthData = {};
sellerHistory.forEach(h => {
const d = new Date(h.date);
const monthYear = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = `${d.toLocaleDateString('en-US', {month:'short'})} ${d.getFullYear()}`;
if (!monthData[monthYear]) {
monthData[monthYear] = {
label: monthLabel,
value: 0
};
}
monthData[monthYear].value += getMetricValue(h, currentIndMetric);
});
const sortedMonths = Object.keys(monthData).sort();
sortedMonths.forEach(monthKey => {
labels.push(monthData[monthKey].label);
data.push(monthData[monthKey].value);
});
if (labels.length > 12) {
labels = labels.slice(-12);
data = data.slice(-12);
}
}
const colors = {
text: '#1e3a8a',
grid: 'rgba(37, 99, 235, 0.1)'
};
const repChartColorsInd = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2'];
const sellerColor = repChartColorsInd[salesRepsList.indexOf(seller) >= 0 ? salesRepsList.indexOf(seller) : 0];
const chartElement = document.getElementById('indPerformanceChart');
if (!chartElement) {
return;
}
const ctx = chartElement.getContext('2d');
if (!ctx) {
return;
}
indPerformanceChart = new Chart(ctx, {
type: 'bar',
data: {
labels: labels,
datasets: [{
label: getMetricLabel(currentIndMetric),
data: data,
backgroundColor: sellerColor + '80',
borderColor: sellerColor,
borderWidth: 1,
borderRadius: 4
}]
},
options: {
responsive: true,
maintainAspectRatio: false,
plugins: {
legend: { display: false },
title: {
display: true,
text: `${getMetricLabel(currentIndMetric)} - ${currentIndMode === 'all' ? 'All Times' : currentIndMode.charAt(0).toUpperCase() + currentIndMode.slice(1) + 'ly'} View`,
color: colors.text,
font: { size: 13, weight: 'bold' }
}
},
scales: {
y: {
beginAtZero: true,
grid: { color: colors.grid },
ticks: { color: colors.text }
},
x: {
ticks: { color: colors.text, maxRotation: 45 }
}
}
}
});
}
function setStoreComparisonMetric(metric, event) {
if (event) {
event.preventDefault();
}
currentStoreComparisonMetric = metric;
document.querySelectorAll('.metric-btn').forEach(btn => {
btn.classList.remove('active');
});
if (event && event.target) {
event.target.classList.add('active');
}
updateStoreComparisonChart(currentOverviewMode);
}
function updateStoreComparisonChart(mode = 'day') {
if (typeof Chart === 'undefined') {
loadChartJs().then(() => updateStoreComparisonChart(mode)).catch(() => {});
return;
}
if(storeComparisonChart) storeComparisonChart.destroy();
const selectedDate = document.getElementById('sys-date').value;
const selectedDateObj = new Date(selectedDate);
const selectedYear = selectedDateObj.getFullYear();
const selectedMonth = selectedDateObj.getMonth();
const selectedDay = selectedDateObj.getDate();
const stores = ['STORE_A', 'STORE_B', 'STORE_C'];
const storeLabels = ['ZUBAIR', 'MAHMOOD', 'ASAAN'];
const storeColors = ['#3b82f6', '#8b5cf6', '#10b981'];
let data = [];
let metricLabel = '';
stores.forEach(store => {
let storeData = {
weight: 0,
value: 0,
cost: 0,
profit: 0
};
db.forEach(item => {
const itemDate = new Date(item.date);
const itemYear = itemDate.getFullYear();
const itemMonth = itemDate.getMonth();
const itemDay = itemDate.getDate();
let includeItem = false;
if (mode === 'day' && item.date === selectedDate) {
includeItem = true;
} else if (mode === 'week') {
const weekStart = new Date(selectedDateObj);
weekStart.setDate(selectedDay - 6);
if (itemDate >= weekStart && itemDate <= selectedDateObj) {
includeItem = true;
}
} else if (mode === 'month' && itemYear === selectedYear && itemMonth === selectedMonth) {
includeItem = true;
} else if (mode === 'year' && itemYear === selectedYear) {
includeItem = true;
} else if (mode === 'all') {
includeItem = true;
}
if (includeItem && item.store === store) {
storeData.weight += (item.net || 0);
storeData.value += (item.totalSale || 0);
storeData.cost += (item.totalCost || 0);
storeData.profit += (item.profit || 0);
}
});
data.push(storeData[currentStoreComparisonMetric]);
});
switch(currentStoreComparisonMetric) {
case 'weight': metricLabel = 'Weight (kg)'; break;
case 'value': metricLabel = 'Total Value ()'; break;
case 'cost': metricLabel = 'Total Cost ()'; break;
case 'profit': metricLabel = 'Net Profit ()'; break;
}
const colors = {
text: '#1e3a8a',
grid: 'rgba(37, 99, 235, 0.1)'
};
const storeChartElement = document.getElementById('storeComparisonChart');
if (!storeChartElement) {
return;
}
const storeCtx = storeChartElement.getContext('2d');
if (!storeCtx) {
return;
}
storeComparisonChart = new Chart(storeCtx, {
type: 'bar',
data: {
labels: storeLabels,
datasets: [{
label: metricLabel,
data: data,
backgroundColor: storeColors,
borderColor: storeColors,
borderWidth: 1,
borderRadius: 6
}]
},
options: {
responsive: true,
maintainAspectRatio: false,
plugins: {
legend: { display: false },
title: {
display: true,
text: `Store Comparison by ${metricLabel} (${mode === 'all' ? 'All Times' : mode.charAt(0).toUpperCase() + mode.slice(1)})`,
color: colors.text,
font: { size: 13, weight: 'bold' }
}
},
scales: {
y: {
beginAtZero: true,
grid: { color: colors.grid },
ticks: { color: colors.text }
},
x: {
ticks: { color: colors.text }
}
}
}
});
}
async function refreshUI(page = 1, force = false) {
const selectedDate = document.getElementById('sys-date').value;
if (!selectedDate) return;
if (idb && idb.get) {
try {
let freshProduction = await idb.get('mfg_pro_pkr', []);
if (freshProduction && freshProduction.length > 0) {
let fixedCount = 0;
freshProduction = freshProduction.map(record => {
if (!record.id || !validateUUID(record.id) ||
!record.createdAt || !validateTimestamp(record.createdAt) ||
!record.updatedAt || !validateTimestamp(record.updatedAt)) {
record = ensureRecordIntegrity(record, false, true);
fixedCount++;
}
return record;
});
if (fixedCount > 0) {
await idb.set('mfg_pro_pkr', freshProduction);
}
db = freshProduction;
}
} catch (error) {
console.error('Failed to save data locally.', _safeErr(error));
showToast('Failed to save data locally.', 'error');
}
}
const [sYear, sMonth, sDay] = selectedDate.split('-').map(Number);
const selectedDateObj = new Date(sYear, sMonth - 1, sDay);
const weekStart = new Date(selectedDateObj);
weekStart.setDate(selectedDateObj.getDate() - 6);
weekStart.setHours(0,0,0,0);
let stats = {
day: {q:0, p:0, c:0, v:0, fu:0, fc:0},
week: {q:0, p:0, c:0, v:0, fu:0, fc:0},
month: {q:0, p:0, c:0, v:0, fu:0, fc:0},
year: {q:0, p:0, c:0, v:0, fu:0, fc:0},
all: {q:0, p:0, c:0, v:0, fu:0, fc:0}
};
let filteredData = currentProductionView === 'combined' ? db : db.filter(item => item.store === currentStore);
const sortedDb = [...filteredData].sort((a, b) => {
if (a.date === selectedDate && b.date !== selectedDate) return -1;
if (a.date !== selectedDate && b.date === selectedDate) return 1;
return b.timestamp - a.timestamp;
});
sortedDb.forEach(item => {
if(!item.date) return;
if(item.isReturn) return;
const [rowYear, rowMonth, rowDay] = item.date.split('-').map(Number);
const rowDateObj = new Date(rowYear, rowMonth - 1, rowDay);
rowDateObj.setHours(0,0,0,0);
if(item.date === selectedDate) {
stats.day.q += (item.net || 0); stats.day.p += (item.profit || 0); stats.day.c += (item.totalCost || 0);
stats.day.v += (item.totalSale || 0); stats.day.fu += (item.formulaUnits || 0); stats.day.fc += (item.formulaCost || 0);
}
if(rowDateObj >= weekStart && rowDateObj <= selectedDateObj) {
stats.week.q += (item.net || 0); stats.week.p += (item.profit || 0); stats.week.c += (item.totalCost || 0);
stats.week.v += (item.totalSale || 0); stats.week.fu += (item.formulaUnits || 0); stats.week.fc += (item.formulaCost || 0);
}
if(rowYear === sYear && rowMonth === sMonth) {
stats.month.q += (item.net || 0); stats.month.p += (item.profit || 0); stats.month.c += (item.totalCost || 0);
stats.month.v += (item.totalSale || 0); stats.month.fu += (item.formulaUnits || 0); stats.month.fc += (item.formulaCost || 0);
}
if(rowYear === sYear) {
stats.year.q += (item.net || 0); stats.year.p += (item.profit || 0); stats.year.c += (item.totalCost || 0);
stats.year.v += (item.totalSale || 0); stats.year.fu += (item.formulaUnits || 0); stats.year.fc += (item.formulaCost || 0);
}
stats.all.q += (item.net || 0); stats.all.p += (item.profit || 0); stats.all.c += (item.totalCost || 0);
stats.all.v += (item.totalSale || 0); stats.all.fu += (item.formulaUnits || 0); stats.all.fc += (item.formulaCost || 0);
});
const histMode = (currentProductionView === 'store') ? 'day' : (currentOverviewMode || 'day');
const pageData = sortedDb.filter(item => {
if (!item.date) return true;
const [rowY, rowM, rowD] = item.date.split('-').map(Number);
const rowDateObj = new Date(rowY, rowM - 1, rowD);
rowDateObj.setHours(0, 0, 0, 0);
if (histMode === 'day') return item.date === selectedDate;
if (histMode === 'week') return rowDateObj >= weekStart && rowDateObj <= selectedDateObj;
if (histMode === 'month') return rowY === sYear && rowM === sMonth;
if (histMode === 'year') return rowY === sYear;
return true;
});
const validPage = 1;
const totalPages = 1;
const totalItems = pageData.length;
const cacheData = {
pageData, stats, selectedDate, totalPages, totalItems, validPage
};
renderProductionFromCache(cacheData);
}
function renderProductionFromCache(cached) {
const { pageData, stats, selectedDate, totalPages, totalItems, validPage } = cached;
const histContainer = document.getElementById('prodHistoryList');
if (totalItems === 0) {
histContainer.replaceChildren(Object.assign(document.createElement('p'), {textContent:'No records found for this selection.',style:'text-align:center;color:var(--text-muted);width:100%;font-size:0.85rem'}));
} else {
const fragment = document.createDocumentFragment();
pageData.forEach(item => {
const isSelected = item.date === selectedDate;
const highlightClass = isSelected ? 'highlight-card' : '';
const dateDisplay = isSelected ? `${formatDisplayDate(item.date)} (Selected)` : formatDisplayDate(item.date);
const storeBadgeClass = item.store === 'STORE_A' ? 'store-a' : item.store === 'STORE_B' ? 'store-b' : 'store-c';
const storeLabel = item.store === 'STORE_A' ? 'ZUBAIR' : item.store === 'STORE_B' ? 'MAHMOOD' : 'ASAAN';
let returnBadge = '';
if (item.isReturn) {
returnBadge = `<span class="payment-badge" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); top: 35px; right: 12px;"> RETURN</span>`;
}
let paymentBadge = '';
let mergedBadge = '';
if (item.isMerged) {
mergedBadge = _mergedBadgeHtml(item, {inline:true});
}
const div = document.createElement('div');
div.className = `card liquid-card ${highlightClass}`;
if (item.date) div.setAttribute('data-date', item.date);
let returnsByStoreHtml = '';
if (item.isMerged && item.isReturn && item.returnsByStore && Object.keys(item.returnsByStore).length > 1) {
  const storeLabels2 = { STORE_A:'ZUBAIR', STORE_B:'MAHMOOD', STORE_C:'ASAAN' };
  returnsByStoreHtml = Object.entries(item.returnsByStore).map(([s,q]) =>
    `<p><span style="color:var(--text-muted);">${esc(storeLabels2[s]||s)}:</span> <span class="qty-val">${safeValue(q).toFixed(2)} kg</span></p>`
  ).join('');
}
div.innerHTML = `
${currentProductionView === 'combined' ? `<span class="store-badge ${storeBadgeClass}">${esc(storeLabel)}</span>` : ''}
${returnBadge}
${item.isMerged ? '' : paymentBadge}
<h4>${dateDisplay} @ ${esc(item.time || '')}${mergedBadge}</h4>
${item.managedBy ? `<span style="display:inline-flex;align-items:center;gap:4px;margin:2px 0 5px;padding:2px 9px;font-size:0.65rem;font-weight:700;letter-spacing:0.04em;color:var(--warning);background:rgba(255,179,0,0.10);border:1px solid rgba(255,179,0,0.28);border-radius:999px;">${esc(item.managedBy)}</span><br>` : ''}
${item.createdBy ? `${(typeof _creatorBadgeHtml === 'function') ? _creatorBadgeHtml(item) : ''}<br>` : ''}
${item.isReturn ? `<p style="color:var(--accent-emerald); font-size:0.75rem; font-style:italic;">${item.isMerged ? 'Merged returns by' : 'Returned by'} ${esc(item.returnedBy || 'Representative')}</p>` : ''}
<p><span>Net Weight:</span> <span class="qty-val">${safeValue(item.net).toFixed(2)} kg</span></p>
<p><span>Cost Price:</span> <span class="cost-val">${safeValue(item.cp).toFixed(2)}/kg</span></p>
<p><span>Sale Price:</span> <span class="rev-val">${safeValue(item.sp).toFixed(2)}/kg</span></p>
<hr>
<p><span>Total Cost:</span> <span class="cost-val">${fmtAmt(safeValue(item.totalCost))}</span></p>
<p><span>Total Value:</span> <span class="rev-val">${fmtAmt(safeValue(item.totalSale))}</span></p>
<p><span>Net Profit:</span> <span class="profit-val">${fmtAmt(safeValue(item.profit))}</span></p>
${returnsByStoreHtml}
${item.formulaUnits && !item.isReturn ? `<p><span>Formula Units:</span> <span class="qty-val">${safeValue(item.formulaUnits).toFixed(2)}</span></p>` : ''}
${item.formulaCost && !item.isReturn ? `<p><span>Formula Cost:</span> <span class="cost-val">${fmtAmt(safeValue(item.formulaCost))}</span></p>` : ''}
${item.isMerged ? '' : `<button class="tbl-action-btn danger u-w-full u-mt-8" onclick="(async () => { await deleteProdEntry('${esc(item.id)}') })()">Delete</button>`}
`;
fragment.appendChild(div);
});
histContainer.replaceChildren(fragment);
}
const updateStats = (idPrefix, statObj) => {
const _st = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
_st(`${idPrefix}-qty`, `${safeValue(statObj.q).toFixed(2)} kg`);
_st(`${idPrefix}-value`, `${fmtAmt(safeValue(statObj.v))}`);
_st(`${idPrefix}-cost`, `${fmtAmt(safeValue(statObj.c))}`);
_st(`${idPrefix}-profit`, `${fmtAmt(safeValue(statObj.p))}`);
_st(`${idPrefix}-formula-units`, `${fmtAmt(safeValue(statObj.fu))}`);
_st(`${idPrefix}-formula-cost`, `${fmtAmt(safeValue(statObj.fc))}`);
};
updateStats('day', stats.day);
updateStats('week', stats.week);
updateStats('month', stats.month);
updateStats('year', stats.year);
updateStats('all', stats.all);
updateMfgCharts();
if (currentProductionView === 'combined') {
updateAllStoresOverview(currentOverviewMode);
}
updateUnitsAvailableIndicator();
}
function filterProductionHistory() {
const searchTerm = document.getElementById('production-search').value.toLowerCase();
const allCards = document.querySelectorAll('#prodHistoryList .card');
allCards.forEach(card => {
const cardText = card.textContent.toLowerCase();
if (cardText.includes(searchTerm)) {
card.style.display = '';
} else {
card.style.display = 'none';
}
});
}
function filterCalculatorHistory() {
const searchTerm = document.getElementById('calculator-search').value.toLowerCase();
const allCards = document.querySelectorAll('#historyList .card');
allCards.forEach(card => {
const cardText = card.textContent.toLowerCase();
const sellerElement = card.querySelector('.seller-badge');
const sellerText = sellerElement ? sellerElement.textContent.toLowerCase() : '';
if (cardText.includes(searchTerm) || sellerText.includes(searchTerm)) {
card.style.display = '';
} else {
card.style.display = 'none';
}
});
}
function filterCustomerTransactions() {
const searchTerm = document.getElementById('customer-search').value.toLowerCase();
const allCards = document.querySelectorAll('#custHistoryList .card');
allCards.forEach(card => {
const customerName = card.querySelector('.customer-name')?.textContent.toLowerCase() || '';
if (customerName.includes(searchTerm)) {
card.style.display = '';
} else {
card.style.display = 'none';
}
});
}
let currentEntityId = null;
let currentQuickType = 'OUT';
let currentExpenseOverlayName = null;
async function renderEntityTable(page = 1) {
const tbody = document.getElementById('entity-table-body');
const filterInput = document.getElementById('entity-list-filter');
const filter = filterInput ? String(filterInput.value).toLowerCase() : '';
if (!tbody) return;
try {
const freshEntities = await idb.get('payment_entities', []);
if (Array.isArray(freshEntities)) {
const entityMap = new Map(freshEntities.map(e => [e.id, e]));
if (Array.isArray(paymentEntities)) {
paymentEntities.forEach(e => {
if (!entityMap.has(e.id)) {
entityMap.set(e.id, e);
}
});
}
paymentEntities = Array.from(entityMap.values());
}
const freshTransactions = await idb.get('payment_transactions', []);
if (Array.isArray(freshTransactions)) {
const txMap = new Map(freshTransactions.map(t => [t.id, t]));
if (Array.isArray(paymentTransactions)) {
paymentTransactions.forEach(t => {
if (!txMap.has(t.id)) {
txMap.set(t.id, t);
}
});
}
paymentTransactions = Array.from(txMap.values());
}
} catch (error) {
console.error('Payment transaction failed.', _safeErr(error));
showToast('Payment transaction failed.', 'error');
}

try {
const _freshInv = await idb.get('factory_inventory_data', []);
if (_freshInv && Array.isArray(_freshInv) && _freshInv.length > 0) {
factoryInventoryData = _freshInv;
}
} catch (_e) {}
const balances = calculateEntityBalances();
let totalReceivables = 0;
let totalPayables = 0;
const filteredEntities = paymentEntities.filter(e => !e.isExpenseEntity);
const sortedEntities = [...filteredEntities].sort((a, b) => {
const balA = Math.abs(balances[a.id] || 0);
const balB = Math.abs(balances[b.id] || 0);
return balB - balA;
});
const matchedEntities = sortedEntities.filter(entity => {
const safeName = String(entity.name || 'Unknown Entity');
return !filter || safeName.toLowerCase().includes(filter);
});
matchedEntities.forEach(entity => {
const balance = balances[entity.id] || 0;
if (balance > 0) totalPayables += balance;
else totalReceivables += Math.abs(balance);
});
const pageEntities = matchedEntities;
const validPage = 1;
const totalPages = 1;
const totalItems = matchedEntities.length;
const startIndex = 0;
const endIndex = matchedEntities.length;
const entitiesData = {
pageEntities,
balances,
totalReceivables,
totalPayables,
totalItems,
totalPages,
validPage
};
if (entitiesData && entitiesData.pageEntities) {
renderEntitiesFromCache(entitiesData, tbody);
} else {
tbody.innerHTML = `<tr><td class="u-text-center u-text-danger" colspan="4" >Failed to load entity data</td></tr>`;
}
}
function renderEntitiesFromCache(data, tbody) {
if (!data) {
tbody.innerHTML = `<tr><td class="u-text-center u-text-danger" colspan="4" >Error loading entities</td></tr>`;
return;
}
const { pageEntities, balances, totalReceivables, totalPayables, totalItems, totalPages, validPage } = data;
if (!pageEntities || !Array.isArray(pageEntities) || !balances) {
tbody.innerHTML = `<tr><td class="u-text-center u-text-danger" colspan="4" >Invalid entity data</td></tr>`;
return;
}
if (totalItems === 0) {
tbody.replaceChildren(Object.assign(document.createElement('tr'), {innerHTML:'<td colspan="4" style="text-align:center;padding:15px;color:var(--text-muted)">No entities found</td>'}));
} else {
const fragment = document.createDocumentFragment();
pageEntities.forEach(entity => {
const safeName = String(entity.name || 'Unknown Entity');
const balance = balances[entity.id] || 0;
let balanceHtml = '';
if (balance > 0.01) {
balanceHtml = `<span class="u-danger-bold" >Payable: ${fmtAmt(balance)}</span>`;
} else if (balance < -0.01) {
balanceHtml = `<span class="u-text-emerald u-fw-800" >Receivable: ${fmtAmt(Math.abs(balance))}</span>`;
} else {
balanceHtml = `<span class="u-text-muted" >Settled</span>`;
}
const tr = document.createElement('tr');
const safeNameForClick = safeName.replace(/'/g, "\\'");
tr.innerHTML = `
<td style="text-align:left;">
<div class="u-fw-700" >${esc(safeName)}</div>
</td>
<td style="text-align:right;">${balanceHtml}</td>
<td style="text-align:right; font-size:0.75rem;">${phoneActionHTML(entity.phone)}</td>
<td class="u-text-center" >
<button class="btn-theme" style="padding:4px 12px; font-size:0.75rem; border-radius:999px; margin-right: 5px;"
onclick="editEntityBasicInfo('${esc(entity.id)}')" title="Edit entity details">
Edit
</button>
<button class="btn-theme" style="padding:4px 12px; font-size:0.75rem; border-radius:999px; background: var(--accent); color: white; border:none;"
onclick="openEntityDetailsOverlay('${esc(entity.id)}')" title="View transactions">
Transactions
</button>
</td>
`;
fragment.appendChild(tr);
});
tbody.appendChild(fragment);
}
const recEl = document.getElementById('total-receivables');
const payEl = document.getElementById('total-payables');
if(recEl) recEl.innerText = `${fmtAmt(totalReceivables)}`;
if(payEl) payEl.innerText = `${fmtAmt(totalPayables)}`;
}
function filterEntityList() {
const searchTerm = document.getElementById('entity-list-search')?.value.toLowerCase() || '';
if (entityListViewType === 'table') {
const rows = document.querySelectorAll('#entityListBody tr');
rows.forEach(row => {
const entityName = row.querySelector('strong')?.textContent.toLowerCase() || '';
const phone = row.querySelector('div[style*="font-size:0.7rem"]')?.textContent.toLowerCase() || '';
if (entityName.includes(searchTerm) || phone.includes(searchTerm)) {
row.style.display = '';
} else {
row.style.display = 'none';
}
});
} else {
const cards = document.querySelectorAll('#entityListBody .entity-card');
cards.forEach(card => {
const cardText = card.textContent.toLowerCase();
if (cardText.includes(searchTerm)) {
card.style.display = '';
} else {
card.style.display = 'none';
}
});
}
}
function viewEntityTransactions(entityId) {
const entity = paymentEntities.find(e => String(e.id) === String(entityId));
if (!entity) return;
const entityTransactions = paymentTransactions.filter(t => String(t.entityId) === String(entityId));
let message = `Transactions for ${entity.name}\n\n`;
if (entityTransactions.length === 0) {
message += "No transactions found.";
} else {
entityTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));
let totalIn = 0, totalOut = 0;
entityTransactions.forEach((t, index) => {
const typeText = t.type === 'IN' ? 'RECEIVED' : 'PAID';
const amount = fmtAmt(t.amount);
message += `${index + 1}. ${t.date} ${t.time || ''}\n`;
message += ` ${typeText}: ${amount}\n`;
message += ` Description: ${t.description}\n`;
message += ` ---\n`;
if (t.type === 'IN') totalIn += t.amount;
else totalOut += t.amount;
});
const netBalance = totalIn - totalOut;
message += `\nSUMMARY:\n`;
message += `Total Received: ${fmtAmt(totalIn)}\n`;
message += `Total Paid: ${fmtAmt(totalOut)}\n`;
message += `Net Balance: ${fmtAmt(netBalance)}\n`;
}
showToast(message, 'info', 5000);
}
async function syncSuppliersToEntities() {
factoryInventoryData.forEach(material => {
if (!material.supplierName) return;
const existingEntity = paymentEntities.find(e =>
(e.name === material.supplierName && e.type === 'payee') ||
(material.supplierId && String(e.id) === String(material.supplierId))
);
if (!existingEntity) {
let _sseId = material.supplierId || generateUUID('supp');
if (!validateUUID(_sseId)) _sseId = generateUUID('supp');
const _sseNow = Date.now();
let _sseEntity = {
id: _sseId,
name: material.supplierName,
type: 'payee',
phone: material.supplierContact || '',
wallet: '',
createdAt: _sseNow,
updatedAt: _sseNow,
timestamp: _sseNow,
isSupplier: true,
supplierCategory: 'raw_materials'
};
_sseEntity = ensureRecordIntegrity(_sseEntity, false);
paymentEntities.push(_sseEntity);
} else if (material.supplierId && existingEntity.id !== material.supplierId) {
material.supplierId = existingEntity.id;
}
});
await saveWithTracking('payment_entities', paymentEntities);
await saveWithTracking('factory_inventory_data', factoryInventoryData);
}
async function verifyAccountPassword(password) {
  if (!currentUser || !password) return false;
  const email = currentUser.email;
  if (navigator.onLine && typeof firebase !== 'undefined' && firebase.apps.length) {
    try {
      const firebaseAuth = auth || firebase.auth();
      await firebaseAuth.signInWithEmailAndPassword(email, password);
      return true;
    } catch (fbErr) {
      if (fbErr.code && fbErr.code.startsWith('auth/')) return false;
      console.warn('Firebase reauth network error, falling back to offline check:', fbErr.message);
    }
  }
  try {
    return await OfflineAuth.verifyCredentials(email, password);
  } catch (e) {
    console.error('OfflineAuth verification error:', _safeErr(e));
    return false;
  }
}
async function promptVerifiedBackupPassword({ title = 'Confirm Password', subtitle = 'Enter your account password to encrypt this backup file.', inputId = '_bkp_pwd_modal_input' } = {}) {
  if (!currentUser) return null;
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);display:flex;align-items:center;justify-content:center;z-index:200001;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);';
    modal.innerHTML = `
    <div class="liquid-card" style="max-width:370px;width:92%;padding:28px 24px;text-align:center;">
      <div style="font-size:1.6rem;margin-bottom:8px;">🔐</div>
      <h3 style="margin:0 0 6px;color:var(--text-main);font-size:1rem;font-weight:800;font-family:'Bricolage Grotesque',system-ui,sans-serif;">${esc(title)}</h3>
      <p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:6px;line-height:1.5;">${esc(subtitle)}</p>
      <p style="font-size:0.72rem;color:var(--accent);margin-bottom:14px;">Account: <strong>${esc(currentUser.email)}</strong></p>
      <div style="position:relative;margin-bottom:8px;">
        <input type="password" id="${inputId}" placeholder="Your account password" autocomplete="current-password"
          style="width:100%;padding:11px 40px 11px 12px;background:var(--input-bg);border:1.5px solid var(--glass-border);border-radius:10px;box-sizing:border-box;color:var(--text-main);font-size:0.9rem;outline:none;transition:border-color 0.2s;"
          onfocus="this.style.borderColor='rgba(52,217,116,0.5)'" onblur="this.style.borderColor='var(--glass-border)'">
        <button type="button" tabindex="-1"
          onclick="(function(btn){const inp=document.getElementById('${inputId}');inp.type=inp.type==='password'?'text':'password';btn.querySelector('svg').style.opacity=inp.type==='text'?'1':'0.45';})(this)"
          style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;padding:2px;color:var(--text-muted);line-height:0;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.45;transition:opacity 0.2s;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </div>
      <div id="${inputId}_err" style="font-size:0.74rem;color:var(--danger);min-height:18px;margin-bottom:10px;text-align:left;padding-left:2px;"></div>
      <div style="display:flex;gap:10px;">
        <button id="${inputId}_ok" style="flex:1;padding:11px;background:var(--accent);border:none;border-radius:10px;color:#003d2e;font-weight:700;cursor:pointer;font-size:0.88rem;transition:opacity 0.2s;">Encrypt &amp; Download</button>
        <button id="${inputId}_cancel" style="flex:1;padding:11px;background:var(--input-bg);border:1px solid var(--glass-border);border-radius:10px;color:var(--text-main);cursor:pointer;font-size:0.88rem;">Cancel</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    const inp = document.getElementById(inputId);
    const errEl = document.getElementById(inputId + '_err');
    const okBtn = document.getElementById(inputId + '_ok');
    setTimeout(() => { if (inp) inp.focus(); }, 100);
    if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') okBtn.click(); });
    okBtn.onclick = async () => {
      const pwd = inp ? inp.value : '';
      if (!pwd) { errEl.textContent = 'Please enter your password.'; return; }
      okBtn.disabled = true;
      okBtn.style.opacity = '0.6';
      okBtn.textContent = 'Verifying…';
      errEl.textContent = '';
      const valid = await verifyAccountPassword(pwd);
      if (valid) {
        document.body.removeChild(modal);
        resolve(pwd);
      } else {
        okBtn.disabled = false;
        okBtn.style.opacity = '1';
        okBtn.textContent = 'Encrypt & Download';
        errEl.textContent = '✕ Incorrect password — please try again.';
        if (inp) { inp.value = ''; inp.focus(); }
      }
    };
    document.getElementById(inputId + '_cancel').onclick = () => {
      document.body.removeChild(modal);
      resolve(null);
    };
  });
}
async function unifiedBackup() {
if (!currentUser) {
showToast('Please sign in to create a backup.', 'error');
showAuthOverlay();
return;
}
if (currentUser) {
const _bkpMsg = `Choose how to save your data backup.\n\nCloud Backup: Uploads a snapshot to your connected cloud account. Accessible from any signed-in device.\n\nDownload Encrypted File: Saves an AES-256-GCM encrypted backup file to this device. The file is unreadable without your login credentials.\n\n🔐 Your account credentials are used to encrypt the file.`;
if (await showGlassConfirm(_bkpMsg, { title: 'Save Backup', confirmText: 'Cloud Backup', cancelText: 'Download Encrypted File' })) {
await pushDataToCloud();
return;
}
}
const data = {
mfg: db,
sales: await idb.get('noman_history', []),
customerSales: await idb.get('customer_sales', []),
repSales: repSales,
repCustomers: repCustomers,
salesCustomers: salesCustomers,
factoryInventoryData: factoryInventoryData,
factoryProductionHistory: factoryProductionHistory,
factoryDefaultFormulas: factoryDefaultFormulas,
factoryAdditionalCosts: factoryAdditionalCosts,
factoryCostAdjustmentFactor: factoryCostAdjustmentFactor,
factorySalePrices: factorySalePrices,
factoryUnitTracking: factoryUnitTracking,
paymentEntities: paymentEntities,
paymentTransactions: paymentTransactions,
expenses: expenseRecords,
stockReturns: stockReturns,
settings: await idb.get('naswar_default_settings', defaultSettings),
deleted_records: Array.from(deletedRecordIds),
_meta: { encryptedFor: currentUser.email, createdAt: Date.now(), version: 3 }
};
const encEmail = currentUser.email;
const encPassword = await promptVerifiedBackupPassword({ inputId: 'enc_bkp_pwd' });
if (!encPassword) {
showToast('Backup cancelled.', 'info');
return;
}
try {
showToast('🔐 Encrypting backup with AES-256-GCM...', 'info', 3000);
const encryptedBlob = await CryptoEngine.encrypt(data, encEmail, encPassword);
const timestamp = new Date().toISOString().split('T')[0];
_triggerFileDownload(encryptedBlob, `NaswarDealers_SecureBackup_${timestamp}.gznd`);
showToast('🔐 Encrypted backup created! File requires your credentials to restore.', 'success', 5000);
} catch(encErr) {
console.error('Encryption failed:', _safeErr(encErr));
showToast('Encryption failed: ' + encErr.message, 'error');
}
}
async function unifiedRestore(event) {
const file = event.target.files[0];
if (!file) return;
event.target.value = '';
if (!currentUser) {
showToast('Please sign in before restoring a backup.', 'error');
showAuthOverlay();
return;
}
const isEncrypted = file.name.toLowerCase().endsWith('.gznd');
if (isEncrypted) {
const _encRestoreMsg = `Restore data from this encrypted backup file?\n\nHow it works:\n \u2022 Records are merged, not overwritten \u2014 your current data stays\n \u2022 Duplicates are automatically removed\n \u2022 Only new (non-duplicate) records are uploaded to cloud\n \u2022 Other devices are not affected until their next sync\n\nYou will be asked for your account password to decrypt the file.`;
if (!(await showGlassConfirm(_encRestoreMsg, { title: 'Restore From Encrypted Backup', confirmText: 'Restore & Merge', cancelText: 'Cancel' }))) return;
showToast('Encrypted backup detected. Decrypting...', 'info', 4000);
let decPassword = null;
if (!decPassword) {
decPassword = await new Promise((resolve) => {
const modal = document.createElement('div');
modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:20000;';
modal.innerHTML = `
<div class="liquid-card" style="max-width:360px;width:90%;padding:30px;text-align:center;">
<h3 style="margin:0 0 8px 0;color:var(--text-main);">Enter Password to Decrypt</h3>
<p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:8px;">This backup is encrypted with your account credentials.</p>
<p style="font-size:0.72rem;color:var(--accent);margin-bottom:16px;">Account: <strong>${esc(currentUser.email)}</strong></p>
<input type="password" id="dec-pwd-input" placeholder="Your account password" autocomplete="current-password"
style="width:100%;padding:12px;background:var(--input-bg);border:1px solid var(--glass-border);border-radius:10px;box-sizing:border-box;color:var(--text-main);font-size:0.9rem;margin-bottom:14px;">
<div id="dec-pwd-error" style="font-size:0.75rem;color:var(--danger);min-height:18px;margin-bottom:10px;"></div>
<div style="display:flex;gap:10px;">
<button id="dec-pwd-ok" style="flex:1;padding:11px;background:var(--accent);border:none;border-radius:10px;color:#003d2e;font-weight:700;cursor:pointer;">Decrypt & Restore</button>
<button id="dec-pwd-cancel" style="flex:1;padding:11px;background:var(--input-bg);border:1px solid var(--glass-border);border-radius:10px;color:var(--text-main);cursor:pointer;">Cancel</button>
</div>
</div>`;
document.body.appendChild(modal);
document.getElementById('dec-pwd-ok').onclick = () => {
const val = document.getElementById('dec-pwd-input').value;
document.body.removeChild(modal);
resolve(val || null);
};
document.getElementById('dec-pwd-cancel').onclick = () => {
document.body.removeChild(modal);
resolve(null);
};
setTimeout(() => { const inp = document.getElementById('dec-pwd-input'); if(inp) inp.focus(); }, 100);
});
}
if (!decPassword) { showToast('Restore cancelled.', 'info'); return; }
try {
const arrayBuffer = await _readFileAsArrayBuffer(file);
let data;
try {
data = await CryptoEngine.decrypt(arrayBuffer, currentUser.email, decPassword);
} catch(decErr) {
if (decErr.message === 'WRONG_CREDENTIALS') {
showToast('Wrong password or wrong account. Decryption failed.', 'error', 6000);
} else if (decErr.message === 'INVALID_FORMAT') {
showToast('This file is not a valid encrypted backup.', 'error', 5000);
} else {
showToast('Decryption failed: ' + decErr.message, 'error');
}
return;
}
showToast('Decryption successful! Restoring data...', 'success', 3000);
if (data && data._meta && data._meta.isYearCloseBackup) {
const snap = data._meta.fyCloseSnapshot || {};
const closedDate = snap.lastYearClosedDate ? new Date(snap.lastYearClosedDate).toLocaleDateString() : 'unknown date';
const _ycEstItems = [
  ...(data.mfg || data.mfg_pro_pkr || []), ...(data.sales || data.noman_history || []),
  ...(data.customerSales || []), ...(data.repSales || []),
  ...(data.repCustomers || []), ...(data.salesCustomers || []),
  ...(data.factoryInventoryData || []), ...(data.factoryProductionHistory || []),
  ...(data.stockReturns || []), ...(data.paymentTransactions || []),
  ...(data.paymentEntities || []), ...(data.expenses || [])
];
const _ycEstReads  = _ycEstItems.length + 24;
const _ycEstWrites = _ycEstItems.length * 2;
const _ycCostNote  = (typeof buildFirestoreCostEstimate === 'function')
  ? '\n\n' + buildFirestoreCostEstimate(_ycEstReads, _ycEstWrites) : '';
const _ycRestoreMsg = `This backup was created by Close Financial Year on ${closedDate}.\n\nRestoring it will:\n \u2022 REPLACE all current data with the pre-close snapshot\n \u2022 Remove all merged opening-balance records\n \u2022 Reverse the financial year close counter\n \u2022 Upload the reversed data to cloud\n\n\u26a0\ufe0f This is a full reversal — your current year's data will be overwritten.\n\nOnly proceed if you want to completely undo the financial year close.` + _ycCostNote;
if (!(await showGlassConfirm(_ycRestoreMsg, { title: '\u21a9 Reverse Financial Year Close', confirmText: 'Reverse Year Close', cancelText: 'Cancel' }))) {
showToast('Year-close reversal cancelled.', 'info');
return;
}
const _allBackupItems = [
  ...(data.mfg || data.mfg_pro_pkr || []),
  ...(data.sales || data.noman_history || []),
  ...(data.customerSales || []),
  ...(data.repSales || []),
  ...(data.repCustomers || []),
  ...(data.salesCustomers || []),
  ...(data.factoryInventoryData || []),
  ...(data.factoryProductionHistory || []),
  ...(data.stockReturns || []),
  ...(data.paymentTransactions || []),
  ...(data.paymentEntities || []),
  ...(data.expenses || [])
];
const _postCloseDeletions = _allBackupItems.filter(
  item => item && item.id && deletedRecordIds.has(item.id)
);
let _honourDeletions = true;
if (_postCloseDeletions.length > 0) {
  const _delMsg = `${_postCloseDeletions.length} record${_postCloseDeletions.length !== 1 ? 's' : ''} in this backup `
    + `${_postCloseDeletions.length !== 1 ? 'were' : 'was'} deleted after the year-close backup was taken.\n\n`
    + `\u2022 Keep deletions \u2014 those records stay deleted (recommended if the deletions were intentional)\n`
    + `\u2022 Restore everything \u2014 all ${_postCloseDeletions.length} deleted record${_postCloseDeletions.length !== 1 ? 's' : ''} `
    + `will be brought back as part of the full reversal\n\n`
    + `Which behaviour do you want?`;
  _honourDeletions = await showGlassConfirm(_delMsg, {
    title: '\u26a0\ufe0f Post-Close Deletions Detected',
    confirmText: 'Keep Deletions',
    cancelText: 'Restore Everything'
  });
}
await _doYearCloseRestore(data, _honourDeletions);
} else {
await _doRestoreMerge(data);
}
} catch(err) {
showToast('Restore error: ' + err.message, 'error');
}
} else {
try {
const text = await _readFileAsText(file);
const data = JSON.parse(text);
if (data.repCustomers || data.salesCustomers || data.customerSales || data.repSales || data.mfg_pro_pkr || data.mfg) {
const _rfbMsg = `Restore data from this backup file?\n\nHow it works:\n \u2022 Records are merged, not overwritten \u2014 your current data stays\n \u2022 Duplicates are automatically removed\n \u2022 Only new (non-duplicate) records are uploaded to cloud\n \u2022 Other devices are not affected until their next sync\n\nIf the backup contains older versions of records you have edited since, the newer version is always kept.`;
if (await showGlassConfirm(_rfbMsg, { title: "Restore From Backup File", confirmText: "Restore & Merge", cancelText: "Cancel" })) {
await _doRestoreMerge(data);
}
} else {
showToast("Invalid backup file structure", 'error');
}
} catch (err) {
showToast("Error reading file: " + err.message, 'error');
}
}
}

function normaliseBackupFields(data) {
  if (!data || typeof data !== 'object') return data;
  if (data.mfg && !data.mfg_pro_pkr)    data.mfg_pro_pkr   = data.mfg;
  if (data.mfg_pro_pkr && !data.mfg)    data.mfg           = data.mfg_pro_pkr;
  if (data.sales && !data.noman_history) data.noman_history = data.sales;
  if (data.noman_history && !data.sales) data.sales         = data.noman_history;
  const _migrateRecord = (record) => {
    if (!record || typeof record !== 'object') return record;
    return record;
  };
  const _migrateArray = (arr) => Array.isArray(arr) ? arr.map(_migrateRecord) : arr;
  data.customerSales  = _migrateArray(data.customerSales);
  data.repSales       = _migrateArray(data.repSales);
  data.salesCustomers = _migrateArray(data.salesCustomers);
  data.repCustomers   = _migrateArray(data.repCustomers);
  return data;
}
async function _doRestoreMerge(data) {
showToast('Analyzing backup file...', 'info', 5000);
data = normaliseBackupFields(data);
const getTimestampValue = (record) => {
if (!record) return 0;
let ts = record.updatedAt || record.timestamp || record.createdAt || 0;
if (typeof ts === 'number') return ts;
if (ts && typeof ts.toMillis === 'function') return ts.toMillis();
if (ts && typeof ts === 'object') {
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  if (typeof ts._seconds === 'number') return ts._seconds * 1000;
}
if (ts instanceof Date) return ts.getTime();
if (typeof ts === 'string') {
  try {
    const time = new Date(ts.replace('Z', '+00:00')).getTime();
    if (!isNaN(time)) return time;
  } catch (e) {}
}
return 0;
};
const deduplicateByUUID = (array, collectionName) => {
if (!Array.isArray(array) || array.length === 0) return array;
const seen = new Map();
let duplicatesFound = 0;
array.forEach(item => {
  if (!item || !item.id) return;
  if (!validateUUID(item.id)) item.id = generateUUID('repair');
  if (seen.has(item.id)) {
    duplicatesFound++;
    const _cmpDup = (typeof compareRecordVersions === 'function')
      ? compareRecordVersions(item, seen.get(item.id))
      : getTimestampValue(item) - getTimestampValue(seen.get(item.id));
    if (_cmpDup > 0) seen.set(item.id, item);
  } else {
    seen.set(item.id, item);
  }
});
if (duplicatesFound > 0) showToast(`Cleaned ${collectionName}: removed ${duplicatesFound} duplicates`, 'info');
return Array.from(seen.values());
};
if (data.mfg_pro_pkr)             data.mfg_pro_pkr             = deduplicateByUUID(data.mfg_pro_pkr,             'Production');
if (data.noman_history)           data.noman_history           = deduplicateByUUID(data.noman_history,           'Calculator History');
if (data.customerSales)           data.customerSales           = deduplicateByUUID(data.customerSales,           'Customer Sales');
if (data.repSales)                data.repSales                = deduplicateByUUID(data.repSales,                'Rep Sales');
if (data.repCustomers)            data.repCustomers            = deduplicateByUUID(data.repCustomers,            'Rep Customers');
if (data.salesCustomers)          data.salesCustomers          = deduplicateByUUID(data.salesCustomers,          'Sales Customers');
if (data.factoryInventoryData)    data.factoryInventoryData    = deduplicateByUUID(data.factoryInventoryData,    'Factory Inventory');
if (data.factoryProductionHistory)data.factoryProductionHistory= deduplicateByUUID(data.factoryProductionHistory,'Factory History');
if (data.stockReturns)            data.stockReturns            = deduplicateByUUID(data.stockReturns,            'Stock Returns');
if (data.paymentTransactions)     data.paymentTransactions     = deduplicateByUUID(data.paymentTransactions,     'Payment Transactions');
if (data.paymentEntities)         data.paymentEntities         = deduplicateByUUID(data.paymentEntities,         'Payment Entities');
if (data.expenses)                data.expenses                = deduplicateByUUID(data.expenses,                'Expenses');
data.mfg   = data.mfg_pro_pkr;
data.sales = data.noman_history;
showToast(' Backup cleaned! Restoring with smart merge...', 'success');
if (data.deleted_records && Array.isArray(data.deleted_records)) {
data.deleted_records.forEach(id => deletedRecordIds.add(id));
await idb.set('deleted_records', Array.from(deletedRecordIds));
}
const isAlive = (item) => item && item.id && !deletedRecordIds.has(item.id);
const currentLocalData = {
mfg_pro_pkr:                await idb.get('mfg_pro_pkr') || [],
noman_history:              await idb.get('noman_history') || [],
customer_sales:             await idb.get('customer_sales') || [],
rep_sales:                  await idb.get('rep_sales') || [],
rep_customers:              await idb.get('rep_customers') || [],
sales_customers:            await idb.get('sales_customers') || [],
factory_inventory_data:     await idb.get('factory_inventory_data') || [],
factory_production_history: await idb.get('factory_production_history') || [],
stock_returns:              await idb.get('stock_returns') || [],
payment_transactions:       await idb.get('payment_transactions') || [],
payment_entities:           await idb.get('payment_entities') || [],
expenses:                   await idb.get('expenses') || []
};
const _localUUIDSets = {};
for (const [key, arr] of Object.entries(currentLocalData)) {
_localUUIDSets[key] = new Set(arr.filter(i => i && i.id).map(i => String(i.id)));
}
const _repNameSet = new Set((Array.isArray(salesRepsList) ? salesRepsList : []).map(r => r.toLowerCase()));
const _isNotRepName = (c) => !c || !c.name || !_repNameSet.has(c.name.toLowerCase());
const cleanBackupData = {
mfg_pro_pkr:                ensureArray(data.mfg || data.mfg_pro_pkr).filter(isAlive),
noman_history:              ensureArray(data.sales || data.noman_history).filter(isAlive),
customer_sales:             ensureArray(data.customerSales).filter(isAlive),
rep_sales:                  ensureArray(data.repSales).filter(isAlive),
rep_customers:              mergeDatasets(ensureArray(data.repCustomers).filter(isAlive), ensureArray(currentLocalData.rep_customers || []).filter(isAlive)),
sales_customers:            mergeDatasets(ensureArray(data.salesCustomers).filter(isAlive).filter(_isNotRepName), ensureArray(currentLocalData.sales_customers || []).filter(isAlive).filter(_isNotRepName)),
factory_inventory_data:     ensureArray(data.factoryInventoryData).filter(isAlive),
factory_production_history: ensureArray(data.factoryProductionHistory).filter(isAlive),
stock_returns:              ensureArray(data.stockReturns).filter(isAlive),
payment_transactions:       ensureArray(data.paymentTransactions).filter(isAlive),
payment_entities:           ensureArray(data.paymentEntities).filter(isAlive),
expenses:                   mergeDatasets(ensureArray(data.expenses).filter(isAlive), ensureArray(currentLocalData.expenses || []).filter(isAlive))
};
let totalAdded = 0;
let totalUpdated = 0;
let totalSkipped = 0;
const mergedData = {};
const _idbToFirestore = {
mfg_pro_pkr: 'production', noman_history: 'calculator_history',
customer_sales: 'sales', rep_sales: 'rep_sales',
rep_customers: 'rep_customers', sales_customers: 'sales_customers',
factory_inventory_data: 'inventory', factory_production_history: 'factory_history',
stock_returns: 'returns', payment_transactions: 'transactions',
payment_entities: 'entities', expenses: 'expenses'
};
for (const [key, backupArray] of Object.entries(cleanBackupData)) {
const localArray = currentLocalData[key] || [];
const localIds = _localUUIDSets[key];
const firestoreCollection = _idbToFirestore[key];
const merged = mergeArrays(localArray, backupArray);
backupArray.forEach(backupItem => {
  if (!backupItem || !backupItem.id) return;
  const sid = String(backupItem.id);
  if (!localIds.has(sid)) {
    totalAdded++;
    if (firestoreCollection) DeltaSync.trackId(firestoreCollection, sid);
  } else {
    const localItem = localArray.find(item => item.id === backupItem.id);
    const _cmpRestore = (typeof compareRecordVersions === 'function')
      ? compareRecordVersions(backupItem, localItem)
      : getTimestampValue(backupItem) - getTimestampValue(localItem);
    if (_cmpRestore > 0) {
      totalUpdated++;
      if (firestoreCollection) DeltaSync.trackId(firestoreCollection, sid);
    } else {
      totalSkipped++;
      if (firestoreCollection) {
        DeltaSync.markUploaded(firestoreCollection, sid);
        DeltaSync.markDownloaded(firestoreCollection, sid);
      }
    }
  }
});
localArray.forEach(item => {
  if (!item || !item.id) return;
  const sid = String(item.id);
  if (!backupArray.some(b => b && String(b.id) === sid) && firestoreCollection) {
    DeltaSync.markUploaded(firestoreCollection, sid);
    DeltaSync.markDownloaded(firestoreCollection, sid);
  }
});

mergedData[key] = merged.map(item => {
  if (!item) return item;
  if (!item.id || !validateUUID(String(item.id))) return ensureRecordIntegrity(item, false, true);
  return item;
});
}
await Promise.all([
idb.set('mfg_pro_pkr',                mergedData.mfg_pro_pkr),
idb.set('noman_history',              mergedData.noman_history),
idb.set('customer_sales',             mergedData.customer_sales),
idb.set('rep_sales',                  mergedData.rep_sales),
idb.set('rep_customers',              mergedData.rep_customers),
idb.set('sales_customers',            mergedData.sales_customers),
idb.set('factory_inventory_data',     mergedData.factory_inventory_data),
idb.set('factory_production_history', mergedData.factory_production_history),
idb.set('stock_returns',              mergedData.stock_returns),
idb.set('payment_transactions',       mergedData.payment_transactions),
idb.set('payment_entities',           mergedData.payment_entities),
idb.set('expenses',                   mergedData.expenses)
]);
const currentSettings = {
factoryDefaultFormulas:       await idb.get('factory_default_formulas'),
factoryAdditionalCosts:       await idb.get('factory_additional_costs'),
factoryCostAdjustmentFactor:  await idb.get('factory_cost_adjustment_factor'),
factorySalePrices:            await idb.get('factory_sale_prices'),
factoryUnitTracking:          await idb.get('factory_unit_tracking'),
naswarDefaultSettings:        await idb.get('naswar_default_settings')
};
const settingsTimestamp = Date.now();
const _stripFsMeta = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  const { id: _id, createdAt: _ca, updatedAt: _ua, timestamp: _ts, syncedAt: _sa, ...clean } = obj;
  return clean;
};
const _cleanFormulas = data.factoryDefaultFormulas ? _stripFsMeta(data.factoryDefaultFormulas) : null;
const _cleanCosts    = data.factoryAdditionalCosts ? _stripFsMeta(data.factoryAdditionalCosts) : null;
const _cleanFactor   = data.factoryCostAdjustmentFactor ? _stripFsMeta(data.factoryCostAdjustmentFactor) : null;
const _cleanPrices   = data.factorySalePrices ? _stripFsMeta(data.factorySalePrices) : null;
const _cleanTracking = data.factoryUnitTracking ? _stripFsMeta(data.factoryUnitTracking) : null;
if (_cleanFormulas && ('standard' in _cleanFormulas) && ('asaan' in _cleanFormulas) &&
    JSON.stringify(_cleanFormulas) !== JSON.stringify(currentSettings.factoryDefaultFormulas)) {
await idb.set('factory_default_formulas', _cleanFormulas);
await idb.set('factory_default_formulas_timestamp', settingsTimestamp);
factoryDefaultFormulas = _cleanFormulas;
}
if (_cleanCosts && ('standard' in _cleanCosts) && ('asaan' in _cleanCosts) &&
    JSON.stringify(_cleanCosts) !== JSON.stringify(currentSettings.factoryAdditionalCosts)) {
await idb.set('factory_additional_costs', _cleanCosts);
await idb.set('factory_additional_costs_timestamp', settingsTimestamp);
factoryAdditionalCosts = _cleanCosts;
}
if (_cleanFactor && ('standard' in _cleanFactor) && ('asaan' in _cleanFactor) &&
    JSON.stringify(_cleanFactor) !== JSON.stringify(currentSettings.factoryCostAdjustmentFactor)) {
await idb.set('factory_cost_adjustment_factor', _cleanFactor);
await idb.set('factory_cost_adjustment_factor_timestamp', settingsTimestamp);
factoryCostAdjustmentFactor = _cleanFactor;
}
if (_cleanPrices && ('standard' in _cleanPrices) && ('asaan' in _cleanPrices) &&
    JSON.stringify(_cleanPrices) !== JSON.stringify(currentSettings.factorySalePrices)) {
await idb.set('factory_sale_prices', _cleanPrices);
await idb.set('factory_sale_prices_timestamp', settingsTimestamp);
factorySalePrices = _cleanPrices;
}
if (_cleanTracking && ('standard' in _cleanTracking) && ('asaan' in _cleanTracking) &&
    JSON.stringify(_cleanTracking) !== JSON.stringify(currentSettings.factoryUnitTracking)) {
await idb.set('factory_unit_tracking', _cleanTracking);
await idb.set('factory_unit_tracking_timestamp', settingsTimestamp);
factoryUnitTracking = _cleanTracking;
}
if (data.settings && JSON.stringify(data.settings) !== JSON.stringify(currentSettings.naswarDefaultSettings)) {
await idb.set('naswar_default_settings', data.settings);
await idb.set('naswar_default_settings_timestamp', settingsTimestamp);
defaultSettings = data.settings;
}
await loadAllData();
try { syncFactoryProductionStats(); } catch(e) { console.error('Factory stats error:', _safeErr(e)); }
try { await invalidateAllCaches(); } catch(e) { console.error('Cache invalidation error:', _safeErr(e)); }
try { await refreshAllDisplays(); } catch(e) { console.error('Display refresh error:', _safeErr(e)); }
let cloudSyncSuccess = false;
if (firebaseDB && currentUser) {
try {
  const userRef = firebaseDB.collection('users').doc(currentUser.uid);
  const collectionMapping = {
    'production':         { data: ensureArray(mergedData.mfg_pro_pkr),                deltaName: 'production' },
    'sales':              { data: ensureArray(mergedData.customer_sales), deltaName: 'sales' },
    'calculator_history': { data: ensureArray(mergedData.noman_history),              deltaName: 'calculator_history' },
    'rep_sales':          { data: ensureArray(mergedData.rep_sales),                  deltaName: 'rep_sales' },
    'rep_customers':      { data: ensureArray(mergedData.rep_customers),              deltaName: 'rep_customers' },
    'sales_customers':    { data: ensureArray(mergedData.sales_customers),            deltaName: 'sales_customers' },
    'inventory':          { data: ensureArray(mergedData.factory_inventory_data),     deltaName: 'inventory' },
    'factory_history':    { data: ensureArray(mergedData.factory_production_history), deltaName: 'factory_history' },
    'returns':            { data: ensureArray(mergedData.stock_returns),              deltaName: 'returns' },
    'transactions':       { data: ensureArray(mergedData.payment_transactions),       deltaName: 'transactions' },
    'entities':           { data: ensureArray(mergedData.payment_entities),           deltaName: 'entities' },
    'expenses':           { data: ensureArray(mergedData.expenses),                   deltaName: 'expenses' }
  };
  const itemsToUpload = {};
  let totalToUpload = 0;
  for (const [cloudName, config] of Object.entries(collectionMapping)) {
    const newItems = await DeltaSync.getChangedItems(config.deltaName, config.data);
    itemsToUpload[cloudName] = newItems.filter(item => item && item.id);
    totalToUpload += itemsToUpload[cloudName].length;
  }
  const batch = firebaseDB.batch();
  let operationCount = 0;
  const batches = [batch];
  const getCurrentBatch = () => {
    if (operationCount >= 495) { batches.push(firebaseDB.batch()); operationCount = 0; }
    return batches[batches.length - 1];
  };
  if (totalToUpload === 0) {
    showToast(' No new records to upload — all UUIDs already in cloud.', 'info');
  } else {
    showToast(`Uploading ${totalToUpload} new/updated records to cloud...`, 'info');
    for (const [cloudCollectionName, records] of Object.entries(itemsToUpload)) {
      for (const record of records) {
        if (!record || !record.id) continue;
        const deltaName = collectionMapping[cloudCollectionName]?.deltaName;
        if (deltaName && DeltaSync.wasUploaded(deltaName, record.id)) continue;
        try {
          const docId = String(record.id);
          const sanitizedRecord = sanitizeForFirestore(record);
          if (!sanitizedRecord || typeof sanitizedRecord !== 'object') continue;
          sanitizedRecord.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
          const currentBatch = getCurrentBatch();
          currentBatch.set(userRef.collection(cloudCollectionName).doc(docId), sanitizedRecord, { merge: true });
          operationCount++;
          trackFirestoreWrite(1);
          if (deltaName) DeltaSync.markUploaded(deltaName, record.id);
        } catch (error) { console.error('Cloud save op failed', _safeErr(error)); }
      }
    }
  }
  try {
    const currentBatch = getCurrentBatch();
    const ensureFactorySettings = (obj, defaultVal) => {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return defaultVal;
      if (!('standard' in obj) || !('asaan' in obj)) return defaultVal;
      return { standard: obj.standard, asaan: obj.asaan };
    };
    const currentTimestamp = new Date().toISOString();
    const factorySettingsPayload = {
      default_formulas:                ensureFactorySettings(await idb.get('factory_default_formulas'), { standard: [], asaan: [] }),
      default_formulas_timestamp:      await idb.get('factory_default_formulas_timestamp') || currentTimestamp,
      additional_costs:                ensureFactorySettings(await idb.get('factory_additional_costs'), { standard: 0, asaan: 0 }),
      additional_costs_timestamp:      await idb.get('factory_additional_costs_timestamp') || currentTimestamp,
      cost_adjustment_factor:          ensureFactorySettings(await idb.get('factory_cost_adjustment_factor'), { standard: 1, asaan: 1 }),
      cost_adjustment_factor_timestamp:await idb.get('factory_cost_adjustment_factor_timestamp') || currentTimestamp,
      sale_prices:                     ensureFactorySettings(await idb.get('factory_sale_prices'), { standard: 0, asaan: 0 }),
      sale_prices_timestamp:           await idb.get('factory_sale_prices_timestamp') || currentTimestamp,
      unit_tracking:                   ensureFactorySettings(await idb.get('factory_unit_tracking'), { standard: { produced:0,consumed:0,available:0,unitCostHistory:[] }, asaan: { produced:0,consumed:0,available:0,unitCostHistory:[] } }),
      unit_tracking_timestamp:         await idb.get('factory_unit_tracking_timestamp') || currentTimestamp,
      last_synced:                     new Date().toISOString()
    };
    currentBatch.set(
      userRef.collection('factorySettings').doc('config'),
      sanitizeForFirestore(factorySettingsPayload),
      { merge: true }
    );
    operationCount++;
  } catch (factorySettingsError) { console.error('Factory settings cloud error', _safeErr(factorySettingsError)); }
  if (operationCount > 0) {
    for (let _bi = 0; _bi < batches.length; _bi++) {
      await batches[_bi].commit();
      if (batches.length > 1) showToast('Uploading to cloud... ' + (_bi + 1) + ' / ' + batches.length + ' batches', 'info');
      await new Promise(r => setTimeout(r, 0));
    }
    for (const [cloudName, config] of Object.entries(collectionMapping)) {
      if (itemsToUpload[cloudName] && itemsToUpload[cloudName].length > 0) {
        await DeltaSync.setLastSyncTimestamp(config.deltaName);
        DeltaSync.clearDirty(config.deltaName);
      }
    }
    const _allDeltaNames = Object.values(collectionMapping).map(c => c.deltaName);
    for (const _dn of _allDeltaNames) {
      await DeltaSync.setLastSyncTimestamp(_dn);
    }
    await idb.set('firestore_initialized', true);
    cloudSyncSuccess = true;
    const message = totalToUpload > 0
      ? ` Successfully restored & uploaded ${totalToUpload} new/updated records + factory settings to cloud!`
      : ' Factory settings uploaded to cloud!';
    showToast(message, 'success');
  } else {
    showToast(' No changes to upload.', 'info');
    cloudSyncSuccess = true;
  }
} catch (syncError) {
  showToast('Data restored locally, but cloud sync failed. Please sync manually.', 'warning');
}
} else {
showToast('Not logged in to cloud. Data restored locally only.', 'warning');
}
const statsMessage = `Added: ${totalAdded}, Updated: ${totalUpdated}, Skipped: ${totalSkipped}`;
const syncMessage = cloudSyncSuccess ? ' and new/updated records uploaded to cloud' : '';
showToast(`Restore complete${syncMessage}! ${statsMessage}`, 'success', 5000);
}
async function _doYearCloseRestore(data, honourPostCloseDeletions = true) {
  data = normaliseBackupFields(data);
  showToast('↩ Reversing financial year close — replacing data...', 'info', 5000);
  const isAlive = honourPostCloseDeletions
    ? (item) => item && item.id && !deletedRecordIds.has(item.id)
    : (item) => item && item.id;
  const _ycRepNameSet = new Set((Array.isArray(salesRepsList) ? salesRepsList : []).map(r => r.toLowerCase()));
const _ycNotRepName = (c) => !c || !c.name || !_ycRepNameSet.has(c.name.toLowerCase());
const replaceData = {
    mfg_pro_pkr:                ensureArray(data.mfg || data.mfg_pro_pkr).filter(isAlive),
    noman_history:              ensureArray(data.sales || data.noman_history).filter(isAlive),
    customer_sales:             ensureArray(data.customerSales).filter(isAlive),
    rep_sales:                  ensureArray(data.repSales).filter(isAlive),
    rep_customers:              mergeDatasets(ensureArray(data.repCustomers).filter(isAlive), ensureArray(repCustomers || []).filter(isAlive)),
    sales_customers:            mergeDatasets(ensureArray(data.salesCustomers).filter(isAlive).filter(_ycNotRepName), ensureArray(salesCustomers || []).filter(isAlive).filter(_ycNotRepName)),
    factory_inventory_data:     ensureArray(data.factoryInventoryData).filter(isAlive),
    factory_production_history: ensureArray(data.factoryProductionHistory).filter(isAlive),
    stock_returns:              ensureArray(data.stockReturns).filter(isAlive),
    payment_transactions:       ensureArray(data.paymentTransactions).filter(isAlive),
    payment_entities:           ensureArray(data.paymentEntities).filter(isAlive),
    expenses:                   mergeDatasets(ensureArray(data.expenses).filter(isAlive), ensureArray(expenseRecords || []).filter(isAlive))
  };
  await Promise.all([
    idb.set('mfg_pro_pkr',                replaceData.mfg_pro_pkr),
    idb.set('noman_history',              replaceData.noman_history),
    idb.set('customer_sales',             replaceData.customer_sales),
    idb.set('rep_sales',                  replaceData.rep_sales),
    idb.set('rep_customers',              replaceData.rep_customers),
    idb.set('sales_customers',            replaceData.sales_customers),
    idb.set('factory_inventory_data',     replaceData.factory_inventory_data),
    idb.set('factory_production_history', replaceData.factory_production_history),
    idb.set('stock_returns',              replaceData.stock_returns),
    idb.set('payment_transactions',       replaceData.payment_transactions),
    idb.set('payment_entities',           replaceData.payment_entities),
    idb.set('expenses',                   replaceData.expenses)
  ]);
  const settingsTimestamp = Date.now();
  if (data.factoryDefaultFormulas) { await idb.set('factory_default_formulas', data.factoryDefaultFormulas); await idb.set('factory_default_formulas_timestamp', settingsTimestamp); factoryDefaultFormulas = data.factoryDefaultFormulas; }
  if (data.factoryAdditionalCosts) { await idb.set('factory_additional_costs', data.factoryAdditionalCosts); await idb.set('factory_additional_costs_timestamp', settingsTimestamp); factoryAdditionalCosts = data.factoryAdditionalCosts; }
  if (data.factoryCostAdjustmentFactor) { await idb.set('factory_cost_adjustment_factor', data.factoryCostAdjustmentFactor); await idb.set('factory_cost_adjustment_factor_timestamp', settingsTimestamp); factoryCostAdjustmentFactor = data.factoryCostAdjustmentFactor; }
  if (data.factorySalePrices) { await idb.set('factory_sale_prices', data.factorySalePrices); await idb.set('factory_sale_prices_timestamp', settingsTimestamp); factorySalePrices = data.factorySalePrices; }
  if (data.factoryUnitTracking) { await idb.set('factory_unit_tracking', data.factoryUnitTracking); await idb.set('factory_unit_tracking_timestamp', settingsTimestamp); factoryUnitTracking = data.factoryUnitTracking; }
  try {
    const currentSettings = await idb.get('naswar_default_settings', {});
    const snap = (data._meta && data._meta.fyCloseSnapshot) || {};
    currentSettings.fyCloseCount       = snap.fyCloseCount       ?? Math.max(0, (currentSettings.fyCloseCount || 1) - 1);
    currentSettings.lastYearClosedAt   = snap.lastYearClosedAt   ?? null;
    currentSettings.lastYearClosedDate = snap.lastYearClosedDate ?? null;
    currentSettings.pendingFirestoreYearClose = false;
    pendingFirestoreYearClose = false;
    await idb.set('naswar_default_settings', currentSettings);
    await idb.set('pendingFirestoreYearClose', false);
    defaultSettings = currentSettings;
    if (firebaseDB && currentUser) {
      try {
        await firebaseDB.collection('users').doc(currentUser.uid)
          .collection('settings').doc('config')
          .set({ naswar_default_settings: { fyCloseCount: currentSettings.fyCloseCount, lastYearClosedAt: currentSettings.lastYearClosedAt, lastYearClosedDate: currentSettings.lastYearClosedDate } }, { merge: true });
      } catch(e) { console.warn('Cloud FY meta reversal failed:', e); }
    }
  } catch(metaErr) { console.warn('Could not reverse FY metadata:', metaErr); }
  if (firebaseDB && currentUser) {
    try {
      showToast('Uploading reversed data to cloud...', 'info');
      const userRef = firebaseDB.collection('users').doc(currentUser.uid);
      const cloudCollections = {
        production: replaceData.mfg_pro_pkr, sales: replaceData.customer_sales,
        calculator_history: replaceData.noman_history, rep_sales: replaceData.rep_sales,
        rep_customers: replaceData.rep_customers, sales_customers: replaceData.sales_customers,
        inventory: replaceData.factory_inventory_data, factory_history: replaceData.factory_production_history,
        returns: replaceData.stock_returns, transactions: replaceData.payment_transactions,
        entities: replaceData.payment_entities, expenses: replaceData.expenses
      };
      for (const [colName, records] of Object.entries(cloudCollections)) {
        try {
          const colRef = userRef.collection(colName);
          const healSnap = await colRef.where('_pendingDelete', '==', true).get();
          if (!healSnap.empty) {
            const healBatches = [firebaseDB.batch()]; let healOps = 0;
            healSnap.docs.forEach(doc => {
              if (healOps >= 495) { healBatches.push(firebaseDB.batch()); healOps = 0; }
              healBatches[healBatches.length-1].delete(doc.ref);
              healOps++;
            });
            await Promise.all(healBatches.map(b => b.commit()));
          }
          const incomingIds = new Set(
            records.filter(r => r && r.id).map(r => String(r.id))
          );
          const preSnap = await colRef.get();
          const staleDocs = preSnap.docs.filter(doc => !incomingIds.has(doc.id) && doc.id !== '_placeholder_' && !doc.data()._placeholder);
          if (staleDocs.length > 0) {
            const markBatches = [firebaseDB.batch()]; let markOps = 0;
            staleDocs.forEach(doc => {
              if (markOps >= 495) { markBatches.push(firebaseDB.batch()); markOps = 0; }
              markBatches[markBatches.length-1].update(doc.ref, { _pendingDelete: true });
              markOps++;
            });
            await Promise.all(markBatches.map(b => b.commit()));
          }
          const wrBatches = [firebaseDB.batch()]; let wrOps = 0;
          for (const record of records) {
            if (!record || !record.id) continue;
            const sanitized = sanitizeForFirestore(record);
            if (!sanitized) continue;
            if (wrOps >= 495) { wrBatches.push(firebaseDB.batch()); wrOps = 0; }
            wrBatches[wrBatches.length-1].set(colRef.doc(String(record.id)), sanitized, { merge: false });
            wrOps++; trackFirestoreWrite(1);
          }
          if (wrOps > 0) await Promise.all(wrBatches.map(b => b.commit()));
          const _fsColName = colName;
          records.forEach(record => {
            if (!record || !record.id) return;
            DeltaSync.markUploaded(_fsColName, record.id);
            DeltaSync.markDownloaded(_fsColName, record.id);
          });
          if (staleDocs.length > 0) {
            const delBatches = [firebaseDB.batch()]; let delOps = 0;
            staleDocs.forEach(doc => {
              if (delOps >= 495) { delBatches.push(firebaseDB.batch()); delOps = 0; }
              delBatches[delBatches.length-1].delete(doc.ref);
              delOps++;
            });
            await Promise.all(delBatches.map(b => b.commit()));
          }
          await DeltaSync.setLastSyncTimestamp(colName);
        } catch(colErr) { console.warn(`Cloud replace warning for ${colName}:`, colErr); }
      }
      showToast('☁️ Cloud data replaced with pre-close snapshot', 'success', 3000);
    } catch(cloudErr) {
      console.warn('Cloud replace failed:', cloudErr);
      showToast('Local data reversed. Cloud sync failed — sync manually.', 'warning', 5000);
    }
  }
  await loadAllData();
  try { syncFactoryProductionStats(); } catch(e) {}
  try { await invalidateAllCaches(); } catch(e) {}
  try { await refreshAllDisplays(); } catch(e) {}
  const totalRecords = Object.values(replaceData).reduce((s, a) => s + a.length, 0);
  showToast(`✅ Financial year close reversed! ${totalRecords} pre-close records restored.`, 'success', 6000);
}
async function showTab(tab) {
currentActiveTab = tab;
requestAnimationFrame(() => {
const tabs = ['tab-prod', 'tab-sales', 'tab-calc', 'tab-factory', 'tab-payments', 'tab-rep'];
tabs.forEach(id => {
const el = document.getElementById(id);
if (el) el.classList.add('hidden');
});
const selectedTab = document.getElementById('tab-' + tab);
if (selectedTab) {
selectedTab.classList.remove('hidden');
void selectedTab.offsetHeight;
}
const tabButtons = document.querySelectorAll('.tab-btn');
tabButtons.forEach((btn) => {
const onclickVal = btn.getAttribute('onclick') || '';
btn.classList.toggle('active', onclickVal.includes("'" + tab + "'") || onclickVal.includes('"' + tab + '"'));
});
});
window.scrollTo({ top: 0, behavior: 'instant' });
const paymentSummarySection = document.getElementById('payment-summary-section');
const paymentHistorySection = document.getElementById('payment-history-section');
if (paymentSummarySection) {
paymentSummarySection.style.display = tab === 'payments' ? '' : 'none';
paymentSummarySection.style.visibility = tab === 'payments' ? 'visible' : 'hidden';
}
if (paymentHistorySection) {
paymentHistorySection.style.display = tab === 'payments' ? '' : 'none';
paymentHistorySection.style.visibility = tab === 'payments' ? 'visible' : 'hidden';
}
setTimeout(async () => {
await loadChartJs();
const tabLoaders = {
'sales': async () => {
await syncSalesTab();
},
'calc': async () => {
await syncCalculatorTab();
},
'prod': async () => {
await syncProductionTab();
await refreshUI();
},
'factory': async () => {
await syncFactoryTab();
initFactoryTab();
},
'payments': async () => {
await syncPaymentsTab();
await refreshPaymentTab();
},
'rep': async () => {
await syncRepTab();
handleRepTabUI();
}
};
if (tabLoaders[tab]) {
await tabLoaders[tab]();
}
notifyDataChange(tab);
}, 50);
}
function handleRepTabUI() {
const repHeader = document.getElementById('rep-header');
const adminControls = document.getElementById('admin-rep-controls');
const adminAnalytics = document.getElementById('admin-rep-analytics');
const newTransCard = document.getElementById('rep-new-transaction-card');
if (appMode === 'admin') {
if (adminControls) {
adminControls.classList.remove('hidden');
adminControls.style.display = 'block';
}
if (adminAnalytics) {
adminAnalytics.classList.remove('hidden');
adminAnalytics.style.display = 'block';
}
const manageRepsBtnAdmin = document.getElementById('btn-manage-reps');
if (manageRepsBtnAdmin) manageRepsBtnAdmin.style.display = '';
const mainDate = document.getElementById('rep-date');
const adminDate = document.getElementById('admin-rep-date');
if (mainDate && adminDate) {
adminDate.value = mainDate.value;
}
if (repHeader) repHeader.style.display = 'none';
if (newTransCard) newTransCard.style.display = 'none';
if (typeof calculateRepAnalytics === 'function') {
calculateRepAnalytics();
}
requestAnimationFrame(() => {
setTimeout(() => {
if (typeof updateRepLiveMap === 'function') {
const mapContainer = document.getElementById('rep-map-container');
if (mapContainer && repMap) {
repMap.invalidateSize();
}
updateRepLiveMap();
}
}, 100);
});
} else {
if (adminControls) adminControls.style.display = 'none';
if (adminAnalytics) adminAnalytics.style.display = 'none';
const manageRepsBtnRep = document.getElementById('btn-manage-reps');
if (manageRepsBtnRep) manageRepsBtnRep.style.display = 'none';
if (repHeader) repHeader.style.display = 'flex';
if (newTransCard) newTransCard.style.display = 'block';
if (typeof renderRepCustomerTable === 'function') {
renderRepCustomerTable();
}
}
}
(function() {
const scrollableElements = new WeakSet();
window.smoothScrollTo = function(target, options = {}) {
const {
duration = 300,
easing = 'easeOutCubic',
offset = 0
} = options;
const element = typeof target === 'string' ? document.querySelector(target) : target;
if (!element) return;
const startY = window.pageYOffset;
const targetY = element.getBoundingClientRect().top + startY + offset;
const diff = targetY - startY;
const startTime = performance.now();
const easings = {
easeOutCubic: t => 1 - Math.pow(1 - t, 3),
easeInOutCubic: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
easeOutQuart: t => 1 - Math.pow(1 - t, 4)
};
const easeFn = easings[easing] || easings.easeOutCubic;
function step(currentTime) {
const elapsed = currentTime - startTime;
const progress = Math.min(elapsed / duration, 1);
const easedProgress = easeFn(progress);
window.scrollTo(0, startY + diff * easedProgress);
if (progress < 1) {
requestAnimationFrame(step);
}
}
requestAnimationFrame(step);
};
window.fastScrollToTop = function() {
window.scrollTo({ top: 0, behavior: 'instant' });
};
let scrollRafId = null;
let lastScrollY = 0;
window._rafScrollHandler = () => {
if (scrollRafId === null) {
scrollRafId = requestAnimationFrame(() => {
lastScrollY = window.pageYOffset;
scrollRafId = null;
});
}
};
window.addEventListener('scroll', window._rafScrollHandler, { passive: true });
window.getScrollY = function() {
return lastScrollY;
};
})();
function enableGPUAcceleration(element) {
if (!element) return;
element.style.transform = 'translateZ(0)';
element.style.willChange = 'transform';
element.style.backfaceVisibility = 'hidden';
}
const DOMBatch = {
reads: [],
writes: [],
read(fn) {
this.reads.push(fn);
this.schedule();
},
write(fn) {
this.writes.push(fn);
this.schedule();
},
schedule() {
if (!this.scheduled) {
this.scheduled = true;
requestAnimationFrame(() => this.flush());
}
},
flush() {
let read;
while (read = this.reads.shift()) {
read();
}
let write;
while (write = this.writes.shift()) {
write();
}
this.scheduled = false;
}
};
const lazyLoadObserver = new IntersectionObserver((entries) => {
entries.forEach(entry => {
if (entry.isIntersecting) {
entry.target.classList.add('in-view');
entry.target.dispatchEvent(new CustomEvent('enterViewport'));
} else {
entry.target.classList.remove('in-view');
entry.target.dispatchEvent(new CustomEvent('exitViewport'));
}
});
}, {
root: null,
rootMargin: '50px',
threshold: 0.1
});
function observeLazyLoad(element) {
if (element) {
lazyLoadObserver.observe(element);
}
}
function animateElement(element, keyframes, options = {}) {
if (!element) return Promise.resolve();
const defaultOptions = {
duration: 300,
easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
fill: 'forwards'
};
const animation = element.animate(keyframes, { ...defaultOptions, ...options });
return animation.finished;
}
function fadeIn(element, duration = 150) {
if (!element) return Promise.resolve();
element.style.opacity = '0';
element.style.display = '';
return animateElement(element, [
{ opacity: 0 },
{ opacity: 1 }
], { duration });
}
function fadeOut(element, duration = 100) {
if (!element) return Promise.resolve();
return animateElement(element, [
{ opacity: 1 },
{ opacity: 0 }
], { duration }).then(() => {
element.style.display = 'none';
});
}
function slideIn(element, direction = 'up', duration = 200) {
if (!element) return Promise.resolve();
const transforms = {
up: [{ transform: 'translateY(20px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
down: [{ transform: 'translateY(-20px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
left: [{ transform: 'translateX(20px)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }],
right: [{ transform: 'translateX(-20px)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }]
};
element.style.display = '';
return animateElement(element, transforms[direction] || transforms.up, { duration });
}
let frameCount = 0;
let lastTime = performance.now();
function measureFPS() {
frameCount++;
const currentTime = performance.now();
if (currentTime >= lastTime + 1000) {
const fps = Math.round((frameCount * 1000) / (currentTime - lastTime));
frameCount = 0;
lastTime = currentTime;
}
requestAnimationFrame(measureFPS);
}
function handleAdminRepDateChange(val) {
const mainInput = document.getElementById('rep-date');
if(mainInput) {
mainInput.value = val;
}
refreshRepUI();
if (typeof updateRepLiveMap === 'function') {
updateRepLiveMap();
}
if (typeof calculateRepAnalytics === 'function') {
calculateRepAnalytics();
}
}
function setMfgChartMode(mode) {
currentMfgMode = mode;
document.getElementById('mfg-week-btn').className = `toggle-opt ${mode === 'week' ? 'active' : ''}`;
document.getElementById('mfg-month-btn').className = `toggle-opt ${mode === 'month' ? 'active' : ''}`;
document.getElementById('mfg-year-btn').className = `toggle-opt ${mode === 'year' ? 'active' : ''}`;
document.getElementById('mfg-all-btn').className = `toggle-opt ${mode === 'all' ? 'active' : ''}`;
updateMfgCharts();
}
function updateMfgCharts() {
if (typeof Chart === 'undefined') {
loadChartJs().then(() => updateMfgCharts()).catch(() => {});
return;
}
if(mfgBarChart) mfgBarChart.destroy();
if(mfgPieChart) mfgPieChart.destroy();
let filteredData = currentProductionView === 'combined' ? db : db.filter(item => item.store === currentStore);
let labels = [], dataQty = [];
let totalCost = 0, totalProfit = 0, totalValue = 0;
const selectedDate = document.getElementById('sys-date').value;
const selectedDateObj = new Date(selectedDate);
const selectedYear = selectedDateObj.getFullYear();
const selectedMonth = selectedDateObj.getMonth();
const selectedDay = selectedDateObj.getDate();
const colors = {
text: '#1e3a8a',
grid: 'rgba(37, 99, 235, 0.1)'
};
if (currentMfgMode === 'week') {
for(let i=6; i>=0; i--) {
const d = new Date(selectedDateObj);
d.setDate(selectedDay - i);
const dateStr = d.toISOString().split('T')[0];
labels.push(d.toLocaleDateString('en-US', {weekday:'short'}));
let dayQty = 0;
filteredData.forEach(item => {
if(item.date === dateStr) {
dayQty += (item.net || 0);
}
});
dataQty.push(dayQty);
}
} else if (currentMfgMode === 'month') {
const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
labels = Array.from({length: daysInMonth}, (_, i) => i + 1);
dataQty = new Array(daysInMonth).fill(0);
filteredData.forEach(item => {
const d = new Date(item.date);
if(d.getMonth() === selectedMonth && d.getFullYear() === selectedYear) {
dataQty[d.getDate() - 1] += (item.net || 0);
}
});
} else if (currentMfgMode === 'year') {
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
labels = months;
dataQty = new Array(12).fill(0);
filteredData.forEach(item => {
const d = new Date(item.date);
if(d.getFullYear() === selectedYear) {
dataQty[d.getMonth()] += (item.net || 0);
}
});
} else if (currentMfgMode === 'all') {
const monthData = {};
filteredData.forEach(item => {
const d = new Date(item.date);
const monthYear = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = `${d.toLocaleDateString('en-US', {month:'short'})} ${d.getFullYear()}`;
if (!monthData[monthYear]) {
monthData[monthYear] = {
label: monthLabel,
qty: 0
};
}
monthData[monthYear].qty += (item.net || 0);
});
const sortedMonths = Object.keys(monthData).sort();
sortedMonths.forEach(monthKey => {
labels.push(monthData[monthKey].label);
dataQty.push(monthData[monthKey].qty);
});
if (labels.length > 12) {
labels = labels.slice(-12);
dataQty = dataQty.slice(-12);
}
}
filteredData.forEach(item => {
const d = new Date(item.date);
const dYear = d.getFullYear();
const dMonth = d.getMonth();
const dDay = d.getDate();
let include = false;
if(currentMfgMode === 'week') {
const weekStart = new Date(selectedDateObj);
weekStart.setDate(selectedDay - 6);
if(d >= weekStart && d <= selectedDateObj) include = true;
}
if(currentMfgMode === 'month' && dYear === selectedYear && dMonth === selectedMonth) include = true;
if(currentMfgMode === 'year' && dYear === selectedYear) include = true;
if(currentMfgMode === 'all') include = true;
if(include) {
totalCost += (item.totalCost || 0);
totalProfit += (item.profit || 0);
totalValue += (item.totalSale || 0);
}
});
const mfgBarCanvas = document.getElementById('mfgBarChart');
if (!mfgBarCanvas) {
return;
}
const mfgBarCtx = mfgBarCanvas.getContext('2d');
if (!mfgBarCtx) {
return;
}
mfgBarChart = new Chart(mfgBarCtx, {
type: 'bar',
data: {
labels: labels,
datasets: [{
label: 'Net Production (kg)',
data: dataQty,
backgroundColor: 'rgba(37, 99, 235, 0.6)',
borderColor: '#2563eb',
borderWidth: 1,
borderRadius: 4
}]
},
options: {
responsive: true,
maintainAspectRatio: false,
plugins: {
legend: { labels: { color: colors.text } },
title: {
display: true,
text: `Production Quantity (${currentMfgMode === 'all' ? 'All Times' : currentMfgMode.charAt(0).toUpperCase() + currentMfgMode.slice(1)})`,
color: colors.text,
font: { size: 13, weight: 'bold' }
}
},
scales: {
y: { grid: { color: colors.grid }, ticks: { color: colors.text }, beginAtZero: true },
x: { ticks: { color: colors.text, maxRotation: currentMfgMode === 'all' ? 45 : 0 } }
}
}
});
const pieData = [totalCost, totalProfit];
const pieLabels = ['Total Cost', 'Net Profit'];
const mfgPieCanvas = document.getElementById('mfgPieChart');
if (!mfgPieCanvas) {
return;
}
const mfgPieCtx = mfgPieCanvas.getContext('2d');
if (!mfgPieCtx) {
return;
}
mfgPieChart = new Chart(mfgPieCtx, {
type: 'pie',
data: {
labels: pieLabels,
datasets: [{
data: pieData,
backgroundColor: ['#dc2626', '#2563eb'],
borderWidth: 0
}]
},
options: {
responsive: true,
maintainAspectRatio: false,
plugins: {
legend: { position:'bottom', labels: { color: colors.text, font: { size: 10 } } },
title: {
display: true,
text: mfgPieChartShowPercentage ?
`Financials (Percentage) - ${currentMfgMode === 'all' ? 'All Times' : currentMfgMode.charAt(0).toUpperCase() + currentMfgMode.slice(1)}` :
`Financials: ${fmtAmt(safeValue(totalValue))} Total - ${currentMfgMode === 'all' ? 'All Times' : currentMfgMode.charAt(0).toUpperCase() + currentMfgMode.slice(1)}`,
color: colors.text,
font: { size: 13, weight: 'bold' }
},
tooltip: {
callbacks: {
label: function(context) {
if (mfgPieChartShowPercentage) {
const total = context.dataset.data.reduce((a, b) => a + b, 0);
const percentage = total > 0 ? safeNumber((context.parsed / total) * 100, 0).toFixed(2) : 0;
return `${context.label}: ${percentage}%`;
} else {
return `${context.label}: ${fmtAmt(safeNumber(context.parsed, 0))}`;
}
}
}
}
}
}
});
if (mfgPieChartShowPercentage) {
updateMfgPieChart();
}
}
function getWeightPerUnit(storeType) {
const formula = factoryDefaultFormulas[storeType];
if (!formula || formula.length === 0) return 0;
let totalWeight = 0;
formula.forEach(item => {
totalWeight += item.quantity;
});
return totalWeight;
}
function getPreviousDayAvailableUnits(storeType, currentDate) {
const previousDate = new Date(currentDate);
previousDate.setDate(previousDate.getDate() - 1);
const previousDateStr = previousDate.toISOString().split('T')[0];
const prevProduction = db.filter(item => item.date === previousDateStr);
const prevFactoryProduction = factoryProductionHistory.filter(item => item.date === previousDateStr);
const prevUsed = prevProduction.filter(item => item.formulaStore === storeType)
.reduce((sum, item) => sum + (item.formulaUnits || 0), 0);
const prevProduced = prevFactoryProduction.filter(item => item.store === storeType)
.reduce((sum, item) => sum + (item.units || 0), 0);
if (previousDate >= new Date('2020-01-01')) {
const prevPrevAvailable = getPreviousDayAvailableUnits(storeType, previousDate);
return Math.max(0, prevPrevAvailable + prevProduced - prevUsed);
}
return 0;
}
async function updateFactoryUnitsAvailableStats() {
const stdProductionData = db.filter(item => {
return (item.store === 'STORE_A' || item.store === 'STORE_B') && item.isReturn !== true;
});
const stdProducedUnits = factoryProductionHistory
.filter(item => item.store === 'standard')
.reduce((sum, item) => sum + (item.units || 0), 0);
const stdUsedUnits = stdProductionData.reduce((sum, item) => sum + (item.formulaUnits || 0), 0);
const stdOutputQuantity = stdProductionData.reduce((sum, item) => sum + (item.net || 0), 0);
const stdTotalCost = stdProductionData.reduce((sum, item) => sum + (item.totalCost || 0), 0);
const stdTotalSaleValue = stdProductionData.reduce((sum, item) => sum + (item.totalSale || 0), 0);
const stdTotalProfit = stdProductionData.reduce((sum, item) => sum + (item.profit || 0), 0);
const stdAvailableUnits = Math.max(0, stdProducedUnits - stdUsedUnits);
const stdCostPerUnit = getCostPerUnit('standard');
const stdTotalCostValue = stdCostPerUnit * stdAvailableUnits;
const stdProfitPerKg = stdOutputQuantity > 0 ? stdTotalProfit / stdOutputQuantity : 0;
const stdProfitPerUnit = stdUsedUnits > 0 ? stdTotalProfit / stdUsedUnits : 0;
const stdWeightPerUnit = getWeightPerUnit('standard');
const stdRawMaterialsUsed = stdWeightPerUnit * stdUsedUnits;
const stdMaterialsValue = stdProductionData.reduce((sum, item) => sum + (item.formulaCost || item.totalCost || 0), 0);
const _setFac = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
_setFac('factoryStdUnits', safeNumber(stdAvailableUnits, 0).toFixed(2));
_setFac('factoryStdUsedUnits', safeNumber(stdUsedUnits, 0).toFixed(2));
_setFac('factoryStdUnitCost', await formatCurrency(stdCostPerUnit));
_setFac('factoryStdTotalVal', await formatCurrency(stdTotalCostValue));
_setFac('factoryStdOutput', safeNumber(stdOutputQuantity, 0).toFixed(2) + ' kg');
_setFac('factoryStdRawUsed', safeNumber(stdRawMaterialsUsed, 0).toFixed(2) + ' kg');
_setFac('factoryStdMatVal', await formatCurrency(stdMaterialsValue));
_setFac('factoryStdProfit', await formatCurrency(stdTotalProfit));
_setFac('factoryStdProfitUnit', await formatCurrency(stdProfitPerKg) + '/kg');
const asaanProductionData = db.filter(item => item.store === 'STORE_C' && item.isReturn !== true);
const asaanProducedUnits = factoryProductionHistory
.filter(item => item.store === 'asaan')
.reduce((sum, item) => sum + (item.units || 0), 0);
const asaanUsedUnits = asaanProductionData.reduce((sum, item) => sum + (item.formulaUnits || 0), 0);
const asaanOutputQuantity = asaanProductionData.reduce((sum, item) => sum + (item.net || 0), 0);
const asaanTotalCost = asaanProductionData.reduce((sum, item) => sum + (item.totalCost || 0), 0);
const asaanTotalSaleValue = asaanProductionData.reduce((sum, item) => sum + (item.totalSale || 0), 0);
const asaanTotalProfit = asaanProductionData.reduce((sum, item) => sum + (item.profit || 0), 0);
const asaanAvailableUnits = Math.max(0, asaanProducedUnits - asaanUsedUnits);
const asaanCostPerUnit = getCostPerUnit('asaan');
const asaanTotalCostValue = asaanCostPerUnit * asaanAvailableUnits;
const asaanProfitPerKg = asaanOutputQuantity > 0 ? asaanTotalProfit / asaanOutputQuantity : 0;
const asaanProfitPerUnit = asaanUsedUnits > 0 ? asaanTotalProfit / asaanUsedUnits : 0;
const asaanWeightPerUnit = getWeightPerUnit('asaan');
const asaanRawMaterialsUsed = asaanWeightPerUnit * asaanUsedUnits;
const asaanMaterialsValue = asaanProductionData.reduce((sum, item) => sum + (item.formulaCost || item.totalCost || 0), 0);
_setFac('factoryAsaanUnits', safeNumber(asaanAvailableUnits, 0).toFixed(2));
_setFac('factoryAsaanUsedUnits', safeNumber(asaanUsedUnits, 0).toFixed(2));
_setFac('factoryAsaanUnitCost', await formatCurrency(asaanCostPerUnit));
_setFac('factoryAsaanTotalVal', await formatCurrency(asaanTotalCostValue));
_setFac('factoryAsaanOutput', safeNumber(asaanOutputQuantity, 0).toFixed(2) + ' kg');
_setFac('factoryAsaanRawUsed', safeNumber(asaanRawMaterialsUsed, 0).toFixed(2) + ' kg');
_setFac('factoryAsaanMatVal', await formatCurrency(asaanMaterialsValue));
_setFac('factoryAsaanProfit', await formatCurrency(asaanTotalProfit));
_setFac('factoryAsaanProfitUnit', await formatCurrency(asaanProfitPerKg) + '/kg');
}
async function updateFactorySummaryCard() {
const mode = currentFactorySummaryMode || 'all';
const selectedDateVal = document.getElementById('factory-date').value || new Date().toISOString().split('T')[0];
const selectedDate = new Date(selectedDateVal);
const selectedYear = selectedDate.getFullYear();
const selectedMonth = selectedDate.getMonth();
const selectedDay = selectedDate.getDate();
function isInRange(dateStr) {
const entryDate = new Date(dateStr);
if (mode === 'daily') return dateStr === selectedDateVal;
if (mode === 'weekly') {
const weekStart = new Date(selectedDate);
weekStart.setDate(selectedDay - 6);
return entryDate >= weekStart && entryDate <= selectedDate;
}
if (mode === 'monthly') return entryDate.getMonth() === selectedMonth && entryDate.getFullYear() === selectedYear;
if (mode === 'yearly') return entryDate.getFullYear() === selectedYear;
return true;
}
const allTimeRecomp = { standard: { produced: 0, consumed: 0 }, asaan: { produced: 0, consumed: 0 } };
factoryProductionHistory.forEach(entry => {
const store = entry.store === 'asaan' ? 'asaan' : 'standard';
allTimeRecomp[store].produced += entry.units || 0;
});
db.forEach(entry => {
if (entry.isReturn === true) return;
const store = (entry.formulaStore === 'asaan' || entry.store === 'STORE_C') ? 'asaan' : 'standard';
allTimeRecomp[store].consumed += entry.formulaUnits || 0;
});
const stdAvailable = Math.max(0, allTimeRecomp.standard.produced - allTimeRecomp.standard.consumed);
const asaanAvailable = Math.max(0, allTimeRecomp.asaan.produced - allTimeRecomp.asaan.consumed);
const totalAvailable = stdAvailable + asaanAvailable;
let stdConsumed = 0, asaanConsumed = 0;
let totalCost = 0, totalOutput = 0, totalProfit = 0;
let totalSaleValue = 0, totalRawMatCost = 0;
let totalRawUsed = 0;
db.forEach(entry => {
if (entry.isReturn === true) return;
if (!isInRange(entry.date)) return;
const formulaStore = (entry.formulaStore === 'asaan' || entry.store === 'STORE_C') ? 'asaan' : 'standard';
const units = entry.formulaUnits || 0;
if (formulaStore === 'asaan') asaanConsumed += units;
else stdConsumed += units;
totalOutput += entry.net || 0;
totalCost += entry.totalCost || 0;
totalSaleValue += entry.totalSale || 0;
totalProfit += entry.profit || 0;
totalRawMatCost += entry.formulaCost || entry.totalCost || 0;
const weightPerUnit = getWeightPerUnit(formulaStore);
totalRawUsed += weightPerUnit * units;
});
const totalConsumed = stdConsumed + asaanConsumed;
const stdCostPerUnit = getCostPerUnit('standard');
const asaanCostPerUnit = getCostPerUnit('asaan');
const avgCostPerUnit = totalConsumed > 0
? (stdConsumed * stdCostPerUnit + asaanConsumed * asaanCostPerUnit) / totalConsumed
: 0;
const totalMatValue = totalRawMatCost;
const avgProfitPerKg = totalOutput > 0 ? totalProfit / totalOutput : 0;
const _setSum = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
_setSum('factorySumUnits', safeNumber(totalAvailable, 0).toFixed(2));
_setSum('factorySumUsedUnits', safeNumber(totalConsumed, 0).toFixed(2));
_setSum('factorySumUnitCost', await formatCurrency(avgCostPerUnit));
_setSum('factorySumTotalCost', await formatCurrency(totalCost));
_setSum('factorySumOutput', safeNumber(totalOutput, 0).toFixed(2) + ' kg');
_setSum('factorySumRawUsed', safeNumber(totalRawUsed, 0).toFixed(2) + ' kg');
_setSum('factorySumMatVal', await formatCurrency(totalMatValue));
_setSum('factorySumProfit', await formatCurrency(totalProfit));
_setSum('factorySumProfitUnit', await formatCurrency(avgProfitPerKg) + '/kg');
}
function getInitialAvailableForRange(storeType, mode, endDate) {
const end = new Date(endDate);
let startDate = new Date(end);
if (mode === 'weekly') {
startDate.setDate(end.getDate() - 6);
} else if (mode === 'monthly') {
startDate = new Date(end.getFullYear(), end.getMonth(), 1);
} else if (mode === 'yearly') {
startDate = new Date(end.getFullYear(), 0, 1);
}
return getPreviousDayAvailableUnits(storeType, startDate);
}
async function refreshFactoryTab() {
if (idb && idb.getBatch) {
try {
const factoryKeys = [
'factory_inventory_data',
'factory_production_history',
'factory_unit_tracking',
'factory_default_formulas'
];
const factoryDataMap = await idb.getBatch(factoryKeys);
if (factoryDataMap.get('factory_inventory_data')) {
let freshInventory = factoryDataMap.get('factory_inventory_data') || [];
let fixedCount = 0;
if (Array.isArray(freshInventory) && freshInventory.length > 0) {
freshInventory = freshInventory.map(record => {
if (!record.id || !validateUUID(record.id) ||
!record.createdAt || !validateTimestamp(record.createdAt) ||
!record.updatedAt || !validateTimestamp(record.updatedAt)) {
record = ensureRecordIntegrity(record, false, true);
fixedCount++;
}
return record;
});
if (fixedCount > 0) {
await idb.set('factory_inventory_data', freshInventory);
}
}
factoryInventoryData = freshInventory;
}
if (factoryDataMap.get('factory_production_history')) {
let freshHistory = factoryDataMap.get('factory_production_history') || [];
let fixedCount = 0;
if (Array.isArray(freshHistory) && freshHistory.length > 0) {
freshHistory = freshHistory.map(record => {
if (!record.id || !validateUUID(record.id) ||
!record.createdAt || !validateTimestamp(record.createdAt) ||
!record.updatedAt || !validateTimestamp(record.updatedAt)) {
record = ensureRecordIntegrity(record, false, true);
fixedCount++;
}
return record;
});
if (fixedCount > 0) {
await idb.set('factory_production_history', freshHistory);
}
freshHistory.sort((a, b) => compareTimestamps(getRecordTimestamp(b), getRecordTimestamp(a)));
}
factoryProductionHistory = freshHistory;
}
if (factoryDataMap.get('factory_unit_tracking')) {
factoryUnitTracking = factoryDataMap.get('factory_unit_tracking') || {
standard: { produced: 0, used: 0, returned: 0 },
asaan: { produced: 0, used: 0, returned: 0 }
};
}
if (factoryDataMap.get('factory_default_formulas')) {
factoryDefaultFormulas = factoryDataMap.get('factory_default_formulas') || { standard: [], asaan: [] };
}
} catch (error) {
console.error('Failed to save data locally.', _safeErr(error));
showToast('Failed to save data locally.', 'error');
}
}
const factoryDateInput = document.getElementById('factory-date');
if (!factoryDateInput.value) {
const today = new Date().toISOString().split('T')[0];
factoryDateInput.value = today;
currentFactoryDate = today;
} else {
currentFactoryDate = factoryDateInput.value;
}
updateFactoryUnitsAvailableStats();
updateFactorySummaryCard();
renderFactoryHistory();
renderFactoryInventory();
calculateFactoryProduction();
}
function updateAllTabsWithFactoryCosts() {
const storeSelector = document.getElementById('storeSelector');
if (storeSelector) {
updateUnitsAvailableIndicator();
updateProductionCostOnStoreChange();
}
const supplyStore = document.getElementById('supply-store-value');
if (supplyStore && supplyStore.value) {
calculateCustomerSale();
}
calculateSales();
updateFactoryUnitsAvailableStats();
updateFactorySummaryCard();
refreshUI();
}
function initFactoryTab() {
const factoryDateInput = document.getElementById('factory-date');
if (!factoryDateInput.value) {
const today = new Date().toISOString().split('T')[0];
factoryDateInput.value = today;
currentFactoryDate = today;
}
refreshFactoryTab();
document.querySelectorAll('#tab-factory .toggle-group .toggle-opt').forEach((opt, index) => {
if (index === 0) opt.classList.add('active');
else opt.classList.remove('active');
});
}
function setProductionView(view, event) {
currentProductionView = view;
document.querySelectorAll('.production-toggle-btn').forEach(btn => btn.classList.remove('active'));
if (event && event.target) event.target.classList.add('active');
const entrySection = document.getElementById('production-entry-section');
const combinedOverview = document.getElementById('combinedOverview');
const combinedChart = document.getElementById('combinedChart');
const analyticsSection = document.getElementById('prod-analytics-section');
const historyHeader = document.getElementById('prod-history-header');
const searchBar = document.getElementById('prod-search-bar');
if (view === 'store') {
entrySection.classList.remove('hidden');
if (combinedOverview) combinedOverview.classList.add('hidden');
if (combinedChart) combinedChart.classList.add('hidden');
if (analyticsSection) analyticsSection.classList.add('hidden');
if (historyHeader) historyHeader.classList.remove('hidden');
if (searchBar) searchBar.classList.remove('hidden');
} else {
entrySection.classList.add('hidden');
if (combinedOverview) combinedOverview.classList.remove('hidden');
if (combinedChart) combinedChart.classList.remove('hidden');
if (analyticsSection) analyticsSection.classList.remove('hidden');
if (historyHeader) historyHeader.classList.remove('hidden');
if (searchBar) searchBar.classList.remove('hidden');
updateAllStoresOverview(currentOverviewMode);
}
refreshUI();
}
function updateAllStoresOverview(mode = 'day') {
currentOverviewMode = mode;
const selectedDate = document.getElementById('sys-date').value;
const selectedDateObj = new Date(selectedDate);
const selectedYear = selectedDateObj.getFullYear();
const selectedMonth = selectedDateObj.getMonth();
const stores = ['STORE_A', 'STORE_B', 'STORE_C'];
const storeNames = ['ZUBAIR', 'MAHMOOD', 'ASAAN'];
const storeColors = ['store-a', 'store-b', 'store-c'];
let totalCombined = {
production: 0,
returns: 0,
sold: 0,
qty: 0,
value: 0,
cost: 0,
profit: 0,
formulaUnits: 0,
formulaCost: 0
};
const allStoresGrid = document.getElementById('all-stores-grid');
const _asgFrag = document.createDocumentFragment();
stores.forEach((store, index) => {
let storeData = {
production: 0,
returns: 0,
sold: 0,
value: 0,
cost: 0,
profit: 0,
formulaUnits: 0,
formulaCost: 0
};
db.forEach(item => {
const itemDate = new Date(item.date);
const itemYear = itemDate.getFullYear();
const itemMonth = itemDate.getMonth();
let includeItem = false;
if (mode === 'day' && item.date === selectedDate) includeItem = true;
else if (mode === 'week') {
const weekStart = new Date(selectedDateObj);
weekStart.setDate(selectedDateObj.getDate() - 6);
if (itemDate >= weekStart && itemDate <= selectedDateObj) includeItem = true;
}
else if (mode === 'month' && itemYear === selectedYear && itemMonth === selectedMonth) includeItem = true;
else if (mode === 'year' && itemYear === selectedYear) includeItem = true;
else if (mode === 'all') includeItem = true;
if (includeItem && item.store === store) {
if (item.isReturn) {
storeData.returns += (item.net || 0);
} else {
storeData.production += (item.net || 0);
storeData.formulaUnits += (item.formulaUnits || 0);
storeData.formulaCost += (item.formulaCost || 0);
storeData.value += (item.totalSale || 0);
storeData.cost += (item.totalCost || 0);
storeData.profit += (item.profit || 0);
}
}
});
let soldQty = 0;
customerSales.forEach(sale => {
const saleDate = new Date(sale.date);
const saleYear = saleDate.getFullYear();
const saleMonth = saleDate.getMonth();
let includeSale = false;
if (mode === 'day' && sale.date === selectedDate) includeSale = true;
else if (mode === 'week') {
const weekStart = new Date(selectedDateObj);
weekStart.setDate(selectedDateObj.getDate() - 6);
if (saleDate >= weekStart && saleDate <= selectedDateObj) includeSale = true;
}
else if (mode === 'month' && saleYear === selectedYear && saleMonth === selectedMonth) includeSale = true;
else if (mode === 'year' && saleYear === selectedYear) includeSale = true;
else if (mode === 'all') includeSale = true;
if (includeSale && sale.supplyStore === store) {
soldQty += (sale.quantity || 0);
}
});
storeData.sold = soldQty;
	let calcTabStoreReturns = 0;
	if (Array.isArray(salesHistory)) {
		salesHistory.forEach(h => {
			const hDate = new Date(h.date);
			const hYear = hDate.getFullYear();
			const hMonth = hDate.getMonth();
			let includeInCalc = false;
			if (mode === 'day' && h.date === selectedDate) includeInCalc = true;
			else if (mode === 'week') {
				const weekStart = new Date(selectedDateObj);
				weekStart.setDate(selectedDateObj.getDate() - 6);
				if (hDate >= weekStart && hDate <= selectedDateObj) includeInCalc = true;
			}
			else if (mode === 'month' && hYear === selectedYear && hMonth === selectedMonth) includeInCalc = true;
			else if (mode === 'year' && hYear === selectedYear) includeInCalc = true;
			else if (mode === 'all') includeInCalc = true;
			if (includeInCalc && (h.returned || 0) > 0) {
				if (h.isMerged && h.returnsByStore && typeof h.returnsByStore === 'object') {
					const storeReturnFromMerged = h.returnsByStore[store] || 0;
					calcTabStoreReturns += storeReturnFromMerged;
				} else {
					const returnEntries = db.filter(item =>
						item.isReturn === true &&
						item.returnedBy === h.seller &&
						item.store === store &&
						item.date === h.date
					);
					const storeReturnQty = returnEntries.reduce((sum, item) => sum + (item.net || 0), 0);
					calcTabStoreReturns += storeReturnQty;
				}
			}
		});
	}
	if (calcTabStoreReturns > 0 && Math.abs(storeData.returns - calcTabStoreReturns) > 0.01) {
		storeData.returns = calcTabStoreReturns;
	}
const totalIn = storeData.production + storeData.returns;
const remainingQty = totalIn - soldQty;
totalCombined.production += storeData.production;
totalCombined.returns += storeData.returns;
totalCombined.sold += storeData.sold;
totalCombined.qty += totalIn;
totalCombined.value += storeData.value;
totalCombined.cost += storeData.cost;
totalCombined.profit += storeData.profit;
totalCombined.formulaUnits += storeData.formulaUnits;
totalCombined.formulaCost += storeData.formulaCost;
let returnsHtml = '';
if (storeData.returns > 0) {
returnsHtml = `<p><span>Returns Recvd:</span> <span style="color:#10b981; font-weight:800;">${safeValue(storeData.returns).toFixed(2)} kg</span></p>`;
}
const card = document.createElement('div');
card.className = `overview-card liquid-card`;
card.innerHTML = `
<span class="store-badge ${storeColors[index]}">${esc(storeNames[index])}</span>
<h4>${esc(storeNames[index])} (${mode === 'all' ? 'All Times' : mode.charAt(0).toUpperCase() + mode.slice(1)})</h4>
<p><span>Produced:</span> <span class="qty-val" style="color:var(--text-main);">${safeValue(storeData.production).toFixed(2)} kg</span></p>
${returnsHtml}
<p><span>Sold (Sales Tab):</span> <span class="cost-val">${safeValue(soldQty).toFixed(2)} kg</span></p>
<div style="border-top:1px dashed var(--glass-border); margin:4px 0; padding-top:4px;">
<p><span>Remaining:</span> <span class="profit-val" style="font-size:1.1rem;">${safeValue(remainingQty).toFixed(2)} kg</span></p>
</div>
<div style="background:rgba(37,99,235,0.03); padding:5px; border-radius:6px; margin:5px 0;">
<p><span>Formula Units:</span> <span class="qty-val u-fw-700" >${safeValue(storeData.formulaUnits).toFixed(2)}</span></p>
<p><span>Formula Cost:</span> <span class="cost-val u-fw-700" >${fmtAmt(safeValue(storeData.formulaCost))}</span></p>
</div>
<hr>
<p><span>Total Value:</span> <span class="rev-val">${fmtAmt(safeValue(storeData.value))}</span></p>
<p><span>Net Profit:</span> <span class="profit-val">${fmtAmt(safeValue(storeData.profit))}</span></p>
`;
_asgFrag.appendChild(card);
});
const combinedRemaining = totalCombined.qty - totalCombined.sold;
	let calcTabTotalReturns = 0;
	if (Array.isArray(salesHistory)) {
		salesHistory.forEach(h => {
			const hDate = new Date(h.date);
			const hYear = hDate.getFullYear();
			const hMonth = hDate.getMonth();
			let includeInCalc = false;
			if (mode === 'day' && h.date === selectedDate) includeInCalc = true;
			else if (mode === 'week') {
				const weekStart = new Date(selectedDateObj);
				weekStart.setDate(selectedDateObj.getDate() - 6);
				if (hDate >= weekStart && hDate <= selectedDateObj) includeInCalc = true;
			}
			else if (mode === 'month' && hYear === selectedYear && hMonth === selectedMonth) includeInCalc = true;
			else if (mode === 'year' && hYear === selectedYear) includeInCalc = true;
			else if (mode === 'all') includeInCalc = true;
			if (includeInCalc) {
				calcTabTotalReturns += (h.returned || 0);
			}
		});
	}
	if (calcTabTotalReturns > 0 && Math.abs(totalCombined.returns - calcTabTotalReturns) > 0.01) {
		totalCombined.returns = calcTabTotalReturns;
	}
const combinedCard = document.createElement('div');
combinedCard.className = `overview-card liquid-card highlight-card`;
combinedCard.innerHTML = `
<h4 style="color: var(--accent);">Total Combined</h4>
<p><span>Fresh Production:</span> <span class="qty-val">${safeValue(totalCombined.production).toFixed(2)} kg</span></p>
${totalCombined.returns > 0 ? `<p><span>Total Returns:</span> <span style="color:#10b981; font-weight:800;">${safeValue(totalCombined.returns).toFixed(2)} kg</span></p>` : ''}
<p><span>Total Sold:</span> <span class="cost-val">${safeValue(totalCombined.sold).toFixed(2)} kg</span></p>
<div style="border-top:1px dashed var(--glass-border); margin:4px 0; padding-top:4px;">
<p><span>Total Remaining:</span> <span class="profit-val" style="font-size:1.1rem;">${safeValue(combinedRemaining).toFixed(2)} kg</span></p>
</div>
<p><span>Total Formula Units:</span> <span class="qty-val">${safeValue(totalCombined.formulaUnits).toFixed(2)}</span></p>
<p><span>Total Formula Cost:</span> <span class="cost-val">${fmtAmt(safeValue(totalCombined.formulaCost))}</span></p>
<hr style="margin:8px 0;">
<p><span>Total Value:</span> <span class="rev-val">${fmtAmt(safeValue(totalCombined.value))}</span></p>
<p><span>Total Cost:</span> <span class="cost-val">${fmtAmt(safeValue(totalCombined.cost))}</span></p>
<p><span>Net Profit:</span> <span class="profit-val">${fmtAmt(safeValue(totalCombined.profit))}</span></p>
`;
_asgFrag.appendChild(combinedCard);
allStoresGrid.replaceChildren(_asgFrag);
updateStoreComparisonChart(mode);
}
function setCustomerChartMode(mode) {
currentCustomerChartMode = mode;
document.getElementById('cust-week-btn').className = `toggle-opt ${mode === 'week' ? 'active' : ''}`;
document.getElementById('cust-month-btn').className = `toggle-opt ${mode === 'month' ? 'active' : ''}`;
document.getElementById('cust-year-btn').className = `toggle-opt ${mode === 'year' ? 'active' : ''}`;
document.getElementById('cust-all-btn').className = `toggle-opt ${mode === 'all' ? 'active' : ''}`;
updateCustomerCharts();
}
function updateCustomerCharts() {
if (typeof Chart === 'undefined') {
loadChartJs().then(() => updateCustomerCharts()).catch(() => {});
return;
}
if(custSalesChart) custSalesChart.destroy();
if(custPaymentChart) custPaymentChart.destroy();
const selectedDate = document.getElementById('cust-date').value;
if (!selectedDate) return;
const selectedDateObj = new Date(selectedDate);
const selectedYear = selectedDateObj.getFullYear();
const selectedMonth = selectedDateObj.getMonth();
const selectedDay = selectedDateObj.getDate();
let labels = [], cashData = [], creditData = [];
let totalCash = 0, totalCredit = 0;
const colors = {
text: '#1e3a8a',
grid: 'rgba(37, 99, 235, 0.1)'
};
if (currentCustomerChartMode === 'week') {
for(let i=6; i>=0; i--) {
const d = new Date(selectedDateObj);
d.setDate(selectedDay - i);
const dateStr = d.toISOString().split('T')[0];
labels.push(d.toLocaleDateString('en-US', {weekday:'short'}));
let dayCash = 0, dayCredit = 0;
customerSales.forEach(item => {
if(item.date === dateStr) {
const isRepLinked = item.salesRep && item.salesRep !== 'NONE';
if (item.isMerged && item.mergedSummary) {
const ms = item.mergedSummary;
dayCash   += (ms.cashSales    || 0);
dayCredit += (ms.unpaidCredit || 0);
} else if(item.paymentType === 'CREDIT' && !item.creditReceived) {

dayCredit += item.totalValue;
} else if(isRepLinked) {

dayCredit += item.totalValue;
} else if(item.paymentType === 'CASH' || item.creditReceived) {

dayCash += item.totalValue;
}
}
});
cashData.push(dayCash);
creditData.push(dayCredit);
}
} else if (currentCustomerChartMode === 'month') {
const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
labels = Array.from({length: daysInMonth}, (_, i) => i + 1);
cashData = new Array(daysInMonth).fill(0);
creditData = new Array(daysInMonth).fill(0);
customerSales.forEach(item => {
const d = new Date(item.date);
if(d.getMonth() === selectedMonth && d.getFullYear() === selectedYear) {
const isRepLinked = item.salesRep && item.salesRep !== 'NONE';
if (item.isMerged && item.mergedSummary) {
const ms = item.mergedSummary;
cashData[d.getDate()   - 1] += (ms.cashSales    || 0);
creditData[d.getDate() - 1] += (ms.unpaidCredit || 0);
} else if(item.paymentType === 'CREDIT' && !item.creditReceived) {
creditData[d.getDate() - 1] += item.totalValue;
} else if(isRepLinked) {

creditData[d.getDate() - 1] += item.totalValue;
} else if(item.paymentType === 'CASH' || item.creditReceived) {
cashData[d.getDate() - 1] += item.totalValue;
}
}
});
} else if (currentCustomerChartMode === 'year') {
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
labels = months;
cashData = new Array(12).fill(0);
creditData = new Array(12).fill(0);
customerSales.forEach(item => {
const d = new Date(item.date);
if(d.getFullYear() === selectedYear) {
const isRepLinked = item.salesRep && item.salesRep !== 'NONE';
if (item.isMerged && item.mergedSummary) {
const ms = item.mergedSummary;
cashData[d.getMonth()]   += (ms.cashSales    || 0);
creditData[d.getMonth()] += (ms.unpaidCredit || 0);
} else if(item.paymentType === 'CREDIT' && !item.creditReceived) {
creditData[d.getMonth()] += item.totalValue;
} else if(isRepLinked) {

creditData[d.getMonth()] += item.totalValue;
} else if(item.paymentType === 'CASH' || item.creditReceived) {
cashData[d.getMonth()] += item.totalValue;
}
}
});
} else if (currentCustomerChartMode === 'all') {
const monthData = {};
customerSales.forEach(item => {
const d = new Date(item.date);
const monthYear = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = `${d.toLocaleDateString('en-US', {month:'short'})} ${d.getFullYear()}`;
if (!monthData[monthYear]) {
monthData[monthYear] = {
label: monthLabel,
cash: 0,
credit: 0
};
}
const isRepLinked = item.salesRep && item.salesRep !== 'NONE';
if (item.isMerged && item.mergedSummary) {
const ms = item.mergedSummary;
monthData[monthYear].cash   += (ms.cashSales    || 0);
monthData[monthYear].credit += (ms.unpaidCredit || 0);
} else if(item.paymentType === 'CREDIT' && !item.creditReceived) {
monthData[monthYear].credit += item.totalValue;
} else if(isRepLinked) {

monthData[monthYear].credit += item.totalValue;
} else if(item.paymentType === 'CASH' || item.creditReceived) {
monthData[monthYear].cash += item.totalValue;
}
});
const sortedMonths = Object.keys(monthData).sort();
sortedMonths.forEach(monthKey => {
labels.push(monthData[monthKey].label);
cashData.push(monthData[monthKey].cash);
creditData.push(monthData[monthKey].credit);
});
if (labels.length > 12) {
labels = labels.slice(-12);
cashData = cashData.slice(-12);
creditData = creditData.slice(-12);
}
}
customerSales.forEach(item => {
const d = new Date(item.date);
const dYear = d.getFullYear();
const dMonth = d.getMonth();
const dDay = d.getDate();
let include = false;
if(currentCustomerChartMode === 'week') {
const weekStart = new Date(selectedDateObj);
weekStart.setDate(selectedDay - 6);
if(d >= weekStart && d <= selectedDateObj) include = true;
}
if(currentCustomerChartMode === 'month' && dYear === selectedYear && dMonth === selectedMonth) include = true;
if(currentCustomerChartMode === 'year' && dYear === selectedYear) include = true;
if(currentCustomerChartMode === 'all') include = true;
if(include) {
const isRepLinked = item.salesRep && item.salesRep !== 'NONE';
if (item.isMerged && item.mergedSummary) {
const ms = item.mergedSummary;
totalCash   += (ms.cashSales    || 0);
totalCredit += (ms.unpaidCredit || 0);
} else if(item.paymentType === 'CREDIT' && !item.creditReceived) {
totalCredit += item.totalValue;
} else if(isRepLinked) {

totalCredit += item.totalValue;
} else if(item.paymentType === 'CASH' || item.creditReceived) {
totalCash += item.totalValue;
}
}
});
const custSalesCanvas = document.getElementById('custSalesChart');
if (!custSalesCanvas) {
return;
}
const custSalesCtx = custSalesCanvas.getContext('2d');
if (!custSalesCtx) {
return;
}
custSalesChart = new Chart(custSalesCtx, {
type: 'bar',
data: {
labels: labels,
datasets: [
{
label: 'Cash Sales (Inc. Received Credits)',
data: cashData,
backgroundColor: 'rgba(5, 150, 105, 0.6)',
borderColor: '#059669',
borderWidth: 1,
borderRadius: 4
},
{
label: 'Pending Credits',
data: creditData,
backgroundColor: 'rgba(245, 158, 11, 0.6)',
borderColor: '#f59e0b',
borderWidth: 1,
borderRadius: 4
}
]
},
options: {
responsive: true,
maintainAspectRatio: false,
plugins: {
legend: { labels: { color: colors.text, font: { size: 10 } } },
title: {
display: true,
text: `Sales by Payment Type (${currentCustomerChartMode === 'all' ? 'All Times' : currentCustomerChartMode.charAt(0).toUpperCase() + currentCustomerChartMode.slice(1)})`,
color: colors.text,
font: { size: 13, weight: 'bold' }
}
},
scales: {
y: {
stacked: true,
grid: { color: colors.grid },
ticks: { color: colors.text },
beginAtZero: true
},
x: {
stacked: true,
ticks: { color: colors.text, maxRotation: currentCustomerChartMode === 'all' ? 45 : 0 }
}
}
}
});
const pieData = [totalCash, totalCredit];
const pieLabels = ['Cash Sales (Inc. Received Credits)', 'Pending Credits'];
const custPaymentCanvas = document.getElementById('custPaymentChart');
if (!custPaymentCanvas) {
return;
}
const custPaymentCtx = custPaymentCanvas.getContext('2d');
if (!custPaymentCtx) {
return;
}
custPaymentChart = new Chart(custPaymentCtx, {
type: 'pie',
data: {
labels: pieLabels,
datasets: [{
data: pieData,
backgroundColor: ['#059669', '#f59e0b'],
borderWidth: 0
}]
},
options: {
responsive: true,
maintainAspectRatio: false,
plugins: {
legend: { position:'bottom', labels: { color: colors.text, font: { size: 10 } } },
title: {
display: true,
text: custPaymentChartShowPercentage ?
`Payment Distribution (Percentage) - ${currentCustomerChartMode === 'all' ? 'All Times' : ''}` :
`Total: ${fmtAmt(safeValue(totalCash + totalCredit))} - ${currentCustomerChartMode === 'all' ? 'All Times' : ''}`,
color: colors.text,
font: { size: 13, weight: 'bold' }
},
tooltip: {
callbacks: {
label: function(context) {
if (custPaymentChartShowPercentage) {
const total = context.dataset.data.reduce((a, b) => a + b, 0);
const percentage = total > 0 ? safeNumber((context.parsed / total) * 100, 0).toFixed(2) : 0;
return `${context.label}: ${percentage}%`;
} else {
return `${context.label}: ${fmtAmt(safeNumber(context.parsed, 0))}`;
}
}
}
}
}
}
});
if (custPaymentChartShowPercentage) {
updateCustomerPieChart();
}
}
async function refreshCustomerSales(page = 1, force = false) {
const selectedDate = document.getElementById('cust-date').value;
if (!selectedDate) return;
if (idb && idb.get) {
try {
let freshSales = await idb.get('customer_sales', []);
if (force && firebaseDB && currentUser) {
try {
const userDocRef = firebaseDB.collection('users').doc(currentUser.uid);
const snapshot = await userDocRef.collection('sales').get();
if (!snapshot.empty) {
const firestoreSales = [];
snapshot.forEach(doc => {
const data = doc.data();
if (!data._placeholder) {
firestoreSales.push({ id: doc.id, ...data });
}
});
const localMap = new Map((freshSales || []).map(r => [r.id, r]));
for (const cloudRecord of firestoreSales) {
if (!cloudRecord.id) continue;
const localRecord = localMap.get(cloudRecord.id);
if (!localRecord) {
localMap.set(cloudRecord.id, cloudRecord);
} else {
const localTs = localRecord.updatedAt || localRecord.timestamp || 0;
const cloudTs = typeof cloudRecord.updatedAt === 'object' && cloudRecord.updatedAt?.toMillis
? cloudRecord.updatedAt.toMillis()
: (cloudRecord.updatedAt || cloudRecord.timestamp || 0);
if (cloudTs > localTs) {
localMap.set(cloudRecord.id, cloudRecord);
}
}
}
freshSales = Array.from(localMap.values());
await idb.set('customer_sales', freshSales);
}
} catch (firestoreError) {
console.error('Failed to save data locally.', _safeErr(firestoreError));
showToast('Failed to save data locally.', 'error');
}
}
if (freshSales && freshSales.length > 0) {
let fixedCount = 0;
freshSales = freshSales.map(record => {
if (!record.id || !validateUUID(record.id) ||
!record.createdAt || !validateTimestamp(record.createdAt) ||
!record.updatedAt || !validateTimestamp(record.updatedAt)) {
record = ensureRecordIntegrity(record, false, true);
fixedCount++;
}
return record;
});
if (fixedCount > 0) {
await idb.set('customer_sales', freshSales);
}
customerSales = freshSales;
}
} catch (error) {
console.error('Failed to save data locally.', _safeErr(error));
showToast('Failed to save data locally.', 'error');
}
}
const selectedDateObj = new Date(selectedDate);
const selectedYear = selectedDateObj.getFullYear();
const selectedMonth = selectedDateObj.getMonth();
const selectedDay = selectedDateObj.getDate();
const weekStart = new Date(selectedDateObj);
weekStart.setDate(selectedDay - 6);
let stats = {
day: {q:0, v:0, cash:0, credit:0, profit:0},
week: {q:0, v:0, cash:0, credit:0, profit:0},
month: {q:0, v:0, cash:0, credit:0, profit:0},
year: {q:0, v:0, cash:0, credit:0, profit:0},
all: {q:0, v:0, cash:0, credit:0, profit:0}
};
const sortedSales = [...customerSales].sort((a,b) => {
if (a.date === selectedDate && b.date !== selectedDate) return -1;
if (a.date !== selectedDate && b.date === selectedDate) return 1;
return compareTimestamps(getRecordTimestamp(b), getRecordTimestamp(a));
});
sortedSales.forEach(item => {
const isRepLinked = item.salesRep && item.salesRep !== 'NONE';
const isAdminCollection = !isRepLinked && item.paymentType === 'COLLECTION' && item.currentRepProfile === 'admin';

if (!isRepLinked && !isAdminCollection && (item.paymentType === 'PARTIAL_PAYMENT' ||
item.paymentType === 'COLLECTION')) return;

const rowDate = new Date(item.date);
const rowYear = rowDate.getFullYear();
const rowMonth = rowDate.getMonth();
const rowDay = rowDate.getDate();
const updatePeriod = (period) => {
if (isAdminCollection) {
// Admin collections don't add to quantity/value/profit totals — they just clear credit
return;
}
period.q += item.quantity;
period.v += item.totalValue;
period.profit += item.profit;
if (item.isMerged && item.mergedSummary) {
const ms = item.mergedSummary;
period.cash   += (ms.cashSales    || 0);
period.credit += (ms.unpaidCredit || 0);
} else if(item.paymentType === 'CREDIT' && !item.creditReceived) {

period.credit += item.totalValue;
} else if(isRepLinked) {

period.credit += item.totalValue;
} else if(item.paymentType === 'CASH' || item.creditReceived) {

period.cash += item.totalValue;
}
};
if(item.date === selectedDate) updatePeriod(stats.day);
if(rowDate >= weekStart && rowDate <= selectedDateObj) updatePeriod(stats.week);
if(rowYear === selectedYear && rowMonth === selectedMonth) updatePeriod(stats.month);
if(rowYear === selectedYear) updatePeriod(stats.year);
updatePeriod(stats.all);
});
const displayData = sortedSales.filter(item => {
const _isRepLinked = item.salesRep && item.salesRep !== 'NONE';
const _isAdminColl = !_isRepLinked && item.paymentType === 'COLLECTION' && item.currentRepProfile === 'admin';
if (_isAdminColl) return true; // always show admin collections
return item.paymentType !== 'PARTIAL_PAYMENT' && item.paymentType !== 'COLLECTION';
});
const pageData = displayData;
const validPage = 1;
const totalPages = 1;
const totalItems = displayData.length;
const cacheData = {
pageData, stats, selectedDate, totalPages, totalItems, validPage
};
renderSalesFromCache(cacheData);
}
function renderSalesFromCache(cached) {
if (!cached) {
return;
}
const { pageData, stats, selectedDate, totalPages, totalItems, validPage } = cached;
const updateStatDisplay = (prefix, stat) => {
const qtyEl = document.getElementById(`cust-${prefix}-qty`);
const valueEl = document.getElementById(`cust-${prefix}-value`);
const cashEl = document.getElementById(`cust-${prefix}-cash`);
const creditEl = document.getElementById(`cust-${prefix}-credit`);
const profitEl = document.getElementById(`cust-${prefix}-profit`);
if (qtyEl) qtyEl.innerText = safeValue(stat.q).toFixed(2) + ' kg';
if (valueEl) valueEl.innerText = '' + fmtAmt(safeValue(stat.v));
if (cashEl) cashEl.innerText = '' + fmtAmt(safeValue(stat.cash));
if (creditEl) creditEl.innerText = '' + fmtAmt(safeValue(stat.credit));
if (profitEl) profitEl.innerText = '' + fmtAmt(safeValue(stat.profit));
};
updateStatDisplay('day', stats.day);
updateStatDisplay('week', stats.week);
updateStatDisplay('month', stats.month);
updateStatDisplay('year', stats.year);
updateStatDisplay('all', stats.all);
if (typeof setSalesSummaryMode === 'function') setSalesSummaryMode(currentSalesSummaryMode || 'day');
const histContainer = document.getElementById('custHistoryList');
if (totalItems === 0) {
histContainer.replaceChildren(Object.assign(document.createElement('p'), {textContent:'No sales found.',style:'text-align:center;color:var(--text-muted);width:100%;font-size:0.85rem'}));
} else {
const fragment = document.createDocumentFragment();
pageData.forEach(item => {
const isSelected = item.date === selectedDate;
const highlightClass = isSelected ? 'highlight-card' : '';
const dateDisplay = isSelected ? `${formatDisplayDate(item.date)} (Selected)` : formatDisplayDate(item.date);
const creditReceived = item.creditReceived || false;
const paymentType = item.paymentType || 'CASH';
const badgeClass = creditReceived ? 'received' : (paymentType ? paymentType.toLowerCase() : 'cash');
const badgeText = creditReceived ? 'RECEIVED' : paymentType;
const isOldDebtItem = item.transactionType === 'OLD_DEBT';
const isAdminCollItem = !((item.salesRep && item.salesRep !== 'NONE')) && paymentType === 'COLLECTION' && item.currentRepProfile === 'admin';
const supplyTagClass = item.supplyStore === 'STORE_A' ? 'store-a' :
item.supplyStore === 'STORE_B' ? 'store-b' : 'store-c';
const supplyTagText = item.supplyStore === 'STORE_A' ? 'ZUBAIR' :
item.supplyStore === 'STORE_B' ? 'MAHMOOD' : 'ASAAN';
let repBadge = '';
if (item.salesRep && item.salesRep !== 'NONE' && item.salesRep !== 'ADMIN') {
repBadge = `<span style="font-size:0.65rem; background:#e0e7ff; color:#3730a3; padding:2px 6px; border-radius:4px; margin-left:5px;"> ${esc(item.salesRep.split(' ')[0])}</span>`;
}
let mergedBadge = '';
if (item.isMerged) {
mergedBadge = _mergedBadgeHtml(item, {inline:true});
}
const card = document.createElement('div');
card.className = `card liquid-card ${highlightClass}${item.isSettled ? ' is-settled-record' : ''}`.trim();
if (item.date) card.setAttribute('data-date', item.date);
let creditSection = '';
if (!isOldDebtItem) {
if (paymentType === 'CREDIT' && !creditReceived) {
creditSection = `
<div class="credit-checkbox-container" onclick="(async () => { await toggleCustomerCreditReceived('${esc(item.id)}', event) })()">
<input type="checkbox" class="credit-checkbox" onclick="(async () => { await toggleCustomerCreditReceived(${item.id}, event); })()">
<label class="credit-checkbox-label">Mark as Received</label>
</div>
`;
} else if (paymentType === 'CREDIT' && creditReceived) {
creditSection = `<div class="received-indicator">Credit Received </div>`;
}
}
const deleteBtnHtml = item.isMerged ? '' : item.isSettled ? `<div class="settled-badge">✓ Settled</div>` : `<button class="tbl-action-btn danger u-w-full u-mt-8" onclick="(async () => { await deleteCustomerSale('${esc(item.id)}') })()">Delete</button>`;
if (isOldDebtItem) {
card.innerHTML = `
<div class="payment-badge credit">CREDIT</div>
<div class="customer-name" style="margin-top: 12px;">${esc(item.customerName)}
<span style="background:rgba(255,159,10,0.15);color:var(--warning);padding:2px 6px;border-radius:4px;font-size:0.65rem;margin-left:6px;font-weight:600;">OLD DEBT</span>${item.isMerged ? _mergedBadgeHtml(item, {inline:true}) : ''}${(typeof _creatorBadgeHtml === 'function') ? _creatorBadgeHtml(item) : ''}
</div>
<h4 style="margin-top: 5px; font-size: 0.85rem; color: var(--text-muted);">${dateDisplay}</h4>
<hr>
<p><span>Previous Balance:</span> <span class="rev-val">${fmtAmt(safeValue(item.totalValue))}</span></p>
<p class="u-fs-sm u-text-muted" >${esc(item.notes || 'Brought forward from previous records')}</p>
${deleteBtnHtml}
`;
} else if (isAdminCollItem) {
card.innerHTML = `
<div class="payment-badge collection" style="background:rgba(5,150,105,0.15);color:var(--accent-emerald);border:1px solid rgba(5,150,105,0.3);">COLLECTION</div>
<div class="customer-name" style="margin-top:12px;">${esc(item.customerName)} ${mergedBadge}${(typeof _creatorBadgeHtml === 'function') ? _creatorBadgeHtml(item) : ''}</div>
<h4 style="margin-top:5px;font-size:0.85rem;color:var(--text-muted);">${dateDisplay}</h4>
<hr>
<p><span>Amount Collected:</span> <span class="profit-val">${fmtAmt(safeValue(item.totalValue))}</span></p>
${deleteBtnHtml}
`;
} else {
card.innerHTML = `
<div class="payment-badge ${badgeClass}">${esc(badgeText)}</div>
<div class="customer-name" style="margin-top: 12px;">${esc(item.customerName)} ${repBadge} ${mergedBadge}${(typeof _creatorBadgeHtml === 'function') ? _creatorBadgeHtml(item) : ''}</div>
<h4 style="margin-top: 5px; font-size: 0.85rem; color: var(--text-muted);">${dateDisplay}</h4>
<div class="supply-tag ${supplyTagClass}">Supply: ${supplyTagText}</div>
<hr>
<p><span>Quantity:</span> <span class="qty-val">${safeValue(item.quantity).toFixed(2)} kg</span></p>
<p><span>Total Value:</span> <span class="rev-val">${fmtAmt(safeValue(item.totalValue))}</span></p>
<p><span>Net Profit:</span> <span class="profit-val">${fmtAmt(safeValue(item.profit))}</span></p>
${creditSection}
${deleteBtnHtml}
`;
}
fragment.appendChild(card);
});
histContainer.replaceChildren(fragment);
}
const _custDate = (document.getElementById('cust-date') || {}).value || new Date().toISOString().split('T')[0];
_filterHistoryByPeriod('#custHistoryList', _custDate, currentSalesSummaryMode || 'day');
renderCustomersTable();
updateCustomerCharts();
}
async function toggleCustomerCreditReceived(id, event) {
if (event) {
event.preventDefault();
event.stopPropagation();
}
const saleIndex = customerSales.findIndex(item => item.id === id);
if (saleIndex !== -1) {
customerSales[saleIndex].creditReceived = !customerSales[saleIndex].creditReceived;
if (customerSales[saleIndex].creditReceived) {
customerSales[saleIndex].paymentType = 'CASH';
}
customerSales[saleIndex].updatedAt = getTimestamp();
customerSales[saleIndex] = ensureRecordIntegrity(customerSales[saleIndex], true);
await unifiedSave('customer_sales', customerSales, customerSales[saleIndex]);
refreshCustomerSales();
updateCustomerCharts();
}
}
async function calculateComparisonData() {
const compMode = currentCompMode;
const selectedDate = document.getElementById('sale-date').value;
const selectedDateObj = new Date(selectedDate);
const selectedYear = selectedDateObj.getFullYear();
const selectedMonth = selectedDateObj.getMonth();
const selectedDay = selectedDateObj.getDate();
let history; history = await idb.get('noman_history', []);
const comp = {};
salesRepsList.forEach(rep => { comp[rep] = {prof:0, rev:0, sold:0, ret:0, exp:0, cred:0, cash:0, coll:0, giv:0, cost:0}; });
history.forEach(h => {
const hDate = new Date(h.date);
const hYear = hDate.getFullYear();
const hMonth = hDate.getMonth();
const hDay = hDate.getDate();
let includeInComp = false;
if (compMode === 'all') includeInComp = true;
else if (compMode === 'week') {
const weekStart = new Date(selectedDateObj);
weekStart.setDate(selectedDay - 6);
if(hDate >= weekStart && hDate <= selectedDateObj) includeInComp = true;
}
else if (compMode === 'month' && hYear === selectedYear && hMonth === selectedMonth) includeInComp = true;
else if (compMode === 'year' && hYear === selectedYear) includeInComp = true;
if(includeInComp && comp[h.seller]) {
comp[h.seller].prof += h.profit;
comp[h.seller].rev += h.revenue;
comp[h.seller].cost += (h.totalCost || 0);
comp[h.seller].sold += h.totalSold;
comp[h.seller].ret += h.returned;
comp[h.seller].exp += (h.expired || 0);
comp[h.seller].cred += h.creditQty;
comp[h.seller].cash += h.cashQty;
comp[h.seller].coll += h.prevColl;
comp[h.seller].giv += h.creditValue;
}
});
return comp;
}
function createReportHTML(title, data, isHistory = false, id = null, sellerName = null, isHighlight = false, isMerged = false) {
const creditVal = safeValue(data.creditVal);
const collected = safeValue(data.collected);
const balance = creditVal - collected;
const received = safeValue(data.received);
const expected = safeValue(data.expected);
const discrepancy = received - expected;
const balClass = balance > 0 ? 'balance-pos' : 'balance-neg';
let discClass = 'qty-val';
let discText = `${fmtAmt(Math.abs(discrepancy))}`;
if (Math.abs(discrepancy) < 0.01) {
discClass = 'units-available-good';
discText = "Perfect Match";
} else if (discrepancy < 0) {
discClass = 'cost-val';
discText = `SHORT: ${fmtAmt(Math.abs(discrepancy))}`;
} else {
discClass = 'profit-val';
discText = `OVER: ${fmtAmt(discrepancy)}`;
}
const displayStatusText = data.statusText || discText;
const displayStatusClass = data.statusClass || (Math.abs(discrepancy) < 0.01 ? 'result-box discrepancy-ok' : 'result-box discrepancy-alert');
const badge = sellerName ? `<span class="seller-badge ${salesRepsList.indexOf(sellerName) === 0 ? 'noran-badge' : 'noman-badge'}">${sellerName.split(' ')[0]}</span>` : '';
const mergedBadge = isMerged ? _mergedBadgeHtml({ isMerged: true, mergedRecordCount: data.mergedRecordCount, mergedSummary: data.mergedSummary }, {inline:true}) : '';
const highlightClass = isHighlight ? 'highlight-card' : '';
const dateAttr = (isHistory && data._rawDate) ? ` data-date="${data._rawDate}"` : '';
let html = `<div class="card liquid-card ${highlightClass}"${dateAttr}>${badge}<h4>${esc(title)}${mergedBadge}</h4>
<p><span>Total Sold:</span> <span class="qty-val">${safeValue(data.sold).toFixed(2)}</span></p>
<p><span>Returned:</span> <span class="qty-val">${safeValue(data.ret).toFixed(2)}</span></p>
${safeValue(data.expired) > 0 ? `<p><span>Expired (→ CHORA):</span> <span class="cost-val">${safeValue(data.expired).toFixed(2)}</span></p>` : ''}
<p><span>Cash Qty:</span> <span class="qty-val">${safeValue(data.cash).toFixed(2)}</span></p>
<p><span>Credit Qty:</span> <span class="qty-val">${safeValue(data.cred).toFixed(2)}</span></p>
<hr>
<p><span>Revenue:</span> <span class="rev-val">${fmtAmt(safeValue(data.revenue))}</span></p>
<p><span>Profit:</span> <span class="profit-val">${fmtAmt(safeValue(data.profit))}</span></p>
<p><span>Credit Out:</span> <span class="cost-val">${fmtAmt(creditVal)}</span></p>
<p><span>Credit In:</span> <span class="profit-val">${fmtAmt(collected)}</span></p>
<p><span>Net Debt:</span> <span class="${balClass}">${fmtAmt(balance)}</span></p>
<hr>
<p><span>Expected Cash:</span> <span class="qty-val" style="color:var(--text-main);">${fmtAmt(expected)}</span></p>
<p><span>Received Cash:</span> <span class="qty-val" style="font-weight:800; color:var(--text-main);">${safeNumber(received, 0).toFixed(2)}</span></p>
<p><span>Discrepancy:</span> <span class="${discClass}">${discText}</span></p>
`;
if (isHistory) {
html += `
<div style="padding: 8px; border-radius: 6px; text-align: center; margin-top: 8px; font-size: 10px;" class="${displayStatusClass}">${displayStatusText}</div>`;
if (!isMerged) {
html += `<button class="tbl-action-btn danger u-w-full u-mt-8" onclick="deleteSalesEntry('${id}')">Delete</button>`;
}
}
html += `</div>`;
return html;
}
function calculateTotalSoldForRepresentative(seller) {
if (!seller || seller === 'COMBINED') return 0;
const reconciledSalesIds = new Set();
if (Array.isArray(salesHistory)) {
  salesHistory.forEach(entry => {
    if (Array.isArray(entry.linkedSalesIds)) {
      entry.linkedSalesIds.forEach(id => reconciledSalesIds.add(id));
    }
  });
}
let totalSold = 0;
(Array.isArray(customerSales) ? customerSales : []).forEach(sale => {
  if (sale.currentRepProfile === 'admin' &&
      sale.customerName === seller &&
      sale.paymentType === 'CREDIT' &&
      !sale.creditReceived &&
      !reconciledSalesIds.has(sale.id) &&
      sale.transactionType !== 'OLD_DEBT') {
    totalSold += (sale.quantity || 0);
  }
});
return totalSold;
}
function autoFillTotalSoldQuantity() {
const seller = document.getElementById('sellerSelect').value;
const date = document.getElementById('sale-date').value;
const totalSoldField = document.getElementById('totalSold');
const creditSalesField = document.getElementById('creditSales');
const recoveredField = document.getElementById('prevCreditReceived');
if (!totalSoldField) return;
if (seller === 'COMBINED') {
totalSoldField.value = '';
totalSoldField.readOnly = true;
return;
}
const totalSold = calculateTotalSoldForRepresentative(seller);
totalSoldField.value = safeNumber(totalSold, 0).toFixed(2);
totalSoldField.readOnly = true;
totalSoldField.style.background = 'rgba(37, 99, 235, 0.1)';
totalSoldField.style.color = 'var(--accent)';
totalSoldField.style.fontWeight = 'bold';
totalSoldField.style.border = '1px solid var(--accent)';
const usedRepSaleIds = new Set();
if (Array.isArray(salesHistory)) {
  salesHistory.forEach(calcEntry => {
    if (calcEntry.linkedRepSalesIds && Array.isArray(calcEntry.linkedRepSalesIds)) {
      calcEntry.linkedRepSalesIds.forEach(id => usedRepSaleIds.add(id));
    }
  });
}
(Array.isArray(repSales) ? repSales : []).forEach(sale => {
  if (sale.usedInCalcId) usedRepSaleIds.add(sale.id);
});
let creditSalesKg = 0;
let recoveredCash = 0;
(Array.isArray(repSales) ? repSales : []).forEach(sale => {
  if (sale.salesRep === seller && sale.date === date && !usedRepSaleIds.has(sale.id)) {
    if (sale.paymentType === 'CREDIT') {
      creditSalesKg += (sale.quantity || 0);
    }
    if (sale.paymentType === 'COLLECTION') {
      recoveredCash += (sale.totalValue || 0);
    }
  }
});
if(creditSalesField) {
creditSalesField.value = safeNumber(creditSalesKg, 0).toFixed(2);
styleAutoFilledField(creditSalesField);
}
if(recoveredField) {
recoveredField.value = safeNumber(recoveredCash, 0).toFixed(2);
styleAutoFilledField(recoveredField);
}
calculateSales();
}
function styleAutoFilledField(field) {
field.style.background = 'rgba(5, 150, 105, 0.1)';
field.style.color = 'var(--accent-emerald)';
field.style.fontWeight = 'bold';
field.style.border = '1px solid var(--accent-emerald)';
}
async function loadSalesData(compMode = 'all') {
currentCompMode = compMode;
['week', 'month', 'year', 'all'].forEach(m => {
const btn = document.getElementById(`comp-${m}-btn`);
if(btn) btn.className = `toggle-opt ${m === compMode ? 'active' : ''}`;
});
const seller = document.getElementById('sellerSelect').value;
const searchDate = document.getElementById('sale-date').value;
autoFillTotalSoldQuantity();
const isCombined = seller === "COMBINED";
const label = isCombined ? "Combined" : seller;
const _setSel = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
_setSel('reportSellerName', label);
_setSel('debtSellerName', label);
_setSel('selectedSellerName', label);
const entrySection = document.getElementById('entrySection'); if (entrySection) entrySection.className = isCombined ? "hidden" : "";
const combinedSection = document.getElementById('combinedSection'); if (combinedSection) combinedSection.className = isCombined ? "" : "hidden";
const indChart = document.getElementById('individualChartSection'); if (indChart) indChart.className = isCombined ? "hidden" : "";
let history = await idb.get('noman_history', []);
if (!Array.isArray(history)) history = [];
let displayList = isCombined ? history : history.filter(h => h.seller === seller);
displayList.sort((a,b) => {
if (a.date === searchDate && b.date !== searchDate) return -1;
if (a.date !== searchDate && b.date === searchDate) return 1;
return b.timestamp - a.timestamp;
});
const ranges = {
d: { sold:0, ret:0, expired:0, cash:0, cred:0, creditVal:0, collected:0, profit:0, revenue:0, expected:0, received:0 },
w: { sold:0, ret:0, expired:0, cash:0, cred:0, creditVal:0, collected:0, profit:0, revenue:0, expected:0, received:0 },
m: { sold:0, ret:0, expired:0, cash:0, cred:0, creditVal:0, collected:0, profit:0, revenue:0, expected:0, received:0 },
y: { sold:0, ret:0, expired:0, cash:0, cred:0, creditVal:0, collected:0, profit:0, revenue:0, expected:0, received:0 },
a: { sold:0, ret:0, expired:0, cash:0, cred:0, creditVal:0, collected:0, profit:0, revenue:0, expected:0, received:0 }
};
const list = document.getElementById('historyList');
const _hlParts = [];
displayList.forEach(h => {
const isHighlight = h.date === searchDate;
const dateTitle = isHighlight ? `${formatDisplayDate(h.date)} (Selected)` : formatDisplayDate(h.date);
_hlParts.push(createReportHTML(
dateTitle,
{
sold: h.totalSold,
ret: h.returned,
expired: h.expired,
cash: h.cashQty,
cred: h.creditQty,
revenue: h.revenue,
profit: h.profit,
creditVal: h.creditValue,
collected: h.prevColl,
expected: h.totalExpected,
received: h.received,
statusClass: h.statusClass,
statusText: h.statusText,
_rawDate: h.date
},
true, h.id, isCombined ? h.seller : null, isHighlight, h.isMerged
));
});
list.innerHTML = _hlParts.join('');
const validSearchDate = searchDate || new Date().toISOString().split('T')[0];
const now = new Date(validSearchDate);
if (isNaN(now.getTime())) {
now.setTime(Date.now());
}
const weekStart = new Date(now);
weekStart.setDate(now.getDate() - 6);
let ltCr = 0, ltCl = 0;
const debtFilterList = isCombined ? history : history.filter(h => h.seller === seller);
debtFilterList.forEach(h => {
if (!h.date) return;
const hDate = new Date(h.date);
if (isNaN(hDate.getTime())) {
return;
}
ltCr += (h.creditValue || 0);
ltCl += (h.prevColl || 0);
if(h.date === searchDate) addToRange(ranges.d, h);
if(hDate >= weekStart && hDate <= now) addToRange(ranges.w, h);
if(hDate.getMonth() === now.getMonth() && hDate.getFullYear() === now.getFullYear()) addToRange(ranges.m, h);
if(hDate.getFullYear() === now.getFullYear()) addToRange(ranges.y, h);
addToRange(ranges.a, h);
});
document.getElementById('dailyReport').innerHTML = createReportHTML("Daily View", ranges.d);
document.getElementById('weeklyReport').innerHTML = createReportHTML("Weekly View", ranges.w);
document.getElementById('monthlyReport').innerHTML = createReportHTML("Monthly View", ranges.m);
document.getElementById('yearlyReport').innerHTML = createReportHTML("Yearly View", ranges.y);
document.getElementById('allTimeReport').innerHTML = createReportHTML("All Time Summary", ranges.a);
if (typeof setPerfOverviewMode === 'function') setPerfOverviewMode(currentPerfOverviewMode || 'day');
const _saleDate = (document.getElementById('sale-date') || {}).value || new Date().toISOString().split('T')[0];
_filterHistoryByPeriod('#historyList', _saleDate, currentPerfOverviewMode || 'day');
const _setLt = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
_setLt('ltCredit', "" + safeValue(ltCr).toFixed(2));
_setLt('ltCollected', "" + safeValue(ltCl).toFixed(2));
_setLt('ltBalance', "" + safeValue(ltCr - ltCl).toFixed(2));
if(isCombined) {
const comp = await calculateComparisonData();
updateSalesCharts(comp);
const repNames = salesRepsList;
const bestProfit = Math.max(...repNames.map(r => (comp[r]||{prof:0}).prof));
const compHead = document.getElementById('comparisonHead');
if (compHead) {
compHead.innerHTML = '<tr><th>Metric</th>' +
repNames.map(r => {
const isWinner = (comp[r]||{prof:0}).prof >= bestProfit && bestProfit > 0;
const firstName = r.split(' ')[0].charAt(0) + r.split(' ')[0].slice(1).toLowerCase();
return `<th id="th-rep-${r.replace(/\s+/g,'-')}">${firstName}</th>`;
}).join('') +
'</tr>';
}
const metrics = [
{ label: 'Qty Sold', key: 'sold', cls: null },
{ label: 'Returns', key: 'ret', cls: null },
{ label: 'Expired (→ CHORA)', key: 'exp', cls: 'cost-val' },
{ label: 'Total Cost', key: 'cost', cls: 'cost-val' },
{ label: 'Gross Revenue', key: 'rev', cls: 'rev-val' },
{ label: 'Net Profit', key: 'prof', cls: 'profit-val', winner: true },
{ label: 'Credit Issued', key: 'giv', cls: null },
{ label: 'Credit Recovered', key: 'coll', cls: null },
];
document.getElementById('comparisonBody').innerHTML = metrics.map(m => {
const cells = repNames.map(r => {
const val = fmtAmt(safeValue((comp[r]||{})[m.key]));
const style = m.key === 'cost' ? ' style="color:var(--danger)"' : m.key === 'coll' ? ' style="color:var(--accent)"' : '';
const cls = m.cls ? ` class="${m.cls}"` : '';
return `<td${cls}${style}>${val}</td>`;
}).join('');
const rowCls = m.winner ? ' class="winner-cell"' : '';
return `<tr${rowCls}><td>${m.label}</td>${cells}</tr>`;
}).join('');
} else {
await updateIndChart();
}
}
function addToRange(range, h) {
range.sold += h.totalSold;
range.ret += h.returned;
range.expired = (range.expired || 0) + (h.expired || 0);
range.cash += h.cashQty;
range.cred += h.creditQty;
range.creditVal += h.creditValue;
range.collected += h.prevColl;
range.profit += h.profit;
range.revenue += h.revenue;
range.expected += (h.totalExpected || 0);
range.received += (h.received || 0);
}
function updateSalesCharts(comp) {
if (typeof Chart === 'undefined') {
loadChartJs().then(() => updateSalesCharts(comp)).catch(() => {});
return;
}
if(!comp) return;
const selectedMetric = document.getElementById('metricSelector').value;
const metricLabel = document.getElementById('metricSelector').options[document.getElementById('metricSelector').selectedIndex].text;
const colors = {
text: '#1e3a8a',
grid: 'rgba(37, 99, 235, 0.1)'
};
const perfChartElement = document.getElementById('performanceChart');
if (!perfChartElement) {
return;
}
const perfCtx = perfChartElement.getContext('2d');
if (!perfCtx) {
return;
}
const repChartColors = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2'];
const repNames = salesRepsList;
const chartLabels = repNames.map(r => r.split(' ').map(w => w[0]+w.slice(1).toLowerCase()).join(' '));
const chartData = repNames.map(r => (comp[r] || {})[selectedMetric] || 0);
const chartColors = repNames.map((_, i) => repChartColors[i % repChartColors.length]);
if(salesPerfChart) salesPerfChart.destroy();
salesPerfChart = new Chart(perfCtx, {
type: 'bar',
data: {
labels: chartLabels,
datasets: [{
label: metricLabel,
data: chartData,
backgroundColor: chartColors,
borderRadius: 6
}]
},
options: {
responsive: true,
maintainAspectRatio: false,
plugins: { legend: { display: false } },
scales: {
y: { beginAtZero: true, grid: { color: colors.grid }, ticks: { color: colors.text } },
x: { ticks: { color: colors.text } }
}
}
});
const totalCashValue = repNames.reduce((s, r) => s + ((comp[r]||{}).rev||0) - ((comp[r]||{}).giv||0), 0);
const totalCreditValue = repNames.reduce((s, r) => s + ((comp[r]||{}).giv||0), 0);
const totalSold = repNames.reduce((s, r) => s + ((comp[r]||{}).sold||0), 0);
const totalReturned = repNames.reduce((s, r) => s + ((comp[r]||{}).ret||0), 0);
const totalRevenue = repNames.reduce((s, r) => s + ((comp[r]||{}).rev||0), 0);
const avgPrice = totalSold > 0 ? totalRevenue / totalSold : 0;
const totalReturnValue = totalReturned * avgPrice;
const pieData = [totalCashValue, totalCreditValue, totalReturnValue];
const pieLabels = ['Cash Sale Value', 'Credit Value', 'Return Value'];
const compChartElement = document.getElementById('compositionChart');
if (!compChartElement) {
return;
}
const compCtx = compChartElement.getContext('2d');
if (!compCtx) {
return;
}
if(salesCompChart) salesCompChart.destroy();
salesCompChart = new Chart(compCtx, {
type: 'pie',
data: {
labels: pieLabels,
datasets: [{
data: pieData,
backgroundColor: ['#059669', '#f59e0b', '#dc2626'],
borderWidth: 0,
hoverOffset: 8
}]
},
options: {
responsive: true,
maintainAspectRatio: true,
plugins: {
legend: { position: 'bottom', labels: { color: colors.text, boxWidth: 12, font: { size: 10 } } },
title: {
display: true,
text: compositionChartShowPercentage ?
'Market Composition (Percentage)' :
'Market Composition',
color: colors.text,
font: { size: 13, weight: 'bold' }
},
tooltip: {
callbacks: {
label: function(context) {
if (compositionChartShowPercentage) {
const total = context.dataset.data.reduce((a, b) => a + b, 0);
const percentage = total > 0 ? safeNumber((context.parsed / total) * 100, 0).toFixed(2) : 0;
return `${context.label}: ${percentage}%`;
} else {
return `${context.label}: ${fmtAmt(safeNumber(context.parsed, 0))}`;
}
}
}
}
}
}
});
if (compositionChartShowPercentage) {
updateCompositionChart();
}
}
async function processReturnToProduction(storeKey, quantity, date, seller) {
const now = new Date();
let hours = now.getHours();
const minutes = now.getMinutes();
const seconds = now.getSeconds();
const ampm = hours >= 12 ? 'PM' : 'AM';
hours = hours % 12;
hours = hours ? hours : 12;
const timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')} ${ampm}`;
const formulaStore = storeKey === 'STORE_C' ? 'asaan' : 'standard';
const salePrice = getSalePriceForStore(storeKey);
const costPerKg = getCostPriceForStore(storeKey);
const totalCost = quantity * costPerKg;
const totalSale = quantity * salePrice;
const profit = totalSale - totalCost;
const retCreatedAt = Date.now();
let _retId = generateUUID('ret');
if (!validateUUID(_retId)) _retId = generateUUID('ret');
let returnEntry = {
id: _retId,
date: date,
time: timeString,
store: storeKey,
net: quantity,
cp: costPerKg,
sp: salePrice,
totalCost: totalCost,
totalSale: totalSale,
profit: profit,
formulaUnits: 0,
formulaStore: formulaStore,
formulaCost: 0,
paymentStatus: 'CASH',
createdAt: retCreatedAt,
updatedAt: retCreatedAt,
timestamp: retCreatedAt,
isReturn: true,
returnedBy: seller,
returnNote: `Returned by ${seller}`,
syncedAt: new Date().toISOString()
};
returnEntry = ensureRecordIntegrity(returnEntry, false);
db.push(returnEntry);
await unifiedSave('mfg_pro_pkr', db, returnEntry);
let _retLogId = generateUUID('retlog');
if (!validateUUID(_retLogId)) _retLogId = generateUUID('retlog');
let returnLogEntry = {
id: _retLogId,
date: date,
time: timeString,
store: storeKey,
quantity: quantity,
seller: seller,
createdAt: retCreatedAt,
updatedAt: retCreatedAt,
timestamp: retCreatedAt,
syncedAt: new Date().toISOString()
};
returnLogEntry = ensureRecordIntegrity(returnLogEntry, false);
stockReturns.push(returnLogEntry);
await unifiedSave('stock_returns', stockReturns, returnLogEntry);
}
async function reverseReturnFromProduction(storeKey, quantity, date) {
const returnEntry = db.find(item =>
item.store === storeKey &&
item.net === quantity &&
item.date === date &&
item.isReturn === true
);
if (returnEntry) {
db = db.filter(item => item.id !== returnEntry.id);
await unifiedDelete('mfg_pro_pkr', db, returnEntry.id, { strict: true }, returnEntry);
}
const returnLogEntry = stockReturns.find(r =>
r.store === storeKey &&
r.quantity === quantity &&
r.date === date
);
if (returnLogEntry) {
stockReturns = stockReturns.filter(r => r.id !== returnLogEntry.id);
await unifiedDelete('stock_returns', stockReturns, returnLogEntry.id, { strict: true }, returnLogEntry);
}
}
const CHORA_MATERIAL_NAME = 'CHORA';
async function processExpiredToChora(quantity, date, seller) {
if (!quantity || quantity <= 0) return;
let choraMaterial = factoryInventoryData.find(m => m.name && m.name.toUpperCase() === CHORA_MATERIAL_NAME);
if (!choraMaterial) {
const reloadedData = await idb.get('factory_inventory_data', []);
if (Array.isArray(reloadedData)) {
factoryInventoryData = reloadedData;
choraMaterial = factoryInventoryData.find(m => m.name && m.name.toUpperCase() === CHORA_MATERIAL_NAME);
}
}
if (!choraMaterial) {
showToast(`⚠ CHORA material not found in factory inventory. Expired qty (${quantity}) was recorded but not added to raw materials.`, 'warning', 5000);
return;
}
choraMaterial.quantity = (choraMaterial.quantity || 0) + quantity;
choraMaterial.totalValue = choraMaterial.quantity * (choraMaterial.cost || 0);
choraMaterial.updatedAt = getTimestamp();
choraMaterial.lastExpiredAddedAt = date;
choraMaterial.lastExpiredAddedBy = seller;
ensureRecordIntegrity(choraMaterial, true);
await unifiedSave('factory_inventory_data', factoryInventoryData, choraMaterial);
emitSyncUpdate({ factory_inventory_data: factoryInventoryData });
notifyDataChange('factory');
}
async function reverseExpiredFromChora(quantity, date) {
if (!quantity || quantity <= 0) return;
let choraMaterial = factoryInventoryData.find(m => m.name && m.name.toUpperCase() === CHORA_MATERIAL_NAME);
if (!choraMaterial) {
const reloadedData = await idb.get('factory_inventory_data', []);
if (Array.isArray(reloadedData)) {
factoryInventoryData = reloadedData;
choraMaterial = factoryInventoryData.find(m => m.name && m.name.toUpperCase() === CHORA_MATERIAL_NAME);
}
}
if (!choraMaterial) {
showToast(`⚠ CHORA material not found. Could not reverse expired qty (${quantity}).`, 'warning', 5000);
return;
}
choraMaterial.quantity = Math.max(0, (choraMaterial.quantity || 0) - quantity);
choraMaterial.totalValue = choraMaterial.quantity * (choraMaterial.cost || 0);
choraMaterial.updatedAt = getTimestamp();
ensureRecordIntegrity(choraMaterial, true);
await unifiedSave('factory_inventory_data', factoryInventoryData, choraMaterial);
emitSyncUpdate({ factory_inventory_data: factoryInventoryData });
notifyDataChange('factory');
}
async function formatCurrency(num) {
if (typeof num !== 'number') num = parseFloat(num) || 0;
if (isNaN(num) || !isFinite(num)) num = 0;
return String(num.toFixed(2));
}
function safeValue(value) {
return isNaN(value) || !isFinite(value) ? 0 : value;
}
async function refreshAllDisplays() {
try {
await syncFactoryProductionStats();
} catch (error) {
console.error('Display refresh failed.', _safeErr(error));
showToast('Display refresh failed.', 'error');
}
try {
if (typeof refreshUI === 'function') await refreshUI(1, true);
} catch (error) {
console.error('Display refresh failed.', _safeErr(error));
showToast('Display refresh failed.', 'error');
}
try {
if (typeof refreshCustomerSales === 'function') await refreshCustomerSales(1, true);
else if (typeof renderCustomersTable === 'function') renderCustomersTable();
} catch (error) {
console.error('Display refresh failed.', _safeErr(error));
showToast('Display refresh failed.', 'error');
}
try {
if (typeof loadSalesData === 'function') await loadSalesData(currentCompMode);
} catch (error) {
console.error('Display refresh failed.', _safeErr(error));
showToast('Display refresh failed.', 'error');
}
try {
if (typeof initFactoryTab === 'function') initFactoryTab();
} catch (error) {
console.error('Display refresh failed.', _safeErr(error));
showToast('Display refresh failed.', 'error');
}
try {
if (document.getElementById('tab-payments') && !document.getElementById('tab-payments').classList.contains('hidden')) {
if (typeof refreshPaymentTab === 'function') await refreshPaymentTab();
}
} catch (error) {
console.error('Payment tab refresh failed.', _safeErr(error));
showToast('Payment tab refresh failed.', 'error');
}
try {
if (typeof calculateNetCash === 'function') calculateNetCash();
} catch (error) {
console.error('Payment tab refresh failed.', _safeErr(error));
showToast('Payment tab refresh failed.', 'error');
}
try {
if (appMode === 'rep') {
if (typeof renderRepHistory === 'function') renderRepHistory();
if (typeof renderRepCustomerTable === 'function') renderRepCustomerTable();
}
} catch (error) {
console.error('Payment tab refresh failed.', _safeErr(error));
showToast('Payment tab refresh failed.', 'error');
}
}
document.addEventListener('DOMContentLoaded', async function _appBootstrap() {
  const urlParams = new URLSearchParams(window.location.search);
  const _action = urlParams.get('action');
  if (_action) {
    const _tabMap = { sales: 'sales', production: 'prod', calc: 'calc' };
    const _targetTab = _tabMap[_action];
    if (_targetTab) {
      let _attempts = 0;
      const _tryShowTab = () => {
        if (typeof showTab === 'function') { showTab(_targetTab); }
        else if (_attempts++ < 40) setTimeout(_tryShowTab, 100);
      };
      setTimeout(_tryShowTab, 200);
    }
  }
  updateOfflineBanner();
  updateConnectionStatus();
  const expenseNameInput = document.getElementById('expenseName');
  if (expenseNameInput) {
    expenseNameInput.addEventListener('blur', function() {
      setTimeout(() => {
        const rd = document.getElementById('expense-search-results');
        if (rd) rd.classList.add('hidden');
      }, 200);
    });
  }
  const repAmtCollected = document.getElementById('rep-amount-collected');
  if (repAmtCollected) {
    repAmtCollected.addEventListener('input', function() {
      const _credEl2 = document.getElementById('rep-customer-current-credit');
      const currentDebt = parseFloat(_credEl2 ? _credEl2.innerText.replace('','') : '0') || 0;
      const inputAmt = parseFloat(this.value) || 0;
      const _repTVL = document.getElementById('rep-total-value');
      if (_repTVL) _repTVL.innerText = "" + fmtAmt(safeNumber(currentDebt - inputAmt, 0));
    });
  }
  if (typeof ThemeManager !== 'undefined' && ThemeManager.init) ThemeManager.init();
  await initTheme();
  const hasFirebaseSession = await _checkFirebaseSessionExists();
  if (!hasFirebaseSession) {
    createAuthOverlay();
    showAuthOverlay();
  } else {
    try {
      let loginData = await IDBCrypto.sessionGet('login');
      if (!loginData || !loginData.uid) {
        const lsLogin = localStorage.getItem('persistentLogin');
        if (lsLogin) { try { loginData = JSON.parse(lsLogin); } catch(e) {} }
      }
      if (loginData && loginData.uid) {
        idb.setUserPrefix(loginData.uid);
        await IDBCrypto.initialize();
        const keyRestored = await IDBCrypto.restoreSessionKeyFromStorage();
        if (!keyRestored) {
          console.warn('Session: could not restore encryption key from storage, waiting for Firebase auth');
        }
      }
    } catch(e) {
      console.warn('Session pre-warm failed:', e);
    }
  }
  try {
    await loadAllData();
    await initializeDeviceListeners();
    if (typeof OfflineQueue !== 'undefined') await OfflineQueue.init();
    loadFirestoreStats();
  } catch (e) {
    showToast('Failed to initialize database. Please refresh the page.', 'error', 5000);
    return;
  }
  await enforceRepModeLock();
  preventAdminAccess();
  await checkBiometricLock();
  const cloudMenuBtn = document.getElementById('cloudMenuBtn');
  if (cloudMenuBtn) cloudMenuBtn.style.display = (appMode === 'admin') ? '' : 'none';
  updateSyncButton();
  setTimeout(() => {
    if (typeof initializeFirebaseSystem === 'function') initializeFirebaseSystem();
    else if (typeof initFirebase === 'function') initFirebase();
  }, 100);
  const today = new Date().toISOString().split('T')[0];
  ['sys-date','sale-date','cust-date','factory-date','paymentDate','rep-date'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = today;
  });
  currentFactoryDate = today;
  if (await idb.get('bio_enabled') === 'true') {
    const bioBtn = document.getElementById('bio-toggle-btn');
    if (bioBtn) {
      bioBtn.innerText = 'Disable Biometric Lock';
      bioBtn.onclick = disableBiometricLock;
      bioBtn.classList.add('active');
    }
  }
  const factoryDateEl = document.getElementById('factory-date');
  if (factoryDateEl) {
    factoryDateEl.addEventListener('change', function() {
      currentFactoryDate = this.value;
      updateFactorySummaryCard();
    });
  }
  const sellerSelect = document.getElementById('sellerSelect');
  const saleDate2 = document.getElementById('sale-date');
  if (sellerSelect) sellerSelect.addEventListener('change', autoFillTotalSoldQuantity);
  if (saleDate2) saleDate2.addEventListener('change', autoFillTotalSoldQuantity);
  const storeSelector = document.getElementById('storeSelector');
  if (storeSelector) storeSelector.addEventListener('change', updateProductionCostOnStoreChange);
  initSplashScreen();
  setProductionView('store');
  requestAnimationFrame(async () => {
    syncFactoryProductionStats();
    updateAllTabsWithFactoryCosts();
    await refreshAllDisplays();
  if (appMode === 'rep') {
    if (typeof renderRepHistory === 'function') renderRepHistory();
    if (typeof renderRepCustomerTable === 'function') renderRepCustomerTable();
  }
  loadSalesRepsList();
  setTimeout(() => {
    if (typeof generateUUID === 'function') {
      const saleIdEl = document.getElementById('new-sale-id-display');
      if (saleIdEl) { const id = generateUUID('sale'); saleIdEl.textContent = 'ID: ' + id.split('-').slice(0,2).join('-') + '\u2026'; saleIdEl.title = id; }
      const expIdEl = document.getElementById('expense-id-display');
      if (expIdEl) { const id2 = generateUUID('exp'); expIdEl.textContent = 'ID: ' + id2.split('-').slice(0,2).join('-') + '\u2026'; expIdEl.title = id2; }
    }
  }, 400);
  });
  scheduleAutomaticCleanup();
  setTimeout(() => validateAllDataOnStartup(), 5000);
  if (window._connectionCheckInterval) clearInterval(window._connectionCheckInterval);
  window._connectionCheckInterval = setInterval(() => {
    if (isConnectionStale()) {
      if (firebaseDB && currentUser && !isReconnecting) scheduleListenerReconnect();
    }
  }, 120000);
  if (window._perfMonitorInterval) clearInterval(window._perfMonitorInterval);
  window._perfMonitorInterval = setInterval(() => {
    if (typeof PerformanceMonitor !== 'undefined') PerformanceMonitor.report();
  }, 60000);
  setTimeout(() => {
    const splash = document.getElementById('splash-screen');
    if (splash) splash.style.display = 'none';
  }, 800);
});
function _filterFactoryHistoryByMode(mode) {
const selectedDateVal = (document.getElementById('factory-date') || {}).value || new Date().toISOString().split('T')[0];
const selectedDate = new Date(selectedDateVal);
if (isNaN(selectedDate.getTime())) return;
const weekStart = new Date(selectedDate);
weekStart.setDate(selectedDate.getDate() - 6);
document.querySelectorAll('#factoryHistoryList .factory-history-item').forEach(item => {
const ds = item.getAttribute('data-date');
if (!ds) { item.style.display = ''; return; }
const cd = new Date(ds);
if (isNaN(cd.getTime())) { item.style.display = ''; return; }
let show = false;
if (mode === 'daily') show = (ds === selectedDateVal);
else if (mode === 'weekly') show = (cd >= weekStart && cd <= selectedDate);
else if (mode === 'monthly') show = (cd.getMonth() === selectedDate.getMonth() && cd.getFullYear() === selectedDate.getFullYear());
else if (mode === 'yearly') show = (cd.getFullYear() === selectedDate.getFullYear());
else show = true;
item.style.display = show ? '' : 'none';
});
}
function _filterPaymentHistoryByPeriod() {
const periodFilterEl = document.getElementById('unifiedPeriodFilter');
const period = periodFilterEl ? periodFilterEl.value : 'all';
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
let startDate = new Date(0);
if (period === 'today') startDate = today;
else if (period === 'week') { startDate = new Date(today); startDate.setDate(today.getDate() - 7); }
else if (period === 'month') { startDate = new Date(today); startDate.setDate(today.getDate() - 30); }
document.querySelectorAll('#paymentHistoryList .card').forEach(card => {
const ds = card.getAttribute('data-date');
if (!ds) { card.style.display = ''; return; }
const cd = new Date(ds);
if (isNaN(cd.getTime())) { card.style.display = ''; return; }
card.style.display = (cd >= startDate) ? '' : 'none';
});
}
function _filterHistoryByPeriod(listSelector, refDateStr, mode) {
const refDate = new Date(refDateStr);
if (isNaN(refDate.getTime())) return;
const weekStart = new Date(refDate);
weekStart.setDate(refDate.getDate() - 6);
document.querySelectorAll(listSelector + ' .card').forEach(card => {
const ds = card.getAttribute('data-date');
if (!ds) { card.style.display = ''; return; }
const cd = new Date(ds);
if (isNaN(cd.getTime())) { card.style.display = ''; return; }
let show = false;
if (mode === 'day') show = (ds === refDateStr);
else if (mode === 'week') show = (cd >= weekStart && cd <= refDate);
else if (mode === 'month') show = (cd.getMonth() === refDate.getMonth() && cd.getFullYear() === refDate.getFullYear());
else if (mode === 'year') show = (cd.getFullYear() === refDate.getFullYear());
else show = true;
card.style.display = show ? '' : 'none';
});
}
let currentSalesSummaryMode = 'day';
function setSalesSummaryMode(mode) {
currentSalesSummaryMode = mode;
const labels = { day:'Daily', week:'Weekly', month:'Monthly', year:'Yearly', all:'All Time' };
const prefixes = ['day','week','month','year','all'];
prefixes.forEach(p => {
const btn = document.getElementById(`ss-${p}-btn`);
if (btn) btn.className = 'toggle-opt' + (p === mode ? ' active' : '');
});
const titleEl = document.getElementById('sales-summary-title');
const qtyEl = document.getElementById('cust-active-qty');
const valueEl = document.getElementById('cust-active-value');
const cashEl = document.getElementById('cust-active-cash');
const creditEl = document.getElementById('cust-active-credit');
const profitEl = document.getElementById('cust-active-profit');
if (titleEl) titleEl.textContent = `${labels[mode]} Sales`;
if (qtyEl) qtyEl.textContent = (document.getElementById(`cust-${mode}-qty`) ?.textContent || '0.00 kg');
if (valueEl) valueEl.textContent = (document.getElementById(`cust-${mode}-value`) ?.textContent || '0.00');
if (cashEl) cashEl.textContent = (document.getElementById(`cust-${mode}-cash`) ?.textContent || '0.00');
if (creditEl) creditEl.textContent = (document.getElementById(`cust-${mode}-credit`)?.textContent || '0.00');
if (profitEl) profitEl.textContent = (document.getElementById(`cust-${mode}-profit`)?.textContent || '0.00');
const card = document.getElementById('sales-summary-card');
if (card) {
if (mode === 'all') card.classList.add('all-times-summary');
else card.classList.remove('all-times-summary');
}
const refDate = (document.getElementById('cust-date') || {}).value || new Date().toISOString().split('T')[0];
_filterHistoryByPeriod('#custHistoryList', refDate, mode);
}
let currentPerfOverviewMode = 'day';
function setPerfOverviewMode(mode) {
currentPerfOverviewMode = mode;
const prefixes = ['day','week','month','year','all'];
prefixes.forEach(p => {
const btn = document.getElementById(`po-${p}-btn`);
if (btn) btn.className = 'toggle-opt' + (p === mode ? ' active' : '');
});
const ghostMap = { day:'dailyReport', week:'weeklyReport', month:'monthlyReport', year:'yearlyReport', all:'allTimeReport' };
const ghostEl = document.getElementById(ghostMap[mode]);
const activeEl = document.getElementById('activeReport');
if (activeEl && ghostEl) activeEl.innerHTML = ghostEl.innerHTML;
const refDate = (document.getElementById('sale-date') || {}).value || new Date().toISOString().split('T')[0];
_filterHistoryByPeriod('#historyList', refDate, mode);
}
function setOverviewMode(mode) {
currentOverviewMode = mode;
const buttons = ['day', 'week', 'month', 'year', 'all'];
buttons.forEach(btnMode => {
const btn = document.getElementById(`overview-${btnMode}-btn`);
if (btn) {
if (btnMode === mode) btn.classList.add('active');
else btn.classList.remove('active');
}
});
updateAllStoresOverview(mode);
refreshUI();
}
async function deleteSalesEntry(id) {
if (!id || !validateUUID(id)) {
showToast('Invalid sales entry ID', 'error');
return;
}
try {
let history; history = await idb.get('noman_history', []);
const entryToDelete = history.find(h => h.id === id);
if (entryToDelete && entryToDelete.isMerged) {
showToast('Merged opening balance records cannot be deleted', 'warning');
return;
}
if (entryToDelete) {
const linkedCount = entryToDelete.linkedSalesIds ? entryToDelete.linkedSalesIds.length : 0;
const linkedRepCount = entryToDelete.linkedRepSalesIds ? entryToDelete.linkedRepSalesIds.length : 0;
let confirmMsg = `Permanently delete this sales settlement record?`;
confirmMsg += `\n\nSeller: ${entryToDelete.seller}`;
confirmMsg += `\nDate: ${entryToDelete.date}`;
confirmMsg += `\nTotal Sold: ${entryToDelete.sold || 0} kg`;
confirmMsg += `\nCash Received: ${(entryToDelete.received||0)}`;
if (entryToDelete.credit) confirmMsg += `\nCredit Recovered: ${entryToDelete.credit}`;
const _dsHasImpact = linkedCount > 0 || linkedRepCount > 0 || (entryToDelete.returned > 0 && entryToDelete.returnStore) || entryToDelete.expired > 0;
if (_dsHasImpact) {
confirmMsg += `\n\n⚠ The following cascading changes will occur:`;
if (linkedCount > 0) confirmMsg += `\n • ${linkedCount} linked sale${linkedCount !== 1 ? 's' : ''} will REVERT to "Pending Credit" status.`;
if (linkedRepCount > 0) confirmMsg += `\n • ${linkedRepCount} rep sale${linkedRepCount !== 1 ? 's' : ''} will be RESTORED to calculator fields.`;
if (entryToDelete.returned > 0 && entryToDelete.returnStore) confirmMsg += `\n • ${entryToDelete.returned} kg will be REMOVED from ${getStoreLabel(entryToDelete.returnStore)} inventory (return reversal).`;
if (entryToDelete.expired > 0) confirmMsg += `\n • ${entryToDelete.expired} kg will be REMOVED from CHORA raw material (expired reversal).`;
}
if (await showGlassConfirm(confirmMsg, { title: `Delete ${entryToDelete.seller || "Sales"} Record`, confirmText: "Delete", danger: true })) {
let revertedSalesCount = 0;
let revertedRepSalesCount = 0;
let reversedReturnQty = 0;
if (entryToDelete.linkedSalesIds && entryToDelete.linkedSalesIds.length > 0) {
revertedSalesCount = await revertSpecificSalesEntries(entryToDelete.linkedSalesIds);
}
if (entryToDelete.linkedRepSalesIds && entryToDelete.linkedRepSalesIds.length > 0) {
revertedRepSalesCount = await revertRepSalesEntries(entryToDelete.linkedRepSalesIds);
}
if (entryToDelete.returned > 0 && entryToDelete.returnStore) {
reversedReturnQty = entryToDelete.returned;
await reverseReturnFromProduction(entryToDelete.returnStore, entryToDelete.returned, entryToDelete.date);
}
if (entryToDelete.expired > 0) {
await reverseExpiredFromChora(entryToDelete.expired, entryToDelete.date);
}
const newHistory = history.filter(h => h.id !== id);
await unifiedDelete('noman_history', newHistory, id, { strict: true }, entryToDelete);
if (Array.isArray(salesHistory)) {
const idx = salesHistory.findIndex(h => h.id === id);
if (idx !== -1) salesHistory.splice(idx, 1);
}
refreshAllCalculations();
await loadSalesData(currentCompMode);
await refreshCustomerSales();
if (typeof refreshUI === 'function') await refreshUI();
if (entryToDelete.expired > 0) {
if (typeof renderFactoryInventory === 'function') renderFactoryInventory();
}
updateAllStoresOverview(currentOverviewMode);
notifyDataChange('calculator');
let successMsg = ' Record deleted successfully!';
if (revertedSalesCount > 0) {
successMsg += ` ${revertedSalesCount} sales reverted to pending credit.`;
}
if (revertedRepSalesCount > 0) {
successMsg += ` ${revertedRepSalesCount} rep sales restored to calculator fields.`;
}
if (reversedReturnQty > 0) {
successMsg += ` ${reversedReturnQty} kg return removed from inventory.`;
}
if (entryToDelete.expired > 0) {
successMsg += ` ${entryToDelete.expired} kg expired removed from CHORA.`;
}
showToast(successMsg, 'success');
}
} else {
showToast("Error: Record not found.", "error");
}
} catch (error) {
showToast("Failed to delete entry. Please try again.", "error");
}
}
async function revertSpecificSalesEntries(saleIds) {
if (!saleIds || saleIds.length === 0) return 0;
let revertedCount = 0;
saleIds.forEach(saleId => {
const saleIndex = customerSales.findIndex(s => s.id === saleId);
if (saleIndex !== -1) {
const sale = customerSales[saleIndex];
sale.creditReceived = false;
sale.paymentType = 'CREDIT';
delete sale.creditReceivedDate;
delete sale.creditReceivedTime;
sale.updatedAt = getTimestamp();
ensureRecordIntegrity(sale, true);
revertedCount++;
}
});
if (revertedCount > 0) {
await saveWithTracking('customer_sales', customerSales, null, saleIds);
const revertedSales = customerSales.filter(s => saleIds.includes(s.id));
for (const sale of revertedSales) {
await saveRecordToFirestore('customer_sales', sale);
}
if (typeof refreshCustomerSales === 'function') {
refreshCustomerSales(1, true);
}
notifyDataChange('sales');
triggerAutoSync();
}
return revertedCount;
}
let entityViewMode = 'detailed';
function toggleEntityViewMode() {
const toggleBtn = document.getElementById('entityViewModeToggle');
const entityGrid = document.getElementById('entityCardsGrid');
if (entityViewMode === 'detailed') {
entityViewMode = 'compact';
entityGrid.classList.add('compact');
toggleBtn.title = "Switch to Detailed View";
toggleBtn.textContent = '';
} else {
entityViewMode = 'detailed';
entityGrid.classList.remove('compact');
toggleBtn.title = "Switch to Compact View";
toggleBtn.textContent = '';
}
renderEntityTable();
}
function calculateEntityBalances() {
const supplierIdSet = new Set();
if (typeof factoryInventoryData !== 'undefined') {
factoryInventoryData.forEach(m => {
if (m.supplierId) supplierIdSet.add(String(m.supplierId));
});
}
const balances = {};
paymentEntities.forEach(entity => {
if (entity.isExpenseEntity === true) return;
balances[entity.id] = 0;
});
if (typeof factoryInventoryData !== 'undefined') {
factoryInventoryData.forEach(material => {
if (material.supplierId && material.paymentStatus === 'pending' && material.totalPayable > 0) {
const sid = String(material.supplierId);
for (const entityId in balances) {
if (String(entityId) === sid) {
balances[entityId] += parseFloat(material.totalPayable) || 0;
break;
}
}
}
});
}
if (typeof paymentTransactions !== 'undefined') {
paymentTransactions.forEach(transaction => {
if (transaction.isExpense === true) return;
if (supplierIdSet.has(String(transaction.entityId))) return;
if (balances[transaction.entityId] !== undefined) {
if (transaction.type === 'OUT') {
balances[transaction.entityId] -= parseFloat(transaction.amount) || 0;
} else if (transaction.type === 'IN') {
balances[transaction.entityId] += parseFloat(transaction.amount) || 0;
}
}
});
}
return balances;
}
function getDynamicRole(balance) {
if (balance > 0.01) {
return {
label: 'Payable',
icon: '',
colorClass: 'entity-balance-negative',
badgeColor: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
sign: '+'
};
} else if (balance < -0.01) {
return {
label: 'Receivable',
icon: '',
colorClass: 'entity-balance-positive',
badgeColor: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
sign: ''
};
} else {
return {
label: 'Settled',
icon: '',
colorClass: 'entity-balance-neutral',
badgeColor: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
sign: ''
};
}
}
function filterEntityCards() {
const searchTerm = document.getElementById('entity-list-search').value.toLowerCase().trim();
const entityCards = document.querySelectorAll('#entityCardsGrid .entity-card-compact');
if (!searchTerm) {
entityCards.forEach(card => card.style.display = '');
return;
}
entityCards.forEach(card => {
const entityName = card.querySelector('.entity-name').textContent.toLowerCase();
const entityType = card.querySelector('.entity-type-badge').textContent.toLowerCase();
const entityPhone = card.querySelector('.entity-contact')?.textContent?.toLowerCase() || '';
const cardText = (entityName + ' ' + entityType + ' ' + entityPhone).toLowerCase();
if (cardText.includes(searchTerm)) {
card.style.display = '';
} else {
card.style.display = 'none';
}
});
}
function openEntityManagement() {
editingEntityId = null;
document.getElementById('entityName').value = '';
document.getElementById('entityPhone').value = '';
document.getElementById('entityWallet').value = '';
const _entMT1 = document.getElementById('entityManagementModalTitle'); if (_entMT1) _entMT1.innerText = 'Add New Entity';
requestAnimationFrame(() => {
document.body.style.overflow = 'hidden';
document.documentElement.style.overflow = 'hidden';
document.getElementById('entityManagementOverlay').style.display = 'flex';
});
}
function closeEntityManagement() {
requestAnimationFrame(() => {
document.body.style.overflow = '';
document.documentElement.style.overflow = '';
const _entMOClose = document.getElementById('entityManagementOverlay');
if (_entMOClose) { _entMOClose.style.display = 'none'; _entMOClose.style.zIndex = ''; }
const detailsOverlay = document.getElementById('entityDetailsOverlay');
if (detailsOverlay && detailsOverlay.style.display === 'flex' && currentEntityId) {
const entity = paymentEntities.find(e => String(e.id) === String(currentEntityId));
if (entity) renderEntityOverlayContent(entity);
}
});
}
async function saveEntity() {
const name = document.getElementById('entityName').value.trim();
const phone = document.getElementById('entityPhone').value.trim();
const wallet = document.getElementById('entityWallet').value.trim();
const existingEntity = editingEntityId ? paymentEntities.find(e => String(e.id) === String(editingEntityId)) : null;
const entityTxs = existingEntity
? paymentTransactions.filter(t => String(t.entityId) === String(existingEntity.id))
: [];
const hasIN = entityTxs.some(t => t.type === 'IN');
const hasOUT = entityTxs.some(t => t.type === 'OUT');
const type = (hasIN && !hasOUT) ? 'payor' : 'payee';
if (!name) {
showToast("Please enter an entity name", "warning");
return;
}
const exists = paymentEntities.some(e => e && e.name && e.name.toLowerCase() === name.toLowerCase() && e.id !== editingEntityId);
if(exists) {
showToast("An entity with this name already exists", "warning");
return;
}
try {
if (editingEntityId) {
const index = paymentEntities.findIndex(e => e.id === editingEntityId);
if (index !== -1) {
paymentEntities[index] = ensureRecordIntegrity({
...paymentEntities[index],
name,
type,
phone,
wallet,
updatedAt: getTimestamp()
}, true);
showToast("Entity updated successfully", "success");
}
} else {
let entityId = generateUUID('ent');
if (!validateUUID(entityId)) {
entityId = generateUUID('ent');
}
let newEntity = {
id: entityId,
name,
type,
phone,
wallet,
createdAt: getTimestamp(),
updatedAt: getTimestamp(),
syncedAt: new Date().toISOString()
};
newEntity = ensureRecordIntegrity(newEntity, false);
paymentEntities.push(newEntity);
showToast("New entity added", "success");
}
const savedEntity = editingEntityId
? paymentEntities.find(e => e.id === editingEntityId)
: paymentEntities[paymentEntities.length - 1];
await unifiedSave('payment_entities', paymentEntities, savedEntity);
emitSyncUpdate({ payment_entities: paymentEntities });
notifyDataChange('entities');
if (typeof refreshPaymentTab === 'function') await refreshPaymentTab();
closeEntityManagement();
if (typeof renderEntityTable === 'function') await renderEntityTable(1);
if (typeof calculateNetCash === 'function') calculateNetCash();
} catch (error) {
showToast('Failed to save entity. Please try again.', 'error');
}
}
function editEntityBasicInfo(id) {
const entity = paymentEntities.find(e => String(e.id) === String(id));
if (entity) {
editingEntityId = id;
document.getElementById('entityName').value = entity.name;
document.getElementById('entityPhone').value = entity.phone || '';
document.getElementById('entityWallet').value = entity.wallet || '';
const _entMT2 = document.getElementById('entityManagementModalTitle'); if (_entMT2) _entMT2.innerText = 'Edit Entity Info';
requestAnimationFrame(() => {
document.body.style.overflow = 'hidden';
document.documentElement.style.overflow = 'hidden';
const _entMO = document.getElementById('entityManagementOverlay'); if (_entMO) _entMO.style.display = 'flex';
});
}
}
async function refreshPaymentTab(force = false) {
try {
if (idb && idb.getBatch) {
const allKeys = [
'expenses', 'payment_entities', 'payment_transactions',
'mfg_pro_pkr', 'customer_sales', 'noman_history',
'factory_inventory_data', 'factory_production_history',
'factory_unit_tracking',
'factory_default_formulas', 'factory_additional_costs',
'factory_sale_prices', 'factory_cost_adjustment_factor'
];
const paymentDataMap = await idb.getBatch(allKeys);
if (paymentDataMap.get('expenses')) {
let freshExpenses = paymentDataMap.get('expenses') || [];
let fixedCount = 0;
if (Array.isArray(freshExpenses) && freshExpenses.length > 0) {
freshExpenses = freshExpenses.map(record => {
if (!record.id || !validateUUID(record.id) ||
!record.createdAt || !validateTimestamp(record.createdAt) ||
!record.updatedAt || !validateTimestamp(record.updatedAt)) {
record = ensureRecordIntegrity(record, false, true);
fixedCount++;
}
return record;
});
if (fixedCount > 0) {
await idb.set('expenses', freshExpenses);
}
}
expenses = freshExpenses;
expenseRecords = freshExpenses;
}
if (paymentDataMap.get('payment_entities')) {
let freshEntities = paymentDataMap.get('payment_entities') || [];
let fixedCount = 0;
if (Array.isArray(freshEntities) && freshEntities.length > 0) {
freshEntities = freshEntities.map(record => {
if (!record.id || !validateUUID(record.id) ||
!record.createdAt || !validateTimestamp(record.createdAt) ||
!record.updatedAt || !validateTimestamp(record.updatedAt)) {
record = ensureRecordIntegrity(record, false, true);
fixedCount++;
}
return record;
});
if (fixedCount > 0) {
await idb.set('payment_entities', freshEntities);
}
}
paymentEntities = freshEntities;
}
if (paymentDataMap.get('payment_transactions')) {
let freshTransactions = paymentDataMap.get('payment_transactions') || [];
let fixedCount = 0;
if (Array.isArray(freshTransactions) && freshTransactions.length > 0) {
freshTransactions = freshTransactions.map(record => {
if (!record.id || !validateUUID(record.id) ||
!record.createdAt || !validateTimestamp(record.createdAt) ||
!record.updatedAt || !validateTimestamp(record.updatedAt)) {
record = ensureRecordIntegrity(record, false, true);
fixedCount++;
}
return record;
});
if (fixedCount > 0) {
await idb.set('payment_transactions', freshTransactions);
}
}
paymentTransactions = freshTransactions;
}
const freshDb = paymentDataMap.get('mfg_pro_pkr');
if (Array.isArray(freshDb)) db = freshDb;
const freshCustomerSales = paymentDataMap.get('customer_sales');
if (Array.isArray(freshCustomerSales)) customerSales = freshCustomerSales;
const freshSalesHistory = paymentDataMap.get('noman_history');
if (Array.isArray(freshSalesHistory)) salesHistory = freshSalesHistory;
const freshInventory = paymentDataMap.get('factory_inventory_data');
if (Array.isArray(freshInventory)) factoryInventoryData = freshInventory;
const freshTracking = paymentDataMap.get('factory_unit_tracking');
if (freshTracking && typeof freshTracking === 'object') {
factoryUnitTracking = {
standard: {
produced:       freshTracking.standard?.produced       || 0,
consumed:       freshTracking.standard?.consumed       || 0,
available:      freshTracking.standard?.available      || 0,
unitCostHistory: freshTracking.standard?.unitCostHistory || []
},
asaan: {
produced:       freshTracking.asaan?.produced          || 0,
consumed:       freshTracking.asaan?.consumed          || 0,
available:      freshTracking.asaan?.available         || 0,
unitCostHistory: freshTracking.asaan?.unitCostHistory  || []
}
};
}
const freshProdHistory = paymentDataMap.get('factory_production_history');
if (Array.isArray(freshProdHistory)) {
factoryProductionHistory = freshProdHistory;
['standard', 'asaan'].forEach(s => {
factoryUnitTracking[s].unitCostHistory = freshProdHistory
.filter(e => e.store === s && e.units > 0 && e.totalCost > 0)
.map(e => ({ date: e.date, costPerUnit: e.totalCost / e.units, units: e.units }));
});
}
if (Array.isArray(factoryProductionHistory)) {
const recomp = { standard: { produced: 0, consumed: 0 }, asaan: { produced: 0, consumed: 0 } };
factoryProductionHistory.forEach(e => {
const s = e.store === 'asaan' ? 'asaan' : 'standard';
if (e.units > 0) recomp[s].produced += e.units;
});
db.forEach(e => {
if (e.isReturn) return;
const s = (e.formulaStore === 'asaan' || e.store === 'STORE_C') ? 'asaan' : 'standard';
if (e.formulaUnits) recomp[s].consumed += e.formulaUnits;
});
factoryUnitTracking.standard.available = Math.max(0, recomp.standard.produced - recomp.standard.consumed);
factoryUnitTracking.asaan.available    = Math.max(0, recomp.asaan.produced    - recomp.asaan.consumed);
}
const freshFormulas = paymentDataMap.get('factory_default_formulas');
if (freshFormulas && typeof freshFormulas === 'object') factoryDefaultFormulas = freshFormulas;
const freshCosts = paymentDataMap.get('factory_additional_costs');
if (freshCosts && typeof freshCosts === 'object') factoryAdditionalCosts = freshCosts;
const freshPrices = paymentDataMap.get('factory_sale_prices');
if (freshPrices && typeof freshPrices === 'object') factorySalePrices = freshPrices;
const freshFactor = paymentDataMap.get('factory_cost_adjustment_factor');
if (freshFactor && typeof freshFactor === 'object') factoryCostAdjustmentFactor = freshFactor;
}
await syncSuppliersToEntities();
try { calculateNetCash(); } catch (e) {
showToast('Calculation failed.', 'error');
console.error('calculateNetCash error:', _safeErr(e));
}
try {
if (typeof updateFactoryInventoryDisplay === 'function') {
const _std = factoryUnitTracking?.standard || {};
const _asn = factoryUnitTracking?.asaan || {};
console.log('[PaymentTab] factoryUnitTracking →', JSON.stringify({ std_avail: _std.available, asn_avail: _asn.available }));
console.log('[PaymentTab] getCostPerUnit(standard) =', getCostPerUnit('standard'), '| getCostPerUnit(asaan) =', getCostPerUnit('asaan'));
console.log('[PaymentTab] formulaUnitsValue =', (_std.available||0)*getCostPerUnit('standard') + (_asn.available||0)*getCostPerUnit('asaan'));
updateFactoryInventoryDisplay();
}
} catch (e) {
console.error('updateFactoryInventoryDisplay error:', _safeErr(e));
}
try { calculatePaymentSummaries(); } catch (e) {
showToast('Calculation failed.', 'error');
console.error('calculatePaymentSummaries error:', _safeErr(e));
}
try { renderUnifiedTable(); } catch (e) {
showToast('Calculation failed.', 'error');
console.error('renderUnifiedTable error:', _safeErr(e));
}
try { updateExpenseBreakdown(); } catch (e) {
showToast('Calculation failed.', 'error');
console.error('updateExpenseBreakdown error:', _safeErr(e));
}
try { calculateCashTracker(); } catch (e) {
showToast('Calculation failed.', 'error');
console.error('calculateCashTracker error:', _safeErr(e));
}
const historyList = document.getElementById('paymentHistoryList');
if (!historyList) {
return;
}
const _phFrag = document.createDocumentFragment();
const sortedTransactions = [...paymentTransactions].sort((a, b) => b.timestamp - a.timestamp);
sortedTransactions.forEach(transaction => {
const entity = paymentEntities.find(e => String(e.id) === String(transaction.entityId));
const badgeClass = transaction.type === 'IN' ? 'transaction-in' : 'transaction-out';
const badgeText = transaction.type === 'IN' ? 'IN' : 'OUT';
const entityName = entity ? entity.name : (transaction.entityName || 'Unknown Entity');
const entityType = entity ? entity.type : (transaction.entityType || 'Unknown');
const isMerged = transaction.isMerged === true;
const isSettled = transaction.isSettled === true;
const mergedBadge = isMerged ? _mergedBadgeHtml(transaction, {inline:true}) : '';
const settledBadge = isSettled ? `<span class="settled-badge">✓ Settled</span>` : '';
const creatorBadge = (typeof _creatorBadgeHtml === 'function') ? _creatorBadgeHtml(transaction) : '';
const deleteButton = isMerged ? '' : `<button class="tbl-action-btn danger u-w-full u-mt-8" onclick="(async () => { await deletePaymentTransaction('${esc(transaction.id)}') })()">Delete</button>`;
const card = document.createElement('div');
card.className = `card liquid-card${isSettled ? ' is-settled-record' : ''}`;
if (transaction.date) card.setAttribute('data-date', transaction.date);
card.innerHTML = `
<span class="transaction-badge ${badgeClass}">${badgeText}</span>
<h4>${formatDisplayDate(transaction.date)} @ ${esc(transaction.time || 'N/A')}</h4>
<div class="customer-name">${esc(entityName)}${mergedBadge}${settledBadge}${creatorBadge}</div>
<p><span>Type:</span> <span>${esc(entityType)}</span></p>
<p><span>Description:</span> <span>${esc(transaction.description || 'No description')}</span></p>
<hr>
<p><span>Amount:</span> <span class="${transaction.type === 'IN' ? 'profit-val' : 'cost-val'}">${fmtAmt(safeValue(transaction.amount))}</span></p>
${deleteButton}
`;
_phFrag.appendChild(card);
});
if (sortedTransactions.length === 0) {
historyList.replaceChildren(Object.assign(document.createElement('p'), {textContent:'No payment transactions found.',style:'text-align:center;color:var(--text-muted);width:100%;font-size:0.85rem'}));
} else {
historyList.replaceChildren(_phFrag);
}
_filterPaymentHistoryByPeriod();
} catch (error) {
console.error('Payment transaction failed.', _safeErr(error));
showToast('Payment transaction failed.', 'error');
}
}
function selectEntity(id) {
selectedEntityId = id;
const entity = paymentEntities.find(e => String(e.id) === String(id));
const entityInput = document.getElementById('paymentEntity');
if (entity && entityInput) {
entityInput.value = entity.name;
entityInput.setAttribute('data-entity-id', id);
}
document.querySelectorAll('#entityCardsGrid .entity-card-compact').forEach(card => {
card.classList.remove('active');
if (String(card.dataset.id) === String(id)) {
card.classList.add('active');
setTimeout(() => {
card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}, 100);
}
});
document.querySelectorAll('.entity-chip').forEach(chip => {
chip.classList.remove('active');
if (String(chip.dataset.id) === String(id)) {
chip.classList.add('active');
}
});
}
function refreshEntityBalances() {
renderEntityTable();
}
function getMetricValue(historyItem, metric) {
switch(metric) {
case 'weight':
return ((historyItem.totalSold || 0) - (historyItem.returned || 0)) || 0;
case 'value':
return historyItem.revenue || 0;
case 'cost':
return historyItem.totalCost || 0;
case 'profit':
return historyItem.profit || 0;
case 'cash':
return (historyItem.received || 0);
case 'credit':
return historyItem.creditValue || 0;
default:
return 0;
}
}
function getMetricLabel(metric) {
switch(metric) {
case 'weight': return 'Weight (kg)';
case 'value': return 'Revenue ()';
case 'cost': return 'Cost ()';
case 'profit': return 'Profit ()';
case 'cash': return 'Cash ()';
case 'credit': return 'Credit ()';
default: return 'Metric';
}
}
async function deleteFactoryInventoryItem() {
if (editingFactoryInventoryId) {
if (!validateUUID(String(editingFactoryInventoryId))) {
showToast('Invalid inventory item ID', 'error');
return;
}
const _diMat = factoryInventoryData.find(i => i.id === editingFactoryInventoryId);
const _diName = _diMat?.name || 'this item';
const _diQty = (_diMat?.quantity || 0).toFixed(2);
const _diVal = fmtAmt(_diMat?.totalValue || 0);
const _diSupplier = _diMat?.supplierName || null;
const _diLinkedTx = _diMat?.supplierId ? paymentTransactions.filter(t => String(t.materialId) === String(editingFactoryInventoryId) && t.isPayable === true) : [];
let _diMsg = `Permanently delete inventory item "${_diName}"?`;
_diMsg += `\nCurrent Stock: ${_diQty} kg`;
_diMsg += `\nTotal Value: ${_diVal}`;
if (_diSupplier) {
_diMsg += `\nLinked Supplier: ${_diSupplier}`;
_diMsg += `\n\n\u21a9 Supplier association will be removed.`;
if (_diLinkedTx.length > 0) {
const _diTxTotal = _diLinkedTx.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
_diMsg += ` ${_diLinkedTx.length} payment transaction${_diLinkedTx.length !== 1 ? 's' : ''} totaling ${fmtAmt(_diTxTotal)} will be reversed and the supplier\'s payable status reset.`;
}
}
_diMsg += `\n\n\u26a0 If this material is used in production formulas, those formulas will be affected.`;
_diMsg += `\n\nThis cannot be undone.`;
if (await showGlassConfirm(_diMsg, { title: `Delete "${_diName}"`, confirmText: "Delete", danger: true })) {
try {
const material = factoryInventoryData.find(i => i.id === editingFactoryInventoryId);
if (material && material.supplierId) {
await unlinkSupplierFromMaterial(material);
}
const _materialToDelete = factoryInventoryData.find(i => i.id === editingFactoryInventoryId);
factoryInventoryData = factoryInventoryData.filter(item => item.id !== editingFactoryInventoryId);
hasChanges = true;
await unifiedDelete('factory_inventory_data', factoryInventoryData, editingFactoryInventoryId, { strict: true }, _materialToDelete);
notifyDataChange('inventory');
triggerAutoSync();
closeFactoryInventoryModal();
if (typeof renderFactoryInventory === 'function') renderFactoryInventory();
if (typeof calculateNetCash === 'function') calculateNetCash();
showToast("Inventory item deleted!", 'success');
} catch (error) {
showToast('Failed to delete item. Please try again.', 'error');
}
}
}
}
async function initPaymentData() {
try {
paymentEntities = await idb.get('payment_entities', []);
paymentTransactions = await idb.get('payment_transactions', []);
if (!Array.isArray(paymentEntities)) paymentEntities = [];
if (!Array.isArray(paymentTransactions)) paymentTransactions = [];
paymentEntities = paymentEntities.map(entity => {
let updated = false;
if (!entity.id) {
entity.id = generateUUID('ent');
updated = true;
}
if (!entity.createdAt) {
entity.createdAt = entity.timestamp || getTimestamp();
updated = true;
}
if (!entity.updatedAt) {
entity.updatedAt = entity.timestamp || getTimestamp();
updated = true;
}
if (!entity.type) {
entity.type = 'payee';
updated = true;
}
if (entity.phone === undefined) {
entity.phone = '';
updated = true;
}
if (entity.wallet === undefined) {
entity.wallet = '';
updated = true;
}
return entity;
});
paymentTransactions = paymentTransactions.map(transaction => {
let updated = false;
if (!transaction.id) {
transaction.id = generateUUID('pay');
updated = true;
}
if (!transaction.timestamp && transaction.date) {
try {
const dateParts = transaction.date.split('-');
if (dateParts.length === 3) {
const date = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
if (!isNaN(date.getTime())) {
transaction.timestamp = date.getTime();
updated = true;
}
}
} catch (e) {
transaction.timestamp = Date.now();
updated = true;
}
}
if (!transaction.date && transaction.timestamp) {
const d = new Date(transaction.timestamp);
transaction.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
updated = true;
}
if (!transaction.time && transaction.timestamp) {
const d = new Date(transaction.timestamp);
transaction.time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
updated = true;
}
if (transaction.description === undefined) {
transaction.description = '';
updated = true;
}
if (typeof transaction.amount !== 'number') {
const parsed = parseFloat(transaction.amount);
transaction.amount = isNaN(parsed) ? 0 : parsed;
updated = true;
}
if (transaction.type !== 'IN' && transaction.type !== 'OUT') {
transaction.type = transaction.amount >= 0 ? 'IN' : 'OUT';
transaction.amount = Math.abs(transaction.amount);
updated = true;
}
return transaction;
});
paymentTransactions = paymentTransactions.filter(t =>
t && t.id && t.entityId && (t.type === 'IN' || t.type === 'OUT') && typeof t.amount === 'number'
);
await idb.set('payment_entities', paymentEntities);
await idb.set('payment_transactions', paymentTransactions);
} catch (e) {
paymentEntities = [];
paymentTransactions = [];
}
}
initPaymentData();
(async function initExpenseManager() {
expenseRecords = await idb.get('expenses') || [];
let savedCategories = await idb.get('expense_categories') || [];
const categoriesFromRecords = [...new Set(
expenseRecords
.filter(e => e && e.name && typeof e.name === 'string')
.map(e => e.name)
)];
expenseCategories = [...new Set([...savedCategories, ...categoriesFromRecords])];
if (expenseCategories.length > 0 && expenseCategories.length !== savedCategories.length) {
await idb.set('expense_categories', expenseCategories);
}
const expenseDateInput = document.getElementById('expenseDate');
if (expenseDateInput) {
expenseDateInput.value = new Date().toISOString().split('T')[0];
}
renderRecentExpenses();
})();
function handleExpenseSearch() {
const input = document.getElementById('expenseName');
const resultsDiv = document.getElementById('expense-search-results');
const query = input.value.trim().toLowerCase();
if (!query || query.length < 1) {
resultsDiv.classList.add('hidden');
return;
}
expenseCategories = [...new Set(
expenseRecords
.filter(e => e && e.name && typeof e.name === 'string')
.map(e => e.name)
)];
const expenseMatches = expenseCategories.filter(name => {
if (!name || typeof name !== 'string') return false;
return name.toLowerCase().includes(query);
});
const entityMatches = paymentEntities.filter(entity => {
if (!entity || !entity.name || typeof entity.name !== 'string') return false;
return entity.name.toLowerCase().includes(query);
});
let html = '';
html += `<div style="padding: 8px 12px; font-size: 0.7rem; color: var(--text-muted); font-weight: 600; background: var(--input-bg); border-bottom: 1px solid var(--glass-border);">▤ EXPENSES</div>`;
if (expenseMatches.length > 0) {
expenseMatches.forEach(name => {
if (!name || typeof name !== 'string') return;
const safeName = name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
const count = expenseRecords.filter(e => e && e.name === name).length;
html += `
<div style="
padding: 12px;
cursor: pointer;
border-bottom: 1px solid var(--glass-border);
font-size: 0.85rem;
color: var(--text-main);
background: var(--input-bg);
transition: all 0.2s;
"
onmousedown="selectExpense('${safeName}', 'expense')"
onmouseover="this.style.background='var(--highlight-bg)'"
onmouseout="this.style.background='var(--input-bg)'">
<div class="u-row-between" >
<strong>${esc(name)}</strong>
<span class="u-fs-sm u-text-muted" >
${count} expense records
</span>
</div>
</div>`;
});
} else {
html += `<div style="padding: 12px; font-size: 0.8rem; color: var(--text-muted); font-style: italic;">No matching expenses</div>`;
}
html += `<div style="padding: 8px 12px; font-size: 0.7rem; color: var(--text-muted); font-weight: 600; background: var(--input-bg); border-bottom: 1px solid var(--glass-border);"> ENTITIES</div>`;
if (entityMatches.length > 0) {
entityMatches.forEach(entity => {
if (!entity || !entity.name || typeof entity.name !== 'string') return;
const safeName = entity.name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
const transactions = paymentTransactions.filter(t => t && t.entityId === entity.id).length;
html += `
<div style="
padding: 12px;
cursor: pointer;
border-bottom: 1px solid var(--glass-border);
font-size: 0.85rem;
color: var(--text-main);
background: var(--input-bg);
transition: all 0.2s;
"
onmousedown="selectExpense('${safeName}', 'entity')"
onmouseover="this.style.background='var(--highlight-bg)'"
onmouseout="this.style.background='var(--input-bg)'">
<div class="u-row-between" >
<strong>${esc(entity.name)}</strong>
<span class="u-fs-sm u-text-muted" >
${transactions > 0 ? transactions + ' transactions' : ''}
</span>
</div>
</div>`;
});
} else {
html += `<div style="padding: 12px; font-size: 0.8rem; color: var(--text-muted); font-style: italic;">No matching entities</div>`;
}
if (expenseMatches.length === 0 && entityMatches.length === 0) {
html += `
<div style="
padding: 12px;
font-size: 0.85rem;
color: var(--accent);
background: var(--liquid-blue);
border-radius: 8px;
margin: 5px;
cursor: pointer;
"
onmousedown="hideExpenseSearch()">
<strong> New entry:</strong> "${input.value}"
<div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;">
Click to continue with this name
</div>
</div>`;
}
resultsDiv.innerHTML = html;
resultsDiv.classList.remove('hidden');
}
function selectExpense(name, type) {
document.getElementById('expenseName').value = name;
document.getElementById('expense-search-results').classList.add('hidden');
if (!name || typeof name !== 'string') {
document.getElementById('expenseAmount').focus();
return;
}
if (type === 'entity') {
document.getElementById('btn-category-operating').style.opacity = '0.4';
document.getElementById('btn-category-operating').style.pointerEvents = 'none';
document.getElementById('btn-category-in').style.opacity = '1';
document.getElementById('btn-category-in').style.pointerEvents = 'auto';
document.getElementById('btn-category-out').style.opacity = '1';
document.getElementById('btn-category-out').style.pointerEvents = 'auto';
if (!window._expenseCategory || window._expenseCategory === 'operating') {
selectExpenseCategory('OUT', document.getElementById('btn-category-out'));
}
} else if (type === 'expense') {
document.getElementById('btn-category-operating').style.opacity = '1';
document.getElementById('btn-category-operating').style.pointerEvents = 'auto';
document.getElementById('btn-category-in').style.opacity = '0.4';
document.getElementById('btn-category-in').style.pointerEvents = 'none';
document.getElementById('btn-category-out').style.opacity = '0.4';
document.getElementById('btn-category-out').style.pointerEvents = 'none';
if (window._expenseCategory === 'IN' || window._expenseCategory === 'OUT') {
selectExpenseCategory('operating', document.getElementById('btn-category-operating'));
}
} else {
['btn-category-operating','btn-category-in','btn-category-out'].forEach(id => {
const btn = document.getElementById(id);
if (btn) { btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
});
}
document.getElementById('expenseAmount').focus();
}
function hideExpenseSearch() {
document.getElementById('expense-search-results').classList.add('hidden');
document.getElementById('expenseAmount').focus();
}
window._expenseCategory = 'operating';
window._returnStore = null;
function selectExpenseCategory(value, clickedBtn) {
window._expenseCategory = value;
['btn-category-operating','btn-category-in','btn-category-out'].forEach(id => {
const btn = document.getElementById(id);
if (btn) btn.classList.remove('active');
});
if (clickedBtn) clickedBtn.classList.add('active');
}
function selectReturnStore(value, clickedBtn) {
window._returnStore = value;
['ret-store-a','ret-store-b'].forEach(id => {
const btn = document.getElementById(id);
if (btn) btn.classList.remove('active');
});
if (clickedBtn) clickedBtn.classList.add('active');
}
async function saveExpense() {
if (appMode === 'userrole' && !(window._userRoleAllowedTabs || []).includes('payments')) {
showToast('Access Denied — Payments not in your assigned tabs', 'warning', 3000); return;
}
const name = document.getElementById('expenseName').value.trim();
const amount = parseFloat(document.getElementById('expenseAmount').value);
const date = document.getElementById('expenseDate').value;
const description = document.getElementById('expenseDescription').value.trim();
const category = window._expenseCategory || 'operating';
if (!name) {
showToast("Please enter name/entity", "warning");
return;
}
if (!amount || amount <= 0) {
showToast("Please enter valid amount", "warning");
return;
}
if (!date) {
showToast("Please select date", "warning");
return;
}
let expensesSnapshot = [...expenseRecords];
let categoriesSnapshot = [...expenseCategories];
let entitiesSnapshot = [...paymentEntities];
let transactionsSnapshot = [...paymentTransactions];
try {
if (category === 'operating') {
let expenseId = generateUUID('exp');
if (!validateUUID(expenseId)) {
expenseId = generateUUID('exp');
}
let expense = {
id: expenseId,
name: name,
amount: amount,
date: date,
description: description,
category: 'operating',
createdAt: getTimestamp(),
updatedAt: getTimestamp(),
timestamp: getTimestamp(),
syncedAt: new Date().toISOString()
};
expense = ensureRecordIntegrity(expense, false);
expenseRecords.push(expense);
if (!expenseCategories.includes(name)) {
expenseCategories.push(name);
}
await unifiedSave('expenses', expenseRecords, expense);
await idb.set('expense_categories', expenseCategories);
notifyDataChange('expenses');
emitSyncUpdate({
expenses: expenseRecords,
expense_categories: expenseCategories
});
await createExpenseTransaction(expense);
showToast(`Operating expense recorded: ${name}`, "success");
} else {
const transactionType = category;
let payExpenseId = generateUUID('exp');
if (!validateUUID(payExpenseId)) payExpenseId = generateUUID('exp');
let payExpenseRecord = {
id: payExpenseId,
name: name,
amount: amount,
date: date,
description: description || `Payment ${transactionType}: ${name}`,
category: transactionType,
createdAt: getTimestamp(),
updatedAt: getTimestamp(),
timestamp: getTimestamp(),
syncedAt: new Date().toISOString()
};
payExpenseRecord = ensureRecordIntegrity(payExpenseRecord, false);
expenseRecords.push(payExpenseRecord);
await unifiedSave('expenses', expenseRecords, payExpenseRecord);
let entity = paymentEntities.find(e =>
e.name && e.name.toLowerCase() === name.toLowerCase() &&
!e.isExpenseEntity
);
if (!entity) {
let _seEntityId = generateUUID('ent');
if (!validateUUID(_seEntityId)) _seEntityId = generateUUID('ent');
let newEntity = {
id: _seEntityId,
name: name,
type: transactionType === 'OUT' ? 'payee' : 'payor',
isSupplier: false,
isExpenseEntity: false,
phone: '',
address: '',
notes: 'Auto-created from Transaction Manager'
};
newEntity = ensureRecordIntegrity(newEntity, false);
paymentEntities.push(newEntity);
entity = newEntity;
}
let _seTxId = generateUUID('pay');
if (!validateUUID(_seTxId)) _seTxId = generateUUID('pay');
let transaction = {
id: _seTxId,
entityId: entity.id,
entityName: entity.name,
amount: amount,
type: transactionType,
date: date,
description: description || `Payment ${transactionType}: ${name}`,
isPayable: false,
isExpense: false,
expenseId: payExpenseId,
createdBy: (appMode === 'userrole' && window._assignedManagerName) ? window._assignedManagerName : null
};
if (transactionType === 'OUT') {
const pendingMaterials = factoryInventoryData
.filter(m =>
String(m.supplierId) === String(entity.id) &&
m.paymentStatus === 'pending' &&
m.totalPayable > 0
)
.sort((a, b) => {
const da = new Date(a.purchaseDate || a.date || a.createdAt || 0).getTime();
const db = new Date(b.purchaseDate || b.date || b.createdAt || 0).getTime();
return da - db;
});
if (pendingMaterials.length > 0) {
let remaining = amount;
const materialsToSave = [];
for (const mat of pendingMaterials) {
if (remaining <= 0) break;
if (remaining >= mat.totalPayable) {
remaining -= mat.totalPayable;
mat.totalPayable = 0;
mat.paymentStatus = 'paid';
mat.paidDate = date;
mat.updatedAt = getTimestamp();
} else {
mat.totalPayable = parseFloat((mat.totalPayable - remaining).toFixed(2));
remaining = 0;
mat.updatedAt = getTimestamp();
}
ensureRecordIntegrity(mat, true);
materialsToSave.push(mat);
}
if (materialsToSave.length > 0) {
transaction.isPayable = true;
transaction.materialId = materialsToSave[0].id;
for (const mat of materialsToSave) {
await unifiedSave('factory_inventory_data', factoryInventoryData, mat);
}
}
}
}
transaction = ensureRecordIntegrity(transaction, false);
paymentTransactions.push(transaction);
await unifiedSave('payment_entities', paymentEntities, entity);
await unifiedSave('payment_transactions', paymentTransactions, transaction);
notifyDataChange('payments');
emitSyncUpdate({
payment_entities: paymentEntities,
payment_transactions: paymentTransactions
});
showToast(`Payment ${transactionType} recorded: ${name}`, "success");
}
clearExpenseForm();
if (typeof renderUnifiedTable === 'function') {
try {
renderUnifiedTable(1);
} catch (e) {
console.error('Failed to render data.', _safeErr(e));
showToast('Failed to render data.', 'error');
}
}
if (typeof refreshPaymentTab === 'function') {
try {
await refreshPaymentTab(true);
} catch (e) {
console.error('Payment tab refresh failed.', _safeErr(e));
showToast('Payment tab refresh failed.', 'error');
}
}
if (typeof renderExpenseTable === 'function') {
try {
renderExpenseTable(1);
} catch (e) {
console.error('Payment tab refresh failed.', _safeErr(e));
showToast('Payment tab refresh failed.', 'error');
}
}
if (typeof handleExpenseSearch === 'function') {
try {
handleExpenseSearch();
} catch (e) {
console.error('Payment tab refresh failed.', _safeErr(e));
showToast('Payment tab refresh failed.', 'error');
}
}
if (typeof calculateNetCash === 'function') {
try {
calculateNetCash();
} catch (e) {
console.error('Payment tab refresh failed.', _safeErr(e));
showToast('Payment tab refresh failed.', 'error');
}
}
if (typeof renderFactoryInventory === 'function') {
try {
renderFactoryInventory();
} catch (e) {
console.error('Payment tab refresh failed.', _safeErr(e));
showToast('Payment tab refresh failed.', 'error');
}
}
triggerAutoSync();
} catch (error) {
expenseRecords.length = 0;
expenseRecords.push(...expensesSnapshot);
expenseCategories.length = 0;
expenseCategories.push(...categoriesSnapshot);
paymentEntities.length = 0;
paymentEntities.push(...entitiesSnapshot);
paymentTransactions.length = 0;
paymentTransactions.push(...transactionsSnapshot);
try {
await idb.setBatch([
['expenses', expenseRecords],
['expense_categories', expenseCategories],
['payment_entities', paymentEntities],
['payment_transactions', paymentTransactions]
]);
} catch (rollbackError) {
console.error('Failed to render data.', _safeErr(rollbackError));
showToast('Failed to render data.', 'error');
}
showToast('Failed to save expense. Please try again.', 'error');
}
}
async function createExpenseTransaction(expense) {
let entity = paymentEntities.find(e =>
e.name && e.name.toLowerCase() === expense.name.toLowerCase() &&
e.isExpenseEntity === true
);
if (!entity) {
let _etEntityId = generateUUID('ent');
if (!validateUUID(_etEntityId)) _etEntityId = generateUUID('ent');
let newEntity = {
id: _etEntityId,
name: expense.name,
type: 'payee',
isSupplier: false,
isExpenseEntity: true,
category: expense.category,
phone: '',
address: '',
notes: 'Auto-created by Expense Manager'
};
newEntity = ensureRecordIntegrity(newEntity, false);
paymentEntities.push(newEntity);
entity = newEntity;
await unifiedSave('payment_entities', paymentEntities, newEntity);
}
let _etTxId = generateUUID('pay');
if (!validateUUID(_etTxId)) _etTxId = generateUUID('pay');
let transaction = {
id: _etTxId,
entityId: entity.id,
entityName: entity.name,
amount: expense.amount,
type: 'OUT',
date: expense.date,
description: expense.description || `Expense: ${esc(expense.name)}`,
category: expense.category,
isPayable: false,
isExpense: true,
expenseId: expense.id,
createdBy: (appMode === 'userrole' && window._assignedManagerName) ? window._assignedManagerName : null
};
transaction = ensureRecordIntegrity(transaction, false);
paymentTransactions.push(transaction);
await unifiedSave('payment_transactions', paymentTransactions, transaction);
if (typeof calculateNetCash === 'function') {
calculateNetCash();
}
if (typeof refreshEntityBalances === 'function') {
refreshEntityBalances();
}
}
function renderRecentExpenses() {
renderExpenseTable();
}
async function renderExpenseTable(page = 1) {
const tbody = document.getElementById('expense-table-body');
const totalEl = document.getElementById('expense-table-total');
const totalAllEl = document.getElementById('total-expenses-all');
if (!tbody) return;
try {
const freshExpenses = await idb.get('expenses', []);
if (freshExpenses && freshExpenses.length > 0) {
expenseRecords = freshExpenses;
}
} catch (error) {
console.error('Calculation failed.', _safeErr(error));
showToast('Calculation failed.', 'error');
}
const periodFilter = document.getElementById('expensePeriodFilter')?.value || 'month';
const categoryFilter = document.getElementById('expenseCategoryFilter')?.value || 'all';
let filteredExpenses = [...expenseRecords];
const now2 = new Date();
const today = now2.toISOString().split('T')[0];
if (periodFilter === 'today') {
filteredExpenses = filteredExpenses.filter(e => e.date === today);
} else if (periodFilter === 'week') {
const weekAgo = new Date(now2.getTime() - 7 * 24 * 60 * 60 * 1000);
filteredExpenses = filteredExpenses.filter(e => new Date(e.date) >= weekAgo);
} else if (periodFilter === 'month') {
const monthAgo = new Date(now2.getTime() - 30 * 24 * 60 * 60 * 1000);
filteredExpenses = filteredExpenses.filter(e => new Date(e.date) >= monthAgo);
}
if (categoryFilter !== 'all') {
filteredExpenses = filteredExpenses.filter(e => e.category === categoryFilter);
}
const periodTotal = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
const allTimeTotal = expenseRecords.reduce((sum, e) => sum + e.amount, 0);
filteredExpenses.sort((a, b) => new Date(b.date) - new Date(a.date));
const pageExpenses = filteredExpenses;
const validPage = 1;
const totalPages = 1;
const totalItems = filteredExpenses.length;
const startIndex = 0;
const endIndex = filteredExpenses.length;
const expensesData = {
pageExpenses,
periodTotal,
allTimeTotal,
totalItems,
totalPages,
validPage
};
if (expensesData && expensesData.pageExpenses) {
renderExpensesFromCache(expensesData, tbody, totalEl, totalAllEl);
} else {
tbody.innerHTML = `<tr><td class="u-empty-state-danger" colspan="5" >Failed to load expense data</td></tr>`;
if (totalEl) totalEl.textContent = '0.00';
if (totalAllEl) totalAllEl.textContent = '0.00';
}
}
function renderExpensesFromCache(data, tbody, totalEl, totalAllEl) {
if (!data) {
tbody.innerHTML = `<tr><td class="u-empty-state-danger" colspan="5" >Error loading expenses</td></tr>`;
if (totalEl) totalEl.textContent = '0.00';
if (totalAllEl) totalAllEl.textContent = '0.00';
return;
}
const { pageExpenses, periodTotal, allTimeTotal, totalItems, totalPages, validPage } = data;
if (!pageExpenses || !Array.isArray(pageExpenses)) {
tbody.innerHTML = `<tr><td class="u-empty-state-danger" colspan="5" >Invalid expense data</td></tr>`;
if (totalEl) totalEl.textContent = '0.00';
if (totalAllEl) totalAllEl.textContent = '0.00';
return;
}
if (totalEl) totalEl.textContent = `${fmtAmt(periodTotal)}`;
if (totalAllEl) totalAllEl.textContent = `${fmtAmt(allTimeTotal)}`;
if (totalItems === 0) {
tbody.innerHTML = `
<tr>
<td class="u-empty-state-md" colspan="5" >
No expenses found for selected period
</td>
</tr>`;
return;
}
const fragment = document.createDocumentFragment();
pageExpenses.forEach(expense => {
const categoryColor = getCategoryColor(expense.category);
const categoryLabel = getCategoryLabel(expense.category);
const formattedDate = formatExpenseDate(expense.date);
const tr = document.createElement('tr');
tr.style.cssText = 'border-bottom: 1px solid var(--glass-border); transition: background 0.2s;';
tr.onmouseover = function() { this.style.background = 'var(--card-hover)'; };
tr.onmouseout = function() { this.style.background = 'transparent'; };
tr.innerHTML = `
<td style="padding: 10px 8px; font-size: 0.8rem; color: var(--text-muted);">
${formattedDate}
</td>
<td style="padding: 10px 8px; font-weight: 600; color: var(--text-main);">
${esc(expense.name)}${expense.isMerged ? _mergedBadgeHtml(expense, {inline:true}) : ''}
${expense.description ? `<br><span class="u-fs-sm2 u-text-muted u-fw-400" >${esc(expense.description)}</span>` : ''}
</td>
<td style="padding: 10px 8px;">
<span style="
background: ${categoryColor}15;
color: ${categoryColor};
padding: 4px 8px;
border-radius: 6px;
font-size: 0.7rem;
font-weight: 600;
white-space: nowrap;
">${esc(categoryLabel)}</span>
</td>
<td style="padding: 10px 8px; text-align: right; font-weight: 700; color: var(--danger); font-size: 0.9rem;">
${fmtAmt(expense.amount)}
</td>
<td style="padding: 10px 8px; text-align: center;">
<button
onclick="openExpenseEntityDetails('${esc(expense.id)}')"
style="
background: linear-gradient(135deg, var(--accent) 0%, var(--accent-emerald) 100%);
border: none;
color: white;
padding: 6px 12px;
border-radius: 6px;
font-size: 0.75rem;
cursor: pointer;
transition: all 0.2s;
font-weight: 600;
"
onmouseover="this.style.transform='scale(1.05)'; this.style.boxShadow='0 4px 12px rgba(0,122,255,0.3)'"
onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='none'"
>
Manage
</button>
</td>
`;
fragment.appendChild(tr);
});
tbody.replaceChildren(fragment);
}
async function renderUnifiedTable(page = 1) {
try {
const freshEntities = await idb.get('payment_entities', []);
if (freshEntities && Array.isArray(freshEntities)) {
paymentEntities = freshEntities;
}
const freshTransactions = await idb.get('payment_transactions', []);
if (freshTransactions && Array.isArray(freshTransactions)) {
paymentTransactions = freshTransactions;
}
const freshExpenses = await idb.get('expenses', []);
if (freshExpenses && Array.isArray(freshExpenses)) {
expenseRecords = freshExpenses;
}

const freshInventory = await idb.get('factory_inventory_data', []);
if (freshInventory && Array.isArray(freshInventory) && freshInventory.length > 0) {
factoryInventoryData = freshInventory;
}
} catch (error) {
console.error('Failed to render data.', _safeErr(error));
showToast('Failed to render data.', 'error');
}
const viewModeEl = document.getElementById('unifiedViewMode');
const periodFilterEl = document.getElementById('unifiedPeriodFilter');
const searchInputEl = document.getElementById('unified-search');
const tbody = document.getElementById('unified-table-body');
const totalSpan = document.getElementById('unified-table-total');
const footerLabel = document.getElementById('unified-table-footer-label');
const summaryDiv = document.getElementById('unified-summary');
if (!tbody) {
return;
}
const viewMode = viewModeEl ? viewModeEl.value : 'entities';
const periodFilter = periodFilterEl ? periodFilterEl.value : 'month';
const searchQuery = searchInputEl && searchInputEl.value ? String(searchInputEl.value).toLowerCase().trim() : '';
let rows = [];
let totalAmount = 0;
let totalReceivables = 0;
let totalPayables = 0;
let totalSupplierPayables = 0;
let totalEntityPayables = 0;
let totalExpenses = 0;
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
let startDate = new Date(0);
if (periodFilter === 'today') {
startDate = today;
} else if (periodFilter === 'week') {
startDate = new Date(today);
startDate.setDate(today.getDate() - 7);
} else if (periodFilter === 'month') {
startDate = new Date(today);
startDate.setDate(today.getDate() - 30);
}
expenseRecords.forEach(exp => {
if (!exp || !exp.date) return;
const expDate = new Date(exp.date);
if (expDate < startDate) return;
if (exp.category === 'operating') {
const amount = parseFloat(exp.amount) || 0;
totalExpenses += amount;
}
});
const supplierIdSet = new Set();
if (typeof factoryInventoryData !== 'undefined') {
factoryInventoryData.forEach(m => { if (m.supplierId) supplierIdSet.add(String(m.supplierId)); });
}
const supplierBalances = {};
if (typeof factoryInventoryData !== 'undefined') {
factoryInventoryData.forEach(material => {
if (material.supplierId && material.paymentStatus === 'pending' && material.totalPayable > 0) {
const sid = String(material.supplierId);
supplierBalances[sid] = (supplierBalances[sid] || 0) + material.totalPayable;
}
});
}
const entityBalances = {};
paymentEntities.forEach(entity => {
if (entity.isExpenseEntity === true) return;
if (supplierIdSet.has(String(entity.id))) return;
entityBalances[entity.id] = 0;
});
if (typeof paymentTransactions !== 'undefined') {
paymentTransactions.forEach(transaction => {
if (transaction.isExpense === true) return;
if (supplierIdSet.has(String(transaction.entityId))) return;
if (entityBalances[transaction.entityId] !== undefined) {
if (transaction.type === 'OUT') {
entityBalances[transaction.entityId] -= parseFloat(transaction.amount) || 0;
} else if (transaction.type === 'IN') {
entityBalances[transaction.entityId] += parseFloat(transaction.amount) || 0;
}
}
});
}
for (const sid in supplierBalances) {
if (supplierBalances[sid] > 0) {
totalSupplierPayables += supplierBalances[sid];
totalPayables += supplierBalances[sid];
}
}
for (const entityId in entityBalances) {
const balance = entityBalances[entityId];
if (balance > 0) { totalEntityPayables += balance; totalPayables += balance; }
if (balance < 0) totalReceivables += Math.abs(balance);
}
if (viewMode === 'transactions') {
const expenseGroups = {};
expenseRecords.forEach(exp => {
if (!exp || !exp.date) return;
if (exp.category !== 'operating') return;
const expDate = new Date(exp.date);
if (expDate < startDate) return;
const expName = exp.name ? String(exp.name) : '';
if (searchQuery && !expName.toLowerCase().includes(searchQuery)) return;
const groupKey = `${exp.category}||${expName}`;
if (!expenseGroups[groupKey]) {
expenseGroups[groupKey] = {
name: expName,
category: exp.category,
totalAmount: 0,
latestDate: expDate,
latestId: exp.id,
count: 0
};
}
const grp = expenseGroups[groupKey];
grp.totalAmount += parseFloat(exp.amount) || 0;
grp.count++;
if (expDate > grp.latestDate) {
grp.latestDate = expDate;
grp.latestId = exp.id;
}
});
Object.values(expenseGroups).forEach(grp => {
totalAmount -= grp.totalAmount;
const d = grp.latestDate;
const month = d.toLocaleDateString('en-US', { month: 'short' });
const day = String(d.getDate()).padStart(2, '0');
const year = String(d.getFullYear()).slice(-2);
rows.push({
type: 'transaction',
date: grp.latestDate,
dateStr: `${month} ${day} ${year}`,
name: grp.name,
contact: 'Operating',
typeLabel: 'EXPENSE',
amount: grp.totalAmount,
amountStr: `${fmtAmt(grp.totalAmount)}`,
color: 'var(--warning)',
id: grp.latestId,
description: grp.count > 1 ? `${grp.count} transactions` : ''
});
});
}
if (viewMode === 'entities') {
const supplierIds = new Set();
if (typeof factoryInventoryData !== 'undefined') {
factoryInventoryData.forEach(m => { if (m.supplierId) supplierIds.add(String(m.supplierId)); });
}
const supplierEntityBalances = {};
if (typeof factoryInventoryData !== 'undefined') {
factoryInventoryData.forEach(material => {
if (material.supplierId && material.paymentStatus === 'pending' && material.totalPayable > 0) {
const sid = String(material.supplierId);
supplierEntityBalances[sid] = (supplierEntityBalances[sid] || 0) + material.totalPayable;
}
});
}
const entityBalances = {};
paymentEntities.forEach(entity => {
if (entity.isExpenseEntity === true) return;
if (supplierIds.has(String(entity.id))) return;
entityBalances[entity.id] = 0;
});
if (typeof paymentTransactions !== 'undefined') {
paymentTransactions.forEach(transaction => {
if (transaction.isExpense === true) return;
if (supplierIds.has(String(transaction.entityId))) return;
if (entityBalances[transaction.entityId] !== undefined) {
if (transaction.type === 'OUT') {
entityBalances[transaction.entityId] -= parseFloat(transaction.amount) || 0;
} else if (transaction.type === 'IN') {
entityBalances[transaction.entityId] += parseFloat(transaction.amount) || 0;
}
}
});
}
paymentEntities.forEach(entity => {
if (entity.isExpenseEntity === true) return;
const entityName = entity && entity.name ? String(entity.name) : '';
const entityPhone = entity && entity.phone ? String(entity.phone) : '';
const entityWallet = entity && entity.wallet ? String(entity.wallet) : '';
if (searchQuery) {
const nameMatch = entityName.toLowerCase().includes(searchQuery);
const phoneMatch = entityPhone.includes(searchQuery);
const walletMatch = entityWallet.includes(searchQuery);
if (!nameMatch && !phoneMatch && !walletMatch) return;
}
let balance = supplierIds.has(String(entity.id))
? (supplierEntityBalances[String(entity.id)] || 0)
: (entityBalances[entity.id] || 0);
if (entity.balance !== undefined && entity.balance !== null && typeof paymentTransactions === 'undefined') {
balance = parseFloat(entity.balance) || 0;
}
const contactInfo = entityPhone || entityWallet || 'No contact';
const entityDate = entity.createdAt ? new Date(entity.createdAt) : new Date();
const dateStr = (() => {
const month = entityDate.toLocaleDateString('en-US', { month: 'short' });
const day = String(entityDate.getDate()).padStart(2, '0');
const year = String(entityDate.getFullYear()).slice(-2);
return `${month} ${day} ${year}`;
})();
let balanceLabel = '';
let balanceColor = 'var(--text-muted)';
if (balance > 0.01) {
balanceLabel = 'PAYABLE';
balanceColor = 'var(--danger)';
} else if (balance < -0.01) {
balanceLabel = 'RECEIVABLE';
balanceColor = 'var(--accent-emerald)';
} else {
balanceLabel = 'SETTLED';
}
let nameColor = 'var(--text-main)';
if (balance > 0.01) {
nameColor = 'var(--danger)';
} else if (balance < -0.01) {
nameColor = 'var(--accent-emerald)';
}
const amountStr = `${fmtAmt(Math.abs(balance))}`;
rows.push({
type: 'entity',
date: entityDate,
dateStr: dateStr,
name: entityName,
nameColor: nameColor,
contact: contactInfo,
typeLabel: 'ENTITY',
amount: balance,
amountStr: amountStr,
amountColor: balanceColor,
balanceLabel: balanceLabel,
id: entity.id,
entity: entity
});
});
}
rows.sort((a, b) => {
if (a.type === 'entity' && b.type === 'entity') {
return Math.abs(b.amount) - Math.abs(a.amount);
}
if (a.type === 'entity' && b.type !== 'entity') return 1;
if (a.type !== 'entity' && b.type === 'entity') return -1;
return b.date - a.date;
});
const pageRows = rows;
const validPage = 1;
const totalPages = 1;
const totalItems = rows.length;
const startIndex = 0;
const endIndex = rows.length;
const unifiedData = {
rows: pageRows,
totalAmount,
totalReceivables,
totalPayables,
totalSupplierPayables,
totalEntityPayables,
totalExpenses,
viewMode,
totalItems,
page,
totalPages
};
if (unifiedData && unifiedData.rows) {
renderUnifiedFromCache(unifiedData, tbody, totalSpan, footerLabel, summaryDiv);
} else {
tbody.innerHTML = `<tr><td class="u-empty-state-danger" colspan="5" >Failed to load records</td></tr>`;
if (totalSpan) totalSpan.textContent = '0.00';
}
}
function renderUnifiedFromCache(data, tbody, totalSpan, footerLabel, summaryDiv) {
if (!data) {
tbody.innerHTML = `<tr><td class="u-empty-state-danger" colspan="5" >Error loading records</td></tr>`;
if (totalSpan) totalSpan.textContent = '0.00';
return;
}
const { rows, totalAmount, totalReceivables, totalPayables, totalSupplierPayables, totalEntityPayables, totalExpenses, viewMode, totalItems, page, totalPages } = data;
if (!rows || !Array.isArray(rows)) {
tbody.innerHTML = `<tr><td class="u-empty-state-danger" colspan="5" >Invalid data format</td></tr>`;
if (totalSpan) totalSpan.textContent = '0.00';
return;
}
if (rows.length === 0) {
tbody.innerHTML = `
<tr>
<td class="u-empty-state-md" colspan="5" >
No records found matching your filters
</td>
</tr>`;
if (totalSpan) totalSpan.textContent = '0.00';
return;
}
function buildUnifiedRow(row) {
const tr = document.createElement('tr');
tr.style.cssText = 'border-bottom: 1px solid var(--glass-border); transition: background 0.2s; cursor: pointer;';
tr.onmouseover = function() { this.style.background = 'var(--highlight-bg)'; };
tr.onmouseout = function() { this.style.background = row.type === 'entity' ? 'var(--input-bg)' : 'transparent'; };
if (row.type === 'transaction') {
tr.innerHTML = `
<td style="padding: 8px 4px; font-size: 0.7rem; white-space: nowrap;">${row.dateStr}</td>
<td style="padding: 8px 4px; font-weight: 600; font-size: 0.8rem;">
${esc(row.name)}
<div style="display: inline-block; margin-left: 6px;">
<span style="background: ${row.typeLabel === 'EXPENSE' ? 'var(--warning)' : 'var(--accent)'}; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.55rem; font-weight: 700;">
${row.typeLabel}
</span>
</div>
</td>
<td style="padding: 8px 4px; font-size: 0.7rem; color: var(--text-muted);">${phoneActionHTML(row.contact)}</td>
<td style="padding: 8px 4px; text-align: right; font-weight: 700; color: ${row.color}; white-space: nowrap; font-size: 0.75rem;">
${row.amountStr}
</td>
<td style="padding: 6px 4px; text-align: center;">
<button class="tbl-action-btn" onclick="openExpenseEntityDetails('${esc(row.id)}')">
Edit
</button>
</td>`;
} else {
tr.style.background = 'var(--input-bg)';
tr.innerHTML = `
<td style="padding: 8px 4px; font-size: 0.7rem; white-space: nowrap; color: var(--text-main);">
${row.dateStr}
</td>
<td style="padding: 8px 4px; font-weight: 700; font-size: 0.8rem; color: ${row.nameColor};">
${esc(row.name)}
<div style="font-size: 0.6rem; margin-top: 2px;">
<span style="background: ${row.amountColor}; color: white; padding: 1px 4px; border-radius: 3px; font-size: 0.55rem; font-weight: 600;">
${row.balanceLabel}
</span>
</div>
</td>
<td style="padding: 8px 4px; font-size: 0.7rem; color: var(--text-muted);">${phoneActionHTML(row.contact)}</td>
<td style="padding: 8px 4px; text-align: right; font-weight: 700; color: ${row.amountColor}; white-space: nowrap; font-size: 0.75rem;">
${row.amountStr}
</td>
<td style="padding: 6px 4px; text-align: center;">
<button class="tbl-action-btn" onclick="openEntityDetailsOverlay('${esc(row.id)}')">
Edit
</button>
</td>`;
}
return tr;
}
GNDVirtualScroll.mount('unified-table-container', rows, buildUnifiedRow, tbody);
if (viewMode === 'entities') {
if (footerLabel) footerLabel.textContent = 'Net Balance:';
if (totalSpan) {
const netBalance = totalReceivables - totalPayables;
totalSpan.textContent = `${fmtAmt(Math.abs(netBalance))}`;
totalSpan.style.color = netBalance >= 0 ? 'var(--accent-emerald)' : 'var(--danger)';
}
} else {
if (footerLabel) footerLabel.textContent = 'Net Total:';
if (totalSpan) {
totalSpan.textContent = `${fmtAmt(totalAmount)}`;
totalSpan.style.color = totalAmount >= 0 ? 'var(--accent-emerald)' : 'var(--danger)';
}
}
if (summaryDiv) {
summaryDiv.style.display = 'block';
const receivablesEl = document.getElementById('unified-receivables');
const payablesEl = document.getElementById('unified-payables');
const supplierPayablesEl = document.getElementById('unified-supplier-payables');
const entityPayablesEl = document.getElementById('unified-entity-payables');
const expensesEl = document.getElementById('unified-expenses');
if (receivablesEl) receivablesEl.textContent = fmtAmt(totalReceivables);
if (payablesEl) payablesEl.textContent = fmtAmt(totalPayables);
if (supplierPayablesEl) supplierPayablesEl.textContent = fmtAmt(totalSupplierPayables);
if (entityPayablesEl) entityPayablesEl.textContent = fmtAmt(totalEntityPayables);
if (expensesEl) expensesEl.textContent = fmtAmt(totalExpenses);
}
_filterPaymentHistoryByPeriod();
}
function updateExpenseBreakdown() {
const container = document.getElementById('expense-breakdown-container');
if (!container) return;
const categoryTotals = {};
let totalExpenses = 0;
expenseRecords.forEach(exp => {
if (exp.category === 'operating') {
const name = exp.name;
const amount = parseFloat(exp.amount) || 0;
if (!categoryTotals[name]) {
categoryTotals[name] = 0;
}
categoryTotals[name] += amount;
totalExpenses += amount;
}
});
const sortedCategories = Object.entries(categoryTotals)
.sort((a, b) => b[1] - a[1])
.slice(0, 5);
if (sortedCategories.length === 0) {
container.innerHTML = '<div style="color: var(--text-muted); font-style: italic;">No operating expenses</div>';
return;
}
let html = '';
sortedCategories.forEach(([name, amount]) => {
const percentage = totalExpenses > 0 ? (amount / totalExpenses * 100).toFixed(2) : 0;
html += `
<div style="display: flex; justify-content: space-between; margin-bottom: 4px; padding: 4px 0;">
<span class="u-text-main" >${name}:</span>
<div style="text-align: right;">
<span style="color: var(--danger); font-weight: 600; margin-right: 8px;">${formatCurrency(amount)}</span>
<span style="color: var(--text-muted); font-size: 0.7rem;">(${percentage}%)</span>
</div>
</div>`;
});
if (Object.keys(categoryTotals).length > 5) {
const othersCount = Object.keys(categoryTotals).length - 5;
html += `<div style="color: var(--text-muted); font-size: 0.7rem; margin-top: 4px; font-style: italic;">${othersCount} more categories
</div>`;
}
container.innerHTML = html;
}
async function exportUnifiedData() {
const viewModeEl = document.getElementById('unifiedViewMode');
const periodFilterEl = document.getElementById('unifiedPeriodFilter');
if (!viewModeEl || !periodFilterEl) {
showToast('Export failed. Please try again.', 'error');
return;
}
const viewMode = viewModeEl.value || 'entities';
const periodFilter = periodFilterEl.value || 'all';
showToast("Generating PDF...", "info");
try {
if (!window.jspdf) {
await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js');
}
if (!window.jspdf || !window.jspdf.jsPDF) {
throw new Error("Failed to load PDF library. Please refresh and try again.");
}
const { jsPDF } = window.jspdf;
const doc = new jsPDF('p', 'mm', 'a4');
const pageW = doc.internal.pageSize.getWidth();
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
let startDate = new Date(0);
if (periodFilter === 'today') startDate = today;
else if (periodFilter === 'week') { startDate = new Date(today); startDate.setDate(today.getDate() - 7); }
else if (periodFilter === 'month') { startDate = new Date(today); startDate.setDate(today.getDate() - 30); }
const periodName = periodFilter === 'all' ? 'All Time' : periodFilter === 'today' ? 'Today' :
periodFilter === 'week' ? 'This Week' : 'This Month';
const isEntities = viewMode === 'entities';
const hdrColor = isEntities ? [0, 150, 136] : [255, 149, 0];
doc.setFillColor(...hdrColor);
doc.rect(0, 0, pageW, 22, 'F');
doc.setFontSize(15); doc.setFont(undefined,'bold'); doc.setTextColor(255,255,255);
doc.text('GULL AND ZUBAIR NASWAR DEALERS', pageW/2, 10, { align:'center' });
doc.setFontSize(9); doc.setFont(undefined,'normal');
doc.text('Naswar Manufacturers & Dealers', pageW/2, 17, { align:'center' });
doc.setFontSize(12); doc.setFont(undefined,'bold'); doc.setTextColor(50,50,50);
const titleText = isEntities ? 'Payment Entities — Balances & Ledger' : 'Expenses — Transaction Records';
doc.text(`${titleText} · ${periodName}`, pageW/2, 30, { align:'center' });
doc.setFontSize(8); doc.setFont(undefined,'normal'); doc.setTextColor(120,120,120);
doc.text(`Generated: ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})} at ${new Date().toLocaleTimeString('en-US')}`, pageW/2, 36, { align:'center' });
doc.setDrawColor(...hdrColor); doc.setLineWidth(0.5);
doc.line(14, 39, pageW - 14, 39);
let yPos = 44;
if (isEntities) {
if (typeof paymentEntities !== 'undefined' && paymentEntities.length > 0) {
const supplierIdSet = new Set();
if (typeof factoryInventoryData !== 'undefined') {
factoryInventoryData.forEach(m => { if (m.supplierId) supplierIdSet.add(String(m.supplierId)); });
}
const supplierInventoryBalances = {};
if (typeof factoryInventoryData !== 'undefined') {
factoryInventoryData.forEach(mat => {
if (mat.supplierId && mat.paymentStatus === 'pending' && mat.totalPayable > 0) {
const sid = String(mat.supplierId);
supplierInventoryBalances[sid] = (supplierInventoryBalances[sid] || 0) + mat.totalPayable;
}
});
}
const entityNetBalances = {};
const entityMergedInfo = {};
paymentEntities.forEach(e => {
if (e.isExpenseEntity === true) return;
if (supplierIdSet.has(String(e.id))) return;
entityNetBalances[e.id] = 0;
});
if (typeof paymentTransactions !== 'undefined') {
paymentTransactions.forEach(t => {
if (t.isExpense === true) return;
if (supplierIdSet.has(String(t.entityId))) return;
if (entityNetBalances[t.entityId] !== undefined) {
const amt = parseFloat(t.amount) || 0;
if (t.type === 'OUT') entityNetBalances[t.entityId] -= amt;
else if (t.type === 'IN') entityNetBalances[t.entityId] += amt;
if (t.isMerged === true && t.mergedSummary) {
  entityMergedInfo[t.entityId] = entityMergedInfo[t.entityId] || [];
  entityMergedInfo[t.entityId].push({
    period: _pdfMergedPeriodLabel(t),
    count: _pdfMergedCountLabel(t),
    originalIn:  (t.mergedSummary.originalIn  || 0),
    originalOut: (t.mergedSummary.originalOut || 0)
  });
}
}
});
}
const entityRows = [];
const pdfEntityList = [];
let totPayable = 0, totReceivable = 0;
paymentEntities
.filter(e => !e.isExpenseEntity)
.forEach(entity => {
const sid = String(entity.id);
let balance = 0;
let source = 'Transactions';
if (supplierIdSet.has(sid)) {
balance = -(supplierInventoryBalances[sid] || 0);
source = 'Inventory';
} else {
balance = entityNetBalances[entity.id] || 0;
}
if (balance < -0.01) totPayable += Math.abs(balance);
if (balance > 0.01) totReceivable += balance;
let balDisplay, balNote;
if (Math.abs(balance) < 0.01) { balDisplay = 'SETTLED'; balNote = ''; }
else if (balance < 0) { balDisplay = 'Rs ' + fmtAmt(Math.abs(balance)); balNote = 'PAYABLE'; }
else { balDisplay = 'Rs ' + fmtAmt(balance); balNote = 'RECEIVABLE'; }
const hasMergedTx = !!entityMergedInfo[entity.id];
const mergedNote = hasMergedTx
  ? entityMergedInfo[entity.id].map(m => `\u2605 ${m.period} (${m.count})`).join('\n')
  : '';
entityRows.push([
entity.name + (hasMergedTx ? '\n\u2605 Has year-end balance' : ''),
supplierIdSet.has(sid) ? 'SUPPLIER' : 'ENTITY',
entity.phone || 'N/A',
hasMergedTx ? 'Year-End\n' + source : source,
balDisplay,
balNote
]);
pdfEntityList.push(entity);
});
entityRows.push([
`TOTAL (${entityRows.length} entities)`, '', '', '',
'Payable: Rs ' + fmtAmt(totPayable) + '\nReceivable: Rs ' + fmtAmt(totReceivable),
'Net: Rs ' + fmtAmt(Math.abs(totReceivable - totPayable))
]);
doc.autoTable({
startY: yPos,
head: [['Name', 'Type', 'Phone', 'Balance Source', 'Balance', 'Status']],
body: entityRows,
theme: 'grid',
headStyles: { fillColor: hdrColor, textColor: 255, fontSize: 9, fontStyle:'bold', halign:'center' },
styles: { fontSize: 8.5, cellPadding: 3, lineWidth: 0.15, lineColor:[180,180,180], overflow:'linebreak' },
columnStyles: {
0: { cellWidth: 48 },
1: { cellWidth: 20, halign:'center' },
2: { cellWidth: 28, halign:'center' },
3: { cellWidth: 24, halign:'center', fontSize:7.5, textColor:[100,100,100] },
4: { cellWidth: 34, halign:'right', fontStyle:'bold' },
5: { cellWidth: 22, halign:'center', fontStyle:'bold' }
},
didParseCell: function(data) {
const isTotal = data.row.index === entityRows.length - 1;
if (isTotal) {
data.cell.styles.fontStyle = 'bold';
data.cell.styles.fillColor = [240, 248, 255];
data.cell.styles.fontSize = 9;
}
const rowEntity = (data.row.index < entityRows.length - 1) ? pdfEntityList[data.row.index] : null;
if (rowEntity && entityMergedInfo[rowEntity.id]) {
  data.cell.styles.fillColor = PDF_MERGED_ROW_COLOR;
}
if (data.column.index === 4 && !isTotal) {
const txt = (data.cell.text || []).join('');
data.cell.styles.textColor = txt === 'SETTLED' ? [100,100,100] : [220,53,69];
}
if (data.column.index === 5 && !isTotal) {
const txt = (data.cell.text || []).join('');
if (txt === 'SETTLED') data.cell.styles.textColor = [100,100,100];
else if (txt === 'RECEIVABLE') data.cell.styles.textColor = [40,167,69];
else if (txt === 'PAYABLE') data.cell.styles.textColor = [220,53,69];
}
},
margin: { left: 14, right: 14 }
});
const afterY = doc.lastAutoTable.finalY + 6;
if (afterY < 275) {
doc.setFontSize(8); doc.setFont(undefined,'normal'); doc.setTextColor(100,100,100);
doc.text(
`Total Payables: Rs ${fmtAmt(totPayable)} | Total Receivables: Rs ${fmtAmt(totReceivable)} | Net Position: Rs ${fmtAmt(Math.abs(totReceivable - totPayable))} ${totReceivable > totPayable ? '(IN OUR FAVOR)' : '(NET PAYABLE)'}`,
14, afterY
);
const hasMergedEntries2 = Object.keys(entityMergedInfo).length > 0;
if (hasMergedEntries2 && afterY + 7 < 280) {
  doc.setFillColor(245, 235, 255);
  doc.roundedRect(14, afterY + 6, pageW - 28, 9, 1.5, 1.5, 'F');
  doc.setFontSize(7.5); doc.setFont(undefined,'bold'); doc.setTextColor(126, 34, 206);
  doc.text('\u2605 Highlighted rows contain year-end opening balances (MERGED) from Close Financial Year.', 18, afterY + 12.5);
  doc.setFont(undefined,'normal'); doc.setTextColor(80,80,80);
}
}
} else {
doc.setFont(undefined,'normal'); doc.setFontSize(10); doc.setTextColor(150);
doc.text('No entities found.', pageW/2, yPos + 10, { align:'center' });
}
}
if (!isEntities) {
let expenses = (typeof expenseRecords !== 'undefined' ? expenseRecords : [])
.filter(exp => exp && exp.category === 'operating');
if (periodFilter !== 'all') {
expenses = expenses.filter(exp => {
if (!exp.date) return false;
return new Date(exp.date) >= startDate;
});
}
expenses.sort((a, b) => new Date(b.date) - new Date(a.date));
if (expenses.length > 0) {
const nameGroups = {};
expenses.forEach(exp => {
const key = exp.name || 'Unnamed';
if (!nameGroups[key]) nameGroups[key] = 0;
nameGroups[key] += parseFloat(exp.amount) || 0;
});
const mergedExpenses = expenses.filter(e => e.isMerged === true);
const normalExpenses = expenses.filter(e => !e.isMerged);
if (mergedExpenses.length > 0) {
  yPos = _pdfDrawMergedSectionHeader(doc, yPos, pageW, 'YEAR-END EXPENSE SUMMARIES (Carried Forward)');
  const mergedExpRows = mergedExpenses.map(exp => {
    const ms = exp.mergedSummary || {};
    const period = _pdfMergedPeriodLabel(exp);
    const count  = _pdfMergedCountLabel(exp);
    return [
      period,
      exp.name || '-',
      exp.category || 'operating',
      `${count} — ${(exp.description || '').substring(0, 35)}`,
      'Rs ' + fmtAmt(parseFloat(exp.amount)||0)
    ];
  });
  const mExpTotal = mergedExpenses.reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
  mergedExpRows.push(['','','','SUBTOTAL ('+mergedExpenses.length+' groups)','Rs '+fmtAmt(mExpTotal)]);
  doc.autoTable({startY:yPos,head:[['Year Period','Name / Vendor','Category','Summary','Total Amount']],body:mergedExpRows,theme:'grid',
    headStyles:{fillColor:PDF_MERGED_HDR_COLOR,textColor:255,fontSize:9,fontStyle:'bold',halign:'center'},
    styles:{fontSize:8,cellPadding:2.5,lineWidth:0.15,lineColor:[200,180,230],overflow:'linebreak'},
    columnStyles:{0:{cellWidth:30,halign:'center'},1:{cellWidth:34},2:{cellWidth:22,halign:'center',fontSize:7.5},3:{cellWidth:58},4:{cellWidth:28,halign:'right',fontStyle:'bold'}},
    didParseCell:function(data){const isSub=data.row.index===mergedExpRows.length-1;if(isSub){data.cell.styles.fillColor=[230,210,255];data.cell.styles.fontStyle='bold';data.cell.styles.fontSize=9.5;}else{data.cell.styles.fillColor=PDF_MERGED_ROW_COLOR;data.cell.styles.textColor=[80,40,120];}if(data.column.index===4)data.cell.styles.textColor=isSub?[126,34,206]:[140,60,180];},
    margin:{left:14,right:14}});
  yPos = doc.lastAutoTable.finalY + 6;
  if (yPos > 250) { doc.addPage(); yPos = 20; }
}
const expenseRows = normalExpenses.map(exp => [
formatDisplayDate(exp.date) || exp.date || '',
exp.name || '-',
exp.category || 'operating',
(exp.description || '-').substring(0, 45),
'Rs ' + fmtAmt(parseFloat(exp.amount) || 0)
]);
const totalAmt = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
if (normalExpenses.length > 0) {
  doc.setFontSize(8.5); doc.setFont(undefined,'bold');
  doc.setTextColor(...hdrColor);
  doc.text('INDIVIDUAL EXPENSE RECORDS', 14, yPos);
  doc.setTextColor(80,80,80); doc.setFont(undefined,'normal');
  yPos += 5;
}
expenseRows.push(['', '', '', 'TOTAL (' + expenses.length + ' records)', 'Rs ' + fmtAmt(totalAmt)]);
doc.autoTable({
startY: yPos,
head: [['Date', 'Name / Vendor', 'Category', 'Description', 'Amount']],
body: expenseRows,
theme: 'grid',
headStyles: { fillColor: hdrColor, textColor: 255, fontSize: 9, fontStyle:'bold', halign:'center' },
styles: { fontSize: 8.5, cellPadding: 2.5, lineWidth: 0.15, lineColor:[180,180,180], overflow:'linebreak' },
columnStyles: {
0: { cellWidth: 24, halign:'center' },
1: { cellWidth: 38 },
2: { cellWidth: 22, halign:'center', fontSize:7.5, textColor:[100,100,100] },
3: { cellWidth: 60 },
4: { cellWidth: 28, halign:'right', textColor:[220,53,69], fontStyle:'bold' }
},
didParseCell: function(data) {
const isTotal = data.row.index === expenseRows.length - 1;
if (isTotal) {
data.cell.styles.fontStyle = 'bold';
data.cell.styles.fillColor = [255, 245, 235];
data.cell.styles.fontSize = 9.5;
if (data.column.index === 4) data.cell.styles.textColor = [220,53,69];
}
},
margin: { left: 14, right: 14 }
});
const afterY = doc.lastAutoTable.finalY + 8;
if (afterY < 265 && Object.keys(nameGroups).length > 1) {
doc.setFontSize(9); doc.setFont(undefined,'bold'); doc.setTextColor(50,50,50);
doc.text('Breakdown by Expense Name:', 14, afterY);
let bkY = afterY + 5;
doc.setFont(undefined,'normal'); doc.setFontSize(8);
Object.entries(nameGroups)
.sort(([,a],[,b]) => b - a)
.forEach(([name, total]) => {
if (bkY > 275) return;
doc.setTextColor(80,80,80);
doc.text(name.substring(0, 30), 14, bkY);
doc.setTextColor(220,53,69); doc.setFont(undefined,'bold');
doc.text('Rs ' + fmtAmt(total), 130, bkY, { align:'right' });
doc.setFont(undefined,'normal');
bkY += 5;
});
}
} else {
doc.setFont(undefined,'normal'); doc.setFontSize(10); doc.setTextColor(150);
doc.text('No expense records found for this period.', pageW/2, yPos + 10, { align:'center' });
}
}
const pageCount = doc.internal.getNumberOfPages();
for (let i = 1; i <= pageCount; i++) {
doc.setPage(i);
doc.setFontSize(7); doc.setTextColor(160);
doc.text(
`Generated on ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})} at ${new Date().toLocaleTimeString('en-US')} | GULL AND ZUBAIR NASWAR DEALERS`,
pageW/2, 291, { align:'center' }
);
doc.text(`Page ${i} of ${pageCount}`, pageW/2, 287, { align:'center' });
}
const filename = `Unified_Statement_${viewMode}_${periodFilter}_${new Date().toISOString().split('T')[0]}.pdf`;
doc.save(filename);
showToast('PDF exported successfully!', 'success');
} catch (error) {
showToast('Error generating PDF: ' + error.message, 'error');
}
}
function formatExpenseDate(dateString) {
const date = new Date(dateString);
const month = date.toLocaleDateString('en-US', { month: 'short' });
const day = String(date.getDate()).padStart(2, '0');
const year = String(date.getFullYear()).slice(-2);
return `${month} ${day} ${year}`;
}
function toSafeDate(value) {
if (!value) return null;
if (typeof value === 'object' && value !== null && typeof value.seconds === 'number') {
return new Date(value.seconds * 1000);
}
if (value instanceof Date) return value;
const d = new Date(value);
return isNaN(d.getTime()) ? null : d;
}
function formatDisplayDate(dateInput) {
if (!dateInput) return '-';
const date = toSafeDate(dateInput);
if (!date || isNaN(date.getTime())) return '-';
const month = date.toLocaleDateString('en-US', { month: 'short' });
const day = String(date.getDate()).padStart(2, '0');
const year = String(date.getFullYear()).slice(-2);
return `${month} ${day} ${year}`;
}
async function openExpenseEntityDetails(expenseId) {
const expense = expenseRecords.find(e => e.id === expenseId);
if (!expense) {
showToast('Expense not found', 'error');
return;
}
if (expense.category === 'operating') {
await openOperatingExpenseOverlay(expense.name);
return;
}
const entity = paymentEntities.find(e =>
e.name.toLowerCase() === expense.name.toLowerCase()
);
if (entity) {
openEntityDetailsOverlay(entity.id);
} else {
showToast('Entity not found for this expense', 'warning');
}
}
async function openOperatingExpenseOverlay(expenseName) {
currentExpenseOverlayName = expenseName;
const labelEl = document.getElementById('quickExpenseNameLabel');
if (labelEl) labelEl.textContent = expenseName;
const qAmount = document.getElementById('quickExpenseAmount');
const qDesc = document.getElementById('quickExpenseDescription');
if (qAmount) qAmount.value = '';
if (qDesc) qDesc.value = '';
const rangeEl = document.getElementById('expenseOverlayRange');
if (rangeEl) rangeEl.value = 'all';
requestAnimationFrame(() => {
document.body.style.overflow = 'hidden';
document.documentElement.style.overflow = 'hidden';
const overlayEl = document.getElementById('expenseDetailsOverlay');
if (overlayEl) overlayEl.style.display = 'flex';
});
renderExpenseOverlayContent();
}
function closeExpenseDetailsOverlay() {
requestAnimationFrame(() => {
document.body.style.overflow = '';
document.documentElement.style.overflow = '';
const overlayEl = document.getElementById('expenseDetailsOverlay');
if (overlayEl) overlayEl.style.display = 'none';
});
currentExpenseOverlayName = null;
refreshPaymentTab();
}
function renderExpenseOverlayContent() {
const expenseName = currentExpenseOverlayName;
if (!expenseName) return;
const titleEl = document.getElementById('expenseOverlayTitle');
if (titleEl) titleEl.innerText = expenseName;
const rangeEl = document.getElementById('expenseOverlayRange');
const range = rangeEl ? rangeEl.value : 'all';
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
let relatedExpenses = expenseRecords.filter(e =>
e.category === 'operating' &&
e.name.toLowerCase() === expenseName.toLowerCase()
);
if (range !== 'all') {
relatedExpenses = relatedExpenses.filter(e => {
if (!e.date) return false;
const d = new Date(e.date);
switch (range) {
case 'today': return d >= today;
case 'week': { const w = new Date(today); w.setDate(w.getDate() - 7); return d >= w; }
case 'month': { const m = new Date(today); m.setMonth(m.getMonth() - 1); return d >= m; }
case 'year': { const y = new Date(today); y.setFullYear(y.getFullYear() - 1); return d >= y; }
default: return true;
}
});
}
relatedExpenses.sort((a, b) => new Date(b.date) - new Date(a.date));
const allTimeTotal = expenseRecords
.filter(e => e.category === 'operating' && e.name.toLowerCase() === expenseName.toLowerCase())
.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
const filteredTotal = relatedExpenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
const count = relatedExpenses.length;
const statsEl = document.getElementById('expenseOverlayStats');
if (statsEl) {
statsEl.innerHTML = `
<span style="color:var(--warning); font-weight:800;">Total: ${fmtAmt(filteredTotal)}</span>
<span style="display:inline-flex; gap:8px; margin-left:12px; flex-wrap:wrap;">
<span style="background:rgba(255,184,48,0.15); color:var(--warning); padding:2px 8px; border-radius:10px; font-size:0.7rem; font-weight:700;">
${count} record${count !== 1 ? 's' : ''}
</span>
<span style="background:rgba(255,77,109,0.15); color:var(--danger); padding:2px 8px; border-radius:10px; font-size:0.7rem; font-weight:700;">
All-Time: ${fmtAmt(allTimeTotal)}
</span>
</span>`;
}
const list = document.getElementById('expenseManagementHistoryList');
if (!list) return;
if (relatedExpenses.length === 0) {
list.replaceChildren(Object.assign(document.createElement('div'), {className:'u-empty-state-sm',textContent:'No expense records found for selected period'}));
return;
}
const _expFrag = document.createDocumentFragment();
relatedExpenses.forEach(exp => {
const item = document.createElement('div');
item.className = 'cust-history-item';
item.innerHTML = `
<div class="cust-history-info">
<div class="u-mono-bold" >${formatDisplayDate(exp.date)}${exp.isMerged ? _mergedBadgeHtml(exp, {inline:true}) : ''}</div>
<div class="u-fs-sm2 u-text-muted" >${esc(exp.description || 'No description')}</div>
</div>
<div style="text-align:right; margin-right:10px;">
<span style="background:rgba(255,184,48,0.15); color:var(--warning); padding:2px 6px; border-radius:4px; font-size:0.65rem; font-weight:700;">EXPENSE</span>
<div class="cost-val" style="font-size:0.9rem; margin-top:2px;">${fmtAmt(parseFloat(exp.amount) || 0)}</div>
</div>
${exp.isMerged ? '' : `<button class="btn btn-sm btn-danger u-p-4-8" onclick="deleteExpenseFromOverlay('${esc(exp.id)}')">⌫</button>`}
`;
_expFrag.appendChild(item);
});
list.replaceChildren(_expFrag);
}
function filterExpenseManagementHistory() {
const term = document.getElementById('expense-history-search').value.toLowerCase();
const items = document.querySelectorAll('#expenseManagementHistoryList .cust-history-item');
items.forEach(item => {
item.style.display = item.innerText.toLowerCase().includes(term) ? 'flex' : 'none';
});
}
async function deleteExpenseFromOverlay(expenseId) {
await deleteExpense(expenseId);
const overlayEl = document.getElementById('expenseDetailsOverlay');
if (overlayEl && overlayEl.style.display === 'flex' && currentExpenseOverlayName) {
renderExpenseOverlayContent();
}
}
async function saveQuickExpenseEntry() {
const amountEl = document.getElementById('quickExpenseAmount');
const descEl = document.getElementById('quickExpenseDescription');
if (!amountEl) return;
const amount = parseFloat(amountEl.value);
if (!amount || amount <= 0) {
showToast('Please enter a valid amount', 'warning');
return;
}
const expenseName = currentExpenseOverlayName;
if (!expenseName) return;
try {
const now = new Date();
const dateStr = now.toISOString().split('T')[0];
let expenseId = generateUUID('exp');
if (!validateUUID(expenseId)) expenseId = generateUUID('exp');
let newExpense = {
id: expenseId,
name: expenseName,
amount: amount,
date: dateStr,
category: 'operating',
description: descEl ? descEl.value.trim() : '',
createdAt: now.getTime(),
updatedAt: now.getTime(),
syncedAt: now.toISOString()
};
newExpense = ensureRecordIntegrity(newExpense, false);
expenseRecords.push(newExpense);
await unifiedSave('expenses', expenseRecords, newExpense);
notifyDataChange('expenses');
showToast(` Expense added under "${expenseName}"`, 'success');
if (amountEl) amountEl.value = '';
if (descEl) descEl.value = '';
renderExpenseOverlayContent();
if (typeof calculateNetCash === 'function') calculateNetCash();
if (typeof calculateCashTracker === 'function') calculateCashTracker();
} catch (error) {
showToast('Failed to save expense. Please try again.', 'error');
}
}
async function deleteAllExpensesByName() {
const expenseName = currentExpenseOverlayName;
if (!expenseName) return;
const toDelete = expenseRecords.filter(e =>
e.category === 'operating' &&
e.name.toLowerCase() === expenseName.toLowerCase()
);
if (toDelete.length === 0) {
closeExpenseDetailsOverlay();
return;
}
const _daeTotal = toDelete.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
const _daeDateRange = toDelete.length > 1 ? ` (${toDelete[toDelete.length-1].date} – ${toDelete[0].date})` : (toDelete[0]?.date ? ` on ${toDelete[0].date}` : '');
const _daeTxCount = paymentTransactions.filter(t => toDelete.some(e => e.id === t.expenseId)).length;
let _daeMsg = `Permanently delete ALL ${toDelete.length} expense record${toDelete.length !== 1 ? 's' : ''} for "${expenseName}"?`;
_daeMsg += `\nTotal Amount: ${fmtAmt(_daeTotal)}`;
if (toDelete.length > 1) _daeMsg += `\nDate Range: ${toDelete[toDelete.length-1].date} – ${toDelete[0].date}`;
else if (toDelete[0]?.date) _daeMsg += `\nDate: ${toDelete[0].date}`;
if (_daeTxCount > 0) _daeMsg += `\n\n↩ ${_daeTxCount} linked payment transaction${_daeTxCount !== 1 ? 's' : ''} will also be reversed.`;
_daeMsg += `\n\nThis cannot be undone.`;
if (!(await showGlassConfirm(_daeMsg, { title: `Delete All "${expenseName}" Records`, confirmText: "Delete All", danger: true }))) return;
try {
for (const exp of toDelete) {
expenseRecords = expenseRecords.filter(e => e.id !== exp.id);
await unifiedDelete('expenses', expenseRecords, exp.id, { strict: true }, exp);
const linked = paymentTransactions.filter(t => t.expenseId === exp.id);
if (linked.length > 0) {
const linkedToDelete = linked.slice();
paymentTransactions = paymentTransactions.filter(t => t.expenseId !== exp.id);
for (const tx of linkedToDelete) {
await unifiedDelete('payment_transactions', paymentTransactions, tx.id, { strict: true }, tx);
}
}
}
notifyDataChange('expenses');
showToast(` All "${expenseName}" expense records deleted`, 'success');
closeExpenseDetailsOverlay();
if (typeof renderUnifiedTable === 'function') renderUnifiedTable(1);
if (typeof calculateNetCash === 'function') calculateNetCash();
if (typeof calculateCashTracker === 'function') calculateCashTracker();
if (typeof renderRecentExpenses === 'function') renderRecentExpenses();
} catch (error) {
showToast('Failed to delete all expense records. Please try again.', 'error');
}
}
async function exportExpenseOverlayToPDF() {
const expenseName = currentExpenseOverlayName;
if (!expenseName) { showToast('No expense selected', 'warning'); return; }
const rangeEl = document.getElementById('expenseOverlayRange');
const range = rangeEl ? rangeEl.value : 'all';
showToast('Generating PDF...', 'info');
try {
if (!window.jspdf) {
await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js');
}
if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('Failed to load PDF library.');
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
let records = expenseRecords.filter(e =>
e.category === 'operating' &&
e.name && e.name.toLowerCase() === expenseName.toLowerCase()
);
if (range !== 'all') {
records = records.filter(e => {
if (!e.date) return false;
const d = new Date(e.date);
switch (range) {
case 'today': return d >= today;
case 'week': { const w = new Date(today); w.setDate(w.getDate() - 7); return d >= w; }
case 'month': { const m = new Date(today); m.setMonth(m.getMonth() - 1); return d >= m; }
case 'year': { const y = new Date(today); y.setFullYear(y.getFullYear() - 1); return d >= y; }
default: return true;
}
});
}
records.sort((a, b) => new Date(a.date) - new Date(b.date));
const total = records.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
const rangeName = range === 'all' ? 'All Time' : range.charAt(0).toUpperCase() + range.slice(1);
const { jsPDF } = window.jspdf;
const doc = new jsPDF('p', 'mm', 'a4');
const pageW = doc.internal.pageSize.getWidth();
const hdrColor = [255, 149, 0];
doc.setFillColor(...hdrColor);
doc.rect(0, 0, pageW, 22, 'F');
doc.setFontSize(15); doc.setFont(undefined,'bold'); doc.setTextColor(255,255,255);
doc.text('GULL AND ZUBAIR NASWAR DEALERS', pageW/2, 10, { align:'center' });
doc.setFontSize(9); doc.setFont(undefined,'normal');
doc.text('Naswar Manufacturers & Dealers', pageW/2, 17, { align:'center' });
doc.setFontSize(12); doc.setFont(undefined,'bold'); doc.setTextColor(50,50,50);
doc.text(`Expense History: ${expenseName}`, pageW/2, 30, { align:'center' });
doc.setFontSize(9); doc.setFont(undefined,'normal'); doc.setTextColor(80,80,80);
doc.setFont(undefined,'bold'); doc.text('Period:', 14, 38);
doc.setFont(undefined,'normal'); doc.text(rangeName, 34, 38);
doc.setFont(undefined,'bold'); doc.text('Records:', 75, 38);
doc.setFont(undefined,'normal'); doc.text(String(records.length), 98, 38);
doc.setFont(undefined,'bold'); doc.text('Total:', 120, 38);
doc.setFont(undefined,'normal'); doc.setTextColor(...hdrColor); doc.setFont(undefined,'bold');
doc.text('Rs ' + fmtAmt(total), 138, 38);
doc.setTextColor(80,80,80); doc.setFont(undefined,'normal');
doc.setFont(undefined,'bold'); doc.text('Generated:', 14, 44);
doc.setFont(undefined,'normal'); doc.text(now.toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}) + ' at ' + now.toLocaleTimeString('en-US'), 42, 44);
doc.setDrawColor(...hdrColor); doc.setLineWidth(0.5);
doc.line(14, 47, pageW - 14, 47);
if (records.length > 0) {
const mergedExpRecs = records.filter(e => e.isMerged === true);
const normalExpRecs = records.filter(e => !e.isMerged);
let tableStartY = 51;
if (mergedExpRecs.length > 0) {
  tableStartY = _pdfDrawMergedSectionHeader(doc, tableStartY, pageW, 'YEAR-END EXPENSE SUMMARIES (Carried Forward)');
  const mergedRows = mergedExpRecs.map(e => {
    const ms = e.mergedSummary || {};
    const period = _pdfMergedPeriodLabel(e);
    const count  = _pdfMergedCountLabel(e);
    return [
      period,
      `${count} — ${(e.description||'Year-end merged total').substring(0,45)}`,
      'Rs ' + fmtAmt(parseFloat(e.amount)||0),
      '\u2605 MERGED'
    ];
  });
  const mTot = mergedExpRecs.reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
  mergedRows.push(['','SUBTOTAL ('+mergedExpRecs.length+' year periods)','Rs '+fmtAmt(mTot),'']);
  doc.autoTable({startY:tableStartY,head:[['Year Period','Summary','Amount','Note']],body:mergedRows,theme:'grid',
    headStyles:{fillColor:PDF_MERGED_HDR_COLOR,textColor:255,fontSize:9,fontStyle:'bold',halign:'center'},
    styles:{fontSize:8.5,cellPadding:3,lineWidth:0.15,lineColor:[200,180,230],overflow:'linebreak'},
    columnStyles:{0:{cellWidth:30,halign:'center'},1:{cellWidth:85},2:{cellWidth:30,halign:'right',fontStyle:'bold'},3:{cellWidth:31,halign:'center',fontStyle:'bold'}},
    didParseCell:function(data){const isSub=data.row.index===mergedRows.length-1;if(isSub){data.cell.styles.fillColor=[230,210,255];data.cell.styles.fontStyle='bold';data.cell.styles.fontSize=9.5;}else{data.cell.styles.fillColor=PDF_MERGED_ROW_COLOR;data.cell.styles.textColor=[80,40,120];}if(data.column.index===2)data.cell.styles.textColor=isSub?[126,34,206]:[140,60,180];if(data.column.index===3&&!isSub)data.cell.styles.textColor=[126,34,206];},
    margin:{left:14,right:14}});
  tableStartY = doc.lastAutoTable.finalY + 8;
  if (tableStartY > 240) { doc.addPage(); tableStartY = 20; }
}
if (normalExpRecs.length > 0) {
  if (mergedExpRecs.length > 0) {
    doc.setFontSize(8.5); doc.setFont(undefined,'bold'); doc.setTextColor(...hdrColor);
    doc.text('INDIVIDUAL EXPENSE RECORDS', 14, tableStartY);
    doc.setTextColor(80,80,80); doc.setFont(undefined,'normal');
    tableStartY += 5;
  }
}
let runningTotal = 0;
const expenseRows = normalExpRecs.map(e => {
runningTotal += parseFloat(e.amount) || 0;
return [
formatDisplayDate(e.date) || e.date || '-',
(e.description || 'No description').substring(0, 55),
'Rs ' + fmtAmt(parseFloat(e.amount) || 0),
'Rs ' + fmtAmt(runningTotal)
];
});
expenseRows.push(['', 'TOTAL (' + records.length + ' entries)', 'Rs ' + fmtAmt(total), '']);
doc.autoTable({
startY: tableStartY,
head: [['Date', 'Description', 'Amount', 'Cumulative Total']],
body: expenseRows,
theme: 'grid',
headStyles: { fillColor: hdrColor, textColor: 255, fontSize: 9, fontStyle:'bold', halign:'center' },
styles: { fontSize: 8.5, cellPadding: 3, lineWidth: 0.15, lineColor:[180,180,180], overflow:'linebreak' },
columnStyles: {
0: { cellWidth: 24, halign:'center' },
1: { cellWidth: 90 },
2: { cellWidth: 30, halign:'right', textColor:[220,53,69], fontStyle:'bold' },
3: { cellWidth: 32, halign:'right', textColor:[255,149,0], fontStyle:'bold' }
},
didParseCell: function(data) {
const isTotal = data.row.index === expenseRows.length - 1;
if (isTotal) {
data.cell.styles.fontStyle = 'bold';
data.cell.styles.fillColor = [255, 245, 235];
data.cell.styles.fontSize = 9.5;
if (data.column.index === 2) data.cell.styles.textColor = [220, 53, 69];
}
},
margin: { left: 14, right: 14 }
});
if (range === 'all' && records.length > 5) {
const afterY = doc.lastAutoTable.finalY + 8;
if (afterY < 258) {
const monthTotals = {};
records.forEach(e => {
if (!e.date) return;
const d = new Date(e.date);
const key = d.toLocaleDateString('en-US',{year:'numeric',month:'short'});
monthTotals[key] = (monthTotals[key] || 0) + (parseFloat(e.amount) || 0);
});
doc.setFontSize(9); doc.setFont(undefined,'bold'); doc.setTextColor(50,50,50);
doc.text('Monthly Breakdown:', 14, afterY);
let bkY = afterY + 5;
doc.setFont(undefined,'normal'); doc.setFontSize(8.5);
Object.entries(monthTotals).forEach(([month, amt]) => {
if (bkY > 278) return;
doc.setTextColor(80,80,80); doc.text(month, 14, bkY);
doc.setTextColor(220,53,69); doc.setFont(undefined,'bold');
doc.text('Rs ' + fmtAmt(amt), 60, bkY);
doc.setFont(undefined,'normal');
bkY += 5;
});
}
}
} else {
doc.setFont(undefined,'normal'); doc.setFontSize(10); doc.setTextColor(150);
doc.text(`No expense records found for "${expenseName}" in the selected period.`, pageW/2, 70, { align:'center' });
}
const pageCount = doc.internal.getNumberOfPages();
for (let i = 1; i <= pageCount; i++) {
doc.setPage(i);
doc.setFontSize(7); doc.setTextColor(160);
doc.text(
`Generated on ${now.toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})} at ${now.toLocaleTimeString('en-US')} | GULL AND ZUBAIR NASWAR DEALERS`,
pageW/2, 291, { align:'center' }
);
doc.text(`Page ${i} of ${pageCount}`, pageW/2, 287, { align:'center' });
}
doc.save(`Expense_${expenseName.replace(/\s+/g,'_')}_${range}_${new Date().toISOString().split('T')[0]}.pdf`);
showToast('PDF exported successfully', 'success');
} catch (error) {
showToast('Failed to export PDF: ' + error.message, 'error');
}
}
async function deleteExpense(expenseId) {
if (!expenseId || !validateUUID(expenseId)) {
showToast('Invalid expense ID', 'error');
return;
}
const expense = expenseRecords.find(e => e.id === expenseId);
if (!expense) {
const orphans = paymentTransactions.filter(t => t.expenseId === expenseId);
if (orphans.length > 0) {
const orphansCopy = orphans.slice();
paymentTransactions = paymentTransactions.filter(t => t.expenseId !== expenseId);
for (const tx of orphansCopy) {
await unifiedDelete('payment_transactions', paymentTransactions, tx.id, { strict: true }, tx);
}
}
renderRecentExpenses();
if (typeof refreshPaymentTab === 'function') await refreshPaymentTab();
if (typeof calculateNetCash === 'function') calculateNetCash();
if (typeof calculateCashTracker === 'function') calculateCashTracker();
if (typeof renderUnifiedTable === 'function') renderUnifiedTable(1);
return;
}
const linkedTransactions = paymentTransactions.filter(t => t.expenseId === expenseId);
const categoryLabel = expense.category === 'operating' ? 'Operating Expense'
: expense.category === 'IN' ? 'Payment IN'
: expense.category === 'OUT' ? 'Payment OUT'
: 'Expense';
const _dePayableOuts = linkedTransactions.filter(t => t.type === 'OUT' && t.isPayable === true);
const _deEntityIds = [...new Set(_dePayableOuts.map(t => t.entityId))];
const _deEntityNames = _deEntityIds.map(eid => { const e = paymentEntities.find(x => String(x.id) === String(eid)); return e?.name || 'Supplier'; });
let confirmMsg = `Permanently delete this ${categoryLabel}?`;
confirmMsg += `\n\nName: ${esc(expense.name || 'Unnamed')}`;
confirmMsg += `\nAmount: ${(parseFloat(expense.amount)||0).toFixed(2)}`;
confirmMsg += `\nDate: ${expense.date || 'Unknown'}`;
if (expense.description) confirmMsg += `\nNote: ${esc(expense.description)}`;
if (linkedTransactions.length > 0) {
const _deTxTotal = linkedTransactions.reduce((s, t) => s + (parseFloat(t.amount)||0), 0);
confirmMsg += `\n\n\u21a9 ${linkedTransactions.length} linked payment transaction${linkedTransactions.length !== 1 ? 's' : ''} (${fmtAmt(_deTxTotal)}) will be reversed.`;
if (_deEntityNames.length > 0) confirmMsg += `\n Suppliers affected: ${_deEntityNames.join(', ')} — payable status will be reset to pending.`;
}
confirmMsg += `\n\nThis cannot be undone.`;
if (!(await showGlassConfirm(confirmMsg, { title: `Delete ${categoryLabel}`, confirmText: "Delete", danger: true }))) return;
try {
const txToDelete = paymentTransactions.filter(t => t.expenseId === expenseId);
const payableOuts = txToDelete.filter(t => t.type === 'OUT' && t.isPayable === true);
const affectedSupplierIds = [...new Set(payableOuts.map(t => String(t.entityId)))];
const deletingIds = new Set(txToDelete.map(t => t.id));
for (const supplierId of affectedSupplierIds) {
const supplierMaterials = factoryInventoryData.filter(m =>
String(m.supplierId) === String(supplierId)
);
supplierMaterials.forEach(mat => {
const originalAmount = parseFloat((
mat.totalValue ||
(mat.purchaseCost && mat.purchaseQuantity ? mat.purchaseCost * mat.purchaseQuantity : mat.quantity * mat.cost) ||
0
).toFixed(2));
mat.totalPayable = originalAmount;
mat.paymentStatus = 'pending';
delete mat.paidDate;
mat.updatedAt = getTimestamp();
ensureRecordIntegrity(mat, true);
});
const remainingPayments = paymentTransactions
.filter(t =>
!deletingIds.has(t.id) &&
t.isPayable === true &&
t.type === 'OUT' &&
String(t.entityId) === String(supplierId)
)
.sort((a, b) => new Date(a.date || a.createdAt || 0) - new Date(b.date || b.createdAt || 0));
const sortedMaterials = supplierMaterials.slice().sort((a, b) =>
new Date(a.purchaseDate || a.date || a.createdAt || 0) -
new Date(b.purchaseDate || b.date || b.createdAt || 0)
);
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
for (const mat of supplierMaterials) {
await unifiedSave('factory_inventory_data', factoryInventoryData, mat);
}
}
if (txToDelete.length > 0) {
paymentTransactions = paymentTransactions.filter(t => t.expenseId !== expenseId);
for (const trans of txToDelete) {
await unifiedDelete('payment_transactions', paymentTransactions, trans.id, { strict: true }, trans);
}
}
expenseRecords = expenseRecords.filter(e => e.id !== expenseId);
await unifiedDelete('expenses', expenseRecords, expenseId, { strict: true }, expense);
notifyDataChange('expenses');
renderRecentExpenses();
if (typeof refreshPaymentTab === 'function') await refreshPaymentTab();
if (typeof calculateNetCash === 'function') calculateNetCash();
if (typeof calculateCashTracker === 'function') calculateCashTracker();
if (typeof renderFactoryInventory === 'function') renderFactoryInventory();
if (typeof renderUnifiedTable === 'function') renderUnifiedTable(1);
const label = expense.category === 'operating' ? 'Expense' : `Payment ${expense.category}`;
showToast(` ${label} deleted — all balances and views restored!`, 'success');
} catch (error) {
showToast('Failed to delete expense. Please try again.', 'error');
}
}
function clearExpenseForm() {
document.getElementById('expenseName').value = '';
document.getElementById('expenseAmount').value = '';
document.getElementById('expenseDescription').value = '';
document.getElementById('expenseDate').value = new Date().toISOString().split('T')[0];
document.getElementById('expense-search-results').classList.add('hidden');
selectExpenseCategory('operating', document.getElementById('btn-category-operating'));
['btn-category-operating','btn-category-in','btn-category-out'].forEach(id => {
const btn = document.getElementById(id);
if (btn) { btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
});
const expIdEl = document.getElementById('expense-id-display');
if (expIdEl && typeof generateUUID === 'function') {
const previewId = generateUUID('exp');
expIdEl.textContent = 'ID: ' + previewId.split('-').slice(0,2).join('-') + '…';
expIdEl.title = previewId;
}
}
function getCategoryColor(category) {
switch(category) {
case 'operating': return 'var(--danger)';
case 'loan': return 'var(--warning)';
case 'misc': return 'var(--accent)';
default: return 'var(--text-muted)';
}
}
function getCategoryLabel(category) {
switch(category) {
case 'operating': return 'Operating';
case 'loan': return '▬ Loan/Debt';
case 'misc': return ' Miscellaneous';
default: return 'Other';
}
}
async function openDataMenu() {
if (appMode === 'rep') {
return;
}
const adminSection = document.getElementById('admin-controls-section');
if (adminSection) {
adminSection.style.display = 'block';
}

if (typeof updateSyncButton === 'function') updateSyncButton();
requestAnimationFrame(() => {
document.body.style.overflow = 'hidden';
document.documentElement.style.overflow = 'hidden';
document.getElementById('dataMenuOverlay').style.display = 'flex';
});
const lastSync = await idb.get('last_synced');
const display = document.getElementById('lastSyncDisplay');
if (display) {
display.textContent = lastSync ?
`Last Cloud Sync: ${new Date(lastSync).toLocaleString()}` :
'Not synced yet';
}
}
function closeDataMenu() {
requestAnimationFrame(() => {
document.body.style.overflow = '';
document.documentElement.style.overflow = '';
document.getElementById('dataMenuOverlay').style.display = 'none';
});
}
const _recoveredThisSession = new Set();
async function purgeRecoveredId(id, collectionName, cleanRecord, newId) {
  const sid    = String(id);
  const newSid = newId ? String(newId) : sid;
  _recoveredThisSession.add(sid);
  deletedRecordIds.delete(sid);
  if (typeof deletionRecords !== 'undefined' && Array.isArray(deletionRecords)) {
    deletionRecords = deletionRecords.filter(r =>
      r.id !== sid && r.recordId !== sid
    );
  }
  try {
    const freshDeletionRecords = await idb.get('deletion_records', []);
    const prunedDeletionRecords = Array.isArray(freshDeletionRecords)
      ? freshDeletionRecords.filter(r => r.id !== sid && r.recordId !== sid)
      : [];
    await idb.set('deletion_records', prunedDeletionRecords);
  } catch(e) { console.warn('[RecycleBin] purge IDB deletion_records failed:', e); }
  try {
    await idb.set('deleted_records', Array.from(deletedRecordIds));
  } catch(e) { console.warn('[RecycleBin] purge IDB deleted_records failed:', e); }
  if (typeof OfflineQueue !== 'undefined') {
    const _isStaleDeleteOp = (item) => {
      const op = item.operation || {};
      return (
        (op.action === 'delete' && op.docId === sid) ||
        (op.action === 'set'    && op.docId === sid && (op.data === null || op.data === undefined))
      );
    };
    const qBefore = OfflineQueue.queue.length;
    OfflineQueue.queue = OfflineQueue.queue.filter(item => !_isStaleDeleteOp(item));
    if (OfflineQueue.queue.length !== qBefore) {
      try { await OfflineQueue.saveQueue(); } catch(e) {}
    }
    const dlBefore = (OfflineQueue.deadLetterQueue || []).length;
    if (Array.isArray(OfflineQueue.deadLetterQueue)) {
      OfflineQueue.deadLetterQueue = OfflineQueue.deadLetterQueue.filter(item => !_isStaleDeleteOp(item));
      if (OfflineQueue.deadLetterQueue.length !== dlBefore) {
        try { await OfflineQueue.saveDeadLetterQueue(); } catch(e) {}
      }
    }
  }
  if (firebaseDB && currentUser) {
    (async () => {
      try {
        const userRef = firebaseDB.collection('users').doc(currentUser.uid);
        const batch = firebaseDB.batch();
        batch.delete(userRef.collection('deletions').doc(sid));
        if (cleanRecord && collectionName) {
          const sanitized = typeof sanitizeForFirestore === 'function'
            ? sanitizeForFirestore({ ...cleanRecord, syncedAt: new Date().toISOString() })
            : { ...cleanRecord, syncedAt: new Date().toISOString() };
          sanitized.id = newSid;
          delete sanitized.originalId;
          sanitized.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
          batch.set(
            userRef.collection(collectionName).doc(newSid),
            sanitized,
            { merge: true }
          );
        }
        await batch.commit();
        trackFirestoreWrite(cleanRecord ? 2 : 1);
      } catch(e) {
        console.warn('[RecycleBin] Cloud purge failed — queuing for retry:', e);
        if (typeof OfflineQueue !== 'undefined') {
          await OfflineQueue.add({
            action: 'delete',
            collection: 'deletions',
            docId: sid,
            data: null
          });
          if (cleanRecord && collectionName) {
            const queuedRecord = typeof sanitizeForFirestore === 'function'
              ? sanitizeForFirestore({ ...cleanRecord, syncedAt: new Date().toISOString() })
              : { ...cleanRecord, syncedAt: new Date().toISOString() };
            queuedRecord.id = newSid;
            delete queuedRecord.originalId;
            await OfflineQueue.add({
              action: 'set',
              collection: collectionName,
              docId: newSid,
              data: queuedRecord
            });
          }
        }
      }
    })();
  }
}
window.purgeRecoveredId = purgeRecoveredId;
async function recoverRecord(deletedId, collectionName) {
  if (!deletedId || !collectionName) return false;
  try {
    const idbKey = getIndexedDBKey(collectionName);
    let recoveredData = null;
    const localDeletionRecords = await idb.get('deletion_records', []);
    const tombstoneLocal = Array.isArray(localDeletionRecords)
      ? localDeletionRecords.find(r => r.id === deletedId || r.recordId === deletedId)
      : null;
    if (tombstoneLocal && tombstoneLocal.snapshot) {
      recoveredData = tombstoneLocal.snapshot;
    }
    if (!recoveredData && firebaseDB && currentUser) {
      try {
        const userRef = firebaseDB.collection('users').doc(currentUser.uid);
        const tombDoc = await userRef.collection('deletions').doc(String(deletedId)).get();
        if (tombDoc.exists) {
          const td = tombDoc.data();
          if (td && td.snapshot) recoveredData = td.snapshot;
        }
        if (!recoveredData) {
          const origDoc = await userRef.collection(collectionName).doc(String(deletedId)).get();
          if (origDoc.exists) recoveredData = origDoc.data();
        }
      } catch(e) { console.warn('[RecycleBin] snapshot fetch failed:', e); }
    }
    let cleanRecord = null;
    if (recoveredData) {
      cleanRecord = { ...recoveredData };
      delete cleanRecord.deletedAt;
      delete cleanRecord.tombstoned_at;
      delete cleanRecord.deleted_by;
      delete cleanRecord.deletion_version;
      delete cleanRecord.recoveredAt;
      delete cleanRecord._placeholder;
      delete cleanRecord.isDeleted;
      delete cleanRecord.softDeleted;
      cleanRecord.updatedAt   = Date.now();
      cleanRecord.recoveredAt = Date.now();
      cleanRecord.syncedAt    = new Date().toISOString();
    }
    const newId = (typeof generateUUID === 'function')
      ? generateUUID('recovered')
      : String(deletedId);
    const oldId = String(deletedId);
    if (cleanRecord) {
      cleanRecord.id = newId;
      delete cleanRecord.originalId;
    }
    await purgeRecoveredId(oldId, collectionName, cleanRecord, newId);
    if (cleanRecord && idbKey) {
      let localArr = await idb.get(idbKey, []);
      if (!Array.isArray(localArr)) localArr = [];
      localArr = localArr.filter(r => r.id !== oldId && r.id !== newId);
      localArr.push(cleanRecord);
      await idb.set(idbKey, localArr);
    }
    if (typeof invalidateAllCaches === 'function') {
      await invalidateAllCaches();
    }
    triggerAutoSync();
    return true;
  } catch(e) {
    console.error('[RecycleBin] recoverRecord error:', _safeErr(e));
    _recoveredThisSession.delete(String(deletedId));
    return false;
  }
}
window.recoverRecord = recoverRecord;
window.registerDeletion = registerDeletion;
const RECYCLE_COLLECTION_TO_TAB = {
  'sales':              'tab_sales',
  'sales_customers':    'tab_sales',
  'rep_sales':          'tab_rep',
  'rep_customers':      'tab_rep',
  'production':         'tab_production',
  'returns':            'tab_production',
  'calculator_history': 'tab_calculator',
  'factory_history':    'tab_factory',
  'inventory':          'tab_factory',
  'transactions':       'tab_payments',
  'expenses':           'tab_payments',
  'entities':           'tab_payments',
  'unknown':            'tab_payments',
};
const RECYCLE_BIN_COLLECTION_LABELS = {
  'sales':              'Customer Sale',
  'sales_customers':    'Customer Contact',
  'rep_sales':          'Rep Sale',
  'rep_customers':      'Rep Customer',
  'production':         'Production Batch',
  'returns':            'Stock Return',
  'calculator_history': 'Calculator Entry',
  'factory_history':    'Factory Production',
  'inventory':          'Inventory Item',
  'transactions':       'Transaction',
  'expenses':           'Expense',
  'entities':           'Payment Entity',
  'unknown':            'Record',
};
const RECYCLE_TAB_LABELS = {
  'tab_sales':       'Sales Tab',
  'tab_rep':         'Rep Tab',
  'tab_production':  'Manufacturing Tab',
  'tab_calculator':  'Calculator Tab',
  'tab_factory':     'Factory Tab',
  'tab_payments':    'Payments Tab',
};
const RECYCLE_RECOVERABLE_COLLECTIONS = new Set([
  'sales','transactions','rep_sales','expenses','production',
  'factory_history','inventory','returns','calculator_history',
  'sales_customers','rep_customers','entities'
]);
async function openRecycleBin() {
  closeDataMenu();
  requestAnimationFrame(() => {
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    const overlay = document.getElementById('recycleBinOverlay');
    if (overlay) overlay.style.display = 'flex';
  });
  await renderRecycleBin();
}
function closeRecycleBin() {
  requestAnimationFrame(() => {
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    const overlay = document.getElementById('recycleBinOverlay');
    if (overlay) overlay.style.display = 'none';
  });
}
async function renderRecycleBin(filterCollection = 'all') {
  const container = document.getElementById('recycleBinList');
  const statsEl   = document.getElementById('recycleBinStats');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">Loading...</div>';
  try {
    let deletionRecords = await idb.get('deletion_records', []);
    if (!Array.isArray(deletionRecords)) deletionRecords = [];
    deletionRecords = deletionRecords.filter(r =>
      !_recoveredThisSession.has(r.id) && !_recoveredThisSession.has(r.recordId)
    );
    if (firebaseDB && currentUser) {
      try {
        const userRef = firebaseDB.collection('users').doc(currentUser.uid);
        const snap = await userRef.collection('deletions').orderBy('deletedAt', 'desc').limit(200).get();
        const seenIds = new Set(deletionRecords.map(r => String(r.id)));
        const seenRecordIds = new Set(deletionRecords.map(r => String(r.recordId || r.id)));
        snap.docs.forEach(doc => {
          const d = doc.data();
          if (!d || d._placeholder) return;
          const docId = String(doc.id);
          const recId = String(d.recordId || d.id || doc.id);
          if (_recoveredThisSession.has(docId) || _recoveredThisSession.has(recId)) return;
          if (seenIds.has(docId) || seenRecordIds.has(docId) ||
              seenIds.has(recId)  || seenRecordIds.has(recId)) return;
          seenIds.add(docId);
          seenRecordIds.add(recId);
          deletionRecords.push({
            id: docId,
            recordId: recId,
            collection: d.collection || d.recordType || 'unknown',
            deletedAt: d.deletedAt?.toMillis ? d.deletedAt.toMillis() : (d.deletedAt || Date.now()),
            syncedToCloud: true,
            deleted_by: d.deleted_by || 'user',
            snapshot: d.snapshot || null,
            displayName: d.displayName || null,
            displayDetail: d.displayDetail || null,
            displayAmount: d.displayAmount || null,
          });
        });
      } catch(e) {   }
    }
    const _seen = new Map();
    deletionRecords.forEach(r => {
      const key = String(r.id || r.recordId);
      const existing = _seen.get(key);
      if (!existing || (!existing.displayName && r.displayName) ||
          (!existing.snapshot && r.snapshot)) {
        _seen.set(key, r);
      }
    });
    deletionRecords = Array.from(_seen.values());

    deletionRecords.forEach(r => {
      if (r.displayName) return;
      const col = r.collection || 'unknown';
      const s = r.snapshot;
      if (s && typeof s === 'object') {

        if (col === 'sales') {
          r.displayName   = s.customerName || s.name || null;
          r.displayDetail = r.displayDetail || [s.supplyStore || s.store || '', s.paymentType || '', s.date || ''].filter(Boolean).join(' · ');
          r.displayAmount = r.displayAmount || (s.totalValue != null ? `₨${Number(s.totalValue).toLocaleString()}` : null);
        } else if (col === 'rep_sales') {
          r.displayName   = s.customerName || s.name || null;
          r.displayDetail = r.displayDetail || [s.salesRep ? `Rep: ${s.salesRep}` : '', s.paymentType || '', s.date || ''].filter(Boolean).join(' · ');
          r.displayAmount = r.displayAmount || (s.totalValue != null ? `₨${Number(s.totalValue).toLocaleString()}` : null);
        } else if (col === 'transactions') {
          r.displayName   = s.entityName || s.name || s.description || null;
          r.displayDetail = r.displayDetail || [s.type === 'IN' ? '↓ IN' : s.type === 'OUT' ? '↑ OUT' : (s.type || ''), s.date || ''].filter(Boolean).join(' · ');
          r.displayAmount = r.displayAmount || (s.amount != null ? `₨${Number(s.amount).toLocaleString()}` : null);
        } else if (col === 'expenses') {
          r.displayName   = s.name || s.description || null;
          r.displayDetail = r.displayDetail || [s.category || '', s.date || ''].filter(Boolean).join(' · ');
          r.displayAmount = r.displayAmount || (s.amount != null ? `₨${Number(s.amount).toLocaleString()}` : null);
        } else if (col === 'production') {
          r.displayName   = s.supplyStore || s.store ? `Production – ${s.supplyStore || s.store}` : null;
          r.displayDetail = r.displayDetail || s.date || '';
          r.displayAmount = r.displayAmount || (s.net != null ? `${s.net} kg` : null);
        } else if (col === 'returns') {
          r.displayName   = s.store ? `Return – ${s.store}` : null;
          r.displayDetail = r.displayDetail || s.date || '';
        } else if (col === 'factory_history') {
          r.displayName   = s.store ? `Factory – ${s.store}` : null;
          r.displayDetail = r.displayDetail || s.date || '';
        } else if (col === 'sales_customers' || col === 'rep_customers') {
          r.displayName   = s.name || null;
        } else {
          r.displayName   = s.name || s.customerName || s.entityName || s.description || null;
          r.displayAmount = r.displayAmount || ((s.amount ?? s.totalValue) != null ? `₨${Number(s.amount ?? s.totalValue).toLocaleString()}` : null);
        }
      }

      if (!r.displayName) {
        try {
          const live = _captureRecordSnapshot(r.id || r.recordId, col);
          if (live && live.displayName) {
            r.displayName   = live.displayName;
            r.displayDetail = r.displayDetail || live.displayDetail;
            r.displayAmount = r.displayAmount || live.displayAmount;
          }
        } catch(_e) {}
      }
    });
    deletionRecords.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
    if (statsEl) {
      statsEl.textContent = `${deletionRecords.length} deleted record${deletionRecords.length !== 1 ? 's' : ''} (kept for 90 days)`;
    }
    const filterSel = document.getElementById('recycleBinFilter');
    if (filterSel && filterSel.value !== filterCollection) filterSel.value = filterCollection;
    const filtered = filterCollection === 'all'
      ? deletionRecords
      : deletionRecords.filter(r => {
          const tab = RECYCLE_COLLECTION_TO_TAB[r.collection || 'unknown'] || 'tab_payments';
          return tab === filterCollection;
        });
    if (filtered.length === 0) {
      container.innerHTML = `<div style="text-align:center;padding:50px 20px;color:var(--text-muted);">
        <div style="font-size:1rem;font-weight:600;">Recycle Bin is empty</div>
        <div style="font-size:0.78rem;margin-top:6px;">Deleted transactions will appear here and can be recovered within 90 days.</div>
      </div>`;
      return;
    }
    container.innerHTML = filtered.map(rec => {
      const col = rec.collection || 'unknown';
      const tabKey = RECYCLE_COLLECTION_TO_TAB[col] || 'tab_payments';
      const tabLabel = RECYCLE_TAB_LABELS[tabKey] || tabKey;
      const typeLabel = `${tabLabel} › ${RECYCLE_BIN_COLLECTION_LABELS[col] || col}`;
      const deletedDate = rec.deletedAt
        ? new Date(rec.deletedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
        : 'Unknown date';
      const daysAgo = rec.deletedAt ? Math.floor((Date.now() - rec.deletedAt) / 86400000) : '?';
      const expiresIn = rec.deletedAt ? Math.max(0, 90 - Math.floor((Date.now() - rec.deletedAt) / 86400000)) : '?';
      const canRecover = RECYCLE_RECOVERABLE_COLLECTIONS.has(col);
      let displayName = rec.displayName || null;
      let displayDetail = rec.displayDetail || null;
      let displayAmount = rec.displayAmount || null;
      if (!displayName && rec.snapshot) {
        const snap = _captureRecordSnapshot._fromObj
          ? _captureRecordSnapshot._fromObj(rec.snapshot, col)
          : null;
        if (snap && snap.displayName) {
          displayName   = snap.displayName;
          displayDetail = snap.displayDetail;
          displayAmount = snap.displayAmount;
        } else {
          const s = rec.snapshot;
          if (col === 'sales' || col === 'rep_sales') {
            displayName   = s.customerName || s.name || null;
            displayDetail = [s.supplyStore || s.store || '', s.paymentType || '', s.date || ''].filter(Boolean).join(' · ');
            displayAmount = s.totalValue != null ? `₨${Number(s.totalValue).toLocaleString()}` : null;
          } else if (col === 'transactions') {
            displayName   = s.entityName || s.description || s.name || null;
            displayDetail = [s.type === 'IN' ? '↓ IN' : s.type === 'OUT' ? '↑ OUT' : (s.type || ''), s.date || ''].filter(Boolean).join(' · ');
            displayAmount = s.amount != null ? `₨${Number(s.amount).toLocaleString()}` : null;
          } else if (col === 'expenses') {
            displayName   = s.name || s.description || null;
            displayDetail = [s.category || '', s.date || ''].filter(Boolean).join(' · ');
            displayAmount = s.amount != null ? `₨${Number(s.amount).toLocaleString()}` : null;
          } else if (col === 'production') {
            displayName   = s.supplyStore || s.store ? `Production – ${s.supplyStore || s.store}` : 'Production Batch';
            displayDetail = s.date || '';
            displayAmount = s.net != null ? `${s.net} kg` : null;
          } else if (col === 'returns') {
            displayName   = s.store ? `Return – ${s.store}` : 'Stock Return';
            displayDetail = s.date || '';
            displayAmount = s.quantity != null ? `${s.quantity} kg` : null;
          } else if (col === 'factory_history') {
            displayName   = s.store ? `Factory – ${s.store}` : 'Factory Production';
            displayDetail = s.date || '';
            displayAmount = s.units != null ? `${s.units} units` : null;
          } else if (col === 'calculator_history') {
            displayName   = s.customerName || s.customer || s.name || 'Calculator Entry';
            displayDetail = s.supplyStore || s.store || '';
            displayAmount = s.totalValue != null ? `₨${Number(s.totalValue).toLocaleString()}` : null;
          } else {
            displayName = s.customerName || s.entityName || s.name || s.description || null;
            displayAmount = (s.amount ?? s.totalValue) != null ? `₨${Number(s.amount ?? s.totalValue).toLocaleString()}` : null;
          }
        }
      }
      if (!displayName) {
        const snap = _captureRecordSnapshot(rec.id, col);
        if (snap.displayName) {
          displayName   = snap.displayName;
          displayDetail = snap.displayDetail;
          displayAmount = snap.displayAmount;
        }
      }
      const nameHtml = displayName
        ? `<span style="font-size:0.88rem;font-weight:700;color:var(--text-main);">${esc(displayName)}</span>`
        : `<span style="font-size:0.82rem;font-weight:600;color:var(--text-muted);font-style:italic;">${esc(RECYCLE_BIN_COLLECTION_LABELS[col] || col)} — name unavailable</span>`;
      const detailHtml = displayDetail
        ? `<span style="font-size:0.72rem;color:var(--text-muted);">${esc(displayDetail)}</span>`
        : '';
      const amountHtml = displayAmount
        ? `<span style="font-size:0.78rem;font-weight:700;color:var(--accent);">${esc(displayAmount)}</span>`
        : '';
      const syncBadge = rec.syncedToCloud
        ? `<span style="font-size:0.62rem;background:rgba(16,185,129,0.15);color:#10b981;padding:2px 6px;border-radius:999px;white-space:nowrap;">☁ synced</span>`
        : `<span style="font-size:0.62rem;background:rgba(239,68,68,0.12);color:#ef4444;padding:2px 6px;border-radius:999px;white-space:nowrap;">⚠ local</span>`;
      const colDot = {
        'sales':'#10b981','transactions':'#3b82f6','rep_sales':'#8b5cf6',
        'expenses':'#f59e0b','production':'#ec4899','factory_history':'#14b8a6',
        'returns':'#f97316','unknown':'#9ca3af'
      }[col] || '#9ca3af';
      const typeTag = `<span style="font-size:0.62rem;background:rgba(255,255,255,0.06);color:var(--text-muted);padding:2px 7px;border-radius:999px;border:1px solid var(--glass-border);white-space:nowrap;">${esc(typeLabel)}</span>`;
      return `<div style="background:var(--input-bg);border:1px solid var(--glass-border);border-radius:12px;padding:12px 14px;margin-bottom:9px;display:flex;align-items:center;gap:11px;">
        <div style="width:9px;height:9px;min-width:9px;border-radius:50%;background:${colDot};flex-shrink:0;"></div>
        <div style="flex:1;min-width:0;overflow:hidden;">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:2px;">
            ${nameHtml}
            ${amountHtml}
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px;">
            ${typeTag}
            ${detailHtml}
            ${syncBadge}
          </div>
          <div style="font-size:0.68rem;color:var(--text-muted);">
            Deleted ${daysAgo === 0 ? 'today' : daysAgo + 'd ago'} · ${deletedDate} · expires in ${expiresIn}d
          </div>
        </div>
        ${canRecover
          ? `<button onclick="attemptRecoverRecord('${esc(rec.id)}','${esc(col)}')" style="flex-shrink:0;padding:7px 13px;background:rgba(16,185,129,0.15);color:#10b981;border:1px solid rgba(16,185,129,0.3);border-radius:999px;font-size:0.78rem;font-weight:700;cursor:pointer;">↩ Recover</button>`
          : `<span style="flex-shrink:0;font-size:0.7rem;color:var(--text-muted);padding:4px 8px;">—</span>`}
      </div>`;
    }).join('');
  } catch(e) {
    container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);">Failed to load recycle bin.</div>`;
    console.error('[RecycleBin] render error', _safeErr(e));
  }
}
async function attemptRecoverRecord(id, collectionName) {
  const tabKey = RECYCLE_COLLECTION_TO_TAB[collectionName] || 'tab_payments';
  const tabLabel = RECYCLE_TAB_LABELS[tabKey] || tabKey;
  const label = `${tabLabel} › ${RECYCLE_BIN_COLLECTION_LABELS[collectionName] || collectionName}`;
  if (!(await showGlassConfirm(
    `Recover this ${label}?\n\nIt will be restored to its original collection and become visible again in all views.`,
    { title: '↩ Recover Record', confirmText: 'Recover', danger: false }
  ))) return;
  showToast('Recovering record…', 'info', 1500);
  const ok = await recoverRecord(id, collectionName);
  if (ok) {
    showToast(`${label} recovered successfully!`, 'success');
    notifyDataChange('all');
    if (typeof calculateNetCash === 'function') calculateNetCash();
    if (typeof calculateCashTracker === 'function') calculateCashTracker();
    const filterSel = document.getElementById('recycleBinFilter');
    const current = filterSel ? filterSel.value : 'all';
    await renderRecycleBin(current);
  } else {
    showToast('Recovery failed. The record may have been permanently purged from cloud.', 'error');
  }
}
window.openRecycleBin = openRecycleBin;
window.closeRecycleBin = closeRecycleBin;
window.renderRecycleBin = renderRecycleBin;
window.attemptRecoverRecord = attemptRecoverRecord;
async function triggerLocalBackup() {
closeDataMenu();
if (!currentUser) {
showToast('Please sign in to create a backup.', 'error');
showAuthOverlay();
return;
}
const data = {
mfg: db,
sales: await idb.get('noman_history', []),
customerSales: await idb.get('customer_sales', []),
repSales: await idb.get('rep_sales', []),
repCustomers: await idb.get('rep_customers', []),
salesCustomers: await idb.get('sales_customers', []),
factoryInventoryData: factoryInventoryData,
factoryProductionHistory: factoryProductionHistory,
factoryDefaultFormulas: factoryDefaultFormulas,
factoryAdditionalCosts: factoryAdditionalCosts,
factoryCostAdjustmentFactor: factoryCostAdjustmentFactor,
factorySalePrices: factorySalePrices,
factoryUnitTracking: factoryUnitTracking,
paymentEntities: paymentEntities,
paymentTransactions: paymentTransactions,
expenses: await idb.get('expenses', []),
stockReturns: stockReturns,
settings: await idb.get('naswar_default_settings', defaultSettings),
deleted_records: Array.from(deletedRecordIds),
_meta: { encryptedFor: currentUser.email, createdAt: Date.now(), version: 3 },
backupMetadata: {
version: '3.0',
timestamp: Date.now(),
date: new Date().toISOString(),
deviceInfo: navigator.userAgent.substring(0, 100)
}
};
const encPassword = await promptVerifiedBackupPassword({ inputId: 'enc_local_bkp_pwd' });
if (!encPassword) {
showToast('Backup cancelled.', 'info');
return;
}
try {
showToast('Encrypting backup with AES-256-GCM...', 'info', 3000);
const encryptedBlob = await CryptoEngine.encrypt(data, currentUser.email, encPassword);
const timestamp = new Date().toISOString().split('T')[0];
_triggerFileDownload(encryptedBlob, `NaswarDealers_SecureBackup_${timestamp}.gznd`);
showToast('Encrypted backup saved! Only your account credentials can restore this file.', 'success', 5000);
} catch(encErr) {
console.error('Encryption failed:', _safeErr(encErr));
showToast('Encryption failed: ' + encErr.message, 'error');
}
}
async function uploadOldDataToCloud(event) {
const file = event.target.files[0];
event.target.value = '';
if (!file) return;
if (!firebaseDB || !currentUser) {
showToast('Please sign in first before uploading.', 'warning');
closeDataMenu();
showAuthOverlay();
return;
}
if (isSyncing) {
showToast('Another sync is running. Please wait.', 'info');
return;
}
closeDataMenu();
showToast('Reading backup file...', 'info');
try {
const text = await _readFileAsText(file);
const data = JSON.parse(text);
if (!data.mfg && !data.mfg_pro_pkr && !data.customerSales && !data.repSales && !data.repCustomers) {
showToast('This file does not look like a valid backup.', 'error');
return;
}
const _utcMsg = `Upload this device's local data to the cloud database?\n\n• Existing cloud records will NOT be deleted\n• Where duplicates exist, the newer version wins\n• Deleted records (tombstones) are respected\n• Other devices will receive your changes on their next sync\n\nThis is a one-way push — cloud records newer than yours are preserved.`;
if (!(await showGlassConfirm(_utcMsg, { title: 'Upload Local Data to Cloud', confirmText: 'Upload', cancelText: 'Cancel' }))) return;
isSyncing = true;
showToast('Uploading to cloud...', 'info');
const normalized = {
mfg_pro_pkr: data.mfg || data.mfg_pro_pkr || [],
noman_history: data.sales || data.noman_history || [],
customer_sales: data.customerSales || data.customer_sales || [],
rep_sales: data.repSales || data.rep_sales || [],
rep_customers: data.repCustomers || data.rep_customers || [],
sales_customers: data.salesCustomers || data.sales_customers || [],
factory_inventory_data: data.factoryInventoryData || data.factory_inventory_data || [],
factory_production_history: data.factoryProductionHistory || data.factory_production_history|| [],
payment_entities: data.paymentEntities || data.payment_entities || [],
payment_transactions: data.paymentTransactions || data.payment_transactions || [],
stock_returns: data.stockReturns || data.stock_returns || [],
factory_default_formulas: data.factoryDefaultFormulas || data.factory_default_formulas || { standard: [], asaan: [] },
factory_additional_costs: data.factoryAdditionalCosts || data.factory_additional_costs || { standard: 0, asaan: 0 },
factory_cost_adjustment_factor: data.factoryCostAdjustmentFactor || data.factory_cost_adjustment_factor || { standard: 1, asaan: 1 },
factory_sale_prices: data.factorySalePrices || data.factory_sale_prices || { standard: 0, asaan: 0 },
factory_unit_tracking: data.factoryUnitTracking || data.factory_unit_tracking || {
standard: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
asaan: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] }
},
naswar_default_settings: data.settings || data.naswar_default_settings || {},
deleted_records: data.deleted_records || [],
appMode: data.appMode || 'admin',
repProfile: data.repProfile || salesRepsList[0] || 'NORAN SHAH'
};
const fileTombstones = new Set(normalized.deleted_records);
const filterAlive = (arr) => {
if (!Array.isArray(arr)) return [];
return arr.filter(item => {
if (!item || !item.id) return false;
if (fileTombstones.has(item.id)) return false;
return true;
});
};
normalized.mfg_pro_pkr = filterAlive(normalized.mfg_pro_pkr);
normalized.noman_history = filterAlive(normalized.noman_history);
normalized.customer_sales = filterAlive(normalized.customer_sales);
normalized.rep_sales = filterAlive(normalized.rep_sales);
normalized.rep_customers = filterAlive(normalized.rep_customers);
normalized.sales_customers = filterAlive(normalized.sales_customers);
normalized.factory_inventory_data = filterAlive(normalized.factory_inventory_data);
normalized.factory_production_history = filterAlive(normalized.factory_production_history);
normalized.payment_entities = filterAlive(normalized.payment_entities);
normalized.payment_transactions = filterAlive(normalized.payment_transactions);
normalized.stock_returns = filterAlive(normalized.stock_returns);
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
const buildDeltaQuery = async (collection, collectionName) => {
const lastSync = await DeltaSync.getLastSyncFirestoreTimestamp(collectionName);
if (lastSync) {
return collection.where('updatedAt', '>', lastSync).get();
}
return collection.get();
};
const [
prodSnap, salesSnap, calcSnap, repSnap, transSnap, entSnap,
invSnap, factSnap, retSnap,
repCustomersSnap, salesCustomersSnap, expensesSnap,
settingsSnap, factorySettingsSnap,
expenseCategoriesSnap, deletionsSnap
] = await Promise.all([
buildDeltaQuery(userRef.collection('production'), 'production'),
buildDeltaQuery(userRef.collection('sales'), 'sales'),
buildDeltaQuery(userRef.collection('calculator_history'), 'calculator_history'),
buildDeltaQuery(userRef.collection('rep_sales'), 'rep_sales'),
buildDeltaQuery(userRef.collection('transactions'), 'transactions'),
buildDeltaQuery(userRef.collection('entities'), 'entities'),
buildDeltaQuery(userRef.collection('inventory'), 'inventory'),
buildDeltaQuery(userRef.collection('factory_history'), 'factory_history'),
buildDeltaQuery(userRef.collection('returns'), 'returns'),
buildDeltaQuery(userRef.collection('rep_customers'), 'rep_customers'),
buildDeltaQuery(userRef.collection('sales_customers'), 'sales_customers'),
buildDeltaQuery(userRef.collection('expenses'), 'expenses'),
userRef.collection('settings').doc('config').get(),
userRef.collection('factorySettings').doc('config').get(),
userRef.collection('expenseCategories').doc('categories').get(),
userRef.collection('deletions').get()
]);
const cloudData = {
mfg_pro_pkr: prodSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
customer_sales: salesSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
noman_history: calcSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
rep_sales: repSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
payment_transactions: transSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
payment_entities: entSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
factory_inventory_data: invSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
factory_production_history: factSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
stock_returns: retSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
rep_customers:  repCustomersSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
sales_customers: salesCustomersSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
expenses: expensesSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() }))
};
if (factorySettingsSnap && factorySettingsSnap.exists) {
const factoryData = factorySettingsSnap.data();
cloudData.factory_default_formulas = factoryData.default_formulas || { standard: [], asaan: [] };
cloudData.factory_additional_costs = factoryData.additional_costs || { standard: 0, asaan: 0 };
cloudData.factory_cost_adjustment_factor = factoryData.cost_adjustment_factor || { standard: 1, asaan: 1 };
cloudData.factory_sale_prices = factoryData.sale_prices || { standard: 0, asaan: 0 };
cloudData.factory_unit_tracking = factoryData.unit_tracking || {
standard: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
asaan: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] }
};
} else {
cloudData.factory_default_formulas = { standard: [], asaan: [] };
cloudData.factory_additional_costs = { standard: 0, asaan: 0 };
cloudData.factory_cost_adjustment_factor = { standard: 1, asaan: 1 };
cloudData.factory_sale_prices = { standard: 0, asaan: 0 };
cloudData.factory_unit_tracking = {
standard: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
asaan: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] }
};
}
if (expenseCategoriesSnap && expenseCategoriesSnap.exists) {
const categoriesData = expenseCategoriesSnap.data();
cloudData.expense_categories = categoriesData.categories || [];
} else {
cloudData.expense_categories = [];
}
cloudData.deleted_records = deletionsSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => {
const data = doc.data();
return data.recordId || doc.id;
});
if (settingsSnap && settingsSnap.exists) {
const settings = settingsSnap.data();
cloudData.naswar_default_settings = settings.naswar_default_settings || {};
cloudData.appMode = settings.appMode || 'admin';
cloudData.repProfile = settings.repProfile || {};
} else {
cloudData.naswar_default_settings = {};
cloudData.appMode = 'admin';
cloudData.repProfile = {};
}
function mergeArrays(cloudArr, fileArr) {
if (!Array.isArray(cloudArr)) cloudArr = [];
if (!Array.isArray(fileArr)) fileArr = [];
const _getMs = (rec) => {
  if (!rec) return 0;
  const ts = rec.updatedAt || rec.timestamp || rec.createdAt || rec.date || 0;
  if (typeof ts === 'number') return ts;
  if (ts && typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts && typeof ts === 'object') {
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    if (typeof ts._seconds === 'number') return ts._seconds * 1000;
  }
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'string') { try { const t = new Date(ts).getTime(); if (!isNaN(t)) return t; } catch(e){} }
  return 0;
};
const map = new Map();
cloudArr.forEach(item => {
if (item && item.id) map.set(item.id, item);
});
fileArr.forEach(item => {
if (!item || !item.id) return;
if (fileTombstones.has(item.id)) return;
const existing = map.get(item.id);
if (!existing) {
map.set(item.id, item);
} else {
const _cmpMerge = (typeof compareRecordVersions === 'function')
  ? compareRecordVersions(item, existing)
  : _getMs(item) - _getMs(existing);
if (_cmpMerge >= 0) {
map.set(item.id, item);
}
}
});
return Array.from(map.values());
}
const merged = {
mfg_pro_pkr: mergeArrays(cloudData.mfg_pro_pkr, normalized.mfg_pro_pkr),
noman_history: mergeArrays(cloudData.noman_history, normalized.noman_history),
customer_sales: mergeArrays(cloudData.customer_sales, normalized.customer_sales),
rep_sales: mergeArrays(cloudData.rep_sales, normalized.rep_sales),
factory_inventory_data: mergeArrays(cloudData.factory_inventory_data, normalized.factory_inventory_data),
factory_production_history: mergeArrays(cloudData.factory_production_history, normalized.factory_production_history),
payment_entities: mergeArrays(cloudData.payment_entities, normalized.payment_entities),
payment_transactions: mergeArrays(cloudData.payment_transactions, normalized.payment_transactions),
stock_returns: mergeArrays(cloudData.stock_returns, normalized.stock_returns),
factory_default_formulas: (() => {
const cloudFormulas = cloudData.factory_default_formulas;
const fileFormulas = normalized.factory_default_formulas;
const fileHasData = fileFormulas &&
((Array.isArray(fileFormulas.standard) && fileFormulas.standard.length > 0) ||
(Array.isArray(fileFormulas.asaan) && fileFormulas.asaan.length > 0));
const cloudHasData = cloudFormulas &&
((Array.isArray(cloudFormulas.standard) && cloudFormulas.standard.length > 0) ||
(Array.isArray(cloudFormulas.asaan) && cloudFormulas.asaan.length > 0));
if (fileHasData) return fileFormulas;
if (cloudHasData) return cloudFormulas;
return { standard: [], asaan: [] };
})(),
factory_additional_costs: (() => {
const cloud = cloudData.factory_additional_costs;
const file = normalized.factory_additional_costs;
const fileHasData = file && (parseFloat(file.standard) > 0 || parseFloat(file.asaan) > 0);
const cloudHasData = cloud && (parseFloat(cloud.standard) > 0 || parseFloat(cloud.asaan) > 0);
if (fileHasData) return file;
if (cloudHasData) return cloud;
return { standard: 0, asaan: 0 };
})(),
factory_cost_adjustment_factor: (() => {
const cloud = cloudData.factory_cost_adjustment_factor;
const file = normalized.factory_cost_adjustment_factor;
const fileHasData = file && (parseFloat(file.standard) !== 1 || parseFloat(file.asaan) !== 1);
const cloudHasData = cloud && (parseFloat(cloud.standard) !== 1 || parseFloat(cloud.asaan) !== 1);
if (fileHasData) return file;
if (cloudHasData) return cloud;
return { standard: 1, asaan: 1 };
})(),
factory_sale_prices: (() => {
const cloud = cloudData.factory_sale_prices;
const file = normalized.factory_sale_prices;
const fileHasData = file && (parseFloat(file.standard) > 0 || parseFloat(file.asaan) > 0);
const cloudHasData = cloud && (parseFloat(cloud.standard) > 0 || parseFloat(cloud.asaan) > 0);
if (fileHasData) return file;
if (cloudHasData) return cloud;
return { standard: 0, asaan: 0 };
})(),
factory_unit_tracking: (() => {
const cloud = cloudData.factory_unit_tracking;
const file = normalized.factory_unit_tracking;
const hasTrackingData = (data) => {
if (!data || typeof data !== 'object') return false;
const std = data.standard || {};
const asn = data.asaan || {};
return (parseFloat(std.produced) > 0 || parseFloat(std.consumed) > 0 ||
parseFloat(asn.produced) > 0 || parseFloat(asn.consumed) > 0 ||
(Array.isArray(std.unitCostHistory) && std.unitCostHistory.length > 0) ||
(Array.isArray(asn.unitCostHistory) && asn.unitCostHistory.length > 0));
};
if (hasTrackingData(file)) return file;
if (hasTrackingData(cloud)) return cloud;
return {
standard: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
asaan: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] }
};
})(),
naswar_default_settings: cloudData.naswar_default_settings || normalized.naswar_default_settings,
expense_categories: cloudData.expense_categories || normalized.expense_categories,
deleted_records: [...new Set([
...(cloudData.deleted_records || []),
...normalized.deleted_records
])],
appMode: cloudData.appMode || normalized.appMode,
repProfile: cloudData.repProfile || normalized.repProfile
};
const now = new Date().toISOString();
const batches = [];
let currentBatch = firebaseDB.batch();
let operationCount = 0;
const getCurrentBatch = () => {
if (operationCount >= 450) {
batches.push(currentBatch);
currentBatch = firebaseDB.batch();
operationCount = 0;
}
return currentBatch;
};
const collections = {
'production': merged.mfg_pro_pkr,
'sales': (merged.customer_sales || []),
'rep_sales': merged.rep_sales,
'calculator_history': merged.noman_history,
'inventory': merged.factory_inventory_data,
'factory_history': merged.factory_production_history,
'entities': merged.payment_entities,
'transactions': merged.payment_transactions,
'returns': merged.stock_returns
};
for (const [collectionName, dataArray] of Object.entries(collections)) {
if (Array.isArray(dataArray)) {
for (const item of dataArray) {
if (item && item.id) {
const batch = getCurrentBatch();
const docRef = userRef.collection(collectionName).doc(item.id);
const itemWithTimestamp = { ...item, updatedAt: getTimestamp() };
batch.set(docRef, itemWithTimestamp, { merge: true });
operationCount++;
}
}
}
}
const batch = getCurrentBatch();
const factorySettingsRef = userRef.collection('factorySettings').doc('config');
batch.set(factorySettingsRef, {
default_formulas: merged.factory_default_formulas,
default_formulas_timestamp: Date.now(),
additional_costs: merged.factory_additional_costs,
additional_costs_timestamp: Date.now(),
cost_adjustment_factor: merged.factory_cost_adjustment_factor,
cost_adjustment_factor_timestamp: Date.now(),
sale_prices: merged.factory_sale_prices,
sale_prices_timestamp: Date.now(),
unit_tracking: merged.factory_unit_tracking,
unit_tracking_timestamp: Date.now(),
last_synced: now
}, { merge: true });
operationCount++;
if (merged.expense_categories) {
const expenseCategoriesRef = userRef.collection('expenseCategories').doc('categories');
const currentBatch = getCurrentBatch();
currentBatch.set(expenseCategoriesRef, {
categories: merged.expense_categories,
last_synced: now
}, { merge: true });
operationCount++;
}
if (merged.deleted_records && Array.isArray(merged.deleted_records) && merged.deleted_records.length > 0) {
for (const recordId of merged.deleted_records) {
if (recordId) {
const deletionId = generateUUID('deletion');
const deletionRef = userRef.collection('deletions').doc(deletionId);
const currentBatch = getCurrentBatch();
currentBatch.set(deletionRef, {
id: deletionId,
recordId: String(recordId),
deletedAt: now,
source: 'backup_upload',
recordType: 'unknown'
}, { merge: true });
operationCount++;
}
}
}
const settingsRef = userRef.collection('settings').doc('config');
const settingsBatch = getCurrentBatch();
settingsBatch.set(settingsRef, {
naswar_default_settings: merged.naswar_default_settings || {},
naswar_default_settings_timestamp: Date.now(),
appMode: merged.appMode || 'admin',
appMode_timestamp: Date.now(),
repProfile: merged.repProfile || {},
repProfile_timestamp: Date.now(),
last_synced: now
}, { merge: true });
operationCount++;
if (operationCount > 0) {
batches.push(currentBatch);
}
for (let _bi = 0; _bi < batches.length; _bi++) {
	await batches[_bi].commit();
	if (batches.length > 1) {
		showToast('Uploading... ' + (_bi + 1) + ' / ' + batches.length + ' batches', 'info');
	}
	await new Promise(r => setTimeout(r, 0));
}
const counts = {
production: normalized.mfg_pro_pkr.length,
sales: normalized.noman_history.length,
customerSales: normalized.customer_sales.length,
repSales: normalized.rep_sales.length,
factory: normalized.factory_inventory_data.length + normalized.factory_production_history.length,
payments: normalized.payment_entities.length + normalized.payment_transactions.length,
returns: normalized.stock_returns.length
};
const total = Object.values(counts).reduce((a, b) => a + b, 0);
showToast('Upload Complete! ' + total + ' records merged to cloud.', 'success');
} catch (err) {
showToast('Upload failed: ' + err.message, 'error');
} finally {
isSyncing = false;
}
}
const BiometricAuth = {
isAvailable: async () => {
if (!window.PublicKeyCredential) return false;
const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
return available;
},
_strToBin: (str) => {
return Uint8Array.from(str, c => c.charCodeAt(0));
},
_bufToBase64: (buffer) => {
const bytes = new Uint8Array(buffer);
let binary = '';
for (let i = 0; i < bytes.byteLength; i++) {
binary += String.fromCharCode(bytes[i]);
}
return window.btoa(binary);
},
_base64ToBuf: (base64) => {
const binary_string = window.atob(base64);
const len = binary_string.length;
const bytes = new Uint8Array(len);
for (let i = 0; i < len; i++) {
bytes[i] = binary_string.charCodeAt(i);
}
return bytes.buffer;
},
register: async (username = 'User') => {
try {
if (!await BiometricAuth.isAvailable()) {
throw new Error("Biometrics not available on this device.");
}
const challenge = new Uint8Array(32);
window.crypto.getRandomValues(challenge);
const userId = new Uint8Array(16);
window.crypto.getRandomValues(userId);
const publicKey = {
challenge: challenge,
rp: { name: "Naswar Dealers App" },
user: {
id: userId,
name: username,
displayName: username
},
pubKeyCredParams: [{ alg: -7, type: "public-key" }],
authenticatorSelection: {
authenticatorAttachment: "platform",
userVerification: "required"
},
timeout: 60000
};
const credential = await navigator.credentials.create({ publicKey });
const credId = BiometricAuth._bufToBase64(credential.rawId);
await idb.set('bio_cred_id', credId);
await idb.set('bio_enabled', 'true');
notifyDataChange('all');
triggerAutoSync();
return true;
} catch (err) {
console.error('Failed to save data locally.', _safeErr(err));
showToast('Failed to save data locally.', 'error');
throw err;
}
},
authenticate: async () => {
try {
const savedCredId = await idb.get('bio_cred_id');
if (!savedCredId) throw new Error("No biometric set up found.");
const challenge = new Uint8Array(32);
window.crypto.getRandomValues(challenge);
const publicKey = {
challenge: challenge,
allowCredentials: [{
id: BiometricAuth._base64ToBuf(savedCredId),
type: "public-key",
transports: ["internal"]
}],
userVerification: "required"
};
await navigator.credentials.get({ publicKey });
return true;
} catch (err) {
return false;
}
}
};
async function forceAppModeFromCloud(targetMode, repName = null) {
if (!firebaseDB || !currentUser) {
showToast('Not logged in', 'error', 3000);
return false;
}
if (targetMode !== 'admin' && targetMode !== 'rep') {
showToast('Invalid mode - use "admin" or "rep"', 'error', 3000);
return false;
}
try {
const timestamp = Date.now();
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
const settingsRef = userRef.collection('settings').doc('config');
const updatePayload = {
appMode: targetMode,
appMode_timestamp: timestamp
};
if (repName) {
updatePayload.repProfile = repName;
updatePayload.repProfile_timestamp = timestamp;
}
await settingsRef.set(updatePayload, { merge: true });
showToast(`Remote command sent: ${targetMode} mode`, 'success', 3000);
return true;
} catch (error) {
showToast('Failed to send remote command', 'error', 3000);
return false;
}
}
window.forceAppModeFromCloud = forceAppModeFromCloud;
function lockToRepMode() {
const nav = document.querySelector('.nav-tabs');
if (nav) nav.style.display = 'none';
const cloudMenuBtn = document.getElementById('cloudMenuBtn');
if (cloudMenuBtn) cloudMenuBtn.style.display = 'none';
const repHeader = document.getElementById('rep-header');
if (repHeader) {
const nameEl = document.getElementById('current-rep-name-display');
if (nameEl) nameEl.textContent = (currentRepProfile || 'Sales Rep').toUpperCase();
repHeader.style.display = 'flex';
}
['prod', 'sales', 'calc', 'factory', 'payments'].forEach(t => {
const el = document.getElementById('tab-' + t);
if (el) { el.classList.add('hidden'); el.style.display = 'none'; }
});
const repTab = document.getElementById('tab-rep');
if (repTab) { repTab.classList.remove('hidden'); repTab.style.removeProperty('display'); }
const adminControls = document.getElementById('admin-rep-controls');
if (adminControls) { adminControls.classList.add('hidden'); adminControls.style.display = 'none'; }
const manageRepsBtn = document.getElementById('btn-manage-reps');
if (manageRepsBtn) manageRepsBtn.style.display = 'none';
const adminAnalytics = document.getElementById('admin-rep-analytics');
if (adminAnalytics) { adminAnalytics.classList.add('hidden'); adminAnalytics.style.display = 'none'; }
const newTransCard = document.getElementById('rep-new-transaction-card');
if (newTransCard) newTransCard.style.display = 'block';
if (typeof refreshRepUI === 'function') refreshRepUI();
}
function lockToProductionMode() {
const nav = document.querySelector('.nav-tabs');
if (nav) nav.style.display = 'none';
const cloudMenuBtn = document.getElementById('cloudMenuBtn');
if (cloudMenuBtn) cloudMenuBtn.style.display = 'none';
const manageRepsBtn = document.getElementById('btn-manage-reps');
if (manageRepsBtn) manageRepsBtn.style.display = 'none';
const prodHeader = document.getElementById('prod-locked-header');
if (prodHeader) {
const nameEl = document.getElementById('prod-locked-name-display');
if (nameEl) nameEl.textContent = (window._assignedManagerName || 'Production Manager').toUpperCase();
prodHeader.style.display = 'flex';
}
['sales', 'calc', 'factory', 'payments', 'rep'].forEach(t => {
const el = document.getElementById('tab-' + t);
if (el) { el.classList.add('hidden'); el.style.display = 'none'; }
});
const prodTab = document.getElementById('tab-prod');
if (prodTab) { prodTab.classList.remove('hidden'); prodTab.style.removeProperty('display'); }
const prodToggle = document.querySelector('.production-toggle-container');
if (prodToggle) prodToggle.style.display = 'none';
['combinedOverview', 'combinedChart', 'prod-analytics-section',
'prod-history-header', 'prodHistoryList'].forEach(id => {
const el = document.getElementById(id);
if (el) el.style.display = 'none';
});
const fBlock = document.getElementById('prod-formula-cost-block');
if (fBlock) fBlock.style.display = 'none';
const pBlock = document.getElementById('prod-profit-block');
if (pBlock) pBlock.style.display = 'none';
const spField = document.getElementById('prod-sale-price-field');
if (spField) spField.style.display = 'none';
}
function lockToFactoryMode() {
const nav = document.querySelector('.nav-tabs');
if (nav) nav.style.display = 'none';
const cloudMenuBtn = document.getElementById('cloudMenuBtn');
if (cloudMenuBtn) cloudMenuBtn.style.display = 'none';
const manageRepsBtn = document.getElementById('btn-manage-reps');
if (manageRepsBtn) manageRepsBtn.style.display = 'none';
const factoryHeader = document.getElementById('factory-locked-header');
if (factoryHeader) {
const nameEl = document.getElementById('factory-locked-name-display');
if (nameEl) nameEl.textContent = (window._assignedManagerName || 'Factory Manager').toUpperCase();
factoryHeader.style.display = 'flex';
}
['prod', 'sales', 'calc', 'payments', 'rep'].forEach(t => {
const el = document.getElementById('tab-' + t);
if (el) { el.classList.add('hidden'); el.style.display = 'none'; }
});
const factoryTab = document.getElementById('tab-factory');
if (factoryTab) { factoryTab.classList.remove('hidden'); factoryTab.style.removeProperty('display'); }
const factorySettingsBtn = document.getElementById('factory-settings-btn');
if (factorySettingsBtn) factorySettingsBtn.style.display = 'none';
document.querySelectorAll('#tab-factory .section.liquid-card').forEach(sec => {
sec.style.display = 'none';
});
const entrySection = document.getElementById('factory-entry-section');
if (entrySection) {
entrySection.style.removeProperty('display');
entrySection.classList.add('liquid-card');
const costDisplay = document.getElementById('factoryTotalProductionCostDisplay');
if (costDisplay) {
const fieldDiv = costDisplay.closest('.field');
if (fieldDiv) fieldDiv.style.display = 'none';
}
const formulaDisplay = document.getElementById('factoryFormulaDisplay');
if (formulaDisplay) formulaDisplay.style.display = 'none';
}
}
function _showModeBanner(tabLabel, personName, modeClass, icon) {
}
function lockToUserRoleMode() {
const assignedTabs = window._assignedUserTabs || [];
const userName = window._assignedManagerName || 'User';
const allTabs = ['prod','sales','calc','factory','payments','rep'];
['cloudMenuBtn','btn-manage-reps'].forEach(id => {
const el = document.getElementById(id); if (el) el.style.display = 'none';
});
const bannerMap = {
prod: { headerId:'prod-locked-header', nameId:'prod-locked-name-display' },
factory: { headerId:'factory-locked-header', nameId:'factory-locked-name-display' },
sales: { headerId:'sales-locked-header', nameId:'sales-locked-name-display' },
payments: { headerId:'payments-locked-header', nameId:'payments-locked-name-display' },
};
assignedTabs.forEach(t => {
const b = bannerMap[t]; if (!b) return;
const hdr = document.getElementById(b.headerId);
if (hdr) {
const nm = document.getElementById(b.nameId);
if (nm) nm.textContent = userName.toUpperCase();
hdr.style.display = 'flex';
}
});
allTabs.forEach(t => {
const el = document.getElementById('tab-' + t);
if (el) { el.classList.add('hidden'); el.style.removeProperty('display'); }
});
if (assignedTabs.includes('prod')) {
const prodToggle = document.querySelector('.production-toggle-container');
if (prodToggle) prodToggle.style.display = 'none';
['combinedOverview','combinedChart','prod-analytics-section',
'prod-history-header','prodHistoryList'].forEach(id => {
const el = document.getElementById(id); if (el) el.style.display = 'none';
});
['prod-formula-cost-block','prod-profit-block','prod-sale-price-field'].forEach(id => {
const el = document.getElementById(id); if (el) el.style.display = 'none';
});
document.querySelectorAll('#tab-prod .section.liquid-card').forEach(sec => {
if (sec.id !== 'production-entry-section') sec.style.display = 'none';
});
const ui = document.getElementById('unitsAvailableIndicator');
if (ui) ui.style.removeProperty('display');
const iuw = document.getElementById('insufficientUnitsWarning');
if (iuw) iuw.style.removeProperty('display');
}
if (assignedTabs.includes('factory')) {
const fsBtn = document.getElementById('factory-settings-btn');
if (fsBtn) fsBtn.style.display = 'none';
document.querySelectorAll('#tab-factory .section.liquid-card').forEach(sec => sec.style.display = 'none');
const entry = document.getElementById('factory-entry-section');
if (entry) {
entry.style.removeProperty('display');
entry.classList.add('liquid-card');
const cd = document.getElementById('factoryTotalProductionCostDisplay');
if (cd) { const f = cd.closest('.field'); if (f) f.style.display = 'none'; }
const fd = document.getElementById('factoryFormulaDisplay');
if (fd) fd.style.display = 'none';
}
}
if (assignedTabs.includes('sales')) {
const sh = document.querySelector('#tab-sales header');
if (sh) sh.querySelectorAll('button, .btn-theme').forEach(b => b.style.display = 'none');
let si = 0;
document.querySelectorAll('#tab-sales .section.liquid-card').forEach(sec => {
if (si === 0) { si++; return; }
sec.style.display = 'none'; si++;
});
['sale-result-cost','sale-result-value','sale-result-profit'].forEach(id => {
const el = document.getElementById(id); if (el) el.style.display = 'none';
});
const st = document.getElementById('sales-summary-toggle');
if (st) { const sh2 = st.closest('.section-header'); if (sh2) sh2.style.display = 'none'; }
const sc = document.getElementById('sales-summary-card');
if (sc) sc.style.display = 'none';
const cl = document.getElementById('custHistoryList');
if (cl) { const prev = cl.previousElementSibling; if (prev) prev.style.display = 'none'; cl.style.display = 'none'; }
}
if (assignedTabs.includes('payments')) {
const eb = document.querySelector('#tab-payments header .btn-theme');
if (eb) eb.style.display = 'none';
let pi = 0;
document.querySelectorAll('#tab-payments .section.liquid-card').forEach(sec => {
if (pi === 0) { pi++; return; }
sec.style.display = 'none'; pi++;
});
const us = document.getElementById('payments-unified-section');
if (us) us.style.display = 'none';
const ph = document.getElementById('payment-history-section');
if (ph) ph.style.display = 'none';
const pl = document.getElementById('paymentHistoryList');
if (pl) pl.style.display = 'none';
}
if (assignedTabs.length > 0 && typeof showTab === 'function') {
showTab(assignedTabs[0]);
}
}
async function enforceRepModeLock() {
if (window._modeLockEnforced) return;
window._modeLockEnforced = true;
try {
const storedMode = await idb.get('appMode');
if (storedMode === 'rep') {
appMode = 'rep';
currentRepProfile = await idb.get('repProfile') || (salesRepsList[0] || 'NORAN SHAH');
lockToRepMode();
} else if (storedMode === 'userrole') {
appMode = 'userrole';
window._assignedManagerName = await idb.get('assignedManager') || null;
window._assignedUserTabs = await idb.get('assignedUserTabs') || [];
window._userRoleAllowedTabs = window._assignedUserTabs;
lockToUserRoleMode();
} else if (storedMode === 'production') {
appMode = 'production';
window._assignedManagerName = await idb.get('assignedManager') || null;
lockToProductionMode();
} else if (storedMode === 'factory') {
appMode = 'factory';
window._assignedManagerName = await idb.get('assignedManager') || null;
lockToFactoryMode();
}
} catch(e) {
console.warn('enforceRepModeLock: failed to read mode from IDB, defaulting to admin.', e);
}
}
function preventAdminAccess() {
if (!window._originalShowTab && typeof window.showTab === 'function') {
window._originalShowTab = window.showTab;
}
if (window._originalShowTab) window.showTab = window._originalShowTab;
if (appMode === 'rep') {
const originalShowTab = window._originalShowTab || window.showTab;
window.showTab = function(tab) {
const adminTabs = ['prod', 'sales', 'calc', 'factory', 'payments'];
if (adminTabs.includes(tab)) {
showToast("Access Denied - Device in Rep Mode", "warning", 3000);
return;
}
if (tab === 'rep' || !adminTabs.includes(tab)) {
if (typeof originalShowTab === 'function') originalShowTab(tab);
}
};
document.querySelectorAll('.tab-btn').forEach(btn => {
btn.style.display = 'none';
});
} else if (appMode === 'userrole') {
const allowedTabs = window._userRoleAllowedTabs || window._assignedUserTabs || [];
const originalShowTabUR = window._originalShowTab || window.showTab;
window.showTab = function(tab) {
if (!allowedTabs.includes(tab)) {
showToast('Access Denied — not in your assigned sections', 'warning', 3000);
return;
}
if (typeof originalShowTabUR === 'function') originalShowTabUR(tab);
if (tab === 'payments') {
const _ph = document.getElementById('payment-history-section');
if (_ph) { _ph.style.display = 'none'; _ph.style.visibility = 'hidden'; }
const _pl = document.getElementById('paymentHistoryList');
if (_pl) _pl.style.display = 'none';
const _us = document.getElementById('payments-unified-section');
if (_us) _us.style.display = 'none';
}
};
const btnMap = { PRODUCTION:'prod', SALES:'sales', CALCULATOR:'calc',
FACTORY:'factory', PAYMENTS:'payments', 'REP SALES':'rep' };
if (allowedTabs.length <= 1) {
const nav = document.querySelector('.nav-tabs');
if (nav) nav.style.display = 'none';
} else {
document.querySelectorAll('.tab-btn').forEach(btn => {
const tid = btnMap[btn.textContent.trim()];
btn.style.display = (tid && allowedTabs.includes(tid)) ? '' : 'none';
});
}
window._userRoleAllowedTabs = allowedTabs;
} else if (appMode === 'production') {
const originalShowTabProd = window._originalShowTab || window.showTab;
window.showTab = function(tab) {
if (tab !== 'prod') {
showToast("Access Denied - Device in Production Manager Mode", "warning", 3000);
return;
}
if (typeof originalShowTabProd === 'function') originalShowTabProd(tab);
};
document.querySelectorAll('.tab-btn').forEach(btn => {
btn.style.display = 'none';
});
} else if (appMode === 'factory') {
const originalShowTabFactory = window._originalShowTab || window.showTab;
window.showTab = function(tab) {
if (tab !== 'factory') {
showToast("Access Denied - Device in Factory Manager Mode", "warning", 3000);
return;
}
if (typeof originalShowTabFactory === 'function') originalShowTabFactory(tab);
};
document.querySelectorAll('.tab-btn').forEach(btn => {
btn.style.display = 'none';
});
}
}
async function unlockAdminMode() {
appMode = 'admin';
window._assignedManagerName = null;
window._assignedUserTabs = [];
window._userRoleAllowedTabs = [];
currentRepProfile = null;
const timestamp = Date.now();
await idb.set('appMode', 'admin');
await idb.set('appMode_timestamp', timestamp);
await idb.set('assignedManager', null);
await idb.set('assignedUserTabs', []);
await idb.set('repProfile', null);
notifyDataChange('all');
triggerAutoSync();
showToast('Switching to Admin Mode...', 'info', 1500);
setTimeout(() => {
location.reload();
}, 1000);
}
function unlockToAdminMode() {
unlockAdminMode();
}
async function deleteRepTransaction(id) {
if (!id || !validateUUID(id)) {
showToast('Invalid transaction ID', 'error');
return;
}
const transaction = repSales.find(t => t.id === id);
if (!transaction) {
await refreshRepUI(true);
return;
}
if (transaction.isMerged) {
showToast('Merged opening balance records cannot be deleted', 'warning');
return;
}
const _rtIsOldDebt = transaction.transactionType === 'OLD_DEBT';
const _rtPayType = transaction.paymentType;
const _rtCust = transaction.customerName || 'Unknown';
const _rtRep = transaction.salesRep || 'Unknown';
const _rtDate = transaction.date || 'Unknown';
const _rtQty = transaction.quantity || 0;
const _rtAmt = transaction.totalValue || 0;
const _rtPartialPaid = transaction.partialPaymentReceived || 0;
let confirmMsg, confirmTitle;
if (_rtIsOldDebt) {
confirmTitle = '\u26a0 Delete Old Debt Record';
confirmMsg = `Permanently delete an OLD DEBT record for ${_rtCust} (Rep: ${_rtRep}).`;
confirmMsg += `\nBalance: ${fmtAmt(_rtAmt)}`;
confirmMsg += `\nRecorded: ${_rtDate}`;
if (transaction.notes) confirmMsg += `\nNote: ${transaction.notes}`;
confirmMsg += `\n\n\u26a0 Warning: This will erase the carried-forward balance from this rep customer's history permanently.`;
} else if (_rtPayType === 'COLLECTION') {
confirmTitle = 'Delete Rep Bulk Collection';
confirmMsg = `Delete this bulk collection payment?\n\nRep: ${_rtRep}\nCustomer: ${_rtCust}\nDate: ${_rtDate}\nAmount Collected: ${fmtAmt(_rtAmt)}`;
confirmMsg += `\n\n\u21a9 This will reverse the collection and restore the customer's outstanding balance.`;
} else if (_rtPayType === 'PARTIAL_PAYMENT') {
confirmTitle = 'Delete Rep Partial Payment';
confirmMsg = `Delete this partial payment?\n\nRep: ${_rtRep}\nCustomer: ${_rtCust}\nDate: ${_rtDate}\nPayment: ${fmtAmt(_rtAmt)}`;
confirmMsg += `\n\n\u21a9 This will reverse the partial payment and restore the pending credit balance.`;
} else if (_rtPayType === 'CREDIT') {
confirmTitle = 'Delete Rep Credit Sale';
confirmMsg = `Delete this credit sale permanently?\n\nRep: ${_rtRep}\nCustomer: ${_rtCust}\nDate: ${_rtDate}\nQty: ${_rtQty} kg — ${fmtAmt(_rtAmt)}`;
if (_rtPartialPaid > 0) confirmMsg += `\n\n\u26a0 ${fmtAmt(_rtPartialPaid)} partially collected. Deleting will erase both the sale and partial payment.`;
else if (transaction.creditReceived) confirmMsg += `\n\n\u26a0 This sale is already marked PAID. Deleting will remove the payment record.`;
else confirmMsg += `\n\n\u26a0 This credit sale is UNPAID. Deleting will remove the outstanding balance.`;
} else {
confirmTitle = 'Delete Rep Cash Sale';
confirmMsg = `Delete this cash sale permanently?\n\nRep: ${_rtRep}\nCustomer: ${_rtCust}\nDate: ${_rtDate}\nQty: ${_rtQty} kg — ${fmtAmt(_rtAmt)}`;
confirmMsg += `\n\n\u21a9 ${_rtQty} kg will be restored to inventory.`;
}
confirmMsg += `\n\nThis cannot be undone.`;
if (await showGlassConfirm(confirmMsg, { title: confirmTitle || 'Delete Rep Transaction', confirmText: "Delete", danger: true })) {
try {
const wasCredit = transaction.paymentType === 'CREDIT';
const wasPartialPayment = transaction.paymentType === 'PARTIAL_PAYMENT';
const wasCollection = transaction.paymentType === 'COLLECTION';
const paymentAmount = transaction.totalValue || 0;
const relatedSaleId = transaction.relatedSaleId;
if (wasPartialPayment && relatedSaleId) {
const relatedSale = repSales.find(s => s.id === relatedSaleId);
if (relatedSale) {
relatedSale.partialPaymentReceived = Math.max(0, (relatedSale.partialPaymentReceived || 0) - paymentAmount);
if (relatedSale.partialPaymentReceived === 0) { relatedSale.creditReceived = false; delete relatedSale.creditReceivedDate; }
relatedSale.updatedAt = getTimestamp();
ensureRecordIntegrity(relatedSale, true);
}
}
repSales = repSales.filter(t => t.id !== id);
await unifiedDelete('rep_sales', repSales, id, { strict: true }, transaction);
if (wasPartialPayment && relatedSaleId) {
const relatedSale = repSales.find(s => s.id === relatedSaleId);
if (relatedSale) await saveRecordToFirestore('rep_sales', relatedSale);
}
await refreshRepUI(true);
if (currentManagingRepCustomer && typeof renderRepCustomerTransactions === 'function') {
await renderRepCustomerTransactions(currentManagingRepCustomer);
}
notifyDataChange('rep');
triggerAutoSync();
let message = ` ${wasPartialPayment ? 'Payment' : wasCollection ? 'Collection' : 'Transaction'} deleted!`;
if ((wasPartialPayment || wasCollection || (wasCredit && transaction.partialPaymentReceived > 0)) && (paymentAmount > 0 || transaction.partialPaymentReceived > 0)) {
const refundAmount = wasCredit ? transaction.partialPaymentReceived : paymentAmount;
message += ` Payment of ${fmtAmt(refundAmount)} reversed.`;
}
showToast(message, "success");
} catch (error) {
showToast('Failed to delete transaction. Please try again.', 'error');
}
}
}
function handleCustomerInput(query, mode) {
if (!query) query = '';
if (typeof query !== 'string') query = String(query);
const isRep = mode === 'rep';
const phoneContainerId = isRep ? 'rep-new-customer-phone-container' : 'new-customer-phone-container';
const phoneContainer = document.getElementById(phoneContainerId);
if (!phoneContainer) return;
const allSales = isRep ?
(Array.isArray(repSales) ? repSales : []).filter(s => s.salesRep === currentRepProfile) :
(Array.isArray(customerSales) ? customerSales : []).filter(s => s && s.currentRepProfile === 'admin');
const allRegistryNames = !isRep && Array.isArray(salesCustomers)
? salesCustomers.filter(c => c && c.name).map(c => String(c.name).trim().toLowerCase())
: Array.isArray(repCustomers)
? repCustomers.filter(c => c && c.name).map(c => String(c.name).trim().toLowerCase())
: [];
const existingNames = [...new Set([
...allSales
.map(s => s && s.customerName ? s.customerName : null)
.filter(n => n !== null && n !== undefined && n !== '' && typeof n === 'string')
.map(n => { try { return String(n).trim().toLowerCase(); } catch (e) { return null; } })
.filter(n => n !== null && n !== ''),
...allRegistryNames
])];
let safeQuery = '';
try {
safeQuery = query ? String(query).trim().toLowerCase() : '';
} catch (e) {
safeQuery = '';
}
const isNewCustomer = safeQuery.length > 2 && !existingNames.includes(safeQuery);
if (isNewCustomer) {
phoneContainer.classList.remove('hidden');
} else {
phoneContainer.classList.add('hidden');
}
}
async function handleUniversalSearch(inputId, resultsId, dataSource) {
const input = document.getElementById(inputId);
const resultsDiv = document.getElementById(resultsId);
if (!input || !resultsDiv) return;
const query = input.value || '';
if (!query || query.length < 1) {
resultsDiv.classList.add('hidden');
return;
}
let matches = [];
let html = '';
switch(dataSource) {
case 'customers': {
let _freshSalesReg = [];
try { _freshSalesReg = await idb.get('sales_customers', []) || []; } catch(e) {}
const _salesRegMap = new Map((_freshSalesReg).filter(c => c && c.id).map(c => [c.id, c]));
if (Array.isArray(salesCustomers)) salesCustomers.forEach(c => { if (c && c.id && !_salesRegMap.has(c.id)) _salesRegMap.set(c.id, c); });
const _mergedSalesReg = Array.from(_salesRegMap.values());
const _custNamesFromSales = customerSales
.filter(s => s && s.currentRepProfile === 'admin')
.map(s => s.customerName)
.filter(n => n && typeof n === 'string');
const _custNamesFromRegistry = _mergedSalesReg
.filter(c => c && c.name && typeof c.name === 'string').map(c => c.name);
const uniqueCustomers = [...new Set([..._custNamesFromSales, ..._custNamesFromRegistry])];
matches = uniqueCustomers.filter(name =>
name && typeof name === 'string' && name.toLowerCase().includes(query.toLowerCase())
);
if (matches.length > 0) {
matches.forEach(name => {
const safeName = String(name).replace(/'/g, "\\'").replace(/"/g, '&quot;');
html += `
<div style="padding: 10px; cursor: pointer; border-bottom: 1px solid var(--glass-border); font-size: 0.85rem; color: var(--text-main); background: var(--input-bg);"
onmousedown="selectFromUniversalSearch('${inputId}', '${resultsId}', '${safeName}', 'name')"
onmouseover="this.style.background='var(--highlight-bg)'"
onmouseout="this.style.background='var(--input-bg)'">
<strong>${esc(name)}</strong>
</div>`;
});
} else {
html = `<div class="u-search-empty" >
No match found. "${query}" will be created as new customer.
</div>`;
}
break;
}
case 'entities':
if (Array.isArray(paymentEntities)) {
matches = paymentEntities.filter(entity =>
entity && entity.name && typeof entity.name === 'string' &&
entity.name.toLowerCase().includes(query.toLowerCase())
);
}
if (matches.length > 0) {
matches.forEach(entity => {
const safeName = String(entity.name).replace(/'/g, "\\'").replace(/"/g, '&quot;');
const safeId = String(entity.id).replace(/'/g, "\\'");
const entityBal = calculateEntityBalances()[entity.id] || 0;
const typeColor = entityBal >= 0 ? 'var(--danger)' : 'var(--accent-emerald)';
html += `
<div style="padding: 10px; cursor: pointer; border-bottom: 1px solid var(--glass-border); font-size: 0.85rem; color: var(--text-main); background: var(--input-bg);"
onmousedown="selectFromUniversalSearch('${inputId}', '${resultsId}', '${safeName}', 'entity', '${safeId}')"
onmouseover="this.style.background='var(--highlight-bg)'"
onmouseout="this.style.background='var(--input-bg)'">
<strong>${esc(entity.name)}</strong>
</div>`;
});
} else {
html = `<div class="u-search-empty" >
No matching entities found
</div>`;
}
break;
case 'suppliers':
if (Array.isArray(paymentEntities)) {
matches = paymentEntities.filter(entity =>
entity && entity.name && typeof entity.name === 'string' &&
entity.type === 'payee' &&
entity.name.toLowerCase().includes(query.toLowerCase())
);
}
if (matches.length > 0) {
matches.forEach(supplier => {
const safeName = String(supplier.name).replace(/'/g, "\\'").replace(/"/g, '&quot;');
const safeId = String(supplier.id).replace(/'/g, "\\'");
html += `
<div style="padding: 10px; cursor: pointer; border-bottom: 1px solid var(--glass-border); font-size: 0.85rem; color: var(--text-main); background: var(--input-bg);"
onmousedown="selectFromUniversalSearch('${inputId}', '${resultsId}', '${safeName}', 'supplier', '${safeId}')"
onmouseover="this.style.background='var(--highlight-bg)'"
onmouseout="this.style.background='var(--input-bg)'">
<strong>${esc(supplier.name)}</strong>
${supplier.phone ? `<span style="font-size: 0.7rem; color: var(--text-muted); margin-left: 8px;">${phoneActionHTML(supplier.phone)}</span>` : ''}
</div>`;
});
} else {
html = `<div class="u-search-empty" >
No matching suppliers found
</div>`;
}
break;
case 'repCustomers': {
let _freshRepReg = [];
try { _freshRepReg = await idb.get('rep_customers', []) || []; } catch(e) {}
const _repRegMap = new Map((_freshRepReg).filter(c => c && c.id).map(c => [c.id, c]));
if (Array.isArray(repCustomers)) repCustomers.forEach(c => { if (c && c.id && !_repRegMap.has(c.id)) _repRegMap.set(c.id, c); });
const _mergedRepReg = Array.from(_repRegMap.values());
const _repNamesFromSales = repSales
.filter(s => s.salesRep === currentRepProfile)
.map(s => s.customerName)
.filter(n => n && typeof n === 'string');
const _repNamesFromRegistry = _mergedRepReg
.filter(c => c && c.name && typeof c.name === 'string').map(c => c.name);
const repUniqueCustomers = [...new Set([..._repNamesFromSales, ..._repNamesFromRegistry])];
matches = repUniqueCustomers.filter(name =>
name && typeof name === 'string' && name.toLowerCase().includes(query.toLowerCase())
);
if (matches.length > 0) {
matches.forEach(name => {
const safeName = String(name).replace(/'/g, "\\'").replace(/"/g, '&quot;');
html += `
<div style="padding: 10px; cursor: pointer; border-bottom: 1px solid var(--glass-border); font-size: 0.85rem; color: var(--text-main); background: var(--input-bg);"
onmousedown="selectFromUniversalSearch('${inputId}', '${resultsId}', '${safeName}', 'repName')"
onmouseover="this.style.background='var(--highlight-bg)'"
onmouseout="this.style.background='var(--input-bg)'">
<strong>${esc(name)}</strong>
</div>`;
});
} else {
html = `<div class="u-search-empty" >
No match found. "${query}" will be created.
</div>`;
}
break;
}
}
resultsDiv.innerHTML = html;
resultsDiv.classList.remove('hidden');
}
function selectFromUniversalSearch(inputId, resultsId, value, type, id) {
const input = document.getElementById(inputId);
const resultsDiv = document.getElementById(resultsId);
if (input) {
input.value = value;
if (id) {
input.setAttribute('data-entity-id', id);
input.setAttribute('data-supplier-id', id);
}
}
if (resultsDiv) {
resultsDiv.classList.add('hidden');
}
if (type === 'name' && inputId === 'cust-name') {
if (typeof calculateCustomerStatsForDisplay === 'function') {
calculateCustomerStatsForDisplay(value);
}
const _phoneContainer = document.getElementById('new-customer-phone-container');
if (_phoneContainer) _phoneContainer.classList.add('hidden');
} else if (type === 'repName' && inputId === 'rep-cust-name') {
if (typeof calculateRepCustomerStatsForDisplay === 'function') {
calculateRepCustomerStatsForDisplay(value);
}
}
}
document.addEventListener('click', function(e) {
const searchables = [
{ input: 'cust-name', results: 'customer-search-results' },
{ input: 'rep-cust-name', results: 'rep-customer-search-results' },
{ input: 'paymentEntity', results: 'payment-entity-search-results' },
{ input: 'factoryExistingSupplier', results: 'factory-supplier-search-results' }
];
searchables.forEach(item => {
const input = document.getElementById(item.input);
const resultsDiv = document.getElementById(item.results);
if (input && resultsDiv) {
const container = input.parentElement;
if (container && !container.contains(e.target)) {
resultsDiv.classList.add('hidden');
}
}
});
});
window.selectCustomer = function(name) {
  const base = window._selectCustomerBase;
  if (typeof base === 'function') base(name);
  document.getElementById('new-customer-phone-container').classList.add('hidden');
  document.getElementById('new-cust-phone').value = '';
};
window.selectRepCustomer = function(name) {
  const base = window._selectRepCustomerBase;
  if (typeof base === 'function') base(name);
  document.getElementById('rep-new-customer-phone-container').classList.add('hidden');
  document.getElementById('rep-new-cust-phone').value = '';
};
async function initTheme() {
const savedTheme = await idb.get('theme') || 'dark';
const html = document.documentElement;
html.setAttribute('data-theme', savedTheme);
const themeToggle = document.getElementById('themeToggle');
if (themeToggle) {
themeToggle.innerHTML = savedTheme === 'dark' ? '' : '';
themeToggle.title = savedTheme === 'dark' ? "Switch to Light Mode" : "Switch to Dark Mode";
}
const metaThemeColor = document.querySelector('meta[name="theme-color"]');
if (metaThemeColor) {
metaThemeColor.setAttribute('content', savedTheme === 'light' ? '#ffffff' : '#000000');
}
}
const FIRESTORE_ENHANCED_SCHEMA = {
production: {
localKey: 'mfg_pro_pkr',
firestoreCollection: 'production',
localVariable: 'db',
type: 'array',
description: 'Manufacturing / production records',
fields: ['date', 'netWeight', 'costPrice', 'salePrice', 'profit', 'id', 'timestamp']
},
calculator_history: {
localKey: 'noman_history',
firestoreCollection: 'calculator_history',
localVariable: 'salesHistory',
type: 'array',
description: 'Calculator history – totals, revenue, returns, cash/credit splits',
fields: ['totalSold', 'revenue', 'returns', 'cash', 'credit', 'seller', 'date', 'id', 'timestamp']
},
sales: {
localKey: 'customer_sales',
firestoreCollection: 'sales',
localVariable: 'customerSales',
type: 'array',
description: 'Individual customer sales transactions',
fields: ['customerName', 'quantity', 'paymentType', 'supplyStore', 'date', 'phone', 'id', 'timestamp']
},
rep_sales: {
localKey: 'rep_sales',
firestoreCollection: 'rep_sales',
localVariable: 'repSales',
type: 'array',
description: 'Rep-mode sales with GPS coordinates',
fields: ['customerName', 'quantity', 'paymentType', 'salesRep', 'latitude', 'longitude', 'date', 'phone', 'id', 'timestamp']
},
inventory: {
localKey: 'factory_inventory_data',
firestoreCollection: 'inventory',
localVariable: 'factoryInventoryData',
type: 'array',
description: 'Raw-material inventory (name, qty, cost, value)',
fields: ['materialName', 'quantityOnHand', 'unitCost', 'totalValue', 'id', 'timestamp']
},
factory_history: {
localKey: 'factory_production_history',
firestoreCollection: 'factory_history',
localVariable: 'factoryProductionHistory',
type: 'array',
description: 'Factory formula production-batch history',
fields: ['unitsProduced', 'materialCosts', 'productType', 'date', 'id', 'timestamp']
},
returns: {
localKey: 'stock_returns',
firestoreCollection: 'returns',
localVariable: 'stockReturns',
type: 'array',
description: 'Stock-return logs from sellers',
fields: ['seller', 'quantity', 'reason', 'date', 'id', 'timestamp']
},
entities: {
localKey: 'payment_entities',
firestoreCollection: 'entities',
localVariable: 'paymentEntities',
type: 'array',
description: 'Registry of payment entities',
fields: ['name', 'phone', 'entityType', 'id', 'timestamp']
},
transactions: {
localKey: 'payment_transactions',
firestoreCollection: 'transactions',
localVariable: 'paymentTransactions',
type: 'array',
description: 'Cash-in / cash-out ledger linked to entities',
fields: ['entityId', 'amount', 'type', 'description', 'date', 'id', 'timestamp']
},
expenses: {
localKey: 'expenses',
firestoreCollection: 'expenses',
localVariable: 'expenseRecords',
type: 'array',
description: 'Unified expense manager records (operating expenses, payments IN/OUT)',
fields: ['name', 'amount', 'category', 'description', 'date', 'time', 'id', 'timestamp', 'syncedAt']
}
};
const FIRESTORE_SETTINGS_SCHEMA = {
factory_default_formulas: {
localKey: 'factory_default_formulas',
localVariable: 'factoryDefaultFormulas',
type: 'object',
defaultValue: { standard: [], asaan: [] },
description: 'Recipe / formula definitions (Standard vs Asaan)'
},
factory_additional_costs: {
localKey: 'factory_additional_costs',
localVariable: 'factoryAdditionalCosts',
type: 'object',
defaultValue: { standard: 0, asaan: 0 },
description: 'Overhead / extra costs per unit'
},
factory_sale_prices: {
localKey: 'factory_sale_prices',
localVariable: 'factorySalePrices',
type: 'object',
defaultValue: { standard: 0, asaan: 0 },
description: 'Standard selling price per kg/unit per store type'
},
factory_cost_adjustment_factor: {
localKey: 'factory_cost_adjustment_factor',
localVariable: 'factoryCostAdjustmentFactor',
type: 'object',
defaultValue: { standard: 1, asaan: 1 },
description: 'Cost-price multiplier for reporting'
},
factory_unit_tracking: {
localKey: 'factory_unit_tracking',
localVariable: 'factoryUnitTracking',
type: 'object',
defaultValue: {
standard: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
asaan: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] }
},
description: 'Unit lifecycle: produced → consumed → available'
},
naswar_default_settings: {
localKey: 'naswar_default_settings',
localVariable: 'defaultSettings',
type: 'object',
defaultValue: {},
description: 'General app default-settings object'
},
appMode: {
localKey: 'appMode',
localVariable: 'appMode',
type: 'string',
defaultValue: 'admin',
description: 'Current operating mode: admin | rep'
},
repProfile: {
localKey: 'repProfile',
localVariable: 'currentRepProfile',
type: 'string',
defaultValue: salesRepsList[0] || 'NORAN SHAH',
description: 'Active sales-representative profile name'
},
deleted_records: {
localKey: 'deleted_records',
localVariable: 'deletedRecordIds',
type: 'set_as_array',
defaultValue: [],
description: 'Tombstone IDs – prevents deleted records from re-appearing on sync'
},
last_synced: {
localKey: 'last_synced',
localVariable: null,
type: 'string_iso_date',
defaultValue: null,
description: 'ISO timestamp of the last successful cloud sync'
}
};
const FIRESTORE_LOCAL_ONLY_KEYS = {
theme: {
localKey: 'theme',
localVariable: null,
type: 'string',
defaultValue: 'dark',
description: 'UI theme preference: light | dark'
},
bio_enabled: {
localKey: 'bio_enabled',
localVariable: null,
type: 'boolean_string',
defaultValue: 'false',
description: 'Biometric security-lock flag'
},
bio_cred_id: {
localKey: 'bio_cred_id',
localVariable: null,
type: 'string',
defaultValue: '',
description: 'WebAuthn biometric credential ID'
}
};
function updateConnectionStatus() {
const dot = document.getElementById('connection-indicator');
if (!dot) return;
if (!navigator.onLine) {
dot.className = 'signal-offline';
dot.title = "Offline - Changes saved locally";
} else if (isSyncing) {
dot.className = 'signal-connecting';
dot.title = "Syncing with Cloud...";
} else if (firebase.apps.length && currentUser) {
dot.className = 'signal-online';
dot.title = "Online - Connected to Firestore";
} else {
dot.className = 'signal-offline';
dot.title = "Disconnected - Please Sign In";
}
}
window.addEventListener('online', () => { updateConnectionStatus(); if(typeof updateOfflineBanner==='function') updateOfflineBanner(); });
window.addEventListener('offline', () => { updateConnectionStatus(); if(typeof updateOfflineBanner==='function') updateOfflineBanner(); });
const originalSync = window.performOneClickSync;
window.performOneClickSync = async function(silent) {
updateConnectionStatus();
try {
await originalSync(silent);
} finally {
isSyncing = false;
updateConnectionStatus();
}
};
(function() {
const body = document.body;
const threshold = 150;
let startY = 0;
let isPulling = false;
const ptrStyle = document.createElement('style');
ptrStyle.innerHTML = `
@keyframes ptrSpinArc { to { stroke-dashoffset: -138; } }
@keyframes ptrSuccessScale {
0% { transform: scale(0) rotate(-45deg); opacity: 0; }
70% { transform: scale(1.25) rotate(5deg); opacity: 1; }
100% { transform: scale(1) rotate(0deg); opacity: 1; }
}
`;
document.head.appendChild(ptrStyle);
const pill = document.createElement('div');
pill.id = 'pull-refresh-pill';
pill.innerHTML = `
<div class="ptr-icon-wrap" id="ptr-icon-wrap">
<svg class="ptr-svg" id="ptr-svg" viewBox="0 0 32 32" fill="none" xmlns="http:
<circle class="ptr-track" cx="16" cy="16" r="12" stroke="rgba(255,255,255,0.08)" stroke-width="2"/>
<circle class="ptr-arc u-hidden" id="ptr-arc" cx="16" cy="16" r="12"
stroke="#4da6ff" stroke-width="2" stroke-linecap="round"
stroke-dasharray="75.4" stroke-dashoffset="75.4"
transform="rotate(-90 16 16)" />
<g class="ptr-arrow-g" id="ptr-arrow-g">
<line x1="16" y1="9" x2="16" y2="21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
<polyline points="11,17 16,22 21,17" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</g>
<g class="ptr-check-g" id="ptr-check-g" style="display:none; transform-origin: 50% 50%;">
<polyline points="9,16 14,21 23,11" stroke="#2ddf7a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</g>
</svg>
</div>
<div class="ptr-text-wrap">
<span class="ptr-label" id="ptr-label">Pull to sync</span>
<span class="ptr-sublabel" id="ptr-sublabel"></span>
</div>
<div class="ptr-dots" id="ptr-dots">
<span></span><span></span><span></span>
</div>
`;
document.body.appendChild(pill);
const iconWrap = pill.querySelector('#ptr-icon-wrap');
const arrowG = pill.querySelector('#ptr-arrow-g');
const checkG = pill.querySelector('#ptr-check-g');
const arc = pill.querySelector('#ptr-arc');
const label = pill.querySelector('#ptr-label');
const sublabel = pill.querySelector('#ptr-sublabel');
const dots = pill.querySelector('#ptr-dots');
const setState = (state) => {
pill.className = 'ptr-' + state;
pill.dataset.state = state;
arrowG.style.display = 'none';
arc.style.display = 'none';
checkG.style.display = 'none';
dots.classList.remove('visible');
sublabel.textContent = '';
if (state === 'idle') {
arrowG.style.display = 'block';
arrowG.style.color = 'rgba(255,255,255,0.50)';
label.textContent = 'Pull to sync';
label.style.color = 'rgba(255,255,255,0.55)';
} else if (state === 'pull') {
arrowG.style.display = 'block';
arrowG.style.color = '#4da6ff';
label.textContent = 'Pull to sync';
label.style.color = 'rgba(255,255,255,0.80)';
} else if (state === 'ready') {
arrowG.style.display = 'block';
arrowG.style.color = '#2ddf7a';
arrowG.style.transform = 'rotate(180deg)';
label.textContent = 'Release to sync';
label.style.color = '#2ddf7a';
sublabel.textContent = 'Let go';
} else if (state === 'syncing') {
arc.style.display = 'block';
arc.style.animation = 'ptrSpinArc 0.9s linear infinite';
dots.classList.add('visible');
label.textContent = 'Syncing…';
label.style.color = '#4da6ff';
sublabel.textContent = 'Fetching latest data';
} else if (state === 'done') {
checkG.style.display = 'block';
checkG.style.animation = 'ptrSuccessScale 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards';
label.textContent = 'Up to date';
label.style.color = '#2ddf7a';
}
if (state !== 'ready') arrowG.style.transform = '';
};
const showPill = (y) => {
const progress = Math.min(y / threshold, 1);
const eased = 1 - Math.pow(1 - progress, 2.2);
const top = -8 + eased * 56;
pill.style.top = Math.max(-8, top) + 'px';
const scale = 0.82 + eased * 0.18;
pill.style.transform = `translateX(-50%) scale(${scale.toFixed(3)})`;
};
const hidePill = () => {
pill.style.top = '-88px';
pill.style.transform = 'translateX(-50%) scale(0.88)';
};
window._ptrTouchStart = (e) => {
const anyOverlayOpen = document.querySelector('.factory-overlay[style*="flex"], .factory-overlay[style*="block"], .settings-overlay.active') !== null;
if (anyOverlayOpen) { isPulling = false; return; }
if (window.scrollY === 0) {
startY = e.touches[0].clientY;
isPulling = true;
setState('pull');
} else { isPulling = false; }
};
window._ptrTouchMove = (e) => {
if (!isPulling) return;
const anyOverlayOpen = document.querySelector('.factory-overlay[style*="flex"], .factory-overlay[style*="block"], .settings-overlay.active') !== null;
if (anyOverlayOpen) { isPulling = false; return; }
const diff = e.touches[0].clientY - startY;
if (diff > 0 && window.scrollY === 0) {
e.preventDefault();
showPill(diff);
setState(diff > threshold ? 'ready' : 'pull');
}
};
window._ptrTouchEnd = async (e) => {
if (!isPulling) return;
const anyOverlayOpen = document.querySelector('.factory-overlay[style*="flex"], .factory-overlay[style*="block"], .settings-overlay.active') !== null;
if (anyOverlayOpen) { isPulling = false; hidePill(); return; }
const diff = e.changedTouches[0].clientY - startY;
if (diff > threshold && window.scrollY === 0) {
setState('syncing');
pill.style.top = '20px';
pill.style.transform = 'translateX(-50%) scale(1)';
if (navigator.vibrate) navigator.vibrate([12, 8, 20]);
await performOneClickSync(false);
setState('done');
if (navigator.vibrate) navigator.vibrate(18);
setTimeout(() => {
setState('idle');
setTimeout(hidePill, 350);
}, 1200);
} else {
hidePill();
}
isPulling = false;
};
document.addEventListener('touchstart', window._ptrTouchStart, { passive: true });
document.addEventListener('touchmove', window._ptrTouchMove, { passive: false });
document.addEventListener('touchend', window._ptrTouchEnd);
})();
(function registerRenderFunctions() {
if (typeof renderUnifiedTable === 'function') {
}
if (typeof renderCustomersTable === 'function') {
}
if (typeof renderEntityTable === 'function') {
}
if (typeof renderExpenseTable === 'function') {
}
if (typeof renderRepCustomerTable === 'function') {
}
})();
var ThemeManager = {
currentTheme: 'dark',
observers: new Set(),
init() {
const saved = localStorage.getItem('app_theme');
const systemPrefers = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
this.currentTheme = saved || systemPrefers;
this.apply();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
if (!localStorage.getItem('app_theme')) {
this.setTheme(e.matches ? 'dark' : 'light');
}
});
},
apply() {
document.documentElement.setAttribute('data-theme', this.currentTheme);
this.notifyObservers();
},
setTheme(theme) {
this.currentTheme = theme;
localStorage.setItem('app_theme', theme);
this.apply();
},
toggle() {
this.setTheme(this.currentTheme === 'dark' ? 'light' : 'dark');
},
observe(callback) {
this.observers.add(callback);
return () => this.observers.delete(callback);
},
notifyObservers() {
this.observers.forEach(cb => cb(this.currentTheme));
},
getVar(varName) {
return getComputedStyle(document.documentElement)
.getPropertyValue(`--${varName}`).trim();
}
};
const IncrementalRenderer = {
queue: [],
isRendering: false,
batchSize: 20,
enqueue(items, renderFunc, container) {
this.queue.push({ items, renderFunc, container });
if (!this.isRendering) {
this.processQueue();
}
},
async processQueue() {
this.isRendering = true;
while (this.queue.length > 0) {
const { items, renderFunc, container } = this.queue.shift();
container.innerHTML = '';
for (let i = 0; i < items.length; i += this.batchSize) {
const batch = items.slice(i, i + this.batchSize);
const fragment = document.createDocumentFragment();
batch.forEach(item => {
const element = renderFunc(item);
if (element) {
fragment.appendChild(element);
}
});
container.appendChild(fragment);
}
}
this.isRendering = false;
}
};
class VirtualScroller {
constructor(container, itemHeight, renderFunc) {
this.container = container;
this.itemHeight = itemHeight;
this.renderFunc = renderFunc;
this.items = [];
this.visibleRange = { start: 0, end: 0 };
this.setupScrollListener();
}
setItems(items) {
this.items = items;
this.render();
}
setupScrollListener() {
this._scrollHandler = () => {
this.updateVisibleRange();
this.render();
};
this.container.addEventListener('scroll', this._scrollHandler);
}
destroy() {
if (this._scrollHandler) {
this.container.removeEventListener('scroll', this._scrollHandler);
this._scrollHandler = null;
}
}
updateVisibleRange() {
const scrollTop = this.container.scrollTop;
const containerHeight = this.container.clientHeight;
const start = Math.floor(scrollTop / this.itemHeight);
const end = Math.ceil((scrollTop + containerHeight) / this.itemHeight);
this.visibleRange = { start, end };
}
render() {
const { start, end } = this.visibleRange;
const visibleItems = this.items.slice(start, end);
const fragment = document.createDocumentFragment();
visibleItems.forEach((item, index) => {
const element = this.renderFunc(item);
if (element) {
element.style.position = 'absolute';
element.style.top = `${(start + index) * this.itemHeight}px`;
fragment.appendChild(element);
}
});
this.container.innerHTML = '';
this.container.appendChild(fragment);
this.container.style.height = `${this.items.length * this.itemHeight}px`;
}
}
class ReactiveComponent {
constructor(element, config = {}) {
this.element = element;
this.state = config.initialState || {};
this.styleMap = config.styleMap || {};
this.listeners = new Map();
}
setState(newState) {
const oldState = { ...this.state };
this.state = { ...this.state, ...newState };
this.syncStyles();
this.notifyListeners(oldState, this.state);
}
syncStyles() {
Object.entries(this.styleMap).forEach(([stateKey, styles]) => {
if (this.state[stateKey]) {
Object.assign(this.element.style, styles);
}
});
}
on(event, callback) {
if (!this.listeners.has(event)) {
this.listeners.set(event, new Set());
}
this.listeners.get(event).add(callback);
}
notifyListeners(oldState, newState) {
const listeners = this.listeners.get('change');
if (listeners) {
listeners.forEach(cb => cb(newState, oldState));
}
}
}
var PerformanceMonitor = {
metrics: {
renderTime: [],
queryTime: [],
syncTime: []
},
startTimer(operation) {
return performance.now();
},
endTimer(operation, startTime) {
const duration = performance.now() - startTime;
if (this.metrics[operation]) {
this.metrics[operation].push(duration);
if (this.metrics[operation].length > 100) {
this.metrics[operation].shift();
}
}
return duration;
},
getAverages() {
const averages = {};
for (const [key, values] of Object.entries(this.metrics)) {
if (values.length > 0) {
averages[key] = values.reduce((a, b) => a + b, 0) / values.length;
}
}
return averages;
},
report() {
const averages = this.getAverages();
}
};
window.addEventListener('beforeunload', function() {
if (listenerReconnectTimer) {
clearTimeout(listenerReconnectTimer);
}
if (syncChannel) {
try {
syncChannel.close();
} catch (e) {
console.warn('Data validation encountered an error.', e);
}
}
if (typeof scrollRafId !== 'undefined' && scrollRafId !== null) {
cancelAnimationFrame(scrollRafId);
scrollRafId = null;
}
if (window._rafScrollHandler) {
window.removeEventListener('scroll', window._rafScrollHandler);
window._rafScrollHandler = null;
}
if (window._ptrTouchStart) { document.removeEventListener('touchstart', window._ptrTouchStart); window._ptrTouchStart = null; }
if (window._ptrTouchMove) { document.removeEventListener('touchmove', window._ptrTouchMove); window._ptrTouchMove = null; }
if (window._ptrTouchEnd) { document.removeEventListener('touchend', window._ptrTouchEnd); window._ptrTouchEnd = null; }
if (window._fbOfflineHandler) { window.removeEventListener('offline', window._fbOfflineHandler); window._fbOfflineHandler = null; }
if (window._fbVisibilityHandler) { document.removeEventListener('visibilitychange', window._fbVisibilityHandler); window._fbVisibilityHandler = null; }
if (window._tombstoneCleanupInterval) { clearInterval(window._tombstoneCleanupInterval); window._tombstoneCleanupInterval = null; }
if (window._syncUpdatesCleanupInterval) { clearInterval(window._syncUpdatesCleanupInterval); window._syncUpdatesCleanupInterval = null; }
if (window._connectionCheckInterval) { clearInterval(window._connectionCheckInterval); window._connectionCheckInterval = null; }
if (window._perfMonitorInterval) { clearInterval(window._perfMonitorInterval); window._perfMonitorInterval = null; }
});
async function loadSalesRepsList() {
const stored = await idb.get('sales_reps_list', null);
if (Array.isArray(stored) && stored.length > 0) {
salesRepsList = stored;
} else {
salesRepsList = ['NORAN SHAH', 'NOMAN SHAH'];
await idb.set('sales_reps_list', salesRepsList);
}
const storedUserRoles = await idb.get('user_roles_list', null);
if (Array.isArray(storedUserRoles)) userRolesList = storedUserRoles;
if (firebaseDB && currentUser) {
try {
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
const teamDoc = await userRef.collection('settings').doc('team').get();
if (teamDoc.exists) {
const teamData = teamDoc.data();
const cloudTs = teamData.updated_at || 0;
const localTs = (await idb.get('team_list_timestamp')) || 0;
if (cloudTs >= localTs) {
if (Array.isArray(teamData.sales_reps) && teamData.sales_reps.length > 0) {
salesRepsList = teamData.sales_reps;
await idb.set('sales_reps_list', salesRepsList);
}
if (Array.isArray(teamData.user_roles)) {
userRolesList = teamData.user_roles;
await idb.set('user_roles_list', userRolesList);
}
if (cloudTs > localTs) await idb.set('team_list_timestamp', cloudTs);
}
}
} catch(e) { console.warn('Could not fetch team list from Firestore on startup:', e); }
}
renderAllRepUI();
}
async function saveSalesRepsList() {
try {
await idb.set('sales_reps_list', salesRepsList);
if (firebaseDB && currentUser) {
try {
const nowMs = Date.now();
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
await userRef.collection('settings').doc('team').set({
sales_reps: salesRepsList,
user_roles: userRolesList,
updated_at: nowMs
}, { merge: true });
await idb.set('team_list_timestamp', nowMs);
} catch(e) {
console.warn('Could not sync sales reps to Firestore', e);
showToast('Saved locally — cloud sync will retry when online.', 'warning', 3500);
}
}
renderAllRepUI();
} catch(e) {
console.error('saveSalesRepsList error:', _safeErr(e));
showToast('Failed to save team list. Please try again.', 'error');
}
}
async function saveProductionManagersList() {
await saveUserRolesList();
}
async function saveFactoryManagersList() {
await saveUserRolesList();
}
async function saveUserRolesList() {
try {
await idb.set('user_roles_list', userRolesList);
if (firebaseDB && currentUser) {
try {
const nowMs = Date.now();
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
await userRef.collection('settings').doc('team').set({
sales_reps: salesRepsList,
user_roles: userRolesList,
updated_at: nowMs
}, { merge: true });
await idb.set('team_list_timestamp', nowMs);
} catch(e) {
console.warn('Could not sync user roles to Firestore', e);
showToast('Saved locally — cloud sync will retry when online.', 'warning', 3500);
}
}
} catch(e) {
console.error('saveUserRolesList error:', _safeErr(e));
showToast('Failed to save user roles. Please try again.', 'error');
}
}
function renderAllRepUI() {
const adminSel = document.getElementById('admin-rep-selector');
if (adminSel) {
const prev = adminSel.value;
adminSel.innerHTML = salesRepsList.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
if (salesRepsList.includes(prev)) adminSel.value = prev;
else if (salesRepsList.includes(currentRepProfile)) adminSel.value = currentRepProfile;
else if (salesRepsList.length > 0) { adminSel.value = salesRepsList[0]; currentRepProfile = salesRepsList[0]; }
}
const sellerSel = document.getElementById('sellerSelect');
if (sellerSel) {
const prev2 = sellerSel.value;
sellerSel.innerHTML = salesRepsList.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('') +
'<option value="COMBINED">COMPARISON</option>';
if (salesRepsList.includes(prev2) || prev2 === 'COMBINED') sellerSel.value = prev2;
}
const toggleGroup = document.getElementById('sales-rep-toggle-group');
if (toggleGroup) {
const currentVal = document.getElementById('sales-rep-value')?.value || 'NONE';
toggleGroup.innerHTML = `<button id="btn-rep-none" class="toggle-opt${currentVal === 'NONE' ? ' active' : ''}" onclick="selectSalesRep(this,'NONE')">Direct</button>` +
salesRepsList.map((r, i) => {
const firstName = r.split(' ')[0];
const shortName = firstName.charAt(0) + firstName.slice(1).toLowerCase();
return `<button id="btn-rep-dyn-${i}" class="toggle-opt${currentVal === r ? ' active' : ''}" onclick="selectSalesRep(this,'${esc(r)}')">${esc(shortName)}</button>`;
}).join('');
}
renderManageRepsList();
}
function renderManageRepsList() {
const list = document.getElementById('manage-reps-list');
if (!list) return;
if (salesRepsList.length === 0) {
list.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:12px;">No representatives added yet.</div>';
return;
}
list.innerHTML = salesRepsList.map((rep, i) => `
<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 18px; background:var(--glass-raised); border:1px solid var(--glass-border); border-radius:9999px; ${i === 0 ? 'border-left:3px solid var(--accent);' : ''}">
<div style="display:flex; align-items:center; gap:8px; flex:1; min-width:0;">
<span style="font-size:0.85rem; font-weight:800; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(rep)}</span>
<span style="font-size:0.62rem; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:${i === 0 ? 'var(--accent)' : 'var(--text-muted)'}; flex-shrink:0;">${i === 0 ? '● Default' : `#${i + 1}`}</span>
</div>
<button class="btn-theme" onclick="removeSalesRep(${i})" title="Remove ${esc(rep)}" style="flex-shrink:0; color:var(--danger); border-color:rgba(239,68,68,0.4); font-size:0.8rem;">✕</button>
</div>
`).join('');
}
let _newUserRoleSelectedTabs = new Set();
function toggleUserRoleTabAccess(tabKey) {
if (_newUserRoleSelectedTabs.has(tabKey)) {
_newUserRoleSelectedTabs.delete(tabKey);
} else {
_newUserRoleSelectedTabs.add(tabKey);
}
['factory','prod','payments','sales'].forEach(t => {
const btn = document.getElementById('userrole-tab-' + t);
if (btn) btn.classList.toggle('active', _newUserRoleSelectedTabs.has(t));
});
const hint = document.getElementById('userrole-access-hint');
if (hint) {
hint.textContent = _newUserRoleSelectedTabs.size === 0
? 'Select one or more tabs to assign'
: 'Access: ' + [..._newUserRoleSelectedTabs].map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(', ');
}
}
function renderUserRoleList() {
const list = document.getElementById('manage-userrole-list');
if (!list) return;
if (userRolesList.length === 0) {
list.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:12px;">No users added yet.</div>';
return;
}
const TAB_COLORS = { factory: 'var(--accent-purple)', prod: 'var(--accent-emerald)', payments: 'var(--accent-cyan)', sales: 'var(--accent-gold)' };
list.innerHTML = userRolesList.map((user, i) => {
const tabs = Array.isArray(user.tabs) ? user.tabs : [];
const tabBadges = tabs.map(t => `<span style="font-size:0.58rem;padding:2px 7px;border-radius:9999px;background:${TAB_COLORS[t]||'var(--accent)'}22;color:${TAB_COLORS[t]||'var(--accent)'};border:1px solid ${TAB_COLORS[t]||'var(--accent)'}55;font-weight:700;text-transform:uppercase;">${t}</span>`).join('');
return `
<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 14px; background:var(--glass-raised); border:1px solid var(--glass-border); border-radius:var(--radius-lg); margin-bottom:8px;">
<div style="flex:1; min-width:0;">
<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
<span style="font-size:0.85rem; font-weight:800; color:var(--text-main);">${esc(user.name)}</span>
</div>
<div style="display:flex;gap:4px;flex-wrap:wrap;">${tabBadges || '<span style="font-size:0.65rem;color:var(--text-secondary);">No tabs assigned</span>'}</div>
</div>
<button class="btn-theme" onclick="removeUserRole(${i})" title="Remove ${esc(user.name)}" style="flex-shrink:0; color:var(--danger); border-color:rgba(239,68,68,0.4); font-size:0.8rem;">✕</button>
</div>`;
}).join('');
}
function switchManageTeamTab(tab) {
['rep', 'userrole'].forEach(t => {
const btn = document.getElementById('team-tab-' + t);
const panel = document.getElementById('team-panel-' + t);
if (btn) btn.classList.toggle('active', t === tab);
if (panel) panel.style.display = t === tab ? '' : 'none';
});
if (tab === 'userrole') renderUserRoleList();
if (tab === 'rep') renderManageRepsList();
}
async function addNewUserRole() {
const input = document.getElementById('new-userrole-name-input');
if (!input) return;
const name = input.value.trim().toUpperCase();
if (!name) { showToast('Please enter a name', 'warning'); return; }
if (_newUserRoleSelectedTabs.size === 0) { showToast('Please select at least one tab', 'warning'); return; }
if (userRolesList.some(u => u.name === name)) { showToast('User already exists', 'warning'); return; }
userRolesList.push({ name, tabs: [..._newUserRoleSelectedTabs] });
await saveUserRolesList();
input.value = '';
_newUserRoleSelectedTabs.clear();
['factory','prod','payments','sales'].forEach(t => {
const btn = document.getElementById('userrole-tab-' + t);
if (btn) btn.classList.remove('active');
});
const hint = document.getElementById('userrole-access-hint');
if (hint) hint.textContent = 'Select one or more tabs to assign';
renderUserRoleList();
showToast(`${name} added as User`, 'success');
}
async function removeUserRole(index) {
const user = userRolesList[index];
if (!user) return;
const _rMsg = `Remove ${esc(user.name)} from the team?\n\nThey will lose access to their assigned sections. This does not delete any recorded data.`;
const confirmed = await showGlassConfirm(_rMsg, { title: 'Remove User', confirmText: 'Remove', cancelText: 'Cancel', danger: true });
if (!confirmed) return;
userRolesList.splice(index, 1);
await saveUserRolesList();
renderUserRoleList();
showToast(`${esc(user.name)} removed`, 'info');
}
async function addNewSalesRep() {
const input = document.getElementById('new-rep-name-input');
if (!input) return;
const name = input.value.trim().toUpperCase();
if (!name) { showToast('Please enter a name', 'warning'); return; }
if (salesRepsList.includes(name)) { showToast('Rep already exists', 'warning'); return; }
salesRepsList.push(name);
await saveSalesRepsList();
input.value = '';
showToast(`${name} added`, 'success');
}
async function removeSalesRep(index) {
if (salesRepsList.length <= 1) { showToast('Must have at least one representative', 'warning'); return; }
const name = salesRepsList[index];
const _rsrSales = (typeof repSales !== 'undefined' ? repSales : []).filter(s => s.salesRep === name).length;
let _rsrMsg = `Remove ${name} from the sales team?`;
_rsrMsg += `\n\nThey will no longer appear as an available rep in the app.`;
if (_rsrSales > 0) _rsrMsg += `\n\n⚠ ${name} has ${_rsrSales} recorded sale${_rsrSales !== 1 ? 's' : ''} in the system. Those records will be kept, but you will no longer be able to add new sales under this name.`;
if (typeof currentRepProfile !== 'undefined' && currentRepProfile === name) _rsrMsg += `\n\n⚠ This rep is currently active on this device. The device will switch to the next available rep.`;
_rsrMsg += `\n\nThis does not delete any of their existing sales data.`;
const confirmed = await showGlassConfirm(_rsrMsg, {
title: `Remove ${name}`,
confirmText: 'Remove',
cancelText: 'Cancel',
danger: true
});
if (!confirmed) return;
salesRepsList.splice(index, 1);
if (currentRepProfile === name) {
currentRepProfile = salesRepsList[0];
await idb.set('repProfile', currentRepProfile);
}
await saveSalesRepsList();
showToast(`${name} removed`, 'info');
}
function openManageRepsModal() {
renderManageRepsList();
const modal = document.getElementById('manage-reps-modal');
if (!modal) return;
document.body.style.overflow = 'hidden';
document.documentElement.style.overflow = 'hidden';
modal.classList.add('open');
}
function closeManageRepsModal() {
const modal = document.getElementById('manage-reps-modal');
if (!modal) return;
modal.classList.remove('open');
document.body.style.overflow = '';
document.documentElement.style.overflow = '';
}
const _overlayStack = (() => {
  const _registry = {
    'factorySettingsOverlay':      { closeFn: () => closeFactorySettings(),          contentSel: '.factory-overlay-card' },
    'factoryInventoryOverlay':     { closeFn: () => closeFactoryInventoryModal(),     contentSel: '.factory-overlay-card' },
    'entityManagementOverlay':     { closeFn: () => closeEntityManagement(),          contentSel: '.factory-overlay-card' },
    'entityDetailsOverlay':        { closeFn: () => closeEntityDetailsOverlay(),      contentSel: '.factory-overlay-card' },
    'expenseDetailsOverlay':       { closeFn: () => closeExpenseDetailsOverlay(),     contentSel: '.factory-overlay-card' },
    'customerManagementOverlay':   { closeFn: () => closeCustomerManagement(),        contentSel: '.factory-overlay-card' },
    'customerEditOverlay':         { closeFn: () => closeCustomerEditModal(),         contentSel: '.factory-overlay-card' },
    'repCustomerManagementOverlay':{ closeFn: () => closeRepCustomerManagement(),     contentSel: '.factory-overlay-card' },
    'repCustomerEditOverlay':      { closeFn: () => closeRepCustomerEditModal(),      contentSel: '.factory-overlay-card' },
    'dataMenuOverlay':             { closeFn: () => closeDataMenu(),                  contentSel: '.factory-overlay-card' },
    'recycleBinOverlay':           { closeFn: () => closeRecycleBin(),                contentSel: '.factory-overlay-card' },
    'entityTransactionsOverlay':   { closeFn: () => closeEntityTransactions(),        contentSel: '.factory-overlay-card' },
    'manage-reps-modal':           { closeFn: () => closeManageRepsModal(),           contentSel: '#manage-reps-card'     },
  };
  function _openLayers() {
    const open = [];
    for (const [id, cfg] of Object.entries(_registry)) {
      const el = document.getElementById(id);
      if (!el) continue;
      const isOpen = el.classList.contains('open') ||
                     (el.style.display && el.style.display !== 'none' && el.style.display !== '');
      if (isOpen) open.push({ id, el, ...cfg });
    }
    open.sort((a, b) => {
      const pos = a.el.compareDocumentPosition(b.el);
      return (pos & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
    });
    return open;
  }
  function closeTop() {
    const layers = _openLayers();
    if (layers.length === 0) return false;
    const top = layers[layers.length - 1];
    top.closeFn();
    return true;
  }
  document.addEventListener('click', function(e) {
    if (document.querySelector('.glass-confirm-backdrop') || window._glassConfirmClosing) return;
    const layers = _openLayers();
    if (layers.length === 0) return;
    const top = layers[layers.length - 1];
    const contentEl = top.el.querySelector(top.contentSel);
    if (contentEl && contentEl.contains(e.target)) return;
    if (layers.length > 1) {
      const secondTop = layers[layers.length - 2];
      const secondContent = secondTop.el.querySelector(secondTop.contentSel);
      if (secondContent && secondContent.contains(e.target)) return;
    }
    top.closeFn();
  }, true);
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    if (document.querySelector('.glass-confirm-backdrop') || window._glassConfirmClosing) return;
    if (closeTop()) e.preventDefault();
  });
  return { closeTop, openLayers: _openLayers };
})();
window.loadSalesRepsList = loadSalesRepsList;
window.saveSalesRepsList = saveSalesRepsList;
window.renderAllRepUI = renderAllRepUI;
window.addNewSalesRep = addNewSalesRep;
window.removeSalesRep = removeSalesRep;
window.openManageRepsModal = openManageRepsModal;
window.closeManageRepsModal = closeManageRepsModal;
window.switchManageTeamTab = switchManageTeamTab;
window.addNewUserRole = addNewUserRole;
window.removeUserRole = removeUserRole;
window.toggleUserRoleTabAccess = toggleUserRoleTabAccess;
window.renderUserRoleList = renderUserRoleList;
window.saveUserRolesList = saveUserRolesList;
window.lockToUserRoleMode = lockToUserRoleMode;
function phoneActionHTML(phone, opts = {}) {
const raw = (phone || '').toString().trim();
const empty = !raw || raw === '-' || raw === 'N/A' || raw === 'No Phone' || raw === 'No contact';
if (empty) return raw || (opts.dash ? '-' : '');
const digitCount = (raw.match(/\d/g) || []).length;
const looksLikePhone = digitCount >= 7 && /^[\d\s\-+(). ]+$/.test(raw);
if (!looksLikePhone) return esc(raw);
const clean = raw.replace(/[\s\-().]/g, '');
const wa = clean.startsWith('0') ? '92' + clean.slice(1) : clean;
return `<a href="tel:${clean}" title="Tap to call · Long-press for WhatsApp" style="color:inherit;text-decoration:none;cursor:pointer;border-bottom:1px dotted currentColor;touch-action:manipulation;-webkit-touch-callout:default;" oncontextmenu="event.preventDefault();window.open('https://wa.me/${wa}','_blank')">${esc(raw)}</a>`;
}
window.phoneActionHTML = phoneActionHTML;
window.initDatabase = async function(silent = false) {
const result = await initializeCompleteFirestoreDatabase(silent);
return result;
};
window.checkDatabase = async function() {
const isComplete = await isCompleteDatabaseInitialized();
return isComplete;
};
window.safeInitDatabase = async function(silent = false) {
const result = await safeInitializeCompleteDatabase(silent);
return result;
};
window.analyzeBackupFile = async function(file) {
if (!file) {
return;
}
try {
const text = await _readFileAsText(file);
const data = JSON.parse(text);
const reportLines = [];
const meta = data.backupMetadata;
reportLines.push({ type: 'section', label: 'Backup Metadata' });
if (meta) {
const createdAt = meta.timestamp
? new Date(meta.timestamp).toLocaleString()
: (meta.date || 'Unknown');
reportLines.push({ type: 'row', label: 'Created', value: createdAt });
reportLines.push({ type: 'row', label: 'Version', value: meta.version || 'Unknown' });
reportLines.push({ type: 'row', label: 'Device', value: meta.deviceInfo ? meta.deviceInfo.substring(0, 60) : 'Unknown' });
} else {
reportLines.push({ type: 'warning', label: 'No backup metadata found.' });
}
reportLines.push({ type: 'section', label: 'Collection Summary' });
const collections = [
['mfg', 'Production'],
['sales', 'Calculator History'],
['customerSales', 'Customer Sales'],
['repSales', 'Rep Sales'],
['repCustomers', 'Rep Customers'],
['salesCustomers', 'Sales Customers'],
['paymentTransactions', 'Payment Transactions'],
['paymentEntities', 'Payment Entities'],
['factoryInventoryData', 'Factory Inventory'],
['factoryProductionHistory', 'Factory History'],
['stockReturns', 'Stock Returns'],
['expenses', 'Expenses'],
];
let totalIssues = 0;
for (const [key, label] of collections) {
if (!data[key] || !Array.isArray(data[key])) {
reportLines.push({ type: 'row', label, value: 'Not present', muted: true });
continue;
}
const records = data[key];
if (records.length === 0) {
reportLines.push({ type: 'row', label, value: '0 records', muted: true });
continue;
}
const ids = records.map(r => r.id).filter(Boolean);
const uniqueIds = new Set(ids);
const duplicates = ids.length - uniqueIds.size;
const missingIds = records.length - ids.length;
let statusParts = [`${records.length} records`];
let hasIssue = false;
if (duplicates > 0) { statusParts.push(`⚠ ${duplicates} duplicate IDs`); totalIssues += duplicates; hasIssue = true; }
if (missingIds > 0) { statusParts.push(`⚠ ${missingIds} missing IDs`); totalIssues += missingIds; hasIssue = true; }
reportLines.push({
type: 'row',
label,
value: statusParts.join(' · '),
issue: hasIssue
});
}
reportLines.push({ type: 'section', label: 'Settings & Formulas' });
const settingsKeys = [
['factoryDefaultFormulas', 'Factory Default Formulas'],
['factoryAdditionalCosts', 'Additional Costs'],
['factoryCostAdjustmentFactor', 'Cost Adjustment Factor'],
['factorySalePrices', 'Sale Prices'],
['factoryUnitTracking', 'Unit Tracking'],
['settings', 'App Settings (naswar)'],
];
for (const [key, label] of settingsKeys) {
const present = data[key] !== undefined && data[key] !== null;
reportLines.push({ type: 'row', label, value: present ? 'Present ✓' : 'Not present', muted: !present });
}
const tombstoneCount = Array.isArray(data.deleted_records) ? data.deleted_records.length : 0;
reportLines.push({ type: 'section', label: 'Deleted Records (Tombstones)' });
reportLines.push({ type: 'row', label: 'Tombstone count', value: String(tombstoneCount) });
const verdict = totalIssues > 0
? { icon: '', color: '#f59e0b', text: `${totalIssues} issue${totalIssues !== 1 ? 's' : ''} found — restore will auto-clean on import` }
: { icon: '', color: '#10b981', text: 'File looks healthy — no duplicates or format issues detected' };
const existing = document.getElementById('backup-analysis-modal');
if (existing) existing.remove();
const modal = document.createElement('div');
modal.id = 'backup-analysis-modal';
modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:10001;padding:16px;';
const rowsHtml = reportLines.map(line => {
if (line.type === 'section') {
return `<div style="font-size:0.65rem;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:0.08em;margin:14px 0 6px 0;padding-top:10px;border-top:1px solid var(--glass-border);">${esc(line.label)}</div>`;
}
if (line.type === 'warning') {
return `<div style="font-size:0.72rem;color:#f59e0b;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:8px 10px;margin:4px 0;">⚠ ${esc(line.label)}</div>`;
}
const valueColor = line.issue ? '#f59e0b' : (line.muted ? 'var(--text-muted)' : 'var(--text-main)');
return `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:0.72rem;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
<span style="color:var(--text-muted);flex-shrink:0;">${esc(line.label)}</span>
<span style="color:${valueColor};text-align:right;font-weight:${line.issue ? '600' : '400'};">${esc(line.value)}</span>
</div>`;
}).join('');
modal.innerHTML = `
<div style="background:var(--glass);border:1px solid var(--glass-border);padding:24px;border-radius:24px;max-width:480px;width:100%;max-height:85vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,0.6);">
<h3 style="margin:0 0 4px 0;color:var(--text-main);font-size:1rem;display:flex;align-items:center;gap:8px;">
Backup File Analysis
</h3>
<div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:16px;">${esc(file.name)} · ${(file.size / 1024).toFixed(1)} KB</div>
<div style="background:var(--input-bg);border-radius:14px;padding:14px;margin-bottom:16px;">
${rowsHtml}
</div>
<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:14px;border:1px solid;background:${verdict.color}18;border-color:${verdict.color}44;margin-bottom:16px;">
<span style="font-size:1.2rem;">${esc(verdict.icon)}</span>
<span style="font-size:0.75rem;color:${verdict.color};font-weight:600;">${esc(verdict.text)}</span>
</div>
<div style="display:flex;gap:10px;">
<button onclick="document.getElementById('backup-analysis-modal').remove(); document.getElementById('restoreInput').click();"
style="flex:1;padding:12px;background:var(--accent);border:none;border-radius:14px;color:white;cursor:pointer;font-size:0.82rem;font-weight:600;">
Restore This File
</button>
<button onclick="document.getElementById('backup-analysis-modal').remove();"
style="flex:1;padding:12px;background:var(--glass);border:1px solid var(--glass-border);border-radius:14px;color:var(--text-main);cursor:pointer;font-size:0.82rem;">
Close
</button>
</div>
</div>
`;
document.body.appendChild(modal);
modal.addEventListener('click', (ev) => {
if (ev.target === modal) modal.remove();
});
} catch (error) {
console.error('analyzeBackupFile error:', _safeErr(error));
showToast('Could not parse backup file: ' + error.message, 'error');
}
};
(function() {
  let _adminLoaded = false;
  let _adminLoading = null;
  function _loadAdminModule() {
    if (_adminLoaded) return Promise.resolve();
    if (_adminLoading) return _adminLoading;
    _adminLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'admin-data.js';
      script.onload = () => { _adminLoaded = true; resolve(); };
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return _adminLoading;
  }
  window.showDeltaSyncDetails = async function() {
    await _loadAdminModule();
    if (typeof window._showDeltaSyncDetails === 'function') {
      return window._showDeltaSyncDetails();
    }
  };
  window.showCloseFinancialYearDialog = async function() {
    await _loadAdminModule();
    if (typeof window._showCloseFinancialYearDialog === 'function') {
      return window._showCloseFinancialYearDialog();
    }
  };
})();
async function loadDeviceList() {
const container = document.getElementById('device-list-container');
if (!container) return;
if (!firebaseDB || !currentUser) {
container.innerHTML = `
<div class="u-empty-state-sm" >
Please log in to view devices
</div>
`;
return;
}
try {
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
const devicesSnap = await userRef.collection('devices').get();
if (devicesSnap.empty) {
container.innerHTML = `
<div class="u-empty-state-sm" >
No devices registered yet
</div>
`;
return;
}
const currentDeviceId = await getDeviceId();
const now = Date.now();
let accountEmail = currentUser.email || 'Unknown';
try {
const accountInfoSnap = await userRef.collection('account').doc('info').get();
if (accountInfoSnap.exists) {
const accountData = accountInfoSnap.data();
accountEmail = accountData.email || accountEmail;
}
} catch (e) {
console.error('An unexpected error occurred.', _safeErr(e));
showToast('An unexpected error occurred.', 'error');
}
const seenIds = new Set();
const uniqueDocs = devicesSnap.docs.filter(doc => {
const data = doc.data();
const id = data.deviceId;
if (!id || id === 'default_device' || doc.id === 'default_device') return false;
if (id === currentDeviceId || doc.id === currentDeviceId) return false;
if (seenIds.has(id) || seenIds.has(doc.id)) return false;
seenIds.add(id);
seenIds.add(doc.id);
return true;
});
if (uniqueDocs.length === 0) {
container.innerHTML = `
<div class="u-empty-state-sm" >
No other devices registered
</div>
`;
return;
}
let html = `
<div style="margin-bottom: 15px; padding: 10px; background: rgba(0, 122, 255, 0.1); border-radius: 8px; border: 1px solid rgba(0, 122, 255, 0.3);">
<div style="font-size: 0.75rem; color: var(--accent); font-weight: 600;">
Account: ${accountEmail}
</div>
<div class="u-field-hint-xxs" >
Total Devices: ${uniqueDocs.length} • Online: ${uniqueDocs.filter(d => {
const ls = d.data().lastSeen?.toMillis() || 0;
return (now - ls) < 60000;
}).length}
</div>
</div>
`;
uniqueDocs.forEach(doc => {
const device = doc.data();
const lastSeen = device.lastSeen?.toMillis() || 0;
const isOnline = (now - lastSeen) < 60000;
const totalCommands = device.totalCommands || 0;
const remoteAppliedMode = device.remoteAppliedMode || null;
const remoteAppliedAt = device.remoteAppliedAt || null;
const remoteAppliedBy = device.remoteAppliedBy || null;
const deviceMode = device.currentMode || 'admin';
const assignedRep = device.assignedRep || null;
const assignedManager = device.assignedManager || null;
const assignedUserTabs = Array.isArray(device.assignedUserTabs) ? device.assignedUserTabs : [];
const modeLabel = deviceMode === 'admin'
? 'ADMIN'
: deviceMode === 'userrole'
? (assignedManager || 'USER ROLE')
: deviceMode === 'production'
? (assignedManager || 'PRODUCTION')
: deviceMode === 'factory'
? (assignedManager || 'FACTORY')
: (assignedRep || 'REP');
const modeColor = deviceMode === 'admin' ? '#007aff'
: deviceMode === 'userrole' ? '#ffcc02'
: deviceMode === 'production' ? '#69f0ae'
: deviceMode === 'factory' ? '#ce93d8'
: '#ff9f0a';
const modeIcon = '';
const onlineColor = isOnline ? '#30d158' : '#ff453a';
const onlineDot = isOnline ? '● Online' : '○ Offline';
let deviceShard = 'N/A';
if (device.deviceId && typeof deriveDeviceShard === 'function') {
try {
deviceShard = deriveDeviceShard(device.deviceId).toUpperCase();
} catch (_) { deviceShard = 'N/A'; }
}
let cardHtml = '<div style="margin-bottom:12px;padding:14px;background:var(--glass);border-radius:14px;border:2px solid var(--glass-border);">';
cardHtml += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;gap:8px;">';
cardHtml += '<div style="font-size:0.65rem;font-family:\'Geist Mono\',monospace;color:var(--text-muted);flex:1;min-width:0;line-height:1.4;" title="Device shard: ' + deviceShard + '">Shard: <span style="color:var(--accent);font-weight:700;letter-spacing:0.08em;">' + deviceShard + '</span></div>';
cardHtml += '<div style="text-align:right;flex-shrink:0;">';
cardHtml += '<div style="font-size:0.8rem;font-weight:800;color:' + modeColor + ';white-space:nowrap;">' + modeLabel + '</div>';
cardHtml += '<div style="font-size:0.6rem;color:' + onlineColor + ';margin-top:2px;">' + onlineDot + '</div>';
cardHtml += '</div>';
cardHtml += '</div>';
const lastSeenStr = lastSeen ? new Date(lastSeen).toLocaleString() : 'Never';
cardHtml += '<div style="font-size:0.6rem;color:var(--text-muted);margin-bottom:6px;">Last seen: ' + lastSeenStr + '</div>';
const lastCmdStr = remoteAppliedAt ? new Date(remoteAppliedAt).toLocaleString() : null;
const lastCmdMode = remoteAppliedMode ? remoteAppliedMode.toUpperCase() : null;
const lastCmdBy = remoteAppliedBy || null;
if (lastCmdMode || totalCommands > 0) {
cardHtml += '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:11px;padding:7px 10px;background:rgba(255,255,255,0.04);border-radius:8px;border:1px solid var(--glass-border);">';
cardHtml += '<span style="font-size:0.6rem;color:var(--text-muted);flex-shrink:0;">Commands:</span>';
if (totalCommands > 0) {
cardHtml += '<span style="font-size:0.62rem;font-weight:700;color:var(--accent);background:var(--accent-dim);padding:2px 7px;border-radius:99px;">' + totalCommands + ' sent</span>';
}
if (lastCmdMode) {
cardHtml += '<span style="font-size:0.62rem;font-weight:700;color:var(--text-main);">→ ' + lastCmdMode + '</span>';
}
if (lastCmdBy) {
cardHtml += '<span style="font-size:0.6rem;color:var(--text-muted);">by ' + esc(lastCmdBy) + '</span>';
}
if (lastCmdStr) {
cardHtml += '<span style="font-size:0.58rem;color:var(--text-secondary);margin-left:auto;">' + lastCmdStr + '</span>';
}
cardHtml += '</div>';
} else {
cardHtml += '<div style="margin-bottom:11px;padding:7px 10px;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid var(--glass-border);font-size:0.6rem;color:var(--text-secondary);">No commands sent yet</div>';
}
const isAdmin = deviceMode === 'admin';
const adminBg = isAdmin ? 'rgba(0,122,255,0.18)' : 'rgba(0,122,255,0.08)';
const adminBord = isAdmin ? '2px solid rgba(0,122,255,0.55)' : '1px solid rgba(0,122,255,0.25)';
const adminFw = isAdmin ? '800' : '600';
const adminTick = isAdmin ? '✓ ' : '';
cardHtml += '<button onclick="remoteControlDevice(\'' + device.deviceId + '\', \'admin\')"';
cardHtml += ' style="width:100%;padding:9px;background:' + adminBg + ';border:' + adminBord + ';border-radius:99px;color:#007aff;cursor:pointer;font-size:0.72rem;font-weight:' + adminFw + ';margin-bottom:10px;">' + adminTick + 'Admin Mode</button>';
if (salesRepsList.length > 0) {
cardHtml += '<div style="font-size:0.6rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:5px;">Sales Representatives</div>';
cardHtml += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:5px;margin-bottom:10px;">';
const repColors = [
{bg:'48,209,88',hex:'#30d158'},{bg:'255,159,10',hex:'#ff9f0a'},
{bg:'191,90,242',hex:'#bf5af2'},{bg:'255,69,58',hex:'#ff453a'},{bg:'90,200,250',hex:'#5ac8fa'}
];
for (let ri = 0; ri < salesRepsList.length; ri++) {
const rep = salesRepsList[ri];
const c = repColors[ri % repColors.length];
const repLocked = deviceMode === 'rep' && assignedRep === rep;
const repBg = 'rgba(' + c.bg + ',' + (repLocked ? '0.22' : '0.08') + ')';
const repBord = (repLocked ? '2' : '1') + 'px solid rgba(' + c.bg + ',' + (repLocked ? '0.65' : '0.28') + ')';
const repFw = repLocked ? '800' : '600';
const repTick = repLocked ? '✓ ' : '';
cardHtml += '<button onclick="remoteControlDevice(\'' + device.deviceId + '\', \'rep\', \'' + rep + '\')"';
cardHtml += ' style="padding:8px 5px;background:' + repBg + ';border:' + repBord + ';border-radius:99px;color:' + c.hex + ';cursor:pointer;font-size:0.68rem;font-weight:' + repFw + ';text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">';
cardHtml += repTick + rep + '</button>';
}
cardHtml += '</div>';
}
if (userRolesList.length > 0) {
cardHtml += '<div style="font-size:0.6rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:5px;">User Roles</div>';
cardHtml += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:5px;margin-bottom:10px;">';
for (let ui = 0; ui < userRolesList.length; ui++) {
const user = userRolesList[ui];
const userLocked = deviceMode === 'userrole' && device.assignedManager === user.name;
const userBg = 'rgba(255,204,2,' + (userLocked ? '0.22' : '0.08') + ')';
const userBord = (userLocked ? '2' : '1') + 'px solid rgba(255,204,2,' + (userLocked ? '0.65' : '0.28') + ')';
const userFw = userLocked ? '800' : '600';
const userTick = userLocked ? '✓ ' : '';
const lookupKey = '_devTabsCache';
if (!window[lookupKey]) window[lookupKey] = {};
window[lookupKey][device.deviceId + '_' + ui] = user.tabs || [];
cardHtml += '<button onclick="remoteControlDevice(\'' + device.deviceId + '\', \'userrole\', \'' + user.name + '\', (window._devTabsCache||{})[\'' + device.deviceId + '_' + ui + '\'])"';
cardHtml += ' style="padding:8px 5px;background:' + userBg + ';border:' + userBord + ';border-radius:99px;color:#ffcc02;cursor:pointer;font-size:0.68rem;font-weight:' + userFw + ';text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">';
cardHtml += userTick + user.name + '</button>';
}
cardHtml += '</div>';
}
cardHtml += '<button onclick="removeDevice(\'' + device.deviceId + '\')"';
cardHtml += ' style="width:100%;padding:7px;background:rgba(255,69,58,0.07);border:1px solid rgba(255,69,58,0.28);border-radius:99px;color:#ff453a;cursor:pointer;font-size:0.65rem;">Remove Device</button>';
cardHtml += '</div>';
html += cardHtml;
});
container.innerHTML = html;
} catch (error) {
console.error('An unexpected error occurred.', _safeErr(error));
showToast('An unexpected error occurred.', 'error');
container.innerHTML = `
<div style="text-align: center; padding: 20px; color: #ff453a;">
Error loading devices: ${esc(error.message)}
</div>
`;
}
}
async function refreshDeviceList() {
const container = document.getElementById('device-list-container');
if (container) {
container.innerHTML = `
<div class="u-empty-state-sm" >
Refreshing...
</div>
`;
}
await loadDeviceList();
showToast(' Device list refreshed', 'success', 2000);
}
async function remoteControlDevice(deviceId, targetMode, repName = null, userTabs = null) {
if (!firebaseDB || !currentUser) {
showToast('Not logged in', 'error', 3000);
return;
}
let _rcTitle, _rcMsg, _rcConfirm;
if (targetMode === 'admin') {
_rcTitle = 'Unlock to Admin Mode';
_rcMsg = 'Unlock this device to full Admin mode?\n\nAll tabs and admin features will become accessible.';
_rcConfirm = 'Unlock to Admin';
} else if (targetMode === 'rep' && repName) {
_rcTitle = 'Lock Device — Sales Rep';
_rcMsg = `Lock this device to Sales Rep mode for ${repName}?\n\nThe device will only show the Rep Sales tab. All admin features, tabs and controls will be hidden until unlocked remotely.`;
_rcConfirm = `Lock to ${repName}`;
} else if (targetMode === 'userrole' && repName) {
const tabLabels = { prod: 'Production', factory: 'Factory', sales: 'Sales', payments: 'Payments' };
const tabList = Array.isArray(userTabs) ? userTabs.map(t => tabLabels[t] || t).join(', ') : 'assigned tabs';
_rcTitle = 'Lock Device — User Role';
_rcMsg = `Lock this device to User Role for ${repName}?\n\nAssigned tabs: ${tabList}\n\nOnly the assigned sections will be visible. All other tabs, analytics and admin controls will be hidden.`;
_rcConfirm = `Lock to ${repName}`;
} else {
_rcTitle = 'Switch Device Mode';
_rcMsg = `Switch this device to ${targetMode.toUpperCase()} mode?`;
_rcConfirm = 'Confirm';
}
const confirmed = await showGlassConfirm(_rcMsg, {
title: _rcTitle,
confirmText: _rcConfirm,
cancelText: 'Cancel',
danger: targetMode !== 'admin'
});
if (!confirmed) return;
try {
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
const commandTimestamp = firebase.firestore.FieldValue.serverTimestamp();
const deviceRef = userRef.collection('devices').doc(deviceId);
const updateData = {
targetMode: targetMode,
targetModeTimestamp: commandTimestamp,
commandSource: 'remote_admin',
lastControlled: commandTimestamp,
controlledBy: currentUser.email || 'Admin',
currentMode: targetMode,
assignedRep: targetMode === 'rep' ? (repName || null) : null,
assignedManager: targetMode === 'userrole' ? (repName || null) : null,
assignedUserTabs: targetMode === 'userrole' ? (userTabs || []) : null,
assignedRoleType: targetMode,
assignedRoleName: repName || null,
lockedAt: repName ? commandTimestamp : null,
lockedBy: repName ? (currentUser.email || 'Admin') : null,
};
await deviceRef.set(updateData, { merge: true });
const successMsg = targetMode === 'admin'
? '✓ Device unlocked to Admin mode'
: targetMode === 'rep' ? `✓ Device locked to Sales Rep: ${repName}`
: targetMode === 'userrole' ? `✓ Device locked to User: ${repName}`
: `✓ Command sent: ${targetMode}`;
showToast(successMsg, 'success', 3500);
setTimeout(loadDeviceList, 2000);
} catch (error) {
showToast('Failed to control device: ' + error.message, 'error', 4000);
}
}
async function removeDevice(deviceId) {
if (!firebaseDB || !currentUser) {
showToast('Not logged in', 'error', 3000);
return;
}
if (!deviceId || !validateUUID(String(deviceId))) {
showToast('Invalid device ID', 'error', 3000);
return;
}
const _rdMsg = `Remove this device from the trusted list?\n\nThe device will no longer be able to sync data or receive remote commands. It will need to be re-approved if the user tries to reconnect.\n\nThis does not delete any data already on the device.`;
if (!(await showGlassConfirm(_rdMsg, { title: 'Remove Trusted Device', confirmText: 'Remove', danger: true }))) {
return;
}
try {
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
const deviceRef = userRef.collection('devices').doc(deviceId);
await deviceRef.delete();
showToast('Device removed', 'success', 3000);
await loadDeviceList();
} catch (error) {
showToast('Failed to remove device: ' + error.message, 'error', 3000);
}
}
window.loadDeviceList = loadDeviceList;
window.refreshDeviceList = refreshDeviceList;
window.remoteControlDevice = remoteControlDevice;
window.removeDevice = removeDevice;
window.getDeviceId = getDeviceId;
window.getDeviceName = getDeviceName;
window.registerDevice = registerDevice;
async function restoreDeviceModeOnLogin(uid) {
if (!firebaseDB) return;
try {
const deviceId = await getDeviceId();
const userRef = firebaseDB.collection('users').doc(uid);
const deviceRef = userRef.collection('devices').doc(deviceId);
const deviceDoc = await deviceRef.get();
if (!deviceDoc.exists) {
return;
}
const data = deviceDoc.data();
const cloudMode = data.currentMode || 'admin';
const cloudTimestamp = data.appMode_timestamp || 0;
const localTimestamp = (await idb.get('appMode_timestamp')) || 0;
const _modeIsLocked = cloudMode !== 'admin';
const _localIsAdmin = appMode === 'admin';
const shouldRestore = (cloudMode && cloudTimestamp > localTimestamp && cloudMode !== appMode)
  || (_modeIsLocked && _localIsAdmin);
if (shouldRestore) {
const previousMode = appMode;
appMode = cloudMode;
const modeBatch = [
['appMode', appMode],
['appMode_timestamp', cloudTimestamp]
];
if (cloudMode === 'rep' && data.assignedRep) {
currentRepProfile = data.assignedRep;
modeBatch.push(['repProfile', currentRepProfile]);
modeBatch.push(['repProfile_timestamp', data.repProfile_timestamp || cloudTimestamp]);
} else if (cloudMode === 'userrole' && data.assignedManager) {
window._assignedManagerName = data.assignedManager;
window._assignedUserTabs = Array.isArray(data.assignedUserTabs) ? data.assignedUserTabs : [];
modeBatch.push(['assignedManager', data.assignedManager]);
modeBatch.push(['assignedUserTabs', window._assignedUserTabs]);
} else if ((cloudMode === 'production' || cloudMode === 'factory') && data.assignedManager) {
window._assignedManagerName = data.assignedManager;
modeBatch.push(['assignedManager', data.assignedManager]);
}
await idb.setBatch(modeBatch);
const modeLabel = appMode === 'rep' ? 'Rep Mode' : appMode === 'userrole' ? 'User Role Mode' : appMode === 'production' ? 'Production Mode' : appMode === 'factory' ? 'Factory Mode' : 'Admin Mode';
const isRemote = !!data.remoteAppliedMode;
showToast(isRemote
? `Restoring remotely assigned ${modeLabel}...`
: `Switching to ${modeLabel}...`, 'info', 2000);
setTimeout(() => { window.location.reload(); }, 1500);
} else {
}
} catch (error) {
console.error('Failed to save data locally.', _safeErr(error));
showToast('Failed to save data locally.', 'error');
}
}
window.restoreDeviceModeOnLogin = restoreDeviceModeOnLogin;
async function listenForDeviceCommands() {
if (!firebaseDB || !currentUser) return;
// Unsubscribe any existing listener first to avoid duplicates
if (typeof window.deviceCommandsUnsubscribe === 'function') {
try { window.deviceCommandsUnsubscribe(); } catch (_) {}
window.deviceCommandsUnsubscribe = null;
}
try {
const deviceId = await getDeviceId();
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
const deviceRef = userRef.collection('devices').doc(deviceId);
const unsubscribe = deviceRef.onSnapshot((doc) => {
try {
if (!doc.exists) return;
const data = doc.data();
if (!data || !data.targetMode || !data.targetModeTimestamp) return;
const targetMode = data.targetMode;
let resolvedName = null;
const roleType = data.assignedRoleType || targetMode;
if (roleType === 'rep') {
resolvedName = data.assignedRoleName || data.assignedRep || null;
} else if (roleType === 'userrole' || roleType === 'production' || roleType === 'factory') {
resolvedName = data.assignedRoleName || data.assignedManager || null;
}
const effectiveMode = data.assignedRoleType || targetMode;
const resolvedUserTabs = Array.isArray(data.assignedUserTabs) ? data.assignedUserTabs : [];
const commandTimestamp = data.targetModeTimestamp.toMillis
? data.targetModeTimestamp.toMillis()
: (typeof data.targetModeTimestamp === 'number' ? data.targetModeTimestamp : 0);
if (!commandTimestamp) return;
const lastProcessed = window.lastProcessedCommandTimestamp || 0;
if (commandTimestamp > lastProcessed) {
applyRemoteModeChange(effectiveMode, data.commandSource || 'remote', resolvedName, resolvedUserTabs);
window.lastProcessedCommandTimestamp = commandTimestamp;
}
} catch (snapErr) {
console.warn('Device command snapshot handler error:', snapErr);
}
}, (error) => {
console.warn('Device command listener error — will retry in 15s:', error);
// Retry listener after a delay if it fails due to transient Firestore state
window.deviceCommandsUnsubscribe = null;
setTimeout(() => {
if (firebaseDB && currentUser) listenForDeviceCommands();
}, 15000);
});
window.deviceCommandsUnsubscribe = unsubscribe;
} catch (error) {
console.error('listenForDeviceCommands failed:', _safeErr(error));
}
}
async function applyRemoteModeChange(targetMode, source, repName = null, userTabs = null) {
const previousMode = appMode;
const previousManager = window._assignedManagerName || null;
const previousTabs = JSON.stringify(window._assignedUserTabs || []);
if (previousMode === targetMode) {
if (targetMode === 'admin') return;
if (targetMode === 'rep' && currentRepProfile === repName) return;
if (targetMode === 'userrole' && previousManager === repName && previousTabs === JSON.stringify(userTabs || [])) return;
}
appMode = targetMode;
const nowMs = Date.now();
const batchData = [['appMode', appMode], ['appMode_timestamp', nowMs]];
if (targetMode === 'rep' && repName) {
currentRepProfile = repName;
batchData.push(['repProfile', repName], ['repProfile_timestamp', nowMs]);
if (!salesRepsList.includes(repName)) {
salesRepsList.push(repName);
batchData.push(['sales_reps_list', salesRepsList]);
if (typeof renderAllRepUI === 'function') renderAllRepUI();
}
} else if (targetMode === 'userrole') {
window._assignedManagerName = repName || null;
window._assignedUserTabs = Array.isArray(userTabs) ? userTabs : [];
batchData.push(['assignedManager', repName || null], ['assignedUserTabs', window._assignedUserTabs]);
} else if (targetMode === 'production' || targetMode === 'factory') {
window._assignedManagerName = repName || null;
batchData.push(['assignedManager', repName || null]);
} else if (targetMode === 'admin') {
window._assignedManagerName = null;
window._assignedUserTabs = [];
batchData.push(['assignedManager', null], ['assignedUserTabs', []]);
}
await idb.setBatch(batchData);
if (firebaseDB && currentUser) {
try {
const deviceId = await getDeviceId();
const deviceRef = firebaseDB.collection('users').doc(currentUser.uid)
.collection('devices').doc(deviceId);
const payload = {
currentMode: targetMode, appMode_timestamp: nowMs,
remoteAppliedMode: targetMode, remoteAppliedAt: nowMs, remoteAppliedBy: source || 'remote',
assignedRoleType: targetMode, assignedRoleName: repName || null,
assignedRep: targetMode === 'rep' ? (repName || null) : null,
assignedManager: targetMode === 'userrole' ? (repName || null) : null,
assignedUserTabs: targetMode === 'userrole' ? (window._assignedUserTabs || []) : null,
};
if (targetMode === 'rep') payload.repProfile_timestamp = nowMs;
await deviceRef.set(payload, { merge: true });
} catch (e) { console.error('Firebase write failed:', _safeErr(e)); }
}
if (targetMode === 'rep') {
if (typeof lockToRepMode === 'function') lockToRepMode();
if (typeof renderRepCustomerTable === 'function') renderRepCustomerTable();
showToast(repName ? `Locked to Rep: ${repName}` : 'Device locked to Rep Sales mode', 'info', 4000);
} else if (targetMode === 'userrole') {
window._userRoleAllowedTabs = window._assignedUserTabs || [];
if (typeof lockToUserRoleMode === 'function') lockToUserRoleMode();
showToast(repName ? `Locked to User: ${repName}` : 'Device locked to User Role mode', 'info', 4000);
} else if (targetMode === 'production') {
if (typeof lockToProductionMode === 'function') lockToProductionMode();
showToast(repName ? `Locked to Production: ${repName}` : 'Device locked to Production mode', 'info', 4000);
} else if (targetMode === 'factory') {
if (typeof lockToFactoryMode === 'function') lockToFactoryMode();
showToast(repName ? `Locked to Factory: ${repName}` : 'Device locked to Factory mode', 'info', 4000);
} else if (targetMode === 'admin') {
if (typeof unlockToAdminMode === 'function') unlockToAdminMode();
if (typeof notifyDataChange === 'function') notifyDataChange('all');
showToast('Device unlocked to Admin mode', 'info', 4000);
}
}
window.listenForDeviceCommands = listenForDeviceCommands;
function listenForTeamChanges() {
if (window._teamUnsubscribe) {
try { window._teamUnsubscribe(); } catch(e) {}
window._teamUnsubscribe = null;
}
}
window.listenForTeamChanges = listenForTeamChanges;
window.applyRemoteModeChange = applyRemoteModeChange;
