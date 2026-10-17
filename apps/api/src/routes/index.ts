import type { FastifyInstance } from 'fastify';
import authRoutes from './auth.routes.js';
import kioskRoutes from './kiosk.routes.js';
import adminRoutes from './admin.routes.js';
import agentRoutes from './agent.routes.js';
import type { Services } from '../services/registry.js';
import type { Container } from '../container.js';

interface RouteDeps {
  container: Container;
  services: Services;
}

/**
 * Route registration.
 *
 * Everything lives under `API_BASE_PATH`. The kiosk router is registered without an
 * auth hook because a kiosk has no account; the admin router requires a permission on
 * every single route — there is no default-allow anywhere in this file.
 */
export default async function registerRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { container } = deps;
  const base = container.env.API_BASE_PATH;

  await app.register(
    async (api) => {
      await api.register(authRoutes, deps);
      await api.register(kioskRoutes, deps);
      await api.register(agentRoutes, deps);
      await api.register(adminRoutes, deps);
    },
    { prefix: base },
  );
}