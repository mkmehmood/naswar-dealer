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
syncInterval: null,
pendingUpdates: new Set()
};
const OfflineQueue = {
queue: [],
deadLetterQueue: [],
isProcessing: false,
maxRetries: 10,
retryDelay: 2000,
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
console.error('Failed to save data locally.', error);
showToast('Failed to save data locally.', 'error');
}
},
async saveDeadLetterQueue() {
try {
await idb.set(this._dlKey, this.deadLetterQueue);
} catch (error) {
console.error('Failed to persist dead-letter queue.', error);
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
console.error('Failed to save data locally.', error);
item.retries++;
item.lastAttempt = Date.now();
item.error = error.message;
const backoff = Math.min(this.retryDelay * Math.pow(2, item.retries - 1), 30000);
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
case 'set':
await userRef.collection(collection).doc(docId).set(data, { merge: true });
trackFirestoreWrite(1);
break;
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
// Retry enableNetwork up to 3 times with back-off for flaky connections
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

// Re-sync when the tab becomes visible after being backgrounded (mobile resume, tab switch)
document.addEventListener('visibilitychange', async () => {
if (document.visibilityState !== 'visible') return;
if (!navigator.onLine) return;
if (typeof firebaseDB === 'undefined' || !firebaseDB) return;
if (window._firestoreNetworkDisabled) {
try {
await firebaseDB.enableNetwork();
window._firestoreNetworkDisabled = false;
} catch(e) { /* ignore */ }
}
setTimeout(() => {
if (typeof triggerAutoSync === 'function') triggerAutoSync();
}, 1500);
});

// Periodic connectivity probe: if browser says online but Firestore is disabled
// (e.g. after a flaky reconnect) re-enable Firestore every 30 s
setInterval(async () => {
if (!navigator.onLine) return;
if (typeof firebaseDB === 'undefined' || !firebaseDB) return;
if (!window._firestoreNetworkDisabled) return;
try {
await firebaseDB.enableNetwork();
window._firestoreNetworkDisabled = false;
if (typeof updateOfflineBanner === 'function') updateOfflineBanner();
if (typeof triggerAutoSync === 'function') triggerAutoSync();
} catch(e) { /* still offline at Firestore level */ }
}, 30000);

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
const deletedArr = ensureArray(results.get('deleted_records'));
deletedRecordIds = new Set(deletedArr);
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
console.error('Failed to load expense categories.', e);
showToast('Failed to load expense categories.', 'error');
}
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
console.error('Sync failed. Check your connection.', error);
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
break;
case 'sales':
if (typeof syncSalesTab === 'function' && !_tabSyncInProgress['sales']) {
_tabSyncInProgress['sales'] = true;
syncSalesTab().finally(() => { _tabSyncInProgress['sales'] = false; });
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
console.error('Tab sync failed.', error);
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
console.error('Calculation failed.', error);
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
console.error('Failed to load sales data.', error);
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
const map = new Map(freshInv.map(r => [r.id, r]));
(factoryInventoryData || []).forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
factoryInventoryData = Array.from(map.values()).filter(r => !deletedRecordIds.has(r.id));
}
const freshHist = dataMap.get('factory_production_history');
if (Array.isArray(freshHist)) {
const map = new Map(freshHist.map(r => [r.id, r]));
(factoryProductionHistory || []).forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
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
console.error('Failed to render data.', error);
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
const map = new Map(freshExp.map(r => [r.id, r]));
(expenseRecords || []).forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
expenseRecords = Array.from(map.values()).filter(r => !deletedRecordIds.has(r.id));
}
const freshEnt = dataMap.get('payment_entities');
if (Array.isArray(freshEnt)) {
const map = new Map(freshEnt.map(r => [r.id, r]));
(paymentEntities || []).forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
paymentEntities = Array.from(map.values()).filter(r => !deletedRecordIds.has(r.id));
}
const freshTx = dataMap.get('payment_transactions');
if (Array.isArray(freshTx)) {
const map = new Map(freshTx.map(r => [r.id, r]));
(paymentTransactions || []).forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
paymentTransactions = Array.from(map.values()).filter(r => !deletedRecordIds.has(r.id));
}
if (typeof refreshPaymentTab === 'function') refreshPaymentTab();
if (typeof renderEntityTable === 'function') renderEntityTable();
} catch (error) {
console.error('Payment tab refresh failed.', error);
showToast('Payment tab refresh failed.', 'error');
if (typeof refreshPaymentTab === 'function') setTimeout(refreshPaymentTab, 500);
}
}
async function syncProductionTab() {
try {
await idb.init();
const dataMap = await idb.getBatch(['mfg_pro_pkr', 'naswar_default_settings', 'stock_returns']);
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
const map = new Map(validated.map(r => [r.id, r]));
(db || []).forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
db = Array.from(map.values()).filter(r => !deletedRecordIds.has(r.id));
}
const freshSettings = dataMap.get('naswar_default_settings');
if (freshSettings && typeof freshSettings === 'object') defaultSettings = freshSettings;
const freshReturns = dataMap.get('stock_returns');
if (Array.isArray(freshReturns)) {
const map = new Map(freshReturns.map(r => [r.id, r]));
(stockReturns || []).forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
stockReturns = Array.from(map.values()).filter(r => !deletedRecordIds.has(r.id));
}
if (typeof refreshUI === 'function') refreshUI();
if (typeof updateMfgCharts === 'function') updateMfgCharts();
// Keep the sales tab inventory display in sync: re-evaluate available stock
// so the data-entry form reflects newly saved production immediately
if (typeof calculateCustomerSale === 'function') calculateCustomerSale();
} catch (error) {
console.error('UI refresh failed.', error);
showToast('UI refresh failed.', 'error');
if (typeof refreshUI === 'function') setTimeout(refreshUI, 500);
}
}
async function syncSalesTab() {
try {
await idb.init();
const freshSales = await idb.get('customer_sales', []);
if (Array.isArray(freshSales)) {
const validated = freshSales.map(r => ensureRecordIntegrity(r, false, true));
validated.sort((a, b) => compareTimestamps(getRecordTimestamp(b), getRecordTimestamp(a)));
const map = new Map(validated.map(r => [r.id, r]));
(customerSales || []).forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
customerSales = Array.from(map.values()).filter(r => !deletedRecordIds.has(r.id));
}
if (typeof refreshCustomerSales === 'function') refreshCustomerSales();
} catch (error) {
console.error('Customer data operation failed.', error);
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
const validated = freshRepSales.map(record => {
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
const map = new Map(validated.map(r => [r.id, r]));
(repSales || []).forEach(r => { if (!map.has(r.id)) map.set(r.id, r); });
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
console.error('An unexpected error occurred.', error);
showToast('An unexpected error occurred.', 'error');
if (typeof refreshRepUI === 'function') setTimeout(refreshRepUI, 500);
}
}
function startPeriodicSync() {
if (syncState.syncInterval) {
clearInterval(syncState.syncInterval);
}
syncState.syncInterval = setInterval(() => {
if (syncState.pendingUpdates.size > 0) {
processSync();
}
}, 2000);
}
function stopPeriodicSync() {
if (syncState.syncInterval) {
clearInterval(syncState.syncInterval);
syncState.syncInterval = null;
}
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
console.error('Failed to load app data.', error);
showToast('Failed to load app data.', 'error');
}
}
window.forceSync = async function() {
await reloadDataFromStorage();
syncState.pendingUpdates.add('all');
processSync();
};
triggerAutoSync();
const originalShowTab = window.showTab;
if (typeof originalShowTab === 'function') {
window.showTab = function(tab) {
originalShowTab(tab);
setTimeout(() => {
if (typeof notifyDataChange === 'function') notifyDataChange(tab);
}, 150);
};
}
window.addEventListener('beforeunload', function() {
if (typeof stopPeriodicSync === 'function') stopPeriodicSync();
});
let paymentEntities = [];
let paymentTransactions = [];
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
managedBy: (appMode === 'production' && window._assignedManagerName) ? window._assignedManagerName : null
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
async function registerDeletion(id, collectionName = 'unknown') {
if (!id) {
return;
}
if (!validateUUID(id)) {
return;
}
const now = getTimestamp();
const deletionRecord = {
id: id,
deletedAt: now,
collection: collectionName,
syncedToCloud: false,
tombstoned_at: now,
deleted_by: 'user',
deletion_version: '2.0'
};
if (!validateTimestamp(deletionRecord.deletedAt, false)) {
deletionRecord.deletedAt = now;
deletionRecord.tombstoned_at = now;
}
deletedRecordIds.add(id);
let deletionRecords = await idb.get('deletion_records', []);
if (!Array.isArray(deletionRecords)) deletionRecords = [];
const existingIndex = deletionRecords.findIndex(r => r.id === id);
if (existingIndex >= 0) {
deletionRecords[existingIndex] = deletionRecord;
} else {
deletionRecords.push(deletionRecord);
}
await idb.set('deletion_records', deletionRecords);
await idb.set('deleted_records', Array.from(deletedRecordIds));
triggerAutoSync();
await uploadDeletionToCloud(deletionRecord);
await cleanupOldDeletions();
}
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
expiresAt: firebase.firestore.Timestamp.fromMillis(deletionRecord.deletedAt + (90 * 24 * 60 * 60 * 1000))
});
if (deletionRecord.collection && deletionRecord.collection !== 'unknown') {
const itemRef = userRef.collection(deletionRecord.collection).doc(String(deletionRecord.id));
batch.delete(itemRef);
}
await batch.commit();
trackFirestoreWrite(2);
let deletionRecords = await idb.get('deletion_records', []);
if (Array.isArray(deletionRecords)) {
const index = deletionRecords.findIndex(r => r.id === deletionRecord.id);
if (index > -1) {
deletionRecords[index].syncedToCloud = true;
await idb.set('deletion_records', deletionRecords);
}
}
} catch (error) {
console.error('Failed to save data locally.', error);
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
await idb.set('deletion_records', validDeletions);
deletedRecordIds.clear();
validDeletions.forEach(record => deletedRecordIds.add(record.id));
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
console.error('Failed to save data locally.', error);
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
requestAnimationFrame(() => {
document.body.style.overflow = 'hidden';
document.documentElement.style.overflow = 'hidden';
const overlayEl = document.getElementById('entityDetailsOverlay');
if (overlayEl) overlayEl.style.display = 'flex';
});
await renderEntityOverlayContent(entity);
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
list.innerHTML = '';
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
list.innerHTML = `<div class="u-empty-state-sm" >No transaction history</div>`;
return;
}
transactions.forEach(t => {
const isOut = t.type === 'OUT';
const colorClass = isOut ? 'cost-val' : 'profit-val';
const badgeBg = isOut ? 'rgba(220, 38, 38, 0.1)' : 'rgba(5, 150, 105, 0.1)';
const badgeColor = isOut ? 'var(--danger)' : 'var(--accent-emerald)';
const label = isOut ? 'PAYMENT OUT' : 'PAYMENT IN';
const item = document.createElement('div');
item.className = 'cust-history-item';
item.innerHTML = `
<div class="cust-history-info">
<div class="u-mono-bold" >${formatDisplayDate(t.date)}</div>
<div class="u-fs-sm2 u-text-muted" >${esc(t.description || 'No description')}</div>
${t.isMerged ? _mergedBadgeHtml(t) : ''}
</div>
<div style="text-align:right; margin-right:10px;">
<span style="background:${badgeBg}; color:${badgeColor}; padding:2px 6px; border-radius:4px; font-size:0.65rem; font-weight:700;">${label}</span>
<div class="${colorClass}" style="font-size:0.9rem; margin-top:2px;">${fmtAmt(t.amount)}</div>
</div>
<button class="btn btn-sm btn-danger u-p-4-8" onclick="deleteEntityTransaction('${esc(t.id)}')">⌫</button>
`;
list.appendChild(item);
});
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
let txnId = generateUUID('qtxn');
if (!validateUUID(txnId)) {
txnId = generateUUID('qtxn');
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
syncedAt: new Date().toISOString()
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
if (typeof renderUnifiedTable === 'function') renderUnifiedTable(1);
}
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
const _dtPayable = _dt.isPayable === true && _dt.type === 'OUT';
const _dtSupplierMats = _dtPayable
? factoryInventoryData.filter(m => String(m.supplierId) === String(_dt.entityId))
: [];
let _dtMsg = `Delete this ${_dtTypeLabel}?`;
_dtMsg += `\n\nEntity: ${_dtEntityName}`;
_dtMsg += `\nAmount: ${_dtAmount}`;
_dtMsg += `\nDate: ${_dtDate}`;
if (_dtDesc) _dtMsg += _dtDesc;
if (_dtPayable && _dtSupplierMats.length > 0) {
_dtMsg += `\n\n↩ Supplier debt reversal: This payment will be unrecorded and ${_dtSupplierMats.length} raw material${_dtSupplierMats.length !== 1 ? 's' : ''} for "${_dtEntityName}" will revert to outstanding payable status.`;
} else if (_dt.type === 'IN') {
_dtMsg += `\n\n↩ This received payment will be removed from the entity balance.`;
}
_dtMsg += `\n\nThis cannot be undone.`;
if (await showGlassConfirm(_dtMsg, { title: `Delete ${_dt.type === 'IN' ? 'Payment IN' : 'Payment OUT'}`, confirmText: "Delete", danger: true })) {
try {
const transaction = _dt;
const supplierId = transaction.entityId;
const wasPayable = transaction.isPayable === true;
const transactionType = transaction.type;
if (wasPayable && transactionType === 'OUT') {
const supplierMaterials = factoryInventoryData.filter(m =>
String(m.supplierId) === String(supplierId)
);
supplierMaterials.forEach(mat => {
const originalAmount = parseFloat((mat.totalValue || (mat.purchaseCost && mat.purchaseQuantity ? mat.purchaseCost * mat.purchaseQuantity : mat.quantity * mat.cost) || 0).toFixed(2));
mat.totalPayable = originalAmount;
mat.paymentStatus = 'pending';
delete mat.paidDate;
mat.updatedAt = getTimestamp();
});
const remainingPayments = paymentTransactions
.filter(t =>
t.id !== id &&
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
} else {
mat.totalPayable = parseFloat((mat.totalPayable - remaining).toFixed(2));
remaining = 0;
}
}
});
for (const mat of supplierMaterials) {
await unifiedSave('factory_inventory_data', factoryInventoryData, mat);
}
}
paymentTransactions = paymentTransactions.filter(t => t.id !== id);
await unifiedDelete('payment_transactions', paymentTransactions, id);
notifyDataChange('payments');
triggerAutoSync();
const entity = paymentEntities.find(e => String(e.id) === String(currentEntityId));
if (entity) renderEntityOverlayContent(entity);
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
if(!currentEntityId) return;
const _entityToDel = paymentEntities.find(e => String(e.id) === String(currentEntityId));
const _entityName = _entityToDel ? _entityToDel.name : 'this entity';
const _entityTxs = paymentTransactions.filter(t => String(t.entityId) === String(currentEntityId));
const hasTrans = _entityTxs.length > 0;
const _totalIn = _entityTxs.filter(t => t.type === 'IN').reduce((s,t) => s + (parseFloat(t.amount)||0), 0);
const _totalOut = _entityTxs.filter(t => t.type === 'OUT').reduce((s,t) => s + (parseFloat(t.amount)||0), 0);
let msg = `Permanently delete "${_entityName}"?`;
if (hasTrans) {
msg += `\n\n⚠ This entity has ${_entityTxs.length} transaction${_entityTxs.length !== 1 ? 's' : ''} on record`;
if (_totalIn > 0) msg += `\n • Received: ${fmtAmt(_totalIn)}`;
if (_totalOut > 0) msg += `\n • Paid out: ${fmtAmt(_totalOut)}`;
msg += `\n\nAll transaction history will be permanently deleted.`;
}
msg += `\n\nThis cannot be undone.`;
if (await showGlassConfirm(msg, { title: `Delete Entity`, confirmText: "Delete", danger: true })) {
try {
const associatedTransactions = paymentTransactions.filter(t => t.entityId === currentEntityId);
paymentEntities = paymentEntities.filter(e => e.id !== currentEntityId);
paymentTransactions = paymentTransactions.filter(t => t.entityId !== currentEntityId);
await unifiedDelete('payment_entities', paymentEntities, currentEntityId);
for (const trans of associatedTransactions) {
await deleteRecordFromFirestore('payment_transactions', trans.id);
}
await saveWithTracking('payment_transactions', paymentTransactions);
notifyDataChange('entities');
closeEntityDetailsOverlay();
if (typeof refreshPaymentTab === 'function') await refreshPaymentTab();
showToast("Entity deleted successfully", "success");
} catch (error) {
showToast('Failed to delete entity. Please try again.', 'error');
}
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
s.customerName === customerName &&
s.isRepModeEntry !== true &&
(!s.salesRep || s.salesRep === 'NONE' || s.salesRep === 'ADMIN' || s.transactionType === 'OLD_DEBT')
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
// Use stored unitPrice (set at save/merge time) or fixed getSalePriceForStore —
// never divide totalValue/quantity which gives a weighted average that changes
// after partial payments and differs from the canonical factory setting.
const getSalePrice = (t) => {
  if (t.unitPrice && t.unitPrice > 0) return t.unitPrice;
  return getSalePriceForStore(t.supplyStore || 'STORE_A');
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
    const val = t.totalValue || (t.quantity || 0) * getSalePrice(t);
    debit = val; credit = val;
    typeLabel = 'CASH';
    detailLabel = `${fmtAmt(t.quantity||0)} kg \xd7 Rs ${fmtAmt(getSalePrice(t))}\n${t.supplyStore?getStoreLabel(t.supplyStore):''}`;
  } else if (pt === 'CREDIT' && !t.creditReceived) {
    const val = t.totalValue || (t.quantity || 0) * getSalePrice(t);
    const partial = parseFloat(t.partialPaymentReceived) || 0;
    debit = val; credit = partial;
    typeLabel = partial > 0 ? 'CREDIT\n(PARTIAL)' : 'CREDIT';
    detailLabel = `${fmtAmt(t.quantity||0)} kg \xd7 Rs ${fmtAmt(getSalePrice(t))}`;
    if (partial > 0) detailLabel += `\nPaid: Rs ${fmtAmt(partial)} | Due: Rs ${fmtAmt(val-partial)}`;
  } else if (pt === 'CREDIT' && t.creditReceived) {
    const val = t.totalValue || (t.quantity || 0) * getSalePrice(t);
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

// SRI hashes only for self-hosted / pinned builds where the hash is known-good.
// Chart.js is loaded WITHOUT an integrity hash — CDN-served JS can vary between
// patch builds even at the same semver URL, making SRI hashes unreliable on CDNs.
const SCRIPT_INTEGRITY = {
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js':
    'sha256-4C8gBRoAE0XFxW0C7SsQ+X/TBkHSFM3YMwVaF4F8hk=',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js':
    'sha256-0ZQJSA5vPBL+6L5uyIjovZ/m7VBpAOUGc7BHOH/RBHE='
  // Chart.js intentionally omitted — no SRI, loaded by URL only
};

// Track in-flight script loads to prevent duplicate injection
const _scriptLoadPromises = {};

function loadScript(url, integrity) {
  // If already resolved (script tag present and presumably executed)
  const existing = document.querySelector('script[src="' + url + '"]');
  if (existing && !existing.dataset.failed) {
    // If it's already in the DOM and not marked failed, wait for it or resolve
    if (_scriptLoadPromises[url]) return _scriptLoadPromises[url];
    return Promise.resolve();
  }
  // If there's already an in-flight promise for this URL, reuse it
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
      // Mark failed and remove so a clean retry can be attempted
      script.dataset.failed = '1';
      document.head.removeChild(script);
      delete _scriptLoadPromises[url];
      if (sri) {
        // SRI mismatch — retry once without the integrity attribute
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

// Chart.js CDN URLs in priority order — first reachable one wins
const _CHARTJS_URLS = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.4/chart.umd.min.js',
  'https://unpkg.com/chart.js@4.4.4/dist/chart.umd.min.js'
];

let _chartJsPromise = null;
function loadChartJs() {
  if (window.Chart) return Promise.resolve();
  if (_chartJsPromise) return _chartJsPromise;
  // Try each CDN URL in sequence — no SRI on any of them
  _chartJsPromise = (async () => {
    for (const url of _CHARTJS_URLS) {
      try {
        await loadScript(url);
        if (window.Chart) return; // success
      } catch (e) {
        console.warn('Chart.js CDN failed, trying next:', url, e.message);
      }
    }
    // All CDNs failed
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
repSalesCash: 0,
repSalesCredits: 0,
calculatorCash: 0,
calculatorCredits: 0,
calculatorRecovered: 0,
paymentsIn: 0,
paymentsOut: 0,
expenses: 0
};
// Production Value = gross value of all manufactured goods in this period (not netted against sales)
db.forEach(item => {
if (item.isReturn) return; 
const itemDate = new Date(item.date);
if (itemDate >= startDate && itemDate <= endDate) {
rawData.totalProductionValue += item.totalSale || 0;
rawData.totalProductionQuantity += item.net || 0;
}
});
// Sales tab cash/credit streams (separate from production)
customerSales.forEach(sale => {
const saleDate = new Date(sale.date);
if (saleDate >= startDate && saleDate <= endDate) {
if (!isDirectSale(sale)) return; 
if (sale.isMerged && sale.mergedSummary) {
const ms = sale.mergedSummary;
rawData.salesCash    += (ms.cashSales    || 0);
rawData.salesCredits += (ms.unpaidCredit || 0);
} else if (sale.paymentType === 'CASH' || sale.creditReceived) {
rawData.salesCash += sale.totalValue || 0;
} else if (sale.paymentType === 'CREDIT' && !sale.creditReceived) {
// Net of any partial payment already received against this credit sale
const partialPaid = sale.partialPaymentReceived || 0;
rawData.salesCredits += Math.max(0, (sale.totalValue || 0) - partialPaid);
} else if (sale.paymentType === 'COLLECTION') {
// Bulk collection received — reduces outstanding receivables
rawData.salesCash += sale.totalValue || 0;
rawData.salesCredits -= sale.totalValue || 0;
} else if (sale.paymentType === 'PARTIAL_PAYMENT') {
// Standalone partial payment — reduces outstanding receivables
rawData.salesCash += sale.totalValue || 0;
rawData.salesCredits -= sale.totalValue || 0;
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
// Production Value is the gross value of goods manufactured — not netted against customer sales
const netSalesCash = rawData.salesCash - rawData.repSalesCash;
const netSalesCredits = rawData.salesCredits - rawData.repSalesCredits;
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
transactionsList.innerHTML = '';
if (entityTransactions.length === 0) {
transactionsList.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-muted);">No transactions found for this entity.</div>';
} else {
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
transactionCard.innerHTML = `
<span class="transaction-badge ${badgeClass}" style="position: absolute; top: 10px; right: 10px;">${badgeText}</span>
<div style="margin-bottom: 8px;">
<strong style="color: var(--accent); font-size: 0.9rem;">${transaction.date ? formatDisplayDate(transaction.date) : 'N/A'}</strong>
<span style="color: var(--text-muted); font-size: 0.75rem; margin-left: 10px;">${esc(transaction.time || '')}</span>
</div>
<div style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 8px;">
${esc(transaction.description || 'No description')}
</div>
<div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--glass-border);">
<span class="u-fs-sm2 u-text-muted" >Amount:</span>
<span class="${amountClass}" style="font-size: 1.1rem; font-weight: 800;">${fmtAmt(safeAmount)}</span>
</div>
`;
transactionsList.appendChild(transactionCard);
});
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
syncedAt: new Date().toISOString()
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
if (typeof renderUnifiedTable === 'function') renderUnifiedTable(1);
}
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
const _dpIsPayable = _dpTx?.isPayable === true && _dpTx?.type === 'OUT';
const _dpSupMats = _dpIsPayable ? factoryInventoryData.filter(m => String(m.supplierId) === String(_dpTx?.entityId)) : [];
let _dpMsg = `Delete this ${_dpTypeLabel}?`;
_dpMsg += `\n\nEntity: ${_dpEntityName}`;
_dpMsg += `\nAmount: ${_dpAmount}`;
_dpMsg += `\nDate: ${_dpDate}`;
if (_dpTx?.description) _dpMsg += `\nNote: ${_dpTx.description}`;
if (_dpIsPayable && _dpSupMats.length > 0) {
_dpMsg += `\n\n↩ Supplier payable reversal: This payment will be unrecorded and ${_dpSupMats.length} raw material${_dpSupMats.length !== 1 ? 's' : ''} linked to "${_dpEntityName}" will revert to outstanding payable status.`;
} else if (_dpTx?.type === 'IN') {
_dpMsg += `\n\n↩ This received payment will be removed and the entity's receivable balance will be restored.`;
} else {
_dpMsg += `\n\n↩ This outgoing payment will be removed from the entity's payment history.`;
}
_dpMsg += `\n\nThis cannot be undone.`;
if (await showGlassConfirm(_dpMsg, { title: `Delete ${_dpTx?.type === 'IN' ? 'Payment IN' : 'Payment OUT'}`, confirmText: "Delete", danger: true })) {
try {
const transaction = paymentTransactions.find(t => t.id === id);
if (!transaction) {
if (typeof refreshPaymentTab === 'function') await refreshPaymentTab();
if (typeof calculateNetCash === 'function') calculateNetCash();
return;
}
const supplierId = transaction.entityId;
const wasPayable = transaction.isPayable === true;
const transactionType = transaction.type;
if (wasPayable && transactionType === 'OUT') {
const supplierMaterials = factoryInventoryData.filter(m =>
String(m.supplierId) === String(supplierId)
);
supplierMaterials.forEach(mat => {
const originalAmount = parseFloat((mat.totalValue || (mat.purchaseCost && mat.purchaseQuantity ? mat.purchaseCost * mat.purchaseQuantity : mat.quantity * mat.cost) || 0).toFixed(2));
mat.totalPayable = originalAmount;
mat.paymentStatus = 'pending';
delete mat.paidDate;
mat.updatedAt = getTimestamp();
});
const remainingPayments = paymentTransactions
.filter(t =>
t.id !== id &&
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
} else {
mat.totalPayable = parseFloat((mat.totalPayable - remaining).toFixed(2));
remaining = 0;
}
}
});
for (const mat of supplierMaterials) {
await unifiedSave('factory_inventory_data', factoryInventoryData, mat);
}
}
if (transaction.expenseId) {
const expense = expenseRecords.find(e => e.id === transaction.expenseId);
if (expense) {
expense.paid = false;
delete expense.paidDate;
expense.updatedAt = getTimestamp();
await saveWithTracking('expenses', expenseRecords);
await saveRecordToFirestore('expenses', expense);
}
}
paymentTransactions = paymentTransactions.filter(t => t.id !== id);
await unifiedDelete('payment_transactions', paymentTransactions, id);
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
repSalesCash: 0,
repSalesCredits: 0,
calculatorCash: 0,
calculatorTotalIssued: 0,
calculatorTotalRecovered: 0,
paymentsIn: 0,
paymentsOut: 0
};
// Production Value = gross value of all manufactured goods (not netted against customer sales)
db.forEach(item => {
if (item.isReturn) return; 
rawData.totalProductionValue += item.totalSale || 0;
rawData.totalProductionQuantity += item.net || 0;
});
// Sales tab: separate cash/credit streams
customerSales.forEach(sale => {
if (!isDirectSale(sale)) return; 
if (sale.isMerged && sale.mergedSummary) {
const ms = sale.mergedSummary;
rawData.salesCash    += (ms.cashSales    || 0);
rawData.salesCredits += (ms.unpaidCredit || 0);
} else if (sale.paymentType === 'CASH' || sale.creditReceived) {
rawData.salesCash += sale.totalValue || 0;
} else if (sale.paymentType === 'CREDIT' && !sale.creditReceived) {
// Net of any partial payment already received against this credit sale
const partialPaid = sale.partialPaymentReceived || 0;
rawData.salesCredits += Math.max(0, (sale.totalValue || 0) - partialPaid);
} else if (sale.paymentType === 'COLLECTION') {
// Bulk collection received — reduces outstanding receivables
rawData.salesCash += sale.totalValue || 0;
rawData.salesCredits -= sale.totalValue || 0;
} else if (sale.paymentType === 'PARTIAL_PAYMENT') {
// Standalone partial payment — reduces outstanding receivables
rawData.salesCash += sale.totalValue || 0;
rawData.salesCredits -= sale.totalValue || 0;
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
// Production Value flows directly into cash — not netted against customer sales
const netSalesCash = rawData.salesCash - rawData.repSalesCash;
const netSalesCredits = rawData.salesCredits - rawData.repSalesCredits;
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
currentRatioElement.textContent = currentRatio.toFixed(2);
currentRatioElement.style.color = currentRatio < 1 ? 'var(--danger)' :
currentRatio < 2 ? 'var(--warning)' :
'var(--accent-emerald)';
}
const quickRatioElement = document.getElementById('quickRatio');
if (quickRatioElement) {
const quickRatio = safeNumber(parseFloat(indicators.liquidityRatios?.quickRatio), 0);
quickRatioElement.textContent = quickRatio.toFixed(2);
}
const cashRatioElement = document.getElementById('cashRatio');
if (cashRatioElement) {
const cashRatio = safeNumber(parseFloat(indicators.liquidityRatios?.cashRatio), 0);
cashRatioElement.textContent = cashRatio.toFixed(2);
}
}
function getCostPerUnit(storeType) {
const formula = factoryDefaultFormulas[storeType];
const additionalCost = factoryAdditionalCosts[storeType] || 0;
if (formula && formula.length > 0) {
let totalMaterialCost = 0;
formula.forEach(item => {
// Use live cost from inventory if available, fall back to snapshot cost in formula
const liveItem = Array.isArray(factoryInventoryData) ? factoryInventoryData.find(i => String(i.id) === String(item.id)) : null;
const unitCost = liveItem ? (liveItem.cost || item.cost || 0) : (item.cost || 0);
totalMaterialCost += unitCost * (item.quantity || 0);
});
// costPerUnit = total raw material cost per unit + additional cost per unit
return totalMaterialCost + additionalCost;
}
// Fallback: weighted average cost per unit from actual production history records
const tracking = factoryUnitTracking?.[storeType];
if (tracking && Array.isArray(tracking.unitCostHistory) && tracking.unitCostHistory.length > 0) {
let totalWeightedCost = 0, totalUnits = 0;
tracking.unitCostHistory.forEach(entry => {
totalWeightedCost += (entry.costPerUnit || 0) * (entry.units || 0);
totalUnits += (entry.units || 0);
});
return totalUnits > 0 ? totalWeightedCost / totalUnits : 0;
}
return 0;
}
function calculateFactoryInventoryValue() {
let totalValue = 0;
if (factoryInventoryData && factoryInventoryData.length > 0) {
factoryInventoryData.forEach(item => {
totalValue += (item.quantity * item.cost) || 0;
});
}
const stdTracking = factoryUnitTracking?.standard || { available: 0 };
const asaanTracking = factoryUnitTracking?.asaan || { available: 0 };
const stdCostPerUnit = getCostPerUnit('standard');
const asaanCostPerUnit = getCostPerUnit('asaan');
totalValue += (stdTracking.available * stdCostPerUnit);
totalValue += (asaanTracking.available * asaanCostPerUnit);
return totalValue;
}
function updateFactoryInventoryDisplay() {
let rawMaterialsValue = 0;
if (factoryInventoryData && factoryInventoryData.length > 0) {
factoryInventoryData.forEach(item => {
rawMaterialsValue += (item.quantity * item.cost) || 0;
});
}
const stdTracking = factoryUnitTracking?.standard || { available: 0 };
const asaanTracking = factoryUnitTracking?.asaan || { available: 0 };
const stdCostPerUnit = getCostPerUnit('standard');
const asaanCostPerUnit = getCostPerUnit('asaan');
// Formula Units Inventory = (std available units × std cost/unit) + (asaan available units × asaan cost/unit)
// where cost/unit = sum(material.cost × material.qty) + additionalCost
const formulaUnitsValue = (stdTracking.available * stdCostPerUnit) +
(asaanTracking.available * asaanCostPerUnit);
const rawMaterialsEl = document.getElementById('formulaRawMaterials');
const unitsValueEl = document.getElementById('formulaUnitsValue');
if (rawMaterialsEl) rawMaterialsEl.textContent = `${fmtAmt(safeValue(rawMaterialsValue))}`;
if (unitsValueEl) unitsValueEl.textContent = `${fmtAmt(safeValue(formulaUnitsValue))}`;
}
function calculatePaymentSummaries() {
const today = new Date().toISOString().split('T')[0];
const todayObj = new Date();
const year = todayObj.getFullYear();
const month = todayObj.getMonth();
const day = todayObj.getDate();
const weekStart = new Date(todayObj);
weekStart.setDate(day - 6);
const summaries = {
day: { in: 0, out: 0, count: 0 },
week: { in: 0, out: 0, count: 0 },
month: { in: 0, out: 0, count: 0 },
year: { in: 0, out: 0, count: 0 }
};
paymentTransactions.forEach(transaction => {
const transDate = new Date(transaction.date);
const transYear = transDate.getFullYear();
const transMonth = transDate.getMonth();
const transDay = transDate.getDate();
if (transaction.date === today) {
if (transaction.type === 'IN') summaries.day.in += transaction.amount;
else summaries.day.out += transaction.amount;
summaries.day.count++;
}
if (transDate >= weekStart && transDate <= todayObj) {
if (transaction.type === 'IN') summaries.week.in += transaction.amount;
else summaries.week.out += transaction.amount;
summaries.week.count++;
}
if (transYear === year && transMonth === month) {
if (transaction.type === 'IN') summaries.month.in += transaction.amount;
else summaries.month.out += transaction.amount;
summaries.month.count++;
}
if (transYear === year) {
if (transaction.type === 'IN') summaries.year.in += transaction.amount;
else summaries.year.out += transaction.amount;
summaries.year.count++;
}
});
const updateSummary = (prefix, data) => {
const inEl = document.getElementById(`${prefix}-in`);
const outEl = document.getElementById(`${prefix}-out`);
const netEl = document.getElementById(`${prefix}-net`);
const countEl = document.getElementById(`${prefix}-count`);
if (inEl) inEl.textContent = `${fmtAmt(safeValue(data.in))}`;
if (outEl) outEl.textContent = `${fmtAmt(safeValue(data.out))}`;
if (netEl) netEl.textContent = `${fmtAmt(safeValue(data.in - data.out))}`;
if (countEl) countEl.textContent = data.count;
};
updateSummary('payments-day', summaries.day);
updateSummary('payments-week', summaries.week);
updateSummary('payments-month', summaries.month);
updateSummary('payments-year', summaries.year);
}
async function openFactorySettings() {
try {
const [
loadedFormulas,
loadedCosts,
loadedFactor,
loadedPrices,
loadedTracking
] = await Promise.all([
idb.get('factory_default_formulas'),
idb.get('factory_additional_costs'),
idb.get('factory_cost_adjustment_factor'),
idb.get('factory_sale_prices'),
idb.get('factory_unit_tracking')
]);
if (loadedFormulas && typeof loadedFormulas === 'object' &&
('standard' in loadedFormulas) && ('asaan' in loadedFormulas)) {
factoryDefaultFormulas = loadedFormulas;
} else {
factoryDefaultFormulas = { standard: [], asaan: [] };
}
if (loadedCosts && typeof loadedCosts === 'object' &&
('standard' in loadedCosts) && ('asaan' in loadedCosts)) {
factoryAdditionalCosts = loadedCosts;
} else {
factoryAdditionalCosts = { standard: 0, asaan: 0 };
}
if (loadedFactor && typeof loadedFactor === 'object' &&
('standard' in loadedFactor) && ('asaan' in loadedFactor)) {
factoryCostAdjustmentFactor = loadedFactor;
} else {
factoryCostAdjustmentFactor = { standard: 1, asaan: 1 };
}
if (loadedPrices && typeof loadedPrices === 'object' &&
('standard' in loadedPrices) && ('asaan' in loadedPrices)) {
factorySalePrices = loadedPrices;
} else {
factorySalePrices = { standard: 0, asaan: 0 };
}
if (loadedTracking && typeof loadedTracking === 'object' &&
('standard' in loadedTracking) && ('asaan' in loadedTracking)) {
factoryUnitTracking = loadedTracking;
} else {
factoryUnitTracking = {
standard: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
asaan: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] }
};
}
} catch (error) {
showToast('Error loading factory settings. Using defaults.', 'warning');
factoryDefaultFormulas = { standard: [], asaan: [] };
factoryAdditionalCosts = { standard: 0, asaan: 0 };
factoryCostAdjustmentFactor = { standard: 1, asaan: 1 };
factorySalePrices = { standard: 0, asaan: 0 };
factoryUnitTracking = {
standard: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
asaan: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] }
};
}
requestAnimationFrame(() => {
document.body.style.overflow = 'hidden';
document.documentElement.style.overflow = 'hidden';
document.getElementById('factorySettingsOverlay').style.display = 'flex';
});
await renderFactorySettingsRows();
}
function closeFactorySettings() {
requestAnimationFrame(() => {
document.body.style.overflow = '';
document.documentElement.style.overflow = '';
document.getElementById('factorySettingsOverlay').style.display = 'none';
});
}
function selectFactoryStore(store, el) {
currentFactorySettingsStore = store;
document.querySelectorAll('#factorySettingsOverlay .factory-store-opt').forEach(o => o.classList.remove('active'));
if(el) el.classList.add('active');
const container = document.getElementById('factoryRawMaterialsContainer');
if (container) container.style.opacity = '0.35';
renderFactorySettingsRows().then(() => {
requestAnimationFrame(() => {
if (container) container.style.opacity = '1';
});
});
}
async function refreshFactorySettingsOverlay() {
const overlay = document.getElementById('factorySettingsOverlay');
if (overlay && overlay.style.display === 'flex') {
await renderFactorySettingsRows();
}
}
async function renderFactorySettingsRows() {
const container = document.getElementById('factoryRawMaterialsContainer');
try {
const [
savedFormulas,
savedAdditionalCosts,
savedCostAdjustmentFactor,
savedSalePrices,
savedUnitTracking
] = await Promise.all([
idb.get('factory_default_formulas'),
idb.get('factory_additional_costs'),
idb.get('factory_cost_adjustment_factor'),
idb.get('factory_sale_prices'),
idb.get('factory_unit_tracking')
]);
if (savedFormulas && typeof savedFormulas === 'object' &&
('standard' in savedFormulas) && ('asaan' in savedFormulas)) {
factoryDefaultFormulas = savedFormulas;
}
if (savedAdditionalCosts && typeof savedAdditionalCosts === 'object' &&
('standard' in savedAdditionalCosts) && ('asaan' in savedAdditionalCosts)) {
factoryAdditionalCosts = savedAdditionalCosts;
}
if (savedCostAdjustmentFactor && typeof savedCostAdjustmentFactor === 'object' &&
('standard' in savedCostAdjustmentFactor) && ('asaan' in savedCostAdjustmentFactor)) {
factoryCostAdjustmentFactor = savedCostAdjustmentFactor;
}
if (savedSalePrices && typeof savedSalePrices === 'object' &&
('standard' in savedSalePrices) && ('asaan' in savedSalePrices)) {
factorySalePrices = savedSalePrices;
}
if (savedUnitTracking && typeof savedUnitTracking === 'object' &&
('standard' in savedUnitTracking) && ('asaan' in savedUnitTracking)) {
factoryUnitTracking = savedUnitTracking;
}
} catch (e) {
console.error('An unexpected error occurred.', e);
showToast('An unexpected error occurred.', 'error');
}
if (!factoryDefaultFormulas || typeof factoryDefaultFormulas !== 'object') {
factoryDefaultFormulas = { standard: [], asaan: [] };
}
const formula = factoryDefaultFormulas[currentFactorySettingsStore];
if (!formula || !Array.isArray(formula)) {
factoryDefaultFormulas[currentFactorySettingsStore] = [];
}
let totalRawCost = 0, totalWeight = 0;
container.innerHTML = '';
const safeFormula = factoryDefaultFormulas[currentFactorySettingsStore] || [];
if(safeFormula.length > 0) {
safeFormula.forEach(ing => {
totalRawCost += (ing.cost * ing.quantity);
totalWeight += ing.quantity;
createFactorySettingRow(container, ing.id, ing.quantity);
});
}
if (!factoryUnitTracking || typeof factoryUnitTracking !== 'object') {
factoryUnitTracking = {
standard: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
asaan: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] }
};
}
const available = factoryUnitTracking[currentFactorySettingsStore]?.available || 0;
if (!factoryAdditionalCosts || typeof factoryAdditionalCosts !== 'object') {
factoryAdditionalCosts = { standard: 0, asaan: 0 };
}
const additionalCost = factoryAdditionalCosts[currentFactorySettingsStore] || 0;
document.getElementById('additional-cost-per-unit').value = additionalCost;
if (!factoryCostAdjustmentFactor || typeof factoryCostAdjustmentFactor !== 'object') {
factoryCostAdjustmentFactor = { standard: 1, asaan: 1 };
}
const adjustmentFactor = factoryCostAdjustmentFactor[currentFactorySettingsStore] || 1;
document.getElementById('cost-adjustment-factor').value = adjustmentFactor;
if (!factorySalePrices || typeof factorySalePrices !== 'object') {
factorySalePrices = { standard: 0, asaan: 0 };
}
const salePriceStandard = factorySalePrices.standard || 0;
const salePriceAsaan = factorySalePrices.asaan || 0;
document.getElementById('sale-price-standard').value = salePriceStandard;
document.getElementById('sale-price-asaan').value = salePriceAsaan;
const perUnitCost = totalRawCost + additionalCost;
const salesCostPerKg = adjustmentFactor > 0 ? perUnitCost / adjustmentFactor : perUnitCost;
const safeTotalWeight = parseFloat(totalWeight) || 0;
const _setFS1 = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
_setFS1('factorySettingsUnitWeight', safeTotalWeight.toFixed(2) + ' kg');
_setFS1('factorySettingsRawCostPerUnit', await formatCurrency(totalRawCost));
_setFS1('factorySettingsPerUnit', await formatCurrency(perUnitCost));
_setFS1('factorySettingsAvailableUnits', available);
_setFS1('factorySettingsSalesCostPerKg', await formatCurrency(salesCostPerKg));
}
function createFactorySettingRow(container, selectedId = '', qtyVal = '') {
const div = document.createElement('div');
div.className = 'factory-formula-grid';
let options = '<option value="">Select Material</option>';
factoryInventoryData.forEach((i, index) => {
options += `<option value="${esc(String(i.id))}" ${i.id == selectedId ? 'selected' : ''} data-cost="${i.cost}">${esc(i.name)}</option>`;
});
let currentCost = 0;
if(selectedId) {
const m = factoryInventoryData.find(i => i.id == selectedId);
if(m) currentCost = m.cost;
}
div.innerHTML = `
<div class="u-flex-col" >
<label style="font-size:0.6rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.04em;">Material</label>
<select class="factory-mat-select" onchange="updateFactoryRowCost(this)">${options}</select>
</div>
<div class="u-flex-col" >
<label style="font-size:0.6rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.04em;">Cost (Per Unit)</label>
<input type="number" class="factory-mat-cost" value="${currentCost}" readonly style="background:rgba(0,0,0,0.05); color:var(--text-muted);">
</div>
<div class="u-flex-col" >
<label style="font-size:0.6rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.04em;">Qty (kg)</label>
<input type="number" class="factory-mat-qty" value="${esc(String(qtyVal))}" placeholder="0">
</div>
`;
container.appendChild(div);
}
function getColumnLabel(index) {
let label = '';
let num = index;
while (num >= 0) {
label = String.fromCharCode(65 + (num % 26)) + label;
num = Math.floor(num / 26) - 1;
}
return label;
}
function addFactoryMaterialRow() {
const container = document.getElementById('factoryRawMaterialsContainer');
createFactorySettingRow(container);
}
function updateFactoryRowCost(selectEl) {
const costInput = selectEl.closest('.factory-formula-grid').querySelector('.factory-mat-cost');
const selectedOption = selectEl.options[selectEl.selectedIndex];
const cost = selectedOption.getAttribute('data-cost');
costInput.value = cost || 0;
updateFactoryFormulasSummary();
}
async function updateFactoryFormulasSummary() {
const container = document.getElementById('factoryRawMaterialsContainer');
const rows = container.querySelectorAll('.factory-formula-grid');
let totalRawCost = 0, totalWeight = 0;
rows.forEach(row => {
const sel = row.querySelector('.factory-mat-select');
const qtyIn = row.querySelector('.factory-mat-qty');
const costIn = row.querySelector('.factory-mat-cost');
if(sel && sel.value && qtyIn.value > 0 && costIn.value > 0) {
totalRawCost += (parseFloat(costIn.value) * parseFloat(qtyIn.value));
totalWeight += parseFloat(qtyIn.value);
}
});
const additionalCost = parseFloat(document.getElementById('additional-cost-per-unit').value) || 0;
const adjustmentFactor = parseFloat(document.getElementById('cost-adjustment-factor').value) || 1;
const perUnitCost = totalRawCost + additionalCost;
const available = factoryUnitTracking[currentFactorySettingsStore]?.available || 0;
const salesCostPerKg = adjustmentFactor > 0 ? perUnitCost / adjustmentFactor : perUnitCost;
const safeTotalWeight = parseFloat(totalWeight) || 0;
const _setFS = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
_setFS('factorySettingsUnitWeight', safeTotalWeight.toFixed(2) + ' kg');
_setFS('factorySettingsRawCostPerUnit', await formatCurrency(totalRawCost));
_setFS('factorySettingsPerUnit', await formatCurrency(perUnitCost));
_setFS('factorySettingsAvailableUnits', available);
_setFS('factorySettingsSalesCostPerKg', await formatCurrency(salesCostPerKg));
}
async function saveFactoryFormulas() {
const container = document.getElementById('factoryRawMaterialsContainer');
const rows = container.querySelectorAll('.factory-formula-grid');
const newFormula = [];
rows.forEach(row => {
const sel = row.querySelector('.factory-mat-select');
const qtyIn = row.querySelector('.factory-mat-qty');
const costIn = row.querySelector('.factory-mat-cost');
if(sel && sel.value && qtyIn.value > 0 && costIn.value > 0) {
const item = factoryInventoryData.find(i => i.id == sel.value);
if(item) {
newFormula.push({
id: item.id,
name: item.name,
cost: parseFloat(costIn.value),
quantity: parseFloat(qtyIn.value)
});
}
}
});
factoryDefaultFormulas[currentFactorySettingsStore] = newFormula;
const additionalCost = parseFloat(document.getElementById('additional-cost-per-unit').value) || 0;
factoryAdditionalCosts[currentFactorySettingsStore] = additionalCost;
const adjustmentFactor = parseFloat(document.getElementById('cost-adjustment-factor').value) || 1;
factoryCostAdjustmentFactor[currentFactorySettingsStore] = adjustmentFactor;
const salePriceStandard = parseFloat(document.getElementById('sale-price-standard').value) || 0;
const salePriceAsaan = parseFloat(document.getElementById('sale-price-asaan').value) || 0;
factorySalePrices.standard = salePriceStandard;
factorySalePrices.asaan = salePriceAsaan;
try {
const timestamp = getTimestamp();
await idb.setBatch([
['factory_default_formulas', factoryDefaultFormulas],
['factory_default_formulas_timestamp', timestamp],
['factory_additional_costs', factoryAdditionalCosts],
['factory_additional_costs_timestamp', timestamp],
['factory_cost_adjustment_factor', factoryCostAdjustmentFactor],
['factory_cost_adjustment_factor_timestamp', timestamp],
['factory_sale_prices', factorySalePrices],
['factory_sale_prices_timestamp', timestamp]
]);
} catch (e) {
showToast('Failed to save settings. Please try again.', 'error', 4000);
return;
}
notifyDataChange('all');
if (database && currentUser) {
if (window._firestoreNetworkDisabled || !navigator.onLine) {
const timestamp = getTimestamp();
const factorySettingsPayload = sanitizeForFirestore({
default_formulas: factoryDefaultFormulas,
default_formulas_timestamp: timestamp,
additional_costs: factoryAdditionalCosts,
additional_costs_timestamp: timestamp,
cost_adjustment_factor: factoryCostAdjustmentFactor,
cost_adjustment_factor_timestamp: timestamp,
sale_prices: factorySalePrices,
sale_prices_timestamp: timestamp,
last_synced: new Date().toISOString()
});
if (typeof OfflineQueue !== 'undefined') {
await OfflineQueue.add({
action: 'set-doc',
collection: 'factorySettings',
docId: 'config',
data: factorySettingsPayload
});
}
showToast('Settings saved locally — will sync when online', 'warning');
} else {
try {
await pushDataToCloud(true);
emitSyncUpdate({
factory_default_formulas: factoryDefaultFormulas,
factory_sale_prices: factorySalePrices,
factory_additional_costs: factoryAdditionalCosts,
factory_cost_adjustment_factor: factoryCostAdjustmentFactor
});
} catch (error) {
const timestamp = getTimestamp();
if (typeof OfflineQueue !== 'undefined') {
await OfflineQueue.add({
action: 'set-doc',
collection: 'factorySettings',
docId: 'config',
data: sanitizeForFirestore({
default_formulas: factoryDefaultFormulas,
default_formulas_timestamp: timestamp,
additional_costs: factoryAdditionalCosts,
additional_costs_timestamp: timestamp,
cost_adjustment_factor: factoryCostAdjustmentFactor,
cost_adjustment_factor_timestamp: timestamp,
sale_prices: factorySalePrices,
sale_prices_timestamp: timestamp,
last_synced: new Date().toISOString()
})
});
}
showToast('Settings saved locally. Cloud sync will retry automatically.', 'warning');
}
}
}
triggerAutoSync();
calculateFactoryProduction();
updateAllTabsWithFactoryCosts();
closeFactorySettings();
showToast('Formula saved successfully!', 'success', 3000);
}
function openFactoryInventoryModal() {
requestAnimationFrame(() => {
document.body.style.overflow = 'hidden';
document.documentElement.style.overflow = 'hidden';
document.getElementById('factoryInventoryOverlay').style.display = 'flex';
});
const _facInvT1 = document.getElementById('factoryInventoryModalTitle'); if (_facInvT1) _facInvT1.innerText = 'Add Raw Material';
const _delBtnHide = document.getElementById('deleteFactoryInventoryBtn'); if (_delBtnHide) _delBtnHide.style.display = 'none';
clearFactoryInventoryForm();
editingFactoryInventoryId = null;
const qtyInput = document.getElementById('factoryMaterialQuantity');
const conversionInput = document.getElementById('factoryMaterialConversionFactor');
const costInput = document.getElementById('factoryMaterialCost');
if (qtyInput && conversionInput && costInput) {
qtyInput.removeEventListener('input', updateFactoryKgCalculation);
conversionInput.removeEventListener('input', updateFactoryKgCalculation);
costInput.removeEventListener('input', updateFactoryKgCalculation);
qtyInput.addEventListener('input', updateFactoryKgCalculation);
conversionInput.addEventListener('input', updateFactoryKgCalculation);
costInput.addEventListener('input', updateFactoryKgCalculation);
}
}
function closeFactoryInventoryModal() {
requestAnimationFrame(() => {
document.body.style.overflow = '';
document.documentElement.style.overflow = '';
document.getElementById('factoryInventoryOverlay').style.display = 'none';
});
}
function clearFactoryInventoryForm() {
document.getElementById('factoryMaterialName').value = '';
document.getElementById('factoryMaterialQuantity').value = '';
document.getElementById('factoryMaterialConversionFactor').value = '1';
document.getElementById('factoryMaterialUnitName').value = '';
document.getElementById('factoryMaterialCost').value = '';
updateFactoryKgCalculation();
}
function editFactoryInventoryItem(id) {
const item = factoryInventoryData.find(i => i.id === id);
if(item) {
openFactoryInventoryModal();
const _facInvT2 = document.getElementById('factoryInventoryModalTitle'); if (_facInvT2) _facInvT2.innerText = 'Edit Material';
const _delBtn = document.getElementById('deleteFactoryInventoryBtn');
if (_delBtn) _delBtn.style.display = '';
document.getElementById('factoryMaterialName').value = item.name;
if (item.purchaseQuantity && item.conversionFactor) {
document.getElementById('factoryMaterialQuantity').value = item.purchaseQuantity;
document.getElementById('factoryMaterialCost').value = item.purchaseCost;
document.getElementById('factoryMaterialConversionFactor').value = item.conversionFactor;
document.getElementById('factoryMaterialUnitName').value = item.purchaseUnitName || '';
} else {
document.getElementById('factoryMaterialQuantity').value = item.quantity;
document.getElementById('factoryMaterialCost').value = item.cost;
document.getElementById('factoryMaterialConversionFactor').value = 1;
document.getElementById('factoryMaterialUnitName').value = '';
}
updateFactoryKgCalculation();
const supplierTypeSelect = document.getElementById('factoryMaterialSupplierType');
const existingSupplierSection = document.getElementById('existingSupplierSection');
const newSupplierSection = document.getElementById('newSupplierSection');
if (item.supplierId) {
supplierTypeSelect.value = 'existing';
existingSupplierSection.classList.remove('hidden');
newSupplierSection.classList.add('hidden');
const supplierInput = document.getElementById('factoryExistingSupplier');
const supplier = paymentEntities.find(e => String(e.id) === String(item.supplierId));
if (supplier && supplierInput) {
supplierInput.value = supplier.name;
supplierInput.setAttribute('data-supplier-id', item.supplierId);
}
showSupplierUnlinkOption(item);
} else {
supplierTypeSelect.value = 'none';
existingSupplierSection.classList.add('hidden');
newSupplierSection.classList.add('hidden');
}
editingFactoryInventoryId = id;
}
}
function updateFactoryKgCalculation() {
const qty = parseFloat(document.getElementById('factoryMaterialQuantity').value) || 0;
const conversionFactor = parseFloat(document.getElementById('factoryMaterialConversionFactor').value) || 1;
const cost = parseFloat(document.getElementById('factoryMaterialCost').value) || 0;
const totalKg = qty * conversionFactor;
const totalAmount = qty * cost;
const kgDisplayElement = document.getElementById('factoryCalculatedKg');
const amountDisplayElement = document.getElementById('factoryCalculatedAmount');
if (kgDisplayElement) {
kgDisplayElement.textContent = totalKg.toFixed(2) + ' kg';
}
if (amountDisplayElement) {
amountDisplayElement.textContent = fmtAmt(totalAmount);
}
}
function showSupplierUnlinkOption(material) {
const existingSupplierSection = document.getElementById('existingSupplierSection');
let unlinkButton = existingSupplierSection.querySelector('.unlink-supplier-btn');
if (!unlinkButton) {
unlinkButton = document.createElement('button');
unlinkButton.className = 'btn btn-danger unlink-supplier-btn';
unlinkButton.style.cssText = 'width: 100%; margin-top: 10px; font-size: 0.8rem;';
unlinkButton.innerHTML = ' Unlink Supplier & Reverse Transactions';
unlinkButton.onclick = function(e) {
e.preventDefault();
unlinkSupplierConfirmation(material);
};
existingSupplierSection.appendChild(unlinkButton);
}
}
async function unlinkSupplierConfirmation(material) {
const linkedTransactions = paymentTransactions.filter(t =>
t.materialId === material.id &&
t.entityId === material.supplierId &&
t.isPayable === true
);
let confirmMsg = ` Unlink ${material.supplierName} from ${material.name}?\n\n`;
confirmMsg += `This will:\n`;
confirmMsg += ` Remove supplier association\n`;
confirmMsg += ` Reset payment status to 'pending'\n`;
if (linkedTransactions.length > 0) {
const totalReversed = linkedTransactions.reduce((sum, t) => sum + t.amount, 0);
confirmMsg += ` Reverse ${linkedTransactions.length} payment transaction(s) totaling ${fmtAmt(safeNumber(totalReversed, 0))}\n`;
}
confirmMsg += `\nThe material will be ready to link with a different supplier.`;
confirmMsg += `\n\nThis cannot be undone.`;
if (await showGlassConfirm(confirmMsg, { title: `Unlink ${esc(material.supplierName)}`, confirmText: "Unlink", danger: true })) {
await unlinkSupplierFromMaterial(material, true);
closeFactoryInventoryModal();
setTimeout(() => editFactoryInventoryItem(material.id), 100);
refreshPaymentTab();
calculateNetCash();
renderFactoryInventory();
}
}
async function saveFactoryInventoryItem() {
const name = document.getElementById('factoryMaterialName').value;
const qty = parseFloat(document.getElementById('factoryMaterialQuantity').value) || 0;
const cost = parseFloat(document.getElementById('factoryMaterialCost').value) || 0;
const conversionFactor = parseFloat(document.getElementById('factoryMaterialConversionFactor').value) || 1;
const unitName = document.getElementById('factoryMaterialUnitName').value.trim() || '';
const supplierType = document.getElementById('factoryMaterialSupplierType').value;
if(!name) return showToast("Name required", 'warning');
try {
const quantityInKg = qty * conversionFactor;
const costPerKg = conversionFactor > 0 ? cost / conversionFactor : cost;
const totalValue = qty * cost;
const materialId = editingFactoryInventoryId || generateUUID('mat');
let existingMaterial = null;
if(editingFactoryInventoryId) {
const idx = factoryInventoryData.findIndex(i => i.id === editingFactoryInventoryId);
if(idx !== -1) {
existingMaterial = factoryInventoryData[idx];
const oldSupplierId = existingMaterial.supplierId;
const supplierInput = document.getElementById('factoryExistingSupplier');
const newSupplierId = supplierInput.getAttribute('data-supplier-id') || supplierInput.value;
const isSupplierChanging = (supplierType === 'none' && oldSupplierId) ||
(supplierType === 'existing' && oldSupplierId && String(oldSupplierId) !== String(newSupplierId));
if (isSupplierChanging) {
await unlinkSupplierFromMaterial(existingMaterial);
}
factoryInventoryData[idx] = {
...factoryInventoryData[idx],
name,
quantity: quantityInKg,
cost: costPerKg,
unit: 'kg',
totalValue,
purchaseQuantity: qty,
purchaseCost: cost,
conversionFactor: conversionFactor,
purchaseUnitName: unitName
};
}
} else {
factoryInventoryData.push({
id: materialId,
name,
quantity: quantityInKg,
cost: costPerKg,
unit: 'kg',
totalValue,
paymentStatus: 'pending',
syncedAt: new Date().toISOString(),
purchaseQuantity: qty,
purchaseCost: cost,
conversionFactor: conversionFactor,
purchaseUnitName: unitName
});
}
if (supplierType === 'none') {
const material = factoryInventoryData.find(m => m.id === materialId);
if (material) {
delete material.supplierId;
delete material.supplierName;
delete material.supplierContact;
delete material.supplierType;
material.paymentStatus = 'pending';
delete material.totalPayable;
}
}
else if (supplierType === 'existing') {
const supplierInput = document.getElementById('factoryExistingSupplier');
const existingSupplierId = supplierInput.getAttribute('data-supplier-id') || supplierInput.value;
if (existingSupplierId) {
await linkMaterialToSupplier(materialId, existingSupplierId, totalValue);
}
}
else if (supplierType === 'new') {
const supplierName = document.getElementById('factorySupplierName').value.trim();
const supplierPhone = document.getElementById('factorySupplierPhone').value.trim();
if (supplierName) {
const newSupplier = await createSupplierFromMaterial({
name: supplierName,
phone: supplierPhone,
materialId: materialId,
materialName: name,
materialTotal: totalValue
});
if (newSupplier && newSupplier.id) {
await linkMaterialToSupplier(materialId, newSupplier.id, totalValue);
}
}
}
const savedMaterial = factoryInventoryData.find(m => m.id === materialId);
await unifiedSave('factory_inventory_data', factoryInventoryData, savedMaterial);
notifyDataChange('inventory');
emitSyncUpdate({ factory_inventory_data: factoryInventoryData });
if (typeof renderFactoryInventory === 'function') renderFactoryInventory();
closeFactoryInventoryModal();
if (typeof calculateNetCash === 'function') calculateNetCash();
showToast("Material saved successfully!", 'success');
} catch (error) {
showToast('Failed to save material. Please try again.', 'error');
}
}
async function unlinkSupplierFromMaterial(material, showToastOnNoSupplier = false) {
if (!material) {
showToast('Invalid material data', 'error');
return;
}
if (!material.supplierId) {
if (showToastOnNoSupplier) {
showToast('No supplier to unlink', 'info');
}
return;
}
const supplierId = material.supplierId;
const materialId = material.id;
const supplierName = material.supplierName || 'Unknown Supplier';
const linkedTransactions = paymentTransactions.filter(t =>
t.materialId === materialId &&
t.entityId === supplierId &&
t.isPayable === true
);
if (linkedTransactions.length > 0) {
linkedTransactions.forEach(transaction => {
paymentTransactions = paymentTransactions.filter(t => t.id !== transaction.id);
});
await saveWithTracking('payment_transactions', paymentTransactions);
for (const removedTx of linkedTransactions) {
await deleteRecordFromFirestore('payment_transactions', removedTx.id);
}
}
delete material.supplierId;
delete material.supplierName;
delete material.supplierContact;
delete material.supplierType;
material.paymentStatus = 'pending';
delete material.totalPayable;
delete material.paidDate;
await unifiedSave('factory_inventory_data', factoryInventoryData, material);
notifyDataChange('all');
triggerAutoSync();
await renderFactoryInventory();
await refreshPaymentTab();
calculateNetCash();
showToast(`Unlinked from ${esc(material.name)}`, 'success');
}
async function createSupplierFromMaterial(supplierData) {
const existingSupplier = paymentEntities.find(e =>
e && e.name && supplierData && supplierData.name && e.name.toLowerCase() === supplierData.name.toLowerCase() && e.type === 'payee'
);
if (existingSupplier) {
return existingSupplier;
}
let suppId = generateUUID('supp');
if (!validateUUID(suppId)) {
suppId = generateUUID('supp');
}
const suppCreatedAt = getTimestamp();
let supplierEntity = {
id: suppId,
name: supplierData.name,
type: 'payee',
phone: supplierData.phone || '',
wallet: '',
createdAt: suppCreatedAt,
updatedAt: suppCreatedAt,
timestamp: suppCreatedAt,
isSupplier: true,
supplierCategory: 'raw_materials'
};
supplierEntity = ensureRecordIntegrity(supplierEntity, false);
paymentEntities.push(supplierEntity);
await unifiedSave('payment_entities', paymentEntities, supplierEntity);
notifyDataChange('entities');
triggerAutoSync();
if (typeof renderFactoryInventory === 'function') await renderFactoryInventory();
if (typeof refreshPaymentTab === 'function') await refreshPaymentTab();
return supplierEntity;
}
async function renderFactoryInventory() {
const tbody = document.getElementById('factoryInventoryTableBody');
let totalVal = 0;
if (factoryInventoryData.length === 0) {
tbody.innerHTML = '<tr><td class="u-empty-state-md" colspan="5" >No items in inventory</td></tr>';
GNDVirtualScroll.destroy('vs-scroller-factory-inventory');
const _invEl = document.getElementById('factoryTotalInventoryValue'); if (_invEl) _invEl.innerText = await formatCurrency(0);
return;
}
// Pre-build all rows (async currency formatting required)
const prebuiltRows = [];
for (const item of factoryInventoryData) {
const itemTotalValue = (item.quantity * item.cost) || 0;
totalVal += itemTotalValue;
let supplierHtml = '';
if (item.supplierName) {
const originalAmount = item.totalValue || (item.purchaseCost && item.purchaseQuantity ? item.purchaseCost * item.purchaseQuantity : item.quantity * item.cost) || 0;
const remainingPayable = item.totalPayable || 0;
const isFullyPaid = item.paymentStatus === 'paid' || remainingPayable <= 0;
const isPartial = !isFullyPaid && remainingPayable < originalAmount && remainingPayable > 0;
const paymentStatus = isFullyPaid
? '<span style="color:var(--accent-emerald); font-weight:600;"> PAID</span>'
: isPartial
? '<span style="color:var(--accent); font-weight:600;">PARTIAL</span>'
: '<span class="u-text-warning u-fw-600" >PENDING</span>';
const payableDisplay = isFullyPaid
? `<span class="u-text-emerald" >0.00</span>`
: isPartial
? `<span style="font-weight:600; color:var(--accent);">${remainingPayable.toFixed(2)}</span>`
: `<span style="font-weight:600;">${remainingPayable.toFixed(2)}</span>`;
supplierHtml = `
<div style="font-size:0.65rem; color:var(--text-muted); margin-top:4px;">
<div style="background:rgba(0, 122, 255, 0.1); color:var(--accent); padding:3px 8px; border-radius:4px; display:inline-block; margin-bottom:3px; font-weight:600;">
SUPPLIER: ${String(item.supplierName).replace(/'/g, "&#39;").replace(/"/g, "&quot;")}
</div>
<div style="margin-top:3px; font-size:0.7rem;">
${paymentStatus} | ${payableDisplay}
</div>
</div>
`;
} else {
supplierHtml = `
<div style="font-size:0.65rem; color:var(--text-muted); margin-top:4px; font-style:italic; opacity:0.6;">
No supplier linked
</div>
`;
}
let quantityHtml = '';
if (item.purchaseQuantity && item.purchaseUnitName && item.conversionFactor && item.conversionFactor !== 1) {
quantityHtml = `
<div class="u-text-center" >
<div class="u-fs-sm3 u-text-main u-fw-600" >
${(item.purchaseQuantity || 0).toFixed(2)}
</div>
<div class="u-fs-sm u-text-muted" >
${esc(item.purchaseUnitName)}
</div>
<div style="font-size:0.65rem; color:var(--text-muted); margin-top:2px;">
(${(item.quantity || 0).toFixed(2)})
</div>
</div>
`;
} else if (item.purchaseQuantity && item.conversionFactor && item.conversionFactor !== 1) {
quantityHtml = `
<div class="u-text-center" >
<div class="u-fs-sm3 u-text-main u-fw-600" >
${(item.purchaseQuantity || 0).toFixed(2)}
</div>
<div class="u-fs-sm u-text-muted" >
units
</div>
<div style="font-size:0.65rem; color:var(--text-muted); margin-top:2px;">
(${(item.quantity || 0).toFixed(2)})
</div>
</div>
`;
} else {
quantityHtml = `
<div class="u-text-center" >
<div class="u-fs-sm3 u-text-main u-fw-600" >
${(item.quantity || 0).toFixed(2)}
</div>
<div class="u-fs-sm u-text-muted" >
kg
</div>
</div>
`;
}
let costHtml = '';
if (item.purchaseCost && item.purchaseUnitName && item.conversionFactor && item.conversionFactor !== 1) {
costHtml = `
<div class="u-text-center" >
<div class="u-fs-sm2 u-text-main" >
${await formatCurrency(item.purchaseCost)}
</div>
<div class="u-fs-sm u-text-muted" >
${esc(item.purchaseUnitName)}
</div>
</div>
`;
} else if (item.purchaseCost && item.conversionFactor && item.conversionFactor !== 1) {
costHtml = `
<div class="u-text-center" >
<div class="u-fs-sm2 u-text-main" >
${await formatCurrency(item.purchaseCost)}
</div>
<div class="u-fs-sm u-text-muted" >
unit
</div>
</div>
`;
} else {
costHtml = `
<div class="u-text-center" >
<div class="u-fs-sm2 u-text-main" >
${await formatCurrency(item.cost)}
</div>
<div class="u-fs-sm u-text-muted" >
kg
</div>
</div>
`;
}
const totalValueStr = await formatCurrency(itemTotalValue);
const itemId = esc(item.id);
const itemName = esc(item.name);
// Build tr element (pre-rendered, handed to scroller as literal elements)
const tr = document.createElement('tr');
tr.style.borderBottom = '1px solid var(--glass-border)';
tr.innerHTML = `
<td style="padding: 8px 2px;">
<div style="font-weight:600; font-size:0.8rem; color:var(--text-main);">${itemName}</div>
${supplierHtml}
</td>
<td style="text-align:center; padding: 8px 2px;">
${quantityHtml}
</td>
<td style="text-align:right; padding: 8px 2px; font-size:0.75rem; color:var(--text-muted);">${costHtml}</td>
<td style="text-align:right; padding: 8px 2px; font-size:0.8rem; font-weight:700; color:var(--accent);">${totalValueStr}</td>
<td style="text-align:center; padding: 6px 2px;">
<button class="tbl-action-btn" onclick="editFactoryInventoryItem('${itemId}')">Edit</button>
</td>
`;
prebuiltRows.push(tr);
}
// Hand pre-built elements to scroller (identity builder — elements already constructed)
GNDVirtualScroll.mount('vs-scroller-factory-inventory', prebuiltRows, function(el) { return el; }, tbody);
const _invEl = document.getElementById('factoryTotalInventoryValue'); if (_invEl) _invEl.innerText = await formatCurrency(totalVal);
}
async function unlinkSupplierFromMaterialById(materialId) {
let material = factoryInventoryData.find(m => m.id === materialId);
if (!material) {
const reloadedData = await idb.get('factory_inventory_data');
if (Array.isArray(reloadedData)) {
factoryInventoryData = reloadedData;
material = factoryInventoryData.find(m => m.id === materialId);
}
}
if (!material) {
showToast("Material not found", 'error');
return;
}
if (!material.supplierId) {
showToast("No supplier linked", 'warning');
return;
}
const linkedTransactions = paymentTransactions.filter(t =>
t.materialId === materialId &&
t.entityId === material.supplierId &&
t.isPayable === true
);
const _us2Total = linkedTransactions.reduce((sum, t) => sum + (parseFloat(t.amount)||0), 0);
let confirmMsg = `Unlink ${material.supplierName} from "${material.name}"?`;
confirmMsg += `\nCurrent Stock: ${(material.quantity||0).toFixed(2)} kg`;
if (material.totalPayable) confirmMsg += `\nOutstanding Payable: ${fmtAmt(material.totalPayable||0)}`;
if (linkedTransactions.length > 0) {
confirmMsg += `\n\n\u21a9 ${linkedTransactions.length} payment transaction${linkedTransactions.length !== 1 ? 's' : ''} totaling ${fmtAmt(_us2Total)} will be reversed and the material reverted to "Pending Payable" status.`;
}
confirmMsg += `\n\nThe material will be available to link with a different supplier.`;
confirmMsg += `\n\nThis cannot be undone.`;
if (await showGlassConfirm(confirmMsg, { title: `Unlink ${esc(material.supplierName)}`, confirmText: "Unlink", danger: true })) {
await unlinkSupplierFromMaterial(material, true);
}
}
function toggleSupplierFields() {
const supplierType = document.getElementById('factoryMaterialSupplierType').value;
const existingSection = document.getElementById('existingSupplierSection');
const newSection = document.getElementById('newSupplierSection');
if (existingSection) existingSection.classList.add('hidden');
if (newSection) newSection.classList.add('hidden');
if (supplierType === 'existing') {
if (existingSection) {
existingSection.classList.remove('hidden');
}
} else if (supplierType === 'new') {
if (newSection) newSection.classList.remove('hidden');
}
}
function loadExistingSuppliers() {
const selectElement = document.getElementById('factoryExistingSupplier');
if (!selectElement) return;
selectElement.innerHTML = '<option value="">Choose Supplier</option>';
const suppliers = paymentEntities.filter(entity => entity.type === 'payee');
suppliers.forEach(supplier => {
const option = document.createElement('option');
option.value = supplier.id;
option.textContent = `${supplier.name || 'Unknown'} ${supplier.phone ? `(${supplier.phone})` : ''}`;
selectElement.appendChild(option);
});
if (suppliers.length === 0) {
const option = document.createElement('option');
option.value = "";
option.textContent = "No suppliers found. Create a new one.";
option.disabled = true;
selectElement.appendChild(option);
}
}
async function linkMaterialToSupplier(materialId, supplierId, totalCost) {
let material = factoryInventoryData.find(m => m.id === materialId);
if (!material) {
const reloadedData = await idb.get('factory_inventory_data');
if (Array.isArray(reloadedData)) {
factoryInventoryData = reloadedData;
material = factoryInventoryData.find(m => m.id === materialId);
}
}
if (!material) {
showToast('Material not found. Try refreshing.', 'error');
return;
}
const supplierIdToMatch = supplierId;
let supplier = paymentEntities.find(e =>
e.id === supplierIdToMatch ||
String(e.id) === String(supplierIdToMatch)
);
if (!supplier) {
const supplierTransaction = paymentTransactions.find(t =>
t.entityId === supplierIdToMatch ||
String(t.entityId) === String(supplierIdToMatch)
);
if (supplierTransaction) {
supplier = {
id: supplierIdToMatch,
name: supplierTransaction.entityName || 'Supplier',
type: 'payee',
phone: ''
};
} else {
showToast('Supplier not found. Please refresh and try again.', 'error');
return;
}
}
if (material.supplierId && String(material.supplierId) !== String(supplierIdToMatch)) {
await unlinkSupplierFromMaterial(material);
}
material.supplierId = supplier.id;
material.supplierName = supplier.name;
material.supplierContact = supplier.phone || '';
material.supplierType = 'payee';
material.paymentStatus = 'pending';
material.totalPayable = totalCost;
await unifiedSave('factory_inventory_data', factoryInventoryData, material);
notifyDataChange('all');
triggerAutoSync();
await renderFactoryInventory();
await refreshPaymentTab();
calculateNetCash();
showToast(`Linked to ${esc(supplier.name)}`, 'success');
}
function selectFactoryEntryStore(store, el) {
currentFactoryEntryStore = store;
document.querySelectorAll('.factory-store-selector .factory-store-opt').forEach(o => o.classList.remove('active'));
if(el) el.classList.add('active');
calculateFactoryProduction();
}

function getSalePriceForStore(store) {

	
	if (!store) return 0;
	if (store === 'STORE_C') {
		return factorySalePrices.asaan || 0;
	}

	return factorySalePrices.standard || 0;
}

function getCostPriceForStore(store) {

	
	if (!store) return 0;
	const formulaStore = (store === 'STORE_C') ? 'asaan' : 'standard';
	return calculateSalesCostPerKg(formulaStore);
}

function getStorePricing(store) {

	return {
		salePrice: getSalePriceForStore(store),
		costPrice: getCostPriceForStore(store)
	};
}

async function calculateFactoryProduction() {
const units = parseInt(document.getElementById('factoryProductionUnits').value) || 1;
const settings = factoryDefaultFormulas[currentFactoryEntryStore];
const additionalCost = factoryAdditionalCosts[currentFactoryEntryStore] || 0;
let baseCost = 0;
let rawMaterialsUsed = 0;
let html = `<h4 style="margin:0 0 5px 0; font-size:0.9rem;">${currentFactoryEntryStore.toUpperCase()} Formula (${units} Units)</h4>`;
if (settings && settings.length > 0) {
for (const i of settings) {
const lineTotal = i.cost * i.quantity * units;
baseCost += lineTotal;
rawMaterialsUsed += i.quantity * units;
html += `<div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:2px;">
<span>${i.name} (${i.quantity * units} kg)</span>
<span>${await formatCurrency(lineTotal)}</span>
</div>`;
}
const totalAdditionalCost = additionalCost * units;
if (totalAdditionalCost > 0) {
html += `<div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:2px; color:var(--danger);">
<span>Additional Cost (${additionalCost} per unit)</span>
<span>${await formatCurrency(totalAdditionalCost)}</span>
</div>`;
baseCost += totalAdditionalCost;
}
} else {
html += `<div class="u-text-muted" >No formula set.</div>`;
}
document.getElementById('factoryFormulaDisplay').innerHTML = html;
const _prodCostEl = document.getElementById('factoryTotalProductionCostDisplay'); if (_prodCostEl) _prodCostEl.innerText = await formatCurrency(baseCost);
}
async function saveFactoryProductionEntry() {
if (appMode === 'userrole' && !(window._userRoleAllowedTabs || []).includes('factory')) {
showToast('Access Denied — Factory not in your assigned tabs', 'warning', 3000); return;
}
const units = parseInt(document.getElementById('factoryProductionUnits').value) || 0;
if(units <= 0) return showToast('Invalid units', 'warning', 3000);
const inventorySnapshot = JSON.parse(JSON.stringify(factoryInventoryData));
const historySnapshot = [...factoryProductionHistory];
try {
const settings = factoryDefaultFormulas[currentFactoryEntryStore];
const additionalCost = factoryAdditionalCosts[currentFactoryEntryStore] || 0;
let baseCost = 0;
let rawMat = 0;
if(settings) {
baseCost = settings.reduce((acc, cur) => acc + (cur.cost * cur.quantity), 0) * units;
rawMat = settings.reduce((acc, cur) => acc + cur.quantity, 0) * units;
}
const totalAdditionalCost = additionalCost * units;
const totalCost = baseCost + totalAdditionalCost;
let inventoryUpdated = false;
if(settings && settings.length > 0) {
settings.forEach(item => {
const materialUsed = item.quantity * units;
const inventoryItem = factoryInventoryData.find(i => i.id === item.id);
if(inventoryItem) {
if(inventoryItem.quantity >= materialUsed) {
inventoryItem.quantity -= materialUsed;
inventoryItem.totalValue = inventoryItem.quantity * inventoryItem.cost;
inventoryUpdated = true;
} else {
throw new Error(`Insufficient ${inventoryItem.name} in inventory! Available: ${inventoryItem.quantity}, Required: ${materialUsed}`);
}
}
});
}
let factProdId = generateUUID('fact_prod');
if (!validateUUID(factProdId)) {
factProdId = generateUUID('fact_prod');
}
const factProdCreatedAt = getTimestamp();
const productionRecord = {
id: factProdId,
date: new Date().toISOString().split('T')[0],
time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
store: currentFactoryEntryStore,
units,
totalCost,
materialsCost: baseCost,
additionalCost: totalAdditionalCost,
rawMaterialsUsed: rawMat,
createdAt: factProdCreatedAt,
updatedAt: factProdCreatedAt,
timestamp: factProdCreatedAt,
syncedAt: new Date().toISOString(),
managedBy: (appMode === 'factory' && window._assignedManagerName) ? window._assignedManagerName : null
};
const validatedRecord = ensureRecordIntegrity(productionRecord);
factoryProductionHistory.unshift(validatedRecord);
await Promise.all([
saveWithTracking('factory_inventory_data', factoryInventoryData),
saveWithTracking('factory_production_history', factoryProductionHistory)
]);
notifyDataChange('factory');
emitSyncUpdate({
factory_inventory_data: factoryInventoryData,
factory_production_history: factoryProductionHistory
});
await syncFactoryProductionStats();
await refreshFactoryTab();
calculateNetCash();
calculateCashTracker();
document.getElementById('factoryProductionUnits').value = '1';
showToast("Production saved successfully!", "success");
const cloudWrites = [
saveRecordToFirestore('factory_production_history', validatedRecord)
];
if (inventoryUpdated) {
for (const item of factoryInventoryData) {
cloudWrites.push(saveRecordToFirestore('factory_inventory_data', item));
}
}
Promise.all(cloudWrites)
.then(() => triggerAutoSync())
.catch(err => console.warn(' Background Firestore sync failed (will retry):', err));
} catch (error) {
factoryInventoryData.length = 0;
factoryInventoryData.push(...inventorySnapshot);
factoryProductionHistory.length = 0;
factoryProductionHistory.push(...historySnapshot);
try {
await idb.setBatch([
['factory_inventory_data', factoryInventoryData],
['factory_production_history', factoryProductionHistory]
]);
} catch (rollbackError) {
console.error('Failed to save data locally.', rollbackError);
showToast('Failed to save data locally.', 'error');
}
showToast(error.message || 'Failed to save production data. Please try again.', 'error', 4000);
}
}
function setFactorySummaryMode(mode, el) {
currentFactorySummaryMode = mode;
document.querySelectorAll('#tab-factory .toggle-group .toggle-opt').forEach(opt => opt.classList.remove('active'));
if(el) el.classList.add('active');
updateFactorySummaryCard();
_filterFactoryHistoryByMode(mode);
}
function setFactoryAvailableStore(store, el) {
document.getElementById('factoryAvailStatsStandard').classList.add('hidden');
document.getElementById('factoryAvailStatsStandard').style.display = 'none';
document.getElementById('factoryAvailStatsAsaan').style.display = 'none';
const statsElement = document.getElementById('factoryAvailStats' + (store === 'standard' ? 'Standard' : 'Asaan'));
if (statsElement) {
statsElement.classList.remove('hidden');
statsElement.style.display = 'grid';
}
const parent = el.parentElement;
parent.querySelectorAll('.toggle-opt').forEach(t => t.classList.remove('active'));
el.classList.add('active');
updateFactoryUnitsAvailableStats();
}
async function renderFactoryHistory() {
const list = document.getElementById('factoryHistoryList');
list.innerHTML = '';
if (factoryProductionHistory.length === 0) {
list.innerHTML = '<div class="u-empty-state-sm" >No recent activity</div>';
return;
}
const recent = [...factoryProductionHistory].sort((a, b) => {
const timeA = a.timestamp || new Date(a.date + ' ' + a.time).getTime();
const timeB = b.timestamp || new Date(b.date + ' ' + b.time).getTime();
return timeB - timeA;
});
for (const entry of recent) {
const dateObj = new Date(entry.date);
const dateStr = (() => {
const month = dateObj.toLocaleDateString('en-US', { month: 'short' });
const day = String(dateObj.getDate()).padStart(2, '0');
const year = String(dateObj.getFullYear()).slice(-2);
return `${month} ${day} ${year} ${esc(entry.time || '')}`;
})();
const badgeClass = entry.store === 'standard' ? 'factory-badge-std' : 'factory-badge-asn';
const storeLabel = entry.store === 'standard' ? 'STD' : 'ASN';
const perUnitCost = entry.units > 0 ? entry.totalCost / entry.units : 0;
const additionalCostPerUnit = factoryAdditionalCosts[entry.store] || 0;
const totalAdditionalCost = additionalCostPerUnit * entry.units;
const div = document.createElement('div');
div.className = 'factory-history-item';
if (entry.date) div.setAttribute('data-date', entry.date);
div.innerHTML = `
<div style="display:flex; justify-content:space-between; margin-bottom:8px; border-bottom:1px solid var(--glass-border); padding-bottom:5px;">
<span class="u-fs-sm2 u-text-muted" >${dateStr}</span>
<div style="display:flex; gap:6px; align-items:center;">
${_mergedBadgeHtml(entry)}
<span class="factory-badge ${badgeClass}">${esc(storeLabel)}</span>
</div>
</div>
${entry.managedBy ? `<div style="margin-bottom:8px;"><span style="display:inline-flex;align-items:center;gap:4px;padding:2px 9px;font-size:0.65rem;font-weight:700;letter-spacing:0.04em;color:var(--accent-purple);background:rgba(206,147,216,0.10);border:1px solid rgba(206,147,216,0.28);border-radius:999px;">${esc(entry.managedBy)}</span></div>` : ''}
<div class="factory-summary-row">
<span class="factory-summary-label">Units Produced</span>
<span class="qty-val">${entry.units}</span>
</div>
<div class="factory-summary-row">
<span class="factory-summary-label">Material Cost</span>
<span class="cost-val">${await formatCurrency(entry.materialsCost || 0)}</span>
</div>
${totalAdditionalCost > 0 ? `<div class="factory-summary-row">
<span class="factory-summary-label">Additional Cost</span>
<span class="cost-val">${await formatCurrency(totalAdditionalCost)}</span>
</div>` : ''}
<div class="factory-summary-row">
<span class="factory-summary-label">Per Unit Cost</span>
<span class="cost-val">${await formatCurrency(perUnitCost)}</span>
</div>
<div class="factory-summary-row">
<span class="factory-summary-label">Total Cost</span>
<span class="rev-val">${await formatCurrency(entry.totalCost)}</span>
</div>
<div class="factory-summary-row">
<span class="factory-summary-label">Raw Materials Used</span>
<span class="qty-val">${safeNumber(entry.rawMaterialsUsed, 0).toFixed(2)} kg</span>
</div>
${entry.isMerged ? '' : `<button class="tbl-action-btn danger u-w-full u-mt-8" onclick="deleteFactoryEntry('${entry.id}')">Delete & Restore Inventory</button>`}
`;
list.appendChild(div);
}
_filterFactoryHistoryByMode(currentFactorySummaryMode || 'all');
}
async function deleteFactoryEntry(id) {
if (!id || !validateUUID(id)) {
showToast('Invalid factory entry ID', 'error');
return;
}
const entryIndex = factoryProductionHistory.findIndex(e => e.id === id);
if (entryIndex === -1) {
await refreshFactoryTab();
return;
}
const entry = factoryProductionHistory[entryIndex];
if (entry.isMerged) {
showToast('Merged opening balance records cannot be deleted', 'warning');
return;
}
const _feStoreLabel = getStoreLabel(entry.store) || entry.store;
const _feFormula = factoryDefaultFormulas[entry.store] || [];
const _feMatsDetail = _feFormula.length > 0
? _feFormula.map(f => { const inv = factoryInventoryData.find(i => i.id === f.id); return ` 2022 ${inv?.name || 'Material'}: ${(f.quantity * entry.units).toFixed(2)} kg restored`; }).join('\n')
: '';
let _feMsg = `Delete this factory production batch permanently?`;
_feMsg += `\nStore: ${_feStoreLabel}`;
_feMsg += `\nDate: ${entry.date}`;
_feMsg += `\nUnits Produced: ${entry.units}`;
if (entry.totalCost) _feMsg += `\nTotal Cost: ${fmtAmt(entry.totalCost||0)}`;
if (_feMatsDetail) _feMsg += `\n\n21a9 Raw materials restored to inventory:\n${_feMatsDetail}`;
else _feMsg += `\n\n21a9 Raw materials used in this batch will be restored to inventory.`;
_feMsg += `\n\n26a0 Sales already made from this batch will NOT be reversed 2014 but available stock will change.`;
_feMsg += `\n\nThis cannot be undone.`;
if (await showGlassConfirm(_feMsg, { title: "Delete Factory Production", confirmText: "Delete", danger: true })) {
try {
if (entry) {
entry.deletedAt = getTimestamp();
entry.updatedAt = getTimestamp();
}
await registerDeletion(id, 'factory_history');
let restoredMaterials = [];
const formula = factoryDefaultFormulas[entry.store];
if (formula && formula.length > 0) {
let inventoryUpdated = false;
formula.forEach(formulaItem => {
const materialToRestore = formulaItem.quantity * entry.units;
const inventoryItem = factoryInventoryData.find(i => i.id === formulaItem.id);
if (inventoryItem) {
inventoryItem.quantity += materialToRestore;
inventoryItem.totalValue = inventoryItem.quantity * inventoryItem.cost;
inventoryItem.updatedAt = getTimestamp();
inventoryUpdated = true;
restoredMaterials.push({
name: inventoryItem.name || 'Unknown',
quantity: materialToRestore
});
}
});
}
factoryProductionHistory.splice(entryIndex, 1);
await Promise.all([
unifiedDelete('factory_production_history', factoryProductionHistory, id),
saveWithTracking('factory_inventory_data', factoryInventoryData)
]);
await refreshFactoryTab();
calculateNetCash();
calculateCashTracker();
notifyDataChange('factory');
if (restoredMaterials.length > 0) {
const materialsList = restoredMaterials.map(m => `${m.name}: +${m.quantity.toFixed(2)} kg`).join(', ');
showToast(` Entry deleted! Raw materials restored: ${materialsList}`, "success");
} else {
showToast(" Entry deleted and inventory restored.", "success");
}
const cloudWrites = factoryInventoryData
.filter(item => item && item.id)
.map(item => saveRecordToFirestore('factory_inventory_data', item));
Promise.all(cloudWrites)
.then(() => triggerAutoSync())
.catch(err => console.warn(' Background Firestore sync failed on delete (will retry):', err));
} catch (error) {
showToast(" Failed to delete entry. Please try again.", "error");
}
}
}
function calculateDynamicCost(storeType, formulaUnits, netWeight) {
let formulaStore = 'standard';
if (storeType === 'STORE_C' || storeType === 'asaan') {
formulaStore = 'asaan';
} else if (storeType !== 'STORE_A' && storeType !== 'STORE_B' && storeType !== 'standard') {
return {
costPerUnit: 0,
totalFormulaCost: 0,
dynamicCostPerKg: 0,
formulaStore: storeType,
rawMaterialCost: 0
};
}
const formula = factoryDefaultFormulas[formulaStore];
if (!formula || formula.length === 0 || netWeight <= 0) {
return {
costPerUnit: 0,
totalFormulaCost: 0,
dynamicCostPerKg: 0,
formulaStore: formulaStore,
rawMaterialCost: 0
};
}
let totalMaterialCost = 0;
let totalWeight = 0;
formula.forEach(item => {
totalMaterialCost += (item.cost * item.quantity);
totalWeight += item.quantity;
});
const additionalCost = factoryAdditionalCosts[formulaStore] || 0;
const costPerUnit = totalMaterialCost + additionalCost;
const dynamicCostPerKg = formulaUnits > 0 ? (costPerUnit * formulaUnits) / netWeight : 0;
return {
costPerUnit: costPerUnit,
totalMaterialCost: totalMaterialCost,
additionalCost: additionalCost,
totalFormulaCost: costPerUnit * formulaUnits,
dynamicCostPerKg: dynamicCostPerKg,
formulaStore: formulaStore,
rawMaterialCost: totalMaterialCost,
unitWeight: totalWeight
};
}
function calculateSalesCostPerKg(formulaStore) {
const formula = factoryDefaultFormulas[formulaStore];
if (!formula || formula.length === 0) {
return 0;
}
let rawMaterialCost = 0;
formula.forEach(item => {
rawMaterialCost += (item.cost * item.quantity);
});
const additionalCost = factoryAdditionalCosts[formulaStore] || 0;
const totalCostPerUnit = rawMaterialCost + additionalCost;
const adjustmentFactor = factoryCostAdjustmentFactor[formulaStore] || 1;
const costPerKgForSales = adjustmentFactor > 0 ? totalCostPerUnit / adjustmentFactor : totalCostPerUnit;
return costPerKgForSales;
}
async function updateFormulaInventory() {
const tracking = {
standard: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
asaan: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] }
};
factoryProductionHistory.forEach(entry => {
if (entry.store && entry.units > 0) {
tracking[entry.store].produced += entry.units;
if (entry.totalCost && entry.units > 0) {
tracking[entry.store].unitCostHistory.push({
date: entry.date,
costPerUnit: entry.totalCost / entry.units,
units: entry.units
});
}
}
});
db.forEach(entry => {
let formulaStore = 'standard';
if (entry.store === 'STORE_C') {
formulaStore = 'asaan';
}
if (entry.formulaUnits) {
tracking[formulaStore].consumed += entry.formulaUnits;
}
});
tracking.standard.available = Math.max(0, tracking.standard.produced - tracking.standard.consumed);
tracking.asaan.available = Math.max(0, tracking.asaan.produced - tracking.asaan.consumed);
factoryUnitTracking = tracking;
const timestamp = Date.now();
await idb.set('factory_unit_tracking', factoryUnitTracking);
await idb.set('factory_unit_tracking_timestamp', timestamp);
return tracking;
}
async function syncFactoryProductionStats() {
const tracking = await updateFormulaInventory();
updateUnitsAvailableIndicator();
updateFactoryUnitsAvailableStats();
updateFactorySummaryCard();
return tracking;
}
function validateFormulaAvailability(storeType, requestedUnits) {
let formulaStore = 'standard';
if (storeType === 'STORE_C' || storeType === 'asaan') {
formulaStore = 'asaan';
}
const available = factoryUnitTracking[formulaStore]?.available || 0;
return {
available: available,
sufficient: available >= requestedUnits,
deficit: Math.max(0, requestedUnits - available)
};
}
function updateUnitsAvailableIndicator() {
const store = document.getElementById('storeSelector').value;
let formulaStore = 'standard';
if (store === 'STORE_C') {
formulaStore = 'asaan';
}
const available = factoryUnitTracking[formulaStore]?.available || 0;
const indicator = document.getElementById('currentUnitsAvailable');
const warning = document.getElementById('insufficientUnitsWarning');
let indicatorClass = 'units-available-good';
if (available < 10) {
indicatorClass = 'units-available-warning';
}
if (available <= 0) {
indicatorClass = 'units-available-danger';
}
if (indicator) {
indicator.className = `units-available-indicator ${indicatorClass}`;
indicator.textContent = `${(available || 0).toFixed(2)} units available`;
}
const requestedUnits = parseFloat(document.getElementById('formula-units')?.value) || 0;
if (warning) {
if (requestedUnits > available) {
warning.classList.remove('hidden');
} else {
warning.classList.add('hidden');
}
}
}
function calculateDynamicProductionCost() {
const net = parseFloat(document.getElementById('net-wt').value) || 0;
const store = document.getElementById('storeSelector').value;
const formulaUnits = parseFloat(document.getElementById('formula-units').value) || 0;
const costData = calculateDynamicCost(store, formulaUnits, net);
// getSalePriceForStore handles all three stores:
// STORE_C → asaan price, STORE_A / STORE_B → standard price
const salePrice = getSalePriceForStore(store);
const _setProd = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
_setProd('formula-unit-cost-display', `${fmtAmt(safeValue(costData.costPerUnit))}/unit`);
_setProd('total-formula-cost-display', `${fmtAmt(safeValue(costData.totalFormulaCost))}`);
_setProd('dynamic-cost-per-kg', `${safeValue(costData.dynamicCostPerKg).toFixed(2)}/kg`);
_setProd('factory-cost-price', `${safeValue(costData.dynamicCostPerKg).toFixed(2)}/kg`);
_setProd('production-sale-price-display', `${safeValue(salePrice).toFixed(2)}/kg`);
_setProd('profit-sale-price', `${safeValue(salePrice).toFixed(2)}/kg`);
const totalCost = net * costData.dynamicCostPerKg;
_setProd('display-cost-value', `${fmtAmt(safeValue(totalCost))}`);
const profitPerKg = salePrice - costData.dynamicCostPerKg;
_setProd('profit-per-kg', `${fmtAmt(safeValue(profitPerKg))}`);
updateUnitsAvailableIndicator();
}
function updateProductionCostOnStoreChange() {
const store = document.getElementById('storeSelector').value;
currentStore = store;
// getSalePriceForStore handles all three stores:
// STORE_C → asaan price, STORE_A / STORE_B → standard price
const salePrice = getSalePriceForStore(store);
const _setStore = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
_setStore('production-sale-price-display', `${safeValue(salePrice).toFixed(2)}/kg`);
_setStore('profit-sale-price', `${safeValue(salePrice).toFixed(2)}/kg`);
calculateDynamicProductionCost();
updatePaymentStatusVisibility();
if (typeof refreshUI === 'function') refreshUI();
}
function calcNet() {
const g = parseFloat(document.getElementById('gross-wt').value) || 0;
const c = parseFloat(document.getElementById('cont-wt').value) || 0;
const net = Math.max(0, g - c);
document.getElementById('net-wt').value = safeNumber(net, 0).toFixed(2);
calculateDynamicProductionCost();
}
async function deleteProdEntry(id) {
if (!id || !validateUUID(id)) {
showToast('Invalid production record ID', 'error');
return;
}
const entryToDelete = db.find(item => item.id === id);
if (!entryToDelete) return;
if (entryToDelete.isMerged) {
showToast('Merged opening balance records cannot be deleted', 'warning');
return;
}
const isReturn = entryToDelete.isReturn === true;
const _dpStoreLabel = getStoreLabel(entryToDelete.store) || entryToDelete.store;
const _dpSalesOnDate = (typeof customerSales !== 'undefined' ? customerSales : []).filter(s => s.date === entryToDelete.date && s.store === entryToDelete.store).length;
let confirmMsg;
if (isReturn) {
confirmMsg = `Remove this stock return record?`;
confirmMsg += `\nStore: ${_dpStoreLabel}`;
confirmMsg += `\nDate: ${entryToDelete.date}`;
confirmMsg += `\nQty Returned: ${entryToDelete.net} kg`;
confirmMsg += `\n\n\u21a9 This will DECREASE available stock by ${entryToDelete.net} kg on ${entryToDelete.date}.`;
if (_dpSalesOnDate > 0) confirmMsg += ` ${_dpSalesOnDate} sale${_dpSalesOnDate !== 1 ? 's' : ''} exist on this date — those records may be affected.`;
} else {
confirmMsg = `Permanently delete this production record?`;
confirmMsg += `\nStore: ${_dpStoreLabel}`;
confirmMsg += `\nDate: ${entryToDelete.date}`;
confirmMsg += `\nNet Qty: ${entryToDelete.net} kg`;
if (entryToDelete.gross) confirmMsg += `\nGross / Tare: ${entryToDelete.gross} / ${((entryToDelete.gross||0) - (entryToDelete.net||0)).toFixed(2)} kg`;
confirmMsg += `\n\n\u21a9 ${entryToDelete.net} kg will be removed from ${entryToDelete.date} inventory.`;
if (_dpSalesOnDate > 0) confirmMsg += `\n\n\u26a0 ${_dpSalesOnDate} sale${_dpSalesOnDate !== 1 ? 's' : ''} on this date for ${_dpStoreLabel} will remain on record, but available stock will drop.`;
}
confirmMsg += `\n\nThis cannot be undone.`;
if (await showGlassConfirm(confirmMsg, { title: isReturn ? "Remove Return" : "Delete Production", confirmText: isReturn ? "Remove" : "Delete", danger: true })) {
try {
const deletedDate = entryToDelete.date;
const deletedStore = entryToDelete.store;
const deletedQuantity = entryToDelete.net || 0;
const record = db.find(item => item.id === id);
if (record) {
record.deletedAt = getTimestamp();
record.updatedAt = getTimestamp();
}
db = db.filter(item => item.id !== id);
await unifiedDelete('mfg_pro_pkr', db, id);
notifyDataChange('production');
syncFactoryProductionStats();
await refreshUI();
calculateNetCash();
calculateCashTracker();
if (isReturn) {
showToast(` Return record removed. ${deletedQuantity} kg removed from ${deletedDate} stock.`, "success");
} else {
showToast(` Production deleted. ${deletedQuantity} kg removed from ${deletedDate} inventory. Sales on this date may be affected.`, "success");
}
} catch (error) {
showToast(" Failed to delete entry. Please try again.", "error");
}
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

if (isRepSale(sale)) return;
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
const totalValue = costData.totalValue;
const profit = totalValue - totalCost;
const existingCustomer = customerSales.find(s => s && s.customerName && name && s.customerName.toLowerCase() === name.toLowerCase());
let existingCredit = 0;
if (existingCustomer) {
customerSales.forEach(sale => {
if (!(sale && sale.customerName && name && sale.customerName.toLowerCase() === name.toLowerCase())) return;
if (sale.transactionType === 'OLD_DEBT' && !sale.creditReceived) {
existingCredit += (sale.totalValue || 0) - (sale.partialPaymentReceived || 0);
} else if (sale.paymentType === 'CREDIT' && !sale.creditReceived) {
if (sale.isMerged && typeof sale.creditValue === 'number') {
existingCredit += sale.creditValue;
} else {
existingCredit += (sale.totalValue || 0) - (sale.partialPaymentReceived || 0);
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
const recordId = generateUUID();
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
totalCost: totalCost,
totalValue: totalValue,
profit: profit,
// Store the canonical sale price per kg at the time of the transaction.
// getSalePriceForStore returns the fixed factory setting — not a computed average.
unitPrice: costData.salePricePerKg || getSalePriceForStore(store),
creditReceived: paymentType === 'CASH' ? true : false,
syncedAt: new Date().toISOString(),
isRepModeEntry: false
};
const validatedRecord = ensureRecordIntegrity(saleRecord);
const salesSnapshot = [...customerSales];
try {
customerSales.push(validatedRecord);
await saveWithTracking('customer_sales', customerSales);
await saveRecordToFirestore('customer_sales', validatedRecord);
notifyDataChange('sales');
triggerAutoSync();
if (typeof calculateCashTracker === 'function') calculateCashTracker();
if (typeof calculateNetCash === 'function') calculateNetCash();
emitSyncUpdate({ customer_sales: customerSales });
document.getElementById('cust-name').value = '';
document.getElementById('cust-quantity').value = '';
selectPaymentType(document.getElementById('btn-payment-cash'), 'CASH');
selectSupplyStore(document.getElementById('btn-supply-store-a'), 'STORE_A');
if (phoneInput) phoneInput.value = '';
document.getElementById('new-customer-phone-container').classList.add('hidden');
if (typeof renderCustomersTable === 'function') {
renderCustomersTable();
}
refreshEntityList();
showToast(` Sale recorded successfully! ${name} - ${safeNumber(quantity, 0).toFixed(2)} kg`, "success");
} catch (error) {
customerSales.length = 0;
customerSales.push(...salesSnapshot);
try {
await saveWithTracking('customer_sales', customerSales);
} catch (rollbackError) {
console.error('UI refresh failed.', rollbackError);
showToast('UI refresh failed.', 'error');
}
showToast(' Failed to save sale. Please try again.', 'error');
}
}
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
const quantity = parseFloat(document.getElementById('cust-quantity').value) || 0;
const date = document.getElementById('cust-date').value;
const store = document.getElementById('supply-store-value').value;
const costData = calculateSalesCost(store, quantity);
document.getElementById('cust-total-cost').textContent = fmtAmt(safeNumber(costData?.totalCost, 0));
document.getElementById('cust-total-value').textContent = fmtAmt(safeNumber(costData?.totalValue, 0));
document.getElementById('cust-profit').textContent = fmtAmt(safeNumber((costData?.totalValue || 0) - (costData?.totalCost || 0), 0));
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
const recordTime = getRecordTimestamp(recordToDelete);
const recordDate = recordToDelete.date || 'Unknown date';
const _dcStoreLabel = recordToDelete.supplyStore ? getStoreLabel(recordToDelete.supplyStore) : '';
const _dcIsCredit = recordToDelete.paymentType === 'CREDIT';
const _dcIsPaid = _dcIsCredit && recordToDelete.creditReceived;
const _dcPartialPaid = recordToDelete.partialPaymentReceived || 0;
const _dcPayLabel = _dcIsCredit ? 'Credit Sale' : 'Cash Sale';
let _dcMsg = `Permanently delete this ${_dcPayLabel}?`;
_dcMsg += `\nCustomer: ${recordToDelete.customerName || 'Unknown'}`;
_dcMsg += `\nDate: ${recordDate}`;
_dcMsg += `\nQty: ${recordToDelete.quantity || 0} kg`;
if (recordToDelete.totalValue) _dcMsg += `\nValue: ${fmtAmt(recordToDelete.totalValue||0)}`;
if (_dcStoreLabel) _dcMsg += `\nStore: ${_dcStoreLabel}`;
if (_dcIsCredit) {
if (_dcIsPaid) _dcMsg += `\n\n\u2714 This sale is already marked PAID. Deleting will erase the payment record from the customer's history.`;
else if (_dcPartialPaid > 0) _dcMsg += `\n\n\u26a0 ${fmtAmt(_dcPartialPaid)} partially collected. Deleting will erase both the sale and the partial payment.`;
else _dcMsg += `\n\n\u26a0 This credit sale is UNPAID. Deleting will permanently remove the outstanding balance of ${fmtAmt(recordToDelete.totalValue||0)} from this customer's account.`;
} else {
_dcMsg += `\n\n\u21a9 ${(recordToDelete.quantity||0).toFixed(2)} kg will be restored to ${recordDate} inventory.`;
}
_dcMsg += `\n\nThis cannot be undone.`;
if (await showGlassConfirm(_dcMsg, { title: `Delete ${_dcPayLabel}`, confirmText: "Delete", danger: true })) {
try {
await registerDeletion(id, 'sales');
const originalLength = customerSales.length;
customerSales = customerSales.filter(item => item.id !== id);
if (customerSales.length === originalLength) {
throw new Error('Record not found or not deleted');
}
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
showToast(` Sale deleted! ${recordToDelete.quantity} kg restored to ${recordDate} inventory.`, "success");
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
const cred = parseFloat(document.getElementById('creditSales').value) || 0;
const prev = parseFloat(document.getElementById('prevCreditReceived').value) || 0;
const rec = parseFloat(document.getElementById('receivedCash').value) || 0;
const netSold = Math.max(0, sold - ret);
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

// Firebase Configuration
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
console.error('Firebase operation failed.', e);
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
trackId(collection, id) {
  if (!id) return;
  if (!this._dirty.has(collection)) this._dirty.set(collection, new Set());
  this._dirty.get(collection).add(String(id));
  this.setLastLocalModification(collection, Date.now());
},
trackCollection(collection) {
  if (!this._dirty.has(collection)) this._dirty.set(collection, new Set());
  this._dirty.get(collection).add('*');
  this.setLastLocalModification(collection, Date.now());
},
clearDirty(collection) {
  this._dirty.delete(collection);
},
isDirty(collection) {
  const s = this._dirty.get(collection);
  return s !== undefined && s.size > 0;
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
  this.clearDirty(collection);
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
  if (this.isDirty(collection)) return true;
  const lastSyncMs = await this.getLastSyncMs(collection);
  const lastLocalMod = await this.getLastLocalModification(collection);
  if (!lastSyncMs) return true;
  if (!lastLocalMod) return false;
  return lastLocalMod > lastSyncMs;
},
async getChangedItemsCount(collectionName, dataArray) {
  const ids = this._dirty.get(collectionName);
  if (ids && !ids.has('*')) return ids.size;
  const lastSyncMs = await this.getLastSyncMs(collectionName);
  if (!lastSyncMs || !Array.isArray(dataArray)) return dataArray?.length || 0;
  let changedCount = 0;
  for (const item of dataArray) {
    if (!item) continue;
    const itemTime = item.updatedAt || item.timestamp || item.createdAt || 0;
    const itemTimestamp = typeof itemTime === 'number' ? itemTime :
      typeof itemTime === 'string' ? new Date(itemTime).getTime() :
      itemTime?.toMillis ? itemTime.toMillis() : 0;
    if (itemTimestamp > lastSyncMs) changedCount++;
  }
  return changedCount;
},
async getChangedItems(collectionName, dataArray) {
  if (!Array.isArray(dataArray)) return [];
  const ids = this._dirty.get(collectionName);
  if (ids && ids.size > 0 && !ids.has('*')) {
    return dataArray.filter(item => item && ids.has(String(item.id)));
  }
  const lastSyncMs = await this.getLastSyncMs(collectionName);
  if (!lastSyncMs) return dataArray.filter(item => item);
  const changedItems = [];
  for (const item of dataArray) {
    if (!item) continue;
    const itemTime = item.updatedAt || item.timestamp || item.createdAt || 0;
    const itemTimestamp = typeof itemTime === 'number' ? itemTime :
      typeof itemTime === 'string' ? new Date(itemTime).getTime() :
      itemTime?.toMillis ? itemTime.toMillis() : 0;
    if (itemTimestamp > lastSyncMs) changedItems.push(item);
  }
  return changedItems;
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
    await idb.remove(lsKey);
    await idb.remove(lmKey);
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
    summary[collection] = {
      lastSync: lastSyncMs ? new Date(lastSyncMs).toISOString() : 'Never',
      hasChanges,
      needsUpload: hasChanges,
      needsDownload: !lastSyncMs
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
const netSold = Math.max(0, sold - ret);
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
const linkedIds = await markSalesEntriesAsReceived(seller, sold);
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
document.getElementById('creditSales').value = '';
document.getElementById('prevCreditReceived').value = '';
document.getElementById('receivedCash').value = '';
document.getElementById('returnStoreSection').classList.add('hidden');
showToast(`Transaction saved! ${linkedIds.length} sales entries reconciled.`, 'success');
await loadSalesData(currentCompMode);
if (typeof refreshCustomerSales === 'function') await refreshCustomerSales(1, true);
if (entry.returned > 0 && entry.returnStore) {
if (typeof refreshUI === 'function') await refreshUI();
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
if (type === 'admin' && (sale.isRepModeEntry === true || (sale.salesRep && sale.salesRep !== 'NONE'))) return;
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
sale.salesRep === seller &&
sale.paymentType === 'CREDIT' &&
!sale.creditReceived
)
.sort((a, b) => a.timestamp - b.timestamp);
for (const sale of pendingSales) {
if (remainingQty <= 0) break;
if (sale.quantity <= remainingQty) {
sale.creditReceived = true;
sale.creditReceivedDate = new Date().toISOString().split('T')[0];
sale.creditReceivedTime = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
sale.paymentType = 'CASH';
linkedIds.push(sale.id);
remainingQty -= sale.quantity;
} else {
break;
}
}
if (linkedIds.length > 0) {
await saveWithTracking('customer_sales', customerSales);
const modifiedSales = customerSales.filter(s => linkedIds.includes(s.id));
for (const sale of modifiedSales) {
await saveRecordToFirestore('customer_sales', sale);
}
if (typeof refreshCustomerSales === 'function') {
refreshCustomerSales(1, true);
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
linkedRepIds.push(sale.id);
}
});
if (linkedRepIds.length > 0) {
await saveWithTracking('rep_sales', repSales);
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
revertedCount++;
}
});
if (revertedCount > 0) {
await saveWithTracking('rep_sales', repSales);
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
console.error('Failed to save data locally.', error);
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
histContainer.innerHTML = '';
if (totalItems === 0) {
histContainer.innerHTML = `<p style="text-align:center; color:var(--text-muted); width:100%; font-size:0.85rem;">No records found for this selection.</p>`;
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
histContainer.appendChild(fragment);
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
console.error('Payment transaction failed.', error);
showToast('Payment transaction failed.', 'error');
}
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
tbody.innerHTML = '';
if (totalItems === 0) {
tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:15px; color:var(--text-muted);">No entities found</td></tr>`;
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
const entityId = material.supplierId || generateUUID('supp');
paymentEntities.push({
id: entityId,
name: material.supplierName,
type: 'payee',
phone: material.supplierContact || '',
wallet: '',
createdAt: Date.now(),
updatedAt: Date.now(),
isSupplier: true,
supplierCategory: 'raw_materials'
});
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
    console.error('OfflineAuth verification error:', e);
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
stockReturns: stockReturns,
settings: await idb.get('naswar_default_settings', defaultSettings),
deleted_records: Array.from(deletedRecordIds),
_meta: { encryptedFor: currentUser.email, createdAt: Date.now(), version: 2 }
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
console.error('Encryption failed:', encErr);
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

function migrateBackupSchema(data) {
  if (!data || typeof data !== 'object') return data;

  const metaVersion = (data._meta && data._meta.version) ? Number(data._meta.version) : null;
  const bkpVersion  = (data.backupMetadata && data.backupMetadata.version)
                      ? String(data.backupMetadata.version)
                      : null;

  
  let version = 0;
  if (metaVersion !== null && !isNaN(metaVersion)) {
    version = metaVersion;
  } else if (bkpVersion !== null) {
    version = parseInt(bkpVersion, 10) || 0;
  }

  
  if (version < 2) {

    if (!data.mfg && data.mfg_pro_pkr) {
      data.mfg = data.mfg_pro_pkr;
    }

    if (!data.sales && data.noman_history) {
      data.sales = data.noman_history;
    }

    if (!data.customerSales && data.customer_sales) {
      data.customerSales = data.customer_sales;
    }

    if (!data.repSales && data.rep_sales) {
      data.repSales = data.rep_sales;
    }

    if (!data.repCustomers && data.rep_customers) {
      data.repCustomers = data.rep_customers;
    }

    if (!data.salesCustomers && data.sales_customers) {
      data.salesCustomers = data.sales_customers;
    }

    if (!data.stockReturns && data.stock_returns) {
      data.stockReturns = data.stock_returns;
    }

    if (!data.paymentTransactions && data.payment_transactions) {
      data.paymentTransactions = data.payment_transactions;
    }

    if (!data.paymentEntities && data.payment_entities) {
      data.paymentEntities = data.payment_entities;
    }

    if (!data.factoryInventoryData && data.factory_inventory_data) {
      data.factoryInventoryData = data.factory_inventory_data;
    }

    if (!data.factoryProductionHistory && data.factory_production_history) {
      data.factoryProductionHistory = data.factory_production_history;
    }

    if (!data.settings && data.naswar_default_settings) {
      data.settings = data.naswar_default_settings;
    }
  }

  

  

  if (data.mfg && !data.mfg_pro_pkr)       data.mfg_pro_pkr   = data.mfg;
  if (data.mfg_pro_pkr && !data.mfg)       data.mfg           = data.mfg_pro_pkr;
  if (data.sales && !data.noman_history)    data.noman_history = data.sales;
  if (data.noman_history && !data.sales)    data.sales         = data.noman_history;

  if (!data._migrated) {
    data._migrated = { fromVersion: version, toVersion: 2, at: Date.now() };
  }
  return data;
}
async function _doRestoreMerge(data) {
showToast('Analyzing backup file...', 'info', 5000);

data = migrateBackupSchema(data);
const getTimestampValue = (record) => {
if (!record) return 0;
let ts = record.updatedAt || record.timestamp || record.createdAt || 0;
if (typeof ts === 'number') {
return ts;
}
if (ts && typeof ts.toMillis === 'function') {
return ts.toMillis();
}
if (ts && typeof ts === 'object') {
if (typeof ts.seconds === 'number') {
return ts.seconds * 1000;
}
if (typeof ts._seconds === 'number') {
return ts._seconds * 1000;
}
}
if (ts instanceof Date) {
return ts.getTime();
}
if (typeof ts === 'string') {
try {
const dateStr = ts.replace('Z', '+00:00');
const date = new Date(dateStr);
const time = date.getTime();
if (!isNaN(time)) {
return time;
}
} catch (e) {
}
}
return 0;
};
const deduplicateByUUID = (array, collectionName) => {
if (!Array.isArray(array) || array.length === 0) return array;
const seen = new Map();
let duplicatesFound = 0;
array.forEach(item => {
if (!item || !item.id) return;
if (!validateUUID(item.id)) item.id = generateUUID();
if (seen.has(item.id)) {
duplicatesFound++;
const existing = seen.get(item.id);
const existingTime = getTimestampValue(existing);
const itemTime = getTimestampValue(item);
if (itemTime > existingTime) {
seen.set(item.id, item);
}
} else {
seen.set(item.id, item);
}
});
if (duplicatesFound > 0) {
showToast(`Cleaned ${collectionName}: removed ${duplicatesFound} duplicates`, 'info');
}
return Array.from(seen.values());
};
if (data.mfg_pro_pkr) data.mfg_pro_pkr = deduplicateByUUID(data.mfg_pro_pkr, 'Production');
if (data.noman_history) data.noman_history = deduplicateByUUID(data.noman_history, 'Calculator History');
if (data.customerSales) data.customerSales = deduplicateByUUID(data.customerSales, 'Customer Sales');
if (data.repSales) data.repSales = deduplicateByUUID(data.repSales, 'Rep Sales');
if (data.repCustomers) data.repCustomers = deduplicateByUUID(data.repCustomers, 'Rep Customers');
if (data.salesCustomers) data.salesCustomers = deduplicateByUUID(data.salesCustomers, 'Sales Customers');
if (data.factoryInventoryData) data.factoryInventoryData = deduplicateByUUID(data.factoryInventoryData, 'Factory Inventory');
if (data.factoryProductionHistory) data.factoryProductionHistory = deduplicateByUUID(data.factoryProductionHistory, 'Factory History');
if (data.stockReturns) data.stockReturns = deduplicateByUUID(data.stockReturns, 'Stock Returns');
if (data.paymentTransactions) data.paymentTransactions = deduplicateByUUID(data.paymentTransactions, 'Payment Transactions');
if (data.paymentEntities) data.paymentEntities = deduplicateByUUID(data.paymentEntities, 'Payment Entities');
if (data.expenses) data.expenses = deduplicateByUUID(data.expenses, 'Expenses');

data.mfg           = data.mfg_pro_pkr;
data.sales         = data.noman_history;
showToast(' Backup cleaned! Restoring with smart merge...', 'success');
if (data.deleted_records && Array.isArray(data.deleted_records)) {
data.deleted_records.forEach(id => deletedRecordIds.add(id));
await idb.set('deleted_records', Array.from(deletedRecordIds));
}
const isAlive = (item) => {
if (!item || !item.id) return false;
if (deletedRecordIds.has(item.id)) {
return false;
}
return true;
};
const currentLocalData = {
mfg_pro_pkr: await idb.get('mfg_pro_pkr') || [],
noman_history: await idb.get('noman_history') || [],
customer_sales: await idb.get('customer_sales') || [],
rep_sales: await idb.get('rep_sales') || [],
rep_customers: await idb.get('rep_customers') || [],
sales_customers: await idb.get('sales_customers') || [],
factory_inventory_data: await idb.get('factory_inventory_data') || [],
factory_production_history: await idb.get('factory_production_history') || [],
stock_returns: await idb.get('stock_returns') || [],
payment_transactions: await idb.get('payment_transactions') || [],
payment_entities: await idb.get('payment_entities') || [],
expenses: await idb.get('expenses') || []
};
const cleanBackupData = {
mfg_pro_pkr: ensureArray(data.mfg || data.mfg_pro_pkr).filter(isAlive),
noman_history: ensureArray(data.sales || data.noman_history).filter(isAlive),
customer_sales: ensureArray(data.customerSales).filter(isAlive),
rep_sales: ensureArray(data.repSales).filter(isAlive),
rep_customers: ensureArray(data.repCustomers).filter(isAlive),
sales_customers: ensureArray(data.salesCustomers).filter(isAlive),
factory_inventory_data: ensureArray(data.factoryInventoryData).filter(isAlive),
factory_production_history: ensureArray(data.factoryProductionHistory).filter(isAlive),
stock_returns: ensureArray(data.stockReturns).filter(isAlive),
payment_transactions: ensureArray(data.paymentTransactions).filter(isAlive),
payment_entities: ensureArray(data.paymentEntities).filter(isAlive),
expenses: ensureArray(data.expenses).filter(isAlive)
};
let totalAdded = 0;
let totalUpdated = 0;
let totalSkipped = 0;
const mergedData = {};
for (const [key, backupArray] of Object.entries(cleanBackupData)) {
const localArray = currentLocalData[key] || [];
const merged = mergeArraysByTimestamp(localArray, backupArray);
const localIds = new Set(localArray.map(item => item.id));
backupArray.forEach(backupItem => {
if (!localIds.has(backupItem.id)) {
totalAdded++;
} else {
const localItem = localArray.find(item => item.id === backupItem.id);
const backupTs = backupItem.timestamp || backupItem.updatedAt || backupItem.createdAt || 0;
const localTs = localItem?.timestamp || localItem?.updatedAt || localItem?.createdAt || 0;
const backupTime = typeof backupTs === 'number' ? backupTs : new Date(backupTs).getTime();
const localTime = typeof localTs === 'number' ? localTs : new Date(localTs).getTime();
if (backupTime > localTime) {
totalUpdated++;
} else {
totalSkipped++;
}
}
});
mergedData[key] = merged;
}
await Promise.all([
idb.set('mfg_pro_pkr', mergedData.mfg_pro_pkr),
idb.set('noman_history', mergedData.noman_history),
idb.set('customer_sales', mergedData.customer_sales),
idb.set('rep_sales', mergedData.rep_sales),
idb.set('rep_customers', mergedData.rep_customers),
idb.set('sales_customers', mergedData.sales_customers),
idb.set('factory_inventory_data', mergedData.factory_inventory_data),
idb.set('factory_production_history', mergedData.factory_production_history),
idb.set('stock_returns', mergedData.stock_returns),
idb.set('payment_transactions', mergedData.payment_transactions),
idb.set('payment_entities', mergedData.payment_entities),
idb.set('expenses', mergedData.expenses)
]);
const currentSettings = {
factoryDefaultFormulas: await idb.get('factory_default_formulas'),
factoryAdditionalCosts: await idb.get('factory_additional_costs'),
factoryCostAdjustmentFactor: await idb.get('factory_cost_adjustment_factor'),
factorySalePrices: await idb.get('factory_sale_prices'),
factoryUnitTracking: await idb.get('factory_unit_tracking'),
naswarDefaultSettings: await idb.get('naswar_default_settings')
};
const settingsTimestamp = Date.now();
if (data.factoryDefaultFormulas && JSON.stringify(data.factoryDefaultFormulas) !== JSON.stringify(currentSettings.factoryDefaultFormulas)) {
await idb.set('factory_default_formulas', data.factoryDefaultFormulas);
await idb.set('factory_default_formulas_timestamp', settingsTimestamp);
factoryDefaultFormulas = data.factoryDefaultFormulas;
}
if (data.factoryAdditionalCosts && JSON.stringify(data.factoryAdditionalCosts) !== JSON.stringify(currentSettings.factoryAdditionalCosts)) {
await idb.set('factory_additional_costs', data.factoryAdditionalCosts);
await idb.set('factory_additional_costs_timestamp', settingsTimestamp);
factoryAdditionalCosts = data.factoryAdditionalCosts;
}
if (data.factoryCostAdjustmentFactor && JSON.stringify(data.factoryCostAdjustmentFactor) !== JSON.stringify(currentSettings.factoryCostAdjustmentFactor)) {
await idb.set('factory_cost_adjustment_factor', data.factoryCostAdjustmentFactor);
await idb.set('factory_cost_adjustment_factor_timestamp', settingsTimestamp);
factoryCostAdjustmentFactor = data.factoryCostAdjustmentFactor;
}
if (data.factorySalePrices && JSON.stringify(data.factorySalePrices) !== JSON.stringify(currentSettings.factorySalePrices)) {
await idb.set('factory_sale_prices', data.factorySalePrices);
await idb.set('factory_sale_prices_timestamp', settingsTimestamp);
factorySalePrices = data.factorySalePrices;
}
if (data.factoryUnitTracking && JSON.stringify(data.factoryUnitTracking) !== JSON.stringify(currentSettings.factoryUnitTracking)) {
await idb.set('factory_unit_tracking', data.factoryUnitTracking);
await idb.set('factory_unit_tracking_timestamp', settingsTimestamp);
factoryUnitTracking = data.factoryUnitTracking;
}
if (data.settings && JSON.stringify(data.settings) !== JSON.stringify(currentSettings.naswarDefaultSettings)) {
await idb.set('naswar_default_settings', data.settings);
await idb.set('naswar_default_settings_timestamp', settingsTimestamp);
defaultSettings = data.settings;
}
await loadAllData();
try { syncFactoryProductionStats(); } catch(e) { console.error('Factory stats error:', e); }
try { await invalidateAllCaches(); } catch(e) { console.error('Cache invalidation error:', e); }
try { await refreshAllDisplays(); } catch(e) { console.error('Display refresh error:', e); }
let cloudSyncSuccess = false;
if (firebaseDB && currentUser) {
try {
showToast('Analyzing records for intelligent upload...', 'info');
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
const collectionMapping = {
'production': { data: ensureArray(mergedData.mfg_pro_pkr), deltaName: 'production' },
'sales': { data: ensureArray(mergedData.customer_sales), deltaName: 'sales' },
'calculator_history': { data: ensureArray(mergedData.noman_history), deltaName: 'calculator_history' },
'rep_sales': { data: ensureArray(mergedData.rep_sales), deltaName: 'rep_sales' },
'rep_customers': { data: ensureArray(mergedData.rep_customers), deltaName: 'rep_customers' },
'sales_customers': { data: ensureArray(mergedData.sales_customers), deltaName: 'sales_customers' },
'inventory': { data: ensureArray(mergedData.factory_inventory_data), deltaName: 'inventory' },
'factory_history': { data: ensureArray(mergedData.factory_production_history), deltaName: 'factory_history' },
'returns': { data: ensureArray(mergedData.stock_returns), deltaName: 'returns' },
'transactions': { data: ensureArray(mergedData.payment_transactions), deltaName: 'transactions' },
'entities': { data: ensureArray(mergedData.payment_entities), deltaName: 'entities' },
'expenses': { data: ensureArray(mergedData.expenses), deltaName: 'expenses' }
};

const itemsToUpload = {};
let totalToUpload = 0;
for (const [cloudName, config] of Object.entries(collectionMapping)) {
const allItems = config.data.filter(item => item);
itemsToUpload[cloudName] = allItems;
totalToUpload += allItems.length;
}
const batch = firebaseDB.batch();
let operationCount = 0;
const batches = [batch];
const getCurrentBatch = () => {
if (operationCount >= 495) {
batches.push(firebaseDB.batch());
operationCount = 0;
}
return batches[batches.length - 1];
};
if (totalToUpload === 0) {
showToast(' No records found in backup to upload.', 'info');
} else {
showToast(`Uploading ${totalToUpload} records to cloud...`, 'info');
for (const [cloudCollectionName, records] of Object.entries(itemsToUpload)) {
for (const record of records) {
if (!record || !record.id) continue;
try {
const docId = String(record.id);
const sanitizedRecord = sanitizeForFirestore(record);
if (!sanitizedRecord || typeof sanitizedRecord !== 'object') continue;
sanitizedRecord.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
const currentBatch = getCurrentBatch();
currentBatch.set(userRef.collection(cloudCollectionName).doc(docId), sanitizedRecord, { merge: true });
operationCount++;
trackFirestoreWrite(1);
} catch (error) { console.error('Cloud save op failed', error); }
}
}
}
try {
const currentBatch = getCurrentBatch();
const ensureFactorySettings = (obj, defaultVal) => {
if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return defaultVal;
const hasStandard = ('standard' in obj) && obj.standard !== undefined;
const hasAsaan = ('asaan' in obj) && obj.asaan !== undefined;
if (!hasStandard || !hasAsaan) return defaultVal;
return { standard: obj.standard, asaan: obj.asaan };
};
const currentTimestamp = new Date().toISOString();
const factorySettingsPayload = {
default_formulas: ensureFactorySettings(await idb.get('factory_default_formulas'), { standard: [], asaan: [] }),
default_formulas_timestamp: await idb.get('factory_default_formulas_timestamp') || currentTimestamp,
additional_costs: ensureFactorySettings(await idb.get('factory_additional_costs'), { standard: 0, asaan: 0 }),
additional_costs_timestamp: await idb.get('factory_additional_costs_timestamp') || currentTimestamp,
cost_adjustment_factor: ensureFactorySettings(await idb.get('factory_cost_adjustment_factor'), { standard: 1, asaan: 1 }),
cost_adjustment_factor_timestamp: await idb.get('factory_cost_adjustment_factor_timestamp') || currentTimestamp,
sale_prices: ensureFactorySettings(await idb.get('factory_sale_prices'), { standard: 0, asaan: 0 }),
sale_prices_timestamp: await idb.get('factory_sale_prices_timestamp') || currentTimestamp,
unit_tracking: ensureFactorySettings(await idb.get('factory_unit_tracking'), { standard: { produced:0,consumed:0,available:0,unitCostHistory:[] }, asaan: { produced:0,consumed:0,available:0,unitCostHistory:[] } }),
unit_tracking_timestamp: await idb.get('factory_unit_tracking_timestamp') || currentTimestamp,
last_synced: new Date().toISOString()
};
const sanitizedFactorySettings = sanitizeForFirestore(factorySettingsPayload);
const factorySettingsRef = userRef.collection('factorySettings').doc('config');
currentBatch.set(factorySettingsRef, sanitizedFactorySettings, { merge: true });
operationCount++;
} catch (factorySettingsError) { console.error('Factory settings cloud error', factorySettingsError); }
if (operationCount > 0) {
// Commit batches sequentially with event-loop yields — keeps UI responsive during large restores
for (let _bi = 0; _bi < batches.length; _bi++) {
	await batches[_bi].commit();
	if (batches.length > 1) {
		showToast('Uploading to cloud... ' + (_bi + 1) + ' / ' + batches.length + ' batches', 'info');
	}
	await new Promise(r => setTimeout(r, 0)); // yield to browser
}
for (const [cloudName, config] of Object.entries(collectionMapping)) {
if (itemsToUpload[cloudName] && itemsToUpload[cloudName].length > 0) {
await DeltaSync.setLastSyncTimestamp(config.deltaName);
}
}
cloudSyncSuccess = true;
const message = totalToUpload > 0
? ` Successfully restored & uploaded ${totalToUpload} records + factory settings to cloud!`
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
const syncMessage = cloudSyncSuccess ? ' and changed records uploaded to cloud' : '';
showToast(`Restore complete${syncMessage}! ${statsMessage}`, 'success', 5000);
}

async function _doYearCloseRestore(data, honourPostCloseDeletions = true) {
  data = migrateBackupSchema(data);
  showToast('↩ Reversing financial year close — replacing data...', 'info', 5000);

  

  

  const isAlive = honourPostCloseDeletions
    ? (item) => item && item.id && !deletedRecordIds.has(item.id)
    : (item) => item && item.id; 
  const replaceData = {
    mfg_pro_pkr:                ensureArray(data.mfg || data.mfg_pro_pkr).filter(isAlive),
    noman_history:              ensureArray(data.sales || data.noman_history).filter(isAlive),
    customer_sales:             ensureArray(data.customerSales).filter(isAlive),
    rep_sales:                  ensureArray(data.repSales).filter(isAlive),
    rep_customers:              ensureArray(data.repCustomers).filter(isAlive),
    sales_customers:            ensureArray(data.salesCustomers).filter(isAlive),
    factory_inventory_data:     ensureArray(data.factoryInventoryData).filter(isAlive),
    factory_production_history: ensureArray(data.factoryProductionHistory).filter(isAlive),
    stock_returns:              ensureArray(data.stockReturns).filter(isAlive),
    payment_transactions:       ensureArray(data.paymentTransactions).filter(isAlive),
    payment_entities:           ensureArray(data.paymentEntities).filter(isAlive),
    expenses:                   ensureArray(data.expenses).filter(isAlive)
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
          .collection('settings').doc('naswar_default_settings')
          .set({ fyCloseCount: currentSettings.fyCloseCount, lastYearClosedAt: currentSettings.lastYearClosedAt, lastYearClosedDate: currentSettings.lastYearClosedDate }, { merge: true });
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
const tabIndexMap = { 'prod': 0, 'sales': 1, 'calc': 2, 'factory': 3, 'payments': 4, 'rep': 5 };
const activeIndex = tabIndexMap[tab];
tabButtons.forEach((btn, i) => {
btn.classList.toggle('active', i === activeIndex);
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
// Materials = raw formula cost only (formulaCost = costPerUnit×formulaUnits, no additional overhead)
const stdMaterialsValue = stdProductionData.reduce((sum, item) => sum + (item.formulaCost || item.totalCost || 0), 0);
const _setFac = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
_setFac('factoryStdUnits', stdAvailableUnits.toFixed(2));
_setFac('factoryStdUsedUnits', stdUsedUnits.toFixed(2));
_setFac('factoryStdUnitCost', await formatCurrency(stdCostPerUnit));
_setFac('factoryStdTotalVal', await formatCurrency(stdTotalCostValue));
_setFac('factoryStdOutput', stdOutputQuantity.toFixed(2) + ' kg');
_setFac('factoryStdRawUsed', stdRawMaterialsUsed.toFixed(2) + ' kg');
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
// Materials = raw formula cost only (formulaCost = costPerUnit×formulaUnits, no additional overhead)
const asaanMaterialsValue = asaanProductionData.reduce((sum, item) => sum + (item.formulaCost || item.totalCost || 0), 0);
_setFac('factoryAsaanUnits', asaanAvailableUnits.toFixed(2));
_setFac('factoryAsaanUsedUnits', asaanUsedUnits.toFixed(2));
_setFac('factoryAsaanUnitCost', await formatCurrency(asaanCostPerUnit));
_setFac('factoryAsaanTotalVal', await formatCurrency(asaanTotalCostValue));
_setFac('factoryAsaanOutput', asaanOutputQuantity.toFixed(2) + ' kg');
_setFac('factoryAsaanRawUsed', asaanRawMaterialsUsed.toFixed(2) + ' kg');
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

// Helper: check if a date string falls within the selected mode/range
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
return true; // 'all'
}

// Available units = all-time stock on hand (std + asaan), not filtered by period.
// This matches what is physically in inventory regardless of the selected date range.
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

// Period-filtered metrics: used, output, cost, profit — scoped to the selected date range
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
// Raw materials cost = formula cost only (excludes additional/overhead costs)
totalRawMatCost += entry.formulaCost || entry.totalCost || 0;
const weightPerUnit = getWeightPerUnit(formulaStore);
totalRawUsed += weightPerUnit * units;
});

const totalConsumed = stdConsumed + asaanConsumed;

// Cost per unit: weighted average of live cost-per-unit for each formula type,
// weighted by how many units of each type were consumed in the period.
const stdCostPerUnit = getCostPerUnit('standard');
const asaanCostPerUnit = getCostPerUnit('asaan');
const avgCostPerUnit = totalConsumed > 0
? (stdConsumed * stdCostPerUnit + asaanConsumed * asaanCostPerUnit) / totalConsumed
: 0;

// Total cost = sum of actual production costs recorded on each entry (net * dynamicCostPerKg)
// Materials cost = raw formula cost component (costPerUnit * formulaUnits, without overhead)
const totalMatValue = totalRawMatCost;

// Profit per kg = total profit earned over total output weight in the period
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
console.error('Failed to save data locally.', error);
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
allStoresGrid.innerHTML = '';
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
if (!isDirectSale(sale)) return;
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
allStoresGrid.appendChild(card);
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
allStoresGrid.appendChild(combinedCard);
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
if (isRepSale(item)) return; 
if(item.date === dateStr) {
if (item.isMerged && item.mergedSummary) {
const ms = item.mergedSummary;
dayCash   += (ms.cashSales    || 0);
dayCredit += (ms.unpaidCredit || 0);
} else if(item.paymentType === 'CASH' || item.creditReceived) {
dayCash += item.totalValue;
} else if(item.paymentType === 'CREDIT' && !item.creditReceived) {
dayCredit += item.totalValue;
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
if (isRepSale(item)) return; 
const d = new Date(item.date);
if(d.getMonth() === selectedMonth && d.getFullYear() === selectedYear) {
if (item.isMerged && item.mergedSummary) {
const ms = item.mergedSummary;
cashData[d.getDate()   - 1] += (ms.cashSales    || 0);
creditData[d.getDate() - 1] += (ms.unpaidCredit || 0);
} else if(item.paymentType === 'CASH' || item.creditReceived) {
cashData[d.getDate() - 1] += item.totalValue;
} else if(item.paymentType === 'CREDIT' && !item.creditReceived) {
creditData[d.getDate() - 1] += item.totalValue;
}
}
});
} else if (currentCustomerChartMode === 'year') {
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
labels = months;
cashData = new Array(12).fill(0);
creditData = new Array(12).fill(0);
customerSales.forEach(item => {
if (isRepSale(item)) return; 
const d = new Date(item.date);
if(d.getFullYear() === selectedYear) {
if (item.isMerged && item.mergedSummary) {
const ms = item.mergedSummary;
cashData[d.getMonth()]   += (ms.cashSales    || 0);
creditData[d.getMonth()] += (ms.unpaidCredit || 0);
} else if(item.paymentType === 'CASH' || item.creditReceived) {
cashData[d.getMonth()] += item.totalValue;
} else if(item.paymentType === 'CREDIT' && !item.creditReceived) {
creditData[d.getMonth()] += item.totalValue;
}
}
});
} else if (currentCustomerChartMode === 'all') {
const monthData = {};
customerSales.forEach(item => {
if (isRepSale(item)) return; 
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
if (item.isMerged && item.mergedSummary) {
const ms = item.mergedSummary;
monthData[monthYear].cash   += (ms.cashSales    || 0);
monthData[monthYear].credit += (ms.unpaidCredit || 0);
} else if(item.paymentType === 'CASH' || item.creditReceived) {
monthData[monthYear].cash += item.totalValue;
} else if(item.paymentType === 'CREDIT' && !item.creditReceived) {
monthData[monthYear].credit += item.totalValue;
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
if (item.isRepModeEntry === true || (item.salesRep && item.salesRep !== 'NONE')) return;
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
if (item.isMerged && item.mergedSummary) {
const ms = item.mergedSummary;
totalCash   += (ms.cashSales    || 0);
totalCredit += (ms.unpaidCredit || 0);
} else if(item.paymentType === 'CASH' || item.creditReceived) {
totalCash += item.totalValue;
} else if(item.paymentType === 'CREDIT' && !item.creditReceived) {
totalCredit += item.totalValue;
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
console.error('Failed to save data locally.', firestoreError);
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
console.error('Failed to save data locally.', error);
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
if (item.isRepModeEntry === true ||
(item.salesRep && item.salesRep !== 'NONE') ||
item.paymentType === 'PARTIAL_PAYMENT' ||
item.paymentType === 'COLLECTION') return;
const rowDate = new Date(item.date);
const rowYear = rowDate.getFullYear();
const rowMonth = rowDate.getMonth();
const rowDay = rowDate.getDate();
const updatePeriod = (period) => {
period.q += item.quantity;
period.v += item.totalValue;
period.profit += item.profit;
if (item.isMerged && item.mergedSummary) {
const ms = item.mergedSummary;
period.cash   += (ms.cashSales    || 0);
period.credit += (ms.unpaidCredit || 0);
} else if(item.paymentType === 'CASH' || item.creditReceived) {
period.cash += item.totalValue;
} else if(item.paymentType === 'CREDIT' && !item.creditReceived) {
period.credit += item.totalValue;
}
};
if(item.date === selectedDate) updatePeriod(stats.day);
if(rowDate >= weekStart && rowDate <= selectedDateObj) updatePeriod(stats.week);
if(rowYear === selectedYear && rowMonth === selectedMonth) updatePeriod(stats.month);
if(rowYear === selectedYear) updatePeriod(stats.year);
updatePeriod(stats.all);
});
const displayData = sortedSales.filter(item =>
!item.isRepModeEntry &&
(!item.salesRep || item.salesRep === 'NONE' || item.salesRep === 'ADMIN') &&
item.paymentType !== 'PARTIAL_PAYMENT' &&
item.paymentType !== 'COLLECTION'
);
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
histContainer.innerHTML = '';
if (totalItems === 0) {
histContainer.innerHTML = `<p style="text-align:center; color:var(--text-muted); width:100%; font-size:0.85rem;">No sales found.</p>`;
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
card.className = `card liquid-card ${highlightClass}`;
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
const deleteBtnHtml = item.isMerged ? '' : `<button class="tbl-action-btn danger u-w-full u-mt-8" onclick="(async () => { await deleteCustomerSale('${esc(item.id)}') })()">Delete</button>`;
if (isOldDebtItem) {
card.innerHTML = `
<div class="payment-badge credit">CREDIT</div>
<div class="customer-name" style="margin-top: 12px;">${esc(item.customerName)}
<span style="background:rgba(255,159,10,0.15);color:var(--warning);padding:2px 6px;border-radius:4px;font-size:0.65rem;margin-left:6px;font-weight:600;">OLD DEBT</span>${item.isMerged ? _mergedBadgeHtml(item, {inline:true}) : ''}
</div>
<h4 style="margin-top: 5px; font-size: 0.85rem; color: var(--text-muted);">${dateDisplay}</h4>
<hr>
<p><span>Previous Balance:</span> <span class="rev-val">${fmtAmt(safeValue(item.totalValue))}</span></p>
<p class="u-fs-sm u-text-muted" >${esc(item.notes || 'Brought forward from previous records')}</p>
${deleteBtnHtml}
`;
} else {
card.innerHTML = `
<div class="payment-badge ${badgeClass}">${esc(badgeText)}</div>
<div class="customer-name" style="margin-top: 12px;">${esc(item.customerName)} ${repBadge} ${mergedBadge}</div>
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
histContainer.appendChild(fragment);
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
salesRepsList.forEach(rep => { comp[rep] = {prof:0, rev:0, sold:0, ret:0, cred:0, cash:0, coll:0, giv:0, cost:0}; });
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
<p><span>Received Cash:</span> <span class="qty-val" style="font-weight:800; color:var(--text-main);">${received.toFixed(2)}</span></p>
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
let totalSold = 0;
customerSales.forEach(sale => {
if (sale.salesRep === seller &&
sale.paymentType === 'CREDIT' &&
!sale.creditReceived &&
sale.isRepModeEntry !== true) {
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
repSales.forEach(sale => {
if (sale.usedInCalcId) {
usedRepSaleIds.add(sale.id);
}
});
if (Array.isArray(salesHistory)) {
salesHistory.forEach(calcEntry => {
if (calcEntry.linkedRepSalesIds && Array.isArray(calcEntry.linkedRepSalesIds)) {
calcEntry.linkedRepSalesIds.forEach(id => usedRepSaleIds.add(id));
}
});
}
let creditSalesKg = 0;
let recoveredCash = 0;
repSales.forEach(sale => {
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
d: { sold:0, ret:0, cash:0, cred:0, creditVal:0, collected:0, profit:0, revenue:0, expected:0, received:0 },
w: { sold:0, ret:0, cash:0, cred:0, creditVal:0, collected:0, profit:0, revenue:0, expected:0, received:0 },
m: { sold:0, ret:0, cash:0, cred:0, creditVal:0, collected:0, profit:0, revenue:0, expected:0, received:0 },
y: { sold:0, ret:0, cash:0, cred:0, creditVal:0, collected:0, profit:0, revenue:0, expected:0, received:0 },
a: { sold:0, ret:0, cash:0, cred:0, creditVal:0, collected:0, profit:0, revenue:0, expected:0, received:0 }
};
const list = document.getElementById('historyList');
list.innerHTML = '';
displayList.forEach(h => {
const isHighlight = h.date === searchDate;
const dateTitle = isHighlight ? `${formatDisplayDate(h.date)} (Selected)` : formatDisplayDate(h.date);

list.innerHTML += createReportHTML(
dateTitle,
{
sold: h.totalSold,
ret: h.returned,
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
);
});
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
const returnEntry = {
id: generateUUID('ret'),
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
db.push(returnEntry);
await unifiedSave('mfg_pro_pkr', db, returnEntry);
const returnLogEntry = {
id: generateUUID('retlog'),
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
await unifiedDelete('mfg_pro_pkr', db, returnEntry.id);
}
const returnLogEntry = stockReturns.find(r =>
r.store === storeKey &&
r.quantity === quantity &&
r.date === date
);
if (returnLogEntry) {
stockReturns = stockReturns.filter(r => r.id !== returnLogEntry.id);
await unifiedDelete('stock_returns', stockReturns, returnLogEntry.id);
}
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
console.error('Display refresh failed.', error);
showToast('Display refresh failed.', 'error');
}
try {
if (typeof refreshUI === 'function') await refreshUI(1, true);
} catch (error) {
console.error('Display refresh failed.', error);
showToast('Display refresh failed.', 'error');
}
try {
if (typeof refreshCustomerSales === 'function') await refreshCustomerSales(1, true);
else if (typeof renderCustomersTable === 'function') renderCustomersTable();
} catch (error) {
console.error('Display refresh failed.', error);
showToast('Display refresh failed.', 'error');
}
try {
if (typeof loadSalesData === 'function') await loadSalesData(currentCompMode);
} catch (error) {
console.error('Display refresh failed.', error);
showToast('Display refresh failed.', 'error');
}
try {
if (typeof initFactoryTab === 'function') initFactoryTab();
} catch (error) {
console.error('Display refresh failed.', error);
showToast('Display refresh failed.', 'error');
}
try {
if (document.getElementById('tab-payments') && !document.getElementById('tab-payments').classList.contains('hidden')) {
if (typeof refreshPaymentTab === 'function') await refreshPaymentTab();
}
} catch (error) {
console.error('Payment tab refresh failed.', error);
showToast('Payment tab refresh failed.', 'error');
}
try {
if (typeof calculateNetCash === 'function') calculateNetCash();
} catch (error) {
console.error('Payment tab refresh failed.', error);
showToast('Payment tab refresh failed.', 'error');
}
try {
if (appMode === 'rep') {
if (typeof renderRepHistory === 'function') renderRepHistory();
if (typeof renderRepCustomerTable === 'function') renderRepCustomerTable();
}
} catch (error) {
console.error('Payment tab refresh failed.', error);
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

  // Defer heavy UI renders until after first paint — splash screen appears immediately
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
      if (saleIdEl) { const id = generateUUID(); saleIdEl.textContent = 'ID: ' + id.split('-').slice(0,2).join('-') + '\u2026'; saleIdEl.title = id; }
      const expIdEl = document.getElementById('expense-id-display');
      if (expIdEl) { const id2 = generateUUID('exp'); expIdEl.textContent = 'ID: ' + id2.split('-').slice(0,2).join('-') + '\u2026'; expIdEl.title = id2; }
    }
  }, 400);
  }); // end requestAnimationFrame

  scheduleAutomaticCleanup();
  // Defer heavy validation until after first paint (was 2s, now 5s to clear splash first)
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
const _dsHasImpact = linkedCount > 0 || linkedRepCount > 0 || (entryToDelete.returned > 0 && entryToDelete.returnStore);
if (_dsHasImpact) {
confirmMsg += `\n\n\u26a0 The following cascading changes will occur:`;
if (linkedCount > 0) confirmMsg += `\n \u2022 ${linkedCount} linked sale${linkedCount !== 1 ? 's' : ''} will REVERT to "Pending Credit" status.`;
if (linkedRepCount > 0) confirmMsg += `\n \u2022 ${linkedRepCount} rep sale${linkedRepCount !== 1 ? 's' : ''} will be RESTORED to calculator fields.`;
if (entryToDelete.returned > 0 && entryToDelete.returnStore) confirmMsg += `\n \u2022 ${entryToDelete.returned} kg will be REMOVED from ${getStoreLabel(entryToDelete.returnStore)} inventory (return reversal).`;
}
if (await showGlassConfirm(confirmMsg, { title: `Delete ${entryToDelete.seller || "Sales"} Record`, confirmText: "Delete", danger: true })) {
await registerDeletion(id, 'calculator_history');
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
const newHistory = history.filter(h => h.id !== id);
await unifiedDelete('noman_history', newHistory, id);
if (Array.isArray(salesHistory)) {
const idx = salesHistory.findIndex(h => h.id === id);
if (idx !== -1) salesHistory.splice(idx, 1);
}
refreshAllCalculations();
await loadSalesData(currentCompMode);
await refreshCustomerSales();
if (typeof refreshUI === 'function') await refreshUI();
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
revertedCount++;
}
});
if (revertedCount > 0) {
await saveWithTracking('customer_sales', customerSales);
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
paymentEntities[index] = {
...paymentEntities[index],
name,
type,
phone,
wallet,
updatedAt: getTimestamp()
};
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
// Load ALL data sources that calculateNetCash, calculateCashTracker, and
// updateEconomicDashboard depend on — not just payment-specific keys.
const allKeys = [
'expenses', 'payment_entities', 'payment_transactions',
'mfg_pro_pkr', 'customer_sales', 'noman_history',
'factory_inventory_data', 'factory_production_history',
'factory_unit_tracking',
'factory_default_formulas', 'factory_additional_costs',
'factory_sale_prices', 'factory_cost_adjustment_factor'
];
const paymentDataMap = await idb.getBatch(allKeys);
// --- Payment-specific data (with integrity checks) ---
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
expenseRecords = freshExpenses; // keep expenseRecords in sync — used by calculateCashTracker & calculateNetCash
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
// --- Cross-tab data needed for Production Value, Formula Units, Net Cash ---
const freshDb = paymentDataMap.get('mfg_pro_pkr');
if (Array.isArray(freshDb)) db = freshDb;
const freshCustomerSales = paymentDataMap.get('customer_sales');
if (Array.isArray(freshCustomerSales)) customerSales = freshCustomerSales;
const freshSalesHistory = paymentDataMap.get('noman_history');
if (Array.isArray(freshSalesHistory)) salesHistory = freshSalesHistory;
const freshInventory = paymentDataMap.get('factory_inventory_data');
if (Array.isArray(freshInventory)) factoryInventoryData = freshInventory;
// Load authoritative available-unit counts from IDB
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
// Rebuild unitCostHistory from actual production records so getCostPerUnit has accurate cost data
const freshProdHistory = paymentDataMap.get('factory_production_history');
if (Array.isArray(freshProdHistory)) {
factoryProductionHistory = freshProdHistory;
['standard', 'asaan'].forEach(s => {
factoryUnitTracking[s].unitCostHistory = freshProdHistory
.filter(e => e.store === s && e.units > 0 && e.totalCost > 0)
.map(e => ({ date: e.date, costPerUnit: e.totalCost / e.units, units: e.units }));
});
}
// Always recompute available units from source data for both standard and asaan formula types
// to ensure the payment tab reflects accurate live counts rather than potentially stale IDB values
if (Array.isArray(factoryProductionHistory)) {
const recomp = { standard: { produced: 0, consumed: 0 }, asaan: { produced: 0, consumed: 0 } };
factoryProductionHistory.forEach(e => {
const s = e.store === 'asaan' ? 'asaan' : 'standard';
if (e.units > 0) recomp[s].produced += e.units;
});
db.forEach(e => {
if (e.isReturn) return;
// Use formulaStore when available; fall back to deriving from store field
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
console.error('calculateNetCash error:', e);
}
try {
if (typeof updateFactoryInventoryDisplay === 'function') {
// Diagnostic: log what drives Formula Units Inventory
const _std = factoryUnitTracking?.standard || {};
const _asn = factoryUnitTracking?.asaan || {};
console.log('[PaymentTab] factoryUnitTracking →', JSON.stringify({ std_avail: _std.available, asn_avail: _asn.available }));
console.log('[PaymentTab] getCostPerUnit(standard) =', getCostPerUnit('standard'), '| getCostPerUnit(asaan) =', getCostPerUnit('asaan'));
console.log('[PaymentTab] formulaUnitsValue =', (_std.available||0)*getCostPerUnit('standard') + (_asn.available||0)*getCostPerUnit('asaan'));
updateFactoryInventoryDisplay();
}
} catch (e) {
console.error('updateFactoryInventoryDisplay error:', e);
}
try { calculatePaymentSummaries(); } catch (e) {
showToast('Calculation failed.', 'error');
console.error('calculatePaymentSummaries error:', e);
}
try { renderUnifiedTable(); } catch (e) {
showToast('Calculation failed.', 'error');
console.error('renderUnifiedTable error:', e);
}
try { updateExpenseBreakdown(); } catch (e) {
showToast('Calculation failed.', 'error');
console.error('updateExpenseBreakdown error:', e);
}
try { calculateCashTracker(); } catch (e) {
showToast('Calculation failed.', 'error');
console.error('calculateCashTracker error:', e);
}
const historyList = document.getElementById('paymentHistoryList');
if (!historyList) {
return;
}
historyList.innerHTML = '';
const sortedTransactions = [...paymentTransactions].sort((a, b) => b.timestamp - a.timestamp);
sortedTransactions.forEach(transaction => {
const entity = paymentEntities.find(e => String(e.id) === String(transaction.entityId));
const badgeClass = transaction.type === 'IN' ? 'transaction-in' : 'transaction-out';
const badgeText = transaction.type === 'IN' ? 'IN' : 'OUT';
const entityName = entity ? entity.name : (transaction.entityName || 'Unknown Entity');
const entityType = entity ? entity.type : (transaction.entityType || 'Unknown');
const isMerged = transaction.isMerged === true;
const mergedBadge = isMerged ? _mergedBadgeHtml(transaction, {inline:true}) : '';
const deleteButton = isMerged ? '' : `<button class="tbl-action-btn danger u-w-full u-mt-8" onclick="(async () => { await deletePaymentTransaction('${esc(transaction.id)}') })()">Delete</button>`;
const card = document.createElement('div');
card.className = 'card liquid-card';
if (transaction.date) card.setAttribute('data-date', transaction.date);
card.innerHTML = `
<span class="transaction-badge ${badgeClass}">${badgeText}</span>
<h4>${formatDisplayDate(transaction.date)} @ ${esc(transaction.time || 'N/A')}</h4>
<div class="customer-name">${esc(entityName)}${mergedBadge}</div>
<p><span>Type:</span> <span>${esc(entityType)}</span></p>
<p><span>Description:</span> <span>${esc(transaction.description || 'No description')}</span></p>
<hr>
<p><span>Amount:</span> <span class="${transaction.type === 'IN' ? 'profit-val' : 'cost-val'}">${fmtAmt(safeValue(transaction.amount))}</span></p>
${deleteButton}
`;
historyList.appendChild(card);
});
if (sortedTransactions.length === 0) {
historyList.innerHTML = '<p style="text-align:center; color:var(--text-muted); width:100%; font-size:0.85rem;">No payment transactions found.</p>';
}
_filterPaymentHistoryByPeriod();
} catch (error) {
console.error('Payment transaction failed.', error);
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
await registerDeletion(editingFactoryInventoryId, 'inventory');
factoryInventoryData = factoryInventoryData.filter(item => item.id !== editingFactoryInventoryId);
hasChanges = true;
await unifiedDelete('factory_inventory_data', factoryInventoryData, editingFactoryInventoryId);
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
let expenseId = generateUUID('expense');
if (!validateUUID(expenseId)) {
expenseId = generateUUID('expense');
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
let payExpenseId = generateUUID('expense');
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
let newEntity = {
id: generateUUID('entity'),
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
let transaction = {
id: generateUUID('payment'),
entityId: entity.id,
entityName: entity.name,
amount: amount,
type: transactionType,
date: date,
description: description || `Payment ${transactionType}: ${name}`,
isPayable: false,
isExpense: false,
expenseId: payExpenseId
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
console.error('Failed to render data.', e);
showToast('Failed to render data.', 'error');
}
}
if (typeof refreshPaymentTab === 'function') {
try {
await refreshPaymentTab(true);
} catch (e) {
console.error('Payment tab refresh failed.', e);
showToast('Payment tab refresh failed.', 'error');
}
}
if (typeof renderExpenseTable === 'function') {
try {
renderExpenseTable(1);
} catch (e) {
console.error('Payment tab refresh failed.', e);
showToast('Payment tab refresh failed.', 'error');
}
}
if (typeof handleExpenseSearch === 'function') {
try {
handleExpenseSearch();
} catch (e) {
console.error('Payment tab refresh failed.', e);
showToast('Payment tab refresh failed.', 'error');
}
}
if (typeof calculateNetCash === 'function') {
try {
calculateNetCash();
} catch (e) {
console.error('Payment tab refresh failed.', e);
showToast('Payment tab refresh failed.', 'error');
}
}
if (typeof renderFactoryInventory === 'function') {
try {
renderFactoryInventory();
} catch (e) {
console.error('Payment tab refresh failed.', e);
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
console.error('Failed to render data.', rollbackError);
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
let newEntity = {
id: generateUUID('entity'),
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
let transaction = {
id: generateUUID('payment'),
entityId: entity.id,
entityName: entity.name,
amount: expense.amount,
type: 'OUT',
date: expense.date,
description: expense.description || `Expense: ${esc(expense.name)}`,
category: expense.category,
isPayable: false,
isExpense: true,
expenseId: expense.id
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
console.error('Calculation failed.', error);
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
tbody.innerHTML = '';
tbody.appendChild(fragment);
}
async function renderUnifiedTable(page = 1) {
try {
const freshEntities = await idb.get('payment_entities', []);
if (freshEntities && freshEntities.length > 0) {
paymentEntities = freshEntities;
}
const freshTransactions = await idb.get('payment_transactions', []);
if (freshTransactions && freshTransactions.length > 0) {
paymentTransactions = freshTransactions;
}
const freshExpenses = await idb.get('expenses', []);
if (freshExpenses && freshExpenses.length > 0) {
expenseRecords = freshExpenses;
}
} catch (error) {
console.error('Failed to render data.', error);
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
renderExpenseOverlayContent();
requestAnimationFrame(() => {
document.body.style.overflow = 'hidden';
document.documentElement.style.overflow = 'hidden';
const overlayEl = document.getElementById('expenseDetailsOverlay');
if (overlayEl) overlayEl.style.display = 'flex';
});
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
list.innerHTML = '';
if (relatedExpenses.length === 0) {
list.innerHTML = `<div class="u-empty-state-sm" >No expense records found for selected period</div>`;
return;
}
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
list.appendChild(item);
});
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
await unifiedDelete('expenses', expenseRecords, exp.id);
const linked = paymentTransactions.filter(t => t.expenseId === exp.id);
if (linked.length > 0) {
paymentTransactions = paymentTransactions.filter(t => t.expenseId !== exp.id);
for (const tx of linked) {
await unifiedDelete('payment_transactions', paymentTransactions, tx.id);
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
const expense = expenseRecords.find(e => e.id === expenseId);
if (!expense) {
const orphans = paymentTransactions.filter(t => t.expenseId === expenseId);
if (orphans.length > 0) {
paymentTransactions = paymentTransactions.filter(t => t.expenseId !== expenseId);
for (const tx of orphans) {
await unifiedDelete('payment_transactions', paymentTransactions, tx.id);
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
} else {
mat.totalPayable = parseFloat((mat.totalPayable - remaining).toFixed(2));
remaining = 0;
}
}
});
for (const mat of supplierMaterials) {
await unifiedSave('factory_inventory_data', factoryInventoryData, mat);
}
}
if (txToDelete.length > 0) {
paymentTransactions = paymentTransactions.filter(t => t.expenseId !== expenseId);
for (const trans of txToDelete) {
await unifiedDelete('payment_transactions', paymentTransactions, trans.id);
}
}
expenseRecords = expenseRecords.filter(e => e.id !== expenseId);
await unifiedDelete('expenses', expenseRecords, expenseId);
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
function selectCustomer(name) {
const input = document.getElementById('cust-name');
const resultsDiv = document.getElementById('customer-search-results');
if(input) {
input.value = name;
}
if(resultsDiv) {
resultsDiv.classList.add('hidden');
}
if(typeof calculateCustomerStatsForDisplay === 'function') {
calculateCustomerStatsForDisplay(name);
}
}
async function calculateCustomerStatsForDisplay(name) {
if (!name) return;
const sales = customerSales.filter(s =>
s && s.customerName && s.customerName.toLowerCase() === name.toLowerCase() &&
s.isRepModeEntry !== true &&
(!s.salesRep || s.salesRep === 'NONE' || s.salesRep === 'ADMIN')
);
if (sales.length === 0) {
document.getElementById('customer-info-display').classList.add('hidden');
return;
}
let totalCredit = 0;
let totalQty = 0;
sales.forEach(s => {
totalQty += (s.quantity || 0);
if (s.transactionType === 'OLD_DEBT') {
// OLD_DEBT: outstanding = totalValue minus any partial payments already applied
if (!s.creditReceived) {
const partialPaid = s.partialPaymentReceived || 0;
totalCredit += ((s.totalValue || 0) - partialPaid);
}
} else if (s.paymentType === 'CREDIT' && !s.creditReceived) {
if (s.isMerged && typeof s.creditValue === 'number') {
totalCredit += s.creditValue;
} else {
const partialPaid = s.partialPaymentReceived || 0;
totalCredit += ((s.totalValue || 0) - partialPaid);
}
} else if (s.paymentType === 'COLLECTION') {
// Bulk payments reduce the running debt
totalCredit -= (s.totalValue || 0);
} else if (s.paymentType === 'PARTIAL_PAYMENT') {
// Standalone partial payment records reduce the running debt
totalCredit -= (s.totalValue || 0);
}
});
// Clamp to zero — negative balance means overpaid, not a negative debt
totalCredit = Math.max(0, totalCredit);
const _setCust = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
_setCust('customer-current-credit', await formatCurrency(totalCredit));
_setCust('customer-total-quantity', safeNumber(totalQty, 0).toFixed(2) + ' kg');
document.getElementById('customer-info-display').classList.remove('hidden');
}
async function renderCustomersTable(page = 1) {
const tbody = document.getElementById('customers-table-body');
if (!tbody) {
return;
}
try {
const freshSales = await idb.get('customer_sales', []);
if (Array.isArray(freshSales)) {
const recordMap = new Map(freshSales.map(s => [s.id, s]));
if (Array.isArray(customerSales)) {
customerSales.forEach(s => {
if (!recordMap.has(s.id)) {
recordMap.set(s.id, s);
}
});
}
customerSales = Array.from(recordMap.values());
}
} catch (error) {
console.error('UI refresh failed.', error);
showToast('UI refresh failed.', 'error');
}
const filterInput = document.getElementById('customer-filter');
const filterValue = filterInput ? filterInput.value.toLowerCase() : '';
const customerStats = {};
customerSales.forEach(sale => {
if (sale.isRepModeEntry === true) return;
const name = sale.salesRep && sale.salesRep !== 'NONE' && sale.salesRep !== 'ADMIN'
? sale.salesRep
: sale.customerName;
if (!name || name.trim() === '') return;
if (!customerStats[name]) {
customerStats[name] = { name: name, credit: 0, quantity: 0, lastSaleDate: 0 };
}
customerStats[name].quantity += (sale.quantity || 0);
if (sale.transactionType === 'OLD_DEBT' && !sale.creditReceived) {
const partialPaid = sale.partialPaymentReceived || 0;
customerStats[name].credit += ((sale.totalValue || 0) - partialPaid);
} else if (sale.paymentType === 'CREDIT' && !sale.creditReceived) {
if (sale.isMerged && typeof sale.creditValue === 'number') {
customerStats[name].credit += sale.creditValue;
} else {
const partialPaid = sale.partialPaymentReceived || 0;
customerStats[name].credit += ((sale.totalValue || 0) - partialPaid);
}
} else if (sale.paymentType === 'COLLECTION') {
customerStats[name].credit -= (sale.totalValue || 0);
} else if (sale.paymentType === 'PARTIAL_PAYMENT') {
customerStats[name].credit -= (sale.totalValue || 0);
}
if (customerStats[name].credit < 0) customerStats[name].credit = 0;
const saleDate = sale.date;
if (saleDate) {
const timestamp = new Date(saleDate).getTime();
if (!isNaN(timestamp) && timestamp > customerStats[name].lastSaleDate) {
customerStats[name].lastSaleDate = timestamp;
}
}
});
let sortedCustomers = Object.values(customerStats)
.filter(c => c && c.name)
.sort((a, b) => {
if (b.credit !== a.credit) return b.credit - a.credit;
return b.lastSaleDate - a.lastSaleDate;
});
if (filterValue) {
sortedCustomers = sortedCustomers.filter(c => c && c.name && c.name.toLowerCase().includes(filterValue));
}
let totalOutstanding = 0;
let totalGlobalQty = 0;
sortedCustomers.forEach(c => {
totalOutstanding += c.credit;
totalGlobalQty += c.quantity;
});
const pageCustomers = sortedCustomers;
const validPage = 1;
const totalPages = 1;
const totalItems = sortedCustomers.length;
const startIndex = 0;
const endIndex = sortedCustomers.length;
const customerData = {
customers: pageCustomers,
totalOutstanding,
totalGlobalQty,
totalItems,
page,
totalPages
};
if (customerData && customerData.customers) {
renderCustomersFromCache(customerData, tbody);
} else {
tbody.innerHTML = `<tr><td class="u-empty-state-danger" colspan="5" >Failed to load customer data</td></tr>`;
}
const _setCustH = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
_setCustH('customer-count', `${totalItems || 0} active`);
_setCustH('customers-total-credit', `${fmtAmt(totalOutstanding)}`);
_setCustH('customers-total-quantity', safeNumber(totalGlobalQty, 0).toFixed(2) + ' kg');
}
function renderCustomersFromCache(data, tbody) {
if (!data) {
tbody.innerHTML = `<tr><td class="u-empty-state-danger" colspan="5" >Error loading customers</td></tr>`;
return;
}
const { customers, totalItems, page, totalPages } = data;
if (!customers || !Array.isArray(customers)) {
tbody.innerHTML = `<tr><td class="u-empty-state-danger" colspan="5" >Invalid customer data</td></tr>`;
return;
}
if (customers.length === 0) {
tbody.innerHTML = `<tr><td class="u-empty-state-md" colspan="5" >No customers found</td></tr>`;
return;
}
function buildCustomerRow(c) {
if (!c || !c.name) return null;
try {
const displayDate = (c.lastSaleDate && !isNaN(c.lastSaleDate)) ? formatDisplayDate(new Date(c.lastSaleDate)) : '-';
let phone = '-';
try {
const contact = salesCustomers.find(ct => ct && ct.name && c && c.name && ct.name.toLowerCase() === c.name.toLowerCase());
const customerSaleData = customerSales.find(s =>
s && s.customerName && c && c.name &&
(s.customerName === c.name || s.salesRep === c.name) &&
s.isRepModeEntry !== true &&
s.customerPhone
);
phone = contact?.phone || customerSaleData?.customerPhone || '-';
} catch (phoneError) {
console.warn('Customer data operation failed.', phoneError);
}
const creditStyle = c.credit > 0 ? 'color:var(--warning); font-weight:700;' : 'color:var(--accent-emerald); font-weight:700;';
const row = document.createElement('tr');
row.style.borderBottom = '1px solid var(--glass-border)';
const safeName = esc(c.name || 'Unknown');
const safeNameForAttr = (c.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
row.innerHTML = `
<td class="u-table-td">${displayDate}</td>
<td style="padding: 8px 2px; font-size: 0.8rem; color: var(--text-main); font-weight: 600;">${safeName}</td>
<td class="u-table-td">${phoneActionHTML(phone)}</td>
<td style="padding: 8px 2px; text-align: right; font-size: 0.8rem; ${creditStyle}">${fmtAmt(safeValue(c.credit))}</td>
<td style="padding: 6px 2px; text-align: center;">
<button class="tbl-action-btn" onclick="event.stopPropagation(); openCustomerManagement('${safeNameForAttr}')">View</button>
</td>`;
return row;
} catch (rowError) {
console.warn('An unexpected error occurred.', rowError);
return null;
}
}
GNDVirtualScroll.mount('vs-scroller-customers', customers, buildCustomerRow, tbody);
}
let currentManagingCustomer = null;
let currentManagingRepCustomer = null;
async function openCustomerManagement(customerName) {
currentManagingCustomer = customerName;
const _setMCT = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
_setMCT('manageCustomerTitle', customerName);
document.getElementById('bulkPaymentAmount').value = '';
requestAnimationFrame(() => {
document.body.style.overflow = 'hidden';
document.documentElement.style.overflow = 'hidden';
document.getElementById('customerManagementOverlay').style.display = 'flex';
});
await renderCustomerTransactions(customerName);
}
function closeCustomerManagement() {
requestAnimationFrame(() => {
document.body.style.overflow = '';
document.documentElement.style.overflow = '';
document.getElementById('customerManagementOverlay').style.display = 'none';
});
currentManagingCustomer = null;
setTimeout(async () => {
try {
const freshSales = await idb.get('customer_sales', []);
if (Array.isArray(freshSales)) {
const m = new Map(freshSales.map(s => [s.id, s]));
if (Array.isArray(customerSales)) customerSales.forEach(s => { if (!m.has(s.id)) m.set(s.id, s); });
customerSales = Array.from(m.values());
}
const freshContacts = await idb.get('sales_customers', []);
if (Array.isArray(freshContacts)) {
const m = new Map(freshContacts.map(c => [c.id, c]));
if (Array.isArray(salesCustomers)) salesCustomers.forEach(c => { if (!m.has(c.id)) m.set(c.id, c); });
salesCustomers = Array.from(m.values());
}
} catch(e) {
showToast('Customer data operation failed.', 'error');
console.warn('closeCustomerManagement IDB error', e);
}
if (typeof renderCustomersTable === 'function') renderCustomersTable();
}, 100);
}
async function renderCustomerTransactions(name) {
const list = document.getElementById('customerManagementHistoryList');
if (!list) return;
list.innerHTML = '';
let transactions = [];
try {
const dbSales = await idb.get('customer_sales', []);
if (Array.isArray(dbSales)) {
const recordMap = new Map(dbSales.map(s => [s.id, s]));
if (Array.isArray(customerSales)) {
customerSales.forEach(s => {
if (!recordMap.has(s.id)) {
recordMap.set(s.id, s);
}
});
}
customerSales = Array.from(recordMap.values());
transactions = customerSales.filter(s =>
s && s.customerName === name &&
s.isRepModeEntry !== true &&
(!s.salesRep || s.salesRep === 'NONE' || s.salesRep === 'ADMIN' || s.salesRep === name)
);
} else {
transactions = customerSales.filter(s =>
s && s.customerName === name &&
s.isRepModeEntry !== true &&
(!s.salesRep || s.salesRep === 'NONE' || s.salesRep === 'ADMIN' || s.salesRep === name)
);
}
} catch (error) {
console.error('Customer data operation failed.', error);
showToast('Customer data operation failed.', 'error');
transactions = customerSales.filter(s =>
s && s.customerName === name &&
s.isRepModeEntry !== true &&
(!s.salesRep || s.salesRep === 'NONE' || s.salesRep === 'ADMIN' || s.salesRep === name)
);
}
const rangeSelect = document.getElementById('customerPdfRange');
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
const entity = paymentEntities.find(e => e && e.name && e.name.toLowerCase() === name.toLowerCase());
const phone = entity?.phone || transactions.find(t => t && t.customerPhone)?.customerPhone || '';
const address = entity?.address || '';
const headerTitle = document.getElementById('manageCustomerTitle');
headerTitle.innerHTML = `
<div style="display:flex; align-items:center; gap:8px;">
<span>${esc(name)}</span>
<button class="btn-theme" style="padding:2px 6px; font-size:0.8rem; border:1px solid var(--accent); color:var(--accent); border-radius:50%;"
onclick="openCustomerEditModal('${esc(name).split("'").join("\\\'")}')" title="Edit Contact Info"></button>
</div>
<div style="font-size: 0.75rem; color: var(--text-muted); font-weight: normal; margin-top:4px;">
${phone ? phoneActionHTML(phone) : 'No Phone'} ${address ? `| ◆ ${esc(address)}` : ''}
</div>
`;
let currentDebt = 0;
transactions.forEach(t => {
if (t.transactionType === 'OLD_DEBT' && !t.creditReceived) {
const partialPaid = t.partialPaymentReceived || 0;
currentDebt += (t.totalValue || 0) - partialPaid;
} else if (t.paymentType === 'CREDIT' && !t.creditReceived) {
if (t.isMerged && typeof t.creditValue === 'number') {
currentDebt += t.creditValue;
} else {
const partialPaid = t.partialPaymentReceived || 0;
currentDebt += (t.totalValue - partialPaid);
}
} else if (t.paymentType === 'COLLECTION') {
currentDebt -= (t.totalValue || 0);
} else if (t.paymentType === 'PARTIAL_PAYMENT') {
currentDebt -= (t.totalValue || 0);
}
});
currentDebt = Math.max(0, currentDebt);
const _mcStats = document.getElementById('manageCustomerStats'); if (_mcStats) _mcStats.innerText = `Current Debt: ${await formatCurrency(currentDebt)}`;
transactions.sort((a,b) => {
const aPending = (a.paymentType === 'CREDIT' && !a.creditReceived) ? 1 : 0;
const bPending = (b.paymentType === 'CREDIT' && !b.creditReceived) ? 1 : 0;
if (bPending !== aPending) return bPending - aPending;
return b.timestamp - a.timestamp;
});
if(transactions.length === 0) {
list.innerHTML = '<div class="u-empty-state-sm" >No history found</div>';
return;
}
for (const t of transactions) {
const isCredit = t.paymentType === 'CREDIT';
const isPartialPayment = t.paymentType === 'PARTIAL_PAYMENT';
const isCollection = t.paymentType === 'COLLECTION';
const item = document.createElement('div');
item.className = 'cust-history-item';
let statusClass = t.creditReceived ? 'paid' : 'pending';
let btnText = t.creditReceived ? 'PAID' : 'PENDING';
let toggleBtnHtml = '';
const partialPaid = t.partialPaymentReceived || 0;

const effectiveDue = (t.isMerged && typeof t.creditValue === 'number') ? t.creditValue : ((t.totalValue || 0) - partialPaid);
const hasPartialPayment = isCredit && !t.creditReceived && partialPaid > 0 && !t.isMerged;
const isOldDebt = t.transactionType === 'OLD_DEBT';
if (t.isMerged) {

const mergedSettled = t.creditReceived || (t.isMerged && effectiveDue <= 0.01);
toggleBtnHtml = mergedSettled
? `<span class="status-toggle-btn paid" style="opacity:0.8;">SETTLED</span>`
: `<span class="status-toggle-btn pending" style="opacity:0.8;">PENDING</span>`;
} else if(isCredit) {
if (hasPartialPayment) {
const remaining = effectiveDue;
btnText = `PARTIAL (${await formatCurrency(remaining)} due)`;
statusClass = 'partial';
}
toggleBtnHtml = `<button class="status-toggle-btn ${statusClass}" onclick="toggleSingleTransactionStatus('${t.id}')">${btnText}</button>`;
} else if (isPartialPayment) {
toggleBtnHtml = `<span class="status-toggle-btn" style="background:rgba(255, 159, 10, 0.1); color:var(--warning);">PARTIAL PAYMENT</span>`;
} else if (isCollection) {
toggleBtnHtml = `<span class="status-toggle-btn" style="background:rgba(48, 209, 88, 0.1); color:var(--accent-emerald);">COLLECTION</span>`;
} else {
toggleBtnHtml = `<span class="status-toggle-btn" style="background:rgba(37, 99, 235, 0.1); color:var(--accent);">CASH SALE</span>`;
}
const deleteBtnHtml = t.isMerged ? '' : `<button class="btn btn-sm btn-danger u-p-4-8" onclick="deleteTransactionFromOverlay('${esc(t.id)}')">⌫</button>`;
let itemContent = '';
if (isPartialPayment || isCollection) {
itemContent = `
<div class="cust-history-info">
<div class="u-mono-bold" >${formatDisplayDate(t.date)}${_mergedBadgeHtml(t, {inline:true})}</div>
<div style="font-size:0.75rem; color:var(--accent-emerald);">
Payment: ${await formatCurrency(t.totalValue)}
</div>
<div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">
${isPartialPayment ? 'Partial Payment' : 'Bulk Payment'}
</div>
</div>
<div class="cust-history-actions">
${toggleBtnHtml}
${deleteBtnHtml}
</div>
`;
} else if (isOldDebt) {
itemContent = `
<div class="cust-history-info">
<div class="u-mono-bold" >
${formatDisplayDate(t.date)}
<span style="background:rgba(255, 159, 10, 0.15); color:var(--warning); padding:2px 6px; border-radius:4px; font-size:0.65rem; margin-left:6px; font-weight:600;">OLD DEBT</span>${_mergedBadgeHtml(t, {inline:true})}
</div>
<div style="font-size:0.75rem; color:var(--warning);">
Previous Balance: ${await formatCurrency(t.totalValue)}
</div>
<div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">
${esc(t.notes || 'Brought forward from previous records')}
</div>
</div>
<div class="cust-history-actions">
${toggleBtnHtml}
${deleteBtnHtml}
</div>
`;
} else {
// Canonical sale price: use stored unitPrice (set on merge) or the fixed
// getSalePriceForStore rate for the supply store — never divide totalValue/quantity
// which produces a weighted average and can differ after partial payments.
const _displayUnitPrice = (t.unitPrice && t.unitPrice > 0)
  ? t.unitPrice
  : getSalePriceForStore(t.supplyStore || 'STORE_A');
itemContent = `
<div class="cust-history-info">
<div class="u-mono-bold" >${formatDisplayDate(t.date)}${_mergedBadgeHtml(t, {inline:true})}</div>
<div class="u-fs-sm2 u-text-muted" >
${t.quantity.toFixed(2)} kg @ ${await formatCurrency(_displayUnitPrice)}
</div>
${hasPartialPayment ? `<div style="font-size:0.7rem; color:var(--accent-emerald); margin-top:2px;">Paid: ${await formatCurrency(partialPaid)}</div>` : ''}
<div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">
${getStoreLabel(t.supplyStore)}
</div>
</div>
<div class="cust-history-actions">
${toggleBtnHtml}
${deleteBtnHtml}
</div>
`;
}
item.innerHTML = itemContent;
list.appendChild(item);
}
}
async function toggleSingleTransactionStatus(id) {
const record = customerSales.find(s => s.id === id);
if (record?.isMerged) {
showToast('Opening balance records cannot be toggled. Use Bulk Payment to settle.', 'warning', 4000);
return;
}
const snapshot = [...customerSales];
try {
const idx = customerSales.findIndex(s => s.id === id);
if (idx !== -1) {
customerSales[idx].creditReceived = !customerSales[idx].creditReceived;
customerSales[idx].updatedAt = getTimestamp();
await unifiedSave('customer_sales', customerSales, customerSales[idx]);
notifyDataChange('sales');
triggerAutoSync();
renderCustomerTransactions(currentManagingCustomer);
refreshAllCalculations();
}
} catch (e) {
customerSales.length = 0; customerSales.push(...snapshot);
await idb.set('customer_sales', customerSales).catch(() => {});
showToast('Failed to update transaction status. Please try again.', 'error');
}
}
async function toggleRepTransactionStatus(id) {
const record = repSales.find(s => s.id === id);
if (record?.isMerged) {
showToast('Opening balance records cannot be toggled. Use Bulk Payment to settle.', 'warning', 4000);
return;
}
const snapshot = [...repSales];
try {
const idx = repSales.findIndex(s => s.id === id);
if (idx !== -1) {

repSales[idx].creditReceived = !repSales[idx].creditReceived;
repSales[idx].updatedAt = getTimestamp();
await unifiedSave('rep_sales', repSales, repSales[idx]);
notifyDataChange('rep');
triggerAutoSync();
renderRepCustomerTransactions(currentManagingRepCustomer);
}
} catch (e) {
repSales.length = 0; repSales.push(...snapshot);
await idb.set('rep_sales', repSales).catch(() => {});
showToast('Failed to update transaction status. Please try again.', 'error');
}
}
async function deleteTransactionFromOverlay(id) {
const _txItem = customerSales.find(s => s.id === id);
if (_txItem?.isMerged) {
showToast('Merged opening balance records cannot be deleted', 'warning');
return;
}
const _isOldDebt = _txItem?.transactionType === 'OLD_DEBT';
const _txType = _isOldDebt ? 'Old Debt Record' : _txItem ? (_txItem.paymentType === 'CREDIT' ? 'Credit Sale' : _txItem.paymentType === 'PARTIAL_PAYMENT' ? 'Partial Payment' : _txItem.paymentType === 'COLLECTION' ? 'Collection' : 'Cash Sale') : 'Transaction';
const _txDate = _txItem ? (_txItem.date || 'Unknown date') : '';
const _txQty = _txItem ? ((_txItem.quantity || 0) > 0 ? `${_txItem.quantity} kg` : '') : '';
const _txAmt = _txItem ? ((_txItem.totalValue || 0) > 0 ? ` — ${fmtAmt(_txItem.totalValue||0)}` : '') : '';
const _txCust = _txItem ? (_txItem.customerName || '') : '';
const _txStore = _txItem?.supplyStore ? getStoreLabel(_txItem.supplyStore) : '';
const _partialPaid = _txItem?.partialPaymentReceived || 0;
let _txMsg, _txTitle;
if (_isOldDebt) {
_txTitle = '\u26a0 Delete Old Debt Record';
_txMsg = `You are about to permanently delete an OLD DEBT record for ${_txCust || 'this customer'}.`;
_txMsg += `\nBalance: ${fmtAmt(_txItem.totalValue||0)}`;
if (_txDate) _txMsg += `\nRecorded: ${_txDate}`;
if (_txItem?.notes) _txMsg += `\nNote: ${_txItem.notes}`;
_txMsg += `\n\n\u26a0 Warning: This will remove the carried-forward balance from the customer's history. If this debt is still owed, deleting it will make it disappear from all records and reports permanently.`;
_txMsg += `\n\nOnly delete if this was entered by mistake or has already been fully settled elsewhere.`;
} else if (_txItem?.paymentType === 'COLLECTION') {
_txTitle = 'Delete Bulk Collection';
_txMsg = `Delete this bulk collection payment from ${_txCust || 'customer'}?`;
if (_txDate) _txMsg += `\nDate: ${_txDate}`;
_txMsg += `\nAmount Collected: ${fmtAmt(_txItem.totalValue||0)}`;
_txMsg += `\n\n\u21a9 This collection will be reversed and the customer's outstanding balance restored accordingly.`;
} else if (_txItem?.paymentType === 'PARTIAL_PAYMENT') {
_txTitle = 'Delete Partial Payment';
_txMsg = `Delete this partial payment from ${_txCust || 'customer'}?`;
if (_txDate) _txMsg += `\nDate: ${_txDate}`;
_txMsg += `\nPayment Amount: ${fmtAmt(_txItem.totalValue||0)}`;
_txMsg += `\n\n\u21a9 This will reverse the partial payment and restore the full pending credit balance on the linked sale.`;
} else if (_txItem?.paymentType === 'CREDIT') {
_txTitle = 'Delete Credit Sale';
_txMsg = `Delete this credit sale for ${_txCust || 'customer'}?`;
if (_txDate) _txMsg += `\nDate: ${_txDate}`;
if (_txQty) _txMsg += `\nQty: ${_txQty}${_txAmt}`;
if (_txStore) _txMsg += `\nStore: ${_txStore}`;
if (_partialPaid > 0) _txMsg += `\n\n\u26a0 ${fmtAmt(_partialPaid)} has been partially collected. Deleting will erase both the sale and the partial payment record.`;
else if (_txItem?.creditReceived) _txMsg += `\n\n\u26a0 This sale is already marked PAID. Deleting will remove the payment record.`;
else _txMsg += `\n\n\u26a0 This credit sale is UNPAID. Deleting will permanently remove the outstanding balance from this customer's account.`;
} else {
_txTitle = 'Delete Cash Sale';
_txMsg = `Delete this cash sale for ${_txCust || 'customer'}?`;
if (_txDate) _txMsg += `\nDate: ${_txDate}`;
if (_txQty) _txMsg += `\nQty: ${_txQty}${_txAmt}`;
if (_txStore) _txMsg += `\nStore: ${_txStore}`;
_txMsg += `\n\n\u21a9 ${(_txItem?.quantity||0).toFixed(2)} kg will be restored to inventory.`;
}
_txMsg += `\n\nThis cannot be undone.`;
if (!(await showGlassConfirm(_txMsg, { title: _txTitle || `Delete ${_txType}`, confirmText: 'Delete', danger: true }))) return;
try {
const item = customerSales.find(s => s.id === id);
if (!item) { renderCustomerTransactions(currentManagingCustomer); return; }
const wasCredit = item.paymentType === 'CREDIT';
const wasPartialPayment = item.paymentType === 'PARTIAL_PAYMENT';
const wasCollection = item.paymentType === 'COLLECTION';
const paymentAmount = item.totalValue || 0;
if (wasPartialPayment && item.relatedSaleId) {
const rel = customerSales.find(s => s.id === item.relatedSaleId);
if (rel) {
rel.partialPaymentReceived = Math.max(0, (rel.partialPaymentReceived || 0) - paymentAmount);
if (rel.partialPaymentReceived === 0) { rel.creditReceived = false; delete rel.creditReceivedDate; }
rel.updatedAt = getTimestamp();
}
}
await registerDeletion(id, 'sales');
customerSales = customerSales.filter(s => s.id !== id);
await unifiedDelete('customer_sales', customerSales, id);
renderCustomerTransactions(currentManagingCustomer);
refreshAllCalculations();
if (typeof refreshCustomerSales === 'function') await refreshCustomerSales();
renderCustomersTable();
notifyDataChange('sales');
triggerAutoSync();
let msg = ` ${wasPartialPayment ? 'Payment' : wasCollection ? 'Collection' : 'Transaction'} deleted!`;
if ((item.quantity || 0) > 0) msg += ` ${item.quantity} kg restored.`;
if ((wasPartialPayment || wasCollection || (wasCredit && item.partialPaymentReceived > 0)) && paymentAmount > 0) {
const ref = wasCredit ? (item.partialPaymentReceived || 0) : paymentAmount;
if (ref > 0) msg += ` Payment of ${await formatCurrency(ref)} reversed.`;
}
showToast(msg, 'success');
} catch (e) {
showToast('Failed to delete transaction. Please try again.', 'error');
}
}
async function deleteRepTransactionFromOverlay(id) {
const _rItem = repSales.find(s => s.id === id);
if (_rItem?.isMerged) {
showToast('Merged opening balance records cannot be deleted', 'warning');
return;
}
const _rIsOldDebt = _rItem?.transactionType === 'OLD_DEBT';
const _rType = _rIsOldDebt ? 'Old Debt Record' : _rItem ? (_rItem.paymentType === 'CREDIT' ? 'Credit Sale' : _rItem.paymentType === 'PARTIAL_PAYMENT' ? 'Partial Payment' : _rItem.paymentType === 'COLLECTION' ? 'Collection' : 'Cash Sale') : 'Transaction';
const _rDate = _rItem ? (_rItem.date || 'Unknown date') : '';
const _rQty = _rItem ? ((_rItem.quantity || 0) > 0 ? `${_rItem.quantity} kg` : '') : '';
const _rAmt = _rItem ? ((_rItem.totalValue || 0) > 0 ? ` — ${fmtAmt(_rItem.totalValue||0)}` : '') : '';
const _rCust = _rItem ? (_rItem.customerName || '') : '';
const _rRep = _rItem?.salesRep || '';
const _rPartialPaid = _rItem?.partialPaymentReceived || 0;
let _rMsg, _rTitle;
if (_rIsOldDebt) {
_rTitle = '\u26a0 Delete Old Debt Record';
_rMsg = `Permanently delete an OLD DEBT record for ${_rCust || 'this customer'}${_rRep ? ` (Rep: ${_rRep})` : ''}.`;
_rMsg += `\nBalance: ${fmtAmt(_rItem.totalValue||0)}`;
if (_rDate) _rMsg += `\nRecorded: ${_rDate}`;
if (_rItem?.notes) _rMsg += `\nNote: ${_rItem.notes}`;
_rMsg += `\n\n\u26a0 Warning: This will remove the carried-forward balance from the rep customer's history permanently.`;
_rMsg += `\n\nOnly delete if this was entered by mistake or has already been fully settled elsewhere.`;
} else if (_rItem?.paymentType === 'COLLECTION') {
_rTitle = 'Delete Rep Collection';
_rMsg = `Delete this bulk collection from ${_rCust || 'customer'}${_rRep ? ` (Rep: ${_rRep})` : ''}?`;
if (_rDate) _rMsg += `\nDate: ${_rDate}`;
_rMsg += `\nAmount Collected: ${fmtAmt(_rItem.totalValue||0)}`;
_rMsg += `\n\n\u21a9 This collection will be reversed and the customer's outstanding rep balance restored.`;
} else if (_rItem?.paymentType === 'PARTIAL_PAYMENT') {
_rTitle = 'Delete Rep Partial Payment';
_rMsg = `Delete this partial payment from ${_rCust || 'customer'}${_rRep ? ` (Rep: ${_rRep})` : ''}?`;
if (_rDate) _rMsg += `\nDate: ${_rDate}`;
_rMsg += `\nPayment Amount: ${fmtAmt(_rItem.totalValue||0)}`;
_rMsg += `\n\n\u21a9 This will reverse the partial payment and restore the full pending credit balance on the linked rep sale.`;
} else if (_rItem?.paymentType === 'CREDIT') {
_rTitle = 'Delete Rep Credit Sale';
_rMsg = `Delete this credit sale for ${_rCust || 'customer'}${_rRep ? ` (Rep: ${_rRep})` : ''}?`;
if (_rDate) _rMsg += `\nDate: ${_rDate}`;
if (_rQty) _rMsg += `\nQty: ${_rQty}${_rAmt}`;
if (_rPartialPaid > 0) _rMsg += `\n\n\u26a0 ${fmtAmt(_rPartialPaid)} has already been partially collected. Deleting will erase both the sale and the partial payment record.`;
else if (_rItem?.creditReceived) _rMsg += `\n\n\u26a0 This rep sale is already marked PAID. Deleting will remove the payment record.`;
else _rMsg += `\n\n\u26a0 This rep credit sale is UNPAID. Deleting will remove the outstanding balance from the rep customer's account.`;
} else {
_rTitle = 'Delete Rep Cash Sale';
_rMsg = `Delete this cash sale for ${_rCust || 'customer'}${_rRep ? ` (Rep: ${_rRep})` : ''}?`;
if (_rDate) _rMsg += `\nDate: ${_rDate}`;
if (_rQty) _rMsg += `\nQty: ${_rQty}${_rAmt}`;
_rMsg += `\n\n\u21a9 ${(_rItem?.quantity||0).toFixed(2)} kg will be restored to inventory.`;
}
_rMsg += `\n\nThis cannot be undone.`;
if (!(await showGlassConfirm(_rMsg, { title: _rTitle || `Delete ${_rType}`, confirmText: 'Delete', danger: true }))) return;
try {
const item = repSales.find(s => s.id === id);
if (!item) { renderRepCustomerTransactions(currentManagingRepCustomer); return; }
const wasCredit = item.paymentType === 'CREDIT';
const wasPartialPayment = item.paymentType === 'PARTIAL_PAYMENT';
const wasCollection = item.paymentType === 'COLLECTION';
const paymentAmount = item.totalValue || 0;
if (wasPartialPayment && item.relatedSaleId) {
const rel = repSales.find(s => s.id === item.relatedSaleId);
if (rel) {
rel.partialPaymentReceived = Math.max(0, (rel.partialPaymentReceived || 0) - paymentAmount);
if (rel.partialPaymentReceived === 0) { rel.creditReceived = false; delete rel.creditReceivedDate; }
rel.updatedAt = getTimestamp();
}
}
await registerDeletion(id, 'rep_sales');
repSales = repSales.filter(s => s.id !== id);
await unifiedDelete('rep_sales', repSales, id);
renderRepCustomerTransactions(currentManagingRepCustomer);
renderRepCustomerTable();
notifyDataChange('rep');
triggerAutoSync();
let msg = ` ${wasPartialPayment ? 'Payment' : wasCollection ? 'Collection' : 'Transaction'} deleted!`;
if ((wasPartialPayment || wasCollection || (wasCredit && item.partialPaymentReceived > 0)) && paymentAmount > 0) {
const ref = wasCredit ? (item.partialPaymentReceived || 0) : paymentAmount;
if (ref > 0) msg += ` Payment of ${await formatCurrency(ref)} reversed.`;
}
showToast(msg, 'success');
} catch (e) {
showToast('Failed to delete transaction. Please try again.', 'error');
}
}
async function processBulkPayment() {
const amount = parseFloat(document.getElementById('bulkPaymentAmount').value);
if (!amount || amount <= 0) { showToast('Please enter a valid amount', 'warning', 3000); return; }
const snapshot = [...customerSales];
try {
let remaining = amount, updatedCount = 0, partialPaymentMade = false;
const pending = customerSales.filter(s =>
s.customerName === currentManagingCustomer &&
s.isRepModeEntry !== true &&
(!s.salesRep || s.salesRep === 'NONE') &&
s.paymentType === 'CREDIT' && !s.creditReceived
).sort((a, b) => a.timestamp - b.timestamp);
if (pending.length === 0) { showToast('No pending credit transactions found for this customer.', 'info', 4000); return; }
const nowDate = new Date();
const nowISODate = nowDate.toISOString().split('T')[0];
const nowTime = nowDate.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
const nowEpoch = getTimestamp();
for (const sale of pending) {
if (remaining <= 0) break;
const amountDue = sale.isMerged && typeof sale.creditValue === 'number'
? sale.creditValue
: (sale.totalValue || 0) - (sale.partialPaymentReceived || 0);
if (remaining >= amountDue) {
sale.creditReceived = true;
sale.creditReceivedDate = nowISODate;
if (!sale.isMerged) sale.partialPaymentReceived = sale.totalValue;
sale.updatedAt = nowEpoch;
remaining -= amountDue; updatedCount++;
} else {
if (!sale.isMerged) {
sale.partialPaymentReceived = (sale.partialPaymentReceived || 0) + remaining;
sale.creditReceived = false; sale.updatedAt = nowEpoch;
}
const partialId = generateUUID('pay-partial');
customerSales.push(ensureRecordIntegrity({
id: partialId, timestamp: nowEpoch, createdAt: nowEpoch, updatedAt: nowEpoch,
date: nowISODate, time: nowTime,
customerName: currentManagingCustomer, customerPhone: sale.customerPhone || '', quantity: 0,
supplyStore: sale.supplyStore || 'STORE_A', paymentType: 'PARTIAL_PAYMENT', salesRep: 'NONE',
totalCost: 0, totalValue: remaining, profit: 0, creditReceived: true,
relatedSaleId: sale.id, syncedAt: new Date().toISOString(), isRepModeEntry: false
}, false, false));
partialPaymentMade = true; remaining = 0; updatedCount++; break;
}
}
if (remaining > 0 && updatedCount > 0) {
const ls = pending[pending.length - 1];
const collId = generateUUID('pay-coll');
customerSales.push(ensureRecordIntegrity({
id: collId, timestamp: nowEpoch, createdAt: nowEpoch, updatedAt: nowEpoch,
date: nowISODate, time: nowTime,
customerName: currentManagingCustomer, customerPhone: ls?.customerPhone || '', quantity: 0,
supplyStore: ls?.supplyStore || 'STORE_A', paymentType: 'COLLECTION', salesRep: 'NONE',
totalCost: 0, totalValue: remaining, profit: 0, creditReceived: true,
syncedAt: new Date().toISOString(), isRepModeEntry: false
}, false, false));
}
if (updatedCount > 0 || partialPaymentMade) {
await saveWithTracking('customer_sales', customerSales);
const changedIds = new Set(pending.map(s => s.id));
for (const sale of customerSales) {
if (changedIds.has(sale.id) || sale.paymentType === 'PARTIAL_PAYMENT' || sale.paymentType === 'COLLECTION') {
await saveRecordToFirestore('customer_sales', sale);
}
}
notifyDataChange('sales'); triggerAutoSync();
let msg = `Payment of ${fmtAmt(amount)} processed successfully. `;
msg += partialPaymentMade ? 'Partial payment applied.' : remaining === 0 ? `${updatedCount} transaction(s) fully cleared.` : `${updatedCount} cleared, ${fmtAmt(remaining)} extra.`;
showToast(msg, 'info', 5000);
document.getElementById('bulkPaymentAmount').value = '';
renderCustomerTransactions(currentManagingCustomer);
refreshAllCalculations();
} else { showToast('No changes made.', 'info', 2500); }
} catch (e) {
customerSales.length = 0; customerSales.push(...snapshot);
await idb.set('customer_sales', customerSales).catch(() => {});
showToast('Failed to process bulk payment. Please try again.', 'error');
}
}
function filterCustomerManagementHistory() {
const term = document.getElementById('cust-trans-search').value.toLowerCase();
document.querySelectorAll('#customerManagementHistoryList .cust-history-item').forEach(item => {
item.style.display = item.innerText.toLowerCase().includes(term) ? 'flex' : 'none';
});
}
async function processRepBulkPayment() {
const amount = parseFloat(document.getElementById('repBulkPaymentAmount').value);
if (!amount || amount <= 0) { showToast('Please enter a valid amount', 'warning', 3000); return; }
const snapshot = [...repSales];
try {
let remaining = amount, updatedCount = 0, partialPaymentMade = false;
const pending = repSales.filter(s =>
s.customerName === currentManagingRepCustomer &&
s.salesRep === currentRepProfile &&
s.paymentType === 'CREDIT' && !s.creditReceived
).sort((a, b) => a.timestamp - b.timestamp);
if (pending.length === 0) { showToast('No pending credit transactions found for this customer.', 'info', 4000); return; }
const nowDate = new Date();
const nowISODate = nowDate.toISOString().split('T')[0];
const nowTime = nowDate.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
const nowEpoch = getTimestamp();
for (const sale of pending) {
if (remaining <= 0) break;
const amountDue = sale.isMerged && typeof sale.creditValue === 'number'
? sale.creditValue
: (sale.totalValue || 0) - (sale.partialPaymentReceived || 0);
if (remaining >= amountDue) {
sale.creditReceived = true;
sale.creditReceivedDate = nowISODate;
if (!sale.isMerged) sale.partialPaymentReceived = sale.totalValue;
sale.updatedAt = nowEpoch;
remaining -= amountDue; updatedCount++;
} else {
if (!sale.isMerged) {
sale.partialPaymentReceived = (sale.partialPaymentReceived || 0) + remaining;
sale.creditReceived = false; sale.updatedAt = nowEpoch;
}
const partialId = generateUUID('rep-partial');
repSales.push(ensureRecordIntegrity({
id: partialId, timestamp: nowEpoch, createdAt: nowEpoch, updatedAt: nowEpoch,
date: nowISODate, time: nowTime,
customerName: currentManagingRepCustomer, customerPhone: sale.customerPhone || '', quantity: 0,
supplyStore: sale.supplyStore || 'STORE_A', paymentType: 'PARTIAL_PAYMENT', salesRep: currentRepProfile,
totalCost: 0, totalValue: remaining, profit: 0, creditReceived: true,
relatedSaleId: sale.id, syncedAt: new Date().toISOString(), isRepModeEntry: true
}, false, false));
partialPaymentMade = true; remaining = 0; updatedCount++; break;
}
}
if (remaining > 0 && updatedCount > 0) {
const ls = pending[pending.length - 1];
const collId = generateUUID('rep-coll');
repSales.push(ensureRecordIntegrity({
id: collId, timestamp: nowEpoch, createdAt: nowEpoch, updatedAt: nowEpoch,
date: nowISODate, time: nowTime,
customerName: currentManagingRepCustomer, customerPhone: ls?.customerPhone || '', quantity: 0,
supplyStore: ls?.supplyStore || 'STORE_A', paymentType: 'COLLECTION', salesRep: currentRepProfile,
totalCost: 0, totalValue: remaining, profit: 0, creditReceived: true,
syncedAt: new Date().toISOString(), isRepModeEntry: true
}, false, false));
}
if (updatedCount > 0 || partialPaymentMade) {
await saveWithTracking('rep_sales', repSales);
const changedIds = new Set(pending.map(s => s.id));
for (const sale of repSales) {
if (changedIds.has(sale.id) || sale.paymentType === 'PARTIAL_PAYMENT' || sale.paymentType === 'COLLECTION') {
await saveRecordToFirestore('rep_sales', sale);
}
}
notifyDataChange('rep'); triggerAutoSync();
let msg = `Payment of ${fmtAmt(amount)} processed successfully. `;
msg += partialPaymentMade ? 'Partial payment applied.' : remaining === 0 ? `${updatedCount} transaction(s) fully cleared.` : `${updatedCount} cleared, ${fmtAmt(remaining)} extra.`;
showToast(msg, 'info', 5000);
document.getElementById('repBulkPaymentAmount').value = '';
renderRepCustomerTransactions(currentManagingRepCustomer);
renderRepCustomerTable();
} else { showToast('No changes made.', 'info', 2500); }
} catch (e) {
repSales.length = 0; repSales.push(...snapshot);
await idb.set('rep_sales', repSales).catch(() => {});
showToast('Failed to process bulk payment. Please try again.', 'error');
}
}
function filterRepCustomerManagementHistory() {
const term = document.getElementById('rep-cust-trans-search').value.toLowerCase();
document.querySelectorAll('#repCustomerManagementHistoryList .cust-history-item').forEach(item => {
item.style.display = item.innerText.toLowerCase().includes(term) ? 'flex' : 'none';
});
}
function refreshAllCalculations() {
calculateCashTracker();
calculateNetCash();
calculatePaymentSummaries();
refreshEntityBalances();
updateUnitsAvailableIndicator();
}
const toastContainer = document.createElement('div');
toastContainer.className = 'toast-container';
document.body.appendChild(toastContainer);
// Re-insert as last child of body each time a toast is shown so it always
// sits above every overlay, modal, or stacking-context element added later.
function _ensureToastOnTop() {
  if (document.body.lastElementChild !== toastContainer) {
    document.body.appendChild(toastContainer);
  }
}
const _toastQueue = [];
let _toastActive = false;
function _playNextToast() {
if (_toastActive || _toastQueue.length === 0) return;
_toastActive = true;
const { message, type, duration } = _toastQueue.shift();
const icons = {
success: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
warning: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
error: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
info: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
};
const msgStr = String(message);
// Allow wrapping for longer messages, single line for short
const isLong = msgStr.length > 48;
const toast = document.createElement('div');
toast.className = `liquid-toast toast-${type}`;
toast.innerHTML = `
<div class="toast-inner" style="${isLong ? 'white-space:normal;' : ''}">
<div class="toast-icon-wrap">
<span class="toast-icon-glyph">${icons[type] || ''}</span>
</div>
<div class="toast-text" style="${isLong ? 'white-space:normal;max-width:260px;' : ''}">${esc(msgStr)}</div>
<div class="toast-progress-bar"></div>
</div>
`;
toast.classList.add('pre-show');
_ensureToastOnTop();
toastContainer.appendChild(toast);
requestAnimationFrame(() => {
requestAnimationFrame(() => {
toast.classList.remove('pre-show');
toast.classList.add('show');
const bar = toast.querySelector('.toast-progress-bar');
if (bar) {
bar.style.animationDuration = duration + 'ms';
bar.classList.add('animating');
}
});
});
let removed = false;
const dismiss = () => {
if (removed) return;
removed = true;
toast.classList.add('hiding');
toast.style.pointerEvents = 'none';
setTimeout(() => {
if (toast.parentNode === toastContainer) toastContainer.removeChild(toast);
_toastActive = false;
_playNextToast();
}, 350);
};
setTimeout(dismiss, duration);
toast.addEventListener('click', dismiss, { once: true });
}
function showToast(message, type = 'info', duration = 3000) {
const typeMap = { danger: 'error', warn: 'warning', ok: 'success' };
type = typeMap[type] || (['success','warning','error','info'].includes(type) ? type : 'info');
_toastQueue.push({ message, type, duration });
_playNextToast();
}
window.showToast = showToast;
function showGlassConfirm(message, {
title = 'Confirm',
confirmText = 'Confirm',
cancelText = 'Cancel',
danger = false,
icon = null
} = {}) {
return new Promise(resolve => {
const autoIcon = icon !== null ? icon
: danger ? '' : '●';
const iconClass = danger ? 'icon-danger' : 'icon-primary';
const backdrop = document.createElement('div');
backdrop.className = 'glass-confirm-backdrop';
backdrop.innerHTML = `
<div class="glass-confirm-box${danger ? ' is-danger' : ''}">
<div class="glass-confirm-icon ${iconClass}">${autoIcon}</div>
<div class="glass-confirm-title">${esc(title)}</div>
<div class="glass-confirm-msg">${esc(String(message)).replace(/\n/g, '<br>')}</div>
<div class="glass-confirm-divider"></div>
<div class="glass-confirm-btns">
<button class="glass-confirm-btn gc-cancel">${esc(cancelText)}</button>
<button class="glass-confirm-btn ${danger ? 'danger' : 'primary'} gc-confirm">${esc(confirmText)}</button>
</div>
</div>
`;
document.body.appendChild(backdrop);
let settled = false;
const cleanup = (result) => {
if (settled) return;
settled = true;
const box = backdrop.querySelector('.glass-confirm-box');
backdrop.classList.add('closing');
if (box) box.classList.add('closing');
setTimeout(() => { backdrop.remove(); resolve(result); }, 200);
};
backdrop.querySelector('.gc-confirm').addEventListener('click', () => cleanup(true), { once: true });
backdrop.querySelector('.gc-cancel').addEventListener('click', () => cleanup(false), { once: true });
backdrop.addEventListener('click', e => { if (e.target === backdrop) cleanup(false); });
const onKey = (e) => {
if (e.key === 'Enter') { e.preventDefault(); cleanup(true); }
if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
};
document.addEventListener('keydown', onKey);
backdrop.addEventListener('animationend', () => {
if (!backdrop.isConnected) document.removeEventListener('keydown', onKey);
});
setTimeout(() => {
const btn = backdrop.querySelector('.gc-confirm');
if (btn) btn.focus();
}, 60);
});
}
window.showGlassConfirm = showGlassConfirm;
function filterCustomers() {
// Re-render through the virtual scroller so it applies to
// the full dataset, not just currently-visible DOM rows.
renderCustomersTable();
}
async function openDataMenu() {
if (appMode === 'rep') {
return;
}
const adminSection = document.getElementById('admin-controls-section');
if (adminSection) {
adminSection.style.display = 'block';
}
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
_meta: { encryptedFor: currentUser.email, createdAt: Date.now(), version: 2 },
backupMetadata: {
version: '2.0',
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
console.error('Encryption failed:', encErr);
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
invSnap, factSnap, retSnap, settingsSnap, factorySettingsSnap,
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
userRef.collection('settings').doc('config').get(),
userRef.collection('factorySettings').doc('config').get(),
userRef.collection('expenseCategories').doc('categories').get(),
userRef.collection('deletions').get()
]);
for (const collection of ['production', 'sales', 'calculator_history', 'rep_sales', 'transactions',
'entities', 'inventory', 'factory_history', 'returns']) {
await DeltaSync.setLastSyncTimestamp(collection);
}
const cloudData = {
mfg_pro_pkr: prodSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
customer_sales: salesSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
noman_history: calcSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
rep_sales: repSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
payment_transactions: transSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
payment_entities: entSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
factory_inventory_data: invSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
factory_production_history: factSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
stock_returns: retSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() }))
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
const fileTime = item.timestamp || new Date(item.date || 0).getTime() || 0;
const cloudTime = existing.timestamp || new Date(existing.date || 0).getTime() || 0;
if (fileTime >= cloudTime) {
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
'sales': merged.customer_sales,
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
// Commit batches one at a time, yielding to the browser between each
// so the UI stays smooth even with hundreds of records.
for (let _bi = 0; _bi < batches.length; _bi++) {
	await batches[_bi].commit();
	if (batches.length > 1) {
		showToast('Uploading... ' + (_bi + 1) + ' / ' + batches.length + ' batches', 'info');
	}
	await new Promise(r => setTimeout(r, 0)); // yield to browser
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
console.error('Failed to save data locally.', err);
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
async function enableBiometricLock() {
try {
const success = await BiometricAuth.register("Manager");
if(success) {
showToast("Biometric Lock Enabled! ", "success");
const _bioBtn = document.getElementById('bio-toggle-btn');
if (_bioBtn) { _bioBtn.innerText = "Disable Biometric Lock"; _bioBtn.onclick = disableBiometricLock; }
}
} catch (e) {
showToast("Setup failed: " + e.message, "error");
}
}
async function disableBiometricLock() {
const _bioMsg = `Remove the biometric (fingerprint / Face ID) lock from this app?\n\nAfter removal:\n • Anyone with access to this device can open the app without biometric verification\n • To re-enable, go to Security Settings and set up biometrics again\n\nYour data will not be affected.`;
if (await showGlassConfirm(_bioMsg, { title: "Remove Biometric Lock", confirmText: "Remove Lock", danger: true })) {
await idb.remove('bio_enabled');
await idb.remove('bio_cred_id');
showToast("Biometric Lock Removed", "info");
const _bioBtnD = document.getElementById('bio-toggle-btn');
if (_bioBtnD) _bioBtnD.innerText = "Enable Biometric Lock ";
document.getElementById('bio-toggle-btn').onclick = enableBiometricLock;
}
}
async function checkBiometricLock() {
const isEnabled = await idb.get('bio_enabled');
if (isEnabled === 'true' || isEnabled === true) {
const lockScreen = document.createElement('div');
lockScreen.id = 'app-lock-screen';
lockScreen.style.cssText = `
position: fixed; inset: 0;
background: var(--bg-gradient); z-index: 100000;
display: flex; flex-direction: column; align-items: center; justify-content: center;
`;
lockScreen.innerHTML = `
<div style="font-size: 3rem; margin-bottom: 20px;">※</div>
<h2 style="color: var(--text-main); margin-bottom: 10px;">Security Locked</h2>
<p style="color: var(--text-muted); font-size: 0.9rem;">Biometric authentication required</p>
<button class="btn btn-main" style="margin-top: 25px; padding: 12px 30px;" onclick="triggerUnlock()">
Unlock App
</button>
`;
document.body.appendChild(lockScreen);
window.triggerUnlock = async () => {
try {
const success = await BiometricAuth.authenticate();
if (success) {
const screen = document.getElementById('app-lock-screen');
if(screen) screen.remove();
showToast("Unlocked Successfully", "success");
} else {
showToast("Authentication Failed. Try again.", "error");
}
} catch (e) {
showToast("Biometric Error: " + e.message, "error");
}
};
setTimeout(() => window.triggerUnlock(), 500);
}
}
let repTransactionMode = 'sale';
async function setRepMode(mode) {
repTransactionMode = mode;
const _setRep = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
const _btnSale = document.getElementById('btn-mode-sale'); if (_btnSale) _btnSale.className = `toggle-opt ${mode === 'sale' ? 'active' : ''}`;
const _btnColl = document.getElementById('btn-mode-coll'); if (_btnColl) _btnColl.className = `toggle-opt ${mode === 'collection' ? 'active' : ''}`;
if(mode === 'sale') {
const _saleIn = document.getElementById('rep-sale-inputs'); if (_saleIn) _saleIn.classList.remove('hidden');
const _collIn = document.getElementById('rep-coll-inputs'); if (_collIn) _collIn.classList.add('hidden');
_setRep('rep-result-label', "Total Sale Value:");
calculateRepSalePreview();
} else {
const _saleIn2 = document.getElementById('rep-sale-inputs'); if (_saleIn2) _saleIn2.classList.add('hidden');
const _collIn2 = document.getElementById('rep-coll-inputs'); if (_collIn2) _collIn2.classList.remove('hidden');
_setRep('rep-result-label', "New Balance After Collection:");
const _credEl = document.getElementById('rep-customer-current-credit');
const currentDebtText = _credEl ? _credEl.innerText.replace('₨','').replace(/,/g,'') : '0';
const currentDebt = parseFloat(currentDebtText) || 0;
const formattedDebt = await formatCurrency(currentDebt);
_setRep('rep-total-value', formattedDebt);
}
}
function selectRepCustomer(name) {
document.getElementById('rep-cust-name').value = name;
document.getElementById('rep-customer-search-results').classList.add('hidden');
calculateRepCustomerStats(name);
}
function calculateRepCustomerStatsForDisplay(name) {
calculateRepCustomerStats(name);
}
function calculateRepCustomerStats(name) {
if(salesRepsList.includes(name)) {
document.getElementById('rep-customer-info-display').classList.add('hidden');
showToast("Cannot create transaction with representative name", "warning");
return;
}
const history = repSales.filter(s =>
s && s.customerName && s.customerName.toLowerCase() === name.toLowerCase() &&
s.salesRep === currentRepProfile
);
let debt = 0;
history.forEach(h => {
if (h.transactionType === 'OLD_DEBT') {
// OLD_DEBT: outstanding = totalValue minus any partial payments already applied
if (!h.creditReceived) {
const partialPaid = h.partialPaymentReceived || 0;
debt += ((h.totalValue || 0) - partialPaid);
}
} else if (h.paymentType === 'CREDIT' && !h.creditReceived) {
if (h.isMerged && typeof h.creditValue === 'number') {
debt += h.creditValue;
} else {
const partialPaid = h.partialPaymentReceived || 0;
debt += ((h.totalValue || 0) - partialPaid);
}
} else if (h.paymentType === 'COLLECTION') {
debt -= (h.totalValue || 0);
} else if (h.paymentType === 'PARTIAL_PAYMENT') {
debt -= (h.totalValue || 0);
}
});
// Clamp to zero — negative means overpaid
debt = Math.max(0, debt);
const _repCred = document.getElementById('rep-customer-current-credit');
if (_repCred) _repCred.innerText = "" + fmtAmt(safeNumber(debt, 0));
const _repInfo = document.getElementById('rep-customer-info-display');
if (_repInfo) _repInfo.classList.remove('hidden');
if(repTransactionMode === 'collection') {
const inputAmt = parseFloat(document.getElementById('rep-amount-collected')?.value) || 0;
const _repTV = document.getElementById('rep-total-value');
if (_repTV) _repTV.innerText = "" + fmtAmt(safeNumber(debt - inputAmt, 0));
}
}
function calculateRepSalePreview() {
if(repTransactionMode === 'sale') {
const qty = parseFloat(document.getElementById('rep-quantity').value) || 0;
const salePrice = getSalePriceForStore('STORE_A'); 
const _repTVS = document.getElementById('rep-total-value');
if (_repTVS) _repTVS.innerText = "" + fmtAmt(safeNumber(qty * salePrice, 0));
}
}

async function saveRepTransaction() {
const submitBtn = document.querySelector('#rep-new-transaction-card .btn-main');
if (submitBtn) {
if (submitBtn.disabled) return;
submitBtn.disabled = true;
}
function restoreBtn() {
if (submitBtn) submitBtn.disabled = false;
}
try {
const date = document.getElementById('rep-date').value;
const name = document.getElementById('rep-cust-name').value.trim();
const phoneInput = document.getElementById('rep-new-cust-phone');
const phoneNumber = (!document.getElementById('rep-new-customer-phone-container').classList.contains('hidden'))
? phoneInput.value.trim()
: '';
if(!date || !name) {
showToast("Date and Name required", "warning");
restoreBtn();
return;
}
let gpsCoords = null;
try {
gpsCoords = await Promise.race([
getPosition(),
new Promise(resolve => setTimeout(() => resolve(null), 3000))
]);
} catch (e) {
console.error('An unexpected error occurred.', e);
showToast('An unexpected error occurred.', 'error');
}
const now = new Date();
const timeString = now.toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit', hour12: true});
const costPerKg = getCostPriceForStore('STORE_A'); 
const salePrice = getSalePriceForStore('STORE_A'); 
let transactionRecord = {};
if(repTransactionMode === 'sale') {
const qty = parseFloat(document.getElementById('rep-quantity').value) || 0;
const payType = document.getElementById('rep-payment-value').value;
if(qty <= 0) {
showToast("Enter Quantity", "warning");
restoreBtn();
return;
}
const totalValue = qty * salePrice;
let saleId = generateUUID('rep_sale');
if (!validateUUID(saleId)) {
saleId = generateUUID('rep_sale');
}
transactionRecord = {
id: saleId,
date: date,
time: timeString,
customerName: name,
customerPhone: phoneNumber,
quantity: qty,
supplyStore: 'STORE_A',
paymentType: payType,
salesRep: currentRepProfile,
gps: gpsCoords,
totalCost: qty * costPerKg,
totalValue: totalValue,
profit: totalValue - (qty * costPerKg),
// Store the canonical fixed sale price per kg at transaction time.
unitPrice: salePrice,
creditReceived: (payType === 'CASH'),
createdAt: getTimestamp(),
updatedAt: getTimestamp(),
timestamp: getTimestamp(),
isRepModeEntry: true,
affectsInventory: false,
syncedAt: new Date().toISOString()
};
transactionRecord = ensureRecordIntegrity(transactionRecord, false);
} else {
const amount = parseFloat(document.getElementById('rep-amount-collected').value) || 0;
if(amount <= 0) {
showToast("Enter Amount", "warning");
restoreBtn();
return;
}
let collId = generateUUID('rep_coll');
if (!validateUUID(collId)) {
collId = generateUUID('rep_coll');
}
transactionRecord = {
id: collId,
date: date,
time: timeString,
customerName: name,
customerPhone: phoneNumber,
quantity: 0,
supplyStore: 'STORE_A',
paymentType: 'COLLECTION',
salesRep: currentRepProfile,
gps: gpsCoords,
totalCost: 0,
totalValue: amount,
profit: amount,
creditReceived: true,
isCollection: true,
createdAt: getTimestamp(),
updatedAt: getTimestamp(),
timestamp: getTimestamp(),
isRepModeEntry: true,
affectsInventory: false,
syncedAt: new Date().toISOString()
};
transactionRecord = ensureRecordIntegrity(transactionRecord, false);
}
repSales.push(transactionRecord);
await saveWithTracking('rep_sales', repSales);
if (firebaseDB && currentUser) {
saveRecordToFirestore('rep_sales', transactionRecord).catch(e => {
});
}
notifyDataChange('rep');
if (navigator.onLine) {
emitSyncUpdate({ rep_sales: repSales }).catch(e => {
});
}
if (gpsCoords) {
autoUpdateCustomerLocation(name, gpsCoords).catch(e => {
});
}
document.getElementById('rep-quantity').value = '';
const savedCustomerName = name;
document.getElementById('rep-amount-collected').value = '';
if(repTransactionMode === 'sale') {
const _custName = document.getElementById('rep-cust-name'); if (_custName) _custName.value = '';
const _custInfo = document.getElementById('rep-customer-info-display'); if (_custInfo) _custInfo.classList.add('hidden');
const _repTV1 = document.getElementById('rep-total-value'); if (_repTV1) _repTV1.innerText = '0.00';
} else {
const _custName2 = document.getElementById('rep-cust-name'); if (_custName2) _custName2.value = savedCustomerName;
calculateRepCustomerStats(savedCustomerName);
const _repTV2 = document.getElementById('rep-total-value'); if (_repTV2) _repTV2.innerText = '0.00';
}
if(phoneInput) phoneInput.value = '';
document.getElementById('rep-new-customer-phone-container').classList.add('hidden');
renderRepCustomerTable();
renderRepHistory();
showToast("Transaction Saved Successfully", "success");
} catch (error) {
showToast('Failed to save transaction. Please try again.', 'error');
} finally {
restoreBtn();
}
}
function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
const R = 6371e3;
const dLat = deg2rad(lat2 - lat1);
const dLon = deg2rad(lon2 - lon1);
const a =
Math.sin(dLat / 2) * Math.sin(dLat / 2) +
Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
Math.sin(dLon / 2) * Math.sin(dLon / 2);
const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
return R * c;
}
function deg2rad(deg) {
return deg * (Math.PI / 180);
}
async function autoUpdateCustomerLocation(customerName, currentGps) {
if (!currentGps || !currentGps.lat || !currentGps.lng) return;
const contactIndex = repCustomers.findIndex(
c => c && c.name && c.name.toLowerCase() === customerName.toLowerCase()
);
if (contactIndex === -1) return;
const contact = repCustomers[contactIndex];
const isManualAddress = contact.address && contact.address.length > 5 && !contact.address.startsWith('GPS:');
if (isManualAddress) return;
const matchFound = repSales.some(sale => {
if (sale.timestamp > Date.now() - 2000) return false;
if (sale && sale.customerName && sale.customerName.toLowerCase() === customerName.toLowerCase() && sale.gps) {
return getDistanceFromLatLonInMeters(
currentGps.lat, currentGps.lng,
sale.gps.lat, sale.gps.lng
) < 100;
}
return false;
});
if (matchFound) {
const coordsString = `GPS: ${safeNumber(currentGps.lat, 0).toFixed(2)}, ${safeNumber(currentGps.lng, 0).toFixed(2)}`;
const isNewLocation = contact.address !== coordsString;
repCustomers[contactIndex].address = coordsString;
repCustomers[contactIndex].updatedAt = getTimestamp();
await idb.set('rep_customers', repCustomers);
notifyDataChange('rep');
if (typeof showToast === 'function' && isNewLocation) {
showToast(`Location confirmed! Saved as default for ${customerName}.`, "success");
}
}
}
let repMap = null;
let repMapMarkers = [];
let repPolyline = null;
function getPosition() {
return new Promise((resolve, reject) => {
if (!navigator.geolocation) {
resolve(null);
return;
}
navigator.geolocation.getCurrentPosition(
(position) => resolve({
lat: position.coords.latitude,
lng: position.coords.longitude,
accuracy: position.coords.accuracy
}),
(error) => {
resolve(null);
},
{ enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
);
});
}
function initRepMap() {
if (repMap) return;
const mapContainer = document.getElementById('rep-map-container');
if (!mapContainer) return;
repMap = L.map('rep-map-container').setView([32.9910, 70.6055], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
attribution: '© OpenStreetMap contributors'
}).addTo(repMap);
setTimeout(() => {
if (repMap) {
repMap.invalidateSize();
}
}, 100);
}
function updateRepLiveMap() {
if (typeof L === 'undefined') return;
const container = document.getElementById('rep-map-container');
if (!container || container.offsetParent === null) return;
if (!repMap) initRepMap();
if (repMap) {
repMap.invalidateSize();
}
repMapMarkers.forEach(layer => repMap.removeLayer(layer));
repMapMarkers = [];
if (repPolyline) {
repMap.removeLayer(repPolyline);
repPolyline = null;
}
const dateInput = document.getElementById('rep-date');
const selectedDate = dateInput ? dateInput.value : new Date().toISOString().split('T')[0];
const dailyRoute = repSales
.filter(s => s.salesRep === currentRepProfile && s.date === selectedDate && s.gps)
.sort((a, b) => a.timestamp - b.timestamp);
if (dailyRoute.length === 0) {
return;
}
const latLngs = [];
dailyRoute.forEach(txn => {
if (txn.gps && txn.gps.lat && txn.gps.lng) {
const lat = txn.gps.lat;
const lng = txn.gps.lng;
latLngs.push([lat, lng]);
let color = '#3b82f6';
let typeStr = 'Cash Sale';
let detailStr = `${txn.quantity.toFixed(2)} kg`;
if (txn.paymentType === 'COLLECTION') {
color = '#10b981';
typeStr = 'Collection';
detailStr = `${fmtAmt(txn.totalValue)}`;
} else if (txn.paymentType === 'CREDIT') {
color = '#f59e0b';
typeStr = 'Credit Sale';
detailStr = `${txn.quantity.toFixed(2)} kg (Credit)`;
}
const marker = L.circleMarker([lat, lng], {
radius: 8,
fillColor: color,
color: '#fff',
weight: 2,
opacity: 1,
fillOpacity: 0.8
})
.bindPopup(`
<strong>${txn.customerName}</strong><br>
<small>${txn.time}</small><br>
<span style="color:${color}; font-weight:bold;">${typeStr}</span>: ${detailStr}
`);
marker.addTo(repMap);
repMapMarkers.push(marker);
}
});
if (latLngs.length > 1) {
repPolyline = L.polyline(latLngs, {
color: '#2563eb',
weight: 3,
opacity: 0.6,
dashArray: '5, 10'
}).addTo(repMap);
}
if (repMapMarkers.length > 0) {
const group = new L.featureGroup(repMapMarkers);
repMap.fitBounds(group.getBounds().pad(0.1));
}
}
function adminSwitchRepProfile(newProfile) {
if (appMode !== 'admin') return;
currentRepProfile = newProfile;
refreshRepUI();
setTimeout(() => {
if (repMap) {
repMap.invalidateSize();
}
updateRepLiveMap();
}, 200);
calculateRepAnalytics();
if(typeof showToast === 'function') {
showToast(`Viewing dashboard for ${newProfile}`, 'info');
}
}
let currentRepAnalyticsMode = 'day';
function setRepAnalyticsMode(mode) {
currentRepAnalyticsMode = mode;
document.querySelectorAll('#admin-rep-analytics .toggle-group .toggle-opt').forEach(opt => {
opt.classList.remove('active');
});
document.getElementById(`rep-analytics-${mode}-btn`).classList.add('active');
calculateRepAnalytics();
}
function calculateRepAnalytics() {
if (appMode !== 'admin') return;
const adminDateInput = document.getElementById('admin-rep-date');
const selectedDate = (adminDateInput && adminDateInput.value) || new Date().toISOString().split('T')[0];
const selectedDateObj = new Date(selectedDate);
const selectedYear = selectedDateObj.getFullYear();
const selectedMonth = selectedDateObj.getMonth();
let startDate = new Date(selectedDate);
let endDate = new Date(selectedDate);
startDate.setHours(0,0,0,0);
endDate.setHours(23,59,59,999);
if (currentRepAnalyticsMode === 'week') {
startDate.setDate(selectedDateObj.getDate() - 6);
} else if (currentRepAnalyticsMode === 'month') {
startDate = new Date(selectedYear, selectedMonth, 1);
endDate = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59);
} else if (currentRepAnalyticsMode === 'year') {
startDate = new Date(selectedYear, 0, 1);
endDate = new Date(selectedYear, 11, 31, 23, 59, 59);
} else if (currentRepAnalyticsMode === 'all') {
startDate = new Date('2000-01-01');
endDate = new Date('2100-12-31');
}
let collections = 0;
let cashSales = 0;
let creditSales = 0;
repSales.forEach(sale => {
if (sale.salesRep !== currentRepProfile) return;
const saleDate = new Date(sale.date);
if (saleDate >= startDate && saleDate <= endDate) {
if (sale.isMerged && sale.mergedSummary) {

const ms = sale.mergedSummary;
cashSales   += (ms.cashSales           || 0);
creditSales += (ms.unpaidCredit        || 0);
collections += (ms.collectionsReceived || 0);
} else if (sale.paymentType === 'COLLECTION') {
collections += sale.totalValue || 0;
} else if (sale.paymentType === 'CASH') {
cashSales += sale.totalValue || 0;
} else if (sale.paymentType === 'CREDIT') {

if (sale.creditReceived) {
cashSales += sale.totalValue || 0; 
} else {
creditSales += (sale.totalValue || 0) - (sale.partialPaymentReceived || 0);
}
}
}
});
const collectionsEl = document.getElementById('rep-analytics-collections');
const cashSalesEl = document.getElementById('rep-analytics-cash-sales');
const creditSalesEl = document.getElementById('rep-analytics-credit-sales');
if (collectionsEl) collectionsEl.textContent = `${fmtAmt(collections)}`;
if (cashSalesEl) cashSalesEl.textContent = `${fmtAmt(cashSales)}`;
if (creditSalesEl) creditSalesEl.textContent = `${fmtAmt(creditSales)}`;
}
async function renderRepCustomerTable(page = 1) {
const tbody = document.getElementById('rep-customers-table-body');
if (!tbody) {
return;
}
try {
const freshRepSales = await idb.get('rep_sales', []);
if (Array.isArray(freshRepSales)) {
const recordMap = new Map(freshRepSales.map(s => [s.id, s]));
if (Array.isArray(repSales)) {
repSales.forEach(s => {
if (!recordMap.has(s.id)) {
recordMap.set(s.id, s);
}
});
}
repSales = Array.from(recordMap.values());
}
} catch (error) {
console.error('Rep sales operation failed.', error);
showToast('Rep sales operation failed.', 'error');
}
const filterInput = document.getElementById('rep-filter');
const filter = filterInput ? filterInput.value.toLowerCase() : '';
const myData = repSales.filter(s =>
s.salesRep === currentRepProfile
);
const custMap = {};
myData.forEach(s => {
if(!custMap[s.customerName]) custMap[s.customerName] = { debt: 0, count: 0 };
custMap[s.customerName].count++;
if(s.paymentType === 'CREDIT' && !s.creditReceived) {
if (s.isMerged && typeof s.creditValue === 'number') {
custMap[s.customerName].debt += s.creditValue;
} else {
const partialPaid = s.partialPaymentReceived || 0;
custMap[s.customerName].debt += ((s.totalValue || 0) - partialPaid);
}
}
if(s.paymentType === 'COLLECTION' || s.paymentType === 'PARTIAL_PAYMENT') {
custMap[s.customerName].debt -= (s.totalValue || 0);
}
});
const sortedCustomers = Object.keys(custMap).sort();
const filteredCustomers = sortedCustomers.filter(name => {
if (!filter) return true;
return name && typeof name === 'string' && name.toLowerCase().includes(filter);
});
const pageCustomers = filteredCustomers;
const validPage = 1;
const totalPages = 1;
const totalItems = filteredCustomers.length;
const startIndex = 0;
const endIndex = filteredCustomers.length;
const repCustomersData = {
pageCustomers,
custMap,
totalItems,
totalPages,
validPage
};
if (repCustomersData && repCustomersData.pageCustomers) {
renderRepCustomersFromCache(repCustomersData, tbody);
} else {
tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--danger);">Failed to load customer data</td></tr>`;
}
}
function renderRepCustomersFromCache(data, tbody) {
if (!data) {
tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--danger);">Error loading customers</td></tr>`;
return;
}
const { pageCustomers, custMap, totalItems, totalPages, validPage } = data;
if (!pageCustomers || !Array.isArray(pageCustomers) || !custMap) {
tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--danger);">Invalid customer data</td></tr>`;
return;
}
if (totalItems === 0) {
if (Object.keys(custMap).length === 0) {
tbody.innerHTML = `<tr><td class="u-empty-state-md" colspan="5" >No customers yet. Add your first sale to get started!</td></tr>`;
} else {
const filterInput = document.getElementById('rep-filter');
const filter = filterInput ? filterInput.value : '';
tbody.innerHTML = `<tr><td class="u-empty-state-md" colspan="5" >No customers match "${esc(filter)}"</td></tr>`;
}
return;
}
function buildRepCustomerRow(name) {
const customerData = custMap[name];
const customerTransactions = repSales.filter(s =>
s.customerName === name &&
s.salesRep === currentRepProfile
);
const latestTransaction = customerTransactions.sort((a, b) => b.timestamp - a.timestamp)[0];
const displayDate = latestTransaction?.date ? formatDisplayDate(latestTransaction.date) : '-';
const repContact = repCustomers.find(c => c && c.name && c.name.toLowerCase() === name.toLowerCase());
const phone = repContact?.phone || latestTransaction?.customerPhone || '-';
const tr = document.createElement('tr');
tr.style.borderBottom = '1px solid var(--glass-border)';
const safeNameForAttr = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
tr.innerHTML = `
<td class="u-table-td">${displayDate}</td>
<td style="padding: 8px 2px; font-size: 0.8rem; color: var(--text-main); font-weight: 600;">${esc(name)}</td>
<td class="u-table-td">${phoneActionHTML(phone)}</td>
<td style="padding: 8px 2px; text-align: right; font-size: 0.8rem; color: ${customerData.debt > 1 ? 'var(--warning)' : 'var(--accent-emerald)'}; font-weight: 700;">
${customerData.debt.toLocaleString()}
</td>
<td style="padding: 6px 2px; text-align: center;">
<button class="tbl-action-btn" onclick="event.stopPropagation(); openRepCustomerManagement('${safeNameForAttr}')">View</button>
</td>`;
return tr;
}
GNDVirtualScroll.mount('vs-scroller-rep-customers', pageCustomers, buildRepCustomerRow, tbody);
}
async function openRepCustomerManagement(customerName) {
currentManagingRepCustomer = customerName;
const _repMCT = document.getElementById('repManageCustomerTitle'); if (_repMCT) _repMCT.innerText = customerName;
const _repBulk = document.getElementById('repBulkPaymentAmount'); if (_repBulk) _repBulk.value = '';
requestAnimationFrame(() => {
document.body.style.overflow = 'hidden';
document.documentElement.style.overflow = 'hidden';
document.getElementById('repCustomerManagementOverlay').style.display = 'flex';
});
await renderRepCustomerTransactions(customerName);
}
function closeRepCustomerManagement() {
requestAnimationFrame(() => {
document.body.style.overflow = '';
document.documentElement.style.overflow = '';
document.getElementById('repCustomerManagementOverlay').style.display = 'none';
});
currentManagingRepCustomer = null;
setTimeout(async () => {
try {
const freshRepSales = await idb.get('rep_sales', []);
if (Array.isArray(freshRepSales)) {
const m = new Map(freshRepSales.map(s => [s.id, s]));
if (Array.isArray(repSales)) repSales.forEach(s => { if (!m.has(s.id)) m.set(s.id, s); });
repSales = Array.from(m.values());
}
} catch(e) {
showToast('Rep sales operation failed.', 'error');
console.warn('closeRepCustomerManagement IDB error', e);
}
if (typeof renderRepCustomerTable === 'function') renderRepCustomerTable();
}, 100);
}
async function renderRepCustomerTransactions(name) {
const list = document.getElementById('repCustomerManagementHistoryList');
if (!list) return;
list.innerHTML = '';
let transactions = [];
try {
const dbSales = await idb.get('rep_sales', []);
if (Array.isArray(dbSales)) {
const recordMap = new Map(dbSales.map(s => [s.id, s]));
if (Array.isArray(repSales)) repSales.forEach(s => { if (!recordMap.has(s.id)) recordMap.set(s.id, s); });
repSales = Array.from(recordMap.values());
transactions = repSales.filter(s => s.customerName === name && s.salesRep === currentRepProfile);
} else {
transactions = repSales.filter(s => s.customerName === name && s.salesRep === currentRepProfile);
}
} catch (e) {
console.error('Rep sales operation failed.', e);
showToast('Rep sales operation failed.', 'error');
transactions = repSales.filter(s => s.customerName === name && s.salesRep === currentRepProfile);
}
const rangeSelect = document.getElementById('repCustomerPdfRange');
const range = rangeSelect ? rangeSelect.value : 'all';
if (range !== 'all') {
const today = new Date(); today.setHours(0,0,0,0);
transactions = transactions.filter(t => {
if (!t.date) return false;
const d = new Date(t.date);
if (range === 'today') return d >= today;
if (range === 'week') { const w = new Date(today); w.setDate(w.getDate() - 7); return d >= w; }
if (range === 'month') { const m = new Date(today); m.setMonth(m.getMonth() - 1); return d >= m; }
if (range === 'year') { const y = new Date(today); y.setFullYear(y.getFullYear() - 1); return d >= y; }
return true;
});
}
const repContacts = repCustomers;
const contact = repContacts.find(c => c && c.name && c.name.toLowerCase() === name.toLowerCase());
const phone = contact?.phone || transactions.find(t => t && t.customerPhone)?.customerPhone || '';
const address = contact?.address || '';
const headerTitle = document.getElementById('repManageCustomerTitle');
headerTitle.innerHTML = `
<div style="display:flex; align-items:center; gap:8px;">
<span>${esc(name)}</span>
<button class="btn-theme" style="padding:2px 6px; font-size:0.8rem; border:1px solid var(--accent); color:var(--accent); border-radius:50%;"
onclick="openRepCustomerEditModal('${esc(name).split("'").join("\\\'")}')" title="Edit Contact Info"></button>
</div>
<div style="font-size: 0.75rem; color: var(--text-muted); font-weight: normal; margin-top:4px;">
${phone ? phoneActionHTML(phone) : 'No Phone'} ${address ? `| ◆ ${esc(address)}` : ''}
</div>
`;
let currentDebt = 0;
transactions.forEach(t => {
if (t.transactionType === 'OLD_DEBT' && !t.creditReceived) {
currentDebt += ((t.totalValue || 0) - (t.partialPaymentReceived || 0));
} else if (t.paymentType === 'CREDIT' && !t.creditReceived) {
if (t.isMerged && typeof t.creditValue === 'number') {
currentDebt += t.creditValue;
} else {
currentDebt += ((t.totalValue || 0) - (t.partialPaymentReceived || 0));
}
}
if (t.paymentType === 'COLLECTION' || t.paymentType === 'PARTIAL_PAYMENT') {
currentDebt -= (t.totalValue || 0);
}
});
currentDebt = Math.max(0, currentDebt);
const _repMCS = document.getElementById('repManageCustomerStats'); if (_repMCS) _repMCS.innerText = `Current Debt: ${await formatCurrency(currentDebt)}`;
transactions.sort((a, b) => {
const ap = (a.paymentType === 'CREDIT' && !a.creditReceived) ? 1 : 0;
const bp = (b.paymentType === 'CREDIT' && !b.creditReceived) ? 1 : 0;
if (bp !== ap) return bp - ap;
return b.timestamp - a.timestamp;
});
if (transactions.length === 0) {
list.innerHTML = '<div class="u-empty-state-sm" >No history found</div>';
return;
}
for (const t of transactions) {
const isCredit = t.paymentType === 'CREDIT';
const isPartialPayment = t.paymentType === 'PARTIAL_PAYMENT';
const isCollection = t.paymentType === 'COLLECTION';
const isOldDebt = t.transactionType === 'OLD_DEBT';
const partialPaid = t.partialPaymentReceived || 0;
const effectiveDue = (t.isMerged && typeof t.creditValue === 'number') ? t.creditValue : ((t.totalValue || 0) - partialPaid);
const hasPartialPayment = isCredit && !t.creditReceived && partialPaid > 0 && !t.isMerged;
let statusClass = t.creditReceived ? 'paid' : 'pending';
let btnText = t.creditReceived ? 'PAID' : 'PENDING';
let toggleBtnHtml = '';
if (t.isMerged) {
const mergedSettled = t.creditReceived || effectiveDue <= 0.01;
toggleBtnHtml = mergedSettled
? `<span class="status-toggle-btn paid" style="opacity:0.8;">SETTLED</span>`
: `<span class="status-toggle-btn pending" style="opacity:0.8;">PENDING</span>`;
} else if (isCredit) {
if (hasPartialPayment) {
const remaining = effectiveDue;
btnText = `PARTIAL (${await formatCurrency(remaining)} due)`;
statusClass = 'partial';
}
toggleBtnHtml = `<button class="status-toggle-btn ${statusClass}" onclick="toggleRepTransactionStatus('${t.id}')">${btnText}</button>`;
} else if (isPartialPayment) {
toggleBtnHtml = `<span class="status-toggle-btn" style="background:rgba(255,159,10,0.1);color:var(--warning);">PARTIAL PAYMENT</span>`;
} else if (isCollection) {
toggleBtnHtml = `<span class="status-toggle-btn" style="background:rgba(48,209,88,0.1);color:var(--accent-emerald);">COLLECTION</span>`;
} else {
toggleBtnHtml = `<span class="status-toggle-btn" style="background:rgba(37,99,235,0.1);color:var(--accent);">CASH SALE</span>`;
}
const deleteBtnHtml = t.isMerged ? '' : `<button class="btn btn-sm btn-danger u-p-4-8" onclick="deleteRepTransactionFromOverlay('${esc(t.id)}')">⌫</button>`;
const item = document.createElement('div');
item.className = 'cust-history-item';
let itemContent = '';
if (isPartialPayment || isCollection) {
itemContent = `
<div class="cust-history-info">
<div style="font-weight:700;font-size:0.85rem;color:var(--text-main);">${formatDisplayDate(t.date)}${_mergedBadgeHtml(t, {inline:true})}</div>
<div style="font-size:0.75rem;color:var(--accent-emerald);">Payment: ${await formatCurrency(t.totalValue)}</div>
<div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">${isPartialPayment ? 'Partial Payment' : 'Bulk Payment'}</div>
</div>
<div class="cust-history-actions">
${toggleBtnHtml}
${deleteBtnHtml}
</div>`;
} else if (isOldDebt) {
itemContent = `
<div class="cust-history-info">
<div style="font-weight:700;font-size:0.85rem;color:var(--text-main);">
${formatDisplayDate(t.date)}
<span style="background:rgba(255,159,10,0.15);color:var(--warning);padding:2px 6px;border-radius:4px;font-size:0.65rem;margin-left:6px;font-weight:600;">OLD DEBT</span>${_mergedBadgeHtml(t, {inline:true})}
</div>
<div style="font-size:0.75rem;color:var(--warning);">Previous Balance: ${await formatCurrency(t.totalValue)}</div>
<div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">${esc(t.notes || 'Brought forward from previous records')}</div>
</div>
<div class="cust-history-actions">
${toggleBtnHtml}
${deleteBtnHtml}
</div>`;
} else {
// Canonical sale price: use stored unitPrice (set on merge) or fixed
// getSalePriceForStore rate — never divide totalValue/quantity (averaged).
const _repDisplayUnitPrice = (t.unitPrice && t.unitPrice > 0)
  ? t.unitPrice
  : getSalePriceForStore(t.supplyStore || 'STORE_A');
itemContent = `
<div class="cust-history-info">
<div style="font-weight:700;font-size:0.85rem;color:var(--text-main);">${formatDisplayDate(t.date)}${_mergedBadgeHtml(t, {inline:true})}</div>
<div style="font-size:0.75rem;color:var(--text-muted);">${t.quantity.toFixed(2)} kg @ ${await formatCurrency(_repDisplayUnitPrice)}</div>
${hasPartialPayment ? `<div style="font-size:0.7rem;color:var(--accent-emerald);margin-top:2px;">Paid: ${await formatCurrency(partialPaid)}</div>` : ''}
</div>
<div class="cust-history-actions">
${toggleBtnHtml}
${deleteBtnHtml}
</div>`;
}
item.innerHTML = itemContent;
list.appendChild(item);
}
}
function openCustomerEditModal(customerName) {
const nameInput = document.getElementById('edit-cust-name');
nameInput.value = customerName;
nameInput.dataset.originalName = customerName;
const contact = salesCustomers.find(c => c && c.name && c.name.toLowerCase() === customerName.toLowerCase());
const saleRecord = customerSales.find(s =>
s && s.customerName === customerName &&
s.isRepModeEntry !== true &&
(!s.salesRep || s.salesRep === 'NONE') &&
s.customerPhone
);
// Read oldDebit from the actual OLD_DEBT transaction so it always reflects truth,
// even if contact.oldDebit is stale or was never set
const existingOldDebtTx = customerSales.find(s =>
s && s.customerName && s.customerName.toLowerCase() === customerName.toLowerCase() &&
s.transactionType === 'OLD_DEBT' &&
s.isRepModeEntry !== true &&
(!s.salesRep || s.salesRep === 'NONE' || s.salesRep === 'ADMIN')
);
const oldDebitValue = existingOldDebtTx ? (existingOldDebtTx.totalValue || 0) : (contact?.oldDebit || 0);
document.getElementById('edit-cust-phone').value = contact?.phone || saleRecord?.customerPhone || '';
document.getElementById('edit-cust-address').value = contact?.address || '';
document.getElementById('edit-cust-old-debit').value = oldDebitValue;
requestAnimationFrame(() => {
document.body.style.overflow = 'hidden';
document.documentElement.style.overflow = 'hidden';
document.getElementById('customerEditOverlay').style.display = 'flex';
});
}
function closeCustomerEditModal() {
requestAnimationFrame(() => {
document.body.style.overflow = '';
document.documentElement.style.overflow = '';
document.getElementById('customerEditOverlay').style.display = 'none';
});
}
async function saveCustomerDetails() {
const nameInput = document.getElementById('edit-cust-name');
const name = nameInput.value.trim();
const originalName = nameInput.dataset.originalName || name;
const phone = document.getElementById('edit-cust-phone').value.trim();
const address = document.getElementById('edit-cust-address').value.trim();
const oldDebit = parseFloat(document.getElementById('edit-cust-old-debit').value) || 0;
if (!name) { showToast('Customer name is required', 'error'); return; }
try {
const nameChanged = name.toLowerCase() !== originalName.toLowerCase();
// Always read fresh contacts from IDB to avoid creating duplicates due to stale in-memory state
const freshContacts = await idb.get('sales_customers', []);
if (Array.isArray(freshContacts)) {
const m = new Map(freshContacts.map(c => [c.id, c]));
if (Array.isArray(salesCustomers)) salesCustomers.forEach(c => { if (!m.has(c.id)) m.set(c.id, c); });
salesCustomers = Array.from(m.values());
}
// Update contact record (find by original name or new name)
let contact = salesCustomers.find(c => c && c.name && c.name.toLowerCase() === originalName.toLowerCase());
if (!contact) contact = salesCustomers.find(c => c && c.name && c.name.toLowerCase() === name.toLowerCase());
const previousOldDebit = contact?.oldDebit || 0;
if (contact) {
contact.name = name; contact.phone = phone; contact.address = address; contact.oldDebit = oldDebit; contact.updatedAt = getTimestamp();
} else {
contact = { id: generateUUID(), name, phone, address, oldDebit,
createdAt: getTimestamp(), updatedAt: getTimestamp(), timestamp: getTimestamp() };
salesCustomers.push(contact);
}
// Save contact record locally and sync to cloud
await saveWithTracking('sales_customers', salesCustomers);
await saveRecordToFirestore('sales_customers', contact);
notifyDataChange('sales');
let salesArray = await idb.get('customer_sales', []);
if (!Array.isArray(salesArray)) salesArray = [];
// Merge in-memory customerSales with IDB data to avoid losing unsaved in-memory transactions
if (Array.isArray(customerSales) && customerSales.length > 0) {
const mSales = new Map(salesArray.map(s => [s.id, s]));
customerSales.forEach(s => { if (s && s.id && !mSales.has(s.id)) mSales.set(s.id, s); });
salesArray = Array.from(mSales.values());
}
// Rename customerName on all records if name changed
const renamedRecords = [];
if (nameChanged) {
salesArray.forEach(s => {
if (s && s.customerName && s.customerName.toLowerCase() === originalName.toLowerCase()) {
s.customerName = name;
renamedRecords.push(s);
}
});
}
const oldDebtIdx = salesArray.findIndex(s =>
s && s.customerName === name &&
s.transactionType === 'OLD_DEBT' &&
s.isRepModeEntry !== true &&
(!s.salesRep || s.salesRep === 'NONE' || s.salesRep === 'ADMIN')
);
let oldDebtModified = false, oldDebtRecord = null, deletedOldDebtId = null;
if (oldDebit > 0) {
if (oldDebtIdx !== -1) {
const tx = salesArray[oldDebtIdx];
const amountChanged = tx.totalValue !== oldDebit;
tx.totalValue = oldDebit; tx.customerPhone = phone; tx.timestamp = getTimestamp();
tx.updatedAt = getTimestamp();
// Only reset payment state when the debt amount itself has changed
if (amountChanged) { tx.creditReceived = false; tx.partialPaymentReceived = 0; }
if (!tx.time) tx.time = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
oldDebtModified = true; oldDebtRecord = tx;
} else {
const tx = { id: generateUUID(), date: new Date().toISOString().split('T')[0],
customerName: name, customerPhone: phone, salesRep: 'ADMIN', quantity: 0,
supplyStore: 'N/A', paymentType: 'CREDIT', transactionType: 'OLD_DEBT',
totalValue: oldDebit, creditReceived: false, partialPaymentReceived: 0,
time: new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
timestamp: getTimestamp(), createdAt: getTimestamp(), updatedAt: getTimestamp(),
notes: 'Previous balance brought forward', isRepModeEntry: false };
salesArray.push(tx); oldDebtModified = true; oldDebtRecord = tx;
}
} else if (oldDebit === 0 && oldDebtIdx !== -1) {
deletedOldDebtId = salesArray[oldDebtIdx].id;
salesArray.splice(oldDebtIdx, 1); oldDebtModified = true;
}
let phoneUpdated = false;
salesArray.forEach(s => { if (s && s.customerName === name && s.customerPhone !== phone) { s.customerPhone = phone; phoneUpdated = true; } });
customerSales.length = 0; customerSales.push(...salesArray);
if (nameChanged || oldDebtModified || phoneUpdated) {
await saveWithTracking('customer_sales', salesArray);
// Push the OLD_DEBT record to Firestore (create or update)
if (oldDebtRecord) await saveRecordToFirestore('customer_sales', oldDebtRecord);
// Delete the OLD_DEBT record from Firestore when cleared
if (deletedOldDebtId) await deleteRecordFromFirestore('customer_sales', deletedOldDebtId);
// Push all renamed records to Firestore so remote devices see the new name
if (nameChanged && renamedRecords.length > 0) {
const cloudPushes = renamedRecords.map(r => saveRecordToFirestore('customer_sales', r));
await Promise.allSettled(cloudPushes);
}
}
const message = nameChanged ? `Customer renamed to "${name}" and details updated`
: oldDebit > 0 ? `Customer updated with old debt of ₨${oldDebit.toLocaleString()}`
: (oldDebit === 0 && previousOldDebit > 0) ? 'Customer updated and old debt cleared'
: 'Customer details updated successfully';
showToast(message, 'success');
closeCustomerEditModal();
await new Promise(r => setTimeout(r, 350));
// If name changed, update the managing customer reference
if (nameChanged && currentManagingCustomer && currentManagingCustomer.toLowerCase() === originalName.toLowerCase()) {
currentManagingCustomer = name;
}
const overlay = document.getElementById('customerManagementOverlay');
if (overlay && overlay.style.display === 'flex') await renderCustomerTransactions(currentManagingCustomer || name);
if (typeof renderCustomersTable === 'function') renderCustomersTable();
notifyDataChange('entities');
triggerAutoSync();
} catch (error) {
showToast('Failed to save customer details. Please try again.', 'error');
}
}
async function fetchDeviceLocation() {
const statusDiv = document.getElementById('location-status');
const addressInput = document.getElementById('edit-cust-address');
const btn = document.querySelector('button[onclick="fetchDeviceLocation()"]');
if (!navigator.geolocation) {
statusDiv.textContent = "GPS not supported on this device.";
statusDiv.style.color = "var(--danger)";
return;
}
if(btn) btn.disabled = true;
statusDiv.innerHTML = '<span class="update-indicator"></span> Pinpointing satellite location...';
statusDiv.style.color = "var(--accent)";
addressInput.placeholder = "Fetching location...";
const gpsOptions = {
enableHighAccuracy: true,
timeout: 20000,
maximumAge: 0
};
navigator.geolocation.getCurrentPosition(async (position) => {
const lat = position.coords.latitude;
const lon = position.coords.longitude;
const accuracy = position.coords.accuracy;
const googleMapsLink = `https://www.google.com/maps?q=${lat},${lon}`;
const coordsText = `${safeNumber(lat, 0).toFixed(2)}, ${safeNumber(lon, 0).toFixed(2)}`;
statusDiv.textContent = `GPS Accuracy: ±${Math.round(accuracy)}m. Decoding name...`;
try {
const controller = new AbortController();
const apiTimeout = setTimeout(() => controller.abort(), 10000);
const response = await fetch(
`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&extratags=1&namedetails=1`,
{ headers: { 'User-Agent': 'NaswarApp/1.0' }, signal: controller.signal }
);
clearTimeout(apiTimeout);
if (!response.ok) throw new Error("Map API Error");
const data = await response.json();
if (data && data.address) {
const addr = data.address;
const placeName = addr.amenity || addr.shop || addr.building || addr.tourism || addr.historic || addr.leisure || addr.office || '';
const localArea = addr.neighbourhood || addr.suburb || addr.hamlet || addr.village || addr.quarter || '';
const road = addr.road || addr.pedestrian || addr.street || '';
const city = addr.town || addr.city || addr.county || 'Bannu';
let finalAddress = "";
if (placeName) {
finalAddress += placeName + ", ";
}
if (road) {
finalAddress += road + ", ";
} else if (!placeName) {
finalAddress += "Near ";
}
if (localArea) {
finalAddress += localArea + ", ";
}
finalAddress += city;
if (finalAddress.trim() === "Bannu" || finalAddress.trim() === "Near Bannu") {
const parts = data.display_name.split(', ');
finalAddress = parts.slice(0, 3).join(', ');
}
addressInput.value = `${finalAddress} (${coordsText})`;
statusDiv.textContent = `◆ Location Found: ${localArea || placeName || city}`;
statusDiv.style.color = "var(--accent-emerald)";
if(typeof showToast === 'function') showToast("Address updated successfully", "success");
} else {
throw new Error("Address not found");
}
} catch (error) {
console.error('An unexpected error occurred.', error);
showToast('An unexpected error occurred.', 'error');
addressInput.value = `GPS: ${coordsText}`;
statusDiv.textContent = "Address lookup failed. Saved GPS Coordinates.";
statusDiv.style.color = "var(--warning)";
} finally {
if(btn) btn.disabled = false;
}
}, (error) => {
let msg = "Location error.";
switch(error.code) {
case error.PERMISSION_DENIED: msg = " Permission denied. Check Phone Settings."; break;
case error.POSITION_UNAVAILABLE: msg = " Weak GPS signal. Go outside."; break;
case error.TIMEOUT: msg = " GPS timeout. Try again."; break;
}
statusDiv.textContent = msg;
statusDiv.style.color = "var(--danger)";
if(btn) btn.disabled = false;
}, gpsOptions);
}
function openRepCustomerEditModal(customerName) {
const nameInput = document.getElementById('rep-edit-cust-name');
nameInput.value = customerName;
nameInput.dataset.originalName = customerName;
const contact = repCustomers.find(c => c && c.name && c.name.toLowerCase() === customerName.toLowerCase());
const saleRecord = repSales.find(s => s && s.customerName === customerName && s.salesRep === currentRepProfile && s.customerPhone);
// Read oldDebit from the actual OLD_DEBT transaction so it always reflects truth,
// even if contact.oldDebit is stale or was never set
const existingOldDebtTx = repSales.find(s =>
s && s.customerName && s.customerName.toLowerCase() === customerName.toLowerCase() &&
s.transactionType === 'OLD_DEBT' &&
s.salesRep === currentRepProfile
);
const oldDebitValue = existingOldDebtTx ? (existingOldDebtTx.totalValue || 0) : (contact?.oldDebit || 0);
document.getElementById('rep-edit-cust-phone').value = contact?.phone || saleRecord?.customerPhone || '';
document.getElementById('rep-edit-cust-address').value = contact?.address || '';
document.getElementById('rep-edit-cust-old-debit').value = oldDebitValue;
requestAnimationFrame(() => {
document.body.style.overflow = 'hidden';
document.documentElement.style.overflow = 'hidden';
document.getElementById('repCustomerEditOverlay').style.display = 'flex';
});
}
function closeRepCustomerEditModal() {
requestAnimationFrame(() => {
document.body.style.overflow = '';
document.documentElement.style.overflow = '';
document.getElementById('repCustomerEditOverlay').style.display = 'none';
});
}
async function saveRepCustomerDetails() {
const nameInput = document.getElementById('rep-edit-cust-name');
const name = nameInput.value.trim();
const originalName = nameInput.dataset.originalName || name;
const phone = document.getElementById('rep-edit-cust-phone').value.trim();
const address = document.getElementById('rep-edit-cust-address').value.trim();
const oldDebit = parseFloat(document.getElementById('rep-edit-cust-old-debit').value) || 0;
if (!name) { showToast('Customer name is required', 'error'); return; }
try {
const nameChanged = name.toLowerCase() !== originalName.toLowerCase();
// Always read fresh contacts from IDB to avoid creating duplicates due to stale in-memory state
const freshRepContacts = await idb.get('rep_customers', []);
if (Array.isArray(freshRepContacts)) {
const m = new Map(freshRepContacts.map(c => [c.id, c]));
if (Array.isArray(repCustomers)) repCustomers.forEach(c => { if (!m.has(c.id)) m.set(c.id, c); });
repCustomers = Array.from(m.values());
}
let contact = repCustomers.find(c => c && c.name && c.name.toLowerCase() === originalName.toLowerCase());
if (!contact) contact = repCustomers.find(c => c && c.name && c.name.toLowerCase() === name.toLowerCase());
const previousOldDebit = contact?.oldDebit || 0;
if (contact) {
contact.name = name; contact.phone = phone; contact.address = address; contact.oldDebit = oldDebit; contact.updatedAt = getTimestamp();
} else {
contact = { id: generateUUID(), name, phone, address, oldDebit,
createdAt: getTimestamp(), updatedAt: getTimestamp(), timestamp: getTimestamp() };
repCustomers.push(contact);
}
// Save contact record locally and sync to cloud
await saveWithTracking('rep_customers', repCustomers);
await saveRecordToFirestore('rep_customers', contact);
let salesArray = await idb.get('rep_sales', []);
if (!Array.isArray(salesArray)) salesArray = [];
// Merge in-memory repSales with IDB data to avoid losing unsaved in-memory transactions
if (Array.isArray(repSales) && repSales.length > 0) {
const mSales = new Map(salesArray.map(s => [s.id, s]));
repSales.forEach(s => { if (s && s.id && !mSales.has(s.id)) mSales.set(s.id, s); });
salesArray = Array.from(mSales.values());
}
// Rename customerName on all records if name changed
const renamedRecords = [];
if (nameChanged) {
salesArray.forEach(s => {
if (s && s.customerName && s.customerName.toLowerCase() === originalName.toLowerCase() && s.salesRep === currentRepProfile) {
s.customerName = name;
renamedRecords.push(s);
}
});
}
const oldDebtIdx = salesArray.findIndex(s => s && s.customerName === name &&
s.transactionType === 'OLD_DEBT' && s.salesRep === currentRepProfile);
let oldDebtModified = false, oldDebtRecord = null, deletedOldDebtId = null;
if (oldDebit > 0) {
if (oldDebtIdx !== -1) {
const tx = salesArray[oldDebtIdx];
const amountChanged = tx.totalValue !== oldDebit;
tx.totalValue = oldDebit; tx.customerPhone = phone; tx.timestamp = getTimestamp();
tx.updatedAt = getTimestamp();
// Only reset payment state when the debt amount itself has changed
if (amountChanged) { tx.creditReceived = false; tx.partialPaymentReceived = 0; }
if (!tx.time) tx.time = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
oldDebtModified = true; oldDebtRecord = tx;
} else {
const tx = { id: generateUUID(), date: new Date().toISOString().split('T')[0],
customerName: name, customerPhone: phone, salesRep: currentRepProfile, quantity: 0,
supplyStore: 'N/A', paymentType: 'CREDIT', transactionType: 'OLD_DEBT',
totalValue: oldDebit, creditReceived: false, partialPaymentReceived: 0,
time: new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
timestamp: getTimestamp(), createdAt: getTimestamp(), updatedAt: getTimestamp(),
notes: 'Previous balance brought forward', isRepModeEntry: true };
salesArray.push(tx); oldDebtModified = true; oldDebtRecord = tx;
}
} else if (oldDebit === 0 && oldDebtIdx !== -1) {
deletedOldDebtId = salesArray[oldDebtIdx].id;
salesArray.splice(oldDebtIdx, 1); oldDebtModified = true;
}
let phoneUpdated = false;
salesArray.forEach(s => { if (s && s.customerName === name && s.customerPhone !== phone) { s.customerPhone = phone; phoneUpdated = true; } });
repSales.length = 0; repSales.push(...salesArray);
if (nameChanged || oldDebtModified || phoneUpdated) {
await saveWithTracking('rep_sales', salesArray);
// Push the OLD_DEBT record to Firestore (create or update)
if (oldDebtRecord) await saveRecordToFirestore('rep_sales', oldDebtRecord);
// Delete the OLD_DEBT record from Firestore when cleared
if (deletedOldDebtId) await deleteRecordFromFirestore('rep_sales', deletedOldDebtId);
// Push all renamed records to Firestore so remote devices see the new name
if (nameChanged && renamedRecords.length > 0) {
const cloudPushes = renamedRecords.map(r => saveRecordToFirestore('rep_sales', r));
await Promise.allSettled(cloudPushes);
}
}
const message = nameChanged ? `Rep customer renamed to "${name}" and details updated`
: oldDebit > 0 ? `Rep customer updated with old debt of ₨${oldDebit.toLocaleString()}`
: (oldDebit === 0 && previousOldDebit > 0) ? 'Rep customer updated and old debt cleared'
: 'Rep customer details updated successfully';
showToast(message, 'success');
closeRepCustomerEditModal();
await new Promise(r => setTimeout(r, 350));
// If name changed, update the managing customer reference
if (nameChanged && currentManagingRepCustomer && currentManagingRepCustomer.toLowerCase() === originalName.toLowerCase()) {
currentManagingRepCustomer = name;
}
const overlay = document.getElementById('repCustomerManagementOverlay');
if (overlay && overlay.style.display === 'flex') await renderRepCustomerTransactions(currentManagingRepCustomer || name);
if (typeof renderRepCustomerTable === 'function') renderRepCustomerTable();
notifyDataChange('rep');
triggerAutoSync();
} catch (error) {
showToast('Failed to save rep customer details. Please try again.', 'error');
}
}
async function fetchRepDeviceLocation() {
const statusDiv = document.getElementById('rep-location-status');
const addressInput = document.getElementById('rep-edit-cust-address');
const btn = document.querySelector('button[onclick="fetchRepDeviceLocation()"]');
if (!navigator.geolocation) {
statusDiv.textContent = 'GPS not supported on this device.';
statusDiv.style.color = 'var(--danger)';
return;
}
if (btn) btn.disabled = true;
statusDiv.innerHTML = '<span class="update-indicator"></span> Pinpointing satellite location...';
statusDiv.style.color = 'var(--accent)';
addressInput.placeholder = 'Fetching location...';
const gpsOptions = { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 };
navigator.geolocation.getCurrentPosition(async (position) => {
const lat = position.coords.latitude;
const lon = position.coords.longitude;
const accuracy = position.coords.accuracy;
const coordsText = `${safeNumber(lat, 0).toFixed(2)}, ${safeNumber(lon, 0).toFixed(2)}`;
statusDiv.textContent = `GPS Accuracy: ±${Math.round(accuracy)}m. Decoding name...`;
try {
const controller = new AbortController();
const apiTimeout = setTimeout(() => controller.abort(), 10000);
const response = await fetch(
`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&extratags=1&namedetails=1`,
{ headers: { 'User-Agent': 'NaswarApp/1.0' }, signal: controller.signal }
);
clearTimeout(apiTimeout);
if (!response.ok) throw new Error('Map API Error');
const data = await response.json();
if (data && data.address) {
const addr = data.address;
const placeName = addr.amenity || addr.shop || addr.building || addr.tourism || addr.historic || addr.leisure || addr.office || '';
const localArea = addr.neighbourhood || addr.suburb || addr.hamlet || addr.village || addr.quarter || '';
const road = addr.road || addr.pedestrian || addr.street || '';
const city = addr.town || addr.city || addr.county || 'Bannu';
let finalAddress = '';
if (placeName) finalAddress += placeName + ', ';
if (road) finalAddress += road + ', ';
else if (!placeName) finalAddress += 'Near ';
if (localArea) finalAddress += localArea + ', ';
finalAddress += city;
if (finalAddress.trim() === 'Bannu' || finalAddress.trim() === 'Near Bannu') {
finalAddress = data.display_name.split(', ').slice(0, 3).join(', ');
}
addressInput.value = `${finalAddress} (${coordsText})`;
statusDiv.textContent = `◆ Location Found: ${localArea || placeName || city}`;
statusDiv.style.color = 'var(--accent-emerald)';
if (typeof showToast === 'function') showToast('Address updated successfully', 'success');
} else { throw new Error('Address not found'); }
} catch (error) {
console.error('An unexpected error occurred.', error);
showToast('An unexpected error occurred.', 'error');
addressInput.value = `GPS: ${coordsText}`;
statusDiv.textContent = 'Address lookup failed. Saved GPS Coordinates.';
statusDiv.style.color = 'var(--warning)';
} finally { if (btn) btn.disabled = false; }
}, (error) => {
let msg = 'Location error.';
if (error.code === error.PERMISSION_DENIED) msg = ' Permission denied. Check Phone Settings.';
else if (error.code === error.POSITION_UNAVAILABLE) msg = ' Weak GPS signal. Go outside.';
else if (error.code === error.TIMEOUT) msg = ' GPS timeout. Try again.';
statusDiv.textContent = msg;
statusDiv.style.color = 'var(--danger)';
if (btn) btn.disabled = false;
}, gpsOptions);
}
async function exportRepCustomerToPDF() {
const titleElement = document.getElementById('repManageCustomerTitle');
if (!titleElement) { showToast('No rep customer selected', 'warning'); return; }
const titleHTML = titleElement.innerHTML;
const nameMatch = titleHTML.match(/<span>([^<]+)<\/span>/) || titleHTML.match(/^([^<]+)/);
const customerName = nameMatch ? nameMatch[1].trim() : titleElement.innerText.split('\n')[0].trim();
if (!customerName) { showToast('No rep customer selected', 'warning'); return; }
const rangeSelect = document.getElementById('repCustomerPdfRange');
const range = rangeSelect ? rangeSelect.value : 'all';
showToast("Generating PDF...", "info");
try {
if (!window.jspdf) {
await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js');
await new Promise(r => setTimeout(r, 200));
}
if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("Failed to load PDF library.");
let transactions = repSales.filter(s =>
s &&
s.customerName === customerName &&
s.salesRep === currentRepProfile
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
const contact = repCustomers.find(c => c && c.name && c.name.toLowerCase() === customerName.toLowerCase());
const phone = contact?.phone || transactions.find(t => t.customerPhone)?.customerPhone || 'N/A';
const address = contact?.address || transactions.find(t => t.customerAddress)?.customerAddress || 'N/A';
const { jsPDF } = window.jspdf;
const doc = new jsPDF('p', 'mm', 'a4');
const pageW = doc.internal.pageSize.getWidth();
const hdrColor = [40, 167, 69];
doc.setFillColor(...hdrColor);
doc.rect(0, 0, pageW, 22, 'F');
doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.setTextColor(255, 255, 255);
doc.text('GULL AND ZUBAIR NASWAR DEALERS', pageW / 2, 10, { align: 'center' });
doc.setFontSize(9); doc.setFont(undefined, 'normal');
doc.text('Naswar Manufacturers & Dealers · Rep Sales Tab Statement', pageW / 2, 17, { align: 'center' });
const rangeName = range === 'all' ? 'All Time' : range === 'today' ? 'Today' :
range === 'week' ? 'This Week' : range === 'month' ? 'This Month' : 'This Year';
doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.setTextColor(50, 50, 50);
doc.text(`Rep Customer Account Statement · ${rangeName}`, pageW / 2, 30, { align: 'center' });
doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(80, 80, 80);
let yPos = 38;
doc.setFont(undefined, 'bold'); doc.text('Customer:', 14, yPos);
doc.setFont(undefined, 'normal'); doc.text(customerName, 36, yPos);
doc.setFont(undefined, 'bold'); doc.text('Phone:', 14, yPos + 5);
doc.setFont(undefined, 'normal'); doc.text(phone, 36, yPos + 5);
doc.setFont(undefined, 'bold'); doc.text('Address:', 14, yPos + 10);
doc.setFont(undefined, 'normal'); doc.text(address.substring(0, 50), 36, yPos + 10);
doc.setFont(undefined, 'bold'); doc.text('Sales Rep:', pageW / 2, yPos);
doc.setFont(undefined, 'normal'); doc.text(currentRepProfile || 'N/A', pageW / 2 + 22, yPos);
doc.setFont(undefined, 'bold'); doc.text('Generated:', pageW / 2, yPos + 5);
doc.setFont(undefined, 'normal');
doc.text(now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), pageW / 2 + 22, yPos + 5);
yPos += 18;
doc.setDrawColor(...hdrColor); doc.setLineWidth(0.5);
doc.line(14, yPos, pageW - 14, yPos);
yPos += 5;
if (transactions.length > 0) {
// Use stored unitPrice (set at save/merge time) or fixed getSalePriceForStore —
// never divide totalValue/quantity which gives a weighted/partial-payment average.
const getSalePrice = (t) => {
  if (t.unitPrice && t.unitPrice > 0) return t.unitPrice;
  return getSalePriceForStore(t.supplyStore || 'STORE_A');
};

const buildRepRow = (t, runBal) => {
  const pt = t.paymentType || 'CASH';
  const isOldDebt = t.transactionType === 'OLD_DEBT';
  const sp = getSalePrice(t);
  let debit=0, credit=0, typeLabel='', detailLabel='', displayDate=formatDisplayDate(t.date);
  if (isOldDebt){debit=parseFloat(t.totalValue)||0;credit=parseFloat(t.partialPaymentReceived)||0;typeLabel='OLD DEBT';detailLabel=t.notes||'Brought forward';}
  else if(pt==='CASH'){const v=t.totalValue||(t.quantity||0)*sp;debit=credit=v;typeLabel='CASH';detailLabel=`${fmtAmt(t.quantity||0)} kg \xd7 Rs ${fmtAmt(sp)}`;}
  else if(pt==='CREDIT'&&!t.creditReceived){const v=t.totalValue||(t.quantity||0)*sp;const p=parseFloat(t.partialPaymentReceived)||0;debit=v;credit=p;typeLabel=p>0?'CREDIT\n(PARTIAL)':'CREDIT';detailLabel=`${fmtAmt(t.quantity||0)} kg \xd7 Rs ${fmtAmt(sp)}`;if(p>0)detailLabel+=`\nPaid:Rs ${fmtAmt(p)} Due:Rs ${fmtAmt(v-p)}`;}
  else if(pt==='CREDIT'&&t.creditReceived){const v=t.totalValue||(t.quantity||0)*sp;debit=credit=v;typeLabel='CREDIT\n(PAID)';detailLabel=`${fmtAmt(t.quantity||0)} kg \xd7 Rs ${fmtAmt(sp)}`;displayDate=formatDisplayDate(t.creditReceivedDate||t.date);}
  else if(pt==='COLLECTION'){credit=parseFloat(t.totalValue)||0;typeLabel='COLLECTION';detailLabel='Cash payment received';displayDate=formatDisplayDate(t.creditReceivedDate||t.date);}
  else if(pt==='PARTIAL_PAYMENT'){credit=parseFloat(t.totalValue)||0;typeLabel='PARTIAL\nPAYMENT';detailLabel='Partial payment received';displayDate=formatDisplayDate(t.creditReceivedDate||t.date);}
  runBal.val += (debit - credit);
  const bal = Math.abs(runBal.val)<0.01?'SETTLED':runBal.val>0?'Rs '+fmtAmt(runBal.val):'OVERPAID\nRs '+fmtAmt(Math.abs(runBal.val));
  return {row:[displayDate,typeLabel,detailLabel.substring(0,55),debit>0?'Rs '+fmtAmt(debit):'-',credit>0?'Rs '+fmtAmt(credit):'-',bal],debit,credit,qty:t.quantity||0};
};
const mergedRepTxns = transactions.filter(t => t.isMerged === true);
const normalRepTxns = transactions.filter(t => !t.isMerged);

if (mergedRepTxns.length > 0) {
  yPos = _pdfDrawMergedSectionHeader(doc, yPos, pageW, 'YEAR-END OPENING BALANCES (Carried Forward)');
  const mRunBal = {val:0};
  const mergedRows = mergedRepTxns.map(t => {
    const ms = t.mergedSummary||{};
    const isSettled = ms.isSettled || t.creditReceived;
    const netOut = ms.netOutstanding!=null?ms.netOutstanding:(t.totalValue||0);
    const details = [_pdfMergedPeriodLabel(t), _pdfMergedCountLabel(t),
      !isSettled?`Net due: Rs ${fmtAmt(netOut)}`:'Settled'].filter(Boolean).join('\n');
    mRunBal.val += netOut;
    const pt = t.paymentType||'CASH';
    return [formatDisplayDate(t.date), isSettled?'SETTLED\n(MERGED)':(pt==='CREDIT'?'CREDIT\n(MERGED)':'CASH\n(MERGED)'),
      details.substring(0,70), netOut>0?'Rs '+fmtAmt(netOut):'-',
      isSettled?'Rs '+fmtAmt(ms.cashSales||0):'-',
      isSettled?'SETTLED':'Rs '+fmtAmt(netOut)];
  });
  const mNet = mergedRepTxns.reduce((s,t)=>s+((t.mergedSummary||{}).netOutstanding||t.totalValue||0),0);
  mergedRows.push(['','SUBTOTAL',`${mergedRepTxns.length} year-end record${mergedRepTxns.length!==1?'s':''}`,
    mNet>0?'Rs '+fmtAmt(mNet):'-','',mNet<=0.01?'SETTLED':'Rs '+fmtAmt(mNet)]);
  doc.autoTable({startY:yPos,head:[['Date','Type','Year Period / Summary','Outstanding','Settled','Balance']],body:mergedRows,theme:'grid',
    headStyles:{fillColor:PDF_MERGED_HDR_COLOR,textColor:255,fontSize:8.5,fontStyle:'bold',halign:'center'},
    styles:{fontSize:7.5,cellPadding:2.5,lineWidth:0.15,lineColor:[200,180,230],overflow:'linebreak'},
    columnStyles:{0:{cellWidth:22,halign:'center'},1:{cellWidth:22,halign:'center',fontStyle:'bold'},2:{cellWidth:52},3:{cellWidth:27,halign:'right',fontStyle:'bold'},4:{cellWidth:27,halign:'right',fontStyle:'bold'},5:{cellWidth:26,halign:'center',fontStyle:'bold'}},
    didParseCell:function(data){const isSub=data.row.index===mergedRows.length-1;if(isSub){data.cell.styles.fillColor=[230,210,255];data.cell.styles.fontStyle='bold';}else{data.cell.styles.fillColor=PDF_MERGED_ROW_COLOR;data.cell.styles.textColor=[80,40,120];}
    if(data.column.index===3&&!isSub)data.cell.styles.textColor=[180,40,40];if(data.column.index===4&&!isSub)data.cell.styles.textColor=[40,130,60];if(data.column.index===5&&!isSub){const txt=(data.cell.text||[]).join('');data.cell.styles.textColor=txt==='SETTLED'?[100,100,100]:[126,34,206];}},
    margin:{left:14,right:14}});
  yPos = doc.lastAutoTable.finalY + 6;
  if (yPos > 255) { doc.addPage(); yPos = 20; }
}

const rows = [];
const txRunBal = {val:0};
let totDebit=0,totCredit=0,totQty=0;
for (const t of normalRepTxns) {
  const r = buildRepRow(t, txRunBal);
  rows.push(r.row); totDebit+=r.debit; totCredit+=r.credit; totQty+=r.qty;
}
const finalBal = totDebit - totCredit;
if (normalRepTxns.length > 0) {
  doc.setFontSize(8.5);doc.setFont(undefined,'bold');doc.setTextColor(...hdrColor);
  doc.text('INDIVIDUAL TRANSACTIONS',14,yPos);doc.setTextColor(80,80,80);doc.setFont(undefined,'normal');yPos+=5;
  rows.push(['TOTALS','',`${fmtAmt(totQty)} kg total`,'Rs '+fmtAmt(totDebit),'Rs '+fmtAmt(totCredit),
    Math.abs(finalBal)<0.01?'SETTLED':finalBal>0?'DUE\nRs '+fmtAmt(finalBal):'OVERPAID\nRs '+fmtAmt(Math.abs(finalBal))]);
  doc.autoTable({startY:yPos,head:[['Date','Type','Details','Debit (Sale)','Credit (Rcvd)','Balance']],body:rows,theme:'grid',
    headStyles:{fillColor:hdrColor,textColor:255,fontSize:8.5,fontStyle:'bold',halign:'center'},
    styles:{fontSize:7.5,cellPadding:2.5,lineWidth:0.15,lineColor:[180,180,180],overflow:'linebreak'},
    columnStyles:{0:{cellWidth:22,halign:'center'},1:{cellWidth:22,halign:'center',fontStyle:'bold'},2:{cellWidth:52},3:{cellWidth:27,halign:'right',textColor:[220,53,69],fontStyle:'bold'},4:{cellWidth:27,halign:'right',textColor:[40,167,69],fontStyle:'bold'},5:{cellWidth:26,halign:'center',fontStyle:'bold'}},
    didParseCell:function(data){const isTotal=data.row.index===rows.length-1;if(isTotal){data.cell.styles.fontStyle='bold';data.cell.styles.fillColor=[235,255,235];data.cell.styles.fontSize=9;}
    if(data.column.index===1&&!isTotal){const txt=(data.cell.text||[]).join('');if(txt.includes('CASH'))data.cell.styles.textColor=[40,167,69];if(txt.includes('CREDIT'))data.cell.styles.textColor=[200,100,0];if(txt.includes('COLLECTION'))data.cell.styles.textColor=[40,167,69];if(txt.includes('PARTIAL'))data.cell.styles.textColor=[200,100,0];if(txt.includes('OLD DEBT'))data.cell.styles.textColor=[220,53,69];}
    if(data.column.index===5&&!isTotal){const txt=(data.cell.text||[]).join('');if(txt==='SETTLED')data.cell.styles.textColor=[100,100,100];else if(txt.includes('OVERPAID'))data.cell.styles.textColor=[40,167,69];else data.cell.styles.textColor=[220,53,69];}},
    margin:{left:14,right:14}});
}
const afterY = (normalRepTxns.length > 0 ? doc.lastAutoTable.finalY : yPos - 5) + 5;
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
const filename = `Rep_Customer_Statement_${customerName.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
doc.save(filename);
showToast("PDF exported successfully", "success");
} catch (error) {
showToast("Error generating PDF: " + error.message, "error");
}
}
const refreshEntityList = renderEntityTable;
function renderRepHistory() {
const list = document.getElementById('repHistoryList');
if (!list) return;
list.innerHTML = '';
const dateInput = document.getElementById('rep-date');
const selectedDate = dateInput && dateInput.value ? dateInput.value : new Date().toISOString().split('T')[0];
const isToday = selectedDate === new Date().toISOString().split('T')[0];
const headerText = isToday ? "Today's Activity" : `Activity for ${selectedDate}`;
const activityData = repSales
.filter(s =>
s.salesRep === currentRepProfile &&
s.date === selectedDate &&
s.paymentType !== 'PARTIAL_PAYMENT'
)
.sort((a,b) => b.timestamp - a.timestamp);
if(activityData.length === 0) {
list.innerHTML = `<div class="u-empty-state-sm" >No activity found for ${esc(selectedDate)}</div>`;
return;
}
let tableHTML = `
<div class="section liquid-card" style="padding: 15px;">
<h4 style="margin: 0 0 15px 0; color: var(--accent); font-size: 0.9rem;">${esc(headerText)}</h4>
<div style="max-height: 400px; overflow-y: auto;">
`;
activityData.forEach(item => {
let typeIcon = '';
let typeColor = '';
let qtyAmount = '';
if (item.paymentType === 'COLLECTION') {
typeIcon = '';
typeColor = 'var(--accent-emerald)';
qtyAmount = `Collection: ${fmtAmt(item.totalValue)}`;
} else if (item.paymentType === 'CREDIT') {
typeIcon = '';
typeColor = 'var(--warning)';
qtyAmount = item.transactionType === 'OLD_DEBT'
? `Previous Balance: ${fmtAmt(item.totalValue)}`
: `${item.quantity.toFixed(2)} kg - ${fmtAmt(item.totalValue)}`;
} else {
typeIcon = '';
typeColor = 'var(--accent)';
qtyAmount = `${item.quantity.toFixed(2)} kg - ${fmtAmt(item.totalValue)}`;
}
tableHTML += `
<div style="
display: flex;
justify-content: space-between;
align-items: center;
padding: 12px;
margin-bottom: 8px;
background: var(--input-bg);
border-radius: 10px;
border: 1px solid var(--glass-border);
transition: all 0.2s;
">
<div class="u-flex-1" >
<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
<span style="font-size: 1.2rem;">${typeIcon}</span>
<strong style="color: var(--text-main); font-size: 0.9rem;">${esc(item.customerName)}</strong>
${item.isMerged ? _mergedBadgeHtml(item, {inline:true}) : ''}
</div>
<div style="font-size: 0.75rem; color: ${typeColor}; font-weight: 600;">
${qtyAmount}
</div>
</div>
<div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 5px;">
<div class="u-fs-sm u-text-muted" >
${esc(item.time || '')}
</div>
${item.isMerged ? '' : `<button class="tbl-action-btn danger" onclick="(async () => { await deleteRepTransaction('${esc(item.id)}') })()">Delete</button>`}
</div>
</div>
`;
});
tableHTML += `
</div>
</div>
`;
list.innerHTML = tableHTML;
}
async function refreshRepUI(force = false) {
if (idb && idb.getBatch) {
try {
const repKeys = ['rep_sales', 'rep_customers'];
const repDataMap = await idb.getBatch(repKeys);
if (repDataMap.get('rep_sales') !== undefined && repDataMap.get('rep_sales') !== null) {
let freshRepSales = repDataMap.get('rep_sales') || [];
let fixedCount = 0;
if (Array.isArray(freshRepSales) && freshRepSales.length > 0) {
freshRepSales = freshRepSales.map(record => {
if (!record.id || !validateUUID(record.id) ||
!record.createdAt || !validateTimestamp(record.createdAt) ||
!record.updatedAt || !validateTimestamp(record.updatedAt)) {
record = ensureRecordIntegrity(record, false, true);
fixedCount++;
}
return record;
});
if (fixedCount > 0) {
await idb.set('rep_sales', freshRepSales);
}
freshRepSales.sort((a, b) => compareTimestamps(getRecordTimestamp(b), getRecordTimestamp(a)));
}
repSales = freshRepSales;
}
if (repDataMap.get('rep_customers') !== undefined && repDataMap.get('rep_customers') !== null) {
let freshRepCustomers = repDataMap.get('rep_customers') || [];
let fixedCount = 0;
if (Array.isArray(freshRepCustomers) && freshRepCustomers.length > 0) {
freshRepCustomers = freshRepCustomers.map(record => {
if (!record.id || !validateUUID(record.id) ||
!record.createdAt || !validateTimestamp(record.createdAt) ||
!record.updatedAt || !validateTimestamp(record.updatedAt)) {
record = ensureRecordIntegrity(record, false, true);
fixedCount++;
}
return record;
});
if (fixedCount > 0) {
await idb.set('rep_customers', freshRepCustomers);
}
}
repCustomers = freshRepCustomers;
}
} catch (error) {
console.error('Failed to save data locally.', error);
showToast('Failed to save data locally.', 'error');
}
}
const adminRepSel = document.getElementById('admin-rep-selector');
if (adminRepSel && adminRepSel.value !== currentRepProfile) {
adminRepSel.value = currentRepProfile;
}
renderRepCustomerTable();
renderRepHistory();
if (appMode === 'admin') {
if (typeof updateRepLiveMap === 'function') {
setTimeout(updateRepLiveMap, 200);
}
}
}
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
// Save the true original showTab once so wrapping is never nested across calls
if (!window._originalShowTab && typeof window.showTab === 'function') {
window._originalShowTab = window.showTab;
}
// Always reset to the original before re-applying any wrapper
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
confirmMsg += `\n\n\u26a0 Warning: This will erase the carried-forward balance from this rep customer's history. If the debt is still owed, it will vanish from all records permanently.`;
confirmMsg += `\n\nOnly delete if this was entered by mistake or has already been fully settled elsewhere.`;
} else if (_rtPayType === 'COLLECTION') {
confirmTitle = 'Delete Rep Bulk Collection';
confirmMsg = `Delete this bulk collection payment?\n\nRep: ${_rtRep}\nCustomer: ${_rtCust}\nDate: ${_rtDate}\nAmount Collected: ${fmtAmt(_rtAmt)}`;
confirmMsg += `\n\n\u21a9 This will reverse the collection and restore the customer's outstanding balance with this rep.`;
} else if (_rtPayType === 'PARTIAL_PAYMENT') {
confirmTitle = 'Delete Rep Partial Payment';
confirmMsg = `Delete this partial payment?\n\nRep: ${_rtRep}\nCustomer: ${_rtCust}\nDate: ${_rtDate}\nPayment: ${fmtAmt(_rtAmt)}`;
confirmMsg += `\n\n\u21a9 This will reverse the partial payment and restore the pending credit balance on the linked rep sale.`;
} else if (_rtPayType === 'CREDIT') {
confirmTitle = 'Delete Rep Credit Sale';
confirmMsg = `Delete this credit sale permanently?\n\nRep: ${_rtRep}\nCustomer: ${_rtCust}\nDate: ${_rtDate}\nQty: ${_rtQty} kg — ${fmtAmt(_rtAmt)}`;
if (_rtPartialPaid > 0) confirmMsg += `\n\n\u26a0 ${fmtAmt(_rtPartialPaid)} has already been partially collected. Deleting will erase both the sale and the partial payment record.`;
else if (transaction.creditReceived) confirmMsg += `\n\n\u26a0 This sale is already marked PAID. Deleting it will remove the payment record from this rep\'s account.`;
else confirmMsg += `\n\n\u26a0 This credit sale is UNPAID. Deleting will remove the outstanding balance from the rep customer's account and affect the rep's sales totals.`;
} else {
confirmTitle = 'Delete Rep Cash Sale';
confirmMsg = `Delete this cash sale permanently?\n\nRep: ${_rtRep}\nCustomer: ${_rtCust}\nDate: ${_rtDate}\nQty: ${_rtQty} kg — ${fmtAmt(_rtAmt)}`;
confirmMsg += `\n\n\u21a9 ${_rtQty} kg will be restored to inventory.`;
}
confirmMsg += `\n\nThis cannot be undone.`;
if (await showGlassConfirm(confirmMsg, { title: confirmTitle || 'Delete Rep Transaction', confirmText: "Delete", danger: true })) {
try {
const deletedQuantity = transaction.quantity || 0;
const wasCredit = transaction.paymentType === 'CREDIT';
const wasPartialPayment = transaction.paymentType === 'PARTIAL_PAYMENT';
const wasCollection = transaction.paymentType === 'COLLECTION';
const paymentAmount = transaction.totalValue || 0;
const relatedSaleId = transaction.relatedSaleId;
if (wasPartialPayment && relatedSaleId) {
const relatedSale = repSales.find(s => s.id === relatedSaleId);
if (relatedSale) {
relatedSale.partialPaymentReceived = (relatedSale.partialPaymentReceived || 0) - paymentAmount;
if (relatedSale.partialPaymentReceived < 0) relatedSale.partialPaymentReceived = 0;
if (relatedSale.partialPaymentReceived === 0) {
relatedSale.creditReceived = false;
delete relatedSale.creditReceivedDate;
}
relatedSale.updatedAt = getTimestamp();
}
}
transaction.deletedAt = getTimestamp();
transaction.updatedAt = getTimestamp();
repSales = repSales.filter(t => t.id !== id);
await unifiedDelete('rep_sales', repSales, id);
if (wasPartialPayment && relatedSaleId) {
const relatedSale = repSales.find(s => s.id === relatedSaleId);
if (relatedSale) {
await saveRecordToFirestore('rep_sales', relatedSale);
}
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
message += ` Payment of ${await formatCurrency(refundAmount)} reversed.`;
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
(Array.isArray(repSales) ? repSales : []).filter(s => s && s.salesRep === currentRepProfile) :
(Array.isArray(customerSales) ? customerSales : []).filter(s => s && s.isRepModeEntry !== true);
const existingNames = [...new Set(
allSales
.map(s => s && s.customerName ? s.customerName : null)
.filter(n => n !== null && n !== undefined && n !== '' && typeof n === 'string')
.map(n => {
try {
return String(n).trim().toLowerCase();
} catch (e) {
return null;
}
})
.filter(n => n !== null && n !== '')
)];
let safeQuery = '';
try {
safeQuery = query ? String(query).trim().toLowerCase() : '';
} catch (e) {
safeQuery = '';
}
if (safeQuery.length > 2 && !existingNames.includes(safeQuery)) {
phoneContainer.classList.remove('hidden');
} else {
phoneContainer.classList.add('hidden');
}
}
function handleUniversalSearch(inputId, resultsId, dataSource) {
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
case 'customers':
const uniqueCustomers = [...new Set(customerSales
.filter(s => s && s.isRepModeEntry !== true)
.map(s => s.customerName)
.filter(n => n && typeof n === 'string'))];
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
case 'repCustomers':
const repUniqueCustomers = [...new Set(repSales
.filter(s => s && s.salesRep === currentRepProfile)
.map(s => s.customerName)
.filter(n => n && typeof n === 'string'))];
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
const originalSelectCustomer = window.selectCustomer || selectCustomer;
window.selectCustomer = function(name) {
originalSelectCustomer(name);
document.getElementById('new-customer-phone-container').classList.add('hidden');
document.getElementById('new-cust-phone').value = '';
};
const originalSelectRepCustomer = window.selectRepCustomer || selectRepCustomer;
window.selectRepCustomer = function(name) {
originalSelectRepCustomer(name);
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
<svg class="ptr-svg" id="ptr-svg" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
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
const ThemeManager = {
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
const PerformanceMonitor = {
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
async function showDeltaSyncDetails() {
if (!firebaseDB || !currentUser) {
showToast('Please log in to view Firestore structure', 'warning', 3000);
return;
}
const statsInitialized = await initializeSyncStatsIfNeeded();
if (statsInitialized) {
}
const loadingModal = document.createElement('div');
loadingModal.id = 'delta-stats-modal';
loadingModal.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 10000;';
loadingModal.innerHTML = `
<div style="background: var(--glass); padding: 40px; border-radius: 100px; text-align: center;">
<div style="margin-bottom: 15px; font-size: 4rem; line-height: 1;">🐦‍🔥</div>
<div style="color: var(--text); font-size: 1rem;">Loading Firestore</div>
</div>
`;
document.body.appendChild(loadingModal);
try {
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
const [
productionSnap, salesSnap, calcHistorySnap, repSalesSnap, repCustomersSnap,
salesCustomersSnap,
transactionsSnap, entitiesSnap, inventorySnap, factoryHistorySnap,
returnsSnap, expensesSnap, deletionsSnap,
settingsDoc, factorySettingsDoc, expenseCategoriesDoc, teamDoc
] = await Promise.all([
userRef.collection('production').get(),
userRef.collection('sales').get(),
userRef.collection('calculator_history').get(),
userRef.collection('rep_sales').get(),
userRef.collection('rep_customers').get(),
userRef.collection('sales_customers').get(),
userRef.collection('transactions').get(),
userRef.collection('entities').get(),
userRef.collection('inventory').get(),
userRef.collection('factory_history').get(),
userRef.collection('returns').get(),
userRef.collection('expenses').get(),
userRef.collection('deletions').get(),
userRef.collection('settings').doc('config').get(),
userRef.collection('factorySettings').doc('config').get(),
userRef.collection('expenseCategories').doc('categories').get(),
userRef.collection('settings').doc('team').get()
]);
const stats = await DeltaSync.getSyncStats();
const collections = [
{ name: 'production', snap: productionSnap, icon: '', description: 'Production records (db)' },
{ name: 'sales', snap: salesSnap, icon: '', description: 'Customer sales (customerSales)' },
{ name: 'rep_sales', snap: repSalesSnap, icon: '', description: 'Representative sales (repSales)' },
{ name: 'rep_customers', snap: repCustomersSnap, icon: '', description: 'Rep customers with contacts (repCustomers)' },
{ name: 'sales_customers', snap: salesCustomersSnap, icon: '', description: 'Sales customers with contacts (salesCustomers)' },
{ name: 'calculator_history', snap: calcHistorySnap, icon: '', description: 'Calculator history (salesHistory)' },
{ name: 'transactions', snap: transactionsSnap, icon: '', description: 'Payment transactions (paymentTransactions)' },
{ name: 'entities', snap: entitiesSnap, icon: '', description: 'Payment entities (paymentEntities)' },
{ name: 'inventory', snap: inventorySnap, icon: '', description: 'Factory inventory (factoryInventoryData)' },
{ name: 'factory_history', snap: factoryHistorySnap,icon: '', description: 'Factory history (factoryProductionHistory)' },
{ name: 'returns', snap: returnsSnap, icon: '', description: 'Stock returns (stockReturns)' },
{ name: 'expenses', snap: expensesSnap, icon: '', description: 'Expense records (expenseRecords)' },
{ name: 'deletions', snap: deletionsSnap, icon: '', description: 'Tombstones (deletedRecordIds)' }
];
const documents = [
{
name: 'settings/config',
doc: settingsDoc,
icon: '',
description: 'App settings (defaultSettings, last_synced)',
keys: ['naswar_default_settings', 'last_synced', 'initialized_at', 'version']
},
{
name: 'settings/team',
doc: teamDoc,
icon: '',
description: 'Team lists (salesRepsList, userRolesList)',
keys: ['sales_reps', 'user_roles', 'updated_at']
},
{
name: 'factorySettings/config',
doc: factorySettingsDoc,
icon: '',
description: 'Factory formulas & costs (factoryDefaultFormulas, factoryAdditionalCosts, factoryUnitTracking)',
keys: ['default_formulas', 'additional_costs', 'cost_adjustment_factor', 'sale_prices', 'unit_tracking']
},
{
name: 'expenseCategories/categories',
doc: expenseCategoriesDoc,
icon: '',
description: 'Expense categories (expenseCategories)',
keys: ['categories']
}
];
let html = `
<div style="background: var(--glass); padding: 20px; border-radius: 20px; max-width: 700px; max-height: 80vh; overflow-y: auto;">
<h3 style="margin: 0 0 15px 0; color: var(--accent); display:flex; align-items:center; gap:8px;"> Firestore Database Structure</h3>
<div style="margin-bottom: 20px; padding: 12px; background: var(--input-bg); border-radius: 16px; border-left: 3px solid var(--accent);">
<div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 5px;">Database Path:</div>
<div style="font-size: 0.8rem; color: var(--accent); font-family: 'Geist Mono', 'Courier New', monospace;">
users/${currentUser.uid}/
</div>
</div>
<div id="device-manager-section" style="margin-bottom: 20px; padding: 15px; background: var(--input-bg); border-radius: 16px; border: 2px solid var(--accent);">
<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
<h4 style="margin: 0; color: var(--accent); font-size: 0.9rem; display:flex; align-items:center; gap:6px;"> Connected Devices</h4>
<button onclick="refreshDeviceList()" style="padding: 5px 10px; background: var(--glass); border: 1px solid var(--glass-border); border-radius: 12px; color: var(--text); cursor: pointer; font-size: 0.7rem; display:flex; align-items:center; gap:4px;">
Refresh
</button>
</div>
<div id="device-list-container" style="max-height: 300px; overflow-y: auto;">
<div class="u-empty-state-sm" >
Loading devices...
</div>
</div>
</div>
<div class="u-mb-20" >
<h4 style="margin: 0 0 10px 0; color: var(--text); font-size: 0.9rem;"> Collections (${collections.length})</h4>
`;
let totalDocs = 0;
const actualReads = firestoreStats.reads || 0;
const actualWrites = firestoreStats.writes || 0;
collections.forEach(col => {
const count = col.snap.size;
totalDocs += count;
const stat = stats[col.name] || { syncCount: 0, totalReads: 0, totalWrites: 0, lastSync: null };
const lastSync = stat.lastSync ? new Date(stat.lastSync).toLocaleString() : 'Never';
const hasListener = col.name !== 'deletions';
html += `
<div style="margin-bottom: 10px; padding: 12px; background: var(--input-bg); border-radius: 16px; border: 1px solid var(--glass-border);">
<div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
<div>
<div style="font-weight: 600; font-size: 0.85rem; color: var(--text);">
${col.icon} ${col.name}
</div>
<div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px;">
${col.description}
</div>
</div>
<div style="text-align: right;">
<div style="font-size: 0.75rem; font-weight: 600; color: var(--accent);">
${count} docs
</div>
${hasListener ? '<div style="font-size: 0.65rem; color: #30d158;">● Live</div>' : '<div style="font-size: 0.65rem; color: var(--text-muted);">○ Polling</div>'}
</div>
</div>
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.65rem; color: var(--text-muted);">
<div>Syncs: ${stat.syncCount || 0}</div>
<div>Last: ${lastSync}</div>
</div>
</div>
`;
});
html += `
</div>
<div class="u-mb-20" >
<h4 style="margin: 0 0 10px 0; color: var(--text); font-size: 0.9rem;"> Configuration Documents (${documents.length})</h4>
`;
documents.forEach(docInfo => {
const exists = docInfo.doc.exists;
const data = exists ? docInfo.doc.data() : null;
const hasListener = true;
html += `
<div style="margin-bottom: 10px; padding: 12px; background: var(--input-bg); border-radius: 16px; border: 1px solid var(--glass-border);">
<div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
<div>
<div style="font-weight: 600; font-size: 0.85rem; color: var(--text);">
${docInfo.icon} ${docInfo.name}
</div>
<div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px;">
${docInfo.description}
</div>
</div>
<div style="text-align: right;">
<div style="font-size: 0.75rem; font-weight: 600; color: ${exists ? 'var(--accent)' : '#ff453a'};">
${exists ? ' Exists' : ' Missing'}
</div>
${hasListener ? '<div style="font-size: 0.65rem; color: #30d158;">● Live</div>' : ''}
</div>
</div>
`;
if (exists && data) {
html += `<div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 6px;">`;
html += `<div style="font-weight: 600; margin-bottom: 4px;">Fields:</div>`;
docInfo.keys.forEach(key => {
const hasKey = key in data;
const value = data[key];
let valueStr = '';
if (typeof value === 'object' && value !== null) {
if (Array.isArray(value)) {
valueStr = `Array(${value.length})`;
} else {
valueStr = `Object(${Object.keys(value).length} keys)`;
}
} else if (typeof value === 'string') {
valueStr = value.length > 30 ? value.substring(0, 30) + '...' : value;
} else {
valueStr = String(value);
}
html += `
<div style="padding: 2px 0; display: flex; justify-content: space-between;">
<span style="color: ${hasKey ? 'var(--text)' : '#ff453a'};">
${hasKey ? '' : ''} ${key}
</span>
${hasKey ? `<span style="color: var(--text-muted); font-family: 'Geist Mono', 'Courier New', monospace; font-size: 0.65rem;">${valueStr}</span>` : ''}
</div>
`;
});
html += `</div>`;
}
html += `</div>`;
});
html += `
</div>
<div style="padding: 15px; background: var(--input-bg); border-radius: 16px; border: 2px solid var(--accent); margin-bottom: 15px;">
<h4 style="margin: 0 0 10px 0; color: var(--accent); font-size: 0.85rem;">Firestore Usage Summary</h4>
<div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; font-size: 0.75rem;">
<div>
<div style="color: var(--text-muted); font-size: 0.65rem;">Total Documents</div>
<div style="color: var(--text); font-weight: 600; font-size: 1rem;">${totalDocs}</div>
</div>
<div>
<div style="color: var(--text-muted); font-size: 0.65rem;">Firestore Reads</div>
<div style="color: #30d158; font-weight: 600; font-size: 1rem;">${actualReads}</div>
</div>
<div>
<div style="color: var(--text-muted); font-size: 0.65rem;">Firestore Writes</div>
<div style="color: #007aff; font-weight: 600; font-size: 1rem;">${actualWrites}</div>
</div>
</div>
<div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--glass-border); font-size: 0.65rem; color: var(--text-muted);">
<div class="u-row-between" >
<span style="display:flex;align-items:center;gap:4px;">Tracking Period:</span>
<span style="color: var(--text);">${(() => {
const hours = Math.floor((Date.now() - firestoreStats.lastReset) / (1000 * 60 * 60));
if (hours < 1) return 'Less than 1 hour';
if (hours === 1) return '1 hour';
if (hours < 24) return hours + ' hours';
const days = Math.floor(hours / 24);
return days + (days === 1 ? ' day' : ' days');
})()}</span>
</div>
<div style="margin-top: 5px; font-size: 0.6rem; color: var(--text-muted);">
ℹ Stats auto-reset every 24 hours • Reads & writes tracked from actual Firestore operations
</div>
</div>
</div>
<div style="padding: 12px; background: rgba(48, 209, 88, 0.1); border-radius: 16px; border: 1px solid rgba(48, 209, 88, 0.3); margin-bottom: 15px;">
<div style="font-size: 0.75rem; color: #30d158; font-weight: 600; margin-bottom: 5px;">
Active Realtime Listeners
</div>
<div style="font-size: 0.7rem; color: var(--text);">
${collections.filter(c => c.name !== 'deletions').length} collection listeners + 4 document listeners active
</div>
<div style="font-size: 0.65rem; color: var(--text-muted); margin-top: 5px;">
Updates sync automatically in background when data changes in Firestore
</div>
</div>
<button onclick="(async()=>{ await DeltaSync.clearAllTimestamps(); await updateDeltaSyncStatsDisplay(); document.getElementById('delta-stats-modal').remove(); })()"
style="width: 100%; padding: 10px; margin-bottom: 10px; background: rgba(255, 69, 58, 0.1); border: 1px solid rgba(255, 69, 58, 0.3); border-radius: 16px; color: #ff453a; cursor: pointer; font-size: 0.75rem;">
Reset Sync History
</button>
<button onclick="(async()=>{ document.getElementById('delta-stats-modal').remove(); setTimeout(() => showCloseFinancialYearDialog(), 300); })()"
style="width: 100%; padding: 10px; margin-bottom: 10px; background: rgba(175, 82, 222, 0.1); border: 1px solid rgba(175, 82, 222, 0.3); border-radius: 16px; color: #af52de; cursor: pointer; font-size: 0.75rem;">
Close Financial Year
</button>
<button onclick="document.getElementById('delta-stats-modal').remove();"
style="width: 100%; padding: 10px; background: var(--glass); border: 1px solid var(--glass-border); border-radius: 16px; color: var(--text); cursor: pointer; font-size: 0.75rem;">
Close
</button>
</div>
`;
loadingModal.innerHTML = html;
setTimeout(() => {
if (typeof loadDeviceList === 'function') {
loadDeviceList();
}
}, 500);
} catch (error) {
console.error('An unexpected error occurred.', error);
showToast('An unexpected error occurred.', 'error');
loadingModal.innerHTML = `
<div style="background: var(--glass); padding: 40px; border-radius: 20px; text-align: center; max-width: 400px;">
<div class="u-mb-15" ></div>
<div style="color: var(--text); font-size: 1rem; margin-bottom: 20px;">
Error loading database structure
</div>
<button onclick="document.getElementById('delta-stats-modal').remove();"
style="padding: 10px 20px; background: var(--accent); border: none; border-radius: 16px; color: white; cursor: pointer;">
Close
</button>
</div>
`;
}
}
let closeYearInProgress = false;
let closeYearAbortController = null;
let _fyVerifiedPassword = null; 

let pendingFirestoreYearClose = false;

function _storeCodeToLabel(c) {
  if (c === 'STORE_A') return 'ZUBAIR';
  if (c === 'STORE_B') return 'MAHMOOD';
  if (c === 'STORE_C') return 'ASAAN';
  return c;
}
async function showCloseFinancialYearDialog() {
if (closeYearInProgress) {
showToast('Close Financial Year is already in progress', 'warning');
return;
}
const summary = await generateCloseYearSummary();
const modal = document.createElement('div');
modal.id = 'close-year-modal';
modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);display:flex;align-items:center;justify-content:center;z-index:100000;overflow-y:auto;padding:16px;backdrop-filter:blur(3px) saturate(0.8);-webkit-backdrop-filter:blur(3px) saturate(0.8);animation:confirmBackdropIn 0.20s ease;';
modal.innerHTML = `
<style>
@keyframes _cyModalIn {
  from { opacity:0; transform:scale(0.88) translateY(24px); filter:blur(6px); }
  to   { opacity:1; transform:scale(1) translateY(0); filter:blur(0); }
}
@keyframes _cyRowIn {
  from { opacity:0; transform:translateX(-6px); }
  to   { opacity:1; transform:translateX(0); }
}
@keyframes _cyCheckPop {
  0%   { transform:scale(0.2) rotate(-18deg); opacity:0; }
  55%  { transform:scale(1.20) rotate(4deg);  opacity:1; }
  75%  { transform:scale(0.96) rotate(-1deg); }
  100% { transform:scale(1) rotate(0);        opacity:1; }
}
@keyframes _cyShimmer {
  0%   { background-position:-200% center; }
  100% { background-position:200% center; }
}
@keyframes _cyGlowPulse {
  0%,100% { opacity:0.5; }
  50%      { opacity:1; }
}
#cy-panel {
  background: linear-gradient(160deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0) 50%), rgba(16,18,24,0.97);
  border-radius: 24px;
  max-width: 560px;
  width: 100%;
  max-height: 94vh;
  overflow-y: auto;
  border: 1px solid rgba(255,255,255,0.11);
  box-shadow:
    0 1px 0 rgba(255,255,255,0.06) inset,
    0 0 0 1px rgba(0,0,0,0.55),
    0 32px 80px rgba(0,0,0,0.75),
    0 8px 24px rgba(0,0,0,0.45);
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.08) transparent;
  animation: _cyModalIn 0.28s cubic-bezier(0.22,1,0.36,1) forwards;
  position: relative;
}
#cy-panel::after {
  content: '';
  position: absolute;
  top: 0; left: 12%; right: 12%;
  height: 1px;
  border-radius: 999px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent);
  pointer-events: none;
  z-index: 0;
}
[data-theme="light"] #cy-panel {
  background: linear-gradient(160deg, rgba(255,255,255,0.9) 0%, rgba(248,249,252,0.97) 100%);
  border-color: rgba(0,0,0,0.09);
  box-shadow:
    0 1px 0 rgba(255,255,255,1) inset,
    0 0 0 1px rgba(0,0,0,0.06),
    0 24px 60px rgba(0,0,0,0.16),
    0 6px 16px rgba(0,0,0,0.08);
}
[data-theme="light"] #cy-panel::after {
  background: linear-gradient(90deg, transparent, rgba(0,0,0,0.08), transparent);
}
/* ─── Header ─── */
#cy-header {
  padding: 20px 22px 15px;
  display: flex;
  align-items: center;
  gap: 14px;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  position: sticky;
  top: 0;
  background: inherit;
  z-index: 2;
  border-radius: 24px 24px 0 0;
}
[data-theme="light"] #cy-header {
  border-bottom-color: rgba(0,0,0,0.07);
}
#cy-header-icon {
  flex-shrink: 0;
  width: 44px; height: 44px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(239,83,80,0.18) 0%, rgba(239,83,80,0.05) 100%);
  border: 1px solid rgba(239,83,80,0.30);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 0 0 1px rgba(239,83,80,0.12) inset, 0 4px 14px rgba(239,83,80,0.14);
}
/* ─── Data rows ─── */
.cy-data-row {
  display: flex;
  align-items: stretch;
  border-radius: var(--radius-lg, 12px);
  border: 1px solid rgba(255,255,255,0.07);
  overflow: hidden;
  transition: border-color 0.35s ease, box-shadow 0.35s ease;
  animation: _cyRowIn 0.28s ease both;
  position: relative;
}
[data-theme="light"] .cy-data-row {
  border-color: var(--glass-border);
  background: rgba(0,0,0,0.02);
}
.cy-data-row.cy-no-data { opacity: 0.32; }
.cy-accent-stripe {
  width: 3px;
  flex-shrink: 0;
  align-self: stretch;
}
.cy-row-body {
  flex: 1;
  padding: 10px 13px;
  min-width: 0;
  background: rgba(255,255,255,0.02);
}
[data-theme="light"] .cy-row-body { background: transparent; }
.cy-row-top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cy-row-label {
  flex: 1; min-width: 0;
  font-size: 0.81rem; font-weight: 700;
  font-family: 'Bricolage Grotesque', system-ui, sans-serif;
  letter-spacing: -0.01em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cy-rec-badge {
  font-size: 0.66rem; font-weight: 700;
  padding: 2px 8px; border-radius: 999px;
  background: rgba(255,179,0,0.12); color: var(--warning);
  border: 1px solid rgba(255,179,0,0.22);
  flex-shrink: 0; font-family: 'Geist Mono', monospace;
  letter-spacing: 0.02em;
}
.cy-arrow { font-size: 0.62rem; color: rgba(255,255,255,0.22); flex-shrink: 0; }
[data-theme="light"] .cy-arrow { color: rgba(0,0,0,0.22); }
.cy-after-badge {
  font-size: 0.66rem; font-weight: 700;
  padding: 2px 9px; border-radius: 999px;
  flex-shrink: 0; font-family: 'Geist', sans-serif;
  max-width: 168px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  transition: color 0.4s ease;
  border-width: 1px; border-style: solid;
}
.cy-status-badge {
  display: none;
  font-size: 0.58rem; font-weight: 800;
  text-transform: uppercase; letter-spacing: 0.07em;
  padding: 2px 8px; border-radius: 999px;
  background: rgba(105,240,174,0.12); color: var(--accent-emerald);
  border: 1px solid rgba(105,240,174,0.25);
  flex-shrink: 0; white-space: nowrap;
}
.cy-skipped-text {
  font-size: 0.67rem; color: rgba(255,255,255,0.26);
  font-style: italic; flex-shrink: 0;
}
[data-theme="light"] .cy-skipped-text { color: rgba(0,0,0,0.28); }
.cy-detail-chips {
  margin-top: 5px;
  display: flex; flex-wrap: wrap; gap: 0 2px;
  align-items: center; line-height: 1.9;
  transition: all 0.35s ease;
}
.cy-chip-lbl { font-size: 0.68rem; color: var(--text-muted); }
.cy-chip-val { font-size: 0.68rem; font-weight: 700; margin-right: 9px; }
.cy-result-block {
  display: none;
  margin-top: 7px; padding: 7px 11px; border-radius: var(--radius-base, 8px);
  animation: cy-fade-in 0.32s ease;
  border-width: 1px; border-style: solid;
}
.cy-result-inner  { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.cy-result-lbl    { font-size: 0.73rem; font-weight: 700; }
.cy-result-tag    { font-size: 0.62rem; color: var(--text-muted); font-family: 'Geist Mono', monospace; }
.cy-result-note   { font-size: 0.67rem; color: var(--text-muted); margin-top: 3px; line-height: 1.45; }
/* ─── Progress ─── */
#cy-progress-inner {
  margin: 14px 22px 0;
  padding: 13px 15px;
  border-radius: var(--radius-lg, 12px);
  background: rgba(255,255,255,0.025);
  border: 1px solid rgba(255,255,255,0.07);
}
[data-theme="light"] #cy-progress-inner {
  background: rgba(0,0,0,0.025);
  border-color: var(--glass-border);
}
#cy-progress-meta { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
#cy-progress-meta-stage { font-size:0.75rem; color:var(--text-muted); font-family:'Geist',sans-serif; }
#cy-progress-meta-stage b { font-weight:700; color:var(--accent); }
#cy-progress-pct { font-size:0.73rem; font-weight:800; color:var(--accent); font-family:'Geist Mono',monospace; }
#cy-progress-track {
  width:100%; height:4px;
  background:rgba(255,255,255,0.06);
  border-radius:999px; overflow:hidden;
}
[data-theme="light"] #cy-progress-track { background:rgba(0,0,0,0.08); }
#close-year-progress-bar {
  width:0%; height:100%;
  background: linear-gradient(90deg, var(--accent) 0%, var(--accent-emerald) 100%);
  transition: width 0.5s cubic-bezier(0.4,0,0.2,1);
  border-radius:999px;
  background-size: 200% 100%;
  animation: _cyShimmer 1.8s linear infinite;
}
/* ─── Password section ─── */
#cy-input-wrap { padding: 14px 22px 20px; }
#cy-danger-notice {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 12px 14px;
  background: linear-gradient(135deg, rgba(239,83,80,0.09), rgba(239,83,80,0.03));
  border: 1px solid rgba(239,83,80,0.22);
  border-radius: var(--radius-lg, 12px);
  margin-bottom: 12px;
}
#cy-danger-icon-wrap {
  flex-shrink: 0; width: 32px; height: 32px;
  border-radius: var(--radius-base, 8px);
  background: rgba(239,83,80,0.13);
  border: 1px solid rgba(239,83,80,0.24);
  display: flex; align-items: center; justify-content: center;
}
#cy-danger-title { margin:0 0 3px; color:rgba(255,110,100,0.95); font-size:0.79rem; font-weight:700; }
#cy-danger-desc  { margin:0; color:var(--text-muted); font-size:0.72rem; line-height:1.5; }
#cy-pwd-field { position:relative; margin-bottom:4px; }
#close-year-confirm-input {
  width: 100%;
  padding: 11px 42px 11px 13px;
  background: rgba(255,255,255,0.04);
  border: 1.5px solid rgba(255,255,255,0.10);
  border-radius: var(--radius-lg, 12px);
  color: var(--text-main); font-size: 0.87rem;
  box-sizing: border-box;
  transition: border-color 0.2s, box-shadow 0.2s;
  outline: none;
  font-family: 'Geist', sans-serif;
  -webkit-font-smoothing: antialiased;
}
[data-theme="light"] #close-year-confirm-input {
  background: rgba(0,0,0,0.03);
  border-color: var(--glass-border);
}
#close-year-confirm-input:focus {
  border-color: rgba(239,83,80,0.55);
  box-shadow: 0 0 0 3px rgba(239,83,80,0.10);
}
#cy-pwd-eye {
  position:absolute; right:12px; top:50%; transform:translateY(-50%);
  background:none; border:none; cursor:pointer; padding:4px;
  color:var(--text-muted); line-height:0; transition:color 0.15s;
}
#cy-pwd-eye:hover { color:var(--text-main); }
#close-year-pwd-error {
  min-height: 18px; padding: 0 2px;
  font-size: 0.71rem; color: var(--danger);
  display: none; font-family: 'Geist', sans-serif;
  animation: cy-fade-in 0.2s ease;
}
#cy-btn-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 9px;
  margin-top: 11px;
}
#close-year-confirm-btn {
  padding: 12px 18px;
  background: linear-gradient(135deg, var(--danger) 0%, #c0392b 100%);
  border: none; border-radius: var(--radius-lg, 12px);
  color: #fff; font-weight: 700; cursor: not-allowed;
  font-size: 0.86rem; opacity: 0.38;
  transition: all 0.2s cubic-bezier(0.25,1,0.5,1);
  letter-spacing: 0.01em;
  font-family: 'Bricolage Grotesque', system-ui, sans-serif;
  box-shadow: 0 1px 0 rgba(255,255,255,0.14) inset;
}
#close-year-confirm-btn:not([disabled]):hover {
  transform: translateY(-1px);
  box-shadow: 0 1px 0 rgba(255,255,255,0.14) inset, 0 6px 20px rgba(239,83,80,0.38);
  filter: brightness(1.08);
}
#close-year-confirm-btn:not([disabled]):active { transform:translateY(0); }
#cy-cancel-btn {
  padding: 12px 18px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: var(--radius-lg, 12px);
  color: var(--text-muted); cursor: pointer;
  font-size: 0.84rem; font-weight: 600;
  transition: all 0.18s ease;
  font-family: 'Geist', sans-serif; white-space: nowrap;
}
[data-theme="light"] #cy-cancel-btn {
  background: var(--glass-raised); border-color: var(--glass-border);
}
#cy-cancel-btn:hover {
  background: rgba(255,255,255,0.10);
  border-color: rgba(255,255,255,0.18);
  color: var(--text-main);
}
/* ─── Completion card ─── */
#close-year-complete { display:none; padding: 0 16px 20px; }
#cy-done-card {
  position: relative; overflow: hidden;
  border-radius: var(--radius-xl, 16px);
  padding: 24px 20px 20px;
  background: linear-gradient(135deg, rgba(105,240,174,0.09) 0%, rgba(105,240,174,0.02) 100%);
  border: 1px solid rgba(105,240,174,0.20);
  text-align: center;
}
#cy-done-card::before {
  content: '';
  position: absolute; top: 0; left: 14%; right: 14%;
  height: 1px; border-radius: 999px;
  background: linear-gradient(90deg, transparent, rgba(105,240,174,0.45), transparent);
  animation: _cyGlowPulse 2.4s ease infinite;
}
#cy-done-checkmark {
  display: inline-flex; align-items: center; justify-content: center;
  width: 56px; height: 56px; border-radius: 16px;
  background: linear-gradient(135deg, rgba(105,240,174,0.18), rgba(105,240,174,0.05));
  border: 1px solid rgba(105,240,174,0.30);
  margin-bottom: 14px;
  animation: _cyCheckPop 0.45s cubic-bezier(0.34,1.5,0.64,1) forwards;
  box-shadow: 0 0 0 8px rgba(105,240,174,0.05), 0 4px 18px rgba(105,240,174,0.16);
}
#cy-done-title {
  margin: 0 0 7px;
  color: var(--accent-emerald);
  font-size: 1.10rem; font-weight: 800;
  font-family: 'Bricolage Grotesque', system-ui, sans-serif;
  letter-spacing: -0.025em;
}
#cy-done-subtitle {
  color: var(--text-muted); font-size: 0.75rem;
  margin: 0 0 18px; line-height: 1.55;
  font-family: 'Geist', sans-serif;
}
#cy-sync-advisory {
  display: flex; align-items: flex-start; gap: 11px;
  padding: 11px 14px; border-radius: var(--radius-base, 8px);
  background: rgba(255,179,0,0.07); border: 1px solid rgba(255,179,0,0.24);
  margin-bottom: 14px; text-align: left;
}
.cy-sync-adv-icon  { font-size: 0.95rem; line-height: 1.3; flex-shrink: 0; margin-top: 1px; }
.cy-sync-adv-title { font-size: 0.72rem; font-weight: 700; color: var(--warning); margin-bottom: 3px; }
.cy-sync-adv-desc  { font-size: 0.67rem; color: var(--text-muted); line-height: 1.45; }
#cy-continue-btn {
  width: 100%; padding: 13px;
  background: linear-gradient(135deg, var(--accent-emerald) 0%, #059669 100%);
  border: none; border-radius: var(--radius-lg, 12px);
  color: #fff; font-weight: 800; cursor: pointer;
  font-size: 0.90rem; letter-spacing: 0.01em;
  font-family: 'Bricolage Grotesque', system-ui, sans-serif;
  box-shadow: 0 1px 0 rgba(255,255,255,0.20) inset, 0 4px 16px rgba(105,240,174,0.22);
  transition: all 0.2s ease;
}
#cy-continue-btn:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
  box-shadow: 0 1px 0 rgba(255,255,255,0.20) inset, 0 7px 22px rgba(105,240,174,0.32);
}
#cy-continue-btn:active { transform: translateY(0); }
</style>

<div id="cy-panel">

  <!-- Header -->
  <div id="cy-header">
    <div id="cy-header-icon">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>
    </div>
    <div style="flex:1;min-width:0;">
      <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;">
        <h2 style="margin:0;color:var(--text-main);font-size:1.04rem;font-weight:800;font-family:'Bricolage Grotesque',system-ui,sans-serif;letter-spacing:-0.025em;">Close Financial Year</h2>
        <span id="cy-phase-badge" style="font-size:0.61rem;font-weight:700;text-transform:uppercase;letter-spacing:0.09em;padding:2px 10px;border-radius:999px;background:rgba(29,233,182,0.10);color:var(--accent);border:1px solid rgba(29,233,182,0.20);transition:all 0.4s ease;font-family:'Geist Mono',monospace;">PREVIEW</span>
      </div>
      <p style="margin:4px 0 0;color:var(--text-muted);font-size:0.72rem;line-height:1.4;font-family:'Geist',sans-serif;" id="cy-panel-subtitle">Compact all records into opening balances — encrypted backup created automatically</p>
    </div>
  </div>

  <!-- Data preview grid -->
  <div style="padding:15px 22px 0;">
    <div id="cy-preview-grid" style="display:grid;gap:6px;">${summary.rowsHtml}</div>
  </div>

  <!-- Progress bar (revealed on execution) -->
  <div id="close-year-progress-container" style="display:none;">
    <div id="cy-progress-inner">
      <div id="cy-progress-meta">
        <span id="cy-progress-meta-stage">Processing: <b id="close-year-stage">Initializing…</b></span>
        <span id="cy-progress-pct">0%</span>
      </div>
      <div id="cy-progress-track">
        <div id="close-year-progress-bar"></div>
      </div>
    </div>
  </div>

  <!-- Password / confirm -->
  <div id="close-year-input-section">
    <div id="cy-input-wrap">
      <div id="cy-danger-notice">
        <div id="cy-danger-icon-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,110,100,0.92)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </div>
        <div>
          <p id="cy-danger-title">Irreversible — original records will be compacted</p>
          <p id="cy-danger-desc">Enter your account password to encrypt the year-end backup and confirm this action.</p>
        </div>
      </div>
      <div id="cy-pwd-field">
        <input type="password" id="close-year-confirm-input" placeholder="Account password"
          autocomplete="current-password"
          oninput="validateCloseYearInput(this.value)"
          onkeydown="if(event.key==='Enter'&&!document.getElementById('close-year-confirm-btn').disabled){verifyAndExecuteCloseYear();}">
        <button type="button" id="cy-pwd-eye" tabindex="-1"
          onclick="(function(b){const i=document.getElementById('close-year-confirm-input');i.type=i.type==='password'?'text':'password';b.querySelector('svg').style.opacity=i.type==='text'?'1':'0.40';})(this)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.40;transition:opacity 0.2s;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </div>
      <div id="close-year-pwd-error"></div>
      <div id="cy-btn-row">
        <button id="close-year-confirm-btn" disabled onclick="verifyAndExecuteCloseYear()">Close Financial Year</button>
        <button id="cy-cancel-btn" onclick="closeCloseYearDialog()">Cancel</button>
      </div>
    </div>
  </div>

  <!-- Completion card — injected dynamically -->
  <div id="close-year-complete"></div>

</div>
`;
document.body.appendChild(modal);
document.getElementById('close-year-confirm-input').focus();
}
function validateCloseYearInput(value) {
const confirmBtn = document.getElementById('close-year-confirm-btn');
const errEl = document.getElementById('close-year-pwd-error');
if (!confirmBtn) return;
if (value.trim().length > 0) {
  confirmBtn.disabled = false;
  confirmBtn.style.opacity = '1';
  confirmBtn.style.cursor = 'pointer';
  confirmBtn.style.boxShadow = '0 3px 10px rgba(255,69,58,0.2)';
  confirmBtn.onclick = verifyAndExecuteCloseYear;
} else {
  confirmBtn.disabled = true;
  confirmBtn.style.opacity = '0.38';
  confirmBtn.style.cursor = 'not-allowed';
  confirmBtn.style.boxShadow = 'none';
  confirmBtn.onclick = null;
}
if (errEl) errEl.style.display = 'none';
}
async function verifyAndExecuteCloseYear() {
const confirmBtn = document.getElementById('close-year-confirm-btn');
const inp = document.getElementById('close-year-confirm-input');
const errEl = document.getElementById('close-year-pwd-error');
const pwd = inp ? inp.value : '';
if (!pwd) {
showToast('Please enter your account password to continue.', 'warning', 3000);
if (inp) inp.focus();
return;
}

if (confirmBtn) {
  confirmBtn.disabled = true;
  confirmBtn.style.opacity = '0.6';
  confirmBtn.textContent = 'Verifying…';
}
if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
const valid = await verifyAccountPassword(pwd);
if (!valid) {

  if (errEl) { errEl.textContent = '✕ Incorrect password — please try again.'; errEl.style.display = 'block'; }
  showToast('Incorrect password. Please try again.', 'error', 4000);
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.style.opacity = '1';
    confirmBtn.textContent = 'Close Financial Year';
    confirmBtn.onclick = verifyAndExecuteCloseYear;
  }
  if (inp) { inp.value = ''; inp.focus(); }
  validateCloseYearInput(''); 
  return;
}

_fyVerifiedPassword = pwd;
executeCloseFinancialYear();
}
function closeCloseYearDialog() {
const modal = document.getElementById('close-year-modal');
if (modal) {
modal.remove();
}
if (closeYearAbortController) {
closeYearAbortController.abort();
closeYearAbortController = null;
}
closeYearInProgress = false;
}
function updateCloseYearProgress(stage, percent) {
const stageEl = document.getElementById('close-year-stage');
const progressBar = document.getElementById('close-year-progress-bar');
const pctEl = document.getElementById('cy-progress-pct');
const phaseBadge = document.getElementById('cy-phase-badge');
if (stageEl) stageEl.textContent = stage;
if (progressBar) progressBar.style.width = percent + '%';
if (pctEl) pctEl.textContent = percent + '%';

const stageMap = {
  'Merging Production Data':   'prod',
  'Production Data Merged':    'prod',
  'Merging Sales Data':        'sales',
  'Sales Data Merged':         'sales',
  'Merging Calculator Data':   'calc',
  'Calculator Data Merged':    'calc',
  'Merging Payment Data':      'pay',
  'Payment Data Merged':       'pay',
  'Merging Factory Data':      'factory',
  'Factory Data Merged':       'factory',
  'Merging Rep Sales Data':    'repsales',
  'Rep Sales Data Merged':     'repsales',
  'Merging Expenses':          'exp',
  'Expenses Merged':           'exp',
  'Merging Stock Returns':     'ret',
  'Stock Returns Merged':      'ret'
};
const rowId = Object.entries(stageMap).find(([k])=>stage.includes(k.replace(' Data','').replace(' Merged','').trim()))?.[1];
if (rowId) {
  const isDone = stage.includes('Merged') || stage.includes('No New') || stage.includes('No Records');
  const statusEl = document.getElementById('cy-status-' + rowId);
  const rowEl    = document.getElementById('cy-row-'    + rowId);
  if (statusEl) { statusEl.style.display = 'inline-flex'; statusEl.classList.add('ok'); }
  if (rowEl && isDone) { rowEl.classList.add('cy-done'); rowEl.style.opacity = '1'; }
}
if (percent >= 100) {
  const pb = document.getElementById('close-year-progress-bar');
  if (pb) pb.classList.add('done');
}
if (phaseBadge) {
  phaseBadge.textContent = 'PROCESSING';
  phaseBadge.style.background = 'rgba(255,179,0,0.15)';
  phaseBadge.style.color = 'var(--warning)';
  phaseBadge.style.borderColor = 'rgba(255,179,0,0.3)';
}

const procSubtitle = document.getElementById('cy-panel-subtitle');
if (procSubtitle && procSubtitle.textContent.includes('will be compacted')) {
  procSubtitle.textContent = '— processing in progress...';
  procSubtitle.style.color = 'var(--warning)';
}
}
async function generateCloseYearSummary() {
const S = {
  production:   { total:0, nonMerged:0, stores: new Set(), returnCount:0, sellerReturns: new Set(), sellerStoreCards: new Set() },
  sales:        { total:0, nonMerged:0, customers: new Set(), settledCount:0, creditCount:0 },
  calculator:   { total:0, nonMerged:0, reps: new Set() },
  payments:     { total:0, nonMerged:0, entities: new Set(), netBalanceCount:0 },
  factory:      { total:0, nonMerged:0, stores: new Set() },
  repSales:     { total:0, nonMerged:0, customers: new Set(), reps: new Set(), settledCount:0, creditCount:0 },
  expenses:     { total:0, nonMerged:0, categories: new Set() },
  stockReturns: { total:0, nonMerged:0, stores: new Set() }
};
if (Array.isArray(db)) {
  S.production.total = db.length;
  db.forEach(i => {
    if (i.store) S.production.stores.add(i.store);
    if (i.isMerged !== true) {
      S.production.nonMerged++;
      if (i.isReturn === true) { S.production.returnCount++; if(i.returnedBy) S.production.sellerReturns.add(i.returnedBy); if(i.returnedBy && i.store) S.production.sellerStoreCards.add(i.returnedBy+'::'+i.store); }
    }
  });
}
if (Array.isArray(customerSales)) {
  S.sales.total = customerSales.length;
  customerSales.forEach(i => {
    if (i.customerName) S.sales.customers.add(i.customerName);
    if (i.isMerged !== true && isDirectSale(i)) {
      S.sales.nonMerged++;
      if (i.paymentType === 'CASH' || (i.paymentType === 'CREDIT' && i.creditReceived)) S.sales.settledCount++;
      else if (i.paymentType === 'CREDIT' && !i.creditReceived) S.sales.creditCount++;
    }
  });
}
if (Array.isArray(salesHistory)) {
  S.calculator.total = salesHistory.length;
  salesHistory.forEach(i => { if (i.seller) S.calculator.reps.add(i.seller); if (i.isMerged !== true) S.calculator.nonMerged++; });
}
if (Array.isArray(paymentTransactions)) {
  S.payments.total = paymentTransactions.length;
  const entityNetMap = {};
  paymentTransactions.forEach(i => {
    const ent = paymentEntities.find(e => e.id === i.entityId);
    if (ent) S.payments.entities.add(ent.name || 'Unknown');
    if (i.isMerged !== true) {
      S.payments.nonMerged++;
      if (!entityNetMap[i.entityId]) entityNetMap[i.entityId] = 0;
      entityNetMap[i.entityId] += (i.type === 'IN' ? 1 : -1) * (i.amount || 0);
    }
  });
  S.payments.netBalanceCount = Object.values(entityNetMap).filter(v => Math.abs(v) > 0.001).length;
}
if (Array.isArray(factoryProductionHistory)) {
  S.factory.total = factoryProductionHistory.length;
  factoryProductionHistory.forEach(i => { if (i.store) S.factory.stores.add(i.store); if (i.isMerged !== true) S.factory.nonMerged++; });
}
if (Array.isArray(repSales)) {
  S.repSales.total = repSales.length;
  repSales.forEach(i => {
    if (i.customerName) S.repSales.customers.add(i.customerName);
    if (i.salesRep) S.repSales.reps.add(i.salesRep);
    if (i.isMerged !== true && isRepSale(i)) {
      S.repSales.nonMerged++;
      if (i.paymentType === 'CASH' || (i.paymentType === 'CREDIT' && i.creditReceived)) S.repSales.settledCount++;
      else if (i.paymentType === 'CREDIT' && !i.creditReceived) S.repSales.creditCount++;
    }
  });
}
if (Array.isArray(expenseRecords)) {
  S.expenses.total = expenseRecords.length;
  expenseRecords.forEach(i => { if (i.category) S.expenses.categories.add(i.category); if (i.isMerged !== true) S.expenses.nonMerged++; });
}
if (Array.isArray(stockReturns)) {
  S.stockReturns.total = stockReturns.length;
  stockReturns.forEach(i => { if (i.store) S.stockReturns.stores.add(i.store); if (i.isMerged !== true) S.stockReturns.nonMerged++; });
}

const storeCodeToLabel = _storeCodeToLabel;
const CY_ICONS = {
  prod:     '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  sales:    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
  calc:     '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/></svg>',
  pay:      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
  factory:  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/></svg>',
  repsales: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  exp:      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  ret:      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.9L1 10"/></svg>'
};
const previewRow = (id, label, key, recCount, details, mergeNote, accent, hasData) => {
  const cssAccentVar = accent.replace('var(--','').replace(')','');
  const detailChips = details.map(([lbl,val]) =>
    '<span class="cy-chip-label">' + lbl + ':&nbsp;</span>' +
    '<span class="cy-chip-val">' + val + '</span>'
  ).join('');
  const resultBlock =
    '<div id="cy-result-' + id + '" class="cy-result-card" style="--cy-accent:' + accent + ';">' +
    '<div class="cy-result-top">' +
    '<span id="cy-result-label-' + id + '" class="cy-result-main"></span>' +
    '<span class="cy-result-tag">compacted</span>' +
    '</div>' +
    '<div id="cy-result-note-' + id + '" class="cy-result-note"></div>' +
    '</div>';
  return (
    '<div id="cy-row-' + id + '" class="cy-row' + (hasData ? '' : ' cy-skipped') + '" style="--cy-accent:' + accent + ';">' +
    '<div class="cy-row-head">' +
      '<div class="cy-row-icon">' + (CY_ICONS[id]||'') + '</div>' +
      '<span class="cy-row-label">' + label + '</span>' +
      (hasData
        ? '<span class="cy-pill cy-pill-count">' + recCount + ' rec</span>' +
          '<span class="cy-arrow">→</span>' +
          '<span id="cy-val-' + id + '-after" class="cy-pill cy-pill-after">' + mergeNote + '</span>'
        : '<span class="cy-pill cy-pill-skip">skipped</span>'
      ) +
      '<span id="cy-status-' + id + '" class="cy-status-badge ok">✓</span>' +
    '</div>' +
    (hasData && details.length
      ? '<div class="cy-chips">' + detailChips + '</div>'
      : '') +
    resultBlock +
    '</div>'
  );
};

let rows = '';
const storeList  = [...S.production.stores].map(storeCodeToLabel).join(', ') || '\u2014';
const sellerList = [...S.production.sellerReturns].join(', ') || 'none';
const prodRetCards   = S.production.sellerStoreCards.size || S.production.sellerReturns.size;
const prodTotalCards = S.production.stores.size + prodRetCards;
rows += previewRow('prod', 'Production', 'mfg_pro_pkr',
  S.production.nonMerged,
  [
    ['Stores', storeList, 'var(--text-main)'],
    ['Returns', S.production.returnCount > 0 ? S.production.returnCount + ' (' + sellerList + ')' : 'none',
      S.production.returnCount > 0 ? 'var(--accent-emerald)' : 'var(--text-muted)'],
  ],
  prodTotalCards + ' cards (' + S.production.stores.size + ' store + ' + prodRetCards + ' ret)',
  'var(--accent)', S.production.nonMerged > 0
);

const custCount = S.sales.customers.size;
rows += previewRow('sales', 'Sales', 'customer_sales',
  S.sales.nonMerged,
  [['Customers', custCount, 'var(--text-main)'],
   ['Settled/Credit', S.sales.settledCount + '/' + S.sales.creditCount, 'var(--text-main)']],
  custCount + ' balance' + (custCount !== 1 ? 's' : ''),
  'var(--accent-emerald)', S.sales.nonMerged > 0
);

const repNameList = [...S.calculator.reps].join(', ') || '\u2014';
rows += previewRow('calc', 'Calculator', 'noman_history',
  S.calculator.nonMerged,
  [['Reps', repNameList, 'var(--text-main)']],
  S.calculator.reps.size + ' rec \u00b7 returns\u2192Prod',
  'var(--accent-cyan)', S.calculator.nonMerged > 0
);

const entCount = S.payments.entities.size;
rows += previewRow('pay', 'Payments', 'payment_transactions',
  S.payments.nonMerged,
  [['Entities', entCount, 'var(--text-main)'],
   ['w/ balance', S.payments.netBalanceCount, 'var(--text-main)']],
  S.payments.netBalanceCount + ' opening bal.',
  'var(--accent-gold)', S.payments.nonMerged > 0
);

const fStores = [...S.factory.stores].map(storeCodeToLabel).join(', ') || '\u2014';
rows += previewRow('factory', 'Factory', 'factory_production_history',
  S.factory.nonMerged,
  [['Stores', fStores, 'var(--text-main)']],
  S.factory.stores.size + ' formula rec.',
  'var(--accent-purple)', S.factory.nonMerged > 0
);

const rcCount = S.repSales.customers.size;
rows += previewRow('repsales', 'Rep Sales', 'rep_sales',
  S.repSales.nonMerged,
  [['Customers/Reps', rcCount + '/' + S.repSales.reps.size, 'var(--text-main)'],
   ['Settled/Credit', S.repSales.settledCount + '/' + S.repSales.creditCount, 'var(--text-main)']],
  '1 per cust \u00d7 rep',
  'var(--store-b)', S.repSales.nonMerged > 0
);

const catList = [...S.expenses.categories].join(', ') || '\u2014';
rows += previewRow('exp', 'Expenses', 'expenses',
  S.expenses.nonMerged,
  [['Categories', catList, 'var(--text-main)']],
  '1 per category + name',
  'var(--warning)', S.expenses.nonMerged > 0
);

const srStores = [...S.stockReturns.stores].map(storeCodeToLabel).join(', ') || '\u2014';
rows += previewRow('ret', 'Stock Returns', 'stock_returns',
  S.stockReturns.nonMerged,
  [['Stores', srStores, 'var(--text-main)']],
  '1 per store + date',
  'var(--danger)', S.stockReturns.nonMerged > 0
);

const rowsHtml = rows;
const html = '<div style="display:grid;gap:4px;">' + rows + '</div>';
return { html, rowsHtml, summary: S };
}

async function createMergeBackup() {
  const backup = {
    db: Array.isArray(db) ? [...db] : [],
    customerSales: Array.isArray(customerSales) ? [...customerSales] : [],
    salesHistory: Array.isArray(salesHistory) ? [...salesHistory] : [],
    paymentTransactions: Array.isArray(paymentTransactions) ? [...paymentTransactions] : [],
    factoryProductionHistory: Array.isArray(factoryProductionHistory) ? [...factoryProductionHistory] : [],
    repSales: Array.isArray(repSales) ? [...repSales] : [],
    expenseRecords: Array.isArray(expenseRecords) ? [...expenseRecords] : [],
    stockReturns: Array.isArray(stockReturns) ? [...stockReturns] : [],
    timestamp: Date.now(),
    date: new Date().toISOString()
  };

  try {
    await idb.set('close_year_backup_' + backup.timestamp, backup);

    return backup.timestamp;
  } catch (e) {
    console.error('Failed to create merge backup:', e);
    throw new Error('Cannot proceed without backup: ' + e.message);
  }
}

async function restoreFromBackup(backupTimestamp) {
  try {
    const backup = await idb.get('close_year_backup_' + backupTimestamp);
    if (!backup) {
      throw new Error('Backup not found: ' + backupTimestamp);
    }

    db = backup.db;
    customerSales = backup.customerSales;
    salesHistory = backup.salesHistory;
    paymentTransactions = backup.paymentTransactions;
    factoryProductionHistory = backup.factoryProductionHistory;
    repSales = backup.repSales;
    expenseRecords = backup.expenseRecords;
    stockReturns = backup.stockReturns;


    await idb.set('mfg_pro_pkr', db);
    await idb.set('customer_sales', customerSales);
    await idb.set('noman_history', salesHistory);
    await idb.set('payment_transactions', paymentTransactions);
    await idb.set('factory_production_history', factoryProductionHistory);
    await idb.set('rep_sales', repSales);
    await idb.set('expenses', expenseRecords);
    await idb.set('stock_returns', stockReturns);


    // Run Firestore rollback in the background — do not block local restore returning
    if (firebaseDB && currentUser) {
      Promise.resolve().then(async () => {
        try {
          const userRef = firebaseDB.collection('users').doc(currentUser.uid);
          const fbCollections = [
            { name: 'production', local: db },
            { name: 'sales', local: customerSales },
            { name: 'calculator_history', local: salesHistory },
            { name: 'transactions', local: paymentTransactions },
            { name: 'factory_history', local: factoryProductionHistory },
            { name: 'rep_sales', local: repSales },
            { name: 'expenses', local: expenseRecords },
            { name: 'returns', local: stockReturns }
          ];
          for (const col of fbCollections) {
            try {
              const snapshot = await userRef.collection(col.name).get();
              const batch = firebaseDB.batch();
              let deleteCount = 0;
              snapshot.docs.forEach(doc => {
                const data = doc.data();
                const docCreatedAt = data.createdAt?.toMillis ? data.createdAt.toMillis() :
                                     (typeof data.createdAt === 'number' ? data.createdAt : 0);
                if (docCreatedAt >= backupTimestamp) {
                  batch.delete(doc.ref);
                  deleteCount++;
                }
              });
              if (deleteCount > 0) {
                await batch.commit();
                await new Promise(r => setTimeout(r, 0)); // yield between collections
              }
            } catch (colErr) {
              console.warn(`Firebase rollback warning for ${col.name}:`, colErr);
            }
          }
        } catch (fbErr) {
          console.warn('Firebase rollback warning:', fbErr);
        }
      }).catch(() => {});
    }


    return true;
  } catch (e) {
    console.error('Failed to restore from backup:', e);
    throw e;
  }
}

async function verifyMergeConsistency(snap) {
  const errors = [];
  const warnings = [];


  if (Array.isArray(db)) {
    const mergedProd = db.filter(i => i.isMerged);
    const totalNet = mergedProd.reduce((s, i) => s + (i.net || 0), 0);
    const totalCost = mergedProd.reduce((s, i) => s + (i.totalCost || 0), 0);
    const totalSale = mergedProd.reduce((s, i) => s + (i.totalSale || 0), 0);
    const expectedProfit = totalSale - totalCost;
    const actualProfit = mergedProd.reduce((s, i) => s + (i.profit || 0), 0);

    if (Math.abs(expectedProfit - actualProfit) > 0.01) {
      errors.push(`Production profit mismatch: expected ${fmtAmt(expectedProfit)}, got ${fmtAmt(actualProfit)}`);
    }
  }


  if (Array.isArray(customerSales)) {
    const mergedSales = customerSales.filter(i => i.isMerged && isDirectSale(i));
    const totalValue = mergedSales.reduce((s, i) => s + (i.totalValue || 0), 0);
    const totalCost = mergedSales.reduce((s, i) => s + (i.totalCost || 0), 0);
    const expectedProfit = totalValue - totalCost;
    const actualProfit = mergedSales.reduce((s, i) => s + (i.profit || 0), 0);

    if (Math.abs(expectedProfit - actualProfit) > 0.01) {
      errors.push(`Sales profit mismatch: expected ${fmtAmt(expectedProfit)}, got ${fmtAmt(actualProfit)}`);
    }


    mergedSales.forEach(sale => {
      if (sale.paymentType === 'CREDIT' && !sale.creditReceived) {
        const expectedCredit = (sale.totalValue || 0) - (sale.partialPaymentReceived || 0);
        if (Math.abs(expectedCredit - (sale.creditValue || 0)) > 0.01) {
          warnings.push(`Credit value mismatch for ${sale.customerName}`);
        }
      }
    });
  }


  if (Array.isArray(paymentTransactions)) {
    const mergedPay = paymentTransactions.filter(i => i.isMerged);
    mergedPay.forEach(pay => {
      if (pay.mergedSummary) {
        const expectedNet = (pay.mergedSummary.originalIn || 0) - (pay.mergedSummary.originalOut || 0);
        const actualAmount = (pay.type === 'IN' ? 1 : -1) * (pay.amount || 0);
        if (Math.abs(expectedNet - actualAmount) > 0.01) {
          errors.push(`Payment balance mismatch for ${pay.entityName}`);
        }
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    timestamp: Date.now()
  };
}

async function executeCloseFinancialYear() {
if (closeYearInProgress) return;
closeYearInProgress = true;

const inputSection  = document.getElementById('close-year-input-section');
const progressContainer = document.getElementById('close-year-progress-container');
const phaseBadge    = document.getElementById('cy-phase-badge');
if (inputSection) inputSection.style.display = 'none';
if (progressContainer) progressContainer.style.display = 'block';

updateCloseYearProgress('Uploading cloud backup...', 3);
try {
  if (!currentUser) throw new Error('Not signed in — cannot create backup');


  try {
    await pushDataToCloud();
    showToast('☁️ Cloud backup uploaded', 'success', 2500);
  } catch (cloudErr) {
    console.warn('Cloud backup warning (proceeding):', cloudErr);
    showToast('Cloud backup skipped (offline?) — local backup will still be created', 'warning', 3500);
  }


  updateCloseYearProgress('Preparing encrypted local backup...', 10);

  

  const _settingsSnapshot = await idb.get('naswar_default_settings', defaultSettings);
  const backupData = {
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
    stockReturns: stockReturns,
    settings: _settingsSnapshot,
    deleted_records: Array.from(deletedRecordIds),
    _meta: {
      encryptedFor:        currentUser.email,
      createdAt:           Date.now(),
      version:             2,
      source:              'financial_year_close',
      isYearCloseBackup:   true,

      fyCloseSnapshot: {
        fyCloseCount:      (_settingsSnapshot.fyCloseCount      || 0),
        lastYearClosedAt:  (_settingsSnapshot.lastYearClosedAt  || null),
        lastYearClosedDate:(_settingsSnapshot.lastYearClosedDate || null),
        capturedAt:        Date.now()
      }
    }
  };


  

  let encPassword = null;
  try {
    encPassword = _fyVerifiedPassword || null;
  } finally {
    _fyVerifiedPassword = null; 
  }


  if (encPassword) {
    try {
      updateCloseYearProgress('Encrypting backup file...', 14);
      const encryptedBlob = await CryptoEngine.encrypt(backupData, currentUser.email, encPassword);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      _triggerFileDownload(encryptedBlob, `NaswarDealers_YearClose_${timestamp}.gznd`);
      showToast('🔐 Encrypted year-end backup downloaded!', 'success', 4000);
    } catch (encErr) {
      console.error('Encryption failed:', encErr);
      showToast('Local backup encryption failed — proceeding with cloud backup only.', 'warning', 4000);
    }
  } else {
    showToast('No verified password — skipping local encrypted backup.', 'info', 2500);
  }
} catch (bkpPhaseErr) {
  console.error('Backup phase error:', bkpPhaseErr);
  const proceed = await showGlassConfirm(
    'Backup could not be completed.\n\nDo you want to proceed with closing the financial year anyway?\n\n\u26a0\ufe0f This is irreversible — proceed only if you have an existing backup.',
    { title: 'Backup Failed', confirmText: 'Proceed Anyway', cancelText: 'Abort' }
  );
  if (!proceed) {
    closeYearInProgress = false;
    closeCloseYearDialog();
    return;
  }
}

updateCloseYearProgress('Creating rollback snapshot...', 20);
let backupTimestamp;
try {
  backupTimestamp = await createMergeBackup();
} catch (backupErr) {
  closeYearInProgress = false;
  showToast('Failed to create rollback snapshot: ' + backupErr.message, 'error');
  closeCloseYearDialog();
  return;
}
closeYearAbortController = new AbortController();
const { signal } = closeYearAbortController;

const snap = {
  prod:    { before: Array.isArray(db)                      ? db.filter(i=>i.isMerged!==true).length : 0 },
  sales:   { before: Array.isArray(customerSales)           ? customerSales.filter(i=>i.isMerged!==true&&isDirectSale(i)).length : 0 },
  calc:    { before: Array.isArray(salesHistory)             ? salesHistory.filter(i=>i.isMerged!==true).length : 0 },
  pay:     { before: Array.isArray(paymentTransactions)      ? paymentTransactions.filter(i=>i.isMerged!==true).length : 0 },
  factory: { before: Array.isArray(factoryProductionHistory) ? factoryProductionHistory.filter(i=>i.isMerged!==true).length : 0 },
  repSales:{ before: Array.isArray(repSales)                ? repSales.filter(i=>i.isMerged!==true&&isRepSale(i)).length : 0 },
  expenses:{ before: Array.isArray(expenseRecords)           ? expenseRecords.filter(i=>i.isMerged!==true).length : 0 },
  returns: { before: Array.isArray(stockReturns)             ? stockReturns.filter(i=>i.isMerged!==true).length : 0 }
};

const liveUpdate = (rowId, afterText, accentColor, resultLabel, resultNote) => {
  const afterEl = document.getElementById('cy-val-' + rowId + '-after');
  if (afterEl) {
    afterEl.textContent = afterText;
    afterEl.style.color = accentColor || 'var(--accent-emerald)';
  }
  const statusEl = document.getElementById('cy-status-' + rowId);
  if (statusEl) statusEl.style.display = 'inline';

  const resultBlock = document.getElementById('cy-result-' + rowId);
  const resultLabelEl = document.getElementById('cy-result-label-' + rowId);
  const resultNoteEl  = document.getElementById('cy-result-note-' + rowId);
  if (resultBlock && resultLabelEl && resultNoteEl) {
    resultLabelEl.textContent = resultLabel || afterText;
    resultNoteEl.textContent  = resultNote  || '';
    resultBlock.style.display = 'block';
  }

  const detailEl = document.getElementById('cy-detail-' + rowId);
  if (detailEl) {
    detailEl.style.opacity = '0.38';
    detailEl.style.fontSize = '0';
    detailEl.style.maxHeight = '0';
    detailEl.style.overflow = 'hidden';
    detailEl.style.transition = 'all 0.35s ease';
  }
};
updateCloseYearProgress('Merging Production Data', 25);
try {
await mergeProductionData(signal);
const prodMerged = Array.isArray(db) ? db.filter(i=>i.isMerged) : [];
const storeMerged  = prodMerged.filter(i=>!i.isReturn).length;
const sellerMerged = prodMerged.filter(i=>i.isReturn).length;
liveUpdate('prod', `${storeMerged} store + ${sellerMerged} seller return card${sellerMerged!==1?'s':''}`, 'var(--accent)', `${storeMerged + sellerMerged} merged cards`, `${storeMerged} store balance${storeMerged!==1?'s':''} + ${sellerMerged} seller return card${sellerMerged!==1?'s':''}`);
snap.prod.after = prodMerged.length;
await mergeSalesData(signal);
snap.sales.after = Array.isArray(customerSales) ? customerSales.filter(i=>i.isMerged&&isDirectSale(i)).length : 0;
liveUpdate('sales', `${snap.sales.after} merged record${snap.sales.after!==1?'s':''}`, 'var(--accent-emerald)', `${snap.sales.after} customer records`, 'One opening balance per customer');
await mergeCalculatorData(signal);
snap.calc.after = Array.isArray(salesHistory) ? salesHistory.filter(i=>i.isMerged).length : 0;
liveUpdate('calc', `${snap.calc.after} merged record${snap.calc.after!==1?'s':''} (sales only)`, 'var(--accent-cyan)', `${snap.calc.after} rep totals`, 'Sales totals only — returns moved to Production Tab');
await mergePaymentData(signal);
snap.pay.after = Array.isArray(paymentTransactions) ? paymentTransactions.filter(i=>i.isMerged).length : 0;
liveUpdate('pay', `${snap.pay.after} opening balance record${snap.pay.after!==1?'s':''}`, 'var(--accent-gold)', `${snap.pay.after} opening balances`, 'Zero-balance entities dropped');
await mergeFactoryData(signal);
snap.factory.after = Array.isArray(factoryProductionHistory) ? factoryProductionHistory.filter(i=>i.isMerged).length : 0;
liveUpdate('factory', `${snap.factory.after} merged record${snap.factory.after!==1?'s':''}`, 'var(--accent-purple)', `${snap.factory.after} formula records`, '1 per formula store');
await mergeRepSalesData(signal);
snap.repSales.after = Array.isArray(repSales) ? repSales.filter(i=>i.isMerged&&isRepSale(i)).length : 0;
liveUpdate('repsales', `${snap.repSales.after} merged record${snap.repSales.after!==1?'s':''}`, 'var(--store-b)', `${snap.repSales.after} rep×customer records`, 'Keyed per customer × rep combination');
await mergeExpensesData(signal);
snap.expenses.after = Array.isArray(expenseRecords) ? expenseRecords.filter(i=>i.isMerged).length : 0;
liveUpdate('exp', `${snap.expenses.after} merged record${snap.expenses.after!==1?'s':''}`, 'var(--warning)', `${snap.expenses.after} expense records`, 'Merged per category + name');
await mergeStockReturnsData(signal);
snap.returns.after = Array.isArray(stockReturns) ? stockReturns.filter(i=>i.isMerged).length : 0;
liveUpdate('ret', `${snap.returns.after} merged record${snap.returns.after!==1?'s':''}`, 'var(--danger)', `${snap.returns.after} return records`, '1 per store + date — granularity preserved');

  const consistencyCheck = await verifyMergeConsistency(snap);
  if (!consistencyCheck.valid) {
    throw new Error(`Data consistency check failed: ${consistencyCheck.errors.join('; ')}`);
  }

try {
  const fyMeta = await idb.get('naswar_default_settings', {});
  fyMeta.lastYearClosedAt   = Date.now();
  fyMeta.lastYearClosedDate = new Date().toISOString();
  fyMeta.fyCloseCount       = (fyMeta.fyCloseCount || 0) + 1;
  fyMeta.lastConsistencyCheck = consistencyCheck;

  const hasSyncWarning = document.querySelectorAll && [...document.querySelectorAll('[id^="cy-status-"]')].some(el => el.textContent.includes('Sync Failed'));
  if (hasSyncWarning) {
    fyMeta.pendingFirestoreYearClose = true;
    pendingFirestoreYearClose = true;
    await idb.set('pendingFirestoreYearClose', true);
  } else {
    fyMeta.pendingFirestoreYearClose = false;
    pendingFirestoreYearClose = false;
    await idb.set('pendingFirestoreYearClose', false);
  }
  await idb.set('naswar_default_settings', fyMeta);
  if (firebaseDB && currentUser) {
    await firebaseDB.collection('users').doc(currentUser.uid)
      .collection('settings').doc('naswar_default_settings')
      .set({ lastYearClosedAt: fyMeta.lastYearClosedAt, lastYearClosedDate: fyMeta.lastYearClosedDate, fyCloseCount: fyMeta.fyCloseCount }, { merge: true });
  }
} catch (metaErr) { console.warn('Could not save FY close metadata:', metaErr); }
if (phaseBadge) {
  phaseBadge.textContent = 'DONE';
  phaseBadge.style.background = 'rgba(52,217,116,0.15)';
  phaseBadge.style.color = 'var(--accent-emerald)';
  phaseBadge.style.borderColor = 'rgba(52,217,116,0.3)';
}
const panelSubtitle = document.getElementById('cy-panel-subtitle');
if (panelSubtitle) {
  panelSubtitle.textContent = 'All records compacted successfully';
  panelSubtitle.style.color = 'var(--accent-emerald)';
  panelSubtitle.style.fontStyle = 'normal';
  panelSubtitle.style.fontWeight = '600';
}
if (progressContainer) progressContainer.style.display = 'none';
const prodMergedFinal   = Array.isArray(db) ? db.filter(i=>i.isMerged) : [];
const storeFinal        = prodMergedFinal.filter(i=>!i.isReturn);
const sellerRetFinal    = prodMergedFinal.filter(i=>i.isReturn);
const storesUsed        = [...new Set(storeFinal.map(i=>i.store))].map(_storeCodeToLabel).join(', ') || '—';
const sellersUsed       = [...new Set(sellerRetFinal.map(i=>i.returnedBy||'?'))].join(', ') || '—';
const completeSection = document.getElementById('close-year-complete');
if (completeSection) {

  const syncFailedRows = ['prod','sales','calc','pay','factory','repsales','exp','ret']
    .filter(id => { const el = document.getElementById('cy-row-' + id); return el && el.style.borderLeftColor && el.style.borderLeftColor.includes('warning') || (el && el.style.borderLeftColor === 'var(--warning)'); });
  const hasSyncWarnings = document.querySelectorAll('[id^="cy-status-"]') &&
    [...document.querySelectorAll('[id^="cy-status-"]')].some(el => el.textContent.includes('Sync Failed'));

  // Collect stats from all merged data
  const totalMergedRecords = [
    ...(Array.isArray(db) ? db.filter(i=>i.isMerged) : []),
    ...(Array.isArray(customerSales) ? customerSales.filter(i=>i.isMerged) : []),
    ...(Array.isArray(salesHistory) ? salesHistory.filter(i=>i.isMerged) : []),
    ...(Array.isArray(paymentTransactions) ? paymentTransactions.filter(i=>i.isMerged) : []),
    ...(Array.isArray(factoryProductionHistory) ? factoryProductionHistory.filter(i=>i.isMerged) : []),
    ...(Array.isArray(repSales) ? repSales.filter(i=>i.isMerged) : []),
    ...(Array.isArray(expenseRecords) ? expenseRecords.filter(i=>i.isMerged) : []),
    ...(Array.isArray(stockReturns) ? stockReturns.filter(i=>i.isMerged) : []),
  ].length;
  const collectionsCompacted = ['prod','sales','calc','pay','factory','repsales','exp','ret']
    .filter(id => { const el = document.getElementById('cy-status-' + id); return el && el.style.display !== 'none'; }).length;
  const fyMeta2 = (typeof fyMeta !== 'undefined') ? fyMeta : {};
  const closeCount = fyMeta2.fyCloseCount || 1;
  const closedDateStr = fyMeta2.lastYearClosedDate || new Date().toLocaleDateString('en-PK', { day:'numeric', month:'short', year:'numeric' });

  const syncWarnBlock = hasSyncWarnings ? `
    <div class="cy-sync-warn">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      <div>
        <div class="cy-sync-warn-title">Cloud Sync Incomplete</div>
        <div class="cy-sync-warn-body">Local data is fully merged and safe. Marked rows will re-sync automatically when connectivity is restored, or force a manual sync from Settings.</div>
      </div>
    </div>` : '';

  completeSection.innerHTML = `
  <div class="cy-complete-card">
    <div class="cy-complete-header">
      <div class="cy-complete-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent-emerald)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" style="stroke-dasharray:40;stroke-dashoffset:0;animation:cy-checkmark-draw 0.55s 0.2s cubic-bezier(0.22,1,0.36,1) both;"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <div class="cy-complete-header-text">
        <h3 class="cy-complete-title">Financial Year Closed</h3>
        <p class="cy-complete-sub">${closedDateStr} &nbsp;·&nbsp; Year #${closeCount}</p>
      </div>
    </div>
    <div class="cy-stat-grid">
      <div class="cy-stat-cell">
        <div class="cy-stat-val">${collectionsCompacted}</div>
        <div class="cy-stat-label">Collections</div>
      </div>
      <div class="cy-stat-cell">
        <div class="cy-stat-val">${totalMergedRecords}</div>
        <div class="cy-stat-label">Merged Rec.</div>
      </div>
      <div class="cy-stat-cell">
        <div class="cy-stat-val" style="color:var(--accent-emerald);">✓</div>
        <div class="cy-stat-label">Backup Safe</div>
      </div>
    </div>
    ${syncWarnBlock}
    <button class="cy-continue-btn" onclick="closeCloseYearDialog();if(typeof refreshAllDisplays==='function')refreshAllDisplays();">
      Continue to App →
    </button>
  </div>`;
  completeSection.style.display = 'block';
  showToast('Financial Year closed successfully!', 'success');
}
} catch (error) {
if (error.name === 'AbortError') {
  showToast('Close Financial Year was cancelled', 'info');
} else {
  console.error('Close Financial Year failed:', error);
  showToast('Close Financial Year failed: ' + error.message, 'error');


  if (typeof backupTimestamp !== 'undefined') {
    updateCloseYearProgress('Restoring from backup...', 0);
    try {
      await restoreFromBackup(backupTimestamp);
      showToast('Data restored from backup. No changes were committed.', 'info');
    } catch (restoreErr) {
      console.error('Failed to restore from backup:', restoreErr);
      showToast('CRITICAL: Failed to restore from backup. Manual intervention required.', 'error');
    }
  }

  closeCloseYearDialog();
}
} finally {
closeYearInProgress = false;
closeYearAbortController = null;
}
}
async function _commitMergedBatch(userRef, collectionName, mergedRecords, deleteFilter) {
const OPS_PER_BATCH = 400;
let batchesTotal = 0;
let batchesFailed = 0;
let firstError = null;
try {
  const existingSnapshot = await userRef.collection(collectionName).get();
  const deleteDocs = existingSnapshot.docs.filter(doc => {
    const d = doc.data(); return deleteFilter ? deleteFilter(d) : !d.isMerged;
  });
  const writeDocs = mergedRecords.map(record => {
    const sanitized = sanitizeForFirestore(record);

    
    sanitized.updatedAt = record.updatedAt;
    sanitized.createdAt = record.createdAt;
    sanitized.timestamp = record.timestamp;
    return { ref: userRef.collection(collectionName).doc(record.id), data: sanitized };
  });
  const allOps = [
    ...deleteDocs.map(d => ({ type: 'delete', ref: d.ref })),
    ...writeDocs.map(w => ({ type: 'set', ref: w.ref, data: w.data }))
  ];
  for (let i = 0; i < allOps.length; i += OPS_PER_BATCH) {
    batchesTotal++;
    const batch = firebaseDB.batch();
    allOps.slice(i, i + OPS_PER_BATCH).forEach(op => {
      if (op.type === 'delete') batch.delete(op.ref);
      else batch.set(op.ref, op.data);
    });
    try {
      await batch.commit();
    } catch (batchErr) {
      batchesFailed++;
      if (!firstError) firstError = batchErr;
      console.error(`_commitMergedBatch [${collectionName}] batch ${batchesTotal} failed:`, batchErr);
      throw batchErr; 
    }
  }
} catch (outerErr) {

  console.error(`_commitMergedBatch [${collectionName}] snapshot read failed:`, outerErr);
  return { ok: false, batchesTotal, batchesFailed: batchesTotal || 1, error: outerErr };
}
const ok = batchesFailed === 0;
return { ok, batchesTotal, batchesFailed, error: firstError || null };
}
function _markRowSyncWarning(rowId, commitResult) {
  try {
    const rowEl = document.getElementById('cy-row-' + rowId);
    if (!rowEl) return;

    const statusEl = document.getElementById('cy-status-' + rowId);
    if (statusEl) {
      statusEl.textContent = '⚠ Sync Failed';
      statusEl.style.background = 'rgba(255,179,0,0.15)';
      statusEl.style.color = 'var(--warning)';
      statusEl.style.borderColor = 'rgba(255,179,0,0.35)';
      statusEl.style.display = 'inline';
    }

    const noteEl = document.getElementById('cy-result-note-' + rowId);
    if (noteEl) {
      const failMsg = document.createElement('span');
      failMsg.style.cssText = 'display:block;margin-top:3px;font-size:0.63rem;color:var(--warning);font-weight:600;';
      failMsg.textContent = `⚠ Cloud sync incomplete — ${commitResult.batchesFailed}/${commitResult.batchesTotal} Firestore batch${commitResult.batchesFailed!==1?'es':''} failed. Local data is safe. Re-sync when online.`;
      noteEl.appendChild(failMsg);
    }

    rowEl.style.borderLeftColor = 'var(--warning)';
  } catch (e) {   }
}
function _buildMergedBase(id, mergeEpoch, nowISODate, nowTime, extra = {}) {
return {
  id,
  date: nowISODate,
  time: nowTime,
  createdAt: mergeEpoch,
  updatedAt: mergeEpoch,
  timestamp: mergeEpoch,
  isMerged: true,
  mergedAt: nowISODate,
  syncedAt: new Date().toISOString(),
  ...extra
};
}

const isRepSale = (item) => {
  return item.isRepModeEntry === true || 
         (item.salesRep && item.salesRep !== 'NONE' && item.salesRep !== 'ADMIN');
};

const isDirectSale = (item) => {
  return !isRepSale(item);
};
async function mergeProductionData(signal) {
updateCloseYearProgress('Merging Production Data...', 10);
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (!Array.isArray(db) || db.length === 0) return;
const nowDate    = new Date();
const nowISODate = nowDate.toISOString().split('T')[0];
const mergeEpoch = nowDate.getTime();
const nowTime    = nowDate.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
const mergedRecords = [];
const nonMerged    = db.filter(i => i.isMerged !== true);
const prodItems    = nonMerged.filter(i => i.isReturn !== true);
const returnItems  = nonMerged.filter(i => i.isReturn === true);
const storeGroups = {};
prodItems.forEach(item => {
  const store = item.store || 'UNKNOWN';
  if (!storeGroups[store]) storeGroups[store] = [];
  storeGroups[store].push(item);
});
for (const [store, items] of Object.entries(storeGroups)) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const totals = items.reduce((acc, item) => {
    acc.net          += (item.net          || 0);
    acc.totalCost    += (item.totalCost    || 0);

    acc.totalSale    += (item.totalSale    || 0);
    acc.profit       += (item.profit       || 0);
    acc.formulaUnits += (item.formulaUnits || 0);
    acc.formulaCost  += (item.formulaCost  || 0);
    return acc;
  }, { net:0, totalCost:0, totalSale:0, profit:0, formulaUnits:0, formulaCost:0 });
  // cp: weighted average of actual dynamic cost per kg across all production runs
  //     (each run may differ as formula costs change) — average is correct here.
  const avgCp = totals.net > 0 ? parseFloat((totals.totalCost / totals.net).toFixed(4)) : (items[0]?.cp || 0);
  // sp: the fixed canonical sale price for this store from factory settings.
  //     All items in this store group share the same fixed price — never average.
  const canonicalSp = getSalePriceForStore(store);
  const avgSp = canonicalSp > 0 ? canonicalSp : (items[0]?.sp || 0);
  const allDates = items.map(i => i.date).filter(Boolean).sort();
  const mergedId = generateUUID('prod-merged');
  const mergedRecord = ensureRecordIntegrity(_buildMergedBase(mergedId, mergeEpoch, nowISODate, nowTime, {
    store,
    net:           totals.net,
    cp:            avgCp,
    sp:            avgSp,
    totalCost:     totals.totalCost,
    totalSale:     totals.totalSale,
    profit:        totals.profit,
    formulaUnits:  totals.formulaUnits,
    formulaStore:  items[0]?.formulaStore || 'standard',
    formulaCost:   totals.formulaCost,
    paymentStatus: 'CASH',
    mergedRecordCount: items.length,
    mergedSummary: {
      dateRange:       { from: allDates[0] || nowISODate, to: allDates.slice(-1)[0] || nowISODate },
      recordCount:     items.length,
    }
  }), false, true);
  mergedRecords.push(mergedRecord);
}

const sellerReturnGroups = {};
const sellerReturnTotals = {}; 
returnItems.forEach(item => {
  const seller = item.returnedBy || item.seller || 'Unknown';
  const store  = item.store      || 'UNKNOWN';
  const key    = `${seller}::${store}`;
  if (!sellerReturnGroups[key]) sellerReturnGroups[key] = { seller, store, items: [] };
  sellerReturnGroups[key].items.push(item);

  
  if (!sellerReturnTotals[seller]) {
    sellerReturnTotals[seller] = { totalNet: 0, returnsByStore: {} };
  }
  sellerReturnTotals[seller].totalNet += (item.net || 0);
  sellerReturnTotals[seller].returnsByStore[store] = (sellerReturnTotals[seller].returnsByStore[store] || 0) + (item.net || 0);
});
for (const [, grp] of Object.entries(sellerReturnGroups)) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const { seller, store, items } = grp;
  let totalNet = 0, totalCost = 0, totalSale = 0, totalProfit = 0;
  items.forEach(item => {
    totalNet    += (item.net       || 0);
    totalCost   += (item.totalCost || 0);
    totalSale   += (item.totalSale || 0);
    totalProfit += (item.profit    || 0);
  });
  const avgCp = totalNet > 0 ? parseFloat((totalCost / totalNet).toFixed(4)) : (items[0]?.cp || 0);
  // sp: fixed canonical sale price for this store — not a weighted average.
  const canonicalSpRet = getSalePriceForStore(store);
  const avgSp = canonicalSpRet > 0 ? canonicalSpRet : (items[0]?.sp || 0);
  const allDates = items.map(i => i.date).filter(Boolean).sort();
  const mergedId = generateUUID('prod-ret-merged');

  
  const returnsByStoreForThisSeller = sellerReturnTotals[seller]?.returnsByStore || {};

  const mergedReturn = ensureRecordIntegrity(_buildMergedBase(mergedId, mergeEpoch, nowISODate, nowTime, {
    store,
    net:           totalNet,
    cp:            avgCp,
    sp:            avgSp,
    totalCost:     totalCost,
    totalSale:     totalSale,
    profit:        totalProfit,
    formulaUnits:  0,
    formulaStore:  'standard',
    formulaCost:   0,
    paymentStatus: 'CASH',
    isReturn:      true,
    returnedBy:    seller,
    returnNote:    `Merged returns by ${seller} → ${store}`,
    returnsByStore: returnsByStoreForThisSeller, 
    mergedRecordCount: items.length,
    mergedSummary: {
      dateRange:   { from: allDates[0] || nowISODate, to: allDates.slice(-1)[0] || nowISODate },
      recordCount: items.length,
      store,
      seller,
      returnsByStore: returnsByStoreForThisSeller 
    }
  }), false, true);
  mergedRecords.push(mergedReturn);
}
if (Object.keys(storeGroups).length === 0 && Object.keys(sellerReturnGroups).length === 0) {
  updateCloseYearProgress('Production Data - No New Records to Merge', 20);
  return;
}
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (firebaseDB && currentUser) {
  const userRef = firebaseDB.collection('users').doc(currentUser.uid);
  const commitResult = await _commitMergedBatch(userRef, 'production', mergedRecords);
  if (!commitResult.ok) {
    console.warn(`mergeProductionData: Firestore commit partial failure — ${commitResult.batchesFailed}/${commitResult.batchesTotal} batch(es) failed`, commitResult.error);
    _markRowSyncWarning('prod', commitResult);
  }
}
const existingMerged = db.filter(item => item.isMerged === true);
db = [...existingMerged, ...mergedRecords];
await idb.set('mfg_pro_pkr', db);
emitSyncUpdate({ mfg_pro_pkr: db });
updateCloseYearProgress('Production Data Merged', 20);
}
async function mergeSalesData(signal) {
updateCloseYearProgress('Merging Sales Data...', 30);
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (!Array.isArray(customerSales) || customerSales.length === 0) return;
const nowDate    = new Date();
const nowISODate = nowDate.toISOString().split('T')[0];
const mergeEpoch = nowDate.getTime();
const nowTime    = nowDate.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
const mergedRecords = [];
const customerBuckets = {};  
customerSales.forEach(item => {
  if (item.isMerged === true) return;
  if (isRepSale(item)) return;  
  const name = item.customerName || 'Unknown';
  if (!customerBuckets[name]) {
    customerBuckets[name] = {
      sales: [], oldDebt: 0, collectionTotal: 0, partialPaymentTotal: 0, partialPaymentsBySale: {},
      phone: '', address: '', supplyStore: ''
    };
  }
  const b = customerBuckets[name];
  b.phone      = b.phone      || item.customerPhone   || '';
  b.address    = b.address    || item.customerAddress || '';
  b.supplyStore= b.supplyStore|| item.supplyStore     || 'STORE_A';
  if (item.paymentType === 'PARTIAL_PAYMENT') {

    b.partialPaymentTotal += (item.totalValue || 0);
    const linkedKey = item.relatedSaleId || item.linkedSaleId;
    if (linkedKey) {

      
      b.partialPaymentsBySale[linkedKey] = (b.partialPaymentsBySale[linkedKey] || 0) + (item.totalValue || 0);

      if (!b.partialPaymentCustomers) b.partialPaymentCustomers = {};
      b.partialPaymentCustomers[linkedKey] = item.customerName || name;
    }
    return;
  }
  if (item.paymentType === 'COLLECTION') {

    b.collectionTotal += (item.totalValue || 0);
    return;
  }
  if (item.transactionType === 'OLD_DEBT') {

    b.oldDebt += Math.max(0, (item.totalValue || 0) - (item.partialPaymentReceived || 0));
    return;
  }

  b.sales.push(item);
});
for (const [customer, b] of Object.entries(customerBuckets)) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const { sales, oldDebt, collectionTotal, phone, address, supplyStore } = b;

  let totalQty   = 0, totalValue = 0, totalCost = 0, totalProfit = 0;
  let realizedProfit = 0, unrealizedProfit = 0;
  let cashValue  = 0, unpaidCreditNet = 0;

  
  const originalRecordIds = sales.map(s => s.id);
  for (const item of sales) {
    totalQty    += (item.quantity   || 0);
    totalValue  += (item.totalValue || 0);
    totalCost   += (item.totalCost  || 0);
    totalProfit += (item.profit     || 0);


    if (item.paymentType === 'CREDIT' && !item.creditReceived) {
      unrealizedProfit += (item.profit || 0);  
    } else {
      realizedProfit += (item.profit || 0);    
    }

    if (item.paymentType === 'CASH' || (item.paymentType === 'CREDIT' && item.creditReceived)) {

      cashValue += (item.totalValue || 0);
    } else if (item.paymentType === 'CREDIT' && !item.creditReceived) {

      unpaidCreditNet += Math.max(0, (item.totalValue || 0) - (item.partialPaymentReceived || 0));
    }
  }

  const grossOutstanding = unpaidCreditNet + oldDebt;

  const netOutstanding   = Math.max(0, grossOutstanding - collectionTotal);

  const advanceCredit    = Math.max(0, collectionTotal - grossOutstanding);
  const isSettled = netOutstanding <= 0;

  if (sales.length === 0 && oldDebt <= 0 && collectionTotal <= 0) continue;
  const allDates  = sales.map(i => i.date).filter(Boolean).sort();
  const firstItem = sales[0] || {};
  const recordCount = sales.length + (oldDebt > 0 ? 1 : 0) + (collectionTotal > 0 ? 1 : 0);
  const mergedId = generateUUID('sale-merged');

  

  

  
  // unitPrice: the fixed canonical sale price for the supply store from factory
  // settings — never divide totalValue/quantity (weighted average from partials).
  const _mergedSupplyStore = supplyStore || firstItem.supplyStore || 'STORE_A';
  const canonicalUnitPrice = getSalePriceForStore(_mergedSupplyStore);
  const lastUnitPrice = canonicalUnitPrice > 0
    ? canonicalUnitPrice
    : (firstItem.unitPrice || (firstItem.quantity > 0 ? firstItem.totalValue / firstItem.quantity : 0) || 0);
  const grossSaleValue  = parseFloat(totalValue.toFixed(2));
  const alreadyPaid     = isSettled ? grossSaleValue : parseFloat((grossSaleValue - netOutstanding).toFixed(2));
  const mergedRecord = ensureRecordIntegrity(_buildMergedBase(mergedId, mergeEpoch, nowISODate, nowTime, {
    customerName:          customer,
    customerPhone:         phone,
    customerAddress:       address,
    quantity:              totalQty,
    unitPrice:             lastUnitPrice,
    totalValue:            grossSaleValue,
    totalCost:             totalCost,
    profit:                totalProfit,
    supplyStore:           _mergedSupplyStore,
    salesRep:              'NONE',
    paymentType:           isSettled ? 'CASH' : 'CREDIT',
    transactionType:       (oldDebt > 0 && sales.length === 0) ? 'OLD_DEBT' : 'SALE',
    creditReceived:        isSettled,
    creditReceivedDate:    isSettled ? nowISODate : null,
    creditValue:           isSettled ? 0 : netOutstanding,
    partialPaymentReceived: isSettled ? 0 : alreadyPaid,
    balancePaid:           alreadyPaid,
    paid:                  isSettled,
    isRepModeEntry:        false,
    notes:                 'Combined year-end balance carried forward from financial year close',
    mergedRecordCount:     recordCount,
    mergedSummary: {
      cashSales:           cashValue,
      unpaidCredit:        unpaidCreditNet,
      oldDebt:             oldDebt,
      collectionsReceived: collectionTotal,
      partialPayments:     b.partialPaymentTotal || 0,
      partialPaymentsBySale: b.partialPaymentsBySale || {},
      advanceCreditHeld:   advanceCredit,
      realizedProfit:      realizedProfit,
      unrealizedProfit:    unrealizedProfit,
      grossOutstanding,
      netOutstanding,
      isSettled,
      dateRange: {
        from: allDates[0]           || nowISODate,
        to:   allDates.slice(-1)[0] || nowISODate
      },
      recordCount,
      originalRecordIds:   originalRecordIds  
    }
  }), false, true);
  mergedRecords.push(mergedRecord);
}
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (firebaseDB && currentUser) {
  const userRef = firebaseDB.collection('users').doc(currentUser.uid);
  const commitResult = await _commitMergedBatch(userRef, 'sales', mergedRecords, d => !d.isMerged);
  if (!commitResult.ok) {
    console.warn(`mergeSalesData: Firestore commit partial failure — ${commitResult.batchesFailed}/${commitResult.batchesTotal} batch(es) failed`, commitResult.error);
    _markRowSyncWarning('sales', commitResult);
  }
}
const existingMerged = customerSales.filter(i => i.isMerged === true);
customerSales = [...existingMerged, ...mergedRecords];
await idb.set('customer_sales', customerSales);
emitSyncUpdate({ customer_sales: customerSales });
updateCloseYearProgress('Sales Data Merged', 40);
}
async function mergeCalculatorData(signal) {
updateCloseYearProgress('Merging Calculator Data...', 50);
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (!Array.isArray(salesHistory) || salesHistory.length === 0) return;
const repGroups = {};
salesHistory.forEach(item => {
  if (item.isMerged === true) return;
  const seller = item.seller || 'Unknown';
  if (!repGroups[seller]) repGroups[seller] = [];
  repGroups[seller].push(item);
});
if (Object.keys(repGroups).length === 0) {
  updateCloseYearProgress('Calculator Data - No New Records to Merge', 60);
  return;
}
const nowDate = new Date();
const nowISODate = nowDate.toISOString().split('T')[0];
const mergeEpoch = nowDate.getTime();
const nowTime = nowDate.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true});
const mergedRecords = [];
for (const [seller, items] of Object.entries(repGroups)) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const firstItem = items[0] || {};
  const datesSorted = items.map(i => i.date).filter(Boolean).sort();

  const sellerTotals = items.reduce((acc, item) => {
    acc.totalSold  += (item.totalSold  || 0);
    acc.returned   += (item.returned   || 0);
    acc.netSold    = acc.totalSold - acc.returned;
    acc.creditQty  += (item.creditQty  || 0);
    acc.cashQty    += (item.cashQty    || 0);
    acc.revenue    += (item.revenue    || 0);
    acc.profit     += (item.profit     || 0);
    acc.totalCost  += (item.totalCost  || 0);
    acc.creditValue+= (item.creditValue|| 0);
    acc.prevColl   += (item.prevColl   || 0);
    acc.received   += (item.received   || 0);
    acc.totalExpected += (item.totalExpected || 0);
    if (item.returned > 0 && item.returnStore) {
      acc.returnsByStore[item.returnStore] = (acc.returnsByStore[item.returnStore] || 0) + (item.returned || 0);
    }
    return acc;
  }, { totalSold:0, returned:0, netSold:0, creditQty:0, cashQty:0, revenue:0, profit:0, totalCost:0, creditValue:0, prevColl:0, received:0, totalExpected:0, returnsByStore:{} });

  const mergedNetSold = sellerTotals.totalSold - sellerTotals.returned;
  // unitPrice: fixed canonical sale price from factory settings.
  // Calculator (seller summary) records always use STORE_A (standard price).
  // Never compute as revenue/qty — that produces a weighted average.
  const _calcCanonicalSp = getSalePriceForStore('STORE_A');
  const avgUnitPrice = _calcCanonicalSp > 0
    ? _calcCanonicalSp
    : (firstItem.unitPrice || 0);
  // costPrice: weighted average of actual cost per kg is correct here —
  // formula material costs can change over the year.
  const avgCostPrice = mergedNetSold > 0
    ? parseFloat((sellerTotals.totalCost / mergedNetSold).toFixed(4))
    : (firstItem.costPrice || calculateSalesCostPerKg('standard') || 0);
  const returnStoreEntries = Object.entries(sellerTotals.returnsByStore);
  const primaryReturnStore = returnStoreEntries.length > 0
    ? returnStoreEntries.sort((a, b) => b[1] - a[1])[0][0]
    : null;

  

  
  const primaryId = generateUUID('calc-merged');
  const primaryRecord = ensureRecordIntegrity(_buildMergedBase(primaryId, mergeEpoch, nowISODate, nowTime, {
    seller,
    unitPrice:     avgUnitPrice,
    costPrice:     avgCostPrice,
    revenue:       sellerTotals.revenue,
    profit:        sellerTotals.profit,
    totalCost:     sellerTotals.totalCost,
    totalSold:     sellerTotals.totalSold,
    returned:       sellerTotals.returned,
    returnStore:    primaryReturnStore,
    returnsByStore: sellerTotals.returnsByStore,
    creditQty:     sellerTotals.creditQty,
    cashQty:       sellerTotals.cashQty,
    creditValue:   sellerTotals.creditValue,
    prevColl:      sellerTotals.prevColl,
    totalExpected: sellerTotals.totalExpected,
    received:      sellerTotals.received,
    statusText:    'OPENING BALANCE',
    statusClass:   'result-box discrepancy-ok',
    linkedSalesIds:    [],
    linkedRepSalesIds: [],
    mergedRecordCount: items.length,
    mergedSummary: {
      dateRange:      { from: datesSorted[0] || nowISODate, to: datesSorted.slice(-1)[0] || nowISODate },
      recordCount:    items.length,
      returnsByStore: sellerTotals.returnsByStore
    }
  }), false, true);
  mergedRecords.push(primaryRecord);
}
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (firebaseDB && currentUser) {
  const userRef = firebaseDB.collection('users').doc(currentUser.uid);
  const commitResult = await _commitMergedBatch(userRef, 'calculator_history', mergedRecords);
  if (!commitResult.ok) {
    console.warn(`mergeCalculatorData: Firestore commit partial failure — ${commitResult.batchesFailed}/${commitResult.batchesTotal} batch(es) failed`, commitResult.error);
    _markRowSyncWarning('calc', commitResult);
  }
}
const existingMergedCalc = salesHistory.filter(item => item.isMerged === true);
salesHistory = [...existingMergedCalc, ...mergedRecords];
await idb.set('noman_history', salesHistory);
emitSyncUpdate({ noman_history: salesHistory });
updateCloseYearProgress('Calculator Data Merged', 60);
}
async function mergePaymentData(signal) {
updateCloseYearProgress('Merging Payment Data...', 70);
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (!Array.isArray(paymentTransactions) || paymentTransactions.length === 0) return;
const entityGroups = {};
paymentTransactions.forEach(item => {
  if (item.isMerged === true) return;
  const entityId = item.entityId || 'unknown';
  if (!entityGroups[entityId]) entityGroups[entityId] = [];
  entityGroups[entityId].push(item);
});
if (Object.keys(entityGroups).length === 0) {
  updateCloseYearProgress('Payment Data - No New Records to Merge', 80);
  return;
}
const nowDate = new Date();
const nowISODate = nowDate.toISOString().split('T')[0];
const mergeEpoch = nowDate.getTime();
const nowTime = nowDate.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true});
const mergedRecords = [];
for (const [entityId, items] of Object.entries(entityGroups)) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const entity = paymentEntities.find(e => e.id === entityId);
  const totals = items.reduce((acc, item) => {
    if (item.type === 'IN') acc.in += (item.amount || 0);
    else if (item.type === 'OUT') acc.out += (item.amount || 0);
    return acc;
  }, { in: 0, out: 0 });
  const netBalance = parseFloat((totals.in - totals.out).toFixed(2));

  const SIGNIFICANT_BALANCE_THRESHOLD = 0.01;
  if (Math.abs(netBalance) < SIGNIFICANT_BALANCE_THRESHOLD) {
    continue;  
  }
  const mergedId = generateUUID('pay-merged');
  const datesSorted = items.map(i => i.date).filter(Boolean).sort();
  const entityName = entity?.name || items[0]?.entityName || 'Unknown Entity';
  const entityType = entity?.type || items[0]?.entityType || 'payee';
  const mergedRecord = ensureRecordIntegrity(_buildMergedBase(mergedId, mergeEpoch, nowISODate, nowTime, {
    entityId,
    entityName,
    entityType,
    amount: Math.abs(netBalance),
    type: netBalance > 0 ? 'IN' : 'OUT',
    description: netBalance > 0
      ? `Opening balance (receivable) — carried from previous year (${items.length} txns)`
      : `Opening balance (payable) — carried from previous year (${items.length} txns)`,
    isPayable: netBalance < 0,   
    isExpense: false,
    mergedRecordCount: items.length,

    mergedSummary: {
      originalIn: totals.in,
      originalOut: totals.out,
      netBalance,
      dateRange: { from: datesSorted[0] || nowISODate, to: datesSorted.slice(-1)[0] || nowISODate },
      recordCount: items.length,

      hasSupplierMaterials: items.some(i => i.isPayable === true && i.type === 'OUT')
    }
  }), false, true);
  mergedRecords.push(mergedRecord);
}
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (firebaseDB && currentUser) {
  const userRef = firebaseDB.collection('users').doc(currentUser.uid);
  const commitResult = await _commitMergedBatch(userRef, 'transactions', mergedRecords);
  if (!commitResult.ok) {
    console.warn(`mergePaymentData: Firestore commit partial failure — ${commitResult.batchesFailed}/${commitResult.batchesTotal} batch(es) failed`, commitResult.error);
    _markRowSyncWarning('pay', commitResult);
  }
}
const existingMergedPay = paymentTransactions.filter(item => item.isMerged === true);
paymentTransactions = [...existingMergedPay, ...mergedRecords];
await idb.set('payment_transactions', paymentTransactions);
emitSyncUpdate({ payment_transactions: paymentTransactions });
updateCloseYearProgress('Payment Data Merged', 80);
}
async function mergeFactoryData(signal) {
updateCloseYearProgress('Merging Factory Data...', 85);
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (!Array.isArray(factoryProductionHistory) || factoryProductionHistory.length === 0) return;
const nonMergedRecords = factoryProductionHistory.filter(item => item.isMerged !== true);
if (nonMergedRecords.length === 0) {
  updateCloseYearProgress('Factory Data - No New Records to Merge', 90);
  return;
}
const storeGroups = {};
nonMergedRecords.forEach(item => {
  const store = item.store || 'standard';
  if (!storeGroups[store]) storeGroups[store] = [];
  storeGroups[store].push(item);
});
const nowDate = new Date();
const nowISODate = nowDate.toISOString().split('T')[0];
const mergeEpoch = nowDate.getTime();
const nowTime = nowDate.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true});
const mergedRecords = [];
for (const [store, items] of Object.entries(storeGroups)) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const totals = items.reduce((acc, item) => {
    acc.units += (item.units || 0);
    acc.totalCost += (item.totalCost || 0);
    acc.materialsCost += (item.materialsCost || 0);
    acc.additionalCost += (item.additionalCost || 0);
    acc.rawMaterialsUsed += (item.rawMaterialsUsed || 0);
    return acc;
  }, { units: 0, totalCost: 0, materialsCost: 0, additionalCost: 0, rawMaterialsUsed: 0 });


  const expectedTotalCost = totals.materialsCost + totals.additionalCost;
  if (Math.abs(expectedTotalCost - totals.totalCost) > 0.01) {

    const originalTotalCost = totals.totalCost;
    totals.totalCost = expectedTotalCost;
    console.warn(`Factory data auto-corrected: totalCost adjusted from ${originalTotalCost} to ${expectedTotalCost}`);
  }
  const mergedId = generateUUID('factory-merged');
  const datesSorted = items.map(i => i.date).filter(Boolean).sort();
  const mergedRecord = ensureRecordIntegrity(_buildMergedBase(mergedId, mergeEpoch, nowISODate, nowTime, {
    store,
    units: totals.units,
    totalCost: totals.totalCost,
    materialsCost: totals.materialsCost,
    additionalCost: totals.additionalCost,
    rawMaterialsUsed: totals.rawMaterialsUsed,
    notes: `Opening balance (${store}) — carried from previous year (${items.length} records)`,
    mergedRecordCount: items.length,
    mergedSummary: {
      dateRange: { from: datesSorted[0] || nowISODate, to: datesSorted.slice(-1)[0] || nowISODate },
      recordCount: items.length
    }
  }), false, true);
  mergedRecords.push(mergedRecord);
}
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (firebaseDB && currentUser) {
  const userRef = firebaseDB.collection('users').doc(currentUser.uid);
  const commitResult = await _commitMergedBatch(userRef, 'factory_history', mergedRecords);
  if (!commitResult.ok) {
    console.warn(`mergeFactoryData: Firestore commit partial failure — ${commitResult.batchesFailed}/${commitResult.batchesTotal} batch(es) failed`, commitResult.error);
    _markRowSyncWarning('factory', commitResult);
  }
}
const existingMergedFactory = factoryProductionHistory.filter(item => item.isMerged === true);
factoryProductionHistory = [...existingMergedFactory, ...mergedRecords];
await idb.set('factory_production_history', factoryProductionHistory);
emitSyncUpdate({ factory_production_history: factoryProductionHistory });
updateCloseYearProgress('Factory Data Merged', 90);
}
async function mergeRepSalesData(signal) {
updateCloseYearProgress('Merging Rep Sales Data...', 88);
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (!Array.isArray(repSales) || repSales.length === 0) return;
const nowDate    = new Date();
const nowISODate = nowDate.toISOString().split('T')[0];
const mergeEpoch = nowDate.getTime();
const nowTime    = nowDate.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
const mergedRecords = [];
const repBuckets = {};
repSales.forEach(item => {
  if (item.isMerged === true) return;
  if (!isRepSale(item)) return;  
  const name = item.customerName || 'Unknown';
  const rep  = item.salesRep     || 'NONE';
  const key  = `${name}::${rep}`;
  if (!repBuckets[key]) {
    repBuckets[key] = {
      customer: name, rep,
      sales: [], oldDebt: 0, collectionTotal: 0, partialPaymentTotal: 0, partialPaymentsBySale: {},
      phone: '', supplyStore: ''
    };
  }
  const b = repBuckets[key];
  b.phone       = b.phone       || item.customerPhone || '';
  b.supplyStore = b.supplyStore || item.supplyStore   || 'STORE_A';
  if (item.paymentType === 'PARTIAL_PAYMENT') {

    b.partialPaymentTotal += (item.totalValue || 0);
    const linkedKey = item.relatedSaleId || item.linkedSaleId;
    if (linkedKey) {

      
      b.partialPaymentsBySale[linkedKey] = (b.partialPaymentsBySale[linkedKey] || 0) + (item.totalValue || 0);

      if (!b.partialPaymentCustomers) b.partialPaymentCustomers = {};
      b.partialPaymentCustomers[linkedKey] = item.customerName || name;
    }
    return;
  }
  if (item.paymentType === 'COLLECTION') {
    b.collectionTotal += (item.totalValue || 0);
    return;
  }
  if (item.transactionType === 'OLD_DEBT') {
    b.oldDebt += Math.max(0, (item.totalValue || 0) - (item.partialPaymentReceived || 0));
    return;
  }
  b.sales.push(item);
});
for (const [, b] of Object.entries(repBuckets)) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const { customer, rep, sales, oldDebt, collectionTotal, phone, supplyStore } = b;
  let totalQty = 0, totalValue = 0, totalCost = 0, totalProfit = 0;
  let realizedProfit = 0, unrealizedProfit = 0;
  let cashValue = 0, unpaidCreditNet = 0;
  const originalRecordIds = sales.map(s => s.id);
  for (const item of sales) {
    totalQty    += (item.quantity   || 0);
    totalValue  += (item.totalValue || 0);
    totalCost   += (item.totalCost  || 0);
    totalProfit += (item.profit     || 0);


    if (item.paymentType === 'CREDIT' && !item.creditReceived) {
      unrealizedProfit += (item.profit || 0);  
    } else {
      realizedProfit += (item.profit || 0);    
    }

    if (item.paymentType === 'CASH' || (item.paymentType === 'CREDIT' && item.creditReceived)) {
      cashValue += (item.totalValue || 0);
    } else if (item.paymentType === 'CREDIT' && !item.creditReceived) {
      unpaidCreditNet += Math.max(0, (item.totalValue || 0) - (item.partialPaymentReceived || 0));
    }
  }
  const grossOutstanding = unpaidCreditNet + oldDebt;
  const netOutstanding   = Math.max(0, grossOutstanding - collectionTotal);
  const advanceCredit    = Math.max(0, collectionTotal - grossOutstanding);
  const isSettled        = netOutstanding <= 0;
  if (sales.length === 0 && oldDebt <= 0 && collectionTotal <= 0) continue;
  const allDates  = sales.map(i => i.date).filter(Boolean).sort();
  const firstItem = sales[0] || {};
  const recordCount = sales.length + (oldDebt > 0 ? 1 : 0) + (collectionTotal > 0 ? 1 : 0);
  const mergedId = generateUUID('repsale-merged');

  

  

  
  // unitPrice: fixed canonical sale price for the supply store from factory
  // settings — never divide totalValue/quantity (gives averaged/partial price).
  const _repMergedStore = supplyStore || firstItem.supplyStore || 'STORE_A';
  const repCanonicalPrice = getSalePriceForStore(_repMergedStore);
  const lastUnitPrice = repCanonicalPrice > 0
    ? repCanonicalPrice
    : (firstItem.unitPrice || (firstItem.quantity > 0 ? firstItem.totalValue / firstItem.quantity : 0) || 0);
  const grossSaleValue  = parseFloat(totalValue.toFixed(2));
  const alreadyPaid     = isSettled ? grossSaleValue : parseFloat((grossSaleValue - netOutstanding).toFixed(2));
  const mergedRecord = ensureRecordIntegrity(_buildMergedBase(mergedId, mergeEpoch, nowISODate, nowTime, {
    customerName:          customer,
    customerPhone:         phone,
    quantity:              totalQty,
    unitPrice:             lastUnitPrice,
    totalValue:            grossSaleValue,
    totalCost:             totalCost,
    profit:                totalProfit,
    paymentType:           isSettled ? 'CASH' : 'CREDIT',
    transactionType:       (oldDebt > 0 && sales.length === 0) ? 'OLD_DEBT' : 'SALE',
    creditReceived:        isSettled,
    creditReceivedDate:    isSettled ? nowISODate : null,
    creditValue:           isSettled ? 0 : netOutstanding,
    partialPaymentReceived: isSettled ? 0 : alreadyPaid,
    balancePaid:           alreadyPaid,
    paid:                  isSettled,
    salesRep:              rep,
    supplyStore:           _repMergedStore,
    isRepModeEntry:        true,
    notes:                 'Combined year-end balance carried forward from financial year close',
    mergedRecordCount:     recordCount,
    mergedSummary: {
      cashSales:           cashValue,
      unpaidCredit:        unpaidCreditNet,
      oldDebt:             oldDebt,
      collectionsReceived: collectionTotal,
      partialPayments:     b.partialPaymentTotal || 0,
      partialPaymentsBySale: b.partialPaymentsBySale || {},
      advanceCreditHeld:   advanceCredit,
      realizedProfit:      realizedProfit,
      unrealizedProfit:    unrealizedProfit,
      grossOutstanding,
      netOutstanding,
      isSettled,
      dateRange: {
        from: allDates[0]           || nowISODate,
        to:   allDates.slice(-1)[0] || nowISODate
      },
      recordCount,
      originalRecordIds:   originalRecordIds  
    }
  }), false, true);
  mergedRecords.push(mergedRecord);
}
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (firebaseDB && currentUser) {
  const userRef = firebaseDB.collection('users').doc(currentUser.uid);
  const commitResult = await _commitMergedBatch(userRef, 'rep_sales', mergedRecords, d => !d.isMerged);
  if (!commitResult.ok) {
    console.warn(`mergeRepSalesData: Firestore commit partial failure — ${commitResult.batchesFailed}/${commitResult.batchesTotal} batch(es) failed`, commitResult.error);
    _markRowSyncWarning('repsales', commitResult);
  }
}
const existingMergedRep = repSales.filter(item => item.isMerged === true);
repSales = [...existingMergedRep, ...mergedRecords];
await idb.set('rep_sales', repSales);
emitSyncUpdate({ rep_sales: repSales });
updateCloseYearProgress('Rep Sales Data Merged', 92);
}
async function mergeExpensesData(signal) {
updateCloseYearProgress('Merging Expenses...', 94);
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (!Array.isArray(expenseRecords) || expenseRecords.length === 0) {
  updateCloseYearProgress('Expenses - No Records to Merge', 94);
  return;
}
const nowDate    = new Date();
const nowISODate = nowDate.toISOString().split('T')[0];
const mergeEpoch = nowDate.getTime();
const nowTime    = nowDate.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
const expenseGroups = {};
expenseRecords.forEach(exp => {
  if (exp.isMerged === true) return;
  const cat  = exp.category || 'operating';
  const name = (exp.name    || 'Unnamed').trim();
  const key  = `${cat}||${name}`;
  if (!expenseGroups[key]) expenseGroups[key] = { category: cat, name, records: [] };
  expenseGroups[key].records.push(exp);
});
if (Object.keys(expenseGroups).length === 0) {
  updateCloseYearProgress('Expenses - No New Records to Merge', 97);
  return;
}
const mergedRecords = [];
for (const [, grp] of Object.entries(expenseGroups)) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const { category, name, records } = grp;
  const totalAmount = records.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
  const allDates    = records.map(e => e.date).filter(Boolean).sort();
  const mergedId = generateUUID('expense-merged');
  const mergedRecord = ensureRecordIntegrity({
    ..._buildMergedBase(mergedId, mergeEpoch, nowISODate, nowTime, {}),
    name,
    amount:      parseFloat(fmtAmt(totalAmount)),
    category,
    description: `Year-end merged total for "${name}" (${records.length} record${records.length !== 1 ? 's' : ''})`,
    mergedRecordCount: records.length,
    mergedSummary: {
      category,
      expenseName:  name,
      totalAmount:  parseFloat(fmtAmt(totalAmount)),
      dateRange: {
        from: allDates[0]           || nowISODate,
        to:   allDates.slice(-1)[0] || nowISODate
      },
      recordCount: records.length
    }
  }, false, true);
  mergedRecords.push(mergedRecord);
}
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (firebaseDB && currentUser) {
  const userRef = firebaseDB.collection('users').doc(currentUser.uid);
  const commitResult = await _commitMergedBatch(userRef, 'expenses', mergedRecords, d => !d.isMerged);
  if (!commitResult.ok) {
    console.warn(`mergeExpensesData: Firestore commit partial failure — ${commitResult.batchesFailed}/${commitResult.batchesTotal} batch(es) failed`, commitResult.error);
    _markRowSyncWarning('exp', commitResult);
  }
}
const existingMerged = expenseRecords.filter(e => e.isMerged === true);
expenseRecords = [...existingMerged, ...mergedRecords];
await idb.set('expenses', expenseRecords);
emitSyncUpdate({ expenses: expenseRecords });
updateCloseYearProgress('Expenses Merged', 97);
}
async function mergeStockReturnsData(signal) {
updateCloseYearProgress('Merging Stock Returns...', 98);
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (!Array.isArray(stockReturns) || stockReturns.length === 0) {
  updateCloseYearProgress('Stock Returns - No Records to Merge', 98);
  return;
}
const nowDate    = new Date();
const nowISODate = nowDate.toISOString().split('T')[0];
const mergeEpoch = nowDate.getTime();
const nowTime    = nowDate.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
const storeGroups = {};  
stockReturns.forEach(ret => {
  if (ret.isMerged === true) return;
  const store = ret.store || 'UNKNOWN';
  const date  = ret.date  || nowISODate;
  const key   = `${store}||${date}`;
  if (!storeGroups[key]) storeGroups[key] = { store, date, records: [], totalQty: 0 };
  storeGroups[key].records.push(ret);
  storeGroups[key].totalQty += (ret.quantity || 0);
});
if (Object.keys(storeGroups).length === 0) {
  updateCloseYearProgress('Stock Returns - No New Records to Merge', 100);
  return;
}
const mergedRecords = [];
for (const [, grp] of Object.entries(storeGroups)) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const { store, date, records, totalQty } = grp;

  
  const sellerBreakdown = {};
  records.forEach(r => {
    const seller = r.seller || 'Unknown';
    if (!sellerBreakdown[seller]) {
      sellerBreakdown[seller] = { quantity: 0, recordCount: 0 };
    }
    sellerBreakdown[seller].quantity += (r.quantity || 0);
    sellerBreakdown[seller].recordCount++;
  });
  const sellers = [...new Set(records.map(r => r.seller).filter(Boolean))];
  const mergedId = generateUUID('ret-merged');

  
  const base = _buildMergedBase(mergedId, mergeEpoch, nowISODate, nowTime, {});
  const mergedRecord = ensureRecordIntegrity({
    ...base,
    date,          
    store,
    quantity:      parseFloat(totalQty.toFixed(4)),
    seller:        sellers.join(', ') || 'Multiple',
    mergedRecordCount: records.length,
    mergedSummary: {
      store,
      date,
      totalQuantity:       parseFloat(totalQty.toFixed(4)),
      contributingSellers: sellers,
      sellerBreakdown:     sellerBreakdown,
      recordCount:         records.length
    }
  }, false, true);
  mergedRecords.push(mergedRecord);
}
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (firebaseDB && currentUser) {
  const userRef = firebaseDB.collection('users').doc(currentUser.uid);
  const commitResult = await _commitMergedBatch(userRef, 'returns', mergedRecords, d => !d.isMerged);
  if (!commitResult.ok) {
    console.warn(`mergeStockReturnsData: Firestore commit partial failure — ${commitResult.batchesFailed}/${commitResult.batchesTotal} batch(es) failed`, commitResult.error);
    _markRowSyncWarning('ret', commitResult);
  }
}
const existingMerged = stockReturns.filter(r => r.isMerged === true);
stockReturns = [...existingMerged, ...mergedRecords];
await idb.set('stock_returns', stockReturns);
emitSyncUpdate({ stock_returns: stockReturns });
updateCloseYearProgress('Stock Returns Merged', 100);
}
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
console.error('An unexpected error occurred.', e);
showToast('An unexpected error occurred.', 'error');
}
const seenIds = new Set();
const uniqueDocs = devicesSnap.docs.filter(doc => {
const id = doc.data().deviceId;
if (!id || id === 'default_device' || doc.id === 'default_device') return false;
if (seenIds.has(id)) return false;
seenIds.add(id);
return true;
});
if (uniqueDocs.length === 0) {
container.innerHTML = `
<div class="u-empty-state-sm" >
No devices registered yet
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
const isCurrentDevice = device.deviceId === currentDeviceId;
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
const devBorder = isCurrentDevice ? 'var(--accent)' : 'var(--glass-border)';
const onlineColor = isOnline ? '#30d158' : '#ff453a';
const onlineDot = isOnline ? '● Online' : '○ Offline';
const shortId = device.deviceId ? device.deviceId.substring(0, 20) + '…' : 'N/A';
const thisDeviceBadge = isCurrentDevice
? '<span style="margin-left:6px;font-size:0.6rem;color:var(--accent);font-family:Geist,sans-serif;font-weight:700;">(This Device)</span>'
: '';
let cardHtml = '<div style="margin-bottom:12px;padding:14px;background:var(--glass);border-radius:14px;border:2px solid ' + devBorder + ';">';
cardHtml += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;gap:8px;">';
cardHtml += '<div style="font-size:0.65rem;font-family:\'Geist Mono\',monospace;color:var(--text-muted);word-break:break-all;flex:1;min-width:0;line-height:1.4;">' + shortId + thisDeviceBadge + '</div>';
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
if (!isCurrentDevice) {
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
} else {
const thisDeviceModeColor = modeColor;
cardHtml += '<div style="padding:8px 10px;background:rgba(0,122,255,0.05);border:1px solid rgba(0,122,255,0.2);border-radius:8px;color:var(--text-muted);text-align:center;font-size:0.7rem;">This Device — <span style="color:' + thisDeviceModeColor + ';font-weight:700;">' + modeLabel + '</span></div>';
}
cardHtml += '</div>';
html += cardHtml;
});
container.innerHTML = html;
} catch (error) {
console.error('An unexpected error occurred.', error);
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
console.error('Failed to save data locally.', error);
showToast('Failed to save data locally.', 'error');
}
}
window.restoreDeviceModeOnLogin = restoreDeviceModeOnLogin;
async function listenForDeviceCommands() {
if (!firebaseDB || !currentUser) return;
try {
const deviceId = await getDeviceId();
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
const deviceRef = userRef.collection('devices').doc(deviceId);
const unsubscribe = deviceRef.onSnapshot((doc) => {
if (!doc.exists) return;
const data = doc.data();
if (data.targetMode && data.targetModeTimestamp) {
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
: data.targetModeTimestamp;
const lastProcessed = window.lastProcessedCommandTimestamp || 0;
if (commandTimestamp > lastProcessed) {
applyRemoteModeChange(effectiveMode, data.commandSource || 'remote', resolvedName, resolvedUserTabs);
window.lastProcessedCommandTimestamp = commandTimestamp;
}
}
}, (error) => {
console.warn('Device command listener error:', error);
});
window.deviceCommandsUnsubscribe = unsubscribe;
} catch (error) {
console.error('listenForDeviceCommands failed:', error);
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
} catch (e) { console.error('Firebase write failed:', e); }
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
async function verifyTimestampConsistency() {
const report = {
collections: {},
settings: {},
issues: [],
summary: {
totalRecords: 0,
recordsWithTimestamps: 0,
recordsWithoutTimestamps: 0,
recordsWithInconsistentTimestamps: 0
}
};
const checkTimestamps = (item, collectionName) => {
const timestamps = {
timestamp: item.timestamp,
createdAt: item.createdAt,
updatedAt: item.updatedAt
};
const hasAnyTimestamp = timestamps.timestamp || timestamps.createdAt || timestamps.updatedAt;
if (!hasAnyTimestamp) {
report.issues.push({
type: 'MISSING_TIMESTAMPS',
collection: collectionName,
id: item.id,
message: 'Record has no timestamps at all'
});
report.summary.recordsWithoutTimestamps++;
} else {
report.summary.recordsWithTimestamps++;
const times = Object.values(timestamps).filter(t => t).map(t => {
return typeof t === 'number' ? t : new Date(t).getTime();
});
if (times.length > 1) {
const minTime = Math.min(...times);
const maxTime = Math.max(...times);
const diff = maxTime - minTime;
if (diff > 86400000) {
report.issues.push({
type: 'INCONSISTENT_TIMESTAMPS',
collection: collectionName,
id: item.id,
timestamps: timestamps,
difference: `${Math.round(diff / 1000 / 60 / 60)} hours`,
message: 'Timestamps differ by more than 1 day'
});
report.summary.recordsWithInconsistentTimestamps++;
}
}
}
return timestamps;
};
const collections = [
{ name: 'mfg_pro_pkr', label: 'Production' },
{ name: 'noman_history', label: 'Calculator History' },
{ name: 'customer_sales', label: 'Customer Sales' },
{ name: 'rep_sales', label: 'Rep Sales' },
{ name: 'rep_customers', label: 'Rep Customers' },
{ name: 'factory_inventory_data', label: 'Factory Inventory' },
{ name: 'factory_production_history', label: 'Factory History' },
{ name: 'stock_returns', label: 'Stock Returns' },
{ name: 'payment_transactions', label: 'Payment Transactions' },
{ name: 'payment_entities', label: 'Payment Entities' },
{ name: 'expenses', label: 'Expenses' }
];
for (const collection of collections) {
const data = await idb.get(collection.name, []);
report.collections[collection.name] = {
label: collection.label,
count: data.length,
withTimestamps: 0,
withoutTimestamps: 0
};
report.summary.totalRecords += data.length;
data.forEach(item => {
const timestamps = checkTimestamps(item, collection.name);
if (timestamps.timestamp || timestamps.createdAt || timestamps.updatedAt) {
report.collections[collection.name].withTimestamps++;
} else {
report.collections[collection.name].withoutTimestamps++;
}
});
}
const settingsKeys = [
'factory_default_formulas',
'factory_additional_costs',
'factory_cost_adjustment_factor',
'factory_sale_prices',
'factory_unit_tracking',
'naswar_default_settings'
];
for (const key of settingsKeys) {
const timestamp = await idb.get(`${key}_timestamp`);
report.settings[key] = {
hasTimestamp: !!timestamp,
timestamp: timestamp,
date: timestamp ? new Date(timestamp).toLocaleString() : 'N/A'
};
if (!timestamp) {
report.issues.push({
type: 'MISSING_SETTING_TIMESTAMP',
setting: key,
message: 'Setting does not have a timestamp'
});
}
}
Object.entries(report.collections).forEach(([name, data]) => {
});
Object.entries(report.settings).forEach(([name, data]) => {
});
if (report.issues.length > 0) {
report.issues.forEach((issue, index) => {
});
showToast(`⚠ Timestamp check: ${report.issues.length} issue${report.issues.length !== 1 ? 's' : ''} found.`, 'warning', 4000);
} else {
showToast('Timestamp consistency check passed — all records healthy.', 'success', 3000);
}
return report;
}
async function deduplicateAllData() {
const _ddMsg = `Run a full deduplication scan?\n\nThis will:\n • Scan all records across every collection\n • Remove exact duplicate entries (keeping the newest version)\n • Sync cleaned data to the cloud\n\n\u26a0 This operation may take 30–60 seconds depending on data volume. Do not close the app while it runs.\n\nThis cannot be undone — but your data will only be improved, not deleted.`;
if (!(await showGlassConfirm(_ddMsg, { title: 'Deduplicate All Data', confirmText: 'Run Cleanup', cancelText: 'Cancel', danger: true }))) {
return;
}
showToast('Scanning for duplicates and old IDs...', 'info');
const results = {
collections: {},
totalDuplicates: 0,
totalRecordsBefore: 0,
totalRecordsAfter: 0
};
const getTimestampValue = (record) => {
if (!record) return 0;
let ts = record.updatedAt || record.timestamp || record.createdAt || 0;
if (typeof ts === 'number') {
return ts;
}
if (ts && typeof ts.toMillis === 'function') {
return ts.toMillis();
}
if (ts && typeof ts === 'object') {
if (typeof ts.seconds === 'number') {
return ts.seconds * 1000;
}
if (typeof ts._seconds === 'number') {
return ts._seconds * 1000;
}
}
if (ts instanceof Date) {
return ts.getTime();
}
if (typeof ts === 'string') {
try {
const dateStr = ts.replace('Z', '+00:00');
const date = new Date(dateStr);
const time = date.getTime();
if (!isNaN(time)) {
return time;
}
} catch (e) {
}
}
return 0;
};
const deduplicateArray = (array) => {
if (!Array.isArray(array) || array.length === 0) {
return { cleaned: array, duplicates: 0 };
}
const seen = new Map();
let duplicatesRemoved = 0;
array.forEach(item => {
if (!item || !item.id) return;
if (!validateUUID(item.id)) item.id = generateUUID();
if (seen.has(item.id)) {
duplicatesRemoved++;
const existing = seen.get(item.id);
const existingTime = getTimestampValue(existing);
const itemTime = getTimestampValue(item);
if (itemTime > existingTime) {
seen.set(item.id, item);
}
} else {
seen.set(item.id, item);
}
});
return {
cleaned: Array.from(seen.values()),
duplicates: duplicatesRemoved
};
};
const collections = [
{ key: 'mfg_pro_pkr', label: 'Production', variable: 'db' },
{ key: 'noman_history', label: 'Calculator History', variable: null },
{ key: 'customer_sales', label: 'Customer Sales', variable: 'customerSales' },
{ key: 'rep_sales', label: 'Rep Sales', variable: 'repSales' },
{ key: 'rep_customers', label: 'Rep Customers', variable: 'repCustomers' },
{ key: 'factory_inventory_data', label: 'Factory Inventory', variable: 'factoryInventoryData' },
{ key: 'factory_production_history', label: 'Factory History', variable: 'factoryProductionHistory' },
{ key: 'stock_returns', label: 'Stock Returns', variable: 'stockReturns' },
{ key: 'payment_transactions', label: 'Payment Transactions', variable: 'paymentTransactions' },
{ key: 'payment_entities', label: 'Payment Entities', variable: 'paymentEntities' },
{ key: 'expenses', label: 'Expenses', variable: 'expenseRecords' }
];
for (const collection of collections) {
const data = await idb.get(collection.key, []);
const before = data.length;
results.totalRecordsBefore += before;
const { cleaned, duplicates } = deduplicateArray(data);
const after = cleaned.length;
results.totalRecordsAfter += after;
results.collections[collection.key] = {
label: collection.label,
before: before,
after: after,
duplicates: duplicates
};
results.totalDuplicates += duplicates;
if (duplicates > 0) {
await idb.set(collection.key, cleaned);
if (collection.variable === 'db') db = cleaned;
else if (collection.variable === 'customerSales') customerSales = cleaned;
else if (collection.variable === 'repSales') repSales = cleaned;
else if (collection.variable === 'repCustomers') repCustomers = cleaned;
else if (collection.variable === 'factoryInventoryData') factoryInventoryData = cleaned;
else if (collection.variable === 'factoryProductionHistory') factoryProductionHistory = cleaned;
else if (collection.variable === 'stockReturns') stockReturns = cleaned;
else if (collection.variable === 'paymentTransactions') paymentTransactions = cleaned;
else if (collection.variable === 'paymentEntities') paymentEntities = cleaned;
else if (collection.variable === 'expenseRecords') expenseRecords = cleaned;
}
}
if (results.totalDuplicates > 0) {
showToast(` Removed ${results.totalDuplicates} duplicates!`, 'success');
await refreshAllDisplays();
if (firebaseDB && currentUser) {
showToast('Syncing cleaned data to cloud...', 'info');
await performOneClickSync(true);
}
showToast(` Done! ${results.totalDuplicates} duplicates removed. Data synced to cloud.`, 'success', 5000);
} else {
showToast(' No duplicates found! Data is clean.', 'success');
}
return results;
}
window.showDeltaSyncDetails = showDeltaSyncDetails;
window.verifyTimestampConsistency = verifyTimestampConsistency;
window.deduplicateAllData = deduplicateAllData;
async function verifyCompleteTimestampConsistency() {
const report = {
tabs: {},
indexedDB: {},
deltaSync: {},
compatibility: {},
issues: [],
summary: {
totalRecords: 0,
recordsWithValidTimestamps: 0,
recordsWithIssues: 0,
deltaSyncCompatible: true,
firestoreCompatible: true
}
};
const tabs = [
{ name: 'Production', idbKey: 'mfg_pro_pkr', variable: 'db', tab: 'prod' },
{ name: 'Sales', idbKey: 'customer_sales', variable: 'customerSales', tab: 'sales' },
{ name: 'Calculator', idbKey: 'noman_history', variable: null, tab: 'calc' },
{ name: 'Factory', idbKeys: ['factory_inventory_data', 'factory_production_history'], tab: 'factory' },
{ name: 'Payments', idbKeys: ['payment_transactions', 'payment_entities'], tab: 'payments' },
{ name: 'Rep Sales', idbKey: 'rep_sales', variable: 'repSales', tab: 'rep' }
];
for (const tab of tabs) {
const tabReport = {
name: tab.name,
collections: {},
totalRecords: 0,
validTimestamps: 0,
issues: 0
};
const keys = tab.idbKeys || [tab.idbKey];
for (const key of keys) {
const data = await idb.get(key, []);
tabReport.totalRecords += data.length;
let valid = 0;
let invalid = 0;
for (const record of data) {
if (!record) continue;
const ts = record.updatedAt || record.timestamp || record.createdAt;
if (ts) {
const extracted = extractTimestampValue(record);
if (extracted > 0) {
valid++;
} else {
invalid++;
report.issues.push({
type: 'INVALID_TIMESTAMP',
tab: tab.name,
collection: key,
id: record.id,
timestamp: ts
});
}
} else {
invalid++;
}
}
tabReport.collections[key] = {
total: data.length,
valid: valid,
invalid: invalid
};
tabReport.validTimestamps += valid;
tabReport.issues += invalid;
}
report.tabs[tab.name] = tabReport;
report.summary.totalRecords += tabReport.totalRecords;
report.summary.recordsWithValidTimestamps += tabReport.validTimestamps;
report.summary.recordsWithIssues += tabReport.issues;
}
const idbCollections = [
'mfg_pro_pkr', 'noman_history', 'customer_sales', 'rep_sales', 'rep_customers',
'factory_inventory_data', 'factory_production_history', 'stock_returns',
'payment_transactions', 'payment_entities', 'expenses'
];
for (const collectionName of idbCollections) {
const data = await idb.get(collectionName, []);
if (data.length === 0) {
report.indexedDB[collectionName] = { status: 'empty', count: 0 };
continue;
}
const formats = {
number: 0,
string: 0,
date: 0,
firestore: 0,
dict: 0,
missing: 0,
invalid: 0
};
for (const record of data) {
const ts = record.updatedAt || record.timestamp || record.createdAt;
if (!ts) {
formats.missing++;
} else if (typeof ts === 'number') {
formats.number++;
} else if (typeof ts === 'string') {
formats.string++;
} else if (ts instanceof Date) {
formats.date++;
} else if (ts && typeof ts.toMillis === 'function') {
formats.firestore++;
} else if (ts && typeof ts === 'object' && (ts.seconds || ts._seconds)) {
formats.dict++;
} else {
formats.invalid++;
}
}
report.indexedDB[collectionName] = {
status: 'ok',
count: data.length,
formats: formats
};
const validCount = formats.number + formats.string + formats.date + formats.firestore + formats.dict;
}
const deltaSyncCollections = [
{ name: 'production', idbKey: 'mfg_pro_pkr' },
{ name: 'sales', idbKey: 'customer_sales' },
{ name: 'calculator_history', idbKey: 'noman_history' },
{ name: 'rep_sales', idbKey: 'rep_sales' },
{ name: 'rep_customers', idbKey: 'rep_customers' },
{ name: 'transactions', idbKey: 'payment_transactions' },
{ name: 'entities', idbKey: 'payment_entities' },
{ name: 'inventory', idbKey: 'factory_inventory_data' },
{ name: 'factory_history', idbKey: 'factory_production_history' },
{ name: 'returns', idbKey: 'stock_returns' },
{ name: 'expenses', idbKey: 'expenses' }
];
for (const collection of deltaSyncCollections) {
const data = await idb.get(collection.idbKey, []);
if (data.length === 0) {
report.deltaSync[collection.name] = { status: 'empty', compatible: true };
continue;
}
let deltaSyncWorking = 0;
let deltaSyncFailing = 0;
for (const record of data) {
const itemTime = record.updatedAt || record.timestamp || record.createdAt || 0;
const itemTimestamp = typeof itemTime === 'number' ? itemTime :
typeof itemTime === 'string' ? new Date(itemTime).getTime() :
itemTime?.toMillis ? itemTime.toMillis() : 0;
if (itemTimestamp > 0) {
deltaSyncWorking++;
} else {
deltaSyncFailing++;
}
}
const compatible = deltaSyncFailing === 0;
report.deltaSync[collection.name] = {
status: compatible ? 'compatible' : 'issues',
compatible: compatible,
total: data.length,
working: deltaSyncWorking,
failing: deltaSyncFailing
};
if (!compatible) {
report.summary.deltaSyncCompatible = false;
}
const statusIcon = compatible ? '' : '';
}
for (const collectionName of idbCollections) {
const data = await idb.get(collectionName, []);
if (data.length === 0) {
report.compatibility[collectionName] = { firestore: 'empty' };
continue;
}
let canSerialize = 0;
let cannotSerialize = 0;
for (const record of data.slice(0, 10)) {
try {
const ts = record.updatedAt || record.timestamp || record.createdAt;
if (typeof ts === 'number' || typeof ts === 'string' || ts instanceof Date) {
canSerialize++;
} else if (ts && typeof ts === 'object') {
canSerialize++;
} else {
cannotSerialize++;
}
} catch (e) {
cannotSerialize++;
}
}
const compatible = cannotSerialize === 0;
report.compatibility[collectionName] = {
firestore: compatible ? 'compatible' : 'issues',
sampled: Math.min(10, data.length),
compatible: canSerialize,
incompatible: cannotSerialize
};
if (!compatible) {
report.summary.firestoreCompatible = false;
}
}
const testRecords = [
{ id: 'test-1', updatedAt: Date.now(), name: 'Number timestamp' },
{ id: 'test-2', timestamp: new Date().toISOString(), name: 'ISO string' },
{ id: 'test-3', createdAt: new Date(), name: 'Date object' },
{ id: 'test-4', updatedAt: { seconds: Math.floor(Date.now()/1000) }, name: 'Dict timestamp' }
];
let extractionWorks = true;
for (const record of testRecords) {
const extracted = extractTimestampValue(record);
if (extracted === 0) {
extractionWorks = false;
}
}
if (extractionWorks) {
}
const testDuplicates = [
{ id: 'dup-1', timestamp: 1000, value: 'old' },
{ id: 'dup-1', timestamp: 2000, value: 'new' }
];
if (report.issues.length > 0) {
report.issues.slice(0, 5).forEach((issue, i) => {
});
if (report.issues.length > 5) {
}
} else {
}
if (report.issues.length > 0) {
showToast(`⚠ Full verification: ${report.issues.length} issue${report.issues.length !== 1 ? 's' : ''} detected.`, 'warning', 4500);
} else {
showToast('Full system verification passed — all data is consistent.', 'success', 3500);
}
return report;
}
function extractTimestampValue(record) {
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
const date = new Date(ts.replace('Z', '+00:00'));
const time = date.getTime();
if (!isNaN(time)) return time;
} catch (e) {}
}
return 0;
}
window.verifyCompleteTimestampConsistency = verifyCompleteTimestampConsistency;
async function runUnifiedCleanup() {
const _ucMsg = `Run a comprehensive cleanup and verification pass?\n\nThis will:\n • Remove duplicate records across all collections\n • Verify and fix corrupted timestamps\n • Check record integrity and flag anomalies\n • Sync the cleaned dataset to cloud\n\n\u23f1 Estimated time: 2–3 minutes. Do not close the app during this process.\n\nYour data will only be improved — no valid records are deleted.`;
if (!(await showGlassConfirm(_ucMsg, { title: 'Unified Cleanup & Verification', confirmText: 'Run Full Cleanup', cancelText: 'Cancel', danger: true }))) {
return;
}
showToast(' Starting cleanup...', 'info', 3000);
try {
showToast(' Cleaning ...', 'info', 3000);
const dedupResults = {
collections: {},
totalDuplicates: 0,
totalRecordsBefore: 0,
totalRecordsAfter: 0
};
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
const date = new Date(ts.replace('Z', '+00:00'));
const time = date.getTime();
if (!isNaN(time)) return time;
} catch (e) {}
}
return 0;
};
const deduplicateArray = (array) => {
if (!Array.isArray(array) || array.length === 0) {
return { cleaned: array, duplicates: 0 };
}
const seen = new Map();
let duplicatesRemoved = 0;
array.forEach(item => {
if (!item || !item.id) return;
if (!validateUUID(item.id)) item.id = generateUUID();
if (seen.has(item.id)) {
duplicatesRemoved++;
const existing = seen.get(item.id);
const existingTime = getTimestampValue(existing);
const itemTime = getTimestampValue(item);
if (itemTime > existingTime) {
seen.set(item.id, item);
}
} else {
seen.set(item.id, item);
}
});
return {
cleaned: Array.from(seen.values()),
duplicates: duplicatesRemoved
};
};
const collections = [
{ key: 'mfg_pro_pkr', label: 'Production', variable: 'db' },
{ key: 'noman_history', label: 'Calculator History', variable: null },
{ key: 'customer_sales', label: 'Customer Sales', variable: 'customerSales' },
{ key: 'rep_sales', label: 'Rep Sales', variable: 'repSales' },
{ key: 'rep_customers', label: 'Rep Customers', variable: 'repCustomers' },
{ key: 'factory_inventory_data', label: 'Factory Inventory', variable: 'factoryInventoryData' },
{ key: 'factory_production_history', label: 'Factory History', variable: 'factoryProductionHistory' },
{ key: 'stock_returns', label: 'Stock Returns', variable: 'stockReturns' },
{ key: 'payment_transactions', label: 'Payment Transactions', variable: 'paymentTransactions' },
{ key: 'payment_entities', label: 'Payment Entities', variable: 'paymentEntities' },
{ key: 'expenses', label: 'Expenses', variable: 'expenseRecords' }
];
for (const collection of collections) {
const data = await idb.get(collection.key, []);
const before = data.length;
dedupResults.totalRecordsBefore += before;
const { cleaned, duplicates } = deduplicateArray(data);
const after = cleaned.length;
dedupResults.totalRecordsAfter += after;
dedupResults.collections[collection.key] = {
label: collection.label,
before: before,
after: after,
duplicates: duplicates
};
dedupResults.totalDuplicates += duplicates;
if (duplicates > 0) {
await idb.set(collection.key, cleaned);
if (collection.variable === 'db') db = cleaned;
else if (collection.variable === 'customerSales') customerSales = cleaned;
else if (collection.variable === 'repSales') repSales = cleaned;
else if (collection.variable === 'repCustomers') repCustomers = cleaned;
else if (collection.variable === 'factoryInventoryData') factoryInventoryData = cleaned;
else if (collection.variable === 'factoryProductionHistory') factoryProductionHistory = cleaned;
else if (collection.variable === 'stockReturns') stockReturns = cleaned;
else if (collection.variable === 'paymentTransactions') paymentTransactions = cleaned;
else if (collection.variable === 'paymentEntities') paymentEntities = cleaned;
else if (collection.variable === 'expenseRecords') expenseRecords = cleaned;
}
}
showToast(' Verifying ...', 'info', 3000);
await verifyTimestampConsistency();
showToast('Full system scan...', 'info', 3000);
const verificationReport = await verifyCompleteTimestampConsistency();
showToast('Syncing to cloud...', 'info', 3000);
if (firebaseDB && currentUser) {
try {
await refreshAllDisplays();
await performOneClickSync(true);
} catch (syncError) {
console.error('Sync failed. Check your connection.', syncError);
showToast('Sync failed. Check your connection.', 'error');
}
} else {
}
const summary = ` Unified Cleanup Complete!
Duplicates Removed: ${dedupResults.totalDuplicates}
Total Records: ${verificationReport.summary.totalRecords}
Issues Found: ${verificationReport.summary.recordsWithIssues}
Delta Sync: ${verificationReport.summary.deltaSyncCompatible ? '' : ''}
Firestore: ${verificationReport.summary.firestoreCompatible ? '' : ''}
${firebaseDB && currentUser ? ' Synced to cloud' : ' Cloud sync skipped'}
Check console (F12) for detailed report.`;
showToast(' cleanup complete!', 'success', 3000);
} catch (error) {
showToast(' Cleanup failed: ' + error.message, 'error', 5000);
showToast(' Unified cleanup error: ' + error.message, 'error', 5000);
}
}
window.runUnifiedCleanup = runUnifiedCleanup;
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
console.error('saveSalesRepsList error:', e);
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
console.error('saveUserRolesList error:', e);
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
// ─── Overlay Stack Manager ────────────────────────────────────────────────────
// Tracks which overlays are open and in what order, so backdrop clicks and
// Escape key close exactly ONE layer per action (the topmost one).
const _overlayStack = (() => {
  // Registry: id → { isOpen, closeFn, contentSelector }
  // contentSelector: CSS selector for the inner card/box — clicks inside it are ignored
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
    'entityTransactionsOverlay':   { closeFn: () => closeEntityTransactions(),        contentSel: '.factory-overlay-card' },
    'manage-reps-modal':           { closeFn: () => closeManageRepsModal(),           contentSel: '#manage-reps-card'     },
  };

  // Returns a list of currently-open overlay entries ordered by DOM position
  // (later in DOM = higher stacking order = topmost visually).
  function _openLayers() {
    const open = [];
    for (const [id, cfg] of Object.entries(_registry)) {
      const el = document.getElementById(id);
      if (!el) continue;
      const isOpen = el.classList.contains('open') ||
                     (el.style.display && el.style.display !== 'none' && el.style.display !== '');
      if (isOpen) open.push({ id, el, ...cfg });
    }
    // Sort by DOM order so the last one in the document is treated as topmost
    open.sort((a, b) => {
      const pos = a.el.compareDocumentPosition(b.el);
      return (pos & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
    });
    return open;
  }

  // Close only the topmost open overlay. Returns true if something was closed.
  function closeTop() {
    const layers = _openLayers();
    if (layers.length === 0) return false;
    const top = layers[layers.length - 1];
    top.closeFn();
    return true;
  }

  // Backdrop click handler — close top layer only when clicking outside its card
  document.addEventListener('click', function(e) {
    const layers = _openLayers();
    if (layers.length === 0) return;
    const top = layers[layers.length - 1];
    // If click is inside the card/content area of the topmost overlay, do nothing
    const contentEl = top.el.querySelector(top.contentSel);
    if (contentEl && contentEl.contains(e.target)) return;
    // Also ignore clicks that are directly on a child overlay's card
    // (e.g. customerEditOverlay sitting on top of customerManagementOverlay)
    if (layers.length > 1) {
      const secondTop = layers[layers.length - 2];
      const secondContent = secondTop.el.querySelector(secondTop.contentSel);
      if (secondContent && secondContent.contains(e.target)) return;
    }
    top.closeFn();
  }, true);

  // Escape key — close top layer only
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    // glass-confirm dialogs handle Escape themselves — skip if one is open
    if (document.querySelector('.glass-confirm-backdrop')) return;
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
console.error('analyzeBackupFile error:', error);
showToast('Could not parse backup file: ' + error.message, 'error');
}
};