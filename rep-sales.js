async function enableBiometricLock() {
try {
const success = await BiometricAuth.register("Manager");
if(success) {
showToast("Biometric Lock Enabled! ", "success");
const _bioBtn = document.getElementById('bio-toggle-btn');
if (_bioBtn) {
  const lbl = document.getElementById('bio-toggle-label');
  if (lbl) lbl.textContent = 'Disable Lock';
  _bioBtn.onclick = () => { if(typeof closeSidebar==='function') closeSidebar(); disableBiometricLock(); };
  _bioBtn.classList.add('active');
}
}
} catch (e) {
showToast("Setup failed: " + e.message, "error");
}
}

async function disableBiometricLock() {
const _bioMsg = `Remove the biometric (fingerprint / Face ID) lock from this app?\n\nAfter removal:\n • Anyone with access to this device can open the app without biometric verification\n • To re-enable, tap Fingerprint Lock in the sidebar again\n\nYour data will not be affected.`;
if (await showGlassConfirm(_bioMsg, { title: "Remove Biometric Lock", confirmText: "Remove Lock", danger: true })) {
await sqliteStore.remove('bio_enabled');
await sqliteStore.remove('bio_cred_id');
showToast("Biometric Lock Removed", "info");
const _bioBtnD = document.getElementById('bio-toggle-btn');
if (_bioBtnD) {
  const lbl = document.getElementById('bio-toggle-label');
  if (lbl) lbl.textContent = 'Fingerprint Lock';
  _bioBtnD.onclick = () => { if(typeof closeSidebar==='function') closeSidebar(); enableBiometricLock(); };
  _bioBtnD.classList.remove('active');
}
}
}

async function checkBiometricLock() {
const isEnabled = await sqliteStore.get('bio_enabled');
if (isEnabled === 'true' || isEnabled === true) {
const lockScreen = document.createElement('div');
lockScreen.id = 'app-lock-screen';
lockScreen.style.cssText = `
position: fixed; inset: 0;
background: #0e0e0e;
background-image: radial-gradient(ellipse 70% 55% at 50% 30%, rgba(29,233,182,0.07) 0%, transparent 70%);
z-index: 100000;
display: flex; flex-direction: column; align-items: center; justify-content: center;
padding: 40px 24px;
`;
lockScreen.innerHTML = `
<style>
@keyframes _lockPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(29,233,182,0.35), 0 0 0 0 rgba(29,233,182,0.15); }
  50%       { box-shadow: 0 0 0 18px rgba(29,233,182,0.10), 0 0 0 36px rgba(29,233,182,0.04); }
}
@keyframes _lockRingExpand {
  0%   { transform: scale(0.85); opacity: 0; }
  60%  { transform: scale(1.04); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes _lockFadeUp {
  from { opacity: 0; transform: translateY(18px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes _lockBtnReady {
  0%   { opacity: 0; transform: translateY(10px) scale(0.97); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes _lockShake {
  0%, 100% { transform: translateX(0); }
  18%       { transform: translateX(-7px); }
  36%       { transform: translateX(7px); }
  54%       { transform: translateX(-5px); }
  72%       { transform: translateX(5px); }
  90%       { transform: translateX(-2px); }
}
#_lock-icon-wrap {
  width: 100px; height: 100px; border-radius: 50%;
  background: rgba(29,233,182,0.08);
  border: 1.5px solid rgba(29,233,182,0.28);
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 32px;
  animation: _lockRingExpand 0.55s cubic-bezier(0.22,1,0.36,1) forwards,
             _lockPulse 3s ease-in-out 0.8s infinite;
}
#_lock-title {
  font-size: 1.35rem; font-weight: 700; letter-spacing: -0.02em;
  color: rgba(255,255,255,0.92); margin: 0 0 8px 0;
  animation: _lockFadeUp 0.45s cubic-bezier(0.22,1,0.36,1) 0.15s both;
}
#_lock-sub {
  font-size: 0.82rem; color: rgba(255,255,255,0.45);
  margin: 0 0 40px 0; letter-spacing: 0.01em;
  animation: _lockFadeUp 0.45s cubic-bezier(0.22,1,0.36,1) 0.25s both;
}
#_lock-btn {
  display: flex; align-items: center; gap: 10px;
  background: rgba(29,233,182,0.12);
  border: 1.5px solid rgba(29,233,182,0.40);
  color: #1de9b6; font-size: 0.92rem; font-weight: 700;
  padding: 14px 36px; border-radius: 9999px; cursor: pointer;
  letter-spacing: 0.02em; transition: background 0.18s, border-color 0.18s, transform 0.12s;
  animation: _lockBtnReady 0.45s cubic-bezier(0.22,1,0.36,1) 0.35s both;
  -webkit-tap-highlight-color: transparent;
}
#_lock-btn:active { transform: scale(0.96); background: rgba(29,233,182,0.2); }
#_lock-hint {
  margin-top: 20px; font-size: 0.72rem; color: rgba(255,255,255,0.22);
  letter-spacing: 0.03em;
  animation: _lockFadeUp 0.45s cubic-bezier(0.22,1,0.36,1) 0.45s both;
}
#_lock-dots {
  display: flex; gap: 7px; margin-top: 28px;
  animation: _lockFadeUp 0.45s cubic-bezier(0.22,1,0.36,1) 0.4s both;
}
#_lock-dots span {
  width: 6px; height: 6px; border-radius: 50%;
  background: rgba(29,233,182,0.25);
}
</style>

<div id="_lock-icon-wrap">
  <svg width="42" height="42" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 0 6px var(--accent-glow));">
    <path d="M18 3 L30 8 V18 C30 25 24 31 18 33 C12 31 6 25 6 18 V8 Z" fill="#1de9b6" opacity="0.12" stroke="#1de9b6" stroke-width="1.6" stroke-linejoin="round"/>
    <rect x="14" y="19" width="8" height="7" rx="1.5" fill="#1de9b6" opacity="0.3" stroke="#1de9b6" stroke-width="1.3"/>
    <path d="M15 19 V17 A3 3 0 0 1 21 17 V19" stroke="#1de9b6" stroke-width="1.3" fill="none" stroke-linecap="round"/>
    <circle cx="18" cy="22.5" r="1.2" fill="#1de9b6"/>
  </svg>
</div>

<h2 id="_lock-title">App Locked</h2>
<p id="_lock-sub">Authenticate to continue</p>

<button id="_lock-btn" onclick="triggerUnlock()">
  <svg width="17" height="17" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M18 30 C10 30 6 24 6 18 C6 11 11 6 18 6 C25 6 30 11 30 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none" opacity="0.4"/>
    <path d="M18 26 C13 26 10 22.5 10 18 C10 13.5 13.5 10 18 10 C22.5 10 26 13.5 26 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none" opacity="0.6"/>
    <path d="M18 22 C15.8 22 14 20.2 14 18 C14 15.8 15.8 14 18 14 C20.2 14 22 15.8 22 18 L22 22" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none" opacity="0.85"/>
    <circle cx="18" cy="18" r="2" fill="currentColor"/>
    <path d="M22 25 C22 28 26 28 28 26" stroke="#1de9b6" stroke-width="1.4" stroke-linecap="round" fill="none" opacity="0.5"/>
  </svg>
  Use Fingerprint / Face ID
</button>

<p id="_lock-hint">Tap anywhere to unlock</p>

<div id="_lock-dots">
  <span></span><span></span><span></span>
</div>
`;
document.body.appendChild(lockScreen);

let _lockTriggered = false;
const _lockTriggerHandler = (e) => {
  if (_lockTriggered) return;
  _lockTriggered = true;
  lockScreen.removeEventListener('pointerdown', _lockTriggerHandler);
  if (typeof window.triggerUnlock === 'function') window.triggerUnlock();
};
lockScreen.addEventListener('pointerdown', _lockTriggerHandler);
window.triggerUnlock = async (isAutoTrigger = false) => {
const btn = document.getElementById('_lock-btn');
if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
const _reEnable = () => {
if (btn) { btn.disabled = false; btn.style.opacity = '1'; }

const screen = document.getElementById('app-lock-screen');
if (screen) {
let _retryTriggered = false;
const _retryHandler = () => {
if (_retryTriggered) return;
_retryTriggered = true;
screen.removeEventListener('pointerdown', _retryHandler);
if (typeof window.triggerUnlock === 'function') window.triggerUnlock();
};
screen.addEventListener('pointerdown', _retryHandler);
}
};
try {
await BiometricAuth.authenticate();
const screen = document.getElementById('app-lock-screen');
if (screen) {
screen.style.transition = 'opacity 0.3s ease';
screen.style.opacity = '0';
setTimeout(() => screen.remove(), 300);
}
showToast("Unlocked Successfully", "success");
} catch (e) {
const errName = e && e.name ? e.name : '';
const errMsg  = e && e.message ? e.message : 'Unknown error';
if (errName === 'NotAllowedError') {
_reEnable();
return;
}
const iconWrap = document.getElementById('_lock-icon-wrap');
if (iconWrap) { iconWrap.style.animation = '_lockShake 0.5s ease'; setTimeout(() => { iconWrap.style.animation = ''; }, 520); }
if (errName === 'InvalidStateError' || errMsg.includes('credential') || errMsg.includes('Credential')) {
showToast("Credential not found. Disable and re-enable Fingerprint Lock.", "error", 6000);
} else {
showToast(errName ? errName + ': ' + errMsg : errMsg, "error", 6000);
}
_reEnable();
}
};
}
}

