// Tema claro/escuro: segue o sistema na 1ª visita e lembra a escolha do usuário.
(function () {
  var KEY = 'am-theme', root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  var dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  function apply(d) {
    root.setAttribute('data-theme', d ? 'dark' : 'light');
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) { if (!m.dataset.light) m.dataset.light = m.content; m.content = d ? '#0a0f1d' : m.dataset.light; }
    var b = document.getElementById('theme-toggle');
    if (b) { b.setAttribute('aria-pressed', d ? 'true' : 'false'); b.textContent = d ? '☀️' : '🌙'; b.title = d ? 'Modo claro' : 'Modo escuro'; b.setAttribute('aria-label', b.title); }
  }
  apply(dark);
  document.addEventListener('DOMContentLoaded', function () {
    var b = document.createElement('button');
    b.id = 'theme-toggle'; b.type = 'button';
    b.addEventListener('click', function () {
      dark = !dark;
      try { localStorage.setItem(KEY, dark ? 'dark' : 'light'); } catch (e) {}
      apply(dark);
    });
    document.body.appendChild(b);
    apply(dark);
  });
})();
