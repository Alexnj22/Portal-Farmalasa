// La orden de despacho de una sala en HTML, para reimprimirla desde el
// teléfono (`expo-print` → AirPrint o la hoja de compartir).
//
// El contenido es el de `papelDePedido` —el mismo del PDF del portal—, y las
// hojas son las GUARDADAS del pedido: cada hoja empieza en una página nueva y
// lleva su número, así lo que la sala recibe por hoja y por caja coincide con
// este papel aunque la letra sea otra. Sin hojas guardadas se imprime corrido y
// se dice.
//
// Papel: sólo negro, sin fondos rellenos (la regla de toda impresión del
// portal).
import { fechaTexto } from './fecha';
import { hora12Papel } from './hora';
import { renglonesPorHoja } from './papelDePedido';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function vence(iso) {
    if (!iso) return null;
    const [y, m] = String(iso).slice(0, 10).split('-').map(Number);
    if (!y || !m) return null;
    return fechaTexto(new Date(y, m - 1, 1), { month: 'short', year: '2-digit' });
}

function lotes(ls = []) {
    if (!ls.length) return '—';
    return ls.map(l => [l.lote ? `Lote ${esc(l.lote)}` : null, vence(l.fecha_vencimiento), String(l.take ?? l.cantidad ?? l.packs ?? '?')]
        .filter(Boolean).join(' · ')).join('<br/>');
}

function tabla(rows) {
    return `<table><thead><tr><th style="width:16%">Laboratorio</th><th style="width:33%">Producto</th><th style="width:13%">Presentación</th>
<th style="width:8%">Cant.</th><th style="width:25%">Lote</th><th style="width:5%">OK</th></tr></thead><tbody>
${rows.map(r => `<tr><td>${esc(r.laboratorio || '—')}</td><td>${esc(r.product_name)}${r.es_antibiotico ? ' <b class="rx">BAJO RECETA</b>' : ''}</td>
<td>${esc(r.presentacion_tipo || '—')}</td><td class="n">${r.qty}${r.qty_base ? `<br/><small>(${r.qty_base} und.)</small>` : ''}</td>
<td class="l">${lotes(r.lotes)}</td><td class="ok">☐</td></tr>`).join('')}
</tbody></table>`;
}

/**
 * @param {object} seccion   `seccionDePedido(...)`
 * @param {object} meta      { numero, codigo, paginas, cajaMap }
 */
export function papelDePedidoHtml(seccion, { numero = null, codigo = null, paginas = null, cajaMap = null } = {}) {
    const ahora = new Date();
    const hojas = renglonesPorHoja(seccion, paginas);
    const conHojas = Array.isArray(paginas) && paginas.length > 0;
    // En qué caja va cada hoja, si el pedido ya se finalizó.
    const cajaDe = (n) => Object.entries(cajaMap ?? {}).filter(([, hs]) => (hs ?? []).includes(n)).map(([c]) => c);
    const cabecera = (i) => `<div class="cab"><div><b>ORDEN DE DESPACHO</b> · ${esc(seccion.nombre)}</div>
<div>${esc(codigo ?? seccion.codigo ?? (numero ? `Pedido #${numero}` : ''))} · ${esc(fechaTexto(ahora, { day: '2-digit', month: 'long', year: 'numeric' }))}, ${esc(hora12Papel(ahora))}</div>
${conHojas ? `<div class="hoja">Hoja ${i + 1} de ${hojas.length}${cajaDe(i + 1).length ? ` · Caja ${cajaDe(i + 1).join(', ')}` : ''}</div>` : ''}</div>`;
    const cuerpo = hojas.map((h, i) => `<section${i ? ' class="salto"' : ''}>${cabecera(i)}${tabla(h)}</section>`).join('');
    const especiales = seccion.especiales?.length ? `<section class="salto">${cabecera(hojas.length - 1).replace(/<div class="hoja">[\s\S]*?<\/div>/, '')}
<h3>Cajas adicionales</h3><table><thead><tr><th>Caja</th><th>Producto</th><th>Presentación</th><th>Lote</th><th>OK</th></tr></thead><tbody>
${seccion.especiales.map(e => `<tr><td class="n">${esc(e.label)}</td><td>${esc(e.product_name)}</td><td>${esc(e.presentacion_tipo || '—')}</td><td class="l">${lotes(e.lotes)}</td><td class="ok">☐</td></tr>`).join('')}
</tbody></table></section>` : '';
    const notas = [
        !conHojas ? 'Este pedido todavía no tiene sus hojas guardadas: el papel sale corrido.' : null,
        seccion.sinCount ? `${seccion.sinCount} producto${seccion.sinCount === 1 ? '' : 's'} sin existencia en bodega (no van).` : null,
    ].filter(Boolean);
    return `<!doctype html><html><head><meta charset="utf-8"/><style>
@page { margin: 22pt 24pt 44pt 24pt; }
body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: black; font-size: 9pt; }
.cab { border-bottom: 1.5pt solid black; padding-bottom: 4pt; margin-bottom: 6pt; }
.cab div { margin: 1pt 0; } .hoja { font-weight: 700; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 7.5pt; border-bottom: 1pt solid black; padding: 3pt 2pt; }
td { border-bottom: 0.5pt solid black; padding: 3pt 2pt; vertical-align: middle; }
td.n { text-align: center; font-weight: 700; font-size: 10pt; } td.l { font-size: 7.5pt; } td.ok { text-align: center; font-size: 11pt; }
.rx { font-size: 6pt; border: 0.75pt solid black; padding: 0 2pt; }
.salto { page-break-before: always; } h3 { font-size: 10pt; margin: 6pt 0; }
.pie { margin-top: 18pt; display: flex; gap: 40pt; } .pie div { flex: 1; border-top: 1pt solid black; padding-top: 3pt; font-size: 8pt; }
.nota { font-size: 8pt; margin-top: 6pt; }
</style></head><body>${cuerpo}${especiales}
${notas.map(n => `<p class="nota">${esc(n)}</p>`).join('')}
<div class="pie"><div>Revisado por</div><div>Recibido por</div></div>
</body></html>`;
}
