import { t, useIdioma } from '../../lib/idioma';
import { PaginaApp } from '../../components/AppMarco';
import LibroFirmas from '../LibroFirmas';

export default function Mensajes() {
  useIdioma();
  return (
    <PaginaApp titulo={<>{t('Libro de', 'Guest')} <em>{t('firmas', 'book')}</em></>} bajada={t('Déjanos unas palabras, escritas o con tu voz. Las vamos a leer muchas veces.', "Leave us a few words, written or in your voice. We'll read them again and again.")}>
      <LibroFirmas />
    </PaginaApp>
  );
}
