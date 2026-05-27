export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ip = request.headers.get('CF-Connecting-IP') || 'Unknown';
    const path = url.pathname;

    // --- 1. 路径映射配置 (完全复刻你 _redirects 里的正确逻辑) ---
    const PATH_MAPPING = {
      '/v2': 'https://lze888lze-hf-api.hf.space/captcha/v2',
      '/b64': 'https://lze888lze-hf-api.hf.space/captcha/v2/base64'
    };

    // 检查当前请求的路径是否在映射表中（白名单）
    const targetUrl = PATH_MAPPING[path];
    const isAllowed = !!targetUrl;

    try {
      // --- 2. 获取并更新数据 (单 Key 聚合) ---
      let data = await env.lze.get(ip, 'json');
      if (!data) {
        data = { total: 0, v2: 0, b64: 0, unknown: 0, time: '' };
      }

      data.total += 1;
      if (isAllowed) {
        const key = path.substring(1);
        data[key] = (data[key] || 0) + 1;
      } else {
        data.unknown += 1;
      }
      data.time = new Date().toLocaleString('zh-CN', { hour12: false });

      await env.lze.put(ip, JSON.stringify(data));

      // --- 3. 处理未知请求拦截 ---
      if (!isAllowed) {
        return new Response(JSON.stringify({ error: "Invalid Path", msg: "该接口不存在" }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // --- 4. 转发请求到真实后端 ---
      
      // 净化请求头，只保留最基础的必要头信息
      const newHeaders = new Headers();
      request.headers.forEach((value, key) => {
        // 过滤掉 Cloudflare 特有的头，防止后端不识别
        if (!['cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'x-forwarded-for', 'x-forwarded-proto', 'cdn-loop'].includes(key.toLowerCase())) {
          newHeaders.set(key, value);
        }
      });
      // 确保 Host 头指向真实的后端域名
      newHeaders.set('Host', new URL(targetUrl).host);

      // 核心修改：将超时时间从 10 秒延长到 30 秒！
      // Hugging Face 的免费 Spaces 在冷启动或高负载时，识别一张图片可能需要 15-20 秒。
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); 

      try {
        const response = await fetch(targetUrl, {
          method: request.method,
          headers: newHeaders,
          body: request.body, // 你的 Lua 脚本上传的图片数据就在这里
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        // 如果后端返回了非 200 状态码，直接拦截并返回给 Lua
        if (!response.ok) {
          return new Response(JSON.stringify({ 
            error: "Backend Error", 
            status: response.status, 
            msg: "后端服务器处理失败" 
          }), {
            status: 502,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // 转发后端的成功响应（包含识别结果的 JSON）给 Lua
        return response;

      } catch (fetchError) {
        clearTimeout(timeoutId);
        // 捕获转发过程中的网络错误或超时
        return new Response(JSON.stringify({ 
          error: "Fetch Timeout/Failed", 
          msg: "转发请求超时或网络异常" 
        }), {
          status: 504,
          headers: { 'Content-Type': 'application/json' }
        });
      }

    } catch (err) {
      return new Response(JSON.stringify({ error: "Worker Error", msg: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }
};
