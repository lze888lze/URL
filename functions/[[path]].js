export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    // 获取客户端真实 IP
    const ip = request.headers.get('CF-Connecting-IP') || 'Unknown';

    // 定义白名单路径
    const ALLOWED_PATHS = ['/v2', '/b64'];

    if (ALLOWED_PATHS.includes(path)) {
        // 使用 context.waitUntil 让 KV 在后台异步写入
        // 这样绝对不会拖慢 _redirects 的转发速度
        context.waitUntil(
            (async () => {
                try {
                    // 读取旧数据
                    let data = await env.lze.get(ip, 'json');
                    if (!data) {
                        data = { total: 0, v2: 0, b64: 0 };
                    }

                    // 累加数据
                    data.total += 1;
                    if (path === '/v2') data.v2 += 1;
                    if (path === '/b64') data.b64 += 1;

                    // 写入 KV
                    await env.lze.put(ip, JSON.stringify(data));
                } catch (e) {
                    console.error('KV Write Error:', e);
                }
            })()
        );
    }

    // 【最关键的一步】：返回 undefined
    // 只要这里不 return 任何 Response 对象，Cloudflare 就会自动去执行 _redirects 里的 200 代理规则
}
