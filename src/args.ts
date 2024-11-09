import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ParseArgsConfig } from 'node:util'
import { parseArgs } from 'node:util'

const pkgPath = join(import.meta.dirname, '../package.json')
const { version, name } = JSON.parse(await readFile(pkgPath, 'utf-8'))

type Args = {
  'stack-name': string
  'identity-store-id': string
  'managing-instance-arn': string
  region: string
  verbose: boolean
  help: boolean
}

const optionsConfig = {
  'stack-name': {
    type: 'string',
    short: 's',
    default: 'SsoAssignments',
    help: 'Pass the name of the stack to be deployed',
  },
  'identity-store-id': {
    type: 'string',
    short: 'i',
    default: '',
    help: 'Pass the id of the identity store. If not provided will try to fetch for an existing one',
  },
  'managing-instance-arn': {
    type: 'string',
    short: 'm',
    default: '',
    help: 'Pass the arn of the managing instance. If not provided will try to fetch for an existing one',
  },
  region: {
    type: 'string',
    short: 'r',
    default: '',
    help: 'Pass the region to be used. If not provided will use the value of the AWS_REGION environment variable.',
  },
  verbose: {
    type: 'boolean',
    short: 'v',
    default: false,
    help: 'Enables verbose mode',
  },
  help: {
    type: 'boolean',
    short: 'h',
    default: false,
    help: 'Prints this help',
  },
}

function help() {
  console.info(`${name} v${version}\n`)
  console.info('Options:')
  for (const [option, c] of Object.entries(optionsConfig)) {
    console.info(`  --${option} ${c.type === 'string' ? '<value>' : ''}`)
    console.info(`  -${c.short} ${c.type === 'string' ? '<value>' : ''}`)
    console.info(
      `  ${c.help}${c.default ? ` (default: ${JSON.stringify(c.default)})` : ''}\n`
    )
  }
}

export function getArgs(rawArgs: string[] = process.argv): Args {
  let args: Args
  try {
    const { values } = parseArgs({
      args: rawArgs,
      options: optionsConfig,
      allowPositionals: true,
    } as ParseArgsConfig)
    args = values as Args
  } catch (e) {
    console.error((e as Error).message)
    help()
    process.exit(1)
  }

  if (args.help) {
    help()
    process.exit(0)
  }

  return args
}
