// ═══════════════════════════════════════════════════════════════════════════
// El mes impreso de las bitácoras.
//
// ── Por qué existe ─────────────────────────────────────────────────────────
// RTS 6.1.14: «Toda la documentación solicitada por este reglamento debe estar
// disponible dentro del establecimiento; **preferiblemente debe estar de manera
// física**». La norma PREFIERE el papel — lo digital está permitido pero con la
// carga extra de un procedimiento autorizado por el regente. Que la respuesta a
// «muéstreme la bitácora» sea «déjeme prender la computadora» es exactamente lo
// que este documento evita.
//
// ── El hueco se IMPRIME ────────────────────────────────────────────────────
// Cada día que tocaba sale con su casilla, y la que nadie llenó sale vacía y
// marcada. Un papel que sólo lista lo anotado no se puede auditar: no distingue
// «no había que leer» de «nadie leyó», y esa distinción es toda la bitácora.
//
// ── El papel no tiene tema ─────────────────────────────────────────────────
// Negro sobre blanco, sin tokens ni fondos rellenos — la misma regla que el
// ticket. Este HTML no llega nunca al DOM de la app: va a una ventana propia.
// ═══════════════════════════════════════════════════════════════════════════

const CSS = `
  @page { size: letter; margin: 12mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 9px; color: #000; margin: 0; }
  h1 { font-size: 15px; margin: 0 0 2px; }
  h2 { font-size: 12px; margin: 14px 0 4px; border-bottom: 1px solid #000; padding-bottom: 2px; }
  h3 { font-size: 10px; margin: 10px 0 3px; }
  .cab { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 6px; }
  .cab .der { text-align: right; font-size: 9px; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { background: #000; color: #fff; padding: 3px 4px; font-size: 8px; text-align: left; }
  td { border: 1px solid #999; padding: 2px 4px; font-size: 8px; vertical-align: top; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; }
  td.c { text-align: center; }
  .falta { background: #eee; color: #000; font-weight: bold; text-align: center; }
  .fuera { font-weight: bold; text-decoration: underline; }
  .resumen td { border: none; padding: 1px 10px 1px 0; font-size: 9px; }
  .resumen .val { font-weight: bold; font-size: 11px; }
  .nota { font-size: 8px; margin-top: 3px; }
  .firma { margin-top: 26px; display: flex; gap: 40px; }
  .firma div { flex: 1; border-top: 1px solid #000; padding-top: 3px; text-align: center; font-size: 8px; }
  .borrador { border: 2px solid #000; padding: 4px 8px; margin-top: 6px; font-size: 10px; font-weight: bold; }
  .quien { font-size: 7px; }
  .pb { page-break-after: always; }
`;

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const num = (v) => (v === null || v === undefined ? '' : String(Number(v)));

