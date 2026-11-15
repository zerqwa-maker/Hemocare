HemoCare push integration bundle.
Files to copy to repository:
 worker.js -> src/worker.js
 schema.sql -> migrations/0001_push.sql
 deploy.yml -> .github/workflows/deploy-push.yml
 wrangler.jsonc -> wrangler.jsonc

Cloudflare secret VAPID_PRIVATE_KEY must exist on Worker; never put it in GitHub.
GitHub Actions secrets CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required.
For iPhone: install PWA on home screen, open it, enable push, then test.
This bundle has not been deployed. Existing data is not modified by schema creation.
