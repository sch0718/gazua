import { handle, type ProxyEnv } from './handler.js';

export default {
  fetch: (req: Request, env: ProxyEnv): Promise<Response> => handle(req, env),
};
