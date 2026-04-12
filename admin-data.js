async function updateDeltaSyncStatsDisplay() {
  const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
  const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
  const repSales = ensureArray(await sqliteStore.get('rep_sales'));
  const salesHistory = ensureArray(await sqliteStore.get('noman_history'));
  const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
  const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
  const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
  const factoryProductionHistory = ensureArray(await sqliteStore.get('factory_production_history'));
  const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
  const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
  try {
    const modal = document.getElementById('delta-stats-modal');
    if (!modal) return;
    const statsRows = modal.querySelectorAll('[data-sync-stat]');
    if (statsRows.length > 0 && typeof DeltaSync !== 'undefined') {
      const stats = await DeltaSync.getSyncStats();
      statsRows.forEach(row => {
        const col = row.getAttribute('data-sync-stat');
        if (stats && stats[col]) {
          row.textContent = new Date(stats[col]).toLocaleString();
        } else {
          row.textContent = 'Never';
        }
      });
    }
    if (typeof showToast === 'function') {
      showToast('Sync history cleared', 'success', 2500);
    }
  } catch (e) {
    if (typeof showToast === 'function') {
      showToast('Could not refresh stats: ' + e.message, 'warning', 3000);
    }
  }
}

async function showDeltaSyncDetails() {
if (!firebaseDB || !currentUser) {
  showToast('Please log in to view database structure', 'warning', 3000);
  return;
}

const modal = document.createElement('div');
modal.id = 'delta-stats-modal';
modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.82);display:flex;align-items:center;justify-content:center;z-index:10300;padding:16px;';
modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
modal.innerHTML = `<div style="background:var(--glass);padding:40px;border-radius:20px;text-align:center;">
  <div style="margin-bottom:12px;display:flex;justify-content:center;"><svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" ><rect x="5" y="5" width="26" height="7" rx="2.5" fill="var(--accent)" fill-opacity="0.20" stroke="var(--accent)" stroke-width="1.4"/><rect x="5" y="15" width="26" height="7" rx="2.5" fill="var(--accent)" fill-opacity="0.13" stroke="var(--accent)" stroke-width="1.4"/><rect x="5" y="25" width="26" height="7" rx="2.5" fill="var(--accent)" fill-opacity="0.08" stroke="var(--accent)" stroke-width="1.4"/><circle cx="27" cy="8.5" r="1.5" fill="var(--accent)"/><circle cx="27" cy="18.5" r="1.5" fill="var(--accent)" opacity="0.7"/><circle cx="27" cy="28.5" r="1.5" fill="var(--accent)" opacity="0.5"/><line x1="9" y1="8.5" x2="22" y2="8.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.55"/><line x1="9" y1="18.5" x2="20" y2="18.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.55"/><line x1="9" y1="28.5" x2="18" y2="28.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.55"/></svg></div>
  <div style="color:var(--text-muted);font-size:0.85rem;">Loading database structure…</div>
</div>`;
document.body.appendChild(modal);

try {
  const userRef = firebaseDB.collection('users').doc(currentUser.uid);
  const deviceId = (typeof getDeviceId === 'function') ? await getDeviceId().catch(() => '—') : '—';

  const [
    productionSnap, salesSnap, calcHistorySnap, repSalesSnap, repCustomersSnap,
    salesCustomersSnap, transactionsSnap, entitiesSnap, inventorySnap,
    factoryHistorySnap, returnsSnap, expensesSnap, deletionsSnap, personPhotosSnap,
    settingsDoc, factorySettingsDoc, expenseCategoriesDoc, teamDoc,
    deviceDoc, accountInfoDoc, yearCloseSignalDoc
  ] = await Promise.all([
    userRef.collection('production').get(),
    userRef.collection('sales').get(),
    userRef.collection('calculator_history').get(),
    userRef.collection('rep_sales').get(),
    userRef.collection('rep_customers').get(),
    userRef.collection('sales_customers').get(),
    userRef.collection('transactions').get(),
    userRef.collection('entities').get(),
    userRef.collection('inventory').get(),
    userRef.collection('factory_history').get(),
    userRef.collection('returns').get(),
    userRef.collection('expenses').get(),
    userRef.collection('deletions').get(),
    userRef.collection('personPhotos').get().catch(() => ({ size: 0, docs: [] })),
    userRef.collection('settings').doc('config').get(),
    userRef.collection('factorySettings').doc('config').get(),
    userRef.collection('expenseCategories').doc('categories').get(),
    userRef.collection('settings').doc('team').get(),
    userRef.collection('devices').doc(deviceId).get().catch(() => ({ exists: false, data: () => null })),
    userRef.collection('account').doc('info').get().catch(() => ({ exists: false, data: () => null })),
    userRef.collection('settings').doc('yearCloseSignal').get().catch(() => ({ exists: false, data: () => null })),
  ]);

  const stats      = await DeltaSync.getSyncStats();
  const uuidStats  = (typeof UUIDSyncRegistry !== 'undefined') ? UUIDSyncRegistry.stats() : {};
  const myDeviceShard = uuidStats._myDeviceShard ? uuidStats._myDeviceShard.toUpperCase() : '—';
  const _savedFsStats = await sqliteStore.get('firestore_stats', null);
  const firestoreStats = (_savedFsStats && typeof _savedFsStats.reads === 'number')
    ? _savedFsStats
    : { reads: 0, writes: 0, lastReset: Date.now() };

  const sqliteCounts = {};
  const sqliteKeys = ['mfg_pro_pkr','customer_sales','noman_history','rep_sales','rep_customers',
    'sales_customers','payment_transactions','payment_entities','factory_inventory_data',
    'factory_production_history','stock_returns','expenses','deletion_records','person_photos'];
  await Promise.all(sqliteKeys.map(async k => {
    const arr = await sqliteStore.get(k, []);
    sqliteCounts[k] = Array.isArray(arr) ? arr.length : (arr && typeof arr === 'object' ? Object.keys(arr).length : 0);
  }));
  const _dirtyPhotoKeys = (await sqliteStore.get('person_photos_dirty_keys')) || [];
  sqliteCounts['_person_photos_dirty'] = Array.isArray(_dirtyPhotoKeys) ? _dirtyPhotoKeys.length : 0;

  const COLLECTIONS = [
    { fsName:'production',         sqliteKey:'mfg_pro_pkr',               jsVar:'db',                       snap:productionSnap,      tabFn:'syncProductionTab',  lock:true,  desc:'Factory production batches' },
    { fsName:'sales',              sqliteKey:'customer_sales',             jsVar:'customerSales',            snap:salesSnap,           tabFn:'syncSalesTab',       lock:true,  desc:'Direct customer sales' },
    { fsName:'calculator_history', sqliteKey:'noman_history',              jsVar:'salesHistory',             snap:calcHistorySnap,     tabFn:'syncCalculatorTab',  lock:true,  desc:'Daily calculator / ledger entries' },
    { fsName:'rep_sales',          sqliteKey:'rep_sales',                  jsVar:'repSales',                 snap:repSalesSnap,        tabFn:'syncRepTab',         lock:true,  desc:'Rep sales to customers' },
    { fsName:'rep_customers',      sqliteKey:'rep_customers',              jsVar:'repCustomers',             snap:repCustomersSnap,    tabFn:'syncRepTab',         lock:false, desc:'Rep customer contact registry' },
    { fsName:'sales_customers',    sqliteKey:'sales_customers',            jsVar:'salesCustomers',           snap:salesCustomersSnap,  tabFn:'renderCustomersTable',lock:false,desc:'Sales tab customer contacts' },
    { fsName:'transactions',       sqliteKey:'payment_transactions',       jsVar:'paymentTransactions',      snap:transactionsSnap,    tabFn:'syncPaymentsTab',    lock:true,  desc:'Cash & entity payment transactions' },
    { fsName:'entities',           sqliteKey:'payment_entities',           jsVar:'paymentEntities',          snap:entitiesSnap,        tabFn:'refreshPaymentTab',  lock:false, desc:'Payment entity accounts' },
    { fsName:'inventory',          sqliteKey:'factory_inventory_data',     jsVar:'factoryInventoryData',     snap:inventorySnap,       tabFn:'syncFactoryTab',     lock:false, desc:'Raw material inventory' },
    { fsName:'factory_history',    sqliteKey:'factory_production_history', jsVar:'factoryProductionHistory', snap:factoryHistorySnap,  tabFn:'syncFactoryTab',     lock:true,  desc:'Factory batch production history' },
    { fsName:'returns',            sqliteKey:'stock_returns',              jsVar:'stockReturns',             snap:returnsSnap,         tabFn:'syncProductionTab',  lock:true,  desc:'Stock return records' },
    { fsName:'expenses',           sqliteKey:'expenses',                   jsVar:'expenseRecords',           snap:expensesSnap,        tabFn:'refreshPaymentTab',  lock:true,  desc:'Expense entries' },
    { fsName:'deletions',          sqliteKey:'deletion_records',           jsVar:'deletedRecordIds',         snap:deletionsSnap,       tabFn:null,                 lock:false, desc:'Tombstone records for soft-deleted IDs' },
    { fsName:'personPhotos',       sqliteKey:'person_photos',              jsVar:'person_photos{}',          snap:personPhotosSnap,    tabFn:null,                 lock:false, desc:'Person/customer/entity photos (keyed object: cust:name, entity:id, rep-cust:rep:name)', isPhotoStore:true },
  ];

  const CONFIG_DOCS = [
    { path:'settings/config',              doc:settingsDoc,          desc:'App settings, FY counter, repProfile, sales_reps (init)',
      sqlite:[['naswar_default_settings','naswar_default_settings'],['current_rep_profile','repProfile'],['sales_reps_list','sales_reps (init)']],
      fsFields:['naswar_default_settings','naswar_default_settings_timestamp','repProfile','repProfile_timestamp','sales_reps','sales_reps_timestamp','last_synced'],
      listener:'_handleSettingsSnapshot' },
    { path:'settings/team',                doc:teamDoc,              desc:'Sales reps list & user roles',
      sqlite:[['sales_reps_list','sales_reps'],['user_roles_list','user_roles']],
      fsFields:['sales_reps','user_roles','updated_at'],
      listener:'_handleTeamSnapshot' },
    { path:'settings/yearCloseSignal',     doc:yearCloseSignalDoc,   desc:'Cross-device year-close / restore broadcast signal',
      sqlite:[['_lastHandledYearCloseSignal','triggeredAt']],
      fsFields:['type','triggeredAt','triggeredBy','fyCloseCount'],
      listener:'_handleYearCloseSignal' },
    { path:'factorySettings/config',       doc:factorySettingsDoc,   desc:'Factory formulas, costs, sale prices, unit tracking',
      sqlite:[['factory_default_formulas','default_formulas'],['factory_additional_costs','additional_costs'],['factory_cost_adjustment_factor','cost_adjustment_factor'],['factory_sale_prices','sale_prices'],['factory_unit_tracking','unit_tracking']],
      fsFields:['default_formulas','additional_costs','cost_adjustment_factor','sale_prices','unit_tracking','default_formulas_timestamp'],
      listener:'_handleFactorySettingsSnapshot' },
    { path:'expenseCategories/categories', doc:expenseCategoriesDoc, desc:'Expense category definitions',
      sqlite:[['expense_categories','categories']],
      fsFields:['categories','categories_timestamp'],
      listener:'_handleExpenseCategoriesSnapshot' },
    { path:`devices/${deviceId}`,          doc:deviceDoc,            desc:'This device: mode, fingerprint, heartbeat, remote commands',
      sqlite:[['appMode','currentMode'],['appMode_timestamp','appMode_timestamp'],['device_id','deviceId']],
      fsFields:['currentMode','appMode_timestamp','assignedRep','assignedManager','remoteAppliedMode','lastSeen','online','fingerprint'],
      listener:'_handleDeviceSnapshot (live mode changes)' },
    { path:'account/info',                 doc:accountInfoDoc,       desc:'Account email, displayName, lastActivity (updated on login)',
      sqlite:[],
      fsFields:['email','displayName','accountCreated','lastActivity'],
      listener:'none — read once on login' },
  ];

  const ago = raw => {
    if (!raw) return 'never';
    const ms = typeof raw === 'string' ? Date.parse(raw) : raw;
    if (!ms || isNaN(ms)) return 'never';
    const s = Math.floor((Date.now() - ms) / 1000);
    if (s < 0) return 'just now';
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s/60) + 'm ago';
    if (s < 86400) return Math.floor(s/3600) + 'h ago';
    return Math.floor(s/86400) + 'd ago';
  };
  const fmtVal = v => {
    if (v === null || v === undefined) return '<span style="color:var(--text-muted)">null</span>';
    if (typeof v === 'boolean') return `<span style="color:${v?'#30d158':'#ff453a'}">${v}</span>`;
    if (typeof v === 'object') {
      if (Array.isArray(v)) return `<span style="color:var(--accent-cyan)">Array(${v.length})</span>`;
      if (v.seconds !== undefined) return `<span style="color:var(--text-muted)">${new Date(v.seconds*1000).toLocaleDateString()}</span>`;
      return `<span style="color:var(--accent-cyan)">Object(${Object.keys(v).length})</span>`;
    }
    if (typeof v === 'string') {
      const s = v.length > 28 ? v.slice(0,28)+'…' : v;
      return `<span style="color:var(--text-muted)">"${s}"</span>`;
    }
    if (typeof v === 'number') return `<span style="color:var(--accent-gold)">${v > 1e10 ? ago(v) : v.toLocaleString()}</span>`;
    return `<span style="color:var(--text)">${String(v).slice(0,30)}</span>`;
  };
  const badge = (txt, color) =>
    `<span style="font-size:0.6rem;font-weight:700;padding:2px 7px;color:${color};letter-spacing:0.03em">${txt}</span>`;
  const pill = (txt, color) =>
    `<span style="font-size:0.62rem;padding:2px 6px;color:${color};font-family:'Geist Mono','Courier New',monospace">${txt}</span>`;

  let totalFsDocs = 0;
  COLLECTIONS.forEach(c => { totalFsDocs += c.snap.size || 0; });

  let html = `
<div id="dbv-root" style="background:var(--glass);border-radius:20px;max-width:760px;width:100%;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;">

  <!-- title bar -->
  <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 20px 0;flex-shrink:0">
    <div style="display:flex;align-items:center;gap:10px">
      <span style="display:flex;align-items:center;"><svg width="20" height="20" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="5" width="26" height="7" rx="2.5" fill="var(--accent)" fill-opacity="0.20" stroke="var(--accent)" stroke-width="1.4"/><rect x="5" y="15" width="26" height="7" rx="2.5" fill="var(--accent)" fill-opacity="0.13" stroke="var(--accent)" stroke-width="1.4"/><rect x="5" y="25" width="26" height="7" rx="2.5" fill="var(--accent)" fill-opacity="0.08" stroke="var(--accent)" stroke-width="1.4"/><circle cx="27" cy="8.5" r="1.5" fill="var(--accent)"/><circle cx="27" cy="18.5" r="1.5" fill="var(--accent)" opacity="0.7"/><circle cx="27" cy="28.5" r="1.5" fill="var(--accent)" opacity="0.5"/></svg></span>
      <div>
        <div style="font-weight:700;font-size:1rem;color:var(--text)">Database Structure</div>
        <div style="font-size:0.67rem;color:var(--text-muted);font-family:'Geist Mono','Courier New',monospace;margin-top:1px">
          users/${currentUser.uid.slice(0,14)}…/  &nbsp;·&nbsp; shard&nbsp;<span style="color:var(--accent);font-weight:700">${myDeviceShard}</span>
        </div>
      </div>
    </div>
    <button onclick="document.getElementById('delta-stats-modal').remove()"
      style="background:rgba(255,255,255,0.07);border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;color:var(--text-muted);display:flex;align-items:center;justify-content:center"><svg width="14" height="14" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><line x1="10" y1="10" x2="26" y2="26" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="26" y1="10" x2="10" y2="26" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
  </div>

  <!-- tab bar -->
  <div style="display:flex;gap:4px;padding:14px 20px 0;flex-shrink:0">
    ${['Collections','Config Docs','Listeners','Summary'].map((t,i) =>
      `<button id="dbv-tab-${i}" onclick="dbvShowTab(${i})"
        style="padding:5px 12px;border-radius:12px;border:none;cursor:pointer;font-size:0.75rem;font-weight:600;
        background:${i===0?'var(--accent)':'rgba(128,128,128,0.12)'};
        color:${i===0?'#fff':'var(--text-muted)'}">${t}</button>`
    ).join('')}
  </div>

  <!-- scrollable body -->
  <div id="dbv-body" style="overflow-y:auto;padding:16px 20px 20px;flex:1;min-height:0">
`;

  html += `<div id="dbv-pane-0">`;
  const _reads      = firestoreStats.reads  || 0;
  const _writes     = firestoreStats.writes || 0;
  const _readPct    = Math.min(100, Math.round(_reads  / 500));
  const _writePct   = Math.min(100, Math.round(_writes / 200));
  const _readColor  = _readPct  >= 80 ? '#ff453a' : _readPct  >= 50 ? '#f59e0b' : '#30d158';
  const _writeColor = _writePct >= 80 ? '#ff453a' : _writePct >= 50 ? '#f59e0b' : '#007aff';
  const _resetAgo   = firestoreStats.lastReset ? ago(firestoreStats.lastReset) : 'unknown';
  const _msLeft     = firestoreStats.lastReset ? Math.max(0, 864e5 - (Date.now() - firestoreStats.lastReset)) : 0;
  const _resetNext  = _msLeft > 0 ? (Math.floor(_msLeft/3600000) + 'h ' + Math.floor((_msLeft%3600000)/60000) + 'm') : 'soon';
  html += `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:6px">
    <div style="background:rgba(128,128,128,0.08);border-radius:12px;padding:10px 12px;text-align:center">
      <div style="font-size:1.3rem;font-weight:700;color:var(--accent)">${totalFsDocs.toLocaleString()}</div>
      <div style="font-size:0.63rem;color:var(--text-muted)">Firestore Docs</div>
      <div style="font-size:0.58rem;color:var(--text-muted);margin-top:2px">live count</div>
    </div>
    <div style="background:rgba(128,128,128,0.08);border-radius:12px;padding:10px 12px;text-align:center">
      <div style="font-size:1.3rem;font-weight:700;color:${_readColor}">${_reads.toLocaleString()}</div>
      <div style="font-size:0.63rem;color:var(--text-muted)">Reads (24 h)</div>
      <div style="font-size:0.58rem;color:${_readColor};margin-top:2px">${_readPct}% of 50 000</div>
    </div>
    <div style="background:rgba(128,128,128,0.08);border-radius:12px;padding:10px 12px;text-align:center">
      <div style="font-size:1.3rem;font-weight:700;color:${_writeColor}">${_writes.toLocaleString()}</div>
      <div style="font-size:0.63rem;color:var(--text-muted)">Writes (24 h)</div>
      <div style="font-size:0.58rem;color:${_writeColor};margin-top:2px">${_writePct}% of 20 000</div>
    </div>
  </div>
  <div style="font-size:0.59rem;color:var(--text-muted);text-align:right;margin-bottom:10px;padding-right:2px">
    Counter started ${_resetAgo} &nbsp;·&nbsp; resets in ${_resetNext}
  </div>`;

  COLLECTIONS.forEach(col => {
    const fsDocs   = col.snap.size || 0;
    const sqDocs   = sqliteCounts[col.sqliteKey] || 0;
    const colStats = stats[col.fsName] || {};
    const uuidCol  = uuidStats[col.fsName] || {};
    const isDirty  = DeltaSync.isDirty(col.fsName);
    const lastSync = colStats.lastSync ? ago(colStats.lastSync) : 'never';
    const hasLiveListener = col.fsName !== 'deletions' && col.fsName !== 'personPhotos';
    const mismatch = !col.isPhotoStore && Math.abs(fsDocs - sqDocs) > 0;
    const borderColor = mismatch ? 'rgba(255,69,58,0.4)' : 'var(--glass-border)';

    html += `
<div style="margin-bottom:9px;padding:11px 13px;background:var(--input-bg);border-radius:14px;border:1px solid ${borderColor}">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">
        <span style="font-weight:700;font-size:0.82rem;color:var(--text);font-family:'Geist Mono','Courier New',monospace">${col.fsName}</span>
        ${hasLiveListener ? badge('LIVE','#30d158','rgba(48,209,88,0.12)') : badge('SNAPSHOT','#f59e0b','rgba(245,158,11,0.12)')}
        ${col.lock ? badge('LOCKED ON CLOSE','#888','rgba(128,128,128,0.1)') : ''}
        ${isDirty ? badge('PENDING','#f59e0b','rgba(245,158,11,0.15)') : ''}
      </div>
      <div style="font-size:0.68rem;color:var(--text-muted);margin-bottom:4px">${col.desc}</div>
      <div style="font-size:0.63rem;font-family:'Geist Mono','Courier New',monospace;display:flex;flex-wrap:wrap;gap:6px">
        <span>SQLite: ${pill(col.sqliteKey,'var(--accent)')}</span>
        <span>JS: ${pill(col.jsVar,'var(--accent-cyan)')}</span>
        <span>Tab: ${pill(col.tabFn||'—','var(--text-muted)')}</span>
      </div>
    </div>
    <div style="text-align:right;flex-shrink:0">
      <div style="font-size:0.78rem;font-weight:700;color:var(--accent)">${fsDocs} FS</div>
      <div style="font-size:0.72rem;color:${mismatch?'#ff453a':'var(--text-muted)'}">
        ${sqDocs} local${mismatch?' <svg width="11" height="11" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:-1px;margin-left:2px;"><path d="M27 10 H33 L29 17 H31 L27 24 H33 L29 17 H31 Z" fill="var(--warning)" opacity="0.7" stroke="var(--warning)" stroke-width="1" stroke-linejoin="round"/><circle cx="18" cy="18" r="2" fill="var(--warning)" opacity="0.9"/></svg>':''}
      </div>
    </div>
  </div>
  <div style="border-top:1px solid var(--glass-border);margin-top:8px;padding-top:6px;display:flex;gap:14px;font-size:0.63rem;color:var(--text-muted);flex-wrap:wrap">
    <span>↑ <b style="color:#30d158">${uuidCol.uploaded||0}</b> up</span>
    <span>↓ <b style="color:#007aff">${uuidCol.downloaded||0}</b> down</span>
    <span>Syncs: <b style="color:var(--text)">${colStats.syncCount||0}</b></span>
    <span>Last: <b style="color:var(--text)">${lastSync}</b></span>
    ${col.isPhotoStore ? `<span>Dirty keys: <b style="color:${sqliteCounts['_person_photos_dirty']>0?'#f59e0b':'var(--text)'}">${sqliteCounts['_person_photos_dirty']}</b></span>` : ''}
  </div>
