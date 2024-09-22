import {
  CloudFormationClient,
  CreateChangeSetCommand,
  DescribeChangeSetCommand,
  DescribeStacksCommand,
  ExecuteChangeSetCommand,
  type ResourceToImport,
} from '@aws-sdk/client-cloudformation'
import {
  type Group,
  IdentitystoreClient,
  ListGroupsCommand,
} from '@aws-sdk/client-identitystore'
import {
  type AccountAssignment,
  DescribePermissionSetCommand,
  GetInlinePolicyForPermissionSetCommand,
  type InstanceMetadata,
  ListAccountAssignmentsCommand,
  ListInstancesCommand,
  ListManagedPoliciesInPermissionSetCommand,
  ListPermissionSetsCommand,
  type PermissionSet,
  SSOAdminClient,
} from '@aws-sdk/client-sso-admin'
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts'
import type { Shell } from 'zx'
import { IMPORT_RESOURCES_CHANGESET_NAME } from './consts.js'

const stsClient = new STSClient()
const ssoAdminClient = new SSOAdminClient()
const identityStoreClient = new IdentitystoreClient()
const cloudformationClient = new CloudFormationClient()

export async function getCallerIdentity() {
  const command = new GetCallerIdentityCommand()
  const response = await stsClient.send(command)
  return {
    Account: response.Account,
    UserId: response.UserId,
    Arn: response.Arn,
  }
}

export async function getOrgFormationVersion($$: Shell) {
  try {
    const orgFormationCheck = await $$`org-formation --version`
    return orgFormationCheck.stdout
  } catch (e) {
    console.error(
      'org-formation CLI not found. Please install it with `npm i -g org-formation`'
    )
    throw e
  }
}

export async function listSsoInstances() {
  const instances: InstanceMetadata[] = []
  let lastToken: string | undefined
  while (true) {
    const command = new ListInstancesCommand({
      NextToken: lastToken,
    })
    const response = await ssoAdminClient.send(command)
    if (response.Instances) {
      instances.push(...response.Instances)
    }
    lastToken = response.NextToken
    if (!response.NextToken) {
      break
    }
  }
  return instances
}

export async function orgFormationDeploy($$: Shell, taskFile: string) {
  try {
    const result =
      await $$`org-formation perform-tasks ${taskFile} --organization-file organization.yml`
    return result.stdout
  } catch (e) {
    console.error('Failed to deploy initial stack')
    throw e
  }
}

export async function listGroups(identityStoreId: string) {
  const groups: Group[] = []
  let lastToken: string | undefined

  while (true) {
    const listGroupsCommand = new ListGroupsCommand({
      IdentityStoreId: identityStoreId,
      NextToken: lastToken,
    })
    const response = await identityStoreClient.send(listGroupsCommand)
    if (response.Groups) {
      groups.push(...response.Groups)
    }
    lastToken = response.NextToken
    if (!response.NextToken) {
      break
    }
  }

  return groups
}

export interface ExtendedPermissionSet extends PermissionSet {
  InlinePolicy?: string
  ManagedPolicies: string[]
}

export async function listPermissionSets(instanceArn: string) {
  const permissionSetsArns: string[] = []
  const permissionSets: ExtendedPermissionSet[] = []
  let lastToken: string | undefined

  while (true) {
    const command = new ListPermissionSetsCommand({
      InstanceArn: instanceArn,
      NextToken: lastToken,
    })
    const response = await ssoAdminClient.send(command)
    if (response.PermissionSets) {
      permissionSetsArns.push(...response.PermissionSets)
    }
    lastToken = response.NextToken
    if (!response.NextToken) {
      break
    }
  }

  for (const permissionSetArn of permissionSetsArns) {
    const command = new DescribePermissionSetCommand({
      InstanceArn: instanceArn,
      PermissionSetArn: permissionSetArn,
    })
    const response = await ssoAdminClient.send(command)
    const permissionSet = response.PermissionSet as ExtendedPermissionSet

    // get inline policy
    const getInlinePolicyCommand = new GetInlinePolicyForPermissionSetCommand({
      InstanceArn: instanceArn,
      PermissionSetArn: permissionSetArn,
    })
    const inlinePolicyResponse = await ssoAdminClient.send(
      getInlinePolicyCommand
    )
    permissionSet.InlinePolicy = inlinePolicyResponse.InlinePolicy

    // get managed policies
    let mpLastToken: string | undefined
    const managedPolicies: string[] = []
    while (true) {
      const managedPolicyCommand =
        new ListManagedPoliciesInPermissionSetCommand({
          InstanceArn: instanceArn,
          PermissionSetArn: permissionSetArn,
          NextToken: mpLastToken,
        })
      const mpResponse = await ssoAdminClient.send(managedPolicyCommand)
      if (mpResponse.AttachedManagedPolicies) {
        managedPolicies.push(
          ...mpResponse.AttachedManagedPolicies.map(i => i.Arn as string)
        )
      }
      mpLastToken = mpResponse.NextToken
      if (!mpResponse.NextToken) {
        break
      }
    }
    permissionSet.ManagedPolicies = managedPolicies

    permissionSets.push(permissionSet)
  }

  return permissionSets
}

