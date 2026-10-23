// Bitácoras: el cierre del mes (cumplimiento, cuándo se puede firmar) y la
// configuración de la sala (horas que se ofrecen, vigencia de la calibración,
// áreas agregables, puntos de limpieza). El portal y la app usan estas mismas
// funciones, así que lo que se fija acá vale para las dos pantallas.
import { describe, expect, it } from 'vitest';
import {
    nombreDelPeriodo, cumplimiento, rotularCumplimiento, tonoDelCumplimiento,
    MINIMO_MOTIVO_CON_LIBRO_PENDIENTE, puedeFirmarElCierre,
} from '@nucleo/utils/cierreDeBitacoras';
import {
    hhmm, mediasHoras, horasParaElegir, unAnoDespues, horariosUnidos, conHorarioCambiado,
    areasAgregables, puntosDelArea, areaCambiada,
} from '@nucleo/utils/configuracionDeBitacoras';

describe('cierre de bitácoras', () => {
    it('nombra el mes con mayúscula inicial, venga con o sin día', () => {
        expect(nombreDelPeriodo('2026-07')).toBe('Julio de 2026');
        expect(nombreDelPeriodo('2026-01-15')).toBe('Enero de 2026');
    });

    it('un mes sin nada esperado NO es un 100%', () => {
        expect(cumplimiento(0, 0)).toBeNull();
        expect(rotularCumplimiento(cumplimiento(0, 0))).toBe('—');
        expect(tonoDelCumplimiento(null)).toBeUndefined();
    });

    it('redondea el cumplimiento y sólo el 100 es verde', () => {
        expect(cumplimiento(2, 3)).toBe(67);
        expect(cumplimiento(59, 60)).toBe(98);
        expect(cumplimiento(60, 60)).toBe(100);
        expect(rotularCumplimiento(67)).toBe('67%');
        expect(tonoDelCumplimiento(100)).toBe('success');
        expect(tonoDelCumplimiento(98)).toBe('warning');
        expect(tonoDelCumplimiento(0)).toBe('warning');
    });

    it('con renglones del libro sin receta, el motivo es obligatorio y de al menos 15 caracteres', () => {
        expect(MINIMO_MOTIVO_CON_LIBRO_PENDIENTE).toBe(15);
        expect(puedeFirmarElCierre(0, '')).toBe(true);
        expect(puedeFirmarElCierre(0, null)).toBe(true);
        expect(puedeFirmarElCierre(3, '')).toBe(false);
        expect(puedeFirmarElCierre(3, 'falta receta')).toBe(false);          // 12
        // los espacios de relleno no cuentan
        expect(puedeFirmarElCierre(3, '   faltan recetas      ')).toBe(false); // 14 al recortar
        expect(puedeFirmarElCierre(3, 'faltan 3 recetas')).toBe(true);        // 16
    });
});

describe('configuración de bitácoras — horas', () => {
    it('hhmm recorta los segundos y tolera vacío', () => {
        expect(hhmm('07:30:00')).toBe('07:30');
        expect(hhmm(null)).toBe('');
    });

    it('mediasHoras va de la apertura al cierre en pasos de 30, redondeando hacia afuera', () => {
        const h = mediasHoras('07:15', '09:10');
        expect(h).toEqual(['07:00', '07:30', '08:00', '08:30', '09:00', '09:30']);
    });

    it('sin horario cargado, el rango de siempre (5:00 a 22:30)', () => {
        const h = mediasHoras();
        expect(h[0]).toBe('05:00');
        expect(h.at(-1)).toBe('22:30');
        expect(h).toHaveLength(36);
    });

    it('nunca pasa de las 23:30 aunque la sala cierre a medianoche', () => {
        expect(mediasHoras('22:00', '24:00')).toEqual(['22:00', '22:30', '23:00', '23:30']);
    });

    it('una hora ilegible cae a las 5:00, y una sin minutos no vacía la lista', () => {
        expect(mediasHoras('xx', '05:30')).toEqual(['05:00', '05:30']);
        expect(mediasHoras('xx:yy', '05:30')).toEqual(['05:00', '05:30']);
        // Antes «7» daba NaN de minutos y la lista salía VACÍA: ninguna hora para elegir.
        expect(mediasHoras('7', '8')).toEqual(['07:00', '07:30', '08:00']);
    });

    it('horasParaElegir agrega la hora guardada si cae fuera del horario, ordenada', () => {
        const horas = ['08:00', '08:30', '09:00'];
        expect(horasParaElegir('08:30:00', horas)).toBe(horas);
        expect(horasParaElegir('', horas)).toBe(horas);
        expect(horasParaElegir('06:00:00', horas)).toEqual(['06:00', '08:00', '08:30', '09:00']);
    });

    it('unAnoDespues no se corre de día por el huso, y respeta el 29 de febrero', () => {
        expect(unAnoDespues('2026-10-23')).toBe('2027-10-23');
        expect(unAnoDespues('2026-12-31')).toBe('2027-12-31');
        expect(unAnoDespues('2028-02-29')).toBe('2029-03-01');
    });
});

