import { createStorage } from '../apps/api/src/storage/index.js';
export default { fetch: (req: Request) => new Response(String(typeof createStorage)) };