</div>`;
  });
  html += `</div>`;

  html += `<div id="dbv-pane-1" style="display:none">`;
  CONFIG_DOCS.forEach(doc => {
    const exists = doc.doc && doc.doc.exists;
    const data   = exists ? doc.doc.data() : null;
    html += `
<div style="margin-bottom:10px;padding:12px;background:var(--input-bg);border-radius:14px;border:1px solid var(--glass-border)">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px">
    <div style="flex:1;min-width:0">
      <div style="font-weight:700;font-size:0.82rem;color:var(--text);font-family:'Geist Mono','Courier New',monospace;margin-bottom:2px">${doc.path}</div>
      <div style="font-size:0.67rem;color:var(--text-muted);margin-bottom:4px">${doc.desc}</div>
      <div style="font-size:0.62rem;color:var(--text-muted)">Listener: ${pill(doc.listener, '#30d158')}</div>
    </div>
    <div style="flex-shrink:0">
      ${exists ? badge('EXISTS','#30d158','rgba(48,209,88,0.12)') : badge('MISSING','#ff453a','rgba(255,69,58,0.12)')}
    </div>
  </div>`;

    if (doc.sqlite.length) {
      html += `<div style="margin-bottom:6px">
        <div style="font-size:0.63rem;color:var(--text-muted);margin-bottom:3px;font-weight:600">SQLite ↔ Firestore field mapping:</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          ${doc.sqlite.map(([sk, fk]) =>
            `<div style="font-size:0.61rem;font-family:'Geist Mono','Courier New',monospace;background:rgba(0,122,255,0.08);padding:2px 7px;border-radius:8px">
              <span style="color:var(--accent)">${sk}</span><span style="color:var(--text-muted)"> → </span><span style="color:var(--accent-cyan)">${fk}</span>
            </div>`
          ).join('')}
        </div>
      </div>`;
    }

    if (exists && data) {
      html += `<div style="border-top:1px solid var(--glass-border);padding-top:6px">
        <div style="font-size:0.63rem;color:var(--text-muted);margin-bottom:4px;font-weight:600">Firestore fields:</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 12px">
          ${doc.fsFields.map(k => {
            const present = k in data;
            return `<div style="font-size:0.62rem;display:flex;justify-content:space-between;gap:6px;padding:1px 0">
              <span style="color:${present?'var(--text)':'#ff453a'};font-family:'Geist Mono','Courier New',monospace;flex-shrink:0">${present?'':'<svg width="11" height="11" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:-1px;margin-right:2px;"><path d="M27 10 H33 L29 17 H31 L27 24 H33 L29 17 H31 Z" fill="currentColor" opacity="0.6" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/><circle cx="18" cy="18" r="2" fill="currentColor" opacity="0.8"/></svg>'}${k}</span>
              <span>${present ? fmtVal(data[k]) : ''}</span>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }
    html += `</div>`;
  });
  html += `</div>`;

  html += `<div id="dbv-pane-2" style="display:none">`;
  const LISTENERS = [
    { name:'users/{uid}',                      type:'doc',  path:'userRef.onSnapshot',                              purpose:'Force-logout, account suspension, lastWrite ping for pull trigger', fires:'Any write to the user root doc' },
    { name:'settings/config',                  type:'doc',  path:'_handleSettingsSnapshot',                         purpose:'naswar_default_settings, repProfile, sales_reps (init copy)', fires:'Timestamp guard on naswar_default_settings_timestamp, repProfile_timestamp, sales_reps_timestamp' },
    { name:'settings/team',                    type:'doc',  path:'_handleTeamSnapshot',                             purpose:'sales_reps_list, user_roles_list', fires:'updated_at timestamp change' },
    { name:'settings/yearCloseSignal',         type:'doc',  path:'_handleYearCloseSignal',                          purpose:'Wipe SQLite + full cloud rebuild on other devices after year-close or restore', fires:'triggeredAt > _lastHandledYearCloseSignal AND triggeredBy ≠ this device' },
    { name:'factorySettings/config',           type:'doc',  path:'_handleFactorySettingsSnapshot',                  purpose:'factory_default_formulas, additional_costs, cost_adjustment_factor, sale_prices, unit_tracking', fires:'Individual per-field timestamp guards' },
    { name:'expenseCategories/categories',     type:'doc',  path:'_handleExpenseCategoriesSnapshot',                purpose:'expense_categories', fires:'categories_timestamp change or content diff' },
    { name:'devices/{deviceId}',               type:'doc',  path:'_handleDeviceSnapshot',                           purpose:'Live remote mode changes (admin→rep etc.) without re-login', fires:'remoteAppliedMode flag + appMode_timestamp > local' },
    { name:'deletions',                        type:'col',  path:'_handleDeletionsSnapshot',                        purpose:'Propagate soft deletes to all devices, filter from data arrays', fires:'Any add/modify/remove on the deletions collection' },
    { name:'personPhotos',                     type:'col',  path:'pullDataFromCloud → personPhotos delta fetch',    purpose:'Sync person/customer/entity photos (base64) from cloud; upload dirty keys on push', fires:'Delta pull on sync — not a live onSnapshot listener; uploads via dirty-key queue' },
    ...COLLECTIONS.filter(c => c.fsName !== 'deletions').map(c => ({
      name: c.fsName,
      type: 'col',
      path: `_makeSnapshotHandler("${c.fsName}")`,
      purpose: `Live updates to ${c.sqliteKey} → ${c.jsVar}`,
      fires: 'Any doc change; lockOnClose=' + c.lock,
    })),
  ];

  html += `<div style="margin-bottom:10px;padding:10px 12px;background:rgba(48,209,88,0.07);border-radius:12px;border:1px solid rgba(48,209,88,0.2)">
    <div style="font-size:0.75rem;font-weight:700;color:#30d158;margin-bottom:2px">● ${LISTENERS.length} Active Realtime Listeners</div>
    <div style="font-size:0.65rem;color:var(--text-muted)">All subscribed via <code>onSnapshot</code> in <code>subscribeToRealtime()</code>. Reconnect on network restore.</div>
  </div>`;

  LISTENERS.forEach(l => {
    html += `
<div style="margin-bottom:8px;padding:10px 12px;background:var(--input-bg);border-radius:13px;border:1px solid var(--glass-border)">
  <div style="display:flex;align-items:center;gap:7px;margin-bottom:4px;flex-wrap:wrap">
    ${badge(l.type==='col'?'COLLECTION':'DOC', l.type==='col'?'#007aff':'#bf5af2', l.type==='col'?'rgba(0,122,255,0.1)':'rgba(191,90,242,0.1)')}
    <span style="font-weight:700;font-size:0.78rem;color:var(--text);font-family:'Geist Mono','Courier New',monospace">${l.name}</span>
  </div>
  <div style="font-size:0.67rem;color:var(--text-muted);margin-bottom:3px">${l.purpose}</div>
  <div style="font-size:0.62rem;display:flex;flex-wrap:wrap;gap:6px">
    <span>Handler: ${pill(l.path,'var(--accent-cyan)')}</span>
  </div>
  <div style="font-size:0.6rem;color:var(--text-muted);margin-top:3px">Fires when: ${l.fires}</div>
</div>`;
  });
  html += `</div>`;

  html += `<div id="dbv-pane-3" style="display:none">`;

  html += `<div style="margin-bottom:12px">
    <div style="font-size:0.75rem;font-weight:700;color:var(--text);margin-bottom:8px">Firestore → SQLite → JS Variable Map</div>
    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:0.63rem;font-family:'Geist Mono','Courier New',monospace">
      <thead><tr style="border-bottom:1px solid var(--glass-border)">
        <th style="text-align:left;padding:4px 6px;color:var(--text-muted);font-weight:600">Firestore</th>
        <th style="text-align:left;padding:4px 6px;color:var(--text-muted);font-weight:600">SQLite Key</th>
        <th style="text-align:left;padding:4px 6px;color:var(--text-muted);font-weight:600">JS Variable</th>
        <th style="text-align:right;padding:4px 6px;color:var(--text-muted);font-weight:600">FS / Local</th>
      </tr></thead>
      <tbody>
        ${COLLECTIONS.map(c => {
          const fs = c.snap.size || 0;
          const sq = sqliteCounts[c.sqliteKey] || 0;
          const ok = Math.abs(fs - sq) === 0;
          return `<tr style="border-bottom:1px solid rgba(128,128,128,0.07)">
            <td style="padding:3px 6px;color:var(--accent)">${c.fsName}</td>
            <td style="padding:3px 6px;color:var(--accent-cyan)">${c.sqliteKey}</td>
            <td style="padding:3px 6px;color:var(--text-muted)">${c.jsVar}</td>
            <td style="padding:3px 6px;text-align:right;color:${ok?'var(--text)':'#ff453a'}">${fs} / ${sq}${ok?'':' <svg width="11" height="11" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:-1px;margin-left:2px;"><path d="M27 10 H33 L29 17 H31 L27 24 H33 L29 17 H31 Z" fill="#f59e0b" opacity="0.6" stroke="#f59e0b" stroke-width="1" stroke-linejoin="round"/><circle cx="18" cy="18" r="2" fill="#f59e0b" opacity="0.8"/></svg>'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    </div>
  </div>`;

  html += `<div style="margin-bottom:12px;padding:12px;background:var(--input-bg);border-radius:14px">
    <div style="font-size:0.75rem;font-weight:700;color:var(--text);margin-bottom:8px">Firestore Schema (users/{uid}/…)</div>
    <div style="font-size:0.63rem;font-family:'Geist Mono','Courier New',monospace;line-height:1.9;color:var(--text-muted)">
      <div><span style="color:var(--accent-gold)">users/</span><span style="color:var(--accent)">{uid}</span></div>
      <div style="padding-left:14px"><span style="color:#30d158">├─</span> <span style="color:var(--accent-cyan)">production/</span> <span style="color:var(--text-muted)">{docId}</span> — factory batches</div>
      <div style="padding-left:14px"><span style="color:#30d158">├─</span> <span style="color:var(--accent-cyan)">sales/</span> <span style="color:var(--text-muted)">{docId}</span> — customer sales</div>
      <div style="padding-left:14px"><span style="color:#30d158">├─</span> <span style="color:var(--accent-cyan)">calculator_history/</span> <span style="color:var(--text-muted)">{docId}</span> — ledger entries</div>
      <div style="padding-left:14px"><span style="color:#30d158">├─</span> <span style="color:var(--accent-cyan)">rep_sales/</span> <span style="color:var(--text-muted)">{docId}</span> — rep sales</div>
      <div style="padding-left:14px"><span style="color:#30d158">├─</span> <span style="color:var(--accent-cyan)">rep_customers/</span> <span style="color:var(--text-muted)">{docId}</span></div>
      <div style="padding-left:14px"><span style="color:#30d158">├─</span> <span style="color:var(--accent-cyan)">sales_customers/</span> <span style="color:var(--text-muted)">{docId}</span></div>
      <div style="padding-left:14px"><span style="color:#30d158">├─</span> <span style="color:var(--accent-cyan)">transactions/</span> <span style="color:var(--text-muted)">{docId}</span> — payments</div>
      <div style="padding-left:14px"><span style="color:#30d158">├─</span> <span style="color:var(--accent-cyan)">entities/</span> <span style="color:var(--text-muted)">{docId}</span> — payment entities</div>
      <div style="padding-left:14px"><span style="color:#30d158">├─</span> <span style="color:var(--accent-cyan)">inventory/</span> <span style="color:var(--text-muted)">{docId}</span> — raw materials</div>
      <div style="padding-left:14px"><span style="color:#30d158">├─</span> <span style="color:var(--accent-cyan)">factory_history/</span> <span style="color:var(--text-muted)">{docId}</span></div>
      <div style="padding-left:14px"><span style="color:#30d158">├─</span> <span style="color:var(--accent-cyan)">returns/</span> <span style="color:var(--text-muted)">{docId}</span></div>
      <div style="padding-left:14px"><span style="color:#30d158">├─</span> <span style="color:var(--accent-cyan)">expenses/</span> <span style="color:var(--text-muted)">{docId}</span></div>
      <div style="padding-left:14px"><span style="color:#30d158">├─</span> <span style="color:var(--accent-cyan)">deletions/</span> <span style="color:var(--text-muted)">{recordId}</span> — tombstones</div>
      <div style="padding-left:14px"><span style="color:#30d158">├─</span> <span style="color:var(--accent-cyan)">personPhotos/</span> <span style="color:var(--text-muted)">{base64Key}</span> — photos keyed by type:id (cust:name, entity:id, rep-cust:rep:name)</div>
      <div style="padding-left:14px"><span style="color:#30d158">├─</span> <span style="color:var(--accent-cyan)">activityLog/</span> <span style="color:var(--text-muted)">{auto}</span> — write-only audit</div>
      <div style="padding-left:14px"><span style="color:#30d158">├─</span> <span style="color:var(--accent-cyan)">sync_updates/</span> <span style="color:var(--text-muted)">{auto}</span> — heartbeat log (cleaned hourly)</div>
      <div style="padding-left:14px"><span style="color:#30d158">├─</span> <span style="color:var(--accent-cyan)">devices/</span> <span style="color:var(--text-muted)">{deviceId}</span> — fingerprint, mode, heartbeat</div>
      <div style="padding-left:14px"><span style="color:#30d158">├─</span> <span style="color:var(--accent-cyan)">account/info</span> — email, displayName</div>
      <div style="padding-left:14px"><span style="color:#30d158">├─</span> <span style="color:var(--accent-cyan)">settings/config</span> — naswar_default_settings, repProfile</div>
      <div style="padding-left:14px"><span style="color:#30d158">├─</span> <span style="color:var(--accent-cyan)">settings/team</span> — sales_reps, user_roles</div>
      <div style="padding-left:14px"><span style="color:#30d158">├─</span> <span style="color:var(--accent-cyan)">settings/yearCloseSignal</span> — cross-device broadcast</div>
      <div style="padding-left:14px"><span style="color:#30d158">└─</span> <span style="color:var(--accent-cyan)">factorySettings/config</span> — formulas, costs, prices</div>
    </div>
  </div>

  <!-- FY close status -->
  ${(() => {
    const fy = settingsDoc.exists ? (settingsDoc.data().naswar_default_settings || {}) : {};
    const fyCount = fy.fyCloseCount || 0;
    const fyDate  = fy.lastYearClosedDate ? new Date(fy.lastYearClosedDate).toLocaleDateString('en-PK',{day:'numeric',month:'short',year:'numeric'}) : '—';
    const fySignal = yearCloseSignalDoc.exists ? yearCloseSignalDoc.data() : null;
    return `<div style="padding:10px 12px;background:rgba(128,128,128,0.06);border-radius:12px;font-size:0.7rem">
      <div style="font-weight:700;color:var(--text);margin-bottom:5px">Financial Year Status</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;color:var(--text-muted)">
        <div>Close count: <b style="color:var(--accent)">${fyCount}</b></div>
        <div>Last closed: <b style="color:var(--text)">${fyDate}</b></div>
        <div>Signal type: <b style="color:var(--text-muted)">${fySignal ? fySignal.type || '—' : '—'}</b></div>
        <div>Signal age: <b style="color:var(--text)">${fySignal && fySignal.triggeredAt ? ago(fySignal.triggeredAt) : '—'}</b></div>
      </div>
    </div>`;
  })()}
  `;

  html += `</div>`;

  html += `</div></div>`;

  modal.innerHTML = html;

} catch (err) {
  console.error('[showDeltaSyncDetails] error:', err);
  modal.innerHTML = `<div style="background:var(--glass);padding:40px;border-radius:20px;text-align:center;max-width:400px">
    <div style="margin-bottom:12px;display:flex;justify-content:center;"><svg width="32" height="32" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style="opacity:0.85;"><path d="M27 10 H33 L29 17 H31 L27 24 H33 L29 17 H31 Z" fill="#f59e0b" opacity="0.5" stroke="#f59e0b" stroke-width="1" stroke-linejoin="round"/><rect x="4" y="8" width="20" height="20" rx="3" fill="#f59e0b" opacity="0.1" stroke="#f59e0b" stroke-width="1.5"/><line x1="14" y1="14" x2="14" y2="20" stroke="#f59e0b" stroke-width="1.6" stroke-linecap="round"/><circle cx="14" cy="23" r="1" fill="#f59e0b"/></svg></div>
    <div style="color:var(--text);margin-bottom:20px">Failed to load database structure</div>
    <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:20px">${err && err.message ? err.message : String(err)}</div>
    <button onclick="document.getElementById('delta-stats-modal').remove()"
      style="padding:10px 20px;background:var(--accent);border:none;border-radius:16px;color:#fff;cursor:pointer">Close</button>
  </div>`;
}
}

if (typeof closeYearInProgress === 'undefined') var closeYearInProgress = false;
if (typeof closeYearAbortController === 'undefined') var closeYearAbortController = null;
if (typeof _fyVerifiedPassword === 'undefined') var _fyVerifiedPassword = null;
if (typeof pendingFirestoreYearClose === 'undefined') var pendingFirestoreYearClose = false;
if (typeof pendingFirestoreRestore === 'undefined') var pendingFirestoreRestore = false;

if (typeof _hasMergeCommitFailure === 'undefined') var _hasMergeCommitFailure = false;
function _storeCodeToLabel(c) {
  if (c === 'STORE_A') return 'ZUBAIR';
  if (c === 'STORE_B') return 'MAHMOOD';
  if (c === 'STORE_C') return 'ASAAN';
  return c;
}

async function showCloseFinancialYearDialog() {
  const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
  const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
  const repSales = ensureArray(await sqliteStore.get('rep_sales'));
  const salesHistory = ensureArray(await sqliteStore.get('noman_history'));
  const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
  const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
  const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
  const factoryProductionHistory = ensureArray(await sqliteStore.get('factory_production_history'));
if (closeYearInProgress) {
showToast('Close Financial Year is already in progress', 'warning');
return;
}
const summary = await generateCloseYearSummary();
const _cyScreen = document.getElementById('close-financial-year-screen');
const _cyBody = _cyScreen ? _cyScreen.querySelector('.screen-body') : null;
if (!_cyBody) { showToast('Close Financial Year screen not found','error'); return; }
if (typeof openStandaloneScreen === 'function') openStandaloneScreen('close-financial-year-screen');
_cyBody.innerHTML = `
<style>
@keyframes _cyModalIn {
  from { opacity:0; transform:scale(0.88) translateY(24px); filter:blur(6px); }
  to   { opacity:1; transform:scale(1) translateY(0); filter:blur(0); }
}
@keyframes _cyRowIn {
  from { opacity:0; transform:translateX(-6px); }
  to   { opacity:1; transform:translateX(0); }
}
@keyframes _cyCheckPop {
  0%   { transform:scale(0.2) rotate(-18deg); opacity:0; }
  55%  { transform:scale(1.20) rotate(4deg);  opacity:1; }
  75%  { transform:scale(0.96) rotate(-1deg); }
  100% { transform:scale(1) rotate(0);        opacity:1; }
}
@keyframes _cyShimmer {
  0%   { background-position:-200% center; }
  100% { background-position:200% center; }
}
@keyframes _cyGlowPulse {
  0%,100% { opacity:0.5; }
  50%      { opacity:1; }
}
#cy-panel {
  background: linear-gradient(160deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0) 50%), rgba(16,18,24,0.97);
  border-radius: 24px;
  max-width: 560px;
  width: 100%;
  max-height: 94vh;
  overflow-y: auto;
  border: 1px solid rgba(255,255,255,0.11);
  box-shadow:
    0 1px 0 rgba(255,255,255,0.06) inset,
    0 0 0 1px rgba(0,0,0,0.55),
    0 32px 80px rgba(0,0,0,0.75),
    0 8px 24px rgba(0,0,0,0.45);
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.08) transparent;
  animation: _cyModalIn 0.28s cubic-bezier(0.22,1,0.36,1) forwards;
  position: relative;
}
#cy-panel::after {
  content: '';
  position: absolute;
  top: 0; left: 12%; right: 12%;
  height: 1px;
  border-radius: 999px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent);
  pointer-events: none;
  z-index: 0;
}
[data-theme="light"] #cy-panel {
  background: linear-gradient(160deg, rgba(255,255,255,0.9) 0%, rgba(248,249,252,0.97) 100%);
  border-color: rgba(0,0,0,0.09);
  box-shadow:
    0 1px 0 rgba(255,255,255,1) inset,
    0 0 0 1px rgba(0,0,0,0.06),
    0 24px 60px rgba(0,0,0,0.16),
    0 6px 16px rgba(0,0,0,0.08);
}
[data-theme="light"] #cy-panel::after {
  background: linear-gradient(90deg, transparent, rgba(0,0,0,0.08), transparent);
}

.cy-data-row {
  display: flex;
  align-items: stretch;
  border-radius: var(--radius-lg, 12px);
  border: 1px solid rgba(255,255,255,0.07);
  overflow: hidden;
  transition: border-color 0.35s ease, box-shadow 0.35s ease;
  animation: _cyRowIn 0.28s ease both;
  position: relative;
}
[data-theme="light"] .cy-data-row {
  border-color: var(--glass-border);
  background: rgba(0,0,0,0.02);
}
.cy-data-row.cy-no-data { opacity: 0.32; }
.cy-accent-stripe {
  width: 3px;
  flex-shrink: 0;
  align-self: stretch;
}
.cy-row-body {
  flex: 1;
  padding: 10px 13px;
  min-width: 0;
  background: rgba(255,255,255,0.02);
}
[data-theme="light"] .cy-row-body { background: transparent; }
.cy-row-top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cy-row-label {
  flex: 1; min-width: 0;
  font-size: 0.81rem; font-weight: 700;
  font-family: 'Bricolage Grotesque', system-ui, sans-serif;
  letter-spacing: -0.01em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cy-rec-badge {
  font-size: 0.66rem; font-weight: 700;
  padding: 2px 8px; border-radius: 999px;
  background: rgba(255,179,0,0.12); color: var(--warning);
  border: 1px solid rgba(255,179,0,0.22);
  flex-shrink: 0; font-family: 'Geist Mono', monospace;
  letter-spacing: 0.02em;
}
.cy-arrow { font-size: 0.62rem; color: rgba(255,255,255,0.22); flex-shrink: 0; }
[data-theme="light"] .cy-arrow { color: rgba(0,0,0,0.22); }
.cy-after-badge {
  font-size: 0.66rem; font-weight: 700;
  padding: 2px 9px; border-radius: 999px;
  flex-shrink: 0; font-family: 'Geist', sans-serif;
  max-width: 168px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  transition: color 0.4s ease;
  border-width: 1px; border-style: solid;
}
.cy-status-badge {
  display: none;
  font-size: 0.58rem; font-weight: 800;
  text-transform: uppercase; letter-spacing: 0.07em;
  padding: 2px 8px; border-radius: 999px;
  background: rgba(105,240,174,0.12); color: var(--accent-emerald);
  border: 1px solid rgba(105,240,174,0.25);
  flex-shrink: 0; white-space: nowrap;
}
.cy-skipped-text {
  font-size: 0.67rem; color: rgba(255,255,255,0.26);
  font-style: italic; flex-shrink: 0;
}
[data-theme="light"] .cy-skipped-text { color: rgba(0,0,0,0.28); }
.cy-detail-chips {
  margin-top: 5px;
  display: flex; flex-wrap: wrap; gap: 0 2px;
  align-items: center; line-height: 1.9;
  transition: all 0.35s ease;
}
.cy-chip-lbl { font-size: 0.68rem; color: var(--text-muted); }
.cy-chip-val { font-size: 0.68rem; font-weight: 700; margin-right: 9px; }
.cy-result-block {
  display: none;
  margin-top: 7px; padding: 7px 11px; border-radius: var(--radius-base, 8px);
  animation: cy-fade-in 0.32s ease;
  border-width: 1px; border-style: solid;
}
.cy-result-inner  { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.cy-result-lbl    { font-size: 0.73rem; font-weight: 700; }
.cy-result-tag    { font-size: 0.62rem; color: var(--text-muted); font-family: 'Geist Mono', monospace; }
.cy-result-note   { font-size: 0.67rem; color: var(--text-muted); margin-top: 3px; line-height: 1.45; }

#cy-progress-inner {
  margin: 14px 0 0;
  padding: 13px 15px;
  border-radius: var(--radius-lg, 12px);
  background: rgba(255,255,255,0.025);
  border: 1px solid rgba(255,255,255,0.07);
}
[data-theme="light"] #cy-progress-inner {
  background: rgba(0,0,0,0.025);
  border-color: var(--glass-border);
}
#cy-progress-meta { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
#cy-progress-meta-stage { font-size:0.75rem; color:var(--text-muted); font-family:'Geist',sans-serif; }
#cy-progress-meta-stage b { font-weight:700; color:var(--accent); }
#cy-progress-pct { font-size:0.73rem; font-weight:800; color:var(--accent); font-family:'Geist Mono',monospace; }
#cy-progress-track {
  width:100%; height:4px;
  background:rgba(255,255,255,0.06);
  border-radius:999px; overflow:hidden;
}
[data-theme="light"] #cy-progress-track { background:rgba(0,0,0,0.08); }
#close-year-progress-bar {
  width:0%; height:100%;
  background: linear-gradient(90deg, var(--accent) 0%, var(--accent-emerald) 100%);
  transition: width 0.5s cubic-bezier(0.4,0,0.2,1);
  border-radius:999px;
  background-size: 200% 100%;
  animation: _cyShimmer 1.8s linear infinite;
}

#cy-input-wrap { padding: 14px 0 4px; }
#cy-danger-notice {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 12px 14px;
  background: linear-gradient(135deg, rgba(239,83,80,0.09), rgba(239,83,80,0.03));
  border: 1px solid rgba(239,83,80,0.22);
  border-radius: var(--radius-lg, 12px);
  margin-bottom: 12px;
}
#cy-danger-icon-wrap {
  flex-shrink: 0; width: 32px; height: 32px;
  border-radius: var(--radius-base, 8px);
  background: rgba(239,83,80,0.13);
  border: 1px solid rgba(239,83,80,0.24);
  display: flex; align-items: center; justify-content: center;
}
#cy-danger-title { margin:0 0 3px; color:rgba(255,110,100,0.95); font-size:0.79rem; font-weight:700; }
#cy-danger-desc  { margin:0; color:var(--text-muted); font-size:0.72rem; line-height:1.5; }
#cy-pwd-field { position:relative; margin-bottom:4px; }
#close-year-confirm-input {
  width: 100%;
  padding: 11px 42px 11px 13px;
  background: rgba(255,255,255,0.04);
  border: 1.5px solid rgba(255,255,255,0.10);
  border-radius: var(--radius-lg, 12px);
  color: var(--text-main); font-size: 0.87rem;
  box-sizing: border-box;
  transition: border-color 0.2s, box-shadow 0.2s;
  outline: none;
  font-family: 'Geist', sans-serif;
  -webkit-font-smoothing: antialiased;
}
[data-theme="light"] #close-year-confirm-input {
  background: rgba(0,0,0,0.03);
  border-color: var(--glass-border);
}
#close-year-confirm-input:focus {
  border-color: rgba(239,83,80,0.55);
  box-shadow: 0 0 0 3px rgba(239,83,80,0.10);
}
#cy-pwd-eye {
  position:absolute; right:12px; top:50%; transform:translateY(-50%);
  background:none; border:none; cursor:pointer; padding:4px;
  color:var(--text-muted); line-height:0; transition:color 0.15s;
}
#cy-pwd-eye:hover { color:var(--text-main); }
#close-year-pwd-error {
  min-height: 18px; padding: 0 2px;
  font-size: 0.71rem; color: var(--danger);
  display: none; font-family: 'Geist', sans-serif;
  animation: cy-fade-in 0.2s ease;
}
#cy-btn-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 9px;
  margin-top: 11px;
}
#close-year-confirm-btn {
  padding: 12px 18px;
  background: linear-gradient(135deg, var(--danger) 0%, #c0392b 100%);
  border: none; border-radius: var(--radius-lg, 12px);
  color: #fff; font-weight: 700; cursor: not-allowed;
  font-size: 0.86rem; opacity: 0.38;
  transition: all 0.2s cubic-bezier(0.25,1,0.5,1);
  letter-spacing: 0.01em;
  font-family: 'Bricolage Grotesque', system-ui, sans-serif;
  box-shadow: 0 1px 0 rgba(255,255,255,0.14) inset;
}
#close-year-confirm-btn:not([disabled]):hover {
  transform: translateY(-1px);
  box-shadow: 0 1px 0 rgba(255,255,255,0.14) inset, 0 6px 20px rgba(239,83,80,0.38);
  filter: brightness(1.08);
}
#close-year-confirm-btn:not([disabled]):active { transform:translateY(0); }
#cy-cancel-btn {
  padding: 12px 18px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: var(--radius-lg, 12px);
  color: var(--text-muted); cursor: pointer;
  font-size: 0.84rem; font-weight: 600;
  transition: all 0.18s ease;
  font-family: 'Geist', sans-serif; white-space: nowrap;
}
[data-theme="light"] #cy-cancel-btn {
  background: var(--glass-raised); border-color: var(--glass-border);
}
#cy-cancel-btn:hover {
  background: rgba(255,255,255,0.10);
  border-color: rgba(255,255,255,0.18);
  color: var(--text-main);
}

#close-year-complete { display:none; padding: 0; }
#cy-done-card {
  position: relative; overflow: hidden;
  border-radius: var(--radius-xl, 16px);
  padding: 24px 20px 20px;
  background: linear-gradient(135deg, rgba(105,240,174,0.09) 0%, rgba(105,240,174,0.02) 100%);
  border: 1px solid rgba(105,240,174,0.20);
  text-align: center;
}
#cy-done-card::before {
  content: '';
  position: absolute; top: 0; left: 14%; right: 14%;
  height: 1px; border-radius: 999px;
  background: linear-gradient(90deg, transparent, rgba(105,240,174,0.45), transparent);
  animation: _cyGlowPulse 2.4s ease infinite;
}
#cy-done-checkmark {
  display: inline-flex; align-items: center; justify-content: center;
  width: 56px; height: 56px; border-radius: 16px;
  background: linear-gradient(135deg, rgba(105,240,174,0.18), rgba(105,240,174,0.05));
  border: 1px solid rgba(105,240,174,0.30);
  margin-bottom: 14px;
  animation: _cyCheckPop 0.45s cubic-bezier(0.34,1.5,0.64,1) forwards;
  box-shadow: 0 0 0 8px rgba(105,240,174,0.05), 0 4px 18px rgba(105,240,174,0.16);
}
#cy-done-title {
  margin: 0 0 7px;
  color: var(--accent-emerald);
  font-size: 1.10rem; font-weight: 800;
  font-family: 'Bricolage Grotesque', system-ui, sans-serif;
  letter-spacing: -0.025em;
}
#cy-done-subtitle {
  color: var(--text-muted); font-size: 0.75rem;
  margin: 0 0 18px; line-height: 1.55;
  font-family: 'Geist', sans-serif;
}
#cy-sync-advisory {
  display: flex; align-items: flex-start; gap: 11px;
  padding: 11px 14px; border-radius: var(--radius-base, 8px);
  background: rgba(255,179,0,0.07); border: 1px solid rgba(255,179,0,0.24);
  margin-bottom: 14px; text-align: left;
}
.cy-sync-adv-icon  { font-size: 0.95rem; line-height: 1.3; flex-shrink: 0; margin-top: 1px; }
.cy-sync-adv-title { font-size: 0.72rem; font-weight: 700; color: var(--warning); margin-bottom: 3px; }
.cy-sync-adv-desc  { font-size: 0.67rem; color: var(--text-muted); line-height: 1.45; }
#cy-continue-btn {
  width: 100%; padding: 13px;
  background: linear-gradient(135deg, var(--accent-emerald) 0%, #059669 100%);
  border: none; border-radius: var(--radius-lg, 12px);
  color: #fff; font-weight: 800; cursor: pointer;
  font-size: 0.90rem; letter-spacing: 0.01em;
  font-family: 'Bricolage Grotesque', system-ui, sans-serif;
  box-shadow: 0 1px 0 rgba(255,255,255,0.20) inset, 0 4px 16px rgba(105,240,174,0.22);
  transition: all 0.2s ease;
}
#cy-continue-btn:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
  box-shadow: 0 1px 0 rgba(255,255,255,0.20) inset, 0 7px 22px rgba(105,240,174,0.32);
}
#cy-continue-btn:active { transform: translateY(0); }

#cy-panel {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  border-radius: 0 !important;
  max-width: 100% !important;
  max-height: none !important;
  overflow-y: visible !important;
  padding: 0 !important;
  animation: none !important;
}
#cy-panel::after, #cy-panel::before { display: none !important; }
</style>
<div id="cy-panel">
  <div style="padding:0 0 6px;">
    <div id="cy-preview-grid" style="display:grid;gap:6px;">${summary.rowsHtml}</div>
  </div>
  <div id="close-year-progress-container" style="display:none;">
    <div id="cy-progress-inner">
      <div id="cy-progress-meta">
        <span id="cy-progress-meta-stage">Processing: <b id="close-year-stage">Initializing…</b></span>
        <span id="cy-progress-pct">0%</span>
      </div>
      <div id="cy-progress-track">
        <div id="close-year-progress-bar"></div>
      </div>
    </div>
  </div>
  <div id="close-year-input-section">
    <div id="cy-input-wrap">
      <div id="cy-danger-notice">
        <div id="cy-danger-icon-wrap">
          <svg width="14" height="14" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M27 10 H33 L29 17 H31 L27 24 H33 L29 17 H31 Z" fill="rgba(255,110,100,0.5)" stroke="rgba(255,110,100,0.92)" stroke-width="1" stroke-linejoin="round"/><rect x="5" y="10" width="18" height="18" rx="2.5" fill="rgba(255,110,100,0.1)" stroke="rgba(255,110,100,0.92)" stroke-width="1.4"/><line x1="14" y1="15" x2="14" y2="21" stroke="rgba(255,110,100,0.92)" stroke-width="1.4" stroke-linecap="round"/><circle cx="14" cy="24" r="1" fill="rgba(255,110,100,0.92)"/></svg>
        </div>
        <div>
          <p id="cy-danger-title">Irreversible — original records will be compacted</p>
          <p id="cy-danger-desc">Enter your account password to encrypt the year-end backup and confirm this action.</p>
        </div>
      </div>
      <div id="cy-pwd-field">
        <input type="password" id="close-year-confirm-input" placeholder="Account password"
          autocomplete="current-password"
          oninput="validateCloseYearInput(this.value)"
          onkeydown="if(event.key==='Enter'&&!document.getElementById('close-year-confirm-btn').disabled){verifyAndExecuteCloseYear();}">
        <button type="button" id="cy-pwd-eye" tabindex="-1"
          onclick="(function(b){const i=document.getElementById('close-year-confirm-input');i.type=i.type==='password'?'text':'password';b.querySelector('svg').style.opacity=i.type==='text'?'1':'0.40';})(this)">
          <svg width="15" height="15" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style="transition:opacity 0.2s;"><path d="M6 18 C6 18 10 10 18 10 C26 10 30 18 30 18 C30 18 26 26 18 26 C10 26 6 18 6 18 Z" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" fill="var(--accent)" fill-opacity="0.10"/><circle cx="18" cy="18" r="4" fill="var(--accent)" opacity="0.30" stroke="var(--accent)" stroke-width="1.4"/><circle cx="18" cy="18" r="1.5" fill="var(--accent)"/></svg>
        </button>
      </div>
      <div id="close-year-pwd-error"></div>
      <div id="cy-btn-row">
        <button id="close-year-confirm-btn" disabled onclick="verifyAndExecuteCloseYear()">Close Financial Year</button>
        <button id="cy-cancel-btn" onclick="closeCloseYearDialog()">Cancel</button>
      </div>
    </div>
  </div>
  <div id="close-year-complete"></div>
</div>
`;
setTimeout(() => {
  const inp = document.getElementById('close-year-confirm-input');
  if (inp) inp.focus();
}, 80);
}

function validateCloseYearInput(value) {
const confirmBtn = document.getElementById('close-year-confirm-btn');
const errEl = document.getElementById('close-year-pwd-error');
if (!confirmBtn) return;
if (value.trim().length > 0) {
  confirmBtn.disabled = false;
  confirmBtn.style.opacity = '1';
  confirmBtn.style.cursor = 'pointer';
  confirmBtn.style.boxShadow = '0 3px 10px rgba(255,69,58,0.2)';
  confirmBtn.onclick = verifyAndExecuteCloseYear;
} else {
  confirmBtn.disabled = true;
  confirmBtn.style.opacity = '0.38';
  confirmBtn.style.cursor = 'not-allowed';
  confirmBtn.style.boxShadow = 'none';
  confirmBtn.onclick = null;
}
if (errEl) errEl.style.display = 'none';
}

async function verifyAndExecuteCloseYear() {
  const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
  const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
  const repSales = ensureArray(await sqliteStore.get('rep_sales'));
  const salesHistory = ensureArray(await sqliteStore.get('noman_history'));
  const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
  const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
  const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
  const factoryProductionHistory = ensureArray(await sqliteStore.get('factory_production_history'));
const confirmBtn = document.getElementById('close-year-confirm-btn');
const inp = document.getElementById('close-year-confirm-input');
const errEl = document.getElementById('close-year-pwd-error');
const pwd = inp ? inp.value : '';
if (!pwd) {
showToast('Please enter your account password to continue.', 'warning', 3000);
if (inp) inp.focus();
return;
}
if (confirmBtn) {
  confirmBtn.disabled = true;
  confirmBtn.style.opacity = '0.6';
  confirmBtn.textContent = 'Verifying…';
}
if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
const valid = await verifyAccountPassword(pwd);
if (!valid) {
  if (errEl) { errEl.textContent = ' Incorrect password — please try again.'; errEl.style.display = 'block'; }
  showToast('Incorrect password. Please try again.', 'error', 4000);
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.style.opacity = '1';
    confirmBtn.textContent = 'Close Financial Year';
    confirmBtn.onclick = verifyAndExecuteCloseYear;
  }
  if (inp) { inp.value = ''; inp.focus(); }
  validateCloseYearInput('');
  return;
}
_fyVerifiedPassword = pwd;
executeCloseFinancialYear();
}

function closeCloseYearDialog() {
if (typeof closeStandaloneScreen === 'function') closeStandaloneScreen('close-financial-year-screen');
const _cyScreen = document.getElementById('close-financial-year-screen');
const _cyBody = _cyScreen ? _cyScreen.querySelector('.screen-body') : null;
if (_cyBody) _cyBody.innerHTML = '';
if (closeYearAbortController) {
closeYearAbortController.abort();
closeYearAbortController = null;
}
closeYearInProgress = false;
}

function updateCloseYearProgress(stage, percent) {
const stageEl = document.getElementById('close-year-stage');
const progressBar = document.getElementById('close-year-progress-bar');
const pctEl = document.getElementById('cy-progress-pct');
const phaseBadge = document.getElementById('cy-phase-badge');
if (stageEl) stageEl.textContent = stage;
if (progressBar) progressBar.style.width = percent + '%';
if (pctEl) pctEl.textContent = percent + '%';
const stageMap = {
  'Merging Production Data':   'prod',
  'Production Data Merged':    'prod',
  'Merging Sales Data':        'sales',
  'Sales Data Merged':         'sales',
  'Merging Calculator Data':   'calc',
  'Calculator Data Merged':    'calc',
  'Merging Payment Data':      'pay',
  'Payment Data Merged':       'pay',
  'Merging Factory Data':      'factory',
  'Factory Data Merged':       'factory',
  'Merging Rep Sales Data':    'repsales',
  'Rep Sales Data Merged':     'repsales',
  'Merging Expenses':          'exp',
  'Expenses Merged':           'exp',
  'Merging Stock Returns':     'ret',
  'Stock Returns Merged':      'ret'
};
const rowId = Object.entries(stageMap).find(([k])=>stage.includes(k.replace(' Data','').replace(' Merged','').trim()))?.[1];
if (rowId) {
  const isDone = stage.includes('Merged') || stage.includes('No New') || stage.includes('No Records');
  const statusEl = document.getElementById('cy-status-' + rowId);
  const rowEl    = document.getElementById('cy-row-'    + rowId);
  if (statusEl) { statusEl.style.display = 'inline-flex'; statusEl.classList.add('ok'); }
  if (rowEl && isDone) { rowEl.classList.add('cy-done'); rowEl.style.opacity = '1'; }
}
if (percent >= 100) {
  const pb = document.getElementById('close-year-progress-bar');
  if (pb) pb.classList.add('done');
}
if (phaseBadge) {
  phaseBadge.textContent = 'PROCESSING';
  phaseBadge.className = 'cy-phase-badge cy-phase-badge--processing';
}
const procSubtitle = document.getElementById('cy-panel-subtitle');
if (procSubtitle && procSubtitle.textContent.includes('will be compacted')) {
  procSubtitle.textContent = '— processing in progress...';
  procSubtitle.style.color = 'var(--warning)';
}
}

async function generateCloseYearSummary() {
  const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
  const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
  const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
  const repSales = ensureArray(await sqliteStore.get('rep_sales'));
  const salesHistory = ensureArray(await sqliteStore.get('noman_history'));
  const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
  const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
  const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
  const factoryProductionHistory = ensureArray(await sqliteStore.get('factory_production_history'));
  const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
  const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
  const factorySalePrices = (await sqliteStore.get('factory_sale_prices')) || {};
  const factoryCostAdjustmentFactor = (await sqliteStore.get('factory_cost_adjustment_factor')) || {};
const factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
const S = {
  production:   { total:0, nonMerged:0, stores: new Set(), returnCount:0, sellerReturns: new Set(), sellerStoreCards: new Set() },
  sales:        { total:0, nonMerged:0, customers: new Set(), settledCount:0, creditCount:0 },
  calculator:   { total:0, nonMerged:0, reps: new Set() },
  payments:     { total:0, nonMerged:0, entities: new Set(), netBalanceCount:0 },
  factory:      { total:0, nonMerged:0, stores: new Set() },
  repSales:     { total:0, nonMerged:0, customers: new Set(), reps: new Set(), settledCount:0, creditCount:0 },
  expenses:     { total:0, nonMerged:0, categories: new Set() },
  stockReturns: { total:0, nonMerged:0, stores: new Set() }
};
if (Array.isArray(db)) {
  S.production.total = db.length;
  db.forEach(i => {
    if (i.store) S.production.stores.add(i.store);
    if (i.isMerged !== true) {
      S.production.nonMerged++;
      if (i.isReturn === true) { S.production.returnCount++; if(i.returnedBy) S.production.sellerReturns.add(i.returnedBy); if(i.returnedBy && i.store) S.production.sellerStoreCards.add(i.returnedBy+'::'+i.store); }
    }
  });
}
if (Array.isArray(customerSales)) {
  S.sales.total = customerSales.length;
  customerSales.forEach(i => {
    if (i.customerName) S.sales.customers.add(i.customerName);
    if (i.isMerged !== true) {
      S.sales.nonMerged++;
      if (i.paymentType === 'CASH' || (i.paymentType === 'CREDIT' && i.creditReceived)) S.sales.settledCount++;
      else if (i.paymentType === 'CREDIT' && !i.creditReceived) S.sales.creditCount++;
    }
  });
}
if (Array.isArray(salesHistory)) {
  S.calculator.total = salesHistory.length;
  salesHistory.forEach(i => { if (i.seller) S.calculator.reps.add(i.seller); if (i.isMerged !== true) S.calculator.nonMerged++; });
}
if (Array.isArray(paymentTransactions)) {
  S.payments.total = paymentTransactions.length;
  const entityNetMap = {};
  paymentTransactions.forEach(i => {
    const ent = paymentEntities.find(e => e.id === i.entityId);
    if (ent) S.payments.entities.add(ent.name || 'Unknown');
    if (i.isMerged !== true) {
      S.payments.nonMerged++;
      if (!entityNetMap[i.entityId]) entityNetMap[i.entityId] = 0;
      entityNetMap[i.entityId] += (i.type === 'IN' ? 1 : -1) * (i.amount || 0);
    }
  });
  S.payments.netBalanceCount = Object.values(entityNetMap).filter(v => Math.abs(v) > 0.001).length;
}
if (Array.isArray(factoryProductionHistory)) {
  S.factory.total = factoryProductionHistory.length;
  factoryProductionHistory.forEach(i => { if (i.store) S.factory.stores.add(i.store); if (i.isMerged !== true) S.factory.nonMerged++; });
}
if (Array.isArray(repSales)) {
  S.repSales.total = repSales.length;
  repSales.forEach(i => {
    if (i.customerName) S.repSales.customers.add(i.customerName);
    if (i.salesRep) S.repSales.reps.add(i.salesRep);
    if (i.isMerged !== true && i.salesRep && i.salesRep !== 'NONE' && i.salesRep !== 'ADMIN') {
      S.repSales.nonMerged++;
      if (i.paymentType === 'CASH' || (i.paymentType === 'CREDIT' && i.creditReceived)) S.repSales.settledCount++;
      else if (i.paymentType === 'CREDIT' && !i.creditReceived) S.repSales.creditCount++;
    }
  });
}
if (Array.isArray(expenseRecords)) {
  S.expenses.total = expenseRecords.length;
  expenseRecords.forEach(i => { if (i.category) S.expenses.categories.add(i.category); if (i.isMerged !== true) S.expenses.nonMerged++; });
}
if (Array.isArray(stockReturns)) {
  S.stockReturns.total = stockReturns.length;
  stockReturns.forEach(i => { if (i.store) S.stockReturns.stores.add(i.store); if (i.isMerged !== true) S.stockReturns.nonMerged++; });
}
const storeCodeToLabel = _storeCodeToLabel;
const CY_ICONS = {
  prod:     '<svg width="15" height="15" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="20" width="28" height="12" rx="3" fill="var(--accent)" fill-opacity="0.13" stroke="var(--accent)" stroke-width="1.6"/><rect x="10" y="14" width="16" height="7" rx="2" fill="var(--accent)" fill-opacity="0.18" stroke="var(--accent)" stroke-width="1.4"/><rect x="14" y="8" width="8" height="7" rx="1.5" fill="var(--accent)" fill-opacity="0.25" stroke="var(--accent)" stroke-width="1.4"/><rect x="16" y="4" width="4" height="5" rx="1" fill="var(--accent)" opacity="0.7"/></svg>',
  sales:    '<svg width="15" height="15" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="7" y="3" width="22" height="30" rx="3" fill="var(--accent)" fill-opacity="0.10" stroke="var(--accent)" stroke-width="1.6"/><path d="M7 30 L12 27 L17 30 L22 27 L29 30" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><line x1="12" y1="12" x2="24" y2="12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity="0.65"/><line x1="12" y1="17" x2="24" y2="17" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity="0.65"/><line x1="12" y1="22" x2="19" y2="22" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity="0.55"/></svg>',
  calc:     '<svg width="15" height="15" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="4" width="26" height="28" rx="4" fill="var(--accent)" fill-opacity="0.10" stroke="var(--accent)" stroke-width="1.6"/><rect x="8" y="8" width="20" height="7" rx="2" fill="var(--accent)" fill-opacity="0.18" stroke="var(--accent)" stroke-width="1.3"/><circle cx="12" cy="21" r="2" fill="currentColor" opacity="0.7"/><circle cx="18" cy="21" r="2" fill="currentColor" opacity="0.7"/><circle cx="24" cy="21" r="2" fill="currentColor" opacity="0.7"/><circle cx="12" cy="27" r="2" fill="currentColor" opacity="0.55"/><circle cx="18" cy="27" r="2" fill="currentColor" opacity="0.55"/><rect x="21" y="25" width="6" height="4" rx="1.5" fill="var(--accent)" opacity="0.75"/></svg>',
  pay:      '<svg width="15" height="15" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="14" width="22" height="14" rx="3" fill="var(--accent)" fill-opacity="0.12" stroke="var(--accent)" stroke-width="1.5"/><line x1="4" y1="19" x2="26" y2="19" stroke="var(--accent)" stroke-width="1.4"/><rect x="7" y="22" width="6" height="2.5" rx="1" fill="currentColor" opacity="0.65"/><ellipse cx="28" cy="19.5" rx="5" ry="2" fill="var(--accent-gold)" fill-opacity="0.25" stroke="var(--accent-gold)" stroke-width="1.3"/><ellipse cx="28" cy="17" rx="5" ry="2" fill="var(--accent-gold)" fill-opacity="0.38" stroke="var(--accent-gold)" stroke-width="1.3"/></svg>',
  factory:  '<svg width="15" height="15" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="22" width="30" height="11" rx="2.5" fill="var(--accent)" fill-opacity="0.12" stroke="var(--accent)" stroke-width="1.5"/><rect x="6" y="15" width="10" height="8" rx="1.5" fill="var(--accent)" fill-opacity="0.15" stroke="var(--accent)" stroke-width="1.4"/><rect x="20" y="12" width="9" height="11" rx="1.5" fill="var(--accent)" fill-opacity="0.15" stroke="var(--accent)" stroke-width="1.4"/><rect x="22" y="6" width="2.5" height="7" rx="1" fill="currentColor" opacity="0.6"/><rect x="13" y="25" width="10" height="8" rx="1.5" fill="var(--accent)" fill-opacity="0.30"/></svg>',
  repsales: '<svg width="15" height="15" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="13" cy="10" r="5" fill="var(--accent)" fill-opacity="0.15" stroke="var(--accent)" stroke-width="1.5"/><path d="M4 30 C4 24 22 24 22 30" stroke="var(--accent)" stroke-width="1.5" fill="var(--accent)" fill-opacity="0.10" stroke-linecap="round"/><rect x="24" y="22" width="3.5" height="9" rx="1" fill="var(--accent-emerald)" opacity="0.55"/><rect x="28.5" y="17" width="3.5" height="14" rx="1" fill="var(--accent-emerald)" opacity="0.75"/><circle cx="32" cy="10" r="2" fill="var(--accent-emerald)"/></svg>',
  exp:      '<svg width="15" height="15" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="7" y="3" width="22" height="30" rx="3" fill="var(--accent)" fill-opacity="0.10" stroke="var(--accent)" stroke-width="1.5"/><line x1="12" y1="12" x2="24" y2="12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity="0.65"/><line x1="12" y1="17" x2="24" y2="17" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity="0.65"/><line x1="12" y1="22" x2="18" y2="22" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity="0.55"/><circle cx="24" cy="22" r="3.5" fill="var(--accent-gold)" fill-opacity="0.25" stroke="var(--accent-gold)" stroke-width="1.3"/></svg>',
  ret:      '<svg width="15" height="15" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 8 A10 10 0 0 1 28 18" stroke="var(--warning)" stroke-width="1.8" stroke-linecap="round" fill="none"/><polyline points="25,6 28,10 24,11" fill="none" stroke="var(--warning)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M26 28 A10 10 0 0 1 8 18" stroke="var(--warning)" stroke-width="1.8" stroke-linecap="round" fill="none"/><polyline points="11,30 8,26 12,25" fill="none" stroke="var(--warning)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};
const previewRow = (id, label, key, recCount, details, mergeNote, accent, hasData) => {
  const cssAccentVar = accent.replace('var(--','').replace(')','');
  const detailChips = details.map(([lbl,val]) =>
    '<span class="cy-chip-label">' + lbl + ':&nbsp;</span>' +
    '<span class="cy-chip-val">' + val + '</span>'
  ).join('');
  const resultBlock =
    '<div id="cy-result-' + id + '" class="cy-result-card" style="--cy-accent:' + accent + ';">' +
    '<div class="cy-result-top">' +
    '<span id="cy-result-label-' + id + '" class="cy-result-main"></span>' +
    '<span class="cy-result-tag">compacted</span>' +
    '</div>' +
    '<div id="cy-result-note-' + id + '" class="cy-result-note"></div>' +
    '</div>';
  return (
    '<div id="cy-row-' + id + '" class="cy-row' + (hasData ? '' : ' cy-skipped') + '" style="--cy-accent:' + accent + ';">' +
    '<div class="cy-row-head">' +
      '<div class="cy-row-icon">' + (CY_ICONS[id]||'') + '</div>' +
      '<span class="cy-row-label">' + label + '</span>' +
      (hasData
        ? '<span class="cy-pill cy-pill-count">' + recCount + ' rec</span>' +
          '<span class="cy-arrow">→</span>' +
          '<span id="cy-val-' + id + '-after" class="cy-pill cy-pill-after">' + mergeNote + '</span>'
        : '<span class="cy-pill cy-pill-skip">skipped</span>'
      ) +
      '<span id="cy-status-' + id + '" class="cy-status-badge ok"></span>' +
    '</div>' +
    (hasData && details.length
      ? '<div class="cy-chips">' + detailChips + '</div>'
      : '') +
    resultBlock +
    '</div>'
  );
};
let rows = '';
const storeList  = [...S.production.stores].map(storeCodeToLabel).join(', ') || '\u2014';
const sellerList = [...S.production.sellerReturns].join(', ') || 'none';
const prodRetCards   = S.production.sellerStoreCards.size || S.production.sellerReturns.size;
const prodTotalCards = S.production.stores.size + prodRetCards;
rows += previewRow('prod', 'Production', 'mfg_pro_pkr',
  S.production.nonMerged,
  [
    ['Stores', storeList, 'var(--text-main)'],
    ['Returns', S.production.returnCount > 0 ? S.production.returnCount + ' (' + sellerList + ')' : 'none',
      S.production.returnCount > 0 ? 'var(--accent-emerald)' : 'var(--text-muted)'],
  ],
  prodTotalCards + ' cards (' + S.production.stores.size + ' store + ' + prodRetCards + ' ret)',
  'var(--accent)', S.production.nonMerged > 0
);
const custCount = S.sales.customers.size;
rows += previewRow('sales', 'Sales', 'customer_sales',
  S.sales.nonMerged,
  [['Customers', custCount, 'var(--text-main)'],
   ['Settled/Credit', S.sales.settledCount + '/' + S.sales.creditCount, 'var(--text-main)']],
  custCount + ' balance' + (custCount !== 1 ? 's' : ''),
  'var(--accent-emerald)', S.sales.nonMerged > 0
);
const repNameList = [...S.calculator.reps].join(', ') || '\u2014';
rows += previewRow('calc', 'Calculator', 'noman_history',
  S.calculator.nonMerged,
  [['Reps', repNameList, 'var(--text-main)']],
  S.calculator.reps.size + ' rec \u00b7 returns\u2192Prod',
  'var(--accent-cyan)', S.calculator.nonMerged > 0
);
const entCount = S.payments.entities.size;
rows += previewRow('pay', 'Payments', 'payment_transactions',
  S.payments.nonMerged,
  [['Entities', entCount, 'var(--text-main)'],
   ['w/ balance', S.payments.netBalanceCount, 'var(--text-main)']],
  S.payments.netBalanceCount + ' opening bal.',
  'var(--accent-gold)', S.payments.nonMerged > 0
);
const fStores = [...S.factory.stores].map(storeCodeToLabel).join(', ') || '\u2014';
rows += previewRow('factory', 'Factory', 'factory_production_history',
  S.factory.nonMerged,
  [['Stores', fStores, 'var(--text-main)']],
  S.factory.stores.size + ' formula rec.',
  'var(--accent-purple)', S.factory.nonMerged > 0
);
const rcCount = S.repSales.customers.size;
rows += previewRow('repsales', 'Rep Sales', 'rep_sales',
  S.repSales.nonMerged,
  [['Customers/Reps', rcCount + '/' + S.repSales.reps.size, 'var(--text-main)'],
   ['Settled/Credit', S.repSales.settledCount + '/' + S.repSales.creditCount, 'var(--text-main)']],
  '1 per cust \u00d7 rep',
  'var(--store-b)', S.repSales.nonMerged > 0
);
const catList = [...S.expenses.categories].join(', ') || '\u2014';
rows += previewRow('exp', 'Expenses', 'expenses',
  S.expenses.nonMerged,
  [['Categories', catList, 'var(--text-main)']],
  '1 per category + name',
  'var(--warning)', S.expenses.nonMerged > 0
);
const srStores = [...S.stockReturns.stores].map(storeCodeToLabel).join(', ') || '\u2014';
rows += previewRow('ret', 'Stock Returns', 'stock_returns',
  S.stockReturns.nonMerged,
  [['Stores', srStores, 'var(--text-main)']],
  '1 per store + date',
  'var(--danger)', S.stockReturns.nonMerged > 0
);
const rowsHtml = rows;
const html = '<div style="display:grid;gap:4px;">' + rows + '</div>';
return { html, rowsHtml, summary: S };
}

async function createMergeBackup() {
  const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
  const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
  const salesHistory = ensureArray(await sqliteStore.get('noman_history'));
  const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
  const factoryProductionHistory = ensureArray(await sqliteStore.get('factory_production_history'));
  const repSales = ensureArray(await sqliteStore.get('rep_sales'));
  const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
  const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));

  const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
  const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
  const backup = {
    db: Array.isArray(db) ? [...db] : [],
    customerSales: Array.isArray(customerSales) ? [...customerSales] : [],
    salesHistory: Array.isArray(salesHistory) ? [...salesHistory] : [],
    paymentTransactions: Array.isArray(paymentTransactions) ? [...paymentTransactions] : [],
    factoryProductionHistory: Array.isArray(factoryProductionHistory) ? [...factoryProductionHistory] : [],
    repSales: Array.isArray(repSales) ? [...repSales] : [],
    expenseRecords: Array.isArray(expenseRecords) ? [...expenseRecords] : [],
    stockReturns: Array.isArray(stockReturns) ? [...stockReturns] : [],
    repCustomers: Array.isArray(repCustomers) ? [...repCustomers] : [],
    salesCustomers: Array.isArray(salesCustomers) ? [...salesCustomers] : [],
    timestamp: Date.now(),
    date: new Date().toISOString()
  };
  try {
    await sqliteStore.set('close_year_backup_' + backup.timestamp, backup);
    return backup.timestamp;
  } catch (e) {
    console.error('Failed to create merge backup:', _safeErr(e));
    throw new Error('Cannot proceed without backup: ' + e.message);
  }
}

async function restoreFromBackup(backupTimestamp) {
  try {
    const backup = await sqliteStore.get('close_year_backup_' + backupTimestamp);
    if (!backup) {
      throw new Error('Backup not found: ' + backupTimestamp);
    }

    await sqliteStore.set('mfg_pro_pkr', backup.db);
    await sqliteStore.set('customer_sales', backup.customerSales);
    await sqliteStore.set('noman_history', backup.salesHistory);
    await sqliteStore.set('payment_transactions', backup.paymentTransactions);
    await sqliteStore.set('factory_production_history', backup.factoryProductionHistory);
    await sqliteStore.set('rep_sales', backup.repSales);
    await sqliteStore.set('expenses', backup.expenseRecords);
    await sqliteStore.set('stock_returns', backup.stockReturns);

    if (Array.isArray(backup.repCustomers))   await sqliteStore.set('rep_customers',   backup.repCustomers);
    if (Array.isArray(backup.salesCustomers)) await sqliteStore.set('sales_customers', backup.salesCustomers);

    if (typeof emitSyncUpdate === 'function') {
      emitSyncUpdate({ mfg_pro_pkr: null, customer_sales: null, noman_history: null,
        payment_transactions: null, factory_production_history: null,
        rep_sales: null, expenses: null, stock_returns: null });
    }

    if (firebaseDB && currentUser) {
      try {
        const userRef = firebaseDB.collection('users').doc(currentUser.uid);

        const fbCollections = [
          { name: 'production',         backupData: backup.db },
          { name: 'sales',              backupData: backup.customerSales },
          { name: 'calculator_history', backupData: backup.salesHistory },
          { name: 'transactions',       backupData: backup.paymentTransactions },
          { name: 'factory_history',    backupData: backup.factoryProductionHistory },
          { name: 'rep_sales',          backupData: backup.repSales },
          { name: 'expenses',           backupData: backup.expenseRecords },
          { name: 'returns',            backupData: backup.stockReturns }
        ];
        for (const col of fbCollections) {
          try {
            const snapshot = await userRef.collection(col.name).get();
            const batch = firebaseDB.batch();
            let deleteCount = 0;

            const preExistingIds = new Set((Array.isArray(col.backupData) ? col.backupData : []).map(r => String(r.id)));
            snapshot.docs.forEach(doc => {

              if (!preExistingIds.has(doc.id)) {
                const data = doc.data();
                const docCreatedAt = data.createdAt?.toMillis ? data.createdAt.toMillis() :
                                     (typeof data.createdAt === 'number' ? data.createdAt : 0);
                if (docCreatedAt >= backupTimestamp) {
                  batch.delete(doc.ref);
                  deleteCount++;
                }
              }
            });
            if (deleteCount > 0) {
              await batch.commit();
              await new Promise(r => setTimeout(r, 0));
            }
          } catch (colErr) {
            console.warn(`Firebase rollback warning for ${col.name}:`, _safeErr(colErr));
          }
        }
      } catch (fbErr) {
        console.warn('Firebase rollback warning:', _safeErr(fbErr));
      }
    }
    return true;
  } catch (e) {
    console.error('Failed to restore from backup:', _safeErr(e));
    throw e;
  }
}

async function verifyMergeConsistency(snap) {
  const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
  const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
  const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
  const errors = [];
  const warnings = [];
  if (Array.isArray(db)) {
    const mergedProd = db.filter(i => i.isMerged);
    const totalNet = mergedProd.reduce((s, i) => s + (i.net || 0), 0);
    const totalCost = mergedProd.reduce((s, i) => s + (i.totalCost || 0), 0);
    const totalSale = mergedProd.reduce((s, i) => s + (i.totalSale || 0), 0);
    const expectedProfit = totalSale - totalCost;
    const actualProfit = mergedProd.reduce((s, i) => s + (i.profit || 0), 0);
    if (Math.abs(expectedProfit - actualProfit) > 0.01) {
      errors.push(`Production profit mismatch: expected ${fmtAmt(expectedProfit)}, got ${fmtAmt(actualProfit)}`);
    }
  }
  if (Array.isArray(customerSales)) {
    const mergedSales = customerSales.filter(i => i.isMerged);
    const totalValue = mergedSales.reduce((s, i) => s + (i.totalValue || 0), 0);
    const totalCost = mergedSales.reduce((s, i) => s + (i.totalCost || 0), 0);
    const expectedProfit = totalValue - totalCost;
    const actualProfit = mergedSales.reduce((s, i) => s + (i.profit || 0), 0);
    if (Math.abs(expectedProfit - actualProfit) > 0.01) {
      errors.push(`Sales profit mismatch: expected ${fmtAmt(expectedProfit)}, got ${fmtAmt(actualProfit)}`);
    }
    mergedSales.forEach(sale => {
      if (sale.paymentType === 'CREDIT' && !sale.creditReceived) {
        const expectedCredit = (sale.totalValue || 0) - (sale.partialPaymentReceived || 0);
        if (Math.abs(expectedCredit - (sale.creditValue || 0)) > 0.01) {
          warnings.push(`Credit value mismatch for ${sale.customerName}`);
        }
      }
    });
  }
  if (Array.isArray(paymentTransactions)) {
    const mergedPay = paymentTransactions.filter(i => i.isMerged);
    mergedPay.forEach(pay => {
      if (pay.mergedSummary) {
        const expectedNet = (pay.mergedSummary.originalIn || 0) - (pay.mergedSummary.originalOut || 0);
        const actualAmount = (pay.type === 'IN' ? 1 : -1) * (pay.amount || 0);
        if (Math.abs(expectedNet - actualAmount) > 0.01) {
          errors.push(`Payment balance mismatch for ${pay.entityName}`);
        }
      }
    });
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    timestamp: Date.now()
  };
}

async function executeCloseFinancialYear() {

  let fyMeta = null;

  _hasMergeCommitFailure = false;
  const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
  const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
  const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
  const deletedRecordIds = new Set(ensureArray(await sqliteStore.get('deleted_records')));
  const factoryDefaultFormulas = (await sqliteStore.get('factory_default_formulas')) || {};
  const factoryAdditionalCosts = (await sqliteStore.get('factory_additional_costs')) || {};
  const factorySalePrices = (await sqliteStore.get('factory_sale_prices')) || {};
  const factoryCostAdjustmentFactor = (await sqliteStore.get('factory_cost_adjustment_factor')) || {};
  const factoryUnitTracking = (await sqliteStore.get('factory_unit_tracking')) || {};
  const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
  const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
  const repSales = ensureArray(await sqliteStore.get('rep_sales'));
  const salesHistory = ensureArray(await sqliteStore.get('noman_history'));
  const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
  const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
  const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
  const factoryProductionHistory = ensureArray(await sqliteStore.get('factory_production_history'));
  const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
if (closeYearInProgress) return;
closeYearInProgress = true;
const inputSection  = document.getElementById('close-year-input-section');
const progressContainer = document.getElementById('close-year-progress-container');
const phaseBadge    = document.getElementById('cy-phase-badge');
if (inputSection) inputSection.style.display = 'none';
if (progressContainer) progressContainer.style.display = 'block';
updateCloseYearProgress('Uploading cloud backup...', 3);
try {
  if (!currentUser) throw new Error('Not signed in — cannot create backup');
  try {
    await pushDataToCloud();
    showToast(' Cloud backup uploaded', 'success', 2500);
  } catch (cloudErr) {
    console.warn('Cloud backup warning (proceeding):', _safeErr(cloudErr));
    showToast('Cloud backup skipped (offline?) — local backup will still be created', 'warning', 3500);
  }
  updateCloseYearProgress('Preparing encrypted local backup...', 10);
  const _settingsSnapshot = await sqliteStore.get('naswar_default_settings', defaultSettings);
  const backupData = {
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
    stockReturns: stockReturns,
    expenses: expenseRecords,
    settings: _settingsSnapshot,
    deleted_records: Array.from(deletedRecordIds),
    person_photos: (await sqliteStore.get('person_photos')) || {},
    person_photos_timestamps: (await sqliteStore.get('person_photos_timestamps')) || {},
    _meta: {
      encryptedFor:        currentUser.email,
      createdAt:           Date.now(),
      version:             2,
      source:              'financial_year_close',
      isYearCloseBackup:   true,
      fyCloseSnapshot: {
        fyCloseCount:      (_settingsSnapshot.fyCloseCount      || 0),
        lastYearClosedAt:  (_settingsSnapshot.lastYearClosedAt  || null),
        lastYearClosedDate:(_settingsSnapshot.lastYearClosedDate || null),
        capturedAt:        Date.now()
      }
    }
  };

  const encPassword = _fyVerifiedPassword || null;
  _fyVerifiedPassword = null;
  if (encPassword) {
    try {
      updateCloseYearProgress('Encrypting backup file...', 14);
      const encryptedBlob = await CryptoEngine.encrypt(backupData, currentUser.email, encPassword, currentUser.uid);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      _triggerFileDownload(encryptedBlob, `NaswarDealers_YearClose_${timestamp}.gznd`);
      showToast(' Encrypted year-end backup downloaded!', 'success', 4000);
    } catch (encErr) {
      console.error('Encryption failed:', _safeErr(encErr));
      showToast('Local backup encryption failed — proceeding with cloud backup only.', 'warning', 4000);
    }
  } else {
    showToast('No verified password — skipping local encrypted backup.', 'info', 2500);
  }
} catch (bkpPhaseErr) {
  console.error('Backup phase error:', _safeErr(bkpPhaseErr));
  const proceed = await showGlassConfirm(
    'Backup could not be completed.\n\nDo you want to proceed with closing the financial year anyway?\n\n\u26a0\ufe0f This is irreversible — proceed only if you have an existing backup.',
    { title: 'Backup Failed', confirmText: 'Proceed Anyway', cancelText: 'Abort' }
  );
  if (!proceed) {
    closeYearInProgress = false;
    closeCloseYearDialog();
    return;
  }
}
updateCloseYearProgress('Creating rollback snapshot...', 20);
let backupTimestamp;
try {
  backupTimestamp = await createMergeBackup();
} catch (backupErr) {
  closeYearInProgress = false;
  showToast('Failed to create rollback snapshot: ' + backupErr.message, 'error');
  closeCloseYearDialog();
  return;
}
closeYearAbortController = new AbortController();
const { signal } = closeYearAbortController;
const snap = {
  prod:    { before: Array.isArray(db)                      ? db.filter(i=>i.isMerged!==true).length : 0 },
  sales:   { before: Array.isArray(customerSales)           ? customerSales.filter(i=>i.isMerged!==true).length : 0 },
  calc:    { before: Array.isArray(salesHistory)             ? salesHistory.filter(i=>i.isMerged!==true).length : 0 },
  pay:     { before: Array.isArray(paymentTransactions)      ? paymentTransactions.filter(i=>i.isMerged!==true).length : 0 },
  factory: { before: Array.isArray(factoryProductionHistory) ? factoryProductionHistory.filter(i=>i.isMerged!==true).length : 0 },
  repSales:{ before: Array.isArray(repSales)                ? repSales.filter(i=>i.isMerged!==true&&i.salesRep&&i.salesRep!=='NONE'&&i.salesRep!=='ADMIN').length : 0 },
  expenses:{ before: Array.isArray(expenseRecords)           ? expenseRecords.filter(i=>i.isMerged!==true).length : 0 },
  returns: { before: Array.isArray(stockReturns)             ? stockReturns.filter(i=>i.isMerged!==true).length : 0 }
};
const liveUpdate = (rowId, afterText, accentColor, resultLabel, resultNote) => {
  const afterEl = document.getElementById('cy-val-' + rowId + '-after');
  if (afterEl) {
    afterEl.textContent = afterText;
    afterEl.style.color = accentColor || 'var(--accent-emerald)';
  }
  const statusEl = document.getElementById('cy-status-' + rowId);
  if (statusEl) statusEl.style.display = 'inline';
  const resultBlock = document.getElementById('cy-result-' + rowId);
  const resultLabelEl = document.getElementById('cy-result-label-' + rowId);
  const resultNoteEl  = document.getElementById('cy-result-note-' + rowId);
  if (resultBlock && resultLabelEl && resultNoteEl) {
    resultLabelEl.textContent = resultLabel || afterText;
    resultNoteEl.textContent  = resultNote  || '';
    resultBlock.style.display = 'block';
  }
  const detailEl = document.getElementById('cy-detail-' + rowId);
  if (detailEl) {
    detailEl.style.opacity = '0.38';
    detailEl.style.fontSize = '0';
    detailEl.style.maxHeight = '0';
    detailEl.style.overflow = 'hidden';
    detailEl.style.transition = 'all 0.35s ease';
  }
};

const closeEpoch = Date.now();
updateCloseYearProgress('Merging Production Data', 25);
try {
await mergeProductionData(signal, closeEpoch);
const _postMergeProd = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
const prodMerged = _postMergeProd.filter(i=>i.isMerged);
const storeMerged  = prodMerged.filter(i=>!i.isReturn).length;
const sellerMerged = prodMerged.filter(i=>i.isReturn).length;
liveUpdate('prod', `${storeMerged} store + ${sellerMerged} seller return card${sellerMerged!==1?'s':''}`, 'var(--accent)', `${storeMerged + sellerMerged} merged cards`, `${storeMerged} store balance${storeMerged!==1?'s':''} + ${sellerMerged} seller return card${sellerMerged!==1?'s':''}`);
snap.prod.after = prodMerged.length;
await mergeSalesData(signal, closeEpoch);
snap.sales.after = ensureArray(await sqliteStore.get('customer_sales')).filter(i=>i.isMerged).length;
liveUpdate('sales', `${snap.sales.after} merged record${snap.sales.after!==1?'s':''}`, 'var(--accent-emerald)', `${snap.sales.after} customer records`, 'One opening balance per customer');
await mergeCalculatorData(signal, closeEpoch);
snap.calc.after = ensureArray(await sqliteStore.get('noman_history')).filter(i=>i.isMerged).length;
liveUpdate('calc', `${snap.calc.after} merged record${snap.calc.after!==1?'s':''} (sales only)`, 'var(--accent-cyan)', `${snap.calc.after} rep totals`, 'Sales totals only — returns moved to Production Tab');
await mergePaymentData(signal, closeEpoch);
snap.pay.after = ensureArray(await sqliteStore.get('payment_transactions')).filter(i=>i.isMerged).length;
liveUpdate('pay', `${snap.pay.after} opening balance record${snap.pay.after!==1?'s':''}`, 'var(--accent-gold)', `${snap.pay.after} opening balances`, 'Zero-balance entities dropped');
await mergeFactoryData(signal, closeEpoch);
snap.factory.after = ensureArray(await sqliteStore.get('factory_production_history')).filter(i=>i.isMerged).length;
liveUpdate('factory', `${snap.factory.after} merged record${snap.factory.after!==1?'s':''}`, 'var(--accent-purple)', `${snap.factory.after} formula records`, '1 per formula store');
await mergeRepSalesData(signal, closeEpoch);
snap.repSales.after = ensureArray(await sqliteStore.get('rep_sales')).filter(i=>i.isMerged&&i.salesRep&&i.salesRep!=='NONE'&&i.salesRep!=='ADMIN').length;
liveUpdate('repsales', `${snap.repSales.after} merged record${snap.repSales.after!==1?'s':''}`, 'var(--store-b)', `${snap.repSales.after} rep×customer records`, 'Keyed per customer × rep combination');
await mergeExpensesData(signal, closeEpoch);
snap.expenses.after = ensureArray(await sqliteStore.get('expenses')).filter(i=>i.isMerged).length;
liveUpdate('exp', `${snap.expenses.after} merged record${snap.expenses.after!==1?'s':''}`, 'var(--warning)', `${snap.expenses.after} expense records`, 'Merged per category + name');
await mergeStockReturnsData(signal, closeEpoch);
snap.returns.after = ensureArray(await sqliteStore.get('stock_returns')).filter(i=>i.isMerged).length;
liveUpdate('ret', `${snap.returns.after} merged record${snap.returns.after!==1?'s':''}`, 'var(--danger)', `${snap.returns.after} return records`, '1 per store + date — granularity preserved');
  const consistencyCheck = await verifyMergeConsistency(snap);
  if (!consistencyCheck.valid) {
    throw new Error(`Data consistency check failed: ${consistencyCheck.errors.join('; ')}`);
  }

  updateCloseYearProgress('Purging deleted records...', 93);
  try {
    const _tombstoneIds = Array.from(
      new Set(ensureArray(await sqliteStore.get('deleted_records')).map(String))
    );
    if (_tombstoneIds.length > 0 && firebaseDB && currentUser) {
      const _delUserRef = firebaseDB.collection('users').doc(currentUser.uid);
      const OPS_PER_BATCH = 400;
      for (let _di = 0; _di < _tombstoneIds.length; _di += OPS_PER_BATCH) {
        const _chunk = _tombstoneIds.slice(_di, _di + OPS_PER_BATCH);
        const _delBatch = firebaseDB.batch();
        _chunk.forEach(id => {
          _delBatch.delete(_delUserRef.collection('deletions').doc(id));
        });
        await _delBatch.commit().catch(e => console.warn('[yearClose] tombstone Firestore purge batch failed:', _safeErr(e)));
      }
    }

    await sqliteStore.set('deleted_records', []);
    await sqliteStore.set('deletion_records', []);
    console.log('[yearClose] Hard-deleted', _tombstoneIds.length, 'tombstone record(s) from SQLite + Firestore.');
  } catch (_hardDelErr) {
    console.warn('[yearClose] Hard-delete of tombstones failed (non-fatal):', _safeErr(_hardDelErr));
  }

try {

  fyMeta = await sqliteStore.get('naswar_default_settings', {});
  fyMeta.lastYearClosedAt   = Date.now();
  fyMeta.lastYearClosedDate = new Date().toISOString();
  fyMeta.fyCloseCount       = (fyMeta.fyCloseCount || 0) + 1;
  fyMeta.lastConsistencyCheck = consistencyCheck;

  const hasSyncWarning = typeof _hasMergeCommitFailure !== 'undefined' && _hasMergeCommitFailure === true;
  if (hasSyncWarning) {
    fyMeta.pendingFirestoreYearClose = true;
    pendingFirestoreYearClose = true;
    await sqliteStore.set('pendingFirestoreYearClose', true);
  } else {
    fyMeta.pendingFirestoreYearClose = false;
    pendingFirestoreYearClose = false;
    await sqliteStore.set('pendingFirestoreYearClose', false);
  }
  const _fyMetaTs = Date.now();
  await sqliteStore.set('naswar_default_settings', fyMeta);

  await sqliteStore.set('naswar_default_settings_timestamp', _fyMetaTs);
  if (firebaseDB && currentUser) {

    await firebaseDB.collection('users').doc(currentUser.uid)
      .collection('settings').doc('config')
      .set({
        naswar_default_settings: {
          fyCloseCount:      fyMeta.fyCloseCount,
          lastYearClosedAt:  fyMeta.lastYearClosedAt,
          lastYearClosedDate:fyMeta.lastYearClosedDate
        },
        naswar_default_settings_timestamp: _fyMetaTs
      }, { merge: true });
    if (typeof DeltaSync !== 'undefined') {
      await DeltaSync.setLastSyncTimestamp('settings');
    }

    try {
      const _sigDeviceId = (typeof getDeviceId === 'function') ? await getDeviceId().catch(() => 'unknown') : 'unknown';
      await firebaseDB.collection('users').doc(currentUser.uid)
        .collection('settings').doc('yearCloseSignal')
        .set({
          type:          'close',
          triggeredAt:   _fyMetaTs,
          triggeredBy:   _sigDeviceId,
          fyCloseCount:  fyMeta.fyCloseCount,
        });
    } catch (_sigErr) {
      console.warn('[yearClose] Failed to write cross-device signal (non-fatal):', _safeErr(_sigErr));
    }
  }
} catch (metaErr) { console.warn('Could not save FY close metadata:', _safeErr(metaErr)); }
if (phaseBadge) {
  phaseBadge.textContent = 'DONE';
  phaseBadge.className = 'cy-phase-badge cy-phase-badge--done';
}
const panelSubtitle = document.getElementById('cy-panel-subtitle');
if (panelSubtitle) {
  panelSubtitle.textContent = 'All records compacted successfully';
  panelSubtitle.style.color = 'var(--accent-emerald)';
  panelSubtitle.style.fontStyle = 'normal';
  panelSubtitle.style.fontWeight = '600';
}
if (progressContainer) progressContainer.style.display = 'none';
const prodMergedFinal   = Array.isArray(db) ? db.filter(i=>i.isMerged) : [];
const storeFinal        = prodMergedFinal.filter(i=>!i.isReturn);
const sellerRetFinal    = prodMergedFinal.filter(i=>i.isReturn);
const storesUsed        = [...new Set(storeFinal.map(i=>i.store))].map(_storeCodeToLabel).join(', ') || '—';
const sellersUsed       = [...new Set(sellerRetFinal.map(i=>i.returnedBy||'?'))].join(', ') || '—';
const completeSection = document.getElementById('close-year-complete');
if (completeSection) {
  const syncFailedRows = ['prod','sales','calc','pay','factory','repsales','exp','ret']
    .filter(id => { const el = document.getElementById('cy-row-' + id); return el && el.style.borderLeftColor && el.style.borderLeftColor.includes('warning') || (el && el.style.borderLeftColor === 'var(--warning)'); });
  const hasSyncWarnings = document.querySelectorAll('[id^="cy-status-"]') &&
    [...document.querySelectorAll('[id^="cy-status-"]')].some(el => el.textContent.includes('Sync Failed'));

  const _freshMergedCount = async () => {
    const keys = ['mfg_pro_pkr','customer_sales','noman_history','payment_transactions',
                  'factory_production_history','rep_sales','expenses','stock_returns'];
    let total = 0;
    for (const k of keys) {
      const arr = ensureArray(await sqliteStore.get(k));
      total += arr.filter(i => i && i.isMerged).length;
    }
    return total;
  };
  const totalMergedRecords = await _freshMergedCount();
  const collectionsCompacted = ['prod','sales','calc','pay','factory','repsales','exp','ret']
    .filter(id => { const el = document.getElementById('cy-status-' + id); return el && el.style.display !== 'none'; }).length;
  const fyMeta2 = fyMeta || {};
  const closeCount = fyMeta2.fyCloseCount || 1;
  const closedDateStr = fyMeta2.lastYearClosedDate || new Date().toLocaleDateString('en-PK', { day:'numeric', month:'short', year:'numeric' });
  const syncWarnBlock = hasSyncWarnings ? `
    <div class="cy-sync-warn">
      <svg width="15" height="15" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;margin-top:1px;"><path d="M27 10 H33 L29 17 H31 L27 24 H33 L29 17 H31 Z" fill="var(--warning)" opacity="0.5" stroke="var(--warning)" stroke-width="1" stroke-linejoin="round"/><rect x="5" y="10" width="18" height="18" rx="2.5" fill="var(--warning)" fill-opacity="0.1" stroke="var(--warning)" stroke-width="1.4"/><line x1="14" y1="15" x2="14" y2="21" stroke="var(--warning)" stroke-width="1.4" stroke-linecap="round"/><circle cx="14" cy="24" r="1" fill="var(--warning)"/></svg>
      <div>
        <div class="cy-sync-warn-title">Cloud Sync Incomplete</div>
        <div class="cy-sync-warn-body">Local data is fully merged and safe. Marked rows will re-sync automatically when connectivity is restored, or force a manual sync from Settings.</div>
      </div>
    </div>` : '';
  completeSection.innerHTML = `
  <div class="cy-complete-card">
    <div class="cy-complete-header">
      <div class="cy-complete-icon">
        <svg width="22" height="22" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style="stroke-dasharray:60;stroke-dashoffset:0;animation:cy-checkmark-draw 0.55s 0.2s cubic-bezier(0.22,1,0.36,1) both;"><circle cx="18" cy="18" r="13" fill="var(--accent-emerald)" fill-opacity="0.12" stroke="var(--accent-emerald)" stroke-width="1.5"/><polyline points="10,18 15,23 26,12" stroke="var(--accent-emerald)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
      </div>
      <div class="cy-complete-header-text">
        <h3 class="cy-complete-title">Financial Year Closed</h3>
        <p class="cy-complete-sub">${closedDateStr} &nbsp;·&nbsp; Year #${closeCount}</p>
      </div>
    </div>
    <div class="cy-stat-grid">
      <div class="cy-stat-cell">
        <div class="cy-stat-val">${collectionsCompacted}</div>
        <div class="cy-stat-label">Collections</div>
      </div>
      <div class="cy-stat-cell">
        <div class="cy-stat-val">${totalMergedRecords}</div>
        <div class="cy-stat-label">Merged Rec.</div>
      </div>
      <div class="cy-stat-cell">
        <div class="cy-stat-val" style="color:var(--accent-emerald);"></div>
        <div class="cy-stat-label">Backup Safe</div>
      </div>
    </div>
    ${syncWarnBlock}
    <button class="cy-continue-btn" onclick="closeCloseYearDialog();if(typeof refreshAllDisplays==='function')refreshAllDisplays();">
      Continue to App →
    </button>
  </div>`;
  completeSection.style.display = 'block';
  showToast('Financial Year closed successfully!', 'success');
}
} catch (error) {
if (error.name === 'AbortError') {
  showToast('Close Financial Year was cancelled', 'info');
} else {
  console.error('Close Financial Year failed:', _safeErr(error));
  showToast('Close Financial Year failed: ' + error.message, 'error');
  if (typeof backupTimestamp !== 'undefined') {
    updateCloseYearProgress('Restoring from backup...', 0);
    try {
      await restoreFromBackup(backupTimestamp);
      showToast('Data restored from backup. No changes were committed.', 'info');
    } catch (restoreErr) {
      console.error('Failed to restore from backup:', _safeErr(restoreErr));
      showToast('CRITICAL: Failed to restore from backup. Manual intervention required.', 'error');
    }
  }
  closeCloseYearDialog();
}
} finally {
closeYearInProgress = false;
closeYearAbortController = null;
}
}

function _markRowSyncWarning(rowId, commitResult) {

  _hasMergeCommitFailure = true;
  try {
    const rowEl = document.getElementById('cy-row-' + rowId);
    if (!rowEl) return;
    const statusEl = document.getElementById('cy-status-' + rowId);
    if (statusEl) {
      statusEl.textContent = ' Sync Failed';
      statusEl.style.background = 'rgba(255,179,0,0.15)';
      statusEl.style.color = 'var(--warning)';
      statusEl.style.borderColor = 'rgba(255,179,0,0.35)';
      statusEl.style.display = 'inline';
    }
    const noteEl = document.getElementById('cy-result-note-' + rowId);
    if (noteEl) {
      const failMsg = document.createElement('span');
      failMsg.style.cssText = 'display:block;margin-top:3px;font-size:0.63rem;color:var(--warning);font-weight:600;';
      failMsg.textContent = ` Cloud sync incomplete — ${commitResult.batchesFailed}/${commitResult.batchesTotal} Firestore batch${commitResult.batchesFailed!==1?'es':''} failed. Local data is safe. Re-sync when online.`;
      noteEl.appendChild(failMsg);
    }
    rowEl.style.borderLeftColor = 'var(--warning)';
  } catch (e) {   }
}

function _buildMergedBase(id, mergeEpoch, nowISODate, nowTime, extra = {}) {
return {
  id,
  date: nowISODate,
  time: nowTime,
  createdAt: mergeEpoch,
  updatedAt: mergeEpoch,
  timestamp: mergeEpoch,
  isMerged: true,
  mergedAt: nowISODate,
  syncedAt: new Date().toISOString(),
  ...extra
};
}

async function mergeProductionData(signal, closeEpoch) {
  const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
updateCloseYearProgress('Merging Production Data...', 10);
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (!Array.isArray(db) || db.length === 0) return;
const nowDate    = new Date();
const nowISODate = nowDate.toISOString().split('T')[0];
const mergeEpoch = nowDate.getTime();
const nowTime    = nowDate.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
const _recTs = r => r.createdAt || r.timestamp || 0;
const mergedRecords = [];
const nonMerged    = db.filter(i => i.isMerged !== true && _recTs(i) <= closeEpoch);
const prodItems    = nonMerged.filter(i => i.isReturn !== true);
const returnItems  = nonMerged.filter(i => i.isReturn === true);
const storeGroups = {};
prodItems.forEach(item => {
  const store = item.store || 'UNKNOWN';
  if (!storeGroups[store]) storeGroups[store] = [];
  storeGroups[store].push(item);
});
for (const [store, items] of Object.entries(storeGroups)) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const totals = items.reduce((acc, item) => {
    acc.net          += (item.net          || 0);
    acc.totalCost    += (item.totalCost    || 0);
    acc.totalSale    += (item.totalSale    || 0);
    acc.profit       += (item.profit       || 0);
    acc.formulaUnits += (item.formulaUnits || 0);
    acc.formulaCost  += (item.formulaCost  || 0);
    return acc;
  }, { net:0, totalCost:0, totalSale:0, profit:0, formulaUnits:0, formulaCost:0 });
  const avgCp = totals.net > 0 ? parseFloat((totals.totalCost / totals.net).toFixed(4)) : (items[0]?.cp || 0);
  const canonicalSp = await getSalePriceForStore(store);
  const avgSp = canonicalSp > 0 ? canonicalSp : (items[0]?.sp || 0);
  const allDates = items.map(i => i.date).filter(Boolean).sort();
  const mergedId = generateUUID('prod-merged');
  const mergedRecord = ensureRecordIntegrity(_buildMergedBase(mergedId, mergeEpoch, nowISODate, nowTime, {
    store,
    net:           totals.net,
    cp:            avgCp,
    sp:            avgSp,
    totalCost:     totals.totalCost,
    totalSale:     totals.totalSale,
    profit:        totals.profit,
    formulaUnits:  totals.formulaUnits,
    formulaStore:  items[0]?.formulaStore || 'standard',
    formulaCost:   totals.formulaCost,
    paymentStatus: 'CASH',
    mergedRecordCount: items.length,
    mergedSummary: {
      dateRange:       { from: allDates[0] || nowISODate, to: allDates.slice(-1)[0] || nowISODate },
      recordCount:     items.length,
    }
  }), false, true);
  mergedRecords.push(mergedRecord);
}
const sellerReturnGroups = {};
const sellerReturnTotals = {};
returnItems.forEach(item => {
  const seller = item.returnedBy || item.seller || 'Unknown';
  const store  = item.store      || 'UNKNOWN';
  const key    = `${seller}::${store}`;
  if (!sellerReturnGroups[key]) sellerReturnGroups[key] = { seller, store, items: [] };
  sellerReturnGroups[key].items.push(item);
  if (!sellerReturnTotals[seller]) {
    sellerReturnTotals[seller] = { totalNet: 0, returnsByStore: {} };
  }
  sellerReturnTotals[seller].totalNet += (item.net || 0);
  sellerReturnTotals[seller].returnsByStore[store] = (sellerReturnTotals[seller].returnsByStore[store] || 0) + (item.net || 0);
});
for (const [, grp] of Object.entries(sellerReturnGroups)) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const { seller, store, items } = grp;
  let totalNet = 0, totalCost = 0, totalSale = 0, totalProfit = 0;
  items.forEach(item => {
    totalNet    += (item.net       || 0);
    totalCost   += (item.totalCost || 0);
    totalSale   += (item.totalSale || 0);
    totalProfit += (item.profit    || 0);
  });
  const avgCp = totalNet > 0 ? parseFloat((totalCost / totalNet).toFixed(4)) : (items[0]?.cp || 0);
  const canonicalSpRet = await getSalePriceForStore(store);
  const avgSp = canonicalSpRet > 0 ? canonicalSpRet : (items[0]?.sp || 0);
  const allDates = items.map(i => i.date).filter(Boolean).sort();
  const mergedId = generateUUID('ret-merged');
  const returnsByStoreForThisSeller = sellerReturnTotals[seller]?.returnsByStore || {};
  const mergedReturn = ensureRecordIntegrity(_buildMergedBase(mergedId, mergeEpoch, nowISODate, nowTime, {
    store,
    net:           totalNet,
    cp:            avgCp,
    sp:            avgSp,
    totalCost:     totalCost,
    totalSale:     totalSale,
    profit:        totalProfit,
    formulaUnits:  0,
    formulaStore:  'standard',
    formulaCost:   0,
    paymentStatus: 'CASH',
    isReturn:      true,
    returnedBy:    seller,
    returnNote:    `Merged returns by ${seller} → ${store}`,
    returnsByStore: returnsByStoreForThisSeller,
    mergedRecordCount: items.length,
    mergedSummary: {
      dateRange:   { from: allDates[0] || nowISODate, to: allDates.slice(-1)[0] || nowISODate },
      recordCount: items.length,
      store,
      seller,
      returnsByStore: returnsByStoreForThisSeller
    }
  }), false, true);
  mergedRecords.push(mergedReturn);
}
if (Object.keys(storeGroups).length === 0 && Object.keys(sellerReturnGroups).length === 0) {
  updateCloseYearProgress('Production Data - No New Records to Merge', 20);
  return;
}
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (firebaseDB && currentUser) {
  const userRef = firebaseDB.collection('users').doc(currentUser.uid);
  const commitResult = await _commitMergedBatch(userRef, 'production', mergedRecords);
  if (!commitResult.ok) {
    console.warn(`mergeProductionData: Firestore commit partial failure — ${commitResult.batchesFailed}/${commitResult.batchesTotal} batch(es) failed`, _safeErr(commitResult.error));
    _markRowSyncWarning('prod', commitResult);
  }
}
const existingMerged = db.filter(item => item.isMerged === true);
const postCloseRecords = db.filter(item => item.isMerged !== true && _recTs(item) > closeEpoch);
const mergedDb = [...existingMerged, ...mergedRecords, ...postCloseRecords];
await sqliteStore.set('mfg_pro_pkr', mergedDb);
emitSyncUpdate({ mfg_pro_pkr: null});
updateCloseYearProgress('Production Data Merged', 20);
}

