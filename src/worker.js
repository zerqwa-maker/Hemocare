import * as webpush from 'web-push';
import { createECDH } from 'node:crypto';

const json = (data, status = 200) => Response.json(data, {status, headers: {'Cache-Control':'no-store'}});
const isKey = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const corsSafe = request => request.headers.get('Origin') === new URL(request.url).origin || !request.headers.has('Origin');
const payload = (kind, test = false) => ({title: test ? 'HemoCare — проверка' : 'HemoCare — напоминание', body: test ? 'Тестовое уведомление работает.' : kind === 'doctor' ? 'Сегодня запланировано посещение врача.' : kind === 'personal' ? 'У вас запланировано личное напоминание.' : 'Сегодня запланировано напоминание об анализах.', tag: test ? 'hemocare-test' : 'hemocare-reminder'});
function configure(env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) throw new Error('VAPID keys are not configured');
  webpush.setVapidDetails('https://hemocare.zerqwa.workers.dev', env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
}
async function send(env, subscription, message) {
  configure(env);
  return webpush.sendNotification(subscription, JSON.stringify(message), {TTL: 3600});
}
async function api(request, env, url) {
  if (url.pathname === '/api/push-diagnostics' && request.method === 'GET') {
    let databaseTables = false;
    let databaseError = null;
    try { if (env.DB) { const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('hemocare_push_subscriptions_v2','hemocare_push_reminders_v2')").first(); databaseTables = Number(row?.n) === 2; } }
    catch (e) { databaseError = e?.name || 'DatabaseError'; }
    return json({databaseConnected:!!env.DB,databaseTables,databaseError,vapidPublicKeyPresent:!!env.VAPID_PUBLIC_KEY,vapidPrivateKeyPresent:!!env.VAPID_PRIVATE_KEY,webpushSetVapidDetails:typeof webpush.setVapidDetails,webpushSendNotification:typeof webpush.sendNotification,storageVersion:2,vapidKeyPairMatch:(()=>{try{const privateBytes=Buffer.from(env.VAPID_PRIVATE_KEY || '', 'base64url');const publicBytes=Buffer.from(env.VAPID_PUBLIC_KEY || '', 'base64url');if(privateBytes.length!==32 || publicBytes.length!==65)return false;const ecdh=createECDH('prime256v1');ecdh.setPrivateKey(privateBytes);return ecdh.getPublicKey().equals(publicBytes);}catch(e){console.error('VAPID pair verification failed',e?.name);return false;}})()});
  }
  if (url.pathname === '/api/cloud-vault') {
    if (!corsSafe(request)) return json({error:'Origin not allowed'},403);
    if (!['GET','PUT'].includes(request.method)) return json({error:'Method not allowed'},405);
    if (!env.DB) return json({error:'Database unavailable'},503);
    // The 256-bit random vault identifier is a bearer capability; never log it.
    const id=request.headers.get('X-Vault-Key');
    if (typeof id!=='string' || !/^[a-f0-9]{64}$/.test(id)) return json({error:'Invalid vault recovery code'},400);
    if (request.method==='GET') {
      const row=await env.DB.prepare('SELECT ciphertext,updated_at,revision FROM hemocare_encrypted_vaults WHERE vault_id=?').bind(id).first();
      return row ? json({backup:JSON.parse(row.ciphertext),updatedAt:row.updated_at,revision:row.revision}) : json({error:'Cloud copy not found'},404);
    }
    if (Number(request.headers.get('content-length')||0)>2500000) return json({error:'Cloud copy too large'},413);
    const raw=await request.text();
    if (raw.length>2500000) return json({error:'Cloud copy too large'},413);
    let body;try{body=JSON.parse(raw)}catch{return json({error:'Invalid JSON'},400)}
    const b=body?.backup;
    if (!b || b.format!=='hemocare-encrypted-backup' || b.version!==2 || b.kdf!=='PBKDF2-SHA256' || b.iterations!==310000 || b.cipher!=='AES-256-GCM' || typeof b.salt!=='string' || !/^[A-Za-z0-9+/]{22}==$/.test(b.salt) || typeof b.iv!=='string' || !/^[A-Za-z0-9+/]{16}$/.test(b.iv) || typeof b.data!=='string' || !/^[A-Za-z0-9+/=]+$/.test(b.data) || b.data.length>2300000) return json({error:'Invalid encrypted backup'},400);
    const existing=await env.DB.prepare('SELECT revision FROM hemocare_encrypted_vaults WHERE vault_id=?').bind(id).first();
    if (existing && body.expectedRevision!==existing.revision) return json({error:'Cloud copy changed. Download it before overwriting.',revision:existing.revision},409);
    if (!existing && body.expectedRevision!==0) return json({error:'Cloud copy already changed'},409);
    const now=Date.now();
    if (existing) {
      const result=await env.DB.prepare('UPDATE hemocare_encrypted_vaults SET ciphertext=?,updated_at=?,revision=revision+1 WHERE vault_id=? AND revision=?').bind(JSON.stringify(b),now,id,existing.revision).run();
      if (result.meta?.changes!==1) return json({error:'Cloud copy changed'},409);
    } else {
      try{await env.DB.prepare('INSERT INTO hemocare_encrypted_vaults(vault_id,ciphertext,updated_at,revision) VALUES(?,?,?,1)').bind(id,JSON.stringify(b),now).run()}
      catch{return json({error:'Cloud copy already exists'},409)}
    }
    return json({ok:true,updatedAt:now,revision:(existing?.revision||0)+1});
  }
  if (url.pathname === '/api/health' && request.method === 'GET') return json({ok:true, app:'HemoCare', database:!!env.DB, vapidPublicKey:!!env.VAPID_PUBLIC_KEY, vapidPrivateKey:!!env.VAPID_PRIVATE_KEY, push:'configured'});
  if ((url.pathname === '/api/push-config' || url.pathname === '/api/push/public-key') && request.method === 'GET') return env.VAPID_PUBLIC_KEY ? json({publicKey:env.VAPID_PUBLIC_KEY}) : json({error:'Public key missing'},503);
  if (!['/api/subscribe','/api/reminders','/api/test'].includes(url.pathname)) return null;
  if (request.method !== 'POST') return json({error:'Method not allowed'},405);
  if (!corsSafe(request)) return json({error:'Origin not allowed'},403);
  if (!env.DB) return json({error:'Database not configured'},503);
  const key = request.headers.get('X-Device-Key');
  if (!isKey(key)) return json({error:'Invalid device key'},400);
  if (Number(request.headers.get('content-length') || 0) > 100000) return json({error:'Request too large'},413);
  let body;
  try {body = await request.json();} catch {return json({error:'Invalid JSON'},400);}
  if (url.pathname === '/api/subscribe') {
    const sub = body?.subscription;
    if (!sub || typeof sub.endpoint !== 'string' || sub.endpoint.length > 2048 || !sub.endpoint.startsWith('https://') || !sub.keys || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string' || sub.keys.p256dh.length > 300 || sub.keys.auth.length > 200) return json({error:'Invalid subscription'},400);
    await env.DB.prepare('INSERT INTO hemocare_push_subscriptions_v2(device_key,subscription,updated_at) VALUES(?,?,?) ON CONFLICT(device_key) DO UPDATE SET subscription=excluded.subscription,updated_at=excluded.updated_at').bind(key,JSON.stringify(sub),Date.now()).run();
    return json({ok:true});
  }
  let record;
  try { record = await env.DB.prepare('SELECT subscription FROM hemocare_push_subscriptions_v2 WHERE device_key=?').bind(key).first(); }
  catch (e) { console.error('HemoCare subscription lookup failed',e?.name,e?.message); return json({error:'Subscription lookup failed',stage:'subscription_lookup',reason:e?.name || 'UnknownError',detail:String(e?.message || '').slice(0,240)},500); }
  if (!record) return json({error:'Enable notifications first'},409);
  if (url.pathname === '/api/reminders') {
    if (!Array.isArray(body?.reminders) || body.reminders.length > 200) return json({error:'Invalid reminders'},400);
    const items = [];
    for (const r of body.reminders) {
      if (typeof r.id !== 'string' || r.id.length > 100 || !['analysis','doctor','personal'].includes(r.kind) || typeof r.at !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(r.at) || !Number.isFinite(Date.parse(r.at))) return json({error:'Invalid reminder'},400);
      items.push({id:r.id, kind:r.kind, at:Date.parse(r.at)});
    }
    const statements = [env.DB.prepare('DELETE FROM hemocare_push_reminders_v2 WHERE device_key=?').bind(key), ...items.filter(r=>r.at>Date.now()).map(r=>env.DB.prepare('INSERT INTO hemocare_push_reminders_v2(device_key,reminder_id,kind,due_at) VALUES(?,?,?,?)').bind(key,r.id,r.kind,r.at))];
    await env.DB.batch(statements);
    return json({ok:true,count:items.length});
  }
  try {await send(env,JSON.parse(record.subscription),payload('analysis',true));return json({ok:true});}
  catch(e) {console.error('HemoCare test push failed',e?.name,e?.message,e?.statusCode);if ([404,410].includes(e?.statusCode)) {try {await env.DB.prepare('DELETE FROM hemocare_push_subscriptions_v2 WHERE device_key=?').bind(key).run();} catch(cleanupError) {console.error('Push subscription cleanup failed',cleanupError?.name,cleanupError?.message);}}return json({error:'Push delivery failed',stage:'push_delivery',reason:e?.name || 'UnknownError',status:e?.statusCode || null,detail:String(e?.body || e?.message || '').slice(0,500)},502);}
}
export default {
  async fetch(request,env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {return await api(request,env,url) || json({error:'Not found'},404);} catch(e) {console.error('HemoCare API error',url.pathname,e?.name,e?.message);return json({error:'Server error',stage:url.pathname === '/api/test' ? 'test' : url.pathname === '/api/subscribe' ? 'subscribe' : url.pathname === '/api/reminders' ? 'reminders' : 'api',reason:e?.name || 'UnknownError'},500);}
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(controller,env,ctx) {
    if (!env.DB) return;
    ctx.waitUntil((async()=>{
      const now=Date.now();
      const {results=[]}=await env.DB.prepare('SELECT r.device_key,r.reminder_id,r.kind,s.subscription FROM hemocare_push_reminders_v2 r JOIN hemocare_push_subscriptions_v2 s ON s.device_key=r.device_key WHERE r.due_at<=? LIMIT 50').bind(now).all();
      for (const r of results) {
        try {
          await send(env,JSON.parse(r.subscription),payload(r.kind));
          await env.DB.prepare('DELETE FROM hemocare_push_reminders_v2 WHERE device_key=? AND reminder_id=?').bind(r.device_key,r.reminder_id).run();
        } catch(e) {
          console.error('Push delivery failed',e.statusCode || e.message);
          if ([404,410].includes(e.statusCode)) await env.DB.prepare('DELETE FROM hemocare_push_subscriptions_v2 WHERE device_key=?').bind(r.device_key).run();
        }
      }
    })());
  }
};
