#!/usr/bin/env node

import { $ } from 'zx'
import { parseArgs } from 'node:util'
import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import nunjucks from 'nunjucks'
import { createResourcesJson, createTemplate } from './templates/index.js'

const pkgPath = join(import.meta.dirname, '../package.json')
const { version, name } = JSON.parse(await readFile(pkgPath, 'utf-8'))

const AWS_CLI_ERROR =
  'Failed to use `aws` CLI, do you have installed and are you authenticated with your management account?'

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

let args
try {
  const { values } = parseArgs({
    args: process.argv,
    options: optionsConfig,
    allowPositionals: true,
  })
  args = values
} catch (e) {
  console.error(e.message)
  help()
  process.exit(1)
}

if (args.help) {
  help()
  process.exit(0)
}

const $$ = $({
  verbose: args.verbose,
})

// 0. preliminary checks
const awsCliCheck = await $$`aws --version`
if (awsCliCheck.exitCode !== 0) {
  console.error(AWS_CLI_ERROR)
  process.exit(1)
}
const orgFormationCheck = await $$`org-formation --version`
if (orgFormationCheck.exitCode !== 0) {
  console.error(
    'org-formation CLI not found. Please install it with `npm i -g org-formation`'
  )
  process.exit(1)
}

const templatesPath = join(import.meta.dirname, 'templates')
nunjucks.configure(templatesPath, { autoescape: false })

// 1. determine identity store id and managing instance arn
let identityStoreId = args['identity-store-id']
let managingInstanceArn = args['managing-instance-arn']
const stackName = args['stack-name']
if (!(identityStoreId && managingInstanceArn)) {
  console.warn(
    'identity-store-id or managing-instance-arn not provided, trying to determine them...'
  )
  const result = await $$`aws sso-admin list-instances`
  if (result.exitCode !== 0) {
    console.error(AWS_CLI_ERROR)
    process.exit(1)
  }
  const data = JSON.parse(result.stdout)
  if (data.Instances.length === 0) {
    console.error(
      'Could not determine identity-store-id and managing-instance-arn. Did you create your AWS organization? Are you using the correct region?'
    )
    process.exit(1)
  }
  identityStoreId = data.Instances[0].IdentityStoreId
  managingInstanceArn = data.Instances[0].InstanceArn
  console.warn(`identity-store-id: ${identityStoreId}`)
  console.warn(`managing-instance-arn: ${managingInstanceArn}`)
}

// 2. creates a temporary directory
const tmpDir = `.${name}`
await $$`mkdir -p ${tmpDir}`

// 3. create org-formation task
const taskContent = nunjucks.render('organization-tasks.yml.njk', {
  stackName: stackName,
})
await writeFile(`${tmpDir}/organization-tasks.yml`, taskContent)

// 4. create base org-formation template for SsoAssignments
const tempGroupName = 'OrgFormationSsoImportTemp'
const baseTemplateContent = nunjucks.render('sso-assignments.yml.njk', {
  identityStoreId,
  managingInstanceArn,
  groups: [
    {
      name: tempGroupName,
      displayName: tempGroupName,
      description: 'To be removed',
    },
  ],
})
await writeFile(`${tmpDir}/sso-assignments.yml`, baseTemplateContent)

// 5. org-formation deploy initial stack
const result =
  await $$`org-formation perform-tasks ${tmpDir}/organization-tasks.yml --organization-file organization.yml`
if (result.exitCode !== 0) {
  console.error('Failed to deploy initial stack')
  console.error(result.stderr)
  process.exit(1)
}

// 6. Find all existing resources

// 6.1. Find all existing groups
const listGroupsResult =
  await $$`aws identitystore list-groups --identity-store-id ${identityStoreId}`
if (listGroupsResult.exitCode !== 0) {
  console.error(listGroupsResult.stderr)
  process.exit(1)
}
let groups = JSON.parse(listGroupsResult.stdout).Groups
const tempGroup = groups.find(g => g.DisplayName === tempGroupName)
groups = groups.filter(g => g.DisplayName !== tempGroupName)

// 6.2. Find all existing permissions sets
const listPermissionSetsResult =
  await $$`aws sso-admin list-permission-sets --instance-arn ${managingInstanceArn}`

// 7. Create JSON file with list of resources to import
const resourcesJsonContent = createResourcesJson({
  identityStoreId,
  groups,
})
await writeFile(`${tmpDir}/resources.json`, resourcesJsonContent)

// 8. Create CloudFormation template for resource import
const templateJsonContent = createTemplate({
  identityStoreId,
  managingInstanceArn,
  tempGroup,
  groups,
})
await writeFile(`${tmpDir}/template.json`, templateJsonContent)

// 9. Create changeset
const changesetName = 'OrgFormationSsoImportResources'
const createStackSetResult =
  await $$`aws cloudformation create-change-set --stack-name ${stackName} --change-set-name ${changesetName} --change-set-type IMPORT --resources-to-import file://${tmpDir}/resources.json --template-body file://${tmpDir}/template.json`
if (createStackSetResult.exitCode !== 0) {
  console.error(createStackSetResult.stderr)
  process.exit(1)
}

// 11. Wait for the changeset to be completed
let changeSetCreationAttempts = 0
while (true) {
  const describeChangeSetResult =
    await $$`aws cloudformation describe-change-set --change-set-name ${changesetName} --stack-name ${stackName}`
  if (describeChangeSetResult.exitCode !== 0) {
    console.error(describeChangeSetResult.stderr)
    process.exit(1)
  }
  const data = JSON.parse(describeChangeSetResult.stdout)
  if (data.Status === 'CREATE_COMPLETE') {
    break
  }
  if (data.Status === 'FAILED') {
    console.error('Failed to create change set')
    console.error(data.StatusReason)
    process.exit(1)
  }

  changeSetCreationAttempts++
  if (changeSetCreationAttempts > 30) {
    console.error('Change set creation has been taking too long')
    process.exit(1)
  }
  await new Promise(resolve => setTimeout(resolve, 1000))
}

// 10. Execute changeset
const executeStackSetResult =
  await $$`aws cloudformation execute-change-set --change-set-name ${changesetName} --stack-name ${stackName}`
if (executeStackSetResult.exitCode !== 0) {
  console.error(executeStackSetResult.stderr)
  process.exit(1)
}
