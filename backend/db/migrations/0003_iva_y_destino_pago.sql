-- Delfino ERP — 0003: IVA discriminado, destino contable del pago y fecha local
--
-- Cambios 1, 2 y 8 de ARCHITECTURE §2.3:
--   1. crear_venta() discrimina el IVA por línea e imputa a 2.1.2 (corrige P6).
--   2. venta_pagos guarda el destino contable e imputa a 1.1.1 o 1.1.5 según ese destino.
--   8. fecha_operacion es una fecha LOCAL de Argentina, nunca derivada de UTC.
--
-- Las migraciones ya aplicadas no se editan: 0001 y 0002 quedan como están y acá se
-- agrega con ALTER TABLE y se redefine crear_venta() con CREATE OR REPLACE.

-- ---------------------------------------------------------------------------
-- 1. Alícuota de IVA del producto
-- El precio de venta YA incluye el IVA (mismo criterio que js/productos.js), así que
-- esta columna dice a qué alícuota está gravado ese precio, no cuánto hay que sumarle.
-- 21 es el default del ERP actual (js/contabilidad.js: `ivaPct ?? 21`).
-- ---------------------------------------------------------------------------
alter table productos
  add column iva numeric(5,2) not null default 21
  constraint iva_no_negativo check (iva >= 0);

-- ---------------------------------------------------------------------------
-- 2. Destino contable del pago
-- Réplica de js/contabilidad.js → cuentaParaDestinoTesoreria: 'caja' y 'banco' van a
-- 1.1.1 "Caja y Bancos"; 'cuentaPorCobrar' (tarjetas, Mercado Pago, GoCuotas, planes)
-- va a 1.1.5 "Deudores por Tarjetas y Acreditaciones", porque esa plata todavía no
-- está disponible. Tesorería completa queda fuera de alcance: acá solo se conserva el
-- destino, que es lo que el asiento necesita para no mentir.
-- Default 'caja' = comportamiento de 0002, donde todo pago se imputaba a 1.1.1. NOT NULL
-- para que ningún pago quede sin cuenta donde imputarse.
-- ---------------------------------------------------------------------------
alter table venta_pagos
  add column destino_contable text not null default 'caja'
  constraint destino_contable_valido check (destino_contable in ('caja','banco','cuentaPorCobrar'));

-- Las dos cuentas que este cambio empieza a usar y que ninguna migración anterior creó.
-- Códigos, nombres y tipos copiados de PLAN_DE_CUENTAS en js/contabilidad.js: el plan de
-- cuentas es el mismo, no se inventa uno nuevo. Solo estas dos, para no chocar con las que
-- ya siembra quien prepara la base. ON CONFLICT: si ya existen, se respeta lo que hay.
insert into cuentas_contables(codigo,nombre,tipo,imputable) values
  ('1.1.5','Deudores por Tarjetas y Acreditaciones','activo',true),
  ('2.1.2','IVA Débito Fiscal','pasivo',true)
on conflict (codigo) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Fecha de operación en hora local de Argentina
--
-- El bug que esto cierra: una venta cargada a las 21:00 del 4 de septiembre en Argentina
-- (UTC-3) es 00:00 del 5 en UTC. `toISOString().slice(0,10)` en el navegador, o
-- `current_date` / `localtimestamp` en una sesión con TimeZone='UTC', la fechan al día
-- siguiente. La venta aparece un día después de haber ocurrido.
--
-- `now()` devuelve timestamptz, o sea un INSTANTE absoluto: no depende de la sesión.
-- `AT TIME ZONE 'America/Argentina/Buenos_Aires'` proyecta ese instante en el huso de
-- Argentina y devuelve un timestamp sin zona ya expresado en hora local; recién ahí se
-- toma la fecha. El resultado es el mismo con la sesión en 'UTC', en 'America/Argentina/
-- Buenos_Aires' o en 'Asia/Tokyo'.
--
-- Por qué NO las alternativas:
--   - `current_date` y `localtimestamp::date` usan el parámetro TimeZone DE LA SESIÓN.
--     Hoy el contenedor tiene TZ=America/Argentina/Buenos_Aires y darían bien, que es
--     justamente lo peligroso: el día correcto pasaría a depender de una variable de
--     entorno de Docker y de lo que haga cada cliente con `SET TimeZone`.
--   - `now()::date` es lo mismo: castear timestamptz a date usa el TimeZone de la sesión.
-- La zona queda escrita literal a propósito: la operación es en San Francisco Solano.
-- ---------------------------------------------------------------------------
create or replace function fecha_local() returns date as $$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date;
$$ language sql stable;

