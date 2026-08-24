// El kiosco cuando no hay internet: la cola de marcajes y la ventana de gracia.
//
// Las dos piezas nacieron de la misma pregunta —qué hace la tablet cuando se
// cae la conexión— y las dos son historia de bugs reales, no diseño anticipado.
//
// **La ventana de gracia** reemplazó a `kiosk_supervisor_pins`, un caché que
// guardaba los PIN de los supervisores **en claro en el disco de cada tablet**.
// Acá no se guarda material de credencial: sólo el id y la fecha de la última
// autorización verificada contra el servidor. Un atacante que lea este
// `localStorage` obtiene una lista de ids y fechas; antes obtenía credenciales.
//
// **La cola de marcajes** tenía dos defectos que se corrigieron el 2026-08-16:
// un marcaje encolado a las 8 de la mañana y recuperado a las 3 de la tarde
// entraba a planilla **como si la persona hubiera llegado a las 3**, y un
// rechazo del servidor dejaba el item al frente para siempre — con una policy
// que rechazaba SIEMPRE, la cola quedaba trabada de por vida en el primer
// marcaje mientras la pantalla decía «se sincronizará solo».

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { recordKioskVerification, hasRecentKioskVerification, clearKioskGrace }
    from '../../src/utils/kioskGrace';
import { enqueueAttendancePunch, contarMarcajesEnCola, flushAttendanceQueue }
    from '../../src/utils/attendanceQueue';

const DIA = 24 * 60 * 60 * 1000;

beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-24T14:00:00Z'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

describe('la ventana de gracia de autorización', () => {
    it('quien se autorizó recién sigue autorizado sin conexión', () => {
        recordKioskVerification('emp-1');
        expect(hasRecentKioskVerification('emp-1')).toBe(true);
    });

    it('quien NUNCA se autorizó en este kiosco, no', () => {
        // Cae al camino PENDIENTE en vez de ser aceptado a ciegas — la decisión
        // de la auditoría del 2026-07-29.
        expect(hasRecentKioskVerification('emp-2')).toBe(false);
    });

    it('la ventana dura siete días', () => {
        recordKioskVerification('emp-1');
        vi.setSystemTime(new Date('2026-08-31T13:59:00Z'));   // 6d 23h
        expect(hasRecentKioskVerification('emp-1')).toBe(true);
        vi.setSystemTime(new Date('2026-08-31T14:01:00Z'));   // 7d 1min
        expect(hasRecentKioskVerification('emp-1')).toBe(false);
    });

    it('NO se guarda material de credencial: sólo id y fecha', () => {
        recordKioskVerification('emp-1');
        const crudo = localStorage.getItem('kiosk_auth_grace');
        expect(JSON.parse(crudo)).toEqual({ 'emp-1': '2026-08-24T14:00:00.000Z' });
        expect(crudo).not.toMatch(/pin|code|password/i);
    });

    it('se poda sola: no acumula gente que ya no trabaja acá', () => {
        recordKioskVerification('viejo');
        vi.setSystemTime(new Date('2026-09-10T14:00:00Z'));
        recordKioskVerification('nuevo');
        expect(Object.keys(JSON.parse(localStorage.getItem('kiosk_auth_grace')))).toEqual(['nuevo']);
    });

    it('un `localStorage` corrupto se lee como vacío, no revienta la tablet', () => {
        localStorage.setItem('kiosk_auth_grace', 'no es json');
        expect(hasRecentKioskVerification('emp-1')).toBe(false);
        expect(() => recordKioskVerification('emp-1')).not.toThrow();
    });

    it('una fecha basura NO cuenta como autorización', () => {
        localStorage.setItem('kiosk_auth_grace', JSON.stringify({ 'emp-1': 'ayer' }));
        expect(hasRecentKioskVerification('emp-1')).toBe(false);
    });

    it('desvincular el dispositivo la borra: es del kiosco, no del navegador', () => {
        recordKioskVerification('emp-1');
        clearKioskGrace();
        expect(hasRecentKioskVerification('emp-1')).toBe(false);
    });

    it('sin empleado no se registra ni se consulta nada', () => {
        recordKioskVerification(null);
        expect(localStorage.getItem('kiosk_auth_grace')).toBeNull();
        expect(hasRecentKioskVerification(null)).toBe(false);
    });
});

