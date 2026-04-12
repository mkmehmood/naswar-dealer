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

async function unifiedSave(sqliteKey, dataArray, specificRecord = null, linkedIds = null) {

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
} else if (Array.isArray(linkedIds) && linkedIds.length > 0) {
  await saveWithTracking(sqliteKey, dataArray, null, linkedIds);
  const recordsToSync = dataArray.filter(r => r && linkedIds.includes(r.id));
  _syncQueue.run(async () => {
    for (const record of recordsToSync) {
      try {
        await saveRecordToFirestore(sqliteKey, record);
      } catch (e) {
        const collectionName = getFirestoreCollection(sqliteKey);
        if (typeof OfflineQueue !== 'undefined' && collectionName) {
          const now = Date.now();
          const fallback = sanitizeForFirestore({ ...record, syncedAt: new Date().toISOString() });
          if (!fallback.createdAt) fallback.createdAt = now;
          if (!record.isMerged) fallback.updatedAt = new Date(now).toISOString();
          await OfflineQueue.add({
            action: 'set',
            collection: collectionName,
            docId: String(record.id),
            data: fallback
          });
        }
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
if (collectionName && typeof window.registerDeletion === 'function') {
  try {
    await window.registerDeletion(deletedRecordId, collectionName, preDeletedRecord || null);
  } catch (e) {
    console.warn('[unifiedDelete] registerDeletion failed:', String(e));
  }
}

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
.catch((error) => {
});

_checkGoogleRedirectResult();

const SW_TOKEN_FILE = 'sw_sync_token.json';
let _swTokenRefreshTimer = null;

async function saveTokenForSW(firebaseUser) {
  try {
    if (!firebaseUser || !navigator.storage || typeof navigator.storage.getDirectory !== 'function') return;
    const token  = await firebaseUser.getIdToken( false);
    const record = JSON.stringify({ token, uid: firebaseUser.uid, expiry: Date.now() + 55 * 60 * 1000 });
    const root   = await navigator.storage.getDirectory();
    const fh     = await root.getFileHandle(SW_TOKEN_FILE, { create: true });
    const wr     = await fh.createWritable();
    await wr.write(record);
    await wr.close();
    console.log('[SWToken] Token saved to OPFS, expires in ~55 min');
  } catch (e) { console.warn('[SWToken] Could not save token to OPFS:', e); }
}

async function clearTokenForSW() {
  try {
    if (typeof navigator.storage.getDirectory !== 'function') return;
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(SW_TOKEN_FILE).catch(() => {});
  } catch {  }
}

function startSWTokenRefresh(firebaseUser) {
  if (_swTokenRefreshTimer) clearInterval(_swTokenRefreshTimer);

  _swTokenRefreshTimer = setInterval(async () => {
    try {
      const fresh = await firebaseUser.getIdToken( true);
      const record = JSON.stringify({ token: fresh, uid: firebaseUser.uid, expiry: Date.now() + 55 * 60 * 1000 });
      const root   = await navigator.storage.getDirectory();
      const fh     = await root.getFileHandle(SW_TOKEN_FILE, { create: true });
      const wr     = await fh.createWritable();
      await wr.write(record);
      await wr.close();
      console.log('[SWToken] Token refreshed in OPFS');
    } catch (e) { console.warn('[SWToken] Token refresh failed:', e); }
  }, 50 * 60 * 1000);
}

function stopSWTokenRefresh() {
  if (_swTokenRefreshTimer) { clearInterval(_swTokenRefreshTimer); _swTokenRefreshTimer = null; }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'BG_SYNC_COMPLETE') {
      const syncedIds = event.data.syncedIds || [];
      if (syncedIds.length > 0 && typeof OfflineQueue !== 'undefined') {
        OfflineQueue.queue = OfflineQueue.queue.filter(item => !syncedIds.includes(item.id));
        OfflineQueue.saveQueue().catch(() => {});
        console.log(`[SWToken] SW synced ${syncedIds.length} operation(s) in background; queue updated.`);
        if (OfflineQueue.queue.length === 0 && typeof showToast === 'function') {
          showToast('☁️ Background sync complete', 'success', 3000);
        }
      }
    }
  });
}

auth.onAuthStateChanged(async (user) => {
if (user) {
currentUser = {
id: user.uid,
uid: user.uid,
email: user.email,
displayName: user.displayName
};

saveTokenForSW(user).catch(() => {});
startSWTokenRefresh(user);

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
const _welcomeName = (() => {
  const _mode = typeof appMode !== 'undefined' ? appMode : 'admin';
  if (!_mode || _mode === 'admin') return 'MAHMOOD KHAN';
  if (_mode === 'rep') return (typeof currentRepProfile !== 'undefined' && currentRepProfile) ? currentRepProfile : 'Sales Rep';
  return (window._assignedManagerName) ? window._assignedManagerName
    : _mode === 'production' ? 'Production Manager'
    : _mode === 'factory'    ? 'Factory Manager'
    : 'User';
})();
showToast(`Welcome back, ${_welcomeName}`, 'success');
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

  const _bootstrapAlreadyRan = !!sessionStorage.getItem('_gznd_bootstrap_ran');
  if (!_bootstrapAlreadyRan) {
    if (typeof loadAllData === 'function') await loadAllData();
  }
  if (typeof refreshAllDisplays === 'function') await refreshAllDisplays();
} catch(e) {
  console.warn('Auth: post-login data reload failed:', _safeErr(e));
}
updateSyncButton();

const _isFreshLogin = !sessionStorage.getItem('_gznd_login_ts');
if (_isFreshLogin) {
  try { sessionStorage.setItem('_gznd_login_ts', String(Date.now())); } catch(_) {}
}

if (typeof initDeviceShard === 'function') {
  await initDeviceShard().catch(() => {});
  if (typeof UUIDSyncRegistry !== 'undefined') {
    await UUIDSyncRegistry.loadAll().catch(() => {});
  }
}
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
setTimeout(async () => {
try {
await restoreDeviceModeOnLogin(user.uid);
} catch (error) {
console.error('Could not restore device mode:', _safeErr(error));
}
}, 1000);
setTimeout(async () => {
try {
if (typeof performOneClickSync === 'function' && !isSyncing) {
  await performOneClickSync(true);
}
} catch (e) { console.warn('[Sync] Auto-sync on login error:', _safeErr(e)); }
}, 1500);
} else {
currentUser = null;

stopSWTokenRefresh();
clearTokenForSW().catch(() => {});
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
const _existingArr = await _getColData(col.sqliteKey);
const _existingIdSet = new Set(_existingArr.map(r => r && r.id ? String(r.id) : null).filter(Boolean));
for (const change of changes) {
try {
const docData = { id: change.doc.id, ...change.doc.data() };
if (change.type === 'added' || change.type === 'modified') {
const _sid = String(change.doc.id);
if (change.type === 'added' && _existingIdSet.has(_sid)) {
  if (typeof UUIDSyncRegistry !== 'undefined') UUIDSyncRegistry.markDownloaded(col.firestoreId, _sid);
  else DeltaSync.markDownloaded(col.firestoreId, _sid);
  continue; 
}
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
let arr = _existingArr;
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
await renderUnifiedTable();
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
  if (!docData.id) {
    docData = ensureRecordIntegrity(docData, false, true);
  }
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

    if (docData.isMerged === true && localRecord.isMerged !== true) {

    } else if (localRecord.isMerged === true && docData.isMerged !== true) {
      return array;
    } else if (cloudMs > 0 && cloudMs <= localMs) {
      return array;
    }
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
    const localItem = array[existingIdx];

    const _isMergedWins =
      (docData.isMerged === true && localItem.isMerged !== true)
      || (!(localItem.isMerged === true && docData.isMerged !== true)
          && ((typeof compareRecordVersions === 'function')
              ? compareRecordVersions(docData, localItem) > 0
              : _getMs(docData) - _getMs(localItem) > 0));
    if (_isMergedWins) {
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
    if (firebaseDB && currentUser) {
      subscribeToRealtime().catch(e => {

        isReconnecting = false;
        console.warn('subscribeToRealtime retry failed:', _safeErr(e));
      });
    }
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
        if (!result.ok) { allOk = false; }
      }
      if (allOk) {
        pendingFirestoreYearClose = false;
        await sqliteStore.set('pendingFirestoreYearClose', false);

        try {
          const _fySettings = await sqliteStore.get('naswar_default_settings', {});
          const _fyTs = Date.now();
          await sqliteStore.set('naswar_default_settings_timestamp', _fyTs);
          await userRef.collection('settings').doc('config').set({
            naswar_default_settings: {
              fyCloseCount:       _fySettings.fyCloseCount       || 0,
              lastYearClosedAt:   _fySettings.lastYearClosedAt   || null,
              lastYearClosedDate: _fySettings.lastYearClosedDate || null,
            },
            naswar_default_settings_timestamp: _fyTs,
          }, { merge: true });
          if (typeof DeltaSync !== 'undefined') await DeltaSync.setLastSyncTimestamp('settings');
        } catch (_metaRetryErr) {
          console.warn('pendingFirestoreYearClose: metadata push failed:', _safeErr(_metaRetryErr));
        }

        try {
          const _retryDeviceId = (typeof getDeviceId === 'function') ? await getDeviceId().catch(() => 'unknown') : 'unknown';
          await userRef.collection('settings').doc('yearCloseSignal').set({
            type:        'close',
            triggeredAt: Date.now(),
            triggeredBy: _retryDeviceId,
            fyCloseCount: (await sqliteStore.get('naswar_default_settings', {})).fyCloseCount || 0,
            _retryBroadcast: true,
          });
        } catch (_reBroadcastErr) {
          console.warn('pendingFirestoreYearClose: re-broadcast signal failed:', _safeErr(_reBroadcastErr));
        }
        showToast('Cloud sync for year-close completed successfully', 'success', 4000);
      }
    } catch (e) { console.warn('pendingFirestoreYearClose retry failed:', _safeErr(e)); }
  }

  if (!pendingFirestoreRestore) {
    try {
      const _storedRestoreFlag = await sqliteStore.get('pendingFirestoreRestore');
      if (_storedRestoreFlag === true) pendingFirestoreRestore = true;
    } catch (_rfErr) {}
  }
  if (pendingFirestoreRestore) {
    try {
      showToast('Retrying restore cloud sync...', 'info', 3000);
      const _restoreUserRef = firebaseDB.collection('users').doc(currentUser.uid);
      const _restoreKeys = [
        'mfg_pro_pkr', 'customer_sales', 'noman_history', 'rep_sales',
        'rep_customers', 'sales_customers', 'factory_inventory_data',
        'factory_production_history', 'stock_returns', 'payment_transactions',
        'payment_entities', 'expenses',
      ];
      const _restoreColMap = {
        mfg_pro_pkr: 'production', customer_sales: 'sales', noman_history: 'calculator_history',
        rep_sales: 'rep_sales', rep_customers: 'rep_customers', sales_customers: 'sales_customers',
        factory_inventory_data: 'inventory', factory_production_history: 'factory_history',
        stock_returns: 'returns', payment_transactions: 'transactions',
        payment_entities: 'entities', expenses: 'expenses',
      };
      let _restoreAllOk = true;
      for (const sqlKey of _restoreKeys) {
        const colName = _restoreColMap[sqlKey];
        try {
          const records = ensureArray(await sqliteStore.get(sqlKey, []));
          if (records.length === 0) continue;
          const colRef = _restoreUserRef.collection(colName);
          const incomingIds = new Set(records.filter(r => r && r.id).map(r => String(r.id)));

          const preSnap = await colRef.get();
          const staleDocs = preSnap.docs.filter(d => !incomingIds.has(d.id) && d.id !== '_placeholder_' && !d.data()._placeholder);
          if (staleDocs.length > 0) {
            const mBatches = [firebaseDB.batch()]; let mOps = 0;
            staleDocs.forEach(d => {
              if (mOps >= 495) { mBatches.push(firebaseDB.batch()); mOps = 0; }
              mBatches[mBatches.length-1].update(d.ref, { _pendingDelete: true }); mOps++;
            });
            await Promise.all(mBatches.map(b => b.commit()));
          }

          const wBatches = [firebaseDB.batch()]; let wOps = 0;
          for (const record of records) {
            if (!record || !record.id) continue;
            const san = (typeof sanitizeForFirestore === 'function') ? sanitizeForFirestore(record) : record;
            if (!san) continue;
            if (wOps >= 495) { wBatches.push(firebaseDB.batch()); wOps = 0; }
            wBatches[wBatches.length-1].set(colRef.doc(String(record.id)), san, { merge: false }); wOps++;
          }
          if (wOps > 0) await Promise.all(wBatches.map(b => b.commit()));

          if (staleDocs.length > 0) {
            const dBatches = [firebaseDB.batch()]; let dOps = 0;
            staleDocs.forEach(d => {
              if (dOps >= 495) { dBatches.push(firebaseDB.batch()); dOps = 0; }
              dBatches[dBatches.length-1].delete(d.ref); dOps++;
            });
            await Promise.all(dBatches.map(b => b.commit()));
          }
          if (typeof DeltaSync !== 'undefined') await DeltaSync.setLastSyncTimestamp(colName);
        } catch (_rColErr) {
          console.warn(`pendingFirestoreRestore: retry failed for ${colName}:`, _safeErr(_rColErr));
          _restoreAllOk = false;
        }
      }
      if (_restoreAllOk) {
        pendingFirestoreRestore = false;
        await sqliteStore.set('pendingFirestoreRestore', false);

        try {
          const _rRetryDeviceId = (typeof getDeviceId === 'function') ? await getDeviceId().catch(() => 'unknown') : 'unknown';
          await _restoreUserRef.collection('settings').doc('yearCloseSignal').set({
            type:        'restore',
            triggeredAt: Date.now(),
            triggeredBy: _rRetryDeviceId,
            _retryBroadcast: true,
          });
        } catch (_rSigErr) {
          console.warn('pendingFirestoreRestore: re-broadcast signal failed:', _safeErr(_rSigErr));
        }
        showToast('Cloud sync for year-close restore completed successfully', 'success', 4000);
      }
    } catch (_rErr) { console.warn('pendingFirestoreRestore retry failed:', _safeErr(_rErr)); }
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
            try { if (typeof signOut === 'function') await signOut(); }
            catch (e) { console.warn('[Auth] Force logout error:', _safeErr(e)); }
          }, 1500);
        }
      }
      if (data.approved === false) {
        showToast('Your account has been suspended. Signing out…', 'error', 5000);
        setTimeout(async () => {
          try { if (typeof signOut === 'function') await signOut(); }
          catch (e) { console.warn('[Auth] Suspend logout error:', _safeErr(e)); }
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
    }, (_userDocErr) => {
      const _code = _userDocErr && _userDocErr.code;
      console.warn('[sync] userDoc snapshot error:', _code, _safeErr(_userDocErr));
      if (_code === 'permission-denied' || _code === 'failed-precondition') {
        updateSignalUI('offline');
      } else {
        updateSignalUI('error');
        scheduleListenerReconnect();
      }
    });
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

          { cloud: cloudSettings.sales_reps_timestamp,             local: await sqliteStore.get('sales_reps_list_timestamp') },
        ];
        for (const check of timestampChecks) {
          if ((check.cloud || 0) > (check.local || 0)) { hasUpdates = true; break; }
        }
        if (!hasUpdates) return;

        if (cloudSettings.naswar_default_settings) {
          const ct = cloudSettings.naswar_default_settings_timestamp || 0;
          const lt = (await sqliteStore.get('naswar_default_settings_timestamp')) || 0;
          if (ct > lt) {

            const cloudFy = cloudSettings.naswar_default_settings;
            const localFy = (await sqliteStore.get('naswar_default_settings')) || {};
            const mergedFy = {
              ...localFy,
              ...cloudFy,
              fyCloseCount: Math.max(
                typeof cloudFy.fyCloseCount === 'number' ? cloudFy.fyCloseCount : 0,
                typeof localFy.fyCloseCount  === 'number' ? localFy.fyCloseCount  : 0
              ),
              lastYearClosedAt: Math.max(cloudFy.lastYearClosedAt || 0, localFy.lastYearClosedAt || 0) || null,
              lastYearClosedDate: (
                (cloudFy.lastYearClosedAt || 0) >= (localFy.lastYearClosedAt || 0)
                  ? cloudFy.lastYearClosedDate
                  : localFy.lastYearClosedDate
              ) || null,
            };
            defaultSettings = mergedFy;
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

        if (Array.isArray(cloudSettings.sales_reps) && cloudSettings.sales_reps.length > 0) {
          const ct = cloudSettings.sales_reps_timestamp || 0;
          const lt = (await sqliteStore.get('sales_reps_list_timestamp')) || 0;
          if (ct > lt) {
            salesRepsList = cloudSettings.sales_reps;
            await sqliteStore.setBatch([
              ['sales_reps_list', salesRepsList],
              ['sales_reps_list_timestamp', ct || Date.now()],
            ]);
          }
        }
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
    }, _e => {
      const _ec = _e && _e.code;
      console.warn('[sync] settings listener error:', _ec, _safeErr(_e));
      if (_ec === 'permission-denied' || _ec === 'failed-precondition') { updateSignalUI('offline'); }
      else { updateSignalUI('error'); scheduleListenerReconnect(); }
    });
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
    }, _e => {
      const _ec = _e && _e.code;
      console.warn('[sync] factorySettings listener error:', _ec, _safeErr(_e));
      if (_ec === 'permission-denied' || _ec === 'failed-precondition') { updateSignalUI('offline'); }
      else { updateSignalUI('error'); scheduleListenerReconnect(); }
    });
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
    }, _e => {
      const _ec = _e && _e.code;
      console.warn('[sync] expenseCategories listener error:', _ec, _safeErr(_e));
      if (_ec === 'permission-denied' || _ec === 'failed-precondition') { updateSignalUI('offline'); }
      else { updateSignalUI('error'); scheduleListenerReconnect(); }
    });
    realtimeRefs.push(expenseCategoriesUnsub);

    const _handleAppStoresSnapshot = async (doc) => {
      try {
        if (!doc.exists || doc.metadata.hasPendingWrites) return;
        if (doc.metadata.fromCache) return;
        trackFirestoreRead(1);
        const cloud = doc.data();
        if (!cloud || !Array.isArray(cloud.stores)) return;
        const cloudTs = cloud.stores_timestamp || 0;
        const localTs = (await sqliteStore.get('app_stores_timestamp')) || 0;
        if (cloudTs && localTs && cloudTs <= localTs) { recordSuccessfulConnection(); return; }
        const local = await sqliteStore.get('app_stores') || [];
        const cloudSorted = [...cloud.stores].sort((a, b) => (a.key || '').localeCompare(b.key || ''));
        const localSorted = [...local].sort((a, b) => (a.key || '').localeCompare(b.key || ''));
        if (JSON.stringify(cloudSorted) !== JSON.stringify(localSorted)) {
          await sqliteStore.set('app_stores', cloud.stores);
          if (cloudTs) await sqliteStore.set('app_stores_timestamp', cloudTs);
          if (typeof _invalidateStoresCache === 'function') _invalidateStoresCache();
          emitSyncUpdate({ appStores: null });
          flashLivePulse();
        }
        recordSuccessfulConnection();
      } catch (error) {
        console.warn('[sync] local save error in appStores snapshot handler:', _safeErr(error));
      }
    };
    const appStoresUnsub = userRef.collection('appStores').doc('stores').onSnapshot(async (doc) => {
      if (isSyncing) { _enqueueSyncLocked(_handleAppStoresSnapshot, doc); return; }
      await _handleAppStoresSnapshot(doc);
    }, _e => {
      const _ec = _e && _e.code;
      console.warn('[sync] appStores listener error:', _ec, _safeErr(_e));
      if (_ec === 'permission-denied' || _ec === 'failed-precondition') { updateSignalUI('offline'); }
      else { updateSignalUI('error'); scheduleListenerReconnect(); }
    });
    realtimeRefs.push(appStoresUnsub);

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

              const _removedData = change.doc.data() || {};
              const _docRid = String(_removedData.recordId || change.doc.id);
              const _docCollection = _removedData.collection || _removedData.recordType || null;

              deletionRecords = deletionRecords.filter(r =>
                String(r.id) !== _docRid && String(r.recordId) !== _docRid
              );

              deletedSet.delete(_docRid);

              if (_docCollection) {
                try {
                  const _sqliteKey = getSQLiteKey(_docCollection);
                  if (_sqliteKey) {
                    const _storeArr = ensureArray(await sqliteStore.get(_sqliteKey));
                    const _filtered = _storeArr.filter(r => String(r.id) !== _docRid);
                    if (_filtered.length !== _storeArr.length) {
                      await sqliteStore.set(_sqliteKey, _filtered);
                    }
                  }
                } catch (_purgeErr) {
                  console.warn('[sync] hardDelete cross-device purge failed for', _docRid, _safeErr(_purgeErr));
                }
              }

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
    }, _e => {
      const _ec = _e && _e.code;
      console.warn('[sync] deletions listener error:', _ec, _safeErr(_e));
      if (_ec === 'permission-denied' || _ec === 'failed-precondition') { updateSignalUI('offline'); }
      else { updateSignalUI('error'); scheduleListenerReconnect(); }
    });
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
    }, _e => {
      const _ec = _e && _e.code;
      console.warn('[sync] team listener error:', _ec, _safeErr(_e));
      if (_ec === 'permission-denied' || _ec === 'failed-precondition') { updateSignalUI('offline'); }
      else { updateSignalUI('error'); scheduleListenerReconnect(); }
    });
    realtimeRefs.push(teamUnsub);

    const _handleYearCloseSignal = async (doc) => {
      try {
        if (!doc.exists) return;

        if (doc.metadata.hasPendingWrites) return;
        if (doc.metadata.fromCache) return;
        const sig = doc.data();
        if (!sig || typeof sig !== 'object') return;
        const sigType       = sig.type;
        const sigTriggeredAt = sig.triggeredAt || 0;
        const sigTriggeredBy = sig.triggeredBy || 'unknown';

        if (sigType !== 'close' && sigType !== 'restore') return;

        const _myDeviceId = (typeof getDeviceId === 'function')
          ? await getDeviceId().catch(() => null)
          : null;
        if (_myDeviceId && sigTriggeredBy === _myDeviceId) return;

        const _lastHandledSig = (await sqliteStore.get('_lastHandledYearCloseSignal')) || 0;
        if (sigTriggeredAt <= _lastHandledSig) return;

        await sqliteStore.set('_lastHandledYearCloseSignal', sigTriggeredAt);

        const _sigLabel = sigType === 'close' ? 'Financial Year Close' : 'Year-Close Restore';
        console.log(`[sync] yearCloseSignal received (${sigType}) from device ${sigTriggeredBy} — wiping SQLite and rebuilding from cloud.`);
        showToast(`↻ ${_sigLabel} detected on another device — refreshing data…`, 'info', 6000);

        if (typeof OfflineQueue !== 'undefined') OfflineQueue.cancelRetry && OfflineQueue.cancelRetry();

        try {
          const _wipeKeys = [
            'mfg_pro_pkr', 'customer_sales', 'noman_history', 'rep_sales',
            'rep_customers', 'sales_customers', 'payment_transactions',
            'payment_entities', 'factory_inventory_data', 'factory_production_history',
            'stock_returns', 'expenses', 'deleted_records', 'deletion_records',
          ];
          await sqliteStore.setBatch(_wipeKeys.map(k => [k, []]));
        } catch (_wipeErr) {
          console.warn('[yearCloseSignal] SQLite wipe failed:', _safeErr(_wipeErr));
        }

        try {
          await DeltaSync.clearAllTimestamps();
          if (typeof UUIDSyncRegistry !== 'undefined') await UUIDSyncRegistry.clearAll().catch(() => {});
        } catch (_dsErr) {  }

        try {
          await pullDataFromCloud(false, true);
        } catch (_rebuildErr) {
          console.warn('[yearCloseSignal] pullDataFromCloud failed:', _safeErr(_rebuildErr));
          showToast('Auto-refresh failed — please sync manually.', 'warning', 5000);
          return;
        }

        try {
          if (typeof loadAllData === 'function')        await loadAllData();
          if (typeof invalidateAllCaches === 'function') await invalidateAllCaches();
          if (typeof refreshAllDisplays === 'function') await refreshAllDisplays();
        } catch (_uiErr) {  }

        showToast(` Data refreshed after ${_sigLabel} from another device.`, 'success', 4000);
        recordSuccessfulConnection();
      } catch (_sigHandlerErr) {
        console.warn('[sync] yearCloseSignal handler error:', _safeErr(_sigHandlerErr));
      }
    };
    const yearCloseSignalUnsub = userRef.collection('settings').doc('yearCloseSignal').onSnapshot(async (doc) => {
      if (isSyncing) { _enqueueSyncLocked(_handleYearCloseSignal, doc); return; }
      await _handleYearCloseSignal(doc);
    }, _e => {
      const _ec = _e && _e.code;
      console.warn('[sync] yearCloseSignal listener error:', _ec, _safeErr(_e));
    });
    realtimeRefs.push(yearCloseSignalUnsub);

    try {
      const _listenDeviceId = (typeof getDeviceId === 'function') ? await getDeviceId().catch(() => null) : null;
      if (_listenDeviceId) {
        const _deviceDocRef = userRef.collection('devices').doc(_listenDeviceId);
        const _handleDeviceSnapshot = async (docSnap) => {
          try {
            if (!docSnap.exists) return;
            if (docSnap.metadata.hasPendingWrites) return;
            if (docSnap.metadata.fromCache) return;
            const data = docSnap.data();
            if (!data) return;
            const cloudMode      = data.currentMode || 'admin';
            const cloudTimestamp = data.appMode_timestamp || 0;

            if (!data.remoteAppliedMode) return;
            const localTimestamp = Number(await sqliteStore.get('appMode_timestamp').catch(() => 0)) || 0;
            if (cloudTimestamp <= localTimestamp) return;
            if (cloudMode === appMode) return;

            if (typeof _applyModeFromData === 'function') {
              _applyModeFromData(
                cloudMode, cloudTimestamp,
                data.assignedRep    || null,
                data.assignedManager || null,
                data.assignedUserTabs || [],
                true
              );
            }
          } catch (_devSnapErr) {
            console.warn('[sync] device snapshot handler error:', _safeErr(_devSnapErr));
          }
        };
        const deviceDocUnsub = _deviceDocRef.onSnapshot(async (docSnap) => {
          if (isSyncing) { _enqueueSyncLocked(_handleDeviceSnapshot, docSnap); return; }
          await _handleDeviceSnapshot(docSnap);
        }, _e => {

          console.warn('[sync] device doc listener error:', _e && _e.code, _safeErr(_e));
        });
        realtimeRefs.push(deviceDocUnsub);
      }
    } catch (_devListenErr) {
      console.warn('[sync] failed to register device doc listener (non-fatal):', _safeErr(_devListenErr));
    }

    updateSignalUI('online');
    recordSuccessfulConnection();
    listenerRetryAttempts = 0;
    if (typeof registerDevice === 'function') {
      registerDevice().catch(err => { console.warn('Device registration failed:', _safeErr(err)); });
    }
  } catch (error) {
    console.error('[sync] subscribeToRealtime failed:', _safeErr(error));
    showToast('Failed to connect to cloud. Retrying…', 'error');
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
    showToast(' Live update received', 'success', 2000);
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
    window._fbOnlineHandler = () => {

      listenerRetryAttempts = 0;
      isReconnecting = false;
      if (listenerReconnectTimer) { clearTimeout(listenerReconnectTimer); listenerReconnectTimer = null; }
      if (firebaseDB && currentUser) {
        subscribeToRealtime().catch(e => console.warn('[sync] online-recovery re-subscribe failed:', _safeErr(e)));
      }
    };
    window.addEventListener('offline', window._fbOfflineHandler);
    window.addEventListener('online',  window._fbOnlineHandler);
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

  if (collectionName) {
    for (const sid of localIds) {
      if (useUUIDGate) UUIDSyncRegistry.markDownloaded(collectionName, sid);
      else DeltaSync.markDownloaded(collectionName, sid);
    }
  }

  for (let cloudItem of cloudArray) {
    if (!cloudItem.id || cloudItem.id === '_placeholder_' || cloudItem._placeholder) continue;
    if (!validateUUID(cloudItem.id)) { cloudItem = ensureRecordIntegrity(cloudItem, false, true); fixedCount++; }
    const sid = String(cloudItem.id);

    if (!localIds.has(sid)) {
      if (useUUIDGate && UUIDSyncRegistry.skipDownload(collectionName, sid)) {
        skippedCount++;
        continue;
      }
      if (!useUUIDGate && collectionName
          && DeltaSync.wasDownloaded(collectionName, sid)
          && !DeltaSync.isDirtyId(collectionName, sid)) {
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

        : (cloudItem.isMerged === true && localRecord.isMerged !== true)
          || (!(localRecord.isMerged === true && cloudItem.isMerged !== true)
              && _toMs(cloudItem.updatedAt || cloudItem.timestamp) > _toMs(localRecord?.updatedAt || localRecord?.timestamp));

      if (cloudWins) {
        merged[idx] = ensureRecordIntegrity(cloudItem, false, true);
        downloadedCount++;
        if (useUUIDGate) UUIDSyncRegistry.markDownloaded(collectionName, sid);
        else if (collectionName) DeltaSync.markDownloaded(collectionName, sid);
      }
      else if (collectionName) {
        if (useUUIDGate) {
          UUIDSyncRegistry.markDownloaded(collectionName, sid);
          UUIDSyncRegistry.markUploaded(collectionName, sid);
        } else {
          DeltaSync.markDownloaded(collectionName, sid);
          DeltaSync.markUploaded(collectionName, sid);
        }
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

async function _downloadDeltas(userRef, userType, forceDownload = false) {
  const FRESH_THRESHOLD_MS = 8 * 1000;
  const buildQuery = async (collection, collectionName) => {

    if (forceDownload || userType === 'existing') return collection.get();
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
    settingsSnap, factorySettingsSnap, expenseCategoriesSnap, appStoresSnap,
    productionSnap, salesSnap, calcHistorySnap,
    repSalesSnap, repCustomersSnap, salesCustomersSnap,
    transactionsSnap, entitiesSnap,
    inventorySnap, factoryHistorySnap,
    expensesSnap, returnsSnap,
  ] = await Promise.all([
    userRef.collection('settings').doc('config').get(),
    userRef.collection('factorySettings').doc('config').get(),
    userRef.collection('expenseCategories').doc('categories').get(),
    userRef.collection('appStores').doc('stores').get(),
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
  trackFirestoreRead(4);
  let realCollectionReads = 0;
  [productionSnap, salesSnap, calcHistorySnap, repSalesSnap, repCustomersSnap,
   salesCustomersSnap, transactionsSnap, entitiesSnap, inventorySnap,
   factoryHistorySnap, expensesSnap, returnsSnap].forEach(snap => {
    if (snap && typeof snap.query !== 'undefined') realCollectionReads++;
  });
  trackFirestoreRead(realCollectionReads);

  let personPhotosSnap = null;
  try {
    const lastPhotoSync = await DeltaSync.getLastSyncFirestoreTimestamp('personPhotos');
    personPhotosSnap = lastPhotoSync && !forceDownload
      ? await userRef.collection('personPhotos').where('updatedAt', '>', lastPhotoSync).get()
      : await userRef.collection('personPhotos').get();
    if (personPhotosSnap && !personPhotosSnap.empty) trackFirestoreRead(personPhotosSnap.docs.length);
  } catch(_phe) { console.warn('[downloadDeltas] personPhotos fetch error', _phe); }

  const extract = (snap) => snap
    ? snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(d => !d._placeholder)
    : [];

  return {
    settings: settingsSnap,
    factorySettings: factorySettingsSnap,
    expenseCategories: expenseCategoriesSnap,
    appStores: appStoresSnap,
    personPhotosSnap,
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

  const _yearCloseCollectionKeys = [
    ['mfg_pro_pkr',                'mfg_pro_pkr'],
    ['customer_sales',             'customer_sales'],
    ['noman_history',              'noman_history'],
    ['rep_sales',                  'rep_sales'],
    ['payment_transactions',       'payment_transactions'],
    ['factory_production_history', 'factory_production_history'],
    ['stock_returns',              'stock_returns'],
    ['expenses',                   'expenses'],
  ];
  const _applyYearCloseCompaction = (localArr, cloudArr) => {
    if (!Array.isArray(cloudArr) || cloudArr.length === 0) return localArr;
    const cloudAllMerged = cloudArr.every(r => r.isMerged === true);
    if (cloudAllMerged) {

      const cloudIds = new Set(cloudArr.map(r => String(r.id)));
      return localArr.filter(r => {
        if (!r || !r.id) return false;
        if (cloudIds.has(String(r.id))) return true;
        if (r.isMerged === true) return false;

        return true;
      });
    }

    const cloudNoneMerged = cloudArr.every(r => r.isMerged !== true);
    const localHasMerged  = localArr.some(r => r && r.isMerged === true);
    if (cloudNoneMerged && localHasMerged && cloudArr.length > 0) {
      const cloudIds = new Set(cloudArr.map(r => String(r.id)));
      return localArr.filter(r => {
        if (!r || !r.id) return false;
        if (cloudIds.has(String(r.id))) return true;
        if (r.isMerged === true) return false;
        return true;
      });
    }
    return localArr;
  };

  const _preFilter = {};
  for (const [localKey, cloudKey] of _yearCloseCollectionKeys) {
    const localArr = ensureArray(_localBatch.get(localKey));
    const cloudArr = data[cloudKey] || [];
    _preFilter[localKey] = _applyYearCloseCompaction(localArr, cloudArr);
  }

  const _m = (key, col, cloudKey) =>
    mergeArrays(
      ensureArray(_preFilter[key] !== undefined ? _preFilter[key] : _localBatch.get(key)),
      data[cloudKey] || [],
      col
    ).filter(_notDeleted);
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
  const { settings: settingsSnap, factorySettings: factorySettingsSnap, expenseCategories: expCatSnap, appStores: appStoresSnap, personPhotosSnap } = cloudData;

  if (settingsSnap && settingsSnap.exists) {
    const sd = settingsSnap.data();
    if (sd && sd.naswar_default_settings) {

      const ct = sd.naswar_default_settings_timestamp || 0;
      const lt = (await sqliteStore.get('naswar_default_settings_timestamp')) || 0;
      const localSettings = (await sqliteStore.get('naswar_default_settings')) || {};
      if (ct >= lt) {

        const cloudFy = sd.naswar_default_settings;
        const mergedFy = {
          ...localSettings,
          ...cloudFy,

          fyCloseCount: Math.max(
            typeof cloudFy.fyCloseCount  === 'number' ? cloudFy.fyCloseCount  : 0,
            typeof localSettings.fyCloseCount === 'number' ? localSettings.fyCloseCount : 0
          ),

          lastYearClosedAt: Math.max(
            cloudFy.lastYearClosedAt   || 0,
            localSettings.lastYearClosedAt || 0
          ) || null,
          lastYearClosedDate: (
            (cloudFy.lastYearClosedAt || 0) >= (localSettings.lastYearClosedAt || 0)
              ? cloudFy.lastYearClosedDate
              : localSettings.lastYearClosedDate
          ) || null,
        };
        defaultSettings = mergedFy;
        await sqliteStore.setBatch([
          ['naswar_default_settings', defaultSettings],
          ['naswar_default_settings_timestamp', ct || Date.now()],
        ]);
      } else {

        const cloudFy = sd.naswar_default_settings;
        const mergedFy = {
          ...cloudFy,
          ...localSettings,

          fyCloseCount: Math.max(
            typeof cloudFy.fyCloseCount  === 'number' ? cloudFy.fyCloseCount  : 0,
            typeof localSettings.fyCloseCount === 'number' ? localSettings.fyCloseCount : 0
          ),
        };
        defaultSettings = mergedFy;
        await sqliteStore.set('naswar_default_settings', defaultSettings);

      }
    }

    if (sd && sd.repProfile) {
      const ct = sd.repProfile_timestamp || 0;
      const lt = (await sqliteStore.get('repProfile_timestamp')) || 0;
      if (ct >= lt) {
        currentRepProfile = sd.repProfile;
        await sqliteStore.setBatch([
          ['repProfile', currentRepProfile],
          ['current_rep_profile', currentRepProfile],
          ['repProfile_timestamp', ct || Date.now()],
        ]);
      }
    }

    if (sd && Array.isArray(sd.sales_reps) && sd.sales_reps.length > 0) {
      const ct = sd.sales_reps_timestamp || 0;
      const lt = (await sqliteStore.get('sales_reps_list_timestamp')) || 0;
      if (ct >= lt) {
        salesRepsList = sd.sales_reps;
        await sqliteStore.setBatch([
          ['sales_reps_list', salesRepsList],
          ['sales_reps_list_timestamp', ct || Date.now()],
        ]);
      }
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

  if (appStoresSnap && appStoresSnap.exists) {
    const asd = appStoresSnap.data();
    if (asd && Array.isArray(asd.stores)) {
      const cloudStoresTs = asd.stores_timestamp || 0;
      const localStoresTs = (await sqliteStore.get('app_stores_timestamp')) || 0;
      if (cloudStoresTs >= localStoresTs) {
        await sqliteStore.set('app_stores', asd.stores);
        if (cloudStoresTs) await sqliteStore.set('app_stores_timestamp', cloudStoresTs);
        if (typeof _invalidateStoresCache === 'function') _invalidateStoresCache();
      }
    }
  }

  if (personPhotosSnap && !personPhotosSnap.empty) {
    try {
      const localPhotos = (await sqliteStore.get('person_photos')) || {};
      const localPhotoTimestamps = (await sqliteStore.get('person_photos_timestamps')) || {};
      const localDirtyKeys = new Set((await sqliteStore.get('person_photos_dirty_keys')) || []);
      let photosChanged = false;
      let timestampsChanged = false;
      for (const doc of personPhotosSnap.docs) {
        const docData = doc.data();
        const photoKey = docData.key;
        if (!photoKey) continue;

        if (localDirtyKeys.has(photoKey)) continue;

        if (docData.deleted) {
          if (localPhotos[photoKey] !== undefined) {
            delete localPhotos[photoKey];
            delete localPhotoTimestamps[photoKey];
            photosChanged = true;
            timestampsChanged = true;
          }
        } else if (docData.data) {
          const remoteUpdatedAt = docData.updatedAt?.toMillis ? docData.updatedAt.toMillis() : 0;
          const localUpdatedAt = localPhotoTimestamps[photoKey] || 0;
          if (!localPhotos[photoKey] || remoteUpdatedAt > localUpdatedAt) {
            localPhotos[photoKey] = docData.data;
            if (remoteUpdatedAt) {
              localPhotoTimestamps[photoKey] = remoteUpdatedAt;
              timestampsChanged = true;
            }
            photosChanged = true;
          }
        }
      }
      if (photosChanged) await sqliteStore.set('person_photos', localPhotos);
      if (timestampsChanged) await sqliteStore.set('person_photos_timestamps', localPhotoTimestamps);
      await DeltaSync.setLastSyncTimestamp('personPhotos');
    } catch(_phe) { console.warn('[syncSettings] personPhotos merge error', _phe); }
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
  const _pendingUploadMarks = []; 

  for (const [collectionName, dataArray] of Object.entries(collections)) {
    if (!Array.isArray(dataArray) || dataArray.length === 0) continue;
    const _isUploaded = (col, id) => {
      if (typeof UUIDSyncRegistry !== 'undefined') return UUIDSyncRegistry.skipUpload(col, id);
      return DeltaSync.wasUploaded(col, id);
    };
    const changedItems = await DeltaSync.getChangedItems(collectionName, dataArray);
    if (changedItems.length === 0) continue;
    for (const item of changedItems) {
      if (!item || !item.id) continue;

      if (_isUploaded(collectionName, item.id)) continue; 

      if (DeltaSync.wasDownloaded(collectionName, item.id)
          && !DeltaSync.isDirtyId(collectionName, item.id)) {
        _pendingUploadMarks.push({ collectionName, id: item.id }); 
        continue;
      }
      if (!validateUUID(String(item.id))) {
        console.warn('[uploadChanges] Skipping upload: invalid UUID', item.id);
        continue;
      }
      const docId = String(item.id);
      if (!docId || docId.includes('/')) continue;
      const sanitizedItem = sanitizeForFirestore(item);
      if (!sanitizedItem || Object.keys(sanitizedItem).length === 0) continue;
      sanitizedItem.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      if (sanitizedItem.id && typeof sanitizedItem.id !== 'string') sanitizedItem.id = String(sanitizedItem.id);
      getOrNewBatch().set(userRef.collection(collectionName).doc(docId), sanitizedItem, { merge: true });
      operationCount++;
      totalItemsToWrite++;
      trackFirestoreWrite(1);

      _pendingUploadMarks.push({ collectionName, id: item.id });
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

  const localStoresTs = await sqliteStore.get('app_stores_timestamp');
  const lastStoresSync = await DeltaSync.getLastSyncTimestamp('appStores');
  if (localStoresTs && (!lastStoresSync || localStoresTs > lastStoresSync)) {
    const _as = await sqliteStore.get('app_stores');
    configBatch.set(
      userRef.collection('appStores').doc('stores'),
      sanitizeForFirestore({ stores: _as || [] }),
      { merge: true }
    );
    operationCount++;
    collectionsUploaded.add('appStores');
  }

  let _uploadedPhotoKeys = [];
  try {
    const _dirtyPhotoKeys = (await sqliteStore.get('person_photos_dirty_keys')) || [];
    if (_dirtyPhotoKeys.length > 0) {
      const _allPhotos = (await sqliteStore.get('person_photos')) || {};
      const _photosRef = userRef.collection('personPhotos');
      for (const _photoKey of _dirtyPhotoKeys) {
        const _safeDocId = btoa(unescape(encodeURIComponent(_photoKey))).replace(/[+/=]/g, c => ({'+':'-','/':'_','=':''})[c] || '');
        const _photoVal = _allPhotos[_photoKey];
        const _photoBatch = getOrNewBatch();
        if (_photoVal) {
          _photoBatch.set(_photosRef.doc(_safeDocId), { key: _photoKey, data: _photoVal, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: false });
        } else {
          _photoBatch.set(_photosRef.doc(_safeDocId), { key: _photoKey, data: null, deleted: true, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: false });
        }
        operationCount++;
        totalItemsToWrite++;
        trackFirestoreWrite(1);
        _uploadedPhotoKeys.push(_photoKey);
      }
      collectionsUploaded.add('personPhotos');
    }
  } catch(_photoUploadErr) { console.warn('[uploadChanges] person_photos upload error', _photoUploadErr); }

  if (operationCount > 0) batches.push(currentBatch);
  for (const batch of batches) {
    await batch.commit();
  }

  for (const { collectionName, id } of _pendingUploadMarks) {
    if (typeof UUIDSyncRegistry !== 'undefined') {
      UUIDSyncRegistry.markUploaded(collectionName, id);
    } else {
      DeltaSync.markUploaded(collectionName, id);
    }
  }

  if (_uploadedPhotoKeys.length > 0) {
    try {
      const _remainingDirty = (await sqliteStore.get('person_photos_dirty_keys')) || [];
      const _uploadedSet = new Set(_uploadedPhotoKeys);
      await sqliteStore.set('person_photos_dirty_keys', _remainingDirty.filter(k => !_uploadedSet.has(k)));
      const _localTs = (await sqliteStore.get('person_photos_timestamps')) || {};
      const _nowMs = Date.now();
      _uploadedPhotoKeys.forEach(k => { _localTs[k] = _nowMs; });
      await sqliteStore.set('person_photos_timestamps', _localTs);
    } catch(_postPhErr) { console.warn('[uploadChanges] person_photos post-commit cleanup error', _postPhErr); }
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
    + (collectionsUploaded.has('expenseCategories') ? 1 : 0)
    + (collectionsUploaded.has('appStores') ? 1 : 0);
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
    if (!silent) { showToast('⌛ Connecting to cloud…', 'info', 3000); initializeFirebaseSystem(); }
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
  if (!silent && btn) btn.innerHTML = 'Syncing…';
  if (!silent) showToast('Syncing with cloud…', 'info', 2000);

  try {
    if (typeof initDeviceShard === 'function') {
      await initDeviceShard().catch(() => {});
    }
    if (typeof UUIDSyncRegistry !== 'undefined') {
      await UUIDSyncRegistry.loadAll().catch(() => {});
    }
    const userRef = firebaseDB.collection('users').doc(currentUser.uid);

    const userType = await _detectUserType(userRef);

    if (userType === 'new') {
      await initializeFirestoreStructure(true);
      await sqliteStore.set('firestore_initialized', true);
      if (!silent) showToast('Your account is ready!', 'success');
      return;
    }

    const syncForceDownload = (userType === 'existing');
    const cloudData = await _downloadDeltas(userRef, userType, syncForceDownload);
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
      } else if (totalCloudChanges > 0 || totalItemsToWrite > 0) {

        showToast(` Synced — ${totalCloudChanges} new, ${totalItemsToWrite} uploaded`, 'info', 3000);
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
        showToast(' Already up to date', 'success', 2500);
      } else if (totalCloudChanges === 0) {
        showToast(`↑ ${totalItemsToWrite} local change${totalItemsToWrite !== 1 ? 's' : ''} uploaded`, 'success');
      } else if (totalItemsToWrite === 0) {
        showToast(`↓ ${totalCloudChanges} cloud change${totalCloudChanges !== 1 ? 's' : ''} downloaded`, 'success');
      } else {
        showToast(`${totalCloudChanges} downloaded · ${totalItemsToWrite} uploaded`, 'success');
      }
      if (typeof closeDataMenu === 'function') closeDataMenu();
    } else if (totalCloudChanges > 0 || totalItemsToWrite > 0) {

      showToast(` Synced — ${totalCloudChanges} new, ${totalItemsToWrite} uploaded`, 'info', 3000);
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
      const menuBtn = document.getElementById('sync-btn') || document.querySelector('#sync-data-screen .btn-main');
      if (menuBtn) { btn = menuBtn; originalText = btn.innerText; btn.textContent = 'Uploading...'; btn.disabled = true; }
      else showToast('Starting upload...', 'info');
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
        ? ' Already up to date — nothing to upload'
        : ` Backup complete — ${operationCount} item${operationCount !== 1 ? 's' : ''} uploaded`;
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

    if (typeof initDeviceShard === 'function') {
      await initDeviceShard().catch(() => {});
    }

    const userRef = firebaseDB.collection('users').doc(currentUser.uid);
    const pullUserType = await _detectUserType(userRef);

    const effectiveUserType = forceDownload ? 'existing' : (pullUserType === 'new' ? 'existing' : pullUserType);
    const cloudData = await _downloadDeltas(userRef, effectiveUserType, forceDownload);

    const hasData = Object.values(cloudData.data).some(a => a.length > 0)
      || (cloudData.settings && cloudData.settings.exists)
      || (cloudData.factorySettings && cloudData.factorySettings.exists);
    if (!hasData && !forceDownload) {
      if (!silent) showToast('Cloud is empty. Nothing to download.', 'info');
      return;
    }
    if (!hasData && forceDownload) {
      if (!silent) showToast('No data found in cloud.', 'warning');
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

    queueMicrotask(() => {
      if (typeof refreshAllDisplays === 'function') refreshAllDisplays().catch(() => {});
    });
  } catch (error) {
    console.error('[pullDataFromCloud] error:', _safeErr(error));
    if (!silent) showToast('Restore failed. Using local data.', 'error');

    queueMicrotask(() => {
      if (typeof refreshAllDisplays === 'function') refreshAllDisplays().catch(() => {});
    });
  } finally {
    isSyncing = false;
    _flushSyncLockQueue().catch(() => {});
  }
}

async function showSyncHealthPanel() {
  try {
    const results = await verifyDeltaSyncSystem();
    const lastSync = (await sqliteStore.get('last_synced', null)) || 'Unknown';
    const pending = results.issues.length;
    const ok = results.valid.length;

    const existing = document.getElementById('sync-health-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'sync-health-panel';
    panel.setAttribute('role', 'dialog');
    panel.style.cssText = `
      position:fixed;bottom:20px;right:20px;z-index:10300;
      background:var(--glass-bg,#1e293b);border:1px solid var(--glass-border,#334155);
      border-radius:16px;padding:20px 24px;min-width:280px;max-width:360px;
      box-shadow:0 8px 32px rgba(0,0,0,.4);color:var(--text-main,#f1f5f9);font-size:.85rem;
    `;
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <strong style="font-size:.95rem">Sync Health</strong>
      </div>
      <div style="margin-bottom:8px">
        <span style="color:#10b981"> ${ok} collections OK</span>
        ${pending ? `&nbsp;·&nbsp;<span style="color:#f59e0b"> ${pending} issues</span>` : ''}
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
  } catch (e) { console.warn('[SyncHealth]', _safeErr(e)); }
}
window.showSyncHealthPanel = showSyncHealthPanel;
let seamlessBackupTimer = null;
const SEAMLESS_DELAY_MS = 5000;
async function triggerSeamlessBackup() {
if (seamlessBackupTimer) {
clearTimeout(seamlessBackupTimer);
}
seamlessBackupTimer = setTimeout(async () => {
try {
if (currentUser && firebaseDB) {
await pushDataToCloud(true);
}
} catch (e) { console.warn('[Backup] Seamless backup error:', _safeErr(e)); }
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
      try {
        if (firebaseDB && currentUser) await pullDataFromCloud(false);
      } catch (e) { console.warn('[Sync] Wake-up pull error:', _safeErr(e)); }
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

async function createAuthOverlay() {
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
<img src="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIbGNtcwIQAABtbnRyUkdCIFhZWiAH4gADABQACQAOAB1hY3NwTVNGVAAAAABzYXdzY3RybAAAAAAAAAAAAAAAAAAA9tYAAQAAAADTLWhhbmSdkQA9QICwPUB0LIGepSKOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAABxjcHJ0AAABDAAAAAx3dHB0AAABGAAAABRyWFlaAAABLAAAABRnWFlaAAABQAAAABRiWFlaAAABVAAAABRyVFJDAAABaAAAAGBnVFJDAAABaAAAAGBiVFJDAAABaAAAAGBkZXNjAAAAAAAAAAV1UkdCAAAAAAAAAAAAAAAAdGV4dAAAAABDQzAAWFlaIAAAAAAAAPNUAAEAAAABFslYWVogAAAAAAAAb6AAADjyAAADj1hZWiAAAAAAAABilgAAt4kAABjaWFlaIAAAAAAAACSgAAAPhQAAtsRjdXJ2AAAAAAAAACoAAAB8APgBnAJ1A4MEyQZOCBIKGAxiDvQRzxT2GGocLiBDJKwpai5+M+s5sz/WRldNNlR2XBdkHWyGdVZ+jYgskjacq6eMstu+mcrH12Xkd/H5////2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wgARCAMRBC0DASIAAhEBAxEB/8QAHQAAAQQDAQEAAAAAAAAAAAAAAAECBQYEAwcICf/aAAgBAQAAAACIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA9AeeFcAAAAAAAAAAAAAAAAoIAAKgACoAAKIAAAAAAAAAAAAAAAArD0J56nL6AAAAAAAAAAKqgOHAKoqiqKKAAAAAAggg0QREVBEaoiIAAAAAAAAAAUKE9Ceep2+gtpdGTUVAgFu26KmALdtcdXQFUUFs+UVEVVHCqKAoCgAAAgIAgiDREQEGoCCIAAAAAAAAAFCg/QnnqdvoXXzVxtN/o7rdUAm/D/uiuAGyO8o++KECqoKq2/wL7S1Ko5VUBQVQUAAABARAEBERoiICIiAiIAAAAAAAAAUKD9Ceep2+kvzPzp6qvXJPOPsO1SaOkue3WhW/J07cKTpt0xRNsXWZG0KlXsPgX2lrcqqoKKKoKCgAACAgIgggIiIiIgg1AREAAAAAAAAAoUH6E89Tt9Lv4i6X36uXXx5P+xPn7euZezvIftXN8i0HsPO/XkP5e+gHlWCqVV9Ad0rvkOFsHsWa8A+02qqgqqKKKKAoAAICAgggiICIjUGgiIgg0AAAAAAAAKFB+hPPU7fS8+BvT1sxZ3hVE90fOXqvb7d4M99cS4X7Q5f5n9qQnlD6L+RuVe0+OcD+jvn6N714g6x6K+ePtMFFVVFUUUFUAAAQBBBBEEREEEaiIgiIgg0AAAAAFk56V3Y+vn1Cg/QnnqdvpefBPo++4Fi88Vf3F85fYeVK+HPf/lfK9DSfgb2pCeUPov5FhfUdW8dfQfXxHmXO+7elfnd7UBVVRVUUVRRRQANmdshlEEQQRBEREEGo1EBqJvslZxwAAAA32meqNCqMbeewUOhQfoTz1O30t/kdnsiq2bwt2D1B86/Z2NN+HvoB5hifVuH4S9qwnlD6L+RY70xW/G/0f8NzHpTy3efSXzv9puHKOFUVVFUFAFTMm5bFpzWOQRBEEQaI0QRGojQRts3JS0AAADIt+by3nOIB6Vq+DQoP0J56nb6ZTPGvQel8egfb+d4C9o4k34e950fyN3mhUL2pCeUPox5EjfTVZ8cfR/5+dF7D5I7Z6Y+d3tR4qq4VVFVQFFBZGfq1WhZup2O0ICCINEGoiDUJS50OPREEt/OOxcza0AFQ2W+S5HzvWAWnvXOyhQfoTz1O30J6M4BBWz0PHWnyx6Prts8zeobFwnnPaPG/tbbwT2BwHC6zjedPXnMfOloueN6Q8c+ko1VVVVVUUVVAV0pYdlc59Xq7I2W5PBEQQRERERERpcK5b61BIiFooNrIZqAWS60iF6LyXmWoJe63Kemmc/i6FB+hPPU7fQMieysGB1yEphREpnrzPj/qaoeS/dWPkRsmsFK5ca6bx9e3HysWNco5VFVVVRRXSEdFQdcrcJbelTkDKZKAiIiIIiNEaNSwVbItMFO51Zhc+zcJ9Cc4REW6x1D6TVbz5gTb0Lp1kp1RrsN1rfXqFB+hPPU7fQAAAAFt3lKjZfeeu1hXKKorniuVVVVVXQsTclVVUXbqysfSW3i9K7NIAIIIIiIIiNREy5CBTdOUK4pmcX7k2cyvOvXK7gJs6Bz/AI5P9/59f+TT3SarzilakM/07zRtCg/QnnqdvoAAAABus+e2DhFVzISrQWBiaJGWtlsk3Kqq4dVfLl07Vc1XXujqZEVirV7uMpFW64iAIIIiDREag3fbadZqjLYMV1PH5nx71LJcvuuNzu71Zek8X52P9S85neg8q5PGKgHZLHVyhQfoTz1O30AAAAAByirG0muQunbrVmnEH9N6hIOVVVV5157sXQe0ZVcdx3TqpmFb+9ZkuKCAgiCIgiNREdc/PtS7VeIW2QeVB3XCyPOXR5C0cq6LSFvXmEDsNol+HVANtlscvl37mjChQfoTz1O30AAAAAFVQoVB0ArlZq04eLq053bulDlVw7k/AvX07jYNfqdOt0xt4x6CuIACAiCIiIuZgNRLHzrkY/1HV8RLTROnVRuZNUKxS+HTG9M8qMDsF3fxKpWfs9ijYvDx8LFChQfoTz1O30AAAAAVVFonL0fvYMMXBxNDN+RjP9K3B6qquOWZ01Uazh2PpdkKRZ5EUEVBAQQai2jFj4tEybL58qvZ7zVESfodgsnBPR3PH65eI1N6L5sih3qzmVy5RQ16F2KIqTQAoUH6E89Tt9AAAAAHKLU+SY+5HbNWvFZq0CP24WI/qXcJFVIKj0iZskzYpnYqgoAAJlYqIggWbk9V79VkRu+1c/vdNa1LFzvn0bLepapOrB1MbduK08PU3OLZQOZhu6z0zn+GAUKD9Ceep2+gAAAAKqkXxaJXK24zHa1G6k0xmJjMXZd/Ss0quFcKoqqooABmS8WsYiCLZOS8o2eq6qjUTZLwWtqJePOHaOVdey6jSKr6j5shZ+e80D1Hzuf0cJRULV36kRoFCg/QnnqdvoAAAAKqhyGmMXKx2JrY/XqxsTFNbEdkSfRvQu1yqqqqrtsmJCCioC7Mrzt0foUciIknVuDoejHaEajrjgVVqSuFxT1HE5PJ+Z9wbYaeiTUTxUPS9M1X2v8AD7XSRJz0XRMIKFB+hPPU7fQAAAAcosZwuL0ZTNrWv16cbEx9m52PibHMy5j0ZeHKqqquWw8H6jJ4igoJl1DhndbXiDRFn/MkQdoukWiJZ+M3uSiXW7h3bK/FZ1ww9EfX9TUy5jzsHoqAwyyWbPrfB4MtveOchQoP0J56nb6AAAAKqjuYc4wH5TdTsjU1uG5hg4uvYut27Jv/AKZ2uVyqqyNX4DYfTFfVRFNs15yqXRu4QSINTNr/AJ/TpXXINEz8DzxLem6XnT2RUMJqJkTkNHsahePMAd+w48HrI3binPV9Qc/aUKD9Ceep2+gAAADlF18FhYxMnYYy5OliPx8TH17W603as3N9H9HcrlVXy3l/BTuFoARUjOYUoOpdB2AqGrztjXzt8A11k8xxZ6Dy4/Mw9TUat55J1znzEa3o/lVh1boIIqKafPGN3nRFlCg/QnnqdvoAAACqo6E8/wARqTds3ruRUx8fXiJvezMxsF+Ru6h6Qc5VHTfEucgAACoAKgAAXruMCk9yblwX3tNYRqMRthpXJfVPPUa1vQvN0OAAAAdRvFVKFB+hPPU7fQAAAFcK6v8AmjF07MtybMjJ2adeNjaJDdlzMtRoJ27OsXrLMVXKslW/PTAAAAAAAAC9dzgUkcHzrpTK9U01rWo1L15clPQlIRrW3TjNJAAAALl2iiFCg/QnnqdvoAAAKqjlgPM8e12Tsfsykdv1YiZORI3Gfi+c11uyQlvWMoqucqydJ4KgAAAAAAAF67pBNSVgvPjD0rg6Ea1Mo8+XfstRRGtslD5cAAAATXornRQoP0J56nb6AAADlFcpwPm+xmVYE2rGrnyeOurOv9gbE84qsTkSV/8ASz3K5wrpbjXLQAAAAAAAL13WDRiTvMeRHb7NGNa1LBzDmc96OoaI1s1E8SQAAADN9O80KFB+hPPU7fQAAAco5VWg8AfMXhMqNq2Ta510/BRN0nG48VTOdV7Mk+2drVzlVXDpHyvhAAAAAAABeu7QjWtSz+XI3qPT4JqNbcPO1cO9WKratlglOCVQAAAA3+pOZlCg/QnnqdvoAAAqqPUdjeZMfs0vGykRizNh3ZUbFyM0a8SKhanzDI3+p7m5yuVVV0v5kroAAAAAAAXru8IjWts/nSqdF69ANajLt5bwTZ1TpGXH8+5figAAABs9T8zKFB+hPPU7fQAABXCvFczkNN7Xg1jEryyd7uUro1Y9ejd+/dj7KNy24esd6q5yqrpLlHHQAAAysUAAAL13eFRGzNA4kdT6dCMRrbp5cwABRAAAAAB/qbmpQoP0J56nb6AAAOUc4VYiH5r1iCrjJV0NE2zpGdDcnr0nq2N3dOguSdf7VmOcqq58lzTiCLucABldUvfBIJAAALv3KGaTdF4Uw7xPR6Na22+e6uAAAGRsYAABL+iealCg/QnnqdvoAACqquUcR+DznpGdprkdWMW9JbJSuRK0KXnrDivial1Sz2Vyqr8rI4rzAH+qpPaxptTXp05YIBtXQgReFkyfH+VNHepoJjWI2ZoXIwAAA9F2JBAADVTYooUH6E89Tt9AAAVwrlVyxTqdaZl0DpxYufirVJwMXP0WdYXHBrGPbZ+yOzct2qhcehgLv6I11OxbttF33PGRGoiG+AibzF5WWraNx6CAuPoCsta1rHWby7pAAAk/TXN2oI0AAChQfoTz1O30AAByjnDldH66/NzGQ3Rp04mibz4LDkd7Ez1jq/mTM5YllfOuFC6UAd6WslY84y/pKB85t77fMZERqbMDzVidy6Ft86YELoQBfRGfhta1rWT9N4mAAC91kK8jRGgAAUKD9Ceep2+gAAqqOcOc7CZAyUpnbRmrF0yGRE4uRm7nOxo2Pzc2zTCyNY4REAC9R7dq8qR5eYqtlo9NYaIjUkPOlLSY9R40DwOHAC7d+rLWoxrWpbeY8iQADqPVKCjWiIgAAUKD9Ceep2+gAAqqrlVXP1x7sORzMlzFx8eS2RWJl5O9+vCjcHNzr1vc/J38t5PgBbvR2rJ55wXP9NHm7V6ZymiI1Hs84RHpXOxt+Vy/lGAhNelIjHajEY1rUs8NxyriEz163UbUiNQagAAUKD9Ceep2+gAArhyqrnOWJfHSOTk73vwseZyouGz85TRgR2iw5lre5yuyznFPsnWNbXZFAmbImDhzWtEREajiCnsRrG5uXzmlzfVY3DY1rWta1rWZ9gIbXKZlbgmNREaNQAAKFB+hPPU7fQAAco5VVz3GJhR8jk78jL3R2Jrt9di8+Z14mjEwNUvbZR7lc5z929mocq7UYOGCI1ERGquOiMbJ0e/YeiO1tbrajWIxqMa1r0060RjURGiNAAChQfoTz1O30AAHKOcOc5yri1iTycrLzNkdWo+bi1tExrwdGDgbbjYHvcrnPVyq5XKKAAgjUaiNRiMRrJjwF9A40h2IxrEYjGtaxGNa1Go1rWjWiNAAChQfoTz1O30AAHKPUc56q5artycvPyWYkRGbMbJnJXfi4kfhWa4ue5yue5yq5XKoqgCCIjUGI1rWtaTXiSy8t9c2zGRjGta3P04DGta1rWtRGNaIw26EAAKFB+hPPU7fQABVVXKPV6q50NHZOTIbdGBrYzfj7ZHN14mDjdBlnPcrnPc5Vc5VVVUARERE2x+bjta1rEyOS+Tb7XPQnYMNrWMRJ+k3+mtY1rWta1EY1ERstad3O9QAFCg/QnnqdvoAAqqrlVyvVXOxKvm5Wbt0wVZbh5rpG15qYmHt6S973K5z3OVzlVyqoACIjdvB+Zew8VrWsaj+a+NQ9w2TSxrWMs/nbzz9D6c1rGtajGojWtRMi2+IOjepubgAUKD9Ceep2+gACuFcquc5XOctOXMzd+uIxcnbvjNdhyNONh2+zue5zl2OcrnOVXKqiggiI3d4XqHveTa1utGpIVwWfhGMRjE2eB3fROpI6Uj8BrWtaMa1E3Xrxz1/rFIAAoUH6E89Tt9AAFcOVVc9w5znYtJzM3L3Y+KCG/Kbi4uH1KUe56udscrnOVXOVVcANREbt8fcU992RrUyyNa2Q86noeH1ta1jZP58H0Nrb7N567BuiGta0axpMQu+/wCzbU6sAFCg/QnnqdvoAArhyqrnuHOc51Bxc7Nzd2zdqXXqTEwtGjr0g97nOc9zlerlc5VcAA1Ea7zJ5x9e9k1pl+b5HuWKsV4Hb7nsGMxprZYvnSn0FhLV5N47Oe9qZra1o1jr9XmVyXn/ACF7Q5mAFCg/QnnqdvoAArhyqrnuVyuc6oQOzMksvMytT9OFjYOMY/YZF2xyue5znOcrnKrwVUR0PKNReC+UPUnoDRu4r5G6r7NjdtN4xwLsPruEZskt9Ztfzm0++8bG8R37mnqzo0O3fcKpouOzy5SPafO+o+Eap7pgtIBQoP0J56nb6AAK4c4Vz3K5XOdCVJjMnNy8pdmjExcbbur2X3pz3K57nOc5yucrnDhUOQeZ/eT2pyfxb6X9JMMbwCfQnEx9uV8/Yf6HwzbB4r7l0ma+e0R7ynfLlI97eQ657Nh0lvPfoVPNnprwTW/ohB2Hhvlr1rZokAoUH6E89Tt9AAFcOcOV7lcrnOgKPMYml+/fudq0s3ZTK3zX2due5XPe5XOc5yq5w5Qg/AsJ1iTycuv8hu931hzyG+j/ABLHm4/zrRvfO+S4f5cunuh/gir+5bt88MO2TtA7ApX+a9DzuW9S18x65nLhci9T3eGAKFB+hPPU7fQABXDnDle5XK5xzOl9D2aMdcjerGbclcOl8k9b9B2OVz3q5z1Vzlc4VVSP8Uc3AAAAzfpB5G4Uoh70zc6i+M9Hvuf8OUf2weJwAAAAABPVF3hgChQfoTz1O30AAVw5wrnuVyujeL8nl+zT29rN+Suo2mJFcWgtnbu6zSue5znOcrnKrwcCRvgqsAAABm/SDyVwcA93SeuU5N5G9b9s8S839w07yeAAAAAAJ6ou8MAUKD9Ceep2+gACuHKque5VjOT8uh3usXUbTmvV7tuxsLA0Kia9bZbsnfpZz3OV7lcrh6gAvl3zmAAAGb9IPLPngA965bFn/nh6K9GeM+W/QyD8H6TdpAAEUABPVF3hgChQfoTz1O30AAVw5VcryrUHl2Dq0OV+Zbb1eZM2LQqDXsDBxRjshJXsvZbY9Ve5XK5VVwC8s8XY+5zkRBAM76LcW8j6kddvb8Ful/IvHfWnZ/J2f6V0UjzNP1ynb0F6Bh0zp8XQ0AF9RXOGAKFB+hPPU7fQABXCuVUp/I6gujS1o5X7dvWut5LqL57amvUjAzd2vVldZ7vc3uc5XKqquwi/OnnTT3z1eKiOi5WO0SuvSbWtXI0so/lKibPoDvoPWNOLJVzyvyLuPq7QJjm7CflAgIznmOAUKD9Ceep2+gACuFdqonLK07SzUjGubtV23pvXs93FeZa9epGpsZv27GN3bOp+gbi9yq5VVefeV6Thrn++p1qI6keKPUPF677kc1rGtbN+XuT1dF7Z6ogpheQ8Cw6yx/urHxGtajWIiNQagABQoP0J56nb6AAKqwvPaJXUaGsGC6x79/QO1Zi8AozdWsVXJtc9rzYO6P2rqe9VcqmyheauT7vYnXdQ1r6H4v8AWPPq17Bjmpra1u2R4R57r139tQ2hqWCpeU6XlepOsVVrGojGoiNREQAAoUH6E89Tt9AAGxnM+aYIO1I5qjRWtc7fYOwaYbmMUuKqjnqqqj37EehePTd4FVRV2V/ZM6kREZt0ZKtwdbWsajEZn51ZscDita1ubYIzPja21rWojGoiNREQAAoUH6E89Tt9AASicaiWoKrGOBHKialdsRduxmljVNg8VqtVV3ZmMOyvV3UFUFBBBERqNRrWI1GNa1rWNamtiMRjWta1rEa1qIxrRrRGgABQoP0J56nb6AGByLnGhQaNcK5qO2NTQGVa4SPmcOPYjdoqqINcq7dqPEyfSHbVUFQEREaNRGNRrWtYjWsa1rWNa1iMRjWta1rURrEaNaI0AAKFB+hPPU7fQCt8MgmojWORXtVEcOHadSvytazcTpYCg8RER6t27WLv2i+qupqKCCDUEajGo1NrMc342ncYbFyo/W3bkx+rN1YD87ANoyOktEbIqyPlMaOAAKFB+hPPU7fQMbgNZ0sYrWqqtHDVTY5WatbzIXbpTU9BVFBGucjn7NWRs2pYfaOUqKioiCIiMaiNx/Nb/SvMeT9P6t5uw/Qm+N4r6Dj9vO+Z9osHA9/f6HzG7X7gidFv3B83uvL6Fd+l8FkuyQIAFCg/QnnqdvoJx/nOGxGP1ojgVUFVHqM1MXKUR+lHIrmj11tVyue92rJ2bnekuwgACINRqNRE5Li4llkrP5d9X13ltp6D5k0en4+T8j+wPJnTbBWLBy70D5q9YavOndOI9Fy775F7nf69MeaO/QYAFCg/QnnqdvoYnnGMxmsa5BjmvRUcrmq8XVrTIVdjdSqggqhqcbFc/dj79u3bYPYecACIg1qIiI3i0vis7DyvnXpTD879b530jg/q7ks3wL2H409N8HwukxmFFd9hec9g852+n+nOSSnKPQuvhPdYQAChQfoTz1O30KjwfHwntYKAORzVeio8Fx3bh+3RrUVBFchrcm02G1V3bzb6S6yAIDUaNQa1OZVnF6LSex+SPT9OzaRiYFF9QV60eaPUfnX0vW+c33gfq/yf6i5JeMrl135/2CidM8w99fza5ZQAFCg/Qnnqdvocd5mzEexi7GqKCtNiKiua7XseOdoRRWuYquNTh25uxXt37HP6R6kUBEREEREa1r+JbO1VDlXRr5xqM7JtzeXdGjXQfN+s5/HZbp0BzC9Wyq2uCleVznRaLUunZXLpO9wgAFCg/Qnnqdvph+c4TXofqFyGogoIbEUFa/VufjvcxXo1wiONmlw7Y3c1w7buWw+xN4ICDQRGI1EE1tdpQbqa01o1r9DX69bduOx2tibGajboZuYwAAoUH6E89Tt9KlwHF063al3vaIjmOa9VRUc1TbryZCFFURyI57VRHK7YI4TJN2d62swICCCI1qIhkJhZBpx8xI5maka1pKYWBsk47Bk98DlScJslMKIbYcaEzZmCxgAKFB+hPPU7fTlPJNOpNTH7dgNVWqhsGuB+tXtnYddSKqOQVVRG7Vc5Gq/Xkv3Zfobq4AIg1ERo1sJ5z2ervOEN0Po/m3X6UkfOnSbYm1vlr1VHbvK/ruL5fkdIgeLejqRyyxdZyfOnbU38D9IwIAFCg/Qnnqdvpwyg4zFZr2u2CsVWqiuVWNfu0sykcxGDnq5jHPVgi7Ni6xm1mRs3beuehABEQagiI1eJ3Ki9EsNOo/d8Hz13an876VbXS/D+c+o9vn6p+sqrwjofS+Y8+9U+UvV/kv1PyPnncJ7hVf8AScCABQoP0J56nb6nnWvamNdq2K8QHIqDnCNV7NOYqK3S5yu2a0c5ENmnIa92nTu27127Lv6dcAiCIIjRDhnQaPben8w5Z6Zw+CdJt3KZa6cb6XafLnprkklx31L5p6pVO4v8werPInrryj3rkeZe6D0fgfqWrgAUKD9Ceep2+4XAsRjAa4eDVcI4HA1yLpyh7TWj3IoPVFbuaJsamOubseb5f05vQBARGiI1Oa12pekfPPY/Pforn2JZrxzmWvUJKv8ANPp6jV/jXoWu1yB9Gv8ANHp3gPR+IemOcc8u03H8d9QRAAFCg/QnnqdvsZy5rGOaKg5UVVUVQVFR7N6DkEeqornADlRXsNa5io/dv7ZIAIIiCDWomRzmTuELSb/nUEvOAzZpa3KgbJESNdssNI6I+crsnkUm2YDZHfBz0DJxYAFCg/QnnqdvsfX0aiogoDlVRVVVFVVV6qqiq8cqqqqK9rgG7tiivW3SIAgg0aiIiIxEajURiNRrUa1GtRqI1rUEYIiAAAAUKD9Ceep2+6NKIoIAoqqOVXDlcrlcrlcqvHOVyuHKquUVRXKqirlb1EBEaIiCI1qNREa1Go1rURiI1GIiNa0RqCNAAAAKFB+hPPU7fUAQVABRXDlHK5XK5yuVyuVzlcrnDlcqq5RVUVVHojhBARWog0a1ERowa1Go1qNajUaiI1sw2I1tERAAAAChQfoTz1O30AAAAFcK5RXOcquVXOVyucrlcquVVVVcqq6SdGbZGImYgBAR7c7B1oiNRERGojUajWo1GtRGoiNs3m6e6wRgltqbAAAAKFB+hPPU7fQAAAAVwOVVVznCuVzlc5VcrlVyuVVFcLl665bd1fjLhiMAEDY3GmYlEREaI1EajUaiNa1qI1BrZmqXPThZeFlz3PLYte3ysdFgAFCg/QnnqdvoAAAACuB6iq9XZtlhdqZMVpdM5cbp1qqrJ5UMqqLPcysdiwpuqZgqKIBI1K2RrWoIiJusELHNRqIjERqIxBqZGusMtsxzToWFkwvQNMXYsCmYoABQoP0J56nb6AAAAAZNrrtnhYhFdmWTH4/2zdAZEbLbc2oXvEriqublwEpsl6+r3zUKzHm41UlsPGBElufT03HzuJFojTMm+L9Dx0a1BiNRGombpx8uPnazYcC18asvUIWqsluHddipLSAAUKD9Ceep2+gAAAGXYqla9uZB3HF5/MTtawrFYNGLi40bKR1yxI6UryWR1K6G+tStZk8XdqlM/EheV+g4PXiWPGhzZnK5i4tctUfN4WPIM53mXOBRqI1EajURNOPaOXX3zr6cruXb6xF4m2xw1tq2zLhAAAoUH6E89Tt9AAAALmtLucbgRdgsFKtMFutNKtCY/MesV7bm5fKup2Tn9s5p1HVjQlmIx2dph57Tmcn6JIR7oy1cf6g+hT13q9AnOm85tWqtXnJ4t2qLwozUiNRGoiNRCR59c/NnpPeRN+51bqNcMis3WuVnOt9VaAAUKD9Ceep2+gAAAFr2VK8Efh50lq5JeJCNxZ6UxNMNbqzCXzCx6vmdGrkzriJer2DVGwloldcFnTsVolMyCsHPL5QpRJwqdrWOsNXs1dsTIWqF3ro1o1o1ERJirW91YzMFEz2aJPDlaDNy2+oS+toABQoP0J56nb6AAAAW3ntrieoUnOw7vQZuAmq6s5WMuck56hbJTVmc66RKV+0c8tJzaOzrNZ6tLy3J7ZX+v8atML0TGyMPP3VKy8dukR0mQoGbHydb2Z1n0OgUaiNGoiIlgwLBQLBCogiIBNthiUSMAAChQfoTz1O30AAAAsGJrn69px1ztVy5vc68tlq8xlw2W3UK/Nw92vJNLsvdrx5qOzY7Opt7isunXPTkOZz7H6tgwWFc4LaufsKDLWKEGtQRqI0REa1Bo1BEQAAAAAAoUH6E89Tt9AAAAB4wBXEtO1XULmamqorlVVVVVwqqoqi7tQbGElmxGY6KY9daIiCZGrU1EREREagjURqCI0GoAAAAAAFCg/QnnqdvoAAAAAACqTEcxRVVzlFVV2CKqq42MVRTYxQUAQEEBERAaiIgjUREH6Vn66wRGgjQAAAAAAKFB+hPPU7fQAAAAAAB1hxmRuxoquVXCjt27GVVXdmO2xKiydTsOkAAAQEQQRERBGiIiIkpV7U+mdEpyI0EaAAAAAAAUKD9Ceep2+gAALKxIAASMc60aMJ83VmTsLIxrlVRZzMgtCqs7ym+ZOMoSS5EMKbpmNxGLLRMpEgiJJYeONE3ataIImRP6MWHloREQREAAAAAAAKFB+hPPU7fQDIyt2yDmc2DxQDJskryO916xVS9c0vUJNQNo0bajPaWKTOjBnINcl8hj4y6BZeCksTNz99VsldmorOqttxN+E0SU530jVqjc3DwbJFwVriEbmpZ+RdJrUw+CQRAAAAAAAAoUH6E89Tt9HzcDYmSeJlbafPR8dJZEfIScZm1q5RjE3GPkv3VzLsHJukwc5lcR7Piat2BI6tGLz7q+HIZnPp+Zx8WchJKY14LdOfsqcxj5+Tojp6vQl3gJrBnc/mlqoUvky8dRenY0lUllYWzQOCAAAAAAABQoP0J56nb6WBa9LWTzv1yw6+X2+Kt0nv5rdXPp9xbp4V6BhZTRzHoEtzO9rVLFJckyOx5Gqt5edEb8mBguh4FRo3dsrP5tIzXmv0XK8j60covyZNkyPOvaG1uIsmfzzpC8a6JPbed3iL3cl6zKkJRe21fO1QOTjAAAAAAAAUKD9Ceep2+lhxMbNu/HunUuzw8zG1LpULJQ1g86dF6XQ5HP35MJsy9GbDvpnUYDJyN0VU9m2Nk7/HaKnz7vDTIjI+8aYJlC6PlQ7JVzcbh9vsVqgp7dC50BdqvLcrtdr5X0wbibGw2nqXKLZm5dO2RoAAAAAAABQoP0J56nb6WPgFk6LnJC58rnQsrESnniy9Fyoid1ci2dRw82ColtvutNNaz7lG6aP0uJrO2w7OXdWjMvOzIhsRYo7i091bfCWDHfU+eWzrtLseiJbI8Fm+/1G68h6fTpqLtPOy+1/P21nIyOM2LqOw2sryAAAAAAAAUKD9Ceep2+j59YPQAAGyedBaAWfdCaCWyMeLVFJ3Jgdc9CtFWXzo6PN8/DYUpoTN2wrRQkXsjQQN0lIY2NGSMOiIIlpj4XKyojLknV9s/z22atYAAAAAAAFCg/QnnqdvoAAAAAAAACoKqgKqqCiqKqiigAoACKIAICIiCIICDUAagPlVhgAAAAAAAChQfoTz1vzQAAAAAAAAAAAFAAURQUQUAAAAAAEFEABAAQAAAAAAAAAAAAwtPoTz0oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAehGgAAAAAAAAAAAAAAAAAAAADNO54AAAAAAAAAAAAAAAAAAAACOUAAAAAAAAAAAAAAAAAAAABYubg5QAAAAAAAAAAAAAAAAAAAAAP//EABoAAAIDAQEAAAAAAAAAAAAAAAABAwQCBQb/xAAbAQACAwEBAQAAAAAAAAAAAAAAAQQCAwUGB//aAAoCAgADEQAAAPT+fAAAAAAAAAABAAAAAMQAMQDABAAAMQAAAADAAAAAAAAAAApyrcWrYdaRm9iNugVpMuMlAj1jvYjgNA8Xg2sx0wGAIBtAgAAGDQADSAaYIQMEAAAAAAAAEiik24tS1KdQ6ApM+jzs25vS6EDeYq0uDboc9OXHN49M3587s8hiBggATAAAABoAYAmIaEDQmAIAAAAAAACVRSbcWpbkdiXK5D5HXAAkzxdNpmW1umNEbpm3Y5DAQCYDQMAAAEwQMEDBAwQmgEwQAAAADj1ryU+lzopNuLUtyexqtuHy+oF6DTmZvZjQ6q4su1GrSBoYLscgEDTGAAmAJwbwbWMLEcAEwTQMEDQmR3pz+jywEAAnUncX2PN9VX6vpPlfofJxSbcWparL5nTCxHj0uQ6U5qO4aQZdqNWkJgx163KAaYJgNDMWryK0nF5aX+duogYITBNBzOxd51iOVh2877r0/gN0Fm9eRpef91yfa53scizyPR/O+jAik24tSwY0zaXLF9VxanNpTQ6XNnxy2lZMaEbqMMX0kAOO9KVWk4vayuwZM2mgEwTQCzbdOX3ud3Ov5ap1uhwuD7bt+N6PLh2839Anhdby3k/rVriutbrxTvU/JexxIpNuLUsAAAAA68hqbGHapMqS1YJcbUWzHBMK0ivrawzerJgkaW85M7cTdRAwBMBoUOvnfonZ8WlHrDLgnZ36nl63W73kPKfSeT7q95n1PyvzP0uh6t5Tc+5wfVfNbGUUm3FqWAAAAAYJ8/oc7qZuANPPSsR78BoYUZlKZnTdbcSbEUuTEMEDBDqy7UPVeb2vNfWev4P0PhsX4PspM7vC6PKqy7/P8r9I5Hur/l/T/L/H/aZuV3/nPS5W6apKopNuLUsAAAAME6cvl9nGgxAVa1TWclLsSXLNq0lqTPdAQDEBHrjSxGEFHref+lep+TWIoUOtd5cuUO3l/p2JHY8JT73oPCWYvn/bef8ApnR8h6v5f437HV7k0D0HzXt+VdZVFJtxalgAAABoV+D3c6qxZp1KOrTQaXQ57SY0Y05voOp50QArec+kdPynS4AJ+c+i8713pvknS4Qc/tSxL3N4nqtV6XnOF7e9w+v52TPkei8t9fveY9l8jodbi+wpejr9X0vynt+VlUUm3FqWAAABgnTmcrsILNAAaprMACxhaipjT4/rOL9B9F8rkwYit0eH9I6Hlur49oK83z/1Pu/Nuz5OLbyv1u1xfTfN60u5A0odqXV6vBao9Hx3261w/R/NGk4JHD+gyYey+RzUik24tSwAAANBbmdGnNGrpps1V0zrFvNE1TRfgAnHfzX1Kp3mgAEwBoEAPu/N+z5Hmd/zv1Xcb13xixH1UOB7WKV6f56KvI8Z9sjmCAGJz8z2nxW5Gik24tSwAADBMdGdQnq0W7GlZWHVnQW6HLnjt3+egE6vQ839VjmgAAAAAAHd+b9nySfB9zyPd+n+Q9Phsw/JfXOj5f0XhnWPTx32Kr2gAADUf2vw3oQ4pNuLUsAAA0DTj043b5/TxtPm7RttWgIyzG6PNnysxExoT4nt+V7kAAAAAAA7vzjseTKw7+U+ydz512fKtQb+P+1SRvQ/M7EDleq43vM7gAAGqe0+GdHnxSbcWpYAABoLJ15XB9BRmWct0LRbqus5c8aRa2oPR580Yaadaf576jFNdAB1t8Gp3FoAAHb+d9fyqfD9tyPd+j+V9bzjUG3j/tWJImlYCusxgAay9l8S6MCKTbi1LAADQNMfN6vnfSqjduOrwbqsisxq8iImzmr2PPx3xpQ9DyPexTOt4W95nWWdgsws2QyGSrTwwxJ4/t+f6reHrPjVmI0n5X6lR9MAAHT8d6P5ywBA1ZizUik24tSwAA0DTVoJHlPZZrp6aWXpJ6E1nIW4fV4nM9FxfoUcwJYXoPlfD+kSQ8Sk/Q/L91BPz/0qOX6D5bxfoVL0isHU8T6HwG6tFaPV8z9XinAEkP1fyHo8dpoBAEqik24tSwAA0Fk00/L+spzNayPNTOSsOu7O2M949bi2oidTo8v2UHT6/hLXI5nrJIusla/wGmCodzEnqeYxbm+n53q5+f3/AJ5PHddITVSfx/YV+nNB7Xi+hyGmmgEASqKTbi1LAADTGmmPn9Dz/pYZctHmjVM32R6rO3B7HEaTTzZMEDQDABrSKsdWVt2rGEuYtJ1aaaaFpNOomhMEASqKTbi1LAAwTTGmNPznpeZ19VWUl9PFQzbeHoPP7ohWTHlpoGAAJgBujTQVdwmzsxmmk4N7kNpp1Y00VZXkbzmwAJVFJtxalgAYJpjTTT5nU896NNk/Q3pHEhjCv83s8hNNPLVkwTBAAwMtE2bTTVbdFjGfFpqhNDp87L1TdXVjRVPj9mTPr8YAlUUm3FqWABgmmmNNPNvMepozBzWkVd5pJXsca/BTTzZNNNNAIAGMw0TUai0nwzaDWxjPi0KhNHfg0JslOlzdVYKPSHWTPndHpc2xGCVRSbcWpYAGgaY0001bg9/kdYJabpDcel1+RfgZZbLTyxoTQNABpJ5Ja4eXNmEWjVyJWkSUg2Tlyh1C/Bag3aryHW3FozbsPoc0JVFJtxalgAaBplkJpq3G7fB7klNJ0DFlbqczqctBbLTyxoTQmNIAAAAG0gZajVJOkLNmIAAAAAAtxOlzAlUUm3FqWABoGmNNOPWnMqS+T16+zGkmpK9fkS5TZ6rlp5Y00IGAZAAAAG0gZdiV9oddLLAAAAAAALcTpcwJVFJtxalgAYJpjg3qTa+6EK1eTzujl24lyJJnqgD3XdGk00AmgMsGxAgGarlsCbKDVOSiNKLQNJrVUDQAXIl7nhKopNuLUsADBWrSac2DYYgBA+X2a1+tyrGAgAYBtao0mgaeGJm6szbAObKTNrSr7w3ZPlZjQbVpAbp1OZpNCaaE0IAlUUm3FqWAB1JdGdFqDAAAQ3Bvl2MGhDAAAGOslUIBMGmMaytG6NFdDri6tPhqrUd472I8mbTGirQmCAJVFJtxalgVuZ060tAmwAAAQ02AIAAAAG0aUlEgAAaaaY0JoWqhuqe6CY06g6sdQ1RNrVXUAlUUm3FqWDm9KpOABDAEm0MEMAAABDAAbEaUuSABpgmmCsSgDNZtK8W3Jrc2WWbZTWr4zlvDWS+MTXFJ85uKASqKTbi1LZvxO4mwQAMAAAAGJiAAAAYmA2bzkyAAExhVlmWENZnkktLanlYvlROdiWGbSYuXVVlVsbF5uGIJVFJtxalqc3ndMQDAAAEMAEMAGJpNgJtAA2FiKAAwQmC3cNPNZL4ju+sS2tCpV3MVaTAlZxd3V0kiAEqik24tS3L6taWIBgIAGAAADVRtiAbSG0AAx2YrqAgYDTW5CrJePOXSKLvfUFaG7jG+sk3ssNSHzcz9w1vLzwCVRSbcWpfi9rGgIAbAAAQwGIQwYgAAGAAMc8aTMAaS0AKaa3BSUL4xsaxxY9bFsvTd48ZNM5q+SV5W8pOKASqKTbi0teP12xpADATAABGmhAwABgCYMAE5cZsABgCaZuYlq+aSXxDUhxFVzNZPZ5lM3M9SlDJbivWbjgEqik24tPSDcAAAGCBpoGmNNMYJpjQmA0AMBbzAGCYJgNCaaaY6ia0hNMKsKsYkAAEqik24tSwwAAAExpjTQmmNNNMaE00xgni+qQSZcNVBgV5dmGAmmNNCY6sE6tMFHOKywnXGkmIAABKopNuLUsAAAANA0xpjrSt5Vp1uBm0W0uSAj13mmPndmPXeLfQ5AgCPXndvqcDVRNBHrPgDq0Dq0wUEvHR3yoJmLNyxM6XudqgBKopNuLUsAAABHqFDpwS+jxw5vcrz7nGgnX+TS6EMvqcHdKs6rMv8mKTZhc/r2+dx/VdPzmlvGXLNqHV1XedmAnulHrVOt3vHtOoNOoRTWjbGVfVSM0dt0T6fDEASqKTbi1LAAAA+R3b3M4Pr1p1PN8n1PQ4NuBBvQ7tvmUupnR1ljWObX6O8N1xrPAzpV6ckVXilXOVR7VnlVevPzp4mNgj2uQOhx2hNNAnX6u7uBPDqTSzyr9GaJFv0+KIAlUUm3FqWAAAGef8AYx73+He5VHq83vd7x0Ung+06/lkaU8Op1Nxc6WInO9BvGDW5zeZ6S/wqPctcncat0dItjXq+ZrdHF6HoOt5aaJahiaaYKPXF9k0UqwQRbS4501mABKopNuLUsAAAAMBDTryJ8QVhDQCsgYJpgPLaGEemqi1UGgaT1ViTTQMy91KtCBggAAAACVRSbcWpYAAM21UABWFQ7FmAG8waGEEnF7ERODoZrYhhXnSxNVCPSTPLZqoNZtqjENNMy63RCaFPGEDBAAAAAASqKTbi1LZurV5RbG1nnbzVq03G9jnwzs6TQYpiBy4yw4pyzFJhXm70k5+bxz5OfDLWmXPCjli3lrJWWmXqg4pEtLPMikwy1e1zSrpLkIAAAAAAJVFJtxalqfTkxh6eM90WuaArzWiwmrCbrrRDHgtnnjbZE9ZSzIufqTjKPV6Waw0zXV5Kw67os91xJMJJSiZvvF2MYulFSXG1CliAAAAAAAEqik24tS0PRzo4k0eCSN1U/UBi1zrNzoeo4pR6V5E8TO2qhFJkhjgkTY5tqUQRiUtY6z1mPPRr5zZ6xbTxrvDN5o+ei+dB0ZoM8MAAAAAAAlUUm5EgswAQwAQwEMAEwAEDBANggYhgkDYgGIAYIABoABkWus91AAAAAAANKvK3UAAAAAAAAAAAAAABAAAAAAJtAAAAAMAAAAAAAAAAAAAAAg1jsAAAAAAAAAAAAAADGAAAABixbVGgAAAAyAAAAAAAAAAAAAAAz//EAD8QAAAGAQIEBAUDAwMEAgICAwMEAgEFAAYREhMQFCEgNAcVMTVAIjAyQSMWNjNRJBdQJUJgQ2FxRkQmcFNS/9oACAEBAAEIAeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJeKJcUd1QRd3rd/hte7Xu17te7Xu17te7Xu17te7Xu17te7Xu17te7Xu17te7Xu17te7Xu17te7Xu17te7Xu17te7Xu17te7Xu17te7Xu17te7Xu17te7Xu17te7VXaq7VXaq7VXaq7VXaq7VXaq7VXaq7VXaq7VXa92qu1V2qu1V2qu17tVdqrtVdqrtVdqrtVdqrtVdqrtVdqrtVdqrtVdr3a92vdr3a92vdr3a92vdr3a92vdr3a92vdr3a92vdr3a92vdr3a92vdr3a92vdr3a92vdr3a92vdr3a92vdr3a92vdr3a92vdr3a92vdr34fG4l8hL8ofzrXRro10a6NdGujXRrpdGujXRro10a6NdLo10a6NdGujXRro10a6NdGujXRro10a6NdGujXRro10a6NdLpdLo10a6NdLpdLpdGul0ujXRro10a6NdGujXRro10a6NdGujXRro10a6NdGujXRro10a6NdGujXRro10a6NdGujXS6XRrpdLo10ujXRrpdLpdLo10a6NdGujXRro10a6NdGujXRro10a6NdGujXRro10a6NdGujXRro10a6NdGujXRro10a6NdGujXRrMecfliXyEvyh/ON4GbV9GKQ4gjMoYyPBRr7TbZDjCn20uFFSSdSJ2MFLNubwkiAHS9Qb2QtPx4KSvUFfC3etHky4CVnWRDWVIpK7VhfjjiAYoLjD6Q1HIlhCrjE//AFmY86/LEvkJflD+cbwEC4REqo6dy3NzkkMIBHu7u+r0AYUuKkQDDM7WsVBKblyLB/zgeDKP7EOcoP8Ascl4kfrTfVv+3i1K+aBs95IL8n/60b5enn9kBf8ArUx51+WJfIS/KH843OKA6g4ln9WJt3FDiC4QaxhEhhY5gBMoXSYnHi8bEbhXMMCDALCHoW+m0x7vCiETRaJUKIJv9kDrQiN2r+2kV6oQZjQTcWsgY/48gqZLBx8GxUsGhQi2QgCF7amPbyCn2JeE+/7fZA6aiXBD4gUxDlJwiECfR6fwSFpUmZDWKwAIaYRGn3KhEafaFDIS2o7R5ET7QzcSIEneDSZMU0r7ERAKG1G6OOfsy4cNTagmiohZegn/AOsmuXp3/ZAX/rUx51+WJfIS/KH843PH0skMYV580o7NHTCvSmOY3PLMiTRlxTLhNYEw6t5deaRzRmSHAEemZty2UgospqmMNun3Q/ZfKjQ0IQji4S1hiMoOS6or6crcb3Q/YdahcLJqW4heCiRDxzIsqkZkde5ndn1bEs0NRojF5AeUPOOI6fT4UQfDwljeqo4xeBLqLlpM+5kLVf6y99UjpoDJkoAwzJVRZk4YPzmQyMyMpRpC1IUykYBmBhB8KPlJEhuPB8PM8iDxqPQAUkJQ7ICOs5YyYPxoqVk8VmQ8nhVKEWl0Y6cS99O/7IC/9amPOvyxL5CX5Q/nG5xv2wxhVFfURb30cS3SSK6afU0M/KFf/uId9W0M2SBqbDlOnJ452l/lZvlgmMNkBgVZlfp7EOOAKUzptMSkeWJIYTFIxL+r8ipRkrHpiCAknJFyYJGAg4QqGCv1BxIqHHrlYm+m/wDZgN9XP7fLUr5kGr/WXvqz/dKbGE1yEgXKBR+PQkIVQGv1OxwpHhgyMeAtwxw1sA7CAAiKzXDpWYlxTpfC8GEQeFFnxoKKGCcMTK45EVkBwmD6OCu0nIBWSbSIkOXp3/ZAX/qYBAwN+kKEV/8AKiKKB/rdccX+PusYzsmzBMJyyhkWY86/LEvkJflD+cbnE/yRY4bGE7DAiX9HDDf9xL0+hwzgzPYJG4+yr6pmGGylSE4QE4uUx6Wl/lRvl6XBsFiaxWSMIhStmVO6sGOO9w7+14y+pq3Vlphn9LA2VlKHedfU+7VksPjBoMS+m/8AZgN9XP7fLUr5kGr/AFl76s/3Sm+m6N+YkdZ9/wDdoa+qTa4kz1P6moqFriyiQpCTKQRFhJKT9Tu7pjJDNpw7qzjCCCiOsb0d+dnbKfKJDl6d/wBkg/WJQpb6JQRHVRCCwg3WIE7DM7g/XAhLGEZAfsom2jBKBEdC/wA4QQgytoZWFU/cw6SJBG5Z7LiYOrFzmVnxtWCHkDY/+V3d/jh5Dq5RhFz4+0JIKbMedfliXyEvyh/ONzx4XQUQN84jlRuSmwrhkx7LPAmVyBRJ8NBooxEy6ttUsCAixjZyUOLkJEwbF9Jo9x5oU6qSWy4o7pfTnthKeWUf2Ic5Yd/a8ZfVMBwsoUt/Ts4gnlRVxJomKIYSIFPGEwuJGli303/swG+rn9vlqV8yDV/rL31Z/ulN9Mf7vK2e8619UP7PqP1tSHkS9zaVElcgNLfBcWbIRRhDEdiUEUVoH6gshOXHkBejvzk9ZT5RIcvTv+yQfqgSwg36ejALBKFNFhi6y6RC4p1KECOgI2o1xmNGZpBUJgi6XWpmcX63HktxhXqpVSMjYirIAe4YrflBBEGVoGUhmZtxk5IkIoLRcllxgXVJMwYGML3j+DFyLEIpLrOj9QZWJymPOvyxL5CX5Q/nG5lRnAMIEbPoH3+KDNElpdCnSvHMtkYJPCBX6njcP7MgyA/OjbzpEoOeNBlisHHBYzj6AGQ7vjhp3vp5/ZAfLKP7EOcsaF4OHxwl9T4d5KKCkSrO7Pq0T6kHCpRAJzI8iP5KZQkW+m/9lhX1c/t8tSvmQav9Ze+rP90pvpj/AHeWs751r6of2fUfqakPIl7PlVkpo8AJ6eZODBCjgHZTPogmWU8edMinTYxkx6PrZM6bTZVtIg/y9Ov7JB+oAJii0AiEH3Udn1FzigUDygnBmSKy6hCZlG4zIfdq5uWUt9gUTHOB/OY+lji3Uj6K6Ms7bKdA6cwpDeLHv1jXKRnK5MGOkZKT8bqh20d2fx6P+3IMNQimSgpDa6KMnZEjEg6LlcqMmdUFFqUtTqX4cbIOflA0PND8EowSeUx51+WJfIS/KH843gjD7lVbV5Fh8dkCXMlT+CTpVb7WxabdWjRfp9Mm1p6iFgozGC+4M8bWbF3KJoceBGCD/wCP8guKRxiIxVip2yxMWRxEYqV/4/yCxxMYri5UmMSLOCW4IuTenaTAyjEMH6eTqhNqojECuPxRscW+nX24UC7+oEQbm4cAGPAwGeQOGpxVMkUuz5/isrMzrGSGEYjLRORAGzs47Od7ZtGGZnG2LEE4BPs7VQ3REizCZpiIc+ljpAbEJ0ETaqF9P5U6MnrsrwIRXRtA4di07CzwBoaSCUPHmQg/+P8AILiUeYicWQVO/Saa/AAiIJ3UEVBB+Ag6EaMoU8hKnVZET/vAZtJ0ykQxxhhJBmfaCUijp12UL7aXJGgHqHZ0JdH0sE32CvUHlBZiKCLIEeqWhSTMaMCnc3hx99DC2uegqTIBC3Bz/HJKLLlgOCcV442NUO7LGSosgViyZsBIJlnDAD4oyEUVZSJLbxJjKxh3cMgIIsVbrE5lI02b/wABTEDgujjlsPJB/wCUPHo1FKkixR36cyRBNL3CSJXpR9nKY86/LEvkJflD+cbwgjCAq1CDmR0/r97XRZcyv9K1qEVuXSpwYrrwveDNMyA5hG1dKnhyydofvBmgyAw5sHi+rApwmaIGCpbL50v+mJzSHNkg1jZjm8c0UYKRlhSyovDSpcUCSMAo2t7uZoxoYYRK1pljLNXljLtVrUIt1LLyA4CNifdjFMGRTL6iljQpf/GmXE0+4WUHW2iQ5IwlOl90MVJ8wwjqvug9HOjDJ2q+iZLqfRunSEnebVkEOV7AjZf/AP6DWTyov2lVy00jVbmpuUW+oipKVMCMkOPgJEy7LPkIsqSb+KzEaiTLpCWXBSAAgJH0sMLsMOh83LqAMFj4UvlXASGgnjUqqVKLUKfDYM2Ilo+NQsJhBxooARv4zMcOB35ExVFx0CXJCLSMUtkwB14+UDWqXBYwT3p8DNr2aNi9GYQzkORBEGcAriRoQbIt4+Rt9wT0BfCGQuzpRMnELSl2dndnoYaxVbQ43FDZjRRmPxwgU0dxRyxVH8hvK48HVgzGZCv/AIBsokhPgJMSC/1YWEZEBWaNTgrCHHZrMedfliXyEvyh/ON9Cz6Pqx0oWySFWUMzGGy8aIqrJmUPostFnzKtoGG4IMGbDOzM0cYZbBB/g3NWdn+H5ZOTKxobKNxeRx59WxOn4EIUt9EsKFv2B9OfGb7vayAatyzgoJcFnXEOAeDUKX4oICftyxbpNrMF4SPRInnQZKEi5RO0v9MWLrML0QNGCho3J5Au6RkKbL0pXAjuqLLkyEEo6dwss4EVxFOjrJJ2uVn+hilMiPnz5N224/K+6llCOATDeTG16guo05So2J/ibLI7opJSkYmcY7EIZR4LgGhEcww1CrZIZCPQVTxBsiyb9RePd3U+r4+NwJgquzwe4olbWBH4hdQKp2CMvMLSUjMP+Cj4JYjGBfZIZWTL6pLnsnkDOrIFFEFVuF5kS6jZsIANeyNjGSG7up9Xsx51+WJfIS/KH8430QQiwl7gwZoRPYX3gu/6lTISW/iNSQ47bfCpSUtq5iULg9nOzzu+gC5cw9XKGXqpIxpWlzYavtCyM6n9QGUip7CE8jAG/WXOgGG/j/DkMOHLknDUOAKUMLBHiMjPktoaYjISchojwOtKVJS6tENqILKxJVLuYN5bEq1YZfqEgNPDIG84lhP8RibljTf7lQydWdoPIAAQwwQjkow+jKWEek0qBDhoIKPUwj/TAhKGEZKBhS8URUsSDydB0yoEzIkd7OKDYsFhjP3ZoYUsuGRAjcbHMcISUUlkg8EAkSSVd1XNSJ0wOgQJkKdbIsGSYhHBA0EFIKhFWLE6nMjYiZMw4B4u9ycix+JE24EYdJ0YB58PQwhfJm1dmoAIEcVcQTIciEPOoAtyQp0LZTEhEyUOhVWl0KdKoVAzm2WEOMGAh1jS2XJTqHHnTxk6vcZ8WCR/6zq50zxB+EnlMedfliXyEvyh/ON9SaOgl2+87NqE7AiSAq0/cKK796llrrgJf9TghtreGG1dAT1YIdcFqwWiftDFHAVuTDZMzJYM4VNgmU6g/gy2AaSAccul3YPhNkIfBPhtcRHnBQdwYDCrT96QFCJetFRxoXeXM4wSFBFcxIYkydqSI+LJACd7B47uWGOaOadUKM4YTqVuXBxQipcAA4UKRYwTuUKRpUr/AIvp0IdamSkNAZAqpYmQzC5Qz9rPo+rYtkPE2FD0iRYRnFBjTDFxn3rGK/5XNSjv2AhVOthnUXkB2yoYoIYMBgulheASEEYVpAyxQkKO5mfkRxFPcFJLQCMbFmBGEOq0iReMT2qji/Q5k4TZC38YKuSX0Uz3Iw+PAmPDgkho4hNc6W4YzDJx/wAou5MbMDSg4YvNAaxFbQy0BJGO6QcPOK/yB4X/AP8AbYWB++0KLjWQhSnUp1K5THnX5Yl8hL8ofzjfTu+1nd5aU+KAVjOt9V7ne7dbozXfWU2vf7XT2d2/d2DqlIq1f6b3eq3fs63+FKSAxZbOHj2QoObQR/wZVFDAqVJRa1LHF3LgCiikUVAqTXxSUMId3S50/J7Es4Ro+23eszLvTMgsR9jFY+UOoSyS2HlARwhhMk9vjo1aHDNSk3KcQjjcGFClloR9EzO76M5QZk6+GHS2oirnJo1xUgc0M7rZkwKDQUYGx4y7OYEdPKCf7hWs4L0WXFh3lAuMT1THAKGMpucmuFFsC0JDEg44BYhs8EAFtBU7qd3eDG2GFIceKQLMAn7kC20CD5pbqIjR1ttWpvBicCIwqDpmfMI4bApx1/4RmuVI2zpnlCRgciLtWSxiPAZnU/REGZqLNAp7Brmhn/Q8saevJGqMOKM/8vOY86/LEvkJflD+cb6b4fGdkmSG4QShNX0dnepuvat3u1L/AB2trXXp8Fr1q64e68DvpXCdqHon4uzKqgqWdZcdK0w8uCZLIYRu/j01o5GHjJHqEjTxBm0NBTbqK8SnphxG7CSC9LvMmn2hEsaOmVM5qLhSccn+HlLY4XkpME4KWIlSqxFlvombV9GJlmBbiCEZcudOjFwJEPYZfTmWGUAJuSOEXlCagxJ2GGixu9xGD2sk6bkzen8IXOF80q5+nQ4WVcayAEQqgucOzpAkHrZiSElDnFEQ3Dh2Z6wa1Nqnul60maZGlWtQinUvlCq3x2llQ+FJGUc0/qaoWpohloU7qd3fHH7jJuaJ2zi35M+j9ojKDRTaGZJnyMsD9h2HUjVRZTOl9FeKY86/LEvkJflD+cb6adPcAJw0iiOJ3dtWetpXZ3qW05fB+6lVT3v+y1f6vr+zArVekX+6SyG/V/Ghuyx2b4KMUM0tCmdMFk6wnZBkobBNBssHwGjB1/tInw5hxtpwaFNDjvwS2NSHapxkyJp1AGLk0f5QIkiB/jSlKW0T+fpxdNa7eNm1fRihZgU7xMpyFxXUUJYqZ6aZBd5RG4JK/CCKoFe5H8EiWUGKSxRIMq4okgaYBHDDfwQif51queCMuRADsgVUTNLBXYos5uRABSYBcQq4SUxYrDJZR48VjEB8dAhE8nVElHJCC4oHPHlfxjJuVh8OcH8BD+SCD5Y6/wDuRGueJ0lAleAIVYK2WFCZW6XYKSHLF5EFhAzRcQsJtF8Mx51+WJfIS/KH8430sibSUAdbnjSjArqUzu9369qlFftXW7/Blu3w4na7ne69qz9rprXXp2qhmT8VGm29lDu9d6rmjWxUgMVFQpow6g6Ay0fUAl1i3aAURvXHzJc+cEALSCGSNq3hZtX0YqXYFO8TKchcV1FCVDW4YiVpAEY5FpEbwhCKCUykPJCbdGUp1KdSvBHh9OU3KmzfWyow1m4NMmUDWG2NSbi7Lj0EHFp4i8kk3jCPEDJZiErRjeVyaJE6ngEmFUZDQXNfxRjsvnAK0MrTc7C2yga/Bjr74MtyhBWDPNuzaNFMghmQfDCTRiME0SXHKzBJlIPFFlBdqvBMedfliXyEvyh/ON9I/ZtbPG+pM7Ur7KqlN8GT273fo2qlr1e6/wCl3P8AsytK4329uM7XqO9WOz116/F9H+GldL82apZmoL6NcbkVFTLNQ1MtDKb8QaHWpkt/CWQnecLtpvD/AAhp3CJaz0j7WQcZMlJmpER1GPT8PuaEp99R38Uczcfvm5o0AVQgHnhg3GhQ00ZOwVTeFCHWtkpSgEoC3EPlGUniA844txhdz5lJsUJdOFGEhT5tAQI4rFS25/dg9tjzSjQgjvnogqjgSHLgqHMBhIN4iVFBTwILGVEJBjA84PrtBTzh17TyL6ghfxFRfBiSt0CXozaCra/CxsmkRLBGMgxoM27jkzJYUsM4Q5zHDYJdhwXbR9H5RMkNGmWFCKGC8xH70my6iwzhr5zHnX5Yl8hL8ofzjfSSI7AFVu4q3dbvRH7vQ373d+7d371LafF1s11dVZtapLVSXb4LT/qtH+m3WpB1bukJF0S1U7Xt+yU/68kKftS4u1TPcZkUmiqQ/wAZQLhhuteVS7njvDBxSU9wI8MUyFwxH0/AVTuHTc+F0JghcsB06EemvML18KFOhTOkYMKRJKDFlCS486sATl6fDaoNBWQToZfwxwGxHFXl8u5s10wOHyznCzlx5EDgjatQ0OItKEnBwYogoRZckdyI+owsgRKxJbQM8acyvtSZlywu5uIUOo2rAh48uOw4Z+RdAiUl1So7p7LUpanUvmUVsNBKubhcSFUrwYSrdCIam22mhm5kJRYGiBRgCMqFotnBJF0IVLQRSTDdaJOLMxwm0xyxuTVHn06zIDDk+KnnMedfliXyEvyh/ON9Jk5n72DZn+7uOrcrRk/p0Z9EprPq1UzvUIbWstm7Xu79tP8AXVm7V2dT3ZrVA6d24m1tKsV3ru/JtGql97uqU/6upm+Ab3GpFyh5OoS2EDSpP4CYO9er5jLdIX6UGwR54+RCFphmGAZSdHul0e6PdLo92vUArV8AkJLBupeSyXuUipSLhcikqecAU0BxPuQ6FN8dHuj3S6PdHpQRwhbmcaxoh1KOWBr2ywibKN/Ih/ASA4onfLZXoCnBB11exRxRE8EOgdkmyTLRSKmQbQ6pSNCkuEkcQUEiCyEGTCx16r8ASRRlMhCYhe37jZUQsr7/AAM+js9nUdRAD+DAlaxa2sgl+tGu17te7VVO9L6pW4i/1kjY5V/tZy0oWdAmRY8IQdxi3KDG6yDBd1p2rdn5THnX5Yl8hL8ofzjfRiq2BqVZQz1BtT1WiU61vjq6RGZ7u173czfBT9ta6v8ARLPr3Z9Pgp3rO97ofV+Il/g69P0rE/1dV+N07VTV6mqbRu7d6ihrdn1bDj7mSfDV40JdamSx4yHGkFirOmhDhoQcbljuQlg40MI7/UkZf6kjL/UkZf6kjL/UkZf6kjL/AFJGUxlpANn4c1kJmS1DbnDZUIXQwR0PJ41SdX/qSMv9SRl/qSMv9SRl/qSMv9SRlEyGLEQpKjDIYwIwVwp9J0Oyn/x80pdamSkYQONIKEEkjgh84IOLywk91EbwFnQ+EYW3JJsdKdrKU6n1V4GZ1KZmCSFHE1CCmcuMKOtwD7ceOUrxAtx4na622qdn5YfKlSBUZBr+o4y/1HF3+o4u/wBRxl/qOMv9Rxl/qOLv9RxlGyCLFCUhRlKEmBGCuBDb40UJ5NHDPCtzmPOvyxL5CX5Q/nG+jmVOmPFdliM+tEW7vpVK7VGjVl69q2rvdnb7kob9ndNeul3+G1mar7tdjtVbmqm71La3hvrX+1u2x3qCYik6soPhP9y31eo/0rUP9Vwk108kwa28ZFDbXXcyklmT3TJ+rwv58FZP/wCPnGBt9wj5tJKFNdGnnhhrgS6UPLh6sgRvHDg7hXFVnUl96SIQCd4yEsb/AIoxTeKGVuIaWXC4MoaR+fAhtsgMDchD0NIXzmPOvyxL5CX5Q/nG+jnflg1Zb966u91rK71Ol3V1Xc9D/wDtl1l11avXZ6+rfFav2bR3epD2p+7R1aVBfV2oJDc+tFJMkJ3SaD0Z67aVPxv+lCbV7HL4R0FbFROKAhfjKjbH2qyeCTIBcYBaVIW6F/VYX8+Csn/4cyRjhK0VkUKHJgbwhglgiqDF5FhnAMBipEdjUfvT4wtpKOdazphRo2KOvHgePMlUWbVoWSnxY+rUMVFzALhzgv58SE4c8XuRJ1CCVzmPOvyxL5CX5Q/nG+jnAFjxwqAxmcN3S716zd6126tU6N3dld+6Vt++7X4d/wB9e3Z0O/xcLveH3v2IoO5b9gAt3xJR/wBu5fTpS3Y4h+EpLHkbPtq09u6W0S9Q2rUPu+lLJdRgLSNS6SQTK8ZYbT7F5XBdWhzRV20d2f6nC/nwVkv/AA8BMzs+xeUQiT4Ljl1pdCnSrliY/UQYLOKnaIpPiJh8QyhNzc3wIvgpuGae/A6zuv8AF4oFehpabnoW0+CJ+eGXslSqrPNqRS/OY86/LEvkJflD+cb6PTVu+VkUFjLulmu3tpVfHShhqWrRg4/7W3dKylaMFHutdHKAhM7qShtdWdO6hF1K00SQfTVYpVk1BMRWmghNKFUmSUpTMxaNQhm1SFo3Z0UwG2lkQf5NaMireg/GobvrcVIsaPo3pbRtPwlhd32KzOI6cXrAPqcM+fBWS/8ADwkB/wD4l5rEbFdcBy9PhtS5kGyCdppXihkairXc7McSRDBawZnpZUuK8oFxyjKR4Ydldal29QA/9uWE/OSfacAezDbo1XOY86/LEvkJflD+cb6TLifHJMKzJ71m+6gkVDu20pFsGG7qHQptEoDIb0fcbLip1ZAxUV1aUuUU9KRXbcLw0BtoGBHCGhNy2jgQ7IrSF9iUlXShtY4iwSGUrh10aVTUdNkANyVU2nhp0qu9AbXSg99dcEDd1rX+Juz6saAQeJLCEOF1lTQgAn1GF/PgrI/+Hhbs+rOlB4ipAkiVUSOigLuAL0kR0WVb+ZL+KJTtLOq5CNx5k0rniU0kyAxUwejXd3WXWhSH0XUBrEfRBWKWp2cc6dJxAGq5yZGlBfu/MA+gwb2S7xSucx51+WJfIS/KH8430hkJhwFhvIFVFTYgSiQe8dmseVSgNqpGrVgfuqAe1MgaiaViLKf7ikekJ6xRv3SWQ3wYPa1MbldkBE2S+5QRf+bc+nJ2q00VvjRQt3xk4ziJ1QOAoFe1YPZFb7ltpihbpogJn/EjQEF3XPnEHpQUYP6jC/nwVkf/AA8D8igfAAdSsmOoPSgggVwX5yqy3+RHij/ItTz6nTD80KUhTKRE5asJkhnwZeMNpauJHM2rmJ2MKJ7SWXiLZ0kjA4pkVxB/zh/5E073iFc5jzr8sS+Ql+UP5xvpFLZLd8tDDFZhUwwWplqCn7WsiY6cPVkS7d9B5tTJ0SJMCOvdfdx3+BafGDU28jNpG0ZQI6FaaMzO1WhrsZqKMEC33mJoAN+zZAFr3TPF3rSwCnqjQC27apdtW4eqdbPEw1AOtkatcXj/AHCUQyg0MGhKU/hAC0+5WYzbKZyJX8g4AgDpYX8mF/PgrIf+HhJlvgIvMJtkIUSLcsAD1PmBLKvqOzeKP8i1PttPGG+pR+pqb+Tq5zHnX5Yl8hL8ofzjfSCqd1a2VLpMFFPYxGw2zVDfa1kAVjdquHd27ew6qatBl2b7vbSKOzmIosr/AANHjgK+0iKKhm3ERnWG2qlU0Y2t2lBjIwrshJI2K/b2c2rvfajNTHGq5I43di4houI2pNfECZ3mk/7ZdQE4itE4wAuMbe5cVhg2U3jZtX7BBMnuvJ8iYJlFSLu7u7vySCIptU8AW8AW8AW8AW8AW8AW8AWgEDQ6toUFirpUkaRmYgCSK8NR+DPEluy+ANeALeALeALeALeALeALeALeALeALeALcOCETOBuo/8A+HNm1fRixbb94mTZEkqly5JanWp1K5YEX2EBRnOq3mF+KJVqXUm5KBwJoy35QwRRW1DcsOn48AW8AW8AW8AW8AW8AW8AW8AW8AW8AWxsWaOGUIRKOwMY6ecx51+WJfIS/KH8430avg9Ro6HoiXdlppcHZIOzg97wtzVQOyyBvp09iJI3Jq3CH49fuDghdKOVGD3OAIEzMIyfv7km0TVfCmUavUgtrrREC7FcNhZAYRSgosc+MZUCppBQA/DOIUEMjVIpRlUIFwrKp3Fl3HyzCmHdSUMp9LGfbqnxhgqVRRASYLiCz2TLM7gSXNLOpTMmKKpKxwIatwVZKHaq4afjqFdQqyUP3rpQ3e7w2+Chnf4IW6awqX/VuCu4K7gruCu8K7walkKbVnShm1vEBvEAvEAvGBbuxgXiq5BF1iV+ATCcQSfyhQ24CPd9X1fkzO7szRBfoIgIN1Pq7v4ooTaYdL56U2jAmm/JhpTgQ6Vq9wJ69/cCV9wJX3AlfcSV9xJX3ElfcSN9xI33EjfcSVXKlA2+w+dWbX93KY86/LEvkJflD+cb6T9AjprN8Xo6W67sBUNVJ1pwkwvdyijBR9GlC6Tq2FQVJuGKlYxoUQapS+tJN9rVTdqZatu3toEaZCNqjhFTCqUWhy4RJ1DDSQyTXZMYTWh9ayGZqO1Pt/AJcVA1CEW4TbRF0j/l5hAOttb0yb06KMMWKp3CyWWlwWdJSRkjMgJvM+DEiPWSiVKGfRLJoQevd57IA4xaA0R50CRLMKCpLpehI17vlM70COAWxufRIIYEcQPTu3LTxAh7375FMhxZfaHjWQsdZgDg4P8A5IoQDid70iaxVH7iLLFk7hJPKyoDOkrJShqRXqY8GKkuslg9ZFe0JkN4kKdC2U0oVRKRaw6MGoEVQYn4o0so4eBAQbUklG7EfnmPOvyxL5CX5Q/nG+kMNoKl6p9oLvdjKE3UCo5KTrVB61wqoOrReH3pZtKv4UdOr1KdHrfc1YNnaqLodqxdDP2SnRuz0X96cRxAlJaFBcqDscVO0ZnaPbVbvzNOIxFfTDTkqkRSRFzUittFCiiCvqL4WZ3UzJxiNaOjk72bet3uRzKIsttQMKscVQgsRJjRhlhAo08BIlUig5JMojC+wMURYwihBA1qDWyw8ZyBJ5LAGhEfu3iDRvezcmFFE97nDQpwwsYdKnS7OnGMiYxtKnBwdW3oVu6R+CZm5YMZSBVzUittHFGEGfUXxYfHdFHcUQ0JxBnf8EWY2K4S8yheI3XFvxYXFdOC5weYM8YfYn88x51+WJfIS/KH8430htuzPVJ1QpNQGpDvuD/ahvU3S6V2rtVJrpoDUT4VbXb3qGqbpdLpVvRKp++tUInclmFUz7LHo2havyLi7ftVO48BIs4ocjHmI8XYZ8WGw/UCscHEV22sbWsEotYB8wMaNCCGeWIsdVJf7OfBNgyQnXcsfjRpE6lg3+wLTxg/4+2VhnEyalHOUUSGPnEAgAp6cohCwBdvZU7BASiN6ZKOMxwuwz4sWinkTrLWcE4QWxP4SJphk8MXJsbUlSzRF+34MXx9RhaTRyUOMXC4QT/QTHnX5Yl8hL8ofzjfSCtqG9CVuR3MtqnVg6ipes/gVf3oLURtaI2laoas1bkqroj1XxoAe1+I7NvEahp2oS3gDFdFFDAOB7BZfEWfUSPNlBygmwxzgIYWTHZ3BCQVLpCC/ehr/Z8nx9jiXMFFoUGt0rjyYp40kEGJjwowokIOVjgJMs4YstGjxphwx4wiLIGkggxhEGNKJBCU+r+NCnS9PkwJEq4Q81FDRZjasqXFNDpBBg4sKKJsmir3vyCFUHRUAHAnQLL4iz6iR5smOTXtM84qOGkjDBgkSoEWSYIMVbiLdT/hZ3Z9WJn2U2weYxwtIM4gR+CPk3fc7adn5kow2cVoBCYsEX0FPHpBACeGCtTrU6lfQTHnX5Yl8hL8ofzjfS6bTGlG/RQ3qal6l6z1rpRaj40FNdHajor9noPesm/Dkp6uiVHcRtVfcjRo4LcJvfxIGdv1GAC5sPYNIYeCt3UTViciytGjcP0Uyj4QYRUJgwnfV+aFfs+SY+k+3HK49EBxZXup9XqX0skQAkizhDQsSDFF3ShT6/hSp0v2OFQD5ZQQ8FBAxW9VGE3Po3gDMKbsoYAA2FoNIYeXE1UUExORSrRJDDhHUznSxctGlmDBHFcVXf8AE/IubFA/SFIgr7CDE4842oi8Yi1PWxWLb4gQ8YV7pFPFgG0QakRRmdKX+imPOvyxL5CX5Q/nG+lHD10UlQjOl2dD/dUPWes9TU3SjVakpbWlJENYmyhjIUmyZoIFu4a0CpZSS/xqW1ar7V31qnq6I9CbURq2qXpBG0Hv+BIimvFriO/iZWldWvNn0+Du7/jZTp+ChFK7eIANLI3q/q+PFngIwoYWoNLOljn+qza3+CndT6v+B/wcRbfDirru7/H6SY86/LEvkJflD+cb6YYBIjPUdlu1Q9TU1NTX+FE7042lALhJXxEJFUlPYbYN3GB/X9oDaNUPRW1umlVV1b0ql1C9ixR3fcIltP8ApATMIW2qSAIWyTgISn+FkiMZIKE4LGC2jbg+T/8ARpjzr8sS+Ql+UP5xvpzCNhl6ms9Q9RWeqVVKozb3ogOz4If+PRlA7u9DRpQ17WaoXrXftVVVXVWED11U/wBfo/4WTuVowSOGnS5yExDNjS6Zksly7VBCVjj8McYM76dTYkxB7TI6doqmr+B/AAUEGbWmSywP1fRpCWv9Cmdn7/gmPOvyxL5CX5Q/nG+nkUdmXUvU1D96h7uqlVSn1qlJT+ploV8eGjd2UpDNpeKln7au9Cd2buyqp6p6uv8A6WOC4ZdubfWIR/q0kUeS6BAzfd+Av/la+pctIQ/QjEBjIo5lxxwM0mS4SQwJqcPTLhvIejoLtHHxqafUdXgfnpq/YqS00UNkuYFIkcMoWPfeSd/o44mo0JZKVjoMMFjh4mEeBYUEUNQS3QJ45jzr8sS+Ql+UP5xvpziN5dWgSql6ipfk76U4Y4bVQ4wv6VDGQ27OdOVJgytNZzHxcqaXuZKg17qz13qnqqSC45lmdm0Zmat9Yhv3ub5v0CxCEV6Zm1Pl24cb9n/AG+giXvqqUcfGuInn6cE+jxIq6hH1W783r8wAgywTii5jnrr4hOFBW/VBrUM+sbryevyf8D+EsFxjCA7NSZTHYlxxZ2WMzMgs0awbMBYkRBM7KgBjk3FbxzHnX5Yl8hL8ofzjfUGg3AHqVVCqlV1q6Mjd8Uo2/BLM7d2Zta6E6VfahB7la1HZN1qnqnq1drDAbQnEfk31gfwvqADwMtPtYs6JHSABsHH5YKbjAzgL/F/wbgxw3DGfGYN31v8AS8Hf6XhKpwy4DBBP4v3uYp4mJyLck9lNUffDhvyeoDUIraho0Z27jlhQf1+N/CAI4IyBGNFyU7HrAMZbixqBMat6eYhwdknKTJ5O1RcPxzHnX5Yl8hL8ofzjfUGAEjI0Vq6Ful0LqV1lXXVqpNdF2XR7td7wv9Up0rV1aVa6pdUqxvkw+bfWIvqyDw8lSJywscIxi0csB/j4Aw/3UhQRgPcE/Z+T0qj/AM39QswGDNqjor0+zEVZlMdLGw9W3p5PzflPJ4mNH0841+JAFnr0NDiLZKTAxWIILHMnfU0bqn6LF8mJ5EXdkyBXpxNU/hZnU7Ml401s3VTOz6OWHWXEZYYZoqdA0GFGcd+EUSEVLbA3nCiAVIED8Ux51+WJfIS/KH8431MgnYbepVUKqF1CuSU3h10Vg6pOl0utWqqVXev+1INoUD5t4G8DfSI+N9Ywv9zHjcvSIw4kAOC6/wBT80IZLblZ3m3+SPh/SKRcUmbICDtoJyS25TNcslUwkCOYYRahRFLWlTpUyk4NNtOQaFCDI2CO1evyZnf4PXphPFiBkc8fVvxkk/KMA2B8RXqPkCpSUUUAsNIixUkCbALjBS0SEOCptHdn5P4UIUItkoIEkFEcQWHygnLTRkiVnAuGb3tY8ks0vWzcsSxyN4oxvKDp3IQJEc8yTkXxEeKY86/LEvkJflD+cb6BvA3hmEaDJVdNKytKhdCXWVUKu67qz0R671aqpVd9eQjsjuogpllAnT4m+jakJMofEMBlH5p+N9YQd0USF5ejiv8AaSCaL+p+QP6r6pSEmUIhhlL6aG+lygFNNN8H5BPoI1znHzGQEy4JbLcFTFQyDZK+mEn0OQJLrPI7MqvXoSHEWyWPnicQWSIbNApGC4gb0v8AcSZqMnYMtPLEX34rH0APijJRc6lvZ8eFUGULDHTYYBeSwmZIFnHEvpFJcUgZj1ygfDNPzLgqHGZCWigNmjnSyiwu1yoCjAzIT7SBt0oJcCOBWKLnOZrk1LJRuFH/AG/JiIrzoW4qy+RfUONZy2Snz5+WGVKXATXXYmU3DI4Yy0eKY86/LEvkJflD+cb6BvA3JuTWXRuLbqnu1U110qBKkSpFrC9rxKwlWLXXVLuur1LV27WWfQkLp6dS6hErJC8m8DeFvzeoeSNER/SlsRm1wk0GYcNaRQ0rRtu2sl76pg8TFBFcvRtXzJNUjc94T1g3Z9bJEgZAiMVMzsaLESpgmNj4zl5wiKwzbg+3Tq0qgltUiiJbSqQkyWWGNkMc8TMmiblRlFjIQwYAzHIwIZL8gUpLAKEFznIVTsm/D9Lp1z0eqPMHguGN2I+Vay6OHKnUcsEVvxIhYsLutb+qkr1k4xMPDj4UZkhM0YCEQMGyw/UzHkxp5J4r6dnuhykrqfKdTt09pXfaV0iSYruWqbzNwM0BcuYDDkSqFhEy6CIClCrzlf8AWSTFMgF5OPWEvJIkSFlxyYiXdKmdiq/coUAS+yLseWFLIdC/VWBYQu0sXvpAM64U0FZVtJAbxTHnX5Yl8hL8ofzjfQN4G5NznhOFGDLseNxy6V3TVqtF+FZVZdSusu766q78kprNpVdmsp3KC3FTbkpkNdDVuQlTVvA3hbk345qSBiY0Y4YmJEeVkRjZmxudyxAkEVC/5HmaD6lSqNeJ/wAnSFnc7Oy8YMSGuMZGZx4QZRUT1Il1Ld0f8jzN/wCR5m/8jzNn5oxOG0mDZDzxeo/Qm5rlxrH5gAAEp6lxoiW6lvUKC0pj1Ih0N/FmE2HPSfVBXDlb8Vj3d6SDZS3U/qjkjhI9oJ3D5J4vICg9Pp3l9zR7/wC3a5QjZkUinl6dK3YiTpgVJCOGGWcHUaNjDiWJyGTiuxOZzGSmI9RQ6WGWWMBjB/8AI8zf+R5m/wDI8zZXNZmSBcES49l0nCIYMHIc2kpkBy73GczPwiGAfNshLZCKVHBpDPZYkSBLA/8AI8zf+R5mnc+lThQUuPfRzyMhZf5gL4pjzr8sS+Ql+UP5xvoG8Dcm5O+javlssW9vELhYyaZQLhul9Wrp1qg66Lo9Smsl7trpuypRWTXoj2cMMEVW1AVtVuuJSoJuMCQqt4G+iPkwD5QQsazLGBoA3qj8pHzxeh/oTfV75+X8WDvriUfXpQVg1aPm2JgzgCjJYwAIWHWCPcTPe6YyTHVHdglNc3RsyqSbl6YK3YmBfU450uKjIT9L6N+QkLMfMBfFMedfliXyEvyh/ON9A3gbmdPAEgnEGnssUOEoEozup3dUeYcuYZbEjKRg2dkvydN21LVmr3bdtZNdqqmhWDDd3mDLmBXav2ahGBSoqRAYHOVJZgpKPkip8JllubeBvzyJICRJClTWRxAsJLDExvyEfPF6H+hN9X2/76VfxYE+uJEKr4vyKGNuiF+pmNpOklSZS+kJnfCmgHLtoIM19REbMtO8vTcBwMTK6+sLq9qJfTejfkJCzHzAXxTHnX5Yl8hL8ofzjfSnZAsTRuHlssUrVBI2bHMqdQzv3qXutjj6gFNSUigVmoQjKbs123by0rJrIq+zdxTQaHpmQZvhIyO5nZlK1d9av4VLUmdMExGWXgc4FSIkORIHyx4JhC9b6Nr6vmSizBQBH5CPni9D/Qm+sSP+4EF+LCQ3BxMgzv8AGvUpdStEmRQihBYhw8sEQ6Ost6Nu/wD3JqG/+5Fa+p6NuWDPQQ1DDIDRHAJjYcuDcviGnYEUAMYJYIqgheXDXwuL9F6N+QkLMfMBfFMedfliXyEvyh/ON9E7szaucniRV3ZUjlqls6CZgwIOt1C7tK78m5M9CFUG+qSM0sHsspPAr0ZRUcMdLOjZeHdlXohtypDJi4DugM3kY4urJWfGU+rqMLU76rVq91ut1qX73S6UifMkRGWXiM8WjREhETxGU8u30LXM8tLwYCgQDRgU0YEHMJS6n0TwBaxYd/h0pi9MPemHvTjXgDXgC3gC3gC3gC0iAL1peo7ITfU6DMypEAwSWWHQ7svhCXhrrAiq/TAYtJSxsNLMGgmQQCHQwlCP9r8AiAsYfO8tVNCdITvpAVcOHNGXAVuODX1YRtyVL30wx5Rs60oZlBuzBNHmtn8YmY4aBNu5kqexSaJiuhcLg8mdVvOZKaKrMBlIxKXUranpxm+PAFvAFvAGuN4hITI7bp7FZOHHUwjFxlPonG8IkJUVlmshxCThxHe8Aa8AW8AW8AW8AW8AW8Aa+j6FIIyG+X+YC+KY86/LEvkJflD+cb6BSmS2qpHISpTVKJSbNHXrqdT9/hXevX8TPW+PbExVaOykKrcsqO8Eo6Uvq6nflrXfwNU/Gpes2r0RtH5ACiAL3BQeZGiTJQZicjISSf40uztq349LpT8gUjgnEOZR6huIhReEFEWMIoQW+k0S5iTGkRdqL9jX7L9l/jrMh6s4SQfQTVsRT5kqQKCGTUUeJypRJkkpg0/HcFRhWU2iQx+2i94L/H/b3QtWUXT8AxEr/SKBxX1dJYJPdU7l8VDpdNybJz08N/NQg1CiJDRj5BMPAFitjn1MLd8lxR57JCw4xYEIsAgEBZQFbvueOBoITBI2tMZBGxIbuby/NDM1qWLX0njupmxDixRi4S9onVlL1hS9YUaiygKG/jDlAFt9/Wk092Glw0t/CDLArb+XriV64leuJXriV64levJXryVXJlA0u6DArjDLEfwzHnX5Yl8hL8ofzjfmEESGl1Lk8lLl9UF5CZNmtWVu1+OrV6p+aq1fk3Jq1xV/i1CftUvXVctF3LZq/JT9671q905N8a1Z673Sp5BiLQ+qYHMTRBKQzEVkUfJITw2fVu34G+Nzf3pMckWBMZbPu6gxTJkc0JvMciJQY8bDLFsdig4WIAKB+BDbnuYZIBj5GmZE0ZkFHRMMzgE4A5eXzXKRZ424YWOTxuBOMMWhpEKYjAjYSuz+J6T/AMNy2UymGkRWWdyCVPJ2mefpjBKPyvXDSQuiWDYIRwl7kvI/b2jx9y1sJnWNSIg6pSH/AKlnQVOhRjIZcwnaMpTrVuVUIUtbJRhUP7FABhimReMMtb/TTHnX5Yl8hL8ofzjfkkJIuRRqKay3u7AHpc0cf+RSv9d3a6+JVb4ctLrzR8bja/8AcOlgW+1q1V8Lk4up1Sb+9fxt8eeut1rX43TtyQtYatyInL5CPZkKhs0JHdqDAQqBUbg/Gz3IcTjZtLqFncElI3csupLpU7KLgCmR0Al8CxP2ULqjqn8KFbXuY4uBkBbcx6ONEj7kjGC4iHFFepkM6why3EPxGB4mJMGGNnPsLhJDCf48n5PzCEcNWrCJLnwFAmMg9OAxVKGh5aGkIkXYfuM44cnjTIBjyZaFjAyxcRbrW6lV7rp8Cp74IGyjECM6lxkT2NSUKt+qpUsMaGSEWwbCXICoPysqa/8AhD+nmPOvyxL5CX5Q/nG/C6tvxMyABZOosnlC1apKGBxDC3WL/wDjlp4X5PzdrpyZ+9T8bDmkljrLWDkJN2ZqYyQqF+gTKm+CZE11RlQj6V20TX71mr8tOTVr+/Nqz1u90rNX73/7sHkZ2KWlkQGRFJcP7PGz1lWQhIyRfccjoiOjfJKV/p4kL20YkUHNAmhRBP2SgVn7KZwwQ9oSn1fV/G910ehm1o7KUsuZD4Yz4vBOLxHZZcmCwYA4yhVaq8Jc0IB8EHABk7RFQ0KtW5wUx5FOhc3IutnSD9RMedfliXyEvyh/ON+GcnUE/wCMA4dGMiOoZ318Lvy/fw6XTtW8Pxu3tqyG1e9qhClqZKBglBLdC9arvdOWnLT8SXvxbs/b4tf2pUwIWGYQLEclClAUgj/Uv4X/AOkzHnX5Yl8hL8ofzjeM0bCKodQsrkIo25AAgjrVqrXm/J+b1vA3Z+btXat8OQLM62Z1hIQhPDNJQkT7bFpZzH3HX3GF6u1073963Jq1fwPyaqbtU1q3au71u/LbQBhC4qRAsSy3q1JKntdfrX8D/hfk/wBVMedfliXyEvyh/ON4pqRYiBqx06KYW7iK78maq5PWr1uT+H97rdb+1fm3x7ccRCdGZ3UzqVYtndxFMN3FU/J/jdLp435pr1q1Z7+91qeXxqFOGpnThE4k+TSAN9KwS3+Cglp5JS6v09OJVJUn9VSCIr4KLitX7ckpUtWiOjGqmdL6PyQEsT9Dkh9KtCkK0X8XqSY627CFRg/1PQwliPoj28xpRQBAv8gRcUVtQ+hMXoTNUSMM2r6O76MiPMrbVhiQ4XddSSMqTq3t5quQMs2rsl3VtZEaaW2tHJGAW1X+CY86/LEvkJflD+cbwjipBCUtcydUcMKd+1evWr93r/Hwv425O3a6V+TPVv2qeyOSBFha7Hev4XrcnreBn0vxrcmr12rPqlqzvW5QRpRKSBESXF4oCFt9GdNgxseKdMnMmm5c46SkflMxEnNh0sIFIFQDRbMcqXGCuQjfccjcHq7h+WiHzCCEqYUEQLjmjMjlcxKmuGSCn5+INJ6iKkgpyLY4DchlUQEU67icxImckJBjnvMr5ABuMKyGzDKxCA6o+KeUyIuGk0vE8gafCUUOyR0GAjlGzIuQT8wZV0sZlktGGth1DAyRcA2Sy/J1xAnt8Wg3kw4Dm0Yplw45pBCXzMyZiIFKo/8Aqqer5XOt8cEm5SSmXDOTZ8vjpVRkVc7kEuOpy0Rl0nGmuHICgBDDFhy2b5FIEZxRYh/Vc7cNn5U9PAgHMgkAcdKCGa81kMsMtReHzCSjzPCkZIEJ0BGi3jmPOvyxL5CX5Q/nG8D3JZJaxnADU9U/fk/wrXXTwNf35NX/ABO1+D34v4NK/wAPwfGtyfk9Tya6d+Sm7UJ/i1/ap/8Atq3ZVwSX44HSjfR+p47ojyRZvS4ulgT5p/VMulhSBpPpiadcMYBWexCMPn1GXl5OOjCYoQ+KlBTuRFeBLli0kUEJmoLHo+DEHNBepEoSO9KAU9OiopaFMjjMsIoXEOGjgpvKpoVaMMbTKSFPeZVyJKYJA4zx2shOgcaUADMkDhRWKjuUyMkpvVVauORRfT1KQMaGMB+qBcNhSBlPpYZUsibLqzsoKWyMwsUhkET7WCIxAFUnkqGJSB3hi8JyIqDIulzCR93mGKEYKODgiYBQP1INqHyJQNxiTioGALMaYpjeSn1GEFUAl1AkQJwyxvITQ6w8xgA9oVKHShwp1UTNkYyfYFzkaVIY9FoDbLzYEnkIohBgVEsbjyo/jmPOvyxL5CX5Q/nG8BoRggFrc4LvHEXVX4u9f4cnr1+X78v35N+N2qm171Pd+bXSr7afjfwN4G71m0XWfvf2qeUScUSPBCoJmEmSwYqPovVT9cffTL5Mevqn5KMvpb5SSel0vxmd8iw4zKSRo6jG50fHTyipgwln2iBSBEQ/CGCiJ/FjUEEg4nDZ/wB7AWUNZ5OdcaaMJY/GlofHh0qxBTJygipRwQAAsZOv/XpKx+TATRaQLgYz/cBCif5Tli+86V0zeEVMEG6aAnzuOrGBfIpI9NKSdM+lTarkLn891RlcaAWwSQGJJGVjMyJjsksE1KBskZhEZEc9nxha0em0awx8aQGLDOPKoWrONf6oPa4xiheQjEnpHI4sXHZdDAQJz3WDBNOj0/Hc2yhzeGRg5QVMZh8kLHTgG2VLKSeVw8lgBJsoRDSbKncRlw1UE4FOwiJAPxzHnX5Yl8hL8ofzjeDIx+GRUmj/ALVV15PW+Nd+/h08Hwv7eFuTVXJDd+bdq1W/e/v4m8D+BNdqlq9av8a36rpWTq1au+mlwE/xyKgF/RepRVQ8OWNI9NZIAuo2UMepMkCbOFi5f02JqLQahVymZypOWFLCBS8cKAk60yO0lNmBQJg0dg8YAEK4tmCz5oUCXzmUJgwIhIP0wLiLmBh2OYXLiGxxEC4bMBBKWsgUFOnQypfGYUYnjpojJf0LFXH8aIxRgVZdKVRE6lhZabIAw45sPCyijmSFGbJZpEGWQZeByGPnhBWN+o8mWMjFiZP00IqLRAhgSWZRTIzLjAHiZtAJ4PITKD88aGLiBKDIxpYT1RM/74mUbGAeiw4Kl18MdCr6lklAzKDbYZJFDcAGRG9Q5EuelQkFsVQOQwxC0RuemBZIIM8OeIRIBg8+NlRD08VDRm2QSEIOAkpBzYE9Fsg76iyRc4bLAFcGBWWxMyKL45jzr8sS+Ql+UP5xvBlQ+43sYZ/uaifDmp+/JuWnJvC9bwtz1qqH+ms1flrX5aeDS/v4H5Nzb4Vn5JfS/tW+NZ9KzvpU397hBngSyWuv0TpCHAELmZP0/GcV1xkVgAiRkiSrrSGkMMvkONlJ7+ZKvT+V36Nj+JlYYRjJtQqR2EDMymAusVxIon6fnXEbrCRUrEE2KkOOLQXUOAOCqDwszHTBc4IdEdYym5BrcNbKTkGNlZ9+oAR6fyjiaKhoorjpVaAVILyJEQieOYAfSK/RxOB8ERhZcY0yXDQWnYAlkLMMhWBS6VbUQOJF4cVJuS6njH0CLybEjEzLCHAhwWJRRInXoiCssQ6GRNen51hH6OJwcMoIw0y8ntMpcOaw4tKCKNRQeASjrZhYqNJY2XUwArFZkk5OTNen55hHcnGYGwK2FmD5pC0ILlvHMedfliXyEvyh/ONzOC8EsIJTY7jjiCOI9W/239uT/Gv8Klq3wul0reF+TeL9+S6G32V3auJ3v3p0ZTc38X73Tk/hTXrfC/vyaq7M9T+it2umr2HF4J0FdAVvBQpvotzt8Hd3+L8t6tK/JlO3wdan+PN3fwfD4cRenNhFp/SpSlfq5MMIzaV3d+73c9fmkURP6VKdT/dWd2fs4wj9n5JFET+lSlK/V+CY86/LEvkJflD+cbnkw7BRq2dT1dV+mt8Lrf35J7eH9/wa+B61V3a/tVfCxwaVDM4sqYDHGS4P7VvC3LTwPdL+90rXSv3ao/0r9u1T/wDbd3oj9q3YNrpU92oL7X7Y8aYzFgq+iZLqfRKgmR/lcB3TuDeoAWttawQbvokUJYf6ks6n0Zy21tReldTahKZ0vo9QX1D4gghfQJxA+bM6n0ZRNKOwpou4Dp5BBqFEZCHJISrao0XUXE2qpYooYNxFOQ3JU4NLAKMC7Ee3IdW1hwlAiqDWWLCmH/j9tZPZZkiMAnc/JEa/DSoY2RcEJhU0oXWZF2BtFodW1jAKgBlBr8cx51+WJfIS/KH843PMxf8AGHXq/jXf7Xqf01+X71Nb8rc/25a9q/wbkG4SiG2szVTdr+3hbxK5p5f/AIa/BVXW+FT8avupmv76VnqfhQrghjcWWE/0OSy3sUPxUESUtkhkVQZQ9J41KOGsmoKQALnAstyI3IyQhMmcxqZIE+sFwPIRzJj2w/kMg0DECmGKFpfJjYjoE91xqRSlUYfTMwwR1IiASYLjn8yyP3gdIJX08fXGzmvIINQq9qJE+RggXFNzEmPKyIhsdXymO5Sp5EBErNCJMimZBIw0t8QKUAcwMyWz+dYRftZH0sd3OHtShRZnV05BkJSELLLkMUEWvJyClyaHEknQ2czq4tIcXHE8fl5Ai54LDcjHJH0EjsmX6c0pKY4BDJWbM5PNCzEkoW4v3wlGrM6nZmySTTj0RwQscWpWQkHVN/MF/gmPOvyxL5CX5Q/nG55YJvkXaqqr+1T8KprpdK3g073S6XS6ctK1dvC1U3evf2uneu3J+/Nq90ul/fkzXTvX5aVTVPJvhWr96/6amtUtqrWs371vjU1PxuDj7JHZ4tfxt8b6pCv15QG+nSGCxtYreqITJlywjenZndjP3AQ8Qo4gcPK8sJBlThEv6dw44smiQEPdGfTwzqfasejRTAeWyzZDLAsRxqPXDwIJcxmkFIzE+ExXLoAOCLkEJ9O/7aOXR3+Gxdi0qYdWoWHyMnKDinMiKhkZs0WAV8ojqUQGGGs2ZOjmsvyJIYRoukpOCF0SrOpYDNlMqmBiuAE0QJ/Tw8qP6WedPU2EMPjBwMrF4QKwApmWxD+5Y+7d07crGcfIj63jm6YvFl0ZIGwE+eQlwlSJSNFuezTLUmHIT0OqIDJJFxb+yEUBQMYREkjpMAzlk8KKLjfbIiLWb+Yr/BMedfliXyEvyh/ONyd9GsyvjSI666apHa7bs0euisjvdt21k3bdldN23bdt2XZdt23Zdt23b3u2s1WmsnvdtdN2XZXR2u3Ssm7btrJunaum7ayLt0e7bsrJuztdmirs7Vk1k966a6bpo9S3xqUdqybtoSLt0e4yvhSgL1n7N9An9TX1RZ/eC73AX1xTt6qP/wBwItfThCv6cMaFAVoF1VI4SSM9QsHGZ83DySC4xkqtxX4UrEgyMWgscyvHvYGAPxuFTAszHDAHHNjOnS+qfwjL6d/20cp46uMx8ycA/wCQJK4ZkRqb6zqSpkUU2Gy8y/uiQoQfFjotF9RJd2EaJLYWcg4cjvHkxwxZ8wOG07FiFRjYPVImp/jyuYzESYxvo4709kycaaNqPLX0oIY5EsMIMSPOJiH9yx9Q/wD31VyFts4fZwe64x2y19ckkHaXl1QuHkeHhjxqD7nZj1CkikkfLLI4VJxvsZePM53NKkJHogcekoGHh+nRCDhgTZQYUUQjLADmyHjmPOvyxL5CX5Q/nG5HF7C63oobrEWqqBvB7Vgbwbwbwe94N4N4VcKsDXB71gbwbwbwbwbwbwbwbwbwLwbwbwbwdWvA73g3g3g3g3gVwLwLwXvAvBvAvBrAO73gXgXgXgXgVgKsCsD2vA71gLwH1qgLwKwDqfSsA94D3gVAPeuDY1PDNBqoCtwKH+h9SyShyJU8HgmRFI0sMTkMxlkTUzxC2LEHj8eALO89Lx00zHh8yh0FlmAYgoLMTYYac/FkS8cGYjcSytAQYxebzjIisiWBIx/pqTWXImzwr31T/TGX08/to5WcsMTWVO+yY7SQMZGIF9tjvOB3Mv7okKWWyCUSpWQYe8tKCnEt6erf4Gybl5MUo8Zh6ikeeAV/x8u5BiC4eNc4+LwKp4YYNJoNJWOJk2IeQP3EP7lj6ZE4U0y39QY9ZSfEGsJl0aHDF+sLgizs9tDymBTMlSxcL/j5VyeCVBGQglYbjKjKSkrT2CuaOjjs/p8tkqdo8r1kgCVaGh2x6KOAieOY86/LEvkJflD+cblI+VXenvTXpr016a9NelvTXpr016a9NemvTXpr016a9NemvS3pb0t6a9LelvS1itcp3vS1yt6W9LXK3pL0lYrelvS3pL0lYrelvSXpL0l6SsUvR1imlcpWKXpO9UU7Xo6glUlL0l6SpKd70tDLaKakH1Kh/QoWhw1AjnMGjTArrKxOKRcWKw4gg6lC72l4eNm23GmwAmytVRpEhCguiPDHbaoMc7hUWbEcQqSwqLKCMIaHGS6EhA2ciCM8GW6mNjykLGjFivMoIwRhC1SeKxcifGNinHCSCXABseMkEyylmcUijB8Q2qTGQKKhgtaYLFJWH6E3BxMdAKHFLWMFCZA4Q0bi8THngTYcgKkY2taBHKSRPpJReCx6lbgo0lGQAauhWtS1upTPopns3Exs8sAYygEpGQzECmtiDCAhREjEsWiCZ0I0iTGSOcWtHjmPOvyxL5CX5Q/nG5HG3B6Xp7096e9NenvTXp7096e9PenvT3p7096e9PenvTXpr016a9NemvTXpr0t6auVvTXpb0t6W9LelrlaxW9LelvS3pL0l6S9JekvSXpL0l6W9JekvSXo70l6OsUrFL0l6SsU73pKxWkftB0/Fr+HX/p8x51+WJfIS/KH843IRtbsuy8O8O8O8O8O8O8O8O8O8O8O8O8O8O7Lw7w7w7w7w7w7w7w7w7w7w7w7w7w7w7w7w2vDa8O8O8O8O8O8Nrw7w2vDa8NrwmvCa8O8NrwmvCvCvCa8JrwmvDa8O8Nrw2vDvDoTaf8AoUx51+WJfIS/KH843g05aXS6XS6XS6XS6XS6eDS6eDS6XTx6eHT8mnPS6eNKXV+l0unsr8LM7/D/AKEvpYyPUdkyi4+ZL8WLUzpU7K+jmPOvyxL5CX5Q/nG/6w3ehFVP3WIXTwt4NQhS30SxZkJ3De7gKMMVjT7t9n4UJdamS0tLF4YMNKgRAJIqxgqtnQ+ivryBLhv1BrMJgWUlRGf04KGFziTCDv8AIdE4Y5IcEPevl+9SSKsoMqIptqnS/wCWY86/LEvkJflD+cb/AKuXCcVWjHZQpHK4IQ4pww3ElYUzxwtQQQmFFWqnZoRxFFogvEGZNSlypcMpHBcMotTrVqr8ASnSIlTTUMWk0oFGJnAmFCj4mQUziMzfXLFLw8e5460cZn1MPOlsahQA9wI590h8AtGP/vwdYwcwNkc0UMGyIxb7l8YvFEAzRhG9QP8A3eSEET6mENhuNGEOi8MIgV4zACGQuCOsOgExx/8AH0AADpY7IlekH2N+CY86/LEvkJflD+cb60oAowKyUrOEix0KPVIFunG7ECfUaqWYlIUmtw1x5+MlFqCLjo4Qy0cyBXjPvWEsgecQMs5YVhnDYQNYT6L8JUs43dQxRtm8DxBaBEFqWWHWpag4IrjyGEYzKjmGdPDBljDkoEURBMFBcghIeKKUqMMqX+H40cYGMLOOYYvIzqt5oFBaNA4JRTup3d/wABuKKlDJcq5hyjGSywXd/oy21zAe/KMdOzp8N6NgO1DrVgkcIBLGh6KlY4wogcOhv51plofI5SVWYuPxZ+Ohhi0hkpMI+QBiLDRBWG4SVid/U8KnY1ZwZTjrLBRZbWPciAkVCDZwiIYSGGGFGFiKHFKmR1mBnWJ+CY86/LEvkJflD+cb6IANxhUhpEhtA32EyyjI/DZS4wAwgkuRJOVUzs7O3x5hlxRHZkgRW19TEgfDIlkhRw5CVGkkuNIahxwIY/AUZiUggHisREgpZUET6IMc6OIviCKW5Ilx0cRY8cIhX8QKOMREKPAY6KQPKMGT5tJYiIZaRfcUBdfgYuK6NzSyDAsK6Y7Dip4uCIo2OplDLdJYJxhNtFKhOEpwuSG3LZrMqSKfIx7jCpKswQKxFLfVVyp9McfUlJACxCTDwCOFCKEfW60ArvQylmAnBXp4o9Gq3W5g+YMSyxkxk6ZMyjExjrMkw+1u/ZhRwiDFwlSCWSN9vhLl1j/AqWcupalhT3TyMgO2LnDB+KFWcf8AMXKimNXDHAEAVoKlKlqZKBSY4Sdy2Z1OzJNHAYMmkY97bJzz8ebHGAAKoJx+SypqETGBxykoDlwFWUyuVgp46WGwmVNHjEqDIdR04Ixg2HLllBRwpIJO71MGVc7VJoCKSENhoMogAyPO+ooyv6lFZxxJKSwMqZKYQZnJI910oM7OKt2/BMedfliXyEvyh/ON+cqAowMkNBmI4YKlh3Hw2cYQR4A0o2ekhHhQREqWMo1i4Y8t1KjAhRloCGQYCkCQy+REis1qqhkgSSVjml5Sph9Eo99PqEBEi4krCsoVcecUaWtnOsCcKLGDKCMSihjK4YnxENImjxoQde1Td30uRD9FGAFkTmRqjzIZcAAYAwVDPqJyJWZCFQXyZLphQw3lf8QLV0qZu7d30ZiAbJZlliWwZTiiZS6ZjgMpC0qSsuKOFxgyyzYbBDqSkh9hYYR8bkCqi6CwhoLgi7eQP+ZFk2//ALRGvZHzNTwiyAmEMAt1aUpnwmkDQUexTHjwp1ghHLp6cMFPTCcV0MoFSFslU+O4ZuLLJNAqGGSzLJfa/Dfty4a6ETWtOrguIWH2WYOLLBJCKw8YxENQizRYTVxKTbUyhnkhVLzEkC8l5ihhqFVoh2LluEgYwWfqNgTlBmWyaog237RN4EOYdJAOalwUIGM4elRrcCvhECSChb82VnxIjHA0l8NmlzxQYmeDEaOijp5WJZWdMTKC0jOzRWCZQZOTmjshJIODuMMZx8oOcuVyx6GIR7x4pZzXTGhIuRBl8uHEK5djJk+bRKQ8PCzJkZI2TwOGloubY9SAClZtKD2SPpOHgIGIOoHNn2SBkk+lAwUZGz06BjcOESABYUpjREAX8Mx51+WJfIS/KH84354JDBhDmFkB1+yCmhLj3wMXD06Kkbmp9ywAJQvD5M4cegup8aDNsxiQkkdNHoBLIS61MlMsvpSJckFkA5n3AANi84Oo4AXElTYhdSUBKU631UCvpIQYeiN00ECFZINRnGREA4zJGgJMAu8qWXxuKhH62uYtuEjmsoPCrMBMeyUR2x8ZyuGKWibQlsufbHIpoQEAt1A/9WBsvQeOMkJPUQtmxgyiTBdBE6pcSAZESXjlnOrbI5NceVSkvjJE0kUQ/JmwW46BHmC5swX4BOOienFQYOGhuMM6mLk2UHvGkpAnDID4hI2HMTQJguJ/NIaMIJx8iDBZl7pK5mkwBMJMB4mdFPRbKHFEcWcBBbKJVUYUbhY5JPLE9w+QJdU9EWZNMSjRh7hx8b3fhLOJ0NKZjQ5eJK8YyrNFb/tiJIxNnErSnasdYlKiOoAzKWLnZVajOmHn5AyYFQOyQOpdmOp//u5WyPmbJG2iIze2Okzxg718obMsXImDLF3H9uQpcUNLCZAp7IuzR47qjQhGhC6AmCN/czLZ2U+780iQJ5GUYAx6ckRC0vIqFysuZPYpwyBYkeTIAAhQEUmBJrMHx46DOmwzo0gacyL2pR1l4tK7LEsknxOCJHR4ULCDl4QpIZaNAmXeNMnjeN8WbjQEpA6sSQKT8yMKgCBhikARUktJhTsslwCpDHj5ANaIaCxiOIyrrkRBCMwOKkkpnSp2f8Ex51+WJfIS/KH8435x1cHFjCkq+7GyvDZnU+jEA/biQw5nHwFARri3JokoaT1JjHI4vHx6DhnKgjhmPT7fBFzQcSwZ5IJaKCUYNycoOJKASDi5gVYHUOBQKIkSVkTQ7mBlCPcgVwcdQ1lvuKAKTDiCsLsTIILrnCYYYWU75fgU0S1NhuFkoYkhJFChWahyYAAZcv1RWIjQgTESAsY2uSM5k++EYRAk6VPJJBGDMl74KxGOKEkkSiACmSqLmSrEaKA4ZIAqCyAI4JxzcQ/uJoWUGlB3VBGhEx+SR4hQII0ibi9NGEmIj/zFySJAbULrpGdEZRKLjBlDCmpZSwSgbhlozuYd3hBmEyOV1F1SYVRVoYgpZ7GAWDjd6YwVhMgktTDlzYawDpVAYISASYmw7kQW08WDPFhAB4SLLATy1Ewm4hsQV+ifIZMQcdWNxTIcR4aYjuOogWl36KENqRjamXBlNuVnRY3hpJRZnZEsaNwe4dIp1aC/GysQejoCCEWZMkFpmpJRuyHG2fx5GtgogANzgywGBdARriv/ABTxnaEFHh5BPDkDYZUocy5aWA4TrCkY5JwP8pUioVPEElMrIx3+3iIwiMVh2DqzZSBBdZ+EPNkWQPIJNjOMYWvwBHBwkbAxDQ4nZYIwgK9wbyhp3Z6aNimXbiwpvgjbBD5c7BTI0jI4cQEJuPKCLkDDjOtJaSGQZSsbJYUuUcSdI4mTLkIdcmynd1O7/gmPOvyxL5CX5Q/nG/OIhzOMDhogMj6AuxY0vKo4JLqAKCHMkOocY+k3wkoINjpgwaSNJTJpIikghEj4pbRNO9UsNuhHxowcF4h+Sgyp8kEXBj8QDCHZZqUOMtuADynw3NYw+yGyYEMmkvIHctCQHsj8cKrLlxZCQDKxYRtzwZlQ6y7OSaBkHUKpy+NAl1uIIAViyK+Ik4eUP9rIDDkYsQmIHhxlxdBCJYnDApCCkATBkNkFyESSjBnMKGWKIV3Ex8cNnheJIGXCKlEFC5XhmSYhQUzhxllPwP6TkaFhxt3/AJS2JEwdHMyZstBx2qAMtBUQWsSDlwpoJQQpL+I4sOyRgWFycUZP9Xk9u6oNG8mOpBqFoCFDLByxoaHyYUcNGWEFoZQxzKBzj9PGQUe0eUZK5EkePKUHY8mDGlemKy47ggIIlgFEyaAo5hek4fQix2MFyRxzAsqnr4c0GFj2QKi0uAOaysgIFpSqjeSmW4pgywCkBAsI4pZSyxyBPyK9x6VCGiIHhxuEjnRQVpHzQJxYZ1hxuWBMWSGfOZeGkPaSxgmKKKuVkDCY48pCzJuOjZIRAwh40nYwAH5ZEIlKFgwzJQOIjfILGWfj3SC+KxHFcQ/vKEiPRxn4hBSZ4oktKnjaRUIBL8iZ4Ur2QcOCGnbf+GY86/LEvkJflD+cb88ScYuI6BJDFi50ZxiZXEioCt50yfBLg8Agk4YS2iVjir/VyDNDhp2oUMIr9RV1Aw6xCmNSMkNMK3TiEJNtt5RZpCUqAHkMQcQd1kovHC0a7DnZA71CtqKGYGDTtQ44rv3d3f48kqdL6pc0O7aPrq/fiL00utDGEDbRChhFfquulSZGT8OsMVRkZXx3O760wGVlivBNh4/HIJOUUQJloUo6AWEUwnEsnHlZwuzLBwzQTUYNi0aX4JNhHYTfZOPKzYCd6MM+77yRGPiUfwimFiCb6DxjKttNnQyP+3KxMcoARZo8fx4+NMuqmseklSiabdgSiAHJGOCt2VK4wXPCuOUJ4gCEtlnRDAYAXBKa0MVYf6FDCK/UWOOG2wQc6nh8MuTGQsJRYwcw4RxncpF4sAUUwx86b4jcML/p0x51+WJfIS/KH8430CVqT+lSlK/V4yB1RRb1UmXQlTlhRFCrda+YZgYNtELEWI+q/pdbryZ9Pg4i3bvy1u9WnMiYYAR9zDlQNzlxRliq3KSeGZOlY+MydKpTrVuVUrUn9KlqV+rxpHFS2iViLX+v/p8x51+WJfIS/KH8431QUeZFRuYRCgluhf5ks6n0S7Ol9H8aUKUzunxKSpP6v+ibF7d3JLOpTJSqKEYPVKmdL6P9dMedfliXyEvyh/ON9SGAWKAhmZEJMlKygR1MkOw5tSk1ku7at+Sdk047EpFDhpFGQRDml+EINQqtqDKyMYjfIkpZQv8AuBJEJIYrKR4AlBlSYx4fGso99OikzI6OGKpH/Q44uxgxtUNmTBz/AEKJQugAZPDhlIY395OKnWy4QyObYodBMDAfXTHnX5Yl8hL8ofzjfjbu9GjzAIPFX+FyRhguI9S+jtqfiyM2MAZMFZEvPxoohMiUUaEdr1cCsYQBMVJAGzAoJAR2cRTpZnd9GaLMcPdUpdStrGCQxdDLE8YXCkS/RHgDJAubChCg6WQMtKfAKw4MRuKFhgGOOmFJxKwh0n58yMocXerwFDDgu6XE9qxwJQwcmGhAiVJ8AIahVslHCKrcYEMMqMInclTOl9FVu76M0eM6N1/fSuRGYHiP4i5MUZOrDhKBEdC/CGEIL/jUzpVorxFxlgCstHAjGW8yYHHBkosM8GL0sSV6uTT7tkSdwxkUAEqGSI/XTHnX5Yl8hL8ofzjeIAFY4jIDNkxSu3iESTjsoQQwSR06TJOw6GXIB6kDyDQkgXMmgVFxlBr8JcBZgTYGUjVBGdxkogvJFwDbf1JKqy5ywU2GGGb/AI7ErQthSY2GRy4udlyqpIkYHjwiRFHp8hjiWEGWXJFEkI+rMAwsSuRNYgqTNHTcpKw/8h9S1RBxMiRWAYYqGVCFMSL5hGMpTFYuRi55lIJiIcNbpXzHEXHxjKAjo8GBBWteru99uEYHe/IujiDoRTgIMxMjEh+rQAFwSJYJZsf7is3HGZt4oAwhgx1obmRZCGEMjESLHzPvkoZGccZ1vS5cQfXYCEkrxxjXC64sVHRISzoG9rgIwkxAqkpZI0ZMT4ZUlJuzm1aUYyDERgkgZxBUmflDErJlf5TydS8mCmekwzhguoIfhs7Ol9FcyALCLdYi5E/kk6CEQk1cQ5tSO5GOSE0kcLKLq7ViozhcSpbVTNcxmRoAqXAIERVzEKEaFlJSLgnYM0nMI11sk2OCEsug0T5kgHMGEop0r7+fcs4YoHCdbFchIDHRJA8DJATkQs0XscWSM61jHQgHKgGSv1kx51+WJfIS/KH843NCXWpkpMRgoADiPSQjE406ddAghjGo9YhyKEP4+sirH4ZMDDihmi3tzmQyYJcNyxQYYnGY6J1QRuSECEkzYggRwkKVZnUlLrUyUiEDAe3cZjRQAeI7lR2C4jgj+3wx89UirVhvFEKrUXxyJcL3NGvGdalCiOpQREozhlxIcH/uD2EdzRGRPhERzChgyzlDTmMwOIpYEDgiGTZwowR9IIZkAvIZEEXMShgzvcMRKBgYl1x8Lj3SGgjp3M447NFCoRBHDiUFyRHJAgyGcxyyEyzMdfShR63RvFDLFQXcYbJJSWPnATRQdxmiSLHY9G84E1BlioU/IoOHQOmG28o/zoVi07ckyGoS61MlOTSK4smHHR+MEHjc5SVUd82LyLlRB+7MTC10uXyQ4xcWMhsF68xCCtIGCiwXTRARAm1XPG1x8MVDBzN9uNHqaMGzjBRUQVKlYEv05ImrjlVBoQTCjQhRCYKQWLiGTZwuwZpIaDwJc9PliY8gMOynQokymJCLKksaFUNxZXLptoMokQOJPpnobrFCrIEAyzH2j36pkuZCLqKpHLSimDhQi9FDeOJhAkARdg6RFZLi6p2QCOFkl0pLAR4BuaiooMfhQUiPLLFNMYIjhd3WgusqgvLETAJsLiF4aAHCnT0nMG+FKxRtJ708WsSAPhLoAIg69oftyEdhJU97QVYGOwJUu0wKEZKmNTQwKZcQY+Y9pjPb+nIoIR4oawl7RMiGUTwwdQRhtsLGJqEutTJSGTLgBg9cdB6cysNvqZjzr8sS+Ql+UP5xucKGyje9RUdYkKZNiUw27FJNrBgt7HGuIZyYdOVKPoLMJl6OIbjospEkTIcTBbmGFe43PHVZaKXM52baJg+nLYIaFO44dBMQobcZY4mNGhTcYKdMQH+4i3HGK5SfGypRO5UXDCxeTSEI3DwjR4vp/wCmCBk0NlYoP3m4noZcuk2TKD8WSmTVhn39SFYn3SBnywIwqWDnkaRCNuXTz00nQWIJ0yM3vO9WdxUj7yqQJkRhDmJkRzEQtYZc0KnBpo2YmhyJ12GQaUCBKyRbHi3FM4vFmDB5eQTRoZxx1CPHpDCDFOGDxadyoRRsGEwo91qFyq5F2G4Zc2WYdQm4iyugE6QrBcBaVyZ0x1I7qYuSRw0rMys8SgjKCzQ4jjAyUqpQwMTGiSJrDiIpowLOSQDt/wAoDWSLrDFULSgLjjpRckNSEsdXEQYWFTahmZRZIUKRBJlDkgIHCGjNEf26GStsOyA5NGTJY9mYWrQiEZ2rTGDdAMThQDqgiJxUnjpU6NGNtSOKjCJE8nJRyRyWSyBYwkk2JpJ6vnsTIKl/cCUMOIcxIqMYS7s/2zImz2yNpwICQUskb4QZUFktkReayIdjYJNA8Nib9YKngRREG5dHGJWALdD6eiHP+4ET2nfRjx4rj5JhzgeYnZYdiMeghFRiwmTPSyiGNjmmxXLBSAQwBofHgpFkHJ8wOEgAIsTKhDGU6iz8sJMjNCY+AVChIdEeCzOp2ZsiOjRhUCPjBMPnxFb1wEU2OEFrMCyYyw3TSwqSEYaPLyJzsVjKfb5CTyYSIIrUhneGBGm88BSHiQiQzzbY2OS/HTExAp9WPR0ks/7vkBgXjDrE+qmPOvyxL5CX5Q/nG5k34cVIiNFv1eIkFFwiowqtqJTaASTEBujpuHqHFQ0nkgPtgJ0MRYpVGOY+PCHjRw6XAGSYWcEJhEpbKPcSc8qP9vdU9jEYkvBC7J6YBFSmDhDyUEMcMAARgyxMajRiYJhQq3EBmtFAIh0yrMNFHyYJTJtsWUjTZKQO5aO4KSJhDm2LFcSG6spNl2KlTKhm4ckMk7LkYxDL406zsCA5YxKmxJQywGZRCVnyo3WibTp72WHWs2IC5SGIk6RLrJM5gzEhkjU4cmys7KhwMa5h8ZjixoVpSeNKKm1MlhiggZrgNKAsaEKwoZ026FsAV6U6OBuUVTtOhpXPZCLB5WZoebxCm1FVmcGzfaNnhZHkyBacyB0nTcZGPGFREsfGGWrYLLxoE9EAFlowpPZKA4FSsvXF3gIjocIjRx/aotY9LgtDxoZdBZJsyz7TAIgK9BcnGYtjpN3ODChjIGBAZ1IUgotQUjOlCwOVP1eMSOwPNghYdijsX6KIJEkBIYgG5o7DiFpOXMTQE4aYHL4RlnwBOsXtOnvZYpYpoqVEBhSZRjxsjAg8Y9MGJAYMvkIkTkM1kK2JliuMGgjDpPjn1sJoXygdf9IGRHM/7oiTHBIBiF2UOPDGWOPKSzEEoDSIbMR8WmbMrlpdygEch1kEpFNCvpIgEUw7gThISLgSg8oGLmcX7eg25NBSWBDOEsglhJmT9ojoYtERBLgkxCiBQhBgIwJKdxoeL+BibMgCnDIu0M8UMA/eNcwG6bFyehcRxeCtJQLIf6uW4hk2iWmQyJbIyypWOBLgyySgO0c/Fn05BKKHSdNiGRVO/wBVMedfliXyEvyh/ONzidooZkqorJSeLnxyyHzOaPvwCWNxaohK5CYlSMXJjcQ6XURjCay8TS47oHCULLF42TUyjsecIkkpLFRikR1PUmTwpKUJsEZJAw0Wvix5NXXBHQBSMvKYyaGKpfMZuRfgEYCLVCFxTsiSOOAacVY2N4+KZUZcY2EEWYpHxIvCOod51j+MZGMZJqy+cktCxSDjv6ejlrMJWpK2Wxg6OYZmEzwoIcjSckUBzmWDAYN8ZjTkmcTMzyTrKkmHElCcXID8U8MaBSXDKkpuKjJ0QIYz/RsJSOHRKTQawZqTDJDMGVKF1RJQUQzGshZ1HFnxsg/q0JJWXVosF7JFIqbZDyL4ZCq/SjEYELuIUKwse+pPNZI4ShEiEDeSTrY+ApUaYNHscQYlKVEYIwGt0R0e08qWSZcAmwh4+QDHOHGl5UcZxxnWrPFyAUWAiMjlG3xsN5edJKlcVGACicuk4oFi1TO5Bka+lJkCQUDFsUBJjoD3hjFMegiRxjYbHNx9Iwh8lFGzHHOjGUcBJctnpIQ9EFD5UDOJYIuwT41HHpg6mXnUnUDpHQ/sUGkbimBTJQYDphgxyxMu4Ma7vyFK+5wJwjYzJJWCSonSw01mBpIIrkwwSoRZDivPj9IUcwoQqYYhhCZppc0o6EZA4hlDD4/CjC8U4eAipMmxIwbx6EOEwigZNZEmXYgX/oyFv9GQtgoYlCkjHBE35CKxcvJGWGWkMIZzIWODri8BXJKJGPc16bn2zBFUxiwhcGJyqTiAumYKZyDJROlKlyxeBjeiKRh5ywjJEGgouXOLGMx5uGfjxBBABI+AtcW7aPo/1Mx51+WJfIS/KH843NC1BqZSBDhQ2lvcEHi5VOhAYYQde4T8Ia1BrZaBDZM0zdek+AWRtICirGXuE8CDwYoHBPhmiZRn9vGFWMveJyInVldWrLiUicVJw8Ia7P4YsygsKriMZKE2X0AgihF7l/B+wcoOgPbVqdanUrwFTqgU7F+5JdtijhtRlTcy4nCGQtxhSCjDGlGTIhhWq6VOil22pMmFmF7hCxhZcTcgRUaOviGHPMGHwyjqdT6v4ShtRd3ukVxOLTRxY/bxgirBEZYYy482plnSp4IMQMIGQKAmxnXJGDjcJgCwYigl7kDyA4oexXjWORMlgkGzZ5QqeGFSxkQuvcEbPimU7VUsYWWE3hjLizSuIbXIJDC4RF3d31exJhghnDXJQUJDHRWO41BgY+EIdEEVvEUp/qZjzr8sS+Ql+UP51v8A2VCnQtKkyEdEzYoJk6fMhiJDAL/VTHnX5Yl8hL8ghFhL3B9eZvXmb15m9eZvXmb15m9eZvXmb15m9eZvXmb15m9eZvXmb15m9eZvXmb15m9eZvXmb15m9eZvXmb15m9eZvXmb15m9eZvXmb15m9eZvXmb15m9eZvXmb15m9eZvXmr7gavuBq+4Gr7gavuBq+4Gr7gavuBq+4Gr7iavuBq+4mr7iavuJq+4m77ibvuJu+4m77ibvuJu+4m77ibvuJu+4m77ibvuJu+4m77ibvuJu+4m77ibvuJu+4m77ibvuJu+4m77ibvuJu+4m77iavuJq+4mr7gavuBq+4Gr7gavuBq+4Gr7gavuBq+4Gr7gavuBq9eavXmb15m9eZvXmb15m9eZvXmb15m9eZvXmb15m9eZvXmb15m9eZvXmb15m9eZvXmb15m9eZvXmb15m9eZvXmb15m9eZvXmb15m9eZvXmb15m9eZvXmb15m9eZvXmaKKsVW4S4l8hL//AOBsS+Ql7ta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta6NVbEtqrig1OxTap0a7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wu1rta7Wvw/9Ba//wA9r+9//nP/AOh//8QASRAAAQMBBQQFCQYDBgcBAQEBAQIAAxEhMVESBEEQkSJhE3EyIEIwQFKBsSOyoVPBBZJi0TMUUOFyQySTYPFUgmPwosJzcDQV/9oACAEBAAk/AVq4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1r4ta+LWvi1q4s1PNf/eO8FgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsFgsHfir5juwO4MMbgwwwwwwxuDG4MMMMMbhuDDDDDDDDHgG4MeEeAMMMMMMMMMMMMeAMMMMMMMMMMMMbwx4Qx4gwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww8BuxV8x3YHwnIMNr1UKVDYpdS9Vp+D1Eaz/211+j50YjxSZU32mgD1mn/ANdLXmRffUHxzJRXateUPV6f/XDJKFWW+cVRA9j1mm/10uQKA2pVmB/21gN2KvmO7A+BSUBIzVV5IcitPoruWxS+0s1O6RUcibQpJoQ1hQVYic+5X7v+GbwNnh+x+/d/y6fFi/th7n6497x+7zn2S/du/wC57z/trAbsVfMd2B391PMWqiUgLmpjsH3tJUtZolIvJdJZqVMdeRH7vSaWn92n1dShAzKgNtmKTuVmn0wy27UbGrKlKsva5lOU5XNzjBdrqqFacqqWOOb/AFSweqjSEJqbgwSTsclOgOYZ+iQVc3J2WuZTXmy20IaVlAIXRKqWuOaoNR8Qsd5V7mNexzGvSHLwscwKuhdWesA47hy7VFyn3OZFf/0cp9trFmw7C/sl+7d/3Pef9tYDdir5juwO/sZqVyqLFUaVGYf3jd97PIizdaKVDFIyrOjsNrPLMkxkM0PVKNR2PXar/VU55AERfHXm5lqwq1KSvYUm1zyHVDTgmTNzV7XrdV/qq/dqUtaoE1KjUlmmUVOPQA5VRaevLEg0FOnFkg4uRc+jVZVRqqPpeu1OUqNPiqci5FkrtWam9yyRKMwtQojY9bqe+P8AFVi8fuepmjT1CTlRIQLy9RPMBBSONSycy6hzq6vZEk0SGopULiDa5jLDKcscizak7LXYmS/oYB1cg5B6o9YvUyyk+sqzhu1UsdPJzWcGkJ1EfLKkbDsLvEcg+h3f9z3n/bWA3Yq+Y7sDvwV7ntLvzpH0frn37un3PyoQ/tQ/sle7cpaNJD3st6jg5JUdWsFSSrMFU2P7P7913UpZ5EDrVDE7H35VZa4DF6aCRZvklQFqU40x5LZY0d0j1gN3rL97+2+5+uPe8fuf/Lo95ffmWEB6aGWQ96SVAWVfs4xCiReSSNIonoIwd4UC+8Ug8Q5YVoIARGVUIAemGSL+HGTVKzi/w7SFF38IBkmKNXJXAiv3vuqhCuB/tf2cnu3f9z3n/acZpibHKB/ddVdqmdOjto9RBU2NIStOG3dgN2KvmO7A777R9HeFEM28sg9z9YndclJLP8KNKT23v7SvB/ZK9269cijwa1JrgWanqvv3fYpfkpSPo/JjUQ7gkO0GJafZQ7vWX739t9z9ce94/c/+XR7y/Jzq/wDUv1X9oh4uuYpRTg9T2VvV2B6Gz15j9weq6lJ8mIZWpS1m9Sry/wDl/wD6D+zX7t36/f6YknsaKdrWhKReSWc6RtTd6eKkuRObCjFFD0BBUehqyj1Q+rjA8pRaVTK6LA8kKei0vUSK9rLFY4eb27Heq09m7AbsVfMd2B3+UKhpohausR0guvUq+HJ/dLUleYVBBsUHCvg1pTlFT09AfflWVMfD06KA/qL2RrH03Yybvsfv3fYhiySNKgzRMlY6npuaCoKFDRqovqylIxUq4bvWX739t9z9ce94/c/+XR7y/UX8r9V/aIeL+zT7momGJZjjGABchj00NAct6jg9JHLIm8yHM0pShOQAJFAOUP8A5f8A+g/s1+7djJ7/AEpNmLXyoFVHYA1IMShUKFz+ItPkiy1pX1J8hYo0ityUpdM5vp6deA6dWpFQeljoPnkFTV/0hrQn9Kby0dUn1jaXIpauk+Gxa+dRd1bOzdgN2KvmO7A79hYCtVCKp/UnaGClQsIOxqE2m+ykuHZg/wAORn6ZLHJyJ7sSbEpcZXNIaBIdDN3lq9ZZd/Vr3fr9+77H792yFLGaTTiqgNqD+zNCLnpk6laBQSZqE9rTSNP8OGO7t3esv3v7b7n6497x+5/8uj3l+ov5X6r+0Q8X9mn3MWomV7bbGFfy0xBzC3KX/mJzaEhNBXpas0sqitR6S71af/6D+yX7t3/c959IGUYl86ulwJyxypiVVVFc3lDoajKQlUka1H/DI/dlC9JNz9UkkCNXQMHJQC3KHVSjsDOadV2CfRu6BUuJH3u7Z48HegJLtzJzJd48wN6So9DV/wBIakowSm9jqI8fKZKibyfF/DRzKd67PZvwG7FXzHdgfBbEfo1jT6s+WkVCu0PTJnT60Sqv8Onr2NMeki2qkNTwD55z3pVd49mDsAuGDtWpK0gdJemi/wBZLSESpzkgGt+4BU0keVIJpa9NF/rJYAnRElBFdrX1gwIciIlKtVCvu+w7HHAhPrGUU+jUNRrepXWSlibNm7FZ+rQlcgkCjVQFlHp4qBQJ+Kl31+5woXF1KU1MgFoJcKEwpSoEiQG8P1Q0pXKVIVQqpY9PF/rJewJSrg1oRrANvdkH7v8AD5T0poQ0jSQeUVGqvYHAkpQjLJmWAScbXp4+p7slJU3F2rXGpKeD00X+slpCJk5yQDW8+jcielipxLUATcGDT1iWhKkmMoWCLegh0SsJyDLflwLFScL38GI43sDqSk5lKNuYXPukWejX1ZoiRISlqCSL3RaRh4tqWOVSaVZ54rux91XMPHyxe95M+WuToYoFitH5RoymNOO0sdVH65vLUVKO0+CBahjSxyRxDiWuSQ9Jo9Mk9triRGTfQOpNKX3M1SbRuwG7FXzHdgfCspYSpxJ4vKjsDUVHp3KsOwvJwagE4DcrlwLycGrlzXBzzQoKSnkURa/xCVQwXa9bHBNlGdEnLQub+Y1EySjMkcqQbzXcMsgi5h0qt+9qBAxDy8Gq1N1NjKT7HlHsZqo3lkFOyry8Gq65qswcaS6I7GoHtDy8Gu/ZseXgyAMB6GKlzIgR+pVGteoX/wBqMr+tz/DdSr+8QPo/w0g9JJPuf4aM3rLzFwQWY/8AFoQVHYkOREKPVHecYKvWVfuWpASrNUOuVAyivo1yw7FJNCfc0pVIUgqJuDQEyIOU0d1XttAZKCxmTincDl2sVWnnQ7EE5V9jtUm0eIdISyF6j6JaypciCKnj9zwL8k1dppnQel3jchS1YJFWRAjA2lx9Yv1l2uSONIxNGVTH9IenSn+8XIlH91L1cvsLmkWFWJClV9ruQKbsBuxV8x3YH0KxWO1KthenVPFsXFa9PMk9KC9HOsnBBaUpTGcyYbyT0s1Sm/pPmSz56UJrcnaXJ1UlbEyWV8yHm1Kx5MV3Fyx6KL1YrVcS4ZNXNjIcxaoNLTyapBLsjBylRvLoAwSiVIzW2A3fs5rAnNlTtcSUe/0f2lkK6N+wu8UI4tKVyyjlCvuYp1qs9Oh3E/RmkknIly9Yj1V2uIoKTlPSxVCLadLKTIBXJ0PCoHQx8KXmHbtZqqPkU7gbN4JUXQyY4NXQqT9makv16cbH5J3Xpu7HEpSJOYHYHJ/0IaY4ki8l1mV0XNQhRgi/i1qWrFRr4BzLNH5KcqXaTuwG7FXzHdgfQlFJ6GgK7LHCuvYHCr22M5E4Dwmxqr2bl0czlLmLUCwFPlcgPmqCZNsa8C0lMiDQhr6+If4a7eBaupn2xr8CgFG4VvakoH6lUevgzDyQqr1E+qR9lBHkR9b3+G0TcApdPoGIIexNSOL/ABGYIPkpVl9zrIrpLNM6Le1k31oHEpMarCpdgaiuXHYPSDRKfq0iMqPwzj0MW7RjuuTa0lc0prlA2OQ5EDliGwOgNKDoDUVKLQVwIHk3hg5iaUfepVXa1ElZqSWeVAp9zuF/YxWRAzoZsWmr8obyE2cyyyUae6u1W+8Gr/xEcC7waF90d6rWlKRtJaM5+0Vc5VL6NnjH6Ufezyo9+/AbsVfMd2B9JWKsUGLWXa7GWfCq1rNjr/eawfMimrjH5+hw/GC+9t7HyzdSgydCqWtKJ9KDT4qqH2FwqQraL3yo2qNgD0qtXID/AB1rIQD0Hb7GodaoUCvJR7HqZNRVVCclEj2vWIsF2VlPVA1Uk3qYSkLUcsScKv2PTlGnUDISuzMkYOPTLT3c0dD9XEM2JtPpAqSyBQVUouogR3U/e72rnuQs7X3toxfdIoehqjrjtYoMSzVVb2v4JRVKcGaBW1phUoW5rHchNXqFJB8lLBrIaJrt6Xcmx2lNjsSSadhteO7YX6mbwn9SH3V39rvzOQlCFUCdg8CVKOAFXplJGK+VyxJ7LXq+CXqZOAfdQmiRi7zvwG7FXzHdgfR7madLJUXYPCGGWQ1Blmruayl2SY4+ZUuOX/FTGb+lkrkUbzeSxalHN27Wjr5BZWtED2/s5RMr1TZGPZtciQPJTg19YrYFWAexqJpdSwNRNdiWP5aGnl38HIqVSTVQVcX1SZaVSi5ShW4NKutTHkolVyaU2talrkoVE+h2lo8PeDSU6XH1t/eJso1Vlp/5V3V8FiSBX3O0p5gxyJNSWeaVVPY4ELWU5ipQZBVsA2O0lnvhqopApTF337/Kjo9hp4Koy2oSzVdanoeL2kH6btSiI+rtLQZVYrLSiPoAaFK+jQgNSR7HKWsq7fBgN2KvmO7A+jm0u07zvPgLLU1762FrCZLqeZQF6hSswSVcqHqOsF/UQglJP6jtYEURsQmlCz2NVTi4ZZCcAyNPHhepxAy7ZFWnfIsFFAU7DRwRxKX3ilNK+h3vve5mpi24u42+D2jFpCknZtD54Fd1f77k818aTs6Wf7x8HqvakhyBEqBSqvKcqFH1UWsUTclOD2RU+m5CiOx1Baweki1kqUdp3+SSHsWfAaK6qoPsZqS+h7Ujf8eLp7wZSv8ASq8M5h6pYofHgN2KvmO7A+jd4s13X+EMbg0+NRDOZDWCD4dKCfXmVQcL3rkxxEVppxe4dRKn1pNvFxxx9KlPWJAwQmrXLKek09z00faRVpAHR6Ag+Yvfe9zXyeWsbehnlXyl7PCWkKBFqS1BWmTahO2vS++fp4bgl+Sl7LQcRuFcyrexmlRR0KK2kNQQlRoGqKQdDrQXp8GNXtofBth+7d6r8pHgUUqG0F2jZIPvZFSLFpY7Dj4sBuxV8x3YH0W/Yy7PBdut3JY3FlncfDIaVtDNu0ek2JxZAA8pTqrIKlWx7R4+97mrkuWsbegbr0moflor4jQtIrizUnw3nmL7taJ7GQnUJTYcXAKetWxnPqFXqw7GAZFGiQXCpHSm0NWaFCbGpSZFKoMpozmIRSp2+Dal+WjwepTdYFDKwVGOxSRh4jmgrag/czmSeKS7U7D4cBuxV8x3YH0U8qbN9/hDv3ncfMXM8hdx83eWUpqaVO0v2+a2lozKuAchI2IFwfQHsHivpYxlhXYtY93gvQSl7D4by8qcVFi3aBt8HcSz8aWzsDBtvOAdtLHGasAJTcGlXVJTWtLKvvLVRqVFIB2guRKwkcr7T4Ntj2Ep/wDOHg2AvYo7rFY4ukc20bFNBQoYsddGRXlvd+81T5ScWahV+KS/YfBgN2KvmO7A+iG2ljvO67wjeGfAfM95I83eWr4ERsptOLNZo7FdLuN3mdlrvUqu6/P472KpUKHoey44jfsIU9tvhvNzV8GI202qaqzR/UPuqu3Xk0diUjiXyxE2rNwGAYCcVG8uxAuG4VBsIeVQPkqcCErG1kGneLCB0s1J2+DYp3oUD4NilB+ud/PH9Q0okH1DVljSMoq6Il2LS0cuxYuO9XwVmix977yLfZ4MBuxV8x3YH0S7wX7rmd58IY8z3S7iK+Z7oavjSX9A3Hk7q+x27Qx4Qw0lkdJf8FHKjp6dxoiW49LvYLDDDDD7pvY+LDb2jf5Uf3h4eDui9mk8tg6Bi735Jt6Q7ajMk7rmVdWg5so8pgCgsQGbNg8NT7XIAex3G4jxbY6+DYtg95pLSWC8yT0POrtdSn1S0ZhtSoXMFen+qd9tUZT7nsO/AbsVfMd2B9D2eYPgv89ezUp8xtdyRxLNVLNezo3y5ZI+XtDnHBzjg5xwc44OccHOODnHB55D0B/Cg9Ube3wAyJFyxe5qdoc44OccHOODnHBzjg9QODnBSRgzVGaw9G7ak+C8s8qBU9LNqjYMBvPPCaezY7rxukNGST4byyBQVUppSnThVxvIeGYeLaij2Gm+TISqoc44OdPBzp4OdPBzp4OdPBzjg5xwc4IIpc1Zo62Ho3HuL97xrvwG7FXzHdgfQ8Hez4VeG/efAPMHlX5i+51EUR4n0z1VeC+4OojjtV0nwHllGV9h8wLE3M/qk/Z3lQD9Wni2Eh7JD5+5aK8H5Sd+A3Yq+Y7sD6Hh5oMbzvDFN5p4the0eO4sAahI/MwQoGhB9L9VXg7p+joNQnuqxaSlaTQg770KzO0KTmHmLAlOZTvWqr9avB7T4thBflAHz9yqp+j2Gm/AbsVfMd2B9Dvoxd4j4CwzvtO4WsWsPb4r6uw08xc0jrxeB5TsPpXqn3eE8vuYH8wkfm6GKEWEb701QXsPixZtlNPZu9VVODu8XlJflJp5/wC0D2KG/AbsVfMd2B9E8u3wXOrFEh3NVuDu3As7hSr5i9rv8zcm3zY+Gs84wPpXqn3eL2NPKf4gHv3+SoHj/wAHtt8WwUZsjTuuCqH2u0pt8QJG17FU8/sWPe+g78BuxV8x3YH0S+N3bg72LWaNdGSXaXc0VZyIwYzF9/ZRisqn3j4r/AmzHzdqVpo+8g09J9U+MVChQu9J4jd5UdeB/te0eLaXsVl4b1fHRYK+UH7UsEHp3JKj0M5U4C9qSnBIvL5IR3Uef9YP1RvwG7FXzHdgfRPKDx3C3cN1KssO5jeMymnzVjHMq3zZoLyxRFw6fSfVPjvNrAyJ5Qcd32R94eHi6XtkV795IULQRsaSseuL3PEehTVp+IcyD0ItceQesprK1nafQMX6g34Ddir5juwPoqMq9p3irTuJZLtG4+BQDIO4ujUGQdyeYPYxWMWqYokCnm1f/ooe7zqSnMMw7PO+qfEOwNXOe+obBv8AJRTif7HsHi6XskV7/ScX6g34Ddir5juwPooteO4WMs2biOLWKu7w1aSw0MUdXWm8WsDm82qslyljyXad8aiOxxL4OJfBxL4OJfBxL4OJfBxL/K4JFHsdLLRGPvYCVp7ihscKlp9ZFriX+VxL4OJfBxL4OJfBxL4OJfBxL4OJfBxL4OJfBoUBlN48N+DVWe4keSzUm0neP4irPY+zxbC7icw9vnY1qpgHDIP+lxL4OJfBxL4OJfBxL4OJfBxL4OJfBxL4OJf5XCvLW1RFAHgE78BuxV8x3YH0Xa8fB3msxxOQ2XVa65zSx7R4QxcGTysgrGLiKTiyxuwYu8zYGtKEi8l1RFtXtPgvNzA5U2unBpDAYHB04NIY3Wbg6cHTg6cHTg6cHTgwKMB04OnB04P3O7dYGoJAvUp1THcZNp7PBeXelFvb47lBiw8p86OaU5mscGsflLWPylrH5S1j8pax+UtY/KWsflLWPylrH5S1j8pdVHoDsSLk78BuxV8x3YH0q92packgfNluDSAPCHEcpsLPIrYWr4pcQPgw8VgamS1oQOksdavHY5CcE7B4R8OLmPbs3XMCSWtowDNQfpuuZB1J2+q+XUj/ANvNXOh1Cu6nBkJ1Gw7FPhusDUWS1ISMVFjrl9Fzk5diBcPCOSPnL2+O8F+UKpOBYotJoR5u9anZy5U+gYDdir5juwPot/oIY8F5e13HwU6zJy9r1C0qBoRQPVyU6DRrUs/qNfFaS/4y+ZbudDqFWJT97UVLUaklmqT3kYtQI2jBkHUK7ow6WoqWo1JLUUqSaghkJ1A/9nd47nbIbEJxLVmWpmhFzNJvJUfK3d/LZ2udaFpNCKB6uT2GjkUs/qNfGKSy8x6Bsd1w8wbDc084/iJG0ebTSSQctdiX3Ee/0DAbsVfMd2B9E2Pb6Pe73t33P4eo9Ybe1xkYK2Hxj4aO4MTuRnWE2JxZPWE2g7OjeaI/xK3UdStRqFbCOjfVCEGqljYzWynmK5VfwyLqb77ycOlrKilNMxvLufw59ixt7WggbFbD4x8CM1V0nB3nzXe97TVN6ox93mU0hFqUnyv7H3z9PQcBuxV8x3YH0W8ejh3nw2hoStJ2KDVT/tqcakHp8AKdODzK+4MBKUigG8ATi8eswUqFhBYqo39AYt8pWJY7FbQxZ5KthYt2nAMXXnHzKag/R2xnurxacy1WOnWG1asXdutDQlYOxQaqf9tTiUg9PgTZ5StgdgF5xLv81YXfi/hTHyk3FwlaPWRa7D4IVEHyqWOksnq7A6Fd3YzUn0HAbsVfMd2B9FuPo9z2eO1oStJ2KDkMf6VWhiMjHM5a/oR+7SEpFwHhATqfmdDOrvq3pqNhwfMs95ZvPm05kn6M9ZIo947A7vDaHGlaTsUHIYjgbQ+rUMQpzAJ9VH7tIQkfV3bB501TgWMp+jihX00DhI7FFxqP/WXp4QRtVa7TgkPkT0eh4Ddir5juwPot7v8AMqo12hlln0QendrWJlrVlVIO6P3ftaPq6Bmp9BUeLWrizX0XAbsVfMd2B9GvezzNimXbR2J8wP6VcRQtfVSo1OQKwOZnNZacXPAZPVzir4f0nAbsVfMd2B9H2+ZP9LHmrWOQyJm40Pvq4ZItELKR8qfara0Lim7wNb+kFnNqNOerUr1hsPmrB0u7H0RCj2Bih8zgN2KvmO7A/wBBLHmdv9AlB1WTOUDYOnzUxjSvMlWBazJKTUqVbVzoRGmwJTGA5BIY+7y0dypAkewf2+Z4PLPrFKCSkGyMV2voPodkYvLmTClZypH3spzEVSoXKYooeYwG7FXzHdgfTwS0VcTjaWPFs/oBrqhyyS+p2dLWVLnQoFSjaTf5nFiphkCvZ4BRU1Zj7TZ9KPHxkCgqVK2NVEd1Wox/uskqzgkntfqD0Lyi7hYhG1SmqpPdTsSMHml0ajQbSjsY5gMwPmMBuxV8x3YH0junxDdewHTzF5/oFylBXEPvxKzDpaFpQqwhQ27fMhKgRQhVxf4bpfyP8M0v5H+Gab8jASlIypSnZ5j7Cu/bEPdvFSykNNmPnfJNWgSRKvG1LBl0ijySAfQuP4pthiV5PSXafKPmMBuxV8x3YH0nZ6Dh/QP8SEHhZuSEJ6oJKRsIsP18SkrTaKpx8HscpjCP4sqbycA5TJnsilUba4F+3zG3TL+XftgT7t15axHEgVUovQx9QPtDaeFzHV6hI54VH6jEPuG7zQqWj2VtdhDP9rydKFs/3li5IeQKXYM16ixQKsPjwG7FXzHdgfSdvoOH9A2pUn67v8KY09o8Mn6ZZ0+4NVTGrrE9hve3f/EpkjH6iyStRqSzRQtBZ/zMXw5Rj0+3wgnf5UKh9N//AC49269VzX/k9OaClylbTuNFINoxGDIKJkBaS7/MCqiyM9LTsD5hEnMJNi8aO5Y3WRi9TIGxEYvWWsgRSAojFyUu0FIkT48BuxV8x3YH0nb6BcGainpcyZFQKyLA2Hw+TKRxG710n6eBOTRy2SzJvr6vRuPLMkxnwTJj6uTMc1xci5Vxfx6+8blUi1Qye3Z4ZUxRlQQCcS6E0qCNu71XsURu+xD2lmk0nw42kyTSKoBiXAmRAFVdWqpG42wnOjsN/wBfe7lW79rzVxq7Um4v2nB5q41awALVLVZRqKNELFKFhk/sZohS+rV2Gx3pO5IUvJVIuqXUToOXq9iOgbjUoSYj7HsNPFgN2KvmO7A+k7PQMGoqItTX0pX+dnFB+gYskwrOWUYhmqVCoPg/w5Uq+7d+g+/cWWnNHImhd8arDiNhfkzJ9+4hhpr7GmqVgpUk7Q7o18pxTsZoqNQUPY7pIwveQmgqonYzTRw1TEMelqrNpu5Xah9027vJmWP/AGO77Oj7Gr4WlFD0qN7/AISVUUcKilfq1JWhQsItBaKabUHmA8lf9rPJNWJXtu+rUAQ5U8HKng1VVjg5SrQQfCkANisS1ggjMhQak4qVg1n/AP5iT1OX9PrOkmnnRs2gu0JNUK9ZOwuwi1mhnhSriHKng1hadnQ0fERyzU2jHdcib3h4+LAbsVfMd2B9J2B7fP4O7NQu4ivpB5IxYMTsDPOs3YDDd1KkRDKCpNtGnTfkcGmk9hD0Wl/9npdOiOWlSmtb67o45OtACguuxx6ZKcMtWnTfkadN+Rp035GmMShOXkFKv7RPveDhilhVHnUFX3vTaiJW2lFByTf6bj1Mh/u0en6iictqq13fYgbtjVzqtnUNg9XcaIKsi+wvZa8X9uv37tlR9XYmJCllmq5FFR3apaUeobU8GIFRkg1CKFnnjUFD2NOm/I06b8jTpvyOcRRm8RJpXcsS6f7KS0DseTTwHvJj8rtO4DUaQf4a9nYXplwzRpKV5iDUbk6fq4kBCao2Bp035GnTfkaNMY5UlKuTd9on3ePAbsVfMd2B9IuciVyKssNzNqbvPm94uVPXJsIrb6RGJIlihBdV6JZ5JMOg+e+0T73g/sB7z4vs91xYCNekWH1+gtBRKg0Uk7jVZjyL7RYXsU/ta7ti1D6s0VOoR+z0b7RPu8eA3Yq+Y7sD6OsADYxkSbCpmp3Hzxs3LKVDBjMPXDlSoHpt9HQFxSChdoFqFesnYfO/aJ97we2D7z4vU+/fc0f5mEVkp5acfZuP8Kao9ofrVe0g/Td5dV/V93rTXh6N9on3ePAbsVfMd2B9FkCWmg9YuRSj0nwGxkV80WQz4ZFIV0FjNH6wvcqVg+jW6yMEqI8kHYfO/aJ97we2Mj6+K/qq772tIhjRVZVdRpKIFLJQDsFXdyfe8A9qEn6MVUs5Q/8ABjCXTrh8SI/qDSUrQaFJ2bx8OuWvT6F9on3ePAbsVfMd2B9CuclVD1WnKPWLWVE4+Mu0Ows+CwMZlBijWz5iVSCOlozD1k3uXm9U3+hkSa9QsT6nSWsrlkOZSjtYJPQ4l/lcMh/6S4JfyFwy/lLhk/KXFJ+UuKT8pcS/ylxL/K4l/lcS/wApcS/4ifJ6Xg0GSTT1qgXkdDhkSRsKS418GhXBxrP/AEvTSRQV5pVpoAHYlCQhO4WYtaUISKqWoslOhQf9Q47h/FlyjsA3eVEGimnhPw6+Ur+x9pfd2FlMOt2q2L7X+HzL/VGMwPBo/ktMLVLlsNOxj/I6blQftDtUWCTgHFJ+UuJf5S4l/lLik/KXEvT6Yd6VaacMXp1yweTLGKguKQnDKXGvSaXapYoo9gcSp9NsljFeODik/KXEv8pcS/ylxL/KXEv8pcS/ylxSflLSU/ETeOjx4Ddir5juwPoBoGeskGwNZQjAM+cPgNpe3zq1IOIL+NH03uUJXgpnz08cSR6xYKK2GdV/sDUVrVaVKNSdyfgwJyprtUf7GlPBgcHRgMDg0jg5YhqVjMI9pDSODKI4kCpJakSRnou7WkcGE8N+Xgwjg0x/lYQOwblF29rlE0wujiNWrq9MDywpNg7cdwqtRoA740VV0qN/1e0M5dHHHReKrbmgIiQKJSNjFSellfFqUR0vUoCvUBqo+xgwaLamvMvt3JrHpkWf3i8oV2Mp4Mp4NSeDqosFLUng0lR6bmChTUng1J4NSeDUng1J4NSeDUng1VOAD8o18WA3Yq+Y7sD55QA6X8ReOxykJwDPnr/Bj6Aogv40XTe5kpkPkKvd3mpCFxmsiEiqlDoevmQbiKZS5VyrxWqu9BXLIaAO9Iqs4q2+Ki9WsUjj+89DmX/MlWbPW0FyCPUxpr1huWB97rHoYzyI9b9RaqoPfiJsU0LSiQd1YoR5jF6lf8qpR6paUDKQ9dOtJ8nNQeBP+W011fKW9tp3It7WeZVr1Mxk8uELNe1P7P8AENUkpsIUq5/iGpUnDOWSTidwJUTQAOgnX8SU9OHse30fAbsVfMd2B84sVwcQ7S1nLgPRdh9CJBxZ61A2KZ6mQ43NQUk7R5mPqtRsmjsP9rR/OQDbGObgwQRsLjVJKs0SlIqSwDrpBd9mMPGer1iBySY9BcKhqAcoTS/scaV62VNClVuQYNBMPekhHk9I6Gkp0CD/AKhwaQlIFEpGzzKESIVehYcvVH7Jd3sL00kWCqcp7DuSUacH4kxFif7WKRxinSTi7zvvf5nSDV7JU+V2uAmHZKgVSf23RLlkNyUJqWB/MC2OL1eks/3vSMBuxV8x3YHzSqMZR6xaipXoZsamatL2+iyFcW1CmoIm2oPmtFBIr1im3i9JDCfWSm3j5i5wxqni7iyLRvSlIFyUig83zBpSpBvSsVD/AA/T5uyxpQhIuQgUD9g8VqcC6Ct4U9DoyT+gOOCEYRpA9zsGPpOA3Yq+Y7sD5mipPc1E+ijeKqLFFD0ZZSsXENQTqUinb/sjAbsVfMd2B8agHyIxZJPotxdqdu/Y8fR1FKwagh0ElwXj/sfAbsVfMd2B8XfNzUSMPSb9wrR4+kGhFzX/AJhFlu30YMbhVhim5Jad4qWn6uw70ktP1YIO5FO1oNOjcklo+rQQ0EhxFxFxKd7jp2uM06N0SqFwqcKmCTg46dpcZpj5nAbsVfMd2B8JoAzy7PTFZa3+lKIttflCvoncjF2LkljB7sUH9lrXJKgHninFv7s1jlFXlEwHPKRXK59f1N+epyuilrsjlpSpwLPw4Rma1woJ5I4O97Te5p63mPUWg8WnJImxacDuIOrm5Y0/f7HrdQuNazmSpZobD4ClCkWLlvIOAeo1qYlXLVXKeLCU61CahQ8vpac0pOVCMS5ZxtEenFKcGtc8YNFxzd4e29n4c1/QwEzJHPKRXK5fxBUV+dJNGRKiU5UyEUIOBcqo5OtAzAVsetk/In9nrpPyJ/Z6hcsAjJNUileDSJNRIqkaHLqLLcmnFAODXJqIa0WiXvD2s1gnooUepMUcaE1AAvveuk/In9nqlyQkGqSkfs0CTUzLPVpLm1SqW5YKgDg1K1ENaLTJ3k+1msMwzDzGA3Yq+Y7sD4TyC/8ArCuZPdr6IbFqzH2Mc4IQCxRUgUlXspT3s2QyVHQCHNMJFrzqFa1c0ScseUQ7bsGk0RKJFH1QDVqUlCr8po5ioFNM0hHIO1yImljJKlp2DBgpTMeQHa1ZYYxWrBCEpJGEaA/tD7jvujRV8xnnGb2loHV9TYPYz/iZD7bH3MpLA65UpCj2UaQmWVKgum2lP3ZsjWFD2tJySnOg7CHq4o0JjoYjYRZdRoISufOKeSmrjRIkC4vSwhIFScrQnqUKyICR3lYuh1MprKpnkgQEgdJtLnQieYdYoAVVb2OXrJyLUg5a+xoUEQCzMzyKmNvRV6eQpApn6kUYgkpgKEOaSNcYoKWUepQiMnN1khAKmM6DRIIHeOL/AIyUivR5jAbsVfMd2B8GwPaf6wbizYoV9D9VT+0+535le4Po9xYL1UYUvuoIwFHCjqs+WSzmHtfMhYzBq6tUtlVYORE8IVaaXHpDSlE8QqMgoCGfgRKoojy1OWI6qWMqkOYYXMgASG09heWZKE5qA4P8OVxD0qoVDTLXWotsf2yX9n9z/wCYT8zodVBalPrdDhqhRqqNdlC4smnSerRS7F3UT97jQpERopZFVV6HLFHIoZhEb3CnIVZZbOZPtZqiQZgWaT6nlT7f7H/D0w5f7xe0/c/WHuDnWlMhogJ4OZVKdZFILC6JnXGUKV0vWI6gmqikczlk/mUDaahRaiI5VCORONWhRCuawOdMKIgScwvqA+qkNKoWU1BH3MZZEcq04HzGA3Yq+Y7sD4L1Wf1pXMi70MV6pVFdALkTH1tFJKjRrEggScxTdU/8GKHULzDscenRHFJQ0QalNe3B6uIR5amqrWkkTScgxcccksKEIXnBIFnQ5IY84+GQMoc6ZZ5iKBJrQVvYPVoiKSekuOPKpZUOfpaEZUip53QyyGibWer61RtSa2EB6+f6PUyTKljMZSqlzHNpprfYXqI1mSKiEhVpLFRGesV0APTmYLVkqk0o9NBDKju9aQcw9rUgxwVKsl1SxQ6hdU9gYtRqCrtGar1cYiCakFTtRJJy02v+ImNKVcAH3Y4859v/AAdipzmL2KY+FqEC39Qs/ZzphmgNeY0qKtYkTCjKVC6rjzzZVSpQdrhgi0qjRZSDUfV6mNaVJqhKTf0MV+IFK6AL3HCYZE99aSTXj2PUxxaxB5q2V6Q5BJ1CSFLF1WKJnWSjspSvmMBuxV8x3YHwGxP9aNAuz0NIVDIKEF6mJUR8mUkEe16iIRjyIqmvtYyxxiiQGvqNYBTNSw9rm0hTjnV+zlGo1I7tBypaQqGQUIepjyG3q5dntep08UW3ISo+5j+8vaS5FcWvmWmgq9XCpESiogA1aqpG68OQQayltRUK7XNpAnHMT9zV1urk70j/AIa7jgXPp5YtmYlJepjyC3q49vtYyRRd0OQafW0oTj2uTSqTjnP7OdE0yLUoT3Qfvdic3B6uFEakpASoHYGpKlRJANNws8heD1Omli2ZiQfc9TEtKbeqjrQ9rTSBIy5eh6hEK12qjV3a/c59IhGOYn7mrrtYsUK//Ln2okwL1Onlj2ZiUn3PVRdWLckRv9pacmnjsSPMYDdir5juwO/YGbz6cKembFPaK+hlneo7zRk+A+FSqdu9ZHtZJ7d8i+Lt3E+BagO1knt3GjkUR271qHYWSe3zOA3Yq+Y7sDvNqvThyC9poE2emm0CnoQqXKhHaWpKx0brBiXqIirCrFmLFS5EI7S1ok7CxbukTGk3Zi5ESJF+U+C8vURoVgSyFJVcRuvL1MQVhV0OB3LTHGPKU545CNgO/VQleFXeGmzHY9TClWFWApGI3zRxZrgouRMkd1U7vacHq4s11Ku8eYwG7FXzHdgf6DRKx9fTtnoQB1Mpyxg+9qXMsWrUtdAGpaVIPPETVKg/4ciczkUjTIXkSmM98uMhAFVZV1Ulr61Kk/DWq/sdDOo5I64tS5li1SlKolLWuGUWjmqlQacsndWnpcyYoxbaXVGjiPL+o4v7X7hvFrlC56csabyzas2JFyRg/sh7huodTJyxpOLWpUi5ApRr0v1HdtLV8CL+IRtVgz/hj3ugSL1FrE2vUKEi0I7f2aiSZal3kgNXVyZc0ixeBg0KVHeCpfMrschXpZVZKLPcJfdNoZCYIhmtZIhTyxpwD9c+92ksj+f1As/T0tRNZk+94D3eYwG7FXzHdgd/k/1y5Q9C7qY6/V2KXMbeDFq4beLt6qQp9j0aUzpOYKGLzyak1iVZyjYWgo00QNFHyj0PTiZCTUVaOo061c1LbXEspSOrQKcyjV/x5FZ1DBpP8uIU1Wo0SDUtZkmkzGRWzZc/tfuDtaVcGCOVkwacyqNVGqiK7HXq4lZU17H9mPcGQmCIZiS6iKtEDYhGLtTFPkHsLtOVq/z04/KMXUArCY/1W2l/Zj3sKVMqxITfsasuVBUIkm2tNr+1ewVdvxSB2Cx2I6qhHsdlJSQ71xgqPsDPwkGkpT5Rwdeumj6xYwtufrn3uxCByDF1EQ5ln1U7A/t0+94DzGA3Yq+Y7sDvx/2bi/sfveyVX3O/qj72O9KafRigo9RL/NqJXzXVcqlaXPkWhRqE9IabC1rjjSrMcpc8nVKVlrWikntZzaiC5eIa3gv7n9r9waUmRHrdrg0/AtEaOqAKcgxr+zUaYP7T7g9sY9wfLEihk/V0PWx/zktq7DyjC5qBiVOVhXRVziY6WLMoJBsc4hhWqqidicA9RGopKQlCQbg50xJWgAE9rlzQzCoair4R9xf2r9V3iZXvd3V//L+0f/8AolhShHRy3vUoSYzVCFVNVYuZMqER0JGy16hInVIaR21Ntj5NLp1Zf7ysXrozMoVkNDaeDUExImCirAVc4lMdiqXeYwG7FXzHdgd2D2nxjxjzgYY8wGN4Y8IY3jePEHsLw9BFRHyr6KtRRGVZ0KpXtdTClIjR0s5JlJKjiCXqZ5Ook54yqwhrWudSf4eU3tNskmZZwFbXPJGhCqS5MMXNItKzVMiqqp0OqoUKzqWRStl31YKUycqOndgv7n9r9wcfWQrvD0A4n93p+qVIKKtNu77T7g7gge4PXRxiSnLlq/xGP8jVUok6vNTpesQf5uMJHL3bav8AEY/yvVplAUBQJxc4i6tIVUitXIFqhSEkjsf2Z9xf2rusq0/C1POk9O1rI1enRky5Sasc+olqf0ir1KIBAdtux/iUX5HMJesTmqBSj1KUJRJXIU4F/iEYEiyqmW6r/EIzQVsQ1ZTIsIrg9QmVUpqKCmzzGA3Yq+Y7sDu2hhjwBhjcGGGGGGGGGGGGGGGGGGGGGGNwYYYYYYYYYYYYYYYYYYYYYYYYYYYeHoKQuFdhBeqXAD5F4DkOpmT3c1w9jspc0mLUfaJvf4ivJ/dFXHWRXekN5ac8S+8C9SrT18m8PUr1FPJuDSEQpuSN2oXEYQaZen/g5lS9YrNzeC4PWSJXKakClGrMmJOWu48r1kgWtfWEVFK1ZqEppXdKYhmrUX3vUrkVImlFblZRKnLV62QriVmAJFH3djRmTsXg/wASUmPAgP42pUKGRV7Npvex6pcao0ZaJcxlGatTuVRK00q9dIVRrzgEh93Z5jAbsVfMd2B8AYYYY3BhjcGGGGGNwY3BhhhhhjeGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGHs/2FgN2KvmO7A//wACwG7FXzHdgf68KsU80P6GaJ2I2lyjOBbGbCO0Owj0TAbsVfMd2B/rPKGrNT27hVrADT18u0jup7S+95naxnkV5I97N7FD/QMqI0ivMWofy8SssYSqo7WlQ08aSFq2XXO2qrKNHL4JKayRBWBXB7PPYDdir5juwP8AV7heWlU2p9RFpc6dFpPskHmU4uq0aRSOooVdL/hgvTGaQWFfkh60qSk2xRmwONI7Hf5qsS0+UMMGkKSjvr2JH7u8C30+1VyEbSXrhp9ObUaWNYFB0vRRzEbSc1XEnTxiyiRR4uTNp0hJQhWyo2dDTy4h5OtmWI4gq6pf8qhZWBGqJRt4sFQ/l6KpsFrTyE1qXq0nUEVyIvZrlNKuM0xeqQhSjQIBtLNQRUeZwG7FXzHdgfTRZtODA6xYr/xfcNoZpGGtKli+iSpp5wK92j2Hf/DH1a09ZGaGjTVQaSPFYgbWrMO3xrEdh5js6XplLUTz6qbb0uc6iW+iu6GKIffIsPa00oh2qMi6+bPNht7A1K0mi2RjvK7WhId/mdrAMgTmLHJWw+h92tr1UcOjiTyC812l/iZFNqk2e96oy6OAZQtJOVZaFEFVbA0hU6RVCVGj0iNKhaQhaRqbFUuutepGpWo8iQScnRUuM6nW2KSU2CH9SjsHva5dbrLE9Ys1ydmD2aV6zUCDZDEcg9pFpeliTidr1aEamS0IJFr1cunhSKKEVAVe3Y9KFzjy5TVZ9pd58zgN2KvmO7A+hXqNHJWTB+0sp65Q2s1jVcx4I1W9FjWMuAaRLqJv4aRbXpcUv8ws1z7OLUFTWW/e15M1ij0bXp0rlNiUXqUXGmFct0Y8kYPaatWVD50tRjloRZe5RRHdym/tdLrPufeN/hQaMgSUZUiHyULv7XcS7trNqb7d+00f8OQlShiBsaAmgZru/T73InKEc1tzFOtKlj2mzerKDc7R4vJehm1EcXLFZy9r0fVKpU293eKyTKCQ9or4rANpZFz5utsjPZczmoSAql/nxYMWkhgknY4yA7SWpUk6rI4haSXN/J6G8adJoT2tIj06bLNr03WpmXRVl/R2sZVLTUjpcKZ41rzQpVsGyj+Hr1KEojVZQU/4ONECEpqtVb6PIqLWS5OkWF+RpQ5FZYahYT09DX8XULBSlWyxolEycnUqB2UalJ1yUiSy85WpQ0aISlNRQKNRs9juqaeZwG7FXzHdgfP7XJmKRaKbvIFjuEmQex0CF3OU9Uo5lI21ciMybQklp+ECQlR2027jlQNrWkpTbU3B6GYxHuGlpaepgmNqj5CcA5OsmpSp+5oACbau9FRm7HcATR/F1UozD9IwD5Ujyd3elUEfu46qTQrrh0NJQAnNbY1mqfY/XQPruB3SUWXaE3dLiV1AVkNnNVixXeSbmeeQGgdzsctdRMVKpjUu7ZuxfqreAaarlOV3Ka8oCDIfcHCUIrzLN1GcqUigYrTaxe7lzJJ9jupaWvMRs3pPBnL2sVrsac2qlsQn72es1Ulq5DtZzVvpu7iE1Hba8GKl0MkhyjtYspXsab3JVeDqmQBRcvV6RQtVtUHNkg2ppaHSgFPPrMepnUKKSbQ+bUxDMF+sHTNGk5auXrYdQcoqBynY4+v1yrcoty9rXSaPuBNyaNOTUKoSndD1ySrnNK2YMdSrLmktuac8Okh6vrR5RJcph14FFDNlzYWvWV00fdhzXnE0esEqEn4KO19xOnjRXpLOcFebVSpuSmtSGSER+VsBYTqfxSTkzgV6rEtQl12QIQgbDiWSJlJqsfU+/wA1gN2KvmO7A+fuFlX3pipQGFbvpuwD+2IailSrTTBxyT6rup6XNL/MKtXlNnY0UhFhpsDvLVlmnUEVF4xL0cuo00YzEAWKL/DFRlZoM3/BkCotsZJL7xBId6gK+9iqstwcizEo5Sg7GiqSLaPF/ahriM0d3R2sZgoAcuDrRSTV/ao97pljTWpejlREbiQxag28tHnQiMcqsSxaUgqaEfzBsrtYzamU5UJvaldcRROfYGqqFqtfVpQrvKJ2dD6oGIUjTGmgS7rg1ZQbmCpS7gL2lXVadBqSNpd1X3dPGVntNnud1aPOlJQAFhqzLQopzYvuwoMh7TYPvafiyWJNLA4yFoNCaWE9D9cu8Js7WtSkzA1qdrF7PNsGPY9Jy9K7Wgw6WC1VvfVg7kCjQZFqqI0j1Q4zqBQqp6jJXALSpWw4OnWjmL+z/d4MZp1WJTiWV8o5Ar9neAaOip8lcKl5usr8RKu6A/UPuZovIHns6Xf58FGpjHIsbHdAOrUemv8AY0FausqtKbym3+xxSx6pSvh15TV0m/EJu9U1p0OHq5kGpSLArtG12Rp7o3IXqSbUxpD6v8M0G0BdVK7aMJm1SEk1Ue+rpekH8yhWVK1DKs40TcXCmKfYLicDTY0ySZTyoQKmrjR+F6WU/EUVVkXwuaVSSXySUqtZaU/hmj2rJrKodgucKY5pLF67VHn/AOlIueuRrfxNPPkWe7002vWoknh5SirvFnmcBuxV8x3YHz95SXanIi7sdpZyVFbdgafiTKMmXtLlMS0JpWrT8ZVtT0s5keUE3kNWaQiwHYMHImo+jR8EK+Ek4BwymXA2PvrHIn1UvbduuOT3vusZoz3uhoSJY6yrIFwo4irTKORJF9cWKJVaroaqLRzqV6rrJr5FWW1PaXKCUpAy3kuIQJy5Y0bQMS7gpKmooiRzzCl5FwcPwz35VC4dDSEgC8spXqpCAgDHFitAA5EijHwxywg7E7S7ORVHVCkgA1Fj1aR7XqUq9tXVZ/SlwBGniNec94sIkmUKJSLQkOHq69FHfR97lp2B97M0pyAVNWnKmVapAMATYzanKA0Aiu1pCYk7XaNIklR6TsaT1ZchkihRQmtaKwfdTc1EaGE5EAeViwQgXnM09UkWIOxTNuU0Luy0cXV9YaqkCb+hxo05pmV+7FDOaprsSLmOWCIJ9pawEjG4MV00HLFXadpZ+Hto7BJIhJ97ucPxDeWc0+oOXsG0tOQRUrmHecBSq+QL+5gpqK2jzxEcQtKi0fzOqPLm8kH72K6zUkyTK6Te9WEqP+GLa+xxGPS6NBSgqvJLJpWzs8EhCXKojtaiC10p0NV1waqRq97/ABdadDMo5RHapWAy9D/FV6rRy1MYtGbpIO1yKA2BrK07Q4JtXOu3q61SK+Udr0X8tqpxco14YB3nzOA3Yq+Y7sD5+1WUuMyRC6mxwKz9CaMdXoYzUpG3ofVJ6V7HrTKlJrl2M8iMMWaowOxmIE+Ut65S+gCwNYSqCxJFtHN1iU+SHZGm/faUgHg0FWUUzAVq4bdhIoGT189preAwgS02fs8mY7V7H+IlK5TVZSLXrZusN6gqjT1k3rHmLGVGDNDSjmjEeIvdq1G07XOIUm9QFT7HKZZ/WWal5OsN2a567N+lIsDuAozYoEOZCk7Mz6r8zmjSOi1zKk6K0DQlOxCBtLRl1CbkYtGWZIqRsfSGKpXbTEFwSZ+xjqtIk1WA7gKMVSsVIPlBxLC/7tXCUqXYFG9qzTycy1Yl6hOn0/6O8XzLN5N/aWf8zPyjoG0uRKV5LE1tciayA8pNpcnWISaoSdjvKTTtaCuGtelLgXJ+kixjqtAg2pT5XQwMqNn3NKesOOL1oy+ogWBpzZe8raOl1Vph3VKv7H/hrCrHGSoCmYW1cBriqwMkyLHJXYGhJWg1GZgZkdNK9rsjGHntTIiEDmiQaZu16FGcXLIqeJeqGlmJtVtA6HrZ9TKbSSu9x9XFtOPm9MmeNPdJaOr06BRKQN5qn1S7Ei4DzWA3Yq+Y7sD5/wDhL+jnEea0ppUPUmQDye6GlKQLKi4OZYHa5FH275VAdrkUfa0Bc1CaYl5pUrPxAbku8pqd/wDDVdVzJEarcqtjkEsgurcHZEPrukUA5FcWd5IcquO5Rp27lkdjWo+3fIpyFyKZtYGbHaOkPmKrc5PNVnNIdpvLPNWrOSZNyheHqvhj1U0aQD/5e+9WrOSVNyheHrOXoQ05pPWvJZphTY1mm1oM2qV5A+9rEmsl27EjAOQqjWrN1te65FSJN0xNwaitdBUm99w3uXqlKtIpUF6jOkeSBRpCUiyo3KIa1H2sZkNOQOmRVlrmT1Z2L2OQSEeT5LsjH1/p+A3Yq+Y7sD6AojsLUT2nzHNGb0uGkir6gBmqj4JFAdrUVdvpSiR2+BR477i4xmUak0ozbsZB6XQ9LNSdxIaifMSKA7Wont/qGA3Yq+Y7sD6UizpYoobPPgk9DBB8wkkdA8aSK4j+ipVlxpZuFSWtJWL0sUPp+A3Yq+Y7sD6TOiJF4Sra9QdN+EJtQgGipBiX3bhuBp51GfVTWJJFgcJinjsUdhPR4hUvUJCtiBeXCNH+GpHKZbFyHoDuXbTwglEIJoA9MRmqqMp2DpdtD/Q+6LS9Nm0YPVGzmJxdgUK0wdK05XPkgrVUgPKpHq0asyojlKxdX0/AbsVfMd2B84kZdtt3mojk3zKMOnFeprRPteZBgUU5OjZ9HyoHeU/xBCJY+9mVQcTewlWigTRc2wqwD7tbHaXlB9WtrHMbGkZeg3eYh66M/Rx1IRVSUXRjpfdBs8K4opF96aU2IGL0kn4t+IeVrJ+4D0PVfzOqTaiJPcj7A/YPCM0ar0uERSalVkae8snYGKFQqR4Q1FU0KQVnBosdh3XugOG3dS6tNvjolOJd/iQVdjFD473AiKVCbZFONaM5ojNeoNdPVjF5PYyfw38LOz/EkH3NOXTx2dvp+A3Yq+Y7sD4hVRYsO0NXVwpvUXIJoD5QO7Za9TGiRc5jiSTbQYB3jxCpYHVJGauxxhItUANocB6rN1f8uoUsxdASKkbhyTjK1ZoowLca3fRq6pM/8WYeSn+168GE2hOXmIaMkSLD07hVV0adpOx9aiLJ8NKrBToDvoVPUxjVSyyFKCq2gUaWexrEcEd/S/w6aaNN6srrDqQK5FO8eBObW6k9XCOktRn/ABCcVklO13sitK5d+0sn+U0KElUYNilG232OJMMYwDJpeouDMoVHWbLHcD4DSKEZiXU7dNFsQnYe1+zcLAxREKcxaOrMqAo9FQ0CfXGxcnkxdJazLPIc08mJ2vV9X1EiEmFI7wpVRV0UO+2ncTiX1iIOr+Eg2Jtw9ge1VXqkRgqRDClR6LfqXVW0UYofBZEgVU0yx/hcMgClpsBpiXs5XOmNcxypFXbGbjuQcrxaCJJOYykWdj0/UzquGPS6zak25Ev8PmgQq5RS1iTTruPgu2slH4VozRYT/irw7Axk0mkTZ7HBqdVKD8JCUVREn92JY0oNKK27jSGMVUXXq5bRX03AbsVfMd2B32k2MpVS8DZuvjQaMlUq0gk7TY5Dp5FC9J9/Q9UOe1aieRPYwnUSKQVqWm3KHF1+oqUpFaOGCJUSzMpaVZlrV27A7IxZmLopB2hipNzj71jKVAXgbHGrJi+8hBy9rUTIdLmKjfczQhA9z0qP5jLlElLeLNVKLqdQtGfsd0dWAuTVzKpT1Ryj6ByKCK0Idkek04QPaa/c65CvKPaX3VUo8qotFGFpiO1Z/sYyRm4Da4RNqpRlvoEuGGE6cE8iipS1HaovKYM2eSqqdjhTlAuG1gIlkyqkSnEmn1eA3LTEn9ReqiVEgVNr088GmiPwFJSbelnNq8oKz00tYqK1epCCpSYIk+z9yzUG0Hdi/wBB/wDR2kvm/EdVYKXprtasykI5j0lNS/W3UCcS9VFXaKvTrmiSKTyxio7GpahXLEFi0AOigq4hoIDUUS6qZKKi+lbX6j5MqAmfU7IxS4dLR8RVq5FXqcxinUbVC0uPPLIfiTKOZRPSWTkBp2u5TKTHpY+u6s+UomgYyRm4Da0oXqrhnNAzpFfE61SkJ51K6Sbh2OLPqJeVBpyjtcRimjsVgexqyyahWVL/AIV9XXKTTta+rOslERVgDf8ARxpj06BTldtDUvVAIVyrCvJHQ1KWmICq1WuZOo1cdnVi0kuKSHShIShKxTMraWmoJ8lmBdbQiSjHwkKKEHYaYOONZqVQ21p/4HEjqUoJBwZJiQvkr2bhV6qJK8KuP+b/ABCa4Jtp0lmZGmGaSVK02Zi4kyRSqPKWeqQB/mJk/wCGn1R0uPLAjadrSQXYqUhJPaX9in5QwSS1FMsy8iE9LNQPSsBuxV8x3YHf3YxmZ5tXMojoTWg+g3eoXYI4gr6Nch06V06uthRg4pNP+Fp7iM1FSnHsfPLWiyVZlMqokd3FlfU6hah1S/JwdUr1K6VGwbWor6lXIVdlXZHEkklk5ZZVrQD5KNnufMdRIqWnRWz6APSKOnUer6mnMn9TsGXNTC0P/kx8rPwoYAs17H+BSo0Su7JS8cHHLEnN5QpV92ADTo9gqfqWaLkRQFiaJCpQgg91QJe2hd2RHuflydaof3bXclQDjlVEpI54vJoOhmst1T20eZWRFQgbWpS45sysq/ILUrvUABauu1yxyIq7FHmiQff+z23OyGEZmgo0daRIUrKKMiPSoOZSQuuboaEGMcqRRzV1CEhRQLg1RJ1R2yXB6uGWNK+tKUx0Mi8SWKC4OTqgs5UjEvTSahYFVqR5LjVEnWKAjSq/KBSr2DkTiXbqJ/4ST5KXdT/4DoULLu2lpIhg/irSaW4VYQgG9fWOiim1ajtLASoDKimJsH1LiXOvTxCiReTR6fPFarrAKBH6S7f82lIfQPq1axEFc2ehylgCY2K6WnOtCeVOL6z42dS0L8lV7ul1GY9ibf2dySGiVcRjFVR3poyVSizMbzbRk+xq59TKCu22gtL0wlh6WI4dHCmvB6OQ6IcsAGGNHKZJ4oiSSbsA/UqWkrkgVUoF5fWUjSDkkvTuJVMvuRDa9GiFU3IF1JKRi9IhWoiTZJS32sBEquSKmwna0TatSzWIVqa4PUyo1a7ckaqJQn1WMkEQscqkwC8ktGaI2SSC4j9mc0htkV0u8tJX+I6r1bwMWkKUbyZWoSa+X206GEJJvIFrvSKJ6T/xaFmaQ5p5k3it5cS0pKq9bGOZWGZhAmSmsmSy11yhaCK9rvESfcGjPKeWJGJ2OQjICYoibq7abH5Rr6VgN2KvmO7A77xGfcXzZEgKAxF7jVwagvW6w0IHkp2lrRHpYo8pzFoCooay6kjuHAcWRCimSNSdj1hWlR5Qk9/pPS1DTRVzHNg+aPTIyKkAsUv77GmLICShJ73sY6kapZkoryUG4cGesmnVkXILhi7BBpykflduVIrl4F6IDVKFDJSjX1mr1ih1n6U7S70Q5QPY4lKghkzLym1aRaE8XF/K/hSP4pBtX+mrSEaeJFAA7Zv5lS+2v/BoUgjyjZRkSrhUJ5lerS76u4KpwYp1yglPYBRmiVRKSO0uNRzGooGvNMvliiraTsD/AImWqh0uVMEQ72YsfASjqwqlApW0j6MBWt1HcSXrYJdQvmTGuUWdv7P8R0+W4IC0/u+ZRuZ5T8XU09XD2lnq4o+UBLXWvkk3sUOYOESxSxIBTWl2D0MyVfpoXpNQT0pH7v8ADebYVqc/8jHGawICPrRn+b1Mqs0si/KacgFyQ9T1HVrCjwI+9/jU3QAf7XrJagfxvKuq5zOtB7xvvaa6qbkhj2lRuDP+Zk55V7So3uQhOJLFuOL7h1KM3ZWv3MZ4lJ2bXphp0rNVqpRkLh/D/iyKF2e4D73blNfYHpFK1ikdVTyDsqxzBNo6XMII031LQUwxo6hC1Cmc7SzRBSsDtLQo5jUWNdVkUii2k7A0/FIzL6HIFTeRGLy6oWqXLCNiUi5xxw2fF1CR3Q/xRc/4bXMYyTzdBfJEmwCjUSorSD2ZgxnQUC5r6qBIqczTlimIihrtSmyvFnLDECokuMqQuzTwHYnYXooUq2lItDBWs2lriEN4qq1w9YZpCNGlYtyja4yvUnlMG0Y+xr+CrvDBzx6fRoNJJCrKDi9XpRIe9KZE1L1UeoKe9lILOWGIZqlp+PqbIAryY9n7uRVT02BnOPWv3XLnTm+pZzQSR19r+Ho627Y8mynS1Z4NMes1ChdXYljMiSdGc4JBqfc50xaeMUoTe48v4Zoe5mHeXi1HJWxPpeA3Yq+Y7sDvP8VBDsGa2NYsPS4UJlVZ8NFS5DLr5sTUpD1epkTsiCyEp9jhKAu9R3FSkJNxNXqZ1xi6FKiE8HCIdOGF67UX1lNQPZc5Joox3o41UzdD0fxqUC1X/VnmnQR9KOxIVzRSCztDhQmRVnw0VLk638SnxNaPmC++1yBKjmMQNjiEOnFlgo7jY1FEcxKkmlUqB2FpSmRdnwk839jVn/EdRao1qzRd9WuwYPMVwd7LenpfVLWBTOpNrWsxx2xJXZX2YPuCwdD1E86fJizEIHscQi0yNgeqWgoTlCUm562bi9XMtaCFAVwcf8x+JSjKiNOzpOAcnW/iWqOaReHQOgO7paVpFaQ5e4U7avL14FVEONSZ0imdFj1swHaHqJpOjM9AgrHlrFT9WhVZLFSp/wAMOJcYUqg1QFpAcSY5z3cSMd1wLnWZ1eRsuo1ZU1qlG04Bo6qKMH+WgPk/qPS9p4NKv5U/xFR97odDqTdjTZXpds0RzpGNHlljRYEyi1PQ09UhVilRilB0qas867ZF4lpzQyCig861JOZCCbAWOUWdjMuqPkxqUcqewOJMMCbkpFGCZNN3st9P/A+qWoWZ1Jta1mGK2NK7AewYOQwlXdWLwH12rlNpVKsmr0iFaWlAilgemRAg30DJ3d9QqntdClBp1co7payjRg1XlFEj93SHRwJvNlzSU/g8J+LL9rTyR0MIM0aSIgbmZEQVJm60WFXQ1mLOeVYep1Wpk2lchNXF1cMY+GoXp7GepMPdkF5xri/hwJTQKD1s3F62biHMowy2qUs3MGL8FiV8Rd3XU2DodkMdiaNAXq6e1knRDu9bfXb7HdWx2zwqzoGNP/C8q40WBEotT0P4USu+qMUoOks5pl2yybSWo9Thg5Z9Su+il8qRg5EQiK0hNxxt2ucSGM5VCvpeA3Yq+Y7sDvNFC56KOVQ20Bejji6aBqKj5o0UHoo5VDbQF6SOHpo1FR8MCdRH0h6KOJR25QGok7wFxm9Jf4bH1uOUPlj2JHirlUKVGxw/EX3pFWk+29klR3ZVHYoi1mpPhAkiPkqemjMPqMZUC5I3ioSauIyzgcua3L2YM2bBs3UUnAs+wXP2jF/h8apMcoLhRAjoDNT4hmQb0l/h0XW31yh8qNiR4zQh6GOSTHKC4kQQdAes63TA1Rpkcqf+rFoEUAsyhmhZAG3Lt8whShH/AIdtD2jawI4RZlG49o2F0SnAbdx/tf4fGuTHKC4UwI6AzU7hVEvKXq5P8xZEhN8Vdpeo69copGUd3K7ya+lYDdir5juwP+5bwah/Dmj7wrTMMGgI08ViQPS8N2KvmO45VOUuU8A5TwDlPAOU8A5TwDlPAOU8A5TwDlPAOU8A5TwDlPAOU8A5TwDlPAOU8A5TwDlPAOU8A5TwDlPAOU8A5TwDlPAOU8A5TwDlPAOU8A5TwDlPAOU8A5TwDlPAOU8A5TwDlPAOU8A5TwDlPAOU8A5jwDmPAOY8A5jwDmPAOY8A5TwDmPAOY8A5jwDmPAOY/RzHgHMeAcx4BzHgHMeAcx4BzHgHMeAcx4BzHgHMeAcx4BzHgHMeAcx4BzHgHMeAcx4BzHgHMeAcx4BzHgHMeAcx+jmPAOY8A5jwDmPAOY8A5jwDmPAOY8A5jwDmPAOY8A5TwDlPAOU8A5TwDlPAOU8A5TwDlPAOU8A5TwDlPAOU8A5TwDlPByngHKeAcp4ByngHKeAcp4ByngHKeAcp4ByngHKeAcp4ByngHKeAcp4ByngHKeAcp4ByngHKeAcp4ByngHKeAcp4ByngHKeAcpZqrHdir5j/APwbFXzFgMBgMBgMBgMBgMBgMBgMBgMBgMBgMBgMBgMBgMBgMBgMBgMBgMBgMBgMBgMBgMBgMBgMBgMBgMBgMBgMBgMBgMBgMBgMBgMBgPKO1kcHlPYwGAwGAwGAwGAwGAwGAwGAwGAwGAwGAwGAwGAwGAwGAwGAwGAwGAwGAwGAwGAwGAwGAwGAwGAwGAwGAwGAwGAwGAwGAwGAwGAwP9h4bsP9h//EACwQAQACAQMDAwQDAQEBAQEAAAEAESExQVFhEHHxgZGhwfCxIDDR4UBQYHD/2gAIAQEAAT8Q9Tz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9Sz1LPUs9TxoCN1WvknPmBwCvBPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRJ6JPRJ6JPRp6NPRp6NPRp6NPSp6VPSp6FPQp6FPSp6VPSp6VPSp6VPSp6VPQp6NLv8p6FPQp6FKv8AKejT0KelT0qelT0qelT0qelT0qehT0KelT0qelT0qejT0aejT0aejT0aeiT0SeiT0SejT0aejT0aejT0aejT0aejT0aejT0aejT0aejT0aejT0aejT0aejT0aejT0aejT0aejT0aejT0aejT0aejT0aejTL9qI4BHr3Kc+ZRsl0D4nQfE6D4nQfE6BOggmz4leE6D4nQfE6D4nQfE6D4nQPiU4fE/AToE6D4nQfE6D4nQfE6D4nQfE6BOg+JYaHxOg+J0HxOg+J0HxOg+J0HxOg+IcD4nQfE6BKcQGcEr1e06BOgnQSnBAcEBwQHBOgleCV4J0idJDiQ4k6T4hxJ0E6CdBOknSTpJ0k6SdInSJ0idJOknSTpJ0k6CdBOgjxJ0nxHiR4k6SPESvBK8J0ERwRHBOgSnE6CdBKcERwRHBKcE6BOg+I8D4jwPidJ8ToPidB8ToPidB8ToPidB8ToPidB8ToPidB8ToPidB8ToPidB8ToPidB8ToPidB8ToPidB8ToPidB8ToPidB8ToPidB8ToPidB8ToPidB8ToJtjHeKc+f46QgVdAlyPzUuFGpqmPgmEB5UfWokpi8FOrCSodjJ5P5Y1OZCTqs/BPvAGAFgk5En1/iFUauIyg2izguLQGXQ1frL2QwVo/xrsd6m3SMrvb0A1Vhfj8DrDX8oSlqWdq7V2CVAlSpXepUrvUqVKlSpUqVKlSpXepUrvUqVElRO1dq7sSMr+Nf/CkU58/x0kguy5/MFMVKqPOoHQjJS5Vy9kARYkdKjdzqgztAcAaug6jp/DbpOs0/pPbuT2f4fTp73S902n4icDNf27fPev4BCHWGtv99H6T6+LeV2CVKlfwrvUqVKld6lSpUqVKlSu9SpUqV2ZX8KlSonau1d67P8K/+FIpz5/hoQ1/AkWvZNqsv7fUQDHSLRoETx9hXoPKW9cxrgjLBy3PUY4jZ5mEBLK1tXtp8QQt4UW0npJA+Dwp+YJC3KEe0anPBdLuU8cKBPixDlj42oEKtxuOnvC0DRSPhDQodUPTSKm6zWQn5hDKdJWFbkidd4NqJSexCWvSqKl/mNSoiyIcS+I3TlJVf9R1SUKsPAIJpt9BBV1poN/uNAulBMG60YH4/KM+riqBKgfzqBK7EqVKlSpXapUqVKlSpUqVKlR7VEldn+FSpUTtUrvUYn8E/wDgyKc+f4a0wTV0Ms+I0RdB8QfuQDTB+kNa1AaLvNpYnQLxuTBvyNj0eGyH6m2pxZ+o1YYkpG2Zo6H5bwWzMqwuWqggzy5QD0SG1EuASPVvMJKJGAUR1WH6zXcvylmdvrYP2IbMNA6QSVrYjYOqdI6ChTSvG8OEktbyYIkBUpbGIQrEa/0TO/l+01MHw2rQxeiLWlQC4xeeLgB6W4HxW8bhF0wejCCWuD9DuHT4lKFn3DWON9fpuQTWF0lP0JtLMR0JfnRH5d0hw9HPwzWEJBmXni3YErvUJUqVKlSu1SoEqVK7VKlSpUqV2qVKlXElRO1SpUSVGV3qJKidqld67V/B/wDfIpz5/hpUmt0I5qj9YatT9qJ+8ZDV/a7MGbhflAQzb9lmoBR8z8/y7V7wNFegdtIRDr4Ct5DAGABt8IQAbs14izyqnVxbwX8zF2OzTcXghETpk91UaOhiFBak0nGwEsutpv2Q+n/tPzPCfVv27Cd7MDa3X4uHsMFi3cjToTGJhIUsHg4jC0JTkZWBTF5COf4kU0yVre8U4oAmN1ahx1j94YDjwhZ7QcxWy0IBemHtAotjOtJ+0M4YU+qM+tiqV2rtUrvUCBKldqlQJTKZUqVKlSpUqVKldqldqlRIn8Kldq7VKiRO9SuzE/j8x/8AECoBbKNIuijKekC4CIp8X0gtMG+SaiFQEVZUxls1Tr/GRTnz/DR3YKvMOWy72WXXA6nOq+3zAKrE8LfZiBtHvj7wrCdEan7IDmg+JZl+PlNoSlJnwCPiib3I55Da+EJ+K4jAWDfV94XdvnlR1nCB7TOgsMBt2Q+n/tPzPCfVP27YTqLB8FUR2AH6wHS0Yn0yNyLgYqKEt4GTcajEqDoH5/LmCD7J/VrMi00X7nZX8nzjPrv3xldqlSpXapUrtXau1SpUqVKlSpUqVL4vgT7uqhXvuiCbtzksJE7V2rtUqJ3qVK7V3SJE7Mrunau0txnp9RXzLrxpj/d+54wslGfyL8y9+oCv5ZRptE/UYrwRX6jGVutRYRy0fLN6kb04PvL9bL0f9/jIpz5/homWh5CKpW3WMvHhs9oDUYk+T2afaVW1BOyRleE6W4fMz2R11VjmjeNovbg9jEfDcSYcIfFx30+4im0FvlvrHWfQP0hPxfEyXEOaK+0NGdUosfdUIsgBokG0jx3QHu/Azjsh9P8A2n5nhPqn7dsOX5OUy46/tmhH6FBf52EvZg/FJZ5c+8UTVBkbOMfaHsoEGdUcR9SimwwJ7qkPxPKM/Mc+wSpUrsErtUCV2CVK71KlSpUrpKjWbqaQJ+6zANblisG5E2iW8BdZ6MI3aUl3inX8Js+JtWCUCs6B47VKiRJUSV2qJ2qVKifwSVK327VK7sYhIUQfeFWeat/6hGpM/wCvvHeP9lg10IEtL4fdiBCGM3tRkzRP0uhLG9uzDvlaIXYa1t+EbOWoXYafxkU58/w1kXcxybkF0MBq31cYi3TQqVuMvgreZ8jWFYGuqU+kOjuv4qN3qwyGTc+/+xGleBM+xp7RmVSr7M4nvr/dHVn0D9ITrJ2X06Et1z7s+LhJSLQ5IBCGgX6nrLDH1SHly1v3I+n/ALT8zwn1D9u2H87yn0/9s0I/Rp+G4RCwZnZkvcRgRlJ8MrJwn6l8oVV1yjnOqkX7RQuRXtCou6fXGfVRV2r+FSpUqVKldqlQJTKlSpUCVKSqYv0HxKHj2wBYHQxW8dJLnWrECsiFm3syr05jlp5QerrHugRBioS6ZB469ZWJUqV3qVKlSv412SMewXSYz+o6qAzX3aw1SjKdyO/Z7pNJtSXwfQKw0hQTrqRgCJT5j/MYtENw7pyOwuMEg5f2wEiDdL2h7iYq2jztMqEkWvv3e4oZL9qNvdhOa2m27+UinPn+Osun5N+omcSOcvyyQEBaDCeGn6dgW2Fh0EOmo+ajYEdBHojZ0iFXwsSuddGsDR9Z+AfeESsBILGTEdZVvWkNjdmD8D5htyOE95KWEM4FcdSKvBsy3S+ioXUsLg66mOdFxQb2F/es4h0oPsrQfykTkzb5hRzhdgfMQYEivdAOWyvIYXqRoPou1DA3CIrQH6wLLARprlik1CfhcQgCSu6qjCdlH2AXYbMYNRrIvCMY7XYiHAb+ZbNfNK1OpYZxmyHmq81h9oEwOFq1QT8A+8rbSSQRMneoEqVK7BDtUCVKldqlSvaDQC3pFgOpq+IQInNlyKR1alAaq4XtTLrJgCw7TXKZ2iOwt27G1PMyCjSzCcrNc14JZ2+OKG3Rz8RMhIo0qVKlSpUSV2YkZUqVEld0jGGUiwL6R1lvNLCz7xRUKSXZGaapvPaJl7b9e9rp/wBJ+15g/wDZkTXU5XpEaG6fuP8AIUkMg6/8xxC0QF0ov6kHhcBzGJaotK/ji+p94onQ/RcRieWvazab9ki/dD5Me1NoD8WD6wId7UD6QcBfN4eTEERcxztFVhHCBa61/GRTnz/LVql0dYWA/KUxqxdBCIHyRoi7q2bxjA1Mh2i3QajV9kQrZqsl5ADKpwUR5ptNq3mujGCk8H7k1t3Oqc1eEviEAuXAlWNWrqoFoBmUuFU1Gse2HtBuMxm7U5Xe4eyARQbsVAepDBW2kCjGg3XZjNjYMBE9JZXkg8g5Go4onyYOdHfN2rMs60fp2Z+s6hV9q7VK7V2qEqBKlQJUqVLok2CYXXVL9oqmG/6h+0Ra4B/cllgrb/QEMZnpNBrrVQNZ6LOIfJlDl+jFxDUb92xB75iRRtCPhPhT7xFkVFbR1iSpUqV2SVGPZIypXZjKn7iQ11YHkmA5eoG4TNA02l15lLQLocQE6FiXDNcmipcOkGyENZ+15O2Joaw23lVJWHIfcjvNRcLf21lIwNxub9nuiotcYhg16nbzKGFqj6v+S9x0mukFx8URzdQiolSDhkhMUlJx2OuGBCfiDuHP2HaYVLqvjSWsE2gREO42/lj6EbNn6jbXPBFV+IfqIcm9CjWFbuxrnf8AjIpz5/8AFpgSkbJXuoIci0YEBbh1TlNSIeKBfaAegpfNQ5DFtBo7aOIARdo07h3IfDLDchwj3mkCdib967VKgQgdl6IvW8JMiJT6GdJa6dZXYJUqVKl5DLAWqQsPXSQoFGo3nXF8ESOYN9bEGJu0krMHGL+Y1G/g+v3hVncO77x/QNN5tXghFOqmctLhcRuha8usrEqJKlSokrtUqJKlSu1RiRiTmIDMamhElFLRrEpTftrqi/WCDqh5p/sWATWNaAI7v2HDZEGbzXogU9MLpywEQOi+dY9dKFsVbRGGgNloNRO0boFKgkGrRfDsSgsszqGn0lLlJ9jp2ZpVUCHmGXbTxlYdeh/X+o5Ui1XWW+gAT0/6Sr2jfh7XEvLblMBloVZqLtmIum5/0Y7R7RC+VlMD4HH5RxNbF/JEaBr/AABYCHDY3YwQKg5ajF1Fq7v8ZFOfP/i1swUQ6MHFH3VmGf7gfeUm11H6RXQuu779zsoGdUfQLiAAUQbPzwVyPeC1XvCiWJV1xjYOizWvmFF52uHSB2rsEIE8Q+LWh7XhlidglvCgNF01CB8BwW+jvDJZk7VHrzSZeELg3cv2iiOhQe9ZgBA09qKh9z7QsgsKJ7H3iyLP/aJjJ4kB9qQDFjKj8rHHUG2gYIraBcrMQIkwXf7CUZDox4JUqVKlSpUqVKldq7JKjE7MYkPbLq8EJKS1dXEPMbMDl1gAm8/qiU0mYZdHc5bxCAQVpo/7+ovRgP8AYeJWI1bbSuHYNSu0q2pDJN2of6oKZu4JgAU6ssEMMhHRSXxX+oQ2gfcaY0Z4DWzNe5MSAE6j/wBlXGy+Tswmq0SraWxfaa/phjy8E57IKggw8I4H8OYZ1ODiCiaL0VxD4JbSqOlaDg9hvLQbZOHg0/ny/m80N329pQ8z6x6/xkU58/8Ak0fwIYi96AMAaxFWjI3WUFYSg+e5vzA04WINcx7f1lhYRUGeDBXwwSHLppeexA7B8wJUIVfAUaDd14ll5oY12x8wmcoxjlOswPG5x9xlnPbgfZIh6BkUPMQWXe+0XACZob8gnPvLqWwU+7nVeOZmCWIdX85iEXakcdNowg7JpZU10Xo2qGD5XEa22uoIh2sB0poyzT/jFgdJUolSpUSVKldmVKlRIkqVKlRJUboqgl2eMRMuLVzdXWICIGynSBiOs/aPWACbhjJ0vEFb+tBR8OZddNWfiOWY2ooZBS1Bf+zJiAUsl9N0FkfMyfqrzjEQdnoAA4hBFo1g19z+oQOwJz+ZfxKtWXxKS3gIjOl4yhmXEeMznu7wNV8S/J95WLY6YqOb9/BGHU0YeO/xCCXgUmDC3uH0OYIPMloR1vx6wAX3oH2hREEzVbRlLS1/lIpz5/8ARolFDmKNKNQxAgcssp8EorbSOxKlDFR6BFQjdzQgRDohD7kPWlxG4BJeOBDlh3RI4cMRWaZaDaHYO1QJUOUy6CvRzGtnSlwAQh3oWbfMdEsxd5u6GmzNl3g3PPEQgRh0xw0a5xXWNu9SAGLnig6PaXg707WVkUAvR4Ss52PbqAt2kZF0C36QGaLMDWZ5WxkVaHsNAlZZUqVKlSokqVKlRJUqV2SCgUwBvL9decystkTsmGPYDQDwQLVi66Ph/wA7hqoAalhjzsrqGwt2amd14vuI1ygwWVNfRVS6K0UcRxEg2UE/DU3pl+x7wmVxDqXvH9b1oYQu1a8wqUMA8kGzTZMcP3HgSqrpEzGEWS9fFRUdU7jXr0le+qbS9X/Ig5gBF3BL9JRP+gO1C6cI+KbqJWD4jGnrFP8AU+QZH1xbZp3iSn7AQ00WlsH85FOfP/j0Q7EUF4BNqLKMR7YJIkeIhgDdcXZIwNU6gCkXFTc53T1jgh3Q94giAjCgmlNwXTWLIG7WUCCJOsQLGztUDsFypQUgjtHFNgvIGh76Smcn2JB99dJfWjioN6MEZA2N2yXFIRk0V7QF3KNUSGcofobQu0bAt99vbsQNzg0irNdI5G7OT6ypUolEolSpUrvUqVK7JKiAFqYe477JRche3VdQGChipUSDt/HAg4hpWrycRrRRiPpwZwQ0UWD0cusENh0D9R7MdByv2QydfhH/ALKoEL0DZuNTsCCX2mCyx3AuaRkf0TiOOQBTBSk3wkqXAwCk1i4JmMZSNv8A0fvMEUV/nuqTrKQxhNNUUtkKse1pS/cxlh/ZgUiaIyxCOLWDo7+8xtkyVexAFNXe9uYpQGon9UinPn/xaP4GkBzRa8RhQuYAsQY3HEUBrEoo+kTpIBdWJRm0dCLOsS9WBjYXOiX1m41Inapg6VcYaRlwRYIN6zbf9upNpwl5gSoEUC+OJf8AQ4fsy+k2snC9BeYgPdhH3UmmO8k+J58ofU/5Eh8E0LCBOQ+sFcLCoHxKlSpUqVKlSpUqV2pUAg1dcoaSklSu1SokYgVaBMW8bzsiIg4V8HSYeE+bT6ys9XT4YnZiQ8i9zZjjCY91Fwtc1cOgmAdFWbJZVbvtUYjxB8v/ACGPdX3f+QsHeNzRm/LMWA+xl+kI8ws8S135DaYenYdJcct2KRcm6G/junxEW7D8fErtUP5Tua3HjZx9tPLv8P8A2dMH6L/DNR4cM45keTw+8cjsMu/9iyq+yOn9MinPn/y6IuJfRH2NxCzAikWgALrFibRq9KWCo0C5RrYPETqi25Qmot1LFBXiDkrAzx5vJDS4TcXMfrHYpmIkGzEGxjAgdqx95WkCB2JUqVKlSoEqVKlSpUrs4IdZFs+ZSpRl4zlmqIBCsjElSpUYhBa4Jjk0vMUOTkvd0OsY0FETqNzJKGfNXE1JUqVElFAiqHXRLsCtevZI9jbCOTYi3Fr2zBD2Kv0FaMuELVY+6VhAqigcQOBXSOsYWN/nKlilM6q11agejPYtekztA3irWOOzpM5YurwyqzGr1H/v8Le7/eJphgahOzzr9oaN0C1W/tERRKe1dxSGy2PPBgQwZ/BTHgK6Zh/okU58/wDh0Q7EQi0Iq3MQJpB8ykbEBmytCHHHaYbaO21TAbxWyjrLKtPVMC0cBoIkt8Jd5phWySzF+czIaYjKlj0iFLAG9E4DVI79hZAldqhKlSoECAzk+JQ1EHDZtEMgowJUqBK7e09p7diT2CUh3Dmi2Wx7sPal9T87+8oXASokSJKi00Ra0YNkhn/BOe9qtqfF4+iTruEqMSJAytKI/IsFEtY/IEsGjukYxz29XiYBRcPdftG6lCem8sCBYgLq5qPDsgwmKdc+kEKrHkXWElYD7xFFopkcoxLGqBVLvDTtP+cdOse2b6F+iXG3b3L+7+FCvQfVlHbD6wVCOTMSYpoek2rkunN9mLj6kH5cHQVhwPERgQYbm/a/0a7g9esDUlQfwM2vPAn85FOfP/h0dyF0EiLQF2scscx8g6pUXYgBZVYRtRzAXKlkYQuZpKtiVhUVIVDSgi1rEswIEtdwTqTPzG1xXmFAaJZdrKw2i3VBEimB5m8rtUDsECEN4VSCvOxGjzXXl/xKam82o2YhhvQFypUqUSiURI/AyMM5NG6B2N46/wAEv5ESJE7JEqoaQ9tMbqHM523sPdk3AZ5sf1CaaAhInZJfBRatiMqeYWlv7SopaFc7bLQ97oeOwEaJFo0I32iXiUYPuCPyFWbL1ZrF6sjG9BdUTEhmRLiItsOhOMmCx6RYKcBuOxdaox7dOB+sCksf819/4WJ/3GdNP2d2rPJ+Fzhbyn/QgXQLdtQYGlnMvXmN2iazfG97Pg13HSKw2FU33fzkU58/+DRDuRrrCWLYsFkqsSgMy7wVGMLVMYAY1qLrDEcyksqSbAFiUGLwUqUMkeh4k0PiKaZSubqWBYGjSKcERc6lSOOBm4DcRjZXSdg7BAlQJUwX92U9I8j88zWl1h9o2jZWr95SUquNyFBlLcM6TOky/DOshZq+InXmJRBuqLZwENC/CN/d2DXXE0Np7x61Y5OYygnqTrPidR8RfL4jzPiPM+IQEdHCPLZZBndPv3W1w9+T/SeWLsxi3nf6ukwtA0a70KRW1zE+aoPLqRqQiTfETLzK9y1W7WQxlbJR5Q79UUKibEaOh2SM34Yrbu1qIi3BSBQR6SYkTsxjNRuVHV+jL/h1f8eQfvMMYtkJ6bPTZi+3Pd+2GNik5uwWF7kMf8hmkKziipPqa+Xp20hN73vUyia2Q/lIpz5/8mhZ0Nxray8RWSXEW3J0hcz3faHWGDmcRF3HiKssTSfKXHOsyAVgs4IaJmO3JIC4Nw7wVNVzeIntKZAzA2UZidZDbxNFwg9CWpbqBlgQJUqV21QcIuIab6EbDaOjYeO49BUUWjT6UT1d/k9TT1dPX09TT1pEi7vCnSIir9wLJsX58kOwoiNJvMYusknU3gaxdlGUf7p62/yeov8AJ6qnq6Yfuo5SQitIaE11rY7MDYf0nzZ+3ZhEWlEGYWB3R6z0BsB3urFL5/g9pSpk+wxJxNRG7DqrmJX8DDtqCDhbNiNpwKbtbu0A0LDJ3jEjGAWUd/FRR1KdwgacRyUR3/nT1BPWE9cT1xPXE9RQv+uKNeshWjCyA6t9k/UygLIdBf8Aswvho8P8pFOfP9+iH8GBSGlcW5YlVBisXWOsJjdpRcCoqyYGLY1SiogbooTot4qsoJaoyiXvWpdplGGkopY8xQb3GZFRWwWW2YwOUNYlhG0RUMBNHSVAldqlQTTJp0IyfKBx15+v6vy/7qj2/AcTN90rBHRinID4IUem2v8AhPnszBglZ31JQjJ/yjhidmJHse3D5SzCQKH4+6Ln3yhjpWsft7MYx16SqWsi4SrJ4W/v/ffTgE6qvvKIMUfH8pFOfP8A4tGkJipqPWIttEE3mXW7iouNIytoLNLOIqUYlgHVFrQzKDQhKBmIKqmJKOC3khUU5hWJcwHsQVOnEIUVcdBQ5iKG87xYOriFqnSNYYI7ikWANoTAh2DsEJtS14iK8w4PDFcqApE5/wDX+A4mr3/aMYD63rymPSWG3h6RHhsYid2+wPKmDUoU9rn77usYk4qFBEGdsXH8V2exsTA1lX4y+0p/0Y7dmJKxPVYPSXesfS6+39+vasvdfcnUM+R/z+UinPn+7RDsQhGYrJ5jkBwY78wOKjUWLBWkFY0BBrDiDhqgKpKOlEsOCadNy7wDtC0izEgQ0IWQLNYyXoIaMhmpQ6hKgwp5MoEWiFbqkJSw1NcWCBRSbOwdqgSppMZOhYIAGzVX/YxtDCO3/rCOffEiRI7OisGhXCtvKJaWo1Hvc2x9g0fSp1qCJGPZJZRY2fBFwA7p2ZewW8+RH1juxjOCbPcfWYkoX4P/AGb/ANzHOn751YH8pFOfP/h0bQ7IQFjLi64N5hYDJrDR2SsDAKJWXUvT6BgSg6mWt+KOu1D7kqNBHWoXDkCsXoEp7jUpE4qMAlyzKkXr0gADSHWkY7mctCA52mWtiDbpCHuhPe60AxoFQOwSu9SpUttNF3hHXpAY5Pf/ANcWr3xInZIrSCb39QWrLRtHaP3NmWc3WnQRpPFOxMx73qYqeWJaFlOr6difARHYwf3FBaLW5GPZjKnwNqwFS2jln7n/ACb9f7uUU/RLFx/IkU58/wBuiHYhDsbR+sbrEVRhMWsxCkCGjeMaIq5UFzXBBqVoUQ9QbrAqz0IocHCIOI6QJSISEI7pHkRWKZvy2naC3u1WkCdhTcsGYAZYiwsHmMIRQM3LbqlRU3gSoSoHdoJSZhfCC6PMJSlt56/+n8jxNfv7p2SCUmRhhFzYMbbBfYfjst3gfgRXIvbmJ25mdmZ7FHjDsNONYS4C1fgwihvP+EZlWwrsRfNhcpTWbr/4ldSHI/Ex5bwftd2cf3dBE+sy/U/X8pFOfP8Abo7kDsQmmYhMRlKYbsuP1SkvcUQM20bbrNYiMSRh3UsSEnavYBgAQEkhzF9pbtlyJUDuYNIhrUvGakPCpn0xL8skoJWYAANGIIrLHGjJYQO1QIdggQFaLhHgFq4IQtG02GL/APT+R4n3eyRglXGS1kXtNHgpx37Ww9SH4HWJ2TsxU3SEd1R9XdTq2WVzCgHH3xvEa07oJ8ynAG7BCU239k91Mb7E1wmPb/4FS9EzfU/X8pFOfP8A4NH8CMlSgmtchMjIZxVAzBFlG+ZaxK4mpzEhkRMfmlmAGL0syxVhmWBiFLEQvuESYTiJwUTEohouCCa5hmcXAVNOIIgC7JSQu4aWsx1iEDuHapUqBNL52HaWiM076fv/AGcR+YNu60f7Rf4OJ9/7d0jEuiDKS9MdM9o6s89nrcH2hJe7EhsOgio6g+r+O8t5Zv8A+L6NPxXT+UinPn+zRDudybMWEsGLYULg8BFQHESkPYDpAsa7iCGp7xM2MPJ0zWW12NyAbbJukmBdJbizKVJcC5nLHIm60uN+KpBq3JvK1H0iQcmRzKVlpCG6TPM2olGdXib8O0IQOwQgRKBbBdZ1riHBfKWdB1jNqtq79v1ArJojSeuZ65nrmeuZ65nrmeuoFWOGBL2irKz3faChphZ/56QoJcFVPESsbfKeuZ65nrmeuZ65nrmeuZ65nrmeuZrucoGk+9EqVEALXaCCncLaBdYtsf8AcW0+xqvdKYaVyD/blqNBpGJGPeLavr2dl+7/ALXAnBXalRcPKnrmeuZ65nrmeuZ65nrmeuZ65nrqBKU3AObjHcoOs9P4yKc+f7NHch2O30U0Vm4TNBKmURQESFlwAtQMG9hU8X2wymWqrdYXVGobwEXAjDoCzpKmpdcuFl3SsQjVZYaSgWVa0QKlaC44OsY4gAz4mOLvNTH01M/1FMYDPMqUwYjVbghA7V2CZBOow5QWupftONA+nBG3Lq9zCVqBuy74EVb1mamFF4KHpAgCfHaHSgICh6QlRrxNSD2IRRpzF2mzhg2h7XOYh0YdOHTg8PYDyUlRDhGuJT2gZBlhfRQhQoFFxJRNddgBdWqqgqEcD7CIiKuVe5I2lHmCeC15Mv1iOarcYxjHWXS+6NPvHsI7+up9/wC0c1h2bbfQI3gFY1/5PxD7T8w+0/MPtPxD7T8Q+0/MPtPyD7T8g+0/IPtMP4HxGKuBX+4DeHtuv8pFOfP9+iH8KsgqmmsA3GKSKYWi5oRRkxBoAb59GbkDVuw4c9rpBCzjAbSlKbmGdZW4Vu8AzRE7waEdlfbtS7doBGXyggpWDtxDl6wM1LA6oQ3N4im4cTpbQO1wsDeVwDVPeJQLciNv0zT894lCjgx4j+DozO8/T4PmCBvMHRfWNlATfzYHsWR1XDKwksfAgocc6q8vWJqEyOg5JpPHEolRiokrsxbBR+suMLX7j0hxDjR/69JrHZqwkKs+SG6jB6v3qJjqBdB4HC/mPWIdj7U477TJp+m6fWbvnk6EY9mMczffRMPr6YNPrF+tM2T+sUlANbG78TACoI2xUdI93+6RTnz/AGaNe52IQhAotcMxrqqOHlzYxGKgXAEHZABsg1pMOIUtUrEOcsGUKYjQFKlMoqVBMNOGFUI44URgqaKVXLiR6LdiJoRSXTDEVIxJU/EzIW32ERtu/wDIEkqoDVYLEMpw7HtHZ0zBFcrTq6TfOCJjw1ZnBi5EamXwxSI6/aRyQELVl/ghUjArnQuA8+YYfGldkiRIxafexYpgFz/lGKJtdg4OkQo60YRhIZFKo6XrCSjlOZtrJnphMC0BqfiVhTofpLrJusZr+VRviGdh9/eV22fgjGMY9xQg/teIjKSwPejh6/0+IuJEAz/2hm94Mb7uz3df7pFOfP8AXoh2IdiEIbRKxqgXmRZAMIR1SYI+ylwJeTVxBuV1BVYavY0pt4mcPjEBiVEVrmYPVLHmG0IJsjblAZZ+oIt6GMiVYDHii0jsZLo/zuVsyacntCBg5llnkmrR6lB2FxBGELV19XWXiWdwiklte8esADSBZ1ZUSJ2SJK46pcs+ws68x7WEjaOhIrA01yzrbp0jioTA+HKKdqPPif5obrcWxBjQBRWxHsxIxjGZsq7h+pJWdksBnLHL/iBVOsf5cRtrqbPVUJKgqxtmrPZj2Y/2yKc+f69Hch2OxCUXeoQmqqGWxNEWnErrMtixOGViOprNBEDHtNUwFTTg7KiPXsLDepvn6x2hTaTFuQhAgTBeyx7rouTMG1Ux7MoTfDD4e1ziXGBLv9yUaSPARyl1mDb2g32s8B/2MNGgpGMv1Ksbiw6RS6s8zAN2mIy8kRrdsdH82llZZ2uZhkqGnlcsW59jvUeyS1Gm5D0Zw7vkig1+IwOvWO7VQNusIAjwcrjxHd0GhE1lIHgYMYs3JkZ62WPhjXSIRh8MrutTPLo9YboPqbz5jR5fQ7sYx0nMewJUMiQq4aB6PmVR51HyG8VCGxT4jOhDZ/gG3eKD3iri5DrfeJ1Bs0hbbrVj2Y93+2RTnz/Xo7kOxCGYSr1mboyRojaZOsWkAmjLCC3pCMWZZ6RUoiKaompiZOcwUJilAi0S648yxcJsnEqFVJhmzRDSBCHYw2SiMHMX6vLEXHuT1GZ+tpxlehM20PmDt/Q6CNcwPiATDF0EGTQ8+vWUoi3TvwdI/SiPGkI0nkfJMmZsH4Ed8E0iSu1SpUqElY3IDUe+q2SIHdKKsuA+8Zko/WJGM0bFuUo/uiAp02Yil/z9SUM6Yfsm7E2VfdNvDRquXmX7A+xGMYxj2Yx7GYX3LIaPbnMWx7us+dY+Szwj9xi/Kf6RM0SUI92L2C0wpnx9ll95ujHsx7v9sinPn+7R3IQ7ESsswgqgCkynclNJGhDkoxEqFI0IZZIZeDCajGKqwAldU2XYUyMYG8Kh3iEil7HYgdghhxAdbOsKmfrgWKCavWB2qVHFJZGNaEqVE1JrjjiVKlRidqiRlRm3mGKcR17MSVD9fU6BLTnJZwcDusrGIVYg6ogFC9Iuw/VjxXIyox0j2Yx7GMezGZHGGGgcK6wOZPJj8dmMe7/4JFOfP9ejudiEIdiGkYkqupLM6qYDmKLSbZoI8oKVEzqyakmIMksGBslUPRQgbtmKAEYnE7VGzKJcwDr7EA0GCECEIQIEIQhArsHau1SpUqV2qMTslxlRjEiRIxiRIqK0F0ZYz0M1LmBbqPi3MN6KV+guE4YNex7GMY9mOnZ0m3ZjGJmMf4JGPbmPZ/tkU58/1aIdiBp2OxDbuaQ0nyWRtkb3mYilR2yDXMxF43iWUqZ2p2hgBKhCo3L4evMceW4LXiWTacwIQ7kIHYh2D5h2rsEDvXepXauzHeCFiqJHskYkezFrMvb6rllCCDeiEF8MJrPNq6adJXEVP4hNbP1rVadax7SjdBx/A9jGOsrGufdKNIvQR7PZIxjHTuxjHsmsexdgmqjEQwbJX9kinPn+rRDsQ7EIQh2ITAdTEuLi7gaR25iIXazAKGIWtGYezRhcB2QjulpLO1kzWbmaXpyhDsIawh2O4Tf+JK7VKldqj/G1vRxK3MsjV9EACb9mMYx1jK/NMcaerSipdu9uTrDiZQIPiGphECl+I2r8+NjHiOI9nsdJzBABb2hAWdv9xYrXEwCo36Q25bUOYxOyRjGPZjHs9mOk0ep/5wDk61r/AI5YolcCwiUdYP8AXIpz5/q0Q7EOxDWEIQ7EYYtMkBK3nxRZO0rUzLlwh4qIKJNeaFftINWj4iZisR6xBcoJil0xyzaYrYRjAVDTsIQ7B2IQ7BDtXY/mxjE7G2oQRZQWPjlB2z2DDyfaDwdnsxiR7WCTU6jRYft2qOmdJmIX5Rsjrcuz/A3mervUHzG9SBa8ujzG2FEWrFHqtfoRmrsZqI9nsxj2M27MzXWC+IatDU8IiOl0D0IizF1LW/UdITTRump+v6pFOfP9WjuQ7HYhCEIRLEY4xukLmUMuqaJouAmhIGJAhBNxWyBSgx2SaCzCEbwFTHBqEaoQLjm8Ow7GkIQ7kP51CVKlRlfwSakpAoD7DGhxQ+o9yJSVo1DZyXDRbdmMY69ezvCpEzWEVp1eE9KT0dD/AOQKCaFbdjrGOkYzZ5iCa2+FP2jFY4SOg3f0R7CyW2JeEOLht+C0j2Yxj/A9mGRbgcwIW0uE5OGI6F9M44GCcSVGji54l6bNPQ6f1yKc+f6tHchp2IQ7EIQhG4ZNGbnnUxnMzkuDsASLsS3EpireFkgjRG1K0WmmPUdgCiDWG3YTiENIdiEIdjsd6uV/Bld2M1pKeMfWn2TmAjmlP2QX3l73rcYzXSGGNeI3tgGso0nzBYcR7MKMY4+vrk2wbsKDPLhzuuzDosmzeMex0j2Os3Y+6djWZB1E7pl/SvE3F8mXg5ek14ehdPmBPtcxrkggZPjPHZjGPZjGOUXAG8Fi84PoiIHAR2i8h3Nh1h82NNVLN89YGLWmdwDrDL9U03DrrLG/QNB/qkU58/1aO5DsQh2IbQhCGkSn1RbMzqxJYQLekFlK0g3AxzBgFxpcOZGaswbbs9gIQ7CH8BCaodzSENIQ/mxIx0jMJrMaq+A/d7IxeM4Af3cNQSUqAZipCzOdCO6blD5f7x4At7nQ+o+svOMoxQN2MF8owHxr7R4ylZtdY3pgByPMN808oGPa+txmdDR6dxiuY6E1U9nrpLI9rG3jd4CF+oRWdsl1Rzwdmnjtnm9xOHKwGrr9kQxQwxjN0YxjrGCNoCL3Ql3DHz1NZBrwGMykDUe521UZ/wACaMR9Fn+xRpk4zkDxE9L5PF/q/wCqRTnz/Vo27kIQmqHYmyENoQnTtUVSo9JoQK1gjrDxK1EXCuBTM2spvMzay4wFC5WNkg1EOkNoQ0hCE1djsaQhCEO5/Cu+i3SXcOr6h1gpeOzMDKBNZfw47Nnf9DuKW5qNztMY/oJvv2denuJk/Ux711HeEt0uO56G9CVeNyF03A4T6QPZcoAFxv8A8TEzTD3NUF16E3xSgJUDdEAMw11g3C0RE9fiGEvGpV9Igg1k8QqiuLUUy+xKstvqkqwCKr1JnJvxFuerLppIWsKCsYzUH3cEJZcnKgcxB3q88CGWXXrQvktEBE49+MTo3mKH1+q+T4lVmH8M5lLOaWleBfMaBzdgB0OIRU/qwv1UZDf/AKUinPn+rXHYh2ITVDsTZDsOwgWrlSrVjkHujG80cxr1nJhbeDzMWs125fFakywPKNvFo7I1F9IQmiEITVDuadhDXsdj+TKzHQraDnf8+Ic0HLXL5NYD4w24y16xTvAI4mJbfBF/6hrM9ukDKjOghwGyA1WPjqdSZwqHP/YiiU/UAjoG28Es3HEa1vUlkKmlwAMUGEKZfCsu3M/RHuKo5VzJUS9y5uiXg14gcCytBmHSo+o35/UqO4ss/wDL7zMDZeZkfkmBK+iQ5lh6vqZUFnRFszHHGV8Cj5lYghmxPgiz2RdBhNmKWNR8GT7MfDfOqf4RC7nym0ZDN9xKsnK2AiHZ3d/NX2g0vZIRIDwgvwA+0vAcR0s7d28+IwdQt2aBGWF9SB9iKHYA8MxEsF2Qf3HP+9NZvaiPR4lOakB4140jp1iDdUexCGGKv0P6ZFOfP9WuOxDsQmqHYmyHYQgKtNxCs9EToXELY2o5GKi1EqKjtxWZUqWtuvZOCALi0ArS+RAYXQQmiEIdhvDbsdh3EIdz+FXKzubR5Zeltg02h0O1fnbXRpbc9cf7HqcmDE+GZX9n+oDQBeCgKt5JuSvdQeTSnrFkpxdT3WevP9nrz/ZnP3P9hZ9XxnWKlNftJn4H6h2Q2IlRhNNJ+QSRkfpE2r6XiLgQH9mC2gWWa6LjszG36Ca2ZgzSdZgHE1DYHnVhLCxMmHE39IOv6T0lxcImCtG+U/ecxNBY+sifnsDFj5k08rfYs/GmUxFRGE4ZWeY+qshX+T6z89/s9d/7CMXWMurrHLneAH2gvkNSaFD278jNRmj4xKf1PETBhAWWUnv2VYyhNFF5nrz/AGevP9grWrglcx7efXn6/pkU58/1a47EOxCaodibIdhARAGVZrIiJLmmAM8xMiYsEQdIFtEQnCi60icS3FzJpKAxMJUOZRBYqohnDlcoByzAmiEIdh3IQhr2IQ/ht22lXKz/AFOGJS01eo/u/KcJ9E7MNyb9vzXtYPH6vY5/x5aSmJQT8BlUCE0jBpEarMLPFH52l+8F3uE4NV8ge1KhE+pAy39Tn/zGfVn6/pkU58/1aNu52ITVDsTZCE5jeMsTLqhlIvRN1j4VeGGWuGhnWFMFlb0hlQcMBWCN2HTmUzHibuY2RiWFZxAURDGWKm2pDY8zaCp9iEIdhDtohCEIfxO1xl5j4Ak6nU4SHArw6G/tPynCfRIpQwB/K95j6p9RHSM0W9HiEFKacjr1P6TiNemCdgv8mK/+hNJ/eh2qMi83WKEf+dBn1Z+v6ZFOfP8AVo7kOxCHYhKE7i8w97T3I7ZQuiggx4gcwGkoAKEgt1xCxBG0pCCXSYdGcAwF7COAg5p+8zW3wyxaoNsy6iIlsMrIC+TEnCaJz8Q7iEN4QdOxDsQf4X/BTs4Toupv/b+U4T6JKq/2e33/AJEPX7OZrPYSK1pF2o4YzfM1gYbKq+k9xXvHuR7RUfcKJurUZpQt1QL+sYygK4NPcsja+G0o27jO2nS9H/jM+rP1/TIpz5/q0dyHYhCWpDqgf9plLMJ5Y1jryiDWsvt7MMRQcTJ1gxInWV1kLcMALtwCQygAuJ6glqxL2BZE6KxIq3aWBr5lo3Gy8zQTJZWYWWXrXMfsW2E61PIRRe1hCYYQhrCEIfxH+ImMLjbPw6RHGUcpgRJ2Fs9VS5x3EktfwOkd/wDK6Rg1OpdyDT11PXXbQLPlHCIU6UjkW3d8N9I/eqRkfiP/AHM9dRilOiYkaBa3mr1YS4OOgVGV6jctI8MRAAim1y3CG7pxN4hoyPP+pm26oPiYjwv6sWzhhxznT9oQ7lf8YFWy1NukrzuqPXdZRWmj2cYD7XuG6v8AVSvIanX5ddfELLegWsVUJ7mmgzi6DSzWlY6GLxgyputaMK8UrIUoZ93Jn3iOutKV0Gf6EGmmmmkB+s0XFx9Yfr+mRTnz/Vo7kOxtKOA3WDcyD7xT0RaxGLY9ZylqxzQw+kcMA1mkGBRGmRJeAhLARxFc6TB5hl0Lau2Ni25irLmSXaysRZoeye8PBrEoSb5xBBTwobSO6ghzJqgsSOidjSEOxDuM0qHJmrWHXa7EXwasGaYPo+l5Y8GMoHV7WEVOMf5/2IjqHsgaRwvD4S/+DsQllMOGKpOwNQBMx+XMNg7Ba4GzKCrDhg5DasEAPkjkhLzC7veM9HRAXIkuaHSVowaAQXJTNvEd57CK+roRdfde/XJ2Q0UbVWAoA6+Qvky+Gq/WFPEpcpavHmCG2TQCJWqlVcQ6HQH+SpDaXuoAfafGiE6V/wADOkPrHtgBJjRPpccJQunu+9zoXtNmBRDg3uJZKFS9M48NhuEFTcBVnc5/y/8Anf8A9h1ZwIe4oBNKU4/pkU58/wBWjuQgUkZY0UOKRahnWxFO0Y1RA2E0I9I5YMQYIcQ0IMZghKQ241ii0KmaEozHVcEPGuINudJqoTpFnMtfSfRAwS14qqLs0xEzmNjrNWdIuNcQWZbjDyRd2EqDLKUIYKHkQ/jffQ4gVhANDy44hQK0AH0uIHzVj+vc3ATm7v4lRTSO9qi2v8NVuiJHdT9IRozE6bCuIr5x0kt8U+Z5san3HTaPTeaV9evWXfkZJ3OvmC04xNoxj23RjQoRXDT0LYdC6wkaasLPgIqt3d573C2WxjYDxrLB50HEP1WbO80lPXhFvtgX+oTzlhMOpCktWS1xmMkjWgR4t6pa+8JUtUGVhgA+mZ+jEbdDB0j2desYx1Z8x07Ose7/AGSKc+f6tEOyzo25jixwkSHXKZFTAWsuamqqfWLiK3mUEovOs0UQ4XHRNo0hA/MM66wxz0xRHWPaapWJxDBbyYimo65i5hDLHiGs6EC9oaxAhwgqmN6IYbIppeeIRH9A1DJ6TVjRmMu95hDS4lj/AAO9s2WALQwPl290aUyNMOuv4mDIyFJM2CAhBepimTgdeWXtGkezGBl0YMNXawNfBB8ZyTfTquOKIAA/7cxbL4O3n9lN1Q/CWzpzKrhIKBFdmPY9zNmW5zDghRCMGQub78dQiApdJbwGGczaZyK3rnogi6xflLqxFLS4zdLIVQ0h5HQ/1MZKsOPBv5mSHV8oD9uyZ/pRvYjw46FH9Rgo2HcfqbRjGMY9nsx7Mf7JFOfP9WiCjEf39YOY1s7ByI3WXThLeZtNGIwuN1PM0R0IdLhp0mpiWEBUCUZRVFeeu0SNXxGKRnEWQsK1TJ1hJmJjfg4gYhAQEE0yzPBAzFuuINYIgOalriGYLWuYFBF0I5F4hAEGRn2m2NO4y4S4g4YGbMxKh6gH7MyxWJSC37S3Gjsxix+sYiBi1Dtfl4Y2p5SAYf8AYU0BAER0te7vGMdI9lrBp5lR5DeLw7Q6eRxNdSv/AIXUKCdFB7EsRj2DsxjGUg5z8gFDsY6z6WbrrwWBjWwvX2i2q6xjHsxjGPZdY9mP9kinPn+nSgZcQlReL2hkK7XMKGV7OjDBNKYBxC4ImNJtUTMbBUdwgqOFjiEEhwllIrkIyCokTdrLv0oCb1OEKXFSGiaGdYZdIEcsSioBiB8Ry9q4gawaKg5smUxEsdUGVMzkaTVWe0zDkRLClFvzIZl97ly5cuX2vsvZjP3FixYxjHsezr/A6xcS2quOsdYxjHTs6TaLr2d4xjGPZjGPbmPZj/ZIpz5/o0VUNrmpRxTWokQM2stedZtCUINxRcwLgrSdRGJcq+wWzSOmksLnzRXTeFXHfrUYEUfVHUGfECqoyE5jqV8pjxpGlI4wgzKyTlMphcK4loyi7iqLUU1EVBcwesToYhzrKDOImMaTVekuAyDeGnp5X1wAsbOe1y5fa5cuXLj0i1GMYxj2Xu7xjGMcE3R7PY9mMYsY9j2PZjGPZjHu93+2RTnz/PWNjhDFYhvKJ1MSzOkJuUHtqnCGDeaDLNRdt+28MRagyYWaiQXWJTZCnxGmTMLAxHwtMeZbSmN25hQC5koiusB2dIGlS8t9mBCJDWC4WpnHTLMRNdwC0xI1WIDrrENkesu1xLWw6mRCXBly5cWX2Zfa+y9lix7MBv5YRa06ZjG6TwlpdfmO0nlGG3WecQm1p0zApHXtnUI0XSFJoNJ2cRmvAwlq+KRl1qJTQFrsS8KOqodfVMuxOt6QW1L41RvB7KYYmL9yP/VI+hxNQGXeFALwJegOqoW8lcoawU9kLxH/AKBE1AZhZZaoWysKniIiHOzJ/ZIpz5/logAbzMHQ4xytlLc4gxjSaq2ntYdB2CtYUsHEtcHMavEdJbNSGWZQqUcmaKhBmniZs6zQaTECOsYCAaN5YrbmCyEvMvMG9JgTR2SGNYd2LFuODr2iwKes3jbgWVZ0SXDeVmE1iW6QozUo6kJvYMXLl9rly5b/AAuXFixYsuMd2rBuWwdViRIx0Q6uT3gSvq8r0XB+kFkF4c/GYPIaoybA4vzHwWI/4qaEXkLiDF9SZmF8uPfQjmlwTY6GT8EENqJD9R7Mu8DPvkI5aC5XcTur+yLISSshpP0v12wiDq8E0Iys6gYvrGOxaV+gkpOA2gGoNnkmrKh54P8AsINwMD9T7zDtQ8HRYP0gP2rDdv8AH2lQkUjIaA4vqyrn3RPnGKgesH1NKMJ9YBxUQrXjJ2OACA6wF9dgDCsginDWKz/nLK/DUxeN3yyow0K+dFm+jiGcuDRnP6hlcn9syycJDoMCABwIoY0EXI4wD0N5bVFjH4r7oTD6X5kWfZgFhqNCy/65FOfP8dIC3SO1MFd5mKyTI5jpllsLxE1ABxmDdyordTSxdHY5m6GkfMNMwNZpBzFmudog3NQl9SOCGMQy3HXMyd4afMcENZUDiaw0l5ucpqiazRpCmKLE3IhahTViW7MJHWJoXUzTmNHhK54hQRqm7jNf1yyn9Fx6S4svssuMuPZ8Qwx1pj9wqKijQpWDxVRvk/ZLsDPIH7uVL3ABXkyaTHyAou8CmeJR/Ihi0XxxGiUKuY6y0vRSbnRNXgVxA1b3r7S22UFUCrg8Grt/HMDoBOeS/MsqfASz9v8AUZrHj4i/aC4qhu+ViNoQBo2qvpK4mPUMn7i7KYLluPT0ZzQofX6zS0CBGBfl8RQiAuwM/qUGCTsjB4jwLqVB5EwsBjk2+DMFwoUbzFjwQ2IuLzOXNOECw5Ryu/tsSxHhRRZ9Q9pZeC9rYsHFSnigq6b2C5dbZwBpXM+PjQ0PoShjqq1Rrrf0lpbrPCtLGJQ4DonWyqdI4Zq3g++JwJjl4oTToMuqrJ7XN/6pFOfP8dIbhmMq61RYKl5E+SLoMVJFiaCoaRuKoZTRjrLXBYazaViXit5TB0mviGmdI0lBMV7ylSXDpAtmkIsveJcRu3MVA+IESLUNGGAI7TUmnr21h8ENzA5mxUOsqMuSI4aM0EbaTTTrAspleSi4QBBFy5cuXFiy5cuLFlxZce15IW/ar9R2G9YRQ6ogbGiyYCQ61HMGLmgAX2iihohGurNTXETRRIZsd4KvOk0YXA8aPY1mptCM6JsHg2qPaAGa2a8EDBILLtR8S/mwlBC0JdEmGnbxjwhcBWPMYO6fcmKOkihyX9CM2QXNCZjCmw1HiyOKqEIVLBerjMzAbGwOX7XDqLbiZihxw1pTRmR7snWqzhvU19tC7uLqRrcp+PeBndBJqWvsfsiDatHBaoBWz9CVpDnbDlcVpoQpz+yO7JJijh+uYrKhx+2IGm9GsNqqMtxAwFX0gibgGddfqMJk4JaAY6UyhvlpVV6paLze0tT637/1yKc+f46KxoYQI5la1hk8TY7crdi5RjpDtayEzcN47obt4GkYaQzCO8SiYu00YiU9JW00hoysQ4TVdwGFuzHSDfY0n1gjqTFTIzI0iZhpExUxKZmlj0mL0lCkgssAKGwjZNYjRgqkzAPg8S5cuXLly5cWXFlxez2WLcYSMf0H7/c0CxMKWJbG32qsVY+BLSykm0o/TF4hJBNVu7omDOQAMaJrcVMOgzZohvDEAoLkb1vCSI49dxVgkMBNUVxpBGOqAKPpLGByl0pIQ2tq6GWDokJoXV6+zBYq/iiL+jM2l7/5mGyAK1W4OkbABeo1PjMrG3goGsa7xslr+R+6lhTQFlbsedghHkEEsLJ6VqAxwD8zAfwcKVH1uORU49A+krG3AVjfiEk/opjzPrvfCPrLE9GHKo+n1QEBa8jb/hOHyXxFLPRNFj4hrNaBkGy9dZcSHtq10MP4OKSyofET1RgxtNtKurxKjtiqtQV1qMKVkaItTS93YLkwDSLjGRQi9B2phZNg3Zte8UQSHej6g/H9cinPn+Oqu+GSNJF0h+MsfE2GkMCx3Axe0YJkRx5ibzMHsXxBjadIfEdWCs7zbsYMWILrcQxtKwSitYi3mVvXMTHM0E8S8TpDFvScjSXZPaYszMY5J9UStdYaTLREGo5TSWKSZV2UfWZy8vYpW4yVBaZZ5ly5cu5cvrLl9rl9rlxYsWMVUdZTEsRYQeKDfvUTCYrJ0qCva4GU7SAICCxDbojeCz1wwx4nM+MUJyG71YtRT8lMv19sp4AG/ci4QckPyD6ypuao3yl5jAOrsu7CxIbTIxCJv5hkSKC8RYt2S4SroP2A194Ev/JxuhIYyAxl9tjpBBvLbnYb5GOjtzE+Sk+syHfLXwUHwEM3QCKKPtATDA2eLfzGLS6SPchfjUvlZ1exHReFF6I9CDBADbrcYrIdKhV9j7AbtL2R2Y1MXIn5BH1jzhonuiC+Aj4SQTXlEpVVtlrpn4MJiNTjdCv2hZbxhj22Q+83kU8g7MZH9X0ij6y5icp8gPoQCYgJV104/rkU58/w0LG8y6Fcy5tmC3mWoYadYspoRmDRvAWxoMx8zV7LnpK7AgxG/aM2l1BfaPwgFw0LKBcpLvBsBaxMhKsiwX5mFuE2R7KRcTfsEwMkOJi5WSOsIqIKbhuxEcpeKJ9UzG80msRgOZSxxFtqCWcIuLly5ctly4svtcuLFjF7LBWQ8TVBesUXjWNgKfMStusWWKy6M1lHCxjL41m6XzF0j2FyVMXo9JaLfYyg+ijiqdV9rRsZRAHF47a9SxlIYjzEraq8xjAa4IKWRXquOkvTLkhfRRcXEdYTQvUIrb/Kv+yRTnz/AA1T8xELTMd4lqw24YEXKaxkOi3nssEHSVcOsrPSXKvsXtL1uZaEMFx06Q0IVJshgaSfBL+i31SjhsIrqMy9XAy3pHtcE2jlAzDE3jujaAMsC+qZEFQ3bT3MWyK1tZhGwlVd5gHWoYDMh4lA6huAqw17S5cuXLl97ly5cXsvZYVRAczfGTqAN3LF2ZmMzxk6Lhm5lfAaQe5NiIZ96UEzh1opUDaMIVxSotgoI0rKjmPYCVpQSjRi6w/WWYQvRMfpAAuVcfwsiMLLYWG8ZqiAShhiG23mpvAlQpaugQyWFVF3xKEL6YrLhq9EXdaYuOeQuwjDLW8EnRdAxaWbNo9hZU1aaCAEW4Rd8Srfp7/1yKc+f4avBesdaubiPGYiGNEdSUqdoMdIsZm02l5ZVNxzFhozeDCrjWZSEtvLhE98umIpUF0RvJvwxCli63gmuIQOJfsnHEdZWJWsD25hXvCnzKbgbI3VMRmjMQu5VlxlZUCpmDcd9g0TmPJdTB1iLjiULbhOOZc3e9y+6y4sWXcuX2WLB4MwB5eJvlhstNf0QeSj7fGmjKeU6Pt8xoEKog1bWudolPphDygy9ZJZZTe74/UH2lm5aL4Mzcr4saePBK8jCPspILy2hsGmHCu2L19otksnR0rHjQjWC5asHrGD7j5lvar1t0NvLFEhBGDoIrdywHLB4A6s0x+4lEQalE+mzBFq4iBaql/S+oP34lpibr1RZC/AJdt0XkLmDY/RdVuZCRUYihXpWg6uvxFnoaDRqhbYUrjtXqEvQvWAYr49jcDJWFM3M7vjaOXy6xq0vPJluEHLLe1Smo39m3WNA1KusfnOH9cinPnvrmLY6KgFYfmIqmub9i1kwgxDSBK7BlrDCNoUJUcIGskwRCiK3pMw2l3QxKt02XDAKmVmBWsS2NCbEM4ZSOuILdINpqJhUr2TLdkxdoI1G3DBKsQJw3jpe0+eGFtMncriIzzHd6EpXd2jdxuJpEuuily5cuX2LFly5cXstRZcNg5Y63kV6v8AxDdEqOAAfv5lU6kjdFHQsSjqzX1mcxtDlzUFykzRdS999IlSQtDlezrCV1Kd1tfSF4ANKnQVN7A9Fa6j0B1JqY9glGNmop+9VA4gzhJgDYLZ9QgJoK6EeteURs4qya40RhVTxD2BbFtU7GGco0HE8ZOUarrvHBbQdapgD2EA3ZRsuqtdz/EemR7y+DqfMx4fvoB8twN6IfQW0IJy+0+hfplWv0kXNX0IfQmLeCN6NTC6rm15+8+CD+0ZYzEh+M36xgbXYuwfA7PqYZh1W1dWL3cbctHzpABbQZ/i4n6/qkU5899Eq6EVDmTO1Egb0ILoy40ibJdWDi8RdmIK9+ydMFnEvxGBBL+0FemI20g60l7iy1TVkjm2IqXUVFzJMYiVpBLpHCkllKl1pEzBVLVpMseKJxLusS4IMRarL1pcXRhYYgtDEbaJWoxC0v0JhSsTaEEskSmNY+m0HbiZHEbrLz3alzdJcWXLlxZcuX2uLF7XH46TG+EB8oRiyKAdqb6oq4XzmBH2nGsp5WJDa3k8xrXtQN1k0qIVmbxCRAorav8A2Vc6DTNShsgzF/joO0vXEINAYswssuuZfq0EIOIDDgfeH4p+5Q1nia7l+Ev4i4YNOzGQaqXC+4tLFtTw3mJ3iPTD+0Ga0tHPczVHEDbU3cQLz4AhaVfEoefepupCeIqtp0ENZttLHFjmK7Cm3BD6N+mAC71+kU1Vj8otfLX7IbC88+xDEIqeJfYSjyxU5tDpF2pNS1mskZijhYcGlRUikRxRhXQ0IcRMt7mnhpEborQNUoQgpdBpk4/rkU5899cjjlBNRnQisKxFdsxfEFWkuaJa+EsOkHxFrRi8RMKnRl6i9aS/EHWkvnGILiC4g+KluJe9I56QXEXyIINwKL0Yg+GL4ityK7QRtDigmBxYrGIvY7YWHMCdot2lq0gr0iVGikO6Io0REg2ETOJe2BIKjMBggTkghcRDTFrlGr8DCBdRLJcuXFl97qXF7rFqDEy3atmh+ZUbdELoA14I0K5Ezza8sW2ujl/pZE5tCQJrTrKUJCs+TpxH9NKaZyjvMA6baLfWXrb0mFK32jumUlggF+V+0JiRYVQ3PeK/PY365BTqLy5+PE14bEK1CYXWq8s+rf09pEYqyYA6LJgorW4tSXgX+wkr+guqXUZjKsORrmfl/wDZca58u1a3OU1wRm4YyKqX2GfRv0wWlBHgkNaqCmMKHm8+8sCyBoNWJjIEKsttrZZfYmjgEdGAay/k8v8AZjX7TqJUdt68h60LHrV8l8y6ulE/2OO4s2WauEntoDRVf1yKc+e+tP0IwYeMM9J4xkwtRHjDOFwYxrgcXg8018O9aIMO4lfxACvfYDKCjwi1pBJChhag1QSFArhRjN7C8ZQMcYRKhsRaxDXcIHKChbSFEMCuUoGotUCjV4R0ReNjc6kB/G5cuXL7rFlxi4YTlEaynpGTtdq8S8zO5/BZ0EHpfQ4g4SKMP/XvDKltAafnSHeBWT5H7Rgi4DvWPC3aaHxeT5l8N3ek8hlgF1olFRfiIBABheF6wVI2CxwbeI6xYzBY2ZZEr9GAxjpFf5p3wH2lugxRRoWNjqDIW4jgenDFVqyo+FqGFjWABQ2HTJpFa69ZYn33RPvMqjRh64mVZYXMHHHzLm9nrLGRkZQ8ypjYBf8Ax7R1y9qPYYV1KsqKBvebIBqIJnLbcs74mpgo2YNj1AKN8RU1dC8Ff1yKc+e+n6uOWkRcJuEXFYRFTaVisVinErAYrFYrFYpx2KQHiAikV4SsUqAwF3FeJS9ICKQioBcDiAzFagNwGKQCARSKRSopmARWE6wCooRSHXDZgaDRAIpALgLQjaKoCEr6y+suXLl9rixhYvZZcuLFjyjFjF7LFl4j1nMYvdjHsx07ukYx66R7Mezj+Vf2SKc+e+rZekrwSspESkpxESkpKSnEBxKcSnEpxKQMBKcQHEBxAcQHEBxAcXK8QPEBxKXpA8QPECbQPEOKHFK8QPErwSvEDwQ4oHghxTpE6U6BOhK8QbYqFmkRxKVpOhDigG0xaErwQ4Jm0JW9IHiZZL73Lly4sWXLix7L2WL2v+C5jLj2WPdY9mMY9mMYx7Me7/4pFOfPfSXK7K/sAAEqB3KlSodj2QJUqBKgdlVKIECEBAlQIEqBzKJUqBCAgQ7FSoEqVAIlSLoRiwuEhUvrLlxZcuX21AfBG7fvHtcZcXsvdYxjF7r3YxjF7rHss5mtw1KS/iAN2Vbrme+Nj9QwrVJxGPZj/wCKRTnz/wCHR3IPYhBg/wAB7HYgy4QYQe49ztcuXBgwZcuXLIAtZlX98uqLVT7pcvz/AElMCy00HvACEeGcwoXrcwZcuXLlxZc1CFUsaHUprdQjrp0pvh6xawNpcWLLixe1977L3XssYtRY9nsv8Ga4JRaIBFdW9JdLLDEdxhuVdjQiVB1N/qYMZ4NzMe25G68yuyIBG50eSupePePjikns99P7ZFOfP/h0fwIdiEIP8DfiHb6zeXCX2vMvsQe49rl9hgy4M0eSLSAYL5eJve7BLhf8mCY/mhTYjYKQ+YhDbhT+d5RBpVNw7Rot3pr5d4+a1/K5cuCjaOnMTEo5upGB2VmK5zusyqyQsuXFjLixly49YvdYxZcuL3Yx/gsYfauEWjQDljNHthsK5+YFNuLP3LU2kQRHgMEAQCO/xNajnkwAqDehrgkU4tbK3Y3XpMDcAAvpoG7hpju3Ld/UTAKdqM5j2mAgit4jIWA3hIte/B8yn3wKx2/CFb7wdT+yRTnz/wCHW/Y7EP4ndamfiS6TeQIcW5YyVdd+0ZLPy8swoFFA9Wkmp2POpzdSkWxiDBljhmJf5VH7kcLmY0rmWlO1wly5cuMrPzk08WplHFy+9y4xYqcSFbqoZW9n86QCecj2A3lbB4wVcYmq4bKq/rDbHYNWtWIYok7ty5cuX1ly5cuXC0AWwoWGAWng3YeUW30MBHhqnPK7scu1lYW3QsvtcuMuXNxBl4IQ8eHQurWNW+gZxtcvtcXtcuPdYxjHuwlbfKUAcAFXsYON4dMq3Ge8DZqKH8DrWYiFlmQjdB+wufviGQTiN0XqcTC7TCXyHMp6ls4nSjVa8JkYKIIvY3X6xpDfP3F+k1UxncHkih5oZrd11fdjA7qJ54csqhMP3KX7JcrhW9ZkX5niGjbp/ZIpz57a2/8AAaym3EXLUoF2MMOYQzxENvwty+dlljKZ7nSACgOinYn66xtQdCr6plIJalfLNTaR9w8SmMIRh1pgqKqqKDVDMUZkh9S2jrNADq8RcGi4Q0Hp5O8bUjRdpBorFzcoLtwkJ4zdAvcjLl2k8oFyxld3T6o4YxKPGZcvsaTRl79o20VowpuHDEwm6WDvlpAqplQ0GjlcE1h/hbTaDiXKT1CDFxi2NnyhJ7BRQRutS/aAYZcB8IFFqGoGR6xnJCHhv8Qj6JYtoBLBbCxly5cWWwc9BjzFNpRYFa3TLczqhq0Vq48QpFCC+YFAWsoEyjVd3wQ/QMglz4nzL7OuOqgzeFBNo5xVuBZPZLsFWpSvWULrsvZjF/g9ljDw3UVRLpV0dn3mNiwDWUWHV1rzCIdABM1yX6AH3iGrZcOuZQoEVA/CnU7dWyu76QRWgboiZf5ALeDU6QSkvjYIAcAfKIwcKvJHxtpEsUb62S+rr66Wzg1vFMu45j3rkjApoYPHSJFvZg3qKy3uRkq69Wka81dRi4nJjJy6pgZbeF/2SKc+e2nT+7A063gj5DxaTaA1bT5MZ9qDwCv9huDJbXXXxE2biyuh4hK+G4/EE422NKnS7jqwcAirmr0h4FpgDrF5Dw5Pia7pU2z6lS/5UYEOBtBBNgeuCIdahytSSxJA2w1p9YY852HLOPEWAtxwesKA1cS4jZk4u/x1hmCJNHRGbEFdB1gx+oJbo9SapAqvGOh/mIARHiFAMrRHFnwWRwBncIvLeZDWuOkLhq4A69Ie91jwGbipcyBuATC8AwWqsruw681LE51+HZ0vBfrF6sPpPkkCwCLBbS/tKvghYQ2gnvNn3bhxLVG5tzH0WAN6MRYcvASr1eh2Y86dWxjXzUqNBfglSBqqTIiUwbcFwUsrir62hqimtsOqEBdWNOV0J14PRceIFQuvggENG6jaOFdWT9ItHBl0/wCiU/0WXcGdtQMPLeZCXpUlqiMw47jUTljujcmMtwUNqst4GGs1pW3K9WXLi9lix7MuMuM3K1mPnkAar+j3iwmJYPI9SCTk7eh92F0QMVugo02hZ7o0vw08S2QypVrYh4ygdd/iosYcEK9Irou9ekJsIm8Y1fTMAQqSxlAeIP5dgqYRsax4jAzqopyjAMa5zcZSA0UjhnOdYhCvlI+zKuZMWPIctV9JSkrJwN/MSVGJFsWbMLYGy2ivm+YL5Wkc4H3/ALUinPn/AMGqKAKLYC2ISbyOhUPak1ZkX4ZjMZNdL3pDgPd/UDcXDz0tmtDEIeizQjVqBthAEtaDrFrAnRF/VAFrNuHbWa1qZcHlVBqnRHVTKySLXjKrKLP8gJlJqVy6mNQLqmnJLkRpa8B0jEoRexibTWkpjVI+kSUhgrbim3RlZHxFg3L8SgwMOSDb1+0ianxIYh5dwh4hFmDUq/GYDV5PAjbT8SxwaG9mYEQDQ/TnrMSmkW6tbx0SnLOuvSYZQPsgFRKaHopzzEVM6Jt3OVn/AChIHZpAhBZ6wRfWaaqbadHwMJrAB8GZqU889PofmCKuCHxGicFSkWy45BRRkGj9YnKFI66h7Rbs3J9y/wCROE2C50Vn6FM02Vq62wRt2wbsC7mcawh1ZX8vFFq4jEHnrR+kTSmK7sW4NfiPB8S7dZRrmSI6AeXMMjCEUvg6dI3xHVX2f5Ck0qBcDi4iwa2+k51MtJUSnnLoe0rgDael1TYQ0iw6qwS8lOrwp+kpcHUr0NbdIShWaN5hmm0VQqs8oGBDresXMvsvZjFj2Y9risor9fPCdIGyL2D6iYqszwFNG+bVB5uoHqBfGsVB21YHBderBH6tINKMQKQ4HCc9mAYASnS3HzEhpcabq1eMEwO2CadfsPWHh4hV0GDn9xgl2EdSbjxH7O59h0OvtADcaXBRfQ2KizMP0iv1Hke/a6+4uEhZAYOud8swr5FSWdLG11Zcgodqrg87wR6ax1/skU58/wB+vpExr6niHDoXdFIQFTAG8AWFg2EthXqaowHxEzl0ikMhnrA81YVoLAHiFqI27pqZbf4RbVhO7CDjUXToDdiTBVnVM/Mx1rTAPVuIlVXSOmdf8jU0aHBtDSDdUgfCGfWydTESa8W0hlclliqHyv0huAEG81YcQ7rGDSkytGLboPnWNaAE3c5DYlZX0ZdbEAyrM5L1GNnYR95rM+DxTUXMx5fVPRtKKiH6y8sUGZ7JYvoKuOlblYwFXHGpu1weOWFR5O3n1V/UNbhOKYvJ0O2DUSLInYWRx7PaEAH0F/bUSi+xQJwL8Mo1aqn2LhpHlRVBrYNhC9QPkP8AJWSwJOdYYyvU4qaQtHX+AqA2CN0BgZojDD/kwmSQUB92UFhsaB0fAYNolZa03Jc2MqF5eIdUcK5YoVBSrGrxM5SwYY5jyDtvy11ly9H3BcH7ldRBZ1MMdHxsUz9pamEZgf8AriWlULqwv9e8ZrVbrL+mZQPFqA5j0S6BjjYLUEYAyRiPYFdv1NcIUmzCe4wqYPLDol1zbae1ygi08ArQ6dYSMaOrHH+opuptC9H/AGOsYsZfZj2X+FEbWNYgKfHHPkfoRcbZbfs9MEKDNj2XTU+cTqnTuZeMbRko1k6Q6d6udocQxRNo8S7lTPAComWGgwEB9qL0IzDVE50NFDfpB1HhJLnRLYxL34cuA8TRCX7sSNmZN1BqDSiMzzzcLxllNaiIWlv9kinPn/wawBhgcmai2IdxkcVuRAZmg/NjsQdMZp1RaK1SS06BCtIdU8KuiCEczsYpEX/8UZeoNiB0DWA8stoBwbEBCliUVoyy1LAofMGHoVVWn27cRADR51Z/UE3VaMGlkWNWVRHsax/DN+IP+eIwRLhnk5S1rnLKHtMYZN10HUCVxVRLec6xMIm72/ywPCc0dfMBitPPRJRCHQVHiAGAX5Ty/wCQoZ7Y/pE5UR1pr7ynzHLS81Dasr+gDaUuVlWwSso1TqJEa54WGZ6/b/kJcmoqNLBvsfeCKQV9fhuxbwqDI+jxFQ0iPkP2hFHUFY9dF3g/7iIV4OSmvmWZjM6nC8wQAxxtjBK+paEmsrwjRH1QjvIj2BpLmgvOXiSQxQsert7S1K9VWlhYvew1bV8EwqUaiN3zMdwINRvMZ5k1cvLAOKAeRklxyADm31ilN4eXvA1znAKct/tBVKBGCoGpJo07M1KWxbEkgzaKHQdfOaVq71uOSZeDxa6f3CL6oApycxtjOAA9iLvpTHq1t0/7MLfS/LOkttXbANuREklEUYo2IuCPdYy4xY9mXNM1568Mp0lI/czORlO6gg2uXSXmxlyvYhkyXzW18xl93+OzF6iULSuuo+IJQKiGNMd7ID65SX4OlXn+2RTnz/4NddU4XMO6uhl8mSoSYF0D3Mq/SCzlh0HSdBwRYe9qEIJ2nCNTJ5UpqOJ+SABqmL1TiuIiEBCc3r3qSfGF6j0Yo/KCvgJtM3WQKbobsQrm4P2ZvOiQxlib7paKPlhBzC6E3GY2PTVFIq13gRr8RRS2ueWPRfCn7lEvXmCQkNAh5hV9ogie2ajaExRqGmhOTaKxaUToI7Sz1bardrgHqHrPIZkPudJUDsyWk8riFzw1M55W7C91GSBFe0FnvqSm9V+BfdWVMtNSe629pdTZuVGX1zJdIADbGV8rYmP6b6FRe7EJF6VyQ7WBqhc9ahHQCrVbs1Y4+h5gtcB2XNbTXKbGvlu68Q+KMCgOkbKra6xJb/WmfEJDm1/JOgpUKo6VLuAIdCOzLg+sJvos1mXj5Sg9eYYHuPxtHPmLrF8y5fZe7GPa+yxjLz2Y/wDskU58/wDh1+jsimT8n8TuUBuB/UdJkoC+taxLbLV/gJ4eIuDuq5cvtcuD3Jfcly+19rlw+stdrmWXLN+kRCkekrXHGLl5ghsaeYvRci2WxIKnSm0VfOFkerqw6mmg0JlcG4zLwW6Mx6jVMuIWr0Z9TBlxZfZl9j0EI35dcuXHvce7Ll9rlxaj/Bl/wf8A0yKc+f8Az6O7CDx6Lq48PWKH8RhD+A9rg5a0BbGAhqJT2uXBlz69ggbVsCDLly+15reBDsbBcGXLl9rlz37XLlxZcvtcWLLl9rlxZcvssuX2X+D9bt9UY+BVAR4BrHWKXC0jr3Zf8X/0yKc+f/RomniLVTYVDCtwSNjYX6TQ/UnIb9miQ1Q0/iMHvcOwzeS1CVdvTpMSJYYhu3P1P3B7XBh9ci61q7TijLGlCgFnpwH1YqiFm27X2uZpWDLXSKNqB2Hs9nrAOaMXL7XLly5cuX2uXLlx7X3uXFiy+yy+69nuCXHRz0mha8a7VDjpGS2W4zaFS3MWNsdJwF0+ICfcFnU4eMT8qMv+Cx/9UinPn+nW3cIAWsADcGXlPzT+kuSi7xdeNewKFgiy9dsKG9/GICnLVZ1VwiXA1abQXSaVk71g9jMGPQytzejKwraSp0gMVMAReOjdvQgVylDrL6Bq2e6D8y/4X2Dijxz1Xt5luAgsU38r75jU2g8IQgw+kvWfAG/y16EQxXBvlWwHx7zrWCh9ROYq8HAS6uXLnMEXiMXcQTKFvSg2PoTwCu7Lly/y+1vRd9jqwJwAaJui9LxpLk3mtXEJI4RlwJAq0JiipY2ER0zxNUEsvon67XLlxYuPYLVwMaPDqS+1y4sdSi1RpHTD1EyRe191ip4ajonEu8dpvfq9dZhDA42UGuus2WNJeyDcwKzOq11Ls/MylkMjh+/MuLHusv8A9cinPn+eusXEvxbaWXAaDXGwaxBN7yvefqAJst7wx9YC4+9gDqRWh3Dc/kFvOc7EyZ2rWqjSm7ElC/3LpypwhdbtjN8QIGgrZ7J4WpGnJVSrwYezJPW0QSpdZuB1tR7xG4IKGc79TPWACzkM8vPntfozlrQef1BIRW9eb8FGvWABWPcMK2UDGAaqqNXqK6I0kmIo67xQMedKdNmBdT0y+46xU+wvQ1iEJau3LXS4pLlNxcDNu6pcucVGYiYtBoah0FPmI2DRUQ4KGTsTNooQbjJNYVh4gwZrDNMo0KL/AFDpEI3yA5awxqHA4JcdpbiuIYMqjpjP2mH4D4g0x7yDPInMBVm3VtS/QjoFaNhNbAA6zgvQ+ewi4KLVtA8wBDIutbZwfUgsiyz+5XOAreuh9SPBVMDKRigNkl9rizl1MMPUKFWv2JgO0gDmBKKilLu9OukNK2v2pjEvrXiZDqweIoRsnoOfJ/UZdXE/KmVS8U7TzsTwaYDnaG3YQbqXFizK8WVwbxuGS4a/gzKpV6uDD7BFRFKGtKvFtbjfXikseNdZvNb5sqNOCo3GzDssv/2SKc+f4aChXQlUW3r45hq5byCz61EHahtGLPgjUZuqa7GN+Z0O0rV+MSkQ4B4FdrdJph++hdFrtuw7aBGp50BxCIOISiWhhQ9kak6gbwZJkCm8vMf60JmK1VLw2hqn6Qx9Ul3u0LS3u4/l+JBRVOBYcYXXSP2vFd2A2xsOgov5YSq3evrpGhAHUPS/J7xEEsNQ3JpbAdST9HxC4ETN0A+rEoVEHa48blJTcKb0PrC+OADzHJgCnqG9iIHc6gM/qBH1xACdPdVspHkEMrl6vMSOeJllYOGsYNSjDKBrC7vvRHAIqO3OYqm26mPlC7pUqf8Ao/UyQAr2zmILhCtGT4g641Y4l4zHUPSKF7iBQqoCWCP3oYf8fMs369AfUWP5XY6seuMisiNjBeEQE61Tflm2SUwK81czZhMm3iHFLRl4itUEH6Me8VYooHrkjtUatg8/6y8/Sa25Xf8AUuGAiPKXES3nm2MvjQjhgcNUtfti8uCji4TLtsrQDeqZpdBsHmLnmGg8v1glvl5tWGiOIfVlzQ7r7RaClEyhm25DR5AdGvpt8y8CsSeOIx9rnwU+0Xwtoq1l8K95UWCQY/OYudchvCpILrRuPtzDt3LtR1lUVUbIaGJZRK81vBoShPQbqYsX3+xvnc5hVJoA0V9G0SIcBOWGtkoSowhTUCiLuRTZxbLsnzXzFl663XQ8x8jaPvK6rVXEagbQBAUNyMmG+JmWaDAX+oXrxXoTg3/SLMy5Wr6+8VEezFLp04ofpKA2iaNNgIfEIjm+h9INiHD0/wDbIpz5/hphrFMYgkbs0zpl95pc2DyfQmoQu5pwj6Yxhpk3lieNOwbJs2qBONgsQ0eKNCXtc1Dq6ntGn1lmZqB0wS8SwJTZf2EBbZlaDgvyPzCpDCbY/wAuKlqbgGge0JJtks2sMDYz61E3P72qMlYFzQSkpPqCOiOIGN3+RsyITLYaafWA+nTWprRokpxvopLLIXVTvT/sN83mxizZlBKHg6kZU/1qEJucwH3J8QCQ1pwTde/FxG9mkUJXbWaX2TKw2WtS6e0EBw6gtoXoa4lm+KCRYxDZf8OsQBugZ6U2A0QVKvhwbR7RFLpZmWw6tIdw38zWJkTXowDvB1SkfpUWB0si3WPZjSdkqXqUZcRug+pAtVrgxGdBKekRVxVQpprAkGPHPS+sKEi9UZXltlJlVbyaB1ZSip+tzjg/7AIpywUKhpHSAnCzwEG/AVF5Nh+4g8shQ+MylO6C+RerCY7ia/5BEUCsswmShjlFx9jeGlxU5tCYPx9JCui1sHddGZPIAahR/UZVUpcqtIxoHa7C7U6SiSgfRf3IEGx3xChVbKvIM1Uyyg7AopgF5QirKo1L9lEq9IWmDr0mWE0GiheehrGG4gA5+TPNQwtHpdunoWE51B5K/wBWP9jZwVWOsvVYG21s0dIpdi3U12yvK/N4s2aLRroDSF7UIVqZVzDrKmeEezL7QYjw5nq5xHyTjdgIjpu8xl4BXF1HuYteYioEU1A1z9TvKJ0oYtav5tAItKJbnKkXono4IDy/DX3zMRXVuh2F7SnsK0ZAKFpvsHugh2ItR8uTXF7QnmCi3gNPvBUHYIFoecnvBhBwsln/AGJgQSSeokxdge7HbrXK+ww0Ncxm9z2f+2RTnz31tG2H6QopvkpYfVCqby0D3lXSs9Y5+gXA1KTQf5VEGXe5qbd7tva4MTMCtFWfaNJIKOez+ktEhYOrPBMAWaUvSujd1gEhKrXBTN+JfKZ6mIns+sbmfp68t5h8FG2g94iajDKqEK8wLL9qdWvpEfU1W84vxgxA90Y5tj6EoaPhNDDoYX0IqB+oB+GkSVYehrGOksRlRuAB+8vmrQRFE0hmBw6LSCq0B8I9533cA+rDmWs00CUINUsG+swcnXElB85lGLAAeT9VgR3ugWdeJgsUv+DlL5uItZdpeb8EUtYs12Rf/EL6saqbY1Q1QgsFXcWHUJsLqhQqei3UDFgWLER0wCROsV1siyg0r3ZcBtQfcJeOHDg6rXoBnwEL5mIi1qTxosUNRSFuv+Q6bSjFQj9hAKpQzCMg0+xRQIvcmPL2hcel9cc/NRM4h0zfJl6QAD8zR8sbxmLXxEbLNmo90cuvZ5L9IgkGwWD8YmAJRZdXqyzkqV4Mvo/RH1jRDkIdKAAWJ5PaoWCUge76rB09eBfSZfNQLLE4qiHWXDpo/Y+YtAbAgdfGlp0PeX2gkbnLfu/SKa9tdttR92Lo7Don0LfmoIScivdc4FhibSZY3q6c1rLVgKQqvEuyUOoH6SzpkxvUIzBq9RUcoixSb6iYJblgGfpGYvtu6HLrK2ioc+hF+YFiVUUWON78TzKUWHQXvF1A2au63HlB12adK3OjLZCFqDWS6HG8QBXNH51+kz4w/YRjByy08GX2gu2JVaWD0vVHerzoCOFh2LTzekWMPXdNwf2hFa4RRZ+CMv0z6h0eCGsNz1e/vnL4iGQQaWg/jWACRFa3HX2jdD3xLCOhoS5EajAT9/8AtkU58/w1REBl+E+8XWt5vjHk3IMwYKX9LwTAlNzxtfMQXrfiCBEwJd9V5t1l5veGVG2KSmJyA/IMsKWzSG/Lu+WWtr0b0hgD2iT8yFXJNTpHdA2BR7rHtHP6E8WvouIrZ5Bv0L6QTiGW+vg8yhJMtzpv9y2W0dVxUaEZZ1reCYnDMILmr37zOwI4luxhjmMu53hfqlT+a7Dpe/nmIzBp1S48tgKzzD4By0mMK4SLdUH1rNLNtoskZE2DWt4PLpHDmU5RsOkaV8ypilFWBuY3mQG7iH/Cf5KRw0ZtviMz1xkQC2/o04AwQxRZvqdpSxqVlWrb5vSC80wuLxKDijWrzx5il8Yf8IhgWyl/BBGkbIubtXtPZU8TXpfMwUhE0S+L53gqAthWyRtecTeaYbXxCynVOhoq9oWBmvKbBu9JR0o7IdjkfEY+j4kBPYtqG+Gaj7k3jUAAKWXVWx8LLIZBnuNalEWeMfQCAE6vpqzOdDc2Rm88PssdJrCFAzSozsy03TCiA00iD4IuDHgOs+yPmPidS17uY7BqmwacA+swQ6CeBLAnrArrpKQaEig0o2mwURC9er1Yop+SXACSzf7j6kFQ6sV4jpBK0w2+7gY1JQagn415hoy18XVnLYyzGpItIY9rlN20nu2/U2hB61PJ1PeKbDv9INOkoeAEqkrw+8DRxTbmx3dZnRnm3VvnrGy34v8Ak/GPtMH/ABoAFa+GI1YVLJeolVAKtDtcQdVZs5rqGkcbZK3xLz/qK+Kup0lTGWOq2PcRB7KKHwHWphTiKnc/4wF5ii1X7EWIWtLtzACa7Q4QAqLWSIV0S+UQcvJ5IzBSYT/2yKc+f4aY4m0QRBKvc+Y0buKlXsf7GDzzt237b9/r3d02xJWy1XufMZW7YT6H+x447s+vcazvBxhokv1h8PaaHxrFqnz3Q8McygTe+VGgAujP97va451csRWBrLVcqtRJr0WC2JE0lsBCsEi+lWrL7D5g+8fFSmS8QgCqj6V9JZBx2YJfYKUBEr4MyjwLXsJjeGjomsQ2Hbsg8GNNBCD9E0EbKmV3HzNs4Yr+CMVJqsv57XmXLgYDowyqv5BSrxPofeXcuX3vsgEcEb/2IccNIR400imaBcHgq/g6RgLaDVntpDjz0SKkbYp8ovjxFi9rjGabrLWvJXugsqUw2dYswY8n1CHSLqdC6zneFaTojoOGcpNdibH/AMQ+1aR0hMq8z5m3OBsvrGxehPdXkOsJ7fYiWTG6/TaKCBS93/2yKc+e1iVKlSpUqVKlSpUqVKlSpUqVKlSu1SpUrs/M+Z8w95fcg9r/AIXCX2uDLlwZcP4XLly5cslkslksly5cuX/C4xYsWLL7XGX/AAuMf4XHtUqOlRvIRskQFiN3J4gIgpqxVT80lSpUqVKlSpUqVKlSpUqVKlSpUqVK7fSe5TnzBTQKuejn+T8c+0/HPtPxz7T8c+0/HPtPxz7T8c+0/HPtPxz7T8c+0/HPtPxz7T8c+0/HPtPxz7T8c+0/HPtPxz7T8c+0/HPtPxz7T8c+0/HPtPxz7T8c+0/HPtPxz7T8c+0/HPtPxz7T8c+0/GPtPxz7T88+0/PPtPzz7Ti/M6T8M+0/DPtPwz7T8E+0/BPtPwT7T80+0/NPtPzT7T8c+0/NPtPxT7T8U+0/FPtPQf8AE/BPtD8k/U/LPtPyz7T8s+0/LPtPyz7T8s+0/LPtPyT7T8k+0/JPtPyT7T8k+0/LPtPyz7T8s+0/LPtPyz7T8s+0/LPtH8k/U/BPtPQf8T8U+0/FPtPxT7T80+0/NPtPzT7T80+0/NPtPwT7T8E+0/BPtPwz7T8M+0/DPtPyz7T88+0/PPtPzz7T8c+0/GPtPxz7T8c+0/HPtPxz7Tw/hMv5nxPxz7T8c+0/HPtPxz7T8c+0/HPtPxz7T8c+0/HPtPxz7T8c+0/HPtPxz7T8c+0/HPtPxz7T8c+0/HPtPxz7T8c+0/HPtPxz7T8c+0/HPtPxz7T0c/yXO1VbuU/X/wDBUdSJldbxPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6dMgDzQng+bV81NAHmjPTp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRp6NPRoYUYOD/8AA6ifofqfdP3/ANR1f/wX/8QALhAAAgIBAwMEAwEAAgIDAQAAAQIAAxEEEiExEBMUMiIwIAUzQUAjUUJxYVIV/9oACAECAAEIANonE4nE4nE4nE4nE4nE4nE4nE4mFmFmFmBPjPjPjPjPjOJxPjOJ8Z8ZxOJxPjOJ8ZxOJ8ZxPjPjPjMLMLMLMLOJxOJxOJxOJxOJxOJxOJxOJxABNaAEEfpMzOI+qVeg1ixLA/IzMxtWqnErtFgyMzMsuFfVNSrnAzMzMzMmWWBBkjVqTiZmZmZmTMzJm4zMyZkzJmTMmZMzN0zMzMzMmZmZkzMzMzMzMzMzMzMzMzMzMzMzMzMqPM13sj9D21VuPgOsKkdarCjZh1KCHVII5yczSHahJbVIDPU1zU2CwArQcOCfVVw6pBEsV+Ve5E6jVIZqWDJkL7hB0+jMzMzMzMzMz/zavdNd/OP0PbUHNhmkXLEm9QUPYwDtvIXaACeAZ/kXr2II5lblDkHJ6wN8cRPcIOn45/5Wfp/+WvRera1BK9artiVdZrvZH6HtqBhzNNYEbnUXKEIH+wzSKCDmz3HtpWCvzYQWOP8AIvWf7Lv5rFODmE557DpF9wg6ds/UWA6tqAPb6hpTaX6/jn6bX2LuGn1RsbB/IkDk26xEHF/7TPR9Za8LMZ+s0+0Amr3TXfzj9D21NO8bgQR15lFBc5Now5mj6GWe4zA257/+sUc9rv5rFUngHjsIvug6fUzher6j/wDLOT1yTFqY8xFCjA/PPbM1V5RwJVepUA57X/zMot8d5WI25c93cIMmnUixtsv1ApE1P7Pd7bLmsOWCluiaO1pXoSrAtpXXG0Ve6a7+cfoe7VK3UUIIAP8AGqRjkqoXgGpCcnVVYwVnWUUjZ8hUg6eFIyKRgqiDkNUjcnxJPEggrUfgXUHEz2zMx7VTq+rY8Iz2HruaU1GwZiVKsIB75/M2KDiCfsa8qTKXsLjOpvNVc0v7HecC3Ur0mtTaRauguDr2tuWsc639gWOF/VWc862remYNK5YqBpa6ubTrK6xit9ba3Ty2OcT9fSVGTV7prvZH6H6SAeraZDF06L06Sy5E6vrT/wCrXu08rQXvF1LiVakNwwIP4X17uQlrLEuVpbeqdDqWaEg8zMSouMRNJ/8ApECDA+q60ViXa4+TK6TVrYJrK2t+MTS+Fd0ceqUrKdN6fLH1HqHCrfRupGf1ZKnaTP2F7htvbQW7HwbLc05F+tOSqFieq1s3QaS0zSaNg+WrTYu2Ve6a7+cfofs1Wpx8VZi3XuBMQcSm0qYHB6TPbUKF+ULGCLWzdE0o/wDZqxtwK69vJ7Z/LOJZqQrYCtkZ7a2lnBw6FDtP6/TN7iBgYl3KGU3iq4qddrFYYGj06kZjqHXbKNKa23HrP2iYPbQVB3ybK9lJEvGLDNNZUvD6fwt1FNYgrUciVe6a7+cfofr1d2xdoznk9sziZ7AGYiOV6V27uuYwzDptx5GmQQVqOgxM9s98x7VWVXizpMzP+zVapa1hvZ7A50z7l7YzwbtGHbMqQIMCahgqRk87Oy06V2b5esWk7Cdey2YGldnXmft04z2/XH5mXDNZmrQiwkyq96vbov2AbgqwYZEq901384/Q/UxwMyxi7En8MQCdIDM9gSDkI24Z/Gx9olWsDWlQDkZ/BjxNdaxfaP1w/wCsQdmGRNfUwbcZ+vfcg763VCsTSagWLMjrNdqGb4JoNGU6tQNp23aF2s3Ff1wOHFSbFx2/aJlD2/Xn/si8rNVoVsGQP1wBIN+leqKxQ7h+u1m/gyr3TXfzj9D9Wss2rgCY7Y78wD8Myh/8/DOJr9TtG0KxVtwq1aBcz1iT1iT1iS/XqBw7l2LHR6sV/FhrUnrEnrUmotrtUgkYM/WH49rrNizU3G18z9fcVbbPesXSgNkgBeBLrRWs0+u8j7R21y5SEYOJomC28r+xQDE//pJP/wChXnMu1VVnXVVop3J+vbbZiIcqDKvdNd/OP0P1a3lhMQiYmOw7ZhYQ2/8AhTnshw2ZnvZkjjVoyvlpmZnMz+PM57/q/b219bspCkEHBqfY4M0z5XvmfstR/wCo/VJk576kZSXLtcj8c9tM2LQZpjmsSr3TXfzj9D9WrTjd2JnkEDAwmbhN8L4llmYGlT5HZOTif5+GooFi4NtRqbafs/We3syhhia/S4+Yn699yCZ7WHC5msfdaZ+qYAQHtcPgZqxi0/mhwwM0Z/65V1mu/nH6H6rF3KRH+PWy45xN8RsRnzNxgJjNGExKXwcEHMpXnP5fsVXg/b+s9nfUBSvNoAYhf1Z+I76g/GWHLEyi40tkaf8AYIwja5AJqf2e72u5c7m/JeomiPwlXumu/nH6H6tTeKVzG1HlyYOTBsxA6/4SDMwmIg6nYk8Sno6belDcc0up4HfpL9Qta5N1ptbcQCemxpsabGgRjE0TshJat1ODsabGmxpsabWn60ELyIzhRNbrM/BZ+tTCDvqB8ZYMOR2HEye4BM2NNjTY02NNjREYkAaIYSVe6a7+cfofq/ZKTXkI0MERljsv+ZjGVifHEcj/ADdmK2FmkY+TsbBDaol+vVeBZa1hy0/X1cbjYUrGSm1hkWslQyamSwZAAnjE8azxLLSlYyamS0ZHjUdVKLzLNWqDnUa4vwn/ANytN7BRpk2r3ddy4muqKPu/L9dTvbdBpEnokno0nokno0g0aCKoUYFXumu/nH6H6tSu6siHgwmCCMYsMU4mSewmcCaIZfPbV0u3KOzg4btVUbG2hVFScam82tNJqGRts1VzO2DpbXR8KhyO7nAmrvZ22nT2ujYXl0moS6swknr2/X6ck7yowMfhrNMLFltTVHDd6qmtbA0On8a/RV7prv5x+h/M9yMjE1SCuwiNFMEYRIwm3mAdv9h5mkTauex5lumWwc26Bl5VdLaTiabTCoQjM1Wk3fJNJpvGNx1OlFgyNLpvGMkd+s1WlFgyNJpNnLDjiMgaX6BTyH0liyjQsxy9NQrHH4Yl+kWwS39YQfj/APz7JV+sYn5abRCvqBjp+dXumu/nH6H8z+Gs0YuG4WoUbBixjFhbPYRjBzKqHcxRtGIe+MzA+vrB3YnMDL/qbSMj6NogGPqq901384/Q/Zr69thPYNC0U57EwNDKxlsSpdqgfeTA2fwJwITntSee4jOEHK3EtB9N2oFfApuWwfhV7prv5x+h+sz9hTuXeGH+9hiLicQkTPbRVbmyfpz+TRTj8MQqRMSkY5/Bzk8ofkIIXVeoIbp+LZ2nD5B5oDFxgd6vdNd/OP0P1mMNwwdXV43x3Sf5CeyCaIcH/gNBBCcTccwHIlh7VNnj8G6xesd9i5hOetVhVoD/AL+FtwrEo1BdsNfWhGWLY4XSvvTB7Ve6a7+cfoft/ZLtbdMTETsywLiZxNC3H4n6RMwz/YCI3PZGGIw3dDxEODBLXyZS/wDhf3ResubJx3ruULy96heKryG+VuoJPxZi3JrbawM1FiuPjNEfkR3q901384/Q/b+zG4DGYDAZmFpuz20X4n6D9Oewj528RDg5lnWCE5P16P396vdNd/OP0P1GNYq9bNQW4DruGDdQUPGD/omewErqJMrXaMQOQYHB/wCMIJaoHSPBz9mj9/er3TXfzj9D9Bll6pH1LHoSW69iAY+nUyxNrYgE09IfqtKiBQPwDmBwfrwZiYmJibTNhxNpm0xRg8tbxwSTAOZYMGIQpybCrcr2FbGeJp4XxmClzDUw6+Jp4mniaaStlbJ7Ve6a7+cfofyJA6vqUXo+oZ4efz1K/KAYmnGE/LPYNiAgzH4EdwO7d6we4EdCDnvSmTmGtWOTbSeq47VoWOIAAMfXV7prv5x+h/D/AO5dqQvCvaz9c/S9IeDSrANox9GewOIOfwxMTHfGYEmz8mqBgoEAxwOzUq8GmERFTp9dXumu/nH6HuzBRk2aln4U8/YPsBg5+np3BmQIJuEELAdicdQwPQsB1DA9N6jqHHWb1gYHoLFhYL18ixnVeqsG6d6vdNd/OP0PfVXbjtX/AI47ZmcGdfqqVUqNrXKr1C1UtRQFXUoqPha3R38athGIVaVWttye0SpA7EsNt6EhMJV5WsANfmTiutSt6BbBtqZXbaVUW24VnUEq2mXyP8rXGMRHWtcl1CsrL3q901384/Q9rG2qTCef+Px3HZD/AJ9WC2mwGymlAO22ohxqU+SkVeWqzYQlaXHNaKVaV+IEh6ChLqmmBVGZqnYV4a1x6eWM1KKK7uHV57asynC2iI9huKsnkDN4qmLo2/8A7NqvHyyLYQe9Xumu/nH6Htq3wu3/AIZ7nufwXhvqRmrOVdmc5dLLEGFYFjlxbaBiBf8AyAy5CqoUYmCDuVt78MoZD8Cpc5sXegwuwscsEbgM6bp/2kYIqK8oVd/eEZPYEJO5+9Xumu/nH6Htqmy//Fz+B/A8cxTkfjj8K6jYCxsQ1claSQCzKyNsPpznbN2OC1ViKHaM3OAyNWV3M3/hketgG+TtsXJrYq4Wx1LgOzAKCjgEqbBt3RlsQKzO59q4dH2t3q901384/Qwyw5Y/efvq6fR/ks406x+dMM1lN/z1APky2lZN+T80sJjMXoBZBZZym6ytmxc3xQlcqnlmp3DaYoaoqo1APlMR3YOH0numk95lSkAubGZqlZhurXfLjtsUnvV7prv5x+hlnCmbDnM2GbDNhmwwIZsM2GbDNhmwzZNhmwzaZtm2bZtM2zbNsxMTExMTExMSofSjps8dlrh1CJupcDdbYbHDAPQG8k5clz5AahXBXjoUwpjuLFVRutRfjZe1uFXyWIQzMxus3QPsLgpmvDxbETJrRLEXAN7ugSE2oMh3N7BVHer3TXfzj9DGGRieGeITxTwzwzwzxTxTxCeKeKeKeKeOeOeOeOeOeOeMTZNk2TZNk2TZNk2TZFXH047Y/DHfH31e6a7+cfofvx93kXOJxLL1XiIcjP4rqEL7J1+/iDNzbVA2OVisG6ZAldqucD8qvdNd/OP0P1c/jdqFq4PkXbvnrqydoBzyHYKMmu9LBwDnubFBx+GpuIOBRU7HJuYsdo0tKsN0A4/Cx1VeUQ2PlVG0Y7Dt0GYlyufqsYZClsFSUO1KzhH8fIZtxyBYayMVXEHczahm4Fedvy71e6a7+cfofoa1VO02vsQtKdUWrLGjU2KxNlFwtGZZeidbP2BbhH01l43udppmn0/kbdNTb4U49StoKMoWuolKD8Bl7FTrdq1rxHrBcWF32pmaa7yCHpNOA1hJWxckC2xhaSumwi4l9uwZC2DAzCwXrq13czSbh79XZsAAQ4XJW5WOIbVEv1JDbBparjZ8h+X/ANzc2N83O2WVUa+Vpv5bODz8fado5g6gwfE7oqk8QDA/Cr3TXfzj9D9Dtv1GDqmUV4LI3gwqI3j3WUaha6+W1C2M2dDWX+Ta1tlfHiD6fE01npeG17h0GASchkrNdJjajd7Lwz1YYIgrBfaW/wC0m9LVwarqaRG1D2+yis1qWbTfMEwVFLiQA1iHa6kIFa5XNqkai1lUIieRWxa7BnChFIs2mwmwCXW/EVrsFNRIbTs4DRrlrbcaNYtjbR+TMFHJZlUrKbWrU4Won5FVCjA9O27MOmYGGplrOCMjjwuBwM5yB0571e6a7+cfofo11Fq2b66aNRe3/Yf1+45IpULtj/rw5+WoSpLQDQAEGNZUbK8BF1P85VoV2AM+h3nlNAiSyhWTZKf1yVnM9GC2WfRBzz4F2bI36pCYn6yteZbXcHwmmSw14d676nITTaVgCztXqKnOyjTOTusetajuZ3dTvFSnUPl9Xp7FYPXTTdafm2nBXAbQ4BK+kYVFSo1J+Eo0YCYavTIh3D8nr34MagGCon3dPwxBSobd28a53fjV7prv5x+h+ggGYA/Cyqsnc4xjibQPxOB+ORMTEIGZj/xgTEapWOTsBgQDkYzMY74m0dfwx3BBjOq8EEffV7prv5x+h/Isq9fwLAdT0hJY5IcINorsLnEZ1XqWGcH/AOe1o/00tyQO24vEX5cdn4JBQ5XPYnAzBap7FgOpYDr3DqTjuTjr/wDA57OCVOEcBhhmyxIoUgc/dV7prv5x+h7M6qcG19i5BuO3lNRtzLGV2JKWA4BLqvBFit0ttbOAinmbxUoDWHBIGbK8gVuqnaAd/EcqSTA24ZKHaRhmC9T/ANpwKzhSxrck4Z+FzEUHqF3qWKcrDYojA7d5VlwMM7E4gB6HoxBVwPjN27iMVJOUdtu4+VY1m5finy+QD7cGNawGRY6kgxGBzkHA3DIAyWtyMI6EEiEqcGWN8cLSfhylqucD7KvdNd/OP0PZ+Xyb3BwBS65YsR/5LrySrqK8G7LclVxkkZwATSUOX2sSSWcKxAYkcSrGfkGzhYzLlp7huatwx3MrktkE+TJYV2FMBEsByWIB+WMDJQKSxAchIljKvxZBxAMLyudyy1iSNxYfIxB03b+ApC+UjBq2/FmDMFUg7QCA+CWm5BwWUAjNgJbNa/L4qGUnbLHBbhmL/F3QDCrUw5BUkMCVbNeBWhzub7KvdNd/OP0PYgqxM2F+AtAHBKgjE9OuMH04hpGOCc9VqzncKv8A9MCrbhs3nAKKTANg2stZbJZaAOoqZRgOjl8FasLiLWcjPjZeFNZb3KhTiVrgHNleeQiM3VkIIKisgZhYHkCvI58eeopA6r8BtY1+TlvEP9VAvR1LDhn4yK1ZoKSoIApwcgVEe0VFfbcj4xK6j1Y1NyI6nA2k7ugpBXBNeG2tSSSQPsq901384wyJ4jPEZ4jPEZ4jPEZ4jPEZ4jPEZ4jPEZ4jPEZ4jPEZ4TPCZ4TPCZ4TPCZ4TPCZ4TPAZ4TPAZ4DPAZ4DPAZ4DBQZ4DPAZ4TPCZ4DBQZ4TPCZ4TPCZ4TPCZ4jPEZ4TPEY+mLchKNgwPEZ4jPEZ4jPEZ4jPEZ4jPEZ4jPEZ4jEQqczX/znqZ6mepnqZ6mepnqZ6mepnqZ6mepnqZ6mepnqZ6meonqJ6iepnqJ6iepnqZ6mepnqZ6mepnqZ6mepnqZ6mepnqZ6mepnqZ6mepnqZ6meonqZ6ieonqJ6mepnqZ6mepnqZ6mepnqZ6mepnqZ6mepnqZ6mepl7+UAf8gfSew+k/wDI/8QAHhABAAICAwEBAQAAAAAAAAAAAQACEDAgQFBgcAP/2gAIAQIACQkA+Ifi3D9e6H2V9N1sHkEIZAgAaEi63DqEXcRFdz3APWNBA7jDonAfSegeYq5Veq/n732OoAgAHQAA+feg+kQ3n6g/hTh+UfrgAD7x+DYxi+eFZXhUKlJSfzr6Y2zU9dVYxVVllXzmWlo4YxxaMfQeBgDiHpGXFo5LS34A990pxN7aOHouSOXLxOK8DadUHLmzizlji0thdQ8noMTg8HQwr0HmeQeebTU8zssYYesZTuECENAlWW4nBIErlh0yrFlIlZWNsFrVOFIyvCmFs5pF+Bd4AAAAAAAAAAAAAAAAAAAAAHwn/8QALBAAAgICAQMDAwMFAQAAAAAAACERARAxIFBBMEBxUSICsWFg4cGQgYBwEv/aAAgBAgAKPwD/AFReV0t+OeL6nvt0t+lXLWNXw3iOtP1j6MxYXUlxXgd9PfoVjflorqHfw76138Xfpj8vfyz099bn1G+nomucVWV1SeDGMfFjzHQ341/b0myLJvue4hH1YX2kXRN2QTJ/jEUI0QT9xF30/Rs2OzeJknM/aRh2P7jsLC/UVH1dSeVeGLKGKswLE9PiiaIkYx5ZsZvGiKodkxjY7J6jo9j6hnf+uHh3rDvZ8Y7HYVaO476ghURYqH8GxznWPckVG8O8PC/f6F0qOcegihfHDt6RcIwvLPJcpF4PpFQjR8kcN+ikggWZGVWWMVcHjeGIebR3HjRrwxViHmeD9AvMuCwrGIYx2awsPyMn9v8A8E81wXB9vR+4vTOScPK0ThXGXZ7E2K8Lj7cVeHh3hZ0e4iaIr4NYZoizfo+9Zj4o7DnZsk7iETVnY3RruSL84ZMCxP6Cv8HbFQTJ/Bohkm6NXsRApHWJsnHuL8kwUbKWF6Kas/8ANC4MZskkisTwkdmiMTw0PY+E1wY8bxeJxsdDxf6E1+wn/wAW/8QAMRAAAgICAAUEAwABAwUBAQEAAQIDABEEEgUQIRMxFCAGMjAiQUAjFVEzUEI0YVIk/9oACAEDAAEIAMm5Nybk3JuTcm5Nybk3JuTcm5Nybk3JuTcm5Nybk3JuTcm5Nybk3JuTcm5Nybk3JuTcm5Nybk3JuTcm5Nybk3JuTcm5Nybk3JuTcm5Nybk3JuTcm5Nybk3JuTdQ5fqBmpqu1Om49HRkOD0XVdhmyRmM4PSKIyej6zoM/JIy5wDquBm4xcXFxcXFxcC4uBcXFxcXFwLgXAuLi4uLj/TNdP8APrqRZ/s+lDA+ksYkXFGtIaNWSqMKBdzu4q6shF9rJdWNkJDTjKED2slGpJXjZOzJA7+h1XF1lKyYLen7MXH/AIA3T/PrrjEYu4xCgDXYhx1z08YL8RJA7kX/ADW9OmQbJGJBggY7C8P9A1vT9GP04/1GP+iQSN6Jy+V/Sbl8kIyxun+fXXbijF2Yy69teFi+T03GIIxH+I6bQJTtGCEGT60+l/zYv+41YZGKBgY6t6U/sCk1Ncn1GstmiCenwx8z1iTjYC7miYFDH5AE+mvy+WdsDQ+pSN/Uut9f04PVYY4x/P2Tf9xO3Cbp/n11puA4IIbuPSzzhFwIjlBdz8hU/EXiPHjrnvW9OkP5tSQBmjuOrehp/Tiqhb0TX/6qmPQLj1Mqg4rsWOT+rQ0/OjESwsCSMdNc4kF5hqCflsU6upVsdUjLnAm1TEvEdbWadsDln1RiOOfU0INReGKSaOIZef7DpwnA3Ps6SRMkW2jk8RN0/wA/gsrr6Gdzck1ZXUYDMW7kTOBgasuchumxMS/8mVz6iV6HYHIMjnsVldfTyvfK5pkY9vgEYjNNx1WNm9I9bH5LGo9FUE2aVY+1aZmoODn4Y+QjYjIN5DOUnUXfg1I9ZhHpanupuBeZ/XpNNeNodVmJI+v7CzI+jLzTVOvKVNigaU4HI/reQJdj7drCOUcPLtgwSgg881Y4VleXnm5uHg0k+v7e0ePag+uacX5HR1NdC15ztieZiDdP8/1A4q7LitsO3rUhZ/RNL/8ApdZFvgW+2U1tVTZNYr6YI9esMnD/ACXiBpiYWOEvV11FCY6NMI6+3n8Xcuct+qGFpDgaP1pDrHzcz5ZJpyFH5ZsJrOJTtcyfcfDa7vyqZZRzLnDc0CRI3LDyzWkkl09sw7AZfswWSQTKB3v1fl8EqmZ79n0vPr+VY4sTcN5V9diKLNPHEkS8KTbkMP8A3H59oped8/hn1zFBI/GxNN0/z/UOutrZ/plUD0x0Bpa5p72WEEVlK/CElu1Ci8IFaRV9X2//AOVkJbJkk4vTrj44sWm8ilgy4OLi8n3I9WZXfX2Y9iMSR/ZuaRzN4UJyc2E/2Lu6L7OhFOnIeTymUSvzLcleQ8SMUbiOzumZApv0+Xu6dPs+7JrwhEil45s3lbcepGbznS3pf719wbMbYYzyH1MjHsabp/n+zWgMhzVGO1x8e1LC5zWQN6yRFOgOKuzwjAO05pkc+vc3HxwakLOcDY1mgOHx0xeWcsl3JAiJyqKDUbXTZjKPg0HF1eaTa6MiSuXOTddCz2LaHK4oIpeY861oYT405PsbcfnSL6yH1RJJtIEf+b9Ql4dgL0+2pmFDYTiQX6/Osumqi7vLYN1cSc55BJptxVlKnBpun+f61GTiwpwLjpmjoaSbgmlbjoRxDFZeE4+KJxG7XJJYNVdhiMdvgvc361oxDX87fYW4tx+q9jfq25E0ZhF59B4tuQdeUcrfdl4F5lpPqSmNgP8AF5Hoxg+4n57zgbjjgXYbiHFofYo9bV8Ibn+xwNCZH42z0+uS+PaQ9PtS51VNfs15dzWXUcMj/apGVWTlvO4N4cImhSdCkn2DlHs5P5pun+f69ROJs09r60XNz1ZvgLOn/t8BfrnKvcSeV54FniMTbPKdhJGS/wDF7N/4vZv/ABezdH6/szuOLW101oliTn/I3nf3EB5Vsg3/AIvZv/FbN0dfb1JVkVG4lDX7UmNsnpBCZWAHJ+XDRgAP2rRDxjYH4tX3WKBKST36QQtK3CN/k8mmitJ05ZJ45g1Q5UG/YYXm1CEbkuwTm/8AB7N/4TasHLtyE5HI9vZmQx7P2mDyaoeuMMRTdP8AP9el2BvFQbm56mgZqxFqNb/q44Tjo65W46x4B7/X9mCXWEcVxcXFx8MXFxcdPtf/ANXTkWxDBsK8ysHAZd+AbGu8d2U4Xx1//L9V5eJJvK33Cb+lTrqnD3l8nk1o26YuLi46c4i8unIt2RwyGm6f5/r1Xx/NAqgmiFjfEV9eE0Rk3wmpCc2OICsLMmD0dsLTcddHdk1JRImhuJuQiVP2fa//AKuitwnN+uc4Kka0v+LzyDxbTr1jHEwF+va3h0wb9vibzhqR0hOHBv1+TyaSfPaXihdbuD/crXT/AD/XG3CwNj/v0SEL3oArR8VWMC4oF7C56TREi8JBszYXHxF+pyS8bp+37X/9fXXLBgV0nd9dGk+0rjbbrrDL3TTxwIo5ny5N+Lgbe5Fsa7HMfK5pDgcs+qyMQ0+vrx68Yjj+Uv4G8wGJabp/n+vU1zsPwhNYQkANmlWpjeqrii5rMbxNVZqGzZ0y3bYidD/Q6i6OjLtyBI+X6CaMIjRnVO7eeO+eK+eKnZiXudj7LBHOESPcglXiTzxXzxXzxXzxXzxX7QyttZFVC1+v8j4iNiYDAv2OYSbj46a5w905BJAjikA+oUD06M4UZb3EV88V88V88V88Vn2oUjLHfYNISDdP8/1C8qcLLgugJzTRXRiaikXFxWHa4aoDjoqZe7wzEc0IakLMcDl31yfYIaTT0YdNOCK/adzLrAuvFNsNwRyiSNirakE21II49qCbWcxy5NEjD08rXytdaKXZcRpua82o5SQSOawdvXW5bPstiPlf1tIMSbAAAwNuca8LSttymWQseitwtm/Wt0Ta/hPx+17njjEIO7JffSX3sl99JffSU7shrMWOSbp/n+vVbhlU1SCLi4vDeGk0XGbw4uKRUF5jJhOGi8l3NaFyuzrRaxXjhHTf3E04TK80rbUxduT8sj0Ys3n/ACqGaIz3knL4tWAOnOtPXngLyuMHtjooybyDl0WvCJRzfSg2YCZv5jftyrZ0NtQtVFQYXp9o5kMe2QnPw5ZzB9OUSLocwi3Yw8fXd3otKPySc13225S7fM3T/P8AWpwc3Uk8sYarcXGKaaDRQbiuLnF3JeN+1BxdPmU+m2Y9L7RFIOGebnulGvEOa81k35MkHF5Jz4wYgn53zg7j8Cco5w+i3C3OucNvPwJ1Ha8o5w+i+DzznR3D44ic+qSMhyOX/ZZoMLLBz/SmGTzL7JDGnDrzzNMxZvjqcwl1m4k1ftxxiYfatUjN2ftoA/2t/msu23E5Jzk/M3T/AD/Zpbpg/kwSCReICsbmkUetNBua5suyiLScnPwFz+wnPVR2pDf4fi/z8T0zeI0knof0G6f5/sF5bLxR4oat3pojY3wtSjLR3ucWV8DJlbiYn4D4Y+OOpX4Ad6O3SX0+CoW9GhAX9UOsZO5lhaM9+pun+f6R8OXTBH4SpzTR62Iri5WzEHoxu5Lhcf6M3FHrQc9JT/jr/mqMDs3400IzehBX1PxXGRlcEdpyAh4upun+f6R8FPCcjTk44waaL5MXy3jz0a7rdwP9AOhuM3FIqA9JV/zT1HpT6VF4mxQMeksfGtP/AE+EURkNn1wi5EErqeEBM922k4H7dDdP8/0j48sfKY6ZpNzQ1zfW7qd6P3Yo6EVejL3qnh7GuMjpGmPWVP8AIX8afSxLgZ6YskLcXZIGLf1LACv8xQADLKoUYEi8SkXWjaNu93R/IPU3T/P9govK/wCcg4uKRcUC4oF3fW4+Z/0B9KuA3esMjFT06en69z8Opun+f6R1SNmqQBfWNuA5Eewsg64pua8oUWR+Ns0rmlP9MfSn1sRJ9avpfT9m5+HU3T/P9I71IGaprKPUDHp0DEeibLCo/EubmzzFewMzGlyfgVzSuP0Y+Hb48QuRcin07CL/AKgY7X0FjORXBIwIww7HpxqL5FvlT0plQUSob5EvkS+RLtyKVwOhun+fzUE+iarn1jgVL6enxX1uuRwdJzlvkehF4eueg+S9X+CN/jrK+BihyvpFL/g3vXcIM0nJz+s3T/P4iw6zP3KRKnp+gVNgoMU7LGk59T0x8sXFI+Gbn4Zpa8VJ+KyEUzH/AATnqsxW+4Ndy57/ADPwN0/z+CqWOBFqhO7AYp6YuL/joPhnrj5/46YpFIx+vuaQbgmn/wDeE9OEnpgntSrD1Ck+hBHqEJ9Cp9L42pUimNsZoUt6GNqqMfRlK+vU3T/P4asOP6PQ/qH7iub6fqUBVzXUMM1Sv+HVc5IIPpImXwFQKuK/rddBjN7OKqiNc2RFdaAFHaQrGeIxuJO4wrtTj0sKKGJDHA7xsmP520Ux5PU3T/PrGvE2KowMdD8h8R+9x8M/Id0uP5qqU9JE4xVBXtcANmi4QHupH/qikA1fSn0pJA7bSgpm/wDbium2c0E5xQCM4jLFf6SLxkus4DRni6m6f59dNMtn4YuKOo/0hGR+pJSteUtVnIGK0zE5vua0hJzUnKjFYknNjlKV9okYEeyVGDJsl/RNwqMGXYL2TZLpw2OQxnIO8cWPaZTkybxYYEe6yDBm22kGB1N0/wA+uouE/wBc/Y/pSEEZLw49BAMd2hPFi+3X0rRHiwGgCrk2OMv6TQBEyIo/IcWeBUXI14OM5M8HCQFj1Bw5ePX43IraaEdhES/BZNVFTN14TK2Lta6Rrlepun+fQWAYX45o/wBOO1l9fhn4D1p/CnPBY2z+UxYd1Q59Xk8bZLnKVNfjGaD4f5s4ylij8a2ZONcVV4BgTHgYOY5ONeK6/wDmxEljUjAJeyqXTFijES4u4hZO3U3T/Oix92FDgdr5BfILxi8YvGLx3jvkF4xeO8d4xeO8YvFeO8QvFeK8QvFc3iubxXNzc3Nm/THIpXBeVR2HGjVp14heNPWzScbVnXgxVnZRgGQuwJmlXg7JtknFlnCjIi2uJsNtTAjhGtIoTBhnVXIJlRBm++OcV9hQmam7xNg7OwAuF6m6f59FODfLfLfLfLfLfLfLfJfKb5L5KJL5L5L5L5Lx3yXyXjvHeO+S8d47x3jvHeO8dZ8/LPXPTPTPTPXPXPTNzT+g3T/Prn55/fn4+NsZo72LVkl7hhg4ubm56NpSrEJSe37/AFutr5/ptuJV7qylexAJskTRgE3v8TdP8/15+OvqvPngEbFuCnlewE8hPbtUUucCXXeI4buOoiYrxdc3l2osgLvvbEAXgj1Y1iQSvzLZlVzFT8Io2kYKs0gghEUrNxHpnoBmvAyev6dWNScsfTsC0kgzPCsgzURVTBliEgwZYM/yiayIMs+OL+epun+f6ViZhxCJONwt2tLwyiO7elAyqNfYgMLcJi13kIxFyNkHFNBzOLl7GPXXj9z23d4woYbo6x2pQlbl82sEnErTbO0o2dj/ALhwkbP6anLpdnPBFtOuu2sI045OG72qdd+Ej1u4THDGFaNgAx1NWCXUCy7jGWUuNXXMz8NaM5OM0KT6cslCEreZNE7/AOxy7WE7NlxlsBoWUAkRsbp8vEsfmbm21oHXAgJ+ftcx8Vj1OJcmDW4e52ZmB4Ay5QY9e1wB2P8AmxvxMbI3AhNJyc/A3T/P9KR+PS4xpozSjEM0Lcx8k0+xCdwx6m1qO+wVWPlk2ssZTnEqI3jj5bH5dhQRsNFt+S8xgPMyJYeSp49jLOqR+KSLZ2V2+YIRFyzwk+55fJFDucSNJIZ2EHk8S+zQaGzrS5s+pu7bZK8vi1f62NudJpAqcwUxMiWXcXY0VQkx680fliljM7yx6E2uunKj6GtHI5knm9pLCW0oUMcBmOzIjaxkTWxru4unr/0ZpDMd3ZUHX301/Ip19KXZjESbnKp9aMSSfJULnAXiSP8AqIkJ3fbbi7Mxc5K7aquKu6uP68yySgkkAZo3EziyBWTufXt1N0/z/TyTd1DAdbb2tzl+khGpFzhoRhGmYvx2DnD64/29DY3JdV2ScsXPFy/Y9vOrmV+Tj/8A03Y5pI8rMkHNWgXCTc32Jvyh2XjkEg3Oe7O2vA68xkVDGmvzR9cf7fum8nlqfattRgzfZNyUYurPomLOxvya/nLa8Wzy3bhVtrmO+krBIYtnlm3Cp2d/fg4fDqxzy7CeFNeDXkzC2yw0IQuvyfe1vG2vt7e5o6i41F2CG4inOGJVXPMo23BOsp5MP9+7fM3km8iS7ssqBG+UUpj7gbT5yZNt3GOuepncrwm+VuHh+Jun+f6QcXJPr1imlClUJOe/peI+nxHe4+GCLm5zQT0BuaszKMASMO9LsaDi5uevEbn5EYqxsw7dx63P7TdP8/mEY9x8ApPoPXuiiNMosLy5YTQ+LGVRm/EKx+GsVDf1tIAc9BYYBjiOwygYFzYCpTFccLY6Dv2DRMvRVY+gUn068LAZObmgZ9O/VCA2WnUNHldZSif1sMpb+f3G6f59VjZhkQx+RuGrrDy8Nl1MnKa8QWPu8ZySAjN6GNh2OvrAqGbyxxsVIjMzErrEiM5hl4h/Mqu/9sSII8WBB4+6rHGubtRKAGCozHtrwFTxNOS8nDZ4fGAQndgLsOy4VYoQFyzdjVidvRIzGnZlbOTHAOxJCR5Yq4xxFkJ/qkiFLAoC9318DiBgbANji/3MNsSA/wAWSJCn8rqnGW1l4WOfGgJYvGkiFgAScCLWYsOKVuEhbLjg7a8fG+DsKBIQHhZFDH9hun+fWIYgJGmjcfFVxkm+RXU41hhMEgGMgQxeNcEyKrFSpwAD4xnJULwsU1GbhIMDDDXYBVF4ZW4oe+vkRYaGDH9NtF27VSuugJkmdsXw4IcSRPJ2qxJGKGV5ckYPp4g0uAZwp4Fidnk78Y7rQcYF2PwNgGE7zghRhyWj768LL3YjHZlnV24QGZZrsLxuAAFjXFikaR+7A/8AqkLu5LzlguE1kCLxs+yzL/OsTJJllNAAbNEWZDI2zseQ4H7DdP8APrq7CqvC0u4qjCNuOwxVYg5B3JDfePnNG0xYFvdRYzZdlnbIk23cYursBP5afbULhA5AsW1GV/qfZ42HC207DFG6w7VdhWXid5+N8mbZV1wF23AxTuOam0mO8zh3ysUxTtWmSMfzDMEbLe4Hk4q2zGBmtOxfiD7DPW2HYYseyhXDSbRLfy2y5ryM5yYn8bZvuUryIn9VNscPddllGANxxRtvY9rj/PY2Aw4VTZVY+GwS+OTNbajAyH2GZ+IQSCZe+2iI38/sN0/z6Zubm5ubm5ubm5ubm5ubm8V4rxXivFeO8d47xi8YvGLxi+S+QXjF8gvkF8gvkF8gvkF4xfILxi+QXjF4xeMXjvFeO8V4rxC8Vh2Gi9HkLnJzc3Nzc3Nzc3Nzc3NJun+d8F9vfb3299vfb3299vfb3299vfb3299vfb3299vfb3299vfb3299vfb3299vfb3298F9vfb3299vfb3299vfb3wX299vfb3299vfb3299vfb3299vfb3298F9vfb3299vfb3299vfb3299vfb3299vfb2FPGc/8AgRT/AOC//8QAHxABAAICAgMBAQAAAAAAAAAAAQIAECAwYFBAA3CA/9oACAEDAAkJAOkHSDBg7eG55csY+TOOMpR2WtXCtVXjOQxHcLKH0PmcrkDlOYKDukpvjDEUwDwTq+4V4DIZlpKLs2PiI6HAWM9kp4KEIQjSEIQ1NTQhGMY+QPJPoPQzaMaew8pWUpSs5SlKTg3DMpSlKXugVMGF0ju6vgomqujiBh0XL4SRPDu4bJdZRIP8mGDB+hqqr3s6AYKBToBT8BKUp+hNRO0Gp4wscG5YuhP0HQ5zDRCVDBGmZmkY5JHK09AF+ZSFT5wp84JYER+R8qEKcBgPTCn00FaYkFjY2f1pSOHma+HXtRSmhxnMe0VyUDAUpwFClaalOhHVlVVVVVVV9RVVVVVVVeif/8QAMhAAAQMBBQUJAAMAAwEAAAAAAQARITEQQQJRIHGREmGhUDAisYHw0cFA4XAykIBgQv/aAAgBAwAKPwD/AKEt2vUP6dzw9SuI80AoEDTFs9lUDqNH+Qx18IyvTJguLYi5vUdpQS29SCz55qpTjMKijFRULWxlntTBvJTVSRS9MM03VcW1AAKvl2g2I9LHaV8IGH3pvlB8QYDapBX+gDY5wn2bJw+VjvLXJggLK12dmwLXb26cFPw32uwYpsOGU7vZSLMjZ/p3suCjKinnXspjpqNDA6PCQX5FA4jRk4XCa21BsvskRZOd6cXH57CrXllq8RvV+hsQ62X+du1SLGwYepyXhw0UKQE4Nt/nZfY3u9TfkU2LJOCoMjsDw4epUFEtyR3I7kdy4RmVATk1CO5HcjuRjlZcLfEaqkGyBoZ7aEWOXCO5HcjuR3IuKHNUPn2AxFR31w+7I8udlRpjD5qgJ36Kga7n3dgT31wtg0+LL/OdH+pUEaKRruPYPhbr3tw0MWWWigCm4rdRE+i4R1TAdkTemQQQQT4byg21BBBBBXC2BQZ2ct2ioGpkEEEEEP38OHrbSU5TEKSmOmSptJTnK6ygVdE4fLVzPYbg35INy0SSnxGpXDiHVOTemIv08WI3/SZr8rAMeWjb8af5U+Wj+VXsT4THO5PsTYRQWeG45LwDqnwFeAddL4TUfC8HnbxDqm2pz0CcnUxT7EVvT/mju5/u9/8AgUp/Y0WwNEdqT3MWX/1hGqD+Wv6i3dwPQepT7IA+dpTuWCgXCBq4iKC4fnf8O1Elpi0Acyhie8qSiSan6CqoNFMW0lDN9FR9lVXCQX9PYVV7GhyYyZMAqAncLK2AAZp8Rb0buJ/RU/Vjj2FwOZPu5cU1XHBfkf4TEVY32UK4YcqA8+iOJjQ8rxyTGH2okXmjBPg55ZqCvFiqfpGOSO5UqAZTYRRUA6z9pjhYApwAI2ymwsfJeI+x1TYBX49USRfkr2+0BxwM1/8AJHqvCPbJhRuSBOJTin0Cg/hjv4M+qfFmbtiZ777GOaYDfNlE+I3c0z+WSG6yVCYGqY5qUD6JtiJxP0TBNiwhtqbAKD7TY8IaE2G/Mph7quEAO+Z/hOMYkBeHFOwp8WZu2WeES1yAD0TnJNsuGSgf+1ns2LY7qveTrr3cKOxoUptFNM95HcSo/VTVHdzZHdzqj+3v/9k=" alt="Gull And Zubair Naswar Dealers" style="width:100%;max-width:320px;border-radius:14px;object-fit:cover;box-shadow:0 6px 24px rgba(0,0,0,0.18);display:block;margin:0 auto 16px auto;">
<div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:20px;">
<svg width="14" height="14" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 3 L30 8 V18 C30 25 24 31 18 33 C12 31 6 25 6 18 V8 Z" fill="#1de9b6" opacity="0.12" stroke="#1de9b6" stroke-width="1.6" stroke-linejoin="round"/><rect x="14" y="19" width="8" height="7" rx="1.5" fill="#1de9b6" opacity="0.3" stroke="#1de9b6" stroke-width="1.3"/><path d="M15 19 V17 A3 3 0 0 1 21 17 V19" stroke="#1de9b6" stroke-width="1.3" fill="none" stroke-linecap="round"/><circle cx="18" cy="22.5" r="1.2" fill="#1de9b6"/></svg>
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

try {
  const email = await OfflineAuth.getSavedEmail();
  if (email) {
    const emailInput = document.getElementById('auth-email');
    if (emailInput) { emailInput.value = email; }
  }
} catch (_e) {}
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
messageDiv.textContent = ' Offline Login Successful';
messageDiv.style.color = 'var(--accent-emerald)';

if (typeof initDeviceShard === 'function') {
  await initDeviceShard().catch(() => {});
}
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
if (typeof initDeviceShard === 'function') { await initDeviceShard().catch(() => {}); }
try { if (typeof loadAllData === 'function') await loadAllData(); } catch(e) {}
messageDiv.textContent = ' Offline Login (Network unavailable)';
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

async function signOut() {
try {

let _savedAppMode = null;
try {
  const _modeKeys = [
    'appMode', 'appMode_timestamp',
    'repProfile', 'repProfile_timestamp',
    'assignedManager', 'assignedUserTabs',
  ];
  const _modeVals = await sqliteStore.getBatch(_modeKeys).catch(() => new Map());
  const _modeEntries = _modeKeys
    .map(k => [k, _modeVals.get(k)])
    .filter(([, v]) => v != null && v !== undefined);
  if (_modeEntries.length) _savedAppMode = _modeEntries;
} catch(_) {}

stopDatabaseHeartbeat();
clearAutoBackup();
if (typeof OfflineQueue !== 'undefined') OfflineQueue.cancelRetry();
if (window._fbOfflineHandler) { window.removeEventListener('offline', window._fbOfflineHandler); window._fbOfflineHandler = null; }
if (window._fbOnlineHandler)  { window.removeEventListener('online',  window._fbOnlineHandler);  window._fbOnlineHandler  = null; }
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

if (typeof _clearDeviceIdStorage === 'function') {
  await _clearDeviceIdStorage().catch(() => {});
}

if (_savedAppMode && _savedAppMode.length && !window._forceLogoutSignOut) {
  await sqliteStore.setBatch(_savedAppMode).catch(() => {});
}
window._forceLogoutSignOut = false;
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

if (typeof _clearDeviceIdStorage === 'function') {
  await _clearDeviceIdStorage().catch(() => {});
}

if (_savedAppMode && _savedAppMode.length && !window._forceLogoutSignOut) {
  await sqliteStore.setBatch(_savedAppMode).catch(() => {});
}
window._forceLogoutSignOut = false;
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
