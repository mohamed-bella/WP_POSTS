const API = '';
let settingsCache = {};
let logEs = null;
let isReady = false;

// ─── Health Check ─────────────────────────────────────────────
async function checkAppHealth() {
  const splash = document.getElementById('splash-screen');
  const statusEl = document.getElementById('splash-status');
  
  if (!splash) return;

  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    
    if (data.ok) {
      isReady = true;
      splash.style.opacity = '0';
      setTimeout(() => {
        splash.style.display = 'none';
        document.body.classList.remove('loading-state');
      }, 500);
      console.log('✅ Supabase connected. App ready.');
    } else {
      statusEl.textContent = 'Retrying Supabase connection...';
      console.warn('⚠️ Supabase connection failed:', data.error);
      setTimeout(checkAppHealth, 3000);
    }
  } catch (e) {
    statusEl.textContent = 'Waiting for Server...';
    console.error('❌ Server health check failed:', e.message);
    setTimeout(checkAppHealth, 3000);
  }
}

// Start health check immediately
checkAppHealth();

// ─── Router ───────────────────────────────────────────────────
const pages = {
  overview: 'Dashboard',
  sheets: 'Spreadsheet Drafts',
  stories: 'Live Stories',
  actions: 'Action History',
  logs: 'Live Server Logs',
  gsc: 'Search Console',
  links: 'Internal Linking',
  settings: 'Configuration',
};

function navigate(key) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  
  const page = document.getElementById('page-' + key);
  if (page) page.classList.add('active');
  
  const navEl = document.querySelector(`.nav-item[data-page="${key}"]`);
  if (navEl) navEl.classList.add('active');
  
  document.getElementById('topbar-title').textContent = pages[key] || key;
  
  if(window.innerWidth <= 1024) {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('overlay').classList.remove('active');
  }

  window.location.hash = key;
  if (key === 'overview') loadOverview();
  if (key === 'sheets' || key === 'stories') loadSheet();
  if (key === 'actions') loadActions();
  if (key === 'logs') startLogs();
  if (key === 'gsc') loadGsc();
  if (key === 'links') loadLinkIndex();
  if (key === 'settings') loadSettings();
}

document.querySelectorAll('.nav-item[data-page]').forEach(el => {
  el.addEventListener('click', () => navigate(el.dataset.page));
});

window.addEventListener('hashchange', () => {
  const key = window.location.hash.replace('#', '') || 'overview';
  if (pages[key]) navigate(key);
});

// ─── Helpers ──────────────────────────────────────────────────
function toast(msg, err) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  t.style.background = err ? '#EF4444' : '#1E293B';
  clearTimeout(t._t);
  t._t = setTimeout(() => t.style.display = 'none', 3000);
}

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  const data = await r.json();
  if (!r.ok) {
    if (r.status === 401 && !path.startsWith('/api/login') && !path.startsWith('/api/session-status')) {
      showLoginModal();
    }
    throw new Error(data.error || 'Server error');
  }
  return data;
}

// ─── Authentication ───────────────────────────────────────────
function showLoginModal() {
  const modal = document.getElementById('login-modal');
  if (modal.style.display !== 'none') return; // Already open
  modal.style.display = 'flex';
  refreshCaptcha();
}

async function refreshCaptcha() {
  const r = await fetch('/api/captcha');
  const svg = await r.text();
  document.getElementById('captcha-img-wrap').innerHTML = svg;
}

document.getElementById('btn-refresh-captcha')?.addEventListener('click', refreshCaptcha);

document.getElementById('btn-login-submit')?.addEventListener('click', async () => {
  const password = document.getElementById('login-password').value;
  const captcha = document.getElementById('login-captcha').value;
  const btn = document.getElementById('btn-login-submit');
  const errEl = document.getElementById('login-error');
  
  if (!password || !captcha) {
    errEl.textContent = 'Please fill out all fields.';
    errEl.style.display = 'block';
    return;
  }
  btn.textContent = 'Logging in...';
  btn.disabled = true;
  errEl.style.display = 'none';
  
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, captcha })
    });
    const data = await res.json();
    
    if (res.ok && data.ok) {
      document.getElementById('login-modal').style.display = 'none';
      document.getElementById('login-password').value = '';
      document.getElementById('login-captcha').value = '';
      pollStatus(); // Reload initial data
    } else {
      errEl.textContent = data.error || 'Login failed';
      errEl.style.display = 'block';
      refreshCaptcha();
    }
  } catch(e) {
    errEl.textContent = 'Network error.';
    errEl.style.display = 'block';
  }
  btn.textContent = 'Login to Dashboard';
  btn.disabled = false;
});

document.querySelector('.logout-btn')?.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  showLoginModal();
});

// Check session on load
fetch('/api/session-status').then(r=>r.json()).then(d => {
  if(!d.authenticated) showLoginModal();
}).catch(() => showLoginModal());

function badgeStatus(s) {
  const map = { success: 'green', error: 'red', running: 'yellow' };
  return `<span class="badge badge-${map[s] || 'gray'}">${s}</span>`;
}

function timeSince(iso) {
  const d = (Date.now() - new Date(iso)) / 1000;
  if (d < 60) return Math.round(d) + 's ago';
  if (d < 3600) return Math.round(d / 60) + 'm ago';
  if (d < 86400) return Math.round(d / 3600) + 'h ago';
  return Math.round(d / 86400) + 'd ago';
}

