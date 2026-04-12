
async function toggleCustomerCreditReceived(id, event) {
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
if (event) {
event.preventDefault();
event.stopPropagation();
}
const saleIndex = customerSales.findIndex(item => item.id === id);
if (saleIndex !== -1) {
customerSales[saleIndex].creditReceived = !customerSales[saleIndex].creditReceived;
if (customerSales[saleIndex].creditReceived) {
customerSales[saleIndex].paymentType = 'CASH';
}
if (!customerSales[saleIndex].currentRepProfile) {
customerSales[saleIndex].currentRepProfile = 'admin';
}
customerSales[saleIndex].updatedAt = getTimestamp();
customerSales[saleIndex] = ensureRecordIntegrity(customerSales[saleIndex], true);
await unifiedSave('customer_sales', customerSales, customerSales[saleIndex]);
refreshCustomerSales();
updateCustomerCharts();
}
}

async function calculateComparisonData() {
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const salesHistory = ensureArray(await sqliteStore.get('noman_history'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
const compMode = currentCompMode;
const _sdEl = document.getElementById('sale-date');
const selectedDate = _sdEl ? _sdEl.value : new Date().toISOString().split('T')[0];
const selectedDateObj = new Date(selectedDate);
const selectedYear = selectedDateObj.getFullYear();
const selectedMonth = selectedDateObj.getMonth();
const selectedDay = selectedDateObj.getDate();
let history; history = await sqliteStore.get('noman_history', []);
const comp = {};
salesRepsList.forEach(rep => { comp[rep] = {prof:0, rev:0, sold:0, ret:0, exp:0, cred:0, cash:0, coll:0, giv:0, cost:0}; });
history.forEach(h => {
const hDate = new Date(h.date);
const hYear = hDate.getFullYear();
const hMonth = hDate.getMonth();
const hDay = hDate.getDate();
let includeInComp = false;
if (compMode === 'all') includeInComp = true;
else if (compMode === 'week') {
const weekStart = new Date(selectedDateObj);
weekStart.setDate(selectedDay - 6);
if(hDate >= weekStart && hDate <= selectedDateObj) includeInComp = true;
}
else if (compMode === 'month' && hYear === selectedYear && hMonth === selectedMonth) includeInComp = true;
else if (compMode === 'year' && hYear === selectedYear) includeInComp = true;
if(includeInComp && comp[h.seller]) {
comp[h.seller].prof += h.profit;
comp[h.seller].rev += h.revenue;
comp[h.seller].cost += (h.totalCost || 0);
comp[h.seller].sold += h.totalSold;
comp[h.seller].ret += h.returned;
comp[h.seller].exp += (h.expired || 0);
comp[h.seller].cred += h.creditQty;
comp[h.seller].cash += h.cashQty;
comp[h.seller].coll += h.prevColl;
comp[h.seller].giv += h.creditValue;
}
});
return comp;
}

function createReportHTML(title, data, isHistory = false, id = null, sellerName = null, isHighlight = false, isMerged = false) {
const creditVal = safeValue(data.creditVal);
const collected = safeValue(data.collected);
const balance = creditVal - collected;
const received = safeValue(data.received);
const expected = safeValue(data.expected);
const discrepancy = received - expected;
const balClass = balance > 0 ? 'balance-pos' : 'balance-neg';
let discClass = 'qty-val';
let discText = `${fmtAmt(Math.abs(discrepancy))}`;
if (Math.abs(discrepancy) < 0.01) {
discClass = 'units-available-good';
discText = "Perfect Match";
} else if (discrepancy < 0) {
discClass = 'cost-val';
discText = `SHORT: ${fmtAmt(Math.abs(discrepancy))}`;
} else {
discClass = 'profit-val';
discText = `OVER: ${fmtAmt(discrepancy)}`;
}
const displayStatusText = data.statusText || discText;
const displayStatusClass = data.statusClass || (Math.abs(discrepancy) < 0.01 ? 'result-box discrepancy-ok' : 'result-box discrepancy-alert');
const badge = sellerName ? `<span class="seller-badge ${salesRepsList.indexOf(sellerName) === 0 ? 'noran-badge' : 'noman-badge'}">${sellerName.split(' ')[0]}</span>` : '';
const mergedBadge = isMerged ? _mergedBadgeHtml({ isMerged: true, mergedRecordCount: data.mergedRecordCount, mergedSummary: data.mergedSummary }, {inline:true}) : '';
const highlightClass = isHighlight ? 'highlight-card' : '';
const dateAttr = (isHistory && data._rawDate) ? ` data-date="${data._rawDate}"` : '';
let html = `<div class="card liquid-card ${highlightClass}"${dateAttr}>${badge}<h4>${esc(title)}${mergedBadge}</h4>
<p><span>Total Sold:</span> <span class="qty-val">${safeValue(data.sold).toFixed(2)}</span></p>
<p><span>Returned:</span> <span class="qty-val">${safeValue(data.ret).toFixed(2)}</span></p>
${safeValue(data.expired) > 0 ? `<p><span>Expired (→ CHORA):</span> <span class="cost-val">${safeValue(data.expired).toFixed(2)}</span></p>` : ''}
<p><span>Cash Qty:</span> <span class="qty-val">${safeValue(data.cash).toFixed(2)}</span></p>
<p><span>Credit Qty:</span> <span class="qty-val">${safeValue(data.cred).toFixed(2)}</span></p>
<hr>
<p><span>Revenue:</span> <span class="rev-val">${fmtAmt(safeValue(data.revenue))}</span></p>
<p><span>Profit:</span> <span class="profit-val">${fmtAmt(safeValue(data.profit))}</span></p>
<p><span>Credit Out:</span> <span class="cost-val">${fmtAmt(creditVal)}</span></p>
<p><span>Credit In:</span> <span class="profit-val">${fmtAmt(collected)}</span></p>
<p><span>Net Debt:</span> <span class="${balClass}">${fmtAmt(balance)}</span></p>
<hr>
<p><span>Expected Cash:</span> <span class="qty-val" style="color:var(--text-main);">${fmtAmt(expected)}</span></p>
<p><span>Received Cash:</span> <span class="qty-val" style="font-weight:800; color:var(--text-main);">${safeNumber(received, 0).toFixed(2)}</span></p>
<p><span>Discrepancy:</span> <span class="${discClass}">${discText}</span></p>
`;
if (isHistory) {
html += `
<div style="padding: 8px; border-radius: 6px; text-align: center; margin-top: 8px; font-size: 10px;" class="${displayStatusClass}">${displayStatusText}</div>`;
if (!isMerged) {
html += `<button class="tbl-action-btn danger u-w-full u-mt-8" onclick="deleteSalesEntry('${id}')">Delete</button>`;
}
}
html += `</div>`;
return html;
}

async function calculateTotalSoldForRepresentative(seller) {
const salesHistory = ensureArray(await sqliteStore.get('noman_history'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
if (!seller || seller === 'COMBINED') return 0;
const reconciledSalesIds = new Set();
if (Array.isArray(salesHistory)) {
  salesHistory.forEach(entry => {
    if (Array.isArray(entry.linkedSalesIds)) {
      entry.linkedSalesIds.forEach(id => reconciledSalesIds.add(id));
    }
  });
}
let totalSold = 0;
(Array.isArray(customerSales) ? customerSales : []).forEach(sale => {
  if (sale.currentRepProfile === 'admin' &&
      sale.customerName === seller &&
      sale.paymentType === 'CREDIT' &&
      !sale.creditReceived &&
      !reconciledSalesIds.has(sale.id) &&
      sale.transactionType !== 'OLD_DEBT') {
    totalSold += (sale.quantity || 0);
  }
});
return totalSold;
}

async function autoFillTotalSoldQuantity() {
const salesHistory = ensureArray(await sqliteStore.get('noman_history'));
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const seller = document.getElementById('sellerSelect').value;
const date = document.getElementById('sale-date').value;
const totalSoldField = document.getElementById('totalSold');
const creditSalesField = document.getElementById('creditSales');
const recoveredField = document.getElementById('prevCreditReceived');
if (!totalSoldField) return;
if (seller === 'COMBINED') {
totalSoldField.value = '';
totalSoldField.readOnly = true;
return;
}
const totalSold = await calculateTotalSoldForRepresentative(seller);
totalSoldField.value = safeNumber(totalSold, 0).toFixed(2);
totalSoldField.readOnly = true;
totalSoldField.style.background = 'rgba(37, 99, 235, 0.1)';
totalSoldField.style.color = 'var(--accent)';
totalSoldField.style.fontWeight = 'bold';
totalSoldField.style.border = '1px solid var(--accent)';
const usedRepSaleIds = new Set();
if (Array.isArray(salesHistory)) {
  salesHistory.forEach(calcEntry => {
    if (calcEntry.linkedRepSalesIds && Array.isArray(calcEntry.linkedRepSalesIds)) {
      calcEntry.linkedRepSalesIds.forEach(id => usedRepSaleIds.add(id));
    }
  });
}
(Array.isArray(repSales) ? repSales : []).forEach(sale => {
  if (sale.usedInCalcId) usedRepSaleIds.add(sale.id);
});
let creditSalesKg = 0;
let recoveredCash = 0;
(Array.isArray(repSales) ? repSales : []).forEach(sale => {
  if (sale.salesRep === seller && sale.date === date && !usedRepSaleIds.has(sale.id)) {
    if (sale.paymentType === 'CREDIT') {
      creditSalesKg += (sale.quantity || 0);
    }
    if (sale.paymentType === 'COLLECTION') {
      recoveredCash += (sale.totalValue || 0);
    }
  }
});
if(creditSalesField) {
creditSalesField.value = safeNumber(creditSalesKg, 0).toFixed(2);
styleAutoFilledField(creditSalesField);
}
if(recoveredField) {
recoveredField.value = safeNumber(recoveredCash, 0).toFixed(2);
styleAutoFilledField(recoveredField);
}
calculateSales();
}

function styleAutoFilledField(field) {
field.style.background = 'rgba(5, 150, 105, 0.1)';
field.style.color = 'var(--accent-emerald)';
field.style.fontWeight = 'bold';
field.style.border = '1px solid var(--accent-emerald)';
}

async function loadSalesData(compMode = 'all') {
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const salesHistory = ensureArray(await sqliteStore.get('noman_history'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
currentCompMode = compMode;
['week', 'month', 'year', 'all'].forEach(m => {
const btn = document.getElementById(`comp-${m}-btn`);
if(btn) btn.className = `toggle-opt ${m === compMode ? 'active' : ''}`;
});
const _sellerEl = document.getElementById('sellerSelect');
const _saleDateEl = document.getElementById('sale-date');
if (!_sellerEl || !_saleDateEl) return;
const seller = _sellerEl.value;
const searchDate = _saleDateEl.value;
autoFillTotalSoldQuantity();
const isCombined = seller === "COMBINED";
const label = isCombined ? "Combined" : seller;
const _setSel = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
_setSel('reportSellerName', label);
_setSel('debtSellerName', label);
_setSel('selectedSellerName', label);
const entrySection = document.getElementById('entrySection'); if (entrySection) entrySection.className = isCombined ? "hidden" : "";
const combinedSection = document.getElementById('combinedSection'); if (combinedSection) combinedSection.className = isCombined ? "" : "hidden";
const indChart = document.getElementById('individualChartSection'); if (indChart) indChart.className = isCombined ? "hidden" : "";
let history = await sqliteStore.get('noman_history', []);
if (!Array.isArray(history)) history = [];
let displayList = isCombined ? history : history.filter(h => h.seller === seller);
displayList.sort((a,b) => {
if (a.date === searchDate && b.date !== searchDate) return -1;
if (a.date !== searchDate && b.date === searchDate) return 1;
return b.timestamp - a.timestamp;
});
const ranges = {
d: { sold:0, ret:0, expired:0, cash:0, cred:0, creditVal:0, collected:0, profit:0, revenue:0, expected:0, received:0 },
w: { sold:0, ret:0, expired:0, cash:0, cred:0, creditVal:0, collected:0, profit:0, revenue:0, expected:0, received:0 },
m: { sold:0, ret:0, expired:0, cash:0, cred:0, creditVal:0, collected:0, profit:0, revenue:0, expected:0, received:0 },
y: { sold:0, ret:0, expired:0, cash:0, cred:0, creditVal:0, collected:0, profit:0, revenue:0, expected:0, received:0 },
a: { sold:0, ret:0, expired:0, cash:0, cred:0, creditVal:0, collected:0, profit:0, revenue:0, expected:0, received:0 }
};
const list = document.getElementById('historyList');
const _hlParts = [];
displayList.forEach(h => {
const isHighlight = h.date === searchDate;
const dateTitle = isHighlight ? `${formatDisplayDateTime(h.date, h.time || null)} (Selected)` : formatDisplayDateTime(h.date, h.time || null);
_hlParts.push(createReportHTML(
dateTitle,
{
sold: h.totalSold,
ret: h.returned,
expired: h.expired,
cash: h.cashQty,
cred: h.creditQty,
revenue: h.revenue,
profit: h.profit,
creditVal: h.creditValue,
collected: h.prevColl,
expected: h.totalExpected,
received: h.received,
statusClass: h.statusClass,
statusText: h.statusText,
_rawDate: h.date
},
true, h.id, isCombined ? h.seller : null, isHighlight, h.isMerged
));
});
if (list) list.innerHTML = _hlParts.join('');
const validSearchDate = searchDate || new Date().toISOString().split('T')[0];
const now = new Date(validSearchDate);
if (isNaN(now.getTime())) {
now.setTime(Date.now());
}
const weekStart = new Date(now);
weekStart.setDate(now.getDate() - 6);
let ltCr = 0, ltCl = 0;
const debtFilterList = isCombined ? history : history.filter(h => h.seller === seller);
debtFilterList.forEach(h => {
if (!h.date) return;
const hDate = new Date(h.date);
if (isNaN(hDate.getTime())) {
return;
}
ltCr += (h.creditValue || 0);
ltCl += (h.prevColl || 0);
if(h.date === searchDate) addToRange(ranges.d, h);
if(hDate >= weekStart && hDate <= now) addToRange(ranges.w, h);
if(hDate.getMonth() === now.getMonth() && hDate.getFullYear() === now.getFullYear()) addToRange(ranges.m, h);
if(hDate.getFullYear() === now.getFullYear()) addToRange(ranges.y, h);
addToRange(ranges.a, h);
});
const _dr = document.getElementById('dailyReport'); if (_dr) _dr.innerHTML = createReportHTML("Daily View", ranges.d);
const _wr = document.getElementById('weeklyReport'); if (_wr) _wr.innerHTML = createReportHTML("Weekly View", ranges.w);
const _mr = document.getElementById('monthlyReport'); if (_mr) _mr.innerHTML = createReportHTML("Monthly View", ranges.m);
const _yr = document.getElementById('yearlyReport'); if (_yr) _yr.innerHTML = createReportHTML("Yearly View", ranges.y);
const _ar = document.getElementById('allTimeReport'); if (_ar) _ar.innerHTML = createReportHTML("All Time Summary", ranges.a);
if (typeof setPerfOverviewMode === 'function') setPerfOverviewMode(currentPerfOverviewMode || 'day');
const _saleDate = (document.getElementById('sale-date') || {}).value || new Date().toISOString().split('T')[0];
_filterHistoryByPeriod('#historyList', _saleDate, currentPerfOverviewMode || 'day');
const _setLt = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
_setLt('ltCredit', "" + safeValue(ltCr).toFixed(2));
_setLt('ltCollected', "" + safeValue(ltCl).toFixed(2));
_setLt('ltBalance', "" + safeValue(ltCr - ltCl).toFixed(2));
if(isCombined) {
const comp = await calculateComparisonData();
updateSalesCharts(comp);
const repNames = salesRepsList;
const bestProfit = Math.max(...repNames.map(r => (comp[r]||{prof:0}).prof));
const compHead = document.getElementById('comparisonHead');
if (compHead) {
compHead.innerHTML = '<tr><th>Metric</th>' +
repNames.map(r => {
const isWinner = (comp[r]||{prof:0}).prof >= bestProfit && bestProfit > 0;
const firstName = r.split(' ')[0].charAt(0) + r.split(' ')[0].slice(1).toLowerCase();
return `<th id="th-rep-${r.replace(/\s+/g,'-')}">${firstName}</th>`;
}).join('') +
'</tr>';
}
const metrics = [
{ label: 'Qty Sold', key: 'sold', cls: null },
{ label: 'Returns', key: 'ret', cls: null },
{ label: 'Expired (→ CHORA)', key: 'exp', cls: 'cost-val' },
{ label: 'Total Cost', key: 'cost', cls: 'cost-val' },
{ label: 'Gross Revenue', key: 'rev', cls: 'rev-val' },
{ label: 'Net Profit', key: 'prof', cls: 'profit-val', winner: true },
{ label: 'Credit Issued', key: 'giv', cls: null },
{ label: 'Credit Recovered', key: 'coll', cls: null },
];
document.getElementById('comparisonBody').innerHTML = metrics.map(m => {
const cells = repNames.map(r => {
const val = fmtAmt(safeValue((comp[r]||{})[m.key]));
const style = m.key === 'cost' ? ' style="color:var(--danger)"' : m.key === 'coll' ? ' style="color:var(--accent)"' : '';
const cls = m.cls ? ` class="${m.cls}"` : '';
return `<td${cls}${style}>${val}</td>`;
}).join('');
const rowCls = m.winner ? ' class="winner-cell"' : '';
return `<tr${rowCls}><td>${m.label}</td>${cells}</tr>`;
}).join('');
} else {
await updateIndChart();
}
}

function addToRange(range, h) {
range.sold += h.totalSold;
range.ret += h.returned;
range.expired = (range.expired || 0) + (h.expired || 0);
range.cash += h.cashQty;
range.cred += h.creditQty;
range.creditVal += h.creditValue;
range.collected += h.prevColl;
range.profit += h.profit;
range.revenue += h.revenue;
range.expected += (h.totalExpected || 0);
range.received += (h.received || 0);
}

function updateSalesCharts(comp) {

if(!comp) return;
const selectedMetric = document.getElementById('metricSelector').value;
const metricLabel = document.getElementById('metricSelector').options[document.getElementById('metricSelector').selectedIndex].text;
const colors = {
text: '#1e3a8a',
grid: 'rgba(37, 99, 235, 0.1)'
};
const perfChartElement = document.getElementById('performanceChart');
if (!perfChartElement) { return; }
const repChartColors = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2'];
const repNames = salesRepsList;
const chartLabels = repNames.map(r => r.split(' ').map(w => w[0]+w.slice(1).toLowerCase()).join(' '));
const chartData = repNames.map(r => (comp[r] || {})[selectedMetric] || 0);
const chartColors = repNames.map((_, i) => repChartColors[i % repChartColors.length]);
if(salesPerfChart) salesPerfChart.destroy();
salesPerfChart = new SarimChart(perfChartElement, {
type: 'bar',
data: {
labels: chartLabels,
datasets: [{
label: metricLabel,
data: chartData,
backgroundColor: chartColors,
borderRadius: 6
}]
},
options: {
responsive: true,
maintainAspectRatio: false,
plugins: { legend: { display: false } },
scales: {
y: { beginAtZero: true, grid: { color: colors.grid }, ticks: { color: colors.text } },
x: { ticks: { color: colors.text } }
}
}
});
const totalCashValue = repNames.reduce((s, r) => s + ((comp[r]||{}).rev||0) - ((comp[r]||{}).giv||0), 0);
const totalCreditValue = repNames.reduce((s, r) => s + ((comp[r]||{}).giv||0), 0);
const totalSold = repNames.reduce((s, r) => s + ((comp[r]||{}).sold||0), 0);
const totalReturned = repNames.reduce((s, r) => s + ((comp[r]||{}).ret||0), 0);
const totalRevenue = repNames.reduce((s, r) => s + ((comp[r]||{}).rev||0), 0);
const avgPrice = totalSold > 0 ? totalRevenue / totalSold : 0;
const totalReturnValue = totalReturned * avgPrice;
const pieData = [totalCashValue, totalCreditValue, totalReturnValue];
const pieLabels = ['Cash Sale Value', 'Credit Value', 'Return Value'];
const compChartElement = document.getElementById('compositionChart');
if (!compChartElement) { return; }
if(salesCompChart) salesCompChart.destroy();
salesCompChart = new SarimChart(compChartElement, {
type: 'pie',
data: {
labels: pieLabels,
datasets: [{
data: pieData,
backgroundColor: ['#059669', '#f59e0b', '#dc2626'],
borderWidth: 0,
hoverOffset: 8
}]
},
options: {
responsive: true,
maintainAspectRatio: true,
plugins: {
legend: { position: 'bottom', labels: { color: colors.text, boxWidth: 12, font: { size: 10 } } },
title: {
display: true,
text: 'Market Composition',
color: colors.text,
font: { size: 13, weight: 'bold' }
}
}
}
});
}

async function processReturnToProduction(storeKey, quantity, date, seller) {
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
const now = new Date();
let hours = now.getHours();
const minutes = now.getMinutes();
const seconds = now.getSeconds();
const ampm = hours >= 12 ? 'PM' : 'AM';
hours = hours % 12;
hours = hours ? hours : 12;
const timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')} ${ampm}`;
const formulaStore = typeof getStoreFormulaType === 'function' ? await getStoreFormulaType(storeKey) : (storeKey === 'STORE_C' ? 'asaan' : 'standard');
const salePrice = getSalePriceForStore(storeKey);
const costPerKg = getCostPriceForStore(storeKey);
const totalCost = quantity * costPerKg;
const totalSale = quantity * salePrice;
const profit = totalSale - totalCost;
const retCreatedAt = Date.now();
let _retId = generateUUID('ret');
if (!validateUUID(_retId)) _retId = generateUUID('ret');
let returnEntry = {
id: _retId,
date: date,
time: timeString,
store: storeKey,
net: quantity,
cp: costPerKg,
sp: salePrice,
totalCost: totalCost,
totalSale: totalSale,
profit: profit,
formulaUnits: 0,
formulaStore: formulaStore,
formulaCost: 0,
paymentStatus: 'CASH',
createdAt: retCreatedAt,
updatedAt: retCreatedAt,
timestamp: retCreatedAt,
isReturn: true,
returnedBy: seller,
returnNote: `Returned by ${seller}`,
syncedAt: new Date().toISOString()
};
returnEntry = ensureRecordIntegrity(returnEntry, false);
db.push(returnEntry);
await unifiedSave('mfg_pro_pkr', db, returnEntry);
let _retLogId = generateUUID('retlog');
if (!validateUUID(_retLogId)) _retLogId = generateUUID('retlog');
let returnLogEntry = {
id: _retLogId,
date: date,
time: timeString,
store: storeKey,
quantity: quantity,
seller: seller,
createdAt: retCreatedAt,
updatedAt: retCreatedAt,
timestamp: retCreatedAt,
syncedAt: new Date().toISOString()
};
returnLogEntry = ensureRecordIntegrity(returnLogEntry, false);
stockReturns.push(returnLogEntry);
await unifiedSave('stock_returns', stockReturns, returnLogEntry);
}

async function reverseReturnFromProduction(storeKey, quantity, date) {
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
const returnEntry = db.find(item =>
item.store === storeKey &&
item.net === quantity &&
item.date === date &&
item.isReturn === true
);
if (returnEntry) {
await unifiedDelete('mfg_pro_pkr', db, returnEntry.id, { strict: true }, returnEntry);
}
const returnLogEntry = stockReturns.find(r =>
r.store === storeKey &&
r.quantity === quantity &&
r.date === date
);
if (returnLogEntry) {
await unifiedDelete('stock_returns', stockReturns, returnLogEntry.id, { strict: true }, returnLogEntry);
}
}
const CHORA_MATERIAL_NAME = 'CHORA';
async function processExpiredToChora(quantity, date, seller) {
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
if (!quantity || quantity <= 0) return;
let choraMaterial = factoryInventoryData.find(m => m.name && m.name.toUpperCase() === CHORA_MATERIAL_NAME);
if (!choraMaterial) {
const reloadedData = await sqliteStore.get('factory_inventory_data', []);
if (Array.isArray(reloadedData)) {
choraMaterial = factoryInventoryData.find(m => m.name && m.name.toUpperCase() === CHORA_MATERIAL_NAME);
}
}
if (!choraMaterial) {
showToast(` CHORA material not found in factory inventory. Expired qty (${quantity}) was recorded but not added to raw materials.`, 'warning', 5000);
return;
}
choraMaterial.quantity = (choraMaterial.quantity || 0) + quantity;
choraMaterial.totalValue = choraMaterial.quantity * (choraMaterial.cost || 0);
choraMaterial.updatedAt = getTimestamp();
choraMaterial.lastExpiredAddedAt = date;
choraMaterial.lastExpiredAddedBy = seller;
ensureRecordIntegrity(choraMaterial, true);
await unifiedSave('factory_inventory_data', factoryInventoryData, choraMaterial);
emitSyncUpdate({ factory_inventory_data: null});
notifyDataChange('factory');
}

async function reverseExpiredFromChora(quantity, date) {
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
if (!quantity || quantity <= 0) return;
let choraMaterial = factoryInventoryData.find(m => m.name && m.name.toUpperCase() === CHORA_MATERIAL_NAME);
if (!choraMaterial) {
const reloadedData = await sqliteStore.get('factory_inventory_data', []);
if (Array.isArray(reloadedData)) {
choraMaterial = factoryInventoryData.find(m => m.name && m.name.toUpperCase() === CHORA_MATERIAL_NAME);
}
}
if (!choraMaterial) {
showToast(` CHORA material not found. Could not reverse expired qty (${quantity}).`, 'warning', 5000);
return;
}
choraMaterial.quantity = Math.max(0, (choraMaterial.quantity || 0) - quantity);
choraMaterial.totalValue = choraMaterial.quantity * (choraMaterial.cost || 0);
choraMaterial.updatedAt = getTimestamp();
ensureRecordIntegrity(choraMaterial, true);
await unifiedSave('factory_inventory_data', factoryInventoryData, choraMaterial);
emitSyncUpdate({ factory_inventory_data: null});
notifyDataChange('factory');
}

function formatCurrency(num) {
if (typeof num !== 'number') num = parseFloat(num) || 0;
if (isNaN(num) || !isFinite(num)) num = 0;
return String(num.toFixed(2));
}

function safeValue(value) {
return isNaN(value) || !isFinite(value) ? 0 : value;
}

async function refreshAllDisplays() {

const _radBatch = await sqliteStore.getBatch([
'mfg_pro_pkr','customer_sales','rep_sales','noman_history',
'payment_transactions','payment_entities','expenses','stock_returns',
'factory_inventory_data','factory_production_history',
'factory_default_formulas','factory_additional_costs',
'factory_sale_prices','factory_cost_adjustment_factor',
'factory_unit_tracking','deleted_records',
]);
const db = ensureArray(_radBatch.get('mfg_pro_pkr'));
const customerSales = ensureArray(_radBatch.get('customer_sales'));
const repSales = ensureArray(_radBatch.get('rep_sales'));
const salesHistory = ensureArray(_radBatch.get('noman_history'));
const paymentTransactions = ensureArray(_radBatch.get('payment_transactions'));
const paymentEntities = ensureArray(_radBatch.get('payment_entities'));
const expenseRecords = ensureArray(_radBatch.get('expenses'));
const stockReturns = ensureArray(_radBatch.get('stock_returns'));
const factoryInventoryData = ensureArray(_radBatch.get('factory_inventory_data'));
const factoryProductionHistory = ensureArray(_radBatch.get('factory_production_history'));
const factoryDefaultFormulas = _radBatch.get('factory_default_formulas') || {};
const factoryAdditionalCosts = _radBatch.get('factory_additional_costs') || {};
const factorySalePrices = _radBatch.get('factory_sale_prices') || {};
const factoryCostAdjustmentFactor = _radBatch.get('factory_cost_adjustment_factor') || {};
const factoryUnitTracking = _radBatch.get('factory_unit_tracking') || {};
const deletedRecordIds = new Set(ensureArray(_radBatch.get('deleted_records')));

await Promise.all([

  (async () => {
    try { await syncFactoryProductionStats(); } catch (e) { console.error('syncFactoryProductionStats failed.', _safeErr(e)); }
    try { if (typeof refreshUI === 'function') await refreshUI(1, true); } catch (e) { console.error('refreshUI failed.', _safeErr(e)); }
  })(),

  (async () => {
    try {
      if (typeof refreshCustomerSales === 'function') await refreshCustomerSales(1, true);
      else if (typeof renderCustomersTable === 'function') renderCustomersTable();
    } catch (e) { console.error('refreshCustomerSales failed.', _safeErr(e)); }
  })(),

  (async () => {
    try { if (typeof loadSalesData === 'function') await loadSalesData(currentCompMode); } catch (e) { console.error('loadSalesData failed.', _safeErr(e)); }
  })(),

  (() => {
    try { if (typeof initFactoryTab === 'function') initFactoryTab(); } catch (e) { console.error('initFactoryTab failed.', _safeErr(e)); }
  })(),

  (async () => {
    try {
      if (typeof refreshPaymentTab === 'function') await refreshPaymentTab();
      if (typeof calculateNetCash === 'function') calculateNetCash();
    } catch (e) { console.error('refreshPaymentTab failed.', _safeErr(e)); }
  })(),

  (() => {
    try {
      if (appMode === 'rep') {
        if (typeof renderRepHistory === 'function') renderRepHistory();
        if (typeof renderRepCustomerTable === 'function') renderRepCustomerTable();
      }
    } catch (e) { console.error('Rep tab refresh failed.', _safeErr(e)); }
  })(),
]);
}

window.addEventListener('unhandledrejection', function(event) {
  const err = event.reason;
  if (!err) { event.preventDefault(); return; }
  if (err instanceof DOMException) { event.preventDefault(); return; }
  if (err instanceof Error) {
    const msg = err.message || '';
    if (msg.indexOf('[DOMException]') === 0 || msg.indexOf('DOMException') !== -1) {
      event.preventDefault(); return;
    }
  }
  if (typeof err === 'string' && err.indexOf('DOMException') !== -1) {
    event.preventDefault(); return;
  }
});

document.addEventListener('DOMContentLoaded', async function _appBootstrap() {
  const urlParams = new URLSearchParams(window.location.search);
  const _action = urlParams.get('action');
  if (_action) {
    const _tabMap = { sales: 'sales', production: 'prod', calc: 'calc' };
    const _targetTab = _tabMap[_action];
    if (_targetTab) {
      let _attempts = 0;
      const _tryShowTab = () => {
        if (typeof showTab === 'function') { showTab(_targetTab); }
        else if (_attempts++ < 40) setTimeout(_tryShowTab, 100);
      };
      setTimeout(_tryShowTab, 200);
    }
  }
  updateOfflineBanner();
  updateConnectionStatus();
  const expenseNameInput = document.getElementById('expenseName');
  if (expenseNameInput) {
    expenseNameInput.addEventListener('blur', function() {
      setTimeout(() => {
        const rd = document.getElementById('expense-search-results');
        if (rd) rd.classList.add('hidden');
      }, 200);
    });
  }

  if (typeof ThemeManager !== 'undefined' && ThemeManager.init) ThemeManager.init();
  await initTheme();
  const hasFirebaseSession = await _checkFirebaseSessionExists();
  if (!hasFirebaseSession) {
    createAuthOverlay();
    showAuthOverlay();
  } else {
    try {
      let loginData = await SQLiteCrypto.sessionGet('login');
      if (!loginData || !loginData.uid) {
        const lsLogin = localStorage.getItem('persistentLogin');
        if (lsLogin) { try { loginData = JSON.parse(lsLogin); } catch(e) {} }
      }
      if (loginData && loginData.uid) {
        sqliteStore.setUserPrefix(loginData.uid);
        await SQLiteCrypto.initialize();
        const keyRestored = await SQLiteCrypto.restoreSessionKeyFromStorage();
        if (!keyRestored) {
          console.warn('Session: could not restore encryption key from storage, waiting for Firebase auth');
        }
      }
    } catch(e) {
      console.warn('Session pre-warm failed:', _safeErr(e));
    }
  }
  try {
    await loadAllData();
    await initializeDeviceListeners();
    if (typeof OfflineQueue !== 'undefined') await OfflineQueue.init();
    loadFirestoreStats();

    try { sessionStorage.setItem('_gznd_bootstrap_ran', '1'); } catch(_) {}
  } catch (e) {

    console.error('[Startup] Initialization error:', _safeErr(e));
    if (e && e.code === 'DECRYPT_FAILED') {
      console.warn('[Startup] DECRYPT_FAILED with key ready — showing auth overlay');
      if (typeof createAuthOverlay === 'function') createAuthOverlay();
      if (typeof showAuthOverlay === 'function') showAuthOverlay();
      showToast('Data could not be decrypted. Please log in again.', 'error', 7000);
      return;
    }

    showToast('Startup error — some data may not be available. Tap to retry.', 'warning', 8000);

  }
  await enforceRepModeLock();
  preventAdminAccess();
  if (typeof checkBiometricLock === 'function') await checkBiometricLock();
  const cloudMenuBtn = document.getElementById('cloudMenuBtn');
  if (cloudMenuBtn) cloudMenuBtn.style.display = (appMode === 'admin') ? '' : 'none';
  updateSyncButton();
  setTimeout(() => {
    if (typeof initializeFirebaseSystem === 'function') initializeFirebaseSystem();
    else if (typeof initFirebase === 'function') initFirebase();
  }, 100);
  const today = new Date().toISOString().split('T')[0];
  ['sys-date','sale-date','cust-date','factory-date','expenseDate','rep-date'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = today;
  });
  currentFactoryDate = today;
  if (await sqliteStore.get('bio_enabled') === 'true') {
    const bioBtn = document.getElementById('bio-toggle-btn');
    if (bioBtn) {
      const lbl = document.getElementById('bio-toggle-label');
      if (lbl) lbl.textContent = 'Disable Lock';
      bioBtn.onclick = () => { closeSidebar && closeSidebar(); disableBiometricLock(); };
      bioBtn.classList.add('active');
    }
  }
  const factoryDateEl = document.getElementById('factory-date');
  if (factoryDateEl) {
    factoryDateEl.addEventListener('change', function() {
      currentFactoryDate = this.value;
    });
  }
  const sellerSelect = document.getElementById('sellerSelect');
  const saleDate2 = document.getElementById('sale-date');
  if (sellerSelect) sellerSelect.addEventListener('change', autoFillTotalSoldQuantity);
  if (saleDate2) saleDate2.addEventListener('change', autoFillTotalSoldQuantity);

  initSplashScreen();
  setProductionView('store');
  requestAnimationFrame(async () => {
    await syncFactoryProductionStats().catch(e => console.warn('[refreshFactoryTab] stats failed:', _safeErr(e)));
    updateAllTabsWithFactoryCosts();
    await refreshAllDisplays();
  if (appMode === 'rep') {
    if (typeof renderRepHistory === 'function') renderRepHistory();
    if (typeof renderRepCustomerTable === 'function') renderRepCustomerTable();
  }
  loadSalesRepsList();
  setTimeout(() => {
    if (typeof generateUUID === 'function') {
      const saleIdEl = document.getElementById('new-sale-id-display');
      if (saleIdEl) { const id = generateUUID('sale'); saleIdEl.textContent = 'ID: ' + id.split('-').slice(0,2).join('-') + '\u2026'; saleIdEl.title = id; }
      const expIdEl = document.getElementById('expense-id-display');
      if (expIdEl) { const id2 = generateUUID('exp'); expIdEl.textContent = 'ID: ' + id2.split('-').slice(0,2).join('-') + '\u2026'; expIdEl.title = id2; }
    }
  }, 400);
  });
  scheduleAutomaticCleanup();
  setTimeout(() => validateAllDataOnStartup(), 5000);
  if (window._connectionCheckInterval) clearInterval(window._connectionCheckInterval);
  window._connectionCheckInterval = setInterval(() => {
    if (isConnectionStale()) {
      if (firebaseDB && currentUser && !isReconnecting) scheduleListenerReconnect();
    }
  }, 120000);
  if (window._perfMonitorInterval) clearInterval(window._perfMonitorInterval);
  window._perfMonitorInterval = setInterval(() => {
    if (typeof PerformanceMonitor !== 'undefined') PerformanceMonitor.report();
  }, 60000);
  setTimeout(() => {
    const splash = document.getElementById('splash-screen');
    if (splash) splash.style.display = 'none';
  }, 800);
});
function _filterFactoryHistoryByMode(mode) {
const selectedDateVal = (document.getElementById('factory-date') || {}).value || new Date().toISOString().split('T')[0];
const selectedDate = new Date(selectedDateVal);
if (isNaN(selectedDate.getTime())) return;
const weekStart = new Date(selectedDate);
weekStart.setDate(selectedDate.getDate() - 6);
document.querySelectorAll('#factoryHistoryList .factory-history-item').forEach(item => {
const ds = item.getAttribute('data-date');
if (!ds) { item.style.display = ''; return; }
const cd = new Date(ds);
if (isNaN(cd.getTime())) { item.style.display = ''; return; }
let show = false;
if (mode === 'daily') show = (ds === selectedDateVal);
else if (mode === 'weekly') show = (cd >= weekStart && cd <= selectedDate);
else if (mode === 'monthly') show = (cd.getMonth() === selectedDate.getMonth() && cd.getFullYear() === selectedDate.getFullYear());
else if (mode === 'yearly') show = (cd.getFullYear() === selectedDate.getFullYear());
else show = true;
item.style.display = show ? '' : 'none';
});
}

function _filterPaymentHistoryByPeriod() {
const periodFilterEl = document.getElementById('unifiedPeriodFilter');
const period = periodFilterEl ? periodFilterEl.value : 'all';
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
let startDate = new Date(0);
if (period === 'today') startDate = today;
else if (period === 'week') { startDate = new Date(today); startDate.setDate(today.getDate() - 7); }
else if (period === 'month') { startDate = new Date(today); startDate.setDate(today.getDate() - 30); }
document.querySelectorAll('#paymentHistoryList .card').forEach(card => {
const ds = card.getAttribute('data-date');
if (!ds) { card.style.display = ''; return; }
const cd = new Date(ds);
if (isNaN(cd.getTime())) { card.style.display = ''; return; }
card.style.display = (cd >= startDate) ? '' : 'none';
});
}

function _filterHistoryByPeriod(listSelector, refDateStr, mode) {
const refDate = new Date(refDateStr);
if (isNaN(refDate.getTime())) return;
const weekStart = new Date(refDate);
weekStart.setDate(refDate.getDate() - 6);
document.querySelectorAll(listSelector + ' .card').forEach(card => {
const ds = card.getAttribute('data-date');
if (!ds) { card.style.display = ''; return; }
const cd = new Date(ds);
if (isNaN(cd.getTime())) { card.style.display = ''; return; }
let show = false;
if (mode === 'day') show = (ds === refDateStr);
else if (mode === 'week') show = (cd >= weekStart && cd <= refDate);
else if (mode === 'month') show = (cd.getMonth() === refDate.getMonth() && cd.getFullYear() === refDate.getFullYear());
else if (mode === 'year') show = (cd.getFullYear() === refDate.getFullYear());
else show = true;
card.style.display = show ? '' : 'none';
});
}

function setSalesSummaryMode(mode) {
currentSalesSummaryMode = mode;
const labels = { day:'Daily', week:'Weekly', month:'Monthly', year:'Yearly', all:'All Time' };
const prefixes = ['day','week','month','year','all'];
prefixes.forEach(p => {
const btn = document.getElementById(`ss-${p}-btn`);
if (btn) btn.className = 'toggle-opt' + (p === mode ? ' active' : '');
});
const titleEl = document.getElementById('sales-summary-title');
const qtyEl = document.getElementById('cust-active-qty');
const valueEl = document.getElementById('cust-active-value');
const cashEl = document.getElementById('cust-active-cash');
const creditEl = document.getElementById('cust-active-credit');
const profitEl = document.getElementById('cust-active-profit');
if (titleEl) titleEl.textContent = `${labels[mode]} Sales`;
if (qtyEl) qtyEl.textContent = (document.getElementById(`cust-${mode}-qty`) ?.textContent || '0.00 kg');
if (valueEl) valueEl.textContent = (document.getElementById(`cust-${mode}-value`) ?.textContent || '0.00');
if (cashEl) cashEl.textContent = (document.getElementById(`cust-${mode}-cash`) ?.textContent || '0.00');
if (creditEl) creditEl.textContent = (document.getElementById(`cust-${mode}-credit`)?.textContent || '0.00');
if (profitEl) profitEl.textContent = (document.getElementById(`cust-${mode}-profit`)?.textContent || '0.00');
const card = document.getElementById('sales-summary-card');
if (card) {
if (mode === 'all') card.classList.add('all-times-summary');
else card.classList.remove('all-times-summary');
}
const refDate = (document.getElementById('cust-date') || {}).value || new Date().toISOString().split('T')[0];
_filterHistoryByPeriod('#custHistoryList', refDate, mode);
}

function setPerfOverviewMode(mode) {
currentPerfOverviewMode = mode;
const prefixes = ['day','week','month','year','all'];
prefixes.forEach(p => {
const btn = document.getElementById(`po-${p}-btn`);
if (btn) btn.className = 'toggle-opt' + (p === mode ? ' active' : '');
});
const ghostMap = { day:'dailyReport', week:'weeklyReport', month:'monthlyReport', year:'yearlyReport', all:'allTimeReport' };
const ghostEl = document.getElementById(ghostMap[mode]);
const activeEl = document.getElementById('activeReport');
if (activeEl && ghostEl) activeEl.innerHTML = ghostEl.innerHTML;
const refDate = (document.getElementById('sale-date') || {}).value || new Date().toISOString().split('T')[0];
_filterHistoryByPeriod('#historyList', refDate, mode);
}

function setOverviewMode(mode) {
currentOverviewMode = mode;
const buttons = ['day', 'week', 'month', 'year', 'all'];
buttons.forEach(btnMode => {
const btn = document.getElementById(`overview-${btnMode}-btn`);
if (btn) {
if (btnMode === mode) btn.classList.add('active');
else btn.classList.remove('active');
}
});
updateAllStoresOverview(mode);
refreshUI();
}

async function deleteSalesEntry(id) {
const salesHistory = ensureArray(await sqliteStore.get('noman_history'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
if (!id || !validateUUID(id)) {
showToast('Invalid sales entry ID', 'error');
return;
}
try {
let history; history = await sqliteStore.get('noman_history', []);
const entryToDelete = history.find(h => h.id === id);
if (entryToDelete && entryToDelete.isMerged) {
showToast('Merged opening balance records cannot be deleted', 'warning');
return;
}
if (entryToDelete) {
const linkedCount = entryToDelete.linkedSalesIds ? entryToDelete.linkedSalesIds.length : 0;
const linkedRepCount = entryToDelete.linkedRepSalesIds ? entryToDelete.linkedRepSalesIds.length : 0;
let confirmMsg = `Permanently delete this sales settlement record?`;
confirmMsg += `\n\nSeller: ${entryToDelete.seller}`;
confirmMsg += `\nDate: ${entryToDelete.date}`;
confirmMsg += `\nTotal Sold: ${entryToDelete.sold || 0} kg`;
confirmMsg += `\nCash Received: ${(entryToDelete.received||0)}`;
if (entryToDelete.credit) confirmMsg += `\nCredit Recovered: ${entryToDelete.credit}`;
const _dsHasImpact = linkedCount > 0 || linkedRepCount > 0 || (entryToDelete.returned > 0 && entryToDelete.returnStore) || entryToDelete.expired > 0;
if (_dsHasImpact) {
confirmMsg += `\n\n The following cascading changes will occur:`;
if (linkedCount > 0) confirmMsg += `\n • ${linkedCount} linked sale${linkedCount !== 1 ? 's' : ''} will REVERT to "Pending Credit" status.`;
if (linkedRepCount > 0) confirmMsg += `\n • ${linkedRepCount} rep sale${linkedRepCount !== 1 ? 's' : ''} will be RESTORED to calculator fields.`;
if (entryToDelete.returned > 0 && entryToDelete.returnStore) confirmMsg += `\n • ${entryToDelete.returned} kg will be REMOVED from ${getStoreLabel(entryToDelete.returnStore)} inventory (return reversal).`;
if (entryToDelete.expired > 0) confirmMsg += `\n • ${entryToDelete.expired} kg will be REMOVED from CHORA raw material (expired reversal).`;
}
if (await showGlassConfirm(confirmMsg, { title: `Delete ${entryToDelete.seller || "Sales"} Record`, confirmText: "Delete", danger: true })) {
let revertedSalesCount = 0;
let revertedRepSalesCount = 0;
let reversedReturnQty = 0;
if (entryToDelete.linkedSalesIds && entryToDelete.linkedSalesIds.length > 0) {
revertedSalesCount = await revertSpecificSalesEntries(entryToDelete.linkedSalesIds);
}
if (entryToDelete.linkedRepSalesIds && entryToDelete.linkedRepSalesIds.length > 0) {
revertedRepSalesCount = await revertRepSalesEntries(entryToDelete.linkedRepSalesIds);
}
if (entryToDelete.returned > 0 && entryToDelete.returnStore) {
reversedReturnQty = entryToDelete.returned;
await reverseReturnFromProduction(entryToDelete.returnStore, entryToDelete.returned, entryToDelete.date);
}
if (entryToDelete.expired > 0) {
await reverseExpiredFromChora(entryToDelete.expired, entryToDelete.date);
}
const newHistory = history.filter(h => h.id !== id);
await unifiedDelete('noman_history', newHistory, id, { strict: true }, entryToDelete);
if (Array.isArray(salesHistory)) {
const idx = salesHistory.findIndex(h => h.id === id);
if (idx !== -1) salesHistory.splice(idx, 1);
}
refreshAllCalculations();
await loadSalesData(currentCompMode);
await refreshCustomerSales();
if (typeof refreshUI === 'function') await refreshUI();
if (entryToDelete.expired > 0) {
if (typeof renderFactoryInventory === 'function') renderFactoryInventory();
}
updateAllStoresOverview(currentOverviewMode);
notifyDataChange('calculator');
let successMsg = ' Record deleted successfully!';
if (revertedSalesCount > 0) {
successMsg += ` ${revertedSalesCount} sales reverted to pending credit.`;
}
if (revertedRepSalesCount > 0) {
successMsg += ` ${revertedRepSalesCount} rep sales restored to calculator fields.`;
}
if (reversedReturnQty > 0) {
successMsg += ` ${reversedReturnQty} kg return removed from inventory.`;
}
if (entryToDelete.expired > 0) {
successMsg += ` ${entryToDelete.expired} kg expired removed from CHORA.`;
}
showToast(successMsg, 'success');
}
} else {
showToast("Error: Record not found.", "error");
}
} catch (error) {
showToast("Failed to delete entry. Please try again.", "error");
}
}

async function revertSpecificSalesEntries(saleIds) {
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
if (!saleIds || saleIds.length === 0) return 0;
let revertedCount = 0;
saleIds.forEach(saleId => {
const saleIndex = customerSales.findIndex(s => s.id === saleId);
if (saleIndex !== -1) {
const sale = customerSales[saleIndex];
sale.creditReceived = false;
sale.paymentType = 'CREDIT';
if (!sale.currentRepProfile) sale.currentRepProfile = 'admin';
delete sale.creditReceivedDate;
delete sale.creditReceivedTime;
sale.updatedAt = getTimestamp();
ensureRecordIntegrity(sale, true);
revertedCount++;
}
});
if (revertedCount > 0) {
await unifiedSave('customer_sales', customerSales, null, saleIds);
if (typeof refreshCustomerSales === 'function') {
refreshCustomerSales(1, true);
}
notifyDataChange('sales');
triggerAutoSync();
}
return revertedCount;
}

function toggleEntityViewMode() {
const toggleBtn = document.getElementById('entityViewModeToggle');
const entityGrid = document.getElementById('entityCardsGrid');
if (entityViewMode === 'detailed') {
entityViewMode = 'compact';
entityGrid.classList.add('compact');
toggleBtn.title = "Switch to Detailed View";
toggleBtn.textContent = '';
} else {
entityViewMode = 'detailed';
entityGrid.classList.remove('compact');
toggleBtn.title = "Switch to Compact View";
toggleBtn.textContent = '';
}
renderEntityTable();
}

async function calculateEntityBalances() {
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
const supplierIdSet = new Set();
if (typeof factoryInventoryData !== 'undefined') {
factoryInventoryData.forEach(m => {
if (m.supplierId) supplierIdSet.add(String(m.supplierId));
});
}
if (typeof paymentTransactions !== 'undefined') {
paymentTransactions.forEach(t => {
if (t.isPayable && t.type === 'IN' && t.supplierCreditAmount) {
supplierIdSet.add(String(t.entityId));
}
});
}
const balances = {};
paymentEntities.forEach(entity => {
if (entity.isExpenseEntity === true) return;
balances[entity.id] = 0;
});
if (typeof factoryInventoryData !== 'undefined') {
factoryInventoryData.forEach(material => {
if (material.supplierId && material.paymentStatus === 'pending' && material.totalPayable > 0) {
const sid = String(material.supplierId);
for (const entityId in balances) {
if (String(entityId) === sid) {
balances[entityId] += parseFloat(material.totalPayable) || 0;
break;
}
}
}
});
}
if (typeof paymentTransactions !== 'undefined') {
paymentTransactions.forEach(transaction => {
if (transaction.isExpense === true) return;
if (supplierIdSet.has(String(transaction.entityId))) return;
if (balances[transaction.entityId] !== undefined) {
if (transaction.type === 'OUT') {
balances[transaction.entityId] -= parseFloat(transaction.amount) || 0;
} else if (transaction.type === 'IN') {
balances[transaction.entityId] += parseFloat(transaction.amount) || 0;
}
}
});
}
if (typeof paymentTransactions !== 'undefined') {
paymentTransactions.forEach(transaction => {
if (!transaction.isPayable || transaction.type !== 'IN') return;
if (!transaction.supplierCreditAmount) return;
const creditAmt = parseFloat(transaction.supplierCreditAmount) || 0;
if (creditAmt > 0 && balances[transaction.entityId] !== undefined) {
balances[transaction.entityId] += creditAmt;
supplierIdSet.add(String(transaction.entityId));
}
});
}
return balances;
}

function getDynamicRole(balance) {
if (balance > 0.01) {
return {
label: 'Payable',
icon: '',
colorClass: 'entity-balance-negative',
badgeColor: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
sign: '+'
};
} else if (balance < -0.01) {
return {
label: 'Receivable',
icon: '',
colorClass: 'entity-balance-positive',
badgeColor: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
sign: ''
};
} else {
return {
label: 'Settled',
icon: '',
colorClass: 'entity-balance-neutral',
badgeColor: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
sign: ''
};
}
}

function filterEntityCards() {
const searchTerm = document.getElementById('entity-list-search').value.toLowerCase().trim();
const entityCards = document.querySelectorAll('#entityCardsGrid .entity-card-compact');
if (!searchTerm) {
entityCards.forEach(card => card.style.display = '');
return;
}
entityCards.forEach(card => {
const entityName = card.querySelector('.entity-name').textContent.toLowerCase();
const entityType = card.querySelector('.entity-type-badge').textContent.toLowerCase();
const entityPhone = card.querySelector('.entity-contact')?.textContent?.toLowerCase() || '';
const cardText = (entityName + ' ' + entityType + ' ' + entityPhone).toLowerCase();
if (cardText.includes(searchTerm)) {
card.style.display = '';
} else {
card.style.display = 'none';
}
});
}

function openEntityManagement() {
editingEntityId = null;
const _en = document.getElementById('entityName'); if (_en) _en.value = '';
const _ep = document.getElementById('entityPhone'); if (_ep) _ep.value = '';
const _ew = document.getElementById('entityWallet'); if (_ew) _ew.value = '';
const _entMT1 = document.getElementById('entityManagementModalTitle'); if (_entMT1) _entMT1.innerText = 'Add New Entity';
const _delBtn = document.getElementById('deleteEntityBtn'); if (_delBtn) { _delBtn.classList.add('u-hidden'); _delBtn.style.display = 'none'; }
clearPersonPhoto('entity');
if (typeof openStandaloneScreen === 'function') openStandaloneScreen('add-entity-screen');
}

async function closeEntityManagement() {
if (typeof closeStandaloneScreen === 'function') closeStandaloneScreen('add-entity-screen');
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const detailsScreen = document.getElementById('entity-details-screen');
if (detailsScreen && detailsScreen.style.display !== 'none' && currentEntityId) {
const entity = paymentEntities.find(e => String(e.id) === String(currentEntityId));
if (entity) renderEntityOverlayContent(entity);
}
}

async function saveEntity() {
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const name = document.getElementById('entityName').value.trim();
const phone = document.getElementById('entityPhone').value.trim();
const wallet = document.getElementById('entityWallet').value.trim();
const existingEntity = editingEntityId ? paymentEntities.find(e => String(e.id) === String(editingEntityId)) : null;
const entityTxs = existingEntity
? paymentTransactions.filter(t => String(t.entityId) === String(existingEntity.id))
: [];
const hasIN = entityTxs.some(t => t.type === 'IN');
const hasOUT = entityTxs.some(t => t.type === 'OUT');
const type = (hasIN && !hasOUT) ? 'payor' : 'payee';
if (!name) {
showToast("Please enter an entity name", "warning");
return;
}
const exists = paymentEntities.some(e => e && e.name && e.name.toLowerCase() === name.toLowerCase() && e.id !== editingEntityId);
if(exists) {
showToast("An entity with this name already exists", "warning");
return;
}
try {
if (editingEntityId) {
const index = paymentEntities.findIndex(e => e.id === editingEntityId);
if (index !== -1) {
paymentEntities[index] = ensureRecordIntegrity({
...paymentEntities[index],
name,
type,
phone,
wallet,
updatedAt: getTimestamp()
}, true);
showToast("Entity updated successfully", "success");
}
} else {
let entityId = generateUUID('ent');
if (!validateUUID(entityId)) {
entityId = generateUUID('ent');
}
let newEntity = {
id: entityId,
name,
type,
phone,
wallet,
createdAt: getTimestamp(),
updatedAt: getTimestamp(),
syncedAt: new Date().toISOString()
};
newEntity = ensureRecordIntegrity(newEntity, false);
paymentEntities.push(newEntity);
showToast("New entity added", "success");
}
const savedEntity = editingEntityId
? paymentEntities.find(e => e.id === editingEntityId)
: paymentEntities[paymentEntities.length - 1];
await unifiedSave('payment_entities', paymentEntities, savedEntity);
if (savedEntity) await savePersonPhoto('entity', 'entity:' + String(savedEntity.id));
emitSyncUpdate({ payment_entities: null});
notifyDataChange('entities');
if (typeof refreshPaymentTab === 'function') await refreshPaymentTab();
closeEntityManagement();
if (typeof renderEntityTable === 'function') await renderEntityTable(1);
if (typeof calculateNetCash === 'function') calculateNetCash();
} catch (error) {
showToast('Failed to save entity. Please try again.', 'error');
}
}

async function editEntityBasicInfo(id) {
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const entity = paymentEntities.find(e => String(e.id) === String(id));
if (entity) {
editingEntityId = id;
document.getElementById('entityName').value = entity.name;
document.getElementById('entityPhone').value = entity.phone || '';
document.getElementById('entityWallet').value = entity.wallet || '';
const _entMT2 = document.getElementById('entityManagementModalTitle'); if (_entMT2) _entMT2.innerText = 'Edit Entity Info';
await loadPersonPhotoIntoEditor('entity', 'entity:' + String(id));
if (typeof openStandaloneScreen === 'function') openStandaloneScreen('add-entity-screen');
}
}

async function refreshPaymentTab(force = false) {
const _rptBatch = await sqliteStore.getBatch([
'mfg_pro_pkr','customer_sales','noman_history',
'factory_inventory_data','factory_production_history','factory_unit_tracking',
'payment_entities','payment_transactions','expenses',
'deleted_records','deletion_records',
]);
const db = ensureArray(_rptBatch.get('mfg_pro_pkr'));
const customerSales = ensureArray(_rptBatch.get('customer_sales'));
const salesHistory = ensureArray(_rptBatch.get('noman_history'));
const factoryInventoryData = ensureArray(_rptBatch.get('factory_inventory_data'));
const factoryProductionHistory = ensureArray(_rptBatch.get('factory_production_history'));
const factoryUnitTracking = _rptBatch.get('factory_unit_tracking') || {};
const paymentEntities = ensureArray(_rptBatch.get('payment_entities'));
const paymentTransactions = ensureArray(_rptBatch.get('payment_transactions'));
const expenseRecords = ensureArray(_rptBatch.get('expenses'));
const deletedRecordIds = new Set(ensureArray(_rptBatch.get('deleted_records')));
const deletionRecords = ensureArray(_rptBatch.get('deletion_records'));
try {
if (sqliteStore && sqliteStore.getBatch) {
const allKeys = [
'expenses', 'payment_entities', 'payment_transactions',
'mfg_pro_pkr', 'customer_sales', 'noman_history',
'factory_inventory_data', 'factory_production_history',
'factory_unit_tracking',
'factory_default_formulas', 'factory_additional_costs',
'factory_sale_prices', 'factory_cost_adjustment_factor'
];
const paymentDataMap = await sqliteStore.getBatch(allKeys);
if (paymentDataMap.get('expenses')) {
let freshExpenses = paymentDataMap.get('expenses') || [];
let fixedCount = 0;
if (Array.isArray(freshExpenses) && freshExpenses.length > 0) {
freshExpenses = freshExpenses.map(record => {
if (!record.id || !validateUUID(record.id) ||
!record.createdAt || !validateTimestamp(record.createdAt) ||
!record.updatedAt || !validateTimestamp(record.updatedAt)) {
record = ensureRecordIntegrity(record, false, true);
fixedCount++;
}
return record;
});
if (fixedCount > 0) {
await sqliteStore.set('expenses', freshExpenses);
}
}
}
if (paymentDataMap.get('payment_entities')) {
let freshEntities = paymentDataMap.get('payment_entities') || [];
let fixedCount = 0;
if (Array.isArray(freshEntities) && freshEntities.length > 0) {
freshEntities = freshEntities.map(record => {
if (!record.id || !validateUUID(record.id) ||
!record.createdAt || !validateTimestamp(record.createdAt) ||
!record.updatedAt || !validateTimestamp(record.updatedAt)) {
record = ensureRecordIntegrity(record, false, true);
fixedCount++;
}
return record;
});
if (fixedCount > 0) {
await sqliteStore.set('payment_entities', freshEntities);
}
}
}
if (paymentDataMap.get('payment_transactions')) {
let freshTransactions = paymentDataMap.get('payment_transactions') || [];
let fixedCount = 0;
if (Array.isArray(freshTransactions) && freshTransactions.length > 0) {
freshTransactions = freshTransactions.map(record => {
if (!record.id || !validateUUID(record.id) ||
!record.createdAt || !validateTimestamp(record.createdAt) ||
!record.updatedAt || !validateTimestamp(record.updatedAt)) {
record = ensureRecordIntegrity(record, false, true);
fixedCount++;
}
return record;
});
if (fixedCount > 0) {
await sqliteStore.set('payment_transactions', freshTransactions);
}
}
}
}
await syncSuppliersToEntities();
try { calculateNetCash(); } catch (e) {
showToast('Economic health calculation failed: ' + (_safeErr(e).message || 'please reload the app'), 'error');
console.error('calculateNetCash error:', _safeErr(e));
}
try {
if (typeof updateFactoryInventoryDisplay === 'function') {
const _std = factoryUnitTracking?.standard || {};
const _asn = factoryUnitTracking?.asaan || {};
updateFactoryInventoryDisplay();
}
} catch (e) {
console.error('updateFactoryInventoryDisplay error:', _safeErr(e));
}
try { calculatePaymentSummaries(); } catch (e) {
showToast('Payment summaries failed to calculate: ' + (_safeErr(e).message || 'please reload the app'), 'error');
console.error('calculatePaymentSummaries error:', _safeErr(e));
}
try { await renderUnifiedTable(); } catch (e) {
showToast('Transaction table failed to render: ' + (_safeErr(e).message || 'please reload the app'), 'error');
console.error('renderUnifiedTable error:', _safeErr(e));
}
try { updateExpenseBreakdown(); } catch (e) {
showToast('Expense breakdown failed to update: ' + (_safeErr(e).message || 'please reload the app'), 'error');
console.error('updateExpenseBreakdown error:', _safeErr(e));
}
try { calculateCashTracker(); } catch (e) {
showToast('Cash tracker failed to calculate: ' + (_safeErr(e).message || 'please reload the app'), 'error');
console.error('calculateCashTracker error:', _safeErr(e));
}
const historyList = document.getElementById('paymentHistoryList');
if (!historyList) {
return;
}
const _phFrag = document.createDocumentFragment();
const sortedTransactions = [...paymentTransactions].sort((a, b) => b.timestamp - a.timestamp);
sortedTransactions.forEach(async transaction => {
const entity = paymentEntities.find(e => String(e.id) === String(transaction.entityId));
const badgeClass = transaction.type === 'IN' ? 'transaction-in' : 'transaction-out';
const badgeText = transaction.type === 'IN' ? 'IN' : 'OUT';
const entityName = entity ? entity.name : (transaction.entityName || 'Unknown Entity');
const entityType = entity ? entity.type : (transaction.entityType || 'Unknown');
const isMerged = transaction.isMerged === true;
const isSettled = transaction.isSettled === true;
const mergedBadge = isMerged ? _mergedBadgeHtml(transaction, {inline:true}) : '';
const settledBadge = isSettled ? `<span class="settled-badge"> Settled</span>` : '';
const creatorBadge = (typeof _creatorBadgeHtml === 'function') ? _creatorBadgeHtml(transaction) : '';
const deleteButton = isMerged ? '' : `<button class="tbl-action-btn danger u-w-full u-mt-8" onclick="(async () => { await deletePaymentTransaction('${esc(transaction.id)}') })()">Delete</button>`;
const card = document.createElement('div');
card.className = `card liquid-card${isSettled ? ' is-settled-record' : ''}`;
if (transaction.date) card.setAttribute('data-date', transaction.date);
card.innerHTML = `
<span class="transaction-badge ${badgeClass}">${badgeText}</span>
<div style="display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin-bottom:4px;">
<span class="u-fs-sm2 u-text-muted">${formatDisplayDateTime(transaction.date, transaction.time || null)}${creatorBadge}${mergedBadge}${settledBadge}</span>
</div>
<div class="customer-name">${esc(entityName)}</div>
<p><span>Description:</span> <span>${esc(transaction.description || 'No description')}</span></p>
<hr>
<p><span>Amount:</span> <span class="${transaction.type === 'IN' ? 'profit-val' : 'cost-val'}">${fmtAmt(safeValue(transaction.amount))}</span></p>
${deleteButton}
`;
_phFrag.appendChild(card);
});
if (sortedTransactions.length === 0) {
historyList.replaceChildren(Object.assign(document.createElement('p'), {textContent:'No payment transactions found.',style:'text-align:center;color:var(--text-muted);width:100%;font-size:0.85rem'}));
} else {
historyList.replaceChildren(_phFrag);
}
_filterPaymentHistoryByPeriod();
} catch (error) {
console.error('Payment transaction failed.', _safeErr(error));
showToast('Payment transaction failed.', 'error');
}
}

async function selectEntity(id) {
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
selectedEntityId = id;
const entity = paymentEntities.find(e => String(e.id) === String(id));
const entityInput = document.getElementById('paymentEntity');
if (entity && entityInput) {
entityInput.value = entity.name;
entityInput.setAttribute('data-entity-id', id);
}
document.querySelectorAll('#entityCardsGrid .entity-card-compact').forEach(card => {
card.classList.remove('active');
if (String(card.dataset.id) === String(id)) {
card.classList.add('active');
setTimeout(() => {
card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}, 100);
}
});
document.querySelectorAll('.entity-chip').forEach(chip => {
chip.classList.remove('active');
if (String(chip.dataset.id) === String(id)) {
chip.classList.add('active');
}
});
}

async function refreshEntityBalances() {
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
renderEntityTable();
}

function getMetricValue(historyItem, metric) {
switch(metric) {
case 'weight':
return ((historyItem.totalSold || 0) - (historyItem.returned || 0)) || 0;
case 'value':
return historyItem.revenue || 0;
case 'cost':
return historyItem.totalCost || 0;
case 'profit':
return historyItem.profit || 0;
case 'cash':
return (historyItem.received || 0);
case 'credit':
return historyItem.creditValue || 0;
default:
return 0;
}
}

function getMetricLabel(metric) {
switch(metric) {
case 'weight': return 'Weight (kg)';
case 'value': return 'Revenue ()';
case 'cost': return 'Cost ()';
case 'profit': return 'Profit ()';
case 'cash': return 'Cash ()';
case 'credit': return 'Credit ()';
default: return 'Metric';
}
}

async function deleteFactoryInventoryItem() {
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
if (editingFactoryInventoryId) {
if (!validateUUID(String(editingFactoryInventoryId))) {
showToast('Invalid inventory item ID', 'error');
return;
}
const _diMat = factoryInventoryData.find(i => i.id === editingFactoryInventoryId);
const _diName = _diMat?.name || 'this item';
const _diQty = (_diMat?.quantity || 0).toFixed(2);
const _diVal = fmtAmt(_diMat?.totalValue || 0);
const _diSupplier = _diMat?.supplierName || null;
const _diLinkedTx = _diMat?.supplierId ? paymentTransactions.filter(t => String(t.materialId) === String(editingFactoryInventoryId) && t.isPayable === true) : [];
let _diMsg = `Permanently delete inventory item "${_diName}"?`;
_diMsg += `\nCurrent Stock: ${_diQty} kg`;
_diMsg += `\nTotal Value: ${_diVal}`;
if (_diSupplier) {
_diMsg += `\nLinked Supplier: ${_diSupplier}`;
_diMsg += `\n\n\u21a9 Supplier association will be removed.`;
if (_diLinkedTx.length > 0) {
const _diTxTotal = _diLinkedTx.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
_diMsg += ` ${_diLinkedTx.length} payment transaction${_diLinkedTx.length !== 1 ? 's' : ''} totaling ${fmtAmt(_diTxTotal)} will be reversed and the supplier\'s payable status reset.`;
}
}
_diMsg += `\n\n\u26a0 If this material is used in production formulas, those formulas will be affected.`;
_diMsg += `\n\nThis cannot be undone.`;
if (await showGlassConfirm(_diMsg, { title: `Delete "${_diName}"`, confirmText: "Delete", danger: true })) {
try {
const material = factoryInventoryData.find(i => i.id === editingFactoryInventoryId);

const _materialToDelete = material ? { ...material } : null;
if (material && material.supplierId) {
await unlinkSupplierFromMaterial(material, false, true);
}
const filteredForDelete = factoryInventoryData.filter(i => i.id !== editingFactoryInventoryId);
await unifiedDelete('factory_inventory_data', filteredForDelete, editingFactoryInventoryId, { strict: true }, _materialToDelete);
notifyDataChange('inventory');
triggerAutoSync();
closeFactoryInventoryModal();
if (typeof renderFactoryInventory === 'function') renderFactoryInventory();
if (typeof calculateNetCash === 'function') calculateNetCash();
showToast("Inventory item deleted!", 'success');
} catch (error) {
showToast('Failed to delete item. Please try again.', 'error');
}
}
}
}

async function initPaymentData() {
const expenseCategories = ensureArray(await sqliteStore.get('expense_categories'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
const deletedRecordIds = new Set(ensureArray(await sqliteStore.get('deleted_records')));
try {
let localEntities = [...paymentEntities];
let localTransactions = [...paymentTransactions];
let updated = false;
localEntities = localEntities.map(entity => {
updated = false;
if (!entity.id) {
entity.id = generateUUID('ent');
updated = true;
}
if (!entity.createdAt) {
entity.createdAt = entity.timestamp || getTimestamp();
updated = true;
}
if (!entity.updatedAt) {
entity.updatedAt = entity.timestamp || getTimestamp();
updated = true;
}
if (!entity.type) {
entity.type = 'payee';
updated = true;
}
if (entity.phone === undefined) {
entity.phone = '';
updated = true;
}
if (entity.wallet === undefined) {
entity.wallet = '';
updated = true;
}
return entity;
});
localTransactions = localTransactions.map(transaction => {
updated = false;
if (!transaction.id) {
transaction.id = generateUUID('pay');
updated = true;
}
if (!transaction.timestamp && transaction.date) {
try {
const dateParts = transaction.date.split('-');
if (dateParts.length === 3) {
const date = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
if (!isNaN(date.getTime())) {
transaction.timestamp = date.getTime();
updated = true;
}
}
} catch (e) {
transaction.timestamp = Date.now();
updated = true;
}
}
if (!transaction.date && transaction.timestamp) {
const d = new Date(transaction.timestamp);
transaction.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
updated = true;
}
if (!transaction.time && transaction.timestamp) {
const d = new Date(transaction.timestamp);
transaction.time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
updated = true;
}
if (transaction.description === undefined) {
transaction.description = '';
updated = true;
}
if (typeof transaction.amount !== 'number') {
const parsed = parseFloat(transaction.amount);
transaction.amount = isNaN(parsed) ? 0 : parsed;
updated = true;
}
if (transaction.type !== 'IN' && transaction.type !== 'OUT') {
transaction.type = transaction.amount >= 0 ? 'IN' : 'OUT';
transaction.amount = Math.abs(transaction.amount);
updated = true;
}
return transaction;
});
localTransactions = localTransactions.filter(t =>
t && t.id && t.entityId && (t.type === 'IN' || t.type === 'OUT') && typeof t.amount === 'number'
);
await sqliteStore.set('payment_entities', localEntities);
await sqliteStore.set('payment_transactions', localTransactions);
} catch (e) {
}
}
initPaymentData();
(async function initExpenseManager() {
const expenseRecords = await sqliteStore.get('expenses') || [];
let savedCategories = await sqliteStore.get('expense_categories') || [];
const categoriesFromRecords = [...new Set(
expenseRecords
.filter(e => e && e.name && typeof e.name === 'string')
.map(e => e.name)
)];
const expCatMerged = [...new Set([...savedCategories, ...categoriesFromRecords])];
await sqliteStore.set('expense_categories', expCatMerged);
const expenseDateInput = document.getElementById('expenseDate');
if (expenseDateInput) {
expenseDateInput.value = new Date().toISOString().split('T')[0];
}
renderRecentExpenses();
})();
async function handleExpenseSearch() {
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
const expenseCategories = ensureArray(await sqliteStore.get('expense_categories'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const input = document.getElementById('expenseName');
const resultsDiv = document.getElementById('expense-search-results');
const query = input.value.trim().toLowerCase();
if (!query || query.length < 1) {
resultsDiv.classList.add('hidden');
return;
}
const currentMode = window._expenseCategory || 'operating';
const isPaymentMode = currentMode === 'IN' || currentMode === 'OUT';
const expenseMatches = isPaymentMode ? [] : expenseCategories.filter(name => {
if (!name || typeof name !== 'string') return false;
return name.toLowerCase().includes(query);
});
const entityMatches = !isPaymentMode ? [] : paymentEntities.filter(entity => {
if (!entity || !entity.name || typeof entity.name !== 'string') return false;
if (entity.isExpenseEntity === true) return false;
return entity.name.toLowerCase().includes(query);
});
let html = '';
if (!isPaymentMode) {
html += `<div style="padding: 8px 12px; font-size: 0.7rem; color: var(--text-muted); font-weight: 600; background: var(--input-bg); border-bottom: 1px solid var(--glass-border);"> EXPENSES</div>`;
if (expenseMatches.length > 0) {
expenseMatches.forEach(name => {
if (!name || typeof name !== 'string') return;
const safeName = name.replace(/'/g, "\'").replace(/"/g, '&quot;');
const count = expenseRecords.filter(e => e && e.name === name).length;
html += `
<div style="
padding: 12px;
cursor: pointer;
border-bottom: 1px solid var(--glass-border);
font-size: 0.85rem;
color: var(--text-main);
background: var(--input-bg);
transition: all 0.2s;
"
onmousedown="selectExpense('${safeName}', 'expense')"
onmouseover="this.style.background='var(--highlight-bg)'"
onmouseout="this.style.background='var(--input-bg)'">
<div class="u-row-between" >
<strong>${esc(name)}</strong>
<span class="u-fs-sm u-text-muted" >
${count} expense records
</span>
</div>
</div>`;
});
} else {
html += `<div style="padding: 12px; font-size: 0.8rem; color: var(--text-muted); font-style: italic;">No matching expenses — will create new</div>`;
}
} else {
html += `<div style="padding: 8px 12px; font-size: 0.7rem; color: var(--text-muted); font-weight: 600; background: var(--input-bg); border-bottom: 1px solid var(--glass-border);"> ENTITIES</div>`;
if (entityMatches.length > 0) {
entityMatches.forEach(entity => {
if (!entity || !entity.name || typeof entity.name !== 'string') return;
const safeName = entity.name.replace(/'/g, "\'").replace(/"/g, '&quot;');
const transactions = paymentTransactions.filter(t => t && t.entityId === entity.id).length;
html += `
<div style="
padding: 12px;
cursor: pointer;
border-bottom: 1px solid var(--glass-border);
font-size: 0.85rem;
color: var(--text-main);
background: var(--input-bg);
transition: all 0.2s;
"
onmousedown="selectExpense('${safeName}', 'entity')"
onmouseover="this.style.background='var(--highlight-bg)'"
onmouseout="this.style.background='var(--input-bg)'">
<div class="u-row-between" >
<strong>${esc(entity.name)}</strong>
<span class="u-fs-sm u-text-muted" >
${transactions > 0 ? transactions + ' transactions' : ''}
</span>
</div>
</div>`;
});
} else {
html += `<div style="padding: 12px; font-size: 0.8rem; color: var(--text-muted); font-style: italic;">No matching entities — will create new</div>`;
}
}
resultsDiv.innerHTML = html;
resultsDiv.classList.remove('hidden');
}

function selectExpense(name, type) {
document.getElementById('expenseName').value = name;
document.getElementById('expense-search-results').classList.add('hidden');
if (!name || typeof name !== 'string') {
document.getElementById('expenseAmount').focus();
return;
}
if (type === 'entity') {
document.getElementById('btn-category-operating').style.opacity = '0.4';
document.getElementById('btn-category-operating').style.pointerEvents = 'none';
document.getElementById('btn-category-in').style.opacity = '1';
document.getElementById('btn-category-in').style.pointerEvents = 'auto';
document.getElementById('btn-category-out').style.opacity = '1';
document.getElementById('btn-category-out').style.pointerEvents = 'auto';
if (!window._expenseCategory || window._expenseCategory === 'operating') {
selectExpenseCategory('OUT', document.getElementById('btn-category-out'));
}
} else if (type === 'expense') {
document.getElementById('btn-category-operating').style.opacity = '1';
document.getElementById('btn-category-operating').style.pointerEvents = 'auto';
document.getElementById('btn-category-in').style.opacity = '0.4';
document.getElementById('btn-category-in').style.pointerEvents = 'none';
document.getElementById('btn-category-out').style.opacity = '0.4';
document.getElementById('btn-category-out').style.pointerEvents = 'none';
if (window._expenseCategory === 'IN' || window._expenseCategory === 'OUT') {
selectExpenseCategory('operating', document.getElementById('btn-category-operating'));
}
} else {
['btn-category-operating','btn-category-in','btn-category-out'].forEach(id => {
const btn = document.getElementById(id);
if (btn) { btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
});
}
document.getElementById('expenseAmount').focus();
}

function hideExpenseSearch() {
document.getElementById('expense-search-results').classList.add('hidden');
document.getElementById('expenseAmount').focus();
}
window._expenseCategory = 'OUT';
window._returnStore = null;
function selectExpenseCategory(value, clickedBtn) {
window._expenseCategory = value;
['btn-category-operating','btn-category-in','btn-category-out'].forEach(id => {
const btn = document.getElementById(id);
if (btn) btn.classList.remove('active');
});
if (clickedBtn) clickedBtn.classList.add('active');
}

function selectReturnStore(value, clickedBtn) {
window._returnStore = value;
['ret-store-a','ret-store-b'].forEach(id => {
const btn = document.getElementById(id);
if (btn) btn.classList.remove('active');
});
if (clickedBtn) clickedBtn.classList.add('active');
}

async function saveExpense() {
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
const expenseCategories = ensureArray(await sqliteStore.get('expense_categories'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
if (appMode === 'userrole' && !(window._userRoleAllowedTabs || []).includes('payments')) {
showToast('Access Denied — Payments not in your assigned tabs', 'warning', 3000); return;
}
const name = document.getElementById('expenseName').value.trim();
const amount = parseFloat(document.getElementById('expenseAmount').value);
const date = document.getElementById('expenseDate').value;
const description = document.getElementById('expenseDescription').value.trim();
const category = window._expenseCategory || 'operating';
if (!name) {
showToast("Please enter name/entity", "warning");
return;
}
if (!amount || amount <= 0) {
showToast("Please enter valid amount", "warning");
return;
}
if (!date) {
showToast("Please select date", "warning");
return;
}
if (category === 'OUT' || category === 'operating') {
const _seAvailCash = await getAvailableCashInHand();
if (_seAvailCash < amount) {
showToast(`Insufficient cash in hand. Available: ${fmtAmt(Math.max(0, _seAvailCash))} — Required: ${fmtAmt(amount)}`, 'error', 5000);
return;
}
}
let expensesSnapshot = [...expenseRecords];
let categoriesSnapshot = [...expenseCategories];
let entitiesSnapshot = [...paymentEntities];
let transactionsSnapshot = [...paymentTransactions];
try {
if (category === 'operating') {
let expenseId = generateUUID('exp');
if (!validateUUID(expenseId)) {
expenseId = generateUUID('exp');
}
let expense = {
id: expenseId,
name: name,
amount: amount,
date: date,
description: description,
category: 'operating',
createdAt: getTimestamp(),
updatedAt: getTimestamp(),
timestamp: getTimestamp(),
syncedAt: new Date().toISOString()
};
expense = ensureRecordIntegrity(expense, false);
expenseRecords.push(expense);
if (!expenseCategories.includes(name)) {
expenseCategories.push(name);
}
await unifiedSave('expenses', expenseRecords, expense);
await sqliteStore.set('expense_categories', expenseCategories);
notifyDataChange('expenses');
emitSyncUpdate({
expenses: null,
expense_categories: null
});
if (window._expensePendingPhoto) {
  try {
    const _photoKey = 'expense:' + expense.id;
    const _storedPh = (await sqliteStore.get('person_photos')) || {};
    _storedPh[_photoKey] = await _compressPhoto(window._expensePendingPhoto, 1600, 0.88);
    await sqliteStore.set('person_photos', _storedPh);
    const _expPhTs = (await sqliteStore.get('person_photos_timestamps')) || {};
    _expPhTs[_photoKey] = Date.now();
    await sqliteStore.set('person_photos_timestamps', _expPhTs);
    const _dk = (await sqliteStore.get('person_photos_dirty_keys')) || [];
    if (!_dk.includes(_photoKey)) _dk.push(_photoKey);
    await sqliteStore.set('person_photos_dirty_keys', _dk);
    await sqliteStore.set('person_photos_timestamp', Date.now());
    if (typeof triggerAutoSync === 'function') { try { triggerAutoSync(); } catch(_) {} }
  } catch(_pe) { console.warn('Expense photo save failed', _pe); }
}
await createExpenseTransaction(expense);
showToast(`Operating expense recorded: ${name}`, "success");
} else {
const transactionType = category;
let payExpenseId = generateUUID('exp');
if (!validateUUID(payExpenseId)) payExpenseId = generateUUID('exp');
let payExpenseRecord = {
id: payExpenseId,
name: name,
amount: amount,
date: date,
description: description || `Payment ${transactionType}: ${name}`,
category: transactionType,
createdAt: getTimestamp(),
updatedAt: getTimestamp(),
timestamp: getTimestamp(),
syncedAt: new Date().toISOString()
};
payExpenseRecord = ensureRecordIntegrity(payExpenseRecord, false);
expenseRecords.push(payExpenseRecord);
await unifiedSave('expenses', expenseRecords, payExpenseRecord);
if (window._expensePendingPhoto) {
  try {
    const _payPhotoKey = 'expense:' + payExpenseRecord.id;
    const _payStoredPh = (await sqliteStore.get('person_photos')) || {};
    _payStoredPh[_payPhotoKey] = await _compressPhoto(window._expensePendingPhoto, 1600, 0.88);
    await sqliteStore.set('person_photos', _payStoredPh);
    const _payPhTs = (await sqliteStore.get('person_photos_timestamps')) || {};
    _payPhTs[_payPhotoKey] = Date.now();
    await sqliteStore.set('person_photos_timestamps', _payPhTs);
    const _payDk = (await sqliteStore.get('person_photos_dirty_keys')) || [];
    if (!_payDk.includes(_payPhotoKey)) _payDk.push(_payPhotoKey);
    await sqliteStore.set('person_photos_dirty_keys', _payDk);
    await sqliteStore.set('person_photos_timestamp', Date.now());
    if (typeof triggerAutoSync === 'function') { try { triggerAutoSync(); } catch(_) {} }
  } catch(_ppe) { console.warn('Expense photo save failed', _ppe); }
}
let entity = paymentEntities.find(e =>
e.name && e.name.toLowerCase() === name.toLowerCase() &&
!e.isExpenseEntity
);
if (!entity) {
const isKnownExpenseCategory = expenseCategories.some(
cat => typeof cat === 'string' && cat.toLowerCase() === name.toLowerCase()
);
if (isKnownExpenseCategory) {
showToast(`"${name}" is an operating expense category, not an entity. Switch to Operating Expense mode or use a different name.`, 'error', 5000);
return;
}
let _seEntityId = generateUUID('ent');
if (!validateUUID(_seEntityId)) _seEntityId = generateUUID('ent');
let newEntity = {
id: _seEntityId,
name: name,
type: transactionType === 'OUT' ? 'payee' : 'payor',
isSupplier: false,
isExpenseEntity: false,
phone: '',
address: '',
notes: 'Auto-created from Transaction Manager'
};
newEntity = ensureRecordIntegrity(newEntity, false);
paymentEntities.push(newEntity);
entity = newEntity;
}
let _seTxId = generateUUID('pay');
if (!validateUUID(_seTxId)) _seTxId = generateUUID('pay');
let transaction = {
id: _seTxId,
entityId: entity.id,
entityName: entity.name,
amount: amount,
type: transactionType,
date: date,
description: description || `Payment ${transactionType}: ${name}`,
isPayable: false,
isExpense: false,
expenseId: payExpenseId,
createdBy: (appMode === 'userrole' && window._assignedManagerName) ? window._assignedManagerName : null
};
if (transactionType === 'OUT') {
const pendingMaterials = factoryInventoryData
.filter(m =>
String(m.supplierId) === String(entity.id) &&
m.paymentStatus === 'pending' &&
m.totalPayable > 0
)
.sort((a, b) => {
const da = new Date(a.purchaseDate || a.date || a.createdAt || 0).getTime();
const db = new Date(b.purchaseDate || b.date || b.createdAt || 0).getTime();
return da - db;
});
let remaining = amount;
if (pendingMaterials.length > 0) {
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
}
if (materialsToSave.length > 0) {
transaction.isPayable = true;
transaction.materialId = materialsToSave[0].id;
for (const mat of materialsToSave) {
await unifiedSave('factory_inventory_data', factoryInventoryData, mat);
}
}
}
if (remaining > 0) {
const openCredits = paymentTransactions
.filter(t =>
t.isPayable === true &&
t.type === 'IN' &&
String(t.entityId) === String(entity.id) &&
parseFloat(t.supplierCreditAmount || 0) > 0
)
.sort((a, b) => new Date(a.date || a.createdAt || 0) - new Date(b.date || b.createdAt || 0));
for (const ct of openCredits) {
if (remaining <= 0) break;
const open = parseFloat(ct.supplierCreditAmount);
if (remaining >= open) {
remaining -= open;
ct.supplierCreditAmount = 0;
} else {
ct.supplierCreditAmount = parseFloat((open - remaining).toFixed(2));
remaining = 0;
}
ct.updatedAt = getTimestamp();
ensureRecordIntegrity(ct, true);
await unifiedSave('payment_transactions', paymentTransactions, ct);
}
if (!transaction.isPayable) {
transaction.isPayable = true;
}
}
}
if (transactionType === 'IN') {
const hasMaterials = factoryInventoryData.some(m => String(m.supplierId) === String(entity.id));
const isSupplierEntity = entity.isSupplier || hasMaterials;
if (isSupplierEntity) {
transaction.isPayable = true;
transaction.supplierCreditAmount = amount;
}
}
transaction = ensureRecordIntegrity(transaction, false);
paymentTransactions.push(transaction);
await unifiedSave('payment_entities', paymentEntities, entity);
await unifiedSave('payment_transactions', paymentTransactions, transaction);
notifyDataChange('payments');
emitSyncUpdate({
payment_entities: null,
payment_transactions: null
});
showToast(`Payment ${transactionType} recorded: ${name}`, "success");
}
clearExpenseForm();
if (typeof renderUnifiedTable === 'function') {
try {
renderUnifiedTable(1);
} catch (e) {
console.error('Failed to render data.', _safeErr(e));
showToast('Transaction table failed to render: ' + (_safeErr(e).message || 'please reload the app'), 'error');
}
}
if (typeof refreshPaymentTab === 'function') {
try {
await refreshPaymentTab(true);
} catch (e) {
console.error('Payment tab refresh failed.', _safeErr(e));
showToast('Payments tab failed to refresh: ' + (_safeErr(e).message || 'please reload the app'), 'error');
}
}
if (typeof renderExpenseTable === 'function') {
try {
renderExpenseTable(1);
} catch (e) {
console.error('Payment tab refresh failed.', _safeErr(e));
showToast('Expense table failed to render: ' + (_safeErr(e).message || 'please reload the app'), 'error');
}
}
if (typeof handleExpenseSearch === 'function') {
try {
handleExpenseSearch();
} catch (e) {
console.error('Payment tab refresh failed.', _safeErr(e));
showToast('Expense search failed to run: ' + (_safeErr(e).message || 'please reload the app'), 'error');
}
}
if (typeof calculateNetCash === 'function') {
try {
calculateNetCash();
} catch (e) {
console.error('Payment tab refresh failed.', _safeErr(e));
showToast('Economic health calculation failed: ' + (_safeErr(e).message || 'please reload the app'), 'error');
}
}
if (typeof renderFactoryInventory === 'function') {
try {
renderFactoryInventory();
} catch (e) {
console.error('Payment tab refresh failed.', _safeErr(e));
showToast('Factory inventory failed to render: ' + (_safeErr(e).message || 'please reload the app'), 'error');
}
}
triggerAutoSync();
} catch (error) {
expenseRecords.length = 0;
expenseRecords.push(...expensesSnapshot);
expenseCategories.length = 0;
expenseCategories.push(...categoriesSnapshot);
paymentEntities.length = 0;
paymentEntities.push(...entitiesSnapshot);
paymentTransactions.length = 0;
paymentTransactions.push(...transactionsSnapshot);
try {
await sqliteStore.setBatch([
['expenses', expenseRecords],
['expense_categories', expenseCategories],
['payment_entities', paymentEntities],
['payment_transactions', paymentTransactions]
]);
} catch (rollbackError) {
console.error('Failed to render data.', _safeErr(rollbackError));
showToast('Expense rollback failed: ' + (_safeErr(rollbackError).message || 'data may be inconsistent, please reload'), 'error');
}
showToast('Failed to save expense. Please try again.', 'error');
}
}

async function createExpenseTransaction(expense) {
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
let entity = paymentEntities.find(e =>
e.name && e.name.toLowerCase() === expense.name.toLowerCase() &&
e.isExpenseEntity === true
);
if (!entity) {
let _etEntityId = generateUUID('ent');
if (!validateUUID(_etEntityId)) _etEntityId = generateUUID('ent');
let newEntity = {
id: _etEntityId,
name: expense.name,
type: 'payee',
isSupplier: false,
isExpenseEntity: true,
category: expense.category,
phone: '',
address: '',
notes: 'Auto-created by Expense Manager'
};
newEntity = ensureRecordIntegrity(newEntity, false);
paymentEntities.push(newEntity);
entity = newEntity;
await unifiedSave('payment_entities', paymentEntities, newEntity);
}
let _etTxId = generateUUID('pay');
if (!validateUUID(_etTxId)) _etTxId = generateUUID('pay');
let transaction = {
id: _etTxId,
entityId: entity.id,
entityName: entity.name,
amount: expense.amount,
type: 'OUT',
date: expense.date,
description: expense.description || `Expense: ${esc(expense.name)}`,
category: expense.category,
isPayable: false,
isExpense: true,
expenseId: expense.id,
createdBy: (appMode === 'userrole' && window._assignedManagerName) ? window._assignedManagerName : null
};
transaction = ensureRecordIntegrity(transaction, false);
paymentTransactions.push(transaction);
await unifiedSave('payment_transactions', paymentTransactions, transaction);
if (typeof calculateNetCash === 'function') {
calculateNetCash();
}
if (typeof refreshEntityBalances === 'function') {
refreshEntityBalances();
}
}

function renderRecentExpenses() {
renderExpenseTable();
}

async function renderExpenseTable(page = 1) {
const deletedRecordIds = new Set(ensureArray(await sqliteStore.get('deleted_records')));
const expenseRecords = ensureArray(await sqliteStore.get('expenses'))
  .filter(item => item && item.id && !deletedRecordIds.has(String(item.id)));
const expenseCategories = ensureArray(await sqliteStore.get('expense_categories'));
const tbody = document.getElementById('expense-table-body');
const totalEl = document.getElementById('expense-table-total');
const totalAllEl = document.getElementById('total-expenses-all');
if (!tbody) return;
try {
const freshExpenses = await sqliteStore.get('expenses', []);
if (freshExpenses && freshExpenses.length > 0) {
}
} catch (error) {
console.error('Calculation failed.', _safeErr(error));
showToast('Failed to load expense records: ' + (_safeErr(error).message || 'please reload the app'), 'error');
}
const periodFilter = document.getElementById('expensePeriodFilter')?.value || 'month';
const categoryFilter = document.getElementById('expenseCategoryFilter')?.value || 'all';
let filteredExpenses = [...expenseRecords];
const now2 = new Date();
const today = now2.toISOString().split('T')[0];
if (periodFilter === 'today') {
filteredExpenses = filteredExpenses.filter(e => e.date === today);
} else if (periodFilter === 'week') {
const weekAgo = new Date(now2.getTime() - 7 * 24 * 60 * 60 * 1000);
filteredExpenses = filteredExpenses.filter(e => new Date(e.date) >= weekAgo);
} else if (periodFilter === 'month') {
const monthAgo = new Date(now2.getTime() - 30 * 24 * 60 * 60 * 1000);
filteredExpenses = filteredExpenses.filter(e => new Date(e.date) >= monthAgo);
}
if (categoryFilter !== 'all') {
filteredExpenses = filteredExpenses.filter(e => e.category === categoryFilter);
}
const periodTotal = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
const allTimeTotal = expenseRecords.reduce((sum, e) => sum + e.amount, 0);
filteredExpenses.sort((a, b) => new Date(b.date) - new Date(a.date));
const totalItems = filteredExpenses.length;
if (!filteredExpenses || !Array.isArray(filteredExpenses)) {
tbody.innerHTML = `<tr><td class="u-empty-state-danger" colspan="4" >Invalid expense data</td></tr>`;
if (totalEl) totalEl.textContent = '0.00';
if (totalAllEl) totalAllEl.textContent = '0.00';
return;
}
if (totalEl) totalEl.textContent = `${fmtAmt(periodTotal)}`;
if (totalAllEl) totalAllEl.textContent = `${fmtAmt(allTimeTotal)}`;
if (totalItems === 0) {
tbody.innerHTML = `
<tr>
<td class="u-empty-state-md" colspan="4" >
No expenses found for selected period
</td>
</tr>`;
return;
}
const fragment = document.createDocumentFragment();
filteredExpenses.forEach(expense => {
const categoryColor = getCategoryColor(expense.category);
const categoryLabel = getCategoryLabel(expense.category);
const formattedDate = formatExpenseDate(expense.date);
const tr = document.createElement('tr');
tr.style.cssText = 'border-bottom: 1px solid var(--glass-border); transition: background 0.2s;';
tr.onmouseover = function() { this.style.background = 'var(--card-hover)'; };
tr.onmouseout = function() { this.style.background = 'transparent'; };
tr.innerHTML = `
<td style="padding: 10px 8px; font-size: 0.8rem; color: var(--text-muted);">
${formattedDate}
</td>
<td style="padding: 10px 8px; font-weight: 600; color: var(--text-main);">
${esc(expense.name)}${expense.isMerged ? _mergedBadgeHtml(expense, {inline:true}) : ''}
${expense.description ? `<br><span class="u-fs-sm2 u-text-muted u-fw-400" >${esc(expense.description)}</span>` : ''}
</td>
<td style="padding: 10px 8px;">
<span style="
background: ${categoryColor}15;
color: ${categoryColor};
padding: 4px 8px;
border-radius: 6px;
font-size: 0.7rem;
font-weight: 600;
white-space: nowrap;
">${esc(categoryLabel)}</span>
</td>
<td style="padding: 10px 8px; text-align: right; font-weight: 700; color: var(--danger); font-size: 0.9rem;">
${fmtAmt(expense.amount)}
</td>
<td style="padding: 10px 8px; text-align: center;">
<button
onclick="openExpenseEntityDetails('${esc(expense.id)}')"
style="
background: linear-gradient(135deg, var(--accent) 0%, var(--accent-emerald) 100%);
border: none;
color: white;
padding: 6px 12px;
border-radius: 6px;
font-size: 0.75rem;
cursor: pointer;
transition: all 0.2s;
font-weight: 600;
"
onmouseover="this.style.transform='scale(1.05)'; this.style.boxShadow='0 4px 12px rgba(0,122,255,0.3)'"
onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='none'"
>
Manage
</button>
</td>
`;
fragment.appendChild(tr);
});
tbody.replaceChildren(fragment);
}

async function renderUnifiedTable(page = 1) {

const deletedRecordIds = new Set(ensureArray(await sqliteStore.get('deleted_records')));
const _notDeleted = (item) => item && item.id && !deletedRecordIds.has(String(item.id));
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data')).filter(_notDeleted);
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities')).filter(_notDeleted);
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions')).filter(_notDeleted);
const expenseRecords = ensureArray(await sqliteStore.get('expenses')).filter(_notDeleted);
const viewModeEl = document.getElementById('unifiedViewMode');
const periodFilterEl = document.getElementById('unifiedPeriodFilter');
const searchInputEl = document.getElementById('unified-search');
const tbody = document.getElementById('unified-table-body');
const totalSpan = document.getElementById('unified-table-total');
const footerLabel = document.getElementById('unified-table-footer-label');
const summaryDiv = document.getElementById('unified-summary');
if (!tbody) {
return;
}
const viewMode = viewModeEl ? viewModeEl.value : 'entities';
const periodFilter = periodFilterEl ? periodFilterEl.value : 'month';
const searchQuery = searchInputEl && searchInputEl.value ? String(searchInputEl.value).toLowerCase().trim() : '';
let rows = [];
let totalAmount = 0;
let totalReceivables = 0;
let totalPayables = 0;
let totalSupplierPayables = 0;
let totalEntityPayables = 0;
let totalExpenses = 0;
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
let startDate = new Date(0);
if (periodFilter === 'today') {
startDate = today;
} else if (periodFilter === 'week') {
startDate = new Date(today);
startDate.setDate(today.getDate() - 7);
} else if (periodFilter === 'month') {
startDate = new Date(today);
startDate.setDate(today.getDate() - 30);
}
expenseRecords.forEach(exp => {
if (!exp || !exp.date) return;
const expDate = new Date(exp.date);
if (expDate < startDate) return;
if (exp.category === 'operating') {
const amount = parseFloat(exp.amount) || 0;
totalExpenses += amount;
}
});
const supplierIdSet = new Set();
if (typeof factoryInventoryData !== 'undefined') {
factoryInventoryData.forEach(m => { if (m.supplierId) supplierIdSet.add(String(m.supplierId)); });
}
if (typeof paymentTransactions !== 'undefined') {
paymentTransactions.forEach(t => {
if (t.isPayable && t.type === 'IN' && t.supplierCreditAmount) {
supplierIdSet.add(String(t.entityId));
}
});
}
const supplierBalances = {};
if (typeof factoryInventoryData !== 'undefined') {
factoryInventoryData.forEach(material => {
if (material.supplierId && material.paymentStatus === 'pending' && material.totalPayable > 0) {
const sid = String(material.supplierId);
supplierBalances[sid] = (supplierBalances[sid] || 0) + material.totalPayable;
}
});
}
const entityBalances = {};
paymentEntities.forEach(entity => {
if (entity.isExpenseEntity === true) return;
if (supplierIdSet.has(String(entity.id))) return;
entityBalances[entity.id] = 0;
});
if (typeof paymentTransactions !== 'undefined') {
paymentTransactions.forEach(transaction => {
if (transaction.isExpense === true) return;
if (supplierIdSet.has(String(transaction.entityId))) return;
if (entityBalances[transaction.entityId] !== undefined) {
if (transaction.type === 'OUT') {
entityBalances[transaction.entityId] -= parseFloat(transaction.amount) || 0;
} else if (transaction.type === 'IN') {
entityBalances[transaction.entityId] += parseFloat(transaction.amount) || 0;
}
}
});
}
for (const sid in supplierBalances) {
if (supplierBalances[sid] > 0) {
totalSupplierPayables += supplierBalances[sid];
totalPayables += supplierBalances[sid];
}
}
if (typeof paymentTransactions !== 'undefined') {
paymentTransactions.forEach(transaction => {
if (transaction.isExpense === true) return;
if (!transaction.isPayable || transaction.type !== 'IN') return;
if (!transaction.supplierCreditAmount) return;
const creditAmt = parseFloat(transaction.supplierCreditAmount) || 0;
if (creditAmt > 0) {
totalSupplierPayables += creditAmt;
totalPayables += creditAmt;
supplierIdSet.add(String(transaction.entityId));
}
});
}
for (const entityId in entityBalances) {
const balance = entityBalances[entityId];
if (balance > 0) { totalEntityPayables += balance; totalPayables += balance; }
if (balance < 0) totalReceivables += Math.abs(balance);
}
if (viewMode === 'transactions') {
const expenseGroups = {};
expenseRecords.forEach(exp => {
if (!exp || !exp.date) return;
if (exp.category !== 'operating') return;
const expDate = new Date(exp.date);
if (expDate < startDate) return;
const expName = exp.name ? String(exp.name) : '';
if (searchQuery && !expName.toLowerCase().includes(searchQuery)) return;
const groupKey = `${exp.category}||${expName}`;
if (!expenseGroups[groupKey]) {
expenseGroups[groupKey] = {
name: expName,
category: exp.category,
totalAmount: 0,
latestDate: expDate,
latestId: exp.id,
count: 0
};
}
const grp = expenseGroups[groupKey];
grp.totalAmount += parseFloat(exp.amount) || 0;
grp.count++;
if (expDate > grp.latestDate) {
grp.latestDate = expDate;
grp.latestId = exp.id;
}
});
Object.values(expenseGroups).forEach(grp => {
totalAmount -= grp.totalAmount;
const d = grp.latestDate;
const month = d.toLocaleDateString('en-US', { month: 'short' });
const day = String(d.getDate()).padStart(2, '0');
const year = String(d.getFullYear()).slice(-2);
rows.push({
type: 'transaction',
date: grp.latestDate,
dateStr: `${month} ${day} ${year}`,
name: grp.name,
contact: 'Operating',
typeLabel: 'EXPENSE',
amount: grp.totalAmount,
amountStr: `${fmtAmt(grp.totalAmount)}`,
color: 'var(--warning)',
id: grp.latestId,
description: grp.count > 1 ? `${grp.count} transactions` : ''
});
});
}
if (viewMode === 'entities') {
const supplierIds = new Set();
if (typeof factoryInventoryData !== 'undefined') {
factoryInventoryData.forEach(m => { if (m.supplierId) supplierIds.add(String(m.supplierId)); });
}
if (typeof paymentTransactions !== 'undefined') {
paymentTransactions.forEach(t => {
if (t.isPayable && t.type === 'IN' && t.supplierCreditAmount) {
supplierIds.add(String(t.entityId));
}
});
}
const supplierEntityBalances = {};
if (typeof factoryInventoryData !== 'undefined') {
factoryInventoryData.forEach(material => {
if (material.supplierId && material.paymentStatus === 'pending' && material.totalPayable > 0) {
const sid = String(material.supplierId);
supplierEntityBalances[sid] = (supplierEntityBalances[sid] || 0) + material.totalPayable;
}
});
}
if (typeof paymentTransactions !== 'undefined') {
paymentTransactions.forEach(t => {
if (!t.isPayable || t.type !== 'IN' || !t.supplierCreditAmount) return;
const creditAmt = parseFloat(t.supplierCreditAmount) || 0;
if (creditAmt > 0) {
const sid = String(t.entityId);
supplierEntityBalances[sid] = (supplierEntityBalances[sid] || 0) + creditAmt;
}
});
}
const entityBalances = {};
paymentEntities.forEach(entity => {
if (entity.isExpenseEntity === true) return;
if (supplierIds.has(String(entity.id))) return;
entityBalances[entity.id] = 0;
});
if (typeof paymentTransactions !== 'undefined') {
paymentTransactions.forEach(transaction => {
if (transaction.isExpense === true) return;
if (supplierIds.has(String(transaction.entityId))) return;
if (entityBalances[transaction.entityId] !== undefined) {
if (transaction.type === 'OUT') {
entityBalances[transaction.entityId] -= parseFloat(transaction.amount) || 0;
} else if (transaction.type === 'IN') {
entityBalances[transaction.entityId] += parseFloat(transaction.amount) || 0;
}
}
});
}
paymentEntities.forEach(entity => {
if (entity.isExpenseEntity === true) return;
const entityName = entity && entity.name ? String(entity.name) : '';
const entityPhone = entity && entity.phone ? String(entity.phone) : '';
const entityWallet = entity && entity.wallet ? String(entity.wallet) : '';
if (searchQuery) {
const nameMatch = entityName.toLowerCase().includes(searchQuery);
const phoneMatch = entityPhone.includes(searchQuery);
const walletMatch = entityWallet.includes(searchQuery);
if (!nameMatch && !phoneMatch && !walletMatch) return;
}
let balance = supplierIds.has(String(entity.id))
? (supplierEntityBalances[String(entity.id)] || 0)
: (entityBalances[entity.id] || 0);
if (entity.balance !== undefined && entity.balance !== null && typeof paymentTransactions === 'undefined') {
balance = parseFloat(entity.balance) || 0;
}
const contactInfo = entityPhone || entityWallet || 'No contact';
const entityDate = entity.createdAt ? new Date(entity.createdAt) : new Date();
const dateStr = (() => {
const month = entityDate.toLocaleDateString('en-US', { month: 'short' });
const day = String(entityDate.getDate()).padStart(2, '0');
const year = String(entityDate.getFullYear()).slice(-2);
return `${month} ${day} ${year}`;
})();
let balanceLabel = '';
let balanceColor = 'var(--text-muted)';
if (balance > 0.01) {
balanceLabel = 'PAYABLE';
balanceColor = 'var(--danger)';
} else if (balance < -0.01) {
balanceLabel = 'RECEIVABLE';
balanceColor = 'var(--accent-emerald)';
} else {
balanceLabel = 'SETTLED';
}
let nameColor = 'var(--text-main)';
if (balance > 0.01) {
nameColor = 'var(--danger)';
} else if (balance < -0.01) {
nameColor = 'var(--accent-emerald)';
}
const amountStr = `${fmtAmt(Math.abs(balance))}`;
rows.push({
type: 'entity',
date: entityDate,
dateStr: dateStr,
name: entityName,
nameColor: nameColor,
contact: contactInfo,
typeLabel: 'ENTITY',
amount: balance,
amountStr: amountStr,
amountColor: balanceColor,
balanceLabel: balanceLabel,
id: entity.id,
entity: entity
});
});
}
rows.sort((a, b) => {
if (a.type === 'entity' && b.type === 'entity') {
return Math.abs(b.amount) - Math.abs(a.amount);
}
if (a.type === 'entity' && b.type !== 'entity') return 1;
if (a.type !== 'entity' && b.type === 'entity') return -1;
return b.date - a.date;
});
const totalItems = rows.length;
if (!rows || !Array.isArray(rows)) {
tbody.innerHTML = `<tr><td class="u-empty-state-danger" colspan="4" >Invalid data format</td></tr>`;
if (totalSpan) totalSpan.textContent = '0.00';
return;
}
if (rows.length === 0) {
tbody.innerHTML = `
<tr>
<td class="u-empty-state-md" colspan="4" >
No records found matching your filters
</td>
</tr>`;
if (totalSpan) totalSpan.textContent = '0.00';
return;
}

function buildUnifiedRow(row) {
const tr = document.createElement('tr');
tr.style.cssText = 'border-bottom: 1px solid var(--glass-border); transition: background 0.2s; cursor: pointer;';
tr.onmouseover = function() { this.style.background = 'var(--highlight-bg)'; };
tr.onmouseout = function() { this.style.background = row.type === 'entity' ? 'var(--input-bg)' : 'transparent'; };
if (row.type === 'transaction') {
tr.onclick = function(e) { if (!e.target.closest('a,button')) openExpenseEntityDetails(row.id); };
tr.innerHTML = `
<td style="padding: 8px 4px; font-size: 0.7rem; white-space: nowrap;">${row.dateStr}</td>
<td style="padding: 8px 4px; font-weight: 600; font-size: 0.8rem; cursor:pointer;" onclick="openExpenseEntityDetails('${esc(row.id)}')">
${esc(row.name)}
<div style="display: inline-block; margin-left: 6px;">
<span style="color: ${row.typeLabel === 'EXPENSE' ? 'var(--warning)' : 'var(--accent)'}; padding: 2px 6px; border-radius: 4px; font-size: 0.55rem; font-weight: 700;">
${row.typeLabel}
</span>
</div>
</td>
<td style="padding: 8px 4px; font-size: 0.7rem; color: var(--text-muted);">${phoneActionHTML(row.contact)}</td>
<td style="padding: 8px 4px; text-align: right; font-weight: 700; color: ${row.color}; white-space: nowrap; font-size: 0.75rem;">
${row.amountStr}
</td>`;
} else {
tr.style.background = 'var(--input-bg)';
tr.onclick = function(e) { if (!e.target.closest('a,button')) openEntityDetailsOverlay(row.id); };
tr.innerHTML = `
<td style="padding: 8px 4px; font-size: 0.7rem; white-space: nowrap; color: var(--text-main);">
${row.dateStr}
</td>
<td style="padding: 8px 4px; font-weight: 700; font-size: 0.8rem; color: ${row.nameColor}; cursor:pointer;" onclick="openEntityDetailsOverlay('${esc(row.id)}')">
${esc(row.name)}
<div style="font-size: 0.6rem; margin-top: 2px;">
<span style="color: ${row.amountColor}; padding: 1px 4px; border-radius: 3px; font-size: 0.55rem; font-weight: 600;">
${row.balanceLabel}
</span>
</div>
</td>
<td style="padding: 8px 4px; font-size: 0.7rem; color: var(--text-muted);">${phoneActionHTML(row.contact)}</td>
<td style="padding: 8px 4px; text-align: right; font-weight: 700; color: ${row.amountColor}; white-space: nowrap; font-size: 0.75rem;">
${row.amountStr}
</td>`;
}
return tr;
}
tbody.innerHTML = '';
const _fragU = document.createDocumentFragment();
rows.forEach((row, i) => { const el = buildUnifiedRow(row, i); if (el) _fragU.appendChild(el); });
tbody.appendChild(_fragU);
if (viewMode === 'entities') {
if (footerLabel) footerLabel.textContent = 'Net Balance:';
if (totalSpan) {
const netBalance = totalReceivables - totalPayables;
totalSpan.textContent = `${fmtAmt(Math.abs(netBalance))}`;
totalSpan.style.color = netBalance >= 0 ? 'var(--accent-emerald)' : 'var(--danger)';
}
} else {
if (footerLabel) footerLabel.textContent = 'Net Total:';
if (totalSpan) {
totalSpan.textContent = `${fmtAmt(totalAmount)}`;
totalSpan.style.color = totalAmount >= 0 ? 'var(--accent-emerald)' : 'var(--danger)';
}
}
if (summaryDiv) {
summaryDiv.style.display = 'block';
const receivablesEl = document.getElementById('unified-receivables');
const payablesEl = document.getElementById('unified-payables');
const supplierPayablesEl = document.getElementById('unified-supplier-payables');
const entityPayablesEl = document.getElementById('unified-entity-payables');
const expensesEl = document.getElementById('unified-expenses');
if (receivablesEl) receivablesEl.textContent = fmtAmt(totalReceivables);
if (payablesEl) payablesEl.textContent = fmtAmt(totalPayables);
if (supplierPayablesEl) supplierPayablesEl.textContent = fmtAmt(totalSupplierPayables);
if (entityPayablesEl) entityPayablesEl.textContent = fmtAmt(totalEntityPayables);
if (expensesEl) expensesEl.textContent = fmtAmt(totalExpenses);
}
_filterPaymentHistoryByPeriod();
}

async function updateExpenseBreakdown() {
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
const container = document.getElementById('expense-breakdown-container');
if (!container) return;
const categoryTotals = {};
let totalExpenses = 0;
expenseRecords.forEach(exp => {
if (exp.category === 'operating') {
const name = exp.name;
const amount = parseFloat(exp.amount) || 0;
if (!categoryTotals[name]) {
categoryTotals[name] = 0;
}
categoryTotals[name] += amount;
totalExpenses += amount;
}
});
const sortedCategories = Object.entries(categoryTotals)
.sort((a, b) => b[1] - a[1])
.slice(0, 5);
if (sortedCategories.length === 0) {
container.innerHTML = '<div style="color: var(--text-muted); font-style: italic;">No operating expenses</div>';
return;
}
let html = '';
sortedCategories.forEach(([name, amount]) => {
const percentage = totalExpenses > 0 ? (amount / totalExpenses * 100).toFixed(2) : 0;
html += `
<div style="display: flex; justify-content: space-between; margin-bottom: 4px; padding: 4px 0;">
<span class="u-text-main" >${name}:</span>
<div style="text-align: right;">
<span style="color: var(--danger); font-weight: 600; margin-right: 8px;">${formatCurrency(amount)}</span>
<span style="color: var(--text-muted); font-size: 0.7rem;">(${percentage}%)</span>
</div>
</div>`;
});
if (Object.keys(categoryTotals).length > 5) {
const othersCount = Object.keys(categoryTotals).length - 5;
html += `<div style="color: var(--text-muted); font-size: 0.7rem; margin-top: 4px; font-style: italic;">${othersCount} more categories
</div>`;
}
container.innerHTML = html;
}

async function exportUnifiedData() {
const deletedRecordIds = new Set(ensureArray(await sqliteStore.get('deleted_records')));
const _notDeleted = (item) => item && item.id && !deletedRecordIds.has(String(item.id));
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data')).filter(_notDeleted);
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities')).filter(_notDeleted);
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions')).filter(_notDeleted);
const expenseRecords = ensureArray(await sqliteStore.get('expenses')).filter(_notDeleted);
const viewModeEl = document.getElementById('unifiedViewMode');
const periodFilterEl = document.getElementById('unifiedPeriodFilter');
if (!viewModeEl || !periodFilterEl) {
showToast('Export failed. Please try again.', 'error');
return;
}
const viewMode = viewModeEl.value || 'entities';
const periodFilter = periodFilterEl.value || 'all';
showToast("Generating PDF...", "info");
try {
if (!window.jspdf) {
await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js');
}
if (!window.jspdf || !window.jspdf.jsPDF) {
throw new Error("Failed to load PDF library. Please refresh and try again.");
}
const { jsPDF } = window.jspdf;
const doc = new jsPDF('p', 'mm', 'a4');
const pageW = doc.internal.pageSize.getWidth();
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
let startDate = new Date(0);
if (periodFilter === 'today') startDate = today;
else if (periodFilter === 'week') { startDate = new Date(today); startDate.setDate(today.getDate() - 7); }
else if (periodFilter === 'month') { startDate = new Date(today); startDate.setDate(today.getDate() - 30); }
const periodName = periodFilter === 'all' ? 'All Time' : periodFilter === 'today' ? 'Today' :
periodFilter === 'week' ? 'This Week' : 'This Month';
const isEntities = viewMode === 'entities';
const hdrColor = isEntities ? [0, 150, 136] : [255, 149, 0];
doc.setFillColor(...hdrColor);
doc.rect(0, 0, pageW, 22, 'F');
doc.setFontSize(15); doc.setFont(undefined,'bold'); doc.setTextColor(255,255,255);
doc.text('GULL AND ZUBAIR NASWAR DEALERS', pageW/2, 10, { align:'center' });
doc.setFontSize(9); doc.setFont(undefined,'normal');
doc.text('Naswar Manufacturers & Dealers', pageW/2, 17, { align:'center' });
doc.setFontSize(12); doc.setFont(undefined,'bold'); doc.setTextColor(50,50,50);
const titleText = isEntities ? 'Payment Entities — Balances & Ledger' : 'Expenses — Transaction Records';
doc.text(`${titleText} · ${periodName}`, pageW/2, 30, { align:'center' });
doc.setFontSize(8); doc.setFont(undefined,'normal'); doc.setTextColor(120,120,120);
doc.text(`Generated: ${now.toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})} at ${now.toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit', hour12: true})}`, pageW/2, 36, { align:'center' });
doc.setDrawColor(...hdrColor); doc.setLineWidth(0.5);
doc.line(14, 39, pageW - 14, 39);
let yPos = 44;
if (isEntities) {
const supplierIdSet = new Set();
factoryInventoryData.forEach(m => { if (m.supplierId) supplierIdSet.add(String(m.supplierId)); });
const supplierBalances = {};
factoryInventoryData.forEach(mat => {
if (mat.supplierId && mat.paymentStatus === 'pending' && mat.totalPayable > 0) {
const sid = String(mat.supplierId);
supplierBalances[sid] = (supplierBalances[sid] || 0) + mat.totalPayable;
}
});
const entityNetBalances = {};
const entityMergedInfo = {};
paymentEntities.forEach(e => {
if (e.isExpenseEntity === true) return;
if (supplierIdSet.has(String(e.id))) return;
entityNetBalances[e.id] = 0;
});
paymentTransactions.forEach(t => {
if (t.isExpense === true) return;
if (t.isPayable === true) return;
if (supplierIdSet.has(String(t.entityId))) return;
if (entityNetBalances[t.entityId] !== undefined) {
const amt = parseFloat(t.amount) || 0;
if (t.type === 'OUT') entityNetBalances[t.entityId] -= amt;
else if (t.type === 'IN') entityNetBalances[t.entityId] += amt;
if (t.isMerged === true && t.mergedSummary) {
entityMergedInfo[t.entityId] = entityMergedInfo[t.entityId] || [];
entityMergedInfo[t.entityId].push({
period: _pdfMergedPeriodLabel(t),
count: _pdfMergedCountLabel(t),
originalIn: (t.mergedSummary.originalIn || 0),
originalOut: (t.mergedSummary.originalOut || 0)
});
}
}
});
const entityRows = [];
const pdfEntityMeta = [];
let totPayable = 0, totReceivable = 0;
const allEntities = paymentEntities
.filter(e => !e.isExpenseEntity)
.map(entity => {
const sid = String(entity.id);
const isSupplier = supplierIdSet.has(sid);
const balance = isSupplier
? (supplierBalances[sid] || 0)
: (entityNetBalances[entity.id] || 0);
return { entity, sid, isSupplier, balance };
})
.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
allEntities.forEach(({ entity, sid, isSupplier, balance }) => {
if (balance > 0.01) totPayable += balance;
else if (balance < -0.01) totReceivable += Math.abs(balance);
let balDisplay, balNote;
if (Math.abs(balance) < 0.01) { balDisplay = 'SETTLED'; balNote = 'SETTLED'; }
else if (balance > 0.01) { balDisplay = fmtAmt(balance); balNote = 'PAYABLE'; }
else { balDisplay = fmtAmt(Math.abs(balance)); balNote = 'RECEIVABLE'; }
const source = isSupplier ? 'Inventory' : 'Transactions';
const hasMergedTx = !!entityMergedInfo[entity.id];
entityRows.push([
entity.name + (hasMergedTx ? '\n\u2605 Has year-end balance' : ''),
isSupplier ? 'SUPPLIER' : (entity.type === 'payee' ? 'PAYEE' : 'PAYOR'),
entity.phone || 'N/A',
hasMergedTx ? 'Year-End\n' + source : source,
balDisplay,
balNote
]);
pdfEntityMeta.push({ entity, balNote, hasMergedTx });
});
if (entityRows.length > 0) {
doc.autoTable({
startY: yPos,
head: [['Name', 'Type', 'Phone', 'Balance Source', 'Balance', 'Status']],
body: entityRows,
theme: 'grid',
headStyles: { fillColor: hdrColor, textColor: 255, fontSize: 9, fontStyle:'bold', halign:'center' },
styles: { fontSize: 8.5, cellPadding: 3, lineWidth: 0.15, lineColor:[180,180,180], overflow:'linebreak' },
columnStyles: {
0: { cellWidth: 48 },
1: { cellWidth: 20, halign:'center' },
2: { cellWidth: 28, halign:'center' },
3: { cellWidth: 24, halign:'center', fontSize:7.5, textColor:[100,100,100] },
4: { cellWidth: 34, halign:'right', fontStyle:'bold' },
5: { cellWidth: 22, halign:'center', fontStyle:'bold' }
},
didParseCell: function(data) {
const meta = pdfEntityMeta[data.row.index];
if (meta && meta.hasMergedTx) data.cell.styles.fillColor = PDF_MERGED_ROW_COLOR;
if (data.column.index === 4 && meta) {
if (meta.balNote === 'PAYABLE') data.cell.styles.textColor = [220,53,69];
else if (meta.balNote === 'RECEIVABLE') data.cell.styles.textColor = [40,167,69];
else data.cell.styles.textColor = [100,100,100];
}
if (data.column.index === 5 && meta) {
if (meta.balNote === 'SETTLED') data.cell.styles.textColor = [100,100,100];
else if (meta.balNote === 'RECEIVABLE') data.cell.styles.textColor = [40,167,69];
else if (meta.balNote === 'PAYABLE') data.cell.styles.textColor = [220,53,69];
}
if (data.column.index === 1) {
const txt = (data.cell.text || []).join('');
if (txt === 'SUPPLIER') data.cell.styles.textColor = [200,100,0];
else if (txt === 'PAYEE') data.cell.styles.textColor = [220,53,69];
else if (txt === 'PAYOR') data.cell.styles.textColor = [40,167,69];
}
},
margin: { left: 14, right: 14 }
});
const afterY = doc.lastAutoTable.finalY + 6;
if (afterY < 265) {
doc.setFontSize(8); doc.setFont(undefined,'normal'); doc.setTextColor(100,100,100);
doc.text(
`Total Payables: ${fmtAmt(totPayable)} | Total Receivables: ${fmtAmt(totReceivable)} | Net Position: ${fmtAmt(Math.abs(totReceivable - totPayable))} ${totReceivable > totPayable ? '(IN OUR FAVOR)' : '(NET PAYABLE)'}`,
14, afterY
);
const hasMergedEntries = Object.keys(entityMergedInfo).length > 0;
if (hasMergedEntries && afterY + 7 < 272) {
doc.setFillColor(245, 235, 255);
doc.roundedRect(14, afterY + 6, pageW - 28, 9, 1.5, 1.5, 'F');
doc.setFontSize(7.5); doc.setFont(undefined,'bold'); doc.setTextColor(126, 34, 206);
doc.text('\u2605 Highlighted rows contain year-end opening balances (MERGED) from Close Financial Year.', 18, afterY + 12.5);
doc.setFont(undefined,'normal'); doc.setTextColor(80,80,80);
}
}
} else {
doc.setFont(undefined,'normal'); doc.setFontSize(10); doc.setTextColor(150);
doc.text('No entities found.', pageW/2, yPos + 10, { align:'center' });
}
}
if (!isEntities) {
let expenses = expenseRecords.filter(exp => exp && exp.category === 'operating');
if (periodFilter !== 'all') {
expenses = expenses.filter(exp => exp.date && new Date(exp.date) >= startDate);
}
expenses.sort((a, b) => new Date(a.date) - new Date(b.date));
if (expenses.length > 0) {
const nameGroups = {};
expenses.forEach(exp => {
const key = exp.name || 'Unnamed';
nameGroups[key] = (nameGroups[key] || 0) + (parseFloat(exp.amount) || 0);
});
const mergedExpenses = expenses.filter(e => e.isMerged === true);
const normalExpenses = expenses.filter(e => !e.isMerged);
if (mergedExpenses.length > 0) {
yPos = _pdfDrawMergedSectionHeader(doc, yPos, pageW, 'YEAR-END EXPENSE SUMMARIES (Carried Forward)');
const mergedExpRows = mergedExpenses.map(exp => {
const period = _pdfMergedPeriodLabel(exp);
const count = _pdfMergedCountLabel(exp);
return [
period,
exp.name || '-',
exp.category || 'operating',
`${count} — ${(exp.description || '').substring(0, 35)}`,
fmtAmt(parseFloat(exp.amount)||0)
];
});
doc.autoTable({startY:yPos,head:[['Year Period','Name / Vendor','Category','Summary','Total Amount']],body:mergedExpRows,theme:'grid',
headStyles:{fillColor:PDF_MERGED_HDR_COLOR,textColor:255,fontSize:9,fontStyle:'bold',halign:'center'},
styles:{fontSize:8,cellPadding:2.5,lineWidth:0.15,lineColor:[200,180,230],overflow:'linebreak'},
columnStyles:{0:{cellWidth:30,halign:'center'},1:{cellWidth:34},2:{cellWidth:22,halign:'center',fontSize:7.5},3:{cellWidth:58},4:{cellWidth:28,halign:'right',fontStyle:'bold'}},
didParseCell:function(data){data.cell.styles.fillColor=PDF_MERGED_ROW_COLOR;data.cell.styles.textColor=[80,40,120];if(data.column.index===4)data.cell.styles.textColor=[140,60,180];},
margin:{left:14,right:14}});
yPos = doc.lastAutoTable.finalY + 6;
if (yPos > 250) { doc.addPage(); yPos = 20; }
}
const expenseRows = normalExpenses.map(exp => [
formatDisplayDate(exp.date) || exp.date || '',
exp.name || '-',
exp.category || 'operating',
(exp.description || '-').substring(0, 45),
fmtAmt(parseFloat(exp.amount) || 0)
]);
const totalAmt = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
if (normalExpenses.length > 0) {
doc.setFontSize(8.5); doc.setFont(undefined,'bold');
doc.setTextColor(...hdrColor);
doc.text('INDIVIDUAL EXPENSE RECORDS', 14, yPos);
doc.setTextColor(80,80,80); doc.setFont(undefined,'normal');
yPos += 5;
}
doc.autoTable({
startY: yPos,
head: [['Date', 'Name / Vendor', 'Category', 'Description', 'Amount']],
body: expenseRows,
theme: 'grid',
headStyles: { fillColor: hdrColor, textColor: 255, fontSize: 9, fontStyle:'bold', halign:'center' },
styles: { fontSize: 8.5, cellPadding: 2.5, lineWidth: 0.15, lineColor:[180,180,180], overflow:'linebreak' },
columnStyles: {
0: { cellWidth: 24, halign:'center' },
1: { cellWidth: 38 },
2: { cellWidth: 22, halign:'center', fontSize:7.5, textColor:[100,100,100] },
3: { cellWidth: 60 },
4: { cellWidth: 28, halign:'right', textColor:[220,53,69], fontStyle:'bold' }
},
didParseCell: function(data) {},
margin: { left: 14, right: 14 }
});
const afterY = doc.lastAutoTable.finalY + 8;
if (afterY < 265 && Object.keys(nameGroups).length > 1) {
doc.setFontSize(9); doc.setFont(undefined,'bold'); doc.setTextColor(50,50,50);
doc.text('Breakdown by Expense Name:', 14, afterY);
let bkY = afterY + 5;
doc.setFont(undefined,'normal'); doc.setFontSize(8);
Object.entries(nameGroups)
.sort(([,a],[,b]) => b - a)
.forEach(([name, total]) => {
if (bkY > 275) return;
doc.setTextColor(80,80,80);
doc.text(name.substring(0, 30), 14, bkY);
doc.setTextColor(220,53,69); doc.setFont(undefined,'bold');
doc.text(fmtAmt(total), 130, bkY, { align:'right' });
doc.setFont(undefined,'normal');
bkY += 5;
});
}
} else {
doc.setFont(undefined,'normal'); doc.setFontSize(10); doc.setTextColor(150);
doc.text('No expense records found for this period.', pageW/2, yPos + 10, { align:'center' });
}
}
const pageCount = doc.internal.getNumberOfPages();
for (let i = 1; i <= pageCount; i++) {
doc.setPage(i);
doc.setFontSize(7); doc.setTextColor(160);
doc.text(
`Generated on ${now.toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})} at ${now.toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit', hour12: true})} | GULL AND ZUBAIR NASWAR DEALERS`,
pageW/2, 291, { align:'center' }
);
doc.text(`Page ${i} of ${pageCount}`, pageW/2, 287, { align:'center' });
}
const filename = `Unified_Statement_${viewMode}_${periodFilter}_${now.toISOString().split('T')[0]}.pdf`;
doc.save(filename);
showToast('PDF exported successfully!', 'success');
} catch (error) {
showToast('Error generating PDF: ' + error.message, 'error');
}
}

function formatExpenseDate(dateString) {
const date = new Date(dateString);
const month = date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
const day = String(date.getDate()).padStart(2, '0');
const year = String(date.getFullYear()).slice(-2);
return `${month} ${day} ${year}`;
}

function toSafeDate(value) {
if (!value) return null;
if (typeof value === 'object' && value !== null && typeof value.seconds === 'number') {
return new Date(value.seconds * 1000);
}
if (value instanceof Date) return value;
const d = new Date(value);
return isNaN(d.getTime()) ? null : d;
}

function formatDisplayDate(dateInput) {
if (!dateInput) return '-';
const date = toSafeDate(dateInput);
if (!date || isNaN(date.getTime())) return '-';
const month = date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
const day = String(date.getDate()).padStart(2, '0');
const year = String(date.getFullYear()).slice(-2);
return `${month} ${day} ${year}`;
}

function formatDisplayDateTime(dateInput, timeStr) {
const datePart = formatDisplayDate(dateInput);
if (!timeStr) return datePart;
return `${datePart} @ ${timeStr}`;
}

async function openExpenseEntityDetails(expenseId) {
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const expense = expenseRecords.find(e => e.id === expenseId);
if (!expense) {
showToast('Expense not found', 'error');
return;
}
if (expense.category === 'operating') {
await openOperatingExpenseOverlay(expense.name);
return;
}
const entity = paymentEntities.find(e =>
e.name.toLowerCase() === expense.name.toLowerCase()
);
if (entity) {
openEntityDetailsOverlay(entity.id);
} else {
showToast('Entity not found for this expense', 'warning');
}
}

async function openOperatingExpenseOverlay(expenseName) {
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
currentExpenseOverlayName = expenseName;
const labelEl = document.getElementById('quickExpenseNameLabel');
if (labelEl) labelEl.textContent = expenseName;
const qAmount = document.getElementById('quickExpenseAmount');
const qDesc = document.getElementById('quickExpenseDescription');
if (qAmount) qAmount.value = '';
if (qDesc) qDesc.value = '';
const rangeEl = document.getElementById('expenseOverlayRange');
if (rangeEl) rangeEl.value = 'all';
requestAnimationFrame(() => {
if (typeof openStandaloneScreen === 'function') openStandaloneScreen('expense-details-screen');
});
renderExpenseOverlayContent();
}

function closeExpenseDetailsOverlay() {
if (typeof closeStandaloneScreen === 'function') closeStandaloneScreen('expense-details-screen');
currentExpenseOverlayName = null;
refreshPaymentTab();
}

async function renderExpenseOverlayContent() {
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const expenseName = currentExpenseOverlayName;
if (!expenseName) return;
const titleEl = document.getElementById('expenseOverlayTitle');
if (titleEl) titleEl.innerText = expenseName;
const rangeEl = document.getElementById('expenseOverlayRange');
const range = rangeEl ? rangeEl.value : 'all';
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
let relatedExpenses = expenseRecords.filter(e =>
e.category === 'operating' &&
e.name.toLowerCase() === expenseName.toLowerCase()
);
if (range !== 'all') {
relatedExpenses = relatedExpenses.filter(e => {
if (!e.date) return false;
const d = new Date(e.date);
switch (range) {
case 'today': return d >= today;
case 'week': { const w = new Date(today); w.setDate(w.getDate() - 7); return d >= w; }
case 'month': { const m = new Date(today); m.setMonth(m.getMonth() - 1); return d >= m; }
case 'year': { const y = new Date(today); y.setFullYear(y.getFullYear() - 1); return d >= y; }
default: return true;
}
});
}
relatedExpenses.sort((a, b) => new Date(b.date) - new Date(a.date));
const allTimeTotal = expenseRecords
.filter(e => e.category === 'operating' && e.name.toLowerCase() === expenseName.toLowerCase())
.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
const filteredTotal = relatedExpenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
const count = relatedExpenses.length;
const statsEl = document.getElementById('expenseOverlayStats');
if (statsEl) {
statsEl.innerHTML = `
<span style="color:var(--warning); font-weight:800;">Total: ${fmtAmt(filteredTotal)}</span>
<span style="display:inline-flex; gap:8px; margin-left:12px; flex-wrap:wrap;">
<span class="txn-stat-badge txn-warning">${count} record${count !== 1 ? 's' : ''}</span>
<span class="txn-stat-badge txn-out">All-Time: ${fmtAmt(allTimeTotal)}</span>
</span>`;
}
const list = document.getElementById('expenseManagementHistoryList');
if (!list) return;
if (relatedExpenses.length === 0) {
list.replaceChildren(Object.assign(document.createElement('div'), {className:'u-empty-state-sm',textContent:'No expense records found for selected period'}));
return;
}
const _expFrag = document.createDocumentFragment();
relatedExpenses.forEach(exp => {
const item = document.createElement('div');
item.className = 'cust-history-item';
const _expPhotoBadgeId = 'ph-badge-exp-' + String(exp.id).replace(/[^a-z0-9]/gi, '');
item.innerHTML = `
<div class="cust-history-info">
<div class="u-fs-sm2 u-text-muted" >${formatDisplayDateTime(exp.date, exp.time || null)}${exp.isMerged ? _mergedBadgeHtml(exp, {inline:true}) : ''}</div>
<div class="u-fs-sm2 u-text-muted" >${esc(exp.description || 'No description')}</div>
</div>
<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
<div style="text-align:right; margin-right:4px;">
<span class="txn-label-badge txn-warning">EXPENSE</span>
<div class="cost-val" style="font-size:0.9rem; margin-top:2px;">${fmtAmt(parseFloat(exp.amount) || 0)}</div>
</div>
<button id="${_expPhotoBadgeId}" title="View photo" onclick="(async()=>{const ph=(await sqliteStore.get('person_photos'))||{};const d=ph['expense:${esc(exp.id)}'];if(d)openPhotoLightbox(d);else showToast('No photo','warning',1500);})()"
  style="display:none;align-items:center;gap:3px;padding:3px 7px;border:none;border-radius:6px;cursor:pointer;font-size:0.62rem;font-weight:700;background:rgba(99,102,241,0.15);color:#818cf8;white-space:nowrap;">
  <svg width="11" height="11" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;">
    <rect x="3" y="7" width="30" height="22" rx="3" stroke="currentColor" stroke-width="1.8" fill="none"/>
    <circle cx="18" cy="18" r="6" stroke="currentColor" stroke-width="1.6" fill="none"/>
    <circle cx="18" cy="18" r="2.5" fill="currentColor"/>
    <rect x="22" y="4" width="8" height="5" rx="1.5" stroke="currentColor" stroke-width="1.4" fill="none"/>
  </svg>
  Photo
</button>
${exp.isMerged ? '' : `<button class="btn btn-sm btn-danger u-p-4-8" onclick="deleteExpenseFromOverlay('${esc(exp.id)}')">⌫</button>`}
</div>
`;
_expFrag.appendChild(item);
const _expPhKey = 'expense:' + exp.id;
sqliteStore.get('person_photos').then(ph => {
  if (ph && ph[_expPhKey]) {
    const badge = document.getElementById(_expPhotoBadgeId);
    if (badge) badge.style.display = 'inline-flex';
  }
}).catch(() => {});
});
list.replaceChildren(_expFrag);
}

function filterExpenseManagementHistory() {
const term = document.getElementById('expense-history-search').value.toLowerCase();
const items = document.querySelectorAll('#expenseManagementHistoryList .cust-history-item');
items.forEach(item => {
item.style.display = item.innerText.toLowerCase().includes(term) ? 'flex' : 'none';
});
}

async function deleteExpenseFromOverlay(expenseId) {
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
await deleteExpense(expenseId);
const overlayEl = document.getElementById('expense-details-screen');
if (overlayEl && overlayEl.style.display !== 'none' && currentExpenseOverlayName) {
renderExpenseOverlayContent();
}
}

async function saveQuickExpenseEntry() {
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const amountEl = document.getElementById('quickExpenseAmount');
const descEl = document.getElementById('quickExpenseDescription');
if (!amountEl) return;
const amount = parseFloat(amountEl.value);
if (!amount || amount <= 0) {
showToast('Please enter a valid amount', 'warning');
return;
}
const expenseName = currentExpenseOverlayName;
if (!expenseName) {
showToast('No expense category selected. Please close and reopen the expense panel.', 'warning');
return;
}
const _sqeeAvail = await getAvailableCashInHand();
if (_sqeeAvail < amount) {
showToast(`Insufficient cash in hand. Available: ${fmtAmt(Math.max(0, _sqeeAvail))} — Required: ${fmtAmt(amount)}`, 'error', 5000);
return;
}
try {
const now = new Date();
const dateStr = now.toISOString().split('T')[0];
let expenseId = generateUUID('exp');
if (!validateUUID(expenseId)) expenseId = generateUUID('exp');
let newExpense = {
id: expenseId,
name: expenseName,
amount: amount,
date: dateStr,
category: 'operating',
description: descEl ? descEl.value.trim() : '',
createdAt: now.getTime(),
updatedAt: now.getTime(),
syncedAt: now.toISOString()
};
newExpense = ensureRecordIntegrity(newExpense, false);
expenseRecords.push(newExpense);
await unifiedSave('expenses', expenseRecords, newExpense);
notifyDataChange('expenses');
showToast(` Expense added under "${expenseName}"`, 'success');
if (amountEl) amountEl.value = '';
if (descEl) descEl.value = '';
renderExpenseOverlayContent();
if (typeof calculateNetCash === 'function') calculateNetCash();
if (typeof calculateCashTracker === 'function') calculateCashTracker();
} catch (error) {
showToast('Failed to save expense. Please try again.', 'error');
}
}

async function deleteAllExpensesByName() {
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const expenseName = currentExpenseOverlayName;
if (!expenseName) return;
const toDelete = expenseRecords.filter(e =>
e.category === 'operating' &&
e.name.toLowerCase() === expenseName.toLowerCase()
);
if (toDelete.length === 0) {
closeExpenseDetailsOverlay();
return;
}
const _daeTotal = toDelete.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
const _daeDateRange = toDelete.length > 1 ? ` (${toDelete[toDelete.length-1].date} – ${toDelete[0].date})` : (toDelete[0]?.date ? ` on ${toDelete[0].date}` : '');
const _daeTxCount = paymentTransactions.filter(t => toDelete.some(e => e.id === t.expenseId)).length;
let _daeMsg = `Permanently delete ALL ${toDelete.length} expense record${toDelete.length !== 1 ? 's' : ''} for "${expenseName}"?`;
_daeMsg += `\nTotal Amount: ${fmtAmt(_daeTotal)}`;
if (toDelete.length > 1) _daeMsg += `\nDate Range: ${toDelete[toDelete.length-1].date} – ${toDelete[0].date}`;
else if (toDelete[0]?.date) _daeMsg += `\nDate: ${toDelete[0].date}`;
if (_daeTxCount > 0) _daeMsg += `\n\n↩ ${_daeTxCount} linked payment transaction${_daeTxCount !== 1 ? 's' : ''} will also be reversed.`;
_daeMsg += `\n\nThis cannot be undone.`;
if (!(await showGlassConfirm(_daeMsg, { title: `Delete All "${expenseName}" Records`, confirmText: "Delete All", danger: true }))) return;
try {
const _bulkPhotoKeysToDelete = [];
for (const exp of toDelete) {
const _expFiltered = expenseRecords.filter(e => e.id !== exp.id);
await unifiedDelete('expenses', _expFiltered, exp.id, { strict: true }, exp);
expenseRecords.length = 0; expenseRecords.push(..._expFiltered);
const linked = paymentTransactions.filter(t => t.expenseId === exp.id);
if (linked.length > 0) {
const linkedToDelete = linked.slice();
for (const tx of linkedToDelete) {
const _ptFilteredExp = paymentTransactions.filter(t => t.id !== tx.id);
await unifiedDelete('payment_transactions', _ptFilteredExp, tx.id, { strict: true }, tx);
paymentTransactions.length = 0; paymentTransactions.push(..._ptFilteredExp);
}
}
_bulkPhotoKeysToDelete.push('expense:' + exp.id);
}
try {
  const _bulkPh = (await sqliteStore.get('person_photos')) || {};
  const _bulkPhTs = (await sqliteStore.get('person_photos_timestamps')) || {};
  const _bulkDk = (await sqliteStore.get('person_photos_dirty_keys')) || [];
  let _bulkPhChanged = false;
  for (const _bKey of _bulkPhotoKeysToDelete) {
    if (_bulkPh[_bKey] !== undefined) {
      delete _bulkPh[_bKey];
      delete _bulkPhTs[_bKey];
      if (!_bulkDk.includes(_bKey)) _bulkDk.push(_bKey);
      _bulkPhChanged = true;
    }
  }
  if (_bulkPhChanged) {
    await sqliteStore.set('person_photos', _bulkPh);
    await sqliteStore.set('person_photos_timestamps', _bulkPhTs);
    await sqliteStore.set('person_photos_dirty_keys', _bulkDk);
    if (typeof triggerAutoSync === 'function') { try { triggerAutoSync(); } catch(_) {} }
  }
} catch(_bulkPhErr) { console.warn('[deleteAllExpenses] photo batch cleanup failed', _bulkPhErr); }
notifyDataChange('expenses');
showToast(` All "${expenseName}" expense records deleted`, 'success');
closeExpenseDetailsOverlay();
if (typeof renderUnifiedTable === 'function') renderUnifiedTable(1);
if (typeof calculateNetCash === 'function') calculateNetCash();
if (typeof calculateCashTracker === 'function') calculateCashTracker();
if (typeof renderRecentExpenses === 'function') renderRecentExpenses();
} catch (error) {
showToast('Failed to delete all expense records. Please try again.', 'error');
}
}

async function exportExpenseOverlayToPDF() {
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
const expenseName = currentExpenseOverlayName;
if (!expenseName) { showToast('No expense selected', 'warning'); return; }
const rangeEl = document.getElementById('expenseOverlayRange');
const range = rangeEl ? rangeEl.value : 'all';
showToast('Generating PDF...', 'info');
try {
if (!window.jspdf) {
await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js');
}
if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('Failed to load PDF library.');
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
let records = expenseRecords.filter(e =>
e.category === 'operating' &&
e.name && e.name.toLowerCase() === expenseName.toLowerCase()
);
if (range !== 'all') {
records = records.filter(e => {
if (!e.date) return false;
const d = new Date(e.date);
switch (range) {
case 'today': return d >= today;
case 'week': { const w = new Date(today); w.setDate(w.getDate() - 7); return d >= w; }
case 'month': { const m = new Date(today); m.setMonth(m.getMonth() - 1); return d >= m; }
case 'year': { const y = new Date(today); y.setFullYear(y.getFullYear() - 1); return d >= y; }
default: return true;
}
});
}
records.sort((a, b) => new Date(a.date) - new Date(b.date));
const total = records.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
const rangeName = range === 'all' ? 'All Time' : range.charAt(0).toUpperCase() + range.slice(1);
const { jsPDF } = window.jspdf;
const doc = new jsPDF('p', 'mm', 'a4');
const pageW = doc.internal.pageSize.getWidth();
const hdrColor = [255, 149, 0];
doc.setFillColor(...hdrColor);
doc.rect(0, 0, pageW, 22, 'F');
doc.setFontSize(15); doc.setFont(undefined,'bold'); doc.setTextColor(255,255,255);
doc.text('GULL AND ZUBAIR NASWAR DEALERS', pageW/2, 10, { align:'center' });
doc.setFontSize(9); doc.setFont(undefined,'normal');
doc.text('Naswar Manufacturers & Dealers', pageW/2, 17, { align:'center' });
doc.setFontSize(12); doc.setFont(undefined,'bold'); doc.setTextColor(50,50,50);
doc.text(`Expense History: ${expenseName}`, pageW/2, 30, { align:'center' });
doc.setFontSize(9); doc.setFont(undefined,'normal'); doc.setTextColor(80,80,80);
doc.setFont(undefined,'bold'); doc.text('Period:', 14, 38);
doc.setFont(undefined,'normal'); doc.text(rangeName, 34, 38);
doc.setFont(undefined,'bold'); doc.text('Records:', 75, 38);
doc.setFont(undefined,'normal'); doc.text(String(records.length), 98, 38);
doc.setFont(undefined,'bold'); doc.text('Total:', 120, 38);
doc.setFont(undefined,'normal'); doc.setTextColor(...hdrColor); doc.setFont(undefined,'bold');
doc.text(fmtAmt(total), 138, 38);
doc.setTextColor(80,80,80); doc.setFont(undefined,'normal');
doc.setFont(undefined,'bold'); doc.text('Generated:', 14, 44);
doc.setFont(undefined,'normal'); doc.text(now.toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}) + ' at ' + now.toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit', hour12: true}), 42, 44);
doc.setDrawColor(...hdrColor); doc.setLineWidth(0.5);
doc.line(14, 47, pageW - 14, 47);
if (records.length > 0) {
const mergedExpRecs = records.filter(e => e.isMerged === true);
const normalExpRecs = records.filter(e => !e.isMerged);
let tableStartY = 51;
if (mergedExpRecs.length > 0) {
  tableStartY = _pdfDrawMergedSectionHeader(doc, tableStartY, pageW, 'YEAR-END EXPENSE SUMMARIES (Carried Forward)');
  const mergedRows = mergedExpRecs.map(e => {
    const ms = e.mergedSummary || {};
    const period = _pdfMergedPeriodLabel(e);
    const count  = _pdfMergedCountLabel(e);
    return [
      period,
      `${count} — ${(e.description||'Year-end merged total').substring(0,45)}`,
      fmtAmt(parseFloat(e.amount)||0),
      '\u2605 MERGED'
    ];
  });
  doc.autoTable({startY:tableStartY,head:[['Year Period','Summary','Amount','Note']],body:mergedRows,theme:'grid',
    headStyles:{fillColor:PDF_MERGED_HDR_COLOR,textColor:255,fontSize:9,fontStyle:'bold',halign:'center'},
    styles:{fontSize:8.5,cellPadding:3,lineWidth:0.15,lineColor:[200,180,230],overflow:'linebreak'},
    columnStyles:{0:{cellWidth:30,halign:'center'},1:{cellWidth:85},2:{cellWidth:30,halign:'right',fontStyle:'bold'},3:{cellWidth:31,halign:'center',fontStyle:'bold'}},
    didParseCell:function(data){data.cell.styles.fillColor=PDF_MERGED_ROW_COLOR;data.cell.styles.textColor=[80,40,120];if(data.column.index===2)data.cell.styles.textColor=[140,60,180];if(data.column.index===3)data.cell.styles.textColor=[126,34,206];},
    margin:{left:14,right:14}});
  tableStartY = doc.lastAutoTable.finalY + 8;
  if (tableStartY > 240) { doc.addPage(); tableStartY = 20; }
}
if (normalExpRecs.length > 0) {
  if (mergedExpRecs.length > 0) {
    doc.setFontSize(8.5); doc.setFont(undefined,'bold'); doc.setTextColor(...hdrColor);
    doc.text('INDIVIDUAL EXPENSE RECORDS', 14, tableStartY);
    doc.setTextColor(80,80,80); doc.setFont(undefined,'normal');
    tableStartY += 5;
  }
}
let runningTotal = 0;
const expenseRows = normalExpRecs.map(e => {
runningTotal += parseFloat(e.amount) || 0;
return [
formatDisplayDate(e.date) || e.date || '-',
(e.description || 'No description').substring(0, 55),
fmtAmt(parseFloat(e.amount) || 0),
fmtAmt(runningTotal)
];
});
doc.autoTable({
startY: tableStartY,
head: [['Date', 'Description', 'Amount', 'Cumulative Total']],
body: expenseRows,
theme: 'grid',
headStyles: { fillColor: hdrColor, textColor: 255, fontSize: 9, fontStyle:'bold', halign:'center' },
styles: { fontSize: 8.5, cellPadding: 3, lineWidth: 0.15, lineColor:[180,180,180], overflow:'linebreak' },
columnStyles: {
0: { cellWidth: 24, halign:'center' },
1: { cellWidth: 90 },
2: { cellWidth: 30, halign:'right', textColor:[220,53,69], fontStyle:'bold' },
3: { cellWidth: 32, halign:'right', textColor:[255,149,0], fontStyle:'bold' }
},
didParseCell: function(data) {},
margin: { left: 14, right: 14 }
});
if (range === 'all' && records.length > 5) {
const afterY = doc.lastAutoTable.finalY + 8;
if (afterY < 258) {
const monthTotals = {};
records.forEach(e => {
if (!e.date) return;
const d = new Date(e.date);
const key = d.toLocaleDateString('en-US',{year:'numeric',month:'short'});
monthTotals[key] = (monthTotals[key] || 0) + (parseFloat(e.amount) || 0);
});
doc.setFontSize(9); doc.setFont(undefined,'bold'); doc.setTextColor(50,50,50);
doc.text('Monthly Breakdown:', 14, afterY);
let bkY = afterY + 5;
doc.setFont(undefined,'normal'); doc.setFontSize(8.5);
Object.entries(monthTotals).forEach(([month, amt]) => {
if (bkY > 278) return;
doc.setTextColor(80,80,80); doc.text(month, 14, bkY);
doc.setTextColor(220,53,69); doc.setFont(undefined,'bold');
doc.text(fmtAmt(amt), 60, bkY);
doc.setFont(undefined,'normal');
bkY += 5;
});
}
}
} else {
doc.setFont(undefined,'normal'); doc.setFontSize(10); doc.setTextColor(150);
doc.text(`No expense records found for "${expenseName}" in the selected period.`, pageW/2, 70, { align:'center' });
}
const pageCount = doc.internal.getNumberOfPages();
for (let i = 1; i <= pageCount; i++) {
doc.setPage(i);
doc.setFontSize(7); doc.setTextColor(160);
doc.text(
`Generated on ${now.toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})} at ${now.toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit', hour12: true})} | GULL AND ZUBAIR NASWAR DEALERS`,
pageW/2, 291, { align:'center' }
);
doc.text(`Page ${i} of ${pageCount}`, pageW/2, 287, { align:'center' });
}
doc.save(`Expense_${expenseName.replace(/\s+/g,'_')}_${range}_${new Date().toISOString().split('T')[0]}.pdf`);
showToast('PDF exported successfully', 'success');
} catch (error) {
showToast('Failed to export PDF: ' + error.message, 'error');
}
}

async function deleteExpense(expenseId) {
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
if (!expenseId || !validateUUID(expenseId)) {
showToast('Invalid expense ID', 'error');
return;
}
const expense = expenseRecords.find(e => e.id === expenseId);
if (!expense) {
const orphans = paymentTransactions.filter(t => t.expenseId === expenseId);
if (orphans.length > 0) {
const orphansCopy = orphans.slice();
for (const tx of orphansCopy) {
const _ptFilteredDelExp = paymentTransactions.filter(t => t.id !== tx.id);
await unifiedDelete('payment_transactions', _ptFilteredDelExp, tx.id, { strict: true }, tx);
}
}
renderRecentExpenses();
if (typeof refreshPaymentTab === 'function') await refreshPaymentTab();
if (typeof calculateNetCash === 'function') calculateNetCash();
if (typeof calculateCashTracker === 'function') calculateCashTracker();
if (typeof renderUnifiedTable === 'function') renderUnifiedTable(1);
return;
}
const linkedTransactions = paymentTransactions.filter(t => t.expenseId === expenseId);
const categoryLabel = expense.category === 'operating' ? 'Operating Expense'
: expense.category === 'IN' ? 'Payment IN'
: expense.category === 'OUT' ? 'Payment OUT'
: 'Expense';
const _dePayableOuts = linkedTransactions.filter(t => t.type === 'OUT' && t.isPayable === true);
const _deEntityIds = [...new Set(_dePayableOuts.map(t => t.entityId))];
const _deEntityNames = _deEntityIds.map(eid => { const e = paymentEntities.find(x => String(x.id) === String(eid)); return e?.name || 'Supplier'; });
let confirmMsg = `Permanently delete this ${categoryLabel}?`;
confirmMsg += `\n\nName: ${esc(expense.name || 'Unnamed')}`;
confirmMsg += `\nAmount: ${(parseFloat(expense.amount)||0).toFixed(2)}`;
confirmMsg += `\nDate: ${expense.date || 'Unknown'}`;
if (expense.description) confirmMsg += `\nNote: ${esc(expense.description)}`;
if (linkedTransactions.length > 0) {
const _deTxTotal = linkedTransactions.reduce((s, t) => s + (parseFloat(t.amount)||0), 0);
confirmMsg += `\n\n\u21a9 ${linkedTransactions.length} linked payment transaction${linkedTransactions.length !== 1 ? 's' : ''} (${fmtAmt(_deTxTotal)}) will be reversed.`;
if (_deEntityNames.length > 0) confirmMsg += `\n Suppliers affected: ${_deEntityNames.join(', ')} — payable status will be reset to pending.`;
}
confirmMsg += `\n\nThis cannot be undone.`;
if (!(await showGlassConfirm(confirmMsg, { title: `Delete ${categoryLabel}`, confirmText: "Delete", danger: true }))) return;
try {
const txToDelete = paymentTransactions.filter(t => t.expenseId === expenseId);
const payableOuts = txToDelete.filter(t => t.type === 'OUT' && t.isPayable === true);
const affectedSupplierIds = [...new Set(payableOuts.map(t => String(t.entityId)))];
const deletingIds = new Set(txToDelete.map(t => t.id));
for (const supplierId of affectedSupplierIds) {
const supplierMaterials = factoryInventoryData.filter(m =>
String(m.supplierId) === String(supplierId)
);
supplierMaterials.forEach(mat => {
const originalAmount = parseFloat((
mat.totalValue ||
(mat.purchaseCost && mat.purchaseQuantity ? mat.purchaseCost * mat.purchaseQuantity : mat.quantity * mat.cost) ||
0
).toFixed(2));
mat.totalPayable = originalAmount;
mat.paymentStatus = 'pending';
delete mat.paidDate;
mat.updatedAt = getTimestamp();
ensureRecordIntegrity(mat, true);
});
const remainingPayments = paymentTransactions
.filter(t =>
!deletingIds.has(t.id) &&
t.isPayable === true &&
t.type === 'OUT' &&
String(t.entityId) === String(supplierId)
)
.sort((a, b) => new Date(a.date || a.createdAt || 0) - new Date(b.date || b.createdAt || 0));
const sortedMaterials = supplierMaterials.slice().sort((a, b) =>
new Date(a.purchaseDate || a.date || a.createdAt || 0) -
new Date(b.purchaseDate || b.date || b.createdAt || 0)
);
remainingPayments.forEach(payment => {
let remaining = parseFloat(payment.amount) || 0;
for (const mat of sortedMaterials) {
if (remaining <= 0) break;
if (mat.totalPayable <= 0) continue;
if (remaining >= mat.totalPayable) {
remaining -= mat.totalPayable;
mat.totalPayable = 0;
mat.paymentStatus = 'paid';
mat.paidDate = payment.date;
mat.updatedAt = getTimestamp();
} else {
mat.totalPayable = parseFloat((mat.totalPayable - remaining).toFixed(2));
remaining = 0;
mat.updatedAt = getTimestamp();
}
ensureRecordIntegrity(mat, true);
}
});
for (const mat of supplierMaterials) {
await unifiedSave('factory_inventory_data', factoryInventoryData, mat);
}
}
if (txToDelete.length > 0) {
for (const trans of txToDelete) {
await unifiedDelete('payment_transactions', paymentTransactions, trans.id, { strict: true }, trans);
}
}
const _expRecFiltered = expenseRecords.filter(e => e.id !== expenseId);
await unifiedDelete('expenses', _expRecFiltered, expenseId, { strict: true }, expense);

try {
  const _delPhotoKey = 'expense:' + expenseId;
  const _delPhotos = (await sqliteStore.get('person_photos')) || {};
  if (_delPhotos[_delPhotoKey] !== undefined) {
    delete _delPhotos[_delPhotoKey];
    await sqliteStore.set('person_photos', _delPhotos);
    const _delPhTs = (await sqliteStore.get('person_photos_timestamps')) || {};
    delete _delPhTs[_delPhotoKey];
    await sqliteStore.set('person_photos_timestamps', _delPhTs);
    const _delDk = (await sqliteStore.get('person_photos_dirty_keys')) || [];
    if (!_delDk.includes(_delPhotoKey)) _delDk.push(_delPhotoKey);
    await sqliteStore.set('person_photos_dirty_keys', _delDk);
    if (typeof triggerAutoSync === 'function') { try { triggerAutoSync(); } catch(_) {} }
  }
} catch(_delPhErr) { console.warn('[deleteExpense] photo cleanup failed', _delPhErr); }

notifyDataChange('expenses');
renderRecentExpenses();
if (typeof refreshPaymentTab === 'function') await refreshPaymentTab();
if (typeof calculateNetCash === 'function') calculateNetCash();
if (typeof calculateCashTracker === 'function') calculateCashTracker();
if (typeof renderFactoryInventory === 'function') renderFactoryInventory();
if (typeof renderUnifiedTable === 'function') renderUnifiedTable(1);
const label = expense.category === 'operating' ? 'Expense' : `Payment ${expense.category}`;
showToast(` ${label} deleted — all balances and views restored!`, 'success');
} catch (error) {
showToast('Failed to delete expense. Please try again.', 'error');
}
}

function clearExpenseForm() {
document.getElementById('expenseName').value = '';
document.getElementById('expenseAmount').value = '';
document.getElementById('expenseDescription').value = '';
document.getElementById('expenseDate').value = new Date().toISOString().split('T')[0];
document.getElementById('expense-search-results').classList.add('hidden');
selectExpenseCategory('OUT', document.getElementById('btn-category-out'));
['btn-category-operating','btn-category-in','btn-category-out'].forEach(id => {
const btn = document.getElementById(id);
if (btn) { btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
});
const expIdEl = document.getElementById('expense-id-display');
if (expIdEl && typeof generateUUID === 'function') {
const previewId = generateUUID('exp');
expIdEl.textContent = 'ID: ' + previewId.split('-').slice(0,2).join('-') + '…';
expIdEl.title = previewId;
}
window._expensePendingPhoto = null;
_applyExpensePendingPhoto(null);
}

function getCategoryColor(category) {
switch(category) {
case 'operating': return 'var(--danger)';
case 'loan': return 'var(--warning)';
case 'misc': return 'var(--accent)';
default: return 'var(--text-muted)';
}
}

function getCategoryLabel(category) {
switch(category) {
case 'operating': return 'Operating';
case 'loan': return ' Loan/Debt';
case 'misc': return ' Miscellaneous';
default: return 'Other';
}
}

function openDataMenu() {
if (appMode === 'rep') {
return;
}
if (typeof updateSyncButton === 'function') updateSyncButton();
if (typeof performOneClickSync === 'function') {
performOneClickSync().catch(function(e){console.error('[openDataMenu] sync error:', _safeErr(e))});
}
}

function closeDataMenu() {

}
const _recoveredThisSession = new Set();
async function purgeRecoveredId(id, collectionName, cleanRecord, newId) {
const deletedRecordIds = new Set(ensureArray(await sqliteStore.get('deleted_records')));
const deletionRecords = ensureArray(await sqliteStore.get('deletion_records'));
  const sid    = String(id);
  const newSid = newId ? String(newId) : sid;
  _recoveredThisSession.add(sid);
  deletedRecordIds.delete(sid);
  if (typeof deletionRecords !== 'undefined' && Array.isArray(deletionRecords)) {
  }
  try {
    const freshDeletionRecords = await sqliteStore.get('deletion_records', []);
    const prunedDeletionRecords = Array.isArray(freshDeletionRecords)
      ? freshDeletionRecords.filter(r => r.id !== sid && r.recordId !== sid)
      : [];
    await sqliteStore.set('deletion_records', prunedDeletionRecords);
  } catch(e) { console.warn('[RecycleBin] purge SQLite deletion_records failed:', _safeErr(e)); }
  try {
    await sqliteStore.set('deleted_records', Array.from(deletedRecordIds));
  } catch(e) { console.warn('[RecycleBin] purge SQLite deleted_records failed:', _safeErr(e)); }
  if (typeof OfflineQueue !== 'undefined') {
    const _isStaleDeleteOp = (item) => {
      const op = item.operation || {};
      return (
        (op.action === 'delete' && op.docId === sid) ||
        (op.action === 'set'    && op.docId === sid && (op.data === null || op.data === undefined))
      );
    };
    const qBefore = OfflineQueue.queue.length;
    OfflineQueue.queue = OfflineQueue.queue.filter(item => !_isStaleDeleteOp(item));
    if (OfflineQueue.queue.length !== qBefore) {
      try { await OfflineQueue.saveQueue(); } catch(e) {}
    }
    const dlBefore = (OfflineQueue.deadLetterQueue || []).length;
    if (Array.isArray(OfflineQueue.deadLetterQueue)) {
      OfflineQueue.deadLetterQueue = OfflineQueue.deadLetterQueue.filter(item => !_isStaleDeleteOp(item));
      if (OfflineQueue.deadLetterQueue.length !== dlBefore) {
        try { await OfflineQueue.saveDeadLetterQueue(); } catch(e) {}
      }
    }
  }
  if (firebaseDB && currentUser) {
    (async () => {
      try {
        const userRef = firebaseDB.collection('users').doc(currentUser.uid);
        const batch = firebaseDB.batch();
        batch.delete(userRef.collection('deletions').doc(sid));
        if (cleanRecord && collectionName) {
          const sanitized = typeof sanitizeForFirestore === 'function'
            ? sanitizeForFirestore({ ...cleanRecord, syncedAt: new Date().toISOString() })
            : { ...cleanRecord, syncedAt: new Date().toISOString() };
          sanitized.id = newSid;
          delete sanitized.originalId;
          sanitized.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
          batch.set(
            userRef.collection(collectionName).doc(newSid),
            sanitized,
            { merge: true }
          );
        }
        await batch.commit();
        trackFirestoreWrite(cleanRecord ? 2 : 1);
      } catch(e) {
        console.warn('[RecycleBin] Cloud purge failed — queuing for retry:', _safeErr(e));
        if (typeof OfflineQueue !== 'undefined') {
          await OfflineQueue.add({
            action: 'delete',
            collection: 'deletions',
            docId: sid,
            data: null
          });
          if (cleanRecord && collectionName) {
            const queuedRecord = typeof sanitizeForFirestore === 'function'
              ? sanitizeForFirestore({ ...cleanRecord, syncedAt: new Date().toISOString() })
              : { ...cleanRecord, syncedAt: new Date().toISOString() };
            queuedRecord.id = newSid;
            delete queuedRecord.originalId;
            await OfflineQueue.add({
              action: 'set',
              collection: collectionName,
              docId: newSid,
              data: queuedRecord
            });
          }
        }
      }
    })();
  }
}
window.purgeRecoveredId = purgeRecoveredId;
async function recoverRecord(deletedId, collectionName) {
const deletedRecordIds = new Set(ensureArray(await sqliteStore.get('deleted_records')));
const deletionRecords = ensureArray(await sqliteStore.get('deletion_records'));
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const factoryProductionHistory = ensureArray(await sqliteStore.get('factory_production_history'));
const salesHistory = ensureArray(await sqliteStore.get('noman_history'));
  if (!deletedId || !collectionName) return false;
  try {
    const sqliteKey = getSQLiteKey(collectionName);
    let recoveredData = null;
    const localDeletionRecords = await sqliteStore.get('deletion_records', []);
    const tombstoneLocal = Array.isArray(localDeletionRecords)
      ? localDeletionRecords.find(r => r.id === deletedId || r.recordId === deletedId)
      : null;
    if (tombstoneLocal && tombstoneLocal.snapshot) {
      recoveredData = tombstoneLocal.snapshot;
    }
    if (!recoveredData && firebaseDB && currentUser) {
      try {
        const userRef = firebaseDB.collection('users').doc(currentUser.uid);
        const tombDoc = await userRef.collection('deletions').doc(String(deletedId)).get();
        if (tombDoc.exists) {
          const td = tombDoc.data();
          if (td && td.snapshot) recoveredData = td.snapshot;
        }
        if (!recoveredData) {
          const origDoc = await userRef.collection(collectionName).doc(String(deletedId)).get();
          if (origDoc.exists) recoveredData = origDoc.data();
        }
      } catch(e) { console.warn('[RecycleBin] snapshot fetch failed:', _safeErr(e)); }
    }
    let cleanRecord = null;
    if (recoveredData) {
      cleanRecord = { ...recoveredData };
      delete cleanRecord.deletedAt;
      delete cleanRecord.tombstoned_at;
      delete cleanRecord.deleted_by;
      delete cleanRecord.deletion_version;
      delete cleanRecord.recoveredAt;
      delete cleanRecord._placeholder;
      delete cleanRecord.isDeleted;
      delete cleanRecord.softDeleted;
      cleanRecord.updatedAt   = Date.now();
      cleanRecord.recoveredAt = Date.now();
      cleanRecord.syncedAt    = new Date().toISOString();
    }
    const newId = (typeof generateUUID === 'function')
      ? generateUUID('recovered')
      : String(deletedId);
    const oldId = String(deletedId);
    if (cleanRecord) {
      cleanRecord.id = newId;
      delete cleanRecord.originalId;
    }
    await purgeRecoveredId(oldId, collectionName, cleanRecord, newId);
    if (cleanRecord && sqliteKey) {
      let localArr = await sqliteStore.get(sqliteKey, []);
      if (!Array.isArray(localArr)) localArr = [];
      localArr = localArr.filter(r => r.id !== oldId && r.id !== newId);
      localArr.push(cleanRecord);
      await sqliteStore.set(sqliteKey, localArr);
    }
    if (typeof invalidateAllCaches === 'function') {
      await invalidateAllCaches();
    }
    if (collectionName === 'expenses' || collectionName === 'transactions') {
      try {
        const _recOldPhKey = 'expense:' + oldId;
        const _recNewPhKey = 'expense:' + newId;
        const _recPh = (await sqliteStore.get('person_photos')) || {};
        const _recPhTs = (await sqliteStore.get('person_photos_timestamps')) || {};
        const _tombstone = (Array.isArray(localDeletionRecords) ? localDeletionRecords : deletionRecords).find(r => r.id === deletedId || r.recordId === deletedId);
        const _recPhotoData = (_tombstone && _tombstone._photoDataUrl)
          ? _tombstone._photoDataUrl
          : (_recPh[_recOldPhKey] || null);
        if (_recPhotoData) {
          _recPh[_recNewPhKey] = _recPhotoData;
          _recPhTs[_recNewPhKey] = Date.now();
          delete _recPh[_recOldPhKey];
          delete _recPhTs[_recOldPhKey];
          await sqliteStore.set('person_photos', _recPh);
          await sqliteStore.set('person_photos_timestamps', _recPhTs);
          const _recDk = (await sqliteStore.get('person_photos_dirty_keys')) || [];
          if (!_recDk.includes(_recNewPhKey)) _recDk.push(_recNewPhKey);
          if (!_recDk.includes(_recOldPhKey)) _recDk.push(_recOldPhKey);
          await sqliteStore.set('person_photos_dirty_keys', _recDk);
          await sqliteStore.set('person_photos_timestamp', Date.now());
        }
      } catch(_recPhErr) { console.warn('[recoverRecord] photo restore failed', _recPhErr); }
    }
    triggerAutoSync();
    return true;
  } catch(e) {
    console.error('[RecycleBin] recoverRecord error:', _safeErr(e));
    _recoveredThisSession.delete(String(deletedId));
    return false;
  }
}
window.recoverRecord = recoverRecord;
window.registerDeletion = registerDeletion;
const RECYCLE_COLLECTION_TO_TAB = {
  'sales':              'tab_sales',
  'sales_customers':    'tab_sales',
  'rep_sales':          'tab_rep',
  'rep_customers':      'tab_rep',
  'production':         'tab_production',
  'returns':            'tab_production',
  'calculator_history': 'tab_calculator',
  'factory_history':    'tab_factory',
  'inventory':          'tab_factory',
  'transactions':       'tab_payments',
  'expenses':           'tab_payments',
  'entities':           'tab_payments',
  'unknown':            'tab_payments',
};
const RECYCLE_BIN_COLLECTION_LABELS = {
  'sales':              'Customer Sale',
  'sales_customers':    'Customer Contact',
  'rep_sales':          'Rep Sale',
  'rep_customers':      'Rep Customer',
  'production':         'Production Batch',
  'returns':            'Stock Return',
  'calculator_history': 'Calculator Entry',
  'factory_history':    'Factory Production',
  'inventory':          'Inventory Item',
  'transactions':       'Transaction',
  'expenses':           'Expense',
  'entities':           'Payment Entity',
  'unknown':            'Record',
};
const RECYCLE_TAB_LABELS = {
  'tab_sales':       'Sales Tab',
  'tab_rep':         'Rep Tab',
  'tab_production':  'Manufacturing Tab',
  'tab_calculator':  'Calculator Tab',
  'tab_factory':     'Factory Tab',
  'tab_payments':    'Payments Tab',
};
const RECYCLE_RECOVERABLE_COLLECTIONS = new Set([
  'sales','transactions','rep_sales','expenses','production',
  'factory_history','inventory','returns','calculator_history',
  'sales_customers','rep_customers','entities'
]);
async function openRecycleBin() {
if (typeof openStandaloneScreen === 'function') openStandaloneScreen('recycle-bin-screen');

const MODE_TO_RECYCLE_FILTER = {
  'production': 'tab_production',
  'factory':    'tab_factory',
  'rep':        'tab_rep',
  'sales':      'tab_sales',
  'userrole':   null,
  'admin':      null,
};
const mode = window.appMode || 'admin';
let defaultFilter = 'all';
if (mode === 'userrole') {
  const tabs = window._assignedUserTabs || [];
  if (tabs.length === 1) {
    const singleTabMap = {
      'prod':     'tab_production',
      'factory':  'tab_factory',
      'rep':      'tab_rep',
      'sales':    'tab_sales',
      'calc':     'tab_calculator',
      'payments': 'tab_payments',
    };
    defaultFilter = singleTabMap[tabs[0]] || 'all';
  }
} else {
  defaultFilter = MODE_TO_RECYCLE_FILTER[mode] || 'all';
}

const filterSel = document.getElementById('recycleBinFilter');
if (filterSel) {
  const allowedFilters = new Set();
  allowedFilters.add('all');
  if (mode === 'admin') {

    Array.from(filterSel.options).forEach(opt => { opt.style.display = ''; });
  } else if (mode === 'userrole') {
    const tabs = window._assignedUserTabs || [];
    const tabToFilter = { prod:'tab_production', factory:'tab_factory', rep:'tab_rep', sales:'tab_sales', calc:'tab_calculator', payments:'tab_payments' };
    tabs.forEach(t => { if (tabToFilter[t]) allowedFilters.add(tabToFilter[t]); });
    Array.from(filterSel.options).forEach(opt => {
      opt.style.display = allowedFilters.has(opt.value) ? '' : 'none';
    });
  } else {
    if (defaultFilter !== 'all') allowedFilters.add(defaultFilter);
    Array.from(filterSel.options).forEach(opt => {
      opt.style.display = allowedFilters.has(opt.value) ? '' : 'none';
    });
  }
  filterSel.value = defaultFilter;
}
await renderRecycleBin(defaultFilter);
}

function closeRecycleBin() {
if (typeof closeStandaloneScreen === 'function') closeStandaloneScreen('recycle-bin-screen');
}

async function renderRecycleBin(filterCollection = 'all') {
  const container = document.getElementById('recycleBinList');
  const statsEl   = document.getElementById('recycleBinStats');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">Loading...</div>';
  try {
    let localDeletionRecords = ensureArray(await sqliteStore.get('deletion_records'));
    localDeletionRecords = localDeletionRecords.filter(r =>
      !_recoveredThisSession.has(r.id) && !_recoveredThisSession.has(r.recordId)
    );
    if (firebaseDB && currentUser) {
      try {
        const userRef = firebaseDB.collection('users').doc(currentUser.uid);
        const snap = await userRef.collection('deletions').orderBy('deletedAt', 'desc').limit(200).get();
        const seenIds = new Set(localDeletionRecords.map(r => String(r.id)));
        const seenRecordIds = new Set(localDeletionRecords.map(r => String(r.recordId || r.id)));
        snap.docs.forEach(doc => {
          const d = doc.data();
          if (!d || d._placeholder) return;
          const docId = String(doc.id);
          const recId = String(d.recordId || d.id || doc.id);
          if (_recoveredThisSession.has(docId) || _recoveredThisSession.has(recId)) return;
          if (seenIds.has(docId) || seenRecordIds.has(docId) ||
              seenIds.has(recId)  || seenRecordIds.has(recId)) return;
          seenIds.add(docId);
          seenRecordIds.add(recId);
          localDeletionRecords.push({
            id: docId,
            recordId: recId,
            collection: d.collection || d.recordType || 'unknown',
            deletedAt: d.deletedAt?.toMillis ? d.deletedAt.toMillis() : (d.deletedAt || Date.now()),
            syncedToCloud: true,
            deleted_by: d.deleted_by || 'user',
            snapshot: d.snapshot || null,
            displayName: d.displayName || null,
            displayDetail: d.displayDetail || null,
            displayAmount: d.displayAmount || null,
          });
        });
      } catch(e) {   }
    }
    const _seen = new Map();
    for (const r of localDeletionRecords) {
      const key = String(r.id || r.recordId);
      const existing = _seen.get(key);
      if (!existing || (!existing.displayName && r.displayName) ||
          (!existing.snapshot && r.snapshot)) {
        _seen.set(key, r);
      }
    }
    localDeletionRecords = Array.from(_seen.values());

    for (const r of localDeletionRecords) {
      if (r.displayName) { continue; }
      const col = r.collection || 'unknown';
      const s = r.snapshot;
      if (s && typeof s === 'object') {

        if (col === 'sales') {
          r.displayName   = s.customerName || s.name || null;
          r.displayDetail = r.displayDetail || [s.supplyStore || s.store || '', s.paymentType || '', s.date || ''].filter(Boolean).join(' · ');
          r.displayAmount = r.displayAmount || (s.totalValue != null ? `₨${Number(s.totalValue).toLocaleString()}` : null);
        } else if (col === 'rep_sales') {
          r.displayName   = s.customerName || s.name || null;
          r.displayDetail = r.displayDetail || [s.salesRep ? `Rep: ${s.salesRep}` : '', s.paymentType || '', s.date || ''].filter(Boolean).join(' · ');
          r.displayAmount = r.displayAmount || (s.totalValue != null ? `₨${Number(s.totalValue).toLocaleString()}` : null);
        } else if (col === 'transactions') {
          r.displayName   = s.entityName || s.name || s.description || null;
          r.displayDetail = r.displayDetail || [s.type === 'IN' ? '↓ IN' : s.type === 'OUT' ? '↑ OUT' : (s.type || ''), s.date || ''].filter(Boolean).join(' · ');
          r.displayAmount = r.displayAmount || (s.amount != null ? `₨${Number(s.amount).toLocaleString()}` : null);
        } else if (col === 'expenses') {
          r.displayName   = s.name || s.description || null;
          r.displayDetail = r.displayDetail || [s.category || '', s.date || ''].filter(Boolean).join(' · ');
          r.displayAmount = r.displayAmount || (s.amount != null ? `₨${Number(s.amount).toLocaleString()}` : null);
        } else if (col === 'production') {
          r.displayName   = s.supplyStore || s.store ? `Production – ${s.supplyStore || s.store}` : null;
          r.displayDetail = r.displayDetail || s.date || '';
          r.displayAmount = r.displayAmount || (s.net != null ? `${s.net} kg` : null);
        } else if (col === 'returns') {
          r.displayName   = s.store ? `Return – ${s.store}` : null;
          r.displayDetail = r.displayDetail || s.date || '';
        } else if (col === 'factory_history') {
          r.displayName   = s.store ? `Factory – ${s.store}` : null;
          r.displayDetail = r.displayDetail || s.date || '';
        } else if (col === 'sales_customers' || col === 'rep_customers') {
          r.displayName   = s.name || null;
        } else {
          r.displayName   = s.name || s.customerName || s.entityName || s.description || null;
          r.displayAmount = r.displayAmount || ((s.amount ?? s.totalValue) != null ? `₨${Number(s.amount ?? s.totalValue).toLocaleString()}` : null);
        }
      }

      if (!r.displayName) {
        try {
          const live = await _captureRecordSnapshot(r.id || r.recordId, col);
          if (live && live.displayName) {
            r.displayName   = live.displayName;
            r.displayDetail = r.displayDetail || live.displayDetail;
            r.displayAmount = r.displayAmount || live.displayAmount;
          }
        } catch(_e) {}
      }
    }
    localDeletionRecords.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
    if (statsEl) {
      statsEl.textContent = `${localDeletionRecords.length} deleted record${localDeletionRecords.length !== 1 ? 's' : ''} (kept for 90 days)`;
    }
    const filterSel = document.getElementById('recycleBinFilter');
    if (filterSel && filterSel.value !== filterCollection) filterSel.value = filterCollection;
    const filtered = filterCollection === 'all'
      ? localDeletionRecords
      : localDeletionRecords.filter(r => {
          const tab = RECYCLE_COLLECTION_TO_TAB[r.collection || 'unknown'] || 'tab_payments';
          return tab === filterCollection;
        });
    if (filtered.length === 0) {
      container.innerHTML = `<div style="text-align:center;padding:50px 20px;color:var(--text-muted);">
        <div style="font-size:1rem;font-weight:600;">Recycle Bin is empty</div>
        <div style="font-size:0.78rem;margin-top:6px;">Deleted transactions will appear here and can be recovered within 90 days.</div>
      </div>`;
      return;
    }
    container.innerHTML = filtered.map(rec => {
      const col = rec.collection || 'unknown';
      const tabKey = RECYCLE_COLLECTION_TO_TAB[col] || 'tab_payments';
      const tabLabel = RECYCLE_TAB_LABELS[tabKey] || tabKey;
      const typeLabel = `${tabLabel} › ${RECYCLE_BIN_COLLECTION_LABELS[col] || col}`;
      const deletedDate = rec.deletedAt
        ? new Date(rec.deletedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
        : 'Unknown date';
      const daysAgo = rec.deletedAt ? Math.floor((Date.now() - rec.deletedAt) / 86400000) : '?';
      const expiresIn = rec.deletedAt ? Math.max(0, 90 - Math.floor((Date.now() - rec.deletedAt) / 86400000)) : '?';
      const canRecover = RECYCLE_RECOVERABLE_COLLECTIONS.has(col);
      let displayName = rec.displayName || null;
      let displayDetail = rec.displayDetail || null;
      let displayAmount = rec.displayAmount || null;
      if (!displayName && rec.snapshot) {
        const snap = _captureRecordSnapshot._fromObj
          ? _captureRecordSnapshot._fromObj(rec.snapshot, col)
          : null;
        if (snap && snap.displayName) {
          displayName   = snap.displayName;
          displayDetail = snap.displayDetail;
          displayAmount = snap.displayAmount;
        } else {
          const s = rec.snapshot;
          if (col === 'sales' || col === 'rep_sales') {
            displayName   = s.customerName || s.name || null;
            displayDetail = [s.supplyStore || s.store || '', s.paymentType || '', s.date || ''].filter(Boolean).join(' · ');
            displayAmount = s.totalValue != null ? `₨${Number(s.totalValue).toLocaleString()}` : null;
          } else if (col === 'transactions') {
            displayName   = s.entityName || s.description || s.name || null;
            displayDetail = [s.type === 'IN' ? '↓ IN' : s.type === 'OUT' ? '↑ OUT' : (s.type || ''), s.date || ''].filter(Boolean).join(' · ');
            displayAmount = s.amount != null ? `₨${Number(s.amount).toLocaleString()}` : null;
          } else if (col === 'expenses') {
            displayName   = s.name || s.description || null;
            displayDetail = [s.category || '', s.date || ''].filter(Boolean).join(' · ');
            displayAmount = s.amount != null ? `₨${Number(s.amount).toLocaleString()}` : null;
          } else if (col === 'production') {
            displayName   = s.supplyStore || s.store ? `Production – ${s.supplyStore || s.store}` : 'Production Batch';
            displayDetail = s.date || '';
            displayAmount = s.net != null ? `${s.net} kg` : null;
          } else if (col === 'returns') {
            displayName   = s.store ? `Return – ${s.store}` : 'Stock Return';
            displayDetail = s.date || '';
            displayAmount = s.quantity != null ? `${s.quantity} kg` : null;
          } else if (col === 'factory_history') {
            displayName   = s.store ? `Factory – ${s.store}` : 'Factory Production';
            displayDetail = s.date || '';
            displayAmount = s.units != null ? `${s.units} units` : null;
          } else if (col === 'calculator_history') {
            displayName   = s.customerName || s.customer || s.name || 'Calculator Entry';
            displayDetail = s.supplyStore || s.store || '';
            displayAmount = s.totalValue != null ? `₨${Number(s.totalValue).toLocaleString()}` : null;
          } else {
            displayName = s.customerName || s.entityName || s.name || s.description || null;
            displayAmount = (s.amount ?? s.totalValue) != null ? `₨${Number(s.amount ?? s.totalValue).toLocaleString()}` : null;
          }
        }
      }

      const _snap = rec.snapshot || {};
      const _rbCreatedBy = _snap.createdBy || rec.createdBy || null;
      const _rbManagedBy = _snap.managedBy || rec.managedBy || null;
      const _rbSalesRep  = _snap.salesRep  || rec.salesRep  || null;
      const _rbCreatorBadge = _rbCreatedBy
        ? `<span class="creator-badge">${esc(_rbCreatedBy)}</span>`
        : '';
      const _rbManagedBadge = _rbManagedBy
        ? `<span class="managed-by-badge">${esc(_rbManagedBy)}</span>`
        : '';
      const _rbRepBadge = (_rbSalesRep && !_rbCreatedBy)
        ? `<span class="sales-rep-badge">${esc(_rbSalesRep.split(' ')[0])}</span>`
        : '';
      const _rbBadgesHtml = [_rbManagedBadge, _rbCreatorBadge, _rbRepBadge].filter(Boolean).join('');

      const _rbDeletedByRaw = rec.deleted_by || null;
      const _rbDeletedByBadge = (_rbDeletedByRaw && _rbDeletedByRaw !== 'user')
        ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:0.62rem;font-weight:700;letter-spacing:0.04em;color:#f87171;white-space:nowrap;"><svg width="9" height="9" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;"><path d="M8 11 L10 31 L12 33 H24 L26 31 L28 11 Z" fill="var(--danger)" fill-opacity="0.15" stroke="var(--danger)" stroke-width="1.5" stroke-linejoin="round"/><line x1="6" y1="11" x2="30" y2="11" stroke="var(--danger)" stroke-width="1.6" stroke-linecap="round"/><path d="M14 8 H22 M14 8 L15 7 H21 L22 8" stroke="var(--danger)" stroke-width="1.4" stroke-linecap="round"/></svg>${esc(_rbDeletedByRaw)}</span>`
        : '';

      const nameHtml = displayName
        ? `<span style="font-size:0.88rem;font-weight:700;color:var(--text-main);">${esc(displayName)}</span>`
        : `<span style="font-size:0.82rem;font-weight:600;color:var(--text-muted);font-style:italic;">${esc(RECYCLE_BIN_COLLECTION_LABELS[col] || col)} — name unavailable</span>`;
      const detailHtml = displayDetail
        ? `<span style="font-size:0.72rem;color:var(--text-muted);">${esc(displayDetail)}</span>`
        : '';
      const amountHtml = displayAmount
        ? `<span style="font-size:0.78rem;font-weight:700;color:var(--accent);">${esc(displayAmount)}</span>`
        : '';
      const syncBadge = rec.syncedToCloud
        ? `<span class="sync-status-badge sync-ok"> synced</span>`
        : `<span class="sync-status-badge sync-local"> local</span>`;
      const colDot = {
        'sales':'#10b981','transactions':'#3b82f6','rep_sales':'#8b5cf6',
        'expenses':'#f59e0b','production':'#ec4899','factory_history':'#14b8a6',
        'returns':'#f97316','unknown':'#9ca3af'
      }[col] || '#9ca3af';
      const typeTag = `<span class="type-tag-badge">${esc(typeLabel)}</span>`;
      return `<div style="background:var(--input-bg);border:1px solid var(--glass-border);border-radius:12px;padding:12px 14px;margin-bottom:9px;display:flex;align-items:center;gap:11px;">
        <div style="width:9px;height:9px;min-width:9px;border-radius:50%;background:${colDot};flex-shrink:0;"></div>
        <div style="flex:1;min-width:0;overflow:hidden;">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:2px;">
            ${nameHtml}
            ${amountHtml}
          </div>
          <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:3px;">
            ${typeTag}
            ${detailHtml}
            ${syncBadge}
            ${_rbBadgesHtml}
            ${_rbDeletedByBadge}
          </div>
          <div style="font-size:0.68rem;color:var(--text-muted);">
            Deleted ${daysAgo === 0 ? 'today' : daysAgo + 'd ago'} · ${deletedDate} · expires in ${expiresIn}d
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0;">
          ${canRecover
            ? `<button onclick="attemptRecoverRecord('${esc(rec.id)}','${esc(col)}')" style="display:inline-flex;align-items:center;gap:4px;padding:7px 13px;background:rgba(16,185,129,0.15);color:#10b981;border:1px solid rgba(16,185,129,0.3);border-radius:999px;font-size:0.78rem;font-weight:700;cursor:pointer;white-space:nowrap;"><svg width="13" height="13" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;"><polyline points="8,20 18,10 28,20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="18" y1="10" x2="18" y2="30" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Recover</button>`
            : `<span style="font-size:0.7rem;color:var(--text-muted);padding:4px 8px;">—</span>`}
          <button onclick="attemptHardDeleteRecord('${esc(rec.id)}','${esc(col)}')" style="display:inline-flex;align-items:center;gap:4px;padding:5px 10px;background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.3);border-radius:999px;font-size:0.7rem;font-weight:700;cursor:pointer;white-space:nowrap;"><svg width="11" height="11" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;"><path d="M8 11 L10 31 L12 33 H24 L26 31 L28 11 Z" fill="currentColor" opacity="0.15" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><line x1="6" y1="11" x2="30" y2="11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M14 8 H22 M14 8 L15 7 H21 L22 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="15" y1="17" x2="15" y2="27" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="21" y1="17" x2="21" y2="27" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg> Delete Forever</button>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);">Failed to load recycle bin.</div>`;
    console.error('[RecycleBin] render error', _safeErr(e));
  }
}

async function attemptRecoverRecord(id, collectionName) {
const deletedRecordIds = new Set(ensureArray(await sqliteStore.get('deleted_records')));
const deletionRecords = ensureArray(await sqliteStore.get('deletion_records'));
  const tabKey = RECYCLE_COLLECTION_TO_TAB[collectionName] || 'tab_payments';
  const tabLabel = RECYCLE_TAB_LABELS[tabKey] || tabKey;
  const label = `${tabLabel} › ${RECYCLE_BIN_COLLECTION_LABELS[collectionName] || collectionName}`;
  if (!(await showGlassConfirm(
    `Recover this ${label}?\n\nIt will be restored to its original collection and become visible again in all views.`,
    { title: 'Recover Record', confirmText: 'Recover', danger: false }
  ))) return;
  showToast('Recovering record…', 'info', 1500);
  const ok = await recoverRecord(id, collectionName);
  if (ok) {
    showToast(`${label} recovered successfully!`, 'success');
    notifyDataChange('all');
    if (typeof calculateNetCash === 'function') calculateNetCash();
    if (typeof calculateCashTracker === 'function') calculateCashTracker();
    const filterSel = document.getElementById('recycleBinFilter');
    const current = filterSel ? filterSel.value : 'all';
    await renderRecycleBin(current);
  } else {
    showToast('Recovery failed. The record may have been permanently purged from cloud.', 'error');
  }
}
window.openRecycleBin = openRecycleBin;
window.closeRecycleBin = closeRecycleBin;
window.renderRecycleBin = renderRecycleBin;
window.attemptRecoverRecord = attemptRecoverRecord;

async function hardDeleteRecord(id, collectionName) {
  if (!id || !collectionName) return false;
  const sid = String(id);
  try {

    const deletedRecordIds = new Set(ensureArray(await sqliteStore.get('deleted_records')));
    deletedRecordIds.delete(sid);
    await sqliteStore.set('deleted_records', Array.from(deletedRecordIds));

    const deletionRecords = ensureArray(await sqliteStore.get('deletion_records'));
    const pruned = deletionRecords.filter(r => String(r.id) !== sid && String(r.recordId || r.id) !== sid);
    await sqliteStore.set('deletion_records', pruned);

    _recoveredThisSession.add(sid);

    const sqliteKey = getSQLiteKey(collectionName);
    if (sqliteKey) {
      const store = ensureArray(await sqliteStore.get(sqliteKey));
      const filtered = store.filter(r => String(r.id) !== sid);
      if (filtered.length !== store.length) {
        await sqliteStore.set(sqliteKey, filtered);
      }
    }

    if (typeof OfflineQueue !== 'undefined') {
      const isThisId = (item) => {
        const op = item.operation || {};
        return op.docId === sid;
      };
      const qBefore = OfflineQueue.queue.length;
      OfflineQueue.queue = OfflineQueue.queue.filter(item => !isThisId(item));
      if (OfflineQueue.queue.length !== qBefore) {
        try { await OfflineQueue.saveQueue(); } catch(e) {}
      }
      if (Array.isArray(OfflineQueue.deadLetterQueue)) {
        OfflineQueue.deadLetterQueue = OfflineQueue.deadLetterQueue.filter(item => !isThisId(item));
        try { await OfflineQueue.saveDeadLetterQueue(); } catch(e) {}
      }
    }

    if (firebaseDB && currentUser) {
      (async () => {
        try {
          const userRef = firebaseDB.collection('users').doc(currentUser.uid);
          const batch = firebaseDB.batch();
          batch.delete(userRef.collection('deletions').doc(sid));
          batch.delete(userRef.collection(collectionName).doc(sid));
          if (collectionName === 'expenses' || collectionName === 'transactions') {
            const _hdPhotoKey = 'expense:' + sid;
            const _hdSafeDocId = btoa(unescape(encodeURIComponent(_hdPhotoKey))).replace(/[+/=]/g, c => ({'+':'-','/':'_','=':''})[c] || '');
            batch.delete(userRef.collection('personPhotos').doc(_hdSafeDocId));
          }
          await batch.commit();
          trackFirestoreWrite(2);
        } catch(e) {
          console.warn('[RecycleBin] Hard delete cloud failed — queuing:', _safeErr(e));
          if (typeof OfflineQueue !== 'undefined') {
            await OfflineQueue.add({ action: 'delete', collection: 'deletions',      docId: sid, data: null });
            await OfflineQueue.add({ action: 'delete', collection: collectionName,   docId: sid, data: null });
            if (collectionName === 'expenses' || collectionName === 'transactions') {
              const _hdPhotoKey = 'expense:' + sid;
              const _hdSafeDocId = btoa(unescape(encodeURIComponent(_hdPhotoKey))).replace(/[+/=]/g, c => ({'+':'-','/':'_','=':''})[c] || '');
              await OfflineQueue.add({ action: 'delete', collection: 'personPhotos', docId: _hdSafeDocId, data: null });
            }
          }
        }
      })();
    } else if (typeof OfflineQueue !== 'undefined') {
      try {
        await OfflineQueue.add({ action: 'delete', collection: 'deletions',    docId: sid, data: null });
        await OfflineQueue.add({ action: 'delete', collection: collectionName, docId: sid, data: null });
        if (collectionName === 'expenses' || collectionName === 'transactions') {
          const _hdOffPhKey = 'expense:' + sid;
          const _hdOffSafeDocId = btoa(unescape(encodeURIComponent(_hdOffPhKey))).replace(/[+/=]/g, c => ({'+':'-','/':'_','=':''})[c] || '');
          await OfflineQueue.add({ action: 'delete', collection: 'personPhotos', docId: _hdOffSafeDocId, data: null });
        }
      } catch(_hdOffErr) { console.warn('[hardDeleteRecord] offline queue failed', _hdOffErr); }
    }
    if (collectionName === 'expenses' || collectionName === 'transactions') {
      try {
        const _hdLocalPhKey = 'expense:' + sid;
        const _hdLocalPh = (await sqliteStore.get('person_photos')) || {};
        if (_hdLocalPh[_hdLocalPhKey] !== undefined) {
          delete _hdLocalPh[_hdLocalPhKey];
          await sqliteStore.set('person_photos', _hdLocalPh);
          const _hdLocalTs = (await sqliteStore.get('person_photos_timestamps')) || {};
          delete _hdLocalTs[_hdLocalPhKey];
          await sqliteStore.set('person_photos_timestamps', _hdLocalTs);
          const _hdDk = (await sqliteStore.get('person_photos_dirty_keys')) || [];
          const _hdDkFiltered = _hdDk.filter(k => k !== _hdLocalPhKey);
          if (_hdDkFiltered.length !== _hdDk.length) await sqliteStore.set('person_photos_dirty_keys', _hdDkFiltered);
        }
      } catch(_hdPhErr) { console.warn('[hardDeleteRecord] photo local cleanup failed', _hdPhErr); }
    }
    return true;
  } catch(e) {
    console.error('[RecycleBin] hardDeleteRecord error:', _safeErr(e));
    return false;
  }
}

async function attemptHardDeleteRecord(id, collectionName) {
  const tabKey   = RECYCLE_COLLECTION_TO_TAB[collectionName] || 'tab_payments';
  const tabLabel = RECYCLE_TAB_LABELS[tabKey] || tabKey;
  const label    = `${tabLabel} › ${RECYCLE_BIN_COLLECTION_LABELS[collectionName] || collectionName}`;
  const confirmed = await showGlassConfirm(
    `Permanently delete this ${label}?\n\nThis action CANNOT be undone. The record will be erased from all local storage and the cloud.`,
    { title: 'Delete Forever', confirmText: 'Delete Forever', danger: true }
  );
  if (!confirmed) return;
  showToast('Deleting permanently…', 'info', 1500);
  const ok = await hardDeleteRecord(id, collectionName);
  if (ok) {
    showToast(`${label} permanently deleted.`, 'success');
    notifyDataChange('all');
    if (typeof calculateNetCash === 'function') calculateNetCash();
    if (typeof calculateCashTracker === 'function') calculateCashTracker();
    const filterSel = document.getElementById('recycleBinFilter');
    const current = filterSel ? filterSel.value : 'all';
    await renderRecycleBin(current);
  } else {
    showToast('Hard delete failed. Please try again.', 'error');
  }
}
window.hardDeleteRecord = hardDeleteRecord;
window.attemptHardDeleteRecord = attemptHardDeleteRecord;
async function triggerLocalBackup() {
const deletedRecordIds = new Set(ensureArray(await sqliteStore.get('deleted_records')));
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
const factorySalePrices = (await sqliteStore.get('factory_sale_prices')) || {};
const factoryCostAdjustmentFactor = (await sqliteStore.get('factory_cost_adjustment_factor')) || {};
const factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
const salesHistory = ensureArray(await sqliteStore.get('noman_history'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const factoryProductionHistory = ensureArray(await sqliteStore.get('factory_production_history'));
const expenseCategories = ensureArray(await sqliteStore.get('expense_categories'));
closeDataMenu();
if (!currentUser) {
showToast('Please sign in to create a backup.', 'error');
showAuthOverlay();
return;
}
const data = {
mfg: db,
sales: await sqliteStore.get('noman_history', []),
customerSales: await sqliteStore.get('customer_sales', []),
repSales: await sqliteStore.get('rep_sales', []),
repCustomers: await sqliteStore.get('rep_customers', []),
salesCustomers: await sqliteStore.get('sales_customers', []),
factoryInventoryData: factoryInventoryData,
factoryProductionHistory: factoryProductionHistory,
factoryDefaultFormulas: factoryDefaultFormulas,
factoryAdditionalCosts: factoryAdditionalCosts,
factoryCostAdjustmentFactor: factoryCostAdjustmentFactor,
factorySalePrices: factorySalePrices,
factoryUnitTracking: factoryUnitTracking,
paymentEntities: paymentEntities,
paymentTransactions: paymentTransactions,
expenses: await sqliteStore.get('expenses', []),
stockReturns: stockReturns,
settings: await sqliteStore.get('naswar_default_settings', defaultSettings),
deleted_records: Array.from(deletedRecordIds),
person_photos: (await sqliteStore.get('person_photos')) || {},
person_photos_timestamps: (await sqliteStore.get('person_photos_timestamps')) || {},
_meta: { encryptedFor: currentUser.email, encryptedUid: currentUser.uid, createdAt: Date.now(), version: 4 },
backupMetadata: {
version: '3.0',
timestamp: Date.now(),
date: new Date().toISOString(),
deviceInfo: navigator.userAgent.substring(0, 100)
}
};
const encPassword = await promptVerifiedBackupPassword({ inputId: 'enc_local_bkp_pwd' });
if (!encPassword) {
showToast('Backup cancelled.', 'info');
return;
}
try {
showToast('Encrypting backup with AES-256-GCM...', 'info', 3000);
const encryptedBlob = await CryptoEngine.encrypt(data, currentUser.email, encPassword, currentUser.uid);
const timestamp = new Date().toISOString().split('T')[0];
_triggerFileDownload(encryptedBlob, `NaswarDealers_SecureBackup_${timestamp}.gznd`);
showToast('Encrypted backup saved! Only your account and credentials can restore this file.', 'success', 5000);
} catch(encErr) {
console.error('Encryption failed:', _safeErr(encErr));
showToast('Encryption failed: ' + encErr.message, 'error');
}
}

async function uploadOldDataToCloud(event) {
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const factoryProductionHistory = ensureArray(await sqliteStore.get('factory_production_history'));
const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
const factorySalePrices = (await sqliteStore.get('factory_sale_prices')) || {};
const factoryCostAdjustmentFactor = (await sqliteStore.get('factory_cost_adjustment_factor')) || {};
const factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
const file = event.target.files[0];
event.target.value = '';
if (!file) return;
if (!firebaseDB || !currentUser) {
showToast('Please sign in first before uploading.', 'warning');
closeDataMenu();
showAuthOverlay();
return;
}
if (isSyncing) {
showToast('Another sync is running. Please wait.', 'info');
return;
}
closeDataMenu();
showToast('Reading backup file...', 'info');
try {
const text = await _readFileAsText(file);
const data = JSON.parse(text);
if (!data.mfg && !data.mfg_pro_pkr && !data.customerSales && !data.repSales && !data.repCustomers) {
showToast('This file does not look like a valid backup.', 'error');
return;
}
const _utcMsg = `Upload this device's local data to the cloud database?\n\n• Existing cloud records will NOT be deleted\n• Where duplicates exist, the newer version wins\n• Deleted records (tombstones) are respected\n• Other devices will receive your changes on their next sync\n\nThis is a one-way push — cloud records newer than yours are preserved.`;
if (!(await showGlassConfirm(_utcMsg, { title: 'Upload Local Data to Cloud', confirmText: 'Upload', cancelText: 'Cancel' }))) return;
isSyncing = true;
showToast('Uploading to cloud...', 'info');
const normalized = {
mfg_pro_pkr: data.mfg || data.mfg_pro_pkr || [],
noman_history: data.sales || data.noman_history || [],
customer_sales: data.customerSales || data.customer_sales || [],
rep_sales: data.repSales || data.rep_sales || [],
rep_customers: data.repCustomers || data.rep_customers || [],
sales_customers: data.salesCustomers || data.sales_customers || [],
factory_inventory_data: data.factoryInventoryData || data.factory_inventory_data || [],
factory_production_history: data.factoryProductionHistory || data.factory_production_history|| [],
payment_entities: data.paymentEntities || data.payment_entities || [],
payment_transactions: data.paymentTransactions || data.payment_transactions || [],
stock_returns: data.stockReturns || data.stock_returns || [],
factory_default_formulas: data.factoryDefaultFormulas || data.factory_default_formulas || { standard: [], asaan: [] },
factory_additional_costs: data.factoryAdditionalCosts || data.factory_additional_costs || { standard: 0, asaan: 0 },
factory_cost_adjustment_factor: data.factoryCostAdjustmentFactor || data.factory_cost_adjustment_factor || { standard: 1, asaan: 1 },
factory_sale_prices: data.factorySalePrices || data.factory_sale_prices || { standard: 0, asaan: 0 },
factory_unit_tracking: data.factoryUnitTracking || data.factory_unit_tracking || {
standard: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
asaan: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] }
},
naswar_default_settings: data.settings || data.naswar_default_settings || {},
deleted_records: data.deleted_records || [],
appMode: data.appMode || 'admin',
repProfile: data.repProfile || salesRepsList[0] || 'NORAN SHAH'
};
const fileTombstones = new Set(normalized.deleted_records);
const filterAlive = (arr) => {
if (!Array.isArray(arr)) return [];
return arr.filter(item => {
if (!item || !item.id) return false;
if (fileTombstones.has(item.id)) return false;
return true;
});
};
normalized.mfg_pro_pkr = filterAlive(normalized.mfg_pro_pkr);
normalized.noman_history = filterAlive(normalized.noman_history);
normalized.customer_sales = filterAlive(normalized.customer_sales);
normalized.rep_sales = filterAlive(normalized.rep_sales);
normalized.rep_customers = filterAlive(normalized.rep_customers);
normalized.sales_customers = filterAlive(normalized.sales_customers);
normalized.factory_inventory_data = filterAlive(normalized.factory_inventory_data);
normalized.factory_production_history = filterAlive(normalized.factory_production_history);
normalized.payment_entities = filterAlive(normalized.payment_entities);
normalized.payment_transactions = filterAlive(normalized.payment_transactions);
normalized.stock_returns = filterAlive(normalized.stock_returns);
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
const buildDeltaQuery = async (collection, collectionName) => {
const lastSync = await DeltaSync.getLastSyncFirestoreTimestamp(collectionName);
if (lastSync) {
return collection.where('updatedAt', '>', lastSync).get();
}
return collection.get();
};
const [
prodSnap, salesSnap, calcSnap, repSnap, transSnap, entSnap,
invSnap, factSnap, retSnap,
repCustomersSnap, salesCustomersSnap, expensesSnap,
settingsSnap, factorySettingsSnap,
expenseCategoriesSnap, deletionsSnap
] = await Promise.all([
buildDeltaQuery(userRef.collection('production'), 'production'),
buildDeltaQuery(userRef.collection('sales'), 'sales'),
buildDeltaQuery(userRef.collection('calculator_history'), 'calculator_history'),
buildDeltaQuery(userRef.collection('rep_sales'), 'rep_sales'),
buildDeltaQuery(userRef.collection('transactions'), 'transactions'),
buildDeltaQuery(userRef.collection('entities'), 'entities'),
buildDeltaQuery(userRef.collection('inventory'), 'inventory'),
buildDeltaQuery(userRef.collection('factory_history'), 'factory_history'),
buildDeltaQuery(userRef.collection('returns'), 'returns'),
buildDeltaQuery(userRef.collection('rep_customers'), 'rep_customers'),
buildDeltaQuery(userRef.collection('sales_customers'), 'sales_customers'),
buildDeltaQuery(userRef.collection('expenses'), 'expenses'),
userRef.collection('settings').doc('config').get(),
userRef.collection('factorySettings').doc('config').get(),
userRef.collection('expenseCategories').doc('categories').get(),
userRef.collection('deletions').get()
]);
const cloudData = {
mfg_pro_pkr: prodSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
customer_sales: salesSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
noman_history: calcSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
rep_sales: repSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
payment_transactions: transSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
payment_entities: entSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
factory_inventory_data: invSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
factory_production_history: factSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
stock_returns: retSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
rep_customers:  repCustomersSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
sales_customers: salesCustomersSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() })),
expenses: expensesSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => ({ id: doc.id, ...doc.data() }))
};
if (factorySettingsSnap && factorySettingsSnap.exists) {
const factoryData = factorySettingsSnap.data();
cloudData.factory_default_formulas = factoryData.default_formulas || { standard: [], asaan: [] };
cloudData.factory_additional_costs = factoryData.additional_costs || { standard: 0, asaan: 0 };
cloudData.factory_cost_adjustment_factor = factoryData.cost_adjustment_factor || { standard: 1, asaan: 1 };
cloudData.factory_sale_prices = factoryData.sale_prices || { standard: 0, asaan: 0 };
cloudData.factory_unit_tracking = factoryData.unit_tracking || {
standard: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
asaan: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] }
};
} else {
cloudData.factory_default_formulas = { standard: [], asaan: [] };
cloudData.factory_additional_costs = { standard: 0, asaan: 0 };
cloudData.factory_cost_adjustment_factor = { standard: 1, asaan: 1 };
cloudData.factory_sale_prices = { standard: 0, asaan: 0 };
cloudData.factory_unit_tracking = {
standard: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
asaan: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] }
};
}
if (expenseCategoriesSnap && expenseCategoriesSnap.exists) {
const categoriesData = expenseCategoriesSnap.data();
cloudData.expense_categories = categoriesData.categories || [];
} else {
cloudData.expense_categories = [];
}
cloudData.deleted_records = deletionsSnap.docs.filter(doc => doc.id !== '_placeholder_' && !doc.data()._placeholder).map(doc => {
const data = doc.data();
return data.recordId || doc.id;
});
if (settingsSnap && settingsSnap.exists) {
const settings = settingsSnap.data();
cloudData.naswar_default_settings = settings.naswar_default_settings || {};
cloudData.appMode = settings.appMode || 'admin';
cloudData.repProfile = settings.repProfile || {};
} else {
cloudData.naswar_default_settings = {};
cloudData.appMode = 'admin';
cloudData.repProfile = {};
}

function mergeArrays(cloudArr, fileArr) {
if (!Array.isArray(cloudArr)) cloudArr = [];
if (!Array.isArray(fileArr)) fileArr = [];
const _getMs = (rec) => {
  if (!rec) return 0;
  const ts = rec.updatedAt || rec.timestamp || rec.createdAt || rec.date || 0;
  if (typeof ts === 'number') return ts;
  if (ts && typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts && typeof ts === 'object') {
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    if (typeof ts._seconds === 'number') return ts._seconds * 1000;
  }
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'string') { try { const t = new Date(ts).getTime(); if (!isNaN(t)) return t; } catch(e){} }
  return 0;
};
const map = new Map();
cloudArr.forEach(item => {
if (item && item.id) map.set(item.id, item);
});
fileArr.forEach(item => {
if (!item || !item.id) return;
if (fileTombstones.has(item.id)) return;
const existing = map.get(item.id);
if (!existing) {
map.set(item.id, item);
} else {
const _cmpMerge = (typeof compareRecordVersions === 'function')
  ? compareRecordVersions(item, existing)
  : _getMs(item) - _getMs(existing);
if (_cmpMerge >= 0) {
map.set(item.id, item);
}
}
});
return Array.from(map.values());
}
const merged = {
mfg_pro_pkr: mergeArrays(cloudData.mfg_pro_pkr, normalized.mfg_pro_pkr),
noman_history: mergeArrays(cloudData.noman_history, normalized.noman_history),
customer_sales: mergeArrays(cloudData.customer_sales, normalized.customer_sales),
rep_sales: mergeArrays(cloudData.rep_sales, normalized.rep_sales),
factory_inventory_data: mergeArrays(cloudData.factory_inventory_data, normalized.factory_inventory_data),
factory_production_history: mergeArrays(cloudData.factory_production_history, normalized.factory_production_history),
payment_entities: mergeArrays(cloudData.payment_entities, normalized.payment_entities),
payment_transactions: mergeArrays(cloudData.payment_transactions, normalized.payment_transactions),
stock_returns: mergeArrays(cloudData.stock_returns, normalized.stock_returns),
factory_default_formulas: (() => {
const cloudFormulas = cloudData.factory_default_formulas;
const fileFormulas = normalized.factory_default_formulas;
const fileHasData = fileFormulas &&
((Array.isArray(fileFormulas.standard) && fileFormulas.standard.length > 0) ||
(Array.isArray(fileFormulas.asaan) && fileFormulas.asaan.length > 0));
const cloudHasData = cloudFormulas &&
((Array.isArray(cloudFormulas.standard) && cloudFormulas.standard.length > 0) ||
(Array.isArray(cloudFormulas.asaan) && cloudFormulas.asaan.length > 0));
if (fileHasData) return fileFormulas;
if (cloudHasData) return cloudFormulas;
return { standard: [], asaan: [] };
})(),
factory_additional_costs: (() => {
const cloud = cloudData.factory_additional_costs;
const file = normalized.factory_additional_costs;
const fileHasData = file && (parseFloat(file.standard) > 0 || parseFloat(file.asaan) > 0);
const cloudHasData = cloud && (parseFloat(cloud.standard) > 0 || parseFloat(cloud.asaan) > 0);
if (fileHasData) return file;
if (cloudHasData) return cloud;
return { standard: 0, asaan: 0 };
})(),
factory_cost_adjustment_factor: (() => {
const cloud = cloudData.factory_cost_adjustment_factor;
const file = normalized.factory_cost_adjustment_factor;
const fileHasData = file && (parseFloat(file.standard) !== 1 || parseFloat(file.asaan) !== 1);
const cloudHasData = cloud && (parseFloat(cloud.standard) !== 1 || parseFloat(cloud.asaan) !== 1);
if (fileHasData) return file;
if (cloudHasData) return cloud;
return { standard: 1, asaan: 1 };
})(),
factory_sale_prices: (() => {
const cloud = cloudData.factory_sale_prices;
const file = normalized.factory_sale_prices;
const fileHasData = file && (parseFloat(file.standard) > 0 || parseFloat(file.asaan) > 0);
const cloudHasData = cloud && (parseFloat(cloud.standard) > 0 || parseFloat(cloud.asaan) > 0);
if (fileHasData) return file;
if (cloudHasData) return cloud;
return { standard: 0, asaan: 0 };
})(),
factory_unit_tracking: (() => {
const cloud = cloudData.factory_unit_tracking;
const file = normalized.factory_unit_tracking;
const hasTrackingData = (data) => {
if (!data || typeof data !== 'object') return false;
const std = data.standard || {};
const asn = data.asaan || {};
return (parseFloat(std.produced) > 0 || parseFloat(std.consumed) > 0 ||
parseFloat(asn.produced) > 0 || parseFloat(asn.consumed) > 0 ||
(Array.isArray(std.unitCostHistory) && std.unitCostHistory.length > 0) ||
(Array.isArray(asn.unitCostHistory) && asn.unitCostHistory.length > 0));
};
if (hasTrackingData(file)) return file;
if (hasTrackingData(cloud)) return cloud;
return {
standard: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
asaan: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] }
};
})(),
naswar_default_settings: cloudData.naswar_default_settings || normalized.naswar_default_settings,
expense_categories: cloudData.expense_categories || normalized.expense_categories,
deleted_records: [...new Set([
...(cloudData.deleted_records || []),
...normalized.deleted_records
])],
appMode: cloudData.appMode || normalized.appMode,
repProfile: cloudData.repProfile || normalized.repProfile
};
const now = new Date().toISOString();
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
const collections = {
'production': merged.mfg_pro_pkr,
'sales': (merged.customer_sales || []),
'rep_sales': merged.rep_sales,
'calculator_history': merged.noman_history,
'inventory': merged.factory_inventory_data,
'factory_history': merged.factory_production_history,
'entities': merged.payment_entities,
'transactions': merged.payment_transactions,
'returns': merged.stock_returns
};
for (const [collectionName, dataArray] of Object.entries(collections)) {
if (Array.isArray(dataArray)) {
for (const item of dataArray) {
if (item && item.id) {
const batch = getCurrentBatch();
const docRef = userRef.collection(collectionName).doc(item.id);
const itemWithTimestamp = { ...item, updatedAt: getTimestamp() };
batch.set(docRef, itemWithTimestamp, { merge: true });
operationCount++;
}
}
}
}
const batch = getCurrentBatch();
const factorySettingsRef = userRef.collection('factorySettings').doc('config');
batch.set(factorySettingsRef, {
default_formulas: merged.factory_default_formulas,
default_formulas_timestamp: Date.now(),
additional_costs: merged.factory_additional_costs,
additional_costs_timestamp: Date.now(),
cost_adjustment_factor: merged.factory_cost_adjustment_factor,
cost_adjustment_factor_timestamp: Date.now(),
sale_prices: merged.factory_sale_prices,
sale_prices_timestamp: Date.now(),
unit_tracking: merged.factory_unit_tracking,
unit_tracking_timestamp: Date.now(),
last_synced: now
}, { merge: true });
operationCount++;
if (merged.expense_categories) {
const expenseCategoriesRef = userRef.collection('expenseCategories').doc('categories');
const currentBatch = getCurrentBatch();
currentBatch.set(expenseCategoriesRef, {
categories: merged.expense_categories,
last_synced: now
}, { merge: true });
operationCount++;
}
if (merged.deleted_records && Array.isArray(merged.deleted_records) && merged.deleted_records.length > 0) {
for (const recordId of merged.deleted_records) {
if (recordId) {
const deletionId = generateUUID('deletion');
const deletionRef = userRef.collection('deletions').doc(deletionId);
const currentBatch = getCurrentBatch();
currentBatch.set(deletionRef, {
id: deletionId,
recordId: String(recordId),
deletedAt: now,
source: 'backup_upload',
recordType: 'unknown'
}, { merge: true });
operationCount++;
}
}
}
const settingsRef = userRef.collection('settings').doc('config');
const settingsBatch = getCurrentBatch();
settingsBatch.set(settingsRef, {
naswar_default_settings: merged.naswar_default_settings || {},
naswar_default_settings_timestamp: Date.now(),
appMode: merged.appMode || 'admin',
appMode_timestamp: Date.now(),
repProfile: merged.repProfile || {},
repProfile_timestamp: Date.now(),
last_synced: now
}, { merge: true });
operationCount++;
if (operationCount > 0) {
batches.push(currentBatch);
}
for (let _bi = 0; _bi < batches.length; _bi++) {
	await batches[_bi].commit();
	if (batches.length > 1) {
		showToast('Uploading... ' + (_bi + 1) + ' / ' + batches.length + ' batches', 'info');
	}
	await new Promise(r => setTimeout(r, 0));
}
const counts = {
production: normalized.mfg_pro_pkr.length,
sales: normalized.noman_history.length,
customerSales: normalized.customer_sales.length,
repSales: normalized.rep_sales.length,
factory: normalized.factory_inventory_data.length + normalized.factory_production_history.length,
payments: normalized.payment_entities.length + normalized.payment_transactions.length,
returns: normalized.stock_returns.length
};
const total = Object.values(counts).reduce((a, b) => a + b, 0);
showToast('Upload Complete! ' + total + ' records merged to cloud.', 'success');
} catch (err) {
showToast('Upload failed: ' + err.message, 'error');
} finally {
isSyncing = false;
}
}
const BiometricAuth = {
isAvailable: async () => {
if (!window.PublicKeyCredential) return false;
const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
return available;
},
_strToBin: (str) => {
return Uint8Array.from(str, c => c.charCodeAt(0));
},
_bufToBase64: (buffer) => {
const bytes = new Uint8Array(buffer);
let binary = '';
for (let i = 0; i < bytes.byteLength; i++) {
binary += String.fromCharCode(bytes[i]);
}
return window.btoa(binary);
},
_base64ToBuf: (base64) => {
const binary_string = window.atob(base64);
const len = binary_string.length;
const bytes = new Uint8Array(len);
for (let i = 0; i < len; i++) {
bytes[i] = binary_string.charCodeAt(i);
}
return bytes.buffer;
},
register: async (username = 'User') => {
try {
if (!await BiometricAuth.isAvailable()) {
throw new Error("Biometrics not available on this device.");
}
const challenge = new Uint8Array(32);
window.crypto.getRandomValues(challenge);
const userId = new Uint8Array(16);
window.crypto.getRandomValues(userId);
const publicKey = {
challenge: challenge,
rp: { name: "Sarim App", id: window.location.hostname },
user: {
id: userId,
name: username,
displayName: username
},
pubKeyCredParams: [
{ alg: -7, type: "public-key" },
{ alg: -257, type: "public-key" }
],
authenticatorSelection: {
authenticatorAttachment: "platform",
userVerification: "required",
residentKey: "preferred"
},
timeout: 60000
};
const credential = await navigator.credentials.create({ publicKey });
const credId = BiometricAuth._bufToBase64(credential.rawId);
await sqliteStore.set('bio_cred_id', credId);
await sqliteStore.set('bio_enabled', 'true');
notifyDataChange('all');
triggerAutoSync();
return true;
} catch (err) {
console.error('[BiometricAuth] registration failed:', _safeErr(err));
showToast('Biometric setup failed. Please try again.', 'error');
throw err;
}
},
authenticate: async () => {
try {
const savedCredId = await sqliteStore.get('bio_cred_id');
if (!savedCredId) throw new Error("No credential found. Please disable and re-enable Fingerprint Lock.");
const challenge = new Uint8Array(32);
window.crypto.getRandomValues(challenge);
const publicKey = {
challenge: challenge,
rpId: window.location.hostname,
allowCredentials: [{
id: BiometricAuth._base64ToBuf(savedCredId),
type: "public-key"
}],
userVerification: "required",
timeout: 60000
};
await navigator.credentials.get({ publicKey });
return true;
} catch (err) {
console.error('[BiometricAuth] authenticate error:', _safeErr(err));
throw err;
}
}
};
async function forceAppModeFromCloud(targetMode, repName = null) {
if (!firebaseDB || !currentUser) {
showToast('Not logged in', 'error', 3000);
return false;
}
if (targetMode !== 'admin' && targetMode !== 'rep') {
showToast('Invalid mode - use "admin" or "rep"', 'error', 3000);
return false;
}
try {
const timestamp = Date.now();
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
const settingsRef = userRef.collection('settings').doc('config');
const updatePayload = {
appMode: targetMode,
appMode_timestamp: timestamp
};
if (repName) {
updatePayload.repProfile = repName;
updatePayload.repProfile_timestamp = timestamp;
}
await settingsRef.set(updatePayload, { merge: true });
showToast(`Remote command sent: ${targetMode} mode`, 'success', 3000);
return true;
} catch (error) {
showToast('Failed to send remote command', 'error', 3000);
return false;
}
}
window.forceAppModeFromCloud = forceAppModeFromCloud;
function updateSystemName() {
const el = document.getElementById('system-name-display');
if (!el) return;
if (appMode === 'admin' || !appMode) {
el.textContent = 'MAHMOOD KHAN';
} else if (appMode === 'rep') {
el.textContent = (currentRepProfile || 'Sales Rep').toUpperCase();
} else if (appMode === 'production') {
el.textContent = (window._assignedManagerName || 'Production Manager').toUpperCase();
} else if (appMode === 'factory') {
el.textContent = (window._assignedManagerName || 'Factory Manager').toUpperCase();
} else if (appMode === 'userrole') {
el.textContent = (window._assignedManagerName || 'User').toUpperCase();
}
}

function lockToRepMode() {
document.querySelectorAll('.sidebar-nav-btn').forEach(btn => {
if (btn.id !== 'snav-rep') btn.style.display = 'none';
});
const cloudMenuBtn = document.getElementById('cloudMenuBtn');
if (cloudMenuBtn) cloudMenuBtn.style.display = 'none';
updateSystemName();
['prod', 'sales', 'calc', 'factory', 'payments'].forEach(t => {
const el = document.getElementById('tab-' + t);
if (el) { el.classList.add('hidden'); el.style.display = 'none'; }
});
const repTab = document.getElementById('tab-rep');
if (repTab) { repTab.classList.remove('hidden'); repTab.style.removeProperty('display'); }
const adminControls = document.getElementById('admin-rep-controls');
if (adminControls) { adminControls.classList.add('hidden'); adminControls.style.display = 'none'; }
const manageRepsBtn = document.getElementById('btn-manage-reps');
if (manageRepsBtn) manageRepsBtn.style.display = 'none';
const adminAnalytics = document.getElementById('admin-rep-analytics');
if (adminAnalytics) { adminAnalytics.classList.add('hidden'); adminAnalytics.style.display = 'none'; }
const newTransCard = document.getElementById('rep-new-transaction-card');
if (newTransCard) newTransCard.style.display = 'block';
if (typeof refreshRepUI === 'function') refreshRepUI();
}

function lockToProductionMode() {
document.querySelectorAll('.sidebar-nav-btn').forEach(btn => {
if (btn.id !== 'snav-prod') btn.style.display = 'none';
});
const cloudMenuBtn = document.getElementById('cloudMenuBtn');
if (cloudMenuBtn) cloudMenuBtn.style.display = 'none';
const manageRepsBtn = document.getElementById('btn-manage-reps');
if (manageRepsBtn) manageRepsBtn.style.display = 'none';
updateSystemName();
['sales', 'calc', 'factory', 'payments', 'rep'].forEach(t => {
const el = document.getElementById('tab-' + t);
if (el) { el.classList.add('hidden'); el.style.display = 'none'; }
});
const prodTab = document.getElementById('tab-prod');
if (prodTab) { prodTab.classList.remove('hidden'); prodTab.style.removeProperty('display'); }
const prodToggle = document.querySelector('.production-toggle-container');
if (prodToggle) prodToggle.style.display = 'none';
['combinedOverview', 'combinedChart', 'prod-analytics-section',
'prod-history-header', 'prodHistoryList'].forEach(id => {
const el = document.getElementById(id);
if (el) el.style.display = 'none';
});
const fBlock = document.getElementById('prod-formula-cost-block');
if (fBlock) fBlock.style.display = 'none';
const pBlock = document.getElementById('prod-profit-block');
if (pBlock) pBlock.style.display = 'none';
const spField = document.getElementById('prod-sale-price-field');
if (spField) spField.style.display = 'none';
const dynCost = document.getElementById('dynamic-cost-display');
if (dynCost) dynCost.style.display = 'none';
}

function lockToFactoryMode() {
document.querySelectorAll('.sidebar-nav-btn').forEach(btn => {
if (btn.id !== 'snav-factory') btn.style.display = 'none';
});
const cloudMenuBtn = document.getElementById('cloudMenuBtn');
if (cloudMenuBtn) cloudMenuBtn.style.display = 'none';
const manageRepsBtn = document.getElementById('btn-manage-reps');
if (manageRepsBtn) manageRepsBtn.style.display = 'none';
updateSystemName();
['prod', 'sales', 'calc', 'payments', 'rep'].forEach(t => {
const el = document.getElementById('tab-' + t);
if (el) { el.classList.add('hidden'); el.style.display = 'none'; }
});
const factoryTab = document.getElementById('tab-factory');
if (factoryTab) { factoryTab.classList.remove('hidden'); factoryTab.style.removeProperty('display'); }
const factorySettingsBtn = document.getElementById('factory-settings-btn');
if (factorySettingsBtn) factorySettingsBtn.style.display = 'none';
document.querySelectorAll('#tab-factory .section.liquid-card').forEach(sec => {
sec.style.display = 'none';
});
const entrySection = document.getElementById('factory-entry-section');
if (entrySection) {
entrySection.style.removeProperty('display');
entrySection.classList.add('liquid-card');
const costDisplay = document.getElementById('factoryTotalProductionCostDisplay');
if (costDisplay) {
const fieldDiv = costDisplay.closest('.field');
if (fieldDiv) fieldDiv.style.display = 'none';
}
const formulaDisplay = document.getElementById('factoryFormulaDisplay');
if (formulaDisplay) formulaDisplay.style.display = 'none';
}
}

function lockToUserRoleMode() {
const assignedTabs = window._assignedUserTabs || [];
const userName = window._assignedManagerName || 'User';
const allTabs = ['prod','sales','calc','factory','payments','rep'];
['cloudMenuBtn','btn-manage-reps'].forEach(id => {
const el = document.getElementById(id); if (el) el.style.display = 'none';
});
updateSystemName();
allTabs.forEach(t => {
const el = document.getElementById('tab-' + t);
if (el) { el.classList.add('hidden'); el.style.removeProperty('display'); }
});
if (assignedTabs.includes('prod')) {
const prodToggle = document.querySelector('.production-toggle-container');
if (prodToggle) prodToggle.style.display = 'none';
['combinedOverview','combinedChart','prod-analytics-section',
'prod-history-header','prodHistoryList'].forEach(id => {
const el = document.getElementById(id); if (el) el.style.display = 'none';
});
['prod-formula-cost-block','prod-profit-block','prod-sale-price-field'].forEach(id => {
const el = document.getElementById(id); if (el) el.style.display = 'none';
});
const dynCostEl = document.getElementById('dynamic-cost-display');
if (dynCostEl) dynCostEl.style.display = 'none';
document.querySelectorAll('#tab-prod .section.liquid-card').forEach(sec => {
if (sec.id !== 'production-entry-section') sec.style.display = 'none';
});
const ui = document.getElementById('unitsAvailableIndicator');
if (ui) ui.style.removeProperty('display');
const iuw = document.getElementById('insufficientUnitsWarning');
if (iuw) iuw.style.removeProperty('display');
}
if (assignedTabs.includes('factory')) {
const fsBtn = document.getElementById('factory-settings-btn');
if (fsBtn) fsBtn.style.display = 'none';
document.querySelectorAll('#tab-factory .section.liquid-card').forEach(sec => sec.style.display = 'none');
const entry = document.getElementById('factory-entry-section');
if (entry) {
entry.style.removeProperty('display');
entry.classList.add('liquid-card');
const cd = document.getElementById('factoryTotalProductionCostDisplay');
if (cd) { const f = cd.closest('.field'); if (f) f.style.display = 'none'; }
const fd = document.getElementById('factoryFormulaDisplay');
if (fd) fd.style.display = 'none';
}
}
if (assignedTabs.includes('sales')) {
const sh = document.querySelector('#tab-sales header');
if (sh) sh.querySelectorAll('button, .btn-theme').forEach(b => b.style.display = 'none');
let si = 0;
document.querySelectorAll('#tab-sales .section.liquid-card').forEach(sec => {
if (si === 0) { si++; return; }
sec.style.display = 'none'; si++;
});
['sale-result-cost','sale-result-value','sale-result-profit'].forEach(id => {
const el = document.getElementById(id); if (el) el.style.display = 'none';
});
const st = document.getElementById('sales-summary-toggle');
if (st) { const sh2 = st.closest('.section-header'); if (sh2) sh2.style.display = 'none'; }
const sc = document.getElementById('sales-summary-card');
if (sc) sc.style.display = 'none';
const cl = document.getElementById('custHistoryList');
if (cl) { const prev = cl.previousElementSibling; if (prev) prev.style.display = 'none'; cl.style.display = 'none'; }
}
if (assignedTabs.includes('payments')) {
const eb = document.querySelector('#tab-payments header .btn-theme');
if (eb) eb.style.display = 'none';
let pi = 0;
document.querySelectorAll('#tab-payments .section.liquid-card').forEach(sec => {
if (pi === 0) { pi++; return; }
sec.style.display = 'none'; pi++;
});
const us = document.getElementById('payments-unified-section');
if (us) us.style.display = 'none';
const ph = document.getElementById('payment-history-section');
if (ph) ph.style.display = 'none';
const pl = document.getElementById('paymentHistoryList');
if (pl) pl.style.display = 'none';
}
if (assignedTabs.length > 0 && typeof showTab === 'function') {
showTab(assignedTabs[0]);
}
}

async function enforceRepModeLock() {
if (window._modeLockEnforced) return;
window._modeLockEnforced = true;
try {
const storedMode = await sqliteStore.get('appMode');
if (storedMode === 'rep') {
appMode = 'rep';
currentRepProfile = await sqliteStore.get('repProfile') || (salesRepsList[0] || 'NORAN SHAH');
lockToRepMode();
} else if (storedMode === 'userrole') {
appMode = 'userrole';
window._assignedManagerName = await sqliteStore.get('assignedManager') || null;
window._assignedUserTabs = await sqliteStore.get('assignedUserTabs') || [];
window._userRoleAllowedTabs = window._assignedUserTabs;
lockToUserRoleMode();
} else if (storedMode === 'production') {
appMode = 'production';
window._assignedManagerName = await sqliteStore.get('assignedManager') || null;
lockToProductionMode();
} else if (storedMode === 'factory') {
appMode = 'factory';
window._assignedManagerName = await sqliteStore.get('assignedManager') || null;
lockToFactoryMode();
}
} catch(e) {
console.warn('enforceRepModeLock: failed to read mode from SQLite, defaulting to admin.', _safeErr(e));
}
}

function preventAdminAccess() {
if (!window._originalShowTab && typeof window.showTab === 'function') {
window._originalShowTab = window.showTab;
}
if (window._originalShowTab) window.showTab = window._originalShowTab;
if (appMode === 'rep') {
const originalShowTab = window._originalShowTab || window.showTab;
window.showTab = function(tab) {
const adminTabs = ['prod', 'sales', 'calc', 'factory', 'payments'];
if (adminTabs.includes(tab)) {
showToast("Access Denied - Device in Rep Mode", "warning", 3000);
return;
}
if (tab === 'rep' || !adminTabs.includes(tab)) {
if (typeof originalShowTab === 'function') originalShowTab(tab);
}
};
document.querySelectorAll('.sidebar-nav-btn').forEach(btn => {
btn.style.display = 'none';
});
} else if (appMode === 'userrole') {
const allowedTabs = window._userRoleAllowedTabs || window._assignedUserTabs || [];
const originalShowTabUR = window._originalShowTab || window.showTab;
window.showTab = function(tab) {
if (!allowedTabs.includes(tab)) {
showToast('Access Denied — not in your assigned sections', 'warning', 3000);
return;
}
if (typeof originalShowTabUR === 'function') originalShowTabUR(tab);
if (tab === 'payments') {
const _ph = document.getElementById('payment-history-section');
if (_ph) { _ph.style.display = 'none'; _ph.style.visibility = 'hidden'; }
const _pl = document.getElementById('paymentHistoryList');
if (_pl) _pl.style.display = 'none';
const _us = document.getElementById('payments-unified-section');
if (_us) _us.style.display = 'none';
}
};
if (allowedTabs.length <= 1) {
document.querySelectorAll('.sidebar-nav-btn').forEach(btn => { btn.style.display = 'none'; });
} else {
document.querySelectorAll('.sidebar-nav-btn').forEach(btn => {
const tid = btn.id.replace('snav-', '');
btn.style.display = (allowedTabs.includes(tid)) ? '' : 'none';
});
}
window._userRoleAllowedTabs = allowedTabs;
} else if (appMode === 'production') {
const originalShowTabProd = window._originalShowTab || window.showTab;
window.showTab = function(tab) {
if (tab !== 'prod') {
showToast("Access Denied - Device in Production Manager Mode", "warning", 3000);
return;
}
if (typeof originalShowTabProd === 'function') originalShowTabProd(tab);
};
document.querySelectorAll('.sidebar-nav-btn').forEach(btn => {
btn.style.display = 'none';
});
} else if (appMode === 'factory') {
const originalShowTabFactory = window._originalShowTab || window.showTab;
window.showTab = function(tab) {
if (tab !== 'factory') {
showToast("Access Denied - Device in Factory Manager Mode", "warning", 3000);
return;
}
if (typeof originalShowTabFactory === 'function') originalShowTabFactory(tab);
};
document.querySelectorAll('.sidebar-nav-btn').forEach(btn => {
btn.style.display = 'none';
});
}
}

async function unlockAdminMode() {
appMode = 'admin';
updateSystemName();
window._assignedManagerName = null;
window._assignedUserTabs = [];
window._userRoleAllowedTabs = [];
currentRepProfile = null;
const timestamp = Date.now();
await sqliteStore.set('appMode', 'admin');
await sqliteStore.set('appMode_timestamp', timestamp);
await sqliteStore.set('assignedManager', null);
await sqliteStore.set('assignedUserTabs', []);
await sqliteStore.set('repProfile', null);

if (typeof firebaseDB !== 'undefined' && firebaseDB && window._firestoreNetworkDisabled) {
try { await firebaseDB.enableNetwork(); window._firestoreNetworkDisabled = false; } catch (_en) {}
}

if (typeof OfflineQueue !== 'undefined' && navigator.onLine) {
try { await OfflineQueue.processQueue(); } catch (_oq) {}
}
notifyDataChange('all');
showToast('Switching to Admin Mode...', 'info', 1500);

setTimeout(() => {
location.reload();
}, 2000);
}

async function deleteRepTransaction(id) {
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
if (!id || !validateUUID(id)) {
showToast('Invalid transaction ID', 'error');
return;
}
const transaction = repSales.find(t => t.id === id);
if (!transaction) {
await refreshRepUI(true);
return;
}
if (transaction.isMerged) {
showToast('Merged opening balance records cannot be deleted', 'warning');
return;
}
const _rtIsOldDebt = transaction.transactionType === 'OLD_DEBT';
const _rtPayType = transaction.paymentType;
const _rtCust = transaction.customerName || 'Unknown';
const _rtRep = transaction.salesRep || 'Unknown';
const _rtDate = transaction.date || 'Unknown';
const _rtQty = transaction.quantity || 0;
const _rtAmt = transaction.totalValue || 0;
const _rtPartialPaid = transaction.partialPaymentReceived || 0;
let confirmMsg, confirmTitle;
if (_rtIsOldDebt) {
confirmTitle = '\u26a0 Delete Old Debt Record';
confirmMsg = `Permanently delete an OLD DEBT record for ${_rtCust} (Rep: ${_rtRep}).`;
confirmMsg += `\nBalance: ${fmtAmt(_rtAmt)}`;
confirmMsg += `\nRecorded: ${_rtDate}`;
if (transaction.notes) confirmMsg += `\nNote: ${transaction.notes}`;
confirmMsg += `\n\n\u26a0 Warning: This will erase the carried-forward balance from this rep customer's history permanently.`;
} else if (_rtPayType === 'COLLECTION') {
confirmTitle = 'Delete Rep Bulk Collection';
confirmMsg = `Delete this bulk collection payment?\n\nRep: ${_rtRep}\nCustomer: ${_rtCust}\nDate: ${_rtDate}\nAmount Collected: ${fmtAmt(_rtAmt)}`;
confirmMsg += `\n\n\u21a9 This will reverse the collection and restore the customer's outstanding balance.`;
} else if (_rtPayType === 'PARTIAL_PAYMENT') {
confirmTitle = 'Delete Rep Partial Payment';
confirmMsg = `Delete this partial payment?\n\nRep: ${_rtRep}\nCustomer: ${_rtCust}\nDate: ${_rtDate}\nPayment: ${fmtAmt(_rtAmt)}`;
confirmMsg += `\n\n\u21a9 This will reverse the partial payment and restore the pending credit balance.`;
} else if (_rtPayType === 'CREDIT') {
confirmTitle = 'Delete Rep Credit Sale';
confirmMsg = `Delete this credit sale permanently?\n\nRep: ${_rtRep}\nCustomer: ${_rtCust}\nDate: ${_rtDate}\nQty: ${_rtQty} kg — ${fmtAmt(_rtAmt)}`;
if (_rtPartialPaid > 0) confirmMsg += `\n\n\u26a0 ${fmtAmt(_rtPartialPaid)} partially collected. Deleting will erase both the sale and partial payment.`;
else if (transaction.creditReceived) confirmMsg += `\n\n\u26a0 This sale is already marked PAID. Deleting will remove the payment record.`;
else confirmMsg += `\n\n\u26a0 This credit sale is UNPAID. Deleting will remove the outstanding balance.`;
} else {
confirmTitle = 'Delete Rep Cash Sale';
confirmMsg = `Delete this cash sale permanently?\n\nRep: ${_rtRep}\nCustomer: ${_rtCust}\nDate: ${_rtDate}\nQty: ${_rtQty} kg — ${fmtAmt(_rtAmt)}`;
confirmMsg += `\n\n\u21a9 ${_rtQty} kg will be restored to inventory.`;
}
confirmMsg += `\n\nThis cannot be undone.`;
if (await showGlassConfirm(confirmMsg, { title: confirmTitle || 'Delete Rep Transaction', confirmText: "Delete", danger: true })) {
try {
const wasCredit = transaction.paymentType === 'CREDIT';
const wasPartialPayment = transaction.paymentType === 'PARTIAL_PAYMENT';
const wasCollection = transaction.paymentType === 'COLLECTION';
const paymentAmount = transaction.totalValue || 0;
const relatedSaleId = transaction.relatedSaleId;
if (wasPartialPayment && relatedSaleId) {
const relatedSale = repSales.find(s => s.id === relatedSaleId);
if (relatedSale) {
relatedSale.partialPaymentReceived = Math.max(0, (relatedSale.partialPaymentReceived || 0) - paymentAmount);
if (relatedSale.partialPaymentReceived === 0) { relatedSale.creditReceived = false; delete relatedSale.creditReceivedDate; }
relatedSale.updatedAt = getTimestamp();
ensureRecordIntegrity(relatedSale, true);
}
}
const repSalesFiltered = repSales.filter(s => s.id !== id);
await unifiedDelete('rep_sales', repSalesFiltered, id, { strict: true }, transaction);
if (wasPartialPayment && relatedSaleId) {
const relatedSale = repSales.find(s => s.id === relatedSaleId);
if (relatedSale) await unifiedSave('rep_sales', repSales, relatedSale);
}
await refreshRepUI(true);
if (currentManagingRepCustomer && typeof renderRepCustomerTransactions === 'function') {
await renderRepCustomerTransactions(currentManagingRepCustomer);
}
notifyDataChange('rep');
triggerAutoSync();
let message = ` ${wasPartialPayment ? 'Payment' : wasCollection ? 'Collection' : 'Transaction'} deleted!`;
if ((wasPartialPayment || wasCollection || (wasCredit && transaction.partialPaymentReceived > 0)) && (paymentAmount > 0 || transaction.partialPaymentReceived > 0)) {
const refundAmount = wasCredit ? transaction.partialPaymentReceived : paymentAmount;
message += ` Payment of ${fmtAmt(refundAmount)} reversed.`;
}
showToast(message, "success");
} catch (error) {
showToast('Failed to delete transaction. Please try again.', 'error');
}
}
}

async function handleCustomerInput(query, mode) {
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
if (!query) query = '';
if (typeof query !== 'string') query = String(query);
const isRep = mode === 'rep';
const phoneContainerId = isRep ? 'rep-new-customer-phone-container' : 'new-customer-phone-container';
const phoneContainer = document.getElementById(phoneContainerId);
if (!phoneContainer) return;
const allSales = isRep ?
(Array.isArray(repSales) ? repSales : []).filter(s => s.salesRep === currentRepProfile) :
(Array.isArray(customerSales) ? customerSales : []).filter(s => s && s.currentRepProfile === 'admin');
const allRegistryNames = !isRep && Array.isArray(salesCustomers)
? salesCustomers.filter(c => c && c.name).map(c => String(c.name).trim().toLowerCase())
: Array.isArray(repCustomers)
? repCustomers.filter(c => c && c.name).map(c => String(c.name).trim().toLowerCase())
: [];
const existingNames = [...new Set([
...allSales
.map(s => s && s.customerName ? s.customerName : null)
.filter(n => n !== null && n !== undefined && n !== '' && typeof n === 'string')
.map(n => { try { return String(n).trim().toLowerCase(); } catch (e) { return null; } })
.filter(n => n !== null && n !== ''),
...allRegistryNames
])];
let safeQuery = '';
try {
safeQuery = query ? String(query).trim().toLowerCase() : '';
} catch (e) {
safeQuery = '';
}
const isNewCustomer = safeQuery.length > 2 && !existingNames.includes(safeQuery);
if (isNewCustomer) {
phoneContainer.classList.remove('hidden');
} else {
phoneContainer.classList.add('hidden');
}
}

async function handleUniversalSearch(inputId, resultsId, dataSource) {
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
const input = document.getElementById(inputId);
const resultsDiv = document.getElementById(resultsId);
if (!input || !resultsDiv) return;
const query = input.value || '';
if (!query || query.length < 1) {
resultsDiv.classList.add('hidden');
return;
}
let matches = [];
let html = '';
switch(dataSource) {
case 'customers': {
let _freshSalesReg = [];
try { _freshSalesReg = await sqliteStore.get('sales_customers', []) || []; } catch(e) {}
const _salesRegMap = new Map((_freshSalesReg).filter(c => c && c.id).map(c => [c.id, c]));
if (Array.isArray(salesCustomers)) salesCustomers.forEach(c => { if (c && c.id && !_salesRegMap.has(c.id)) _salesRegMap.set(c.id, c); });
const _mergedSalesReg = Array.from(_salesRegMap.values());
const _custNamesFromSales = customerSales
.filter(s => s && s.currentRepProfile === 'admin')
.map(s => s.customerName)
.filter(n => n && typeof n === 'string');
const _custNamesFromRegistry = _mergedSalesReg
.filter(c => c && c.name && typeof c.name === 'string').map(c => c.name);
const uniqueCustomers = [...new Set([..._custNamesFromSales, ..._custNamesFromRegistry])];
matches = uniqueCustomers.filter(name =>
name && typeof name === 'string' && name.toLowerCase().includes(query.toLowerCase())
);
if (matches.length > 0) {
matches.forEach(name => {
const safeName = String(name).replace(/'/g, "\\'").replace(/"/g, '&quot;');
html += `
<div style="padding: 10px; cursor: pointer; border-bottom: 1px solid var(--glass-border); font-size: 0.85rem; color: var(--text-main); background: var(--input-bg);"
onmousedown="selectFromUniversalSearch('${inputId}', '${resultsId}', '${safeName}', 'name')"
onmouseover="this.style.background='var(--highlight-bg)'"
onmouseout="this.style.background='var(--input-bg)'">
<strong>${esc(name)}</strong>
</div>`;
});
} else {
html = `<div class="u-search-empty" >
No match found. "${query}" will be created as new customer.
</div>`;
}
break;
}
case 'entities':
if (Array.isArray(paymentEntities)) {
matches = paymentEntities.filter(entity =>
entity && entity.name && typeof entity.name === 'string' &&
entity.name.toLowerCase().includes(query.toLowerCase())
);
}
if (matches.length > 0) {
matches.forEach(entity => {
const safeName = String(entity.name).replace(/'/g, "\\'").replace(/"/g, '&quot;');
const safeId = String(entity.id).replace(/'/g, "\\'");
const entityBal = calculateEntityBalances()[entity.id] || 0;
const typeColor = entityBal >= 0 ? 'var(--danger)' : 'var(--accent-emerald)';
html += `
<div style="padding: 10px; cursor: pointer; border-bottom: 1px solid var(--glass-border); font-size: 0.85rem; color: var(--text-main); background: var(--input-bg);"
onmousedown="selectFromUniversalSearch('${inputId}', '${resultsId}', '${safeName}', 'entity', '${safeId}')"
onmouseover="this.style.background='var(--highlight-bg)'"
onmouseout="this.style.background='var(--input-bg)'">
<strong>${esc(entity.name)}</strong>
</div>`;
});
} else {
html = `<div class="u-search-empty" >
No matching entities found
</div>`;
}
break;
case 'suppliers':
if (Array.isArray(paymentEntities)) {
matches = paymentEntities.filter(entity =>
entity && entity.name && typeof entity.name === 'string' &&
entity.type === 'payee' &&
entity.name.toLowerCase().includes(query.toLowerCase())
);
}
if (matches.length > 0) {
matches.forEach(supplier => {
const safeName = String(supplier.name).replace(/'/g, "\\'").replace(/"/g, '&quot;');
const safeId = String(supplier.id).replace(/'/g, "\\'");
html += `
<div style="padding: 10px; cursor: pointer; border-bottom: 1px solid var(--glass-border); font-size: 0.85rem; color: var(--text-main); background: var(--input-bg);"
onmousedown="selectFromUniversalSearch('${inputId}', '${resultsId}', '${safeName}', 'supplier', '${safeId}')"
onmouseover="this.style.background='var(--highlight-bg)'"
onmouseout="this.style.background='var(--input-bg)'">
<strong>${esc(supplier.name)}</strong>
${supplier.phone ? `<span style="font-size: 0.7rem; color: var(--text-muted); margin-left: 8px;">${phoneActionHTML(supplier.phone)}</span>` : ''}
</div>`;
});
} else {
html = `<div class="u-search-empty" >
No matching suppliers found
</div>`;
}
break;
case 'repCustomers': {
let _freshRepReg = [];
try { _freshRepReg = await sqliteStore.get('rep_customers', []) || []; } catch(e) {}
const _repRegMap = new Map((_freshRepReg).filter(c => c && c.id).map(c => [c.id, c]));
if (Array.isArray(repCustomers)) repCustomers.forEach(c => { if (c && c.id && !_repRegMap.has(c.id)) _repRegMap.set(c.id, c); });
const _mergedRepReg = Array.from(_repRegMap.values());
const _repNamesFromSales = repSales
.filter(s => s.salesRep === currentRepProfile)
.map(s => s.customerName)
.filter(n => n && typeof n === 'string');
const _repNamesFromRegistry = _mergedRepReg
.filter(c => c && c.name && typeof c.name === 'string' && c.salesRep === currentRepProfile).map(c => c.name);
const repUniqueCustomers = [...new Set([..._repNamesFromSales, ..._repNamesFromRegistry])];
matches = repUniqueCustomers.filter(name =>
name && typeof name === 'string' && name.toLowerCase().includes(query.toLowerCase())
);
if (matches.length > 0) {
matches.forEach(name => {
const safeName = String(name).replace(/'/g, "\\'").replace(/"/g, '&quot;');
html += `
<div style="padding: 10px; cursor: pointer; border-bottom: 1px solid var(--glass-border); font-size: 0.85rem; color: var(--text-main); background: var(--input-bg);"
onmousedown="selectFromUniversalSearch('${inputId}', '${resultsId}', '${safeName}', 'repName')"
onmouseover="this.style.background='var(--highlight-bg)'"
onmouseout="this.style.background='var(--input-bg)'">
<strong>${esc(name)}</strong>
</div>`;
});
} else {
html = `<div class="u-search-empty" >
No match found. "${query}" will be created.
</div>`;
}
break;
}
}
resultsDiv.innerHTML = html;
resultsDiv.classList.remove('hidden');
}

function selectFromUniversalSearch(inputId, resultsId, value, type, id) {
const input = document.getElementById(inputId);
const resultsDiv = document.getElementById(resultsId);
if (input) {
input.value = value;
if (id) {
input.setAttribute('data-entity-id', id);
input.setAttribute('data-supplier-id', id);
}
}
if (resultsDiv) {
resultsDiv.classList.add('hidden');
}
if (type === 'name' && inputId === 'cust-name') {
if (typeof calculateCustomerStatsForDisplay === 'function') {
calculateCustomerStatsForDisplay(value);
}
const _phoneContainer = document.getElementById('new-customer-phone-container');
if (_phoneContainer) _phoneContainer.classList.add('hidden');
} else if (type === 'repName' && inputId === 'rep-cust-name') {
if (typeof calculateRepCustomerStatsForDisplay === 'function') {
calculateRepCustomerStatsForDisplay(value);
}
} else if (type === 'name' && inputId === 'cust-add-search') {
if (typeof openCustomerEditModal === 'function') openCustomerEditModal(value);
} else if (type === 'repName' && inputId === 'rep-cust-add-search') {
if (typeof openRepCustomerEditModal === 'function') openRepCustomerEditModal(value);
} else if (type === 'name' && inputId === 'edit-cust-name') {
if (typeof openCustomerEditModal === 'function') openCustomerEditModal(value);
} else if (type === 'repName' && inputId === 'rep-edit-cust-name') {
if (typeof openRepCustomerEditModal === 'function') openRepCustomerEditModal(value);
}
}
document.addEventListener('click', function(e) {

if (!e.target.closest('[id^="fh-breakdown-"], [id^="sold-breakdown-"], #perf-sum-raw-breakdown') &&
    !e.target.closest('button[onclick*="fh-breakdown-"], button[onclick*="sold-breakdown-"], button[onclick*="perf-sum-raw-breakdown"]')) {
  document.querySelectorAll('[id^="fh-breakdown-"], [id^="sold-breakdown-"], #perf-sum-raw-breakdown').forEach(panel => {
    if (panel.style.display !== 'none') {
      panel.style.display = 'none';

      const btn = panel.previousElementSibling;
      if (btn && btn.tagName === 'BUTTON') {
        const arrow = btn.querySelector('span:first-child');
        if (arrow) {
          if (arrow.textContent === '▼') arrow.textContent = '▶';

        }
      }
    }
  });
}
const searchables = [
{ input: 'cust-name', results: 'customer-search-results' },
{ input: 'rep-cust-name', results: 'rep-customer-search-results' },
{ input: 'paymentEntity', results: 'payment-entity-search-results' },
{ input: 'factoryExistingSupplier', results: 'factory-supplier-search-results' }
];
searchables.forEach(item => {
const input = document.getElementById(item.input);
const resultsDiv = document.getElementById(item.results);
if (input && resultsDiv) {
const container = input.parentElement;
if (container && !container.contains(e.target)) {
resultsDiv.classList.add('hidden');
}
}
});
});
window.selectCustomer = function(name) {
  const base = window._selectCustomerBase;
  if (typeof base === 'function') base(name);
  document.getElementById('new-customer-phone-container').classList.add('hidden');
  document.getElementById('new-cust-phone').value = '';
};
window.selectRepCustomer = function(name) {
  const base = window._selectRepCustomerBase;
  if (typeof base === 'function') base(name);
  document.getElementById('rep-new-customer-phone-container').classList.add('hidden');
  document.getElementById('rep-new-cust-phone').value = '';
};
async function initTheme() {
const savedTheme = await sqliteStore.get('theme') || 'dark';
const html = document.documentElement;
html.setAttribute('data-theme', savedTheme);
const themeToggle = document.getElementById('themeToggle');
if (themeToggle) {
themeToggle.innerHTML = savedTheme === 'dark' ? '' : '';
themeToggle.title = savedTheme === 'dark' ? "Switch to Light Mode" : "Switch to Dark Mode";
}
const metaThemeColor = document.querySelector('meta[name="theme-color"]');
if (metaThemeColor) {
metaThemeColor.setAttribute('content', savedTheme === 'light' ? '#ffffff' : '#000000');
}
}
const FIRESTORE_ENHANCED_SCHEMA = {
production: {
localKey: 'mfg_pro_pkr',
firestoreCollection: 'production',
localVariable: 'db',
type: 'array',
description: 'Manufacturing / production records',
fields: ['date', 'netWeight', 'costPrice', 'salePrice', 'profit', 'id', 'timestamp']
},
calculator_history: {
localKey: 'noman_history',
firestoreCollection: 'calculator_history',
localVariable: 'salesHistory',
type: 'array',
description: 'Calculator history – totals, revenue, returns, cash/credit splits',
fields: ['totalSold', 'revenue', 'returns', 'cash', 'credit', 'seller', 'date', 'id', 'timestamp']
},
sales: {
localKey: 'customer_sales',
firestoreCollection: 'sales',
localVariable: 'customerSales',
type: 'array',
description: 'Individual customer sales transactions',
fields: ['customerName', 'quantity', 'paymentType', 'supplyStore', 'date', 'phone', 'id', 'timestamp']
},
rep_sales: {
localKey: 'rep_sales',
firestoreCollection: 'rep_sales',
localVariable: 'repSales',
type: 'array',
description: 'Rep-mode sales with GPS coordinates',
fields: ['customerName', 'quantity', 'paymentType', 'salesRep', 'latitude', 'longitude', 'date', 'phone', 'id', 'timestamp']
},
inventory: {
localKey: 'factory_inventory_data',
firestoreCollection: 'inventory',
localVariable: 'factoryInventoryData',
type: 'array',
description: 'Raw-material inventory (name, qty, cost, value)',
fields: ['materialName', 'quantityOnHand', 'unitCost', 'totalValue', 'id', 'timestamp']
},
factory_history: {
localKey: 'factory_production_history',
firestoreCollection: 'factory_history',
localVariable: 'factoryProductionHistory',
type: 'array',
description: 'Factory formula production-batch history',
fields: ['unitsProduced', 'materialCosts', 'productType', 'date', 'id', 'timestamp']
},
returns: {
localKey: 'stock_returns',
firestoreCollection: 'returns',
localVariable: 'stockReturns',
type: 'array',
description: 'Stock-return logs from sellers',
fields: ['seller', 'quantity', 'reason', 'date', 'id', 'timestamp']
},
entities: {
localKey: 'payment_entities',
firestoreCollection: 'entities',
localVariable: 'paymentEntities',
type: 'array',
description: 'Registry of payment entities',
fields: ['name', 'phone', 'entityType', 'id', 'timestamp']
},
transactions: {
localKey: 'payment_transactions',
firestoreCollection: 'transactions',
localVariable: 'paymentTransactions',
type: 'array',
description: 'Cash-in / cash-out ledger linked to entities',
fields: ['entityId', 'amount', 'type', 'description', 'date', 'id', 'timestamp']
},
expenses: {
localKey: 'expenses',
firestoreCollection: 'expenses',
localVariable: 'expenseRecords',
type: 'array',
description: 'Unified expense manager records (operating expenses, payments IN/OUT)',
fields: ['name', 'amount', 'category', 'description', 'date', 'time', 'id', 'timestamp', 'syncedAt']
}
};
const FIRESTORE_SETTINGS_SCHEMA = {
factory_default_formulas: {
localKey: 'factory_default_formulas',
localVariable: 'factoryDefaultFormulas',
type: 'object',
defaultValue: { standard: [], asaan: [] },
description: 'Recipe / formula definitions (Standard vs Asaan)'
},
factory_additional_costs: {
localKey: 'factory_additional_costs',
localVariable: 'factoryAdditionalCosts',
type: 'object',
defaultValue: { standard: 0, asaan: 0 },
description: 'Overhead / extra costs per unit'
},
factory_sale_prices: {
localKey: 'factory_sale_prices',
localVariable: 'factorySalePrices',
type: 'object',
defaultValue: { standard: 0, asaan: 0 },
description: 'Standard selling price per kg/unit per store type'
},
factory_cost_adjustment_factor: {
localKey: 'factory_cost_adjustment_factor',
localVariable: 'factoryCostAdjustmentFactor',
type: 'object',
defaultValue: { standard: 1, asaan: 1 },
description: 'Cost-price multiplier for reporting'
},
factory_unit_tracking: {
localKey: 'factory_unit_tracking',
localVariable: 'factoryUnitTracking',
type: 'object',
defaultValue: {
standard: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] },
asaan: { produced: 0, consumed: 0, available: 0, unitCostHistory: [] }
},
description: 'Unit lifecycle: produced → consumed → available'
},
naswar_default_settings: {
localKey: 'naswar_default_settings',
localVariable: 'defaultSettings',
type: 'object',
defaultValue: {},
description: 'General app default-settings object'
},
appMode: {
localKey: 'appMode',
localVariable: 'appMode',
type: 'string',
defaultValue: 'admin',
description: 'Current operating mode: admin | rep'
},
repProfile: {
localKey: 'repProfile',
localVariable: 'currentRepProfile',
type: 'string',
defaultValue: salesRepsList[0] || 'NORAN SHAH',
description: 'Active sales-representative profile name'
},
deleted_records: {
localKey: 'deleted_records',
localVariable: 'deletedRecordIds',
type: 'set_as_array',
defaultValue: [],
description: 'Tombstone IDs – prevents deleted records from re-appearing on sync'
},
last_synced: {
localKey: 'last_synced',
localVariable: null,
type: 'string_iso_date',
defaultValue: null,
description: 'ISO timestamp of the last successful cloud sync'
}
};
const FIRESTORE_LOCAL_ONLY_KEYS = {
theme: {
localKey: 'theme',
localVariable: null,
type: 'string',
defaultValue: 'dark',
description: 'UI theme preference: light | dark'
},
bio_enabled: {
localKey: 'bio_enabled',
localVariable: null,
type: 'boolean_string',
defaultValue: 'false',
description: 'Biometric security-lock flag'
},
bio_cred_id: {
localKey: 'bio_cred_id',
localVariable: null,
type: 'string',
defaultValue: '',
description: 'WebAuthn biometric credential ID'
}
};
function updateConnectionStatus() {
const dot = document.getElementById('connection-indicator');
if (!dot) return;
if (!navigator.onLine) {
dot.className = 'signal-offline';
dot.title = "Offline - Changes saved locally";
} else if (isSyncing) {
dot.className = 'signal-connecting';
dot.title = "Syncing with Cloud...";
} else if (firebase.apps.length && currentUser) {
dot.className = 'signal-online';
dot.title = "Online - Connected to Firestore";
} else {
dot.className = 'signal-offline';
dot.title = "Disconnected - Please Sign In";
}
}
window.addEventListener('online', () => { updateConnectionStatus(); if(typeof updateOfflineBanner==='function') updateOfflineBanner(); });
window.addEventListener('offline', () => { updateConnectionStatus(); if(typeof updateOfflineBanner==='function') updateOfflineBanner(); });
const originalSync = window.performOneClickSync;
window.performOneClickSync = async function(silent) {
updateConnectionStatus();
try {
await originalSync(silent);
} finally {
isSyncing = false;
updateConnectionStatus();
}
};

(function registerRenderFunctions() {
if (typeof renderUnifiedTable === 'function') {
}
if (typeof renderCustomersTable === 'function') {
}
if (typeof renderEntityTable === 'function') {
}
if (typeof renderExpenseTable === 'function') {
}
if (typeof renderRepCustomerTable === 'function') {
}
})();
var ThemeManager = {
currentTheme: 'dark',
observers: new Set(),
async init() {
const saved = await sqliteStore.get('app_theme', null);
const systemPrefers = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
this.currentTheme = saved || systemPrefers;
this.apply();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async (e) => {
if (!(await sqliteStore.get('app_theme', null))) {
this.setTheme(e.matches ? 'dark' : 'light');
}
});
},
apply() {
document.documentElement.setAttribute('data-theme', this.currentTheme);
this.notifyObservers();
},
setTheme(theme) {
this.currentTheme = theme;
sqliteStore.set('app_theme', theme).catch(() => {});
this.apply();
},
toggle() {
this.setTheme(this.currentTheme === 'dark' ? 'light' : 'dark');
},
observe(callback) {
this.observers.add(callback);
return () => this.observers.delete(callback);
},
notifyObservers() {
this.observers.forEach(cb => cb(this.currentTheme));
},
getVar(varName) {
return getComputedStyle(document.documentElement)
.getPropertyValue(`--${varName}`).trim();
}
};
const IncrementalRenderer = {
queue: [],
isRendering: false,
batchSize: 20,
enqueue(items, renderFunc, container) {
this.queue.push({ items, renderFunc, container });
if (!this.isRendering) {
this.processQueue();
}
},
async processQueue() {
this.isRendering = true;
while (this.queue.length > 0) {
const { items, renderFunc, container } = this.queue.shift();
container.innerHTML = '';
for (let i = 0; i < items.length; i += this.batchSize) {
const batch = items.slice(i, i + this.batchSize);
const fragment = document.createDocumentFragment();
batch.forEach(item => {
const element = renderFunc(item);
if (element) {
fragment.appendChild(element);
}
});
container.appendChild(fragment);
}
}
this.isRendering = false;
}
};

class ReactiveComponent {
constructor(element, config = {}) {
this.element = element;
this.state = config.initialState || {};
this.styleMap = config.styleMap || {};
this.listeners = new Map();
}
setState(newState) {
const oldState = { ...this.state };
this.state = { ...this.state, ...newState };
this.syncStyles();
this.notifyListeners(oldState, this.state);
}
syncStyles() {
Object.entries(this.styleMap).forEach(([stateKey, styles]) => {
if (this.state[stateKey]) {
Object.assign(this.element.style, styles);
}
});
}
on(event, callback) {
if (!this.listeners.has(event)) {
this.listeners.set(event, new Set());
}
this.listeners.get(event).add(callback);
}
notifyListeners(oldState, newState) {
const listeners = this.listeners.get('change');
if (listeners) {
listeners.forEach(cb => cb(newState, oldState));
}
}
}
var PerformanceMonitor = {
metrics: {
renderTime: [],
queryTime: [],
syncTime: []
},
startTimer(operation) {
return performance.now();
},
endTimer(operation, startTime) {
const duration = performance.now() - startTime;
if (this.metrics[operation]) {
this.metrics[operation].push(duration);
if (this.metrics[operation].length > 100) {
this.metrics[operation].shift();
}
}
return duration;
},
getAverages() {
const averages = {};
for (const [key, values] of Object.entries(this.metrics)) {
if (values.length > 0) {
averages[key] = values.reduce((a, b) => a + b, 0) / values.length;
}
}
return averages;
},
report() {
const averages = this.getAverages();
}
};
window.addEventListener('beforeunload', function() {
if (listenerReconnectTimer) {
clearTimeout(listenerReconnectTimer);
}

if (typeof scrollRafId !== 'undefined' && scrollRafId !== null) {
cancelAnimationFrame(scrollRafId);
scrollRafId = null;
}
if (window._rafScrollHandler) {
window.removeEventListener('scroll', window._rafScrollHandler);
window._rafScrollHandler = null;
}
if (window._fbOfflineHandler) { window.removeEventListener('offline', window._fbOfflineHandler); window._fbOfflineHandler = null; }
if (window._tombstoneCleanupInterval) { clearInterval(window._tombstoneCleanupInterval); window._tombstoneCleanupInterval = null; }
if (window._syncUpdatesCleanupInterval) { clearInterval(window._syncUpdatesCleanupInterval); window._syncUpdatesCleanupInterval = null; }
if (window._connectionCheckInterval) { clearInterval(window._connectionCheckInterval); window._connectionCheckInterval = null; }
if (window._perfMonitorInterval) { clearInterval(window._perfMonitorInterval); window._perfMonitorInterval = null; }
});
async function loadSalesRepsList() {
const salesHistory = ensureArray(await sqliteStore.get('noman_history'));
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const stored = await sqliteStore.get('sales_reps_list', null);
if (Array.isArray(stored) && stored.length > 0) {
salesRepsList = stored;
} else {
salesRepsList = ['NORAN SHAH', 'NOMAN SHAH'];
await sqliteStore.set('sales_reps_list', salesRepsList);
}
const storedUserRoles = await sqliteStore.get('user_roles_list', null);
if (Array.isArray(storedUserRoles)) userRolesList = storedUserRoles;
if (firebaseDB && currentUser) {
try {
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
const teamDoc = await userRef.collection('settings').doc('team').get();
if (teamDoc.exists) {
const teamData = teamDoc.data();
const cloudTs = teamData.updated_at || 0;
const localTs = (await sqliteStore.get('team_list_timestamp')) || 0;
if (cloudTs >= localTs) {
if (Array.isArray(teamData.sales_reps) && teamData.sales_reps.length > 0) {
salesRepsList = teamData.sales_reps;
await sqliteStore.set('sales_reps_list', salesRepsList);
}
if (Array.isArray(teamData.user_roles)) {
userRolesList = teamData.user_roles;
await sqliteStore.set('user_roles_list', userRolesList);
}
if (cloudTs > localTs) await sqliteStore.set('team_list_timestamp', cloudTs);
}
}
} catch(e) { console.warn('Could not fetch team list from Firestore on startup:', _safeErr(e)); }
}
renderAllRepUI();
}

async function saveSalesRepsList() {
try {
await sqliteStore.set('sales_reps_list', salesRepsList);
if (firebaseDB && currentUser) {
try {
const nowMs = Date.now();
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
await userRef.collection('settings').doc('team').set({
sales_reps: salesRepsList,
user_roles: userRolesList,
updated_at: nowMs
}, { merge: true });
await sqliteStore.set('team_list_timestamp', nowMs);
} catch(e) {
console.warn('Could not sync sales reps to Firestore', _safeErr(e));
showToast('Saved locally — cloud sync will retry when online.', 'warning', 3500);
}
}
renderAllRepUI();
} catch(e) {
console.error('saveSalesRepsList error:', _safeErr(e));
showToast('Failed to save team list. Please try again.', 'error');
}
}

async function saveUserRolesList() {
try {
await sqliteStore.set('user_roles_list', userRolesList);
if (firebaseDB && currentUser) {
try {
const nowMs = Date.now();
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
await userRef.collection('settings').doc('team').set({
sales_reps: salesRepsList,
user_roles: userRolesList,
updated_at: nowMs
}, { merge: true });
await sqliteStore.set('team_list_timestamp', nowMs);
} catch(e) {
console.warn('Could not sync user roles to Firestore', _safeErr(e));
showToast('Saved locally — cloud sync will retry when online.', 'warning', 3500);
}
}
} catch(e) {
console.error('saveUserRolesList error:', _safeErr(e));
showToast('Failed to save user roles. Please try again.', 'error');
}
}

function renderAllRepUI() {
const adminSel = document.getElementById('admin-rep-selector');
if (adminSel) {
const prev = adminSel.value;
adminSel.innerHTML = salesRepsList.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
if (salesRepsList.includes(prev)) adminSel.value = prev;
else if (salesRepsList.includes(currentRepProfile)) adminSel.value = currentRepProfile;
else if (salesRepsList.length > 0) { adminSel.value = salesRepsList[0]; currentRepProfile = salesRepsList[0]; }
}
const sellerSel = document.getElementById('sellerSelect');
if (sellerSel) {
const prev2 = sellerSel.value;
sellerSel.innerHTML = salesRepsList.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('') +
'<option value="COMBINED">COMPARISON</option>';
if (salesRepsList.includes(prev2) || prev2 === 'COMBINED') sellerSel.value = prev2;
}
const toggleGroup = document.getElementById('sales-rep-toggle-group');
if (toggleGroup) {
const currentVal = document.getElementById('sales-rep-value')?.value || 'NONE';
toggleGroup.innerHTML = `<button id="btn-rep-none" class="toggle-opt${currentVal === 'NONE' ? ' active' : ''}" onclick="selectSalesRep(this,'NONE')">Direct</button>` +
salesRepsList.map((r, i) => {
const firstName = r.split(' ')[0];
const shortName = firstName.charAt(0) + firstName.slice(1).toLowerCase();
return `<button id="btn-rep-dyn-${i}" class="toggle-opt${currentVal === r ? ' active' : ''}" onclick="selectSalesRep(this,'${esc(r)}')">${esc(shortName)}</button>`;
}).join('');
}
renderManageRepsList();
}

function renderManageRepsList() {
const list = document.getElementById('manage-reps-list');
if (!list) return;
if (salesRepsList.length === 0) {
list.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:12px;">No representatives added yet.</div>';
return;
}
list.innerHTML = salesRepsList.map((rep, i) => `
<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 18px; background:var(--glass-raised); border:1px solid var(--glass-border); border-radius:9999px; ${i === 0 ? 'border-left:3px solid var(--accent);' : ''}">
<div style="display:flex; align-items:center; gap:8px; flex:1; min-width:0;">
<span style="font-size:0.85rem; font-weight:800; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(rep)}</span>
<span style="font-size:0.62rem; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:${i === 0 ? 'var(--accent)' : 'var(--text-muted)'}; flex-shrink:0;">${i === 0 ? ' Default' : `#${i + 1}`}</span>
</div>
<button class="btn-theme" onclick="removeSalesRep(${i})" title="Remove ${esc(rep)}" style="flex-shrink:0; color:var(--danger); border-color:rgba(239,68,68,0.4); font-size:0.8rem;"></button>
</div>
`).join('');
}
let _newUserRoleSelectedTabs = new Set();
function toggleUserRoleTabAccess(tabKey) {
if (_newUserRoleSelectedTabs.has(tabKey)) {
_newUserRoleSelectedTabs.delete(tabKey);
} else {
_newUserRoleSelectedTabs.add(tabKey);
}
['factory','prod','payments','sales'].forEach(t => {
const btn = document.getElementById('userrole-tab-' + t);
if (btn) btn.classList.toggle('active', _newUserRoleSelectedTabs.has(t));
});
const hint = document.getElementById('userrole-access-hint');
if (hint) {
hint.textContent = _newUserRoleSelectedTabs.size === 0
? 'Select one or more tabs to assign'
: 'Access: ' + [..._newUserRoleSelectedTabs].map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(', ');
}
}

function renderUserRoleList() {
const list = document.getElementById('manage-userrole-list');
if (!list) return;
if (userRolesList.length === 0) {
list.innerHTML = '<div style="color:var(--text-muted);font-size:0.8rem;text-align:center;padding:12px;">No users added yet.</div>';
return;
}
const TAB_COLORS = { factory: 'var(--accent-purple)', prod: 'var(--accent-emerald)', payments: 'var(--accent-cyan)', sales: 'var(--accent-gold)' };
list.innerHTML = userRolesList.map((user, i) => {
const tabs = Array.isArray(user.tabs) ? user.tabs : [];
const tabBadges = tabs.map(t => `<span style="font-size:0.58rem;padding:2px 7px;border-radius:9999px;color:${TAB_COLORS[t]||'var(--accent)'};border:1px solid ${TAB_COLORS[t]||'var(--accent)'}55;font-weight:700;text-transform:uppercase;">${t}</span>`).join('');
return `
<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 14px; background:var(--glass-raised); border:1px solid var(--glass-border); border-radius:var(--radius-lg); margin-bottom:8px;">
<div style="flex:1; min-width:0;">
<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
<span style="font-size:0.85rem; font-weight:800; color:var(--text-main);">${esc(user.name)}</span>
</div>
<div style="display:flex;gap:4px;flex-wrap:wrap;">${tabBadges || '<span style="font-size:0.65rem;color:var(--text-secondary);">No tabs assigned</span>'}</div>
</div>
<button class="btn-theme" onclick="removeUserRole(${i})" title="Remove ${esc(user.name)}" style="flex-shrink:0; color:var(--danger); border-color:rgba(239,68,68,0.4); font-size:0.8rem;"></button>
</div>`;
}).join('');
}

function switchManageTeamTab(tab) {
['rep', 'userrole', 'accounts'].forEach(t => {
const btn = document.getElementById('team-tab-' + t);
const panel = document.getElementById('team-panel-' + t);
if (btn) btn.classList.toggle('active', t === tab);
if (panel) panel.style.display = t === tab ? '' : 'none';
});
if (tab === 'userrole') renderUserRoleList();
if (tab === 'rep') renderManageRepsList();
if (tab === 'accounts' && typeof loadAccountsList === 'function') loadAccountsList();
}

async function addNewUserRole() {
const input = document.getElementById('new-userrole-name-input');
if (!input) return;
const name = input.value.trim().toUpperCase();
if (!name) { showToast('Please enter a name', 'warning'); return; }
if (_newUserRoleSelectedTabs.size === 0) { showToast('Please select at least one tab', 'warning'); return; }
if (userRolesList.some(u => u.name === name)) { showToast('User already exists', 'warning'); return; }
userRolesList.push({ name, tabs: [..._newUserRoleSelectedTabs] });
await saveUserRolesList();
input.value = '';
_newUserRoleSelectedTabs.clear();
['factory','prod','payments','sales'].forEach(t => {
const btn = document.getElementById('userrole-tab-' + t);
if (btn) btn.classList.remove('active');
});
const hint = document.getElementById('userrole-access-hint');
if (hint) hint.textContent = 'Select one or more tabs to assign';
renderUserRoleList();
showToast(`${name} added as User`, 'success');
}

async function removeUserRole(index) {
const user = userRolesList[index];
if (!user) return;
const _rMsg = `Remove ${esc(user.name)} from the team?\n\nThey will lose access to their assigned sections. This does not delete any recorded data.`;
const confirmed = await showGlassConfirm(_rMsg, { title: 'Remove User', confirmText: 'Remove', cancelText: 'Cancel', danger: true });
if (!confirmed) return;
userRolesList.splice(index, 1);
await saveUserRolesList();
renderUserRoleList();
showToast(`${esc(user.name)} removed`, 'info');
}

async function addNewSalesRep() {
const input = document.getElementById('new-rep-name-input');
if (!input) return;
const name = input.value.trim().toUpperCase();
if (!name) { showToast('Please enter a name', 'warning'); return; }
if (salesRepsList.includes(name)) { showToast('Rep already exists', 'warning'); return; }
salesRepsList.push(name);
await saveSalesRepsList();
input.value = '';
showToast(`${name} added`, 'success');
}

async function removeSalesRep(index) {
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
if (salesRepsList.length <= 1) { showToast('Must have at least one representative', 'warning'); return; }
const name = salesRepsList[index];
const _rsrSales = (typeof repSales !== 'undefined' ? repSales : []).filter(s => s.salesRep === name).length;
let _rsrMsg = `Remove ${name} from the sales team?`;
_rsrMsg += `\n\nThey will no longer appear as an available rep in the app.`;
if (_rsrSales > 0) _rsrMsg += `\n\n ${name} has ${_rsrSales} recorded sale${_rsrSales !== 1 ? 's' : ''} in the system. Those records will be kept, but you will no longer be able to add new sales under this name.`;
if (typeof currentRepProfile !== 'undefined' && currentRepProfile === name) _rsrMsg += `\n\n This rep is currently active on this device. The device will switch to the next available rep.`;
_rsrMsg += `\n\nThis does not delete any of their existing sales data.`;
const confirmed = await showGlassConfirm(_rsrMsg, {
title: `Remove ${name}`,
confirmText: 'Remove',
cancelText: 'Cancel',
danger: true
});
if (!confirmed) return;
salesRepsList.splice(index, 1);
if (currentRepProfile === name) {
currentRepProfile = salesRepsList[0];
await sqliteStore.set('repProfile', currentRepProfile);
}
await saveSalesRepsList();
showToast(`${name} removed`, 'info');
}

function openManageRepsModal() {
renderManageRepsList();
if (typeof openStandaloneScreen === 'function') openStandaloneScreen('sales-rep-screen');
}

function closeManageRepsModal() {
if (typeof closeStandaloneScreen === 'function') {
closeStandaloneScreen('sales-rep-screen');
closeStandaloneScreen('user-roles-screen');
closeStandaloneScreen('app-accounts-screen');
}
}
const _overlayStack = (() => {
  const _registry = {
    'formula-standard-screen':     { closeFn: () => closeStandaloneScreen('formula-standard-screen'), contentSel: '.screen-body' },
    'formula-asaan-screen':        { closeFn: () => closeStandaloneScreen('formula-asaan-screen'),    contentSel: '.screen-body' },
    'raw-material-screen':         { closeFn: () => closeStandaloneScreen('raw-material-screen'),     contentSel: '.screen-body' },
    'add-entity-screen':           { closeFn: () => closeStandaloneScreen('add-entity-screen'),       contentSel: '.screen-body' },
    'sales-rep-screen':            { closeFn: () => closeStandaloneScreen('sales-rep-screen'),        contentSel: '.screen-body' },
    'user-roles-screen':           { closeFn: () => closeStandaloneScreen('user-roles-screen'),       contentSel: '.screen-body' },
    'app-accounts-screen':         { closeFn: () => closeStandaloneScreen('app-accounts-screen'),     contentSel: '.screen-body' },
    'sync-data-screen':            { closeFn: () => closeStandaloneScreen('sync-data-screen'),        contentSel: '.screen-body' },
    'backup-restore-screen':       { closeFn: () => closeStandaloneScreen('backup-restore-screen'),   contentSel: '.screen-body' },
    'recycle-bin-screen':          { closeFn: () => closeStandaloneScreen('recycle-bin-screen'),      contentSel: '.screen-body' },
    'theme-screen':                { closeFn: () => closeStandaloneScreen('theme-screen'),            contentSel: '.screen-body' },
    'db-structure-screen':         { closeFn: () => closeStandaloneScreen('db-structure-screen'),     contentSel: '.screen-body' },
    'logout-screen':               { closeFn: () => closeStandaloneScreen('logout-screen'),           contentSel: '.screen-body' },
    'device-display-screen':       { closeFn: () => closeStandaloneScreen('device-display-screen'),   contentSel: '.screen-body' },
    'close-financial-year-screen': { closeFn: () => closeStandaloneScreen('close-financial-year-screen'), contentSel: '.screen-body' },
    'entity-details-screen':       { closeFn: () => closeStandaloneScreen('entity-details-screen'),          contentSel: '.screen-body' },
    'expense-details-screen':      { closeFn: () => closeStandaloneScreen('expense-details-screen'),         contentSel: '.screen-body' },
    'customer-management-screen':  { closeFn: () => closeStandaloneScreen('customer-management-screen'),     contentSel: '.screen-body' },
    'customer-edit-screen':        { closeFn: () => closeStandaloneScreen('customer-edit-screen'),           contentSel: '.screen-body' },
    'rep-customer-management-screen': { closeFn: () => closeStandaloneScreen('rep-customer-management-screen'), contentSel: '.screen-body' },
    'rep-customer-edit-screen':    { closeFn: () => closeStandaloneScreen('rep-customer-edit-screen'),       contentSel: '.screen-body' },
    'entity-details-screen':       { closeFn: () => closeStandaloneScreen('entity-details-screen'),          contentSel: '.screen-body' },
    'expense-details-screen':      { closeFn: () => closeStandaloneScreen('expense-details-screen'),         contentSel: '.screen-body' },
    'entityTransactionsOverlay':   { closeFn: () => closeEntityTransactions(),        contentSel: '.factory-overlay-card' },
  };
  function _openLayers() {
    const open = [];
    for (const [id, cfg] of Object.entries(_registry)) {
      const el = document.getElementById(id);
      if (!el) continue;
      const isOpen = el.classList.contains('open') ||
                     (el.style.display && el.style.display !== 'none' && el.style.display !== '');
      if (isOpen) open.push({ id, el, ...cfg });
    }
    open.sort((a, b) => {
      const pos = a.el.compareDocumentPosition(b.el);
      return (pos & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
    });
    return open;
  }
  function closeTop() {
    const layers = _openLayers();
    if (layers.length === 0) return false;
    const top = layers[layers.length - 1];
    top.closeFn();
    return true;
  }
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    if (document.querySelector('.glass-confirm-backdrop') || window._glassConfirmClosing) return;
    if (closeTop()) e.preventDefault();
  });
  return { closeTop, openLayers: _openLayers };
})();
window.loadSalesRepsList = loadSalesRepsList;
window.saveSalesRepsList = saveSalesRepsList;
window.renderAllRepUI = renderAllRepUI;
window.addNewSalesRep = addNewSalesRep;
window.removeSalesRep = removeSalesRep;
window.openManageRepsModal = openManageRepsModal;
window.closeManageRepsModal = closeManageRepsModal;
window.switchManageTeamTab = switchManageTeamTab;
async function loadUserRolesContent() {
if (firebaseDB && currentUser) {
try {
const teamDoc = await firebaseDB.collection('users').doc(currentUser.uid)
.collection('settings').doc('team').get();
if (teamDoc.exists) {
const data = teamDoc.data();
if (Array.isArray(data.user_roles) && data.user_roles.length > 0) {
userRolesList = data.user_roles;
await sqliteStore.set('user_roles_list', userRolesList).catch(() => {});
}
}
} catch (e) {
console.warn('loadUserRolesContent: cloud fetch failed, showing cached list', _safeErr(e));
}
}
renderUserRoleList();
}
window.addNewUserRole = addNewUserRole;
window.removeUserRole = removeUserRole;
window.toggleUserRoleTabAccess = toggleUserRoleTabAccess;
window.renderUserRoleList = renderUserRoleList;
window.loadUserRolesContent = loadUserRolesContent;
window.saveUserRolesList = saveUserRolesList;
window.lockToUserRoleMode = lockToUserRoleMode;
function phoneActionHTML(phone, opts = {}) {
const raw = (phone || '').toString().trim();
const empty = !raw || raw === '-' || raw === 'N/A' || raw === 'No Phone' || raw === 'No contact';
if (empty) return raw || (opts.dash ? '-' : '');
const digitCount = (raw.match(/\d/g) || []).length;
const looksLikePhone = digitCount >= 7 && /^[\d\s\-+(). ]+$/.test(raw);
if (!looksLikePhone) return esc(raw);
const clean = raw.replace(/[\s\-().]/g, '');
const wa = clean.startsWith('0') ? '92' + clean.slice(1) : clean;
return `<a href="tel:${clean}" title="Tap to call · Long-press for WhatsApp" style="color:inherit;text-decoration:none;cursor:pointer;border-bottom:1px dotted currentColor;touch-action:manipulation;-webkit-touch-callout:default;" oncontextmenu="event.preventDefault();window.open('https://wa.me/${wa}','_blank')">${esc(raw)}</a>`;
}
window.phoneActionHTML = phoneActionHTML;
window.initDatabase = async function(silent = false) {
const result = await initializeCompleteFirestoreDatabase(silent);
return result;
};
window.checkDatabase = async function() {
const isComplete = await isCompleteDatabaseInitialized();
return isComplete;
};
window.safeInitDatabase = async function(silent = false) {
const result = await safeInitializeCompleteDatabase(silent);
return result;
};
window.analyzeBackupFile = async function(file) {
if (!file) {
return;
}
try {
const text = await _readFileAsText(file);
const data = JSON.parse(text);
const reportLines = [];
const meta = data.backupMetadata;
reportLines.push({ type: 'section', label: 'Backup Metadata' });
if (meta) {
const createdAt = meta.timestamp
? new Date(meta.timestamp).toLocaleString()
: (meta.date || 'Unknown');
reportLines.push({ type: 'row', label: 'Created', value: createdAt });
reportLines.push({ type: 'row', label: 'Version', value: meta.version || 'Unknown' });
reportLines.push({ type: 'row', label: 'Device', value: meta.deviceInfo ? meta.deviceInfo.substring(0, 60) : 'Unknown' });
} else {
reportLines.push({ type: 'warning', label: 'No backup metadata found.' });
}
reportLines.push({ type: 'section', label: 'Collection Summary' });
const collections = [
['mfg', 'Production'],
['sales', 'Calculator History'],
['customerSales', 'Customer Sales'],
['repSales', 'Rep Sales'],
['repCustomers', 'Rep Customers'],
['salesCustomers', 'Sales Customers'],
['paymentTransactions', 'Payment Transactions'],
['paymentEntities', 'Payment Entities'],
['factoryInventoryData', 'Factory Inventory'],
['factoryProductionHistory', 'Factory History'],
['stockReturns', 'Stock Returns'],
['expenses', 'Expenses'],
];
let totalIssues = 0;
for (const [key, label] of collections) {
if (!data[key] || !Array.isArray(data[key])) {
reportLines.push({ type: 'row', label, value: 'Not present', muted: true });
continue;
}
const records = data[key];
if (records.length === 0) {
reportLines.push({ type: 'row', label, value: '0 records', muted: true });
continue;
}
const ids = records.map(r => r.id).filter(Boolean);
const uniqueIds = new Set(ids);
const duplicates = ids.length - uniqueIds.size;
const missingIds = records.length - ids.length;
let statusParts = [`${records.length} records`];
let hasIssue = false;
if (duplicates > 0) { statusParts.push(` ${duplicates} duplicate IDs`); totalIssues += duplicates; hasIssue = true; }
if (missingIds > 0) { statusParts.push(` ${missingIds} missing IDs`); totalIssues += missingIds; hasIssue = true; }
reportLines.push({
type: 'row',
label,
value: statusParts.join(' · '),
issue: hasIssue
});
}
reportLines.push({ type: 'section', label: 'Settings & Formulas' });
const settingsKeys = [
['factoryDefaultFormulas', 'Factory Default Formulas'],
['factoryAdditionalCosts', 'Additional Costs'],
['factoryCostAdjustmentFactor', 'Cost Adjustment Factor'],
['factorySalePrices', 'Sale Prices'],
['factoryUnitTracking', 'Unit Tracking'],
['settings', 'App Settings (naswar)'],
];
for (const [key, label] of settingsKeys) {
const present = data[key] !== undefined && data[key] !== null;
reportLines.push({ type: 'row', label, value: present ? 'Present ' : 'Not present', muted: !present });
}
const tombstoneCount = Array.isArray(data.deleted_records) ? data.deleted_records.length : 0;
reportLines.push({ type: 'section', label: 'Deleted Records (Tombstones)' });
reportLines.push({ type: 'row', label: 'Tombstone count', value: String(tombstoneCount) });
const verdict = totalIssues > 0
? { icon: '', color: '#f59e0b', text: `${totalIssues} issue${totalIssues !== 1 ? 's' : ''} found — restore will auto-clean on import` }
: { icon: '', color: '#10b981', text: 'File looks healthy — no duplicates or format issues detected' };
const existing = document.getElementById('backup-analysis-modal');
if (existing) existing.remove();
const modal = document.createElement('div');
modal.id = 'backup-analysis-modal';
modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:10300;padding:16px;';
const rowsHtml = reportLines.map(line => {
if (line.type === 'section') {
return `<div style="font-size:0.65rem;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:0.08em;margin:14px 0 6px 0;padding-top:10px;border-top:1px solid var(--glass-border);">${esc(line.label)}</div>`;
}
if (line.type === 'warning') {
return `<div style="font-size:0.72rem;color:#f59e0b;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:8px 10px;margin:4px 0;"> ${esc(line.label)}</div>`;
}
const valueColor = line.issue ? '#f59e0b' : (line.muted ? 'var(--text-muted)' : 'var(--text-main)');
return `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:0.72rem;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
<span style="color:var(--text-muted);flex-shrink:0;">${esc(line.label)}</span>
<span style="color:${valueColor};text-align:right;font-weight:${line.issue ? '600' : '400'};">${esc(line.value)}</span>
</div>`;
}).join('');
modal.innerHTML = `
<div style="background:var(--glass);border:1px solid var(--glass-border);padding:24px;border-radius:24px;max-width:480px;width:100%;max-height:85vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,0.6);">
<h3 style="margin:0 0 4px 0;color:var(--text-main);font-size:1rem;display:flex;align-items:center;gap:8px;">
Backup File Analysis
</h3>
<div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:16px;">${esc(file.name)} · ${(file.size / 1024).toFixed(1)} KB</div>
<div style="background:var(--input-bg);border-radius:14px;padding:14px;margin-bottom:16px;">
${rowsHtml}
</div>
<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:14px;border:1px solid;background:${verdict.color}18;border-color:${verdict.color}44;margin-bottom:16px;">
<span style="font-size:1.2rem;">${esc(verdict.icon)}</span>
<span style="font-size:0.75rem;color:${verdict.color};font-weight:600;">${esc(verdict.text)}</span>
</div>
<div style="display:flex;gap:10px;">
<button onclick="document.getElementById('backup-analysis-modal').remove(); document.getElementById('restoreInput').click();"
style="flex:1;padding:12px;background:var(--accent);border:none;border-radius:14px;color:white;cursor:pointer;font-size:0.82rem;font-weight:600;">
Restore This File
</button>
<button onclick="document.getElementById('backup-analysis-modal').remove();"
style="flex:1;padding:12px;background:var(--glass);border:1px solid var(--glass-border);border-radius:14px;color:var(--text-main);cursor:pointer;font-size:0.82rem;">
Close
</button>
</div>
</div>
`;
document.body.appendChild(modal);
modal.addEventListener('click', (ev) => {
if (ev.target === modal) modal.remove();
});
} catch (error) {
console.error('analyzeBackupFile error:', _safeErr(error));
showToast('Could not parse backup file: ' + error.message, 'error');
}
};
(function() {
  let _adminLoaded = false;
  let _adminLoading = null;
  function _loadAdminModule() {
    if (_adminLoaded) return Promise.resolve();
    if (_adminLoading) return _adminLoading;
    _adminLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'admin-data.js';
      script.onload = () => { _adminLoaded = true; resolve(); };
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return _adminLoading;
  }
  window.showDeltaSyncDetails = async function() {
    await _loadAdminModule();
    if (typeof window._showDeltaSyncDetails === 'function') {
      return window._showDeltaSyncDetails();
    }
  };
  window.showCloseFinancialYearDialog = async function() {
    await _loadAdminModule();
    if (typeof window._showCloseFinancialYearDialog === 'function') {
      return window._showCloseFinancialYearDialog();
    }
  };
})();
async function loadDeviceList() {
const container = document.getElementById('device-list-container');
if (!container) return;
if (!firebaseDB || !currentUser) {
container.innerHTML = `
<div class="u-empty-state-sm" >
Please log in to view devices
</div>
`;
return;
}
try {
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
const devicesSnap = await userRef.collection('devices').get();
if (devicesSnap.empty) {
container.innerHTML = `
<div class="u-empty-state-sm" >
No devices registered yet
</div>
`;
return;
}
const currentDeviceId = await getDeviceId();
const now = Date.now();
let accountEmail = currentUser.email || 'Unknown';
try {
const accountInfoSnap = await userRef.collection('account').doc('info').get();
if (accountInfoSnap.exists) {
const accountData = accountInfoSnap.data();
accountEmail = accountData.email || accountEmail;
}
} catch (e) {
console.error('An unexpected error occurred.', _safeErr(e));
showToast('An unexpected error occurred.', 'error');
}
const seenIds = new Set();
const uniqueDocs = devicesSnap.docs.filter(doc => {
const data = doc.data();
const id = data.deviceId;
if (!id || id === 'default_device' || doc.id === 'default_device') return false;
if (id === currentDeviceId || doc.id === currentDeviceId) return false;
if (seenIds.has(id) || seenIds.has(doc.id)) return false;
seenIds.add(id);
seenIds.add(doc.id);
return true;
});
if (uniqueDocs.length === 0) {
container.innerHTML = `
<div class="u-empty-state-sm" >
No other devices registered
</div>
`;
return;
}
let html = `
<div style="margin-bottom: 15px; padding: 10px; background: rgba(0, 122, 255, 0.1); border-radius: 8px; border: 1px solid rgba(0, 122, 255, 0.3);">
<div style="font-size: 0.75rem; color: var(--accent); font-weight: 600;">
Account: ${accountEmail}
</div>
<div class="u-field-hint-xxs" >
Total Devices: ${uniqueDocs.length} • Online: ${uniqueDocs.filter(d => {
const ls = d.data().lastSeen?.toMillis() || 0;
return (now - ls) < 60000;
}).length}
</div>
</div>
`;
uniqueDocs.forEach(doc => {
const device = doc.data();
const lastSeen = device.lastSeen?.toMillis() || 0;
const isOnline = (now - lastSeen) < 60000;
const totalCommands = device.totalCommands || 0;
const remoteAppliedMode = device.remoteAppliedMode || null;
const remoteAppliedAt = device.remoteAppliedAt || null;
const remoteAppliedBy = device.remoteAppliedBy || null;
const deviceMode = device.currentMode || 'admin';
const assignedRep = device.assignedRep || null;
const assignedManager = device.assignedManager || null;
const assignedUserTabs = Array.isArray(device.assignedUserTabs) ? device.assignedUserTabs : [];
const modeLabel = deviceMode === 'admin'
? 'ADMIN'
: deviceMode === 'userrole'
? (assignedManager || 'USER ROLE')
: deviceMode === 'production'
? (assignedManager || 'PRODUCTION')
: deviceMode === 'factory'
? (assignedManager || 'FACTORY')
: (assignedRep || 'REP');
const modeColor = deviceMode === 'admin' ? '#007aff'
: deviceMode === 'userrole' ? '#ffcc02'
: deviceMode === 'production' ? '#69f0ae'
: deviceMode === 'factory' ? '#ce93d8'
: '#ff9f0a';
const modeIcon = '';
const onlineColor = isOnline ? '#30d158' : '#ff453a';
const onlineDot = isOnline ? ' Online' : ' Offline';

let deviceShard = 'N/A';
if (device.deviceShard) {
  deviceShard = String(device.deviceShard).toUpperCase();
} else if (device.deviceId && typeof deriveDeviceShard === 'function') {
try {
deviceShard = deriveDeviceShard(device.deviceId).toUpperCase();
} catch (_) { deviceShard = 'N/A'; }
}

let firstLoginStr = '';
if (device.firstLoginAt) {
  try {
    const ms = typeof device.firstLoginAt === 'number'
      ? device.firstLoginAt
      : (device.firstLoginAt.toMillis ? device.firstLoginAt.toMillis() : Number(device.firstLoginAt));
    firstLoginStr = new Date(ms).toLocaleString();
  } catch (_) {}
} else if (device.deviceId && typeof _extractDeviceFirstLoginTime === 'function') {
  try {
    const flt = _extractDeviceFirstLoginTime(device.deviceId);
    if (flt) firstLoginStr = flt.toLocaleString();
  } catch (_) {}
}
let cardHtml = '<div style="background:var(--glass-raised);border:1px solid var(--glass-border);border-radius:14px;padding:14px;margin-bottom:12px;">';
cardHtml += '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px;">';
cardHtml += '<div style="font-size:0.65rem;font-family:\'Geist Mono\',monospace;color:var(--text-muted);flex:1;min-width:0;line-height:1.4;" title="Device shard: ' + deviceShard + (firstLoginStr ? ' | First login: ' + firstLoginStr : '') + '">Shard: <span style="color:var(--accent);font-weight:700;letter-spacing:0.08em;">' + deviceShard + '</span>' + (firstLoginStr ? ' &nbsp;<span style="color:var(--text-muted);font-weight:400;font-size:0.6rem;">first login: ' + firstLoginStr + '</span>' : '') + '</div>';
cardHtml += '<div style="text-align:right;flex-shrink:0;">';
cardHtml += '<div style="font-size:0.8rem;font-weight:800;color:' + modeColor + ';white-space:nowrap;">' + modeLabel + '</div>';
cardHtml += '<div style="font-size:0.6rem;color:' + onlineColor + ';margin-top:2px;">' + onlineDot + '</div>';
cardHtml += '</div>';
cardHtml += '</div>';
const lastSeenStr = lastSeen ? new Date(lastSeen).toLocaleString() : 'Never';
cardHtml += '<div style="font-size:0.6rem;color:var(--text-muted);margin-bottom:6px;">Last seen: ' + lastSeenStr + '</div>';
const lastCmdStr = remoteAppliedAt ? new Date(remoteAppliedAt).toLocaleString() : null;
const lastCmdMode = remoteAppliedMode ? remoteAppliedMode.toUpperCase() : null;
const lastCmdBy = remoteAppliedBy || null;
if (lastCmdMode || totalCommands > 0) {
cardHtml += '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:11px;padding:7px 10px;background:rgba(255,255,255,0.04);border-radius:8px;border:1px solid var(--glass-border);">';
cardHtml += '<span style="font-size:0.6rem;color:var(--text-muted);flex-shrink:0;">Commands:</span>';
if (totalCommands > 0) {
cardHtml += '<span style="font-size:0.62rem;font-weight:700;color:var(--accent);background:var(--accent-dim);padding:2px 7px;border-radius:99px;">' + totalCommands + ' sent</span>';
}
if (lastCmdMode) {
cardHtml += '<span style="font-size:0.62rem;font-weight:700;color:var(--text-main);">→ ' + lastCmdMode + '</span>';
}
if (lastCmdBy) {
cardHtml += '<span style="font-size:0.6rem;color:var(--text-muted);">by ' + esc(lastCmdBy) + '</span>';
}
if (lastCmdStr) {
cardHtml += '<span style="font-size:0.58rem;color:var(--text-secondary);margin-left:auto;">' + lastCmdStr + '</span>';
}
cardHtml += '</div>';
} else {
cardHtml += '<div style="margin-bottom:11px;padding:7px 10px;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid var(--glass-border);font-size:0.6rem;color:var(--text-secondary);">No commands sent yet</div>';
}
const isAdmin = deviceMode === 'admin';
const adminBg = isAdmin ? 'rgba(0,122,255,0.18)' : 'rgba(0,122,255,0.08)';
const adminBord = isAdmin ? '2px solid rgba(0,122,255,0.55)' : '1px solid rgba(0,122,255,0.25)';
const adminFw = isAdmin ? '800' : '600';
const adminTick = isAdmin ? ' ' : '';
cardHtml += '<button onclick="remoteControlDevice(\'' + device.deviceId + '\', \'admin\')"';
cardHtml += ' style="width:100%;padding:9px;background:' + adminBg + ';border:' + adminBord + ';border-radius:99px;color:#007aff;cursor:pointer;font-size:0.72rem;font-weight:' + adminFw + ';margin-bottom:10px;">' + adminTick + 'Admin Mode</button>';
if (salesRepsList.length > 0) {
cardHtml += '<div style="font-size:0.6rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:5px;">Sales Representatives</div>';
cardHtml += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:5px;margin-bottom:10px;">';
const repColors = [
{bg:'48,209,88',hex:'#30d158'},{bg:'255,159,10',hex:'#ff9f0a'},
{bg:'191,90,242',hex:'#bf5af2'},{bg:'255,69,58',hex:'#ff453a'},{bg:'90,200,250',hex:'#5ac8fa'}
];
for (let ri = 0; ri < salesRepsList.length; ri++) {
const rep = salesRepsList[ri];
const c = repColors[ri % repColors.length];
const repLocked = deviceMode === 'rep' && assignedRep === rep;
const repBg = 'rgba(' + c.bg + ',' + (repLocked ? '0.22' : '0.08') + ')';
const repBord = (repLocked ? '2' : '1') + 'px solid rgba(' + c.bg + ',' + (repLocked ? '0.65' : '0.28') + ')';
const repFw = repLocked ? '800' : '600';
const repTick = repLocked ? ' ' : '';
cardHtml += '<button onclick="remoteControlDevice(\'' + device.deviceId + '\', \'rep\', \'' + rep + '\')"';
cardHtml += ' style="padding:8px 5px;background:' + repBg + ';border:' + repBord + ';border-radius:99px;color:' + c.hex + ';cursor:pointer;font-size:0.68rem;font-weight:' + repFw + ';text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">';
cardHtml += repTick + rep + '</button>';
}
cardHtml += '</div>';
}
if (userRolesList.length > 0) {
cardHtml += '<div style="font-size:0.6rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:5px;">User Roles</div>';
cardHtml += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:5px;margin-bottom:10px;">';
for (let ui = 0; ui < userRolesList.length; ui++) {
const user = userRolesList[ui];
const userLocked = deviceMode === 'userrole' && device.assignedManager === user.name;
const userBg = 'rgba(255,204,2,' + (userLocked ? '0.22' : '0.08') + ')';
const userBord = (userLocked ? '2' : '1') + 'px solid rgba(255,204,2,' + (userLocked ? '0.65' : '0.28') + ')';
const userFw = userLocked ? '800' : '600';
const userTick = userLocked ? ' ' : '';
const lookupKey = '_devTabsCache';
if (!window[lookupKey]) window[lookupKey] = {};
window[lookupKey][device.deviceId + '_' + ui] = user.tabs || [];
cardHtml += '<button onclick="remoteControlDevice(\'' + device.deviceId + '\', \'userrole\', \'' + user.name + '\', (window._devTabsCache||{})[\'' + device.deviceId + '_' + ui + '\'])"';
cardHtml += ' style="padding:8px 5px;background:' + userBg + ';border:' + userBord + ';border-radius:99px;color:#ffcc02;cursor:pointer;font-size:0.68rem;font-weight:' + userFw + ';text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">';
cardHtml += userTick + user.name + '</button>';
}
cardHtml += '</div>';
}
cardHtml += '<button onclick="removeDevice(\'' + device.deviceId + '\')"';
cardHtml += ' style="width:100%;padding:7px;background:rgba(255,69,58,0.07);border:1px solid rgba(255,69,58,0.28);border-radius:99px;color:#ff453a;cursor:pointer;font-size:0.65rem;">Remove Device</button>';
cardHtml += '</div>';
html += cardHtml;
});
container.innerHTML = html;
} catch (error) {
console.error('An unexpected error occurred.', _safeErr(error));
showToast('An unexpected error occurred.', 'error');
container.innerHTML = `
<div style="text-align: center; padding: 20px; color: #ff453a;">
Error loading devices: ${esc(error.message)}
</div>
`;
}
}

async function refreshDeviceList() {
const container = document.getElementById('device-list-container');
if (container) {
container.innerHTML = `
<div class="u-empty-state-sm" >
Refreshing...
</div>
`;
}
await loadDeviceList();
showToast(' Device list refreshed', 'success', 2000);
}

async function remoteControlDevice(deviceId, targetMode, repName = null, userTabs = null) {
if (!firebaseDB || !currentUser) {
showToast('Not logged in', 'error', 3000);
return;
}
let _rcTitle, _rcMsg, _rcConfirm;
if (targetMode === 'admin') {
_rcTitle = 'Unlock to Admin Mode';
_rcMsg = 'Unlock this device to full Admin mode?\n\nAll tabs and admin features will become accessible.';
_rcConfirm = 'Unlock to Admin';
} else if (targetMode === 'rep' && repName) {
_rcTitle = 'Lock Device — Sales Rep';
_rcMsg = `Lock this device to Sales Rep mode for ${repName}?\n\nThe device will only show the Rep Sales tab. All admin features, tabs and controls will be hidden until unlocked remotely.`;
_rcConfirm = `Lock to ${repName}`;
} else if (targetMode === 'userrole' && repName) {
const tabLabels = { prod: 'Production', factory: 'Factory', sales: 'Sales', payments: 'Payments' };
const tabList = Array.isArray(userTabs) ? userTabs.map(t => tabLabels[t] || t).join(', ') : 'assigned tabs';
_rcTitle = 'Lock Device — User Role';
_rcMsg = `Lock this device to User Role for ${repName}?\n\nAssigned tabs: ${tabList}\n\nOnly the assigned sections will be visible. All other tabs, analytics and admin controls will be hidden.`;
_rcConfirm = `Lock to ${repName}`;
} else {
_rcTitle = 'Switch Device Mode';
_rcMsg = `Switch this device to ${targetMode.toUpperCase()} mode?`;
_rcConfirm = 'Confirm';
}
const confirmed = await showGlassConfirm(_rcMsg, {
title: _rcTitle,
confirmText: _rcConfirm,
cancelText: 'Cancel',
danger: targetMode !== 'admin'
});
if (!confirmed) return;
try {

if (window._firestoreNetworkDisabled) {
try { await firebaseDB.enableNetwork(); window._firestoreNetworkDisabled = false; } catch (_en) {}
}
const userRef = firebaseDB.collection('users').doc(currentUser.uid);

const commandTimestamp = Date.now();
const deviceRef = userRef.collection('devices').doc(deviceId);
const updateData = {
targetMode: targetMode,
targetModeTimestamp: commandTimestamp,
commandSource: 'remote_admin',
lastControlled: commandTimestamp,
controlledBy: currentUser.email || 'Admin',
currentMode: targetMode,
assignedRep: targetMode === 'rep' ? (repName || null) : null,
assignedManager: targetMode === 'userrole' ? (repName || null) : null,
assignedUserTabs: targetMode === 'userrole' ? (userTabs || []) : null,
assignedRoleType: targetMode,
assignedRoleName: repName || null,
lockedAt: repName ? commandTimestamp : null,
lockedBy: repName ? (currentUser.email || 'Admin') : null,
};
await deviceRef.set(updateData, { merge: true });
const successMsg = targetMode === 'admin'
? ' Device unlocked to Admin mode'
: targetMode === 'rep' ? ` Device locked to Sales Rep: ${repName}`
: targetMode === 'userrole' ? ` Device locked to User: ${repName}`
: ` Command sent: ${targetMode}`;
showToast(successMsg, 'success', 3500);
setTimeout(loadDeviceList, 2000);
} catch (error) {
showToast('Failed to control device: ' + error.message, 'error', 4000);
}
}

async function removeDevice(deviceId) {
if (!firebaseDB || !currentUser) {
showToast('Not logged in', 'error', 3000);
return;
}
if (!deviceId || !validateUUID(String(deviceId))) {
showToast('Invalid device ID', 'error', 3000);
return;
}
const _rdMsg = `Remove this device from the trusted list?\n\nThe device will be logged out immediately and will no longer be able to sync data or receive remote commands. It will need to be re-approved if the user tries to reconnect.\n\nThis does not delete any data already on the device.`;
if (!(await showGlassConfirm(_rdMsg, { title: 'Remove Trusted Device', confirmText: 'Remove', danger: true }))) {
return;
}
try {
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
const deviceRef = userRef.collection('devices').doc(deviceId);
await deviceRef.set({
targetMode: 'force_logout',
targetModeTimestamp: Date.now(),
commandSource: 'remote_admin',
forceLogout: true,
forceLogoutAt: Date.now()
}, { merge: true });
await new Promise(resolve => setTimeout(resolve, 600));
await deviceRef.delete();
showToast('Device removed and logged out', 'success', 3000);
await loadDeviceList();
} catch (error) {
showToast('Failed to remove device: ' + error.message, 'error', 3000);
}
}
window.loadDeviceList = loadDeviceList;
window.refreshDeviceList = refreshDeviceList;
window.remoteControlDevice = remoteControlDevice;
window.removeDevice = removeDevice;
window.getDeviceId = getDeviceId;
window.getDeviceName = getDeviceName;
window.registerDevice = registerDevice;
async function restoreDeviceModeOnLogin(uid) {

function _applyModeFromData(modeStr, ts, assignedRep, assignedManager, assignedUserTabs, remoteApplied) {
  const previousMode = appMode;
  appMode = modeStr;
  const modeBatch = [['appMode', appMode], ['appMode_timestamp', ts]];
  if (modeStr === 'rep' && assignedRep) {
    currentRepProfile = assignedRep;
    modeBatch.push(['repProfile', currentRepProfile], ['repProfile_timestamp', ts]);
  } else if (modeStr === 'userrole' && assignedManager) {
    window._assignedManagerName = assignedManager;
    window._assignedUserTabs = Array.isArray(assignedUserTabs) ? assignedUserTabs : [];
    modeBatch.push(['assignedManager', assignedManager], ['assignedUserTabs', window._assignedUserTabs]);
  } else if ((modeStr === 'production' || modeStr === 'factory') && assignedManager) {
    window._assignedManagerName = assignedManager;
    modeBatch.push(['assignedManager', assignedManager]);
  }
  sqliteStore.setBatch(modeBatch).catch(() => {});
  const modeLabel = modeStr === 'rep' ? 'Rep Mode'
    : modeStr === 'userrole'    ? 'User Role Mode'
    : modeStr === 'production'  ? 'Production Mode'
    : modeStr === 'factory'     ? 'Factory Mode'
    : 'Admin Mode';
  showToast(remoteApplied
    ? `Restoring remotely assigned ${modeLabel}...`
    : `Switching to ${modeLabel}...`, 'info', 2000);
  setTimeout(() => { window.location.reload(); }, 1500);
}

try {
  const localTimestamp = Number(await sqliteStore.get('appMode_timestamp')) || 0;

  if (firebaseDB && !window._firestoreNetworkDisabled && navigator.onLine) {
    try {
      const deviceId = await getDeviceId();
      const deviceRef = firebaseDB.collection('users').doc(uid)
                                  .collection('devices').doc(deviceId);
      const deviceDoc = await deviceRef.get();

      if (deviceDoc.exists) {
        const data = deviceDoc.data();
        if (data && (data.forceLogout === true || data.targetMode === 'force_logout')) {
          if (typeof signOut === 'function') {
            showToast('This device has been removed by admin. Logging out…', 'warning', 4000);
            window._forceLogoutSignOut = true;
            setTimeout(() => signOut().catch(() => {}), 1200);
          }
          return;
        }
        const cloudMode      = data.currentMode || 'admin';
        const cloudTimestamp = data.appMode_timestamp || 0;
        const _modeIsLocked  = cloudMode !== 'admin';
        const _localIsAdmin  = appMode === 'admin';
        const shouldRestore  = (cloudMode && cloudTimestamp > localTimestamp && cloudMode !== appMode)
                            || (_modeIsLocked && _localIsAdmin);
        if (shouldRestore) {
          _applyModeFromData(
            cloudMode, cloudTimestamp,
            data.assignedRep, data.assignedManager,
            data.assignedUserTabs, !!data.remoteAppliedMode
          );
        }

        return;
      }

    } catch (_fsErr) {
      console.warn('[restoreDeviceMode] Firestore read failed, trying SQLite fallback:', _safeErr(_fsErr));
    }
  }

  const sqliteMode = await sqliteStore.get('appMode') || 'admin';
  const _modeIsLockedSqlite = sqliteMode !== 'admin';
  const _localIsAdminSqlite = appMode === 'admin';
  if (_modeIsLockedSqlite && _localIsAdminSqlite) {
    const assignedRep     = await sqliteStore.get('repProfile').catch(() => null);
    const assignedManager = await sqliteStore.get('assignedManager').catch(() => null);
    const assignedTabs    = await sqliteStore.get('assignedUserTabs').catch(() => []);
    _applyModeFromData(
      sqliteMode, localTimestamp || Date.now(),
      assignedRep, assignedManager, assignedTabs, false
    );
  }
} catch (error) {
  console.warn('[restoreDeviceMode] could not restore device mode:', _safeErr(error));
}
}
window.restoreDeviceModeOnLogin = restoreDeviceModeOnLogin;
async function listenForDeviceCommands() {
if (!firebaseDB || !currentUser) return;

if (typeof window.deviceCommandsUnsubscribe === 'function') {
try { window.deviceCommandsUnsubscribe(); } catch (_) {}
window.deviceCommandsUnsubscribe = null;
}

if (!window._deviceCmdRetryAttempts) window._deviceCmdRetryAttempts = 0;
if (!window._deviceCmdRetrying) window._deviceCmdRetrying = false;

try {
const deviceId = await getDeviceId();
const userRef = firebaseDB.collection('users').doc(currentUser.uid);
const deviceRef = userRef.collection('devices').doc(deviceId);

const unsubscribe = deviceRef.onSnapshot({ includeMetadataChanges: false }, (doc) => {
try {

if (doc.metadata.fromCache || doc.metadata.hasPendingWrites) return;
if (!doc.exists) {
setTimeout(async () => {
try {
const recheck = await deviceRef.get();
if (!recheck.exists) {
if (typeof signOut === 'function') {
showToast('This device has been removed. Logging out…', 'warning', 4000);
window._forceLogoutSignOut = true;
setTimeout(() => signOut().catch(() => {}), 1200);
}
}
} catch (_rc) {}
}, 3000);
return;
}
const data = doc.data();
if (!data || !data.targetMode || !data.targetModeTimestamp) return;
if (data.forceLogout === true || data.targetMode === 'force_logout') {
if (typeof signOut === 'function') {
showToast('Logged out remotely by admin.', 'warning', 4000);
window._forceLogoutSignOut = true;
setTimeout(() => signOut().catch(() => {}), 1200);
}
return;
}
const targetMode = data.targetMode;
let resolvedName = null;
const roleType = data.assignedRoleType || targetMode;
if (roleType === 'rep') {
resolvedName = data.assignedRoleName || data.assignedRep || null;
} else if (roleType === 'userrole' || roleType === 'production' || roleType === 'factory') {
resolvedName = data.assignedRoleName || data.assignedManager || null;
}
const effectiveMode = data.assignedRoleType || targetMode;
const resolvedUserTabs = Array.isArray(data.assignedUserTabs) ? data.assignedUserTabs : [];

const commandTimestamp = data.targetModeTimestamp && data.targetModeTimestamp.toMillis
? data.targetModeTimestamp.toMillis()
: (typeof data.targetModeTimestamp === 'number' ? data.targetModeTimestamp : 0);
if (!commandTimestamp) return;
const lastProcessed = window.lastProcessedCommandTimestamp || 0;
if (commandTimestamp > lastProcessed) {
applyRemoteModeChange(effectiveMode, data.commandSource || 'remote', resolvedName, resolvedUserTabs);
window.lastProcessedCommandTimestamp = commandTimestamp;

window._deviceCmdRetryAttempts = 0;
}
} catch (snapErr) {
console.warn('[device] command snapshot handler error:', _safeErr(snapErr));
}
}, (error) => {
const _code = error && error.code;
console.warn('[device] command listener error:', _code, _safeErr(error));
window.deviceCommandsUnsubscribe = null;

if (_code === 'permission-denied' || _code === 'failed-precondition') {
console.warn('[device] stopping device listener — unrecoverable error:', _code);
window._deviceCmdRetryAttempts = 0;
window._deviceCmdRetrying = false;
return;
}

if (window._deviceCmdRetrying) return;
window._deviceCmdRetryAttempts = (window._deviceCmdRetryAttempts || 0) + 1;
const MAX_DEVICE_RETRIES = 8;
if (window._deviceCmdRetryAttempts > MAX_DEVICE_RETRIES) {
console.warn('[device] max retries reached — giving up device listener');
window._deviceCmdRetryAttempts = 0;
window._deviceCmdRetrying = false;
return;
}

const delay = Math.min(5000 * Math.pow(2, window._deviceCmdRetryAttempts - 1), 120000);
window._deviceCmdRetrying = true;
setTimeout(() => {
window._deviceCmdRetrying = false;
if (firebaseDB && currentUser) {
listenForDeviceCommands().catch(e => {
window._deviceCmdRetrying = false;
console.warn('[device] listenForDeviceCommands retry failed:', _safeErr(e));
});
}
}, delay);
});
window.deviceCommandsUnsubscribe = unsubscribe;
window._deviceCmdRetryAttempts = 0;
window._deviceCmdRetrying = false;
} catch (error) {
console.error('[device] listenForDeviceCommands failed:', _safeErr(error));
}
}

async function applyRemoteModeChange(targetMode, source, repName = null, userTabs = null) {
const previousMode = appMode;
const previousManager = window._assignedManagerName || null;
const previousTabs = JSON.stringify(window._assignedUserTabs || []);
if (previousMode === targetMode) {
if (targetMode === 'admin') return;
if (targetMode === 'rep' && currentRepProfile === repName) return;
if (targetMode === 'userrole' && previousManager === repName && previousTabs === JSON.stringify(userTabs || [])) return;
}
appMode = targetMode;
const nowMs = Date.now();
const batchData = [['appMode', appMode], ['appMode_timestamp', nowMs]];
if (targetMode === 'rep' && repName) {
currentRepProfile = repName;
batchData.push(['repProfile', repName], ['repProfile_timestamp', nowMs]);
if (!salesRepsList.includes(repName)) {
salesRepsList.push(repName);
batchData.push(['sales_reps_list', salesRepsList]);
if (typeof renderAllRepUI === 'function') renderAllRepUI();
}
} else if (targetMode === 'userrole') {
window._assignedManagerName = repName || null;
window._assignedUserTabs = Array.isArray(userTabs) ? userTabs : [];
batchData.push(['assignedManager', repName || null], ['assignedUserTabs', window._assignedUserTabs]);
} else if (targetMode === 'production' || targetMode === 'factory') {
window._assignedManagerName = repName || null;
batchData.push(['assignedManager', repName || null]);
} else if (targetMode === 'admin') {
window._assignedManagerName = null;
window._assignedUserTabs = [];
batchData.push(['assignedManager', null], ['assignedUserTabs', []]);
}
await sqliteStore.setBatch(batchData);
if (firebaseDB && currentUser) {
try {

if (targetMode === 'admin' && window._firestoreNetworkDisabled) {
try { await firebaseDB.enableNetwork(); window._firestoreNetworkDisabled = false; } catch (_en) {}
}
const deviceId = await getDeviceId();
const deviceRef = firebaseDB.collection('users').doc(currentUser.uid)
.collection('devices').doc(deviceId);
const payload = {
currentMode: targetMode, appMode_timestamp: nowMs,
remoteAppliedMode: targetMode, remoteAppliedAt: nowMs, remoteAppliedBy: source || 'remote',
assignedRoleType: targetMode, assignedRoleName: repName || null,
assignedRep: targetMode === 'rep' ? (repName || null) : null,
assignedManager: targetMode === 'userrole' ? (repName || null) : null,
assignedUserTabs: targetMode === 'userrole' ? (window._assignedUserTabs || []) : null,
};
if (targetMode === 'rep') payload.repProfile_timestamp = nowMs;
await deviceRef.set(payload, { merge: true });
} catch (e) { console.error('Firebase write failed:', _safeErr(e)); }
}
if (targetMode === 'rep') {
if (typeof lockToRepMode === 'function') lockToRepMode();
if (typeof renderRepCustomerTable === 'function') renderRepCustomerTable();
showToast(repName ? `Locked to Rep: ${repName}` : 'Device locked to Rep Sales mode', 'info', 4000);
} else if (targetMode === 'userrole') {
window._userRoleAllowedTabs = window._assignedUserTabs || [];
if (typeof lockToUserRoleMode === 'function') lockToUserRoleMode();
showToast(repName ? `Locked to User: ${repName}` : 'Device locked to User Role mode', 'info', 4000);
} else if (targetMode === 'production') {
if (typeof lockToProductionMode === 'function') lockToProductionMode();
showToast(repName ? `Locked to Production: ${repName}` : 'Device locked to Production mode', 'info', 4000);
} else if (targetMode === 'factory') {
if (typeof lockToFactoryMode === 'function') lockToFactoryMode();
showToast(repName ? `Locked to Factory: ${repName}` : 'Device locked to Factory mode', 'info', 4000);
} else if (targetMode === 'admin') {
if (typeof unlockAdminMode === 'function') unlockAdminMode();
if (typeof notifyDataChange === 'function') notifyDataChange('all');
showToast('Device unlocked to Admin mode', 'info', 4000);
}
}
window.listenForDeviceCommands = listenForDeviceCommands;
function listenForTeamChanges() {
if (window._teamUnsubscribe) {
try { window._teamUnsubscribe(); } catch(e) {}
window._teamUnsubscribe = null;
}
}
window.listenForTeamChanges = listenForTeamChanges;
window.applyRemoteModeChange = applyRemoteModeChange;
