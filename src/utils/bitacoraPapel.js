// ═══════════════════════════════════════════════════════════════════════════
// El papel de las bitácoras: el HTML del mes, y NADA más.
//
// Este archivo no toca el navegador ni abre ventanas — arma una cadena y la
// devuelve. Está separado de `bitacoraPrint.js` a propósito: sin un solo
// import, el generador de maquetas (`scripts/maqueta-bitacoras.mjs`) lo carga
// con node y dibuja las hojas sin levantar el portal. Un papel que sólo se
// puede ver imprimiéndolo desde producción no se revisa nunca.
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
// ── El papel no tiene tema, y acá NO es una preferencia ────────────────────
// Negro sobre blanco, sin fondos rellenos. En el ticket era una limitación de
// la impresora; acá es una condición de que el documento FUNCIONE, y son dos
// razones distintas:
//
// 1. **Chrome NO imprime fondos por defecto.** La casilla «Gráficos de fondo»
//    del diálogo viene apagada, así que todo `background` se descarta. La
//    versión anterior de este papel tenía `th { background:#000; color:#fff }`:
//    con el fondo descartado eso es **texto blanco sobre papel blanco**, o sea
//    encabezados de columna invisibles, y el `.falta { background:#eee }` que
//    marcaba las lecturas sin anotar desaparecía entero. Ninguna de las dos
//    cosas da error: salen en la hoja y no están.
//
//    De ahí la regla dura de este archivo: **ningún significado puede depender
//    de un fondo.** Lo que distingue una celda de otra son REGLAS, PESO y
//    GLIFOS — `▲` fuera de rango, `—` sin anotar, `*` fuera de hora, `(c)`
//    corregida — que se imprimen siempre y sobreviven a la fotocopia.
//
// 2. **La hoja se fotocopia.** Es lo que hace un inspector con lo que se
//    lleva. Un gris del 15% vuelve del 40% o desaparece según la máquina, así
//    que un gris nunca puede ser la diferencia entre «se anotó» y «no».
//
// El único color de la hoja es el logo, y viaja como imagen: si no carga, en
// su lugar va el nombre de la empresa en texto y el documento sale igual.
//
// ── Carta, y una hoja por área ─────────────────────────────────────────────
// El formato lo pidió el usuario (2026-09-03) y coincide con el formulario en
// papel que las salas ya usan: **una hoja por área y por mes**, con su banda de
// control arriba y sus firmas al pie. Cada área empieza en página nueva porque
// eso es lo que se archiva y lo que se entrega suelto — una hoja que no dice de
// qué sala y de qué área es no sirve para nada, así que la banda se repite.
//
// **Vertical, salvo el libro de dispensación**, que va acostado por pedido del
// usuario: son once columnas y en vertical hay que apretarlas hasta que dejan
// de leerse. Se hace con `@page libro` nombrada, así que las dos orientaciones
// conviven en el mismo documento.
// ═══════════════════════════════════════════════════════════════════════════

