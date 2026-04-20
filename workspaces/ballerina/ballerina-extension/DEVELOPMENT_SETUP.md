# Ballerina Extension Development Setup

## Initial Setup

Run `rush install` once after cloning the repository to install dependencies and set up the workspace.

## Build

Use `rush build` for a full build of the repository.

To build only the Ballerina package, run:

```bash
rush build -t ballerina
```

## Language Server

The Ballerina language server is **not downloaded automatically** during `rush build`. Before building the extension, download the bundled language server into `workspaces/ballerina/ballerina-extension/ls`:

```bash
pnpm --dir workspaces/ballerina/ballerina-extension run download-ls
```

To download a specific version by Git tag:

```bash
pnpm --dir workspaces/ballerina/ballerina-extension run download-ls -- --tag v1.8.0.m1 --replace
```

To download the latest prerelease:

```bash
pnpm --dir workspaces/ballerina/ballerina-extension run download-ls -- --tag prerelease --replace
```

The `--replace` flag clears the existing `ls/` directory before downloading.

The build will fail with a clear message if the `ls` directory does not contain a `ballerina-language-server*.jar`.

## CI/CD Pipeline Configuration

Pipelines read configuration from `release.properties` in this directory:

```properties
# Language server tag
ls.tag=latest
# Product-integrator branch for version update PRs (leave empty to skip)
integrator.branch=
```

To pin a specific LS version for a branch, update `ls.tag`:

```properties
ls.tag=v1.8.0.m1
```

To enable automatic PRs to product-integrator after daily builds, set the target branch:

```properties
integrator.branch=5.0.x
```

## BI End-to-End Tests

BI Playwright tests are located in `e2e-test/e2e-playwright-tests`.

From this directory (`workspaces/ballerina/ballerina-extension`):

- Run `pnpm run e2e-test:bi` to execute BI Playwright tests.
- Run `pnpm run e2e-test:bi:download-prerelease` to run BI tests after downloading prerelease VSIXs.
