document.addEventListener('DOMContentLoaded', function() {
  const sidebar = document.querySelector('.sidebar');
  const topbar = document.querySelector('.topbar');

  if (!sidebar || !topbar) return;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'mobile-menu-toggle';
  toggle.setAttribute('aria-label', 'Open menu');
  toggle.innerHTML = '<i class="bi bi-list"></i>';

  const backdrop = document.createElement('div');
  backdrop.className = 'sidebar-backdrop';

  topbar.insertBefore(toggle, topbar.firstChild);
  document.body.appendChild(backdrop);

  function openSidebar() {
    document.body.classList.add('sidebar-open');
    toggle.setAttribute('aria-label', 'Close menu');
    toggle.innerHTML = '<i class="bi bi-x-lg"></i>';
  }

  function closeSidebar() {
    document.body.classList.remove('sidebar-open');
    toggle.setAttribute('aria-label', 'Open menu');
    toggle.innerHTML = '<i class="bi bi-list"></i>';
  }

  toggle.addEventListener('click', function() {
    if (document.body.classList.contains('sidebar-open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  });

  backdrop.addEventListener('click', closeSidebar);

  sidebar.querySelectorAll('a').forEach(function(link) {
    link.addEventListener('click', closeSidebar);
  });

  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') closeSidebar();
  });

  window.addEventListener('resize', function() {
    if (window.innerWidth > 1024) closeSidebar();
  });
});