const CSS = `
  @page { size: letter portrait; margin: 11mm 9mm 10mm; }
  @page libro { size: letter landscape; margin: 10mm 9mm; }
  section.libro { page: libro; }

  * { box-sizing: border-box; }

  body {
    font: 400 8.5pt/1.25 Arial, Helvetica, sans-serif;
    color: #000; margin: 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  /* ── Banda de control ─────────────────────────────────────────────────
     Es lo que convierte una tabla en un REGISTRO: quién lo emite, qué es y
     de cuándo. Va arriba de cada hoja porque las hojas se separan. */
  .banda { display: table; width: 100%; border: 1pt solid #000; margin-bottom: 2.6mm; }
  .banda > div { display: table-cell; vertical-align: middle; padding: 1mm 3mm; }
  .banda .logo { width: 48mm; border-right: 1pt solid #000; }
  .banda .logo img { display: block; width: 100%; height: auto; }
  .banda .logo .empresa { font-size: 8.5pt; font-weight: bold; letter-spacing: .03em; line-height: 1.15; }
  .banda .centro { text-align: center; }
  .banda .cejilla { font-size: 6pt; letter-spacing: .22em; text-transform: uppercase; }
  .banda .titulo { font-size: 12.5pt; font-weight: bold; margin-top: .9mm; line-height: 1.1; }
  .banda .sello { width: 38mm; border-left: 1pt solid #000; padding: 0; }
  .banda .sello .fila { padding: 1.3mm 2.5mm; }
  .banda .sello .fila + .fila { border-top: .5pt solid #000; }
  .banda .sello .k { font-size: 5.6pt; letter-spacing: .16em; text-transform: uppercase; display: block; }
  .banda .sello .v { font-size: 8pt; font-weight: bold; }
  .banda .sello .rayita { display: block; border-bottom: .5pt solid #000; height: 3.4mm; }

  /* Un mes sin cerrar impreso y archivado es el riesgo real de este papel:
     se lee idéntico a uno firmado. Por eso el aviso va antes que la tabla. */
  .borrador { border: 1.4pt solid #000; padding: 1.6mm 3mm; margin-bottom: 3.5mm;
              font-size: 8pt; font-weight: bold; letter-spacing: .04em; }
  .borrador span { font-weight: 400; letter-spacing: 0; }

  /* ── Franja de identidad ──────────────────────────────────────────────
     Lo que en el formulario de papel son rayas para llenar a mano. Acá el
     portal ya lo sabe, así que va impreso. */
  table.identidad { width: 100%; border-collapse: collapse; margin-bottom: 2.6mm; table-layout: fixed; }
  table.identidad td { border: .5pt solid #000; padding: .9mm 2mm; vertical-align: top; }
  table.identidad .k { font-size: 5.6pt; letter-spacing: .16em; text-transform: uppercase; display: block; }
  table.identidad .v { font-size: 9pt; font-weight: bold; line-height: 1.15; }
  table.identidad .v.chico { font-size: 7.2pt; font-weight: 400; line-height: 1.25; }

  /* ── La tabla del registro ────────────────────────────────────────────── */
  table.reg { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.reg th, table.reg td { border: .4pt solid #000; }
  table.reg thead th { padding: 1.1mm .8mm; text-align: center; }
  /* ── La fila que salva a la página huérfana ───────────────────────────
     Un mes que no entra en una hoja sigue en la siguiente, y esa segunda
     hoja se archiva y se entrega suelta igual que la primera. Un THEAD
     se repite en cada página; la banda de arriba, no. Así que la sala, el
     área y el mes viajan TAMBIÉN acá dentro: sin esto, la página 2 es una
     tabla de números que no dice de quién es. */
  table.reg thead tr.ident th { font-size: 5.4pt; letter-spacing: .16em; text-transform: uppercase;
                                font-weight: bold; text-align: left; padding: .9mm 1.4mm; }
  table.reg thead tr.grupo th { font-size: 8.5pt; font-weight: bold; }
  table.reg thead tr.grupo th .hora { display: block; font-size: 6pt; font-weight: 400; letter-spacing: .1em; }
  table.reg thead tr.sub th { font-size: 5.8pt; letter-spacing: .12em; text-transform: uppercase;
                              font-weight: bold; }
  table.reg thead tr:last-child th { border-bottom: 1.2pt solid #000; }
  table.reg thead th.sep, table.reg tbody td.sep { border-left: 1pt solid #000; }
  table.reg tbody td { padding: .35mm .6mm; height: 4.8mm; vertical-align: middle; }
  /* Un renglón grueso cada domingo: en 31 filas iguales el ojo pierde el
     renglón, y una trama de fondo no se imprime. La regla sí. */
  table.reg tbody tr.semana td { border-top: 1.1pt solid #000; }

  /* El día manda la ALTURA de la fila, no el nombre: son dos líneas —número y
     abreviatura— contra las dos del nombre, pero en cuerpos mayores. Bajarlo un
     punto le quita 1 mm a cada renglón, o sea 31 mm a la hoja, que es lo que
     hace que el mes entre entero con sus firmas al pie. */
  td.dia { text-align: center; font-weight: bold; font-size: 7.6pt; line-height: .95; }
  td.dia .dow { display: block; font-size: 4.4pt; font-weight: 400; letter-spacing: .08em;
                text-transform: uppercase; margin-top: .2mm; line-height: 1; }
  td.val { text-align: center; font-variant-numeric: tabular-nums; font-size: 8pt; }
  td.val.fuera { font-weight: bold; }
  .marca { font-size: 6.2pt; }
  td.quien { font-size: 5.2pt; line-height: 1.05; overflow-wrap: anywhere; }
  td.folio { white-space: nowrap; }
  .hora { font-variant-numeric: tabular-nums; }
  td.vacio { text-align: center; font-size: 9pt; }
  td.c { text-align: center; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; }
  td.limpio { font-size: 5.6pt; line-height: 1.1; }
  td.limpio .ok { font-size: 7.5pt; font-weight: bold; }

  /* ── Pies ─────────────────────────────────────────────────────────────── */
  .leyenda { font-size: 6.2pt; margin-top: 1.4mm; line-height: 1.3; }
  .desvios { border: .6pt solid #000; padding: 1.4mm 2.2mm; margin-top: 2mm; font-size: 6.6pt; line-height: 1.35; }
  .desvios .t { font-size: 6pt; letter-spacing: .16em; text-transform: uppercase; font-weight: bold;
                display: block; margin-bottom: 1mm; }

  .firmas { display: table; width: 100%; margin-top: 4mm; }
  .firmas > div { display: table-cell; width: 50%; padding: 0 7mm; vertical-align: bottom; }
  .firmas .linea { border-top: .9pt solid #000; padding-top: 1.4mm; text-align: center; }
  .firmas .rol { font-size: 8.5pt; font-weight: bold; }
  .firmas .que { font-size: 5.8pt; letter-spacing: .14em; text-transform: uppercase; margin-top: .5mm; }
  .firmas .dicho { font-size: 7pt; margin-top: 1mm; }

  /* ── Portada ──────────────────────────────────────────────────────────── */
  h2 { font-size: 8pt; letter-spacing: .18em; text-transform: uppercase; margin: 6mm 0 2mm;
       padding-bottom: 1mm; border-bottom: .9pt solid #000; }
  table.cifras { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.cifras td { border: .5pt solid #000; padding: 2mm 1mm; text-align: center; vertical-align: top; }
  table.cifras .k { font-size: 5.8pt; letter-spacing: .14em; text-transform: uppercase; display: block; }
  table.cifras .v { font-size: 15pt; font-weight: bold; line-height: 1.1; display: block; margin-top: .8mm; }
  table.cifras .v.chica { font-size: 10.5pt; }
  ul.pendientes { margin: 0; padding-left: 4.5mm; font-size: 8.5pt; line-height: 1.55; }
  p.suelto { font-size: 8.5pt; margin: 0; }
  .nota { font-size: 6.4pt; margin-top: 4mm; line-height: 1.35; }

  .pb { page-break-after: always; }
  table.reg tbody tr, .desvios, .firmas { page-break-inside: avoid; }
`;

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const num = (v) => (v === null || v === undefined ? '' : String(Number(v)));

