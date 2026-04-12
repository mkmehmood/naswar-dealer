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
window._selectCustomerBase = selectCustomer;
async function calculateCustomerStatsForDisplay(name) {
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
if (!name) return;
const sales = customerSales.filter(s =>
s && s.currentRepProfile === 'admin' && s.customerName && s.customerName.toLowerCase() === name.toLowerCase()
);
if (sales.length === 0) {
document.getElementById('customer-info-display').classList.add('hidden');
return;
}
let totalCredit = 0;
let totalQty = 0;
for (const s of sales) {
totalQty += (s.quantity || 0);
const isRepLinked = s.salesRep !== 'NONE';
if (s.transactionType === 'OLD_DEBT') {
if (!s.creditReceived) {
const partialPaid = s.partialPaymentReceived || 0;
totalCredit += (await getSaleTransactionValue(s) - partialPaid);
}
} else if (s.paymentType === 'CREDIT' && !s.creditReceived) {

if (s.isMerged && typeof s.creditValue === 'number') {
totalCredit += s.creditValue;
} else {
const partialPaid = s.partialPaymentReceived || 0;
totalCredit += (await getSaleTransactionValue(s) - partialPaid);
}
} else if (isRepLinked) {
if (s.paymentType === 'CREDIT' && !s.creditReceived) {
const partialPaid = s.partialPaymentReceived || 0;
totalCredit += (await getSaleTransactionValue(s) - partialPaid);
} else if (s.paymentType === 'COLLECTION') {
totalCredit -= (s.totalValue || 0);
} else if (s.paymentType === 'PARTIAL_PAYMENT') {
totalCredit -= (s.totalValue || 0);
}
} else {

if (s.paymentType === 'COLLECTION') {
totalCredit -= (s.totalValue || 0);
} else if (s.paymentType === 'PARTIAL_PAYMENT') {
totalCredit -= (s.totalValue || 0);
}
}
}
totalCredit = Math.max(0, totalCredit);
const _setCust = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
_setCust('customer-current-credit', await formatCurrency(totalCredit));
_setCust('customer-total-quantity', safeNumber(totalQty, 0).toFixed(2) + ' kg');
document.getElementById('customer-info-display').classList.remove('hidden');
if (typeof custTransactionMode !== 'undefined' && custTransactionMode === 'collection' && typeof updateCollectionPreview === 'function') {
updateCollectionPreview();
}
}

