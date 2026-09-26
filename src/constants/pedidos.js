// Catálogos de Pedidos que usa la lógica (`hooks/usePedidosData`) y que la app
// nativa va a necesitar tal cual. Antes vivían en `views/pedidos/tabpedidos/
// constants.js` junto a los estilos de la pantalla, y traían adentro los
// componentes de `lucide-react`: una app nativa no puede importar eso. Acá va
// el NOMBRE del ícono; la pantalla lo dibuja con `IconoPorNombre`.

/** Motivos de pausa de la preparación. `maxUses: 1` = una vez por pedido. */
export const PAUSE_REASONS = [
    { key: 'almuerzo',     label: 'Almuerzo',             icono: 'Coffee',        maxUses: 1    },
    { key: 'insumos',      label: 'Espera de insumos',    icono: 'Clock',         maxUses: null },
    { key: 'reunion',      label: 'Reunión de turno',     icono: 'ClipboardList', maxUses: null },
    { key: 'interrupcion', label: 'Interrupción externa', icono: 'Bell',          maxUses: null },
    { key: 'otro',         label: 'Otro…',                icono: 'MessageSquare', maxUses: null, requiresComment: true },
];
