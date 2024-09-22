#!/usr/bin/env node

import { $ } from 'zx'
import { writeFile } from 'node:fs/promises'
import {
  createBaseOrgFormationSsoAssignmentsYml,
  createOrganizationTasksYml,
  createResourcesJson,
  createTemplate,
} from './templates.js'
import { getArgs } from './args.js'
import {
  getCallerIdentity,
  getOrgFormationVersion,
  listGroups,
  listPermissionSets,
  listSsoInstances,
  orgFormationDeploy,
} from './commands.js'
import { mkdirp } from 'mkdirp'
import { TEMP_DIR, TEMP_GROUP_NAME } from './consts.js'
import { get } from 'node:http'

const args = getArgs(process.argv)

const $$ = $({
  verbose: args.verbose,
})

// 0. preliminary checks
// check if has correct credentials
const callerIdentity = getCallerIdentity()
if (args.verbose) {
  console.info('Caller identity:', callerIdentity)
}
// checks if org-formation is installed
getOrgFormationVersion($$)

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

// 3. create org-formation task
const taskContent = createOrganizationTasksYml({ stackName })
await writeFile(`${TEMP_DIR}/organization-tasks.yml`, taskContent)

// 4. create base org-formation template for SsoAssignments
const baseTemplateContent = createBaseOrgFormationSsoAssignmentsYml({
  identityStoreId,
  managingInstanceArn,
})
await writeFile(`${TEMP_DIR}/sso-assignments.yml`, baseTemplateContent)

// // 5. org-formation deploy initial stack
// TODO: uncomment
// await orgFormationDeploy($$, tmpDir)

// // 6. Find all existing resources

// 6.1. Find all existing groups
let groups = await listGroups(identityStoreId)
const tempGroup = groups.find(g => g.DisplayName === TEMP_GROUP_NAME)
groups = groups.filter(g => g.DisplayName !== TEMP_GROUP_NAME)

// 6.2. Find all existing permissions sets
const permissionSets = await listPermissionSets(managingInstanceArn)

// 6.3 Find all existing assignments
// // TODO: list accounts (from organization.yml)
// // TODO: for every pair of accounts/permission-set, list account assignments
// //       aws sso-admin list-account-assignments --instance-arn ${managingInstanceArn} --account-id ${accountId} --permission-set-arn ${permissionSetArn}

// // 7. Create JSON file with list of resources to import
// const resourcesJsonContent = createResourcesJson({
//   identityStoreId,
//   managingInstanceArn,
//   groups,
//   permissionSets,
// })
// await writeFile(`${tmpDir}/resources.json`, resourcesJsonContent)

// // 8. Create CloudFormation template for resource import
// const templateJsonContent = createTemplate({
//   identityStoreId,
//   managingInstanceArn,
//   tempGroup,
//   groups,
//   permissionSets,
// })
// await writeFile(`${tmpDir}/template.json`, templateJsonContent)

// // TODO: continue from here
// console.log(groups)
// console.log(permissionSets)
// process.exit(0)

// // 9. Create changeset
// const changesetName = 'OrgFormationSsoImportResources'
// const createStackSetResult =
//   await $$`aws cloudformation create-change-set --stack-name ${stackName} --change-set-name ${changesetName} --change-set-type IMPORT --resources-to-import file://${tmpDir}/resources.json --template-body file://${tmpDir}/template.json`
// if (createStackSetResult.exitCode !== 0) {
//   console.error(createStackSetResult.stderr)
//   process.exit(1)
// }

// // 11. Wait for the changeset to be completed
// let changeSetCreationAttempts = 0
// while (true) {
//   const describeChangeSetResult =
//     await $$`aws cloudformation describe-change-set --change-set-name ${changesetName} --stack-name ${stackName}`
//   if (describeChangeSetResult.exitCode !== 0) {
//     console.error(describeChangeSetResult.stderr)
//     process.exit(1)
//   }
//   const data = JSON.parse(describeChangeSetResult.stdout)
//   if (data.Status === 'CREATE_COMPLETE') {
//     break
//   }
//   if (data.Status === 'FAILED') {
//     console.error('Failed to create change set')
//     console.error(data.StatusReason)
//     process.exit(1)
//   }

//   changeSetCreationAttempts++
//   if (changeSetCreationAttempts > 30) {
//     console.error('Change set creation has been taking too long')
//     process.exit(1)
//   }
//   await new Promise(resolve => setTimeout(resolve, 1000))
// }

// // 10. Execute changeset
// const executeStackSetResult =
//   await $$`aws cloudformation execute-change-set --change-set-name ${changesetName} --stack-name ${stackName}`
// if (executeStackSetResult.exitCode !== 0) {
//   console.error(executeStackSetResult.stderr)
//   process.exit(1)
// }

// // TODO generate new sso-assignments.yml with the new groups and permission sets and assignments
