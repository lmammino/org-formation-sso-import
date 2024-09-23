import { join } from 'node:path'
import type { ResourceToImport } from '@aws-sdk/client-cloudformation'
import type { Group } from '@aws-sdk/client-identitystore'
import type { AccountAssignment } from '@aws-sdk/client-sso-admin'
import nunjucks from 'nunjucks'
import { stringify } from 'yaml'
import type { OrgFormationAccount } from './accounts.js'
import type { ExtendedPermissionSet } from './commands.js'
import { TEMP_GROUP_NAME } from './consts.js'

type ResourceIdentityStoreGroup = {
  ResourceType: 'AWS::IdentityStore::Group'
  LogicalResourceId: string
  ResourceIdentifier: {
    GroupId: string
    IdentityStoreId: string
  }
}
type ResourcePermissionSet = {
  ResourceType: 'AWS::SSO::PermissionSet'
  LogicalResourceId: string
  ResourceIdentifier: {
    PermissionSetArn: string
    InstanceArn: string
  }
}
type ResourceAssignment = {
  ResourceType: 'AWS::SSO::Assignment'
  LogicalResourceId: string
  ResourceIdentifier: {
    InstanceArn: string
    TargetId: string
    TargetType: string
    PermissionSetArn: string
    PrincipalType: string
    PrincipalId: string
  }
}
type ResourceJson =
  | ResourceIdentityStoreGroup
  | ResourcePermissionSet
  | ResourceAssignment

type TemplateResourceIdentityStoreGroup = {
  Type: 'AWS::IdentityStore::Group'
  DeletionPolicy?: 'Retain' | 'Delete'
  Properties: {
    Description?: string
    DisplayName: string
    IdentityStoreId: { Ref: string } | string
  }
}
type TemplateResourcePermissionSet = {
  Type: 'AWS::SSO::PermissionSet'
  DeletionPolicy?: 'Retain' | 'Delete'
  Properties: {
    Name: string
    Description?: string
    InstanceArn: { Ref: string } | string
    InlinePolicy?: string
    ManagedPolicies: string[]
    SessionDuration?: string
    RelayStateType?: string
  }
}
type TemplateResourceAssignment = {
  Type: 'AWS::SSO::Assignment'
  DeletionPolicy?: 'Retain' | 'Delete'
  Properties: {
    InstanceArn: { Ref: string } | string
    PermissionSetArn: string
    PrincipalId: string
    PrincipalType: string
    TargetId: string
    TargetType: string
  }
}
type TemplateResource =
  | TemplateResourceIdentityStoreGroup
  | TemplateResourcePermissionSet
  | TemplateResourceAssignment

function makeGroupsById(groups: Group[]): Record<string, Group> {
  return groups.reduce(
    (acc, group) => {
      acc[group.GroupId as string] = group
      return acc
    },
    {} as Record<string, Group>
  )
}

function makePermissionSetsByArn(
  permissionSets: ExtendedPermissionSet[]
): Record<string, ExtendedPermissionSet> {
  return permissionSets.reduce(
    (acc, permissionSet) => {
      acc[permissionSet.PermissionSetArn as string] = permissionSet
      return acc
    },
    {} as Record<string, ExtendedPermissionSet>
  )
}

function makeAccountsByAccountId(
  accounts: OrgFormationAccount[]
): Record<string, OrgFormationAccount> {
  return accounts.reduce(
    (acc, account) => {
      acc[account.AccountId] = account
      return acc
    },
    {} as Record<string, OrgFormationAccount>
  )
}

const templatesPath = join(import.meta.dirname, '..', 'templates')
const nunjucksEnv = nunjucks.configure(templatesPath, { autoescape: false })
nunjucksEnv.addFilter('toJsonToYaml', (value: string, baseIndent = 0) => {
  const json = JSON.parse(value)
  const yaml = stringify(json, { indent: 2 })
  const indentedYaml = yaml
    .split('\n')
    .map(line => '  '.repeat(baseIndent) + line)
    .join('\n')
  return indentedYaml
})