describe('configuración de bitácoras — áreas', () => {
    it('horariosUnidos deja una franja por clave, la primera que aparece, sin compartir el objeto', () => {
        const a = { clave: 'm', hora: '08:00' };
        const unidos = horariosUnidos([
            { franjas: [a, { clave: 't', hora: '14:00' }] },
            { franjas: [{ clave: 'm', hora: '09:00' }] },
            { franjas: null },
        ], 'franjas');
        expect(unidos).toEqual([{ clave: 'm', hora: '08:00' }, { clave: 't', hora: '14:00' }]);
        expect(unidos[0]).not.toBe(a);
        expect(horariosUnidos(null, 'franjas')).toEqual([]);
    });

    it('conHorarioCambiado parcha sólo la fila pedida', () => {
        const l = [{ clave: 'm', hora: '08:00' }, { clave: 't', hora: '14:00' }];
        const r = conHorarioCambiado(l, 1, { hora: '15:00' });
        expect(r).toEqual([{ clave: 'm', hora: '08:00' }, { clave: 't', hora: '15:00' }]);
        expect(l[1].hora).toBe('14:00');
        expect(conHorarioCambiado(null, 0, {})).toEqual([]);
    });

    it('areasAgregables quita las que ya existen y nunca ofrece el refrigerador', () => {
        const todas = areasAgregables([]).map(o => o.value);
        expect(todas).not.toContain('refrigerador');
        expect(todas).toEqual(expect.arrayContaining(['sala_ventas', 'bodega', 'vitrinas', 'servicio_sanitario']));
        const r = areasAgregables([{ tipo: 'bodega', nombre: 'Bodega' }]);
        expect(r.map(o => o.value)).not.toContain('bodega');
        expect(r.find(o => o.value === 'vitrinas').label).toBe('Vitrinas');
        // una bodega con OTRO nombre no ocupa la de la plantilla
        expect(areasAgregables([{ tipo: 'bodega', nombre: 'Bodega 2' }]).map(o => o.value)).toContain('bodega');
    });

    it('puntosDelArea respeta el mínimo de la receta y suma el total', () => {
        // servicio sanitario: mínimo 1 aunque no haya ninguno cargado
        const s = puntosDelArea('servicio_sanitario', []);
        expect(s.minimo).toBe(1);
        expect(s.tipos.map(t => [t.tipo, t.cuenta])).toEqual([['sanitario', 1]]);
        expect(s.total).toBe(1);
        // vitrinas: cuenta vitrinas y estantes por separado
        const v = puntosDelArea('vitrinas', [{ tipo: 'vitrina' }, { tipo: 'vitrina' }, { tipo: 'estante' }, { tipo: 'sanitario' }]);
        expect(v.tipos.map(t => [t.tipo, t.cuenta])).toEqual([['vitrina', 2], ['estante', 1]]);
        expect(v.total).toBe(3);
        // un área sin receta de puntos
        expect(puntosDelArea('bodega', [])).toBeNull();
    });

    it('areaCambiada compara el borrador contra lo guardado, con nulos como vacío', () => {
        const area = { activa: true, instrumento: null, calibrado_hasta: '2027-01-01', calibrado_el: null, puntos: [{ tipo: 'vitrina' }] };
        const igual = { activa: true, instrumento: '', calibrado: '2027-01-01', calibradoEl: '', puntos: [{ tipo: 'vitrina' }] };
        expect(areaCambiada(area, igual)).toBe(false);
        expect(areaCambiada(area, { ...igual, activa: false })).toBe(true);
        expect(areaCambiada(area, { ...igual, instrumento: 'Termohigrómetro 3' })).toBe(true);
        expect(areaCambiada(area, { ...igual, calibrado: '2028-01-01' })).toBe(true);
        expect(areaCambiada(area, { ...igual, puntos: [] })).toBe(true);
        expect(areaCambiada({ ...area, puntos: undefined }, { ...igual, puntos: [] })).toBe(false);
    });
});
