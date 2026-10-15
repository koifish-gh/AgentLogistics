export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (!env.BACKEND_URL) return offline('本地后端尚未配置');
    let origin;
    try { origin = new URL(env.BACKEND_URL); if (origin.protocol !== 'https:') throw new Error(); }
    catch { return offline('后端连接配置无效'); }
    const target = new URL(incoming.pathname + incoming.search, origin.origin);
    const headers = new Headers(request.headers);
    for (const key of [...headers.keys()]) {
      if (key === 'cookie' || key === 'authorization' || key.startsWith('oai-') || key.startsWith('cf-')) headers.delete(key);
    }
    headers.delete('host'); headers.delete('origin'); headers.delete('referer');
    headers.set('bypass-tunnel-reminder', 'true');
    try {
      const response = await fetch(target, { method: request.method, headers,
        body: ['GET','HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'manual', signal: AbortSignal.timeout(45000) });
      const outgoing = new Headers(response.headers);
      outgoing.delete('set-cookie'); outgoing.set('Cache-Control','no-store');
      if (response.status >= 500 && !incoming.pathname.startsWith('/api/')) return offline('本地服务暂时未连接，请联系演示者启动电脑上的服务和隧道');
      return new Response(response.body, { status: response.status, headers: outgoing });
    } catch {
      if (incoming.pathname.startsWith('/api/')) return Response.json({ error: '本地后端连接中断，请联系演示者检查服务和公网隧道' }, { status:503 });
      return offline('本地后端连接中断，请联系演示者检查服务和公网隧道');
    }
  }
};
function offline(message) {
  return new Response(`<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>AgentLogistics · 连接状态</title><style>body{font:16px system-ui;background:#f4f7fb;color:#17304b;display:grid;place-items:center;min-height:95vh}main{max-width:560px;padding:36px;background:white;border:1px solid #dfe7ef;border-radius:18px}h1{color:#0d9488}p{line-height:1.8}button{padding:10px 20px;background:#0d9488;color:white;border:0;border-radius:8px}</style><main><h1>AgentLogistics</h1><h2>仓库连接暂不可用</h2><p>${message}</p><p>该网址连接演示者电脑上的真实仓库世界；电脑、本地服务和隧道需要持续运行。</p><button onclick="location.reload()">重新连接</button></main></html>`, { status:503, headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'} });
}
