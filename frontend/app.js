// ═══════════════════════════════════════════════════
//  CONFIG & STATE
// ═══════════════════════════════════════════════════
const API = '/api'; // served by Express at port 5700
let state = {
  user: null,
  token: null,
  currentPage: 'dashboard',
  dashboardData: null,
  approvers: [],
  categories: [],
  users: [],
  txPage: { kas_kecil: 1, kas_besar: 1 },
  auditPage: 1,
  chartInstances: {},
  pendingBadgeInterval: null,
  clockInterval: null,
  isLoggingOut: false
};

// ═══════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════
const fmtCurrency = n => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n||0);
const fmtDate = d => d ? new Date(d).toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' }) : '—';
const fmtDateTime = d => d ? new Date(d).toLocaleString('id-ID', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';

function toast(msg, type = 'info', duration = 4000) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span style="flex:1">${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, duration);
}


async function confirmDialog({
  title = 'Konfirmasi',
  text = 'Lanjutkan?',
  confirmText = 'Ya, lanjut',
  cancelText = 'Batal',
  icon = 'warning'
} = {}) {
  if (window.Swal) {
    const result = await Swal.fire({
      title,
      text,
      icon,
      showCancelButton: true,
      confirmButtonText: confirmText,
      cancelButtonText: cancelText,
      confirmButtonColor: '#2563eb',
      cancelButtonColor: '#334155',
      background: '#0f172a',
      color: '#e2e8f0'
    });
    return result.isConfirmed;
  }

  return confirm(text);
}

let debounceTimers = {};
function debounce(fn, delay) {
  const key = fn.name || 'fn';
  return (...args) => {
    clearTimeout(debounceTimers[key]);
    debounceTimers[key] = setTimeout(() => fn(...args), delay);
  };
}

async function apiCall(endpoint, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = isFormData ? {} : { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  try {
    const r = await fetch(`${API}${endpoint}`, { ...options, headers: { ...headers, ...options.headers } });
    const data = await r.json();

    if (r.status === 401) {
      const isAuthEndpoint = endpoint.startsWith('/auth/');
      if (!isAuthEndpoint && state.token && !state.isLoggingOut) {
        await doLogout({ silent: false, skipServerRequest: true, reason: 'Sesi habis, silakan login kembali' });
      }
      return data || null;
    }

    return data;
  } catch (e) {
    console.error('API error:', e);
    toast('Gagal terhubung ke server', 'error');
    return null;
  }
}

function saveAuth(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('jmo_token', token);
  localStorage.setItem('jmo_user', JSON.stringify(user));
}

function loadAuth() {
  const token = localStorage.getItem('jmo_token');
  const user = localStorage.getItem('jmo_user');
  if (token && user) {
    state.token = token;
    state.user = JSON.parse(user);
    return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════
async function doLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  
  if (!username || !password) { toast('Username dan password harus diisi', 'error'); return; }

  // Get Cloudflare Turnstile token
  let captchaToken = 'dev-bypass'; // fallback for dev
  const turnstileEl = document.querySelector('[name="cf-turnstile-response"]');
  if (turnstileEl) captchaToken = turnstileEl.value || 'dev-bypass';

  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  document.getElementById('loginBtnText').innerHTML = '<span class="spinner" style="width:16px;height:16px;margin-right:6px"></span>Memverifikasi...';

  const data = await apiCall('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password, captchaToken })
  });

  btn.disabled = false;
  document.getElementById('loginBtnText').textContent = 'Masuk ke Sistem';

  if (data && data.success) {
    saveAuth(data.token, data.user);
    toast(`Selamat datang, ${data.user.fullName}!`, 'success');
    initApp();
  } else {
    toast(data?.message || 'Login gagal', 'error');
    if (window.turnstile) window.turnstile.reset();
  }
}

async function doLogout(options = {}) {
  const { silent = false, skipServerRequest = false, reason = 'Anda telah logout' } = options;
  if (state.isLoggingOut) return;

  state.isLoggingOut = true;

  try {
    if (!skipServerRequest && state.token) {
      const headers = { 'Authorization': `Bearer ${state.token}` };
      await fetch(`${API}/auth/logout`, { method: 'POST', headers });
    }
  } catch (e) {
    console.warn('Logout request failed:', e);
  }

  if (state.pendingBadgeInterval) {
    clearInterval(state.pendingBadgeInterval);
    state.pendingBadgeInterval = null;
  }

  localStorage.removeItem('jmo_token');
  localStorage.removeItem('jmo_user');
  state.token = null;
  state.user = null;
  document.getElementById('app').style.display = 'none';
  document.getElementById('loginPage').style.display = 'flex';

  if (!silent) toast(reason, 'info');
  state.isLoggingOut = false;
}

// ═══════════════════════════════════════════════════
//  APP INIT
// ═══════════════════════════════════════════════════
function initApp() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  
  updateSidebarUser();
  updateTopbarDate();
  applyRolePermissions();
  loadApprovers();
  navigate('dashboard');
  
  // Refresh pending badge periodically
  if (state.pendingBadgeInterval) clearInterval(state.pendingBadgeInterval);
  state.pendingBadgeInterval = setInterval(refreshPendingBadge, 60000);
}

function updateSidebarUser() {
  const u = state.user;
  if (!u) return;
  document.getElementById('sidebarUserName').textContent = u.fullName;
  document.getElementById('sidebarUserRole').textContent = roleName(u.role);
  document.getElementById('sidebarAvatarText').textContent = u.fullName.charAt(0).toUpperCase();
}

