// La representación gráfica de un documento de Distribución en HTML, para el
// teléfono: `expo-print` lo convierte en PDF y la hoja de compartir lo reparte.
//
// ── Por qué existe al lado del PDF de `distribucionDocumento.js` ───────────
// El PDF del portal lo arma `pdfmake`, que en la app no está (pesa ~3 MB con
// sus fuentes y la app la declara sólo-web en `metro.config.js`). Esta es la
// MISMA hoja —membrete, emisor, identificación, receptor, renglones, documentos
// relacionados, apéndice y el cierre con sus filas en el orden del formato de
// Hacienda— leída del MISMO `leerDocumento`: lo que dice sale del JSON firmado
// y nunca del pedido ni de la ficha. Si se agrega un campo a uno, va en los dos.
//
// Una diferencia, y es a propósito: sin una librería de QR en el teléfono, la
// casilla del QR lleva el ENLACE de la consulta pública de Hacienda (en el PDF
// se toca y abre la consulta) más el código de generación, que es con lo que
// Hacienda lo consulta a mano. Si la app recibe el QR ya dibujado (`qrSvg`), lo
// pinta.
import { leerDocumento } from './distribucionDocumento';
import { formatMoney } from './formatNumber';

const GRIS = '#5b6770';
const TINTA = '#1c2b33';
const LINEA = '#d5dee2';
const SIN_MARCA = { petroleo: '#33424a', petroleoClaro: '#f1f3f4', naranja: '#9aa5ab', naranjaTexto: '#5b6770' };

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dinero = (n) => formatMoney(Number(n ?? 0));

// Las mismas filas del cierre que el PDF, en el orden del formato de Hacienda.
const FILAS_DEL_CIERRE = [
    ['subTotalVentas', 'Suma total de operaciones'],
    ['descuNoSuj', 'Descuento a ventas no sujetas'],
    ['descuExenta', 'Descuento a ventas exentas'],
    ['descuGravada', 'Descuento a ventas gravadas'],
    ['__iva', 'IVA 13%'],
    ['subTotal', 'Sub-total'],
    ['ivaPerci', 'IVA percibido'],
    ['ivaRete', 'IVA retenido', -1],
    ['montoTotalOperacion', 'Monto total de la operación'],
    ['totalNoGravado', 'Total otros montos no afectos'],
];

const par = (rotulo, valor) => `<div class="par"><b>${esc(rotulo)}</b> ${esc(valor ?? '—')}</div>`;
const apilado = (rotulo, valor) => `<div class="apilado"><b>${esc(rotulo)}</b><span>${esc(valor ?? '—')}</span></div>`;

/**
 * @param {any} dte  la fila de `dist_dte` con su `json`
 * @param {{ marca?: any, qrSvg?: string|null, urlConsulta?: string|null }} [opciones]
 */
export function documentoHtml(dte, { marca = null, qrSvg = null, urlConsulta = null } = {}) {
    const C = marca?.colores ?? SIN_MARCA;
    const d = leerDocumento(dte);
    const res = d.resumen;
    const crudo = d.resumenCrudo;
    const filas = FILAS_DEL_CIERRE.flatMap(([k, rotulo, signo = 1]) => {
        if (k === '__iva') {
            if (res.ivaIncluido) return [];
            const iva = (crudo.tributos ?? []).find(t => t.codigo === '20');
            return crudo.tributos ? [[rotulo, iva?.valor ?? 0]] : [];
        }
        return k in crudo ? [[rotulo, Number(signo) * Number(crudo[k] ?? 0)]] : [];
    });
    const conLotes = d.renglones.some(r => r.lote);
    const sumas = (k) => d.renglones.reduce((t, r) => t + Number(r[k] ?? 0), 0);
    const marcaDeAgua = d.invalidado ? 'DOCUMENTO INVALIDADO' : d.prueba ? 'SIN VALIDEZ FISCAL' : null;
    const url = urlConsulta ?? d.qr;
    const cabecera = ['N°', 'Código', 'Cant.', 'Unidad', 'Descripción', ...(conLotes ? ['Lote', 'Vence'] : []), 'Precio unit.', 'Desc.', 'No sujetas', 'Exentas', 'Gravadas'];
    const primeraNumerica = conLotes ? 7 : 5;

    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(`${d.nombre} ${d.numeroControl}`)}</title>