alter table ventas   alter column fecha_operacion set default fecha_local();
alter table asientos alter column fecha_operacion set default fecha_local();

-- ---------------------------------------------------------------------------
-- 4. Discriminación del IVA, "restando hacia atrás"
--
-- Réplica exacta de js/contabilidad.js:98-102 (discriminarIva). Dos detalles que NO son
-- cosméticos y que hay que conservar tal cual:
--   a) el IVA se redondea a partir del neto SIN redondear: round(monto - monto/(1+a/100)),
--      no round(monto - round(neto,2)). Una versión "más prolija" puede dar otro centavo.
--   b) alícuota nula ⇒ 21 (es `ivaPct ?? 21`); alícuota 0 ⇒ IVA 0, no 21.
-- ---------------------------------------------------------------------------
create or replace function discriminar_iva(p_monto_con_iva numeric, p_alicuota numeric)
returns numeric as $$
  select case
    when coalesce(p_alicuota, 21) > 0
      then round(p_monto_con_iva - p_monto_con_iva / (1 + coalesce(p_alicuota, 21) / 100), 2)
    else 0::numeric
  end;
$$ language sql immutable;

-- ---------------------------------------------------------------------------
-- 5. crear_venta(): misma firma, ahora con IVA, destino de pago y fecha local.
--
-- p_items: [{"producto_id":1,"deposito_id":1,"cantidad":2,"precio_unitario":100,
--            "costo_unitario":60,"descuento_pct":0,"iva_pct":10.5}]
--          iva_pct es opcional: si no viene, se usa productos.iva (default 21).
--          Va en el ítem porque la alícuota se congela al momento de la venta, igual que
--          el precio y el costo: si mañana cambia la del producto, la venta vieja no cambia.
-- p_pagos: [{"medio_id":1,"monto":150,"destino_contable":"caja"}]
-- p_fecha: si viene NULL se usa fecha_local() (ver arriba).
--
-- REDONDEO — decisión de Nivel 3 de Gastón del 2026-09-04, no reinterpretar:
--     iva_linea  = round(subtotal − subtotal/(1+alicuota/100))   por línea
--     iva_total  = round(SUM(iva_linea))                          la venta
--     neto_total = round(total − iva_total)                       RESIDUO, nunca una suma
-- El centavo de redondeo lo absorbe el NETO (4.1 Ventas, cuenta propia), no el IVA (2.1.2,
-- que es lo que se declara). Es lo que hace hoy js/ventas.js:412-413.
-- Consecuencia: Debe = Haber NO alcanza para verificar esto, porque con el neto como tapón
-- el asiento cierra igual aunque el centavo esté mal repartido. Lo que hay que verificar es
-- el monto imputado a 2.1.2 contra el cálculo por línea.
-- ---------------------------------------------------------------------------
create or replace function crear_venta(
  p_cliente_id bigint, p_vendedor text, p_fecha date,
  p_items jsonb, p_pagos jsonb, p_entrega text,
  p_idem text, p_fallar_en text default null
) returns bigint as $$
declare
  v_id bigint; v_numero bigint; a_id bigint; a_numero bigint;
  it jsonb; pg jsonb;
  v_fecha date;
  v_subtotal numeric(14,2) := 0; v_total numeric(14,2) := 0;
  v_pagado numeric(14,2) := 0; v_pendiente numeric(14,2) := 0; v_cmv numeric(14,2) := 0;
  v_iva_total numeric(14,2) := 0; v_neto_total numeric(14,2) := 0;
  v_debe_caja numeric(14,2) := 0; v_debe_tarjetas numeric(14,2) := 0;
  v_lineas jsonb := '[]'::jsonb;
  sub numeric(14,2); ali numeric(5,2); iva_l numeric(14,2);
  destino text;
  disp numeric(14,3); r_id bigint; vi_id bigint;
  prev jsonb;
