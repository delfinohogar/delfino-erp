-- ===========================================================================
-- 0007 — Contadores del corte (TASK-004). Implementa P7 en la base.
--
-- P7 resuelta (DECISIONS.md, 2026-09-04, Nivel 3 de Gastón):
--   - contadores/comprobantes_{pv}_{tipo} → CONTINÚA desde su último valor, por punto de
--     venta y por tipo. Motivo: ya hay comprobantes impresos y entregados a clientes;
--     reiniciar generaría dos papeles con el mismo número, y la numeración fiscal lo prohíbe.
--   - contadores/ventas    → arranca en 0, de modo que la primera venta obtiene el número 1.
--   - contadores/asientos  → arranca en 0, de modo que el primer asiento obtiene el número 1.
--     Motivo de los dos reinicios: coherencia con P9 (corte limpio). No se migran ventas ni
--     asientos, así que un libro diario que arrancara en un número alto no tendría asientos
--     previos que lo respalden.
--
-- POR QUÉ ESTA MIGRACIÓN ES 0007 Y NO 0005 (decidido por el director el 2026-09-05):
-- 0005 nunca existió — TASK-018 creó 0006 salteando el número. Si esta migración fuera 0005,
-- en una base nueva se aplicaría ANTES de 0006, pero en una base que ya tiene 0006 registrada
-- se aplicaría DESPUÉS: el mismo repositorio produciría dos órdenes distintos según el estado
-- de la base. 0007 es mayor que todo lo aplicado. EL HUECO EN 0005 ES PERMANENTE Y NO SE
-- RELLENA: rellenarlo reintroduce exactamente este problema.
--
-- Qué NO hace esta migración, y es deliberado:
--   - no edita 0001, 0002, 0003, 0004 ni 0006: son historia aplicada y registrada en
--     schema_migrations;
--   - no toca backend/db/repetibles/crear_venta.sql (R28): la función sigue llamando a
--     siguiente_numero('ventas') y siguiente_numero('asientos') con la misma firma y recibe
--     exactamente los mismos números que antes;
--   - NO reinicia ventas ni asientos con un UPDATE. En una base ya operativa eso sería
--     destructivo. 0002 las creó en 0 y esta migración solo garantiza que la fila exista.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. contadores: piso en 0 y las dos filas de P7 garantizadas
--
-- El CHECK vale para siempre, también para lo que escriba fijar_contador_comprobante():
-- un contador nunca puede quedar en negativo, así que `ultimo` siempre es "el último número
-- entregado" y `ultimo + 1` siempre es un número de comprobante válido.
--
-- El INSERT es defensivo, no correctivo: en cualquier base que haya aplicado 0002 las cuatro
-- filas ya existen en 0 y el ON CONFLICT lo convierte en un no-op. Nunca baja un contador que
-- ya avanzó, que es justo lo que P9 + P7 NO piden (el corte limpio es del historial, no de una
-- base ya operativa).
-- ---------------------------------------------------------------------------
alter table contadores
  add constraint contadores_ultimo_no_negativo check (ultimo >= 0);

insert into contadores(nombre, ultimo) values ('ventas', 0), ('asientos', 0)
  on conflict (nombre) do nothing;

comment on table contadores is
  'Un contador por nombre. `ultimo` es el ULTIMO numero entregado: el proximo es ultimo + 1. '
  'P7: `ventas` y `asientos` arrancan en 0 (la primera operacion obtiene 1); '
  'los `comprobantes_{pv}_{tipo}` continuan desde el corte, ver fijar_contador_comprobante().';

-- ---------------------------------------------------------------------------
-- 2. Nombre canónico del contador de comprobantes
--
-- La forma `comprobantes_{pv}_{tipo}` es la misma que usa js/facturacion.js:86, para que el
-- corte se pueda leer contra Firestore documento por documento sin traducir nada.
--
-- Se arma con una función y no a mano en cada llamador porque el nombre es la CLAVE PRIMARIA
-- del contador: un typo no da error, da un contador nuevo que arranca en 1. Acá el typo da
-- error, que es lo que se quiere.
--
-- El tipo es el `codigo` del catálogo TIPOS_COMPROBANTE de js/facturacion.js:51-60
-- (COMPROBANTE_INTERNO, FACTURA_A, NOTA_CREDITO_B, …): mayúsculas, dígitos y guiones bajos.
-- El punto de venta es el string de la sucursal, de 1 a 5 dígitos ("0001" en el ERP de hoy;
-- ARCA numera los puntos de venta hasta 5 dígitos). Se conserva TAL CUAL: "0001" y "1" son
-- puntos de venta distintos para esta función, porque son documentos distintos en Firestore y
-- normalizarlos acá fusionaría dos numeraciones que allá están separadas.
-- ---------------------------------------------------------------------------
create or replace function nombre_contador_comprobante(p_punto_venta text, p_tipo_comprobante text)
returns text as $$
begin
  if p_punto_venta is null or p_punto_venta !~ '^[0-9]{1,5}$' then
    raise exception 'NUMERACION_CORTE: punto de venta invalido (%): se esperaba de 1 a 5 digitos',
      coalesce(p_punto_venta, '<null>') using errcode = 'invalid_parameter_value';
  end if;
  if p_tipo_comprobante is null or p_tipo_comprobante !~ '^[A-Z][A-Z0-9_]*$' then
    raise exception 'NUMERACION_CORTE: tipo de comprobante invalido (%): se esperaba un codigo de TIPOS_COMPROBANTE',
      coalesce(p_tipo_comprobante, '<null>') using errcode = 'invalid_parameter_value';
  end if;
  return 'comprobantes_' || p_punto_venta || '_' || p_tipo_comprobante;
