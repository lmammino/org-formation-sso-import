#!/usr/bin/env node

import type { Group } from '@aws-sdk/client-identitystore'
import { mkdirp } from 'mkdirp'
import { writeFile } from 'node:fs/promises'
import { rimraf } from 'rimraf'
import { $ } from 'zx'
import { listOrgFormationAccounts } from './accounts.js'
import { getArgs } from './args.js'
import {
  createAndExecuteChangeSet,
  getCallerIdentity,
  getOrgFormationVersion,
  listAssignments,
  listGroups,
  listPermissionSets,
  listSsoInstances,
  orgFormationDeploy,
} from './commands.js'
import { TEMP_DIR, TEMP_GROUP_NAME } from './consts.js'
import {
  createBaseOrgFormationSsoAssignmentsYml,
  createOrgFormationSsoAssignmentsYml,
  createOrganizationTasksYml,
  createResourcesToImport,
  createTemplate,
} from './templates.js'

const args = getArgs(process.argv)

const $$ = $({
  verbose: args.verbose,
})

// 0. preliminary checks
// check if has correct credentials
const callerIdentity = await getCallerIdentity()
if (args.verbose) {
  console.info('Caller identity:', callerIdentity)
}
// checks if org-formation is installed
await getOrgFormationVersion($$)

// 1. determine identity store id and managing instance arn
let identityStoreId = args['identity-store-id']
let managingInstanceArn = args['managing-instance-arn']
const stackName = args['stack-name']
if (!(identityStoreId && managingInstanceArn)) {
  console.warn(
    'identity-store-id or managing-instance-arn not provided, trying to determine them...'
  )
  const ssoInstances = await listSsoInstances()
  if (!ssoInstances) {
    console.error(
      'Could not determine identity-store-id and managing-instance-arn. Did you create your AWS organization? Are you using the correct region?'
    )
    process.exit(1)
  }
  identityStoreId = ssoInstances[0]?.IdentityStoreId as string
  managingInstanceArn = ssoInstances[0]?.InstanceArn as string
  console.warn(`identity-store-id: ${identityStoreId}`)
  console.warn(`managing-instance-arn: ${managingInstanceArn}`)
}

// 2. creates a temporary directory
await mkdirp(TEMP_DIR)
console.info(`✅ Created ${TEMP_DIR}`)

// 3. create org-formation task
const taskContent = createOrganizationTasksYml({
  stackName,
  organizationUpdate: false,
  ssoAssignmentTemplate: './sso-assignments.yml',
})
await writeFile(`${TEMP_DIR}/organization-tasks.yml`, taskContent)
console.info(`✅ Created ${TEMP_DIR}/organization-tasks.yml`)

// 4. create base org-formation template for SsoAssignments
const baseTemplateContent = createBaseOrgFormationSsoAssignmentsYml({
  identityStoreId,
  managingInstanceArn,
})
await writeFile(`${TEMP_DIR}/sso-assignments.yml`, baseTemplateContent)
console.info(`✅ Created ${TEMP_DIR}/sso-assignments.yml`)

// 5. org-formation deploy initial stack
await orgFormationDeploy($$, `${TEMP_DIR}/organization-tasks.yml`)
console.info('✅ Deployed initial OrgFormation stack')

// 6. Find all existing resources

// 6.1 Load OrgFormation accounts
const accounts = await listOrgFormationAccounts()
const accountIds = accounts.map(a => a.AccountId)
console.info('✅ Loaded OrgFormation accounts')
if (args.verbose) {
  console.debug(JSON.stringify(accounts, null, 2))
}

// 6.2. Find all existing groups
let groups = await listGroups(identityStoreId)
const tempGroup = groups.find(g => g.DisplayName === TEMP_GROUP_NAME) as Group
groups = groups.filter(g => g.DisplayName !== TEMP_GROUP_NAME)
console.info('✅ Loaded groups')
if (args.verbose) {
  console.debug(JSON.stringify(groups, null, 2))
}

// 6.3. Find all existing permissions sets
const permissionSets = await listPermissionSets(managingInstanceArn)
console.info('✅ Loaded permission sets')
if (args.verbose) {
  console.debug(JSON.stringify(permissionSets, null, 2))
}

// 6.4 Find all existing assignments
const assignments = await listAssignments(
  managingInstanceArn,
  accountIds,
  permissionSets
)
console.info('✅ Loaded assignments')
if (args.verbose) {
  console.debug(JSON.stringify(assignments, null, 2))
}

// 7. Create resources file for resource import
const resourcesToImport = createResourcesToImport({
  identityStoreId,
  managingInstanceArn,
  groups,
  permissionSets,
  assignments,
  accounts,
})
console.info('✅ Created resources file for resource import')
if (args.verbose) {
  console.debug(JSON.stringify(resourcesToImport, null, 2))
}

// 8. Create CloudFormation template for resource import
const templateBody = createTemplate({
  identityStoreId,
  managingInstanceArn,
  tempGroup,
  groups,
  permissionSets,
  assignments,
  accounts,
})
console.info('✅ Created CloudFormation template for resource import')
if (args.verbose) {
  console.debug(templateBody)
}

// 9. Create and execute changeset
await createAndExecuteChangeSet({
  stackName,
  templateBody,
  resourcesToImport,
})
console.info(`✅ Imported resources in stack ${stackName}`)

// 10. generate new sso-assignments.yml with the new groups and permission sets and assignments
await mkdirp('templates')
const finalTaskContent = createOrganizationTasksYml({
  stackName,
  organizationUpdate: true,
  ssoAssignmentTemplate: './templates/sso-assignments.yml',
})
await writeFile('organization-tasks.yml', finalTaskContent)
console.info('✅ Created organization-tasks.yml')

const finalSsoAssignmentsContent = createOrgFormationSsoAssignmentsYml({
  identityStoreId,
  managingInstanceArn,
  accounts,
  groups,
  permissionSets,
  assignments,
})
await writeFile('templates/sso-assignments.yml', finalSsoAssignmentsContent)
console.info('✅ Created templates/sso-assignments.yml')

// 11. execute org-formation again to remove the temporary group
await orgFormationDeploy($$, 'organization-tasks.yml')
console.info('✅ Deployed newly generated OrgFormation template')

// 12. cleanup temporary folder
await rimraf(TEMP_DIR)
console.info(`✅ Removed ${TEMP_DIR}`)
