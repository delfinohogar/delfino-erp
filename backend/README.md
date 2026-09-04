# backend/

Vacio a proposito. En FASE -1 esta carpeta solo contiene el Postgres local de desarrollo.
El backend de la aplicacion se construye recien en la PoC (FASE 1), y solo si aprobas el GO.

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
