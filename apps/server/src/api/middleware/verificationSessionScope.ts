import express from 'express';

/** Use Express matching for the only operations a restricted session may reach. */
export function createVerificationSessionScope(): express.RequestHandler {
  const routes = express.Router();
  const allow: express.RequestHandler = (_req, _res, next) => next('router');
  routes.post(['/auth/login', '/auth/logout', '/auth/verify/request', '/auth/verify', '/invites/accept'], allow);
  routes.get(['/auth/me', '/auth/verify/status'], allow);
  routes.use((_req, res) => {
    res.status(403).json({ code: 'EMAIL_VERIFICATION_REQUIRED',
      error: 'Confirm your email address and sign in before using this resource.' });
  });
  return routes;
}
