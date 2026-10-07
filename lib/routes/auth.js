import { route } from '../router.js';
import { badRequest, unauthorized } from '../../public/assets/js/shared/errors.js';
import { hashPassword, verifyPassword, randomId } from '../auth.js';
import { createUser, getUserByEmail, rateLimit, rateLimitPeek, rateLimitReset } from '../repo.js';
import { validEmail, normEmail } from '../../public/assets/js/shared/validators.js';
import { clientIp } from '../http.js';
import { cleanText } from '../../public/assets/js/shared/domain/tournament.js';

export const userView = u => u ? { id: u.id, name: u.name, email: u.email } : null;

// hash falso para igualar o tempo de resposta quando o e-mail não existe
const DUMMY = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA$' + 'A'.repeat(86);

export function registerAuthRoutes() {
  route('POST', '/auth/signup', async ctx => {
    const { body } = ctx;
    await rateLimit(ctx.store, `signup:${clientIp(ctx.req)}`, { max: 20, windowMs: 3600_000 });
    const name = cleanText(body.name, 60, { min: 2, field: 'Nome' });
    const email = normEmail(body.email);
    if (!validEmail(email)) throw badRequest('Informe um e-mail válido.', 'VALIDATION', { field: 'email' });
    const password = String(body.password ?? '');
    if (password.length < 8) throw badRequest('A senha precisa ter ao menos 8 caracteres.', 'VALIDATION', { field: 'password' });
    if (password.length > 200) throw badRequest('Senha muito longa.', 'VALIDATION', { field: 'password' });
    const user = await createUser(ctx.store, { id: randomId('usr_'), name, email, passHash: await hashPassword(password), createdAt: ctx.now });
    await ctx.startSession(user);
    return { user: userView(user) };
  });

  route('POST', '/auth/login', async ctx => {
    const email = normEmail(ctx.body.email);
    const password = String(ctx.body.password ?? '');
    if (!validEmail(email) || !password) throw badRequest('Informe e-mail e senha.', 'VALIDATION');
    const rlKey = `login:${email}:${clientIp(ctx.req)}`;
    await rateLimitPeek(ctx.store, rlKey, { max: 8 });
    const user = await getUserByEmail(ctx.store, email);
    const ok = await verifyPassword(password, user ? user.passHash : DUMMY);
    if (!user || !ok) {
      await rateLimit(ctx.store, rlKey, { max: 8, windowMs: 10 * 60_000 });
      throw unauthorized('E-mail ou senha incorretos.');
    }
    await rateLimitReset(ctx.store, rlKey);
    await ctx.startSession(user);
    return { user: userView(user) };
  });

  route('POST', '/auth/logout', async ctx => { ctx.endSession(); return { ok: true }; });
  route('GET', '/auth/me', async ctx => ({ user: userView(await ctx.user()) }));
}
