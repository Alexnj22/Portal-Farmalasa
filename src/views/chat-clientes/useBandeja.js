// La bandeja del chat vive en el núcleo (`hooks/useBandejaDelChat`): la usan
// el portal y la app. Este archivo sólo la reexporta.
export { POR_PAGINA, useBandejaDelChat, useEquipoDelChat } from '@nucleo/hooks/useBandejaDelChat';
