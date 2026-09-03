'use strict';
/*
 * 执棋 · 云端 STS 临时密钥签发函数（腾讯云 SCF）
 * ------------------------------------------------------------
 * 作用：前端无登录直连私有 COS 桶的安全桥。
 *   - 永久密钥（SecretId/SecretKey）只存在于 SCF 环境变量，永不落前端。
 *   - 用 GetFederationToken 签发「仅能读写 data.json 一个对象」的临时密钥。
 *   - 临时密钥有效期短（默认 900s），到期自动失效、前端 SDK 自动重新申请。
 *   - 函数内校验来源域名（referer/origin），只允许你自己站点调用。
 *
 * 依赖：tencentcloud-sdk-nodejs（在 SCF 控制台/本地 npm install 后打包上传）
 * 触发：API 网关（鉴权类型选「无鉴权」），GET 即可返回临时密钥 JSON。
 */

const tencentcloud = require('tencentcloud-sdk-nodejs');
const StsClient = tencentcloud.sts.v20180813.Client;

// 从 SCF 环境变量读取（控制台配置，切勿硬编码在前端 / 仓库）
const SECRET_ID   = process.env.TC_SECRET_ID;     // 子账号永久密钥 ID（仅授予本函数用的最小权限）
const SECRET_KEY  = process.env.TC_SECRET_KEY;    // 子账号永久密钥 Key
const BUCKET      = process.env.COS_BUCKET;       // zhiqi-125xxxxxxx
const REGION      = process.env.COS_REGION;       // ap-guangzhou
const APPID       = process.env.COS_APPID;        // 125xxxxxxx（桶名里的数字部分）
const ALLOW_HOST  = (process.env.ALLOW_HOST || 'benita-a11y.github.io').toLowerCase();
const DURATION    = parseInt(process.env.STS_DURATION || '900', 10); // 临时密钥有效期（秒）

exports.main_handler = async (event) => {
  try {
    // 1) 来源校验：只允许你自己站点调用，避免被任意盗刷换密钥
    const headers = (event && event.headers) || {};
    const referer = (headers.referer || headers.Referer || '').toLowerCase();
    const origin  = (headers.origin  || headers.Origin  || '').toLowerCase();
    const src = referer + ' ' + origin;
    if (src.indexOf(ALLOW_HOST) === -1) {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 403, message: 'forbidden' })
      };
    }

    // 2) 最小权限策略：只允许「这一个 data.json 对象」的读/写/头，其余一律拒绝
    const policy = {
      version: '2.0',
      statement: [{
        effect: 'allow',
        action: ['name/cos:GetObject', 'name/cos:PutObject', 'name/cos:HeadObject'],
        resource: [`qcs::cos:${REGION}:uid/${APPID}:${BUCKET}/data.json`]
      }]
    };

    // 3) 用永久密钥（仅存在于 SCF 环境变量）签发临时密钥
    const client = new StsClient({
      credential: { secretId: SECRET_ID, secretKey: SECRET_KEY },
      region: REGION,
      profile: { httpProfile: { endpoint: 'sts.tencentcloudapi.com' } }
    });
    const resp = await client.GetFederationToken({
      Name: 'zhiqi-web',
      Policy: JSON.stringify(policy),
      DurationSeconds: DURATION
    });

    // 4) 原样返回 STS 响应，前端 cos-js-sdk-v5 可直接喂给 getAuthorization 回调
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify(resp)
    };
  } catch (e) {
    console.error('[sts] 签发失败', e);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 500, message: 'internal_error' })
    };
  }
};
