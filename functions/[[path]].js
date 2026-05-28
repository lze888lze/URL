// ============================================================
// Cloudflare Workers 中间件 - 图片处理代理
// 功能：记录访问统计 → 代理到 Hugging Face API
// KV Key 格式：国家+省份+IP（如：中国广东240.12.34.56）
// KV Value 格式：{"次数":2,"time":"2026/5/28 06:43:00","尾缀":{"sl":[0,0],"ho":[0,0],"pz":[2,0]}}
// ============================================================

import { lookupProvince } from './ipv6-province.js';

// 类型映射配置
const TYPE_CONFIG = {
    'slide':          { stats: 'sl', mode: 0, target: 'slide' },
    'slide-base64':   { stats: 'sl', mode: 1, target: 'slide-base64' },
    'hole':           { stats: 'ho', mode: 0, target: 'hole' },
    'hole-base64':    { stats: 'ho', mode: 1, target: 'hole-base64' },
    'puzzle':         { stats: 'pz', mode: 0, target: 'puzzle' },
    'puzzle-base64':  { stats: 'pz', mode: 1, target: 'puzzle-base64' },
};

const HF_BASE_URL = 'https://lze888lze-hf-api.hf.space';

// 默认数据结构
const DEFAULT_DATA = {
    "次数": 0,
    "time": "",
    "尾缀": { "sl": [0, 0], "ho": [0, 0], "pz": [0, 0] }
};

// 直辖市列表
const MUNICIPALITIES = ['北京', '上海', '天津', '重庆'];

// CF GeoIP 回退：国家代码 + 省份映射
const COUNTRY_MAP = {
    'CN': '中国', 'US': '美国', 'JP': '日本', 'KR': '韩国', 'GB': '英国',
    'DE': '德国', 'FR': '法国', 'AU': '澳大利亚', 'CA': '加拿大', 'RU': '俄罗斯',
    'SG': '新加坡', 'MY': '马来西亚', 'TH': '泰国', 'VN': '越南',
    'TW': '中国台湾', 'HK': '中国香港', 'MO': '中国澳门',
};

const REGION_MAP = {
    'Anhui': '安徽', 'Beijing': '北京', 'Chongqing': '重庆', 'Fujian': '福建',
    'Gansu': '甘肃', 'Guangdong': '广东', 'Guangxi': '广西', 'Guizhou': '贵州',
    'Hainan': '海南', 'Hebei': '河北', 'Heilongjiang': '黑龙江', 'Henan': '河南',
    'Hubei': '湖北', 'Hunan': '湖南', 'Inner Mongolia': '内蒙古', 'Jiangsu': '江苏',
    'Jiangxi': '江西', 'Jilin': '吉林', 'Liaoning': '辽宁', 'Ningxia': '宁夏',
    'Qinghai': '青海', 'Shaanxi': '陕西', 'Shandong': '山东', 'Shanghai': '上海',
    'Shanxi': '山西', 'Sichuan': '四川', 'Tianjin': '天津', 'Tibet': '西藏',
    'Xinjiang': '新疆', 'Yunnan': '云南', 'Zhejiang': '浙江',
    'Hong Kong': '香港', 'Macau': '澳门',
};

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. 获取访问者 IP
    const realIP = request.headers.get('cf-connecting-ip') || 'unknown_ip';

    // 2. 路由匹配与白名单校验（去掉开头的 /）
    const cleanPath = path.replace(/^\//, '');
    const typeConfig = TYPE_CONFIG[cleanPath];
    if (!typeConfig) {
        return new Response(JSON.stringify({
            error: '403 Forbidden',
            msg: '该路径不在白名单内，仅允许访问: slide, slide-base64, hole, hole-base64, puzzle, puzzle-base64'
        }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // 3. 异步 KV 写入（不阻塞主请求）
    context.waitUntil((async () => {
        try {
            const location = getLocation(request, realIP);
            const kvKey = `${location}${realIP}`;

            let data = await loadKVData(env, kvKey);

            // 更新统计数据
            data["次数"] += 1;
            data["time"] = getBeijingTime();
            data["尾缀"][typeConfig.stats][typeConfig.mode] += 1;

            await env.lze.put(kvKey, JSON.stringify(data));
        } catch (e) {
            console.error('KV 记录失败:', e);
        }
    })());

    // 4. 立即代理请求到 Hugging Face（不等待 KV 完成）
    return proxyToTarget(request, HF_BASE_URL, typeConfig.target);
}

// ---------------------- 辅助函数 ----------------------

/**
 * 获取位置信息：国家+省份
 */
function getLocation(request, ip) {
    // 优先用 IPv6 前缀表查询
    const ipv6Province = lookupProvince(ip);
    if (ipv6Province) {
        if (ipv6Province.startsWith('中国')) {
            return ipv6Province;
        }
        return '中国' + ipv6Province + (MUNICIPALITIES.includes(ipv6Province) ? '市' : '省');
    }

    // 回退到 CF 的 GeoIP
    const cf = request.cf || {};
    const country = cf.country || '';
    const region = cf.region || '';
    return buildLocationFromCF(country, region);
}

/**
 * CF GeoIP 回退：国家代码 + 省份 → 位置字符串
 */
function buildLocationFromCF(country, region) {
    const co = COUNTRY_MAP[country] || country || '未知';
    const pr = REGION_MAP[region] || region || '';
    if (co === '中国' && pr) {
        if (MUNICIPALITIES.includes(pr)) {
            return co + pr + '市';
        }
        return co + pr + '省';
    }
    if (pr) return co + pr;
    return co;
}

/**
 * 加载并解析 KV 数据，自动补充默认字段
 */
async function loadKVData(env, key) {
    const raw = await env.lze.get(key);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_DATA));

    try {
        const data = JSON.parse(raw);
        // 兼容旧数据 + 补充缺失字段
        return {
            "次数": typeof data["次数"] === 'number' ? data["次数"] : 0,
            "time":  data["time"] || '',
            "尾缀": {
                "sl": Array.isArray(data["尾缀"]?.["sl"]) ? data["尾缀"]["sl"] : [0, 0],
                "ho": Array.isArray(data["尾缀"]?.["ho"]) ? data["尾缀"]["ho"] : [0, 0],
                "pz": Array.isArray(data["尾缀"]?.["pz"]) ? data["尾缀"]["pz"] : [0, 0],
            }
        };
    } catch (e) {
        return JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
}

/**
 * 获取北京时间（格式：YYYY/M/D HH:mm:ss）
 */
function getBeijingTime() {
    return new Date().toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
}

/**
 * 代理请求到目标 URL
 */
async function proxyToTarget(request, baseUrl, endpoint) {
    const targetUrl = `${baseUrl}/${endpoint}`;
    try {
        const response = await fetch(targetUrl, {
            method: request.method,
            headers: request.headers,
            body: request.body
        });
        return response;
    } catch (e) {
        return new Response(JSON.stringify({
            error: 'Proxy Failed',
            msg: e.message
        }), {
            status: 502,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