function updateTopbarDate() {
  document.getElementById('topbarDate').textContent = new Date().toLocaleDateString('id-ID', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
}

function roleName(role) {
  const m = { admin: 'Administrator', bendahara: 'Bendahara', approver: 'Approver', viewer: 'Viewer' };
  return m[role] || role;
}

function applyRolePermissions() {
  const role = state.user?.role;

  // Hide admin-only nav for non-admins
  const usersBtn = document.getElementById('usersNavBtn');
  if (usersBtn) usersBtn.style.display = role === 'admin' ? 'flex' : 'none';

  // Approvals only for approver/admin
  const approvalsBtn = document.querySelector('[data-page="approvals"]');
  if (approvalsBtn) approvalsBtn.style.display = ['approver', 'admin'].includes(role) ? 'flex' : 'none';

  // Viewer tidak boleh lihat audit dan kategori
  const auditBtn = document.querySelector('[data-page="audit"]');
  if (auditBtn) auditBtn.style.display = role === 'viewer' ? 'none' : 'flex';

  const categoriesBtn = document.querySelector('[data-page="categories"]');
  if (categoriesBtn) categoriesBtn.style.display = role === 'viewer' ? 'none' : 'flex';
}

async function loadApprovers() {
  const data = await apiCall('/users/approvers/list');
  if (data?.success) state.approvers = data.data;
}

async function refreshPendingBadge() {
  if (!['approver','admin'].includes(state.user?.role)) return;
  const data = await apiCall('/transactions/approvals/pending');
  if (data?.success) {
    const count = data.data.length;
    const badge = document.getElementById('pendingBadge');
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-block' : 'none';
  }
}

// ═══════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════
const pageConfig = {
  'dashboard': { title: 'Dashboard', breadcrumb: 'Overview / Dashboard' },
  'kas-kecil': { title: 'Kas Kecil', breadcrumb: 'Transaksi / Kas Kecil' },
  'kas-besar': { title: 'Kas Besar', breadcrumb: 'Transaksi / Kas Besar' },
  'approvals': { title: 'Persetujuan', breadcrumb: 'Kas Besar / Persetujuan' },
  'reports': { title: 'Laporan & Export', breadcrumb: 'Laporan / Export' },
  'audit': { title: 'Audit Log', breadcrumb: 'Keamanan / Audit Log' },
  'users': { title: 'Manajemen User', breadcrumb: 'Admin / User' },
  'categories': { title: 'Kategori', breadcrumb: 'Admin / Kategori' },
  'profile': { title: 'Profil Saya', breadcrumb: 'Akun / Profil' }
};

function canAccessPage(page) {
  const role = state.user?.role;
  if (page === 'users') return role === 'admin';
  if (page === 'approvals') return ['approver', 'admin'].includes(role);
  if (page === 'audit' || page === 'categories') return role !== 'viewer';
  return true;
}

function navigate(page) {
  if (!canAccessPage(page)) {
    toast('Anda tidak memiliki akses ke menu ini', 'warning');
    page = 'dashboard';
  }

  document.querySelectorAll('.page-content').forEach(el => el.classList.add('hidden'));
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.remove('hidden');

  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');

  const cfg = pageConfig[page] || { title: page, breadcrumb: page };
  document.getElementById('topbarTitle').textContent = cfg.title;
  document.getElementById('topbarBreadcrumb').textContent = cfg.breadcrumb;
  state.currentPage = page;
  closeSidebar();

  switch(page) {
    case 'dashboard': loadDashboard(); break;
    case 'kas-kecil': loadKasPage('kas_kecil'); break;
    case 'kas-besar': loadKasPage('kas_besar'); break;
    case 'approvals': loadApprovalsList(); refreshPendingBadge(); break;
    case 'reports': initReportPage(); break;
    case 'audit': loadAuditLogs(); break;
    case 'users': loadUsers(); break;
    case 'categories': loadCategories(); break;
    case 'profile': loadProfile(); break;
  }
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('show');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('show');
}

// ═══════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════
async function loadDashboard() {
  const data = await apiCall('/reports/summary');
  if (!data?.success) return;
  state.dashboardData = data.data;

  const { balances, recentTransactions, pendingApprovals } = data.data;
  const kk = balances.kas_kecil || {};
  const kb = balances.kas_besar || {};

  // Greeting
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Selamat Pagi' : hour < 17 ? 'Selamat Siang' : 'Selamat Malam';
  document.getElementById('dashGreeting').textContent = `${greet}, ${state.user?.fullName}! Ini ringkasan keuangan Jakarta Max Owners.`;

  // Stats
  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card">
      <div class="stat-icon blue">💰</div>
      <div class="stat-content">
        <div class="stat-label">Saldo Kas Kecil</div>
        <div class="stat-value" style="font-size:17px">${fmtCurrency(kk.currentBalance)}</div>
        <div class="stat-change ${kk.currentBalance>=0?'up':'down'}">${kk.currentBalance>=0?'▲':'▼'} Saldo aktif</div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon purple">🏦</div>
      <div class="stat-content">
        <div class="stat-label">Saldo Kas Besar</div>
        <div class="stat-value" style="font-size:17px">${fmtCurrency(kb.currentBalance)}</div>
        <div class="stat-change ${kb.currentBalance>=0?'up':'down'}">${kb.currentBalance>=0?'▲':'▼'} Saldo aktif</div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon green">📈</div>
      <div class="stat-content">
        <div class="stat-label">Total Pemasukan</div>
        <div class="stat-value" style="font-size:17px">${fmtCurrency((kk.totalIncome||0)+(kb.totalIncome||0))}</div>
        <div class="stat-change up">↑ KK + KB</div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon red">📉</div>
      <div class="stat-content">
        <div class="stat-label">Total Pengeluaran</div>
        <div class="stat-value" style="font-size:17px">${fmtCurrency((kk.totalExpense||0)+(kb.totalExpense||0))}</div>
        <div class="stat-change down">↓ KK + KB</div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon amber">⏳</div>
      <div class="stat-content">
        <div class="stat-label">Menunggu Persetujuan</div>
        <div class="stat-value" style="color:var(--amber)">${pendingApprovals}</div>
        <div class="stat-change" style="color:var(--amber)">Transaksi pending</div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon blue">💵</div>
      <div class="stat-content">
        <div class="stat-label">Saldo Total</div>
        <div class="stat-value" style="font-size:17px">${fmtCurrency((kk.currentBalance||0)+(kb.currentBalance||0))}</div>
        <div class="stat-change up">Gabungan KAS</div>
      </div>
    </div>
  `;

  renderCharts();
  renderRecentTransactions(recentTransactions);
  loadPendingListWidget();
  refreshPendingBadge();
}

function renderCharts() {
  if (!state.dashboardData) return;
  const { chartData, categoryBreakdown } = state.dashboardData;
  const filter = document.getElementById('chartKasFilter')?.value || 'all';

  // Destroy old charts
  Object.values(state.chartInstances).forEach(c => c.destroy());
  state.chartInstances = {};

  // Process monthly chart data
  const monthMap = {};
  chartData.forEach(row => {
    if (filter !== 'all' && row.kas_type !== filter) return;
    const key = new Date(row.month).toLocaleDateString('id-ID', { month:'short', year:'2-digit' });
    if (!monthMap[key]) monthMap[key] = { income: 0, expense: 0 };
    monthMap[key].income += parseFloat(row.income || 0);
    monthMap[key].expense += parseFloat(row.expense || 0);
  });

  const labels = Object.keys(monthMap);
  const incomes = labels.map(k => monthMap[k].income);
  const expenses = labels.map(k => monthMap[k].expense);

  const ctx1 = document.getElementById('chartArusKas');
  if (ctx1) {
    state.chartInstances.arusKas = new Chart(ctx1, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Pemasukan', data: incomes, backgroundColor: 'rgba(16,185,129,0.7)', borderColor: '#10B981', borderWidth: 2, borderRadius: 4 },
          { label: 'Pengeluaran', data: expenses, backgroundColor: 'rgba(239,68,68,0.7)', borderColor: '#EF4444', borderWidth: 2, borderRadius: 4 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#94A3B8', font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: '#64748B', font: { size: 10 } }, grid: { color: '#1E2D4A' } },
          y: { ticks: { color: '#64748B', font: { size: 10 }, callback: v => 'Rp' + (v/1e6).toFixed(0) + 'jt' }, grid: { color: '#1E2D4A' } }
        }
      }
    });
  }

  // Category donut chart (expenses only)
  const catExpenses = categoryBreakdown.filter(c => c.transaction_type === 'expense' && (filter === 'all' || c.kas_type === filter));
  const catLabels = catExpenses.map(c => c.name);
  const catValues = catExpenses.map(c => parseFloat(c.total));
  const catColors = catExpenses.map(c => c.color || '#6366f1');

  const ctx2 = document.getElementById('chartKategori');
  if (ctx2 && catLabels.length) {
    state.chartInstances.kategori = new Chart(ctx2, {
      type: 'doughnut',
      data: { labels: catLabels, datasets: [{ data: catValues, backgroundColor: catColors.map(c => c + 'CC'), borderColor: catColors, borderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '65%',
        plugins: {
          legend: { position: 'right', labels: { color: '#94A3B8', font: { size: 11 }, boxWidth: 12 } },
          tooltip: { callbacks: { label: ctx => ` ${fmtCurrency(ctx.raw)}` } }
        }
      }
    });
  }
}

function renderRecentTransactions(txs) {
  if (!txs || !txs.length) {
    document.getElementById('recentTransactions').innerHTML = '<div class="empty-state"><p>Belum ada transaksi</p></div>';
    return;
  }
  document.getElementById('recentTransactions').innerHTML = txs.slice(0,8).map(tx => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="width:36px;height:36px;border-radius:9px;background:${tx.transaction_type==='income'?'var(--green-light)':'var(--red-light)'};display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">
        ${tx.transaction_type==='income'?'↑':'↓'}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${tx.description}</div>
        <div style="font-size:11px;color:var(--text-muted)">${fmtDate(tx.transaction_date)} · ${tx.kas_type==='kas_besar'?'KAS BESAR':'KAS KECIL'}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div class="${tx.transaction_type==='income'?'amount-positive':'amount-negative'}">${fmtCurrency(tx.amount)}</div>
        <div>${statusBadge(tx.status)}</div>
      </div>
    </div>
  `).join('');
}

