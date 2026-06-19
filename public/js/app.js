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

(function() {
  window.confirmBarangayHiramAction = function(options) {
    const config = Object.assign({
      title: 'Confirm action',
      message: 'Are you sure you want to continue?',
      confirmText: 'Confirm',
      confirmClass: 'btn-primary'
    }, options || {});

    return new Promise(function(resolve) {
      if (!window.bootstrap) {
        resolve(window.confirm(config.message));
        return;
      }

      let modal = document.getElementById('bhConfirmModal');
      if (!modal) {
        modal = document.createElement('div');
        modal.className = 'modal fade';
        modal.id = 'bhConfirmModal';
        modal.tabIndex = -1;
        modal.innerHTML =
          '<div class="modal-dialog modal-dialog-centered">' +
            '<div class="modal-content">' +
              '<div class="modal-header">' +
                '<h5 class="modal-title" id="bhConfirmTitle">Confirm action</h5>' +
                '<button type="button" class="btn-close" data-bs-dismiss="modal"></button>' +
              '</div>' +
              '<div class="modal-body"><p class="mb-0" id="bhConfirmMessage"></p></div>' +
              '<div class="modal-footer">' +
                '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>' +
                '<button type="button" class="btn" id="bhConfirmButton">Confirm</button>' +
              '</div>' +
            '</div>' +
          '</div>';
        document.body.appendChild(modal);
      }

      const confirmButton = document.getElementById('bhConfirmButton');
      document.getElementById('bhConfirmTitle').textContent = config.title;
      document.getElementById('bhConfirmMessage').textContent = config.message;
      confirmButton.textContent = config.confirmText;
      confirmButton.className = 'btn ' + config.confirmClass;

      const modalInstance = bootstrap.Modal.getOrCreateInstance(modal);
      let confirmed = false;

      function cleanup() {
        confirmButton.removeEventListener('click', onConfirm);
        modal.removeEventListener('hidden.bs.modal', onHidden);
      }

      function onConfirm() {
        confirmed = true;
        modalInstance.hide();
      }

      function onHidden() {
        cleanup();
        resolve(confirmed);
      }

      confirmButton.addEventListener('click', onConfirm, { once: true });
      modal.addEventListener('hidden.bs.modal', onHidden, { once: true });
      modalInstance.show();
    });
  };
})();