type CreateResourcesJsonOptions = {
  identityStoreId: string
  managingInstanceArn: string
  groups: Group[]
  permissionSets: ExtendedPermissionSet[]
  assignments: AccountAssignment[]
  accounts: OrgFormationAccount[]
}
export function createResourcesToImport({
  identityStoreId,
  managingInstanceArn,
  groups,
  permissionSets,
  assignments,
  accounts,
}: CreateResourcesJsonOptions): ResourceToImport[] {
  const resources: ResourceJson[] = []

  for (const group of groups) {
    resources.push({
      ResourceType: 'AWS::IdentityStore::Group',
      LogicalResourceId: `${group.DisplayName}Group`,
      ResourceIdentifier: {
        GroupId: group.GroupId as string,
        IdentityStoreId: identityStoreId,
      },
    })
  }

  for (const permissionSet of permissionSets) {
    resources.push({
      ResourceType: 'AWS::SSO::PermissionSet',
      LogicalResourceId: `${permissionSet.Name}PermissionSet`,
      ResourceIdentifier: {
        PermissionSetArn: permissionSet.PermissionSetArn as string,
        InstanceArn: managingInstanceArn,
      },
    })
  }

  const groupsById = makeGroupsById(groups)
  const permissionSetsByArn = makePermissionSetsByArn(permissionSets)
  const accountsByAccountId = makeAccountsByAccountId(accounts)

  for (const assignment of assignments) {
    const referenceGroup = groupsById[assignment.PrincipalId as string]
    const referencePermissionSet =
      permissionSetsByArn[assignment.PermissionSetArn as string]
    const referenceAccount = accountsByAccountId[assignment.AccountId as string]

    resources.push({
      ResourceType: 'AWS::SSO::Assignment',
      LogicalResourceId: `${referenceGroup?.DisplayName}GroupTo${referencePermissionSet?.Name}PermissionSetTo${referenceAccount?.LogicalId}`,
      ResourceIdentifier: {
        InstanceArn: managingInstanceArn,
        TargetId: assignment.AccountId as string,
        TargetType: 'AWS_ACCOUNT',
        PermissionSetArn: assignment.PermissionSetArn as string,
        PrincipalType: assignment.PrincipalType as string,
        PrincipalId: assignment.PrincipalId as string,
      },
    })
  }

  return resources
}

type CreateTemplateOptions = {
  identityStoreId: string
  managingInstanceArn: string
  tempGroup: Group
  groups: Group[]
  permissionSets: ExtendedPermissionSet[]
  assignments: AccountAssignment[]
  accounts: OrgFormationAccount[]
}

type CFTemplate = {
  AWSTemplateFormatVersion: string
  Description: string
  Parameters: {
    IdentityStoreId: {
      Type: string
      Default: string
    }
    ManagingInstanceArn: {
      Type: string
      Default: string
    }
  }
  Resources: { [key: string]: TemplateResource }
  Outputs: { [key: string]: string }
}

