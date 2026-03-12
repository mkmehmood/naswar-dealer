async function saveWithTracking(key, data, specificRecord = null, specificIds = null) {
const result = await idb.set(key, data);
const collectionEntry = IndexedDBToFirestoreMap[key];
if (collectionEntry) {
  const col = collectionEntry.collection;
  if (specificRecord && specificRecord.id) {
    DeltaSync.trackId(col, specificRecord.id);
  } else if (Array.isArray(specificIds) && specificIds.length > 0) {
    specificIds.forEach(id => DeltaSync.trackId(col, id));
  } else {
    DeltaSync.trackCollection(col);
  }
}
return result;
}
const IndexedDBToFirestoreMap = {
'mfg_pro_pkr': { collection: 'production', varName: 'db' },
'customer_sales': { collection: 'sales', varName: 'customerSales' },
'noman_history': { collection: 'calculator_history', varName: 'salesHistory' },
'rep_sales': { collection: 'rep_sales', varName: 'repSales' },
'rep_customers': { collection: 'rep_customers', varName: 'repCustomers' },
'sales_customers': { collection: 'sales_customers', varName: 'salesCustomers' },
'payment_transactions': { collection: 'transactions', varName: 'paymentTransactions' },
'payment_entities': { collection: 'entities', varName: 'paymentEntities' },
'factory_inventory_data': { collection: 'inventory', varName: 'factoryInventoryData' },
'factory_production_history': { collection: 'factory_history', varName: 'factoryProductionHistory' },
'expenses': { collection: 'expenses', varName: 'expenseRecords' },
'stock_returns': { collection: 'returns', varName: 'stockReturns' }
};
const FirestoreToIndexedDBMap = {
'production': 'mfg_pro_pkr',
'sales': 'customer_sales',
'calculator_history': 'noman_history',
'rep_sales': 'rep_sales',
'rep_customers': 'rep_customers',
'sales_customers': 'sales_customers',
'transactions': 'payment_transactions',
'entities': 'payment_entities',
'inventory': 'factory_inventory_data',
'factory_history': 'factory_production_history',
'expenses': 'expenses',
'returns': 'stock_returns'
};
function getFirestoreCollection(idbKey) {
return IndexedDBToFirestoreMap[idbKey]?.collection || idbKey;
}
function getIndexedDBKey(firestoreCollection) {
return FirestoreToIndexedDBMap[firestoreCollection] || firestoreCollection;
}
async function saveRecordToFirestore(idbKey, record, silent = true) {
if (!firebaseDB || !currentUser) {
return false;
}
if (!record || !record.id) {
return false;
}
if (!validateUUID(String(record.id))) {
console.warn('[saveRecordToFirestore] Blocked upload: invalid UUID', record.id);
return false;
}
const collectionName = getFirestoreCollection(idbKey);
if (!collectionName) {
return false;
}
if (window._firestoreNetworkDisabled || !navigator.onLine) {
if (typeof OfflineQueue !== 'undefined') {
const now = Date.now();
const queuedRecord = sanitizeForFirestore({
...record,
syncedAt: new Date().toISOString()
});
if (!queuedRecord.createdAt) queuedRecord.createdAt = now;
if (!record.isMerged) queuedRecord.updatedAt = now;
await OfflineQueue.add({
action: 'set',
collection: collectionName,
docId: String(record.id),
data: queuedRecord
});
}
return true;
}
try {
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
const docRef = userRef.collection(collectionName).doc(String(record.id));
const now = Date.now();
const sanitized = sanitizeForFirestore({ ...record, syncedAt: new Date().toISOString() });
if (!sanitized.createdAt) sanitized.createdAt = now;
if (!record.isMerged) sanitized.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
await docRef.set(sanitized, { merge: true });
trackFirestoreWrite(1);
await DeltaSync.setLastSyncTimestamp(collectionName);

if (typeof UUIDSyncRegistry !== 'undefined') {
  UUIDSyncRegistry.markUploaded(collectionName, record.id);
} else {
  DeltaSync.markUploaded(collectionName, record.id);
}
return true;
} catch (error) {
if (typeof OfflineQueue !== 'undefined') {
const now = Date.now();
const fallbackRecord = sanitizeForFirestore({ ...record, syncedAt: new Date().toISOString() });
if (!fallbackRecord.createdAt) fallbackRecord.createdAt = now;
if (!record.isMerged) fallbackRecord.updatedAt = now;
await OfflineQueue.add({
action: 'set',
collection: collectionName,
docId: String(record.id),
data: fallbackRecord
});
return true;
}
if (!silent) {
showToast('Failed to sync to cloud — will retry when online', 'warning');
}
return false;
}
}
async function deleteRecordFromFirestore(idbKey, recordId, silent = true) {
if (!firebaseDB || !currentUser) {
return false;
}
if (!recordId) {
return false;
}
const collectionName = getFirestoreCollection(idbKey);
if (!collectionName) {
return false;
}
if (window._firestoreNetworkDisabled || !navigator.onLine) {
if (typeof OfflineQueue !== 'undefined') {
await OfflineQueue.add({
action: 'delete',
collection: collectionName,
docId: String(recordId),
data: null
});
}
return true;
}
try {
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
const batch = firebaseDB.batch();
batch.delete(userRef.collection(collectionName).doc(String(recordId)));
batch.set(userRef.collection('deletions').doc(String(recordId)), {
id: recordId,
recordId: recordId,
collection: collectionName,
recordType: collectionName,
deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
expiresAt: firebase.firestore.Timestamp.fromMillis(Date.now() + APP_CONFIG.TOMBSTONE_EXPIRY_MS)
}, { merge: true });
await batch.commit();
trackFirestoreWrite(2);
return true;
} catch (error) {
console.error('deleteRecordFromFirestore error:', _safeErr(error));
if (typeof OfflineQueue !== 'undefined') {
await OfflineQueue.add({
action: 'delete',
collection: collectionName,
docId: String(recordId),
recordType: collectionName,
data: null
});
return true;
}
if (!silent) {
showToast('Failed to delete from cloud — will retry when online', 'warning');
}
return false;
}
}
async function unifiedSave(idbKey, dataArray, specificRecord = null) {
if (specificRecord && specificRecord.id) {
  await saveWithTracking(idbKey, dataArray, specificRecord);
  const collectionName = getFirestoreCollection(idbKey);
  try {
    const saved = await saveRecordToFirestore(idbKey, specificRecord);
    if (!saved && typeof OfflineQueue !== 'undefined') {

      const now = Date.now();
      const fallback = sanitizeForFirestore({ ...specificRecord, syncedAt: new Date().toISOString() });
      if (!fallback.createdAt) fallback.createdAt = now;
      if (!specificRecord.isMerged) fallback.updatedAt = now;
      await OfflineQueue.add({
        action: 'set',
        collection: collectionName,
        docId: String(specificRecord.id),
        data: fallback
      });

      DeltaSync.markUploaded(collectionName, specificRecord.id);
    }
  } catch (e) {
    if (typeof OfflineQueue !== 'undefined' && collectionName) {
      const now = Date.now();
      const fallback = sanitizeForFirestore({ ...specificRecord, syncedAt: new Date().toISOString() });
      if (!fallback.createdAt) fallback.createdAt = now;
      if (!specificRecord.isMerged) fallback.updatedAt = now;
      await OfflineQueue.add({
        action: 'set',
        collection: collectionName,
        docId: String(specificRecord.id),
        data: fallback
      });

      DeltaSync.markUploaded(collectionName, specificRecord.id);
    }
  }
} else {

  await saveWithTracking(idbKey, dataArray);
}
triggerAutoSync();
return true;
}
async function unifiedDelete(idbKey, dataArray, deletedRecordId, opts = {}, preDeletedRecord = null) {
if (opts.strict !== true) {
  console.warn(`[RecycleBin] BLOCKED unifiedDelete on "${idbKey}" id=${deletedRecordId} — strict flag missing. Pass { strict: true } to confirm intentional deletion.`);
  if (typeof window.showToast === 'function') window.showToast('Delete blocked: missing strict confirmation flag.', 'warning');
  return false;
}
await saveWithTracking(idbKey, dataArray);
const collectionName = getFirestoreCollection(idbKey);
Promise.resolve().then(async () => {
  try {
    if (collectionName && typeof window.registerDeletion === 'function') {
      await window.registerDeletion(deletedRecordId, collectionName, preDeletedRecord || null);
    }
    await deleteRecordFromFirestore(idbKey, deletedRecordId);
  } catch (e) {}
}).catch(() => {});
triggerAutoSync();
return true;
}
async function verifyDeltaSyncSystem() {
const collections = [
'production', 'sales', 'calculator_history', 'rep_sales', 'rep_customers',
'sales_customers',
'transactions', 'entities', 'inventory', 'factory_history', 'returns', 'expenses', 'deletions'
];
const results = {
valid: [],
issues: []
};
for (const collection of collections) {
const lastSyncMs = await DeltaSync.getLastSyncTimestamp(collection);
const lastMod = await DeltaSync.getLastLocalModification(collection);
const idbKey = getIndexedDBKey(collection);
const data = await idb.get(idbKey, []);
const hasChanges = await DeltaSync.hasLocalChanges(collection);
const status = {
collection,
lastSync: lastSyncMs
? new Date(lastSyncMs).toLocaleString()
: 'Never',
lastModification: lastMod ? new Date(lastMod).toLocaleString() : 'Never',
localRecords: data.length,
hasPendingChanges: hasChanges
};
if (lastSyncMs || data.length === 0) {
results.valid.push(status);
} else {
results.issues.push(status);
}
}
return results;
}
async function resetDeltaSync() {
await DeltaSync.clearAllTimestamps();
await idb.remove('deltaSyncStats');

if (typeof UUIDSyncRegistry !== 'undefined') await UUIDSyncRegistry.clearAll().catch(() => {});
showToast('Delta sync reset - next sync will download all data', 'info');
}
window.verifyDeltaSyncSystem = verifyDeltaSyncSystem;
window.resetDeltaSync = resetDeltaSync;
window.getFirestoreCollection = getFirestoreCollection;
window.getIndexedDBKey = getIndexedDBKey;
window.saveRecordToFirestore = saveRecordToFirestore;
window.deleteRecordFromFirestore = deleteRecordFromFirestore;
function initializeFirebaseSystem() {
const indicator = document.getElementById('connection-indicator');
if (typeof firebase === 'undefined') {
if (indicator) {
indicator.title = 'Loading Cloud SDK...';
indicator.className = 'signal-connecting';
}
setTimeout(initializeFirebaseSystem, 500);
return;
}
try {
if (!firebase.apps.length) {
firebase.initializeApp(firebaseConfig);
}
database = firebase.firestore();
firebaseDB = database;
firebaseDB.enablePersistence({ synchronizeTabs: true })
.then(function() {
})
.catch(function(err) {
if (err.code === 'failed-precondition') {
} else if (err.code === 'unimplemented') {
} else {
}
});
auth = firebase.auth();
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
.then(() => {
})
.catch((error) => {
});
auth.onAuthStateChanged(async (user) => {
if (user) {
currentUser = {
id: user.uid,
uid: user.uid,
email: user.email,
displayName: user.displayName
};

updateSyncButton();
try {
  const loginData = {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    lastLogin: new Date().toISOString()
  };
  await IDBCrypto.sessionSet('login', loginData);
  await IDBCrypto.sessionSet('active', { value: '1', ts: Date.now() });
  localStorage.setItem('persistentLogin', JSON.stringify(loginData));
  localStorage.setItem('_gznd_session_active', '1');
  sessionStorage.setItem('_gznd_session_active', '1');
} catch (e) {
console.warn('Failed to save persistent login:', e);
}
hideAuthOverlay();
showToast(`Welcome back, ${user.email.split('@')[0]}`, 'success');
idb.setUserPrefix(user.uid);
await IDBCrypto.initialize();
const keyRestored = await IDBCrypto.restoreSessionKeyFromStorage();
if (!keyRestored) {
const hasStoredCreds = await OfflineAuth.hasStoredCredentials();
if (hasStoredCreds) {
const savedEmail = await OfflineAuth.getSavedEmail();
if (savedEmail && savedEmail.toLowerCase() === user.email.toLowerCase()) {
showToast('Please enter your password to restore data access', 'warning');
setTimeout(() => {
showAuthOverlay();
const messageDiv = document.getElementById('auth-message');
if (messageDiv) {
messageDiv.textContent = 'Please enter your password to restore encrypted data access';
messageDiv.style.color = 'var(--warning)';
}
const emailInput = document.getElementById('auth-email');
if (emailInput) emailInput.value = user.email;
}, 1000);
updateSyncButton();
return;
}
}
console.warn('Auth: Could not restore encryption key - user may need to log in again');
showToast('Session restored but encryption key missing. Some features may be limited.', 'warning');
} else {
const isKeyValid = await IDBCrypto.validateKey();
if (!isKeyValid) {
console.warn('Auth: Encryption key validation failed');
IDBCrypto.clearSessionKey();
showToast('Encryption key invalid. Please log in again.', 'error');
updateSyncButton();
showAuthOverlay();
return;
}
}
try {
  if (typeof loadAllData === 'function') await loadAllData();
  if (typeof refreshAllDisplays === 'function') await refreshAllDisplays();
} catch(e) {
  console.warn('Auth: post-login data reload failed:', e);
}
updateSyncButton();
if (typeof subscribeToRealtime === 'function') {
subscribeToRealtime();
}
if (typeof registerDevice === 'function') {
setTimeout(() => {
registerDevice().catch(err => {
console.warn('Device registration failed:', err);
});
}, 500);
}
if (typeof refreshDeviceIdAnchors === 'function') {
setTimeout(() => { refreshDeviceIdAnchors().catch(() => {}); }, 1500);
}
if (typeof initDeviceShard === 'function') {
setTimeout(async () => {
  await initDeviceShard().catch(() => {});

  if (typeof UUIDSyncRegistry !== 'undefined') {
    await UUIDSyncRegistry.loadAll().catch(() => {});
  }
}, 200);
}
setTimeout(async () => {
try {
await restoreDeviceModeOnLogin(user.uid);
} catch (error) {
console.error('Could not restore device mode:', _safeErr(error));
}
}, 1000);
setTimeout(async () => {
if (typeof performOneClickSync === 'function' && !isSyncing) {
performOneClickSync(false);
}
}, 1500);
} else {
currentUser = null;
try {
  await IDBCrypto.sessionDelete('login');
  await IDBCrypto.sessionDelete('active');
  await IDBCrypto.sessionDelete('keyBackup');
  localStorage.removeItem('persistentLogin');
  localStorage.removeItem('_gznd_session_active');
  sessionStorage.removeItem('_gznd_session_active');
} catch (e) {
console.error('Failed to clear persistent login:', _safeErr(e));
}
updateSyncButton();
}
});
if (indicator) {
indicator.title = 'Cloud Connected';
indicator.className = 'signal-online';
}
if (typeof initFirebase === 'function') {
initFirebase();
} else {
setTimeout(initializeFirebaseSystem, 500);
}
} catch (error) {
console.error('Sync failed. Check your connection.', _safeErr(error));
showToast('Sync failed. Check your connection.', 'error');
if (indicator) {
indicator.title = 'Connection Failed';
indicator.className = 'signal-offline';
}
setTimeout(initializeFirebaseSystem, APP_CONFIG.FIREBASE_INIT_RETRY_DELAY);
}
}
class FirestoreDatabaseInitializer {
constructor(firebaseDB, currentUser) {
this.firebaseDB = firebaseDB;
this.currentUser = currentUser;
this.userRef = null;
this.results = {
success: [],
errors: []
};
this.timestamp = new Date().toISOString();
}
async initialize(silent = false) {
if (!this.firebaseDB || !this.currentUser) {
throw new Error('Firebase DB and Current User are required');
}
if (!silent) showToast('Setting up complete cloud database...', 'info');
this.userRef = this.firebaseDB.collection('users').doc(this.currentUser.uid);
try {
await this.createUserDocument();
await this.createDevicesCollection();
await this.createAccountCollection();
await this.createActivityLogCollection();
await this.createProductionCollection();
await this.createSalesCollections();
await this.createRepCollections();
await this.createPaymentCollections();
await this.createFactoryCollections();
await this.createExpenseCollections();
await this.createCalculatorCollection();
await this.createSettingsCollections();
await this.createContactCollections();
await this.createTeamSettingsDocument();
await this.createDeletionsCollection();
await this.createSyncUpdatesCollection();
await idb.set('firestore_initialized', true);
await idb.set('firestore_init_timestamp', Date.now());
if (!silent) showToast('Cloud database ready with all collections!', 'success');
return {
success: true,
results: this.results,
message: 'Firestore database initialized successfully with all 21 collections'
};
} catch (error) {
if (!silent) showToast(' Setup failed: ' + error.message, 'error');
return {
success: false,
error: error.message,
results: this.results
};
}
}
async createUserDocument() {
try {
await this.userRef.set({
uid: this.currentUser.uid,
email: this.currentUser.email || 'unknown@example.com',
displayName: this.currentUser.displayName || '',
createdAt: firebase.firestore.FieldValue.serverTimestamp(),
lastActivity: firebase.firestore.FieldValue.serverTimestamp(),
isActive: true,
accountType: 'standard',
version: '2.0',
initialized: true
}, { merge: true });
this.results.success.push('users/document');
} catch (error) {
this.results.errors.push({ collection: 'users', error: error.message });
throw error;
}
}
async createDevicesCollection() {
try {
const deviceRef = this.userRef.collection('devices').doc('default_device');
await deviceRef.set({
deviceId: 'default_device',
deviceName: 'Default Device',
deviceType: 'desktop',
browser: navigator.userAgent || 'Unknown',
platform: navigator.platform || 'Unknown',
online: true,
lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
lastActivity: firebase.firestore.FieldValue.serverTimestamp(),
registeredAt: firebase.firestore.FieldValue.serverTimestamp(),
currentMode: 'admin',
assignedRep: null,
capabilities: {
canSync: true,
canReceiveCommands: true,
supportsBiometric: false,
supportsNotifications: false
},
totalSyncs: 0,
totalCommands: 0,
dataUsage: {
reads: 0,
writes: 0,
deletes: 0
}
});
this.results.success.push('devices');
} catch (error) {
this.results.errors.push({ collection: 'devices', error: error.message });
}
}
async createAccountCollection() {
try {
const infoRef = this.userRef.collection('account').doc('info');
await infoRef.set({
email: this.currentUser.email || 'unknown@example.com',
displayName: this.currentUser.displayName || 'User',
accountCreated: firebase.firestore.FieldValue.serverTimestamp(),
lastActivity: firebase.firestore.FieldValue.serverTimestamp()
});
const preferencesRef = this.userRef.collection('account').doc('preferences');
await preferencesRef.set({
defaultRepProfile: salesRepsList[0] || 'NORAN SHAH',
timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
language: navigator.language || 'en',
theme: 'dark',
currency: 'PKR'
});
this.results.success.push('account');
} catch (error) {
this.results.errors.push({ collection: 'account', error: error.message });
}
}
async createActivityLogCollection() {
try {
const activityRef = this.userRef.collection('activityLog').doc('initial');
await activityRef.set({
timestamp: firebase.firestore.FieldValue.serverTimestamp(),
deviceId: 'default_device',
activityType: 'account_initialized',
details: {
message: 'Firestore database initialized with complete structure'
},
userId: this.currentUser.uid
});
this.results.success.push('activityLog');
} catch (error) {
this.results.errors.push({ collection: 'activityLog', error: error.message });
}
}
async createProductionCollection() {
try {
const placeholderRef = this.userRef.collection('production').doc('_placeholder_');
await placeholderRef.set({
_placeholder: true,
createdAt: firebase.firestore.FieldValue.serverTimestamp(),
type: 'placeholder',
message: 'Production collection initialized'
});
this.results.success.push('production');
} catch (error) {
this.results.errors.push({ collection: 'production', error: error.message });
}
}
async createSalesCollections() {
try {
const salesPlaceholder = this.userRef.collection('sales').doc('_placeholder_');
await salesPlaceholder.set({
_placeholder: true,
createdAt: firebase.firestore.FieldValue.serverTimestamp(),
type: 'placeholder',
message: 'Sales collection initialized'
});
this.results.success.push('sales');
} catch (error) {
this.results.errors.push({ collection: 'sales', error: error.message });
}
}
async createRepCollections() {
try {
const repSalesPlaceholder = this.userRef.collection('rep_sales').doc('_placeholder_');
await repSalesPlaceholder.set({
_placeholder: true,
createdAt: firebase.firestore.FieldValue.serverTimestamp(),
type: 'placeholder',
message: 'Rep sales collection initialized'
});
const repCustomersPlaceholder = this.userRef.collection('rep_customers').doc('_placeholder_');
await repCustomersPlaceholder.set({
_placeholder: true,
createdAt: firebase.firestore.FieldValue.serverTimestamp(),
type: 'placeholder',
message: 'Rep customers collection initialized'
});
this.results.success.push('rep_sales');
this.results.success.push('rep_customers');
} catch (error) {
this.results.errors.push({ collection: 'rep_sales', error: error.message });
}
}
async createPaymentCollections() {
try {
const transactionsPlaceholder = this.userRef.collection('transactions').doc('_placeholder_');
await transactionsPlaceholder.set({
_placeholder: true,
createdAt: firebase.firestore.FieldValue.serverTimestamp(),
type: 'placeholder',
message: 'Transactions collection initialized'
});
const entitiesPlaceholder = this.userRef.collection('entities').doc('_placeholder_');
await entitiesPlaceholder.set({
_placeholder: true,
createdAt: firebase.firestore.FieldValue.serverTimestamp(),
type: 'placeholder',
message: 'Entities collection initialized'
});
this.results.success.push('transactions');
this.results.success.push('entities');
} catch (error) {
this.results.errors.push({ collection: 'transactions', error: error.message });
}
}
async createFactoryCollections() {
try {
const inventoryPlaceholder = this.userRef.collection('inventory').doc('_placeholder_');
await inventoryPlaceholder.set({
_placeholder: true,
createdAt: firebase.firestore.FieldValue.serverTimestamp(),
type: 'placeholder',
message: 'Inventory collection initialized'
});
const factoryHistoryPlaceholder = this.userRef.collection('factory_history').doc('_placeholder_');
await factoryHistoryPlaceholder.set({
_placeholder: true,
createdAt: firebase.firestore.FieldValue.serverTimestamp(),
type: 'placeholder',
message: 'Factory history collection initialized'
});
this.results.success.push('inventory');
this.results.success.push('factory_history');
} catch (error) {
this.results.errors.push({ collection: 'inventory', error: error.message });
}
}
async createExpenseCollections() {
try {
const expensesPlaceholder = this.userRef.collection('expenses').doc('_placeholder_');
await expensesPlaceholder.set({
_placeholder: true,
createdAt: firebase.firestore.FieldValue.serverTimestamp(),
type: 'placeholder',
message: 'Expenses collection initialized'
});
const returnsPlaceholder = this.userRef.collection('returns').doc('_placeholder_');
await returnsPlaceholder.set({
_placeholder: true,
createdAt: firebase.firestore.FieldValue.serverTimestamp(),
type: 'placeholder',
message: 'Returns collection initialized'
});
this.results.success.push('expenses');
this.results.success.push('returns');
} catch (error) {
this.results.errors.push({ collection: 'expenses', error: error.message });
}
}
async createCalculatorCollection() {
try {
const calculatorPlaceholder = this.userRef.collection('calculator_history').doc('_placeholder_');
await calculatorPlaceholder.set({
_placeholder: true,
createdAt: firebase.firestore.FieldValue.serverTimestamp(),
type: 'placeholder',
message: 'Calculator history collection initialized'
});
this.results.success.push('calculator_history');
} catch (error) {
this.results.errors.push({ collection: 'calculator_history', error: error.message });
}
}
async createSettingsCollections() {
try {
const settingsRef = this.userRef.collection('settings').doc('config');
await settingsRef.set({
naswar_default_settings: {},
appMode: 'admin',
repProfile: salesRepsList[0] || 'NORAN SHAH',
theme: 'dark',
biometricEnabled: false,
lastSync: null,
initialized_at: this.timestamp,
last_synced: this.timestamp,
version: '2.0'
});
const factorySettingsRef = this.userRef.collection('factorySettings').doc('config');
await factorySettingsRef.set({
default_formulas: { standard: [], asaan: [] },
default_formulas_timestamp: Date.now(),
additional_costs: { standard: 0, asaan: 0 },
additional_costs_timestamp: Date.now(),
cost_adjustment_factor: { standard: 1, asaan: 1 },
cost_adjustment_factor_timestamp: Date.now(),
sale_prices: { standard: 0, asaan: 0 },
sale_prices_timestamp: Date.now(),
unit_tracking: {
standard: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
asaan: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] }
},
unit_tracking_timestamp: Date.now(),
last_synced: this.timestamp
});
const expenseCategoriesRef = this.userRef.collection('expenseCategories').doc('categories');
await expenseCategoriesRef.set({
categories: [
{ id: 'operating', name: 'Operating Expense', color: '#3b82f6' },
{ id: 'IN', name: 'Payment IN', color: '#10b981' },
{ id: 'OUT', name: 'Payment OUT', color: '#ef4444' }
],
last_synced: this.timestamp
});
this.results.success.push('settings');
this.results.success.push('factorySettings');
this.results.success.push('expenseCategories');
} catch (error) {
this.results.errors.push({ collection: 'settings', error: error.message });
}
}
async createContactCollections() {
try {
const repContactsPlaceholder = this.userRef.collection('rep_customers').doc('_placeholder_');
await repContactsPlaceholder.set({
_placeholder: true,
createdAt: firebase.firestore.FieldValue.serverTimestamp(),
type: 'placeholder',
message: 'Rep customers collection initialized'
});
const salesContactsPlaceholder = this.userRef.collection('sales_customers').doc('_placeholder_');
await salesContactsPlaceholder.set({
_placeholder: true,
createdAt: firebase.firestore.FieldValue.serverTimestamp(),
type: 'placeholder',
message: 'Sales customers collection initialized'
});
this.results.success.push('rep_customers');
this.results.success.push('sales_customers');
} catch (error) {
this.results.errors.push({ collection: 'rep_customers', error: error.message });
}
}
async createTeamSettingsDocument() {
try {
const teamRef = this.userRef.collection('settings').doc('team');
await teamRef.set({
sales_reps: [],
user_roles: [],
updated_at: 0,
last_synced: this.timestamp,
initialized: true
});
this.results.success.push('settings/team');
} catch (error) {
this.results.errors.push({ collection: 'settings/team', error: error.message });
}
}
async createDeletionsCollection() {
try {
const deletionsPlaceholder = this.userRef.collection('deletions').doc('_placeholder_');
await deletionsPlaceholder.set({
_placeholder: true,
createdAt: firebase.firestore.FieldValue.serverTimestamp(),
type: 'placeholder',
message: 'Deletions collection initialized'
});
this.results.success.push('deletions');
} catch (error) {
this.results.errors.push({ collection: 'deletions', error: error.message });
}
}
async createSyncUpdatesCollection() {
try {
const syncUpdateRef = this.userRef.collection('sync_updates').doc('initial');
await syncUpdateRef.set({
timestamp: firebase.firestore.FieldValue.serverTimestamp(),
deviceId: 'default_device',
collections: ['all'],
type: 'initialization',
message: 'Database initialized with complete structure'
});
this.results.success.push('sync_updates');
} catch (error) {
this.results.errors.push({ collection: 'sync_updates', error: error.message });
}
}
}
async function initializeCompleteFirestoreDatabase(silent = false) {
if (!firebaseDB || !currentUser) {
if (!silent) showToast('Please log in first', 'warning');
return { success: false, error: 'Not logged in' };
}
const initializer = new FirestoreDatabaseInitializer(firebaseDB, currentUser);
return await initializer.initialize(silent);
}
async function isCompleteDatabaseInitialized() {
if (!firebaseDB || !currentUser) return false;
try {
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
const requiredCollections = [
'devices', 'account', 'activityLog', 'production', 'sales',
'rep_sales', 'rep_customers',
'sales_customers',
'transactions', 'entities', 'inventory', 'factory_history', 'expenses', 'returns',
'calculator_history', 'settings', 'factorySettings', 'expenseCategories',
'deletions', 'sync_updates'
];
const checks = await Promise.all(
requiredCollections.map(async (coll) => {
const snapshot = await userRef.collection(coll).limit(1).get();
return { collection: coll, exists: !snapshot.empty };
})
);
const missing = checks.filter(c => !c.exists).map(c => c.collection);
if (missing.length > 0) {
return false;
}
return true;
} catch (error) {
return false;
}
}
async function safeInitializeCompleteDatabase(silent = false) {
const isInitialized = await isCompleteDatabaseInitialized();
if (isInitialized) {
return {
success: true,
alreadyInitialized: true,
message: 'Database was already initialized with complete structure'
};
}
return await initializeCompleteFirestoreDatabase(silent);
}
async function initializeFirestoreStructure(silent = false) {
return await initializeCompleteFirestoreDatabase(silent);
}
async function cleanupPlaceholders() {
if (!firebaseDB || !currentUser) return false;
try {
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
const batch = firebaseDB.batch();
const collections = [
'devices', 'account', 'activityLog',
'production', 'sales',
'rep_sales', 'rep_customers',
'sales_customers',
'transactions', 'entities',
'inventory', 'factory_history',
'expenses', 'returns',
'calculator_history',
'settings', 'factorySettings', 'expenseCategories',
'deletions', 'sync_updates'
];
let deleteCount = 0;
for (const collectionName of collections) {
const placeholderRef = userRef.collection(collectionName).doc('_placeholder_');
const doc = await placeholderRef.get();
if (doc.exists) {
batch.delete(placeholderRef);
deleteCount++;
}
}
if (deleteCount > 0) {
await batch.commit();
}
return true;
} catch (error) {
return false;
}
}
async function isUserInitialized() {
if (!firebaseDB || !currentUser) return false;
try {
return await isCompleteDatabaseInitialized();
} catch (error) {
return false;
}
}
function retryFirebaseInit(attempts = 0, maxAttempts = APP_CONFIG.FIREBASE_INIT_RETRY_MAX) {
initializeFirebaseSystem();
if (firebaseDB) {
return;
}
if (attempts < maxAttempts) {
const delay = Math.min(1000 * Math.pow(2, attempts), 5000);
setTimeout(() => retryFirebaseInit(attempts + 1, maxAttempts), delay);
} else {
const indicator = document.getElementById('connection-indicator');
if (indicator) {
indicator.title = 'Firebase failed to load - check console';
indicator.style.background = 'red';
}
if (typeof showToast === 'function') {
showToast(' Cloud sync unavailable. App will work offline.', 'warning');
}
}
}

