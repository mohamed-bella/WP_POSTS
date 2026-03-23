const API = '';

function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.className = 'toast show ' + (isError ? 'error' : '');
  el.textContent = msg;
  setTimeout(() => el.className = 'toast', 3000);
}

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Server error');
  return data;
}

function escAttr(str) {
  if (!str) return '';
  return str.toString().replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let seoChartInstance = null;

async function loadSeoHistory() {
  const tableWrap = document.getElementById('seo-history-wrap');
  tableWrap.innerHTML = '<div class="empty"><span class="spinner"></span> Loading history...</div>';
  
  try {
    const res = await api('GET', '/api/seo/history');
    if (!res.history || res.history.length === 0) {
      tableWrap.innerHTML = '<div class="empty">No SEO audits found. Run an audit to start tracking!</div>';
      return;
    }
    
    const timeline = [...res.history].reverse();
    renderSeoTimeline(timeline);
    renderSeoChart(res.history);

  } catch (e) {
    tableWrap.innerHTML = '<div class="empty color-gray">Failed to load SEO history.</div>';
  }
}

function renderSeoTimeline(history) {
  const el = document.getElementById('seo-history-wrap');
  const countEl = document.getElementById('seo-count');
  if (countEl) countEl.textContent = history.length;

  el.innerHTML = `<table>
    <thead><tr><th>When</th><th>URL</th><th>MTE Score</th><th>PageSpeed (M)</th><th>CTR</th><th>Access.</th><th>Vitals (LCP/FCP/CLS)</th></tr></thead>
    <tbody>${history.map(h => {
      const scoreClass = h.score >= 90 ? 'seo-high' : h.score >= 70 ? 'seo-mid' : 'seo-low';
      const m = h.metrics || {};
      const vitals = m.lcp ? `${m.lcp} / ${m.fcp} / ${m.cls}` : '-';
      return `
      <tr style="cursor:pointer" onclick="openPageDetails('${h.url}')" title="Click for Detailed Breakdown">
        <td class="text-sm color-gray" style="white-space:nowrap">${new Date(h.timestamp).toLocaleString()}</td>
        <td class="text-sm" style="color:#2563EB">${h.url.split('/').pop() || h.url}</td>
        <td><div class="seo-score-pill ${scoreClass}">${h.score}</div></td>
        <td class="color-gray text-sm">${h.pagespeed}</td>
        <td class="color-gray text-sm">${(h.ctr * 100).toFixed(1)}%</td>
        <td class="color-gray text-sm">${h.accessibility !== 'N/A' && h.accessibility !== undefined ? h.accessibility : '-'}</td>
        <td class="color-gray" style="font-family:monospace; font-size:11px">${vitals}</td>
      </tr>`;
    }).slice(0, 100).join('')}
    </tbody></table>`;
}

function renderSeoChart(history) {
  const ctx = document.getElementById('seoChart');
  if (!ctx || typeof Chart === 'undefined') return;

  const grouped = {};
  history.forEach(h => {
    const day = h.timestamp.split('T')[0];
    if (!grouped[day]) grouped[day] = { count: 0, score: 0, ps: 0, ctr: 0 };
    grouped[day].count++;
    grouped[day].score += h.score;
    grouped[day].ps += h.pagespeed;
    grouped[day].ctr += (h.ctr * 100);
  });

  const labels = Object.keys(grouped).sort();
  const dataScore = labels.map(day => Math.round(grouped[day].score / grouped[day].count));
  const dataPs = labels.map(day => Math.round(grouped[day].ps / grouped[day].count));
  const dataCtr = labels.map(day => (grouped[day].ctr / grouped[day].count).toFixed(1));

  if (seoChartInstance) seoChartInstance.destroy();
  seoChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Avg MTE Score', data: dataScore, borderColor: '#F97316', backgroundColor: 'rgba(249, 115, 22, 0.1)', fill: true, tension: 0.3, borderWidth: 3 },
        { label: 'Avg PageSpeed', data: dataPs, borderColor: '#3B82F6', borderDash: [5, 5], tension: 0.3 },
        { label: 'Avg CTR (%)', data: dataCtr, borderColor: '#10B981', borderDash: [2, 2], tension: 0.3 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, max: 100 } } }
  });
}

async function openPageDetails(url) {
  const modal = document.getElementById('seo-modal');
  const content = document.getElementById('modal-content');
  const loader = document.getElementById('modal-loader');
  
  document.getElementById('modal-url-title').textContent = "Live Audit & Analytics";
  document.getElementById('modal-url-link').textContent = url;
  document.getElementById('modal-url-link').href = url;
  
  modal.style.display = 'flex';
  content.style.display = 'none';
  loader.style.display = 'block';
  
  try {
    const res = await api('POST', '/api/seo/page-details', { url });
    
    // Populate Data
    const el = (id, val, good=90, warn=50) => {
        const d = document.getElementById(id);
        if(!d) return;
        d.textContent = val;
        d.className = 'metric-val';
        if(typeof val === 'number') {
            if(val >= good) d.classList.add('val-good');
            else if(val >= warn) d.classList.add('val-warn');
            else d.classList.add('val-poor');
        }
    };

    // Mobile
    const m = res.pagespeed.mobile;
    el('ps-mob-perf', m.performance, 90, 50);
    el('ps-mob-seo', m.seo, 90, 80);
    el('ps-mob-acc', m.accessibility, 90, 70);
    el('vitals-lcp', m.metrics.lcp);
    el('vitals-fcp', m.metrics.fcp);
    el('vitals-cls', m.metrics.cls);
    el('vitals-si', m.metrics.speedIndex);

    // Desktop
    const d = res.pagespeed.desktop;
    el('ps-dt-perf', d?.performance || 'N/A', 90, 50);
    el('ps-dt-seo', d?.seo || 'N/A', 90, 80);
    el('ps-dt-acc', d?.accessibility || 'N/A', 90, 70);

    // GSC
    const g = res.gsc || {};
    el('gsc-imp', g.impressions || 0, Infinity, 0); // No colors for pure count
    el('gsc-clk', g.clicks || 0, Infinity, 0);
    el('gsc-ctr', g.ctr ? g.ctr + '%' : '0%', 5, 1);
    el('gsc-pos', g.position || 'N/A');

    // Queries
    const tbody = document.getElementById('gsc-queries-body');
    if(g.queries && g.queries.length > 0) {
        tbody.innerHTML = g.queries.map(q => `
            <tr>
              <td>${q.keys[0]}</td>
              <td style="text-align:right; font-weight:bold">${q.clicks} clicks</td>
            </tr>
        `).join('');
    } else {
        tbody.innerHTML = '<tr><td colspan="2" class="color-gray text-center">No query data available for this URL.</td></tr>';
    }

    loader.style.display = 'none';
    content.style.display = 'block';

  } catch(e) {
    loader.innerHTML = `<span style="color:red">Failed to load: ${e.message}</span>`;
  }
}

document.getElementById('btn-refresh-seo')?.addEventListener('click', loadSeoHistory);
document.getElementById('btn-bulk-audit')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-bulk-audit');
    btn.textContent = 'Starting...'; btn.disabled = true;
    toast('Triggering Bulk Site Audit safely...');
    try {
        const res = await api('POST', '/api/seo/bulk');
        toast(res.message);
    } catch(e) {
        toast('Bulk Audit Failed: ' + e.message, true);
    }
    setTimeout(() => { btn.textContent = '🚀 Run Site Audit'; btn.disabled = false; }, 3000);
});

loadSeoHistory();