async function loadPendingListWidget() {
  const data = await apiCall('/transactions?status=pending&kas_type=kas_besar&limit=5');
  if (!data?.success) return;
  const txs = data.data;
  if (!txs.length) {
    document.getElementById('pendingList').innerHTML = '<div class="empty-state"><p>Tidak ada transaksi pending</p></div>';
    return;
  }
  document.getElementById('pendingList').innerHTML = txs.map(tx => `
    <div style="padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="openTxDetail('${tx.id}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${tx.description}</div>
          <div style="font-size:11px;color:var(--text-muted)">${tx.transaction_number} · ${fmtDate(tx.transaction_date)}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div class="amount-negative">${fmtCurrency(tx.amount)}</div>
          <div style="font-size:11px;color:var(--amber);margin-top:2px">⏳ ${tx.approval_count}/3 approval</div>
        </div>
      </div>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════════════
//  KAS KECIL / KAS BESAR PAGES
// ═══════════════════════════════════════════════════
async function loadKasPage(kasType) {
  const containerId = kasType === 'kas_kecil' ? 'kasKecilContent' : 'kasBesarContent';
  const container = document.getElementById(containerId);
  const kasLabel = kasType === 'kas_kecil' ? 'Kas Kecil' : 'Kas Besar';
  const canCreate = ['admin','bendahara'].includes(state.user?.role);

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">
      <div>
        <div class="section-title">${kasLabel}</div>
        <div class="section-subtitle">Kelola semua transaksi ${kasLabel.toLowerCase()}</div>
      </div>
      ${canCreate ? `<button class="btn btn-primary" onclick="openTxModal('${kasType}')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Tambah Transaksi
      </button>` : ''}
    </div>
    <div class="stats-grid" id="kasStats_${kasType}" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
      <div class="spinner" style="margin:16px auto"></div>
    </div>
    <div class="card">
      <div class="filters-bar" style="margin-bottom:16px">
        <select class="filter-select" id="filterType_${kasType}" onchange="loadKasTransactions('${kasType}')">
          <option value="">Semua Tipe</option>
          <option value="income">Pemasukan</option>
          <option value="expense">Pengeluaran</option>
        </select>
        <select class="filter-select" id="filterStatus_${kasType}" onchange="loadKasTransactions('${kasType}')">
          <option value="">Semua Status</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <input type="date" class="filter-select" id="filterStart_${kasType}" onchange="loadKasTransactions('${kasType}')">
        <input type="date" class="filter-select" id="filterEnd_${kasType}" onchange="loadKasTransactions('${kasType}')">
        <div class="search-input-wrap">
          <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input type="text" id="filterSearch_${kasType}" placeholder="Cari transaksi..." oninput="debounce(()=>loadKasTransactions('${kasType}'),400)()">
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>No. Transaksi</th>
              <th>Tanggal</th>
              <th>Kategori</th>
              <th>Keterangan</th>
              <th>Tipe</th>
              <th style="text-align:right">Jumlah</th>
              <th>Status</th>
              ${kasType==='kas_besar'?'<th>Approval</th>':''}
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody id="txTableBody_${kasType}">
            <tr><td colspan="9" style="text-align:center;padding:30px"><div class="spinner" style="margin:0 auto"></div></td></tr>
          </tbody>
        </table>
      </div>
      <div id="txPagination_${kasType}" class="pagination"></div>
    </div>
  `;

  loadKasBalance(kasType);
  loadKasTransactions(kasType);
}

async function loadKasBalance(kasType) {
  const data = await apiCall('/reports/summary');
  if (!data?.success) return;
  const b = data.data.balances[kasType] || {};
  document.getElementById(`kasStats_${kasType}`).innerHTML = `
    <div class="stat-card">
      <div class="stat-icon green">📈</div>
      <div class="stat-content">
        <div class="stat-label">Total Pemasukan</div>
        <div class="stat-value" style="font-size:18px">${fmtCurrency(b.totalIncome)}</div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon red">📉</div>
      <div class="stat-content">
        <div class="stat-label">Total Pengeluaran</div>
        <div class="stat-value" style="font-size:18px">${fmtCurrency(b.totalExpense)}</div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon ${b.currentBalance>=0?'blue':'red'}">💰</div>
      <div class="stat-content">
        <div class="stat-label">Saldo Saat Ini</div>
        <div class="stat-value" style="font-size:18px;color:${b.currentBalance>=0?'var(--green)':'var(--red)'}">${fmtCurrency(b.currentBalance)}</div>
      </div>
    </div>
  `;
}

async function loadKasTransactions(kasType) {
  const page = state.txPage[kasType] || 1;
  const params = new URLSearchParams({
    kasType,
    page,
    limit: 15,
    transactionType: document.getElementById(`filterType_${kasType}`)?.value || '',
    status: document.getElementById(`filterStatus_${kasType}`)?.value || '',
    startDate: document.getElementById(`filterStart_${kasType}`)?.value || '',
    endDate: document.getElementById(`filterEnd_${kasType}`)?.value || '',
    search: document.getElementById(`filterSearch_${kasType}`)?.value || '',
  });

  const tbody = document.getElementById(`txTableBody_${kasType}`);
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:30px"><div class="spinner" style="margin:0 auto"></div></td></tr>`;

  const data = await apiCall(`/transactions?${params}`);
  if (!data?.success) return;

  const txs = data.data;
  const { total, totalPages } = data.pagination;

  if (!txs.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state" style="padding:40px 20px">
      <h3>Tidak ada transaksi</h3><p>Belum ada data atau coba ubah filter</p>
    </div></td></tr>`;
    return;
  }

  const canAction = ['admin','bendahara'].includes(state.user?.role);
  tbody.innerHTML = txs.map(tx => `
    <tr>
      <td class="mono">${tx.transaction_number}</td>
      <td>${fmtDate(tx.transaction_date)}</td>
      <td>
        ${tx.category_name ? `<span style="display:inline-flex;align-items:center;gap:5px">
          <span style="width:8px;height:8px;border-radius:50%;background:${tx.category_color||'#6366f1'};display:inline-block"></span>
          ${tx.category_name}
        </span>` : '<span style="color:var(--text-muted)">—</span>'}
      </td>
      <td style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${tx.description}">${tx.description}</td>
      <td>${tx.transaction_type === 'income' ? '<span class="badge badge-income">↑ Masuk</span>' : '<span class="badge badge-expense">↓ Keluar</span>'}</td>
      <td style="text-align:right" class="${tx.transaction_type==='income'?'amount-positive':'amount-negative'}">${fmtCurrency(tx.amount)}</td>
      <td>${statusBadge(tx.status)}</td>
      ${kasType==='kas_besar' ? `<td><span style="font-size:12px;color:var(--text-muted)">${tx.approval_count||0}/3</span></td>` : ''}
      <td>
        <div style="display:flex;gap:5px">
          <button class="btn btn-ghost btn-xs" onclick="openTxDetail('${tx.id}')">Detail</button>
          ${canAction && tx.status==='pending' ? `<button class="btn btn-secondary btn-xs" onclick="editTx('${tx.id}')">Edit</button>` : ''}
          ${canAction && tx.status!=='cancelled' ? `<button class="btn btn-xs" style="background:var(--red-light);color:var(--red)" onclick="cancelTx('${tx.id}','${tx.transaction_number}')">Batal</button>` : ''}
        </div>
      </td>
    </tr>
  `).join('');

  // Pagination
  const paginEl = document.getElementById(`txPagination_${kasType}`);
  if (paginEl) {
    paginEl.innerHTML = `
      <span class="page-info">Menampilkan ${txs.length} dari ${total} transaksi</span>
      ${Array.from({length:Math.min(totalPages,7)},(_,i)=>{
        const p = i+1;
        return `<button class="page-btn ${p===page?'active':''}" onclick="goPage('${kasType}',${p})">${p}</button>`;
      }).join('')}
    `;
  }
}

function goPage(kasType, page) {
  state.txPage[kasType] = page;
  loadKasTransactions(kasType);
}

// ═══════════════════════════════════════════════════
//  TRANSACTION MODAL
// ═══════════════════════════════════════════════════
async function openTxModal(defaultKasType = 'kas_kecil') {
  document.getElementById('txId').value = '';
  document.getElementById('txModalTitle').textContent = 'Tambah Transaksi';
  document.getElementById('txKasType').value = defaultKasType;
  document.getElementById('txType').value = 'income';
  document.getElementById('txDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('txAmount').value = '';
  document.getElementById('txDescription').value = '';
  document.getElementById('txNotes').value = '';
  document.getElementById('txReference').value = '';
  document.getElementById('txAttachments').value = '';
  
  await loadCategoriesForModal(defaultKasType);
  onKasTypeChange();
  openModal('txModal');
}

async function loadCategoriesForModal(kasType) {
  const data = await apiCall(`/reports/categories?type=${kasType}`);
  const sel = document.getElementById('txCategory');
  sel.innerHTML = '<option value="">— Pilih Kategori —</option>';
  if (data?.success) {
    data.data.forEach(c => {
      sel.innerHTML += `<option value="${c.id}">${c.name}</option>`;
    });
  }
}

function onKasTypeChange() {
  const kasType = document.getElementById('txKasType').value;
  const txType = document.getElementById('txType').value;
  loadCategoriesForModal(kasType);
  const approversSection = document.getElementById('approversSection');
  const needApprovers = kasType === 'kas_besar' && txType === 'expense';
  approversSection.classList.toggle('hidden', !needApprovers);
  if (needApprovers) populateApproverSelects();
}

function populateApproverSelects() {
  ['approver1','approver2','approver3'].forEach(id => {
    const sel = document.getElementById(id);
    sel.innerHTML = '<option value="">— Pilih Approver —</option>';
    state.approvers.forEach(a => {
      sel.innerHTML += `<option value="${a.id}">${a.full_name} (${a.username})</option>`;
    });
  });
}

function validateApprovers() {
  const v1 = document.getElementById('approver1').value;
  const v2 = document.getElementById('approver2').value;
  const v3 = document.getElementById('approver3').value;
  const vals = [v1,v2,v3].filter(Boolean);
  const unique = new Set(vals).size === vals.length;
  const err = document.getElementById('approverError');
  if (vals.length > 1 && !unique) {
    err.classList.remove('hidden');
    err.textContent = 'Setiap approver harus berbeda';
    return false;
  }
  err.classList.add('hidden');
  return true;
}

function validateAttachments() {
  const input = document.getElementById('txAttachments');
  const files = Array.from(input.files || []);
  if (files.length > 4) {
    toast('Maksimal 4 attachment', 'error');
    input.value = '';
    return false;
  }

  const tooLarge = files.find(f => f.size > 5 * 1024 * 1024);
  if (tooLarge) {
    toast('Ukuran setiap attachment maksimal 5MB', 'error');
    input.value = '';
    return false;
  }

  return true;
}

async function submitTransaction() {
  const id = document.getElementById('txId').value;
  const kasType = document.getElementById('txKasType').value;
  const transactionType = document.getElementById('txType').value;
  const categoryId = document.getElementById('txCategory').value;
  const amount = document.getElementById('txAmount').value;
  const description = document.getElementById('txDescription').value.trim();
  const transactionDate = document.getElementById('txDate').value;
  const referenceNumber = document.getElementById('txReference').value.trim();
  const notes = document.getElementById('txNotes').value.trim();
  const attachmentInput = document.getElementById('txAttachments');
  const attachments = Array.from(attachmentInput.files || []);

  if (!amount || !description || !transactionDate) {
    toast('Jumlah, keterangan, dan tanggal harus diisi', 'error');
    return;
  }

  if (!validateAttachments()) return;
  if (!id && attachments.length < 1) {
    toast('Minimal 1 attachment wajib diupload', 'error');
    return;
  }

  let approverIds = null;
  if (kasType === 'kas_besar' && transactionType === 'expense') {
    const a1 = document.getElementById('approver1').value;
    const a2 = document.getElementById('approver2').value;
    const a3 = document.getElementById('approver3').value;
    if (!a1 || !a2 || !a3) { toast('Pilih 3 approver untuk pengeluaran Kas Besar', 'error'); return; }
    if (!validateApprovers()) return;
    approverIds = [a1, a2, a3];
  }

  const btn = document.getElementById('txSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Menyimpan...';

  const endpoint = id ? `/transactions/${id}` : '/transactions';
  const method = id ? 'PUT' : 'POST';

  let requestBody;
  if (id) {
    const payload = { kasType, transactionType, categoryId: categoryId||null, amount: parseFloat(amount), description, transactionDate, referenceNumber: referenceNumber||null, notes: notes||null, approverIds };
    requestBody = JSON.stringify(payload);
  } else {
    const formData = new FormData();
    formData.append('kasType', kasType);
    formData.append('transactionType', transactionType);
    formData.append('categoryId', categoryId || '');
    formData.append('amount', parseFloat(amount));
    formData.append('description', description);
    formData.append('transactionDate', transactionDate);
    formData.append('referenceNumber', referenceNumber || '');
    formData.append('notes', notes || '');
    if (approverIds) formData.append('approverIds', JSON.stringify(approverIds));
    attachments.forEach((file) => formData.append('attachments', file));
    requestBody = formData;
  }

  const data = await apiCall(endpoint, { method, body: requestBody });
  btn.disabled = false;
  btn.textContent = 'Simpan Transaksi';

  if (data?.success) {
    toast(data.message, 'success');
    closeTxModal();
    if (kasType === 'kas_kecil') loadKasTransactions('kas_kecil');
    else loadKasTransactions('kas_besar');
  } else {
    toast(data?.message || 'Gagal menyimpan transaksi', 'error');
  }
}

function closeTxModal() { closeModal('txModal'); }

async function editTx(id) {
  const data = await apiCall(`/transactions/${id}`);
  if (!data?.success) return;
  const tx = data.data;
  document.getElementById('txId').value = tx.id;
  document.getElementById('txModalTitle').textContent = 'Edit Transaksi';
  document.getElementById('txKasType').value = tx.kas_type;
  document.getElementById('txType').value = tx.transaction_type;
  document.getElementById('txAmount').value = tx.amount;
  document.getElementById('txDescription').value = tx.description;
  document.getElementById('txNotes').value = tx.notes || '';
  document.getElementById('txReference').value = tx.reference_number || '';
  document.getElementById('txDate').value = tx.transaction_date?.split('T')[0] || '';
  await loadCategoriesForModal(tx.kas_type);
  document.getElementById('txCategory').value = tx.category_id || '';
  onKasTypeChange();
  openModal('txModal');
}

async function openTxDetail(id) {
  const data = await apiCall(`/transactions/${id}`);
  if (!data?.success) return;
  const tx = data.data;
  const approvals = tx.approvals || [];

  document.getElementById('txDetailTitle').textContent = tx.description;
  document.getElementById('txDetailNumber').textContent = tx.transaction_number;

  let approvalHTML = '';
  if (tx.kas_type === 'kas_besar' && tx.transaction_type === 'expense') {
    approvalHTML = `
      <div style="margin-top:20px">
        <div style="font-size:13px;font-weight:700;margin-bottom:12px">Progress Persetujuan (${approvals.filter(a=>a.status==='approved').length}/3)</div>
        <div class="approval-steps">
          ${approvals.map((a,i) => `
            <div class="approval-step">
              <div class="step-circle ${a.status==='approved'?'done':a.status==='rejected'?'rejected':i===0||approvals[i-1]?.status==='approved'?'active':''}">
                ${a.status==='approved'?'✓':a.status==='rejected'?'✗':i+1}
              </div>
              <div class="step-name">${a.approver_name||'—'}</div>
              <div class="step-label">${a.status==='approved'?`<span style="color:var(--green)">✅ Disetujui</span>`:a.status==='rejected'?`<span style="color:var(--red)">❌ Ditolak</span>`:'⏳ Menunggu'}</div>
              ${a.comments ? `<div class="step-label" style="color:var(--text-muted);font-style:italic">"${a.comments}"</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  document.getElementById('txDetailBody').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div>
        <div class="info-label">Jenis KAS</div>
        <div class="info-value">${tx.kas_type === 'kas_besar' ? '<span class="badge badge-kas-besar">KAS BESAR</span>' : '<span class="badge badge-kas-kecil">KAS KECIL</span>'}</div>
      </div>
      <div>
        <div class="info-label">Tipe Transaksi</div>
        <div class="info-value">${tx.transaction_type === 'income' ? '<span class="badge badge-income">↑ Pemasukan</span>' : '<span class="badge badge-expense">↓ Pengeluaran</span>'}</div>
      </div>
      <div>
        <div class="info-label">Jumlah</div>
        <div class="info-value fw-700" style="font-size:18px;color:${tx.transaction_type==='income'?'var(--green)':'var(--red)'}">
          ${fmtCurrency(tx.amount)}
        </div>
      </div>
      <div>
        <div class="info-label">Status</div>
        <div class="info-value">${statusBadge(tx.status)}</div>
      </div>
      <div>
        <div class="info-label">Tanggal Transaksi</div>
        <div class="info-value">${fmtDate(tx.transaction_date)}</div>
      </div>
      <div>
        <div class="info-label">Kategori</div>
        <div class="info-value">${tx.category_name || '—'}</div>
      </div>
      <div>
        <div class="info-label">No. Referensi</div>
        <div class="info-value mono">${tx.reference_number || '—'}</div>
      </div>
      <div>
        <div class="info-label">Dibuat oleh</div>
        <div class="info-value">${tx.created_by_name || '—'}</div>
      </div>
      <div style="grid-column:span 2">
        <div class="info-label">Keterangan</div>
        <div class="info-value">${tx.description}</div>
      </div>
      ${tx.notes ? `<div style="grid-column:span 2"><div class="info-label">Catatan</div><div class="info-value">${tx.notes}</div></div>` : ''}
      ${(() => {
        let attachments = [];
        try { attachments = tx.attachment_url ? JSON.parse(tx.attachment_url) : []; } catch(e) { attachments = tx.attachment_url ? [tx.attachment_url] : []; }
        if (!Array.isArray(attachments) || attachments.length === 0) return '';
        return `<div style="grid-column:span 2"><div class="info-label">Attachment</div><div class="info-value">${attachments.map((url, idx) => `<div><a href="${API.replace('/api','')}${url}" target="_blank" rel="noopener">Attachment ${idx + 1}</a></div>`).join('')}</div></div>`;
      })()}
      <div>
        <div class="info-label">Dibuat pada</div>
        <div class="info-value">${fmtDateTime(tx.created_at)}</div>
      </div>
      <div>
        <div class="info-label">Terakhir diubah</div>
        <div class="info-value">${fmtDateTime(tx.updated_at)}</div>
      </div>
    </div>
    ${approvalHTML}
  `;

  // Footer actions
  const isApprover = state.user?.role === 'approver' || state.user?.role === 'admin';
  const canApprove = isApprover && tx.status === 'pending' &&
    approvals.some(a => a.approver_id === state.user?.id && a.status === 'pending');

  document.getElementById('txDetailFooter').innerHTML = `
    <button class="btn btn-secondary" onclick="closeModal('txDetailModal')">Tutup</button>
    ${canApprove ? `<button class="btn btn-primary" onclick="closeModal('txDetailModal');openApprovalModal('${tx.id}','${tx.transaction_number}',${tx.amount},'${tx.description}')">
      Proses Persetujuan
    </button>` : ''}
  `;

  openModal('txDetailModal');
}

async function cancelTx(id, txNumber) {
  if (!await confirmDialog({ title: 'Batalkan transaksi?', text: `Batalkan transaksi ${txNumber}?`, confirmText: 'Ya, batalkan' })) return;
  const data = await apiCall(`/transactions/${id}`, { method: 'DELETE' });
  if (data?.success) {
    toast('Transaksi berhasil dibatalkan', 'success');
    loadKasTransactions(state.currentPage === 'kas-kecil' ? 'kas_kecil' : 'kas_besar');
  } else {
    toast(data?.message || 'Gagal membatalkan', 'error');
  }
}

// ═══════════════════════════════════════════════════
//  APPROVALS
// ═══════════════════════════════════════════════════
async function loadApprovalsList() {
  document.getElementById('approvalsList').innerHTML = '<div class="card"><div class="empty-state"><div class="spinner"></div></div></div>';
  const data = await apiCall('/transactions/approvals/pending');
  if (!data?.success) return;
  const txs = data.data;

  if (!txs.length) {
    document.getElementById('approvalsList').innerHTML = `
      <div class="card">
        <div class="empty-state" style="padding:60px">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          <h3>Tidak ada persetujuan pending</h3>
          <p>Semua transaksi sudah diproses</p>
        </div>
      </div>`;
    return;
  }

  document.getElementById('approvalsList').innerHTML = `
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>No. Transaksi</th><th>Tanggal</th><th>Keterangan</th><th>Kategori</th>
            <th>Urutan Saya</th><th style="text-align:right">Jumlah</th><th>Dibuat oleh</th><th>Aksi</th>
          </tr></thead>
          <tbody>
            ${txs.map(tx => `
              <tr>
                <td class="mono">${tx.transaction_number}</td>
                <td>${fmtDate(tx.transaction_date)}</td>
                <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${tx.description}</td>
                <td>${tx.category_name || '—'}</td>
                <td><span style="background:var(--accent-light);color:var(--accent);padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700">Approver #${tx.approval_order}</span></td>
                <td class="amount-negative" style="text-align:right">${fmtCurrency(tx.amount)}</td>
                <td>${tx.created_by_name || '—'}</td>
                <td>
                  <div style="display:flex;gap:6px">
                    <button class="btn btn-ghost btn-xs" onclick="openTxDetail('${tx.id}')">Detail</button>
                    <button class="btn btn-success btn-xs" onclick="openApprovalModal('${tx.id}','${tx.transaction_number}',${tx.amount},'${tx.description}')">Proses</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function openApprovalModal(txId, txNumber, amount, description) {
  document.getElementById('approvalTxId').value = txId;
  document.getElementById('approvalModalTitle').textContent = `Proses Persetujuan — ${txNumber}`;
  document.getElementById('approvalTxInfo').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div><div class="info-label">No. Transaksi</div><div class="mono">${txNumber}</div></div>
      <div><div class="info-label">Jumlah</div><div class="amount-negative" style="font-size:15px">${fmtCurrency(amount)}</div></div>
      <div style="grid-column:span 2"><div class="info-label">Keterangan</div><div>${description}</div></div>
    </div>
  `;
  document.getElementById('approvalComment').value = '';
  openModal('approvalModal');
}

async function submitApproval(action) {
  const txId = document.getElementById('approvalTxId').value;
  const comments = document.getElementById('approvalComment').value.trim();
  const data = await apiCall(`/transactions/${txId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ action, comments })
  });
  if (data?.success) {
    toast(data.message, 'success');
    closeModal('approvalModal');
    loadApprovalsList();
    refreshPendingBadge();
  } else {
    toast(data?.message || 'Gagal memproses', 'error');
  }
}

// ═══════════════════════════════════════════════════
//  REPORTS & EXPORT
// ═══════════════════════════════════════════════════
function initReportPage() {
  const today = new Date().toISOString().split('T')[0];
  const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  document.getElementById('rptStartDate').value = firstDay;
  document.getElementById('rptEndDate').value = today;
}

function getReportParams() {
  const kasType = document.getElementById('rptKasType').value;
  const startDate = document.getElementById('rptStartDate').value;
  const endDate = document.getElementById('rptEndDate').value;
  const title = document.getElementById('rptTitle').value;
  return new URLSearchParams({ kasType, startDate, endDate, title });
}

function exportExcel() {
  const params = getReportParams();
  window.open(`${API}/export/excel?${params}&_token=${state.token}`, '_blank');
  toast('Mengunduh laporan Excel...', 'info');
}

function exportPDF() {
  const params = getReportParams();
  window.open(`${API}/export/pdf?${params}&_token=${state.token}`, '_blank');
  toast('Mengunduh laporan PDF...', 'info');
}

async function loadReportPreview() {
  const kasType = document.getElementById('rptKasType').value;
  const startDate = document.getElementById('rptStartDate').value;
  const endDate = document.getElementById('rptEndDate').value;

  const params = new URLSearchParams({ kasType, startDate, endDate });
  const previewEl = document.getElementById('reportPreview');
  previewEl.innerHTML = '<div class="empty-state"><div class="spinner spinner-lg"></div><p style="margin-top:12px">Memuat data...</p></div>';

  const data = await apiCall(`/reports/monthly?${params}`);
  if (!data?.success) return;

  const { transactions, summary } = data.data;
  let totalIncome = 0, totalExpense = 0;
  summary.forEach(s => {
    if (s.transaction_type === 'income') totalIncome += parseFloat(s.total);
    else totalExpense += parseFloat(s.total);
  });

  previewEl.innerHTML = `
    <div class="card-header">
      <div class="card-title">Preview Laporan (${transactions.length} transaksi)</div>
      <div style="display:flex;gap:16px;font-size:13px">
        <span class="amount-positive">Total Masuk: ${fmtCurrency(totalIncome)}</span>
        <span class="amount-negative">Total Keluar: ${fmtCurrency(totalExpense)}</span>
        <span style="font-weight:700;color:${totalIncome-totalExpense>=0?'var(--green)':'var(--red)'}">Saldo: ${fmtCurrency(totalIncome-totalExpense)}</span>
      </div>
    </div>
    <div class="table-wrap" style="max-height:500px;overflow-y:auto">
      <table>
        <thead><tr>
          <th>No. Transaksi</th><th>Tanggal</th><th>Jenis KAS</th><th>Kategori</th><th>Keterangan</th>
          <th style="text-align:right">Pemasukan</th><th style="text-align:right">Pengeluaran</th><th>Status</th>
        </tr></thead>
        <tbody>
          ${transactions.map(tx => `
            <tr>
              <td class="mono">${tx.transaction_number}</td>
              <td>${fmtDate(tx.transaction_date)}</td>
              <td>${tx.kas_type==='kas_besar'?'<span class="badge badge-kas-besar">KAS BESAR</span>':'<span class="badge badge-kas-kecil">KAS KECIL</span>'}</td>
              <td>${tx.category_name||'—'}</td>
              <td>${tx.description}</td>
              <td class="amount-positive" style="text-align:right">${tx.transaction_type==='income'?fmtCurrency(tx.amount):'—'}</td>
              <td class="amount-negative" style="text-align:right">${tx.transaction_type==='expense'?fmtCurrency(tx.amount):'—'}</td>
              <td>${statusBadge(tx.status)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ═══════════════════════════════════════════════════
//  AUDIT LOG
// ═══════════════════════════════════════════════════
const auditIcons = {
  LOGIN_SUCCESS: { icon: '🔐', bg: 'var(--green-light)', color: 'var(--green)' },
  LOGIN_FAILED: { icon: '⚠️', bg: 'var(--amber-light)', color: 'var(--amber)' },
  LOGOUT: { icon: '🚪', bg: 'rgba(100,116,139,0.15)', color: '#64748B' },
  CREATE_TRANSACTION: { icon: '➕', bg: 'var(--accent-light)', color: 'var(--accent)' },
  UPDATE_TRANSACTION: { icon: '✏️', bg: 'var(--amber-light)', color: 'var(--amber)' },
  CANCEL_TRANSACTION: { icon: '🚫', bg: 'var(--red-light)', color: 'var(--red)' },
  TRANSACTION_APPROVED: { icon: '✅', bg: 'var(--green-light)', color: 'var(--green)' },
  TRANSACTION_REJECTED: { icon: '❌', bg: 'var(--red-light)', color: 'var(--red)' },
  CREATE_USER: { icon: '👤', bg: 'var(--accent-light)', color: 'var(--accent)' },
  UPDATE_USER: { icon: '📝', bg: 'var(--amber-light)', color: 'var(--amber)' },
  DELETE_USER: { icon: '🗑️', bg: 'var(--red-light)', color: 'var(--red)' },
  CHANGE_PASSWORD: { icon: '🔑', bg: 'var(--purple-light)', color: 'var(--purple)' },
};

let auditCurrentPage = 1;
async function loadAuditLogs(page = auditCurrentPage) {
  auditCurrentPage = page;
  const params = new URLSearchParams({
    page,
    limit: 30,
    action: document.getElementById('auditSearch')?.value || '',
    entityType: document.getElementById('auditEntityType')?.value || '',
    startDate: document.getElementById('auditStart')?.value || '',
    endDate: document.getElementById('auditEnd')?.value || '',
  });

  const data = await apiCall(`/reports/audit?${params}`);
  if (!data?.success) return;

  const { data: logs, pagination } = data;
  const content = document.getElementById('auditLogContent');

  if (!logs.length) {
    content.innerHTML = '<div class="empty-state" style="padding:50px"><h3>Tidak ada log</h3><p>Tidak ada aktivitas sesuai filter</p></div>';
    return;
  }

  content.innerHTML = logs.map(log => {
    const cfg = auditIcons[log.action] || { icon: '📋', bg: 'var(--bg-secondary)', color: 'var(--text-secondary)' };
    return `
      <div class="audit-item">
        <div class="audit-icon" style="background:${cfg.bg};color:${cfg.color}">${cfg.icon}</div>
        <div class="audit-content">
          <div class="audit-action">${log.description || log.action}</div>
          <div class="audit-meta">
            <span style="color:var(--accent)">${log.user_name || 'System'}</span> (${log.username || '—'}) ·
            <span class="badge badge-${log.user_role||'viewer'}" style="font-size:10px;padding:1px 7px">${roleName(log.user_role)}</span> ·
            ${fmtDateTime(log.created_at)} · IP: ${log.ip_address || '—'}
          </div>
          ${log.entity_type ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">Entitas: ${log.entity_type} ${log.entity_id ? '· '+log.entity_id.split('-')[0]+'...' : ''}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Pagination
  const paginEl = document.getElementById('auditPagination');
  const { total, totalPages } = pagination;
  paginEl.innerHTML = `
    <span class="page-info">${total} total aktivitas</span>
    ${page > 1 ? `<button class="page-btn" onclick="loadAuditLogs(${page-1})">‹</button>` : ''}
    ${Array.from({length:Math.min(totalPages,5)},(_,i)=>{
      const p = i+1;
      return `<button class="page-btn ${p===page?'active':''}" onclick="loadAuditLogs(${p})">${p}</button>`;
    }).join('')}
    ${page < totalPages ? `<button class="page-btn" onclick="loadAuditLogs(${page+1})">›</button>` : ''}
  `;
}

// ═══════════════════════════════════════════════════
//  USERS
// ═══════════════════════════════════════════════════
async function loadUsers() {
  const data = await apiCall('/users');
  if (!data?.success) return;
  const users = data.data;
  state.users = users;

  document.getElementById('usersTableContent').innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Nama Lengkap</th><th>Username</th><th>Email</th><th>Role</th><th>Status</th><th>Login Terakhir</th><th>Aksi</th>
        </tr></thead>
        <tbody>
          ${users.map(u => `
            <tr>
              <td>
                <div style="display:flex;align-items:center;gap:9px">
                  <div style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,var(--accent),var(--purple));display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0">${u.full_name.charAt(0)}</div>
                  ${u.full_name}
                </div>
              </td>
              <td class="mono">${u.username}</td>
              <td>${u.email}</td>
              <td><span class="badge badge-${u.role}">${roleName(u.role)}</span></td>
              <td><span class="badge ${u.is_active?'badge-approved':'badge-cancelled'}">${u.is_active?'Aktif':'Nonaktif'}</span></td>
              <td>${u.last_login ? fmtDateTime(u.last_login) : '<span style="color:var(--text-muted)">Belum pernah</span>'}</td>
              <td>
                <div style="display:flex;gap:5px;flex-wrap:wrap">
                  <button class="btn btn-secondary btn-xs" onclick="openEditUserModal('${u.id}')">Edit</button>
                  ${u.id !== state.user?.id ? `<button class="btn btn-xs" style="background:var(--red-light);color:var(--red)" onclick="toggleUser('${u.id}',${u.is_active})">${u.is_active?'Nonaktifkan':'Aktifkan'}</button>` : ''}
                  ${u.id !== state.user?.id ? `<button class="btn btn-xs" style="background:#3a1f2a;color:#ff7b9a" onclick="deleteUser('${u.id}')">Hapus</button>` : ''}
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function openUserModal() {
  document.getElementById('userId').value = '';
  document.getElementById('userModalTitle').textContent = 'Tambah User Baru';
  document.getElementById('uUsername').value = '';
  document.getElementById('uEmail').value = '';
  document.getElementById('uFullName').value = '';
  document.getElementById('uRole').value = 'viewer';
  document.getElementById('uPassword').value = '';
  document.getElementById('uUsername').disabled = false;
  document.getElementById('uPasswordGroup').style.display = 'block';
  document.getElementById('uPasswordLabel').innerHTML = 'Password <span style="color:var(--red)">*</span>';
  document.getElementById('uPasswordHint').textContent = 'Minimal 8 karakter';
  openModal('userModal');
}

function openEditUserModal(id) {
  const user = state.users.find(u => u.id === id);
  if (!user) { toast('Data user tidak ditemukan', 'error'); return; }

  document.getElementById('userId').value = id;
  document.getElementById('userModalTitle').textContent = 'Edit User';
  document.getElementById('uUsername').value = user.username || '';
  document.getElementById('uFullName').value = user.full_name || '';
  document.getElementById('uEmail').value = user.email || '';
  document.getElementById('uRole').value = user.role || 'viewer';
  document.getElementById('uPassword').value = '';
  document.getElementById('uUsername').disabled = true;
  document.getElementById('uPasswordGroup').style.display = 'block';
  document.getElementById('uPasswordLabel').innerHTML = 'Password Baru (Opsional)';
  document.getElementById('uPasswordHint').textContent = 'Kosongkan jika tidak ingin mengubah password';
  openModal('userModal');
}

async function submitUser() {
  const id = document.getElementById('userId').value;
  const payload = {
    fullName: document.getElementById('uFullName').value.trim(),
    email: document.getElementById('uEmail').value.trim(),
    role: document.getElementById('uRole').value,
  };

  const passwordInput = document.getElementById('uPassword').value;

  if (!id) {
    payload.username = document.getElementById('uUsername').value.trim();
    payload.password = passwordInput;
    if (!payload.username || !payload.password || !payload.fullName || !payload.email) {
      toast('Semua field harus diisi', 'error'); return;
    }
  } else if (passwordInput) {
    payload.password = passwordInput;
  }

  if (payload.password && payload.password.length < 8) {
    toast('Password minimal 8 karakter', 'error'); return;
  }

  const data = await apiCall(id ? `/users/${id}` : '/users', {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(payload)
  });

  if (data?.success) {
    toast(data.message, 'success');
    closeModal('userModal');
    loadUsers();
    if (!id) loadApprovers();
  } else {
    toast(data?.message || 'Gagal menyimpan', 'error');
  }
}

async function toggleUser(id, currentActive) {
  const action = currentActive ? 'nonaktifkan' : 'aktifkan';
  if (!await confirmDialog({ title: `Konfirmasi ${action}`, text: `${action} user ini?`, confirmText: `Ya, ${action}` })) return;
  const data = await apiCall(`/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ isActive: !currentActive })
  });
  if (data?.success) { toast(`User berhasil di${action}kan`, 'success'); loadUsers(); }
  else toast(data?.message || 'Gagal', 'error');
}

async function deleteUser(id) {
  const user = state.users.find(u => u.id === id);
  const fullName = user?.full_name || 'user ini';

  if (!await confirmDialog({ title: 'Hapus permanen user?', text: `Hapus permanen user "${fullName}"? Tindakan ini tidak dapat dibatalkan.`, confirmText: 'Ya, hapus', icon: 'warning' })) return;
  const data = await apiCall(`/users/${id}/permanent`, { method: 'DELETE' });
  if (data?.success) {
    toast(data.message || 'User berhasil dihapus', 'success');
    loadUsers();
    loadApprovers();
  } else {
    toast(data?.message || 'Gagal menghapus user', 'error');
  }
}

// ═══════════════════════════════════════════════════
//  CATEGORIES
// ═══════════════════════════════════════════════════
async function loadCategories() {
  const data = await apiCall('/reports/categories');
  if (!data?.success) return;
  const cats = data.data;
  state.categories = cats;

  ['kas_kecil','kas_besar'].forEach(type => {
    const el = document.getElementById(`cat${type==='kas_kecil'?'KasKecil':'KasBesar'}List`);
    const filtered = cats.filter(c => c.type === type);
    if (!filtered.length) {
      el.innerHTML = '<div class="empty-state" style="padding:30px"><p>Belum ada kategori</p></div>';
      return;
    }
    el.innerHTML = filtered.map(c => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
        <span style="width:12px;height:12px;border-radius:50%;background:${c.color};display:inline-block;flex-shrink:0"></span>
        <div style="flex:1">
          <div style="font-size:13.5px;font-weight:600">${c.name}</div>
          ${c.description ? `<div style="font-size:11.5px;color:var(--text-muted)">${c.description}</div>` : ''}
        </div>
        <span class="badge ${c.is_active?'badge-approved':'badge-cancelled'}" style="font-size:10px">${c.is_active?'Aktif':'Nonaktif'}</span>
      </div>
    `).join('');
  });
}

function openCategoryModal() { openModal('categoryModal'); }

async function submitCategory() {
  const payload = {
    name: document.getElementById('catName').value.trim(),
    type: document.getElementById('catType').value,
    color: document.getElementById('catColor').value,
    description: document.getElementById('catDesc').value.trim()
  };
  if (!payload.name) { toast('Nama kategori harus diisi', 'error'); return; }
  const data = await apiCall('/reports/categories', { method: 'POST', body: JSON.stringify(payload) });
  if (data?.success) {
    toast('Kategori berhasil ditambahkan', 'success');
    closeModal('categoryModal');
    loadCategories();
  } else toast(data?.message || 'Gagal', 'error');
}

// ═══════════════════════════════════════════════════
//  PROFILE
// ═══════════════════════════════════════════════════
function loadProfile() {
  const u = state.user;
  document.getElementById('profileInfo').innerHTML = `
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px">
      <div style="width:64px;height:64px;border-radius:16px;background:linear-gradient(135deg,var(--accent),var(--purple));display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700">${u.fullName.charAt(0)}</div>
      <div>
        <div style="font-size:17px;font-weight:700">${u.fullName}</div>
        <div><span class="badge badge-${u.role}">${roleName(u.role)}</span></div>
      </div>
    </div>
    <div class="info-grid">
      <div><div class="info-label">Username</div><div class="info-value mono">${u.username}</div></div>
      <div><div class="info-label">Email</div><div class="info-value">${u.email}</div></div>
      <div><div class="info-label">Role</div><div class="info-value">${roleName(u.role)}</div></div>
      <div><div class="info-label">Status</div><div class="info-value"><span class="badge badge-approved">Aktif</span></div></div>
    </div>
  `;
}

async function changePassword() {
  const old = document.getElementById('oldPassword').value;
  const nw = document.getElementById('newPassword').value;
  const confirm = document.getElementById('confirmPassword').value;
  if (!old || !nw || !confirm) { toast('Semua field harus diisi', 'error'); return; }
  if (nw !== confirm) { toast('Konfirmasi password tidak cocok', 'error'); return; }
  if (nw.length < 8) { toast('Password minimal 8 karakter', 'error'); return; }

  const data = await apiCall('/auth/change-password', {
    method: 'PUT',
    body: JSON.stringify({ currentPassword: old, newPassword: nw })
  });
  if (data?.success) {
    toast('Password berhasil diubah', 'success');
    document.getElementById('oldPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
  } else toast(data?.message || 'Gagal mengubah password', 'error');
}

// ═══════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════
function statusBadge(status) {
  const m = {
    pending: '<span class="badge badge-pending">⏳ Pending</span>',
    approved: '<span class="badge badge-approved">✅ Approved</span>',
    rejected: '<span class="badge badge-rejected">❌ Rejected</span>',
    cancelled: '<span class="badge badge-cancelled">🚫 Cancelled</span>'
  };
  return m[status] || `<span class="badge">${status}</span>`;
}

function openModal(id) {
  document.getElementById(id).classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  document.body.style.overflow = '';
}

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) {
      overlay.classList.remove('active');
      document.body.style.overflow = '';
    }
  });
});

// Escape key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach(el => {
      el.classList.remove('active');
      document.body.style.overflow = '';
    });
  }
});

// Enter key on login
document.getElementById('loginPassword').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});

// Export with auth token via fetch and download
// Override export functions to handle auth header
async function exportWithAuth(endpoint) {
  try {
    const r = await fetch(`${API}${endpoint}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!r.ok) { toast('Gagal export', 'error'); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const cd = r.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="([^"]+)"/);
    a.download = m ? m[1] : 'laporan.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  } catch(e) {
    toast('Gagal mengunduh file', 'error');
  }
}

// Override export functions
function exportExcel() {
  const params = getReportParams();
  exportWithAuth(`/export/excel?${params}`);
  toast('Mengunduh laporan Excel...', 'info');
}
function exportPDF() {
  const params = getReportParams();
  exportWithAuth(`/export/pdf?${params}`);
  toast('Mengunduh laporan PDF...', 'info');
}

// ═══════════════════════════════════════════════════
//  BOOTSTRAP
// ═══════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  if (loadAuth()) {
    initApp();
  }
  // Update clock
  if (state.clockInterval) clearInterval(state.clockInterval);
  state.clockInterval = setInterval(updateTopbarDate, 60000);
});
