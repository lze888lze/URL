export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ip = request.headers.get('CF-Connecting-IP') || 'Unknown';
    const path = url.pathname;

    // --- 1. 定义白名单 ---
    // 只有这里面的路径才会被转发到后端，其他的都会被视为“未知”
    const ALLOWED_PATHS = ['/v2', '/b64'];
    const isAllowed = ALLOWED_PATHS.includes(path);

    try {
      // --- 2. 获取并更新数据 (单 Key 聚合) ---
      let data = await env.lze.get(ip, 'json');

      // 如果该 IP 是第一次访问，初始化数据结构
      if (!data) {
        data = { total: 0, v2: 0, b64: 0, unknown: 0, time: '' };
      }

      // 更新计数器
      data.total += 1;

      // 根据路径分类统计
      if (isAllowed) {
        // 去掉斜杠作为 key (例如 /v2 -> v2)
        const key = path.substring(1);
        if (data[key] !== undefined) {
          data[key] += 1;
        } else {
          // 防止代码逻辑漏洞，万一 ALLOWED_PATHS 改了但这里没改
          data.unknown += 1;
        }
      } else {
        // 不在白名单内，记录为未知请求
        data.unknown += 1;
      }

      // 更新最后访问时间 (格式: YYYY/MM/DD HH:mm:ss)
      const now = new Date();
      data.time = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

      // 写回 KV (覆盖旧值)
      await env.lze.put(ip, JSON.stringify(data));

      // --- 3. 处理请求转发 ---
      if (!isAllowed) {
        // 如果是未知请求，直接拦截，不浪费后端资源
        return new Response(JSON.stringify({ error: "Invalid Path", msg: "该接口不存在或未被授权" }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 如果是白名单请求，转发到后端
      // 注意：这里假设你的后端地址配置在环境变量 BACKEND_URL 中，或者你需要硬编码
      const backendUrl = env.BACKEND_URL || 'https://your-backend-server.com';
      const targetUrl = new URL(path, backendUrl);
      targetUrl.search = url.search; // 保留查询参数

      return fetch(targetUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body
      });

    } catch (e) {
      // 即使 KV 写入失败，也尽量保证服务可用（降级处理）
      console.error("KV Error:", e);
      if (!isAllowed) {
         return new Response("Error", { status: 500 });
      }
      // 继续尝试转发
      const backendUrl = env.BACKEND_URL || 'https://your-backend-server.com';
      const targetUrl = new URL(path, backendUrl);
      targetUrl.search = url.search;
      return fetch(targetUrl, { method: request.method, headers: request.headers, body: request.body });
    }
  }
};
