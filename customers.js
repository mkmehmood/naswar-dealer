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
showToast('UI refresh failed.', 'error');
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
const directSalesNames = new Set(
(Array.isArray(customerSales) ? customerSales : [])
.filter(s => s.customerName && s.currentRepProfile === 'admin')
.map(s => s.customerName.toLowerCase())
);
salesCustomers.forEach(sc => {
if (!sc || !sc.name || !sc.name.trim()) return;
const lcName = sc.name.toLowerCase();
if (statsNames.has(lcName)) return;
if (!directSalesNames.has(lcName)) return;
sortedCustomers.push({ name: sc.name, credit: 0, quantity: 0, lastSaleDate: 0 });
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
GNDVirtualScroll.mount('vs-scroller-customers', customers, buildCustomerRow, tbody);
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
async function closeCustomerManagement() {
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
msg += `\n\n⚠ This customer has ${txs.length} transaction record${txs.length !== 1 ? 's' : ''} on file.`;
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
await registerDeletion(contactId, 'sales_customers', contactRecord);
salesCustomers.splice(contactIdx, 1);
await saveWithTracking('sales_customers', salesCustomers);
deleteRecordFromFirestore('sales_customers', contactId).catch(() => {});
}
const txsToDelete = txs.slice();
const idsToDelete = new Set(txsToDelete.map(t => t.id));
let prunedSales = customerSales.filter(s => !idsToDelete.has(s.id));
for (const tx of txsToDelete) {
prunedSales = prunedSales.filter(s => s.id !== tx.id);
await unifiedDelete('customer_sales', prunedSales, tx.id, { strict: true }, tx);
}
void Promise.all([...idsToDelete].map(id => deleteRecordFromFirestore('customer_sales', id).catch(() => {})));
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
headerTitle.innerHTML = `
<div style="display:flex; align-items:center; gap:8px;">
<span>${esc(name)}</span>
<button class="sidebar-settings-btn" style="width:auto;padding:5px 10px;font-size:0.75rem;color:var(--accent);background:rgba(29,233,182,0.07);border-radius:8px;border:1px solid rgba(29,233,182,0.25);display:inline-flex;align-items:center;gap:5px;" onclick="openCustomerEditModal('${esc(name).split("'").join("\\'")}')" title="Edit Contact Info"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit</button>
</div>
<div style="font-size: 0.75rem; color: var(--text-muted); font-weight: normal; margin-top:4px;">
${phone ? phoneActionHTML(phone) : 'No Phone'} ${address ? `| ◆ ${esc(address)}` : ''}
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
<div class="u-mono-bold" >${formatDisplayDate(t.date)}${_mergedBadgeHtml(t, {inline:true})}${(typeof _creatorBadgeHtml === 'function') ? _creatorBadgeHtml(t) : ''}</div>
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
<span style="background:rgba(255, 159, 10, 0.15); color:var(--warning); padding:2px 6px; border-radius:4px; font-size:0.65rem; margin-left:6px; font-weight:600;">OLD DEBT</span>${_mergedBadgeHtml(t, {inline:true})}${(typeof _creatorBadgeHtml === 'function') ? _creatorBadgeHtml(t) : ''}
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
const _displayUnitPrice = (t.unitPrice && t.unitPrice > 0)
  ? t.unitPrice
  : getEffectiveSalePriceForCustomer(t.customerName, t.supplyStore || 'STORE_A');
itemContent = `
<div class="cust-history-info">
<div class="u-mono-bold" >${formatDisplayDate(t.date)}${_mergedBadgeHtml(t, {inline:true})}${(typeof _creatorBadgeHtml === 'function') ? _creatorBadgeHtml(t) : ''}</div>
<div class="u-fs-sm2 u-text-muted" >
${safeToFixed(t.quantity, 2)} kg @ ${await formatCurrency(_displayUnitPrice)} = ${await formatCurrency(_txValue)}
</div>
${hasPartialPayment ? `<div style="font-size:0.7rem; color:var(--accent-emerald); margin-top:2px;">Paid: ${await formatCurrency(partialPaid)} | Due: ${await formatCurrency(Math.max(0, _txValue - partialPaid))}</div>` : ''}
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
await saveWithTracking('customer_sales', customerSales, null, Array.from(changedIds));
void Promise.all(
  customerSales
    .filter(sale => changedIds.has(sale.id) || sale.paymentType === 'PARTIAL_PAYMENT' || sale.paymentType === 'COLLECTION')
    .map(sale => saveRecordToFirestore('customer_sales', sale).catch(() => {}))
).catch(() => {});
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
await saveWithTracking('rep_sales', repSales, null, Array.from(changedIds));
void Promise.all(
  repSales
    .filter(sale => changedIds.has(sale.id) || sale.paymentType === 'PARTIAL_PAYMENT' || sale.paymentType === 'COLLECTION')
    .map(sale => saveRecordToFirestore('rep_sales', sale).catch(() => {}))
).catch(() => {});
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
success: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
warning: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
error: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
info: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
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
/* SVG icon library — sidebar-style (24×24, stroke, no fill) */
const _gcIcons = {
  delete:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>',
  remove:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  warning:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  restore:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>',
  backup:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  upload:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>',
  sync:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  user:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  device:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12" y2="18"/></svg>',
  credit:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
  confirm:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
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
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
const nameInput = document.getElementById('edit-cust-name');
nameInput.value = customerName;
nameInput.dataset.originalName = customerName;
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
await saveWithTracking('sales_customers', salesCustomers, contact);
saveRecordToFirestore('sales_customers', contact).catch(() => {});
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
if (!tx.time) tx.time = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
ensureRecordIntegrity(tx, true);
oldDebtModified = true; oldDebtRecord = tx;
} else {
const tx = { id: generateUUID('old_debt'), date: new Date().toISOString().split('T')[0],
customerName: name, customerPhone: phone, salesRep: 'ADMIN', quantity: 0,
supplyStore: 'N/A', paymentType: 'CREDIT', transactionType: 'OLD_DEBT',
currentRepProfile: 'admin',
totalValue: oldDebit, creditReceived: false, partialPaymentReceived: 0,
time: new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
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
await saveWithTracking('customer_sales', salesArray, oldDebtModified && !phoneUpdated && !nameChanged ? oldDebtRecord : null);
if (oldDebtRecord) saveRecordToFirestore('customer_sales', oldDebtRecord).catch(() => {});
if (deletedOldDebtId) {
await registerDeletion(deletedOldDebtId, 'sales', window._oldDebtRecordForDeletion || null);
window._oldDebtRecordForDeletion = null;
deleteRecordFromFirestore('customer_sales', deletedOldDebtId).catch(() => {});
}
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
console.error('An unexpected error occurred.', _safeErr(error));
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