function fmtSeconds(s) {
  if (s < 60) return Math.round(s) + 's';
  if (s < 3600) return Math.round(s / 60) + 'm';
  return Math.round(s / 3600) + 'h ' + Math.round((s % 3600) / 60) + 'm';
}

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(s) { return String(s||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// ─── Status polling ───────────────────────────────────────────
async function pollStatus() {
  try {
    const d = await api('GET', '/api/status');
    const uptimeEl = document.getElementById('uptime-label');
    if(uptimeEl) uptimeEl.textContent = 'Up ' + fmtSeconds(d.uptime);
    document.getElementById('status-dot').className = 'status-dot green';
    
    if(document.getElementById('s-wp')) {
        document.getElementById('s-wp').textContent = d.stats?.today?.wordpress ?? '—';
        document.getElementById('s-ig').textContent = d.stats?.today?.instagram_engage ?? '—';
        document.getElementById('s-err').textContent = d.stats?.today?.errors ?? '—';
        document.getElementById('s-total').textContent = d.stats?.total ?? '—';
    }
    settingsCache = d.settings || {};
  } catch (e) {
    document.getElementById('status-dot').className = 'status-dot red';
    const uptimeEl = document.getElementById('uptime-label');
    if(uptimeEl) uptimeEl.textContent = 'Offline';
  }
}
setInterval(pollStatus, 10000);
pollStatus();

// ─── Overview ─────────────────────────────────────────────────
async function loadOverview() {
  await pollStatus();
  const actions = await api('GET', '/api/actions?limit=10');
  renderRecentActions(actions);
}

function renderRecentActions(actions) {
  const el = document.getElementById('recent-actions-list');
  if (!actions?.length) { el.innerHTML = '<div class="empty">No actions yet.</div>'; return; }
  el.innerHTML = `<table>
    <thead><tr><th>Type</th><th>Status</th><th>When</th><th>Details</th></tr></thead>
    <tbody>${actions.map(a => `
      <tr>
        <td><strong class="text-primary">${a.type.replace(/_/g, ' ')}</strong></td>
        <td>${badgeStatus(a.status)}</td>
        <td class="text-sm color-gray">${timeSince(a.timestamp)}</td>
        <td class="text-sm color-gray" style="word-break: break-all;">${a.details?.error || a.details?.url || a.details?.to || ''}</td>
      </tr>`).join('')}
    </tbody></table>`;
}

// Run buttons
async function triggerRun(endpoint, label) {
  const msg = document.getElementById('run-msg');
  msg.innerHTML = `<span class="spinner"></span> ${label}...`;
  try {
    const r = await api('POST', endpoint);
    msg.textContent = r.message || 'Done.';
    toast(label + ' triggered');
  } catch (e) {
    msg.textContent = 'Error: ' + e.message;
    toast('Failed', true);
  }
}
document.getElementById('btn-run-wp').onclick = () => triggerRun('/api/test/wordpress', 'WordPress post');
document.getElementById('btn-run-ig-engage').onclick = () => triggerRun('/api/test/instagram-engage', 'IG engagement');
document.getElementById('btn-run-ig-post').onclick = () => triggerRun('/api/test/instagram-post', 'IG post');
document.getElementById('btn-run-blogger').onclick = () => triggerRun('/api/test/blogger', 'Blogger post');
document.getElementById('btn-run-reddit').onclick = () => triggerRun('/api/test/reddit', 'Reddit post');
document.getElementById('btn-run-linkedin').onclick = () => triggerRun('/api/test/linkedin', 'LinkedIn post');
document.getElementById('btn-run-tumblr').onclick = () => triggerRun('/api/test/tumblr', 'Tumblr post');
document.getElementById('btn-run-twitter').onclick = () => triggerRun('/api/test/twitter', 'Twitter post');
document.getElementById('btn-test-wa').onclick = () => triggerRun('/api/test/whatsapp', 'WhatsApp test');
// Robotics UI Handler
window.closeFsModal = () => document.getElementById('fs-modal').style.display = 'none';
window.toggleFsLogs = () => {
  const el = document.getElementById('fs-logs-view');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
};
window.updateFsStep = (id, text, percent, colorClass) => {
  const statusEl = document.getElementById(id + '-status');
  const barEl = document.getElementById(id + '-bar');
  if (statusEl) {
    statusEl.textContent = text;
    statusEl.style.color = (colorClass === 'active') ? '#14F1D9' : (colorClass === 'success') ? '#10B981' : (colorClass === 'error') ? '#EF4444' : '#8892B0';
  }
  if (barEl) {
    if(percent !== null) barEl.style.width = percent + '%';
    barEl.className = 'fs-bar ' + colorClass;
  }
};

document.getElementById('btn-run-full').onclick = () => {
  const modal = document.getElementById('fs-modal');
  if(modal) modal.style.display = 'flex';
  
  const container = document.getElementById('fs-steps-container');
  if(container) {
    container.innerHTML = [
      { id: 'fs-content', label: '1. Autonomous AI Content Pipeline' },
      { id: 'fs-ig-stealth', label: '2. IG Stealth Navigation Agent' },
      { id: 'fs-ig-post', label: '3. Media Syndication Subsystem' },
      { id: 'fs-gsc', label: '4. Telemetry & GSC Snapshot' }
    ].map(s => `
      <div class="fs-step">
        <div class="fs-step-header">
          <span>${s.label}</span>
          <span id="${s.id}-status" style="color:#8892B0">WAITING</span>
        </div>
        <div class="fs-progress">
          <div id="${s.id}-bar" class="fs-bar"></div>
        </div>
      </div>
    `).join('');
  }
  
  const logsView = document.getElementById('fs-logs-view');
  if(logsView) {
    logsView.innerHTML = '<div>> [SYSTEM] Initiating Core Sequence...</div>';
  }
  
  const h2 = document.getElementById('fs-header');
  if(h2) h2.innerHTML = '<span style="background:#14F1D9; box-shadow: 0 0 10px #14F1D9;"></span> CORE AUTOMATION SEQUENCE ACTIVE';

  if (!logEs) startLogs();
  
  try {
    fetch(API + '/api/test/full', { method: 'POST' }).catch(()=>{});
  } catch(e) {}
};


// ─── Posts (Sheet) ────────────────────────────────────────────
let sheetRows = [];

async function loadSheet() {
  const sTable = document.getElementById('sheet-table-wrap');
  const pTable = document.getElementById('published-table-wrap');
  const lTable = document.getElementById('stories-table-wrap');

  if (sTable) sTable.innerHTML = '<div class="empty"><span class="spinner"></span> Loading...</div>';
  if (pTable) pTable.innerHTML = '<div class="empty"><span class="spinner"></span> Loading...</div>';
  if (lTable) lTable.innerHTML = '<div class="empty"><span class="spinner"></span> Loading...</div>';
  
  try {
    sheetRows = await api('GET', '/api/spreadsheet');
    const drafts = sheetRows.filter(r => r.status !== 'published');
    const published = sheetRows.filter(r => r.status === 'published');
    
    // Update Metrics
    const pendingMet = document.getElementById('sheet-pending-met');
    const publishedMet = document.getElementById('sheet-published-met');
    const scoreMet = document.getElementById('sheet-score-met');
    
    if (pendingMet) pendingMet.textContent = drafts.length;
    if (publishedMet) publishedMet.textContent = published.length;
    
    if (scoreMet) {
       const scores = published.map(r => parseInt(r.seoScore)).filter(s => !isNaN(s));
       const avg = scores.length > 0 ? Math.round(scores.reduce((a,b)=>a+b, 0) / scores.length) : 0;
       scoreMet.textContent = avg + '%';
    }

    renderSheet(drafts);
    renderPublishedEditor(published);
    renderStories(published);
  } catch (e) {
    if (sTable) sTable.innerHTML = '<div class="empty color-gray">Error loading sheet.</div>';
  }
}

function switchSheetTab(tab, btn) {
  document.querySelectorAll('.sheet-tab-content').forEach(el => el.style.display = 'none');
  document.querySelectorAll('#page-sheets .tab-btn').forEach(el => el.classList.remove('active'));
  
  const target = document.getElementById('tab-' + tab);
  if (target) target.style.display = 'block';
  if (btn) btn.classList.add('active');
}

function renderPublishedEditor(rows) {
  const countEl = document.getElementById('published-count');
  const el = document.getElementById('published-table-wrap');
  if (!el) return;

  if (!rows?.length) {
    el.innerHTML = '<div class="empty">No published articles in history.</div>';
    if (countEl) countEl.textContent = '0';
    return;
  }
  if (countEl) countEl.textContent = rows.length;

  el.innerHTML = `
    <table id="published-editor-table">
      <thead>
        <tr>
          <th style="width:40px">#</th>
          <th>Article Details</th>
          <th>Keywords</th>
          <th>Score</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => {
          const score = parseInt(r.seoScore) || 0;
          const scoreClass = score >= 90 ? 'seo-high' : score >= 70 ? 'seo-mid' : 'seo-low';
          return `
          <tr data-index="${r.index}" data-topic="${escAttr(r.topic)}" data-keywords="${escAttr(r.keywords)}" data-links="${escAttr(r.internalLinks||'')}" data-status="${escAttr(r.status||'published')}">
            <td class="text-xs color-gray">${r.index}</td>
            <td>
              <strong class="text-primary">${escHtml(r.topic)}</strong><br>
              <a href="${escAttr(r.publishedUrl)}" target="_blank" class="text-xs color-blue" style="word-break:break-all">${escHtml(r.publishedUrl)}</a>
            </td>
            <td><span class="text-sm color-gray">${escHtml(r.keywords)}</span></td>
            <td>
              <div class="flex items-center gap-5">
                <div class="seo-score-pill ${scoreClass}">${r.seoScore || '?'}</div>
                <button class="pill-btn outline small" style="padding:2px 6px" onclick="runSeoAudit('${escAttr(r.publishedUrl)}', ${r.index}, this)" title="Refresh Audit">🔄</button>
              </div>
            </td>
            <td>
              <select class="clean-select status-select" style="padding:4px 20px 4px 8px;font-size:11px;" onchange="markDirty(this)">
                <option value="pending" ${r.status==='pending'?'selected':''}>Pending</option>
                <option value="published" ${r.status==='published'?'selected':''}>Published</option>
                <option value="archived" ${r.status==='archived'?'selected':''}>Archived</option>
              </select>
            </td>
            <td>
              <div class="flex gap-5">
                <button class="pill-btn primary small btn-save" style="display:none" onclick="saveRow(${r.index},this)">Save</button>
                <button class="pill-btn outline small" style="color:var(--error);border-color:#FEE2E2" onclick="deleteRow(${r.index})">Del</button>
              </div>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

async function runSeoAudit(url, index, btn) {
    if (!url || url === 'undefined') return toast('Missing URL', true);
    const oldHtml = btn.innerHTML;
    btn.innerHTML = '...'; btn.disabled = true;
    toast('Running Google PageSpeed Audit...');
    try {
        const res = await api('POST', '/api/seo/audit', { url, index });
        console.log('[SEO Audit Response]', res);
        const score = res.score !== undefined ? res.score : '?';
        toast(`Audit Success! Score: ${score}`);
        loadSheet(); // Refresh
    } catch(e) { 
        toast('Audit Failed: ' + e.message, true); 
        console.error('[SEO Audit Error]', e);
    } finally {
        btn.innerHTML = oldHtml; btn.disabled = false;
    }
}

function renderSheet(rows) {
  const countEl = document.getElementById('sheet-count');
  const el = document.getElementById('sheet-table-wrap');
  if (!el) return;

  if (!rows?.length) {
    el.innerHTML = '<div class="empty">No pending topics found. Great job!</div>';
    if (countEl) countEl.textContent = '0';
    return;
  }
  if (countEl) countEl.textContent = rows.length;

  el.innerHTML = `
    <table id="sheet-table">
      <thead>
        <tr>
          <th style="width:40px">#</th>
          <th>Topic</th>
          <th>Keywords</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
        <tr data-index="${r.index}" data-topic="${escAttr(r.topic)}" data-keywords="${escAttr(r.keywords)}" data-links="${escAttr(r.internalLinks||'')}" data-status="${escAttr(r.status||'pending')}">
          <td class="text-xs color-gray">${r.index}</td>
          <td><strong class="cell-display topic-display text-primary">${escHtml(r.topic)}</strong></td>
          <td><span class="cell-display kw-display text-sm color-gray">${escHtml(r.keywords)}</span></td>
          <td>
            <select class="clean-select status-select" style="padding:4px 24px 4px 8px;font-size:12px;" onchange="markDirty(this)">
              <option value="pending" ${r.status==='pending'?'selected':''}>Pending</option>
              <option value="published" ${r.status==='published'?'selected':''}>Published</option>
              <option value="error" ${r.status==='error'?'selected':''}>Error</option>
              <option value="skip" ${r.status==='skip'?'selected':''}>Skip</option>
            </select>
          </td>
          <td>
            <div class="flex gap-10">
              <button class="pill-btn primary small btn-save" style="display:none" onclick="saveRow(${r.index},this)">Save</button>
              <button class="pill-btn outline small" onclick="editRow(this)">Edit</button>
              <button class="pill-btn outline small" style="color:var(--error);border-color:#FEE2E2" onclick="deleteRow(${r.index})">Del</button>
            </div>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;

  // Click-to-edit logic (rest... same as before)
  attachEditListeners();
}

function renderStories(rows) {
  const countEl = document.getElementById('stories-count');
  const el = document.getElementById('stories-table-wrap');
  if (!el) return;

  if (!rows?.length) {
    el.innerHTML = '<div class="empty">No published stories yet. Start automation!</div>';
    if (countEl) countEl.textContent = '0';
    return;
  }
  if (countEl) countEl.textContent = rows.length;

  el.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>SEO</th>
          <th>Article Title</th>
          <th>Live URL</th>
          <th>Published Date</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => {
          const score = parseInt(r.seoScore) || 0;
          const scoreClass = score >= 90 ? 'seo-high' : score >= 70 ? 'seo-mid' : 'seo-low';
          return `
          <tr>
            <td><div class="seo-score-pill ${scoreClass}">${score}</div></td>
            <td><strong class="text-primary">${escHtml(r.topic)}</strong><br><span class="text-xs color-gray">${escHtml(r.keywords)}</span></td>
            <td><a href="${escHtml(r.publishedUrl)}" target="_blank" class="pill-btn small outline" style="border-radius:6px; color:#2563EB">View Live ↗</a></td>
            <td class="text-sm color-gray">${r.publishedDate ? r.publishedDate.substring(0, 10) : '—'}</td>
            <td>
              <div class="flex gap-5">
                 <button class="pill-btn small outline" onclick="runSeoAudit('${escAttr(r.publishedUrl)}', ${r.index}, this)">🔄 Audit</button>
                 <button class="pill-btn small dark" onclick="forceIndexRow('${escAttr(r.publishedUrl)}')">⚡ Index</button>
              </div>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

async function forceIndexRow(url) {
    if (!url || url === 'undefined') return toast('No URL to index', true);
    toast('Indexing requested...');
    try {
        await api('POST', '/api/index/request', { url });
        toast('Success!');
    } catch(e) { toast('Failed', true); }
}

function attachEditListeners() {
  document.querySelectorAll('#sheet-table .topic-display').forEach(el => {
    el.style.cursor = 'pointer'; el.title = 'Click to edit';
    el.addEventListener('click', function() { startCellEdit(this, 'topic'); });
  });
  document.querySelectorAll('#sheet-table .kw-display').forEach(el => {
    el.style.cursor = 'pointer'; el.title = 'Click to edit';
    el.addEventListener('click', function() { startCellEdit(this, 'keywords'); });
  });
}

function startCellEdit(displayEl, field) {
  if (displayEl.querySelector('input')) return;
  const current = displayEl.closest('tr').dataset[field] || displayEl.textContent.trim();
  const input = document.createElement('input');
  input.className = 'clean-input';
  input.style.padding = '4px 8px';
  input.value = current;
  displayEl.style.display = 'none';
  displayEl.closest('td').appendChild(input);
  input.focus(); input.select();
  input.addEventListener('blur', () => commitCellEdit(displayEl, input, field));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.remove(); displayEl.style.display = ''; }
  });
}

function commitCellEdit(displayEl, input, field) {
  const val = input.value.trim();
  const tr = displayEl.closest('tr');
  tr.dataset[field] = val;
  displayEl.textContent = val;
  displayEl.style.display = '';
  input.remove();
  markDirty(tr);
}

function markDirty(el) {
  const tr = el.closest ? el.closest('tr') : el;
  const saveBtn = tr.querySelector('.btn-save');
  if (saveBtn) saveBtn.style.display = 'inline-flex';
}

function editRow(btn) {
  const tr = btn.closest('tr');
  tr.querySelectorAll('.topic-display').forEach(el => startCellEdit(el, 'topic'));
  tr.querySelectorAll('.kw-display').forEach(el => startCellEdit(el, 'keywords'));
  markDirty(tr);
}

window.saveRow = async (idx, btn) => {
  const tr = btn.closest('tr');
  btn.textContent = '...'; btn.disabled = true;
  const payload = {
    topic: tr.dataset.topic,
    keywords: tr.dataset.keywords,
    status: tr.querySelector('.status-select')?.value || tr.dataset.status,
    internalLinks: tr.dataset.links || '[]',
  };
  try {
    await api('PUT', '/api/spreadsheet/' + idx, payload);
    toast('Row saved');
    btn.style.display = 'none';
  } catch (e) { toast('Save failed', true); }
  btn.textContent = 'Save'; btn.disabled = false;
};

window.deleteRow = async (idx) => {
  if (!confirm('Delete this topic?')) return;
  await api('DELETE', '/api/spreadsheet/' + idx);
  toast('Deleted');
  loadSheet();
};

document.getElementById('btn-refresh-sheet').onclick = loadSheet;

document.getElementById('btn-add-topic').onclick = async () => {
  const topic = document.getElementById('in-topic').value.trim();
  const keywords = document.getElementById('in-keywords').value.trim();
  const status = document.getElementById('in-status').value;
  if (!topic) { toast('Enter a topic', true); return; }
  const btn = document.getElementById('btn-add-topic');
  btn.textContent = '...'; btn.disabled = true;
  try {
    await api('POST', '/api/spreadsheet', { topic, keywords, status, internalLinks: '[]' });
    document.getElementById('in-topic').value = '';
    document.getElementById('in-keywords').value = '';
    toast('Row added');
    loadSheet();
  } catch (e) { toast('Failed to add', true); }
  btn.textContent = 'Add New Row'; btn.disabled = false;
};

document.getElementById('sheet-search')?.addEventListener('input', function() {
  const q = this.value.toLowerCase();
  const filtered = sheetRows.filter(r => r.status !== 'published' && (r.topic.toLowerCase().includes(q) || (r.keywords||'').toLowerCase().includes(q)));
  renderSheet(filtered);
});

document.getElementById('published-search')?.addEventListener('input', function() {
  const q = this.value.toLowerCase();
  const filtered = sheetRows.filter(r => r.status === 'published' && (r.topic.toLowerCase().includes(q) || (r.keywords||'').toLowerCase().includes(q)));
  renderPublishedEditor(filtered);
});

document.getElementById('stories-search')?.addEventListener('input', function() {
  const q = this.value.toLowerCase();
  const filtered = sheetRows.filter(r => r.status === 'published' && (r.topic.toLowerCase().includes(q) || (r.keywords||'').toLowerCase().includes(q)));
  renderStories(filtered);
});

// ─── Actions ──────────────────────────────────────────────────
async function loadActions() {
  const type = document.getElementById('filter-type').value;
  const status = document.getElementById('filter-status').value;
  let url = '/api/actions?limit=100';
  if (type) url += '&type=' + type;
  if (status) url += '&status=' + status;
  const actions = await api('GET', url);
  const el = document.getElementById('actions-table-wrap');
  if (!actions?.length) { el.innerHTML = '<div class="empty">No actions found.</div>'; return; }
  el.innerHTML = `<table>
    <thead><tr><th>Type</th><th>Status</th><th>When</th><th>Details</th></tr></thead>
    <tbody>${actions.map(a => `
      <tr>
        <td><strong class="text-primary">${a.type.replace(/_/g, ' ')}</strong></td>
        <td>${badgeStatus(a.status)}</td>
        <td class="text-sm color-gray">${new Date(a.timestamp).toLocaleString()}</td>
        <td class="text-sm color-gray" style="word-break: break-all; max-width: 400px;">${JSON.stringify(a.details)}</td>
      </tr>`).join('')}
    </tbody></table>`;
}
document.getElementById('btn-refresh-actions').onclick = loadActions;
document.getElementById('filter-type').onchange = loadActions;
document.getElementById('filter-status').onchange = loadActions;

// ─── Live Logs ────────────────────────────────────────────────
function startLogs() {
  if (logEs) return;
  const container = document.getElementById('log-container');
  logEs = new EventSource('/api/logs/stream');
  const statInfo = document.getElementById('log-status');
  statInfo.textContent = 'Live';
  statInfo.className = 'badge badge-green';

  logEs.onmessage = (e) => {
    const entry = JSON.parse(e.data);
    const line = document.createElement('div');
    line.className = 'log-' + entry.level;
    line.innerHTML = `<span class="log-time">${entry.timestamp.substring(11,19)}</span>${escHtml(entry.message)}`;
    container.appendChild(line);
    if (document.getElementById('log-autoscroll').checked) container.scrollTop = container.scrollHeight;
    if (container.children.length > 300) container.removeChild(container.firstChild);

    // Robotics Full Suite Interceptor
    const fsModal = document.getElementById('fs-modal');
    if (fsModal && fsModal.style.display !== 'none') {
       const msg = entry.message;
       const logsView = document.getElementById('fs-logs-view');
       if (logsView) {
         logsView.innerHTML += `<div>> ${escHtml(msg)}</div>`;
         logsView.scrollTop = logsView.scrollHeight;
       }
       
       if (msg.includes('Starting Content Pipeline')) {
          window.updateFsStep('fs-content', 'EXECUTING', 50, 'active');
       } else if (msg.includes('Starting Instagram Engagement')) {
          window.updateFsStep('fs-content', 'COMPLETED', 100, 'success');
          window.updateFsStep('fs-ig-stealth', 'EXECUTING', 50, 'active');
       } else if (msg.includes('Starting Instagram Posting')) {
          window.updateFsStep('fs-ig-stealth', 'COMPLETED', 100, 'success');
          window.updateFsStep('fs-ig-post', 'EXECUTING', 50, 'active');
       } else if (msg.includes('Starting GSC Snapshot')) {
          window.updateFsStep('fs-ig-post', 'COMPLETED', 100, 'success');
          window.updateFsStep('fs-gsc', 'EXECUTING', 50, 'active');
       } else if (msg.includes('FULL WORKFLOW SUITE COMPLETED')) {
          window.updateFsStep('fs-gsc', 'COMPLETED', 100, 'success');
          const h2 = document.getElementById('fs-header');
          if(h2) h2.innerHTML = '<span style="background:#10B981; box-shadow: 0 0 10px #10B981; animation:none;"></span> CORE SEQUENCE SUCCESS';
       } else if (msg.includes('FULL WORKFLOW FAILED') || msg.includes('FULL WORKFLOW SUITE FAILED')) {
          ['fs-content', 'fs-ig-stealth', 'fs-ig-post', 'fs-gsc'].forEach(id => {
             const bar = document.getElementById(id + '-bar');
             if (bar && bar.classList.contains('active')) {
                window.updateFsStep(id, 'ERROR DETECTED', 100, 'error');
             }
          });
          const h2 = document.getElementById('fs-header');
          if(h2) h2.innerHTML = '<span style="background:#EF4444; box-shadow: 0 0 10px #EF4444; animation:none;"></span> CORE SEQUENCE FAILED';
       }
    }
  };
  logEs.onerror = () => {
    statInfo.textContent = 'Disconnected';
    statInfo.className = 'badge badge-red';
    logEs = null;
  };
}
document.getElementById('btn-clear-logs').onclick = () => { document.getElementById('log-container').innerHTML = ''; };


// ─── GSC ──────────────────────────────────────────────────────
async function loadGsc() {
  try {
    const data = await api('GET', '/api/gsc/snapshot');
    renderGsc(data);
  } catch (e) {
    document.getElementById('gsc-table-wrap').innerHTML = '<div class="empty">No data. Click Pull Fresh Data.</div>';
  }
}

function renderGsc(data) {
  if (!data) return;
  document.getElementById('gsc-meta').textContent = data.pulledAt ? 'Last synced: ' + new Date(data.pulledAt).toLocaleString() : '';
  const pages = data.pages || [];
  
  let tClicks = 0, tImpr = 0;
  pages.forEach(p => { tClicks += (p.clicks||0); tImpr += (p.impressions||0); });
  const avgCtr = tImpr > 0 ? (tClicks / tImpr) : 0;
  
  document.getElementById('gsc-stats').innerHTML = `
    <div class="metric-card"><div class="mc-title">Total Clicks (Top)</div><div class="mc-value">${tClicks.toLocaleString()}</div></div>
    <div class="metric-card"><div class="mc-title">Impressions</div><div class="mc-value">${tImpr.toLocaleString()}</div></div>
    <div class="metric-card"><div class="mc-title">Avg CTR</div><div class="mc-value">${(avgCtr*100).toFixed(1)}%</div></div>
  `;

  if (pages.length) {
    document.getElementById('gsc-table-wrap').innerHTML = `<table>
      <thead><tr><th>Page URI</th><th>Clicks</th><th>Impr.</th><th>CTR</th><th>Pos</th></tr></thead>
      <tbody>${pages.slice(0,10).map(p => `<tr>
        <td class="text-sm color-gray" style="max-width:300px;word-break:break-all">${p.page}</td>
        <td class="text-primary text-bold">${p.clicks}</td><td class="color-gray">${p.impressions}</td>
        <td class="color-gray">${((p.ctr||0)*100).toFixed(1)}%</td>
        <td class="color-gray">${(p.position||0).toFixed(1)}</td>
      </tr>`).join('')}</tbody></table>`;
  }

  const declining = data.decliningPages || [];
  document.getElementById('gsc-declining-wrap').innerHTML = declining.length
    ? `<table><thead><tr><th>Page URI</th><th>Drop</th></tr></thead><tbody>${declining.map(p=>`<tr><td class="text-sm color-gray">${p.page}</td><td><span class="badge badge-red">${p.changePct}%</span></td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">No declining pages. Trend looks healthy.</div>';
}

document.getElementById('btn-gsc-refresh').onclick = async () => {
  toast('Pulling GSC data...');
  const btn = document.getElementById('btn-gsc-refresh');
  btn.textContent = 'Pulling...';
  try {
    const r = await api('POST', '/api/gsc/refresh');
    renderGsc(r.snapshot);
    toast('GSC data refreshed');
  } catch (e) { toast('GSC pull failed', true); }
  btn.textContent = 'Pull Fresh Data';
};

document.getElementById('btn-inspect-url').onclick = async () => {
  const url = document.getElementById('in-inspect-url').value.trim();
  if(!url) return toast('Please enter a URL to inspect', true);
  
  const btn = document.getElementById('btn-inspect-url');
  btn.textContent = 'Inspecting...';
  try {
    const r = await api('POST', '/api/gsc/inspect', { url });
    document.getElementById('inspect-result-wrap').style.display = 'block';
    
    const sEl = document.getElementById('insp-status');
    if(r.isIndexed) {
      sEl.textContent = '✅ Indexed Successfully';
      sEl.style.color = '#10B981';
    } else {
      sEl.textContent = '❌ Not Indexed';
      sEl.style.color = '#EF4444';
    }
    
    document.getElementById('insp-coverage').textContent = r.coverageState || 'Unknown coverage reason';
    document.getElementById('insp-crawl').textContent = r.lastCrawlTime ? new Date(r.lastCrawlTime).toLocaleString() : 'Never crawled';

  } catch(e) { toast('Inspection failed', true); }
  btn.textContent = 'Inspect URL';
};

document.getElementById('btn-force-index').onclick = async () => {
  const url = document.getElementById('in-inspect-url').value.trim();
  if(!url) return toast('Please enter a URL to index', true);
  const btn = document.getElementById('btn-force-index');
  btn.textContent = 'Pushing...';
  try {
    await api('POST', '/api/index/request', { url });
    toast('Indexing requested to Google & Bing!');
  } catch(e) { toast('Indexing push failed', true); }
  btn.textContent = 'Force Index';
};

// ─── Links ────────────────────────────────────────────────────
async function loadLinkIndex() {
  try {
    const index = await api('GET', '/api/links/index');
    const info = document.getElementById('link-index-info');
    if (index.builtAt) {
      info.textContent = `${index.posts?.length || 0} posts indexed — built ${timeSince(index.builtAt)}`;
      document.getElementById('link-index-posts').innerHTML = index.posts?.length
        ? `<table><thead><tr><th>Title</th><th>URL</th></tr></thead><tbody>${index.posts.map(p=>`<tr><td><strong class="text-primary">${p.title}</strong></td><td class="text-sm"><a href="${p.url}" target="_blank" style="color:#2563EB">${p.url}</a></td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">No posts in index.</div>';
    } else {
      info.textContent = 'No index built yet.';
    }
  } catch (e) { document.getElementById('link-index-info').textContent = 'Failed to load index.'; }
}

document.getElementById('btn-build-index').onclick = async () => {
  toast('Building index...');
  const btn = document.getElementById('btn-build-index');
  btn.textContent = 'Building...';
  try {
    const r = await api('POST', '/api/links/build');
    toast(`Index built: ${r.index?.posts?.length || 0} posts`);
    loadLinkIndex();
  } catch (e) { toast('Failed', true); }
  btn.textContent = 'Build Index';
};

document.getElementById('btn-scan-posts').onclick = async () => {
  const el = document.getElementById('link-opportunities');
  el.innerHTML = '<div class="empty"><span class="spinner"></span> Scanning...</div>';
  try {
    const r = await api('GET', '/api/links/audit');
    if (!r.opportunities?.length) { el.innerHTML = '<div class="empty">No opportunities found.</div>'; return; }
    el.innerHTML = `<table><thead><tr><th>Source Post</th><th>Recommended Internal Links</th></tr></thead><tbody>${
      r.opportunities.map(o => `<tr>
        <td><strong class="text-primary">${o.post.title}</strong><br><span class="text-xs color-gray">${o.post.url}</span></td>
        <td>${o.related.map(rel=>`<div class="text-sm mb-1">🔗 <a href="${rel.url}" target="_blank" style="color:#2563EB; font-weight:500">${rel.title}</a></div>`).join('')}</td>
      </tr>`).join('')
    }</tbody></table>`;
    toast(`${r.total} opportunities found`);
  } catch (e) { el.innerHTML = '<div class="empty">Scan failed.</div>'; toast('Scan failed', true); }
};

// ─── Settings (SaaS Config) ───────────────────────────────────
const WORKFLOW_LABELS = {
  wordpress: 'WordPress Posts',
  pinterest: 'Pinterest Sharing',
  blogger: 'Blogger Posts',
  instagram_engage: 'Instagram Engage',
  instagram_poster: 'Instagram Post',
  whatsapp_notifications: 'WhatsApp Notifications',
  reddit: 'Reddit Automated Posting',
  tumblr: 'Tumblr Automated Posting',
  twitter: 'Twitter / X Automated Posting',
};

async function loadSettings() {
  try {
    const [dbRes, envRes] = await Promise.all([
      api('GET', '/api/settings'),
      api('GET', '/api/config')
    ]);

    // SaaS Onboarding Detection: If core keys are missing, force focus on Settings
    const isConfigured = !!(envRes.OPENAI_API_KEY && envRes.WP_URL);
    if (!isConfigured && window.location.hash !== '#settings') {
       toast('⚠️ Setup Required: Please configure your AI and WordPress credentials.', true);
       navigate('settings');
    }

    // 1. Populate Workflow Toggles
    const workflows = dbRes.workflows || {};
    const tContainer = document.getElementById('settings-toggles-v2');
    if (tContainer) {
      tContainer.innerHTML = Object.entries(WORKFLOW_LABELS).map(([key, label]) => `
        <div class="list-item flex align-center justify-between border-top pt-2">
          <span class="text-xs font-semibold">${label}</span>
          <label class="switch small">
            <input type="checkbox" class="wf-toggle" data-key="${key}" ${workflows[key] ? 'checked' : ''}>
            <span class="slider round"></span>
          </label>
        </div>
      `).join('');
    }

    // 2. Populate .env Config Fields
    Object.entries(envRes).forEach(([key, value]) => {
      const input = document.getElementById(`conf-${key}`);
      if (input) input.value = value;
    });

    // 3. Update WhatsApp Status
    updateWhatsAppStatus();

  } catch (e) {
    toast('Failed to load settings', true);
  }
}

async function updateWhatsAppStatus() {
  try {
     const status = await api('GET', '/api/status');
     const badge = document.getElementById('wa-status-badge'); // Sidebar badge
     const badgeCard = document.getElementById('wa-status-badge-card'); // Card badge
     const connMsg = document.getElementById('wa-connected-msg');
     const qrCont = document.getElementById('wa-qr-container');
     const pairingSect = document.getElementById('wa-pairing-section');
     const configSect = document.getElementById('wa-config-section');

     if (status.whatsapp?.connected) {
        // Connected State
        if (badge) { badge.textContent = 'CONNECTED'; badge.className = 'count-badge green'; }
        if (badgeCard) { badgeCard.textContent = 'CONNECTED'; badgeCard.className = 'badge badge-green'; }
        
        if (connMsg) connMsg.style.display = 'block';
        if (qrCont) qrCont.style.display = 'none';
        if (pairingSect) pairingSect.style.display = 'none';
        if (configSect) configSect.style.display = 'block';
     } else {
        // Disconnected State
        if (badge) { badge.textContent = 'DISCONNECTED'; badge.className = 'count-badge red'; }
        if (badgeCard) { badgeCard.textContent = 'DISCONNECTED'; badgeCard.className = 'badge badge-red'; }

        if (connMsg) connMsg.style.display = 'none';
        if (configSect) configSect.style.display = 'none';
        if (pairingSect) pairingSect.style.display = 'block';
        
        const qrCont = document.getElementById('wa-qr-container');
        if (status.whatsapp?.qr) {
           if (qrCont) qrCont.style.display = 'block';
           QRCode.toCanvas(document.getElementById('wa-qr-canvas'), status.whatsapp.qr, { width: 180 });
        } else if (qrCont && !status.whatsapp?.pairingCode) {
           qrCont.style.display = 'none';
        }

        if (status.whatsapp?.pairingCode) {
           if (qrCont) qrCont.style.display = 'block';
           let pCodeEl = document.getElementById('wa-pairing-code-box');
           if (!pCodeEl) {
               const div = document.createElement('div');
               div.id = 'wa-pairing-code-box';
               qrCont.appendChild(div);
               pCodeEl = div;
           }
           pCodeEl.innerHTML = `<div class="mt-4 p-4 rounded bg-blue-soft border" style="border-color:#DBEAFE"><p class="text-xs font-bold color-blue mb-2 uppercase">WhatsApp Pairing Code</p><div class="text-3xl font-black tracking-widest bg-white p-3 rounded border-2 border-dashed border-blue-400 text-center">${status.whatsapp.pairingCode}</div><p class="text-xs color-gray mt-3 text-center">Open WhatsApp > Settings > Linked Devices > Link with Phone Number</p></div>`;
        } else {
           const pCodeEl = document.getElementById('wa-pairing-code-box');
           if (pCodeEl) pCodeEl.innerHTML = '';
        }
     }
  } catch(e) {}
}

// Save all .env config
document.getElementById('btn-save-all-config')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-save-all-config');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  const inputs = document.querySelectorAll('[id^="conf-"]');
  const updates = {};
  inputs.forEach(input => {
    const key = input.id.replace('conf-', '');
    updates[key] = input.value;
  });

  try {
    const res = await api('POST', '/api/config', updates);
    toast(res.message);
  } catch (e) {
    toast('Save Failed: ' + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Save All Changes';
  }
});

