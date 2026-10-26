/**
 * Métricas do eval. A detecção de alucinação compara entidades factuais da
 * resposta (datas, valores, códigos, protocolos, números de pedido) com o que
 * as tools retornaram e o que o próprio cliente disse. Entidade sem fonte = alucinação.
 */

export interface Esperado {
  /** Tools que precisam ter sido chamadas (qualquer ordem). */
  tools?: string[];
  /** Tools que não podem ter sido chamadas. */
  naoChamar?: string[];
  /** Se o caso deve terminar em escalada/chamado. */
  escalar?: boolean;
  /** Trechos que a resposta final deve conter (case-insensitive). */
  deveConter?: string[];
  /** Trechos proibidos na resposta final (ex.: dados de outro cliente). */
  naoDeveConter?: string[];
  /** Padrões (regex, case-sensitive) proibidos na resposta final, ex.: código de rastreio inventado. */
  naoDeveCasar?: string[];
}

export interface Execucao {
  toolsChamadas: string[];
  /** Tools que efetivamente executaram (tool_result ok). */
  toolsExecutadas: string[];
  /** JSON dos resultados de tool + mensagens do cliente: as fontes permitidas. */
  fontes: string[];
  respostas: string[];
  motivosParada: string[];
}

export interface ResultadoCaso {
  toolCorreta: boolean;
  entidades: string[];
  alucinadas: string[];
  escaladaCorreta: boolean | null;
  conteudoOk: boolean;
  aprovado: boolean;
}

const MESES: Record<string, string> = {
  janeiro: '01', fevereiro: '02', março: '03', marco: '03', abril: '04', maio: '05', junho: '06',
  julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12',
};

/** Entidades factuais normalizadas: `data:mm-dd`, `valor:19990`, `codigo:BR123`, `protocolo:CH-...`, `pedido:1001`. */
export function extrairEntidades(texto: string): string[] {
  const out = new Set<string>();
  for (const m of texto.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.add(`data:${m[2]}-${m[3]}`);
  for (const m of texto.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    out.add(`data:${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`);
  }
  for (const m of texto.matchAll(/\b(\d{1,2})º? de (\p{L}+)/giu)) {
    const mes = MESES[m[2]!.toLowerCase()];
    if (mes) out.add(`data:${mes}-${m[1]!.padStart(2, '0')}`);
  }
  for (const m of texto.matchAll(/R\$\s?([\d.]+),(\d{2})/g)) {
    out.add(`valor:${Number(m[1]!.replaceAll('.', '') + m[2])}`);
  }
  for (const m of texto.matchAll(/\b[A-Z]{2}\d{9}[A-Z]{0,2}\b/g)) out.add(`codigo:${m[0]}`);
  for (const m of texto.matchAll(/\bCH-\d{8}-\d{4}\b/g)) out.add(`protocolo:${m[0]}`);
  for (const m of texto.matchAll(/\bpedido(?: n[ºo°.]*)?\s*#?(\d{4})\b/gi)) out.add(`pedido:${m[1]}`);
  for (const m of texto.matchAll(/\b(\d{1,3}) dias\b/g)) out.add(`dias:${m[1]}`);
  return [...out];
}

/** Uma entidade tem fonte se aparece (normalizada) em algum resultado de tool ou mensagem do cliente. */
export function temFonte(entidade: string, fontes: string[]): boolean {
  const [tipo, valor] = entidade.split(/:(.*)/s) as [string, string];
  const texto = fontes.join('\n');
  switch (tipo) {
    case 'data':
      return texto.includes(`-${valor}`) || extrairEntidades(texto).includes(entidade);
    case 'valor':
      return new RegExp(`\\b${valor}\\b`).test(texto) || extrairEntidades(texto).includes(entidade);
    case 'dias':
      // prazos da política e dias desde a entrega chegam como números nos JSONs
      return new RegExp(`:${valor}\\b`).test(texto) || new RegExp(`\\b${valor} dias\\b`).test(texto);
    default:
      return texto.includes(valor);
  }
}

export function avaliarCaso(esperado: Esperado, exec: Execucao): ResultadoCaso {
  const chamadas = new Set(exec.toolsChamadas);
  const toolCorreta =
    (esperado.tools ?? []).every((t) => chamadas.has(t)) && (esperado.naoChamar ?? []).every((t) => !chamadas.has(t));

  const entidades = [...new Set(exec.respostas.flatMap(extrairEntidades))];
  const alucinadas = entidades.filter((e) => !temFonte(e, exec.fontes));

  const escalou = exec.motivosParada.includes('escalada') || exec.toolsExecutadas.includes('abrir_chamado');
  const escaladaCorreta = esperado.escalar === undefined ? null : escalou === esperado.escalar;

  const final = exec.respostas.join('\n').toLowerCase();
  const conteudoOk =
    (esperado.deveConter ?? []).every((s) => final.includes(s.toLowerCase())) &&
    (esperado.naoDeveConter ?? []).every((s) => !final.includes(s.toLowerCase())) &&
    (esperado.naoDeveCasar ?? []).every((p) => !new RegExp(p).test(exec.respostas.join('\n')));

  return {
    toolCorreta,
    entidades,
    alucinadas,
    escaladaCorreta,
    conteudoOk,
    aprovado: toolCorreta && alucinadas.length === 0 && escaladaCorreta !== false && conteudoOk,
  };
}

export interface Resumo {
  casos: number;
  aprovados: number;
  acertoTool: number;
  /** % de casos com pelo menos uma entidade sem fonte. */
  taxaAlucinacao: number;
  entidadesVerificadas: number;
  entidadesAlucinadas: number;
  acertoEscalada: number | null;
  custoTotalCents: number;
}

export function resumir(resultados: (ResultadoCaso & { custoCents: number })[]): Resumo {
  const n = resultados.length;
  const pct = (k: number, d = n) => (d === 0 ? 0 : Math.round((k / d) * 1000) / 10);
  const comEscalada = resultados.filter((r) => r.escaladaCorreta !== null);
  return {
    casos: n,
    aprovados: resultados.filter((r) => r.aprovado).length,
    acertoTool: pct(resultados.filter((r) => r.toolCorreta).length),
    taxaAlucinacao: pct(resultados.filter((r) => r.alucinadas.length > 0).length),
    entidadesVerificadas: resultados.reduce((s, r) => s + r.entidades.length, 0),
    entidadesAlucinadas: resultados.reduce((s, r) => s + r.alucinadas.length, 0),
    acertoEscalada: comEscalada.length
      ? pct(comEscalada.filter((r) => r.escaladaCorreta).length, comEscalada.length)
      : null,
    custoTotalCents: Math.round(resultados.reduce((s, r) => s + r.custoCents, 0) * 100) / 100,
  };
}
