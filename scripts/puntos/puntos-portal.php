<?php
/**
 * Puente entre el portal y la base de puntos.
 *
 * Existe porque el 3306 de ese servidor no acepta conexiones desde afuera: se
 * probó desde el portal y desde una máquina de desarrollo, y las dos dan
 * `timeout` — el firewall corta el TCP antes de pedir credenciales. La hoja de
 * cálculo entraba porque las IP de Google están autorizadas; las del portal
 * cambian y son muchas, así que autorizarlas equivale a abrir el puerto a todo
 * internet.
 *
 * Este archivo evita eso: vive DENTRO del servidor, habla con MySQL por
 * localhost, y hacia afuera sólo expone HTTPS en el 443 — que ya está abierto.
 * La contraseña de MySQL nunca sale de acá.
 *
 * ── Cómo instalarlo ──────────────────────────────────────────────────────────
 *   1. Llenar los cuatro valores de «Configuración». La contraseña NO vive en
 *      este repositorio a propósito: se pega al subir el archivo. Un archivo con
 *      credenciales dentro del control de versiones se copia solo a todas
 *      partes y no se puede rotar.
 *   2. Generar el token con:  openssl rand -hex 32
 *      Ese MISMO valor va en el portal como el secreto PUNTOS_ENDPOINT_TOKEN.
 *   3. Subirlo a public_html/ con un nombre que no se adivine, p.ej.
 *      `puente-a1b2c3d4.php`, y usar esa URL como PUNTOS_ENDPOINT_URL.
 *
 * ── Qué hace ─────────────────────────────────────────────────────────────────
 *   {"accion":"esquema"}                  → qué tablas y columnas hay
 *   {"accion":"enviar","filas":[ ... ]}   → inserta las ventas
 *
 * NO hay acción de borrado ni de resta todavía, a propósito: no se sabe cómo
 * representa una reversión el sistema de puntos, y una resta inventada es peor
 * que ninguna. Primero `esquema`, después se agrega sabiendo.
 */

declare(strict_types=1);

// ── Configuración ────────────────────────────────────────────────────────────
const TOKEN = 'PEGAR-ACA-EL-TOKEN';

const DB_HOST = 'localhost';
const DB_NAME = 'u651865694_puntossalud';
const DB_USER = 'u651865694_puntossalud';
const DB_PASS = 'PEGAR-ACA-LA-CONTRASENA';

// Tope por llamada. El portal manda en tandas; esto es sólo un freno para que
// una llamada mal formada no intente escribir un año entero de una vez.
const MAX_FILAS = 1000;

// ── Respuesta ────────────────────────────────────────────────────────────────
header('Content-Type: application/json; charset=utf-8');

