// ═══════════════════════════════════════════════════════════════════════════
// La respuesta a una solicitud de acceso, en papel.
//
// El Art. 8 pide que la información se entregue «en forma clara y exenta de
// codificaciones, acompañada de una explicación de los términos», así que esto
// no es un volcado de la ficha: es una hoja con rótulos en español, sin claves
// internas y sin identificadores del sistema.
//
// Y NO lleva el detalle de cada compra. El mismo artículo pide claridad, y
// trescientos renglones de factura no son claros; además el informe «en ningún
// caso podrá revelar datos pertenecientes a terceros», y una línea de venta
// nombra al vendedor. Si la persona pide el detalle, se le entrega aparte.
// ═══════════════════════════════════════════════════════════════════════════

import { EMPRESA } from '../constants/empresa';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const dia = (v) => {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('es-SV', { day: 'numeric', month: 'long', year: 'numeric' });
};

const dinero = (n) => (n === null || n === undefined || n === '')
    ? null
    : `US$ ${Number(n).toFixed(2)}`;

/** Un renglón sólo existe si tiene valor: una fila vacía dice «no tenemos» mal. */
const fila = (rotulo, valor) => (valor === null || valor === undefined || valor === '')
    ? ''
    : `<tr><th>${esc(rotulo)}</th><td>${esc(valor)}</td></tr>`;

/**
 * Arma la hoja de respuesta.
 *
 * @param {object} args
 * @param {object} args.solicitud   la fila de `solicitudes_datos`
 * @param {object|null} args.cliente   la ficha de cliente encontrada
 * @param {object|null} args.empleado  la ficha de personal encontrada
 * @param {object|null} args.resumen   lo que devuelve `resumenDeCliente`
 * @returns {string} documento HTML completo
 */
export function papelDeRespuesta({ solicitud, cliente, empleado, resumen }) {
    const hoy = new Date().toLocaleDateString('es-SV',
        { day: 'numeric', month: 'long', year: 'numeric' });

    const bloques = [];

    if (cliente) {
        bloques.push(`
        <section>
          <h2>Su ficha de cliente</h2>
          <table class="datos">
            ${fila('Nombre', cliente.name)}
            ${fila('Documento de identidad', cliente.dui)}
            ${fila('Número de identificación tributaria', cliente.nit)}
            ${fila('Teléfono', cliente.phone)}
            ${fila('Correo electrónico', cliente.email)}
            ${fila('Dirección', cliente.direccion)}
            ${fila('Fecha de nacimiento', dia(cliente.fecha_nacimiento))}
            ${fila('Participa en el programa de puntos', cliente.acumula_puntos === false ? 'No' : 'Sí')}
          </table>
        </section>`);
    }

    if (resumen?.compras) {
        const c = resumen.compras;
        bloques.push(`
        <section>
          <h2>Sus compras</h2>
          <p class="nota">Es el resumen de lo que consta a su nombre. El detalle
          de cada compra se entrega aparte, si usted lo pide.</p>
          <table class="datos">
            ${fila('Documentos de venta a su nombre', c.facturas)}
            ${fila('De ellos, con crédito fiscal', c.facturas_ccf)}
            ${fila('Anulados', c.facturas_anuladas)}
            ${fila('Monto acumulado', dinero(c.total))}
            ${fila('Primera compra registrada', dia(c.primera_fecha))}
            ${fila('Última compra registrada', dia(c.ultima_fecha))}
          </table>
        </section>`);
    }

    if (resumen?.puntos) {
        const p = resumen.puntos;
        bloques.push(`
        <section>
          <h2>Su cuenta de puntos</h2>
          <table class="datos">
            ${fila('Puntos disponibles', p.saldo)}
            ${fila('Puntos ganados en total', p.ganados)}
            ${fila('Puntos ya canjeados', p.usados)}
            ${fila('Cuenta activa', p.activa === false ? 'No' : 'Sí')}
          </table>
        </section>`);
    }

    if (resumen?.creditoPendiente) {
        bloques.push(`
        <section>
          <h2>Su crédito</h2>
          <table class="datos">
            ${fila('Saldo pendiente', dinero(resumen.creditoPendiente))}
          </table>
        </section>`);
    }

    if (empleado) {
        bloques.push(`
        <section>
          <h2>Su expediente de personal</h2>
          <table class="datos">
            ${fila('Nombre', empleado.name)}
            ${fila('Código', empleado.code)}
            ${fila('Documento de identidad', empleado.dui)}
            ${fila('Teléfono', empleado.phone)}
            ${fila('Correo electrónico', empleado.email)}
            ${fila('Dirección', empleado.address)}
            ${fila('Fecha de nacimiento', dia(empleado.birth_date))}
          </table>
          <p class="nota">Su expediente completo, con marcaciones, horarios,
          permisos y planilla, se consulta en el módulo de personal y se entrega
          impreso si usted lo solicita.</p>
        </section>`);
    }

    if (!bloques.length) {
        bloques.push(`
        <section>
          <h2>No consta información suya</h2>
          <p>Con los datos de su solicitud no se encontró ninguna ficha a su
          nombre en los registros de la Empresa.</p>
        </section>`);
    }

    return `<!doctype html><html lang="es" data-theme="light"><head><meta charset="utf-8">
<title>Respuesta ${esc(solicitud.folio_txt)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { --paper:#FAFAF8; --ink:#161A18; --ink-2:#4E554F; --ink-3:#7E857F; --rule:#DCDFDA; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--paper); color:var(--ink);
         font-family:Georgia,"Times New Roman",serif; font-size:16px; line-height:1.55; }
  .doc { max-width:42rem; margin:0 auto; padding:clamp(1.5rem,5vw,3rem) clamp(1.15rem,5vw,2rem) 4rem; }
  .membrete { border-bottom:1px solid var(--ink); padding-bottom:.75rem; margin-bottom:1.3rem;
              display:flex; align-items:flex-end; justify-content:space-between; gap:1.6rem; }
  .membrete img { width:150px; height:auto; display:block; }
  h1 { font-family:system-ui,sans-serif; font-size:1.5rem; font-weight:700;
       letter-spacing:-.025em; margin:0 0 .25rem; }
  .sub { font-family:system-ui,sans-serif; font-size:.8rem; font-weight:600;
         color:var(--ink-2); margin:0; }
  section { margin-top:1.5rem; }
  h2 { font-family:system-ui,sans-serif; font-size:.95rem; font-weight:700;
       margin:0 0 .5rem; padding-bottom:.3rem; border-bottom:1px solid var(--rule); }
  p { margin:0 0 .6rem; }
  .nota { font-size:.84rem; color:var(--ink-2); }
  table.datos { border-collapse:collapse; width:100%; font-family:system-ui,sans-serif; font-size:.9rem; }
  table.datos th, table.datos td { border-bottom:1px solid var(--rule); padding:.42rem .5rem;
                                   text-align:left; vertical-align:top; }
  table.datos th { font-weight:600; color:var(--ink-2); width:42%; }
  .firma { margin-top:3rem; }
  .firma .linea { border-top:1px solid var(--ink); width:min(100%,17rem); margin:3rem 0 .4rem; }
  .firma .nombre { font-family:system-ui,sans-serif; font-size:.8rem; font-weight:700; margin:0; }
  .firma .cargo { font-family:system-ui,sans-serif; font-size:.72rem; color:var(--ink-2); margin:0; }
  @media print { body { background:#fff; color:#000; font-size:10pt; }
                 .doc { max-width:none; padding:0; } h2 { break-after:avoid; }
                 section { break-inside:avoid; } }
</style>
</head><body>
<div class="doc">
  <div class="membrete">
    <div>
      <h1>Respuesta a su solicitud</h1>
      <p class="sub">Formulario n.º ${esc(solicitud.folio_txt)} &nbsp;·&nbsp; ${esc(hoy)}</p>
    </div>
    <img src="/logo-farmacias.png" alt="${esc(EMPRESA.nombreComercial)}">
  </div>

  <p>Señor(a) <strong>${esc(solicitud.solicitante_nombre ?? '')}</strong>: en
  atención a la solicitud que presentó el
  ${esc(dia(solicitud.recibida_at) ?? '')}, se le informa lo que la Empresa
  conserva sobre usted.</p>

  ${bloques.join('\n')}

  <section>
    <h2>Qué se hizo con esta información</h2>
    <p class="nota">Los usos, con quién se comparte y cuánto tiempo se conserva
    constan en el aviso de privacidad, disponible en esta sala de ventas y en
    portal.farmasalud.lat/privacidad. Si algún dato de esta hoja está
    equivocado, puede pedir su corrección con una solicitud nueva.</p>
  </section>

  <div class="firma">
    <div class="linea"></div>
    <p class="nombre">${esc(EMPRESA.propietario)}</p>
    <p class="cargo">Por ${esc(EMPRESA.nombreComercial)}</p>
  </div>
</div>
</body></html>`;
}

