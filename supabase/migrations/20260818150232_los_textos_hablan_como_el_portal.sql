SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Los textos, revisados contra §26 de DESIGN.md — «Voz: cómo escribe el portal»
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Los escribí sin leer esa sección y salieron tres cosas. El gate no las agarra:
-- `copy-vacio`/`copy-trato` miran SÓLO los slots de `EmptyState` y `message:`
-- (§26.9), así que un texto en la base o en un botón pasa en verde diga lo que
-- diga. Lo dice el propio doc: «si el texto es correcto lo agarra una persona
-- leyendo, no un regex».
--
-- 1. **«en el sistema» es vago.** El portal TAMBIÉN es un sistema, así que la
--    frase no separa nada. Y el término decidido para el otro es
--    `Sistema de Ventas`, nunca «ERP» (§26.10). Se reemplaza por lo concreto
--    que de verdad pasa: **sale un traslado** — que además es la palabra que
--    este módulo ya usa en toda la pantalla.
-- 2. **El rótulo no dice el plano dos veces.** Decía «…en el sistema» al final
--    de una frase cuya etiqueta ya dice cómo se arregla. Ahora el rótulo dice
--    QUIÉN hace QUÉ y la etiqueta corta dice CÓMO.
-- 3. Sentence case y punto sólo en prosa (§26.4, §26.5).

UPDATE public.diferencia_opcion SET
    rotulo_corto = 'Con un traslado',
    rotulo       = 'La sala le regresa la cantidad a bodega',
    ayuda        = 'Sale un traslado de la sala a bodega. El producto se queda en bodega y las existencias vuelven a coincidir.',
    ayuda_sala   = 'Sale un traslado de tu sala a bodega. No mandas nada: el producto nunca salió de allá.',
    ayuda_bodega = 'Entra un traslado desde la sala. El producto ya está aquí; sólo confirmas la entrada.'
WHERE error_tipo = 'faltante' AND valor = 'regresar_traslado';

UPDATE public.diferencia_opcion SET
    rotulo_corto = 'En físico',
    rotulo       = 'Bodega manda el producto',
    ayuda        = 'Va en la próxima caja. No sale ningún traslado: la cantidad ya está a nombre de la sala.',
    ayuda_sala   = 'Bodega te manda el producto en la próxima caja. Confirmas cuando llegue, y hay 3 días de plazo.',
    ayuda_bodega = 'Le mandas el producto a la sala en la próxima caja. Hay 3 días de plazo.'
WHERE error_tipo = 'faltante' AND valor = 'enviar_producto';

UPDATE public.diferencia_opcion SET
    rotulo_corto = 'Con un traslado',
    rotulo       = 'Bodega le pasa la cantidad a la sala',
    ayuda        = 'Sale un traslado de bodega a la sala por lo que llegó de más, y la sala se queda con el producto.',
    ayuda_sala   = 'Te quedas con lo que llegó de más. Entra un traslado desde bodega y la cantidad pasa a tu sala.',
    ayuda_bodega = 'Sale un traslado de bodega a la sala. El producto ya está allá.'
WHERE error_tipo = 'sobrante' AND valor = 'sala_se_queda';

UPDATE public.diferencia_opcion SET
    rotulo_corto = 'En físico',
    rotulo       = 'La sala devuelve el producto',
    ayuda        = 'Vuelve en la próxima caja. No sale ningún traslado: la cantidad nunca pasó a la sala.',
    ayuda_sala   = 'Devuelves el producto en la próxima caja. No sale ningún traslado: la cantidad nunca fue tuya.',
    ayuda_bodega = 'La sala te devuelve el producto en la próxima caja. Confirmas cuando lo tengas.'
WHERE error_tipo = 'sobrante' AND valor = 'devolver_producto';

UPDATE public.diferencia_opcion SET
    rotulo_corto = 'Devolver',
    rotulo       = 'La sala lo devuelve a bodega',
    ayuda        = 'El producto vuelve en la próxima caja y sale un traslado de la sala a bodega.',
    ayuda_sala   = 'El producto vuelve a bodega en la próxima caja y sale de tus existencias.',
    ayuda_bodega = 'La sala te devuelve el producto. Entra a la ubicación de trabajo cuando confirmes que lo tienes.'
WHERE valor = 'devolver_bodega' AND error_tipo IN ('danado','vencido');

UPDATE public.diferencia_opcion SET
    rotulo_corto = 'Se queda',
    rotulo       = 'Se queda en la sala',
    ayuda        = 'No sale ningún traslado y el producto no se mueve de lugar. Queda la decisión anotada.',
    ayuda_sala   = 'Te quedas con el producto. No sale ningún traslado.',
    ayuda_bodega = 'El producto se queda en la sala. No sale ningún traslado.'
WHERE valor = 'queda_en_sala';