end $$ language plpgsql immutable;

comment on function nombre_contador_comprobante(text, text) is
  'Nombre canonico del contador de comprobantes: comprobantes_{pv}_{tipo}, igual que js/facturacion.js:86. Valida las dos partes.';

-- ---------------------------------------------------------------------------
-- 3. siguiente_numero() soporta los contadores por punto de venta y tipo
--
-- R41: se redefine con CREATE OR REPLACE y LA MISMA FIRMA `(p_nombre text) returns bigint`.
-- No se agrega ningún parámetro. Cambiarle los parámetros crearía una SOBRECARGA y dejaría
-- viva la vieja, con crear_venta() corriendo el cuerpo viejo sin aviso. Después de esta
-- migración, `select count(*) from pg_proc where proname='siguiente_numero'` sigue dando 1.
--
-- Qué cambia: si la fila no existe y el nombre es un contador de comprobantes, se crea sola y
-- entrega 1. Es exactamente lo que hace hoy js/facturacion.js:88-93 con
-- `snap.exists() ? snap.data().ultimo : 0`, y hace falta porque los pares (pv, tipo) son
-- abiertos: una sucursal nueva o un tipo que todavía no se emitió no tienen fila que
-- pre-sembrar, y su numeración legítimamente arranca en 1.
--
-- Qué NO cambia: para cualquier otro nombre —'ventas', 'asientos', 'entregas', 'pedidos', o un
-- typo— si la fila no existe sigue levantando 'No existe el contador %', textual. La creación
-- automática está acotada a los comprobantes a propósito: es la única familia de nombres donde
-- una fila nueva significa algo, y en el resto un nombre desconocido es un bug que tiene que
-- hacer ruido.
--
-- Concurrencia: el INSERT ... ON CONFLICT DO UPDATE es una sola sentencia atómica. Dos
-- transacciones que estrenan el mismo contador a la vez no obtienen las dos el 1: la segunda
-- espera a que la primera commitee y toma la rama DO UPDATE, que devuelve 2. Con
-- `on conflict do nothing` + update aparte la segunda no vería la fila y fallaría.
--
-- R10: sigue corriendo DENTRO de la transacción del llamador. Si la venta falla, el UPDATE del
-- contador se va con el ROLLBACK y el número NO queda quemado. Esta migración no lo toca.
-- ---------------------------------------------------------------------------
create or replace function siguiente_numero(p_nombre text) returns bigint as $$
declare n bigint;
begin
  update contadores set ultimo = ultimo + 1 where nombre = p_nombre returning ultimo into n;
  if n is not null then return n; end if;

  if p_nombre is null or p_nombre !~ '^comprobantes_[0-9]{1,5}_[A-Z][A-Z0-9_]*$' then
    raise exception 'No existe el contador %', p_nombre;
  end if;

  insert into contadores(nombre, ultimo) values (p_nombre, 1)
    on conflict (nombre) do update set ultimo = contadores.ultimo + 1
    returning ultimo into n;
  return n;
end $$ language plpgsql;

comment on function siguiente_numero(text) is
  'Entrega el proximo numero del contador, dentro de la transaccion del llamador (R10). '
  'Los contadores comprobantes_{pv}_{tipo} se crean solos y arrancan en 1; cualquier otro '
  'nombre inexistente levanta excepcion.';

