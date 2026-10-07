export class HttpError extends Error {
  constructor(status, message, code, extra) {
    super(message);
    this.status = status;
    this.code = code || null;
    this.extra = extra || null;
  }
}
export const badRequest = (m, code, extra) => new HttpError(400, m, code, extra);
export const unauthorized = (m = 'Faça login para continuar.') => new HttpError(401, m, 'UNAUTHENTICATED');
export const forbidden = (m = 'Você não tem permissão para isso.') => new HttpError(403, m, 'FORBIDDEN');
export const notFound = (m = 'Não encontrado.') => new HttpError(404, m, 'NOT_FOUND');
export const conflict = (m, code, extra) => new HttpError(409, m, code, extra);
export const tooMany = (m = 'Muitas tentativas. Aguarde um instante e tente de novo.') => new HttpError(429, m, 'RATE_LIMIT');
