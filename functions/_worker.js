export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ip = request.headers.get('CF-Connecting-IP') || 'Unknown';
    const path = url.pathname; // 获取当前访问的路径，比如 /v2

    try {
      // 1. 记录访问次数 (简洁前缀 c:)
      const countKey = `c:${ip}`;
      let currentCount = await env.lze.get(countKey);
      let newCount = currentCount ? parseInt(currentCount) + 1 : 1;
      await env.lze.put(countKey, newCount.toString());

      // 2. 记录详细日志 (简洁前缀 l:)
      const logKey = `l:${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const logValue = JSON.stringify({
        ip: ip,
        path: path,
        time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
      });
      await env.lze.put(logKey, logValue);

    } catch (e) {
      console.error("KV 写入失败:", e);
    }

    // 3. 转发请求到真实的 Hugging Face API
    // 你的 Lua 脚本访问的是 /v2，真实地址需要的是 /captcha/v2
    // 这里我们用 replace 把 /v2 替换成真实的后端路径
    const realBackendPath = url.pathname.replace('/v2', '/captcha/v2');
    const targetUrl = `https://lze888lze-hf-api.hf.space${realBackendPath}`;

    // 构造一个新的请求，把目标指向真实的 HF API，并带上你上传的图片数据
    const newRequest = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'follow'
    });

    return fetch(newRequest);
  }
};
