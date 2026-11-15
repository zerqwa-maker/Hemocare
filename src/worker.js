import * as webpush from 'web-push';

const json = (data, status = 200) => Response.json(data, {status, headers: {'Cache-Control':'no-store'}});
const isKey = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const corsSafe = request => request.headers.get('Origin') === new URL(request.url).origin || !request.headers.has('Origin');
const payload = (kind, test = false) => ({title: test ? 'HemoCare — проверка' : 'HemoCare — напоминание', body: test ? 'Тестовое уведомление работает.' : kind === 'doctor' ? 'Сегодня запланировано посещение врача.' : kind === 'personal' ? 'У вас запланировано личное напоминание.' : 'Сегодня запланировано напоминание об анализах.', tag: test ? 'hemocare-test' : 'hemocare-reminder'});
function configure(env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) throw new Error('VAPID keys are not configured');
  webpush.setVapidDetails('mailto:notifications@hemocare.example', env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
}
async function send(env, subscription, message) {
  configure(env);
  return webpush.sendNotification(subscription, JSON.stringify(message), {TTL: 3600});
}
async function api(request, env, url) {
  if (url.pathname === '/api/push-diagnostics' && request.method === 'GET') {
    let databaseTables = false;
    let databaseError = null;
    try { if (env.DB) { const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('push_subscriptions','push_reminders')").first(); databaseTables = Number(row?.n) === 2; } }
    catch (e) { databaseError = e?.name || 'DatabaseError'; }
    return json({databaseConnected:!!env.DB,databaseTables,databaseError,vapidPublicKeyPresent:!!env.VAPID_PUBLIC_KEY,vapidPrivateKeyPresent:!!env.VAPID_PRIVATE_KEY,webpushSetVapidDetails:typeof webpush.setVapidDetails,webpushSendNotification:typeof webpush.sendNotification});
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
    await env.DB.prepare('INSERT INTO push_subscriptions(device_key,subscription,updated_at) VALUES(?,?,?) ON CONFLICT(device_key) DO UPDATE SET subscription=excluded.subscription,updated_at=excluded.updated_at').bind(key,JSON.stringify(sub),Date.now()).run();
    return json({ok:true});
  }
  let record;
  try { record = await env.DB.prepare('SELECT subscription FROM push_subscriptions WHERE device_key=?').bind(key).first(); }
  catch (e) { console.error('HemoCare subscription lookup failed',e?.name,e?.message); return json({error:'Subscription lookup failed',stage:'subscription_lookup',reason:e?.name || 'UnknownError'},500); }
  if (!record) return json({error:'Enable notifications first'},409);
  if (url.pathname === '/api/reminders') {
    if (!Array.isArray(body?.reminders) || body.reminders.length > 200) return json({error:'Invalid reminders'},400);
    const items = [];
    for (const r of body.reminders) {
      if (typeof r.id !== 'string' || r.id.length > 100 || !['analysis','doctor','personal'].includes(r.kind) || typeof r.at !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(r.at) || !Number.isFinite(Date.parse(r.at))) return json({error:'Invalid reminder'},400);
      items.push({id:r.id, kind:r.kind, at:Date.parse(r.at)});
    }
    const statements = [env.DB.prepare('DELETE FROM push_reminders WHERE device_key=?').bind(key), ...items.filter(r=>r.at>Date.now()).map(r=>env.DB.prepare('INSERT INTO push_reminders(device_key,reminder_id,kind,due_at) VALUES(?,?,?,?)').bind(key,r.id,r.kind,r.at))];
    await env.DB.batch(statements);
    return json({ok:true,count:items.length});
  }
  try {await send(env,JSON.parse(record.subscription),payload('analysis',true));return json({ok:true});}
  catch(e) {console.error('HemoCare test push failed',e?.name,e?.message,e?.statusCode);if ([404,410].includes(e?.statusCode)) {try {await env.DB.prepare('DELETE FROM push_subscriptions WHERE device_key=?').bind(key).run();} catch(cleanupError) {console.error('Push subscription cleanup failed',cleanupError?.name,cleanupError?.message);}}return json({error:'Push delivery failed',stage:'push_delivery',reason:e?.name || 'UnknownError',status:e?.statusCode || null},502);}
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
      const {results=[]}=await env.DB.prepare('SELECT r.device_key,r.reminder_id,r.kind,s.subscription FROM push_reminders r JOIN push_subscriptions s ON s.device_key=r.device_key WHERE r.due_at<=? LIMIT 50').bind(now).all();
      for (const r of results) {
        try {
          await send(env,JSON.parse(r.subscription),payload(r.kind));
          await env.DB.prepare('DELETE FROM push_reminders WHERE device_key=? AND reminder_id=?').bind(r.device_key,r.reminder_id).run();
        } catch(e) {
          console.error('Push delivery failed',e.statusCode || e.message);
          if ([404,410].includes(e.statusCode)) await env.DB.prepare('DELETE FROM push_subscriptions WHERE device_key=?').bind(r.device_key).run();
        }
      }
    })());
  }
};
