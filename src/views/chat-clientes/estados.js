// Las reglas de estado del chat viven en el núcleo (`utils/chatClientes`), que
// comparten el portal y la app. Este archivo sólo las reexporta.
export { ESTADOS, FILTROS, esperaDe, estadoDeConversacion, estadoServidor } from '@nucleo/utils/chatClientes';