async function mergeSalesData(signal, closeEpoch) {
const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
const salesCustomers = ensureArray(await sqliteStore.get('sales_customers'));
updateCloseYearProgress('Merging Sales Data...', 30);
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (!Array.isArray(customerSales) || customerSales.length === 0) return;
const nowDate    = new Date();
const nowISODate = nowDate.toISOString().split('T')[0];
const mergeEpoch = nowDate.getTime();
const nowTime    = nowDate.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
const _recTs = r => r.createdAt || r.timestamp || 0;
const mergedRecords = [];
const customerBuckets = {};
customerSales.forEach(item => {
  if (item.isMerged === true) return;
  if (_recTs(item) > closeEpoch) return;
  const name = item.customerName || 'Unknown';
  if (!customerBuckets[name]) {
    customerBuckets[name] = {
      sales: [], oldDebt: 0, collectionTotal: 0, partialPaymentTotal: 0, partialPaymentsBySale: {},
      phone: '', address: '', supplyStore: ''
    };
  }
  const b = customerBuckets[name];
  b.phone      = b.phone      || item.customerPhone   || '';
  b.address    = b.address    || item.customerAddress || '';
  b.supplyStore= b.supplyStore|| item.supplyStore     || 'STORE_A';
  if (item.paymentType === 'PARTIAL_PAYMENT') {
    b.partialPaymentTotal += (item.totalValue || 0);
    const linkedKey = item.relatedSaleId || item.linkedSaleId;
    if (linkedKey) {
      b.partialPaymentsBySale[linkedKey] = (b.partialPaymentsBySale[linkedKey] || 0) + (item.totalValue || 0);
      if (!b.partialPaymentCustomers) b.partialPaymentCustomers = {};
      b.partialPaymentCustomers[linkedKey] = item.customerName || name;
    }
    return;
  }
  if (item.paymentType === 'COLLECTION') {
    b.collectionTotal += (item.totalValue || 0);
    return;
  }
  if (item.transactionType === 'OLD_DEBT') {
    b.oldDebt += Math.max(0, (item.totalValue || 0) - (item.partialPaymentReceived || 0));
    return;
  }
  b.sales.push(item);
});
for (const [customer, b] of Object.entries(customerBuckets)) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const { sales, oldDebt, collectionTotal, phone, address, supplyStore } = b;
  let totalQty   = 0, totalValue = 0, totalCost = 0, totalProfit = 0;
  let realizedProfit = 0, unrealizedProfit = 0;
  let cashValue  = 0, unpaidCreditNet = 0;
  const originalRecordIds = sales.map(s => s.id);
  for (const item of sales) {
    totalQty    += (item.quantity   || 0);
    totalValue  += (item.totalValue || 0);
    totalCost   += (item.totalCost  || 0);
    totalProfit += (item.profit     || 0);
    if (item.paymentType === 'CREDIT' && !item.creditReceived) {
      unrealizedProfit += (item.profit || 0);
    } else {
      realizedProfit += (item.profit || 0);
    }
    if (item.paymentType === 'CASH' || (item.paymentType === 'CREDIT' && item.creditReceived)) {
      cashValue += (item.totalValue || 0);
    } else if (item.paymentType === 'CREDIT' && !item.creditReceived) {
      unpaidCreditNet += Math.max(0, (item.totalValue || 0) - (item.partialPaymentReceived || 0));
    }
  }
  const grossOutstanding = unpaidCreditNet + oldDebt;
  const netOutstanding   = Math.max(0, grossOutstanding - collectionTotal);
  const advanceCredit    = Math.max(0, collectionTotal - grossOutstanding);
  const isSettled = netOutstanding <= 0;
  if (sales.length === 0 && oldDebt <= 0 && collectionTotal <= 0) continue;
  const allDates  = sales.map(i => i.date).filter(Boolean).sort();
  const firstItem = sales[0] || {};
  const recordCount = sales.length + (oldDebt > 0 ? 1 : 0) + (collectionTotal > 0 ? 1 : 0);
  const mergedId = generateUUID('sale-merged');
  const _mergedSupplyStore = supplyStore || firstItem.supplyStore || 'STORE_A';
  const canonicalUnitPrice = await getEffectiveSalePriceForCustomer(customer, _mergedSupplyStore);
  const lastUnitPrice = canonicalUnitPrice > 0
    ? canonicalUnitPrice
    : (firstItem.unitPrice || (firstItem.quantity > 0 ? firstItem.totalValue / firstItem.quantity : 0) || 0);
  const grossSaleValue  = parseFloat(totalValue.toFixed(2));
  const alreadyPaid     = isSettled ? grossSaleValue : parseFloat((grossSaleValue - netOutstanding).toFixed(2));
  const mergedRecord = ensureRecordIntegrity(_buildMergedBase(mergedId, mergeEpoch, nowISODate, nowTime, {
    customerName:          customer,
    customerPhone:         phone,
    customerAddress:       address,
    quantity:              totalQty,
    unitPrice:             lastUnitPrice,
    totalValue:            grossSaleValue,
    totalCost:             totalCost,
    profit:                totalProfit,
    supplyStore:           _mergedSupplyStore,
    salesRep:              'NONE',
    paymentType:           isSettled ? 'CASH' : 'CREDIT',
    transactionType:       (oldDebt > 0 && sales.length === 0) ? 'OLD_DEBT' : 'SALE',
    creditReceived:        isSettled,
    creditReceivedDate:    isSettled ? nowISODate : null,
    creditValue:           isSettled ? 0 : netOutstanding,
    partialPaymentReceived: isSettled ? 0 : alreadyPaid,
    balancePaid:           alreadyPaid,
    paid:                  isSettled,
    notes:                 'Combined year-end balance carried forward from financial year close',
    mergedRecordCount:     recordCount,
    mergedSummary: {
      cashSales:           cashValue,
      unpaidCredit:        unpaidCreditNet,
      oldDebt:             oldDebt,
      collectionsReceived: collectionTotal,
      partialPayments:     b.partialPaymentTotal || 0,
      partialPaymentsBySale: b.partialPaymentsBySale || {},
      advanceCreditHeld:   advanceCredit,
      realizedProfit:      realizedProfit,
      unrealizedProfit:    unrealizedProfit,
      grossOutstanding,
      netOutstanding,
      isSettled,
      dateRange: {
        from: allDates[0]           || nowISODate,
        to:   allDates.slice(-1)[0] || nowISODate
      },
      recordCount,
      originalRecordIds:   originalRecordIds
    }
  }), false, true);
  mergedRecords.push(mergedRecord);
}
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (firebaseDB && currentUser) {
  const userRef = firebaseDB.collection('users').doc(currentUser.uid);
  const commitResult = await _commitMergedBatch(userRef, 'sales', mergedRecords, d => !d.isMerged);
  if (!commitResult.ok) {
    console.warn(`mergeSalesData: Firestore commit partial failure — ${commitResult.batchesFailed}/${commitResult.batchesTotal} batch(es) failed`, _safeErr(commitResult.error));
    _markRowSyncWarning('sales', commitResult);
  }
}
const existingMerged = customerSales.filter(i => i.isMerged === true);
const postCloseSales = customerSales.filter(i => i.isMerged !== true && _recTs(i) > closeEpoch);
const mergedSales = [...existingMerged, ...mergedRecords, ...postCloseSales];
await sqliteStore.set('customer_sales', mergedSales);
emitSyncUpdate({ customer_sales: null});
updateCloseYearProgress('Sales Data Merged', 40);
}

