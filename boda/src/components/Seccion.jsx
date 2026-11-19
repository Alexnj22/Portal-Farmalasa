import { romano } from '../lib/romanos';

/** El último término del título va en cursiva: «Nuestra *historia*». */
export function Titulo({ texto, as: Tag = 'h2', ...resto }) {
  if (typeof texto !== 'string') return <Tag {...resto}>{texto}</Tag>;
  const i = texto.lastIndexOf(' ');
  return i > 0 ? <Tag {...resto}>{texto.slice(0, i)} <em>{texto.slice(i + 1)}</em></Tag> : <Tag {...resto}>{texto}</Tag>;
}

/**
 * Rótulo de capítulo: numeral romano (si lo hay), un filete champán fino y el
 * texto en versalitas. «I —— Capítulo · 2018».
 */
export function Capitulo({ numero, texto, as: Tag = 'p' }) {
  return (
    <Tag className="capitulo">
      {numero ? <span className="romano" aria-hidden>{romano(numero)}</span> : null}
      <span className="filete" aria-hidden />
      <span>{texto}</span>
    </Tag>
  );
}
