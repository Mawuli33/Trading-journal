(function(){
  "use strict";

  const hasClaudeStorage = !!(window.storage && window.storage.get);
  const LS_PREFIX = 'tradejournal:';
  let localStorageOk = false;
  if(!hasClaudeStorage){
    try{
      const testKey = LS_PREFIX + '__test__';
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      localStorageOk = true;
    }catch(e){ localStorageOk = false; }
  }
  if(!hasClaudeStorage && !localStorageOk){
    const b = document.getElementById('storageBanner');
    b.hidden = false;
    b.textContent = "Your browser is blocking local storage (private/incognito mode, or file:// restrictions in some browsers). Entries will only last for this session — export a backup before closing.";
  }

  let trades = [];
  let reviews = [];
  let editingId = null;
  let selectedResult = 'win';
  let entryImgData = null, exitImgData = null; // full-size compressed data urls pending save
  let entryThumbData = null, exitThumbData = null;
  let removedEntryImg = false, removedExitImg = false;

  const reviewState = { type: 'monthly', anchor: new Date() };

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const uid = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
  const pad = n => String(n).padStart(2,'0');
  const fmtR = v => (v>0?'+':'') + v.toFixed(1) + 'R';

  /* ---------------- storage helpers ---------------- */
  async function storeGet(key){
    if(hasClaudeStorage){
      try{ const r = await window.storage.get(key, false); return r ? r.value : null; }
      catch(e){ return null; }
    }
    if(localStorageOk){
      try{ return localStorage.getItem(LS_PREFIX+key); }catch(e){ return null; }
    }
    return null;
  }
  async function storeSet(key, value){
    if(hasClaudeStorage){
      try{ await window.storage.set(key, value, false); return true; }
      catch(e){ console.error('storage set failed', key, e); return false; }
    }
    if(localStorageOk){
      try{ localStorage.setItem(LS_PREFIX+key, value); return true; }
      catch(e){
        console.error('localStorage set failed', key, e);
        return false;
      }
    }
    return false;
  }
  async function storeDelete(key){
    if(hasClaudeStorage){
      try{ await window.storage.delete(key, false); }catch(e){ /* ignore */ }
      return;
    }
    if(localStorageOk){
      try{ localStorage.removeItem(LS_PREFIX+key); }catch(e){ /* ignore */ }
    }
  }

  async function loadAll(){
    const t = await storeGet('trades');
    const r = await storeGet('reviews');
    trades = t ? JSON.parse(t) : [];
    reviews = r ? JSON.parse(r) : [];
    renderJournal();
    renderReviews();
    renderAnalytics();
  }
  async function saveTrades(){
    const ok = await storeSet('trades', JSON.stringify(trades));
    if(!ok) alert("Couldn't save — your browser's storage is full. Export a backup now from the Analytics tab, then consider removing a few older screenshots.");
    return ok;
  }
  async function saveReviews(){ await storeSet('reviews', JSON.stringify(reviews)); }

  /* ---------------- image compression ---------------- */
  function compressImage(file, maxDim, quality){
    return new Promise((resolve,reject)=>{
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          let w = img.width, h = img.height;
          const scale = Math.min(1, maxDim / Math.max(w,h));
          w = Math.round(w*scale); h = Math.round(h*scale);
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /* ---------------- tabs ---------------- */
  $$('.tab-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      $$('.tab-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      $$('.tab-section').forEach(sec=>{ sec.hidden = sec.id !== ('tab-'+tab); });
      if(tab === 'analytics') renderAnalytics();
    });
  });

  /* ==================================================
     JOURNAL
     ================================================== */
  function computeStats(list){
    const wins = list.filter(t=>t.result==='win').length;
    const losses = list.filter(t=>t.result==='loss').length;
    const be = list.filter(t=>t.result==='be').length;
    const total = list.length;
    const winRate = total ? (wins/total*100) : 0;
    const netR = list.reduce((s,t)=> s + (Number(t.r)||0), 0);
    return { wins, losses, be, total, winRate, netR };
  }

  function drawEquityCurve(list){
    const svg = $('#equityCurve');
    svg.innerHTML = '';
    const sorted = [...list].sort((a,b)=> a.date.localeCompare(b.date) || a.createdAt-b.createdAt);
    if(sorted.length === 0){
      svg.innerHTML = '<line x1="0" y1="39" x2="600" y2="39" stroke="#232A3A" stroke-width="1.5" stroke-dasharray="4 5"/>';
      return;
    }
    let cum = 0;
    const pts = [0].concat(sorted.map(t => (cum += Number(t.r)||0)));
    const min = Math.min(0, ...pts), max = Math.max(0, ...pts);
    const range = (max - min) || 1;
    const w = 600, h = 78, pad = 6;
    const stepX = pts.length > 1 ? (w / (pts.length-1)) : w;
    const coords = pts.map((v,i)=>{
      const x = i*stepX;
      const y = h - pad - ((v - min)/range)*(h - pad*2);
      return [x,y];
    });
    const isPos = cum >= 0;
    const color = isPos ? 'var(--win)' : 'var(--loss)';
    const line = coords.map(c=>c.join(',')).join(' ');
    const areaPath = `M0,${h} L` + coords.map(c=>c.join(',')).join(' L') + ` L${w},${h} Z`;
    const gradId = 'eqGrad';
    svg.innerHTML = `
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.28"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${areaPath}" fill="url(#${gradId})" stroke="none"/>
      <polyline class="equity-path" points="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    `;
  }

  function renderJournal(){
    const pairQ = $('#pairFilter').value.trim().toLowerCase();
    const resultQ = $('#resultFilter').value;
    let list = trades.filter(t=>{
      if(pairQ && !t.pair.toLowerCase().includes(pairQ)) return false;
      if(resultQ !== 'all' && t.result !== resultQ) return false;
      return true;
    });

    const heroStats = computeStats(trades);
    $('#heroNetR').textContent = fmtR(heroStats.netR);
    $('#heroNetR').className = 'value mono ' + (heroStats.netR >= 0 ? 'pos' : 'neg');
    $('#heroWinRate').textContent = heroStats.winRate.toFixed(1) + '%';
    $('#heroTotal').textContent = heroStats.total;
    drawEquityCurve(trades);

    const container = $('#tradeList');
    container.innerHTML = '';
    $('#emptyState').hidden = trades.length !== 0;

    const sorted = [...list].sort((a,b)=> b.date.localeCompare(a.date) || b.createdAt-a.createdAt);
    sorted.forEach(t=>{
      const card = document.createElement('div');
      card.className = 'trade-card';
      card.dataset.id = t.id;
      const rClass = t.r > 0 ? 'pos' : (t.r < 0 ? 'neg' : 'zero');
      const resultLabel = t.result === 'win' ? 'Win' : (t.result === 'loss' ? 'Loss' : 'B/E');
      card.innerHTML = `
        <div class="trade-top">
          <div class="trade-id">
            <span class="pair-badge">${escapeHtml(t.pair)}</span>
            ${t.direction ? `<span class="dir-chip">${t.direction}</span>` : ''}
            <span class="trade-date">${escapeHtml(t.date)}</span>
          </div>
          <div class="trade-right">
            <span class="r-value mono ${rClass}">${fmtR(Number(t.r)||0)}</span>
            <span class="result-pill ${t.result}">${resultLabel}</span>
            <span class="chevron">›</span>
          </div>
        </div>
        <div class="trade-detail">
          <div class="reason-block"><b>Reason for entering</b>${escapeHtml(t.reason || '—')}</div>
          ${t.notes ? `<div class="reason-block"><b>Notes</b>${escapeHtml(t.notes)}</div>` : ''}
          <div class="shots">
            <div class="shot"><span>Entry</span>${t.entryThumb ? `<img src="${t.entryThumb}" data-side="entry">` : `<div class="noimg">No image</div>`}</div>
            <div class="shot"><span>Exit</span>${t.exitThumb ? `<img src="${t.exitThumb}" data-side="exit">` : `<div class="noimg">No image</div>`}</div>
          </div>
          <div class="detail-actions">
            <button class="btn-secondary" data-action="edit">Edit</button>
            <button class="btn-danger" data-action="delete">Delete</button>
          </div>
        </div>
      `;
      container.appendChild(card);
    });
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  $('#pairFilter').addEventListener('input', renderJournal);
  $('#resultFilter').addEventListener('change', renderJournal);

  $('#tradeList').addEventListener('click', (e)=>{
    const card = e.target.closest('.trade-card');
    if(!card) return;
    const id = card.dataset.id;
    const trade = trades.find(t=>t.id===id);

    if(e.target.closest('img[data-side]')){
      openLightbox(trade, e.target.dataset.side);
      return;
    }
    const action = e.target.closest('[data-action]');
    if(action){
      if(action.dataset.action === 'edit') openTradeModal(trade);
      if(action.dataset.action === 'delete') deleteTrade(trade);
      return;
    }
    if(e.target.closest('.trade-top')){
      card.classList.toggle('open');
    }
  });

  async function deleteTrade(trade){
    if(!confirm(`Delete this ${trade.pair} trade? This can't be undone.`)) return;
    trades = trades.filter(t=>t.id !== trade.id);
    await saveTrades();
    await storeDelete('img:'+trade.id+':entry');
    await storeDelete('img:'+trade.id+':exit');
    renderJournal();
    renderAnalytics();
  }

  async function openLightbox(trade, side){
    const lb = $('#lightbox');
    const content = $('#lbContent');
    lb.hidden = false;
    content.className = 'lb-loading';
    content.textContent = 'Loading…';
    const key = 'img:'+trade.id+':'+side;
    const full = await storeGet(key);
    if(full){
      content.className = '';
      content.innerHTML = `<img src="${full}" alt="${side} screenshot">`;
    } else {
      const thumb = side==='entry' ? trade.entryThumb : trade.exitThumb;
      if(thumb){ content.className=''; content.innerHTML = `<img src="${thumb}" alt="${side} screenshot">`; }
      else { content.textContent = 'No image available.'; }
    }
  }
  $('#lbClose').addEventListener('click', ()=> $('#lightbox').hidden = true);
  $('#lightbox').addEventListener('click', (e)=>{ if(e.target.id==='lightbox') $('#lightbox').hidden = true; });

  /* ---------------- Trade modal ---------------- */
  function resetForm(){
    $('#tradeForm').reset();
    $('#f_date').value = new Date().toISOString().slice(0,10);
    selectedResult = 'win';
    updateResultToggle();
    entryImgData = exitImgData = entryThumbData = exitThumbData = null;
    removedEntryImg = removedExitImg = false;
    resetDropzone('dz_entry');
    resetDropzone('dz_exit');
  }

  function resetDropzone(id){
    const dz = $('#'+id);
    dz.querySelector('.dz-inner').innerHTML = 'Tap to upload';
    dz.classList.remove('drag');
  }

  function updateResultToggle(){
    $$('#resultToggle button').forEach(b=>{
      b.classList.toggle('sel', b.dataset.r === selectedResult);
    });
  }
  $('#resultToggle').addEventListener('click', (e)=>{
    const btn = e.target.closest('button');
    if(!btn) return;
    selectedResult = btn.dataset.r;
    updateResultToggle();
  });

  function openTradeModal(trade){
    editingId = trade ? trade.id : null;
    resetForm();
    $('#modalTitle').textContent = trade ? 'Edit Trade' : 'New Trade';
    if(trade){
      $('#f_pair').value = trade.pair;
      $('#f_date').value = trade.date;
      $('#f_direction').value = trade.direction || '';
      $('#f_r').value = trade.r;
      $('#f_reason').value = trade.reason || '';
      $('#f_notes').value = trade.notes || '';
      selectedResult = trade.result;
      updateResultToggle();
      if(trade.entryThumb) setDropzonePreview('dz_entry', trade.entryThumb);
      if(trade.exitThumb) setDropzonePreview('dz_exit', trade.exitThumb);
    }
    $('#tradeOverlay').hidden = false;
  }
  function closeTradeModal(){ $('#tradeOverlay').hidden = true; editingId = null; }

  $('#addTradeBtn').addEventListener('click', ()=> openTradeModal(null));
  $('#emptyAddBtn').addEventListener('click', ()=> openTradeModal(null));
  $('#cancelModalBtn').addEventListener('click', closeTradeModal);
  $('#tradeOverlay').addEventListener('click', (e)=>{ if(e.target.id==='tradeOverlay') closeTradeModal(); });

  function setDropzonePreview(dzId, dataUrl){
    const dz = $('#'+dzId);
    dz.querySelector('.dz-inner').innerHTML = `<img class="preview" src="${dataUrl}"><button type="button" class="remove-shot">Remove</button>`;
  }

  function wireDropzone(dzId, fileInputId, onFile, onRemove){
    const dz = $('#'+dzId);
    const input = $('#'+fileInputId);
    ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave','drop'].forEach(ev => dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', e=>{
      e.preventDefault();
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if(file) handleFile(file);
    });
    input.addEventListener('change', e=>{
      const file = e.target.files[0];
      if(file) handleFile(file);
    });
    dz.addEventListener('click', e=>{
      if(e.target.classList.contains('remove-shot')){
        e.preventDefault(); e.stopPropagation();
        resetDropzone(dzId);
        input.value = '';
        onRemove();
        return;
      }
      // any other click on the dropzone opens the native file picker
      input.click();
    });
    async function handleFile(file){
      try{
        const [thumb, full] = await Promise.all([
          compressImage(file, 220, 0.55),
          compressImage(file, 1100, 0.75)
        ]);
        setDropzonePreview(dzId, thumb);
        onFile(thumb, full);
      }catch(err){
        console.error('image processing failed', err);
        alert('Could not read that image — please try a different file.');
      }
    }
  }
  wireDropzone('dz_entry','f_entry_img', (thumb,full)=>{ entryThumbData=thumb; entryImgData=full; removedEntryImg=false; }, ()=>{ entryThumbData=null; entryImgData=null; removedEntryImg=true; });
  wireDropzone('dz_exit','f_exit_img', (thumb,full)=>{ exitThumbData=thumb; exitImgData=full; removedExitImg=false; }, ()=>{ exitThumbData=null; exitImgData=null; removedExitImg=true; });

  $('#tradeForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const pair = $('#f_pair').value.trim().toUpperCase();
    const date = $('#f_date').value;
    const direction = $('#f_direction').value;
    const r = parseFloat($('#f_r').value) || 0;
    const reason = $('#f_reason').value.trim();
    const notes = $('#f_notes').value.trim();

    if(!pair || !date || !reason){ return; }

    let trade;
    if(editingId){
      trade = trades.find(t=>t.id===editingId);
    } else {
      trade = { id: uid(), createdAt: Date.now() };
      trades.push(trade);
    }
    Object.assign(trade, { pair, date, direction, r, result: selectedResult, reason, notes });

    if(entryThumbData){ trade.entryThumb = entryThumbData; }
    if(exitThumbData){ trade.exitThumb = exitThumbData; }
    if(removedEntryImg){ trade.entryThumb = null; await storeDelete('img:'+trade.id+':entry'); }
    if(removedExitImg){ trade.exitThumb = null; await storeDelete('img:'+trade.id+':exit'); }
    let imgWarning = false;
    if(entryImgData){ const ok = await storeSet('img:'+trade.id+':entry', entryImgData); if(!ok) imgWarning = true; }
    if(exitImgData){ const ok = await storeSet('img:'+trade.id+':exit', exitImgData); if(!ok) imgWarning = true; }

    await saveTrades();
    closeTradeModal();
    renderJournal();
    renderReviews();
    renderAnalytics();
    if(imgWarning){
      alert("The trade saved, but a screenshot was too large for your browser's storage. Try a smaller image, or export a backup regularly so nothing is lost.");
    }
  });

  /* ==================================================
     REVIEWS
     ================================================== */
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function startOfWeek(d){
    const date = new Date(d);
    const day = date.getDay();
    const diff = (day === 0) ? -6 : (1 - day);
    date.setDate(date.getDate() + diff);
    date.setHours(0,0,0,0);
    return date;
  }

  function getPeriodRange(type, anchor){
    const y = anchor.getFullYear();
    let start, end, label, key;
    if(type === 'yearly'){
      start = new Date(y,0,1); end = new Date(y,11,31,23,59,59);
      label = `${y}`; key = `yearly:${y}`;
    } else if(type === 'semi'){
      const half = anchor.getMonth() < 6 ? 0 : 1;
      start = new Date(y, half*6, 1); end = new Date(y, half*6+6, 0,23,59,59);
      label = `H${half+1} ${y}`; key = `semi:${y}-H${half+1}`;
    } else if(type === 'quarterly'){
      const q = Math.floor(anchor.getMonth()/3);
      start = new Date(y, q*3, 1); end = new Date(y, q*3+3, 0,23,59,59);
      label = `Q${q+1} ${y}`; key = `quarterly:${y}-Q${q+1}`;
    } else if(type === 'monthly'){
      const m = anchor.getMonth();
      start = new Date(y, m, 1); end = new Date(y, m+1, 0,23,59,59);
      label = `${MONTHS[m]} ${y}`; key = `monthly:${y}-${pad(m+1)}`;
    } else { // weekly
      start = startOfWeek(anchor);
      end = new Date(start); end.setDate(start.getDate()+6); end.setHours(23,59,59,999);
      label = `${MONTHS_SHORT[start.getMonth()]} ${start.getDate()} – ${MONTHS_SHORT[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
      key = `weekly:${start.toISOString().slice(0,10)}`;
    }
    return { start, end, label, key };
  }

  function shiftAnchor(type, anchor, dir){
    const d = new Date(anchor);
    if(type === 'yearly') d.setFullYear(d.getFullYear()+dir);
    else if(type === 'semi') d.setMonth(d.getMonth()+dir*6);
    else if(type === 'quarterly') d.setMonth(d.getMonth()+dir*3);
    else if(type === 'monthly') d.setMonth(d.getMonth()+dir);
    else d.setDate(d.getDate()+dir*7);
    return d;
  }

  function tradesInRange(range){
    return trades.filter(t=>{
      const d = new Date(t.date + 'T12:00:00');
      return d >= range.start && d <= range.end;
    });
  }

  const QUOTES = [
    "The more reflection, self-review and contemplation you perform as a trader, the quicker you will progress.",
    "You don't have to be right often to make money — you have to be disciplined when you are.",
    "A losing trade you followed your plan on is a win for your process, even if it's a loss for your account.",
    "Review is where edge is actually built — the chart just tells you where it happened.",
    "Consistency in review beats intensity in review. Show up every period, even the boring ones.",
    "Your R-multiple curve doesn't lie about your discipline, even when your memory does."
  ];
  function quoteFor(key){
    let h = 0; for(let i=0;i<key.length;i++) h = (h*31 + key.charCodeAt(i)) % 997;
    return QUOTES[h % QUOTES.length];
  }

  const RECOMMEND = {
    weekly: "Weekly reviews catch bad habits early. Look for the same mistake repeating across two or more trades before it hardens into a pattern.",
    monthly: "Compare this month's win rate and net R to your rolling average. A dip usually means a rule got broken, not that the strategy stopped working.",
    quarterly: "Quarterly is a good cadence to revisit position sizing and your risk-per-trade — has your R stayed consistent as your account has changed?",
    semi: "Six months is enough data to judge whether your edge is real. Check if your net R is trending up across the two halves, not just positive overall.",
    yearly: "Use the yearly review to revisit your 'why'. The goals that keep you disciplined through a drawdown are worth writing down again."
  };

  function renderPeriodNav(){
    $$('#periodTypePills button').forEach(b=> b.classList.toggle('active', b.dataset.type === reviewState.type));
  }

  function currentRange(){ return getPeriodRange(reviewState.type, reviewState.anchor); }

  function renderReviews(){
    renderPeriodNav();
    const range = currentRange();
    $('#periodLabel').textContent = range.label;
    $('#reviewQuote').textContent = '“' + quoteFor(range.key) + '”';
    $('#reviewRecommend').innerHTML = `<b>Recommendation.</b> ${RECOMMEND[reviewState.type]}`;

    const list = tradesInRange(range);
    const s = computeStats(list);
    $('#reviewStats').innerHTML = `
      <div class="stat-card win"><div class="s-label">Wins</div><div class="s-value mono">${s.wins}</div></div>
      <div class="stat-card loss"><div class="s-label">Losses</div><div class="s-value mono">${s.losses}</div></div>
      <div class="stat-card be"><div class="s-label">Breakeven</div><div class="s-value mono">${s.be}</div></div>
      <div class="stat-card"><div class="s-label">Total Trades</div><div class="s-value mono">${s.total}</div></div>
      <div class="stat-card"><div class="s-label">Win Rate</div><div class="s-value mono">${s.winRate.toFixed(1)}%</div></div>
      <div class="stat-card"><div class="s-label">Net P/L</div><div class="s-value mono" style="color:${s.netR>=0?'var(--win)':'var(--loss)'}">${fmtR(s.netR)}</div></div>
    `;

    const existing = reviews.find(r=>r.key === range.key);
    $('#rf_drives').value = existing ? existing.drives || '' : '';
    $('#rf_mistakes').value = existing ? existing.mistakes || '' : '';
    $('#rf_improvements').value = existing ? existing.improvements || '' : '';
    $('#rf_why').value = existing ? existing.why || '' : '';
    $('#saveStatus').classList.remove('show');
    $('#saveReviewBtn').textContent = existing ? 'Update Review' : 'Save Review';

    renderReviewHistory();
  }

  function renderReviewHistory(){
    const box = $('#reviewHistoryList');
    if(reviews.length === 0){
      box.innerHTML = '<div class="hist-empty">No saved reviews yet — save one above to start building your history.</div>';
      return;
    }
    const sorted = [...reviews].sort((a,b)=> (b.savedAt||0) - (a.savedAt||0));
    box.innerHTML = '';
    sorted.forEach(r=>{
      const range = getPeriodRange(r.type, new Date(r.anchorISO));
      const s = computeStats(tradesInRange(range));
      const row = document.createElement('div');
      row.className = 'hist-row';
      row.innerHTML = `
        <div class="hist-left">
          <div class="hist-label">${escapeHtml(r.label)}</div>
          <div class="hist-type">${r.type}</div>
        </div>
        <div class="hist-r mono" style="color:${s.netR>=0?'var(--win)':'var(--loss)'}">${fmtR(s.netR)}</div>
      `;
      row.addEventListener('click', ()=>{
        reviewState.type = r.type;
        reviewState.anchor = new Date(r.anchorISO);
        renderReviews();
        window.scrollTo({top:0, behavior:'smooth'});
      });
      box.appendChild(row);
    });
  }

  $('#periodTypePills').addEventListener('click', e=>{
    const btn = e.target.closest('button');
    if(!btn) return;
    reviewState.type = btn.dataset.type;
    renderReviews();
  });
  $('#periodPrev').addEventListener('click', ()=>{
    reviewState.anchor = shiftAnchor(reviewState.type, reviewState.anchor, -1);
    renderReviews();
  });
  $('#periodNext').addEventListener('click', ()=>{
    reviewState.anchor = shiftAnchor(reviewState.type, reviewState.anchor, 1);
    renderReviews();
  });

  $('#saveReviewBtn').addEventListener('click', async ()=>{
    const range = currentRange();
    const record = {
      key: range.key,
      type: reviewState.type,
      label: range.label,
      anchorISO: reviewState.anchor.toISOString(),
      savedAt: Date.now(),
      drives: $('#rf_drives').value.trim(),
      mistakes: $('#rf_mistakes').value.trim(),
      improvements: $('#rf_improvements').value.trim(),
      why: $('#rf_why').value.trim()
    };
    const idx = reviews.findIndex(r=>r.key === range.key);
    if(idx >= 0) reviews[idx] = record; else reviews.push(record);
    await saveReviews();
    $('#saveReviewBtn').textContent = 'Update Review';
    $('#saveStatus').classList.add('show');
    setTimeout(()=> $('#saveStatus').classList.remove('show'), 1800);
    renderReviewHistory();
  });

  /* ==================================================
     ANALYTICS
     ================================================== */
  function renderAnalytics(){
    const s = computeStats(trades);
    const wins = trades.filter(t=>t.result==='win');
    const losses = trades.filter(t=>t.result==='loss');
    const avgWin = wins.length ? wins.reduce((a,t)=>a+(Number(t.r)||0),0)/wins.length : 0;
    const avgLoss = losses.length ? losses.reduce((a,t)=>a+(Number(t.r)||0),0)/losses.length : 0;
    const expectancy = s.total ? s.netR/s.total : 0;

    const byRecent = [...trades].sort((a,b)=> b.date.localeCompare(a.date) || b.createdAt-a.createdAt);
    let streak = 0, streakType = null;
    for(const t of byRecent){
      if(t.result === 'be') break;
      if(streakType === null){ streakType = t.result; streak = 1; }
      else if(t.result === streakType){ streak++; }
      else break;
    }
    const streakLabel = streak === 0 ? '—' : `${streak} ${streakType === 'win' ? 'win' : 'loss'}${streak>1?'s':''}`;

    const pairMap = {};
    trades.forEach(t=>{
      if(!pairMap[t.pair]) pairMap[t.pair] = { pair: t.pair, count:0, wins:0, netR:0 };
      const p = pairMap[t.pair];
      p.count++; if(t.result==='win') p.wins++; p.netR += Number(t.r)||0;
    });
    const pairList = Object.values(pairMap).sort((a,b)=> b.netR - a.netR);
    const bestPair = pairList[0];
    const worstPair = pairList.length > 1 ? pairList[pairList.length-1] : null;

    $('#analyticsOverview').innerHTML = `
      <div class="stat-card wide"><div><div class="s-label">Net P/L</div><div class="s-value mono" style="color:${s.netR>=0?'var(--win)':'var(--loss)'}">${fmtR(s.netR)}</div></div><div><div class="s-label">Win Rate</div><div class="s-value mono">${s.winRate.toFixed(1)}%</div></div></div>
      <div class="stat-card"><div class="s-label">Avg Win</div><div class="s-value mono" style="color:var(--win)">${wins.length?fmtR(avgWin):'—'}</div></div>
      <div class="stat-card"><div class="s-label">Avg Loss</div><div class="s-value mono" style="color:var(--loss)">${losses.length?fmtR(avgLoss):'—'}</div></div>
      <div class="stat-card"><div class="s-label">Expectancy</div><div class="s-value mono">${s.total?fmtR(expectancy):'—'}</div></div>
      <div class="stat-card streak"><div class="s-label">Current Streak</div><div class="s-value mono">${streakLabel}</div></div>
      <div class="stat-card"><div class="s-label">Best Pair</div><div class="s-value" style="font-size:14px;color:var(--win)">${bestPair?escapeHtml(bestPair.pair):'—'}</div></div>
      <div class="stat-card"><div class="s-label">Worst Pair</div><div class="s-value" style="font-size:14px;color:var(--loss)">${worstPair?escapeHtml(worstPair.pair):'—'}</div></div>
    `;

    renderHistogram(trades);

    const pairBox = $('#pairList');
    if(pairList.length === 0){
      pairBox.innerHTML = '<div class="hist-empty">No trades yet — your per-pair breakdown will show up here.</div>';
    } else {
      const maxAbs = Math.max(...pairList.map(p=>Math.abs(p.netR)), 1);
      pairBox.innerHTML = pairList.map(p=>{
        const winRate = p.count ? (p.wins/p.count*100) : 0;
        const color = p.netR >= 0 ? 'var(--win)' : 'var(--loss)';
        const fillPct = Math.max(4, (Math.abs(p.netR)/maxAbs)*100);
        return `
          <div class="pair-row">
            <div class="pair-row-wrap">
              <div class="pair-left"><span class="pair-name">${escapeHtml(p.pair)}</span><span class="pair-meta">${p.count} trade${p.count===1?'':'s'} · ${winRate.toFixed(0)}% win</span></div>
              <div class="pair-bar-track"><div class="pair-bar-fill" style="width:${fillPct}%; background:${color}"></div></div>
            </div>
            <div class="pair-r mono" style="color:${color}">${fmtR(p.netR)}</div>
          </div>
        `;
      }).join('');
    }
  }

  function renderHistogram(list){
    const box = $('#histChart');
    box.innerHTML = '';
    if(list.length === 0){
      box.innerHTML = '<div class="hist-empty">No trades yet.</div>';
      return;
    }
    const rs = list.map(t=> Number(t.r)||0);
    const min = Math.min(...rs, -1), max = Math.max(...rs, 1);
    const binCount = 6;
    const binSize = ((max - min) / binCount) || 1;
    const bins = new Array(binCount).fill(0);
    rs.forEach(r=>{
      let idx = Math.floor((r - min) / binSize);
      if(idx >= binCount) idx = binCount - 1;
      if(idx < 0) idx = 0;
      bins[idx]++;
    });
    const maxCount = Math.max(...bins, 1);
    bins.forEach((c,i)=>{
      const lo = min + i*binSize, hi = min + (i+1)*binSize;
      const mid = (lo+hi)/2;
      const color = mid >= 0 ? 'var(--win)' : 'var(--loss)';
      const h = c ? Math.max(6, (c/maxCount)*100) : 2;
      const bar = document.createElement('div');
      bar.className = 'hist-bar';
      bar.innerHTML = `<div class="count">${c || ''}</div><div class="bar" style="height:${h}%; background:${color}"></div><div class="rng">${lo.toFixed(1)}…${hi.toFixed(1)}</div>`;
      box.appendChild(bar);
    });
  }

  /* ---------------- export / import ---------------- */
  function todayStr(){ return new Date().toISOString().slice(0,10); }

  function downloadBlob(content, filename, type){
    const blob = new Blob([content], {type});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=> URL.revokeObjectURL(url), 2000);
  }

  function csvEscape(s){
    if(s === null || s === undefined) return '';
    const str = String(s).replace(/"/g,'""');
    return /[",\n]/.test(str) ? `"${str}"` : str;
  }

  async function exportBackup(){
    const images = {};
    for(const t of trades){
      if(t.entryThumb){ const full = await storeGet('img:'+t.id+':entry'); if(full) images[t.id+':entry'] = full; }
      if(t.exitThumb){ const full = await storeGet('img:'+t.id+':exit'); if(full) images[t.id+':exit'] = full; }
    }
    const data = { app: 'trade-journal', version: 1, exportedAt: new Date().toISOString(), trades, reviews, images };
    downloadBlob(JSON.stringify(data), `trade-journal-backup-${todayStr()}.json`, 'application/json');
  }

  function exportCSV(){
    const header = ['Date','Pair','Direction','Result','R Multiple','Reason','Notes'];
    const rows = [...trades].sort((a,b)=> a.date.localeCompare(b.date)).map(t=>
      [t.date, t.pair, t.direction||'', t.result, t.r, csvEscape(t.reason), csvEscape(t.notes)].join(',')
    );
    const csv = [header.join(','), ...rows].join('\n');
    downloadBlob(csv, `trade-journal-${todayStr()}.csv`, 'text/csv');
  }

  async function importBackup(file){
    const statusEl = $('#importStatus');
    statusEl.classList.remove('err');
    try{
      const text = await file.text();
      const data = JSON.parse(text);
      if(!data || !Array.isArray(data.trades)) throw new Error('bad format');

      let addedTrades = 0;
      for(const t of data.trades){
        if(!trades.find(x=>x.id===t.id)){
          trades.push(t);
          addedTrades++;
          if(data.images){
            const eImg = data.images[t.id+':entry'];
            const xImg = data.images[t.id+':exit'];
            if(eImg) await storeSet('img:'+t.id+':entry', eImg);
            if(xImg) await storeSet('img:'+t.id+':exit', xImg);
          }
        }
      }
      let addedReviews = 0;
      if(Array.isArray(data.reviews)){
        for(const r of data.reviews){
          if(!reviews.find(x=>x.key===r.key)){ reviews.push(r); addedReviews++; }
        }
      }
      await saveTrades();
      await saveReviews();
      renderJournal();
      renderReviews();
      renderAnalytics();
      statusEl.textContent = `Imported ${addedTrades} trade${addedTrades===1?'':'s'} and ${addedReviews} review${addedReviews===1?'':'s'}. Duplicates were skipped.`;
    }catch(e){
      statusEl.classList.add('err');
      statusEl.textContent = "Couldn't read that file — make sure it's a Trade Journal backup (.json).";
    }
  }

  $('#exportJsonBtn').addEventListener('click', exportBackup);
  $('#exportCsvBtn').addEventListener('click', exportCSV);
  $('#importFile').addEventListener('change', e=>{
    const file = e.target.files[0];
    if(file) importBackup(file);
    e.target.value = '';
  });

  /* ---------------- init ---------------- */
  loadAll();
})();