describe('la cola de marcajes sin conexión', () => {
    const encolar = (id, hora) => enqueueAttendancePunch({
        employeeId: id, type: 'PUNCH_IN', metadata: null, ocurridoEn: hora,
    });

    it('guarda CUÁNDO ocurrió, y esa hora es la que se manda', async () => {
        // Sin esto, un marcaje encolado a las 8 y recuperado a las 15 entra a
        // planilla como si la persona hubiera llegado a las 15.
        encolar('emp-1', '2026-08-24T14:00:00.000Z');
        vi.setSystemTime(new Date('2026-08-24T21:00:00Z'));
        const enviados = [];
        await flushAttendanceQueue(async (item) => { enviados.push(item); return { ok: true }; });
        expect(enviados[0].ocurridoEn).toBe('2026-08-24T14:00:00.000Z');
    });

    it('sin hora explícita usa la de ahora, no la del envío', () => {
        enqueueAttendancePunch({ employeeId: 'emp-1', type: 'PUNCH_IN' });
        expect(contarMarcajesEnCola()).toBe(1);
    });

    it('se procesa EN ORDEN: la entrada antes que la salida', async () => {
        encolar('emp-1', '2026-08-24T13:00:00.000Z');
        enqueueAttendancePunch({ employeeId: 'emp-1', type: 'PUNCH_OUT',
                                 ocurridoEn: '2026-08-24T13:30:00.000Z' });
        const tipos = [];
        await flushAttendanceQueue(async (i) => { tipos.push(i.type); return { ok: true }; });
        expect(tipos).toEqual(['PUNCH_IN', 'PUNCH_OUT']);
    });

    it('un fallo de RED detiene el barrido y CONSERVA lo que falta', async () => {
        encolar('emp-1', '2026-08-24T13:00:00.000Z');
        encolar('emp-2', '2026-08-24T13:05:00.000Z');
        const r = await flushAttendanceQueue(async () => ({ ok: false, networkError: true }));
        expect(r).toMatchObject({ synced: 0, descartados: 0, remaining: 2 });
        expect(contarMarcajesEnCola()).toBe(2);
    });

    it('un RECHAZO del servidor descarta el item y sigue con el resto', async () => {
        // Antes cualquier error cortaba el barrido y dejaba el item al frente
        // para siempre: con una policy que rechazaba siempre, la cola quedaba
        // trabada de por vida en el primer marcaje.
        encolar('emp-1', '2026-08-24T13:00:00.000Z');
        encolar('emp-2', '2026-08-24T13:05:00.000Z');
        let primera = true;
        const r = await flushAttendanceQueue(async () => {
            if (primera) { primera = false; return { ok: false, motivo: 'DUPLICADO' }; }
            return { ok: true };
        });
        expect(r).toMatchObject({ synced: 1, descartados: 1, remaining: 0 });
    });

    it('un marcaje de más de un día se descarta: lo corrige Talento Humano', async () => {
        // El servidor lo rechaza igual (`KIOSK_MOMENTO_DEMASIADO_VIEJO`);
        // descartarlo acá evita el viaje y que la cola se trabe.
        encolar('emp-1', '2026-08-24T14:00:00.000Z');
        vi.setSystemTime(new Date('2026-08-25T14:00:01Z'));
        const enviados = [];
        const r = await flushAttendanceQueue(async (i) => { enviados.push(i); return { ok: true }; });
        expect(enviados).toHaveLength(0);
        expect(r).toMatchObject({ synced: 0, descartados: 1, remaining: 0 });
    });

    it('justo dentro de las 24 horas todavía se manda', async () => {
        encolar('emp-1', '2026-08-24T14:00:00.000Z');
        vi.setSystemTime(new Date('2026-08-25T13:59:59Z'));
        const r = await flushAttendanceQueue(async () => ({ ok: true }));
        expect(r.synced).toBe(1);
    });

    it('una excepción inesperada NO pierde el marcaje', async () => {
        encolar('emp-1', '2026-08-24T13:00:00.000Z');
        const r = await flushAttendanceQueue(async () => { throw new Error('boom'); });
        expect(r.remaining).toBe(1);
        expect(contarMarcajesEnCola()).toBe(1);
    });

    it('con la cola vacía no llama a nadie', async () => {
        const enviar = vi.fn();
        expect(await flushAttendanceQueue(enviar)).toEqual({ synced: 0, descartados: 0, remaining: 0 });
        expect(enviar).not.toHaveBeenCalled();
    });

    it('una cola corrupta se lee como vacía en vez de reventar el kiosco', async () => {
        localStorage.setItem('kiosk_attendance_queue', '{no es un arreglo}');
        expect(contarMarcajesEnCola()).toBe(0);
        expect(await flushAttendanceQueue(async () => ({ ok: true }))).toMatchObject({ synced: 0 });
    });

    it('un item viejo SIN `ocurridoEn` cae a `queuedAt`', async () => {
        // Compatibilidad con lo que haya quedado en cola de una versión previa:
        // descartarlo perdería un marcaje real.
        localStorage.setItem('kiosk_attendance_queue', JSON.stringify([
            { id: 'x', employeeId: 'emp-1', type: 'PUNCH_IN', queuedAt: '2026-08-24T13:00:00.000Z' },
        ]));
        const enviados = [];
        await flushAttendanceQueue(async (i) => { enviados.push(i); return { ok: true }; });
        expect(enviados[0].ocurridoEn).toBe('2026-08-24T13:00:00.000Z');
    });
});
