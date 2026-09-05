# backend/

Backend de la PoC de migracion a PostgreSQL (rama `migration/postgresql`).

Hoy es el minimo indispensable: el Postgres local de desarrollo, las migraciones de esquema,
un cliente `pg` y el migrador que las aplica.

## Que NO es esto todavia

- **No hay HTTP.** No hay servidor, no hay rutas, no escucha ningun puerto. Nada de lo que hay
  en `src/` abre un socket de entrada.
- **No hay logica de negocio en Node.** Los servicios de dominio de la PoC viven en la base
  (`crear_venta()` y las que la acompanian, en `db/migrations/` y `db/repetibles/`), no en
  JavaScript.
- **No toca Firebase.** Ningun archivo de `backend/` importa el SDK de Firebase ni habla con
  Firestore. `functions/` es produccion desplegada y es otra cosa.
- **No es Cloud SQL.** Postgres local en Docker, decision P12.

## Postgres local

    npm run db:up      # levanta delfino-pg-dev en 127.0.0.1:5432
    npm run db:down    # lo apaga (los datos quedan en el volumen delfino_pg_data)

Para borrar los datos por completo:

    docker compose -f backend/docker-compose.yml down -v

Bases: `delfino_dev` (trabajo) y `delfino_test` (tests de integracion).
Usuario `delfino`, password `delfino_local_dev`. Son credenciales locales de juguete.

## Antes de empezar, una sola vez por clon del repo

    git config core.hooksPath .githooks
    copy backend\.env.example backend\.env

Sin el primer comando, las barreras de push y de commit no estan activas.

## Variables de entorno

| Variable | Para que | Quien la usa |
|---|---|---|
| `DATABASE_URL` | base de trabajo (`delfino_dev`) | todo, fuera de los tests |
| `DATABASE_URL_TEST` | base de tests (`delfino_test`) | solo en entorno de tests |
| `DELFINO_DB_REMOTO_OK` | escape para un host que no sea local | nadie, en condiciones normales |

Valor de desarrollo:

    DATABASE_URL=postgres://delfino:delfino_local_dev@127.0.0.1:5432/delfino_dev
    DATABASE_URL_TEST=postgres://delfino:delfino_local_dev@127.0.0.1:5432/delfino_test

`src/db/pool.js` resuelve la URL asi: si esta en entorno de tests (`NODE_ENV=test` o `VITEST`,
que es lo que define Vitest) usa `DATABASE_URL_TEST` y, si no existe, `DATABASE_URL`; fuera de
los tests usa **solo** `DATABASE_URL`, para no conectarse a la base de tests por accidente. Si
no hay ninguna, falla con un mensaje que dice cual falta y como levantar la base — no intenta
adivinar una URL por defecto.

Ademas corta si la URL apunta a un host que no sea loopback (`127.0.0.1`, `localhost`, `::1`).
La PoC corre siempre contra el Postgres local. El escape es explicito: `DELFINO_DB_REMOTO_OK=1`.

`backend/.env` no se lee solo: no hay dotenv. Exporta las variables en la shell, o usa el
`.env` desde donde lo necesites.

## Migrador

    node backend/src/db/migrar.js                     # aplica las pendientes
    node backend/src/db/migrar.js --estado            # informa; no ejecuta ninguna migracion
    node backend/src/db/migrar.js --marcar-aplicadas  # baseline explicito, ver abajo.
                                                      # FALLA si una repetible no esta en la base (R37)

Esos son **todos** los flags, y hay que escribirlos exactos. Cualquier otro argumento —un typo
como `--estad`, una abreviatura como `--marcar-aplicada`, un flag inventado— **aborta con exit 1
y lista los validos, antes de conectarse a la base**. Nunca cae en el modo que aplica
migraciones: un `--estado` mal tipeado no ejecuta SQL (R14). `--estado` y `--marcar-aplicadas`
juntos tambien abortan, porque uno solo informa y el otro escribe.

Hay **dos clases de migracion**, y el migrador aplica siempre las numeradas primero:

| clase | directorio | cuando se aplica | donde se registra |
|---|---|---|---|
| numeradas | `db/migrations/*.sql` | una sola vez, para siempre | `schema_migrations` |
| repetibles | `db/repetibles/*.sql` | cada vez que cambia su hash | `schema_repetibles` |

Que hace:

1. valida los argumentos. Si hay uno desconocido, corta ahi y no abre conexion;
2. toma un `pg_advisory_lock` de sesion, para que dos corridas simultaneas no apliquen la misma
   migracion dos veces (la segunda espera y despues no encuentra nada pendiente). **Las
   repetibles corren bajo ese mismo lock**;
3. crea `schema_migrations (nombre text primary key, aplicada_en timestamptz)` y
   `schema_repetibles (nombre text primary key, hash text, aplicada_en timestamptz)` si no
   existen;
