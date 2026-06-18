(function() {
  const logoSvg = `
    <svg viewBox="0 0 100 100" width="55" height="55">
      <circle cx="50" cy="50" r="48" fill="#ffffff22" />
      <circle cx="50" cy="50" r="44" fill="#ffffff11" />
      <line x1="50" y1="6" x2="50" y2="14" stroke="#ffc107" stroke-width="3" transform="rotate(0 50 50)" />
      <line x1="50" y1="6" x2="50" y2="14" stroke="#ffc107" stroke-width="3" transform="rotate(45 50 50)" />
      <line x1="50" y1="6" x2="50" y2="14" stroke="#ffc107" stroke-width="3" transform="rotate(90 50 50)" />
      <line x1="50" y1="6" x2="50" y2="14" stroke="#ffc107" stroke-width="3" transform="rotate(135 50 50)" />
      <line x1="50" y1="6" x2="50" y2="14" stroke="#ffc107" stroke-width="3" transform="rotate(180 50 50)" />
      <line x1="50" y1="6" x2="50" y2="14" stroke="#ffc107" stroke-width="3" transform="rotate(225 50 50)" />
      <line x1="50" y1="6" x2="50" y2="14" stroke="#ffc107" stroke-width="3" transform="rotate(270 50 50)" />
      <line x1="50" y1="6" x2="50" y2="14" stroke="#ffc107" stroke-width="3" transform="rotate(315 50 50)" />
      <circle cx="50" cy="50" r="38" fill="#ffffff" />
      <path d="M50 18 L72 28 L72 50 C72 65 62 75 50 82 C38 75 28 65 28 50 L28 28 Z" fill="#0d6efd" stroke="#0a58ca" stroke-width="1" />
      <polygon points="50,24 51.5,28 56,28 52.5,31 54,35 50,32 46,35 47.5,31 44,28 48.5,28" fill="#ffc107" />
      <polygon points="36,36 37.2,39 41,39 38,41.5 39,45 36,43 33,45 34,41.5 31,39 34.8,39" fill="#ffc107" />
      <polygon points="64,36 65.2,39 69,39 66,41.5 67,45 64,43 61,45 62,41.5 59,39 62.8,39" fill="#ffc107" />
      <path d="M50 48 L40 55 L40 68 L45 68 L45 60 L55 60 L55 68 L60 68 L60 55 Z" fill="#ffffff" />
      <rect x="47" y="62" width="6" height="6" fill="#0a58ca" />
    </svg>`;

  const links = [
    ['dashboard', '/borrower/dashboard', 'bi-speedometer2', 'Dashboard'],
    ['equipment', '/borrower/equipment', 'bi-box-seam', 'Equipment'],
    ['request', '/borrower/request', 'bi-calendar-plus', 'New Request'],
    ['requests', '/borrower/requests', 'bi-list-check', 'My Requests'],
    ['notifications', '/borrower/notifications', 'bi-bell', 'Notifications'],
    ['profile', '/borrower/profile', 'bi-person-circle', 'Profile'],
    ['verification', '/verification-status', 'bi-person-check', 'Verification']
  ];

  function logout() {
    localStorage.clear();
    window.location.href = '/pages/login.html';
  }

  function initBorrowerLayout() {
    const content = document.getElementById('borrowerPageContent');
    if (!content) return;

    const title = document.body.dataset.pageTitle || document.title || 'Borrower';
    const active = document.body.dataset.pageActive || 'dashboard';
    const fullName = localStorage.getItem('full_name') || 'Borrower';
    const role = localStorage.getItem('role') || 'borrower';
    const initial = fullName.charAt(0).toUpperCase();

    const nav = links.map(function(link) {
      const isActive = link[0] === active ? ' active' : '';
      const badge = link[0] === 'notifications'
        ? '<span class="borrower-nav-badge d-none" id="borrowerNotificationBadge">0</span>'
        : '';
      return '<a href="' + link[1] + '" class="nav-link' + isActive + '" data-nav-key="' + link[0] + '"><i class="bi ' + link[2] + '"></i> <span class="nav-label">' + link[3] + '</span>' + badge + '</a>';
    }).join('');

    document.body.insertAdjacentHTML('afterbegin',
      '<div class="sidebar-backdrop" id="sidebarBackdrop"></div>' +
      '<div class="sidebar">' +
        '<div class="sidebar-brand">' + logoSvg + '<h5 class="mb-0 mt-1" style="font-weight:700;">BarangayHiram</h5><small>Borrower Portal</small></div>' +
        '<nav class="sidebar-nav">' + nav + '</nav>' +
        '<div class="sidebar-footer"><a class="nav-link" id="borrowerLogout"><i class="bi bi-box-arrow-right"></i> Logout</a></div>' +
      '</div>' +
      '<div class="main-content">' +
        '<div class="topbar">' +
          '<button class="mobile-menu-toggle" id="borrowerMenuToggle" type="button"><i class="bi bi-list"></i></button>' +
          '<h4>' + title + '</h4>' +
          '<div class="topbar-right"><div class="user-info"><div class="name">' + fullName + '</div><div class="role">' + role + '</div></div><div class="avatar">' + initial + '</div></div>' +
        '</div>' +
        '<div class="page-content" id="borrowerContentSlot"></div>' +
      '</div>'
    );

    document.getElementById('borrowerContentSlot').appendChild(content);
    document.getElementById('borrowerLogout').addEventListener('click', logout);
    document.getElementById('borrowerMenuToggle').addEventListener('click', function() {
      document.body.classList.toggle('sidebar-open');
    });
    document.getElementById('sidebarBackdrop').addEventListener('click', function() {
      document.body.classList.remove('sidebar-open');
    });
    document.querySelectorAll('.sidebar .nav-link').forEach(function(link) {
      link.addEventListener('click', function() {
        document.body.classList.remove('sidebar-open');
      });
    });
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') {
        document.body.classList.remove('sidebar-open');
      }
    });
    window.addEventListener('resize', function() {
      if (window.innerWidth > 1024) {
        document.body.classList.remove('sidebar-open');
      }
    });
    updateNotificationBadge();
  }

  async function updateNotificationBadge() {
    const badge = document.getElementById('borrowerNotificationBadge');
    const token = localStorage.getItem('token');
    if (!badge || !token) return;

    try {
      const response = await fetch('/api/notifications', {
        headers: { authorization: token }
      });
      if (!response.ok) return;
      const notifications = await response.json().catch(function() { return []; });
      const unread = notifications.filter(function(item) {
        return Number(item.is_read || 0) !== 1;
      }).length;
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.classList.toggle('d-none', unread === 0);
    } catch (err) {
      badge.classList.add('d-none');
    }
  }

  window.refreshBorrowerNotificationBadge = updateNotificationBadge;

  document.addEventListener('DOMContentLoaded', initBorrowerLayout);
})();
