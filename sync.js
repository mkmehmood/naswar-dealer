
async function saveWithTracking(key, data, specificRecord = null, specificIds = null) {
const result = await sqliteStore.set(key, data);
const collectionEntry = SQLiteToFirestoreMap[key];
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
const SQLiteToFirestoreMap = {
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
const FirestoreToSQLiteMap = {
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
function getFirestoreCollection(sqliteKey) {
return SQLiteToFirestoreMap[sqliteKey]?.collection || sqliteKey;
}
function getSQLiteKey(firestoreCollection) {
return FirestoreToSQLiteMap[firestoreCollection] || firestoreCollection;
}

async function saveRecordToFirestore(sqliteKey, record, silent = true) {
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
const collectionName = getFirestoreCollection(sqliteKey);
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
if (!record.isMerged) queuedRecord.updatedAt = new Date(now).toISOString();
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

if (collectionName === 'inventory') {
  const _supplierFields = ['supplierId', 'supplierName', 'supplierContact', 'supplierType', 'totalPayable', 'paidDate'];
  _supplierFields.forEach(f => { if (!(f in record)) sanitized[f] = firebase.firestore.FieldValue.delete(); });
}
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
if (!record.isMerged) fallbackRecord.updatedAt = new Date(now).toISOString();
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

async function deleteRecordFromFirestore(sqliteKey, recordId, silent = true) {
if (!firebaseDB || !currentUser) {
return false;
}
if (!recordId) {
return false;
}
const collectionName = getFirestoreCollection(sqliteKey);
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

async function unifiedSave(sqliteKey, dataArray, specificRecord = null) {
if (specificRecord && specificRecord.id) {
  await saveWithTracking(sqliteKey, dataArray, specificRecord);
  _syncQueue.run(async () => {
    try {
      await saveRecordToFirestore(sqliteKey, specificRecord);
    } catch (e) {
      const collectionName = getFirestoreCollection(sqliteKey);
      if (typeof OfflineQueue !== 'undefined' && collectionName) {
        const now = Date.now();
        const fallback = sanitizeForFirestore({ ...specificRecord, syncedAt: new Date().toISOString() });
        if (!fallback.createdAt) fallback.createdAt = now;
        if (!specificRecord.isMerged) fallback.updatedAt = new Date(now).toISOString();
        await OfflineQueue.add({
          action: 'set',
          collection: getFirestoreCollection(sqliteKey),
          docId: String(specificRecord.id),
          data: fallback
        });
      }
    }
  });
} else {
  await saveWithTracking(sqliteKey, dataArray);
}
triggerAutoSync();
return true;
}

async function unifiedDelete(sqliteKey, dataArray, deletedRecordId, opts = {}, preDeletedRecord = null) {
if (opts.strict !== true) {
  console.warn(`[RecycleBin] BLOCKED unifiedDelete on "${sqliteKey}" id=${deletedRecordId} — strict flag missing. Pass { strict: true } to confirm intentional deletion.`);
  if (typeof window.showToast === 'function') window.showToast('Delete blocked: missing strict confirmation flag.', 'warning');
  return false;
}
await saveWithTracking(sqliteKey, dataArray);
const collectionName = getFirestoreCollection(sqliteKey);
// IMPORTANT: registerDeletion must be awaited OUTSIDE _syncQueue.run() because it
// internally acquires _syncQueue itself. Calling it from within _syncQueue.run()
// creates a promise-chain deadlock — the outer block awaits something that can only
// run after the outer block completes — so deleted_records never gets updated and
// deleteRecordFromFirestore never runs, leaving the record alive in Firestore.
if (collectionName && typeof window.registerDeletion === 'function') {
  try {
    await window.registerDeletion(deletedRecordId, collectionName, preDeletedRecord || null);
  } catch (e) {
    console.warn('[unifiedDelete] registerDeletion failed:', String(e));
  }
}

// Only the Firestore delete goes in the queue — it has no nested queue calls.
_syncQueue.run(async () => {
  try {
    await deleteRecordFromFirestore(sqliteKey, deletedRecordId);
  } catch (e) {}
});
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
const sqliteKey = getSQLiteKey(collection);
const data = await sqliteStore.get(sqliteKey, []);
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
await sqliteStore.remove('deltaSyncStats');

if (typeof UUIDSyncRegistry !== 'undefined') await UUIDSyncRegistry.clearAll().catch(() => {});
showToast('Delta sync reset - next sync will download all data', 'info');
}
window.verifyDeltaSyncSystem = verifyDeltaSyncSystem;
window.resetDeltaSync = resetDeltaSync;
window.getFirestoreCollection = getFirestoreCollection;
window.getSQLiteKey = getSQLiteKey;
window.saveRecordToFirestore = saveRecordToFirestore;
window.deleteRecordFromFirestore = deleteRecordFromFirestore;
async function initializeFirebaseSystem() {
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
if (typeof firebase.setLogLevel === 'function') firebase.setLogLevel('silent');
if (firebase.firestore && typeof firebase.firestore.setLogLevel === 'function') {
firebase.firestore.setLogLevel('silent');
}
if (typeof window._reapplyConsolePatch === 'function') window._reapplyConsolePatch();
try {
firebase.firestore().settings({
experimentalAutoDetectLongPolling: true,
experimentalForceLongPolling: false,
merge: true
});
} catch (_fsPre) {  }
database = firebase.firestore();
firebaseDB = database;
try { database.disableNetwork().catch(() => {}); } catch(_dnErr) {}
window._firestoreNetworkDisabled = true;
auth = firebase.auth();
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
.then(() => {
})
.catch((error) => {
});

_checkGoogleRedirectResult();
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
  await SQLiteCrypto.sessionSet('login', loginData);
  await SQLiteCrypto.sessionSet('active', { value: '1', ts: Date.now() });
  localStorage.setItem('persistentLogin', JSON.stringify(loginData));
  localStorage.setItem('_gznd_session_active', '1');
  sessionStorage.setItem('_gznd_session_active', '1');
} catch (e) {
console.warn('Failed to save persistent login:', _safeErr(e));
}
hideAuthOverlay();
showToast(`Welcome back, ${user.email.split('@')[0]}`, 'success');
sqliteStore.setUserPrefix(user.uid);
await SQLiteCrypto.initialize();
const _isGoogleProvider = Array.isArray(user.providerData) &&
  user.providerData.some(p => p && p.providerId === 'google.com');
if (_isGoogleProvider) {
await SQLiteCrypto.setSessionKey(user.email, user.uid, user.uid).catch(() => {});
sqliteStore.reEncryptAll().catch(() => {});
}
const keyRestored = await SQLiteCrypto.restoreSessionKeyFromStorage();
if (!keyRestored) {
if (_isGoogleProvider) {
} else {
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
}
} else {
const isKeyValid = await SQLiteCrypto.validateKey();
if (!isKeyValid) {
console.warn('Auth: Encryption key validation failed');
SQLiteCrypto.clearSessionKey();
showToast('Encryption key invalid. Please log in again.', 'error');
updateSyncButton();
showAuthOverlay();
return;
}
}
if (typeof firebaseDB !== 'undefined' && firebaseDB && window._firestoreNetworkDisabled) {
  try {
    await firebaseDB.enableNetwork();
    window._firestoreNetworkDisabled = false;
    if (typeof OfflineQueue !== 'undefined' && navigator.onLine) {
      OfflineQueue.processQueue().catch(() => {});
    }
  } catch (_enErr) {  }
}
try {
  if (typeof loadAllData === 'function') await loadAllData();
  if (typeof refreshAllDisplays === 'function') await refreshAllDisplays();
} catch(e) {
  console.warn('Auth: post-login data reload failed:', _safeErr(e));
}
updateSyncButton();
if (typeof subscribeToRealtime === 'function') {
subscribeToRealtime().catch(e => console.warn('subscribeToRealtime failed:', _safeErr(e)));
}
if (typeof registerDevice === 'function') {
setTimeout(() => {
registerDevice().catch(err => {
console.warn('Device registration failed:', _safeErr(err));
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
  await SQLiteCrypto.sessionDelete('login');
  await SQLiteCrypto.sessionDelete('active');
  await SQLiteCrypto.sessionDelete('keyBackup');
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
await sqliteStore.set('firestore_initialized', true);
await sqliteStore.set('firestore_init_timestamp', Date.now());
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
        console.warn('[SyncQueue] task error:', _safeErr(err));
      });
      return _chain;
    }
  };
})();
window._syncQueue = _syncQueue;

const SYNC_COLLECTIONS = [
  {
    firestoreId:  'production',
    sqliteKey:       'mfg_pro_pkr',
    tabSyncFn:    'syncProductionTab',
    lockOnClose:  true,
  },
  {
    firestoreId:  'sales',
    sqliteKey:       'customer_sales',
    tabSyncFn:    'syncSalesTab',
    lockOnClose:  true,
  },
  {
    firestoreId:  'rep_sales',
    sqliteKey:       'rep_sales',
    tabSyncFn:    'syncRepTab',
    lockOnClose:  true,
  },
  {
    firestoreId:  'rep_customers',
    sqliteKey:       'rep_customers',
    tabSyncFn:    'syncRepTab',
    lockOnClose:  false,
  },
  {
    firestoreId:  'sales_customers',
    sqliteKey:       'sales_customers',
    tabSyncFn:    'renderCustomersTable',
    lockOnClose:  false,
  },
  {
    firestoreId:  'transactions',
    sqliteKey:       'payment_transactions',
    tabSyncFn:    'syncPaymentsTab',
    lockOnClose:  true,
  },
  {
    firestoreId:  'entities',
    sqliteKey:       'payment_entities',
    tabSyncFn:    'refreshPaymentTab',
    lockOnClose:  false,
  },
  {
    firestoreId:  'inventory',
    sqliteKey:       'factory_inventory_data',
    tabSyncFn:    'syncFactoryTab',
    lockOnClose:  false,
  },
  {
    firestoreId:  'factory_history',
    sqliteKey:       'factory_production_history',
    tabSyncFn:    'syncFactoryTab',
    lockOnClose:  true,
  },
  {
    firestoreId:  'returns',
    sqliteKey:       'stock_returns',
    tabSyncFn:    'syncProductionTab',
    lockOnClose:  true,
  },
  {
    firestoreId:  'expenses',
    sqliteKey:       'expenses',
    tabSyncFn:    'refreshPaymentTab',
    lockOnClose:  true,
  },
  {
    firestoreId:  'calculator_history',
    sqliteKey:       'noman_history',
    tabSyncFn:    'syncCalculatorTab',
    lockOnClose:  true,
  },
];

async function _getColData(sqliteKey) {
return ensureArray(await sqliteStore.get(sqliteKey));
}
async function _setColData(sqliteKey, value) {
await sqliteStore.set(sqliteKey, value);
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
const addedOrModified = [];
const removedIds = [];
for (const change of changes) {
try {
const docData = { id: change.doc.id, ...change.doc.data() };
if (change.type === 'added' || change.type === 'modified') {
if (typeof UUIDSyncRegistry !== 'undefined') {
UUIDSyncRegistry.markDownloaded(col.firestoreId, change.doc.id);
} else {
DeltaSync.markDownloaded(col.firestoreId, change.doc.id);
}
addedOrModified.push(docData);
} else if (change.type === 'removed') {
if (typeof UUIDSyncRegistry !== 'undefined') {
UUIDSyncRegistry.markDownloaded(col.firestoreId, change.doc.id);
} else {
DeltaSync.markDownloaded(col.firestoreId, change.doc.id);
}
_ensureLocalTombstone(change.doc.id, col.firestoreId);
removedIds.push(change.doc.id);
}
} catch (docErr) {
console.warn(`[Snapshot:${col.firestoreId}] doc error`, _safeErr(docErr));
}
}
const hasChanges = addedOrModified.length > 0 || removedIds.length > 0;
if (!hasChanges) { recordSuccessfulConnection(); return; }
{
const deletedArr = ensureArray(await sqliteStore.get('deleted_records'));
const deletedSet = new Set(deletedArr);
addedOrModified.forEach(d => deletedSet.delete(d.id));
removedIds.forEach(id => deletedSet.add(id));
await sqliteStore.set('deleted_records', Array.from(deletedSet));
}
let arr = await _getColData(col.sqliteKey);
for (const docData of addedOrModified) {
arr = _updateArray(arr, docData, col.firestoreId);
}
for (const rid of removedIds) {
arr = arr.filter(item => item.id !== rid);
}
await _setColData(col.sqliteKey, arr);
await DeltaSync.setLastSyncTimestamp(col.firestoreId);
emitSyncUpdate({ [col.sqliteKey]: null});
if (col.tabSyncFn === 'syncFactoryTab' && typeof renderFactoryInventory === 'function') {
renderFactoryInventory();
} else if ((col.tabSyncFn === 'syncPaymentsTab' || col.tabSyncFn === 'refreshPaymentTab') && typeof renderUnifiedTable === 'function') {
renderUnifiedTable();
} else if (col.tabSyncFn && typeof window[col.tabSyncFn] === 'function') {
window[col.tabSyncFn]();
}
flashLivePulse();
recordSuccessfulConnection();
} catch (err) {
console.warn(`[Snapshot:${col.firestoreId}] local save error`, _safeErr(err));
}
};
}

function _ensureLocalTombstone(recordId, collectionName) {
const sid = String(recordId);
_syncQueue.run(async () => {
  try {
    const existing = ensureArray(await sqliteStore.get('deletion_records'));
    const already = existing.some(r => String(r.id) === sid || String(r.recordId) === sid);
    if (!already) {
      existing.push({ id: sid, recordId: sid, collection: collectionName, recordType: collectionName, deletedAt: Date.now(), syncedToCloud: true });
      await sqliteStore.set('deletion_records', existing);
    }
    const deletedArr = ensureArray(await sqliteStore.get('deleted_records'));
    const set = new Set(deletedArr);
    set.add(sid);
    await sqliteStore.set('deleted_records', Array.from(set));
  } catch (e) {}
});
}

function _updateArray(array, docData, collectionName) {
  if (docData._placeholder || docData.id === '_placeholder_') return array;
  if (!docData.id || !validateUUID(String(docData.id))) {
    docData = ensureRecordIntegrity(docData, false, true);
  }
  docData = ensureRecordIntegrity(docData, false, true);
  const sid = String(docData.id);

  const existingIdx_pre = array.findIndex(item => item && item.id === docData.id);
  if (existingIdx_pre !== -1) {
    const localRecord = array[existingIdx_pre];
    if (typeof UUIDSyncRegistry !== 'undefined') {
      if (UUIDSyncRegistry.skipDownload(collectionName, sid)) {
        if (!UUIDSyncRegistry.shouldApplyCloud(docData, localRecord)) return array;
      }
    }
    const _getMs_pre = (rec) => {
      if (!rec) return 0;
      const ts = rec.updatedAt || rec.timestamp || rec.createdAt || 0;
      if (typeof ts === 'number') return ts;
      if (ts && typeof ts.toMillis === 'function') return ts.toMillis();
      if (ts && typeof ts === 'object') {
        if (typeof ts.seconds === 'number') return ts.seconds * 1000;
        if (typeof ts._seconds === 'number') return ts._seconds * 1000;
      }
      if (ts instanceof Date) return ts.getTime();
      if (typeof ts === 'string') { try { const t = new Date(ts).getTime(); if (!isNaN(t)) return t; } catch (e) {} }
      return 0;
    };
    const cloudMs = _getMs_pre(docData);
    const localMs = _getMs_pre(localRecord);
    if (cloudMs > 0 && cloudMs <= localMs) return array;
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
    catch (err) { console.warn('[SyncLock] Error replaying buffered snapshot', _safeErr(err)); }
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
try {
const _now = Date.now();
if (!window._lastEmitPingAt || (_now - window._lastEmitPingAt) > 2000) {
window._lastEmitPingAt = _now;
firebaseDB.collection('users').doc(currentUser.uid).set({
lastWrite: { ts: firebase.firestore.FieldValue.serverTimestamp(), collections: changedKeys }
}, { merge: true }).catch(() => {});
}
} catch (_pe) {}
}
}

async function startSyncUpdatesCleanup() {
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
  const expDelay = BASE_RETRY_DELAY * Math.pow(2, listenerRetryAttempts);
  const delay = Math.max(expDelay, APP_CONFIG.MIN_LISTENER_RECONNECT_MS);
  listenerRetryAttempts++;
  isReconnecting = true;
  listenerReconnectTimer = setTimeout(() => {
    isReconnecting = false;
    if (firebaseDB && currentUser) subscribeToRealtime().catch(e => console.warn('subscribeToRealtime retry failed:', _safeErr(e)));
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
  if (window._firestoreNetworkDisabled) return;
  try {
    if (!pendingFirestoreYearClose) {
      const storedFlag = await sqliteStore.get('pendingFirestoreYearClose');
      if (storedFlag === true) pendingFirestoreYearClose = true;
    }
  } catch (_flagErr) {  }
  if (pendingFirestoreYearClose && !closeYearInProgress) {
    try {
      const userRef = firebaseDB.collection('users').doc(currentUser.uid);
      const [_db,_cs,_rs,_sh,_pt,_fph,_er,_sr] = await Promise.all([
        sqliteStore.get('mfg_pro_pkr',[]), sqliteStore.get('customer_sales',[]),
        sqliteStore.get('rep_sales',[]), sqliteStore.get('noman_history',[]),
        sqliteStore.get('payment_transactions',[]), sqliteStore.get('factory_production_history',[]),
        sqliteStore.get('expenses',[]), sqliteStore.get('stock_returns',[]),
      ]);
      const yearCloseCollections = [
        { name: 'production',         data: ensureArray(_db),   filter: d => !d.isMerged },
        { name: 'sales',              data: ensureArray(_cs),   filter: d => !d.isMerged },
        { name: 'rep_sales',          data: ensureArray(_rs),   filter: d => !d.isMerged },
        { name: 'calculator_history', data: ensureArray(_sh),   filter: d => !d.isMerged },
        { name: 'transactions',       data: ensureArray(_pt),   filter: d => !d.isMerged },
        { name: 'factory_history',    data: ensureArray(_fph),  filter: d => !d.isMerged },
        { name: 'expenses',           data: ensureArray(_er),   filter: d => !d.isMerged },
        { name: 'returns',            data: ensureArray(_sr),   filter: d => !d.isMerged },
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
        await sqliteStore.set('pendingFirestoreYearClose', false);
        showToast('Cloud sync for year-close completed successfully', 'success', 4000);
      }
    } catch (e) { console.warn('pendingFirestoreYearClose retry failed:', _safeErr(e)); }
  }

  updateSignalUI('connecting');
  realtimeRefs.forEach(unsub => {
    try { if (typeof unsub === 'function') unsub(); }
    catch (e) { console.error('Firebase operation failed.', _safeErr(e)); }
  });
  realtimeRefs = [];

  const userRef = firebaseDB.collection('users').doc(currentUser.uid);

  try {
    const userDocUnsub = userRef.onSnapshot(async (snap) => {
      if (!snap.exists) return;
      const data = snap.data() || {};
      if (data.forceLogout && data.forceLogout.at) {
        const sessionStart = parseInt((await sqliteStore.get('session_start', 0)) || '0', 10);
        if (data.forceLogout.at > sessionStart) {
          showToast('Your account access has been revoked. Signing out…', 'error', 5000);
          setTimeout(async () => {
            if (typeof signOut === 'function') await signOut();
          }, 1500);
        }
      }
      if (data.approved === false) {
        showToast('Your account has been suspended. Signing out…', 'error', 5000);
        setTimeout(async () => {
          if (typeof signOut === 'function') await signOut();
        }, 1500);
      }
      if (!snap.metadata.hasPendingWrites && !snap.metadata.fromCache && data.lastWrite) {
        const pingTs = data.lastWrite.ts && data.lastWrite.ts.toMillis
          ? data.lastWrite.ts.toMillis()
          : (typeof data.lastWrite.ts === 'number' ? data.lastWrite.ts : 0);
        const lastSeenPing = window._lastSeenPingTs || 0;
        if (pingTs > lastSeenPing + 1000) {
          window._lastSeenPingTs = pingTs;
          if (!window._lastEmitPingAt || Math.abs(pingTs - window._lastEmitPingAt) > 3000) {
            setTimeout(() => {
              if (typeof pullDataFromCloud === 'function') pullDataFromCloud(true).catch(() => {});
            }, 500);
          }
        }
      }
    }, () => {});
    realtimeRefs.push(userDocUnsub);

    const _handleSettingsSnapshot = async (doc) => {
      try {
        if (!doc.exists || doc.metadata.hasPendingWrites) return;
        if (doc.metadata.fromCache) return;
        trackFirestoreRead(1);
        const cloudSettings = doc.data();
        if (!cloudSettings || typeof cloudSettings !== 'object') return;

        let hasUpdates = false;
        const timestampChecks = [
          { cloud: cloudSettings.naswar_default_settings_timestamp, local: await sqliteStore.get('naswar_default_settings_timestamp') },
          { cloud: cloudSettings.repProfile_timestamp,              local: await sqliteStore.get('repProfile_timestamp') },
        ];
        for (const check of timestampChecks) {
          if ((check.cloud || 0) > (check.local || 0)) { hasUpdates = true; break; }
        }
        if (!hasUpdates) return;

        if (cloudSettings.naswar_default_settings) {
          const ct = cloudSettings.naswar_default_settings_timestamp || 0;
          const lt = (await sqliteStore.get('naswar_default_settings_timestamp')) || 0;
          if (ct > lt) {
            defaultSettings = cloudSettings.naswar_default_settings;
            await sqliteStore.setBatch([
              ['naswar_default_settings', defaultSettings],
              ['naswar_default_settings_timestamp', ct],
            ]);
          }
        }
        if (cloudSettings.repProfile) {
          const ct = cloudSettings.repProfile_timestamp || 0;
          const lt = (await sqliteStore.get('repProfile_timestamp')) || 0;
          if (ct > lt) {
            currentRepProfile = cloudSettings.repProfile;
            await sqliteStore.setBatch([
              ['current_rep_profile', currentRepProfile],
              ['repProfile_timestamp', ct],
            ]);
          }
        }
        if (cloudSettings.last_synced) await sqliteStore.set('last_synced', cloudSettings.last_synced);
        emitSyncUpdate({ settings: null});
        flashLivePulse();
        recordSuccessfulConnection();
      } catch (error) {
        console.warn('[sync] local save error in snapshot handler:', _safeErr(error));
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
          { cloud: cfs.default_formulas_timestamp,       local: await sqliteStore.get('factory_default_formulas_timestamp') },
          { cloud: cfs.additional_costs_timestamp,       local: await sqliteStore.get('factory_additional_costs_timestamp') },
          { cloud: cfs.cost_adjustment_factor_timestamp, local: await sqliteStore.get('factory_cost_adjustment_factor_timestamp') },
          { cloud: cfs.sale_prices_timestamp,            local: await sqliteStore.get('factory_sale_prices_timestamp') },
          { cloud: cfs.unit_tracking_timestamp,          local: await sqliteStore.get('factory_unit_tracking_timestamp') },
        ];
        let hasUpdates = checks.some(c => (c.cloud || 0) > (c.local || 0));
        if (!hasUpdates) return;

        const _applyFactorySetting = async (cloudObj, cloudTs, localTsKey, localKey, transform) => {
          if (!cloudObj || typeof cloudObj !== 'object') return;
          if (!(('standard' in cloudObj) && ('asaan' in cloudObj))) return;
          const lt = (await sqliteStore.get(localTsKey)) || 0;
          if ((cloudTs || 0) > lt) {
            const val = transform(cloudObj);
            await sqliteStore.setBatch([[localKey, val], [localTsKey, cloudTs || Date.now()]]);
            return val;
          }
          return null;
        };

        const newFormulas = await _applyFactorySetting(
          cfs.default_formulas, cfs.default_formulas_timestamp,
          'factory_default_formulas_timestamp', 'factory_default_formulas',
          o => ({ standard: Array.isArray(o.standard) ? o.standard : [], asaan: Array.isArray(o.asaan) ? o.asaan : [] })
        );

        const newCosts = await _applyFactorySetting(
          cfs.additional_costs, cfs.additional_costs_timestamp,
          'factory_additional_costs_timestamp', 'factory_additional_costs',
          o => ({ standard: parseFloat(o.standard) || 0, asaan: parseFloat(o.asaan) || 0 })
        );

        const newFactor = await _applyFactorySetting(
          cfs.cost_adjustment_factor, cfs.cost_adjustment_factor_timestamp,
          'factory_cost_adjustment_factor_timestamp', 'factory_cost_adjustment_factor',
          o => ({ standard: parseFloat(o.standard) || 1, asaan: parseFloat(o.asaan) || 1 })
        );

        const newPrices = await _applyFactorySetting(
          cfs.sale_prices, cfs.sale_prices_timestamp,
          'factory_sale_prices_timestamp', 'factory_sale_prices',
          o => ({ standard: parseFloat(o.standard) || 0, asaan: parseFloat(o.asaan) || 0 })
        );

        const newTracking = await _applyFactorySetting(
          cfs.unit_tracking, cfs.unit_tracking_timestamp,
          'factory_unit_tracking_timestamp', 'factory_unit_tracking',
          o => ({
            standard: o.standard || { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
            asaan:    o.asaan    || { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
          })
        );

        refreshFactorySettingsOverlay();
        emitSyncUpdate({ factorySettings: null});
        flashLivePulse();
        recordSuccessfulConnection();
      } catch (error) {
        console.warn('[sync] local save error in snapshot handler:', _safeErr(error));
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

        const cloudTs = cloud.categories_timestamp || cloud.updated_at || 0;
        const localTs = (await sqliteStore.get('expense_categories_timestamp')) || 0;
        if (cloudTs && localTs && cloudTs <= localTs) { recordSuccessfulConnection(); return; }

        const local = await sqliteStore.get('expense_categories') || [];
        const cloudSorted = [...cloud.categories].sort((a, b) => (a.id || '').localeCompare(b.id || ''));
        const localSorted = [...local].sort((a, b) => (a.id || '').localeCompare(b.id || ''));
        if (JSON.stringify(cloudSorted) !== JSON.stringify(localSorted)) {
          await sqliteStore.set('expense_categories', cloud.categories);
          if (cloudTs) await sqliteStore.set('expense_categories_timestamp', cloudTs);
          emitSyncUpdate({ expenseCategories: null});
          flashLivePulse();
        }
        recordSuccessfulConnection();
      } catch (error) {
        console.warn('[sync] local save error in snapshot handler:', _safeErr(error));
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
        let deletionRecords = ensureArray(await sqliteStore.get('deletion_records'));
        const deletedArr = ensureArray(await sqliteStore.get('deleted_records'));
        const deletedSet = new Set(deletedArr);
        for (const change of changes) {
          try {
            const docData = { id: change.doc.id, ...change.doc.data() };
            if (change.type === 'added' || change.type === 'modified') {
              if (docData.recordId || docData.id) {
                const _rid = docData.recordId || docData.id;
                const _recoveredSet = typeof _recoveredThisSession !== 'undefined' ? _recoveredThisSession : null;
                if (_recoveredSet && (_recoveredSet.has(_rid) || _recoveredSet.has(docData.id))) continue;
                deletedSet.add(_rid);
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
                const _filterOut = (key) => sqliteStore.get(key, []).then(arr => sqliteStore.set(key, ensureArray(arr).filter(i => i.id !== rid)));
                if (rt === 'production' && rid)                                    await _filterOut('mfg_pro_pkr');
                else if ((rt === 'sale' || rt === 'sales') && rid)                 await _filterOut('customer_sales');
                else if ((rt === 'expenses' || rt === 'expense') && rid)           await _filterOut('expenses');
                else if ((rt === 'transactions' || rt === 'transaction') && rid)   await _filterOut('payment_transactions');
                else if ((rt === 'rep_sales' || rt === 'rep_sale') && rid)         await _filterOut('rep_sales');
                else if (rt === 'rep_customers' && rid)                            await _filterOut('rep_customers');
                else if (rt === 'inventory' && rid)                                await _filterOut('factory_inventory_data');
                else if (rt === 'factory_history' && rid)                          await _filterOut('factory_production_history');
                else if (rt === 'returns' && rid)                                  await _filterOut('stock_returns');
                else if (rt === 'calculator_history' && rid)                       await _filterOut('noman_history');
                else if (rt === 'entities' && rid)                                 await _filterOut('payment_entities');
              } catch (collectionError) { console.warn('Failed to apply deletion to collection', _safeErr(collectionError)); }
              hasChanges = true;
            } else if (change.type === 'removed') {

              const _docRid = String(change.doc.data()?.recordId || change.doc.id);
              deletionRecords = deletionRecords.filter(r =>
                String(r.id) !== _docRid && String(r.recordId) !== _docRid
              );
              hasChanges = true;
            }
          } catch (docError) { console.warn('Failed to save data locally.', _safeErr(docError)); }
        }
        if (hasChanges) {
          deletionRecords = _dedupDeletionRecords(deletionRecords);
          await sqliteStore.set('deletion_records', deletionRecords);
          await sqliteStore.set('deleted_records', Array.from(deletedSet));
          emitSyncUpdate({ deletion_records: null});
          flashLivePulse();
          recordSuccessfulConnection();
        }
      } catch (error) {
        console.warn('[sync] local save error in snapshot handler:', _safeErr(error));
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
        const localTs = (await sqliteStore.get('team_list_timestamp')) || 0;
        if (cloudTs <= localTs) { recordSuccessfulConnection(); return; }
        let changed = false;
        if (Array.isArray(teamData.sales_reps) && teamData.sales_reps.length > 0) {
          const prev = JSON.stringify(salesRepsList);
          salesRepsList = teamData.sales_reps;
          await sqliteStore.set('sales_reps_list', salesRepsList);
          if (JSON.stringify(salesRepsList) !== prev) changed = true;
        }
        if (Array.isArray(teamData.user_roles)) {
          const prev2 = JSON.stringify(userRolesList);
          userRolesList = teamData.user_roles;
          await sqliteStore.set('user_roles_list', userRolesList);
          if (JSON.stringify(userRolesList) !== prev2) changed = true;
        }
        await sqliteStore.set('team_list_timestamp', cloudTs);
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
      } catch (err) { console.warn('Team list sync error:', _safeErr(err)); }
    };
    const teamUnsub = userRef.collection('settings').doc('team').onSnapshot(async (doc) => {
      if (isSyncing) { _enqueueSyncLocked(_handleTeamSnapshot, doc); return; }
      await _handleTeamSnapshot(doc);
    }, _e => { updateSignalUI('error'); scheduleListenerReconnect(); });
    realtimeRefs.push(teamUnsub);

    updateSignalUI('online');
    recordSuccessfulConnection();
    if (typeof registerDevice === 'function') {
      registerDevice().catch(err => { console.warn('Device registration failed:', _safeErr(err)); });
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
  socketReconnectTimer = setTimeout(() => { subscribeToRealtime().catch(e => console.warn('subscribeToRealtime socket retry failed:', _safeErr(e))); }, 5000);
}
async function initFirebase() {
  if (window._firebaseListenersRegistered) return;
  window._firebaseListenersRegistered = true;
  try {
    window._fbOfflineHandler = () => { updateSignalUI('offline'); };
    window._fbVisibilityHandler = async () => {
      if (document.visibilityState !== 'visible') return;
      if (!currentUser || !database) return;
      try {
        const lastSync = await sqliteStore.get('last_synced');
        const msSince = lastSync ? (Date.now() - new Date(lastSync).getTime()) : Infinity;
        if (msSince < APP_CONFIG.VISIBILITY_SYNC_COOLDOWN_MS) return;
        await pullDataFromCloud(true);
      } catch (error) { console.warn('Failed to pull data from cloud.', _safeErr(error)); }
    };
    window.addEventListener('offline', window._fbOfflineHandler);
    document.addEventListener('visibilitychange', window._fbVisibilityHandler);
  } catch (e) { console.warn('Failed to pull data from cloud.', _safeErr(e)); }
}

function _toMs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'object' && v.seconds) return v.seconds * 1000 + Math.round((v.nanoseconds || 0) / 1e6);
  return new Date(v).getTime() || 0;
}

function mergeDatasets(localArray, cloudArray, deletedSet = new Set()) {
  if (!Array.isArray(localArray)) localArray = [];
  if (!Array.isArray(cloudArray)) cloudArray = [];
  const mergedMap = new Map();
  cloudArray.forEach(item => {
    if (item && item.id) {
      if (deletedSet.has(item.id)) return;
      mergedMap.set(item.id, item);
    }
  });
  localArray.forEach(localItem => {
    if (!localItem || !localItem.id) return;
    if (deletedSet.has(localItem.id)) return;
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
      else if (collectionName) {
        if (useUUIDGate) UUIDSyncRegistry.markDownloaded(collectionName, sid);
        else DeltaSync.markDownloaded(collectionName, sid);
      }
    }
  }

  return merged.map(item => {
    if (!item.id || !validateUUID(item.id)) { fixedCount++; return ensureRecordIntegrity(item, false, true); }
    return item;
  });
}

async function _detectUserType(userRef) {
  const hasInitialized = await sqliteStore.get('firestore_initialized');
  const sqliteArrays = await Promise.all([
    sqliteStore.get('mfg_pro_pkr', []), sqliteStore.get('customer_sales', []), sqliteStore.get('rep_sales', []),
    sqliteStore.get('noman_history', []), sqliteStore.get('payment_transactions', []), sqliteStore.get('payment_entities', []),
    sqliteStore.get('factory_inventory_data', []), sqliteStore.get('factory_production_history', []),
    sqliteStore.get('stock_returns', []), sqliteStore.get('rep_customers', []), sqliteStore.get('expenses', []),
  ]);
  const totalLocal = sqliteArrays.reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
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
  const FRESH_THRESHOLD_MS = 8 * 1000;
  const buildQuery = async (collection, collectionName) => {
    if (userType === 'existing') return collection.get();
    const lastDownloadKey = `lastDownload_${collectionName}`;
    let lastDownloadMs = 0;
    try {
      const raw = await sqliteStore.get(lastDownloadKey);
      lastDownloadMs = raw ? (typeof raw === 'number' ? raw : parseInt(raw)) : 0;
    } catch (_) {}
    if (lastDownloadMs && (Date.now() - lastDownloadMs) < FRESH_THRESHOLD_MS) {
      return { docs: [], docChanges: () => [] };
    }
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
  trackFirestoreRead(3);
  let realCollectionReads = 0;
  [productionSnap, salesSnap, calcHistorySnap, repSalesSnap, repCustomersSnap,
   salesCustomersSnap, transactionsSnap, entitiesSnap, inventorySnap,
   factoryHistorySnap, expensesSnap, returnsSnap].forEach(snap => {
    if (snap && typeof snap.query !== 'undefined') realCollectionReads++;
  });
  trackFirestoreRead(realCollectionReads);

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

    let localDels = await sqliteStore.get('deletion_records') || [];
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
  await sqliteStore.set('deletion_records', deduped);
  const _deletedSet = new Set(deduped.map(r => r.id));
  await sqliteStore.set('deleted_records', Array.from(_deletedSet));
  trackFirestoreRead(deletionsSnap.docs.length);
  } catch (_delErr) {
  console.warn('[Sync] Failed to refresh deletions:', _safeErr(_delErr));
  }

  const { data } = cloudData;
  const _localKeys = [
  'mfg_pro_pkr','customer_sales','noman_history','rep_sales','rep_customers',
  'sales_customers','payment_transactions','payment_entities',
  'factory_inventory_data','factory_production_history','stock_returns','expenses',
  ];
  const _localBatch = await sqliteStore.getBatch(_localKeys);
  const _deletedArr = ensureArray(await sqliteStore.get('deleted_records'));
  const _notDeleted = item => !_deletedArr.includes(item.id);
  const _m = (key, col, cloudKey) => mergeArrays(ensureArray(_localBatch.get(key)), data[cloudKey] || [], col).filter(_notDeleted);
  const _merged = {
  mfg_pro_pkr:                _m('mfg_pro_pkr',                'production',       'mfg_pro_pkr'),
  customer_sales:             _m('customer_sales',             'sales',             'customer_sales'),
  noman_history:              _m('noman_history',              'calculator_history','noman_history'),
  rep_sales:                  _m('rep_sales',                  'rep_sales',         'rep_sales'),
  rep_customers:              _m('rep_customers',              'rep_customers',     'rep_customers'),
  sales_customers:            _m('sales_customers',            'sales_customers',   'sales_customers'),
  payment_transactions:       _m('payment_transactions',       'transactions',      'payment_transactions'),
  payment_entities:           _m('payment_entities',           'entities',          'payment_entities'),
  factory_inventory_data:     _m('factory_inventory_data',     'inventory',         'factory_inventory_data'),
  factory_production_history: _m('factory_production_history', 'factory_history',   'factory_production_history'),
  stock_returns:              _m('stock_returns',              'returns',           'stock_returns'),
  expenses:                   _m('expenses',                   'expenses',          'expenses'),
  };

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

  await sqliteStore.setBatch([
  ...Object.entries(_merged).map(([k, v]) => [k, v]),
  ['last_synced', new Date().toISOString()],
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
  if (Array.isArray(arr)) {
    await DeltaSync.setLastSyncTimestamp(col);
    await sqliteStore.set(`lastDownload_${col}`, Date.now());
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
      await sqliteStore.set('naswar_default_settings', defaultSettings);
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
      if (newFormulas) { await sqliteStore.setBatch([['factory_default_formulas', newFormulas], ['factory_default_formulas_timestamp', fsData.default_formulas_timestamp || ts]]); }
      const newCosts = await _applyFs(fsData.additional_costs, null, null, o => ({ standard: parseFloat(o.standard) || 0, asaan: parseFloat(o.asaan) || 0 }));
      if (newCosts) { await sqliteStore.setBatch([['factory_additional_costs', newCosts], ['factory_additional_costs_timestamp', fsData.additional_costs_timestamp || ts]]); }
      const newFactor = await _applyFs(fsData.cost_adjustment_factor, null, null, o => ({ standard: parseFloat(o.standard) || 1, asaan: parseFloat(o.asaan) || 1 }));
      if (newFactor) { await sqliteStore.setBatch([['factory_cost_adjustment_factor', newFactor], ['factory_cost_adjustment_factor_timestamp', fsData.cost_adjustment_factor_timestamp || ts]]); }
      const newPrices = await _applyFs(fsData.sale_prices, null, null, o => ({ standard: parseFloat(o.standard) || 0, asaan: parseFloat(o.asaan) || 0 }));
      if (newPrices) { await sqliteStore.setBatch([['factory_sale_prices', newPrices], ['factory_sale_prices_timestamp', fsData.sale_prices_timestamp || ts]]); }
      if (fsData.unit_tracking && ('standard' in fsData.unit_tracking) && ('asaan' in fsData.unit_tracking)) {
        const vt = (d) => ({ produced: parseFloat(d?.produced) || 0, consumed: parseFloat(d?.consumed) || 0, available: parseFloat(d?.available) || 0, unitCostHistory: Array.isArray(d?.unitCostHistory) ? d.unitCostHistory : [] });
        const newTracking = { standard: vt(fsData.unit_tracking.standard), asaan: vt(fsData.unit_tracking.asaan) };
        await sqliteStore.setBatch([['factory_unit_tracking', newTracking], ['factory_unit_tracking_timestamp', fsData.unit_tracking_timestamp || ts]]);
      }
      refreshFactorySettingsOverlay();
    }
  }
  if (expCatSnap && expCatSnap.exists) {
    const ecd = expCatSnap.data();
    if (ecd && Array.isArray(ecd.categories)) {
      await sqliteStore.set('expense_categories', ecd.categories);
    }
  }
}

async function _uploadChanges(userRef) {
  const isRealRecord = item => item && item.id && !item._placeholder && item.id !== '_placeholder_';
  const _keys = [
  'mfg_pro_pkr','customer_sales','rep_sales','rep_customers','sales_customers',
  'noman_history','factory_inventory_data','factory_production_history',
  'payment_entities','payment_transactions','expenses','stock_returns',
  ];
  const _batch = await sqliteStore.getBatch(_keys);
  const collections = {
  production:         ensureArray(_batch.get('mfg_pro_pkr')).filter(isRealRecord),
  sales:              ensureArray(_batch.get('customer_sales')).filter(isRealRecord),
  rep_sales:          ensureArray(_batch.get('rep_sales')).filter(isRealRecord),
  rep_customers:      ensureArray(_batch.get('rep_customers')).filter(isRealRecord),
  sales_customers:    ensureArray(_batch.get('sales_customers')).filter(isRealRecord),
  calculator_history: ensureArray(_batch.get('noman_history')).filter(isRealRecord),
  inventory:          ensureArray(_batch.get('factory_inventory_data')).filter(isRealRecord),
  factory_history:    ensureArray(_batch.get('factory_production_history')).filter(isRealRecord),
  entities:           ensureArray(_batch.get('payment_entities')).filter(isRealRecord),
  transactions:       ensureArray(_batch.get('payment_transactions')).filter(isRealRecord),
  expenses:           ensureArray(_batch.get('expenses')).filter(isRealRecord),
  returns:            ensureArray(_batch.get('stock_returns')).filter(isRealRecord),
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
  const localFormulaTs = await sqliteStore.get('factory_default_formulas_timestamp');
  const localCostsTs   = await sqliteStore.get('factory_additional_costs_timestamp');
  const localFactorTs  = await sqliteStore.get('factory_cost_adjustment_factor_timestamp');
  const localPricesTs  = await sqliteStore.get('factory_sale_prices_timestamp');
  const localUnitTs    = await sqliteStore.get('factory_unit_tracking_timestamp');

  const lastFactorySync = await DeltaSync.getLastSyncTimestamp('factorySettings');
  const factorySettingsDirty = [localFormulaTs, localCostsTs, localFactorTs, localPricesTs, localUnitTs]
    .some(ts => ts && (!lastFactorySync || ts > lastFactorySync));
  if (factorySettingsDirty) {
    const [_fdf, _fac, _fsp, _fcaf, _fut] = await Promise.all([
      sqliteStore.get('factory_default_formulas'),
      sqliteStore.get('factory_additional_costs'),
      sqliteStore.get('factory_sale_prices'),
      sqliteStore.get('factory_cost_adjustment_factor'),
      sqliteStore.get('factory_unit_tracking'),
    ]);
    const _nowTs = Date.now();
    const fsPayload = {
      default_formulas:                _fdf  || { standard: [], asaan: [] },
      default_formulas_timestamp:      localFormulaTs || _nowTs,
      additional_costs:                _fac  || { standard: 0, asaan: 0 },
      additional_costs_timestamp:      localCostsTs   || _nowTs,
      sale_prices:                     _fsp  || { standard: 0, asaan: 0 },
      sale_prices_timestamp:           localPricesTs  || _nowTs,
      cost_adjustment_factor:          _fcaf || { standard: 1, asaan: 1 },
      cost_adjustment_factor_timestamp:localFactorTs  || _nowTs,
      unit_tracking:                   _fut  || { standard: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] }, asaan: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] } },
      unit_tracking_timestamp:         localUnitTs    || _nowTs,
    };
    configBatch.set(userRef.collection('factorySettings').doc('config'), sanitizeForFirestore(fsPayload), { merge: true });
    operationCount++;
    collectionsUploaded.add('factorySettings');
  }

  const localSettingsTs = await sqliteStore.get('naswar_default_settings_timestamp');
  const lastSettingsSync = await DeltaSync.getLastSyncTimestamp('settings');
  if (localSettingsTs && (!lastSettingsSync || localSettingsTs > lastSettingsSync)) {
    const _ds = await sqliteStore.get('naswar_default_settings');
    configBatch.set(
      userRef.collection('settings').doc('config'),
      sanitizeForFirestore({ naswar_default_settings: _ds || {} }),
      { merge: true }
    );
    operationCount++;
    collectionsUploaded.add('settings');
  }

  const localExpCatTs = await sqliteStore.get('expense_categories_timestamp');
  const lastExpCatSync = await DeltaSync.getLastSyncTimestamp('expenseCategories');
  if (localExpCatTs && (!lastExpCatSync || localExpCatTs > lastExpCatSync)) {
    const _ec = await sqliteStore.get('expense_categories');
    configBatch.set(
      userRef.collection('expenseCategories').doc('categories'),
      sanitizeForFirestore({ categories: _ec || [] }),
      { merge: true }
    );
    operationCount++;
    collectionsUploaded.add('expenseCategories');
  }

  if (operationCount > 0) batches.push(currentBatch);
  for (const batch of batches) {
    await batch.commit();
  }

  for (const col of collectionsUploaded) {
    await DeltaSync.setLastSyncTimestamp(col);
    DeltaSync.clearDirty(col);
  }
  for (const col of Object.keys(collections)) {
    if (DeltaSync.isDirty(col) && !collectionsUploaded.has(col)) {
      DeltaSync.clearDirty(col);
    }
  }

  const configItemCount = (collectionsUploaded.has('factorySettings') ? 1 : 0)
    + (collectionsUploaded.has('settings') ? 1 : 0)
    + (collectionsUploaded.has('expenseCategories') ? 1 : 0);
  const totalUploaded = totalItemsToWrite + configItemCount;
  if (totalUploaded > 0 && typeof emitSyncUpdate === 'function') {
    const uploadedCollections = Array.from(collectionsUploaded).reduce((acc, col) => { acc[col] = null; return acc; }, {});
    await emitSyncUpdate(uploadedCollections).catch(() => {});
  }
  return totalUploaded;
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
    if (typeof initDeviceShard === 'function') {
      await initDeviceShard().catch(() => {});
    }
    const userRef = firebaseDB.collection('users').doc(currentUser.uid);

    const userType = await _detectUserType(userRef);

    if (userType === 'new') {
      await initializeFirestoreStructure(true);
      await sqliteStore.set('firestore_initialized', true);
      if (!silent) showToast('Your account is ready!', 'success');
      return;
    }

    const cloudData = await _downloadDeltas(userRef, userType);
    const totalCloudChanges = Object.values(cloudData.data).reduce((s, a) => s + (a?.length || 0), 0);

    if (userType === 'existing' && typeof UUIDSyncRegistry !== 'undefined') {
      UUIDSyncRegistry.setNewDeviceRestore(true);
    }
    await _mergeAndPersist(cloudData);
    if (userType === 'existing' && typeof UUIDSyncRegistry !== 'undefined') {
      UUIDSyncRegistry.setNewDeviceRestore(false);
    }

    await _syncSettings(cloudData);

    if (userType === 'existing') {
      await sqliteStore.set('firestore_initialized', true);
      await sqliteStore.set('user_state', { type: 'existing', hasRealData: true, lastChecked: Date.now(), initialized: true, restoredItems: totalCloudChanges });

      const totalItemsToWrite = await _uploadChanges(userRef);

      if (typeof refreshAllDisplays === 'function') await refreshAllDisplays().catch(() => {});
      if (!silent) {
        const msg = totalItemsToWrite > 0
          ? `Restored ${totalCloudChanges} records, uploaded ${totalItemsToWrite} local changes`
          : `Data fully restored — ${totalCloudChanges} records downloaded`;
        showToast(msg, 'success');
        if (typeof closeDataMenu === 'function') closeDataMenu();
      }
      setTimeout(() => {
        _syncQueue.run(async () => {
          try { if (typeof validateAllDataOnStartup === 'function') await validateAllDataOnStartup(); }
          catch (e) { console.error('Data validation error:', _safeErr(e)); }
        });
      }, 2000);
      return;
    }

    const totalItemsToWrite = await _uploadChanges(userRef);

    if (typeof refreshAllDisplays === 'function') await refreshAllDisplays().catch(() => {});

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

    setTimeout(() => {
      _syncQueue.run(async () => {
        try { if (typeof validateAllDataOnStartup === 'function') await validateAllDataOnStartup(); }
        catch (e) { console.error('Data validation error:', _safeErr(e)); }
      });
    }, 2000);

    return { down: totalCloudChanges, up: totalItemsToWrite };

  } catch (e) {
    console.error('[OneClickSync] error:', _safeErr(e));
    if (!silent) showToast(' Sync error - will retry automatically', 'warning');
    return { down: 0, up: 0, error: true };
  } finally {
    isSyncing = false;
    if (!silent && btn) btn.innerHTML = originalText;
    _flushSyncLockQueue().catch(err => console.warn('[SyncLock] Flush error', _safeErr(err)));
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

    await sqliteStore.init();
    await sqliteStore.flush();

    if (typeof initDeviceShard === 'function') {
      await initDeviceShard().catch(() => {});
    }

    const userRef = firebaseDB.collection('users').doc(currentUser.uid);
    const operationCount = await _uploadChanges(userRef);

    const deletionRecordsLocal = await sqliteStore.get('deletion_records', []);
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
      await sqliteStore.set('deletion_records', deletionRecordsLocal);
    }

    const now = new Date().toISOString();
    await sqliteStore.set('last_synced', now);

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
    await sqliteStore.init();
    await sqliteStore.flush();

    const userRef = firebaseDB.collection('users').doc(currentUser.uid);
    const pullUserType = await _detectUserType(userRef);
    const cloudData = await _downloadDeltas(userRef, pullUserType === 'new' ? 'existing' : pullUserType);

    const hasData = Object.values(cloudData.data).some(a => a.length > 0)
      || (cloudData.settings && cloudData.settings.exists)
      || (cloudData.factorySettings && cloudData.factorySettings.exists);
    if (!hasData) {
      if (!silent) showToast('Cloud is empty. Nothing to download.', 'info');
      return;
    }

    if (typeof UUIDSyncRegistry !== 'undefined') UUIDSyncRegistry.setNewDeviceRestore(true);
    await _mergeAndPersist(cloudData);
    if (typeof UUIDSyncRegistry !== 'undefined') UUIDSyncRegistry.setNewDeviceRestore(false);
    await _syncSettings(cloudData);
    await sqliteStore.set('firestore_initialized', true);

    if (forceDownload && cloudData.factorySettings && cloudData.factorySettings.exists) {
      const fsData = cloudData.factorySettings.data();
      if (fsData && typeof fsData === 'object') {
        if (fsData.unit_tracking && ('standard' in fsData.unit_tracking) && ('asaan' in fsData.unit_tracking)) {
          const vt = (d) => ({ produced: parseFloat(d?.produced) || 0, consumed: parseFloat(d?.consumed) || 0, available: parseFloat(d?.available) || 0, unitCostHistory: Array.isArray(d?.unitCostHistory) ? d.unitCostHistory : [] });
          const newTracking = { standard: vt(fsData.unit_tracking.standard), asaan: vt(fsData.unit_tracking.asaan) };
          await sqliteStore.setBatch([['factory_unit_tracking', newTracking], ['factory_unit_tracking_timestamp', fsData.unit_tracking_timestamp || Date.now()]]);
          refreshFactorySettingsOverlay();
        }
      }
    }

    const _settingsBatch = await sqliteStore.getBatch([
      'factory_default_formulas', 'factory_additional_costs',
      'factory_cost_adjustment_factor', 'factory_sale_prices', 'factory_unit_tracking',
    ]);
    const _fdf  = _settingsBatch.get('factory_default_formulas');
    const _fac  = _settingsBatch.get('factory_additional_costs');
    const _fcaf = _settingsBatch.get('factory_cost_adjustment_factor');
    const _fsp  = _settingsBatch.get('factory_sale_prices');
    const _fut  = _settingsBatch.get('factory_unit_tracking');
    const _ensureBothStores = (obj, dflt) => {
      if (!obj || typeof obj !== 'object') return dflt;
      return {
        standard: obj.standard !== undefined ? obj.standard : dflt.standard,
        asaan:    obj.asaan    !== undefined ? obj.asaan    : dflt.asaan,
      };
    };
    await sqliteStore.setBatch([
      ['factory_default_formulas',       _ensureBothStores(_fdf,  { standard: [], asaan: [] })],
      ['factory_additional_costs',       _ensureBothStores(_fac,  { standard: 0,  asaan: 0  })],
      ['factory_cost_adjustment_factor', _ensureBothStores(_fcaf, { standard: 1,  asaan: 1  })],
      ['factory_sale_prices',            _ensureBothStores(_fsp,  { standard: 0,  asaan: 0  })],
      ['factory_unit_tracking',          _ensureBothStores(_fut,  { standard: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] }, asaan: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] } })],
      ['naswar_default_settings', defaultSettings],
      ['appMode', appMode],
      ['current_rep_profile', currentRepProfile],
    ]);

    const statsCols = ['production','sales','rep_sales','rep_customers','calculator_history',
      'transactions','entities','inventory','factory_history','returns','expenses','sales_customers'];
    void Promise.all(statsCols.map(c => DeltaSync.updateSyncStats(c))).catch(() => {});

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

