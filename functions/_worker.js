export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ip = request.headers.get('CF-Connecting-IP') || 'Unknown';
    const path = url.pathname; // 获取 /v2 及其后面的路径

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

    // 3. 转发请求 (请确认这里的 HF 目标地址是否正确)
    return fetch(`https://lze888lze-huggingface.hf.co${url.pathname}`, request);
  }
};