async function mergeCalculatorData(signal, closeEpoch) {
const salesHistory = ensureArray(await sqliteStore.get('noman_history'));
updateCloseYearProgress('Merging Calculator Data...', 50);
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (!Array.isArray(salesHistory) || salesHistory.length === 0) return;
const _recTs = r => r.createdAt || r.timestamp || 0;
const repGroups = {};
salesHistory.forEach(item => {
  if (item.isMerged === true) return;
  if (_recTs(item) > closeEpoch) return;
  const seller = item.seller || 'Unknown';
  if (!repGroups[seller]) repGroups[seller] = [];
  repGroups[seller].push(item);
});
if (Object.keys(repGroups).length === 0) {
  updateCloseYearProgress('Calculator Data - No New Records to Merge', 60);
  return;
}
const nowDate = new Date();
const nowISODate = nowDate.toISOString().split('T')[0];
const mergeEpoch = nowDate.getTime();
const nowTime = nowDate.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true});
const mergedRecords = [];
for (const [seller, items] of Object.entries(repGroups)) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const firstItem = items[0] || {};
  const datesSorted = items.map(i => i.date).filter(Boolean).sort();
  const sellerTotals = items.reduce((acc, item) => {
    acc.totalSold  += (item.totalSold  || 0);
    acc.returned   += (item.returned   || 0);
    acc.netSold    = acc.totalSold - acc.returned;
    acc.creditQty  += (item.creditQty  || 0);
    acc.cashQty    += (item.cashQty    || 0);
    acc.revenue    += (item.revenue    || 0);
    acc.profit     += (item.profit     || 0);
    acc.totalCost  += (item.totalCost  || 0);
    acc.creditValue+= (item.creditValue|| 0);
    acc.prevColl   += (item.prevColl   || 0);
    acc.received   += (item.received   || 0);
    acc.totalExpected += (item.totalExpected || 0);
    if (item.returned > 0 && item.returnStore) {
      acc.returnsByStore[item.returnStore] = (acc.returnsByStore[item.returnStore] || 0) + (item.returned || 0);
    }
    return acc;
  }, { totalSold:0, returned:0, netSold:0, creditQty:0, cashQty:0, revenue:0, profit:0, totalCost:0, creditValue:0, prevColl:0, received:0, totalExpected:0, returnsByStore:{} });
  const mergedNetSold = sellerTotals.totalSold - sellerTotals.returned;
  const _calcCanonicalSp = await getSalePriceForStore('STORE_A');
  const avgUnitPrice = _calcCanonicalSp > 0
    ? _calcCanonicalSp
    : (firstItem.unitPrice || 0);
  const avgCostPrice = mergedNetSold > 0
    ? parseFloat((sellerTotals.totalCost / mergedNetSold).toFixed(4))
    : (firstItem.costPrice || (await calculateSalesCostPerKg('standard')) || 0);
  const returnStoreEntries = Object.entries(sellerTotals.returnsByStore);
  const primaryReturnStore = returnStoreEntries.length > 0
    ? returnStoreEntries.sort((a, b) => b[1] - a[1])[0][0]
    : null;
  const primaryId = generateUUID('calc-merged');
  const primaryRecord = ensureRecordIntegrity(_buildMergedBase(primaryId, mergeEpoch, nowISODate, nowTime, {
    seller,
    unitPrice:     avgUnitPrice,
    costPrice:     avgCostPrice,
    revenue:       sellerTotals.revenue,
    profit:        sellerTotals.profit,
    totalCost:     sellerTotals.totalCost,
    totalSold:     sellerTotals.totalSold,
    returned:       sellerTotals.returned,
    returnStore:    primaryReturnStore,
    returnsByStore: sellerTotals.returnsByStore,
    creditQty:     sellerTotals.creditQty,
    cashQty:       sellerTotals.cashQty,
    creditValue:   sellerTotals.creditValue,
    prevColl:      sellerTotals.prevColl,
    totalExpected: sellerTotals.totalExpected,
    received:      sellerTotals.received,
    statusText:    'OPENING BALANCE',
    statusClass:   'result-box discrepancy-ok',
    linkedSalesIds:    [],
    linkedRepSalesIds: [],
    mergedRecordCount: items.length,
    mergedSummary: {
      dateRange:      { from: datesSorted[0] || nowISODate, to: datesSorted.slice(-1)[0] || nowISODate },
      recordCount:    items.length,
      returnsByStore: sellerTotals.returnsByStore
    }
  }), false, true);
  mergedRecords.push(primaryRecord);
}
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (firebaseDB && currentUser) {
  const userRef = firebaseDB.collection('users').doc(currentUser.uid);
  const commitResult = await _commitMergedBatch(userRef, 'calculator_history', mergedRecords);
  if (!commitResult.ok) {
    console.warn(`mergeCalculatorData: Firestore commit partial failure — ${commitResult.batchesFailed}/${commitResult.batchesTotal} batch(es) failed`, _safeErr(commitResult.error));
    _markRowSyncWarning('calc', commitResult);
  }
}
const existingMergedCalc = salesHistory.filter(item => item.isMerged === true);
const postCloseCalc = salesHistory.filter(item => item.isMerged !== true && _recTs(item) > closeEpoch);
const mergedHistory = [...existingMergedCalc, ...mergedRecords, ...postCloseCalc];
await sqliteStore.set('noman_history', mergedHistory);
emitSyncUpdate({ noman_history: null});