begin
  -- DOBLE_ENVIO: si la clave ya existe, devolvemos la venta anterior sin crear nada.
  select resultado into prev from idempotency_keys where clave = p_idem;
  if found then return (prev->>'venta_id')::bigint; end if;

  v_fecha := coalesce(p_fecha, fecha_local());

  -- Orden de bloqueo obligatorio: stock por (producto_id, deposito_id) ascendente.
  perform 1 from stock s
    where (s.producto_id, s.deposito_id) in (
      select (i->>'producto_id')::bigint, (i->>'deposito_id')::bigint
      from jsonb_array_elements(p_items) i)
    order by s.producto_id, s.deposito_id
    for update;

  -- Disponibilidad antes de escribir nada.
  for it in select * from jsonb_array_elements(p_items) loop
    select disponible into disp from stock
      where producto_id=(it->>'producto_id')::bigint and deposito_id=(it->>'deposito_id')::bigint;
    if disp is null then raise exception 'Sin stock para producto % en deposito %',
      it->>'producto_id', it->>'deposito_id'; end if;
    if disp < (it->>'cantidad')::numeric then
      raise exception 'STOCK_INSUFICIENTE: producto % disponible % pedido %',
        it->>'producto_id', disp, it->>'cantidad';
    end if;
  end loop;

  -- Un solo lugar donde se calcula cada línea: subtotal, alícuota e IVA quedan guardados en
  -- v_lineas y se reusan tal cual al insertar. Recalcularlos en el segundo loop sería una
  -- oportunidad de que las dos cuentas den distinto.
  for it in select * from jsonb_array_elements(p_items) loop
    sub := round((it->>'cantidad')::numeric * (it->>'precio_unitario')::numeric
                 * (1 - coalesce((it->>'descuento_pct')::numeric,0)/100), 2);
    ali := coalesce(
             (it->>'iva_pct')::numeric,
             (select p.iva from productos p where p.id = (it->>'producto_id')::bigint),
             21);
    iva_l := discriminar_iva(sub, ali);
    v_lineas := v_lineas || jsonb_build_object(
      'producto_id',   (it->>'producto_id')::bigint,
      'deposito_id',   (it->>'deposito_id')::bigint,
      'cantidad',      (it->>'cantidad')::numeric,
      'precio_unitario', (it->>'precio_unitario')::numeric,
      'costo_unitario',  coalesce((it->>'costo_unitario')::numeric,0),
      'descuento_pct',   coalesce((it->>'descuento_pct')::numeric,0),
      'subtotal',      sub,
      'iva_pct',       ali,
      'iva_monto',     iva_l);
    v_subtotal  := v_subtotal + sub;
    v_iva_total := v_iva_total + iva_l;
    v_cmv := v_cmv + round((it->>'cantidad')::numeric * coalesce((it->>'costo_unitario')::numeric,0), 2);
  end loop;
  v_total := v_subtotal;

  -- iva_total: suma de los IVA por línea, redondeada. neto_total: RESIDUO. Ver el bloque de
  -- REDONDEO de arriba; no cambiar por "neto por línea + suma".
  v_iva_total  := round(v_iva_total, 2);
  v_neto_total := round(v_total - v_iva_total, 2);

  -- Los pagos, repartidos por destino contable. Cada peso cobrado tiene que terminar en la
  -- cuenta que dice dónde está realmente esa plata.
  for pg in select * from jsonb_array_elements(p_pagos) loop
    destino := coalesce(pg->>'destino_contable', 'caja');
    if destino not in ('caja','banco','cuentaPorCobrar') then
      raise exception 'DESTINO_PAGO: destino contable invalido "%"', destino;
    end if;
    v_pagado := v_pagado + (pg->>'monto')::numeric;
    if destino = 'cuentaPorCobrar'
      then v_debe_tarjetas := v_debe_tarjetas + (pg->>'monto')::numeric;
      else v_debe_caja     := v_debe_caja     + (pg->>'monto')::numeric;
    end if;
  end loop;
  v_pendiente := v_total - v_pagado;
  if v_pendiente < 0 then raise exception 'PAGOS_VENTA: los pagos (%) superan el total (%)', v_pagado, v_total; end if;

  v_numero := siguiente_numero('ventas');
  insert into ventas(numero,fecha_operacion,cliente_id,vendedor_uid,subtotal,iva_total,total,
                     monto_pendiente,tipo_entrega,idempotency_key)
    values (v_numero,v_fecha,p_cliente_id,p_vendedor,v_subtotal,v_iva_total,v_total,v_pendiente,
            case when p_entrega='inmediata' then 'Retira ahora' else 'Envio a domicilio' end, p_idem)
    returning id into v_id;

  for it in select * from jsonb_array_elements(v_lineas) loop
    insert into venta_items(venta_id,producto_id,cantidad,precio_unitario,costo_unitario,
                            descuento_pct,iva_pct,iva_monto,subtotal)
      values (v_id,(it->>'producto_id')::bigint,(it->>'cantidad')::numeric,
              (it->>'precio_unitario')::numeric,(it->>'costo_unitario')::numeric,
              (it->>'descuento_pct')::numeric,(it->>'iva_pct')::numeric,
              (it->>'iva_monto')::numeric,(it->>'subtotal')::numeric)
      returning id into vi_id;

    if p_entrega = 'inmediata' then
      update stock set fisico = fisico - (it->>'cantidad')::numeric
        where producto_id=(it->>'producto_id')::bigint and deposito_id=(it->>'deposito_id')::bigint;
      insert into movimientos_stock(producto_id,deposito_id,delta,motivo,origen_tipo,origen_id,usuario_uid)
        values ((it->>'producto_id')::bigint,(it->>'deposito_id')::bigint,
                -(it->>'cantidad')::numeric,'venta','venta',v_id,p_vendedor);
    else
      insert into reservas(producto_id,deposito_id,cantidad,origen_tipo,venta_id,usuario_uid)
        values ((it->>'producto_id')::bigint,(it->>'deposito_id')::bigint,
                (it->>'cantidad')::numeric,'venta',v_id,p_vendedor)
        returning id into r_id;
      update stock set reservado = reservado + (it->>'cantidad')::numeric
        where producto_id=(it->>'producto_id')::bigint and deposito_id=(it->>'deposito_id')::bigint;
    end if;
  end loop;

  if p_fallar_en = 'pagos' then raise exception 'FALLO_FORZADO en pagos'; end if;

  for pg in select * from jsonb_array_elements(p_pagos) loop
    insert into venta_pagos(venta_id,medio_id,monto,destino_contable)
      values (v_id,(pg->>'medio_id')::bigint,(pg->>'monto')::numeric,
              coalesce(pg->>'destino_contable','caja'));
  end loop;

  if p_fallar_en = 'asiento' then raise exception 'FALLO_FORZADO en asiento'; end if;

  -- Asiento. Debe: 1.1.1 lo cobrado que ya está disponible, 1.1.5 lo cobrado que todavía no
  -- se acreditó, 1.1.2 lo que quedó a cuenta corriente. Haber: 4.1 el neto y 2.1.2 el IVA.
  -- El costo, como hasta ahora: 5.1 contra 1.1.3.
  a_numero := siguiente_numero('asientos');
  insert into asientos(numero,fecha_operacion,descripcion,origen_tipo,origen_id,usuario_uid)
    values (a_numero,v_fecha,'Venta '||v_numero,'venta',v_id,p_vendedor) returning id into a_id;
  if v_debe_caja > 0 then
    insert into asiento_movimientos(asiento_id,cuenta,debe,haber) values (a_id,'1.1.1',v_debe_caja,0);
  end if;
  if v_debe_tarjetas > 0 then
    insert into asiento_movimientos(asiento_id,cuenta,debe,haber) values (a_id,'1.1.5',v_debe_tarjetas,0);
  end if;
  if v_pendiente > 0 then
    insert into asiento_movimientos(asiento_id,cuenta,debe,haber) values (a_id,'1.1.2',v_pendiente,0);
  end if;
  if v_neto_total <> 0 then
    insert into asiento_movimientos(asiento_id,cuenta,debe,haber) values (a_id,'4.1',0,v_neto_total);
  end if;
  if v_iva_total > 0 then
    insert into asiento_movimientos(asiento_id,cuenta,debe,haber) values (a_id,'2.1.2',0,v_iva_total);
  end if;
  if v_cmv > 0 then
    insert into asiento_movimientos(asiento_id,cuenta,debe,haber) values (a_id,'5.1',v_cmv,0);
    insert into asiento_movimientos(asiento_id,cuenta,debe,haber) values (a_id,'1.1.3',0,v_cmv);
  end if;

  insert into idempotency_keys(clave,operacion,resultado)
    values (p_idem,'crear_venta',jsonb_build_object('venta_id',v_id,'numero',v_numero));

  return v_id;