4. lee `backend/db/migrations/*.sql` **en orden alfabetico** — por eso el prefijo `0001_`,
   `0002_`, … — y aplica las que no esten registradas;
5. **despues** lee `backend/db/repetibles/*.sql`, tambien en orden alfabetico, y aplica las que
   no esten registradas o cuyo hash haya cambiado;
6. **cada migracion corre en su propia transaccion, y su registro va en esa misma
   transaccion** — el `insert` en `schema_migrations`, el `upsert` en `schema_repetibles`—: si
   la migracion falla, se revierte entera y no queda marcada como aplicada. Nunca hay una
   migracion "a medias" registrada como buena. Vale igual para las repetibles: una repetible que
   falla no se registra, no deja efectos, y la corrida siguiente la vuelve a intentar;
7. libera el lock y cierra el pool. Sale con codigo 0 si no hubo error, 1 si lo hubo.

Es idempotente: correrlo dos veces seguidas no reaplica nada e imprime
`Sin migraciones pendientes.` y `Repetibles: sin cambios.`

Requisito de toda migracion nueva: tiene que poder correr dentro de una transaccion. Nada de
`CREATE INDEX CONCURRENTLY` ni `VACUUM`. Y una migracion numerada ya aplicada no se edita: se
agrega otra.

### Que escribe cada modo

`--estado` **no ejecuta ninguna migracion** y no cambia el esquema de la aplicacion. Lo unico
que escribe son las dos tablas de control, con `create table if not exists`, y las deja vacias
si no existian. Se dice explicito porque antes el README afirmaba "no escribe esquema" mientras
el codigo si creaba `schema_migrations`, y esa contradiccion era parte de R14. Si hace falta
consultar el estado sin escribir absolutamente nada, la consulta directa a las dos tablas es el
camino; el flag no lo hace.

### Migraciones repetibles (`db/repetibles/`)

Son las definiciones que se reemplazan enteras: `CREATE OR REPLACE FUNCTION` y companina. En vez
de copiar el cuerpo de la funcion en cada migracion numerada que la toca —que fue lo que dejo
tres copias de `crear_venta()` mantenidas a mano, R28— la funcion vive en **un solo archivo** y
se edita ahi. El migrador la reaplica cuando cambia.

**Por que el directorio se llama `repetibles/` y no `functions/`.** Porque dentro de un
directorio de base de datos `functions/` es ambiguo entre funciones de PostgreSQL y las Cloud
Functions de `functions/`, que son produccion desplegada y no las toca ningun agente. La
ambiguedad no fue teorica: la barrera que protege las Cloud Functions matchea el componente
`functions` **a cualquier profundidad del arbol** (R39), asi que tambien alcanzaba a
`backend/db/functions/` y no dejaba crear la definicion canonica de `crear_venta()`. Se renombro
el directorio en vez de agujerear la barrera. **No revertirlo a `functions/` por prolijidad**:
reabre el bloqueo. Decision de Gaston, 2026-09-05.

Reglas:

- una repetible tiene que ser **idempotente por si misma**: se va a correr muchas veces.
  `CREATE OR REPLACE FUNCTION` si; `CREATE TABLE` no —eso es una numerada—;
- se aplican **siempre despues** de todas las numeradas, asi pueden apoyarse en el esquema;
- si el archivo se borra, su fila queda en `schema_repetibles` y `--estado` la reporta como
  `registrada pero NO esta en disco`. El migrador no borra funciones de la base: si hay que
  eliminar una, va un `DROP FUNCTION` en una migracion numerada;
- el directorio puede **no existir o estar vacio**: no es un error.

**Que se hashea, y por que importa.** El hash es un SHA-256 del contenido **normalizado a LF**,
no del byte crudo del archivo, y lo que se le manda a PostgreSQL es ese mismo texto normalizado.
El repositorio no tiene `.gitattributes` y en Windows `core.autocrlf` deja los `.sql` del arbol
de trabajo en CRLF (`git ls-files --eol` da `i/lf w/crlf`). Si se hasheara el byte crudo, un
`git checkout` o un clon en otra plataforma —que no cambian una sola letra de SQL— cambiarian el
hash de **todas** las funciones y dispararian una reaplicacion espuria. Normalizar tambien lo que
se ejecuta cierra la otra mitad (R33): `pg_get_functiondef()` devuelve el cuerpo tal cual se lo
mandaron, asi que desplegar CRLF haria que lo que corre en la base dependiera del checkout de
quien migro, y comparar la definicion desplegada contra el archivo daria `false`. Con LF en los
dos lados, el hash depende del contenido y de nada mas. Verificado: pasar las repetibles de LF a
CRLF **no** dispara reaplicacion, y `prosrc` queda sin `\r`.

### Si la base ya tiene el esquema por otra via

