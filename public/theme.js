(() => {
  let current = 'light';
  try { if (localStorage.getItem('whatsnew-theme') === 'dark') current = 'dark'; } catch {}
  const apply = () => {
    document.documentElement.dataset.theme = current;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', current === 'dark' ? '#121a19' : '#f6f7f2');
  };
  apply();
  window.WhatsNewTheme = {
    get: () => current,
    toggle() {
      current = current === 'light' ? 'dark' : 'light';
      try { localStorage.setItem('whatsnew-theme', current); } catch {}
      apply(); window.dispatchEvent(new CustomEvent('whatsnew-themechange'));
    }
  };
})();