const _syncQueue = (() => {
  let _chain = Promise.resolve();
  return {
    run(fn) {
      _chain = _chain.then(() => fn()).catch(err => {
        console.warn('[SyncQueue] task error:', err);
      });
      return _chain;
    }
  };
})();

const SYNC_COLLECTIONS = [
  {
    firestoreId:  'production',
    idbKey:       'mfg_pro_pkr',
    varName:      'db',
    tabSyncFn:    'syncProductionTab',
    lockOnClose:  true,
  },
  {
    firestoreId:  'sales',
    idbKey:       'customer_sales',
    varName:      'customerSales',
    tabSyncFn:    'syncSalesTab',
    lockOnClose:  true,
  },
  {
    firestoreId:  'rep_sales',
    idbKey:       'rep_sales',
    varName:      'repSales',
    tabSyncFn:    'syncRepTab',
    lockOnClose:  true,
  },
  {
    firestoreId:  'rep_customers',
    idbKey:       'rep_customers',
    varName:      'repCustomers',
    tabSyncFn:    'syncRepTab',
    lockOnClose:  false,
  },
  {
    firestoreId:  'sales_customers',
    idbKey:       'sales_customers',
    varName:      'salesCustomers',
    tabSyncFn:    null,
    lockOnClose:  false,
  },
  {
    firestoreId:  'transactions',
    idbKey:       'payment_transactions',
    varName:      'paymentTransactions',
    tabSyncFn:    'syncPaymentsTab',
    lockOnClose:  true,
  },
  {
    firestoreId:  'entities',
    idbKey:       'payment_entities',
    varName:      'paymentEntities',
    tabSyncFn:    'refreshPaymentTab',
    lockOnClose:  false,
  },
  {
    firestoreId:  'inventory',
    idbKey:       'factory_inventory_data',
    varName:      'factoryInventoryData',
    tabSyncFn:    'syncFactoryTab',
    lockOnClose:  false,
  },
  {
    firestoreId:  'factory_history',
    idbKey:       'factory_production_history',
    varName:      'factoryProductionHistory',
    tabSyncFn:    'syncFactoryTab',
    lockOnClose:  true,
  },
  {
    firestoreId:  'returns',
    idbKey:       'stock_returns',
    varName:      'stockReturns',
    tabSyncFn:    'syncProductionTab',
    lockOnClose:  true,
  },
  {
    firestoreId:  'expenses',
    idbKey:       'expenses',
    varName:      'expenseRecords',
    tabSyncFn:    'refreshPaymentTab',
    lockOnClose:  true,
  },
  {
    firestoreId:  'calculator_history',
    idbKey:       'noman_history',
    varName:      'salesHistory',
    tabSyncFn:    'syncCalculatorTab',
    lockOnClose:  true,
  },
];

