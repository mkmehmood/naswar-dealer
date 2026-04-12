
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
if (typeof calculateNetCash === 'function') calculateNetCash();
}

async function calculateCashTracker() {
const salesHistory = ensureArray(await sqliteStore.get('noman_history'));
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
const paymentDateEl = document.getElementById('expenseDate');
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
totalSoldValue: 0,
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
const _ctSaleVal = sale.totalValue || 0;
if (sale.isMerged && sale.mergedSummary) {
const ms = sale.mergedSummary;
rawData.salesCash    += (ms.cashSales    || 0);
rawData.salesCredits += (ms.unpaidCredit || 0);
rawData.totalSoldValue += (ms.cashSales || 0) + (ms.unpaidCredit || 0);
} else if (sale.paymentType === 'CREDIT' && !sale.creditReceived) {
const partialPaid = sale.partialPaymentReceived || 0;
rawData.salesCredits += Math.max(0, _ctSaleVal - partialPaid);
rawData.totalSoldValue += _ctSaleVal;
} else if (isRepLinked) {
rawData.totalSoldValue += _ctSaleVal;
if (!sale.creditReceived) {
rawData.salesCredits += _ctSaleVal;
}
} else {
if (sale.paymentType === 'CASH' || sale.creditReceived) {
rawData.salesCash += _ctSaleVal;
rawData.totalSoldValue += _ctSaleVal;
} else if (sale.paymentType === 'COLLECTION') {
rawData.salesCash += _ctSaleVal;
rawData.salesCredits -= _ctSaleVal;
} else if (sale.paymentType === 'PARTIAL_PAYMENT') {
rawData.salesCash += _ctSaleVal;
rawData.salesCredits -= _ctSaleVal;
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
if (transaction.isPayable && transaction.type === 'IN') return;
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
const factoryProductionHistoryCT = ensureArray(await sqliteStore.get('factory_production_history'));
factoryProductionHistoryCT.forEach(entry => {
if (entry.isMerged) return;
const entryDate = new Date(entry.date);
if (entryDate >= startDate && entryDate <= endDate) {
rawData.expenses += (parseFloat(entry.additionalCost) || 0);
}
});
const netSalesCash = rawData.salesCash;
const netSalesCredits = rawData.salesCredits;
const netCalculatorDebt = rawData.calculatorCredits - rawData.calculatorRecovered;
const finalTotals = {
productionValue: rawData.totalProductionValue,
productionQuantity: rawData.totalProductionQuantity,
salesTabCash: netSalesCash,
salesTabCredits: netSalesCredits,
totalSoldValue: rawData.totalSoldValue,
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
if (elCashProdValue) elCashProdValue.textContent = `${fmtAmt(safeValue(finalTotals.productionValue))}`;
const elCashSalesCash = document.getElementById('cash-sales-cash');
if (elCashSalesCash) elCashSalesCash.textContent = `${fmtAmt(safeValue(finalTotals.salesTabCash))}`;
const elCashCalcCash = document.getElementById('cash-calculator-cash');
if (elCashCalcCash) elCashCalcCash.textContent = `${fmtAmt(safeValue(finalTotals.calculatorCash))}`;
const elCashPayIn = document.getElementById('cash-payments-in');
if (elCashPayIn) elCashPayIn.textContent = `${fmtAmt(safeValue(finalTotals.paymentsIn))}`;
const elCashPayOut = document.getElementById('cash-payments-out');
if (elCashPayOut) elCashPayOut.textContent = `${fmtAmt(safeValue(finalTotals.paymentsOut))}`;
const elCashExpenses = document.getElementById('cash-expenses');
if (elCashExpenses) elCashExpenses.textContent = `${fmtAmt(safeValue(finalTotals.expenses))}`;
const elCashNet = document.getElementById('cash-net-total');
if (elCashNet) {
elCashNet.textContent = `${fmtAmt(safeValue(netCash))}`;
if (netCash < 0) {
elCashNet.style.color = 'var(--danger)';
} else {
elCashNet.style.color = 'var(--accent-emerald)';
}
}
const elCreditSales = document.getElementById('credit-sales-tab');
if (elCreditSales) elCreditSales.textContent = `${fmtAmt(safeValue(finalTotals.salesTabCredits))}`;
const elCreditCalc = document.getElementById('credit-calculator');
if (elCreditCalc) elCreditCalc.textContent = `${fmtAmt(safeValue(finalTotals.calculatorCredits))}`;
const elCreditTotal = document.getElementById('credit-total');
if (elCreditTotal) elCreditTotal.textContent = `${fmtAmt(safeValue(totalCredits))}`;
return finalTotals;
}

function updateEconomicDashboardWithNetValues(totals, totalCredits) {
const operatingCashFlow = totals.productionValue - totals.totalSoldValue + totals.salesTabCash + totals.calculatorCash;
const operatingCashElement = document.getElementById('operatingCashFlow');
if (operatingCashElement) {
operatingCashElement.textContent = `${fmtAmt(safeValue(operatingCashFlow))}`;
}
{ const _el_cashDetailDirectSales = document.getElementById('cashDetailDirectSales'); if (_el_cashDetailDirectSales) _el_cashDetailDirectSales.textContent = `${fmtAmt(safeValue(totals.salesTabCash))}`; }
{ const _el_cashDetailRepCollections = document.getElementById('cashDetailRepCollections'); if (_el_cashDetailRepCollections) _el_cashDetailRepCollections.textContent = `${fmtAmt(safeValue(totals.calculatorCash))}`; }
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

async function openEntityTransactions(entityId) {
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
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
<span class="u-fs-sm2 u-text-muted">${transaction.date ? formatDisplayDateTime(transaction.date, transaction.time || null) : 'N/A'}</span>
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
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
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
if (type === 'OUT') {
const _spAvailCash = await getAvailableCashInHand();
if (_spAvailCash < amount) {
showToast(`Insufficient cash in hand. Available: ${fmtAmt(Math.max(0, _spAvailCash))} — Required: ${fmtAmt(amount)}`, 'error', 5000);
return;
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
let isPayable = false;
let materialId = null;
try {
if (type === 'OUT') {
const isPendingMat = (m) => (m.paymentStatus === 'pending' || !m.paymentStatus) && parseFloat(m.totalPayable || 0) > 0;
const linkedMaterials = factoryInventoryData
.filter(m => String(m.supplierId) === String(entityId) && isPendingMat(m))
.sort((a, b) => new Date(a.purchaseDate || a.createdAt || 0) - new Date(b.purchaseDate || b.createdAt || 0));
const unlinkedMaterials = entity.isSupplier
? factoryInventoryData
.filter(m => !m.supplierId && isPendingMat(m))
.sort((a, b) => new Date(a.purchaseDate || a.createdAt || 0) - new Date(b.purchaseDate || b.createdAt || 0))
: [];
const pendingMaterials = [...linkedMaterials, ...unlinkedMaterials];
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
emitSyncUpdate({ payment_transactions: null});
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
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
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
if (_dpTx?.isPayable && _dpTx.type === 'OUT') {
_dpMsg += `\n\n\u21a9 Supplier payable status will be restored — material will revert to pending payment.`;
}
if (_dpTx?.isPayable && _dpTx.type === 'IN') {
_dpMsg += `\n\n\u21a9 Credit purchase record removed — supplier will be unlinked from material.`;
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
await _restorePayableFromDeletedTransaction(transaction, paymentTransactions, factoryInventoryData);
const _ptFiltered2 = paymentTransactions.filter(t => t.id !== id);
await unifiedDelete('payment_transactions', _ptFiltered2, id, { strict: true }, transaction);
if (transaction.expenseId) {
try {
const _dpPhKey = 'expense:' + transaction.expenseId;
const _dpPh = (await sqliteStore.get('person_photos')) || {};
if (_dpPh[_dpPhKey] !== undefined) {
delete _dpPh[_dpPhKey];
await sqliteStore.set('person_photos', _dpPh);
const _dpPhTs = (await sqliteStore.get('person_photos_timestamps')) || {};
delete _dpPhTs[_dpPhKey];
await sqliteStore.set('person_photos_timestamps', _dpPhTs);
const _dpDk = (await sqliteStore.get('person_photos_dirty_keys')) || [];
if (!_dpDk.includes(_dpPhKey)) _dpDk.push(_dpPhKey);
await sqliteStore.set('person_photos_dirty_keys', _dpDk);
if (typeof triggerAutoSync === 'function') { try { triggerAutoSync(); } catch(_) {} }
}
} catch(_dpPhErr) { console.warn('[deletePaymentTransaction] photo cleanup failed', _dpPhErr); }
}
notifyDataChange('payments');
if (typeof refreshPaymentTab === 'function') await refreshPaymentTab();
if (typeof calculateNetCash === 'function') calculateNetCash();
if (typeof calculateCashTracker === 'function') calculateCashTracker();
if (typeof renderFactoryInventory === 'function') renderFactoryInventory();
if (typeof renderUnifiedTable === 'function') renderUnifiedTable(1);
showToast(" Transaction deleted and all balances restored!", "success");
} catch (error) {
showToast(" Failed to delete transaction. Please try again.", "error");
}
}
}

async function filterPaymentHistory() {
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
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

async function getAvailableCashInHand() {

const _gacBatch = await sqliteStore.getBatch([
'noman_history','mfg_pro_pkr','customer_sales','payment_transactions','expenses',
'factory_production_history'
]);
const _gacSalesHistory = ensureArray(_gacBatch.get('noman_history'));
const _gacDb = ensureArray(_gacBatch.get('mfg_pro_pkr'));
const _gacCustomerSales = ensureArray(_gacBatch.get('customer_sales'));
const _gacPayTx = ensureArray(_gacBatch.get('payment_transactions'));
const _gacExpenses = ensureArray(_gacBatch.get('expenses'));
const _gacProdHistory = ensureArray(_gacBatch.get('factory_production_history'));
let _gacProdVal = 0;
_gacDb.forEach(item => {
if (item.isReturn) return;
_gacProdVal += (item.totalSale || 0);
});
let _gacSalesCash = 0;
_gacCustomerSales.forEach(sale => {
const isRepLinked = sale.salesRep && sale.salesRep !== 'NONE';
const _saleVal = sale.totalValue || 0;
if (sale.isMerged && sale.mergedSummary) {
_gacSalesCash += (sale.mergedSummary.cashSales || 0);
} else if (sale.paymentType === 'CREDIT' && !sale.creditReceived) {

} else if (isRepLinked) {

} else {
if (sale.paymentType === 'CASH' || sale.creditReceived) _gacSalesCash += _saleVal;
else if (sale.paymentType === 'COLLECTION') _gacSalesCash += _saleVal;
else if (sale.paymentType === 'PARTIAL_PAYMENT') _gacSalesCash += _saleVal;
}
});
let _gacCalcCash = 0;
_gacSalesHistory.forEach(item => { _gacCalcCash += (item.received || 0); });
let _gacPayIn = 0, _gacPayOut = 0, _gacExp = 0;
_gacPayTx.forEach(tx => {
if (tx.isPayable && tx.type === 'IN') return;
if (tx.type === 'IN') {
_gacPayIn += (parseFloat(tx.amount) || 0);
} else if (tx.type === 'OUT') {
if (tx.isExpense && tx.category === 'operating') {
_gacExp += (parseFloat(tx.amount) || 0);
} else if (!tx.isExpense) {
_gacPayOut += (parseFloat(tx.amount) || 0);
}
}
});

_gacExpenses.forEach(exp => {
if (exp.isMerged === true && exp.category === 'operating') _gacExp += (parseFloat(exp.amount) || 0);
});
_gacProdHistory.forEach(entry => {
if (!entry.isMerged) _gacExp += (parseFloat(entry.additionalCost) || 0);
});
return _gacProdVal + _gacSalesCash + _gacCalcCash + _gacPayIn - _gacPayOut - _gacExp;
}

async function calculateNetCash() {
const _cncBatch = await sqliteStore.getBatch([
'noman_history','factory_unit_tracking','payment_transactions','payment_entities',
'expenses','mfg_pro_pkr','customer_sales','stock_returns',
'factory_inventory_data','factory_production_history',
'factory_default_formulas','factory_additional_costs',
]);
const salesHistory = ensureArray(_cncBatch.get('noman_history'));
const factoryUnitTracking = _cncBatch.get('factory_unit_tracking') || {};
const paymentTransactions = ensureArray(_cncBatch.get('payment_transactions'));
const paymentEntities = ensureArray(_cncBatch.get('payment_entities'));
const expenseRecords = ensureArray(_cncBatch.get('expenses'));
const db = ensureArray(_cncBatch.get('mfg_pro_pkr'));
const customerSales = ensureArray(_cncBatch.get('customer_sales'));
const stockReturns = ensureArray(_cncBatch.get('stock_returns'));
const factoryInventoryData = ensureArray(_cncBatch.get('factory_inventory_data'));
const factoryProductionHistory = ensureArray(_cncBatch.get('factory_production_history'));
const factoryDefaultFormulas = _cncBatch.get('factory_default_formulas') || {};
const factoryAdditionalCosts = _cncBatch.get('factory_additional_costs') || {};
const paymentDateEl = document.getElementById('expenseDate');
const selectedDate = (paymentDateEl && paymentDateEl.value) || new Date().toISOString().split('T')[0];
const selectedDateObj = new Date(selectedDate);
const selectedYear = selectedDateObj.getFullYear();
const selectedMonth = selectedDateObj.getMonth();
let cncStartDate = new Date('2000-01-01');
let cncEndDate = new Date('2100-12-31');
const _cncMode = typeof currentCashTrackerMode !== 'undefined' ? currentCashTrackerMode : 'all';
if (_cncMode === 'day') {
cncStartDate = new Date(selectedDate);
cncStartDate.setHours(0,0,0,0);
cncEndDate = new Date(selectedDate);
cncEndDate.setHours(23,59,59,999);
} else if (_cncMode === 'week') {
cncStartDate = new Date(selectedDate);
cncStartDate.setDate(selectedDateObj.getDate() - 6);
cncStartDate.setHours(0,0,0,0);
cncEndDate = new Date(selectedDate);
cncEndDate.setHours(23,59,59,999);
} else if (_cncMode === 'month') {
cncStartDate = new Date(selectedYear, selectedMonth, 1);
cncEndDate = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59);
} else if (_cncMode === 'year') {
cncStartDate = new Date(selectedYear, 0, 1);
cncEndDate = new Date(selectedYear, 11, 31, 23, 59, 59);
}
const _cncInRange = (dateStr) => {
if (_cncMode === 'all') return true;
if (!dateStr) return false;
const d = new Date(dateStr);
return d >= cncStartDate && d <= cncEndDate;
};
try {
let rawData = {
totalProductionValue: 0,
totalProductionQuantity: 0,
salesCash: 0,
salesCredits: 0,
totalSoldValue: 0,
calculatorCash: 0,
calculatorTotalIssued: 0,
calculatorTotalRecovered: 0,
paymentsIn: 0,
paymentsOut: 0
};
db.forEach(item => {
if (item.isReturn) return;
if (!_cncInRange(item.date)) return;
rawData.totalProductionValue += item.totalSale || 0;
rawData.totalProductionQuantity += item.net || 0;
});
customerSales.forEach(sale => {
if (!_cncInRange(sale.date)) return;
const isRepLinked = sale.salesRep && sale.salesRep !== 'NONE';
const _saleVal = sale.totalValue || 0;
if (sale.isMerged && sale.mergedSummary) {
const ms = sale.mergedSummary;
rawData.salesCash    += (ms.cashSales    || 0);
rawData.salesCredits += (ms.unpaidCredit || 0);
rawData.totalSoldValue += (ms.cashSales || 0) + (ms.unpaidCredit || 0);
} else if (sale.paymentType === 'CREDIT' && !sale.creditReceived) {
const partialPaid = sale.partialPaymentReceived || 0;
rawData.salesCredits += Math.max(0, _saleVal - partialPaid);
rawData.totalSoldValue += _saleVal;
} else if (isRepLinked) {
rawData.totalSoldValue += _saleVal;
if (!sale.creditReceived) {
rawData.salesCredits += _saleVal;
}
} else {
if (sale.paymentType === 'CASH' || sale.creditReceived) {
rawData.salesCash += _saleVal;
rawData.totalSoldValue += _saleVal;
} else if (sale.paymentType === 'COLLECTION') {
rawData.salesCash += _saleVal;
rawData.salesCredits -= _saleVal;
} else if (sale.paymentType === 'PARTIAL_PAYMENT') {
rawData.salesCash += _saleVal;
rawData.salesCredits -= _saleVal;
}
}
});
salesHistory.forEach(item => {
if (!_cncInRange(item.date)) return;
rawData.calculatorCash += item.received || 0;
rawData.calculatorTotalIssued += item.creditValue || 0;
rawData.calculatorTotalRecovered += item.prevColl || 0;
});
let totalExpenses = 0;
paymentTransactions.forEach(trans => {
if (!_cncInRange(trans.date)) return;
if (trans.isPayable && trans.type === 'IN') return;
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
if (!_cncInRange(exp.date)) return;
totalExpenses += (parseFloat(exp.amount) || 0);
}
});
}
if (Array.isArray(factoryProductionHistory)) {
factoryProductionHistory.forEach(entry => {
if (entry.isMerged) return;
if (!_cncInRange(entry.date)) return;
totalExpenses += (parseFloat(entry.additionalCost) || 0);
});
}
const netSalesCash = rawData.salesCash;
const netSalesCredits = rawData.salesCredits;
const combinedMarketDebt = rawData.calculatorTotalIssued - rawData.calculatorTotalRecovered;
const cashInHand = rawData.totalProductionValue +
netSalesCash + rawData.calculatorCash +
rawData.paymentsIn - rawData.paymentsOut - totalExpenses;
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
const stdCostPerUnit = await getCostPerUnit('standard');
const asaanCostPerUnit = await getCostPerUnit('asaan');
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
paymentTransactions.forEach(transaction => {
if (transaction.isPayable && transaction.type === 'IN' && transaction.supplierCreditAmount) {
rawMaterialSupplierIds.add(String(transaction.entityId));
}
});
const entityBalances = {};
paymentEntities.forEach(entity => {
if (entity.isExpenseEntity === true) return;
entityBalances[entity.id] = 0;
});
paymentTransactions.forEach(transaction => {
if (transaction.isExpense === true) return;
if (rawMaterialSupplierIds.has(String(transaction.entityId))) return;
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
const isPending = material.paymentStatus === 'pending' || !material.paymentStatus;
if (material.supplierId && isPending && material.totalPayable > 0) {
const sid = String(material.supplierId);
pendingPerSupplier[sid] = (pendingPerSupplier[sid] || 0) + material.totalPayable;
} else if (!material.supplierId && isPending) {
const unlinkedPayable = parseFloat(material.totalPayable || material.totalValue || 0);
if (unlinkedPayable > 0) {
pendingPerSupplier['__unlinked__' + material.id] = unlinkedPayable;
}
}
});
for (const sid in pendingPerSupplier) {
const pendingAmount = pendingPerSupplier[sid];
if (pendingAmount > 0) {
CurrentLiabilities.accountsPayable.supplierPayables += pendingAmount;
}
}
}
paymentTransactions.forEach(transaction => {
if (transaction.isExpense === true) return;
if (!transaction.isPayable || transaction.type !== 'IN') return;
if (!transaction.supplierCreditAmount) return;
const creditAmt = parseFloat(transaction.supplierCreditAmount) || 0;
if (creditAmt > 0) {
CurrentLiabilities.accountsPayable.supplierPayables += creditAmt;
rawMaterialSupplierIds.add(String(transaction.entityId));
}
});
for (const entityId in entityBalances) {
if (rawMaterialSupplierIds.has(String(entityId))) continue;
const balance = entityBalances[entityId];
if (balance > 0) {
CurrentLiabilities.accountsPayable.entityPayables += balance;
}
}
CurrentLiabilities.accountsPayable.otherPayables.operating = 0;
CurrentLiabilities.accountsPayable.otherPayables.total = 0;
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
paymentsOut: rawData.paymentsOut,
operatingExpenses: totalExpenses
},
operatingCashFlow: rawData.totalProductionValue - rawData.totalSoldValue + netSalesCash + rawData.calculatorCash,
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
const _econMode = typeof currentCashTrackerMode !== 'undefined' ? currentCashTrackerMode : 'all';
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
{ const _el_cashDetailProductionCash = document.getElementById('cashDetailProductionCash'); if (_el_cashDetailProductionCash) _el_cashDetailProductionCash.textContent = `${fmtAmt(safeValue(indicators.cashDetails.productionCash))}`; }
document.getElementById('cashDetailRepCollections').textContent = `${fmtAmt(safeValue(indicators.cashDetails.repCollections))}`;
{ const _el_cashDetailPaymentsIn = document.getElementById('cashDetailPaymentsIn'); if (_el_cashDetailPaymentsIn) _el_cashDetailPaymentsIn.textContent = `${fmtAmt(safeValue(indicators.cashDetails.paymentsIn))}`; }
{ const _el_cashDetailPaymentsOut = document.getElementById('cashDetailPaymentsOut'); if (_el_cashDetailPaymentsOut) _el_cashDetailPaymentsOut.textContent = `${fmtAmt(safeValue(indicators.cashDetails.paymentsOut))}`; }
const cashDetailOpExpEl = document.getElementById('cashDetailOperatingExpenses');
if (cashDetailOpExpEl) cashDetailOpExpEl.textContent = `${fmtAmt(safeValue(indicators.cashDetails.operatingExpenses))}`;
{ const _el_cashDetailNet = document.getElementById('cashDetailNet'); if (_el_cashDetailNet) _el_cashDetailNet.textContent = `${fmtAmt(safeValue(indicators.cashInHand))}`; }
{ const _el_formulaProdTotal = document.getElementById('formulaProdTotal'); if (_el_formulaProdTotal) _el_formulaProdTotal.textContent = `${fmtAmt(safeValue(indicators.assets.cash))}`; }
{ const _el_formulaRawMaterials = document.getElementById('formulaRawMaterials'); if (_el_formulaRawMaterials) _el_formulaRawMaterials.textContent = `${fmtAmt(safeValue(indicators.assets.rawMaterials))}`; }
{ const _el_formulaUnitsValue = document.getElementById('formulaUnitsValue'); if (_el_formulaUnitsValue) _el_formulaUnitsValue.textContent = `${fmtAmt(safeValue(indicators.assets.formulaUnits))}`; }
const salesReceivablesEl = document.getElementById('salesReceivables');
const calculatorReceivablesEl = document.getElementById('calculatorReceivables');
const formulaReceivablesEl = document.getElementById('formulaReceivables');
if (salesReceivablesEl) salesReceivablesEl.textContent = `${fmtAmt(safeValue(indicators.receivables.salesTab))}`;
if (calculatorReceivablesEl) calculatorReceivablesEl.textContent = `${fmtAmt(safeValue(indicators.receivables.calculator))}`;
if (formulaReceivablesEl) formulaReceivablesEl.textContent = `${fmtAmt(safeValue(indicators.receivables.total))}`;
const supplierPayablesEl = document.getElementById('supplierPayables');
const entityPayablesEl = document.getElementById('entityPayables');
const formulaPayOutEl = document.getElementById('formulaPayOut');
if (supplierPayablesEl) supplierPayablesEl.textContent = `${fmtAmt(safeValue(indicators.liabilities.accountsPayable.supplierPayables))}`;
if (entityPayablesEl) entityPayablesEl.textContent = `${fmtAmt(safeValue(indicators.liabilities.accountsPayable.entityPayables))}`;
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
{ const _el_formulaFinal = document.getElementById('formulaFinal'); if (_el_formulaFinal) _el_formulaFinal.textContent = `${fmtAmt(safeValue(indicators.totalEnterpriseValue))}`; }
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
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
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
const _saleEffectiveDate = sale.supplyDate || sale.date;
if (_saleEffectiveDate === date && sale.supplyStore === store) {
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
const costData = await calculateSalesCost(store, quantity);
const totalCost = costData.totalCost;
const _effectiveSalePrice = await getEffectiveSalePriceForCustomer(name, store);
if (!_effectiveSalePrice || _effectiveSalePrice <= 0) {
showToast(' Sale price not configured for this store. Set prices in Factory Formulas before recording sales.', 'warning', 5000);
return;
}
const totalValue = quantity * _effectiveSalePrice;
const profit = totalValue - totalCost;
const existingCustomer = customerSales.find(s => s && s.customerName && name && s.customerName.toLowerCase() === name.toLowerCase());
let existingCredit = 0;
if (existingCustomer) {
customerSales.forEach(async sale => {
if (!(sale && sale.customerName && name && sale.customerName.toLowerCase() === name.toLowerCase())) return;
if (sale.transactionType === 'OLD_DEBT' && !sale.creditReceived) {
existingCredit += (await getSaleTransactionValue(sale)) - (sale.partialPaymentReceived || 0);
} else if (sale.paymentType === 'CREDIT' && !sale.creditReceived) {
if (sale.isMerged && typeof sale.creditValue === 'number') {
existingCredit += sale.creditValue;
} else {
existingCredit += (await getSaleTransactionValue(sale)) - (sale.partialPaymentReceived || 0);
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
 Consider collecting the existing balance before adding more credit. Proceeding will increase their total debt beyond the threshold.`;
if (!(await showGlassConfirm(_cwMsg, { title: " High Credit Warning", confirmText: "Add Credit Anyway", cancelText: "Cancel" }))) {
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
const deviceDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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
date: deviceDate,
supplyDate: date,
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
await unifiedSave('customer_sales', customerSales, validatedRecord);
try {
const _scName = validatedRecord.customerName;
const _scPhone = validatedRecord.customerPhone || '';
if (_scName && _scName.trim() && !(validatedRecord.salesRep !== 'NONE')) {
const _scIdx = Array.isArray(salesCustomers) ? salesCustomers.findIndex(c => c && c.name && c.name.toLowerCase() === _scName.toLowerCase()) : -1;
if (_scIdx === -1) {
const _scContact = { id: generateUUID('cust'), name: _scName, phone: _scPhone, address: '', oldDebit: 0, customSalePrice: 0, createdAt: getTimestamp(), updatedAt: getTimestamp(), timestamp: getTimestamp() };
if (!Array.isArray(salesCustomers)) salesCustomers = [];
salesCustomers.push(_scContact);
await unifiedSave('sales_customers', salesCustomers, _scContact);
}
}
} catch (_scErr) { console.warn('Auto-register sales customer failed:', _safeErr(_scErr)); }
notifyDataChange('sales');
triggerAutoSync();
if (typeof calculateCashTracker === 'function') calculateCashTracker();
if (typeof calculateNetCash === 'function') calculateNetCash();
emitSyncUpdate({ customer_sales: null});
document.getElementById('cust-name').value = '';
document.getElementById('cust-quantity').value = '';
selectSalesRep(document.querySelector('#sales-rep-toggle-group .toggle-opt'), 'NONE');
selectPaymentType(document.getElementById('btn-payment-credit'), 'CREDIT');

(async () => {
  const _stores = typeof getAppStores === 'function' ? await getAppStores() : [];
  const _firstStore = _stores[0] || { key: 'STORE_A' };
  const _firstBtn = document.querySelector('#supply-store-toggles .toggle-opt');
  selectSupplyStore(_firstBtn, _firstStore.key);
})();
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
await unifiedSave('customer_sales', customerSales);
} catch (rollbackError) {
console.error('UI refresh failed.', _safeErr(rollbackError));
showToast('Sale rollback failed: ' + (_safeErr(rollbackError).message || 'data may be inconsistent, please reload'), 'error');
}
showToast(' Failed to save sale. Please try again.', 'error');
}
}

function setSaleMode(mode) {
custTransactionMode = mode;
const isSale = mode === 'sale';
const _el = id => document.getElementById(id);

const btnSale = _el('btn-cust-mode-sale');
const btnColl = _el('btn-cust-mode-coll');
if (btnSale) btnSale.className = `toggle-opt${isSale ? ' active' : ''}`;
if (btnColl) btnColl.className = `toggle-opt${!isSale ? ' active' : ''}`;

const saleIn  = _el('cust-sale-inputs');
const collIn  = _el('cust-coll-inputs');
const supPay  = _el('cust-sale-supply-payment');
const collRes = _el('cust-coll-result');
if (saleIn)  isSale ? saleIn.classList.remove('hidden')  : saleIn.classList.add('hidden');
if (collIn)  isSale ? collIn.classList.add('hidden')     : collIn.classList.remove('hidden');
if (supPay)  { supPay.style.display = isSale ? '' : 'none'; }
if (collRes) { collRes.style.display = isSale ? 'none' : ''; }

const qtyRow = _el('customer-qty-row');
if (qtyRow) { qtyRow.style.display = isSale ? '' : 'none'; }

const btn = _el('btn-save-cust-transaction');
if (btn) btn.textContent = isSale ? 'Save Transaction' : 'Save Collection';

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
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
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
let _custOutstanding = 0;
try {
const _custHistory = customerSales.filter(s =>
s && s.currentRepProfile === 'admin' &&
s.customerName && s.customerName.toLowerCase() === name.toLowerCase()
);
for (const s of _custHistory) {
if (s.transactionType === 'OLD_DEBT') {
if (!s.creditReceived) _custOutstanding += (parseFloat(s.totalValue) || 0) - (s.partialPaymentReceived || 0);
} else if (s.paymentType === 'CREDIT' && !s.creditReceived) {
if (s.isMerged && typeof s.creditValue === 'number') {
_custOutstanding += s.creditValue;
} else {
_custOutstanding += (typeof getSaleTransactionValue === 'function' ? (await getSaleTransactionValue(s)) : (parseFloat(s.totalValue) || 0)) - (s.partialPaymentReceived || 0);
}
} else if (s.paymentType === 'COLLECTION' || s.paymentType === 'PARTIAL_PAYMENT') {
_custOutstanding -= (s.totalValue || 0);
}
}
_custOutstanding = Math.max(0, _custOutstanding);
} catch (_e) { _custOutstanding = -1; }
if (_custOutstanding === 0) {
showToast(`${name} has no outstanding credit balance. Collections can only be recorded against existing unpaid credit.`, 'error', 5000);
restoreBtn();
return;
} else if (_custOutstanding > 0 && amount > _custOutstanding) {
const _overAmt = amount - _custOutstanding;
const _proceed = await showGlassConfirm(
` Over-collection Warning!

${name} only owes ${fmtAmt(_custOutstanding)}.
You are collecting ${fmtAmt(amount)} — an overpayment of ${fmtAmt(_overAmt)}.

This will exceed the outstanding balance. Proceed only if this is an advance payment.`,
{ title: ' Over-collection Warning', confirmText: 'Collect Anyway', cancelText: 'Cancel' }
);
if (!_proceed) { restoreBtn(); return; }
}
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
await unifiedSave('customer_sales', customerSales, validated);
notifyDataChange('sales');
triggerAutoSync();
if (typeof calculateCashTracker === 'function') calculateCashTracker();
if (typeof calculateNetCash === 'function') calculateNetCash();
emitSyncUpdate({ customer_sales: null});

const savedName = name;
if (amountEl) amountEl.value = '';
const _custNameEl = document.getElementById('cust-name');
if (_custNameEl) _custNameEl.value = '';
document.getElementById('new-customer-phone-container').classList.add('hidden');
if (phoneInput) phoneInput.value = '';
if (typeof setSaleMode === 'function') setSaleMode('sale');
if (typeof renderCustomersTable === 'function') renderCustomersTable();
if (typeof refreshCustomerSales === 'function') refreshCustomerSales();
if (typeof calculateCustomerStatsForDisplay === 'function') await calculateCustomerStatsForDisplay(savedName);
showToast(` Collection of ${fmtAmt(amount)} recorded for ${name}`, 'success');
} catch (error) {
customerSales.length = 0;
customerSales.push(...snapshot);
try { await unifiedSave('customer_sales', customerSales); } catch (_) {}
showToast('Failed to save collection. Please try again.', 'error');
}
} finally {
restoreBtn();
}
}

async function saveCustomerTransaction() {
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
if (custTransactionMode === 'collection') {
await saveCustomerCollection();
} else {
await saveCustomerSale();
}
}

const _DEFAULT_STORES = [
  { key: 'STORE_A', name: 'ZUBAIR',   formulaType: 'standard' },
  { key: 'STORE_B', name: 'MAHMOOD',  formulaType: 'standard' },
  { key: 'STORE_C', name: 'ASAAN',    formulaType: 'asaan'    },
];
let _storesCache = null;
let _storesCacheTs = 0;
const _STORES_CACHE_TTL = 3000;

async function getAppStores() {
  const now = Date.now();
  if (_storesCache && (now - _storesCacheTs) < _STORES_CACHE_TTL) return _storesCache;
  try {
    const saved = await sqliteStore.get('app_stores');
    _storesCache = (Array.isArray(saved) && saved.length > 0) ? saved : _DEFAULT_STORES.map(s => ({ ...s }));
  } catch(e) {
    _storesCache = _DEFAULT_STORES.map(s => ({ ...s }));
  }
  _storesCacheTs = now;
  return _storesCache;
}
function _invalidateStoresCache() { _storesCache = null; _storesCacheTs = 0; }
window._invalidateStoresCache = _invalidateStoresCache;
window.getAppStores = getAppStores;

function getStoreLabel(storeCode) {
  if (_storesCache) {
    const f = _storesCache.find(s => s.key === storeCode);
    if (f) return f.name;
  }
  switch(storeCode) {
    case 'STORE_A': return 'ZUBAIR';
    case 'STORE_B': return 'MAHMOOD';
    case 'STORE_C': return 'ASAAN';
    default: return storeCode || '';
  }
}
async function getStoreLabelAsync(storeCode) {
  const stores = await getAppStores();
  const f = stores.find(s => s.key === storeCode);
  return f ? f.name : (storeCode || '');
}
async function getStoreFormulaType(storeCode) {
  const stores = await getAppStores();
  const f = stores.find(s => s.key === storeCode);
  return f ? (f.formulaType || 'standard') : 'standard';
}
window.getStoreFormulaType = getStoreFormulaType;

async function rebuildStoreUI() {
  const stores = await getAppStores();

  const supplyGroup = document.getElementById('supply-store-toggles');
  if (supplyGroup) {
    supplyGroup.innerHTML = '';
    stores.forEach((s, i) => {
      const btn = document.createElement('button');
      btn.className = 'toggle-opt' + (i === 0 ? ' active' : '');
      btn.id = 'btn-supply-store-' + s.key.toLowerCase();
      btn.textContent = s.name;
      btn.onclick = () => selectSupplyStore(btn, s.key);
      supplyGroup.appendChild(btn);
    });
    const hidden = document.getElementById('supply-store-value');
    if (hidden && stores.length) hidden.value = stores[0].key;
  }

  const retSection = document.getElementById('returnStoreSection');
  if (retSection) {
    const retGroup = retSection.querySelector('.toggle-group');
    if (retGroup) {
      retGroup.innerHTML = '';
      const returnStores = stores.filter(s => s.key === 'STORE_A' || s.key === 'STORE_B');
      returnStores.forEach((s, i) => {
        const btn = document.createElement('button');
        btn.className = 'toggle-opt' + (i === 0 ? ' active' : '');
        btn.id = 'ret-store-' + s.key.toLowerCase();
        btn.textContent = s.name;
        btn.onclick = () => selectReturnStore(s.key, btn);
        retGroup.appendChild(btn);
      });
    }
  }

  const storeHidden = document.getElementById('storeSelector');
  const storeTglGrp = document.getElementById('storeSelectorToggleGroup');
  if (storeTglGrp && storeHidden) {
    const cur = storeHidden.value;
    storeTglGrp.innerHTML = '';
    stores.forEach((s, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toggle-opt' + ((cur ? s.key === cur : i === 0) ? ' active' : '');
      btn.textContent = s.name;
      btn.onclick = () => {
        storeHidden.value = s.key;
        storeTglGrp.querySelectorAll('.toggle-opt').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateProductionCostOnStoreChange();
      };
      storeTglGrp.appendChild(btn);
    });
    if (!storeHidden.value && stores.length) storeHidden.value = stores[0].key;
    else if (!stores.find(s => s.key === cur) && stores.length) storeHidden.value = stores[0].key;
  }

  const factoryStoreSel = document.getElementById('factory-store-selector');
  if (factoryStoreSel) {
    const curFactory = factoryStoreSel.dataset.current || 'standard';
    factoryStoreSel.innerHTML = '';
    stores.forEach((s, i) => {
      const div = document.createElement('div');
      div.className = 'factory-store-opt' + (i === 0 ? ' active' : '');
      div.dataset.storeKey = s.key;
      div.textContent = s.name;
      div.onclick = function() { selectFactoryEntryStore(s.key, this); };
      factoryStoreSel.appendChild(div);
    });
  }

}
window.rebuildStoreUI = rebuildStoreUI;

async function getAvailableStoresForDate(date) {
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
const stores = new Set();
db.forEach(production => {
if (production.date === date && production.net > 0) {
stores.add(getStoreLabel(production.store));
}
});
return Array.from(stores).join(', ') || 'None';
}

async function calculateSalesCost(store, quantity) {
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
const factoryCostAdjustmentFactor = (await sqliteStore.get('factory_cost_adjustment_factor')) || {};
let costPerKg = 0;
let salePricePerKg = 0;
if (store === 'STORE_C') {
const formulaCost = await getCostPerUnit('asaan');
const adjustmentFactor = factoryCostAdjustmentFactor.asaan || 1;
costPerKg = adjustmentFactor > 0 ? formulaCost / adjustmentFactor : formulaCost;
			salePricePerKg = await getSalePriceForStore('STORE_C');
} else {
const formulaCost = await getCostPerUnit('standard');
const adjustmentFactor = factoryCostAdjustmentFactor.standard || 1;
costPerKg = adjustmentFactor > 0 ? formulaCost / adjustmentFactor : formulaCost;
salePricePerKg = await getSalePriceForStore('STORE_A');
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

async function calculateCustomerSale() {
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
const factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
if (typeof custTransactionMode !== 'undefined' && custTransactionMode === 'collection') return;
const quantity = parseFloat(document.getElementById('cust-quantity').value) || 0;
const date = document.getElementById('cust-date').value;
const store = document.getElementById('supply-store-value').value;
const customerName = (document.getElementById('cust-name')?.value || '').trim();
const costData = await calculateSalesCost(store, quantity);
const effectiveSalePrice = await getEffectiveSalePriceForCustomer(customerName, store);
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
const _saleEffectiveDate = sale.supplyDate || sale.date;
if (_saleEffectiveDate === date && sale.supplyStore === store) {
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
const grp = document.getElementById('supply-store-toggles');
if (grp) grp.querySelectorAll('.toggle-opt').forEach(b => b.classList.remove('active'));
if (btn) btn.classList.add('active');
const hid = document.getElementById('supply-store-value');
if (hid) hid.value = value;
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
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
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
_dcMsg += `\n\n Deleting this collection will restore the credit balance to this customer.`;
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
const wasPartialPayment = recordToDelete.paymentType === 'PARTIAL_PAYMENT';
const paymentAmount = recordToDelete.totalValue || 0;
if (wasPartialPayment && recordToDelete.relatedSaleId) {
const relatedSale = customerSales.find(s => s.id === recordToDelete.relatedSaleId);
if (relatedSale) {
relatedSale.partialPaymentReceived = Math.max(0, (relatedSale.partialPaymentReceived || 0) - paymentAmount);
if (relatedSale.partialPaymentReceived === 0) {
relatedSale.creditReceived = false;
delete relatedSale.creditReceivedDate;
}
relatedSale.updatedAt = getTimestamp();
ensureRecordIntegrity(relatedSale, true);
await unifiedSave('customer_sales', customerSales, relatedSale);
}
}
const customerSalesFiltered = customerSales.filter(s => s.id !== id);
await unifiedDelete('customer_sales', customerSalesFiltered, id, { strict: true }, recordToDelete);
await refreshCustomerSales();
calculateNetCash();
calculateCashTracker();
renderCustomersTable();
if (currentManagingCustomer && typeof renderCustomerTransactions === 'function') {
await renderCustomerTransactions(currentManagingCustomer);
}
notifyDataChange('sales');
triggerAutoSync();
emitSyncUpdate({ customer_sales: null});
const _delToast = _dcIsCollection
? ` Collection of ${fmtAmt(recordToDelete.totalValue||0)} deleted.`
: ` Sale deleted! ${recordToDelete.quantity} kg restored to ${recordDate} inventory.`;
showToast(_delToast, "success");
} catch (error) {
showToast(" Failed to delete sale. Please try again.", "error");
}
}
}

async function calculateSales() {
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
const seller = document.getElementById('sellerSelect').value;
const costPerKg = await getCostPriceForStore('STORE_A');
const salePrice = await getSalePriceForStore('STORE_A');
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
async function loadFirestoreStats() {
try {
const saved = await sqliteStore.get('firestore_stats', null);
if (saved && typeof saved === 'object') {
firestoreStats = saved;
if (!firestoreStats.lastReset) firestoreStats.lastReset = Date.now();
checkAndAutoResetFirestoreStats();
} else {
firestoreStats = { reads: 0, writes: 0, history: [], lastReset: Date.now() };
}
} catch (e) {
firestoreStats = { reads: 0, writes: 0, history: [], lastReset: Date.now() };
}
}

function saveFirestoreStats() {
sqliteStore.set('firestore_stats', firestoreStats).catch(() => {});
}
let firestoreStats = {
reads: 0,
writes: 0,
history: [],
lastReset: Date.now()
};
function checkAndAutoResetFirestoreStats() {
const now = Date.now();
const hoursSinceReset = (now - firestoreStats.lastReset) / (1000 * 60 * 60);
if (hoursSinceReset >= 24) {
firestoreStats.reads = 0;
firestoreStats.writes = 0;
firestoreStats.history = [];
firestoreStats.lastReset = now;
saveFirestoreStats();
}
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
_checkFirestoreCostThresholds();
}

function trackFirestoreWrite(count = 1) {
checkAndAutoResetFirestoreStats();
firestoreStats.writes += count;
saveFirestoreStats();
_checkFirestoreCostThresholds();
}

function resetFirestoreStats() {
firestoreStats = { reads: 0, writes: 0, history: [], lastReset: Date.now() };
saveFirestoreStats();
}
const originalOpenDataMenu = window.openDataMenu;
window.openDataMenu = function() {
if (typeof updateSyncButton === 'function') updateSyncButton();
if (typeof performOneClickSync === 'function') {
performOneClickSync().catch(function(e){console.error('[openDataMenu] sync error:', _safeErr(e))});
} else if (typeof originalOpenDataMenu === 'function') {
originalOpenDataMenu();
}
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
async trackId(collection, id) {
  if (!id) return;
  const sid = String(id);
  if (!this._dirty.has(collection)) this._dirty.set(collection, new Set());
  this._dirty.get(collection).add(sid);
  if (this._downloaded.has(collection)) this._downloaded.get(collection).delete(sid);
  const _dirtyIds = Array.from(this._dirty.get(collection) || []).filter(id => id !== '*');
  if (_dirtyIds.length > 0) {
    try {
      const existing = await sqliteStore.get(`pendingSync_${collection}`, []);
      const arr = Array.isArray(existing) ? existing : [];
      let changed = false;
      _dirtyIds.forEach(id => { if (!arr.includes(id)) { arr.push(id); changed = true; } });
      if (changed) {
        const trimmed = arr.length > 5000 ? arr.slice(-5000) : arr;
        await sqliteStore.set(`pendingSync_${collection}`, trimmed).catch(() => {});
      }
    } catch (_e) {}
  }
},
trackCollection(collection) {
  if (!this._dirty.has(collection)) this._dirty.set(collection, new Set());
  this._dirty.get(collection).add('*');
},
clearDirty(collection) {
  this._dirty.delete(collection);
  sqliteStore.remove(`pendingSync_${collection}`).catch(() => {});
},
isDirty(collection) {
  const s = this._dirty.get(collection);
  return s !== undefined && s.size > 0;
},
isDirtyId(collection, id) {
  const s = this._dirty.get(collection);
  if (!s || s.size === 0) return false;
  if (s.has('*')) return true;
  return s.has(String(id));
},
async markUploaded(collection, id) {
  const sid = String(id);
  if (!this._uploaded.has(collection)) this._uploaded.set(collection, new Set());
  this._uploaded.get(collection).add(sid);
  if (this._dirty.has(collection)) this._dirty.get(collection).delete(sid);

  const _uploadedIds = Array.from(this._uploaded.get(collection) || []);
  if (_uploadedIds.length > 0) {
    try {
      const existing = await sqliteStore.get(`uploadedIds_${collection}`, []);
      const arr = Array.isArray(existing) ? existing : [];
      let changed = false;
      _uploadedIds.forEach(id => { if (!arr.includes(id)) { arr.push(id); changed = true; } });
      if (changed) {
        const trimmed = arr.length > 5000 ? arr.slice(arr.length - 5000) : arr;
        await sqliteStore.set(`uploadedIds_${collection}`, trimmed).catch(() => {});
      }
    } catch (_e) {}
  }
},
async loadUploadedIds(collection) {
  try {
    const arr = await sqliteStore.get(`uploadedIds_${collection}`, []);
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
async loadPendingIds(collection) {
  try {
    const arr = await sqliteStore.get(`pendingSync_${collection}`, []);
    if (Array.isArray(arr) && arr.length > 0) {
      if (!this._dirty.has(collection)) this._dirty.set(collection, new Set());
      arr.forEach(id => this._dirty.get(collection).add(String(id)));
    }
  } catch (_e) {}
},
async loadAllPendingIds() {
  const cols = ['production','sales','calculator_history','rep_sales','rep_customers',
    'sales_customers','transactions','entities','inventory','factory_history',
    'returns','expenses'];
  await Promise.all(cols.map(c => this.loadPendingIds(c)));
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
  const isoStr = await sqliteStore.get(key);
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
  const isoStr = cached !== undefined ? cached : await sqliteStore.get(key);
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

  await sqliteStore.set(key, ts);
},
async getLastLocalModification(collection) {
  const key = `lastLocalMod_${collection}`;
  const cached = this._cacheGet(key);
  if (cached !== undefined) return cached === null ? 0 : cached;
  const raw = await sqliteStore.get(key);
  const val = raw !== null && raw !== undefined ? (typeof raw === 'number' ? raw : parseInt(raw)) : 0;
  this._cacheSet(key, val || null);
  return val || 0;
},
async setLastLocalModification(collection, timestamp) {
  const key = `lastLocalMod_${collection}`;
  const val = Number(timestamp);
  this._cacheSet(key, val);
  await sqliteStore.set(key, val);
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
    this._dirty.delete(col);
    this._uploaded.delete(col);
    this._downloaded.delete(col);
    await sqliteStore.remove(lsKey);
    await sqliteStore.remove(lmKey);
    await sqliteStore.remove(`uploadedIds_${col}`);
    await sqliteStore.remove(`downloadedIds_${col}`); // Fix 3: was orphaned on reset
    await sqliteStore.remove(`pendingSync_${col}`);
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
  await sqliteStore.set('deltaSyncStats', stats);
},
async getSyncStats() {
  try {
    const stats = await sqliteStore.get('deltaSyncStats');
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
  await sqliteStore.set('deltaSyncStats', stats);
}
};
async function initializeSyncStatsIfNeeded() {
const stats = await DeltaSync.getSyncStats();
const hasStats = Object.keys(stats).length > 0;
if (!hasStats) {
let lastSyncTime = new Date().toISOString();
try {
const lastSynced = await sqliteStore.get('last_synced');
if (lastSynced) {
lastSyncTime = lastSynced;
}
} catch (e) {
console.warn('Could not read last sync time', _safeErr(e));
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
await sqliteStore.set('deltaSyncStats', stats);
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
  let   _newDeviceRestore = false;

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

  function setNewDeviceRestore(flag) {
    _newDeviceRestore = !!flag;
  }

  function markUploaded(col, id) {
    const sid = String(id);

    _set(_uploaded, col).add(sid);

    DeltaSync.markUploaded(col, sid);
  }

  function skipUpload(col, id) {
    const sid = String(id);
    if (DeltaSync.isDirtyId(col, sid)) return false;
    const up = _uploaded.get(col);
    if (up && up.has(sid)) return true;
    if (!_myDeviceShard) return false;
    if (_isLocalOrigin(sid)) return false;
    return DeltaSync.wasUploaded(col, sid);
  }

  const _downloadPersistTimers = new Map();
  function _persistDownloadedIds(col) {
    if (_downloadPersistTimers.has(col)) clearTimeout(_downloadPersistTimers.get(col));
    _downloadPersistTimers.set(col, setTimeout(async () => {
      _downloadPersistTimers.delete(col);
      try {
        const ids = Array.from(_downloaded.get(col) || []);
        if (ids.length === 0) return;
        const trimmed = ids.length > MAX_IDS_PER_COL ? ids.slice(-MAX_IDS_PER_COL) : ids;
        await sqliteStore.set(`downloadedIds_${col}`, trimmed).catch(() => {});
      } catch (_) {}
    }, 800));
  }

  function markDownloaded(col, id) {
    const sid = String(id);
    _set(_downloaded, col).add(sid);
    DeltaSync.markDownloaded(col, sid);
    _persistDownloadedIds(col); // Fix 2: persist so it survives page reload
  }

  function skipDownload(col, id) {
    const sid = String(id);

    const dn = _downloaded.get(col);
    if (dn && dn.has(sid)) return true;

    if (_newDeviceRestore) return false;

    if (_isLocalOrigin(sid)) {

      if (typeof DeltaSync !== 'undefined' && DeltaSync.isDirtyId(col, sid)) return false;
      return true;
    }
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
      const uploadedArr = await sqliteStore.get(`uploadedIds_${col}`, []);
      if (Array.isArray(uploadedArr) && uploadedArr.length > 0) {
        const s = _set(_uploaded, col);
        uploadedArr.forEach(id => s.add(String(id)));
        DeltaSync.loadUploadedIds(col).catch(() => {});
      }
      const downloadedArr = await sqliteStore.get(`downloadedIds_${col}`, []);
      if (Array.isArray(downloadedArr) && downloadedArr.length > 0) {
        const s = _set(_downloaded, col);
        downloadedArr.forEach(id => s.add(String(id)));
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
      sqliteStore.remove(`uploadedIds_${c}`).catch(() => {}),
      sqliteStore.remove(`downloadedIds_${c}`).catch(() => {}),
    ]));
  }

  return {
    setDeviceShard,
    setNewDeviceRestore,
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
const salesHistory = ensureArray(await sqliteStore.get('noman_history'));
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
const factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
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
const costPerKg = (await getCostPriceForStore('STORE_A')) || 0;
const salePrice = await getSalePriceForStore('STORE_A');
if(!date) return showToast('Please select a date', 'warning', 3000);
if(sold <= 0) return showToast('Please enter valid units sold (must be greater than 0)', 'warning', 3000);
if(salePrice <= 0) return showToast('Please set a sale price in Factory Formulas first', 'warning', 3000);
if(ret > sold) return showToast('Returned quantity cannot exceed total sold', 'warning', 3000);
if(exp < 0) return showToast('Expired quantity cannot be negative', 'warning', 3000);
if(ret < 0) return showToast('Returned quantity cannot be negative', 'warning', 3000);
if(cred < 0) return showToast('Credit sales cannot be negative', 'warning', 3000);
if(prev < 0) return showToast('Previous credit received cannot be negative', 'warning', 3000);
if(rec < 0) return showToast('Received cash cannot be negative', 'warning', 3000);
if((ret + exp) > sold) return showToast('Combined returned + expired quantity cannot exceed total sold', 'warning', 3000);
const netSold = Math.max(0, sold - ret - exp);
if(cred > netSold) return showToast('Credit sales cannot exceed net sold quantity', 'warning', 3000);
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
const linkedIds = await markAllPendingCreditSalesAsCash(seller, reconciledCustomerIds);
entry.linkedSalesIds = linkedIds;
const linkedRepIds = await markRepSalesEntriesAsUsed(seller, date, calcId);
entry.linkedRepSalesIds = linkedRepIds;
try {
let history = await sqliteStore.get('noman_history', []);
if (!Array.isArray(history)) history = [];
history.push(entry);
await unifiedSave('noman_history', history, entry);
notifyDataChange('calculator');
emitSyncUpdate({ noman_history: null});
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
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const factorySalePrices = (await sqliteStore.get('factory_sale_prices')) || {};
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
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
doc.text(`Generated: ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})} at ${new Date().toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit', hour12: true})}`, pageW/2, 36, { align:'center' });
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
cust.debt > 0 ? fmtAmt(cust.debt) : '-',
cust.paid > 0 ? fmtAmt(cust.paid) : '-',
Math.abs(net) < 0.01 ? 'SETTLED'
: (net > 0 ? fmtAmt(net) : 'OVERPAID\n' + fmtAmt(Math.abs(net))),
fmtAmt(cust.qty),
formatDisplayDate(cust.lastDate) || '-'
]);
});
customerRows.push([
'TOTAL (' + customerMap.size + ' customers)',
'', '',
fmtAmt(totDebt),
fmtAmt(totPaid),
fmtAmt(Math.abs(totNet)) + (totNet > 0 ? '' : totNet < 0 ? '' : 'SETTLED'),
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
doc.text(`Customers with outstanding debt: ${cntDebtors} | Settled accounts: ${cntSettled} | Total outstanding: ${fmtAmt(Math.max(totNet), 2)}`, 14, afterY);
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
`Generated on ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})} at ${new Date().toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit', hour12: true})} | GULL AND ZUBAIR NASWAR DEALERS`,
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

async function markAllPendingCreditSalesAsCash(seller, reconciledCustomerIds) {
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
if (!seller || seller === 'COMBINED') return [];
const linkedIds = [];
const now = new Date();
const receivedDate = now.toISOString().split('T')[0];
const receivedTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
customerSales.forEach(sale => {
if (
sale.currentRepProfile === 'admin' &&
sale.customerName === seller &&
sale.paymentType === 'CREDIT' &&
!sale.creditReceived &&
sale.transactionType !== 'OLD_DEBT' &&
!(reconciledCustomerIds && reconciledCustomerIds.has(sale.id))
) {
sale.paymentType = 'CASH';
sale.creditReceived = true;
sale.creditReceivedDate = receivedDate;
sale.creditReceivedTime = receivedTime;
if (!sale.currentRepProfile) sale.currentRepProfile = 'admin';
sale.updatedAt = getTimestamp();
ensureRecordIntegrity(sale, true);
linkedIds.push(sale.id);
}
});
if (linkedIds.length > 0) {
await unifiedSave('customer_sales', customerSales, null, linkedIds);
if (typeof refreshCustomerSales === 'function') refreshCustomerSales(1, false);
notifyDataChange('sales');
}
return linkedIds;
}

async function markSalesEntriesAsReceived(seller, quantityToMark) {
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
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
sale.creditReceivedTime = new Date().toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit', hour12: true});
if (!sale.currentRepProfile) sale.currentRepProfile = 'admin';
sale.updatedAt = getTimestamp();
ensureRecordIntegrity(sale, true);
linkedIds.push(sale.id);
remainingQty -= sale.quantity;
} else {
break;
}
}
if (linkedIds.length > 0) {
await unifiedSave('customer_sales', customerSales, null, linkedIds);
if (typeof refreshCustomerSales === 'function') {
refreshCustomerSales(1, false);
}
}
return linkedIds;
}

async function markRepSalesEntriesAsUsed(seller, date, calcId) {
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
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
    await unifiedSave('rep_sales', repSales, null, linkedRepIds);
  }
  return linkedRepIds;
}

async function revertRepSalesEntries(repSaleIds) {
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
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
    await unifiedSave('rep_sales', repSales, null, repSaleIds);
    notifyDataChange('rep');
    triggerAutoSync();
  }
  return revertedCount;
}

async function updateCompositionChart() {
const _sdEl = document.getElementById('sellerSelect');
if (_sdEl && _sdEl.value === 'COMBINED') {
const comp = await calculateComparisonData();
updateSalesCharts(comp);
}
}

async function setIndChartMode(mode) {
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const salesHistory = ensureArray(await sqliteStore.get('noman_history'));
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
currentIndMode = mode;
document.getElementById('ind-week-btn').className = `toggle-opt ${mode === 'week' ? 'active' : ''}`;
document.getElementById('ind-month-btn').className = `toggle-opt ${mode === 'month' ? 'active' : ''}`;
document.getElementById('ind-year-btn').className = `toggle-opt ${mode === 'year' ? 'active' : ''}`;
document.getElementById('ind-all-btn').className = `toggle-opt ${mode === 'all' ? 'active' : ''}`;
await updateIndChart();
}

async function setIndChartMetric(metric) {
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const salesHistory = ensureArray(await sqliteStore.get('noman_history'));
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
currentIndMetric = metric;
await updateIndChart();
}

async function updateIndChart() {
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const salesHistory = ensureArray(await sqliteStore.get('noman_history'));
const repSales = ensureArray(await sqliteStore.get('rep_sales'));

const seller = document.getElementById('sellerSelect').value;
if (seller === 'COMBINED') return;
if(indPerformanceChart) indPerformanceChart.destroy();
let history; history = await sqliteStore.get('noman_history', []);
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
if (!chartElement) { return; }
indPerformanceChart = new SarimChart(chartElement, {
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

async function updateStoreComparisonChart(mode = 'day') {
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));

if(storeComparisonChart) storeComparisonChart.destroy();
const selectedDate = document.getElementById('sys-date').value;
const selectedDateObj = new Date(selectedDate);
const selectedYear = selectedDateObj.getFullYear();
const selectedMonth = selectedDateObj.getMonth();
const selectedDay = selectedDateObj.getDate();
const _chartStores = await getAppStores();
const stores = _chartStores.map(s => s.key);
const storeLabels = _chartStores.map(s => s.name);
const storeColors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'].slice(0, _chartStores.length);
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
if (!storeChartElement) { return; }
storeComparisonChart = new SarimChart(storeChartElement, {
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
const _ruiBatch = await sqliteStore.getBatch([
'mfg_pro_pkr','stock_returns','customer_sales','sales_customers',
'noman_history','payment_transactions','payment_entities',
'expenses','deleted_records',
]);
const deletedRecordIds = new Set(ensureArray(_ruiBatch.get('deleted_records')));
const _rdAlive = (item) => item && item.id && !deletedRecordIds.has(String(item.id));
const db = ensureArray(_ruiBatch.get('mfg_pro_pkr')).filter(_rdAlive);
const stockReturns = ensureArray(_ruiBatch.get('stock_returns')).filter(_rdAlive);
const customerSales = ensureArray(_ruiBatch.get('customer_sales')).filter(_rdAlive);
const salesCustomers = ensureArray(_ruiBatch.get('sales_customers')).filter(_rdAlive);
const salesHistory = ensureArray(_ruiBatch.get('noman_history')).filter(_rdAlive);
const paymentTransactions = ensureArray(_ruiBatch.get('payment_transactions')).filter(_rdAlive);
const paymentEntities = ensureArray(_ruiBatch.get('payment_entities')).filter(_rdAlive);
const expenseRecords = ensureArray(_ruiBatch.get('expenses')).filter(_rdAlive);
const selectedDate = document.getElementById('sys-date').value;
if (!selectedDate) return;
if (sqliteStore && sqliteStore.get) {

try {
let freshProduction = await sqliteStore.get('mfg_pro_pkr', []);
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
await sqliteStore.set('mfg_pro_pkr', freshProduction);
}
}
} catch (error) {
console.warn('[validateAllData] data integrity check failed:', _safeErr(error));
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
const filteredProduction = sortedDb.filter(item => {
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
const totalItems = filteredProduction.length;
const histContainer = document.getElementById('prodHistoryList');
if (totalItems === 0) {
histContainer.replaceChildren(Object.assign(document.createElement('p'), {textContent:'No records found for this selection.',style:'text-align:center;color:var(--text-muted);width:100%;font-size:0.85rem'}));
} else {
const fragment = document.createDocumentFragment();
const _badgeClasses = ['store-a', 'store-b', 'store-c', 'store-d', 'store-e'];
const _appStoresProd = typeof getAppStores === 'function' ? await getAppStores() : [];
filteredProduction.forEach(item => {
const isSelected = item.date === selectedDate;
const highlightClass = isSelected ? 'highlight-card' : '';
const dateDisplay = isSelected ? `${formatDisplayDateTime(item.date, item.time)} (Selected)` : formatDisplayDateTime(item.date, item.time);
const storeLabel = item.store === 'STORE_A' ? 'ZUBAIR' : item.store === 'STORE_B' ? 'MAHMOOD' : 'ASAAN';
const _storeIdx = _appStoresProd.findIndex(s => s.key === item.store);
const storeBadgeClass = _storeIdx >= 0 ? (_badgeClasses[_storeIdx] || 'store-a') : (item.store === 'STORE_A' ? 'store-a' : item.store === 'STORE_B' ? 'store-b' : 'store-c');
let paymentBadge = '';
let mergedBadge = '';
if (item.isMerged) {
mergedBadge = _mergedBadgeHtml(item, {inline:true});
}
const div = document.createElement('div');
div.className = `card liquid-card ${highlightClass}${item.isReturn ? ' return-card' : ''}`;
if (item.date) div.setAttribute('data-date', item.date);
let returnsByStoreHtml = '';
if (item.isMerged && item.isReturn && item.returnsByStore && Object.keys(item.returnsByStore).length > 1) {
  returnsByStoreHtml = Object.entries(item.returnsByStore).map(([s,q]) =>
    `<p><span style="color:var(--text-muted);">${esc(typeof getStoreLabel === 'function' ? getStoreLabel(s) : s)}:</span> <span class="qty-val">${safeValue(q).toFixed(2)} kg</span></p>`
  ).join('');
}
div.innerHTML = `
${currentProductionView === 'combined' ? `<span class="store-badge ${storeBadgeClass}">${esc(storeLabel)}</span>` : ''}
${item.isMerged ? '' : paymentBadge}
<div style="display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin-bottom:4px;">
<span class="u-fs-sm2 u-text-muted">${dateDisplay}${mergedBadge}</span>
${item.managedBy ? `<span class="managed-by-badge">${esc(item.managedBy)}</span>` : ''}
${item.createdBy && typeof _creatorBadgeHtml === 'function' ? _creatorBadgeHtml(item) : ''}
</div>
${item.isReturn ? `
<p style="color:var(--accent-emerald);font-size:0.75rem;font-style:italic;">${item.isMerged ? 'Merged returns by' : 'Returned by'} ${esc(item.returnedBy || 'Representative')}</p>
<p><span>Returned:</span> <span class="qty-val">${safeValue(item.net).toFixed(2)} kg</span></p>
${returnsByStoreHtml}
${item.isMerged ? '' : `<button class="tbl-action-btn danger u-w-full u-mt-8" onclick="(async () => { await deleteProdEntry('${esc(item.id)}') })()">Delete</button>`}
` : `
${item.grossWt ? `<p><span>Gross Weight:</span> <span class="qty-val">${safeValue(item.grossWt).toFixed(2)} kg</span></p>` : ''}
${item.contWt ? `<p><span>Container:</span> <span style="color:var(--text-muted);">${safeValue(item.contWt).toFixed(2)} kg</span></p>` : ''}
<p><span>Net Weight:</span> <span class="qty-val">${safeValue(item.net).toFixed(2)} kg</span></p>
<p><span>Cost Price:</span> <span class="cost-val">${safeValue(item.cp).toFixed(2)}/kg</span></p>
<p><span>Sale Price:</span> <span class="rev-val">${safeValue(item.sp).toFixed(2)}/kg</span></p>
<hr>
<p><span>Total Cost:</span> <span class="cost-val">${fmtAmt(safeValue(item.totalCost))}</span></p>
<p><span>Total Value:</span> <span class="rev-val">${fmtAmt(safeValue(item.totalSale))}</span></p>
<p><span>Net Profit:</span> <span class="profit-val">${fmtAmt(safeValue(item.profit))}</span></p>
${item.formulaUnits ? `<p><span>Formula Units:</span> <span class="qty-val">${safeValue(item.formulaUnits).toFixed(2)}</span></p>` : ''}
${item.formulaCost ? `<p><span>Formula Cost:</span> <span class="cost-val">${fmtAmt(safeValue(item.formulaCost))}</span></p>` : ''}
${item.isMerged ? '' : `<button class="tbl-action-btn danger u-w-full u-mt-8" onclick="(async () => { await deleteProdEntry('${esc(item.id)}') })()">Delete</button>`}
`}
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
if (typeof syncFactoryProductionStats === 'function') {
syncFactoryProductionStats().then(() => {
if (typeof updateUnitsAvailableIndicator === 'function') updateUnitsAvailableIndicator();
}).catch(() => {
if (typeof updateUnitsAvailableIndicator === 'function') updateUnitsAvailableIndicator();
});
} else {
updateUnitsAvailableIndicator();
}
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

async function renderEntityTable(page = 1) {
const deletedRecordIds = new Set(ensureArray(await sqliteStore.get('deleted_records')));
const _retAlive = (item) => item && item.id && !deletedRecordIds.has(String(item.id));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities')).filter(_retAlive);
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions')).filter(_retAlive);
const expenseRecords = ensureArray(await sqliteStore.get('expenses')).filter(_retAlive);
const tbody = document.getElementById('entity-table-body');
const filterInput = document.getElementById('entity-list-filter');
const filter = filterInput ? String(filterInput.value).toLowerCase() : '';
if (!tbody) return;

try {
const _freshInv = await sqliteStore.get('factory_inventory_data', []);
if (_freshInv && Array.isArray(_freshInv) && _freshInv.length > 0) {
}
} catch (_e) {}
const balances = await calculateEntityBalances();
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
const totalItems = matchedEntities.length;
if (!matchedEntities || !Array.isArray(matchedEntities) || !balances) {
tbody.innerHTML = `<tr><td class="u-text-center u-text-danger" colspan="3" >Invalid entity data</td></tr>`;
return;
}
if (totalItems === 0) {
tbody.replaceChildren(Object.assign(document.createElement('tr'), {innerHTML:'<td colspan="3" style="text-align:center;padding:15px;color:var(--text-muted)">No entities found</td>'}));
} else {
const fragment = document.createDocumentFragment();
matchedEntities.forEach(entity => {
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
tr.style.cursor = 'pointer';
tr.innerHTML = `
<td style="text-align:left;" onclick="openEntityDetailsOverlay('${esc(entity.id)}')">
<div class="u-fw-700">${esc(safeName)}</div>
<div style="font-size:0.62rem;color:var(--accent);margin-top:3px;cursor:pointer;" onclick="event.stopPropagation(); editEntityBasicInfo('${esc(entity.id)}')"> Edit info</div>
</td>
<td style="text-align:right; cursor:pointer;" onclick="openEntityDetailsOverlay('${esc(entity.id)}')">${balanceHtml}</td>
<td style="text-align:right; font-size:0.75rem;">${phoneActionHTML(entity.phone)}</td>
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

async function filterEntityList() {
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
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

async function viewEntityTransactions(entityId) {
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
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
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const newEntities = [];
const fixedMaterials = [];
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
newEntities.push(_sseEntity);
} else if (material.supplierId && existingEntity.id !== material.supplierId) {
material.supplierId = existingEntity.id;
fixedMaterials.push(material);
}
});

if (newEntities.length > 0) {
await unifiedSave('payment_entities', paymentEntities, null, newEntities.map(e => e.id));
}
if (fixedMaterials.length > 0) {
await unifiedSave('factory_inventory_data', factoryInventoryData, null, fixedMaterials.map(i => i.id));
}
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
      console.warn('Firebase reauth network error, falling back to offline check:', _safeErr(fbErr));
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
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);display:flex;align-items:center;justify-content:center;z-index:10300;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);';
    modal.innerHTML = `
    <div class="liquid-card" style="max-width:370px;width:92%;padding:28px 24px;text-align:center;">
      <div style="font-size:1.6rem;margin-bottom:8px;"></div>
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
          <svg width="16" height="16" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style="transition:opacity 0.2s;"><path d="M6 18 C6 18 10 10 18 10 C26 10 30 18 30 18 C30 18 26 26 18 26 C10 26 6 18 6 18 Z" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" fill="var(--accent)" fill-opacity="0.10"/><circle cx="18" cy="18" r="4" fill="var(--accent)" opacity="0.30" stroke="var(--accent)" stroke-width="1.4"/><circle cx="18" cy="18" r="1.5" fill="var(--accent)"/></svg>
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
        errEl.textContent = ' Incorrect password — please try again.';
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
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const factoryProductionHistory = ensureArray(await sqliteStore.get('factory_production_history'));
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
const factorySalePrices = (await sqliteStore.get('factory_sale_prices')) || {};
const factoryCostAdjustmentFactor = (await sqliteStore.get('factory_cost_adjustment_factor')) || {};
const factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
const deletedRecordIds = new Set(ensureArray(await sqliteStore.get('deleted_records')));
if (!currentUser) {
showToast('Please sign in to create a backup.', 'error');
showAuthOverlay();
return;
}
if (currentUser) {
const _bkpMsg = `Choose how to save your data backup.\n\nCloud Backup: Uploads a snapshot to your connected cloud account. Accessible from any signed-in device.\n\nDownload Encrypted File: Saves an AES-256-GCM encrypted backup file to this device. The file is unreadable without your login credentials.\n\n Your account credentials are used to encrypt the file.`;
if (await showGlassConfirm(_bkpMsg, { title: 'Save Backup', confirmText: 'Cloud Backup', cancelText: 'Download Encrypted File' })) {
await pushDataToCloud();
return;
}
}
const data = {
mfg: db,
sales: await sqliteStore.get('noman_history', []),
customerSales: await sqliteStore.get('customer_sales', []),
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
settings: await sqliteStore.get('naswar_default_settings', defaultSettings),
appStores: await sqliteStore.get('app_stores') || [],
deleted_records: Array.from(deletedRecordIds),
_meta: { encryptedFor: currentUser.email, encryptedUid: currentUser.uid, createdAt: Date.now(), version: 4 }
};
const encEmail = currentUser.email;
const encPassword = await promptVerifiedBackupPassword({ inputId: 'enc_bkp_pwd' });
if (!encPassword) {
showToast('Backup cancelled.', 'info');
return;
}
try {
showToast(' Encrypting backup with AES-256-GCM + account binding...', 'info', 3000);
const encryptedBlob = await CryptoEngine.encrypt(data, encEmail, encPassword, currentUser.uid);
const timestamp = new Date().toISOString().split('T')[0];
_triggerFileDownload(encryptedBlob, `NaswarDealers_SecureBackup_${timestamp}.gznd`);
showToast(' Encrypted backup created! File requires your credentials to restore.', 'success', 5000);
} catch(encErr) {
console.error('Encryption failed:', _safeErr(encErr));
showToast('Encryption failed: ' + encErr.message, 'error');
}
}

async function unifiedRestore(event) {
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const factoryProductionHistory = ensureArray(await sqliteStore.get('factory_production_history'));
const deletedRecordIds = new Set(ensureArray(await sqliteStore.get('deleted_records')));
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
modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:10300;';
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
data = await CryptoEngine.decrypt(arrayBuffer, currentUser.email, decPassword, currentUser.uid);
} catch(decErr) {
if (decErr.message === 'WRONG_ACCOUNT') {
showToast('This backup belongs to a different account and cannot be restored here.', 'error', 7000);
} else if (decErr.message === 'WRONG_CREDENTIALS') {
showToast('Incorrect password. Decryption failed.', 'error', 6000);
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

  return data;
}

async function _doRestoreMerge(data) {
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const factoryProductionHistory = ensureArray(await sqliteStore.get('factory_production_history'));
const deletedRecordIds = new Set(ensureArray(await sqliteStore.get('deleted_records')));
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
const factorySalePrices = (await sqliteStore.get('factory_sale_prices')) || {};
const factoryCostAdjustmentFactor = (await sqliteStore.get('factory_cost_adjustment_factor')) || {};
const factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
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
await sqliteStore.set('deleted_records', Array.from(deletedRecordIds));
}
const isAlive = (item) => item && item.id && !deletedRecordIds.has(item.id);
const currentLocalData = {
mfg_pro_pkr:                await sqliteStore.get('mfg_pro_pkr') || [],
noman_history:              await sqliteStore.get('noman_history') || [],
customer_sales:             await sqliteStore.get('customer_sales') || [],
rep_sales:                  await sqliteStore.get('rep_sales') || [],
rep_customers:              await sqliteStore.get('rep_customers') || [],
sales_customers:            await sqliteStore.get('sales_customers') || [],
factory_inventory_data:     await sqliteStore.get('factory_inventory_data') || [],
factory_production_history: await sqliteStore.get('factory_production_history') || [],
stock_returns:              await sqliteStore.get('stock_returns') || [],
payment_transactions:       await sqliteStore.get('payment_transactions') || [],
payment_entities:           await sqliteStore.get('payment_entities') || [],
expenses:                   await sqliteStore.get('expenses') || []
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
const _sqliteToFirestore = {
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
const firestoreCollection = _sqliteToFirestore[key];
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
await sqliteStore.setBatch([
['mfg_pro_pkr',                mergedData.mfg_pro_pkr],
['noman_history',              mergedData.noman_history],
['customer_sales',             mergedData.customer_sales],
['rep_sales',                  mergedData.rep_sales],
['rep_customers',              mergedData.rep_customers],
['sales_customers',            mergedData.sales_customers],
['factory_inventory_data',     mergedData.factory_inventory_data],
['factory_production_history', mergedData.factory_production_history],
['stock_returns',              mergedData.stock_returns],
['payment_transactions',       mergedData.payment_transactions],
['payment_entities',           mergedData.payment_entities],
['expenses',                   mergedData.expenses],
]);
const currentSettings = {
factoryDefaultFormulas:       await sqliteStore.get('factory_default_formulas'),
factoryAdditionalCosts:       await sqliteStore.get('factory_additional_costs'),
factoryCostAdjustmentFactor:  await sqliteStore.get('factory_cost_adjustment_factor'),
factorySalePrices:            await sqliteStore.get('factory_sale_prices'),
factoryUnitTracking:          await sqliteStore.get('factory_unit_tracking'),
naswarDefaultSettings:        await sqliteStore.get('naswar_default_settings')
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
await sqliteStore.set('factory_default_formulas', _cleanFormulas);
await sqliteStore.set('factory_default_formulas_timestamp', settingsTimestamp);
}
if (_cleanCosts && ('standard' in _cleanCosts) && ('asaan' in _cleanCosts) &&
    JSON.stringify(_cleanCosts) !== JSON.stringify(currentSettings.factoryAdditionalCosts)) {
await sqliteStore.set('factory_additional_costs', _cleanCosts);
await sqliteStore.set('factory_additional_costs_timestamp', settingsTimestamp);
}
if (_cleanFactor && ('standard' in _cleanFactor) && ('asaan' in _cleanFactor) &&
    JSON.stringify(_cleanFactor) !== JSON.stringify(currentSettings.factoryCostAdjustmentFactor)) {
await sqliteStore.set('factory_cost_adjustment_factor', _cleanFactor);
await sqliteStore.set('factory_cost_adjustment_factor_timestamp', settingsTimestamp);
}
if (_cleanPrices && ('standard' in _cleanPrices) && ('asaan' in _cleanPrices) &&
    JSON.stringify(_cleanPrices) !== JSON.stringify(currentSettings.factorySalePrices)) {
await sqliteStore.set('factory_sale_prices', _cleanPrices);
await sqliteStore.set('factory_sale_prices_timestamp', settingsTimestamp);
}
if (_cleanTracking && ('standard' in _cleanTracking) && ('asaan' in _cleanTracking) &&
    JSON.stringify(_cleanTracking) !== JSON.stringify(currentSettings.factoryUnitTracking)) {
await sqliteStore.set('factory_unit_tracking', _cleanTracking);
await sqliteStore.set('factory_unit_tracking_timestamp', settingsTimestamp);
}
if (data.settings && JSON.stringify(data.settings) !== JSON.stringify(currentSettings.naswarDefaultSettings)) {
await sqliteStore.set('naswar_default_settings', data.settings);
await sqliteStore.set('naswar_default_settings_timestamp', settingsTimestamp);
defaultSettings = data.settings;
}
if (Array.isArray(data.appStores) && data.appStores.length > 0) {
const localStores = (await sqliteStore.get('app_stores')) || [];
const localKeySet = new Set(localStores.map(s => s.key));
const merged = [...localStores];
for (const s of data.appStores) {
  if (s && s.key && !localKeySet.has(s.key)) merged.push(s);
}
await sqliteStore.set('app_stores', merged);
await sqliteStore.set('app_stores_timestamp', settingsTimestamp);
if (typeof _invalidateStoresCache === 'function') _invalidateStoresCache();
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
      default_formulas:                ensureFactorySettings(await sqliteStore.get('factory_default_formulas'), { standard: [], asaan: [] }),
      default_formulas_timestamp:      await sqliteStore.get('factory_default_formulas_timestamp') || currentTimestamp,
      additional_costs:                ensureFactorySettings(await sqliteStore.get('factory_additional_costs'), { standard: 0, asaan: 0 }),
      additional_costs_timestamp:      await sqliteStore.get('factory_additional_costs_timestamp') || currentTimestamp,
      cost_adjustment_factor:          ensureFactorySettings(await sqliteStore.get('factory_cost_adjustment_factor'), { standard: 1, asaan: 1 }),
      cost_adjustment_factor_timestamp:await sqliteStore.get('factory_cost_adjustment_factor_timestamp') || currentTimestamp,
      sale_prices:                     ensureFactorySettings(await sqliteStore.get('factory_sale_prices'), { standard: 0, asaan: 0 }),
      sale_prices_timestamp:           await sqliteStore.get('factory_sale_prices_timestamp') || currentTimestamp,
      unit_tracking:                   ensureFactorySettings(await sqliteStore.get('factory_unit_tracking'), { standard: { produced:0,consumed:0,available:0,unitCostHistory:[] }, asaan: { produced:0,consumed:0,available:0,unitCostHistory:[] } }),
      unit_tracking_timestamp:         await sqliteStore.get('factory_unit_tracking_timestamp') || currentTimestamp,
      last_synced:                     new Date().toISOString()
    };
    currentBatch.set(
      userRef.collection('factorySettings').doc('config'),
      sanitizeForFirestore(factorySettingsPayload),
      { merge: true }
    );
    operationCount++;
    const _restoreStores = await sqliteStore.get('app_stores');
    if (Array.isArray(_restoreStores) && _restoreStores.length > 0) {
      currentBatch.set(
        userRef.collection('appStores').doc('stores'),
        sanitizeForFirestore({ stores: _restoreStores }),
        { merge: true }
      );
      operationCount++;
    }
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
    await sqliteStore.set('firestore_initialized', true);
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

if (data.person_photos && typeof data.person_photos === 'object' && !Array.isArray(data.person_photos)) {
  try {
    const existingPhotos = (await sqliteStore.get('person_photos')) || {};
    const backupPhotos = data.person_photos;
    const mergedPhotos = Object.assign({}, existingPhotos, backupPhotos);
    await sqliteStore.set('person_photos', mergedPhotos);

    const existingTs = (await sqliteStore.get('person_photos_timestamps')) || {};
    const backupTs   = (data.person_photos_timestamps && typeof data.person_photos_timestamps === 'object')
      ? data.person_photos_timestamps : {};
    const nowMs = Date.now();
    const mergedTs = Object.assign({}, existingTs);
    for (const key of Object.keys(backupPhotos)) {
      mergedTs[key] = backupTs[key] || nowMs;
    }
    await sqliteStore.set('person_photos_timestamps', mergedTs);

    const restoredKeys = Object.keys(backupPhotos);
    if (restoredKeys.length > 0) {
      const dirtyKeys = (await sqliteStore.get('person_photos_dirty_keys')) || [];
      for (const k of restoredKeys) { if (!dirtyKeys.includes(k)) dirtyKeys.push(k); }
      await sqliteStore.set('person_photos_dirty_keys', dirtyKeys);
      await sqliteStore.set('person_photos_timestamp', nowMs);
      if (typeof triggerAutoSync === 'function') { try { triggerAutoSync(); } catch(_) {} }
      showToast(`Restored ${restoredKeys.length} photo(s) from backup.`, 'info', 3000);
    }
  } catch(e) { console.warn('[restore] person_photos merge failed', e); }
}
showToast(`Restore complete${syncMessage}! ${statsMessage}`, 'success', 5000);
}

async function _doYearCloseRestore(data, honourPostCloseDeletions = true) {
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const factoryProductionHistory = ensureArray(await sqliteStore.get('factory_production_history'));
const deletedRecordIds = new Set(ensureArray(await sqliteStore.get('deleted_records')));
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
const currentDb = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const currentSalesHistory = ensureArray(await sqliteStore.get('noman_history'));
let factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
let factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
let factorySalePrices = (await sqliteStore.get('factory_sale_prices')) || {};
let factoryCostAdjustmentFactor = (await sqliteStore.get('factory_cost_adjustment_factor')) || {};
let factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
  data = normaliseBackupFields(data);
  showToast('↩ Reversing financial year close — replacing data...', 'info', 5000);

  const _backupIds = new Set([
    ...ensureArray(data.mfg || data.mfg_pro_pkr),
    ...ensureArray(data.sales || data.noman_history),
    ...ensureArray(data.customerSales),
    ...ensureArray(data.repSales),
    ...ensureArray(data.paymentTransactions),
    ...ensureArray(data.factoryProductionHistory),
    ...ensureArray(data.stockReturns),
    ...ensureArray(data.expenses),
  ].filter(r => r && r.id).map(r => String(r.id)));

  const _mergedToTombstone = [
    ...ensureArray(currentDb),
    ...ensureArray(currentSalesHistory),
    ...ensureArray(customerSales),
    ...ensureArray(repSales),
    ...ensureArray(paymentTransactions),
    ...ensureArray(factoryProductionHistory),
    ...ensureArray(stockReturns),
    ...ensureArray(expenseRecords),
  ].filter(r => r && r.id && r.isMerged === true && !_backupIds.has(String(r.id)));

  if (_mergedToTombstone.length > 0) {
    _mergedToTombstone.forEach(r => deletedRecordIds.add(String(r.id)));
    await sqliteStore.set('deleted_records', Array.from(deletedRecordIds));
  }

  const isAlive = honourPostCloseDeletions
    ? (item) => item && item.id && !deletedRecordIds.has(item.id)
    : (item) => item && item.id;

  const _ycRepNameSet = new Set((Array.isArray(salesRepsList) ? salesRepsList : []).map(r => r.toLowerCase()));
  const _ycNotRepName = (c) => !c || !c.name || !_ycRepNameSet.has(c.name.toLowerCase());

  const _backupCreatedAt = (data._meta && data._meta.createdAt) || 0;
  const _recTs = r => r.createdAt || r.timestamp || 0;
  const _isPostClose  = r => r && r.id && _recTs(r) > _backupCreatedAt;

  const _postCloseKeep = (current, backupArr) => {
    const backupIdSet = new Set(ensureArray(backupArr).filter(r => r && r.id).map(r => String(r.id)));
    return ensureArray(current).filter(r =>
      isAlive(r) &&
      _isPostClose(r) &&
      !backupIdSet.has(String(r.id)) &&
      !(r.isMerged === true && !_backupIds.has(String(r.id)))
    );
  };

  const replaceData = {
    mfg_pro_pkr:                [...ensureArray(data.mfg || data.mfg_pro_pkr).filter(isAlive),
                                  ..._postCloseKeep(currentDb, data.mfg || data.mfg_pro_pkr)],
    noman_history:              [...ensureArray(data.sales || data.noman_history).filter(isAlive),
                                  ..._postCloseKeep(currentSalesHistory, data.sales || data.noman_history)],
    customer_sales:             [...ensureArray(data.customerSales).filter(isAlive),
                                  ..._postCloseKeep(customerSales, data.customerSales)],
    rep_sales:                  [...ensureArray(data.repSales).filter(isAlive),
                                  ..._postCloseKeep(repSales, data.repSales)],
    rep_customers:              mergeDatasets(ensureArray(data.repCustomers).filter(isAlive), ensureArray(repCustomers || []).filter(isAlive)),
    sales_customers:            mergeDatasets(ensureArray(data.salesCustomers).filter(isAlive).filter(_ycNotRepName), ensureArray(salesCustomers || []).filter(isAlive).filter(_ycNotRepName)),
    factory_inventory_data:     ensureArray(data.factoryInventoryData).filter(isAlive),
    factory_production_history: [...ensureArray(data.factoryProductionHistory).filter(isAlive),
                                  ..._postCloseKeep(factoryProductionHistory, data.factoryProductionHistory)],
    stock_returns:              [...ensureArray(data.stockReturns).filter(isAlive),
                                  ..._postCloseKeep(stockReturns, data.stockReturns)],
    payment_transactions:       [...ensureArray(data.paymentTransactions).filter(isAlive),
                                  ..._postCloseKeep(paymentTransactions, data.paymentTransactions)],
    payment_entities:           ensureArray(data.paymentEntities).filter(isAlive),
    expenses:                   [...ensureArray(data.expenses).filter(isAlive),
                                  ..._postCloseKeep(expenseRecords, data.expenses)],
  };

  const _dedupReplace = (arr) => {
    const map = new Map();
    ensureArray(arr).forEach(r => { if (r && r.id) map.set(String(r.id), r); });
    return Array.from(map.values());
  };
  for (const key of Object.keys(replaceData)) {
    replaceData[key] = _dedupReplace(replaceData[key]);
  }

  await sqliteStore.setBatch([
    ['mfg_pro_pkr',                replaceData.mfg_pro_pkr],
    ['noman_history',              replaceData.noman_history],
    ['customer_sales',             replaceData.customer_sales],
    ['rep_sales',                  replaceData.rep_sales],
    ['rep_customers',              replaceData.rep_customers],
    ['sales_customers',            replaceData.sales_customers],
    ['factory_inventory_data',     replaceData.factory_inventory_data],
    ['factory_production_history', replaceData.factory_production_history],
    ['stock_returns',              replaceData.stock_returns],
    ['payment_transactions',       replaceData.payment_transactions],
    ['payment_entities',           replaceData.payment_entities],
    ['expenses',                   replaceData.expenses],
  ]);

  try {
    const _restoreDeltaMap = {
      production:          replaceData.mfg_pro_pkr,
      sales:               replaceData.customer_sales,
      calculator_history:  replaceData.noman_history,
      rep_sales:           replaceData.rep_sales,
      rep_customers:       replaceData.rep_customers,
      sales_customers:     replaceData.sales_customers,
      inventory:           replaceData.factory_inventory_data,
      factory_history:     replaceData.factory_production_history,
      returns:             replaceData.stock_returns,
      transactions:        replaceData.payment_transactions,
      entities:            replaceData.payment_entities,
      expenses:            replaceData.expenses,
    };
    for (const [deltaName, records] of Object.entries(_restoreDeltaMap)) {
      if (typeof DeltaSync !== 'undefined') {
        DeltaSync.clearDirty(deltaName);
        await DeltaSync.setLastSyncTimestamp(deltaName);

        _mergedToTombstone.forEach(r => {
          DeltaSync.markUploaded(deltaName, r.id);
          DeltaSync.markDownloaded(deltaName, r.id);
        });

        ensureArray(records).forEach(r => {
          if (r && r.id) {
            DeltaSync.markUploaded(deltaName, r.id);
            DeltaSync.markDownloaded(deltaName, r.id);
          }
        });
      }
    }
  } catch(_dsErr) { console.warn('DeltaSync reset after restore failed:', _safeErr(_dsErr)); }

  try {
    if (typeof customerSales !== 'undefined' && Array.isArray(customerSales)) {
      customerSales.length = 0;
      replaceData.customer_sales.forEach(r => customerSales.push(r));
    }
    if (typeof repSales !== 'undefined' && Array.isArray(repSales)) {
      repSales.length = 0;
      replaceData.rep_sales.forEach(r => repSales.push(r));
    }
    if (typeof paymentTransactions !== 'undefined' && Array.isArray(paymentTransactions)) {
      paymentTransactions.length = 0;
      replaceData.payment_transactions.forEach(r => paymentTransactions.push(r));
    }
    if (typeof paymentEntities !== 'undefined' && Array.isArray(paymentEntities)) {
      paymentEntities.length = 0;
      replaceData.payment_entities.forEach(r => paymentEntities.push(r));
    }
    if (typeof expenseRecords !== 'undefined' && Array.isArray(expenseRecords)) {
      expenseRecords.length = 0;
      replaceData.expenses.forEach(r => expenseRecords.push(r));
    }
  } catch(_memErr) { console.warn('In-memory sync after restore failed:', _safeErr(_memErr)); }
  const settingsTimestamp = Date.now();
  if (data.factoryDefaultFormulas) { await sqliteStore.set('factory_default_formulas', data.factoryDefaultFormulas); await sqliteStore.set('factory_default_formulas_timestamp', settingsTimestamp); factoryDefaultFormulas = data.factoryDefaultFormulas; }
  if (data.factoryAdditionalCosts) { await sqliteStore.set('factory_additional_costs', data.factoryAdditionalCosts); await sqliteStore.set('factory_additional_costs_timestamp', settingsTimestamp); factoryAdditionalCosts = data.factoryAdditionalCosts; }
  if (data.factoryCostAdjustmentFactor) { await sqliteStore.set('factory_cost_adjustment_factor', data.factoryCostAdjustmentFactor); await sqliteStore.set('factory_cost_adjustment_factor_timestamp', settingsTimestamp); factoryCostAdjustmentFactor = data.factoryCostAdjustmentFactor; }
  if (data.factorySalePrices) { await sqliteStore.set('factory_sale_prices', data.factorySalePrices); await sqliteStore.set('factory_sale_prices_timestamp', settingsTimestamp); factorySalePrices = data.factorySalePrices; }
  if (data.factoryUnitTracking) { await sqliteStore.set('factory_unit_tracking', data.factoryUnitTracking); await sqliteStore.set('factory_unit_tracking_timestamp', settingsTimestamp); factoryUnitTracking = data.factoryUnitTracking; }
  try {
    const currentSettings = await sqliteStore.get('naswar_default_settings', {});
    const snap = (data._meta && data._meta.fyCloseSnapshot) || {};
    currentSettings.fyCloseCount       = snap.fyCloseCount       ?? Math.max(0, (currentSettings.fyCloseCount || 1) - 1);
    currentSettings.lastYearClosedAt   = snap.lastYearClosedAt   ?? null;
    currentSettings.lastYearClosedDate = snap.lastYearClosedDate ?? null;
    currentSettings.pendingFirestoreYearClose = false;
    pendingFirestoreYearClose = false;

    const _restoreMetaTs = Date.now();
    await sqliteStore.set('naswar_default_settings', currentSettings);
    await sqliteStore.set('naswar_default_settings_timestamp', _restoreMetaTs);
    await sqliteStore.set('pendingFirestoreYearClose', false);
    defaultSettings = currentSettings;
    if (firebaseDB && currentUser) {
      try {
        await firebaseDB.collection('users').doc(currentUser.uid)
          .collection('settings').doc('config')
          .set({
            naswar_default_settings: {
              fyCloseCount:      currentSettings.fyCloseCount,
              lastYearClosedAt:  currentSettings.lastYearClosedAt,
              lastYearClosedDate:currentSettings.lastYearClosedDate
            },

            naswar_default_settings_timestamp: _restoreMetaTs
          }, { merge: true });
        if (typeof DeltaSync !== 'undefined') await DeltaSync.setLastSyncTimestamp('settings');
      } catch(e) { console.warn('Cloud FY meta reversal failed:', _safeErr(e)); }
    }
  } catch(metaErr) { console.warn('Could not reverse FY metadata:', _safeErr(metaErr)); }
  if (firebaseDB && currentUser) {
    let _restoreCloudOk = false;
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
        } catch(colErr) { console.warn(`Cloud replace warning for ${colName}:`, _safeErr(colErr)); }
      }
      _restoreCloudOk = true;
      showToast(' Cloud data replaced with pre-close snapshot', 'success', 3000);
    } catch(cloudErr) {
      console.warn('Cloud replace failed:', _safeErr(cloudErr));
      pendingFirestoreRestore = true;
      await sqliteStore.set('pendingFirestoreRestore', true)
        .catch(e => console.warn('[ycRestore] Could not persist pendingFirestoreRestore:', _safeErr(e)));
      showToast('Local data reversed. Cloud sync failed — will retry automatically.', 'warning', 5000);
    }
    if (_restoreCloudOk) {
      try {
        const _restoreSigTs = Date.now();
        const _restoreDeviceId = (typeof getDeviceId === 'function') ? await getDeviceId().catch(() => 'unknown') : 'unknown';
        await firebaseDB.collection('users').doc(currentUser.uid)
          .collection('settings').doc('yearCloseSignal')
          .set({
            type:        'restore',
            triggeredAt: _restoreSigTs,
            triggeredBy: _restoreDeviceId,
          });
      } catch (_restoreSigErr) {
        console.warn('[ycRestore] Failed to write cross-device signal (non-fatal):', _safeErr(_restoreSigErr));
      }
    }
  } else {
    pendingFirestoreRestore = true;
    await sqliteStore.set('pendingFirestoreRestore', true)
      .catch(e => console.warn('[ycRestore] Could not persist pendingFirestoreRestore:', _safeErr(e)));
  }
  await loadAllData();
  try { syncFactoryProductionStats(); } catch(e) {}
  try { await invalidateAllCaches(); } catch(e) {}
  try { await refreshAllDisplays(); } catch(e) {}

  if (data.person_photos && typeof data.person_photos === 'object' && !Array.isArray(data.person_photos)) {
    try {
      const _ycExisting = (await sqliteStore.get('person_photos')) || {};
      const _ycBackup   = data.person_photos;
      const _ycMerged = Object.assign({}, _ycExisting, _ycBackup);
      await sqliteStore.set('person_photos', _ycMerged);

      const _ycExistingTs = (await sqliteStore.get('person_photos_timestamps')) || {};
      const _ycBackupTs   = (data.person_photos_timestamps && typeof data.person_photos_timestamps === 'object')
        ? data.person_photos_timestamps : {};
      const _ycNowMs = Date.now();
      const _ycMergedTs = Object.assign({}, _ycExistingTs);
      for (const _ycKey of Object.keys(_ycBackup)) {
        _ycMergedTs[_ycKey] = _ycBackupTs[_ycKey] || _ycNowMs;
      }
      await sqliteStore.set('person_photos_timestamps', _ycMergedTs);

      const _ycDirty = Object.keys(_ycBackup);
      if (_ycDirty.length > 0) {
        const _ycExistingDirty = (await sqliteStore.get('person_photos_dirty_keys')) || [];
        const _ycMergedDirty = Array.from(new Set([..._ycExistingDirty, ..._ycDirty]));
        await sqliteStore.set('person_photos_dirty_keys', _ycMergedDirty);
        await sqliteStore.set('person_photos_timestamp', _ycNowMs);
        if (typeof triggerAutoSync === 'function') { try { triggerAutoSync(); } catch(_) {} }
      }
    } catch(_ycPhErr) { console.warn('[ycRestore] person_photos restore error', _ycPhErr); }
  }
  const totalRecords = Object.values(replaceData).reduce((s, a) => s + a.length, 0);
  showToast(` Financial year close reversed! ${totalRecords} pre-close records restored.`, 'success', 6000);
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
const tabButtons = document.querySelectorAll('.sidebar-nav-btn');
tabButtons.forEach((btn) => {
const onclickVal = btn.getAttribute('onclick') || '';
btn.classList.toggle('active', onclickVal.includes("'" + tab + "'") || onclickVal.includes('"' + tab + '"'));
});
});
window.scrollTo({ top: 0, behavior: 'instant' });
const paymentSummarySection = document.getElementById('payment-summary-section');
const paymentHistorySection = document.getElementById('payment-history-section');
if (paymentSummarySection) {
paymentSummarySection.style.display = '';
paymentSummarySection.style.visibility = 'visible';
}
if (paymentHistorySection) {
paymentHistorySection.style.display = '';
paymentHistorySection.style.visibility = 'visible';
}
setTimeout(async () => {
try {
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
await new Promise(resolve => {
if (typeof window._lazyLoadFactory === 'function') {
window._lazyLoadFactory(resolve);
} else {
resolve();
}
});
await syncFactoryTab();
initFactoryTab();
},
'payments': async () => {
await syncPaymentsTab();
await refreshPaymentTab();
setTimeout(() => { if (typeof renderUnifiedTable === 'function') renderUnifiedTable(1); }, 150);
},
'rep': async () => {
await new Promise(resolve => {
if (typeof window._lazyLoadRep === 'function') {
window._lazyLoadRep(resolve);
} else {
resolve();
}
});
await syncRepTab();
handleRepTabUI();
}
};
if (tabLoaders[tab]) {
await tabLoaders[tab]();
}
notifyDataChange(tab);
} catch(e) {
if (e instanceof DOMException) return;
console.warn('[showTab] tab load error:', _safeErr(e));
}
}, 50);
}

function handleRepTabUI() {
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
if (newTransCard) newTransCard.style.display = 'block';
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

async function handleAdminRepDateChange(val) {
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
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

async function updateMfgCharts() {
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));

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
if (!mfgBarCanvas) { return; }
mfgBarChart = new SarimChart(mfgBarCanvas, {
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
if (!mfgPieCanvas) { return; }
mfgPieChart = new SarimChart(mfgPieCanvas, {
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
text: `Financials: ${fmtAmt(safeValue(totalValue))} Total - ${currentMfgMode === 'all' ? 'All Times' : currentMfgMode.charAt(0).toUpperCase() + currentMfgMode.slice(1)}`,
color: colors.text,
font: { size: 13, weight: 'bold' }
}
}
}
});
}

async function getWeightPerUnit(storeType) {
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
const factoryCostAdjustmentFactor = (await sqliteStore.get('factory_cost_adjustment_factor')) || {};
const formula = factoryDefaultFormulas[storeType];
if (!formula || formula.length === 0) return 0;
let totalWeight = 0;
formula.forEach(item => {
totalWeight += item.quantity;
});
return totalWeight;
}

async function getPreviousDayAvailableUnits(storeType, currentDate) {
const factoryProductionHistory = ensureArray(await sqliteStore.get('factory_production_history'));
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
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
const prevPrevAvailable = await getPreviousDayAvailableUnits(storeType, previousDate);
return Math.max(0, prevPrevAvailable + prevProduced - prevUsed);
}
return 0;
}

async function updateFactoryUnitsAvailableStats() {
const factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
const factoryProductionHistory = ensureArray(await sqliteStore.get('factory_production_history'));
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const stores = typeof getAppStores === 'function' ? await getAppStores() : [];
const storeFormulaMap = {};
for (const s of stores) {
storeFormulaMap[s.key] = s.formulaType || 'standard';
}
const stdTracking = factoryUnitTracking.standard || { produced: 0, consumed: 0, available: 0 };
const asaanTracking = factoryUnitTracking.asaan || { produced: 0, consumed: 0, available: 0 };
const stdProducedUnits = stdTracking.produced;
const stdUsedUnits = stdTracking.consumed;
const stdAvailableUnits = stdTracking.available;
const asaanProducedUnits = asaanTracking.produced;
const asaanUsedUnits = asaanTracking.consumed;
const asaanAvailableUnits = asaanTracking.available;
const stdProductionData = db.filter(item => {
const ft = item.formulaStore || storeFormulaMap[item.store] || (item.store === 'STORE_C' ? 'asaan' : 'standard');
return ft === 'standard' && item.isReturn !== true;
});
const asaanProductionData = db.filter(item => {
const ft = item.formulaStore || storeFormulaMap[item.store] || (item.store === 'STORE_C' ? 'asaan' : 'standard');
return ft === 'asaan' && item.isReturn !== true;
});
const stdOutputQuantity = stdProductionData.reduce((sum, item) => sum + (item.net || 0), 0);
const stdTotalCost = stdProductionData.reduce((sum, item) => sum + (item.totalCost || 0), 0);
const stdTotalSaleValue = stdProductionData.reduce((sum, item) => sum + (item.totalSale || 0), 0);
const stdTotalProfit = stdProductionData.reduce((sum, item) => sum + (item.profit || 0), 0);
const stdCostPerUnit = await getCostPerUnit('standard');
const stdTotalCostValue = stdCostPerUnit * stdAvailableUnits;
const stdProfitPerKg = stdOutputQuantity > 0 ? stdTotalProfit / stdOutputQuantity : 0;
const stdWeightPerUnit = await getWeightPerUnit('standard');
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
const asaanOutputQuantity = asaanProductionData.reduce((sum, item) => sum + (item.net || 0), 0);
const asaanTotalCost = asaanProductionData.reduce((sum, item) => sum + (item.totalCost || 0), 0);
const asaanTotalSaleValue = asaanProductionData.reduce((sum, item) => sum + (item.totalSale || 0), 0);
const asaanTotalProfit = asaanProductionData.reduce((sum, item) => sum + (item.profit || 0), 0);
const asaanCostPerUnit = await getCostPerUnit('asaan');
const asaanTotalCostValue = asaanCostPerUnit * asaanAvailableUnits;
const asaanProfitPerKg = asaanOutputQuantity > 0 ? asaanTotalProfit / asaanOutputQuantity : 0;
const asaanWeightPerUnit = await getWeightPerUnit('asaan');
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
const factoryProductionHistory = ensureArray(await sqliteStore.get('factory_production_history'));
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
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
const rawByMaterial = {};
db.forEach(async entry => {
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
const weightPerUnit = await getWeightPerUnit(formulaStore);
totalRawUsed += weightPerUnit * units;

const formula = factoryDefaultFormulas[formulaStore] || [];
formula.forEach(f => {
  const matId = f.id || f.name || 'Unknown';
  const inv = factoryInventoryData.find(i => String(i.id) === String(f.id)) ||
               (f.name ? factoryInventoryData.find(i => i.name && i.name.trim().toLowerCase() === f.name.trim().toLowerCase()) : null);
  const matName = inv?.name || f.name || 'Unknown';
  const qtyUsed = f.quantity * units;
  const unitCost = inv ? inv.cost : (f.cost || 0);
  const matCost = unitCost * qtyUsed;
  if (!rawByMaterial[matName]) rawByMaterial[matName] = { qty: 0, cost: 0 };
  rawByMaterial[matName].qty += qtyUsed;
  rawByMaterial[matName].cost += matCost;
});
});
const totalConsumed = stdConsumed + asaanConsumed;
const stdCostPerUnit = await getCostPerUnit('standard');
const asaanCostPerUnit = await getCostPerUnit('asaan');
const avgCostPerUnit = totalConsumed > 0
? (stdConsumed * stdCostPerUnit + asaanConsumed * asaanCostPerUnit) / totalConsumed
: 0;
const totalMatValue = totalRawMatCost;
const avgProfitPerKg = totalOutput > 0 ? totalProfit / totalOutput : 0;
let totalAdditionalCostProd = 0;
factoryProductionHistory.forEach(entry => {
  if (!isInRange(entry.date)) return;
  const units = entry.units || 0;
  const addCostPerUnit = factoryAdditionalCosts[entry.store] || 0;
  totalAdditionalCostProd += addCostPerUnit * units;
});
let periodDays = 1;
if (mode === 'daily') { periodDays = 1; }
else if (mode === 'weekly') { periodDays = 7; }
else if (mode === 'monthly') { periodDays = new Date(selectedYear, selectedMonth + 1, 0).getDate(); }
else if (mode === 'yearly') { periodDays = (new Date(selectedYear, 1, 29).getMonth() === 1) ? 366 : 365; }
else {
  const allDates = factoryProductionHistory.map(e => e.date).filter(Boolean);
  if (allDates.length > 1) {
    const minD = new Date(Math.min(...allDates.map(d => new Date(d))));
    const maxD = new Date(Math.max(...allDates.map(d => new Date(d))));
    periodDays = Math.max(1, Math.round((maxD - minD) / 86400000) + 1);
  } else { periodDays = 1; }
}
const avgAdditionalCostPerDay = totalAdditionalCostProd > 0 ? totalAdditionalCostProd / periodDays : 0;
const _setSum = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
_setSum('factorySumUnits', safeNumber(totalAvailable, 0).toFixed(2));
_setSum('factorySumUsedUnits', safeNumber(totalConsumed, 0).toFixed(2));
_setSum('factorySumCostPerDay', await formatCurrency(avgAdditionalCostPerDay));
_setSum('factorySumUnitCost', await formatCurrency(avgCostPerUnit));
_setSum('factorySumTotalCost', await formatCurrency(totalCost));
_setSum('factorySumOutput', safeNumber(totalOutput, 0).toFixed(2) + ' kg');
_setSum('factorySumRawUsed', safeNumber(totalRawUsed, 0).toFixed(2) + ' kg');

const _rawBreakdownEl = document.getElementById('factorySumRawBreakdown');
if (_rawBreakdownEl) {
  const _rawEntries = Object.entries(rawByMaterial).sort((a, b) => b[1].qty - a[1].qty);
  if (_rawEntries.length > 0) {
    const _bId = 'perf-sum-raw-breakdown';
    const _rowsHtml = _rawEntries.map(([name, data]) => `
<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--glass-border);">
<span style="font-size:0.72rem;color:var(--text-main);font-weight:500;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(name)}</span>
<span style="display:flex;gap:10px;align-items:center;">
<span style="font-size:0.7rem;color:var(--text-muted);">${safeNumber(data.qty,0).toFixed(2)} kg</span>
<span class="cost-val" style="font-size:0.72rem;min-width:60px;text-align:right;">${fmtAmt(data.cost)}</span>
</span>
</div>`).join('');
    _rawBreakdownEl.innerHTML = `
<div style="margin-top:8px;">
<button onclick="(function(el){var p=document.getElementById('${_bId}');var open=p.style.display!=='none';p.style.display=open?'none':'block';el.querySelector('span').textContent=open?'\u25b6':'\u25bc';})(this)"
style="display:flex;align-items:center;gap:5px;background:none;border:none;cursor:pointer;padding:4px 0;width:100%;">
<span style="font-size:0.68rem;color:var(--accent);">&#x25b6;</span>
<span style="font-size:0.68rem;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:0.05em;">Materials Breakdown</span>
</button>
<div id="${_bId}" style="display:none;background:var(--glass-raised);border-radius:10px;padding:8px 10px;margin-top:4px;border:1px solid var(--glass-border);">
<div style="display:flex;justify-content:space-between;padding-bottom:5px;margin-bottom:2px;">
<span style="font-size:0.62rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;">Material</span>
<span style="display:flex;gap:10px;">
<span style="font-size:0.62rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;">Qty Used</span>
<span style="font-size:0.62rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;min-width:60px;text-align:right;">Cost</span>
</span>
</div>
${_rowsHtml}
</div>
</div>`;
  } else {
    _rawBreakdownEl.innerHTML = '';
  }
}
_setSum('factorySumMatVal', await formatCurrency(totalMatValue));
_setSum('factorySumProfit', await formatCurrency(totalProfit));
_setSum('factorySumProfitUnit', await formatCurrency(avgProfitPerKg) + '/kg');
}

async function getInitialAvailableForRange(storeType, mode, endDate) {
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
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
const _rftBatch = await sqliteStore.getBatch([
'factory_inventory_data','factory_production_history',
'factory_default_formulas','factory_additional_costs',
'factory_sale_prices','factory_cost_adjustment_factor','factory_unit_tracking',
]);
const factoryInventoryData = ensureArray(_rftBatch.get('factory_inventory_data'));
const factoryProductionHistory = ensureArray(_rftBatch.get('factory_production_history'));
const factoryDefaultFormulas = _rftBatch.get('factory_default_formulas') || {};
const factoryAdditionalCosts = _rftBatch.get('factory_additional_costs') || {};
const factorySalePrices = _rftBatch.get('factory_sale_prices') || {};
const factoryCostAdjustmentFactor = _rftBatch.get('factory_cost_adjustment_factor') || {};
const factoryUnitTracking = _rftBatch.get('factory_unit_tracking') || {};
if (sqliteStore && sqliteStore.getBatch) {
try {
const factoryKeys = [
'factory_inventory_data',
'factory_production_history',
'factory_unit_tracking',
'factory_default_formulas'
];
const factoryDataMap = await sqliteStore.getBatch(factoryKeys);
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
await sqliteStore.set('factory_inventory_data', freshInventory);
}
}
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
await sqliteStore.set('factory_production_history', freshHistory);
}
freshHistory.sort((a, b) => compareTimestamps(getRecordTimestamp(b), getRecordTimestamp(a)));
}
}
if (factoryDataMap.get('factory_unit_tracking')) {
const factoryUnitTracking = factoryDataMap.get('factory_unit_tracking') || {
standard: { produced: 0, used: 0, returned: 0 },
asaan: { produced: 0, used: 0, returned: 0 }
};
}
if (factoryDataMap.get('factory_default_formulas')) {
const factoryDefaultFormulas = factoryDataMap.get('factory_default_formulas') || { standard: [], asaan: [] };
}
} catch (error) {
console.warn('[initFactoryTab] data load failed:', _safeErr(error));
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
await renderFactoryInventory();
calculateFactoryProduction();
}

async function updateAllTabsWithFactoryCosts() {
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
const factoryCostAdjustmentFactor = (await sqliteStore.get('factory_cost_adjustment_factor')) || {};
const factorySalePrices = (await sqliteStore.get('factory_sale_prices')) || {};
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
currentFactoryEntryStore = 'STORE_A';
const formulaSelector = document.getElementById('factory-formula-selector');
if (formulaSelector) {
formulaSelector.querySelectorAll('.factory-store-opt').forEach((opt, i) => {
if (i === 0) opt.classList.add('active');
else opt.classList.remove('active');
});
}
document.querySelectorAll('#tab-factory .toggle-group .toggle-opt').forEach((opt, index) => {
if (index === 0) opt.classList.add('active');
else opt.classList.remove('active');
});
refreshFactoryTab();
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

async function updateAllStoresOverview(mode = 'day') {
const salesHistory = ensureArray(await sqliteStore.get('noman_history'));
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
currentOverviewMode = mode;
const selectedDate = document.getElementById('sys-date').value;
const selectedDateObj = new Date(selectedDate);
const selectedYear = selectedDateObj.getFullYear();
const selectedMonth = selectedDateObj.getMonth();
const _appStoresOv = await getAppStores();
const stores = _appStoresOv.map(s => s.key);
const storeNames = _appStoresOv.map(s => s.name);
const storeColors = _appStoresOv.map((s,i) => ['store-a','store-b','store-c','store-d','store-e'][i] || 'store-a');
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
const allStoresSoldByCustomer = {};
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
const soldByCustomer = {};
customerSales.forEach(sale => {
const saleDate = new Date(sale.supplyDate || sale.date);
const saleYear = saleDate.getFullYear();
const saleMonth = saleDate.getMonth();
const saleDateStr = sale.supplyDate || sale.date;
let includeSale = false;
if (mode === 'day' && saleDateStr === selectedDate) includeSale = true;
else if (mode === 'week') {
const weekStart = new Date(selectedDateObj);
weekStart.setDate(selectedDateObj.getDate() - 6);
if (saleDate >= weekStart && saleDate <= selectedDateObj) includeSale = true;
}
else if (mode === 'month' && saleYear === selectedYear && saleMonth === selectedMonth) includeSale = true;
else if (mode === 'year' && saleYear === selectedYear) includeSale = true;
else if (mode === 'all') includeSale = true;
if (includeSale && sale.supplyStore === store) {
const qty = sale.quantity || 0;
soldQty += qty;
const custName = sale.customerName || 'Unknown';
soldByCustomer[custName] = (soldByCustomer[custName] || 0) + qty;
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
Object.entries(soldByCustomer).forEach(([cust, qty]) => { allStoresSoldByCustomer[cust] = (allStoresSoldByCustomer[cust] || 0) + qty; });
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

let soldBreakdownHtml = '';
const soldBreakdownEntries = Object.entries(soldByCustomer).sort((a, b) => b[1] - a[1]);
if (soldBreakdownEntries.length > 0) {
const soldBreakdownId = `sold-breakdown-${store}-${index}`;
const soldRowsHtml = soldBreakdownEntries.map(([cust, qty]) => `
<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid var(--glass-border);">
<span style="font-size:0.7rem;color:var(--text-main);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(cust)}</span>
<span style="font-size:0.7rem;font-weight:700;color:var(--cost-val, #f59e0b);white-space:nowrap;margin-left:8px;">${safeValue(qty).toFixed(2)} kg</span>
</div>`).join('');
soldBreakdownHtml = `
<div style="margin-top:4px;">
<button onclick="(function(el){var p=document.getElementById('${soldBreakdownId}');var open=p.style.display!=='none';p.style.display=open?'none':'block';el.querySelector('span').textContent=open?'▶':'▼';})(this)"
style="display:flex;align-items:center;gap:5px;background:none;border:none;cursor:pointer;padding:4px 0;width:100%;">
<span style="font-size:0.68rem;color:var(--accent);">▶</span>
<span style="font-size:0.68rem;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:0.05em;">Sold Breakdown</span>
</button>
<div id="${soldBreakdownId}" style="display:none;background:var(--glass-raised);border-radius:10px;padding:8px 10px;margin-top:4px;border:1px solid var(--glass-border);">
<div style="display:flex;justify-content:space-between;padding-bottom:5px;margin-bottom:2px;">
<span style="font-size:0.62rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;">Customer</span>
<span style="font-size:0.62rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;min-width:60px;text-align:right;">Qty Sold</span>
</div>
${soldRowsHtml}
</div>
</div>`;
}
const card = document.createElement('div');
card.className = `overview-card liquid-card`;
card.innerHTML = `
<span class="store-badge ${storeColors[index]}">${esc(storeNames[index])}</span>
<h4>${esc(storeNames[index])} (${mode === 'all' ? 'All Times' : mode.charAt(0).toUpperCase() + mode.slice(1)})</h4>
<p><span>Produced:</span> <span class="qty-val" style="color:var(--text-main);">${safeValue(storeData.production).toFixed(2)} kg</span></p>
${returnsHtml}
<p><span>Sold (Sales Tab):</span> <span class="cost-val">${safeValue(soldQty).toFixed(2)} kg</span></p>
${soldBreakdownHtml}
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

let combinedSoldBreakdownHtml = '';
const combinedSoldEntries = Object.entries(allStoresSoldByCustomer).sort((a, b) => b[1] - a[1]);
if (combinedSoldEntries.length > 0) {
const combinedSoldBreakdownId = `sold-breakdown-combined`;
const combinedSoldRowsHtml = combinedSoldEntries.map(([cust, qty]) => `
<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid var(--glass-border);">
<span style="font-size:0.7rem;color:var(--text-main);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(cust)}</span>
<span style="font-size:0.7rem;font-weight:700;color:var(--cost-val, #f59e0b);white-space:nowrap;margin-left:8px;">${safeValue(qty).toFixed(2)} kg</span>
</div>`).join('');
combinedSoldBreakdownHtml = `
<div style="margin-top:4px;">
<button onclick="(function(el){var p=document.getElementById('${combinedSoldBreakdownId}');var open=p.style.display!=='none';p.style.display=open?'none':'block';el.querySelector('span').textContent=open?'▶':'▼';})(this)"
style="display:flex;align-items:center;gap:5px;background:none;border:none;cursor:pointer;padding:4px 0;width:100%;">
<span style="font-size:0.68rem;color:var(--accent);">▶</span>
<span style="font-size:0.68rem;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:0.05em;">Sold Breakdown</span>
</button>
<div id="${combinedSoldBreakdownId}" style="display:none;background:var(--glass-raised);border-radius:10px;padding:8px 10px;margin-top:4px;border:1px solid var(--glass-border);">
<div style="display:flex;justify-content:space-between;padding-bottom:5px;margin-bottom:2px;">
<span style="font-size:0.62rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;">Customer</span>
<span style="font-size:0.62rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;min-width:60px;text-align:right;">Qty Sold</span>
</div>
${combinedSoldRowsHtml}
</div>
</div>`;
}
const combinedCard = document.createElement('div');
combinedCard.className = `overview-card liquid-card highlight-card`;
combinedCard.innerHTML = `
<h4 style="color: var(--accent);">Total Combined</h4>
<p><span>Fresh Production:</span> <span class="qty-val">${safeValue(totalCombined.production).toFixed(2)} kg</span></p>
${totalCombined.returns > 0 ? `<p><span>Total Returns:</span> <span style="color:#10b981; font-weight:800;">${safeValue(totalCombined.returns).toFixed(2)} kg</span></p>` : ''}
<p><span>Total Sold:</span> <span class="cost-val">${safeValue(totalCombined.sold).toFixed(2)} kg</span></p>
${combinedSoldBreakdownHtml}
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

async function updateCustomerCharts() {
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));

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
if (!custSalesCanvas) { return; }
custSalesChart = new SarimChart(custSalesCanvas, {
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
if (!custPaymentCanvas) { return; }
custPaymentChart = new SarimChart(custPaymentCanvas, {
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
text: `Total: ${fmtAmt(safeValue(totalCash + totalCredit))} - ${currentCustomerChartMode === 'all' ? 'All Times' : currentCustomerChartMode.charAt(0).toUpperCase() + currentCustomerChartMode.slice(1)}`,
color: colors.text,
font: { size: 13, weight: 'bold' }
}
}
}
});
}

async function refreshCustomerSales(page = 1, force = false) {
const deletedRecordIds = new Set(ensureArray(await sqliteStore.get('deleted_records')));
const _rcsAlive = (item) => item && item.id && !deletedRecordIds.has(String(item.id));
const customerSales = ensureArray(await sqliteStore.get('customer_sales')).filter(_rcsAlive);
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers')).filter(_rcsAlive);
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr')).filter(_rcsAlive);
const stockReturns = ensureArray(await sqliteStore.get('stock_returns')).filter(_rcsAlive);
const selectedDate = document.getElementById('cust-date').value;
if (!selectedDate) return;
if (sqliteStore && sqliteStore.get) {
try {
let freshSales = await sqliteStore.get('customer_sales', []);
if (force && firebaseDB && currentUser &&
!window._firestoreNetworkDisabled && navigator.onLine) {
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
await sqliteStore.set('customer_sales', freshSales);
}
} catch (firestoreError) {
console.warn('[refreshCustomerSales] cloud fetch failed:', _safeErr(firestoreError));
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
if (!record.currentRepProfile && (!record.salesRep || record.salesRep === 'NONE' || record.salesRep === 'ADMIN')) {
record.currentRepProfile = 'admin';
fixedCount++;
}
return record;
});
if (fixedCount > 0) {
await sqliteStore.set('customer_sales', freshSales);
}
}
} catch (error) {
console.warn('[refreshCustomerSales] data integrity fix failed:', _safeErr(error));
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
const aEff = a.supplyDate || a.date;
const bEff = b.supplyDate || b.date;
if (aEff === selectedDate && bEff !== selectedDate) return -1;
if (aEff !== selectedDate && bEff === selectedDate) return 1;
return compareTimestamps(getRecordTimestamp(b), getRecordTimestamp(a));
});
sortedSales.forEach(item => {
const isRepLinked = item.salesRep && item.salesRep !== 'NONE';
const isAdminCollection = !isRepLinked && item.paymentType === 'COLLECTION' && item.currentRepProfile === 'admin';
const isOldDebt = item.transactionType === 'OLD_DEBT';
if (!isRepLinked && !isAdminCollection && !isOldDebt && (item.paymentType === 'PARTIAL_PAYMENT' ||
item.paymentType === 'COLLECTION')) return;
if (isRepLinked && item.paymentType === 'PARTIAL_PAYMENT') return;
const effDateStr = item.supplyDate || item.date;
const rowDate = new Date(effDateStr);
const rowYear = rowDate.getFullYear();
const rowMonth = rowDate.getMonth();
const updatePeriod = (period) => {
if (isAdminCollection) {
period.cash += (item.totalValue || 0);
return;
}
if (isOldDebt) {
period.credit += (item.totalValue || 0);
return;
}
period.q += (item.quantity || 0);
period.v += (item.totalValue || 0);
period.profit += (item.profit || 0);
if (item.isMerged && item.mergedSummary) {
const ms = item.mergedSummary;
period.cash += (ms.cashSales || 0);
period.credit += (ms.unpaidCredit || 0);
} else if (isRepLinked) {
if (item.paymentType === 'CREDIT' && !item.creditReceived) {
const partialPaid = item.partialPaymentReceived || 0;
period.credit += (item.totalValue || 0) - partialPaid;
}
} else if (item.paymentType === 'CREDIT' && !item.creditReceived) {
period.credit += (item.totalValue || 0);
} else if (item.paymentType === 'CASH' || item.creditReceived) {
period.cash += (item.totalValue || 0);
}
};
if (effDateStr === selectedDate) updatePeriod(stats.day);
if (rowDate >= weekStart && rowDate <= selectedDateObj) updatePeriod(stats.week);
if (rowYear === selectedYear && rowMonth === selectedMonth) updatePeriod(stats.month);
if (rowYear === selectedYear) updatePeriod(stats.year);
updatePeriod(stats.all);
});
const displayData = sortedSales.filter(item => {
const _isRepLinked = item.salesRep && item.salesRep !== 'NONE';
const _isAdminColl = !_isRepLinked && item.paymentType === 'COLLECTION' && item.currentRepProfile === 'admin';
if (_isAdminColl) return true;
if (_isRepLinked && (item.paymentType === 'COLLECTION' || item.paymentType === 'PARTIAL_PAYMENT')) return true;
return item.paymentType !== 'PARTIAL_PAYMENT' && item.paymentType !== 'COLLECTION';
});
const totalItems = displayData.length;
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
displayData.forEach(async item => {
const effDate = item.date;
const isSelected = effDate === selectedDate;
const highlightClass = isSelected ? 'highlight-card' : '';
const dateDisplay = isSelected
? `${formatDisplayDateTime(item.date, item.time)} (Selected)`
: formatDisplayDateTime(item.date, item.time);
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
repBadge = `<span class="sales-rep-badge"> ${esc(item.salesRep.split(' ')[0])}</span>`;
}
let mergedBadge = '';
if (item.isMerged) {
mergedBadge = _mergedBadgeHtml(item, {inline:true});
}
const card = document.createElement('div');
card.className = `card liquid-card ${highlightClass}${item.isSettled ? ' is-settled-record' : ''}`.trim();
const _cardDate = item.supplyDate || item.date;
if (_cardDate) card.setAttribute('data-date', _cardDate);
let creditSection = '';
if (!isOldDebtItem) {
if (paymentType === 'CREDIT' && !creditReceived) {
creditSection = `
<div class="credit-checkbox-container" style="cursor:default;pointer-events:none;opacity:0.7;">
<input type="checkbox" class="credit-checkbox" disabled>
<label class="credit-checkbox-label">Mark as Received</label>
</div>
`;
} else if (paymentType === 'CREDIT' && creditReceived) {
creditSection = `<div class="received-indicator">Credit Received </div>`;
}
}
const deleteBtnHtml = item.isMerged ? '' : item.isSettled ? `<div class="settled-badge"> Settled</div>` : `<button class="tbl-action-btn danger u-w-full u-mt-8" onclick="(async () => { await deleteCustomerSale('${esc(item.id)}') })()">Delete</button>`;
const supplyDateLine = (item.supplyDate && item.supplyDate !== item.date)
? `<p style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;font-style:italic;">Supply Date: ${esc(formatDisplayDate(item.supplyDate))}</p>`
: '';
if (isOldDebtItem) {
card.innerHTML = `
<div class="payment-badge credit">CREDIT</div>
<div class="customer-name" style="margin-top: 12px;">${esc(item.customerName)}
<span class="old-debt-badge">OLD DEBT</span>${item.isMerged ? _mergedBadgeHtml(item, {inline:true}) : ''}${(typeof _creatorBadgeHtml === 'function') ? _creatorBadgeHtml(item) : ''}
</div>
<h4 style="margin-top: 5px; font-size: 0.75rem; font-weight:400; color: var(--text-muted);" class="u-fs-sm2 u-text-muted">${dateDisplay}</h4>
${supplyDateLine}
<hr>
<p><span>Previous Balance:</span> <span class="rev-val">${fmtAmt(safeValue(item.totalValue))}</span></p>
<p class="u-fs-sm u-text-muted" >${esc(item.notes || 'Brought forward from previous records')}</p>
${deleteBtnHtml}
`;
} else if (isAdminCollItem) {
card.innerHTML = `
<div class="payment-badge collection">COLLECTION</div>
<div class="customer-name" style="margin-top:12px;">${esc(item.customerName)} ${mergedBadge}</div>
<div style="display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin-top:5px;margin-bottom:2px;">
<span class="u-fs-sm2 u-text-muted">${dateDisplay}</span>
${(typeof _creatorBadgeHtml === 'function') ? _creatorBadgeHtml(item) : ''}
</div>
${supplyDateLine}
<hr>
<p><span>Amount Collected:</span> <span class="profit-val">${fmtAmt(safeValue(item.totalValue))}</span></p>
${deleteBtnHtml}
`;
} else {
card.innerHTML = `
<div class="payment-badge ${badgeClass}">${esc(badgeText)}</div>
<div class="customer-name" style="margin-top: 12px;">${esc(item.customerName)} ${repBadge} ${mergedBadge}</div>
<div style="display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin-top:5px;margin-bottom:2px;">
<span class="u-fs-sm2 u-text-muted">${dateDisplay}</span>
${(typeof _creatorBadgeHtml === 'function') ? _creatorBadgeHtml(item) : ''}
</div>
${supplyDateLine}
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
