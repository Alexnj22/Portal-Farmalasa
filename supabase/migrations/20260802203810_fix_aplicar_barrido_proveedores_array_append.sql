SET lock_timeout = '5s';

-- `v_campos := v_campos || 'direccion'` falla con "malformed array literal": el
-- literal sin tipo hace que Postgres elija `anyarray || anyarray` en vez de
-- `anyarray || anyelement`, e intente parsear 'direccion' como un array. Va
-- casteado a ::text.
--
-- Lo atrapo la prueba BEGIN...ROLLBACK con los datos reales del ERP, no la
-- lectura: la funcion compila perfecto y solo revienta en la primera ficha que
-- tiene algo que llenar.
--
-- (Cuerpo completo de la funcion: ver 20260802204227, que la reemplaza. Este
-- archivo existe porque la migracion se aplico y el registro de prod la tiene.)
