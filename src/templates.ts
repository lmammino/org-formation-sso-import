import { join } from 'node:path'
import nunjucks from 'nunjucks'
import { TEMP_GROUP_NAME } from './consts.js'

type ResourceIdentityStoreGroup = {
  ResourceType: 'AWS::IdentityStore::Group'
  LogicalResourceId: string
  ResourceIdentifier: {
    GroupId: string
    IdentityStoreId: string
  }
}
type PermissionSet = {
  ResourceType: 'AWS::SSO::PermissionSet'
  LogicalResourceId: string
  ResourceIdentifier: {
    PermissionSetArn: string
    InstanceArn: string
  }
}
type ResourceJson = ResourceIdentityStoreGroup | PermissionSet

type TemplateResourceIdentityStoreGroup = {
  Type: 'AWS::IdentityStore::Group'
  DeletionPolicy?: 'Retain' | 'Delete'
  Properties: {
    Description: string
    DisplayName: string
    IdentityStoreId: { Ref: string } | string
  }
}
type TemplateResourcePermissionSet = {
  Type: 'AWS::SSO::PermissionSet'
  DeletionPolicy?: 'Retain' | 'Delete'
  Properties: {
    Name: string
    Description: string
    InstanceArn: { Ref: string } | string
    InlinePolicy: string
    ManagedPolicies: string[]
    SessionDuration: string
    RelayStateType?: string
  }
}
type TemplateResource =
  | TemplateResourceIdentityStoreGroup
  | TemplateResourcePermissionSet

const templatesPath = join(import.meta.dirname, '..', 'templates')
nunjucks.configure(templatesPath, { autoescape: false })

type CreateResourcesJsonOptions = {
  identityStoreId: string
  managingInstanceArn: string
  groups: {
    GroupId: string
    DisplayName: string
  }[]
  permissionSets: {
    PermissionSetArn: string
    Name: string
  }[]
}
export function createResourcesJson({
  identityStoreId,
  managingInstanceArn,
  groups,
  permissionSets,
}: CreateResourcesJsonOptions) {
  const resources: ResourceJson[] = []

  for (const group of groups) {
    resources.push({
      ResourceType: 'AWS::IdentityStore::Group',
      LogicalResourceId: `${group.DisplayName}Group`,
      ResourceIdentifier: {
        GroupId: group.GroupId,
        IdentityStoreId: identityStoreId,
      },
    })
  }

  for (const permissionSet of permissionSets) {
    resources.push({
      ResourceType: 'AWS::SSO::PermissionSet',
      LogicalResourceId: `${permissionSet.Name}PermissionSet`,
      ResourceIdentifier: {
        PermissionSetArn: permissionSet.PermissionSetArn,
        InstanceArn: managingInstanceArn,
      },
    })
  }

  return JSON.stringify(resources, null, 2)
}

type CreateTemplateOptions = {
  identityStoreId: string
  managingInstanceArn: string
  tempGroup: {
    DisplayName: string
    Description: string
  }
  groups: {
    DisplayName: string
    Description: string
  }[]
  permissionSets: {
    Name: string
    Description: string
    InlinePolicy: string
    ManagedPolicies: string[]
    SessionDuration: string
    RelayStateType: string
  }[]
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
      DisplayName: tempGroup.DisplayName,
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
        DisplayName: group.DisplayName,
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
        Name: permissionSet.Name,
        Description: permissionSet.Description,
        InstanceArn: {
          Ref: 'ManagingInstanceArn',
        },
        InlinePolicy: permissionSet.InlinePolicy,
        ManagedPolicies: permissionSet.ManagedPolicies,
        SessionDuration: permissionSet.SessionDuration,
        RelayStateType: permissionSet.RelayStateType,
      },
    }
  }

  return JSON.stringify(template, null, 2)
}

export function createOrganizationTasksYml({
  stackName,
}: { stackName: string }) {
  const taskContent = nunjucks.render('organization-tasks.yml.njk', {
    stackName: stackName,
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
  const baseTemplateContent = nunjucks.render('sso-assignments.yml.njk', {
    identityStoreId,
    managingInstanceArn,
    groups: [
      {
        name: TEMP_GROUP_NAME,
        displayName: TEMP_GROUP_NAME,
        description: 'To be removed',
      },
    ],
  })
  return baseTemplateContent
}
