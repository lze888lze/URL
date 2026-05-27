export default {
  async fetch(request, env) {
    // 统一响应头工具函数
    const jsonResponse = (data, status = 200) => {
      return new Response(JSON.stringify(data), {
        status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    };

    // 处理跨域预检请求 OPTIONS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    const url = new URL(request.url);
    const ip = request.headers.get('CF-Connecting-IP') || 'Unknown';
    // 路径统一小写，解决大小写敏感问题
    const path = url.pathname.toLowerCase();

    // 1. 路径映射配置
    const PATH_MAPPING = {
      '/v2': 'https://lze888lze-hf-api.hf.space/captcha/v2',
      '/b64': 'https://lze888lze-hf-api.hf.space/captcha/v2/base64'
    };

    const targetUrl = PATH_MAPPING[path];
    const isAllowed = !!targetUrl;

    // 2. 独立异步统计IP数据（不阻塞主业务）
    const updateIpStats = async () => {
      try {
        let data = await env.lze.get(ip, 'json') || { total: 0, v2: 0, b64: 0, unknown: 0, time: '' };
        data.total += 1;
        if (isAllowed) {
          const key = path.substring(1);
          data[key] = (data[key] || 0) + 1;
        } else {
          data.unknown += 1;
        }
        data.time = new Date().toLocaleString('zh-CN', { hour12: false });
        await env.lze.put(ip, JSON.stringify(data));
      } catch (e) {
        console.error('IP统计失败:', e);
      }
    };

    // 异步执行统计
    updateIpStats();

    // 3. 拦截无效路径
    if (!isAllowed) {
      return jsonResponse({ error: "Invalid Path", msg: "该接口不存在" }, 404);
    }

    try {
      // 4. 净化请求头
      const newHeaders = new Headers(request.headers);
      const removeHeaders = [
        'cf-connecting-ip', 'cf-ipcountry', 'cf-ray',
        'x-forwarded-for', 'x-forwarded-proto', 'cdn-loop'
      ];
      removeHeaders.forEach(h => newHeaders.delete(h));
      newHeaders.set('Host', new URL(targetUrl).host);

      // 构建转发请求（GET/HEAD 不携带body）
      const fetchOptions = {
        method: request.method,
        headers: newHeaders
      };
      if (!['GET', 'HEAD'].includes(request.method.toUpperCase())) {
        fetchOptions.body = request.body;
      }

      // 发起请求（已移除超时逻辑）
      const response = await fetch(targetUrl, fetchOptions);

      // 5. 流式透传响应 + 跨域头
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

      return new Response(response.body, {
        status: response.status,
        headers: responseHeaders
      });

    } catch (fetchError) {
      // 仅处理网络/目标服务异常
      return jsonResponse({ error: "Fetch Failed", msg: "转发请求失败" }, 504);
    }
  }
};
