
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        app: "HemoCare",
        database: Boolean(env.DB),
        vapidPublicKey: Boolean(env.VAPID_PUBLIC_KEY),
        vapidPrivateKey: Boolean(env.VAPID_PRIVATE_KEY),
        push: "setup_in_progress"
      });
    }

    if (
      url.pathname === "/api/push/public-key" &&
      request.method === "GET"
    ) {
      if (!env.VAPID_PUBLIC_KEY) {
        return Response.json(
          { error: "Public VAPID key not configured" },
          { status: 503 }
        );
      }

      return Response.json({
        publicKey: env.VAPID_PUBLIC_KEY
      });
    }

    return env.ASSETS.fetch(request);
  }
};