export async function listAssignments(
  instanceArn: string,
  accountIds: string[],
  permissionSets: ExtendedPermissionSet[]
) {
  const assignments: AccountAssignment[] = []

  for (const accountId of accountIds) {
    for (const permissionSet of permissionSets) {
      let lastToken: string | undefined

      while (true) {
        const accountAssignment = new ListAccountAssignmentsCommand({
          AccountId: accountId,
          InstanceArn: instanceArn,
          PermissionSetArn: permissionSet.PermissionSetArn,
          NextToken: lastToken,
        })
        const assignmentsResponse = await ssoAdminClient.send(accountAssignment)
        if (assignmentsResponse.AccountAssignments) {
          assignments.push(...assignmentsResponse.AccountAssignments)
        }
        lastToken = assignmentsResponse.NextToken
        if (!assignmentsResponse.NextToken) {
          break
        }
      }
    }
  }

  return assignments
}

type CreateAndExecuteChangeSetOptions = {
  stackName: string
  templateBody: string
  resourcesToImport: ResourceToImport[]
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: <explanation>
export async function createAndExecuteChangeSet({
  stackName,
  templateBody,
  resourcesToImport,
}: CreateAndExecuteChangeSetOptions) {
  // create changeset
  const createChangeSetCommand = new CreateChangeSetCommand({
    ChangeSetName: IMPORT_RESOURCES_CHANGESET_NAME,
    ChangeSetType: 'IMPORT',
    StackName: stackName,
    ResourcesToImport: resourcesToImport,
    TemplateBody: templateBody,
  })
  await cloudformationClient.send(createChangeSetCommand)

  // wait for changeset to be ready
  let changeSetCreationAttempts = 0
  while (true) {
    const describeChangeSetCommand = new DescribeChangeSetCommand({
      ChangeSetName: IMPORT_RESOURCES_CHANGESET_NAME,
      StackName: stackName,
    })
    const describeChangeSetResult = await cloudformationClient.send(
      describeChangeSetCommand
    )

    if (describeChangeSetResult.Status === 'CREATE_COMPLETE') {
      break
    }

    if (describeChangeSetResult.Status === 'FAILED') {
      throw new Error(
        `Failed to create change set: ${describeChangeSetResult.StatusReason}`
      )
    }

    changeSetCreationAttempts++
    if (changeSetCreationAttempts > 30) {
      throw new Error('Change set creation has been taking too long')
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  // execute changeset
  const executeChangeSetCommand = new ExecuteChangeSetCommand({
    ChangeSetName: IMPORT_RESOURCES_CHANGESET_NAME,
    StackName: stackName,
  })
  await cloudformationClient.send(executeChangeSetCommand)

  // wait for import to complete
  let changeSetImportAttempts = 0
  while (true) {
    const describeStackCommand = new DescribeStacksCommand({
      StackName: stackName,
    })
    const describeStackResult =
      await cloudformationClient.send(describeStackCommand)

    const status = describeStackResult.Stacks?.[0]?.StackStatus
    if (status) {
      if (status === 'IMPORT_COMPLETE') {
        break
      }

      if (status !== 'IMPORT_IN_PROGRESS') {
        throw new Error(
          `Failed to import change set (${status}): ${describeStackResult.Stacks?.[0]?.StackStatusReason}`
        )
      }
    }

    changeSetImportAttempts++
    if (changeSetImportAttempts > 30) {
      throw new Error('Change set import has been taking too long')
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
}
