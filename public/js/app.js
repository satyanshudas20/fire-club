(function () {
  var root = document.documentElement;
  try {
    var savedTheme = localStorage.getItem('theme');
    if (savedTheme) root.setAttribute('data-theme', savedTheme);
  } catch (e) {}

  document.addEventListener('DOMContentLoaded', function () {
    // Theme controls can appear in the public header and the signed-in header.
    document.querySelectorAll('#theme-toggle').forEach(function (button) {
      button.addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-theme', next);
        try { localStorage.setItem('theme', next); } catch (e) {}
      });
    });

    var menuButton = document.getElementById('menu-btn');
    var sidebar = document.getElementById('main-sidebar');

    function closeSidebar() {
      if (!menuButton || !sidebar) return;
      sidebar.classList.remove('open');
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.setAttribute('aria-label', 'Open menu');
      document.body.classList.remove('sidebar-menu-open');
    }

    if (menuButton && sidebar) {
      menuButton.addEventListener('click', function (event) {
        event.stopPropagation();
        var isOpen = sidebar.classList.toggle('open');
        menuButton.setAttribute('aria-expanded', String(isOpen));
        menuButton.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
        document.body.classList.toggle('sidebar-menu-open', isOpen);
      });

      sidebar.querySelectorAll('a').forEach(function (link) {
        link.addEventListener('click', closeSidebar);
      });

      document.addEventListener('click', function (event) {
        if (sidebar.classList.contains('open') &&
            !sidebar.contains(event.target) && !menuButton.contains(event.target)) {
          closeSidebar();
        }
      });
    }

    // Public-site hamburger menu.
    var publicButton = document.getElementById('pub-menu-btn');
    var publicNav = document.getElementById('pub-navigation');
    function closePublicMenu() {
      if (!publicButton || !publicNav) return;
      publicNav.classList.remove('is-open');
      publicButton.setAttribute('aria-expanded', 'false');
      publicButton.setAttribute('aria-label', 'Open navigation menu');
    }
    if (publicButton && publicNav) {
      publicButton.addEventListener('click', function (event) {
        event.stopPropagation();
        var isOpen = publicNav.classList.toggle('is-open');
        publicButton.setAttribute('aria-expanded', String(isOpen));
        publicButton.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
      });
      publicNav.querySelectorAll('a').forEach(function (link) {
        link.addEventListener('click', closePublicMenu);
      });
      document.addEventListener('click', function (event) {
        if (publicNav.classList.contains('is-open') &&
            !publicNav.contains(event.target) && !publicButton.contains(event.target)) {
          closePublicMenu();
        }
      });
    }

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        closeSidebar();
        closePublicMenu();
      }
    });

    // Restore a predictable desktop layout when leaving mobile breakpoints.
    window.addEventListener('resize', function () {
      if (window.innerWidth > 860) closeSidebar();
      if (window.innerWidth > 700) closePublicMenu();
    });

    document.querySelectorAll('[data-confirm]').forEach(function (element) {
      element.addEventListener('click', function (event) {
        if (!confirm(element.getAttribute('data-confirm'))) event.preventDefault();
      });
    });
    document.querySelectorAll('[data-dismiss]').forEach(function (element) {
      element.addEventListener('click', function () {
        if (element.parentElement) element.parentElement.remove();
      });
    });
    var flash = document.querySelector('.flash');
    if (flash) setTimeout(function () {
      flash.style.opacity = '0';
      flash.style.transition = 'opacity .5s';
      setTimeout(function () { if (flash.parentElement) flash.remove(); }, 600);
    }, 6000);
  });
})();
