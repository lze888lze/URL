export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ip = request.headers.get('CF-Connecting-IP') || 'Unknown';
    const path = url.pathname;

    try {
      // 1. 记录访问次数
      const countKey = `c:${ip}`;
      let currentCount = await env.lze.get(countKey);
      let newCount = currentCount ? parseInt(currentCount) + 1 : 1;
      await env.lze.put(countKey, newCount.toString());

      // 2. 记录详细日志
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

    // 3. 构造转发请求 (关键修复点)
    // 3.1 定义真实的目标地址
    const TARGET_URL = 'https://lze888lze-hf-api.hf.space/captcha/v2';
    
    // 3.2 克隆原始请求，并修改目标 URL
    let newRequest = new Request(request);
    
    // 3.3 手动设置目标 URL (这是绕过 403 的关键)
    // 这样做不会触发内部循环，直接指向外部服务
    newRequest = new Request(TARGET_URL, newRequest);

    // 3.4 必须添加：伪造浏览器头部，防止 Hugging Face 返回人机验证
    const headers = new Headers(newRequest.headers);
    headers.set('Origin', 'https://lze888lze-hf-api.hf.space');
    headers.set('Referer', 'https://lze888lze-hf-api.hf.space/captcha/v2');
    headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36');

    // 3.5 重新构建请求对象
    const finalRequest = new Request(newRequest, {
      headers: headers
    });

    return fetch(finalRequest);
  }
};
