import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Defaults are fine: all pages are force-dynamic and read the KV snapshot per request,
// so no incremental/ISR cache backend is needed.
export default defineCloudflareConfig();
