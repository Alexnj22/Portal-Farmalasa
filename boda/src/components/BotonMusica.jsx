import { t } from '../lib/idioma';
import { alternarMusica, hayMusica, useMusica } from '../lib/sonido';

/** ♪ en la cabecera: aparece en cuanto la música empezó y sirve para callarla (o volver a ponerla). */
export default function BotonMusica() {
  const { sonando, iniciada } = useMusica();
  if (!hayMusica() || !iniciada) return null;
  return (
    <button type="button" className={`btn claro chico boton-musica ${sonando ? 'sonando' : ''}`} aria-pressed={sonando} onClick={alternarMusica}
      aria-label={sonando ? t('Apagar música', 'Mute music') : t('Encender música', 'Play music')}>
      <span aria-hidden>♪</span>
    </button>
  );
}
