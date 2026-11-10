import { boda, fechaBoda } from '../config';
import { locale, t } from './idioma';

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
  new Date().toLocaleDateString('en-CA', { timeZone: tz }) > fecha;

function ics(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Archivo .ics para "Agregar al calendario" (Apple, Outlook, etc.). */
export function descargarIcs() {
  const fin = new Date(fechaBoda.getTime() + 10 * 3600e3);
  const lugar = boda.lugares[0];
  const texto = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//boda//ES', 'BEGIN:VEVENT',
    `UID:${ics(fechaBoda)}@boda`, `DTSTAMP:${ics(new Date())}`,
    `DTSTART:${ics(fechaBoda)}`, `DTEND:${ics(fin)}`,
    `SUMMARY:${t('Boda de', 'Wedding of')} ${boda.novios.firma}`,
    `LOCATION:${lugar ? `${lugar.nombre}, ${lugar.direccion}` : ''}`,
    `DESCRIPTION:${window.location.origin}`,
    'BEGIN:VALARM', 'TRIGGER:-P7D', 'ACTION:DISPLAY', `DESCRIPTION:${t('¡Falta una semana!', 'One week to go!')}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: 'text/calendar' }));
  a.download = 'boda.ics';
  a.click();
}

export function enlaceGoogleCalendar() {
  const fin = new Date(fechaBoda.getTime() + 10 * 3600e3);
  const lugar = boda.lugares[0];
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${t('Boda de', 'Wedding of')} ${boda.novios.firma}`,
    dates: `${ics(fechaBoda)}/${ics(fin)}`,
    details: window.location.origin,
    location: lugar ? `${lugar.nombre}, ${lugar.direccion}` : '',
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}
