export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    // 获取客户端真实 IP
    const ip = request.headers.get('CF-Connecting-IP') || 'Unknown';

    // 定义白名单路径
    const ALLOWED_PATHS = ['/v2', '/b64'];

    // 只有白名单内的路径才触发记账
    if (ALLOWED_PATHS.includes(path)) {
        try {
            // 1. 读取旧数据
            let data = await env.lze.get(ip, 'json');
            if (!data) {
                data = { total: 0, v2: 0, b64: 0 };
            }

            // 2. 累加数据
            data.total += 1;
            if (path === '/v2') data.v2 += 1;
            if (path === '/b64') data.b64 += 1;

            // 3. 【关键】使用 await 强制等待 KV 写入完成
            // 确保数据真正落库后，代码才会继续往下走
            await env.lze.put(ip, JSON.stringify(data));
            
        } catch (e) {
            // 即使 KV 写入失败，也绝对不能报错或返回内容
            // 必须让代码继续执行到底，去触发 307
            console.error('KV Write Error:', e);
        }
    }

    // 4. 【核心逻辑】代码执行到底，不返回任何内容 (等同于 return undefined)
    // Cloudflare 发现 [[path]].js 没有任何返回，就会自动去执行 _redirects 的 307 规则
}
