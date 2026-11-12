import 'dotenv/config'
import { serve } from '@hono/node-server'
import app from './app.js'

serve({ fetch: app.fetch, port: Number(process.env.PORT || 3000), hostname: '127.0.0.1' }, info => {
  console.log(`API disponível em http://127.0.0.1:${info.port}/api`)
})
