export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;
    const ip = request.headers.get('CF-Connecting-IP') || 'Unknown';

    // 只有这两个路径才记录
    if (path === '/v2' || path === '/b64') {
        // 使用 waitUntil 让 KV 在后台慢慢写，主线程立刻放行去执行 307
        context.waitUntil(
            (async () => {
                try {
                    let data = await env.lze.get(ip, 'json');
                    if (!data) data = { total: 0, v2: 0, b64: 0 };
                    data.total++;
                    if (path === '/v2') data.v2++;
                    if (path === '/b64') data.b64++;
                    await env.lze.put(ip, JSON.stringify(data));
                } catch (e) { console.error(e); }
            })()
        );
    }
    // 不返回任何内容，让 Cloudflare 自动去执行 _redirects 的 307
}
