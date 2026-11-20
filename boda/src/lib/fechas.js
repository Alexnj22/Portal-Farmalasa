import { boda, fechaBoda } from '../config';
import { locale, t } from './idioma';
import { ahora } from './reloj';

const tz = boda.zonaHoraria;

export const fechaLarga = (d = fechaBoda) =>
  d.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz });

export const fechaCorta = (d = fechaBoda) =>
  d.toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: tz }).replaceAll('/', ' · ');

export const fechaHora = (iso) =>
  new Date(iso).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// `fecha` = 'AAAA-MM-DD' (la que manda la base, o la del config).
export const limiteConfirmar = (fecha = boda.confirmarAntesDe) =>
  new Date(`${fecha}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'long' });

/** ¿Ya pasó la fecha límite? Con la fecha del LUGAR de la boda, no la del teléfono. */
export const plazoVencido = (fecha = boda.confirmarAntesDe) =>
  ahora().toLocaleDateString('en-CA', { timeZone: tz }) > fecha;

/** Días que faltan (incluido hoy) para la fecha límite; negativo si ya pasó. */
export function diasParaConfirmar(fecha = boda.confirmarAntesDe) {
  const hoy = ahora().toLocaleDateString('en-CA', { timeZone: tz });
  return Math.round((Date.parse(`${fecha}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 864e5);
}

function ics(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Archivo .ics para "Agregar al calendario" (Apple, Outlook, etc.). */
// Sin hora confirmada: evento de todo el día (AAAAMMDD), sin lugar.
const diaIcs = (d) => d.toLocaleDateString('en-CA', { timeZone: tz }).replaceAll('-', '');
const diaSiguiente = (d) => new Date(d.getTime() + 864e5);

export function descargarIcs() {
  const fin = new Date(fechaBoda.getTime() + 10 * 3600e3);
  const conHora = boda.horaConfirmada !== false;
  const lugar = conHora ? boda.lugares[0] : null;
  const texto = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//boda//ES', 'BEGIN:VEVENT',
    `UID:${ics(fechaBoda)}@boda`, `DTSTAMP:${ics(new Date())}`,
    ...(conHora ? [`DTSTART:${ics(fechaBoda)}`, `DTEND:${ics(fin)}`]
      : [`DTSTART;VALUE=DATE:${diaIcs(fechaBoda)}`, `DTEND;VALUE=DATE:${diaIcs(diaSiguiente(fechaBoda))}`]),
    `SUMMARY:${t('Boda de', 'Wedding of')} ${boda.novios.firma}`,
    `LOCATION:${lugar ? `${lugar.nombre}, ${lugar.direccion}` : ''}`,
    `DESCRIPTION:${window.location.origin}`,
    'BEGIN:VALARM', 'TRIGGER:-P7D', 'ACTION:DISPLAY', `DESCRIPTION:${t('¡Falta una semana!', 'One week to go!')}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const a = document.createElement('a');
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/calendar' }));
  a.href = url;
  a.download = 'boda.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000); // se libera cuando la descarga ya tomó el archivo
}

/**
 * «Guardar la fecha»: un solo botón que hace lo correcto en cada teléfono.
 * iPhone, iPad y Mac abren /boda.ics (un archivo real, que Calendario ofrece
 * agregar; la descarga de un blob en Safari no lo hace). El resto, Google
 * Calendar, que es el calendario de Android.
 */
export function guardarFecha() {
  const apple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
  return apple ? { href: '/boda.ics' } : { href: enlaceGoogleCalendar(), target: '_blank', rel: 'noreferrer' };
}

export function enlaceGoogleCalendar() {
  const fin = new Date(fechaBoda.getTime() + 10 * 3600e3);
  const conHora = boda.horaConfirmada !== false;
  const lugar = conHora ? boda.lugares[0] : null;
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${t('Boda de', 'Wedding of')} ${boda.novios.firma}`,
    dates: conHora ? `${ics(fechaBoda)}/${ics(fin)}` : `${diaIcs(fechaBoda)}/${diaIcs(diaSiguiente(fechaBoda))}`,
    details: window.location.origin,
    location: lugar ? `${lugar.nombre}, ${lugar.direccion}` : '',
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

/** «8:42 p. m.»: la hora de un aviso, en la zona de la boda. */
export const horaCorta = (iso) =>
  new Date(iso).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', timeZone: tz });
