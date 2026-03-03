#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readJson(jsonPath) {
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
}

function limit(list, maxItems) {
  if (!Array.isArray(list)) {
    return [];
  }
  return list.slice(0, maxItems);
}

(function main() {
  const summaryPath = process.argv[2] || 'trivy-remediation-summary.json';
  const outputPath = process.argv[3] || 'trivy-pr-body.md';

  const summary = readJson(path.resolve(process.cwd(), summaryPath));

  const vulnerabilities = Array.isArray(summary.vulnerabilities) ? summary.vulnerabilities : [];
  const directFixes = Array.isArray(summary.directDependencyUpdates) ? summary.directDependencyUpdates : [];
  const transitiveFixes = Array.isArray(summary.transitiveOverrideUpdates) ? summary.transitiveOverrideUpdates : [];

  const lines = [];
  lines.push('## Summary');
  lines.push('Automated remediation for Trivy dependency vulnerabilities.');
  lines.push('');
  lines.push('## Counts');
  lines.push(`- Vulnerabilities detected: ${summary.vulnerabilityCount || vulnerabilities.length}`);
  lines.push(`- Packages with fixed versions detected: ${summary.packageFixCount || 0}`);
  lines.push(`- Direct dependency updates: ${summary.directDependencyUpdateCount || 0}`);
  lines.push(`- Transitive overrides updated: ${summary.transitiveOverrideUpdateCount || 0}`);
  lines.push('');

  lines.push('## Vulnerabilities (Top 100)');
  if (vulnerabilities.length === 0) {
    lines.push('- None found in the Trivy JSON report.');
  } else {
    lines.push('| Vulnerability | Severity | Package | Installed | Fixed | Target |');
    lines.push('|---|---|---|---|---|---|');
    for (const v of limit(vulnerabilities, 100)) {
      lines.push(`| ${v.vulnerabilityId} | ${v.severity} | ${v.packageName} | ${v.installedVersion} | ${v.fixedVersion || '-'} | ${v.target} |`);
    }
  }
  lines.push('');

  lines.push('## Direct Dependency Fixes (Top 100)');
  if (directFixes.length === 0) {
    lines.push('- No direct dependency changes were needed.');
  } else {
    lines.push('| File | Dependency | From | To |');
    lines.push('|---|---|---|---|');
    for (const fix of limit(directFixes, 100)) {
      lines.push(`| ${fix.packageJsonPath} | ${fix.dependencyName} | ${fix.from} | ${fix.to} |`);
    }
  }
  lines.push('');

  lines.push('## Transitive Overrides Applied (Top 100)');
  if (transitiveFixes.length === 0) {
    lines.push('- No transitive overrides were added/updated.');
  } else {
    lines.push('| Dependency | From | To |');
    lines.push('|---|---|---|');
    for (const fix of limit(transitiveFixes, 100)) {
      lines.push(`| ${fix.dependencyName} | ${fix.from || '-'} | ${fix.to} |`);
    }
  }
  lines.push('');

  lines.push('## Validation');
  lines.push('- `rush update --full`');
  lines.push('- `rush build --verbose`');
  lines.push('- Diagram test suite (Ballerina + MI diagrams)');
  lines.push('- Trivy re-scan');

  fs.writeFileSync(path.resolve(process.cwd(), outputPath), `${lines.join('\n')}\n`, 'utf8');
})();
