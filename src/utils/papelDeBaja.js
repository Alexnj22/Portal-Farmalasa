// El acta de inasistencias y la carta de terminación de una baja por abandono
// o por despido con causa (2026-11-14).
//
// Quien deja de llegar no firma nada. Lo que la ley pide es del PATRONO: que
// el despido conste por escrito y firmado por él o su representante (Art. 55
// CT) — dicho por otra persona y sin ese escrito, no termina el contrato— y,
// para defenderlo si hay demanda (60 días, Art. 610), la prueba de la causal:
// las ausencias (Art. 50, causal 12) y los intentos de contacto. El portal arma
// los dos papeles con lo que se llenó en la baja; se imprimen, se firman, la
// carta se entrega o se envía a su domicilio, y el escaneo se sube después.
//
// El papel no tiene tema: sólo negro. Función pura que devuelve HTML.
import { EMPRESA } from '../constants/empresa';
import { fechaTexto } from './fecha';
import { CAUSALES_ART_50 } from './bajaLegal';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const larga = (f) => (f ? fechaTexto(f, { day: 'numeric', month: 'long', year: 'numeric' }) : '________________');

/** ¿Este motivo lleva acta y carta? */
export const llevaActaYCarta = (motivo) => motivo === 'ABANDONO' || motivo === 'DESPIDO_SIN_RESPONSABILIDAD';

/**
 * @param {{ empleado: any, sucursal?: string, cargo?: string, formData: any, emitido?: string }} p
 */
export function htmlDeActaYCarta({ empleado, sucursal, cargo, formData: d = {}, emitido }) {
    const nombre = esc(empleado?.name || '');
    const dui = empleado?.dui ? ` con DUI ${esc(empleado.dui)}` : '';
    const causal = d.terminationReason === 'ABANDONO' ? 12 : Number(d.causalArt50);
    const textoCausal = CAUSALES_ART_50.find((c) => c.n === causal)?.texto || '';
    const ausencias = (d.diasDeAusencia || []).slice().sort();
    const hoy = emitido || d.date;

    const acta = ausencias.length ? `
<section>
  <h1>Acta de inasistencias</h1>
  <p class="sub">${esc(EMPRESA.razonSocial)} · ${esc(sucursal || '')}</p>
  <p>En ${esc(sucursal || '__________')}, a los ${esc(larga(hoy))}, se hace constar que <b>${nombre}</b>${dui}, ${esc(cargo || 'empleado(a)')}, no se presentó a sus labores, sin permiso ni causa justificada conocida, los días:</p>
  <table><thead><tr><th>#</th><th>Fecha</th></tr></thead><tbody>
    ${ausencias.map((f, i) => `<tr><td>${i + 1}</td><td>${esc(larga(f))}</td></tr>`).join('')}
  </tbody></table>
  <p>Último día que trabajó: <b>${esc(larga(d.ultimoDiaLaborado))}</b>.</p>
  ${d.intentoDeContacto ? `<p><b>Intentos de contacto:</b> ${esc(d.intentoDeContacto).replace(/\n/g, '<br>')}</p>` : ''}
  <div class="firmas">
    <div class="firma"><div class="linea"></div>Jefe(a) inmediato(a)</div>
    <div class="firma"><div class="linea"></div>Testigo</div>
    <div class="firma"><div class="linea"></div>Testigo</div>
  </div>
</section>` : '';

    const carta = `
<section class="${acta ? 'salto' : ''}">
  <p class="der">${esc(sucursal || '')}, ${esc(larga(hoy))}</p>
  <p>Señor(a)<br><b>${nombre}</b><br>${esc(cargo || '')}<br>Presente.</p>
  <p>Por este medio le comunico que, con fecha <b>${esc(larga(d.date))}</b>, se da por terminado el contrato individual de trabajo que nos une, sin responsabilidad para el patrono, con base en el artículo 50 del Código de Trabajo, causal ${esc(causal || '___')}${textoCausal ? `: ${esc(textoCausal.toLowerCase())}` : ''}.</p>
  ${ausencias.length ? `<p>Usted faltó a sus labores sin permiso ni causa justificada los días ${ausencias.map((f) => esc(larga(f))).join(', ')}.</p>` : ''}
  ${d.terminationReason !== 'ABANDONO' && d.fechaDeLosHechos ? `<p>Los hechos ocurrieron el ${esc(larga(d.fechaDeLosHechos))}.</p>` : ''}
  <p>Puede presentarse a recibir lo que le corresponda por los días trabajados y, si las tiene ganadas, sus vacaciones, y a entregar el carné, el uniforme y lo que tenga de la empresa.</p>
  <p>Atentamente,</p>
  <div class="firmas uno">
    <div class="firma"><div class="linea"></div>${esc(EMPRESA.patrono)}<br><span>Patrono, o su representante</span></div>
  </div>
  <div class="recibe">
    <p><b>Constancia de entrega</b> — Recibí: ______________________ Fecha: __________</p>
    <p>Si no se pudo entregar en persona: enviada a su domicilio el ______________ por ______________________.</p>
  </div>
</section>`;

    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Terminación · ${nombre}</title>
<style>
  @page { size: letter; margin: 18mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; margin: 0; font-size: 11.5pt; line-height: 1.45; }
  h1 { font-size: 16pt; margin: 0; }
  .sub { margin: 2px 0 14px; font-size: 10pt; border-bottom: 2px solid #000; padding-bottom: 6px; }
  .der { text-align: right; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  th, td { border: 1px solid #000; padding: 4px 6px; text-align: left; }
  .firmas { display: flex; gap: 24px; margin-top: 56px; }
  .firmas.uno { max-width: 320px; }
  .firma { flex: 1; text-align: center; font-size: 10pt; }
  .firma .linea { border-top: 1px solid #000; margin-bottom: 4px; }
  .firma span { font-size: 9pt; }
  .recibe { margin-top: 36px; border-top: 1px dashed #000; padding-top: 8px; font-size: 10pt; }
  .salto { page-break-before: always; break-before: page; }
</style></head><body>${acta}${carta}</body></html>`;
}
