import { readFile } from 'node:fs/promises'
import { type ScalarTag, parse } from 'yaml'

type OrganizationAccount = {
  Type: 'OC::ORG::MasterAccount' | 'OC::ORG::Account'
  Properties: {
    AccountId: string
    AccountName: string
    RootEmail: string
  }
}
type OrganizationOU = {
  Type: 'OC::ORG::OrganizationalUnit'
}
type OrganizationYaml = {
  Organization: {
    [key: string]: OrganizationAccount | OrganizationOU
  }
}

const refTag: ScalarTag = {
  tag: '!Ref',
  resolve: (value: string) => ({ '!Ref': value }),
}

export type OrgFormationAccount = {
  AccountId: string
  AccountName: string
  RootEmail: string
  LogicalId: string
}

export async function listOrgFormationAccounts(): Promise<
  OrgFormationAccount[]
> {
  const fileContent = await readFile('organization.yml', 'utf-8')
  const organization = parse(fileContent, {
    schema: 'core',
    version: '1.1',
    strict: false,
    customTags: [refTag],
  }) as OrganizationYaml
  return Object.entries(organization.Organization)
    .filter(
      ([_, value]) =>
        value.Type === 'OC::ORG::Account' ||
        value.Type === 'OC::ORG::MasterAccount'
    )
    .map(([name, o]) => ({
      AccountId: (o as OrganizationAccount).Properties.AccountId,
      AccountName: (o as OrganizationAccount).Properties.AccountName,
      RootEmail: (o as OrganizationAccount).Properties.RootEmail,
      LogicalId: name,
    }))
}
