import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';

import AvatarConEstado from '../../src/components/common/AvatarConEstado';

// El store es la fuente cuando el llamador no trae la ficha entera. Se le da la
// misma persona que `DE_VACACIONES` para que la prueba de resolución por id
// tenga contra qué resolver.
vi.mock('@nucleo/store/staffStore', () => ({
    useStaffStore: (selector) => selector({
        employees: [{
            id: 1, name: 'Edwin Nuñez',
            // Como en el store real: `photo` es la URL FIRMADA que pone el
            // arranque y `photo_url` la cruda, que en un bucket privado no se
            // puede mostrar. La prueba las distingue a propósito.
            // Sin `/storage/v1/object/sign/` a propósito: así `webpSignedUrl`
            // la devuelve tal cual y la prueba afirma CUÁL foto se eligió, no
            // cómo se reescribe —que es cosa de `LiquidAvatar`—.
            photo: 'https://firmada/edwin.jpg?token=abc',
            photo_url: 'https://cruda/edwin.jpg',
            history: [{ type: 'VACATION', date: '2020-01-01', metadata: { endDate: '2099-09-02' } }],
        }],
    }),
}));


// ═══════════════════════════════════════════════════════════════════════════
// El aro de la foto, y la escalera de tamaños que lo hace funcionar.
//
// El estado de una persona pasó por tres formas antes de ésta, y las dos
// primeras las rechazó el usuario mirando la pantalla:
//
//   1. Un badge debajo de los cargos → «no distingo que está de vacación».
//      Quedaba cuarto en una pila de badges, y el de arriba —«Faltan 2 datos»—
//      era del mismo ámbar, tamaño y forma.
//   2. La foto en gris → «parece muerto». El gris es el vocabulario de «dado de
//      baja», no el de «vuelve el martes».
//   3. El aro de color. Elegido sobre otros cuatro tratamientos por una razón
//      medible: **no se encoge como un ícono**.
//
// Lo que se ancla acá es esa razón, porque es lo que se pierde primero si
// alguien «simplifica» el componente: en el portal la foto va de 20 px —firmas
// de bitácoras, chips de pedidos, la campana— a 160 px en la ficha, o sea ocho
// veces. El chip tiene que irse antes de volverse una mancha; el aro no.
// ═══════════════════════════════════════════════════════════════════════════

const DE_VACACIONES = {
    id: 1, name: 'Edwin Nuñez',
    history: [{ type: 'VACATION', date: '2020-01-01', metadata: { endDate: '2099-09-02' } }],
};

const PRESENTE = { id: 2, name: 'Nathaly Estrada', history: [] };

const montar = (emp, px) => render(<AvatarConEstado emp={emp} px={px} />).container;

// El chip se busca por su atributo y no por su rol: el rol vive en el CONJUNTO
// —foto más aro, que es lo que significa algo— y el chip es `aria-hidden`,
// porque anunciarlo aparte sería decir «palmera» después de «en vacaciones».
const chip = (c) => c.querySelector('[data-chip-estado]');
const marco = (c) => c.querySelector('[data-estado]');

