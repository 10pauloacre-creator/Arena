// Flexão de gênero dos textos do Pelada: numa pelada feminina tudo fica no feminino ("jogadora", "ela", "dela", "convidada"…).
// Uso: const G = gx(pelada.gender);  `${G.player}`, `${G.o} ${G.owner}`, `${G.guests}`…  (gênero desconhecido = masculino).

const FORMS = {
  // chave: [masculino, feminino]
  player: ['jogador', 'jogadora'], players: ['jogadores', 'jogadoras'],
  guest: ['convidado', 'convidada'], guests: ['convidados', 'convidadas'],
  owner: ['organizador', 'organizadora'], scorer: ['artilheiro', 'artilheira'], scorers: ['artilheiros', 'artilheiras'],
  captain: ['capitão', 'capitã'],
  confirmed: ['confirmado', 'confirmada'], confirmeds: ['confirmados', 'confirmadas'],
  first: ['primeiro', 'primeira'], newOne: ['novo', 'nova'], excluded: ['excluído', 'excluída'], removed: ['removido', 'removida'],
  replaced: ['substituído', 'substituída'], selected: ['escolhido', 'escolhida'], all: ['todos', 'todas'], alone: ['sozinho', 'sozinha'],
  esse: ['esse', 'essa'], este: ['este', 'esta'], o: ['o', 'a'], os: ['os', 'as'], um: ['um', 'uma'], uns: ['uns', 'umas'], do: ['do', 'da'], dos: ['dos', 'das'],
  no: ['no', 'na'], nos: ['nos', 'nas'], ao: ['ao', 'à'], aos: ['aos', 'às'], pelo: ['pelo', 'pela'],
  ele: ['ele', 'ela'], eles: ['eles', 'elas'], dele: ['dele', 'dela'], deles: ['deles', 'delas'], seu: ['seu', 'sua'], seus: ['seus', 'suas'],
};

const cache = {};
/** Formas no gênero da pelada ('feminino' | 'masculino'). */
export function gx(gender) {
  const i = gender === 'feminino' ? 1 : 0;
  return cache[i] ||= Object.fromEntries(Object.entries(FORMS).map(([k, v]) => [k, v[i]]));
}
export const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
