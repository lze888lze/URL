export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. 获取真实 IP (支持 IPv4 和 IPv6)
    const realIP = request.headers.get('cf-connecting-ip') || 'unknown_ip';

    // 2. 严格白名单校验
    let currentType = null;

    if (path.includes('/slide') && path.includes('-base64')) {
        currentType = 'slide-base64';
    } else if (path.includes('/slide')) {
        currentType = 'slide';
    } else if (path.includes('/hole') && path.includes('-base64')) {
        currentType = 'hole-base64';
    } else if (path.includes('/hole')) {
        currentType = 'hole';
    } else if (path.includes('/puzzle') && path.includes('-base64')) {
        currentType = 'puzzle-base64';
    } else if (path.includes('/puzzle')) {
        currentType = 'puzzle';
    }

    if (!currentType) {
        return new Response(JSON.stringify({
            error: '403 Forbidden',
            msg: '该路径不在白名单内，仅允许访问 /slide、/slide-base64、/hole、/hole-base64、/puzzle、/puzzle-base64'
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
        // 次数=总调用次数, time=北京时间, 尾缀=类型统计
        // 每个类型是数组 [上传图片次数, base64次数]
        //   sl=slide, ho=hole, pz=puzzle
        if (!data) {
            data = { "次数": 0, "time": "", "尾缀": { "sl": [0, 0], "ho": [0, 0], "pz": [0, 0] } };
        }

        // 兼容旧数据：确保结构完整
        if (typeof data["次数"] !== 'number') data["次数"] = 0;
        if (!data["尾缀"]) data["尾缀"] = {};
        if (!Array.isArray(data["尾缀"]["sl"])) data["尾缀"]["sl"] = [0, 0];
        if (!Array.isArray(data["尾缀"]["ho"])) data["尾缀"]["ho"] = [0, 0];
        if (!Array.isArray(data["尾缀"]["pz"])) data["尾缀"]["pz"] = [0, 0];

        // 计数 +1
        data["次数"] += 1;

        // 根据接口类型给对应位置 +1
        // 数组下标: 0=上传图片, 1=base64
        const typeIndexMap = {
            'slide':         ['sl', 0],
            'slide-base64':  ['sl', 1],
            'hole':          ['ho', 0],
            'hole-base64':   ['ho', 1],
            'puzzle':        ['pz', 0],
            'puzzle-base64': ['pz', 1]
        };
        const [group, idx] = typeIndexMap[currentType];
        data["尾缀"][group][idx] += 1;

        // 更新北京时间，格式如：2026/5/28 04:02:53
        data["time"] = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

        await env.lze.put(realIP, JSON.stringify(data));

    } catch (e) {
        console.error('KV 记录失败:', e);
    }

    // --- 3. 转发请求给 Hugging Face ---

    const targetMap = {
        'slide':          'https://lze888lze-hf-api.hf.space/slide',
        'slide-base64':   'https://lze888lze-hf-api.hf.space/slide-base64',
        'hole':           'https://lze888lze-hf-api.hf.space/hole',
        'hole-base64':    'https://lze888lze-hf-api.hf.space/hole-base64',
        'puzzle':         'https://lze888lze-hf-api.hf.space/puzzle',
        'puzzle-base64':  'https://lze888lze-hf-api.hf.space/puzzle-base64'
    };

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