/** Las filas para el archivo de portabilidad (Art. 14: lectura mecánica). */
export function filasParaPortabilidad({ cliente, empleado, resumen }) {
    const filas = [];
    const meter = (grupo, dato, valor) => {
        if (valor !== null && valor !== undefined && valor !== '') filas.push([grupo, dato, String(valor)]);
    };
    if (cliente) {
        meter('Ficha de cliente', 'Nombre', cliente.name);
        meter('Ficha de cliente', 'Documento de identidad', cliente.dui);
        meter('Ficha de cliente', 'Numero de identificacion tributaria', cliente.nit);
        meter('Ficha de cliente', 'Telefono', cliente.phone);
        meter('Ficha de cliente', 'Correo electronico', cliente.email);
        meter('Ficha de cliente', 'Direccion', cliente.direccion);
        meter('Ficha de cliente', 'Fecha de nacimiento', cliente.fecha_nacimiento);
    }
    if (resumen?.compras) {
        const c = resumen.compras;
        meter('Compras', 'Documentos de venta', c.facturas);
        meter('Compras', 'Con credito fiscal', c.facturas_ccf);
        meter('Compras', 'Anulados', c.facturas_anuladas);
        meter('Compras', 'Monto acumulado', c.total);
        meter('Compras', 'Primera compra', c.primera_fecha);
        meter('Compras', 'Ultima compra', c.ultima_fecha);
    }
    if (resumen?.puntos) {
        meter('Puntos', 'Saldo', resumen.puntos.saldo);
        meter('Puntos', 'Ganados', resumen.puntos.ganados);
        meter('Puntos', 'Canjeados', resumen.puntos.usados);
    }
    if (resumen?.creditoPendiente) meter('Credito', 'Saldo pendiente', resumen.creditoPendiente);
    if (empleado) {
        meter('Expediente de personal', 'Nombre', empleado.name);
        meter('Expediente de personal', 'Codigo', empleado.code);
        meter('Expediente de personal', 'Documento de identidad', empleado.dui);
        meter('Expediente de personal', 'Telefono', empleado.phone);
        meter('Expediente de personal', 'Correo electronico', empleado.email);
        meter('Expediente de personal', 'Direccion', empleado.address);
        meter('Expediente de personal', 'Fecha de nacimiento', empleado.birth_date);
    }
    return filas;
}
