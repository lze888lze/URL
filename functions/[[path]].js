export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    // --- 1. 获取客户端 IP (Cloudflare 专属 Header) ---
    const ip = request.headers.get('CF-Connecting-IP') || 'Unknown';

    // --- 2. 检查白名单 (可选，根据你的需求) ---
    // 如果你想统计所有访问，可以注释掉下面的判断；
    // 如果只想统计 /v2 和 /b64，保留这个判断。
    const allowedPaths = ['/v2', '/b64'];
    if (!allowedPaths.includes(path)) {
        // 如果不是白名单路径，就不记录，也不拦截，直接放行去匹配 redirects
        return;
    }

    try {
        // --- 3. 读取旧数据 ---
        let data = await env.lze.get(ip, 'json');

        // 如果是新用户，初始化数据结构
        if (!data) {
            data = {
                total: 0,
                v2: 0,
                b64: 0,
                last_visit: ''
            };
        }

        // --- 4. 更新数据 ---
        data.total += 1;
        if (path === '/v2') data.v2 += 1;
        if (path === '/b64') data.b64 += 1;

        // 获取当前时间字符串 (UTC+8)
        const now = new Date();
        data.last_visit = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

        // --- 5. 写入 KV (异步写入，不阻塞流程) ---
        // 注意：这里我们不 await，或者 await 都可以。
        // 为了稳妥起见，建议 await 确保写入成功，但速度会微慢一点点。
        await env.lze.put(ip, JSON.stringify(data));

    } catch (e) {
        console.error('KV Write Error:', e);
        // 即使 KV 写入失败，也不要报错中断，继续让 redirects 生效
    }

    // --- 6. 关键一步：返回 undefined ---
    // 这里什么都不返回（return），Cloudflare Pages 就会认为 Functions 没处理完，
    // 接着去执行 _redirects 规则。
    return;
}
