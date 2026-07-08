// Standalone entry point: applies pending migrations to DATABASE_PATH (or
// ./dev.db) and exits. Useful in deploy/CI where you want migration to run
// as its own step rather than implicitly on first createClient() call.
import { createClient } from './client.js'

const dbPath = process.env.DATABASE_PATH ?? './dev.db'
const { close } = createClient(dbPath)
console.log(`[@cuatro/db] migrations applied to ${dbPath}`)
close()