describe('AvatarConEstado — el aro sobrevive al achique, el chip no', () => {
    beforeEach(() => cleanup());

    it('quien está presente no lleva ninguna marca', () => {
        const c = montar(PRESENTE, 64);
        expect(marco(c)).toBeNull();
        expect(chip(c)).toBeNull();
    });

    it('a 64 px lleva aro Y chip: dice QUÉ pasa', () => {
        const c = montar(DE_VACACIONES, 64);
        expect(marco(c).dataset.estado).toBe('VACATION');
        expect(chip(c)).toBeTruthy();
        expect(chip(c).dataset.chipEstado).toBe('VACATION');
        // El nombre accesible lo pone el conjunto, no el pedazo.
        expect(marco(c).getAttribute('aria-label')).toBe('En vacaciones · vuelve el 3 de septiembre');
    });

    // Diseño «cuatro esquinas» (2026-11-05): el aro es una sombra INLINE —el
    // filo del fondo y después el color—, así que se lee del `style`.
    const aro = (c) => c.querySelector('[data-estado] > span').style.boxShadow;

    it('a 28 px el chip se va, y el aro se queda', () => {
        // El chip arranca en 36. A 28 mediría 11 px y su ícono 6: una mancha.
        const c = montar(DE_VACACIONES, 28);
        expect(chip(c)).toBeNull();
        expect(marco(c).dataset.estado).toBe('VACATION');
        expect(aro(c)).toContain('var(--color-warning)');
    });

    it('a 36 px ya lleva chip', () => {
        expect(chip(montar(DE_VACACIONES, 36))).toBeTruthy();
    });

    it('a 20 px —la FIRMA— el aro sigue estando, fino y sin filo', () => {
        const c = montar(DE_VACACIONES, 20);
        expect(marco(c).dataset.estado).toBe('VACATION');
        expect(aro(c)).toBe('0 0 0 1.5px var(--color-warning)');
    });

    // La red que cubre lo que el color solo no puede decir: a cualquier tamaño,
    // y para cualquiera que no distinga ámbar de rojo, la frase completa está
    // en el `title`.
    it('el título lleva la frase completa a CUALQUIER tamaño', () => {
        [64, 48, 36, 28, 20].forEach(px => {
            cleanup();
            const c = montar(DE_VACACIONES, px);
            expect(marco(c).getAttribute('title')).toBe('En vacaciones · vuelve el 3 de septiembre');
        });
    });

    it('el grosor del aro es ABSOLUTO, no proporcional al tamaño', () => {
        // Es el motivo por el que se eligió el aro: no se encoge como un ícono.
        // Se lee ANTES de limpiar: `cleanup()` desmonta el árbol.
        const leer = (px) => { const c = montar(DE_VACACIONES, px); const v = aro(c); cleanup(); return v; };
        expect(leer(64)).toContain('0 0 0 4.5px');
        expect(leer(48)).toContain('0 0 0 4.5px');
        expect(leer(36)).toContain('0 0 0 4px');
        expect(leer(28)).toContain('0 0 0 4px');
    });

    // ── La regresión que jsdom casi no puede ver ─────────────────────────
    // La primera versión dibujaba el aro con `ring-inset`: una sombra interior
    // se pinta DEBAJO de los hijos, y el hijo es una foto que ocupa el 100% de
    // la caja — el aro existía en el DOM y era invisible. Lo que se ancla es la
    // causa: que la sombra no sea `inset`.
    it('el aro NO es `inset` — ahí es donde la foto se lo comía', () => {
        const c = montar(DE_VACACIONES, 64);
        expect(aro(c)).toContain('var(--color-warning)');
        expect(aro(c)).not.toContain('inset');
    });

    it('el estado se resuelve por id cuando el llamador no trae historial', () => {
        // El sidebar pasa el objeto de la SESIÓN, que no lleva `history`; los
        // chips de pedidos pasan {id, name, photo}. Si el aro dependiera de que
        // el llamador traiga el historial, el estado saldría en unas pantallas
        // y en otras no, sin que nada fallara.
        const c = montar({ id: 1, name: 'Edwin Nuñez', photo: null }, 64);
        expect(marco(c).dataset.estado).toBe('VACATION');
    });

    it('quien fue dado de baja también lleva marca, y en su propio color', () => {
        const c = montar({ id: 3, name: 'Alguien', status: 'INACTIVO', history: [] }, 64);
        expect(marco(c).dataset.estado).toBe('INACTIVO');
        expect(marco(c).getAttribute('title')).toBe('Inactivo');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// La CARA, que es lo que el componente lleva en el nombre y fue lo último en
// resolverse por id.
//
// Durante un año el estado se buscaba en el store y la foto salía del objeto
// que llegara. `emp={{ id, name }}` —lo que uno escribe cuando la consulta ya
// trae el id— pintaba la INICIAL, y eso es exactamente lo que el componente
// debe hacer cuando de verdad no hay retrato: el resultado de pasarle medio
// objeto era indistinguible del de una persona sin foto. Por eso vivió tanto,
// y por eso el usuario tuvo que reportarlo DOS veces sobre la misma pantalla.
//
// Lo que se ancla acá es que el llamador ya no puede equivocarse: alcanza con
// el id.
// ═══════════════════════════════════════════════════════════════════════════

const foto = (c) => c.querySelector('img');
const inicial = (c) => c.querySelector('span.font-black.uppercase');

describe('AvatarConEstado — la foto se resuelve por id, no la trae el llamador', () => {
    beforeEach(() => cleanup());

    it('con sólo {id, name} sale la CARA, no la inicial', () => {
        const c = montar({ id: 1, name: 'Edwin Nuñez' }, 26);
        expect(foto(c)).toBeTruthy();
        expect(foto(c).getAttribute('src')).toBe('https://firmada/edwin.jpg?token=abc');
        expect(inicial(c)).toBeNull();
    });

    it('la firmada del store le gana a la cruda que trajo el llamador', () => {
        // Una consulta suelta que devuelva `photo_url` sin pasar por
        // `signPhotosDeep` trae la URL cruda, que en un bucket privado no se
        // puede mostrar. Preferir la del store arregla la foto ROTA, no sólo la
        // ausente.
        const c = montar({ id: 1, name: 'Edwin Nuñez', photo_url: 'https://cruda/edwin.jpg' }, 26);
        expect(foto(c).getAttribute('src')).toBe('https://firmada/edwin.jpg?token=abc');
    });

    it('a quien no está en el store se le respeta la foto que trajo', () => {
        // La lista del store está ACOTADA por permisos, y hay llamadores que
        // pasan el id de la CUENTA y no el de la ficha —que para 33 de 42
        // personas no son el mismo valor—. Ahí lo del llamador es todo lo que
        // hay, y quitárselo sería cambiar un defecto por otro.
        const c = montar({ id: 99, name: 'Alguien Más', photo: 'https://otra/foto.jpg' }, 26);
        expect(foto(c).getAttribute('src')).toBe('https://otra/foto.jpg');
    });

    it('sin foto en ningún lado sí sale la inicial — ése es su trabajo', () => {
        const c = montar({ id: 99, name: 'Alguien Más' }, 26);
        expect(foto(c)).toBeNull();
        expect(inicial(c).textContent).toBe('A');
    });
});
