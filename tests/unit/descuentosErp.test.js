import { describe, it, expect } from 'vitest';
import {
    desescapar, soloTexto, tipoDelFormulario, valorDeCampo,
} from '../../supabase/functions/_shared/descuentos.ts';

// Lo que el portal LEE del sistema de la caja para saber qué descuenta cada
// campaña.
//
// **Estas pruebas existen porque un tipo mal leído cambia el dinero en silencio.**
// «$0.75 por cada unidad» y «0.75 % del renglón» se pintan igual de bien en la
// pantalla, no dan error, y guardar desde ahí convierte el descuento de verdad.
//
// Los fragmentos de abajo son LITERALES capturados de producción el 2026-09-04,
// no markup redactado. Ése es el punto: un ejemplo inventado prueba la regex
// contra sí misma — y fue exactamente lo que falló, porque nadie habría
// escrito a mano un `<option>` sin espacio antes de `selected`.

/** El `<select>` de un descuento por MONTO (promo 7 y 17). Ojo al `"$"selected`. */
const SELECT_MONTO = `<select class="form-control select2" name="tipo_descuento" id="tipo_descuento" value="$" required title="Por favor seleccione un tipo de descuento">
    <option value="">Seleccione</option>
    <option value="%" >Por porcentaje</option>
    <option value="$"selected>Por monto</option>
</select>`;

/** El mismo, para un descuento por PORCENTAJE (promo 15). */
const SELECT_PORCENTAJE = `<select class="form-control select2" name="tipo_descuento" id="tipo_descuento" value="%" required title="Por favor seleccione un tipo de descuento">
    <option value="">Seleccione</option>
    <option value="%" selected>Por porcentaje</option>
    <option value="$">Por monto</option>
</select>`;

/** Lo que devuelve el formulario de alta: ninguna opción elegida. */
const SELECT_VACIO = `<select class="form-control select2" name="tipo_descuento" id="tipo_descuento" value="" required>
    <option value="">Seleccione</option>
    <option value="%" >Por porcentaje</option>
    <option value="$">Por monto</option>
</select>`;

describe('tipoDelFormulario — el espacio que no está', () => {
    it('lee el MONTO aunque el origen escriba `"$"selected` sin espacio', () => {
        // La regresión: con `\s+selected` esto devolvía `%`, que es el default.
        expect(tipoDelFormulario(SELECT_MONTO)).toBe('$');
    });

    it('lee el PORCENTAJE cuando sí hay espacio', () => {
        expect(tipoDelFormulario(SELECT_PORCENTAJE)).toBe('%');
    });

    it('LANZA cuando no hay ninguna opción elegida, en vez de asumir', () => {
        // Asumir `%` acá es justo lo que hizo el defecto invisible: sin error,
        // un descuento por monto se mostraba como porcentaje.
        expect(() => tipoDelFormulario(SELECT_VACIO)).toThrow();
    });
});

// ── Los campos ocultos del formulario ──────────────────────────────────────
//
// Literal del formulario de edición del descuento 14, con las comillas dobles
// que usa esa parte de la página.
const FORM = `<input type="hidden" id="id_sucursal_dom" value="1">
<input type="hidden" id="process" name="process" value="edit">
<input type="hidden" id="id_promocion" name="id_promocion" value="14">
<input type="hidden" id="id_usuario" name="id_usuario" value="32">
<input type="text" id="descripcion" name="descripcion" class="form-control" value="Promocion Omega 3 2+1" required>
<input type="text" id="monto" name="monto" class="form-control" value="29.67" required>
<input type='text' class='datepick form-control' id='fecha_inicio' name='fecha_inicio' value='2026-07-29'>
<input type='checkbox'checked id='multi_sucursal' name='multi_sucursal' value='1'>
<input type='hidden' id='admin' name='admin' value="1">`;

describe('valorDeCampo', () => {
    it('lee campos escritos con comillas dobles', () => {
        expect(valorDeCampo(FORM, 'process')).toBe('edit');
        expect(valorDeCampo(FORM, 'id_promocion')).toBe('14');
        expect(valorDeCampo(FORM, 'monto')).toBe('29.67');
    });

    it('lee campos escritos con comillas simples — el origen mezcla las dos', () => {
        expect(valorDeCampo(FORM, 'fecha_inicio')).toBe('2026-07-29');
        expect(valorDeCampo(FORM, 'multi_sucursal')).toBe('1');
    });

    it('devuelve null cuando el campo no está', () => {
        // Es la señal de «esta página no es el formulario»: el origen devuelve
        // 200 con título «Editar promocion» a una cuenta sin esa pantalla.
        expect(valorDeCampo(FORM, 'no_existe')).toBeNull();
    });
});

describe('soloTexto y desescapar — las celdas de la lista', () => {
    it('deja el texto de una celda envuelta en etiquetas', () => {
        expect(soloTexto("<label style='color:blue'>Multi sucursal</label>")).toBe('Multi sucursal');
        expect(soloTexto("<label style='color:blue'> 20.00 %</label>")).toBe('20.00 %');
    });

    it('no pega palabras al quitar una etiqueta entre dos', () => {
        // Reemplazar por vacío daría «unados»; por eso la etiqueta se cambia
        // por un espacio y recién después se colapsan los espacios.
        expect(soloTexto('<b>uno</b><i>dos</i>')).toBe('uno dos');
    });

    it('desescapa las entidades que el origen escribe en un value', () => {
        expect(desescapar('Abbot &amp; Cia')).toBe('Abbot & Cia');
        expect(desescapar('Promo &quot;especial&quot;')).toBe('Promo "especial"');
        expect(desescapar('Promo de Jos&#39;e')).toBe("Promo de Jos'e");
    });
});
