import { describe, expect, it } from 'vitest';
import {
    avisoDeEntidad, avisoDeLaFoto, fechaCorta, juntarConY, loQuePoneLaFoto, normalizarNombre, pegado,
    problemaDeLaBoleta, problemaDeLaFoto, textoDeLoCorregido, textoDeLoTomado,
} from '@nucleo/utils/salidaDeCaja';

describe('ayudas', () => {
    it('normalizarNombre y pegado', () => {
        expect(normalizarNombre('  Money-Gram  ws ')).toBe('MONEY GRAM WS');
        expect(normalizarNombre('Farmacía')).toBe('FARMACIA');
        expect(pegado('Money Gram WS')).toBe('MONEYGRAMWS');
        expect(normalizarNombre(null)).toBe('');
    });
    it('juntarConY', () => {
        expect(juntarConY([])).toBe('');
        expect(juntarConY(['el monto'])).toBe('el monto');
        expect(juntarConY(['a', 'b'])).toBe('a y b');
        expect(juntarConY(['a', 'b', 'c'])).toBe('a, b y c');
    });
    it('fechaCorta vacía sin fecha', () => {
        expect(fechaCorta('')).toBe('');
        expect(fechaCorta('2026-08-15')).toMatch(/15/);
    });
});

describe('problemaDeLaFoto', () => {
    it('sin lectura no dice nada; con OK tampoco', () => {
        expect(problemaDeLaFoto(null, {})).toBeNull();
        expect(problemaDeLaFoto({ veredicto: 'OK', leido: {} }, {})).toBeNull();
    });
    it('error de lectura frena y es reintentable', () => {
        const p = problemaDeLaFoto({ error: true }, {});
        expect(p).toMatchObject({ bloquea: true, reintentable: true, tono: 'warning' });
        expect(p.texto).toBe('No se pudo revisar la foto. Vuelve a elegirla para intentar de nuevo.');
    });
    it('los cuatro frenos', () => {
        expect(problemaDeLaFoto({ veredicto: 'NO_ES_BOLETA', leido: { motivo: 'es un recibo' } }).texto)
            .toBe('La foto no parece la boleta: es un recibo');
        expect(problemaDeLaFoto({ veredicto: 'NO_ES_BOLETA', leido: {} }).texto).toBe('La foto no parece la boleta.');
        expect(problemaDeLaFoto({ veredicto: 'ILEGIBLE' }).bloquea).toBe(true);
        const m = problemaDeLaFoto({ veredicto: 'MONTO_NO_COINCIDE', leido: { monto: 20 } }, { monto: 25 });
        expect(m.bloquea).toBe(true);
        expect(m.texto).toMatch(/^La boleta dice .*20.* y la salida es de .*25/);
        expect(problemaDeLaFoto({ veredicto: 'BOLETA_NO_COINCIDE', leido: { numero_boleta: '123' } }, { boleta: ' 456 ' }).texto)
            .toBe('El número de la boleta de la foto es 123 y aquí dice 456.');
    });
    it('ENTIDAD_NO_COINCIDE avisa y no frena', () => {
        const p = problemaDeLaFoto({ veredicto: 'ENTIDAD_NO_COINCIDE', leido: { entidad: 'BANCO PROMERICA' } }, { entidad: 'RIA ' });
        expect(p).toEqual(avisoDeEntidad({ entidad: 'BANCO PROMERICA' }, 'RIA'));
        expect(p.bloquea).toBe(false);
        expect(p.texto).toBe('La boleta dice BANCO PROMERICA y no nombra a RIA. Si es la boleta correcta, puedes guardarla: el monto y el número sí coinciden.');
    });
});

describe('avisoDeLaFoto', () => {
    it('avisa la entidad que manda el servidor en avisos', () => {
        const l = { veredicto: 'OK', leido: { entidad: 'X' }, avisos: [{ campo: 'entidad' }] };
        expect(avisoDeLaFoto(l, { entidad: 'RIA' })?.bloquea).toBe(false);
    });
    it('calla si ya hay problema, si falló o si no hay aviso', () => {
        expect(avisoDeLaFoto({ veredicto: 'ILEGIBLE', avisos: [{ campo: 'entidad' }] }, {})).toBeNull();
        expect(avisoDeLaFoto({ error: true }, {})).toBeNull();
        expect(avisoDeLaFoto({ veredicto: 'OK', avisos: [] }, {})).toBeNull();
    });
});

describe('problemaDeLaBoleta', () => {
    const fila = { tipo: 'POS', entidad: 'Money Gram', numero_boleta: '18540', registrado_at: '2026-08-15T10:00:00Z', monto: 50, folio: 'REM-1' };
    it('sin repetidas, nada', () => {
        expect(problemaDeLaBoleta([], { tipo: 'POS', entidad: 'x' })).toBeNull();
    });
    it('mismo motivo y misma entidad (normalizada) frena', () => {
        const p = problemaDeLaBoleta([fila], { tipo: 'POS', entidad: 'MONEY-GRAM' });
        expect(p.bloquea).toBe(true);
        expect(p.tono).toBe('danger');
        expect(p.texto).toMatch(/^La boleta 18540 de Money Gram ya se registró en esta sucursal el .+ por .*50.* \(REM-1\)\.$/);
    });
    it('otra entidad u otro motivo sólo avisa', () => {
        const p = problemaDeLaBoleta([fila], { tipo: 'POS', entidad: 'RIA' });
        expect(p.bloquea).toBe(false);
        expect(p.texto).toMatch(/^Ese número ya lo usó una boleta de Money Gram el .+ \(REM-1\)\. Si son dos boletas distintas, puedes seguir\.$/);
        expect(problemaDeLaBoleta([fila], { tipo: 'GASTO', entidad: 'Money Gram' }).bloquea).toBe(false);
    });
});

