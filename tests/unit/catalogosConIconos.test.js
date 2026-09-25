// Todo ícono que un catálogo nombra, su complemento de interfaz lo tiene.
//
// Desde el 2026-09-25 los catálogos del núcleo guardan el ícono por NOMBRE
// (`icono: 'Home'`) y `components/common/catalogos/*` les pone el componente.
// El riesgo nuevo es silencioso: agregar un módulo con `icono: 'Algo'` y no
// importar `Algo` en el complemento deja el menú con un hueco, sin error.
import { describe, it, expect } from 'vitest';
import * as modulos from '../../src/components/common/catalogos/modulos';
import * as permisos from '../../src/components/common/catalogos/permisos';
import * as constantes from '../../src/components/common/catalogos/constantes';
import * as tipos from '../../src/components/common/catalogos/tiposDeAviso';
import * as documentos from '../../src/components/common/catalogos/documentos';
import * as notificaciones from '../../src/components/common/catalogos/notificaciones';
import { NOMBRE_DE_ICONO_POR_TIPO } from '../../src/constants/tipoIconos';
import { ROTULOS } from '../../src/utils/documentosDelExpediente';

const esComponente = (c) => typeof c === 'function' || !!(c && typeof c === 'object' && c.$$typeof);

// Todo objeto con `icono` tiene que haber recibido su `icon`.
function faltantes(v, ruta = '', out = []) {
    if (Array.isArray(v)) v.forEach((x, i) => faltantes(x, `${ruta}[${i}]`, out));
    else if (v && typeof v === 'object' && !(v instanceof RegExp) && !v.$$typeof) {
        if (typeof v.icono === 'string' && !esComponente(v.icon)) out.push(`${ruta} → '${v.icono}'`);
        for (const [k, x] of Object.entries(v)) if (k !== 'icon') faltantes(x, `${ruta}.${k}`, out);
    }
    return out;
}

describe('cada ícono nombrado existe en su complemento', () => {
    it('módulos del menú', () => expect(faltantes(modulos.MODULE_MAP)).toEqual([]));
    it('grupos de permisos', () => expect(faltantes(permisos.MODULE_GROUPS)).toEqual([]));
    it('permisos planos', () => expect(faltantes(permisos.MODULE_INFO)).toEqual([]));
    it('tipos de evento', () => expect(faltantes(constantes.EVENT_TYPES)).toEqual([]));
    it('tipos de aviso', () => {
        for (const t of Object.keys(NOMBRE_DE_ICONO_POR_TIPO)) expect(esComponente(tipos.iconoDeTipo(t)), t).toBe(true);
        expect(esComponente(tipos.iconoDeTipo('UN_TIPO_QUE_NO_EXISTE'))).toBe(true);
    });
    it('categorías de documento', () => {
        for (const c of [...Object.keys(ROTULOS), 'SIN_CATEGORIA']) expect(esComponente(documentos.iconoDeCategoria(c)), c).toBe(true);
    });
    it('severidades de aviso', () => {
        for (const s of notificaciones.SEVERIDAD) expect(esComponente(s.Icono), s.icono).toBe(true);
    });
});
