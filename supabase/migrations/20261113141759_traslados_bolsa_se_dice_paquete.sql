-- «Bolsa» → «paquete» en lo que ve el personal (2026-11-13).
--
-- Decisión del usuario: «cuando dices bolsa, siento que se puede mal
-- interpretar con bolsa de dinero». En el portal «bolsa» es la del EFECTIVO
-- (Caja → Bolsas); lo que viaja entre salas es un PAQUETE. «Encargo» no sirve
-- (son los encargos de clientes) ni «caja» (la registradora).
--
-- Sólo cambian los TEXTOS que ve la gente (errores y avisos). Los nombres de
-- funciones, tablas, columnas (`ruta_bolsas`, `codigo_bolsa`) y el parámetro
-- `bolsa=` de las direcciones se quedan: son identificadores, no rótulos.
--
-- Cada función parte de su definición VIVA (`pg_get_functiondef`) y se le
-- reemplazan sólo estas frases, completas y con sus comillas: una frase que
-- no aparece no toca nada (y se avisa con NOTICE, no con un error: el entorno
-- de pruebas repite esta historia).
SET lock_timeout = '5s';

DO $mig$
DECLARE
  v_funcs text[] := ARRAY[
    'avisar_bolsas_entregadas_sin_recibir', 'avisar_sobrante', 'bolsa_llego_por_error',
    'declarar_faltante_tardio', 'declarar_faltantes', 'declarar_sobrantes',
    'retiro_cargar', 'retiro_soltar', 'ruta_bolsas', 'ruta_entregar_bolsa',
    'ruta_recoger_bolsa', 'ruta_soltar_bolsa', 'validar_envio_producto'];
  v_pares text[][] := ARRAY[
    ['''Bolsa entregada y sin recibir''', '''Paquete entregado y sin recibir'''],
    ['''La bolsa ''', '''El paquete '''],
    [''' (bolsa ''', ''' (paquete '''],
    ['''No encontramos esa bolsa. Puede que el código no se haya leído bien.''', '''No encontramos ese paquete. Puede que el código no se haya leído bien.'''],
    ['''Esa bolsa ya se recibió o todavía no salió.''', '''Ese paquete ya se recibió o todavía no salió.'''],
    ['''Esa bolsa es para esta sala: recíbanla.''', '''Ese paquete es para esta sala: recíbanlo.'''],
    [''' recibió por error la bolsa ''', ''' recibió por error el paquete '''],
    ['''Una bolsa quedó en la sala equivocada''', '''Un paquete quedó en la sala equivocada'''],
    ['''Esa bolsa no existe o no es un traslado entre salas.''', '''Ese paquete no existe o no es un traslado entre salas.'''],
    ['''FORBIDDEN: esto lo declara la sala que recibió la bolsa.''', '''FORBIDDEN: esto lo declara la sala que recibió el paquete.'''],
    ['''Esta bolsa todavía no se recibió: dilo al recibirla.''', '''Este paquete todavía no se recibió: dilo al recibirlo.'''],
    ['''Esta bolsa se recibió hace ''', '''Este paquete se recibió hace '''],
    ['''No existe la bolsa %.''', '''No existe el paquete %.'''],
    ['''La bolsa % no tiene un producto en la posición %.''', '''El paquete % no tiene un producto en la posición %.'''],
    ['''No existe esa bolsa.''', '''No existe ese paquete.'''],
    ['''La bolsa no dice de qué sala salió o a cuál llegó.''', '''El paquete no dice de qué sala salió o a cuál llegó.'''],
    ['''La bolsa no tiene un producto completo en la posición %s.''', '''El paquete no tiene un producto completo en la posición %s.'''],
    [''' en la bolsa ''', ''' en el paquete '''],
    ['''Esa bolsa todavía no salió de la sala.''', '''Ese paquete todavía no salió de la sala.'''],
    ['''Esa bolsa ya se recibió.''', '''Ese paquete ya se recibió.'''],
    ['''Esa bolsa ya la lleva ''', '''Ese paquete ya lo lleva '''],
    ['''Esa bolsa ya va en otro retiro.''', '''Ese paquete ya va en otro retiro.'''],
    ['''Esa bolsa no la llevas vos.''', '''Ese paquete no lo llevas tú.'''],
    ['''No puedes ver las bolsas de esta ruta.''', '''No puedes ver los paquetes de esta ruta.'''],
    ['''Esa bolsa ya no la llevas.''', '''Ese paquete ya no lo llevas.'''],
    ['''Sólo el conductor de la ruta puede recoger bolsas en ella.''', '''Sólo el conductor de la ruta puede recoger paquetes en ella.'''],
    ['''Eso no es una bolsa: es lo que llegó de más a una sala.''', '''Eso no es un paquete: es lo que llegó de más a una sala.'''],
    ['''Esa bolsa ya se entregó en ''', '''Ese paquete ya se entregó en '''],
    ['''; falta que la sala la reciba.''', '''; falta que la sala lo reciba.'''],
    ['''Esa bolsa todavía no salió de la sala (o ya se recibió).''', '''Ese paquete todavía no salió de la sala (o ya se recibió).'''],
    ['''Esa bolsa ya la llevas.''', '''Ese paquete ya lo llevas.'''],
    ['''Esa bolsa ya la lleva otra persona.''', '''Ese paquete ya lo lleva otra persona.'''],
    ['''Lo que llegó de más se declara al recibir la bolsa.''', '''Lo que llegó de más se declara al recibir el paquete.''']
  ];
  v_oid   oid;
  v_def   text;
  v_nuevo text;
  v_f     text;
  i       int;
  v_usado boolean[];
BEGIN
  v_usado := array_fill(false, ARRAY[array_length(v_pares, 1)]);
  FOREACH v_f IN ARRAY v_funcs LOOP
    FOR v_oid IN SELECT p.oid FROM pg_proc p
                  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_f LOOP
      v_def := pg_get_functiondef(v_oid);
      v_nuevo := v_def;
      FOR i IN 1 .. array_length(v_pares, 1) LOOP
        IF position(v_pares[i][1] IN v_nuevo) > 0 THEN
          v_nuevo := replace(v_nuevo, v_pares[i][1], v_pares[i][2]);
          v_usado[i] := true;
        END IF;
      END LOOP;
      IF v_nuevo IS DISTINCT FROM v_def THEN
        EXECUTE v_nuevo;
      END IF;
    END LOOP;
  END LOOP;
  FOR i IN 1 .. array_length(v_pares, 1) LOOP
    IF NOT v_usado[i] THEN
      RAISE NOTICE 'paquete: no se encontró la frase %', v_pares[i][1];
    END IF;
  END LOOP;
END
$mig$;
