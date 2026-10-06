import { describe, expect, it } from 'vitest';
import {
    datosDelDiaParaGuardar, gruposDelCatalogo, limitesDeLaSalaElDia, reparosDeLaCelda,
    revisionDelTurno, turnosQueCabenElDia,
} from '@nucleo/utils/edicionDeHorario';

const sala = { name: 'Salud 1', weekly_hours: { 1: { isOpen: true, start: '07:00', end: '19:00' }, 0: { isOpen: false } } };
const turnos = [
    { id: 1, name: 'Apertura', start: '07:00', end: '15:00', lunch_start: '12:00:00' },
    { id: 2, name: 'Apertura', start: '07:00', end: '15:00' },
    { id: 3, name: 'Noche', start: '18:00', end: '23:00' },
    { id: 4, name: 'Viejo', start: '08:00', end: '16:00', is_active: false },
];

describe('edicionDeHorario', () => {
    it('lee el horario de la sala un día, abierto o cerrado', () => {
        expect(limitesDeLaSalaElDia(sala, 1)).toMatchObject({ apertura: 420, cierre: 1140, hayHorario: true, cerrada: false });
        expect(limitesDeLaSalaElDia(sala, 0)).toMatchObject({ cerrada: true, hayHorario: true });
        expect(limitesDeLaSalaElDia({}, 1).hayHorario).toBe(false);
    });
    it('sólo ofrece turnos activos que caben, sin repetir', () => {
        const ids = turnosQueCabenElDia(turnos, limitesDeLaSalaElDia(sala, 1)).map((t) => t.id);
        expect(ids).toEqual([1]);
        expect(turnosQueCabenElDia(turnos, limitesDeLaSalaElDia(sala, 0))).toEqual([]);
    });
    it('un día sin turno y sin entrada se guarda libre', () => {
        expect(datosDelDiaParaGuardar({ turno: 'OFF', inicio: '07:00', fin: '15:00' })).toMatchObject({ isOff: true, shiftId: '', customStart: '' });
        expect(datosDelDiaParaGuardar({ turno: '', inicio: '' })).toMatchObject({ isOff: true });
        expect(datosDelDiaParaGuardar({ turno: '1', inicio: '07:00', fin: '15:00', conPausa: true, pausa: '12:00' }))
            .toEqual({ shiftId: '1', customStart: '07:00', customEnd: '15:00', hasLunch: true, lunchStart: '12:00', hasLactation: false, lactationStart: null, isOff: false });
    });
    it('no deja entrada igual a salida', () => {
        expect(reparosDeLaCelda({ turno: '', inicio: '08:00', fin: '08:00' }, [], {})).toHaveLength(1);
        expect(reparosDeLaCelda({ turno: 'OFF' }, [], {})).toEqual([]);
    });
    it('agrupa el catálogo y separa los archivados', () => {
        const g = gruposDelCatalogo(turnos);
        expect(g.map((x) => x.name)).toEqual(['Apertura', 'Noche']);
        expect(g[0].all_ids).toEqual([1, 2]);
        expect(gruposDelCatalogo(turnos, { archivados: true }).map((x) => x.name)).toEqual(['Viejo']);
    });
    it('nombra el turno y bloquea el repetido', () => {
        expect(revisionDelTurno({ start: '07:00', end: '15:00' }, turnos)).toMatchObject({ autoName: 'Apertura', hasBlockingError: true });
        expect(revisionDelTurno({ start: '10:00', end: '18:00' }, turnos)).toMatchObject({ autoName: 'Cierre', hasBlockingError: false });
        const grupo = gruposDelCatalogo(turnos)[0];
        expect(revisionDelTurno({ start: '07:00', end: '15:00' }, turnos, grupo).hasBlockingError).toBe(false);
    });
});
