# org-formation-sso-import

An experimental™️ script to import AWS SSO groups, permission sets and
assignments into a
[OrgFormation](https://github.com/org-formation/org-formation-cli) workspace.

## The problem

If you have already bootstrapped your Landing Zone manually (or with some other
tool other than OrgFormation, e.g. Control Tower) and you want to start using
OrgFormation, you can easily import all your accounts and organizational units
with the `org-formation init` command. However, you will still need to manually
delete all your AWS SSO groups, permission sets and assignments and recreate
them as IaC in your OrgFormation template.

This script aims to automate this process by importing all your AWS SSO
configuration into your OrgFormation template and making sure all the existing
resources are imported correctly into the CloudFormation stacks managed by
OrgFormation.

## Installation

Installation is optional (you can run the script directly with `npx`), but if
you want to install it globally, you can run:

```bash
npm install -g org-formation-sso-import
```

## Requirements

- Node.js 20.x or later
- AWS CLI (configured with the right permissions - ideally an admin user in the
  management account)

## Usage

In your OrgFormation workspace, run the following command:

```bash
npx org-formation-sso-import
```

(or just `org-formation-sso-import` if you installed it globally)

> [!NOTE]\
> This command assumes that your `organization.yml` file is in the root of your
> workspace.

> [!IMPORTANT]\
> Your `organization.yml` file must have explicit `AccountId` properties for
> every account in your organization.

### Configuration options

You can get the list of available options by running:

```bash
org-formation-sso-import --help
```

This will print something like:

```plain
  --stack-name <value>
  -s <value>
  Pass the name of the stack to be deployed (default: "SsoAssignments")

  --identity-store-id <value>
  -i <value>
  Pass the id of the identity store. If not provided will try to fetch for an existing one

  --managing-instance-arn <value>
  -m <value>
  Pass the arn of the managing instance. If not provided will try to fetch for an existing one

  --verbose
  -v
  Enables verbose mode

  --help
  -h
  Prints this help
```

## How it works

This script will perform a number of actions to import your AWS SSO
configuration into your OrgFormation templates:

1. It will create a new CloudFormation stack in your management account with the
   name you provide (or `SsoAssignments` by default) and deploy it using
   OrgFormation.
2. It will query your AWS SSO configuration and retrieve groups, permission sets
   and assignments.
3. It will import all of these resources into the SSO stack managed by
   OrgFormation.
4. It will create a new OrgFormation template in your workspace with the
   resources imported from AWS SSO.

From this point on, you can manage your AWS SSO configuration as IaC with
OrgFormation and you wont' have to delete and recreate your groups, permission
sets and assignments just to be able to manage them in OrgFormation.

## Contributing

Everyone is very welcome to contribute to this project. You can contribute just
by submitting bugs or suggesting improvements by
[opening an issue on GitHub](https://github.com/lmammino/org-formation-sso-import/issues).

## License

Licensed under [MIT License](LICENSE). © Luciano Mammino.
