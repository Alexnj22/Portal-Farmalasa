// El papel de un conteo en HTML, para el teléfono (`expo-print` → AirPrint o
// compartir PDF): la hoja para contar (ciega si el conteo lo es), el reporte
// de resultados y la hoja de ajuste partida en faltantes y sobrantes. El
// contenido sale de `conteoPapel` —el mismo del PDF del portal—; cambia la
// letra, no los números. Papel: sólo negro, sin fondos.
import { fechaTexto } from './fecha';
import { formatMoney } from './formatNumber';
import {
    FUENTE_LABEL, SCOPE_LABEL, avisoDeConteoParcial, esAjuste, esSimple, ordenarParaDigitar, ordenarRenglonesDeConteo,
    totalesDelConteo, valorAjuste,
} from './conteoPapel';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n = (v) => (v === null || v === undefined ? '—' : String(v));

const ESTILO = `<style>
@page { margin: 24pt; }
body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: black; font-size: 8.5pt; }
.cab { display: flex; justify-content: space-between; border-bottom: 1.5pt solid black; padding-bottom: 4pt; margin-bottom: 6pt; }
.der { text-align: right; } h1 { font-size: 12pt; margin: 0; } h2 { font-size: 10pt; margin: 10pt 0 4pt; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 7.5pt; border-bottom: 1pt solid black; padding: 2pt; }
td { border-bottom: 0.5pt solid black; padding: 3pt 2pt; vertical-align: top; }
td.n { text-align: right; font-variant-numeric: tabular-nums; } td.caja { width: 40pt; }
.lab { font-weight: 700; padding-top: 6pt; border-bottom: 1pt solid black; }
.rx { font-size: 6pt; border: 0.75pt solid black; padding: 0 2pt; } .nota { margin-top: 6pt; font-weight: 700; }
.pie { margin-top: 18pt; display: flex; gap: 40pt; } .pie div { flex: 1; border-top: 1pt solid black; padding-top: 3pt; font-size: 8pt; }
</style>`;

function cabecera(conteo, subtitulo) {
    return `<div class="cab"><div><h1>CONTEO DE INVENTARIO</h1><div>${esc(subtitulo)}</div></div>
<div class="der"><b>${esc(conteo?.branches?.name || 'Sucursal')}</b><br/>Alcance: ${esc(SCOPE_LABEL[conteo?.scope_type] || conteo?.scope_type || '')}
${esSimple(conteo) ? '<br/>Detalle: solo cantidades' : ''}${FUENTE_LABEL[conteo?.fuente_sistema] ? `<br/>${esc(FUENTE_LABEL[conteo.fuente_sistema])}` : ''}
<br/>${esc(fechaTexto(conteo?.created_at, { day: '2-digit', month: 'long', year: 'numeric' }))}</div></div>`;
}

const producto = (i) => `${esc(i.product_nombre)}${i.es_antibiotico ? ' <span class="rx">BAJO RECETA</span>' : ''}`;
const vence = (i) => (i.fecha_vencimiento ? esc(fechaTexto(i.fecha_vencimiento, { month: 'short', year: '2-digit' })) : '—');

/** La hoja para contar a mano: con «Sistema» sólo si el conteo no es ciego. */
export function hojaDeConteoHtml(conteo, items = [], { ciego = false } = {}) {
    const simple = esSimple(conteo);
    const cols = simple
        ? ['Producto', 'Presentación', ...(ciego ? [] : ['Sistema']), 'Físico', 'Nota']
        : ['Producto', 'Lote', 'Vence', ...(ciego ? [] : ['Sistema']), 'Físico', 'Nota'];
    let lab = null;
    const filas = ordenarRenglonesDeConteo(items).map(i => {
        const banda = i.laboratorio_nombre !== lab ? `<tr><td class="lab" colspan="${cols.length}">${esc((lab = i.laboratorio_nombre) || 'Sin laboratorio')}</td></tr>` : '';
        const celdas = simple
            ? [producto(i), esc(i.presentacion || '—')]
            : [producto(i), esc(i.lote || '—'), vence(i)];
        if (!ciego) celdas.push(`<span>${n(i.sistema_cantidad)}</span>`);
        return `${banda}<tr>${celdas.map((c, k) => `<td${k === celdas.length - 1 && !ciego ? ' class="n"' : ''}>${c}</td>`).join('')}<td class="caja"></td><td class="caja"></td></tr>`;
    }).join('');
    return `<!doctype html><html><head><meta charset="utf-8"/>${ESTILO}</head><body>${cabecera(conteo, ciego ? 'Hoja para contar (sin existencia del sistema)' : 'Hoja para contar')}
<table><thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${filas}</tbody></table>
<div class="pie"><div>Contó</div><div>Revisó</div></div></body></html>`;
}