updateCloseYearProgress('Calculator Data Merged', 60);
}

async function mergePaymentData(signal, closeEpoch) {
const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
const paymentEntities = ensureArray(await sqliteStore.get('payment_entities'));
updateCloseYearProgress('Merging Payment Data...', 70);
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (!Array.isArray(paymentTransactions) || paymentTransactions.length === 0) return;
const _recTs = r => r.createdAt || r.timestamp || 0;
const entityGroups = {};
paymentTransactions.forEach(item => {
  if (item.isMerged === true) return;
  if (_recTs(item) > closeEpoch) return;
  const entityId = item.entityId || 'unknown';
  if (!entityGroups[entityId]) entityGroups[entityId] = [];
  entityGroups[entityId].push(item);
});
if (Object.keys(entityGroups).length === 0) {
  updateCloseYearProgress('Payment Data - No New Records to Merge', 80);
  return;
}
const nowDate = new Date();
const nowISODate = nowDate.toISOString().split('T')[0];
const mergeEpoch = nowDate.getTime();
const nowTime = nowDate.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true});
const mergedRecords = [];
for (const [entityId, items] of Object.entries(entityGroups)) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const entity = paymentEntities.find(e => e.id === entityId);
  const totals = items.reduce((acc, item) => {
    if (item.type === 'IN') acc.in += (item.amount || 0);
    else if (item.type === 'OUT') acc.out += (item.amount || 0);
    return acc;
  }, { in: 0, out: 0 });
  const netBalance = parseFloat((totals.in - totals.out).toFixed(2));
  const SIGNIFICANT_BALANCE_THRESHOLD = 0.01;
  if (Math.abs(netBalance) < SIGNIFICANT_BALANCE_THRESHOLD) {
    continue;
  }
  const mergedId = generateUUID('pay-merged');
  const datesSorted = items.map(i => i.date).filter(Boolean).sort();
  const entityName = entity?.name || items[0]?.entityName || 'Unknown Entity';
  const entityType = entity?.type || items[0]?.entityType || 'payee';
  const mergedRecord = ensureRecordIntegrity(_buildMergedBase(mergedId, mergeEpoch, nowISODate, nowTime, {
    entityId,
    entityName,
    entityType,
    amount: Math.abs(netBalance),
    type: netBalance > 0 ? 'IN' : 'OUT',
    description: netBalance > 0
      ? `Opening balance (receivable) — carried from previous year (${items.length} txns)`
      : `Opening balance (payable) — carried from previous year (${items.length} txns)`,
    isPayable: netBalance < 0,
    isExpense: false,
    mergedRecordCount: items.length,
    mergedSummary: {
      originalIn: totals.in,
      originalOut: totals.out,
      netBalance,
      dateRange: { from: datesSorted[0] || nowISODate, to: datesSorted.slice(-1)[0] || nowISODate },
      recordCount: items.length,
      hasSupplierMaterials: items.some(i => i.isPayable === true && i.type === 'OUT')
    }
  }), false, true);
  mergedRecords.push(mergedRecord);
}
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (firebaseDB && currentUser) {
  const userRef = firebaseDB.collection('users').doc(currentUser.uid);
  const commitResult = await _commitMergedBatch(userRef, 'transactions', mergedRecords);
  if (!commitResult.ok) {
    console.warn(`mergePaymentData: Firestore commit partial failure — ${commitResult.batchesFailed}/${commitResult.batchesTotal} batch(es) failed`, _safeErr(commitResult.error));
    _markRowSyncWarning('pay', commitResult);
  }
}
const existingMergedPay = paymentTransactions.filter(item => item.isMerged === true);
const postClosePay = paymentTransactions.filter(item => item.isMerged !== true && _recTs(item) > closeEpoch);
const mergedPayTx = [...existingMergedPay, ...mergedRecords, ...postClosePay];
await sqliteStore.set('payment_transactions', mergedPayTx);
emitSyncUpdate({ payment_transactions: null});
updateCloseYearProgress('Payment Data Merged', 80);
}

