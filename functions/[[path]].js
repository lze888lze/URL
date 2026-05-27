export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    // --- 1. 获取客户端 IP ---
    const ip = request.headers.get('CF-Connecting-IP') || 'Unknown';

    // --- 2. 定义白名单路径 (只有这些路径才记账) ---
    const ALLOWED_PATHS = ['/v2', '/b64'];

    // --- 3. 核心逻辑：仅当路径在白名单内时，才写入 KV ---
    if (ALLOWED_PATHS.includes(path)) {
        try {
            // A. 读取旧数据
            let data = await env.lze.get(ip, 'json');
            if (!data) {
                data = { total: 0, v2: 0, b64: 0 };
            }

            // B. 数据累加
            data.total += 1;
            if (path === '/v2') data.v2 += 1;
            if (path === '/b64') data.b64 += 1;

            // C. 写入 KV (设置过期时间可选，这里设为永久或长周期)
            // 注意：KV 写入是异步的，但在这里我们 await 它以确保准确
            await env.lze.put(ip, JSON.stringify(data));

        } catch (err) {
            // 即使 KV 写入失败（比如 KV 没绑定好），也不要报错阻断请求
            // 让请求继续流向 _redirects
            console.error("KV Write Error:", err);
        }
    }

    // --- 4. 关键一步：返回 undefined ---
    // 不 return 任何内容，Cloudflare 就会自动去执行 _redirects 里的规则
    // 这样就实现了“一边跳转，一边记录”
}