function setRepMode(mode) {
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
updateRepCollectionPreview();
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
updateRepCollectionPreview(debt);
}
}

function updateRepCollectionPreview(debtOverride) {
if (repTransactionMode !== 'collection') return;
const _credEl = document.getElementById('rep-customer-current-credit');
const debt = (typeof debtOverride === 'number')
? debtOverride
: parseFloat((_credEl?.innerText || '0').replace(/[^0-9.-]/g, '')) || 0;
const inputAmt = parseFloat(document.getElementById('rep-amount-collected')?.value) || 0;
const remaining = Math.max(0, debt - inputAmt);
const _repTV = document.getElementById('rep-total-value');
if (_repTV) _repTV.innerText = '' + fmtAmt(safeNumber(remaining, 0));
}

async function calculateRepSalePreview() {
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
if(repTransactionMode === 'sale') {
const qty = parseFloat(document.getElementById('rep-quantity').value) || 0;
const salePrice = await getSalePriceForStore('STORE_A');
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
const _gpsBgPromise = Promise.race([
  getPosition(),
  new Promise(resolve => setTimeout(() => resolve(null), 10000))
]).catch(() => null);
const now = new Date();
const timeString = now.toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit', hour12: true});
const costPerKg = await getCostPriceForStore('STORE_A');
const salePrice = await getSalePriceForStore('STORE_A');
let transactionRecord = {};
if(repTransactionMode === 'sale') {
const qty = parseFloat(document.getElementById('rep-quantity').value) || 0;
const payType = document.getElementById('rep-payment-value').value;
if(qty <= 0) {
showToast("Enter Quantity", "warning");
restoreBtn();
return;
}
if(!salePrice || salePrice <= 0) {
showToast(" Sale price not configured. Set prices in Factory Formulas before recording rep sales.", "warning", 5000);
restoreBtn();
return;
}
if(costPerKg < 0) {
showToast(" Invalid cost price detected. Please check Factory Formulas.", "warning", 4000);
restoreBtn();
return;
}
const totalValue = qty * salePrice;
const computedProfit = totalValue - (qty * costPerKg);
if(computedProfit < 0) {
showToast(` This sale would result in a loss of ${fmtAmt ? fmtAmt(Math.abs(computedProfit)) : Math.abs(computedProfit).toFixed(2)}. Check sale price vs cost price in Factory Formulas.`, "warning", 6000);
restoreBtn();
return;
}
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
let _repOutstanding = 0;
try {
const _repHistory = repSales.filter(s =>
s && s.customerName && s.customerName.toLowerCase() === name.toLowerCase() &&
s.salesRep === currentRepProfile
);
for (const h of _repHistory) {
if (h.transactionType === 'OLD_DEBT') {
if (!h.creditReceived) _repOutstanding += (parseFloat(h.totalValue) || 0) - (h.partialPaymentReceived || 0);
} else if (h.paymentType === 'CREDIT' && !h.creditReceived) {
if (h.isMerged && typeof h.creditValue === 'number') {
_repOutstanding += h.creditValue;
} else {
_repOutstanding += (parseFloat(h.totalValue) || 0) - (h.partialPaymentReceived || 0);
}
} else if (h.paymentType === 'COLLECTION' || h.paymentType === 'PARTIAL_PAYMENT') {
_repOutstanding -= (h.totalValue || 0);
}
}
_repOutstanding = Math.max(0, _repOutstanding);
} catch (_e) { _repOutstanding = -1; }
if (_repOutstanding === 0) {
showToast(`${name} has no outstanding credit balance. Collections can only be recorded against existing unpaid credit.`, 'error', 5000);
restoreBtn();
return;
} else if (_repOutstanding > 0 && amount > _repOutstanding) {
const _overAmt = amount - _repOutstanding;
const _proceedOver = await showGlassConfirm(
` Over-collection Warning!

${name} only owes ${fmtAmt ? fmtAmt(_repOutstanding) : _repOutstanding}.
You are collecting ${fmtAmt ? fmtAmt(amount) : amount} — an overpayment of ${fmtAmt ? fmtAmt(_overAmt) : _overAmt}.

This will exceed the outstanding balance. Proceed only if this is an advance payment.`,
{ title: ' Over-collection Warning', confirmText: 'Collect Anyway', cancelText: 'Cancel' }
);
if (!_proceedOver) { restoreBtn(); return; }
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
await unifiedSave('rep_sales', repSales, transactionRecord);

void _gpsBgPromise.then(async coords => {
  if (!coords) return;
  try {
    const allSales = ensureArray(await sqliteStore.get('rep_sales'));
    const idx = allSales.findIndex(s => s.id === transactionRecord.id);
    if (idx !== -1 && !allSales[idx].gps) {
      allSales[idx].gps = coords;
      allSales[idx].updatedAt = getTimestamp();
      await unifiedSave('rep_sales', allSales, allSales[idx]);
    }
    autoUpdateCustomerLocation(name, coords).catch(() => {});
  } catch (_gpsErr) { console.warn('Background GPS patch failed:', _safeErr(_gpsErr)); }
}).catch(() => {});
try {
const _rcName = transactionRecord.customerName;
const _rcPhone = transactionRecord.customerPhone || '';
if (_rcName && _rcName.trim()) {
const existsInRepRegistry = Array.isArray(repCustomers) && repCustomers.some(c => c && c.name && c.name.toLowerCase() === _rcName.toLowerCase() && (c.salesRep === currentRepProfile || !c.salesRep));
if (!existsInRepRegistry) {
const _rcContact = { id: generateUUID('rep_cust'), name: _rcName, phone: _rcPhone, address: '', oldDebit: 0, salesRep: currentRepProfile, createdAt: getTimestamp(), updatedAt: getTimestamp(), timestamp: getTimestamp() };
if (!Array.isArray(repCustomers)) repCustomers = [];
repCustomers.push(_rcContact);
await unifiedSave('rep_customers', repCustomers, _rcContact);
}
}
} catch (_rcErr) { console.warn('Auto-register rep customer failed:', _safeErr(_rcErr)); }
notifyDataChange('rep');
if (navigator.onLine) {
emitSyncUpdate({ rep_sales: null}).catch(e => {
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
const _custName2 = document.getElementById('rep-cust-name'); if (_custName2) _custName2.value = '';
const _custInfo2 = document.getElementById('rep-customer-info-display'); if (_custInfo2) _custInfo2.classList.add('hidden');
await setRepMode('sale');
}
if(phoneInput) phoneInput.value = '';
document.getElementById('rep-new-customer-phone-container').classList.add('hidden');
renderRepCustomerTable();
renderRepHistory();
showToast("Transaction Saved Successfully", "success");
setTimeout(updateRepLiveMap, 300);
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
const _lcAutoName = customerName.toLowerCase();
const contactIndex = repCustomers.findIndex(c => {
if (!c || !c.name) return false;
if (c.name.toLowerCase() !== _lcAutoName) return false;
if (c.salesRep) return c.salesRep === currentRepProfile;
return repSales.some(s => s && s.salesRep === currentRepProfile && s.customerName && s.customerName.toLowerCase() === _lcAutoName);
});
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
await unifiedSave('rep_customers', repCustomers, repCustomers[contactIndex]);
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
let activeRepSales = repSales;
try {
const freshRepSales2 = await sqliteStore.get('rep_sales', []);
if (Array.isArray(freshRepSales2) && freshRepSales2.length > 0) {
const recordMap2 = new Map(freshRepSales2.filter(s => s && s.id).map(s => [s.id, s]));
repSales.forEach(s => { if (s && s.id && !recordMap2.has(s.id)) recordMap2.set(s.id, s); });
activeRepSales = Array.from(recordMap2.values());
}
} catch (_e) {  }
const myData = activeRepSales.filter(s =>
s.salesRep === currentRepProfile
);
const custMap = {};
myData.forEach(s => {
if(!custMap[s.customerName]) custMap[s.customerName] = { debt: 0, count: 0 };
custMap[s.customerName].count++;
if (s.transactionType === 'OLD_DEBT' && !s.creditReceived) {
const partialPaid = s.partialPaymentReceived || 0;
custMap[s.customerName].debt += ((s.totalValue || 0) - partialPaid);
} else if(s.paymentType === 'CREDIT' && !s.creditReceived) {
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
const repSalesNamesForProfile = new Set(
(Array.isArray(repSales) ? repSales : [])
.filter(s => s && s.salesRep === currentRepProfile && s.customerName)
.map(s => s.customerName.toLowerCase())
);
repCustomers.forEach(rc => {
if (!rc || !rc.name || !rc.name.trim()) return;
if (rc.salesRep && rc.salesRep !== currentRepProfile) return;
if (!rc.salesRep && !repSalesNamesForProfile.has(rc.name.toLowerCase())) return;
const lcName = rc.name.toLowerCase();
if (custMapNames.has(lcName)) return;
custMap[rc.name] = { debt: 0, count: 0 };
sortedCustomers.push(rc.name);
custMapNames.add(lcName);
});
sortedCustomers.sort();
}
const filteredCustomers = sortedCustomers.filter(name => {
if (!filter) return true;
return name && typeof name === 'string' && name.toLowerCase().includes(filter);
});
const totalItems = filteredCustomers.length;
if (!filteredCustomers || !Array.isArray(filteredCustomers) || !custMap) {
tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--danger);">Invalid customer data</td></tr>`;
} else if (totalItems === 0) {
if (Object.keys(custMap).length === 0) {
tbody.innerHTML = `<tr><td class="u-empty-state-md" colspan="5" >No customers yet. Add your first sale to get started!</td></tr>`;
} else {
const filterInput = document.getElementById('rep-filter');
const filter = filterInput ? filterInput.value : '';
tbody.innerHTML = `<tr><td class="u-empty-state-md" colspan="5" >No customers match "${esc(filter)}"</td></tr>`;
}
} else {
function buildRepCustomerRow(name) {
const customerData = custMap[name];
const customerTransactions = repSales.filter(s =>
s.customerName === name &&
s.salesRep === currentRepProfile
);
const latestTransaction = customerTransactions.sort((a, b) => b.timestamp - a.timestamp)[0];
const displayDate = latestTransaction?.date ? formatDisplayDate(latestTransaction.date) : '-';
const repContact = repCustomers.find(c => c && c.name && c.name.toLowerCase() === name.toLowerCase() && (c.salesRep === currentRepProfile || !c.salesRep));
const phone = repContact?.phone || latestTransaction?.customerPhone || '-';
const tr = document.createElement('tr');
tr.style.borderBottom = '1px solid var(--glass-border)';
const safeNameForAttr = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
tr.innerHTML = `
<td class="u-table-td">${displayDate}</td>
<td style="padding: 8px 2px; font-size: 0.8rem; color: var(--accent); font-weight: 600; cursor:pointer;" onclick="event.stopPropagation(); openRepCustomerManagement('${safeNameForAttr}')">${esc(name)}</td>
<td class="u-table-td">${phoneActionHTML(phone)}</td>
<td style="padding: 8px 2px; text-align: right; font-size: 0.8rem; color: ${customerData.debt > 1 ? 'var(--warning)' : 'var(--accent-emerald)'}; font-weight: 700;">
${fmtAmt(Math.max(0, customerData.debt))}
</td>`;
return tr;
}
tbody.innerHTML = '';
const _fragR = document.createDocumentFragment();
filteredCustomers.forEach((name, i) => { const el = buildRepCustomerRow(name, i); if (el) _fragR.appendChild(el); });
tbody.appendChild(_fragR);
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

async function openRepCustomerManagement(customerName) {
currentManagingRepCustomer = customerName;
const _repMCT = document.getElementById('repManageCustomerTitle'); if (_repMCT) _repMCT.innerText = customerName;
const _repBulk = document.getElementById('repBulkPaymentAmount'); if (_repBulk) _repBulk.value = '';
if (typeof openStandaloneScreen === 'function') openStandaloneScreen('rep-customer-management-screen');
await renderRepCustomerTransactions(customerName);
}

async function closeRepCustomerManagement() {
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
if (typeof closeStandaloneScreen === 'function') closeStandaloneScreen('rep-customer-management-screen');
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
msg += `\n\n This customer has ${txs.length} transaction record${txs.length !== 1 ? 's' : ''} on file.`;
if (totalDebt > 0) msg += `\n Outstanding debt: ${fmtAmt(totalDebt)}`;
msg += `\n\nAll rep sales history for this customer will be permanently deleted.`;
}
msg += `\n\nThis cannot be undone.`;
if (!(await showGlassConfirm(msg, { title: 'Delete Rep Customer', confirmText: 'Delete Permanently', danger: true }))) return;
try {
const _lcDelName = name.toLowerCase();
const contactIdx = repCustomers.findIndex(c => {
if (!c || !c.name) return false;
if (c.name.toLowerCase() !== _lcDelName) return false;
if (c.salesRep) return c.salesRep === currentRepProfile;
return repSales.some(s => s && s.salesRep === currentRepProfile && s.customerName && s.customerName.toLowerCase() === _lcDelName);
});
if (contactIdx !== -1) {
const contactRecord = repCustomers[contactIdx];
const contactId = contactRecord.id;
const filteredContacts = repCustomers.filter((_, i) => i !== contactIdx);
await unifiedDelete('rep_customers', filteredContacts, contactId, { strict: true }, contactRecord);
repCustomers.splice(contactIdx, 1);
}
const repTxsToDelete = txs.slice();
let prunedRepSales = repSales.slice();
for (const tx of repTxsToDelete) {
prunedRepSales = prunedRepSales.filter(s => s.id !== tx.id);
await unifiedDelete('rep_sales', prunedRepSales, tx.id, { strict: true }, tx);
}
try {
const _rcPhKey = 'rep-cust:' + (currentRepProfile || '') + ':' + name.toLowerCase();
const _rcPh = (await sqliteStore.get('person_photos')) || {};
if (_rcPh[_rcPhKey] !== undefined) {
delete _rcPh[_rcPhKey];
await sqliteStore.set('person_photos', _rcPh);
const _rcPhTs = (await sqliteStore.get('person_photos_timestamps')) || {};
delete _rcPhTs[_rcPhKey];
await sqliteStore.set('person_photos_timestamps', _rcPhTs);
const _rcDk = (await sqliteStore.get('person_photos_dirty_keys')) || [];
if (!_rcDk.includes(_rcPhKey)) _rcDk.push(_rcPhKey);
await sqliteStore.set('person_photos_dirty_keys', _rcDk);
}
} catch(_rcPhErr) { console.warn('[deleteCurrentRepCustomer] photo cleanup failed', _rcPhErr); }
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
const contact = repContacts.find(c => c && c.name && c.name.toLowerCase() === name.toLowerCase() && c.salesRep === currentRepProfile)
  || repContacts.find(c => c && c.name && c.name.toLowerCase() === name.toLowerCase());
const phone = contact?.phone || transactions.find(t => t && t.customerPhone)?.customerPhone || '';
const address = contact?.address || '';
const _repHeaderPhoto = await getPersonPhoto('rep-cust:' + (currentRepProfile || '') + ':' + name.toLowerCase());
const _repAvatarHTML = renderPersonAvatarHTML(_repHeaderPhoto, 42);
const _repSafeName = esc(name).split("'").join("\\'");
const headerTitle = document.getElementById('repManageCustomerTitle');
headerTitle.innerHTML = `
<div style="display:flex;align-items:center;gap:10px;">
${_repAvatarHTML}
<div style="min-width:0;flex:1;">
<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
<span>${esc(name)}</span>
<button class="sidebar-settings-btn" style="width:auto;padding:5px 10px;font-size:0.75rem;color:var(--accent);background:rgba(29,233,182,0.07);border-radius:8px;border:1px solid rgba(29,233,182,0.25);display:inline-flex;align-items:center;gap:5px;" onclick="openRepCustomerEditModal('${_repSafeName}')" title="Edit Contact Info"><svg width="13" height="13" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="5" width="26" height="7" rx="2.5" fill="var(--accent)" fill-opacity="0.18" stroke="var(--accent)" stroke-width="1.4"/><rect x="5" y="15" width="26" height="7" rx="2.5" fill="var(--accent)" fill-opacity="0.12" stroke="var(--accent)" stroke-width="1.4"/><rect x="5" y="25" width="18" height="7" rx="2.5" fill="var(--accent)" fill-opacity="0.08" stroke="var(--accent)" stroke-width="1.4"/><line x1="27" y1="26" x2="32" y2="21" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round"/><circle cx="26" cy="27" r="1" fill="var(--accent)"/></svg>Edit</button>
</div>
<div style="font-size:0.75rem;color:var(--text-muted);font-weight:normal;margin-top:2px;">
${phone ? phoneActionHTML(phone) : 'No Phone'} ${address ? `|  ${esc(address)}` : ''}
</div>
</div>
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
toggleBtnHtml = `<span class="status-toggle-btn ${statusClass}" style="pointer-events:none;cursor:default;">${btnText}</span>`;
} else if (isPartialPayment) {
toggleBtnHtml = `<span class="status-toggle-btn txn-warning">PARTIAL PAYMENT</span>`;
} else if (isCollection) {
toggleBtnHtml = `<span class="status-toggle-btn txn-collect">COLLECTION</span>`;
} else {
toggleBtnHtml = `<span class="status-toggle-btn txn-cash">CASH SALE</span>`;
}
const deleteBtnHtml = t.isMerged ? '' : `<button class="btn btn-sm btn-danger u-p-4-8" onclick="deleteRepTransactionFromOverlay('${esc(t.id)}')">⌫</button>`;
const safeId = String(t.id).replace(/'/g, "\\'");
const panelId = `rp-${t.id}`;
const kebabBtn = t.isMerged
  ? `<button class="txn-kebab-btn" title="View pre-close details" onclick="_togglePreclosePanel(this,'${panelId}','${safeId}','rep_sales','sale')">⋮</button>`
  : '';
const panelPlaceholder = t.isMerged ? `<div class="txn-preclose-panel" id="${panelId}"></div>` : '';
const item = document.createElement('div');
item.className = `cust-history-item${t.isSettled ? ' is-settled-record' : ''}`;
item.style.flexDirection = 'column';
item.style.alignItems = 'stretch';
let itemContent = '';
if (isPartialPayment || isCollection) {
itemContent = `
<div class="txn-card-row">
  <div class="cust-history-info">
    <div class="u-fs-sm2 u-text-muted">${formatDisplayDateTime(t.date, t.time || null)}${_mergedBadgeHtml(t, {inline:true})}</div>
    <div style="font-size:0.75rem;color:var(--accent-emerald);">Payment: ${await formatCurrency(t.totalValue)}</div>
    <div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">${isPartialPayment ? 'Partial Payment' : 'Bulk Payment'}</div>
  </div>
  <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
    ${toggleBtnHtml}${deleteBtnHtml}${kebabBtn}
  </div>
</div>${panelPlaceholder}`;
} else if (isOldDebt) {
itemContent = `
<div class="txn-card-row">
  <div class="cust-history-info">
    <div class="u-fs-sm2 u-text-muted">
      ${formatDisplayDateTime(t.date, t.time || null)}
      <span class="old-debt-badge">OLD DEBT</span>${_mergedBadgeHtml(t, {inline:true})}
    </div>
    <div style="font-size:0.75rem;color:var(--warning);">Previous Balance: ${await formatCurrency(t.totalValue)}</div>
    <div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">${esc(t.notes || 'Brought forward from previous records')}</div>
  </div>
  <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
    ${toggleBtnHtml}${deleteBtnHtml}${kebabBtn}
  </div>
</div>${panelPlaceholder}`;
} else {
const _repDisplayUnitPrice = (t.unitPrice && t.unitPrice > 0)
  ? t.unitPrice
  : await getSalePriceForStore(t.supplyStore || 'STORE_A');
itemContent = `
<div class="txn-card-row">
  <div class="cust-history-info">
    <div class="u-fs-sm2 u-text-muted">${formatDisplayDateTime(t.date, t.time || null)}${_mergedBadgeHtml(t, {inline:true})}</div>
    <div style="font-size:0.75rem;color:var(--text-muted);">${safeToFixed(t.quantity, 2)} kg @ ${await formatCurrency(_repDisplayUnitPrice)} = ${await formatCurrency(t.totalValue)}</div>
    ${hasPartialPayment ? `<div style="font-size:0.7rem;color:var(--accent-emerald);margin-top:2px;">Paid: ${await formatCurrency(partialPaid)}</div>` : ''}
  </div>
  <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
    ${toggleBtnHtml}${deleteBtnHtml}${kebabBtn}
  </div>
</div>${panelPlaceholder}`;
}
item.innerHTML = itemContent;
_repFrag.appendChild(item);
}
list.replaceChildren(_repFrag);
}

async function openRepCustomerEditModal(customerName) {
customerName = customerName || '';
const isAddMode = !customerName;
const titleEl = document.getElementById('rep-cust-edit-screen-title');
const saveBtn = document.getElementById('rep-cust-edit-save-btn');
const nameInput = document.getElementById('rep-edit-cust-name');
const nameHint = document.getElementById('rep-cust-name-hint');
const nameLabel = document.getElementById('rep-cust-name-label');
if (titleEl) titleEl.textContent = isAddMode ? 'Add Customer' : 'Edit Rep Customer';
if (saveBtn) saveBtn.textContent = isAddMode ? 'Add Customer' : 'Update Details';
if (isAddMode) {
nameInput.placeholder = 'Type name to search or add...';
nameInput.oninput = function() {
handleUniversalSearch('rep-edit-cust-name', 'rep-cust-add-search-results', 'repCustomers');
};
if (nameLabel) nameLabel.textContent = 'Customer Name';
if (nameHint) nameHint.textContent = 'Search existing customers or type a new name to add.';
const searchResults = document.getElementById('rep-cust-add-search-results');
if (searchResults) searchResults.classList.add('hidden');
} else {
nameInput.placeholder = 'Customer name';
nameInput.oninput = null;
if (nameLabel) nameLabel.textContent = 'Customer Name';
if (nameHint) nameHint.textContent = 'Editing the name will update all records for this customer';
}
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
nameInput.value = customerName;
nameInput.dataset.originalName = customerName;
if (!customerName) {
document.getElementById('rep-edit-cust-phone').value = '';
document.getElementById('rep-edit-cust-address').value = '';
document.getElementById('rep-edit-cust-old-debit').value = '';
const _repPhotoKey = 'rep-cust:' + (currentRepProfile || '') + ':';
await loadPersonPhotoIntoEditor('rep-cust', _repPhotoKey);
if (typeof openStandaloneScreen === 'function') openStandaloneScreen('rep-customer-edit-screen');
return;
}
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
const _repPhotoKey = 'rep-cust:' + (currentRepProfile || '') + ':' + customerName.toLowerCase();
await loadPersonPhotoIntoEditor('rep-cust', _repPhotoKey);
if (typeof openStandaloneScreen === 'function') openStandaloneScreen('rep-customer-edit-screen');
}

function closeRepCustomerEditModal() {
if (typeof closeStandaloneScreen === 'function') closeStandaloneScreen('rep-customer-edit-screen');
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
if (oldDebit < 0) { showToast('Old debt balance cannot be negative. Enter 0 to clear the balance.', 'warning', 4000); return; }
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
await unifiedSave('rep_customers', repCustomers, contact);
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
if (!tx.time) tx.time = new Date().toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit', hour12: true});
ensureRecordIntegrity(tx, true);
oldDebtModified = true; oldDebtRecord = tx;
} else {
const tx = { id: generateUUID('old_debt'), date: new Date().toISOString().split('T')[0],
customerName: name, customerPhone: phone, salesRep: currentRepProfile, quantity: 0,
supplyStore: 'N/A', paymentType: 'CREDIT', transactionType: 'OLD_DEBT',
totalValue: oldDebit, creditReceived: false, partialPaymentReceived: 0,
time: new Date().toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit', hour12: true}),
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
if (deletedOldDebtId) {
const _deletedRecord = window._repOldDebtRecordForDeletion || null;
window._repOldDebtRecordForDeletion = null;
await unifiedDelete('rep_sales', salesArray, deletedOldDebtId, { strict: true }, _deletedRecord);
} else {
await unifiedSave('rep_sales', salesArray, oldDebtModified && !phoneUpdated && !nameChanged ? oldDebtRecord : null);
}
if (nameChanged && renamedRecords.length > 0) {
await unifiedSave('rep_sales', salesArray, null, renamedRecords.map(r => r.id));
}
}
const message = nameChanged ? `Rep customer renamed to "${name}" and details updated`
: oldDebit > 0 ? `Rep customer updated with old debt of ₨${oldDebit.toLocaleString()}`
: (oldDebit === 0 && previousOldDebit > 0) ? 'Rep customer updated and old debt cleared'
: 'Rep customer details updated successfully';
const _repPhotoKeyOld = 'rep-cust:' + (currentRepProfile || '') + ':' + originalName.toLowerCase();
const _repPhotoKeyNew = 'rep-cust:' + (currentRepProfile || '') + ':' + name.toLowerCase();
if (nameChanged) {
const _oldRepPhoto = await getPersonPhoto(_repPhotoKeyOld);
if (_oldRepPhoto) {
const _repPhotos = await sqliteStore.get('person_photos') || {};
_repPhotos[_repPhotoKeyNew] = _oldRepPhoto;
delete _repPhotos[_repPhotoKeyOld];
await sqliteStore.set('person_photos', _repPhotos);
const _rdk = (await sqliteStore.get('person_photos_dirty_keys')) || [];
if (!_rdk.includes(_repPhotoKeyNew)) _rdk.push(_repPhotoKeyNew);
if (!_rdk.includes(_repPhotoKeyOld)) _rdk.push(_repPhotoKeyOld);
await sqliteStore.set('person_photos_dirty_keys', _rdk);
await sqliteStore.set('person_photos_timestamp', Date.now());
const _repPreview = document.getElementById('rep-cust-photo-preview');
if (_repPreview) _repPreview.dataset.pendingPhoto = undefined;
} else {
await savePersonPhoto('rep-cust', _repPhotoKeyNew);
}
} else {
await savePersonPhoto('rep-cust', _repPhotoKeyNew);
}
showToast(message, 'success');
closeRepCustomerEditModal();
await new Promise(r => setTimeout(r, 350));
if (nameChanged && currentManagingRepCustomer && currentManagingRepCustomer.toLowerCase() === originalName.toLowerCase()) {
currentManagingRepCustomer = name;
}
const overlay = document.getElementById('rep-customer-management-screen');
if (overlay && overlay.style.display !== 'none') await renderRepCustomerTransactions(currentManagingRepCustomer || name);
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
const gpsOptions = { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 };
const GPS_ACCURACY_THRESHOLD = 50;
const GPS_MAX_WAIT_MS = 25000;
await new Promise((resolve) => {
let watchId = null;
let best = null;
let settled = false;
const finish = async (position) => {
if (settled) return;
settled = true;
if (watchId !== null) navigator.geolocation.clearWatch(watchId);
const lat = position.coords.latitude;
const lon = position.coords.longitude;
const accuracy = position.coords.accuracy;
const coordsText = `${safeNumber(lat, 0).toFixed(6)}, ${safeNumber(lon, 0).toFixed(6)}`;
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
statusDiv.textContent = ` Location Found: ${localArea || placeName || city}`;
statusDiv.style.color = 'var(--accent-emerald)';
if (typeof showToast === 'function') showToast('Address updated successfully', 'success');
} else { throw new Error('Address not found'); }
} catch (error) {
console.error('An unexpected error occurred.', _safeErr(error));
showToast('Address lookup failed: ' + (_safeErr(error).message || 'GPS coordinates saved instead'), 'error');
addressInput.value = `GPS: ${coordsText}`;
statusDiv.textContent = 'Address lookup failed. Saved GPS Coordinates.';
statusDiv.style.color = 'var(--warning)';
} finally { if (btn) btn.disabled = false; resolve(); }
};
watchId = navigator.geolocation.watchPosition(
(position) => {
if (!best || position.coords.accuracy < best.coords.accuracy) best = position;
if (position.coords.accuracy <= GPS_ACCURACY_THRESHOLD) finish(position);
},
(error) => {
if (settled) return;
settled = true;
if (watchId !== null) navigator.geolocation.clearWatch(watchId);
let msg = 'Location error.';
if (error.code === error.PERMISSION_DENIED) msg = ' Permission denied. Check Phone Settings.';
else if (error.code === error.POSITION_UNAVAILABLE) msg = ' Weak GPS signal. Go outside.';
else if (error.code === error.TIMEOUT) msg = ' GPS timeout. Try again.';
statusDiv.textContent = msg;
statusDiv.style.color = 'var(--danger)';
if (btn) btn.disabled = false;
resolve();
},
gpsOptions
);
setTimeout(() => { if (!settled && best) finish(best); }, GPS_MAX_WAIT_MS);
});
}

async function exportRepCustomerToPDF() {
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
if (!currentManagingRepCustomer) { showToast('No rep customer selected', 'warning'); return; }
const customerName = currentManagingRepCustomer.trim();
if (!customerName) { showToast('No rep customer selected', 'warning'); return; }
const rangeSelect = document.getElementById('repCustomerPdfRange');
const range = rangeSelect ? rangeSelect.value : 'all';
showToast('Generating PDF...', 'info');
try {
if (!window.jspdf) {
await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js');
await new Promise(r => setTimeout(r, 200));
}
if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('Failed to load PDF library. Please refresh and try again.');
const allRepCustTxns = repSales.filter(s => s.customerName === customerName && s.salesRep === currentRepProfile);
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
let repPeriodCutoff = null;
if (range !== 'all') {
  switch(range) {
    case 'today':  repPeriodCutoff = today; break;
    case 'week':   { const w = new Date(today); w.setDate(w.getDate() - 7);      repPeriodCutoff = w; break; }
    case 'month':  { const m = new Date(today); m.setMonth(m.getMonth() - 1);    repPeriodCutoff = m; break; }
    case 'year':   { const y = new Date(today); y.setFullYear(y.getFullYear()-1); repPeriodCutoff = y; break; }
  }
}
const repPriorTxns = repPeriodCutoff
  ? allRepCustTxns.filter(t => {
      if (t.transactionType === 'OLD_DEBT') return true;
      if (!t.date) return false;
      return new Date(t.date) < repPeriodCutoff;
    })
  : [];
let transactions = repPeriodCutoff
  ? allRepCustTxns.filter(t => {
      if (t.transactionType === 'OLD_DEBT') return false;
      if (!t.date) return false;
      return new Date(t.date) >= repPeriodCutoff;
    })
  : allRepCustTxns;
const repOpeningBalance = repPriorTxns.reduce((bal, t) => {
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
const _repEffDate = (t) => {
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
return _repEffDate(a) - _repEffDate(b);
});
const repContact = repCustomers.find(c => c && c.name && c.name.toLowerCase() === customerName.toLowerCase());
const phone = repContact?.phone || transactions.find(t => t.customerPhone)?.customerPhone || 'N/A';
const address = repContact?.address || 'N/A';
const { jsPDF } = window.jspdf;
const doc = new jsPDF('p', 'mm', 'a4');
const pageW = doc.internal.pageSize.getWidth();
const hdrColor = [79, 70, 229];
doc.setFillColor(...hdrColor);
doc.rect(0, 0, pageW, 22, 'F');
doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.setTextColor(255, 255, 255);
doc.text('GULL AND ZUBAIR NASWAR DEALERS', pageW / 2, 10, { align: 'center' });
doc.setFontSize(9); doc.setFont(undefined, 'normal');
doc.text('Naswar Manufacturers & Dealers', pageW / 2, 17, { align: 'center' });
const rangeName = range === 'all' ? 'All Time' : range === 'today' ? 'Today' :
range === 'week' ? 'This Week' : range === 'month' ? 'This Month' : 'This Year';
doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.setTextColor(50, 50, 50);
doc.text(`Rep Customer Account Statement · ${rangeName}`, pageW / 2, 30, { align: 'center' });
doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(80, 80, 80);
let yPos = 38;

const _repPdfPhotoKey = 'rep-cust:' + (currentRepProfile || '') + ':' + customerName.toLowerCase();
const _repPdfPhoto = await getPersonPhoto(_repPdfPhotoKey);
if (_repPdfPhoto) {
  try { doc.addImage(_repPdfPhoto, 'JPEG', pageW - 14 - 22, 25, 22, 22); } catch(e) {}
}
doc.setFont(undefined, 'bold'); doc.text('Customer:', 14, yPos);
doc.setFont(undefined, 'normal'); doc.text(customerName, 36, yPos);
doc.setFont(undefined, 'bold'); doc.text('Phone:', 14, yPos + 5);
doc.setFont(undefined, 'normal'); doc.text(phone, 36, yPos + 5);
doc.setFont(undefined, 'bold'); doc.text('Sales Rep:', 14, yPos + 10);
doc.setFont(undefined, 'normal'); doc.text(currentRepProfile || 'N/A', 36, yPos + 10);
doc.setFont(undefined, 'bold'); doc.text('Generated:', pageW / 2, yPos);
doc.setFont(undefined, 'normal');
doc.text(now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), pageW / 2 + 22, yPos);
yPos += 18;
doc.setDrawColor(...hdrColor); doc.setLineWidth(0.5);
doc.line(14, yPos, pageW - 14, yPos);
yPos += 5;
if (transactions.length > 0) {
const buildRow = async (t, runBal) => {
const pt = t.paymentType || 'CASH';
const isOldDebt = t.transactionType === 'OLD_DEBT';
let debit = 0, credit = 0, typeLabel = '', detailLabel = '', displayDate = formatDisplayDate(t.supplyDate || t.date);
const unitPrice = (t.unitPrice && t.unitPrice > 0) ? t.unitPrice : await getSalePriceForStore(t.supplyStore || 'STORE_A');
if (isOldDebt) {
debit = parseFloat(t.totalValue) || 0;
credit = parseFloat(t.partialPaymentReceived) || 0;
typeLabel = 'OLD DEBT';
detailLabel = t.notes || 'Brought forward from previous records';
displayDate = formatDisplayDate(t.date);
} else if (pt === 'CASH') {
const val = t.totalValue || 0;
debit = val; credit = val;
typeLabel = 'CASH';
detailLabel = `${fmtAmt(t.quantity||0)} kg × Rs ${fmtAmt(unitPrice)}`;
} else if (pt === 'CREDIT' && !t.creditReceived) {
const val = t.totalValue || 0;
const partial = parseFloat(t.partialPaymentReceived) || 0;
debit = val; credit = partial;
typeLabel = partial > 0 ? 'CREDIT\n(PARTIAL)' : 'CREDIT';
detailLabel = `${fmtAmt(t.quantity||0)} kg × Rs ${fmtAmt(unitPrice)}`;
if (partial > 0) detailLabel += `\nPaid: Rs ${fmtAmt(partial)} | Due: Rs ${fmtAmt(val-partial)}`;
} else if (pt === 'CREDIT' && t.creditReceived) {
const val = t.totalValue || 0;
debit = val; credit = val;
typeLabel = 'CREDIT\n(PAID)';
detailLabel = `${fmtAmt(t.quantity||0)} kg × Rs ${fmtAmt(unitPrice)}`;
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
else if (runBal.val > 0) balDisplay = 'Rs ' + fmtAmt(runBal.val);
else balDisplay = 'OVERPAID\nRs ' + fmtAmt(Math.abs(runBal.val));
return { row: [displayDate, typeLabel, detailLabel.substring(0,55),
debit>0?'Rs '+fmtAmt(debit):'-', credit>0?'Rs '+fmtAmt(credit):'-', balDisplay],
debit, credit, qty: t.quantity||0 };
};
const normalTxns = transactions.filter(t => !t.isMerged);
const repHasPrior = repPeriodCutoff !== null && repPriorTxns.length > 0;
const txRunBal = { val: repHasPrior ? repOpeningBalance : 0 };
const txRows = [];
let totDebit = 0, totCredit = 0, totQty = 0;
for (const t of normalTxns) {
const r = await buildRow(t, txRunBal);
txRows.push(r.row);
totDebit += r.debit;
totCredit += r.credit;
totQty += r.qty;
}
if (repHasPrior) {
  const obAbs = Math.abs(repOpeningBalance);
  const obDisplay = obAbs < 0.01 ? 'SETTLED' : 'Rs ' + fmtAmt(obAbs);
  txRows.unshift([
    'Prior', '—',
    'Opening Balance\n(All activity before this period)',
    '-', '-', obDisplay
  ]);
}
const finalBal = (repHasPrior ? repOpeningBalance : 0) + totDebit - totCredit;
doc.autoTable({
startY: yPos,
head: [['Date', 'Type', 'Details', 'Debit (Sale)', 'Credit (Rcvd)', 'Balance']],
body: txRows,
theme: 'grid',
headStyles: { fillColor: hdrColor, textColor: 255, fontSize: 8.5, fontStyle: 'bold', halign: 'center' },
styles: { fontSize: 7.5, cellPadding: 2.5, lineWidth: 0.15, lineColor: [180,180,220], overflow: 'linebreak' },
columnStyles: {
0:{cellWidth:22,halign:'center'},1:{cellWidth:22,halign:'center',fontStyle:'bold'},
2:{cellWidth:52},3:{cellWidth:27,halign:'right',textColor:[220,53,69],fontStyle:'bold'},
4:{cellWidth:27,halign:'right',textColor:[40,167,69],fontStyle:'bold'},5:{cellWidth:26,halign:'center',fontStyle:'bold'}
},
didParseCell: function(data) {
const isOpeningRow = repHasPrior && data.row.index === 0;
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
const afterY = ((normalTxns.length > 0 || repHasPrior) ? doc.lastAutoTable.finalY : yPos - 5) + 5;
if (afterY < 252) {
const repBoxH = repHasPrior && Math.abs(repOpeningBalance) >= 0.01 ? 28 : 20;
doc.setFillColor(240, 235, 255);
doc.roundedRect(14, afterY, pageW - 28, repBoxH, 2, 2, 'F');
doc.setDrawColor(...hdrColor); doc.setLineWidth(0.3);
doc.roundedRect(14, afterY, pageW - 28, repBoxH, 2, 2, 'S');
doc.setFontSize(8); doc.setFont(undefined, 'normal');
if (repHasPrior && Math.abs(repOpeningBalance) >= 0.01) {
  const repObSign = repOpeningBalance > 0 ? '+' : '-';
  doc.setTextColor(30, 80, 160);
  doc.text(`Opening Balance: ${repObSign}Rs ${fmtAmt(Math.abs(repOpeningBalance))}`, pageW / 2, afterY + 7, { align: 'center' });
  doc.setTextColor(220, 53, 69);
  doc.text(`Period Debit: Rs ${fmtAmt(totDebit)}`, pageW / 4, afterY + 15, { align: 'center' });
  doc.setTextColor(40, 167, 69);
  doc.text(`Period Credit: Rs ${fmtAmt(totCredit)}`, (pageW * 3) / 4, afterY + 15, { align: 'center' });
} else {
  doc.setTextColor(220, 53, 69);
  doc.text(`Total Debit (Sales): Rs ${fmtAmt(totDebit)}`, pageW / 4, afterY + 8, { align: 'center' });
  doc.setTextColor(40, 167, 69);
  doc.text(`Total Credit (Rcvd): Rs ${fmtAmt(totCredit)}`, (pageW * 3) / 4, afterY + 8, { align: 'center' });
}
doc.setFont(undefined, 'bold');
const balStr = Math.abs(finalBal) < 0.01 ? 'SETTLED'
: finalBal > 0 ? `Outstanding Due: Rs ${fmtAmt(finalBal)}`
: `Overpaid by: Rs ${fmtAmt(Math.abs(finalBal))}`;
doc.setTextColor(Math.abs(finalBal)<0.01?100:finalBal>0?220:40,
Math.abs(finalBal)<0.01?100:finalBal>0?53:167,
Math.abs(finalBal)<0.01?100:69);
doc.text(balStr, pageW / 2, afterY + (repHasPrior && Math.abs(repOpeningBalance) >= 0.01 ? 23 : 15), { align: 'center' });
}
} else {
doc.setFont(undefined, 'normal'); doc.setFontSize(10); doc.setTextColor(150);
doc.text('No transactions recorded for this period.', pageW / 2, yPos + 15, { align: 'center' });
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
const safeRepName = customerName.replace(/[^a-z0-9]/gi, '_');
if (pageCount === 1) {
  showToast('Single-page statement — converting to image…', 'info');
  await _exportDocAsImageAndOpenWhatsApp(
    doc,
    phone,
    `Rep_Customer_Statement_${safeRepName}_${dateStamp}`
  );
} else {
  doc.save(`Rep_Customer_Statement_${safeRepName}_${dateStamp}.pdf`);
  showToast('PDF exported successfully', 'success');
}
} catch (error) {
showToast('Error generating PDF: ' + error.message, 'error');
}
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
${item.isSettled ? `<span class="settled-badge"> Settled</span>` : ''}
</div>
<div style="font-size: 0.75rem; color: ${typeColor}; font-weight: 600;">
${qtyAmount}
</div>
</div>
<div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 5px;">
<div style="display:flex;align-items:center;gap:5px;justify-content:flex-end;flex-wrap:wrap;">
<span class="u-fs-sm u-text-muted">${esc(item.time || '')}</span>
${item.createdBy && typeof _creatorBadgeHtml === 'function' ? _creatorBadgeHtml(item) : ''}
${item.salesRep && !item.createdBy ? `<span class="sales-rep-badge">${esc(item.salesRep.split(' ')[0])}</span>` : ''}
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
