import { describe, it, expect } from 'vitest';
import {
    validarPiezas, taparDatosPersonales, claveDePregunta,
    avisoDeFaltante, avisoDeFaltaPorContar, avisoDeCortesSinResolver,
} from '@nucleo/utils/salyAyuda';

describe('validarPiezas', () => {
    it('tira lo desconocido y acota', () => {
        const r = validarPiezas([
            { tipo: 'titular', texto: 'x'.repeat(200) },
            { tipo: 'html', texto: '<b>' },
            { tipo: 'cifras', items: [{ rotulo: 'A', valor: '1' }, {}, { rotulo: 'B', valor: '2', tono: 'raro' }] },
            { tipo: 'botones', items: [{ texto: 'Fuera', ir: 'https://malo.com' }, { texto: 'Dentro', ir: '/caja?tab=hoy' }] },
        ]);
        expect(r.map((p) => p.tipo)).toEqual(['titular', 'cifras', 'botones']);
        expect(r[0].texto).toHaveLength(90);
        expect(r[1].items).toEqual([{ rotulo: 'A', valor: '1', tono: undefined }, { rotulo: 'B', valor: '2', tono: undefined }]);
        expect(r[2].items).toEqual([{ texto: 'Dentro', ir: '/caja?tab=hoy' }]);
    });
    it('no acepta algo que no es lista', () => expect(validarPiezas('hola')).toEqual([]));
});

describe('taparDatosPersonales', () => {
    it('tapa DUI, NIT, teléfono, correo y salario', () => {
        const t = taparDatosPersonales('DUI 01234567-8 NIT 0614-010190-101-3 tel 7012-3456 a@b.com salario: $450.00');
        expect(t).not.toMatch(/01234567|0614|7012|a@b|450/);
    });
    it('deja montos de caja', () => expect(taparDatosPersonales('faltan $12.50')).toBe('faltan $12.50'));
});

it('la misma pregunta da la misma clave', () => {
    expect(claveDePregunta('caja', 'Hola ', 'x')).toBe(claveDePregunta('caja', 'hola', 'x'));
    expect(claveDePregunta('caja', 'hola', 'x')).not.toBe(claveDePregunta('caja', 'hola', 'y'));
});

describe('avisos', () => {
    it('faltante sólo bajo el umbral', () => {
        expect(avisoDeFaltante({ id: 1, diferencia: -0.5 })).toBeNull();
        const a = avisoDeFaltante({ id: 7, branch_id: 3, sala: 'Salud 2', hora: '13:05', diferencia: -9.85, esperado: 319.1, contado: 309.25 });
        expect(a.ancla).toBe('corte-7');
        expect(a.explicacion.find((p) => p.tipo === 'cifras').items[2].tono).toBe('mal');
    });
    it('falta por contar', () => {
        expect(avisoDeFaltaPorContar({ medido: true, falta: 0 })).toBeNull();
        const a = avisoDeFaltaPorContar({ medido: true, hay_corte: true, desde: '11:59', falta: 159.39 });
        expect(a.explicacion.some((p) => p.tipo === 'linea')).toBe(true);
        expect(avisoDeFaltaPorContar({ medido: false }).clave).toMatch(/no-medido/);
    });
    it('cortes sin resolver', () => {
        expect(avisoDeCortesSinResolver([])).toBeNull();
        expect(avisoDeCortesSinResolver([{ id: 1, hora: '21:00' }]).oferta[0].texto).toMatch(/Un corte/);
    });
});

describe('preguntaFrecuente', () => {
    it('contesta lo de siempre sin IA', async () => {
        const { preguntaFrecuente } = await import('@nucleo/utils/salyAyuda');
        expect(preguntaFrecuente('caja', '¿Cómo hago un corte?').id).toBe('corte');
        expect(preguntaFrecuente('caja', 'no me deja cerrar el día').id).toBe('cerrar');
        expect(preguntaFrecuente('caja', 'tengo un faltante')?.id).toBe('faltante');
    });
    it('lo concreto y largo va a la IA', async () => {
        const { preguntaFrecuente } = await import('@nucleo/utils/salyAyuda');
        expect(preguntaFrecuente('caja', 'por qué la salida de las 12 del agua cristal dice registrado y no cortado')).toBeNull();
        expect(preguntaFrecuente('caja', 'hola')).toBeNull();
    });
});

describe('nombres, montos y revisión', () => {
    it('tapa y devuelve nombres', async () => {
        const { crearMascaraDeNombres } = await import('@nucleo/utils/salyAyuda');
        const m = crearMascaraDeNombres(['KARLA PATRICIA CORTEZ VALLE', 'GABRIELA TOBAR']);
        const t = m.tapar('Cobro de KARLA PATRICIA CORTEZ VALLE · lo anotó GABRIELA TOBAR · Karla Cortez');
        expect(t).not.toMatch(/KARLA|GABRIELA|Karla/i);
        expect(m.destapar('Persona 2 lo anotó')).toBe('Gabriela Tobar lo anotó');
    });
    it('caza un monto inventado y deja pasar sumas', async () => {
        const { montosInventados } = await import('@nucleo/utils/salyAyuda');
        const fuente = ['{"esperado":319.1,"contado":309.25}'];
        expect(montosInventados([{ tipo: 'titular', texto: 'Faltan $9.85' }], fuente)).toEqual([]);
        expect(montosInventados([{ tipo: 'cifras', items: [{ rotulo: 'Esperado', valor: '$319.10' }] }], fuente)).toEqual([]);
        expect(montosInventados([{ tipo: 'titular', texto: 'Faltan $12.40' }], fuente)).toEqual(['$12.40']);
        expect(montosInventados([{ tipo: 'pasos', items: ['Paso 1 a las 12'] }], fuente)).toEqual([]);
    });
    it('revisa salidas sin foto y boletas dobles', async () => {
        const { revisarMovimientos } = await import('@nucleo/utils/salyAyuda');
        const base = { anulado: false, cuando: new Date().toISOString() };
        const lineas = [
            { ...base, clave: 'a', clase: 'sale', titulo: 'Compra o gasto urgente · agua', monto: 14.25, foto: null, movimiento: {} },
            { ...base, clave: 'e', clase: 'sale', titulo: 'Cambio por monedas', monto: 5, foto: null, movimiento: {} },
            { ...base, clave: 'b', clase: 'entra', monto: 10.43, foto: 'x', movimiento: { numero_boleta: '0956' } },
            { ...base, clave: 'c', clase: 'entra', monto: 10.43, foto: 'y', movimiento: { numero_boleta: '956' } },
            { ...base, clave: 'd', clase: 'entra', monto: 1, foto: null, movimiento: {} },
        ];
        const r = revisarMovimientos(lineas);
        expect(r.get('a')[0].corto).toBe('Sin foto del respaldo');
        expect(r.get('b')[0].corto).toBe('Boleta repetida');
        expect(r.get('c')[0].corto).toBe('Boleta repetida');
        expect(r.has('d')).toBe(false);
        expect(r.has('e')).toBe(false);
    });
});
