// AgentLogistics 前端入口：注册路由、渲染 Layout、启动数据源

import { store } from './js/store.js';
import { register, start, setBefore } from './js/router.js';
import { renderNav, setActiveNav, renderHeader, initToast } from './js/components/layout.js';
import { $ } from './js/util.js';

import * as dashboard from './js/pages/dashboard.js';
import * as robots from './js/pages/robots.js';
import * as orders from './js/pages/orders.js';
import * as analytics from './js/pages/analytics.js';
import * as settings from './js/pages/settings.js';

register('/', dashboard);
register('/robots', robots);
register('/orders', orders);
register('/analytics', analytics);
register('/settings', settings);

renderNav($('#nav'));
renderHeader($('#headerStats'), $('#headerControls'));
initToast();

setBefore((path) => setActiveNav(path));

// Sidebar 底部连接信息
const foot = $('#sidebarFoot');
store.subscribe((tag) => {
  if (tag === 'world' || tag === 'state') {
    foot.textContent = store.mockMode
      ? '演示模式 · Mock 数据（后端未连接）'
      : store.connected
        ? `${store.backend === 'agent' ? 'Agent 大脑' : '仿真核心'} · 已连接`
        : '后端未连接';
  }
});

start();
store.boot();
