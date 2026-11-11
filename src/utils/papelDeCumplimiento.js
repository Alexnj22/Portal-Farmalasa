// El papel de cada registro de cumplimiento (2026-11-11).
//
// El portal lleva el registro; el papel lleva la firma y el sello (mismo
// criterio que la hoja de asistencia del regente). Un solo maquetador para
// todos los tipos, a partir de `TIPOS`: los campos en una tabla, la lista de
// verificación con su resultado, y renglones de firma. En la capacitación, la
// lista de asistentes lleva una columna para que cada uno firme.
//
// El papel no tiene tema: sólo negro, sin tokens. Función pura que devuelve
// HTML; la pantalla lo manda a imprimir por `@plataforma`.
import { EMPRESA } from '../constants/empresa';
import { fechaTexto } from './fecha';
import { TIPOS, listaDe, nombreDelSemestre, puntuarLista } from './cumplimiento';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const RESPUESTA = { si: 'Cumple', no: 'No cumple', na: 'No aplica' };

const FIRMAS = {
    farmacovigilancia: ['Referente de farmacovigilancia', 'Regente'],
    reporte_cero: ['Referente de farmacovigilancia', 'Regente'],
    vencido: ['Responsable de la sala', 'Regente'],
    destruccion: ['Regente', 'Representante de la gestora', 'Testigo'],
    retiro: ['Responsable de la sala', 'Regente'],
    autoinspeccion: ['Regente', 'Responsable de la sala'],
    a_la_vista: ['Regente', 'Responsable de la sala'],
    capacitacion: ['Facilitador', 'Regente'],
};

function valorDe(campo, v) {
    if (v === undefined || v === null || v === '') return '—';
    if (campo.tipo === 'opciones') return campo.opciones.find((o) => o.value === v)?.label ?? v;
    if (campo.tipo === 'fecha') return fechaTexto(v, { day: '2-digit', month: 'long', year: 'numeric' }) || v;
    if (campo.tipo === 'semestre') return nombreDelSemestre(v);
    if (campo.tipo === 'lista') return (v || []).map(esc).join('<br>');
    return esc(v);
}

/** El HTML imprimible de un registro. */
export function htmlDelRegistro(registro) {
    const def = TIPOS[registro?.tipo];
    if (!def) return '';
    const d = registro.datos || {};
    const filas = def.campos
        .filter((c) => !['checklist', 'personas', 'fijo'].includes(c.tipo))
        .map((c) => `<tr><th>${esc(c.label)}</th><td>${valorDe(c, d[c.key])}</td></tr>`)
        .join('');

    const lista = listaDe(registro.tipo);
    let bloqueLista = '';
    if (lista.length) {
        const p = puntuarLista(lista, d.respuestas);
        bloqueLista = lista.map((s) => `
            <h3>${esc(s.seccion)}</h3>
            <table class="lista"><tbody>${s.items.map((it) => `
              <tr><td>${esc(it.texto)}${it.peso === 'C' ? ' <b>(crítico)</b>' : ''}</td>
                  <td class="r">${esc(RESPUESTA[d.respuestas?.[it.id]] || '—')}</td></tr>`).join('')}
            </tbody></table>`).join('') + `
            <p class="res"><b>Resultado:</b> ${p.si} de ${p.total - p.na} cumplen (${p.porcentaje} %).
            ${p.fallas.C ? `${p.fallas.C} crítico(s) sin cumplir. ` : ''}${p.aprueba ? 'Aprueba.' : 'No aprueba.'}</p>
            ${d.plan ? `<h3>Plan de acción</h3><p>${esc(d.plan).replace(/\n/g, '<br>')}</p>` : ''}`;
    }

    let bloqueAsistentes = '';
    if (Array.isArray(d.asistentes) && d.asistentes.length) {
        bloqueAsistentes = `<h3>Asistentes</h3>
          <table class="lista"><thead><tr><th>#</th><th>Nombre</th><th>Firma</th></tr></thead><tbody>
          ${d.asistentes.map((a, i) => `<tr><td>${i + 1}</td><td>${esc(a.nombre)}</td><td class="firma-col"></td></tr>`).join('')}
          </tbody></table>`;
    }

    const firmas = (FIRMAS[registro.tipo] || ['Responsable']).map((f) => `<div class="firma"><div class="linea"></div>${esc(f)}<br><span>Firma y sello</span></div>`).join('');

    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(def.titulo)} · ${esc(registro.sala)}</title>
<style>
  @page { size: letter; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; margin: 0; font-size: 11pt; }
  header { border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 12px; }
  header h1 { font-size: 16pt; margin: 0; }
  header p { margin: 2px 0 0; font-size: 10pt; }
  h3 { font-size: 11pt; margin: 14px 0 4px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #000; padding: 5px 6px; vertical-align: top; text-align: left; }
  table.datos th { width: 34%; font-weight: bold; }
  table.lista td.r { width: 22%; }
  td.firma-col { width: 40%; height: 26px; }
  .res { margin-top: 8px; }
  .anulado { border: 2px solid #000; padding: 6px; font-weight: bold; margin-bottom: 10px; }
  .firmas { display: flex; gap: 24px; margin-top: 48px; }
  .firma { flex: 1; text-align: center; font-size: 10pt; }
  .firma .linea { border-top: 1px solid #000; margin-bottom: 4px; }
  .firma span { font-size: 9pt; }
</style></head><body>
<header>
  <h1>${esc(def.titulo)}</h1>
  <p>${esc(EMPRESA.razonSocial)} · ${esc(registro.sala)} · ${esc(fechaTexto(registro.fecha, { day: '2-digit', month: 'long', year: 'numeric' }))} · Registro N.º ${esc(registro.id)}</p>
</header>
${registro.anulado_at ? `<div class="anulado">ANULADO: ${esc(registro.anulado_motivo)}</div>` : ''}
<table class="datos"><tbody>${filas}</tbody></table>
${bloqueLista}
${bloqueAsistentes}
<div class="firmas">${firmas}</div>
</body></html>`;
}
