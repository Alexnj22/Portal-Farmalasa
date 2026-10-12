// El papel del pedido en el teléfono: el MISMO PDF que sale en la computadora
// de Bodega (la definición es de `@nucleo/utils/pedidoPdfDoc` y la imprenta es
// pdfmake dentro de `motorPedido`). Dos papeles:
//   · al GENERAR: un PDF por sala, con lo asignado (`printPerSucursal` del
//     portal);
//   · la hoja de despacho de UNA sala, reimpresa (`printFromPedidoItems`): si
//     la sala ya despachó, dice lo que SALIÓ.
// Después de armarlos se pregunta UNA vez qué hacer (`ofrecerArchivosPdf`).
import { seccionDePedido } from '@nucleo/utils/papelDePedido';
import { seccionDeGenerar } from '@nucleo/utils/pedidoPdfDoc';
import { tieneEtiquetaDeDespacho } from '@nucleo/data/pedidos';
import { registrarEgreso } from '@nucleo/data/egreso';
import { pdfDelPedido } from './motorPedido';
import { ofrecerArchivosPdf } from '../pdf';

// Nombre del archivo igual que en el portal: `printFromPedidoItems` limpia el
// título a [a-zA-Z0-9_-]; `printPerSucursal` usa el código de la sala.
const comoArchivo = (t) => String(t).replace(/[^a-zA-Z0-9_-]/g, '_');

/** Los PDF de un pedido recién generado: uno por sala. */
export async function papelesAlGenerar(gen, meta = {}) {
    const archivos = [];
    for (const sid of gen.sucIds) {
        const { section, filename } = seccionDeGenerar(gen.map, sid, (r) => r.cantidad_asignada, gen.codigoFn ? gen.codigoFn(sid) : null);
        const nombre = filename.replace(/\.pdf$/i, '');
        const uri = await pdfDelPedido({ sections: [section], title: section.codigo ?? section.nombre, meta, nombre });
        archivos.push({ uri, nombre, filas: section.rows.length });
    }
    return archivos;
}

/** La hoja de despacho de una sala, como la reimprime el portal. */
export async function papelDeLaSala({ numero, sucId, rows, codigo, finalizada }) {
    const conEtiqueta = (rows ?? []).map((r) => ({ ...r, tiene_dispatch_label: r.tiene_dispatch_label ?? tieneEtiquetaDeDespacho(r) }));
    const title = codigo ?? `${numero}`;
    const meta = finalizada ? { cantidad: 'enviada' } : {};
    const section = seccionDePedido(Number(sucId), conEtiqueta, title, { cantidad: meta.cantidad });
    const nombre = comoArchivo(title);
    const uri = await pdfDelPedido({ sections: [section], title, meta, nombre });
    return { uri, nombre, filas: section.rows.length };
}

/**
 * La única pregunta: imprimir, compartir o guardar. Lo que sale del teléfono
 * se anota como egreso de datos (`pedidos`), igual que en el portal.
 */
export function ofrecerPapelesDelPedido({ archivos, titulo, mensaje, pedidoId, sucId, nombreZip, alFallar }) {
    ofrecerArchivosPdf({
        archivos, titulo, mensaje, nombreZip, alFallar,
        alTerminar: (accion) => {
            if (accion === 'imprimir') return;
            registrarEgreso('pedidos', {
                formato: 'pdf',
                filas: archivos.reduce((n, a) => n + (a.filas ?? 0), 0),
                detalle: { pedido_id: pedidoId, sucursal_id: sucId ?? null, accion, desde: 'app' },
            });
        },
    });
}
