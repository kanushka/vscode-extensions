#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const lsDir = path.join(projectRoot, 'ls');

function getBundledLanguageServerJar() {
    if (!fs.existsSync(lsDir)) {
        return undefined;
    }

    return fs.readdirSync(lsDir).find((file) =>
        /^ballerina-language-server.*\.jar$/.test(file)
    );
}

const jarName = getBundledLanguageServerJar();

if (!jarName) {
    console.error(`Bundled Ballerina language server JAR not found in ${path.relative(projectRoot, lsDir)}.`);
    console.error('Download it before building:');
    console.error('  pnpm --dir workspaces/ballerina/ballerina-extension run download-ls');
    console.error('  pnpm --dir workspaces/ballerina/ballerina-extension run download-ls -- --tag v1.8.0.m1 --replace');
    process.exit(1);
}

console.log(`Using bundled Ballerina language server: ${jarName}`);