<style>
  @page { size: letter; margin: 0.5in 0.5in 0.6in; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: ${TINTA}; font-size: 8pt; margin: 0; }
  .agua { position: fixed; top: 42%; left: 0; right: 0; text-align: center; font-size: 54pt; font-weight: 800; transform: rotate(-30deg);
          color: ${d.invalidado ? '#b91c1c' : '#999999'}; opacity: 0.12; pointer-events: none; }
  .membrete { display: flex; align-items: center; gap: 10px; }
  .membrete .nombre { flex: 1; }
  .membrete .nombre h1 { margin: 0; font-size: ${marca ? 21 : 15}pt; color: ${C.petroleo}; line-height: 0.95; }
  .membrete .nombre small { display: block; margin-top: 3px; font-size: 7pt; font-weight: 700; letter-spacing: 2.4px; color: ${C.naranjaTexto}; }
  .tipo { width: 210pt; background: ${C.petroleo}; color: #fff; text-align: center; padding: 7pt 10pt; }
  .tipo small { display: block; font-size: 6.5pt; font-weight: 700; color: #cfe8ec; letter-spacing: 0.8px; }
  .tipo strong { display: block; font-size: 11pt; margin-top: 3pt; }
  .franja { height: 2.2pt; background: ${C.naranja}; margin: 10pt 0 12pt; }
  .fila { display: flex; gap: 16pt; }
  .fila > .ancho { flex: 1; min-width: 0; }
  .panel { background: ${C.petroleoClaro}; padding: 7pt 8pt; }
  .rotulo { font-size: 7.5pt; font-weight: 700; color: ${C.petroleo}; letter-spacing: 1.2px; text-transform: uppercase; margin-bottom: 4pt; }
  .par { margin: 1.5pt 0; }
  .par b { color: ${GRIS}; font-size: 7pt; margin-right: 4pt; }
  .apilado { margin: 2pt 0; }
  .apilado b { display: block; color: ${GRIS}; font-size: 7pt; }
  .apilado span { font-size: 7.5pt; word-break: break-all; letter-spacing: 0.1px; }
  .dos { display: flex; gap: 12pt; } .dos > * { flex: 1; }
  .qr { width: 70pt; text-align: center; font-size: 6pt; color: ${GRIS}; word-break: break-all; }
  .qr a { color: ${C.petroleo}; }
  table { width: 100%; border-collapse: collapse; }
  th { background: ${C.petroleo}; color: #fff; font-size: 7pt; font-weight: 700; padding: 4pt ${conLotes ? 3 : 5}pt; text-align: left; }
  td { padding: 4pt ${conLotes ? 3 : 5}pt; border-top: 0.5pt solid ${LINEA}; vertical-align: top; }
  tr { page-break-inside: avoid; }
  tr.par2 td { background: #f5f8f9; }
  .num { text-align: right; white-space: nowrap; }
  .chico { font-size: 7pt; }
  .gris { color: ${GRIS}; }
  .cierre { display: flex; gap: 20pt; margin-top: 18pt; page-break-inside: avoid; }
  .cierre .izq { flex: 1; }
  .cierre table { width: 220pt; }
  .total td { background: ${C.petroleo}; color: #fff; font-weight: 700; }
  .total td:first-child { font-size: 9.5pt; } .total td.num { font-size: 11pt; }
  .pie { margin-top: 18pt; border-top: 0.6pt solid ${LINEA}; padding-top: 5pt; display: flex; justify-content: space-between; font-size: 7pt; color: ${GRIS}; }
  .pie b { color: ${C.petroleo}; }
</style></head><body>
${marcaDeAgua ? `<div class="agua">${esc(marcaDeAgua)}</div>` : ''}
<div class="membrete">
  ${marca?.iconoSvg ? `<div style="width:46pt;height:46pt">${marca.iconoSvg.replace('<svg ', '<svg width="46pt" height="46pt" ')}</div>` : ''}
  <div class="nombre"><h1>${esc(marca?.nombre ?? d.emisor.comercial ?? d.emisor.nombre)}</h1>${marca?.bajada ? `<small>${esc(marca.bajada.toUpperCase())}</small>` : ''}</div>
  <div class="tipo"><small>DOCUMENTO TRIBUTARIO ELECTRÓNICO</small><strong>${esc(d.nombre)}</strong></div>
</div>
<div class="franja"></div>

<div class="fila">
  <div class="ancho">
    <div class="rotulo">Emisor</div>
    <div style="font-size:10.5pt;font-weight:700">${esc(d.emisor.nombre)}</div>
    ${d.emisor.comercial && d.emisor.comercial !== d.emisor.nombre ? `<div style="font-size:8.5pt;margin-top:1pt">${esc(d.emisor.comercial)}</div>` : ''}
    <div class="gris" style="font-size:7.5pt;margin:2pt 0 4pt">${esc(d.emisor.actividad)}</div>
    <div class="dos">${par('NIT', d.emisor.nit)}${par('NRC', d.emisor.nrc)}</div>
    ${par('Dirección', d.emisor.direccion)}
    <div class="dos">${par('Teléfono', d.emisor.telefono)}${par('Correo', d.emisor.correo)}</div>
    ${d.emisor.establecimiento ? par('Establecimiento · punto de venta', d.emisor.establecimiento) : ''}
  </div>
  <div class="panel" style="width:250pt">
    <div class="fila" style="gap:8pt">
      <div class="ancho">
        ${par('Emisión', `${d.fecha} ${d.hora}`)}${par('Modelo', d.modelo)}${par('Transmisión', d.transmision)}${par('Versión del JSON', d.version)}
        ${apilado('Número de control', d.numeroControl)}
      </div>
      <div class="qr">${qrSvg ? `<div style="width:64pt;height:64pt;margin:0 auto">${qrSvg}</div>` : `<a href="${esc(url)}">Consulta pública</a>`}<div style="margin-top:2pt">Verifique en Hacienda</div></div>
    </div>
    ${apilado('Código de generación', d.codigoGeneracion)}
    ${apilado('Sello de recepción', d.sellado ? d.sello : 'PENDIENTE')}
  </div>
</div>

<div class="panel" style="margin-top:14pt">
  <div class="rotulo">Receptor</div>
  <div class="fila">
    <div class="ancho">
      <div style="font-size:9.5pt;font-weight:700;margin-bottom:2pt">${esc(d.receptor.nombre)}</div>
      ${d.receptor.comercial && d.receptor.comercial !== d.receptor.nombre ? par('Nombre comercial', d.receptor.comercial) : ''}
      ${par('Documento', d.receptor.documento || '—')}
      ${d.receptor.nrc ? par('NRC', d.receptor.nrc) : ''}
      ${d.receptor.actividad ? par('Actividad', d.receptor.actividad) : ''}
    </div>
    <div class="ancho">
      ${par('Dirección', d.receptor.direccion || '—')}${par('Teléfono', d.receptor.telefono || '—')}${par('Correo', d.receptor.correo || '—')}
    </div>
  </div>
</div>

<table style="margin-top:14pt">
  <thead><tr>${cabecera.map((t, i) => `<th class="${i < primeraNumerica ? '' : 'num'}">${esc(t)}</th>`).join('')}</tr></thead>
  <tbody>
  ${d.renglones.map((r, i) => `<tr class="${i % 2 ? 'par2' : ''}">
    <td class="gris">${esc(r.n)}</td><td class="chico">${esc(r.codigo)}</td><td class="num">${esc(r.cantidad)}</td><td class="chico">${esc(r.unidad)}</td>
    <td>${esc(r.descripcion)}</td>
    ${conLotes ? `<td class="chico">${esc(r.lote ?? '—')}</td><td class="chico">${esc(r.vence ?? '—')}</td>` : ''}
    <td class="num">${dinero(r.precio)}</td><td class="num">${dinero(r.descuento)}</td><td class="num">${dinero(r.noSujeta)}</td><td class="num">${dinero(r.exenta)}</td><td class="num">${dinero(r.gravada)}</td>
  </tr>`).join('')}
  <tr><td colspan="${conLotes ? 9 : 7}" class="num"><b>Sumas</b></td>
    <td class="num"><b>${dinero(sumas('noSujeta'))}</b></td><td class="num"><b>${dinero(sumas('exenta'))}</b></td><td class="num"><b>${dinero(sumas('gravada'))}</b></td></tr>
  </tbody>
</table>

${d.relacionados.length ? `<div class="rotulo" style="margin-top:12pt">Documentos relacionados</div>
<table><thead><tr><th>Tipo de documento</th><th>Generación</th><th>Número o código</th><th>Fecha</th></tr></thead><tbody>
${d.relacionados.map(r => `<tr><td>${esc(r.tipo)}</td><td>${esc(r.generacion)}</td><td class="chico">${esc(r.numero)}</td><td>${esc(r.fecha)}</td></tr>`).join('')}
</tbody></table>` : ''}

${d.apendice.length ? `<div class="rotulo" style="margin-top:12pt">Información adicional</div>
<div class="dos">${[0, 1].map(k => `<div>${d.apendice.filter((_, i) => i % 2 === k).map(([e, v]) => par(e, v)).join('')}</div>`).join('')}</div>` : ''}

<div class="cierre">
  <div class="izq">
    ${par('Valor en letras', res.letras)}
    ${d.condicion ? par('Condición de la operación', d.condicion) : ''}
    ${res.ivaIncluido ? par('IVA incluido en el precio', dinero(res.iva)) : ''}
    ${par('Observaciones', d.observaciones || '—')}
  </div>
  <table>
    ${filas.map(([t, v]) => `<tr><td class="gris">${esc(t)}</td><td class="num">${v < 0 ? `-${dinero(-v)}` : dinero(v)}</td></tr>`).join('')}
    <tr class="total"><td>TOTAL A PAGAR</td><td class="num">${dinero(res.total)}</td></tr>
  </table>
</div>

<div class="pie">
  <span>${marca ? `<b>${esc(marca.nombre)}</b> · ${esc(d.emisor.nombre)}` : esc(d.emisor.nombre)}</span>
  <span>${d.invalidado ? 'Documento invalidado ante el Ministerio de Hacienda' : d.sellado ? 'Documento sellado por el Ministerio de Hacienda' : 'Documento pendiente del sello de Hacienda'}</span>
</div>
</body></html>`;
}
