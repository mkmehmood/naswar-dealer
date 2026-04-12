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
await renderFactorySettingsRows();
}

function closeFactorySettings() {
if (typeof closeStandaloneScreen === 'function') {
closeStandaloneScreen('formula-standard-screen');
closeStandaloneScreen('formula-asaan-screen');
}
}

function selectFactoryStore(store, el) {
currentFactorySettingsStore = store;
document.querySelectorAll('.factory-store-opt').forEach(o => o.classList.remove('active'));
if (el) el.classList.add('active');
const container = document.getElementById('factoryRawMaterialsContainer');
if (container) container.style.opacity = '0.35';
renderFactorySettingsRows().then(() => {
requestAnimationFrame(() => { if (container) container.style.opacity = '1'; });
}).catch(() => { if (container) container.style.opacity = '1'; });
}

async function refreshFactorySettingsOverlay() {
const stdScreen = document.getElementById('formula-standard-screen');
const asaanScreen = document.getElementById('formula-asaan-screen');
const isOpen = (stdScreen && stdScreen.style.display !== 'none') || (asaanScreen && asaanScreen.style.display !== 'none');
if (isOpen) {
const container = document.getElementById('factoryRawMaterialsContainer');
const liveRows = container ? Array.from(container.querySelectorAll('.factory-formula-grid')) : [];
const liveState = liveRows.map(row => ({
id: row.querySelector('.factory-mat-search-input')?.dataset.matId || '',
name: row.querySelector('.factory-mat-search-input')?.value || '',
cost: row.querySelector('.factory-mat-search-input')?.dataset.matCost || '',
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
const inp = row.querySelector('.factory-mat-search-input');
const costIn = row.querySelector('.factory-mat-cost');
const qty = row.querySelector('.factory-mat-qty');
if (inp) { inp.value = state.name; inp.dataset.matId = state.id; inp.dataset.matCost = state.cost; }
if (costIn) costIn.value = state.cost;
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
const asaanScreen = document.getElementById('formula-asaan-screen');
if (asaanScreen && asaanScreen.style.display !== 'none') {
const acpuA = document.getElementById('additional-cost-per-unit-asaan');
const cafA = document.getElementById('cost-adjustment-factor-asaan');
const spSA = document.getElementById('sale-price-standard-asaan');
const spAO = document.getElementById('sale-price-asaan-only');
const asaanAdditionalCost = factoryAdditionalCosts['asaan'] || 0;
const asaanAdjustmentFactor = factoryCostAdjustmentFactor['asaan'] || 1;
if (acpuA) acpuA.value = asaanAdditionalCost;
if (cafA) cafA.value = asaanAdjustmentFactor;
if (spSA) spSA.value = factorySalePrices.standard || 0;
if (spAO) spAO.value = factorySalePrices.asaan || 0;
const asaanContainer = document.getElementById('factoryRawMaterialsContainerAsaan');
if (asaanContainer) {
asaanContainer.replaceChildren();
const asaanFormula = factoryDefaultFormulas['asaan'] || [];
let asaanRawCost = 0, asaanWeight = 0;
if (asaanFormula.length > 0) {
for (const ing of asaanFormula) {
asaanRawCost += (ing.cost * ing.quantity);
asaanWeight += ing.quantity;
await createFactorySettingRow(asaanContainer, ing.id, ing.quantity, ing.cost, ing.name, factoryInventoryData);
}
}
const asaanAvailable = factoryUnitTracking['asaan']?.available || 0;
const asaanPerUnit = asaanRawCost + asaanAdditionalCost;
const asaanSalesCostPerKg = asaanAdjustmentFactor > 0 ? asaanPerUnit / asaanAdjustmentFactor : asaanPerUnit;
const safeAsaanWeight = parseFloat(asaanWeight) || 0;
_setFS1('factorySettingsUnitWeightAsaan', safeNumber(safeAsaanWeight, 0).toFixed(2) + ' kg');
_setFS1('factorySettingsRawCostPerUnitAsaan', await formatCurrency(asaanRawCost));
_setFS1('factorySettingsPerUnitAsaan', await formatCurrency(asaanPerUnit));
_setFS1('factorySettingsAvailableUnitsAsaan', asaanAvailable);
_setFS1('factorySettingsSalesCostPerKgAsaan', await formatCurrency(asaanSalesCostPerKg));
}
}
}

async function createFactorySettingRow(container, selectedId = '', qtyVal = '', costVal = null, savedName = '', inventoryData = null) {
const factoryInventoryData = inventoryData !== null ? inventoryData : ensureArray(await sqliteStore.get('factory_inventory_data'));
let currentCost = costVal !== null ? costVal : 0;
let currentId = selectedId ? String(selectedId) : '';
let currentName = savedName || '';
if (currentId) {
const match = factoryInventoryData.find(i => String(i.id) === currentId);
if (match) {
currentName = match.name;
if (costVal === null) currentCost = match.cost;
}
}
const rowId = 'fmr-' + Math.random().toString(36).slice(2, 8);
const div = document.createElement('div');
div.className = 'factory-formula-grid';
div.style.position = 'relative';

const searchWrap = document.createElement('div');
searchWrap.className = 'factory-mat-select';
searchWrap.style.cssText = 'position:relative;';

const searchInput = document.createElement('input');
searchInput.type = 'text';
searchInput.className = 'factory-mat-search-input';
searchInput.placeholder = 'Search material…';
searchInput.value = currentName;
searchInput.dataset.matId = currentId;
searchInput.dataset.matCost = String(currentCost);
searchInput.autocomplete = 'off';
searchInput.style.cssText = 'width:100%;box-sizing:border-box;';

const dropdown = document.createElement('div');
dropdown.className = 'factory-mat-dropdown hidden u-search-dropdown';
dropdown.style.cssText = 'position:absolute;top:100%;left:0;right:0;z-index:999;max-height:180px;overflow-y:auto;';

function renderDropdown(query) {
const q = (query || '').toLowerCase();
const filtered = q
? factoryInventoryData.filter(i => i.name && i.name.toLowerCase().includes(q))
: factoryInventoryData;
if (!filtered.length) {
dropdown.innerHTML = '<div class="u-search-empty">No materials found</div>';
} else {
dropdown.innerHTML = filtered.map(i =>
`<div class="factory-mat-option" data-id="${esc(String(i.id))}" data-cost="${esc(String(i.cost))}" data-name="${esc(i.name)}"
style="padding:9px 10px;cursor:pointer;border-bottom:1px solid var(--glass-border);font-size:0.85rem;color:var(--text-main);background:var(--input-bg);"
onmouseover="this.style.background='var(--highlight-bg)'"
onmouseout="this.style.background='var(--input-bg)'">${esc(i.name)}</div>`
).join('');
}
dropdown.classList.remove('hidden');
dropdown.querySelectorAll('.factory-mat-option').forEach(opt => {
opt.addEventListener('mousedown', e => {
e.preventDefault();
const id = opt.dataset.id;
const cost = opt.dataset.cost;
const name = opt.dataset.name;
searchInput.value = name;
searchInput.dataset.matId = id;
searchInput.dataset.matCost = cost;
costInput.value = cost;
dropdown.classList.add('hidden');
updateFactoryFormulasSummary();
});
});
}

searchInput.addEventListener('focus', () => renderDropdown(searchInput.value));
searchInput.addEventListener('input', () => renderDropdown(searchInput.value));
searchInput.addEventListener('blur', () => {
setTimeout(() => dropdown.classList.add('hidden'), 150);
if (!searchInput.dataset.matId) {
searchInput.value = '';
costInput.value = '';
}
});

searchWrap.appendChild(searchInput);
searchWrap.appendChild(dropdown);

const costInput = document.createElement('input');
costInput.type = 'number';
costInput.className = 'factory-mat-cost';
costInput.placeholder = 'Cost';
costInput.value = currentCost;
costInput.readOnly = true;
costInput.style.cssText = 'background:rgba(0,0,0,0.05);color:var(--text-muted);cursor:default;';

const qtyInput = document.createElement('input');
qtyInput.type = 'number';
qtyInput.className = 'factory-mat-qty';
qtyInput.placeholder = 'Qty (kg)';
qtyInput.value = qtyVal;
qtyInput.oninput = function() { updateFactoryFormulasSummary(); };

const delBtn = document.createElement('button');
delBtn.type = 'button';
delBtn.className = 'factory-row-del-btn';
delBtn.innerHTML = '&times;';
delBtn.title = 'Remove row';
delBtn.onclick = function() {
div.remove();
updateFactoryFormulasSummary();
};

div.appendChild(searchWrap);
div.appendChild(costInput);
div.appendChild(qtyInput);
div.appendChild(delBtn);
container.appendChild(div);
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

async function updateFactoryFormulasSummary() {
const factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
const container = document.getElementById('factoryRawMaterialsContainer');
const rows = container.querySelectorAll('.factory-formula-grid');
let totalRawCost = 0, totalWeight = 0;
rows.forEach(row => {
const inp = row.querySelector('.factory-mat-search-input');
const qtyIn = row.querySelector('.factory-mat-qty');
const costIn = row.querySelector('.factory-mat-cost');
if (inp && inp.dataset.matId && qtyIn.value > 0 && costIn.value > 0) {
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
const inp = row.querySelector('.factory-mat-search-input');
const qtyIn = row.querySelector('.factory-mat-qty');
const costIn = row.querySelector('.factory-mat-cost');
if (inp && inp.dataset.matId && qtyIn.value > 0 && costIn.value > 0) {
const itemName = inp.value.trim();
if (itemName) {
let resolvedId = inp.dataset.matId;
const liveMatch = factoryInventoryData.find(i => String(i.id) === String(resolvedId));
if (!liveMatch && itemName) {
const nameMatch = factoryInventoryData.find(i => i.name && i.name.trim().toLowerCase() === itemName.toLowerCase());
if (nameMatch) resolvedId = nameMatch.id;
}
newFormula.push({ id: resolvedId, name: itemName, cost: parseFloat(costIn.value), quantity: parseFloat(qtyIn.value) });
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
if (factorySalePrices.standard <= 0 && factorySalePrices.asaan <= 0) {
showToast('Sale prices cannot both be 0 — profit calculations would go negative. Please set at least one sale price.', 'warning', 5000);
return;
}
if (factorySalePrices.standard < 0 || factorySalePrices.asaan < 0) {
showToast('Sale prices cannot be negative.', 'warning', 4000);
return;
}
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
if (typeof openStandaloneScreen === 'function') openStandaloneScreen('raw-material-screen');
}

function closeFactoryInventoryModal() {
if (typeof closeStandaloneScreen === 'function') closeStandaloneScreen('raw-material-screen');
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
if (qty <= 0) return showToast('Please enter a valid quantity greater than 0', 'warning');
if (cost <= 0) return showToast('Please enter a valid cost greater than 0', 'warning');
if (conversionFactor <= 0) return showToast('Conversion factor must be greater than 0', 'warning');
try {
const quantityInKg = qty * conversionFactor;
const costPerKg = conversionFactor > 0 ? cost / conversionFactor : cost;
const totalValue = qty * cost;
let materialId;
let _supplierUnchanged = false;
if (editingFactoryInventoryId) {
materialId = editingFactoryInventoryId;
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
_supplierUnchanged = isSupplierSame;
factoryInventoryData[idx] = ensureRecordIntegrity({ ...factoryInventoryData[idx], name, quantity: quantityInKg, cost: costPerKg, unit: 'kg', totalValue, purchaseQuantity: qty, purchaseCost: cost, conversionFactor, purchaseUnitName: unitName, updatedAt: getTimestamp() }, true);
}
} else {
materialId = generateUUID('mat');
if (!validateUUID(materialId)) materialId = generateUUID('mat');
const _matNow = getTimestamp();
let _newMaterial = { id: materialId, name, quantity: quantityInKg, cost: costPerKg, unit: 'kg', totalValue, paymentStatus: 'pending', syncedAt: new Date().toISOString(), purchaseQuantity: qty, purchaseCost: cost, conversionFactor, purchaseUnitName: unitName, createdAt: _matNow, updatedAt: _matNow, timestamp: _matNow };
_newMaterial = ensureRecordIntegrity(_newMaterial, false);
factoryInventoryData.push(_newMaterial);
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
let filteredTx = paymentTransactions.slice();
for (const tx of removedTransactions) {
filteredTx = filteredTx.filter(t => t.id !== tx.id);
await unifiedDelete('payment_transactions', filteredTx, tx.id, { strict: true }, tx);
}
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
supplierHtml = `<div style="font-size:0.65rem;color:var(--text-muted);margin-top:4px;"><div class="supplier-name-badge">${String(item.supplierName).replace(/'/g, "&#39;").replace(/"/g, "&quot;")}</div><div style="margin-top:3px;font-size:0.7rem;">${payableDisplay}</div></div>`;
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
tr.style.cursor = 'pointer';
tr.innerHTML = `<td style="padding:8px 2px; cursor:pointer;" onclick="editFactoryInventoryItem('${itemId}')"><div style="font-weight:600;font-size:0.8rem;color:var(--accent);">${itemName}</div>${supplierHtml}</td><td style="text-align:center;padding:8px 2px;">${quantityHtml}</td><td style="text-align:right;padding:8px 2px;font-size:0.75rem;color:var(--text-muted);">${costHtml}</td><td style="text-align:right;padding:8px 2px;font-size:0.8rem;font-weight:700;color:var(--accent);">${totalValueStr}</td>`;
prebuiltRows.push(tr);
}
tbody.innerHTML = '';
const _fragF = document.createDocumentFragment();
prebuiltRows.forEach(el => { if (el) _fragF.appendChild(el); });
tbody.appendChild(_fragF);

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
const payableTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const now = new Date();
const dateStr = now.toISOString().split('T')[0];
const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
let payableTxId = generateUUID('pay');
if (!validateUUID(payableTxId)) payableTxId = generateUUID('pay');
const payableTxCreatedAt = getTimestamp();
let payableTx = {
id: payableTxId,
entityId: supplier.id,
entityName: supplier.name,
entityType: 'payee',
date: dateStr,
time: timeStr,
amount: totalCost,
description: `Material purchase: ${material.name}`,
type: 'IN',
isPayable: true,
materialId: material.id,
createdAt: payableTxCreatedAt,
updatedAt: payableTxCreatedAt,
timestamp: payableTxCreatedAt,
syncedAt: now.toISOString()
};
payableTx = ensureRecordIntegrity(payableTx, false);
payableTransactions.push(payableTx);
if (!skipSideEffects) {
await unifiedSave('factory_inventory_data', factoryInventoryData, material);
await unifiedSave('payment_transactions', payableTransactions, payableTx);
notifyDataChange('all');
triggerAutoSync();
await renderFactoryInventory();
await refreshPaymentTab();
calculateNetCash();
showToast(`Linked to ${esc(supplier.name)}`, 'success');
} else {
await sqliteStore.set('payment_transactions', payableTransactions);
}
}

function selectFactoryFormula(formulaType, el) {
const container = document.getElementById('factory-formula-selector');
if (container) container.querySelectorAll('.factory-store-opt').forEach(o => o.classList.remove('active'));
if (el) el.classList.add('active');
const representativeStore = (formulaType === 'asaan') ? 'STORE_C' : 'STORE_A';
currentFactoryEntryStore = representativeStore;
calculateFactoryProduction();
}
function selectFactoryEntryStore(store, el) {
currentFactoryEntryStore = store;
const container = document.getElementById('factory-store-selector') || document.querySelector('.factory-store-selector');
if (container) container.querySelectorAll('.factory-store-opt').forEach(o => o.classList.remove('active'));
if (el) el.classList.add('active');
calculateFactoryProduction();
}

async function getSalePriceForStore(store) {
const factorySalePrices = (await sqliteStore.get('factory_sale_prices')) || {};
if (!store) return 0;
const formulaType = typeof getStoreFormulaType === 'function' ? await getStoreFormulaType(store) : (store === 'STORE_C' ? 'asaan' : 'standard');
return factorySalePrices[formulaType] || 0;
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
const formulaType = typeof getStoreFormulaType === 'function' ? await getStoreFormulaType(store) : (store === 'STORE_C' ? 'asaan' : 'standard');
return await calculateSalesCostPerKg(formulaType);
}

async function getStorePricing(store) {
const factorySalePrices = (await sqliteStore.get('factory_sale_prices')) || {};
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
const factoryCostAdjustmentFactor = (await sqliteStore.get('factory_cost_adjustment_factor')) || {};
return { salePrice: await getSalePriceForStore(store), costPrice: await getCostPriceForStore(store) };
}

async function calculateFactoryProduction() {
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
const units = parseInt(document.getElementById('factoryProductionUnits').value) || 1;
const _cfesType = typeof getStoreFormulaType === 'function' ? await getStoreFormulaType(currentFactoryEntryStore) : (currentFactoryEntryStore === 'STORE_C' ? 'asaan' : 'standard');
const _cfesLabel = _cfesType === 'asaan' ? 'Asaan' : 'Standard';
const settings = factoryDefaultFormulas[_cfesType] || factoryDefaultFormulas[currentFactoryEntryStore];
const additionalCost = factoryAdditionalCosts[_cfesType] || factoryAdditionalCosts[currentFactoryEntryStore] || 0;
let baseCost = 0;
let rawMaterialsUsed = 0;
let html = `<h4 style="margin:0 0 5px 0;font-size:0.9rem;">${_cfesLabel} Formula (${units} Units)</h4>`;
if (settings && settings.length > 0) {
for (const i of settings) {
const lineTotal = i.cost * i.quantity * units;
baseCost += lineTotal;
rawMaterialsUsed += i.quantity * units;
html += `<div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:2px;"><span>${i.name} (${(i.quantity * units).toFixed(2)} kg)</span><span>${await formatCurrency(lineTotal)}</span></div>`;
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

if (!currentFactoryEntryStore) {
showToast('Please select a formula type (Standard or Asaan) before saving.', 'warning', 3000);
return;
}
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
const _sfpeType = typeof getStoreFormulaType === 'function' ? await getStoreFormulaType(currentFactoryEntryStore) : (currentFactoryEntryStore === 'STORE_C' ? 'asaan' : 'standard');
const settings = factoryDefaultFormulas[_sfpeType] || factoryDefaultFormulas[currentFactoryEntryStore];
if (!settings || settings.length === 0) {
showToast('No formula configured for this store. Please set up Factory Formulas before recording production.', 'warning', 5000);
return;
}
const additionalCost = factoryAdditionalCosts[_sfpeType] || factoryAdditionalCosts[currentFactoryEntryStore] || 0;
let baseCost = 0;
let rawMat = 0;
if (settings) {
baseCost = settings.reduce((acc, cur) => {
let liveItem = factoryInventoryData.find(i => String(i.id) === String(cur.id));
if (!liveItem && cur.name) liveItem = factoryInventoryData.find(i => i.name && i.name.trim().toLowerCase() === cur.name.trim().toLowerCase());
const liveCost = liveItem ? liveItem.cost : cur.cost;
return acc + (liveCost * cur.quantity);
}, 0) * units;
rawMat = settings.reduce((acc, cur) => acc + cur.quantity, 0) * units;
}
const totalCost = baseCost + (additionalCost * units);
let inventoryUpdated = false;
if (settings && settings.length > 0) {
for (const item of settings) {
const materialUsed = item.quantity * units;
let inventoryItem = factoryInventoryData.find(i => String(i.id) === String(item.id));
if (!inventoryItem && item.name) {
inventoryItem = factoryInventoryData.find(i => i.name && i.name.trim().toLowerCase() === item.name.trim().toLowerCase());
}
if (!inventoryItem) {
throw new Error(`Material "${item.name}" not found in inventory. Please re-open Factory Settings and re-save the formula to relink all materials.`);
}
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
throw new Error(`Insufficient "${inventoryItem.name}" in inventory! Available: ${inventoryItem.quantity.toFixed(2)} kg, Required: ${materialUsed.toFixed(2)} kg`);
}
}
}
let factProdId = generateUUID('fprod');
if (!validateUUID(factProdId)) factProdId = generateUUID('fprod');
const factProdCreatedAt = getTimestamp();
const _savedFormulaType = typeof getStoreFormulaType === 'function' ? await getStoreFormulaType(currentFactoryEntryStore) : (currentFactoryEntryStore === 'STORE_C' ? 'asaan' : 'standard');
const productionRecord = {
id: factProdId,
date: new Date().toISOString().split('T')[0],
time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
store: currentFactoryEntryStore,
formulaType: _savedFormulaType,
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
await unifiedSave('factory_production_history', factoryProductionHistory, validatedRecord);
if (inventoryUpdated) {
const inventoryIds = factoryInventoryData.filter(i => i && i.id).map(i => i.id);
await unifiedSave('factory_inventory_data', factoryInventoryData, null, inventoryIds);
} else {
await unifiedSave('factory_inventory_data', factoryInventoryData);
}
notifyDataChange('factory');
emitSyncUpdate({ factory_inventory_data: null, factory_production_history: null});
await syncFactoryProductionStats();
await refreshFactoryTab();
calculateNetCash();
calculateCashTracker();
document.getElementById('factoryProductionUnits').value = '1';

showToast('Production saved successfully!', 'success');
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
showToast('Production rollback failed: ' + (_safeErr(rollbackError).message || 'data may be inconsistent, please reload'), 'error');
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

async function setFactoryAvailableStore(formulaType, el) {
const _ftype = (formulaType === 'asaan') ? 'asaan' : 'standard';
const stdEl = document.getElementById('factoryAvailStatsStandard');
const asaanEl = document.getElementById('factoryAvailStatsAsaan');
if (stdEl) { stdEl.classList.add('hidden'); stdEl.style.display = 'none'; }
if (asaanEl) { asaanEl.classList.add('hidden'); asaanEl.style.display = 'none'; }
const statsElement = document.getElementById('factoryAvailStats' + (_ftype === 'asaan' ? 'Asaan' : 'Standard'));
if (statsElement) { statsElement.classList.remove('hidden'); statsElement.style.display = 'grid'; }
const parent = el ? el.parentElement : null;
if (parent) parent.querySelectorAll('.toggle-opt').forEach(t => t.classList.remove('active'));
if (el) el.classList.add('active');
updateFactoryUnitsAvailableStats();
}

async function renderFactoryHistory() {
const _fhBatch = await sqliteStore.getBatch(['factory_production_history','factory_additional_costs','factory_default_formulas','factory_inventory_data']);
const factoryProductionHistory = ensureArray(_fhBatch.get('factory_production_history'));
const factoryAdditionalCosts = (_fhBatch.get('factory_additional_costs')) || {};
const factoryDefaultFormulas = (_fhBatch.get('factory_default_formulas')) || {};
const factoryInventoryData = ensureArray(_fhBatch.get('factory_inventory_data'));
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
const _histFtype = entry.formulaType || (entry.store === 'asaan' || entry.store === 'STORE_C' ? 'asaan' : 'standard');
const badgeClass = _histFtype === 'asaan' ? 'factory-badge-asn' : 'factory-badge-std';
const formulaLabel = _histFtype === 'asaan' ? 'Asaan' : 'Standard';
const perUnitCost = entry.units > 0 ? entry.totalCost / entry.units : 0;
const additionalCostPerUnit = factoryAdditionalCosts[_histFtype] || factoryAdditionalCosts[entry.store] || 0;
const totalAdditionalCost = additionalCostPerUnit * entry.units;

const formula = factoryDefaultFormulas[_histFtype] || factoryDefaultFormulas[entry.store] || [];
let matsBreakdownHtml = '';
if (formula.length > 0) {
const rowsHtml = formula.map(f => {
let inv = factoryInventoryData.find(i => String(i.id) === String(f.id));
if (!inv && f.name) inv = factoryInventoryData.find(i => i.name && i.name.trim().toLowerCase() === f.name.trim().toLowerCase());
const matName = esc(inv?.name || f.name || 'Material');
const qtyUsed = (f.quantity * entry.units).toFixed(2);
const unitCost = inv ? inv.cost : (f.cost || 0);
const matCost = (unitCost * f.quantity * entry.units);
return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--glass-border);">
<span style="font-size:0.72rem;color:var(--text-main);font-weight:500;">${matName}</span>
<span style="display:flex;gap:10px;align-items:center;">
<span style="font-size:0.7rem;color:var(--text-muted);">${qtyUsed} kg</span>
<span class="cost-val" style="font-size:0.72rem;min-width:60px;text-align:right;">${fmtAmt(matCost)}</span>
</span>
</div>`;
}).join('');
const breakdownId = `fh-breakdown-${entry.id}`;
matsBreakdownHtml = `
<div style="margin-top:8px;">
<button onclick="(function(el){var p=document.getElementById('${breakdownId}');var open=p.style.display!=='none';p.style.display=open?'none':'block';el.querySelector('span').textContent=open?'':'';})(this)"
style="display:flex;align-items:center;gap:5px;background:none;border:none;cursor:pointer;padding:4px 0;width:100%;">
<span style="font-size:0.68rem;color:var(--accent);"></span>
<span style="font-size:0.68rem;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:0.05em;">Materials Breakdown</span>
</button>
<div id="${breakdownId}" style="display:none;background:var(--glass-raised);border-radius:10px;padding:8px 10px;margin-top:4px;border:1px solid var(--glass-border);">
<div style="display:flex;justify-content:space-between;padding-bottom:5px;margin-bottom:2px;">
<span style="font-size:0.62rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;">Material</span>
<span style="display:flex;gap:10px;">
<span style="font-size:0.62rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;">Qty Used</span>
<span style="font-size:0.62rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;min-width:60px;text-align:right;">Cost</span>
</span>
</div>
${rowsHtml}
</div>
</div>`;
}
const div = document.createElement('div');
div.className = 'factory-history-item';
if (entry.date) div.setAttribute('data-date', entry.date);
div.innerHTML = `
<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:5px;margin-bottom:8px;border-bottom:1px solid var(--glass-border);padding-bottom:5px;">
<div style="display:flex;align-items:center;flex-wrap:wrap;gap:5px;">
<span class="u-fs-sm2 u-text-muted">${dateStr}</span>
${entry.managedBy ? `<span class="managed-by-badge">${esc(entry.managedBy)}</span>` : ''}
${entry.createdBy && typeof _creatorBadgeHtml === 'function' ? _creatorBadgeHtml(entry) : ''}
</div>
<div style="display:flex;gap:6px;align-items:center;">
${_mergedBadgeHtml(entry)}
<span class="factory-badge ${badgeClass}">${formulaLabel}</span>
</div>
</div>
<div class="factory-summary-row"><span class="factory-summary-label">Units Produced</span><span class="qty-val">${entry.units}</span></div>
<div class="factory-summary-row"><span class="factory-summary-label">Material Cost</span><span class="cost-val">${await formatCurrency(entry.materialsCost || 0)}</span></div>
${totalAdditionalCost > 0 ? `<div class="factory-summary-row"><span class="factory-summary-label">Additional Cost</span><span class="cost-val">${await formatCurrency(totalAdditionalCost)}</span></div>` : ''}
<div class="factory-summary-row"><span class="factory-summary-label">Per Unit Cost</span><span class="cost-val">${await formatCurrency(perUnitCost)}</span></div>
<div class="factory-summary-row"><span class="factory-summary-label">Total Cost</span><span class="rev-val">${await formatCurrency(entry.totalCost)}</span></div>
<div class="factory-summary-row"><span class="factory-summary-label">Raw Materials Used</span><span class="qty-val">${safeNumber(entry.rawMaterialsUsed, 0).toFixed(2)} kg</span></div>
${matsBreakdownHtml}
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
? _feFormula.map(f => {
let inv = factoryInventoryData.find(i => i.id === f.id);
if (!inv && f.name) inv = factoryInventoryData.find(i => i.name && i.name.trim().toLowerCase() === f.name.trim().toLowerCase());
return ` • ${inv?.name || f.name || 'Material'}: ${(f.quantity * entry.units).toFixed(2)} kg restored`;
}).join('\n')
: '';
let _feMsg = `Delete this factory production batch permanently?`;
_feMsg += `\nStore: ${_feStoreLabel}\nDate: ${entry.date}\nUnits Produced: ${entry.units}`;
if (entry.totalCost) _feMsg += `\nTotal Cost: ${fmtAmt(entry.totalCost || 0)}`;
_feMsg += _feMatsDetail ? `\n\n↩ Raw materials restored to inventory:\n${_feMatsDetail}` : `\n\n↩ Raw materials used in this batch will be restored to inventory.`;
_feMsg += `\n\n Sales already made from this batch will NOT be reversed — but available stock will change.\n\nThis cannot be undone.`;
if (await showGlassConfirm(_feMsg, { title: 'Delete Factory Production', confirmText: 'Delete', danger: true })) {
try {
entry.deletedAt = getTimestamp();
entry.updatedAt = getTimestamp();
ensureRecordIntegrity(entry, true);
let restoredMaterials = [];
const formula = factoryDefaultFormulas[entry.store];
if (formula && formula.length > 0) {
for (const formulaItem of formula) {
const materialToRestore = formulaItem.quantity * entry.units;
let inventoryItem = factoryInventoryData.find(i => i.id === formulaItem.id);
if (!inventoryItem && formulaItem.name) {
inventoryItem = factoryInventoryData.find(i => i.name && i.name.trim().toLowerCase() === formulaItem.name.trim().toLowerCase());
}
if (inventoryItem) {
inventoryItem.quantity += materialToRestore;
inventoryItem.totalValue = inventoryItem.quantity * inventoryItem.cost;
if (inventoryItem.conversionFactor && inventoryItem.conversionFactor !== 1) {
inventoryItem.purchaseQuantity = inventoryItem.quantity / inventoryItem.conversionFactor;
}
inventoryItem.updatedAt = getTimestamp();
ensureRecordIntegrity(inventoryItem, true);
restoredMaterials.push({ name: inventoryItem.name || 'Unknown', quantity: materialToRestore });
}
}
}
factoryProductionHistory.splice(entryIndex, 1);
const inventoryIds = factoryInventoryData.filter(i => i && i.id).map(i => i.id);
await Promise.all([
unifiedDelete('factory_production_history', factoryProductionHistory, id, { strict: true }, entry),
unifiedSave('factory_inventory_data', factoryInventoryData, null, inventoryIds)
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
} catch (error) {
showToast(' Failed to delete entry. Please try again.', 'error');
}
}
}

async function calculateDynamicCost(storeType, formulaUnits, netWeight) {
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
let formulaStore = 'standard';
if (storeType === 'standard' || storeType === 'asaan') {
  formulaStore = storeType;
} else if (typeof getStoreFormulaType === 'function') {
  formulaStore = await getStoreFormulaType(storeType);
} else {
  formulaStore = storeType === 'STORE_C' ? 'asaan' : 'standard';
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

const _appStores = (typeof getAppStores === 'function') ? await getAppStores() : [];
const _storeTypeMap = {};
_appStores.forEach(s => { _storeTypeMap[s.key] = s.formulaType || 'standard'; });
function _resolveFormulaType(storeVal) {
  if (storeVal === 'standard' || storeVal === 'asaan') return storeVal;
  return _storeTypeMap[storeVal] || (storeVal === 'STORE_C' ? 'asaan' : 'standard');
}
factoryProductionHistory.forEach(entry => {
if (entry.store && entry.units > 0) {
const ft = entry.formulaType || _resolveFormulaType(entry.store);
if (!tracking[ft]) tracking[ft] = { produced: 0, consumed: 0, available: 0, unitCostHistory: [] };
tracking[ft].produced += entry.units;
if (entry.totalCost && entry.units > 0) {
tracking[ft].unitCostHistory.push({ date: entry.date, costPerUnit: entry.totalCost / entry.units, units: entry.units });
}
}
});
db.forEach(entry => {
if (entry.isReturn) return;
const formulaStore = entry.formulaStore || _resolveFormulaType(entry.store);
if (!tracking[formulaStore]) tracking[formulaStore] = { produced: 0, consumed: 0, available: 0, unitCostHistory: [] };
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
await updateUnitsAvailableIndicator(tracking);
updateFactoryUnitsAvailableStats();
updateFactorySummaryCard();
return tracking;
}

async function validateFormulaAvailability(storeType, requestedUnits) {
const factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
let formulaStore = 'standard';
if (storeType === 'standard' || storeType === 'asaan') {
  formulaStore = storeType;
} else if (typeof getStoreFormulaType === 'function') {
  formulaStore = await getStoreFormulaType(storeType);
} else {
  formulaStore = storeType === 'STORE_C' ? 'asaan' : 'standard';
}
const available = factoryUnitTracking[formulaStore]?.available || 0;
return { available, sufficient: available >= requestedUnits, deficit: Math.max(0, requestedUnits - available) };
}

async function updateUnitsAvailableIndicator(preloadedTracking) {
const factoryUnitTracking = preloadedTracking || (await sqliteStore.get('factory_unit_tracking')) || {};
const store = document.getElementById('storeSelector').value;
if (!store) return;
const formulaStore = typeof getStoreFormulaType === 'function' ? await getStoreFormulaType(store) : (store === 'STORE_C' ? 'asaan' : 'standard');
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
if (!store) return;
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
if (!store) return;
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
if (_dpSalesOnDate > 0) confirmMsg += `\n\n ${_dpSalesOnDate} sale${_dpSalesOnDate !== 1 ? 's' : ''} on this date for ${_dpStoreLabel} will remain on record, but available stock will drop.`;
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
