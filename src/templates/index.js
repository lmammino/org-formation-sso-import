export function createResourcesJson({ identityStoreId, groups }) {
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

  return JSON.stringify(resources, null, 2)
}

export function createTemplate({
  identityStoreId,
  managingInstanceArn,
  tempGroup,
  groups,
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

  return JSON.stringify(template, null, 2)
}
