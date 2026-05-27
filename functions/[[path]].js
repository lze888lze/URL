export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. 获取用户真实 IP (Cloudflare 标准头)
    const realIP = request.headers.get('cf-connecting-ip') || 'unknown_ip';

    // 2. 确定当前请求的尾缀类型
    let type = 'unknown';
    if (path.includes('/v2')) {
        type = 'v2';
    } else if (path.includes('/b64')) {
        type = 'base64';
    }

    try {
        // --- KV 读写逻辑开始 ---

        // A. 尝试读取该 IP 现有的记录
        const existingDataStr = await env.lze.get(realIP);
        let ipData = {};

        // B. 如果读到了旧数据，就解析它；如果是第一次来，就用空对象
        if (existingDataStr) {
            try {
                ipData = JSON.parse(existingDataStr);
            } catch (e) {
                console.warn('JSON 解析失败，重置数据');
                ipData = {};
            }
        }

        // C. 初始化或更新计数 (使用你要求的简洁英文键名)
        // req_count: 总请求次数
        ipData.req_count = (ipData.req_count || 0) + 1;

        // v2_count: /v2 尾缀次数
        if (type === 'v2') {
            ipData.v2_count = (ipData.v2_count || 0) + 1;
        }

        // b64_count: /b64 尾缀次数
        if (type === 'base64') {
            ipData.b64_count = (ipData.b64_count || 0) + 1;
        }

        // unk_count: 未知尾缀次数
        if (type === 'unknown') {
            ipData.unk_count = (ipData.unk_count || 0) + 1;
        }

        // D. 更新最近一次请求时间
        ipData.time = new Date().toISOString();

        // E. 将新数据写回 KV (Key 是 IP, Value 是 JSON 字符串)
        await env.lze.put(realIP, JSON.stringify(ipData));

        // 可以在控制台看一眼，方便调试
        console.log(`IP ${realIP} updated:`, ipData);

        // --- KV 读写逻辑结束 ---

    } catch (e) {
        console.error('KV 操作出错:', e);
        // 即使 KV 挂了，也不影响下面的转发，保证服务可用
    }

    // 3. 转发请求给 Hugging Face (保持原有逻辑不变)
    const targetMap = {
        '/v2': 'https://lze888lze-hf-api.hf.space/captcha/v2',
        '/b64': 'https://lze888lze-hf-api.hf.space/captcha/v2/base64'
    };

    // 如果路径不完全匹配，默认走 /v2 (或者你可以改为返回 404)
    const targetUrl = targetMap[path] || targetMap['/v2'];

    try {
        const response = await fetch(targetUrl, {
            method: request.method,
            headers: request.headers,
            body: request.body
        });
        return response;
    } catch (e) {
        return new Response(JSON.stringify({ error: 'Fetch Failed', msg: e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
