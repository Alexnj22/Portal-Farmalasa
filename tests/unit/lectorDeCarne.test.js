import { describe, it, expect } from 'vitest';
import { clasificarCodigo, crearDetectorDeRafaga, pareceCarne, usuarioAceptable, RAFAGA_ESPERA_MS } from '@nucleo/utils/lectorDeCarne.js';

// El carné que caía en «usuario» se quedaba a la vista y el navegador lo
// guardaba en su autocompletar (reportado 2026-11-22). Estas pruebas simulan el
// teclado: un lector escribe cada 10 ms, una persona cada 150 ms.

/** Simula un campo de texto: aplica las órdenes como lo haría LoginView. */
function simular(teclas, { campo = 'usuario', esClave = false, valorInicial = '', paso = 10, t0 = 1000, ultimaVencida = false } = {}) {
    const d = crearDetectorDeRafaga();
    const valores = { [campo]: valorInicial };
    const eventos = [];
    let t = t0;
    let bloqueadas = 0;
    for (const key of teclas) {
        const ordenes = d.tecla({ key, t, campo, valor: campo == null ? '' : valores[campo], esClave });
        let bloqueada = false;
        for (const o of ordenes) {
            if (o.tipo === 'poner') valores[o.campo] = o.valor;
            else if (o.tipo === 'bloquear') bloqueada = true;
            else if (o.tipo !== 'esperar') eventos.push(o);
        }
        if (bloqueada) bloqueadas += 1;
        // Lo que no se bloquea, el navegador lo escribe en el campo.
        else if (campo != null && key.length === 1) valores[campo] += key;
        else if (key === 'Enter' && !bloqueada) eventos.push({ tipo: 'enviar-formulario', valor: valores[campo] });
        t += paso;
    }
    if (ultimaVencida) {
        for (const o of d.vencer(t + RAFAGA_ESPERA_MS)) {
            if (o.tipo === 'poner') valores[o.campo] = o.valor;
            else eventos.push(o);
        }
    }
    return { valor: valores[campo], eventos, bloqueadas };
}

const teclas = (s, fin = 'Enter') => [...s.split(''), ...(fin ? [fin] : [])];

describe('pareceCarne / usuarioAceptable / clasificarCodigo', () => {
    it('sólo dígitos de 3 a 12 son carné', () => {
        expect(pareceCarne('1234')).toBe(true);
        expect(pareceCarne(' 98765432 ')).toBe(true);
        expect(pareceCarne('12')).toBe(false);
        expect(pareceCarne('maria.lopez')).toBe(false);
        expect(pareceCarne('12a4')).toBe(false);
    });
    it('un usuario nunca es sólo números', () => {
        expect(usuarioAceptable('maria.lopez')).toBe(true);
        expect(usuarioAceptable('4521')).toBe(false);
        expect(usuarioAceptable('')).toBe(false);
    });
    it('reconoce el ticket de vinculación', () => {
        expect(clasificarCodigo('KV23456789AB')).toBe('ticket');
        expect(clasificarCodigo('4521')).toBe('carne');
        expect(clasificarCodigo('pruebas')).toBe('otro');
    });
});

describe('el lector con el foco en «usuario»', () => {
    it('el código no queda en el campo ni envía el formulario', () => {
        const r = simular(teclas('45213'));
        expect(r.valor).toBe('');
        expect(r.eventos).toEqual([{ tipo: 'carne', codigo: '45213' }]);
        expect(r.eventos.some((e) => e.tipo === 'enviar-formulario')).toBe(false);
    });
    it('respeta lo que la persona ya había escrito', () => {
        const r = simular(teclas('4521'), { valorInicial: 'maria' });
        expect(r.valor).toBe('maria');
        expect(r.eventos).toEqual([{ tipo: 'carne', codigo: '4521' }]);
    });
    it('un lector sin Enter también se cobra, al callarse', () => {
        const r = simular(teclas('4521', null), { ultimaVencida: true });
        expect(r.valor).toBe('');
        expect(r.eventos).toEqual([{ tipo: 'carne', codigo: '4521' }]);
    });
    it('el código más corto (3 dígitos) tampoco queda', () => {
        const r = simular(teclas('452'));
        expect(r.valor).toBe('');
        expect(r.eventos).toEqual([{ tipo: 'carne', codigo: '452' }]);
    });
});

describe('lo que NO es un carné sigue igual', () => {
    it('una persona escribiendo su usuario no pierde nada', () => {
        const r = simular(teclas('maria.lopez'), { paso: 150 });
        expect(r.valor).toBe('maria.lopez');
        expect(r.eventos).toEqual([{ tipo: 'enviar-formulario', valor: 'maria.lopez' }]);
    });
    it('un auto-tecleo veloz de un usuario con letras vuelve entero y envía', () => {
        const r = simular(teclas('maria.lopez'));
        expect(r.valor).toBe('maria.lopez');
        expect(r.eventos).toEqual([{ tipo: 'enviar-formulario', valor: 'maria.lopez' }]);
    });
    it('una contraseña tecleada rápido y sin Enter vuelve al campo', () => {
        const r = simular(teclas('123', null), { campo: 'clave', esClave: true, ultimaVencida: true });
        expect(r.valor).toBe('123');
        expect(r.eventos).toEqual([]);
    });
    it('un hueco humano después de una ráfaga devuelve el texto', () => {
        const d = crearDetectorDeRafaga();
        let valor = '';
        const aplicar = (ordenes, key) => {
            let bloq = false;
            for (const o of ordenes) { if (o.tipo === 'poner') valor = o.valor; if (o.tipo === 'bloquear') bloq = true; }
            if (!bloq) valor += key;
        };
        [['a', 0], ['b', 10], ['c', 20], ['d', 300]].forEach(([k, t]) => aplicar(d.tecla({ key: k, t, campo: 'u', valor }), k));
        expect(valor).toBe('abcd');
    });
});

describe('fuera de los campos', () => {
    it('el lector entra con el carné', () => {
        const r = simular(teclas('45213'), { campo: null });
        expect(r.eventos).toEqual([{ tipo: 'carne', codigo: '45213' }]);
    });
    it('un código tecleado a mano no entra: se avisa', () => {
        const r = simular(teclas('45213'), { campo: null, paso: 150 });
        expect(r.eventos).toEqual([{ tipo: 'manual' }]);
    });
    it('el ticket de vinculación se reconoce', () => {
        const r = simular(teclas('KV23456789AB'), { campo: null });
        expect(r.eventos).toEqual([{ tipo: 'ticket', codigo: 'KV23456789AB' }]);
    });
});