-- ---------------------------------------------------------------------------
-- 4. La constancia del corte: quién, cuándo, de cuánto a cuánto y por qué
--
-- "Deja constancia" en DATOS, no en un comment: el corte es un hecho operativo que hay que
-- poder consultar meses después, cuando alguien pregunte por qué el comprobante 0001-00001501
-- es el primero de la base nueva. Un comment on function no responde eso.
--
--     select * from contadores_corte order by fijado_en;
--
-- Una fila por fijación efectiva. Las correcciones no pisan la fila anterior: se agregan, así
-- que la secuencia completa de lo que se declaró queda visible.
-- ---------------------------------------------------------------------------
create table contadores_corte (
  id bigserial primary key,
  contador text not null references contadores(nombre),
  punto_venta text not null,
  tipo_comprobante text not null,
  ultimo_anterior bigint not null check (ultimo_anterior >= 0),
  ultimo_fijado bigint not null check (ultimo_fijado >= 0),
  correccion boolean not null default false,
  usuario_uid text not null check (btrim(usuario_uid) <> ''),
  motivo text,
  fijado_en timestamptz not null default now()
);
create index on contadores_corte (contador, fijado_en desc);

comment on table contadores_corte is
  'Constancia del corte de numeracion (P7): quien fijo que contador de comprobantes, cuando, '
  'desde que valor y hacia cual, y por que. Append-only.';

-- Inmutable EN LA BASE, mismo criterio que historial_costos en 0004: la constancia de un
-- hecho declarado no se edita ni se borra. BEFORE, no AFTER: la fila no llega a modificarse ni
-- por un instante. El trigger de TRUNCATE tapa la vía que no pasa por DELETE. (DROP TABLE no
-- lo cubre ningún trigger: eso es materia de permisos, R30, y no de esta capa.)
create or replace function contadores_corte_inmutable() returns trigger as $$
begin
  raise exception
    'NUMERACION_CORTE_INMUTABLE: la constancia del corte no se modifica ni se borra (intento de % sobre la fila %)',
    tg_op, old.id
    using errcode = 'restrict_violation';
  return null;
end $$ language plpgsql;

create trigger contadores_corte_sin_update
  before update on contadores_corte
  for each row execute function contadores_corte_inmutable();

create trigger contadores_corte_sin_delete
  before delete on contadores_corte
  for each row execute function contadores_corte_inmutable();

create or replace function contadores_corte_sin_truncate_fn() returns trigger as $$
begin
  raise exception 'NUMERACION_CORTE_INMUTABLE: la constancia del corte no se trunca'
    using errcode = 'restrict_violation';
  return null;
end $$ language plpgsql;

create trigger contadores_corte_sin_truncate
  before truncate on contadores_corte
  for each statement execute function contadores_corte_sin_truncate_fn();

-- ---------------------------------------------------------------------------
-- 5. fijar_contador_comprobante(): el corte, una sola vez y antes de emitir
--
-- p_ultimo_emitido es EL ÚLTIMO NÚMERO YA EMITIDO en Firestore para ese punto de venta y ese
-- tipo — el valor de `contadores/comprobantes_{pv}_{tipo}.ultimo`, copiado tal cual. El
-- comprobante siguiente lleva p_ultimo_emitido + 1. Fijarlo en 0 es una declaración válida y
-- significa "nunca se emitió ninguno, empezá en 1".
--
-- QUÉ PASA SI SE LLAMA DOS VECES, O CON EL CONTADOR YA AVANZADO. Es la pregunta del diseño y
-- la respuesta tiene tres ramas, todas derivadas de P7 y ninguna silenciosa:
--
--   (a) MISMO VALOR, contador sin usar desde la última fijación → IDEMPOTENTE. No cambia
--       nada, no escribe una segunda constancia y devuelve el id de la que rige. Reintentar el
--       script del corte, o correrlo dos veces por las dudas, no puede romper nada ni ensuciar
--       la constancia con filas repetidas que dicen lo mismo.
--
--   (b) VALOR DISTINTO, contador sin usar desde la última fijación → RECHAZA, salvo
--       p_corregir := true, y con el flag deja una constancia nueva marcada correccion=true.
--       Corregir un corte mal tipeado ANTES de emitir es técnicamente inocuo —no hay ningún
--       número entregado que se pise— pero no puede pasar por accidente: si pasara, la segunda
--       llamada de un script reejecutado cambiaría la numeración sin que nadie lo pida. El
--       flag existe para que la corrección sea un acto deliberado y quede marcada como tal.
--
--   (c) EL CONTADOR YA AVANZÓ (se emitieron comprobantes después de la fijación, o el contador
--       ya tenía números entregados y nunca hubo corte) → RECHAZA SIEMPRE, y p_corregir NO
--       sirve. Esto no es una preferencia: es lo único compatible con P7. Bajarlo reusaría
--       números ya entregados —"dos papeles con el mismo número", el motivo textual de P7— y
--       subirlo abriría un salto en la correlatividad, que es lo que P7 invoca cuando dice "es
--       también lo que exige la numeración fiscal". Como las dos salidas están prohibidas, la
--       función se niega en vez de elegir. Si alguna vez hiciera falta hacerlo igual, es una
--       decisión de Gastón (Nivel 3) y se implementa aparte; esta función no la anticipa.
--
-- Efecto útil de (c): el corte tiene que hacerse ANTES de emitir el primer comprobante de ese
-- punto de venta y ese tipo. Si alguien emite primero, el contador se crea en 1 (ver punto 3),
-- la fijación se rechaza con el valor actual en el mensaje, y el problema aparece en el
-- momento en que se puede arreglar barato.
--
-- ventas y asientos son INALCANZABLES desde acá: el único nombre que esta función construye
-- pasa por nombre_contador_comprobante(), que siempre devuelve 'comprobantes_…'. No hace falta
-- un guard extra y no se puede fijar 'ventas' por error de tipeo.
--
-- Devuelve el id de la fila de contadores_corte que rige para ese contador.
-- ---------------------------------------------------------------------------
create or replace function fijar_contador_comprobante(
  p_punto_venta      text,
  p_tipo_comprobante text,
  p_ultimo_emitido   bigint,
  p_usuario_uid      text,
  p_motivo           text default null,
  p_corregir         boolean default false
) returns bigint as $$
declare
  v_nombre  text;
  v_actual  bigint;
  v_corte   contadores_corte%rowtype;
  v_id      bigint;