// Save Individual Card
document.querySelectorAll('.btn-save-card').forEach(btn => {
  btn.addEventListener('click', async () => {
    const card = btn.closest('.card');
    const inputs = card.querySelectorAll('[id^="conf-"]');
    if (!inputs.length) return;

    const updates = {};
    inputs.forEach(input => {
      const key = input.id.replace('conf-', '');
      updates[key] = input.value;
    });

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '...';

    try {
      const res = await api('POST', '/api/config', updates);
      toast(res.message || 'Section Saved');
    } catch (e) {
      toast('Save Failed: ' + e.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
});

// Save workflow toggles
document.getElementById('btn-save-workflows-v2')?.addEventListener('click', async () => {
  const toggles = document.querySelectorAll('.wf-toggle');
  const workflows = {};
  toggles.forEach(t => workflows[t.dataset.key] = t.checked);
  
  try {
    await api('POST', '/api/settings', { workflows });
    toast('Toggles saved to database');
  } catch (e) {
    toast('Save failed', true);
  }
});

// Connection Testers
document.querySelectorAll('.btn-test').forEach(btn => {
  btn.addEventListener('click', async () => {
    const service = btn.dataset.service;
    const originalText = btn.textContent;
    btn.textContent = '...';
    btn.disabled = true;

    try {
      const res = await api('POST', '/api/config/test', { service });
      if (res.ok) {
        toast(`✅ ${service.toUpperCase()} Connected!`);
        btn.classList.replace('outline', 'success');
      } else {
        toast(`❌ ${service.toUpperCase()} Failed: ${res.message}`, true);
        btn.classList.replace('outline', 'danger');
      }
    } catch (e) {
      toast(`${service} Connection Failed: ${e.message}`, true);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });
});

// Test All Systems
document.getElementById('btn-test-all-systems')?.addEventListener('click', async () => {
  const testers = document.querySelectorAll('.btn-test');
  const btn = document.getElementById('btn-test-all-systems');
  btn.disabled = true;
  btn.textContent = '🚀 Testing...';

  for (const t of testers) {
    t.click();
    await new Promise(r => setTimeout(r, 1500)); // Stagger tests
  }

  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = '🚀 Test All Systems';
  }, 2000);
});

document.getElementById('btn-wa-link')?.addEventListener('click', async () => {
  const num = document.getElementById('wa-phone-input').value.trim();
  if(!num) return toast('Enter a phone number first', true);
  
  const btn = document.getElementById('btn-wa-link');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Generating...';

  toast('Initializing secure link... please wait ~10s');

  try {
    const res = await api('POST', '/api/whatsapp/link', { number: num });
    if(res.ok) {
       toast('Pairing Code Generated!', false);
       // The status will be updated by the next poll or we force it
       setTimeout(updateWhatsAppStatus, 1000);
    } else {
       throw new Error(res.error);
    }
  } catch (e) {
    toast('Linking failed: ' + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

document.getElementById('btn-wa-reconnect')?.addEventListener('click', updateWhatsAppStatus);

document.getElementById('btn-wa-disconnect')?.addEventListener('click', async () => {
    if(!confirm('Are you sure you want to disconnect WhatsApp and wipe the current session?')) return;
    try {
        const res = await api('POST', '/api/whatsapp/disconnect');
        toast(res.message || 'Disconnected');
        updateWhatsAppStatus();
    } catch(e) {
        toast('Disconnect failed: ' + e.message, true);
    }
});

document.getElementById('btn-wa-qr')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-wa-qr');
    btn.disabled = true;
    toast('Generating QR Code... please wait');
    try {
        await api('POST', '/api/whatsapp/qr');
        updateWhatsAppStatus();
    } catch(e) {
        toast('QR generation failed: ' + e.message, true);
    } finally {
        btn.disabled = false;
    }
});


// ─── Settings Drawer Logic ────────────────────────────────────
const drawer = document.getElementById('settings-drawer');
const drawerOverlay = document.getElementById('drawer-overlay');
const drawerBody = document.getElementById('drawer-body');
const drawerTitle = document.getElementById('drawer-title-text');
const cardsLibrary = document.getElementById('settings-cards-library');

function openSettingsDrawer(cardId, title) {
  const card = document.getElementById(cardId);
  if (!card) return;

  // Move current card back to library if exists
  if (drawerBody.firstElementChild) {
    cardsLibrary.appendChild(drawerBody.firstElementChild);
  }

  // Move target card into drawer
  drawerBody.appendChild(card);
  
  drawerTitle.textContent = title;
  drawer.classList.add('open');
  drawerOverlay.classList.add('open');
}

function closeSettingsDrawer() {
  if (drawerBody.firstElementChild) {
    cardsLibrary.appendChild(drawerBody.firstElementChild);
  }
  drawer.classList.remove('open');
  drawerOverlay.classList.remove('open');
}

// Tile Clicks
document.querySelectorAll('.setting-tile').forEach(tile => {
  tile.addEventListener('click', () => {
    const target = tile.dataset.target;
    const name = tile.querySelector('.tile-name').textContent;
    openSettingsDrawer(target, name);
  });
});

// Close buttons
document.getElementById('btn-close-drawer')?.addEventListener('click', closeSettingsDrawer);
document.getElementById('btn-drawer-close-alt')?.addEventListener('click', closeSettingsDrawer);
drawerOverlay?.addEventListener('click', closeSettingsDrawer);

// Global Drawer Save Button
document.getElementById('btn-drawer-save')?.addEventListener('click', () => {
    const activeCard = drawerBody.firstElementChild;
    const saveBtn = activeCard?.querySelector('.btn-save-card') || activeCard?.querySelector('#btn-save-workflows-v2');
    if (saveBtn) {
        saveBtn.click();
    }
});

// ─── Init ─────────────────────────────────────────────────────
const hashPage = window.location.hash.replace('#', '');
const pathPage = window.location.pathname.replace('/', '');
const initPage = hashPage || pathPage || 'overview';
if (pages[initPage]) {
  navigate(initPage);
} else {
  navigate('overview');
}

// ─── Mobile Sidebar Toggle ────────────────────────────────────
document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('overlay').classList.add('active');
});
document.getElementById('overlay')?.addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('active');
});
