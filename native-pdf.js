const NativePDF = (() => {
  function getDeviceW(landscape) {
    const sw = window.screen.width  || 390;
    const sh = window.screen.height || 844;
    const w = landscape ? Math.max(sw, sh) : Math.min(sw, sh);
    const h = landscape ? Math.min(sw, sh) : Math.max(sw, sh);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const physW = Math.min(Math.max(w * dpr, 320), 1080);
    const physH = Math.min(Math.max(h * dpr, 480), 1920);
    return { screenW: w, screenH: h, physW, physH, dpr };
  }
  function buildCSS(landscape) {
    const { screenW } = getDeviceW(landscape);
    const scale    = Math.max(0.75, Math.min(screenW / 390, 1.6));
    const base     = (11 * scale).toFixed(1);
    const small    = (8.5 * scale).toFixed(1);
    const smaller  = (7.5 * scale).toFixed(1);
    const heading  = (13 * scale).toFixed(1);
    const company  = (16 * scale).toFixed(1);
    const pad      = Math.round(16 * scale);
    const halfPad  = Math.round(8 * scale);
    return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%;
      font-family: Arial, Helvetica, sans-serif;
      font-size: ${base}px;
      color: #333;
      background: #fff;
    }
    .page {
      width: 100%;
      background: #fff;
      page-break-after: always;
      position: relative;
      overflow: hidden;
    }
    .page:last-child { page-break-after: auto; }
    /* Header bar */
    .doc-header {
      width: 100%;
      padding: ${halfPad}px ${pad}px;
      color: #fff;
      text-align: center;
    }
    .doc-header .company {
      font-size: ${company}px;
      font-weight: 800;
      letter-spacing: 0.3px;
      word-break: break-word;
    }
    .doc-header .subtitle {
      font-size: ${smaller}px;
      font-weight: 400;
      margin-top: 2px;
      opacity: 0.9;
    }
    /* Title / meta */
    .doc-title {
      text-align: center;
      padding: ${halfPad}px ${pad}px 4px;
      font-size: ${heading}px;
      font-weight: 700;
      color: #323232;
      word-break: break-word;
    }
    .doc-meta {
      display: flex; flex-wrap: wrap; gap: 3px 16px;
      padding: 4px ${pad}px 6px;
      font-size: ${small}px; color: #555;
    }
    .doc-meta .kv { display: flex; gap: 4px; flex-wrap: wrap; }
    .doc-meta .k  { font-weight: 700; color: #333; white-space: nowrap; }
    .doc-meta .v  { color: #555; word-break: break-word; }
    .doc-divider  { height: 1px; margin: 0 ${pad}px 6px; }
    /* Section label */
    .section-label {
      font-size: ${smaller}px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.5px; padding: 4px ${pad}px 3px;
    }
    /* Tables — fluid, no fixed widths */
    table {
      width: calc(100% - ${pad * 2}px);
      margin: 0 ${pad}px 6px;
      border-collapse: collapse;
      font-size: ${small}px;
      table-layout: fixed;
      word-break: break-word;
    }
    thead th {
      padding: 4px 3px;
      font-weight: 700;
      font-size: ${small}px;
      color: #fff;
      text-align: center;
      border: 1px solid rgba(255,255,255,0.3);
      word-break: break-word;
    }
    tbody td {
      padding: 3px 3px;
      border: 1px solid #ddd;
      vertical-align: top;
      line-height: 1.35;
      word-break: break-word;
      overflow-wrap: break-word;
    }
    tbody tr:nth-child(even) td { background: #fafafa; }
    /* Alignment helpers */
    .ta-c { text-align: center; }
    .ta-r { text-align: right; }
    .ta-l { text-align: left; }
    /* Colour utilities */
    .c-red    { color: #dc3545; }
    .c-green  { color: #28a745; }
    .c-gray   { color: #888; }
    .c-orange { color: #ff9500; }
    .c-purple { color: #7e22ce; }
    .fw-700   { font-weight: 700; }
    .fw-800   { font-weight: 800; }
    /* Total rows */
    .row-total        td { font-weight:700; font-size:${small}px; background:#f0f0f0 !important; }
    .row-total-green  td { font-weight:700; font-size:${small}px; background:#ebffeb !important; }
    .row-total-blue   td { font-weight:700; font-size:${small}px; background:#f0f8ff !important; }
    .row-total-orange td { font-weight:700; font-size:${small}px; background:#fff5eb !important; }
    /* Merged rows */
    .row-merged     td { background:#f5ebff !important; color:#50287a; }
    .row-merged-sub td { background:#e6d2ff !important; font-weight:700; }
    /* Merged banner */
    .merged-banner {
      margin: 4px ${pad}px;
      background: #f5ebff;
      border: 1px solid #af52de;
      border-radius: 4px;
      padding: 4px 10px;
      font-size: ${small}px; font-weight:700; color:#7e22ce;
    }
    /* Summary box */
    .summary-box {
      margin: 4px ${pad}px;
      border-radius: 4px;
      padding: 6px 10px;
      font-size: ${small}px;
      display: flex; flex-wrap: wrap; gap: 4px 16px;
      align-items: center;
    }
    .summary-box .item  { display:flex; gap:4px; align-items:center; flex-wrap:wrap; }
    .summary-box .label { font-weight:600; color:#555; }
    /* Footer */
    .doc-footer {
      text-align: center;
      font-size: ${smaller}px;
      color: #aaa;
      padding: 8px ${pad}px 4px;
      border-top: 1px solid #eee;
      margin-top: 6px;
    }
    /* Note box */
    .note-box {
      margin: 4px ${pad}px;
      background: #f5ebff;
      border-radius: 3px;
      padding: 4px 10px;
      font-size: ${smaller}px; font-weight:700; color:#7e22ce;
    }
    /* Breakdown */
    .breakdown { margin: 4px ${pad}px; font-size:${small}px; }
    .breakdown .bk-row { display:flex; justify-content:space-between; padding:2px 0; border-bottom:1px solid #f0f0f0; }
    .breakdown .bk-row .bk-name { color:#555; }
    .breakdown .bk-row .bk-amt  { font-weight:700; color:#dc3545; }
    @media print {
      @page { size: ${landscape ? 'A4 landscape' : 'A4 portrait'}; margin: 0; }
      body  { margin: 0; }
      .page { width: 100%; page-break-after: always; }
      .no-print { display: none; }
      .doc-footer { position: fixed; bottom: 4mm; left: 0; right: 0; }
    }
  `;
  }
  
  function h(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/\n/g, '<br>');
  }
  
  function buildDoc(bodyHTML, { landscape = false } = {}) {
    return `<!DOCTYPE html><html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <style>${buildCSS(landscape)}</style>
</head>
<body>${bodyHTML}</body></html>`;
  }
  
  function buildAndDownload(bodyHTML, filename, { landscape = false } = {}) {
    const html = buildDoc(bodyHTML, { landscape });
    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;opacity:0;';
    document.body.appendChild(frame);
    frame.onload = () => {
      try {
        frame.contentDocument.title = filename;
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch(e) {
        console.warn('[NativePDF] print failed, opening in tab', e);
        window.open(url, '_blank');
      }
      setTimeout(() => {
        if (frame.parentNode) document.body.removeChild(frame);
        URL.revokeObjectURL(url);
      }, 5000);
    };
    frame.src = url;
  }
  
  async function buildAndShare(bodyHTML, filename, phone, { landscape = false } = {}) {
    const hasPhone = phone && phone !== 'N/A' && phone.trim() !== '';
    const cleaned  = hasPhone ? phone.trim().replace(/[^\d+]/g, '') : '';
    const waUrl    = hasPhone ? `https://wa.me/${cleaned}` : null;
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    let waWin = null;
    if (waUrl && !isMobile) {
      waWin = window.open('', '_blank');
    }
    const { screenW, physW, dpr } = getDeviceW(landscape);
    const cssW = screenW;
    const html  = buildDoc(bodyHTML, { landscape });
    const blob  = new Blob([html], { type: 'text/html' });
    const url   = URL.createObjectURL(blob);
    const frame = document.createElement('iframe');
    frame.style.cssText = [
      'position:fixed',
      'top:-99999px',
      'left:-99999px',
      `width:${cssW}px`,
      'height:10px',       // will grow once loaded
      'border:none',
      'background:#fff',
      'visibility:hidden',
    ].join(';');
    document.body.appendChild(frame);
    await new Promise(resolve => {
      frame.onload = () => setTimeout(resolve, 500);
      frame.src = url;
    });
    const contentH = frame.contentDocument
      ? Math.max(
          frame.contentDocument.body.scrollHeight,
          frame.contentDocument.documentElement.scrollHeight,
          100
        )
      : Math.round(cssW * 1.414); // fallback: A4 ratio
    frame.style.height = contentH + 'px';
    await new Promise(r => setTimeout(r, 150));
    const canvasW = physW;
    const canvasH = Math.round(contentH * (physW / cssW));
    let imageBlob = null;
    try {
      const innerHTML = frame.contentDocument.documentElement.outerHTML;
      const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}">
        <foreignObject width="${canvasW}" height="${canvasH}">
          <html xmlns="http://www.w3.org/1999/xhtml">
            <head>
              <meta charset="utf-8"/>
              <style>${buildCSS(landscape)}</style>
            </head>
            <body style="margin:0;padding:0;width:${cssW}px;transform:scale(${physW/cssW});transform-origin:top left;">
              ${frame.contentDocument.body.innerHTML}
            </body>
          </html>
        </foreignObject>
      </svg>`;
      const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl  = URL.createObjectURL(svgBlob);
      const img     = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = () => rej(new Error('SVG image load failed'));
        img.src = svgUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width  = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.drawImage(img, 0, 0, canvasW, canvasH);
      URL.revokeObjectURL(svgUrl);
      imageBlob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92));
    } catch (e) {
      console.warn('[NativePDF] canvas render failed:', e);
      imageBlob = null;
    }
    if (frame.parentNode) document.body.removeChild(frame);
    URL.revokeObjectURL(url);
    const imageFile = imageBlob
      ? new File([imageBlob], `${filename}.jpg`, { type: 'image/jpeg' })
      : null;
    if (imageFile && navigator.canShare && navigator.canShare({ files: [imageFile] })) {
      if (waWin) { try { waWin.close(); } catch(e) {} waWin = null; }
      try {
        await navigator.share({ files: [imageFile], title: 'Account Statement' });
        showToast('Statement shared successfully', 'success');
        return;
      } catch (err) {
        if (err.name === 'AbortError') { showToast('Share cancelled', 'info'); return; }
      }
    }
    if (imageFile) {
      const dlLink = document.createElement('a');
      dlLink.href     = URL.createObjectURL(imageBlob);
      dlLink.download = `${filename}.jpg`;
      document.body.appendChild(dlLink);
      dlLink.click();
      document.body.removeChild(dlLink);
      setTimeout(() => URL.revokeObjectURL(dlLink.href), 8000);
    }
    if (waUrl) {
      if (isMobile) {
        showToast('Statement saved — opening WhatsApp…', 'success');
        setTimeout(() => { window.location.href = waUrl; }, 600);
      } else if (waWin) {
        showToast('Statement saved — WhatsApp opened', 'success');
        waWin.location.href = waUrl;
      } else {
        const w = window.open(waUrl, '_blank');
        if (!w) { window.location.href = waUrl; }
        showToast('Statement saved — opening WhatsApp…', 'success');
      }
    } else {
      showToast(imageFile ? 'Statement saved as image' : 'Statement exported', 'success');
    }
    if (!imageFile) {
      buildAndDownload(bodyHTML, filename, { landscape });
    }
  }
  
  function table({ headers, rows, colStyles = [], headerColor = '#28a745' }) {
    const thStyle = `background:${headerColor};`;
    const headCells = headers.map((hdr, i) => {
      const cs = colStyles[i] || {};
      const align = cs.align || 'center';
      return `<th style="text-align:${align};${thStyle}">${h(hdr)}</th>`;
    }).join('');
    const bodyRows = rows.map(({ cells, rowClass = '' }) => {
      const tds = cells.map((cell, i) => {
        const cs = colStyles[i] || {};
        const align = cs.align || 'left';
        const style = [
          cs.color ? `color:${cs.color};` : '',
          cs.bold  ? 'font-weight:700;' : '',
          cs.width ? `width:${cs.width};` : '',
        ].join('');
        const content = (cell && typeof cell === 'object' && cell.raw != null)
          ? cell.raw
          : h(cell);
        return `<td class="ta-${align[0]}" style="${style}">${content}</td>`;
      }).join('');
      return `<tr class="${rowClass}">${tds}</tr>`;
    }).join('');
    return `<table><thead><tr>${headCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
  }
  
  function docHeader(color, subtitle) {
    return `<div class="doc-header" style="background:${color};">
      <div class="company">GULL AND ZUBAIR NASWAR DEALERS</div>
      <div class="subtitle">${subtitle}</div>
    </div>`;
  }
  function docFooter(now) {
    const d = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const t = now.toLocaleTimeString('en-US');
    return `<div class="doc-footer">Generated on ${h(d)} at ${h(t)} | GULL AND ZUBAIR NASWAR DEALERS</div>`;
  }
  function divider(color) {
    return `<div class="doc-divider" style="background:${color};"></div>`;
  }
  function mergedBanner(label) {
    return `<div class="merged-banner">★ ${h(label)}</div>`;
  }
  function noteBox(text) {
    return `<div class="note-box">★ ${h(text)}</div>`;
  }
  
  function balColor(val) {
    if (Math.abs(val) < 0.01) return '#888';
    return val > 0 ? '#dc3545' : '#28a745';
  }
  return {
    buildAndDownload,
    buildAndShare,
    table,
    docHeader,
    docFooter,
    divider,
    mergedBanner,
    noteBox,
    h,
    balColor,
  };
})();

function _pdfMergedPeriodLabel(record) {
  const ms = record.mergedSummary;
  const dr = ms && ms.dateRange;
  if (dr && dr.from && dr.to) {
    const fmt = d => {
      try {
        const dd = new Date(d);
        if (isNaN(dd.getTime())) return d;
        return dd.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: '2-digit' });
      } catch(e) { return d; }
    };
    return `${fmt(dr.from)} → ${fmt(dr.to)}`;
  }
  if (record.date) {
    try {
      const dd = new Date(record.date);
      if (!isNaN(dd.getTime()))
        return dd.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: '2-digit' });
    } catch(e) {}
  }
  return 'Prev. Year';
}
function _pdfMergedCountLabel(record) {
  const cnt = record.mergedRecordCount || (record.mergedSummary && record.mergedSummary.recordCount);
  return cnt ? `${cnt} txn${cnt !== 1 ? 's' : ''} merged` : 'year-end merge';
}
const PDF_MERGED_HDR_COLOR  = '#7e22ce';
const PDF_MERGED_ROW_COLOR  = '#f5ebff';

async function exportEntityToPDF() {
  const factoryInventoryData  = ensureArray(await sqliteStore.get('factory_inventory_data'));
  const paymentEntities       = ensureArray(await sqliteStore.get('payment_entities'));
  const paymentTransactions   = ensureArray(await sqliteStore.get('payment_transactions'));
  const expenseRecords        = ensureArray(await sqliteStore.get('expenses'));
  if (!currentEntityId) { showToast('No entity selected', 'warning'); return; }
  const entity = paymentEntities.find(e => String(e.id) === String(currentEntityId));
  if (!entity) { showToast('Entity not found', 'error'); return; }
  const fromEl = document.getElementById('entityPdfDateFrom');
  const toEl   = document.getElementById('entityPdfDateTo');
  const fromVal = fromEl ? fromEl.value : '';
  const toVal   = toEl   ? toEl.value   : '';
  showToast('Generating PDF…', 'info');
  try {
    let transactions = paymentTransactions.filter(t => String(t.entityId) === String(entity.id) && !t.isExpense);
    const now = new Date();
    if (fromVal || toVal) {
      transactions = transactions.filter(t => {
        if (!t.date) return false;
        const d = t.date.slice(0, 10);
        if (fromVal && d < fromVal) return false;
        if (toVal   && d > toVal)   return false;
        return true;
      });
    }
    transactions.sort((a, b) => {
      const da = new Date(a.date || 0); const db = new Date(b.date || 0);
      return da - db;
    });
    const isPayee    = entity.type === 'payee';
    const color      = isPayee ? '#e66414' : '#007ac8';
    const isSupplier = factoryInventoryData.some(m => String(m.supplierId) === String(entity.id));
    const supplierMaterials = isSupplier
      ? factoryInventoryData.filter(m => String(m.supplierId) === String(entity.id))
      : [];
    const rangeName = (fromVal || toVal)
      ? `${fromVal || 'Start'} → ${toVal || 'Today'}`
      : 'All Time';
    const { h, docHeader, docFooter, divider, mergedBanner, table } = NativePDF;
    let metaHTML = `
      <div class="doc-title" style="color:${color};">Account Statement · ${h(rangeName)}</div>
      <div class="doc-meta">
        <div class="kv"><span class="k">Name:</span><span class="v">${h(entity.name)}</span></div>
        <div class="kv"><span class="k">Phone:</span><span class="v">${h(entity.phone || 'N/A')}</span></div>
        ${entity.wallet ? `<div class="kv"><span class="k">Wallet:</span><span class="v">${h(entity.wallet)}</span></div>` : ''}
        <div class="kv"><span class="k">Generated:</span><span class="v">${h(now.toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}))}</span></div>
      </div>`;
    let txHTML = '';
    if (transactions.length > 0) {
      const mergedTxns = transactions.filter(t => t.isMerged);
      const normalTxns = transactions.filter(t => !t.isMerged);
      const buildTxRow = (t, runBal, isMerged = false) => {
        const amt   = parseFloat(t.amount) || 0;
        const isOut = t.type === 'OUT';
        runBal.val += isOut ? -amt : amt;
        const bal   = Math.abs(runBal.val) < 0.01 ? '' : fmtAmt(Math.abs(runBal.val));
        const desc  = isMerged
          ? [_pdfMergedPeriodLabel(t), _pdfMergedCountLabel(t)].join(' — ')
          : (t.description || '-').substring(0, 40);
        return {
          cells: [
            formatDisplayDate(t.date),
            desc,
            t.type,
            isOut ? fmtAmt(amt) : '-',
            !isOut ? fmtAmt(amt) : '-',
            bal,
          ],
          rowClass: isMerged ? 'row-merged' : '',
          _isOut: isOut,
          _bal: runBal.val,
          _balStr: bal,
        };
      };
      if (mergedTxns.length > 0) {
        txHTML += mergedBanner('YEAR-END OPENING BALANCES (Carried Forward)');
        const runBal = { val: 0 };
        const mergedRows = mergedTxns.map(t => buildTxRow(t, runBal, true));
        const mTotOut = mergedTxns.filter(t=>t.type==='OUT').reduce((s,t)=>s+(parseFloat(t.amount)||0),0);
        const mTotIn  = mergedTxns.filter(t=>t.type==='IN' ).reduce((s,t)=>s+(parseFloat(t.amount)||0),0);
        mergedRows.push({ cells: ['','SUBTOTAL','',fmtAmt(mTotOut),fmtAmt(mTotIn),''], rowClass: 'row-merged-sub' });
        txHTML += table({
          headers: ['Date','Year Period / Summary','Type','Payment OUT','Payment IN','Balance'],
          rows: mergedRows,
          colStyles: [
            { align:'center', width:'14%' },
            { align:'left',   width:'28%' },
            { align:'center', width:'8%' },
            { align:'right',  width:'14%', color:'#dc3545', bold:true },
            { align:'right',  width:'14%', color:'#28a745', bold:true },
            { align:'center', width:'12%', bold:true },
          ],
          headerColor: PDF_MERGED_HDR_COLOR,
        });
      }
      if (normalTxns.length > 0) {
        txHTML += `<div class="section-label" style="color:${color};">INDIVIDUAL TRANSACTIONS</div>`;
        const runBal = { val: 0 };
        const txRows = normalTxns.map(t => buildTxRow(t, runBal));
        const totOut = normalTxns.filter(t=>t.type==='OUT').reduce((s,t)=>s+(parseFloat(t.amount)||0),0);
        const totIn  = normalTxns.filter(t=>t.type==='IN' ).reduce((s,t)=>s+(parseFloat(t.amount)||0),0);
        const finalBal = totIn - totOut;
        const finalBalStr = Math.abs(finalBal) < 0.01 ? '' : fmtAmt(Math.abs(finalBal));
        txRows.push({ cells: ['','TOTAL','',fmtAmt(totOut),fmtAmt(totIn), finalBalStr], rowClass:'row-total' });
        txHTML += table({
          headers: ['Date','Description','Type','Payment OUT','Payment IN','Running Balance'],
          rows: txRows,
          colStyles: [
            { align:'center', width:'14%' },
            { align:'left',   width:'30%' },
            { align:'center', width:'8%' },
            { align:'right',  width:'14%', color:'#dc3545', bold:true },
            { align:'right',  width:'14%', color:'#28a745', bold:true },
            { align:'center', width:'12%', bold:true },
          ],
          headerColor: color,
        });
        const bColor = NativePDF.balColor(finalBal < 0 ? -finalBal : finalBal);
        txHTML += `<div class="summary-box" style="background:#f5f5f5;">
          <div class="item"><span class="label">Total OUT:</span><span class="c-red fw-700">${h(fmtAmt(totOut))}</span></div>
          <div class="item"><span class="label">Total IN:</span><span class="c-green fw-700">${h(fmtAmt(totIn))}</span></div>
          <div class="item"><span class="label">Net Balance:</span><span class="fw-800" style="color:${bColor};">${h(finalBalStr)}</span></div>
        </div>`;
      }
    } else {
      txHTML = `<p style="text-align:center;color:#aaa;padding:20px;">No payment transactions recorded for this period.</p>`;
    }
    let matHTML = '';
    if (isSupplier && supplierMaterials.length > 0) {
      matHTML += `<div class="section-label" style="color:${color};">SUPPLIER INVOICES — RAW MATERIAL PAYABLES</div>`;
      let totInvoice = 0, totPaid = 0, totRemaining = 0;
      const matRows = supplierMaterials
        .sort((a,b) => new Date(a.purchaseDate||a.date||0) - new Date(b.purchaseDate||b.date||0))
        .map(mat => {
          const orig = parseFloat((mat.totalValue || (mat.purchaseCost&&mat.purchaseQuantity ? mat.purchaseCost*mat.purchaseQuantity : (mat.quantity||0)*(mat.cost||0)) || 0).toFixed(2));
          const rem  = parseFloat(mat.totalPayable || 0);
          const paid = Math.max(0, orig - rem);
          totInvoice += orig; totPaid += paid; totRemaining += rem;
          const status = mat.paymentStatus === 'paid' || rem <= 0 ? 'PAID'
            : rem < orig ? 'PARTIAL' : 'PENDING';
          const qtyStr = mat.purchaseQuantity && mat.purchaseUnitName && mat.conversionFactor && mat.conversionFactor!==1
            ? `${fmtAmt(mat.purchaseQuantity)} ${mat.purchaseUnitName} (${fmtAmt(mat.quantity||0)} kg)`
            : `${fmtAmt(mat.quantity||0)} kg`;
          const statusColor = status==='PAID'?'#28a745':status==='PARTIAL'?'#c86400':'#dc3545';
          return {
            cells: [
              formatDisplayDate(mat.purchaseDate||mat.date||'') || '-',
              (mat.name||'Material').substring(0,25),
              qtyStr,
              fmtAmt(orig),
              paid>0?fmtAmt(paid):'-',
              rem>0?fmtAmt(rem):'-',
              { raw: `<span style="color:${statusColor};font-weight:700;">${status}</span>` },
            ],
            rowClass:'',
          };
        });
      matRows.push({ cells:['','TOTAL','',fmtAmt(totInvoice),fmtAmt(totPaid),fmtAmt(totRemaining), ''], rowClass:'row-total' });
      matHTML += table({
        headers: ['Invoice Date','Material','Qty','Invoice Amt','Paid So Far','Remaining','Status'],
        rows: matRows,
        colStyles: [
          { align:'center', width:'13%' },
          { align:'left',   width:'20%' },
          { align:'center', width:'14%' },
          { align:'right',  width:'12%', bold:true },
          { align:'right',  width:'12%', color:'#28a745', bold:true },
          { align:'right',  width:'12%', color:'#dc3545', bold:true },
          { align:'center', width:'10%', bold:true },
        ],
        headerColor: color,
      });
      matHTML += `<div class="summary-box" style="background:#fff5eb;">
        <div class="item"><span class="label">Total Invoiced:</span><span class="fw-700">${h(fmtAmt(totInvoice))}</span></div>
        <div class="item"><span class="label">Paid:</span><span class="c-green fw-700">${h(fmtAmt(totPaid))}</span></div>
        <div class="item"><span class="label">Outstanding:</span><span class="${totRemaining>0?'c-red':'c-gray'} fw-800">${h(fmtAmt(totRemaining))}</span></div>
      </div>`;
    }
    const bodyHTML = `<div class="page">
      ${docHeader(color, 'Naswar Manufacturers & Dealers')}
      ${metaHTML}
      ${divider(color)}
      ${txHTML}
      ${matHTML}
      ${docFooter(now)}
    </div>`;
    const dateStamp = new Date().toISOString().split('T')[0];
    const safeName  = entity.name.replace(/[^a-z0-9]/gi, '_');
    const filename  = `Entity_Statement_${safeName}_${dateStamp}`;
    await NativePDF.buildAndShare(bodyHTML, filename, entity.phone || '');
  } catch(err) {
    showToast('Error generating PDF: ' + err.message, 'error');
  }
}

async function exportCustomerToPDF() {
  const customerSales      = ensureArray(await sqliteStore.get('customer_sales'));
  const salesCustomers     = ensureArray(await sqliteStore.get('sales_customers'));
  const paymentTransactions= ensureArray(await sqliteStore.get('payment_transactions'));
  const titleElement = document.getElementById('manageCustomerTitle');
  if (!titleElement) { showToast('No customer selected', 'warning'); return; }
  const titleHTML    = titleElement.innerHTML;
  const nameMatch    = titleHTML.match(/<span>([^<]+)<\/span>/) || titleHTML.match(/^([^<]+)/);
  const customerName = nameMatch ? nameMatch[1].trim() : titleElement.innerText.split('\n')[0].trim();
  if (!customerName) { showToast('No customer selected', 'warning'); return; }
  const fromEl  = document.getElementById('customerPdfDateFrom');
  const toEl    = document.getElementById('customerPdfDateTo');
  const fromVal = fromEl ? fromEl.value : '';
  const toVal   = toEl   ? toEl.value   : '';
  showToast('Generating PDF…', 'info');
  try {
    let transactions = customerSales.filter(s => s && s.customerName === customerName);
    const now = new Date();
    if (fromVal || toVal) {
      transactions = transactions.filter(t => {
        if (t.transactionType === 'OLD_DEBT') return true;
        if (!t.date) return false;
        const d = t.date.slice(0, 10);
        if (fromVal && d < fromVal) return false;
        if (toVal   && d > toVal)   return false;
        return true;
      });
    }
    transactions.sort((a,b) => {
      if (a.isMerged && !b.isMerged) return -1;
      if (!a.isMerged && b.isMerged) return 1;
      const ap = (a.paymentType==='CREDIT' && !a.creditReceived) ? 1 : 0;
      const bp = (b.paymentType==='CREDIT' && !b.creditReceived) ? 1 : 0;
      if (bp !== ap) return bp - ap;
      return new Date(a.date) - new Date(b.date);
    });
    const salesContact = salesCustomers.find(c => c && c.name && c.name.toLowerCase() === customerName.toLowerCase());
    const phone   = salesContact?.phone || transactions.find(t=>t.customerPhone)?.customerPhone || 'N/A';
    const address = salesContact?.address || transactions.find(t=>t.customerAddress)?.customerAddress || 'N/A';
    const color      = '#28a745';
    const rangeName  = (fromVal||toVal) ? `${fromVal||'Start'} → ${toVal||'Today'}` : 'All Time';
    const { h, docHeader, docFooter, divider, mergedBanner, table } = NativePDF;
    const typeColor = txt => {
      if (txt.includes('CASH') || txt.includes('COLLECTION')) return '#28a745';
      if (txt.includes('CREDIT') || txt.includes('PARTIAL'))  return '#c86400';
      if (txt.includes('OLD DEBT')) return '#dc3545';
      return '#333';
    };
    const buildSaleRow = async (t, runBal) => {
      const pt = t.paymentType || 'CASH';
      const isOldDebt = t.transactionType === 'OLD_DEBT';
      let debit = 0, credit = 0, typeLabel = '', detailLabel = '', displayDate = formatDisplayDate(t.date);
      if (isOldDebt) {
        debit = parseFloat(t.totalValue)||0; credit = parseFloat(t.partialPaymentReceived)||0;
        typeLabel='OLD DEBT'; detailLabel=t.notes||'Brought forward';
      } else if (pt==='CASH') {
        const val = await getSaleTransactionValue(t);
        debit=val; credit=val; typeLabel='CASH';
        const up = (t.unitPrice&&t.unitPrice>0)?t.unitPrice:await getEffectiveSalePriceForCustomer(t.customerName,t.supplyStore||'STORE_A');
        detailLabel=`${fmtAmt(t.quantity||0)} kg × ${fmtAmt(up)}`;
      } else if (pt==='CREDIT' && !t.creditReceived) {
        const val = await getSaleTransactionValue(t);
        const partial = parseFloat(t.partialPaymentReceived)||0;
        debit=val; credit=partial;
        typeLabel=partial>0?'CREDIT (PARTIAL)':'CREDIT';
        const up = (t.unitPrice&&t.unitPrice>0)?t.unitPrice:await getEffectiveSalePriceForCustomer(t.customerName,t.supplyStore||'STORE_A');
        detailLabel=`${fmtAmt(t.quantity||0)} kg × ${fmtAmt(up)}`;
        if (partial>0) detailLabel+=` | ${fmtAmt(partial)} / ${fmtAmt(val-partial)}`;
      } else if (pt==='CREDIT' && t.creditReceived) {
        const val = await getSaleTransactionValue(t);
        debit=val; credit=val; typeLabel='CREDIT (PAID)';
        const up = (t.unitPrice&&t.unitPrice>0)?t.unitPrice:await getEffectiveSalePriceForCustomer(t.customerName,t.supplyStore||'STORE_A');
        detailLabel=`${fmtAmt(t.quantity||0)} kg × ${fmtAmt(up)}`;
        displayDate=formatDisplayDate(t.creditReceivedDate||t.date);
      } else if (pt==='COLLECTION') {
        credit=parseFloat(t.totalValue)||0; typeLabel='COLLECTION';
        detailLabel='Cash payment received'; displayDate=formatDisplayDate(t.creditReceivedDate||t.date);
      } else if (pt==='PARTIAL_PAYMENT') {
        credit=parseFloat(t.totalValue)||0; typeLabel='PARTIAL PAYMENT';
        detailLabel='Partial payment received'; displayDate=formatDisplayDate(t.creditReceivedDate||t.date);
      }
      runBal.val += (debit - credit);
      const balStr = Math.abs(runBal.val)<0.01 ? ''
        : runBal.val>0 ? fmtAmt(runBal.val) : fmtAmt(Math.abs(runBal.val));
      return { debit, credit, qty: t.quantity||0, typeLabel,
        cells: [displayDate, typeLabel, detailLabel.substring(0,55),
          debit>0?fmtAmt(debit):'-', credit>0?fmtAmt(credit):'-', balStr] };
    };
    let txHTML = '';
    if (transactions.length > 0) {
      const mergedTxns = transactions.filter(t => t.isMerged);
      const normalTxns = transactions.filter(t => !t.isMerged);
      if (mergedTxns.length > 0) {
        txHTML += mergedBanner('YEAR-END OPENING BALANCES (Carried Forward)');
        const mRunBal = { val: 0 };
        const mergedRows = mergedTxns.map(t => {
          const ms = t.mergedSummary || {};
          const netOut = ms.netOutstanding != null ? ms.netOutstanding : (t.totalValue||0);
          mRunBal.val += netOut;
          const isSettled = ms.isSettled || t.creditReceived;
          const balTxt = isSettled ? '' : fmtAmt(netOut);
          const typeLabel = isSettled ? 'SETTLED (MERGED)' : (t.paymentType==='CREDIT'?'CREDIT (MERGED)':'CASH (MERGED)');
          return {
            cells: [formatDisplayDate(t.date), typeLabel,
              [_pdfMergedPeriodLabel(t), _pdfMergedCountLabel(t), !isSettled?fmtAmt(netOut):''].join(' — '),
              netOut>0?fmtAmt(netOut):'-', isSettled?fmtAmt(ms.cashSales||0):'-', balTxt],
            rowClass: 'row-merged',
          };
        });
        const mNetTotal = mergedTxns.reduce((s,t)=>s+((t.mergedSummary?.netOutstanding)||t.totalValue||0),0);
        mergedRows.push({ cells:['','SUBTOTAL',`${mergedTxns.length} year-end records`,mNetTotal>0?fmtAmt(mNetTotal):'-','',mNetTotal<=0.01?'':fmtAmt(mNetTotal)], rowClass:'row-merged-sub' });
        txHTML += table({
          headers: ['Date','Type','Year Period / Summary','Outstanding','Settled','Balance'],
          rows: mergedRows,
          colStyles: [
            {align:'center',width:'13%'},{align:'center',width:'16%',bold:true},
            {align:'left',width:'32%'},{align:'right',width:'13%',color:'#dc3545',bold:true},
            {align:'right',width:'13%',color:'#28a745',bold:true},{align:'center',width:'13%',bold:true},
          ],
          headerColor: PDF_MERGED_HDR_COLOR,
        });
      }
      if (normalTxns.length > 0) {
        txHTML += `<div class="section-label" style="color:${color};">INDIVIDUAL TRANSACTIONS</div>`;
        const txRunBal = { val: 0 };
        const txRows = [];
        let totDebit=0, totCredit=0, totQty=0;
        for (const t of normalTxns) {
          const r = await buildSaleRow(t, txRunBal);
          txRows.push({ cells: r.cells, rowClass: '' });
          totDebit += r.debit; totCredit += r.credit; totQty += r.qty;
        }
        const finalBal = totDebit - totCredit;
        const finalBalStr = Math.abs(finalBal)<0.01?'':finalBal>0?fmtAmt(finalBal):fmtAmt(Math.abs(finalBal));
        txRows.push({ cells:['TOTALS','',`${fmtAmt(totQty)} kg total`,fmtAmt(totDebit),fmtAmt(totCredit),finalBalStr], rowClass:'row-total-green' });
        txHTML += table({
          headers: ['Date','Type','Details','Debit (Sale)','Credit (Rcvd)','Balance'],
          rows: txRows,
          colStyles: [
            {align:'center',width:'13%'},{align:'center',width:'15%',bold:true},
            {align:'left',width:'32%'},{align:'right',width:'13%',color:'#dc3545',bold:true},
            {align:'right',width:'13%',color:'#28a745',bold:true},{align:'center',width:'14%',bold:true},
          ],
          headerColor: color,
        });
        const bColor = NativePDF.balColor(finalBal);
        txHTML += `<div class="summary-box" style="background:#f0fff4;border:1px solid #c3e6cb;">
          <div class="item"><span class="label">Total Debit:</span><span class="c-red fw-700">${h(fmtAmt(totDebit))}</span></div>
          <div class="item"><span class="label">Total Credit:</span><span class="c-green fw-700">${h(fmtAmt(totCredit))}</span></div>
          <div class="item"><span class="label">Balance:</span><span class="fw-800" style="color:${bColor};">${h(finalBalStr)}</span></div>
        </div>`;
      }
    } else {
      txHTML = `<p style="text-align:center;color:#aaa;padding:20px;">No sales recorded for this period.</p>`;
    }
    const bodyHTML = `<div class="page">
      ${docHeader(color, 'Naswar Manufacturers & Dealers')}
      <div class="doc-title">Customer Account Statement · ${h(rangeName)}</div>
      <div class="doc-meta">
        <div class="kv"><span class="k">Customer:</span><span class="v">${h(customerName)}</span></div>
        <div class="kv"><span class="k">Phone:</span><span class="v">${h(phone)}</span></div>
        <div class="kv"><span class="k">Address:</span><span class="v">${h(address.substring(0,60))}</span></div>
        <div class="kv"><span class="k">Generated:</span><span class="v">${h(now.toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}))}</span></div>
      </div>
      ${divider(color)}
      ${txHTML}
      ${docFooter(now)}
    </div>`;
    const dateStamp    = new Date().toISOString().split('T')[0];
    const safeCustName = customerName.replace(/[^a-z0-9]/gi,'_');
    const filename     = `Customer_Statement_${safeCustName}_${dateStamp}`;
    await NativePDF.buildAndShare(bodyHTML, filename, phone);
  } catch(err) {
    showToast('Error generating PDF: ' + err.message, 'error');
  }
}

async function exportCustomerData(type) {
  const paymentEntities    = ensureArray(await sqliteStore.get('payment_entities'));
  const paymentTransactions= ensureArray(await sqliteStore.get('payment_transactions'));
  const factorySalePrices  = (await sqliteStore.get('factory_sale_prices')) || {};
  const customerSales      = ensureArray(await sqliteStore.get('customer_sales'));
  const repSales           = ensureArray(await sqliteStore.get('rep_sales'));
  showToast('Generating PDF…', 'info');
  try {
    const fileName  = type === 'rep' ? 'My_Customer_List' : 'All_Customers_List';
    const salesData = type === 'rep' ? repSales : customerSales;
    const color     = '#28a745';
    let hasMergedEntries = false;
    const customerMap = new Map();
    const initCust = name => ({ name, phone:'N/A', address:'N/A', debt:0, paid:0, qty:0, lastDate:'', lastType:'' });
    salesData.forEach(sale => {
      if (type==='rep' && sale.salesRep !== currentRepProfile) return;
      const name = sale.customerName; if (!name) return;
      if (!customerMap.has(name)) customerMap.set(name, initCust(name));
      const cust = customerMap.get(name);
      if (sale.customerPhone) cust.phone = sale.customerPhone;
      if (sale.customerAddress) cust.address = sale.customerAddress;
      if (sale.isMerged) {
        hasMergedEntries = true;
        const ms = sale.mergedSummary||{};
        const net = ms.netOutstanding!=null?ms.netOutstanding:(sale.totalValue||0);
        cust.debt += (net + (ms.cashSales||0)); cust.paid += (ms.cashSales||0);
        cust.qty += (sale.quantity||0);
        if (sale.date > cust.lastDate) { cust.lastDate=sale.date; cust.lastType='MERGED'; }
        return;
      }
      const sp = sale.totalValue&&sale.quantity&&sale.quantity>0&&!['COLLECTION','PARTIAL_PAYMENT'].includes(sale.paymentType)
        ? sale.totalValue/sale.quantity
        : (sale.supplyStore==='STORE_C'?(factorySalePrices?.asaan||0):(factorySalePrices?.standard||0));
      if (sale.paymentType==='CREDIT'&&!sale.creditReceived) {
        const val=sale.totalValue||(sale.quantity||0)*sp;
        cust.debt+=val; cust.paid+=parseFloat(sale.partialPaymentReceived)||0; cust.qty+=(sale.quantity||0);
      } else if (sale.paymentType==='CASH') {
        const val=sale.totalValue||(sale.quantity||0)*sp;
        cust.debt+=val; cust.paid+=val; cust.qty+=(sale.quantity||0);
      } else if (sale.paymentType==='CREDIT'&&sale.creditReceived) {
        const val=sale.totalValue||(sale.quantity||0)*sp;
        cust.debt+=val; cust.paid+=val; cust.qty+=(sale.quantity||0);
      } else if (sale.paymentType==='COLLECTION') {
        cust.paid+=(sale.totalValue||0);
      } else if (sale.paymentType==='PARTIAL_PAYMENT') {
        cust.paid+=(sale.totalValue||0);
      }
      if (sale.date > cust.lastDate) { cust.lastDate=sale.date; cust.lastType=sale.paymentType; }
    });
    if (type==='admin') {
      paymentEntities.forEach(entity => {
        const txs = paymentTransactions.filter(t=>String(t.entityId)===String(entity.id));
        if (!(txs.some(t=>t.type==='IN') && !txs.some(t=>t.type==='OUT'))) return;
        if (!customerMap.has(entity.name)) {
          const nc=initCust(entity.name); nc.phone=entity.phone||'N/A'; nc.address=entity.address||'N/A';
          customerMap.set(entity.name,nc);
        } else {
          const ex=customerMap.get(entity.name);
          if (ex.phone==='N/A'&&entity.phone) ex.phone=entity.phone;
          if (ex.address==='N/A'&&entity.address) ex.address=entity.address;
        }
      });
    }
    if (customerMap.size === 0) { showToast('No customers found to export.','warning'); return; }
    const { h, docHeader, docFooter, divider, noteBox, table } = NativePDF;
    const now = new Date();
    let totDebt=0, totPaid=0, totQty=0, totNet=0, cntDebtors=0, cntSettled=0;
    const sorted = [...customerMap.values()].sort((a,b)=>(b.debt-b.paid)-(a.debt-a.paid));
    const custRows = sorted.map(cust => {
      const net = cust.debt - cust.paid;
      totDebt+=cust.debt; totPaid+=cust.paid; totQty+=cust.qty; totNet+=net;
      if (net>0.01) cntDebtors++; else cntSettled++;
      const netStr = Math.abs(net)<0.01?'':net>0?fmtAmt(net):fmtAmt(Math.abs(net));
      return { cells:[cust.name,cust.phone,cust.address.substring(0,35),
        cust.debt>0?fmtAmt(cust.debt):'-', cust.paid>0?fmtAmt(cust.paid):'-',
        netStr, fmtAmt(cust.qty), formatDisplayDate(cust.lastDate)||'-'], rowClass:'' };
    });
    const totNetStr = Math.abs(totNet)<0.01?'':totNet>0?fmtAmt(totNet):fmtAmt(Math.abs(totNet));
    custRows.push({ cells:[`TOTAL (${customerMap.size} customers)`,'','',fmtAmt(totDebt),fmtAmt(totPaid),totNetStr,fmtAmt(totQty),''], rowClass:'row-total-green' });
    const titleText = type==='rep' ? `My Customers — ${currentRepProfile||''}` : 'All Customers — Complete List';
    const bodyHTML = `<div class="page">
      ${docHeader(color, 'Naswar Manufacturers & Dealers')}
      <div class="doc-title">${h(titleText)}</div>
      <div class="doc-meta" style="justify-content:center;">
        <div class="kv"><span class="k">Generated:</span><span class="v">${h(now.toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}))} at ${h(now.toLocaleTimeString('en-US'))}</span></div>
      </div>
      ${divider(color)}
      ${table({
        headers:['Customer Name','Phone','Address','Total Debit','Total Credit','Net Balance','Qty (kg)','Last Sale'],
        rows: custRows,
        colStyles:[
          {align:'left',width:'16%'},{align:'center',width:'10%'},
          {align:'left',width:'17%'},{align:'right',width:'10%',color:'#dc3545',bold:true},
          {align:'right',width:'10%',color:'#28a745',bold:true},{align:'center',width:'12%',bold:true},
          {align:'right',width:'8%'},{align:'center',width:'9%'},
        ],
        headerColor: color,
      })}
      <div class="summary-box" style="background:#f0fff4;font-size:8px;color:#555;">
        ${cntDebtors} with debt | ${cntSettled} settled | ${h(fmtAmt(Math.max(totNet,0)))}
      </div>
      ${hasMergedEntries ? noteBox('Balances include year-end opening balance records (MERGED) from Close Financial Year — these represent carried-forward net positions.') : ''}
      ${docFooter(now)}
    </div>`;
    NativePDF.buildAndDownload(bodyHTML, fileName, { landscape: true });
    showToast(`Exported ${customerMap.size} customers successfully!`, 'success');
  } catch(err) {
    showToast('Error generating PDF: ' + err.message, 'error');
  }
}

async function exportUnifiedData() {
  const factoryInventoryData = ensureArray(await sqliteStore.get('factory_inventory_data'));
  const paymentEntities      = ensureArray(await sqliteStore.get('payment_entities'));
  const paymentTransactions  = ensureArray(await sqliteStore.get('payment_transactions'));
  const expenseRecords       = ensureArray(await sqliteStore.get('expenses'));
  const viewModeEl     = document.getElementById('unifiedViewMode');
  const periodFilterEl = document.getElementById('unifiedPeriodFilter');
  if (!viewModeEl || !periodFilterEl) { showToast('Export failed. Please try again.', 'error'); return; }
  const viewMode    = viewModeEl.value || 'entities';
  const periodFilter= periodFilterEl.value || 'all';
  showToast('Generating PDF…', 'info');
  try {
    const { h, docHeader, docFooter, divider, mergedBanner, noteBox, table } = NativePDF;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let startDate = new Date(0);
    if (periodFilter==='today') startDate=today;
    else if (periodFilter==='week')  { startDate=new Date(today); startDate.setDate(today.getDate()-7); }
    else if (periodFilter==='month') { startDate=new Date(today); startDate.setDate(today.getDate()-30); }
    const periodName = periodFilter==='all'?'All Time':periodFilter==='today'?'Today':periodFilter==='week'?'This Week':'This Month';
    const isEntities = viewMode==='entities';
    const color = isEntities ? '#009688' : '#ff9500';
    const titleText = isEntities ? 'Payment Entities — Balances & Ledger' : 'Expenses — Transaction Records';
    let contentHTML = '';
    if (isEntities) {
      const supplierIdSet = new Set();
      factoryInventoryData.forEach(m => { if (m.supplierId) supplierIdSet.add(String(m.supplierId)); });
      const supplierBalances = {};
      factoryInventoryData.forEach(mat => {
        if (mat.supplierId && mat.paymentStatus==='pending' && mat.totalPayable>0) {
          const sid=String(mat.supplierId);
          supplierBalances[sid]=(supplierBalances[sid]||0)+mat.totalPayable;
        }
      });
      const entityNetBalances={}, entityMergedInfo={};
      paymentEntities.forEach(e => {
        if (e.isExpenseEntity||supplierIdSet.has(String(e.id))) return;
        entityNetBalances[e.id]=0;
      });
      paymentTransactions.forEach(t => {
        if (t.isExpense||supplierIdSet.has(String(t.entityId))) return;
        if (entityNetBalances[t.entityId]!==undefined) {
          const amt=parseFloat(t.amount)||0;
          if (t.type==='OUT') entityNetBalances[t.entityId]-=amt;
          else if (t.type==='IN') entityNetBalances[t.entityId]+=amt;
          if (t.isMerged&&t.mergedSummary) {
            entityMergedInfo[t.entityId]=entityMergedInfo[t.entityId]||[];
            entityMergedInfo[t.entityId].push({ period:_pdfMergedPeriodLabel(t), count:_pdfMergedCountLabel(t) });
          }
        }
      });
      let totPayable=0, totReceivable=0;
      const entityRows=[], pdfEntityList=[];
      paymentEntities.filter(e=>!e.isExpenseEntity).forEach(entity => {
        const sid=String(entity.id);
        let balance=0, source='Transactions';
        if (supplierIdSet.has(sid)) { balance=-(supplierBalances[sid]||0); source='Inventory'; }
        else balance=entityNetBalances[entity.id]||0;
        if (balance<-0.01) totPayable+=Math.abs(balance);
        if (balance>0.01)  totReceivable+=balance;
        const hasMerged=!!entityMergedInfo[entity.id];
        const balDisplay=Math.abs(balance)<0.01?'':balance<0?fmtAmt(Math.abs(balance)):fmtAmt(balance);
        const balNote=Math.abs(balance)<0.01?'':balance<0?'PAYABLE':'RECEIVABLE';
        entityRows.push({
          cells:[entity.name+(hasMerged?'\n★ Year-end balance':''),supplierIdSet.has(sid)?'SUPPLIER':'ENTITY',
            entity.phone||'N/A', hasMerged?'Year-End\n'+source:source, balDisplay, balNote],
          rowClass: hasMerged?'row-merged':'',
        });
        pdfEntityList.push(entity);
      });
      entityRows.push({ cells:[`TOTAL (${entityRows.length} entities)`,'','','',
        `Payable: ${fmtAmt(totPayable)} / Receivable: ${fmtAmt(totReceivable)}`,
        `Net: ${fmtAmt(Math.abs(totReceivable-totPayable))}`],
        rowClass:'row-total-blue' });
      contentHTML += table({
        headers:['Name','Type','Phone','Balance Source','Balance','Status'],
        rows: entityRows,
        colStyles:[
          {align:'left',width:'26%'},{align:'center',width:'11%'},{align:'center',width:'14%'},
          {align:'center',width:'13%'},{align:'right',width:'18%',bold:true},{align:'center',width:'12%',bold:true},
        ],
        headerColor: color,
      });
      contentHTML += `<div class="summary-box" style="background:#e0f7f5;font-size:8px;">
        Total Payables: ${h(fmtAmt(totPayable))} | Total Receivables: ${h(fmtAmt(totReceivable))} | Net: ${h(fmtAmt(Math.abs(totReceivable-totPayable)))} 
      </div>`;
      if (Object.keys(entityMergedInfo).length>0) {
        contentHTML += noteBox('Highlighted rows contain year-end opening balances (MERGED) from Close Financial Year.');
      }
    } else {
      let expenses = expenseRecords.filter(exp=>exp&&exp.category==='operating');
      if (periodFilter!=='all') expenses=expenses.filter(exp=>exp.date&&new Date(exp.date)>=startDate);
      expenses.sort((a,b)=>new Date(b.date)-new Date(a.date));
      if (expenses.length > 0) {
        const nameGroups={};
        expenses.forEach(exp=>{ const k=exp.name||'Unnamed'; nameGroups[k]=(nameGroups[k]||0)+(parseFloat(exp.amount)||0); });
        const mergedExp = expenses.filter(e=>e.isMerged);
        const normalExp = expenses.filter(e=>!e.isMerged);
        if (mergedExp.length>0) {
          contentHTML += mergedBanner('YEAR-END EXPENSE SUMMARIES (Carried Forward)');
          const mRows = mergedExp.map(e=>({
            cells:[_pdfMergedPeriodLabel(e),e.name||'-',e.category||'operating',
              `${_pdfMergedCountLabel(e)} — ${(e.description||'').substring(0,35)}`,
              fmtAmt(parseFloat(e.amount)||0)],
            rowClass:'row-merged',
          }));
          const mTot = mergedExp.reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
          mRows.push({ cells:['','','','SUBTOTAL ('+mergedExp.length+' groups)',fmtAmt(mTot)], rowClass:'row-merged-sub' });
          contentHTML += table({
            headers:['Year Period','Name / Vendor','Category','Summary','Total Amount'],
            rows: mRows,
            colStyles:[
              {align:'center',width:'16%'},{align:'left',width:'18%'},{align:'center',width:'12%'},
              {align:'left',width:'34%'},{align:'right',width:'14%',bold:true},
            ],
            headerColor: PDF_MERGED_HDR_COLOR,
          });
        }
        if (normalExp.length>0) {
          contentHTML += `<div class="section-label" style="color:${color};">INDIVIDUAL EXPENSE RECORDS</div>`;
          const expRows = normalExp.map(e=>({ cells:[
            formatDisplayDate(e.date)||e.date||'', e.name||'-', e.category||'operating',
            (e.description||'-').substring(0,45), fmtAmt(parseFloat(e.amount)||0)], rowClass:'' }));
          const totalAmt = expenses.reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
          expRows.push({ cells:['','','','TOTAL ('+expenses.length+' records)',fmtAmt(totalAmt)], rowClass:'row-total-orange' });
          contentHTML += table({
            headers:['Date','Name / Vendor','Category','Description','Amount'],
            rows: expRows,
            colStyles:[
              {align:'center',width:'12%'},{align:'left',width:'20%'},{align:'center',width:'11%'},
              {align:'left',width:'37%'},{align:'right',width:'14%',color:'#dc3545',bold:true},
            ],
            headerColor: color,
          });
          if (Object.keys(nameGroups).length>1) {
            const bkRows = Object.entries(nameGroups).sort(([,a],[,b])=>b-a)
              .map(([name,total])=>`<div class="bk-row"><span class="bk-name">${h(name.substring(0,30))}</span><span class="bk-amt">${h(fmtAmt(total))}</span></div>`)
              .join('');
            contentHTML += `<div class="breakdown"><div style="font-size:9px;font-weight:700;padding:4px 0 2px;color:#333;">Breakdown by Expense Name:</div>${bkRows}</div>`;
          }
        }
      } else {
        contentHTML = `<p style="text-align:center;color:#aaa;padding:20px;">No expense records found for this period.</p>`;
      }
    }
    const bodyHTML = `<div class="page">
      ${docHeader(color, 'Naswar Manufacturers & Dealers')}
      <div class="doc-title">${h(titleText)} · ${h(periodName)}</div>
      <div class="doc-meta" style="justify-content:center;">
        <div class="kv"><span class="k">Generated:</span><span class="v">${h(now.toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}))} at ${h(now.toLocaleTimeString('en-US'))}</span></div>
      </div>
      ${divider(color)}
      ${contentHTML}
      ${docFooter(now)}
    </div>`;
    const filename = `Unified_Statement_${viewMode}_${periodFilter}_${new Date().toISOString().split('T')[0]}`;
    NativePDF.buildAndDownload(bodyHTML, filename);
    showToast('PDF exported successfully!', 'success');
  } catch(err) {
    showToast('Error generating PDF: ' + err.message, 'error');
  }
}

async function exportExpenseOverlayToPDF() {
  const expenseRecords = ensureArray(await sqliteStore.get('expenses'));
  const expenseName    = currentExpenseOverlayName;
  if (!expenseName) { showToast('No expense selected','warning'); return; }
  const fromEl  = document.getElementById('expenseDateFrom');
  const toEl    = document.getElementById('expenseDateTo');
  const fromVal = fromEl ? fromEl.value : '';
  const toVal   = toEl   ? toEl.value   : '';
  showToast('Generating PDF…', 'info');
  try {
    let records = expenseRecords.filter(e=>e.category==='operating' && e.name && e.name.toLowerCase()===expenseName.toLowerCase());
    if (fromVal||toVal) {
      records = records.filter(e=>{
        if (!e.date) return false;
        const d=e.date.slice(0,10);
        if (fromVal&&d<fromVal) return false;
        if (toVal&&d>toVal) return false;
        return true;
      });
    }
    records.sort((a,b)=>new Date(a.date)-new Date(b.date));
    const total    = records.reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
    const rangeName= (fromVal||toVal) ? `${fromVal||'Start'} → ${toVal||'Today'}` : 'All Time';
    const color    = '#ff9500';
    const now      = new Date();
    const { h, docHeader, docFooter, divider, mergedBanner, table } = NativePDF;
    let contentHTML = '';
    if (records.length > 0) {
      const mergedRecs = records.filter(e=>e.isMerged);
      const normalRecs = records.filter(e=>!e.isMerged);
      if (mergedRecs.length>0) {
        contentHTML += mergedBanner('YEAR-END EXPENSE SUMMARIES (Carried Forward)');
        const mRows = mergedRecs.map(e=>({
          cells:[_pdfMergedPeriodLabel(e),`${_pdfMergedCountLabel(e)} — ${(e.description||'Year-end merged total').substring(0,45)}`,
            fmtAmt(parseFloat(e.amount)||0),'★ MERGED'],
          rowClass:'row-merged',
        }));
        const mTot=mergedRecs.reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
        mRows.push({ cells:['','SUBTOTAL ('+mergedRecs.length+' year periods)',fmtAmt(mTot),''], rowClass:'row-merged-sub' });
        contentHTML += table({
          headers:['Year Period','Summary','Amount','Note'],
          rows:mRows,
          colStyles:[{align:'center',width:'17%'},{align:'left',width:'50%'},{align:'right',width:'17%',bold:true},{align:'center',width:'16%',bold:true}],
          headerColor: PDF_MERGED_HDR_COLOR,
        });
      }
      if (normalRecs.length>0) {
        if (mergedRecs.length>0) contentHTML += `<div class="section-label" style="color:${color};">INDIVIDUAL EXPENSE RECORDS</div>`;
        let runningTotal=0;
        const expRows = normalRecs.map(e=>{
          runningTotal+=parseFloat(e.amount)||0;
          return { cells:[formatDisplayDate(e.date)||e.date||'-',(e.description||'No description').substring(0,55),
            fmtAmt(parseFloat(e.amount)||0),fmtAmt(runningTotal)], rowClass:'' };
        });
        expRows.push({ cells:['','TOTAL ('+records.length+' entries)',fmtAmt(total),''], rowClass:'row-total-orange' });
        contentHTML += table({
          headers:['Date','Description','Amount','Cumulative Total'],
          rows:expRows,
          colStyles:[
            {align:'center',width:'14%'},{align:'left',width:'50%'},
            {align:'right',width:'18%',color:'#dc3545',bold:true},{align:'right',width:'18%',color:'#ff9500',bold:true},
          ],
          headerColor: color,
        });
      }
    } else {
      contentHTML = `<p style="text-align:center;color:#aaa;padding:20px;">No expense records found for "${expenseName}" in the selected period.</p>`;
    }
    const bodyHTML = `<div class="page">
      ${docHeader(color, 'Naswar Manufacturers & Dealers')}
      <div class="doc-title">Expense History: ${h(expenseName)}</div>
      <div class="doc-meta">
        <div class="kv"><span class="k">Period:</span><span class="v">${h(rangeName)}</span></div>
        <div class="kv"><span class="k">Records:</span><span class="v">${records.length}</span></div>
        <div class="kv"><span class="k">Total:</span><span class="v c-orange fw-700">${h(fmtAmt(total))}</span></div>
        <div class="kv"><span class="k">Generated:</span><span class="v">${h(now.toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}))} at ${h(now.toLocaleTimeString('en-US'))}</span></div>
      </div>
      ${divider(color)}
      ${contentHTML}
      ${docFooter(now)}
    </div>`;
    const filename = `Expense_${expenseName.replace(/\s+/g,'_')}_${new Date().toISOString().split('T')[0]}`;
    NativePDF.buildAndDownload(bodyHTML, filename);
    showToast('PDF exported successfully', 'success');
  } catch(err) {
    showToast('Failed to export PDF: ' + err.message, 'error');
  }
}

async function exportRepCustomerToPDF() {
  const repCustomers = ensureArray(await sqliteStore.get('rep_customers'));
  const titleElement = document.getElementById('repManageCustomerTitle');
  if (!titleElement) { showToast('No rep customer selected','warning'); return; }
  const customerName = (typeof currentManagingRepCustomer === 'string' && currentManagingRepCustomer.trim())
    ? currentManagingRepCustomer.trim()
    : (() => {
        const html = titleElement.innerHTML;
        const m = html.match(/<span>([^<]+)<\/span>/) || html.match(/^([^<]+)/);
        return m ? m[1].trim() : titleElement.innerText.split('\n')[0].trim();
      })();
  if (!customerName) { showToast('No rep customer selected','warning'); return; }
  const fromEl  = document.getElementById('repCustomerPdfDateFrom');
  const toEl    = document.getElementById('repCustomerPdfDateTo');
  const fromVal = fromEl ? fromEl.value : '';
  const toVal   = toEl   ? toEl.value   : '';
  showToast('Generating PDF…', 'info');
  try {
    let allRepSales = ensureArray(await sqliteStore.get('rep_sales'));
    try {
      const dbSales = await sqliteStore.get('rep_sales', []);
      if (Array.isArray(dbSales)) {
        const recordMap = new Map(dbSales.filter(s => s && s.id).map(s => [s.id, s]));
        allRepSales.forEach(s => { if (s && s.id && !recordMap.has(s.id)) recordMap.set(s.id, s); });
        allRepSales = Array.from(recordMap.values());
      }
    } catch(e) {  }
    let transactions = allRepSales.filter(s => s.customerName === customerName && s.salesRep === currentRepProfile);
    const now = new Date();
    if (fromVal||toVal) {
      transactions = transactions.filter(t=>{
        if (t.transactionType==='OLD_DEBT') return true;
        if (!t.date) return false;
        const d=t.date.slice(0,10);
        if (fromVal&&d<fromVal) return false;
        if (toVal&&d>toVal)   return false;
        return true;
      });
    }
    transactions.sort((a,b)=>{
      if (a.isMerged&&!b.isMerged) return -1;
      if (!a.isMerged&&b.isMerged) return 1;
      const ap=(a.paymentType==='CREDIT'&&!a.creditReceived)?1:0;
      const bp=(b.paymentType==='CREDIT'&&!b.creditReceived)?1:0;
      if (bp!==ap) return bp-ap;
      return new Date(a.date)-new Date(b.date);
    });
    const repContact = repCustomers.find(c=>c&&c.name&&c.name.toLowerCase()===customerName.toLowerCase());
    const phone   = repContact?.phone || transactions.find(t=>t.customerPhone)?.customerPhone || 'N/A';
    const address = repContact?.address || 'N/A';
    const color   = '#4f46e5';
    const rangeName = (fromVal||toVal)?`${fromVal||'Start'} → ${toVal||'Today'}`:'All Time';
    const { h, docHeader, docFooter, divider, table } = NativePDF;
    const buildRow = (t, runBal) => {
      const pt=t.paymentType||'CASH';
      const isOldDebt=t.transactionType==='OLD_DEBT';
      let debit=0,credit=0,typeLabel='',detailLabel='',displayDate=formatDisplayDate(t.date);
      const unitPrice=(t.unitPrice&&t.unitPrice>0)?t.unitPrice:getSalePriceForStore(t.supplyStore||'STORE_A');
      if (isOldDebt) {
        debit=parseFloat(t.totalValue)||0; credit=parseFloat(t.partialPaymentReceived)||0;
        typeLabel='OLD DEBT'; detailLabel=t.notes||'Brought forward';
      } else if (pt==='CASH') {
        const val=t.totalValue||0; debit=val; credit=val; typeLabel='CASH';
        detailLabel=`${fmtAmt(t.quantity||0)} kg × ${fmtAmt(unitPrice)}`;
      } else if (pt==='CREDIT'&&!t.creditReceived) {
        const val=t.totalValue||0; const partial=parseFloat(t.partialPaymentReceived)||0;
        debit=val; credit=partial; typeLabel=partial>0?'CREDIT (PARTIAL)':'CREDIT';
        detailLabel=`${fmtAmt(t.quantity||0)} kg × ${fmtAmt(unitPrice)}`;
        if (partial>0) detailLabel+=` | ${fmtAmt(partial)} / ${fmtAmt(val-partial)}`;
      } else if (pt==='CREDIT'&&t.creditReceived) {
        const val=t.totalValue||0; debit=val; credit=val; typeLabel='CREDIT (PAID)';
        detailLabel=`${fmtAmt(t.quantity||0)} kg × ${fmtAmt(unitPrice)}`;
        displayDate=formatDisplayDate(t.creditReceivedDate||t.date);
      } else if (pt==='COLLECTION') {
        credit=parseFloat(t.totalValue)||0; typeLabel='COLLECTION';
        detailLabel='Cash payment received'; displayDate=formatDisplayDate(t.creditReceivedDate||t.date);
      } else if (pt==='PARTIAL_PAYMENT') {
        credit=parseFloat(t.totalValue)||0; typeLabel='PARTIAL PAYMENT';
        detailLabel='Partial payment received'; displayDate=formatDisplayDate(t.creditReceivedDate||t.date);
      }
      runBal.val+=(debit-credit);
      const balStr=Math.abs(runBal.val)<0.01?'':runBal.val>0?fmtAmt(runBal.val):fmtAmt(Math.abs(runBal.val));
      return { debit, credit, qty:t.quantity||0,
        cells:[displayDate,typeLabel,detailLabel.substring(0,55),
          debit>0?fmtAmt(debit):'-', credit>0?fmtAmt(credit):'-', balStr] };
    };
    let txHTML='';
    if (transactions.length>0) {
      const normalTxns=transactions.filter(t=>!t.isMerged);
      const txRunBal={val:0};
      const txRows=[];
      let totDebit=0,totCredit=0,totQty=0;
      for (const t of normalTxns) {
        const r=buildRow(t,txRunBal);
        txRows.push({ cells:r.cells, rowClass:'' });
        totDebit+=r.debit; totCredit+=r.credit; totQty+=r.qty;
      }
      const finalBal=totDebit-totCredit;
      const finalBalStr=Math.abs(finalBal)<0.01?'':finalBal>0?fmtAmt(finalBal):fmtAmt(Math.abs(finalBal));
      txRows.push({ cells:['TOTALS','',`${fmtAmt(totQty)} kg total`,fmtAmt(totDebit),fmtAmt(totCredit),finalBalStr], rowClass:'row-total' });
      txRows.forEach(r => {
        const typeTxt = r.cells[1]||'';
      });
      txHTML += table({
        headers:['Date','Type','Details','Debit (Sale)','Credit (Rcvd)','Balance'],
        rows: txRows,
        colStyles:[
          {align:'center',width:'13%'},{align:'center',width:'15%',bold:true},
          {align:'left',width:'32%'},{align:'right',width:'13%',color:'#dc3545',bold:true},
          {align:'right',width:'13%',color:'#28a745',bold:true},{align:'center',width:'14%',bold:true},
        ],
        headerColor: color,
      });
      const bColor = NativePDF.balColor(finalBal);
      txHTML += `<div class="summary-box" style="background:#f0eeff;border:1px solid #c7c0f0;">
        <div class="item"><span class="label">Total Debit:</span><span class="c-red fw-700">${h(fmtAmt(totDebit))}</span></div>
        <div class="item"><span class="label">Total Credit:</span><span class="c-green fw-700">${h(fmtAmt(totCredit))}</span></div>
        <div class="item"><span class="label">Balance:</span><span class="fw-800" style="color:${bColor};">${h(finalBalStr)}</span></div>
      </div>`;
    } else {
      txHTML=`<p style="text-align:center;color:#aaa;padding:20px;">No transactions recorded for this period.</p>`;
    }
    const bodyHTML = `<div class="page">
      ${docHeader(color, 'Naswar Manufacturers & Dealers')}
      <div class="doc-title">Rep Customer Account Statement · ${h(rangeName)}</div>
      <div class="doc-meta">
        <div class="kv"><span class="k">Customer:</span><span class="v">${h(customerName)}</span></div>
        <div class="kv"><span class="k">Phone:</span><span class="v">${h(phone)}</span></div>
        <div class="kv"><span class="k">Sales Rep:</span><span class="v">${h(currentRepProfile||'N/A')}</span></div>
        <div class="kv"><span class="k">Generated:</span><span class="v">${h(now.toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}))}</span></div>
      </div>
      ${divider(color)}
      ${txHTML}
      ${docFooter(now)}
    </div>`;
    const dateStamp   = new Date().toISOString().split('T')[0];
    const safeRepName = customerName.replace(/[^a-z0-9]/gi,'_');
    const filename    = `Rep_Customer_Statement_${safeRepName}_${dateStamp}`;
    await NativePDF.buildAndShare(bodyHTML, filename, phone);
  } catch(err) {
    showToast('Error generating PDF: ' + err.message, 'error');
  }
}
