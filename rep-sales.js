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
await sqliteStore.remove('bio_enabled');
await sqliteStore.remove('bio_cred_id');
showToast("Biometric Lock Removed", "info");
const _bioBtnD = document.getElementById('bio-toggle-btn');
if (_bioBtnD) _bioBtnD.innerText = "Enable Biometric Lock ";
document.getElementById('bio-toggle-btn').onclick = enableBiometricLock;
}
}
async function checkBiometricLock() {
const isEnabled = await sqliteStore.get('bio_enabled');
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
window._selectRepCustomerBase = selectRepCustomer;
async function calculateRepCustomerStatsForDisplay(name) {
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
calculateRepCustomerStats(name);
}
async function calculateRepCustomerStats(name) {
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
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
async function calculateRepSalePreview() {
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
if(repTransactionMode === 'sale') {
const qty = parseFloat(document.getElementById('rep-quantity').value) || 0;
const salePrice = getSalePriceForStore('STORE_A');
const _repTVS = document.getElementById('rep-total-value');
if (_repTVS) _repTVS.innerText = "" + fmtAmt(safeNumber(qty * salePrice, 0));
}
}
async function saveRepTransaction() {
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
const submitBtn = document.querySelector('#rep-new-transaction-card .btn-main');
if (submitBtn) {
if (submitBtn.disabled) return;
submitBtn.disabled = true;
}
async function restoreBtn() {
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
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
new Promise(resolve => setTimeout(() => resolve(null), 10000))
]);
} catch (e) {
console.error('An unexpected error occurred.', _safeErr(e));
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
let saleId = generateUUID('sale');
if (!validateUUID(saleId)) {
saleId = generateUUID('sale');
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
unitPrice: salePrice,
creditReceived: (payType === 'CASH'),
createdAt: getTimestamp(),
updatedAt: getTimestamp(),
timestamp: getTimestamp(),
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
let collId = generateUUID('sale');
if (!validateUUID(collId)) {
collId = generateUUID('sale');
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
affectsInventory: false,
syncedAt: new Date().toISOString()
};
transactionRecord = ensureRecordIntegrity(transactionRecord, false);
}
repSales.push(transactionRecord);
await saveWithTracking('rep_sales', repSales, transactionRecord);
try {
const _rcName = transactionRecord.customerName;
const _rcPhone = transactionRecord.customerPhone || '';
if (_rcName && _rcName.trim()) {
const existsInRepRegistry = Array.isArray(repCustomers) && repCustomers.some(c => c && c.name && c.name.toLowerCase() === _rcName.toLowerCase());
if (!existsInRepRegistry) {
const _rcContact = { id: generateUUID('rep_cust'), name: _rcName, phone: _rcPhone, address: '', oldDebit: 0, createdAt: getTimestamp(), updatedAt: getTimestamp(), timestamp: getTimestamp() };
if (!Array.isArray(repCustomers)) repCustomers = [];
repCustomers.push(_rcContact);
await saveWithTracking('rep_customers', repCustomers, _rcContact);
saveRecordToFirestore('rep_customers', _rcContact).catch(e => {});
}
}
} catch (_rcErr) { console.warn('Auto-register rep customer failed:', _safeErr(_rcErr)); }
if (firebaseDB && currentUser) {
saveRecordToFirestore('rep_sales', transactionRecord).catch(e => {
});
}
notifyDataChange('rep');
if (navigator.onLine) {
emitSyncUpdate({ rep_sales: null}).catch(e => {
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
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
if (!currentGps || !currentGps.lat || !currentGps.lng) return;
const contactIndex = repCustomers.findIndex(
c => c && c.name && c.name.toLowerCase() === customerName.toLowerCase()
);
if (contactIndex === -1) return;
const contact = repCustomers[contactIndex];
if (contact.locationConfirmed) return;
const isManualAddress = contact.address && contact.address.length > 5 && !contact.address.startsWith('GPS:');
if (isManualAddress) return;
const pastTransactions = repSales.filter(sale =>
sale &&
sale.customerName &&
sale.customerName.toLowerCase() === customerName.toLowerCase() &&
sale.gps &&
sale.gps.lat &&
sale.gps.lng &&
sale.timestamp < Date.now() - 2000
).sort((a, b) => b.timestamp - a.timestamp);
if (pastTransactions.length < 3) return;
const CLUSTER_RADIUS_M = 150;
let clusterCount = 0;
let clusterLat = 0;
let clusterLng = 0;
for (const sale of pastTransactions) {
if (getDistanceFromLatLonInMeters(currentGps.lat, currentGps.lng, sale.gps.lat, sale.gps.lng) <= CLUSTER_RADIUS_M) {
clusterCount++;
clusterLat += sale.gps.lat;
clusterLng += sale.gps.lng;
}
if (clusterCount >= 3) break;
}
if (clusterCount < 3) return;
const avgLat = ((clusterLat + currentGps.lat) / (clusterCount + 1));
const avgLng = ((clusterLng + currentGps.lng) / (clusterCount + 1));
const coordsString = `GPS: ${safeNumber(avgLat, 0).toFixed(6)}, ${safeNumber(avgLng, 0).toFixed(6)}`;
repCustomers[contactIndex].address = coordsString;
repCustomers[contactIndex].locationConfirmed = true;
repCustomers[contactIndex].updatedAt = getTimestamp();
ensureRecordIntegrity(repCustomers[contactIndex], true);
await saveWithTracking('rep_customers', repCustomers, repCustomers[contactIndex]);
if (firebaseDB && currentUser) {
saveRecordToFirestore('rep_customers', repCustomers[contactIndex]).catch(e => {});
}
notifyDataChange('rep');
if (typeof showToast === 'function') {
showToast(`Location confirmed for ${customerName} after 3 consistent visits.`, 'success');
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
{ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
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
async function updateRepLiveMap() {
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
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
let detailStr = `${safeToFixed(txn.quantity, 2)} kg`;
if (txn.paymentType === 'COLLECTION') {
color = '#10b981';
typeStr = 'Collection';
detailStr = `${fmtAmt(txn.totalValue)}`;
} else if (txn.paymentType === 'CREDIT') {
color = '#f59e0b';
typeStr = 'Credit Sale';
detailStr = `${safeToFixed(txn.quantity, 2)} kg (Credit)`;
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
function setRepAnalyticsMode(mode) {
currentRepAnalyticsMode = mode;
document.querySelectorAll('#admin-rep-analytics .toggle-group .toggle-opt').forEach(opt => {
opt.classList.remove('active');
});
document.getElementById(`rep-analytics-${mode}-btn`).classList.add('active');
calculateRepAnalytics();
}
async function calculateRepAnalytics() {
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
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
const deletedRecordIds = new Set(ensureArray(await sqliteStore.get('deleted_records')));
const _rrctAlive = (item) => item && item.id && !deletedRecordIds.has(String(item.id));
const repSales = ensureArray(await sqliteStore.get('rep_sales')).filter(_rrctAlive);
const repCustomers = ensureArray(await sqliteStore.get('rep_customers')).filter(_rrctAlive);
const tbody = document.getElementById('rep-customers-table-body');
if (!tbody) {
return;
}
try {
const freshRepSales = await sqliteStore.get('rep_sales', []);
if (Array.isArray(freshRepSales)) {
const recordMap = new Map(freshRepSales.filter(s => s && s.id).map(s => [s.id, s]));
if (Array.isArray(repSales)) {
repSales.forEach(s => {
if (s && s.id && !recordMap.has(s.id)) {
recordMap.set(s.id, s);
}
});
}
const mergedRepSales = Array.from(recordMap.values());
}
} catch (error) {
console.error('Rep sales operation failed.', _safeErr(error));
showToast('Rep sales operation failed.', 'error');
}
try {
const freshRepCustomersList = await sqliteStore.get('rep_customers', []);
if (Array.isArray(freshRepCustomersList) && freshRepCustomersList.length > 0) {
const repRegMap = new Map(freshRepCustomersList.map(c => [c.id, c]));
if (Array.isArray(repCustomers)) {
repCustomers.forEach(c => { if (c && c.id && !repRegMap.has(c.id)) repRegMap.set(c.id, c); });
}
const mergedRepCustomers = Array.from(repRegMap.values());
}
} catch (repRegError) {
console.warn('Rep registry refresh failed, using in-memory:', _safeErr(repRegError));
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
if (Array.isArray(repCustomers)) {
const custMapNames = new Set(Object.keys(custMap).map(n => n.toLowerCase()));
const profileRepNames = new Set(
repSales
.filter(s => s.salesRep === currentRepProfile && s.customerName)
.map(s => s.customerName.toLowerCase())
);
repCustomers.forEach(rc => {
if (!rc || !rc.name || !rc.name.trim()) return;
const lcName = rc.name.toLowerCase();
if (custMapNames.has(lcName)) return;
if (!profileRepNames.has(lcName)) return;
custMap[rc.name] = { debt: 0, count: 0 };
sortedCustomers.push(rc.name);
});
sortedCustomers.sort();
}
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
validPage,
repSales,
repCustomers
};
if (repCustomersData && repCustomersData.pageCustomers) {
renderRepCustomersFromCache(repCustomersData, tbody);
} else {
tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--danger);">Failed to load customer data</td></tr>`;
}
let repTotalCreditSales = 0;
let repTotalCollections = 0;
myData.forEach(s => {
if (s.paymentType === 'CREDIT') {
repTotalCreditSales += (s.totalValue || 0);
} else if (s.paymentType === 'COLLECTION' || s.paymentType === 'PARTIAL_PAYMENT') {
repTotalCollections += (s.totalValue || 0);
}
});
const totalOutstanding = Object.values(custMap).reduce((sum, c) => sum + (c.debt > 0 ? c.debt : 0), 0);
const _setRepH = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
_setRepH('rep-customers-total-credit', fmtAmt(totalOutstanding));
_setRepH('rep-customers-total-credit-sales', fmtAmt(repTotalCreditSales));
_setRepH('rep-customers-total-collections', fmtAmt(repTotalCollections));
}
async function renderRepCustomersFromCache(data, tbody) {
if (!data) {
tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--danger);">Error loading customers</td></tr>`;
return;
}
const { pageCustomers, custMap, totalItems, totalPages, validPage, repSales, repCustomers } = data;
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
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
currentManagingRepCustomer = customerName;
const _repMCT = document.getElementById('repManageCustomerTitle'); if (_repMCT) _repMCT.innerText = customerName;
const _repBulk = document.getElementById('repBulkPaymentAmount'); if (_repBulk) _repBulk.value = '';
requestAnimationFrame(() => {
document.body.style.overflow = 'hidden';
document.documentElement.style.overflow = 'hidden';
requestAnimationFrame(() => {
document.body.style.overflow = 'hidden';
document.documentElement.style.overflow = 'hidden';
const _rcmOverlay = document.getElementById('repCustomerManagementOverlay');
if (_rcmOverlay) _rcmOverlay.style.display = 'flex';
});
});
await renderRepCustomerTransactions(customerName);
}
async function closeRepCustomerManagement() {
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
requestAnimationFrame(() => {
document.body.style.overflow = '';
document.documentElement.style.overflow = '';
document.getElementById('repCustomerManagementOverlay').style.display = 'none';
});
currentManagingRepCustomer = null;
setTimeout(async () => {
try {
const freshRepSales = await sqliteStore.get('rep_sales', []);
if (Array.isArray(freshRepSales)) {
const m = new Map(freshRepSales.map(s => [s.id, s]));
if (Array.isArray(repSales)) repSales.forEach(s => { if (!m.has(s.id)) m.set(s.id, s); });
const _freshRepSales = Array.from(m.values());
await sqliteStore.set('rep_sales', _freshRepSales);
}
} catch(e) {
showToast('Rep sales operation failed.', 'error');
console.warn('closeRepCustomerManagement SQLite error', _safeErr(e));
}
if (typeof renderRepCustomerTable === 'function') renderRepCustomerTable();
}, 100);
}
async function deleteCurrentRepCustomer() {
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
if (!currentManagingRepCustomer) return;
const name = currentManagingRepCustomer;
const txs = repSales.filter(s => s.customerName === name && s.salesRep === currentRepProfile);
const totalDebt = txs
.filter(s => s.paymentType === 'CREDIT' && !s.creditReceived)
.reduce((sum, s) => sum + (s.totalValue || 0) - (s.partialPaymentReceived || 0), 0);
let msg = `Permanently delete rep customer "${name}"?`;
if (txs.length > 0) {
msg += `\n\n⚠ This customer has ${txs.length} transaction record${txs.length !== 1 ? 's' : ''} on file.`;
if (totalDebt > 0) msg += `\n Outstanding debt: ${fmtAmt(totalDebt)}`;
msg += `\n\nAll rep sales history for this customer will be permanently deleted.`;
}
msg += `\n\nThis cannot be undone.`;
if (!(await showGlassConfirm(msg, { title: 'Delete Rep Customer', confirmText: 'Delete Permanently', danger: true }))) return;
try {
const contactIdx = repCustomers.findIndex(c => c && c.name && c.name.toLowerCase() === name.toLowerCase());
if (contactIdx !== -1) {
const contactRecord = repCustomers[contactIdx];
const contactId = contactRecord.id;
await registerDeletion(contactId, 'rep_customers', contactRecord);
repCustomers.splice(contactIdx, 1);
await saveWithTracking('rep_customers', repCustomers);
deleteRecordFromFirestore('rep_customers', contactId).catch(() => {});
}
const idsToDelete = txs.map(s => s.id);

const repTxsToDelete = txs.slice();
const prunedRepSales = repSales.filter(s => !idsToDelete.includes(s.id));
await sqliteStore.set('rep_sales', prunedRepSales);
for (const tx of repTxsToDelete) {
await registerDeletion(tx.id, 'rep_sales', tx);
}
await saveWithTracking('rep_sales', repSales);
void Promise.all(idsToDelete.map(id => deleteRecordFromFirestore('rep_sales', id).catch(() => {})));
notifyDataChange('rep');
triggerAutoSync();
closeRepCustomerManagement();
showToast(`Rep customer "${name}" and all records deleted.`, 'success');
} catch (e) {
showToast('Failed to delete rep customer. Please try again.', 'error');
}
}
async function renderRepCustomerTransactions(name) {
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
const list = document.getElementById('repCustomerManagementHistoryList');
if (!list) return;
let transactions = [];
try {
const dbSales = await sqliteStore.get('rep_sales', []);
if (Array.isArray(dbSales)) {
const recordMap = new Map(dbSales.filter(s => s && s.id).map(s => [s.id, s]));
if (Array.isArray(repSales)) repSales.forEach(s => { if (s && s.id && !recordMap.has(s.id)) recordMap.set(s.id, s); });
const mergedTx = Array.from(recordMap.values());
transactions = mergedTx.filter(s => s.customerName === name && s.salesRep === currentRepProfile);
} else {
transactions = repSales.filter(s => s.customerName === name && s.salesRep === currentRepProfile);
}
} catch (e) {
console.error('Rep sales operation failed.', _safeErr(e));
showToast('Rep sales operation failed.', 'error');
transactions = repSales.filter(s => s.customerName === name && s.salesRep === currentRepProfile);
}
const repDateFromEl = document.getElementById('repCustomerPdfDateFrom');
const repDateToEl = document.getElementById('repCustomerPdfDateTo');
const fromVal = repDateFromEl ? repDateFromEl.value : '';
const toVal = repDateToEl ? repDateToEl.value : '';
if (fromVal || toVal) {
transactions = transactions.filter(t => {
if (!t.date) return false;
const d = t.date.slice(0, 10);
if (fromVal && d < fromVal) return false;
if (toVal && d > toVal) return false;
return true;
});
}
const repContacts = repCustomers;
const contact = repContacts.find(c => c && c.name && c.name.toLowerCase() === name.toLowerCase() && c.salesRep === currentRepProfile)
  || repContacts.find(c => c && c.name && c.name.toLowerCase() === name.toLowerCase());
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
transactions.sort((a, b) => b.timestamp - a.timestamp);
if (transactions.length === 0) {
list.replaceChildren(Object.assign(document.createElement('div'), {className:'u-empty-state-sm',textContent:'No history found'}));
return;
}
const _repFrag = document.createDocumentFragment();
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
item.className = `cust-history-item${t.isSettled ? ' is-settled-record' : ''}`;
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
const _repDisplayUnitPrice = (t.unitPrice && t.unitPrice > 0)
  ? t.unitPrice
  : getSalePriceForStore(t.supplyStore || 'STORE_A');
itemContent = `
<div class="cust-history-info">
<div style="font-weight:700;font-size:0.85rem;color:var(--text-main);">${formatDisplayDate(t.date)}${_mergedBadgeHtml(t, {inline:true})}</div>
<div style="font-size:0.75rem;color:var(--text-muted);">${safeToFixed(t.quantity, 2)} kg @ ${await formatCurrency(_repDisplayUnitPrice)}</div>
${hasPartialPayment ? `<div style="font-size:0.7rem;color:var(--accent-emerald);margin-top:2px;">Paid: ${await formatCurrency(partialPaid)}</div>` : ''}
</div>
<div class="cust-history-actions">
${toggleBtnHtml}
${deleteBtnHtml}
</div>`;
}
item.innerHTML = itemContent;
_repFrag.appendChild(item);
}
list.replaceChildren(_repFrag);
}
async function openRepCustomerEditModal(customerName) {
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
const nameInput = document.getElementById('rep-edit-cust-name');
nameInput.value = customerName;
nameInput.dataset.originalName = customerName;
const contact = repCustomers.find(c => c && c.name && c.name.toLowerCase() === customerName.toLowerCase() && c.salesRep === currentRepProfile)
  || repCustomers.find(c => c && c.name && c.name.toLowerCase() === customerName.toLowerCase() && !c.salesRep);
const saleRecord = repSales.find(s => s.customerName === customerName && s.salesRep === currentRepProfile && s.customerPhone);
const existingOldDebtTx = repSales.find(s =>
s.customerName && s.customerName.toLowerCase() === customerName.toLowerCase() &&
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
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
const nameInput = document.getElementById('rep-edit-cust-name');
const name = nameInput.value.trim();
const originalName = nameInput.dataset.originalName || name;
const phone = document.getElementById('rep-edit-cust-phone').value.trim();
const address = document.getElementById('rep-edit-cust-address').value.trim();
const oldDebit = parseFloat(document.getElementById('rep-edit-cust-old-debit').value) || 0;
if (!name) { showToast('Customer name is required', 'error'); return; }
try {
const nameChanged = name.toLowerCase() !== originalName.toLowerCase();
const freshRepContacts = await sqliteStore.get('rep_customers', []);
if (Array.isArray(freshRepContacts)) {
const m = new Map(freshRepContacts.map(c => [c.id, c]));
if (Array.isArray(repCustomers)) repCustomers.forEach(c => { if (!m.has(c.id)) m.set(c.id, c); });
const mergedRepC = Array.from(m.values());
await sqliteStore.set('rep_customers', mergedRepC);
}
let contact = repCustomers.find(c => c && c.name && c.name.toLowerCase() === originalName.toLowerCase() && c.salesRep === currentRepProfile);
if (!contact) contact = repCustomers.find(c => c && c.name && c.name.toLowerCase() === name.toLowerCase() && c.salesRep === currentRepProfile);
if (!contact) contact = repCustomers.find(c => c && c.name && c.name.toLowerCase() === originalName.toLowerCase() && !c.salesRep);
if (!contact) contact = repCustomers.find(c => c && c.name && c.name.toLowerCase() === name.toLowerCase() && !c.salesRep);
const previousOldDebit = contact?.oldDebit || 0;
if (contact) {
if (!validateUUID(String(contact.id || ''))) { contact.id = generateUUID('rep_cust'); }
contact.name = name; contact.phone = phone; contact.address = address; contact.oldDebit = oldDebit;
contact.salesRep = currentRepProfile; contact.updatedAt = getTimestamp();
ensureRecordIntegrity(contact, true);
} else {
contact = { id: generateUUID('rep_cust'), name, phone, address, oldDebit, salesRep: currentRepProfile,
createdAt: getTimestamp(), updatedAt: getTimestamp(), timestamp: getTimestamp() };
repCustomers.push(contact);
}
await saveWithTracking('rep_customers', repCustomers, contact);
saveRecordToFirestore('rep_customers', contact).catch(() => {});
let salesArray = await sqliteStore.get('rep_sales', []);
if (!Array.isArray(salesArray)) salesArray = [];
if (Array.isArray(repSales) && repSales.length > 0) {
const mSales = new Map(salesArray.map(s => [s.id, s]));
repSales.forEach(s => { if (s && s.id && !mSales.has(s.id)) mSales.set(s.id, s); });
salesArray = Array.from(mSales.values());
}
const renamedRecords = [];
if (nameChanged) {
salesArray.forEach(s => {
if (s.customerName && s.customerName.toLowerCase() === originalName.toLowerCase() && s.salesRep === currentRepProfile) {
s.customerName = name;
renamedRecords.push(s);
}
});
}
const oldDebtIdx = salesArray.findIndex(s => s.customerName === name &&
s.transactionType === 'OLD_DEBT' && s.salesRep === currentRepProfile);
let oldDebtModified = false, oldDebtRecord = null, deletedOldDebtId = null;
if (oldDebit > 0) {
if (oldDebtIdx !== -1) {
const tx = salesArray[oldDebtIdx];
if (!validateUUID(String(tx.id || ''))) { tx.id = generateUUID('old_debt'); }
const amountChanged = tx.totalValue !== oldDebit;
tx.totalValue = oldDebit; tx.customerPhone = phone; tx.timestamp = getTimestamp();
tx.updatedAt = getTimestamp();
if (amountChanged) { tx.creditReceived = false; tx.partialPaymentReceived = 0; }
if (!tx.time) tx.time = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
ensureRecordIntegrity(tx, true);
oldDebtModified = true; oldDebtRecord = tx;
} else {
const tx = { id: generateUUID('old_debt'), date: new Date().toISOString().split('T')[0],
customerName: name, customerPhone: phone, salesRep: currentRepProfile, quantity: 0,
supplyStore: 'N/A', paymentType: 'CREDIT', transactionType: 'OLD_DEBT',
totalValue: oldDebit, creditReceived: false, partialPaymentReceived: 0,
time: new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
timestamp: getTimestamp(), createdAt: getTimestamp(), updatedAt: getTimestamp(),
notes: 'Previous balance brought forward' };
salesArray.push(tx); oldDebtModified = true; oldDebtRecord = tx;
}
} else if (oldDebit === 0 && oldDebtIdx !== -1) {
const _repOldDebtRecordForDeletion = salesArray[oldDebtIdx];
deletedOldDebtId = _repOldDebtRecordForDeletion.id;
salesArray.splice(oldDebtIdx, 1); oldDebtModified = true;
if (deletedOldDebtId) { window._repOldDebtRecordForDeletion = _repOldDebtRecordForDeletion; }
}
let phoneUpdated = false;
salesArray.forEach(s => { if (s && s.customerName === name && s.customerPhone !== phone) { s.customerPhone = phone; phoneUpdated = true; } });
repSales.length = 0; repSales.push(...salesArray);
if (nameChanged || oldDebtModified || phoneUpdated) {
await saveWithTracking('rep_sales', salesArray, oldDebtModified && !phoneUpdated && !nameChanged ? oldDebtRecord : null);
if (oldDebtRecord) saveRecordToFirestore('rep_sales', oldDebtRecord).catch(() => {});
if (deletedOldDebtId) {
await registerDeletion(deletedOldDebtId, 'rep_sales', window._repOldDebtRecordForDeletion || null);
window._repOldDebtRecordForDeletion = null;
deleteRecordFromFirestore('rep_sales', deletedOldDebtId).catch(() => {});
}
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
console.error('An unexpected error occurred.', _safeErr(error));
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
async function renderRepHistory() {
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const list = document.getElementById('repHistoryList');
if (!list) return;
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
: `${safeToFixed(item.quantity, 2)} kg - ${fmtAmt(item.totalValue)}`;
} else {
typeIcon = '';
typeColor = 'var(--accent)';
qtyAmount = `${safeToFixed(item.quantity, 2)} kg - ${fmtAmt(item.totalValue)}`;
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
${item.isSettled ? 'opacity:0.65;' : ''}
">
<div class="u-flex-1" >
<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
<span style="font-size: 1.2rem;">${typeIcon}</span>
<strong style="color: var(--text-main); font-size: 0.9rem;">${esc(item.customerName)}</strong>
${item.isMerged ? _mergedBadgeHtml(item, {inline:true}) : ''}
${item.isSettled ? `<span class="settled-badge">✓ Settled</span>` : ''}
</div>
<div style="font-size: 0.75rem; color: ${typeColor}; font-weight: 600;">
${qtyAmount}
</div>
</div>
<div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 5px;">
<div class="u-fs-sm u-text-muted" >
${esc(item.time || '')}
</div>
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
const deletedRecordIds = new Set(ensureArray(await sqliteStore.get('deleted_records')));
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
if (sqliteStore && sqliteStore.getBatch) {
try {
const repKeys = ['rep_sales', 'rep_customers'];
const repDataMap = await sqliteStore.getBatch(repKeys);
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
await sqliteStore.set('rep_sales', freshRepSales);
}
freshRepSales = freshRepSales.filter(r => !deletedRecordIds.has(r.id));
freshRepSales.sort((a, b) => compareTimestamps(getRecordTimestamp(b), getRecordTimestamp(a)));
}
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
await sqliteStore.set('rep_customers', freshRepCustomers);
}
}
}
} catch (error) {
console.error('Failed to save data locally.', _safeErr(error));
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
