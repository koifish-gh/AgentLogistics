// 页面：数据分析 —— 趋势、指标、策略对比、仓库热力图

import { store } from '../store.js';
import { $, formatNum, percent } from '../util.js';
import { lineChart, barChart, heatmap } from '../charts.js';
import { mockStrategyComparison } from '../mock.js';

export function mount(container) {
  container.innerHTML = `
    <div class="analytics-grid" style="margin-bottom:12px">
      ${chartCard('吞吐量趋势', 'anaThroughput', '/100 tick')}
      ${chartCard('平均完成时间', 'anaAvg', 'tick')}
      ${chartCard('机器人利用率', 'anaUtil', '%')}
      ${chartCard('拥堵 / 故障次数', 'anaFault', '次')}
    </div>
    <div class="analytics-grid" style="margin-bottom:12px">
      <div class="card"><div class="card-head"><h3>策略对比</h3><span class="sub">仅展示数据</span></div>
        <div class="card-body" id="strategyBox"></div></div>
      <div class="card"><div class="card-head"><h3>仓库热力图</h3><span class="sub">占用频率</span></div>
        <div class="card-body"><div class="chart-box" style="height:260px"><canvas id="anaHeat"></canvas></div></div></div>
    </div>
    <div class="analytics-grid">
      ${metricCard('订单完成率', 'completeRate')}
      ${metricCard('平均每单距离', 'avgDistance', 'steps')}
      ${metricCard('累计等待', 'totalWait', 'tick')}
      ${metricCard('累计距离', 'totalDistance', 'steps')}
    </div>`;

  const draw = () => {
    const s = store.metricsSeries;
    lineChart($('#anaThroughput'), [{ data: s.throughput }]);
    lineChart($('#anaAvg'), [{ data: s.avgTime }]);
    lineChart($('#anaUtil'), [{ data: s.utilization }]);
    lineChart($('#anaFault'), [
      { data: s.congestion, color: '#ff9a3c', name: '拥堵' },
      { data: s.fault, color: '#ff6b7a', name: '故障' },
    ]);
    heatmap($('#anaHeat'), store.world?.heatmap || []);
    drawStrategy();
    drawMetrics();
  };

  const drawStrategy = () => {
    const cmp = mockStrategyComparison();
    const el = $('#strategyBox');
    el.innerHTML = `
      <div class="chart-box" style="height:140px"><canvas id="anaBar"></canvas></div>
      <table class="tbl" style="margin-top:10px">
        <thead><tr><th>指标</th><th>Balanced</th><th>Distance</th></tr></thead>
        <tbody>
          <tr><td>吞吐量 /100tick</td><td>${cmp[0].throughput}</td><td>${cmp[1].throughput}</td></tr>
          <tr><td>平均完成时间</td><td>${cmp[0].avgTime} tick</td><td>${cmp[1].avgTime} tick</td></tr>
          <tr><td>利用率</td><td>${percent(cmp[0].utilization)}</td><td>${percent(cmp[1].utilization)}</td></tr>
          <tr><td>拥堵次数</td><td>${cmp[0].congestion}</td><td>${cmp[1].congestion}</td></tr>
        </tbody>
      </table>`;
    requestAnimationFrame(() => {
      barChart($('#anaBar'), ['吞吐量', '拥堵次数'], [
        { name: 'Balanced', data: [cmp[0].throughput, cmp[0].congestion], color: '#2cc6b0' },
        { name: 'Distance', data: [cmp[1].throughput, cmp[1].congestion], color: '#5b9bff' },
      ]);
    });
  };

  const drawMetrics = () => {
    const k = store.kpis || {};
    const completed = k.completed_orders || 0;
    const total = k.total_orders || 0;
    const dist = k.total_distance || 0;
    const rate = total ? (completed / total) * 100 : 0;
    const avgDist = completed ? dist / completed : 0;
    setMetric('completeRate', `${formatNum(rate, 1)}%`);
    setMetric('avgDistance', formatNum(avgDist, 1));
    setMetric('totalWait', k.total_wait_ticks ?? 0);
    setMetric('totalDistance', dist);
  };

  const unsub = store.subscribe((tag) => { if (tag === 'world' || tag === 'state') draw(); });
  draw();
  return unsub;
}

function chartCard(title, id, unit) {
  return `<div class="card"><div class="card-head"><h3>${title}</h3><span class="sub">${unit}</span></div>
    <div class="card-body"><div class="chart-box"><canvas id="${id}"></canvas></div></div></div>`;
}

function metricCard(title, id, unit = '') {
  return `<div class="card"><div class="card-head"><h3>${title}</h3></div>
    <div class="card-body"><div class="k-value" style="font-size:24px"><span id="${id}">—</span>${unit ? `<span class="k-unit">${unit}</span>` : ''}</div></div></div>`;
}

function setMetric(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
