import { store } from '../store.js';
import { escapeHtml } from '../util.js';
import { endpoints } from '../api.js';

let conversation = [];
const suggestions = ['你好', '当前仓库状态如何？', '哪些机器人故障了，原因和影响是什么？', '为什么机器人一直不动？', '如何修复故障机器人？', '解释最近一次调度决策', '当前运行有哪些改进建议？', '如何通知仓库负责人处理异常？'];

export function mount(container) {
  let disposed = false;
  let busy = false;
  const controller = new AbortController();
  container.innerHTML = `<div class="assistant-layout">
    <section class="card assistant-chat"><div class="card-head"><h3>仓库分析助手</h3><button class="btn sm" id="clearChat">清空对话</button></div>
    <div class="assistant-suggestions">${suggestions.map((s, i) => `<button class="btn sm" data-ask="${i}">${escapeHtml(s)}</button>`).join('')}</div>
    <div id="chatMessages" class="assistant-messages" role="log" aria-live="polite"></div>
    <form id="chatForm" class="assistant-form"><label for="chatInput">你的问题</label><textarea id="chatInput" rows="3" maxlength="2000" placeholder="问我运行状态、故障原因、订单影响，或直接说你好。Enter 发送，Shift+Enter 换行。" required></textarea>
    <div class="assistant-form-footer"><small>回答基于采样快照；提问不会修改仿真或发送外部通知。</small><button class="btn primary" id="sendChat" type="submit">发送</button></div></form></section>
    <aside><section class="card"><div class="card-head"><h3>待处理异常</h3></div><div class="card-body" id="assistantIncidents"></div></section>
    <section class="card" style="margin-top:16px"><div class="card-head"><h3>负责人通知</h3></div><div class="card-body"><p>当前为站内异常清单，尚未配置外部通知。</p><p>可接入企业微信、钉钉、飞书或邮件，按故障事件去重，负责人确认后跟踪修复。</p><p class="note">需要确定接收人、渠道和超时升级规则；助手不会声称消息已发送。</p></div></section></aside></div>`;
  const list = container.querySelector('#chatMessages');
  const form = container.querySelector('#chatForm');
  const input = container.querySelector('#chatInput');
  const draw = () => {
    list.innerHTML = conversation.length ? conversation.map(item => `<article class="assistant-message ${item.role}"><b>${item.role === 'user' ? '你' : '分析助手'}</b><div class="assistant-text">${escapeHtml(item.content)}</div>${item.meta ? `<small>${escapeHtml(item.meta)}</small>` : ''}${item.evidence?.length ? `<details><summary>最近事件依据</summary>${item.evidence.map(e => `<div class="note">#${e.sequence} · tick ${e.tick} · ${escapeHtml(e.kind)}${e.robot_id ? ` · R${e.robot_id}` : ''}${e.order_id ? ` · 订单 ${e.order_id}` : ''}</div>`).join('')}</details>` : ''}</article>`).join('') : '<p class="note">你好！可以自由提问，也可以点击上方快捷问题。每次提问都会读取当前仓库快照。</p>';
    if (busy) list.insertAdjacentHTML('beforeend', '<p class="note" role="status">正在读取状态并分析，请稍候…</p>');
    list.scrollTop = list.scrollHeight;
    container.querySelector('#sendChat').disabled = busy;
    container.querySelector('#clearChat').disabled = busy;
  };
  const drawIncidents = () => {
    const box = container.querySelector('#assistantIncidents');
    if (store.mockMode || !store.connected) { box.textContent = '后端未连接，无法确认真实异常。'; return; }
    const faults = Object.values(store.world?.robots || {}).filter(r => r.state === 'faulted');
    box.innerHTML = `<p class="note">实时状态 · tick ${store.world?.tick ?? 0} · ${faults.length} 台待修复</p>` + (faults.map(r => `<div class="assistant-incident"><b>R${r.id} 故障停机</b><p>位置 (${r.position.x}, ${r.position.y}) · 待人工修复</p><p class="note">故障注入；未记录机械根因。</p><button class="btn sm" data-repair="${r.id}">修复 R${r.id}</button><button class="btn sm" data-explain="${r.id}">询问影响</button></div>`).join('') || '<p>当前没有故障停机机器人。</p>');
  };
  async function ask(question) {
    if (busy || !question.trim()) return;
    if (store.mockMode || !store.connected || store.backend !== 'agent') { input.setCustomValidity('请连接 8788 Agent 服务后提问'); input.reportValidity(); return; }
    input.setCustomValidity('');
    const history = conversation.slice(-12).map(({ role, content }) => ({ role, content: content.slice(0, 4000) }));
    conversation.push({ role: 'user', content: question.trim() });
    input.value = ''; busy = true; draw();
    try {
      const response = await fetch(`${endpoints.agent}/api/agent/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: question.trim(), history }), signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '请求失败');
      if (disposed) return;
      conversation.push({ role: 'assistant', content: data.answer, evidence: data.evidence,
        meta: `${data.source === 'model' ? '模型分析' : '本地摘要'} · 快照 tick ${data.tick} · ${new Date(data.captured_at).toLocaleTimeString()}${data.warning ? ` · ${data.warning}` : ''}` });
    } catch (error) {
      if (!disposed) conversation.push({ role: 'assistant', content: `本次请求未完成：${error.message}。请重试；未修改仓库状态。` });
    } finally {
      busy = false;
      conversation = conversation.slice(-40);
      if (!disposed) { draw(); input.focus(); }
    }
  }
  form.addEventListener('submit', event => { event.preventDefault(); ask(input.value); });
  input.addEventListener('input', () => input.setCustomValidity(''));
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); } });
  container.querySelector('#clearChat').addEventListener('click', () => { conversation = []; draw(); });
  container.querySelectorAll('[data-ask]').forEach(button => button.addEventListener('click', () => ask(suggestions[Number(button.dataset.ask)])));
  container.querySelector('#assistantIncidents').addEventListener('click', async event => {
    const explain = event.target.closest('[data-explain]');
    if (explain) return ask(`请分析 R${explain.dataset.explain} 的故障时间、原因、订单影响和修复步骤。`);
    const repair = event.target.closest('[data-repair]');
    if (!repair) return;
    repair.disabled = true;
    try { await store.injectSceneEvent('robot_repair', { robotId: Number(repair.dataset.repair) }); }
    catch (error) { store.notify('error', error); }
    finally { if (!disposed) drawIncidents(); }
  });
  const unsubscribe = store.subscribe(tag => { if (tag === 'world' || tag === 'state') drawIncidents(); });
  draw(); drawIncidents();
  const alertQuestion = sessionStorage.getItem('al-assistant-question');
  if (alertQuestion) { sessionStorage.removeItem('al-assistant-question'); input.value = alertQuestion; input.focus(); }
  return () => { disposed = true; controller.abort(); unsubscribe(); };
}
