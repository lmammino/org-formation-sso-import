export function createResourcesJson({
  identityStoreId,
  managingInstanceArn,
  groups,
  permissionSets,
}) {
  const resources = []

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

export function createTemplate({
  identityStoreId,
  managingInstanceArn,
  tempGroup,
  groups,
  permissionSets,
}) {
  const template = {
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
