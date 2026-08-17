// El carné ES la contraseña (`AuthContext.login` lo manda como `password` a
// `signInWithPassword`). O sea que si el lector dispara con el foco puesto en
// «usuario» —un campo de texto plano—, el código queda escrito y a la vista de
// cualquiera que mire la pantalla del mostrador.
//
// La captura global de keydown de LoginView no cubre ese caso a propósito:
// mientras el foco está en un input, las teclas son del input. Lo que separa a
// un lector de una persona es la VELOCIDAD, y este archivo mide justamente eso
// — incluida la vuelta atrás, que es la parte que se rompe sola: los códigos
// reales miden 3, 4 o 5 caracteres, así que el detector tiene que decidir con
// dos huecos, y sin la vuelta atrás un tecleo humano veloz se comería texto.
//
// Corre contra la pantalla de login, sin sesión: no toca la base.
import { test, expect } from '@playwright/test';

// El login enfoca «usuario» solo a los 60ms de montar (en un equipo sin
// lector). Toda prueba que dependa de dónde está el foco tiene que esperar a
// que eso pase: si no, corre una carrera contra el propio login.
const focoAsentado = async (page) => {
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('username');
};

const RAFAGA = 6;    // ms entre teclas — un lector real anda por debajo de 15
const HUMANO = 130;  // ms entre teclas — un tecleo rápido de persona

// El detector sólo vive en equipos donde CONSTA que hay lector: una terminal
// de kiosco, o una donde un carné ya abrió sesión. En una computadora personal
// no intercepta nada — un gestor de contraseñas rellena tan rápido como un
// lector y confundirlos deja al usuario sin poder entrar (pasó tres veces el
// 2026-08-16). La marca la escribe el login al validar un carné; acá se
// siembra a mano para poder probar el caso.
test.describe('Login · el carné no se escribe en el campo de usuario', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('lector_carne_ok', '1'));
        await page.goto('/login');
        await expect(page.locator('#username')).toBeVisible();
    });

    test('un tecleo humano entra tal cual', async ({ page }) => {
        const usuario = page.locator('#username');
        await usuario.click();
        await page.keyboard.type('maria.hernandez', { delay: HUMANO });
        await expect(usuario).toHaveValue('maria.hernandez');
    });

    test('una ráfaga de lector no deja el código a la vista', async ({ page }) => {
        const usuario = page.locator('#username');
        await usuario.click();
        await page.keyboard.type('447', { delay: RAFAGA });
        // Ni siquiera antes del Enter: en cuanto se detecta, lo pintado se borra.
        await expect(usuario).toHaveValue('');
        await page.keyboard.press('Enter');
        // Y el Enter va al lector, no al formulario: se ve el intento de validar.
        await expect(page.getByText(/Verificando|Carné no reconocido|conexión/i).first()).toBeVisible({ timeout: 5000 });
        await expect(usuario).toHaveValue('');
    });

    test('la ráfaga respeta lo que la persona ya había escrito', async ({ page }) => {
        const usuario = page.locator('#username');
        await usuario.click();
        await page.keyboard.type('ana', { delay: HUMANO });
        await page.keyboard.type('5091', { delay: RAFAGA });
        await page.keyboard.press('Enter');
        await expect(usuario).toHaveValue('ana');
    });

    test('un tecleo veloz de persona se devuelve entero al campo', async ({ page }) => {
        const usuario = page.locator('#username');
        await usuario.click();
        await page.keyboard.type('asd', { delay: 5 });      // dispara la sospecha
        await page.keyboard.type('fghij', { delay: HUMANO }); // el hueco humano la deshace
        await expect(usuario).toHaveValue('asdfghij');
    });

    // En «contraseña» el detector es CONDICIONAL, y la razón está medida: un
    // gestor de contraseñas que rellena tecleando escribe igual de rápido que
    // un lector, y si el detector se lo come, el usuario no puede entrar (pasó
    // el 2026-08-16). Ahí no hay nada que ocultar —el campo ya enmascara— y lo
    // peor que puede pasar sin detector es un intento de login fallido. Así
    // que sólo se enciende donde consta que hay lector.
    test('la ráfaga tampoco entra por el campo de contraseña', async ({ page }) => {
        const clave = page.locator('#password');
        await clave.click();
        await page.keyboard.type('447', { delay: RAFAGA });
        await page.keyboard.press('Enter');
        await expect(clave).toHaveValue('');
    });

});

