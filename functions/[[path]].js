export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. 获取真实 IP (支持 IPv4 和 IPv6)
    const realIP = request.headers.get('cf-connecting-ip') || 'unknown_ip';

    // 2. 严格白名单校验
    let currentType = null; // 初始化为 null，代表不在白名单内
    if (path.includes('/v2')) {
        currentType = 'v2';
    } else if (path.includes('/b64')) {
        currentType = 'b64';
    }

    // 如果不在白名单内，直接返回 403 禁止访问，不执行后续任何逻辑
    if (!currentType) {
        return new Response(JSON.stringify({ 
            error: '403 Forbidden', 
            msg: '该路径不在白名单内，仅允许访问 /v2 和 /b64' 
        }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        // --- KV 读写逻辑开始 (只有白名单内的请求才会被记录) ---

        const existingDataStr = await env.lze.get(realIP);
        let data;

        if (existingDataStr) {
            try {
                data = JSON.parse(existingDataStr);
            } catch (e) {
                data = null;
            }
        }

        // 初始化全量结构
        if (!data) {
            data = {
                "次数": 0,
                "尾缀": {
                    "v2": 0,
                    "b64": 0,
                    "未知": 0
                },
                "time": ""
            };
        }

        // 确保“尾缀”对象里的键都存在
        if (!data["尾缀"]) data["尾缀"] = {};
        if (typeof data["尾缀"]["v2"] !== 'number') data["尾缀"]["v2"] = 0;
        if (typeof data["尾缀"]["b64"] !== 'number') data["尾缀"]["b64"] = 0;
        if (typeof data["尾缀"]["未知"] !== 'number') data["尾缀"]["未知"] = 0;

        // 执行计数 +1
        data["次数"] += 1;
        // 因为已经过了白名单校验，currentType 必然是 'v2' 或 'b64'
        data["尾缀"][currentType] += 1;
        data["time"] = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

        // 写入 KV
        await env.lze.put(realIP, JSON.stringify(data));

    } catch (e) {
        console.error('KV 记录失败:', e);
    }

    // --- 3. 转发请求给 Hugging Face (严格映射) ---
    const targetMap = {
        '/v2': 'https://lze888lze-hf-api.hf.space/captcha/v2',
        '/b64': 'https://lze888lze-hf-api.hf.space/captcha/v2/base64'
    };

    // 根据白名单类型精准匹配目标 URL
    const targetUrl = targetMap['/' + currentType];

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
