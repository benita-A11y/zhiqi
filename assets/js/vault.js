/* ============================================================
   执棋 · 图案保险箱 (vault.js)
   ————————————————————————————————————————————————————
   无账号 / 无密钥 / 无后端的「多端同一份数据」核心。

   原理（端到端加密 + 内容寻址）：
     图案(+暗号) ──SHA256──▶ spaceId  决定云端文件路径（不同图案 = 不同文件 = 不同数据空间）
     图案(+暗号) ──PBKDF2──▶ AES-GCM-256 密钥（只存内存，永不落盘、永不上网）
     明文数据 ──AES-GCM──▶ 密文 ──PUT──▶ COS 公有读写桶

   因此：云上只有密文。桶可以公有读写（免费、免登录、免密钥），
        但不知道图案的人下载到手也只是一团乱码。
   ============================================================ */
(function(){
  const ALG          = 'PBKDF2-SHA256-600000/AES-GCM-256';
  const PBKDF2_ITER  = 600000;                 // OWASP 2023 对 PBKDF2-HMAC-SHA256 的建议量级
  const SPACE_PREFIX = 'zhiqi-space-v1|';      // 空间寻址盐（改前缀等于换一套命名空间）
  const SALT_PREFIX  = 'zhiqi-salt-v1|';       // 密钥派生盐（由 spaceId 二次派生，无需额外存储）
  const VERIFY_TAG   = 'ZQ-VAULT-1';           // 明文头校验标记：解密后必须命中，否则视为图案错误/密文被篡改

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  /* ---------- 编解码工具 ---------- */
  function b64(bytes){
    const arr = new Uint8Array(bytes);
    let s = '';
    const CH = 0x8000;                          // 分块拼接，避免超长字符串一次性构造
    for(let i=0;i<arr.length;i+=CH){
      s += String.fromCharCode.apply(null, arr.subarray(i, i+CH));
    }
    return btoa(s);
  }
  function unb64(str){
    const bin = atob(str);
    const arr = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  function hex(bytes){
    return Array.from(new Uint8Array(bytes)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }

  /* Web Crypto 仅在「安全上下文」可用：https / localhost / file://(部分浏览器)。
     http 明文站点下 crypto.subtle 为 undefined —— 必须显式检测并降级，不能假设存在。 */
  function hasCrypto(){
    return typeof crypto !== 'undefined' && !!crypto.subtle && typeof crypto.subtle.deriveKey === 'function';
  }
  async function sha256(str){
    return await crypto.subtle.digest('SHA-256', enc.encode(str));
  }

  /* 图案 → 空间 ID（单向不可逆）。
     同一图案永远得到同一 spaceId；换个图案就是另一个云端文件、另一份完全隔离的数据。 */
  async function spaceIdOf(pattern){
    const d = await sha256(SPACE_PREFIX + pattern);
    return hex(d).slice(0, 32);
  }

  /* 图案(+暗号) → { spaceId, key }
     - spaceId 只由「图案」决定：图案 = 门牌号（决定进哪个空间）
     - 暗号只参与「密钥派生」：暗号 = 这扇门的钥匙（不知道暗号，进得了门牌也解不开内容）
     这样设计的好处：换暗号不必迁移数据文件，换图案则天然进入另一个空间。 */
  async function keyOf(pattern, passphrase){
    const spaceId  = await spaceIdOf(pattern);
    const salt     = await sha256(SALT_PREFIX + spaceId);
    const material = pattern + (passphrase ? ('|' + passphrase) : '');
    const base = await crypto.subtle.importKey('raw', enc.encode(material), 'PBKDF2', false, ['deriveKey']);
    const key  = await crypto.subtle.deriveKey(
      { name:'PBKDF2', salt, iterations: PBKDF2_ITER, hash:'SHA-256' },
      base,
      { name:'AES-GCM', length:256 },
      false,                 // 不可导出：密钥无法被脚本读走，只能用于加解密
      ['encrypt','decrypt']
    );
    return { spaceId, key };
  }

  /* 加密：明文 JSON → 信封对象。
     IV 每次随机 12 字节（AES-GCM 要求同一密钥下 IV 绝不复用）。 */
  async function encrypt(state, key){
    const iv    = crypto.getRandomValues(new Uint8Array(12));
    const plain = enc.encode(JSON.stringify({ __v: VERIFY_TAG, data: state }));
    const ct    = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, plain);
    return { v:1, alg:ALG, iv:b64(iv), ct:b64(ct), ts:Date.now() };
  }

  /* 解密：信封 → 明文 state。
     失败只有两种可能：① 图案/暗号不对 ② 密文被人篡改过（GCM 认证标签校验失败）。
     两者都归为「解不开」，绝不返回半截数据，避免上层拿到脏状态。 */
  async function decrypt(env, key){
    if(!env || env.v !== 1 || !env.ct || !env.iv) throw new Error('BAD_ENVELOPE');
    let plain;
    try{
      plain = await crypto.subtle.decrypt({ name:'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.ct));
    }catch(e){
      const err = new Error('DECRYPT_FAILED');
      err.cause = e;
      throw err;
    }
    const obj = JSON.parse(dec.decode(plain));
    if(!obj || obj.__v !== VERIFY_TAG) throw new Error('BAD_PAYLOAD');
    return obj.data;
  }

  /* 空间指纹：给用户一个「我当前在哪个空间」的可视标识（同一图案稳定、不同图案必不同） */
  async function fingerprint(spaceId){
    const d = await sha256('zhiqi-fp|' + spaceId);
    const b = new Uint8Array(d);
    return { dots:[b[0]%9, b[1]%9, b[2]%9], hue: b[3]%360 };
  }

  window.ZQ = window.ZQ || {};
  window.ZQ.vault = {
    ALG, PBKDF2_ITER, VERIFY_TAG,
    hasCrypto, spaceIdOf, keyOf, encrypt, decrypt, fingerprint,
    b64, unb64, hex, sha256
  };
})();
