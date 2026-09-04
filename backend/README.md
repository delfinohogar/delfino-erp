# backend/

Backend de la PoC de migracion a PostgreSQL (rama `migration/postgresql`).

Hoy es el minimo indispensable: el Postgres local de desarrollo, las migraciones de esquema,
un cliente `pg` y el migrador que las aplica.

## Que NO es esto todavia

- **No hay HTTP.** No hay servidor, no hay rutas, no escucha ningun puerto. Nada de lo que hay
  en `src/` abre un socket de entrada.
- **No hay logica de negocio en Node.** Los servicios de dominio de la PoC viven en la base
  (`crear_venta()` y las que la acompanian, en `db/migrations/`), no en JavaScript.
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
    node backend/src/db/migrar.js --estado            # informa, no escribe esquema
    node backend/src/db/migrar.js --marcar-aplicadas  # baseline explicito, ver abajo

Que hace:

1. toma un `pg_advisory_lock` de sesion, para que dos corridas simultaneas no apliquen la misma
   migracion dos veces (la segunda espera y despues no encuentra nada pendiente);
2. crea `schema_migrations (nombre text primary key, aplicada_en timestamptz)` si no existe;
3. lee `backend/db/migrations/*.sql` **en orden alfabetico** — por eso el prefijo `0001_`,
   `0002_`, … — y aplica las que no esten registradas;
4. **cada migracion corre en su propia transaccion, y el `insert` en `schema_migrations` va en
   esa misma transaccion**: si la migracion falla, se revierte entera y no queda marcada como
   aplicada. Nunca hay una migracion "a medias" registrada como buena;
5. libera el lock y cierra el pool. Sale con codigo 0 si no hubo error, 1 si lo hubo.

Es idempotente: correrlo dos veces seguidas no reaplica nada e imprime
`Sin migraciones pendientes.`

Requisito de toda migracion nueva: tiene que poder correr dentro de una transaccion. Nada de
`CREATE INDEX CONCURRENTLY` ni `VACUUM`. Y una migracion ya aplicada no se edita: se agrega otra.

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

  Registra las pendientes **sin ejecutarlas** y lo dice en pantalla. Si el esquema real no
  coincide con los `.sql`, esto deja la base mintiendo sobre su estado. Usarlo a conciencia.

## Estructura

    backend/
      docker-compose.yml     Postgres 16 local, solo loopback
      db/init/               se ejecuta una vez, al crear el volumen (crea delfino_test)
      db/migrations/         el esquema, en archivos numerados
      src/db/pool.js         cliente pg: urlConexion, crearPool, obtenerPool, cerrarPool, conTransaccion
      src/db/migrar.js       el migrador (CLI e importable)
      package.json           `type: module`. Declara pg en la misma version que la raiz.

`backend/package.json` no necesita `npm install` propio: Node resuelve `pg` en el
`node_modules` de la raiz, donde ya estaba como devDependency. La dependencia se declara igual
para que quede escrito que el backend depende de `pg`, y en la misma version (`^8.13.0`).
