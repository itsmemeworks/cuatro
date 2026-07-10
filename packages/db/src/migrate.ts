// Standalone entry point: applies pending migrations to DATABASE_URL and
// exits. Useful in deploy/CI where you want migration to run as its own step
// rather than implicitly on first createClient() call.
import { createClient } from './client.js'

async function main() {
  const url = process.env.DATABASE_URL
  const { close } = await createClient(url)
  console.log(`[@cuatro/db] migrations applied to ${url ?? '(default local stack)'}`)
  await close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
