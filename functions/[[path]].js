export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. 获取真实 IP (支持 IPv4 和 IPv6)
    const realIP = request.headers.get('cf-connecting-ip') || 'unknown_ip';

    // 2. 获取归属地
    const cf = request.cf || {};
    const location = `${cf.country || '未知'} · ${cf.city || '未知城市'}`;

    // 3. 严格的 6 接口白名单校验
    let currentType = null;
    
    if (path.includes('/slide')) currentType = 'slide';
    else if (path.includes('/hole')) currentType = 'hole';
    else if (path.includes('/puzzle')) currentType = 'puzzle';
    else if (path.includes('/slide-base64')) currentType = 'slide-base64';
    else if (path.includes('/hole-base64')) currentType = 'hole-base64';
    else if (path.includes('/puzzle-base64')) currentType = 'puzzle-base64';

    // 如果不在白名单内，直接返回 403
    if (!currentType) {
        return new Response(JSON.stringify({ 
            error: '403 Forbidden', 
            msg: '该路径不在白名单内！' 
        }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        // --- KV 读写逻辑 ---

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
                "location": location,
                "次数": 0,
                "尾缀": {
                    "slide": 0,
                    "hole": 0,
                    "puzzle": 0,
                    "slide-base64": 0,
                    "hole-base64": 0,
                    "puzzle-base64": 0,
                    "未知": 0
                },
                "time": ""
            };
        }

        // 确保归属地字段存在（兼容旧数据）
        if (!data["location"]) data["location"] = location;
        // 确保“尾缀”对象里的所有接口键都存在
        if (!data["尾缀"]) data["尾缀"] = {};
        const allTypes = ["slide", "hole", "puzzle", "slide-base64", "hole-base64", "puzzle-base64", "未知"];
        allTypes.forEach(type => {
            if (typeof data["尾缀"][type] !== 'number') data["尾缀"][type] = 0;
        });

        // 执行计数 +1
        data["次数"] += 1;
        data["尾缀"][currentType] += 1;
        // 记录北京时间
        data["time"] = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

        // 写入 KV
        await env.lze.put(realIP, JSON.stringify(data));

    } catch (e) {
        console.error('KV 记录失败:', e);
    }

    // --- 4. 转发请求给 Hugging Face (严格映射 6 个接口) ---
    const targetMap = {
        '/slide': 'https://lze888lze-hf-api.hf.space/captcha/slide',
        '/hole': 'https://lze888lze-hf-api.hf.space/captcha/hole',
        '/puzzle': 'https://lze888lze-hf-api.hf.space/captcha/puzzle',
        '/slide-base64': 'https://lze888lze-hf-api.hf.space/captcha/slide-base64',
        '/hole-base64': 'https://lze888lze-hf-api.hf.space/captcha/hole-base64',
        '/puzzle-base64': 'https://lze888lze-hf-api.hf.space/captcha/puzzle-base64'
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
