import { describe, expect, it } from 'vitest';
import {
    acotarCantidad, ajustesPosibles, cantidadesIniciales, faltaMotivo, lineasDeDecision,
    resumenDeDecision, rotulosDeDecision, seleccionInicial,
} from '@nucleo/utils/decisionDeSolicitud';
import { avisoDeCambioDeCliente } from '@nucleo/utils/puntosTexto';

const descarte = { type: 'INVENTORY_DISCARD_REQUEST', status: 'PENDING', metadata: { items: [{ cantidad: 4 }, { cantidad: 2 }, { cantidad: 1 }] } };
const abono = { type: 'ABONO_APROBACION', status: 'PENDING', metadata: { creditos: [{ monto: 5 }, { monto: 7 }] } };

const cuenta = (req, sel, cant, rechazando = false) => {
    const lineas = lineasDeDecision(req);
    const a = ajustesPosibles(req, { decidible: true, rechazando });
    return resumenDeDecision({ req, lineas, seleccion: sel ?? seleccionInicial(lineas), cantidades: cant ?? cantidadesIniciales(lineas), ...a });
};

describe('decisionDeSolicitud', () => {
    it('sin tocar nada no es parcial ni manda índices', () => {
        const r = cuenta(descarte);
        expect(r.parcial).toBe(false);
        expect(r.aceptadas).toBeNull();
        expect(r.aviso.texto).toBe('Entra todo lo que se pidió, completo.');
    });
    it('una línea afuera y otra recortada: parcial con índices y cantidad', () => {
        const cant = cantidadesIniciales(lineasDeDecision(descarte)); cant.set(0, 3);
        const r = cuenta(descarte, new Set([0, 2]), cant);
        expect(r.parcial).toBe(true);
        expect(r.aceptadas).toEqual([{ i: 0, cantidad: 3 }, { i: 2, cantidad: 1 }]);
        expect(r.aviso.texto).toBe('Queda 1 producto afuera y a 1 le bajaste la cantidad. Cuenta por qué abajo.');
        expect(faltaMotivo({ rechazando: false, parcial: r.parcial, nota: ' ' })).toBe(true);
    });
    it('nada marcado se avisa como peligro', () => {
        const r = cuenta(descarte, new Set());
        expect(r.nadaSeleccionado).toBe(true);
        expect(r.aviso.tono).toBe('danger');
    });
    it('el abono manda índices pelados y no ofrece cantidad', () => {
        expect(ajustesPosibles(abono, { decidible: true }).conCantidad).toBe(false);
        const r = cuenta(abono, new Set([1]));
        expect(r.aceptadas).toEqual([1]);
        expect(rotulosDeDecision(abono, true).aprobar).toBe('Confirmar lo marcado');
        expect(rotulosDeDecision(abono, false).rechazar).toBe('Devolver todo');
    });
    it('rechazando no hay ajustes', () => {
        expect(ajustesPosibles(descarte, { decidible: true, rechazando: true }).editable).toBe(false);
        expect(faltaMotivo({ rechazando: true, parcial: false, nota: '' })).toBe(true);
    });
    it('la cantidad nunca baja de 1 ni pasa lo pedido', () => {
        expect(acotarCantidad({ cantidad: 4 }, 0)).toBe(1);
        expect(acotarCantidad({ cantidad: 4 }, 9)).toBe(4);
    });
});

describe('avisoDeCambioDeCliente', () => {
    it('antes de aprobar dice qué va a pasar', () => {
        const a = avisoDeCambioDeCliente({ vista: { hay_puntos: true, puntos: 120, de_nombre: 'Ana', a_nombre: 'Luis', se_quitan: 120, recibe: 120 } });
        expect(a).toEqual({ tono: 'info', texto: 'Esta venta le dio 120 puntos a Ana. Al aprobar, se le quitan 120 y Luis recibe 120.' });
    });
    it('sin puntos no dice nada', () => {
        expect(avisoDeCambioDeCliente({ vista: { hay_puntos: false } })).toBeNull();
    });
    it('aplicado, con parte ya gastada', () => {
        const a = avisoDeCambioDeCliente({ aplicado: { hay_puntos: true, se_quitaron: 50, de_nombre: 'Ana', a_nombre: 'Luis', recibio: 0, no_recuperados: 10 } });
        expect(a.tono).toBe('warning');
        expect(a.texto).toBe('Puntos: se le quitaron 50 a Ana. Luis no acumula puntos, así que no recibió nada. 10 ya los había gastado y no se pudieron recuperar.');
    });
});
