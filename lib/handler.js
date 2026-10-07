import { dispatch } from './router.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerTournamentRoutes } from './routes/tournaments.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerWebhookRoutes } from './routes/webhooks.js';
import { registerPeladaRoutes } from './routes/peladas.js';

let ready = false;
function init() {
  if (ready) return;
  registerAuthRoutes();
  registerTournamentRoutes();
  registerPublicRoutes();
  registerWebhookRoutes();
  registerPeladaRoutes();
  ready = true;
}

export default async function handler(req, res) {
  init();
  return dispatch(req, res);
}
