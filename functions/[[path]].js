export async function onRequest(context) {
    const { env } = context;

    try {
        // 1. 直接写入一条固定的测试数据到 KV
        // 键名是 'test_key'，值是 '{"msg": "hello_from_redirects"}'
        await env.lze.put('test_key', JSON.stringify({ msg: 'hello_from_redirects' }));
        
        // 可以在控制台打个日志，方便你在 Pages 后台的 Functions 日志里看
        console.log('KV 测试写入成功！');

    } catch (e) {
        // 即使 KV 写入失败，也打印错误，但绝对不返回任何内容
        // 保证不影响 _redirects 的执行
        console.error('KV 写入失败:', e);
    }

    // 2. 核心：什么都不返回 (等同于 return undefined)
    // Cloudflare 发现 [[path]].js 没有任何返回，就会自动去执行根目录 _redirects 的 307 规则
}