describe('loQuePoneLaFoto', () => {
    const base = { leido: { es_boleta: true, monto: 50, numero_boleta: '0018540' }, montoConfianza: 'CONFIRMADO' };
    it('si no es boleta, no pone nada', () => {
        expect(loQuePoneLaFoto({ leido: { es_boleta: false, monto: 5 } }, {})).toEqual({ campos: {}, puestos: [], pisados: [] });
        expect(loQuePoneLaFoto(null, {})).toEqual({ campos: {}, puestos: [], pisados: [] });
    });
    it('pone monto y número; el monto cuenta como puesto sólo si está confirmado', () => {
        const r = loQuePoneLaFoto(base, {});
        expect(r.campos).toEqual({ monto: '50', boleta: '0018540' });
        expect(r.puestos).toEqual(['el monto', 'el número']);
        expect(r.pisados).toEqual([]);
        expect(loQuePoneLaFoto({ ...base, montoConfianza: 'UNICO' }, {}).puestos).toEqual(['el número']);
    });
    it('dice lo que pisa: monto distinto, contradicho y número distinto (sin ceros a la izquierda)', () => {
        expect(loQuePoneLaFoto(base, { monto: '50.00', boleta: '18540' }).pisados).toEqual([]);
        expect(loQuePoneLaFoto(base, { monto: '40', boleta: '999' }).pisados).toEqual(['el monto', 'el número']);
        expect(loQuePoneLaFoto({ ...base, montoConfianza: 'CONTRADICHO' }, {}).pisados)
            .toEqual(['el monto, que la boleta dice dos veces y no coinciden']);
    });
    it('la remesadora sólo si el papel dice remesa y está en la lista', () => {
        const remesa = { leido: { es_boleta: true, tipo_operacion: 'REMESA', red_remesas: 'MONEY GRAM WS', entidad: 'BANCO PROMERICA' } };
        const r = loQuePoneLaFoto(remesa, { opciones: ['RIA', 'MONEYGRAM'], etiquetaEntidad: 'Remesadora' });
        expect(r.campos.entidad).toBe('MONEYGRAM');
        expect(r.puestos).toEqual(['remesadora']);
        // ya elegida: no se toca
        expect(loQuePoneLaFoto(remesa, { opciones: ['MONEYGRAM'], entidad: 'RIA' }).campos.entidad).toBeUndefined();
        // un retiro no tiene remesadora aunque «RIA» quepa en «FERRETERIA»
        const compra = { leido: { es_boleta: true, tipo_operacion: 'COMPRA', entidad: 'FERRETERIA DON GENARO' } };
        expect(loQuePoneLaFoto(compra, { opciones: ['RIA'] }).campos.entidad).toBeUndefined();
        // sin rótulo, «la entidad»
        expect(loQuePoneLaFoto(remesa, { opciones: ['MONEYGRAM'] }).puestos).toEqual(['la entidad']);
    });
    it('«de qué fue» sólo donde el papel manda, y avisa si pisa la nota', () => {
        const remesa = { leido: { es_boleta: true, tipo_operacion: 'REMESA', red_remesas: 'Money Gram WS' } };
        expect(loQuePoneLaFoto(remesa, { laFotoManda: false }).campos.nota).toBeUndefined();
        const r = loQuePoneLaFoto(remesa, { laFotoManda: true, nota: 'otra cosa' });
        expect(r.campos.nota).toBeTruthy();
        expect(r.puestos).toContain('de qué fue');
        expect(r.pisados).toEqual(['de qué fue']);
        const igual = loQuePoneLaFoto(remesa, { laFotoManda: true, nota: r.campos.nota.toLowerCase() });
        expect(igual.pisados).toEqual([]);
    });
});

describe('textos de lo que hizo la foto', () => {
    it('lo corregido', () => {
        expect(textoDeLoCorregido([])).toBe('');
        expect(textoDeLoCorregido(['el monto'])).toBe('La boleta dice otra cosa: se corrigió el monto que habías escrito. Si el papel no dice eso, quita la foto y vuelve a tomarla.');
        expect(textoDeLoCorregido(['el monto', 'el número'])).toBe('La boleta dice otra cosa: se corrigieron el monto y el número que habías escrito. Si el papel no dice eso, quita la foto y vuelve a tomarla.');
    });
    it('lo tomado', () => {
        expect(textoDeLoTomado([])).toBe('');
        expect(textoDeLoTomado(['el número'])).toBe('Se tomó de la boleta el número. Si no dice eso, vuelve a tomar la foto.');
        expect(textoDeLoTomado(['el monto', 'el número', 'de qué fue'])).toBe('Se tomaron de la boleta el monto, el número y de qué fue. Si alguno no dice eso, vuelve a tomar la foto.');
    });
});