test.describe('Login · en un equipo sin lector no se intercepta nada', () => {
    // Éste es el caso de una computadora personal con gestor de contraseñas:
    // que escriba rápido no puede costarle el texto a nadie.
    for (const campo of ['username', 'password']) {
        test(`las teclas rápidas llegan enteras a ${campo}`, async ({ page }) => {
            await page.goto('/login');
            const input = page.locator(`#${campo}`);
            await input.click();
            await page.keyboard.type('Sup3rSecreta!', { delay: RAFAGA });
            await expect(input).toHaveValue('Sup3rSecreta!');
        });
    }
});

test.describe('Login · el carné tecleado a mano no abre la sesión', () => {
    // El código de carné es corto y se lo puede saber un compañero. Antes
    // alcanzaba con escribirlo con la pantalla enfocada y apretar Enter: el
    // login lo tomaba por un escaneo. Ahora se exige velocidad de lector, que
    // es la misma medida con la que el kiosco rechaza el tecleo manual.
    test('escribirlo despacio y pulsar Enter no valida nada', async ({ page }) => {
        const intentos = [];
        page.on('request', (r) => { if (r.url().includes('ensure_user_by_code')) intentos.push(r.url()); });

        await page.goto('/login');
        await expect(page.locator('#username')).toBeVisible();
        // El foco tiene que estar FUERA de los campos, que es donde escucha el
        // lector. En un equipo sin lector el login enfoca «usuario» solo a los
        // 60ms, así que hay que esperar a que eso ocurra antes de soltarlo —
        // si no, la prueba corre una carrera y a veces teclea dentro del campo.
        await focoAsentado(page);
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.type('447', { delay: 180 });
        await page.keyboard.press('Enter');

        await expect(page.getByText(/se lee con el lector/i)).toBeVisible();
        expect(intentos).toHaveLength(0);
    });
});

// El lazo cerrado que dejó el carné sin poder abrir sesión en NINGUNA
// computadora que no fuera un kiosco vinculado: sin marca de lector el foco
// arranca en «usuario» y el detector está apagado, así que el carné se escribía
// adentro del campo y su Enter mandaba el formulario como usuario/contraseña —
// y como la marca sólo la escribe un carné que abre sesión, el equipo no podía
// salir nunca de ahí. La salida no intercepta teclas (eso rompía el gestor de
// contraseñas): anota la velocidad y decide al enviar.
test.describe('Login · el primer carné de un equipo sin marca', () => {
    const sinMarca = async (page) => {
        await page.goto('/login');
        await expect(page.locator('#username')).toBeVisible();
        await focoAsentado(page);
    };

    test('una ráfaga en «usuario» se valida como carné y no queda a la vista', async ({ page }) => {
        const intentos = [];
        page.on('request', (r) => { if (r.url().includes('ensure_user_by_code')) intentos.push(r.url()); });

        await sinMarca(page);
        // Sin marca no se intercepta nada: el código SÍ se pinta mientras entra.
        await page.keyboard.type('447', { delay: RAFAGA });
        await expect(page.locator('#username')).toHaveValue('447');
        await page.keyboard.press('Enter');

        // Se fue por el camino del carné, no por el de usuario/contraseña.
        await expect.poll(() => intentos.length).toBeGreaterThan(0);
        // Y el código no se queda en pantalla ni cuando el carné es rechazado.
        await expect(page.locator('#username')).toHaveValue('');
        await expect(page.getByText(/Carné no reconocido|conexión/i).first()).toBeVisible({ timeout: 5000 });
    });

    test('un tecleo humano con la contraseña vacía sigue siendo un login normal', async ({ page }) => {
        const intentos = [];
        page.on('request', (r) => { if (r.url().includes('ensure_user_by_code')) intentos.push(r.url()); });

        await sinMarca(page);
        await page.keyboard.type('447', { delay: HUMANO });
        await page.keyboard.press('Enter');

        await expect(page.getByText(/Ingresa usuario y contraseña/i)).toBeVisible();
        expect(intentos).toHaveLength(0);
        await expect(page.locator('#username')).toHaveValue('447');
    });

    test('un usuario del portal escrito a toda velocidad no se toma por carné', async ({ page }) => {
        // El caso del gestor de contraseñas: rellena tan rápido como un lector.
        // Lo que lo separa es la FORMA — un usuario es `nombre.apellido`, un
        // código de carné no lleva punto y mide 3 a 5 caracteres.
        const intentos = [];
        page.on('request', (r) => { if (r.url().includes('ensure_user_by_code')) intentos.push(r.url()); });

        await sinMarca(page);
        await page.keyboard.type('maria.hernandez', { delay: RAFAGA });
        await page.keyboard.press('Enter');

        await expect(page.getByText(/Ingresa usuario y contraseña/i)).toBeVisible();
        expect(intentos).toHaveLength(0);
        await expect(page.locator('#username')).toHaveValue('maria.hernandez');
    });
});

