// ─────────────────────────────────────────────────────────────────────────────
// Un select y un campo de texto tienen que medir lo MISMO
// ─────────────────────────────────────────────────────────────────────────────
//
// El 2026-08-26 el usuario reportó que los campos no estaban alineados. Medido
// con Chromium sobre el CSS compilado: `PortalInput` **40px**, `LiquidSelect`
// **46.3px**. O sea que los dos controles más usados del portal NUNCA quedaron
// a la misma altura, en ninguna pantalla — y como no falla nada, sólo se ve.
//
// La causa fue que el select ya declaraba el `min-h` correcto (§25.10 unificó
// las alturas) y le quedó el `py-3.5` viejo, que se SUMA. La corrección fue
// quitarle el relleno vertical y dejar que la altura la decida el mínimo.
//
// ── Por qué esta prueba lee el FUENTE ────────────────────────────────────────
//
// jsdom no calcula layout: no puede medir 40 contra 46. Lo que sí puede es
// vigilar la forma que produjo el defecto — un relleno vertical encima de un
// alto ya declarado. Es una red para la REGRESIÓN, no una medición; la medición
// se hizo con un navegador de verdad y está escrita arriba.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const leer = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('el alto de los controles de formulario', () => {
    const select = leer('src/components/common/LiquidSelect.jsx');
    const input = leer('src/components/common/PortalInput.jsx');

    it('los dos canónicos declaran el mismo alto', () => {
        const alto = 'max(40px,var(--tap-min))';
        expect(select).toContain(`min-h-[${alto}]`);
        expect(input).toContain(`h-[${alto}]`);
    });

    it('el disparador del select no le suma relleno vertical a ese alto', () => {
        // `nano` sí lo lleva: su mínimo son 26px y ahí el relleno es lo que
        // separa el texto del borde. Los otros dos no pueden.
        const linea = select.split('\n').find(l => l.includes('const paddingStyle'));
        expect(linea).toBeTruthy();
        const sinNano = linea.replace(/nano \? '[^']*' :/, '');
        expect(sinNano).not.toMatch(/\bpy-/);
        expect(sinNano).not.toMatch(/\bpt-|\bpb-/);
    });

    it('los TRES canónicos de campo miden lo mismo, normal y compacto', () => {
        // Medido con Chromium: campo 40, select 40, fecha 40; y compactos, 32
        // los tres. Antes el select medía 46.3 y la fecha no tenía altura
        // propia —la tomaba de quien la envolviera, y sus 61 llamadores usaban
        // CINCO alturas distintas—.
        const fecha = leer('src/components/common/LiquidDatePicker.jsx');
        const alto = 'max(40px,var(--tap-min))';
        expect(select).toContain(`min-h-[${alto}]`);
        expect(input).toContain(`h-[${alto}]`);
        expect(fecha).toContain(`h-[${alto}]`);
        // `compact` significa lo mismo en los tres: 32px.
        expect(input).toContain("compact ? 'h-8'");
        // `bare` queda fuera de la reducción: ahí la caja es del anfitrión.
        expect(select).toContain("(compact && !bare) ? 'min-h-8'");
        expect(fecha).toContain("compact ? 'h-8'");
    });

    it('el selector de RANGO usa el mismo alto que los demás', () => {
        // Tenía TRES alturas propias: 48px el de un rango suelto, 40 el de
        // varios y 44 el compacto. Los 48 eran los que se veían, porque sus
        // tres usos en formulario lo ponen al lado de campos de 40.
        const rango = leer('src/components/common/RangeDatePicker.jsx');
        // Se mira el CAMPO CERRADO y no el archivo entero: adentro hay un
        // `w-11 h-11` que es la casilla de un día del calendario en táctil, y
        // ésa sí tiene que medir 44.
        const cerrados = rango.split('\n').filter(l => l.includes('data-surface="input"'));
        expect(cerrados.length).toBeGreaterThan(0);
        for (const l of cerrados) expect(l).toContain('h-[max(40px,var(--tap-min))]');
    });

    it('`bare` no encoge el select: la caja es del anfitrión', () => {
        // `bare` significa que la píldora de filtro (o la paginación, o
        // `TimePicker12`) dibuja la superficie. Ahí el alto es asunto del
        // anfitrión y el nuestro es el blanco donde se hace clic: encogerlo a 32
        // no movía un píxel en pantalla y recortaba el blanco sin que se viera.
        expect(select).toContain('(compact && !bare)');
    });

    it('el campo de fecha dibuja su propia caja', () => {
        // Sin esto vuelve a depender del envoltorio de cada llamador, que es de
        // donde salieron las cinco alturas.
        const fecha = leer('src/components/common/LiquidDatePicker.jsx');
        expect(fecha).toMatch(/data-surface=\{tono \? undefined : 'input'\}/);
    });

    it('el formulario de personal no escribe alturas a mano', () => {
        // 20 recuadros llevaban `h-[40px]` literal: en escritorio coincidían con
        // los canónicos y en un teléfono no, porque ahí los canónicos suben a 44
        // y un literal se queda en 40.
        const form = leer('src/components/forms/EmployeeFormModal.jsx');
        expect(form).not.toMatch(/h-\[40px\]/);
    });
});
