// Los dos papeles de la regencia (2026-11-10).
//
// 1. El RÓTULO de la entrada: nombre del regente, su número de la Junta de
//    Vigilancia de la Profesión Químico Farmacéutica y su horario de asistencia.
//    Va a la vista del público (RTS 11.02.04:24 §6.2.3; guía de verificación
//    BPAD de la SRS, ítem 2.3).
// 2. La HOJA DE ASISTENCIA del mes: fecha, horario, actividades y renglones
//    para la firma y el sello del regente. La norma pide firma y sello, y una
//    firma escrita con el teclado de otro no es la de nadie: el portal lleva el
//    registro, el papel lleva la firma (mismo criterio que la constancia de
//    sanción). Se conserva al menos 1 año (RTS §6.3.7 de consulta).
//
// El papel no tiene tema: sólo negro, sin tokens. Son funciones puras que
// devuelven HTML; la pantalla lo manda a imprimir por `@plataforma`.
import { EMPRESA } from '../constants/empresa';
import { hora12 } from './hora';
import { fechaTexto } from './fecha';
import { rotuloDeActividad } from '../data/regencia';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
               'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const nombreDelMes = (iso) => {
    const [a, m] = String(iso || '').slice(0, 7).split('-').map(Number);
    return a && m ? `${MESES[m - 1]} de ${a}` : '';
};

const BASE = `
  @page { size: letter; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; margin: 0; }
`;

/** El rótulo de la entrada, en una hoja carta horizontal. */
export function htmlDelRotulo(regencia) {
    const nombre = regencia?.regente?.nombre || '';
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Rótulo del regente · ${esc(regencia?.sala)}</title>
<style>${BASE}
  @page { size: letter landscape; margin: 16mm; }
  .marco { border: 3px solid #000; padding: 18mm 16mm; min-height: 160mm; display: flex; flex-direction: column; justify-content: center; text-align: center; gap: 10mm; }
  .titulo { font-size: 30pt; font-weight: 800; letter-spacing: 2px; }
  .nombre { font-size: 34pt; font-weight: 800; }
  .dato { font-size: 18pt; }
  .horario { font-size: 22pt; font-weight: 700; white-space: pre-line; }
  .pie { font-size: 11pt; margin-top: 6mm; }
</style></head><body>
<div class="marco">
  <div class="titulo">REGENTE QUÍMICO FARMACÉUTICO</div>
  <div class="nombre">${esc(nombre) || '&nbsp;'}</div>
  <div class="dato">Inscripción JVPQF N.º ${esc(regencia?.jvpqf) || '______________'}</div>
  <div class="dato">Horario de asistencia</div>
  <div class="horario">${esc(regencia?.horario) || '______________________________'}</div>
  <div class="pie">${esc(EMPRESA.razonSocial)} · ${esc(regencia?.sala)}</div>
</div>
</body></html>`;
}

/** La hoja de asistencia del mes, con renglones para firma y sello. */
export function htmlDeLaHojaDeAsistencia(regencia) {
    const visitas = (regencia?.visitas || []).filter((v) => !v.anulada_at)
        .slice().sort((a, b) => String(a.fecha + a.entrada).localeCompare(String(b.fecha + b.entrada)));
    const filas = visitas.map((v) => `
      <tr>
        <td>${esc(fechaTexto(v.fecha, { day: '2-digit', month: '2-digit', year: 'numeric' }))}</td>
        <td>${esc(hora12(v.entrada))}</td>
        <td>${esc(hora12(v.salida))}</td>
        <td class="num">${esc(Number(v.horas).toFixed(2))}</td>
        <td>${esc((v.actividades || []).map(rotuloDeActividad).join('; '))}${v.notas ? `<div class="nota">${esc(v.notas)}</div>` : ''}</td>
        <td class="firma"></td>
      </tr>`).join('');
    // Renglones en blanco para lo que se anote a mano antes de cargarlo.
    const vacias = Array.from({ length: Math.max(0, 8 - visitas.length) }, () =>
        '<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td class="firma"></td></tr>').join('');
    const total = visitas.reduce((s, v) => s + Number(v.horas || 0), 0);
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Asistencia del regente · ${esc(regencia?.sala)} · ${esc(nombreDelMes(regencia?.mes))}</title>
<style>${BASE}
  h1 { font-size: 15pt; margin: 0 0 2mm; }
  .sub { font-size: 10pt; margin-bottom: 5mm; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th, td { border: 1px solid #000; padding: 2mm; vertical-align: top; text-align: left; }
  th { font-size: 8.5pt; text-transform: uppercase; }
  .num { text-align: right; white-space: nowrap; }
  .firma { width: 42mm; height: 13mm; }
  .nota { font-size: 8.5pt; margin-top: 1mm; }
  .tot { margin-top: 4mm; font-size: 10pt; }
</style></head><body>
<h1>Registro de asistencia del regente</h1>
<div class="sub">
  ${esc(EMPRESA.razonSocial)} · <b>${esc(regencia?.sala)}</b> · ${esc(nombreDelMes(regencia?.mes))}<br>
  Regente: <b>${esc(regencia?.regente?.nombre) || '—'}</b> · JVPQF N.º ${esc(regencia?.jvpqf) || '—'}
  ${regencia?.minimo ? ` · Mínimo de la categoría: ${esc(regencia.minimo)} h al mes` : ''}
</div>
<table>
  <thead><tr><th>Fecha</th><th>Entrada</th><th>Salida</th><th>Horas</th><th>Actividades realizadas</th><th>Firma y sello</th></tr></thead>
  <tbody>${filas}${vacias}</tbody>
</table>
<div class="tot">Total del mes: <b>${esc(total.toFixed(2))} h</b></div>
</body></html>`;
}