async function showSyncHealthPanel() {
  verifyDeltaSyncSystem().then(async results => {
    const lastSync = (await sqliteStore.get('last_synced', null)) || 'Unknown';
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
  }).catch(e => console.warn('[SyncHealth]', _safeErr(e)));
}
window.showSyncHealthPanel = showSyncHealthPanel;
let seamlessBackupTimer = null;
const SEAMLESS_DELAY_MS = 5000;
async function triggerSeamlessBackup() {
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
const AUTO_BACKUP_INTERVAL = 900000;

async function scheduleAutoBackup() {
clearAutoBackup();
if (!currentUser) return;
autoSaveTimer = setInterval(async () => {
if (!currentUser) { clearAutoBackup(); return; }
try {
const cols = ['production','sales','rep_sales','transactions','expenses','returns','calculator_history'];
const hasChanges = await DeltaSync.hasAnyChanges(cols);
if (!hasChanges) return;
await performOneClickSync(true);
} catch (e) { console.warn('[AutoBackup]', _safeErr(e)); }
}, AUTO_BACKUP_INTERVAL);
}
function clearAutoBackup() {
if (autoSaveTimer) {
clearInterval(autoSaveTimer);
autoSaveTimer = null;
}
}
async function wakeUpDatabaseAndSync() {
  showToast('Connecting to cloud...', 'info');
  if (!firebaseDB || !currentUser) {
    setTimeout(async () => {
      if (firebaseDB && currentUser) await pullDataFromCloud(false);
    }, 5000);
    return;
  }
  await pullDataFromCloud(false);
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
animation: auth-fade-in 0.25s ease;
`;

if (!document.getElementById('auth-overlay-style')) {
const s = document.createElement('style');
s.id = 'auth-overlay-style';
s.textContent = '@keyframes auth-fade-in{from{opacity:0;transform:scale(1.015)}to{opacity:1;transform:scale(1)}}@keyframes auth-fade-out{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(0.97)}}' +
'body.dark-mode #auth-google-btn{background:#303030!important;border-color:#555!important;color:#e8eaed!important;}' +
'body.dark-mode #auth-google-btn:hover{border-color:#8ab4f8!important;box-shadow:0 2px 8px rgba(138,180,248,0.22)!important;}' +
'#auth-google-btn:disabled{cursor:not-allowed;}';
document.head.appendChild(s);
}
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
<p style="color: var(--text-muted); margin-bottom: 22px; font-size: 0.82rem; line-height: 1.5;">
Your account protects your data with enterprise-grade encryption.
</p>

<button id="auth-google-btn" type="button" onclick="_handleGoogleBtnClick()" aria-label="Sign in with Google" style="
  display:inline-flex;align-items:center;justify-content:center;
  width:52px;height:52px;border-radius:50%;
  border:1.5px solid #dadce0;
  background:#fff;
  cursor:pointer;
  box-shadow:0 1px 3px rgba(0,0,0,0.10);
  margin-bottom:16px;
  transition:box-shadow 0.15s,border-color 0.15s,transform 0.12s,opacity 0.15s;
  -webkit-tap-highlight-color:transparent;
  padding:0;
" onmouseover="this.style.boxShadow='0 3px 10px rgba(66,133,244,0.28)';this.style.borderColor='#4285F4';this.style.transform='scale(1.08)';"
   onmouseout="this.style.boxShadow='0 1px 3px rgba(0,0,0,0.10)';this.style.borderColor='#dadce0';this.style.transform='scale(1)';">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="26" height="26">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.36-8.16 2.36-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>
</button>
<div id="gsi-btn-container" style="display:none;"></div>

<div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;">
  <div style="flex:1;height:1px;background:var(--glass-border);"></div>
  <span style="font-size:0.72rem;color:var(--text-muted);font-weight:500;white-space:nowrap;">or sign in with email</span>
  <div style="flex:1;height:1px;background:var(--glass-border);"></div>
</div>

<form id="auth-form" style="display: flex; flex-direction: column; gap: 13px;">
<input type="email" id="auth-email" placeholder="Email Address" required autocomplete="username"
style="width: 100%; padding: 13px; background: var(--input-bg); border: 1px solid var(--glass-border); border-radius: 12px; box-sizing: border-box; color: var(--text-main); font-size:0.9rem;">
<input type="password" id="auth-password" placeholder="Password" required autocomplete="current-password"
style="width: 100%; padding: 13px; background: var(--input-bg); border: 1px solid var(--glass-border); border-radius: 12px; box-sizing: border-box; color: var(--text-main); font-size:0.9rem;">
<div style="margin-top: 8px;">
<button type="submit" class="btn btn-main" style="
width:100%; padding: 13px; font-size: 1rem; border-radius: 12px;
background-color: #1de9b6 !important;
background-image: none !important;
color: #003d2e !important;
font-weight:700;
">
Sign In
</button>
</div>
<p style="font-size:0.72rem;color:var(--text-muted);margin-top:14px;line-height:1.5;">
Don\'t have access? <strong style="color:var(--text-main);">Contact the administrator</strong> to have your account added.
</p>
</form>
<div id="auth-message" style="font-size: 0.8rem; margin-top: 15px; min-height: 20px;"></div>
<div style="margin-top:16px;padding:10px 14px;background:var(--input-bg);border-radius:10px;border:1px solid var(--glass-border);">
<div style="font-size:0.63rem;color:var(--text-muted);line-height:1.8;display:flex;flex-wrap:wrap;justify-content:center;gap:0 10px;">
  <span><strong style="color:var(--text-main)">AES-256-GCM</strong> encryption</span>
  <span style="opacity:0.35;">·</span>
  <span><strong style="color:var(--text-main)">PBKDF2-SHA-512</strong> · 210 000 iters</span>
  <span style="opacity:0.35;">·</span>
  <span><strong style="color:var(--text-main)">UID-bound</strong> keys</span>
  <span style="opacity:0.35;">·</span>
  <span><strong style="color:var(--text-main)">Per-user</strong> random salt</span>
  <span style="opacity:0.35;">·</span>
  <span>Crypto <strong style="color:var(--text-main)">v4</strong></span>
</div>
</div>
</div>
`;
document.body.appendChild(overlay);

_initGSIInOverlay();
const form = document.getElementById('auth-form');
if(form) form.addEventListener('submit', handleSignIn);

OfflineAuth.getSavedEmail().then(email => {
if (email) {
const emailInput = document.getElementById('auth-email');
if (emailInput) { emailInput.value = email; }
}
}).catch(() => {});
}
function showAuthOverlay() {
const existing = document.getElementById('auth-overlay');
if (existing) existing.remove();
createAuthOverlay();
document.body.style.overflow = 'hidden';
}
function hideAuthOverlay() {
const overlay = document.getElementById('auth-overlay');
if (overlay) {
overlay.style.animation = 'auth-fade-out 0.22s ease forwards';
setTimeout(() => {
  if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
}, 230);
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

const GOOGLE_CLIENT_ID = window._GOOGLE_CLIENT_ID || '';

async function _checkUserApproved(uid, email) {
if (!navigator.onLine) return { denied: false };
try {
const db = (typeof firebaseDB !== 'undefined' && firebaseDB) ? firebaseDB : firebase.firestore();
const snap = await db.collection('users').doc(uid).get();
if (!snap.exists) {
await firebase.auth().signOut().catch(() => {});
return { denied: true, reason: `Access denied. Your account (${email}) is not registered in this system. Contact the administrator.` };
}
const data = snap.data() || {};
if (data.approved === false) {
await firebase.auth().signOut().catch(() => {});
return { denied: true, reason: `Access denied. Your account has been suspended. Contact the administrator.` };
}
return { denied: false, role: data.role || 'user', displayName: data.displayName || '' };
} catch(e) {
if (e.code === 'permission-denied') {
await firebase.auth().signOut().catch(() => {});
return { denied: true, reason: 'Access denied. You do not have permission to use this app.' };
}
return { denied: false };
}
}

async function _applyGoogleUser(user) {
const check = await _checkUserApproved(user.uid, user.email);
if (check.denied) {
const messageDiv = document.getElementById('auth-message');
const btn = document.getElementById('auth-google-btn');
if (messageDiv) { messageDiv.textContent = check.reason; messageDiv.style.color = 'var(--danger)'; }
if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
return;
}
const _googleKeyMaterial = user.uid;
currentUser = {
id: user.uid, uid: user.uid,
email: user.email, displayName: check.displayName || user.displayName || '',
photoURL: user.photoURL || null, googleAuth: true,
role: check.role || 'user'
};
sqliteStore.setUserPrefix(user.uid);
await SQLiteCrypto.setSessionKey(user.email, _googleKeyMaterial, user.uid);
await SQLiteCrypto.sessionSet('login', {
uid: user.uid, email: user.email,
displayName: user.displayName || '', googleAuth: true,
lastLogin: new Date().toISOString()
});
try { localStorage.setItem('_gznd_session_active', '1'); sessionStorage.setItem('_gznd_session_active', '1'); localStorage.setItem('_gznd_session_start', String(Date.now())); } catch(e) {}
sqliteStore.set('session_start', Date.now()).catch(() => {});
if (typeof database !== 'undefined' && database) {
try {
const userRef = firebaseDB.collection('users').doc(user.uid);
const snap = await userRef.get();
if (!snap.exists) {
await userRef.set({ email: user.email, displayName: user.displayName || '', createdAt: Date.now(), role: 'user', authProvider: 'google' });
} else {
const providers = (user.providerData || []).map(p => p.providerId).filter(Boolean);
await userRef.set({ authProviders: providers, lastLoginAt: Date.now() }, { merge: true });
}
} catch(e) { console.warn('Google auth: Firestore user-doc write failed', _safeErr(e)); }
}
await _linkPasswordAfterGoogleSignIn(user);
try { if (typeof loadAllData === 'function') await loadAllData(); } catch(e) { console.warn('Post-Google-login data load failed:', _safeErr(e)); }

hideAuthOverlay();
setTimeout(() => {
if (typeof refreshAllDisplays === 'function') refreshAllDisplays().catch(() => {});
if (typeof performOneClickSync === 'function') performOneClickSync();
}, 300);
}

async function _checkGoogleRedirectResult() {}

let _pendingLinkEmail    = null;
let _pendingLinkPassword = null;

async function _linkPasswordAfterGoogleSignIn(user) {
if (!_pendingLinkEmail || !_pendingLinkPassword) return;
if (_pendingLinkEmail.toLowerCase() !== (user.email || '').toLowerCase()) {
_pendingLinkEmail = null;
_pendingLinkPassword = null;
return;
}
const pendingEmail    = _pendingLinkEmail;
const pendingPassword = _pendingLinkPassword;
_pendingLinkEmail    = null;
_pendingLinkPassword = null;
try {
const emailCred = firebase.auth.EmailAuthProvider.credential(pendingEmail, pendingPassword);
await user.linkWithCredential(emailCred);
await OfflineAuth.saveCredentials(pendingEmail, pendingPassword);
showToast('Password linked — you can now sign in with either method.', 'success', 4000);
} catch(e) {
if (e.code === 'auth/credential-already-in-use' || e.code === 'auth/email-already-in-use') {
showToast('Password already linked to this account.', 'info', 3000);
} else if (e.code === 'auth/weak-password') {
showToast('Password too weak to link — use a stronger password next time.', 'warning', 4000);
} else {
console.warn('Password link failed (non-critical):', _safeErr(e));
}
}
}

async function _onGoogleCredential(response) {
const messageDiv = document.getElementById('auth-message');
if (!response || !response.credential) {
if (messageDiv) { messageDiv.textContent = 'Google sign-in cancelled.'; messageDiv.style.color = 'var(--danger)'; }
return;
}

if (messageDiv) { messageDiv.textContent = 'Signing in…'; messageDiv.style.color = 'var(--accent)'; }

const container = document.getElementById('gsi-btn-container');
if (container) container.style.pointerEvents = 'none';
try {
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const _gAuth = (typeof auth !== 'undefined' && auth) ? auth : firebase.auth();
const credential = firebase.auth.GoogleAuthProvider.credential(response.credential);
const result = await _gAuth.signInWithCredential(credential);
if (messageDiv) { messageDiv.textContent = 'Signed in! Opening app…'; messageDiv.style.color = 'var(--accent-emerald)'; }
await _applyGoogleUser(result.user);
} catch(error) {
console.error('Google credential sign-in failed:', _safeErr(error));
if (error.code === 'auth/account-exists-with-different-credential') {
const _existingEmail = error.email || (error.customData && error.customData.email) || '';
const _pendingGCred  = error.credential || firebase.auth.GoogleAuthProvider.credential(response.credential);
if (_existingEmail) {
if (messageDiv) {
messageDiv.textContent = 'This Google account\'s email already has a password account. Enter your password below first — Google will link automatically on sign-in.';
messageDiv.style.color = 'var(--warning)';
const emailInput = document.getElementById('auth-email');
if (emailInput) emailInput.value = _existingEmail;
}
if (container) container.style.pointerEvents = '';
const btn = document.getElementById('auth-google-btn');
if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
return;
}
}
let msg = 'Google sign-in failed.';
if (error.code === 'auth/invalid-credential' || error.code === 'auth/invalid-id-token')
  msg = 'Google token invalid. Please try again.';
else if (error.code === 'auth/operation-not-allowed')
  msg = 'Google sign-in is not enabled. Contact the administrator.';
else if (error.code === 'auth/account-exists-with-different-credential')
  msg = 'This email is registered with a different sign-in method.';
else if (error.code === 'auth/network-request-failed')
  msg = 'Network error. Check your connection and try again.';
else msg = 'Google sign-in failed: ' + (error.message || error.code || '');
if (messageDiv) { messageDiv.textContent = msg; messageDiv.style.color = 'var(--danger)'; }
if (container) container.style.pointerEvents = '';
const btn = document.getElementById('auth-google-btn');
if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
}
}

window._onGoogleCredential = _onGoogleCredential;

let _gsiInitialized = false;

function _initGSIInOverlay() {
if (_gsiInitialized) return;
if (typeof google === 'undefined' || !google.accounts || !google.accounts.id) {
setTimeout(_initGSIInOverlay, 300);
return;
}
if (!GOOGLE_CLIENT_ID) return;
google.accounts.id.initialize({
client_id:             GOOGLE_CLIENT_ID,
callback:              window._onGoogleCredential,
auto_select:           false,
cancel_on_tap_outside: true,
use_fedcm_for_prompt:  true,
itp_support:           true,
});
_gsiInitialized = true;
}

function _handleGoogleBtnClick() {
const btn = document.getElementById('auth-google-btn');
const msg = document.getElementById('auth-message');
if (!navigator.onLine) {
if (msg) { msg.textContent = 'Google sign-in requires internet.'; msg.style.color = 'var(--danger)'; }
return;
}
if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
if (msg) { msg.textContent = ''; }

function doPrompt() {
if (typeof google === 'undefined' || !google.accounts || !google.accounts.id) {
  setTimeout(doPrompt, 300);
  return;
}
if (!_gsiInitialized) _initGSIInOverlay();
google.accounts.id.prompt(notification => {
  const mom = notification.getMomentType ? notification.getMomentType() : '';
  if (notification.isSkippedMoment && notification.isSkippedMoment()) {
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    if (msg) {
      msg.style.color = 'var(--text-muted)';
      msg.textContent = 'No Google accounts detected. Sign into Google in your browser first, then try again.';
    }
  } else if (notification.isDismissedMoment && notification.isDismissedMoment()) {
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    if (msg) { msg.textContent = ''; }
  }
});
}
doPrompt();
}
window._handleGoogleBtnClick = _handleGoogleBtnClick;

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
try { firebase.initializeApp(firebaseConfig); } catch(initErr) { console.warn('Firebase init on sign-in:', _safeErr(initErr)); }
}
if (!auth && typeof firebase !== 'undefined' && firebase.apps.length) {
try {
auth = firebase.auth();
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
} catch(authInitErr) { console.warn('Auth init on sign-in:', _safeErr(authInitErr)); }
}
try {
if (typeof firebase !== 'undefined' && firebase.apps.length && navigator.onLine) {
const firebaseAuth = auth || firebase.auth();
const _signInCred = await firebaseAuth.signInWithEmailAndPassword(email, password);
const _wlCheck = await _checkUserApproved(_signInCred.user.uid, email);
if (_wlCheck.denied) {
messageDiv.textContent = _wlCheck.reason;
messageDiv.style.color = 'var(--danger)';
return;
}
await OfflineAuth.saveCredentials(email, password);
sqliteStore.setUserPrefix(_signInCred.user.uid);
const _linkedProviders = (_signInCred.user.providerData || []).map(p => p && p.providerId).filter(Boolean);
const _hasGoogleLinked = _linkedProviders.includes('google.com');
const _encKeyMaterial  = _hasGoogleLinked ? _signInCred.user.uid : password;
await SQLiteCrypto.setSessionKey(email, _encKeyMaterial, _signInCred.user.uid);
sqliteStore.reEncryptAll().catch(() => {});
await SQLiteCrypto.sessionSet('login', {
  uid: _signInCred.user.uid,
  email,
  displayName: _signInCred.user.displayName || '',
  lastLogin: new Date().toISOString()
});
try { localStorage.setItem('_gznd_session_active', '1'); sessionStorage.setItem('_gznd_session_active', '1'); localStorage.setItem('_gznd_session_start', String(Date.now())); } catch(e) {}
sqliteStore.set('session_start', Date.now()).catch(() => {});
LoginRateLimiter.recordSuccess();
messageDiv.textContent = 'Success! Loading...';
messageDiv.style.color = 'var(--accent-emerald)';
try {
  if (typeof loadAllData === 'function') await loadAllData();
} catch(e) { console.warn('Post-login data reload failed:', _safeErr(e)); }
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
sqliteStore.setUserPrefix(currentUser.uid);
await SQLiteCrypto.setSessionKey(email, password, currentUser.uid);
sqliteStore.reEncryptAll().catch(() => {});
try { localStorage.setItem('_gznd_session_active', '1'); sessionStorage.setItem('_gznd_session_active', '1'); } catch(e) {}
LoginRateLimiter.recordSuccess();
messageDiv.textContent = '✓ Offline Login Successful';
messageDiv.style.color = 'var(--accent-emerald)';
try {
  if (typeof loadAllData === 'function') await loadAllData();
} catch(e) { console.warn('Post-offline-login data reload failed:', _safeErr(e)); }
setTimeout(() => {
hideAuthOverlay();
if (typeof refreshAllDisplays === 'function') refreshAllDisplays();
}, 300);
}
} catch (error) {
console.error('Sign in failed.', _safeErr(error));
let errorMessage = 'Sign in failed. ';
if (error.code === 'auth/invalid-email') errorMessage = 'Invalid email address.';
else if (error.code === 'auth/user-disabled') errorMessage = 'Account disabled. Contact the administrator.';
else if (error.code === 'auth/user-not-found') errorMessage = 'No account found for this email.';
else if (error.code === 'auth/wrong-password') errorMessage = 'Incorrect password.';
else if (error.code === 'auth/invalid-credential' || error.code === 'auth/invalid-login-credentials') {
const _methods = await firebase.auth().fetchSignInMethodsForEmail(email).catch(() => []);
if (_methods.includes('google.com') && !_methods.includes('password')) {
messageDiv.textContent = 'This account uses Google sign-in. Tap the Google button above to sign in — your password will also be linked.';
messageDiv.style.color = 'var(--warning)';
_pendingLinkEmail    = email;
_pendingLinkPassword = password;
LoginRateLimiter.recordSuccess();
return;
} else {
errorMessage = 'Incorrect email or password.';
}
}
else if (error.code === 'auth/too-many-requests') errorMessage = 'Too many attempts. Please wait a moment and try again.';
else if (error.code === 'auth/network-request-failed') {
const valid = await OfflineAuth.verifyCredentials(email, password).catch(() => false);
if (valid) {
currentUser = { id: email.replace(/[^a-zA-Z0-9]/g, '_'), uid: email.replace(/[^a-zA-Z0-9]/g, '_'), email, offlineMode: true };
sqliteStore.setUserPrefix(currentUser.uid);
await SQLiteCrypto.setSessionKey(email, password, currentUser.uid);
try { localStorage.setItem('_gznd_session_active', '1'); sessionStorage.setItem('_gznd_session_active', '1'); } catch(e) {}
try { if (typeof loadAllData === 'function') await loadAllData(); } catch(e) {}
messageDiv.textContent = '✓ Offline Login (Network unavailable)';
messageDiv.style.color = 'var(--accent-emerald)';
setTimeout(() => { hideAuthOverlay(); if(typeof refreshAllDisplays==='function')refreshAllDisplays(); }, 300);
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
async function _isAdminUser() {
if (!currentUser || !firebaseDB) return false;
try {
const snap = await firebaseDB.collection('users').doc(currentUser.uid).get();
return snap.exists && snap.data().role === 'admin';
} catch(_) { return false; }
}

function _accountsIndexRef() {
return firebaseDB.collection('users').doc(currentUser.uid)
  .collection('settings').doc('accounts_index');
}

async function _readAccountsIndex() {
const snap = await _accountsIndexRef().get();
if (!snap.exists) return [];
const data = snap.data() || {};
return Array.isArray(data.accounts) ? data.accounts : [];
}

async function _writeAccountsIndex(accounts) {
await _accountsIndexRef().set({ accounts, updatedAt: Date.now() }, { merge: false });
}

let _newAccountRole = 'user';
function setNewAccountRole(role) {
_newAccountRole = role;
const userBtn  = document.getElementById('acct-role-user');
const adminBtn = document.getElementById('acct-role-admin');
if (userBtn)  userBtn.classList.toggle('active',  role === 'user');
if (adminBtn) adminBtn.classList.toggle('active', role === 'admin');
}

async function adminAddAccount() {
const emailEl = document.getElementById('acct-new-email');
const passEl  = document.getElementById('acct-new-password');
const msgEl   = document.getElementById('acct-add-msg');
const btn     = document.getElementById('acct-add-btn');
if (!emailEl || !passEl || !msgEl) return;
const email    = emailEl.value.trim();
const password = passEl.value;
const role     = _newAccountRole || 'user';
const setMsg = (txt, color) => { if (msgEl) { msgEl.textContent = txt; msgEl.style.color = color || 'var(--text-muted)'; } };
if (!email)              { setMsg('Enter an email address.', 'var(--danger)'); return; }
if (password.length < 8) { setMsg('Password must be at least 8 characters.', 'var(--danger)'); return; }
if (!navigator.onLine)   { setMsg('Internet required to create accounts.', 'var(--danger)'); return; }
if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }
setMsg('Creating account...', 'var(--accent)');
try {
const secondaryApp = firebase.apps.find(a => a.name === '_adminCreate') ||
  firebase.initializeApp(firebaseConfig, '_adminCreate');
const secondaryAuth = secondaryApp.auth();
const cred = await secondaryAuth.createUserWithEmailAndPassword(email, password);
const newUid = cred.user.uid;
await secondaryAuth.signOut();
await firebaseDB.collection('users').doc(newUid).set({
  email, role, approved: true,
  createdAt: Date.now(), createdBy: currentUser.email
});
const entry = { uid: newUid, email, role, approved: true, createdAt: Date.now(), createdBy: currentUser.email };
const existing = await _readAccountsIndex();
await _writeAccountsIndex([...existing.filter(a => a.uid !== newUid), entry]);
emailEl.value = '';
passEl.value  = '';
_newAccountRole = 'user';
setNewAccountRole('user');
setMsg('Account created successfully.', 'var(--accent-emerald)');
showToast('Account created: ' + email, 'success');
await loadAccountsList();
} catch (err) {
const code = err.code || '';
if (code === 'auth/email-already-in-use') setMsg('This email is already registered.', 'var(--danger)');
else if (code === 'auth/invalid-email')   setMsg('Invalid email address.', 'var(--danger)');
else if (code === 'auth/weak-password')   setMsg('Password too weak.', 'var(--danger)');
else setMsg('Failed: ' + (err.message || code), 'var(--danger)');
console.error('adminAddAccount error:', _safeErr(err));
} finally {
if (btn) { btn.disabled = false; btn.textContent = 'Add Account'; }
}
}

async function loadAccountsList() {
const listEl = document.getElementById('manage-accounts-list');
if (!listEl) return;
if (!navigator.onLine) {
listEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:16px;">Internet required to load accounts.</div>';
return;
}
listEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:16px;">Loading...</div>';
try {
const meSnap = await firebaseDB.collection('users').doc(currentUser.uid).get();
const meData = meSnap.exists ? meSnap.data() : {};
const meEntry = { uid: currentUser.uid, email: currentUser.email, approved: meData.approved !== false, ...meData };
const others = await _readAccountsIndex().catch(() => []);
const allAccounts = [meEntry, ...others.filter(a => a.uid !== currentUser.uid)];
allAccounts.sort((a, b) => (a.email || '').localeCompare(b.email || ''));
if (allAccounts.length === 0) {
listEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:16px;">No accounts found.</div>';
return;
}
listEl.innerHTML = allAccounts.map(acct => {
const isMe     = acct.uid === currentUser.uid;
const approved = acct.approved !== false;
const dot = approved
  ? '<span style="width:7px;height:7px;border-radius:50%;background:var(--accent-emerald);display:inline-block;flex-shrink:0;"></span>'
  : '<span style="width:7px;height:7px;border-radius:50%;background:var(--danger);display:inline-block;flex-shrink:0;"></span>';
const actions = isMe
  ? '<span style="font-size:0.65rem;color:var(--text-muted);font-style:italic;">(you)</span>'
  : [
      '<button class="btn-theme" data-uid="' + acct.uid + '" data-approved="' + approved + '" data-email="' + esc(acct.email||'') + '" onclick="adminToggleApproval(this.dataset.uid,this.dataset.email,this.dataset.approved===\'true\')" style="font-size:0.72rem;padding:4px 9px;color:' + (approved ? 'var(--accent-gold)' : 'var(--accent-emerald)') + ';border-color:' + (approved ? 'rgba(251,191,36,0.3)' : 'rgba(29,233,182,0.3)') + ';">' + (approved ? 'Suspend' : 'Reinstate') + '</button>',
      '<button class="btn-theme" data-uid="' + acct.uid + '" data-email="' + esc(acct.email||'') + '" onclick="adminRemoveAccount(this.dataset.uid,this.dataset.email)" style="font-size:0.72rem;padding:4px 9px;color:var(--danger);border-color:rgba(239,68,68,0.3);">Remove</button>'
    ].join('');
return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;background:var(--glass-raised);border:1px solid var(--glass-border);border-radius:var(--radius-lg);margin-bottom:8px;">' +
  '<div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">' + dot +
  '<div style="min-width:0;"><div style="font-size:0.82rem;font-weight:700;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
  esc(acct.email||acct.uid) + (isMe ? ' <em style=\"color:var(--text-muted);font-size:0.65rem;\">(you)</em>' : '') + '</div>' +
  '<div style="display:flex;gap:4px;align-items:center;margin-top:3px;">' +
  (acct.role === 'admin'
    ? '<span style="font-size:0.58rem;padding:2px 7px;border-radius:9999px;background:rgba(29,233,182,0.12);color:var(--accent-emerald);border:1px solid rgba(29,233,182,0.3);font-weight:700;text-transform:uppercase;">admin</span>'
    : '<span style="font-size:0.58rem;padding:2px 7px;border-radius:9999px;background:var(--glass-raised);color:var(--text-muted);border:1px solid var(--glass-border);font-weight:700;text-transform:uppercase;">user</span>') +
  (!approved ? '<span style="font-size:0.58rem;color:var(--danger);font-weight:700;">· Suspended</span>' : '') +
  '</div>' +
  '</div></div><div style="display:flex;gap:5px;flex-shrink:0;">' + actions + '</div></div>';
}).join('');
} catch(err) {
listEl.innerHTML = '<div style="color:var(--danger);font-size:0.8rem;text-align:center;padding:16px;">Failed to load: ' + esc(err.message||'') + '</div>';
console.error('loadAccountsList:', _safeErr(err));
}
}

async function adminToggleApproval(uid, email, currentlyApproved) {
const confirmed = await showGlassConfirm(
(currentlyApproved ? 'Suspend' : 'Reinstate') + ' the account for ' + email + '?' +
(currentlyApproved ? '\n\nThey will be blocked on their next login attempt.' : '\n\nThey will be able to sign in again.'),
{ title: currentlyApproved ? 'Suspend Account' : 'Reinstate Account',
  confirmText: currentlyApproved ? 'Suspend' : 'Reinstate',
  cancelText: 'Cancel', danger: currentlyApproved }
);
if (!confirmed) return;
try {
const _toggleUpdate = { approved: !currentlyApproved };
if (currentlyApproved) {
_toggleUpdate.forceLogout = { at: Date.now(), by: currentUser.email };
}
await firebaseDB.collection('users').doc(uid).update(_toggleUpdate).catch(() => {});
const accounts = await _readAccountsIndex();
const updated = accounts.map(a => a.uid === uid ? { ...a, approved: !currentlyApproved } : a);
await _writeAccountsIndex(updated);
showToast('Account ' + (currentlyApproved ? 'suspended' : 'reinstated') + ': ' + email, currentlyApproved ? 'warning' : 'success');
await loadAccountsList();
} catch(err) {
showToast('Failed to update account.', 'error');
console.error('adminToggleApproval:', _safeErr(err));
}
}

async function adminRemoveAccount(uid, email) {
if (uid === currentUser.uid) { showToast('You cannot remove your own account.', 'warning'); return; }
const confirmed = await showGlassConfirm(
'Remove access for ' + email + '?\n\nThey will be blocked immediately. Their stored data is preserved.\n\nTo fully delete the Firebase Auth account, use Firebase Console.',
{ title: 'Remove Account', confirmText: 'Remove', cancelText: 'Cancel', danger: true }
);
if (!confirmed) return;
try {
await firebaseDB.collection('users').doc(uid).update({ approved: false, removedAt: Date.now(), removedBy: currentUser.email, forceLogout: { at: Date.now(), by: currentUser.email } }).catch(() => {});
const accounts = await _readAccountsIndex();
const updated = accounts.map(a => a.uid === uid ? { ...a, approved: false } : a);
await _writeAccountsIndex(updated);
showToast('Access removed: ' + email, 'success');
await loadAccountsList();
} catch(err) {
showToast('Failed to remove account.', 'error');
console.error('adminRemoveAccount:', _safeErr(err));
}
}

async function handleSignUp() {}
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
SQLiteCrypto.clearSessionKey();
await sqliteStore.clearUserData().catch(() => {});
await OfflineAuth.clearCredentials().catch(() => {});
try {
const keysToRemove = ['_gznd_session_active','_gznd_session_start','_gznd_session_key_backup',
'persistentLogin','_gznd_login_attempts','_gznd_login_lockout'];
keysToRemove.forEach(k => { try { localStorage.removeItem(k); } catch(_) {} });
sessionStorage.clear();
} catch(e) {}
try {

await sqliteStore.clearAll().catch(() => {});

try {
  if (navigator.storage && navigator.storage.getDirectory) {
    const root = await navigator.storage.getDirectory();
    const opfsFiles = [
      'naswar_dealers.sqlite', 'naswar_dealers.sqlite.bak',
      'gznd_auth.json', 'gznd_keystore.json',
      'gznd_entropy.json', 'gznd_session.json'
    ];
    for (const f of opfsFiles) { await root.removeEntry(f).catch(() => {}); }
  }
} catch(_) {}

try {
  const lsCleanup = [
    '_gznd_sqlite_db', '_gznd_sqlite_db_bak',
    '_gznd_auth_data', '_gznd_keystore',
    '_gznd_entropy', '_gznd_session_store'
  ];
  lsCleanup.forEach(k => { try { localStorage.removeItem(k); } catch(_) {} });
} catch(_) {}
} catch(e) {}
sqliteStore.clearUserPrefix();
DeltaSync.clearAllTimestamps().catch(() => {});
if (typeof UUIDSyncRegistry !== 'undefined') UUIDSyncRegistry.clearAll().catch(() => {});
showToast(' Signed out successfully', 'success');
} else {
currentUser = null;
SQLiteCrypto.clearSessionKey();
await sqliteStore.clearUserData().catch(() => {});
await OfflineAuth.clearCredentials().catch(() => {});
try {
const keysToRemove = ['_gznd_session_active','_gznd_session_start','_gznd_session_key_backup',
'persistentLogin','_gznd_login_attempts','_gznd_login_lockout'];
keysToRemove.forEach(k => { try { localStorage.removeItem(k); } catch(_) {} });
sessionStorage.clear();
} catch(e) {}
try {

await sqliteStore.clearAll().catch(() => {});

try {
  if (navigator.storage && navigator.storage.getDirectory) {
    const root = await navigator.storage.getDirectory();
    const opfsFiles = [
      'naswar_dealers.sqlite', 'naswar_dealers.sqlite.bak',
      'gznd_auth.json', 'gznd_keystore.json',
      'gznd_entropy.json', 'gznd_session.json'
    ];
    for (const f of opfsFiles) { await root.removeEntry(f).catch(() => {}); }
  }
} catch(_) {}

try {
  const lsCleanup = [
    '_gznd_sqlite_db', '_gznd_sqlite_db_bak',
    '_gznd_auth_data', '_gznd_keystore',
    '_gznd_entropy', '_gznd_session_store'
  ];
  lsCleanup.forEach(k => { try { localStorage.removeItem(k); } catch(_) {} });
} catch(_) {}
} catch(e) {}
sqliteStore.clearUserPrefix();
DeltaSync.clearAllTimestamps().catch(() => {});
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