function salir(int $codigo, array $cuerpo)
{
    http_response_code($codigo);
    echo json_encode($cuerpo, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

// ── Puerta ───────────────────────────────────────────────────────────────────
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    salir(405, ['error' => 'solo POST']);
}

$tokenRecibido = $_SERVER['HTTP_X_PORTAL_TOKEN'] ?? '';
// hash_equals y no `===`: comparar cadenas corta en la primera letra distinta, y
// esa diferencia de tiempo deja adivinar el token letra por letra desde afuera.
if (TOKEN === 'PEGAR-ACA-EL-TOKEN' || !hash_equals(TOKEN, $tokenRecibido)) {
    salir(401, ['error' => 'no autorizado']);
}

$crudo = file_get_contents('php://input');
$body  = json_decode($crudo ?: '{}', true);
if (!is_array($body)) {
    salir(400, ['error' => 'cuerpo no es JSON']);
}

// ── Conexión ─────────────────────────────────────────────────────────────────
try {
    $pdo = new PDO(
        'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
        DB_USER,
        DB_PASS,
        [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]
    );
} catch (Throwable $e) {
    salir(500, ['error' => 'no se pudo conectar', 'detalle' => $e->getMessage()]);
}

$accion = $body['accion'] ?? '';

// ── esquema: sólo lee ────────────────────────────────────────────────────────
if ($accion === 'esquema') {
    $salida = [];
    foreach ($pdo->query('SHOW TABLES')->fetchAll() as $fila) {
        $tabla = array_values($fila)[0];
        $cols  = $pdo->query('SHOW COLUMNS FROM `' . $tabla . '`')->fetchAll();
        $n     = $pdo->query('SELECT COUNT(*) n FROM `' . $tabla . '`')->fetch()['n'];
        $salida[$tabla] = [
            'filas'    => (int) $n,
            'columnas' => array_map(
                function ($c) {
                    return trim(
                        $c['Field'] . ' ' . $c['Type']
                        . ($c['Key'] ? ' ' . $c['Key'] : '')
                        . ($c['Null'] === 'NO' ? ' NOT NULL' : '')
                        . ($c['Default'] !== null ? ' def=' . $c['Default'] : '')
                        . ($c['Extra'] ? ' ' . $c['Extra'] : '')
                    );
                },
                $cols
            ),
        ];
    }
    salir(200, ['ok' => true, 'tablas' => $salida]);
}

// ── enviar: inserta las ventas ───────────────────────────────────────────────
if ($accion === 'enviar') {
    $filas = $body['filas'] ?? [];
    if (!is_array($filas)) {
        salir(400, ['error' => 'filas no es una lista']);
    }
    if (count($filas) > MAX_FILAS) {
        salir(400, ['error' => 'demasiadas filas', 'tope' => MAX_FILAS, 'recibidas' => count($filas)]);
    }
    if (!$filas) {
        salir(200, ['ok' => true, 'recibidas' => 0, 'escritas' => 0, 'rechazadas' => []]);
    }

    // La tabla ya existe; el CREATE es por si alguna vez se levanta de cero.
    $pdo->exec('
        CREATE TABLE IF NOT EXISTS admin_factura (
          sucursal      VARCHAR(10) NOT NULL,
          id            VARCHAR(50) NOT NULL,
          correlativo   VARCHAR(50),
          cliente       VARCHAR(255),
          cod_vendedor  INT,
          total         DECIMAL(12,2),
          aplicado      INT DEFAULT 0,
          PRIMARY KEY (sucursal, id)
        )
    ');

    // ⚠️ `aplicado` NO se toca en el UPDATE, y ésa es la diferencia importante
    // con el circuito viejo. Aquél escribía `aplicado = VALUES(aplicado)` con un
    // 0 fijo en el INSERT: reenviar una factura ya procesada la devolvía a «sin
    // aplicar» y el sistema de puntos la volvía a acreditar. Acá una factura que
    // llega dos veces no puede acreditar dos veces.
    $sql = $pdo->prepare('
        INSERT INTO admin_factura
          (sucursal, id, correlativo, cliente, cod_vendedor, total, aplicado)
        VALUES (?, ?, ?, ?, ?, ?, 0)
        ON DUPLICATE KEY UPDATE
          correlativo  = VALUES(correlativo),
          cliente      = VALUES(cliente),
          cod_vendedor = VALUES(cod_vendedor),
          total        = VALUES(total)
    ');

    $escritas   = 0;
    $rechazadas = [];
    $pdo->beginTransaction();
    try {
        foreach ($filas as $f) {
            $suc = (string) ($f['sucursal'] ?? '');
            $id  = (string) ($f['erp_invoice_id'] ?? '');
            if ($suc === '' || $id === '') {
                $rechazadas[] = ['motivo' => 'sin sucursal o sin id', 'fila' => $f];
                continue;
            }
            $sql->execute([
                $suc,
                $id,
                (string) ($f['correlativo'] ?? ''),
                (string) ($f['cliente'] ?? ''),
                isset($f['cod_vendedor']) ? (int) $f['cod_vendedor'] : null,
                (float) ($f['total'] ?? 0),
            ]);
            $escritas++;
        }
        $pdo->commit();
    } catch (Throwable $e) {
        // Todo o nada: el portal anota como enviadas SÓLO las de una tanda que
        // volvió bien. Un commit parcial dejaría filas escritas que el portal
        // cree no haber mandado, y ésas no se vuelven a mandar nunca.
        $pdo->rollBack();
        salir(500, ['error' => 'falló la escritura', 'detalle' => $e->getMessage(), 'escritas' => 0]);
    }

    salir(200, [
        'ok'         => true,
        'recibidas'  => count($filas),
        'escritas'   => $escritas,
        'rechazadas' => $rechazadas,
    ]);
}

salir(400, ['error' => 'acción desconocida', 'recibida' => $accion]);
