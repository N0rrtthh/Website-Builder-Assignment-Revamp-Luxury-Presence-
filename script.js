(function () {
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Theme: Light / Dark. The saved choice is applied in <head> before first
  // paint (with no saved choice, the device setting decides); here we wire up
  // the switch and animate changes.
  var root = document.documentElement;
  var darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  var themeOpts = document.querySelectorAll('[data-theme-opt]');
  var themeMeta = document.querySelector('meta[name="theme-color"]');
  var fadeTimer;
  function savedTheme() {
    try { return localStorage.getItem('theme'); } catch (e) { return null; }
  }
  function currentTheme() { return savedTheme() || (darkQuery.matches ? 'dark' : 'light'); }
  function applyTheme(theme) {
    var dark = theme === 'dark';
    root.classList.toggle('dark', dark);
    themeMeta.setAttribute('content', dark ? '#151412' : '#f6f2eb');
    themeOpts.forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-theme-opt') === theme));
    });
  }
  function crossfade(theme) {
    root.classList.add('theme-fade');
    applyTheme(theme);
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(function () { root.classList.remove('theme-fade'); }, 500);
  }
  // Signature reveal: the new theme spreads from the click point as a growing circle
  function circleReveal(theme, x, y) {
    var radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    var transition = document.startViewTransition(function () { applyTheme(theme); });
    transition.ready.then(function () {
      root.animate(
        { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + radius + 'px at ' + x + 'px ' + y + 'px)'] },
        { duration: 650, easing: 'cubic-bezier(.65, 0, .35, 1)', pseudoElement: '::view-transition-new(root)' }
      );
    }).catch(function () {});
  }
  function setTheme(theme, origin) {
    try { localStorage.setItem('theme', theme); } catch (e) {}
    // Already showing this theme: nothing to animate
    if ((theme === 'dark') === root.classList.contains('dark')) { applyTheme(theme); return; }
    if (reduceMotion || !document.startViewTransition) { crossfade(theme); return; }
    circleReveal(theme, origin.x, origin.y);
  }
  themeOpts.forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      // Keyboard "clicks" report 0,0, so fall back to the centre of the button
      var r = btn.getBoundingClientRect();
      var origin = e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      setTheme(btn.getAttribute('data-theme-opt'), origin);
    });
  });
  // Until the visitor picks a theme, keep following their device setting
  darkQuery.addEventListener('change', function () { if (!savedTheme()) crossfade(currentTheme()); });
  applyTheme(currentTheme());

  // Header: solid background once the hero is scrolled past
  var header = document.querySelector('.site-header');
  function updateHeader() {
    header.classList.toggle('is-solid', window.scrollY > 40);
  }
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });

  // Mobile menu
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('nav');
  function setMenu(open) {
    nav.classList.toggle('is-open', open);
    document.body.classList.toggle('menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }
  toggle.addEventListener('click', function () { setMenu(!nav.classList.contains('is-open')); });
  nav.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) { setMenu(false); toggle.focus(); }
  });
  window.matchMedia('(min-width: 1101px)').addEventListener('change', function (mq) { if (mq.matches) setMenu(false); });

  // Highlight the nav link for the section in view
  var links = nav.querySelectorAll('ul a');
  if ('IntersectionObserver' in window) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        links.forEach(function (a) {
          a.classList.toggle('is-active', a.getAttribute('href') === '#' + entry.target.id);
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    links.forEach(function (a) {
      var target = document.querySelector(a.getAttribute('href'));
      if (target) spy.observe(target);
    });
  }

  // Scroll reveal
  var revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduceMotion) {
    var revealer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -10% 0px' });
    revealEls.forEach(function (el) { revealer.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-visible'); });
  }

  // Gallery carousel: arrows move one photo and wrap around at either end
  var track = document.getElementById('gallery-track');
  var prev = document.getElementById('g-prev');
  var next = document.getElementById('g-next');
  var playToggle = document.getElementById('g-toggle');
  function step() {
    var item = track.querySelector('li');
    var gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    return item ? item.offsetWidth + gap : track.clientWidth;
  }
  function move(dir) {
    var max = track.scrollWidth - track.clientWidth;
    var left = track.scrollLeft + dir * step();
    if (dir > 0 && track.scrollLeft >= max - 4) left = 0;
    if (dir < 0 && track.scrollLeft <= 4) left = max;
    track.scrollTo({ left: left, behavior: reduceMotion ? 'auto' : 'smooth' });
  }
  prev.addEventListener('click', function () { move(-1); restartAutoplay(); });
  next.addEventListener('click', function () { move(1); restartAutoplay(); });

  // Autoplay: advances every 4s, pauses on hover, focus or touch, while off screen or
  // in a background tab, and never starts for visitors who prefer reduced motion.
  // The pause button keeps it stopped until the visitor presses play again.
  var timer = null;
  var userPaused = reduceMotion;
  var holds = { hover: false, focus: false, touch: false, offscreen: true, hidden: document.hidden };
  function canPlay() {
    if (userPaused) return false;
    for (var k in holds) if (holds[k]) return false;
    return true;
  }
  function restartAutoplay() {
    clearInterval(timer);
    timer = canPlay() ? setInterval(function () { move(1); }, 4000) : null;
  }
  function hold(name, value) { holds[name] = value; restartAutoplay(); }
  function setPaused(paused) {
    userPaused = paused;
    playToggle.classList.toggle('is-paused', paused);
    playToggle.setAttribute('aria-label', paused ? 'Play slideshow' : 'Pause slideshow');
    restartAutoplay();
  }
  playToggle.addEventListener('click', function () { setPaused(!userPaused); });
  track.addEventListener('mouseenter', function () { hold('hover', true); });
  track.addEventListener('mouseleave', function () { hold('hover', false); });
  track.addEventListener('focusin', function () { hold('focus', true); });
  track.addEventListener('focusout', function () { hold('focus', false); });
  track.addEventListener('touchstart', function () { hold('touch', true); }, { passive: true });
  track.addEventListener('touchend', function () { setTimeout(function () { hold('touch', false); }, 3000); }, { passive: true });
  document.addEventListener('visibilitychange', function () { hold('hidden', document.hidden); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      hold('offscreen', !entries[0].isIntersecting);
    }, { threshold: 0.3 }).observe(track);
  } else {
    hold('offscreen', false);
  }
  setPaused(userPaused);

  // Lightbox
  var box = document.getElementById('lightbox');
  var boxImg = document.getElementById('lightbox-img');
  var boxCaption = document.getElementById('lightbox-caption');
  var items = Array.prototype.slice.call(track.querySelectorAll('.g-item'));
  var current = 0;
  function show(i) {
    current = (i + items.length) % items.length;
    var thumb = items[current].querySelector('img');
    boxImg.src = items[current].getAttribute('data-full');
    boxImg.alt = thumb.alt;
    boxCaption.textContent = thumb.alt + ' (' + (current + 1) + ' of ' + items.length + ')';
  }
  if (typeof box.showModal === 'function') {
    items.forEach(function (btn, i) {
      btn.setAttribute('aria-label', 'Enlarge photo: ' + btn.querySelector('img').alt);
      btn.addEventListener('click', function () { show(i); box.showModal(); hold('lightbox', true); });
    });
    document.getElementById('lb-close').addEventListener('click', function () { box.close(); });
    document.getElementById('lb-prev').addEventListener('click', function () { show(current - 1); });
    document.getElementById('lb-next').addEventListener('click', function () { show(current + 1); });
    box.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') show(current - 1);
      if (e.key === 'ArrowRight') show(current + 1);
    });
    // Click on the backdrop closes
    box.addEventListener('click', function (e) { if (e.target === box) box.close(); });
    box.addEventListener('close', function () { items[current].focus({ preventScroll: true }); hold('lightbox', false); });
  } else {
    items.forEach(function (btn) { btn.style.cursor = 'default'; });
  }

  // Office hours badge: open daily 8am to 7pm, Pahrump time
  var badge = document.getElementById('open-badge');
  try {
    var hour = parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Los_Angeles' }).format(new Date()), 10);
    var open = hour >= 8 && hour < 19;
    badge.textContent = open ? 'Open now' : 'Closed now';
    badge.classList.toggle('is-open', open);
    badge.hidden = false;
  } catch (e) {}

  // Contact form (front-end validation only; connect a form service such as Formspree before launch)
  var form = document.getElementById('contact-form');
  var email = document.getElementById('c-email');
  var emailErr = document.getElementById('c-email-err');
  var status = document.getElementById('form-status');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var ok = email.value.trim() !== '' && email.checkValidity();
    emailErr.hidden = ok;
    email.setAttribute('aria-invalid', String(!ok));
    if (!ok) { status.textContent = ''; email.focus(); return; }
    status.textContent = 'Thank you! Marci will be in touch shortly.';
    form.reset();
  });
  email.addEventListener('input', function () {
    if (email.getAttribute('aria-invalid') === 'true' && email.checkValidity()) {
      emailErr.hidden = true;
      email.setAttribute('aria-invalid', 'false');
    }
  });

  // Mobile call bar: hidden while the hero or contact section (both have their own call button) is on screen
  var bar = document.getElementById('call-bar');
  if ('IntersectionObserver' in window) {
    var inView = {};
    var barWatcher = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { inView[entry.target.className] = entry.isIntersecting; });
      bar.classList.toggle('is-hidden', Object.keys(inView).some(function (k) { return inView[k]; }));
    }, { threshold: 0.1 });
    barWatcher.observe(document.querySelector('.hero'));
    barWatcher.observe(document.getElementById('contact'));
  }

  // Cookie notice
  var cookie = document.getElementById('cookie');
  var choice = null;
  try { choice = localStorage.getItem('cookie-choice'); } catch (e) {}
  if (!choice) cookie.hidden = false;
  function decide(value) {
    cookie.hidden = true;
    try { localStorage.setItem('cookie-choice', value); } catch (e) {}
  }
  document.getElementById('cookie-accept').addEventListener('click', function () { decide('accepted'); });
  document.getElementById('cookie-decline').addEventListener('click', function () { decide('declined'); });
})();