/** El reporte de resultados: sistema, físico, diferencia y valor, con los totales. */
export function resultadosDeConteoHtml(conteo, items = []) {
    const simple = esSimple(conteo);
    const t = totalesDelConteo(items);
    const filas = ordenarRenglonesDeConteo(items).map(i => `<tr><td>${producto(i)}</td><td>${esc(simple ? (i.presentacion || '—') : (i.lote || '—'))}</td>
<td class="n">${n(i.sistema_cantidad)}</td><td class="n">${i.estado_item === 'PENDIENTE' ? 'sin contar' : n(i.fisico_cantidad)}</td>
<td class="n">${n(i.diferencia)}</td><td class="n">${valorAjuste(i) != null && i.diferencia ? esc(formatMoney(valorAjuste(i))) : ''}</td><td>${esc(i.nota || '')}</td></tr>`).join('');
    const aviso = avisoDeConteoParcial(conteo);
    return `<!doctype html><html><head><meta charset="utf-8"/>${ESTILO}</head><body>${cabecera(conteo, 'Resultados del conteo')}
<table><thead><tr><th>Producto</th><th>${simple ? 'Presentación' : 'Lote'}</th><th>Sistema</th><th>Físico</th><th>Dif.</th><th>Valor</th><th>Nota</th></tr></thead><tbody>${filas}</tbody></table>
<p class="nota">${t.items} ítems · ${t.conDiferencia} con diferencia · ${t.noUbicados} no ubicados · ${t.sinContar} sin contar${conteo?.valor_faltante != null ? ` · Faltante ${esc(formatMoney(conteo.valor_faltante))} · Sobrante ${esc(formatMoney(conteo.valor_sobrante))}` : ''}</p>
${aviso ? `<p class="nota">${esc(aviso)}</p>` : ''}<div class="pie"><div>Contó</div><div>Aprobó</div></div></body></html>`;
}

/** La hoja de ajuste: faltantes y sobrantes por separado, por código. */
export function ajusteDeConteoHtml(conteo, items = []) {
    const simple = esSimple(conteo);
    const ajustes = ordenarParaDigitar(items.filter(esAjuste));
    const seccion = (titulo, lista) => (lista.length ? `<h2>${titulo} · ${lista.length}</h2><table><thead><tr><th>Código</th><th>Producto</th><th>Presentación</th>
${simple ? '' : '<th>Lote</th><th>Vence</th>'}<th>Sistema</th><th>Físico</th><th>Ajuste</th><th>Valor</th></tr></thead><tbody>
${lista.map(i => `<tr><td>${esc(i.erp_product_id)}</td><td>${producto(i)}</td><td>${esc(i.presentacion || '—')}${i.is_vencidos ? ' · ÁREA VENCIDOS' : ''}${i.es_agregado_manual ? (simple ? ' · ALTA' : ' · ALTA DE LOTE') : ''}</td>
${simple ? '' : `<td>${esc(i.lote || '—')}</td><td>${vence(i)}</td>`}<td class="n">${n(i.sistema_cantidad)}</td><td class="n">${n(i.fisico_cantidad)}</td><td class="n"><b>${n(i.diferencia)}</b></td>
<td class="n">${valorAjuste(i) != null ? esc(formatMoney(valorAjuste(i))) : ''}</td></tr>`).join('')}</tbody></table>` : '');
    const cuerpo = ajustes.length
        ? seccion('FALTANTES (salida)', ajustes.filter(i => i.diferencia < 0)) + seccion('SOBRANTES (entrada)', ajustes.filter(i => i.diferencia > 0))
        : '<p class="nota">Este conteo no arrojó diferencias: no hay ajuste que aplicar.</p>';
    return `<!doctype html><html><head><meta charset="utf-8"/>${ESTILO}</head><body><div class="cab"><div><h1>AJUSTE DE INVENTARIO</h1><div>Documento para aplicar en el sistema — el portal no modifica existencias</div></div>
<div class="der"><b>${esc(conteo?.branches?.name || 'Sucursal')}</b></div></div>${cuerpo}<div class="pie"><div>Aplicó</div><div>Revisó</div></div></body></html>`;
}