const fecha = (f) => (f
    ? new Date(`${f}T12:00:00Z`).toLocaleDateString('es-SV', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
    : '');

const nombreMes = (p) => {
    const [a, m] = String(p).split('-').map(Number);
    const t = new Date(Date.UTC(a, m - 1, 1)).toLocaleDateString('es-SV', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return t.charAt(0).toUpperCase() + t.slice(1);
};

const diaNumero = (f) => (f ? String(f).slice(8, 10).replace(/^0/, '') : '');

const diaSemana = (f) => (f
    ? new Date(`${f}T12:00:00Z`).toLocaleDateString('es-SV', { weekday: 'short', timeZone: 'UTC' })
        .replace(/\./g, '').slice(0, 3)
    : '');

/** Domingo abre semana: la regla gruesa cae donde el ojo espera el corte. */
const abreSemana = (f) => (f ? new Date(`${f}T12:00:00Z`).getUTCDay() === 0 : false);

const pct = (h, e) => (e > 0 ? `${Math.round((h / e) * 100)}%` : '—');

const hhmm = (h) => esc(String(h ?? '').slice(0, 5));

const rangoDe = (area) => (area.temp_min != null && area.temp_max != null
    ? `${Number(area.temp_min)} a ${Number(area.temp_max)} °C`
    : area.temp_max != null ? `Hasta ${Number(area.temp_max)} °C` : 'Sin rango definido');

/**
 * La banda de control, arriba de cada hoja.
 *
 * El logo viaja como data URL y se dibuja con su proporción real: los de sala
 * son ~3.55:1 y el de la empresa 7.34:1, así que un alto escrito a mano
 * aplastaría uno de los dos, y un logo aplastado no da error: se imprime igual.
 */
function banda(mes, titulo, logo) {
    const marca = logo?.dataUrl
        ? `<img src="${logo.dataUrl}" alt="Farmacias La Popular y La Salud"/>`
        : '<div class="empresa">FARMACIAS<br/>LA POPULAR Y LA SALUD</div>';

    return `<div class="banda">
        <div class="logo">${marca}</div>
        <div class="centro">
            <div class="cejilla">Formulario para registro</div>
            <div class="titulo">${esc(titulo)}</div>
        </div>
        <div class="sello">
            <div class="fila"><span class="k">Código</span><span class="rayita"></span></div>
            <div class="fila"><span class="k">Período</span><span class="v">${esc(mes.periodo)}</span></div>
        </div>
    </div>
    ${mes.cerrado ? '' : `<div class="borrador">BORRADOR<span> · el regente todavía no ha dado por
        finalizado este mes, así que los registros pueden cambiar.</span></div>`}`;
}

/**
 * La identificación que viaja DENTRO del `<thead>`, y por eso se repite en
 * cada página que ocupe la tabla. Ver la nota de `tr.ident` en el CSS.
 */
function identEnCabeza(cols, partes) {
    return `<tr class="ident"><th colspan="${cols}">${
        partes.filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ')}</th></tr>`;
}

/** La franja de identidad: lo que en el papel son rayas para llenar a mano. */
function identidad(celdas) {
    const ancho = `${(100 / celdas.length).toFixed(4)}%`;
    return `<table class="identidad"><tr>${celdas.map(c =>
        `<td style="width:${ancho}"><span class="k">${esc(c.k)}</span><span class="v${
            c.chico ? ' chico' : ''}">${c.v}</span></td>`).join('')}</tr></table>`;
}

/** Las dos firmas del pie, las mismas del formulario de papel. */
function firmas(cierre) {
    const cerrado = cierre?.accion === 'cerrar';
    return `<div class="firmas">
        <div><div class="linea">
            <div class="rol">Jefe de sala</div>
            <div class="que">Nombre y firma</div>
        </div></div>
        <div><div class="linea">
            <div class="rol">Regente farmacéutico</div>
            <div class="que">Nombre, firma y sello</div>
            ${cerrado ? `<div class="dicho">Dado por finalizado por ${esc(cierre.firmado_por || '')} el ${
        new Date(cierre.created_at).toLocaleDateString('es-SV', { day: '2-digit', month: '2-digit', year: 'numeric' })
    }</div>` : ''}
        </div></div>
    </div>`;
}

/**
 * La hoja de un área: los días en filas, cada franja con sus columnas.
 *
 * ── Por qué T, H y quién son TRES columnas y no una celda apilada ─────────
 * Antes la celda decía «26° / 61%» y debajo, en 7px, «Katherine Salinas ·
 * 07:25». Recorrer la columna de temperaturas obligaba a saltear dos líneas de
 * otra cosa en cada renglón. Separadas, cada columna se lee de un vistazo —que
 * es lo que hace quien compara contra el termómetro que tiene en la mano— y
 * además es la forma del formulario que las salas ya usan.
 *
 * El nombre va COMPLETO. ALCOA pide que el registro sea «atribuible», y en una
 * sala con dos Merlyn el nombre de pila no atribuye a nadie.
 */
export function hojaDeArea(mes, area, logo) {
    const franjas = area.franjas || [];
    const conH = !!area.mide_humedad;
    const sub = conH ? 3 : 2;

    // El ancho se reparte: el día fijo y cada franja lo que sobra, así una sala
    // con dos franjas llena la hoja igual que una con tres.
    const anchoDia = 11;
    const porFranja = (100 - anchoDia) / Math.max(franjas.length, 1);
    const cols = [`<col style="width:${anchoDia}%"/>`];
    for (let i = 0; i < franjas.length; i++) {
        cols.push(`<col style="width:${(porFranja * (conH ? 0.24 : 0.3)).toFixed(3)}%"/>`);
        if (conH) cols.push(`<col style="width:${(porFranja * 0.22).toFixed(3)}%"/>`);
        cols.push(`<col style="width:${(porFranja * (conH ? 0.54 : 0.7)).toFixed(3)}%"/>`);
    }

    const grupo = franjas.map(f =>
        `<th colspan="${sub}" class="sep">${esc(f.label)}<span class="hora hora">${
            hhmm(f.desde)} a ${hhmm(f.hasta)}</span></th>`).join('');

    const subCabeza = franjas.map(() =>
        `<th class="sep">T °C</th>${conH ? '<th>H %</th>' : ''}<th>Anotó</th>`).join('');

    const filas = (area.dias || []).map((d) => {
        const celdas = franjas.map((f) => {
            const l = (d.lecturas || []).find(x => x.franja === f.clave);
            if (!l || l.temperatura === null || l.temperatura === undefined) {
                return `<td class="vacio sep">—</td>${conH ? '<td class="vacio">—</td>' : ''}<td></td>`;
            }
            const fuera = l.fuera_de_rango ? ' fuera' : '';
            const aviso = l.fuera_de_rango ? '<span class="marca">▲</span> ' : '';
            return `<td class="val sep${fuera}">${aviso}${esc(num(l.temperatura))}</td>${
                conH ? `<td class="val${fuera}">${l.humedad != null ? esc(num(l.humedad)) : '—'}</td>` : ''
            }<td class="quien">${esc(l.por || '')} <span class="hora">${
                esc(l.hora || '')}</span>${l.tarde ? ' *' : ''}${l.correcciones > 0 ? ' (c)' : ''}</td>`;
        }).join('');
        return `<tr${abreSemana(d.dia) ? ' class="semana"' : ''}>
            <td class="dia">${esc(diaNumero(d.dia))}<span class="dow">${esc(diaSemana(d.dia))}</span></td>
            ${celdas}</tr>`;
    }).join('');

    // Las desviaciones van al pie con su acción: el ítem 5.6.5 pide investigar
    // y dejar constancia, y en la celda no cabe.
    const desvios = [];
    for (const d of (area.dias || [])) {
        for (const l of (d.lecturas || [])) {
            if (l.fuera_de_rango) {
                desvios.push(`${fecha(d.dia)} · ${esc(l.label)} · ${num(l.temperatura)} °C: ${
                    esc(l.accion || 'sin acción anotada')}`);
            }
        }
    }

    const vacia = `<tr><td colspan="${franjas.length * sub + 1}" class="c">Sin días en el período</td></tr>`;

    return `${banda(mes, 'Toma de temperatura y humedad', logo)}
    ${identidad([
        { k: 'Establecimiento', v: esc(mes.sucursal) },
        { k: 'Área', v: esc(area.nombre) },
        { k: 'Mes', v: esc(nombreMes(mes.periodo)) },
        { k: 'Rango permitido', v: esc(rangoDe(area)) },
        {
            k: 'Instrumento',
            chico: true,
            v: `${esc(area.instrumento || 'No declarado')}${
                area.calibrado_hasta ? `<br/>Calibrado hasta ${fecha(area.calibrado_hasta)}` : ''}`,
        },
    ])}
    <table class="reg">
        <colgroup>${cols.join('')}</colgroup>
        <thead>
            ${identEnCabeza(franjas.length * sub + 1,
        [mes.sucursal, area.nombre, nombreMes(mes.periodo), rangoDe(area)])}
            <tr class="grupo"><th rowspan="2">Fecha</th>${grupo}</tr>
            <tr class="sub">${subCabeza}</tr>
        </thead>
        <tbody>${filas || vacia}</tbody>
    </table>
    <p class="leyenda"><b>—</b> sin anotar &nbsp;·&nbsp; <b>▲</b> fuera del rango permitido
    &nbsp;·&nbsp; <b>*</b> anotada fuera de su franja &nbsp;·&nbsp; <b>(c)</b> el valor se corrigió;
    el original y el motivo quedan registrados.</p>
    ${desvios.length ? `<div class="desvios"><span class="t">Desviaciones y acción correctiva</span>${
        desvios.join('<br/>')}</div>` : ''}
    ${firmas(mes.cierre)}`;
}

/** La hoja de limpieza de un área. */
export function hojaDeLimpieza(mes, area, logo) {
    const turnos = area.limpiezas || [];
    if (!turnos.length) return '';

    const anchoDia = 11;
    const porTurno = ((100 - anchoDia) / turnos.length).toFixed(3);
    const cols = [`<col style="width:${anchoDia}%"/>`]
        .concat(turnos.map(() => `<col style="width:${porTurno}%"/>`));

    const cabeza = turnos.map(t =>
        `<th class="sep">${esc(t.label)}<span class="hora">${hhmm(t.desde)} a ${hhmm(t.hasta)}</span></th>`).join('');

    const filas = (area.dias || []).map((d) => {
        const celdas = turnos.map((t) => {
            const li = (d.limpiezas || []).find(x => x.turno === t.clave);
            if (!li || !li.hecha) return '<td class="vacio sep">—</td>';
            // Cuántos muebles de los que lleva el área, y cuáles no entraron en
            // ese turno. Es un DATO, no una falta: la norma pide el
            // procedimiento y su registro, no que cada turno pase por todos los
            // muebles. Se nombran porque un «11 de 26» sin decir cuáles obliga a
            // ir a buscarlo a otro lado, y el inspector está parado enfrente de
            // la vitrina.
            const total = li.puntos_total ?? 0;
            const cuenta = total ? ` ${li.puntos_hechos ?? 0} de ${total}` : '';
            const faltan = (li.puntos_faltantes || []).length
                ? `<br/>Sin limpiar: ${esc((li.puntos_faltantes || []).join(', '))}` : '';
            // Todo en un párrafo que fluye, no en tres líneas apiladas: con un
            // nombre corto el renglón ocupa UNA línea y el mes entra en la hoja.
            return `<td class="limpio sep"><span class="ok">✓</span>${esc(cuenta)} · ${
                esc(li.por || '')}${li.observaciones ? ` · ${esc(li.observaciones)}` : ''}${faltan}</td>`;
        }).join('');
        return `<tr${abreSemana(d.dia) ? ' class="semana"' : ''}>
            <td class="dia">${esc(diaNumero(d.dia))}<span class="dow">${esc(diaSemana(d.dia))}</span></td>
            ${celdas}</tr>`;
    }).join('');

    const muebles = (area.puntos || []).map(p => p.label);

    return `${banda(mes, 'Limpieza y orden', logo)}
    ${identidad([
        { k: 'Establecimiento', v: esc(mes.sucursal) },
        { k: 'Área', v: esc(area.nombre) },
        { k: 'Mes', v: esc(nombreMes(mes.periodo)) },
        { k: 'Muebles del área', v: String(muebles.length) },
    ])}
    <table class="reg">
        <colgroup>${cols.join('')}</colgroup>
        <thead>
            ${identEnCabeza(turnos.length + 1, [mes.sucursal, area.nombre, nombreMes(mes.periodo)])}
            <tr class="grupo"><th>Fecha</th>${cabeza}</tr>
        </thead>
        <tbody>${filas || `<tr><td colspan="${turnos.length + 1}" class="c">Sin días en el período</td></tr>`}</tbody>
    </table>
    <p class="leyenda"><b>—</b> sin registrar &nbsp;·&nbsp; <b>✓</b> registrada, con cuántos muebles
    se limpiaron de los que lleva el área.</p>
    ${muebles.length ? `<div class="desvios"><span class="t">Los ${muebles.length} muebles del área</span>${
        esc(muebles.join(' · '))}</div>` : ''}
    ${firmas(mes.cierre)}`;
}

/**
 * El libro foliado de dispensación bajo receta — la hoja ACOSTADA.
 *
 * Once columnas que la norma pide nombradas. En vertical hay que apretarlas
 * hasta que el nombre del medicamento se parte en cuatro líneas, así que ésta
 * es la única hoja del documento que va horizontal (pedido del usuario,
 * 2026-09-03).
 */
export function hojaDelLibro(mes, logo) {
    // El motivo de una anulación es una frase, y una frase adentro de una
    // columna de 6% estira el renglón entero a cinco veces su alto. Va al pie,
    // como las desviaciones de temperatura: en la fila queda la marca.
    const anuladas = (mes.libro || [])
        .filter(r => r.estado === 'anulada')
        .map(r => `${esc(r.folio)} · ${fecha(r.fecha)}: ${esc(r.motivo_anulacion || 'sin motivo anotado')}`);

    const filas = (mes.libro || []).map(r => `<tr>
        <td class="c folio"><strong>${esc(r.folio)}</strong>${
        r.estado === 'anulada' ? '<br/><span class="quien">ANULADA</span>' : ''}</td>
        <td>${fecha(r.fecha)}${r.hora ? `<br/><span class="quien">${esc(r.hora)}</span>` : ''}</td>
        <td>${esc(r.producto)}${r.laboratorio ? `<br/><span class="quien">${esc(r.laboratorio)}</span>` : ''}</td>
        <td class="n">${num(r.cantidad)}${r.prescrito ? `<br/><span class="quien">de ${num(r.prescrito)}</span>` : ''}</td>
        <td>${esc(r.lote || '')}</td>
        <td class="c">${fecha(r.vence)}</td>
        <td>${esc(r.paciente || '—')}</td>
        <td>${esc(r.documento || '—')}</td>
        <td>${esc(r.medico || '—')}${r.numero_junta ? `<br/><span class="quien">N.º junta ${esc(r.numero_junta)}</span>` : ''}</td>
        <td class="c">${esc(r.receta || '—')}</td>
        <td>${esc(r.vendedor || '')}</td>
    </tr>`).join('');

    return `${banda(mes, 'Dispensación bajo receta', logo)}
    ${identidad([
        { k: 'Establecimiento', v: esc(mes.sucursal) },
        { k: 'Mes', v: esc(nombreMes(mes.periodo)) },
        { k: 'Período cubierto', v: `Del ${fecha(mes.desde)} al ${fecha(mes.hasta)}`, chico: true },
        { k: 'Renglones foliados', v: String((mes.libro || []).length) },
    ])}
    <table class="reg">
        <colgroup>
            <col style="width:7%"/><col style="width:7%"/><col style="width:19%"/><col style="width:5%"/>
            <col style="width:8%"/><col style="width:7%"/><col style="width:12%"/><col style="width:9%"/>
            <col style="width:11%"/><col style="width:6%"/><col style="width:9%"/>
        </colgroup>
        <thead>
            ${identEnCabeza(11, [mes.sucursal, 'Dispensación bajo receta', nombreMes(mes.periodo)])}
            <tr class="sub">
                <th>Folio</th><th>Fecha</th><th>Medicamento</th><th>Cant.</th><th>Lote</th><th>Vence</th>
                <th>Paciente</th><th>Documento</th><th>Prescriptor</th><th>Receta</th><th>Despachó</th>
            </tr>
        </thead>
        <tbody>${filas || '<tr><td colspan="11" class="c">Sin renglones en el período</td></tr>'}</tbody>
    </table>
    <p class="leyenda">Contiene lo que exige el ítem 3.5 de la Guía de Verificación de BPAD:
    denominación, presentación, laboratorio, lote, fecha de expiración, fecha y cantidad dispensada,
    y quién despachó. <b>Cant.</b> es lo entregado sobre lo prescrito.</p>
    ${anuladas.length ? `<div class="desvios"><span class="t">Renglones anulados</span>${
        anuladas.join('<br/>')}</div>` : ''}
    ${firmas(mes.cierre)}`;
}

/** La portada: el resumen que el regente mira antes de firmar. */
export function portada(mes, logo) {
    const r = mes.resumen || {};
    const L = r.lecturas || {}; const Li = r.limpiezas || {};
    const cierre = mes.cierre;

    const alertas = [];
    if (L.faltantes > 0) alertas.push(`${L.faltantes} lecturas sin anotar`);
    if (L.sin_accion > 0) alertas.push(`${L.sin_accion} fuera de rango sin acción correctiva`);
    if (Li.faltantes > 0) alertas.push(`${Li.faltantes} limpiezas sin registrar`);
    for (const c of (r.calibracion_vencida || [])) {
        alertas.push(`Calibración vencida: ${c.area}${c.instrumento ? ` (${c.instrumento})` : ''}`);
    }

    const cifra = (k, v, chica) =>
        `<td><span class="k">${esc(k)}</span><span class="v${chica ? ' chica' : ''}">${esc(v)}</span></td>`;

    return `${banda(mes, 'Bitácoras del mes', logo)}
    ${identidad([
        { k: 'Establecimiento', v: esc(mes.sucursal) },
        { k: 'Mes', v: esc(nombreMes(mes.periodo)) },
        { k: 'Período cubierto', v: `Del ${fecha(mes.desde)} al ${fecha(mes.hasta)}`, chico: true },
        { k: 'Dirección', v: esc(mes.direccion || 'No declarada'), chico: true },
    ])}

    <h2>Temperatura y humedad</h2>
    <table class="cifras"><tr>
        ${cifra('Cumplimiento', pct(L.hechas, L.esperadas))}
        ${cifra('Anotadas', `${L.hechas ?? 0} de ${L.esperadas ?? 0}`, true)}
        ${cifra('Faltantes', String(L.faltantes ?? 0))}
        ${cifra('Fuera de hora', String(L.tarde ?? 0))}
        ${cifra('Fuera de rango', String(L.fuera_de_rango ?? 0))}
        ${cifra('Correcciones', String(r.correcciones ?? 0))}
    </tr></table>

    <h2>Limpieza y orden</h2>
    <table class="cifras"><tr>
        ${cifra('Cumplimiento', pct(Li.hechas, Li.esperadas))}
        ${cifra('Registradas', `${Li.hechas ?? 0} de ${Li.esperadas ?? 0}`, true)}
        ${cifra('Faltantes', String(Li.faltantes ?? 0))}
    </tr></table>

    <h2>Dispensación bajo receta</h2>
    <table class="cifras"><tr>
        ${cifra('Renglones foliados', String((mes.libro || []).length))}
        ${cifra('Anulados', String((mes.libro || []).filter(r => r.estado === 'anulada').length))}
        ${cifra('Con receta física', String((mes.libro || []).filter(r => r.receta).length))}
    </tr></table>

    <h2>${alertas.length ? 'Lo que quedó pendiente' : 'Sin pendientes'}</h2>
    ${alertas.length
        ? `<ul class="pendientes">${alertas.map(a => `<li>${esc(a)}</li>`).join('')}</ul>`
        : '<p class="suelto">El mes quedó completo.</p>'}

    ${cierre?.accion === 'cerrar' && cierre.motivo
        ? `<h2>Observaciones del regente</h2><p class="suelto">${esc(cierre.motivo)}</p>` : ''}

    ${firmas(cierre)}
    <p class="nota">Registros conservados conforme al RTS 11.02.04:24 §6.2.16 (temperatura y humedad,
    2 años) y a la Guía de Verificación de BPAD ítem 3.12 (dispensación bajo receta, 1 año).</p>`;
}

/**
 * Las hojas del mes, en orden y cada una con su clase de página.
 *
 * Se devuelve la LISTA y no el documento entero para que el generador de
 * maquetas pueda dibujarlas de a una. `armarHtmlDelMes` las pega.
 *
 * @returns {Array<{titulo: string, html: string, acostada: boolean}>}
 */
export function hojasDelMes(mes, logo = null) {
    const areas = mes.areas || [];
    // Un área de sólo limpieza —vitrinas, servicio sanitario— no tiene franjas,
    // y su tabla de temperatura saldría con la columna «Fecha» sola.
    const conLecturas = areas.filter(a => (a.franjas || []).length);
    const conLimpieza = areas.filter(a => (a.limpiezas || []).length);

    return [
        { titulo: 'Resumen del mes', html: portada(mes, logo), acostada: false },
        ...conLecturas.map(a => ({
            titulo: `Temperatura y humedad · ${a.nombre}`,
            html: hojaDeArea(mes, a, logo),
            acostada: false,
        })),
        ...conLimpieza.map(a => ({
            titulo: `Limpieza y orden · ${a.nombre}`,
            html: hojaDeLimpieza(mes, a, logo),
            acostada: false,
        })),
        { titulo: 'Dispensación bajo receta', html: hojaDelLibro(mes, logo), acostada: true },
    ];
}

/** El CSS del papel, para quien quiera dibujarlo fuera de la impresión. */
export const CSS_DEL_PAPEL = CSS;

/** El documento entero, listo para escribir en la ventana de impresión. */
export function armarHtmlDelMes(mes, logo = null) {
    const hojas = hojasDelMes(mes, logo);
    const cuerpo = hojas.map((h, i) => `<section class="${
        h.acostada ? 'libro' : ''}${i < hojas.length - 1 ? ' pb' : ''}">${h.html}</section>`).join('');

    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
        <title>Bitácoras ${esc(mes.sucursal)} ${esc(mes.periodo)}</title>
        <style>${CSS}</style></head><body>${cuerpo}</body></html>`;
}