function _getVar(varName) {
  switch (varName) {
    case 'db':                      return db;
    case 'customerSales':           return customerSales;
    case 'repSales':                return repSales;
    case 'repCustomers':            return repCustomers;
    case 'salesCustomers':          return salesCustomers;
    case 'paymentTransactions':     return paymentTransactions;
    case 'paymentEntities':         return paymentEntities;
    case 'factoryInventoryData':    return factoryInventoryData;
    case 'factoryProductionHistory':return factoryProductionHistory;
    case 'stockReturns':            return stockReturns;
    case 'expenseRecords':          return expenseRecords;
    case 'salesHistory':            return salesHistory;
    default:                        return [];
  }
}
function _setVar(varName, value) {
  switch (varName) {
    case 'db':                      db                      = value; break;
    case 'customerSales':           customerSales           = value; break;
    case 'repSales':                repSales                = value; break;
    case 'repCustomers':            repCustomers            = value; break;
    case 'salesCustomers':          salesCustomers          = value; break;
    case 'paymentTransactions':     paymentTransactions     = value; break;
    case 'paymentEntities':         paymentEntities         = value; break;
    case 'factoryInventoryData':    factoryInventoryData    = value; break;
    case 'factoryProductionHistory':factoryProductionHistory= value; break;
    case 'stockReturns':            stockReturns            = value; break;
    case 'expenseRecords':          expenseRecords          = value; break;
    case 'salesHistory':            salesHistory            = value; break;
  }
}

function _makeSnapshotHandler(col) {
  return async function handleSnapshot(snapshot) {
    try {
      if (snapshot.metadata.hasPendingWrites) return;
      if (snapshot.metadata.fromCache) return;
      if (col.lockOnClose && closeYearInProgress) return;

      const changes = snapshot.docChanges();
      trackFirestoreRead(changes.length);
      if (changes.length === 0) return;

      let arr = _getVar(col.varName);
      let hasChanges = false;

      for (const change of changes) {
        try {
          const docData = { id: change.doc.id, ...change.doc.data() };
          if (change.type === 'added' || change.type === 'modified') {
            deletedRecordIds.delete(change.doc.id);
            if (typeof UUIDSyncRegistry !== 'undefined') {
              UUIDSyncRegistry.markDownloaded(col.firestoreId, change.doc.id);
            } else {
              DeltaSync.markDownloaded(col.firestoreId, change.doc.id);
            }
            arr = _updateArray(arr, docData, col.firestoreId);
            hasChanges = true;
          } else if (change.type === 'removed') {
            deletedRecordIds.add(change.doc.id);
            if (typeof UUIDSyncRegistry !== 'undefined') {
              UUIDSyncRegistry.markDownloaded(col.firestoreId, change.doc.id);
            } else {
              DeltaSync.markDownloaded(col.firestoreId, change.doc.id);
            }
            _ensureLocalTombstone(change.doc.id, col.firestoreId);
            arr = arr.filter(item => item.id !== change.doc.id);
            hasChanges = true;
          }
        } catch (docErr) {
          console.warn(`[Snapshot:${col.firestoreId}] doc error`, docErr);
        }
      }

      if (hasChanges) {
        _setVar(col.varName, arr);
        await idb.set(col.idbKey, arr);
        await DeltaSync.setLastSyncTimestamp(col.firestoreId);
        emitSyncUpdate({ [col.idbKey]: arr });
        if (col.tabSyncFn && typeof window[col.tabSyncFn] === 'function') {
          window[col.tabSyncFn]();
        }
        flashLivePulse();
      }
      recordSuccessfulConnection();
    } catch (err) {
      console.error(`[Snapshot:${col.firestoreId}] error`, _safeErr(err));
      showToast('Failed to save data locally.', 'error');
    }
  };
}

function _ensureLocalTombstone(recordId, collectionName) {
  try {
    const sid = String(recordId);
    deletedRecordIds.add(sid);
    if (!Array.isArray(deletionRecords)) return;
    const exists = deletionRecords.some(
      r => String(r.id) === sid || String(r.recordId) === sid
    );
    if (!exists) {
      deletionRecords.push({
        id: sid,
        recordId: sid,
        collection: collectionName,
        recordType: collectionName,
        deletedAt: Date.now(),
        syncedToCloud: true,
      });
      idb.set('deletion_records', deletionRecords).catch(() => {});
      idb.set('deleted_records', Array.from(deletedRecordIds)).catch(() => {});
    }
  } catch (e) {  }
}

function _updateArray(array, docData, collectionName) {
  if (docData._placeholder || docData.id === '_placeholder_') return array;
  if (!docData.id || !validateUUID(String(docData.id))) {
    docData = ensureRecordIntegrity(docData, false, true);
  }
  docData = ensureRecordIntegrity(docData, false, true);
  const sid = String(docData.id);

  if (typeof UUIDSyncRegistry !== 'undefined') {
    if (UUIDSyncRegistry.skipDownload(collectionName, sid)) {

      const existingIdx = array.findIndex(item => item && item.id === docData.id);
      const localRecord = existingIdx !== -1 ? array[existingIdx] : null;
      if (!UUIDSyncRegistry.shouldApplyCloud(docData, localRecord)) return array;

    }
  } else {
    if (collectionName && DeltaSync.wasDownloaded(collectionName, sid)) return array;
  }

  const _getMs = (rec) => {
    if (!rec) return 0;
    const ts = rec.updatedAt || rec.timestamp || rec.createdAt || 0;
    if (typeof ts === 'number') return ts;
    if (ts && typeof ts.toMillis === 'function') return ts.toMillis();
    if (ts && typeof ts === 'object') {
      if (typeof ts.seconds === 'number') return ts.seconds * 1000;
      if (typeof ts._seconds === 'number') return ts._seconds * 1000;
    }
    if (ts instanceof Date) return ts.getTime();
    if (typeof ts === 'string') {
      try { const t = new Date(ts).getTime(); if (!isNaN(t)) return t; } catch (e) {}
    }
    return 0;
  };

  const existingIdx = array.findIndex(item => item && item.id === docData.id);
  if (existingIdx === -1) {
    array.push(docData);
  } else {
    const _cmpUpdate = (typeof compareRecordVersions === 'function')
      ? compareRecordVersions(docData, array[existingIdx])
      : _getMs(docData) - _getMs(array[existingIdx]);
    if (_cmpUpdate > 0) {
      array[existingIdx] = docData;
    }
  }
  if (collectionName) {

    if (typeof UUIDSyncRegistry !== 'undefined') {
      UUIDSyncRegistry.markDownloaded(collectionName, sid);
    } else {
      DeltaSync.markDownloaded(collectionName, sid);
    }
  }
  return array;
}

let realtimeRefs = [];
let socketReconnectTimer = null;
let pendingSocketUpdate = false;
let socketDebounceTimer = null;
let dbWakeUpAttempted = false;
let heartbeatInterval = null;
let autoSaveTimer = null;
let broadcastQueue = [];
let listenerRetryAttempts = 0;
const MAX_RETRY_ATTEMPTS = 5;
const BASE_RETRY_DELAY = 5000;
let listenerReconnectTimer = null;
let lastSuccessfulConnection = Date.now();
let isReconnecting = false;
let _syncLockPendingQueue = [];

function _enqueueSyncLocked(handlerFn, snapshot) {
  const existing = _syncLockPendingQueue.findIndex(e => e.handlerFn === handlerFn);
  if (existing !== -1) {
    _syncLockPendingQueue[existing].snapshot = snapshot;
  } else {
    _syncLockPendingQueue.push({ handlerFn, snapshot });
  }
}
async function _flushSyncLockQueue() {
  if (_syncLockPendingQueue.length === 0) return;
  const queued = _syncLockPendingQueue.splice(0);
  for (const entry of queued) {
    try { await entry.handlerFn(entry.snapshot); }
    catch (err) { console.warn('[SyncLock] Error replaying buffered snapshot', err); }
  }
}
function updateSignal(status) { updateSignalUI(status); }
function updateSignalUI(status) {
  const dot = document.getElementById('connection-indicator');
  if (!dot) return;
  dot.className = '';
  if (status === 'online') {
    dot.classList.add('signal-online');
    dot.title = 'Live Connection Active';
  } else if (status === 'connecting') {
    dot.classList.add('signal-connecting');
    dot.title = 'Connecting...';
  } else if (status === 'error') {
    dot.classList.add('signal-connecting');
    dot.title = 'Connection Error — Reconnecting...';
  } else {
    dot.classList.add('signal-offline');
    dot.title = 'Offline / Disconnected';
  }
}

let syncChannel = null;
try {
  syncChannel = new BroadcastChannel('data-sync-channel');
  syncChannel.onmessage = async (event) => {
    const { type, collections, timestamp, senderId } = event.data;
    if (senderId && senderId === window._selfSenderId) return;
    if (type === 'data-update' && collections) {
      for (const collectionName of collections) {
        try {
          const data = await idb.get(collectionName);
          switch (collectionName) {
            case 'mfg_pro_pkr':                db                      = data || []; break;
            case 'customer_sales':             customerSales           = data || []; break;
            case 'rep_sales':                  repSales                = data || []; break;
            case 'rep_customers':              repCustomers            = data || []; break;
            case 'sales_customers':            salesCustomers          = data || []; break;
            case 'noman_history':              salesHistory            = data || []; break;
            case 'factory_inventory_data':     factoryInventoryData    = data || []; break;
            case 'factory_production_history': factoryProductionHistory= data || []; break;
            case 'payment_entities':           paymentEntities         = data || []; break;
            case 'payment_transactions':       paymentTransactions     = data || []; break;
            case 'expenses':                   expenseRecords          = data || []; break;
            case 'stock_returns':              stockReturns            = data || []; break;
            case 'settings': {
              const settingsData = await idb.get('naswar_default_settings');
              if (settingsData !== undefined && settingsData !== null) defaultSettings = settingsData;
              break;
            }
            case 'factorySettings': {
              const fs = await idb.get('factory_default_formulas');
              if (fs !== undefined && fs !== null) factoryDefaultFormulas = fs;
              const ac = await idb.get('factory_additional_costs');
              if (ac !== undefined && ac !== null) factoryAdditionalCosts = ac;
              const caf = await idb.get('factory_cost_adjustment_factor');
              if (caf !== undefined && caf !== null) factoryCostAdjustmentFactor = caf;
              const sp = await idb.get('factory_sale_prices');
              if (sp !== undefined && sp !== null) factorySalePrices = sp;
              const ut = await idb.get('factory_unit_tracking');
              if (ut !== undefined && ut !== null) factoryUnitTracking = ut;
              break;
            }
            case 'expenseCategories': {
              const cats = await idb.get('expense_categories');
              if (Array.isArray(cats)) expenseCategories = cats;
              break;
            }
          }
        } catch (error) {
          console.error('Failed to save data locally.', _safeErr(error));
          showToast('Failed to save data locally.', 'error');
        }
      }
      if (typeof invalidateAllCaches === 'function') await invalidateAllCaches();
      if (typeof refreshAllDisplays === 'function') await refreshAllDisplays();
      flashLivePulse();
      showToast('Data synced from another device', 'success');
    }
  };
} catch (e) {
  console.warn('BroadcastChannel not supported or failed to initialize:', e);
}

function flashLivePulse() {
  const dot = document.getElementById('connection-indicator');
  if (!dot) return;
  dot.style.transform = 'scale(1.8)';
  dot.style.boxShadow = '0 0 20px #10b981';
  setTimeout(() => { dot.style.transform = ''; dot.style.boxShadow = ''; }, 300);
}

async function emitSyncUpdate(payload) {
  if (!firebaseDB || !currentUser) return;
  flashLivePulse();
  if (payload && typeof payload === 'object') {
    const changedKeys = Object.keys(payload);
    if (syncChannel) {
      try {
        if (!window._selfSenderId) {
          window._selfSenderId = (typeof generateUUID === 'function')
            ? generateUUID('tab')
            : Date.now().toString(36) + Math.random().toString(36).slice(2);
        }
        syncChannel.postMessage({
          type: 'data-update',
          collections: changedKeys,
          timestamp: Date.now(),
          senderId: window._selfSenderId,
        });
      } catch (e) { console.warn('BroadcastChannel postMessage failed', e); }
    }
  }
}

function startSyncUpdatesCleanup() {
  if (!firebaseDB || !currentUser) return;
  const runCleanup = async () => {
    if (!firebaseDB || !currentUser) return;
    try {
      const syncSnapshot = await firebaseDB
        .collection('users').doc(currentUser.uid)
        .collection('sync_updates')
        .orderBy('timestamp', 'desc')
        .get();
      if (syncSnapshot.docs.length > 10) {
        const batch = firebaseDB.batch();
        syncSnapshot.docs.slice(10).forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      }
    } catch (error) {
      console.error('Cloud save operation failed.', _safeErr(error));
    }
  };
  runCleanup();
  if (window._syncUpdatesCleanupInterval) clearInterval(window._syncUpdatesCleanupInterval);
  window._syncUpdatesCleanupInterval = setInterval(runCleanup, 60 * 60 * 1000);
}

function scheduleListenerReconnect() {
  if (isReconnecting) return;
  if (listenerReconnectTimer) clearTimeout(listenerReconnectTimer);
  if (listenerRetryAttempts >= MAX_RETRY_ATTEMPTS) {
    updateSignalUI('offline');
    if (typeof showToast === 'function') showToast('Connection lost. Please refresh the page.', 'error');
    return;
  }
  const delay = BASE_RETRY_DELAY * Math.pow(2, listenerRetryAttempts);
  listenerRetryAttempts++;
  isReconnecting = true;
  listenerReconnectTimer = setTimeout(() => {
    isReconnecting = false;
    if (firebaseDB && currentUser) subscribeToRealtime();
  }, delay);
}
function recordSuccessfulConnection() {
  lastSuccessfulConnection = Date.now();
  listenerRetryAttempts = 0;
  isReconnecting = false;
}
function isConnectionStale() {
  return (Date.now() - lastSuccessfulConnection) > 5 * 60 * 1000;
}

