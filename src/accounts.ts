import { readFile } from 'node:fs/promises'
import { type ScalarTag, parse } from 'yaml'

type OrganizationAccount = {
  Type: 'OC::ORG::MasterAccount' | 'OC::ORG::Account'
  Properties: {
    AccountId: string
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

export async function listAccountIdsInOrganizationYml() {
  const fileContent = await readFile('organization.yml', 'utf-8')
  const organization = parse(fileContent, {
    schema: 'core',
    version: '1.1',
    strict: false,
    customTags: [refTag],
  }) as OrganizationYaml
  return Object.values(organization.Organization)
    .filter(
      value =>
        value.Type === 'OC::ORG::Account' ||
        value.Type === 'OC::ORG::MasterAccount'
    )
    .map(o => (o as OrganizationAccount).Properties.AccountId)
}
