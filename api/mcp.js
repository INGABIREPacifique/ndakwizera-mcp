import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_REPO = 'INGABIREPacifique/NDAKWIZERA-'
const GITHUB_BRANCH = 'main'

const TOOLS = [
  {
    name: 'read_file',
    description: 'Read any file from the Ndakwizera GitHub repository',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'File path e.g. app/login/page.js' } },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write or update any file in the Ndakwizera GitHub repository and push to main',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        message: { type: 'string' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'list_files',
    description: 'List files in the Ndakwizera repository',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Directory path, empty for root' } }
    }
  },
  {
    name: 'run_sql',
    description: 'Run SQL directly on Ndakwizera Supabase database',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query']
    }
  },
  {
    name: 'get_schema',
    description: 'Get Ndakwizera database table structure',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_cases',
    description: 'Get all cases from Ndakwizera database',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_users',
    description: 'Get all users from Ndakwizera database',
    inputSchema: { type: 'object', properties: {} }
  }
]

async function readFile(path) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}`, {
    headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' }
  })
  if (!res.ok) throw new Error(`File not found: ${path}`)
  const data = await res.json()
  return { content: Buffer.from(data.content, 'base64').toString('utf-8'), sha: data.sha }
}

async function writeFile(path, content, message) {
  let sha
  try { const f = await readFile(path); sha = f.sha } catch {}
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: message || `update: ${path}`, content: Buffer.from(content).toString('base64'), branch: GITHUB_BRANCH, ...(sha ? { sha } : {}) })
  })
  if (!res.ok) { const e = await res.json(); throw new Error(e.message) }
  return await res.json()
}

async function listFiles(path) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path || ''}?ref=${GITHUB_BRANCH}`, {
    headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' }
  })
  if (!res.ok) throw new Error(`Cannot list: ${path}`)
  const data = await res.json()
  return data.map(f => ({ name: f.name, path: f.path, type: f.type }))
}

async function getSchema() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const tables = ['users', 'cases', 'auth_sessions', 'institution_responses', 'audit_log']
  const schema = {}
  for (const t of tables) {
    const { data, error } = await supabase.from(t).select('*').limit(1)
    schema[t] = error ? { error: error.message } : { exists: true, columns: data?.[0] ? Object.keys(data[0]) : [] }
  }
  return schema
}

async function getCases() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data, error } = await supabase.from('cases').select('*').order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data
}

async function getUsers() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, mcp-session-id',
}

export default async function handler(req, res) {
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(204).end()

  if (req.method === 'GET') {
    return res.json({ name: 'ndakwizera-dev', version: '2.0.0', tools: TOOLS })
  }

  if (req.method === 'POST') {
    const { method, params, id } = req.body
    try {
      let result
      if (method === 'initialize') {
        result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'ndakwizera-dev', version: '2.0.0' } }
      } else if (method === 'tools/list') {
        result = { tools: TOOLS }
      } else if (method === 'tools/call') {
        const { name, arguments: args } = params
        if (name === 'read_file') {
          const { content } = await readFile(args.path)
          result = { content: [{ type: 'text', text: content }] }
        } else if (name === 'write_file') {
          const r = await writeFile(args.path, args.content, args.message)
          result = { content: [{ type: 'text', text: `✅ Written & pushed to GitHub: ${args.path}\nCommit: ${r.commit?.sha?.slice(0,7)}` }] }
        } else if (name === 'list_files') {
          const files = await listFiles(args.path)
          result = { content: [{ type: 'text', text: JSON.stringify(files, null, 2) }] }
        } else if (name === 'run_sql') {
          const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
          const { data, error } = await supabase.rpc('exec_sql', { sql: args.query })
          if (error) throw new Error(error.message)
          result = { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
        } else if (name === 'get_schema') {
          const schema = await getSchema()
          result = { content: [{ type: 'text', text: JSON.stringify(schema, null, 2) }] }
        } else if (name === 'get_cases') {
          const cases = await getCases()
          result = { content: [{ type: 'text', text: JSON.stringify(cases, null, 2) }] }
        } else if (name === 'get_users') {
          const users = await getUsers()
          result = { content: [{ type: 'text', text: JSON.stringify(users, null, 2) }] }
        } else {
          throw new Error(`Unknown tool: ${name}`)
        }
      } else {
        result = {}
      }
      return res.json({ jsonrpc: '2.0', id, result })
    } catch (err) {
      return res.status(500).json({ jsonrpc: '2.0', id, error: { code: -32000, message: err.message } })
    }
  }

  res.status(405).json({ error: 'Method not allowed' })
}
