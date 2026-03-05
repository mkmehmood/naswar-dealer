async function saveWithTracking(key, data) {
const keyToCollection = {
'mfg_pro_pkr': 'production',
'customer_sales': 'sales',
'noman_history': 'calculator_history',
'rep_sales': 'rep_sales',
'rep_customers': 'rep_customers',
'sales_customers': 'sales_customers',
'payment_transactions': 'transactions',
'payment_entities': 'entities',
'factory_inventory_data': 'inventory',
'factory_production_history': 'factory_history',
'expenses': 'expenses',
'stock_returns': 'returns'
};
const result = await idb.set(key, data);
const collectionName = keyToCollection[key];
if (collectionName) {
  DeltaSync.trackCollection(collectionName);
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
const collectionName = getFirestoreCollection(idbKey);
if (!collectionName) {
return false;
}
if (window._firestoreNetworkDisabled || !navigator.onLine) {
if (typeof OfflineQueue !== 'undefined') {
const now = Date.now();
const recordWithTimestamps = {
...record,
updatedAt: record.isMerged ? record.updatedAt : now,
syncedAt: new Date().toISOString()
};
if (!recordWithTimestamps.createdAt) {
recordWithTimestamps.createdAt = now;
}
await OfflineQueue.add({
action: 'set',
collection: collectionName,
docId: String(record.id),
data: sanitizeForFirestore(recordWithTimestamps)
});
}
return true;
}
try {
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
const docRef = userRef.collection(collectionName).doc(String(record.id));
const now = Date.now();
const recordWithTimestamps = {
...record,
updatedAt: record.isMerged ? record.updatedAt : now,
syncedAt: new Date().toISOString()
};
if (!recordWithTimestamps.createdAt) {
recordWithTimestamps.createdAt = now;
}
await docRef.set(sanitizeForFirestore(recordWithTimestamps), { merge: true });
trackFirestoreWrite(1);
await DeltaSync.setLastSyncTimestamp(collectionName);
return true;
} catch (error) {
if (typeof OfflineQueue !== 'undefined') {
const now = Date.now();
const recordWithTimestamps = {
...record,
updatedAt: record.isMerged ? record.updatedAt : now,
syncedAt: new Date().toISOString()
};
if (!recordWithTimestamps.createdAt) recordWithTimestamps.createdAt = now;
await OfflineQueue.add({
action: 'set',
collection: collectionName,
docId: String(record.id),
data: sanitizeForFirestore(recordWithTimestamps)
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
expiresAt: firebase.firestore.Timestamp.fromMillis(Date.now() + (90 * 24 * 60 * 60 * 1000))
});
await batch.commit();
trackFirestoreWrite(2);
return true;
} catch (error) {
console.error('deleteRecordFromFirestore error:', error);
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
// Save to local IndexedDB immediately — UI unblocks here
await saveWithTracking(idbKey, dataArray);
// Fire Firestore sync in the background without blocking the caller
if (specificRecord && specificRecord.id) {
  const collectionName = getFirestoreCollection(idbKey);
  if (collectionName) DeltaSync.trackId(collectionName, specificRecord.id);
  Promise.resolve().then(() => saveRecordToFirestore(idbKey, specificRecord)).catch(() => {});
}
triggerAutoSync();
return true;
}
async function unifiedDelete(idbKey, dataArray, deletedRecordId) {
// Save updated local array immediately — UI unblocks here
await saveWithTracking(idbKey, dataArray);
// Fire Firestore delete + deletion log in the background without blocking the caller
const collectionName = getFirestoreCollection(idbKey);
Promise.resolve().then(async () => {
  try {
    if (collectionName) await registerDeletion(deletedRecordId, collectionName);
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
showToast('Delta sync reset - next sync will download all data', 'info');
}
window.verifyDeltaSyncSystem = verifyDeltaSyncSystem;
window.resetDeltaSync = resetDeltaSync;
window.getFirestoreCollection = getFirestoreCollection;
window.getIndexedDBKey = getIndexedDBKey;
window.saveRecordToFirestore = saveRecordToFirestore;
window.deleteRecordFromFirestore = deleteRecordFromFirestore;
window.unifiedSave = unifiedSave;
window.unifiedDelete = unifiedDelete;
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
try {
const savedLogin = localStorage.getItem('persistentLogin');
const isRestoredSession = savedLogin && JSON.parse(savedLogin).uid === user.uid;
localStorage.setItem('persistentLogin', JSON.stringify({
uid: user.uid,
email: user.email,
displayName: user.displayName,
lastLogin: new Date().toISOString()
}));
} catch (e) {
console.warn('Failed to save persistent login:', e);
}
hideAuthOverlay();
showToast(`Welcome back, ${user.email.split('@')[0]}`, 'success');
try { sessionStorage.setItem('_gznd_session_active', '1'); } catch(e) {}
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
showAuthOverlay();
return;
}

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
// Refresh all device ID storage layers on every successful login
// so the ID is preserved even if some layers were cleared
if (typeof refreshDeviceIdAnchors === 'function') {
setTimeout(() => { refreshDeviceIdAnchors().catch(() => {}); }, 1500);
}
setTimeout(async () => {
try {
await restoreDeviceModeOnLogin(user.uid);
} catch (error) {
console.error('Could not restore device mode:', error);
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
localStorage.removeItem('persistentLogin');
} catch (e) {
console.error('Failed to clear persistent login:', e);
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
console.error('Sync failed. Check your connection.', error);
showToast('Sync failed. Check your connection.', 'error');
if (indicator) {
indicator.title = 'Connection Failed';
indicator.className = 'signal-offline';
}
setTimeout(initializeFirebaseSystem, 2000);
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
const customerSalesPlaceholder = this.userRef.collection('customer_sales').doc('_placeholder_');
await customerSalesPlaceholder.set({
_placeholder: true,
createdAt: firebase.firestore.FieldValue.serverTimestamp(),
type: 'placeholder',
message: 'Customer sales collection initialized'
});
this.results.success.push('sales');
this.results.success.push('customer_sales');
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
'customer_sales', 'rep_sales', 'rep_customers',
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
'production', 'sales', 'customer_sales',
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
function retryFirebaseInit(attempts = 0, maxAttempts = 5) {
const success = initializeFirebase();
if (success) {
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
try {
await entry.handlerFn(entry.snapshot);
} catch (err) {
console.warn('[SyncLock] Error replaying buffered snapshot', err);
}
}
}
function updateSignal(status) {
updateSignalUI(status);
}
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
if (senderId && senderId === window._selfSenderId) {
return;
}
if (type === 'data-update' && collections) {
for (const collectionName of collections) {
try {
const data = await idb.get(collectionName);
switch(collectionName) {
case 'mfg_pro_pkr':
db = data || [];
break;
case 'customer_sales':
customerSales = data || [];
break;
case 'rep_sales':
repSales = data || [];
break;
case 'rep_customers':
repCustomers = data || [];
break;
case 'sales_customers':
salesCustomers = data || [];
break;
case 'noman_history':
salesHistory = data || [];
break;
case 'factory_inventory_data':
factoryInventoryData = data || [];
break;
case 'factory_production_history':
factoryProductionHistory = data || [];
break;
case 'payment_entities':
paymentEntities = data || [];
break;
case 'payment_transactions':
paymentTransactions = data || [];
break;
case 'expenses':
expenseRecords = data || [];
break;
case 'stock_returns':
stockReturns = data || [];
break;
case 'settings': {
const settingsData = await idb.get('naswar_default_settings');
if (settingsData !== undefined && settingsData !== null) {
defaultSettings = settingsData;
}
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
console.error('Failed to save data locally.', error);
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
setTimeout(() => {
dot.style.transform = '';
dot.style.boxShadow = '';
}, 300);
}
async function emitSyncUpdate(payload) {
if (!firebaseDB || !currentUser) return;
flashLivePulse();
if (payload && typeof payload === 'object') {
const changedKeys = Object.keys(payload);
if (syncChannel) {
try {
if (!window._selfSenderId) {
window._selfSenderId = Date.now().toString(36) + Math.random().toString(36).slice(2);
}
syncChannel.postMessage({
type: 'data-update',
collections: changedKeys,
timestamp: Date.now(),
senderId: window._selfSenderId
});
} catch (e) {
console.warn('BroadcastChannel postMessage failed', e);
}
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
console.error('Cloud save operation failed.', error);
showToast('Cloud save operation failed.', 'error');
}
};
runCleanup();
if (window._syncUpdatesCleanupInterval) clearInterval(window._syncUpdatesCleanupInterval);
window._syncUpdatesCleanupInterval = setInterval(runCleanup, 60 * 60 * 1000);
}
function scheduleListenerReconnect() {
if (isReconnecting) {
return;
}
if (listenerReconnectTimer) {
clearTimeout(listenerReconnectTimer);
}
if (listenerRetryAttempts >= MAX_RETRY_ATTEMPTS) {
updateSignalUI('offline');
if (typeof showToast === 'function') {
showToast('Connection lost. Please refresh the page.', 'error');
}
return;
}
const delay = BASE_RETRY_DELAY * Math.pow(2, listenerRetryAttempts);
listenerRetryAttempts++;
isReconnecting = true;
listenerReconnectTimer = setTimeout(() => {
isReconnecting = false;
if (firebaseDB && currentUser) {
subscribeToRealtime();
}
}, delay);
}
function recordSuccessfulConnection() {
lastSuccessfulConnection = Date.now();
listenerRetryAttempts = 0;
isReconnecting = false;
}
function isConnectionStale() {
const timeSinceLastSuccess = Date.now() - lastSuccessfulConnection;
const staleThreshold = 5 * 60 * 1000;
return timeSinceLastSuccess > staleThreshold;
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
    const collections = [
      { name: 'production',          data: db,                     filter: d => !d.isMerged },
      { name: 'sales',               data: customerSales,          filter: d => !d.isMerged },
      { name: 'rep_sales',           data: repSales,               filter: d => !d.isMerged },
      { name: 'calculator_history',  data: salesHistory,           filter: d => !d.isMerged },
      { name: 'transactions',        data: paymentTransactions,    filter: d => !d.isMerged },
      { name: 'factory_history',     data: factoryProductionHistory, filter: d => !d.isMerged },
      { name: 'expenses',            data: expenseRecords,         filter: d => !d.isMerged },
      { name: 'returns',             data: stockReturns,           filter: d => !d.isMerged }
    ];
    let allOk = true;
    for (const col of collections) {
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
  } catch (e) {
    console.warn('pendingFirestoreYearClose retry failed:', e);
  }
}
updateSignalUI('connecting');
realtimeRefs.forEach(unsub => {
try {
if (typeof unsub === 'function') unsub();
} catch (e) {
console.error('Firebase operation failed.', e);
showToast('Firebase operation failed.', 'error');
}
});
realtimeRefs = [];
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
try {
const updateArray = (array, docData, arrayName) => {
if (docData._placeholder || docData.id === '_placeholder_') return array;
const existingIndex = array.findIndex(item => item.id === docData.id);
if (existingIndex === -1) {
array.push(docData);
return array;
} else {
const getComparableTimestamp = (item) => {
const ts = item.updatedAt !== undefined ? item.updatedAt
          : item.timestamp !== undefined ? item.timestamp
          : item.createdAt;
if (!ts) return 0;
if (ts && typeof ts.toMillis === 'function') return ts.toMillis();
if (ts && typeof ts.seconds === 'number') return ts.seconds * 1000;
if (ts instanceof Date) return ts.getTime();
if (typeof ts === 'number') return ts;
if (typeof ts === 'string') return new Date(ts).getTime();
return 0;
};
const localTimestamp = getComparableTimestamp(array[existingIndex]);
const cloudTimestamp = getComparableTimestamp(docData);
if (cloudTimestamp >= localTimestamp) {
array[existingIndex] = docData;
}
return array;
}
};
let productionQuery = userRef.collection('production');
const lastProductionSync = await DeltaSync.getLastSyncFirestoreTimestamp('production');
if (lastProductionSync) {
productionQuery = productionQuery.where('updatedAt', '>', lastProductionSync);
}
const _handleProductionSnapshot = async (snapshot) => {
try {
if (snapshot.metadata.hasPendingWrites) return;
if (snapshot.metadata.fromCache) return;
if (closeYearInProgress) return; 
trackFirestoreRead(snapshot.docChanges().length);
const changes = snapshot.docChanges();
if (changes.length === 0) return;
let hasChanges = false;
for (const change of changes) {
try {
const docData = { id: change.doc.id, ...change.doc.data() };
if (change.type === 'added' || change.type === 'modified') {
db = updateArray(db, docData, 'production');
hasChanges = true;
} else if (change.type === 'removed') {
db = db.filter(item => item.id !== change.doc.id);
deletedRecordIds.add(change.doc.id);
hasChanges = true;
}
} catch (docError) {
console.warn('Firebase operation failed.', docError);
}
}
if (hasChanges) {
await idb.set('mfg_pro_pkr', db);
await DeltaSync.setLastSyncTimestamp('production');
emitSyncUpdate({ mfg_pro_pkr: db });
if (typeof syncProductionTab === 'function') syncProductionTab();
flashLivePulse();
}
recordSuccessfulConnection();
} catch (error) {
console.error('Failed to save data locally.', error);
showToast('Failed to save data locally.', 'error');
}
};
const productionUnsub = productionQuery.onSnapshot(async (snapshot) => {
if (isSyncing) { _enqueueSyncLocked(_handleProductionSnapshot, snapshot); return; }
await _handleProductionSnapshot(snapshot);
}, error => {
updateSignalUI('error');
scheduleListenerReconnect();
});
let salesQuery = userRef.collection('sales');
const lastSalesSync = await DeltaSync.getLastSyncFirestoreTimestamp('sales');
if (lastSalesSync) {
salesQuery = salesQuery.where('updatedAt', '>', lastSalesSync);
}
const _handleSalesSnapshot = async (snapshot) => {
try {
if (snapshot.metadata.hasPendingWrites) return;
if (snapshot.metadata.fromCache) return;
if (closeYearInProgress) return; 
trackFirestoreRead(snapshot.docChanges().length);
const changes = snapshot.docChanges();
if (changes.length === 0) return;
let hasChanges = false;
for (const change of changes) {
try {
const docData = { id: change.doc.id, ...change.doc.data() };
if (change.type === 'added' || change.type === 'modified') {
customerSales = updateArray(customerSales, docData, 'sale');
hasChanges = true;
} else if (change.type === 'removed') {
customerSales = customerSales.filter(item => item.id !== change.doc.id);
deletedRecordIds.add(change.doc.id);
hasChanges = true;
}
} catch (docError) {
console.warn('Firebase operation failed.', docError);
}
}
if (hasChanges) {
await idb.set('customer_sales', customerSales);
await DeltaSync.setLastSyncTimestamp('sales');
emitSyncUpdate({ customer_sales: customerSales });
if (typeof syncSalesTab === 'function') syncSalesTab();
flashLivePulse();
}
recordSuccessfulConnection();
} catch (error) {
console.error('Failed to save data locally.', error);
showToast('Failed to save data locally.', 'error');
}
};
const salesUnsub = salesQuery.onSnapshot(async (snapshot) => {
if (isSyncing) { _enqueueSyncLocked(_handleSalesSnapshot, snapshot); return; }
await _handleSalesSnapshot(snapshot);
}, error => {
updateSignalUI('error');
scheduleListenerReconnect();
});
let repSalesQuery = userRef.collection('rep_sales');
const lastRepSalesSync = await DeltaSync.getLastSyncFirestoreTimestamp('rep_sales');
if (lastRepSalesSync) {
repSalesQuery = repSalesQuery.where('updatedAt', '>', lastRepSalesSync);
}
const _handleRepSalesSnapshot = async (snapshot) => {
try {
if (snapshot.metadata.hasPendingWrites) return;
if (snapshot.metadata.fromCache) return;
if (closeYearInProgress) return; 
trackFirestoreRead(snapshot.docChanges().length);
let hasChanges = false;
for (const change of snapshot.docChanges()) {
try {
const docData = { id: change.doc.id, ...change.doc.data() };
if (change.type === 'added' || change.type === 'modified') {
repSales = updateArray(repSales, docData, 'rep sale');
hasChanges = true;
} else if (change.type === 'removed') {
repSales = repSales.filter(item => item.id !== change.doc.id);
deletedRecordIds.add(change.doc.id);
hasChanges = true;
}
} catch (docError) { console.warn('repSales doc error', docError); }
}
if (hasChanges) {
await idb.set('rep_sales', repSales);
await DeltaSync.setLastSyncTimestamp('rep_sales');
emitSyncUpdate({ rep_sales: repSales });
if (typeof syncRepTab === 'function') syncRepTab();
flashLivePulse();
}
recordSuccessfulConnection();
} catch (error) {
console.error('repSales snapshot error', error);
}
};
const repSalesUnsub = repSalesQuery.onSnapshot(async (snapshot) => {
if (isSyncing) { _enqueueSyncLocked(_handleRepSalesSnapshot, snapshot); return; }
await _handleRepSalesSnapshot(snapshot);
}, error => {
updateSignalUI('error');
scheduleListenerReconnect();
});
let repCustomersQuery = userRef.collection('rep_customers');
const lastRepCustomersSync = await DeltaSync.getLastSyncFirestoreTimestamp('rep_customers');
if (lastRepCustomersSync) {
repCustomersQuery = repCustomersQuery.where('updatedAt', '>', lastRepCustomersSync);
}
const _handleRepCustomersSnapshot = async (snapshot) => {
try {
if (snapshot.metadata.hasPendingWrites) return;
if (snapshot.metadata.fromCache) return;
trackFirestoreRead(snapshot.docChanges().length);
let hasChanges = false;
for (const change of snapshot.docChanges()) {
try {
const docData = { id: change.doc.id, ...change.doc.data() };
if (change.type === 'added' || change.type === 'modified') {
repCustomers = updateArray(repCustomers, docData, 'rep customer');
hasChanges = true;
} else if (change.type === 'removed') {
repCustomers = repCustomers.filter(item => item.id !== change.doc.id);
deletedRecordIds.add(change.doc.id);
hasChanges = true;
}
} catch (docError) { console.warn('repCustomers doc error', docError); }
}
if (hasChanges) {
await idb.set('rep_customers', repCustomers);
await DeltaSync.setLastSyncTimestamp('rep_customers');
emitSyncUpdate({ rep_customers: repCustomers });
if (typeof syncRepTab === 'function') syncRepTab();
flashLivePulse();
}
recordSuccessfulConnection();
} catch (error) {
console.error('repCustomers snapshot error', error);
}
};
const repCustomersUnsub = repCustomersQuery.onSnapshot(async (snapshot) => {
if (isSyncing) { _enqueueSyncLocked(_handleRepCustomersSnapshot, snapshot); return; }
await _handleRepCustomersSnapshot(snapshot);
}, error => {
updateSignalUI('error');
scheduleListenerReconnect();
});

let salesCustomersQuery = userRef.collection('sales_customers');
const lastSalesCustomersSync = await DeltaSync.getLastSyncFirestoreTimestamp('sales_customers');
if (lastSalesCustomersSync) {
salesCustomersQuery = salesCustomersQuery.where('updatedAt', '>', lastSalesCustomersSync);
}
const _handleSalesCustomersSnapshot = async (snapshot) => {
try {
if (snapshot.metadata.hasPendingWrites) return;
if (snapshot.metadata.fromCache) return;
trackFirestoreRead(snapshot.docChanges().length);
let hasChanges = false;
for (const change of snapshot.docChanges()) {
try {
const docData = { id: change.doc.id, ...change.doc.data() };
if (change.type === 'added' || change.type === 'modified') {
salesCustomers = updateArray(salesCustomers, docData, 'sales customer');
hasChanges = true;
} else if (change.type === 'removed') {
salesCustomers = salesCustomers.filter(item => item.id !== change.doc.id);
deletedRecordIds.add(change.doc.id);
hasChanges = true;
}
} catch (docError) { console.warn('salesCustomers doc error', docError); }
}
if (hasChanges) {
await idb.set('sales_customers', salesCustomers);
await DeltaSync.setLastSyncTimestamp('sales_customers');
emitSyncUpdate({ sales_customers: salesCustomers });
flashLivePulse();
}
recordSuccessfulConnection();
} catch (error) {
console.error('salesCustomers snapshot error', error);
}
};
const salesCustomersUnsub = salesCustomersQuery.onSnapshot(async (snapshot) => {
if (isSyncing) { _enqueueSyncLocked(_handleSalesCustomersSnapshot, snapshot); return; }
await _handleSalesCustomersSnapshot(snapshot);
}, error => {
updateSignalUI('error');
scheduleListenerReconnect();
});
let transactionsQuery = userRef.collection('transactions');
const lastTransactionsSync = await DeltaSync.getLastSyncFirestoreTimestamp('transactions');
if (lastTransactionsSync) {
transactionsQuery = transactionsQuery.where('updatedAt', '>', lastTransactionsSync);
}
const _handleTransactionsSnapshot = async (snapshot) => {
try {
if (snapshot.metadata.hasPendingWrites) return;
if (snapshot.metadata.fromCache) return;
if (closeYearInProgress) return; 
trackFirestoreRead(snapshot.docChanges().length);
const changes = snapshot.docChanges();
if (changes.length === 0) return;
let hasChanges = false;
for (const change of changes) {
try {
const docData = { id: change.doc.id, ...change.doc.data() };
if (change.type === 'added' || change.type === 'modified') {
paymentTransactions = updateArray(paymentTransactions, docData, 'transaction');
hasChanges = true;
} else if (change.type === 'removed') {
paymentTransactions = paymentTransactions.filter(item => item.id !== change.doc.id);
deletedRecordIds.add(change.doc.id);
hasChanges = true;
}
} catch (docError) {
console.warn('Payment transaction failed.', docError);
}
}
if (hasChanges) {
await idb.set('payment_transactions', paymentTransactions);
await DeltaSync.setLastSyncTimestamp('transactions');
emitSyncUpdate({ payment_transactions: paymentTransactions });
if (typeof syncPaymentsTab === 'function') syncPaymentsTab();
flashLivePulse();
}
recordSuccessfulConnection();
} catch (error) {
console.error('Failed to save data locally.', error);
showToast('Failed to save data locally.', 'error');
}
};
const transactionsUnsub = transactionsQuery.onSnapshot(async (snapshot) => {
if (isSyncing) { _enqueueSyncLocked(_handleTransactionsSnapshot, snapshot); return; }
await _handleTransactionsSnapshot(snapshot);
}, error => {
updateSignalUI('error');
scheduleListenerReconnect();
});
let entitiesQuery = userRef.collection('entities');
const lastEntitiesSync = await DeltaSync.getLastSyncFirestoreTimestamp('entities');
if (lastEntitiesSync) {
entitiesQuery = entitiesQuery.where('updatedAt', '>', lastEntitiesSync);
}
const _handleEntitiesSnapshot = async (snapshot) => {
try {
if (snapshot.metadata.hasPendingWrites) return;
if (snapshot.metadata.fromCache) return;
trackFirestoreRead(snapshot.docChanges().length);
let hasChanges = false;
for (const change of snapshot.docChanges()) {
try {
const docData = { id: change.doc.id, ...change.doc.data() };
if (change.type === 'added' || change.type === 'modified') {
paymentEntities = updateArray(paymentEntities, docData, 'entity');
hasChanges = true;
} else if (change.type === 'removed') {
paymentEntities = paymentEntities.filter(item => item.id !== change.doc.id);
deletedRecordIds.add(change.doc.id);
hasChanges = true;
}
} catch (docError) { console.warn('entities doc error', docError); }
}
if (hasChanges) {
await idb.set('payment_entities', paymentEntities);
await DeltaSync.setLastSyncTimestamp('entities');
emitSyncUpdate({ payment_entities: paymentEntities });
if (typeof renderEntityTable === 'function') renderEntityTable();
if (typeof refreshPaymentTab === 'function') refreshPaymentTab();
flashLivePulse();
}
recordSuccessfulConnection();
} catch (error) {
console.error('entities snapshot error', error);
}
};
const entitiesUnsub = entitiesQuery.onSnapshot(async (snapshot) => {
if (isSyncing) { _enqueueSyncLocked(_handleEntitiesSnapshot, snapshot); return; }
await _handleEntitiesSnapshot(snapshot);
}, error => {
updateSignalUI('error');
scheduleListenerReconnect();
});
let inventoryQuery = userRef.collection('inventory');
const lastInventorySync = await DeltaSync.getLastSyncFirestoreTimestamp('inventory');
if (lastInventorySync) {
inventoryQuery = inventoryQuery.where('updatedAt', '>', lastInventorySync);
}
const _handleInventorySnapshot = async (snapshot) => {
try {
if (snapshot.metadata.hasPendingWrites) return;
if (snapshot.metadata.fromCache) return;
trackFirestoreRead(snapshot.docChanges().length);
let hasChanges = false;
for (const change of snapshot.docChanges()) {
try {
const docData = { id: change.doc.id, ...change.doc.data() };
if (change.type === 'added' || change.type === 'modified') {
factoryInventoryData = updateArray(factoryInventoryData, docData, 'inventory item');
hasChanges = true;
} else if (change.type === 'removed') {
factoryInventoryData = factoryInventoryData.filter(item => item.id !== change.doc.id);
deletedRecordIds.add(change.doc.id);
hasChanges = true;
}
} catch (docError) { console.warn('inventory doc error', docError); }
}
if (hasChanges) {
await idb.set('factory_inventory_data', factoryInventoryData);
await DeltaSync.setLastSyncTimestamp('inventory');
emitSyncUpdate({ factory_inventory_data: factoryInventoryData });
if (typeof syncFactoryTab === 'function') syncFactoryTab();
flashLivePulse();
}
recordSuccessfulConnection();
} catch (error) {
console.error('inventory snapshot error', error);
}
};
const inventoryUnsub = inventoryQuery.onSnapshot(async (snapshot) => {
if (isSyncing) { _enqueueSyncLocked(_handleInventorySnapshot, snapshot); return; }
await _handleInventorySnapshot(snapshot);
}, error => {
updateSignalUI('error');
scheduleListenerReconnect();
});
let factoryHistoryQuery = userRef.collection('factory_history');
const lastFactoryHistorySync = await DeltaSync.getLastSyncFirestoreTimestamp('factory_history');
if (lastFactoryHistorySync) {
factoryHistoryQuery = factoryHistoryQuery.where('updatedAt', '>', lastFactoryHistorySync);
}
const _handleFactoryHistorySnapshot = async (snapshot) => {
try {
if (snapshot.metadata.hasPendingWrites) return;
if (snapshot.metadata.fromCache) return;
if (closeYearInProgress) return; 
trackFirestoreRead(snapshot.docChanges().length);
let hasChanges = false;
for (const change of snapshot.docChanges()) {
try {
const docData = { id: change.doc.id, ...change.doc.data() };
if (change.type === 'added' || change.type === 'modified') {
factoryProductionHistory = updateArray(factoryProductionHistory, docData, 'factory history');
hasChanges = true;
} else if (change.type === 'removed') {
factoryProductionHistory = factoryProductionHistory.filter(item => item.id !== change.doc.id);
deletedRecordIds.add(change.doc.id);
hasChanges = true;
}
} catch (docError) { console.warn('factoryHistory doc error', docError); }
}
if (hasChanges) {
await idb.set('factory_production_history', factoryProductionHistory);
await DeltaSync.setLastSyncTimestamp('factory_history');
emitSyncUpdate({ factory_production_history: factoryProductionHistory });
if (typeof syncFactoryTab === 'function') syncFactoryTab();
flashLivePulse();
}
recordSuccessfulConnection();
} catch (error) {
console.error('factoryHistory snapshot error', error);
}
};
const factoryHistoryUnsub = factoryHistoryQuery.onSnapshot(async (snapshot) => {
if (isSyncing) { _enqueueSyncLocked(_handleFactoryHistorySnapshot, snapshot); return; }
await _handleFactoryHistorySnapshot(snapshot);
}, error => {
updateSignalUI('error');
scheduleListenerReconnect();
});
let returnsQuery = userRef.collection('returns');
const lastReturnsSync = await DeltaSync.getLastSyncFirestoreTimestamp('returns');
if (lastReturnsSync) {
returnsQuery = returnsQuery.where('updatedAt', '>', lastReturnsSync);
}
const _handleReturnsSnapshot = async (snapshot) => {
try {
if (snapshot.metadata.hasPendingWrites) return;
if (snapshot.metadata.fromCache) return;
if (closeYearInProgress) return; 
trackFirestoreRead(snapshot.docChanges().length);
let hasChanges = false;
for (const change of snapshot.docChanges()) {
try {
const docData = { id: change.doc.id, ...change.doc.data() };
if (change.type === 'added' || change.type === 'modified') {
stockReturns = updateArray(stockReturns, docData, 'return');
hasChanges = true;
} else if (change.type === 'removed') {
stockReturns = stockReturns.filter(item => item.id !== change.doc.id);
deletedRecordIds.add(change.doc.id);
hasChanges = true;
}
} catch (docError) { console.warn('returns doc error', docError); }
}
if (hasChanges) {
await idb.set('stock_returns', stockReturns);
await DeltaSync.setLastSyncTimestamp('returns');
emitSyncUpdate({ stock_returns: stockReturns });
if (typeof syncProductionTab === 'function') syncProductionTab();
flashLivePulse();
}
recordSuccessfulConnection();
} catch (error) {
console.error('returns snapshot error', error);
}
};
const returnsUnsub = returnsQuery.onSnapshot(async (snapshot) => {
if (isSyncing) { _enqueueSyncLocked(_handleReturnsSnapshot, snapshot); return; }
await _handleReturnsSnapshot(snapshot);
}, error => {
updateSignalUI('error');
scheduleListenerReconnect();
});
let expensesQuery = userRef.collection('expenses');
const lastExpensesSync = await DeltaSync.getLastSyncFirestoreTimestamp('expenses');
if (lastExpensesSync) {
expensesQuery = expensesQuery.where('updatedAt', '>', lastExpensesSync);
}
const _handleExpensesSnapshot = async (snapshot) => {
try {
if (snapshot.metadata.hasPendingWrites) return;
if (snapshot.metadata.fromCache) return;
if (closeYearInProgress) return; 
trackFirestoreRead(snapshot.docChanges().length);
let hasExpenseChanges = false;
for (const change of snapshot.docChanges()) {
try {
const docData = { id: change.doc.id, ...change.doc.data() };
if (change.type === 'added' || change.type === 'modified') {
expenseRecords = updateArray(expenseRecords, docData, 'expense');
hasExpenseChanges = true;
} else if (change.type === 'removed') {
expenseRecords = expenseRecords.filter(item => item.id !== change.doc.id);
deletedRecordIds.add(change.doc.id);
hasExpenseChanges = true;
}
} catch (docError) { console.warn('expenses doc error', docError); }
}
if (hasExpenseChanges) {
await idb.set('expenses', expenseRecords);
await DeltaSync.setLastSyncTimestamp('expenses');
emitSyncUpdate({ expenses: expenseRecords });
if (typeof refreshPaymentTab === 'function') refreshPaymentTab();
flashLivePulse();
}
recordSuccessfulConnection();
} catch (error) {
console.error('expenses snapshot error', error);
}
};
const expensesUnsub = expensesQuery.onSnapshot(async (snapshot) => {
if (isSyncing) { _enqueueSyncLocked(_handleExpensesSnapshot, snapshot); return; }
await _handleExpensesSnapshot(snapshot);
}, error => {
updateSignalUI('error');
scheduleListenerReconnect();
});
let calcHistoryQuery = userRef.collection('calculator_history');
const lastCalcHistorySync = await DeltaSync.getLastSyncFirestoreTimestamp('calculator_history');
if (lastCalcHistorySync) {
calcHistoryQuery = calcHistoryQuery.where('updatedAt', '>', lastCalcHistorySync);
}
const _handleCalcHistorySnapshot = async (snapshot) => {
try {
if (snapshot.metadata.hasPendingWrites) return;
if (snapshot.metadata.fromCache) return;
if (closeYearInProgress) return; 
trackFirestoreRead(snapshot.docChanges().length);
const changes = snapshot.docChanges();
if (changes.length === 0) return;
let hasChanges = false;
for (const change of changes) {
try {
const docData = { id: change.doc.id, ...change.doc.data() };
if (change.type === 'added' || change.type === 'modified') {
salesHistory = updateArray(salesHistory, docData, 'calc history');
hasChanges = true;
} else if (change.type === 'removed') {
salesHistory = salesHistory.filter(item => item.id !== change.doc.id);
deletedRecordIds.add(change.doc.id);
hasChanges = true;
}
} catch (docError) {
console.warn('Firebase operation failed.', docError);
}
}
if (hasChanges) {
await idb.set('noman_history', salesHistory);
await DeltaSync.setLastSyncTimestamp('calculator_history');
emitSyncUpdate({ noman_history: salesHistory });
if (typeof syncCalculatorTab === 'function') syncCalculatorTab();
flashLivePulse();
}
recordSuccessfulConnection();
} catch (error) {
console.error('Failed to save data locally.', error);
showToast('Failed to save data locally.', 'error');
}
};
const calcHistoryUnsub = calcHistoryQuery.onSnapshot(async (snapshot) => {
if (isSyncing) { _enqueueSyncLocked(_handleCalcHistorySnapshot, snapshot); return; }
await _handleCalcHistorySnapshot(snapshot);
}, error => {
updateSignalUI('error');
scheduleListenerReconnect();
});
const _handleSettingsSnapshot = async (doc) => {
try {
if (!doc.exists || doc.metadata.hasPendingWrites) return;
if (doc.metadata.fromCache) return;
trackFirestoreRead(1);
const cloudSettings = doc.data();
if (!cloudSettings || typeof cloudSettings !== 'object') {
return;
}
let hasUpdates = false;
const timestampChecks = [
{ cloud: cloudSettings.naswar_default_settings_timestamp, local: await idb.get('naswar_default_settings_timestamp'), name: 'settings' },
{ cloud: cloudSettings.repProfile_timestamp, local: await idb.get('repProfile_timestamp'), name: 'repProfile' }
];
for (const check of timestampChecks) {
if ((check.cloud || 0) > (check.local || 0)) {
hasUpdates = true;
break;
}
}
if (!hasUpdates) {
return;
}
if (cloudSettings.naswar_default_settings) {
const cloudTimestamp = cloudSettings.naswar_default_settings_timestamp || 0;
const localTimestamp = (await idb.get('naswar_default_settings_timestamp')) || 0;
if (cloudTimestamp > localTimestamp) {
defaultSettings = cloudSettings.naswar_default_settings;
await idb.setBatch([
['naswar_default_settings', defaultSettings],
['naswar_default_settings_timestamp', cloudTimestamp]
]);
}
}
if (cloudSettings.repProfile) {
const cloudTimestamp = cloudSettings.repProfile_timestamp || 0;
const localTimestamp = (await idb.get('repProfile_timestamp')) || 0;
if (cloudTimestamp > localTimestamp) {
currentRepProfile = cloudSettings.repProfile;
await idb.setBatch([
['current_rep_profile', currentRepProfile],
['repProfile_timestamp', cloudTimestamp]
]);
}
}
if (cloudSettings.last_synced) {
await idb.set('last_synced', cloudSettings.last_synced);
}
emitSyncUpdate({ settings: cloudSettings });
flashLivePulse();
recordSuccessfulConnection();
} catch (error) {
console.error('Failed to save data locally.', error);
showToast('Failed to save data locally.', 'error');
}
};
const settingsUnsub = userRef.collection('settings').doc('config').onSnapshot(async (doc) => {
if (isSyncing) { _enqueueSyncLocked(_handleSettingsSnapshot, doc); return; }
await _handleSettingsSnapshot(doc);
}, error => {
updateSignalUI('error');
scheduleListenerReconnect();
});
const _handleFactorySettingsSnapshot = async (doc) => {
try {
if (!doc.exists || doc.metadata.hasPendingWrites) return;
if (doc.metadata.fromCache) return;
trackFirestoreRead(1);
const cloudFactorySettings = doc.data();
if (!cloudFactorySettings || typeof cloudFactorySettings !== 'object') {
return;
}
let hasUpdates = false;
const timestampChecks = [
{ cloud: cloudFactorySettings.default_formulas_timestamp, local: await idb.get('factory_default_formulas_timestamp') },
{ cloud: cloudFactorySettings.additional_costs_timestamp, local: await idb.get('factory_additional_costs_timestamp') },
{ cloud: cloudFactorySettings.cost_adjustment_factor_timestamp, local: await idb.get('factory_cost_adjustment_factor_timestamp') },
{ cloud: cloudFactorySettings.sale_prices_timestamp, local: await idb.get('factory_sale_prices_timestamp') },
{ cloud: cloudFactorySettings.unit_tracking_timestamp, local: await idb.get('factory_unit_tracking_timestamp') }
];
for (const check of timestampChecks) {
if ((check.cloud || 0) > (check.local || 0)) {
hasUpdates = true;
break;
}
}
if (!hasUpdates) {
return;
}
if (cloudFactorySettings.default_formulas && typeof cloudFactorySettings.default_formulas === 'object') {
try {
const formulas = cloudFactorySettings.default_formulas;
if (('standard' in formulas) && ('asaan' in formulas)) {
const cloudTimestamp = cloudFactorySettings.default_formulas_timestamp || 0;
const localTimestamp = (await idb.get('factory_default_formulas_timestamp')) || 0;
if (cloudTimestamp > localTimestamp) {
factoryDefaultFormulas = {
standard: Array.isArray(formulas.standard) ? formulas.standard : [],
asaan: Array.isArray(formulas.asaan) ? formulas.asaan : []
};
await idb.setBatch([
['factory_default_formulas', factoryDefaultFormulas],
['factory_default_formulas_timestamp', cloudTimestamp]
]);
refreshFactorySettingsOverlay();
}
} else {
}
} catch (error) {
console.error('Failed to save data locally.', error);
showToast('Failed to save data locally.', 'error');
}
}
if (cloudFactorySettings.additional_costs && typeof cloudFactorySettings.additional_costs === 'object') {
const costs = cloudFactorySettings.additional_costs;
if (('standard' in costs) && ('asaan' in costs)) {
const cloudTimestamp = cloudFactorySettings.additional_costs_timestamp || 0;
const localTimestamp = (await idb.get('factory_additional_costs_timestamp')) || 0;
if (cloudTimestamp > localTimestamp) {
factoryAdditionalCosts = {
standard: parseFloat(costs.standard) || 0,
asaan: parseFloat(costs.asaan) || 0
};
await idb.setBatch([
['factory_additional_costs', factoryAdditionalCosts],
['factory_additional_costs_timestamp', cloudTimestamp]
]);
refreshFactorySettingsOverlay();
}
} else {
}
}
if (cloudFactorySettings.cost_adjustment_factor && typeof cloudFactorySettings.cost_adjustment_factor === 'object') {
const factor = cloudFactorySettings.cost_adjustment_factor;
if (('standard' in factor) && ('asaan' in factor)) {
const cloudTimestamp = cloudFactorySettings.cost_adjustment_factor_timestamp || 0;
const localTimestamp = (await idb.get('factory_cost_adjustment_factor_timestamp')) || 0;
if (cloudTimestamp > localTimestamp) {
factoryCostAdjustmentFactor = {
standard: parseFloat(factor.standard) || 1,
asaan: parseFloat(factor.asaan) || 1
};
await idb.setBatch([
['factory_cost_adjustment_factor', factoryCostAdjustmentFactor],
['factory_cost_adjustment_factor_timestamp', cloudTimestamp]
]);
refreshFactorySettingsOverlay();
}
} else {
}
}
if (cloudFactorySettings.sale_prices && typeof cloudFactorySettings.sale_prices === 'object') {
const prices = cloudFactorySettings.sale_prices;
if (('standard' in prices) && ('asaan' in prices)) {
const cloudTimestamp = cloudFactorySettings.sale_prices_timestamp || 0;
const localTimestamp = (await idb.get('factory_sale_prices_timestamp')) || 0;
if (cloudTimestamp > localTimestamp) {
factorySalePrices = {
standard: parseFloat(prices.standard) || 0,
asaan: parseFloat(prices.asaan) || 0
};
await idb.setBatch([
['factory_sale_prices', factorySalePrices],
['factory_sale_prices_timestamp', cloudTimestamp]
]);
refreshFactorySettingsOverlay();
}
} else {
}
}
if (cloudFactorySettings.unit_tracking && typeof cloudFactorySettings.unit_tracking === 'object') {
const tracking = cloudFactorySettings.unit_tracking;
if (('standard' in tracking) && ('asaan' in tracking)) {
const cloudTimestamp = cloudFactorySettings.unit_tracking_timestamp || 0;
const localTimestamp = (await idb.get('factory_unit_tracking_timestamp')) || 0;
if (cloudTimestamp > localTimestamp) {
factoryUnitTracking = {
standard: tracking.standard || { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
asaan: tracking.asaan || { produced: 0, consumed: 0, available: 0, unitCostHistory: [] }
};
await idb.setBatch([
['factory_unit_tracking', factoryUnitTracking],
['factory_unit_tracking_timestamp', cloudTimestamp]
]);
refreshFactorySettingsOverlay();
}
} else {
}
}
emitSyncUpdate({ factorySettings: cloudFactorySettings });
flashLivePulse();
recordSuccessfulConnection();
} catch (error) {
console.error('Failed to save data locally.', error);
showToast('Failed to save data locally.', 'error');
}
};
const factorySettingsUnsub = userRef.collection('factorySettings').doc('config').onSnapshot(async (doc) => {
if (isSyncing) { _enqueueSyncLocked(_handleFactorySettingsSnapshot, doc); return; }
await _handleFactorySettingsSnapshot(doc);
}, error => {
updateSignalUI('error');
scheduleListenerReconnect();
});
const _handleExpenseCategoriesSnapshot = async (doc) => {
try {
if (!doc.exists || doc.metadata.hasPendingWrites) return;
if (doc.metadata.fromCache) return;
trackFirestoreRead(1);
const cloudExpenseCategories = doc.data();
if (!cloudExpenseCategories || typeof cloudExpenseCategories !== 'object') {
return;
}
if (cloudExpenseCategories.categories && Array.isArray(cloudExpenseCategories.categories)) {
const localCategories = await idb.get('expense_categories') || [];
if (JSON.stringify(cloudExpenseCategories.categories) !== JSON.stringify(localCategories)) {
expenseCategories = cloudExpenseCategories.categories;
await idb.set('expense_categories', expenseCategories);
emitSyncUpdate({ expenseCategories: cloudExpenseCategories });
flashLivePulse();
}
}
recordSuccessfulConnection();
} catch (error) {
console.error('Failed to save data locally.', error);
showToast('Failed to save data locally.', 'error');
}
};
const expenseCategoriesUnsub = userRef.collection('expenseCategories').doc('categories').onSnapshot(async (doc) => {
if (isSyncing) { _enqueueSyncLocked(_handleExpenseCategoriesSnapshot, doc); return; }
await _handleExpenseCategoriesSnapshot(doc);
}, error => {
updateSignalUI('error');
scheduleListenerReconnect();
});
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
deletedRecordIds.add(docData.recordId || docData.id);
}
const normalizedDoc = {
...docData,
syncedToCloud: true,
deletedAt: docData.deletedAt?.toMillis ? docData.deletedAt.toMillis() : (typeof docData.deletedAt === 'number' ? docData.deletedAt : Date.now())
};
const existingIndex = deletionRecords.findIndex(item => item.id === docData.id);
if (existingIndex === -1) {
deletionRecords.push(normalizedDoc);
} else {
deletionRecords[existingIndex] = normalizedDoc;
}
try {
if (docData.recordType === 'production' && docData.recordId) {
db = db.filter(item => item.id !== docData.recordId);
await idb.set('mfg_pro_pkr', db);
} else if ((docData.recordType === 'sale' || docData.recordType === 'sales') && docData.recordId) {
customerSales = customerSales.filter(item => item.id !== docData.recordId);
await idb.set('customer_sales', customerSales);
} else if (docData.recordType === 'expense' && docData.recordId) {
expenseRecords = expenseRecords.filter(item => item.id !== docData.recordId);
await idb.set('expenses', expenseRecords);
} else if (docData.recordType === 'transaction' && docData.recordId) {
paymentTransactions = paymentTransactions.filter(item => item.id !== docData.recordId);
await idb.set('payment_transactions', paymentTransactions);
} else if (docData.recordType === 'rep_sale' && docData.recordId) {
repSales = repSales.filter(item => item.id !== docData.recordId);
await idb.set('rep_sales', repSales);
} else if (docData.recordType === 'rep_customers' && docData.recordId) {
repCustomers = repCustomers.filter(item => item.id !== docData.recordId);
await idb.set('rep_customers', repCustomers);
} else if (docData.recordType === 'inventory' && docData.recordId) {
factoryInventoryData = factoryInventoryData.filter(item => item.id !== docData.recordId);
await idb.set('factory_inventory_data', factoryInventoryData);
} else if (docData.recordType === 'factory_history' && docData.recordId) {
factoryProductionHistory = factoryProductionHistory.filter(item => item.id !== docData.recordId);
await idb.set('factory_production_history', factoryProductionHistory);
} else if (docData.recordType === 'returns' && docData.recordId) {
stockReturns = stockReturns.filter(item => item.id !== docData.recordId);
await idb.set('stock_returns', stockReturns);
} else if (docData.recordType === 'calculator_history' && docData.recordId) {
salesHistory = salesHistory.filter(item => item.id !== docData.recordId);
await idb.set('noman_history', salesHistory);
} else if (docData.recordType === 'entities' && docData.recordId) {
paymentEntities = paymentEntities.filter(item => item.id !== docData.recordId);
await idb.set('payment_entities', paymentEntities);
}
} catch (collectionError) {
console.warn('Failed to apply deletion to collection', collectionError);
}
hasChanges = true;
} else if (change.type === 'removed') {
deletionRecords = deletionRecords.filter(item => item.id !== change.doc.id);
hasChanges = true;
}
} catch (docError) {
console.warn('Failed to save data locally.', docError);
}
}
if (hasChanges) {
await idb.set('deletion_records', deletionRecords);
emitSyncUpdate({ deletion_records: deletionRecords });
flashLivePulse();
recordSuccessfulConnection();
}
} catch (error) {
console.error('Failed to save data locally.', error);
showToast('Failed to save data locally.', 'error');
}
};
const deletionsUnsub = userRef.collection('deletions').onSnapshot(async (snapshot) => {
if (isSyncing) { _enqueueSyncLocked(_handleDeletionsSnapshot, snapshot); return; }
await _handleDeletionsSnapshot(snapshot);
}, error => {
updateSignalUI('error');
scheduleListenerReconnect();
});
const _handleTeamSnapshot = async (doc) => {
try {
if (!doc.exists || doc.metadata.hasPendingWrites) return;
if (!doc.metadata.fromCache) trackFirestoreRead(1);
const teamData = doc.data();
if (!teamData || typeof teamData !== 'object') return;
const cloudTs = teamData.updated_at || 0;
const localTs = (await idb.get('team_list_timestamp')) || 0;
if (cloudTs <= localTs) {
recordSuccessfulConnection();
return;
}
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
} catch (err) {
console.warn('Team list sync error:', err);
}
};
const teamUnsub = userRef.collection('settings').doc('team').onSnapshot(async (doc) => {
if (isSyncing) { _enqueueSyncLocked(_handleTeamSnapshot, doc); return; }
await _handleTeamSnapshot(doc);
}, error => {
updateSignalUI('error');
scheduleListenerReconnect();
});
realtimeRefs.push(
productionUnsub, salesUnsub, repSalesUnsub, repCustomersUnsub, transactionsUnsub,
entitiesUnsub, inventoryUnsub, factoryHistoryUnsub, returnsUnsub,
expensesUnsub, calcHistoryUnsub, settingsUnsub, factorySettingsUnsub,
expenseCategoriesUnsub, deletionsUnsub, teamUnsub
);
updateSignalUI('online');
recordSuccessfulConnection();
if (typeof registerDevice === 'function') {
registerDevice().catch(err => {
});
}
} catch (error) {
console.error('Device registration failed.', error);
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
socketReconnectTimer = setTimeout(() => {
subscribeToRealtime();
}, 5000);
}
function initFirebase() {
if (window._firebaseListenersRegistered) return;
window._firebaseListenersRegistered = true;
try {
window._fbOfflineHandler = () => { updateSignalUI('offline'); };
window._fbVisibilityHandler = async () => {
if (document.visibilityState === 'visible') {
if (currentUser && database) {
try {
await pullDataFromCloud(true);
} catch (error) {
console.warn('Failed to pull data from cloud.', error);
}
}
}
};
window.addEventListener('offline', window._fbOfflineHandler);
document.addEventListener('visibilitychange', window._fbVisibilityHandler);
} catch (e) {
console.warn('Failed to pull data from cloud.', e);
}
}
function mergeDatasets(localArray, cloudArray) {
if (!Array.isArray(localArray)) localArray = [];
if (!Array.isArray(cloudArray)) cloudArray = [];
const mergedMap = new Map();
cloudArray.forEach(item => {
if (item && item.id) {
if (deletedRecordIds.has(item.id)) {
return;
}
mergedMap.set(item.id, item);
}
});
localArray.forEach(localItem => {
if (!localItem || !localItem.id) return;
if (deletedRecordIds.has(localItem.id)) return;
const cloudItem = mergedMap.get(localItem.id);
if (!cloudItem) {
mergedMap.set(localItem.id, localItem);
return;
}
const isFinancialRecord = (localItem.totalSold !== undefined || localItem.revenue !== undefined);
if (isFinancialRecord) {
const localHasData = (localItem.totalSold > 0 || localItem.revenue > 0);
const cloudIsCorrupt = (cloudItem.totalSold === undefined || cloudItem.totalSold === null || cloudItem.revenue === null);
if (localHasData && cloudIsCorrupt) {
mergedMap.set(localItem.id, localItem);
return;
}
}
if (localItem.isRepModeEntry === true && !cloudItem.isRepModeEntry) {
mergedMap.set(localItem.id, localItem);
return;
}
if (localItem.isReturn === true && !cloudItem.isReturn) {
mergedMap.set(localItem.id, localItem);
return;
}
if ((localItem.formulaUnits > 0 && !cloudItem.formulaUnits) ||
(localItem.formulaCost > 0 && !cloudItem.formulaCost)) {
mergedMap.set(localItem.id, localItem);
return;
}
if (localItem.supplierId && !cloudItem.supplierId) {
mergedMap.set(localItem.id, localItem);
return;
}
if (localItem.paymentStatus === 'paid' && cloudItem.paymentStatus !== 'paid') {
mergedMap.set(localItem.id, localItem);
return;
}
const localTime = localItem.timestamp || new Date(localItem.date).getTime() || 0;
const cloudTime = cloudItem.timestamp || new Date(cloudItem.date).getTime() || 0;
if (localTime >= cloudTime) {
mergedMap.set(localItem.id, localItem);
}
});
return Array.from(mergedMap.values());
}
function sanitizeForFirestore(obj, depth = 0) {
if (depth > 20) {
return null;
}
if (obj === null || obj === undefined) {
return null;
}
if (obj instanceof Date) {
return obj.toISOString();
}
if (typeof obj !== 'object') {
if (typeof obj === 'number') {
if (isNaN(obj) || !isFinite(obj)) return 0;
return obj;
}
if (typeof obj === 'string') {
return obj;
}
if (typeof obj === 'boolean') {
return obj;
}
try {
return String(obj);
} catch (e) {
return null;
}
}
if (Array.isArray(obj)) {
const sanitizedArray = [];
for (let i = 0; i < obj.length; i++) {
const item = obj[i];
if (typeof item === 'function') continue;
const sanitized = sanitizeForFirestore(item, depth + 1);
if (sanitized !== null && sanitized !== undefined) {
sanitizedArray.push(sanitized);
}
}
return sanitizedArray;
}
const sanitized = {};
try {
for (const key in obj) {
if (!obj.hasOwnProperty(key)) continue;
const value = obj[key];
if (!key || typeof key !== 'string') {
continue;
}
if (typeof value === 'function') {
continue;
}
let cleanKey = key;
if (typeof key !== 'string') {
cleanKey = String(key);
}
cleanKey = cleanKey.replace(/[\.\$#\[\]\/\\]/g, '_');
if (!cleanKey) continue;
if (cleanKey === 'id') {
if (value === null || value === undefined) {
sanitized[cleanKey] = '';
} else {
try {
sanitized[cleanKey] = String(value);
} catch (e) {
sanitized[cleanKey] = '';
}
}
continue;
}
if (cleanKey === 'amount' || cleanKey === 'quantity' || cleanKey === 'price' || cleanKey === 'cost') {
const num = parseFloat(value);
sanitized[cleanKey] = (isNaN(num) || !isFinite(num)) ? 0 : num;
continue;
}
if (cleanKey === 'timestamp' || cleanKey === 'createdAt' || cleanKey === 'updatedAt') {
if (value instanceof Date) {
sanitized[cleanKey] = value.toISOString();
} else if (typeof value === 'string' || typeof value === 'number') {
sanitized[cleanKey] = value;
} else {
sanitized[cleanKey] = new Date().toISOString();
}
continue;
}
const sanitizedValue = sanitizeForFirestore(value, depth + 1);
if (sanitizedValue !== null && sanitizedValue !== undefined) {
if (typeof sanitizedValue === 'object' && !Array.isArray(sanitizedValue)) {
const isFactorySettings = cleanKey === 'default_formulas' ||
cleanKey === 'additional_costs' ||
cleanKey === 'cost_adjustment_factor' ||
cleanKey === 'sale_prices' ||
cleanKey === 'unit_tracking' ||
cleanKey === 'standard' ||
cleanKey === 'asaan';
if (Object.keys(sanitizedValue).length > 0 || isFactorySettings) {
sanitized[cleanKey] = sanitizedValue;
}
} else if (Array.isArray(sanitizedValue)) {
sanitized[cleanKey] = sanitizedValue;
} else {
sanitized[cleanKey] = sanitizedValue;
}
}
}
} catch (e) {
return {};
}
return sanitized;
}
function mergeArraysByTimestamp(localArray, cloudArray) {
const merged = [...localArray];

const mergedIndexMap = new Map(merged.map((item, idx) => [item.id, idx]));
const localIds = new Set(localArray.map(item => item.id));
let downloadedCount = 0;
let updatedCount = 0;
let fixedCount = 0;
const getComparableTimestamp = (item) => {
const ts = item.updatedAt !== undefined ? item.updatedAt
         : item.timestamp !== undefined ? item.timestamp
         : item.createdAt;
if (!ts) return 0;
if (ts && typeof ts.toMillis === 'function') return ts.toMillis();
if (ts && typeof ts.seconds === 'number') return ts.seconds * 1000;
if (ts instanceof Date) return ts.getTime();
if (typeof ts === 'number') return ts;
if (typeof ts === 'string') return new Date(ts).getTime();
return 0;
};
for (let cloudItem of cloudArray) {
if (!cloudItem.id || cloudItem.id === '_placeholder_' || cloudItem._placeholder) continue;
if (!validateUUID(cloudItem.id)) {
cloudItem = ensureRecordIntegrity(cloudItem, false, true);
fixedCount++;
}
const cloudTimestamp = getComparableTimestamp(cloudItem);
if (!localIds.has(cloudItem.id)) {
cloudItem = ensureRecordIntegrity(cloudItem, false, true);

mergedIndexMap.set(cloudItem.id, merged.length);
merged.push(cloudItem);
downloadedCount++;
} else {

const index = mergedIndexMap.get(cloudItem.id);
const localItem = merged[index];
const localTimestamp = getComparableTimestamp(localItem);
if (cloudTimestamp > localTimestamp) {
cloudItem = ensureRecordIntegrity(cloudItem, false, true);
merged[index] = cloudItem;
updatedCount++;
}
}
}
const validatedMerged = merged.map(item => {
if (!item.id || !validateUUID(item.id)) {
item = ensureRecordIntegrity(item, false, true);
fixedCount++;
}
return item;
});
if (downloadedCount > 0 || updatedCount > 0 || fixedCount > 0) {
}
return validatedMerged;
}
async function performOneClickSync(silent = false) {
if (!firebaseDB) {
if (!silent) {
showToast(" Connecting to Cloud... Please wait.", "info");
initializeFirebaseSystem();
}
return;
}
if (!currentUser) {
if (!silent) {
showToast("Please log in to sync data", "warning");
}
return;
}
if (isSyncing) {
return;
}
isSyncing = true;
const btn = document.getElementById('sync-btn');
const originalText = btn ? btn.innerHTML : '';
if (!silent && btn) {
btn.innerHTML = 'Syncing...';
}
if (!silent) {
showToast("Syncing....", "info");
}
(async () => {
try {
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
const currentAppMode = appMode || 'admin';
const isRepMode = currentAppMode === 'rep';
const getAccessibleCollections = () => {
return {
download: ['production', 'sales', 'calculator_history', 'rep_sales', 'rep_customers',
'transactions', 'entities', 'inventory', 'factory_history', 'returns', 'expenses'],
upload: ['production', 'sales', 'calculator_history', 'rep_sales', 'rep_customers',
'transactions', 'entities', 'inventory', 'factory_history', 'returns', 'expenses'],
settings: ['settings', 'factorySettings', 'expenseCategories']
};
};
const accessibleCollections = getAccessibleCollections();
let userType = 'returning';
const hasInitialized = await idb.get('firestore_initialized');
const idbCounts = await Promise.all([
idb.get('mfg_pro_pkr', []),
idb.get('customer_sales', []),
idb.get('rep_sales', []),
idb.get('noman_history', []),
idb.get('payment_transactions', []),
idb.get('payment_entities', []),
idb.get('factory_inventory_data', []),
idb.get('factory_production_history', []),
idb.get('stock_returns', []),
idb.get('rep_customers', []),
idb.get('expenses', [])
]);
const totalLocalRecords = idbCounts.reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
const isLocalDataEmpty = totalLocalRecords === 0;
const shouldCheckFirestore = !hasInitialized || isLocalDataEmpty;
if (shouldCheckFirestore) {
try {
const [productionCheck, salesCheck, transactionsCheck, repSalesCheck, entitiesCheck, inventoryCheck, expensesCheck] = await Promise.all([
userRef.collection('production').limit(20).get(),
userRef.collection('sales').limit(20).get(),
userRef.collection('transactions').limit(20).get(),
userRef.collection('rep_sales').limit(20).get(),
userRef.collection('entities').limit(20).get(),
userRef.collection('inventory').limit(20).get(),
userRef.collection('expenses').limit(20).get()
]);
const hasRealData =
productionCheck.docs.some(doc => !doc.data()._placeholder) ||
salesCheck.docs.some(doc => !doc.data()._placeholder) ||
transactionsCheck.docs.some(doc => !doc.data()._placeholder) ||
repSalesCheck.docs.some(doc => !doc.data()._placeholder) ||
entitiesCheck.docs.some(doc => !doc.data()._placeholder) ||
inventoryCheck.docs.some(doc => !doc.data()._placeholder) ||
expensesCheck.docs.some(doc => !doc.data()._placeholder);
if (hasRealData) {
userType = 'existing';
} else {
userType = 'new';
}
} catch (error) {
userType = hasInitialized ? 'returning' : 'new';
}
} else {
userType = 'returning';
}
if (userType === 'new') {
await initializeFirestoreStructure(true);
await idb.set('firestore_initialized', true);
await idb.set('user_state', {
type: 'new',
hasRealData: false,
lastChecked: Date.now(),
initialized: true
});
if (!silent) {
showToast('Your account is ready!', 'success');
}
isSyncing = false;
if (!silent && btn) {
btn.innerHTML = originalText;
}
return;
}
const buildDeltaQuery = async (collection, collectionName) => {
if (userType === 'existing') {
return collection.get();
}
const lastSync = await DeltaSync.getLastSyncFirestoreTimestamp(collectionName);
if (lastSync) {
return collection.where('updatedAt', '>', lastSync).get();
}
return collection.get();
};
const [settingsSnap, factorySettingsSnap, expenseCategoriesSnap] = await Promise.all([
userRef.collection('settings').doc('config').get(),
userRef.collection('factorySettings').doc('config').get(),
userRef.collection('expenseCategories').doc('categories').get()
]);
let productionSnap = null, salesSnap = null, calcHistorySnap = null;
let repSalesSnap = null, repCustomersSnap = null, salesCustomersSnap = null;
let transactionsSnap = null, entitiesSnap = null;
let inventorySnap = null, factoryHistorySnap = null;
let expensesSnap = null, returnsSnap = null;
productionSnap = await buildDeltaQuery(userRef.collection('production'), 'production');
salesSnap = await buildDeltaQuery(userRef.collection('sales'), 'sales');
calcHistorySnap = await buildDeltaQuery(userRef.collection('calculator_history'), 'calculator_history');
[repSalesSnap, repCustomersSnap] = await Promise.all([
buildDeltaQuery(userRef.collection('rep_sales'), 'rep_sales'),
buildDeltaQuery(userRef.collection('rep_customers'), 'rep_customers')
]);
salesCustomersSnap = await buildDeltaQuery(userRef.collection('sales_customers'), 'sales_customers');
[transactionsSnap, entitiesSnap] = await Promise.all([
buildDeltaQuery(userRef.collection('transactions'), 'transactions'),
buildDeltaQuery(userRef.collection('entities'), 'entities')
]);
[inventorySnap, factoryHistorySnap] = await Promise.all([
buildDeltaQuery(userRef.collection('inventory'), 'inventory'),
buildDeltaQuery(userRef.collection('factory_history'), 'factory_history')
]);
[expensesSnap, returnsSnap] = await Promise.all([
buildDeltaQuery(userRef.collection('expenses'), 'expenses'),
buildDeltaQuery(userRef.collection('returns'), 'returns')
]);
trackFirestoreRead(11);
trackFirestoreRead(3);
const extractDocs = (snap) => {
if (!snap) return [];
return snap.docs
.map(doc => ({ id: doc.id, ...doc.data() }))
.filter(doc => !doc._placeholder);
};
const cloudData = {
mfg_pro_pkr: extractDocs(productionSnap),
customer_sales: extractDocs(salesSnap),
noman_history: extractDocs(calcHistorySnap),
rep_sales: extractDocs(repSalesSnap),
rep_customers: extractDocs(repCustomersSnap),
sales_customers: extractDocs(salesCustomersSnap),
payment_transactions: extractDocs(transactionsSnap),
payment_entities: extractDocs(entitiesSnap),
factory_inventory_data: extractDocs(inventorySnap),
factory_production_history: extractDocs(factoryHistorySnap),
stock_returns: extractDocs(returnsSnap),
expenses: extractDocs(expensesSnap)
};
let totalCloudChanges = 0;
Object.values(cloudData).forEach(arr => {
totalCloudChanges += (arr?.length || 0);
});
if (totalCloudChanges === 0) {
if (settingsSnap && settingsSnap.exists) {
const settingsData = settingsSnap.data();
if (settingsData && typeof settingsData === 'object') {
if (settingsData.naswar_default_settings) {
defaultSettings = settingsData.naswar_default_settings;
await idb.set('naswar_default_settings', defaultSettings);
}
}
}
if (factorySettingsSnap && factorySettingsSnap.exists) {
const fsData = factorySettingsSnap.data();
if (fsData && typeof fsData === 'object') {
if (fsData.default_formulas) { factoryDefaultFormulas = fsData.default_formulas; await idb.set('factory_default_formulas', factoryDefaultFormulas); }
if (fsData.additional_costs) { factoryAdditionalCosts = fsData.additional_costs; await idb.set('factory_additional_costs', factoryAdditionalCosts); }
if (fsData.cost_adjustment_factor) { factoryCostAdjustmentFactor = fsData.cost_adjustment_factor; await idb.set('factory_cost_adjustment_factor', factoryCostAdjustmentFactor); }
if (fsData.sale_prices) { factorySalePrices = fsData.sale_prices; await idb.set('factory_sale_prices', factorySalePrices); }
if (fsData.unit_tracking) { factoryUnitTracking = fsData.unit_tracking; await idb.set('factory_unit_tracking', factoryUnitTracking); }
}
}
if (expenseCategoriesSnap && expenseCategoriesSnap.exists) {
const expenseCategoriesData = expenseCategoriesSnap.data();
if (expenseCategoriesData && expenseCategoriesData.categories) {
expenseCategories = expenseCategoriesData.categories;
await idb.set('expense_categories', expenseCategories);
}
}
} else {
if (settingsSnap && settingsSnap.exists) {
const settingsData = settingsSnap.data();
if (settingsData && typeof settingsData === 'object') {
if (settingsData.naswar_default_settings) {
defaultSettings = settingsData.naswar_default_settings;
await idb.set('naswar_default_settings', defaultSettings);
}
}
}
if (expenseCategoriesSnap && expenseCategoriesSnap.exists) {
const expenseCategoriesData = expenseCategoriesSnap.data();
if (expenseCategoriesData && expenseCategoriesData.categories) {
expenseCategories = expenseCategoriesData.categories;
await idb.set('expense_categories', expenseCategories);
}
}
db = mergeArraysByTimestamp(db || [], cloudData.mfg_pro_pkr || []);
customerSales = mergeArraysByTimestamp(customerSales || [], cloudData.customer_sales || []);
salesHistory = mergeArraysByTimestamp(salesHistory || [], cloudData.noman_history || []);
repSales = mergeArraysByTimestamp(repSales || [], cloudData.rep_sales || []);
repCustomers = mergeArraysByTimestamp(repCustomers || [], cloudData.rep_customers || []);
salesCustomers = mergeArraysByTimestamp(salesCustomers || [], cloudData.sales_customers || []);
paymentTransactions = mergeArraysByTimestamp(paymentTransactions || [], cloudData.payment_transactions || []);
paymentEntities = mergeArraysByTimestamp(paymentEntities || [], cloudData.payment_entities || []);
factoryInventoryData = mergeArraysByTimestamp(factoryInventoryData || [], cloudData.factory_inventory_data || []);
factoryProductionHistory = mergeArraysByTimestamp(factoryProductionHistory || [], cloudData.factory_production_history || []);
stockReturns = mergeArraysByTimestamp(stockReturns || [], cloudData.stock_returns || []);
expenseRecords = mergeArraysByTimestamp(expenseRecords || [], cloudData.expenses || []);
const _notDeleted = item => !deletedRecordIds.has(item.id);
db = db.filter(_notDeleted);
customerSales = customerSales.filter(_notDeleted);
salesHistory = salesHistory.filter(_notDeleted);
repSales = repSales.filter(_notDeleted);
repCustomers = repCustomers.filter(_notDeleted);
salesCustomers = salesCustomers.filter(_notDeleted);
paymentTransactions = paymentTransactions.filter(_notDeleted);
paymentEntities = paymentEntities.filter(_notDeleted);
factoryInventoryData = factoryInventoryData.filter(_notDeleted);
factoryProductionHistory = factoryProductionHistory.filter(_notDeleted);
stockReturns = stockReturns.filter(_notDeleted);
expenseRecords = expenseRecords.filter(_notDeleted);
['production','sales','calculator_history','transactions','entities',
'inventory','factory_history','returns','expenses','rep_sales','rep_customers',
'sales_customers','deletions'
].reduce((p, c) => p.then(() => DeltaSync.updateSyncStats(c)), Promise.resolve());
await idb.set('mfg_pro_pkr', db);
await idb.set('customer_sales', customerSales);
await idb.set('noman_history', salesHistory);
await idb.set('factory_inventory_data', factoryInventoryData);
await idb.set('factory_production_history', factoryProductionHistory);
await idb.set('payment_entities', paymentEntities);
await idb.set('payment_transactions', paymentTransactions);
await idb.set('expenses', expenseRecords);
await idb.set('stock_returns', stockReturns);
await idb.set('rep_sales', repSales);
await idb.set('rep_customers', repCustomers);
await idb.set('sales_customers', salesCustomers);
await idb.set('deleted_records', Array.from(deletedRecordIds));
await idb.set('last_synced', new Date().toISOString());
for (const collection of ['production', 'sales', 'calculator_history', 'transactions',
'entities', 'inventory', 'factory_history', 'returns', 'expenses',
'rep_sales', 'rep_customers', 'sales_customers', 'deletions']) {
await DeltaSync.setLastSyncTimestamp(collection);
}
if (userType === 'existing') {
await idb.set('firestore_initialized', true);
await idb.set('user_state', {
type: 'existing',
hasRealData: true,
lastChecked: Date.now(),
initialized: true,
restoredItems: totalCloudChanges
});
['production','sales','calculator_history','transactions','entities',
'inventory','factory_history','returns','expenses','rep_sales',
'rep_customers','sales_customers','deletions'
].reduce((p, c) => p.then(() => DeltaSync.setLastSyncTimestamp(c)), Promise.resolve());
}
}
if (userType === 'existing') {
setTimeout(() => {
if (typeof refreshAllDisplays === 'function') {
refreshAllDisplays();
}
}, 100);
if (!silent) {
const message = `Data fully restored — ${totalCloudChanges} records downloaded`;
showToast(message, 'success');
if(typeof closeDataMenu === 'function') closeDataMenu();
}
setTimeout(async () => {
try {
if (typeof validateAllDataOnStartup === 'function') {
await validateAllDataOnStartup();
}
} catch (error) {
console.error('Data validation encountered an error:', error);
}
}, 2000);
isSyncing = false;
if (!silent && btn) {
btn.innerHTML = originalText;
}
return;
}
const batch = firebaseDB.batch();
let operationCount = 0;
const batches = [batch];
const getCurrentBatch = () => {
if (operationCount >= 450) {
batches.push(firebaseDB.batch());
operationCount = 0;
}
return batches[batches.length - 1];
};
const isRealRecord = (item) => item && item.id && !item._placeholder && item.id !== '_placeholder_';
const collections = {
'production': db.filter(isRealRecord), 'sales': customerSales.filter(isRealRecord), 'rep_sales': repSales.filter(isRealRecord), 'rep_customers': repCustomers.filter(isRealRecord),
'calculator_history': salesHistory.filter(isRealRecord), 'inventory': factoryInventoryData.filter(isRealRecord),
'factory_history': factoryProductionHistory.filter(isRealRecord), 'entities': paymentEntities.filter(isRealRecord),
'transactions': paymentTransactions.filter(isRealRecord), 'expenses': expenseRecords.filter(isRealRecord), 'returns': stockReturns.filter(isRealRecord)
};
let totalItemsToWrite = 0;
let collectionIndex = 0;
const collectionEntries = Object.entries(collections);
const collectionNameMap = {
'production': 'production',
'sales': 'sales',
'calculator_history': 'calculator_history',
'rep_sales': 'rep_sales',
'rep_customers': 'rep_customers',
'inventory': 'inventory',
'factory_history': 'factory_history',
'entities': 'entities',
'transactions': 'transactions',
'expenses': 'expenses',
'returns': 'returns'
};
for (const [collectionName, dataArray] of collectionEntries) {
if (!collectionName || typeof collectionName !== 'string') {
continue;
}
if (Array.isArray(dataArray) && dataArray.length > 0) {
const deltaName = collectionNameMap[collectionName] || collectionName;
const changedItems = await DeltaSync.getChangedItems(deltaName, dataArray);
if (changedItems.length === 0) {
continue;
}
let uploadedCount = 0;
for (let i = 0; i < changedItems.length; i++) {
const item = changedItems[i];
if (item && item.id) {
try {
const docId = String(item.id);
const currentBatch = getCurrentBatch();
if (!docId || docId.includes('/')) {
continue;
}
const sanitizedItem = sanitizeForFirestore(item);
sanitizedItem.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
if (!sanitizedItem || typeof sanitizedItem !== 'object' || Object.keys(sanitizedItem).length === 0) {
continue;
}
if (sanitizedItem.id && typeof sanitizedItem.id !== 'string') {
sanitizedItem.id = String(sanitizedItem.id);
}
currentBatch.set(userRef.collection(collectionName).doc(docId), sanitizedItem, { merge: true });
operationCount++;
uploadedCount++;
totalItemsToWrite++;
trackFirestoreWrite(1);
if (i > 0 && i % 50 === 0) {
}
} catch (itemError) {
console.warn('Cloud save operation failed.', itemError);
}
}
}
if (uploadedCount > 0) {
}
}
collectionIndex++;
if (collectionIndex < collectionEntries.length) {
}
}
if (factorySettingsSnap && factorySettingsSnap.exists) {
const factorySettingsData = factorySettingsSnap.data();
if (factorySettingsData && typeof factorySettingsData === 'object') {
const timestamp = getTimestamp();
if (factorySettingsData.default_formulas) {
const formulas = factorySettingsData.default_formulas;
if (('standard' in formulas) && ('asaan' in formulas)) {
factoryDefaultFormulas = {
standard: Array.isArray(formulas.standard) ? formulas.standard : [],
asaan: Array.isArray(formulas.asaan) ? formulas.asaan : []
};
await idb.set('factory_default_formulas', factoryDefaultFormulas);
await idb.set('factory_default_formulas_timestamp',
factorySettingsData.default_formulas_timestamp || timestamp);
}
}
if (factorySettingsData.additional_costs) {
const costs = factorySettingsData.additional_costs;
if (('standard' in costs) && ('asaan' in costs)) {
factoryAdditionalCosts = {
standard: parseFloat(costs.standard) || 0,
asaan: parseFloat(costs.asaan) || 0
};
await idb.set('factory_additional_costs', factoryAdditionalCosts);
await idb.set('factory_additional_costs_timestamp',
factorySettingsData.additional_costs_timestamp || timestamp);
}
}
if (factorySettingsData.sale_prices) {
const prices = factorySettingsData.sale_prices;
if (('standard' in prices) && ('asaan' in prices)) {
factorySalePrices = {
standard: parseFloat(prices.standard) || 0,
asaan: parseFloat(prices.asaan) || 0
};
await idb.set('factory_sale_prices', factorySalePrices);
await idb.set('factory_sale_prices_timestamp',
factorySettingsData.sale_prices_timestamp || timestamp);
}
}
if (factorySettingsData.cost_adjustment_factor) {
const factor = factorySettingsData.cost_adjustment_factor;
if (('standard' in factor) && ('asaan' in factor)) {
factoryCostAdjustmentFactor = {
standard: parseFloat(factor.standard) || 1,
asaan: parseFloat(factor.asaan) || 1
};
await idb.set('factory_cost_adjustment_factor', factoryCostAdjustmentFactor);
await idb.set('factory_cost_adjustment_factor_timestamp',
factorySettingsData.cost_adjustment_factor_timestamp || timestamp);
}
}
if (factorySettingsData.unit_tracking) {
const tracking = factorySettingsData.unit_tracking;
if (('standard' in tracking) && ('asaan' in tracking)) {
const validateTrackingData = (data) => ({
produced: parseFloat(data?.produced) || 0,
consumed: parseFloat(data?.consumed) || 0,
available: parseFloat(data?.available) || 0,
unitCostHistory: Array.isArray(data?.unitCostHistory) ? data.unitCostHistory : []
});
factoryUnitTracking = {
standard: validateTrackingData(tracking.standard),
asaan: validateTrackingData(tracking.asaan)
};
await idb.set('factory_unit_tracking', factoryUnitTracking);
await idb.set('factory_unit_tracking_timestamp',
factorySettingsData.unit_tracking_timestamp || timestamp);
}
}
if (isRepMode) {
}
refreshFactorySettingsOverlay();
}
}
if (totalItemsToWrite === 0) {
if (!silent) {
showToast(" Already synced ", "success");
}
setTimeout(() => {
if (typeof refreshAllDisplays === 'function') {
refreshAllDisplays();
}
}, 100);
isSyncing = false;
if (!silent && btn) {
btn.innerHTML = originalText;
}
return;
}
const configBatch = getCurrentBatch();
const syncLocalFormulaTs = await idb.get('factory_default_formulas_timestamp');
const syncLocalCostsTs = await idb.get('factory_additional_costs_timestamp');
const syncLocalFactorTs = await idb.get('factory_cost_adjustment_factor_timestamp');
const syncLocalPricesTs = await idb.get('factory_sale_prices_timestamp');
const syncDeviceHasFactoryData = syncLocalFormulaTs || syncLocalCostsTs || syncLocalFactorTs || syncLocalPricesTs;
if (syncDeviceHasFactoryData) {
const factorySettingsPayload = {
default_formulas: factoryDefaultFormulas || { standard: [], asaan: [] },
additional_costs: factoryAdditionalCosts || { standard: 0, asaan: 0 },
sale_prices: factorySalePrices || { standard: 0, asaan: 0 }
};
configBatch.set(userRef.collection('factorySettings').doc('config'), sanitizeForFirestore(factorySettingsPayload), { merge: true });
} else {
}
const settingsPayload = {
naswar_default_settings: defaultSettings || {},
};
const expenseCategoriesPayload = {
categories: expenseCategories || []
};
configBatch.set(userRef.collection('settings').doc('config'), sanitizeForFirestore(settingsPayload), { merge: true });
configBatch.set(userRef.collection('expenseCategories').doc('categories'), sanitizeForFirestore(expenseCategoriesPayload), { merge: true });
for (let i = 0; i < batches.length; i++) {
await batches[i].commit();
if (i < batches.length - 1) {
}
}
setTimeout(() => {
if (typeof refreshAllDisplays === 'function') {
refreshAllDisplays();
}
}, 100);
const syncSummary = {
mode: currentAppMode,
downloaded: totalCloudChanges,
uploaded: totalItemsToWrite,
optimized: (totalCloudChanges === 0 ? 'Skipped merge/save' : 'Processed') +
' | ' +
(totalItemsToWrite === 0 ? 'Skipped upload' : `Uploaded ${totalItemsToWrite} items`) +
` | ${currentAppMode.toUpperCase()} MODE`
};
if (!silent) {
let message;
const modeLabel = `[${currentAppMode.toUpperCase()}] `;
if (userType === 'existing') {
message = `${modeLabel} Your data has been fully restored (${totalCloudChanges} items)`;
} else {
message = totalCloudChanges === 0 && totalItemsToWrite === 0
? `${modeLabel} Already synced - no changes needed`
: totalCloudChanges === 0
? `${modeLabel} Uploaded ${totalItemsToWrite} local changes`
: totalItemsToWrite === 0
? `${modeLabel} Downloaded ${totalCloudChanges} cloud changes`
: `${modeLabel} Synced ${totalCloudChanges} down, ${totalItemsToWrite} up`;
}
showToast(message, "success");
if(typeof closeDataMenu === 'function') closeDataMenu();
}
setTimeout(async () => {
try {
if (typeof validateAllDataOnStartup === 'function') {
await validateAllDataOnStartup();
}
} catch (error) {
console.error('Data validation encountered an error.', error);
showToast('Data validation encountered an error.', 'error');
}
}, 2000);
} catch (e) {
if (!silent) showToast(" Sync error - will retry automatically", "warning");
} finally {
isSyncing = false;
if (!silent && btn) {
btn.innerHTML = originalText;
}
_flushSyncLockQueue().catch(err => console.warn('[SyncLock] Flush error', err));
}
})();
}
async function pushDataToCloud(silent = false) {
if (!firebaseDB || !currentUser) {
if (!silent) showToast('Please sign in to sync data', 'warning');
return;
}
if (isSyncing) {
return;
}
isSyncing = true;
let btn = null;
let originalText = '';
const pushTimeout = setTimeout(() => {
isSyncing = false;
if (!silent) {
showToast(" Upload timeout - Please try again", "warning");
if (btn) {
btn.innerText = originalText;
btn.disabled = false;
}
}
}, 300000);
try {
if (!silent) {
const menuBtn = document.querySelector('#dataMenuOverlay .btn-main');
if (menuBtn) {
btn = menuBtn;
originalText = btn.innerText;
btn.textContent = ' Uploading...';
btn.disabled = true;
} else {
showToast(' Starting upload - app remains usable...', 'info');
}
}
let progressInterval = null;
if (!silent) {
let progressStep = 0;
const progressMessages = [
" Preparing data...",
" Uploading to cloud...",
" Syncing collections...",
"Finalizing upload..."
];
progressInterval = setInterval(() => {
if (progressStep < progressMessages.length) {
showToast(progressMessages[progressStep], "info");
progressStep++;
}
}, 30000);
}
await idb.init();
const dataKeys = [
'mfg_pro_pkr',
'customer_sales',
'rep_sales',
'rep_customers',
'noman_history',
'factory_inventory_data',
'factory_production_history',
'payment_entities',
'payment_transactions',
'stock_returns',
'expenses',
'sales_customers',
'factory_default_formulas',
'factory_additional_costs',
'factory_cost_adjustment_factor',
'factory_sale_prices',
'factory_unit_tracking',
'naswar_default_settings',
'deleted_records'
];
let freshDataMap = new Map();
if (idb.getBatch) {
freshDataMap = await idb.getBatch(dataKeys);
} else {
for (const key of dataKeys) {
const value = await idb.get(key);
if (value !== null) {
freshDataMap.set(key, value);
}
}
}
if (freshDataMap.get('mfg_pro_pkr')) db = freshDataMap.get('mfg_pro_pkr');
if (freshDataMap.get('customer_sales')) customerSales = freshDataMap.get('customer_sales');
if (freshDataMap.get('rep_sales')) repSales = freshDataMap.get('rep_sales');
if (freshDataMap.get('rep_customers')) repCustomers = freshDataMap.get('rep_customers');
if (freshDataMap.get('noman_history')) salesHistory = freshDataMap.get('noman_history');
if (freshDataMap.get('factory_inventory_data')) factoryInventoryData = freshDataMap.get('factory_inventory_data');
if (freshDataMap.get('factory_production_history')) factoryProductionHistory = freshDataMap.get('factory_production_history');
if (freshDataMap.get('payment_entities')) paymentEntities = freshDataMap.get('payment_entities');
if (freshDataMap.get('payment_transactions')) paymentTransactions = freshDataMap.get('payment_transactions');
if (freshDataMap.get('stock_returns')) stockReturns = freshDataMap.get('stock_returns');
if (freshDataMap.get('expenses')) expenseRecords = freshDataMap.get('expenses');
if (freshDataMap.get('sales_customers')) salesCustomers = freshDataMap.get('sales_customers');
if (freshDataMap.get('factory_default_formulas')) factoryDefaultFormulas = freshDataMap.get('factory_default_formulas');
if (freshDataMap.get('factory_additional_costs')) factoryAdditionalCosts = freshDataMap.get('factory_additional_costs');
if (freshDataMap.get('factory_cost_adjustment_factor')) factoryCostAdjustmentFactor = freshDataMap.get('factory_cost_adjustment_factor');
if (freshDataMap.get('factory_sale_prices')) factorySalePrices = freshDataMap.get('factory_sale_prices');
if (freshDataMap.get('factory_unit_tracking')) factoryUnitTracking = freshDataMap.get('factory_unit_tracking');
if (freshDataMap.get('naswar_default_settings')) defaultSettings = freshDataMap.get('naswar_default_settings');
if (freshDataMap.get('deleted_records')) {
deletedRecordIds = new Set(freshDataMap.get('deleted_records'));
}
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
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
const isRealRecord = (item) => item && item.id && !item._placeholder && item.id !== '_placeholder_';
const collections = {
'production': db.filter(item => isRealRecord(item) && !deletedRecordIds.has(item.id)),
'sales': customerSales.filter(item => isRealRecord(item) && !deletedRecordIds.has(item.id)),
'rep_sales': repSales.filter(item => isRealRecord(item) && !deletedRecordIds.has(item.id)),
'rep_customers': repCustomers.filter(item => isRealRecord(item) && !deletedRecordIds.has(item.id)),
'calculator_history': salesHistory.filter(item => isRealRecord(item) && !deletedRecordIds.has(item.id)),
'inventory': factoryInventoryData.filter(item => isRealRecord(item) && !deletedRecordIds.has(item.id)),
'factory_history': factoryProductionHistory.filter(item => isRealRecord(item) && !deletedRecordIds.has(item.id)),
'entities': paymentEntities.filter(item => isRealRecord(item) && !deletedRecordIds.has(item.id)),
'transactions': paymentTransactions.filter(item => isRealRecord(item) && !deletedRecordIds.has(item.id)),
'expenses': expenseRecords.filter(item => isRealRecord(item) && !deletedRecordIds.has(item.id)),
'returns': stockReturns.filter(item => isRealRecord(item) && !deletedRecordIds.has(item.id)),
'sales_customers': salesCustomers.filter(item => isRealRecord(item) && !deletedRecordIds.has(item.id))
};
for (const [collectionName, dataArray] of Object.entries(collections)) {
if (!collectionName || typeof collectionName !== 'string') {
continue;
}
if (Array.isArray(dataArray)) {
const deltaName = collectionName;
const itemsToUpload = await DeltaSync.getChangedItems(deltaName, dataArray);
if (itemsToUpload.length === 0) {
continue;
}
for (const item of itemsToUpload) {
if (item && item.id) {
try {
const batch = getCurrentBatch();
let docId = String(item.id);
if (!docId || docId.includes('/')) {
continue;
}
const docRef = userRef.collection(collectionName).doc(docId);
const sanitizedItem = sanitizeForFirestore(item);
sanitizedItem.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
if (!sanitizedItem || typeof sanitizedItem !== 'object' || Object.keys(sanitizedItem).length === 0) {
continue;
}
if (sanitizedItem.id && typeof sanitizedItem.id !== 'string') {
sanitizedItem.id = String(sanitizedItem.id);
}
batch.set(docRef, sanitizedItem, { merge: true });
operationCount++;
trackFirestoreWrite(1);
} catch (itemError) {
console.warn('Failed to write batch item to Firestore', itemError);
}
}
}
// deltaName will be stamped after successful commit (see below)
DeltaSync.clearDirty(deltaName);
}
}
const deletionRecords = await idb.get('deletion_records', []);
const unsyncedDeletions = deletionRecords.filter(record => !record.syncedToCloud);
if (unsyncedDeletions.length > 0) {
for (const deletionRecord of unsyncedDeletions) {
if (!deletionRecord.id) continue;
const deletedAtMs = typeof deletionRecord.deletedAt === 'number' && deletionRecord.deletedAt > 0
? deletionRecord.deletedAt
: Date.now();
try {
const batch = getCurrentBatch();
const deletionsRef = userRef.collection('deletions').doc(String(deletionRecord.id));
batch.set(deletionsRef, {
id: String(deletionRecord.id),
deletedAt: firebase.firestore.Timestamp.fromMillis(deletedAtMs),
collection: deletionRecord.collection || 'unknown',
expiresAt: firebase.firestore.Timestamp.fromMillis(deletedAtMs + (90 * 24 * 60 * 60 * 1000))
});
operationCount++;
if (deletionRecord.collection && deletionRecord.collection !== 'unknown') {
const itemRef = userRef.collection(deletionRecord.collection).doc(String(deletionRecord.id));
batch.delete(itemRef);
operationCount++;
}
deletionRecord.syncedToCloud = true;
} catch (error) {
console.warn('Could not queue deletion record for sync:', deletionRecord.id, error);
}
}
await idb.set('deletion_records', deletionRecords);
}
const now = new Date().toISOString();
const batch = getCurrentBatch();
const ensureFactorySettings = (obj, defaultVal) => {
if (!obj || typeof obj !== 'object') {
return defaultVal;
}
if (Array.isArray(obj)) {
return defaultVal;
}
const hasStandard = ('standard' in obj) && obj.standard !== undefined;
const hasAsaan = ('asaan' in obj) && obj.asaan !== undefined;
if (!hasStandard || !hasAsaan) {
return defaultVal;
}
return {
standard: obj.standard,
asaan: obj.asaan
};
};
const localFormulaTs = await idb.get('factory_default_formulas_timestamp');
const localCostsTs = await idb.get('factory_additional_costs_timestamp');
const localFactorTs = await idb.get('factory_cost_adjustment_factor_timestamp');
const localPricesTs = await idb.get('factory_sale_prices_timestamp');
const localTrackingTs = await idb.get('factory_unit_tracking_timestamp');
const deviceHasLocalFactoryData = localFormulaTs || localCostsTs || localFactorTs || localPricesTs || localTrackingTs;
let sanitizedFactorySettings = null;
const factorySettingsRef = userRef.collection('factorySettings').doc('config');
if (deviceHasLocalFactoryData) {
const factorySettingsPayload = {
default_formulas: ensureFactorySettings(factoryDefaultFormulas, { standard: [], asaan: [] }),
default_formulas_timestamp: localFormulaTs || getTimestamp(),
additional_costs: ensureFactorySettings(factoryAdditionalCosts, { standard: 0, asaan: 0 }),
additional_costs_timestamp: localCostsTs || getTimestamp(),
cost_adjustment_factor: ensureFactorySettings(factoryCostAdjustmentFactor, { standard: 1, asaan: 1 }),
cost_adjustment_factor_timestamp: localFactorTs || getTimestamp(),
sale_prices: ensureFactorySettings(factorySalePrices, { standard: 0, asaan: 0 }),
sale_prices_timestamp: localPricesTs || getTimestamp(),
unit_tracking: ensureFactorySettings(factoryUnitTracking, {
standard: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
asaan: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] }
}),
unit_tracking_timestamp: localTrackingTs || getTimestamp(),
last_synced: now
};
sanitizedFactorySettings = sanitizeForFirestore(factorySettingsPayload);
} else {
try {
const cloudFactorySnap = await factorySettingsRef.get();
if (cloudFactorySnap.exists) {
const cfs = cloudFactorySnap.data();
if (cfs && typeof cfs === 'object') {
if (cfs.default_formulas && ('standard' in cfs.default_formulas) && ('asaan' in cfs.default_formulas)) {
factoryDefaultFormulas = { standard: Array.isArray(cfs.default_formulas.standard) ? cfs.default_formulas.standard : [], asaan: Array.isArray(cfs.default_formulas.asaan) ? cfs.default_formulas.asaan : [] };
await idb.setBatch([['factory_default_formulas', factoryDefaultFormulas], ['factory_default_formulas_timestamp', cfs.default_formulas_timestamp || Date.now()]]);
}
if (cfs.additional_costs && ('standard' in cfs.additional_costs) && ('asaan' in cfs.additional_costs)) {
factoryAdditionalCosts = { standard: parseFloat(cfs.additional_costs.standard) || 0, asaan: parseFloat(cfs.additional_costs.asaan) || 0 };
await idb.setBatch([['factory_additional_costs', factoryAdditionalCosts], ['factory_additional_costs_timestamp', cfs.additional_costs_timestamp || Date.now()]]);
}
if (cfs.cost_adjustment_factor && ('standard' in cfs.cost_adjustment_factor) && ('asaan' in cfs.cost_adjustment_factor)) {
factoryCostAdjustmentFactor = { standard: parseFloat(cfs.cost_adjustment_factor.standard) || 1, asaan: parseFloat(cfs.cost_adjustment_factor.asaan) || 1 };
await idb.setBatch([['factory_cost_adjustment_factor', factoryCostAdjustmentFactor], ['factory_cost_adjustment_factor_timestamp', cfs.cost_adjustment_factor_timestamp || Date.now()]]);
}
if (cfs.sale_prices && ('standard' in cfs.sale_prices) && ('asaan' in cfs.sale_prices)) {
factorySalePrices = { standard: parseFloat(cfs.sale_prices.standard) || 0, asaan: parseFloat(cfs.sale_prices.asaan) || 0 };
await idb.setBatch([['factory_sale_prices', factorySalePrices], ['factory_sale_prices_timestamp', cfs.sale_prices_timestamp || Date.now()]]);
}
if (cfs.unit_tracking && ('standard' in cfs.unit_tracking) && ('asaan' in cfs.unit_tracking)) {
factoryUnitTracking = { standard: cfs.unit_tracking.standard, asaan: cfs.unit_tracking.asaan };
await idb.setBatch([['factory_unit_tracking', factoryUnitTracking], ['factory_unit_tracking_timestamp', cfs.unit_tracking_timestamp || Date.now()]]);
}
refreshFactorySettingsOverlay();
}
} else {
const factorySettingsPayload = {
default_formulas: ensureFactorySettings(factoryDefaultFormulas, { standard: [], asaan: [] }),
default_formulas_timestamp: getTimestamp(),
additional_costs: ensureFactorySettings(factoryAdditionalCosts, { standard: 0, asaan: 0 }),
additional_costs_timestamp: getTimestamp(),
cost_adjustment_factor: ensureFactorySettings(factoryCostAdjustmentFactor, { standard: 1, asaan: 1 }),
cost_adjustment_factor_timestamp: getTimestamp(),
sale_prices: ensureFactorySettings(factorySalePrices, { standard: 0, asaan: 0 }),
sale_prices_timestamp: getTimestamp(),
unit_tracking: ensureFactorySettings(factoryUnitTracking, {
standard: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
asaan: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] }
}),
unit_tracking_timestamp: getTimestamp(),
last_synced: now
};
sanitizedFactorySettings = sanitizeForFirestore(factorySettingsPayload);
}
} catch (fetchErr) {
console.error('Firebase operation failed.', fetchErr);
showToast('Firebase operation failed.', 'error');
}
}
if (sanitizedFactorySettings) {
console.group(' Factory Settings Upload Diagnostic');
if (!sanitizedFactorySettings.default_formulas) {
} else if (Object.keys(sanitizedFactorySettings.default_formulas).length === 0) {
} else {
}
if (!sanitizedFactorySettings.additional_costs) {
} else {
}
console.groupEnd();
const factoryBatch = getCurrentBatch();
factoryBatch.set(factorySettingsRef, sanitizedFactorySettings, { merge: true });
operationCount++;
} else {
}
const expenseCategories = await idb.get('expense_categories') || [];
const expenseCategoriesPayload = {
categories: expenseCategories,
last_synced: now
};
const sanitizedExpenseCategories = sanitizeForFirestore(expenseCategoriesPayload);
const expenseCategoriesRef = userRef.collection('expenseCategories').doc('categories');
const expenseCategoriesBatch = getCurrentBatch();
expenseCategoriesBatch.set(expenseCategoriesRef, sanitizedExpenseCategories, { merge: true });
operationCount++;
const settingsPayload = {
naswar_default_settings: defaultSettings || {},
naswar_default_settings_timestamp: await idb.get('naswar_default_settings_timestamp') || getTimestamp(),
last_synced: now
};
const sanitizedSettings = sanitizeForFirestore(settingsPayload);
const settingsRef = userRef.collection('settings').doc('config');
const settingsBatch = getCurrentBatch();
settingsBatch.set(settingsRef, sanitizedSettings, { merge: true });
operationCount++;
batches.push(currentBatch);
await idb.set('last_synced', now);
try {
// Commit batches one at a time with event-loop yields — keeps UI smooth
for (let _bi = 0; _bi < batches.length; _bi++) {
await batches[_bi].commit();
await new Promise(r => setTimeout(r, 0)); // yield to browser
}
// Stamp sync timestamps AFTER all batches committed successfully
for (const _col of Object.keys(collections)) {
await DeltaSync.setLastSyncTimestamp(_col);
}
} catch (batchError) {
console.error('Failed to save data locally.', batchError);
showToast('Failed to save data locally.', 'error');
if (batchError.message && (batchError.message.includes('indexOf') || batchError.message.includes('is not a function'))) {
}
throw batchError;
}
const pushSummary = {
totalOperations: operationCount,
batchCount: batches.length,
optimized: operationCount === 0 ? 'No changes to upload' : `Uploaded ${operationCount} operations`
};
if (!silent) {
const message = operationCount === 0
? ' Already synced - no changes to upload'
: ` Cloud Backup Complete - ${operationCount} items uploaded`;
showToast(message, 'success');
const display = document.getElementById('lastSyncDisplay');
if (display) display.textContent = `Last Cloud Sync: ${new Date(now).toLocaleString()}`;
}
} catch (error) {
if (!silent) showToast(` Backup failed: ${error.message}`, 'error');
} finally {
if (typeof pushTimeout !== 'undefined') {
clearTimeout(pushTimeout);
}
if (typeof progressInterval !== 'undefined' && progressInterval) {
clearInterval(progressInterval);
}
isSyncing = false;
if (btn) {
btn.innerText = originalText || 'Backup to Cloud';
btn.disabled = false;
}
}
}
async function pullDataFromCloud(silent = false, forceDownload = false) {
if (!firebaseDB || !currentUser) {
if (!silent) showToast('Please sign in to sync data', 'warning');
return;
}
if (isSyncing) {
if (!silent) showToast('Sync in progress...', 'info');
return;
}
isSyncing = true;
try {
if (!silent) showToast('Downloading cloud data...', 'info');
await idb.init();
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
const buildDeltaQuery = async (collection, collectionName) => {
const lastSync = await DeltaSync.getLastSyncFirestoreTimestamp(collectionName);
if (lastSync) {
return collection.where('updatedAt', '>', lastSync).get();
}
return collection.get();
};
const [
productionSnap,
salesSnap,
calcHistorySnap,
repSalesSnap,
repCustomersSnap,
transactionsSnap,
entitiesSnap,
inventorySnap,
factoryHistorySnap,
returnsSnap,
expensesSnap,
salesCustomersSnap,
settingsSnap,
factorySettingsSnap,
expenseCategoriesSnap,
deletionsSnap
] = await Promise.all([
buildDeltaQuery(userRef.collection('production'), 'production'),
buildDeltaQuery(userRef.collection('sales'), 'sales'),
buildDeltaQuery(userRef.collection('calculator_history'), 'calculator_history'),
buildDeltaQuery(userRef.collection('rep_sales'), 'rep_sales'),
buildDeltaQuery(userRef.collection('rep_customers'), 'rep_customers'),
buildDeltaQuery(userRef.collection('transactions'), 'transactions'),
buildDeltaQuery(userRef.collection('entities'), 'entities'),
buildDeltaQuery(userRef.collection('inventory'), 'inventory'),
buildDeltaQuery(userRef.collection('factory_history'), 'factory_history'),
buildDeltaQuery(userRef.collection('returns'), 'returns'),
buildDeltaQuery(userRef.collection('expenses'), 'expenses'),
buildDeltaQuery(userRef.collection('sales_customers'), 'sales_customers'),
userRef.collection('settings').doc('config').get(),
userRef.collection('factorySettings').doc('config').get(),
userRef.collection('expenseCategories').doc('categories').get(),
userRef.collection('deletions').get()
]);
for (const collection of ['production', 'sales', 'calculator_history', 'rep_sales', 'rep_customers', 'transactions',
'entities', 'inventory', 'factory_history', 'returns', 'expenses', 'sales_customers']) {
await DeltaSync.setLastSyncTimestamp(collection);
}
trackFirestoreRead(12);
trackFirestoreRead(3);
const hasData = productionSnap.docs.length > 0 || salesSnap.docs.length > 0 ||
transactionsSnap.docs.length > 0 || repSalesSnap.docs.length > 0 ||
entitiesSnap.docs.length > 0 ||
settingsSnap.exists || factorySettingsSnap.exists;
if (!hasData) {
if (!silent) showToast('Cloud is empty. Nothing to download.', 'info');
isSyncing = false;
return;
}
const cloudProduction = productionSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() }));
const cloudSales = salesSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() }));
const cloudCalcHistory = calcHistorySnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() }));
const cloudRepSales = repSalesSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() }));
const cloudRepCustomers = repCustomersSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() }));
const cloudTransactions = transactionsSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() }));
const cloudEntities = entitiesSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() }));
const cloudInventory = inventorySnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() }));
const cloudFactoryHistory = factoryHistorySnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() }));
const cloudReturns = returnsSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() }));
const cloudExpenses = expensesSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() }));
const cloudSalesCustomers = salesCustomersSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() }));
const cloudDeletions = deletionsSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => {
const data = doc.data();
return {
id: String(doc.id),
deletedAt: data.deletedAt?.toMillis ? data.deletedAt.toMillis() : data.deletedAt,
collection: data.collection,
syncedToCloud: true
};
});
let localDeletionRecords = await idb.get('deletion_records', []);
const allDeletions = [...localDeletionRecords];
cloudDeletions.forEach(cloudDel => {
if (!allDeletions.find(d => d.id === cloudDel.id)) {
allDeletions.push(cloudDel);
}
});
const threeMonthsAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
const validDeletions = allDeletions.filter(record => record.deletedAt > threeMonthsAgo);
await idb.set('deletion_records', validDeletions);
deletedRecordIds.clear();
validDeletions.forEach(record => deletedRecordIds.add(record.id));
await idb.set('deleted_records', Array.from(deletedRecordIds));
const filterDeletedItems = (items) => items.filter(item => !deletedRecordIds.has(item.id));
const filteredCloudProduction = filterDeletedItems(cloudProduction);
const filteredCloudSales = filterDeletedItems(cloudSales);
const filteredCloudCalcHistory = filterDeletedItems(cloudCalcHistory);
const filteredCloudRepSales = filterDeletedItems(cloudRepSales);
const filteredCloudRepCustomers = filterDeletedItems(cloudRepCustomers);
const filteredCloudTransactions = filterDeletedItems(cloudTransactions);
const filteredCloudEntities = filterDeletedItems(cloudEntities);
const filteredCloudInventory = filterDeletedItems(cloudInventory);
const filteredCloudFactoryHistory = filterDeletedItems(cloudFactoryHistory);
const filteredCloudReturns = filterDeletedItems(cloudReturns);
const filteredCloudExpenses = filterDeletedItems(cloudExpenses);
const filteredCloudSalesCustomers = filterDeletedItems(cloudSalesCustomers);
db = mergeArraysByTimestamp(db || [], filteredCloudProduction);
customerSales = mergeArraysByTimestamp(customerSales || [], filteredCloudSales);
salesHistory = mergeArraysByTimestamp(salesHistory || [], filteredCloudCalcHistory);
repSales = mergeArraysByTimestamp(repSales || [], filteredCloudRepSales);
repCustomers = mergeArraysByTimestamp(repCustomers || [], filteredCloudRepCustomers);
paymentTransactions = mergeArraysByTimestamp(paymentTransactions || [], filteredCloudTransactions);
paymentEntities = mergeArraysByTimestamp(paymentEntities || [], filteredCloudEntities);
factoryInventoryData = mergeArraysByTimestamp(factoryInventoryData || [], filteredCloudInventory);
factoryProductionHistory = mergeArraysByTimestamp(factoryProductionHistory || [], filteredCloudFactoryHistory);
stockReturns = mergeArraysByTimestamp(stockReturns || [], filteredCloudReturns);
expenseRecords = mergeArraysByTimestamp(expenseRecords || [], filteredCloudExpenses);
salesCustomers = mergeArraysByTimestamp(salesCustomers || [], filteredCloudSalesCustomers);
if (factorySettingsSnap.exists) {
const cloudFactorySettings = factorySettingsSnap.data();
if (cloudFactorySettings.default_formulas && typeof cloudFactorySettings.default_formulas === 'object') {
const formulas = cloudFactorySettings.default_formulas;
if (('standard' in formulas) && ('asaan' in formulas)) {
const cloudTimestamp = cloudFactorySettings.default_formulas_timestamp || 0;
const localTimestamp = (await idb.get('factory_default_formulas_timestamp')) || 0;
if (forceDownload || cloudTimestamp > localTimestamp) {
factoryDefaultFormulas = {
standard: Array.isArray(formulas.standard) ? formulas.standard : [],
asaan: Array.isArray(formulas.asaan) ? formulas.asaan : []
};
await idb.setBatch([
['factory_default_formulas', factoryDefaultFormulas],
['factory_default_formulas_timestamp', cloudTimestamp || Date.now()]
]);
}
} else {
}
}
if (cloudFactorySettings.additional_costs && typeof cloudFactorySettings.additional_costs === 'object') {
const costs = cloudFactorySettings.additional_costs;
if (('standard' in costs) && ('asaan' in costs)) {
const cloudTimestamp = cloudFactorySettings.additional_costs_timestamp || 0;
const localTimestamp = (await idb.get('factory_additional_costs_timestamp')) || 0;
if (forceDownload || cloudTimestamp > localTimestamp) {
factoryAdditionalCosts = {
standard: parseFloat(costs.standard) || 0,
asaan: parseFloat(costs.asaan) || 0
};
await idb.setBatch([
['factory_additional_costs', factoryAdditionalCosts],
['factory_additional_costs_timestamp', cloudTimestamp || Date.now()]
]);
}
} else {
}
}
if (cloudFactorySettings.cost_adjustment_factor && typeof cloudFactorySettings.cost_adjustment_factor === 'object') {
const factor = cloudFactorySettings.cost_adjustment_factor;
if (('standard' in factor) && ('asaan' in factor)) {
const cloudTimestamp = cloudFactorySettings.cost_adjustment_factor_timestamp || 0;
const localTimestamp = (await idb.get('factory_cost_adjustment_factor_timestamp')) || 0;
if (forceDownload || cloudTimestamp > localTimestamp) {
factoryCostAdjustmentFactor = {
standard: parseFloat(factor.standard) || 1,
asaan: parseFloat(factor.asaan) || 1
};
await idb.setBatch([
['factory_cost_adjustment_factor', factoryCostAdjustmentFactor],
['factory_cost_adjustment_factor_timestamp', cloudTimestamp || Date.now()]
]);
}
} else {
}
}
if (cloudFactorySettings.sale_prices && typeof cloudFactorySettings.sale_prices === 'object') {
const prices = cloudFactorySettings.sale_prices;
if (('standard' in prices) && ('asaan' in prices)) {
const cloudTimestamp = cloudFactorySettings.sale_prices_timestamp || 0;
const localTimestamp = (await idb.get('factory_sale_prices_timestamp')) || 0;
if (forceDownload || cloudTimestamp > localTimestamp) {
factorySalePrices = {
standard: parseFloat(prices.standard) || 0,
asaan: parseFloat(prices.asaan) || 0
};
await idb.setBatch([
['factory_sale_prices', factorySalePrices],
['factory_sale_prices_timestamp', cloudTimestamp || Date.now()]
]);
}
} else {
}
}
if (cloudFactorySettings.unit_tracking && typeof cloudFactorySettings.unit_tracking === 'object') {
const tracking = cloudFactorySettings.unit_tracking;
if (('standard' in tracking) && ('asaan' in tracking)) {
const cloudTimestamp = cloudFactorySettings.unit_tracking_timestamp || 0;
const localTimestamp = (await idb.get('factory_unit_tracking_timestamp')) || 0;
if (forceDownload || cloudTimestamp > localTimestamp) {
const validateTrackingData = (data) => ({
produced: parseFloat(data?.produced) || 0,
consumed: parseFloat(data?.consumed) || 0,
available: parseFloat(data?.available) || 0,
unitCostHistory: Array.isArray(data?.unitCostHistory) ? data.unitCostHistory : []
});
factoryUnitTracking = {
standard: validateTrackingData(tracking.standard),
asaan: validateTrackingData(tracking.asaan)
};
await idb.setBatch([
['factory_unit_tracking', factoryUnitTracking],
['factory_unit_tracking_timestamp', cloudTimestamp || Date.now()]
]);
}
} else {
}
}
refreshFactorySettingsOverlay();
}
if (expenseCategoriesSnap.exists) {
const cloudExpenseCategories = expenseCategoriesSnap.data();
if (cloudExpenseCategories.categories && Array.isArray(cloudExpenseCategories.categories)) {
const localCategories = await idb.get('expense_categories') || [];
const mergedCategories = [...new Set([...localCategories, ...cloudExpenseCategories.categories])];
expenseCategories = mergedCategories;
await idb.set('expense_categories', expenseCategories);
}
}
if (settingsSnap.exists) {
const cloudSettings = settingsSnap.data();
if (cloudSettings.naswar_default_settings) {
const cloudTimestamp = cloudSettings.naswar_default_settings_timestamp || 0;
const localTimestamp = (await idb.get('naswar_default_settings_timestamp')) || 0;
if (cloudTimestamp > localTimestamp) {
defaultSettings = cloudSettings.naswar_default_settings;
await idb.setBatch([
['naswar_default_settings', defaultSettings],
['naswar_default_settings_timestamp', cloudTimestamp]
]);
}
}
}
db = db.filter(item => !deletedRecordIds.has(item.id));
customerSales = customerSales.filter(item => !deletedRecordIds.has(item.id));
repSales = repSales.filter(item => !deletedRecordIds.has(item.id));
repCustomers = repCustomers.filter(item => !deletedRecordIds.has(item.id));
salesHistory = salesHistory.filter(item => !deletedRecordIds.has(item.id));
paymentTransactions = paymentTransactions.filter(item => !deletedRecordIds.has(item.id));
paymentEntities = paymentEntities.filter(item => !deletedRecordIds.has(item.id));
factoryInventoryData = factoryInventoryData.filter(item => !deletedRecordIds.has(item.id));
hasChanges = true;
factoryProductionHistory = factoryProductionHistory.filter(item => !deletedRecordIds.has(item.id));
stockReturns = stockReturns.filter(item => !deletedRecordIds.has(item.id));
expenseRecords = expenseRecords.filter(item => !deletedRecordIds.has(item.id));
(async () => {
await DeltaSync.updateSyncStats('production');
await DeltaSync.updateSyncStats('sales');
await DeltaSync.updateSyncStats('rep_sales');
await DeltaSync.updateSyncStats('rep_customers');
await DeltaSync.updateSyncStats('calculator_history');
await DeltaSync.updateSyncStats('transactions');
await DeltaSync.updateSyncStats('entities');
await DeltaSync.updateSyncStats('inventory');
await DeltaSync.updateSyncStats('factory_history');
await DeltaSync.updateSyncStats('returns');
await DeltaSync.updateSyncStats('expenses');
await DeltaSync.updateSyncStats('deletions');
})().catch(e => console.warn('[DeltaSync] updateSyncStats batch failed:', e));
if (!factoryDefaultFormulas || typeof factoryDefaultFormulas !== 'object' || !('standard' in factoryDefaultFormulas) || !('asaan' in factoryDefaultFormulas)) {
factoryDefaultFormulas = { standard: [], asaan: [] };
}
if (!factoryAdditionalCosts || typeof factoryAdditionalCosts !== 'object' || !('standard' in factoryAdditionalCosts) || !('asaan' in factoryAdditionalCosts)) {
factoryAdditionalCosts = { standard: 0, asaan: 0 };
}
if (!factoryCostAdjustmentFactor || typeof factoryCostAdjustmentFactor !== 'object' || !('standard' in factoryCostAdjustmentFactor) || !('asaan' in factoryCostAdjustmentFactor)) {
factoryCostAdjustmentFactor = { standard: 1, asaan: 1 };
}
if (!factorySalePrices || typeof factorySalePrices !== 'object' || !('standard' in factorySalePrices) || !('asaan' in factorySalePrices)) {
factorySalePrices = { standard: 0, asaan: 0 };
}
if (!factoryUnitTracking || typeof factoryUnitTracking !== 'object' || !('standard' in factoryUnitTracking) || !('asaan' in factoryUnitTracking)) {
factoryUnitTracking = {
standard: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
asaan: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] }
};
}
const saveEntries = [
['mfg_pro_pkr', db],
['customer_sales', customerSales],
['rep_sales', repSales],
['rep_customers', repCustomers],
['noman_history', salesHistory],
['factory_inventory_data', factoryInventoryData],
['factory_production_history', factoryProductionHistory],
['payment_entities', paymentEntities],
['payment_transactions', paymentTransactions],
['stock_returns', stockReturns],
['expenses', expenseRecords],
['sales_customers', salesCustomers],
['factory_default_formulas', factoryDefaultFormulas],
['factory_additional_costs', factoryAdditionalCosts],
['factory_cost_adjustment_factor', factoryCostAdjustmentFactor],
['factory_sale_prices', factorySalePrices],
['factory_unit_tracking', factoryUnitTracking],
['naswar_default_settings', defaultSettings],
['deleted_records', Array.from(deletedRecordIds)],
['last_synced', new Date().toISOString()],
['appMode', appMode],
['current_rep_profile', currentRepProfile]
];
if (idb.setBatch) {
await idb.setBatch(saveEntries);
} else {
await Promise.all(saveEntries.map(([key, value]) => idb.set(key, value)));
}
if (!silent) showToast(' Data Restored Successfully', 'success');
updateUnitsAvailableIndicator();
await refreshAllDisplays();
} catch (error) {
if (!silent) showToast('Restore failed. Using local data.', 'error');
} finally {
isSyncing = false;
}
}
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
return;
if (!currentUser) return;
autoSaveTimer = setInterval(async () => {
if (!currentUser) {
clearAutoBackup();
return;
}
await performOneClickSync(true);
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
try { sessionStorage.setItem('_gznd_session_active', '1'); } catch(e) {}
LoginRateLimiter.recordSuccess();
messageDiv.textContent = 'Success! Loading...';
messageDiv.style.color = 'var(--accent-emerald)';
setTimeout(() => {
hideAuthOverlay();
if(typeof performOneClickSync === 'function') performOneClickSync();
}, 1000);
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
try { sessionStorage.setItem('_gznd_session_active', '1'); } catch(e) {}
LoginRateLimiter.recordSuccess();
messageDiv.textContent = '✓ Offline Login Successful';
messageDiv.style.color = 'var(--accent-emerald)';
setTimeout(() => {
if (currentUser) {
const overlay = document.getElementById('auth-overlay');
if (overlay) { overlay.style.display = 'none'; }
document.body.style.overflow = '';
}
}, 1000);
}
} catch (error) {
console.error('Sign in failed.', error);
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
try { sessionStorage.setItem('_gznd_session_active', '1'); } catch(e) {}
messageDiv.textContent = '✓ Offline Login (Network unavailable)';
messageDiv.style.color = 'var(--accent-emerald)';
setTimeout(() => { if(currentUser){const o=document.getElementById('auth-overlay');if(o)o.style.display='none';document.body.style.overflow='';} }, 1000);
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
try { sessionStorage.setItem('_gznd_session_active', '1'); } catch(e) {}
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
console.error('Sign up failed.', error);
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
try { sessionStorage.removeItem('_gznd_session_active'); } catch(e) {}
DeltaSync.clearAllTimestamps().catch(e => console.warn("[DeltaSync] clearAllTimestamps on signout:", e));
showToast(' Signed out successfully', 'success');
} else {
currentUser = null;
IDBCrypto.clearSessionKey();
idb.clearUserPrefix();
try { sessionStorage.removeItem('_gznd_session_active'); } catch(e) {}
DeltaSync.clearAllTimestamps().catch(e => console.warn("[DeltaSync] clearAllTimestamps on signout:", e));
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