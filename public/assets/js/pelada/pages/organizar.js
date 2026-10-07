// Destino do botão "Organize a pelada": sem conta → autenticação rápida; com conta → Dashboard.
import { S } from '../session.js';
import { navigate } from '../../router.js';

export default function () {
  if (S.player) navigate('/pelada/painel', { replace: true });
  else navigate('/pelada/entrar?next=' + encodeURIComponent('/pelada/painel'), { replace: true });
}