Pasa de verdad: `tests/integration/postgres/_helpers.mjs` aplica los `.sql` a mano y no registra
nada en `schema_migrations`. Comportamiento verificado en ese caso:

    La migracion 0001_esquema_poc.sql fallo y se revirtio (ROLLBACK).
      relation "clientes" already exists
      Parece que la base ya tiene el esquema aplicado por otra via ...

El migrador **falla y no marca nada**. No hace ningun baseline silencioso: no da por aplicada
una migracion que no ejecuto. Dos salidas, las dos explicitas:

- **vaciar y volver a migrar** (lo normal en desarrollo):

      docker exec delfino-pg-dev psql -U delfino -d delfino_dev -c "drop schema public cascade; create schema public;"
      node backend/src/db/migrar.js

- **baseline explicito**, solo si el esquema en la base ya es exactamente el de esos archivos:

      node backend/src/db/migrar.js --marcar-aplicadas

  Registra las pendientes **sin ejecutarlas** y lo dice en pantalla. Alcanza tambien a las
  repetibles: registra su nombre y su hash sin correr el SQL, por el mismo criterio —si el
  operador declara que la base ya esta en el estado de los archivos, tambien lo esta el de las
  funciones—. Para las **numeradas** sigue valiendo la advertencia de siempre: si el esquema real
  no coincide con los `.sql`, esto deja la base mintiendo sobre su estado. Usarlo a conciencia.

  Para las **repetibles ya no depende del cuidado del operador**: ver abajo.

#### `--marcar-aplicadas` FALLA si una repetible no esta desplegada (R37)

Antes, el flag baselineaba las repetibles a ciegas: escribia nombre y hash en `schema_repetibles`
sin mirar la base. La asimetria con las numeradas es lo que lo hacia peligroso. Con una numerada,
un baseline mal hecho revienta enseguida —la tabla no esta y la primera consulta falla—. Con una
repetible **no revienta nada**: la base se queda con `crear_venta()` vieja, o sin ella, mientras
el migrador informa `Repetibles: sin cambios` y `--estado` dice `al dia`. Textual de Gaston:
*"un `crear_venta()` equivocado corriendo en silencio no aparece en un test, aparece en una
venta"*.

Desde TASK-018 el flag **no avisa: falla**. Antes de escribir una sola fila —ni numeradas ni
repetibles— lee cada archivo de `db/repetibles/`, saca que funciones declara (nombre y cantidad de
argumentos) y **consulta `pg_proc`**, o sea la base. Si alguna no esta desplegada, aborta con
exit 1 y `schema_migrations` y `schema_repetibles` quedan **exactamente como estaban**:

    --marcar-aplicadas ABORTADO: hay repetibles que NO estan desplegadas en la base.
    No se marco NADA: ni migraciones numeradas ni repetibles.

      crear_venta.sql declara crear_venta(8 argumento(s)) y en la base NO existe.
    ...
    Que hacer: correr el migrador SIN flags para desplegarlas de verdad, y recien despues
    baselinear si todavia hace falta.

Dos detalles del chequeo, y los dos importan:

- **mira la base, no `schema_repetibles`.** La raiz del problema es que esa tabla *declara* el
  estado de la base en vez de *observarlo*; un control que la consultara a ella heredaria el
  mismo agujero;
- **recorre TODAS las repetibles en disco, no solo las pendientes.** Un `DROP FUNCTION` a mano
  despues de haber aplicado la funcion deja la fila al dia —y por lo tanto *no* pendiente— con la
  funcion ausente. Es el mismo estado incoherente por otro camino, y queda cubierto por el mismo
  control.

Se comparan **nombre y aridad**, no los tipos: interpretar `double precision`, arrays o typmods
seria una fuente de falsos positivos y para detectar las dos formas de ausencia no hace falta.
Limitacion conocida y aceptada: una funcion con parametros `OUT` cuenta distinto que
`pg_proc.pronargs`; ninguna funcion del dominio los usa y, si alguna los usara, el resultado
seria un error explicito y legible, no un silencio.

Documentar esto **no alcanzaba** y esa salida quedo descartada: el flag ya es explicito y
peligroso, y un aviso en esa salida se lee tarde.

## Estructura

    backend/
      docker-compose.yml     Postgres 16 local, solo loopback
      db/init/               se ejecuta una vez, al crear el volumen (crea delfino_test)
      db/migrations/         el esquema, en archivos numerados: se aplican una sola vez
      db/repetibles/         migraciones repetibles: se reaplican cuando cambia su hash
      src/db/pool.js         cliente pg: urlConexion, crearPool, obtenerPool, cerrarPool, conTransaccion
      src/db/migrar.js       el migrador (CLI e importable)
      package.json           `type: module`. Declara pg en la misma version que la raiz.

`backend/package.json` no necesita `npm install` propio: Node resuelve `pg` en el
`node_modules` de la raiz, donde ya estaba como devDependency. La dependencia se declara igual
para que quede escrito que el backend depende de `pg`, y en la misma version (`^8.13.0`).
