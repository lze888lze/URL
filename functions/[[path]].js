export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. 获取真实 IP (支持 IPv4 和 IPv6)
    const realIP = request.headers.get('cf-connecting-ip') || 'unknown_ip';

    // 2. 判断当前请求属于哪一类
    let currentType = '未知';
    if (path.includes('/v2')) {
        currentType = 'v2';
    } else if (path.includes('/b64')) {
        currentType = 'b64';
    }

    try {
        // --- KV 读写逻辑开始 ---

        // A. 尝试读取该 IP 现有的记录
        const existingDataStr = await env.lze.get(realIP);
        let data;

        if (existingDataStr) {
            try {
                data = JSON.parse(existingDataStr);
            } catch (e) {
                // 如果旧数据损坏，重置为初始结构
                data = null;
            }
        }

        // B. 如果没数据或数据损坏，初始化为全量结构
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

        // C. 确保“尾缀”对象里的三个键都存在 (防止旧数据缺字段)
        if (!data["尾缀"]) data["尾缀"] = {};
        if (typeof data["尾缀"]["v2"] !== 'number') data["尾缀"]["v2"] = 0;
        if (typeof data["尾缀"]["b64"] !== 'number') data["尾缀"]["b64"] = 0;
        if (typeof data["尾缀"]["未知"] !== 'number') data["尾缀"]["未知"] = 0;

        // D. 执行计数 +1
        data["次数"] += 1;

        // E. 根据当前类型，给对应的分类 +1
        if (data["尾缀"].hasOwnProperty(currentType)) {
            data["尾缀"][currentType] += 1;
        } else {
            // 如果出现了新分类，也给它加上并计数
            data["尾缀"][currentType] = 1;
        }

        // F. 更新时间
        data["time"] = new Date().toISOString();

        // G. 写入 KV (使用 IP 作为 Key)
        await env.lze.put(realIP, JSON.stringify(data));

    } catch (e) {
        console.error('KV 记录失败:', e);
        // 即使记录失败，也不影响后续转发，保证业务可用性
    }

    // --- 3. 转发请求给 Hugging Face ---
    const targetMap = {
        '/v2': 'https://lze888lze-hf-api.hf.space/captcha/v2',
        '/b64': 'https://lze888lze-hf-api.hf.space/captcha/v2/base64'
    };

    // 简单的路径匹配逻辑，如果都不匹配则默认走 /v2
    let targetUrl = targetMap['/v2'];
    if (path.includes('/b64')) targetUrl = targetMap['/b64'];

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
