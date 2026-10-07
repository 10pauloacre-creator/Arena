// Tema claro/escuro: por padrão segue o tema do celular/computador (automático).
// A escolha manual (claro ou escuro) fica no perfil e é lembrada neste aparelho. Não há botão flutuante.
(function () {
  var KEY = 'am-theme', root = document.documentElement;
  var mq = matchMedia('(prefers-color-scheme: dark)');
  function read() { try { var v = localStorage.getItem(KEY); return v === 'dark' || v === 'light' ? v : 'auto'; } catch (e) { return 'auto'; } }
  function apply() {
    var mode = read(), dark = mode === 'auto' ? mq.matches : mode === 'dark';
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) { if (!m.dataset.light) m.dataset.light = m.content; m.content = dark ? '#0a0f1d' : m.dataset.light; }
  }
  window.AMTheme = {
    get: read,
    set: function (mode) {
      try { if (mode === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, mode); } catch (e) {}
      apply();
    },
  };
  apply();
  if (mq.addEventListener) mq.addEventListener('change', apply); else if (mq.addListener) mq.addListener(apply);
  document.addEventListener('DOMContentLoaded', apply);
})();