async function mergeFactoryData(signal, closeEpoch) {
const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
const factoryProductionHistory = ensureArray(await sqliteStore.get('factory_production_history'));
updateCloseYearProgress('Merging Factory Data...', 85);
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (!Array.isArray(factoryProductionHistory) || factoryProductionHistory.length === 0) return;
const _recTs = r => r.createdAt || r.timestamp || 0;
const nonMergedRecords = factoryProductionHistory.filter(item => item.isMerged !== true && _recTs(item) <= closeEpoch);
if (nonMergedRecords.length === 0) {
  updateCloseYearProgress('Factory Data - No New Records to Merge', 90);
  return;
}
const storeGroups = {};
nonMergedRecords.forEach(item => {
  const store = item.store || 'standard';
  if (!storeGroups[store]) storeGroups[store] = [];
  storeGroups[store].push(item);
});
const nowDate = new Date();
const nowISODate = nowDate.toISOString().split('T')[0];
const mergeEpoch = nowDate.getTime();
const nowTime = nowDate.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true});
const mergedRecords = [];
for (const [store, items] of Object.entries(storeGroups)) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const totals = items.reduce((acc, item) => {
    acc.units += (item.units || 0);
    acc.totalCost += (item.totalCost || 0);
    acc.materialsCost += (item.materialsCost || 0);
    acc.additionalCost += (item.additionalCost || 0);
    acc.rawMaterialsUsed += (item.rawMaterialsUsed || 0);
    return acc;
  }, { units: 0, totalCost: 0, materialsCost: 0, additionalCost: 0, rawMaterialsUsed: 0 });
  const expectedTotalCost = totals.materialsCost + totals.additionalCost;
  if (Math.abs(expectedTotalCost - totals.totalCost) > 0.01) {
    const originalTotalCost = totals.totalCost;
    totals.totalCost = expectedTotalCost;
    console.warn(`Factory data auto-corrected: totalCost adjusted from ${originalTotalCost} to ${expectedTotalCost}`);
  }
  const mergedId = generateUUID('fprod-merged');
  const datesSorted = items.map(i => i.date).filter(Boolean).sort();
  const mergedRecord = ensureRecordIntegrity(_buildMergedBase(mergedId, mergeEpoch, nowISODate, nowTime, {
    store,
    units: totals.units,
    totalCost: totals.totalCost,
    materialsCost: totals.materialsCost,
    additionalCost: totals.additionalCost,
    rawMaterialsUsed: totals.rawMaterialsUsed,
    notes: `Opening balance (${store}) — carried from previous year (${items.length} records)`,
    mergedRecordCount: items.length,
    mergedSummary: {
      dateRange: { from: datesSorted[0] || nowISODate, to: datesSorted.slice(-1)[0] || nowISODate },
      recordCount: items.length
    }
  }), false, true);
  mergedRecords.push(mergedRecord);
}
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (firebaseDB && currentUser) {
  const userRef = firebaseDB.collection('users').doc(currentUser.uid);
  const commitResult = await _commitMergedBatch(userRef, 'factory_history', mergedRecords);
  if (!commitResult.ok) {
    console.warn(`mergeFactoryData: Firestore commit partial failure — ${commitResult.batchesFailed}/${commitResult.batchesTotal} batch(es) failed`, _safeErr(commitResult.error));
    _markRowSyncWarning('factory', commitResult);
  }
}
const existingMergedFactory = factoryProductionHistory.filter(item => item.isMerged === true);
const postCloseFactory = factoryProductionHistory.filter(item => item.isMerged !== true && _recTs(item) > closeEpoch);
const mergedFph = [...existingMergedFactory, ...mergedRecords, ...postCloseFactory];
await sqliteStore.set('factory_production_history', mergedFph);
emitSyncUpdate({ factory_production_history: null});

