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

const stsClient = new STSClient()
const ssoAdminClient = new SSOAdminClient()
const identityStoreClient = new IdentitystoreClient()

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

export async function orgFormationDeploy($$: Shell, tmpDir: string) {
  try {
    const result =
      await $$`org-formation perform-tasks ${tmpDir}/organization-tasks.yml --organization-file organization.yml`
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
