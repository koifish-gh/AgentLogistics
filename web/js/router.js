// 轻量 hash 路由：每个页面模块导出 mount(container) => cleanup

const routes = {};
let activeRoute = null;
let cleanup = null;
let onBefore = null;

export function register(path, page) {
  routes[path] = page;
}

export function setBefore(fn) {
  onBefore = fn;
}

export function currentPath() {
  const hash = location.hash.replace(/^#/, '') || '/';
  return hash.startsWith('/') ? hash : `/${hash}`;
}

export function navigate(path) {
  if (currentPath() === path) return;
  location.hash = path;
}

function resolve(path) {
  return routes[path] || routes['/'];
}

export function start() {
  const apply = () => {
    const path = currentPath();
    const page = resolve(path);
    const container = document.getElementById('page');
    if (!container) return;
    if (typeof cleanup === 'function') {
      try { cleanup(); } catch (e) { console.error(e); }
      cleanup = null;
    }
    container.innerHTML = '';
    if (onBefore) onBefore(path, page);
    activeRoute = path;
    if (page && typeof page.mount === 'function') {
      cleanup = page.mount(container) || null;
    }
  };
  window.addEventListener('hashchange', apply);
  apply();
}