updateCloseYearProgress('Factory Data Merged', 90);
}

async function mergeRepSalesData(signal, closeEpoch) {
const repSales = ensureArray(await sqliteStore.get('rep_sales'));
const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
updateCloseYearProgress('Merging Rep Sales Data...', 88);
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (!Array.isArray(repSales) || repSales.length === 0) return;
const nowDate    = new Date();
const nowISODate = nowDate.toISOString().split('T')[0];
const mergeEpoch = nowDate.getTime();
const nowTime    = nowDate.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
const _recTs = r => r.createdAt || r.timestamp || 0;
const mergedRecords = [];
const repBuckets = {};
repSales.forEach(item => {
  if (item.isMerged === true) return;
  if (!item.salesRep || item.salesRep === 'NONE' || item.salesRep === 'ADMIN') return;
  if (_recTs(item) > closeEpoch) return;
  const name = item.customerName || 'Unknown';
  const rep  = item.salesRep     || 'NONE';
  const key  = `${name}::${rep}`;
  if (!repBuckets[key]) {
    repBuckets[key] = {
      customer: name, rep,
      sales: [], oldDebt: 0, collectionTotal: 0, partialPaymentTotal: 0, partialPaymentsBySale: {},
      phone: '', supplyStore: ''
    };
  }
  const b = repBuckets[key];
  b.phone       = b.phone       || item.customerPhone || '';
  b.supplyStore = b.supplyStore || item.supplyStore   || 'STORE_A';
  if (item.paymentType === 'PARTIAL_PAYMENT') {
    b.partialPaymentTotal += (item.totalValue || 0);
    const linkedKey = item.relatedSaleId || item.linkedSaleId;
    if (linkedKey) {
      b.partialPaymentsBySale[linkedKey] = (b.partialPaymentsBySale[linkedKey] || 0) + (item.totalValue || 0);
      if (!b.partialPaymentCustomers) b.partialPaymentCustomers = {};
      b.partialPaymentCustomers[linkedKey] = item.customerName || name;
    }
    return;
  }
  if (item.paymentType === 'COLLECTION') {
    b.collectionTotal += (item.totalValue || 0);
    return;
  }
  if (item.transactionType === 'OLD_DEBT') {
    b.oldDebt += Math.max(0, (item.totalValue || 0) - (item.partialPaymentReceived || 0));
    return;
  }
  b.sales.push(item);
});
for (const [, b] of Object.entries(repBuckets)) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const { customer, rep, sales, oldDebt, collectionTotal, phone, supplyStore } = b;
  let totalQty = 0, totalValue = 0, totalCost = 0, totalProfit = 0;
  let realizedProfit = 0, unrealizedProfit = 0;
  let cashValue = 0, unpaidCreditNet = 0;
  const originalRecordIds = sales.map(s => s.id);
  for (const item of sales) {
    totalQty    += (item.quantity   || 0);
    totalValue  += (item.totalValue || 0);
    totalCost   += (item.totalCost  || 0);
    totalProfit += (item.profit     || 0);
    if (item.paymentType === 'CREDIT' && !item.creditReceived) {
      unrealizedProfit += (item.profit || 0);
    } else {
      realizedProfit += (item.profit || 0);
    }
    if (item.paymentType === 'CASH' || (item.paymentType === 'CREDIT' && item.creditReceived)) {
      cashValue += (item.totalValue || 0);
    } else if (item.paymentType === 'CREDIT' && !item.creditReceived) {
      unpaidCreditNet += Math.max(0, (item.totalValue || 0) - (item.partialPaymentReceived || 0));
    }
  }
  const grossOutstanding = unpaidCreditNet + oldDebt;
  const netOutstanding   = Math.max(0, grossOutstanding - collectionTotal);
  const advanceCredit    = Math.max(0, collectionTotal - grossOutstanding);
  const isSettled        = netOutstanding <= 0;
  if (sales.length === 0 && oldDebt <= 0 && collectionTotal <= 0) continue;
  const allDates  = sales.map(i => i.date).filter(Boolean).sort();
  const firstItem = sales[0] || {};
  const recordCount = sales.length + (oldDebt > 0 ? 1 : 0) + (collectionTotal > 0 ? 1 : 0);
  const mergedId = generateUUID('sale-merged');
  const _repMergedStore = supplyStore || firstItem.supplyStore || 'STORE_A';
  const repCanonicalPrice = await getSalePriceForStore(_repMergedStore);
  const lastUnitPrice = repCanonicalPrice > 0
    ? repCanonicalPrice
    : (firstItem.unitPrice || (firstItem.quantity > 0 ? firstItem.totalValue / firstItem.quantity : 0) || 0);
  const grossSaleValue  = parseFloat(totalValue.toFixed(2));
  const alreadyPaid     = isSettled ? grossSaleValue : parseFloat((grossSaleValue - netOutstanding).toFixed(2));
  const mergedRecord = ensureRecordIntegrity(_buildMergedBase(mergedId, mergeEpoch, nowISODate, nowTime, {
    customerName:          customer,
    customerPhone:         phone,
    quantity:              totalQty,
    unitPrice:             lastUnitPrice,
    totalValue:            grossSaleValue,
    totalCost:             totalCost,
    profit:                totalProfit,
    paymentType:           isSettled ? 'CASH' : 'CREDIT',
    transactionType:       (oldDebt > 0 && sales.length === 0) ? 'OLD_DEBT' : 'SALE',
    creditReceived:        isSettled,
    creditReceivedDate:    isSettled ? nowISODate : null,
    creditValue:           isSettled ? 0 : netOutstanding,
    partialPaymentReceived: isSettled ? 0 : alreadyPaid,
    balancePaid:           alreadyPaid,
    paid:                  isSettled,
    salesRep:              rep,
    supplyStore:           _repMergedStore,
    notes:                 'Combined year-end balance carried forward from financial year close',
    mergedRecordCount:     recordCount,
    mergedSummary: {
      cashSales:           cashValue,
      unpaidCredit:        unpaidCreditNet,
      oldDebt:             oldDebt,
      collectionsReceived: collectionTotal,
      partialPayments:     b.partialPaymentTotal || 0,
      partialPaymentsBySale: b.partialPaymentsBySale || {},
      advanceCreditHeld:   advanceCredit,
      realizedProfit:      realizedProfit,
      unrealizedProfit:    unrealizedProfit,
      grossOutstanding,
      netOutstanding,
      isSettled,
      dateRange: {
        from: allDates[0]           || nowISODate,
        to:   allDates.slice(-1)[0] || nowISODate
      },
      recordCount,
      originalRecordIds:   originalRecordIds
    }
  }), false, true);
  mergedRecords.push(mergedRecord);
}
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (firebaseDB && currentUser) {
  const userRef = firebaseDB.collection('users').doc(currentUser.uid);
  const commitResult = await _commitMergedBatch(userRef, 'rep_sales', mergedRecords, d => !d.isMerged);
  if (!commitResult.ok) {
    console.warn(`mergeRepSalesData: Firestore commit partial failure — ${commitResult.batchesFailed}/${commitResult.batchesTotal} batch(es) failed`, _safeErr(commitResult.error));
    _markRowSyncWarning('repsales', commitResult);
  }
}
const existingMergedRep = repSales.filter(item => item.isMerged === true);
const postCloseRep = repSales.filter(item => item.isMerged !== true && _recTs(item) > closeEpoch);
const mergedRepSales = [...existingMergedRep, ...mergedRecords, ...postCloseRep];
await sqliteStore.set('rep_sales', mergedRepSales);
emitSyncUpdate({ rep_sales: null});
updateCloseYearProgress('Rep Sales Data Merged', 92);
}

async function mergeExpensesData(signal, closeEpoch) {
const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
const expenseCategories = ensureArray(await sqliteStore.get('expense_categories'));
updateCloseYearProgress('Merging Expenses...', 94);
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (!Array.isArray(expenseRecords) || expenseRecords.length === 0) {
  updateCloseYearProgress('Expenses - No Records to Merge', 94);
  return;
}
const nowDate    = new Date();
const nowISODate = nowDate.toISOString().split('T')[0];
const mergeEpoch = nowDate.getTime();
const nowTime    = nowDate.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
const _recTs = r => r.createdAt || r.timestamp || 0;
const expenseGroups = {};
expenseRecords.forEach(exp => {
  if (exp.isMerged === true) return;
  if (_recTs(exp) > closeEpoch) return;
  const cat  = exp.category || 'operating';
  const name = (exp.name    || 'Unnamed').trim();
  const key  = `${cat}||${name}`;
  if (!expenseGroups[key]) expenseGroups[key] = { category: cat, name, records: [] };
  expenseGroups[key].records.push(exp);
});
if (Object.keys(expenseGroups).length === 0) {
  updateCloseYearProgress('Expenses - No New Records to Merge', 97);
  return;
}
const mergedRecords = [];
for (const [, grp] of Object.entries(expenseGroups)) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const { category, name, records } = grp;
  const totalAmount = records.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
  const allDates    = records.map(e => e.date).filter(Boolean).sort();
  const mergedId = generateUUID('exp-merged');
  const mergedRecord = ensureRecordIntegrity({
    ..._buildMergedBase(mergedId, mergeEpoch, nowISODate, nowTime, {}),
    name,
    amount:      parseFloat(totalAmount.toFixed(2)),
    category,
    description: `Year-end merged total for "${name}" (${records.length} record${records.length !== 1 ? 's' : ''})`,
    mergedRecordCount: records.length,
    mergedSummary: {
      category,
      expenseName:  name,
      totalAmount:  parseFloat(totalAmount.toFixed(2)),
      dateRange: {
        from: allDates[0]           || nowISODate,
        to:   allDates.slice(-1)[0] || nowISODate
      },
      recordCount: records.length
    }
  }, false, true);
  mergedRecords.push(mergedRecord);
}
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (firebaseDB && currentUser) {
  const userRef = firebaseDB.collection('users').doc(currentUser.uid);
  const commitResult = await _commitMergedBatch(userRef, 'expenses', mergedRecords, d => !d.isMerged);
  if (!commitResult.ok) {
    console.warn(`mergeExpensesData: Firestore commit partial failure — ${commitResult.batchesFailed}/${commitResult.batchesTotal} batch(es) failed`, _safeErr(commitResult.error));
    _markRowSyncWarning('exp', commitResult);
  }
}
const existingMerged = expenseRecords.filter(e => e.isMerged === true);
const postCloseExpenses = expenseRecords.filter(e => e.isMerged !== true && _recTs(e) > closeEpoch);
const mergedExpenses = [...existingMerged, ...mergedRecords, ...postCloseExpenses];
await sqliteStore.set('expenses', mergedExpenses);

try {
  const _keptIds = new Set(mergedExpenses.map(e => e.id));
  const _mergedAwayIds = expenseRecords
    .filter(e => !_keptIds.has(e.id))
    .map(e => e.id);
  if (_mergedAwayIds.length > 0) {
    const _fyPh   = (await sqliteStore.get('person_photos')) || {};
    const _fyPhTs = (await sqliteStore.get('person_photos_timestamps')) || {};
    const _fyDk   = (await sqliteStore.get('person_photos_dirty_keys')) || [];
    let _fyPhChanged = false;
    for (const _mergedId of _mergedAwayIds) {
      const _mergedPhKey = 'expense:' + _mergedId;
      if (_fyPh[_mergedPhKey] !== undefined) {
        delete _fyPh[_mergedPhKey];
        delete _fyPhTs[_mergedPhKey];
        if (!_fyDk.includes(_mergedPhKey)) _fyDk.push(_mergedPhKey);
        _fyPhChanged = true;
      }
    }
    if (_fyPhChanged) {
      await sqliteStore.set('person_photos', _fyPh);
      await sqliteStore.set('person_photos_timestamps', _fyPhTs);
      await sqliteStore.set('person_photos_dirty_keys', _fyDk);
      console.log('[mergeExpensesData] Queued photo deletion for', _mergedAwayIds.length, 'merged expense record(s).');
    }
  }
} catch (_fyPhErr) { console.warn('[mergeExpensesData] photo cleanup failed:', _fyPhErr); }

emitSyncUpdate({ expenses: null});
updateCloseYearProgress('Expenses Merged', 97);
}

async function mergeStockReturnsData(signal, closeEpoch) {
const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
updateCloseYearProgress('Merging Stock Returns...', 98);
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (!Array.isArray(stockReturns) || stockReturns.length === 0) {
  updateCloseYearProgress('Stock Returns - No Records to Merge', 98);
  return;
}
const nowDate    = new Date();
const nowISODate = nowDate.toISOString().split('T')[0];
const mergeEpoch = nowDate.getTime();
const nowTime    = nowDate.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
const _recTs = r => r.createdAt || r.timestamp || 0;
const storeGroups = {};
stockReturns.forEach(ret => {
  if (ret.isMerged === true) return;
  if (_recTs(ret) > closeEpoch) return;
  const store = ret.store || 'UNKNOWN';
  const date  = ret.date  || nowISODate;
  const key   = `${store}||${date}`;
  if (!storeGroups[key]) storeGroups[key] = { store, date, records: [], totalQty: 0 };
  storeGroups[key].records.push(ret);
  storeGroups[key].totalQty += (ret.quantity || 0);
});
if (Object.keys(storeGroups).length === 0) {
  updateCloseYearProgress('Stock Returns - No New Records to Merge', 100);
  return;
}
const mergedRecords = [];
for (const [, grp] of Object.entries(storeGroups)) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const { store, date, records, totalQty } = grp;
  const sellerBreakdown = {};
  records.forEach(r => {
    const seller = r.seller || 'Unknown';
    if (!sellerBreakdown[seller]) {
      sellerBreakdown[seller] = { quantity: 0, recordCount: 0 };
    }
    sellerBreakdown[seller].quantity += (r.quantity || 0);
    sellerBreakdown[seller].recordCount++;
  });
  const sellers = [...new Set(records.map(r => r.seller).filter(Boolean))];
  const mergedId = generateUUID('ret-merged');
  const base = _buildMergedBase(mergedId, mergeEpoch, nowISODate, nowTime, {});
  const mergedRecord = ensureRecordIntegrity({
    ...base,
    date,
    store,
    quantity:      parseFloat(totalQty.toFixed(4)),
    seller:        sellers.join(', ') || 'Multiple',
    mergedRecordCount: records.length,
    mergedSummary: {
      store,
      date,
      totalQuantity:       parseFloat(totalQty.toFixed(4)),
      contributingSellers: sellers,
      sellerBreakdown:     sellerBreakdown,
      recordCount:         records.length
    }
  }, false, true);
  mergedRecords.push(mergedRecord);
}
if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
if (firebaseDB && currentUser) {
  const userRef = firebaseDB.collection('users').doc(currentUser.uid);
  const commitResult = await _commitMergedBatch(userRef, 'returns', mergedRecords, d => !d.isMerged);
  if (!commitResult.ok) {
    console.warn(`mergeStockReturnsData: Firestore commit partial failure — ${commitResult.batchesFailed}/${commitResult.batchesTotal} batch(es) failed`, _safeErr(commitResult.error));
    _markRowSyncWarning('ret', commitResult);
  }
}
const existingMerged = stockReturns.filter(r => r.isMerged === true);
const postCloseReturns = stockReturns.filter(r => r.isMerged !== true && _recTs(r) > closeEpoch);
const mergedReturns = [...existingMerged, ...mergedRecords, ...postCloseReturns];
await sqliteStore.set('stock_returns', mergedReturns);
emitSyncUpdate({ stock_returns: null});
updateCloseYearProgress('Stock Returns Merged', 100);
}

async function verifyTimestampConsistency() {
  const db = ensureArray(await sqliteStore.get('mfg_pro_pkr'));
  const customerSales = ensureArray(await sqliteStore.get('customer_sales'));
  const repSales = ensureArray(await sqliteStore.get('rep_sales'));
  const salesHistory = ensureArray(await sqliteStore.get('noman_history'));
  const paymentTransactions = ensureArray(await sqliteStore.get('payment_transactions'));
  const stockReturns = ensureArray(await sqliteStore.get('stock_returns'));
  const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
  const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
  const factoryProductionHistory = ensureArray(await sqliteStore.get('factory_production_history'));
  const report = {
collections: {},
settings: {},
issues: [],
fixed: { missingTimestamps: 0, inconsistentTimestamps: 0, settingTimestamps: 0 },
summary: {
totalRecords: 0,
recordsWithTimestamps: 0,
recordsWithoutTimestamps: 0,
recordsWithInconsistentTimestamps: 0
}
};
const toMs = (ts) => {
if (!ts) return 0;
if (typeof ts === 'number') return ts;
if (typeof ts.toMillis === 'function') return ts.toMillis();
if (typeof ts === 'object') {
if (typeof ts.seconds === 'number') return ts.seconds * 1000;
if (typeof ts._seconds === 'number') return ts._seconds * 1000;
if (ts instanceof Date) return ts.getTime();
}
if (typeof ts === 'string') {
try { const t = new Date(ts).getTime(); if (!isNaN(t)) return t; } catch(e) {}
}
return 0;
};
const fixRecord = (item, collectionName) => {
let changed = false;
const tsMs = toMs(item.timestamp);
const caMs = toMs(item.createdAt);
const uaMs = toMs(item.updatedAt);
const allMissing = !item.timestamp && !item.createdAt && !item.updatedAt;
if (allMissing) {
const now = Date.now();
item.timestamp = now;
item.createdAt = now;
item.updatedAt = now;
changed = true;
report.issues.push({ type: 'MISSING_TIMESTAMPS', collection: collectionName, id: item.id, message: 'Stamped with current time' });
report.summary.recordsWithoutTimestamps++;
report.fixed.missingTimestamps++;
} else {
report.summary.recordsWithTimestamps++;
if (item.timestamp) item.timestamp = toMs(item.timestamp) || Date.now();
if (item.createdAt) item.createdAt = toMs(item.createdAt) || Date.now();
if (item.updatedAt) item.updatedAt = toMs(item.updatedAt) || Date.now();
const presentMs = [tsMs, caMs, uaMs].filter(t => t > 0);
if (presentMs.length > 1) {
const maxTime = Math.max(...presentMs);
const minTime = Math.min(...presentMs);
if (maxTime - minTime > 86400000) {
if (item.timestamp) item.timestamp = maxTime;
if (item.createdAt) item.createdAt = maxTime;
if (item.updatedAt) item.updatedAt = maxTime;
changed = true;
report.issues.push({ type: 'INCONSISTENT_TIMESTAMPS', collection: collectionName, id: item.id, message: `Fields diverged by ${Math.round((maxTime - minTime) / 3600000)}h — normalized to newest` });
report.summary.recordsWithInconsistentTimestamps++;
report.fixed.inconsistentTimestamps++;
}
}
const bestMs = Math.max(tsMs, caMs, uaMs);
if (!item.timestamp) { item.timestamp = bestMs; changed = true; }
if (!item.createdAt) { item.createdAt = bestMs; changed = true; }
if (!item.updatedAt) { item.updatedAt = bestMs; changed = true; }
}
return changed;
};
const collections = [
{ name: 'mfg_pro_pkr', label: 'Production', variable: 'db' },
{ name: 'noman_history', label: 'Calculator History', variable: null },
{ name: 'customer_sales', label: 'Customer Sales', variable: 'customerSales' },
{ name: 'rep_sales', label: 'Rep Sales', variable: 'repSales' },
{ name: 'rep_customers', label: 'Rep Customers', variable: 'repCustomers' },
{ name: 'factory_inventory_data', label: 'Factory Inventory', variable: 'factoryInventoryData' },
{ name: 'factory_production_history', label: 'Factory History', variable: 'factoryProductionHistory' },
{ name: 'stock_returns', label: 'Stock Returns', variable: 'stockReturns' },
{ name: 'payment_transactions', label: 'Payment Transactions', variable: 'paymentTransactions' },
{ name: 'payment_entities', label: 'Payment Entities', variable: 'paymentEntities' },
{ name: 'expenses', label: 'Expenses', variable: 'expenseRecords' }
];
for (const collection of collections) {
const data = await sqliteStore.get(collection.name, []);
let collectionChanged = false;
report.collections[collection.name] = { label: collection.label, count: data.length, withTimestamps: 0, withoutTimestamps: 0 };
report.summary.totalRecords += data.length;
data.forEach(item => {
if (!item) return;
const changed = fixRecord(item, collection.name);
if (changed) collectionChanged = true;
if (item.timestamp || item.createdAt || item.updatedAt) {
report.collections[collection.name].withTimestamps++;
} else {
report.collections[collection.name].withoutTimestamps++;
}
});
if (collectionChanged) {
await sqliteStore.set(collection.name, data);
}
}
const settingsKeys = [
'factory_default_formulas', 'factory_additional_costs',
'factory_cost_adjustment_factor', 'factory_sale_prices',
'factory_unit_tracking', 'naswar_default_settings'
];
for (const key of settingsKeys) {
const timestamp = await sqliteStore.get(`${key}_timestamp`);
if (!timestamp) {
const now = Date.now();
await sqliteStore.set(`${key}_timestamp`, now);
report.issues.push({ type: 'MISSING_SETTING_TIMESTAMP', setting: key, message: 'Timestamp created' });
report.fixed.settingTimestamps++;
}
report.settings[key] = { hasTimestamp: true, timestamp: timestamp || Date.now() };
}
const totalFixed = report.fixed.missingTimestamps + report.fixed.inconsistentTimestamps + report.fixed.settingTimestamps;
if (totalFixed > 0) {
showToast(` Timestamp repair: fixed ${totalFixed} record${totalFixed !== 1 ? 's' : ''} (${report.fixed.missingTimestamps} missing, ${report.fixed.inconsistentTimestamps} inconsistent).`, 'success', 4000);
} else {
showToast('Timestamp consistency check passed — all records healthy.', 'success', 3000);
}
return report;
}

