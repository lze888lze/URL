export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. 获取真实 IP (支持 IPv4 和 IPv6)
    const realIP = request.headers.get('cf-connecting-ip') || 'unknown_ip';

    // 2. 严格白名单校验
    // 六个允许的路径：/slide、/slide-b64、/hole、/hole-b64、/puzzle、/puzzle-b64
    let currentType = null; // null 代表不在白名单内

    if (path.includes('/slide') && path.includes('-b64')) {
        currentType = 'slide-b64';
    } else if (path.includes('/slide')) {
        currentType = 'slide';
    } else if (path.includes('/hole') && path.includes('-b64')) {
        currentType = 'hole-b64';
    } else if (path.includes('/hole')) {
        currentType = 'hole';
    } else if (path.includes('/puzzle') && path.includes('-b64')) {
        currentType = 'puzzle-b64';
    } else if (path.includes('/puzzle')) {
        currentType = 'puzzle';
    }

    // 如果不在白名单内，直接返回 403 禁止访问
    if (!currentType) {
        return new Response(JSON.stringify({
            error: '403 Forbidden',
            msg: '该路径不在白名单内，仅允许访问 /slide、/slide-b64、/hole、/hole-b64、/puzzle、/puzzle-b64'
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
                    "slide": 0,
                    "slide-b64": 0,
                    "hole": 0,
                    "hole-b64": 0,
                    "puzzle": 0,
                    "puzzle-b64": 0,
                    "未知": 0
                },
                "time": ""
            };
        }

        // 确保"尾缀"对象里的键都存在 (防止旧数据缺字段)
        if (!data["尾缀"]) data["尾缀"] = {};
        const allTypes = ["slide", "slide-b64", "hole", "hole-b64", "puzzle", "puzzle-b64", "未知"];
        for (const t of allTypes) {
            if (typeof data["尾缀"][t] !== 'number') data["尾缀"][t] = 0;
        }

        // 执行计数 +1
        data["次数"] += 1;

        // 因为已经过了白名单校验，currentType 必然是六个合法值之一
        data["尾缀"][currentType] += 1;

        data["time"] = new Date().toISOString();

        // 写入 KV
        await env.lze.put(realIP, JSON.stringify(data));

    } catch (e) {
        console.error('KV 记录失败:', e);
    }

    // --- 3. 转发请求给 Hugging Face (严格映射) ---
    // 用户访问的短路径 → HF Spaces 的完整接口地址
    // 注意：用户侧用 /slide-b64，HF 侧接口是 /slide-base64
    const targetMap = {
        'slide':      'https://lze888lze-hf-api.hf.space/slide',
        'slide-b64':  'https://lze888lze-hf-api.hf.space/slide-base64',
        'hole':       'https://lze888lze-hf-api.hf.space/hole',
        'hole-b64':   'https://lze888lze-hf-api.hf.space/hole-base64',
        'puzzle':     'https://lze888lze-hf-api.hf.space/puzzle',
        'puzzle-b64': 'https://lze888lze-hf-api.hf.space/puzzle-base64'
    };

    // 根据白名单类型精准匹配目标 URL
    const targetUrl = targetMap[currentType];

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