test.describe('Login · pegar', () => {
    // La regla no es «nunca se pega»: es «no se pega a mano». Un gestor de
    // contraseñas rellena con eventos sintéticos, y bloquearlos dejaba al
    // usuario sin poder entrar — pasó el 2026-08-16.
    test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

    for (const campo of ['username', 'password']) {
        test(`Ctrl+V de una persona en ${campo} no escribe nada`, async ({ page }) => {
            await page.goto('/login');
            const input = page.locator(`#${campo}`);
            await focoAsentado(page);
            await page.evaluate(() => navigator.clipboard.writeText('pegado.prohibido'));

            // Control positivo: sin esto, un portapapeles vacío haría pasar la
            // prueba sin probar nada.
            await page.evaluate(() => {
                const testigo = document.createElement('input');
                testigo.id = 'testigo-pegado';
                document.body.appendChild(testigo);
                testigo.focus();
            });
            await page.keyboard.press('ControlOrMeta+V');
            await expect(page.locator('#testigo-pegado')).toHaveValue('pegado.prohibido');

            await input.click();
            await page.keyboard.press('ControlOrMeta+V');
            await expect(input).toHaveValue('');
            await expect(page.getByText(/aquí no se pega/i)).toBeVisible();
        });
    }

    test('el relleno de un gestor de contraseñas sí entra', async ({ page }) => {
        await page.goto('/login');
        const permitido = await page.locator('#password').evaluate((el) => {
            const dt = new DataTransfer();
            dt.setData('text/plain', 'del-gestor');
            // `dispatchEvent` devuelve false si alguien llamó a preventDefault.
            return el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        });
        expect(permitido).toBe(true);
    });

    test('un gestor que rellena TECLEANDO rápido no pierde el texto', async ({ page }) => {
        // Sus teclas son sintéticas (`isTrusted: false`): no son un lector, y
        // si el detector de ráfagas se las come, la contraseña nunca llega.
        await page.goto('/login');
        await page.locator('#password').evaluate((el) => {
            el.focus();
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            for (const ch of 'Sup3rSecreta!') {
                el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
                setter.call(el, el.value + ch);
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
        await expect(page.locator('#password')).toHaveValue('Sup3rSecreta!');
    });
});

// ── La computadora de sala: sin cámara y sin marca de lector ────────────────
// El bloque del carné se pedía con `conLector || (!enMovil && hasCamera)`, y
// esas máquinas no cumplen ninguna de las dos: son equipos viejos sin cámara
// web, y la marca de lector sólo se enciende DESPUÉS del primer carné que abre
// sesión. O sea que la única puerta que esa gente usa no aparecía en pantalla.
// Reportado como «aun en monitores con baja resolución no aparece el carné»;
// la resolución no era la causa —por eso esta prueba corre a 1366×768, que es
// justo el monitor donde se vio, y el bloque tiene que estar igual—.
test.describe('Login · el carné en una computadora sin cámara', () => {
    const sinCamara = async (page) => {
        await page.setViewportSize({ width: 1366, height: 768 });
        await page.addInitScript(() => {
            // Se deja `enumerateDevices`, pero sin ninguna cámara: es el camino
            // real del login, no un atajo que saltee el efecto.
            Object.defineProperty(navigator, 'mediaDevices', {
                configurable: true,
                value: { enumerateDevices: async () => ([{ kind: 'audioinput', deviceId: 'x' }]) },
            });
        });
        await page.goto('/login');
        await expect(page.locator('#username')).toBeVisible();
    };

    test('el bloque del carné se ve, sin cámara y sin marca de lector', async ({ page }) => {
        await sinCamara(page);
        await expect(page.getByText('Escanear carné')).toBeVisible();
        await expect(page.getByText(/Pasa el carné por el lector/i)).toBeVisible();
        // El botón de cámara no se ofrece: este equipo no tiene una.
        await expect(page.getByTitle(/Escanear con cámara/i)).toHaveCount(0);
    });

    test('no se pide un escaneo ni se le roba el foco a nadie', async ({ page }) => {
        // Lo que motivó la regla de v2.638.0 («si no hay lector, que no pida
        // escanear») era el estorbo: 30 segundos con el foco fuera de los
        // campos y un cartel de «lector activo» que no se podía cumplir. Eso
        // NO vuelve — se muestra la puerta, no se obliga a usarla.
        await sinCamara(page);
        await focoAsentado(page);
        await expect(page.getByText(/Lector activo/i)).toHaveCount(0);
        await expect(page.getByText(/usuario en \d+s/i)).toHaveCount(0);
    });
});
