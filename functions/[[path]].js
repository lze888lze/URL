export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. 获取真实 IP (IPv6 也是真实 IP)
    const realIP = request.headers.get('cf-connecting-ip') || 'unknown_ip';

    // 2. 智能判断请求类型 (使用 includes 模糊匹配)
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

        // B. 定义全量初始结构 (如果该 IP 第一次来，或者旧数据格式不对，就用这个)
        let data = {
            req_count: 0,       // 总请求次数
            v2_count: 0,        // v2 接口请求次数
            base64_count: 0,    // base64 接口请求次数
            unknown_count: 0,   // 未知接口请求次数
            time: new Date().toISOString() // 最近一次请求时间
        };

        // C. 如果读到了旧数据，尝试解析并保留旧数据
        if (existingDataStr) {
            try {
                const oldData = JSON.parse(existingDataStr);
                // 合并旧数据，确保所有字段都存在 (防止旧数据缺字段)
                data = { ...data, ...oldData };
            } catch (e) {
                console.warn('JSON解析失败，重置计数');
            }
        }

        // D. 执行计数 +1 逻辑
        data.req_count += 1; // 总次数必加
        data.time = new Date().toISOString(); // 更新时间

        if (type === 'v2') {
            data.v2_count += 1;
        } else if (type === 'base64') {
            data.base64_count += 1;
        } else {
            data.unknown_count += 1;
        }

        // E. 写入 KV (覆盖旧值)
        await env.lze.put(realIP, JSON.stringify(data));

    } catch (e) {
        console.error('KV 操作失败:', e);
    }

    // --- 转发逻辑 (保持不变) ---
    const targetMap = {
        '/v2': 'https://lze888lze-hf-api.hf.space/captcha/v2',
        '/b64': 'https://lze888lze-hf-api.hf.space/captcha/v2/base64'
    };
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
