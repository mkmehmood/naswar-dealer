async function getCostPerUnit(storeType) {
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
const formula = factoryDefaultFormulas[storeType];
const additionalCost = factoryAdditionalCosts[storeType] || 0;
if (formula && formula.length > 0) {
let totalMaterialCost = 0;
formula.forEach(item => {
const liveItem = Array.isArray(factoryInventoryData) ? factoryInventoryData.find(i => String(i.id) === String(item.id)) : null;
const unitCost = liveItem ? (liveItem.cost || item.cost || 0) : (item.cost || 0);
totalMaterialCost += unitCost * (item.quantity || 0);
});
return totalMaterialCost + additionalCost;
}
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

async function calculateFactoryInventoryValue() {
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
let totalValue = 0;
if (factoryInventoryData && factoryInventoryData.length > 0) {
factoryInventoryData.forEach(item => { totalValue += (item.quantity * item.cost) || 0; });
}
const stdTracking = factoryUnitTracking?.standard || { available: 0 };
const asaanTracking = factoryUnitTracking?.asaan || { available: 0 };
const stdCostPerUnit = getCostPerUnit('standard');
const asaanCostPerUnit = getCostPerUnit('asaan');
totalValue += (stdTracking.available * stdCostPerUnit);
totalValue += (asaanTracking.available * asaanCostPerUnit);
return totalValue;
}

async function updateFactoryInventoryDisplay() {
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
let rawMaterialsValue = 0;
if (factoryInventoryData && factoryInventoryData.length > 0) {
factoryInventoryData.forEach(item => { rawMaterialsValue += (item.quantity * item.cost) || 0; });
}
const stdTracking = factoryUnitTracking?.standard || { available: 0 };
const asaanTracking = factoryUnitTracking?.asaan || { available: 0 };
const stdCostPerUnit = getCostPerUnit('standard');
const asaanCostPerUnit = getCostPerUnit('asaan');
const formulaUnitsValue = (stdTracking.available * stdCostPerUnit) + (asaanTracking.available * asaanCostPerUnit);
const rawMaterialsEl = document.getElementById('formulaRawMaterials');
const unitsValueEl = document.getElementById('formulaUnitsValue');
if (rawMaterialsEl) rawMaterialsEl.textContent = `${fmtAmt(safeValue(rawMaterialsValue))}`;
if (unitsValueEl) unitsValueEl.textContent = `${fmtAmt(safeValue(formulaUnitsValue))}`;
}

async function calculatePaymentSummaries() {
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
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
let factoryDefaultFormulas = { standard: [], asaan: [] };
let factoryAdditionalCosts = { standard: 0, asaan: 0 };
let factoryCostAdjustmentFactor = { standard: 1, asaan: 1 };
let factorySalePrices = { standard: 0, asaan: 0 };
let factoryUnitTracking = { standard: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] }, asaan: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] } };
try {
const [loadedFormulas, loadedCosts, loadedFactor, loadedPrices, loadedTracking] = await Promise.all([
sqliteStore.get('factory_default_formulas'),
sqliteStore.get('factory_additional_costs'),
sqliteStore.get('factory_cost_adjustment_factor'),
sqliteStore.get('factory_sale_prices'),
sqliteStore.get('factory_unit_tracking')
]);
if (loadedFormulas && 'standard' in loadedFormulas && 'asaan' in loadedFormulas) factoryDefaultFormulas = loadedFormulas;
if (loadedCosts && 'standard' in loadedCosts && 'asaan' in loadedCosts) factoryAdditionalCosts = loadedCosts;
if (loadedFactor && 'standard' in loadedFactor && 'asaan' in loadedFactor) factoryCostAdjustmentFactor = loadedFactor;
if (loadedPrices && 'standard' in loadedPrices && 'asaan' in loadedPrices) factorySalePrices = loadedPrices;
if (loadedTracking && 'standard' in loadedTracking && 'asaan' in loadedTracking) factoryUnitTracking = loadedTracking;
} catch (error) {
showToast('Error loading factory settings. Using defaults.', 'warning');
}
requestAnimationFrame(() => {
document.body.style.overflow = 'hidden';
document.documentElement.style.overflow = 'hidden';
requestAnimationFrame(() => {
document.body.style.overflow = 'hidden';
document.documentElement.style.overflow = 'hidden';
const _fsOv = document.getElementById('factorySettingsOverlay');
if (_fsOv) _fsOv.style.display = 'flex';
});
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
if (el) el.classList.add('active');
const container = document.getElementById('factoryRawMaterialsContainer');
if (container) container.style.opacity = '0.35';
renderFactorySettingsRows().then(() => {
requestAnimationFrame(() => { if (container) container.style.opacity = '1'; });
});
}

async function refreshFactorySettingsOverlay() {
const overlay = document.getElementById('factorySettingsOverlay');
if (overlay && overlay.style.display === 'flex') {
const container = document.getElementById('factoryRawMaterialsContainer');
const liveRows = container ? Array.from(container.querySelectorAll('.factory-formula-grid')) : [];
const liveState = liveRows.map(row => ({
id: row.querySelector('.factory-mat-select')?.value || '',
qty: row.querySelector('.factory-mat-qty')?.value || ''
}));
const hasUnsavedWork = liveState.some(r => r.id !== '');
await renderFactorySettingsRows();
if (hasUnsavedWork) {
const newRows = container ? Array.from(container.querySelectorAll('.factory-formula-grid')) : [];
liveState.forEach((state, idx) => {
if (!state.id) return;
const row = newRows[idx];
if (!row) return;
const sel = row.querySelector('.factory-mat-select');
const qty = row.querySelector('.factory-mat-qty');
if (sel && state.id) { sel.value = state.id; updateFactoryRowCost(sel); }
if (qty && state.qty) qty.value = state.qty;
});
}
}
}

async function renderFactorySettingsRows() {
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
const factoryCostAdjustmentFactor = (await sqliteStore.get('factory_cost_adjustment_factor')) || {};
const factorySalePrices = (await sqliteStore.get('factory_sale_prices')) || {};
const factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const container = document.getElementById('factoryRawMaterialsContainer');
if (!factoryDefaultFormulas[currentFactorySettingsStore]) factoryDefaultFormulas[currentFactorySettingsStore] = [];
let totalRawCost = 0, totalWeight = 0;
container.replaceChildren();
const safeFormula = factoryDefaultFormulas[currentFactorySettingsStore] || [];
if (safeFormula.length > 0) {
for (const ing of safeFormula) {
totalRawCost += (ing.cost * ing.quantity);
totalWeight += ing.quantity;
await createFactorySettingRow(container, ing.id, ing.quantity, ing.cost, ing.name, factoryInventoryData);
}
}
const available = factoryUnitTracking[currentFactorySettingsStore]?.available || 0;
const additionalCost = factoryAdditionalCosts[currentFactorySettingsStore] || 0;
document.getElementById('additional-cost-per-unit').value = additionalCost;
const adjustmentFactor = factoryCostAdjustmentFactor[currentFactorySettingsStore] || 1;
document.getElementById('cost-adjustment-factor').value = adjustmentFactor;
document.getElementById('sale-price-standard').value = factorySalePrices.standard || 0;
document.getElementById('sale-price-asaan').value = factorySalePrices.asaan || 0;
const perUnitCost = totalRawCost + additionalCost;
const salesCostPerKg = adjustmentFactor > 0 ? perUnitCost / adjustmentFactor : perUnitCost;
const safeTotalWeight = parseFloat(totalWeight) || 0;
const _setFS1 = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
_setFS1('factorySettingsUnitWeight', safeNumber(safeTotalWeight, 0).toFixed(2) + ' kg');
_setFS1('factorySettingsRawCostPerUnit', await formatCurrency(totalRawCost));
_setFS1('factorySettingsPerUnit', await formatCurrency(perUnitCost));
_setFS1('factorySettingsAvailableUnits', available);
_setFS1('factorySettingsSalesCostPerKg', await formatCurrency(salesCostPerKg));
}

async function createFactorySettingRow(container, selectedId = '', qtyVal = '', costVal = null, savedName = '', inventoryData = null) {
const factoryInventoryData = inventoryData !== null ? inventoryData : ensureArray(await sqliteStore.get('factory_inventory_data'));
let currentCost = costVal !== null ? costVal : 0;
const div = document.createElement('div');
div.className = 'factory-formula-grid';
const col1 = document.createElement('div'); col1.className = 'u-flex-col';
const lbl1 = document.createElement('label');
lbl1.style.cssText = 'font-size:0.6rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;';
lbl1.textContent = 'Material';
const sel = document.createElement('select');
sel.className = 'factory-mat-select';
sel.onchange = function() { updateFactoryRowCost(this); };
const defaultOpt = document.createElement('option');
defaultOpt.value = '';
defaultOpt.textContent = 'Select Material';
sel.appendChild(defaultOpt);
let foundInInventory = false;
factoryInventoryData.forEach(i => {
const opt = document.createElement('option');
opt.value = String(i.id);
opt.dataset.cost = String(i.cost);
opt.textContent = i.name;
sel.appendChild(opt);
if (String(i.id) === String(selectedId)) {
foundInInventory = true;
if (costVal === null) currentCost = i.cost;
}
});

col1.appendChild(lbl1);
col1.appendChild(sel);
const col2 = document.createElement('div'); col2.className = 'u-flex-col';
const lbl2 = document.createElement('label');
lbl2.style.cssText = 'font-size:0.6rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;';
lbl2.textContent = 'Cost (Per Unit)';
const costInput = document.createElement('input');
costInput.type = 'number';
costInput.className = 'factory-mat-cost';
costInput.value = currentCost;
costInput.readOnly = true;
costInput.style.cssText = 'background:rgba(0,0,0,0.05);color:var(--text-muted);';
col2.appendChild(lbl2);
col2.appendChild(costInput);
const col3 = document.createElement('div'); col3.className = 'u-flex-col';
const lbl3 = document.createElement('label');
lbl3.style.cssText = 'font-size:0.6rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;';
lbl3.textContent = 'Qty (kg)';
const qtyInput = document.createElement('input');
qtyInput.type = 'number';
qtyInput.className = 'factory-mat-qty';
qtyInput.value = qtyVal;
qtyInput.placeholder = '0';
col3.appendChild(lbl3);
col3.appendChild(qtyInput);
div.appendChild(col1);
div.appendChild(col2);
div.appendChild(col3);
container.appendChild(div);
if (selectedId) {
const targetId = String(selectedId).trim();
let matched = false;
for (const opt of sel.options) {
if (opt.value.trim() === targetId) {
opt.selected = true;
matched = true;
break;
}
}
if (!matched && savedName) {
const ghostOpt = document.createElement('option');
ghostOpt.value = targetId;
ghostOpt.dataset.cost = String(currentCost);
ghostOpt.textContent = savedName;
ghostOpt.selected = true;
sel.appendChild(ghostOpt);
}
costInput.value = currentCost;
}
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
createFactorySettingRow(container, '', '', null, '', null);
}

function updateFactoryRowCost(selectEl) {
const costInput = selectEl.closest('.factory-formula-grid').querySelector('.factory-mat-cost');
const selectedOption = selectEl.options[selectEl.selectedIndex];
costInput.value = selectedOption.getAttribute('data-cost') || 0;
updateFactoryFormulasSummary();
}

async function updateFactoryFormulasSummary() {
const factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
const container = document.getElementById('factoryRawMaterialsContainer');
const rows = container.querySelectorAll('.factory-formula-grid');
let totalRawCost = 0, totalWeight = 0;
rows.forEach(row => {
const sel = row.querySelector('.factory-mat-select');
const qtyIn = row.querySelector('.factory-mat-qty');
const costIn = row.querySelector('.factory-mat-cost');
if (sel && sel.value && qtyIn.value > 0 && costIn.value > 0) {
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
_setFS('factorySettingsUnitWeight', safeNumber(safeTotalWeight, 0).toFixed(2) + ' kg');
_setFS('factorySettingsRawCostPerUnit', await formatCurrency(totalRawCost));
_setFS('factorySettingsPerUnit', await formatCurrency(perUnitCost));
_setFS('factorySettingsAvailableUnits', available);
_setFS('factorySettingsSalesCostPerKg', await formatCurrency(salesCostPerKg));
}

async function saveFactoryFormulas() {
const _sffBatch = await sqliteStore.getBatch([
'factory_inventory_data','factory_default_formulas','factory_additional_costs',
'factory_cost_adjustment_factor','factory_sale_prices','payment_transactions',
]);
const factoryInventoryData = ensureArray(_sffBatch.get('factory_inventory_data'));
const _rawFormulas = _sffBatch.get('factory_default_formulas');
const _rawCosts    = _sffBatch.get('factory_additional_costs');
const _rawFactor   = _sffBatch.get('factory_cost_adjustment_factor');
const _rawPrices   = _sffBatch.get('factory_sale_prices');
const factoryDefaultFormulas = (_rawFormulas && 'standard' in _rawFormulas && 'asaan' in _rawFormulas)
  ? _rawFormulas
  : { standard: (_rawFormulas && _rawFormulas.standard) || [], asaan: (_rawFormulas && _rawFormulas.asaan) || [] };
const factoryAdditionalCosts = (_rawCosts && 'standard' in _rawCosts && 'asaan' in _rawCosts)
  ? _rawCosts
  : { standard: (_rawCosts && _rawCosts.standard != null ? _rawCosts.standard : 0), asaan: (_rawCosts && _rawCosts.asaan != null ? _rawCosts.asaan : 0) };
const factoryCostAdjustmentFactor = (_rawFactor && 'standard' in _rawFactor && 'asaan' in _rawFactor)
  ? _rawFactor
  : { standard: (_rawFactor && _rawFactor.standard != null ? _rawFactor.standard : 1), asaan: (_rawFactor && _rawFactor.asaan != null ? _rawFactor.asaan : 1) };
const factorySalePrices = (_rawPrices && 'standard' in _rawPrices && 'asaan' in _rawPrices)
  ? _rawPrices
  : { standard: (_rawPrices && _rawPrices.standard != null ? _rawPrices.standard : 0), asaan: (_rawPrices && _rawPrices.asaan != null ? _rawPrices.asaan : 0) };
const paymentTransactions = ensureArray(_sffBatch.get('payment_transactions'));
const container = document.getElementById('factoryRawMaterialsContainer');
const rows = container.querySelectorAll('.factory-formula-grid');
const newFormula = [];
rows.forEach(row => {
const sel = row.querySelector('.factory-mat-select');
const qtyIn = row.querySelector('.factory-mat-qty');
const costIn = row.querySelector('.factory-mat-cost');
if (sel && sel.value && qtyIn.value > 0 && costIn.value > 0) {
const selectedOpt = sel.options[sel.selectedIndex];
const itemName = selectedOpt ? selectedOpt.textContent.trim() : '';
if (itemName) {
newFormula.push({ id: sel.value, name: itemName, cost: parseFloat(costIn.value), quantity: parseFloat(qtyIn.value) });
}
}
});
const _freshFormulas = await sqliteStore.get('factory_default_formulas');
const _freshCosts    = await sqliteStore.get('factory_additional_costs');
const _freshFactor   = await sqliteStore.get('factory_cost_adjustment_factor');
const _otherStore = currentFactorySettingsStore === 'standard' ? 'asaan' : 'standard';
factoryDefaultFormulas[currentFactorySettingsStore] = newFormula;
if (_freshFormulas && _freshFormulas[_otherStore] !== undefined) {
factoryDefaultFormulas[_otherStore] = _freshFormulas[_otherStore];
}
factoryAdditionalCosts[currentFactorySettingsStore] = parseFloat(document.getElementById('additional-cost-per-unit').value) || 0;
if (_freshCosts && _freshCosts[_otherStore] !== undefined) {
factoryAdditionalCosts[_otherStore] = _freshCosts[_otherStore];
}
factoryCostAdjustmentFactor[currentFactorySettingsStore] = parseFloat(document.getElementById('cost-adjustment-factor').value) || 1;
if (_freshFactor && _freshFactor[_otherStore] !== undefined) {
factoryCostAdjustmentFactor[_otherStore] = _freshFactor[_otherStore];
}
factorySalePrices.standard = parseFloat(document.getElementById('sale-price-standard').value) || 0;
factorySalePrices.asaan = parseFloat(document.getElementById('sale-price-asaan').value) || 0;
try {
const timestamp = getTimestamp();
await sqliteStore.setBatch([
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
await OfflineQueue.add({ action: 'set-doc', collection: 'factorySettings', docId: 'config', data: factorySettingsPayload });
}
showToast('Settings saved locally — will sync when online', 'warning');
} else {
try {
await pushDataToCloud(true);
emitSyncUpdate({
factory_default_formulas: null,
factory_sale_prices: null,
factory_additional_costs: null,
factory_cost_adjustment_factor: null
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
requestAnimationFrame(() => {
document.body.style.overflow = 'hidden';
document.documentElement.style.overflow = 'hidden';
const _fiOv = document.getElementById('factoryInventoryOverlay');
if (_fiOv) _fiOv.style.display = 'flex';
});
});
const _facInvT1 = document.getElementById('factoryInventoryModalTitle');
if (_facInvT1) _facInvT1.innerText = 'Add Raw Material';
const _delBtnHide = document.getElementById('deleteFactoryInventoryBtn');
if (_delBtnHide) _delBtnHide.style.display = 'none';
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

async function editFactoryInventoryItem(id) {
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const item = factoryInventoryData.find(i => i.id === id);
if (!item) return;
openFactoryInventoryModal();
const _facInvT2 = document.getElementById('factoryInventoryModalTitle');
if (_facInvT2) _facInvT2.innerText = 'Edit Material';
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

function updateFactoryKgCalculation() {
const qty = parseFloat(document.getElementById('factoryMaterialQuantity').value) || 0;
const conversionFactor = parseFloat(document.getElementById('factoryMaterialConversionFactor').value) || 1;
const cost = parseFloat(document.getElementById('factoryMaterialCost').value) || 0;
const totalKg = qty * conversionFactor;
const totalAmount = qty * cost;
const kgDisplayElement = document.getElementById('factoryCalculatedKg');
const amountDisplayElement = document.getElementById('factoryCalculatedAmount');
if (kgDisplayElement) kgDisplayElement.textContent = safeNumber(totalKg, 0).toFixed(2) + ' kg';
if (amountDisplayElement) amountDisplayElement.textContent = fmtAmt(totalAmount);
}

function showSupplierUnlinkOption(material) {
const existingSupplierSection = document.getElementById('existingSupplierSection');
let unlinkButton = existingSupplierSection.querySelector('.unlink-supplier-btn');
if (!unlinkButton) {
unlinkButton = document.createElement('button');
unlinkButton.className = 'btn btn-danger unlink-supplier-btn';
unlinkButton.style.cssText = 'width:100%;margin-top:10px;font-size:0.8rem;';
unlinkButton.innerHTML = ' Unlink Supplier & Reverse Transactions';
unlinkButton.onclick = function(e) { e.preventDefault(); unlinkSupplierConfirmation(material); };
existingSupplierSection.appendChild(unlinkButton);
}
}

async function unlinkSupplierConfirmation(material) {
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const linkedTransactions = paymentTransactions.filter(t => t.materialId === material.id && t.entityId === material.supplierId && t.isPayable === true);
let confirmMsg = ` Unlink ${material.supplierName} from ${material.name}?\n\n`;
confirmMsg += `This will:\n Remove supplier association\n Reset payment status to 'pending'\n`;
if (linkedTransactions.length > 0) {
const totalReversed = linkedTransactions.reduce((sum, t) => sum + t.amount, 0);
confirmMsg += ` Reverse ${linkedTransactions.length} payment transaction(s) totaling ${fmtAmt(safeNumber(totalReversed, 0))}\n`;
}
confirmMsg += `\nThe material will be ready to link with a different supplier.\n\nThis cannot be undone.`;
if (await showGlassConfirm(confirmMsg, { title: `Unlink ${esc(material.supplierName)}`, confirmText: 'Unlink', danger: true })) {
await unlinkSupplierFromMaterial(material, true);
closeFactoryInventoryModal();
setTimeout(() => editFactoryInventoryItem(material.id), 100);
refreshPaymentTab();
calculateNetCash();
renderFactoryInventory();
}
}

async function saveFactoryInventoryItem() {
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
const name = document.getElementById('factoryMaterialName').value;
const qty = parseFloat(document.getElementById('factoryMaterialQuantity').value) || 0;
const cost = parseFloat(document.getElementById('factoryMaterialCost').value) || 0;
const conversionFactor = parseFloat(document.getElementById('factoryMaterialConversionFactor').value) || 1;
const unitName = document.getElementById('factoryMaterialUnitName').value.trim() || '';
const supplierType = document.getElementById('factoryMaterialSupplierType').value;
if (!name) return showToast('Name required', 'warning');
try {
const quantityInKg = qty * conversionFactor;
const costPerKg = conversionFactor > 0 ? cost / conversionFactor : cost;
const totalValue = qty * cost;
let materialId = editingFactoryInventoryId || generateUUID('mat');
if (!validateUUID(materialId)) materialId = generateUUID('mat');
if (editingFactoryInventoryId) {
const idx = factoryInventoryData.findIndex(i => i.id === editingFactoryInventoryId);
if (idx !== -1) {
const existingMaterial = factoryInventoryData[idx];
const oldSupplierId = existingMaterial.supplierId;
const supplierInput = document.getElementById('factoryExistingSupplier');

const newSupplierId = (supplierInput && supplierInput.getAttribute('data-supplier-id')) || '';
const isSupplierSame = supplierType === 'existing' && oldSupplierId && newSupplierId && String(oldSupplierId) === String(newSupplierId);
const isSupplierChanging = !isSupplierSame && (
(supplierType === 'none' && oldSupplierId) ||
(supplierType === 'existing' && oldSupplierId && newSupplierId && String(oldSupplierId) !== String(newSupplierId))
);
if (isSupplierChanging) await unlinkSupplierFromMaterial(existingMaterial, false, true);

const _supplierUnchanged = !!(editingFactoryInventoryId && isSupplierSame);
factoryInventoryData[idx] = ensureRecordIntegrity({ ...factoryInventoryData[idx], name, quantity: quantityInKg, cost: costPerKg, unit: 'kg', totalValue, purchaseQuantity: qty, purchaseCost: cost, conversionFactor, purchaseUnitName: unitName, updatedAt: getTimestamp() }, true);
}
}
if (!editingFactoryInventoryId) {
const _matNow = getTimestamp();
let _newMaterial = { id: materialId, name, quantity: quantityInKg, cost: costPerKg, unit: 'kg', totalValue, paymentStatus: 'pending', syncedAt: new Date().toISOString(), purchaseQuantity: qty, purchaseCost: cost, conversionFactor, purchaseUnitName: unitName, createdAt: _matNow, updatedAt: _matNow, timestamp: _matNow };
_newMaterial = ensureRecordIntegrity(_newMaterial, false);
factoryInventoryData.push(_newMaterial);
await sqliteStore.set('factory_inventory_data', factoryInventoryData);
}
if (supplierType === 'none') {
const material = factoryInventoryData.find(m => m.id === materialId);
if (material) {
delete material.supplierId;
delete material.supplierName;
delete material.supplierContact;
delete material.supplierType;
material.paymentStatus = 'pending';
material.totalPayable = totalValue;
}
} else if (supplierType === 'existing') {
if (!_supplierUnchanged) {
const supplierInput = document.getElementById('factoryExistingSupplier');
const existingSupplierId = supplierInput.getAttribute('data-supplier-id') || supplierInput.value;
if (existingSupplierId) await linkMaterialToSupplier(materialId, existingSupplierId, totalValue, true, factoryInventoryData);
}
} else if (supplierType === 'new') {
const supplierName = document.getElementById('factorySupplierName').value.trim();
const supplierPhone = document.getElementById('factorySupplierPhone').value.trim();
if (supplierName) {
const newSupplier = await createSupplierFromMaterial({ name: supplierName, phone: supplierPhone, materialId, materialName: name, materialTotal: totalValue });
if (newSupplier && newSupplier.id) await linkMaterialToSupplier(materialId, newSupplier.id, totalValue, true, factoryInventoryData);
}
}
const savedMaterial = factoryInventoryData.find(m => m.id === materialId);
await unifiedSave('factory_inventory_data', factoryInventoryData, savedMaterial);
notifyDataChange('inventory');
emitSyncUpdate({ factory_inventory_data: null});
if (typeof renderFactoryInventory === 'function') renderFactoryInventory();
if (typeof renderUnifiedTable === 'function') renderUnifiedTable(1);
closeFactoryInventoryModal();
if (typeof calculateNetCash === 'function') calculateNetCash();
showToast('Material saved successfully!', 'success');
} catch (error) {
showToast('Failed to save material. Please try again.', 'error');
}
}

async function unlinkSupplierFromMaterial(material, showToastOnNoSupplier = false, skipSideEffects = false) {
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
if (!material) { showToast('Invalid material data', 'error'); return; }
if (!material.supplierId) {
if (showToastOnNoSupplier) showToast('No supplier to unlink', 'info');
return;
}
const materialId = material.id;
const linkedTransactions = paymentTransactions.filter(t => t.materialId === materialId && t.entityId === material.supplierId && t.isPayable === true);
if (linkedTransactions.length > 0) {
const removedTransactions = linkedTransactions.slice();
const removedIds = new Set(removedTransactions.map(t => t.id));
const filteredTx = paymentTransactions.filter(t => !removedIds.has(t.id));
await saveWithTracking('payment_transactions', filteredTx);
await Promise.all(removedTransactions.map(tx => registerDeletion(tx.id, 'transactions', tx)));
void Promise.all(removedTransactions.map(tx => deleteRecordFromFirestore('payment_transactions', tx.id).catch(() => {})));
}
delete material.supplierId;
delete material.supplierName;
delete material.supplierContact;
delete material.supplierType;
material.paymentStatus = 'pending';
delete material.totalPayable;
delete material.paidDate;
material.updatedAt = getTimestamp();
ensureRecordIntegrity(material, true);
if (!skipSideEffects) {
await unifiedSave('factory_inventory_data', factoryInventoryData, material);
notifyDataChange('all');
triggerAutoSync();
await renderFactoryInventory();
await refreshPaymentTab();
calculateNetCash();
showToast(`Unlinked from ${esc(material.name)}`, 'success');
}
}

async function createSupplierFromMaterial(supplierData) {
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const existingSupplier = paymentEntities.find(e => e && e.name && supplierData && supplierData.name && e.name.toLowerCase() === supplierData.name.toLowerCase() && e.type === 'payee');
if (existingSupplier) return existingSupplier;
let suppId = generateUUID('supp');
if (!validateUUID(suppId)) suppId = generateUUID('supp');
const suppCreatedAt = getTimestamp();
let supplierEntity = ensureRecordIntegrity({ id: suppId, name: supplierData.name, type: 'payee', phone: supplierData.phone || '', wallet: '', createdAt: suppCreatedAt, updatedAt: suppCreatedAt, timestamp: suppCreatedAt, isSupplier: true, supplierCategory: 'raw_materials' }, false);
paymentEntities.push(supplierEntity);
await unifiedSave('payment_entities', paymentEntities, supplierEntity);
saveRecordToFirestore('payment_entities', supplierEntity).catch(() => {});
notifyDataChange('entities');
triggerAutoSync();
return supplierEntity;
}

async function renderFactoryInventory() {
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const tbody = document.getElementById('factoryInventoryTableBody');
let totalVal = 0;
if (factoryInventoryData.length === 0) {
tbody.innerHTML = '<tr><td class="u-empty-state-md" colspan="5">No items in inventory</td></tr>';
GNDVirtualScroll.destroy('vs-scroller-factory-inventory');
const _invEl = document.getElementById('factoryTotalInventoryValue');
if (_invEl) _invEl.innerText = await formatCurrency(0);
return;
}
const prebuiltRows = [];
for (const item of factoryInventoryData) {
const itemTotalValue = (item.quantity * item.cost) || 0;
totalVal += itemTotalValue;
let supplierHtml = '';
if (item.supplierName) {
const remainingPayable = item.totalPayable || 0;
const isFullyPaid = item.paymentStatus === 'paid' || remainingPayable <= 0;
const payableDisplay = isFullyPaid ? `<span class="u-text-emerald">0.00</span>` : `<span style="font-weight:600;color:var(--accent);">${safeNumber(remainingPayable, 0).toFixed(2)}</span>`;
supplierHtml = `<div style="font-size:0.65rem;color:var(--text-muted);margin-top:4px;"><div style="background:rgba(0,122,255,0.1);color:var(--accent);padding:3px 8px;border-radius:4px;display:inline-block;margin-bottom:3px;font-weight:600;">${String(item.supplierName).replace(/'/g, "&#39;").replace(/"/g, "&quot;")}</div><div style="margin-top:3px;font-size:0.7rem;">${payableDisplay}</div></div>`;
} else {
supplierHtml = `<div style="font-size:0.65rem;color:var(--text-muted);margin-top:4px;font-style:italic;opacity:0.6;">No supplier linked</div>`;
}
let quantityHtml = '';
if (item.purchaseQuantity && item.purchaseUnitName && item.conversionFactor && item.conversionFactor !== 1) {
quantityHtml = `<div class="u-text-center"><div class="u-fs-sm3 u-text-main u-fw-600">${(item.purchaseQuantity || 0).toFixed(2)}</div><div class="u-fs-sm u-text-muted">${esc(item.purchaseUnitName)}</div><div style="font-size:0.65rem;color:var(--text-muted);margin-top:2px;">(${(item.quantity || 0).toFixed(2)})</div></div>`;
} else if (item.purchaseQuantity && item.conversionFactor && item.conversionFactor !== 1) {
quantityHtml = `<div class="u-text-center"><div class="u-fs-sm3 u-text-main u-fw-600">${(item.purchaseQuantity || 0).toFixed(2)}</div><div class="u-fs-sm u-text-muted">units</div><div style="font-size:0.65rem;color:var(--text-muted);margin-top:2px;">(${(item.quantity || 0).toFixed(2)})</div></div>`;
} else {
quantityHtml = `<div class="u-text-center"><div class="u-fs-sm3 u-text-main u-fw-600">${(item.quantity || 0).toFixed(2)}</div><div class="u-fs-sm u-text-muted">kg</div></div>`;
}
let costHtml = '';
if (item.purchaseCost && item.purchaseUnitName && item.conversionFactor && item.conversionFactor !== 1) {
costHtml = `<div class="u-text-center"><div class="u-fs-sm2 u-text-main">${await formatCurrency(item.purchaseCost)}</div><div class="u-fs-sm u-text-muted">${esc(item.purchaseUnitName)}</div></div>`;
} else if (item.purchaseCost && item.conversionFactor && item.conversionFactor !== 1) {
costHtml = `<div class="u-text-center"><div class="u-fs-sm2 u-text-main">${await formatCurrency(item.purchaseCost)}</div><div class="u-fs-sm u-text-muted">unit</div></div>`;
} else {
costHtml = `<div class="u-text-center"><div class="u-fs-sm2 u-text-main">${await formatCurrency(item.cost)}</div><div class="u-fs-sm u-text-muted">kg</div></div>`;
}
const totalValueStr = await formatCurrency(itemTotalValue);
const itemId = esc(item.id);
const itemName = esc(item.name);
const tr = document.createElement('tr');
tr.style.borderBottom = '1px solid var(--glass-border)';
tr.innerHTML = `<td style="padding:8px 2px;"><div style="font-weight:600;font-size:0.8rem;color:var(--text-main);">${itemName}</div>${supplierHtml}</td><td style="text-align:center;padding:8px 2px;">${quantityHtml}</td><td style="text-align:right;padding:8px 2px;font-size:0.75rem;color:var(--text-muted);">${costHtml}</td><td style="text-align:right;padding:8px 2px;font-size:0.8rem;font-weight:700;color:var(--accent);">${totalValueStr}</td><td style="text-align:center;padding:6px 2px;"><button class="tbl-action-btn" onclick="editFactoryInventoryItem('${itemId}')">Edit</button></td>`;
prebuiltRows.push(tr);
}
GNDVirtualScroll.mount('vs-scroller-factory-inventory', prebuiltRows, function(el) { return el; }, tbody);

const _invEl = document.getElementById('factoryTotalInventoryValue');
if (_invEl) _invEl.innerText = await formatCurrency(totalVal);
}

async function unlinkSupplierFromMaterialById(materialId) {
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
let material = factoryInventoryData.find(m => m.id === materialId);
if (!material) {
const reloadedData = await sqliteStore.get('factory_inventory_data');
if (Array.isArray(reloadedData)) {
material = factoryInventoryData.find(m => m.id === materialId);
}
}
if (!material) { showToast('Material not found', 'error'); return; }
if (!material.supplierId) { showToast('No supplier linked', 'warning'); return; }
const linkedTransactions = paymentTransactions.filter(t => t.materialId === materialId && t.entityId === material.supplierId && t.isPayable === true);
const _us2Total = linkedTransactions.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);
let confirmMsg = `Unlink ${material.supplierName} from "${material.name}"?`;
confirmMsg += `\nCurrent Stock: ${(material.quantity || 0).toFixed(2)} kg`;
if (material.totalPayable) confirmMsg += `\nOutstanding Payable: ${fmtAmt(material.totalPayable || 0)}`;
if (linkedTransactions.length > 0) confirmMsg += `\n\n↩ ${linkedTransactions.length} payment transaction${linkedTransactions.length !== 1 ? 's' : ''} totaling ${fmtAmt(_us2Total)} will be reversed and the material reverted to "Pending Payable" status.`;
confirmMsg += `\n\nThe material will be available to link with a different supplier.\n\nThis cannot be undone.`;
if (await showGlassConfirm(confirmMsg, { title: `Unlink ${esc(material.supplierName)}`, confirmText: 'Unlink', danger: true })) {
await unlinkSupplierFromMaterial(material, true);
}
}

function toggleSupplierFields() {
const supplierType = document.getElementById('factoryMaterialSupplierType').value;
const existingSection = document.getElementById('existingSupplierSection');
const newSection = document.getElementById('newSupplierSection');
if (existingSection) existingSection.classList.add('hidden');
if (newSection) newSection.classList.add('hidden');
if (supplierType === 'existing') { if (existingSection) existingSection.classList.remove('hidden'); }
else if (supplierType === 'new') { if (newSection) newSection.classList.remove('hidden'); }
}

async function loadExistingSuppliers() {
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
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
option.value = '';
option.textContent = 'No suppliers found. Create a new one.';
option.disabled = true;
selectElement.appendChild(option);
}
}

async function linkMaterialToSupplier(materialId, supplierId, totalCost, skipSideEffects = false, sharedInventory = null) {
const factoryInventoryData = sharedInventory || ensureArray(await sqliteStore.get('factory_inventory_data'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
let material = factoryInventoryData.find(m => m.id === materialId);
if (!material) {
const reloadedData = await sqliteStore.get('factory_inventory_data');
if (Array.isArray(reloadedData)) {
material = reloadedData.find(m => m.id === materialId);
}
}
if (!material) { showToast('Material not found. Try refreshing.', 'error'); return; }
let supplier = paymentEntities.find(e => e.id === supplierId || String(e.id) === String(supplierId));
if (!supplier) {
const supplierTransaction = paymentTransactions.find(t => t.entityId === supplierId || String(t.entityId) === String(supplierId));
if (supplierTransaction) {
supplier = { id: supplierId, name: supplierTransaction.entityName || 'Supplier', type: 'payee', phone: '' };
} else {
showToast('Supplier not found. Please refresh and try again.', 'error');
return;
}
}
if (material.supplierId && String(material.supplierId) !== String(supplierId)) {
await unlinkSupplierFromMaterial(material, false, true);
}
material.supplierId = supplier.id;
material.supplierName = supplier.name;
material.supplierContact = supplier.phone || '';
material.supplierType = 'payee';
material.paymentStatus = 'pending';
material.totalPayable = totalCost;
material.updatedAt = getTimestamp();
ensureRecordIntegrity(material, true);
if (!skipSideEffects) {
await unifiedSave('factory_inventory_data', factoryInventoryData, material);
notifyDataChange('all');
triggerAutoSync();
await renderFactoryInventory();
await refreshPaymentTab();
calculateNetCash();
showToast(`Linked to ${esc(supplier.name)}`, 'success');
}
}

function selectFactoryEntryStore(store, el) {
currentFactoryEntryStore = store;
document.querySelectorAll('.factory-store-selector .factory-store-opt').forEach(o => o.classList.remove('active'));
if (el) el.classList.add('active');
calculateFactoryProduction();
}

async function getSalePriceForStore(store) {
const factorySalePrices = (await sqliteStore.get('factory_sale_prices')) || {};
if (!store) return 0;
if (store === 'STORE_C') return factorySalePrices.asaan || 0;
return factorySalePrices.standard || 0;
}

async function getEffectiveSalePriceForCustomer(customerName, store) {
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
const factorySalePrices = (await sqliteStore.get('factory_sale_prices')) || {};
if (customerName) {
const _reg = Array.isArray(salesCustomers) ? salesCustomers.find(c => c && c.name && c.name.toLowerCase() === String(customerName).toLowerCase()) : null;
if (_reg && _reg.customSalePrice > 0) return _reg.customSalePrice;
}
return await getSalePriceForStore(store);
}

async function getSaleTransactionValue(t) {
const factorySalePrices = (await sqliteStore.get('factory_sale_prices')) || {};
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
if (!t) return 0;
if (t.isMerged) return parseFloat(t.totalValue) || 0;
const pt = t.paymentType || 'CASH';
if (pt === 'COLLECTION' || pt === 'PARTIAL_PAYMENT') return parseFloat(t.totalValue) || 0;
if (t.transactionType === 'OLD_DEBT') return parseFloat(t.totalValue) || 0;
const qty = parseFloat(t.quantity) || 0;
if (qty <= 0) return parseFloat(t.totalValue) || 0;
return qty * (await getEffectiveSalePriceForCustomer(t.customerName, t.supplyStore || 'STORE_A'));
}

async function getCostPriceForStore(store) {
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
const factoryCostAdjustmentFactor = (await sqliteStore.get('factory_cost_adjustment_factor')) || {};
if (!store) return 0;
return await calculateSalesCostPerKg(store === 'STORE_C' ? 'asaan' : 'standard');
}

async function getStorePricing(store) {
const factorySalePrices = (await sqliteStore.get('factory_sale_prices')) || {};
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
const factoryCostAdjustmentFactor = (await sqliteStore.get('factory_cost_adjustment_factor')) || {};
return { salePrice: getSalePriceForStore(store), costPrice: getCostPriceForStore(store) };
}

async function calculateFactoryProduction() {
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
const units = parseInt(document.getElementById('factoryProductionUnits').value) || 1;
const settings = factoryDefaultFormulas[currentFactoryEntryStore];
const additionalCost = factoryAdditionalCosts[currentFactoryEntryStore] || 0;
let baseCost = 0;
let rawMaterialsUsed = 0;
let html = `<h4 style="margin:0 0 5px 0;font-size:0.9rem;">${currentFactoryEntryStore.toUpperCase()} Formula (${units} Units)</h4>`;
if (settings && settings.length > 0) {
for (const i of settings) {
const lineTotal = i.cost * i.quantity * units;
baseCost += lineTotal;
rawMaterialsUsed += i.quantity * units;
html += `<div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:2px;"><span>${i.name} (${i.quantity * units} kg)</span><span>${await formatCurrency(lineTotal)}</span></div>`;
}
const totalAdditionalCost = additionalCost * units;
if (totalAdditionalCost > 0) {
html += `<div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:2px;color:var(--danger);"><span>Additional Cost (${additionalCost} per unit)</span><span>${await formatCurrency(totalAdditionalCost)}</span></div>`;
baseCost += totalAdditionalCost;
}
} else {
html += `<div class="u-text-muted">No formula set.</div>`;
}
document.getElementById('factoryFormulaDisplay').innerHTML = html;
const _prodCostEl = document.getElementById('factoryTotalProductionCostDisplay');
if (_prodCostEl) _prodCostEl.innerText = await formatCurrency(baseCost);
}

async function saveFactoryProductionEntry() {
const _sfpeBatch = await sqliteStore.getBatch([
'factory_default_formulas','factory_additional_costs',
'factory_inventory_data','factory_production_history',
]);
const factoryDefaultFormulas = _sfpeBatch.get('factory_default_formulas') || {};
const factoryAdditionalCosts = _sfpeBatch.get('factory_additional_costs') || {};
const factoryInventoryData = ensureArray(_sfpeBatch.get('factory_inventory_data'));
const factoryProductionHistory = ensureArray(_sfpeBatch.get('factory_production_history'));
if (appMode === 'userrole' && !(window._userRoleAllowedTabs || []).includes('factory')) {
showToast('Access Denied — Factory not in your assigned tabs', 'warning', 3000);
return;
}
const units = parseInt(document.getElementById('factoryProductionUnits').value) || 0;
if (units <= 0) return showToast('Invalid units', 'warning', 3000);
const inventorySnapshot = JSON.parse(JSON.stringify(factoryInventoryData));
const historySnapshot = [...factoryProductionHistory];
try {
const settings = factoryDefaultFormulas[currentFactoryEntryStore];
const additionalCost = factoryAdditionalCosts[currentFactoryEntryStore] || 0;
let baseCost = 0;
let rawMat = 0;
if (settings) {
baseCost = settings.reduce((acc, cur) => acc + (cur.cost * cur.quantity), 0) * units;
rawMat = settings.reduce((acc, cur) => acc + cur.quantity, 0) * units;
}
const totalCost = baseCost + (additionalCost * units);
let inventoryUpdated = false;
if (settings && settings.length > 0) {
settings.forEach(item => {
const materialUsed = item.quantity * units;
const inventoryItem = factoryInventoryData.find(i => String(i.id) === String(item.id));
if (inventoryItem) {
if (inventoryItem.quantity >= materialUsed) {
inventoryItem.quantity -= materialUsed;
inventoryItem.quantity = Math.max(0, parseFloat(inventoryItem.quantity.toFixed(6)));
inventoryItem.totalValue = inventoryItem.quantity * inventoryItem.cost;
if (inventoryItem.conversionFactor && inventoryItem.conversionFactor !== 1) {
inventoryItem.purchaseQuantity = inventoryItem.quantity / inventoryItem.conversionFactor;
}
inventoryItem.updatedAt = getTimestamp();
inventoryUpdated = true;
} else {
throw new Error(`Insufficient ${inventoryItem.name} in inventory! Available: ${inventoryItem.quantity}, Required: ${materialUsed}`);
}
}
});
}
let factProdId = generateUUID('fprod');
if (!validateUUID(factProdId)) factProdId = generateUUID('fprod');
const factProdCreatedAt = getTimestamp();
const productionRecord = {
id: factProdId,
date: new Date().toISOString().split('T')[0],
time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
store: currentFactoryEntryStore,
units,
totalCost,
materialsCost: baseCost,
additionalCost: additionalCost * units,
rawMaterialsUsed: rawMat,
createdAt: factProdCreatedAt,
updatedAt: factProdCreatedAt,
timestamp: factProdCreatedAt,
syncedAt: new Date().toISOString(),
managedBy: (appMode === 'factory' && window._assignedManagerName) ? window._assignedManagerName : null,
createdBy: (appMode === 'userrole' && window._assignedManagerName) ? window._assignedManagerName : null
};
const validatedRecord = ensureRecordIntegrity(productionRecord);
factoryProductionHistory.unshift(validatedRecord);
await Promise.all([
saveWithTracking('factory_inventory_data', factoryInventoryData),
saveWithTracking('factory_production_history', factoryProductionHistory, validatedRecord)
]);
notifyDataChange('factory');
emitSyncUpdate({ factory_inventory_data: null, factory_production_history: null});
await syncFactoryProductionStats();
await refreshFactoryTab();
calculateNetCash();
calculateCashTracker();
document.getElementById('factoryProductionUnits').value = '1';
showToast('Production saved successfully!', 'success');
const cloudWrites = [saveRecordToFirestore('factory_production_history', validatedRecord)];
if (inventoryUpdated) {
for (const item of factoryInventoryData) cloudWrites.push(saveRecordToFirestore('factory_inventory_data', item));
}
void Promise.all(cloudWrites)
.then(() => triggerAutoSync())
.catch(err => console.warn(' Background Firestore sync failed (will retry):', _safeErr(err)));
} catch (error) {
factoryInventoryData.length = 0;
factoryInventoryData.push(...inventorySnapshot);
factoryProductionHistory.length = 0;
factoryProductionHistory.push(...historySnapshot);
try {
await sqliteStore.setBatch([
['factory_inventory_data', factoryInventoryData],
['factory_production_history', factoryProductionHistory]
]);
} catch (rollbackError) {
console.error('Failed to save data locally.', _safeErr(rollbackError));
showToast('Failed to save data locally.', 'error');
}
showToast(error.message || 'Failed to save production data. Please try again.', 'error', 4000);
}
}

function setFactorySummaryMode(mode, el) {
currentFactorySummaryMode = mode;
document.querySelectorAll('#tab-factory .toggle-group .toggle-opt').forEach(opt => opt.classList.remove('active'));
if (el) el.classList.add('active');
updateFactorySummaryCard();
_filterFactoryHistoryByMode(mode);
}

function setFactoryAvailableStore(store, el) {
document.getElementById('factoryAvailStatsStandard').classList.add('hidden');
document.getElementById('factoryAvailStatsStandard').style.display = 'none';
document.getElementById('factoryAvailStatsAsaan').style.display = 'none';
const statsElement = document.getElementById('factoryAvailStats' + (store === 'standard' ? 'Standard' : 'Asaan'));
if (statsElement) { statsElement.classList.remove('hidden'); statsElement.style.display = 'grid'; }
const parent = el.parentElement;
parent.querySelectorAll('.toggle-opt').forEach(t => t.classList.remove('active'));
el.classList.add('active');
updateFactoryUnitsAvailableStats();
}

async function renderFactoryHistory() {
const factoryProductionHistory = ensureArray(await sqliteStore.get('factory_production_history'));
const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
const list = document.getElementById('factoryHistoryList');
if (!list) return;
if (factoryProductionHistory.length === 0) {
list.replaceChildren(Object.assign(document.createElement('div'), { className: 'u-empty-state-sm', textContent: 'No recent activity' }));
return;
}
const _fhFrag = document.createDocumentFragment();
const recent = [...factoryProductionHistory].sort((a, b) => {
const timeA = a.timestamp || new Date(a.date + ' ' + a.time).getTime();
const timeB = b.timestamp || new Date(b.date + ' ' + b.time).getTime();
return timeB - timeA;
});
for (const entry of recent) {
const dateObj = new Date(entry.date);
const month = dateObj.toLocaleDateString('en-US', { month: 'short' });
const day = String(dateObj.getDate()).padStart(2, '0');
const year = String(dateObj.getFullYear()).slice(-2);
const dateStr = `${month} ${day} ${year} ${esc(entry.time || '')}`;
const badgeClass = entry.store === 'standard' ? 'factory-badge-std' : 'factory-badge-asn';
const storeLabel = entry.store === 'standard' ? 'STD' : 'ASN';
const perUnitCost = entry.units > 0 ? entry.totalCost / entry.units : 0;
const additionalCostPerUnit = factoryAdditionalCosts[entry.store] || 0;
const totalAdditionalCost = additionalCostPerUnit * entry.units;
const div = document.createElement('div');
div.className = 'factory-history-item';
if (entry.date) div.setAttribute('data-date', entry.date);
div.innerHTML = `
<div style="display:flex;justify-content:space-between;margin-bottom:8px;border-bottom:1px solid var(--glass-border);padding-bottom:5px;">
<span class="u-fs-sm2 u-text-muted">${dateStr}</span>
<div style="display:flex;gap:6px;align-items:center;">
${_mergedBadgeHtml(entry)}
<span class="factory-badge ${badgeClass}">${esc(storeLabel)}</span>
</div>
</div>
${entry.managedBy ? `<div style="margin-bottom:8px;"><span style="display:inline-flex;align-items:center;gap:4px;padding:2px 9px;font-size:0.65rem;font-weight:700;letter-spacing:0.04em;color:var(--accent-purple);background:rgba(206,147,216,0.10);border:1px solid rgba(206,147,216,0.28);border-radius:999px;">${esc(entry.managedBy)}</span></div>` : ''}
${entry.createdBy ? `<div style="margin-bottom:8px;">${typeof _creatorBadgeHtml === 'function' ? _creatorBadgeHtml(entry) : ''}</div>` : ''}
<div class="factory-summary-row"><span class="factory-summary-label">Units Produced</span><span class="qty-val">${entry.units}</span></div>
<div class="factory-summary-row"><span class="factory-summary-label">Material Cost</span><span class="cost-val">${await formatCurrency(entry.materialsCost || 0)}</span></div>
${totalAdditionalCost > 0 ? `<div class="factory-summary-row"><span class="factory-summary-label">Additional Cost</span><span class="cost-val">${await formatCurrency(totalAdditionalCost)}</span></div>` : ''}
<div class="factory-summary-row"><span class="factory-summary-label">Per Unit Cost</span><span class="cost-val">${await formatCurrency(perUnitCost)}</span></div>
<div class="factory-summary-row"><span class="factory-summary-label">Total Cost</span><span class="rev-val">${await formatCurrency(entry.totalCost)}</span></div>
<div class="factory-summary-row"><span class="factory-summary-label">Raw Materials Used</span><span class="qty-val">${safeNumber(entry.rawMaterialsUsed, 0).toFixed(2)} kg</span></div>
${entry.isMerged ? '' : `<button class="tbl-action-btn danger u-w-full u-mt-8" onclick="deleteFactoryEntry('${entry.id}')">Delete & Restore Inventory</button>`}`;
_fhFrag.appendChild(div);
}
list.replaceChildren(_fhFrag);
_filterFactoryHistoryByMode(currentFactorySummaryMode || 'all');
}

async function deleteFactoryEntry(id) {
const factoryProductionHistory = ensureArray(await sqliteStore.get('factory_production_history'));
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
if (!id || !validateUUID(id)) { showToast('Invalid factory entry ID', 'error'); return; }
const entryIndex = factoryProductionHistory.findIndex(e => e.id === id);
if (entryIndex === -1) { await refreshFactoryTab(); return; }
const entry = factoryProductionHistory[entryIndex];
if (entry.isMerged) { showToast('Merged opening balance records cannot be deleted', 'warning'); return; }
const _feStoreLabel = getStoreLabel(entry.store) || entry.store;
const _feFormula = factoryDefaultFormulas[entry.store] || [];
const _feMatsDetail = _feFormula.length > 0
? _feFormula.map(f => { const inv = factoryInventoryData.find(i => i.id === f.id); return ` • ${inv?.name || 'Material'}: ${(f.quantity * entry.units).toFixed(2)} kg restored`; }).join('\n')
: '';
let _feMsg = `Delete this factory production batch permanently?`;
_feMsg += `\nStore: ${_feStoreLabel}\nDate: ${entry.date}\nUnits Produced: ${entry.units}`;
if (entry.totalCost) _feMsg += `\nTotal Cost: ${fmtAmt(entry.totalCost || 0)}`;
_feMsg += _feMatsDetail ? `\n\n↩ Raw materials restored to inventory:\n${_feMatsDetail}` : `\n\n↩ Raw materials used in this batch will be restored to inventory.`;
_feMsg += `\n\n⚠ Sales already made from this batch will NOT be reversed — but available stock will change.\n\nThis cannot be undone.`;
if (await showGlassConfirm(_feMsg, { title: 'Delete Factory Production', confirmText: 'Delete', danger: true })) {
try {
entry.deletedAt = getTimestamp();
entry.updatedAt = getTimestamp();
ensureRecordIntegrity(entry, true);
let restoredMaterials = [];
const formula = factoryDefaultFormulas[entry.store];
if (formula && formula.length > 0) {
formula.forEach(formulaItem => {
const materialToRestore = formulaItem.quantity * entry.units;
const inventoryItem = factoryInventoryData.find(i => i.id === formulaItem.id);
if (inventoryItem) {
inventoryItem.quantity += materialToRestore;
inventoryItem.totalValue = inventoryItem.quantity * inventoryItem.cost;
inventoryItem.updatedAt = getTimestamp();
ensureRecordIntegrity(inventoryItem, true);
restoredMaterials.push({ name: inventoryItem.name || 'Unknown', quantity: materialToRestore });
}
});
}
factoryProductionHistory.splice(entryIndex, 1);
await Promise.all([
unifiedDelete('factory_production_history', factoryProductionHistory, id, { strict: true }, entry),
saveWithTracking('factory_inventory_data', factoryInventoryData)
]);
await refreshFactoryTab();
calculateNetCash();
calculateCashTracker();
notifyDataChange('factory');
if (restoredMaterials.length > 0) {
showToast(` Entry deleted! Raw materials restored: ${restoredMaterials.map(m => `${m.name}: +${safeToFixed(m.quantity, 2)} kg`).join(', ')}`, 'success');
} else {
showToast(' Entry deleted and inventory restored.', 'success');
}
void Promise.all(factoryInventoryData.filter(item => item && item.id).map(item => saveRecordToFirestore('factory_inventory_data', item)))
.then(() => triggerAutoSync())
.catch(err => console.warn(' Background Firestore sync failed on delete (will retry):', _safeErr(err)));
} catch (error) {
showToast(' Failed to delete entry. Please try again.', 'error');
}
}
}

async function calculateDynamicCost(storeType, formulaUnits, netWeight) {
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
let formulaStore = 'standard';
if (storeType === 'STORE_C' || storeType === 'asaan') {
formulaStore = 'asaan';
} else if (storeType !== 'STORE_A' && storeType !== 'STORE_B' && storeType !== 'standard') {
return { costPerUnit: 0, totalFormulaCost: 0, dynamicCostPerKg: 0, formulaStore: storeType, rawMaterialCost: 0 };
}
const formula = factoryDefaultFormulas[formulaStore];
if (!formula || formula.length === 0 || netWeight <= 0) {
return { costPerUnit: 0, totalFormulaCost: 0, dynamicCostPerKg: 0, formulaStore, rawMaterialCost: 0 };
}
let totalMaterialCost = 0;
let totalWeight = 0;
formula.forEach(item => { totalMaterialCost += (item.cost * item.quantity); totalWeight += item.quantity; });
const additionalCost = factoryAdditionalCosts[formulaStore] || 0;
const costPerUnit = totalMaterialCost + additionalCost;
return {
costPerUnit,
totalMaterialCost,
additionalCost,
totalFormulaCost: costPerUnit * formulaUnits,
dynamicCostPerKg: formulaUnits > 0 ? (costPerUnit * formulaUnits) / netWeight : 0,
formulaStore,
rawMaterialCost: totalMaterialCost,
unitWeight: totalWeight
};
}

async function calculateSalesCostPerKg(formulaStore) {
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
const factoryCostAdjustmentFactor = (await sqliteStore.get('factory_cost_adjustment_factor')) || {};
const formula = factoryDefaultFormulas[formulaStore];
if (!formula || formula.length === 0) return 0;
let rawMaterialCost = 0;
formula.forEach(item => { rawMaterialCost += (item.cost * item.quantity); });
const additionalCost = factoryAdditionalCosts[formulaStore] || 0;
const adjustmentFactor = factoryCostAdjustmentFactor[formulaStore] || 1;
return adjustmentFactor > 0 ? (rawMaterialCost + additionalCost) / adjustmentFactor : rawMaterialCost + additionalCost;
}

async function updateFormulaInventory() {
const factoryProductionHistory = ensureArray(await sqliteStore.get('factory_production_history'));
const factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const tracking = {
standard: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
asaan: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] }
};
factoryProductionHistory.forEach(entry => {
if (entry.store && entry.units > 0) {
tracking[entry.store].produced += entry.units;
if (entry.totalCost && entry.units > 0) {
tracking[entry.store].unitCostHistory.push({ date: entry.date, costPerUnit: entry.totalCost / entry.units, units: entry.units });
}
}
});
db.forEach(entry => {
const formulaStore = entry.store === 'STORE_C' ? 'asaan' : 'standard';
if (entry.formulaUnits) tracking[formulaStore].consumed += entry.formulaUnits;
});
tracking.standard.available = Math.max(0, tracking.standard.produced - tracking.standard.consumed);
tracking.asaan.available = Math.max(0, tracking.asaan.produced - tracking.asaan.consumed);
const timestamp = Date.now();

await sqliteStore.set('factory_unit_tracking', tracking);
await sqliteStore.set('factory_unit_tracking_timestamp', timestamp);
return tracking;
}

async function syncFactoryProductionStats() {
const tracking = await updateFormulaInventory();
updateUnitsAvailableIndicator();
updateFactoryUnitsAvailableStats();
updateFactorySummaryCard();
return tracking;
}

async function validateFormulaAvailability(storeType, requestedUnits) {
const factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
const formulaStore = (storeType === 'STORE_C' || storeType === 'asaan') ? 'asaan' : 'standard';
const available = factoryUnitTracking[formulaStore]?.available || 0;
return { available, sufficient: available >= requestedUnits, deficit: Math.max(0, requestedUnits - available) };
}

async function updateUnitsAvailableIndicator() {
const factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
const store = document.getElementById('storeSelector').value;
const formulaStore = store === 'STORE_C' ? 'asaan' : 'standard';
const available = factoryUnitTracking[formulaStore]?.available || 0;
const indicator = document.getElementById('currentUnitsAvailable');
const warning = document.getElementById('insufficientUnitsWarning');
let indicatorClass = 'units-available-good';
if (available < 10) indicatorClass = 'units-available-warning';
if (available <= 0) indicatorClass = 'units-available-danger';
if (indicator) { indicator.className = `units-available-indicator ${indicatorClass}`; indicator.textContent = `${(available || 0).toFixed(2)} units available`; }
const requestedUnits = parseFloat(document.getElementById('formula-units')?.value) || 0;
if (warning) {
if (requestedUnits > available) warning.classList.remove('hidden');
else warning.classList.add('hidden');
}
}

async function calculateDynamicProductionCost() {
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
const factorySalePrices = (await sqliteStore.get('factory_sale_prices')) || {};
const net = parseFloat(document.getElementById('net-wt').value) || 0;
const store = document.getElementById('storeSelector').value;
const formulaUnits = parseFloat(document.getElementById('formula-units').value) || 0;
const costData = await calculateDynamicCost(store, formulaUnits, net);
const salePrice = await getSalePriceForStore(store);
const _setProd = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
_setProd('formula-unit-cost-display', `${fmtAmt(safeValue(costData.costPerUnit))}/unit`);
_setProd('total-formula-cost-display', `${fmtAmt(safeValue(costData.totalFormulaCost))}`);
_setProd('dynamic-cost-per-kg', `${safeValue(costData.dynamicCostPerKg).toFixed(2)}/kg`);
_setProd('factory-cost-price', `${safeValue(costData.dynamicCostPerKg).toFixed(2)}/kg`);
_setProd('production-sale-price-display', `${safeValue(salePrice).toFixed(2)}/kg`);
_setProd('profit-sale-price', `${safeValue(salePrice).toFixed(2)}/kg`);
_setProd('display-cost-value', `${fmtAmt(safeValue(net * costData.dynamicCostPerKg))}`);
_setProd('profit-per-kg', `${fmtAmt(safeValue(salePrice - costData.dynamicCostPerKg))}`);
updateUnitsAvailableIndicator();
}

async function updateProductionCostOnStoreChange() {
const factorySalePrices = (await sqliteStore.get('factory_sale_prices')) || {};
const store = document.getElementById('storeSelector').value;
currentStore = store;
const salePrice = await getSalePriceForStore(store);
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
document.getElementById('net-wt').value = safeNumber(Math.max(0, g - c), 0).toFixed(2);
calculateDynamicProductionCost();
}

async function deleteProdEntry(id) {
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
if (!id || !validateUUID(id)) { showToast('Invalid production record ID', 'error'); return; }
const entryToDelete = db.find(item => item.id === id);
if (!entryToDelete) return;
if (entryToDelete.isMerged) { showToast('Merged opening balance records cannot be deleted', 'warning'); return; }
const isReturn = entryToDelete.isReturn === true;
const _dpStoreLabel = getStoreLabel(entryToDelete.store) || entryToDelete.store;
const _dpSalesOnDate = (typeof customerSales !== 'undefined' ? customerSales : []).filter(s => s.date === entryToDelete.date && s.store === entryToDelete.store).length;
let confirmMsg;
if (isReturn) {
confirmMsg = `Remove this stock return record?`;
confirmMsg += `\nStore: ${_dpStoreLabel}\nDate: ${entryToDelete.date}\nQty Returned: ${entryToDelete.net} kg`;
confirmMsg += `\n\n↩ This will DECREASE available stock by ${entryToDelete.net} kg on ${entryToDelete.date}.`;
if (_dpSalesOnDate > 0) confirmMsg += ` ${_dpSalesOnDate} sale${_dpSalesOnDate !== 1 ? 's' : ''} exist on this date — those records may be affected.`;
} else {
confirmMsg = `Permanently delete this production record?`;
confirmMsg += `\nStore: ${_dpStoreLabel}\nDate: ${entryToDelete.date}\nNet Qty: ${entryToDelete.net} kg`;
if (entryToDelete.gross) confirmMsg += `\nGross / Tare: ${entryToDelete.gross} / ${((entryToDelete.gross || 0) - (entryToDelete.net || 0)).toFixed(2)} kg`;
confirmMsg += `\n\n↩ ${entryToDelete.net} kg will be removed from ${entryToDelete.date} inventory.`;
if (_dpSalesOnDate > 0) confirmMsg += `\n\n⚠ ${_dpSalesOnDate} sale${_dpSalesOnDate !== 1 ? 's' : ''} on this date for ${_dpStoreLabel} will remain on record, but available stock will drop.`;
}
confirmMsg += `\n\nThis cannot be undone.`;
if (await showGlassConfirm(confirmMsg, { title: isReturn ? 'Remove Return' : 'Delete Production', confirmText: isReturn ? 'Remove' : 'Delete', danger: true })) {
try {
const record = db.find(item => item.id === id);
if (record) { record.deletedAt = getTimestamp(); record.updatedAt = getTimestamp(); ensureRecordIntegrity(record, true); }
const dbWithoutDeleted = db.filter(item => item.id !== id);
await unifiedDelete('mfg_pro_pkr', dbWithoutDeleted, id, { strict: true }, record || null);
notifyDataChange('production');
void syncFactoryProductionStats().catch(() => {});
await refreshUI();
calculateNetCash();
calculateCashTracker();
const deletedQuantity = entryToDelete.net || 0;
if (isReturn) {
showToast(` Return record removed. ${deletedQuantity} kg removed from ${entryToDelete.date} stock.`, 'success');
} else {
showToast(` Production deleted. ${deletedQuantity} kg removed from ${entryToDelete.date} inventory. Sales on this date may be affected.`, 'success');
}
} catch (error) {
showToast(' Failed to delete entry. Please try again.', 'error');
}
}
}