async function subscribeToRealtime() {
  if (!firebaseDB || !currentUser) return;

  if (!pendingFirestoreYearClose) {
    const storedFlag = await idb.get('pendingFirestoreYearClose');
    if (storedFlag === true) pendingFirestoreYearClose = true;
  }
  if (pendingFirestoreYearClose && !closeYearInProgress) {
    try {
      const userRef = firebaseDB.collection('users').doc(currentUser.uid);
      const yearCloseCollections = [
        { name: 'production',         data: db,                      filter: d => !d.isMerged },
        { name: 'sales',              data: customerSales,                   filter: d => !d.isMerged },
        { name: 'rep_sales',          data: repSales,                filter: d => !d.isMerged },
        { name: 'calculator_history', data: salesHistory,            filter: d => !d.isMerged },
        { name: 'transactions',       data: paymentTransactions,     filter: d => !d.isMerged },
        { name: 'factory_history',    data: factoryProductionHistory,filter: d => !d.isMerged },
        { name: 'expenses',           data: expenseRecords,          filter: d => !d.isMerged },
        { name: 'returns',            data: stockReturns,            filter: d => !d.isMerged },
      ];
      let allOk = true;
      for (const col of yearCloseCollections) {
        if (!Array.isArray(col.data)) continue;
        const merged = col.data.filter(r => r.isMerged === true);
        if (merged.length === 0) continue;
        const result = await _commitMergedBatch(userRef, col.name, merged, col.filter);
        if (!result.ok) { allOk = false; break; }
      }
      if (allOk) {
        pendingFirestoreYearClose = false;
        await idb.set('pendingFirestoreYearClose', false);
        showToast('Cloud sync for year-close completed successfully', 'success', 4000);
      }
    } catch (e) { console.warn('pendingFirestoreYearClose retry failed:', e); }
  }

  updateSignalUI('connecting');
  realtimeRefs.forEach(unsub => {
    try { if (typeof unsub === 'function') unsub(); }
    catch (e) { console.error('Firebase operation failed.', _safeErr(e)); }
  });
  realtimeRefs = [];

  const userRef = firebaseDB.collection('users').doc(currentUser.uid);

  try {

    for (const col of SYNC_COLLECTIONS) {
      const handler = _makeSnapshotHandler(col);
      let query = userRef.collection(col.firestoreId);
      const lastSync = await DeltaSync.getLastSyncFirestoreTimestamp(col.firestoreId);
      if (lastSync) query = query.where('updatedAt', '>', lastSync);

      const unsub = query.onSnapshot(async (snapshot) => {
        if (isSyncing) { _enqueueSyncLocked(handler, snapshot); return; }
        await handler(snapshot);
      }, _error => {
        updateSignalUI('error');
        scheduleListenerReconnect();
      });
      realtimeRefs.push(unsub);
    }

    const _handleSettingsSnapshot = async (doc) => {
      try {
        if (!doc.exists || doc.metadata.hasPendingWrites) return;
        if (doc.metadata.fromCache) return;
        trackFirestoreRead(1);
        const cloudSettings = doc.data();
        if (!cloudSettings || typeof cloudSettings !== 'object') return;

        let hasUpdates = false;
        const timestampChecks = [
          { cloud: cloudSettings.naswar_default_settings_timestamp, local: await idb.get('naswar_default_settings_timestamp') },
          { cloud: cloudSettings.repProfile_timestamp,              local: await idb.get('repProfile_timestamp') },
        ];
        for (const check of timestampChecks) {
          if ((check.cloud || 0) > (check.local || 0)) { hasUpdates = true; break; }
        }
        if (!hasUpdates) return;

        if (cloudSettings.naswar_default_settings) {
          const ct = cloudSettings.naswar_default_settings_timestamp || 0;
          const lt = (await idb.get('naswar_default_settings_timestamp')) || 0;
          if (ct > lt) {
            defaultSettings = cloudSettings.naswar_default_settings;
            await idb.setBatch([
              ['naswar_default_settings', defaultSettings],
              ['naswar_default_settings_timestamp', ct],
            ]);
          }
        }
        if (cloudSettings.repProfile) {
          const ct = cloudSettings.repProfile_timestamp || 0;
          const lt = (await idb.get('repProfile_timestamp')) || 0;
          if (ct > lt) {
            currentRepProfile = cloudSettings.repProfile;
            await idb.setBatch([
              ['current_rep_profile', currentRepProfile],
              ['repProfile_timestamp', ct],
            ]);
          }
        }
        if (cloudSettings.last_synced) await idb.set('last_synced', cloudSettings.last_synced);
        emitSyncUpdate({ settings: cloudSettings });
        flashLivePulse();
        recordSuccessfulConnection();
      } catch (error) {
        console.error('Failed to save data locally.', _safeErr(error));
        showToast('Failed to save data locally.', 'error');
      }
    };
    const settingsUnsub = userRef.collection('settings').doc('config').onSnapshot(async (doc) => {
      if (isSyncing) { _enqueueSyncLocked(_handleSettingsSnapshot, doc); return; }
      await _handleSettingsSnapshot(doc);
    }, _e => { updateSignalUI('error'); scheduleListenerReconnect(); });
    realtimeRefs.push(settingsUnsub);

    const _handleFactorySettingsSnapshot = async (doc) => {
      try {
        if (!doc.exists || doc.metadata.hasPendingWrites) return;
        if (doc.metadata.fromCache) return;
        trackFirestoreRead(1);
        const cfs = doc.data();
        if (!cfs || typeof cfs !== 'object') return;

        const checks = [
          { cloud: cfs.default_formulas_timestamp,       local: await idb.get('factory_default_formulas_timestamp') },
          { cloud: cfs.additional_costs_timestamp,       local: await idb.get('factory_additional_costs_timestamp') },
          { cloud: cfs.cost_adjustment_factor_timestamp, local: await idb.get('factory_cost_adjustment_factor_timestamp') },
          { cloud: cfs.sale_prices_timestamp,            local: await idb.get('factory_sale_prices_timestamp') },
          { cloud: cfs.unit_tracking_timestamp,          local: await idb.get('factory_unit_tracking_timestamp') },
        ];
        let hasUpdates = checks.some(c => (c.cloud || 0) > (c.local || 0));
        if (!hasUpdates) return;

        const _applyFactorySetting = async (cloudObj, cloudTs, localTsKey, localKey, localVar, transform) => {
          if (!cloudObj || typeof cloudObj !== 'object') return;
          if (!(('standard' in cloudObj) && ('asaan' in cloudObj))) return;
          const lt = (await idb.get(localTsKey)) || 0;
          if ((cloudTs || 0) > lt) {
            const val = transform(cloudObj);
            await idb.setBatch([[localKey, val], [localTsKey, cloudTs || Date.now()]]);
            return val;
          }
          return null;
        };

        const newFormulas = await _applyFactorySetting(
          cfs.default_formulas, cfs.default_formulas_timestamp,
          'factory_default_formulas_timestamp', 'factory_default_formulas',
          factoryDefaultFormulas,
          o => ({ standard: Array.isArray(o.standard) ? o.standard : [], asaan: Array.isArray(o.asaan) ? o.asaan : [] })
        );
        if (newFormulas) factoryDefaultFormulas = newFormulas;

        const newCosts = await _applyFactorySetting(
          cfs.additional_costs, cfs.additional_costs_timestamp,
          'factory_additional_costs_timestamp', 'factory_additional_costs',
          factoryAdditionalCosts,
          o => ({ standard: parseFloat(o.standard) || 0, asaan: parseFloat(o.asaan) || 0 })
        );
        if (newCosts) factoryAdditionalCosts = newCosts;

        const newFactor = await _applyFactorySetting(
          cfs.cost_adjustment_factor, cfs.cost_adjustment_factor_timestamp,
          'factory_cost_adjustment_factor_timestamp', 'factory_cost_adjustment_factor',
          factoryCostAdjustmentFactor,
          o => ({ standard: parseFloat(o.standard) || 1, asaan: parseFloat(o.asaan) || 1 })
        );
        if (newFactor) factoryCostAdjustmentFactor = newFactor;

        const newPrices = await _applyFactorySetting(
          cfs.sale_prices, cfs.sale_prices_timestamp,
          'factory_sale_prices_timestamp', 'factory_sale_prices',
          factorySalePrices,
          o => ({ standard: parseFloat(o.standard) || 0, asaan: parseFloat(o.asaan) || 0 })
        );
        if (newPrices) factorySalePrices = newPrices;

        const newTracking = await _applyFactorySetting(
          cfs.unit_tracking, cfs.unit_tracking_timestamp,
          'factory_unit_tracking_timestamp', 'factory_unit_tracking',
          factoryUnitTracking,
          o => ({
            standard: o.standard || { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
            asaan:    o.asaan    || { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
          })
        );
        if (newTracking) factoryUnitTracking = newTracking;

        refreshFactorySettingsOverlay();
        emitSyncUpdate({ factorySettings: cfs });
        flashLivePulse();
        recordSuccessfulConnection();
      } catch (error) {
        console.error('Failed to save data locally.', _safeErr(error));
        showToast('Failed to save data locally.', 'error');
      }
    };
    const factorySettingsUnsub = userRef.collection('factorySettings').doc('config').onSnapshot(async (doc) => {
      if (isSyncing) { _enqueueSyncLocked(_handleFactorySettingsSnapshot, doc); return; }
      await _handleFactorySettingsSnapshot(doc);
    }, _e => { updateSignalUI('error'); scheduleListenerReconnect(); });
    realtimeRefs.push(factorySettingsUnsub);

    const _handleExpenseCategoriesSnapshot = async (doc) => {
      try {
        if (!doc.exists || doc.metadata.hasPendingWrites) return;
        if (doc.metadata.fromCache) return;
        trackFirestoreRead(1);
        const cloud = doc.data();
        if (!cloud || !Array.isArray(cloud.categories)) return;
        const local = await idb.get('expense_categories') || [];

        const cloudSorted = [...cloud.categories].sort((a, b) => (a.id || '').localeCompare(b.id || ''));
        const localSorted = [...local].sort((a, b) => (a.id || '').localeCompare(b.id || ''));
        if (JSON.stringify(cloudSorted) !== JSON.stringify(localSorted)) {
          expenseCategories = cloud.categories;
          await idb.set('expense_categories', expenseCategories);
          emitSyncUpdate({ expenseCategories: cloud });
          flashLivePulse();
        }
        recordSuccessfulConnection();
      } catch (error) {
        console.error('Failed to save data locally.', _safeErr(error));
        showToast('Failed to save data locally.', 'error');
      }
    };
    const expenseCategoriesUnsub = userRef.collection('expenseCategories').doc('categories').onSnapshot(async (doc) => {
      if (isSyncing) { _enqueueSyncLocked(_handleExpenseCategoriesSnapshot, doc); return; }
      await _handleExpenseCategoriesSnapshot(doc);
    }, _e => { updateSignalUI('error'); scheduleListenerReconnect(); });
    realtimeRefs.push(expenseCategoriesUnsub);

    function _dedupDeletionRecords(arr) {
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
    window._dedupDeletionRecords = _dedupDeletionRecords;

    const _handleDeletionsSnapshot = async (snapshot) => {
      try {
        if (snapshot.metadata.hasPendingWrites) return;
        if (snapshot.metadata.fromCache) return;
        trackFirestoreRead(snapshot.docChanges().length);
        const changes = snapshot.docChanges();
        if (changes.length === 0) return;
        let hasChanges = false;

        for (const change of changes) {
          try {
            const docData = { id: change.doc.id, ...change.doc.data() };
            if (change.type === 'added' || change.type === 'modified') {
              if (docData.recordId || docData.id) {
                const _rid = docData.recordId || docData.id;
                const _recoveredSet = typeof _recoveredThisSession !== 'undefined' ? _recoveredThisSession : null;
                if (_recoveredSet && (_recoveredSet.has(_rid) || _recoveredSet.has(docData.id))) continue;
                deletedRecordIds.add(_rid);
              }
              const _docSid = String(docData.id || change.doc.id);
              const _docRid = String(docData.recordId || docData.id || change.doc.id);
              const normalizedDoc = {
                ...docData,
                id: _docSid,
                recordId: _docRid,
                syncedToCloud: true,
                deletedAt: docData.deletedAt?.toMillis
                  ? docData.deletedAt.toMillis()
                  : (typeof docData.deletedAt === 'number' ? docData.deletedAt : Date.now()),
              };
              const existingIndex = deletionRecords.findIndex(item =>
                String(item.id) === _docSid || String(item.recordId) === _docSid ||
                String(item.id) === _docRid || String(item.recordId) === _docRid
              );
              if (existingIndex === -1) {
                deletionRecords.push(normalizedDoc);
              } else {
                const existing = deletionRecords[existingIndex];
                deletionRecords[existingIndex] = {
                  ...normalizedDoc,
                  displayName:   normalizedDoc.displayName   || existing.displayName   || null,
                  displayDetail: normalizedDoc.displayDetail || existing.displayDetail || null,
                  displayAmount: normalizedDoc.displayAmount || existing.displayAmount || null,
                  snapshot:      normalizedDoc.snapshot      || existing.snapshot      || null,
                };
              }

              try {
                const rt = docData.recordType;
                const rid = docData.recordId;
                if (rt === 'production' && rid)          { db = db.filter(i => i.id !== rid); await idb.set('mfg_pro_pkr', db); }
                else if ((rt === 'sale' || rt === 'sales') && rid) { customerSales = customerSales.filter(i => i.id !== rid); await idb.set('customer_sales', customerSales); }
                else if ((rt === 'expenses' || rt === 'expense') && rid) { expenseRecords = expenseRecords.filter(i => i.id !== rid); await idb.set('expenses', expenseRecords); }
                else if ((rt === 'transactions' || rt === 'transaction') && rid) { paymentTransactions = paymentTransactions.filter(i => i.id !== rid); await idb.set('payment_transactions', paymentTransactions); }
                else if ((rt === 'rep_sales' || rt === 'rep_sale') && rid) { repSales = repSales.filter(i => i.id !== rid); await idb.set('rep_sales', repSales); }
                else if (rt === 'rep_customers' && rid)  { repCustomers = repCustomers.filter(i => i.id !== rid); await idb.set('rep_customers', repCustomers); }
                else if (rt === 'inventory' && rid)       { factoryInventoryData = factoryInventoryData.filter(i => i.id !== rid); await idb.set('factory_inventory_data', factoryInventoryData); }
                else if (rt === 'factory_history' && rid) { factoryProductionHistory = factoryProductionHistory.filter(i => i.id !== rid); await idb.set('factory_production_history', factoryProductionHistory); }
                else if (rt === 'returns' && rid)         { stockReturns = stockReturns.filter(i => i.id !== rid); await idb.set('stock_returns', stockReturns); }
                else if (rt === 'calculator_history' && rid) { salesHistory = salesHistory.filter(i => i.id !== rid); await idb.set('noman_history', salesHistory); }
                else if (rt === 'entities' && rid)        { paymentEntities = paymentEntities.filter(i => i.id !== rid); await idb.set('payment_entities', paymentEntities); }
              } catch (collectionError) { console.warn('Failed to apply deletion to collection', collectionError); }
              hasChanges = true;

            } else if (change.type === 'removed') {
              const _removedRecordId = change.doc.data()?.recordId || change.doc.id;
              deletionRecords = deletionRecords.filter(item => item.id !== change.doc.id && item.id !== _removedRecordId);
              deletedRecordIds.delete(_removedRecordId);
              deletedRecordIds.delete(change.doc.id);
              try { await idb.set('deleted_records', Array.from(deletedRecordIds)); } catch (_e) {}
              hasChanges = true;
            }
          } catch (docError) { console.warn('Failed to save data locally.', docError); }
        }

        if (hasChanges) {
          deletionRecords = _dedupDeletionRecords(deletionRecords);
          await idb.set('deletion_records', deletionRecords);
          emitSyncUpdate({ deletion_records: deletionRecords });
          flashLivePulse();
          recordSuccessfulConnection();
        }
      } catch (error) {
        console.error('Failed to save data locally.', _safeErr(error));
        showToast('Failed to save data locally.', 'error');
      }
    };
    const deletionsUnsub = userRef.collection('deletions').onSnapshot(async (snapshot) => {
      if (isSyncing) { _enqueueSyncLocked(_handleDeletionsSnapshot, snapshot); return; }
      await _handleDeletionsSnapshot(snapshot);
    }, _e => { updateSignalUI('error'); scheduleListenerReconnect(); });
    realtimeRefs.push(deletionsUnsub);

    const _handleTeamSnapshot = async (doc) => {
      try {
        if (!doc.exists || doc.metadata.hasPendingWrites) return;
        if (!doc.metadata.fromCache) trackFirestoreRead(1);
        const teamData = doc.data();
        if (!teamData || typeof teamData !== 'object') return;
        const cloudTs = teamData.updated_at || 0;
        const localTs = (await idb.get('team_list_timestamp')) || 0;
        if (cloudTs <= localTs) { recordSuccessfulConnection(); return; }
        let changed = false;
        if (Array.isArray(teamData.sales_reps) && teamData.sales_reps.length > 0) {
          const prev = JSON.stringify(salesRepsList);
          salesRepsList = teamData.sales_reps;
          await idb.set('sales_reps_list', salesRepsList);
          if (JSON.stringify(salesRepsList) !== prev) changed = true;
        }
        if (Array.isArray(teamData.user_roles)) {
          const prev2 = JSON.stringify(userRolesList);
          userRolesList = teamData.user_roles;
          await idb.set('user_roles_list', userRolesList);
          if (JSON.stringify(userRolesList) !== prev2) changed = true;
        }
        await idb.set('team_list_timestamp', cloudTs);
        if (changed) {
          if (typeof renderAllRepUI === 'function') renderAllRepUI();
          if (typeof renderUserRoleList === 'function') {
            const list = document.getElementById('manage-userrole-list');
            if (list) renderUserRoleList();
          }
          flashLivePulse();
          showToast('Team list updated from another device', 'info', 3000);
        }
        recordSuccessfulConnection();
      } catch (err) { console.warn('Team list sync error:', err); }
    };
    const teamUnsub = userRef.collection('settings').doc('team').onSnapshot(async (doc) => {
      if (isSyncing) { _enqueueSyncLocked(_handleTeamSnapshot, doc); return; }
      await _handleTeamSnapshot(doc);
    }, _e => { updateSignalUI('error'); scheduleListenerReconnect(); });
    realtimeRefs.push(teamUnsub);

    updateSignalUI('online');
    recordSuccessfulConnection();
    if (typeof registerDevice === 'function') {
      registerDevice().catch(err => { console.warn('Device registration failed:', err); });
    }
  } catch (error) {
    console.error('Device registration failed.', _safeErr(error));
    showToast('Device registration failed.', 'error');
    updateSignalUI('offline');
    scheduleListenerReconnect();
  }
}

async function executeSmartPull() {
  await pullDataFromCloud(true);
  if (pendingSocketUpdate) {
    pendingSocketUpdate = false;
    setTimeout(executeSmartPull, 1000);
  } else {
    showToast('Data synced via Live Socket', 'success');
  }
}
function scheduleSocketReconnect() {
  if (socketReconnectTimer) clearTimeout(socketReconnectTimer);
  socketReconnectTimer = setTimeout(() => { subscribeToRealtime(); }, 5000);
}
function initFirebase() {
  if (window._firebaseListenersRegistered) return;
  window._firebaseListenersRegistered = true;
  try {
    window._fbOfflineHandler = () => { updateSignalUI('offline'); };
    window._fbVisibilityHandler = async () => {
      if (document.visibilityState === 'visible') {
        if (currentUser && database) {
          try { await pullDataFromCloud(true); }
          catch (error) { console.warn('Failed to pull data from cloud.', error); }
        }
      }
    };
    window.addEventListener('offline', window._fbOfflineHandler);
    document.addEventListener('visibilitychange', window._fbVisibilityHandler);
  } catch (e) { console.warn('Failed to pull data from cloud.', e); }
}

function _toMs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'object' && v.seconds) return v.seconds * 1000 + Math.round((v.nanoseconds || 0) / 1e6);
  return new Date(v).getTime() || 0;
}

function mergeDatasets(localArray, cloudArray) {
  if (!Array.isArray(localArray)) localArray = [];
  if (!Array.isArray(cloudArray)) cloudArray = [];
  const mergedMap = new Map();
  cloudArray.forEach(item => {
    if (item && item.id) {
      if (deletedRecordIds.has(item.id)) return;
      mergedMap.set(item.id, item);
    }
  });
  localArray.forEach(localItem => {
    if (!localItem || !localItem.id) return;
    if (deletedRecordIds.has(localItem.id)) return;
    const cloudItem = mergedMap.get(localItem.id);
    if (!cloudItem) { mergedMap.set(localItem.id, localItem); return; }
    const isFinancialRecord = (localItem.totalSold !== undefined || localItem.revenue !== undefined);
    if (isFinancialRecord) {
      const localHasData = (localItem.totalSold > 0 || localItem.revenue > 0);
      const cloudIsCorrupt = (cloudItem.totalSold === undefined || cloudItem.totalSold === null || cloudItem.revenue === null);
      if (localHasData && cloudIsCorrupt) { mergedMap.set(localItem.id, localItem); return; }
    }
    if (localItem.isReturn === true && !cloudItem.isReturn) { mergedMap.set(localItem.id, localItem); return; }
    if ((localItem.formulaUnits > 0 && !cloudItem.formulaUnits) || (localItem.formulaCost > 0 && !cloudItem.formulaCost)) { mergedMap.set(localItem.id, localItem); return; }
    if (localItem.supplierId && !cloudItem.supplierId) { mergedMap.set(localItem.id, localItem); return; }
    if (localItem.paymentStatus === 'paid' && cloudItem.paymentStatus !== 'paid') { mergedMap.set(localItem.id, localItem); return; }
    const localTime = _toMs(localItem.updatedAt || localItem.timestamp) || new Date(localItem.date).getTime() || 0;
    const cloudTime = _toMs(cloudItem.updatedAt || cloudItem.timestamp) || new Date(cloudItem.date).getTime() || 0;
    if (localTime >= cloudTime) mergedMap.set(localItem.id, localItem);
  });
  return Array.from(mergedMap.values());
}

function sanitizeForFirestore(obj, depth = 0, seen = new WeakSet()) {
  if (depth > 20) return null;
  if (obj === null || obj === undefined) return null;
  if (obj instanceof Date) return obj.toISOString();
  if (typeof obj === 'object') {
    if (seen.has(obj)) return '[Circular]';
    seen.add(obj);
  }
  if (typeof obj !== 'object') {
    if (typeof obj === 'number') { if (isNaN(obj) || !isFinite(obj)) return 0; return obj; }
    if (typeof obj === 'string') return obj;
    if (typeof obj === 'boolean') return obj;
    try { return String(obj); } catch (e) { return null; }
  }
  if (Array.isArray(obj)) {
    const sanitizedArray = [];
    for (let i = 0; i < obj.length; i++) {
      const item = obj[i];
      if (typeof item === 'function') continue;
      const sanitized = sanitizeForFirestore(item, depth + 1, seen);
      if (sanitized !== null && sanitized !== undefined) sanitizedArray.push(sanitized);
    }
    return sanitizedArray;
  }
  const sanitized = {};
  try {
    for (const key in obj) {
      if (!obj.hasOwnProperty(key)) continue;
      const value = obj[key];
      if (!key || typeof key !== 'string') continue;
      if (typeof value === 'function') continue;
      let cleanKey = key;
      if (typeof key !== 'string') cleanKey = String(key);
      cleanKey = cleanKey.replace(/[.\$#\[\]\/\\]/g, '_');
      if (!cleanKey) continue;
      if (cleanKey === 'id') {
        sanitized[cleanKey] = (value === null || value === undefined) ? '' : String(value);
        continue;
      }
      if (['amount', 'quantity', 'price', 'cost'].includes(cleanKey)) {
        const num = parseFloat(value);
        sanitized[cleanKey] = (isNaN(num) || !isFinite(num)) ? 0 : num;
        continue;
      }
      if (['timestamp', 'createdAt', 'updatedAt'].includes(cleanKey)) {
        if (value instanceof Date) sanitized[cleanKey] = value.toISOString();
        else if (typeof value === 'string' || typeof value === 'number') sanitized[cleanKey] = value;
        else sanitized[cleanKey] = new Date().toISOString();
        continue;
      }
      const sanitizedValue = sanitizeForFirestore(value, depth + 1, seen);
      if (sanitizedValue !== null && sanitizedValue !== undefined) {
        if (typeof sanitizedValue === 'object' && !Array.isArray(sanitizedValue)) {
          const isFactorySettings = ['default_formulas', 'additional_costs', 'cost_adjustment_factor',
            'sale_prices', 'unit_tracking', 'standard', 'asaan'].includes(cleanKey);
          if (Object.keys(sanitizedValue).length > 0 || isFactorySettings) sanitized[cleanKey] = sanitizedValue;
        } else {
          sanitized[cleanKey] = sanitizedValue;
        }
      } else if (cleanKey === 'gps') {
        sanitized[cleanKey] = null;
      }
    }
  } catch (e) { return {}; }
  return sanitized;
}

async function _commitMergedBatch(userRef, collectionName, mergedRecords, deleteFilter) {
  const OPS_PER_BATCH = 400;
  let batchesTotal = 0, batchesFailed = 0, firstError = null;
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
      ...writeDocs.map(w => ({ type: 'set', ref: w.ref, data: w.data })),
    ];
    for (let i = 0; i < allOps.length; i += OPS_PER_BATCH) {
      batchesTotal++;
      const batch = firebaseDB.batch();
      allOps.slice(i, i + OPS_PER_BATCH).forEach(op => {
        if (op.type === 'delete') batch.delete(op.ref);
        else batch.set(op.ref, op.data);
      });
      try { await batch.commit(); }
      catch (batchErr) {
        batchesFailed++;
        if (!firstError) firstError = batchErr;
        console.error(`_commitMergedBatch [${collectionName}] batch ${batchesTotal} failed:`, _safeErr(batchErr));
        throw batchErr;
      }
    }
  } catch (outerErr) {
    console.error(`_commitMergedBatch [${collectionName}] snapshot read failed:`, _safeErr(outerErr));
    return { ok: false, batchesTotal, batchesFailed: batchesTotal || 1, error: outerErr };
  }
  return { ok: batchesFailed === 0, batchesTotal, batchesFailed, error: firstError || null };
}

function mergeArrays(localArray, cloudArray, collectionName) {
  const merged = [...localArray];

  const idxMap = new Map();
  for (let i = 0; i < merged.length; i++) {
    if (merged[i] && merged[i].id) idxMap.set(String(merged[i].id), i);
  }
  const localIds = new Set(idxMap.keys());
  let downloadedCount = 0, fixedCount = 0, skippedCount = 0;
  const useUUIDGate = typeof UUIDSyncRegistry !== 'undefined' && !!collectionName;

  for (let cloudItem of cloudArray) {
    if (!cloudItem.id || cloudItem.id === '_placeholder_' || cloudItem._placeholder) continue;
    if (!validateUUID(cloudItem.id)) { cloudItem = ensureRecordIntegrity(cloudItem, false, true); fixedCount++; }
    const sid = String(cloudItem.id);

    if (!localIds.has(sid)) {

      if (useUUIDGate && UUIDSyncRegistry.skipDownload(collectionName, sid)) {
        skippedCount++;
        continue;
      }
      cloudItem = ensureRecordIntegrity(cloudItem, false, true);
      merged.push(cloudItem);
      idxMap.set(sid, merged.length - 1);
      localIds.add(sid);
      downloadedCount++;
      if (useUUIDGate) UUIDSyncRegistry.markDownloaded(collectionName, sid);
      else if (collectionName) DeltaSync.markDownloaded(collectionName, sid);
    } else {

      const idx = idxMap.get(sid);
      const localRecord = merged[idx];

      if (useUUIDGate && UUIDSyncRegistry.skipDownload(collectionName, sid)) {

        if (!UUIDSyncRegistry.shouldApplyCloud(cloudItem, localRecord)) {
          skippedCount++;
          continue;
        }

      }

      const cloudWins = (typeof compareRecordVersions === 'function')
        ? compareRecordVersions(cloudItem, localRecord) > 0
        : _toMs(cloudItem.updatedAt || cloudItem.timestamp) > _toMs(localRecord?.updatedAt || localRecord?.timestamp);

      if (cloudWins) {
        merged[idx] = ensureRecordIntegrity(cloudItem, false, true);
        downloadedCount++;
        if (useUUIDGate) UUIDSyncRegistry.markDownloaded(collectionName, sid);
        else if (collectionName) DeltaSync.markDownloaded(collectionName, sid);
      }
    }
  }

  return merged.map(item => {
    if (!item.id || !validateUUID(item.id)) { fixedCount++; return ensureRecordIntegrity(item, false, true); }
    return item;
  });
}

async function _detectUserType(userRef) {
  const hasInitialized = await idb.get('firestore_initialized');
  const idbArrays = await Promise.all([
    idb.get('mfg_pro_pkr', []), idb.get('customer_sales', []), idb.get('rep_sales', []),
    idb.get('noman_history', []), idb.get('payment_transactions', []), idb.get('payment_entities', []),
    idb.get('factory_inventory_data', []), idb.get('factory_production_history', []),
    idb.get('stock_returns', []), idb.get('rep_customers', []), idb.get('expenses', []),
  ]);
  const totalLocal = idbArrays.reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
  if (hasInitialized && totalLocal > 0) return 'returning';

  try {
    const checks = await Promise.all([
      userRef.collection('production').limit(20).get(),
      userRef.collection('sales').limit(20).get(),
      userRef.collection('transactions').limit(20).get(),
      userRef.collection('rep_sales').limit(20).get(),
      userRef.collection('entities').limit(20).get(),
      userRef.collection('inventory').limit(20).get(),
      userRef.collection('expenses').limit(20).get(),
    ]);
    const hasRealData = checks.some(snap => snap.docs.some(doc => !doc.data()._placeholder));
    return hasRealData ? 'existing' : 'new';
  } catch (_e) {
    return hasInitialized ? 'returning' : 'new';
  }
}

async function _downloadDeltas(userRef, userType) {
  const buildQuery = async (collection, collectionName) => {
    if (userType === 'existing') return collection.get();
    const lastSync = await DeltaSync.getLastSyncFirestoreTimestamp(collectionName);
    return lastSync ? collection.where('updatedAt', '>', lastSync).get() : collection.get();
  };

  const [
    settingsSnap, factorySettingsSnap, expenseCategoriesSnap,
    productionSnap, salesSnap, calcHistorySnap,
    repSalesSnap, repCustomersSnap, salesCustomersSnap,
    transactionsSnap, entitiesSnap,
    inventorySnap, factoryHistorySnap,
    expensesSnap, returnsSnap,
  ] = await Promise.all([
    userRef.collection('settings').doc('config').get(),
    userRef.collection('factorySettings').doc('config').get(),
    userRef.collection('expenseCategories').doc('categories').get(),
    buildQuery(userRef.collection('production'), 'production'),
    buildQuery(userRef.collection('sales'), 'sales'),
    buildQuery(userRef.collection('calculator_history'), 'calculator_history'),
    buildQuery(userRef.collection('rep_sales'), 'rep_sales'),
    buildQuery(userRef.collection('rep_customers'), 'rep_customers'),
    buildQuery(userRef.collection('sales_customers'), 'sales_customers'),
    buildQuery(userRef.collection('transactions'), 'transactions'),
    buildQuery(userRef.collection('entities'), 'entities'),
    buildQuery(userRef.collection('inventory'), 'inventory'),
    buildQuery(userRef.collection('factory_history'), 'factory_history'),
    buildQuery(userRef.collection('expenses'), 'expenses'),
    buildQuery(userRef.collection('returns'), 'returns'),
  ]);
  trackFirestoreRead(12 + 3);

  const extract = (snap) => snap
    ? snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(d => !d._placeholder)
    : [];

  return {
    settings: settingsSnap,
    factorySettings: factorySettingsSnap,
    expenseCategories: expenseCategoriesSnap,
    data: {
      mfg_pro_pkr:              extract(productionSnap),
      customer_sales:           extract(salesSnap),
      noman_history:            extract(calcHistorySnap),
      rep_sales:                extract(repSalesSnap),
      rep_customers:            extract(repCustomersSnap),
      sales_customers:          extract(salesCustomersSnap),
      payment_transactions:     extract(transactionsSnap),
      payment_entities:         extract(entitiesSnap),
      factory_inventory_data:   extract(inventorySnap),
      factory_production_history: extract(factoryHistorySnap),
      stock_returns:            extract(returnsSnap),
      expenses:                 extract(expensesSnap),
    },
  };
}

async function _mergeAndPersist(cloudData) {

  try {
    const deletionsSnap = await firebaseDB
      .collection('users').doc(currentUser.uid)
      .collection('deletions').get();
    const threeMonthsAgo = Date.now() - APP_CONFIG.TOMBSTONE_EXPIRY_MS;
    const cloudDels = deletionsSnap.docs
      .filter(d => d.id !== '_placeholder_' && !d.data()._placeholder)
      .map(d => {
        const data = d.data();
        return {
          id: String(d.id), recordId: String(d.id),
          recordType: data.recordType || data.collection || 'unknown',
          collection: data.collection || data.recordType || 'unknown',
          deletedAt: data.deletedAt?.toMillis ? data.deletedAt.toMillis() : (data.deletedAt || Date.now()),
          syncedToCloud: true,
          displayName:   data.displayName   || null,
          displayDetail: data.displayDetail || null,
          displayAmount: data.displayAmount || null,
          snapshot:      data.snapshot      || null,
          deleted_by:    data.deleted_by    || 'user',
        };
      })
      .filter(r => r.deletedAt > threeMonthsAgo);

    let localDels = await idb.get('deletion_records') || [];
    if (!Array.isArray(localDels)) localDels = [];
    const mergedDels = [...localDels];
    cloudDels.forEach(cd => {
      const dupIdx = mergedDels.findIndex(ld =>
        String(ld.id) === String(cd.id) || String(ld.recordId) === String(cd.id)
      );
      if (dupIdx === -1) {
        mergedDels.push(cd);
      } else {
        const local = mergedDels[dupIdx];
        mergedDels[dupIdx] = {
          ...local,
          syncedToCloud: true,
          displayName:   local.displayName   || cd.displayName   || null,
          displayDetail: local.displayDetail || cd.displayDetail || null,
          displayAmount: local.displayAmount || cd.displayAmount || null,
          snapshot:      local.snapshot      || cd.snapshot      || null,
        };
      }
    });
    const _rSet = typeof _recoveredThisSession !== 'undefined' ? _recoveredThisSession : null;
    const safeDels = (_rSet
      ? mergedDels.filter(r => !_rSet.has(String(r.id)) && !_rSet.has(String(r.recordId)))
      : mergedDels
    ).filter(r => r.deletedAt > threeMonthsAgo);
    const deduped = window._dedupDeletionRecords ? window._dedupDeletionRecords(safeDels) : safeDels;
    await idb.set('deletion_records', deduped);
    deletedRecordIds.clear();
    deduped.forEach(r => deletedRecordIds.add(r.id));
    await idb.set('deleted_records', Array.from(deletedRecordIds));
    trackFirestoreRead(deletionsSnap.docs.length);
  } catch (_delErr) {
    console.warn('[Sync] Failed to refresh deletions:', _delErr);
  }

  const { data } = cloudData;
  db                      = mergeArrays(db || [], data.mfg_pro_pkr || [],               'production');
  customerSales           = mergeArrays(customerSales || [], data.customer_sales || [],  'sales');
  salesHistory            = mergeArrays(salesHistory || [], data.noman_history || [],    'calculator_history');
  repSales                = mergeArrays(repSales || [], data.rep_sales || [], 'rep_sales');
  repCustomers            = mergeArrays(repCustomers || [], data.rep_customers || [],    'rep_customers');
  salesCustomers          = mergeArrays(salesCustomers || [], data.sales_customers || [],'sales_customers');
  paymentTransactions     = mergeArrays(paymentTransactions || [], data.payment_transactions || [], 'transactions');
  paymentEntities         = mergeArrays(paymentEntities || [], data.payment_entities || [], 'entities');
  factoryInventoryData    = mergeArrays(factoryInventoryData || [], data.factory_inventory_data || [], 'inventory');
  factoryProductionHistory= mergeArrays(factoryProductionHistory || [], data.factory_production_history || [], 'factory_history');
  stockReturns            = mergeArrays(stockReturns || [], data.stock_returns || [],   'returns');
  expenseRecords          = mergeArrays(expenseRecords || [], data.expenses || [],       'expenses');

  const _mark = (col, arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach(i => {
      if (!i || !i.id) return;
      if (typeof UUIDSyncRegistry !== 'undefined') {
        UUIDSyncRegistry.markDownloaded(col, i.id);
      } else {
        DeltaSync.markDownloaded(col, i.id);
      }
    });
  };
  _mark('production', data.mfg_pro_pkr);       _mark('sales', data.customer_sales);
  _mark('calculator_history', data.noman_history); _mark('rep_sales', data.rep_sales);
  _mark('rep_customers', data.rep_customers);   _mark('sales_customers', data.sales_customers);
  _mark('transactions', data.payment_transactions); _mark('entities', data.payment_entities);
  _mark('inventory', data.factory_inventory_data); _mark('factory_history', data.factory_production_history);
  _mark('returns', data.stock_returns);         _mark('expenses', data.expenses);

  const _notDeleted = item => !deletedRecordIds.has(item.id);
  db = db.filter(_notDeleted); customerSales = customerSales.filter(_notDeleted);
  salesHistory = salesHistory.filter(_notDeleted); repSales = repSales.filter(_notDeleted);
  repCustomers = repCustomers.filter(_notDeleted); salesCustomers = salesCustomers.filter(_notDeleted);
  paymentTransactions = paymentTransactions.filter(_notDeleted);
  paymentEntities = paymentEntities.filter(_notDeleted);
  factoryInventoryData = factoryInventoryData.filter(_notDeleted);
  factoryProductionHistory = factoryProductionHistory.filter(_notDeleted);
  stockReturns = stockReturns.filter(_notDeleted); expenseRecords = expenseRecords.filter(_notDeleted);

  await Promise.all([
    idb.set('mfg_pro_pkr', db), idb.set('customer_sales', customerSales),
    idb.set('noman_history', salesHistory), idb.set('factory_inventory_data', factoryInventoryData),
    idb.set('factory_production_history', factoryProductionHistory),
    idb.set('payment_entities', paymentEntities), idb.set('payment_transactions', paymentTransactions),
    idb.set('expenses', expenseRecords), idb.set('stock_returns', stockReturns),
    idb.set('rep_sales', repSales), idb.set('rep_customers', repCustomers),
    idb.set('sales_customers', salesCustomers),
    idb.set('deleted_records', Array.from(deletedRecordIds)),
    idb.set('last_synced', new Date().toISOString()),
  ]);

  const _colMap = {
    production: data.mfg_pro_pkr, sales: data.customer_sales,
    calculator_history: data.noman_history, transactions: data.payment_transactions,
    entities: data.payment_entities, inventory: data.factory_inventory_data,
    factory_history: data.factory_production_history, returns: data.stock_returns,
    expenses: data.expenses, rep_sales: data.rep_sales,
    rep_customers: data.rep_customers, sales_customers: data.sales_customers,
  };
  for (const [col, arr] of Object.entries(_colMap)) {
    if (Array.isArray(arr) && arr.length > 0) {
      await DeltaSync.setLastSyncTimestamp(col);

    }
  }

  await DeltaSync.setLastSyncTimestamp('deletions');
}

async function _syncSettings(cloudData) {
  const { settings: settingsSnap, factorySettings: factorySettingsSnap, expenseCategories: expCatSnap } = cloudData;

  if (settingsSnap && settingsSnap.exists) {
    const sd = settingsSnap.data();
    if (sd && sd.naswar_default_settings) {
      defaultSettings = sd.naswar_default_settings;
      await idb.set('naswar_default_settings', defaultSettings);
    }
  }
  if (factorySettingsSnap && factorySettingsSnap.exists) {
    const fsData = factorySettingsSnap.data();
    if (fsData && typeof fsData === 'object') {
      const ts = getTimestamp();
      const _applyFs = async (obj, tsKey, dataKey, transform) => {
        if (!obj || typeof obj !== 'object') return;
        if (!(('standard' in obj) && ('asaan' in obj))) return;
        return transform(obj);
      };
      const newFormulas = await _applyFs(fsData.default_formulas, 'factory_default_formulas_timestamp', 'factory_default_formulas',
        o => ({ standard: Array.isArray(o.standard) ? o.standard : [], asaan: Array.isArray(o.asaan) ? o.asaan : [] }));
      if (newFormulas) { factoryDefaultFormulas = newFormulas; await idb.setBatch([['factory_default_formulas', newFormulas], ['factory_default_formulas_timestamp', fsData.default_formulas_timestamp || ts]]); }
      const newCosts = await _applyFs(fsData.additional_costs, null, null, o => ({ standard: parseFloat(o.standard) || 0, asaan: parseFloat(o.asaan) || 0 }));
      if (newCosts) { factoryAdditionalCosts = newCosts; await idb.setBatch([['factory_additional_costs', newCosts], ['factory_additional_costs_timestamp', fsData.additional_costs_timestamp || ts]]); }
      const newFactor = await _applyFs(fsData.cost_adjustment_factor, null, null, o => ({ standard: parseFloat(o.standard) || 1, asaan: parseFloat(o.asaan) || 1 }));
      if (newFactor) { factoryCostAdjustmentFactor = newFactor; await idb.setBatch([['factory_cost_adjustment_factor', newFactor], ['factory_cost_adjustment_factor_timestamp', fsData.cost_adjustment_factor_timestamp || ts]]); }
      const newPrices = await _applyFs(fsData.sale_prices, null, null, o => ({ standard: parseFloat(o.standard) || 0, asaan: parseFloat(o.asaan) || 0 }));
      if (newPrices) { factorySalePrices = newPrices; await idb.setBatch([['factory_sale_prices', newPrices], ['factory_sale_prices_timestamp', fsData.sale_prices_timestamp || ts]]); }
      if (fsData.unit_tracking && ('standard' in fsData.unit_tracking) && ('asaan' in fsData.unit_tracking)) {
        const vt = (d) => ({ produced: parseFloat(d?.produced) || 0, consumed: parseFloat(d?.consumed) || 0, available: parseFloat(d?.available) || 0, unitCostHistory: Array.isArray(d?.unitCostHistory) ? d.unitCostHistory : [] });
        factoryUnitTracking = { standard: vt(fsData.unit_tracking.standard), asaan: vt(fsData.unit_tracking.asaan) };
        await idb.setBatch([['factory_unit_tracking', factoryUnitTracking], ['factory_unit_tracking_timestamp', fsData.unit_tracking_timestamp || ts]]);
      }
      refreshFactorySettingsOverlay();
    }
  }
  if (expCatSnap && expCatSnap.exists) {
    const ecd = expCatSnap.data();
    if (ecd && Array.isArray(ecd.categories)) {
      expenseCategories = ecd.categories;
      await idb.set('expense_categories', expenseCategories);
    }
  }
}

async function _uploadChanges(userRef) {
  const isRealRecord = item => item && item.id && !item._placeholder && item.id !== '_placeholder_';
  const collections = {
    production:          db.filter(isRealRecord),
    sales:               customerSales.filter(isRealRecord),
    rep_sales:           repSales.filter(isRealRecord),
    rep_customers:       repCustomers.filter(isRealRecord),
    sales_customers:     salesCustomers.filter(isRealRecord),
    calculator_history:  salesHistory.filter(isRealRecord),
    inventory:           factoryInventoryData.filter(isRealRecord),
    factory_history:     factoryProductionHistory.filter(isRealRecord),
    entities:            paymentEntities.filter(isRealRecord),
    transactions:        paymentTransactions.filter(isRealRecord),
    expenses:            expenseRecords.filter(isRealRecord),
    returns:             stockReturns.filter(isRealRecord),
  };

  const batches = [];
  let currentBatch = firebaseDB.batch();
  let operationCount = 0;
  const getOrNewBatch = () => {
    if (operationCount >= 450) {
      batches.push(currentBatch);
      currentBatch = firebaseDB.batch();
      operationCount = 0;
    }
    return currentBatch;
  };

  let totalItemsToWrite = 0;
  const collectionsUploaded = new Set();
  for (const [collectionName, dataArray] of Object.entries(collections)) {
    if (!Array.isArray(dataArray) || dataArray.length === 0) continue;
    const changedItems = await DeltaSync.getChangedItems(collectionName, dataArray);
    if (changedItems.length === 0) continue;
    for (const item of changedItems) {
      if (!item || !item.id) continue;

      if (typeof UUIDSyncRegistry !== 'undefined'
            ? UUIDSyncRegistry.skipUpload(collectionName, item.id)
            : DeltaSync.wasUploaded(collectionName, item.id)) continue;
      if (!validateUUID(String(item.id))) {
        console.warn('[uploadChanges] Skipping upload: invalid UUID', item.id);
        continue;
      }
      const docId = String(item.id);
      if (!docId || docId.includes('/')) continue;
      const sanitizedItem = sanitizeForFirestore(item);
      sanitizedItem.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      if (!sanitizedItem || Object.keys(sanitizedItem).length === 0) continue;
      if (sanitizedItem.id && typeof sanitizedItem.id !== 'string') sanitizedItem.id = String(sanitizedItem.id);
      getOrNewBatch().set(userRef.collection(collectionName).doc(docId), sanitizedItem, { merge: true });
      operationCount++;
      totalItemsToWrite++;
      trackFirestoreWrite(1);

      if (typeof UUIDSyncRegistry !== 'undefined') {
        UUIDSyncRegistry.markUploaded(collectionName, item.id);
      } else {
        DeltaSync.markUploaded(collectionName, item.id);
      }
      collectionsUploaded.add(collectionName);
    }
  }

  const configBatch = getOrNewBatch();
  const localFormulaTs = await idb.get('factory_default_formulas_timestamp');
  const localCostsTs   = await idb.get('factory_additional_costs_timestamp');
  const localFactorTs  = await idb.get('factory_cost_adjustment_factor_timestamp');
  const localPricesTs  = await idb.get('factory_sale_prices_timestamp');
  const localUnitTs    = await idb.get('factory_unit_tracking_timestamp');

  const lastFactorySync = await DeltaSync.getLastSyncTimestamp('factorySettings');
  const factorySettingsDirty = [localFormulaTs, localCostsTs, localFactorTs, localPricesTs, localUnitTs]
    .some(ts => ts && (!lastFactorySync || ts > lastFactorySync));
  if (factorySettingsDirty) {
    const fsPayload = {
      default_formulas:                factoryDefaultFormulas        || { standard: [], asaan: [] },
      additional_costs:                factoryAdditionalCosts        || { standard: 0, asaan: 0 },
      sale_prices:                     factorySalePrices             || { standard: 0, asaan: 0 },
      cost_adjustment_factor:          factoryCostAdjustmentFactor   || { standard: 1, asaan: 1 },
      unit_tracking:                   factoryUnitTracking           || {
        standard: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
        asaan:    { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
      },
    };
    configBatch.set(userRef.collection('factorySettings').doc('config'), sanitizeForFirestore(fsPayload), { merge: true });
    operationCount++;
    collectionsUploaded.add('factorySettings');
  }

  const localSettingsTs = await idb.get('naswar_default_settings_timestamp');
  const lastSettingsSync = await DeltaSync.getLastSyncTimestamp('settings');
  if (localSettingsTs && (!lastSettingsSync || localSettingsTs > lastSettingsSync)) {
    configBatch.set(
      userRef.collection('settings').doc('config'),
      sanitizeForFirestore({ naswar_default_settings: defaultSettings || {} }),
      { merge: true }
    );
    operationCount++;
    collectionsUploaded.add('settings');
  }

  const localExpCatTs = await idb.get('expense_categories_timestamp');
  const lastExpCatSync = await DeltaSync.getLastSyncTimestamp('expenseCategories');
  if (localExpCatTs && (!lastExpCatSync || localExpCatTs > lastExpCatSync)) {
    configBatch.set(
      userRef.collection('expenseCategories').doc('categories'),
      sanitizeForFirestore({ categories: expenseCategories || [] }),
      { merge: true }
    );
    operationCount++;
    collectionsUploaded.add('expenseCategories');
  }

  batches.push(currentBatch);
  for (const batch of batches) {
    await batch.commit();
  }

  for (const col of collectionsUploaded) {
    await DeltaSync.setLastSyncTimestamp(col);
    DeltaSync.clearDirty(col);
  }

  return totalItemsToWrite;
}

function performOneClickSync(silent = false) {
  return _syncQueue.run(() => _doOneClickSync(silent));
}

async function _doOneClickSync(silent = false) {
  if (!firebaseDB) {
    if (!silent) { showToast(' Connecting to Cloud... Please wait.', 'info'); initializeFirebaseSystem(); }
    return;
  }
  if (!currentUser) {
    if (!silent) {
      showToast('Please log in to sync data', 'warning');

      showAuthOverlay();
    }
    return;
  }

  isSyncing = true;
  const btn = document.getElementById('sync-btn');
  const originalText = btn ? btn.innerHTML : '';
  if (!silent && btn) btn.innerHTML = 'Syncing...';
  if (!silent) showToast('Syncing....', 'info');

  try {
    const userRef = firebaseDB.collection('users').doc(currentUser.uid);

    const userType = await _detectUserType(userRef);

    if (userType === 'new') {
      await initializeFirestoreStructure(true);
      await idb.set('firestore_initialized', true);
      if (!silent) showToast('Your account is ready!', 'success');
      return;
    }

    const cloudData = await _downloadDeltas(userRef, userType);
    const totalCloudChanges = Object.values(cloudData.data).reduce((s, a) => s + (a?.length || 0), 0);

    if (totalCloudChanges > 0) {
      await _mergeAndPersist(cloudData);
    }

    await _syncSettings(cloudData);

    if (userType === 'existing') {
      await idb.set('firestore_initialized', true);
      await idb.set('user_state', { type: 'existing', hasRealData: true, lastChecked: Date.now(), initialized: true, restoredItems: totalCloudChanges });

      const totalItemsToWrite = await _uploadChanges(userRef);

      setTimeout(() => { if (typeof refreshAllDisplays === 'function') refreshAllDisplays(); }, 100);
      if (!silent) {
        const msg = totalItemsToWrite > 0
          ? `Restored ${totalCloudChanges} records, uploaded ${totalItemsToWrite} local changes`
          : `Data fully restored — ${totalCloudChanges} records downloaded`;
        showToast(msg, 'success');
        if (typeof closeDataMenu === 'function') closeDataMenu();
      }
      setTimeout(async () => {
        try { if (typeof validateAllDataOnStartup === 'function') await validateAllDataOnStartup(); }
        catch (e) { console.error('Data validation error:', _safeErr(e)); }
      }, 2000);
      return;
    }

    const totalItemsToWrite = await _uploadChanges(userRef);

    setTimeout(() => { if (typeof refreshAllDisplays === 'function') refreshAllDisplays(); }, 100);

    if (!silent) {
      if (totalCloudChanges === 0 && totalItemsToWrite === 0) {
        showToast(' Already synced - no changes needed', 'success');
      } else if (totalCloudChanges === 0) {
        showToast(`Uploaded ${totalItemsToWrite} local changes`, 'success');
      } else if (totalItemsToWrite === 0) {
        showToast(`Downloaded ${totalCloudChanges} cloud changes`, 'success');
      } else {
        showToast(`Synced ${totalCloudChanges} down, ${totalItemsToWrite} up`, 'success');
      }
      if (typeof closeDataMenu === 'function') closeDataMenu();
    }

    setTimeout(async () => {
      try { if (typeof validateAllDataOnStartup === 'function') await validateAllDataOnStartup(); }
      catch (e) { console.error('Data validation error:', _safeErr(e)); }
    }, 2000);

  } catch (e) {
    console.error('[OneClickSync] error:', _safeErr(e));
    if (!silent) showToast(' Sync error - will retry automatically', 'warning');
  } finally {
    isSyncing = false;
    if (!silent && btn) btn.innerHTML = originalText;
    _flushSyncLockQueue().catch(err => console.warn('[SyncLock] Flush error', err));
  }
}

function pushDataToCloud(silent = false) {
  return _syncQueue.run(() => _doPushDataToCloud(silent));
}

async function _doPushDataToCloud(silent = false) {
  if (!firebaseDB || !currentUser) {
    if (!silent) showToast('Please sign in to sync data', 'warning');
    return;
  }

  isSyncing = true;
  let btn = null, originalText = '';
  const pushTimeout = setTimeout(() => {
    isSyncing = false;
    _flushSyncLockQueue().catch(() => {});
    if (!silent) {
      showToast(' Upload timeout - Please try again', 'warning');
      if (btn) { btn.innerText = originalText; btn.disabled = false; }
    }
  }, APP_CONFIG.HEARTBEAT_INTERVAL_MS);

  try {
    if (!silent) {
      const menuBtn = document.querySelector('#dataMenuOverlay .btn-main');
      if (menuBtn) { btn = menuBtn; originalText = btn.innerText; btn.textContent = ' Uploading...'; btn.disabled = true; }
      else showToast(' Starting upload...', 'info');
    }

    await idb.init();

    const dataKeys = [
      'mfg_pro_pkr','customer_sales','rep_sales','rep_customers','noman_history',
      'factory_inventory_data','factory_production_history','payment_entities',
      'payment_transactions','stock_returns','expenses','sales_customers',
      'factory_default_formulas','factory_additional_costs','factory_cost_adjustment_factor',
      'factory_sale_prices','factory_unit_tracking','naswar_default_settings','deleted_records',
    ];
    const freshDataMap = idb.getBatch ? await idb.getBatch(dataKeys) : await (async () => {
      const m = new Map();
      for (const k of dataKeys) { const v = await idb.get(k); if (v !== null) m.set(k, v); }
      return m;
    })();

    if (freshDataMap.get('mfg_pro_pkr'))               db                      = freshDataMap.get('mfg_pro_pkr');
    if (freshDataMap.get('customer_sales'))             customerSales           = freshDataMap.get('customer_sales');
    if (freshDataMap.get('rep_sales'))                  repSales                = freshDataMap.get('rep_sales');
    if (freshDataMap.get('rep_customers'))              repCustomers            = freshDataMap.get('rep_customers');
    if (freshDataMap.get('noman_history'))              salesHistory            = freshDataMap.get('noman_history');
    if (freshDataMap.get('factory_inventory_data'))     factoryInventoryData    = freshDataMap.get('factory_inventory_data');
    if (freshDataMap.get('factory_production_history')) factoryProductionHistory= freshDataMap.get('factory_production_history');
    if (freshDataMap.get('payment_entities'))           paymentEntities         = freshDataMap.get('payment_entities');
    if (freshDataMap.get('payment_transactions'))       paymentTransactions     = freshDataMap.get('payment_transactions');
    if (freshDataMap.get('stock_returns'))              stockReturns            = freshDataMap.get('stock_returns');
    if (freshDataMap.get('expenses'))                   expenseRecords          = freshDataMap.get('expenses');
    if (freshDataMap.get('sales_customers'))            salesCustomers          = freshDataMap.get('sales_customers');
    if (freshDataMap.get('factory_default_formulas'))   factoryDefaultFormulas  = freshDataMap.get('factory_default_formulas');
    if (freshDataMap.get('factory_additional_costs'))   factoryAdditionalCosts  = freshDataMap.get('factory_additional_costs');
    if (freshDataMap.get('factory_cost_adjustment_factor')) factoryCostAdjustmentFactor = freshDataMap.get('factory_cost_adjustment_factor');
    if (freshDataMap.get('factory_sale_prices'))        factorySalePrices       = freshDataMap.get('factory_sale_prices');
    if (freshDataMap.get('factory_unit_tracking'))      factoryUnitTracking     = freshDataMap.get('factory_unit_tracking');
    if (freshDataMap.get('naswar_default_settings'))    defaultSettings         = freshDataMap.get('naswar_default_settings');
    if (freshDataMap.get('deleted_records'))            deletedRecordIds        = new Set(freshDataMap.get('deleted_records'));

    const userRef = firebaseDB.collection('users').doc(currentUser.uid);
    const operationCount = await _uploadChanges(userRef);

    const deletionRecordsLocal = await idb.get('deletion_records', []);
    const unsyncedDeletions = deletionRecordsLocal.filter(r => !r.syncedToCloud);
    if (unsyncedDeletions.length > 0) {
      const dBatch = firebaseDB.batch();
      let dOps = 0;
      for (const dr of unsyncedDeletions) {
        if (!dr.id) continue;
        const deletedAtMs = typeof dr.deletedAt === 'number' && dr.deletedAt > 0 ? dr.deletedAt : Date.now();
        const deletionsRef = userRef.collection('deletions').doc(String(dr.id));
        dBatch.set(deletionsRef, {
          id: String(dr.id),
          deletedAt: firebase.firestore.Timestamp.fromMillis(deletedAtMs),
          collection: dr.collection || 'unknown',
          expiresAt: firebase.firestore.Timestamp.fromMillis(deletedAtMs + APP_CONFIG.TOMBSTONE_EXPIRY_MS),
        });
        dOps++;
        if (dr.collection && dr.collection !== 'unknown') {
          dBatch.delete(userRef.collection(dr.collection).doc(String(dr.id)));
          dOps++;
        }
        dr.syncedToCloud = true;
        if (dOps >= 450) break;
      }
      await dBatch.commit();
      await idb.set('deletion_records', deletionRecordsLocal);
    }

    const now = new Date().toISOString();
    await idb.set('last_synced', now);

    if (!silent) {
      const message = operationCount === 0
        ? ' Already synced - no changes to upload'
        : ` Cloud Backup Complete - ${operationCount} items uploaded`;
      showToast(message, 'success');
      const display = document.getElementById('lastSyncDisplay');
      if (display) display.textContent = `Last Cloud Sync: ${new Date(now).toLocaleString()}`;
    }
  } catch (error) {
    console.error('[pushDataToCloud] error:', _safeErr(error));
    if (!silent) showToast(` Backup failed: ${error.message}`, 'error');
  } finally {
    clearTimeout(pushTimeout);
    isSyncing = false;
    if (btn) { btn.innerText = originalText || 'Backup to Cloud'; btn.disabled = false; }
    _flushSyncLockQueue().catch(() => {});
  }
}

function pullDataFromCloud(silent = false, forceDownload = false) {
  return _syncQueue.run(() => _doPullDataFromCloud(silent, forceDownload));
}

async function _doPullDataFromCloud(silent = false, forceDownload = false) {
  if (!firebaseDB || !currentUser) {
    if (!silent) showToast('Please sign in to sync data', 'warning');
    return;
  }

  isSyncing = true;
  try {
    if (!silent) showToast('Downloading cloud data...', 'info');
    await idb.init();

    const userRef = firebaseDB.collection('users').doc(currentUser.uid);
    const cloudData = await _downloadDeltas(userRef, 'returning');

    const hasData = Object.values(cloudData.data).some(a => a.length > 0)
      || (cloudData.settings && cloudData.settings.exists)
      || (cloudData.factorySettings && cloudData.factorySettings.exists);
    if (!hasData) {
      if (!silent) showToast('Cloud is empty. Nothing to download.', 'info');
      return;
    }

    await _mergeAndPersist(cloudData);
    await _syncSettings(cloudData);

    if (forceDownload && cloudData.factorySettings && cloudData.factorySettings.exists) {
      const fsData = cloudData.factorySettings.data();
      if (fsData && typeof fsData === 'object') {
        if (fsData.unit_tracking && ('standard' in fsData.unit_tracking) && ('asaan' in fsData.unit_tracking)) {
          const vt = (d) => ({ produced: parseFloat(d?.produced) || 0, consumed: parseFloat(d?.consumed) || 0, available: parseFloat(d?.available) || 0, unitCostHistory: Array.isArray(d?.unitCostHistory) ? d.unitCostHistory : [] });
          factoryUnitTracking = { standard: vt(fsData.unit_tracking.standard), asaan: vt(fsData.unit_tracking.asaan) };
          await idb.setBatch([['factory_unit_tracking', factoryUnitTracking], ['factory_unit_tracking_timestamp', fsData.unit_tracking_timestamp || Date.now()]]);
          refreshFactorySettingsOverlay();
        }
      }
    }

    if (!factoryDefaultFormulas || !('standard' in factoryDefaultFormulas)) factoryDefaultFormulas = { standard: [], asaan: [] };
    if (!factoryAdditionalCosts || !('standard' in factoryAdditionalCosts)) factoryAdditionalCosts = { standard: 0, asaan: 0 };
    if (!factoryCostAdjustmentFactor || !('standard' in factoryCostAdjustmentFactor)) factoryCostAdjustmentFactor = { standard: 1, asaan: 1 };
    if (!factorySalePrices || !('standard' in factorySalePrices)) factorySalePrices = { standard: 0, asaan: 0 };
    if (!factoryUnitTracking || !('standard' in factoryUnitTracking)) factoryUnitTracking = { standard: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] }, asaan: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] } };

    await Promise.all([
      idb.set('factory_default_formulas', factoryDefaultFormulas),
      idb.set('factory_additional_costs', factoryAdditionalCosts),
      idb.set('factory_cost_adjustment_factor', factoryCostAdjustmentFactor),
      idb.set('factory_sale_prices', factorySalePrices),
      idb.set('factory_unit_tracking', factoryUnitTracking),
      idb.set('naswar_default_settings', defaultSettings),
      idb.set('appMode', appMode),
      idb.set('current_rep_profile', currentRepProfile),
    ]);

    const statsCols = ['production','sales','rep_sales','rep_customers','calculator_history',
      'transactions','entities','inventory','factory_history','returns','expenses','sales_customers'];
    Promise.all(statsCols.map(c => DeltaSync.updateSyncStats(c))).catch(() => {});

    if (!silent) showToast(' Data Restored Successfully', 'success');
    if (typeof updateUnitsAvailableIndicator === 'function') updateUnitsAvailableIndicator();
    await refreshAllDisplays();
  } catch (error) {
    console.error('[pullDataFromCloud] error:', _safeErr(error));
    if (!silent) showToast('Restore failed. Using local data.', 'error');
  } finally {
    isSyncing = false;
    _flushSyncLockQueue().catch(() => {});
  }
}

