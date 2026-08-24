// Aplica scripts/schema.sql sobre la base configurada en .env.
// Todas las sentencias son CREATE TABLE IF NOT EXISTS, asi que correrlo de nuevo
// no destruye nada.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import mysql from 'mysql2/promise'
import { config, ROOT } from '../src/config.js'

const sql = readFileSync(join(ROOT, 'scripts', 'schema.sql'), 'utf8')

const conn = await mysql.createConnection({ ...config.db, multipleStatements: true })
await conn.query(sql)

const [tablas] = await conn.query('SHOW TABLES')
console.log('Esquema aplicado. Tablas:', tablas.map((t) => Object.values(t)[0]).join(', '))

await conn.end()