begin
  v_nombre := nombre_contador_comprobante(p_punto_venta, p_tipo_comprobante);

  if p_ultimo_emitido is null or p_ultimo_emitido < 0 then
    raise exception 'NUMERACION_CORTE: el ultimo numero emitido tiene que ser >= 0 (llego %)',
      coalesce(p_ultimo_emitido::text, '<null>') using errcode = 'invalid_parameter_value';
  end if;
  if p_usuario_uid is null or btrim(p_usuario_uid) = '' then
    raise exception 'NUMERACION_CORTE: falta el usuario que hace el corte'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Serializa dos cortes simultáneos del mismo contador. FOR UPDATE sobre la fila si existe;
  -- si no existe, el INSERT de más abajo es quien serializa por la clave primaria.
  select ultimo into v_actual from contadores where nombre = v_nombre for update;

  select * into v_corte from contadores_corte
    where contador = v_nombre order by fijado_en desc, id desc limit 1;

  -- (c) El contador ya entregó números: ni antes ni después de un corte se puede pisar.
  if v_actual is not null
     and ((v_corte.id is null and v_actual > 0)
          or (v_corte.id is not null and v_actual <> v_corte.ultimo_fijado)) then
    raise exception
      'NUMERACION_CORTE_EN_USO: el contador % ya entrego numeros (ultimo = %); fijarlo en % reusaria o saltearia numeracion emitida. El corte va ANTES de emitir. Si hay que hacerlo igual, es decision de Gaston, no de esta funcion',
      v_nombre, v_actual, p_ultimo_emitido
      using errcode = 'restrict_violation';
  end if;

  -- (a) Misma declaración, contador sin usar: no-op idempotente.
  if v_corte.id is not null and v_corte.ultimo_fijado = p_ultimo_emitido then
    return v_corte.id;
  end if;

  -- (b) Declaración distinta sobre un corte todavía sin usar: solo con p_corregir.
  if v_corte.id is not null and not p_corregir then
    raise exception
      'NUMERACION_CORTE_YA_FIJADO: el contador % ya fue fijado en % por % el %; para cambiarlo a % pasa p_corregir := true',
      v_nombre, v_corte.ultimo_fijado, v_corte.usuario_uid, v_corte.fijado_en, p_ultimo_emitido
      using errcode = 'restrict_violation';
  end if;

  insert into contadores(nombre, ultimo) values (v_nombre, p_ultimo_emitido)
    on conflict (nombre) do update set ultimo = excluded.ultimo;

  insert into contadores_corte(contador, punto_venta, tipo_comprobante,
                               ultimo_anterior, ultimo_fijado, correccion, usuario_uid, motivo)
    values (v_nombre, p_punto_venta, p_tipo_comprobante,
            coalesce(v_actual, 0), p_ultimo_emitido, v_corte.id is not null, p_usuario_uid, p_motivo)
    returning id into v_id;

  return v_id;
end $$ language plpgsql;

comment on function fijar_contador_comprobante(text, text, bigint, text, text, boolean) is
  'Corte de numeracion de comprobantes (P7/TASK-004). Fija el ultimo numero emitido en Firestore '
  'para un punto de venta y un tipo, y deja constancia en contadores_corte. Idempotente con el '
  'mismo valor; exige p_corregir para cambiarlo antes de emitir; RECHAZA siempre si el contador '
  'ya entrego numeros.';