end $$ language plpgsql;

-- ---------------------------------------------------------------------------
-- Verificación independiente del IVA imputado (invariante IVA_DISCRIMINADO).
-- Devuelve las ventas donde lo imputado a 2.1.2 NO coincide con la suma de los IVA por
-- línea, o donde lo imputado a 4.1 no es el residuo total − IVA. Vacío = correcto.
-- Existe porque Debe = Haber no puede detectar un centavo mal repartido: con el neto como
-- tapón el asiento cierra igual. Esto compara contra el cálculo por línea, que es otra vía.
-- ---------------------------------------------------------------------------
create or replace function verificar_iva_imputado()
returns table(venta_id bigint, iva_por_linea numeric, iva_imputado numeric,
              neto_esperado numeric, neto_imputado numeric)
as $$
  select v.id,
         round((select coalesce(sum(vi.iva_monto),0) from venta_items vi where vi.venta_id = v.id), 2),
         coalesce((select sum(am.haber) from asiento_movimientos am
                     join asientos a on a.id = am.asiento_id
                    where a.origen_tipo='venta' and a.origen_id = v.id and am.cuenta='2.1.2'), 0),
         round(v.total - round((select coalesce(sum(vi.iva_monto),0) from venta_items vi
                                 where vi.venta_id = v.id), 2), 2),
         coalesce((select sum(am.haber) from asiento_movimientos am
                     join asientos a on a.id = am.asiento_id
                    where a.origen_tipo='venta' and a.origen_id = v.id and am.cuenta='4.1'), 0)
  from ventas v
  where round((select coalesce(sum(vi.iva_monto),0) from venta_items vi where vi.venta_id = v.id), 2)
        <> coalesce((select sum(am.haber) from asiento_movimientos am
                       join asientos a on a.id = am.asiento_id
                      where a.origen_tipo='venta' and a.origen_id = v.id and am.cuenta='2.1.2'), 0)
     or round(v.total - round((select coalesce(sum(vi.iva_monto),0) from venta_items vi
                                where vi.venta_id = v.id), 2), 2)
        <> coalesce((select sum(am.haber) from asiento_movimientos am
                       join asientos a on a.id = am.asiento_id
                      where a.origen_tipo='venta' and a.origen_id = v.id and am.cuenta='4.1'), 0);
$$ language sql;