const fecha = (f) => (f
    ? new Date(`${f}T12:00:00Z`).toLocaleDateString('es-SV', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
    : '');

const diaCorto = (f) => (f
    ? new Date(`${f}T12:00:00Z`).toLocaleDateString('es-SV', { day: '2-digit', weekday: 'short', timeZone: 'UTC' })
    : '');

const nombreMes = (p) => {
    const [a, m] = String(p).split('-').map(Number);
    const t = new Date(Date.UTC(a, m - 1, 1)).toLocaleDateString('es-SV', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return t.charAt(0).toUpperCase() + t.slice(1);
};

const pct = (h, e) => (e > 0 ? `${Math.round((h / e) * 100)}%` : '—');

/**
 * El encabezado que se repite en cada sección impresa.
 *
 * Lleva la DIRECCIÓN porque la bitácora es del establecimiento, no de la
 * empresa: lo primero que hace un inspector es comprobar que la hoja que tiene
 * en la mano es de la sala en la que está parado.
 */
function cabecera(mes, titulo) {
    return `<div class="cab">
        <div>
            <h1>${esc(titulo)}</h1>
            <div><strong>${esc(mes.sucursal)}</strong>${mes.direccion ? ` · ${esc(mes.direccion)}` : ''}</div>
        </div>
        <div class="der">
            <div><strong>${esc(nombreMes(mes.periodo))}</strong></div>
            <div>Del ${fecha(mes.desde)} al ${fecha(mes.hasta)}</div>
        </div>
    </div>`;
}

/** La portada: el resumen que el regente firma. */
function portada(mes) {
    const r = mes.resumen || {};
    const L = r.lecturas || {}; const Li = r.limpiezas || {};
    const cierre = mes.cierre;

    const alertas = [];
    if (L.faltantes > 0) alertas.push(`${L.faltantes} lecturas sin anotar`);
    if (L.sin_accion > 0) alertas.push(`${L.sin_accion} fuera de rango SIN acción correctiva`);
    if (Li.faltantes > 0) alertas.push(`${Li.faltantes} limpiezas sin registrar`);
    for (const c of (r.calibracion_vencida || [])) {
        alertas.push(`Calibración vencida: ${c.area}${c.instrumento ? ` (${c.instrumento})` : ''}`);
    }

    return `${cabecera(mes, 'Bitácoras — resumen del mes')}

    ${mes.cerrado ? '' : `<div class="borrador">BORRADOR — el regente todavía no ha dado por finalizado este mes.
        Los registros pueden cambiar.</div>`}

    <h2>Temperatura y humedad</h2>
    <table class="resumen"><tr>
        <td>Cumplimiento<br/><span class="val">${pct(L.hechas, L.esperadas)}</span></td>
        <td>Anotadas<br/><span class="val">${L.hechas ?? 0} de ${L.esperadas ?? 0}</span></td>
        <td>Faltantes<br/><span class="val">${L.faltantes ?? 0}</span></td>
        <td>Fuera de hora<br/><span class="val">${L.tarde ?? 0}</span></td>
        <td>Fuera de rango<br/><span class="val">${L.fuera_de_rango ?? 0}</span></td>
        <td>Correcciones<br/><span class="val">${r.correcciones ?? 0}</span></td>
    </tr></table>

    <h2>Limpieza y orden</h2>
    <table class="resumen"><tr>
        <td>Cumplimiento<br/><span class="val">${pct(Li.hechas, Li.esperadas)}</span></td>
        <td>Registradas<br/><span class="val">${Li.hechas ?? 0} de ${Li.esperadas ?? 0}</span></td>
        <td>Faltantes<br/><span class="val">${Li.faltantes ?? 0}</span></td>
    </tr></table>

    ${alertas.length ? `<h2>Lo que quedó pendiente</h2><ul>${
        alertas.map(a => `<li>${esc(a)}</li>`).join('')
    }</ul>` : '<h2>Sin pendientes</h2><p>El mes quedó completo.</p>'}

    <h2>Dispensación bajo receta</h2>
    <p>${(mes.libro || []).length} renglones foliados en el período.</p>

    ${cierre?.accion === 'cerrar' && cierre.motivo ? `<h2>Observaciones del regente</h2>
    <p>${esc(cierre.motivo)}</p>` : ''}

    <div class="firma">
        <div>${cierre?.accion === 'cerrar'
        ? `Dado por finalizado por ${esc(cierre.firmado_por || '')}<br/>${
            new Date(cierre.created_at).toLocaleDateString('es-SV', { day: '2-digit', month: '2-digit', year: 'numeric' })
        }<br/>Firma y sello`
        : 'Regente farmacéutico<br/>Nombre, firma y sello'}</div>
        <div>Fecha</div>
    </div>
    <p class="nota">Registros conservados conforme al RTS 11.02.04:24 §6.2.16 (temperatura y humedad,
    2 años) y a la Guía de Verificación de BPAD ítem 3.12 (dispensación bajo receta, 1 año).</p>`;
}

/** Una tabla por área: los días en filas, las franjas en columnas. */
function tablaArea(mes, area) {
    const franjas = area.franjas || [];
    const conHumedad = area.mide_humedad;
    const rango = area.temp_min != null && area.temp_max != null
        ? `${Number(area.temp_min)} a ${Number(area.temp_max)} °C`
        : area.temp_max != null ? `hasta ${Number(area.temp_max)} °C` : 'sin rango';

    const cabezas = franjas.map(f =>
        `<th>${esc(f.label)}<br/>${esc(String(f.desde).slice(0, 5))}–${esc(String(f.hasta).slice(0, 5))}</th>`).join('');

    // El nombre va COMPLETO. ALCOA pide que el registro sea «atribuible», y en
    // una sala con dos Merlyn el nombre de pila no atribuye a nadie.
    const filas = (area.dias || []).map((d) => {
        const celdas = franjas.map((f) => {
            const l = (d.lecturas || []).find(x => x.franja === f.clave);
            if (!l || l.temperatura === null || l.temperatura === undefined) {
                return '<td class="falta">—</td>';
            }
            const t = `${num(l.temperatura)}°${conHumedad && l.humedad != null ? ` / ${num(l.humedad)}%` : ''}`;
            return `<td class="c${l.fuera_de_rango ? ' fuera' : ''}">${esc(t)}${l.correcciones > 0 ? ' (c)' : ''}<br/>
                <span class="quien">${esc(l.por || '')} · ${esc(l.hora || '')}${l.tarde ? ' *' : ''}</span></td>`;
        }).join('');
        return `<tr><td>${esc(diaCorto(d.dia))}</td>${celdas}</tr>`;
    }).join('');

    // Las desviaciones van al pie, con su acción: el ítem 5.6.5 pide investigar
    // y dejar constancia, y en la celda no cabe.
    const desvios = [];
    for (const d of (area.dias || [])) {
        for (const l of (d.lecturas || [])) {
            if (l.fuera_de_rango) desvios.push(`${fecha(d.dia)} ${esc(l.label)}: ${num(l.temperatura)}°C — ${esc(l.accion || 'sin acción anotada')}`);
        }
    }

    return `<h3>${esc(area.nombre)} · ${esc(rango)}${
        area.instrumento ? ` · ${esc(area.instrumento)}` : ''
    }${area.calibrado_hasta ? ` · calibrado hasta ${fecha(area.calibrado_hasta)}` : ''}</h3>
    <table>
        <thead><tr><th>Día</th>${cabezas}</tr></thead>
        <tbody>${filas || `<tr><td colspan="${franjas.length + 1}">Sin días en el período</td></tr>`}</tbody>
    </table>
    <p class="nota">— = sin anotar. * = anotada fuera de su franja. Subrayado = fuera de rango.
    (c) = el valor se corrigió; el original y el motivo quedan en el portal.</p>
    ${desvios.length ? `<p class="nota"><strong>Desviaciones y acción correctiva:</strong><br/>${desvios.join('<br/>')}</p>` : ''}`;
}

/** La limpieza del área, si tiene turnos. */
function tablaLimpieza(area) {
    const turnos = area.limpiezas || [];
    if (!turnos.length) return '';
    const cabezas = turnos.map(t => `<th>${esc(t.label)}</th>`).join('');
    const filas = (area.dias || []).map((d) => {
        const celdas = turnos.map((t) => {
            const li = (d.limpiezas || []).find(x => x.turno === t.clave);
            if (!li || !li.hecha) return '<td class="falta">—</td>';
            // Cuántos muebles de los que lleva el área, y cuáles no entraron
            // en ese turno. Es un DATO, no una falta: la norma pide el
            // procedimiento y su registro, no que cada turno pase por todos los
            // muebles. Se nombran porque un «11 de 26» sin decir cuáles obliga
            // a ir a buscarlo a otro lado, y el inspector está parado enfrente
            // de la vitrina.
            const total = li.puntos_total ?? 0;
            const detalle = total
                ? `<br/><span class="quien">${li.puntos_hechos ?? 0} de ${total}</span>` : '';
            const faltantes = (li.puntos_faltantes || []).length
                ? `<br/><span class="quien">no se limpiaron: ${esc((li.puntos_faltantes || []).join(', '))}</span>` : '';
            return `<td class="c">✓${detalle}${faltantes}<br/><span class="quien">${esc(li.por || '')}${
                li.observaciones ? `<br/>${esc(li.observaciones)}` : ''}</span></td>`;
        }).join('');
        return `<tr><td>${esc(diaCorto(d.dia))}</td>${celdas}</tr>`;
    }).join('');
    return `<h3>Limpieza y orden — ${esc(area.nombre)}</h3>
    <table><thead><tr><th>Día</th>${cabezas}</tr></thead>
    <tbody>${filas || `<tr><td colspan="${turnos.length + 1}">Sin días en el período</td></tr>`}</tbody></table>
    <p class="nota">— = sin registrar.${
        (area.puntos || []).length
            ? ` El área lleva ${(area.puntos || []).length} muebles: ${
                esc((area.puntos || []).map(p => p.label).join(', '))}.`
            : ''}</p>`;
}

/** El libro foliado. */
function tablaLibro(mes) {
    const filas = (mes.libro || []).map(r => `<tr>
        <td>${esc(r.folio)}</td>
        <td>${fecha(r.fecha)}${r.hora ? `<br/><span class="quien">${esc(r.hora)}</span>` : ''}</td>
        <td>${esc(r.producto)}${r.laboratorio ? `<br/><span class="quien">${esc(r.laboratorio)}</span>` : ''}</td>
        <td class="n">${num(r.cantidad)}</td>
        <td>${esc(r.lote || '')}</td>
        <td>${fecha(r.vence)}</td>
        <td>${esc(r.paciente || '—')}</td>
        <td>${esc(r.medico || '—')}${r.numero_junta ? `<br/><span class="quien">N.º junta ${esc(r.numero_junta)}</span>` : ''}</td>
        <td>${esc(r.receta || '—')}${r.prescrito ? `<br/><span class="quien">${num(r.prescrito)} prescritas</span>` : ''}</td>
        <td>${esc(r.documento || '')}</td>
        <td>${esc(r.vendedor || '')}</td>
        <td>${r.estado === 'anulada' ? `ANULADA<br/><span class="quien">${esc(r.motivo_anulacion || '')}</span>` : ''}</td>
    </tr>`).join('');

    return `<h2>Libro de dispensación bajo receta</h2>
    <table>
        <thead><tr>
            <th>Folio</th><th>Fecha</th><th>Medicamento</th><th>Cant.</th><th>Lote</th><th>Vence</th>
            <th>Paciente</th><th>Prescriptor</th><th>Receta</th><th>Documento</th><th>Despachó</th><th></th>
        </tr></thead>
        <tbody>${filas || '<tr><td colspan="12">Sin renglones en el período</td></tr>'}</tbody>
    </table>
    <p class="nota">Contiene lo que exige el ítem 3.5 de la Guía de Verificación de BPAD: denominación,
    presentación, laboratorio, lote, fecha de expiración, fecha y cantidad dispensada, y quién despachó.</p>`;
}

/** Arma el documento entero y abre la ventana de impresión. */
export function imprimirMesDeBitacoras(mes) {
    if (!mes) return;

    const areas = mes.areas || [];
    // Un área de sólo limpieza —vitrinas, servicio sanitario— no tiene franjas,
    // y su tabla de temperatura saldría con la columna «Día» sola.
    const conLecturas = areas.filter(a => (a.franjas || []).length);

    const secciones = [`<section class="pb">${portada(mes)}</section>`];

    if (conLecturas.length) {
        secciones.push(`<section class="pb">${cabecera(mes, 'Temperatura y humedad')}${
            conLecturas.map(a => tablaArea(mes, a)).join('')
        }</section>`);
    }

    const conLimpieza = areas.filter(a => (a.limpiezas || []).length);
    if (conLimpieza.length) {
        secciones.push(`<section class="pb">${cabecera(mes, 'Limpieza y orden')}${
            conLimpieza.map(tablaLimpieza).join('')
        }</section>`);
    }

    secciones.push(`<section>${cabecera(mes, 'Dispensación bajo receta')}${tablaLibro(mes)}</section>`);

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
        <title>Bitácoras ${esc(mes.sucursal)} ${esc(mes.periodo)}</title>
        <style>${CSS}</style></head><body>${secciones.join('')}</body></html>`;

    const win = window.open('', '_blank', 'width=1000,height=900,noopener');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    // El retardo es el mismo que usa la boleta de pago: sin él, Safari imprime
    // antes de aplicar el CSS y sale el HTML sin formato.
    setTimeout(() => win.print(), 400);
}