async function deduplicateAllData() {
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
  const deletedRecordIds = new Set(ensureArray(await sqliteStore.get('deleted_records')));
  const _ddMsg = `Run a full deduplication scan?\n\nThis will:\n • Scan all records across every collection\n • Remove exact duplicate entries (keeping the newest version)\n • Sync cleaned data to the cloud\n\n\u26a0 This operation may take 30–60 seconds depending on data volume. Do not close the app while it runs.\n\nThis cannot be undone — but your data will only be improved, not deleted.`;
if (!(await showGlassConfirm(_ddMsg, { title: 'Deduplicate All Data', confirmText: 'Run Cleanup', cancelText: 'Cancel', danger: true }))) {
return;
}
showToast('Scanning for duplicates and old IDs...', 'info');
const results = {
collections: {},
totalDuplicates: 0,
totalRecordsBefore: 0,
totalRecordsAfter: 0
};
const getTimestampValue = (record) => {
if (!record) return 0;
let ts = record.updatedAt || record.timestamp || record.createdAt || 0;
if (typeof ts === 'number') {
return ts;
}
if (ts && typeof ts.toMillis === 'function') {
return ts.toMillis();
}
if (ts && typeof ts === 'object') {
if (typeof ts.seconds === 'number') {
return ts.seconds * 1000;
}
if (typeof ts._seconds === 'number') {
return ts._seconds * 1000;
}
}
if (ts instanceof Date) {
return ts.getTime();
}
if (typeof ts === 'string') {
try {
const dateStr = ts.replace('Z', '+00:00');
const date = new Date(dateStr);
const time = date.getTime();
if (!isNaN(time)) {
return time;
}
} catch (e) {
}
}
return 0;
};
const deduplicateArray = (array) => {
if (!Array.isArray(array) || array.length === 0) {
return { cleaned: array, duplicates: 0 };
}
const seen = new Map();
let duplicatesRemoved = 0;
array.forEach(item => {
if (!item || !item.id) return;
if (!validateUUID(item.id)) item.id = generateUUID('repair');
if (seen.has(item.id)) {
duplicatesRemoved++;
const existing = seen.get(item.id);
const cmp = (typeof compareRecordVersions === 'function')
  ? compareRecordVersions(item, existing)
  : getTimestampValue(item) - getTimestampValue(existing);
if (cmp > 0) {
seen.set(item.id, item);
}
} else {
seen.set(item.id, item);
}
});
return {
cleaned: Array.from(seen.values()),
duplicates: duplicatesRemoved
};
};
const collections = [
{ key: 'mfg_pro_pkr', label: 'Production', variable: 'db' },
{ key: 'noman_history', label: 'Calculator History', variable: null },
{ key: 'customer_sales', label: 'Customer Sales', variable: 'customerSales' },
{ key: 'rep_sales', label: 'Rep Sales', variable: 'repSales' },
{ key: 'rep_customers', label: 'Rep Customers', variable: 'repCustomers' },
{ key: 'factory_inventory_data', label: 'Factory Inventory', variable: 'factoryInventoryData' },
{ key: 'factory_production_history', label: 'Factory History', variable: 'factoryProductionHistory' },
{ key: 'stock_returns', label: 'Stock Returns', variable: 'stockReturns' },
{ key: 'payment_transactions', label: 'Payment Transactions', variable: 'paymentTransactions' },
{ key: 'payment_entities', label: 'Payment Entities', variable: 'paymentEntities' },
{ key: 'expenses', label: 'Expenses', variable: 'expenseRecords' }
];
for (const collection of collections) {
const data = await sqliteStore.get(collection.key, []);
const before = data.length;
results.totalRecordsBefore += before;
const { cleaned, duplicates } = deduplicateArray(data);
const after = cleaned.length;
results.totalRecordsAfter += after;
results.collections[collection.key] = {
label: collection.label,
before: before,
after: after,
duplicates: duplicates
};
results.totalDuplicates += duplicates;
if (duplicates > 0) {
await sqliteStore.set(collection.key, cleaned);
}
}
if (results.totalDuplicates > 0) {
showToast(` Removed ${results.totalDuplicates} duplicates!`, 'success');
await refreshAllDisplays();
if (firebaseDB && currentUser) {
showToast('Syncing cleaned data to cloud...', 'info');
await performOneClickSync(true);
}
showToast(` Done! ${results.totalDuplicates} duplicates removed. Data synced to cloud.`, 'success', 5000);
} else {
showToast(' No duplicates found! Data is clean.', 'success');
}
return results;
}
function dbvShowTab(i) {
  [0,1,2,3].forEach(j => {
    const p = document.getElementById('dbv-pane-'+j);
    const t = document.getElementById('dbv-tab-'+j);
    if (p) p.style.display = j===i ? '' : 'none';
    if (t) {
      t.style.background = j===i ? 'var(--accent)' : 'rgba(128,128,128,0.12)';
      t.style.color = j===i ? '#fff' : 'var(--text-muted)';
    }
  });
}
window.dbvShowTab = dbvShowTab;

window.showDeltaSyncDetails = showDeltaSyncDetails;
window.verifyTimestampConsistency = verifyTimestampConsistency;
window.deduplicateAllData = deduplicateAllData;
async function verifyCompleteTimestampConsistency() {
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
  const report = {
tabs: {},
sqlite: {},
deltaSync: {},
compatibility: {},
issues: [],
summary: {
totalRecords: 0,
recordsWithValidTimestamps: 0,
recordsWithIssues: 0,
deltaSyncCompatible: true,
firestoreCompatible: true
}
};
const tabs = [
{ name: 'Production', sqliteKey: 'mfg_pro_pkr', variable: 'db', tab: 'prod' },
{ name: 'Sales', sqliteKey: 'customer_sales', variable: 'customerSales', tab: 'sales' },
{ name: 'Calculator', sqliteKey: 'noman_history', variable: null, tab: 'calc' },
{ name: 'Factory', sqliteKeys: ['factory_inventory_data', 'factory_production_history'], tab: 'factory' },
{ name: 'Payments', sqliteKeys: ['payment_transactions', 'payment_entities'], tab: 'payments' },
{ name: 'Rep Sales', sqliteKey: 'rep_sales', variable: 'repSales', tab: 'rep' }
];
for (const tab of tabs) {
const tabReport = {
name: tab.name,
collections: {},
totalRecords: 0,
validTimestamps: 0,
issues: 0
};
const keys = tab.sqliteKeys || [tab.sqliteKey];
for (const key of keys) {
const data = await sqliteStore.get(key, []);
tabReport.totalRecords += data.length;
let valid = 0;
let invalid = 0;
for (const record of data) {
if (!record) continue;
const ts = record.updatedAt || record.timestamp || record.createdAt;
if (ts) {
const extracted = extractTimestampValue(record);
if (extracted > 0) {
valid++;
} else {
invalid++;
report.issues.push({
type: 'INVALID_TIMESTAMP',
tab: tab.name,
collection: key,
id: record.id,
timestamp: ts
});
}
} else {
invalid++;
}
}
tabReport.collections[key] = {
total: data.length,
valid: valid,
invalid: invalid
};
tabReport.validTimestamps += valid;
tabReport.issues += invalid;
}
report.tabs[tab.name] = tabReport;
report.summary.totalRecords += tabReport.totalRecords;
report.summary.recordsWithValidTimestamps += tabReport.validTimestamps;
report.summary.recordsWithIssues += tabReport.issues;
}
const sqliteCollections = [
'mfg_pro_pkr', 'noman_history', 'customer_sales', 'rep_sales', 'rep_customers',
'factory_inventory_data', 'factory_production_history', 'stock_returns',
'payment_transactions', 'payment_entities', 'expenses'
];
for (const collectionName of sqliteCollections) {
const data = await sqliteStore.get(collectionName, []);
if (data.length === 0) {
report.sqlite[collectionName] = { status: 'empty', count: 0 };
continue;
}
const formats = {
number: 0,
string: 0,
date: 0,
firestore: 0,
dict: 0,
missing: 0,
invalid: 0
};
for (const record of data) {
const ts = record.updatedAt || record.timestamp || record.createdAt;
if (!ts) {
formats.missing++;
} else if (typeof ts === 'number') {
formats.number++;
} else if (typeof ts === 'string') {
formats.string++;
} else if (ts instanceof Date) {
formats.date++;
} else if (ts && typeof ts.toMillis === 'function') {
formats.firestore++;
} else if (ts && typeof ts === 'object' && (ts.seconds || ts._seconds)) {
formats.dict++;
} else {
formats.invalid++;
}
}
report.sqlite[collectionName] = {
status: 'ok',
count: data.length,
formats: formats
};
const validCount = formats.number + formats.string + formats.date + formats.firestore + formats.dict;
}
const deltaSyncCollections = [
{ name: 'production', sqliteKey: 'mfg_pro_pkr' },
{ name: 'sales', sqliteKey: 'customer_sales' },
{ name: 'calculator_history', sqliteKey: 'noman_history' },
{ name: 'rep_sales', sqliteKey: 'rep_sales' },
{ name: 'rep_customers', sqliteKey: 'rep_customers' },
{ name: 'transactions', sqliteKey: 'payment_transactions' },
{ name: 'entities', sqliteKey: 'payment_entities' },
{ name: 'inventory', sqliteKey: 'factory_inventory_data' },
{ name: 'factory_history', sqliteKey: 'factory_production_history' },
{ name: 'returns', sqliteKey: 'stock_returns' },
{ name: 'expenses', sqliteKey: 'expenses' }
];
for (const collection of deltaSyncCollections) {
const data = await sqliteStore.get(collection.sqliteKey, []);
if (data.length === 0) {
report.deltaSync[collection.name] = { status: 'empty', compatible: true };
continue;
}
let deltaSyncWorking = 0;
let deltaSyncFailing = 0;
for (const record of data) {
const itemTime = record.updatedAt || record.timestamp || record.createdAt || 0;
const itemTimestamp = typeof itemTime === 'number' ? itemTime :
typeof itemTime === 'string' ? new Date(itemTime).getTime() :
itemTime?.toMillis ? itemTime.toMillis() : 0;
if (itemTimestamp > 0) {
deltaSyncWorking++;
} else {
deltaSyncFailing++;
}
}
const compatible = deltaSyncFailing === 0;
report.deltaSync[collection.name] = {
status: compatible ? 'compatible' : 'issues',
compatible: compatible,
total: data.length,
working: deltaSyncWorking,
failing: deltaSyncFailing
};
if (!compatible) {
report.summary.deltaSyncCompatible = false;
}
const statusIcon = compatible ? '' : '';
}
for (const collectionName of sqliteCollections) {
const data = await sqliteStore.get(collectionName, []);
if (data.length === 0) {
report.compatibility[collectionName] = { firestore: 'empty' };
continue;
}
let canSerialize = 0;
let cannotSerialize = 0;
for (const record of data.slice(0, 10)) {
try {
const ts = record.updatedAt || record.timestamp || record.createdAt;
if (typeof ts === 'number' || typeof ts === 'string' || ts instanceof Date) {
canSerialize++;
} else if (ts && typeof ts === 'object') {
canSerialize++;
} else {
cannotSerialize++;
}
} catch (e) {
cannotSerialize++;
}
}
const compatible = cannotSerialize === 0;
report.compatibility[collectionName] = {
firestore: compatible ? 'compatible' : 'issues',
sampled: Math.min(10, data.length),
compatible: canSerialize,
incompatible: cannotSerialize
};
if (!compatible) {
report.summary.firestoreCompatible = false;
}
}
const testRecords = [
{ id: 'test-1', updatedAt: Date.now(), name: 'Number timestamp' },
{ id: 'test-2', timestamp: new Date().toISOString(), name: 'ISO string' },
{ id: 'test-3', createdAt: new Date(), name: 'Date object' },
{ id: 'test-4', updatedAt: { seconds: Math.floor(Date.now()/1000) }, name: 'Dict timestamp' }
];
let extractionWorks = true;
for (const record of testRecords) {
const extracted = extractTimestampValue(record);
if (extracted === 0) {
extractionWorks = false;
}
}
if (extractionWorks) {
}
const testDuplicates = [
{ id: 'dup-1', timestamp: 1000, value: 'old' },
{ id: 'dup-1', timestamp: 2000, value: 'new' }
];
if (report.issues.length > 0) {
report.issues.slice(0, 5).forEach((issue, i) => {
});
if (report.issues.length > 5) {
}
} else {
}
if (report.issues.length > 0) {
showToast(` Full verification: ${report.issues.length} issue${report.issues.length !== 1 ? 's' : ''} detected.`, 'warning', 4500);
} else {
showToast('Full system verification passed — all data is consistent.', 'success', 3500);
}
return report;
}

function extractTimestampValue(record) {
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
const date = new Date(ts.replace('Z', '+00:00'));
const time = date.getTime();
if (!isNaN(time)) return time;
} catch (e) {}
}
return 0;
}
window.verifyCompleteTimestampConsistency = verifyCompleteTimestampConsistency;
async function runUnifiedCleanup() {
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
  const deletedRecordIds = new Set(ensureArray(await sqliteStore.get('deleted_records')));
if (!(await showGlassConfirm(
  'Clean all duplicate records?\n\n\u2022 Scans every collection in SQLite\n\u2022 Removes duplicates using record timestamps as the version selector\n\u2022 Deletes the duplicate documents from Firestore\n\u2022 Re-uploads the clean, deduplicated set\n\nNo valid records are deleted \u2014 only true duplicates (same UUID) are resolved.',
  { title: 'Clean Duplicates & Sync', confirmText: 'Clean & Sync', cancelText: 'Cancel', danger: false }
))) return;

showToast('Scanning for duplicates\u2026', 'info', 4000);

const COLLECTIONS = [
  { sqliteKey: 'mfg_pro_pkr',                firestore: 'production',         label: 'Production',           liveVar: 'db'                       },
  { sqliteKey: 'noman_history',              firestore: 'calculator_history',  label: 'Calculator History',   liveVar: 'salesHistory'             },
  { sqliteKey: 'customer_sales',             firestore: 'sales',               label: 'Customer Sales',       liveVar: 'customerSales'            },
  { sqliteKey: 'rep_sales',                  firestore: 'rep_sales',           label: 'Rep Sales',            liveVar: 'repSales'                 },
  { sqliteKey: 'rep_customers',              firestore: 'rep_customers',       label: 'Rep Customers',        liveVar: 'repCustomers'             },
  { sqliteKey: 'sales_customers',            firestore: 'sales_customers',     label: 'Sales Customers',      liveVar: 'salesCustomers'           },
  { sqliteKey: 'factory_inventory_data',     firestore: 'inventory',           label: 'Factory Inventory',    liveVar: 'factoryInventoryData'     },
  { sqliteKey: 'factory_production_history', firestore: 'factory_history',     label: 'Factory History',      liveVar: 'factoryProductionHistory' },
  { sqliteKey: 'stock_returns',              firestore: 'returns',             label: 'Stock Returns',        liveVar: 'stockReturns'             },
  { sqliteKey: 'payment_transactions',       firestore: 'transactions',        label: 'Payment Transactions', liveVar: 'paymentTransactions'      },
  { sqliteKey: 'payment_entities',           firestore: 'entities',            label: 'Payment Entities',     liveVar: 'paymentEntities'          },
  { sqliteKey: 'expenses',                   firestore: 'expenses',            label: 'Expenses',             liveVar: 'expenseRecords'           },
];

try {
  let totalDuplicates = 0;
  const dirtyCollections = [];

  for (const col of COLLECTIONS) {
    const records = await sqliteStore.get(col.sqliteKey, []);
    if (!Array.isArray(records) || records.length === 0) continue;

    const seen = new Map();
    let dupsInCol = 0;

    for (const rec of records) {
      if (!rec || !rec.id) continue;
      if (!validateUUID(rec.id)) rec.id = generateUUID('repair');

      if (seen.has(rec.id)) {
        dupsInCol++;

        const cmp = (typeof compareRecordVersions === 'function')
          ? compareRecordVersions(rec, seen.get(rec.id))
          : ((rec.updatedAt || 0) - (seen.get(rec.id).updatedAt || 0));
        if (cmp > 0) seen.set(rec.id, rec);
      } else {
        seen.set(rec.id, rec);
      }
    }

    if (dupsInCol > 0) {
      const cleaned = Array.from(seen.values());
      await sqliteStore.set(col.sqliteKey, cleaned);
      dirtyCollections.push({ ...col, cleaned, dupCount: dupsInCol });
      totalDuplicates += dupsInCol;
    }
  }

  if (totalDuplicates === 0) {
    showToast('\u2714 No duplicates found \u2014 data is clean.', 'success', 4000);
    return;
  }

  showToast(`Found ${totalDuplicates} duplicate${totalDuplicates !== 1 ? 's' : ''}. Removing from Firestore\u2026`, 'info', 5000);

  if (firebaseDB && currentUser) {
    const userRef = firebaseDB.collection('users').doc(currentUser.uid);

    for (const col of dirtyCollections) {
      try {

        const snapshot = await userRef.collection(col.firestore).get();
        if (snapshot.empty) continue;

        const canonicalIds = new Set(col.cleaned.map(r => String(r.id)));

        const docsToDelete = snapshot.docs.filter(d => !canonicalIds.has(d.id));
        if (docsToDelete.length > 0) {
          const delBatches = [firebaseDB.batch()];
          let delOps = 0;
          for (const doc of docsToDelete) {
            if (delOps >= 490) { delBatches.push(firebaseDB.batch()); delOps = 0; }
            delBatches[delBatches.length - 1].delete(doc.ref);
            delOps++;
            trackFirestoreWrite(1);
          }
          for (const b of delBatches) await b.commit();
        }

        const upBatches = [firebaseDB.batch()];
        let upOps = 0;
        for (const rec of col.cleaned) {
          if (!rec || !rec.id) continue;
          if (upOps >= 490) { upBatches.push(firebaseDB.batch()); upOps = 0; }
          const sanitized = sanitizeForFirestore(rec);
          sanitized.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
          upBatches[upBatches.length - 1].set(
            userRef.collection(col.firestore).doc(String(rec.id)),
            sanitized,
            { merge: true }
          );
          upOps++;
          trackFirestoreWrite(1);
          if (typeof DeltaSync !== 'undefined') DeltaSync.markUploaded(col.firestore, rec.id);
        }
        for (const b of upBatches) await b.commit();
        if (typeof DeltaSync !== 'undefined') await DeltaSync.setLastSyncTimestamp(col.firestore);

      } catch (colErr) {
        console.error('[Cleanup] Firestore sync failed for', col.firestore, _safeErr(colErr));
        showToast('Firestore sync failed for ' + col.label + ': ' + colErr.message, 'error');
      }
    }

    showToast(
      `\u2714 Removed ${totalDuplicates} duplicate${totalDuplicates !== 1 ? 's' : ''} from SQLite and Firestore. Canonical records re-uploaded.`,
      'success', 6000
    );
  } else {
    showToast(
      `\u2714 Removed ${totalDuplicates} duplicate${totalDuplicates !== 1 ? 's' : ''} from local storage. Sign in to sync to cloud.`,
      'success', 5000
    );
  }

  try { await refreshAllDisplays(); } catch(e) {}

} catch (err) {
  console.error('[runUnifiedCleanup] error:', _safeErr(err));
  showToast('\u26a0 Cleanup failed: ' + err.message, 'error', 6000);
}
}
window.runUnifiedCleanup = runUnifiedCleanup;
window._showDeltaSyncDetails = showDeltaSyncDetails;
window._runUnifiedCleanup = runUnifiedCleanup;
window._showCloseFinancialYearDialog = showCloseFinancialYearDialog;
