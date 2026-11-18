import { createContext } from 'react';

/**
 * «Sólo el modal» (2026-11-18, kiosco de caja): dentro de este proveedor, un
 * `LanzadorSolicitud` no pinta su baldosa — abre su modal al montarse y avisa
 * al cerrarlo (`onCerrar`). Así el kiosco ofrece los trámites de Operación como
 * botones propios y abre EXACTAMENTE el mismo modal, sin copiar ningún
 * formulario ni tocar las baldosas.
 */
export const SoloModalCtx = createContext(null);
