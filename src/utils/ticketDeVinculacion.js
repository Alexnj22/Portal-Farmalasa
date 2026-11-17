// El ticket que vincula un kiosco (2026-11-17, pedido del usuario).
//
// Lo manda el supervisor a la ticketera de la sucursal; el equipo lo escanea
// sin sesión y queda vinculado (`kiosco_vincular_con_ticket`). El código sirve
// UNA vez y vence a los 15 minutos, así que sí va escrito: si el lector no lo
// toma, nadie lo puede teclear igual (el kiosco sólo acepta velocidad de
// escáner), pero sirve para saber de cuál papel se trata.
import { fechaHora, limpiarValorDeBarras } from './ticketPrint';
import { hora12 } from './hora';
import { rotuloDeKiosco } from './kioscos';

export function construirTicketDeVinculacion({ codigo, tipo, sala = '', nombre = '', venceAt, emitidoPor = '', ahora = new Date() }) {
    return {
        titulo: '',
        encabezado: { titulo: 'VINCULAR EQUIPO', lineas: [rotuloDeKiosco(tipo), sala].filter(Boolean) },
        datos: [
            ...(nombre ? [['Equipo', nombre]] : []),
            ['Vence', venceAt ? hora12(venceAt) : '15 min'],
            ['Impreso', fechaHora(ahora)],
            ...(emitidoPor ? [['Lo envio', emitidoPor]] : []),
        ],
        codigos: [{ valor: limpiarValorDeBarras(codigo), simbologia: 'CODE128' }],
        pie: [
            'Abre /kiosk en el equipo, sin iniciar sesion,',
            'y pasa este papel por el lector.',
            'Sirve una sola vez.',
        ],
    };
}
