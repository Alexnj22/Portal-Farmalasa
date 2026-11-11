import { Link } from 'react-router-dom';
import { boda } from '../../config';
import { t, useIdioma } from '../../lib/idioma';
import { PaginaApp } from '../../components/AppMarco';

/** Los tres juegos, listos para usar. */
export default function Juegos() {
  useIdioma();
  const j = boda.juego || {};
  const juegos = [
    { a: '/juego/trivia', t: t('Trivia en vivo', 'Live trivia'), d: j.titulo, e: t('Con todo el salón, en la pantalla grande', 'With the whole room, on the big screen'), cls: 'j-trivia', sim: '?' },
    { a: '/juego/bingo', t: t('Bingo de la boda', 'Wedding bingo'), d: t('Marca lo que pase en la fiesta y canta ¡bingo!', 'Mark what happens at the party and shout bingo!'), e: t('Juegas solo, cuando quieras', 'Play on your own, anytime'), cls: 'j-bingo', sim: '★' },
    { a: '/juego/retos', t: t('Retos de fotos', 'Photo challenges'), d: t(`${j.retos?.length || 0} fotos para cazar en la noche`, `${j.retos?.length || 0} photos to hunt tonight`), e: t('Cada foto va al álbum de todos', 'Every photo goes to the shared album'), cls: 'j-retos', sim: '◎' },
  ];
  return (
    <PaginaApp titulo={<>{t('Ju', 'Ga')}<em>{t('egos', 'mes')}</em></>} bajada={t('Tres maneras de pasarla bien. Elige una.', 'Three ways to have fun. Pick one.')}>
      <div className="tarjetas-juego">
        {juegos.map((x) => (
          <Link key={x.a} to={x.a} className={`tarjeta-juego ${x.cls}`}>
            <span className="sim-juego" aria-hidden>{x.sim}</span>
            <span className="txt-juego"><b>{x.t}</b><span>{x.d}</span><small>{x.e}</small></span>
            <span className="ir-juego" aria-hidden>{t('Jugar', 'Play')} →</span>
          </Link>
        ))}
      </div>
    </PaginaApp>
  );
}