async function renderCustomersTable(page = 1) {
const deletedRecordIds = new Set(ensureArray(await sqliteStore.get('deleted_records')));
const _rctAlive = (item) => item && item.id && !deletedRecordIds.has(String(item.id));
const customerSales = ensureArray(await sqliteStore.get('customer_sales')).filter(_rctAlive);
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers')).filter(_rctAlive);
const tbody = document.getElementById('customers-table-body');
if (!tbody) {
return;
}
try {
const freshSales = await sqliteStore.get('customer_sales', []);
const mergedSales = Array.isArray(freshSales) ? freshSales : customerSales;
} catch (error) {
console.error('UI refresh failed.', _safeErr(error));
showToast('Failed to reload sales data: ' + (_safeErr(error).message || 'please reload the app'), 'error');
}
try {
const freshSalesCustomers = await sqliteStore.get('sales_customers', []);
if (Array.isArray(freshSalesCustomers) && freshSalesCustomers.length > 0) {
const regMap = new Map(freshSalesCustomers.map(c => [c.id, c]));
if (Array.isArray(salesCustomers)) {
salesCustomers.forEach(c => { if (c && c.id && !regMap.has(c.id)) regMap.set(c.id, c); });
}
const mergedSC = Array.from(regMap.values());
await sqliteStore.set('sales_customers', mergedSC);
}
} catch (regError) {
console.warn('Registry refresh failed, using in-memory:', _safeErr(regError));
}
const filterInput = document.getElementById('customer-filter');
const filterValue = filterInput ? filterInput.value.toLowerCase() : '';
const customerStats = {};
for (const sale of customerSales) {
const name = sale.customerName;
if (!name || name.trim() === '') continue;
if (sale.currentRepProfile !== 'admin') continue;
const isRepLinked = sale.salesRep && sale.salesRep !== 'NONE';
if (!customerStats[name]) {
customerStats[name] = { name: name, credit: 0, quantity: 0, lastSaleDate: 0 };
}
customerStats[name].quantity += (sale.quantity || 0);
if (sale.transactionType === 'OLD_DEBT' && !sale.creditReceived) {
const partialPaid = sale.partialPaymentReceived || 0;
customerStats[name].credit += (await getSaleTransactionValue(sale) - partialPaid);
} else if (sale.paymentType === 'CREDIT' && !sale.creditReceived) {

if (sale.isMerged && typeof sale.creditValue === 'number') {
customerStats[name].credit += sale.creditValue;
} else {
const partialPaid = sale.partialPaymentReceived || 0;
customerStats[name].credit += (await getSaleTransactionValue(sale) - partialPaid);
}
} else if (isRepLinked) {
if (sale.paymentType === 'CREDIT' && !sale.creditReceived) {
const partialPaid = sale.partialPaymentReceived || 0;
customerStats[name].credit += (await getSaleTransactionValue(sale) - partialPaid);
} else if (sale.paymentType === 'COLLECTION') {
customerStats[name].credit -= (sale.totalValue || 0);
} else if (sale.paymentType === 'PARTIAL_PAYMENT') {
customerStats[name].credit -= (sale.totalValue || 0);
}
} else {

if (sale.paymentType === 'COLLECTION') {
customerStats[name].credit -= (sale.totalValue || 0);
} else if (sale.paymentType === 'PARTIAL_PAYMENT') {
customerStats[name].credit -= (sale.totalValue || 0);
}
}
if (customerStats[name].credit < 0) customerStats[name].credit = 0;
const saleDate = sale.date;
if (saleDate) {
const timestamp = new Date(saleDate).getTime();
if (!isNaN(timestamp) && timestamp > customerStats[name].lastSaleDate) {
customerStats[name].lastSaleDate = timestamp;
}
}
}
let sortedCustomers = Object.values(customerStats)
.filter(c => c && c.name)
.sort((a, b) => {
if (b.credit !== a.credit) return b.credit - a.credit;
return b.lastSaleDate - a.lastSaleDate;
});
if (Array.isArray(salesCustomers)) {
const statsNames = new Set(sortedCustomers.map(c => c.name.toLowerCase()));
salesCustomers.forEach(sc => {
if (!sc || !sc.name || !sc.name.trim()) return;
const lcName = sc.name.toLowerCase();
if (statsNames.has(lcName)) return;
sortedCustomers.push({ name: sc.name, credit: 0, quantity: 0, lastSaleDate: 0 });
statsNames.add(lcName);
});
}
if (filterValue) {
sortedCustomers = sortedCustomers.filter(c => c && c.name && c.name.toLowerCase().includes(filterValue));
}
let totalOutstanding = 0;
let totalGlobalQty = 0;
sortedCustomers.forEach(c => {
totalOutstanding += c.credit;
totalGlobalQty += c.quantity;
});
const customers = sortedCustomers;
const totalItems = sortedCustomers.length;
if (!customers || !Array.isArray(customers)) {
tbody.innerHTML = `<tr><td class="u-empty-state-danger" colspan="5" >Invalid customer data</td></tr>`;
} else if (customers.length === 0) {
tbody.innerHTML = `<tr><td class="u-empty-state-md" colspan="5" >No customers found</td></tr>`;
} else {
function buildCustomerRow(c) {
if (!c || !c.name) return null;
try {
const displayDate = (c.lastSaleDate && !isNaN(c.lastSaleDate)) ? formatDisplayDate(new Date(c.lastSaleDate)) : '-';
let phone = '-';
try {
const contact = salesCustomers.find(ct => ct && ct.name && c && c.name && ct.name.toLowerCase() === c.name.toLowerCase());
const customerSaleData = customerSales.find(s =>
s && s.customerName && c && c.name &&
s.customerName === c.name &&
s.customerPhone
);
phone = contact?.phone || customerSaleData?.customerPhone || '-';
} catch (phoneError) {
console.warn('Customer data operation failed.', _safeErr(phoneError));
}
const creditStyle = c.credit > 0 ? 'color:var(--warning); font-weight:700;' : 'color:var(--accent-emerald); font-weight:700;';
const row = document.createElement('tr');
row.style.borderBottom = '1px solid var(--glass-border)';
const safeName = esc(c.name || 'Unknown');
const safeNameForAttr = (c.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
row.innerHTML = `
<td class="u-table-td">${displayDate}</td>
<td style="padding: 8px 2px; font-size: 0.8rem; color: var(--accent); font-weight: 600; cursor:pointer;" onclick="event.stopPropagation(); openCustomerManagement('${safeNameForAttr}')">${safeName}</td>
<td class="u-table-td">${phoneActionHTML(phone)}</td>
<td style="padding: 8px 2px; text-align: right; font-size: 0.8rem; ${creditStyle}">${fmtAmt(safeValue(c.credit))}</td>`;
return row;
} catch (rowError) {
console.warn('An unexpected error occurred.', _safeErr(rowError));
return null;
}
}
tbody.innerHTML = '';
const _fragC = document.createDocumentFragment();
customers.forEach((c, i) => { const el = buildCustomerRow(c, i); if (el) _fragC.appendChild(el); });
tbody.appendChild(_fragC);
}
const _setCustH = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
_setCustH('customer-count', `${totalItems || 0} active`);
_setCustH('customers-total-credit', `${fmtAmt(totalOutstanding)}`);
_setCustH('customers-total-quantity', safeNumber(totalGlobalQty, 0).toFixed(2) + ' kg');
}

let currentManagingCustomer = null;
let currentManagingRepCustomer = null;
async function openCustomerManagement(customerName) {
currentManagingCustomer = customerName;
const _setMCT = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
_setMCT('manageCustomerTitle', customerName);
document.getElementById('bulkPaymentAmount').value = '';
if (typeof openStandaloneScreen === 'function') openStandaloneScreen('customer-management-screen');
await renderCustomerTransactions(customerName);
}

function closeCustomerManagement() {
if (typeof closeStandaloneScreen === 'function') closeStandaloneScreen('customer-management-screen');
currentManagingCustomer = null;
setTimeout(async () => {
try {
await sqliteStore.get('customer_sales', []);
await sqliteStore.get('sales_customers', []);
} catch(e) {
showToast('Customer data operation failed.', 'error');
console.warn('closeCustomerManagement SQLite error', _safeErr(e));
}
if (typeof renderCustomersTable === 'function') renderCustomersTable();
}, 100);
}

async function deleteCurrentCustomer() {
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
if (!currentManagingCustomer) return;
const name = currentManagingCustomer;
const txs = customerSales.filter(s =>
s && s.customerName === name
);
const totalDebt = txs
.filter(s => s.paymentType === 'CREDIT' && !s.creditReceived)
.reduce((sum, s) => sum + (s.totalValue || 0) - (s.partialPaymentReceived || 0), 0);
let msg = `Permanently delete customer "${name}"?`;
if (txs.length > 0) {
msg += `\n\n This customer has ${txs.length} transaction record${txs.length !== 1 ? 's' : ''} on file.`;
if (totalDebt > 0) msg += `\n Outstanding debt: ${fmtAmt(totalDebt)}`;
msg += `\n\nAll sales history for this customer will be permanently deleted.`;
}
msg += `\n\nThis cannot be undone.`;
if (!(await showGlassConfirm(msg, { title: 'Delete Customer', confirmText: 'Delete Permanently', danger: true }))) return;
try {
const contactIdx = salesCustomers.findIndex(c => c && c.name && c.name.toLowerCase() === name.toLowerCase());
if (contactIdx !== -1) {
const contactRecord = salesCustomers[contactIdx];
const contactId = contactRecord.id;
const filteredContacts = salesCustomers.filter((_, i) => i !== contactIdx);
await unifiedDelete('sales_customers', filteredContacts, contactId, { strict: true }, contactRecord);
salesCustomers.splice(contactIdx, 1);
}
const txsToDelete = txs.slice();
const idsToDelete = new Set(txsToDelete.map(t => t.id));
let prunedSales = customerSales.filter(s => !idsToDelete.has(s.id));
for (const tx of txsToDelete) {
prunedSales = prunedSales.filter(s => s.id !== tx.id);
await unifiedDelete('customer_sales', prunedSales, tx.id, { strict: true }, tx);
}
notifyDataChange('sales');
triggerAutoSync();
closeCustomerManagement();
showToast(`Customer "${name}" and all records deleted.`, 'success');
} catch (e) {
showToast('Failed to delete customer. Please try again.', 'error');
}
}

async function renderCustomerTransactions(name) {
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const list = document.getElementById('customerManagementHistoryList');
if (!list) return;
let transactions = [];
try {
const dbSales = await sqliteStore.get('customer_sales', []);
if (Array.isArray(dbSales)) {
const recordMap = new Map(dbSales.map(s => [s.id, s]));
if (Array.isArray(customerSales)) {
customerSales.forEach(s => {
if (!recordMap.has(s.id)) {
recordMap.set(s.id, s);
}
});
}
const normalizedSales = Array.from(recordMap.values()).map(s => {
if (s && !s.currentRepProfile && (!s.salesRep || s.salesRep === 'NONE' || s.salesRep === 'ADMIN')) {
return { ...s, currentRepProfile: 'admin' };
}
return s;
});
transactions = normalizedSales.filter(s =>
s && s.currentRepProfile === 'admin' && s.customerName === name
);
} else {
transactions = customerSales.filter(s =>
s && s.currentRepProfile === 'admin' && s.customerName === name
);
}
} catch (error) {
console.error('Customer data operation failed.', _safeErr(error));
showToast('Customer data operation failed.', 'error');
transactions = customerSales.filter(s =>
s && s.currentRepProfile === 'admin' && s.customerName === name
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
const entity = (Array.isArray(salesCustomers) ? salesCustomers : []).find(e => e && e.name && e.name.toLowerCase() === name.toLowerCase());
const phone = entity?.phone || transactions.find(t => t && t.customerPhone)?.customerPhone || '';
const address = entity?.address || '';
const headerTitle = document.getElementById('manageCustomerTitle');
const _custHeaderPhoto = await getPersonPhoto('cust:' + name.toLowerCase());
const _custAvatarHTML = renderPersonAvatarHTML(_custHeaderPhoto, 42);
const _custSafeName = esc(name).split("'").join("\\'");
headerTitle.innerHTML = `
<div style="display:flex;align-items:center;gap:10px;">
${_custAvatarHTML}
<div style="min-width:0;flex:1;">
<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
<span>${esc(name)}</span>
<button class="sidebar-settings-btn" style="width:auto;padding:5px 10px;font-size:0.75rem;color:var(--accent);background:rgba(29,233,182,0.07);border-radius:8px;border:1px solid rgba(29,233,182,0.25);display:inline-flex;align-items:center;gap:5px;" onclick="openCustomerEditModal('${_custSafeName}')" title="Edit Contact Info"><svg width="13" height="13" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="5" width="26" height="7" rx="2.5" fill="var(--accent)" fill-opacity="0.18" stroke="var(--accent)" stroke-width="1.4"/><rect x="5" y="15" width="26" height="7" rx="2.5" fill="var(--accent)" fill-opacity="0.12" stroke="var(--accent)" stroke-width="1.4"/><rect x="5" y="25" width="18" height="7" rx="2.5" fill="var(--accent)" fill-opacity="0.08" stroke="var(--accent)" stroke-width="1.4"/><line x1="27" y1="26" x2="32" y2="21" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round"/><circle cx="26" cy="27" r="1" fill="var(--accent)"/></svg>Edit</button>
</div>
<div style="font-size:0.75rem;color:var(--text-muted);font-weight:normal;margin-top:2px;">
${phone ? phoneActionHTML(phone) : 'No Phone'} ${address ? `|  ${esc(address)}` : ''}
</div>
</div>
</div>
`;
let currentDebt = 0;
for (const t of transactions) {
const _tRepLinked = t.salesRep && t.salesRep !== 'NONE';
if (t.transactionType === 'OLD_DEBT' && !t.creditReceived) {
const partialPaid = t.partialPaymentReceived || 0;
currentDebt += await getSaleTransactionValue(t) - partialPaid;
} else if (_tRepLinked) {
if (t.paymentType === 'CREDIT' && !t.creditReceived) {
const partialPaid = t.partialPaymentReceived || 0;
currentDebt += (await getSaleTransactionValue(t) - partialPaid);
} else if (t.paymentType === 'COLLECTION') {
currentDebt -= (t.totalValue || 0);
} else if (t.paymentType === 'PARTIAL_PAYMENT') {
currentDebt -= (t.totalValue || 0);
}
} else if (t.paymentType === 'CREDIT' && !t.creditReceived) {
if (t.isMerged && typeof t.creditValue === 'number') {
currentDebt += t.creditValue;
} else {
const partialPaid = t.partialPaymentReceived || 0;
currentDebt += (await getSaleTransactionValue(t) - partialPaid);
}
} else if (t.paymentType === 'COLLECTION') {
currentDebt -= (t.totalValue || 0);
} else if (t.paymentType === 'PARTIAL_PAYMENT') {
currentDebt -= (t.totalValue || 0);
}
}
currentDebt = Math.max(0, currentDebt);
const _mcStats = document.getElementById('manageCustomerStats'); if (_mcStats) _mcStats.innerText = `Current Debt: ${await formatCurrency(currentDebt)}`;
transactions.sort((a, b) => b.timestamp - a.timestamp);
if (transactions.length === 0) {
list.replaceChildren(Object.assign(document.createElement('div'), {className:'u-empty-state-sm',textContent:'No history found'}));
return;
}
const _custFrag = document.createDocumentFragment();
for (const t of transactions) {
const isCredit = t.paymentType === 'CREDIT';
const isPartialPayment = t.paymentType === 'PARTIAL_PAYMENT';
const isCollection = t.paymentType === 'COLLECTION';
const item = document.createElement('div');
item.className = `cust-history-item${t.isSettled ? ' is-settled-record' : ''}`;
let statusClass = t.creditReceived ? 'paid' : 'pending';
let btnText = t.creditReceived ? 'PAID' : 'PENDING';
let toggleBtnHtml = '';
const partialPaid = t.partialPaymentReceived || 0;
const _txValue = await getSaleTransactionValue(t);
const effectiveDue = (t.isMerged && typeof t.creditValue === 'number') ? t.creditValue : (_txValue - partialPaid);
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
toggleBtnHtml = `<span class="status-toggle-btn ${statusClass}" style="pointer-events:none;cursor:default;">${btnText}</span>`;
} else if (isPartialPayment) {
toggleBtnHtml = `<span class="status-toggle-btn txn-warning">PARTIAL PAYMENT</span>`;
} else if (isCollection) {
toggleBtnHtml = `<span class="status-toggle-btn txn-collect">COLLECTION</span>`;
} else {
toggleBtnHtml = `<span class="status-toggle-btn txn-cash">CASH SALE</span>`;
}
const deleteBtnHtml = t.isMerged ? '' : `<button class="btn btn-sm btn-danger u-p-4-8" onclick="deleteTransactionFromOverlay('${esc(t.id)}')">⌫</button>`;
const safeId = String(t.id).replace(/'/g, "\\'");
const panelId = `cp-${t.id}`;
const kebabBtn = t.isMerged
  ? `<button class="txn-kebab-btn" title="View pre-close details" onclick="_togglePreclosePanel(this,'${panelId}','${safeId}','customer_sales','sale')">⋮</button>`
  : '';
const panelPlaceholder = t.isMerged ? `<div class="txn-preclose-panel" id="${panelId}"></div>` : '';
let itemContent = '';
if (isPartialPayment || isCollection) {
itemContent = `
<div class="txn-card-row">
  <div class="cust-history-info">
    <div class="u-fs-sm2 u-text-muted">${formatDisplayDateTime(t.date, t.time || null)}${_mergedBadgeHtml(t, {inline:true})}${(typeof _creatorBadgeHtml === 'function') ? _creatorBadgeHtml(t) : ''}</div>
    <div style="font-size:0.75rem;color:var(--accent-emerald);">Payment: ${await formatCurrency(t.totalValue)}</div>
    <div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">${isPartialPayment ? 'Partial Payment' : 'Bulk Payment'}</div>
    ${(t.supplyDate && t.supplyDate !== t.date) ? `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;font-style:italic;">Supply Date: ${formatDisplayDate(t.supplyDate)}</div>` : ''}
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
      <span class="old-debt-badge">OLD DEBT</span>${_mergedBadgeHtml(t, {inline:true})}${(typeof _creatorBadgeHtml === 'function') ? _creatorBadgeHtml(t) : ''}
    </div>
    <div style="font-size:0.75rem;color:var(--warning);">Previous Balance: ${await formatCurrency(t.totalValue)}</div>
    <div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">${esc(t.notes || 'Brought forward from previous records')}</div>
    ${(t.supplyDate && t.supplyDate !== t.date) ? `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;font-style:italic;">Supply Date: ${formatDisplayDate(t.supplyDate)}</div>` : ''}
  </div>
  <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
    ${toggleBtnHtml}${deleteBtnHtml}${kebabBtn}
  </div>
</div>${panelPlaceholder}`;
} else {
const _displayUnitPrice = (t.unitPrice && t.unitPrice > 0)
  ? t.unitPrice
  : await getEffectiveSalePriceForCustomer(t.customerName, t.supplyStore || 'STORE_A');
itemContent = `
<div class="txn-card-row">
  <div class="cust-history-info">
    <div class="u-fs-sm2 u-text-muted">${formatDisplayDateTime(t.date, t.time || null)}${_mergedBadgeHtml(t, {inline:true})}${(typeof _creatorBadgeHtml === 'function') ? _creatorBadgeHtml(t) : ''}</div>
    <div class="u-fs-sm2 u-text-muted">${safeToFixed(t.quantity, 2)} kg @ ${await formatCurrency(_displayUnitPrice)} = ${await formatCurrency(_txValue)}</div>
    ${hasPartialPayment ? `<div style="font-size:0.7rem;color:var(--accent-emerald);margin-top:2px;">Paid: ${await formatCurrency(partialPaid)} | Due: ${await formatCurrency(Math.max(0, _txValue - partialPaid))}</div>` : ''}
    <div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">${getStoreLabel(t.supplyStore)}</div>
    ${(t.supplyDate && t.supplyDate !== t.date) ? `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;font-style:italic;">Supply Date: ${formatDisplayDate(t.supplyDate)}</div>` : ''}
  </div>
  <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
    ${toggleBtnHtml}${deleteBtnHtml}${kebabBtn}
  </div>
</div>${panelPlaceholder}`;
}
item.innerHTML = itemContent;
item.style.flexDirection = 'column';
item.style.alignItems = 'stretch';
_custFrag.appendChild(item);
}
list.replaceChildren(_custFrag);
}

async function toggleSingleTransactionStatus(id) {
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
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
customerSales[idx] = ensureRecordIntegrity(customerSales[idx], true);
await unifiedSave('customer_sales', customerSales, customerSales[idx]);
notifyDataChange('sales');
triggerAutoSync();
renderCustomerTransactions(currentManagingCustomer);
refreshAllCalculations();
}
} catch (e) {
customerSales.length = 0; customerSales.push(...snapshot);
await sqliteStore.set('customer_sales', customerSales).catch(() => {});
showToast('Failed to update transaction status. Please try again.', 'error');
}
}

async function toggleRepTransactionStatus(id) {
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
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
repSales[idx] = ensureRecordIntegrity(repSales[idx], true);
await unifiedSave('rep_sales', repSales, repSales[idx]);
notifyDataChange('rep');
triggerAutoSync();
renderRepCustomerTransactions(currentManagingRepCustomer);
}
} catch (e) {
repSales.length = 0; repSales.push(...snapshot);
await sqliteStore.set('rep_sales', repSales).catch(() => {});
showToast('Failed to update transaction status. Please try again.', 'error');
}
}

async function deleteTransactionFromOverlay(id) {
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
if (!id || !validateUUID(id)) {
showToast('Invalid transaction ID', 'error');
return;
}
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
_txMsg = `Permanently delete an OLD DEBT record for ${_txCust || 'this customer'}.`;
_txMsg += `\nBalance: ${fmtAmt(_txItem.totalValue||0)}`;
if (_txDate) _txMsg += `\nRecorded: ${_txDate}`;
if (_txItem?.notes) _txMsg += `\nNote: ${_txItem.notes}`;
_txMsg += `\n\n\u26a0 Warning: This will remove the carried-forward balance from the customer's history permanently.`;
} else if (_txItem?.paymentType === 'COLLECTION') {
_txTitle = 'Delete Bulk Collection';
_txMsg = `Delete this bulk collection payment from ${_txCust || 'customer'}?`;
if (_txDate) _txMsg += `\nDate: ${_txDate}`;
_txMsg += `\nAmount Collected: ${fmtAmt(_txItem.totalValue||0)}`;
_txMsg += `\n\n\u21a9 This collection will be reversed and the customer's outstanding balance restored.`;
} else if (_txItem?.paymentType === 'PARTIAL_PAYMENT') {
_txTitle = 'Delete Partial Payment';
_txMsg = `Delete this partial payment from ${_txCust || 'customer'}?`;
if (_txDate) _txMsg += `\nDate: ${_txDate}`;
_txMsg += `\nPayment Amount: ${fmtAmt(_txItem.totalValue||0)}`;
_txMsg += `\n\n\u21a9 This will reverse the partial payment and restore the full pending credit balance.`;
} else if (_txItem?.paymentType === 'CREDIT') {
_txTitle = 'Delete Credit Sale';
_txMsg = `Delete this credit sale for ${_txCust || 'customer'}?`;
if (_txDate) _txMsg += `\nDate: ${_txDate}`;
if (_txQty) _txMsg += `\nQty: ${_txQty}${_txAmt}`;
if (_txStore) _txMsg += `\nStore: ${_txStore}`;
if (_partialPaid > 0) _txMsg += `\n\n\u26a0 ${fmtAmt(_partialPaid)} partially collected. Deleting will erase both the sale and partial payment.`;
else if (_txItem?.creditReceived) _txMsg += `\n\n\u26a0 This sale is already marked PAID. Deleting will remove the payment record.`;
else _txMsg += `\n\n\u26a0 This credit sale is UNPAID. Deleting removes the outstanding balance.`;
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
const wasPartialPayment = item.paymentType === 'PARTIAL_PAYMENT';
const paymentAmount = item.totalValue || 0;
if (wasPartialPayment && item.relatedSaleId) {
const rel = customerSales.find(s => s.id === item.relatedSaleId);
if (rel) {
rel.partialPaymentReceived = Math.max(0, (rel.partialPaymentReceived || 0) - paymentAmount);
if (rel.partialPaymentReceived === 0) { rel.creditReceived = false; delete rel.creditReceivedDate; }
rel.updatedAt = getTimestamp();
ensureRecordIntegrity(rel, true);
}
}
const customerSalesFiltered = customerSales.filter(s => s.id !== id);
await unifiedDelete('customer_sales', customerSalesFiltered, id, { strict: true }, item);
refreshAllCalculations();
if (typeof refreshCustomerSales === 'function') await refreshCustomerSales();
renderCustomersTable();
if (currentManagingCustomer) renderCustomerTransactions(currentManagingCustomer);
notifyDataChange('sales');
triggerAutoSync();
showToast(` Transaction deleted successfully.`, 'success');
} catch (e) {
showToast('Failed to delete transaction. Please try again.', 'error');
}
}

async function deleteRepTransactionFromOverlay(id) {
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
if (!id || !validateUUID(id)) {
showToast('Invalid transaction ID', 'error');
return;
}
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
_rMsg += `\n\n\u26a0 Warning: This will remove the carried-forward balance permanently.`;
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
_rMsg += `\n\n\u21a9 This will reverse the partial payment and restore the full pending credit balance.`;
} else if (_rItem?.paymentType === 'CREDIT') {
_rTitle = 'Delete Rep Credit Sale';
_rMsg = `Delete this credit sale for ${_rCust || 'customer'}${_rRep ? ` (Rep: ${_rRep})` : ''}?`;
if (_rDate) _rMsg += `\nDate: ${_rDate}`;
if (_rQty) _rMsg += `\nQty: ${_rQty}${_rAmt}`;
if (_rPartialPaid > 0) _rMsg += `\n\n\u26a0 ${fmtAmt(_rPartialPaid)} partially collected. Deleting will erase both the sale and partial payment.`;
else if (_rItem?.creditReceived) _rMsg += `\n\n\u26a0 This rep sale is already marked PAID. Deleting removes the payment record.`;
else _rMsg += `\n\n\u26a0 This rep credit sale is UNPAID. Deleting removes the outstanding balance.`;
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
const wasPartialPayment = item.paymentType === 'PARTIAL_PAYMENT';
const paymentAmount = item.totalValue || 0;
if (wasPartialPayment && item.relatedSaleId) {
const rel = repSales.find(s => s.id === item.relatedSaleId);
if (rel) {
rel.partialPaymentReceived = Math.max(0, (rel.partialPaymentReceived || 0) - paymentAmount);
if (rel.partialPaymentReceived === 0) { rel.creditReceived = false; delete rel.creditReceivedDate; }
rel.updatedAt = getTimestamp();
ensureRecordIntegrity(rel, true);
}
}
const repSalesFiltered = repSales.filter(s => s.id !== id);
await unifiedDelete('rep_sales', repSalesFiltered, id, { strict: true }, item);
renderRepCustomerTransactions(currentManagingRepCustomer);
renderRepCustomerTable();
notifyDataChange('rep');
triggerAutoSync();
showToast(` Transaction deleted successfully.`, 'success');
} catch (e) {
showToast('Failed to delete transaction. Please try again.', 'error');
}
}

async function processBulkPayment() {
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const amount = parseFloat(document.getElementById('bulkPaymentAmount').value);
if (!amount || amount <= 0) { showToast('Please enter a valid amount', 'warning', 3000); return; }
const snapshot = [...customerSales];
try {
let remaining = amount, updatedCount = 0, partialPaymentMade = false;
const pending = customerSales.filter(s =>
s.customerName === currentManagingCustomer &&
s.paymentType === 'CREDIT' && !s.creditReceived
).sort((a, b) => a.timestamp - b.timestamp);
if (pending.length === 0) { showToast('No pending credit transactions found for this customer.', 'info', 4000); return; }
const nowDate = new Date();
const nowISODate = nowDate.toISOString().split('T')[0];
const nowTime = nowDate.toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit', hour12: true});
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
        if (!sale.isMerged) ensureRecordIntegrity(sale, true);
} else {
if (!sale.isMerged) {
sale.partialPaymentReceived = (sale.partialPaymentReceived || 0) + remaining;
sale.creditReceived = false; sale.updatedAt = nowEpoch;
}
        if (!sale.isMerged) ensureRecordIntegrity(sale, true);
const partialId = generateUUID('sale');
customerSales.push(ensureRecordIntegrity({
id: partialId, timestamp: nowEpoch, createdAt: nowEpoch, updatedAt: nowEpoch,
date: nowISODate, time: nowTime,
customerName: currentManagingCustomer, customerPhone: sale.customerPhone || '', quantity: 0,
supplyStore: sale.supplyStore || 'STORE_A', paymentType: 'PARTIAL_PAYMENT', salesRep: 'NONE',
currentRepProfile: 'admin',
totalCost: 0, totalValue: remaining, profit: 0, creditReceived: true,
relatedSaleId: sale.id, syncedAt: new Date().toISOString()
}, false, false));
partialPaymentMade = true; remaining = 0; updatedCount++; break;
}
}
let collId = null;
if (remaining > 0 && updatedCount > 0) {
const ls = pending[pending.length - 1];
collId = generateUUID('sale');
customerSales.push(ensureRecordIntegrity({
id: collId, timestamp: nowEpoch, createdAt: nowEpoch, updatedAt: nowEpoch,
date: nowISODate, time: nowTime,
customerName: currentManagingCustomer, customerPhone: ls?.customerPhone || '', quantity: 0,
supplyStore: ls?.supplyStore || 'STORE_A', paymentType: 'COLLECTION', salesRep: 'NONE',
currentRepProfile: 'admin',
totalCost: 0, totalValue: remaining, profit: 0, creditReceived: true,
syncedAt: new Date().toISOString()
}, false, false));
}
if (updatedCount > 0 || partialPaymentMade) {
const changedIds = new Set(pending.map(s => s.id));
if (collId) changedIds.add(collId);
await unifiedSave('customer_sales', customerSales, null, Array.from(changedIds));
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
await sqliteStore.set('customer_sales', customerSales).catch(() => {});
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
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
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
const nowTime = nowDate.toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit', hour12: true});
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
        if (!sale.isMerged) ensureRecordIntegrity(sale, true);
} else {
if (!sale.isMerged) {
sale.partialPaymentReceived = (sale.partialPaymentReceived || 0) + remaining;
sale.creditReceived = false; sale.updatedAt = nowEpoch;
}
        if (!sale.isMerged) ensureRecordIntegrity(sale, true);
const partialId = generateUUID('sale');
repSales.push(ensureRecordIntegrity({
id: partialId, timestamp: nowEpoch, createdAt: nowEpoch, updatedAt: nowEpoch,
date: nowISODate, time: nowTime,
customerName: currentManagingRepCustomer, customerPhone: sale.customerPhone || '', quantity: 0,
supplyStore: sale.supplyStore || 'STORE_A', paymentType: 'PARTIAL_PAYMENT', salesRep: currentRepProfile,
totalCost: 0, totalValue: remaining, profit: 0, creditReceived: true,
relatedSaleId: sale.id, syncedAt: new Date().toISOString()
}, false, false));
partialPaymentMade = true; remaining = 0; updatedCount++; break;
}
}
let collId = null;
if (remaining > 0 && updatedCount > 0) {
const ls = pending[pending.length - 1];
collId = generateUUID('sale');
repSales.push(ensureRecordIntegrity({
id: collId, timestamp: nowEpoch, createdAt: nowEpoch, updatedAt: nowEpoch,
date: nowISODate, time: nowTime,
customerName: currentManagingRepCustomer, customerPhone: ls?.customerPhone || '', quantity: 0,
supplyStore: ls?.supplyStore || 'STORE_A', paymentType: 'COLLECTION', salesRep: currentRepProfile,
totalCost: 0, totalValue: remaining, profit: 0, creditReceived: true,
syncedAt: new Date().toISOString()
}, false, false));
}
if (updatedCount > 0 || partialPaymentMade) {
const changedIds = new Set(pending.map(s => s.id));
if (collId) changedIds.add(collId);
await unifiedSave('rep_sales', repSales, null, Array.from(changedIds));
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
await sqliteStore.set('rep_sales', repSales).catch(() => {});
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
success: `<svg width="13" height="13" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="18" cy="18" r="13" fill="var(--success)" fill-opacity="0.18" stroke="var(--success)" stroke-width="1.5"/><polyline points="10,18 15,23 26,12" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
warning: `<svg width="13" height="13" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M27 10 H33 L29 17 H31 L27 24 H33 L29 17 H31 Z" fill="var(--warning)" opacity="0.6" stroke="var(--warning)" stroke-width="1" stroke-linejoin="round"/><rect x="5" y="10" width="18" height="18" rx="2.5" fill="var(--warning)" fill-opacity="0.12" stroke="var(--warning)" stroke-width="1.4"/><line x1="14" y1="15" x2="14" y2="21" stroke="var(--warning)" stroke-width="1.4" stroke-linecap="round"/><circle cx="14" cy="24" r="1" fill="var(--warning)"/></svg>`,
error: `<svg width="13" height="13" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="18" cy="18" r="13" fill="var(--danger)" fill-opacity="0.15" stroke="var(--danger)" stroke-width="1.5"/><line x1="13" y1="13" x2="23" y2="23" stroke="var(--danger)" stroke-width="2" stroke-linecap="round"/><line x1="23" y1="13" x2="13" y2="23" stroke="var(--danger)" stroke-width="2" stroke-linecap="round"/></svg>`,
info: `<svg width="13" height="13" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="18" cy="18" r="13" fill="var(--accent)" fill-opacity="0.15" stroke="var(--accent)" stroke-width="1.5"/><line x1="18" y1="22" x2="18" y2="17" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/><circle cx="18" cy="13" r="1.2" fill="var(--accent)"/></svg>`,
};
const msgStr = String(message);
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

const _gcIcons = {
  delete:   '<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 11 L10 31 A2 2 0 0 0 12 33 H24 A2 2 0 0 0 26 31 L28 11 Z" fill="var(--danger)" fill-opacity="0.12" stroke="var(--danger)" stroke-width="1.5" stroke-linejoin="round"/><line x1="6" y1="11" x2="30" y2="11" stroke="var(--danger)" stroke-width="1.6" stroke-linecap="round"/><path d="M14 8 H22 M14 8 A1 1 0 0 1 15 7 H21 A1 1 0 0 1 22 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity="0.65"/><line x1="14" y1="17" x2="14" y2="27" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity="0.6"/><line x1="22" y1="17" x2="22" y2="27" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity="0.6"/></svg>',
  remove:   '<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="18" cy="18" r="13" fill="var(--danger)" fill-opacity="0.12" stroke="var(--danger)" stroke-width="1.5"/><line x1="13" y1="13" x2="23" y2="23" stroke="var(--danger)" stroke-width="2" stroke-linecap="round"/><line x1="23" y1="13" x2="13" y2="23" stroke="var(--danger)" stroke-width="2" stroke-linecap="round"/></svg>',
  warning:  '<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M27 10 H33 L29 17 H31 L27 24 H33 L29 17 H31 Z" fill="var(--warning)" opacity="0.6" stroke="var(--warning)" stroke-width="1" stroke-linejoin="round"/><rect x="5" y="10" width="18" height="18" rx="2.5" fill="var(--warning)" fill-opacity="0.12" stroke="var(--warning)" stroke-width="1.4"/><line x1="14" y1="15" x2="14" y2="21" stroke="var(--warning)" stroke-width="1.4" stroke-linecap="round"/><circle cx="14" cy="24" r="1" fill="var(--warning)"/></svg>',
  restore:  '<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 8 A10 10 0 0 1 28 18" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" fill="none"/><polyline points="25,6 28,10 24,11" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M26 28 A10 10 0 0 1 8 18" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" fill="none"/><polyline points="11,30 8,26 12,25" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="18" cy="18" r="3" fill="var(--accent)" opacity="0.3" stroke="var(--accent)" stroke-width="1.2"/></svg>',
  backup:   '<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="6" width="24" height="24" rx="4" fill="var(--accent)" fill-opacity="0.10" stroke="var(--accent)" stroke-width="1.6"/><circle cx="17" cy="18" r="6" stroke="var(--accent)" stroke-width="1.4" fill="var(--accent)" fill-opacity="0.15"/><circle cx="17" cy="18" r="2.5" fill="var(--accent)" opacity="0.7"/><line x1="17" y1="12" x2="17" y2="14.5" stroke="var(--accent)" stroke-width="1.4" stroke-linecap="round"/><line x1="17" y1="21.5" x2="17" y2="24" stroke="var(--accent)" stroke-width="1.4" stroke-linecap="round"/><line x1="11" y1="18" x2="13.5" y2="18" stroke="var(--accent)" stroke-width="1.4" stroke-linecap="round"/><line x1="20.5" y1="18" x2="23" y2="18" stroke="var(--accent)" stroke-width="1.4" stroke-linecap="round"/></svg>',
  upload:   '<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="6" width="24" height="24" rx="4" fill="var(--accent)" fill-opacity="0.08" stroke="var(--accent)" stroke-width="1.6"/><line x1="18" y1="24" x2="18" y2="14" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round"/><polyline points="13,18 18,13 23,18" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><line x1="12" y1="27" x2="24" y2="27" stroke="var(--accent)" stroke-width="1.4" stroke-linecap="round" opacity="0.65"/></svg>',
  sync:     '<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 8 A10 10 0 0 1 28 18" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" fill="none"/><polyline points="25,6 28,10 24,11" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M26 28 A10 10 0 0 1 8 18" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" fill="none"/><polyline points="11,30 8,26 12,25" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="18" cy="18" r="3" fill="var(--accent)" opacity="0.3" stroke="var(--accent)" stroke-width="1.2"/></svg>',
  calendar: '<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="8" width="28" height="22" rx="3" fill="var(--accent)" fill-opacity="0.10" stroke="var(--accent)" stroke-width="1.5"/><line x1="4" y1="15" x2="32" y2="15" stroke="var(--accent)" stroke-width="1.4"/><line x1="12" y1="4" x2="12" y2="11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity="0.65"/><line x1="24" y1="4" x2="24" y2="11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity="0.65"/><circle cx="12" cy="22" r="1.5" fill="var(--accent)" opacity="0.8"/><circle cx="18" cy="22" r="1.5" fill="var(--accent)" opacity="0.8"/><circle cx="24" cy="22" r="1.5" fill="var(--accent)" opacity="0.8"/></svg>',
  user:     '<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="18" cy="13" r="6" fill="var(--accent)" fill-opacity="0.18" stroke="var(--accent)" stroke-width="1.5"/><path d="M5 32 C5 25 31 25 31 32" fill="var(--accent)" fill-opacity="0.12" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round"/></svg>',
  device:   '<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="3" width="16" height="30" rx="4" fill="var(--accent)" fill-opacity="0.10" stroke="var(--accent)" stroke-width="1.6"/><line x1="14" y1="7.5" x2="22" y2="7.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity="0.6"/><rect x="13" y="11" width="10" height="14" rx="1.5" fill="var(--accent)" fill-opacity="0.20"/><circle cx="18" cy="29" r="1.5" fill="var(--accent)" opacity="0.8"/></svg>',
  credit:   '<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="10" width="28" height="18" rx="3" fill="var(--accent-gold)" fill-opacity="0.10" stroke="var(--accent-gold)" stroke-width="1.5"/><line x1="4" y1="17" x2="32" y2="17" stroke="var(--accent-gold)" stroke-width="1.4"/><rect x="8" y="21" width="8" height="3" rx="1" fill="var(--accent-gold)" opacity="0.55"/><ellipse cx="28" cy="16" rx="4" ry="1.5" fill="var(--accent-gold)" opacity="0.4" stroke="var(--accent-gold)" stroke-width="1"/></svg>',
  confirm:  '<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="18" cy="18" r="13" fill="var(--success)" fill-opacity="0.15" stroke="var(--success)" stroke-width="1.5"/><polyline points="10,18 15,23 26,12" stroke="var(--success)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
};
function _gcPickIcon(title, confirmText, danger) {
  const t = (title || '').toLowerCase();
  const c = (confirmText || '').toLowerCase();
  if (t.includes('delete') || c.includes('delete')) return _gcIcons.delete;
  if (t.includes('remove')) return _gcIcons.remove;
  if (t.includes('restore') || c.includes('restore')) return _gcIcons.restore;
  if (t.includes('backup') || c.includes('backup') || c.includes('download')) return _gcIcons.backup;
  if (t.includes('upload') || c.includes('upload')) return _gcIcons.upload;
  if (t.includes('sync') || c.includes('sync')) return _gcIcons.sync;
  if (t.includes('year') || t.includes('financial') || t.includes('calendar')) return _gcIcons.calendar;
  if (t.includes('user') || t.includes('account')) return _gcIcons.user;
  if (t.includes('device')) return _gcIcons.device;
  if (t.includes('credit') || t.includes('payment')) return _gcIcons.credit;
  if (danger) return _gcIcons.warning;
  return _gcIcons.confirm;
}

function showGlassConfirm(message, {
title = 'Confirm',
confirmText = 'Confirm',
cancelText = 'Cancel',
danger = false,
icon = null
} = {}) {
return new Promise(resolve => {
const svgIcon = icon !== null ? icon : _gcPickIcon(title, confirmText, danger);
const iconClass = danger ? 'icon-danger' : 'icon-primary';
const backdrop = document.createElement('div');
backdrop.className = 'glass-confirm-backdrop';
backdrop.innerHTML = `
<div class="glass-confirm-box${danger ? ' is-danger' : ''}">
<div class="glass-confirm-icon ${iconClass}">${svgIcon}</div>
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
window._glassConfirmClosing = true;
const box = backdrop.querySelector('.glass-confirm-box');
backdrop.classList.add('closing');
if (box) box.classList.add('closing');
setTimeout(() => { backdrop.remove(); resolve(result); }, 200);
setTimeout(() => { window._glassConfirmClosing = false; }, 400);
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
if (typeof window._onShowGlassConfirmReady === 'function') {
window._onShowGlassConfirmReady();
}

async function filterCustomers() {
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
renderCustomersTable();
}

async function openCustomerEditModal(customerName) {
customerName = customerName || '';
const isAddMode = !customerName;
const titleEl = document.getElementById('cust-edit-screen-title');
const saveBtn = document.getElementById('cust-edit-save-btn');
const nameInput = document.getElementById('edit-cust-name');
const nameHint = document.getElementById('cust-name-hint');
const nameLabel = document.getElementById('cust-name-label');
if (titleEl) titleEl.textContent = isAddMode ? 'Add Customer' : 'Edit Customer';
if (saveBtn) saveBtn.textContent = isAddMode ? 'Add Customer' : 'Update Details';
if (isAddMode) {
nameInput.placeholder = 'Type name to search or add...';
nameInput.oninput = function() {
handleUniversalSearch('edit-cust-name', 'cust-add-search-results', 'customers');
};
if (nameLabel) nameLabel.textContent = 'Customer Name';
if (nameHint) nameHint.textContent = 'Search existing customers or type a new name to add.';
const searchResults = document.getElementById('cust-add-search-results');
if (searchResults) searchResults.classList.add('hidden');
} else {
nameInput.placeholder = 'Customer name';
nameInput.oninput = null;
if (nameLabel) nameLabel.textContent = 'Customer Name';
if (nameHint) nameHint.textContent = 'Editing the name will update all records for this customer';
}
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
nameInput.value = customerName;
nameInput.dataset.originalName = customerName;
if (!customerName) {
document.getElementById('edit-cust-phone').value = '';
document.getElementById('edit-cust-address').value = '';
document.getElementById('edit-cust-old-debit').value = '';
const editPriceInput = document.getElementById('edit-cust-custom-price');
if (editPriceInput) editPriceInput.value = '';
await loadPersonPhotoIntoEditor('cust', '');
if (typeof openStandaloneScreen === 'function') openStandaloneScreen('customer-edit-screen');
return;
}
const contact = salesCustomers.find(c => c && c.name && c.name.toLowerCase() === customerName.toLowerCase());
const saleRecord = customerSales.find(s =>
s && s.customerName === customerName &&
s.customerPhone
);
const existingOldDebtTx = customerSales.find(s =>
s && s.customerName && s.customerName.toLowerCase() === customerName.toLowerCase() &&
s.transactionType === 'OLD_DEBT'
);
const oldDebitValue = existingOldDebtTx ? (existingOldDebtTx.totalValue || 0) : (contact?.oldDebit || 0);
document.getElementById('edit-cust-phone').value = contact?.phone || saleRecord?.customerPhone || '';
document.getElementById('edit-cust-address').value = contact?.address || '';
document.getElementById('edit-cust-old-debit').value = oldDebitValue;
const editPriceInput = document.getElementById('edit-cust-custom-price');
if (editPriceInput) {
editPriceInput.value = (contact?.customSalePrice > 0) ? contact.customSalePrice : '';
}
await loadPersonPhotoIntoEditor('cust', 'cust:' + customerName.toLowerCase());
if (typeof openStandaloneScreen === 'function') openStandaloneScreen('customer-edit-screen');
}

function closeCustomerEditModal() {
if (typeof closeStandaloneScreen === 'function') closeStandaloneScreen('customer-edit-screen');
}

async function saveCustomerDetails() {
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
const nameInput = document.getElementById('edit-cust-name');
const name = nameInput.value.trim();
const originalName = nameInput.dataset.originalName || name;
const phone = document.getElementById('edit-cust-phone').value.trim();
const address = document.getElementById('edit-cust-address').value.trim();
const oldDebit = parseFloat(document.getElementById('edit-cust-old-debit').value) || 0;
const customSalePrice = parseFloat(document.getElementById('edit-cust-custom-price').value) || 0;
if (!name) { showToast('Customer name is required', 'error'); return; }
if (oldDebit < 0) { showToast('Old debt balance cannot be negative. Enter 0 to clear the balance.', 'warning', 4000); return; }
if (customSalePrice < 0) { showToast('Custom sale price cannot be negative.', 'warning', 4000); return; }
try {
const nameChanged = name.toLowerCase() !== originalName.toLowerCase();
const freshContacts = await sqliteStore.get('sales_customers', []);
if (Array.isArray(freshContacts)) {
const m = new Map(freshContacts.map(c => [c.id, c]));
if (Array.isArray(salesCustomers)) salesCustomers.forEach(c => { if (!m.has(c.id)) m.set(c.id, c); });
const refreshedSC = Array.from(m.values());
await sqliteStore.set('sales_customers', refreshedSC);
}
let contact = salesCustomers.find(c => c && c.name && c.name.toLowerCase() === originalName.toLowerCase());
if (!contact) contact = salesCustomers.find(c => c && c.name && c.name.toLowerCase() === name.toLowerCase());
const previousOldDebit = contact?.oldDebit || 0;
if (contact) {
if (!validateUUID(String(contact.id || ''))) { contact.id = generateUUID('cust'); }
contact.name = name; contact.phone = phone; contact.address = address; contact.oldDebit = oldDebit; contact.customSalePrice = customSalePrice; contact.updatedAt = getTimestamp();
ensureRecordIntegrity(contact, true);
} else {
contact = { id: generateUUID('cust'), name, phone, address, oldDebit, customSalePrice,
createdAt: getTimestamp(), updatedAt: getTimestamp(), timestamp: getTimestamp() };
salesCustomers.push(contact);
}
await unifiedSave('sales_customers', salesCustomers, contact);
notifyDataChange('sales');
let salesArray = await sqliteStore.get('customer_sales', []);
if (!Array.isArray(salesArray)) salesArray = [];
if (Array.isArray(customerSales) && customerSales.length > 0) {
const mSales = new Map(salesArray.map(s => [s.id, s]));
customerSales.forEach(s => { if (s && s.id && !mSales.has(s.id)) mSales.set(s.id, s); });
salesArray = Array.from(mSales.values());
}
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
s.transactionType === 'OLD_DEBT'
);
let oldDebtModified = false, oldDebtRecord = null, deletedOldDebtId = null;
if (oldDebit > 0) {
if (oldDebtIdx !== -1) {
const tx = salesArray[oldDebtIdx];
if (!validateUUID(String(tx.id || ''))) { tx.id = generateUUID('old_debt'); }
const amountChanged = tx.totalValue !== oldDebit;
tx.totalValue = oldDebit; tx.customerPhone = phone; tx.timestamp = getTimestamp();
tx.updatedAt = getTimestamp();
tx.currentRepProfile = 'admin';
if (amountChanged) { tx.creditReceived = false; tx.partialPaymentReceived = 0; }
if (!tx.time) tx.time = new Date().toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit', hour12: true});
ensureRecordIntegrity(tx, true);
oldDebtModified = true; oldDebtRecord = tx;
} else {
const tx = { id: generateUUID('old_debt'), date: new Date().toISOString().split('T')[0],
customerName: name, customerPhone: phone, salesRep: 'ADMIN', quantity: 0,
supplyStore: 'N/A', paymentType: 'CREDIT', transactionType: 'OLD_DEBT',
currentRepProfile: 'admin',
totalValue: oldDebit, creditReceived: false, partialPaymentReceived: 0,
time: new Date().toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit', hour12: true}),
timestamp: getTimestamp(), createdAt: getTimestamp(), updatedAt: getTimestamp(),
notes: 'Previous balance brought forward' };
salesArray.push(tx); oldDebtModified = true; oldDebtRecord = tx;
}
} else if (oldDebit === 0 && oldDebtIdx !== -1) {
const _oldDebtRecordForDeletion = salesArray[oldDebtIdx];
deletedOldDebtId = _oldDebtRecordForDeletion.id;
salesArray.splice(oldDebtIdx, 1); oldDebtModified = true;
if (deletedOldDebtId) { window._oldDebtRecordForDeletion = _oldDebtRecordForDeletion; }
}
let phoneUpdated = false;
salesArray.forEach(s => { if (s && s.customerName === name && s.customerPhone !== phone) { s.customerPhone = phone; phoneUpdated = true; } });
customerSales.length = 0; customerSales.push(...salesArray);
if (nameChanged || oldDebtModified || phoneUpdated) {
if (deletedOldDebtId) {
const _deletedRecord = window._oldDebtRecordForDeletion || null;
window._oldDebtRecordForDeletion = null;
await unifiedDelete('customer_sales', salesArray, deletedOldDebtId, { strict: true }, _deletedRecord);
} else {
await unifiedSave('customer_sales', salesArray, oldDebtModified && !phoneUpdated && !nameChanged ? oldDebtRecord : null);
}
if (nameChanged && renamedRecords.length > 0) {
await unifiedSave('customer_sales', salesArray, null, renamedRecords.map(r => r.id));
}
}
const message = nameChanged ? `Customer renamed to "${name}" and details updated`
: oldDebit > 0 ? `Customer updated with old debt of ₨${oldDebit.toLocaleString()}`
: (oldDebit === 0 && previousOldDebit > 0) ? 'Customer updated and old debt cleared'
: 'Customer details updated successfully';
if (nameChanged) {
const _oldPhoto = await getPersonPhoto('cust:' + originalName.toLowerCase());
if (_oldPhoto) {
const _photos = await sqliteStore.get('person_photos') || {};
_photos['cust:' + name.toLowerCase()] = _oldPhoto;
delete _photos['cust:' + originalName.toLowerCase()];
await sqliteStore.set('person_photos', _photos);
const _dk = (await sqliteStore.get('person_photos_dirty_keys')) || [];
const _newKey = 'cust:' + name.toLowerCase();
const _oldKey = 'cust:' + originalName.toLowerCase();
if (!_dk.includes(_newKey)) _dk.push(_newKey);
if (!_dk.includes(_oldKey)) _dk.push(_oldKey);
await sqliteStore.set('person_photos_dirty_keys', _dk);
await sqliteStore.set('person_photos_timestamp', Date.now());
const _preview = document.getElementById('cust-photo-preview');
if (_preview) _preview.dataset.pendingPhoto = undefined;
} else {
await savePersonPhoto('cust', 'cust:' + name.toLowerCase());
}
} else {
await savePersonPhoto('cust', 'cust:' + name.toLowerCase());
}
showToast(message, 'success');
closeCustomerEditModal();
await new Promise(r => setTimeout(r, 350));
if (nameChanged && currentManagingCustomer && currentManagingCustomer.toLowerCase() === originalName.toLowerCase()) {
currentManagingCustomer = name;
}
const overlay = document.getElementById('customer-management-screen');
if (overlay && overlay.style.display !== 'none') await renderCustomerTransactions(currentManagingCustomer || name);
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
statusDiv.textContent = ` Location Found: ${localArea || placeName || city}`;
statusDiv.style.color = "var(--accent-emerald)";
if(typeof showToast === 'function') showToast("Address updated successfully", "success");
} else {
throw new Error("Address not found");
}
} catch (error) {
console.error('An unexpected error occurred.', _safeErr(error));
showToast('Address lookup failed: ' + (_safeErr(error).message || 'GPS coordinates saved instead'), 'error');
addressInput.value = `GPS: ${coordsText}`;
statusDiv.textContent = "Address lookup failed. Saved GPS Coordinates.";
statusDiv.style.color = "var(--warning)";
} finally {
if(btn) btn.disabled = false;
resolve();
}
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
let msg = "Location error.";
switch(error.code) {
case error.PERMISSION_DENIED: msg = " Permission denied. Check Phone Settings."; break;
case error.POSITION_UNAVAILABLE: msg = " Weak GPS signal. Go outside."; break;
case error.TIMEOUT: msg = " GPS timeout. Try again."; break;
}
statusDiv.textContent = msg;
statusDiv.style.color = "var(--danger)";
if(btn) btn.disabled = false;
resolve();
},
gpsOptions
);
setTimeout(() => { if (!settled && best) finish(best); }, GPS_MAX_WAIT_MS);
});
}