export function createTemplate({
  identityStoreId,
  managingInstanceArn,
  tempGroup,
  groups,
  permissionSets,
  assignments,
  accounts,
}: CreateTemplateOptions) {
  const template: CFTemplate = {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'Manage SSO Assignments',
    Parameters: {
      IdentityStoreId: {
        Type: 'String',
        Default: identityStoreId,
      },
      ManagingInstanceArn: {
        Type: 'String',
        Default: managingInstanceArn,
      },
    },
    Resources: {},
    Outputs: {},
  }

  template.Resources[`${tempGroup.DisplayName}Group`] = {
    Type: 'AWS::IdentityStore::Group',
    Properties: {
      Description: tempGroup.Description,
      DisplayName: tempGroup.DisplayName as string,
      IdentityStoreId: {
        Ref: 'IdentityStoreId',
      },
    },
  }

  for (const group of groups) {
    template.Resources[`${group.DisplayName}Group`] = {
      Type: 'AWS::IdentityStore::Group',
      DeletionPolicy: 'Retain',
      Properties: {
        Description: group.Description,
        DisplayName: group.DisplayName as string,
        IdentityStoreId: {
          Ref: 'IdentityStoreId',
        },
      },
    }
  }

  for (const permissionSet of permissionSets) {
    template.Resources[`${permissionSet.Name}PermissionSet`] = {
      Type: 'AWS::SSO::PermissionSet',
      DeletionPolicy: 'Retain',
      Properties: {
        Name: permissionSet.Name as string,
        Description: permissionSet.Description,
        InstanceArn: {
          Ref: 'ManagingInstanceArn',
        },
        InlinePolicy: permissionSet.InlinePolicy,
        ManagedPolicies: permissionSet.ManagedPolicies,
        SessionDuration: permissionSet.SessionDuration,
        RelayStateType: permissionSet.RelayState,
      },
    }
  }

  const groupsById = makeGroupsById(groups)
  const permissionSetsByArn = makePermissionSetsByArn(permissionSets)
  const accountsByAccountId = makeAccountsByAccountId(accounts)

  for (const assignment of assignments) {
    const referenceGroup = groupsById[assignment.PrincipalId as string]
    const referencePermissionSet =
      permissionSetsByArn[assignment.PermissionSetArn as string]
    const referenceAccount = accountsByAccountId[assignment.AccountId as string]
    const logicalId = `${referenceGroup?.DisplayName}GroupTo${referencePermissionSet?.Name}PermissionSetTo${referenceAccount?.LogicalId}`

    template.Resources[logicalId] = {
      Type: 'AWS::SSO::Assignment',
      DeletionPolicy: 'Retain',
      Properties: {
        InstanceArn: {
          Ref: 'ManagingInstanceArn',
        },
        PermissionSetArn: assignment.PermissionSetArn as string,
        PrincipalId: assignment.PrincipalId as string,
        PrincipalType: assignment.PrincipalType as string,
        TargetId: assignment.AccountId as string,
        TargetType: 'AWS_ACCOUNT',
      },
    }
  }

  return JSON.stringify(template, null, 2)
}

type CreateOrganizationalTaskYmlOptions = {
  stackName: string
  organizationUpdate: boolean
  ssoAssignmentTemplate: string
}
export function createOrganizationTasksYml({
  stackName,
  organizationUpdate,
  ssoAssignmentTemplate,
}: CreateOrganizationalTaskYmlOptions) {
  const taskContent = nunjucksEnv.render('organization-tasks.yml.njk', {
    stackName,
    ssoAssignmentTemplate,
    organizationUpdate,
  })
  return taskContent
}

export function createBaseOrgFormationSsoAssignmentsYml({
  identityStoreId,
  managingInstanceArn,
}: {
  identityStoreId: string
  managingInstanceArn: string
}) {
  const baseTemplateContent = nunjucksEnv.render(
    'sso-assignments-base.yml.njk',
    {
      identityStoreId,
      managingInstanceArn,
      groups: [
        {
          name: TEMP_GROUP_NAME,
          displayName: TEMP_GROUP_NAME,
          description: 'To be removed',
        },
      ],
    }
  )
  return baseTemplateContent
}

type CreateOrgFormationSsoAssignmentsYmlOptions = {
  identityStoreId: string
  managingInstanceArn: string
  groups: Group[]
  permissionSets: ExtendedPermissionSet[]
  assignments: AccountAssignment[]
  accounts: OrgFormationAccount[]
}

export function createOrgFormationSsoAssignmentsYml({
  identityStoreId,
  managingInstanceArn,
  groups,
  permissionSets,
  assignments,
  accounts,
}: CreateOrgFormationSsoAssignmentsYmlOptions) {
  const groupsById = makeGroupsById(groups)
  const permissionSetsByArn = makePermissionSetsByArn(permissionSets)
  const accountsByAccountId = makeAccountsByAccountId(accounts)

  const templateContent = nunjucksEnv.render('sso-assignments.yml.njk', {
    identityStoreId,
    managingInstanceArn,
    groups,
    permissionSets,
    assignments,
    accounts,
    groupsById,
    permissionSetsByArn,
    accountsByAccountId,
  })
  return templateContent
}
