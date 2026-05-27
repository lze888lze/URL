export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. 只要请求进来，就先往 KV 里写入一条测试数据，证明代码成功运行了
    try {
        await env.lze.put('test_key', JSON.stringify({ 
            msg: 'worker_is_running', 
            time: new Date().toISOString() 
        }));
        console.log('KV 测试数据写入成功！');
    } catch (e) {
        console.error('KV 写入失败:', e);
        // 即使 KV 挂了，也继续往下走，尽量返回接口数据
    }

    // 2. 直接在 Worker 里手动转发请求给 Hugging Face
    // 目标接口地址
    const targetMap = {
        '/v2': 'https://lze888lze-hf-api.hf.space/captcha/v2',
        '/b64': 'https://lze888lze-hf-api.hf.space/captcha/v2/base64'
    };
    const targetUrl = targetMap[path] || targetMap['/v2']; // 默认走 /v2

    try {
        // 发起转发请求
        const response = await fetch(targetUrl, {
            method: request.method,
            headers: request.headers,
            body: request.body
        });
        // 把 Hugging Face 的真实结果返回给你的 Lua 脚本
        return response;
    } catch (e) {
        // 如果转发失败，返回一个明确的报错信息
        return new Response(JSON.stringify({ error: 'Fetch Failed', msg: e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
