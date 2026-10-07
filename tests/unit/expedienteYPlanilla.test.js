import { describe, expect, it } from 'vitest';
import { csvDelBanco, quincenaPorDefecto, saldoDeBancoDeHoras } from '@nucleo/utils/planilla';
import { elegibilidadDeVacaciones } from '@nucleo/utils/planDeVacaciones';
import { documentoReemplazado, HISTORIAL_MAXIMO } from '@nucleo/utils/documentosDelExpediente';

describe('quincenaPorDefecto', () => {
    it('del 1 al 15 y del 16 al último día del mes', () => {
        expect(quincenaPorDefecto('2026-10-07')).toEqual({ start_date: '2026-10-01', end_date: '2026-10-15' });
        expect(quincenaPorDefecto('2026-10-20')).toEqual({ start_date: '2026-10-16', end_date: '2026-10-31' });
        expect(quincenaPorDefecto('2028-02-16')).toEqual({ start_date: '2028-02-16', end_date: '2028-02-29' });
    });
});

describe('saldoDeBancoDeHoras', () => {
    it('suma lo ganado, resta lo canjeado, por tipo, sin bajar de cero', () => {
        const filas = [
            { type: 'EARNED', subtype: 'DIURNAL', hours: 5 }, { type: 'PAID', subtype: 'DIURNAL', hours: 2 },
            { type: 'EARNED', subtype: 'NOCTURNAL', hours: 1 }, { type: 'TIME_OFF', subtype: 'NOCTURNAL', hours: 3 },
        ];
        expect(saldoDeBancoDeHoras(filas)).toEqual({ diurnal: 3, nocturnal: 0 });
    });
});

describe('csvDelBanco', () => {
    const fila = { net_pay: 300.5, employee: { name: 'Ana Pérez', bank_name: 'Agrícola', account_number: '123', account_type: 'AHORRO' } };
    it('oculta la cuenta sin la llave', () => {
        expect(csvDelBanco([fila], { cuentasVisibles: false })).toBe('Nombre,Banco,Cuenta,Tipo,Monto\nAna Pérez,Agrícola,****,AHORRO,300.50');
        expect(csvDelBanco([fila], { cuentasVisibles: true })).toContain(',123,');
    });
});

describe('elegibilidadDeVacaciones', () => {
    it('elegible dentro de la ventana del aniversario', () => {
        const e = elegibilidadDeVacaciones('2024-09-01', '2026-10-07');
        expect(e.isEligible).toBe(true);
        expect(e.lastAnniversary).toBe('2026-09-01');
        expect(e.windowEnd).toBe('2026-12-01');
        expect(e.tono).toBe('ok');
    });
    it('anticipada a partir de los 9 meses, no elegible antes', () => {
        expect(elegibilidadDeVacaciones('2025-12-15', '2026-10-07').tono).toBe('adelanto');
        expect(elegibilidadDeVacaciones('2026-05-01', '2026-10-07').tono).toBe('no');
    });
});

describe('documentoReemplazado', () => {
    it('reemplazar un contrato guarda el archivo anterior; una licencia sólo la traza', () => {
        const lista = [{ category: 'CONTRATO', url: 'a', file_name: 'a.pdf' }, { category: 'LICENCIA_MOTO', url: 'x' }];
        const r = documentoReemplazado(lista, 'CONTRATO', { url: 'b' }, { quien: 'Ana', hoy: '2026-10-07' });
        expect(r[0].url).toBe('b');
        expect(r[0].historial[0]).toMatchObject({ reemplazado_el: '2026-10-07', por: 'Ana', url: 'a' });
        const l = documentoReemplazado(lista, 'LICENCIA_MOTO', { url: 'y' }, { hoy: '2026-10-07' });
        expect(l[1].historial[0].url).toBeUndefined();
    });
    it('quitar o cambiar la fecha no archiva', () => {
        const r = documentoReemplazado([{ category: 'CONTRATO', url: 'a' }], 'CONTRATO', { expiry_date: '2027-01-01' }, { hoy: '2026-10-07' });
        expect(r[0].historial).toEqual([]);
        expect(HISTORIAL_MAXIMO).toBe(10);
    });
    it('un documento nuevo se agrega a la lista', () => {
        const r = documentoReemplazado([], 'CV', { url: 'c' }, { hoy: '2026-10-07' });
        expect(r).toHaveLength(1);
        expect(r[0].category).toBe('CV');
    });
});