function showSyncHealthPanel() {
  verifyDeltaSyncSystem().then(results => {
    const lastSync = localStorage.getItem('lastSync') || 'Unknown';
    const pending = results.issues.length;
    const ok = results.valid.length;

    const existing = document.getElementById('sync-health-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'sync-health-panel';
    panel.setAttribute('role', 'dialog');
    panel.style.cssText = `
      position:fixed;bottom:20px;right:20px;z-index:9999;
      background:var(--glass-bg,#1e293b);border:1px solid var(--glass-border,#334155);
      border-radius:16px;padding:20px 24px;min-width:280px;max-width:360px;
      box-shadow:0 8px 32px rgba(0,0,0,.4);color:var(--text-main,#f1f5f9);font-size:.85rem;
    `;
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <strong style="font-size:.95rem">Sync Health</strong>
        <button onclick="document.getElementById('sync-health-panel').remove()"
          style="background:none;border:none;color:var(--text-muted,#94a3b8);cursor:pointer;font-size:1.1rem">✕</button>
      </div>
      <div style="margin-bottom:8px">
        <span style="color:#10b981">✔ ${ok} collections OK</span>
        ${pending ? `&nbsp;·&nbsp;<span style="color:#f59e0b">⚠ ${pending} issues</span>` : ''}
      </div>
      ${results.issues.map(s => `
        <div style="padding:6px 10px;margin-top:4px;background:rgba(245,158,11,.1);border-radius:8px;font-size:.78rem">
          <strong>${s.collection}</strong> — never synced · ${s.localRecords} local records
          ${s.hasPendingChanges ? ' · <span style="color:#f87171">pending changes</span>' : ''}
        </div>`).join('')}
      <div style="margin-top:10px;color:var(--text-muted,#94a3b8);font-size:.75rem">
        Last sync: ${results.valid[0]?.lastSync || 'Never'}
      </div>
      <button onclick="performOneClickSync();document.getElementById('sync-health-panel').remove()"
        style="margin-top:12px;width:100%;padding:8px;border:none;border-radius:10px;
               background:#2563eb;color:#fff;font-weight:700;cursor:pointer;font-size:.85rem">
        Sync Now
      </button>
    `;
    document.body.appendChild(panel);
  }).catch(e => console.warn('[SyncHealth]', e));
}
window.showSyncHealthPanel = showSyncHealthPanel;
let seamlessBackupTimer = null;
const SEAMLESS_DELAY_MS = 5000;
function triggerSeamlessBackup() {
if (seamlessBackupTimer) {
clearTimeout(seamlessBackupTimer);
}
seamlessBackupTimer = setTimeout(async () => {
if (currentUser && firebaseDB) {
await pushDataToCloud(true);
}
}, SEAMLESS_DELAY_MS);
}
function stopDatabaseHeartbeat() {
if (window.deviceHeartbeatInterval) {
clearInterval(window.deviceHeartbeatInterval);
window.deviceHeartbeatInterval = null;
}
}
const AUTO_BACKUP_INTERVAL = 180000;

function scheduleAutoBackup() {
clearAutoBackup();
if (!currentUser) return;
autoSaveTimer = setInterval(async () => {
if (!currentUser) { clearAutoBackup(); return; }
try {
const cols = ['production','sales','rep_sales','transactions','expenses','returns','calculator_history'];
const hasChanges = await DeltaSync.hasAnyChanges(cols);
if (!hasChanges) return;
await performOneClickSync(true);
} catch (e) { console.warn('[AutoBackup]', e); }
}, AUTO_BACKUP_INTERVAL);
}
function clearAutoBackup() {
if (autoSaveTimer) {
clearInterval(autoSaveTimer);
autoSaveTimer = null;
}
}
async function wakeUpDatabase() {
if (!firebaseDB || !currentUser) return false;
try {
const wakeUpPromise = firebaseDB.collection('users').doc(currentUser.uid)
.collection('settings').doc('config').get();
const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 45000));
await Promise.race([wakeUpPromise, timeoutPromise]);
dbWakeUpAttempted = true;
return true;
} catch (error) {
return false;
}
}
async function wakeUpDatabaseAndSync() {
showToast('Connecting to cloud...', 'info');
const awake = await wakeUpDatabase();
if (awake) {
await pullDataFromCloud(true);
} else {
setTimeout(async () => {
const retryAwake = await wakeUpDatabase();
if (retryAwake) await pullDataFromCloud(true);
}, 5000);
}
}
async function triggerCloudAction(action) {
if (!firebaseDB) {
showToast("Cloud system not initialized. Check internet.", "error");
return;
}
if (isSyncing) {
isSyncing = false;
}
if (!currentUser) {
closeDataMenu();
showToast("Please sign in to access Cloud functions.", "info");
showAuthOverlay();
return;
}
if (action === 'backup') {
await pushDataToCloud(false);
}
if (action === 'restore') {
const _ufc_localCount = Object.keys(localStorage).filter(k => k.startsWith('gznd_')).length;
const _ufc_msg = `Merge the latest cloud data into this device?\n\n• Your local records will be compared with cloud records\n• Newer versions of each record always win\n• No local data will be overwritten or deleted\n• This device only — other devices are unaffected\n\nRecommended if another device has recently added records.`;
if (await showGlassConfirm(_ufc_msg, { title: "Sync from Cloud", confirmText: "Update from Cloud", cancelText: "Cancel" })) {
closeDataMenu();
showToast("Starting Update...", "info");
await pullDataFromCloud(false);
}
}
}
async function checkAuthState() {
scheduleAutoBackup();
}
function createAuthOverlay() {
const existing = document.getElementById('auth-overlay');
if (existing) existing.remove();
const overlay = document.createElement('div');
overlay.id = 'auth-overlay';
overlay.style.cssText = `
position: fixed; inset: 0;
background: linear-gradient(135deg, rgba(240, 248, 255, 0.95) 0%, rgba(230, 240, 255, 0.95) 100%);
z-index: 99999; display: flex; align-items: center; justify-content: center;
`;
if (document.body.classList.contains('dark-mode')) {
overlay.style.background = 'linear-gradient(135deg, rgba(15, 23, 42, 0.98) 0%, rgba(30, 41, 59, 0.98) 100%)';
}
overlay.innerHTML = `
<div class="liquid-card" style="max-width: 400px; width: 90%; padding: 40px 30px; text-align: center; border: 1px solid var(--glass-border); box-shadow: 0 20px 50px rgba(37, 99, 235, 0.15); position: relative;">
<h2 class="shimmer-text" style="font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-size: 2rem; margin: 0 0 6px 0; letter-spacing: -0.03em; font-weight: 800;">
GULL AND ZUBAIR NASWAR DEALER'S
</h2>
<div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:20px;">
<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1de9b6" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
<span style="font-size:0.7rem;color:var(--accent);font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Login Required</span>
</div>
<p style="color: var(--text-muted); margin-bottom: 26px; font-size: 0.82rem; line-height: 1.5;">
Your account protects your data with enterprise-grade encryption.<br><strong style="color:var(--text-main)"></strong>.
</p>
<form id="auth-form" style="display: flex; flex-direction: column; gap: 13px;">
<input type="email" id="auth-email" placeholder="Email Address" required autocomplete="username"
style="width: 100%; padding: 13px; background: var(--input-bg); border: 1px solid var(--glass-border); border-radius: 12px; box-sizing: border-box; color: var(--text-main); font-size:0.9rem;">
<input type="password" id="auth-password" placeholder="Password" required autocomplete="current-password"
style="width: 100%; padding: 13px; background: var(--input-bg); border: 1px solid var(--glass-border); border-radius: 12px; box-sizing: border-box; color: var(--text-main); font-size:0.9rem;">
<div style="display: flex; gap: 10px; margin-top: 8px;">
<button type="submit" class="btn btn-main" style="
flex: 1; padding: 13px; font-size: 1rem; border-radius: 12px;
background-color: #1de9b6 !important;
background-image: none !important;
color: #003d2e !important;
font-weight:700;
">
Sign In
</button>
<button type="button" id="auth-signup-btn" class="btn" style="flex: 1; padding: 13px; font-size: 1rem; border-radius: 12px; background: var(--input-bg); border: 1px solid var(--glass-border); color: var(--text-main);">
Sign Up
</button>
</div>
</form>
<div id="auth-message" style="font-size: 0.8rem; margin-top: 15px; min-height: 20px;"></div>
<div style="margin-top:18px;padding:10px 14px;background:var(--input-bg);border-radius:10px;border:1px solid var(--glass-border);">
<div style="font-size:0.65rem;color:var(--text-muted);line-height:1.6;">
<strong style="color:var(--text-main)">AES-256-GCM</strong> encrypted backups &nbsp;·&nbsp;
<strong style="color:var(--text-main)"></strong> &nbsp;·&nbsp;
<strong style="color:var(--text-main)"></strong>
</div>
</div>
</div>
`;
document.body.appendChild(overlay);
const form = document.getElementById('auth-form');
if(form) form.addEventListener('submit', handleSignIn);
const signupBtn = document.getElementById('auth-signup-btn');
if(signupBtn) signupBtn.addEventListener('click', (e) => {
e.preventDefault();
handleSignUp();
});
OfflineAuth.getSavedEmail().then(email => {
if (email) {
const emailInput = document.getElementById('auth-email');
if (emailInput) { emailInput.value = email; }
}
}).catch(() => {});
}
function showAuthOverlay() {
let overlay = document.getElementById('auth-overlay');
if (!overlay) {
createAuthOverlay();
} else {
overlay.style.display = 'flex';
}
document.body.style.overflow = 'hidden';
}
function hideAuthOverlay() {
if (!currentUser) return;
const overlay = document.getElementById('auth-overlay');
if (overlay) {
overlay.style.display = 'none';
}
document.body.style.overflow = '';
}
const LoginRateLimiter = (() => {
const KEY_ATTEMPTS = '_gznd_login_attempts';
const KEY_LOCKOUT  = '_gznd_login_lockout';
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000;
const BACKOFF_BASE = 1000;
function getAttempts() {
try { return parseInt(sessionStorage.getItem(KEY_ATTEMPTS) || '0', 10); } catch(e) { return 0; }
}
function setAttempts(n) {
try { sessionStorage.setItem(KEY_ATTEMPTS, String(n)); } catch(e) {}
}
function getLockoutUntil() {
try { return parseInt(sessionStorage.getItem(KEY_LOCKOUT) || '0', 10); } catch(e) { return 0; }
}
function setLockoutUntil(ts) {
try { sessionStorage.setItem(KEY_LOCKOUT, String(ts)); } catch(e) {}
}
return {
isLockedOut() {
const until = getLockoutUntil();
return until > Date.now();
},
lockoutRemainingMs() {
return Math.max(0, getLockoutUntil() - Date.now());
},
attempts() { return getAttempts(); },
backoffMs() {
const n = getAttempts();
return n > 0 ? Math.min(BACKOFF_BASE * Math.pow(2, n - 1), 8000) : 0;
},
recordFailure() {
const n = getAttempts() + 1;
setAttempts(n);
if (n >= MAX_ATTEMPTS) { setLockoutUntil(Date.now() + LOCKOUT_DURATION); }
},
recordSuccess() {
try { sessionStorage.removeItem(KEY_ATTEMPTS); sessionStorage.removeItem(KEY_LOCKOUT); } catch(e) {}
},
};
})();
async function handleSignIn(e) {
if(e) e.preventDefault();
const emailInput = document.getElementById('auth-email');
const passwordInput = document.getElementById('auth-password');
const messageDiv = document.getElementById('auth-message');
if (!emailInput || !passwordInput || !messageDiv) return;
const email = emailInput.value.trim();
const password = passwordInput.value;
if (!email || !password) {
messageDiv.textContent = 'Please enter both email and password';
messageDiv.style.color = 'var(--warning)';
return;
}
if (LoginRateLimiter.isLockedOut()) {
const remainSec = Math.ceil(LoginRateLimiter.lockoutRemainingMs() / 1000);
const mins = Math.floor(remainSec / 60);
const secs = String(remainSec % 60).padStart(2,'0');
messageDiv.textContent = `Too many failed attempts. Try again in ${mins}m ${secs}s.`;
messageDiv.style.color = 'var(--danger)';
return;
}
const _loginBackoff = LoginRateLimiter.backoffMs();
if (_loginBackoff > 0) {
const _submitBtn = document.querySelector('#auth-form button[type="submit"]');
if (_submitBtn) _submitBtn.disabled = true;
messageDiv.textContent = `Too many attempts — waiting ${Math.round(_loginBackoff/1000)}s…`;
messageDiv.style.color = 'var(--warning)';
await new Promise(r => setTimeout(r, _loginBackoff));
if (_submitBtn) _submitBtn.disabled = false;
if (LoginRateLimiter.isLockedOut()) {
const remainSec2 = Math.ceil(LoginRateLimiter.lockoutRemainingMs() / 1000);
const mins2 = Math.floor(remainSec2 / 60);
const secs2 = String(remainSec2 % 60).padStart(2,'0');
messageDiv.textContent = `Too many failed attempts. Try again in ${mins2}m ${secs2}s.`;
messageDiv.style.color = 'var(--danger)';
return;
}
}
messageDiv.textContent = 'Verifying credentials...';
messageDiv.style.color = 'var(--accent)';
if (typeof firebase !== 'undefined' && !firebase.apps.length) {
try { firebase.initializeApp(firebaseConfig); } catch(initErr) { console.warn('Firebase init on sign-in:', initErr); }
}
if (!auth && typeof firebase !== 'undefined' && firebase.apps.length) {
try {
auth = firebase.auth();
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
} catch(authInitErr) { console.warn('Auth init on sign-in:', authInitErr); }
}
try {
if (typeof firebase !== 'undefined' && firebase.apps.length && navigator.onLine) {
const firebaseAuth = auth || firebase.auth();
const _signInCred = await firebaseAuth.signInWithEmailAndPassword(email, password);
await OfflineAuth.saveCredentials(email, password);
idb.setUserPrefix(_signInCred.user.uid);
await IDBCrypto.setSessionKey(email, password);
await IDBCrypto.sessionSet('login', {
  uid: _signInCred.user.uid,
  email,
  displayName: _signInCred.user.displayName || '',
  lastLogin: new Date().toISOString()
});
try { localStorage.setItem('_gznd_session_active', '1'); sessionStorage.setItem('_gznd_session_active', '1'); } catch(e) {}
LoginRateLimiter.recordSuccess();
messageDiv.textContent = 'Success! Loading...';
messageDiv.style.color = 'var(--accent-emerald)';
try {
  if (typeof loadAllData === 'function') await loadAllData();
} catch(e) { console.warn('Post-login data reload failed:', e); }
setTimeout(() => {
hideAuthOverlay();
if (typeof refreshAllDisplays === 'function') refreshAllDisplays();
if(typeof performOneClickSync === 'function') performOneClickSync();
}, 300);
} else {
const hasStored = await OfflineAuth.hasStoredCredentials();
if (!hasStored) {
messageDiv.textContent = 'No offline account found. Please connect to internet for first-time login.';
messageDiv.style.color = 'var(--danger)';
return;
}
const valid = await OfflineAuth.verifyCredentials(email, password);
if (!valid) {
messageDiv.textContent = 'Incorrect email or password.';
messageDiv.style.color = 'var(--danger)';
return;
}
currentUser = {
id: email.replace(/[^a-zA-Z0-9]/g, '_'),
uid: email.replace(/[^a-zA-Z0-9]/g, '_'),
email: email,
offlineMode: true
};
idb.setUserPrefix(currentUser.uid);
await IDBCrypto.setSessionKey(email, password);
try { localStorage.setItem('_gznd_session_active', '1'); sessionStorage.setItem('_gznd_session_active', '1'); } catch(e) {}
LoginRateLimiter.recordSuccess();
messageDiv.textContent = '✓ Offline Login Successful';
messageDiv.style.color = 'var(--accent-emerald)';
try {
  if (typeof loadAllData === 'function') await loadAllData();
} catch(e) { console.warn('Post-offline-login data reload failed:', e); }
setTimeout(() => {
if (currentUser) {
const overlay = document.getElementById('auth-overlay');
if (overlay) { overlay.style.display = 'none'; }
document.body.style.overflow = '';
if (typeof refreshAllDisplays === 'function') refreshAllDisplays();
}
}, 300);
}
} catch (error) {
console.error('Sign in failed.', _safeErr(error));
let errorMessage = 'Sign in failed. ';
if (error.code === 'auth/invalid-email') errorMessage = 'Invalid email address.';
else if (error.code === 'auth/user-disabled') errorMessage = 'Account disabled.';
else if (error.code === 'auth/user-not-found') errorMessage = 'No account found.';
else if (error.code === 'auth/wrong-password') errorMessage = 'Incorrect password.';
else if (error.code === 'auth/network-request-failed') {
const valid = await OfflineAuth.verifyCredentials(email, password).catch(() => false);
if (valid) {
currentUser = { id: email.replace(/[^a-zA-Z0-9]/g, '_'), uid: email.replace(/[^a-zA-Z0-9]/g, '_'), email, offlineMode: true };
idb.setUserPrefix(currentUser.uid);
await IDBCrypto.setSessionKey(email, password);
try { localStorage.setItem('_gznd_session_active', '1'); sessionStorage.setItem('_gznd_session_active', '1'); } catch(e) {}
try { if (typeof loadAllData === 'function') await loadAllData(); } catch(e) {}
messageDiv.textContent = '✓ Offline Login (Network unavailable)';
messageDiv.style.color = 'var(--accent-emerald)';
setTimeout(() => { if(currentUser){const o=document.getElementById('auth-overlay');if(o)o.style.display='none';document.body.style.overflow='';if(typeof refreshAllDisplays==='function')refreshAllDisplays();} }, 300);
return;
}
errorMessage = 'Network error. If you have logged in before, ensure correct credentials for offline access.';
}
else errorMessage += (error.message || '');
LoginRateLimiter.recordFailure();
if (LoginRateLimiter.isLockedOut()) {
const remainSec = Math.ceil(LoginRateLimiter.lockoutRemainingMs() / 1000);
const mins = Math.floor(remainSec / 60);
const secs = String(remainSec % 60).padStart(2,'0');
errorMessage = `Too many failed attempts. Account temporarily locked. Try again in ${mins}m ${secs}s.`;
}
messageDiv.textContent = errorMessage;
messageDiv.style.color = 'var(--danger)';
}
}
async function handleSignUp() {
const emailInput = document.getElementById('auth-email');
const passwordInput = document.getElementById('auth-password');
const messageDiv = document.getElementById('auth-message');
if (!emailInput || !passwordInput || !messageDiv) return;
const email = emailInput.value.trim();
const password = passwordInput.value;
if (!email || !password) {
messageDiv.textContent = 'Please enter email and password';
messageDiv.style.color = 'var(--danger)';
return;
}
if (password.length < 8) {
messageDiv.textContent = 'Password must be at least 8 characters';
messageDiv.style.color = 'var(--danger)';
return;
}
messageDiv.textContent = 'Creating account...';
messageDiv.style.color = 'var(--accent)';
try {
if (typeof firebase !== 'undefined' && firebase.auth) {
const userCredential = await firebase.auth().createUserWithEmailAndPassword(email, password);
currentUser = {
id: userCredential.user.uid,
uid: userCredential.user.uid,
email: userCredential.user.email,
displayName: userCredential.user.displayName
};
await OfflineAuth.saveCredentials(email, password);
idb.setUserPrefix(currentUser.uid);
await IDBCrypto.setSessionKey(email, password);
try { localStorage.setItem('_gznd_session_active', '1'); sessionStorage.setItem('_gznd_session_active', '1'); } catch(e) {}
if (database) {
await firebaseDB.collection('users').doc(currentUser.uid).set({
email: email,
createdAt: Date.now(),
role: 'admin'
});
}
messageDiv.textContent = 'Account created successfully!';
messageDiv.style.color = 'var(--accent-emerald)';
setTimeout(() => {
hideAuthOverlay();
performOneClickSync();
}, 1500);
} else {
messageDiv.textContent = 'Internet required to create a new account.';
messageDiv.style.color = 'var(--danger)';
}
} catch (error) {
console.error('Sign up failed.', _safeErr(error));
let errorMessage = 'Sign up failed. ';
if (error.code === 'auth/email-already-in-use') errorMessage += 'Email already registered.';
else if (error.code === 'auth/invalid-email') errorMessage += 'Invalid email address.';
else if (error.code === 'auth/weak-password') errorMessage += 'Password too weak (min 8 chars).';
else errorMessage += error.message || 'Try again.';
messageDiv.textContent = '' + errorMessage;
messageDiv.style.color = 'var(--danger)';
}
}
async function signOut() {
try {
stopDatabaseHeartbeat();
clearAutoBackup();
if (typeof OfflineQueue !== 'undefined') OfflineQueue.cancelRetry();
if (window._fbOfflineHandler) { window.removeEventListener('offline', window._fbOfflineHandler); window._fbOfflineHandler = null; }
if (window._fbVisibilityHandler) { document.removeEventListener('visibilitychange', window._fbVisibilityHandler); window._fbVisibilityHandler = null; }
window._firebaseListenersRegistered = false;
if (seamlessBackupTimer) { clearTimeout(seamlessBackupTimer); seamlessBackupTimer = null; }
if (socketReconnectTimer) { clearTimeout(socketReconnectTimer); socketReconnectTimer = null; }
if (listenerReconnectTimer) { clearTimeout(listenerReconnectTimer); listenerReconnectTimer = null; }
if (autoSyncTimeout) { clearTimeout(autoSyncTimeout); autoSyncTimeout = null; }
if (window._connectionCheckInterval) { clearInterval(window._connectionCheckInterval); window._connectionCheckInterval = null; }
if (window._syncUpdatesCleanupInterval) { clearInterval(window._syncUpdatesCleanupInterval); window._syncUpdatesCleanupInterval = null; }
if (window._tombstoneCleanupInterval) { clearInterval(window._tombstoneCleanupInterval); window._tombstoneCleanupInterval = null; }
if (window._perfMonitorInterval) { clearInterval(window._perfMonitorInterval); window._perfMonitorInterval = null; }
if (typeof syncState !== 'undefined' && syncState.syncInterval) { clearInterval(syncState.syncInterval); syncState.syncInterval = null; }
if (auth) {
await auth.signOut();
currentUser = null;
IDBCrypto.clearSessionKey();
idb.clearUserPrefix();
try { sessionStorage.removeItem('_gznd_session_active'); localStorage.removeItem('_gznd_session_active'); localStorage.removeItem('_gznd_session_key_backup'); localStorage.removeItem('persistentLogin'); } catch(e) {}
DeltaSync.clearAllTimestamps().catch(e => console.warn("[DeltaSync] clearAllTimestamps on signout:", e));
if (typeof UUIDSyncRegistry !== 'undefined') UUIDSyncRegistry.clearAll().catch(() => {});
showToast(' Signed out successfully', 'success');
} else {
currentUser = null;
IDBCrypto.clearSessionKey();
idb.clearUserPrefix();
try { sessionStorage.removeItem('_gznd_session_active'); localStorage.removeItem('_gznd_session_active'); localStorage.removeItem('_gznd_session_key_backup'); localStorage.removeItem('persistentLogin'); } catch(e) {}
DeltaSync.clearAllTimestamps().catch(e => console.warn("[DeltaSync] clearAllTimestamps on signout:", e));
if (typeof UUIDSyncRegistry !== 'undefined') UUIDSyncRegistry.clearAll().catch(() => {});
showToast(' Signed out', 'success');
}
setTimeout(() => {
createAuthOverlay();
showAuthOverlay();
}, 500);
} catch (error) {
showToast(' Error signing out', 'danger');
}
}
function updateSyncButton() {
const syncBtn = document.getElementById('sync-btn');
if (!syncBtn) return;
if (!currentUser) {
syncBtn.innerHTML = ' LOGIN TO SYNC';
syncBtn.onclick = () => {
closeDataMenu();
showAuthOverlay();
};
syncBtn.style.removeProperty('background');
syncBtn.style.setProperty('background-color', '#ff9f0a', 'important');
syncBtn.style.setProperty('background-image', 'linear-gradient(135deg, #ff9f0a 0%, #ff375f 100%)', 'important');
syncBtn.style.color = '#fff';
} else {
syncBtn.innerHTML = ' SYNC DATA';
syncBtn.onclick = () => {
performOneClickSync();
};
syncBtn.style.removeProperty('background');
syncBtn.style.setProperty('background-color', '#2563eb', 'important');
syncBtn.style.setProperty('background-image', 'linear-gradient(135deg, #2563eb 0%, #059669 100%)', 'important');
syncBtn.style.color = '#fff';
}

}
