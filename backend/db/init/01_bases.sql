-- Se ejecuta una sola vez, cuando el volumen delfino_pg_data se crea vacio.
-- delfino_dev  : base de trabajo (la que usan los agentes al desarrollar)
-- delfino_test : base de tests (se crea y se vacia en cada corrida de integracion)
CREATE DATABASE delfino_test OWNER delfino;
